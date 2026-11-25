import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {useMushafBackdrop} from '../contexts/MushafBackdropContext';
import {
  computeContinuousSlotMetrics,
  computeScrollTopForPage,
  computeVisiblePageWindow,
  reprojectScrollTopOnZoomChange,
  resolveVisiblePageFromScrollTop,
} from '../lib/continuousScrollMath';
import {LONG_PRESS_DURATION_MS, TAP_MOVE_TOLERANCE_PX} from '../lib/gestureEngine';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {
  applyViewBoxToSvg,
  findAyahAtSvgPoint,
  getAyahAnchorNormalized,
  parseViewBox,
} from '../lib/polygonUtils';
import {
  resolveContinuousReadingPosition,
  type ReadingPosition,
} from '../lib/readingPosition';
import {
  computeBasePageLayout,
  DEFAULT_READING_INSETS,
  type ViewportSize,
} from '../lib/zoomMath';
import {
  toArabicIndic,
  type MushafPagePayload,
  type MushafThemeConfig,
  type RawAyahEntry,
} from '../types/mushaf';
import {AyahGlassHighlightOverlay} from './AyahGlassHighlightOverlay';
import {AyahMiniActions} from './AyahMiniActions';

interface Props {
  initialPage: number;
  initialIntraPageRatio?: number;
  jumpRequest: {page: number; seq: number} | null;
  theme: MushafThemeConfig;
  zoom: number;
  fitMode: 'contain' | 'fill-width';
  performanceProfile: PerformanceProfile;
  highlightedAyah: {page: number; surahNumber: number; ayahNumber: number} | null;
  contextMenuTarget: {page: number; ayah: RawAyahEntry} | null;
  stepHandlerRef: React.MutableRefObject<((deltaPx: number) => boolean) | null>;
  fetchPage: (page: number) => Promise<MushafPagePayload>;
  onReadingPositionChange: (pos: ReadingPosition) => void;
  onQuickTap: () => void;
  onLongPressAyah: (page: number, ayah: RawAyahEntry) => void;
  onSaveBookmark: (page: number, ayah: RawAyahEntry) => void;
  onOpenTafsir: (page: number, ayah: RawAyahEntry) => void;
}

