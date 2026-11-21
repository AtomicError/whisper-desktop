import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD_DEFAULT,
  CONFIDENCE_THRESHOLD_MIN,
  CONFIDENCE_THRESHOLD_MAX,
  clampConfidenceThreshold,
  getCriticalThresholdPercent,
  classifyWordConfidence,
  isStandalonePunctuationToken,
  evaluateLineConfidence,
  computeConfidenceSummary,
  reconcileWordsAfterEdit,
  findWordOffsetInText,
  computeWordSeekMs
} from './confidenceHelpers';
import { aggregateTokensIntoWords } from './transcriptViewer';
import { en } from '../locales/en';
import { fa } from '../locales/fa';
import { ar } from '../locales/ar';
import { de } from '../locales/de';
import { es } from '../locales/es';
import { fr } from '../locales/fr';
import { it as itLoc } from '../locales/it';
import { ja } from '../locales/ja';
import { ko } from '../locales/ko';
import { pt } from '../locales/pt';
import { ru } from '../locales/ru';
import { tr } from '../locales/tr';
import { zh } from '../locales/zh';

describe('confidenceHelpers — threshold clamping & two-tier classification', () => {
  it('clamps threshold values to [40, 95] with 70% default and supports Persian/Arabic digits', () => {
    expect(clampConfidenceThreshold(undefined)).toBe(CONFIDENCE_THRESHOLD_DEFAULT);
    expect(clampConfidenceThreshold(null)).toBe(CONFIDENCE_THRESHOLD_DEFAULT);
    expect(clampConfidenceThreshold('')).toBe(CONFIDENCE_THRESHOLD_DEFAULT);
    expect(clampConfidenceThreshold(0)).toBe(CONFIDENCE_THRESHOLD_DEFAULT);
    expect(clampConfidenceThreshold(-10)).toBe(CONFIDENCE_THRESHOLD_DEFAULT);
    expect(clampConfidenceThreshold(Number.NaN)).toBe(CONFIDENCE_THRESHOLD_DEFAULT);

    expect(clampConfidenceThreshold(25)).toBe(CONFIDENCE_THRESHOLD_MIN);
    expect(clampConfidenceThreshold(120)).toBe(CONFIDENCE_THRESHOLD_MAX);
    expect(clampConfidenceThreshold(80)).toBe(80);
    expect(clampConfidenceThreshold('۸۰')).toBe(80);
    expect(clampConfidenceThreshold('٨٥')).toBe(85);
  });

  it('computes critical threshold strictly below user threshold and classifies probabilities accurately', () => {
    expect(getCriticalThresholdPercent(70)).toBe(45);
    expect(getCriticalThresholdPercent(80)).toBe(45);
    expect(getCriticalThresholdPercent(60)).toBe(35);
    expect(getCriticalThresholdPercent(40)).toBe(25);

    expect(classifyWordConfidence(0.92, 70)).toBe('ok');
    expect(classifyWordConfidence(0.70, 70)).toBe('ok');
    expect(classifyWordConfidence(0.69, 70)).toBe('low');
    expect(classifyWordConfidence(0.45, 70)).toBe('low');
    expect(classifyWordConfidence(0.44, 70)).toBe('critical');

    // Raising threshold to 85% flags 0.78 as low without touching critical tier
    expect(classifyWordConfidence(0.78, 70)).toBe('ok');
    expect(classifyWordConfidence(0.78, 85)).toBe('low');
  });
});

