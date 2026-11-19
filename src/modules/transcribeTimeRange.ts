// Transcribe Studio Time Range & Dual-Handle Trim Slider Controller
// Handles Single-File and Batch Global time slicing, player position capture,
// interactive trim slider projection, and validation/hint synchronization.
import { t, getLanguage, isRtlLanguage, isolateLtr } from '../i18n/index';
import { showNotification } from './appModal';
import { formatLocalizedNumber } from '../i18n/formatters';
import {
  formatMsToTimecode,
  parseTimecodeToMs,
  evaluateCustomTimeRange,
  evaluateBatchTimeRange,
  computeTrimSliderState
} from './transcribeConfigHelpers';
import {
  getTranscribeDeckHost,
  type SettingsState
} from './transcribeDeckHost';

const getSettingsState = (): SettingsState | null => getTranscribeDeckHost().getSettingsState();
const saveCurrentSettings = (immediate?: boolean): any => getTranscribeDeckHost().saveCurrentSettings(immediate);
const isBatchRangeMode = (): boolean => getTranscribeDeckHost().isBatchRangeMode();
const getBatchQueueItems = () => getTranscribeDeckHost().getBatchQueueItems();
const getProbedDurationSec = (): number => getTranscribeDeckHost().getProbedDurationSec();
const notifyDeckScrollCue = (): void => getTranscribeDeckHost().notifyDeckScrollCue();

let quickRangeMode: 'full' | 'custom' = 'full';
let hasRangeValidationError = false;

type RangeHintStatus = 'neutral' | 'error' | 'warning';

export function resetQuickTimeRangeState(): void {
  quickRangeMode = 'full';
  hasRangeValidationError = false;
}

export function resetQuickRangeModeIfZero(): void {
  const current = getSettingsState();
  if (!current || (Number(current.offsetT || 0) === 0 && Number(current.duration || 0) === 0)) {
    resetQuickTimeRangeState();
  }
}

export function clearQuickRangeValidationError(): void {
  hasRangeValidationError = false;
}

function syncSettingsInputElement(id: string, value: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (el) el.value = value;
}

function setRangeHint(
  message: string,
  status: RangeHintStatus,
  isLtrReadout = false,
  i18nKey?: string
): void {
  const hintEl = document.getElementById('quick-range-hint');
  if (hintEl) {
    hintEl.textContent = message;
    hintEl.classList.toggle('is-error', status === 'error');
    hintEl.classList.toggle('is-warning', status === 'warning');
    if (typeof hintEl.setAttribute === 'function') {
      if (i18nKey) {
        hintEl.setAttribute('data-i18n', i18nKey);
      } else if (typeof hintEl.removeAttribute === 'function') {
        hintEl.removeAttribute('data-i18n');
      }
      if (isLtrReadout && status === 'neutral') {
        hintEl.setAttribute('dir', 'ltr');
      } else if (typeof hintEl.removeAttribute === 'function') {
        hintEl.removeAttribute('dir');
      }
    }
  }
  const startWrap = document.getElementById('quick-range-start')?.closest?.('.transcribe-range-input-wrap');
  const endWrap = document.getElementById('quick-range-end')?.closest?.('.transcribe-range-input-wrap');
  startWrap?.classList.toggle('is-invalid', status === 'error');
  endWrap?.classList.toggle('is-invalid', status === 'error');
}

function applyRangeBatchVisibilityDOM(isBatch: boolean): void {
  const inputsPanel = document.getElementById('quick-range-inputs');
  if (inputsPanel) {
    inputsPanel.classList.toggle('is-batch-mode', isBatch);
  }
  const sliderWrap = document.getElementById('quick-range-slider-wrap');
  if (sliderWrap) {
    sliderWrap.style.display = isBatch ? 'none' : 'flex';
  }
  (['btn-range-start-player', 'btn-range-end-player'] as const).forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.style.display = isBatch ? 'none' : '';
    }
  });
}

export function updateTranscribeRangeVisibility(isBatch: boolean): void {
  if (typeof document === 'undefined') return;
  const rangeGroup = document.getElementById('quick-range-group');
  if (rangeGroup) {
    rangeGroup.style.display = 'flex';
  }
  applyRangeBatchVisibilityDOM(isBatch);
  syncQuickTimeRangeUI();
  notifyDeckScrollCue();
}

