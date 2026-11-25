import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useMushafBackdrop} from '../contexts/MushafBackdropContext';
import {
  classifyPressRelease,
  evaluateCurlDragState,
  LONG_PRESS_DURATION_MS,
  resolveSinglePointerIntent,
  TAP_MOVE_TOLERANCE_PX,
  type ReadingInteractionMode,
} from '../lib/gestureEngine';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {AyahGlassHighlightOverlay} from './AyahGlassHighlightOverlay';
import {AyahMiniActions} from './AyahMiniActions';
import {
  applyViewBoxToSvg,
  findAyahAtSvgPoint,
  getAyahAnchorNormalized,
  parseViewBox,
} from '../lib/polygonUtils';
import {
  clampPan,
  clampZoom,
  computeBasePageLayout,
  computePanBounds,
  DEFAULT_READING_INSETS,
  reclampPanOnResize,
  zoomAroundFocalPoint,
  type PageBaseLayout,
  type PanOffset,
  type ViewportSize,
} from '../lib/zoomMath';
import {
  computePhysicalCurlGeometry,
  type PhysicalCurlGeometry,
} from '../lib/pageCurlMath';
import {
  toArabicIndic,
  type MushafPagePayload,
  type MushafThemeConfig,
  type RawAyahEntry,
} from '../types/mushaf';

interface CurlState {
  active: boolean;
  animating: boolean;
  direction: 'next' | 'prev';
  progress: number; // 0..1
  targetPage: number;
  startY: number;
  pointerY: number;
}

interface Props {
  pageData: MushafPagePayload;
  prevPageData: MushafPagePayload | null;
  nextPageData: MushafPagePayload | null;
  theme: MushafThemeConfig;
  zoom: number;
  pan: PanOffset;
  fitMode: 'contain' | 'fill-width';
  displayMode: 'single' | 'spread';
  performanceProfile: PerformanceProfile;
  highlightedAyah: RawAyahEntry | null;
  highlightedAyahPage?: number;
  contextMenuAyah: RawAyahEntry | null;
  contextMenuPage?: number;
  interactionMode: ReadingInteractionMode;
  onViewportLayoutChange: (viewport: ViewportSize, base: PageBaseLayout) => void;
  onZoomPanChange: (zoom: number, pan: PanOffset) => void;
  onInteractionModeChange: (mode: ReadingInteractionMode) => void;
  onQuickTapAyah: (ayah: RawAyahEntry | null) => void;
  onLongPressAyah: (ayah: RawAyahEntry, page: number) => void;
  onSaveBookmark: (ayah: RawAyahEntry, page: number) => void;
  onOpenTafsir: (ayah: RawAyahEntry, page: number) => void;
  onCommitPageTurn: (dir: 'next' | 'prev') => void;
  onPrefetchPage: (page: number) => void;
}

