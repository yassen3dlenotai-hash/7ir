import {
  BookOpen,
  CheckCircle2,
  Download,
  Mic,
  MonitorDown,
  Pause,
  Play,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {usePWAInstall} from '../hooks/usePWAInstall';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import {
  clearAllOfflineMushafData,
  getOfflineInventory,
  loadPageResilient,
  loadTafsirResilient,
} from '../lib/mushafStore';
import type {PerformanceProfile} from '../lib/performanceProfile';
import {
  MUSHAF_THEMES,
  mushafIndex,
  toArabicIndic,
  type MushafThemeId,
  type ReadingSettings,
} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  open: boolean;
  currentPage: number;
  settings: ReadingSettings;
  performanceProfile: PerformanceProfile;
  recitationOpen: boolean;
  onUpdateSettings: (patch: Partial<ReadingSettings>) => void;
  onUpdatePerformanceProfile: (profile: PerformanceProfile) => void;
  onSetZoomLevel: (zoom: number) => void;
  onSelectPage: (page: number) => void;
  onToggleRecitation: () => void;
  onClose: () => void;
}

export function FloatingSettingsSheet({
  open,
  currentPage,
  settings,
  performanceProfile,
  recitationOpen,
  onUpdateSettings,
  onUpdatePerformanceProfile,
  onSetZoomLevel,
  onSelectPage,
  onToggleRecitation,
  onClose,
}: Props) {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const [navTab, setNavTab] = useState<'none' | 'surahs' | 'juzs' | 'page'>('none');
  const [surahSearch, setSurahSearch] = useState('');
  const [pageInput, setPageInput] = useState(String(currentPage));

  const [tajweedNotice, setTajweedNotice] = useState(false);

  const [savedPages, setSavedPages] = useState<number[]>([]);
  const [savedTafsir, setSavedTafsir] = useState<number[]>([]);
  const [downloadingPack, setDownloadingPack] = useState(false);
  const [activeDownloadPage, setActiveDownloadPage] = useState<number | null>(null);
  const [lastSha, setLastSha] = useState<string>('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const abortDownloadRef = useRef(false);

  const refreshInventory = useCallback(async () => {
    const inv = await getOfflineInventory();
    setSavedPages(inv.pages);
    setSavedTafsir(inv.tafsirPages);
  }, []);

  useEffect(() => {
    if (open) {
      setPageInput(String(currentPage));
      void refreshInventory();
    }
  }, [open, currentPage, refreshInventory]);

  const filteredSurahs = useMemo(() => {
    const q = surahSearch.trim();
    if (!q) return mushafIndex.surahs;
    return mushafIndex.surahs.filter(
      (s) =>
        s.nameArabic.includes(q) ||
        s.nameEnglish.toLowerCase().includes(q.toLowerCase()) ||
        String(s.number) === q
    );
  }, [surahSearch]);

  const startOrResumePack = async () => {
    if (downloadingPack) return;
    abortDownloadRef.current = false;
    setDownloadingPack(true);
    setDownloadError(null);

    try {
      const inv = await getOfflineInventory();
      const pageSet = new Set(inv.pages);
      const tafsirSet = new Set(inv.tafsirPages);

      for (let p = 1; p <= 604; p++) {
        if (abortDownloadRef.current) break;
        const needPage = !pageSet.has(p);
        const needTafsir = !tafsirSet.has(p);
        if (!needPage && !needTafsir) continue;

        setActiveDownloadPage(p);

        if (needPage) {
          const pageData = await loadPageResilient(p);
          pageSet.add(p);
          setSavedPages(Array.from(pageSet).sort((a, b) => a - b));
          if (pageData.sha256Svg) setLastSha(pageData.sha256Svg);
        }

        if (needTafsir) {
          await loadTafsirResilient(p);
          tafsirSet.add(p);
          setSavedTafsir(Array.from(tafsirSet).sort((a, b) => a - b));
        }
      }
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'توقف التنزيل مؤقتاً، يمكنك الاستكمال لاحقاً.'
      );
    } finally {
      setDownloadingPack(false);
      setActiveDownloadPage(null);
    }
  };

  const pausePack = () => {
    abortDownloadRef.current = true;
    setDownloadingPack(false);
  };

  const clearPack = async () => {
    abortDownloadRef.current = true;
    setDownloadingPack(false);
    await clearAllOfflineMushafData();
    setSavedPages([]);
    setSavedTafsir([]);
    setLastSha('');
  };

  if (!open) return null;

  const packPct = Math.round((Math.min(savedPages.length, savedTafsir.length) / 604) * 100);

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-[70px] z-35 flex items-end justify-center px-3 sm:px-4 pb-2"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-frosted glass-panel-enter relative w-full max-w-lg max-h-[68dvh] rounded-[28px] border flex flex-col overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="frosted"
          cornerRadius={28}
        />

        <div
          className="relative z-10 flex items-center justify-between px-5 pt-4 pb-3 border-b"
          style={{borderColor: LIQUID_GLASS.divider}}
        >
          <div className="text-sm font-bold" style={{color: LIQUID_GLASS.textPrimary}}>
            إعدادات المصحف
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الإعدادات"
            style={{color: LIQUID_GLASS.textMuted}}
            className="liquid-glass-interactive w-10 h-10 rounded-full flex items-center justify-center"
          >
            <X className="w-4 h-4" strokeWidth={1.85} />
          </button>
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto liquid-glass-scroll px-5 py-4 space-y-6 text-xs sm:text-sm min-h-0">
          {/* 1. Theme selection */}
          <section className="space-y-2.5">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ١. خلفيات المصحف الشريف
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {(['classic-dark', 'classic-light'] as MushafThemeId[]).map((id) => {
                const item = MUSHAF_THEMES[id];
                const active = settings.themeId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onUpdateSettings({themeId: id})}
                    style={{
                      backgroundColor: item.bg,
                      backgroundImage: item.bgGradient,
                      color: item.ink,
                      borderColor: active ? LIQUID_GLASS.accent : LIQUID_GLASS.borderHairline,
                      boxShadow: active
                        ? `0 0 0 2px ${LIQUID_GLASS.accent}`
                        : 'none',
                    }}
                    className="liquid-glass-interactive relative overflow-hidden px-3.5 py-3 rounded-[18px] border text-right text-xs font-semibold flex items-center justify-between"
                  >
                    <span className="relative z-10 truncate">{item.label}</span>
                    <span
                      className="relative z-10 w-3 h-3 rounded-full shrink-0"
                      style={{backgroundColor: item.ornament}}
                    />
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Performance Profile (Light vs Performance Mode) */}
          <section className="space-y-2.5">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ٢. مستوى أداء الجهاز
            </div>
            <div className="liquid-glass-nested p-1 rounded-[20px] border grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onUpdatePerformanceProfile('light')}
                style={{
                  color:
                    performanceProfile === 'light'
                      ? LIQUID_GLASS.textPrimary
                      : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive py-2.5 px-3 rounded-2xl border text-xs font-semibold text-center ${
                  performanceProfile === 'light'
                    ? 'liquid-glass-pill-active'
                    : 'border-transparent'
                }`}
              >
                جهاز ضعيف (Light Mode)
              </button>
              <button
                type="button"
                onClick={() => onUpdatePerformanceProfile('performance')}
                style={{
                  color:
                    performanceProfile === 'performance'
                      ? LIQUID_GLASS.textPrimary
                      : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive py-2.5 px-3 rounded-2xl border text-xs font-semibold text-center ${
                  performanceProfile === 'performance'
                    ? 'liquid-glass-pill-active'
                    : 'border-transparent'
                }`}
              >
                جهاز قوي (Performance)
              </button>
            </div>
          </section>

          {/* 3. Tajweed Mushaf availability */}
          <section className="space-y-2">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ٣. مصحف التجويد
            </div>
            <div className="liquid-glass-nested p-3.5 rounded-[20px] border flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold">التحويل إلى مصحف التجويد الملون</div>
                <div className="text-[11px] mt-0.5" style={{color: LIQUID_GLASS.textMuted}}>
                  المتاح حالياً: مصحف المدينة برواية حفص (الأصلي)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTajweedNotice((v) => !v)}
                style={{color: LIQUID_GLASS.textPrimary}}
                className="liquid-glass-pill-active liquid-glass-interactive px-3 py-1.5 rounded-full border text-xs font-semibold whitespace-nowrap"
              >
                فحص الملفات
              </button>
            </div>
            {tajweedNotice && (
              <p className="text-[11px] leading-relaxed px-1" style={{color: LIQUID_GLASS.textMuted}}>
                ملفات مصحف التجويد الملون بصيغة SVG غير مدمجة بعد في المصدر المعتمد؛ يعمل التطبيق حالياً بنسخة مجمع الملك فهد الأصلية دون تلوين مصطنع.
              </p>
            )}
          </section>

          {/* 4. Mushaf display settings */}
          <section className="space-y-2.5">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ٤. إعدادات عرض المصحف
            </div>
            <div className="space-y-2">
              <label className="liquid-glass-nested flex items-center justify-between p-3.5 rounded-[20px] border cursor-pointer">
                <span className="text-xs font-medium">
                  إظهار المؤشرات الهامشية (السورة، الجزء، الصفحة)
                </span>
                <input
                  type="checkbox"
                  checked={settings.showMarginalIndicators}
                  onChange={(e) => onUpdateSettings({showMarginalIndicators: e.target.checked})}
                  style={{accentColor: LIQUID_GLASS.accent}}
                  className="w-4 h-4"
                />
              </label>

              <div className="liquid-glass-nested p-1 rounded-[20px] border grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({fitMode: 'contain'})}
                  style={{
                    color:
                      settings.fitMode === 'contain'
                        ? LIQUID_GLASS.textPrimary
                        : LIQUID_GLASS.textMuted,
                  }}
                  className={`liquid-glass-interactive py-2 px-3 rounded-2xl border text-xs font-semibold ${
                    settings.fitMode === 'contain'
                      ? 'liquid-glass-pill-active'
                      : 'border-transparent'
                  }`}
                >
                  احتواء كامل الصفحة
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({fitMode: 'fill-width'})}
                  style={{
                    color:
                      settings.fitMode === 'fill-width'
                        ? LIQUID_GLASS.textPrimary
                        : LIQUID_GLASS.textMuted,
                  }}
                  className={`liquid-glass-interactive py-2 px-3 rounded-2xl border text-xs font-semibold ${
                    settings.fitMode === 'fill-width'
                      ? 'liquid-glass-pill-active'
                      : 'border-transparent'
                  }`}
                >
                  ملء العرض (مع تمرير عمودي)
                </button>
              </div>

              <div className="liquid-glass-nested p-1 rounded-[20px] border grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateSettings({displayMode: 'single'})}
                  style={{
                    color:
                      settings.displayMode === 'single'
                        ? LIQUID_GLASS.textPrimary
                        : LIQUID_GLASS.textMuted,
                  }}
                  className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold ${
                    settings.displayMode === 'single'
                      ? 'liquid-glass-pill-active'
                      : 'border-transparent'
                  }`}
                >
                  صفحة واحدة
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({displayMode: 'spread'})}
                  style={{
                    color:
                      settings.displayMode === 'spread'
                        ? LIQUID_GLASS.textPrimary
                        : LIQUID_GLASS.textMuted,
                  }}
                  className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold ${
                    settings.displayMode === 'spread'
                      ? 'liquid-glass-pill-active'
                      : 'border-transparent'
                  }`}
                >
                  صفحتان
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({displayMode: 'vertical'})}
                  style={{
                    color:
                      settings.displayMode === 'vertical'
                        ? LIQUID_GLASS.textPrimary
                        : LIQUID_GLASS.textMuted,
                  }}
                  className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold ${
                    settings.displayMode === 'vertical'
                      ? 'liquid-glass-pill-active'
                      : 'border-transparent'
                  }`}
                >
                  تصفح عمودي
                </button>
              </div>
            </div>
          </section>

          {/* 5. Display size & zoom (100% - 300%) */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
                ٥. حجم العرض والتكبير
              </span>
              <span
                className="font-mono text-xs font-semibold tabular-nums"
                style={{color: LIQUID_GLASS.textPrimary}}
              >
                {Math.round(settings.zoom * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={settings.zoom}
              onChange={(e) => onSetZoomLevel(Number(e.target.value))}
              style={{accentColor: LIQUID_GLASS.accent}}
              className="w-full"
            />
            <div className="liquid-glass-nested p-1 rounded-[18px] border grid grid-cols-4 gap-1">
              {[1, 1.5, 2, 3].map((z) => {
                const active = Math.abs(settings.zoom - z) < 0.06;
                return (
                  <button
                    key={z}
                    type="button"
                    onClick={() => onSetZoomLevel(z)}
                    style={{
                      color: active ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                    }}
                    className={`liquid-glass-interactive py-1.5 rounded-xl border text-xs font-mono font-semibold tabular-nums ${
                      active ? 'liquid-glass-pill-active' : 'border-transparent'
                    }`}
                  >
                    {Math.round(z * 100)}%
                  </button>
                );
              })}
            </div>
          </section>

          {/* 6. Reading, Surah/Page jump & Offline Full Pack (604 pages + Ayahs + Tafsir) */}
          <section className="space-y-3">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ٦. الفهرس والعمل دون إنترنت
            </div>

            <div className="liquid-glass-nested p-1 rounded-[20px] border grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setNavTab(navTab === 'surahs' ? 'none' : 'surahs')}
                style={{
                  color: navTab === 'surahs' ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                  navTab === 'surahs' ? 'liquid-glass-pill-active' : 'border-transparent'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
                السور
              </button>
              <button
                type="button"
                onClick={() => setNavTab(navTab === 'juzs' ? 'none' : 'juzs')}
                style={{
                  color: navTab === 'juzs' ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold ${
                  navTab === 'juzs' ? 'liquid-glass-pill-active' : 'border-transparent'
                }`}
              >
                الأجزاء
              </button>
              <button
                type="button"
                onClick={() => setNavTab(navTab === 'page' ? 'none' : 'page')}
                style={{
                  color: navTab === 'page' ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                }}
                className={`liquid-glass-interactive py-2 px-2 rounded-2xl border text-xs font-semibold ${
                  navTab === 'page' ? 'liquid-glass-pill-active' : 'border-transparent'
                }`}
              >
                رقم الصفحة
              </button>
            </div>

            {navTab === 'surahs' && (
              <div className="liquid-glass-nested rounded-[20px] border p-3 space-y-2">
                <input
                  type="text"
                  value={surahSearch}
                  onChange={(e) => setSurahSearch(e.target.value)}
                  placeholder="ابحث باسم السورة..."
                  className="lg-input w-full px-3 py-2 rounded-xl border text-xs"
                />
                <div
                  className="max-h-44 overflow-y-auto liquid-glass-scroll divide-y"
                  style={{borderColor: LIQUID_GLASS.divider}}
                >
                  {filteredSurahs.map((s) => (
                    <button
                      key={s.number}
                      type="button"
                      onClick={() => {
                        onSelectPage(s.startPage);
                        onClose();
                      }}
                      style={{borderColor: LIQUID_GLASS.divider}}
                      className="lg-hover-surface w-full py-2 px-2 flex items-center justify-between text-xs rounded-lg transition-colors"
                    >
                      <span>
                        {toArabicIndic(s.number)}. سورة {s.nameArabic}
                      </span>
                      <span className="font-semibold tabular-nums" style={{color: LIQUID_GLASS.textSecondary}}>
                        ص {toArabicIndic(s.startPage)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {navTab === 'juzs' && (
              <div
                className="liquid-glass-nested rounded-[20px] border p-2 max-h-44 overflow-y-auto liquid-glass-scroll divide-y"
                style={{borderColor: LIQUID_GLASS.divider}}
              >
                {mushafIndex.juzs.map((j) => (
                  <button
                    key={j.number}
                    type="button"
                    onClick={() => {
                      onSelectPage(j.startPage);
                      onClose();
                    }}
                    style={{borderColor: LIQUID_GLASS.divider}}
                    className="lg-hover-surface w-full py-2 px-2.5 flex items-center justify-between text-xs rounded-lg transition-colors"
                  >
                    <span>الجزء {toArabicIndic(j.number)}</span>
                    <span className="font-semibold tabular-nums" style={{color: LIQUID_GLASS.textSecondary}}>
                      ص {toArabicIndic(j.startPage)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {navTab === 'page' && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = Number.parseInt(pageInput, 10);
                  if (Number.isFinite(p) && p >= 1 && p <= 604) {
                    onSelectPage(p);
                    onClose();
                  }
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={604}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  className="lg-input flex-1 px-3 py-2 rounded-xl border text-xs font-mono tabular-nums"
                />
                <button
                  type="submit"
                  style={{color: LIQUID_GLASS.textPrimary}}
                  className="liquid-glass-pill-active liquid-glass-interactive px-4 py-2 rounded-xl border text-xs font-semibold"
                >
                  انتقال
                </button>
              </form>
            )}

            {/* Offline 604-page + Tafsir Al-Muyassar downloader */}
            <div className="liquid-glass-nested p-3.5 rounded-[20px] border space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">تنزيل المصحف والتفسير الميسر (٦٠٤ صفحة)</div>
                  <div
                    className="text-[11px] mt-0.5 tabular-nums"
                    style={{color: LIQUID_GLASS.textMuted}}
                  >
                    الصفحات: {toArabicIndic(savedPages.length)}/٦٠٤ · التفسير: {toArabicIndic(savedTafsir.length)}/٦٠٤
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {downloadingPack ? (
                    <button
                      type="button"
                      onClick={pausePack}
                      style={{borderColor: LIQUID_GLASS.borderHairline}}
                      className="liquid-glass-interactive px-3 py-1.5 rounded-full border text-xs flex items-center gap-1"
                    >
                      <Pause className="w-3.5 h-3.5" strokeWidth={1.75} />
                      إيقاف
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startOrResumePack}
                      style={{color: LIQUID_GLASS.textPrimary}}
                      className="liquid-glass-pill-active liquid-glass-interactive px-3 py-1.5 rounded-full border text-xs font-semibold flex items-center gap-1"
                    >
                      {savedPages.length === 604 && savedTafsir.length === 604 ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                          مكتمل
                        </>
                      ) : savedPages.length > 0 ? (
                        <>
                          <Play className="w-3.5 h-3.5" strokeWidth={1.8} />
                          استكمال
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" strokeWidth={1.8} />
                          تنزيل الكل
                        </>
                      )}
                    </button>
                  )}

                  {(savedPages.length > 0 || savedTafsir.length > 0) && (
                    <button
                      type="button"
                      onClick={clearPack}
                      aria-label="حذف البيانات المحفوظة"
                      style={{color: LIQUID_GLASS.textMuted}}
                      className="liquid-glass-interactive w-8 h-8 rounded-full flex items-center justify-center hover:text-red-500 dark:hover:text-red-300"
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>

              <div
                className="w-full h-1.5 rounded-full overflow-hidden"
                style={{backgroundColor: LIQUID_GLASS.trackBg}}
              >
                <div
                  className="h-full transition-all duration-200 rounded-full"
                  style={{width: `${packPct}%`, backgroundColor: LIQUID_GLASS.accent}}
                />
              </div>

              {activeDownloadPage !== null && (
                <div className="text-[11px] tabular-nums" style={{color: LIQUID_GLASS.textMuted}}>
                  جاري تنزيل وحفظ الصفحة {toArabicIndic(activeDownloadPage)} والبيانات والتفسير...
                </div>
              )}

              {lastSha && (
                <div
                  className="flex items-center gap-1.5 text-[10px] font-mono truncate"
                  style={{color: LIQUID_GLASS.textMuted}}
                >
                  <ShieldCheck
                    className="w-3.5 h-3.5 shrink-0"
                    style={{color: LIQUID_GLASS.textPrimary}}
                  />
                  <span className="truncate">SHA-256: {lastSha}</span>
                </div>
              )}

              {downloadError && (
                <div className="text-[11px] text-red-500 dark:text-red-400">{downloadError}</div>
              )}
            </div>

            {/* PWA Install Button */}
            {!isInstalled && (isInstallable || isIOS) && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    if (isInstallable) void install();
                    else setShowIOSGuide((v) => !v);
                  }}
                  style={{color: LIQUID_GLASS.textPrimary}}
                  className="liquid-glass-pill-active liquid-glass-interactive w-full py-2.5 px-3 rounded-[18px] border text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <MonitorDown className="w-4 h-4" strokeWidth={1.8} />
                  تثبيت المصحف كتطبيق على الجهاز (PWA)
                </button>
                {showIOSGuide && (
                  <p
                    className="liquid-glass-nested text-[11px] leading-relaxed p-3 rounded-2xl border"
                    style={{color: LIQUID_GLASS.textMuted}}
                  >
                    في متصفح Safari على iPhone/iPad: اضغط زر المشاركة ثم اختر «إضافة إلى الشاشة الرئيسية».
                  </p>
                )}
              </div>
            )}
          </section>

          {/* 7. Microphone recitation analyzer & upcoming tools */}
          <section className="space-y-2.5 pb-3">
            <div className="font-bold text-xs" style={{color: LIQUID_GLASS.textSecondary}}>
              ٧. أدوات التلاوة والتحديثات
            </div>
            <button
              type="button"
              onClick={() => {
                onToggleRecitation();
                onClose();
              }}
              style={{color: LIQUID_GLASS.textPrimary}}
              className={`liquid-glass-interactive w-full p-3.5 rounded-[20px] border flex items-center justify-between gap-2 text-xs font-semibold ${
                recitationOpen ? 'liquid-glass-pill-active' : 'liquid-glass-nested'
              }`}
            >
              <span className="flex items-center gap-2">
                <Mic
                  className="w-4 h-4 shrink-0"
                  style={{color: LIQUID_GLASS.textPrimary}}
                  strokeWidth={1.8}
                />
                <span>تحليل التلاوة بالميكروفون</span>
              </span>
              <span style={{color: LIQUID_GLASS.textSecondary}}>
                {recitationOpen ? 'مفعّل' : 'فتح'}
              </span>
            </button>
            <div
              className="liquid-glass-nested p-3.5 rounded-[20px] border text-xs"
              style={{color: LIQUID_GLASS.textMuted}}
            >
              تخصيص تنبيهات الورد اليومي ومقارنة التلاوات قيد التطوير.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
