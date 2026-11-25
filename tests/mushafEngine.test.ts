import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareQuranicPosition,
  createProgressBookmark,
  findFurthestBookmarkId,
  resolveTargetPageForSurahAyah,
  searchSurahs,
} from '../src/lib/bookmarks.ts';
import {
  computeContinuousSlotMetrics,
  computeScrollTopForPage,
  computeVisiblePageWindow,
  reprojectScrollTopOnZoomChange,
  resolveVisiblePageFromScrollTop,
} from '../src/lib/continuousScrollMath.ts';
import {
  classifyPressRelease,
  evaluateCurlDragState,
  evaluatePageSwipe,
  resolveSinglePointerIntent,
} from '../src/lib/gestureEngine.ts';
import {
  applyViewBoxToSvg,
  findAyahAtSvgPoint,
  getAyahAnchorNormalized,
  getAyahGlassRects,
  parsePolygonSubpaths,
  parseViewBox,
} from '../src/lib/polygonUtils.ts';
import {
  alignRecitationWords,
  applyAcousticMakhrajAndTajweedAudit,
  extractSensitiveTajweedTargets,
} from '../src/lib/recitationAligner.ts';
import {computePhysicalCurlGeometry} from '../src/lib/pageCurlMath.ts';
import {
  resolveClosestAyahAtPageRatio,
  resolveContinuousReadingPosition,
} from '../src/lib/readingPosition.ts';
import {
  completeTodayKhatmahWird,
  computeKhatmahStatus,
  createKhatmahPlan,
  evaluateKhatmahAutoCompletion,
  formatKhatmahPagesPhrase,
  previewDailyPagesForTarget,
} from '../src/lib/khatmah.ts';
import {
  computeGlassSurfaceSample,
  getOpticalTierConfig,
} from '../src/lib/opticalGlassMaps.ts';
import {
  clampPan,
  clampZoom,
  computeBasePageLayout,
  computePanBounds,
  reclampPanOnResize,
  stepVerticalAutoScroll,
  zoomAroundFocalPoint,
} from '../src/lib/zoomMath.ts';
import {
  AUTO_SCROLL_SPEED_OPTIONS,
  getAutoScrollPxPerSec,
} from '../src/components/AutoScrollPill.tsx';

test('PolygonParser handles page 1 point-list polygon and exact hit-testing', () => {
  const ayahs = [
    {
      surahNumber: 1,
      ayahNumber: 1,
      x: 66.48,
      y: 34.46,
      polygon: '181.08,18.31 57.54,18.31 57.54,48.94 181.08,48.94',
    },
  ];
  const subpaths = parsePolygonSubpaths(ayahs[0].polygon);
  assert.equal(subpaths.length, 1);
  assert.equal(findAyahAtSvgPoint(ayahs, 100, 30)?.ayahNumber, 1);
  assert.equal(findAyahAtSvgPoint(ayahs, 10, 10), null);

  const vb = parseViewBox('<svg viewBox="-53.31 -198.48 345 550"></svg>', 1, ayahs);
  const anchor = getAyahAnchorNormalized(ayahs[0], vb);
  assert.ok(anchor.xPct >= 0.1 && anchor.xPct <= 0.88);
  assert.ok(anchor.yPct >= 0.08 && anchor.yPct <= 0.88);

  const preserved = applyViewBoxToSvg('<svg viewBox="0 0 345 550"></svg>', 4, []);
  assert.ok(preserved.includes('preserveAspectRatio="xMidYMid meet"'));
});

test('PolygonParser handles page 4 multi-line M..L..Z polygon accurately', () => {
  const ayahs = [
    {
      surahNumber: 2,
      ayahNumber: 17,
      x: 48.91,
      y: 64.28,
      polygon:
        'M 0.0 0.0 L 341.75 0.0 L 341.75 38.5 L 0.0 38.5 Z M 38.12 38.5 L 341.75 38.5 L 341.75 79.5 L 38.12 79.5 Z',
    },
  ];
  const subpaths = parsePolygonSubpaths(ayahs[0].polygon);
  assert.equal(subpaths.length, 2);
  assert.equal(findAyahAtSvgPoint(ayahs, 160, 20)?.ayahNumber, 17);
  assert.equal(findAyahAtSvgPoint(ayahs, 160, 55)?.ayahNumber, 17);
  assert.equal(findAyahAtSvgPoint(ayahs, 10, 55), null);
});