export function MushafSvgStage({
  pageData,
  prevPageData,
  nextPageData,
  theme,
  zoom,
  pan,
  fitMode,
  displayMode,
  performanceProfile,
  highlightedAyah,
  highlightedAyahPage,
  contextMenuAyah,
  contextMenuPage,
  interactionMode,
  onViewportLayoutChange,
  onZoomPanChange,
  onInteractionModeChange,
  onQuickTapAyah,
  onLongPressAyah,
  onSaveBookmark,
  onOpenTafsir,
  onCommitPageTurn,
  onPrefetchPage,
}: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);
  const rightSvgWrapperRef = useRef<HTMLDivElement | null>(null);
  const leftSvgWrapperRef = useRef<HTMLDivElement | null>(null);
  const backdrop = useMushafBackdrop();

  const [viewport, setViewport] = useState<ViewportSize>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  }));

  const [curlState, setCurlState] = useState<CurlState | null>(null);
  const [wheelZooming, setWheelZooming] = useState<boolean>(false);
  const [settledZoom, setSettledZoom] = useState<number>(zoom);
  const wheelSettleTimerRef = useRef<number | null>(null);

  const isZoomActive = interactionMode === 'zoom_pan' || wheelZooming;
  const isLightMode = performanceProfile === 'light';
  const isZoomSimplified = isZoomActive;

  useEffect(() => {
    if (!isZoomActive) {
      setSettledZoom(zoom);
    }
  }, [isZoomActive, zoom]);

  useEffect(() => {
    return () => {
      if (wheelSettleTimerRef.current !== null) {
        window.clearTimeout(wheelSettleTimerRef.current);
      }
    };
  }, []);

  const viewBox = useMemo(
    () => parseViewBox(pageData.svg, pageData.page, pageData.ayahs),
    [pageData.svg, pageData.page, pageData.ayahs]
  );

  const framedSvg = useMemo(
    () => applyViewBoxToSvg(pageData.svg, pageData.page, pageData.ayahs),
    [pageData.svg, pageData.page, pageData.ayahs]
  );

  const prevFramedSvg = useMemo(() => {
    if (!prevPageData) return null;
    return applyViewBoxToSvg(prevPageData.svg, prevPageData.page, prevPageData.ayahs);
  }, [prevPageData]);

  const nextFramedSvg = useMemo(() => {
    if (!nextPageData) return null;
    return applyViewBoxToSvg(nextPageData.svg, nextPageData.page, nextPageData.ayahs);
  }, [nextPageData]);

  const aspectRatio = viewBox.width / viewBox.height;
  const baseLayout = useMemo(
    () =>
      computeBasePageLayout(
        viewport,
        aspectRatio,
        fitMode,
        DEFAULT_READING_INSETS,
        displayMode
      ),
    [viewport, aspectRatio, fitMode, displayMode]
  );

  // Keep latest zoom/pan/base/viewport in refs for zero-lag gesture math
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const viewportRef = useRef(viewport);
  const baseLayoutRef = useRef(baseLayout);
  const interactionModeRef = useRef(interactionMode);

  zoomRef.current = zoom;
  panRef.current = pan;
  viewportRef.current = viewport;
  baseLayoutRef.current = baseLayout;
  interactionModeRef.current = interactionMode;

  // Measure stage & reclamp pan cleanly on resize / phone rotation without losing reading center
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const handleMeasure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const newVp: ViewportSize = {width: rect.width, height: rect.height};
      const oldVp = viewportRef.current;
      const oldBase = baseLayoutRef.current;
      const newBase = computeBasePageLayout(
        newVp,
        aspectRatio,
        fitMode,
        DEFAULT_READING_INSETS,
        displayMode
      );

      setViewport(newVp);
      onViewportLayoutChange(newVp, newBase);

      if (Math.abs(oldVp.width - newVp.width) > 1 || Math.abs(oldVp.height - newVp.height) > 1) {
        const reclamped = reclampPanOnResize({
          oldViewport: oldVp,
          newViewport: newVp,
          oldBase,
          newBase,
          oldPan: panRef.current,
          zoom: zoomRef.current,
          displayMode,
        });
        onZoomPanChange(zoomRef.current, reclamped);
      }
    };

    handleMeasure();
    const ro = new ResizeObserver(handleMeasure);
    ro.observe(el);
    window.addEventListener('orientationchange', handleMeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', handleMeasure);
    };
  }, [aspectRatio, fitMode, displayMode, onViewportLayoutChange, onZoomPanChange]);

  // Notify parent layout & reclamp pan synchronously before paint so page switches never jump 1 frame
  useLayoutEffect(() => {
    onViewportLayoutChange(viewport, baseLayout);
    const clamped = clampPan(panRef.current, viewport, baseLayout, zoomRef.current, displayMode);
    if (Math.abs(clamped.x - panRef.current.x) > 0.5 || Math.abs(clamped.y - panRef.current.y) > 0.5) {
      onZoomPanChange(zoomRef.current, clamped);
    }
  }, [viewport, baseLayout, displayMode, onViewportLayoutChange, onZoomPanChange]);

  const currentP = pageData.page;
  const isOdd = currentP % 2 !== 0;
  const rightPagePayload = isOdd ? pageData : prevPageData;
  const leftPagePayload = isOdd ? nextPageData : pageData;
  const rightPageNum = isOdd ? currentP : currentP - 1;
  const leftPageNum = isOdd ? currentP + 1 : currentP;

  const rightFramed = useMemo(() => {
    if (!rightPagePayload) return null;
    return applyViewBoxToSvg(rightPagePayload.svg, rightPagePayload.page, rightPagePayload.ayahs);
  }, [rightPagePayload]);

  const leftFramed = useMemo(() => {
    if (!leftPagePayload) return null;
    return applyViewBoxToSvg(leftPagePayload.svg, leftPagePayload.page, leftPagePayload.ayahs);
  }, [leftPagePayload]);

  // Sync polygon selection highlight class cleanly across both Single and Spread SVGs
  useEffect(() => {
    const syncWrapperHighlight = (el: HTMLDivElement | null, wrapperPage: number | undefined) => {
      if (!el || wrapperPage === undefined) return;
      const pageMatches =
        highlightedAyah !== null && (highlightedAyahPage ?? pageData.page) === wrapperPage;
      const polys = el.querySelectorAll<SVGPathElement>('path.ayahPolygon');
      polys.forEach((p) => {
        const s = Number(p.getAttribute('surah'));
        const a = Number(p.getAttribute('ayah'));
        const active =
          pageMatches &&
          highlightedAyah.surahNumber === s &&
          highlightedAyah.ayahNumber === a;
        p.classList.toggle('is-selected', active);
      });
    };

    if (displayMode === 'spread') {
      syncWrapperHighlight(rightSvgWrapperRef.current, rightPagePayload?.page);
      syncWrapperHighlight(leftSvgWrapperRef.current, leftPagePayload?.page);
    } else {
      syncWrapperHighlight(svgWrapperRef.current, pageData.page);
    }
  }, [
    displayMode,
    highlightedAyah,
    highlightedAyahPage,
    pageData.page,
    framedSvg,
    rightFramed,
    leftFramed,
    rightPagePayload?.page,
    leftPagePayload?.page,
  ]);

  const curlRafRef = useRef<number | null>(null);
  const cancelCurlRaf = useCallback(() => {
    if (curlRafRef.current !== null) {
      cancelAnimationFrame(curlRafRef.current);
      curlRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cancelCurlRaf();
  }, [cancelCurlRaf]);

  const animateCurlTo = useCallback(
    (
      direction: 'next' | 'prev',
      targetPage: number,
      fromProgress: number,
      commit: boolean,
      startY: number,
      fromPointerY: number
    ) => {
      if (performanceProfile === 'light') {
        cancelCurlRaf();
        setCurlState(null);
        if (commit) {
          onCommitPageTurn(direction);
        }
        onInteractionModeChange('normal');
        return;
      }

      cancelCurlRaf();
      const targetProgress = commit ? 1 : 0;
      const durationMs = commit ? 230 : 190;
      const startTime = performance.now();

      const tick = (now: number) => {
        const rawT = Math.min(1, (now - startTime) / durationMs);
        const eased = 1 - Math.pow(1 - rawT, 3);
        const progress = fromProgress + (targetProgress - fromProgress) * eased;
        const pointerY = fromPointerY + (startY - fromPointerY) * eased;

        setCurlState({
          active: true,
          animating: true,
          direction,
          progress,
          targetPage,
          startY,
          pointerY,
        });

        if (rawT < 1) {
          curlRafRef.current = requestAnimationFrame(tick);
        } else {
          curlRafRef.current = null;
          setCurlState(null);
          if (commit) {
            onCommitPageTurn(direction);
          }
          onInteractionModeChange('normal');
        }
      };

      curlRafRef.current = requestAnimationFrame(tick);
    },
    [cancelCurlRaf, onCommitPageTurn, onInteractionModeChange, performanceProfile]
  );

  // Desktop mouse wheel zoom (cursor-anchored) & Shift+Wheel pan
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      if (e.shiftKey) {
        const nextPan = clampPan(
          {x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY},
          viewportRef.current,
          baseLayoutRef.current,
          zoomRef.current,
          displayMode
        );
        onZoomPanChange(zoomRef.current, nextPan);
        return;
      }

      const deltaFactor = Math.exp(-e.deltaY * 0.0018);
      const targetZoom = clampZoom(zoomRef.current * deltaFactor);
      const result = zoomAroundFocalPoint({
        oldZoom: zoomRef.current,
        newZoom: targetZoom,
        oldPan: panRef.current,
        focalX: cursorX,
        focalY: cursorY,
        viewport: viewportRef.current,
        base: baseLayoutRef.current,
        displayMode,
      });

      onInteractionModeChange('zoom_pan');
      setWheelZooming(true);
      onZoomPanChange(result.zoom, result.pan);

      if (wheelSettleTimerRef.current !== null) {
        window.clearTimeout(wheelSettleTimerRef.current);
      }
      wheelSettleTimerRef.current = window.setTimeout(() => {
        wheelSettleTimerRef.current = null;
        setWheelZooming(false);
        onInteractionModeChange('normal');
      }, 150);
    };

    el.addEventListener('wheel', onWheel, {passive: false});
    return () => el.removeEventListener('wheel', onWheel);
  }, [displayMode, onZoomPanChange, onInteractionModeChange]);

  const pointersRef = useRef<Map<number, {x: number; y: number}>>(new Map());
  const pinchStateRef = useRef<{
    active: boolean;
    lastDist: number;
    lastMidX: number;
    lastMidY: number;
    lastEndedAt: number;
  }>({
    active: false,
    lastDist: 0,
    lastMidX: 0,
    lastMidY: 0,
    lastEndedAt: 0,
  });

  const singleRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    velocityX: number;
    startTime: number;
    intent: 'pending' | 'page_turn' | 'pan';
    longPressFired: boolean;
    timerId: number | null;
    targetAyah: RawAyahEntry | null;
    targetPage: number;
    curlTargetPage: number | null;
    curlDirection: 'next' | 'prev' | null;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    velocityX: 0,
    startTime: 0,
    intent: 'pending',
    longPressFired: false,
    timerId: null,
    targetAyah: null,
    targetPage: pageData.page,
    curlTargetPage: null,
    curlDirection: null,
  });

  const clearLongPressTimer = () => {
    if (singleRef.current.timerId !== null) {
      window.clearTimeout(singleRef.current.timerId);
      singleRef.current.timerId = null;
    }
  };

  const hitTestWrapperAyah = (
    wrapperEl: HTMLDivElement | null,
    payload: MushafPagePayload | null,
    clientX: number,
    clientY: number
  ): {ayah: RawAyahEntry; page: number} | null => {
    if (!wrapperEl || !payload) return null;
    const svgEl = wrapperEl.querySelector('svg');
    if (!svgEl) return null;

    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }

    const vb = parseViewBox(payload.svg, payload.page, payload.ayahs);
    const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
    const drawnW = vb.width * scale;
    const drawnH = vb.height * scale;
    const offsetX = rect.left + (rect.width - drawnW) / 2;
    const offsetY = rect.top + (rect.height - drawnH) / 2;

    const svgX = (clientX - offsetX) / scale + vb.minX;
    const svgY = (clientY - offsetY) / scale + vb.minY;

    const ayah = findAyahAtSvgPoint(payload.ayahs, svgX, svgY);
    return ayah ? {ayah, page: payload.page} : null;
  };

  const resolveAyahFromEvent = (
    clientX: number,
    clientY: number
  ): {ayah: RawAyahEntry; page: number} | null => {
    if (displayMode === 'spread') {
      return (
        hitTestWrapperAyah(rightSvgWrapperRef.current, rightPagePayload, clientX, clientY) ??
        hitTestWrapperAyah(leftSvgWrapperRef.current, leftPagePayload, clientX, clientY)
      );
    }
    return hitTestWrapperAyah(svgWrapperRef.current, pageData, clientX, clientY);
  };

  const getTwoPointers = () => {
    const entries = Array.from(pointersRef.current.values());
    if (entries.length < 2) return null;
    const p1 = entries[0];
    const p2 = entries[1];
    return {
      dist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element | null)?.closest('[data-ayah-menu="true"]')) {
      return;
    }

    if (curlState?.animating) {
      cancelCurlRaf();
      const pendingDir = curlState.direction;
      const wasCommitting = curlState.progress >= 0.45;
      setCurlState(null);
      if (wasCommitting) {
        onCommitPageTurn(pendingDir);
      }
    }

    const rect = stageRef.current?.getBoundingClientRect();
    const localX = rect ? e.clientX - rect.left : e.clientX;
    const localY = rect ? e.clientY - rect.top : e.clientY;
    pointersRef.current.set(e.pointerId, {x: localX, y: localY});

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic pointers
    }

    if (pointersRef.current.size >= 2) {
      clearLongPressTimer();
      singleRef.current.pointerId = null;
      if (curlState?.active && !curlState.animating) {
        setCurlState(null);
      }
      const pair = getTwoPointers();
      if (pair) {
        pinchStateRef.current = {
          active: true,
          lastDist: pair.dist,
          lastMidX: pair.midX,
          lastMidY: pair.midY,
          lastEndedAt: pinchStateRef.current.lastEndedAt,
        };
        onInteractionModeChange('zoom_pan');
      }
      return;
    }

    clearLongPressTimer();
    const hit = resolveAyahFromEvent(e.clientX, e.clientY);
    const now = performance.now();

    singleRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastTime: now,
      velocityX: 0,
      startTime: now,
      intent: 'pending',
      longPressFired: false,
      timerId: null,
      targetAyah: hit?.ayah ?? null,
      targetPage: hit?.page ?? pageData.page,
      curlTargetPage: null,
      curlDirection: null,
    };

    if (hit) {
      singleRef.current.timerId = window.setTimeout(() => {
        if (
          singleRef.current.pointerId === e.pointerId &&
          singleRef.current.intent === 'pending' &&
          singleRef.current.targetAyah
        ) {
          singleRef.current.longPressFired = true;
          onLongPressAyah(singleRef.current.targetAyah, singleRef.current.targetPage);
        }
      }, LONG_PRESS_DURATION_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;

    const rect = stageRef.current?.getBoundingClientRect();
    const localX = rect ? e.clientX - rect.left : e.clientX;
    const localY = rect ? e.clientY - rect.top : e.clientY;
    pointersRef.current.set(e.pointerId, {x: localX, y: localY});

    // 1. Two-finger pinch & pan
    if (pointersRef.current.size >= 2 && pinchStateRef.current.active) {
      const pair = getTwoPointers();
      if (!pair) return;

      const scaleDelta = pair.dist / pinchStateRef.current.lastDist;
      const targetZoom = clampZoom(zoomRef.current * scaleDelta);

      const panWithDrag: PanOffset = {
        x: panRef.current.x + (pair.midX - pinchStateRef.current.lastMidX),
        y: panRef.current.y + (pair.midY - pinchStateRef.current.lastMidY),
      };

      const result = zoomAroundFocalPoint({
        oldZoom: zoomRef.current,
        newZoom: targetZoom,
        oldPan: panWithDrag,
        focalX: pair.midX,
        focalY: pair.midY,
        viewport: viewportRef.current,
        base: baseLayoutRef.current,
        displayMode,
      });

      pinchStateRef.current.lastDist = pair.dist;
      pinchStateRef.current.lastMidX = pair.midX;
      pinchStateRef.current.lastMidY = pair.midY;

      onZoomPanChange(result.zoom, result.pan);
      return;
    }

    // 2. Single-pointer pan / 3D page curl
    const st = singleRef.current;
    if (st.pointerId !== e.pointerId || pinchStateRef.current.active) return;

    if (performance.now() - pinchStateRef.current.lastEndedAt < 160) return;

    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    const dist = Math.hypot(dx, dy);

    if (dist > TAP_MOVE_TOLERANCE_PX) {
      clearLongPressTimer();
    }

    const now = performance.now();
    const dt = Math.max(4, now - st.lastTime);
    const stepDx = e.clientX - st.lastX;
    const stepDy = e.clientY - st.lastY;
    st.velocityX = stepDx / dt;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.lastTime = now;

    if (st.intent === 'pending') {
      const bounds = computePanBounds(
        viewportRef.current,
        baseLayoutRef.current,
        zoomRef.current,
        displayMode
      );
      const hasHorizontalPanRoom = bounds.maxX - bounds.minX > 2;
      const hasVerticalScrollRoom = bounds.maxY - bounds.minY > 2;

      const nextIntent = resolveSinglePointerIntent({
        startX: rect ? st.startX - rect.left : st.startX,
        dx,
        dy,
        viewportWidth: viewportRef.current.width,
        hasHorizontalPanRoom,
        hasVerticalScrollRoom,
      });

      if (nextIntent === 'pending') {
        if (Math.abs(dx) >= TAP_MOVE_TOLERANCE_PX && Math.abs(dx) > Math.abs(dy) * 1.25) {
          st.intent = 'page_turn';
        } else {
          return;
        }
      } else {
        st.intent = nextIntent;
      }

      if (st.intent === 'page_turn') {
        onInteractionModeChange('page_turn');
        const dir: 'next' | 'prev' = dx > 0 ? 'next' : 'prev';
        const step = displayMode === 'spread' ? 2 : 1;
        const targetPage = dir === 'next' ? pageData.page + step : pageData.page - step;
        if (targetPage >= 1 && targetPage <= 604) {
          st.curlDirection = dir;
          st.curlTargetPage = targetPage;
          onPrefetchPage(targetPage);
        }
      } else if (st.intent === 'pan') {
        onInteractionModeChange('zoom_pan');
      }
    }

    if (st.intent === 'pan') {
      const nextPan = clampPan(
        {
          x: panRef.current.x + stepDx,
          y: panRef.current.y + stepDy,
        },
        viewportRef.current,
        baseLayoutRef.current,
        zoomRef.current,
        displayMode
      );
      onZoomPanChange(zoomRef.current, nextPan);
      return;
    }

    if (st.intent === 'page_turn') {
      const decision = evaluateCurlDragState({
        dx,
        viewportWidth: viewportRef.current.width,
        velocityXPxPerMs: st.velocityX,
        canGoNext: displayMode === 'spread' ? leftPageNum < 604 : pageData.page < 604,
        canGoPrev: displayMode === 'spread' ? rightPageNum > 1 : pageData.page > 1,
      });

      if (!decision) {
        setCurlState(null);
        return;
      }

      if (displayMode === 'spread') {
        return;
      }

      const targetPage = decision.direction === 'next' ? pageData.page + 1 : pageData.page - 1;
      if (st.curlTargetPage !== targetPage) {
        st.curlTargetPage = targetPage;
        st.curlDirection = decision.direction;
        onPrefetchPage(targetPage);
      }

      const startLocalY = rect ? st.startY - rect.top : viewportRef.current.height * 0.5;
      setCurlState({
        active: true,
        animating: false,
        direction: decision.direction,
        progress: decision.progress,
        targetPage,
        startY: startLocalY,
        pointerY: localY,
      });
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    pointersRef.current.delete(e.pointerId);

    if (pinchStateRef.current.active && pointersRef.current.size < 2) {
      pinchStateRef.current.active = false;
      pinchStateRef.current.lastEndedAt = performance.now();
      if (pointersRef.current.size === 0) {
        onInteractionModeChange('normal');
      }
    }

    const st = singleRef.current;
    if (st.pointerId !== e.pointerId) return;
    clearLongPressTimer();
    st.pointerId = null;

    if (st.longPressFired) {
      return;
    }

    if (st.intent === 'page_turn') {
      const dx = e.clientX - st.startX;
      const decision = evaluateCurlDragState({
        dx,
        viewportWidth: viewportRef.current.width,
        velocityXPxPerMs: st.velocityX,
        canGoNext: displayMode === 'spread' ? leftPageNum < 604 : pageData.page < 604,
        canGoPrev: displayMode === 'spread' ? rightPageNum > 1 : pageData.page > 1,
      });

      if (displayMode === 'spread') {
        if (decision && !cancelled && decision.commit) {
          onCommitPageTurn(decision.direction);
        }
        setCurlState(null);
        onInteractionModeChange('normal');
        return;
      }

      if (decision) {
        const rect = stageRef.current?.getBoundingClientRect();
        const startLocalY = rect ? st.startY - rect.top : viewportRef.current.height * 0.5;
        const pointerLocalY = rect ? e.clientY - rect.top : startLocalY;
        const targetPage = decision.direction === 'next' ? pageData.page + 1 : pageData.page - 1;
        animateCurlTo(
          decision.direction,
          targetPage,
          decision.progress,
          !cancelled && decision.commit,
          startLocalY,
          pointerLocalY
        );
      } else {
        setCurlState(null);
        onInteractionModeChange('normal');
      }
      return;
    }

    if (st.intent === 'pan') {
      if (interactionModeRef.current === 'zoom_pan') {
        onInteractionModeChange('normal');
      }
      return;
    }

    if (cancelled || performance.now() - pinchStateRef.current.lastEndedAt < 180) {
      return;
    }

    const moveDist = Math.hypot(e.clientX - st.startX, e.clientY - st.startY);
    const elapsed = performance.now() - st.startTime;
    const releaseType = classifyPressRelease(elapsed, moveDist);

    if (releaseType === 'quick-tap') {
      onQuickTapAyah(st.targetAyah);
    } else if (releaseType === 'long-press' && st.targetAyah) {
      onLongPressAyah(st.targetAyah, st.targetPage);
    }
  };

  const activeContextPage = contextMenuPage ?? pageData.page;
  const contextAnchor = useMemo(() => {
    if (!contextMenuAyah) return null;
    if (displayMode === 'spread') {
      const targetPayload =
        rightPagePayload?.page === activeContextPage
          ? rightPagePayload
          : leftPagePayload?.page === activeContextPage
          ? leftPagePayload
          : pageData;
      const vb = parseViewBox(targetPayload.svg, targetPayload.page, targetPayload.ayahs);
      return getAyahAnchorNormalized(contextMenuAyah, vb);
    }
    return getAyahAnchorNormalized(contextMenuAyah, viewBox);
  }, [
    contextMenuAyah,
    displayMode,
    activeContextPage,
    rightPagePayload,
    leftPagePayload,
    pageData,
    viewBox,
  ]);

  const activeCurl = performanceProfile === 'light' ? null : (curlState?.active ? curlState : null);
  const isCurlingNext = activeCurl?.direction === 'next';
  const isCurlingPrev = activeCurl?.direction === 'prev';
  const curlP = activeCurl?.progress ?? 0;

  const pageBackgroundStyle = theme.bgGradient
    ? {backgroundColor: theme.bg, backgroundImage: theme.bgGradient}
    : {backgroundColor: theme.bg};

  const zoomedWidth = Math.round(baseLayout.baseWidth * zoom * 100) / 100;
  const zoomedHeight = Math.round(baseLayout.baseHeight * zoom * 100) / 100;

  const effectivePan = useMemo(
    () => clampPan(pan, viewport, baseLayout, zoom, displayMode),
    [pan, viewport, baseLayout, zoom, displayMode]
  );

  const svgPadX = viewport.width >= 640 ? 16 : 6;
  const svgPadY = viewport.width >= 640 ? 24 : 20;
  const spreadGap = viewport.width >= 640 ? 16 : 10;

  // Render helper for an adjacent Mushaf leaf during physical curl transition:
  // uses target page's own aspect ratio, safe reading insets, padding, and clamped pan so
  // position & scale match steady state to 0.0px when the animation completes.
  const renderAdjacentLeaf = (
    svgHtml: string | null,
    targetPayload: MushafPagePayload | null,
    pageNum: number
  ) => {
    const targetVb = targetPayload
      ? parseViewBox(targetPayload.svg, targetPayload.page, targetPayload.ayahs)
      : null;
    const targetAspect =
      targetVb && targetVb.width > 0 && targetVb.height > 0
        ? targetVb.width / targetVb.height
        : 345 / 550;
    const targetBase = computeBasePageLayout(
      viewport,
      targetAspect,
      fitMode,
      DEFAULT_READING_INSETS,
      'single'
    );
    const targetZoom = zoom;
    const targetPan = clampPan(pan, viewport, targetBase, targetZoom, 'single');
    const targetW = Math.round(targetBase.baseWidth * targetZoom * 100) / 100;
    const targetH = Math.round(targetBase.baseHeight * targetZoom * 100) / 100;

    return (
      <div
        dir="ltr"
        style={{
          ...pageBackgroundStyle,
          width: '100%',
          height: '100%',
        }}
        className="relative overflow-hidden"
      >
        {svgHtml ? (
          <div
            style={{
              width: `${targetW}px`,
              height: `${targetH}px`,
              padding: `${svgPadY * targetZoom}px ${svgPadX * targetZoom}px`,
              transformOrigin: '0 0',
              transform: `translate3d(${targetPan.x}px, ${targetPan.y}px, 0)`,
            }}
            className="mushaf-gpu-layer absolute top-0 left-0"
            dangerouslySetInnerHTML={{__html: svgHtml}}
          />
        ) : (
          <div
            style={{color: theme.muted}}
            className="w-full h-full flex items-center justify-center text-sm tabular-nums"
          >
            {toArabicIndic(pageNum)}
          </div>
        )}
      </div>
    );
  };

  const physicalCurl: PhysicalCurlGeometry | null = useMemo(() => {
    if (!activeCurl || displayMode !== 'single') return null;
    return computePhysicalCurlGeometry({
      width: viewport.width,
      height: viewport.height,
      direction: activeCurl.direction,
      progress: curlP,
      startY: activeCurl.startY,
      pointerY: activeCurl.pointerY,
    });
  }, [activeCurl, displayMode, viewport.width, viewport.height, curlP]);

  const curlDiagPx = useMemo(
    () => Math.ceil(Math.hypot(viewport.width, viewport.height) * 1.4),
    [viewport.width, viewport.height]
  );
  const isDarkPaper = theme.id === 'classic-dark';

  // Publish live Mushaf scene geometry for synchronized optical glass refraction
  useLayoutEffect(() => {
    if (!backdrop || !backdrop.enabled) return;

    if (displayMode === 'spread') {
      const innerW = Math.max(10, zoomedWidth - svgPadX * 2);
      const innerH = Math.max(10, zoomedHeight - svgPadY * 2);
      const slots = [];
      if (rightPagePayload) {
        slots.push({
          key: `spread-r-${rightPagePayload.page}`,
          page: rightPagePayload.page,
          payload: rightPagePayload,
          x: zoomedWidth + spreadGap + svgPadX,
          y: svgPadY,
          width: innerW,
          height: innerH,
        });
      }
      if (leftPagePayload) {
        slots.push({
          key: `spread-l-${leftPagePayload.page}`,
          page: leftPagePayload.page,
          payload: leftPagePayload,
          x: svgPadX,
          y: svgPadY,
          width: innerW,
          height: innerH,
        });
      }
      backdrop.setScene({theme, viewport, slots});
      return;
    }

    const scaledPadX = svgPadX * zoom;
    const scaledPadY = svgPadY * zoom;
    const singleInnerW = Math.max(10, zoomedWidth - scaledPadX * 2);
    const singleInnerH = Math.max(10, zoomedHeight - scaledPadY * 2);

    backdrop.setScene({
      theme,
      viewport,
      slots: [
        {
          key: `single-${pageData.page}`,
          page: pageData.page,
          payload: pageData,
          x: scaledPadX,
          y: scaledPadY,
          width: singleInnerW,
          height: singleInnerH,
        },
      ],
    });
  }, [
    backdrop,
    theme,
    viewport,
    displayMode,
    pageData,
    rightPagePayload,
    leftPagePayload,
    zoom,
    zoomedWidth,
    zoomedHeight,
    svgPadX,
    svgPadY,
    spreadGap,
  ]);

  // High-frequency pan sync with zero React re-renders of backdrop consumers
  useLayoutEffect(() => {
    if (!backdrop || !backdrop.enabled) return;
    backdrop.setLiveOffset(effectivePan);
  }, [backdrop, effectivePan]);

  // Hardware-accelerated GPU transform with zero layout jump or shrink:
  // - Light Mode keeps SVG at base 1x resolution and scales smoothly via GPU scale3d
  // - Performance Mode locks renderScale to settledZoom during active gestures (zero DOM resize/shrink)
  //   while simplifying SVG geometry, then commits crisp 1:1 vector detail when settled.
  const renderScale = isLightMode ? 1 : isZoomActive ? settledZoom : zoom;
  const gpuScale = zoom / Math.max(0.1, renderScale);
  const canvasWidth = Math.round(baseLayout.baseWidth * renderScale * 100) / 100;
  const canvasHeight = Math.round(baseLayout.baseHeight * renderScale * 100) / 100;

  if (displayMode === 'spread') {
    const totalSpreadW = zoomedWidth * 2 + spreadGap;

    return (
      <div
        ref={stageRef}
        dir="rtl"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        style={
          {
            '--mushaf-ink': theme.ink,
            '--mushaf-ornament': theme.ornament,
            '--mushaf-highlight': theme.highlight,
            touchAction: 'none',
          } as React.CSSProperties
        }
        className={`mushaf-svg-stage relative w-full h-full overflow-hidden ${
          isZoomSimplified ? 'mushaf-zoom-simplified' : ''
        }`}
      >
        <div
          style={{
            width: `${totalSpreadW}px`,
            height: `${zoomedHeight}px`,
            gap: `${spreadGap}px`,
            transformOrigin: '0 0',
            transform: `translate3d(${effectivePan.x}px, ${effectivePan.y}px, 0)`,
            willChange: 'transform',
          }}
          dir="rtl"
          className="mushaf-gpu-layer absolute top-0 left-0 flex items-center"
        >
          {/* Right Page (Odd page: 1, 3...) */}
          <div
            style={{
              ...pageBackgroundStyle,
              width: `${zoomedWidth}px`,
              height: `${zoomedHeight}px`,
            }}
            className="relative overflow-hidden rounded-xl border border-black/10 shadow-lg shrink-0"
          >
            <div
              ref={rightSvgWrapperRef}
              style={{
                padding: `${svgPadY}px ${svgPadX}px`,
              }}
              className="w-full h-full"
            >
              {rightFramed ? (
                <div className="relative w-full h-full">
                  <div
                    className="w-full h-full"
                    dangerouslySetInnerHTML={{__html: rightFramed}}
                  />
                  {highlightedAyah &&
                    rightPagePayload &&
                    (highlightedAyahPage ?? pageData.page) === rightPagePayload.page && (
                      <AyahGlassHighlightOverlay
                        payload={rightPagePayload}
                        surahNumber={highlightedAyah.surahNumber}
                        ayahNumber={highlightedAyah.ayahNumber}
                        theme={theme}
                      />
                    )}
                </div>
              ) : (
                <div style={{color: theme.muted}} className="w-full h-full flex items-center justify-center text-xs tabular-nums">
                  {toArabicIndic(rightPageNum)}
                </div>
              )}
            </div>
            {contextMenuAyah && contextAnchor && rightPagePayload?.page === activeContextPage && (
              <AyahMiniActions
                xPct={contextAnchor.xPct}
                yPct={contextAnchor.yPct}
                performanceProfile={performanceProfile}
                onSaveBookmark={() => onSaveBookmark(contextMenuAyah, rightPagePayload.page)}
                onOpenTafsir={() => onOpenTafsir(contextMenuAyah, rightPagePayload.page)}
              />
            )}
          </div>

          {/* Left Page (Even page: 2, 4...) */}
          <div
            style={{
              ...pageBackgroundStyle,
              width: `${zoomedWidth}px`,
              height: `${zoomedHeight}px`,
            }}
            className="relative overflow-hidden rounded-xl border border-black/10 shadow-lg shrink-0"
          >
            <div
              ref={leftSvgWrapperRef}
              style={{
                padding: `${svgPadY}px ${svgPadX}px`,
              }}
              className="w-full h-full"
            >
              {leftFramed ? (
                <div className="relative w-full h-full">
                  <div
                    className="w-full h-full"
                    dangerouslySetInnerHTML={{__html: leftFramed}}
                  />
                  {highlightedAyah &&
                    leftPagePayload &&
                    (highlightedAyahPage ?? pageData.page) === leftPagePayload.page && (
                      <AyahGlassHighlightOverlay
                        payload={leftPagePayload}
                        surahNumber={highlightedAyah.surahNumber}
                        ayahNumber={highlightedAyah.ayahNumber}
                        theme={theme}
                      />
                    )}
                </div>
              ) : (
                <div style={{color: theme.muted}} className="w-full h-full flex items-center justify-center text-xs tabular-nums">
                  {toArabicIndic(leftPageNum)}
                </div>
              )}
            </div>
            {contextMenuAyah && contextAnchor && leftPagePayload?.page === activeContextPage && (
              <AyahMiniActions
                xPct={contextAnchor.xPct}
                yPct={contextAnchor.yPct}
                performanceProfile={performanceProfile}
                onSaveBookmark={() => onSaveBookmark(contextMenuAyah, leftPagePayload.page)}
                onOpenTafsir={() => onOpenTafsir(contextMenuAyah, leftPagePayload.page)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      dir="rtl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      style={
        {
          '--mushaf-ink': theme.ink,
          '--mushaf-ornament': theme.ornament,
          '--mushaf-highlight': theme.highlight,
          touchAction: 'none',
        } as React.CSSProperties
      }
      className={`mushaf-svg-stage mushaf-curl-perspective relative w-full h-full overflow-hidden ${
        isZoomSimplified ? 'mushaf-zoom-simplified' : ''
      }`}
    >
      {/* Layer 1 (z-0): Revealed left-side page when advancing next */}
      {isCurlingNext && activeCurl && (
        <div className="absolute inset-0 z-0 pointer-events-none">
          {renderAdjacentLeaf(nextFramedSvg, nextPageData, activeCurl.targetPage)}
        </div>
      )}

      {/* Layer 2 (z-10): Active flat page (or returning flat right side when curling prev) */}
      <div
        className="absolute inset-0 z-10"
        style={
          physicalCurl && isCurlingNext
            ? {
                ...pageBackgroundStyle,
                clipPath: physicalCurl.frontClipPath,
                WebkitClipPath: physicalCurl.frontClipPath,
              }
            : physicalCurl && isCurlingPrev
            ? pageBackgroundStyle
            : undefined
        }
      >
        {/* Hardware-accelerated GPU canvas: invariant layout size during gestures, 1:1 vector commit on settle */}
        <div
          style={{
            width: `${canvasWidth}px`,
            height: `${canvasHeight}px`,
            transformOrigin: '0 0',
            transform: `translate3d(${effectivePan.x}px, ${effectivePan.y}px, 0) scale3d(${gpuScale}, ${gpuScale}, 1)`,
            willChange: 'transform',
          }}
          className="mushaf-gpu-layer absolute top-0 left-0"
        >
          <div
            ref={svgWrapperRef}
            style={{
              padding: `${svgPadY * renderScale}px ${svgPadX * renderScale}px`,
            }}
            className="w-full h-full"
          >
            <div className="relative w-full h-full">
              <div
                className="w-full h-full"
                dangerouslySetInnerHTML={{__html: framedSvg}}
              />
              {highlightedAyah &&
                (highlightedAyahPage ?? pageData.page) === pageData.page && (
                  <AyahGlassHighlightOverlay
                    payload={pageData}
                    surahNumber={highlightedAyah.surahNumber}
                    ayahNumber={highlightedAyah.ayahNumber}
                    theme={theme}
                  />
                )}
            </div>
          </div>
        </div>

        {/* Unscaled 1:1 overlay for Ayah mini-actions so controls stay crisp across any GPU scale */}
        {contextMenuAyah && contextAnchor && (
          <div
            style={{
              width: `${zoomedWidth}px`,
              height: `${zoomedHeight}px`,
              transform: `translate3d(${effectivePan.x}px, ${effectivePan.y}px, 0)`,
              willChange: 'transform',
            }}
            className="pointer-events-none absolute top-0 left-0 [&>*]:pointer-events-auto"
          >
            <AyahMiniActions
              xPct={contextAnchor.xPct}
              yPct={contextAnchor.yPct}
              performanceProfile={performanceProfile}
              onSaveBookmark={() => onSaveBookmark(contextMenuAyah, pageData.page)}
              onOpenTafsir={() => onOpenTafsir(contextMenuAyah, pageData.page)}
            />
          </div>
        )}

        {/* Ambient shadow on revealed left side when advancing next, or on front lifting edge */}
        {physicalCurl && isCurlingNext && (
          <div
            className="pointer-events-none absolute top-0 left-0"
            style={{
              width: '28px',
              height: `${curlDiagPx * 2}px`,
              transformOrigin: '0 0',
              transform: `translate3d(${physicalCurl.creasePoint.x}px, ${physicalCurl.creasePoint.y}px, 0) rotate(${physicalCurl.angleDeg}deg) translate3d(0px, -${curlDiagPx}px, 0)`,
              background: isDarkPaper
                ? 'linear-gradient(to right, rgba(0, 0, 0, 0.34) 0%, transparent 100%)'
                : 'linear-gradient(to right, rgba(35, 25, 10, 0.16) 0%, transparent 100%)',
            }}
          />
        )}
      </div>

      {/* Returning flat right side of previous page when pulling back from right spine (dx < 0 -> prev) */}
      {physicalCurl && isCurlingPrev && activeCurl && (
        <div
          className="absolute inset-0 z-[15] pointer-events-none"
          style={{
            clipPath: physicalCurl.frontClipPath,
            WebkitClipPath: physicalCurl.frontClipPath,
          }}
        >
          {renderAdjacentLeaf(prevFramedSvg, prevPageData, activeCurl.targetPage)}
        </div>
      )}

      {/* Soft directional cast shadow falling onto revealed/underneath left side from the lifted curl */}
      {physicalCurl && (
        <div
          className="pointer-events-none absolute top-0 left-0 z-[18]"
          style={{
            width: `${physicalCurl.castShadowPx}px`,
            height: `${curlDiagPx * 2}px`,
            transformOrigin: '0 0',
            transform: `translate3d(${physicalCurl.creasePoint.x}px, ${physicalCurl.creasePoint.y}px, 0) rotate(${physicalCurl.angleDeg}deg) translate3d(-${physicalCurl.castShadowPx}px, -${curlDiagPx}px, 0)`,
            background: isDarkPaper
              ? 'linear-gradient(to left, rgba(0, 0, 0, 0.56) 0%, rgba(0, 0, 0, 0.24) 42%, transparent 100%)'
              : 'linear-gradient(to left, rgba(24, 18, 8, 0.32) 0%, rgba(24, 18, 8, 0.10) 45%, transparent 100%)',
          }}
        />
      )}

      {/* Layer 3 (z-20): Physical curled back-of-paper flap with mirrored calligraphy & cylindrical shading */}
      {physicalCurl && physicalCurl.hasBackFlap && activeCurl && (
        <div
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
          style={{
            filter: isDarkPaper
              ? 'drop-shadow(4px 2px 12px rgba(0, 0, 0, 0.58))'
              : 'drop-shadow(4px 2px 10px rgba(24, 18, 8, 0.26))',
          }}
        >
          <div
            className="absolute top-0 left-0 w-full h-full overflow-hidden"
            style={{
              ...pageBackgroundStyle,
              clipPath: physicalCurl.backClipPath,
              WebkitClipPath: physicalCurl.backClipPath,
              transformOrigin: '0 0',
              transform: physicalCurl.reflectMatrixCss,
              willChange: 'transform, clip-path',
            }}
          >
            {/* Mirrored page calligraphy showing faintly through the paper back */}
            <div className="w-full h-full opacity-[0.26]">
              {isCurlingNext
                ? renderAdjacentLeaf(framedSvg, pageData, pageData.page)
                : renderAdjacentLeaf(prevFramedSvg, prevPageData, activeCurl.targetPage)}
            </div>

            {/* Translucent back-of-paper tint */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: isDarkPaper
                  ? 'rgba(18, 17, 14, 0.42)'
                  : 'rgba(232, 223, 202, 0.36)',
              }}
            />

            {/* Cylindrical 3D paper-roll ridge shading along the fold crease */}
            <div
              className="pointer-events-none absolute top-0 left-0"
              style={{
                width: `${physicalCurl.tubeWidthPx}px`,
                height: `${curlDiagPx * 2}px`,
                transformOrigin: '0 0',
                transform: `translate3d(${physicalCurl.creasePoint.x}px, ${physicalCurl.creasePoint.y}px, 0) rotate(${physicalCurl.angleDeg}deg) translate3d(-${physicalCurl.tubeWidthPx}px, -${curlDiagPx}px, 0)`,
                background: isDarkPaper
                  ? 'linear-gradient(to left, rgba(0, 0, 0, 0.55) 0%, rgba(255, 255, 255, 0.085) 28%, rgba(0, 0, 0, 0.36) 66%, rgba(0, 0, 0, 0.12) 100%)'
                  : 'linear-gradient(to left, rgba(45, 34, 18, 0.26) 0%, rgba(255, 252, 245, 0.52) 28%, rgba(45, 34, 18, 0.18) 66%, rgba(45, 34, 18, 0.04) 100%)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