function setTrimFillProps(fillEl: HTMLElement | null, startPct: string, widthPct: string): void {
  if (!fillEl || !fillEl.style) return;
  if (typeof fillEl.style.setProperty === 'function') {
    fillEl.style.setProperty('--trim-start-pct', startPct);
    fillEl.style.setProperty('--trim-width-pct', widthPct);
  } else {
    (fillEl.style as any)['--trim-start-pct'] = startPct;
    (fillEl.style as any)['--trim-width-pct'] = widthPct;
  }
}

function updateTrimSliderVisuals(offsetMs: number, durationMs: number, totalDurSec: number): void {
  const sliderWrap = document.getElementById('quick-range-slider-wrap');
  const startSlider = document.getElementById('quick-range-slider-start') as HTMLInputElement | null;
  const endSlider = document.getElementById('quick-range-slider-end') as HTMLInputElement | null;
  const fillEl = document.getElementById('quick-range-fill');
  if (!sliderWrap) return;

  if (isBatchRangeMode()) {
    sliderWrap.style.display = 'none';
    return;
  }

  sliderWrap.style.display = 'flex';
  if (Math.round(totalDurSec) < 2) {
    sliderWrap.classList.add('is-disabled');
    if (startSlider) {
      startSlider.disabled = true;
      startSlider.max = '100';
      startSlider.value = '0';
    }
    if (endSlider) {
      endSlider.disabled = true;
      endSlider.max = '100';
      endSlider.value = '100';
    }
    setTrimFillProps(fillEl, '0%', '100%');
    return;
  }

  sliderWrap.classList.remove('is-disabled');
  const state = computeTrimSliderState(offsetMs, durationMs, totalDurSec);
  if (startSlider) {
    startSlider.disabled = false;
    startSlider.max = String(state.maxSec);
    // Always sync slider thumb value so programmatic resets/captures never leave
    // the thumb detached from the fill track in WebKit (where clicking buttons preserves input focus).
    startSlider.value = String(state.startSec);
    if (startSlider.style) {
      startSlider.style.zIndex = state.startSec >= state.maxSec * 0.85 ? '4' : '2';
    }
  }
  if (endSlider) {
    endSlider.disabled = false;
    endSlider.max = String(state.maxSec);
    endSlider.value = String(state.endSec);
    if (endSlider.style) {
      endSlider.style.zIndex = '3';
    }
  }
  setTrimFillProps(fillEl, state.startPct, state.widthPct);
}

interface RangeSummaryReadout {
  text: string;
  isLtr: boolean;
}

function formatRangeSummaryReadout(
  offsetMs: number,
  durationMs: number,
  totalDurSec: number
): RangeSummaryReadout {
  const startLabel = formatMsToTimecode(offsetMs, true);
  const hasNumericEnd = durationMs > 0 || totalDurSec > 0;
  if (hasNumericEnd) {
    const endLabel =
      durationMs > 0 ? formatMsToTimecode(offsetMs + durationMs, true) : formatMsToTimecode(totalDurSec * 1000);
    const spanMs = durationMs > 0 ? durationMs : Math.max(0, totalDurSec * 1000 - offsetMs);
    const spanStr = spanMs > 0 ? ` (${formatMsToTimecode(spanMs, durationMs > 0)})` : '';
    return { text: `${startLabel} \u2192 ${endLabel}${spanStr}`, isLtr: true };
  }

  const endWord = t('transcribe.rangeToEnd') || 'End';
  if (isRtlLanguage(getLanguage())) {
    return { text: `${isolateLtr(startLabel)} \u2190 ${endWord}`, isLtr: false };
  }
  return { text: `${startLabel} \u2192 ${endWord}`, isLtr: true };
}

function renderBatchRangeSummary(
  offsetMs: number,
  durationMs: number,
  shortItemCount: number,
  totalCount: number
): void {
  const summary = formatRangeSummaryReadout(offsetMs, durationMs, 0);
  const rangeStr = summary.isLtr ? isolateLtr(summary.text) : summary.text;
  if (shortItemCount > 0) {
    const warnMsg =
      t('transcribe.rangeBatchWarningShort', {
        range: rangeStr,
        count: formatLocalizedNumber(shortItemCount, getLanguage(), 0)
      }) || `${rangeStr} • ${shortItemCount} file(s) shorter than start`;
    setRangeHint(warnMsg, 'warning', false);
    return;
  }

  const batchMsg =
    t('transcribe.rangeBatchApplies', {
      count: formatLocalizedNumber(totalCount, getLanguage(), 0),
      range: rangeStr
    }) || `All ${totalCount} queued files: ${rangeStr}`;
  setRangeHint(batchMsg, 'neutral', false);
}