test('GestureEngine evaluates physical RTL Mushaf swipe 1->2->3 (dx > 0) and 3->2->1 (dx < 0)', () => {
  assert.equal(evaluatePageSwipe(110, 400, 240, 408), 'next');
  assert.equal(evaluatePageSwipe(230, 400, 100, 405), 'prev');
  assert.equal(evaluatePageSwipe(280, 830, 375, 825), 'next');

  let page = 1;
  for (const dir of [
    evaluatePageSwipe(140, 400, 300, 400),
    evaluatePageSwipe(140, 400, 300, 400),
  ]) {
    if (dir === 'next') page += 1;
  }
  assert.equal(page, 3);

  for (const dir of [
    evaluatePageSwipe(300, 400, 140, 400),
    evaluatePageSwipe(300, 400, 140, 400),
  ]) {
    if (dir === 'prev') page -= 1;
  }
  assert.equal(page, 1);
});

test('GestureEngine classifies quick-tap vs long-press vs drag cleanly', () => {
  assert.equal(classifyPressRelease(140, 3), 'quick-tap');
  assert.equal(classifyPressRelease(460, 4), 'long-press');
  assert.equal(classifyPressRelease(500, 24), 'drag');
});

test('CurlDragState supports commit, velocity flick, and clean cancel before threshold', () => {
  const cancelled = evaluateCurlDragState({
    dx: 42,
    viewportWidth: 400,
    velocityXPxPerMs: 0.1,
    canGoNext: true,
    canGoPrev: true,
  });
  assert.ok(cancelled);
  assert.equal(cancelled.direction, 'next');
  assert.equal(cancelled.commit, false);

  const committed = evaluateCurlDragState({
    dx: 120,
    viewportWidth: 400,
    velocityXPxPerMs: 0.2,
    canGoNext: true,
    canGoPrev: true,
  });
  assert.ok(committed);
  assert.equal(committed.commit, true);

  const flickPrev = evaluateCurlDragState({
    dx: -40,
    viewportWidth: 400,
    velocityXPxPerMs: -0.6,
    canGoNext: true,
    canGoPrev: true,
  });
  assert.ok(flickPrev);
  assert.equal(flickPrev.direction, 'prev');
  assert.equal(flickPrev.commit, true);

  assert.equal(
    evaluateCurlDragState({
      dx: -120,
      viewportWidth: 400,
      velocityXPxPerMs: -0.3,
      canGoNext: true,
      canGoPrev: false,
    }),
    null
  );
});

test('ZoomMath centers Mushaf identically on widescreen, small desktop, portrait & landscape phone', () => {
  const ratio = 345 / 550;
  const zeroInsets = {top: 0, bottom: 0, horizontal: 0};

  const desktopVp = {width: 1440, height: 900};
  const desktopBase = computeBasePageLayout(desktopVp, ratio, 'contain', zeroInsets);
  const desktopPan = clampPan({x: 0, y: 0}, desktopVp, desktopBase, 1);
  const leftGap = desktopPan.x;
  const rightGap = desktopVp.width - (desktopPan.x + desktopBase.baseWidth);
  assert.ok(Math.abs(leftGap - rightGap) < 0.01);
  assert.ok(leftGap > 400);
  assert.equal(desktopPan.y, 0);

  // Default reading insets keep page cleanly inside top/bottom safe zones
  const safeDesktopBase = computeBasePageLayout(desktopVp, ratio, 'contain');
  const safeDesktopPan = clampPan({x: 0, y: 0}, desktopVp, safeDesktopBase, 1);
  assert.equal(safeDesktopPan.y, safeDesktopBase.safeTop);

  const smallVp = {width: 720, height: 600};
  const smallBase = computeBasePageLayout(smallVp, ratio, 'contain', zeroInsets);
  const smallPan = clampPan({x: 0, y: 0}, smallVp, smallBase, 1);
  assert.ok(Math.abs(smallPan.x - (smallVp.width - smallBase.baseWidth) / 2) < 0.01);
  assert.ok(smallBase.baseWidth <= smallVp.width && smallBase.baseHeight <= smallVp.height);

  const portraitVp = {width: 390, height: 844};
  const portraitBase = computeBasePageLayout(portraitVp, ratio, 'contain', zeroInsets);
  const portraitPan = clampPan({x: 0, y: 0}, portraitVp, portraitBase, 1);
  assert.equal(portraitPan.x, 0);
  assert.ok(Math.abs(portraitPan.y - (portraitVp.height - portraitBase.baseHeight) / 2) < 0.01);

  const landscapeVp = {width: 844, height: 390};
  const landscapeBase = computeBasePageLayout(landscapeVp, ratio, 'contain', zeroInsets);
  const landscapePan = clampPan({x: 0, y: 0}, landscapeVp, landscapeBase, 1);
  assert.ok(Math.abs(landscapePan.x - (landscapeVp.width - landscapeBase.baseWidth) / 2) < 0.01);
  assert.equal(landscapePan.y, 0);
});

