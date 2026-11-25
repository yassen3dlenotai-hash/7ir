import {
  AlertCircle,
  BookCheck,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Loader2,
  Mic,
  Square,
  X,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {LIQUID_GLASS} from '../lib/liquidGlass';
import {loadTafsirResilient} from '../lib/mushafStore';
import type {PerformanceProfile} from '../lib/performanceProfile';
import type {
  RecitationAlignmentReport,
  TajweedRuleEvaluation,
} from '../lib/recitationAligner';
import {toArabicIndic, type TafsirAyahItem} from '../types/mushaf';
import {LiquidGlassSurface} from './LiquidGlassSurface';

interface EngineStatus {
  available: boolean;
  reason: string | null;
  selectedModel: string | null;
}

interface AnalysisResponse {
  modelUsed: string;
  alignment: RecitationAlignmentReport;
  tajweedStatus: {
    calibrated: boolean;
    correctCount?: number;
    needsAttentionCount?: number;
    uncertainCount?: number;
    findings?: TajweedRuleEvaluation[];
    note: string;
  };
}

interface Props {
  open: boolean;
  currentPage: number;
  focusSurahNumber?: number;
  focusAyahNumber?: number;
  bottomOffsetClass?: string;
  performanceProfile: PerformanceProfile;
  onRecitationEvaluated?: (info: {
    page: number;
    alignment: RecitationAlignmentReport;
    pageAyahs: TafsirAyahItem[];
  }) => string | null;
  onClose: () => void;
}

export function RecitationFloatingPanel({
  open,
  currentPage,
  focusSurahNumber,
  focusAyahNumber,
  bottomOffsetClass = 'bottom-[70px]',
  performanceProfile,
  onRecitationEvaluated,
  onClose,
}: Props) {
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [checkingEngine, setCheckingEngine] = useState(false);
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadedPageData, setLoadedPageData] = useState<{
    page: number;
    ayahs: TafsirAyahItem[];
  } | null>(null);
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [khatmahNotice, setKhatmahNotice] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const peakMicLevelRef = useRef<number>(0);

  const currentPageRef = useRef(currentPage);
  const loadedPageDataRef = useRef<{page: number; ayahs: TafsirAyahItem[]} | null>(loadedPageData);
  const focusSurahRef = useRef(focusSurahNumber);
  const focusAyahRef = useRef(focusAyahNumber);
  const onRecitationEvaluatedRef = useRef(onRecitationEvaluated);

  currentPageRef.current = currentPage;
  loadedPageDataRef.current = loadedPageData;
  focusSurahRef.current = focusSurahNumber;
  focusAyahRef.current = focusAyahNumber;
  onRecitationEvaluatedRef.current = onRecitationEvaluated;

  const stopHardware = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
      }
    } catch {
      // Ignore already-stopped recorder
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setRecording(false);
    setMicLevel(0);
  }, []);

  useEffect(() => {
    if (!open) {
      stopHardware();
      setDetailsExpanded(false);
      return;
    }

    let active = true;
    setCheckingEngine(true);
    setErrorMsg(null);
    setResult(null);

    fetch('/api/recitation/status')
      .then(async (r) => {
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) {
          return {
            available: false,
            reason:
              'تشغيل التحليل الصوتي يتطلب نشر المشروع عبر Git/CLI في Netlify (مع Netlify Functions) وإضافة GEMINI_API_KEY في متغيرات البيئة.',
            selectedModel: null,
          };
        }
        return r.json();
      })
      .catch(() => ({
        available: false,
        reason: 'تعذر الاتصال بخادم تحليل التلاوة.',
        selectedModel: null,
      }))
      .then((status) => {
        if (!active) return;
        setEngineStatus(status as EngineStatus);
      })
      .finally(() => {
        if (active) setCheckingEngine(false);
      });

    return () => {
      active = false;
      stopHardware();
    };
  }, [open, stopHardware]);

  useEffect(() => {
    if (!open) return;
    let active = true;

    // Immediately drop previous page's ayahs & stale result when navigating to another page
    if (loadedPageDataRef.current?.page !== currentPage) {
      loadedPageDataRef.current = null;
      setLoadedPageData(null);
      setResult(null);
      setKhatmahNotice(null);
      setErrorMsg(null);
      setDetailsExpanded(false);
    }

    loadTafsirResilient(currentPage)
      .then((payload) => {
        if (!active) return;
        const nextData = {page: currentPage, ayahs: payload?.ayahs ?? []};
        loadedPageDataRef.current = nextData;
        setLoadedPageData(nextData);
      })
      .catch(() => {
        if (!active) return;
        const emptyData = {page: currentPage, ayahs: []};
        loadedPageDataRef.current = emptyData;
        setLoadedPageData(emptyData);
      });
    return () => {
      active = false;
    };
  }, [open, currentPage]);

  const sendForAnalysis = async (blob: Blob, mimeType: string) => {
    // Strictly lock evaluation to the CURRENT active page only — never previous or next pages
    const targetPage = currentPageRef.current;
    let targetAyahs =
      loadedPageDataRef.current?.page === targetPage ? loadedPageDataRef.current.ayahs : [];

    setAnalyzing(true);
    setErrorMsg(null);
    setKhatmahNotice(null);
    try {
      if (targetAyahs.length === 0) {
        const freshPayload = await loadTafsirResilient(targetPage);
        targetAyahs = freshPayload?.ayahs ?? [];
        const synced = {page: targetPage, ayahs: targetAyahs};
        loadedPageDataRef.current = synced;
        setLoadedPageData(synced);
      }

      if (targetAyahs.length === 0) {
        setErrorMsg('تعذر تحميل نص آيات الصفحة الحالية للمطابقة.');
        setDetailsExpanded(true);
        return;
      }

      // Only forward focusSurah/focusAyah when they actually exist inside the active target page
      const hasValidFocus =
        focusSurahRef.current !== undefined &&
        focusAyahRef.current !== undefined &&
        targetAyahs.some(
          (a) =>
            a.surahNumber === focusSurahRef.current &&
            a.ayahNumber === focusAyahRef.current
        );

      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const audioBase64 = btoa(binary);

      const res = await fetch('/api/recitation/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          page: targetPage,
          focusSurahNumber: hasValidFocus ? focusSurahRef.current : targetAyahs[0]?.surahNumber,
          focusAyahNumber: hasValidFocus ? focusAyahRef.current : targetAyahs[0]?.ayahNumber,
          expectedAyahs: targetAyahs.map((a) => ({
            surahNumber: a.surahNumber,
            ayahNumber: a.ayahNumber,
            text: a.text,
          })),
        }),
      });

      const rawText = await res.text();
      let parsedBody: Record<string, unknown> | null = null;
      try {
        parsedBody = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        parsedBody = null;
      }

      if (!res.ok || !parsedBody) {
        const serverError =
          parsedBody && typeof parsedBody.error === 'string' && parsedBody.error.trim()
            ? parsedBody.error
            : res.status === 502 || res.status === 503 || res.status === 504
            ? 'خادم التحليل الصوتي مزدحم أو انتهت المهلة مؤقتاً — يرجى إعادة المحاولة.'
            : res.status === 413
            ? 'التسجيل الصوتي طويل جداً — يرجى قراءة مقطع أقصر.'
            : 'تعذر إتمام تحليل التلاوة من الخادم — يرجى إعادة المحاولة.';
        throw new Error(serverError);
      }

      const payload = parsedBody as unknown as AnalysisResponse;
      setResult(payload);
      const notice =
        onRecitationEvaluatedRef.current?.({
          page: targetPage,
          alignment: payload.alignment,
          pageAyahs: targetAyahs,
        }) ?? null;
      setKhatmahNotice(notice);

      const report = payload.alignment;
      const tajweedNeedsAttention = (payload.tajweedStatus.needsAttentionCount ?? 0) > 0;
      if (
        report.alteredCount > 0 ||
        report.unclearCount > 0 ||
        report.skippedCount > 0 ||
        tajweedNeedsAttention ||
        notice
      ) {
        setDetailsExpanded(true);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحليل التلاوة.');
      setDetailsExpanded(true);
    } finally {
      setAnalyzing(false);
    }
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setResult(null);
    setKhatmahNotice(null);
    setDetailsExpanded(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg('المتصفح الحالي لا يدعم الوصول إلى الميكروفون.');
      setDetailsExpanded(true);
      return;
    }

    try {
      let stream: MediaStream;
      try {
        // Keep noiseSuppression off so soft interdental fricatives (ذ / ث / ظ) are not smeared into stops (د / ت)
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({audio: true});
      }
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tickMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((acc, v) => acc + v, 0) / dataArray.length;
        const level = Math.min(100, Math.round((avg / 115) * 100));
        if (level > peakMicLevelRef.current) {
          peakMicLevelRef.current = level;
        }
        setMicLevel(level);
        rafRef.current = requestAnimationFrame(tickMeter);
      };
      peakMicLevelRef.current = 0;
      rafRef.current = requestAnimationFrame(tickMeter);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {type: mimeType.split(';')[0]});
        if (blob.size < 400 || peakMicLevelRef.current < 2) {
          setErrorMsg('لم يُلتقط صوت تلاوة واضح — يرجى القراءة بصوت مسموع ثم الإيقاف.');
          setDetailsExpanded(true);
          return;
        }
        await sendForAnalysis(blob, mimeType.split(';')[0]);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setErrorMsg('تم رفض إذن الميكروفون أو تعذر تشغيله.');
      setDetailsExpanded(true);
    }
  };

  const stopAndAnalyze = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setRecording(false);
    setMicLevel(0);
  };

  if (!open) return null;

  const hasExpandableDetails = Boolean(
    result || errorMsg || (engineStatus && !engineStatus.available)
  );

  const issueWords =
    result?.alignment.words.filter((w) => w.status !== 'matched') ?? [];

  const statusLabel = analyzing
    ? 'جاري تحليل التلاوة...'
    : recording
    ? `جاري الاستماع · ص ${toArabicIndic(currentPage)}`
    : result
    ? `${toArabicIndic(result.alignment.matchedCount)} صحيحة · ${toArabicIndic(
        result.alignment.alteredCount
      )} اختلاف · ${toArabicIndic(result.alignment.unclearCount)} غير واضح`
    : checkingEngine
    ? 'جاري تجهيز الميكروفون...'
    : errorMsg
    ? 'تعذر الإتمام · اضغط للتفاصيل'
    : engineStatus && !engineStatus.available
    ? 'الميكروفون جاهز · خادم الذكاء غير مفعّل'
    : `جاهز للتلاوة · ص ${toArabicIndic(currentPage)}`;

  return (
    <div
      className={`fixed ${bottomOffsetClass} left-1/2 -translate-x-1/2 w-[calc(100vw-24px)] max-w-[440px] z-40 pointer-events-none flex flex-col gap-2 transition-all duration-200`}
    >
      {/* Compact expandable word-details card directly above the Mini Player */}
      {detailsExpanded && hasExpandableDetails && (
        <div
          style={{color: LIQUID_GLASS.textPrimary}}
          className="liquid-glass-frosted glass-panel-enter pointer-events-auto relative rounded-[24px] border max-h-[44dvh] flex flex-col overflow-hidden text-xs"
        >
          <LiquidGlassSurface
            performanceProfile={performanceProfile}
            tier="frosted"
            cornerRadius={24}
          />

          <div className="relative z-10 p-4 space-y-3 overflow-y-auto liquid-glass-scroll">
            {engineStatus && !engineStatus.available && !result && (
              <div className="flex items-start gap-2 leading-relaxed">
                <AlertCircle
                  className="w-4 h-4 shrink-0 mt-0.5"
                  style={{color: LIQUID_GLASS.textPrimary}}
                  strokeWidth={1.8}
                />
                <div className="space-y-1">
                  <div className="font-semibold" style={{color: LIQUID_GLASS.textPrimary}}>
                    محرك المطابقة غير مفعّل حالياً
                  </div>
                  <p style={{color: LIQUID_GLASS.textMuted}}>
                    {engineStatus.reason || 'لم يتم التحقق من جاهزية نموذج التعرف الصوتي على الخادم.'}
                  </p>
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="text-xs text-red-500 dark:text-red-400 leading-relaxed">{errorMsg}</div>
            )}

            {khatmahNotice && (
              <div
                className="liquid-glass-pill-active px-3.5 py-2.5 rounded-2xl border text-[11.5px] font-semibold flex items-start gap-2 leading-relaxed"
                style={{borderColor: 'rgba(16, 185, 129, 0.35)'}}
              >
                <BookCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" strokeWidth={2} />
                <span>{khatmahNotice}</span>
              </div>
            )}

            {result && (
              <div className="space-y-2.5">
                <div
                  className="flex flex-wrap items-center justify-between gap-2 text-[11px]"
                  style={{color: LIQUID_GLASS.textMuted}}
                >
                  <span>نتيجة مطابقة الكلمات والحركات</span>
                  <span className="tabular-nums">
                    صحيحة {toArabicIndic(result.alignment.matchedCount)} · اختلاف{' '}
                    {toArabicIndic(result.alignment.alteredCount)} · غير واضح{' '}
                    {toArabicIndic(result.alignment.unclearCount)} · متجاوزة{' '}
                    {toArabicIndic(result.alignment.skippedCount)}
                  </span>
                </div>

                {result.alignment.words.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 leading-loose">
                    {result.alignment.words.map((w, idx) => (
                      <span
                        key={`${w.surahNumber}-${w.ayahNumber}-${idx}`}
                        title={
                          w.reason ??
                          (w.spoken ? `المنطوق: ${w.spoken}` : 'مطابقة صحيحة')
                        }
                        className={`px-2 py-0.5 rounded-xl text-xs border ${
                          w.status === 'matched'
                            ? 'liquid-glass-nested text-inherit'
                            : w.status === 'unclear'
                            ? 'bg-neutral-400/15 border-dashed border-neutral-400/40'
                            : w.status === 'skipped'
                            ? 'bg-amber-500/12 border-amber-500/30 text-amber-700 dark:text-amber-200 line-through'
                            : 'bg-red-500/12 border-red-500/30 text-red-700 dark:text-red-200'
                        }`}
                      >
                        {w.expected}
                      </span>
                    ))}
                  </div>
                )}

                {issueWords.length > 0 && (
                  <div className="space-y-1.5">
                    {issueWords.map((w, idx) => (
                      <div
                        key={`note-${w.surahNumber}-${w.ayahNumber}-${idx}`}
                        className="liquid-glass-nested px-3 py-2 rounded-2xl border text-[11px] flex items-start justify-between gap-2"
                        style={{
                          borderColor:
                            w.status === 'unclear'
                              ? LIQUID_GLASS.borderHairline
                              : w.status === 'skipped'
                              ? 'rgba(245, 158, 11, 0.30)'
                              : 'rgba(248, 113, 113, 0.32)',
                        }}
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 font-semibold">
                            {w.status === 'unclear' && (
                              <HelpCircle
                                className="w-3.5 h-3.5 shrink-0"
                                style={{color: LIQUID_GLASS.textMuted}}
                              />
                            )}
                            <span style={{color: LIQUID_GLASS.textPrimary}}>{w.expected}</span>
                            {w.spoken && w.status === 'altered' && (
                              <span className="text-red-600 dark:text-red-300 font-normal">
                                ← المنطوق: {w.spoken}
                              </span>
                            )}
                          </div>
                          {w.reason && (
                            <p style={{color: LIQUID_GLASS.textMuted}}>{w.reason}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {result.tajweedStatus.findings && result.tajweedStatus.findings.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-black/10 dark:border-white/10">
                    <div
                      className="flex items-center justify-between text-[11px]"
                      style={{color: LIQUID_GLASS.textMuted}}
                    >
                      <span>فحص المخارج والتجويد السمعي</span>
                      <span className="tabular-nums">
                        سليم {toArabicIndic(result.tajweedStatus.correctCount ?? 0)} · تنبيه{' '}
                        {toArabicIndic(result.tajweedStatus.needsAttentionCount ?? 0)}
                      </span>
                    </div>
                    {result.tajweedStatus.findings.map((f, idx) => (
                      <div
                        key={`tajweed-${idx}`}
                        className="liquid-glass-nested px-3 py-2 rounded-2xl border text-[11px] space-y-0.5"
                        style={{
                          borderColor:
                            f.status === 'needs_attention'
                              ? 'rgba(248, 113, 113, 0.34)'
                              : f.status === 'uncertain'
                              ? LIQUID_GLASS.borderHairline
                              : 'rgba(16, 185, 129, 0.28)',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <span style={{color: LIQUID_GLASS.textPrimary}}>
                            {f.word} — {f.rule}
                          </span>
                          <span
                            className={
                              f.status === 'needs_attention'
                                ? 'text-red-600 dark:text-red-300'
                                : f.status === 'uncertain'
                                ? 'opacity-70'
                                : 'text-emerald-700 dark:text-emerald-300'
                            }
                          >
                            {f.status === 'needs_attention'
                              ? 'يحتاج تصحيح'
                              : f.status === 'uncertain'
                              ? 'غير واضح'
                              : 'سليم'}
                          </span>
                        </div>
                        <p style={{color: LIQUID_GLASS.textMuted}}>{f.detail}</p>
                      </div>
                    ))}
                  </div>
                )}

                <p className="text-[11px] leading-relaxed" style={{color: LIQUID_GLASS.textMuted}}>
                  {result.tajweedStatus.note}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Non-blocking Floating Microphone Mini Player */}
      <div
        style={{color: LIQUID_GLASS.textPrimary}}
        className="liquid-glass-pill glass-panel-enter pointer-events-auto relative rounded-full border overflow-hidden"
      >
        <LiquidGlassSurface
          performanceProfile={performanceProfile}
          tier="pill"
          cornerRadius="pill"
        />

        <div className="relative z-10 px-2.5 py-2 flex items-center gap-2.5">
          {/* Primary Mic / Stop action button */}
          {!recording ? (
            <button
              type="button"
              disabled={analyzing}
              onClick={startRecording}
              aria-label="بدء الاستماع للتلاوة"
              style={{color: LIQUID_GLASS.textPrimary}}
              className="liquid-glass-pill-active liquid-glass-interactive w-10 h-10 rounded-full border flex items-center justify-center shrink-0 disabled:opacity-50"
            >
              {analyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.9} />
              ) : (
                <Mic className="w-4 h-4" strokeWidth={1.9} />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopAndAnalyze}
              aria-label="إيقاف التسجيل وتحليل التلاوة"
              className="liquid-glass-interactive w-10 h-10 rounded-full border border-red-400/45 bg-red-500/20 text-red-600 dark:text-red-300 flex items-center justify-center shrink-0"
            >
              <Square className="w-4 h-4 fill-current" strokeWidth={1.75} />
            </button>
          )}

          {/* Short status + reactive mic audio level bars */}
          <button
            type="button"
            onClick={() => {
              if (hasExpandableDetails) setDetailsExpanded((v) => !v);
            }}
            className="flex-1 min-w-0 text-right flex items-center justify-between gap-2 py-1"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate" style={{color: LIQUID_GLASS.textPrimary}}>
                {statusLabel}
              </div>
            </div>

            {recording && (
              <div className="flex items-end gap-[3px] h-4 shrink-0" aria-hidden="true">
                {[0.55, 1.0, 0.72].map((mult, i) => (
                  <span
                    key={i}
                    style={{
                      height: `${Math.max(22, Math.min(100, micLevel * mult))}%`,
                      backgroundColor: LIQUID_GLASS.accent,
                    }}
                    className="w-[3px] rounded-full transition-[height] duration-75"
                  />
                ))}
              </div>
            )}

            {!recording && hasExpandableDetails && (
              <span
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center lg-hover-surface"
                style={{color: LIQUID_GLASS.textSecondary}}
              >
                {detailsExpanded ? (
                  <ChevronDown className="w-4 h-4" strokeWidth={1.85} />
                ) : (
                  <ChevronUp className="w-4 h-4" strokeWidth={1.85} />
                )}
              </span>
            )}
          </button>

          {/* Close / Dismiss Mini Player */}
          <button
            type="button"
            onClick={() => {
              stopHardware();
              onClose();
            }}
            aria-label="إغلاق الميكروفون"
            style={{color: LIQUID_GLASS.textMuted}}
            className="liquid-glass-interactive w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>
    </div>
  );
}
