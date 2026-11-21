// Pure confidence classification, token reconciliation, and review helpers for Transcript Viewer
import { normalizeDigitsToAscii } from './transcribeConfigHelpers';

export interface WordTokenLike {
  text: string;
  startMs: number;
  endMs: number;
  prob: number;
  reviewed?: boolean;
}

export interface TranscriptLineLike {
  id: number;
  text: string;
  startMs?: number;
  endMs?: number;
  words?: WordTokenLike[];
}

export type ConfidenceSeverity = 'ok' | 'low' | 'critical';

export interface ConfidenceSummary {
  hasConfidenceData: boolean;
  totalWords: number;
  lowWordCount: number;
  criticalWordCount: number;
  flaggedSegmentCount: number;
  flaggedSegmentIds: number[];
}

export const CONFIDENCE_THRESHOLD_MIN = 40;
export const CONFIDENCE_THRESHOLD_MAX = 95;
export const CONFIDENCE_THRESHOLD_STEP = 5;
export const CONFIDENCE_THRESHOLD_DEFAULT = 70;
export const CONFIDENCE_WORD_PREROLL_MS = 220;

const STANDALONE_PUNCTUATION_RE = /^[\s.,!?;:…،؛؟«»"'`()[\]{}\-–—/\\|•·]+$/;

/**
 * Parses and clamps a confidence threshold percentage to [40, 95], defaulting to 70.
 * Accepts ASCII, Persian, and Arabic-Indic numerals as well as numbers.
 */
export function clampConfidenceThreshold(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return CONFIDENCE_THRESHOLD_DEFAULT;
    return Math.max(CONFIDENCE_THRESHOLD_MIN, Math.min(CONFIDENCE_THRESHOLD_MAX, Math.round(raw)));
  }
  const normalized = normalizeDigitsToAscii(String(raw ?? '')).trim();
  const parsed = parseInt(normalized, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return CONFIDENCE_THRESHOLD_DEFAULT;
  }
  return Math.max(CONFIDENCE_THRESHOLD_MIN, Math.min(CONFIDENCE_THRESHOLD_MAX, parsed));
}

/**
 * Computes the "critical / very low confidence" cutoff below the user's chosen threshold.
 * Always stays strictly below `thresholdPercent` (e.g. 70% -> 45%, 80% -> 45%, 60% -> 35%, 45% -> 25%).
 */
export function getCriticalThresholdPercent(thresholdPercent: number): number {
  const safeThreshold = clampConfidenceThreshold(thresholdPercent);
  return Math.max(25, Math.min(45, safeThreshold - 25));
}

/**
 * Classifies a single word token probability (0..1) into 'ok', 'low', or 'critical'.
 */
export function classifyWordConfidence(prob: number, thresholdPercent: number): ConfidenceSeverity {
  if (!Number.isFinite(prob)) return 'ok';
  const safeThreshold = clampConfidenceThreshold(thresholdPercent);
  const clampedProb = Math.max(0, Math.min(1, prob));
  const percent = clampedProb * 100;
  if (percent < getCriticalThresholdPercent(safeThreshold)) {
    return 'critical';
  }
  if (percent < safeThreshold) {
    return 'low';
  }
  return 'ok';
}

/**
 * Returns true if a token contains only punctuation / typographic symbols and no lexical characters.
 * Used during BPE aggregation so Whisper's natural punctuation uncertainty (e.g. `.` vs `,`)
 * does not poison the confidence score of an otherwise high-confidence word like "vertically.".
 */
export function isStandalonePunctuationToken(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  return STANDALONE_PUNCTUATION_RE.test(trimmed);
}

/**
 * Checks whether a single transcript line contains any word-level confidence data.
 */
export function lineHasConfidenceData(line: TranscriptLineLike | null | undefined): boolean {
  return Boolean(line && Array.isArray(line.words) && line.words.length > 0);
}

/**
 * Checks whether any line in the transcript carries word-level confidence data.
 */
export function transcriptHasConfidenceData(lines: readonly TranscriptLineLike[] | null | undefined): boolean {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  return lines.some(l => lineHasConfidenceData(l));
}