function ensureCustomRangeActive(): void {
  if (quickRangeMode === 'custom') return;
  quickRangeMode = 'custom';
  const rangeCheckbox = document.getElementById('quick-range-enabled') as HTMLInputElement | null;
  if (rangeCheckbox) rangeCheckbox.checked = true;
  const inputsRow = document.getElementById('quick-range-inputs');
  if (inputsRow) inputsRow.classList.remove('is-inactive');
}

function renderCustomRangeStatus(offsetT: number, duration: number, totalDurSec: number, isBatch: boolean): void {
  if (isBatch) {
    const items = getBatchQueueItems();
    const res = evaluateBatchTimeRange(
      formatMsToTimecode(offsetT, true),
      duration > 0 ? formatMsToTimecode(offsetT + duration, true) : '',
      items.map(it => it?.durationSec)
    );
    if (!res.valid && res.reason === 'exceedsAllBatchDurations') {
      hasRangeValidationError = true;
      const maxStr = formatMsToTimecode(res.maxKnownDurationSec * 1000);
      setRangeHint(
        t('transcribe.rangeErrorBatchAllShort', { max: isolateLtr(maxStr) }) ||
          `Start time exceeds all queued files (max ${maxStr}).`,
        'error',
        false
      );
      return;
    }
    renderBatchRangeSummary(offsetT, duration, res.shortItemCount, items.length);
    return;
  }

  if (totalDurSec > 0) {
    const res = evaluateCustomTimeRange(
      formatMsToTimecode(offsetT, true),
      duration > 0 ? formatMsToTimecode(offsetT + duration, true) : '',
      totalDurSec
    );
    if (!res.valid) {
      hasRangeValidationError = true;
      setRangeHint(formatRangeValidationErrorMessage(res.reason, totalDurSec), 'error', false);
      return;
    }
  }

  const summary = formatRangeSummaryReadout(offsetT, duration, totalDurSec);
  setRangeHint(summary.text, 'neutral', summary.isLtr);
}

export function syncQuickTimeRangeUI(current = getSettingsState()): void {
  if (typeof document === 'undefined' || !current) return;
  const offsetT = Math.max(0, Number(current.offsetT || 0));
  const duration = Math.max(0, Number(current.duration || 0));
  if (offsetT > 0 || duration > 0) {
    quickRangeMode = 'custom';
  }

  const isCustom = quickRangeMode === 'custom';
  const isBatch = isBatchRangeMode();
  const rangeCheckbox = document.getElementById('quick-range-enabled') as HTMLInputElement | null;
  if (rangeCheckbox) rangeCheckbox.checked = isCustom;

  const inputsRow = document.getElementById('quick-range-inputs');
  if (inputsRow) {
    inputsRow.style.display = 'flex';
    inputsRow.classList.toggle('is-inactive', !isCustom);
  }
  applyRangeBatchVisibilityDOM(isBatch);

  const startEl = document.getElementById('quick-range-start') as HTMLInputElement | null;
  const endEl = document.getElementById('quick-range-end') as HTMLInputElement | null;
  const totalDurSec = isBatch ? 0 : getProbedDurationSec();

  if (endEl) {
    endEl.placeholder = totalDurSec > 0 ? formatMsToTimecode(totalDurSec * 1000) : '--:--';
  }

  // Preserve unvalidated/invalid draft values and error cue when another control triggers UI re-sync
  if (isCustom && hasRangeValidationError) {
    updateTrimSliderVisuals(offsetT, duration, totalDurSec);
    if (document.activeElement !== startEl && document.activeElement !== endEl) {
      validateAndApplyQuickTimeRange(true);
    }
    return;
  }

  if (startEl && document.activeElement !== startEl) {
    startEl.value = formatMsToTimecode(offsetT, true);
  }
  if (endEl && document.activeElement !== endEl) {
    endEl.value = duration > 0 ? formatMsToTimecode(offsetT + duration, true) : '';
  }

  updateTrimSliderVisuals(offsetT, duration, totalDurSec);

  if (!isCustom) {
    setRangeHint(t('transcribe.rangeFullMedia') || 'Full File', 'neutral', false, 'transcribe.rangeFullMedia');
    return;
  }

  renderCustomRangeStatus(offsetT, duration, totalDurSec, isBatch);
}

