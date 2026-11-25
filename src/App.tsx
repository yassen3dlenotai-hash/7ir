import {CheckCircle2} from 'lucide-react';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {AutoScrollPill, type AutoScrollSpeed} from './components/AutoScrollPill';
import {BookmarksFloatingPanel} from './components/BookmarksFloatingPanel';
import {BottomControlDock, type DockAction} from './components/BottomControlDock';
import {ContinuousMushafStage} from './components/ContinuousMushafStage';
import {FloatingSettingsSheet} from './components/FloatingSettingsSheet';
import {LiquidGlassSurface} from './components/LiquidGlassSurface';
import {MushafSvgStage} from './components/MushafSvgStage';
import {QuranSearchPanel} from './components/QuranSearchPanel';
import {RecitationFloatingPanel} from './components/RecitationFloatingPanel';
import {TafsirFloatingCard} from './components/TafsirFloatingCard';
import {PerformanceSetupModal} from './components/PerformanceSetupModal';
import {MushafBackdropProvider} from './contexts/MushafBackdropContext';
import {useOnlineStatus} from './hooks/usePWAInstall';
import {createProgressBookmark} from './lib/bookmarks';
import type {ReadingInteractionMode} from './lib/gestureEngine';
import {
  buildKhatmahCompletionMessage,
  completeTodayKhatmahWird,
  computeKhatmahStatus,
  evaluateKhatmahAutoCompletion,
  formatKhatmahPagesPhrase,
  loadKhatmahPlan,
  saveKhatmahPlan,
  type KhatmahPlan,
} from './lib/khatmah';
import type {RecitationAlignmentReport} from './lib/recitationAligner';
import {LIQUID_GLASS} from './lib/liquidGlass';
import {parseViewBox} from './lib/polygonUtils';
import {
  loadPerformanceProfile,
  savePerformanceProfile,
  type PerformanceProfile,
} from './lib/performanceProfile';
import {
  createReadingPositionForPage,
  loadReadingPosition,
  resolveClosestAyahAtPageRatio,
  saveReadingPosition,
  type ReadingPosition,
} from './lib/readingPosition';
import {
  deleteBookmarkById,
  getAllBookmarks,
  loadPageResilient,
  loadReadingSettings,
  MushafLruCache,
  saveBookmark,
  saveReadingSettings,
} from './lib/mushafStore';
import {
  clampPan,
  computeBasePageLayout,
  DEFAULT_READING_INSETS,
  getSpreadGapForViewport,
  zoomAroundFocalPoint,
  type PageBaseLayout,
  type PanOffset,
  type ViewportSize,
} from './lib/zoomMath';
import {
  getPageMeta,
  getSurah,
  MUSHAF_THEMES,
  toArabicIndic,
  type MushafPagePayload,
  type ProgressBookmark,
  type RawAyahEntry,
  type ReadingSettings,
  type TafsirAyahItem,
} from './types/mushaf';