/**
 * Computes the worst confidence severity present in a line ('critical' > 'low' > 'ok')
 * along with the count of flagged words in that line.
 */
export function evaluateLineConfidence(
  line: TranscriptLineLike | null | undefined,
  thresholdPercent: number
): { level: ConfidenceSeverity; flaggedCount: number; criticalCount: number; hasReviewedWords: boolean } {
  if (!line || !Array.isArray(line.words) || line.words.length === 0) {
    return { level: 'ok', flaggedCount: 0, criticalCount: 0, hasReviewedWords: false };
  }
  let flaggedCount = 0;
  let criticalCount = 0;
  let hasReviewedWords = false;
  for (const w of line.words) {
    if (w.reviewed) {
      hasReviewedWords = true;
      continue;
    }
    const sev = classifyWordConfidence(w.prob, thresholdPercent);
    if (sev === 'critical') {
      flaggedCount++;
      criticalCount++;
    } else if (sev === 'low') {
      flaggedCount++;
    }
  }
  const level: ConfidenceSeverity = criticalCount > 0 ? 'critical' : (flaggedCount > 0 ? 'low' : 'ok');
  return { level, flaggedCount, criticalCount, hasReviewedWords };
}

/**
 * Aggregates confidence statistics across all transcript lines for the Review Bar and button badge.
 */
export function computeConfidenceSummary(
  lines: readonly TranscriptLineLike[] | null | undefined,
  thresholdPercent: number
): ConfidenceSummary {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      hasConfidenceData: false,
      totalWords: 0,
      lowWordCount: 0,
      criticalWordCount: 0,
      flaggedSegmentCount: 0,
      flaggedSegmentIds: []
    };
  }

  let hasConfidenceData = false;
  let totalWords = 0;
  let lowWordCount = 0;
  let criticalWordCount = 0;
  const flaggedSegmentIds: number[] = [];

  for (const line of lines) {
    if (!Array.isArray(line.words) || line.words.length === 0) continue;
    hasConfidenceData = true;
    totalWords += line.words.length;
    const lineEval = evaluateLineConfidence(line, thresholdPercent);
    if (lineEval.flaggedCount > 0) {
      lowWordCount += lineEval.flaggedCount;
      criticalWordCount += lineEval.criticalCount;
      flaggedSegmentIds.push(line.id);
    }
  }

  return {
    hasConfidenceData,
    totalWords,
    lowWordCount,
    criticalWordCount,
    flaggedSegmentCount: flaggedSegmentIds.length,
    flaggedSegmentIds
  };
}

/**
 * Reconciles word-level confidence metadata after a user edits a segment's text.
 * - Unchanged words retain their original Whisper timestamps and probabilities,
 *   so fixing one low-confidence word does NOT wipe warnings on other words in the same segment.
 * - Modified or newly inserted words are marked as human-reviewed (`prob: 1.0, reviewed: true`).
 * - If the text is emptied or shares zero words with the original tokens (complete rewrite),
 *   returns `undefined` so stale tokens are cleanly invalidated.
 */
