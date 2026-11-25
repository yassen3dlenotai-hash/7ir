import {getPageMeta, type RawAyahEntry} from '../types/mushaf';
import {resolveVisiblePageFromScrollTop} from './continuousScrollMath';
import {
  computeSubpathsBounds,
  parsePolygonSubpaths,
  type SvgViewBox,
} from './polygonUtils';

export interface ReadingPosition {
  page: number;
  surahNumber: number;
  ayahNumber: number;
  juz: number;
  intraPageRatio: number; // 0..1 within current Mushaf page
  updatedAt: number;
}

const STORAGE_KEY_POS = 'mushaf-reading-position-v1';
const STORAGE_KEY_LAST_PAGE = 'mushaf-last-page';

export function clampPage(page: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(604, Math.floor(page)));
}

export function createReadingPositionForPage(
  page: number,
  overrides?: Partial<Pick<ReadingPosition, 'surahNumber' | 'ayahNumber' | 'intraPageRatio' | 'updatedAt'>>
): ReadingPosition {
  const safePage = clampPage(page);
  const meta = getPageMeta(safePage);
  return {
    page: safePage,
    surahNumber: overrides?.surahNumber ?? meta.startSurah,
    ayahNumber: overrides?.ayahNumber ?? meta.startAyah,
    juz: meta.juz,
    intraPageRatio: Math.max(0, Math.min(1, overrides?.intraPageRatio ?? 0)),
    updatedAt: overrides?.updatedAt ?? Date.now(),
  };
}

/**
 * Finds the Ayah on a Mushaf page closest vertically to a normalized viewport reading anchor (0..1).
 */
export function resolveClosestAyahAtPageRatio(
  ayahs: RawAyahEntry[],
  viewBox: SvgViewBox,
  ratioY: number
): RawAyahEntry | null {
  if (!ayahs || ayahs.length === 0 || viewBox.height <= 0) return null;
  const clampedRatio = Math.max(0, Math.min(1, ratioY));
  const targetSvgY = viewBox.minY + clampedRatio * viewBox.height;

  let bestAyah: RawAyahEntry | null = null;
  let bestDist = Infinity;

  for (const ayah of ayahs) {
    const bounds = computeSubpathsBounds(parsePolygonSubpaths(ayah.polygon));
    const centerY = bounds ? (bounds.minY + bounds.maxY) / 2 : ayah.y;
    const dist =
      bounds && targetSvgY >= bounds.minY && targetSvgY <= bounds.maxY
        ? 0
        : Math.abs(centerY - targetSvgY);

    if (dist < bestDist) {
      bestDist = dist;
      bestAyah = ayah;
      if (dist === 0) break;
    }
  }

  return bestAyah;
}

/**
 * Synchronously resolves exact ReadingPosition from continuous vertical scroll state.
 * Works even before async page JSON loads by falling back to canonical page metadata.
 */
export function resolveContinuousReadingPosition(params: {
  scrollTop: number;
  viewportHeight: number;
  stride: number;
  pageAyahs?: RawAyahEntry[];
  viewBox?: SvgViewBox;
  now?: number;
}): ReadingPosition {
  const safeStride = Math.max(1, params.stride);
  const page = resolveVisiblePageFromScrollTop(
    params.scrollTop,
    params.viewportHeight,
    safeStride
  );

  const anchorY = Math.max(0, params.scrollTop + params.viewportHeight * 0.32);
  const pageStartY = (page - 1) * safeStride;
  const intraPageRatio = Math.max(0, Math.min(1, (anchorY - pageStartY) / safeStride));

  const closestAyah =
    params.pageAyahs && params.viewBox
      ? resolveClosestAyahAtPageRatio(params.pageAyahs, params.viewBox, intraPageRatio)
      : null;

  return createReadingPositionForPage(page, {
    surahNumber: closestAyah?.surahNumber,
    ayahNumber: closestAyah?.ayahNumber,
    intraPageRatio,
    updatedAt: params.now ?? Date.now(),
  });
}

export function loadReadingPosition(fallbackPage = 1): ReadingPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReadingPosition>;
      if (parsed && typeof parsed.page === 'number') {
        return createReadingPositionForPage(parsed.page, {
          surahNumber: parsed.surahNumber,
          ayahNumber: parsed.ayahNumber,
          intraPageRatio: parsed.intraPageRatio,
          updatedAt: parsed.updatedAt,
        });
      }
    }
    const legacyPage = Number(localStorage.getItem(STORAGE_KEY_LAST_PAGE));
    if (Number.isFinite(legacyPage) && legacyPage >= 1 && legacyPage <= 604) {
      return createReadingPositionForPage(legacyPage);
    }
  } catch {
    // Ignore storage read errors
  }
  return createReadingPositionForPage(fallbackPage);
}

export function saveReadingPosition(pos: ReadingPosition): void {
  try {
    localStorage.setItem(STORAGE_KEY_LAST_PAGE, String(pos.page));
    localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(pos));
  } catch {
    // Ignore storage quota errors
  }
}
