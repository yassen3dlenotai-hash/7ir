import {
  alignRecitationWords,
  extractSensitiveTajweedTargets,
  type ExpectedAyahText,
  type RecitationAlignmentReport,
  type TajweedRuleEvaluation,
} from '../lib/recitationAligner';

export interface LocalEngineStatus {
  available: boolean;
  reason: string | null;
  selectedModel: string | null;
}

export interface LocalAnalysisResponse {
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

export interface LocalRecitationAnalysisInput {
  blob: Blob;
  page: number;
  focusSurahNumber?: number;
  focusAyahNumber?: number;
  expectedAyahs: ExpectedAyahText[];
  onProgress?: (percent: number) => void;
}

interface WorkerMessagePayload {
  type: 'progress' | 'result' | 'error';
  id: number;
  progress?: number;
  text?: string;
  modelId?: string;
  device?: string;
  message?: string;
}

const TARGET_SAMPLE_RATE = 16000;
const INFERENCE_IDLE_TIMEOUT_MS = 90000;

let sharedWorker: Worker | null = null;
let nextRequestId = 1;

export function checkLocalAiSupport(): LocalEngineStatus {
  const hasWorker = typeof Worker !== 'undefined';
  const hasWasm = typeof WebAssembly !== 'undefined';
  const hasAudioContext =
    typeof AudioContext !== 'undefined' ||
    typeof (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext !==
      'undefined';

  if (!hasWorker || !hasWasm || !hasAudioContext) {
    return {
      available: false,
      reason:
        'المتصفح الحالي لا يدعم WebAssembly أو Web Workers أو Web Audio API اللازمة لتشغيل نموذج الذكاء الاصطناعي محلياً.',
      selectedModel: null,
    };
  }

  return {
    available: true,
    reason: null,
    selectedModel: 'onnx-community/whisper-small (محلي على المتصفح)',
  };
}

async function decodeAudioBlobTo16kHzMono(blob: Blob): Promise<Float32Array> {
  const AudioCtx =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;

  if (!AudioCtx) {
    throw new Error('المتصفح لا يدعم فك تشفير الصوت محلياً.');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer;
  try {
    decodedBuffer = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    await decodeCtx.close().catch(() => undefined);
  }

  const totalSamples = Math.max(1, Math.ceil(decodedBuffer.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, totalSamples, TARGET_SAMPLE_RATE);

  const monoMix = offlineCtx.createBuffer(
    1,
    decodedBuffer.length,
    decodedBuffer.sampleRate
  );
  const targetChannel = monoMix.getChannelData(0);
  const channelCount = decodedBuffer.numberOfChannels;

  for (let ch = 0; ch < channelCount; ch++) {
    const channelData = decodedBuffer.getChannelData(ch);
    for (let i = 0; i < channelData.length; i++) {
      targetChannel[i] += channelData[i] / channelCount;
    }
  }

  const source = offlineCtx.createBufferSource();
  source.buffer = monoMix;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

function measureAudioSignal(samples: Float32Array): {
  peak: number;
  rms: number;
  clarity: 'clear' | 'noisy' | 'unintelligible';
} {
  if (samples.length === 0) {
    return {peak: 0, rms: 0, clarity: 'unintelligible'};
  }

  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);

  if (peak < 0.008 || rms < 0.0015) {
    return {peak, rms, clarity: 'unintelligible'};
  }
  if (rms < 0.01) {
    return {peak, rms, clarity: 'noisy'};
  }
  return {peak, rms, clarity: 'clear'};
}

function getOrCreateWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(
      new URL('../lib/localRecitationWorker.ts', import.meta.url),
      {type: 'module'}
    );
  }
  return sharedWorker;
}

function runWorkerTranscription(
  audioFloat32: Float32Array,
  onProgress?: (percent: number) => void
): Promise<{text: string; modelId: string; device: string}> {
  const worker = getOrCreateWorker();
  const id = nextRequestId++;

  return new Promise((resolve, reject) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetIdleTimer = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cleanup();
        sharedWorker?.terminate();
        sharedWorker = null;
        reject(new Error('انتهت مهلة معالجة الصوت محلياً — يرجى إعادة المحاولة بمقطع أقصر.'));
      }, INFERENCE_IDLE_TIMEOUT_MS);
    };

    const cleanup = () => {
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    };

