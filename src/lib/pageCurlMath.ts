/**
 * Pure finger-driven physical paper curl geometry (2D crease line + reflection matrix +
 * Sutherland-Hodgman polygon clipping + cylindrical roll shading bounds).
 *
 * Designed for Arabic RTL Mushaf reading:
 * - 'next' (dx > 0): finger lifts left edge and curls rightward toward the right spine,
 *   dynamically tilting the crease according to touch Y and live vertical drag.
 * - 'prev' (dx < 0): finger pulls previous leaf leftward out of the right spine.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface PhysicalCurlInput {
  width: number;
  height: number;
  direction: 'next' | 'prev';
  progress: number; // 0..1
  startY: number;
  pointerY: number;
}

export interface PhysicalCurlGeometry {
  /** Point on the moving fold crease line */
  creasePoint: Point2D;
  /** Unit normal pointing from the revealed/left side toward the flat/right side (nx > 0) */
  normal: Point2D;
  /** Rotation angle (degrees) of the crease normal vector */
  angleDeg: number;
  /** CSS clip-path polygon for the flat unpeeled front page (d >= 0) */
  frontClipPath: string;
  /** CSS clip-path polygon (in local page coords before reflection) for the curled back flap (d <= 0) */
  backClipPath: string;
  /** CSS 2D affine reflection matrix(...) reflecting local page coords across the crease line */
  reflectMatrixCss: string;
  /** Cylindrical tube width in px */
  tubeWidthPx: number;
  /** Cast shadow width in px onto the revealed underneath page */
  castShadowPx: number;
  /** Whether there is any peeled back flap visible yet */
  hasBackFlap: boolean;
  /** Whether any front flat region remains */
  hasFrontSheet: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Clips the [0,W] x [0,H] page rectangle against the half-plane:
 *   keepPositive = true  => keep (P - M) · n >= 0
 *   keepPositive = false => keep (P - M) · n <= 0
 */
export function clipRectByHalfPlane(
  width: number,
  height: number,
  origin: Point2D,
  normal: Point2D,
  keepPositive: boolean
): Point2D[] {
  const poly: Point2D[] = [
    {x: 0, y: 0},
    {x: width, y: 0},
    {x: width, y: height},
    {x: 0, y: height},
  ];

  const sign = keepPositive ? 1 : -1;
  const dist = (p: Point2D) =>
    ((p.x - origin.x) * normal.x + (p.y - origin.y) * normal.y) * sign;

  const out: Point2D[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const next = poly[(i + 1) % poly.length];
    const dCur = dist(cur);
    const dNext = dist(next);
    const curIn = dCur >= -1e-4;
    const nextIn = dNext >= -1e-4;

    if (curIn && nextIn) {
      out.push(next);
    } else if (curIn && !nextIn) {
      const denom = dCur - dNext;
      const t = Math.abs(denom) > 1e-6 ? clamp(dCur / denom, 0, 1) : 0;
      out.push({
        x: cur.x + (next.x - cur.x) * t,
        y: cur.y + (next.y - cur.y) * t,
      });
    } else if (!curIn && nextIn) {
      const denom = dCur - dNext;
      const t = Math.abs(denom) > 1e-6 ? clamp(dCur / denom, 0, 1) : 0;
      out.push({
        x: cur.x + (next.x - cur.x) * t,
        y: cur.y + (next.y - cur.y) * t,
      });
      out.push(next);
    }
  }
  return out;
}

function toClipPathCss(pts: Point2D[], width: number, height: number): string {
  if (pts.length < 3 || width <= 0 || height <= 0) {
    return 'polygon(0% 0%, 0% 0%, 0% 0%)';
  }
  const coords = pts
    .map((p) => {
      const xp = ((p.x / width) * 100).toFixed(3);
      const yp = ((p.y / height) * 100).toFixed(3);
      return `${xp}% ${yp}%`;
    })
    .join(', ');
  return `polygon(${coords})`;
}

