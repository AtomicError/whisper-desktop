// Transcribe Studio Quick Configuration Deck Controller:
// Output format pills, subtitle line-length presets/stepper, prompt, VAD,
// engine/model/language selects, scroll elevation cue, and hardware thread auto-detection.
import { t, getLanguage } from '../i18n/index';
import { showNotification } from './appModal';
import { getBasename } from './nativeWindow';
import { renderLanguageSelect } from '../languageSelect';
import { formatLocalizedNumber } from '../i18n/formatters';
import {
  type OutputFormatKey,
  canToggleOutputFormatOff,
  getRecommendedThreadCount,
  normalizeDigitsToAscii,
  filterNumericInputPreservingLocalizedDigits
} from './transcribeConfigHelpers';
import { getTranscribeDeckHost } from './transcribeDeckHost';

const getSettingsState = () => getTranscribeDeckHost().getSettingsState();
const getCompiledBackends = () => getTranscribeDeckHost().getCompiledBackends();
const getLocalScannedVadModels = () => getTranscribeDeckHost().getLocalScannedVadModels();
const saveCurrentSettings = (immediate?: boolean) => getTranscribeDeckHost().saveCurrentSettings(immediate);
const selectBackend = (backend: string, showToast?: boolean) => getTranscribeDeckHost().selectBackend(backend, showToast);
const switchSettingsCategory = (catId: string) => getTranscribeDeckHost().switchSettingsCategory(catId);
const updateTranscribeOutputDirUI = () => getTranscribeDeckHost().updateTranscribeOutputDirUI();
const safeApplyDynamicDirection = (el: HTMLElement | null) => getTranscribeDeckHost().safeApplyDynamicDirection(el);
const updateStepperButtonStates = (inputOrId: string | HTMLInputElement) =>
  getTranscribeDeckHost().updateStepperButtonStates(inputOrId);
import {
  resetQuickTimeRangeState,
  resetQuickRangeModeIfZero,
  clearQuickRangeValidationError,
  updateTranscribeRangeVisibility,
  syncQuickTimeRangeUI,
  setQuickRangeMode,
  resetTranscribeTimeRange,
  validateAndApplyQuickTimeRange,
  capturePlayerTimeForRange,
  bindQuickTimeRangeListeners
} from './transcribeTimeRange';

export {
  resetQuickRangeModeIfZero,
  clearQuickRangeValidationError,
  updateTranscribeRangeVisibility,
  syncQuickTimeRangeUI,
  setQuickRangeMode,
  resetTranscribeTimeRange,
  validateAndApplyQuickTimeRange,
  capturePlayerTimeForRange
};

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): ((cmd: string, args?: any) => Promise<any>) | null => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

const FORMAT_PILL_MAP: Array<{ key: OutputFormatKey; pillId: string; optId: string }> = [
  { key: 'outputSrt', pillId: 'quick-fmt-srt', optId: 'opt-outputSrt' },
  { key: 'outputVtt', pillId: 'quick-fmt-vtt', optId: 'opt-outputVtt' },
  { key: 'outputTxt', pillId: 'quick-fmt-txt', optId: 'opt-outputTxt' },
  { key: 'outputLrc', pillId: 'quick-fmt-lrc', optId: 'opt-outputLrc' }
];

const PRESET_MAX_LENS = new Set([0, 28, 42]);
let quickMaxLenCustomOpen = false;
let lastCustomMaxLen = 40;

export function resetQuickDeckState(): void {
  resetQuickTimeRangeState();
  quickMaxLenCustomOpen = false;
}

export function collapseCustomMaxLenIfPreset(val: number): void {
  if (PRESET_MAX_LENS.has(val)) {
    quickMaxLenCustomOpen = false;
  }
}

