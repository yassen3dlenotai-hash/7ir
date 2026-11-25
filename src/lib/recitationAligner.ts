/**
 * Deterministic Quranic (Hafs 'an 'Asim) word, letter, harakat & confidence alignment engine.
 * Strictly separated from acoustic Tajweed grading so word/letter/harakat matching
 * and low-confidence ("unclear") handling remain transparent, honest, and testable.
 */

export interface ExpectedAyahText {
  surahNumber: number;
  ayahNumber: number;
  text: string;
}

export interface SpokenWordObservation {
  text: string;
  confidence?: number;
}

export type WordMatchStatus = 'matched' | 'altered' | 'unclear' | 'skipped';

export type RecitationIssueKind =
  | 'letter_substitution'
  | 'letter_deletion'
  | 'letter_addition'
  | 'word_substitution'
  | 'harakah_mismatch'
  | 'missing_shaddah'
  | 'extra_shaddah'
  | 'skipped_word'
  | 'low_confidence';

export interface AlignedWordResult {
  expected: string;
  normalizedExpected: string;
  spoken: string | null;
  status: WordMatchStatus;
  confidence?: number;
  issueKind?: RecitationIssueKind;
  reason?: string;
  harakatChecked: boolean;
  surahNumber: number;
  ayahNumber: number;
}

export interface RecitationAlignmentReport {
  transcribedText: string;
  audioClarity: 'clear' | 'noisy' | 'unintelligible';
  matchedCount: number;
  alteredCount: number;
  unclearCount: number;
  skippedCount: number;
  totalExpectedWords: number;
  harakatEvaluated: boolean;
  words: AlignedWordResult[];
}

export interface AlignOptions {
  audioClarity?: 'clear' | 'noisy' | 'unintelligible';
  focusSurahNumber?: number;
  focusAyahNumber?: number;
  unclearConfidenceThreshold?: number;
}

type HarakahKind =
  | 'fatha'
  | 'damma'
  | 'kasra'
  | 'sukun'
  | 'fathatan'
  | 'dammatan'
  | 'kasratan';

interface LetterSlot {
  letter: string;
  harakah: HarakahKind | null;
  hasShaddah: boolean;
  hasMadd: boolean;
}

const ALL_DIACRITICS_RE = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const HARAKAH_NAMES_AR: Record<HarakahKind, string> = {
  fatha: 'الفتحة',
  damma: 'الضمة',
  kasra: 'الكسرة',
  sukun: 'السكون',
  fathatan: 'تنوين الفتح',
  dammatan: 'تنوين الضم',
  kasratan: 'تنوين الكسر',
};

const STANDARD_DIACRITIC_CODEPOINTS = new Set([
  0x064b, // fathatan
  0x064c, // dammatan
  0x064d, // kasratan
  0x064e, // fatha
  0x064f, // damma
  0x0650, // kasra
  0x0651, // shaddah
  0x0652, // sukun
  0x06e1, // quranic sukun / jazm
  0x0653, // maddah above
  0x0670, // dagger alif
]);

const BASE_ARABIC_LETTER_RE = /[\u0621-\u063A\u0641-\u064A\u0671\u0649]/;

function normalizeSingleBaseLetter(ch: string): string {
  if (ch === 'ٱ' || ch === 'أ' || ch === 'إ' || ch === 'آ') return 'ا';
  if (ch === 'ى') return 'ى';
  return ch;
}

function mapCodePointToHarakah(cp: number): HarakahKind | null {
  switch (cp) {
    case 0x064e:
      return 'fatha';
    case 0x064f:
      return 'damma';
    case 0x0650:
      return 'kasra';
    case 0x0652:
    case 0x06e1:
      return 'sukun';
    case 0x064b:
      return 'fathatan';
    case 0x064c:
      return 'dammatan';
    case 0x064d:
      return 'kasratan';
    default:
      return null;
  }
}

