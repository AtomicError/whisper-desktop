// Pure helpers for Transcribe Studio quick setup: output format invariants,
// timecode parsing/validation, trim slider projection, and thread recommendation.

export const OUTPUT_FORMAT_KEYS = ['outputSrt', 'outputVtt', 'outputTxt', 'outputLrc'] as const;
export type OutputFormatKey = (typeof OUTPUT_FORMAT_KEYS)[number];

/** Maximum signed 32-bit integer accepted by Rust `i32` settings fields. */
export const MAX_I32 = 2_147_483_647;

/** Maximum timecode in milliseconds fitting cleanly within Rust `i32` (`i32::MAX = 2_147_483_647`). */
export const MAX_TIMECODE_MS = 2_147_483_000;

export interface TimeRangeValidationResult {
  valid: boolean;
  reason?: 'invalidFormat' | 'endBeforeStart' | 'exceedsDuration';
  offsetT: number;
  duration: number;
  startMs: number;
  endMs: number | null;
}

export interface BatchTimeRangeValidationResult {
  valid: boolean;
  reason?: 'invalidFormat' | 'endBeforeStart' | 'exceedsAllBatchDurations';
  offsetT: number;
  duration: number;
  startMs: number;
  endMs: number | null;
  maxKnownDurationSec: number;
  shortItemCount: number;
  clampedItemCount: number;
  knownDurationCount: number;
}

export interface TrimSliderState {
  maxSec: number;
  startSec: number;
  endSec: number;
  startPct: string;
  widthPct: string;
}

/**
 * Checks whether turning off `targetKey` leaves at least one other output format enabled.
 */
export function canToggleOutputFormatOff(
  state: (Partial<Record<OutputFormatKey, unknown>> & Record<string, unknown>) | null | undefined,
  targetKey: OutputFormatKey
): boolean {
  if (!state) return false;
  return OUTPUT_FORMAT_KEYS.some(key => key !== targetKey && Boolean(state[key]));
}

/**
 * Ensures full settings payloads never have all 4 output formats disabled at once.
 */
export function ensureAtLeastOneOutputFormat(
  payload: (Partial<Record<OutputFormatKey, unknown>> & Record<string, unknown>) | null | undefined
): void {
  if (!payload || typeof payload !== 'object') return;
  const hasAllKeys = OUTPUT_FORMAT_KEYS.every(key => payload[key] !== undefined);
  if (hasAllKeys && OUTPUT_FORMAT_KEYS.every(key => !payload[key])) {
    payload.outputSrt = true;
  }
}

/**
 * Computes a sensible CPU thread count leaving headroom for the OS and WebView.
 */
export function getRecommendedThreadCount(cpuCores: number): number {
  const cores = Math.floor(Number(cpuCores) || 0);
  if (cores <= 0) return 4;
  if (cores <= 4) return cores;
  if (cores <= 8) return Math.max(4, cores - 2);
  return Math.min(16, Math.floor(cores / 2));
}

/**
 * Normalizes Persian (U+06F0..U+06F9) and Arabic-Indic (U+0660..U+0669) digits to ASCII.
 */