function setPillButtonState(btn: HTMLElement | null, active: boolean): void {
  if (!btn) return;
  btn.classList.toggle('active', active);
  if (typeof btn.setAttribute === 'function') {
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function syncSettingsInputElement(id: string, value: string | boolean): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  if (typeof value === 'boolean') {
    (el as HTMLInputElement).checked = value;
  } else {
    el.value = value;
  }
}

/**
 * Updates the subtle footer elevation cue when `.transcribe-deck-body` or the active `Files` queue list has scrolled overflow below.
 */
export function updateDeckScrollCue(): void {
  if (typeof document === 'undefined') return;
  const deck = document.getElementById('transcribe-unified-deck');
  if (!deck) return;

  const batchQueue = document.getElementById('batch-queue-container');
  const isFilesTabVisible = Boolean(
    batchQueue && batchQueue.style && batchQueue.style.display && batchQueue.style.display !== 'none'
  );
  const body = isFilesTabVisible
    ? ((typeof batchQueue?.querySelector === 'function'
        ? batchQueue.querySelector('.batch-table-wrapper')
        : null) as HTMLElement | null) || batchQueue
    : (typeof deck.querySelector === 'function'
        ? (deck.querySelector('.transcribe-deck-body') as HTMLElement | null)
        : null);

  if (!body) return;
  if (typeof body.scrollHeight !== 'number' || typeof body.clientHeight !== 'number') return;

  const hasOverflowBelow = body.scrollHeight - body.clientHeight - (body.scrollTop || 0) > 6;
  deck.classList.toggle('has-scroll-below', hasOverflowBelow);
}

// ----------------- Output Formats -----------------
export function syncQuickOutputFormatsUI(current = getSettingsState()): void {
  if (typeof document === 'undefined' || !current) return;
  for (const item of FORMAT_PILL_MAP) {
    setPillButtonState(document.getElementById(item.pillId), Boolean(current[item.key]));
  }
}

export function toggleQuickOutputFormat(key: OutputFormatKey): void {
  const current = getSettingsState();
  if (!current) return;
  const nextVal = !Boolean(current[key]);
  if (!nextVal && !canToggleOutputFormatOff(current, key)) {
    showNotification(
      t('toasts.atLeastOneOutputFormat') || 'At least one output format must stay enabled.',
      'warning'
    );
    syncQuickOutputFormatsUI(current);
    return;
  }

  current[key] = nextVal;
  const optEntry = FORMAT_PILL_MAP.find(item => item.key === key);
  if (optEntry) {
    syncSettingsInputElement(optEntry.optId, nextVal);
  }
  syncQuickOutputFormatsUI(current);
  saveCurrentSettings();
}

// ----------------- Line Length Presets, Custom Stepper & Prompt -----------------
export function setQuickMaxLen(val: number, keepCustomOpen = false): void {
  const current = getSettingsState();
  if (!current) return;
  const clamped = Math.max(0, Math.min(500, Math.round(Number(val) || 0)));
  if (!keepCustomOpen && PRESET_MAX_LENS.has(clamped)) {
    quickMaxLenCustomOpen = false;
  } else if (clamped > 0) {
    lastCustomMaxLen = clamped;
    quickMaxLenCustomOpen = true;
  }
  current.maxLen = clamped;
  syncSettingsInputElement('opt-maxLen', String(clamped));
  if (clamped > 0) {
    syncSettingsInputElement('quick-adv-maxLen', String(clamped));
  }
  updateStepperButtonStates('opt-maxLen');
  syncQuickAdvancedUI(current);
  saveCurrentSettings();
}

export function activateCustomMaxLen(): void {
  const current = getSettingsState();
  if (!current) return;
  quickMaxLenCustomOpen = true;
  const existing = Math.max(0, Math.round(Number(current.maxLen || 0)));
  const targetVal = existing > 0 ? existing : Math.max(1, Math.min(500, lastCustomMaxLen));
  lastCustomMaxLen = Math.min(500, targetVal);
  if (current.maxLen !== targetVal) {
    setQuickMaxLen(targetVal, true);
  } else {
    syncQuickAdvancedUI(current);
  }
  if (typeof document !== 'undefined') {
    const inputEl = document.getElementById('quick-adv-maxLen') as HTMLInputElement | null;
    if (inputEl && typeof inputEl.focus === 'function') {
      inputEl.focus();
    }
  }
}

export function stepQuickMaxLen(delta: number): void {
  const current = getSettingsState();
  if (!current) return;
  const rawBase = Math.max(1, Math.round(Number(current.maxLen || lastCustomMaxLen || 40)));
  const base = Math.min(500, rawBase);
  const next = Math.max(1, Math.min(500, base + delta));
  setQuickMaxLen(next, true);
}

export function syncQuickAdvancedUI(current = getSettingsState()): void {
  if (typeof document === 'undefined' || !current) return;
  const promptEl = document.getElementById('quick-adv-prompt') as HTMLTextAreaElement | null;
  if (promptEl && document.activeElement !== promptEl) {
    promptEl.value = current.prompt || '';
    safeApplyDynamicDirection(promptEl);
  }
  syncSettingsInputElement('quick-adv-carryPrompt', Boolean(current.carryPrompt));

  const maxLen = Math.max(0, Math.round(Number(current.maxLen || 0)));
  if (maxLen > 0 && !PRESET_MAX_LENS.has(maxLen)) {
    lastCustomMaxLen = Math.min(500, maxLen);
  }
  const isCustom = quickMaxLenCustomOpen || (maxLen > 0 && !PRESET_MAX_LENS.has(maxLen));

  setPillButtonState(document.getElementById('quick-maxlen-auto'), !isCustom && maxLen === 0);
  setPillButtonState(document.getElementById('quick-maxlen-28'), !isCustom && maxLen === 28);
  setPillButtonState(document.getElementById('quick-maxlen-42'), !isCustom && maxLen === 42);
  setPillButtonState(document.getElementById('quick-maxlen-custom'), isCustom);

  const customRow = document.getElementById('quick-maxlen-custom-row');
  if (customRow) {
    customRow.style.display = isCustom ? 'flex' : 'none';
  }

  const maxLenEl = document.getElementById('quick-adv-maxLen') as HTMLInputElement | null;
  const displayVal = maxLen > 0 ? maxLen : lastCustomMaxLen;
  if (maxLenEl && document.activeElement !== maxLenEl) {
    maxLenEl.value = String(displayVal);
  }
  const decBtn = document.getElementById('btn-quick-maxlen-dec') as HTMLButtonElement | null;
  const incBtn = document.getElementById('btn-quick-maxlen-inc') as HTMLButtonElement | null;
  if (decBtn) decBtn.disabled = displayVal <= 1;
  if (incBtn) incBtn.disabled = displayVal >= 500;

  syncSettingsInputElement('quick-adv-splitWord', Boolean(current.splitWord));
  updateDeckScrollCue();
}

// ----------------- Hardware Threads Auto-Detection & VAD -----------------
export async function applyRecommendedThreads(): Promise<void> {
  const current = getSettingsState();
  if (!current) return;
  const win = getGlobal();
  let specs = win.systemSpecs;
  if (!specs || typeof specs.cpu_cores !== 'number') {
    const inv = getTauriInvoke();
    if (inv) {
      try {
        specs = await inv('get_system_specs');
        win.systemSpecs = specs;
      } catch (_) {
        specs = { cpu_cores: 4, total_ram_gb: 8, gpu_type: 'unknown' };
      }
    } else {
      specs = { cpu_cores: 4, total_ram_gb: 8, gpu_type: 'unknown' };
    }
  }
  const cores = Number(specs?.cpu_cores || 4);
  const recommended = getRecommendedThreadCount(cores);
  current.threads = recommended;
  syncSettingsInputElement('opt-threads', String(recommended));
  updateStepperButtonStates('opt-threads');
  await saveCurrentSettings(true);

  const lang = getLanguage();
  showNotification(
    t('toasts.threadsAutoDetected', {
      threads: formatLocalizedNumber(recommended, lang, 0),
      cores: formatLocalizedNumber(cores, lang, 0)
    }) || `Threads set to ${recommended} based on ${cores} CPU threads.`,
    'success'
  );
}

export function openTranscriptionSettings(): void {
  const win = getGlobal();
  if (typeof win.switchView === 'function') {
    win.switchView('settings');
    switchSettingsCategory('transcription');
  }
}

export function toggleQuickVad(forceVal?: boolean): void {
  const current = getSettingsState();
  if (!current) return;

  const scannedVad = getLocalScannedVadModels();
  const hasVadModel = Boolean(scannedVad && scannedVad.length > 0 && current.vadModel);
  const willEnable = typeof forceVal === 'boolean' ? forceVal : !current.vad;
  if (willEnable && !hasVadModel) {
    showNotification(t('toasts.noVadFound'), 'warning');
    const quickVadInput = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
    if (quickVadInput) quickVadInput.checked = false;
    return;
  }

  current.vad = willEnable;
  syncSettingsInputElement('opt-vad', current.vad);
  syncQuickVadToggleUI(current.vad, hasVadModel, current.vadModel);
  saveCurrentSettings();
}

function syncQuickVadToggleUI(vadActive: boolean, hasVadModel: boolean, vadModel?: string): void {
  const quickVadBtn = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
  if (!quickVadBtn) return;
  const vadModelName = vadModel ? getBasename(vadModel) : 'Default';
  if ('checked' in quickVadBtn && quickVadBtn.checked !== vadActive) {
    quickVadBtn.checked = vadActive;
  }
  if (vadActive) {
    quickVadBtn.classList.add('active');
    quickVadBtn.title = `${t('transcribe.vadActive')} (${vadModelName}) - ${t('transcribe.vadDisableHint') || 'Click to disable'}`;
  } else {
    quickVadBtn.classList.remove('active');
    if (hasVadModel) {
      quickVadBtn.title = `${t('transcribe.vadDisabled')} (${vadModelName}) - ${t('transcribe.vadEnableHint') || 'Click to enable'}`;
    } else {
      quickVadBtn.title = t('toasts.noVadFound') || 'No Silero VAD model found on system';
    }
  }
}

function syncQuickBackendSelect(backend: string, backendsMap: Record<string, boolean>): void {
  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend') as HTMLSelectElement | null;
  if (!quickBackendSelect) return;

  const backendDefs = [
    { key: 'Standard', label: t('transcribe.backendCpu') },
    { key: 'Vulkan', label: t('transcribe.backendVulkan') },
    { key: 'CUDA', label: t('transcribe.backendCuda') },
    { key: 'OpenVINO', label: t('transcribe.backendOpenvino') }
  ];

  const availableBackends = backendDefs.filter(b => b.key === 'Standard' || Boolean(backendsMap[b.key]));
  const currentKeys = Array.from(quickBackendSelect.options || []).map(o => o.value).join(',');
  const targetKeys = availableBackends.map(b => b.key).join(',');

  if (currentKeys !== targetKeys) {
    quickBackendSelect.innerHTML = '';
    availableBackends.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.key;
      opt.textContent = b.label;
      if (b.key === backend) opt.selected = true;
      quickBackendSelect.appendChild(opt);
    });
  } else {
    Array.from(quickBackendSelect.options || []).forEach(opt => {
      const match = availableBackends.find(b => b.key === opt.value);
      if (match && opt.textContent !== match.label) {
        opt.textContent = match.label;
      }
    });
  }
  quickBackendSelect.value = backend;
}