export function setQuickRangeMode(mode: 'full' | 'custom'): void {
  const current = getSettingsState();
  quickRangeMode = mode;
  hasRangeValidationError = false;
  if (mode === 'full' && current) {
    current.offsetT = 0;
    current.duration = 0;
    syncSettingsInputElement('opt-offsetT', '0');
    syncSettingsInputElement('opt-duration', '0');
    saveCurrentSettings();
  }
  if (current) {
    syncQuickTimeRangeUI(current);
  }
}

export function resetTranscribeTimeRange(save = false): void {
  const current = getSettingsState();
  quickRangeMode = 'full';
  hasRangeValidationError = false;
  if (current) {
    current.offsetT = 0;
    current.duration = 0;
    syncSettingsInputElement('opt-offsetT', '0');
    syncSettingsInputElement('opt-duration', '0');
    syncQuickTimeRangeUI(current);
    if (save) {
      saveCurrentSettings();
    }
  } else if (typeof document !== 'undefined') {
    const rangeCheckbox = document.getElementById('quick-range-enabled') as HTMLInputElement | null;
    if (rangeCheckbox) rangeCheckbox.checked = false;
    const inputsRow = document.getElementById('quick-range-inputs');
    if (inputsRow) {
      inputsRow.style.display = 'flex';
      inputsRow.classList.add('is-inactive');
    }
    setRangeHint(t('transcribe.rangeFullMedia') || 'Full File', 'neutral', false, 'transcribe.rangeFullMedia');
  }
}

function commitValidatedTimeRange(
  current: SettingsState,
  startEl: HTMLInputElement,
  endEl: HTMLInputElement,
  res: { offsetT: number; duration: number; startMs: number; endMs: number | null },
  commit: boolean
): true {
  hasRangeValidationError = false;
  current.offsetT = res.offsetT;
  current.duration = res.duration;
  syncSettingsInputElement('opt-offsetT', String(res.offsetT));
  syncSettingsInputElement('opt-duration', String(res.duration));
  startEl.value = formatMsToTimecode(res.startMs, true);
  endEl.value = res.endMs !== null ? formatMsToTimecode(res.endMs, true) : '';
  syncQuickTimeRangeUI(current);
  if (commit) {
    saveCurrentSettings();
  }
  return true;
}

function formatRangeValidationErrorMessage(
  reason: 'invalidFormat' | 'endBeforeStart' | 'exceedsDuration' | 'exceedsAllBatchDurations' | undefined,
  maxDurationSec: number
): string {
  if (reason === 'endBeforeStart') {
    return t('transcribe.rangeErrorOrder') || 'End time must be after Start time.';
  }
  if (reason === 'exceedsAllBatchDurations') {
    const maxStr = formatMsToTimecode(maxDurationSec * 1000);
    return (
      t('transcribe.rangeErrorBatchAllShort', { max: isolateLtr(maxStr) }) ||
      `Start time exceeds all queued files (max ${maxStr}).`
    );
  }
  if (reason === 'exceedsDuration') {
    const maxStr = formatMsToTimecode(maxDurationSec * 1000);
    return (
      t('transcribe.rangeErrorDuration', { max: isolateLtr(maxStr) }) ||
      `Range exceeds media duration (${maxStr}).`
    );
  }
  return t('transcribe.rangeErrorFormat') || 'Enter valid timestamps like 01:30 or 00:01:30.';
}