export function reconcileWordsAfterEdit(
  previousWords: readonly WordTokenLike[] | undefined,
  newText: string,
  segStartMs = 0,
  segEndMs = 0
): WordTokenLike[] | undefined {
  if (!Array.isArray(previousWords) || previousWords.length === 0) {
    return undefined;
  }
  const trimmed = (newText || '').trim();
  if (!trimmed) return undefined;

  const newTokens = trimmed.split(/\s+/).filter(Boolean);
  if (newTokens.length === 0) return undefined;

  const oldClean = previousWords.map(w => w.text.trim());
  const m = oldClean.length;
  const n = newTokens.length;

  // Guard against degenerate very long segments (fallback cleanly)
  if (m * n > 25000) {
    return undefined;
  }

  // Standard LCS table on exact word text so preserved words stay mapped in order
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldClean[i] === newTokens[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  const matchedCount = dp[0][0];
  if (matchedCount === 0) {
    // Complete rewrite: invalidate stale tokens cleanly
    return undefined;
  }

  // Reconstruct newIndex -> oldIndex mapping
  const matchedOldIndex = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldClean[i] === newTokens[j]) {
      matchedOldIndex[j] = i;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const baseStart = previousWords[0]?.startMs ?? segStartMs;
  const baseEnd = previousWords[previousWords.length - 1]?.endMs ?? Math.max(baseStart, segEndMs);

  const reconciled: WordTokenLike[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const oldIdx = matchedOldIndex[k];
    if (oldIdx !== -1) {
      const orig = previousWords[oldIdx];
      reconciled[k] = {
        text: newTokens[k],
        startMs: orig.startMs,
        endMs: orig.endMs,
        prob: orig.prob,
        ...(orig.reviewed ? { reviewed: true } : {})
      };
    } else {
      // Interpolate timestamp from nearest matched neighbors
      let leftMs = baseStart;
      for (let l = k - 1; l >= 0; l--) {
        if (matchedOldIndex[l] !== -1) {
          leftMs = previousWords[matchedOldIndex[l]].endMs;
          break;
        }
      }
      let rightMs = baseEnd;
      for (let r = k + 1; r < n; r++) {
        if (matchedOldIndex[r] !== -1) {
          rightMs = previousWords[matchedOldIndex[r]].startMs;
          break;
        }
      }
      const safeStart = Math.max(0, Math.min(leftMs, rightMs));
      const safeEnd = Math.max(safeStart, Math.max(leftMs, rightMs));
      reconciled[k] = {
        text: newTokens[k],
        startMs: safeStart,
        endMs: safeEnd,
        prob: 1.0,
        reviewed: true
      };
    }
  }

  return reconciled;
}

/**
 * Locates the exact character range `[start, end]` of `wordsArr[targetIdx]` inside `textVal`,
 * preferring whole-word boundary matches to prevent substring collisions (e.g. "in" inside "beginning").
 */
export function findWordOffsetInText(
  textVal: string,
  wordsArr: readonly WordTokenLike[],
  targetIdx: number
): { start: number; end: number } | null {
  const targetWord = wordsArr[targetIdx];
  if (!targetWord) return null;
  const cleanWord = targetWord.text.trim();
  if (!cleanWord) return null;

  let occurrenceIndex = 0;
  for (let wi = 0; wi < targetIdx; wi++) {
    if (wordsArr[wi].text.trim() === cleanWord) {
      occurrenceIndex++;
    }
  }

  const escapedWord = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(
    `(^|\\s|[.,!?;:،؛«»"'\`\\(\\)\\[\\]])${escapedWord}(?=$|\\s|[.,!?;:،؛«»"'\`\\(\\)\\[\\]])`,
    'g'
  );
  let match: RegExpExecArray | null = null;
  let currentOccurrence = 0;
  let foundPos = -1;

  while ((match = wordRegex.exec(textVal)) !== null) {
    const matchWordStart = match.index + match[1].length;
    if (currentOccurrence === occurrenceIndex) {
      foundPos = matchWordStart;
      break;
    }
    currentOccurrence++;
  }

  if (foundPos === -1) {
    let searchFrom = 0;
    for (let occ = 0; occ <= occurrenceIndex; occ++) {
      foundPos = textVal.indexOf(cleanWord, searchFrom);
      if (foundPos === -1) break;
      searchFrom = foundPos + cleanWord.length;
    }
  }

  if (foundPos === -1) {
    foundPos = textVal.indexOf(cleanWord);
  }

  if (foundPos === -1) return null;
  return { start: foundPos, end: foundPos + cleanWord.length };
}

/**
 * Computes a gentle audio seek timestamp with pre-roll so the beginning of a clicked word isn't clipped.
 */
export function computeWordSeekMs(wordStartMs: number, segmentStartMs = 0): number {
  const safeWordStart = Math.max(0, Math.round(Number(wordStartMs) || 0));
  const safeSegStart = Math.max(0, Math.round(Number(segmentStartMs) || 0));
  if (safeWordStart === 0) return 0;
  return Math.max(safeSegStart, safeWordStart - CONFIDENCE_WORD_PREROLL_MS);
}