export function ContinuousMushafStage({
  initialPage,
  initialIntraPageRatio = 0,
  jumpRequest,
  theme,
  zoom,
  fitMode,
  performanceProfile,
  highlightedAyah,
  contextMenuTarget,
  stepHandlerRef,
  fetchPage,
  onReadingPositionChange,
  onQuickTap,
  onLongPressAyah,
  onSaveBookmark,
  onOpenTafsir,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const backdrop = useMushafBackdrop();
  const [viewport, setViewport] = useState<ViewportSize>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));

  const [activePage, setActivePage] = useState<number>(initialPage);
  const [loadedPages, setLoadedPages] = useState<Record<number, MushafPagePayload>>({});

  const baseLayout = useMemo(
    () => computeBasePageLayout(viewport, 345 / 550, fitMode, DEFAULT_READING_INSETS),
    [viewport, fitMode]
  );
  const metrics = useMemo(
    () => computeContinuousSlotMetrics(baseLayout, zoom),
    [baseLayout, zoom]
  );

  const preciseScrollRef = useRef<number>(0);
  const initializedRef = useRef<boolean>(false);
  const prevStrideRef = useRef<number>(metrics.stride);
  const activePageRef = useRef<number>(activePage);
  const viewportHeightRef = useRef<number>(viewport.height);
  const strideRef = useRef<number>(metrics.stride);
  const loadedPagesRef = useRef<Record<number, MushafPagePayload>>(loadedPages);
  const onReadingPositionChangeRef = useRef(onReadingPositionChange);
  const lastEmitTsRef = useRef<number>(0);

  activePageRef.current = activePage;
  viewportHeightRef.current = viewport.height;
  strideRef.current = metrics.stride;
  loadedPagesRef.current = loadedPages;
  onReadingPositionChangeRef.current = onReadingPositionChange;

  const commitReadingPositionFromScrollTop = useCallback(
    (scrollTopValue: number, forceEmit = false) => {
      const vpH = viewportHeightRef.current;
      const curStride = strideRef.current;
      const preliminaryPage = resolveVisiblePageFromScrollTop(scrollTopValue, vpH, curStride);
      const payload = loadedPagesRef.current[preliminaryPage];
      const viewBox = payload
        ? parseViewBox(payload.svg, payload.page, payload.ayahs)
        : undefined;

      const pos = resolveContinuousReadingPosition({
        scrollTop: scrollTopValue,
        viewportHeight: vpH,
        stride: curStride,
        pageAyahs: payload?.ayahs,
        viewBox,
      });

      const pageChanged = pos.page !== activePageRef.current;
      if (pageChanged) {
        activePageRef.current = pos.page;
        setActivePage(pos.page);
      }

      const now = performance.now();
      if (forceEmit || pageChanged || now - lastEmitTsRef.current >= 140) {
        lastEmitTsRef.current = now;
        onReadingPositionChangeRef.current(pos);
      }
    },
    []
  );

  // Measure viewport cleanly on resize/orientation change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({width: rect.width, height: rect.height});
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('orientationchange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  // Align scrollTop cleanly to initialPage (+ optional intraPageRatio) on first mount without flashing page 1
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || initializedRef.current) return;
    const clampedRatio = Math.max(0, Math.min(0.85, initialIntraPageRatio));
    const startY =
      computeScrollTopForPage(initialPage, metrics.stride) + clampedRatio * metrics.stride;
    el.scrollTop = startY;
    preciseScrollRef.current = startY;
    prevStrideRef.current = metrics.stride;
    initializedRef.current = true;
    commitReadingPositionFromScrollTop(startY, true);
  }, [initialPage, initialIntraPageRatio, metrics.stride, commitReadingPositionFromScrollTop]);

  // Preserve reading position when zoom or viewport stride changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !initializedRef.current) return;
    if (Math.abs(prevStrideRef.current - metrics.stride) < 0.5) return;

    const nextTop = reprojectScrollTopOnZoomChange({
      oldScrollTop: preciseScrollRef.current,
      oldStride: prevStrideRef.current,
      newStride: metrics.stride,
    });
    el.scrollTop = nextTop;
    preciseScrollRef.current = nextTop;
    prevStrideRef.current = metrics.stride;
    commitReadingPositionFromScrollTop(nextTop, true);
  }, [metrics.stride, commitReadingPositionFromScrollTop]);

  // Support direct page jumps (Bookmarks / Search) while in Continuous Mode
  useEffect(() => {
    if (!jumpRequest) return;
    const el = scrollRef.current;
    if (!el) return;
    const targetTop = computeScrollTopForPage(jumpRequest.page, metrics.stride);
    el.scrollTop = targetTop;
    preciseScrollRef.current = targetTop;
    commitReadingPositionFromScrollTop(targetTop, true);
  }, [jumpRequest, metrics.stride, commitReadingPositionFromScrollTop]);

  // Flush final reading position synchronously on unmount so exiting Continuous Mode NEVER loses final page
  useEffect(() => {
    return () => {
      commitReadingPositionFromScrollTop(preciseScrollRef.current, true);
    };
  }, [commitReadingPositionFromScrollTop]);

  // Expose fractional auto-scroll stepper directly for AutoScrollPill rAF
  useEffect(() => {
    stepHandlerRef.current = (deltaPx: number) => {
      const el = scrollRef.current;
      if (!el) return false;
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      if (maxScroll <= 1) return false;

      const nextTop = Math.min(maxScroll, preciseScrollRef.current + deltaPx);
      preciseScrollRef.current = nextTop;
      el.scrollTop = nextTop;
      if (backdrop?.enabled) {
        backdrop.setLiveOffset({x: -el.scrollLeft, y: -nextTop});
      }
      commitReadingPositionFromScrollTop(nextTop, false);
      return nextTop < maxScroll - 0.5;
    };
    return () => {
      stepHandlerRef.current = null;
    };
  }, [stepHandlerRef, commitReadingPositionFromScrollTop, backdrop]);

  // Keep active page & manual scroll sync accurate
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const currentTop = el.scrollTop;
    if (Math.abs(currentTop - preciseScrollRef.current) > 2.5) {
      preciseScrollRef.current = currentTop;
    }
    if (backdrop?.enabled) {
      backdrop.setLiveOffset({x: -el.scrollLeft, y: -currentTop});
    }
    commitReadingPositionFromScrollTop(currentTop, false);
  }, [commitReadingPositionFromScrollTop, backdrop]);

  const visiblePages = useMemo(() => computeVisiblePageWindow(activePage, 3, 4), [activePage]);

  // Publish visible page snapshots and world coordinates for synchronized glass refraction
  useLayoutEffect(() => {
    if (!backdrop || !backdrop.enabled) return;
    const padX = viewport.width >= 640 ? 16 : 6;
    const padY = viewport.width >= 640 ? 28 : 24;
    const containerW = Math.max(viewport.width, metrics.slotWidth);
    const slotLeft = (containerW - metrics.slotWidth) / 2;

    const slots = visiblePages
      .map((p) => {
        const payload = loadedPages[p];
        if (!payload) return null;
        return {
          key: `cont-${p}`,
          page: p,
          payload,
          x: slotLeft + padX,
          y: computeScrollTopForPage(p, metrics.stride) + padY,
          width: Math.max(10, metrics.slotWidth - padX * 2),
          height: Math.max(10, metrics.slotHeight - padY * 2),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    backdrop.setScene({theme, viewport, slots});
    const el = scrollRef.current;
    backdrop.setLiveOffset({
      x: el ? -el.scrollLeft : 0,
      y: el ? -el.scrollTop : -preciseScrollRef.current,
    });
  }, [backdrop, theme, viewport, metrics, visiblePages, loadedPages]);

  // Fetch visible window pages from LRU/IndexedDB and prune distant pages from RAM
  useEffect(() => {
    let active = true;
    for (const p of visiblePages) {
      if (!loadedPages[p]) {
        void fetchPage(p)
          .then((payload) => {
            if (!active) return;
            setLoadedPages((prev) => {
              const next: Record<number, MushafPagePayload> = {...prev, [p]: payload};
              for (const kStr of Object.keys(next)) {
                const k = Number(kStr);
                if (Math.abs(k - activePageRef.current) > 7) {
                  delete next[k];
                }
              }
              return next;
            });
          })
          .catch(() => {});
      }
    }
    return () => {
      active = false;
    };
  }, [visiblePages, loadedPages, fetchPage]);

  // Long-press Ayah detection & quick-tap handler within continuous scroll
  const pressRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startTime: number;
    timerId: number | null;
    longPressFired: boolean;
    page: number;
    ayah: RawAyahEntry | null;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    timerId: null,
    longPressFired: false,
    page: initialPage,
    ayah: null,
  });

  const clearTimer = () => {
    if (pressRef.current.timerId !== null) {
      window.clearTimeout(pressRef.current.timerId);
      pressRef.current.timerId = null;
    }
  };

  const resolveAyahInPage = (
    pagePayload: MushafPagePayload,
    svgEl: SVGSVGElement | null,
    clientX: number,
    clientY: number
  ): RawAyahEntry | null => {
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const viewBox = parseViewBox(pagePayload.svg, pagePayload.page, pagePayload.ayahs);
    const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
    const drawnW = viewBox.width * scale;
    const drawnH = viewBox.height * scale;
    const offsetX = rect.left + (rect.width - drawnW) / 2;
    const offsetY = rect.top + (rect.height - drawnH) / 2;
    const svgX = (clientX - offsetX) / scale + viewBox.minX;
    const svgY = (clientY - offsetY) / scale + viewBox.minY;
    return findAyahAtSvgPoint(pagePayload.ayahs, svgX, svgY);
  };

  const handlePagePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    pagePayload: MushafPagePayload | undefined
  ) => {
    if ((e.target as Element | null)?.closest('[data-ayah-menu="true"]')) {
      return;
    }
    clearTimer();
    const svgEl = e.currentTarget.querySelector('svg');
    const hitAyah = pagePayload ? resolveAyahInPage(pagePayload, svgEl, e.clientX, e.clientY) : null;
    const pageNum = pagePayload?.page ?? activePage;

    pressRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      timerId: null,
      longPressFired: false,
      page: pageNum,
      ayah: hitAyah,
    };

    if (hitAyah) {
      pressRef.current.timerId = window.setTimeout(() => {
        if (
          pressRef.current.pointerId === e.pointerId &&
          pressRef.current.ayah
        ) {
          pressRef.current.longPressFired = true;
          onLongPressAyah(pressRef.current.page, pressRef.current.ayah);
        }
      }, LONG_PRESS_DURATION_MS);
    }
  };

  const handlePagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressRef.current.pointerId !== e.pointerId) return;
    const dist = Math.hypot(
      e.clientX - pressRef.current.startX,
      e.clientY - pressRef.current.startY
    );
    if (dist > TAP_MOVE_TOLERANCE_PX) {
      clearTimer();
    }
  };

  const handlePagePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pressRef.current.pointerId !== e.pointerId) return;
    clearTimer();
    const {longPressFired, startX, startY, startTime} = pressRef.current;
    pressRef.current.pointerId = null;
    if (longPressFired) return;

    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    const elapsed = performance.now() - startTime;
    if (dist <= TAP_MOVE_TOLERANCE_PX && elapsed < LONG_PRESS_DURATION_MS) {
      onQuickTap();
    }
  };

  const horizontalOverflow = metrics.slotWidth > viewport.width + 1;

  return (
    <div
      ref={scrollRef}
      dir="ltr"
      onScroll={handleScroll}
      style={
        {
          '--mushaf-ink': theme.ink,
          '--mushaf-ornament': theme.ornament,
          '--mushaf-highlight': theme.highlight,
          touchAction: horizontalOverflow ? 'pan-x pan-y' : 'pan-y',
        } as React.CSSProperties
      }
      className={`mushaf-svg-stage relative w-full h-full overflow-y-auto liquid-glass-scroll ${
        horizontalOverflow ? 'overflow-x-auto' : 'overflow-x-hidden'
      }`}
    >
      <div
        className="relative mx-auto"
        style={{
          width: `${Math.max(viewport.width, metrics.slotWidth)}px`,
          height: `${metrics.totalHeight + DEFAULT_READING_INSETS.bottom + 24}px`,
        }}
      >
        {visiblePages.map((p) => {
          const payload = loadedPages[p];
          const topY = computeScrollTopForPage(p, metrics.stride);

          return (
            <ContinuousPageItem
              key={p}
              pageNumber={p}
              payload={payload}
              topY={topY}
              slotWidth={metrics.slotWidth}
              slotHeight={metrics.slotHeight}
              theme={theme}
              performanceProfile={performanceProfile}
              highlightedAyah={
                highlightedAyah && highlightedAyah.page === p ? highlightedAyah : null
              }
              contextMenuAyah={
                contextMenuTarget && contextMenuTarget.page === p
                  ? contextMenuTarget.ayah
                  : null
              }
              onPointerDown={(e) => handlePagePointerDown(e, payload)}
              onPointerMove={handlePagePointerMove}
              onPointerUp={handlePagePointerUp}
              onSaveBookmark={(ayah) => onSaveBookmark(p, ayah)}
              onOpenTafsir={(ayah) => onOpenTafsir(p, ayah)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface PageItemProps {
  pageNumber: number;
  payload: MushafPagePayload | undefined;
  topY: number;
  slotWidth: number;
  slotHeight: number;
  theme: MushafThemeConfig;
  performanceProfile: PerformanceProfile;
  highlightedAyah: {surahNumber: number; ayahNumber: number} | null;
  contextMenuAyah: RawAyahEntry | null;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSaveBookmark: (ayah: RawAyahEntry) => void;
  onOpenTafsir: (ayah: RawAyahEntry) => void;
}

function ContinuousPageItem({
  pageNumber,
  payload,
  topY,
  slotWidth,
  slotHeight,
  theme,
  performanceProfile,
  highlightedAyah,
  contextMenuAyah,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSaveBookmark,
  onOpenTafsir,
}: PageItemProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const framedSvg = useMemo(() => {
    if (!payload) return null;
    return applyViewBoxToSvg(payload.svg, payload.page, payload.ayahs);
  }, [payload]);

  const contextAnchor = useMemo(() => {
    if (!payload || !contextMenuAyah) return null;
    const vb = parseViewBox(payload.svg, payload.page, payload.ayahs);
    return getAyahAnchorNormalized(contextMenuAyah, vb);
  }, [payload, contextMenuAyah]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const polys = el.querySelectorAll<SVGPathElement>('path.ayahPolygon');
    polys.forEach((poly) => {
      const s = Number(poly.getAttribute('surah'));
      const a = Number(poly.getAttribute('ayah'));
      const active =
        highlightedAyah !== null &&
        highlightedAyah.surahNumber === s &&
        highlightedAyah.ayahNumber === a;
      poly.classList.toggle('is-selected', active);
    });
  }, [highlightedAyah, framedSvg]);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        top: `${topY}px`,
        width: `${slotWidth}px`,
        height: `${slotHeight}px`,
        left: '50%',
        transform: 'translate3d(-50%, 0, 0)',
      }}
      className="mushaf-gpu-layer absolute"
    >
      {framedSvg ? (
        <div
          ref={wrapperRef}
          className="w-full h-full px-1.5 py-6 sm:px-4 sm:py-7"
        >
          <div className="relative w-full h-full">
            <div
              className="w-full h-full"
              dangerouslySetInnerHTML={{__html: framedSvg}}
            />
            {highlightedAyah && payload && (
              <AyahGlassHighlightOverlay
                payload={payload}
                surahNumber={highlightedAyah.surahNumber}
                ayahNumber={highlightedAyah.ayahNumber}
                theme={theme}
              />
            )}
          </div>
        </div>
      ) : (
        <div
          style={{color: theme.muted}}
          className="w-full h-full flex items-center justify-center text-xs tabular-nums"
        >
          {toArabicIndic(pageNumber)}
        </div>
      )}

      {/* Subtle hairline divider between vertical stacked Mushaf pages */}
      <div
        aria-hidden="true"
        style={{borderColor: theme.border, color: theme.muted}}
        className="pointer-events-none absolute bottom-0 inset-x-6 border-b opacity-45 flex justify-center"
      >
        <span className="translate-y-1/2 px-2 text-[10px] tabular-nums" style={{backgroundColor: theme.bg}}>
          {toArabicIndic(pageNumber)}
        </span>
      </div>

      {contextMenuAyah && contextAnchor && (
        <AyahMiniActions
          xPct={contextAnchor.xPct}
          yPct={contextAnchor.yPct}
          performanceProfile={performanceProfile}
          onSaveBookmark={() => onSaveBookmark(contextMenuAyah)}
          onOpenTafsir={() => onOpenTafsir(contextMenuAyah)}
        />
      )}
    </div>
  );
}