export function validateAndApplyQuickTimeRange(commit = true): boolean {
  if (typeof document === 'undefined') return true;
  const current = getSettingsState();
  if (!current || quickRangeMode !== 'custom') return true;
  const startEl = document.getElementById('quick-range-start') as HTMLInputElement | null;
  const endEl = document.getElementById('quick-range-end') as HTMLInputElement | null;
  if (!startEl || !endEl) return true;

  if (isBatchRangeMode()) {
    const items = getBatchQueueItems();
    const res = evaluateBatchTimeRange(
      startEl.value,
      endEl.value,
      items.map(it => it?.durationSec)
    );
    if (!res.valid) {
      if (commit) {
        hasRangeValidationError = true;
        setRangeHint(formatRangeValidationErrorMessage(res.reason, res.maxKnownDurationSec), 'error', false);
      }
      return false;
    }
    return commitValidatedTimeRange(current, startEl, endEl, res, commit);
  }

  const totalDurSec = getProbedDurationSec();
  const res = evaluateCustomTimeRange(startEl.value, endEl.value, totalDurSec);
  if (!res.valid) {
    if (commit) {
      hasRangeValidationError = true;
      setRangeHint(formatRangeValidationErrorMessage(res.reason, totalDurSec), 'error', false);
    }
    return false;
  }

  return commitValidatedTimeRange(current, startEl, endEl, res, commit);
}

export function capturePlayerTimeForRange(target: 'start' | 'end'): void {
  const host = getTranscribeDeckHost();
  if (!host.hasActiveMedia()) {
    showNotification(t('toasts.noFileSelected') || 'Please select an audio or video file first.', 'info');
    return;
  }
  const currentTimeSec = host.getCompanionCurrentTimeSec();
  let ms = Math.max(0, Math.round(currentTimeSec * 1000));
  const totalDurSec = getProbedDurationSec();
  if (totalDurSec > 0) {
    const totalMs = Math.max(1, Math.round(totalDurSec * 1000));
    if (target === 'start' && ms >= totalMs) {
      ms = Math.max(0, totalMs - 1000);
    } else if (target === 'end' && ms > totalMs) {
      ms = totalMs;
    }
  }

  ensureCustomRangeActive();

  const startEl = document.getElementById('quick-range-start') as HTMLInputElement | null;
  const endEl = document.getElementById('quick-range-end') as HTMLInputElement | null;

  // Preserve sub-seconds when flooring to whole seconds would collide with Start
  let preserveSubseconds = false;
  if (target === 'end' && ms > 0) {
    const existingStartMs = startEl?.value.trim() ? parseTimecodeToMs(startEl.value) : 0;
    const flooredSecMs = Math.floor(ms / 1000) * 1000;
    if (existingStartMs !== null && ms > existingStartMs && flooredSecMs <= existingStartMs) {
      preserveSubseconds = true;
    }
  }
  const formatted = formatMsToTimecode(ms, preserveSubseconds);

  if (target === 'start') {
    if (startEl) startEl.value = formatted;
    if (endEl && endEl.value.trim()) {
      const existingEndMs = parseTimecodeToMs(endEl.value);
      if (existingEndMs !== null && existingEndMs <= ms) {
        endEl.value = '';
      }
    }
  } else if (endEl) {
    endEl.value = formatted;
  }
  validateAndApplyQuickTimeRange(true);
}

function handleTrimSliderInput(changedThumb: 'start' | 'end'): void {
  const startSlider = document.getElementById('quick-range-slider-start') as HTMLInputElement | null;
  const endSlider = document.getElementById('quick-range-slider-end') as HTMLInputElement | null;
  const startEl = document.getElementById('quick-range-start') as HTMLInputElement | null;
  const endEl = document.getElementById('quick-range-end') as HTMLInputElement | null;
  if (!startSlider || !endSlider || !startEl || !endEl) return;

  ensureCustomRangeActive();
  hasRangeValidationError = false;

  const totalDurSec = getProbedDurationSec();
  const maxSec = Math.max(1, Math.round(totalDurSec));
  const minGap = maxSec >= 2 ? 1 : 0;

  const rawStart = parseInt(startSlider.value, 10);
  const rawEnd = parseInt(endSlider.value, 10);
  let s = Math.max(0, Math.min(maxSec, Number.isNaN(rawStart) ? 0 : rawStart));
  let e = Math.max(0, Math.min(maxSec, Number.isNaN(rawEnd) ? maxSec : rawEnd));

  if (changedThumb === 'start' && s > e - minGap) {
    s = Math.max(0, e - minGap);
    startSlider.value = String(s);
  } else if (changedThumb === 'end' && e < s + minGap) {
    e = Math.min(maxSec, s + minGap);
    endSlider.value = String(e);
  }

  const offsetMs = s * 1000;
  const durationMs = e >= maxSec ? 0 : Math.max(0, (e - s) * 1000);
  startEl.value = formatMsToTimecode(offsetMs);
  endEl.value = e >= maxSec ? '' : formatMsToTimecode(offsetMs + durationMs);
  updateTrimSliderVisuals(offsetMs, durationMs, totalDurSec);
  const summary = formatRangeSummaryReadout(offsetMs, durationMs, totalDurSec);
  setRangeHint(summary.text, 'neutral', summary.isLtr);
}

