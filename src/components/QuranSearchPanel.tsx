import {BookOpen, Clock, Search, X} from 'lucide-react';
import {useMemo, useState} from 'react';
import {resolveTargetPageForSurahAyah, searchSurahs} from '../lib/bookmarks';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {getPageMeta, getSurah, mushafIndex, toArabicIndic} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  open: boolean;
  currentPage: number;
  performanceProfile: PerformanceProfile;
  onJumpToTarget: (params: {
    page: number;
    highlightAyah?: {surahNumber: number; ayahNumber: number};
  }) => void;
  onClose: () => void;
}

export function QuranSearchPanel({
  open,
  currentPage,
  performanceProfile,
  onJumpToTarget,
  onClose,
}: Props) {
  const meta = getPageMeta(currentPage);
  const [query, setQuery] = useState('');
  const [selectedSurah, setSelectedSurah] = useState<number>(meta.startSurah);
  const [ayahInput, setAyahInput] = useState<string>(String(meta.startAyah));
  const [pageInput, setPageInput] = useState<string>(String(currentPage));

  const filteredSurahs = useMemo(() => searchSurahs(query), [query]);

  if (!open) return null;

  const surahInfo = getSurah(selectedSurah) ?? mushafIndex.surahs[0];
  const parsedAyah = Number.parseInt(ayahInput, 10);
  const clampedAyah =
    Number.isFinite(parsedAyah) && parsedAyah >= 1
      ? Math.min(surahInfo.ayahCount, parsedAyah)
      : 1;
  const resolvedPage = resolveTargetPageForSurahAyah(surahInfo.number, clampedAyah);

  const handleJumpAyah = (e: React.FormEvent) => {
    e.preventDefault();
    onJumpToTarget({
      page: resolvedPage,
      highlightAyah: {surahNumber: surahInfo.number, ayahNumber: clampedAyah},
    });
    onClose();
  };

  const handleJumpPage = (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number.parseInt(pageInput, 10);
    if (!Number.isFinite(p) || p < 1 || p > 604) return;
    onJumpToTarget({page: p});
    onClose();
  };

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-[70px] z-35 flex items-end justify-center px-3 sm:px-4 pb-2"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-frosted glass-panel-enter relative w-full max-w-lg rounded-[28px] border max-h-[70dvh] flex flex-col overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="frosted"
          cornerRadius={28}
        />

        <div className="relative z-10 p-5 flex flex-col gap-4 min-h-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold" style={{color: LIQUID_GLASS.textPrimary}}>
                البحث القرآني والانتقال السريع
              </h2>
              <p className="text-[11px] mt-0.5" style={{color: LIQUID_GLASS.textMuted}}>
                انتقل مباشرة بالسورة والآية أو برقم الصفحة
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق البحث"
              style={{color: LIQUID_GLASS.textMuted}}
              className="liquid-glass-interactive w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" strokeWidth={1.85} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto liquid-glass-scroll space-y-4 pr-0.5 text-xs min-h-0">
            {/* 1. Direct Surah + Ayah Jump */}
            <form
              onSubmit={handleJumpAyah}
              className="liquid-glass-nested p-3.5 rounded-[20px] border space-y-2.5"
            >
              <div className="text-[11px] font-semibold" style={{color: LIQUID_GLASS.textMuted}}>
                الانتقال إلى سورة وآية محددة
              </div>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-6">
                  <select
                    aria-label="اختر السورة"
                    value={selectedSurah}
                    onChange={(e) => {
                      const num = Number(e.target.value);
                      setSelectedSurah(num);
                      setAyahInput('1');
                    }}
                    className="lg-input w-full px-2.5 py-2 rounded-xl border text-xs"
                  >
                    {mushafIndex.surahs.map((s) => (
                      <option key={s.number} value={s.number}>
                        {toArabicIndic(s.number)}. {s.nameArabic}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    aria-label="رقم الآية"
                    min={1}
                    max={surahInfo.ayahCount}
                    value={ayahInput}
                    onChange={(e) => setAyahInput(e.target.value)}
                    placeholder="الآية"
                    className="lg-input w-full px-2.5 py-2 rounded-xl border text-xs font-mono tabular-nums text-center"
                  />
                </div>
                <div className="col-span-3">
                  <button
                    type="submit"
                    style={{color: LIQUID_GLASS.textPrimary}}
                    className="liquid-glass-pill-active liquid-glass-interactive w-full h-full py-2 rounded-xl border text-xs font-semibold"
                  >
                    انتقال · ص {toArabicIndic(resolvedPage)}
                  </button>
                </div>
              </div>
            </form>

            {/* 2. Quick Page Number Jump */}
            <form onSubmit={handleJumpPage} className="flex items-center gap-2">
              <input
                type="number"
                aria-label="رقم الصفحة"
                min={1}
                max={604}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                placeholder="رقم الصفحة (١–٦٠٤)"
                className="lg-input flex-1 px-3 py-2.5 rounded-2xl border text-xs font-mono tabular-nums"
              />
              <button
                type="submit"
                style={{color: LIQUID_GLASS.textPrimary}}
                className="liquid-glass-pill-active liquid-glass-interactive px-4 py-2.5 rounded-2xl border text-xs font-semibold whitespace-nowrap"
              >
                فتح الصفحة
              </button>
            </form>

            {/* 3. Instant Surah Directory Filter */}
            <div className="space-y-2">
              <div className="relative">
                <Search
                  className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  style={{color: LIQUID_GLASS.textMuted}}
                  strokeWidth={1.75}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث باسم السورة أو رقمها (مثال: الكهف، ١٨)..."
                  className="lg-input w-full pr-9 pl-3 py-2.5 rounded-2xl border text-xs"
                />
              </div>

              <div
                className="liquid-glass-nested max-h-44 overflow-y-auto liquid-glass-scroll rounded-[20px] border divide-y"
                style={{borderColor: LIQUID_GLASS.borderHairline}}
              >
                {filteredSurahs.length === 0 ? (
                  <div className="p-4 text-center text-xs" style={{color: LIQUID_GLASS.textMuted}}>
                    لا توجد سورة مطابقة لعبارة البحث.
                  </div>
                ) : (
                  filteredSurahs.map((s) => (
                    <button
                      key={s.number}
                      type="button"
                      onClick={() => {
                        onJumpToTarget({page: s.startPage});
                        onClose();
                      }}
                      style={{borderColor: LIQUID_GLASS.divider}}
                      className="lg-hover-surface w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-right transition-colors"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <BookOpen
                          className="w-3.5 h-3.5 shrink-0"
                          style={{color: LIQUID_GLASS.textMuted}}
                          strokeWidth={1.7}
                        />
                        <span className="font-medium truncate" style={{color: LIQUID_GLASS.textPrimary}}>
                          {toArabicIndic(s.number)}. سورة {s.nameArabic}
                        </span>
                      </span>
                      <span
                        className="text-[11px] shrink-0 tabular-nums font-medium"
                        style={{color: LIQUID_GLASS.textSecondary}}
                      >
                        {toArabicIndic(s.ayahCount)} آية · ص {toArabicIndic(s.startPage)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* 4. Honest Under-Development notice for Full-Text Word Search */}
            <div className="liquid-glass-nested p-3.5 rounded-[20px] border flex items-start gap-2.5">
              <Clock
                className="w-4 h-4 shrink-0 mt-0.5"
                style={{color: LIQUID_GLASS.textMuted}}
                strokeWidth={1.75}
              />
              <div className="space-y-0.5">
                <div className="text-xs font-semibold" style={{color: LIQUID_GLASS.textPrimary}}>
                  البحث النصي بالكلمات داخل الآيات — قيد التطوير
                </div>
                <p className="text-[11px] leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                  سيتم تفعيل البحث اللفظي الشامل عبر نص المصحف الكامل في التحديث القادم دون إظهار نتائج تقريبية.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