export function updateTranscribeUIConfigs(): void {
  if (typeof document === 'undefined') return;
  const current = getSettingsState();
  if (!current) return;

  const backend = current.selectedBackend || 'Standard';
  const backendsMap = getCompiledBackends();
  const scannedVad = getLocalScannedVadModels();

  const win = getGlobal();
  const probed = win.probedMetadata;
  if (probed && probed.exists && typeof win.renderMediaMetadata === 'function') {
    win.renderMediaMetadata(probed);
  }

  syncQuickBackendSelect(backend, backendsMap);

  const quickModelSelect = document.getElementById('quick-opt-model') as HTMLSelectElement | null;
  if (quickModelSelect && current.modelPath) {
    quickModelSelect.value = current.modelPath;
  }

  const quickLangSelect = document.getElementById('quick-opt-language') as HTMLSelectElement | null;
  let quickLangValueChanged = false;
  if (quickLangSelect) {
    const targetLang = (current.language || 'auto').trim();
    if (!quickLangSelect.options || quickLangSelect.options.length === 0) {
      renderLanguageSelect(quickLangSelect, 'spoken', targetLang);
    } else if (quickLangSelect.value !== targetLang) {
      quickLangSelect.value = targetLang;
      quickLangValueChanged = true;
    }
  }

  const hasVadModel = Boolean(scannedVad && scannedVad.length > 0 && current.vadModel);
  syncQuickVadToggleUI(Boolean(current.vad && hasVadModel), hasVadModel, current.vadModel);

  syncQuickOutputFormatsUI(current);
  syncQuickTimeRangeUI(current);
  syncQuickAdvancedUI(current);
  updateTranscribeOutputDirUI();

  if (typeof win.updateTranscribeWorkflowButtons === 'function') {
    win.updateTranscribeWorkflowButtons();
  }
  if (quickLangValueChanged && win.customSelectsMap?.get) {
    const quickLangCs = win.customSelectsMap.get('quick-opt-language');
    if (quickLangCs && typeof quickLangCs.syncSelectedValue === 'function') {
      quickLangCs.syncSelectedValue(true);
    }
  }
  if (typeof win.syncCustomSelects === 'function') {
    win.syncCustomSelects(false, true);
  }
}