test('ZoomMath clamps 100%-300%, restores exact center at 100%, and reclamps on resize', () => {
  assert.equal(clampZoom(0.5), 1.0);
  assert.equal(clampZoom(4.2), 3.0);

  const vp = {width: 1440, height: 900};
  const base = computeBasePageLayout(vp, 345 / 550, 'contain');
  const centered = clampPan({x: 0, y: 0}, vp, base, 1);

  const zoomed = zoomAroundFocalPoint({
    oldZoom: 1,
    newZoom: 2.2,
    oldPan: centered,
    focalX: 720,
    focalY: 450,
    viewport: vp,
    base,
  });
  assert.equal(zoomed.zoom, 2.2);

  const zoomedBackOut = zoomAroundFocalPoint({
    oldZoom: zoomed.zoom,
    newZoom: 1.0,
    oldPan: zoomed.pan,
    focalX: 720,
    focalY: 450,
    viewport: vp,
    base,
  });
  assert.equal(zoomedBackOut.zoom, 1.0);
  assert.ok(Math.abs(zoomedBackOut.pan.x - centered.x) < 0.01);
  assert.ok(Math.abs(zoomedBackOut.pan.y - centered.y) < 0.01);

  const smallVp = {width: 800, height: 600};
  const smallBase = computeBasePageLayout(smallVp, 345 / 550, 'contain');
  const reclamped = reclampPanOnResize({
    oldViewport: vp,
    newViewport: smallVp,
    oldBase: base,
    newBase: smallBase,
    oldPan: zoomed.pan,
    zoom: zoomed.zoom,
  });
  assert.ok(Number.isFinite(reclamped.x) && Number.isFinite(reclamped.y));
});

test('AutoScroll steps strictly vertically without changing horizontal pan or zoom', () => {
  const vp = {width: 400, height: 800};
  const base = computeBasePageLayout(vp, 345 / 550, 'contain');

  const fitResult = stepVerticalAutoScroll({
    pan: {x: 0, y: 0},
    deltaPx: 20,
    viewport: vp,
    base,
    zoom: 1,
  });
  assert.equal(fitResult.moved, false);
  assert.equal(fitResult.pan.x, 0);

  const zoomedResult = stepVerticalAutoScroll({
    pan: {x: -55, y: 0},
    deltaPx: 30,
    viewport: vp,
    base,
    zoom: 2,
  });
  assert.equal(zoomedResult.moved, true);
  assert.equal(zoomedResult.pan.x, -55);
  assert.equal(zoomedResult.pan.y, -30);

  assert.equal(
    resolveSinglePointerIntent({
      startX: 200,
      dx: -40,
      dy: 4,
      viewportWidth: 400,
      hasHorizontalPanRoom: true,
      hasVerticalScrollRoom: true,
    }),
    'pan'
  );
  assert.equal(
    resolveSinglePointerIntent({
      startX: 385,
      dx: -40,
      dy: 4,
      viewportWidth: 400,
      hasHorizontalPanRoom: true,
      hasVerticalScrollRoom: true,
    }),
    'page_turn'
  );
});

