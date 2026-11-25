import {env, pipeline, type AutomaticSpeechRecognitionPipeline} from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

const PRIMARY_MODEL = 'onnx-community/whisper-small';
const FALLBACK_MODEL = 'Mustanad/whisper-base-ar-quran-onnx';

type DeviceKind = 'webgpu' | 'wasm';

interface TranscribeRequestMessage {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
}

interface WorkerProgressInfo {
  status?: string;
  file?: string;
  progress?: number;
}

let loadedTranscriber: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModelId: string | null = null;
let loadedDevice: DeviceKind = 'wasm';
let initPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

async function detectComputeDevice(): Promise<DeviceKind> {
  try {
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter?: () => Promise<unknown>}}).gpu;
    if (gpu && typeof gpu.requestAdapter === 'function') {
      const adapter = await gpu.requestAdapter();
      if (adapter) return 'webgpu';
    }
  } catch {
    // Fall back to WASM silently
  }
  return 'wasm';
}

function postWorkerMessage(payload: Record<string, unknown>): void {
  self.postMessage(payload);
}

async function getOrCreateTranscriber(requestId: number): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loadedTranscriber) {
    return loadedTranscriber;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const device = await detectComputeDevice();
    const progressCallback = (info: WorkerProgressInfo) => {
      if (typeof info.progress === 'number') {
        postWorkerMessage({
          type: 'progress',
          id: requestId,
          progress: Math.round(info.progress),
          file: info.file ?? '',
          status: info.status ?? 'progress',
        });
      }
    };

    try {
      const asr = await pipeline('automatic-speech-recognition', PRIMARY_MODEL, {
        device,
        dtype:
          device === 'webgpu'
            ? {encoder_model: 'fp32', decoder_model_merged: 'q4'}
            : 'q8',
        progress_callback: progressCallback,
      });
      loadedTranscriber = asr;
      loadedModelId = PRIMARY_MODEL;
      loadedDevice = device;
      return asr;
    } catch {
      const fallbackAsr = await pipeline('automatic-speech-recognition', FALLBACK_MODEL, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progressCallback,
      });
      loadedTranscriber = fallbackAsr;
      loadedModelId = FALLBACK_MODEL;
      loadedDevice = 'wasm';
      return fallbackAsr;
    }
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

self.addEventListener('message', async (event: MessageEvent<TranscribeRequestMessage>) => {
  const data = event.data;
  if (!data || data.type !== 'transcribe') return;

  const {id, audio} = data;
  try {
    const transcriber = await getOrCreateTranscriber(id);
    const isMultilingualWhisper = loadedModelId === PRIMARY_MODEL;

    const output = await transcriber(
      audio,
      isMultilingualWhisper
        ? {
            language: 'arabic',
            task: 'transcribe',
            chunk_length_s: 30,
            stride_length_s: 5,
          }
        : {
            chunk_length_s: 30,
            stride_length_s: 5,
          }
    );

    const rawText = Array.isArray(output)
      ? output.map((item) => item.text ?? '').join(' ')
      : output?.text ?? '';

    postWorkerMessage({
      type: 'result',
      id,
      text: rawText.trim(),
      modelId: loadedModelId ?? PRIMARY_MODEL,
      device: loadedDevice,
    });
  } catch (err) {
    postWorkerMessage({
      type: 'error',
      id,
      message:
        err instanceof Error && err.message
          ? err.message
          : 'تعذر تشغيل نموذج التعرف الصوتي المحلي في المتصفح.',
    });
  }
});
