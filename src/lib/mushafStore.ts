import type {
  MushafPagePayload,
  ProgressBookmark,
  ReadingSettings,
  TafsirPagePayload,
} from '../types/mushaf';

const DB_NAME = 'mushaf-madinah-offline-v2';
const DB_VERSION = 3;
const STORE_PAGES = 'pages';
const STORE_TAFSIR = 'tafsir';
const STORE_META = 'meta';
const STORE_BOOKMARKS = 'bookmarks';

const QURAN_SVG_UPSTREAM =
  'https://raw.githubusercontent.com/quran-ws/quran-svg/main/mushafs/hafs/kfqc';
const ALQURAN_UPSTREAM = 'https://api.alquran.cloud/v1';

const DEFAULT_SETTINGS: ReadingSettings = {
  themeId: 'classic-dark',
  zoom: 1,
  showMarginalIndicators: true,
  fitMode: 'contain',
  displayMode: 'spread',
  keepScreenAwake: false,
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PAGES)) {
        db.createObjectStore(STORE_PAGES, {keyPath: 'page'});
      }
      if (!db.objectStoreNames.contains(STORE_TAFSIR)) {
        db.createObjectStore(STORE_TAFSIR, {keyPath: 'page'});
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, {keyPath: 'key'});
      }
      if (!db.objectStoreNames.contains(STORE_BOOKMARKS)) {
        db.createObjectStore(STORE_BOOKMARKS, {keyPath: 'id'});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function computeSha256Hex(text: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

export async function getAllBookmarks(): Promise<ProgressBookmark[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BOOKMARKS, 'readonly');
      const req = tx.objectStore(STORE_BOOKMARKS).getAll();
      req.onsuccess = () => resolve((req.result as ProgressBookmark[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveBookmark(bookmark: ProgressBookmark): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
    tx.objectStore(STORE_BOOKMARKS).put(bookmark);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteBookmarkById(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_BOOKMARKS, 'readwrite');
    tx.objectStore(STORE_BOOKMARKS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflinePage(page: number): Promise<MushafPagePayload | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, 'readonly');
      const req = tx.objectStore(STORE_PAGES).get(page);
      req.onsuccess = () => resolve((req.result as MushafPagePayload) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveOfflinePage(payload: MushafPagePayload): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_PAGES, 'readwrite');
    tx.objectStore(STORE_PAGES).put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineTafsir(page: number): Promise<TafsirPagePayload | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TAFSIR, 'readonly');
      const req = tx.objectStore(STORE_TAFSIR).get(page);
      req.onsuccess = () => resolve((req.result as TafsirPagePayload) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveOfflineTafsir(payload: TafsirPagePayload): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_TAFSIR, 'readwrite');
    tx.objectStore(STORE_TAFSIR).put(payload);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOfflineInventory(): Promise<{pages: number[]; tafsirPages: number[]}> {
  try {
    const db = await openDb();
    const [pages, tafsirPages] = await Promise.all([
      new Promise<number[]>((resolve, reject) => {
        const tx = db.transaction(STORE_PAGES, 'readonly');
        const req = tx.objectStore(STORE_PAGES).getAllKeys();
        req.onsuccess = () => resolve((req.result as number[]).sort((a, b) => a - b));
        req.onerror = () => reject(req.error);
      }),
      new Promise<number[]>((resolve, reject) => {
        const tx = db.transaction(STORE_TAFSIR, 'readonly');
        const req = tx.objectStore(STORE_TAFSIR).getAllKeys();
        req.onsuccess = () => resolve((req.result as number[]).sort((a, b) => a - b));
        req.onerror = () => reject(req.error);
      }),
    ]);
    return {pages, tafsirPages};
  } catch {
    return {pages: [], tafsirPages: []};
  }
}

export async function clearAllOfflineMushafData(): Promise<void> {
  const db = await openDb();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PAGES, 'readwrite');
      tx.objectStore(STORE_PAGES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TAFSIR, 'readwrite');
      tx.objectStore(STORE_TAFSIR).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
  ]);
}

/**
 * Fetches an untouched original King Fahd Mushaf SVG page with SHA-256 parity verification:
 * 1. IndexedDB local cache (verified against stored sha256Svg)
 * 2. Direct upstream fetch from quran-ws/quran-svg raw vector files
 */
export async function loadPageResilient(page: number): Promise<MushafPagePayload> {
  const local = await getOfflinePage(page);
  if (local && local.svg.includes('<svg') && Array.isArray(local.ayahs)) {
    if (!local.sha256Svg) {
      return local;
    }
    const digest = await computeSha256Hex(local.svg);
    if (!digest || digest === local.sha256Svg) {
      return local;
    }
  }

  const code = String(page).padStart(3, '0');
  const [svgRes, jsonRes] = await Promise.all([
    fetch(`${QURAN_SVG_UPSTREAM}/svg/${code}.svg`),
    fetch(`${QURAN_SVG_UPSTREAM}/json/${code}.json`),
  ]);

  if (!svgRes.ok || !jsonRes.ok) {
    throw new Error(`تعذر تحميل صفحة المصحف رقم ${page}`);
  }

  const svg = await svgRes.text();
  const jsonRaw = await jsonRes.text();
  const payload: MushafPagePayload = {
    page,
    svg,
    ayahs: JSON.parse(jsonRaw),
    sha256Svg: await computeSha256Hex(svg),
    sha256Json: await computeSha256Hex(jsonRaw),
    cached: false,
  };
  await saveOfflinePage(payload);
  return payload;
}

/**
 * Fetches Tafsir Al-Muyassar + Uthmani Quran text (text-only, zero reciter audio).
 */
export async function loadTafsirResilient(page: number): Promise<TafsirPagePayload> {
  const local = await getOfflineTafsir(page);
  if (local && Array.isArray(local.ayahs) && local.ayahs.length > 0) {
    return local;
  }

  const [muyassarRes, uthmaniRes] = await Promise.all([
    fetch(`${ALQURAN_UPSTREAM}/page/${page}/ar.muyassar`),
    fetch(`${ALQURAN_UPSTREAM}/page/${page}/quran-uthmani`),
  ]);

  if (!muyassarRes.ok || !uthmaniRes.ok) {
    throw new Error(`تعذر تحميل التفسير الميسر للصفحة ${page}`);
  }

  const muyassarJson = await muyassarRes.json();
  const uthmaniJson = await uthmaniRes.json();

  const tAyahs = muyassarJson?.data?.ayahs ?? [];
  const uAyahs = uthmaniJson?.data?.ayahs ?? [];

  const ayahs = uAyahs.map(
    (
      item: {
        number: number;
        numberInSurah: number;
        text: string;
        surah: {number: number; name: string};
      },
      idx: number
    ) => {
      const tMatch =
        tAyahs.find(
          (t: {surah: {number: number}; numberInSurah: number}) =>
            t.surah.number === item.surah.number && t.numberInSurah === item.numberInSurah
        ) ?? tAyahs[idx];
      return {
        globalNumber: item.number,
        surahNumber: item.surah.number,
        surahName: item.surah.name,
        ayahNumber: item.numberInSurah,
        text: item.text,
        tafsirMuyassar: tMatch?.text ?? '',
      };
    }
  );

  const payload: TafsirPagePayload = {
    page,
    edition: 'ar.muyassar',
    ayahs,
    sha256: await computeSha256Hex(JSON.stringify(ayahs)),
  };
  await saveOfflineTafsir(payload);
  return payload;
}

export function loadReadingSettings(): ReadingSettings {
  try {
    const raw = localStorage.getItem('mushaf-settings-v2');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReadingSettings>;
    let themeId = parsed.themeId ?? DEFAULT_SETTINGS.themeId;
    if (
      themeId === ('amoled-emerald' as unknown) ||
      themeId === ('dark-gold' as unknown) ||
      themeId === ('dark-silver' as unknown)
    ) {
      themeId = 'classic-dark';
    } else if (themeId === ('madinah-reference' as unknown)) {
      themeId = 'classic-light';
    }

    const displayMode =
      parsed.displayMode === 'single' ||
      parsed.displayMode === 'spread' ||
      parsed.displayMode === 'vertical'
        ? parsed.displayMode
        : DEFAULT_SETTINGS.displayMode;

    return {
      themeId,
      zoom: parsed.zoom ?? DEFAULT_SETTINGS.zoom,
      showMarginalIndicators:
        parsed.showMarginalIndicators ?? DEFAULT_SETTINGS.showMarginalIndicators,
      fitMode: parsed.fitMode ?? DEFAULT_SETTINGS.fitMode,
      displayMode,
      keepScreenAwake: parsed.keepScreenAwake ?? DEFAULT_SETTINGS.keepScreenAwake,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveReadingSettings(settings: ReadingSettings): void {
  try {
    localStorage.setItem('mushaf-settings-v2', JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Bounded 5-page LRU memory cache so all 604 SVG pages are never loaded into RAM at once.
 */
export class MushafLruCache {
  private map = new Map<number, MushafPagePayload>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5) {
    this.maxEntries = maxEntries;
  }

  get(page: number): MushafPagePayload | undefined {
    const hit = this.map.get(page);
    if (!hit) return undefined;
    this.map.delete(page);
    this.map.set(page, hit);
    return hit;
  }

  set(page: number, payload: MushafPagePayload): void {
    if (this.map.has(page)) {
      this.map.delete(page);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(page, payload);
  }
}
