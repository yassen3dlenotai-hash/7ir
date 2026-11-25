import type {PageBaseLayout} from './zoomMath';

export const CONTINUOUS_PAGE_GAP_PX = 14;
export const TOTAL_MUSHAF_PAGES = 604;

export interface ContinuousSlotMetrics {
  slotWidth: number;
  slotHeight: number;
  gapPx: number;
  stride: number;
  totalHeight: number;
}

export function computeContinuousSlotMetrics(
  base: PageBaseLayout,
  zoom: number,
  gapPx = CONTINUOUS_PAGE_GAP_PX
): ContinuousSlotMetrics {
  const slotWidth = Math.max(1, Math.round(base.baseWidth * zoom * 100) / 100);
  const slotHeight = Math.max(1, Math.round(base.baseHeight * zoom * 100) / 100);
  const stride = slotHeight + gapPx;
  const totalHeight = TOTAL_MUSHAF_PAGES * stride - gapPx;
  return {
    slotWidth,
    slotHeight,
    gapPx,
    stride,
    totalHeight,
  };
}

export function computeScrollTopForPage(page: number, stride: number): number {
  const clamped = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, Math.floor(page)));
  return (clamped - 1) * Math.max(1, stride);
}

export function resolveVisiblePageFromScrollTop(
  scrollTop: number,
  viewportHeight: number,
  stride: number
): number {
  const safeStride = Math.max(1, stride);
  const anchorY = Math.max(0, scrollTop + viewportHeight * 0.32);
  const page = Math.floor(anchorY / safeStride) + 1;
  return Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, page));
}

export function computeVisiblePageWindow(
  activePage: number,
  before = 3,
  after = 4
): number[] {
  const clamped = Math.max(1, Math.min(TOTAL_MUSHAF_PAGES, activePage));
  const start = Math.max(1, clamped - before);
  const end = Math.min(TOTAL_MUSHAF_PAGES, clamped + after);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  return pages;
}

export function reprojectScrollTopOnZoomChange(params: {
  oldScrollTop: number;
  oldStride: number;
  newStride: number;
}): number {
  const ratio = params.oldScrollTop / Math.max(1, params.oldStride);
  return Math.max(0, ratio * Math.max(1, params.newStride));
}
