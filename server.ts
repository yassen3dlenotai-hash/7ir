import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';
import express from 'express';
import {
  alignRecitationWords,
  applyAcousticMakhrajAndTajweedAudit,
  extractSensitiveTajweedTargets,
  type AcousticMakhrajFinding,
  type ExpectedAyahText,
  type SpokenWordObservation,
  type TajweedRuleEvaluation,
} from './src/lib/recitationAligner.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const TOTAL_PAGES = 604;
const QURAN_SVG_BASE =
  'https://raw.githubusercontent.com/quran-ws/quran-svg/main/mushafs/hafs/kfqc';
const ALQURAN_CLOUD_BASE = 'https://api.alquran.cloud/v1';

const CACHE_ROOT = path.resolve(__dirname, '.mushaf-cache/hafs-kfqc');
const SVG_CACHE_DIR = path.join(CACHE_ROOT, 'svg');
const JSON_CACHE_DIR = path.join(CACHE_ROOT, 'json');
const SHA_CACHE_DIR = path.join(CACHE_ROOT, 'sha256');
const TAFSIR_CACHE_DIR = path.join(CACHE_ROOT, 'tafsir');

for (const dir of [SVG_CACHE_DIR, JSON_CACHE_DIR, SHA_CACHE_DIR, TAFSIR_CACHE_DIR]) {
  fs.mkdirSync(dir, {recursive: true});
}

function pageCode(page: number): string {
  return String(page).padStart(3, '0');
}

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ResolvedModelsCache {
  expiresAt: number;
  selectedModel: string | null;
  candidateModels: string[];
  availableModels: string[];
}

let modelsCache: ResolvedModelsCache | null = null;