// ----------------- DOM Event Binding -----------------
function bindQuickCheckboxSetting(elId: string, settingKey: 'carryPrompt' | 'splitWord'): void {
  const el = document.getElementById(elId) as HTMLInputElement | null;
  if (!el || (el as any)._quickBound) return;
  (el as any)._quickBound = true;
  el.addEventListener('change', () => {
    const current = getSettingsState();
    if (!current) return;
    current[settingKey] = el.checked;
    syncSettingsInputElement(`opt-${settingKey}`, el.checked);
    syncQuickAdvancedUI(current);
    saveCurrentSettings();
  });
}

function bindQuickCustomMaxLenControl(): void {
  const quickMaxLen = document.getElementById('quick-adv-maxLen') as HTMLInputElement | null;
  if (!quickMaxLen || (quickMaxLen as any)._quickBound) return;
  (quickMaxLen as any)._quickBound = true;

  let hasPendingInput = false;

  const commitQuickMaxLen = () => {
    const rawVal = quickMaxLen.value;
    const parsed = parseInt(normalizeDigitsToAscii(rawVal).trim(), 10);
    const current = getSettingsState();
    const currentMaxLen = Math.max(0, Math.round(Number(current?.maxLen || 0)));
    if (Number.isNaN(parsed) || parsed <= 0) {
      hasPendingInput = false;
      if (currentMaxLen > 500) {
        syncQuickAdvancedUI(current);
      } else {
        setQuickMaxLen(lastCustomMaxLen, true);
      }
      return;
    }
    // Preserve untouched Settings-configured values > 500 rather than silently clobbering on blur
    if (parsed > 500 && parsed === currentMaxLen) {
      hasPendingInput = false;
      syncQuickAdvancedUI(current);
      return;
    }
    const targetVal = Math.max(1, Math.min(500, parsed));
    if (!hasPendingInput && targetVal === currentMaxLen && rawVal === String(targetVal)) {
      return;
    }
    hasPendingInput = false;
    setQuickMaxLen(targetVal, true);
  };

  quickMaxLen.addEventListener('focus', () => {
    setTimeout(() => {
      if (typeof quickMaxLen.select === 'function') quickMaxLen.select();
    }, 10);
  });

  quickMaxLen.addEventListener('input', () => {
    hasPendingInput = true;
    const filtered = filterNumericInputPreservingLocalizedDigits(quickMaxLen.value);
    if (quickMaxLen.value !== filtered) quickMaxLen.value = filtered;
    const parsed = parseInt(normalizeDigitsToAscii(filtered), 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      const clamped = Math.max(1, Math.min(500, parsed));
      const current = getSettingsState();
      if (current) {
        lastCustomMaxLen = clamped;
        current.maxLen = clamped;
        syncSettingsInputElement('opt-maxLen', String(clamped));
        updateStepperButtonStates('opt-maxLen');
        const decBtn = document.getElementById('btn-quick-maxlen-dec') as HTMLButtonElement | null;
        const incBtn = document.getElementById('btn-quick-maxlen-inc') as HTMLButtonElement | null;
        if (decBtn) decBtn.disabled = clamped <= 1;
        if (incBtn) incBtn.disabled = clamped >= 500;
        saveCurrentSettings(false);
      }
    }
  });

  quickMaxLen.addEventListener('change', commitQuickMaxLen);
  quickMaxLen.addEventListener('blur', commitQuickMaxLen);
  bindQuickMaxLenKeyAndWheel(quickMaxLen, commitQuickMaxLen, () => {
    hasPendingInput = false;
  });
}

