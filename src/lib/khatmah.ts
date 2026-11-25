export const TOTAL_KHATMAH_PAGES = 604;
const KHATMAH_STORAGE_KEY = 'mushaf-khatmah-plan-v1';

export interface KhatmahPlan {
  id: string;
  targetDays: number;
  startPage: number;
  startDate: string; // YYYY-MM-DD (local)
  completedUntilPage: number; // 0..604 (0 if starting from page 1)
  completedDays: number;
  lastCompletedDate: string | null;
  lastCompletedPagesCount?: number;
  createdAt: number;
}

export interface KhatmahStatus {
  isFinished: boolean;
  todayDone: boolean;
  currentDayNumber: number;
  daysRemaining: number;
  remainingPages: number;
  todayPagesCount: number;
  todayStartPage: number;
  todayStopPage: number;
  nextPagesCount: number;
  nextStartPage: number;
  nextStopPage: number;
  progressPct: number;
}

export function getLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toArabicIndicDigits(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(/\d/g, (d) =>
    String.fromCharCode(0x0660 + Number(d))
  );
}

/**
 * Formats any dynamic page count cleanly in natural Arabic (never hardcodes "5").
 */
export function formatKhatmahPagesPhrase(
  count: number,
  role: 'subject' | 'object' = 'object'
): string {
  const safe = Math.max(0, Math.floor(count));
  if (safe === 1) return 'صفحة واحدة';
  if (safe === 2) return role === 'subject' ? 'صفحتان' : 'صفحتين';
  const unit = safe >= 3 && safe <= 10 ? 'صفحات' : 'صفحة';
  return `${toArabicIndicDigits(safe)} ${unit}`;
}

export function previewDailyPagesForTarget(targetDays: number, startPage = 1): {
  clampedDays: number;
  clampedStartPage: number;
  totalPagesToRead: number;
  dailyPages: number;
  firstDayStopPage: number;
} {
  const clampedStartPage = Math.max(1, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(startPage) || 1));
  const totalPagesToRead = TOTAL_KHATMAH_PAGES - (clampedStartPage - 1);
  const clampedDays = Math.max(1, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(targetDays) || 30));
  const dailyPages = Math.ceil(totalPagesToRead / clampedDays);
  const firstDayStopPage = Math.min(TOTAL_KHATMAH_PAGES, clampedStartPage + dailyPages - 1);
  return {
    clampedDays,
    clampedStartPage,
    totalPagesToRead,
    dailyPages,
    firstDayStopPage,
  };
}

export function createKhatmahPlan(params: {
  targetDays: number;
  startPage?: number;
  todayKey?: string;
}): KhatmahPlan {
  const preview = previewDailyPagesForTarget(params.targetDays, params.startPage ?? 1);
  const todayKey = params.todayKey ?? getLocalDateKey();
  return {
    id: `khatmah-${Date.now()}`,
    targetDays: preview.clampedDays,
    startPage: preview.clampedStartPage,
    startDate: todayKey,
    completedUntilPage: preview.clampedStartPage - 1,
    completedDays: 0,
    lastCompletedDate: null,
    createdAt: Date.now(),
  };
}