test('RecitationAligner strictly distinguishes correct, letter substitution, deletion, addition, harakah, shaddah, wrong word, skipped word & unclear audio', () => {
  // 1. Correct fully diacritized & un-diacritized match
  const exact = alignRecitationWords('الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ', [
    {surahNumber: 1, ayahNumber: 2, text: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'},
  ]);
  assert.equal(exact.matchedCount, 4);
  assert.equal(exact.alteredCount, 0);
  assert.equal(exact.unclearCount, 0);
  assert.equal(exact.skippedCount, 0);

  // 2. Letter substitution MUST fail: الدِّينِ vs الَّذِينَ (د vs ذ)
  const letterSub = alignRecitationWords('مَالِكِ يَوْمِ الَّذِينَ', [
    {surahNumber: 1, ayahNumber: 4, text: 'مَٰلِكِ يَوْمِ ٱلدِّينِ'},
  ]);
  const dinWord = letterSub.words.find((w) => w.normalizedExpected === 'الدين');
  assert.equal(dinWord?.status, 'altered');
  assert.equal(dinWord?.issueKind, 'letter_substitution');

  // 3. Letter deletion MUST fail: الْعَالَمِينَ vs الْعَالَمِ (missing ين)
  const letterDel = alignRecitationWords('رَبِّ الْعَالَمِ', [
    {surahNumber: 1, ayahNumber: 2, text: 'رَبِّ ٱلْعَٰلَمِينَ'},
  ]);
  const alaminWord = letterDel.words.find((w) => w.normalizedExpected === 'العالمين');
  assert.equal(alaminWord?.status, 'altered');
  assert.equal(alaminWord?.issueKind, 'letter_deletion');

  // 4. Letter addition MUST fail: لِلَّهِ vs لِلَّاهِي
  const letterAdd = alignRecitationWords('الْحَمْدُ لِلَّاهِي', [
    {surahNumber: 1, ayahNumber: 2, text: 'ٱلْحَمْدُ لِلَّهِ'},
  ]);
  const lillahWord = letterAdd.words.find((w) => w.normalizedExpected === 'لله');
  assert.equal(lillahWord?.status, 'altered');
  assert.equal(lillahWord?.issueKind, 'letter_addition');

  // 5. Harakah change MUST fail: نَعْبُدُ (damma) vs نَعْبَدُ (fatha)
  const harakahDiff = alignRecitationWords('إِيَّاكَ نَعْبَدُ', [
    {surahNumber: 1, ayahNumber: 5, text: 'إِيَّاكَ نَعْبُدُ'},
  ]);
  const nabudu = harakahDiff.words.find((w) => w.normalizedExpected === 'نعبد');
  assert.equal(nabudu?.status, 'altered');
  assert.equal(nabudu?.issueKind, 'harakah_mismatch');

  // 6. Missing Shaddah MUST fail: إِيَّاكَ vs إِيَاكَ
  const missingShaddah = alignRecitationWords('إِيَاكَ نَعْبُدُ', [
    {surahNumber: 1, ayahNumber: 5, text: 'إِيَّاكَ نَعْبُدُ'},
  ]);
  const iyyaka = missingShaddah.words.find((w) => w.normalizedExpected === 'اياك');
  assert.equal(iyyaka?.status, 'altered');
  assert.equal(iyyaka?.issueKind, 'missing_shaddah');

  // 7. Wrong / substituted word MUST fail: ٱلصِّرَٰطَ vs الطَّرِيقَ
  const wrongWord = alignRecitationWords('اهْدِنَا الطَّرِيقَ الْمُسْتَقِيمَ', [
    {surahNumber: 1, ayahNumber: 6, text: 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ'},
  ]);
  const sirat = wrongWord.words.find((w) => w.normalizedExpected === 'الصراط');
  assert.equal(sirat?.status, 'altered');

  // 8. Skipped word completely: بِسْمِ اللَّهِ الرَّحِيمِ (skipped الرَّحْمَٰنِ)
  const skippedReport = alignRecitationWords('بِسْمِ اللَّهِ الرَّحِيمِ', [
    {surahNumber: 1, ayahNumber: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ'},
  ]);
  const rahman = skippedReport.words.find((w) => w.normalizedExpected === 'الرحمان');
  assert.equal(rahman?.status, 'skipped');
  assert.equal(skippedReport.matchedCount, 3);
  assert.equal(skippedReport.skippedCount, 1);

  // 9. Low confidence / unclear audio MUST classify as unclear (NOT falsely altered)
  const lowConf = alignRecitationWords(
    [
      {text: 'الْحَمْدُ', confidence: 0.94},
      {text: 'لله', confidence: 0.35},
    ],
    [{surahNumber: 1, ayahNumber: 2, text: 'ٱلْحَمْدُ لِلَّهِ'}]
  );
  assert.equal(lowConf.matchedCount, 1);
  assert.equal(lowConf.unclearCount, 1);
  assert.equal(lowConf.alteredCount, 0);
  assert.equal(lowConf.words[1]?.status, 'unclear');

  const unintelligible = alignRecitationWords(
    [{text: '...', confidence: 0.1}],
    [{surahNumber: 1, ayahNumber: 2, text: 'ٱلْحَمْدُ لِلَّهِ'}],
    {audioClarity: 'unintelligible'}
  );
  assert.ok(unintelligible.unclearCount >= 2);
  assert.equal(unintelligible.alteredCount, 0);
});

test('ProgressBookmarks awards furthest star strictly by Quranic order and recalculates on delete', () => {
  // Saved earlier in time, yet furthest in Quranic order (Surah 18 Ayah 10)
  const kahf = createProgressBookmark({
    surahNumber: 18,
    ayahNumber: 10,
    page: 294,
    createdAt: 1000,
  });
  // Saved later in time, earlier in Quranic order (Surah 2 Ayah 27)
  const baqara27 = createProgressBookmark({
    surahNumber: 2,
    ayahNumber: 27,
    page: 5,
    createdAt: 2000,
  });
  // Saved last in time, earliest in Quranic order (Surah 1 Ayah 5)
  const fatiha5 = createProgressBookmark({
    surahNumber: 1,
    ayahNumber: 5,
    page: 1,
    createdAt: 3000,
  });
  // Same surah, earlier ayah than baqara27
  const baqara17 = createProgressBookmark({
    surahNumber: 2,
    ayahNumber: 17,
    page: 4,
    createdAt: 4000,
  });

  assert.notEqual(kahf.id, baqara27.id);
  assert.equal(baqara27.surahName, 'البقرة');
  assert.equal(baqara27.juz, 1);
  assert.ok(compareQuranicPosition(kahf, baqara27) > 0);
  assert.ok(compareQuranicPosition(baqara27, baqara17) > 0);

  const list = [fatiha5, baqara27, kahf, baqara17];
  assert.equal(findFurthestBookmarkId(list), kahf.id);

  // Deleting kahf moves the star to baqara27 (NOT baqara17 even though baqara17 has newer createdAt)
  const afterDeleteKahf = list.filter((b) => b.id !== kahf.id);
  assert.equal(findFurthestBookmarkId(afterDeleteKahf), baqara27.id);
  assert.equal(findFurthestBookmarkId([]), null);
});

test('QuranSearch resolves exact pages for Surah+Ayah and normalizes Arabic Surah queries', () => {
  assert.equal(resolveTargetPageForSurahAyah(1, 1), 1);
  assert.equal(resolveTargetPageForSurahAyah(2, 1), 2);
  assert.equal(resolveTargetPageForSurahAyah(2, 27), 5);
  assert.equal(resolveTargetPageForSurahAyah(18, 10), 294);
  assert.equal(resolveTargetPageForSurahAyah(114, 1), 604);

  const imran = searchSurahs('ال عمران');
  assert.ok(imran.some((s) => s.number === 3));

  const baqara = searchSurahs('البقره');
  assert.ok(baqara.some((s) => s.number === 2));

  const byNum = searchSurahs('18');
  assert.equal(byNum[0]?.number, 18);
});

test('ContinuousMushafMode stacks pages vertically with invariant aspect ratio and preserves page/zoom across toggles', () => {
  const ratio = 345 / 550;
  const mobileVp = {width: 390, height: 844};
  const desktopVp = {width: 1440, height: 900};

  const mobileBase = computeBasePageLayout(mobileVp, ratio, 'contain');
  const desktopBase = computeBasePageLayout(desktopVp, ratio, 'contain');

  // Zoom 1.0 and 2.5 preserve exact SVG aspect ratio without distortion
  const m1 = computeContinuousSlotMetrics(mobileBase, 1.0);
  const m2 = computeContinuousSlotMetrics(mobileBase, 2.5);
  assert.ok(Math.abs(m1.slotWidth / m1.slotHeight - ratio) < 0.01);
  assert.ok(Math.abs(m2.slotWidth / m2.slotHeight - ratio) < 0.01);

  const d1 = computeContinuousSlotMetrics(desktopBase, 1.0);
  assert.ok(Math.abs(d1.slotWidth / d1.slotHeight - ratio) < 0.01);

  // Entering continuous mode at page 18 positions scrollTop directly at page 18 (not page 1)
  const startScroll = computeScrollTopForPage(18, m1.stride);
  assert.equal(resolveVisiblePageFromScrollTop(startScroll, mobileVp.height, m1.stride), 18);

  // Scrolling vertically advances from 18 -> 19 -> 20 cleanly
  const afterScrollDown = startScroll + m1.stride * 2;
  const currentContinuousPage = resolveVisiblePageFromScrollTop(
    afterScrollDown,
    mobileVp.height,
    m1.stride
  );
  assert.equal(currentContinuousPage, 20);

  // Re-entering continuous mode from 20 and zooming preserves page 20
  const reprojected = reprojectScrollTopOnZoomChange({
    oldScrollTop: afterScrollDown,
    oldStride: m1.stride,
    newStride: m2.stride,
  });
  assert.equal(resolveVisiblePageFromScrollTop(reprojected, mobileVp.height, m2.stride), 20);

  // DOM window stays strictly bounded <= 8 pages
  const win = computeVisiblePageWindow(currentContinuousPage);
  assert.ok(win.length <= 8);
  assert.ok(win.includes(19) && win.includes(20) && win.includes(21));
});

test('UnifiedReadingPosition tracks page 27->30 scroll progression + closest Ayah and AutoScroll supports 0.5x..3x speeds without 4x', () => {
  const ratio = 345 / 550;
  const vp = {width: 390, height: 844};
  const base = computeBasePageLayout(vp, ratio, 'contain');
  const metrics = computeContinuousSlotMetrics(base, 1.0);

  // Start at page 27
  const startScroll = computeScrollTopForPage(27, metrics.stride);
  const startPos = resolveContinuousReadingPosition({
    scrollTop: startScroll,
    viewportHeight: vp.height,
    stride: metrics.stride,
  });
  assert.equal(startPos.page, 27);

  // Scroll down 3 pages to page 30
  const page30Ayahs = [
    {
      surahNumber: 2,
      ayahNumber: 191,
      x: 100,
      y: 80,
      polygon: 'M 0 20 L 340 20 L 340 120 L 0 120 Z',
    },
    {
      surahNumber: 2,
      ayahNumber: 194,
      x: 100,
      y: 340,
      polygon: 'M 0 260 L 340 260 L 340 420 L 0 420 Z',
    },
  ];
  const scrollAt30Middle = computeScrollTopForPage(30, metrics.stride) + metrics.stride * 0.28;
  const posAt30 = resolveContinuousReadingPosition({
    scrollTop: scrollAt30Middle,
    viewportHeight: vp.height,
    stride: metrics.stride,
    pageAyahs: page30Ayahs,
    viewBox: {minX: 0, minY: 0, width: 345, height: 550},
  });

  // Exiting Continuous Mode uses posAt30.page (30), never reverts to start page (27)
  assert.equal(posAt30.page, 30);
  assert.equal(posAt30.surahNumber, 2);
  assert.equal(posAt30.ayahNumber, 194);

  const closestTop = resolveClosestAyahAtPageRatio(
    page30Ayahs,
    {minX: 0, minY: 0, width: 345, height: 550},
    0.12
  );
  assert.equal(closestTop?.ayahNumber, 191);

  // Verify updated speed scale: 0.5x, 1x, 2x, 3x (no 4x)
  const levels = AUTO_SCROLL_SPEED_OPTIONS.map((o) => o.level);
  assert.deepEqual(levels, [0.5, 1, 2, 3]);
  assert.ok(getAutoScrollPxPerSec(0.5) < getAutoScrollPxPerSec(1));
  assert.equal(getAutoScrollPxPerSec(1), 14);
  assert.equal(getAutoScrollPxPerSec(2), 26);
  assert.equal(getAutoScrollPxPerSec(3), 42);
});

test('Khatmah planner computes exact daily pages and next-day stop pages across days', () => {
  // 604 pages in 121 days -> 5 pages/day (Day 1 stops at page 5, Day 2 reads 5 pages 6..10)
  const preview = previewDailyPagesForTarget(121, 1);
  assert.equal(preview.dailyPages, 5);
  assert.equal(preview.firstDayStopPage, 5);

  const plan = createKhatmahPlan({targetDays: 121, startPage: 1, todayKey: '2026-11-24'});
  const day1Status = computeKhatmahStatus(plan, '2026-11-24');
  assert.equal(day1Status.todayDone, false);
  assert.equal(day1Status.todayPagesCount, 5);
  assert.equal(day1Status.todayStartPage, 1);
  assert.equal(day1Status.todayStopPage, 5);

  const afterDay1 = completeTodayKhatmahWird(plan, undefined, '2026-11-24');
  assert.equal(afterDay1.completedUntilPage, 5);

  const sameDayStatus = computeKhatmahStatus(afterDay1, '2026-11-24');
  assert.equal(sameDayStatus.todayDone, true);
  assert.equal(sameDayStatus.nextPagesCount, 5);
  assert.equal(sameDayStatus.nextStartPage, 6);
  assert.equal(sameDayStatus.nextStopPage, 10);

  // Next day reminder automatically proposes reading 5 more pages stopping at page 10
  const day2Status = computeKhatmahStatus(afterDay1, '2026-11-25');
  assert.equal(day2Status.todayDone, false);
  assert.equal(day2Status.currentDayNumber, 2);
  assert.equal(day2Status.todayPagesCount, 5);
  assert.equal(day2Status.todayStartPage, 6);
  assert.equal(day2Status.todayStopPage, 10);
});

test('Spread mode on rotated landscape phone provides vertical scroll and horizontal pan bounds', () => {
  const landscapeVp = {width: 844, height: 390};
  const ratio = 345 / 550;

  // Fill-width in landscape spread scales each page to half viewport width -> taller than 390px
  const fillWidthSpread = computeBasePageLayout(landscapeVp, ratio, 'fill-width', undefined, 'spread');
  const fillBounds = computePanBounds(landscapeVp, fillWidthSpread, 1, 'spread');
  assert.ok(fillBounds.maxY - fillBounds.minY > 150);

  // Contain in landscape spread when zoomed in (3x) exposes both horizontal & vertical pan room
  const containSpread = computeBasePageLayout(landscapeVp, ratio, 'contain', undefined, 'spread');
  const zoomedBounds = computePanBounds(landscapeVp, containSpread, 3, 'spread');
  assert.ok(zoomedBounds.maxX - zoomedBounds.minX > 100);
  assert.ok(zoomedBounds.maxY - zoomedBounds.minY > 100);
});

test('OpticalGlass surface geometry keeps center flat and curves rim normals with distinct tier calibration', () => {
  // Center plateau must remain optically flat (zero lateral normal, full dome height)
  const centerSample = computeGlassSurfaceSample({
    x: 180,
    y: 28,
    width: 360,
    height: 56,
    cornerRadius: 28,
    bevelPx: 16,
  });
  assert.equal(centerSample.t, 0);
  assert.equal(centerSample.nx, 0);
  assert.equal(centerSample.ny, 0);
  assert.equal(centerSample.nz, 1);

  // Top edge rim curves upward (negative ny), bottom edge rim curves downward (positive ny)
  const topRim = computeGlassSurfaceSample({
    x: 180,
    y: 2,
    width: 360,
    height: 56,
    cornerRadius: 28,
    bevelPx: 16,
  });
  const bottomRim = computeGlassSurfaceSample({
    x: 180,
    y: 54,
    width: 360,
    height: 56,
    cornerRadius: 28,
    bevelPx: 16,
  });
  assert.ok(topRim.t > 0.8);
  assert.ok(topRim.ny < -0.5);
  assert.ok(bottomRim.ny > 0.5);

  // Distinct optical profiles across pill, lens, and frosted tiers:
  // compact pills/lenses remain crystal clear in center with stronger magnification,
  // while large frosted sheets use smooth soft-blur + non-streaking bevel refraction (<= 0.42 * bevel)
  const pillCfg = getOpticalTierConfig('pill', 360, 56);
  const lensCfg = getOpticalTierConfig('lens', 64, 34);
  const frostedCfg = getOpticalTierConfig('frosted', 366, 574);
  assert.ok(lensCfg.magnify > pillCfg.magnify);
  assert.ok(pillCfg.magnify > frostedCfg.magnify);
  assert.equal(pillCfg.blurCenterPx, 0);
  assert.ok(frostedCfg.blurCenterPx >= 4.0);
  assert.ok(frostedCfg.blurCenterPx > frostedCfg.blurEdgePx);
  assert.ok(pillCfg.refractPx / pillCfg.maxBevelPx > frostedCfg.refractPx / frostedCfg.maxBevelPx);
  assert.ok(frostedCfg.refractPx <= frostedCfg.maxBevelPx * 0.42);
  assert.equal(pillCfg.animateSweep, true);
  assert.equal(frostedCfg.animateSweep, false);

  // Verify rounded static glass selection rects for multi-line Ayahs
  const glassRects = getAyahGlassRects(
    'M 0.0 0.0 L 341.75 0.0 L 341.75 38.5 L 0.0 38.5 Z M 38.12 38.5 L 341.75 38.5 L 341.75 79.5 L 38.12 79.5 Z'
  );
  assert.equal(glassRects.length, 2);
  assert.ok(glassRects[0].rx >= 2.5 && glassRects[0].rx <= 6.0);
  assert.ok(glassRects[1].width < glassRects[0].width);
});

test('PhysicalPageCurl adapts fold tilt dynamically to finger Y and tracks RTL swipe 1:1', () => {
  const topCorner = computePhysicalCurlGeometry({
    width: 390,
    height: 844,
    direction: 'next',
    progress: 0.25,
    startY: 110,
    pointerY: 180,
  });
  const bottomCorner = computePhysicalCurlGeometry({
    width: 390,
    height: 844,
    direction: 'next',
    progress: 0.25,
    startY: 740,
    pointerY: 660,
  });
  assert.ok(topCorner.normal.y > 0);
  assert.ok(bottomCorner.normal.y < 0);
  assert.ok(topCorner.hasBackFlap && bottomCorner.hasBackFlap);
  assert.ok(topCorner.reflectMatrixCss.startsWith('matrix('));

  // 'next' crease progresses left->right, 'prev' crease progresses right->left
  const nextLate = computePhysicalCurlGeometry({
    width: 390,
    height: 844,
    direction: 'next',
    progress: 0.75,
    startY: 422,
    pointerY: 422,
  });
  const prevEarly = computePhysicalCurlGeometry({
    width: 390,
    height: 844,
    direction: 'prev',
    progress: 0.2,
    startY: 422,
    pointerY: 422,
  });
  const prevLate = computePhysicalCurlGeometry({
    width: 390,
    height: 844,
    direction: 'prev',
    progress: 0.8,
    startY: 422,
    pointerY: 422,
  });
  assert.ok(nextLate.creasePoint.x > topCorner.creasePoint.x);
  assert.ok(prevLate.creasePoint.x < prevEarly.creasePoint.x);
});

test('RecitationAcousticAudit catches الدِّين vs ٱلَّذِينَ both blindly and via forensic Makhraj override', () => {
  const expected = [
    {surahNumber: 1, ayahNumber: 7, text: 'صِرَاطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ'},
  ];

  // 1. Direct blind phonetic capture of الدِّين instead of ٱلَّذِينَ
  const direct = alignRecitationWords('صِرَاطَ الدِّينِ أَنْعَمْتَ عَلَيْهِمْ', expected);
  assert.equal(direct.matchedCount, 3);
  assert.equal(direct.alteredCount, 1);
  assert.equal(direct.words[1].issueKind, 'letter_substitution');

  // 2. Forensic acoustic Makhraj audit catches الدِّين even if Step 1 ASR snapped to الذين
  const snapped = alignRecitationWords('صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ', expected);
  assert.equal(snapped.matchedCount, 4);

  const targets = extractSensitiveTajweedTargets(snapped.words);
  assert.ok(targets.some((t) => t.wordIndex === 1 && t.checkpoints.some((c) => c.includes('الذال'))));

  const audited = applyAcousticMakhrajAndTajweedAudit(snapped, [
    {
      wordIndex: 1,
      expectedWord: 'ٱلَّذِينَ',
      expectedLetter: 'ذ',
      heardLetter: 'د',
      verdict: 'substituted',
      reason: 'نُطق صوت «د» (الدِّين) بدلاً من مخرج الذال «ذ» في «ٱلَّذِينَ»',
      confidence: 0.91,
    },
  ]);
  assert.equal(audited.matchedCount, 3);
  assert.equal(audited.alteredCount, 1);
  assert.equal(audited.words[1].status, 'altered');
  assert.equal(audited.words[1].issueKind, 'letter_substitution');
});

test('Khatmah auto-completes dynamically via bookmark or microphone across arbitrary page targets', () => {
  // Plan A: 121 days -> 5 pages/day (page 1..5 -> tomorrow reads 5 pages until 10)
  const plan5 = createKhatmahPlan({targetDays: 121, startPage: 1, todayKey: '2026-11-24'});

  // Saving bookmark on page 3 does NOT prematurely complete page 5 target
  const earlyBookmark = evaluateKhatmahAutoCompletion(
    plan5,
    {source: 'bookmark', page: 3},
    '2026-11-24'
  );
  assert.equal(earlyBookmark, null);

  // Saving bookmark on page 5 DOES auto-complete day 1 and prints dynamic next-day target (page 10)
  const done5 = evaluateKhatmahAutoCompletion(
    plan5,
    {source: 'bookmark', page: 5},
    '2026-11-24'
  );
  assert.ok(done5?.completed);
  assert.equal(done5?.completedPagesCount, 5);
  assert.equal(done5?.reachedPage, 5);
  assert.ok(done5?.message?.includes('تم قراءة ٥ صفحات'));
  assert.ok(done5?.message?.includes('١٠'));

  // Plan B: 60 days -> 11 pages/day initially (NOT hardcoded to 5!) completed via microphone on stop page
  const plan11 = createKhatmahPlan({targetDays: 60, startPage: 1, todayKey: '2026-11-24'});
  const st11 = computeKhatmahStatus(plan11, '2026-11-24');
  assert.equal(st11.todayPagesCount, 11);
  assert.equal(st11.todayStopPage, 11);

  // Partial mic start on line 1 of stop page without finishing last ayah or >=45% words should NOT trigger
  const micPartial = evaluateKhatmahAutoCompletion(
    plan11,
    {source: 'mic', page: 11, matchedCount: 2, totalExpectedWords: 40, coveredLastAyah: false},
    '2026-11-24'
  );
  assert.equal(micPartial, null);

  // Finishing the closing ayah on page 11 via mic auto-completes dynamically for 11 pages
  const micDone = evaluateKhatmahAutoCompletion(
    plan11,
    {source: 'mic', page: 11, matchedCount: 6, totalExpectedWords: 40, coveredLastAyah: true},
    '2026-11-24'
  );
  assert.ok(micDone?.completed);
  assert.equal(micDone?.completedPagesCount, 11);
  assert.ok(micDone?.message?.includes(formatKhatmahPagesPhrase(11, 'object')));
  assert.ok(micDone?.message?.includes(String.fromCharCode(0x0660 + 2, 0x0660 + 2))); // stops at page 22 (11 + 11)
});