function handleRangeTextInputLive(startEl: HTMLInputElement | null, endEl: HTMLInputElement | null): void {
  ensureCustomRangeActive();
  if (startEl && endEl) {
    if (isBatchRangeMode()) {
      const items = getBatchQueueItems();
      const res = evaluateBatchTimeRange(
        startEl.value,
        endEl.value,
        items.map(it => it?.durationSec)
      );
      if (res.valid) {
        hasRangeValidationError = false;
        const current = getSettingsState();
        if (current) {
          current.offsetT = res.offsetT;
          current.duration = res.duration;
          syncSettingsInputElement('opt-offsetT', String(res.offsetT));
          syncSettingsInputElement('opt-duration', String(res.duration));
        }
        renderBatchRangeSummary(res.offsetT, res.duration, res.shortItemCount, items.length);
        return;
      }
    } else {
      const totalDurSec = getProbedDurationSec();
      const res = evaluateCustomTimeRange(startEl.value, endEl.value, totalDurSec);
      if (res.valid) {
        hasRangeValidationError = false;
        const current = getSettingsState();
        if (current) {
          current.offsetT = res.offsetT;
          current.duration = res.duration;
          syncSettingsInputElement('opt-offsetT', String(res.offsetT));
          syncSettingsInputElement('opt-duration', String(res.duration));
        }
        updateTrimSliderVisuals(res.offsetT, res.duration, totalDurSec);
        const summary = formatRangeSummaryReadout(res.offsetT, res.duration, totalDurSec);
        setRangeHint(summary.text, 'neutral', summary.isLtr);
        return;
      }
    }
  }

  const startWrap = startEl?.closest?.('.transcribe-range-input-wrap');
  const endWrap = endEl?.closest?.('.transcribe-range-input-wrap');
  startWrap?.classList.remove('is-invalid');
  endWrap?.classList.remove('is-invalid');
  const hintEl = document.getElementById('quick-range-hint');
  const wasErrorOrWarning = Boolean(
    hintEl && (hintEl.classList.contains('is-error') || hintEl.classList.contains('is-warning'))
  );
  hintEl?.classList.remove('is-error');
  hintEl?.classList.remove('is-warning');
  if (wasErrorOrWarning) {
    const current = getSettingsState();
    const committedOffset = Math.max(0, Number(current?.offsetT || 0));
    const committedDuration = Math.max(0, Number(current?.duration || 0));
    const summary = formatRangeSummaryReadout(
      committedOffset,
      committedDuration,
      isBatchRangeMode() ? 0 : getProbedDurationSec()
    );
    setRangeHint(summary.text, 'neutral', summary.isLtr);
  }
}

export function bindQuickTimeRangeListeners(): void {
  ['quick-range-start', 'quick-range-end'].forEach(id => {
    const inputEl = document.getElementById(id) as HTMLInputElement | null;
    if (!inputEl || (inputEl as any)._quickBound) return;
    (inputEl as any)._quickBound = true;

    inputEl.addEventListener('input', () => {
      const startEl = document.getElementById('quick-range-start') as HTMLInputElement | null;
      const endEl = document.getElementById('quick-range-end') as HTMLInputElement | null;
      handleRangeTextInputLive(startEl, endEl);
    });

    inputEl.addEventListener('blur', () => {
      validateAndApplyQuickTimeRange(true);
    });

    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        validateAndApplyQuickTimeRange(true);
        inputEl.blur();
      }
    });
  });

  (['start', 'end'] as const).forEach(thumb => {
    const sliderEl = document.getElementById(`quick-range-slider-${thumb}`) as HTMLInputElement | null;
    if (!sliderEl || (sliderEl as any)._quickBound) return;
    (sliderEl as any)._quickBound = true;
    sliderEl.addEventListener('input', () => {
      handleTrimSliderInput(thumb);
    });
    sliderEl.addEventListener('change', () => {
      validateAndApplyQuickTimeRange(true);
    });
  });
}
