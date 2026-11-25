import {
  BookCheck,
  Bookmark,
  BookmarkPlus,
  CalendarDays,
  CheckCircle2,
  RotateCcw,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {useMemo, useState} from 'react';
import {findFurthestBookmarkId, sortBookmarksByNewestFirst} from '../lib/bookmarks';
import {
  computeKhatmahStatus,
  createKhatmahPlan,
  formatKhatmahPagesPhrase,
  previewDailyPagesForTarget,
  type KhatmahPlan,
} from '../lib/khatmah';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import type {PerformanceProfile} from '../lib/performanceProfile';
import type {ReadingPosition} from '../lib/readingPosition';
import {getSurah, toArabicIndic, type ProgressBookmark} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface Props {
  open: boolean;
  bookmarks: ProgressBookmark[];
  currentPosition: ReadingPosition;
  performanceProfile: PerformanceProfile;
  khatmahPlan: KhatmahPlan | null;
  onSaveCurrentPosition: () => void;
  onJumpToBookmark: (bookmark: ProgressBookmark) => void;
  onDeleteBookmark: (id: string) => void;
  onJumpToPage: (page: number) => void;
  onStartKhatmahPlan: (plan: KhatmahPlan) => void;
  onCompleteTodayKhatmah: (reachedPage?: number) => void;
  onResetKhatmahPlan: () => void;
  onClose: () => void;
}

function formatBookmarkTimestamp(ts: number): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

const PRESET_DAYS = [7, 15, 30, 60, 121];

export function BookmarksFloatingPanel({
  open,
  bookmarks,
  currentPosition,
  performanceProfile,
  khatmahPlan,
  onSaveCurrentPosition,
  onJumpToBookmark,
  onDeleteBookmark,
  onJumpToPage,
  onStartKhatmahPlan,
  onCompleteTodayKhatmah,
  onResetKhatmahPlan,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<'bookmarks' | 'khatmah'>('bookmarks');
  const [daysInput, setDaysInput] = useState<string>(
    String(khatmahPlan?.targetDays ?? 30)
  );
  const [startFromCurrent, setStartFromCurrent] = useState<boolean>(false);
  const [editingPlan, setEditingPlan] = useState<boolean>(false);

  const khatmahStatus = useMemo(
    () => (khatmahPlan ? computeKhatmahStatus(khatmahPlan) : null),
    [khatmahPlan]
  );

  const parsedDays = Number.parseInt(daysInput, 10);
  const effectiveDays = Number.isFinite(parsedDays) && parsedDays >= 1 ? parsedDays : 30;
  const startPageChoice = startFromCurrent ? currentPosition.page : 1;
  const preview = useMemo(
    () => previewDailyPagesForTarget(effectiveDays, startPageChoice),
    [effectiveDays, startPageChoice]
  );

  if (!open) return null;

  const furthestId = findFurthestBookmarkId(bookmarks);
  const ordered = sortBookmarksByNewestFirst(bookmarks);
  const currentSurah = getSurah(currentPosition.surahNumber);
  const showSetupForm = !khatmahPlan || editingPlan;

  return (
    <div
      className="fixed inset-x-0 top-0 bottom-[70px] z-35 flex items-end justify-center px-3 sm:px-4 pb-2"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-frosted glass-panel-enter relative w-full max-w-lg rounded-[28px] border max-h-[72dvh] flex flex-col overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="frosted"
          cornerRadius={28}
        />

        <div className="relative z-10 p-5 flex flex-col gap-3.5 min-h-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold" style={{color: LIQUID_GLASS.textPrimary}}>
                {activeTab === 'bookmarks' ? 'مواضع التقدم المحفوظة' : 'خطة تختيم القرآن الكريم'}
              </h2>
              <p className="text-[11px] mt-0.5" style={{color: LIQUID_GLASS.textMuted}}>
                {activeTab === 'bookmarks'
                  ? bookmarks.length > 0
                    ? `${toArabicIndic(bookmarks.length)} مواضع · النجمة المميزة لأبعد موضع في الترتيب القرآني`
                    : 'اضغط مطولاً على أي آية لحفظ موضع التقدم'
                  : 'حدد مدة الختم ليحسب لك التطبيق وردك اليومي ورقم صفحة التوقف'}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق المواضع والتختيم"
              style={{color: LIQUID_GLASS.textMuted}}
              className="liquid-glass-interactive w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" strokeWidth={1.85} />
            </button>
          </div>

          {/* 2-Tab Switcher: المواضع | تختيم */}
          <div className="liquid-glass-nested p-1 rounded-[20px] border grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('bookmarks')}
              style={{
                color:
                  activeTab === 'bookmarks'
                    ? LIQUID_GLASS.textPrimary
                    : LIQUID_GLASS.textMuted,
              }}
              className={`liquid-glass-interactive py-2 px-3 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                activeTab === 'bookmarks' ? 'liquid-glass-pill-active' : 'border-transparent'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" strokeWidth={1.8} />
              <span>المواضع</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('khatmah')}
              style={{
                color:
                  activeTab === 'khatmah'
                    ? LIQUID_GLASS.textPrimary
                    : LIQUID_GLASS.textMuted,
              }}
              className={`liquid-glass-interactive relative py-2 px-3 rounded-2xl border text-xs font-semibold flex items-center justify-center gap-1.5 ${
                activeTab === 'khatmah' ? 'liquid-glass-pill-active' : 'border-transparent'
              }`}
            >
              <BookCheck className="w-3.5 h-3.5" strokeWidth={1.8} />
              <span>تختيم</span>
              {khatmahStatus && !khatmahStatus.todayDone && !khatmahStatus.isFinished && (
                <span
                  aria-label="ورد اليوم متاح"
                  className="w-2 h-2 rounded-full bg-emerald-500"
                />
              )}
            </button>
          </div>

          {activeTab === 'bookmarks' ? (
            <>
              {/* Synced active reading position bar */}
              <div className="liquid-glass-nested px-3.5 py-2.5 rounded-[20px] border flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10.5px] font-semibold" style={{color: LIQUID_GLASS.textMuted}}>
                    موضع القراءة الحالي
                  </div>
                  <div className="text-xs font-semibold truncate" style={{color: LIQUID_GLASS.textPrimary}}>
                    سورة {currentSurah?.nameArabic ?? currentPosition.surahNumber} · الآية{' '}
                    {toArabicIndic(currentPosition.ayahNumber)} · ص{' '}
                    {toArabicIndic(currentPosition.page)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSaveCurrentPosition}
                  style={{color: LIQUID_GLASS.textPrimary}}
                  className="liquid-glass-pill-active liquid-glass-interactive px-3 py-2 rounded-full border text-[11px] font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" strokeWidth={1.85} />
                  حفظ الموضع
                </button>
              </div>

              <div className="flex-1 overflow-y-auto liquid-glass-scroll space-y-2 pr-0.5 min-h-0">
                {ordered.length === 0 ? (
                  <div className="liquid-glass-nested p-6 rounded-[20px] border text-center space-y-2">
                    <Bookmark
                      className="w-6 h-6 mx-auto"
                      style={{color: LIQUID_GLASS.textPrimary}}
                      strokeWidth={1.6}
                    />
                    <div className="text-xs font-semibold" style={{color: LIQUID_GLASS.textPrimary}}>
                      لا توجد مواضع محفوظة بعد
                    </div>
                    <p className="text-[11px] leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                      اضغط ضغطة مطولة على أي آية في صفحة المصحف واختر «حفظ موضع التقدم» أو احفظ موضع القراءة الحالي أعلاه.
                    </p>
                  </div>
                ) : (
                  ordered.map((bm) => {
                    const isFurthest = bm.id === furthestId;
                    const dateLabel = formatBookmarkTimestamp(bm.createdAt);

                    return (
                      <div
                        key={bm.id}
                        className={`rounded-[20px] border flex items-center justify-between gap-2 p-2.5 transition-colors ${
                          isFurthest ? 'liquid-glass-pill-active' : 'liquid-glass-nested'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onJumpToBookmark(bm);
                            onClose();
                          }}
                          className="liquid-glass-interactive flex-1 min-w-0 text-right flex items-center gap-2.5 px-2 py-1.5 rounded-2xl"
                        >
                          <span className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full">
                            {isFurthest ? (
                              <Star
                                aria-label="أبعد موضع تقدم"
                                className="w-4 h-4"
                                style={{
                                  color: LIQUID_GLASS.textPrimary,
                                  fill: LIQUID_GLASS.textPrimary,
                                }}
                                strokeWidth={1.8}
                              />
                            ) : (
                              <Bookmark
                                className="w-4 h-4"
                                style={{color: LIQUID_GLASS.textSecondary}}
                                strokeWidth={1.7}
                              />
                            )}
                          </span>

                          <div className="min-w-0 flex-1">
                            <div
                              className="text-xs sm:text-[13px] font-semibold truncate"
                              style={{color: LIQUID_GLASS.textPrimary}}
                            >
                              سورة {bm.surahName} — الآية {toArabicIndic(bm.ayahNumber)} · ص{' '}
                              {toArabicIndic(bm.page)}
                            </div>
                            <div
                              className="text-[11px] mt-0.5 flex items-center gap-1.5 tabular-nums"
                              style={{color: LIQUID_GLASS.textMuted}}
                            >
                              <span>الجزء {toArabicIndic(bm.juz)}</span>
                              {dateLabel && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{dateLabel}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteBookmark(bm.id);
                          }}
                          aria-label={`حذف موضع سورة ${bm.surahName} الآية ${bm.ayahNumber}`}
                          style={{color: LIQUID_GLASS.textMuted}}
                          className="liquid-glass-interactive w-10 h-10 rounded-full flex items-center justify-center shrink-0 hover:text-red-500 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto liquid-glass-scroll space-y-3 pr-0.5 min-h-0">
              {showSetupForm ? (
                <div className="space-y-3">
                  <div className="liquid-glass-nested p-3.5 rounded-[20px] border space-y-3">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <CalendarDays className="w-4 h-4" strokeWidth={1.8} />
                      <span>في كم يوم تريد أن تختم القرآن؟</span>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_DAYS.map((d) => {
                        const active = effectiveDays === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDaysInput(String(d))}
                            style={{
                              color: active ? LIQUID_GLASS.textPrimary : LIQUID_GLASS.textMuted,
                            }}
                            className={`liquid-glass-interactive px-3 py-1.5 rounded-full border text-xs font-semibold tabular-nums ${
                              active ? 'liquid-glass-pill-active' : 'liquid-glass-nested'
                            }`}
                          >
                            {toArabicIndic(d)} {d <= 10 ? 'أيام' : 'يوماً'}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="text-[11px] shrink-0" style={{color: LIQUID_GLASS.textMuted}}>
                        أو أدخل عدد الأيام:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={604}
                        value={daysInput}
                        onChange={(e) => setDaysInput(e.target.value)}
                        className="lg-input flex-1 px-3 py-2 rounded-xl border text-xs font-mono tabular-nums"
                      />
                    </div>

                    <div className="liquid-glass-nested p-1 rounded-[16px] border grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setStartFromCurrent(false)}
                        style={{
                          color: !startFromCurrent
                            ? LIQUID_GLASS.textPrimary
                            : LIQUID_GLASS.textMuted,
                        }}
                        className={`liquid-glass-interactive py-1.5 px-2 rounded-xl border text-[11px] font-semibold ${
                          !startFromCurrent ? 'liquid-glass-pill-active' : 'border-transparent'
                        }`}
                      >
                        البدء من الصفحة ١
                      </button>
                      <button
                        type="button"
                        onClick={() => setStartFromCurrent(true)}
                        style={{
                          color: startFromCurrent
                            ? LIQUID_GLASS.textPrimary
                            : LIQUID_GLASS.textMuted,
                        }}
                        className={`liquid-glass-interactive py-1.5 px-2 rounded-xl border text-[11px] font-semibold tabular-nums ${
                          startFromCurrent ? 'liquid-glass-pill-active' : 'border-transparent'
                        }`}
                      >
                        من الصفحة الحالية (ص {toArabicIndic(currentPosition.page)})
                      </button>
                    </div>
                  </div>

                  {/* Live Mathematical Preview */}
                  <div className="liquid-glass-pill-active p-4 rounded-[20px] border space-y-1.5 text-right">
                    <div className="text-[11px] font-semibold" style={{color: LIQUID_GLASS.textMuted}}>
                      الحسبة الرياضية لختمتك ({toArabicIndic(preview.totalPagesToRead)} صفحة ÷{' '}
                      {toArabicIndic(preview.clampedDays)} يوماً)
                    </div>
                    <div className="text-sm font-bold tabular-nums">
                      اقترح عليك قراءة {formatKhatmahPagesPhrase(preview.dailyPages, 'object')} يومياً
                    </div>
                    <div className="text-xs tabular-nums" style={{color: LIQUID_GLASS.textSecondary}}>
                      في اليوم الأول: اقرأ من ص {toArabicIndic(preview.clampedStartPage)} وقف عند الصفحة رقم{' '}
                      <span className="font-bold">{toArabicIndic(preview.firstDayStopPage)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {editingPlan && khatmahPlan && (
                      <button
                        type="button"
                        onClick={() => setEditingPlan(false)}
                        style={{color: LIQUID_GLASS.textMuted}}
                        className="liquid-glass-nested liquid-glass-interactive px-4 py-2.5 rounded-full border text-xs font-semibold"
                      >
                        إلغاء
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const plan = createKhatmahPlan({
                          targetDays: preview.clampedDays,
                          startPage: preview.clampedStartPage,
                        });
                        onStartKhatmahPlan(plan);
                        setEditingPlan(false);
                      }}
                      style={{color: LIQUID_GLASS.textPrimary}}
                      className="liquid-glass-pill-active liquid-glass-interactive flex-1 py-2.5 px-4 rounded-full border text-xs font-bold"
                    >
                      اعتماد خطة التختيم
                    </button>
                  </div>
                </div>
              ) : (
                khatmahPlan &&
                khatmahStatus && (
                  <div className="space-y-3">
                    {/* Overall Progress Summary */}
                    <div className="liquid-glass-nested p-3.5 rounded-[20px] border space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold">
                          خطة {toArabicIndic(khatmahPlan.targetDays)} يوماً · اليوم{' '}
                          {toArabicIndic(khatmahStatus.currentDayNumber)}
                        </span>
                        <span className="font-bold tabular-nums" style={{color: LIQUID_GLASS.textPrimary}}>
                          {toArabicIndic(khatmahStatus.progressPct)}%
                        </span>
                      </div>
                      <div
                        className="w-full h-1.5 rounded-full overflow-hidden"
                        style={{backgroundColor: LIQUID_GLASS.trackBg}}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-200"
                          style={{
                            width: `${khatmahStatus.progressPct}%`,
                            backgroundColor: LIQUID_GLASS.accent,
                          }}
                        />
                      </div>
                      <div
                        className="flex items-center justify-between text-[11px] tabular-nums"
                        style={{color: LIQUID_GLASS.textMuted}}
                      >
                        <span>تم إنجازه: حتى ص {toArabicIndic(khatmahPlan.completedUntilPage)}</span>
                        <span>المتبقي: {toArabicIndic(khatmahStatus.remainingPages)} صفحة</span>
                      </div>
                    </div>

                    {khatmahStatus.isFinished ? (
                      <div className="liquid-glass-pill-active p-5 rounded-[20px] border text-center space-y-2.5">
                        <CheckCircle2 className="w-7 h-7 mx-auto text-emerald-500" strokeWidth={1.8} />
                        <div className="text-sm font-bold">
                          تقبّل الله! أتممت ختم القرآن الكريم كاملاً
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPlan(true);
                          }}
                          className="liquid-glass-pill-active liquid-glass-interactive px-4 py-2 rounded-full border text-xs font-semibold"
                        >
                          بدء ختمة جديدة
                        </button>
                      </div>
                    ) : khatmahStatus.todayDone ? (
                      <div className="liquid-glass-pill-active p-4 rounded-[20px] border space-y-2.5">
                        <div className="flex items-start gap-2 text-xs font-bold leading-relaxed">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" strokeWidth={2} />
                          <span>
                            تم قراءة{' '}
                            {khatmahPlan.lastCompletedPagesCount
                              ? formatKhatmahPagesPhrase(khatmahPlan.lastCompletedPagesCount, 'object')
                              : 'ورد اليوم'}{' '}
                            (وصلت إلى الصفحة رقم {toArabicIndic(khatmahPlan.completedUntilPage)})
                          </span>
                        </div>
                        <div
                          className="liquid-glass-nested p-3 rounded-2xl border text-xs space-y-1 tabular-nums"
                          style={{color: LIQUID_GLASS.textSecondary}}
                        >
                          <div className="font-semibold" style={{color: LIQUID_GLASS.textPrimary}}>
                            في اليوم التالي بإذن الله:
                          </div>
                          <div>
                            مطلوب قراءة {formatKhatmahPagesPhrase(khatmahStatus.nextPagesCount, 'object')}{' '}
                            أخرى حتى تصل إلى الصفحة رقم{' '}
                            <span className="font-bold">{toArabicIndic(khatmahStatus.nextStopPage)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onJumpToPage(khatmahStatus.nextStartPage);
                            onClose();
                          }}
                          className="liquid-glass-nested liquid-glass-interactive w-full py-2 px-3 rounded-full border text-xs font-semibold"
                        >
                          متابعة القراءة (ص {toArabicIndic(khatmahStatus.nextStartPage)})
                        </button>
                      </div>
                    ) : (
                      <div className="liquid-glass-pill-active p-4 rounded-[20px] border space-y-3">
                        <div className="space-y-1">
                          <div className="text-[11px] font-semibold" style={{color: LIQUID_GLASS.textMuted}}>
                            تذكير ورد اليوم ({toArabicIndic(khatmahStatus.currentDayNumber)} من{' '}
                            {toArabicIndic(khatmahPlan.targetDays)})
                          </div>
                          <div className="text-sm font-bold tabular-nums">
                            اقرأ اليوم {formatKhatmahPagesPhrase(khatmahStatus.todayPagesCount, 'object')}
                          </div>
                          <div className="text-xs tabular-nums" style={{color: LIQUID_GLASS.textSecondary}}>
                            ابدأ من الصفحة{' '}
                            <span className="font-bold">{toArabicIndic(khatmahStatus.todayStartPage)}</span>{' '}
                            وقف عند الصفحة رقم{' '}
                            <span className="font-bold">{toArabicIndic(khatmahStatus.todayStopPage)}</span>
                          </div>
                          <div className="text-[10.5px] leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                            يُحتسب الإنجاز تلقائياً عند حفظ موضع التقدم أو القراءة بالميكروفون حتى ص{' '}
                            {toArabicIndic(khatmahStatus.todayStopPage)}.
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToPage(khatmahStatus.todayStartPage);
                              onClose();
                            }}
                            className="liquid-glass-nested liquid-glass-interactive py-2.5 px-3 rounded-full border text-xs font-semibold"
                          >
                            الذهاب لص {toArabicIndic(khatmahStatus.todayStartPage)}
                          </button>
                          <button
                            type="button"
                            onClick={() => onCompleteTodayKhatmah()}
                            className="liquid-glass-pill-active liquid-glass-interactive py-2.5 px-3 rounded-full border text-xs font-bold flex items-center justify-center gap-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                            <span>أتممت ورد اليوم</span>
                          </button>
                        </div>

                        {currentPosition.page > khatmahStatus.todayStopPage && (
                          <button
                            type="button"
                            onClick={() => onCompleteTodayKhatmah(currentPosition.page)}
                            style={{color: LIQUID_GLASS.textSecondary}}
                            className="liquid-glass-nested liquid-glass-interactive w-full py-2 px-3 rounded-full border text-[11px] font-semibold tabular-nums"
                          >
                            تحديث التقدم للصفحة الحالية (ص {toArabicIndic(currentPosition.page)})
                          </button>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setDaysInput(String(khatmahPlan.targetDays));
                          setEditingPlan(true);
                        }}
                        style={{color: LIQUID_GLASS.textMuted}}
                        className="liquid-glass-interactive px-3 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.8} />
                        تعديل الخطة
                      </button>
                      <button
                        type="button"
                        onClick={onResetKhatmahPlan}
                        style={{color: LIQUID_GLASS.textMuted}}
                        className="liquid-glass-interactive px-3 py-1.5 rounded-full text-[11px] font-semibold hover:text-red-500 dark:hover:text-red-300"
                      >
                        حذف الخطة
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
