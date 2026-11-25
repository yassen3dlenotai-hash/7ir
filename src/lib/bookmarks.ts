import {
  getPageMeta,
  getSurah,
  mushafIndex,
  type ProgressBookmark,
  type SurahInfo,
} from '../types/mushaf';

/**
 * Compares two Quranic coordinates strictly by canonical Quranic order
 * (Surah 1..114 ascending, then Ayah 1..N ascending).
 */
export function compareQuranicPosition(
  a: {surahNumber: number; ayahNumber: number},
  b: {surahNumber: number; ayahNumber: number}
): number {
  if (a.surahNumber !== b.surahNumber) {
    return a.surahNumber - b.surahNumber;
  }
  return a.ayahNumber - b.ayahNumber;
}

/**
 * Returns the ID of the single bookmark representing the furthest progress
 * in real Quranic order (NOT insertion order or creation timestamp).
 */
export function findFurthestBookmarkId(bookmarks: ProgressBookmark[]): string | null {
  if (bookmarks.length === 0) return null;

  let furthest = bookmarks[0];
  for (let i = 1; i < bookmarks.length; i++) {
    const candidate = bookmarks[i];
    const cmp = compareQuranicPosition(candidate, furthest);
    if (cmp > 0) {
      furthest = candidate;
    } else if (cmp === 0 && candidate.createdAt > furthest.createdAt) {
      furthest = candidate;
    }
  }
  return furthest.id;
}

/**
 * Sorts bookmarks cleanly by Quranic order (most advanced first, or reverse)
 * while keeping furthest star identity independent of sort order.
 */
export function sortBookmarksByNewestFirst(bookmarks: ProgressBookmark[]): ProgressBookmark[] {
  return [...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
}

export function generateBookmarkId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createProgressBookmark(params: {
  surahNumber: number;
  ayahNumber: number;
  page: number;
  createdAt?: number;
}): ProgressBookmark {
  const surah = getSurah(params.surahNumber);
  const meta = getPageMeta(params.page);

  return {
    id: generateBookmarkId(),
    surahNumber: params.surahNumber,
    surahName: surah?.nameArabic ?? `سورة ${params.surahNumber}`,
    ayahNumber: params.ayahNumber,
    page: Math.max(1, Math.min(604, params.page)),
    juz: meta.juz,
    createdAt: params.createdAt ?? Date.now(),
  };
}

/**
 * Deterministically resolves the exact Mushaf page (1..604) containing (surahNumber, ayahNumber)
 * using the canonical page index in mushafIndex.json.
 */
export function resolveTargetPageForSurahAyah(surahNumber: number, ayahNumber: number): number {
  const clampedSurah = Math.max(1, Math.min(114, surahNumber));
  const surah = getSurah(clampedSurah);
  const clampedAyah = Math.max(1, Math.min(surah?.ayahCount ?? 286, ayahNumber));

  let bestPage = surah?.startPage ?? 1;
  for (const p of mushafIndex.pages) {
    if (
      p.startSurah < clampedSurah ||
      (p.startSurah === clampedSurah && p.startAyah <= clampedAyah)
    ) {
      bestPage = p.page;
    } else {
      break;
    }
  }

  return Math.max(surah?.startPage ?? 1, Math.min(604, bestPage));
}

/**
 * Normalizes Arabic text for instant Surah name matching (strips diacritics & unifies alef/taa marbuta).
 */
export function normalizeArabicSearch(text: string): string {
  return text
    .trim()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}

export function searchSurahs(query: string): SurahInfo[] {
  const trimmed = query.trim();
  if (!trimmed) return mushafIndex.surahs;

  const normalizedQuery = normalizeArabicSearch(trimmed);
  const numericQuery = Number.parseInt(trimmed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)), 10);

  return mushafIndex.surahs.filter((s) => {
    if (Number.isFinite(numericQuery) && s.number === numericQuery) return true;
    const normAr = normalizeArabicSearch(s.nameArabic);
    return (
      normAr.includes(normalizedQuery) ||
      s.nameEnglish.toLowerCase().includes(trimmed.toLowerCase())
    );
  });
}
