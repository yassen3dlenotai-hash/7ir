import mushafIndexRaw from '../data/mushafIndex.json';

export interface SurahInfo {
  number: number;
  nameArabic: string;
  nameEnglish: string;
  nameTranslation: string;
  ayahCount: number;
  startPage: number;
  juzNumber: number;
  revelationType: string;
}

export interface JuzInfo {
  number: number;
  startSurah: number;
  startAyah: number;
  startPage: number;
}

export interface HizbInfo {
  number: number;
  startSurah: number;
  startAyah: number;
  startPage: number;
}

export interface PageMeta {
  page: number;
  startSurah: number;
  startAyah: number;
  juz: number;
  hizb: number;
  hizbQuarter: number;
}

export interface MushafIndexData {
  edition: string;
  totalPages: number;
  surahs: SurahInfo[];
  juzs: JuzInfo[];
  hizbs: HizbInfo[];
  pages: PageMeta[];
}

export interface RawAyahEntry {
  surahNumber: number;
  ayahNumber: number;
  x: number;
  y: number;
  polygon: string;
}

export interface MushafPagePayload {
  page: number;
  svg: string;
  ayahs: RawAyahEntry[];
  sha256Svg: string;
  sha256Json: string;
  cached?: boolean;
}

export interface TafsirAyahItem {
  globalNumber: number;
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  text: string;
  tafsirMuyassar: string;
  audioUrl?: string;
}

export interface TafsirPagePayload {
  page: number;
  edition: string;
  ayahs: TafsirAyahItem[];
  sha256: string;
}

export type MushafThemeId = 'classic-dark' | 'classic-light';

export interface MushafThemeConfig {
  id: MushafThemeId;
  label: string;
  sublabel: string;
  previewGradient: string;
  bg: string;
  bgGradient?: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  ink: string;
  muted: string;
  ornament: string;
  highlight: string;
  isDark: boolean;
  hasAnimatedGradient?: boolean;
}

export const MUSHAF_THEMES: Record<MushafThemeId, MushafThemeConfig> = {
  'classic-dark': {
    id: 'classic-dark',
    label: 'الداكن الكلاسيكي',
    sublabel: 'فحم عتيق وعاجي مرجعي',
    previewGradient: 'radial-gradient(circle at 50% 50%, #22211C 0%, #141412 100%)',
    bg: '#141412',
    bgGradient:
      'radial-gradient(ellipse 92% 82% at 50% 42%, #1D1C19 0%, #141412 58%, #0E0E0C 100%)',
    surface: '#191916',
    surfaceElevated: '#1F1E1A',
    border: '#2B2A24',
    ink: '#E5DEC9',
    muted: '#8E8878',
    ornament: '#A98B45',
    highlight: '#B8984C',
    isDark: true,
    hasAnimatedGradient: false,
  },
  'classic-light': {
    id: 'classic-light',
    label: 'النهاري الكلاسيكي',
    sublabel: 'مصحف المدينة المنورة الأصلي',
    previewGradient: 'linear-gradient(135deg, #FFFDF8 0%, #F5ECDB 100%)',
    bg: '#FAF4E6',
    bgGradient: 'linear-gradient(180deg, #FDF9EE 0%, #F8F1DF 100%)',
    surface: '#F2E9D5',
    surfaceElevated: '#FFFDF7',
    border: '#DECFA9',
    ink: '#1A1611',
    muted: '#6E614B',
    ornament: '#15705D',
    highlight: '#B88C34',
    isDark: false,
    hasAnimatedGradient: false,
  },
};

// Backward-compatibility aliases for existing saved settings
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['amoled-emerald'] =
  MUSHAF_THEMES['classic-dark'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['dark-gold'] =
  MUSHAF_THEMES['classic-dark'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['dark-silver'] =
  MUSHAF_THEMES['classic-dark'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['madinah-reference'] =
  MUSHAF_THEMES['classic-light'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['aurora-dawn'] =
  MUSHAF_THEMES['classic-light'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['celestial-prism'] =
  MUSHAF_THEMES['classic-light'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['cosmic-violet'] =
  MUSHAF_THEMES['classic-dark'];
(MUSHAF_THEMES as unknown as Record<string, MushafThemeConfig>)['neon-sunset'] =
  MUSHAF_THEMES['classic-dark'];

export interface ProgressBookmark {
  id: string;
  surahNumber: number;
  surahName: string;
  ayahNumber: number;
  page: number;
  juz: number;
  createdAt: number;
}

export interface ReadingSettings {
  themeId: MushafThemeId;
  zoom: number;
  showMarginalIndicators: boolean;
  fitMode: 'contain' | 'fill-width';
  displayMode: 'single' | 'spread' | 'vertical';
  keepScreenAwake: boolean;
}

export const mushafIndex: MushafIndexData = mushafIndexRaw as MushafIndexData;

export function toArabicIndic(num: number): string {
  return String(num).replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

export function getPageMeta(page: number): PageMeta {
  const clamped = Math.max(1, Math.min(604, page));
  return mushafIndex.pages[clamped - 1];
}

export function getSurah(surahNumber: number): SurahInfo | undefined {
  return mushafIndex.surahs[surahNumber - 1];
}