export function computeKhatmahStatus(
  plan: KhatmahPlan,
  todayKey = getLocalDateKey()
): KhatmahStatus {
  const completedUntil = Math.max(
    plan.startPage - 1,
    Math.min(TOTAL_KHATMAH_PAGES, plan.completedUntilPage)
  );
  const totalScope = Math.max(1, TOTAL_KHATMAH_PAGES - (plan.startPage - 1));
  const pagesRead = Math.max(0, completedUntil - (plan.startPage - 1));
  const remainingPages = Math.max(0, TOTAL_KHATMAH_PAGES - completedUntil);
  const isFinished = remainingPages === 0;
  const todayDone = !isFinished && plan.lastCompletedDate === todayKey;

  const daysRemaining = Math.max(1, plan.targetDays - plan.completedDays);
  const currentDayNumber = todayDone
    ? Math.min(plan.targetDays, plan.completedDays)
    : Math.min(plan.targetDays, plan.completedDays + 1);

  const todayPagesCount =
    isFinished || todayDone ? 0 : Math.min(remainingPages, Math.ceil(remainingPages / daysRemaining));
  const todayStartPage = isFinished
    ? TOTAL_KHATMAH_PAGES
    : Math.min(TOTAL_KHATMAH_PAGES, completedUntil + 1);
  const todayStopPage =
    isFinished || todayDone
      ? completedUntil
      : Math.min(TOTAL_KHATMAH_PAGES, todayStartPage + todayPagesCount - 1);

  // Next scheduled day preview (used after today's wird is marked done, or as tomorrow's preview)
  const remainingAfterToday = todayDone ? remainingPages : Math.max(0, remainingPages - todayPagesCount);
  const daysRemainingAfterToday = todayDone ? daysRemaining : Math.max(1, daysRemaining - 1);
  const nextPagesCount =
    remainingAfterToday === 0
      ? 0
      : Math.min(remainingAfterToday, Math.ceil(remainingAfterToday / daysRemainingAfterToday));
  const nextStartPage =
    remainingAfterToday === 0
      ? TOTAL_KHATMAH_PAGES
      : Math.min(TOTAL_KHATMAH_PAGES, (todayDone ? completedUntil : todayStopPage) + 1);
  const nextStopPage =
    remainingAfterToday === 0
      ? TOTAL_KHATMAH_PAGES
      : Math.min(TOTAL_KHATMAH_PAGES, nextStartPage + nextPagesCount - 1);

  const progressPct = Math.min(100, Math.max(0, Math.round((pagesRead / totalScope) * 100)));

  return {
    isFinished,
    todayDone,
    currentDayNumber,
    daysRemaining,
    remainingPages,
    todayPagesCount,
    todayStartPage,
    todayStopPage,
    nextPagesCount,
    nextStartPage,
    nextStopPage,
    progressPct,
  };
}

export function completeTodayKhatmahWird(
  plan: KhatmahPlan,
  customReachedPage?: number,
  todayKey = getLocalDateKey()
): KhatmahPlan {
  const status = computeKhatmahStatus(plan, todayKey);
  if (status.isFinished) return plan;

  const targetStop =
    customReachedPage !== undefined && Number.isFinite(customReachedPage)
      ? Math.max(plan.completedUntilPage, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(customReachedPage)))
      : status.todayStopPage;

  const newlyCompletedPages = Math.max(1, targetStop - plan.completedUntilPage);
  const alreadyCountedToday = plan.lastCompletedDate === todayKey;

  return {
    ...plan,
    completedUntilPage: Math.max(plan.completedUntilPage, targetStop),
    completedDays: alreadyCountedToday ? plan.completedDays : plan.completedDays + 1,
    lastCompletedDate: todayKey,
    lastCompletedPagesCount: alreadyCountedToday
      ? (plan.lastCompletedPagesCount ?? 0) + Math.max(0, targetStop - plan.completedUntilPage)
      : newlyCompletedPages,
  };
}

export function buildKhatmahCompletionMessage(params: {
  pagesCompletedCount: number;
  reachedPage: number;
  nextStatus: KhatmahStatus;
}): string {
  const donePhrase = formatKhatmahPagesPhrase(params.pagesCompletedCount, 'object');
  if (params.nextStatus.isFinished) {
    return `تم قراءة ${donePhrase} والوصول إلى ص ${toArabicIndicDigits(params.reachedPage)} — تقبّل الله ختمتك الكاملة!`;
  }
  const nextPhrase = formatKhatmahPagesPhrase(params.nextStatus.nextPagesCount, 'object');
  return `تم قراءة ${donePhrase} (وصلت إلى ص ${toArabicIndicDigits(params.reachedPage)}) — في اليوم التالي اقرأ ${nextPhrase} حتى تصل إلى الصفحة رقم ${toArabicIndicDigits(params.nextStatus.nextStopPage)}`;
}

