import { describe, expect, it } from 'vitest';
import {
  OUTPUT_FORMAT_KEYS,
  MAX_I32,
  MAX_TIMECODE_MS,
  canToggleOutputFormatOff,
  ensureAtLeastOneOutputFormat,
  getRecommendedThreadCount,
  normalizeDigitsToAscii,
  filterNumericInputPreservingLocalizedDigits,
  clampIntSettingValue,
  clampFloatSettingValue,
  formatMsToTimecode,
  parseTimecodeToMs,
  evaluateCustomTimeRange,
  evaluateBatchTimeRange,
  computeTrimSliderState
} from './transcribeConfigHelpers';

describe('transcribeConfigHelpers', () => {
  describe('output format invariants', () => {
    it('allows turning off a format only when another output format remains enabled', () => {
      // Arrange
      const multiState = { outputSrt: true, outputVtt: true, outputTxt: false, outputLrc: false };
      const singleState = { outputSrt: true, outputVtt: false, outputTxt: false, outputLrc: false };

      // Act & Assert
      expect(canToggleOutputFormatOff(multiState, 'outputSrt')).toBe(true);
      expect(canToggleOutputFormatOff(singleState, 'outputSrt')).toBe(false);
      expect(canToggleOutputFormatOff(singleState, 'outputTxt')).toBe(true);
      expect(canToggleOutputFormatOff(null, 'outputSrt')).toBe(false);
    });

    it('enforces at least outputSrt=true when full payload disables all 4 formats', () => {
      // Arrange
      const allDisabled = { outputSrt: false, outputVtt: false, outputTxt: false, outputLrc: false };
      const partialPayload = { threads: 6 };

      // Act
      ensureAtLeastOneOutputFormat(allDisabled);
      ensureAtLeastOneOutputFormat(partialPayload);

      // Assert
      expect(allDisabled.outputSrt).toBe(true);
      expect(OUTPUT_FORMAT_KEYS).toContain('outputSrt');
      expect((partialPayload as any).outputSrt).toBeUndefined();
    });
  });

  describe('getRecommendedThreadCount', () => {
    it('recommends balanced CPU threads across core counts', () => {
      expect(getRecommendedThreadCount(0)).toBe(4);
      expect(getRecommendedThreadCount(2)).toBe(2);
      expect(getRecommendedThreadCount(4)).toBe(4);
      expect(getRecommendedThreadCount(6)).toBe(4);
      expect(getRecommendedThreadCount(8)).toBe(6);
      expect(getRecommendedThreadCount(12)).toBe(6);
      expect(getRecommendedThreadCount(16)).toBe(8);
      expect(getRecommendedThreadCount(40)).toBe(16);
    });
  });

  describe('timecode parsing, formatting & range validation', () => {
    it('normalizes Persian and Arabic digits cleanly before parsing and filters localized numeric input', () => {
      expect(normalizeDigitsToAscii('۰۱:۳۵')).toBe('01:35');
      expect(parseTimecodeToMs('۰۱:۳۰')).toBe(90_000);
      expect(parseTimecodeToMs('١٢:٠٥')).toBe(725_000);
      expect(filterNumericInputPreservingLocalizedDigits('۴۵abc-')).toBe('۴۵');
      expect(filterNumericInputPreservingLocalizedDigits('١٢x3')).toBe('١٢3');
    });

    it('formats and parses milliseconds across MM:SS, HH:MM:SS, and numeric seconds', () => {
      expect(formatMsToTimecode(0)).toBe('00:00');
      expect(formatMsToTimecode(90_000)).toBe('01:30');
      expect(formatMsToTimecode(3665_000)).toBe('01:01:05');

      expect(parseTimecodeToMs('45')).toBe(45_000);
      expect(parseTimecodeToMs('02:15.5')).toBe(135_500);
      expect(parseTimecodeToMs('01:02:03')).toBe(3723_000);

      expect(parseTimecodeToMs('01:60')).toBeNull();
      expect(parseTimecodeToMs('-10')).toBeNull();
      expect(parseTimecodeToMs('abc')).toBeNull();
      expect(parseTimecodeToMs('')).toBeNull();
    });

    it('validates custom time range slices against start/end order and media duration', () => {
      // Valid bounded slice
      const validSlice = evaluateCustomTimeRange('00:30', '01:15', 120);
      expect(validSlice).toEqual({
        valid: true,
        offsetT: 30_000,
        duration: 45_000,
        startMs: 30_000,
        endMs: 75_000
      });

      // Valid open-ended slice from offset to EOF
      const openEnd = evaluateCustomTimeRange('01:00', '', 120);
      expect(openEnd.valid).toBe(true);
      expect(openEnd.offsetT).toBe(60_000);
      expect(openEnd.duration).toBe(0);

      // Allows slight rounding tolerance at exact EOF and clamps to true duration
      const roundedEof = evaluateCustomTimeRange('01:00', '02:00', 119.6);
      expect(roundedEof.valid).toBe(true);
      expect(roundedEof.endMs).toBe(119_600);
      expect(roundedEof.duration).toBe(59_600);

      // Invalid format, reversed order, exceeds duration
      expect(evaluateCustomTimeRange('bad', '01:00', 120).reason).toBe('invalidFormat');
      expect(evaluateCustomTimeRange('01:30', '01:00', 120).reason).toBe('endBeforeStart');
      expect(evaluateCustomTimeRange('00:10', '03:00', 120).reason).toBe('exceedsDuration');
      expect(evaluateCustomTimeRange('02:10', '', 120).reason).toBe('exceedsDuration');
    });

    it('projects trim slider bounds and fill percentages accurately', () => {
      expect(computeTrimSliderState(30_000, 60_000, 120)).toEqual({
        maxSec: 120,
        startSec: 30,
        endSec: 90,
        startPct: '25.00%',
        widthPct: '50.00%'
      });

      // Open-ended slice extends endSec to maxSec
      expect(computeTrimSliderState(60_000, 0, 120)).toEqual({
        maxSec: 120,
        startSec: 60,
        endSec: 120,
        startPct: '50.00%',
        widthPct: '50.00%'
      });
    });

    it('validates batch global time range across mixed file durations and detects short/all-exceeded cases', () => {
      // Valid across mixed durations [40s, 180s, 300s] with 30s -> 120s: 1 clamped item (40s) and 0 skipped
      const validMixed = evaluateBatchTimeRange('00:30', '02:00', [40, 180, 300]);
      expect(validMixed.valid).toBe(true);
      expect(validMixed.offsetT).toBe(30_000);
      expect(validMixed.duration).toBe(90_000);
      expect(validMixed.shortItemCount).toBe(0);
      expect(validMixed.clampedItemCount).toBe(1);

      // Start 01:00 on [40s, 180s]: valid overall with 1 short item warning
      const partialShort = evaluateBatchTimeRange('01:00', '', [40, 180]);
      expect(partialShort.valid).toBe(true);
      expect(partialShort.shortItemCount).toBe(1);

      // Start 05:00 on [40s, 180s]: exceeds ALL queued files -> invalid
      const allShort = evaluateBatchTimeRange('05:00', '', [40, 180]);
      expect(allShort.valid).toBe(false);
      expect(allShort.reason).toBe('exceedsAllBatchDurations');
      expect(allShort.maxKnownDurationSec).toBe(180);

      // Pending/unknown durations allow syntax-valid range
      const pending = evaluateBatchTimeRange('00:30', '01:00', [null, undefined]);
      expect(pending.valid).toBe(true);
      expect(pending.knownDurationCount).toBe(0);
    });

    it('preserves sub-second milliseconds losslessly when preserveSubseconds is enabled', () => {
      // Whole seconds remain clean MM:SS / HH:MM:SS
      expect(formatMsToTimecode(90_000, true)).toBe('01:30');
      expect(formatMsToTimecode(3665_000, true)).toBe('01:01:05');

      // Non-zero sub-seconds round-trip cleanly through parseTimecodeToMs
      expect(formatMsToTimecode(1_500, true)).toBe('00:01.5');
      expect(formatMsToTimecode(1_250, true)).toBe('00:01.25');
      expect(formatMsToTimecode(1_005, true)).toBe('00:01.005');
      expect(formatMsToTimecode(3665_500, true)).toBe('01:01:05.5');

      expect(parseTimecodeToMs(formatMsToTimecode(1_500, true))).toBe(1_500);
      expect(parseTimecodeToMs(formatMsToTimecode(1_900, true))).toBe(1_900);
      expect(parseTimecodeToMs(formatMsToTimecode(3665_500, true))).toBe(3665_500);

      // Default mode still formats whole seconds cleanly for display summaries
      expect(formatMsToTimecode(1_500)).toBe('00:01');
    });

    it('rejects startMs at rounded EOF consistently so sub-millisecond durations never collapse to zero', () => {
      // Arrange & Act: 10.0004s rounds to 10_000ms; start 00:10 (10_000ms) must not validate with duration 0
      const res = evaluateCustomTimeRange('00:10', '00:10.5', 10.0004);

      // Assert
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('exceedsDuration');
    });

    it('rejects timecodes exceeding Rust i32 millisecond bounds to prevent JS/Rust divergence', () => {
      // Arrange & Act & Assert
      expect(parseTimecodeToMs(String(MAX_TIMECODE_MS / 1000))).toBe(MAX_TIMECODE_MS);
      expect(parseTimecodeToMs('999999999')).toBeNull();
      expect(parseTimecodeToMs('600:00:00')).toBeNull();
      expect(evaluateCustomTimeRange('999999999', '', 0).reason).toBe('invalidFormat');
    });

    it('clamps integer settings within Rust i32 bounds and parses localized numerals', () => {
      // Arrange & Act & Assert
      expect(clampIntSettingValue('offsetT', 3_000_000_000)).toBe(MAX_TIMECODE_MS);
      expect(clampIntSettingValue('duration', -500)).toBe(0);
      expect(clampIntSettingValue('threads', '۸')).toBe(8);
      expect(clampIntSettingValue('threads', 9_999_999_999)).toBe(256);
      expect(clampIntSettingValue('processors', 999)).toBe(64);
      expect(clampIntSettingValue('audioCtx', 5000)).toBe(1500);
      expect(clampIntSettingValue('maxContext', 9_999_999_999)).toBe(MAX_I32);
      expect(clampIntSettingValue('threads', 'not-a-number')).toBe(1);
      expect(clampIntSettingValue('maxContext', 'not-a-number')).toBe(-1);
      expect(clampIntSettingValue('beamSize', '۱۲')).toBe(8);
      expect(clampIntSettingValue('bestOf', '۰')).toBe(1);
      expect(clampIntSettingValue('maxLen', '۴۲')).toBe(42);
    });

    it('clamps float settings consistently with Rust backend bounds and localized numerals', () => {
      expect(clampFloatSettingValue('vadThold', '5')).toBe(1.0);
      expect(clampFloatSettingValue('vadThold', -0.5)).toBe(0.0);
      expect(clampFloatSettingValue('vadOverlap', '۰.۵')).toBe(0.5);
      expect(clampFloatSettingValue('vadOverlap', 2.4)).toBe(1.0);
      expect(clampFloatSettingValue('wordThold', '1.8')).toBe(1.0);
      expect(clampFloatSettingValue('noSpeechThold', -1)).toBe(0.0);
      expect(clampFloatSettingValue('temperature', -0.2)).toBe(0.0);
      expect(clampFloatSettingValue('temperature', 3.5)).toBe(2.0);
      expect(clampFloatSettingValue('temperatureInc', 9)).toBe(2.0);
      expect(clampFloatSettingValue('entropyThold', -2)).toBe(0.0);
      expect(clampFloatSettingValue('logprobThold', 5)).toBe(0.0);
      expect(clampFloatSettingValue('logprobThold', -1.5)).toBe(-1.5);
      expect(clampFloatSettingValue('vadMaxSpeech', 'invalid')).toBe(30.0);
      expect(clampFloatSettingValue('vadMaxSpeech', 0)).toBe(30.0);
      expect(clampFloatSettingValue('vadMaxSpeech', 500)).toBe(300.0);
      expect(clampFloatSettingValue('uiScale', 0.4)).toBe(0.7);
      expect(clampFloatSettingValue('uiScale', 2.2)).toBe(1.6);
      expect(clampFloatSettingValue('uiScale', 1.126)).toBe(1.13);
    });
  });
});