/**
 * Computes exact 2D paper-curl geometry that adapts continuously to finger position & drag angle
 * while keeping the bound right spine pinned until the page sweeps cleanly off screen.
 */
export function computePhysicalCurlGeometry(input: PhysicalCurlInput): PhysicalCurlGeometry {
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const p = clamp(input.progress, 0, 1);

  const startY = clamp(input.startY, 0, height);
  const pointerY = clamp(input.pointerY, 0, height);

  // Sweep crease across [0..width]:
  // - 'next': sweeps left -> right (0 -> width)
  // - 'prev': sweeps right -> left (width -> 0)
  const rawX =
    input.direction === 'next'
      ? -10 + p * (width + 26)
      : width + 10 - p * (width + 26);

  // Finger vertical touch position tilts the fold angle like pulling a corner vs middle edge
  const startYNorm = startY / height;
  const cornerTilt = (0.5 - startYNorm) * 0.62;
  const liveDragTilt = clamp((pointerY - startY) / Math.max(140, height * 0.48), -1, 1) * 0.44;

  // Spine tension gradually aligns the crease with the vertical spine near completion
  const straighten =
    input.direction === 'next'
      ? 1 - smoothstep(0.55, 0.94, p)
      : 1 - smoothstep(0.65, 0.95, p);

  let slope = (cornerTilt + liveDragTilt) * straighten;

  // Center crease vertically near finger's vertical grab point
  const creaseY = clamp(startY * 0.6 + pointerY * 0.4, height * 0.08, height * 0.92);
  const creasePoint: Point2D = {x: rawX, y: creaseY};

  // Pin right spine corners (W, 0) and (W, H) cleanly while crease is inside page bounds
  const distToRightSpine = Math.max(0, width - rawX);
  const maxYReach = Math.max(creaseY, height - creaseY);
  if (rawX > 0 && rawX < width && maxYReach > 1) {
    const maxSafeSlope = Math.max(0.02, (distToRightSpine * 0.92) / maxYReach);
    slope = clamp(slope, -maxSafeSlope, maxSafeSlope);
  } else {
    slope = clamp(slope, -0.82, 0.82);
  }

  const invLen = 1 / Math.hypot(1, slope);
  const normal: Point2D = {
    x: invLen,
    y: slope * invLen,
  };
  const angleDeg = (Math.atan2(normal.y, normal.x) * 180) / Math.PI;

  const frontPoly = clipRectByHalfPlane(width, height, creasePoint, normal, true);
  const backPoly = clipRectByHalfPlane(width, height, creasePoint, normal, false);

  // Reflection matrix across line (P - M) · n = 0
  const nx = normal.x;
  const ny = normal.y;
  const cDot = creasePoint.x * nx + creasePoint.y * ny;
  const a = 1 - 2 * nx * nx;
  const b = -2 * nx * ny;
  const c = b;
  const d = 1 - 2 * ny * ny;
  const tx = 2 * cDot * nx;
  const ty = 2 * cDot * ny;

  const reflectMatrixCss = `matrix(${a.toFixed(6)}, ${b.toFixed(6)}, ${c.toFixed(6)}, ${d.toFixed(6)}, ${tx.toFixed(2)}, ${ty.toFixed(2)})`;

  const envelope = Math.sin(p * Math.PI);
  const tubeWidthPx = Math.round(clamp(22 + width * 0.12 * Math.sin(clamp(p, 0, 1) * Math.PI * 0.85 + 0.15), 22, 86));
  const castShadowPx = Math.round(clamp(28 + envelope * 46, 20, 74));

  return {
    creasePoint,
    normal,
    angleDeg,
    frontClipPath: toClipPathCss(frontPoly, width, height),
    backClipPath: toClipPathCss(backPoly, width, height),
    reflectMatrixCss,
    tubeWidthPx,
    castShadowPx,
    hasBackFlap: backPoly.length >= 3 && p > 0.005 && p < 0.995,
    hasFrontSheet: frontPoly.length >= 3,
  };
}
