import {X} from 'lucide-react';
import {useEffect, useState} from 'react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import {loadTafsirResilient} from '../lib/mushafStore';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {
  getSurah,
  toArabicIndic,
  type RawAyahEntry,
  type TafsirAyahItem,
} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  page: number;
  ayah: RawAyahEntry | null;
  performanceProfile: PerformanceProfile;
  onClose: () => void;
}

export function TafsirFloatingCard({page, ayah, performanceProfile, onClose}: Props) {
  const [item, setItem] = useState<TafsirAyahItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ayah) return;
    let active = true;
    setLoading(true);
    setError(null);

    loadTafsirResilient(page)
      .then((payload) => {
        if (!active) return;
        const found =
          payload.ayahs.find(
            (a) => a.surahNumber === ayah.surahNumber && a.ayahNumber === ayah.ayahNumber
          ) ?? null;
        setItem(found);
        if (!found) setError('لم يتم العثور على نص التفسير لهذه الآية.');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'تعذر تحميل التفسير الميسر.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, ayah]);

  if (!ayah) return null;

  const surah = getSurah(ayah.surahNumber);

  return (
    <div
      style={{backgroundColor: LIQUID_GLASS.scrimBg}}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-frosted glass-panel-enter relative w-full max-w-lg rounded-[28px] border max-h-[76dvh] flex flex-col overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="frosted"
          cornerRadius={28}
        />

        <div className="relative z-10 p-5 space-y-4 overflow-y-auto liquid-glass-scroll">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold" style={{color: LIQUID_GLASS.textPrimary}}>
              سورة {surah?.nameArabic} · الآية {toArabicIndic(ayah.ayahNumber)}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق التفسير"
              style={{color: LIQUID_GLASS.textMuted}}
              className="liquid-glass-interactive w-10 h-10 rounded-full flex items-center justify-center"
            >
              <X className="w-4 h-4" strokeWidth={1.85} />
            </button>
          </div>

          {loading && (
            <div className="text-xs py-6 text-center" style={{color: LIQUID_GLASS.textMuted}}>
              جاري تحميل التفسير الميسر...
            </div>
          )}

          {error && !loading && (
            <div className="text-xs py-4 text-red-500 dark:text-red-400">{error}</div>
          )}

          {item && !loading && (
            <div className="space-y-4">
              <div
                className="liquid-glass-nested p-4 rounded-[20px] border text-base leading-loose"
                style={{
                  fontFamily: "'Amiri Quran', serif",
                  color: LIQUID_GLASS.textPrimary,
                }}
              >
                {item.text}
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-semibold" style={{color: LIQUID_GLASS.textMuted}}>
                  التفسير الميسر
                </div>
                <p className="text-sm leading-relaxed" style={{color: LIQUID_GLASS.textPrimary}}>
                  {item.tafsirMuyassar}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
