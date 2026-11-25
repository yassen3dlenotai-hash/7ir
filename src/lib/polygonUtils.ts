import type {RawAyahEntry} from '../types/mushaf';

export interface Point2D {
  x: number;
  y: number;
}

export interface SvgViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface AyahBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/**
 * Parses both polygon shapes documented in quran-ws/quran-svg:
 * - Pages 1-2: "181.08,18.31 57.54,18.31 ..."
 * - Pages 3-604: "M 0.0 0.0 L 341.75 0.0 ... Z M ..."
 */
export function parsePolygonSubpaths(polygon: string): Point2D[][] {
  const trimmed = polygon.trim();
  if (!trimmed) return [];

  if (/^M/i.test(trimmed)) {
    return trimmed
      .split(/(?=\b[Mm]\b)/)
      .map((seg) => extractPointPairs(seg))
      .filter((pts) => pts.length >= 3);
  }

  const pts = extractPointPairs(trimmed);
  return pts.length >= 3 ? [pts] : [];
}

function extractPointPairs(segment: string): Point2D[] {
  const matches = segment.match(NUMBER_RE);
  if (!matches) return [];
  const points: Point2D[] = [];
  for (let i = 0; i + 1 < matches.length; i += 2) {
    points.push({x: Number(matches[i]), y: Number(matches[i + 1])});
  }
  return points;
}

export function computeSubpathsBounds(subpaths: Point2D[][]): AyahBounds | null {
  if (subpaths.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const poly of subpaths) {
    for (const pt of poly) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {minX, minY, maxX, maxY};
}

export function isPointInPolygon(x: number, y: number, poly: Point2D[]): boolean {
  let inside = false;
  let j = poly.length - 1;
  for (let i = 0; i < poly.length; i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const denom = yj - yi === 0 ? 1e-6 : yj - yi;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / denom + xi;
    if (intersects) inside = !inside;
    j = i;
  }
  return inside;
}

/**
 * Exact coordinate-based Ayah hit testing in SVG viewBox space.
 */
export function findAyahAtSvgPoint(
  ayahs: RawAyahEntry[],
  svgX: number,
  svgY: number
): RawAyahEntry | null {
  for (const ayah of ayahs) {
    const subpaths = parsePolygonSubpaths(ayah.polygon);
    const bounds = computeSubpathsBounds(subpaths);
    if (!bounds) continue;
    if (svgX < bounds.minX || svgX > bounds.maxX || svgY < bounds.minY || svgY > bounds.maxY) {
      continue;
    }
    for (const poly of subpaths) {
      if (isPointInPolygon(svgX, svgY, poly)) {
        return ayah;
      }
    }
  }
  return null;
}

export function parseViewBox(svgText: string, page: number, ayahs: RawAyahEntry[]): SvgViewBox {
  const match = svgText.match(/viewBox="([^"]+)"/);
  const nums = match?.[1]
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));

  const declared: SvgViewBox =
    nums && nums.length === 4
      ? {minX: nums[0], minY: nums[1], width: nums[2], height: nums[3]}
      : {minX: 0, minY: 0, width: 345, height: 550};

  if (page > 2 || ayahs.length === 0) return declared;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const a of ayahs) {
    const bounds = computeSubpathsBounds(parsePolygonSubpaths(a.polygon));
    if (!bounds) continue;
    if (bounds.minX < minX) minX = bounds.minX;
    if (bounds.minY < minY) minY = bounds.minY;
    if (bounds.maxX > maxX) maxX = bounds.maxX;
    if (bounds.maxY > maxY) maxY = bounds.maxY;
  }

  if (!Number.isFinite(minX)) return declared;
  const padX = 22;
  const padY = 26;
  return {
    minX: minX - padX,
    minY: minY - padY,
    width: maxX - minX + padX * 2,
    height: maxY - minY + padY * 2,
  };
}

export function applyViewBoxToSvg(rawSvg: string, page: number, ayahs: RawAyahEntry[]): string {
  let out = rawSvg;
  if (page <= 2) {
    const vb = parseViewBox(rawSvg, page, ayahs);
    const str = `${vb.minX.toFixed(2)} ${vb.minY.toFixed(2)} ${vb.width.toFixed(2)} ${vb.height.toFixed(2)}`;
    out = out.replace(/viewBox="[^"]+"/, `viewBox="${str}"`);
  }

  if (/preserveAspectRatio="[^"]*"/.test(out)) {
    out = out.replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="xMidYMid meet"');
  } else {
    out = out.replace(/<svg\b/, '<svg preserveAspectRatio="xMidYMid meet"');
  }

  return out;
}

/**
 * Computes normalized (0..1) anchor position within the SVG viewBox
 * to place the floating Tafsir circle right beside the selected Ayah marker.
 */
export function getAyahAnchorNormalized(
  ayah: RawAyahEntry,
  viewBox: SvgViewBox
): {xPct: number; yPct: number} {
  const xRatio = (ayah.x - viewBox.minX) / viewBox.width;
  const yRatio = (ayah.y - viewBox.minY) / viewBox.height;
  return {
    xPct: Math.max(0.1, Math.min(0.88, xRatio)),
    yPct: Math.max(0.08, Math.min(0.88, yRatio)),
  };
}

export interface AyahGlassRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}

/**
 * Converts each polygon subpath of an Ayah into a rounded-corner rectangle in SVG viewBox units
 * for clean static neutral-glass selection framing (no yellow tint, no refraction, no blur).
 */
export function getAyahGlassRects(polygon: string): AyahGlassRect[] {
  const subpaths = parsePolygonSubpaths(polygon);
  const rects: AyahGlassRect[] = [];

  for (const poly of subpaths) {
    const b = computeSubpathsBounds([poly]);
    if (!b) continue;
    const rawW = b.maxX - b.minX;
    const rawH = b.maxY - b.minY;
    if (rawW <= 0.5 || rawH <= 0.5) continue;

    const padX = Math.min(1.4, rawW * 0.04);
    const padY = Math.min(1.0, rawH * 0.05);
    const x = b.minX - padX;
    const y = b.minY - padY;
    const width = rawW + padX * 2;
    const height = rawH + padY * 2;
    const rx = Math.max(2.5, Math.min(6.0, width * 0.24, height * 0.34));
    rects.push({x, y, width, height, rx});
  }

  return rects;
}

export function formatViewBoxString(vb: SvgViewBox): string {
  return `${vb.minX.toFixed(2)} ${vb.minY.toFixed(2)} ${vb.width.toFixed(2)} ${vb.height.toFixed(2)}`;
}