function bindQuickMaxLenKeyAndWheel(
  quickMaxLen: HTMLInputElement,
  commitQuickMaxLen: () => void,
  onResetPending: () => void
): void {
  quickMaxLen.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepQuickMaxLen(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepQuickMaxLen(-1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      stepQuickMaxLen(5);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      stepQuickMaxLen(-5);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commitQuickMaxLen();
      quickMaxLen.blur();
    } else if (e.key === 'Escape') {
      onResetPending();
      const current = getSettingsState();
      const restored =
        current && Number(current.maxLen || 0) > 0
          ? Math.max(1, Math.round(Number(current.maxLen)))
          : lastCustomMaxLen;
      quickMaxLen.value = String(restored);
      quickMaxLen.blur();
    }
  });

  const ctrl = quickMaxLen.closest?.('.number-input-control') as (HTMLElement & { _wheelAccumulator?: number }) | null;
  if (ctrl && !(ctrl as any)._quickWheelBound) {
    (ctrl as any)._quickWheelBound = true;
    ctrl._wheelAccumulator = 0;
    ctrl.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (document.activeElement !== quickMaxLen) return;
        e.preventDefault();
        ctrl._wheelAccumulator = (ctrl._wheelAccumulator || 0) + e.deltaY;
        const NOTCH_THRESHOLD = 50;
        if (Math.abs(ctrl._wheelAccumulator) >= NOTCH_THRESHOLD) {
          const ticks = Math.trunc(ctrl._wheelAccumulator / NOTCH_THRESHOLD);
          ctrl._wheelAccumulator -= ticks * NOTCH_THRESHOLD;
          stepQuickMaxLen(ticks < 0 ? Math.abs(ticks) : -ticks);
        }
      },
      { passive: false }
    );
  }
}

