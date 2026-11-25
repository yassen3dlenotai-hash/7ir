/**
 * Pure GPU-friendly zoom & pan geometry math (100% - 300%).
 * Keeps SVG DOM dimensions invariant during gestures while reserving safe margins
 * outside Quranic text for navigation controls in both Single-Page and Spread modes.
 */

export const MIN_ZOOM = 1.0;
export const MAX_ZOOM = 3.0;
export const DEFAULT_SPREAD_GAP = 16;

export interface ViewportSize {
  width: number;
  height: number;
}

export interface SafeReadingInsets {
  top: number;
  bottom: number;
  horizontal: number;
}

export const DEFAULT_READING_INSETS: SafeReadingInsets = {
  top: 26,
  bottom: 74,
  horizontal: 6,
};

export interface PageBaseLayout {
  baseWidth: number;
  baseHeight: number;
  safeTop: number;
  safeBottom: number;
}

export interface PanOffset {
  x: number;
  y: number;
}

export interface PanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 1000) / 1000));
}

export function getSpreadGapForViewport(viewportWidth: number): number {
  return viewportWidth >= 640 ? DEFAULT_SPREAD_GAP : 10;
}

function getEffectiveScaledWidth(
  base: PageBaseLayout,
  zoom: number,
  displayMode: 'single' | 'spread' | 'vertical' = 'single',
  spreadGap = DEFAULT_SPREAD_GAP
): number {
  if (displayMode === 'spread') {
    return base.baseWidth * zoom * 2 + spreadGap;
  }
  return base.baseWidth * zoom;
}

/**
 * Computes the invariant unscaled (zoom = 1) Mushaf page box inside the reserved
 * safe reading region of the viewport so navigation never overlaps Quranic text.
 * Auto-scroll MUST NEVER mutate this layout or fitMode.
 */
export function computeBasePageLayout(
  viewport: ViewportSize,
  aspectRatio: number,
  fitMode: 'contain' | 'fill-width',
  insets: SafeReadingInsets = DEFAULT_READING_INSETS,
  displayMode: 'single' | 'spread' | 'vertical' = 'single'
): PageBaseLayout {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 345 / 550;

  const safeTop = Math.max(0, Math.min(insets.top, vh * 0.12));
  const safeBottom = Math.max(0, Math.min(insets.bottom, vh * 0.18));
  const safeHorizontal = Math.max(0, insets.horizontal);

  const availW = Math.max(120, vw - safeHorizontal * 2);
  const availH = Math.max(160, vh - safeTop - safeBottom);
  const spreadGap = getSpreadGapForViewport(vw);

  if (fitMode === 'fill-width') {
    const maxSingleWidth =
      displayMode === 'spread'
        ? Math.max(120, (availW - spreadGap - 8) / 2)
        : Math.min(availW, 920);
    const baseWidth = Math.min(maxSingleWidth, 920);
    const baseHeight = baseWidth / ratio;
    return {baseWidth, baseHeight, safeTop, safeBottom};
  }

  // 'contain': maximize page clarity strictly inside the unobstructed safe region
  const maxPageW =
    displayMode === 'spread' ? Math.max(120, (availW - spreadGap - 8) / 2) : availW;
  const byHeightWidth = availH * ratio;
  if (byHeightWidth <= maxPageW) {
    return {baseWidth: byHeightWidth, baseHeight: availH, safeTop, safeBottom};
  }
  return {baseWidth: maxPageW, baseHeight: maxPageW / ratio, safeTop, safeBottom};
}

/**
 * Computes allowed translation bounds [minX..maxX, minY..maxY] for transformOrigin: '0 0'.
 * Supports both Single-Page and Two-Page Spread layouts cleanly across portrait & landscape.
 */
export function computePanBounds(
  viewport: ViewportSize,
  base: PageBaseLayout,
  zoom: number,
  displayMode: 'single' | 'spread' | 'vertical' = 'single',
  spreadGap = getSpreadGapForViewport(viewport.width)
): PanBounds {
  const scaledW = getEffectiveScaledWidth(base, zoom, displayMode, spreadGap);
  const scaledH = base.baseHeight * zoom;
  const safeTop = base.safeTop ?? 0;
  const safeBottom = base.safeBottom ?? 0;
  const safeAvailH = Math.max(120, viewport.height - safeTop - safeBottom);

  let minX: number;
  let maxX: number;
  if (scaledW <= viewport.width + 0.5) {
    const centeredX = (viewport.width - scaledW) / 2;
    minX = centeredX;
    maxX = centeredX;
  } else {
    minX = viewport.width - scaledW;
    maxX = 0;
  }

  let minY: number;
  let maxY: number;
  if (scaledH <= safeAvailH + 0.5) {
    const centeredY = safeTop + (safeAvailH - scaledH) / 2;
    minY = centeredY;
    maxY = centeredY;
  } else {
    minY = viewport.height - safeBottom - scaledH;
    maxY = safeTop;
  }

  return {minX, maxX, minY, maxY};
}