export function normalizeDigitsToAscii(raw: string): string {
  return String(raw || '')
    .replace(/[\u06F0-\u06F9]/g, ch => String(ch.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, ch => String(ch.charCodeAt(0) - 0x0660));
}

/**
 * Strips non-digit characters while preserving ASCII, Persian, and Arabic-Indic numerals.
 */
export function filterNumericInputPreservingLocalizedDigits(raw: string): string {
  return String(raw || '').replace(/[^\d\u06F0-\u06F9\u0660-\u0669]/g, '');
}

/**
 * Parses and clamps integer Whisper settings safely within Rust `i32` bounds,
 * supporting ASCII, Persian, and Arabic-Indic numerals.
 */
export function clampIntSettingValue(key: string, raw: unknown): number {
  const parsed = parseInt(normalizeDigitsToAscii(String(raw ?? '')).trim(), 10);
  if (Number.isNaN(parsed)) {
    if (key === 'maxContext') return -1;
    if (key === 'confidenceThreshold') return 70;
    if (key === 'threads' || key === 'processors' || key === 'bestOf' || key === 'beamSize') return 1;
    return 0;
  }

  if (key === 'confidenceThreshold') {
    if (parsed <= 0) return 70;
    const clamped = Math.max(40, Math.min(95, parsed));
    return Math.max(40, Math.min(95, Math.round(clamped / 5) * 5));
  }
  if (key === 'bestOf' || key === 'beamSize') {
    return Math.max(1, Math.min(8, parsed));
  }
  if (key === 'offsetT' || key === 'duration') {
    return Math.max(0, Math.min(MAX_TIMECODE_MS, parsed));
  }
  if (key === 'threads' || key === 'processors') {
    return Math.max(1, Math.min(MAX_I32, parsed));
  }
  if (key === 'maxContext') {
    return Math.max(-1, Math.min(MAX_I32, parsed));
  }
  if (
    key === 'maxLen' ||
    key === 'audioCtx' ||
    key === 'deviceId' ||
    key === 'vadMinSpeech' ||
    key === 'vadMinSil' ||
    key === 'vadSpeechPad'
  ) {
    return Math.max(0, Math.min(MAX_I32, parsed));
  }
  return Math.max(-MAX_I32 - 1, Math.min(MAX_I32, parsed));
}

/**
 * Parses and clamps floating-point Whisper settings safely within Rust backend bounds,
 * supporting ASCII, Persian, and Arabic-Indic numerals.
 */
export function clampFloatSettingValue(key: string, raw: unknown): number {
  const parsed = parseFloat(normalizeDigitsToAscii(String(raw ?? '')).trim());
  const isValid = Number.isFinite(parsed);

  if (key === 'vadMaxSpeech') {
    if (!isValid || parsed <= 0.0 || parsed >= 1000.0) return 30.0;
    return Math.max(1.0, Math.min(300.0, parsed));
  }
  if (key === 'uiScale') {
    if (!isValid || parsed <= 0.0) return 1.0;
    const rounded = Math.round(parsed * 100) / 100;
    return Math.max(0.7, Math.min(1.6, rounded));
  }
  if (key === 'vadThold' || key === 'vadOverlap' || key === 'wordThold' || key === 'noSpeechThold') {
    if (!isValid) return 0.0;
    return Math.max(0.0, Math.min(1.0, parsed));
  }
  if (key === 'temperature' || key === 'temperatureInc') {
    if (!isValid) return 0.0;
    return Math.max(0.0, Math.min(2.0, parsed));
  }
  if (key === 'entropyThold') {
    if (!isValid) return 0.0;
    return Math.max(0.0, parsed);
  }
  if (key === 'logprobThold') {
    if (!isValid) return 0.0;
    return Math.min(0.0, parsed);
  }
  return isValid ? parsed : 0.0;
}

/**
 * Formats milliseconds into a clean digital timecode (`MM:SS` or `HH:MM:SS`).
 * When `preserveSubseconds` is true and `ms` has a non-zero millisecond remainder,
 * appends trimmed fractional seconds (e.g. `00:01.5`) for lossless round-tripping.
 */
export function formatMsToTimecode(ms: number, preserveSubseconds = false): string {
  const safeMs = Math.max(0, Math.round(Number(ms) || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const remMs = safeMs % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frac =
    preserveSubseconds && remMs > 0
      ? `.${String(remMs).padStart(3, '0').replace(/0+$/, '')}`
      : '';

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${frac}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${frac}`;
}

/**
 * Parses `SS`, `MM:SS(.ms)`, or `HH:MM:SS(.ms)` into integer milliseconds, or `null` if invalid.
 */
export function parseTimecodeToMs(rawInput: string): number | null {
  const normalized = normalizeDigitsToAscii(rawInput).trim();
  if (!normalized) return null;

  const parts = normalized.split(':');
  if (parts.length > 3) return null;

  if (parts.length === 1) {
    if (!/^\d+(?:\.\d+)?$/.test(parts[0])) return null;
    const secs = Number(parts[0]);
    if (!Number.isFinite(secs) || secs < 0) return null;
    const ms = Math.round(secs * 1000);
    return ms <= MAX_TIMECODE_MS ? ms : null;
  }

  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[0]) || !/^\d+(?:\.\d+)?$/.test(parts[1])) return null;
    const mins = Number(parts[0]);
    const secs = Number(parts[1]);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
    const ms = Math.round((mins * 60 + secs) * 1000);
    return ms <= MAX_TIMECODE_MS ? ms : null;
  }

  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^\d+(?:\.\d+)?$/.test(parts[2])) {
    return null;
  }
  const hrs = Number(parts[0]);
  const mins = Number(parts[1]);
  const secs = Number(parts[2]);
  if (!Number.isFinite(hrs) || !Number.isFinite(mins) || !Number.isFinite(secs) || mins >= 60 || secs >= 60) {
    return null;
  }
  const ms = Math.round((hrs * 3600 + mins * 60 + secs) * 1000);
  return ms <= MAX_TIMECODE_MS ? ms : null;
}

/**
 * Validates custom Start/End range inputs against optional probed media duration (in seconds)
 * and translates them into Whisper `-ot` (`offsetT`) and `-d` (`duration`) millisecond settings.
 */
export function evaluateCustomTimeRange(
  startStr: string,
  endStr: string,
  totalDurationSec = 0
): TimeRangeValidationResult {
  const startTrimmed = normalizeDigitsToAscii(startStr).trim();
  const endTrimmed = normalizeDigitsToAscii(endStr).trim();

  const startMs = startTrimmed ? parseTimecodeToMs(startTrimmed) : 0;
  if (startMs === null) {
    return { valid: false, reason: 'invalidFormat', offsetT: 0, duration: 0, startMs: 0, endMs: null };
  }

  const endMs = endTrimmed ? parseTimecodeToMs(endTrimmed) : null;
  if (endTrimmed && endMs === null) {
    return { valid: false, reason: 'invalidFormat', offsetT: 0, duration: 0, startMs, endMs: null };
  }

  if (totalDurationSec > 0) {
    const totalMs = Math.max(1, Math.round(totalDurationSec * 1000));
    if (startMs >= totalMs) {
      return { valid: false, reason: 'exceedsDuration', offsetT: 0, duration: 0, startMs, endMs };
    }
    // Allow 500ms rounding slack when user types rounded integer seconds matching EOF display
    if (endMs !== null && endMs > totalMs + 500) {
      return { valid: false, reason: 'exceedsDuration', offsetT: 0, duration: 0, startMs, endMs };
    }
  }

  if (endMs !== null && endMs <= startMs) {
    return { valid: false, reason: 'endBeforeStart', offsetT: 0, duration: 0, startMs, endMs };
  }

  const clampedEndMs =
    endMs !== null && totalDurationSec > 0
      ? Math.min(endMs, Math.max(1, Math.round(totalDurationSec * 1000)))
      : endMs;

  const duration = clampedEndMs !== null ? Math.max(0, clampedEndMs - startMs) : 0;
  return {
    valid: true,
    offsetT: startMs,
    duration,
    startMs,
    endMs: clampedEndMs
  };
}

/**
 * Validates a global custom time slice across all queued batch items.
 * Rejects invalid syntax, inverted ranges, or a start time that exceeds every known file duration,
 * while reporting partial short-file warnings and EOF clamping counts.
 */
export function evaluateBatchTimeRange(
  startStr: string,
  endStr: string,
  itemDurationsSec: Array<number | null | undefined>
): BatchTimeRangeValidationResult {
  const base = evaluateCustomTimeRange(startStr, endStr, 0);
  if (!base.valid) {
    return {
      valid: false,
      reason: base.reason === 'exceedsDuration' ? 'exceedsAllBatchDurations' : base.reason,
      offsetT: 0,
      duration: 0,
      startMs: base.startMs,
      endMs: base.endMs,
      maxKnownDurationSec: 0,
      shortItemCount: 0,
      clampedItemCount: 0,
      knownDurationCount: 0
    };
  }

  const knownDurations = (Array.isArray(itemDurationsSec) ? itemDurationsSec : [])
    .map(d => Number(d))
    .filter(d => Number.isFinite(d) && d > 0);

  const knownDurationCount = knownDurations.length;
  const maxKnownDurationSec = knownDurationCount > 0 ? Math.max(...knownDurations) : 0;

  let shortItemCount = 0;
  let clampedItemCount = 0;
  for (const durSec of knownDurations) {
    const durMs = Math.max(1, Math.round(durSec * 1000));
    if (base.startMs >= durMs) {
      shortItemCount++;
    } else if (base.endMs !== null && base.endMs > durMs + 500) {
      clampedItemCount++;
    }
  }

  if (knownDurationCount > 0 && shortItemCount === knownDurationCount) {
    return {
      valid: false,
      reason: 'exceedsAllBatchDurations',
      offsetT: 0,
      duration: 0,
      startMs: base.startMs,
      endMs: base.endMs,
      maxKnownDurationSec,
      shortItemCount,
      clampedItemCount,
      knownDurationCount
    };
  }

  return {
    valid: true,
    offsetT: base.offsetT,
    duration: base.duration,
    startMs: base.startMs,
    endMs: base.endMs,
    maxKnownDurationSec,
    shortItemCount,
    clampedItemCount,
    knownDurationCount
  };
}

/**
 * Projects Whisper `offsetT` and `duration` (ms) onto integer-second dual trim slider bounds and fill percentages.
 */
export function computeTrimSliderState(
  offsetMs: number,
  durationMs: number,
  totalDurationSec: number
): TrimSliderState {
  const maxSec = Math.max(1, Math.round(Math.max(0, totalDurationSec)));
  const rawStart = Math.round(Math.max(0, offsetMs) / 1000);
  const startSec = Math.min(maxSec, rawStart);
  const rawEnd = durationMs > 0 ? Math.round((Math.max(0, offsetMs) + durationMs) / 1000) : maxSec;
  const endSec = Math.max(startSec, Math.min(maxSec, rawEnd));

  const startPctNum = (startSec / maxSec) * 100;
  const widthPctNum = Math.max(0, ((endSec - startSec) / maxSec) * 100);
  return {
    maxSec,
    startSec,
    endSec,
    startPct: `${startPctNum.toFixed(2)}%`,
    widthPct: `${widthPctNum.toFixed(2)}%`
  };
}