function bindQuickSelectListeners(): void {
  const quickModelSelect = document.getElementById('quick-opt-model') as HTMLSelectElement | null;
  if (quickModelSelect && !(quickModelSelect as any)._quickBound) {
    (quickModelSelect as any)._quickBound = true;
    quickModelSelect.addEventListener('change', () => {
      const current = getSettingsState();
      if (current && quickModelSelect.value) {
        current.modelPath = quickModelSelect.value;
        const cfgModelSelect = document.getElementById('opt-modelPath') as HTMLSelectElement | null;
        if (cfgModelSelect) cfgModelSelect.value = quickModelSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  const quickLangSelect = document.getElementById('quick-opt-language') as HTMLSelectElement | null;
  if (quickLangSelect && !(quickLangSelect as any)._quickBound) {
    (quickLangSelect as any)._quickBound = true;
    quickLangSelect.addEventListener('change', () => {
      const current = getSettingsState();
      if (current) {
        current.language = quickLangSelect.value;
        const cfgLangInput = document.getElementById('opt-language') as HTMLInputElement | null;
        if (cfgLangInput) cfgLangInput.value = quickLangSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend') as HTMLSelectElement | null;
  if (quickBackendSelect && !(quickBackendSelect as any)._quickBound) {
    (quickBackendSelect as any)._quickBound = true;
    quickBackendSelect.addEventListener('change', async () => {
      const backend = quickBackendSelect.value;
      const backendsMap = getCompiledBackends();
      const isCompiled = backend === 'Standard' || Boolean(backendsMap[backend]);
      const current = getSettingsState();
      if (!isCompiled) {
        showNotification(
          t('toasts.backendNotFound', { backend: backend === 'Standard' ? 'CPU' : backend }),
          'error'
        );
        if (current) {
          quickBackendSelect.value = current.selectedBackend || 'Standard';
          const win = getGlobal();
          if (typeof win.syncCustomSelects === 'function') win.syncCustomSelects();
        }
        return;
      }
      if (current) {
        selectBackend(backend, false);
        const cfgBackendSelect = document.getElementById('opt-selectedBackend') as HTMLSelectElement | null;
        if (cfgBackendSelect) cfgBackendSelect.value = backend;
      }
    });
  }
}

function bindQuickPromptListener(): void {
  const quickPrompt = document.getElementById('quick-adv-prompt') as HTMLTextAreaElement | null;
  if (!quickPrompt || (quickPrompt as any)._quickBound) return;
  (quickPrompt as any)._quickBound = true;
  quickPrompt.addEventListener('input', () => {
    safeApplyDynamicDirection(quickPrompt);
    const current = getSettingsState();
    if (!current) return;
    current.prompt = quickPrompt.value;
    syncSettingsInputElement('opt-prompt', quickPrompt.value);
    const optPrompt = document.getElementById('opt-prompt') as HTMLTextAreaElement | null;
    if (optPrompt) safeApplyDynamicDirection(optPrompt);
    saveCurrentSettings(false);
  });
}

function bindDeckScrollCueObserver(): void {
  const deckBody = document.querySelector('#transcribe-unified-deck .transcribe-deck-body') as HTMLElement | null;
  if (!deckBody || (deckBody as any)._scrollCueBound) return;
  (deckBody as any)._scrollCueBound = true;
  deckBody.addEventListener('scroll', updateDeckScrollCue, { passive: true });
  const batchTableWrapper = document.querySelector('#batch-queue-container .batch-table-wrapper') as HTMLElement | null;
  if (batchTableWrapper && !(batchTableWrapper as any)._scrollCueBound) {
    (batchTableWrapper as any)._scrollCueBound = true;
    batchTableWrapper.addEventListener('scroll', updateDeckScrollCue, { passive: true });
  }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(updateDeckScrollCue);
    ro.observe(deckBody);
    if (batchTableWrapper) ro.observe(batchTableWrapper);
    ['transcribe-drop-zone', 'batch-queue-container', 'batch-queue-body', 'transcribe-output-custom-row', 'quick-range-inputs', 'quick-maxlen-custom-row', 'quick-adv-prompt'].forEach(childId => {
      const child = document.getElementById(childId);
      if (child) ro.observe(child);
    });
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', updateDeckScrollCue);
  }
  updateDeckScrollCue();
}

function bindQuickOutputLocationKeyboard(): void {
  const modeGroup = document.getElementById('quick-output-location-modes');
  if (!modeGroup || (modeGroup as any)._quickBound || typeof modeGroup.addEventListener !== 'function') return;
  (modeGroup as any)._quickBound = true;
  modeGroup.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
      return;
    }
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const isInputBtn = target.id === 'quick-output-mode-input';
    const isCustomBtn = target.id === 'quick-output-mode-custom';
    if (!isInputBtn && !isCustomBtn) return;

    e.preventDefault();
    const nextMode: 'input_dir' | 'custom' = isInputBtn ? 'custom' : 'input_dir';
    const nextBtn = document.getElementById(
      nextMode === 'custom' ? 'quick-output-mode-custom' : 'quick-output-mode-input'
    ) as HTMLButtonElement | null;
    if (nextBtn && typeof nextBtn.focus === 'function') {
      nextBtn.focus();
    }

    const result = getTranscribeDeckHost().setTranscribeOutputDirMode?.(nextMode);
    void Promise.resolve(result).then(() => {
      const activeMode = getSettingsState()?.outputDirMode === 'custom' ? 'custom' : 'input_dir';
      if (activeMode === nextMode) return;
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const focusStillInGroup = !activeEl || activeEl === nextBtn || activeEl === target;
      if (!focusStillInGroup) return;
      const activeBtn = document.getElementById(
        activeMode === 'custom' ? 'quick-output-mode-custom' : 'quick-output-mode-input'
      ) as HTMLButtonElement | null;
      if (activeBtn && typeof activeBtn.focus === 'function') {
        activeBtn.focus();
      }
    });
  });
}

export function setupQuickConfigDeckEventListeners(): void {
  if (typeof document === 'undefined') return;
  bindQuickSelectListeners();
  bindQuickOutputLocationKeyboard();
  bindQuickTimeRangeListeners();
  bindQuickPromptListener();
  bindQuickCustomMaxLenControl();
  bindQuickCheckboxSetting('quick-adv-carryPrompt', 'carryPrompt');
  bindQuickCheckboxSetting('quick-adv-splitWord', 'splitWord');
  bindDeckScrollCueObserver();
}