/**
 * Extracts structured base-letter slots (letter + shaddah + harakah + madd)
 * and handles Uthmani dagger alif (\u0670) expansion cleanly.
 */
export function extractLetterSlots(
  word: string,
  options?: {expandDaggerAlif?: boolean; keepShortDaggerAlif?: boolean}
): LetterSlot[] {
  const expandDagger = options?.expandDaggerAlif ?? true;
  const slots: LetterSlot[] = [];

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const cp = ch.codePointAt(0) ?? 0;

    if (cp === 0x0640) {
      // Tatweel: ignore visually
      continue;
    }

    if (BASE_ARABIC_LETTER_RE.test(ch)) {
      const normalizedLetter = normalizeSingleBaseLetter(ch);
      slots.push({
        letter: normalizedLetter,
        harakah: null,
        hasShaddah: false,
        hasMadd: ch === 'آ',
      });
      continue;
    }

    const current = slots[slots.length - 1];
    if (!current) continue;

    if (cp === 0x0651) {
      current.hasShaddah = true;
      continue;
    }

    if (cp === 0x0653) {
      current.hasMadd = true;
      continue;
    }

    if (cp === 0x0670) {
      // Dagger alif after Waw (e.g. الصَّلَوٰة) represents phonetic Alif in Imla'i script
      if (expandDagger) {
        if (current.letter === 'و') {
          current.letter = 'ا';
          current.harakah = null;
        } else if (current.letter !== 'ى') {
          slots.push({
            letter: 'ا',
            harakah: null,
            hasShaddah: false,
            hasMadd: false,
          });
        }
      }
      continue;
    }

    if (STANDARD_DIACRITIC_CODEPOINTS.has(cp)) {
      const h = mapCodePointToHarakah(cp);
      if (h) current.harakah = h;
    }
  }

  return slots;
}

/**
 * Normalizes an Arabic Quran word strictly at consonant level (no fuzzy consonant tolerance).
 * Preserves distinct roots like د vs ذ and suffixes like العالم vs العالمين.
 */
export function normalizeArabicWord(word: string): string {
  const slots = extractLetterSlots(word, {expandDaggerAlif: true});
  return slots
    .map((s) => (s.letter === 'ى' ? 'ا' : s.letter))
    .join('')
    .trim();
}

function getAcceptedConsonantForms(expectedRaw: string): {
  primary: string;
  variants: string[];
  primarySlots: LetterSlot[];
  shortSlots: LetterSlot[] | null;
} {
  const primarySlots = extractLetterSlots(expectedRaw, {expandDaggerAlif: true});
  const primary = primarySlots.map((s) => (s.letter === 'ى' ? 'ا' : s.letter)).join('');
  const variants = new Set<string>([primary]);

  let shortSlots: LetterSlot[] | null = null;
  if (expectedRaw.includes('\u0670')) {
    // Allow Rasm short form only if dagger alif is present in standard Quranic spelling (e.g., الرحمن / هذا / ذلك)
    shortSlots = extractLetterSlots(expectedRaw, {expandDaggerAlif: false});
    const shortForm = shortSlots.map((s) => (s.letter === 'ى' ? 'ا' : s.letter)).join('');
    variants.add(shortForm);
  }

  // Also allow Alif Maqsura ى written as ى when expected ends in ى
  if (expectedRaw.replace(ALL_DIACRITICS_RE, '').endsWith('ى')) {
    const withYa = primary.slice(0, -1) + 'ي';
    variants.add(withYa);
  }

  return {
    primary,
    variants: Array.from(variants),
    primarySlots,
    shortSlots,
  };
}

export function hasArabicDiacritics(word: string): boolean {
  return /[\u064B-\u0653\u06E1]/.test(word);
}