describe('aggregateTokensIntoWords — punctuation poisoning prevention', () => {
  it('detects standalone punctuation tokens across Latin and Persian/Arabic scripts', () => {
    expect(isStandalonePunctuationToken('.')).toBe(true);
    expect(isStandalonePunctuationToken('،')).toBe(true);
    expect(isStandalonePunctuationToken('؟')).toBe(true);
    expect(isStandalonePunctuationToken('«')).toBe(true);
    expect(isStandalonePunctuationToken('...')).toBe(true);
    expect(isStandalonePunctuationToken('vertically')).toBe(false);
    expect(isStandalonePunctuationToken("don't")).toBe(false);
    expect(isStandalonePunctuationToken('سلام')).toBe(false);
  });

  it('prevents trailing punctuation low probability from poisoning a high-confidence word', () => {
    // Mirrors real Whisper output where "vertically" is 96% confident but trailing "." is 42%
    const tokens = [
      { text: ' Slice', offsets: { from: 0, to: 300 }, p: 0.98 },
      { text: ' the', offsets: { from: 300, to: 500 }, p: 0.99 },
      { text: ' onion', offsets: { from: 500, to: 900 }, p: 0.95 },
      { text: ' vertically', offsets: { from: 900, to: 1500 }, p: 0.96 },
      { text: '.', offsets: { from: 1500, to: 1560 }, p: 0.42 }
    ];

    const words = aggregateTokensIntoWords(tokens, 0, 1600, 'Slice the onion vertically.');
    expect(words.length).toBe(4);
    expect(words[3].text).toBe('vertically.');
    expect(words[3].prob).toBe(0.96);
    expect(words[3].endMs).toBe(1560);
  });

  it('prevents leading and trailing Persian quotes from poisoning the enclosed word', () => {
    const tokens = [
      { text: ' «', offsets: { from: 0, to: 50 }, p: 0.38 },
      { text: 'سل', offsets: { from: 50, to: 200 }, p: 0.93 },
      { text: 'ام', offsets: { from: 200, to: 350 }, p: 0.89 },
      { text: '»', offsets: { from: 350, to: 400 }, p: 0.41 }
    ];

    const words = aggregateTokensIntoWords(tokens, 0, 400, '«سلام»');
    expect(words.length).toBe(1);
    expect(words[0].text).toBe('«سلام»');
    expect(words[0].prob).toBe(0.89);
  });

  it('still flags a word when an actual lexical subword has low probability', () => {
    const tokens = [
      { text: ' ver', offsets: { from: 0, to: 200 }, p: 0.95 },
      { text: 'tically', offsets: { from: 200, to: 500 }, p: 0.48 },
      { text: '.', offsets: { from: 500, to: 550 }, p: 0.30 }
    ];

    const words = aggregateTokensIntoWords(tokens, 0, 550, 'vertically.');
    expect(words.length).toBe(1);
    expect(words[0].prob).toBe(0.48);
  });
});