    const handleMessage = (event: MessageEvent<WorkerMessagePayload>) => {
      const payload = event.data;
      if (!payload || payload.id !== id) return;

      if (payload.type === 'progress') {
        resetIdleTimer();
        if (typeof payload.progress === 'number') {
          onProgress?.(payload.progress);
        }
        return;
      }

      if (payload.type === 'result') {
        cleanup();
        resolve({
          text: payload.text ?? '',
          modelId: payload.modelId ?? 'onnx-community/whisper-small',
          device: payload.device ?? 'wasm',
        });
        return;
      }

      if (payload.type === 'error') {
        cleanup();
        reject(new Error(payload.message || 'تعذر تشغيل نموذج التلاوة المحلي.'));
      }
    };

    const handleError = (err: ErrorEvent) => {
      cleanup();
      sharedWorker?.terminate();
      sharedWorker = null;
      reject(new Error(err.message || 'حدث خطأ في خيط الذكاء الاصطناعي المحلي.'));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    resetIdleTimer();

    // Transfer buffer ownership to worker for zero-copy overhead
    const transferable = new Float32Array(audioFloat32);
    worker.postMessage(
      {type: 'transcribe', id, audio: transferable},
      [transferable.buffer]
    );
  });
}

function buildLocalTajweedEvaluation(
  alignment: RecitationAlignmentReport
): LocalAnalysisResponse['tajweedStatus'] {
  const targets = extractSensitiveTajweedTargets(alignment.words);
  const findings: TajweedRuleEvaluation[] = [];

  for (const target of targets) {
    const word = alignment.words[target.wordIndex];
    if (!word) continue;

    if (word.status === 'altered') {
      findings.push({
        word: word.expected,
        rule: target.checkpoints[0],
        status: 'needs_attention',
        detail: word.reason || 'ظهر اختلاف في الحرف أو المخرج أثناء التلاوة',
        confidence: word.confidence ?? 0.75,
      });
    } else if (word.status === 'matched' && findings.length < 6) {
      findings.push({
        word: word.expected,
        rule: target.checkpoints[0],
        status: 'uncertain',
        detail:
          'نُطقت الكلمة سليمة لفظياً؛ تحقّق سمعياً من إتمام المخرج والغنة والمد بدقة.',
        confidence: 0.65,
      });
    }
  }

  const needsAttentionCount = findings.filter((f) => f.status === 'needs_attention').length;
  const uncertainCount = findings.filter((f) => f.status === 'uncertain').length;

  return {
    calibrated: false,
    correctCount: 0,
    needsAttentionCount,
    uncertainCount,
    findings,
    note: 'يعمل التحليل محلياً على جهازك بالكامل عبر نموذج Whisper العربي؛ يدقق الكلمات والحروف العربية بدقة دون خادم، بينما تتطلب أزمنة المدود والغنن مراجعة سمعية ذاتية.',
  };
}

export async function analyzeLocalRecitation(
  input: LocalRecitationAnalysisInput
): Promise<LocalAnalysisResponse> {
  const pcm16k = await decodeAudioBlobTo16kHzMono(input.blob);
  const signal = measureAudioSignal(pcm16k);

  if (signal.clarity === 'unintelligible') {
    const silentAlignment = alignRecitationWords('', input.expectedAyahs, {
      audioClarity: 'unintelligible',
      focusSurahNumber: input.focusSurahNumber,
      focusAyahNumber: input.focusAyahNumber,
    });
    return {
      modelUsed: 'on-device-signal-guard',
      alignment: silentAlignment,
      tajweedStatus: {
        calibrated: false,
        correctCount: 0,
        needsAttentionCount: 0,
        uncertainCount: 0,
        findings: [],
        note: 'لم يُرصد صوت واضح كافٍ للتحليل — يرجى التلاوة بصوت أوضح وأقرب للميكروفون.',
      },
    };
  }

  const {text, modelId, device} = await runWorkerTranscription(pcm16k, input.onProgress);

  const clarity: 'clear' | 'noisy' | 'unintelligible' =
    text.trim().length === 0 ? 'unintelligible' : signal.clarity;

  const alignment = alignRecitationWords(text, input.expectedAyahs, {
    audioClarity: clarity,
    focusSurahNumber: input.focusSurahNumber,
    focusAyahNumber: input.focusAyahNumber,
  });

  return {
    modelUsed: `${modelId} (${device})`,
    alignment,
    tajweedStatus: buildLocalTajweedEvaluation(alignment),
  };
}