export function tokenizeArabic(text: string): string[] {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => normalizeArabicWord(w).length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({length: m + 1}, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function diagnoseLetterDifference(
  expectedNorm: string,
  spokenNorm: string
): {issueKind: RecitationIssueKind; reason: string} {
  if (expectedNorm.length === spokenNorm.length) {
    const diffs: Array<{exp: string; spk: string}> = [];
    for (let i = 0; i < expectedNorm.length; i++) {
      if (expectedNorm[i] !== spokenNorm[i]) {
        diffs.push({exp: expectedNorm[i], spk: spokenNorm[i]});
      }
    }
    if (diffs.length === 1) {
      return {
        issueKind: 'letter_substitution',
        reason: `استبدال حرف: نُطق «${diffs[0].spk}» بدلاً من «${diffs[0].exp}»`,
      };
    }
    if (diffs.length === 2 && expectedNorm.length >= 4) {
      return {
        issueKind: 'letter_substitution',
        reason: `اختلاف في أحرف الكلمة: نُطق «${diffs.map((d) => d.spk).join('، ')}» بدلاً من «${diffs.map((d) => d.exp).join('، ')}»`,
      };
    }
  }

  // Check pure deletion (spoken is strict subsequence / missing letters of expected)
  if (spokenNorm.length < expectedNorm.length) {
    let si = 0;
    const missing: string[] = [];
    for (let ei = 0; ei < expectedNorm.length; ei++) {
      if (si < spokenNorm.length && expectedNorm[ei] === spokenNorm[si]) {
        si++;
      } else {
        missing.push(expectedNorm[ei]);
      }
    }
    if (si === spokenNorm.length && missing.length > 0 && missing.length <= 3) {
      return {
        issueKind: 'letter_deletion',
        reason: `نقص في حروف الكلمة: حُذف «${missing.join('')}»`,
      };
    }
  }

  // Check pure addition (expected is strict subsequence / extra letters in spoken)
  if (spokenNorm.length > expectedNorm.length) {
    let ei = 0;
    const added: string[] = [];
    for (let si = 0; si < spokenNorm.length; si++) {
      if (ei < expectedNorm.length && spokenNorm[si] === expectedNorm[ei]) {
        ei++;
      } else {
        added.push(spokenNorm[si]);
      }
    }
    if (ei === expectedNorm.length && added.length > 0 && added.length <= 3) {
      return {
        issueKind: 'letter_addition',
        reason: `زيادة في حروف الكلمة: أُضيف «${added.join('')}»`,
      };
    }
  }

  const dist = levenshtein(expectedNorm, spokenNorm);
  if (dist <= 2 && Math.max(expectedNorm.length, spokenNorm.length) >= 4) {
    return {
      issueKind: 'letter_substitution',
      reason: `تبديل أو نقص في حروف الكلمة عن رسم المصحف`,
    };
  }

  return {
    issueKind: 'word_substitution',
    reason: `نُطقت كلمة مختلفة عن الكلمة المتوقعة`,
  };
}

function compareHarakatSlots(
  expectedSlots: LetterSlot[],
  spokenSlots: LetterSlot[]
): {ok: true} | {ok: false; issueKind: RecitationIssueKind; reason: string} {
  if (expectedSlots.length !== spokenSlots.length) {
    return {ok: true};
  }

  for (let i = 0; i < expectedSlots.length; i++) {
    const exp = expectedSlots[i];
    const spk = spokenSlots[i];

    // Check Shaddah first when spoken word contains diacritics
    if (exp.hasShaddah && !spk.hasShaddah) {
      // Allow silent solar Alif-Lam assimilation check? In solar Alif-Lam (الدين), the letter itself HAS shaddah.
      return {
        issueKind: 'missing_shaddah',
        reason: `حُذفت الشدّة على حرف «${exp.letter}»`,
        ok: false,
      };
    }

    if (!exp.hasShaddah && spk.hasShaddah) {
      // In connected Quran recitation, Idgham can place Shaddah on the first letter of the next word (i === 0);
      // don't flag valid Idgham Shaddah on slot 0, only flag unexpected internal Shaddah.
      if (i > 0) {
        return {
          issueKind: 'extra_shaddah',
          reason: `شدّة زائدة على حرف «${exp.letter}»`,
          ok: false,
        };
      }
    }

    // Compare harakah ONLY when spoken explicitly has a harakah on that slot
    if (exp.harakah && spk.harakah && exp.harakah !== spk.harakah) {
      // Allow pause sukun at the very last consonant slot when reciting word/ayah in waqf
      const isFinalSlot = i === expectedSlots.length - 1;
      if (isFinalSlot && spk.harakah === 'sukun') {
        continue;
      }

      return {
        ok: false,
        issueKind: 'harakah_mismatch',
        reason: `اختلاف حركة على حرف «${exp.letter}»: نُطقت ${HARAKAH_NAMES_AR[spk.harakah]} بدلاً من ${HARAKAH_NAMES_AR[exp.harakah]}`,
      };
    }
  }

  return {ok: true};
}

function evaluateSingleWordMatch(
  expectedRaw: string,
  spokenRaw: string,
  spokenConfidence: number | undefined,
  unclearThreshold: number
): Omit<AlignedWordResult, 'surahNumber' | 'ayahNumber'> {
  const accepted = getAcceptedConsonantForms(expectedRaw);
  const spokenNorm = normalizeArabicWord(spokenRaw);

  if (spokenConfidence !== undefined && spokenConfidence < unclearThreshold) {
    return {
      expected: expectedRaw,
      normalizedExpected: accepted.primary,
      spoken: spokenRaw,
      status: 'unclear',
      confidence: spokenConfidence,
      issueKind: 'low_confidence',
      reason: 'لم يتم التعرف على الكلمة بوضوح — يرجى إعادة قراءتها',
      harakatChecked: false,
    };
  }

  const consonantMatched = accepted.variants.includes(spokenNorm);
  if (!consonantMatched) {
    const diff = diagnoseLetterDifference(accepted.primary, spokenNorm);
    return {
      expected: expectedRaw,
      normalizedExpected: accepted.primary,
      spoken: spokenRaw,
      status: 'altered',
      confidence: spokenConfidence,
      issueKind: diff.issueKind,
      reason: diff.reason,
      harakatChecked: false,
    };
  }

  // Consonants match strictly! Now check harakat & shaddah if the spoken transcript carries diacritics.
  const spokenHasDiacritics = hasArabicDiacritics(spokenRaw);
  if (!spokenHasDiacritics) {
    return {
      expected: expectedRaw,
      normalizedExpected: accepted.primary,
      spoken: spokenRaw,
      status: 'matched',
      confidence: spokenConfidence,
      harakatChecked: false,
    };
  }

  const spokenSlots = extractLetterSlots(spokenRaw, {expandDaggerAlif: false});
  const targetSlots =
    accepted.shortSlots && spokenSlots.length === accepted.shortSlots.length
      ? accepted.shortSlots
      : accepted.primarySlots;

  const harakatResult = compareHarakatSlots(targetSlots, spokenSlots);
  if (harakatResult.ok === false) {
    return {
      expected: expectedRaw,
      normalizedExpected: accepted.primary,
      spoken: spokenRaw,
      status: 'altered',
      confidence: spokenConfidence,
      issueKind: harakatResult.issueKind,
      reason: harakatResult.reason,
      harakatChecked: true,
    };
  }

  return {
    expected: expectedRaw,
    normalizedExpected: accepted.primary,
    spoken: spokenRaw,
    status: 'matched',
    confidence: spokenConfidence,
    harakatChecked: true,
  };
}

function normalizedWordSimilarity(expectedRaw: string, spokenRaw: string): number {
  const accepted = getAcceptedConsonantForms(expectedRaw);
  const spokenNorm = normalizeArabicWord(spokenRaw);
  if (!spokenNorm) return 0;
  if (accepted.variants.includes(spokenNorm)) return 1.0;

  let bestSim = 0;
  for (const variant of accepted.variants) {
    const maxLen = Math.max(variant.length, spokenNorm.length);
    if (maxLen === 0) continue;
    const dist = levenshtein(variant, spokenNorm);
    const sim = 1 - dist / maxLen;
    if (sim > bestSim) bestSim = sim;
  }
  return bestSim;
}

/**
 * Aligns spoken Arabic transcription (plain string or confidence-tagged observations)
 * against the canonical expected Quran words on the active reading page/position.
 */
export function alignRecitationWords(
  spokenInput: string | SpokenWordObservation[],
  expectedAyahs: ExpectedAyahText[],
  options?: AlignOptions
): RecitationAlignmentReport {
  const unclearThreshold = options?.unclearConfidenceThreshold ?? 0.58;
  const audioClarity = options?.audioClarity ?? 'clear';

  const observations: SpokenWordObservation[] =
    typeof spokenInput === 'string'
      ? tokenizeArabic(spokenInput).map((text) => ({text}))
      : spokenInput
          .map((obs) => ({
            text: obs.text.trim(),
            confidence: obs.confidence,
          }))
          .filter((obs) => normalizeArabicWord(obs.text).length > 0 || (obs.confidence ?? 1) < unclearThreshold);

  const transcribedText =
    typeof spokenInput === 'string'
      ? spokenInput.trim()
      : observations.map((o) => o.text).join(' ').trim();

  const allExpected: Array<{
    raw: string;
    norm: string;
    surahNumber: number;
    ayahNumber: number;
  }> = [];

  for (const ayah of expectedAyahs) {
    for (const token of tokenizeArabic(ayah.text)) {
      allExpected.push({
        raw: token,
        norm: normalizeArabicWord(token),
        surahNumber: ayah.surahNumber,
        ayahNumber: ayah.ayahNumber,
      });
    }
  }

  if (allExpected.length === 0) {
    return {
      transcribedText,
      audioClarity,
      matchedCount: 0,
      alteredCount: 0,
      unclearCount: 0,
      skippedCount: 0,
      totalExpectedWords: 0,
      harakatEvaluated: false,
      words: [],
    };
  }

  // If audio was marked completely unintelligible (or silent/empty), mark target ayah words as unclear without false errors
  if (audioClarity === 'unintelligible') {
    const startIdx =
      options?.focusSurahNumber && options?.focusAyahNumber
        ? Math.max(
            0,
            allExpected.findIndex(
              (w) =>
                w.surahNumber === options.focusSurahNumber &&
                w.ayahNumber === options.focusAyahNumber
            )
          )
        : 0;
    const slice = allExpected.slice(startIdx, startIdx + Math.max(observations.length, 4));
    const words: AlignedWordResult[] = slice.map((exp, idx) => ({
      expected: exp.raw,
      normalizedExpected: exp.norm,
      spoken: observations[idx]?.text ?? null,
      status: 'unclear',
      confidence: observations[idx]?.confidence ?? 0.2,
      issueKind: 'low_confidence',
      reason: 'الصوت غير واضح أو صامت — يرجى إعادة التلاوة بصوت أوضح',
      harakatChecked: false,
      surahNumber: exp.surahNumber,
      ayahNumber: exp.ayahNumber,
    }));
    return {
      transcribedText,
      audioClarity,
      matchedCount: 0,
      alteredCount: 0,
      unclearCount: words.length,
      skippedCount: 0,
      totalExpectedWords: words.length,
      harakatEvaluated: false,
      words,
    };
  }

  if (observations.length === 0) {
    return {
      transcribedText,
      audioClarity,
      matchedCount: 0,
      alteredCount: 0,
      unclearCount: 0,
      skippedCount: 0,
      totalExpectedWords: allExpected.length,
      harakatEvaluated: false,
      words: [],
    };
  }

  // 1. Find best starting word index on page, prioritizing the user's current reading Ayah on tie
  let startIndex = 0;
  let bestAnchorScore = -1;
  for (let i = 0; i < allExpected.length; i++) {
    let score = 0;
    const probeLen = Math.min(5, observations.length, allExpected.length - i);
    for (let k = 0; k < probeLen; k++) {
      const sim = normalizedWordSimilarity(allExpected[i + k].raw, observations[k].text);
      if (sim >= 0.99) score += 2;
      else if (sim >= 0.65) score += 1;
    }

    // Gentle tie-breaker towards user's active reading Ayah
    if (
      options?.focusSurahNumber &&
      options?.focusAyahNumber &&
      allExpected[i].surahNumber === options.focusSurahNumber &&
      allExpected[i].ayahNumber === options.focusAyahNumber
    ) {
      score += 0.35;
    }

    if (score > bestAnchorScore) {
      bestAnchorScore = score;
      startIndex = i;
    }
  }

  // If no strong anchor match was found at all and a focus Ayah was provided, start from focus Ayah
  if (bestAnchorScore < 0.8 && options?.focusSurahNumber && options?.focusAyahNumber) {
    const focusIdx = allExpected.findIndex(
      (w) =>
        w.surahNumber === options.focusSurahNumber && w.ayahNumber === options.focusAyahNumber
    );
    if (focusIdx >= 0) startIndex = focusIdx;
  }

  const targetSlice = allExpected.slice(
    startIndex,
    Math.min(allExpected.length, startIndex + observations.length + 6)
  );

  // 2. Global Needleman-Wunsch alignment over [targetSlice x observations]
  const E = targetSlice.length;
  const S = observations.length;
  const dp = Array.from({length: E + 1}, () => new Array<number>(S + 1).fill(0));
  const trace = Array.from({length: E + 1}, () => new Array<'diag' | 'up' | 'left'>(S + 1).fill('diag'));

  const SKIP_EXPECTED_PENALTY = -1.8;
  const EXTRA_SPOKEN_PENALTY = -1.9;

  for (let i = 1; i <= E; i++) {
    dp[i][0] = i * SKIP_EXPECTED_PENALTY;
    trace[i][0] = 'up';
  }
  for (let j = 1; j <= S; j++) {
    dp[0][j] = j * EXTRA_SPOKEN_PENALTY;
    trace[0][j] = 'left';
  }

  for (let i = 1; i <= E; i++) {
    for (let j = 1; j <= S; j++) {
      const sim = normalizedWordSimilarity(targetSlice[i - 1].raw, observations[j - 1].text);
      const isLowConf =
        observations[j - 1].confidence !== undefined &&
        (observations[j - 1].confidence as number) < unclearThreshold;

      // Pair score rewards exact/near words strongly, still allows substituted/unclear word pairing over double-penalty
      const pairScore = isLowConf ? 0.4 : sim >= 0.99 ? 4.0 : sim >= 0.55 ? 2.2 : -0.8;

      const diagVal = dp[i - 1][j - 1] + pairScore;
      const upVal = dp[i - 1][j] + SKIP_EXPECTED_PENALTY;
      const leftVal = dp[i][j - 1] + EXTRA_SPOKEN_PENALTY;

      if (diagVal >= upVal && diagVal >= leftVal) {
        dp[i][j] = diagVal;
        trace[i][j] = 'diag';
      } else if (upVal >= leftVal) {
        dp[i][j] = upVal;
        trace[i][j] = 'up';
      } else {
        dp[i][j] = leftVal;
        trace[i][j] = 'left';
      }
    }
  }

  // Backtrack up to the end of spoken words (trim trailing unreached expected tail)
  let bestEndI = E;
  let bestEndScore = -Infinity;
  for (let i = 1; i <= E; i++) {
    if (dp[i][S] >= bestEndScore) {
      bestEndScore = dp[i][S];
      bestEndI = i;
    }
  }

  const alignedOps: Array<{expIdx: number | null; spkIdx: number | null}> = [];
  let ci = bestEndI;
  let cj = S;
  while (ci > 0 || cj > 0) {
    const move = trace[ci][cj];
    if (ci > 0 && cj > 0 && move === 'diag') {
      alignedOps.push({expIdx: ci - 1, spkIdx: cj - 1});
      ci--;
      cj--;
    } else if (ci > 0 && (cj === 0 || move === 'up')) {
      alignedOps.push({expIdx: ci - 1, spkIdx: null});
      ci--;
    } else {
      alignedOps.push({expIdx: null, spkIdx: cj - 1});
      cj--;
    }
  }
  alignedOps.reverse();

  const words: AlignedWordResult[] = [];
  for (const op of alignedOps) {
    if (op.expIdx === null) {
      // Extra spoken word not corresponding to expected text; ignore or attach only if needed
      continue;
    }

    const exp = targetSlice[op.expIdx];
    if (op.spkIdx === null) {
      words.push({
        expected: exp.raw,
        normalizedExpected: exp.norm,
        spoken: null,
        status: 'skipped',
        issueKind: 'skipped_word',
        reason: 'كلمة لم تُقرأ (تم تجاوزها)',
        harakatChecked: false,
        surahNumber: exp.surahNumber,
        ayahNumber: exp.ayahNumber,
      });
      continue;
    }

    const obs = observations[op.spkIdx];
    const evalResult = evaluateSingleWordMatch(
      exp.raw,
      obs.text,
      obs.confidence,
      unclearThreshold
    );

    words.push({
      ...evalResult,
      surahNumber: exp.surahNumber,
      ayahNumber: exp.ayahNumber,
    });
  }

  let matchedCount = 0;
  let alteredCount = 0;
  let unclearCount = 0;
  let skippedCount = 0;
  let harakatEvaluated = false;

  for (const w of words) {
    if (w.harakatChecked) harakatEvaluated = true;
    if (w.status === 'matched') matchedCount++;
    else if (w.status === 'altered') alteredCount++;
    else if (w.status === 'unclear') unclearCount++;
    else if (w.status === 'skipped') skippedCount++;
  }

  return {
    transcribedText,
    audioClarity,
    matchedCount,
    alteredCount,
    unclearCount,
    skippedCount,
    totalExpectedWords: words.length,
    harakatEvaluated,
    words,
  };
}

export interface TajweedRuleEvaluation {
  word: string;
  rule: string;
  status: 'correct' | 'needs_attention' | 'uncertain';
  detail: string;
  confidence: number;
}

export interface AcousticMakhrajFinding {
  wordIndex: number;
  expectedWord?: string;
  heardLetter?: string;
  expectedLetter?: string;
  verdict: 'accurate' | 'substituted' | 'harakah_error' | 'uncertain';
  reason: string;
  confidence: number;
}

export interface SensitiveTajweedTarget {
  wordIndex: number;
  word: string;
  checkpoints: string[];
}

const SENSITIVE_CONSONANT_CHECKS: Array<[RegExp, string]> = [
  [/ذ/, 'مخرج الذال (ذ) بين الأسنان وتمييزه عن الدال (د) والزاي (ز)'],
  [/ث/, 'مخرج الثاء (ث) وتمييزه عن التاء (ت) والسين (س)'],
  [/ظ/, 'مخرج الظاء (ظ) المفخم وتمييزه عن الضاد والذال والزاي'],
  [/ض/, 'مخرج الضاد (ض) المستطيل وتمييزه عن الدال (د) والظاء (ظ)'],
  [/ص/, 'تفخيم الصاد (ص) وتمييزها عن السين (س)'],
  [/ط/, 'تفخيم الطاء (ط) وتمييزها عن التاء (ت)'],
  [/ق/, 'تفخيم القاف (ق) وتمييزها عن الكاف (ك)'],
  [/ع/, 'إخراج العين (ع) من وسط الحلق وتمييزها عن الهمزة'],
  [/ح/, 'إخراج الحاء (ح) من وسط الحلق وتمييزها عن الهاء (هـ)'],
];

/**
 * Deterministically identifies sensitive Makharij & Tajweed rules present in aligned words
 * so acoustic verification probes concrete targets instead of returning generic praise.
 */
export function extractSensitiveTajweedTargets(
  words: AlignedWordResult[]
): SensitiveTajweedTarget[] {
  const targets: SensitiveTajweedTarget[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.status === 'skipped') continue;
    const expected = w.expected;
    const checkpoints: string[] = [];

    for (const [re, label] of SENSITIVE_CONSONANT_CHECKS) {
      if (re.test(expected)) {
        checkpoints.push(label);
      }
    }

    if (/[نم]\u0651/.test(expected)) {
      checkpoints.push('غنة النون أو الميم المشددة بمقدار حركتين');
    }
    if (/\u0653/.test(expected) || /آ/.test(expected)) {
      checkpoints.push('إشباع المد الفرعي/اللازم (٤ إلى ٦ حركات دون قصر)');
    }
    if (/[قطبجد][\u0652\u06E1]/.test(expected)) {
      checkpoints.push('القلقلة الصغرى على حرف القلقلة الساكن');
    }
    if (/\u0651/.test(expected) && checkpoints.length === 0) {
      checkpoints.push('تحقيق الشدّة وعدم تخفيف الحرف المشدد');
    }

    if (checkpoints.length > 0) {
      targets.push({
        wordIndex: i,
        word: expected,
        checkpoints: checkpoints.slice(0, 3),
      });
    }
  }

  return targets;
}

/**
 * Merges acoustic minimal-pair Makhraj findings back into word alignment results
 * so phonetic substitutions missed by ASR language priors (e.g. الدِّين for الَّذِينَ)
 * are strictly flagged as altered words with clear explanation.
 */
export function applyAcousticMakhrajAndTajweedAudit(
  report: RecitationAlignmentReport,
  findings: AcousticMakhrajFinding[]
): RecitationAlignmentReport {
  if (!findings.length || !report.words.length) {
    return report;
  }

  const nextWords = report.words.map((w) => ({...w}));

  for (const f of findings) {
    if (
      (f.verdict !== 'substituted' && f.verdict !== 'harakah_error') ||
      f.confidence < 0.62
    ) {
      continue;
    }
    if (f.wordIndex < 0 || f.wordIndex >= nextWords.length) {
      continue;
    }

    const target = nextWords[f.wordIndex];
    if (target.status === 'skipped' || target.status === 'altered') {
      continue;
    }

    const issueKind: RecitationIssueKind =
      f.verdict === 'harakah_error' ? 'harakah_mismatch' : 'letter_substitution';
    const fallbackReason =
      f.expectedLetter && f.heardLetter
        ? `استبدال صوتي: نُطق «${f.heardLetter}» بدلاً من «${f.expectedLetter}»`
        : 'اختلاف صوتي في مخرج الحرف أو الحركة';

    nextWords[f.wordIndex] = {
      ...target,
      status: 'altered',
      issueKind,
      confidence: Math.min(target.confidence ?? 1, f.confidence),
      spoken: f.heardLetter
        ? `${target.spoken ?? target.expected} (نُطق «${f.heardLetter}»)`
        : target.spoken,
      reason: f.reason?.trim() || fallbackReason,
    };
  }

  let matchedCount = 0;
  let alteredCount = 0;
  let unclearCount = 0;
  let skippedCount = 0;
  for (const w of nextWords) {
    if (w.status === 'matched') matchedCount++;
    else if (w.status === 'altered') alteredCount++;
    else if (w.status === 'unclear') unclearCount++;
    else if (w.status === 'skipped') skippedCount++;
  }

  return {
    ...report,
    matchedCount,
    alteredCount,
    unclearCount,
    skippedCount,
    words: nextWords,
  };
}