async function resolveVerifiedAudioModel(ai: GoogleGenAI): Promise<{
  selectedModel: string | null;
  candidateModels: string[];
  availableModels: string[];
}> {
  if (modelsCache && Date.now() < modelsCache.expiresAt) {
    return {
      selectedModel: modelsCache.selectedModel,
      candidateModels: modelsCache.candidateModels,
      availableModels: modelsCache.availableModels,
    };
  }

  const availableModels: string[] = [];
  const pager = await ai.models.list();
  for await (const model of pager) {
    if (model.name) {
      availableModels.push(model.name.replace(/^models\//, ''));
    }
    if (availableModels.length >= 80) break;
  }

  const preferredOrder = [
    'gemini-4-hydrogen',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-flash-latest',
    'gemini-3.5-transcribe',
  ];

  const candidateModels = preferredOrder.filter((candidate) =>
    availableModels.includes(candidate)
  );

  for (const m of availableModels) {
    if (
      !candidateModels.includes(m) &&
      !m.startsWith('gemini-2.5-') &&
      !m.includes('image') &&
      !m.includes('tts') &&
      (m.includes('flash') || m.includes('hydrogen') || m.includes('transcribe'))
    ) {
      candidateModels.push(m);
    }
  }

  const selectedModel = candidateModels[0] ?? null;
  modelsCache = {
    expiresAt: Date.now() + 3 * 60 * 1000,
    selectedModel,
    candidateModels,
    availableModels,
  };
  return {selectedModel, candidateModels, availableModels};
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isRetryableModelError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not supported') ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('overloaded')
  );
}

async function fetchPageFromUpstream(page: number) {
  const code = pageCode(page);
  const svgPath = path.join(SVG_CACHE_DIR, `${code}.svg`);
  const jsonPath = path.join(JSON_CACHE_DIR, `${code}.json`);
  const shaPath = path.join(SHA_CACHE_DIR, `${code}.json`);

  if (fs.existsSync(svgPath) && fs.existsSync(jsonPath)) {
    const svg = fs.readFileSync(svgPath, 'utf-8');
    const jsonRaw = fs.readFileSync(jsonPath, 'utf-8');
    if (svg.includes('<svg') && jsonRaw.trim().startsWith('[')) {
      const shaMeta = fs.existsSync(shaPath)
        ? JSON.parse(fs.readFileSync(shaPath, 'utf-8'))
        : {svg: sha256(svg), json: sha256(jsonRaw)};
      return {
        page,
        svg,
        ayahs: JSON.parse(jsonRaw),
        sha256Svg: shaMeta.svg as string,
        sha256Json: shaMeta.json as string,
        cached: true,
      };
    }
  }

  const [svgRes, jsonRes] = await Promise.all([
    fetch(`${QURAN_SVG_BASE}/svg/${code}.svg`),
    fetch(`${QURAN_SVG_BASE}/json/${code}.json`),
  ]);

  if (!svgRes.ok || !jsonRes.ok) {
    throw new Error(`Upstream fetch failed for page ${code} (${svgRes.status}/${jsonRes.status})`);
  }

  const svg = await svgRes.text();
  const jsonRaw = await jsonRes.text();

  if (!svg.includes('<svg')) {
    throw new Error(`Invalid SVG payload for page ${code}`);
  }
  const ayahs = JSON.parse(jsonRaw);
  if (!Array.isArray(ayahs)) {
    throw new Error(`Invalid JSON payload for page ${code}`);
  }

  const shaSvg = sha256(svg);
  const shaJson = sha256(jsonRaw);

  const tmpSvg = `${svgPath}.part`;
  const tmpJson = `${jsonPath}.part`;
  fs.writeFileSync(tmpSvg, svg, 'utf-8');
  fs.renameSync(tmpSvg, svgPath);
  fs.writeFileSync(tmpJson, jsonRaw, 'utf-8');
  fs.renameSync(tmpJson, jsonPath);
  fs.writeFileSync(shaPath, JSON.stringify({svg: shaSvg, json: shaJson}), 'utf-8');

  return {
    page,
    svg,
    ayahs,
    sha256Svg: shaSvg,
    sha256Json: shaJson,
    cached: false,
  };
}

interface AlQuranCloudAyah {
  number: number;
  numberInSurah: number;
  text: string;
  audio?: string;
  surah: {
    number: number;
    name: string;
  };
}

async function fetchTafsirPageFromUpstream(page: number) {
  const code = pageCode(page);
  const cachePath = path.join(TAFSIR_CACHE_DIR, `${code}.json`);

  if (fs.existsSync(cachePath)) {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw);
  }

  const [muyassarRes, uthmaniRes] = await Promise.all([
    fetch(`${ALQURAN_CLOUD_BASE}/page/${page}/ar.muyassar`),
    fetch(`${ALQURAN_CLOUD_BASE}/page/${page}/quran-uthmani`),
  ]);

  if (!muyassarRes.ok || !uthmaniRes.ok) {
    throw new Error(`Failed to fetch Tafsir Al-Muyassar for page ${page}`);
  }

  const muyassarJson = (await muyassarRes.json()) as {data?: {ayahs?: AlQuranCloudAyah[]}};
  const uthmaniJson = (await uthmaniRes.json()) as {data?: {ayahs?: AlQuranCloudAyah[]}};

  const tafsirAyahs = muyassarJson.data?.ayahs ?? [];
  const uthmaniAyahs = uthmaniJson.data?.ayahs ?? [];

  const combined = uthmaniAyahs.map((item, idx) => {
    const tafsirMatch =
      tafsirAyahs.find(
        (t) => t.surah.number === item.surah.number && t.numberInSurah === item.numberInSurah
      ) ?? tafsirAyahs[idx];

    return {
      globalNumber: item.number,
      surahNumber: item.surah.number,
      surahName: item.surah.name,
      ayahNumber: item.numberInSurah,
      text: item.text,
      tafsirMuyassar: tafsirMatch?.text ?? '',
    };
  });

  const payload = {
    page,
    edition: 'ar.muyassar',
    ayahs: combined,
    sha256: sha256(JSON.stringify(combined)),
  };

  const tmp = `${cachePath}.part`;
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
  fs.renameSync(tmp, cachePath);

  return payload;
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '30mb'}));

  app.get('/api/mushaf/page/:page', async (req, res) => {
    const page = Number.parseInt(req.params.page, 10);
    if (!Number.isFinite(page) || page < 1 || page > TOTAL_PAGES) {
      res.status(400).json({error: 'Page must be between 1 and 604'});
      return;
    }

    try {
      const payload = await fetchPageFromUpstream(page);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to load Mushaf page',
      });
    }
  });

  app.get('/api/mushaf/tafsir/:page', async (req, res) => {
    const page = Number.parseInt(req.params.page, 10);
    if (!Number.isFinite(page) || page < 1 || page > TOTAL_PAGES) {
      res.status(400).json({error: 'Page must be between 1 and 604'});
      return;
    }

    try {
      const payload = await fetchTafsirPageFromUpstream(page);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.json(payload);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to load Tafsir Al-Muyassar',
      });
    }
  });

  app.get('/api/mushaf/status', (_req, res) => {
    const cachedPages: number[] = [];
    const cachedTafsirPages: number[] = [];
    let totalBytes = 0;

    for (let p = 1; p <= TOTAL_PAGES; p++) {
      const code = pageCode(p);
      const svgPath = path.join(SVG_CACHE_DIR, `${code}.svg`);
      const jsonPath = path.join(JSON_CACHE_DIR, `${code}.json`);
      const tafsirPath = path.join(TAFSIR_CACHE_DIR, `${code}.json`);
      if (fs.existsSync(svgPath) && fs.existsSync(jsonPath)) {
        cachedPages.push(p);
        totalBytes += fs.statSync(svgPath).size + fs.statSync(jsonPath).size;
      }
      if (fs.existsSync(tafsirPath)) {
        cachedTafsirPages.push(p);
        totalBytes += fs.statSync(tafsirPath).size;
      }
    }

    res.json({
      totalPages: TOTAL_PAGES,
      cachedCount: cachedPages.length,
      cachedTafsirCount: cachedTafsirPages.length,
      cachedPages,
      totalBytes,
    });
  });

  app.get('/api/recitation/status', async (_req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.json({
        available: false,
        reason: 'مفتاح GEMINI_API_KEY غير مضبوط في إعدادات الخادم (Secrets).',
        selectedModel: null,
        availableModels: [],
      });
      return;
    }

    try {
      const {selectedModel, availableModels} = await resolveVerifiedAudioModel(ai);
      res.json({
        available: selectedModel !== null,
        reason: selectedModel ? null : 'لم يتم العثور على نموذج صوتي متوافق ضمن النماذج المفعلة على المفتاح.',
        selectedModel,
        availableModels: availableModels.slice(0, 20),
      });
    } catch (err) {
      res.json({
        available: false,
        reason: err instanceof Error ? err.message : 'تعذر التحقق من نماذج Google AI Studio API.',
        selectedModel: null,
        availableModels: [],
      });
    }
  });

  app.post('/api/recitation/analyze', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'محرك الذكاء الاصطناعي غير مهيأ: يرجى إضافة GEMINI_API_KEY في إعدادات الأسرار بالخادم.',
      });
      return;
    }

    const {audioBase64, mimeType, expectedAyahs, focusSurahNumber, focusAyahNumber} = req.body as {
      audioBase64?: string;
      mimeType?: string;
      expectedAyahs?: ExpectedAyahText[];
      focusSurahNumber?: number;
      focusAyahNumber?: number;
    };

    if (!audioBase64 || !Array.isArray(expectedAyahs) || expectedAyahs.length === 0) {
      res.status(400).json({error: 'Audio payload and expected ayahs are required.'});
      return;
    }

    try {
      // Deterministic silent-PCM guard for WAV test/client payloads
      if ((mimeType || '').includes('wav')) {
        const rawBytes = Buffer.from(audioBase64, 'base64');
        if (rawBytes.length > 44) {
          let peak = 0;
          for (let i = 44; i + 1 < rawBytes.length; i += 2) {
            const sample = Math.abs(rawBytes.readInt16LE(i));
            if (sample > peak) peak = sample;
            if (peak > 120) break;
          }
          if (peak <= 120) {
            const silentAlignment = alignRecitationWords([], expectedAyahs, {
              audioClarity: 'unintelligible',
              focusSurahNumber,
              focusAyahNumber,
            });
            res.json({
              modelUsed: 'silence-guard',
              alignment: silentAlignment,
              tajweedStatus: {
                calibrated: false,
                correctCount: 0,
                needsAttentionCount: 0,
                uncertainCount: 0,
                findings: [],
                note: 'الصوت صامت أو غير واضح — يرجى القراءة بصوت مسموع لفحص المخارج والتجويد.',
              },
            });
            return;
          }
        }
      }

      const {candidateModels} = await resolveVerifiedAudioModel(ai);
      if (candidateModels.length === 0) {
        res.status(503).json({
          error: 'لم يتم العثور على نموذج صوتي متاح عبر Google AI Studio API.',
        });
        return;
      }

      let modelUsed = candidateModels[0];
      let spokenObservations: SpokenWordObservation[] | string = '';
      let audioClarity: 'clear' | 'noisy' | 'unintelligible' = 'clear';
      let lastModelErr: unknown = null;
      let succeeded = false;

      for (const candidate of candidateModels) {
        const supportsStructuredSchema = !candidate.includes('transcribe');
        const supportsThinking =
          supportsStructuredSchema &&
          (candidate.startsWith('gemini-4') || candidate.startsWith('gemini-3'));
        try {
          if (supportsStructuredSchema) {
            const transcriptionResponse = await withTimeout(
              ai.models.generateContent({
                model: candidate,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType || 'audio/webm',
                        data: audioBase64,
                      },
                    },
                    {
                      text: [
                        'You are a strict Arabic acoustic-phonetic transcriber (NOT a text corrector).',
                        'Listen purely to the physical speech sounds in the audio clip and transcribe word by word.',
                        'CRITICAL ANTI-AUTOCORRECT RULES:',
                        '1) NEVER guess, predict, or autocorrect to standard Quranic verses from memory. The speaker may deliberately alter consonants or vowels to test pronunciation accuracy (for example: saying "الدِّين" with alveolar stop [d] instead of "الَّذِينَ" with interdental fricative [ð], saying "سِراط" instead of "صِراط", or "أَنْعَمْتُ" instead of "أَنْعَمْتَ").',
                        '2) Carefully distinguish minimal-pair Makharij by ear: ذ vs د vs ز | ث vs ت vs س | ظ vs ض vs ذ | ص vs س | ط vs ت | ق vs ك | ح vs هـ | ع vs أ/ء | غ vs خ.',
                        '3) Write the exact Arabic word literally as articulated, including ONLY the harakat and shaddah you actually hear.',
                        '4) If the clip is silent, noise-only, music/hum, a steady tone, or lacks distinct human speech syllables, NEVER guess or invent "بسم الله الرحمن الرحيم" or any Quranic text — return audioClarity="unintelligible" and words=[].',
                        '5) Rate acoustic articulation confidence (0.0 to 1.0) per word; set < 0.55 if muffled or uncertain.',
                      ].join('\n'),
                    },
                  ],
                },
                config: {
                  ...(supportsThinking
                    ? {thinkingConfig: {thinkingLevel: ThinkingLevel.MEDIUM}}
                    : {}),
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      audioClarity: {
                        type: Type.STRING,
                        enum: ['clear', 'noisy', 'unintelligible'],
                      },
                      words: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            spokenText: {type: Type.STRING},
                            confidence: {type: Type.NUMBER},
                          },
                          required: ['spokenText', 'confidence'],
                        },
                      },
                    },
                    required: ['audioClarity', 'words'],
                  },
                },
              }),
              10000,
              `Transcription(${candidate})`
            );

            const rawJson = (transcriptionResponse.text ?? '').trim();
            try {
              const parsed = JSON.parse(rawJson) as {
                audioClarity?: 'clear' | 'noisy' | 'unintelligible';
                words?: Array<{spokenText?: string; confidence?: number}>;
              };
              if (
                parsed.audioClarity === 'clear' ||
                parsed.audioClarity === 'noisy' ||
                parsed.audioClarity === 'unintelligible'
              ) {
                audioClarity = parsed.audioClarity;
              }
              if (Array.isArray(parsed.words)) {
                spokenObservations = parsed.words
                  .filter((w) => typeof w.spokenText === 'string' && w.spokenText.trim().length > 0)
                  .map((w) => ({
                    text: w.spokenText!.trim(),
                    confidence:
                      typeof w.confidence === 'number'
                        ? Math.max(0, Math.min(1, w.confidence))
                        : 0.85,
                  }));
              }
            } catch {
              spokenObservations = rawJson;
            }
          } else {
            const transcriptionResponse = await withTimeout(
              ai.models.generateContent({
                model: candidate,
                contents: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: mimeType || 'audio/webm',
                        data: audioBase64,
                      },
                    },
                    {
                      text: 'استمع صوتياً بدقة واكتب فقط الكلمات العربية كما نُطقت حرفياً (مع التمييز الصارم بين الذال والدال، والظاء والضاد، والصاد والسين، والثاء والتاء، والحاء والهاء) دون تصحيح تلقائي من الذاكرة القرآنية.',
                    },
                  ],
                },
              }),
              16000,
              `Transcribe(${candidate})`
            );
            spokenObservations = (transcriptionResponse.text ?? '').trim();
          }

          modelUsed = candidate;
          succeeded = true;
          break;
        } catch (err) {
          lastModelErr = err;
          // Fallback cleanly across verified candidate models on 404, 503 high demand, 429, or timeouts
          if (!isRetryableModelError(err)) {
            throw err;
          }
        }
      }

      if (!succeeded) {
        throw lastModelErr ?? new Error('لم يتم العثور على نموذج صوتي متاح عبر API.');
      }

      // Stage 2: Deterministic Hafs letter + harakat + confidence alignment against current reading position
      let alignment = alignRecitationWords(spokenObservations, expectedAyahs, {
        audioClarity,
        focusSurahNumber,
        focusAyahNumber,
      });

      // Stage 3: Targeted forensic acoustic Makhraj minimal-pair & Tajweed duration audit
      let tajweedFindings: TajweedRuleEvaluation[] = [];
      let tajweedCalibrated = false;
      let tajweedNote =
        'لم تتوفر إشارة صوتية كافية لتقييم أحكام التجويد ومخارج الحروف بدقة.';

      const targets = extractSensitiveTajweedTargets(alignment.words);
      const canRunForensicAudit =
        !modelUsed.includes('transcribe') &&
        alignment.audioClarity !== 'unintelligible' &&
        alignment.words.length > 0;

      if (canRunForensicAudit) {
        try {
          const wordSummary = alignment.words
            .map(
              (w, idx) =>
                `[${idx}] expected="${w.expected}" | initialTranscript="${w.spoken ?? ''}"`
            )
            .join('\n');
          const targetChecklist =
            targets.length > 0
              ? targets
                  .map(
                    (t) =>
                      `wordIndex=${t.wordIndex} ("${t.word}"): ${t.checkpoints.join(' ؛ ')}`
                  )
                  .join('\n')
              : 'راجع المخارج الحساسة والمدود والغنن المسموعة في الكلمات المتطابقة.';

          const auditModel = candidateModels.find(
            (m) => m === modelUsed && !m.includes('transcribe')
          ) ?? candidateModels.find((m) => !m.includes('transcribe')) ?? modelUsed;
          const auditThinking =
            auditModel.startsWith('gemini-4') || auditModel.startsWith('gemini-3');

          const auditResponse = await withTimeout(
            ai.models.generateContent({
              model: auditModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: mimeType || 'audio/webm',
                      data: audioBase64,
                    },
                  },
                  {
                    text: [
                      'You are a strict Quranic Tajweed & Phonetic Examiner (مُقرئ مدقق صارم).',
                      'Re-examine the ACTUAL audio waveform carefully against these aligned words and checkpoints.',
                      'DO NOT be lenient or assume the reader recited the Quranic word properly just because ASR wrote it!',
                      '',
                      'Aligned words:',
                      wordSummary,
                      '',
                      'Specific phonetic & Tajweed checkpoints to verify acoustically in the recording:',
                      targetChecklist,
                      '',
                      'Instructions:',
                      '1) In makhrajAudit[], check each sensitive word index: did the speaker physically articulate the exact Makhraj and Harakah? Specifically catch minimal-pair swaps like د instead of ذ (e.g. الدِّين instead of الَّذِينَ), س instead of ص, ت instead of ط, د instead of ض, ز/ذ instead of ظ, أ instead of ع, هـ instead of ح, or wrong final vowels / dropped shaddah. Set verdict="substituted" or "harakah_error" whenever you hear a real deviation, "uncertain" if audio/mic hides it, and "accurate" ONLY if clearly articulated.',
                      '2) In tajweedFindings[], evaluate actual audible Tajweed rules (الغُنّة، المدود، القلقلة، التفخيم والترقيق، مخارج الحروف) with status="correct" | "needs_attention" | "uncertain" and a clear concise Arabic detail.',
                      '3) Never claim 100% perfection if a consonant/duration was rushed, missing, or masked by mic noise.',
                    ].join('\n'),
                  },
                ],
              },
              config: {
                ...(auditThinking
                  ? {thinkingConfig: {thinkingLevel: ThinkingLevel.MEDIUM}}
                  : {}),
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    makhrajAudit: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          wordIndex: {type: Type.INTEGER},
                          expectedWord: {type: Type.STRING},
                          expectedLetter: {type: Type.STRING},
                          heardLetter: {type: Type.STRING},
                          verdict: {
                            type: Type.STRING,
                            enum: ['accurate', 'substituted', 'harakah_error', 'uncertain'],
                          },
                          reason: {type: Type.STRING},
                          confidence: {type: Type.NUMBER},
                        },
                        required: ['wordIndex', 'verdict', 'reason', 'confidence'],
                      },
                    },
                    tajweedFindings: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          word: {type: Type.STRING},
                          rule: {type: Type.STRING},
                          status: {
                            type: Type.STRING,
                            enum: ['correct', 'needs_attention', 'uncertain'],
                          },
                          detail: {type: Type.STRING},
                          confidence: {type: Type.NUMBER},
                        },
                        required: ['word', 'rule', 'status', 'detail', 'confidence'],
                      },
                    },
                  },
                  required: ['makhrajAudit', 'tajweedFindings'],
                },
              },
            }),
            14000,
            `TajweedAudit(${auditModel})`
          );

          const auditParsed = JSON.parse((auditResponse.text ?? '').trim()) as {
            makhrajAudit?: AcousticMakhrajFinding[];
            tajweedFindings?: TajweedRuleEvaluation[];
          };

          if (Array.isArray(auditParsed.makhrajAudit)) {
            alignment = applyAcousticMakhrajAndTajweedAudit(
              alignment,
              auditParsed.makhrajAudit
            );
          }

          if (Array.isArray(auditParsed.tajweedFindings)) {
            tajweedFindings = auditParsed.tajweedFindings
              .filter(
                (f) =>
                  typeof f.word === 'string' &&
                  typeof f.rule === 'string' &&
                  typeof f.detail === 'string'
              )
              .map((f) => ({
                word: f.word.trim(),
                rule: f.rule.trim(),
                status:
                  f.status === 'correct' ||
                  f.status === 'needs_attention' ||
                  f.status === 'uncertain'
                    ? f.status
                    : 'uncertain',
                detail: f.detail.trim(),
                confidence:
                  typeof f.confidence === 'number'
                    ? Math.max(0, Math.min(1, f.confidence))
                    : 0.7,
              }));
            tajweedCalibrated = tajweedFindings.length > 0;
            tajweedNote = tajweedCalibrated
              ? 'تم تدقيق مخارج الحروف الحساسة وأحكام التجويد المسموعة (المدود، الغنن، القلقلة، التفخيم) مباشرة من الموجة الصوتية.'
              : 'لم تُرصد أحكام تجويدية كافية في هذا المقطع القصير.';
          }
        } catch {
          tajweedCalibrated = false;
          tajweedNote =
            'تم فحص مطابقة الكلمات والحروف؛ تعذر إكمال التدقيق التجويدي الصوتي في هذه المحاولة.';
        }
      }

      const correctCount = tajweedFindings.filter((f) => f.status === 'correct').length;
      const needsAttentionCount = tajweedFindings.filter(
        (f) => f.status === 'needs_attention'
      ).length;
      const uncertainCount = tajweedFindings.filter((f) => f.status === 'uncertain').length;

      res.json({
        modelUsed,
        alignment,
        tajweedStatus: {
          calibrated: tajweedCalibrated,
          correctCount,
          needsAttentionCount,
          uncertainCount,
          findings: tajweedFindings,
          note: tajweedNote,
        },
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'فشل تحليل التلاوة عبر الخادم',
      });
    }
  });

  // Ensure unmatched /api/* routes and Express middleware errors NEVER return <!doctype html>
  app.use('/api', (_req, res) => {
    res.status(404).json({error: 'نقطة API المطلوبة غير موجودة.'});
  });

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) return next(err);
      if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
        const errObj = err as {status?: number; type?: string; message?: string};
        const status =
          typeof errObj?.status === 'number' && errObj.status >= 400 ? errObj.status : 500;
        const message =
          errObj?.type === 'entity.too.large' || status === 413
            ? 'التسجيل الصوتي طويل جداً — يرجى تلاوة مقطع أقصر.'
            : errObj?.message || 'حدث خطأ غير متوقع في خادم التلاوة.';
        res.status(status).json({error: message});
        return;
      }
      next(err);
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true, hmr: false},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mushaf web server listening on http://localhost:${PORT}`);
  });
}

startServer();