export function clampPan(
  pan: PanOffset,
  viewport: ViewportSize,
  base: PageBaseLayout,
  zoom: number,
  displayMode: 'single' | 'spread' | 'vertical' = 'single'
): PanOffset {
  const bounds = computePanBounds(viewport, base, zoom, displayMode);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, pan.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, pan.y)),
  };
}

/**
 * Anchors the viewport-space focal point (pinch midpoint or cursor position)
 * to the exact same Mushaf coordinate before and after scaling.
 */
export function zoomAroundFocalPoint(params: {
  oldZoom: number;
  newZoom: number;
  oldPan: PanOffset;
  focalX: number;
  focalY: number;
  viewport: ViewportSize;
  base: PageBaseLayout;
  displayMode?: 'single' | 'spread' | 'vertical';
}): {zoom: number; pan: PanOffset} {
  const nextZoom = clampZoom(params.newZoom);
  const safeOldZoom = Math.max(MIN_ZOOM, params.oldZoom);
  const mode = params.displayMode ?? 'single';

  const worldX = (params.focalX - params.oldPan.x) / safeOldZoom;
  const worldY = (params.focalY - params.oldPan.y) / safeOldZoom;

  const rawPan: PanOffset = {
    x: params.focalX - worldX * nextZoom,
    y: params.focalY - worldY * nextZoom,
  };

  return {
    zoom: nextZoom,
    pan: clampPan(rawPan, params.viewport, params.base, nextZoom, mode),
  };
}

/**
 * Re-projects pan offset cleanly after viewport resize or orientation rotation
 * so the reading center stays stable without clipping or drifting off-screen.
 */
export function reclampPanOnResize(params: {
  oldViewport: ViewportSize;
  newViewport: ViewportSize;
  oldBase: PageBaseLayout;
  newBase: PageBaseLayout;
  oldPan: PanOffset;
  zoom: number;
  displayMode?: 'single' | 'spread' | 'vertical';
}): PanOffset {
  const {oldViewport, newViewport, oldBase, newBase, oldPan, zoom} = params;
  const mode = params.displayMode ?? 'single';

  const oldW = getEffectiveScaledWidth(
    oldBase,
    zoom,
    mode,
    getSpreadGapForViewport(oldViewport.width)
  );
  const newW = getEffectiveScaledWidth(
    newBase,
    zoom,
    mode,
    getSpreadGapForViewport(newViewport.width)
  );

  const oldCenterX = oldViewport.width / 2;
  const oldCenterY = oldViewport.height / 2;
  const normX = Math.min(1, Math.max(0, (oldCenterX - oldPan.x) / Math.max(1, oldW)));
  const normY = Math.min(
    1,
    Math.max(0, (oldCenterY - oldPan.y) / Math.max(1, oldBase.baseHeight * zoom))
  );

  const projectedPan: PanOffset = {
    x: newViewport.width / 2 - normX * newW,
    y: newViewport.height / 2 - normY * newBase.baseHeight * zoom,
  };

  return clampPan(projectedPan, newViewport, newBase, zoom, mode);
}

/**
 * Advances vertical pan offset for auto-scroll strictly along Y within available bounds.
 */
export function stepVerticalAutoScroll(params: {
  pan: PanOffset;
  deltaPx: number;
  viewport: ViewportSize;
  base: PageBaseLayout;
  zoom: number;
}): {pan: PanOffset; moved: boolean; reachedEnd: boolean} {
  const bounds = computePanBounds(params.viewport, params.base, params.zoom);
  const availableRange = bounds.maxY - bounds.minY;

  if (availableRange <= 0.5) {
    return {
      pan: {x: params.pan.x, y: bounds.maxY},
      moved: false,
      reachedEnd: false,
    };
  }

  const nextY = Math.max(bounds.minY, Math.min(bounds.maxY, params.pan.y - params.deltaPx));
  const moved = Math.abs(nextY - params.pan.y) > 0.01;
  const reachedEnd = nextY <= bounds.minY + 0.5;

  return {
    pan: {x: params.pan.x, y: nextY},
    moved,
    reachedEnd,
  };
}