export type KhatmahCompletionTrigger =
  | {source: 'bookmark'; page: number}
  | {
      source: 'mic';
      page: number;
      matchedCount: number;
      totalExpectedWords: number;
      coveredLastAyah: boolean;
    };

export interface KhatmahAutoCompletionOutcome {
  completed: boolean;
  updatedPlan: KhatmahPlan;
  completedPagesCount: number;
  reachedPage: number;
  nextStatus: KhatmahStatus;
  message: string | null;
}

/**
 * Automatically detects when a reader has finished today's dynamic Khatmah target
 * via either placing a progress bookmark or reciting through the target stop page via microphone.
 */
export function evaluateKhatmahAutoCompletion(
  plan: KhatmahPlan,
  trigger: KhatmahCompletionTrigger,
  todayKey = getLocalDateKey()
): KhatmahAutoCompletionOutcome | null {
  const currentStatus = computeKhatmahStatus(plan, todayKey);
  if (currentStatus.isFinished || currentStatus.todayDone) {
    return null;
  }

  if (trigger.page < currentStatus.todayStopPage) {
    return null;
  }

  if (trigger.source === 'mic') {
    const minMatched = Math.min(3, Math.max(1, trigger.totalExpectedWords));
    if (trigger.matchedCount < minMatched) {
      return null;
    }
    const coverageRatio =
      trigger.totalExpectedWords > 0 ? trigger.matchedCount / trigger.totalExpectedWords : 0;
    const finishedStopPage =
      trigger.page > currentStatus.todayStopPage ||
      trigger.coveredLastAyah ||
      coverageRatio >= 0.45;
    if (!finishedStopPage) {
      return null;
    }
  }

  const updatedPlan = completeTodayKhatmahWird(plan, trigger.page, todayKey);
  const nextStatus = computeKhatmahStatus(updatedPlan, todayKey);
  const completedPagesCount =
    updatedPlan.lastCompletedPagesCount ?? Math.max(1, trigger.page - plan.completedUntilPage);

  return {
    completed: true,
    updatedPlan,
    completedPagesCount,
    reachedPage: updatedPlan.completedUntilPage,
    nextStatus,
    message: buildKhatmahCompletionMessage({
      pagesCompletedCount: completedPagesCount,
      reachedPage: updatedPlan.completedUntilPage,
      nextStatus,
    }),
  };
}

export function loadKhatmahPlan(): KhatmahPlan | null {
  try {
    const raw = localStorage.getItem(KHATMAH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<KhatmahPlan>;
    if (
      typeof parsed.targetDays !== 'number' ||
      typeof parsed.completedUntilPage !== 'number' ||
      typeof parsed.startPage !== 'number'
    ) {
      return null;
    }
    return {
      id: parsed.id ?? 'khatmah-1',
      targetDays: Math.max(1, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(parsed.targetDays))),
      startPage: Math.max(1, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(parsed.startPage))),
      startDate: parsed.startDate ?? getLocalDateKey(),
      completedUntilPage: Math.max(0, Math.min(TOTAL_KHATMAH_PAGES, Math.floor(parsed.completedUntilPage))),
      completedDays: Math.max(0, Math.floor(parsed.completedDays ?? 0)),
      lastCompletedDate: parsed.lastCompletedDate ?? null,
      lastCompletedPagesCount:
        typeof parsed.lastCompletedPagesCount === 'number'
          ? Math.max(1, Math.floor(parsed.lastCompletedPagesCount))
          : undefined,
      createdAt: parsed.createdAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveKhatmahPlan(plan: KhatmahPlan | null): void {
  try {
    if (!plan) {
      localStorage.removeItem(KHATMAH_STORAGE_KEY);
    } else {
      localStorage.setItem(KHATMAH_STORAGE_KEY, JSON.stringify(plan));
    }
  } catch {
    // Ignore storage quota errors
  }
}
