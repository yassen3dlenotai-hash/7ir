/**
 * Pure gesture arbitration engine & explicit 4-mode interaction isolation:
 * 1. 'normal'      - Default reading mode (taps, long-press ayah selection, vertical scroll)
 * 2. 'auto_scroll' - Smooth vertical-only auto-scroll (zero zoom/SVG mutation)
 * 3. 'zoom_pan'    - Two-finger pinch, wheel zoom, and pan while zoomed (100%..300%)
 * 4. 'page_turn'   - Horizontal 3D page curl (right-to-left -> next, left-to-right -> prev)
 */

export type ReadingInteractionMode = 'normal' | 'auto_scroll' | 'zoom_pan' | 'page_turn';

export const LONG_PRESS_DURATION_MS = 430;
export const TAP_MOVE_TOLERANCE_PX = 12;
export const EDGE_PAGE_TURN_PX = 40;
export const PAGE_CURL_COMMIT_RATIO = 0.24;
export const PAGE_CURL_COMMIT_MIN_PX = 76;
export const PAGE_CURL_FLICK_VELOCITY = 0.42; // px per ms

export type PageSwipeDirection = 'next' | 'prev' | null;

/**
 * Evaluates horizontal page swipe across the full Mushaf canvas (Arabic RTL Mushaf).
 * Pulling left-to-right (dx > 0) turns the left page edge rightward toward the spine -> next page.
 * Pulling right-to-left (dx < 0) unfolds the previous page leftward from the right spine -> prev page.
 */
export function evaluatePageSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): PageSwipeDirection {
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < 48) return null;
  if (Math.abs(dx) <= Math.abs(dy) * 1.35) return null;

  return dx > 0 ? 'next' : 'prev';
}

export interface CurlCommitDecision {
  commit: boolean;
  direction: 'next' | 'prev';
  progress: number;
}

/**
 * Computes continuous 0..1 page curl progress and whether release commits or cancels.
 */
export function evaluateCurlDragState(params: {
  dx: number;
  viewportWidth: number;
  velocityXPxPerMs: number;
  canGoNext: boolean;
  canGoPrev: boolean;
}): CurlCommitDecision | null {
  const {dx, viewportWidth, velocityXPxPerMs, canGoNext, canGoPrev} = params;
  if (Math.abs(dx) < 2) return null;

  const direction: 'next' | 'prev' = dx > 0 ? 'next' : 'prev';
  if (direction === 'next' && !canGoNext) return null;
  if (direction === 'prev' && !canGoPrev) return null;

  const span = Math.max(240, viewportWidth * 0.72);
  const progress = Math.min(1, Math.max(0, Math.abs(dx) / span));

  const distanceMet =
    Math.abs(dx) >= Math.max(PAGE_CURL_COMMIT_MIN_PX, viewportWidth * PAGE_CURL_COMMIT_RATIO);
  const sameDirectionFlick =
    Math.abs(dx) >= 24 &&
    ((direction === 'next' && velocityXPxPerMs >= PAGE_CURL_FLICK_VELOCITY) ||
      (direction === 'prev' && velocityXPxPerMs <= -PAGE_CURL_FLICK_VELOCITY));

  return {
    commit: distanceMet || sameDirectionFlick,
    direction,
    progress,
  };
}

/**
 * Determines whether a single-pointer drag should lock into horizontal page curl
 * vs panning/scrolling inside a zoomed page.
 */
export function resolveSinglePointerIntent(params: {
  startX: number;
  dx: number;
  dy: number;
  viewportWidth: number;
  hasHorizontalPanRoom: boolean;
  hasVerticalScrollRoom: boolean;
}): 'pending' | 'page_turn' | 'pan' {
  const {startX, dx, dy, viewportWidth, hasHorizontalPanRoom, hasVerticalScrollRoom} = params;
  const dist = Math.hypot(dx, dy);
  if (dist < TAP_MOVE_TOLERANCE_PX) return 'pending';

  const horizontalDominant = Math.abs(dx) > Math.abs(dy) * 1.25;
  const startedNearEdge =
    startX <= EDGE_PAGE_TURN_PX || startX >= viewportWidth - EDGE_PAGE_TURN_PX;

  if (horizontalDominant) {
    if (!hasHorizontalPanRoom || startedNearEdge) {
      return 'page_turn';
    }
    return 'pan';
  }

  if (hasVerticalScrollRoom || hasHorizontalPanRoom) {
    return 'pan';
  }

  return 'pending';
}

export function classifyPressRelease(
  elapsedMs: number,
  moveDistancePx: number
): 'quick-tap' | 'long-press' | 'drag' {
  if (moveDistancePx > TAP_MOVE_TOLERANCE_PX) return 'drag';
  return elapsedMs >= LONG_PRESS_DURATION_MS ? 'long-press' : 'quick-tap';
}