describe('reconcileWordsAfterEdit & summary evaluation', () => {
  it('preserves untouched word confidences when fixing one low-confidence word', () => {
    const prev = [
      { text: 'Slice', startMs: 0, endMs: 300, prob: 0.95 },
      { text: 'union', startMs: 300, endMs: 600, prob: 0.42 },
      { text: 'vertically', startMs: 600, endMs: 1100, prob: 0.55 }
    ];

    const next = reconcileWordsAfterEdit(prev, 'Slice onion vertically', 0, 1100);
    expect(next).toBeDefined();
    expect(next?.length).toBe(3);
    expect(next?.[0]).toEqual({ text: 'Slice', startMs: 0, endMs: 300, prob: 0.95 });
    expect(next?.[1]).toMatchObject({ text: 'onion', prob: 1.0, reviewed: true });
    expect(next?.[2]).toEqual({ text: 'vertically', startMs: 600, endMs: 1100, prob: 0.55 });
  });

  it('invalidates tokens cleanly when text is completely rewritten or emptied', () => {
    const prev = [
      { text: 'Hello', startMs: 0, endMs: 500, prob: 0.9 },
      { text: 'world', startMs: 500, endMs: 1000, prob: 0.5 }
    ];
    expect(reconcileWordsAfterEdit(prev, 'Completely unrelated sentence', 0, 1000)).toBeUndefined();
    expect(reconcileWordsAfterEdit(prev, '   ', 0, 1000)).toBeUndefined();
  });

  it('computes accurate multi-segment summary and skips reviewed words', () => {
    const lines = [
      {
        id: 0,
        text: 'One two three',
        words: [
          { text: 'One', startMs: 0, endMs: 300, prob: 0.95 },
          { text: 'two', startMs: 300, endMs: 600, prob: 0.62 },
          { text: 'three', startMs: 600, endMs: 900, prob: 0.32 }
        ]
      },
      {
        id: 1,
        text: 'Clean line',
        words: [
          { text: 'Clean', startMs: 1000, endMs: 1300, prob: 0.98 },
          { text: 'line', startMs: 1300, endMs: 1600, prob: 0.91 }
        ]
      },
      {
        id: 2,
        text: 'Reviewed word',
        words: [
          { text: 'Reviewed', startMs: 2000, endMs: 2400, prob: 1.0, reviewed: true },
          { text: 'word', startMs: 2400, endMs: 2800, prob: 0.85 }
        ]
      }
    ];

    const summary = computeConfidenceSummary(lines, 70);
    expect(summary.hasConfidenceData).toBe(true);
    expect(summary.lowWordCount).toBe(2);
    expect(summary.criticalWordCount).toBe(1);
    expect(summary.flaggedSegmentCount).toBe(1);
    expect(summary.flaggedSegmentIds).toEqual([0]);

    expect(evaluateLineConfidence(lines[0], 70)).toMatchObject({ level: 'critical', flaggedCount: 2, criticalCount: 1 });
    expect(evaluateLineConfidence(lines[2], 70)).toMatchObject({ level: 'ok', flaggedCount: 0, hasReviewedWords: true });
  });

  it('computes pre-roll seek timestamp bounded by segment start', () => {
    expect(computeWordSeekMs(1500, 1000)).toBe(1280);
    expect(computeWordSeekMs(1050, 1000)).toBe(1000);
    expect(computeWordSeekMs(0, 0)).toBe(0);
  });

  it('finds exact whole-word offsets without matching inner substrings', () => {
    const words = [
      { text: 'The', startMs: 0, endMs: 100, prob: 0.9 },
      { text: 'beginning', startMs: 100, endMs: 300, prob: 0.9 },
      { text: 'in', startMs: 300, endMs: 400, prob: 0.5 },
      { text: 'the', startMs: 400, endMs: 500, prob: 0.9 }
    ];
    expect(findWordOffsetInText('The beginning in the', words, 2)).toEqual({ start: 14, end: 16 });
  });
});

describe('Confidence feature locale symmetry across all 13 languages', () => {
  const allLocales = { en, fa, ar, de, es, fr, it: itLoc, ja, ko, pt, ru, tr, zh };

  it('includes parameterized threshold placeholder and all review bar & settings keys in every locale', () => {
    for (const [code, loc] of Object.entries(allLocales)) {
      expect(loc.transcribe.toggleConfidenceTooltip, `${code}.toggleConfidenceTooltip`).toContain('{threshold}');
      expect(loc.transcribe.confidenceUnavailableTooltip, `${code}.confidenceUnavailableTooltip`).toBeTruthy();
      expect(loc.transcribe.confidenceReviewSummary, `${code}.confidenceReviewSummary`).toContain('{words}');
      expect(loc.transcribe.confidenceReviewSummary, `${code}.confidenceReviewSummary`).toContain('{segments}');
      expect(loc.transcribe.confidenceAllClear, `${code}.confidenceAllClear`).toContain('{threshold}');
      expect(loc.transcribe.confidenceThresholdShort, `${code}.confidenceThresholdShort`).toBeTruthy();
      expect(loc.transcribe.confidenceLowOnly, `${code}.confidenceLowOnly`).toBeTruthy();
      expect(loc.transcribe.confidencePrevTooltip, `${code}.confidencePrevTooltip`).toBeTruthy();
      expect(loc.transcribe.confidenceNextTooltip, `${code}.confidenceNextTooltip`).toBeTruthy();
      expect(loc.transcribe.wordConfidenceCriticalTooltip, `${code}.wordConfidenceCriticalTooltip`).toContain('{percent}');
      expect(loc.transcribe.wordConfidenceReviewedTooltip, `${code}.wordConfidenceReviewedTooltip`).toContain('{word}');
      expect(loc.settings.confidenceThresholdTitle, `${code}.confidenceThresholdTitle`).toBeTruthy();
      expect(loc.settings.confidenceThresholdDesc, `${code}.confidenceThresholdDesc`).toBeTruthy();
      expect(loc.settings.confidenceThresholdPoints, `${code}.confidenceThresholdPoints`).toBeTruthy();
    }
  });
});