export default function App() {
  const [settings, setSettings] = useState<ReadingSettings>(() => loadReadingSettings());
  const [performanceProfile, setPerformanceProfile] = useState<PerformanceProfile>(() => {
    return loadPerformanceProfile() ?? 'performance';
  });
  const [showPerformanceModal, setShowPerformanceModal] = useState<boolean>(() => {
    return loadPerformanceProfile() === null;
  });

  const handleUpdatePerformanceProfile = (profile: PerformanceProfile) => {
    setPerformanceProfile(profile);
    savePerformanceProfile(profile);
    setShowPerformanceModal(false);
  };

  const [initialPosition] = useState<ReadingPosition>(() => loadReadingPosition(1));
  const [readingPosition, setReadingPosition] = useState<ReadingPosition>(initialPosition);
  const [currentPage, setCurrentPage] = useState<number>(initialPosition.page);

  const initialViewport: ViewportSize = {
    width: typeof window !== 'undefined' ? window.innerWidth : 390,
    height: typeof window !== 'undefined' ? window.innerHeight : 844,
  };
  const initialBaseLayout = computeBasePageLayout(
    initialViewport,
    345 / 550,
    settings.fitMode,
    DEFAULT_READING_INSETS,
    settings.displayMode
  );

  const [pageData, setPageData] = useState<MushafPagePayload | null>(null);
  const [prevPageData, setPrevPageData] = useState<MushafPagePayload | null>(null);
  const [nextPageData, setNextPageData] = useState<MushafPagePayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [uiVisible, setUiVisible] = useState<boolean>(true);
  const [highlightedAyah, setHighlightedAyah] = useState<RawAyahEntry | null>(null);
  const [highlightedAyahPage, setHighlightedAyahPage] = useState<number | undefined>(undefined);
  const [contextMenuAyah, setContextMenuAyah] = useState<RawAyahEntry | null>(null);
  const [contextMenuPage, setContextMenuPage] = useState<number | undefined>(undefined);
  const [tafsirState, setTafsirState] = useState<{
    page: number;
    ayah: RawAyahEntry;
  } | null>(null);

  // Continuous Mode ayah highlight & context menu state
  const [continuousHighlight, setContinuousHighlight] = useState<{
    page: number;
    surahNumber: number;
    ayahNumber: number;
  } | null>(null);
  const [continuousContextMenu, setContinuousContextMenu] = useState<{
    page: number;
    ayah: RawAyahEntry;
  } | null>(null);

  const [bookmarks, setBookmarks] = useState<ProgressBookmark[]>([]);
  const [khatmahPlan, setKhatmahPlan] = useState<KhatmahPlan | null>(() => loadKhatmahPlan());
  const [bookmarkToast, setBookmarkToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [bookmarksOpen, setBookmarksOpen] = useState<boolean>(false);
  const [recitationOpen, setRecitationOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [settingsSheetOpen, setSettingsSheetOpen] = useState<boolean>(false);

  // Two completely independent reading modes:
  // false -> Single-Page Mode (horizontal RTL page turning)
  // true  -> Continuous Vertical Mode (stacked vertical pages + auto-scroll)
  const [autoScrollActive, setAutoScrollActive] = useState<boolean>(false);
  const [autoScrollRunning, setAutoScrollRunning] = useState<boolean>(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<AutoScrollSpeed>(1);
  const [continuousEntryPage, setContinuousEntryPage] = useState<number>(currentPage);
  const [continuousEntryRatio, setContinuousEntryRatio] = useState<number>(0);
  const [continuousJump, setContinuousJump] = useState<{page: number; seq: number} | null>(null);
  const continuousStepRef = useRef<((deltaPx: number) => boolean) | null>(null);
  const justExitedContinuousRef = useRef<boolean>(false);

  const [interactionMode, setInteractionMode] = useState<ReadingInteractionMode>('normal');
  const [viewport, setViewport] = useState<ViewportSize>(initialViewport);
  const [baseLayout, setBaseLayout] = useState<PageBaseLayout>(initialBaseLayout);
  const [pan, setPan] = useState<PanOffset>(() =>
    clampPan(
      {x: 0, y: 0},
      initialViewport,
      initialBaseLayout,
      settings.zoom,
      settings.displayMode
    )
  );

  const isOnline = useOnlineStatus();
  const lruRef = useRef(new MushafLruCache(8));
  const pendingHighlightRef = useRef<{
    page: number;
    surahNumber: number;
    ayahNumber: number;
  } | null>(null);

  const panRef = useRef(pan);
  const zoomRef = useRef(settings.zoom);
  const displayModeRef = useRef(settings.displayMode);
  const viewportRef = useRef(viewport);
  const baseLayoutRef = useRef(baseLayout);
  const currentPageRef = useRef(currentPage);
  const readingPositionRef = useRef<ReadingPosition>(readingPosition);

  panRef.current = pan;
  zoomRef.current = settings.zoom;
  displayModeRef.current = settings.displayMode;
  viewportRef.current = viewport;
  baseLayoutRef.current = baseLayout;
  currentPageRef.current = currentPage;
  readingPositionRef.current = readingPosition;

  const theme = MUSHAF_THEMES[settings.themeId] ?? MUSHAF_THEMES['classic-dark'];
  const isVerticalMode = settings.displayMode === 'vertical';
  const isContinuousStage = isVerticalMode || autoScrollActive;
  const khatmahStatus = khatmahPlan ? computeKhatmahStatus(khatmahPlan) : null;
  const hasPendingKhatmah = Boolean(
    khatmahStatus && !khatmahStatus.todayDone && !khatmahStatus.isFinished
  );

  const updateSettings = useCallback(
    (patch: Partial<ReadingSettings>) => {
      if (patch.displayMode !== undefined && patch.displayMode !== settings.displayMode) {
        const pos = readingPositionRef.current;
        if (patch.displayMode === 'vertical') {
          setContinuousEntryPage(pos.page);
          setContinuousEntryRatio(pos.intraPageRatio);
          setContinuousJump(null);
          setContextMenuAyah(null);
          setContinuousContextMenu(null);
        } else if (settings.displayMode === 'vertical') {
          justExitedContinuousRef.current = true;
          currentPageRef.current = pos.page;
          setCurrentPage(pos.page);
          setAutoScrollActive(false);
          setAutoScrollRunning(false);
          setContinuousContextMenu(null);
          setInteractionMode('normal');
        }
      }
      setSettings((prev) => {
        const next = {...prev, ...patch};
        saveReadingSettings(next);
        return next;
      });
    },
    [settings.displayMode]
  );

  const showToast = useCallback((message: string, durationMs = 2400) => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setBookmarkToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setBookmarkToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  // Load persisted progress bookmarks from IndexedDB on startup & surface daily Khatmah reminder if pending
  useEffect(() => {
    void getAllBookmarks().then((loaded) => {
      setBookmarks(loaded);
    });
    const initialPlan = loadKhatmahPlan();
    if (initialPlan) {
      const st = computeKhatmahStatus(initialPlan);
      if (!st.todayDone && !st.isFinished) {
        const unitPhrase = formatKhatmahPagesPhrase(st.todayPagesCount, 'object');
        showToast(
          `تذكير التختيم: اقرأ اليوم ${unitPhrase} وقف عند ص ${toArabicIndic(st.todayStopPage)}`,
          4200
        );
      }
    }
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, [showToast]);

  const updateReadingPosition = useCallback((pos: ReadingPosition) => {
    readingPositionRef.current = pos;
    setReadingPosition(pos);
    saveReadingPosition(pos);
  }, []);

  // Sync reading position in Single-Page/Spread mode whenever page/pan/pageData updates
  useEffect(() => {
    if (isContinuousStage) return;
    const totalHeight = baseLayoutRef.current.baseHeight * zoomRef.current;
    const vpCenterInPage =
      totalHeight > 0
        ? Math.max(0, Math.min(1, (-pan.y + viewportRef.current.height * 0.35) / totalHeight))
        : 0;
    const closest =
      pageData && pageData.page === currentPage
        ? resolveClosestAyahAtPageRatio(
            pageData.ayahs,
            parseViewBox(pageData.svg, pageData.page, pageData.ayahs),
            vpCenterInPage
          )
        : null;

    const pos = createReadingPositionForPage(currentPage, {
      surahNumber: closest?.surahNumber,
      ayahNumber: closest?.ayahNumber,
      intraPageRatio: vpCenterInPage,
    });
    updateReadingPosition(pos);
  }, [isContinuousStage, currentPage, pageData, pan.y, updateReadingPosition]);

  // Sync body/document theme color for PWA status bar & root background
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.isDark);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', theme.bg);
  }, [theme]);

  // Sync performance profile class on document root synchronously before paint
  useLayoutEffect(() => {
    const isLight = performanceProfile === 'light';
    document.documentElement.classList.toggle('device-light-mode', isLight);
    document.documentElement.classList.toggle('device-performance-mode', !isLight);
  }, [performanceProfile]);

  const fetchWithLru = useCallback(async (page: number): Promise<MushafPagePayload> => {
    const memHit = lruRef.current.get(page);
    if (memHit) return memHit;
    const loaded = await loadPageResilient(page);
    lruRef.current.set(page, loaded);
    return loaded;
  }, []);

  const syncAdjacentPagesFromCache = useCallback((center: number) => {
    setPrevPageData(center > 1 ? lruRef.current.get(center - 1) ?? null : null);
    setNextPageData(center < 604 ? lruRef.current.get(center + 1) ?? null : null);
  }, []);

  const prefetchNeighbors = useCallback(
    async (center: number) => {
      const targets = [center + 1, center - 1, center + 2, center - 2].filter(
        (p) => p >= 1 && p <= 604
      );
      for (const p of targets) {
        if (!lruRef.current.get(p)) {
          try {
            const loaded = await fetchWithLru(p);
            if (currentPageRef.current === center) {
              if (p === center - 1) setPrevPageData(loaded);
              if (p === center + 1) setNextPageData(loaded);
            }
          } catch {
            // Silent background prefetch
          }
        }
      }
    },
    [fetchWithLru]
  );

  const ensureSingleNeighbor = useCallback(
    (targetPage: number) => {
      if (targetPage < 1 || targetPage > 604) return;
      const hit = lruRef.current.get(targetPage);
      if (hit) {
        if (targetPage === currentPageRef.current - 1) setPrevPageData(hit);
        if (targetPage === currentPageRef.current + 1) setNextPageData(hit);
        return;
      }
      void fetchWithLru(targetPage)
        .then((loaded) => {
          if (targetPage === currentPageRef.current - 1) setPrevPageData(loaded);
          if (targetPage === currentPageRef.current + 1) setNextPageData(loaded);
        })
        .catch(() => {});
    },
    [fetchWithLru]
  );

  const applyPendingHighlightIfPresent = useCallback((data: MushafPagePayload) => {
    const pending = pendingHighlightRef.current;
    if (!pending || pending.page !== data.page) return;
    const matched =
      data.ayahs.find(
        (a) => a.surahNumber === pending.surahNumber && a.ayahNumber === pending.ayahNumber
      ) ?? null;
    if (matched) {
      setHighlightedAyah(matched);
      setHighlightedAyahPage(data.page);
      pendingHighlightRef.current = null;
    }
  }, []);

  // Load Single-Page data whenever currentPage updates in Single-Page/Spread mode
  useEffect(() => {
    if (isContinuousStage) return;

    let active = true;
    const cached = lruRef.current.get(currentPage);

    setErrorMsg(null);
    setContextMenuAyah(null);
    setContextMenuPage(undefined);
    setTafsirState(null);

    if (pendingHighlightRef.current?.page !== currentPage) {
      setHighlightedAyah(null);
      setHighlightedAyahPage(undefined);
    }

    if (cached) {
      setPageData(cached);
      setLoading(false);
      applyPendingHighlightIfPresent(cached);
    } else {
      setLoading(true);
    }

    syncAdjacentPagesFromCache(currentPage);

    const exitedContinuous = justExitedContinuousRef.current;
    justExitedContinuousRef.current = false;
    const restoreY =
      exitedContinuous && zoomRef.current > 1
        ? -(readingPositionRef.current.intraPageRatio * baseLayoutRef.current.baseHeight * zoomRef.current - viewportRef.current.height * 0.32)
        : 0;

    const activeMode = displayModeRef.current;
    const contentWidth =
      activeMode === 'spread'
        ? baseLayoutRef.current.baseWidth * zoomRef.current * 2 +
          getSpreadGapForViewport(viewportRef.current.width)
        : baseLayoutRef.current.baseWidth * zoomRef.current;

    setPan(
      clampPan(
        {
          x: (viewportRef.current.width - contentWidth) / 2,
          y: restoreY,
        },
        viewportRef.current,
        baseLayoutRef.current,
        zoomRef.current,
        activeMode
      )
    );

    fetchWithLru(currentPage)
      .then((data) => {
        if (!active) return;
        setPageData(data);
        applyPendingHighlightIfPresent(data);
        syncAdjacentPagesFromCache(currentPage);
        void prefetchNeighbors(currentPage);
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل صفحة المصحف');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    isContinuousStage,
    currentPage,
    fetchWithLru,
    prefetchNeighbors,
    syncAdjacentPagesFromCache,
    applyPendingHighlightIfPresent,
  ]);

  // Keyboard navigation on desktop (Single-Page/Spread Mode: ArrowLeft -> next, ArrowRight -> prev)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsSheetOpen(false);
        setBookmarksOpen(false);
        setSearchOpen(false);
        setContextMenuAyah(null);
        setContinuousContextMenu(null);
        setTafsirState(null);
        return;
      }
      if (isContinuousStage) return;
      if (settingsSheetOpen || bookmarksOpen || searchOpen || tafsirState) return;
      if (e.key === 'ArrowLeft') {
        setCurrentPage((p) => {
          if (displayModeRef.current === 'spread') {
            const rightOdd = p % 2 !== 0 ? p : Math.max(1, p - 1);
            return Math.min(604, rightOdd + 2);
          }
          return Math.min(604, p + 1);
        });
      } else if (e.key === 'ArrowRight') {
        setCurrentPage((p) => {
          if (displayModeRef.current === 'spread') {
            const rightOdd = p % 2 !== 0 ? p : Math.max(1, p - 1);
            return Math.max(1, rightOdd - 2);
          }
          return Math.max(1, p - 1);
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isContinuousStage, settingsSheetOpen, bookmarksOpen, searchOpen, tafsirState]);

  const handleViewportLayoutChange = useCallback(
    (nextVp: ViewportSize, nextBase: PageBaseLayout) => {
      setViewport(nextVp);
      setBaseLayout(nextBase);
    },
    []
  );

  const handleZoomPanChange = useCallback(
    (nextZoom: number, nextPan: PanOffset) => {
      setPan(nextPan);
      if (Math.abs(nextZoom - zoomRef.current) > 0.002) {
        updateSettings({zoom: nextZoom});
      }
    },
    [updateSettings]
  );

  const handleSetZoomFromSlider = useCallback(
    (targetZoom: number) => {
      const result = zoomAroundFocalPoint({
        oldZoom: zoomRef.current,
        newZoom: targetZoom,
        oldPan: panRef.current,
        focalX: viewportRef.current.width / 2,
        focalY: viewportRef.current.height / 2,
        viewport: viewportRef.current,
        base: baseLayoutRef.current,
        displayMode: displayModeRef.current,
      });
      setPan(result.pan);
      updateSettings({zoom: result.zoom});
    },
    [updateSettings]
  );

  const handleInteractionModeChange = useCallback((nextMode: ReadingInteractionMode) => {
    setInteractionMode(nextMode);
  }, []);

  const handleStepContinuousScroll = useCallback((deltaPx: number) => {
    if (!continuousStepRef.current) return true;
    const hasMore = continuousStepRef.current(deltaPx);
    if (!hasMore) {
      setAutoScrollRunning(false);
      return false;
    }
    return true;
  }, []);

  const handleQuickTapAyah = useCallback(() => {
    if (contextMenuAyah || continuousContextMenu) {
      setContextMenuAyah(null);
      setContextMenuPage(undefined);
      setContinuousContextMenu(null);
      return;
    }
    if (bookmarksOpen || searchOpen || settingsSheetOpen) {
      setBookmarksOpen(false);
      setSearchOpen(false);
      setSettingsSheetOpen(false);
      return;
    }
    if (highlightedAyah) {
      setHighlightedAyah(null);
      setHighlightedAyahPage(undefined);
    }
    if (continuousHighlight) setContinuousHighlight(null);
    setUiVisible((v) => !v);
  }, [
    contextMenuAyah,
    continuousContextMenu,
    bookmarksOpen,
    searchOpen,
    settingsSheetOpen,
    highlightedAyah,
    continuousHighlight,
  ]);

  const handleLongPressAyah = useCallback((ayah: RawAyahEntry, page?: number) => {
    const targetPage = page ?? currentPageRef.current;
    setHighlightedAyah(ayah);
    setHighlightedAyahPage(targetPage);
    setContextMenuAyah(ayah);
    setContextMenuPage(targetPage);
  }, []);

  const handleSaveBookmarkFromAyah = useCallback(
    async (page: number, ayah: RawAyahEntry) => {
      const bookmark = createProgressBookmark({
        surahNumber: ayah.surahNumber,
        ayahNumber: ayah.ayahNumber,
        page,
      });
      setContextMenuAyah(null);
      setContextMenuPage(undefined);
      setContinuousContextMenu(null);
      await saveBookmark(bookmark);
      setBookmarks((prev) => [...prev, bookmark]);

      if (khatmahPlan) {
        const outcome = evaluateKhatmahAutoCompletion(khatmahPlan, {
          source: 'bookmark',
          page,
        });
        if (outcome?.completed && outcome.message) {
          saveKhatmahPlan(outcome.updatedPlan);
          setKhatmahPlan(outcome.updatedPlan);
          showToast(outcome.message, 5600);
          return;
        }
        const activeStatus = computeKhatmahStatus(khatmahPlan);
        if (!activeStatus.todayDone && !activeStatus.isFinished && page < activeStatus.todayStopPage) {
          const remainingForToday = activeStatus.todayStopPage - page;
          showToast(
            `تم حفظ الموضع: ${bookmark.surahName} (${toArabicIndic(bookmark.ayahNumber)}) · متبقي ${formatKhatmahPagesPhrase(remainingForToday, 'subject')} لورد اليوم حتى ص ${toArabicIndic(activeStatus.todayStopPage)}`,
            3600
          );
          return;
        }
      }

      showToast(
        `تم حفظ موضع التقدم: سورة ${bookmark.surahName} — الآية ${toArabicIndic(bookmark.ayahNumber)}`
      );
    },
    [khatmahPlan, showToast]
  );

  const handleDeleteBookmark = useCallback(async (id: string) => {
    await deleteBookmarkById(id);
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleStartKhatmahPlan = useCallback(
    (plan: KhatmahPlan) => {
      saveKhatmahPlan(plan);
      setKhatmahPlan(plan);
      const st = computeKhatmahStatus(plan);
      const unitPhrase = formatKhatmahPagesPhrase(st.todayPagesCount, 'object');
      showToast(
        `تم اعتماد خطة التختيم: ${unitPhrase} يومياً — قف عند ص ${toArabicIndic(st.todayStopPage)}`,
        3600
      );
    },
    [showToast]
  );

  const handleCompleteTodayKhatmah = useCallback(
    (reachedPage?: number) => {
      if (!khatmahPlan) return;
      const updated = completeTodayKhatmahWird(khatmahPlan, reachedPage);
      saveKhatmahPlan(updated);
      setKhatmahPlan(updated);
      const nextSt = computeKhatmahStatus(updated);
      const msg = buildKhatmahCompletionMessage({
        pagesCompletedCount:
          updated.lastCompletedPagesCount ?? Math.max(1, updated.completedUntilPage - khatmahPlan.completedUntilPage),
        reachedPage: updated.completedUntilPage,
        nextStatus: nextSt,
      });
      showToast(msg, 5200);
    },
    [khatmahPlan, showToast]
  );

  const handleRecitationEvaluated = useCallback(
    (info: {
      page: number;
      alignment: RecitationAlignmentReport;
      pageAyahs: TafsirAyahItem[];
    }): string | null => {
      if (!khatmahPlan) return null;
      const lastAyah = info.pageAyahs[info.pageAyahs.length - 1];
      const coveredLastAyah = Boolean(
        lastAyah &&
          info.alignment.words.some(
            (w) =>
              w.status === 'matched' &&
              w.surahNumber === lastAyah.surahNumber &&
              w.ayahNumber === lastAyah.ayahNumber
          )
      );
      const outcome = evaluateKhatmahAutoCompletion(khatmahPlan, {
        source: 'mic',
        page: info.page,
        matchedCount: info.alignment.matchedCount,
        totalExpectedWords: info.alignment.totalExpectedWords,
        coveredLastAyah,
      });
      if (!outcome?.completed || !outcome.message) {
        return null;
      }
      saveKhatmahPlan(outcome.updatedPlan);
      setKhatmahPlan(outcome.updatedPlan);
      showToast(outcome.message, 5600);
      return outcome.message;
    },
    [khatmahPlan, showToast]
  );

  const handleResetKhatmahPlan = useCallback(() => {
    saveKhatmahPlan(null);
    setKhatmahPlan(null);
    showToast('تم حذف خطة التختيم');
  }, [showToast]);

  const handleJumpToTarget = useCallback(
    (params: {page: number; highlightAyah?: {surahNumber: number; ayahNumber: number}}) => {
      setContextMenuAyah(null);
      setContextMenuPage(undefined);
      setContinuousContextMenu(null);

      if (isContinuousStage) {
        setCurrentPage(params.page);
        setContinuousJump({page: params.page, seq: Date.now()});
        setContinuousHighlight(
          params.highlightAyah
            ? {
                page: params.page,
                surahNumber: params.highlightAyah.surahNumber,
                ayahNumber: params.highlightAyah.ayahNumber,
              }
            : null
        );
        return;
      }

      if (params.highlightAyah) {
        pendingHighlightRef.current = {
          page: params.page,
          surahNumber: params.highlightAyah.surahNumber,
          ayahNumber: params.highlightAyah.ayahNumber,
        };
        if (params.page === currentPageRef.current && pageData) {
          applyPendingHighlightIfPresent(pageData);
        }
      } else {
        pendingHighlightRef.current = null;
        setHighlightedAyah(null);
        setHighlightedAyahPage(undefined);
      }
      setCurrentPage(params.page);
    },
    [isContinuousStage, pageData, applyPendingHighlightIfPresent]
  );

  const handleJumpToBookmark = useCallback(
    (bookmark: ProgressBookmark) => {
      handleJumpToTarget({
        page: bookmark.page,
        highlightAyah: {
          surahNumber: bookmark.surahNumber,
          ayahNumber: bookmark.ayahNumber,
        },
      });
    },
    [handleJumpToTarget]
  );

  const handleCommitPageTurn = useCallback((dir: 'next' | 'prev') => {
    setCurrentPage((p) => {
      if (displayModeRef.current === 'spread') {
        const rightOdd = p % 2 !== 0 ? p : Math.max(1, p - 1);
        return dir === 'next' ? Math.min(604, rightOdd + 2) : Math.max(1, rightOdd - 2);
      }
      return dir === 'next' ? Math.min(604, p + 1) : Math.max(1, p - 1);
    });
  }, []);

  const handleContinuousReadingPositionChange = useCallback(
    (pos: ReadingPosition) => {
      updateReadingPosition(pos);
      if (pos.page !== currentPageRef.current) {
        currentPageRef.current = pos.page;
        setCurrentPage(pos.page);
      }
    },
    [updateReadingPosition]
  );

  const exitContinuousAutoScroll = useCallback(() => {
    const finalPos = readingPositionRef.current;
    if (!isVerticalMode) {
      justExitedContinuousRef.current = true;
      currentPageRef.current = finalPos.page;
      setCurrentPage(finalPos.page);
    }
    setAutoScrollActive(false);
    setAutoScrollRunning(false);
    setContinuousContextMenu(null);
    setInteractionMode('normal');
  }, [isVerticalMode]);

  const toggleContinuousAutoScroll = useCallback(() => {
    if (autoScrollActive) {
      exitContinuousAutoScroll();
      return;
    }

    if (!isVerticalMode) {
      const pos = readingPositionRef.current;
      setContinuousEntryPage(pos.page);
      setContinuousEntryRatio(pos.intraPageRatio);
      setContinuousJump(null);
    }
    setContinuousContextMenu(null);
    setContextMenuAyah(null);
    setAutoScrollActive(true);
    setAutoScrollRunning(true);
    setInteractionMode('auto_scroll');
  }, [autoScrollActive, isVerticalMode, exitContinuousAutoScroll]);

  const handleSelectDockAction = useCallback(
    (action: DockAction) => {
      setUiVisible(true);
      setContextMenuAyah(null);
      setContinuousContextMenu(null);

      if (action === 'bookmarks') {
        setSearchOpen(false);
        setSettingsSheetOpen(false);
        setBookmarksOpen((v) => !v);
      } else if (action === 'autoscroll') {
        setBookmarksOpen(false);
        setSearchOpen(false);
        setSettingsSheetOpen(false);
        toggleContinuousAutoScroll();
      } else if (action === 'search') {
        setBookmarksOpen(false);
        setSettingsSheetOpen(false);
        setSearchOpen((v) => !v);
      } else if (action === 'settings') {
        setBookmarksOpen(false);
        setSearchOpen(false);
        setSettingsSheetOpen((v) => !v);
      }
    },
    [toggleContinuousAutoScroll]
  );

  const meta = getPageMeta(currentPage);
  const currentSurah = getSurah(meta.startSurah);
  const showMargins = uiVisible && settings.showMarginalIndicators;

  const dockBaseOffset = uiVisible ? 'bottom-[70px]' : 'bottom-4';
  const autoScrollBottomOffset = recitationOpen
    ? uiVisible
      ? 'bottom-[136px]'
      : 'bottom-[76px]'
    : dockBaseOffset;

  return (
    <MushafBackdropProvider theme={theme} performanceProfile={performanceProfile}>
    <div
      style={{
        backgroundColor: theme.bg,
        backgroundImage: theme.bgGradient,
        color: theme.ink,
      }}
      className="relative w-screen h-[100dvh] overflow-hidden select-none transition-colors duration-200"
    >
      {/* Subtle marginal indicators at top edge (hide cleanly on quick tap, zero bars) */}
      <div
        style={{
          color: theme.ornament,
          opacity: showMargins ? 0.72 : 0,
        }}
        className="pointer-events-none fixed top-2 left-4 right-4 z-20 flex items-center justify-between text-[11px] sm:text-xs font-medium transition-opacity duration-200"
      >
        <span>سورة {currentSurah?.nameArabic}</span>
        <span style={{color: theme.muted}} className="tabular-nums">
          {toArabicIndic(currentPage)} · الحزب {toArabicIndic(meta.hizb)}
        </span>
        <span>الجزء {toArabicIndic(meta.juz)}</span>
      </div>

      {/* Brief non-blocking confirmation toast when a progress bookmark is saved */}
      {bookmarkToast && (
        <div
          role="status"
          style={{color: LIQUID_GLASS.textPrimary}}
          className="liquid-glass-lens glass-panel-enter pointer-events-none fixed top-9 left-1/2 -translate-x-1/2 z-50 rounded-full border overflow-hidden max-w-[calc(100vw-32px)]"
        >
          <LiquidGlassSurface performanceProfile={performanceProfile} tier="lens" cornerRadius="pill" />
          <div className="relative z-10 px-4 py-2 flex items-center gap-2 text-xs font-semibold">
            <CheckCircle2
              className="w-4 h-4 shrink-0"
              style={{color: LIQUID_GLASS.textPrimary}}
              strokeWidth={1.9}
            />
            <span className="truncate">{bookmarkToast}</span>
          </div>
        </div>
      )}

      {/* Main Reading Viewport: Horizontal Single/Spread Mode vs Continuous Vertical Mode */}
      <main className="w-full h-full">
        {isContinuousStage ? (
          <ContinuousMushafStage
            initialPage={continuousEntryPage}
            initialIntraPageRatio={continuousEntryRatio}
            jumpRequest={continuousJump}
            theme={theme}
            zoom={settings.zoom}
            fitMode={settings.fitMode}
            performanceProfile={performanceProfile}
            highlightedAyah={continuousHighlight}
            contextMenuTarget={continuousContextMenu}
            stepHandlerRef={continuousStepRef}
            fetchPage={fetchWithLru}
            onReadingPositionChange={handleContinuousReadingPositionChange}
            onQuickTap={handleQuickTapAyah}
            onLongPressAyah={(page, ayah) => {
              setContinuousHighlight({
                page,
                surahNumber: ayah.surahNumber,
                ayahNumber: ayah.ayahNumber,
              });
              setContinuousContextMenu({page, ayah});
            }}
            onSaveBookmark={(page, ayah) => {
              void handleSaveBookmarkFromAyah(page, ayah);
            }}
            onOpenTafsir={(page, ayah) => {
              setContinuousContextMenu(null);
              setTafsirState({page, ayah});
            }}
          />
        ) : (
          <>
            {loading && !pageData && (
              <div
                style={{color: theme.muted}}
                className="w-full h-full flex items-center justify-center text-sm"
              >
                جاري عرض الصفحة {toArabicIndic(currentPage)}...
              </div>
            )}

            {errorMsg && !loading && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-xs sm:text-sm text-red-400 max-w-sm">{errorMsg}</p>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => p)}
                  style={{color: LIQUID_GLASS.textPrimary}}
                  className="liquid-glass-lens liquid-glass-interactive relative overflow-hidden px-5 py-2.5 rounded-full border text-xs font-semibold"
                >
                  <LiquidGlassSurface performanceProfile={performanceProfile} tier="lens" cornerRadius="pill" />
                  <span className="relative z-10">إعادة المحاولة</span>
                </button>
              </div>
            )}

            {pageData && (
              <MushafSvgStage
                pageData={pageData}
                prevPageData={prevPageData}
                nextPageData={nextPageData}
                theme={theme}
                zoom={settings.zoom}
                pan={pan}
                fitMode={settings.fitMode}
                displayMode={settings.displayMode === 'spread' ? 'spread' : 'single'}
                performanceProfile={performanceProfile}
                highlightedAyah={highlightedAyah}
                highlightedAyahPage={highlightedAyahPage}
                contextMenuAyah={contextMenuAyah}
                contextMenuPage={contextMenuPage}
                interactionMode={interactionMode}
                onViewportLayoutChange={handleViewportLayoutChange}
                onZoomPanChange={handleZoomPanChange}
                onInteractionModeChange={handleInteractionModeChange}
                onQuickTapAyah={handleQuickTapAyah}
                onLongPressAyah={handleLongPressAyah}
                onSaveBookmark={(ayah, page) => {
                  void handleSaveBookmarkFromAyah(page, ayah);
                }}
                onOpenTafsir={(ayah, page) => {
                  setContextMenuAyah(null);
                  setContextMenuPage(undefined);
                  setTafsirState({page, ayah});
                }}
                onCommitPageTurn={handleCommitPageTurn}
                onPrefetchPage={ensureSingleNeighbor}
              />
            )}
          </>
        )}
      </main>

      {/* Offline status indicator when disconnected */}
      {!isOnline && uiVisible && !bookmarkToast && (
        <div
          style={{color: LIQUID_GLASS.textPrimary}}
          className="liquid-glass-lens fixed top-8 left-1/2 -translate-x-1/2 z-30 rounded-full border overflow-hidden text-[11px] font-medium pointer-events-none"
        >
          <LiquidGlassSurface performanceProfile={performanceProfile} tier="lens" cornerRadius="pill" />
          <span className="relative z-10 block px-4 py-1.5">
            وضع عدم الاتصال — استخدام الصفحات المحفوظة
          </span>
        </div>
      )}

      {/* Liquid Glass Bottom Control Dock (4 compact items) */}
      <BottomControlDock
        visible={uiVisible}
        bookmarksOpen={bookmarksOpen}
        bookmarkCount={bookmarks.length}
        khatmahPending={hasPendingKhatmah}
        autoScrollActive={autoScrollActive}
        searchOpen={searchOpen}
        settingsOpen={settingsSheetOpen}
        performanceProfile={performanceProfile}
        onSelectAction={handleSelectDockAction}
      />

      {/* Saved Progress Bookmarks & Khatmah Manager anchored above dock */}
      <BookmarksFloatingPanel
        open={bookmarksOpen}
        bookmarks={bookmarks}
        currentPosition={readingPosition}
        performanceProfile={performanceProfile}
        khatmahPlan={khatmahPlan}
        onSaveCurrentPosition={() => {
          const pos = readingPositionRef.current;
          void handleSaveBookmarkFromAyah(pos.page, {
            surahNumber: pos.surahNumber,
            ayahNumber: pos.ayahNumber,
            x: 0,
            y: 0,
            polygon: '',
          });
        }}
        onJumpToBookmark={handleJumpToBookmark}
        onDeleteBookmark={(id) => {
          void handleDeleteBookmark(id);
        }}
        onJumpToPage={(page) => handleJumpToTarget({page})}
        onStartKhatmahPlan={handleStartKhatmahPlan}
        onCompleteTodayKhatmah={handleCompleteTodayKhatmah}
        onResetKhatmahPlan={handleResetKhatmahPlan}
        onClose={() => setBookmarksOpen(false)}
      />

      {/* Quran Search Panel anchored above dock */}
      <QuranSearchPanel
        open={searchOpen}
        currentPage={currentPage}
        performanceProfile={performanceProfile}
        onJumpToTarget={handleJumpToTarget}
        onClose={() => setSearchOpen(false)}
      />

      {/* Continuous Vertical Auto-Scroll Speed & Pause/Resume Controller */}
      <AutoScrollPill
        active={autoScrollActive}
        running={autoScrollRunning}
        speedLevel={autoScrollSpeed}
        canScrollVertically={true}
        bottomOffsetClass={autoScrollBottomOffset}
        performanceProfile={performanceProfile}
        onStepVerticalScroll={handleStepContinuousScroll}
        onToggleRunning={() => setAutoScrollRunning((r) => !r)}
        onChangeSpeed={(lvl) => setAutoScrollSpeed(lvl)}
        onClose={exitContinuousAutoScroll}
      />

      {/* Non-blocking Microphone Mini Player (launched from Settings) */}
      <RecitationFloatingPanel
        open={recitationOpen}
        currentPage={currentPage}
        focusSurahNumber={
          readingPosition.page === currentPage ? readingPosition.surahNumber : undefined
        }
        focusAyahNumber={
          readingPosition.page === currentPage ? readingPosition.ayahNumber : undefined
        }
        bottomOffsetClass={dockBaseOffset}
        performanceProfile={performanceProfile}
        onRecitationEvaluated={handleRecitationEvaluated}
        onClose={() => setRecitationOpen(false)}
      />

      {/* Floating settings sub-panel anchored above dock */}
      <FloatingSettingsSheet
        open={settingsSheetOpen}
        currentPage={currentPage}
        settings={settings}
        performanceProfile={performanceProfile}
        recitationOpen={recitationOpen}
        onUpdateSettings={updateSettings}
        onUpdatePerformanceProfile={handleUpdatePerformanceProfile}
        onSetZoomLevel={handleSetZoomFromSlider}
        onSelectPage={(p) => handleJumpToTarget({page: p})}
        onToggleRecitation={() => setRecitationOpen((v) => !v)}
        onClose={() => setSettingsSheetOpen(false)}
      />

      {/* Tafsir Al-Muyassar floating card (text-only) */}
      <TafsirFloatingCard
        page={tafsirState?.page ?? currentPage}
        ayah={tafsirState?.ayah ?? null}
        performanceProfile={performanceProfile}
        onClose={() => setTafsirState(null)}
      />

      {/* Startup Performance Setup Modal on first launch */}
      <PerformanceSetupModal
        open={showPerformanceModal}
        performanceProfile={performanceProfile}
        onSelect={handleUpdatePerformanceProfile}
      />
    </div>
    </MushafBackdropProvider>
  );
}
