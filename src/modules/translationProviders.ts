// AI Translation Configuration, Providers Registry, & Models Management
import { t, isRtlLanguage, getLanguage, firstStrongDirection } from '../i18n/index';
import { escapeHTML } from './logsController';
import { CustomSelect, customSelectsMap, syncCustomSelects } from './customSelect';
import { getSettingsState, type SettingsState } from './settingsManager';
import { showBatchErrorDialog, type ToastAction } from './appModal';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import {
  type ModelObject,
  type ProviderConfig,
  POPULAR_PROVIDER_FILTERS,
  readProviders,
  writeProviders,
  normalizeModelId,
  isModelIdMatch,
  hasDuplicateModelId,
  normalizeProviderModel,
  normalizeProviderModelsList
} from './providerHelpers';

export { type ModelObject, type ProviderConfig, POPULAR_PROVIDER_FILTERS };

declare global {
  interface Window {
    populateProvidersDropdown: () => void;
    renderProvidersGrid: (providers?: ProviderConfig[] | null) => void;
    onProviderChanged: (keepCurrentTab?: boolean | string, skipTableRender?: boolean) => void;
    togglePasswordVisibility: (inputId: string, btn: HTMLElement) => Promise<void>;
    switchProviderTab: (tab: string) => void;
    saveActiveProviderGeneral: (silent?: boolean) => Promise<boolean>;
    deleteProviderByName: (providerName: string) => Promise<void>;
    deleteActiveProvider: () => Promise<void>;
    toEnglishDigits: (str: any) => string;
    formatTokensShort: (num: any) => string;
    parseTokensInput: (val: any) => number;
    formatNumberForLang: (num: any) => string;
    isReasoningSupportedModel: (modelObj: any) => boolean;
    changeModelsPageSize: (newSize: any) => void;
    updateFilterCounts: () => void;
    updateFilterCountsFromDOM: () => void;
    clearModelsSearch: () => void;
    renderModelsRegistryTable: (provider: ProviderConfig) => void;
    updateActiveModelBannerUI: (modelId: string) => void;
    syncActiveModelSelectionUI: (modelId: string) => void;
    syncTranslationSettingsViewIfVisible: () => void;
    setActiveModelFromTable: (modelId: string) => Promise<void>;
    toggleSortModels: (col: string) => void;
    changeModelsPage: (delta: number) => void;
    applyModelsFilterAndRender: (delay?: number) => void;
    addManualModelRow: (modelId?: string, contextWindow?: number, reasoning?: string, isActive?: boolean, focus?: boolean, supportsReasoning?: boolean) => void;
    fetchActiveProviderModels: () => Promise<void>;
    saveActiveProviderModels: (keepCurrentTab?: boolean, skipTableRender?: boolean, targetProviderName?: string | null) => Promise<void>;
    filterModelsTable: (delay?: number) => void;
    filterModelsStatus: (status: string, delay?: number) => void;
    openAddProviderModal: () => void;
    closeProviderModal: () => void;
    saveProviderConfig: () => Promise<void>;
    showBatchErrorDialog: (fileName: string, errorMsg: string) => Promise<string>;
    resolveBatchError?: (choice: string) => void;
    setupTranslationEventListeners: () => void;
    handleTestModalBackdropClick: (event: any) => void;
    abortAndCloseTestModal: () => Promise<void>;
    closeTestModal: () => void;
    testTranslationConnection: () => Promise<void>;
    toggleTranslationSubSettingsVisibility: () => void;
    syncProviderModelsFromSettings: () => void;
    translationStudioController?: any;
    settingsState: SettingsState | null;
    saveCurrentSettings: (immediate?: boolean) => any;
    markSettingsDirty: () => void;
    flushPendingModelCatalogChanges: () => boolean;
    showNotification: (msg: string, type: string, customDuration?: number | null, action?: ToastAction | null) => void;
    showConfirmModal: (title: string, message: string, confirmButtonText?: string | null) => Promise<boolean>;
    updateTranscribeUIConfigs: () => void;
    applyDynamicDirection?: (el: HTMLElement) => void;
    formatLocalizedNumber?: (num: any, lang?: string, maxFrac?: number) => string;
    currentProviderModels?: ModelObject[];
  }
}

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): ((cmd: string, args?: any) => Promise<any>) | null => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

const invoke = async (cmd: string, args?: any): Promise<any> => {
  const inv = getTauriInvoke();
  if (inv) return inv(cmd, args);
  throw new Error(`Tauri invoke not available for ${cmd}`);
};

const saveSettings = async (immediate = false): Promise<void> => {
  const win = getGlobal();
  if (typeof win.saveCurrentSettings === 'function') {
    await win.saveCurrentSettings(immediate);
  }
};

const syncProviderCustomSelects = (): void => {
  const win = getGlobal();
  const fn = typeof win?.syncCustomSelects === 'function' ? win.syncCustomSelects : syncCustomSelects;
  if (typeof fn === 'function') {
    fn(false, true);
  }
};

const notify = (msg: string, type: 'info' | 'success' | 'error' = 'info'): void => {
  const win = getGlobal();
  if (typeof win.showNotification === 'function') {
    win.showNotification(msg, type);
  }
};

const confirmModal = async (title: string, message: string, confirmButtonText: string): Promise<boolean> => {
  const win = getGlobal();
  if (typeof win.showConfirmModal === 'function') {
    return win.showConfirmModal(title, message, confirmButtonText);
  }
  return false;
};

const applyDynamicDir = (el: HTMLElement | null): void => {
  if (!el) return;
  const win = getGlobal();
  if (typeof win.applyDynamicDirection === 'function') {
    win.applyDynamicDirection(el);
  }
};

const triggerUpdateTranscribeUI = (): void => {
  const win = getGlobal();
  if (typeof win.updateTranscribeUIConfigs === 'function') {
    win.updateTranscribeUIConfigs();
  }
};

import {
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  formatLocalizedNumber
} from '../i18n/formatters';

export {
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  formatLocalizedNumber
};

import { _trapModalFocus } from './appModal';
export { _trapModalFocus };

let providersCorruptToastShown = false;

function readProvidersSafe(settingsState: { translateAiProviders?: string } | null | undefined): ProviderConfig[] {
  return readProviders(settingsState, (err) => {
    console.error('Corrupt translateAiProviders JSON:', err);
    if (!providersCorruptToastShown) {
      providersCorruptToastShown = true;
      notify(t('toasts.providersJsonCorrupt'), 'error');
    }
  });
}

let currentProviderModels: ModelObject[] = [];
let currentModelsProviderName = '';
let currentModelsSortCol: string | null = null;
let currentModelsSortDir: 'asc' | 'desc' | 'none' = 'none';
let currentModelsPage = 1;
export const DEFAULT_MODELS_PAGE_SIZE = 20;
let currentModelsPageSize: number | 'all' = (function() {
  if (typeof localStorage === 'undefined') return DEFAULT_MODELS_PAGE_SIZE;
  try {
    const saved = localStorage.getItem('whisper_models_page_size');
    if (saved === 'all') return 'all';
    const parsed = parseInt(saved || '', 10);
    return (parsed === 20 || parsed === 50 || parsed === 100) ? parsed : DEFAULT_MODELS_PAGE_SIZE;
  } catch {
    return DEFAULT_MODELS_PAGE_SIZE;
  }
})();

let currentModelStatusFilter = 'all';
let filterTimeout: any = null;
let modelSaveDebounceTimer: any = null;
let isPreviewTesting = false;
let previewTestId = 0;
let _providerModalTrap: any = null;
let _testModalTrap: any = null;
let modelsFetchActiveProvider: string | null = null;
let providerKeyLoadSeq = 0;
let hasDirtyProviderGeneral = false;
let inFlightProviderGeneralSave: Promise<boolean> | null = null;
let providerModalCloseTimer: ReturnType<typeof setTimeout> | null = null;
let isSavingProviderConfig = false;
let isDeletingProvider = false;

function dedupeLiveModels(models: ModelObject[]): ModelObject[] {
  const seen = new Set<string>();
  const result: ModelObject[] = [];
  let hasBlankDraft = false;
  for (const m of models) {
    if (!m || typeof m !== 'object') continue;
    const rawId = String(m.id || '').trim();
    if (!rawId) {
      if (!hasBlankDraft) {
        hasBlankDraft = true;
        result.push(m);
      }
      continue;
    }
    const key = normalizeModelId(rawId);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(m);
  }
  return result;
}

export function isReasoningSupportedModel(modelObj: any): boolean {
  if (!modelObj) return false;
  if (typeof modelObj === 'object') {
    if (typeof modelObj.supportsReasoning === 'boolean') {
      return modelObj.supportsReasoning;
    }
    if (typeof modelObj.supports_reasoning === 'boolean') {
      return modelObj.supports_reasoning;
    }
    const reasoning = (modelObj.reasoning || '').trim().toLowerCase();
    if (reasoning && reasoning !== 'none') return true;
    return false;
  }
  if (typeof modelObj === 'string') {
    let found = currentProviderModels.find(m => m && m.id === modelObj);
    if (!found) {
      const settings = getSettingsState();
      const providers = readProvidersSafe(settings);
      for (const p of providers) {
        if (Array.isArray(p.models)) {
          const m = p.models.find((mod: any) => mod && mod.id === modelObj);
          if (m) {
            found = m;
            break;
          }
        }
      }
    }
    if (found) {
      return isReasoningSupportedModel(found);
    }
  }
  return false;
}

function destroyModelRowCustomSelects(parentEl: HTMLElement | null): void {
  if (!parentEl) return;
  const selects = parentEl.querySelectorAll('select.model-reasoning-select') as NodeListOf<HTMLSelectElement>;
  selects.forEach(sel => {
    let inst: any = null;
    if (window.customSelectsMap) {
      inst = (sel.id ? window.customSelectsMap.get(sel.id) : null) || window.customSelectsMap.get(sel);
      if (sel.id) window.customSelectsMap.delete(sel.id);
      window.customSelectsMap.delete(sel);
    }
    if (inst && typeof inst.destroy === 'function') {
      try {
        inst.destroy();
      } catch (err) {
        console.warn("Error destroying custom select:", err);
      }
    }
    delete sel.dataset.customSelectInitialized;
  });
}

function updateSortHeaderIcons(): void {
  if (typeof document === 'undefined') return;
  const cols = ['active', 'id', 'ctx', 'reasoning'];
  cols.forEach(col => {
    const th = document.querySelector(`.models-table-head .th-${col}`);
    const icon = document.getElementById(`sort-icon-${col}`);
    if (!th || !icon) return;
    
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (currentModelsSortCol === col) {
      if (currentModelsSortDir === 'asc') {
        th.classList.add('sorted-asc');
        th.setAttribute('aria-sort', 'ascending');
        icon.textContent = '▲';
      } else if (currentModelsSortDir === 'desc') {
        th.classList.add('sorted-desc');
        th.setAttribute('aria-sort', 'descending');
        icon.textContent = '▼';
      } else {
        th.setAttribute('aria-sort', 'none');
        icon.textContent = '↕';
      }
    } else {
      th.setAttribute('aria-sort', 'none');
      icon.textContent = '↕';
    }
  });
}

function syncProviderModelDropdownOptions(
  modelSelect: HTMLSelectElement | null,
  models: ModelObject[],
  settingsState: SettingsState | null
): void {
  const enabledModels = (models || []).filter(m => m.enabled !== false);

  if (modelSelect) {
    modelSelect.innerHTML = '';
    const tokensLabel = t('settings.tokensUnit') || 'tokens';
    enabledModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const formattedCtx = formatLocalizedNumber
        ? formatLocalizedNumber(m.contextWindow || m.context_window || 200000, getLanguage(), 0)
        : (m.contextWindow || m.context_window || 200000).toLocaleString();
      opt.textContent = `${m.id} (${formattedCtx} ${tokensLabel})`;
      modelSelect.appendChild(opt);
    });
  }

  if (settingsState) {
    const matchedModel = enabledModels.find(m => isModelIdMatch(m.id, settingsState.translateAiModel));
    if (matchedModel) {
      settingsState.translateAiModel = matchedModel.id;
    } else if (enabledModels.length > 0) {
      settingsState.translateAiModel = enabledModels[0].id;
    } else {
      settingsState.translateAiModel = '';
    }
    if (modelSelect) {
      modelSelect.value = settingsState.translateAiModel || '';
    }
    updateActiveModelBannerUI(settingsState.translateAiModel);
  }
}

export function flushPendingModelCatalogChanges(): boolean {
  if (!modelSaveDebounceTimer) return false;
  clearTimeout(modelSaveDebounceTimer);
  modelSaveDebounceTimer = null;

  const settingsState = getSettingsState();
  const providerName = settingsState?.translateAiProvider || '';
  if (!settingsState || !providerName) return false;

  const providers = readProvidersSafe(settingsState);

  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return false;

  const validModels = normalizeProviderModelsList(currentProviderModels);
  currentProviderModels = dedupeLiveModels(currentProviderModels);
  providers[providerIdx] = {
    ...providers[providerIdx],
    models: validModels
  };
  writeProviders(settingsState, providers);

  if (typeof document !== 'undefined') {
    const selectDOM = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
    syncProviderModelDropdownOptions(selectDOM, validModels, settingsState);
  }

  return true;
}

export function syncProviderModelsFromSettings(): void {
  const settingsState = getSettingsState();
  if (!settingsState) return;

  const providers = readProvidersSafe(settingsState);
  const activeName = settingsState.translateAiProvider || '';
  const provider = providers.find(p => p.name === activeName);

  if (!provider) {
    currentProviderModels = [];
    currentModelsProviderName = '';
    return;
  }

  currentProviderModels = buildLiveModelsForProvider(provider);
  currentModelsProviderName = '';

  if (typeof document !== 'undefined') {
    const modelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
    if (modelSelect) {
      syncProviderModelDropdownOptions(modelSelect, provider.models || [], settingsState);
      syncProviderCustomSelects();
    }
    const settingsPanel = document.getElementById('panel-settings');
    const modelsTab = document.getElementById('provider-tab-models');
    if (
      settingsPanel?.classList?.contains('active') &&
      modelsTab &&
      modelsTab.style.display !== 'none'
    ) {
      renderModelsRegistryTable(provider);
    }
  }
}

function saveActiveProviderModelsDebounced(): void {
  const settings = getSettingsState();
  if (!settings) return;
  const currentProvider = settings.translateAiProvider;
  const win = getGlobal();
  if (typeof win.markSettingsDirty === 'function') {
    win.markSettingsDirty();
  }
  clearTimeout(modelSaveDebounceTimer);
  modelSaveDebounceTimer = setTimeout(() => {
    modelSaveDebounceTimer = null;
    if (settings.translateAiProvider === currentProvider) {
      window.saveActiveProviderModels(true, true, currentProvider);
    }
  }, 200);
}

export function updateActiveModelBannerUI(modelId: string): void {
  if (typeof document === 'undefined') return;
  const bannerEl = document.getElementById('active-model-banner');
  const bannerVal = document.getElementById('active-model-banner-value');
  const settings = getSettingsState();
  const providerName = (settings && settings.translateAiProvider) || '';
  if (bannerEl && bannerVal) {
    if (modelId && providerName) {
      bannerVal.innerHTML = `
        <div class="active-model-chip-group">
          <span class="active-model-chip-provider">${escapeHTML(providerName)}</span>
          <span class="active-model-chip-model">${escapeHTML(modelId)}</span>
        </div>
      `;
      bannerEl.style.display = 'flex';
    } else {
      bannerEl.style.display = 'none';
    }
  }
}

// ----------------- Core Provider Methods -----------------
export function populateProvidersDropdown(): void {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!select) return;
  select.innerHTML = '';
  
  const settingsState = getSettingsState();
  const providers = readProvidersSafe(settingsState);
  
  providers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  
  if (settingsState && providers.length > 0 && !settingsState.translateAiProvider) {
    settingsState.translateAiProvider = providers[0].name;
  }
  
  select.value = (settingsState && settingsState.translateAiProvider) || '';
  
  renderProvidersGrid(providers);

  if (window.translationStudioController) {
    window.translationStudioController.refreshProviderOptions();
  }
}

function makeTileKeyboardAccessible(
  el: HTMLElement,
  onActivate: () => void,
  ignoreTargetSelector?: string
): void {
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (ignoreTargetSelector && (e.target as HTMLElement | null)?.closest?.(ignoreTargetSelector)) {
      return;
    }
    e.preventDefault();
    onActivate();
  });
}

export function renderProvidersGrid(providers: ProviderConfig[] | null = null): void {
  if (typeof document === 'undefined') return;
  const grid = document.getElementById('providers-tiles-grid');
  if (!grid) return;
  const settingsState = getSettingsState();
  if (providers === null && !settingsState) return;

  grid.innerHTML = '';
  
  if (providers === null) {
    providers = readProvidersSafe(settingsState);
  }
  
  const activeName = (settingsState && settingsState.translateAiProvider) || '';
  
  (providers || []).forEach(p => {
    const tile = document.createElement('div');
    const isActive = p.name === activeName;
    tile.className = `provider-tile${isActive ? ' active' : ''}`;
    
    const rawFormat = p.apiFormat || p.api_format || 'Chat completions';
    const formatLabel = rawFormat;

    let iconSvg = '';
    let brandClass = '';
    
    if (rawFormat === 'Chat completions') {
      brandClass = 'format-openai';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #10b981;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    } else if (rawFormat === 'Anthropic messages') {
      brandClass = 'format-anthropic';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #8b5cf6;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
    } else if (rawFormat === 'Responses') {
      brandClass = 'format-gemini';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #06b6d4;"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`;
    } else {
      brandClass = 'format-custom';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #f59e0b;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>`;
    }
    
    tile.innerHTML = `
      <div class="provider-tile-header">
        <div class="provider-tile-icon-wrapper ${brandClass}">
          ${iconSvg}
        </div>
        <div class="provider-tile-meta">
          <div class="provider-tile-name" dir="auto" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
          <div class="provider-tile-format" dir="ltr" title="${escapeHTML(formatLabel)}">${escapeHTML(formatLabel)}</div>
        </div>
      </div>
      <div class="provider-tile-footer">
        <span class="provider-tile-badge ${isActive ? 'active' : ''}">
          ${isActive ? `<span class="pulse-dot"></span>${t('settings.activeBadge')}` : t('settings.inactiveBadge')}
        </span>
        <button type="button" class="provider-tile-delete" title="${escapeHTML(t('settings.deleteProvider'))}" aria-label="${escapeHTML(t('settings.deleteProvider'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    `;
    
    const activateTile = () => {
      const select = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
      if (select) {
        select.value = p.name;
        onProviderChanged(true);
      }
    };

    tile.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    makeTileKeyboardAccessible(tile, activateTile, '.provider-tile-delete');

    tile.onclick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.provider-tile-delete')) return;
      activateTile();
    };
    
    const delBtn = tile.querySelector('.provider-tile-delete') as HTMLElement;
    if (delBtn) {
      delBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        deleteProviderByName(p.name);
      };
    }
    
    grid.appendChild(tile);
  });
  
  const addTile = document.createElement('div');
  addTile.className = 'provider-tile-add';
  addTile.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span style="font-size: 0.88rem; font-weight: 500;">${t('settings.addProvider')}</span>
  `;
  addTile.onclick = () => openAddProviderModal();
  makeTileKeyboardAccessible(addTile, () => openAddProviderModal());
  grid.appendChild(addTile);
}

function loadKeyringCredentialForCurrentProvider(
  providerName: string,
  keyInput: HTMLInputElement,
  loadSeq: number
): void {
  let userModifiedKey = false;
  const onUserKeyInput = () => {
    userModifiedKey = true;
  };
  if (typeof keyInput.addEventListener === 'function') {
    keyInput.addEventListener('input', onUserKeyInput, { once: true });
  }

  (async () => {
    try {
      const realKey = await invoke('get_keyring_credential', { providerName });
      const currentSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
      if (loadSeq === providerKeyLoadSeq && currentSelect && currentSelect.value === providerName && !userModifiedKey) {
        keyInput.value = realKey;
        keyInput.dataset.loadedKey = realKey;
        keyInput.dataset.isKeyring = 'false';
        delete keyInput.dataset.keyringPending;
        delete keyInput.dataset.keyringError;
        keyInput.removeAttribute('title');
      }
    } catch (e) {
      console.error("Background keyring credential fetch failed:", e);
      const currentSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
      if (loadSeq === providerKeyLoadSeq && currentSelect && currentSelect.value === providerName && !userModifiedKey) {
        // Preserve the keyring placeholder and flag instead of clearing to '',
        // so edits to other provider fields do not silently delete the stored secret.
        keyInput.value = '••••••••••••••••';
        keyInput.dataset.isKeyring = 'true';
        delete keyInput.dataset.keyringPending;
        keyInput.dataset.keyringError = 'true';
        keyInput.title = t('toasts.keyringLoadError', { error: String(e) });
      }
    } finally {
      if (typeof keyInput.removeEventListener === 'function') {
        keyInput.removeEventListener('input', onUserKeyInput);
      }
    }
  })();
}

function flushPendingKeyringLoadIfNeeded(): void {
  if (typeof document === 'undefined') return;
  const keyInput = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
  if (!keyInput || keyInput.dataset.keyringPending !== 'true') return;
  delete keyInput.dataset.keyringPending;

  const settingsState = getSettingsState();
  const activeName = settingsState?.translateAiProvider || '';
  if (!activeName || keyInput.dataset.isKeyring !== 'true') return;

  const provider = readProvidersSafe(settingsState).find(p => p.name === activeName);
  const keyVal = provider ? (provider.apiKey || provider.api_key || '') : '';
  if (keyVal !== '__KEYRING__') return;

  loadKeyringCredentialForCurrentProvider(activeName, keyInput, ++providerKeyLoadSeq);
}

export function onProviderChanged(keepCurrentTab: boolean | string = false, skipTableRender = false): void {
  if (typeof document === 'undefined') return;
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  const modelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
  const mgrCard = document.getElementById('provider-manager-card');
  if (!providerSelect || !modelSelect || !mgrCard) return;
  
  const settingsState = getSettingsState();
  if (modelSaveDebounceTimer) {
    clearTimeout(modelSaveDebounceTimer);
    modelSaveDebounceTimer = null;
    if (settingsState) {
      saveActiveProviderModels(true, true, settingsState.translateAiProvider);
    }
  }

  const providerName = providerSelect.value;
  if (settingsState) {
    settingsState.translateAiProvider = providerName;
  }

  if (modelsFetchActiveProvider && modelsFetchActiveProvider !== providerName) {
    modelsFetchSeq++;
    modelsFetchActiveProvider = null;
    const fetchBtn = document.getElementById('mgr-btn-fetch-models') as HTMLButtonElement | null;
    if (fetchBtn) {
      fetchBtn.disabled = false;
      if (fetchBtn.dataset?.originalHtml !== undefined) {
        fetchBtn.innerHTML = fetchBtn.dataset.originalHtml;
      }
    }
  }
  
  renderProvidersGrid();
  
  const providers = readProvidersSafe(settingsState);
  
  const provider = providers.find(p => p.name === providerName);
  hasDirtyProviderGeneral = false;
  const loadSeq = ++providerKeyLoadSeq;
  
  const genPlaceholder = document.getElementById('general-placeholder-overlay');
  const genFields = document.getElementById('general-config-fields');
  const modelsPlaceholder = document.getElementById('models-placeholder-overlay');
  const modelsFields = document.getElementById('models-catalog-fields');
  
  if (provider) {
    if (genPlaceholder) genPlaceholder.style.display = 'none';
    if (genFields) genFields.style.display = 'block';
    
    if (modelsPlaceholder) modelsPlaceholder.style.display = 'none';
    if (modelsFields) modelsFields.style.display = 'block';
    
    if (typeof keepCurrentTab === 'string') {
      switchProviderTab(keepCurrentTab);
    } else if (!keepCurrentTab) {
      const activeBtn = document.querySelector('.provider-tab-btn.active');
      if (activeBtn && activeBtn.id === 'tab-btn-providers') {
        switchProviderTab('providers');
      } else if (activeBtn && activeBtn.id === 'tab-btn-general') {
        switchProviderTab('general');
      } else if (activeBtn && activeBtn.id === 'tab-btn-models') {
        switchProviderTab('models');
      } else {
        switchProviderTab('auto');
      }
    }
    
    const urlInput = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
    if (urlInput) urlInput.value = provider.baseUrl || provider.base_url || '';

    const formatInput = document.getElementById('mgr-provider-format') as HTMLSelectElement | null;
    if (formatInput) formatInput.value = provider.apiFormat || provider.api_format || 'Chat completions';

    const providerPromptEl = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;
    if (providerPromptEl) {
      providerPromptEl.value = provider.customPrompt || provider.custom_prompt || '';
      applyDynamicDir(providerPromptEl);
    }

    const useKeyringChk = document.getElementById('mgr-provider-use-keyring') as HTMLInputElement | null;
    const providerUsesKeyring = provider.useKeyring !== false && provider.use_keyring !== false;
    if (useKeyringChk) {
      useKeyringChk.checked = providerUsesKeyring;
    }
    
    const keyVal = provider.apiKey || provider.api_key || '';
    const keyInput = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
    if (keyInput) {
      delete keyInput.dataset.keyringError;
      delete keyInput.dataset.keyringPending;
      delete keyInput.dataset.loadedKey;
      keyInput.removeAttribute('title');
      const eyeBtn = keyInput.nextElementSibling as HTMLElement | null;
      setPasswordFieldMasked(keyInput, eyeBtn);
      
      if (keyVal === '__KEYRING__') {
        keyInput.value = '••••••••••••••••';
        keyInput.dataset.isKeyring = 'true';
        const settingsPanel = document.getElementById('panel-settings');
        const shouldDeferKeyring =
          skipTableRender === true &&
          keepCurrentTab === true &&
          Boolean(settingsPanel) &&
          !settingsPanel!.classList?.contains('active');
        if (shouldDeferKeyring) {
          keyInput.dataset.keyringPending = 'true';
        } else {
          loadKeyringCredentialForCurrentProvider(providerName, keyInput, loadSeq);
        }
      } else {
        keyInput.value = keyVal;
        keyInput.dataset.isKeyring = 'false';
      }
    }
    
    syncProviderModelDropdownOptions(modelSelect, provider.models || [], settingsState);
    
    if (!skipTableRender) {
      renderModelsRegistryTable(provider);
    } else {
      currentProviderModels = buildLiveModelsForProvider(provider);
      currentModelsProviderName = '';
      updateFilterCounts();
    }
  } else {
    if (genPlaceholder) genPlaceholder.style.display = 'flex';
    if (genFields) genFields.style.display = 'none';
    
    if (modelsPlaceholder) modelsPlaceholder.style.display = 'flex';
    if (modelsFields) modelsFields.style.display = 'none';
    
    if (typeof keepCurrentTab === 'string') {
      switchProviderTab(keepCurrentTab);
    } else if (!keepCurrentTab) {
      const activeBtn = document.querySelector('.provider-tab-btn.active');
      if (activeBtn && activeBtn.id === 'tab-btn-providers') {
        switchProviderTab('providers');
      } else if (activeBtn && activeBtn.id === 'tab-btn-general') {
        switchProviderTab('general');
      } else if (activeBtn && activeBtn.id === 'tab-btn-models') {
        switchProviderTab('models');
      } else {
        switchProviderTab('auto');
      }
    }
    
    modelSelect.innerHTML = '';
    if (settingsState) {
      settingsState.translateAiModel = '';
    }
    modelSelect.value = '';
    
    const bannerEl = document.getElementById('active-model-banner');
    if (bannerEl) bannerEl.style.display = 'none';
    
    const urlEl = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
    if (urlEl) urlEl.value = '';
    const fmtEl = document.getElementById('mgr-provider-format') as HTMLSelectElement | null;
    if (fmtEl) fmtEl.value = 'Chat completions';
    const promptEl = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;
    if (promptEl) promptEl.value = '';
    const keyEl = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
    if (keyEl) {
      keyEl.value = '';
      delete keyEl.dataset.loadedKey;
      delete keyEl.dataset.keyringError;
      delete keyEl.dataset.keyringPending;
      keyEl.dataset.isKeyring = 'false';
      keyEl.removeAttribute('title');
      setPasswordFieldMasked(keyEl, keyEl.nextElementSibling as HTMLElement | null);
    }
    const useKeyringChk = document.getElementById('mgr-provider-use-keyring') as HTMLInputElement | null;
    if (useKeyringChk) useKeyringChk.checked = true;
    const countEl = document.getElementById('provider-models-count');
    if (countEl) countEl.textContent = '0';

    currentProviderModels = [];
    currentModelsProviderName = '';
    currentModelsPage = 1;
    currentModelStatusFilter = 'all';
    currentModelsSortCol = null;
    currentModelsSortDir = 'none';
    updateFilterCounts();
    applyModelsFilterAndRender(0);
  }

  if (window.translationStudioController) {
    if (typeof window.translationStudioController.syncFromGlobalSettings === 'function') {
      window.translationStudioController.syncFromGlobalSettings();
    } else {
      window.translationStudioController.refreshModelOptions();
    }
  }

  syncProviderCustomSelects();
  saveSettings();
  triggerUpdateTranscribeUI();
}

function setPasswordFieldMasked(input: HTMLInputElement, btn: HTMLElement | null): void {
  input.type = 'password';
  if (!btn) return;
  btn.style.color = 'var(--color-text-muted)';
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
}

export async function togglePasswordVisibility(inputId: string, btn: HTMLElement): Promise<void> {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!input) return;
  const svg = btn.querySelector('svg');
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  
  if (input.type === 'password') {
    if (input.dataset.isKeyring === 'true' && providerSelect && providerSelect.value) {
      const targetProvider = providerSelect.value;
      const loadSeq = ++providerKeyLoadSeq;
      let userModified = false;
      const onInput = () => {
        userModified = true;
      };
      if (typeof input.addEventListener === 'function') {
        input.addEventListener('input', onInput, { once: true });
      }
      (btn as HTMLButtonElement).disabled = true;
      try {
        const realKey = await invoke('get_keyring_credential', { providerName: targetProvider });
        if (loadSeq !== providerKeyLoadSeq || (providerSelect.value && providerSelect.value !== targetProvider) || userModified) {
          return;
        }
        input.value = realKey;
        input.dataset.loadedKey = realKey;
        input.dataset.isKeyring = 'false';
        delete input.dataset.keyringError;
        input.removeAttribute('title');
      } catch (e) {
        if (loadSeq === providerKeyLoadSeq && providerSelect.value === targetProvider && !userModified) {
          input.dataset.keyringError = 'true';
          notify(t('toasts.keyringLoadError', { error: String(e) }), "error");
        }
        return;
      } finally {
        if (typeof input.removeEventListener === 'function') {
          input.removeEventListener('input', onInput);
        }
        (btn as HTMLButtonElement).disabled = false;
      }
    }
    
    input.type = 'text';
    btn.style.color = 'var(--color-cyan)';
    if (svg) {
      svg.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      `;
    }
  } else {
    setPasswordFieldMasked(input, btn);
  }
}

export function switchProviderTab(tab: string): void {
  if (window.customSelectsMap) {
    window.customSelectsMap.forEach(cs => {
      if (cs && cs.isOpen && typeof cs.close === 'function') cs.close();
    });
  }

  const btnAuto = document.getElementById('tab-btn-auto');
  const btnProv = document.getElementById('tab-btn-providers');
  const btnGen = document.getElementById('tab-btn-general');
  const btnMod = document.getElementById('tab-btn-models');
  
  const divAuto = document.getElementById('provider-tab-auto');
  const divProv = document.getElementById('provider-tab-providers');
  const divGen = document.getElementById('provider-tab-general');
  const divMod = document.getElementById('provider-tab-models');
  
  [btnAuto, btnProv, btnGen, btnMod].forEach(btn => {
    if (btn) {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    }
  });
  
  if (divAuto) divAuto.style.display = 'none';
  if (divProv) divProv.style.display = 'none';
  if (divGen) divGen.style.display = 'none';
  if (divMod) divMod.style.display = 'none';
  
  let activeDiv: HTMLElement | null = null;
  if (tab === 'auto') {
    if (btnAuto) { btnAuto.classList.add('active'); btnAuto.setAttribute('aria-selected', 'true'); }
    if (divAuto) { divAuto.style.display = 'flex'; activeDiv = divAuto; }
  } else if (tab === 'providers') {
    if (btnProv) { btnProv.classList.add('active'); btnProv.setAttribute('aria-selected', 'true'); }
    if (divProv) { divProv.style.display = 'block'; activeDiv = divProv; }
  } else if (tab === 'general') {
    if (btnGen) { btnGen.classList.add('active'); btnGen.setAttribute('aria-selected', 'true'); }
    if (divGen) { divGen.style.display = 'block'; activeDiv = divGen; }
    flushPendingKeyringLoadIfNeeded();
  } else {
    if (btnMod) { btnMod.classList.add('active'); btnMod.setAttribute('aria-selected', 'true'); }
    if (divMod) { divMod.style.display = 'block'; activeDiv = divMod; }
    
    const settingsState = getSettingsState();
    if (
      settingsState &&
      settingsState.translateAiProvider &&
      (currentModelsProviderName !== settingsState.translateAiProvider || currentProviderModels.length === 0)
    ) {
      const providers = readProvidersSafe(settingsState);
      const curProv = providers.find((p: any) => p.name === settingsState.translateAiProvider);
      if (curProv && curProv.models && curProv.models.length > 0) {
        renderModelsRegistryTable(curProv);
      } else {
        if (curProv) {
          currentProviderModels = [];
          currentModelsProviderName = curProv.name;
        }
        applyModelsFilterAndRender(0);
      }
    } else {
      applyModelsFilterAndRender(0);
    }
  }
  
  if (activeDiv) {
    activeDiv.style.animation = 'none';
    void activeDiv.offsetWidth;
    activeDiv.style.animation = '';
  }
}

export function hasPendingProviderGeneralChanges(): boolean {
  return hasDirtyProviderGeneral || inFlightProviderGeneralSave !== null;
}

export function flushPendingProviderGeneralChanges(): Promise<boolean> | null {
  if (!hasDirtyProviderGeneral && !inFlightProviderGeneralSave) {
    return null;
  }
  const run = async (): Promise<boolean> => {
    if (inFlightProviderGeneralSave) {
      try {
        await inFlightProviderGeneralSave;
      } catch (_) {}
    }
    if (!hasDirtyProviderGeneral) {
      return true;
    }
    return saveActiveProviderGeneral(true);
  };
  return run();
}

export function saveActiveProviderGeneral(silent = false): Promise<boolean> {
  const task = (async (): Promise<boolean> => {
    const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
    if (!providerSelect) {
      hasDirtyProviderGeneral = false;
      return false;
    }
    const providerName = providerSelect.value;
    if (!providerName) {
      hasDirtyProviderGeneral = false;
      return false;
    }

    flushPendingModelCatalogChanges();
    
    const settingsState = getSettingsState();
    const providers = readProvidersSafe(settingsState);
    
    const providerIdx = providers.findIndex(p => p.name === providerName);
    if (providerIdx === -1) {
      hasDirtyProviderGeneral = false;
      return false;
    }
    
    const provider = providers[providerIdx];
    const urlEl = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
    const fmtEl = document.getElementById('mgr-provider-format') as HTMLSelectElement | null;
    const keyEl = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
    const promptEl = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;
    const keyringChk = document.getElementById('mgr-provider-use-keyring') as HTMLInputElement | null;

    const baseUrl = urlEl ? urlEl.value.trim() : '';
    const apiFormat = fmtEl ? fmtEl.value : 'Chat completions';
    const key = keyEl ? keyEl.value.trim() : '';
    const customPrompt = promptEl ? promptEl.value.trim() : '';
    
    if (!baseUrl) {
      hasDirtyProviderGeneral = false;
      if (!silent) notify(t('toasts.baseUrlRequired'), "info");
      return false;
    }
    
    let keyToSave = provider.apiKey || provider.api_key || '';
    const wasUsingKeyring =
      provider.useKeyring === true ||
      provider.use_keyring === true ||
      keyToSave === '__KEYRING__';
    const existingUseKeyring = provider.useKeyring !== false && provider.use_keyring !== false;
    const preferKeyring = keyringChk ? keyringChk.checked : existingUseKeyring;
    let useKeyring = existingUseKeyring;
    const hadKeyringError = keyEl?.dataset.keyringError === 'true';

    if (key === '') {
      if (!hadKeyringError) {
        if (wasUsingKeyring) {
          try {
            await invoke('delete_keyring_credential', { providerName });
          } catch (_) {}
        }
        keyToSave = '';
        useKeyring = false;
        if (keyEl) delete keyEl.dataset.loadedKey;
      }
    } else if (key === '••••••••••••••••') {
      if (!preferKeyring && wasUsingKeyring && keyToSave === '__KEYRING__') {
        try {
          const retrievedKey = await invoke('get_keyring_credential', { providerName });
          if (retrievedKey) {
            try {
              await invoke('delete_keyring_credential', { providerName });
            } catch (_) {}
            keyToSave = retrievedKey;
            useKeyring = false;
            if (keyEl) {
              keyEl.value = retrievedKey;
              keyEl.dataset.isKeyring = 'false';
              delete keyEl.dataset.loadedKey;
              delete keyEl.dataset.keyringError;
              keyEl.removeAttribute('title');
            }
          }
        } catch (e) {
          if (keyringChk) keyringChk.checked = true;
          useKeyring = true;
          if (!silent) notify(t('toasts.keyringLoadError', { error: String(e) }), 'error');
        }
      }
    } else if (preferKeyring) {
      if (keyEl) {
        delete keyEl.dataset.keyringError;
        keyEl.removeAttribute('title');
      }
      if (keyEl?.dataset.loadedKey === key && keyToSave === '__KEYRING__' && wasUsingKeyring) {
        keyToSave = '__KEYRING__';
        useKeyring = true;
      } else {
        try {
          await invoke('store_keyring_credential', { providerName, key });
          keyToSave = '__KEYRING__';
          useKeyring = true;
          if (keyEl) keyEl.dataset.loadedKey = key;
        } catch (e) {
          console.warn("Failed to store API Key in system keyring, saving in file:", e);
          keyToSave = key;
          useKeyring = false;
          if (keyEl) delete keyEl.dataset.loadedKey;
          if (keyringChk) keyringChk.checked = false;
        }
      }
    } else {
      if (keyEl) {
        delete keyEl.dataset.keyringError;
        keyEl.removeAttribute('title');
        delete keyEl.dataset.loadedKey;
      }
      if (wasUsingKeyring) {
        try {
          await invoke('delete_keyring_credential', { providerName });
        } catch (_) {}
      }
      keyToSave = key;
      useKeyring = false;
    }
    
    provider.baseUrl = baseUrl;
    provider.apiFormat = apiFormat;
    provider.apiKey = keyToSave;
    provider.useKeyring = useKeyring;
    provider.customPrompt = customPrompt;
    
    delete provider.base_url;
    delete provider.api_format;
    delete provider.api_key;
    delete provider.use_keyring;
    delete provider.custom_prompt;
    
    providers[providerIdx] = provider;
    writeProviders(settingsState, providers);
    hasDirtyProviderGeneral = false;
    
    await saveSettings(true);
    
    const select = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
    if (select) select.value = providerName;
    renderProvidersGrid(providers);
    
    if (!silent) {
      notify(t('toasts.providerSettingsSaved'), "success");
    }
    return true;
  })();

  const tracked = task.finally(() => {
    if (inFlightProviderGeneralSave === tracked) {
      inFlightProviderGeneralSave = null;
    }
  });
  inFlightProviderGeneralSave = tracked;
  return tracked;
}

export async function deleteProviderByName(providerName: string): Promise<void> {
  if (!providerName || isDeletingProvider) return;
  isDeletingProvider = true;

  try {
    const confirmed = await confirmModal(
      t('modals.confirmDeleteProviderTitle'),
      t('modals.confirmDeleteProviderDesc', { name: providerName }),
      t('modals.deleteBtn')
    );
    if (!confirmed) return;
    
    const settingsState = getSettingsState();
    if (modelSaveDebounceTimer) {
      if (settingsState && settingsState.translateAiProvider === providerName) {
        clearTimeout(modelSaveDebounceTimer);
        modelSaveDebounceTimer = null;
      } else {
        flushPendingModelCatalogChanges();
      }
    }
    const providers = readProvidersSafe(settingsState);
    
    const providerIdx = providers.findIndex(p => p.name === providerName);
    if (providerIdx === -1) return;
    
    const provider = providers[providerIdx];
    if (provider.useKeyring || provider.use_keyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__') {
      try {
        await invoke('delete_keyring_credential', { providerName });
      } catch(e) {}
    }
    
    providers.splice(providerIdx, 1);
    if (settingsState) {
      writeProviders(settingsState, providers);
      if (settingsState.translateAiProvider === providerName) {
        settingsState.translateAiProvider = providers.length > 0 ? providers[0].name : '';
      }
    }
    
    await saveSettings(true);
    populateProvidersDropdown();
    onProviderChanged(true);
    
    notify(t('toasts.providerDeleted'), "info");
  } finally {
    isDeletingProvider = false;
  }
}

export async function deleteActiveProvider(): Promise<void> {
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) return;
  
  await deleteProviderByName(providerName);
}

export function changeModelsPageSize(newSize: any): void {
  if (newSize === 'all') {
    currentModelsPageSize = 'all';
    if (typeof localStorage !== 'undefined') localStorage.setItem('whisper_models_page_size', 'all');
  } else {
    const parsed = parseInt(newSize, 10);
    currentModelsPageSize = isNaN(parsed) || parsed <= 0 ? DEFAULT_MODELS_PAGE_SIZE : parsed;
    if (typeof localStorage !== 'undefined') localStorage.setItem('whisper_models_page_size', String(currentModelsPageSize));
  }
  currentModelsPage = 1;
  applyModelsFilterAndRender(0);
}

export function updateFilterCounts(): void {
  const totalCount = currentProviderModels.length;
  const freeCount = currentProviderModels.filter(m => (m.id || '').toLowerCase().includes('free')).length;
  const reasoningCount = currentProviderModels.filter(m => {
    if (!isReasoningSupportedModel(m)) return false;
    const r = (m && m.reasoning ? String(m.reasoning).trim().toLowerCase() : '');
    return Boolean(r && r !== 'none');
  }).length;

  const countBadge = document.getElementById('provider-models-count');
  if (countBadge) countBadge.textContent = formatNumberForLang(totalCount);

  const pillsContainer = document.getElementById('models-filter-pills') || document.querySelector('.models-filter-pills');
  if (!pillsContainer) return;

  const filterDefs: Array<{ id: string; label: string; count: number; dotClass: string }> = [
    {
      id: 'all',
      label: t('settings.allModels') || 'All Models',
      count: totalCount,
      dotClass: ''
    }
  ];

  if (freeCount > 0 || currentModelStatusFilter === 'free') {
    filterDefs.push({
      id: 'free',
      label: t('settings.freeTier') || 'Free Tier',
      count: freeCount,
      dotClass: 'filter-dot-free'
    });
  }

  if (reasoningCount > 0 || currentModelStatusFilter === 'reasoning') {
    filterDefs.push({
      id: 'reasoning',
      label: t('settings.reasoning') || 'Reasoning',
      count: reasoningCount,
      dotClass: 'filter-dot-reasoning'
    });
  }

  POPULAR_PROVIDER_FILTERS.forEach(p => {
    const pCount = currentProviderModels.filter(m => p.test((m.id || '').toLowerCase())).length;
    if (pCount > 0 || currentModelStatusFilter === p.id) {
      filterDefs.push({
        id: p.id,
        label: p.label,
        count: pCount,
        dotClass: ''
      });
    }
  });

  if (!filterDefs.some(f => f.id === currentModelStatusFilter)) {
    currentModelStatusFilter = 'all';
  }

  pillsContainer.innerHTML = filterDefs.map(f => `
    <button type="button" class="btn-filter ${currentModelStatusFilter === f.id ? 'active' : ''}" data-filter="${f.id}" onclick="filterModelsStatus('${f.id}')" id="filter-models-${f.id}">
      ${f.dotClass ? `<span class="${f.dotClass}"></span>` : ''}
      <span>${escapeHTML(f.label)}</span>
      <span class="filter-badge" id="filter-count-${f.id}">${formatNumberForLang(f.count)}</span>
    </button>
  `).join('');
}

export function clearModelsSearch(): void {
  const searchInput = document.getElementById('mgr-models-search') as HTMLInputElement | null;
  const clearBtn = document.getElementById('mgr-models-search-clear');
  if (searchInput) {
    searchInput.value = '';
    applyDynamicDir(searchInput);
  }
  if (clearBtn) clearBtn.style.display = 'none';
  currentModelsPage = 1;
  filterModelsStatus('all', 0);
  if (searchInput) searchInput.focus();
}

function buildLiveModelsForProvider(provider: ProviderConfig): ModelObject[] {
  return (provider && provider.models ? provider.models : []).map(m => {
    const isReasoning = isReasoningSupportedModel(m);
    const reasoningVal = isReasoning
      ? ((m.reasoning !== undefined && m.reasoning !== null && m.reasoning !== '') ? m.reasoning : 'Medium')
      : 'None';
    const supportsReasoning = typeof m.supportsReasoning === 'boolean'
      ? m.supportsReasoning
      : (typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : (isReasoning ? true : undefined));
    return normalizeProviderModel(m, {
      reasoningOverride: reasoningVal,
      supportsReasoningOverride: supportsReasoning
    });
  });
}

export function renderModelsRegistryTable(provider: ProviderConfig): void {
  currentProviderModels = buildLiveModelsForProvider(provider);
  currentModelsProviderName = provider?.name || '';
  
  currentModelsPage = 1;
  currentModelsSortCol = null;
  currentModelsSortDir = 'none';
  updateFilterCounts();
  applyModelsFilterAndRender(0);
}

function applyActiveModelRowHighlights(modelId: string): void {
  if (typeof document === 'undefined') return;
  if (currentModelsSortCol === 'active') {
    applyModelsFilterAndRender(0);
    return;
  }

  const tbody = document.getElementById('mgr-models-tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('.model-data-row') as NodeListOf<HTMLElement>;
  rows.forEach(row => {
    const rowModelId = (row.dataset.modelId || '').toLowerCase();
    const isNowActive = rowModelId === modelId.toLowerCase();
    const wasActive = row.classList.contains('active-model-row');

    if (isNowActive && !wasActive) {
      row.classList.add('active-model-row');
      row.setAttribute('aria-selected', 'true');
      row.setAttribute('aria-checked', 'true');
      const activeCell = row.querySelector('.td-active');
      if (activeCell) {
        const badgeLabel = escapeHTML(t('settings.activeBadge'));
        activeCell.innerHTML = `
          <div class="model-active-badge is-active" title="${badgeLabel}">
            <span class="active-dot"></span>
            <span class="badge-text">${badgeLabel}</span>
          </div>
        `;
      }
      const actionCell = row.querySelector('.td-action');
      if (actionCell) actionCell.innerHTML = '';
    } else if (!isNowActive && wasActive) {
      row.classList.remove('active-model-row');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('aria-checked', 'false');
      const activeCell = row.querySelector('.td-active');
      if (activeCell) {
        const setActiveLabel = escapeHTML(t('settings.setActiveBadge'));
        activeCell.innerHTML = `
          <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${setActiveLabel}" aria-label="${setActiveLabel}">
            <span class="radio-circle"></span>
          </button>
        `;
      }
      const actionCell = row.querySelector('.td-action');
      if (actionCell) {
        const removeLabel = escapeHTML(t('settings.removeModelRow') || 'Remove Model Row');
        actionCell.innerHTML = `
          <button type="button" class="model-btn-trash" title="${removeLabel}" aria-label="${removeLabel}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        `;
      }
    }
  });
}

export function syncActiveModelSelectionUI(modelId: string): void {
  if (typeof document === 'undefined') return;
  const selectDOM = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
  if (selectDOM) {
    selectDOM.value = modelId;
    syncProviderCustomSelects();
  }
  updateActiveModelBannerUI(modelId);

  const activeProvider = getSettingsState()?.translateAiProvider || '';
  if (activeProvider && currentModelsProviderName === activeProvider) {
    applyActiveModelRowHighlights(modelId);
  }
}

export function syncTranslationSettingsViewIfVisible(): void {
  if (typeof document === 'undefined') return;
  const settingsPanel = document.getElementById('panel-settings');
  const translationGroup = document.getElementById('group-translation');
  if (!settingsPanel?.classList?.contains('active') || !translationGroup) return;
  const isGroupVisible =
    translationGroup.classList?.contains('active') ||
    (translationGroup as HTMLElement).style.display === 'block';
  if (!isGroupVisible) return;

  const settingsState = getSettingsState();
  const activeName = settingsState?.translateAiProvider || '';

  const genTab = document.getElementById('provider-tab-general');
  if (genTab && genTab.style.display !== 'none') {
    flushPendingKeyringLoadIfNeeded();
  }

  const modelsTab = document.getElementById('provider-tab-models');
  if (modelsTab && modelsTab.style.display !== 'none' && activeName) {
    if (currentModelsProviderName !== activeName) {
      const providers = readProvidersSafe(settingsState);
      const curProv = providers.find((p: ProviderConfig) => p.name === activeName);
      if (curProv && curProv.models && curProv.models.length > 0) {
        renderModelsRegistryTable(curProv);
      } else {
        if (curProv) {
          currentProviderModels = [];
          currentModelsProviderName = curProv.name;
        }
        updateFilterCounts();
        applyModelsFilterAndRender(0);
      }
    }
  }
}

export async function setActiveModelFromTable(modelId: string): Promise<void> {
  if (!modelId) return;
  const settingsState = getSettingsState();
  const prevActiveModelId = settingsState ? settingsState.translateAiModel : '';
  if (prevActiveModelId === modelId) return;

  if (settingsState) {
    settingsState.translateAiModel = modelId;
  }
  
  await saveActiveProviderModels(true, true);
  updateActiveModelBannerUI(modelId);
  
  const selectDOM = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
  if (selectDOM) selectDOM.value = modelId;
  
  await saveSettings();
  triggerUpdateTranscribeUI();
  if (window.translationStudioController) {
    window.translationStudioController.syncFromGlobalSettings();
  }

  applyActiveModelRowHighlights(modelId);
}

export function toggleSortModels(col: string): void {
  if (currentModelsSortCol === col) {
    const initialDir = (col === 'id') ? 'asc' : 'desc';
    const secondDir = (initialDir === 'asc') ? 'desc' : 'asc';
    
    if (currentModelsSortDir === initialDir) {
      currentModelsSortDir = secondDir;
    } else if (currentModelsSortDir === secondDir) {
      currentModelsSortDir = 'none';
      currentModelsSortCol = null;
    } else {
      currentModelsSortDir = initialDir;
    }
  } else {
    currentModelsSortCol = col;
    currentModelsSortDir = (col === 'id') ? 'asc' : 'desc';
  }
  currentModelsPage = 1;
  applyModelsFilterAndRender(0);
}

export function changeModelsPage(delta: number): void {
  currentModelsPage += delta;
  applyModelsFilterAndRender(0);
  const container = document.getElementById('mgr-models-tbody');
  if (container) container.scrollTop = 0;
}

export function applyModelsFilterAndRender(delay = 0): void {
  clearTimeout(filterTimeout);
  const execute = () => {
    if (typeof document === 'undefined') return;
    const searchEl = document.getElementById('mgr-models-search') as HTMLInputElement | null;
    if (searchEl) applyDynamicDir(searchEl);
    const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const clearBtn = document.getElementById('mgr-models-search-clear');
    if (clearBtn) {
      clearBtn.style.display = query ? 'flex' : 'none';
    }

    let filtered = currentProviderModels.filter(m => {
      const idLower = (m.id || '').toLowerCase();
      if (query && !idLower.includes(query)) return false;
      if (currentModelStatusFilter === 'all') return true;
      if (currentModelStatusFilter === 'free') return idLower.includes('free');
      if (currentModelStatusFilter === 'reasoning') {
        if (!isReasoningSupportedModel(m)) return false;
        const r = (m && m.reasoning ? String(m.reasoning).trim().toLowerCase() : '');
        return Boolean(r && r !== 'none');
      }
      const prov = POPULAR_PROVIDER_FILTERS.find(p => p.id === currentModelStatusFilter);
      if (prov) return prov.test(idLower);
      return true;
    });

    if (currentModelsSortCol && currentModelsSortDir !== 'none') {
      const dir = currentModelsSortDir === 'asc' ? 1 : -1;
      const settings = getSettingsState();
      const activeModelId = (settings && settings.translateAiModel) || '';
      
      filtered.sort((a, b) => {
        if (currentModelsSortCol === 'active') {
          const aActive = isModelIdMatch(a.id, activeModelId) ? 1 : 0;
          const bActive = isModelIdMatch(b.id, activeModelId) ? 1 : 0;
          return (aActive - bActive) * dir;
        } else if (currentModelsSortCol === 'id') {
          return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }) * dir;
        } else if (currentModelsSortCol === 'ctx') {
          return ((a.contextWindow || 0) - (b.contextWindow || 0)) * dir;
        } else if (currentModelsSortCol === 'reasoning') {
          const rank: Record<string, number> = {
            'none': 0,
            'minimal': 1,
            'low': 2,
            'medium': 3,
            'high': 4,
            'xhigh': 5,
            'max': 6,
            'ultra': 7
          };
          const aRank = rank[(a.reasoning || '').toLowerCase()] ?? 0;
          const bRank = rank[(b.reasoning || '').toLowerCase()] ?? 0;
          return (aRank - bRank) * dir;
        }
        return 0;
      });
    }

    updateSortHeaderIcons();

    const totalFiltered = filtered.length;
    const pageSize = currentModelsPageSize === 'all' ? Math.max(1, totalFiltered) : currentModelsPageSize;
    const totalPages = currentModelsPageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalFiltered / pageSize));
    if (currentModelsPage > totalPages) currentModelsPage = totalPages;
    if (currentModelsPage < 1) currentModelsPage = 1;

    const startIndex = currentModelsPageSize === 'all' ? 0 : (currentModelsPage - 1) * pageSize;
    const endIndex = currentModelsPageSize === 'all' ? totalFiltered : Math.min(startIndex + pageSize, totalFiltered);
    const pageItems = filtered.slice(startIndex, endIndex);

    const showingCountEl = document.getElementById('models-showing-count');
    if (showingCountEl) {
      if (currentProviderModels.length === 0) {
        showingCountEl.textContent = t('settings.zeroModels');
      } else if (query || currentModelStatusFilter !== 'all') {
        if (totalFiltered <= pageSize || currentModelsPageSize === 'all') {
          showingCountEl.textContent = t('settings.showingModelsCount', {
            visible: formatNumberForLang(totalFiltered),
            total: formatNumberForLang(currentProviderModels.length)
          });
        } else {
          showingCountEl.textContent = t('settings.showingFilteredPageRange', {
            start: formatNumberForLang(totalFiltered > 0 ? startIndex + 1 : 0),
            end: formatNumberForLang(endIndex),
            visible: formatNumberForLang(totalFiltered),
            total: formatNumberForLang(currentProviderModels.length)
          });
        }
      } else {
        if (totalFiltered <= pageSize || currentModelsPageSize === 'all') {
          showingCountEl.textContent = t('settings.showingAllModelsCount', {
            total: formatNumberForLang(currentProviderModels.length)
          });
        } else {
          showingCountEl.textContent = t('settings.showingPageRange', {
            start: formatNumberForLang(startIndex + 1),
            end: formatNumberForLang(endIndex),
            total: formatNumberForLang(totalFiltered)
          });
        }
      }
    }

    const tbody = document.getElementById('mgr-models-tbody');
    if (tbody) {
      const prevScrollTop = tbody.scrollTop;
      destroyModelRowCustomSelects(tbody);
      tbody.innerHTML = '';
      const settings = getSettingsState();
      const activeModelId = (settings && settings.translateAiModel) || '';
      const frag = document.createDocumentFragment();
      pageItems.forEach((modelObj, idx) => {
        const isActive = isModelIdMatch(modelObj.id, activeModelId);
        const row = createModelRowElement(modelObj, isActive, startIndex + idx);
        frag.appendChild(row);
      });
      tbody.appendChild(frag);

      if (prevScrollTop > 0) {
        tbody.scrollTop = prevScrollTop;
      }

      const selects = tbody.querySelectorAll('select.model-reasoning-select') as NodeListOf<HTMLSelectElement>;
      selects.forEach(sel => {
        if (!sel.dataset.customSelectInitialized) {
          try {
            const cs = new CustomSelect(sel, { observe: false });
            sel.dataset.customSelectInitialized = 'true';
            const container = cs.container || sel.closest('.custom-select-container');
            if (container) {
              if (sel.value.toLowerCase() === 'none') {
                container.classList.remove('reasoning-active');
              } else {
                container.classList.add('reasoning-active');
              }
            }
          } catch (selErr) {
            console.error("Failed to initialize CustomSelect on reasoning select:", selErr);
          }
        }
      });
    }

    const pagContainer = document.getElementById('mgr-models-pagination');
    const pagInfo = document.getElementById('mgr-pagination-info');
    const pagIndicator = document.getElementById('mgr-pagination-page-indicator');
    const btnPrev = document.getElementById('btn-page-prev') as HTMLButtonElement | null;
    const btnNext = document.getElementById('btn-page-next') as HTMLButtonElement | null;
    const pageSizeSelect = document.getElementById('models-page-size-select') as HTMLSelectElement | null;
    const pagNav = pagContainer ? pagContainer.querySelector('.pagination-nav') as HTMLElement | null : null;

    if (pageSizeSelect) {
      if (!pageSizeSelect.dataset.customSelectInitialized) {
        new CustomSelect(pageSizeSelect, { observe: false });
        pageSizeSelect.dataset.customSelectInitialized = 'true';
      }
      pageSizeSelect.value = String(currentModelsPageSize);
      const cs = window.customSelectsMap && window.customSelectsMap.get('models-page-size-select');
      if (cs) {
        cs.syncSelectedValue();
      }
    }

    const tableWrapper = document.getElementById('mgr-models-table-wrapper');
    if (pagContainer) {
      if (totalFiltered > 0) {
        pagContainer.style.display = 'flex';
        if (tableWrapper) tableWrapper.classList.add('has-pagination');
        if (pagInfo) {
          if (currentModelsPageSize === 'all' || totalFiltered <= pageSize) {
            pagInfo.textContent = t('settings.showingAllModelsCount', {
              total: formatNumberForLang(totalFiltered)
            });
          } else {
            pagInfo.textContent = t('settings.showingPageRange', {
              start: formatNumberForLang(totalFiltered > 0 ? startIndex + 1 : 0),
              end: formatNumberForLang(endIndex),
              total: formatNumberForLang(totalFiltered)
            });
          }
        }
        if (pagNav) {
          pagNav.style.display = 'flex';
        }
        const hidePageNavButtons = totalPages <= 1 || currentModelsPageSize === 'all';
        const pagDivider = pagContainer.querySelector('.pagination-divider') as HTMLElement | null;
        if (pagDivider) {
          pagDivider.style.display = hidePageNavButtons ? 'none' : 'block';
        }
        if (btnPrev) {
          btnPrev.style.display = hidePageNavButtons ? 'none' : 'inline-flex';
          btnPrev.disabled = currentModelsPage <= 1;
        }
        if (btnNext) {
          btnNext.style.display = hidePageNavButtons ? 'none' : 'inline-flex';
          btnNext.disabled = currentModelsPage >= totalPages;
        }
        if (pagIndicator) {
          pagIndicator.style.display = hidePageNavButtons ? 'none' : 'inline-block';
          pagIndicator.textContent = t('settings.pageOf', {
            current: formatNumberForLang(currentModelsPage),
            total: formatNumberForLang(totalPages)
          });
        }
      } else {
        pagContainer.style.display = 'none';
        if (tableWrapper) tableWrapper.classList.remove('has-pagination');
      }
    }

    const emptyState = document.getElementById('mgr-models-empty-state');
    const emptyTitle = emptyState ? emptyState.querySelector('.models-empty-title') : null;
    const emptyDesc = emptyState ? emptyState.querySelector('.models-empty-desc') : null;
    const emptyResetBtn = document.getElementById('mgr-models-empty-reset-btn');
    const headEl = document.querySelector('.models-table-head') as HTMLElement | null;
    const bodyEl = document.querySelector('.models-table-body') as HTMLElement | null;

    if (emptyState) {
      if (currentProviderModels.length === 0) {
        emptyState.style.display = 'flex';
        if (emptyTitle) emptyTitle.textContent = t('settings.noModelsConfiguredTitle');
        if (emptyDesc) emptyDesc.textContent = t('settings.noModelsConfiguredDesc');
        if (emptyResetBtn) emptyResetBtn.style.display = 'none';
        if (headEl) headEl.style.display = 'none';
        if (bodyEl) bodyEl.style.display = 'none';
      } else if (totalFiltered === 0) {
        emptyState.style.display = 'flex';
        if (emptyTitle) emptyTitle.textContent = t('settings.noMatchingModelsTitle');
        if (emptyDesc) emptyDesc.textContent = t('settings.noMatchingModelsDesc');
        if (emptyResetBtn) emptyResetBtn.style.display = 'inline-flex';
        if (headEl) headEl.style.display = 'none';
        if (bodyEl) bodyEl.style.display = 'none';
      } else {
        emptyState.style.display = 'none';
        if (headEl) headEl.style.display = 'grid';
        if (bodyEl) bodyEl.style.display = 'block';
      }
    }
  };

  if (delay > 0) {
    filterTimeout = setTimeout(execute, delay);
  } else {
    execute();
  }
}

export function createModelRowElement(modelObj: ModelObject, isActive: boolean, index = 0): HTMLElement {
  const row = document.createElement('div');
  row.className = `model-data-row${isActive ? ' active-model-row' : ''}`;
  row.dataset.modelId = (modelObj.id || '').trim().toLowerCase();
  row.dataset.reasoning = modelObj.reasoning || 'None';
  row.setAttribute('role', 'row');
  row.setAttribute('aria-selected', isActive ? 'true' : 'false');
  row.setAttribute('aria-checked', isActive ? 'true' : 'false');
  row.setAttribute('tabindex', '0');
  
  const isFree = (modelObj.id || '').toLowerCase().includes('free');
  const formattedCtx = formatTokensShort(modelObj.contextWindow);
  const safeId = (modelObj.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const selectId = `model-reasoning-${safeId}-${index}`;

  const supportsReasoning = isReasoningSupportedModel(modelObj);
  const curReasoning = (modelObj.reasoning || 'None').trim();
  const curReasoningLower = curReasoning.toLowerCase();
  const isReasoningActive = curReasoningLower !== 'none' && curReasoningLower !== '';

  const fullId = (modelObj.id || '').trim();
  let providerPrefix = '';
  let modelName = fullId;
  const slashIdx = fullId.indexOf('/');
  if (slashIdx !== -1) {
    providerPrefix = fullId.substring(0, slashIdx + 1);
    modelName = fullId.substring(slashIdx + 1);
  }

  const isManualNew = !fullId;
  const activeBadgeLabel = escapeHTML(t('settings.activeBadge'));
  const setActiveLabel = escapeHTML(t('settings.setActiveBadge'));
  const removeRowLabel = escapeHTML(t('settings.removeModelRow') || 'Remove Model Row');
  const reasoningNotSupportedLabel = escapeHTML(t('settings.reasoningNotSupported'));
  const modelIdTitle = escapeHTML(t('settings.thModelId') || 'Model Identifier');
  const modelIdPlaceholder = escapeHTML(t('settings.modelIdentifierPlaceholder') || 'e.g. gpt-4o-mini');
  const exactCtxTokens = formatLocalizedNumber
    ? formatLocalizedNumber(Number(modelObj.contextWindow || 0), getLanguage(), 0)
    : Number(modelObj.contextWindow || 0).toLocaleString();
  const ctxTooltip = escapeHTML(
    t('settings.contextTokensTooltip', { formatted: formattedCtx, exact: exactCtxTokens }) ||
      `Context tokens: ${formattedCtx} (${exactCtxTokens})`
  );

  row.innerHTML = `
    <div class="td-cell td-active" role="cell">
      ${isActive ? `
        <div class="model-active-badge is-active" title="${activeBadgeLabel}">
          <span class="active-dot"></span>
          <span class="badge-text">${activeBadgeLabel}</span>
        </div>
      ` : `
        <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${setActiveLabel}" aria-label="${setActiveLabel}">
          <span class="radio-circle"></span>
        </button>
      `}
    </div>
    <div class="td-cell td-id" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-id-input" value="" placeholder="${modelIdPlaceholder}" title="${modelIdTitle}" aria-label="${modelIdTitle}" />
      ` : `
        <div class="model-id-wrapper" dir="ltr">
          <div class="model-id-display" title="${escapeHTML(fullId)}">${providerPrefix ? `<span class="model-id-prefix">${escapeHTML(providerPrefix)}</span>` : ''}<span class="model-id-name">${escapeHTML(modelName)}</span></div>
          ${isFree ? '<span class="model-tag-free">FREE</span>' : ''}
        </div>
      `}
    </div>
    <div class="td-cell td-ctx" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-ctx-input" value="${formattedCtx}" data-raw-tokens="${modelObj.contextWindow}" placeholder="128K" title="${ctxTooltip}" aria-label="${ctxTooltip}" />
      ` : `
        <span class="model-ctx-value" title="${ctxTooltip}">${formattedCtx}</span>
      `}
    </div>
    <div class="td-cell td-reasoning" role="cell">
      ${supportsReasoning ? `
        <select id="${selectId}" class="select-control model-reasoning-select${isReasoningActive ? ' reasoning-active' : ''}" aria-label="${escapeHTML(t('settings.thReasoning') || 'Reasoning')}">
          <option value="None" ${curReasoningLower === 'none' ? 'selected' : ''}>None</option>
          <option value="Minimal" ${curReasoningLower === 'minimal' ? 'selected' : ''}>Minimal</option>
          <option value="Low" ${curReasoningLower === 'low' ? 'selected' : ''}>Low</option>
          <option value="Medium" ${curReasoningLower === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="High" ${curReasoningLower === 'high' ? 'selected' : ''}>High</option>
          <option value="XHigh" ${curReasoningLower === 'xhigh' ? 'selected' : ''}>XHigh</option>
          <option value="Max" ${curReasoningLower === 'max' ? 'selected' : ''}>Max</option>
          <option value="Ultra" ${curReasoningLower === 'ultra' ? 'selected' : ''}>Ultra</option>
        </select>
      ` : `
        <span class="reasoning-none-dash" title="${reasoningNotSupportedLabel}" aria-label="${reasoningNotSupportedLabel}">—</span>
      `}
    </div>
    <div class="td-cell td-action" role="cell">
      ${isActive ? '' : `
        <button type="button" class="model-btn-trash" title="${removeRowLabel}" aria-label="${removeRowLabel}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `}
    </div>
  `;

  const isRowActive = (): boolean => {
    const settings = getSettingsState();
    const activeId = (settings && settings.translateAiModel) || '';
    if ((activeId || '').trim()) return isModelIdMatch(modelObj.id, activeId);
    return row.classList.contains('active-model-row');
  };

  const handleActivate = () => {
    if (!modelObj.id || !modelObj.id.trim()) {
      notify(t('toasts.noModelIdError'), 'info');
      return;
    }
    if (!isRowActive()) {
      setActiveModelFromTable(modelObj.id.trim());
    }
  };

  const findLiveModelIndex = (): number => {
    const directIdx = currentProviderModels.indexOf(modelObj);
    if (directIdx !== -1) return directIdx;
    const trimmed = (modelObj.id || '').trim();
    return trimmed ? currentProviderModels.findIndex(m => isModelIdMatch(m.id, trimmed)) : -1;
  };

  row.addEventListener('click', (e: MouseEvent) => {
    const trashBtn = (e.target as HTMLElement).closest('.model-btn-trash');
    if (trashBtn) {
      e.stopPropagation();
      if (isRowActive()) {
        notify(t('toasts.cannotDeleteActiveModel'), "info");
        return;
      }
      const idx = findLiveModelIndex();
      if (idx !== -1) {
        currentProviderModels.splice(idx, 1);
      }
      updateFilterCounts();
      saveActiveProviderModelsDebounced();
      applyModelsFilterAndRender(0);
      return;
    }

    if (
      (e.target as HTMLElement).closest('.model-reasoning-select') ||
      (e.target as HTMLElement).closest('.custom-select-container') ||
      (e.target as HTMLElement).closest('input') ||
      (e.target as HTMLElement).closest('.reasoning-none-dash') ||
      (e.target as HTMLElement).closest('.model-id-display') ||
      (e.target as HTMLElement).closest('.model-ctx-value')
    ) {
      return;
    }
    handleActivate();
  });

  row.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleActivate();
    }
  });

  const radioBtn = row.querySelector('.model-radio-btn');
  if (radioBtn) {
    radioBtn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      handleActivate();
    });
  }

  const reasoningSelect = row.querySelector('.model-reasoning-select') as HTMLSelectElement | null;
  if (reasoningSelect) {
    reasoningSelect.addEventListener('change', (e: Event) => {
      e.stopPropagation();
      modelObj.reasoning = reasoningSelect.value;
      row.dataset.reasoning = reasoningSelect.value;
      if (typeof modelObj.supportsReasoning !== 'boolean') {
        modelObj.supportsReasoning = true;
      }
      const cs = window.customSelectsMap && (window.customSelectsMap.get(reasoningSelect.id) || window.customSelectsMap.get(reasoningSelect));
      const container = (cs && cs.container) || (reasoningSelect.nextElementSibling && reasoningSelect.nextElementSibling.classList.contains('custom-select-container') ? reasoningSelect.nextElementSibling : reasoningSelect.closest('.custom-select-container'));
      if (container) {
        if (reasoningSelect.value.toLowerCase() === 'none') {
          container.classList.remove('reasoning-active');
        } else {
          container.classList.add('reasoning-active');
        }
      }
      updateFilterCounts();
      saveActiveProviderModelsDebounced();
      if (currentModelStatusFilter === 'reasoning') {
        applyModelsFilterAndRender(0);
      }
    });
  }

  const idDisplay = row.querySelector('.model-id-display');
  if (idDisplay) {
    idDisplay.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'model-cell-input model-id-input';
      input.value = modelObj.id || '';
      input.style.direction = 'ltr';
      input.style.textAlign = 'left';
      input.addEventListener('click', ev => ev.stopPropagation());

      let discarded = false;
      const onBlur = () => {
        if (discarded) return;
        commit();
      };
      const cancel = () => {
        discarded = true;
        input.removeEventListener('blur', onBlur);
        applyModelsFilterAndRender(0);
      };
      const commit = () => {
        if (discarded) return;
        discarded = true;
        input.removeEventListener('blur', onBlur);
        const val = input.value.trim();
        if (val && val !== modelObj.id) {
          if (hasDuplicateModelId(currentProviderModels, val, modelObj)) {
            notify(t('toasts.modelIdExists', { id: val }), 'info');
            applyModelsFilterAndRender(0);
            return;
          }
          const wasRowActive = isRowActive();
          modelObj.id = val;
          row.dataset.modelId = normalizeModelId(val);
          if (wasRowActive) {
            const settings = getSettingsState();
            if (settings) {
              settings.translateAiModel = val;
              updateActiveModelBannerUI(val);
            }
          }
          updateFilterCounts();
          saveActiveProviderModelsDebounced();
        }
        applyModelsFilterAndRender(0);
      };

      input.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', onBlur);
      idDisplay.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  const ctxValue = row.querySelector('.model-ctx-value');
  if (ctxValue) {
    ctxValue.addEventListener('dblclick', (e: MouseEvent) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'model-cell-input model-ctx-input';
      input.value = formattedCtx;
      input.style.maxWidth = '80px';
      input.style.margin = '0 auto';
      input.addEventListener('click', ev => ev.stopPropagation());

      let discarded = false;
      const onBlur = () => {
        if (discarded) return;
        commit();
      };
      const cancel = () => {
        discarded = true;
        input.removeEventListener('blur', onBlur);
        applyModelsFilterAndRender(0);
      };
      const commit = () => {
        if (discarded) return;
        discarded = true;
        input.removeEventListener('blur', onBlur);
        const rawTokens = parseTokensInput(input.value);
        if (rawTokens !== modelObj.contextWindow) {
          modelObj.contextWindow = rawTokens;
          saveActiveProviderModelsDebounced();
        }
        applyModelsFilterAndRender(0);
      };

      input.addEventListener('keydown', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', onBlur);
      ctxValue.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  const scheduleEmptyManualRowCleanup = () => {
    setTimeout(() => {
      if (!row.contains(document.activeElement)) {
        const idx = currentProviderModels.indexOf(modelObj);
        if (idx !== -1 && (!modelObj.id || !modelObj.id.trim())) {
          currentProviderModels.splice(idx, 1);
          updateFilterCounts();
        }
        applyModelsFilterAndRender(0);
      }
    }, 120);
  };

  const idInput = row.querySelector('.model-id-input') as HTMLInputElement | null;
  if (idInput) {
    idInput.addEventListener('click', e => e.stopPropagation());
    idInput.addEventListener('input', () => {
      const val = idInput.value.trim();
      modelObj.id = val;
      row.dataset.modelId = normalizeModelId(val);
    });
    idInput.addEventListener('blur', () => {
      const val = idInput.value.trim();
      if (val) {
        if (hasDuplicateModelId(currentProviderModels, val, modelObj)) {
          notify(t('toasts.modelIdExists', { id: val }), 'info');
          const idx = currentProviderModels.indexOf(modelObj);
          if (idx !== -1) {
            currentProviderModels.splice(idx, 1);
          }
          updateFilterCounts();
          applyModelsFilterAndRender(0);
          return;
        }
        updateFilterCounts();
        saveActiveProviderModelsDebounced();
        setTimeout(() => {
          if (!row.contains(document.activeElement)) {
            applyModelsFilterAndRender(0);
          }
        }, 120);
      } else {
        scheduleEmptyManualRowCleanup();
      }
    });
    idInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        idInput.blur();
      }
    });
  }

  const ctxInput = row.querySelector('.model-ctx-input') as HTMLInputElement | null;
  if (ctxInput) {
    ctxInput.addEventListener('click', e => e.stopPropagation());
    ctxInput.addEventListener('change', () => {
      const rawTokens = parseTokensInput(ctxInput.value);
      modelObj.contextWindow = rawTokens;
      saveActiveProviderModelsDebounced();
    });
    ctxInput.addEventListener('blur', () => {
      scheduleEmptyManualRowCleanup();
    });
    ctxInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        ctxInput.blur();
      }
    });
  }

  const handleKeyNavigation = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      const next = row.nextElementSibling as HTMLElement | null;
      if (next && next.classList.contains('model-data-row')) {
        e.preventDefault();
        const target = (next.querySelector('.model-cell-input') as HTMLElement) || next;
        target.focus();
      }
    } else if (e.key === 'ArrowUp') {
      const prev = row.previousElementSibling as HTMLElement | null;
      if (prev && prev.classList.contains('model-data-row')) {
        e.preventDefault();
        const target = (prev.querySelector('.model-cell-input') as HTMLElement) || prev;
        target.focus();
      }
    }
  };

  row.addEventListener('keydown', handleKeyNavigation);

  return row;
}

export function addManualModelRow(
  modelId = "",
  contextWindow = 200000,
  reasoning = "None",
  isActive = false,
  focus = false,
  supportsReasoning = true
): void {
  const newModel: ModelObject = {
    id: modelId,
    contextWindow: parseTokensInput(contextWindow),
    reasoning: reasoning || 'None',
    supportsReasoning: typeof supportsReasoning === 'boolean' ? supportsReasoning : true,
    enabled: true
  };
  currentProviderModels.unshift(newModel);
  if (isActive && modelId) {
    const settings = getSettingsState();
    if (settings) settings.translateAiModel = modelId;
  }
  currentModelsPage = 1;
  currentModelStatusFilter = 'all';
  updateFilterCounts();
  applyModelsFilterAndRender(0);
  
  if (focus && typeof document !== 'undefined') {
    setTimeout(() => {
      const firstInput = document.querySelector('#mgr-models-tbody .model-id-input') as HTMLInputElement | null;
      if (firstInput) {
        firstInput.focus();
      }
    }, 50);
  }
}

let modelsFetchSeq = 0;

export async function fetchActiveProviderModels(): Promise<void> {
  if (typeof document === 'undefined') return;
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  
  const settingsState = getSettingsState();
  const providers = readProvidersSafe(settingsState);
  
  const provider = providers.find(p => p.name === providerName);
  if (!provider) return;
  
  const urlEl = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
  const fmtEl = document.getElementById('mgr-provider-format') as HTMLSelectElement | null;
  const keyEl = document.getElementById('mgr-provider-key') as HTMLInputElement | null;

  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiFormat = fmtEl ? fmtEl.value : 'Chat completions';
  let apiKey = keyEl ? keyEl.value.trim() : '';
  
  if (!baseUrl) {
    notify(t('toasts.baseUrlRequiredFetch'), "info");
    return;
  }
  
  const btn = document.getElementById('mgr-btn-fetch-models') as HTMLButtonElement | null;
  if (!btn) return;
  if (btn.dataset && btn.dataset.originalHtml === undefined && !modelsFetchActiveProvider) {
    btn.dataset.originalHtml = btn.innerHTML;
  }
  const originalHtml = (btn.dataset && btn.dataset.originalHtml !== undefined) ? btn.dataset.originalHtml : btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
    <span>${t('common.loading')}</span>
  `;
  
  const fetchSeq = ++modelsFetchSeq;
  modelsFetchActiveProvider = providerName;

  if ((!apiKey || apiKey === '••••••••••••••••') && (provider.useKeyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__')) {
    try {
      apiKey = await invoke('get_keyring_credential', { providerName });
    } catch (e) {
      notify(t('toasts.keyringLoadError', { error: String(e) }), "error");
      if (fetchSeq === modelsFetchSeq) {
        modelsFetchActiveProvider = null;
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
      return;
    }
  }
  
  try {
    const modelsList = await invoke('fetch_provider_models', { baseUrl, apiKey, apiFormat });
    
    const existingMap = new Map<string, any>();
    if (provider && Array.isArray(provider.models)) {
      provider.models.forEach(pm => {
        if (pm && pm.id) existingMap.set(pm.id, pm);
      });
    }

    const fetchedModels: ModelObject[] = modelsList.map((m: any) => {
      const modelId = String((m && typeof m === 'object') ? m.id : m);
      const modelCtx = (m && typeof m === 'object') ? (m.contextWindow || m.context_window || 200000) : 200000;
      const isReasoning = isReasoningSupportedModel(m);
      const existing = existingMap.get(modelId);

      let reasoning = isReasoning ? 'Medium' : 'None';
      let enabled = true;
      if (existing) {
        if (isReasoning) {
          reasoning = (existing.reasoning && existing.reasoning.toLowerCase() !== 'none')
            ? existing.reasoning
            : 'None';
        } else {
          reasoning = 'None';
        }
        if (typeof existing.enabled === 'boolean') {
          enabled = existing.enabled;
        }
      }
      return normalizeProviderModel(
        (m && typeof m === 'object') ? { ...m, contextWindow: modelCtx } : { id: modelId, contextWindow: modelCtx },
        {
          idOverride: modelId,
          reasoningOverride: reasoning,
          supportsReasoningOverride: isReasoning,
          enabledOverride: enabled,
          fallbackModel: existing
        }
      );
    });

    const liveSettings = getSettingsState();
    const activeProviderName = (liveSettings && liveSettings.translateAiProvider) || '';
    if (fetchSeq !== modelsFetchSeq && activeProviderName === providerName) {
      return;
    }

    let persistedForTarget = false;
    if (activeProviderName === providerName) {
      currentProviderModels = fetchedModels;
      currentModelsProviderName = providerName;
      const currentActive = liveSettings ? liveSettings.translateAiModel : '';
      if (!currentActive && currentProviderModels.length > 0 && liveSettings) {
        liveSettings.translateAiModel = currentProviderModels[0].id;
      }

      currentModelsPage = 1;
      currentModelsSortCol = null;
      currentModelsSortDir = 'none';
      updateFilterCounts();
      await saveActiveProviderModels(true, false, providerName);
      persistedForTarget = true;
    } else if (liveSettings) {
      // User switched providers mid-fetch: persist models onto the target provider
      // without clobbering the newly selected provider's active state or UI table.
      const latestProviders = readProvidersSafe(liveSettings);
      const targetIdx = latestProviders.findIndex(p => p.name === providerName);
      if (targetIdx !== -1) {
        latestProviders[targetIdx] = {
          ...latestProviders[targetIdx],
          models: normalizeProviderModelsList(fetchedModels)
        };
        writeProviders(liveSettings, latestProviders);
        await saveSettings(true);
        persistedForTarget = true;
      }
    }
    if (persistedForTarget) {
      notify(t('toasts.modelsFetchedSuccess', { count: modelsList.length }), "success");
    }
  } catch (e) {
    notify(t('toasts.modelsFetchError', { error: String(e) }), "error");
  } finally {
    if (fetchSeq === modelsFetchSeq) {
      modelsFetchActiveProvider = null;
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

export async function saveActiveProviderModels(
  keepCurrentTab = false,
  skipTableRender = false,
  targetProviderName: string | null = null
): Promise<void> {
  const settingsState = getSettingsState();
  const providerName = targetProviderName || (settingsState ? settingsState.translateAiProvider : '');
  const providers = readProvidersSafe(settingsState);
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const validModels = normalizeProviderModelsList(currentProviderModels);

  const isCurrentActiveProvider = providerName === (settingsState ? settingsState.translateAiProvider : '');
  if (isCurrentActiveProvider) {
    currentProviderModels = dedupeLiveModels(currentProviderModels);
  }

  provider.models = validModels;
  providers[providerIdx] = provider;
  writeProviders(settingsState, providers);

  if (isCurrentActiveProvider && settingsState) {
    const selectDOM = typeof document !== 'undefined'
      ? (document.getElementById('opt-translateAiModel') as HTMLSelectElement | null)
      : null;
    syncProviderModelDropdownOptions(selectDOM, validModels, settingsState);
  }
  
  await saveSettings();
  if (isCurrentActiveProvider) {
    triggerUpdateTranscribeUI();
    if (window.translationStudioController) {
      window.translationStudioController.refreshModelOptions();
    }
    if (!skipTableRender) {
      applyModelsFilterAndRender(0);
    }
  }
}

export function filterModelsTable(delay = 150): void {
  currentModelsPage = 1;
  applyModelsFilterAndRender(delay);
}

export function filterModelsStatus(status: string, delay = 0): void {
  currentModelStatusFilter = status;
  
  if (typeof document !== 'undefined') {
    const pillsContainer = document.getElementById('models-filter-pills') || document.querySelector('.models-filter-pills');
    if (pillsContainer) {
      pillsContainer.querySelectorAll('.btn-filter').forEach(btn => {
        const hBtn = btn as HTMLElement;
        if (hBtn.dataset.filter === status || hBtn.id === `filter-models-${status}`) {
          hBtn.classList.add('active');
        } else {
          hBtn.classList.remove('active');
        }
      });
    }
    
    const container = document.getElementById('mgr-models-tbody');
    if (container) {
      container.scrollTop = 0;
    }
  }
  
  currentModelsPage = 1;
  applyModelsFilterAndRender(delay);
}

// ----------------- Add Provider Modal -----------------
export function openAddProviderModal(): void {
  if (typeof document === 'undefined') return;
  if (providerModalCloseTimer !== null) {
    clearTimeout(providerModalCloseTimer);
    providerModalCloseTimer = null;
  }
  if (_providerModalTrap) {
    _providerModalTrap.release();
    _providerModalTrap = null;
  }
  const nameEl = document.getElementById('provider-name') as HTMLInputElement | null;
  const fmtEl = document.getElementById('provider-format') as HTMLSelectElement | null;
  const urlEl = document.getElementById('provider-url') as HTMLInputElement | null;
  const keyEl = document.getElementById('provider-key') as HTMLInputElement | null;
  const keyringEl = document.getElementById('provider-use-keyring') as HTMLInputElement | null;

  if (nameEl) nameEl.value = '';
  if (fmtEl) {
    fmtEl.value = 'Chat completions';
    const win = getGlobal();
    const fmtCs = win?.customSelectsMap?.get?.('provider-format') || customSelectsMap.get('provider-format');
    if (fmtCs && typeof fmtCs.syncSelectedValue === 'function') {
      fmtCs.syncSelectedValue(true);
    }
  }
  if (urlEl) urlEl.value = '';
  if (keyEl) {
    keyEl.value = '';
    const keyToggleBtn = keyEl.nextElementSibling as HTMLElement | null;
    setPasswordFieldMasked(keyEl, keyToggleBtn);
  }
  if (keyringEl) keyringEl.checked = true;
  
  const modal = document.getElementById('translation-provider-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('show'), 10);

  _providerModalTrap = _trapModalFocus(modal, closeProviderModal);

  requestAnimationFrame(() => {
    if (nameEl) nameEl.focus();
  });
}

export function closeProviderModal(): void {
  if (_providerModalTrap) {
    _providerModalTrap.release();
    _providerModalTrap = null;
  }
  if (providerModalCloseTimer !== null) {
    clearTimeout(providerModalCloseTimer);
    providerModalCloseTimer = null;
  }
  if (typeof document !== 'undefined') {
    const modal = document.getElementById('translation-provider-modal');
    if (modal) {
      modal.classList.remove('show');
      providerModalCloseTimer = setTimeout(() => {
        providerModalCloseTimer = null;
        if (!modal.classList.contains('show')) {
          modal.style.display = 'none';
        }
      }, 300);
    }
  }
}

export async function saveProviderConfig(): Promise<void> {
  if (typeof document === 'undefined' || isSavingProviderConfig) return;
  const nameEl = document.getElementById('provider-name') as HTMLInputElement | null;
  const urlEl = document.getElementById('provider-url') as HTMLInputElement | null;
  const fmtEl = document.getElementById('provider-format') as HTMLSelectElement | null;
  const keyEl = document.getElementById('provider-key') as HTMLInputElement | null;
  const keyringEl = document.getElementById('provider-use-keyring') as HTMLInputElement | null;
  const saveBtn = document.getElementById('provider-modal-save-btn') as HTMLButtonElement | null;

  const name = nameEl ? nameEl.value.trim() : '';
  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiFormat = fmtEl ? fmtEl.value : 'Chat completions';
  const key = keyEl ? keyEl.value.trim() : '';
  const preferKeyring = keyringEl ? keyringEl.checked : true;
  
  if (!name || !baseUrl) {
    notify(t('toasts.nameAndUrlRequired'), "info");
    return;
  }

  const settingsState = getSettingsState();
  const initialProviders = readProvidersSafe(settingsState);
  
  if (initialProviders.some(p => p.name === name)) {
    notify(t('toasts.providerNameExists', { name }), "error");
    return;
  }

  isSavingProviderConfig = true;
  if (saveBtn) saveBtn.disabled = true;

  try {
    let keyToSave = key;
    let useKeyring = false;
    
    if (key && preferKeyring) {
      try {
        await invoke('store_keyring_credential', { providerName: name, key });
        keyToSave = '__KEYRING__';
        useKeyring = true;
      } catch (e) {
        console.warn("Failed to store API Key in system keyring:", e);
        keyToSave = key;
        useKeyring = false;
      }
    }

    const latestProviders = readProvidersSafe(settingsState);
    if (latestProviders.some(p => p.name === name)) {
      notify(t('toasts.providerNameExists', { name }), "error");
      return;
    }
    
    const providerData: ProviderConfig = {
      name,
      baseUrl: baseUrl,
      apiKey: keyToSave,
      apiFormat: apiFormat,
      useKeyring: useKeyring,
      models: [],
      customPrompt: ""
    };
    
    latestProviders.push(providerData);
    if (settingsState) {
      writeProviders(settingsState, latestProviders);
      settingsState.translateAiProvider = name;
    }
    
    await saveSettings(true);
    populateProvidersDropdown();
    onProviderChanged('general');
    closeProviderModal();
    
    notify(t('toasts.providerAddedSuccess'), "success");
  } finally {
    isSavingProviderConfig = false;
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ----------------- Batch Error Dialog (Delegated to appModal) -----------------
export { showBatchErrorDialog };

// ----------------- Event Listeners Setup -----------------
export function setupTranslationEventListeners(): void {
  if (typeof document === 'undefined') return;
  const urlInput = document.getElementById('mgr-provider-url');
  const formatSelect = document.getElementById('mgr-provider-format');
  const keyInput = document.getElementById('mgr-provider-key');
  const promptTextarea = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;
  const keyringChk = document.getElementById('mgr-provider-use-keyring');
  
  const markDirty = () => {
    hasDirtyProviderGeneral = true;
    const win = getGlobal();
    if (typeof win.markSettingsDirty === 'function') {
      win.markSettingsDirty();
    }
  };

  const triggerAutoSave = () => {
    void saveActiveProviderGeneral(true);
  };
  
  if (urlInput) {
    urlInput.addEventListener('input', markDirty);
    urlInput.addEventListener('change', triggerAutoSave);
  }
  if (formatSelect) formatSelect.addEventListener('change', triggerAutoSave);
  if (keyInput) {
    keyInput.addEventListener('input', markDirty);
    keyInput.addEventListener('change', triggerAutoSave);
  }
  if (keyringChk) {
    keyringChk.addEventListener('change', triggerAutoSave);
  }
  if (promptTextarea) {
    applyDynamicDir(promptTextarea);
    promptTextarea.addEventListener('input', () => {
      applyDynamicDir(promptTextarea);
      markDirty();
    });
    promptTextarea.addEventListener('change', triggerAutoSave);
  }

  const addCustomModelBtn = document.getElementById('mgr-btn-add-custom-model');
  if (addCustomModelBtn) {
    addCustomModelBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('mgr-models-search') as HTMLInputElement | null;
      if (searchInput && searchInput.value) {
        clearModelsSearch();
      }
      addManualModelRow("", 200000, "None", false, true);
      const container = document.getElementById('mgr-models-tbody');
      if (container) container.scrollTop = 0;
    });
  }
}

// ----------------- Test Connection Modal -----------------
export function handleTestModalBackdropClick(event: any): void {
  if (event.target && event.target.id === 'translation-test-modal') {
    abortAndCloseTestModal();
  }
}

function releaseTestModalTrap(): void {
  if (_testModalTrap) {
    _testModalTrap.release();
    _testModalTrap = null;
  }
}

export async function abortAndCloseTestModal(): Promise<void> {
  releaseTestModalTrap();
  if (isPreviewTesting) {
    isPreviewTesting = false;
    previewTestId++;
    try {
      await invoke('cancel_preview_translate');
    } catch (e) {
      console.warn("Failed to cancel preview translate backend:", e);
    }
    if (typeof document !== 'undefined') {
      const testBtn = document.getElementById('mgr-btn-test-connection') as HTMLButtonElement | null;
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = testBtn.dataset.originalText || t('settings.testConnBtn') || 'Test Connection';
      }
    }
    notify(t('toasts.testCancelled'), "info");
  }
  if (typeof document !== 'undefined') {
    const modal = document.getElementById('translation-test-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        if (!modal.classList.contains('show')) {
          modal.style.display = 'none';
        }
      }, 300);
    }
  }
}

export function closeTestModal(): void {
  if (isPreviewTesting) {
    abortAndCloseTestModal();
    return;
  }
  releaseTestModalTrap();
  if (typeof document !== 'undefined') {
    const modal = document.getElementById('translation-test-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => {
        if (!modal.classList.contains('show')) {
          modal.style.display = 'none';
        }
      }, 300);
    }
    const testBtn = document.getElementById('mgr-btn-test-connection') as HTMLButtonElement | null;
    if (testBtn && !isPreviewTesting) {
      testBtn.disabled = false;
      testBtn.textContent = testBtn.dataset.originalText || t('settings.testConnBtn') || 'Test Connection';
    }
  }
}

function renderPreviewTranslationResult(resultEl: HTMLElement | null, response: any): void {
  if (!resultEl) return;
  resultEl.innerHTML = '';

  const currentLang = getLanguage();
  const uiIsRtl = isRtlLanguage(currentLang);

  if (Array.isArray(response) && response.length > 0) {
    const container = document.createElement('div');
    container.className = 'test-preview-container';

    const origLabelText = t('modals.previewOriginal') || 'Original';
    const transLabelText = t('modals.previewTranslated') || 'Translated';
    const notTransText = t('modals.previewNotTranslated') || 'not translated';

    response.forEach((item: any) => {
      const entryEl = document.createElement('div');
      entryEl.className = 'test-preview-entry';

      const origField = document.createElement('div');
      origField.className = 'test-preview-field';

      const origLabel = document.createElement('div');
      origLabel.className = 'test-preview-label original';
      origLabel.setAttribute('dir', uiIsRtl ? 'rtl' : 'ltr');
      const localizedIndex = formatLocalizedNumber(item.index, currentLang, 0) || item.index;
      origLabel.textContent = `${origLabelText} (${localizedIndex}):`;

      const origText = document.createElement('div');
      origText.className = 'test-preview-text';
      const origDir = firstStrongDirection(item.original) || (uiIsRtl ? 'rtl' : 'ltr');
      origText.setAttribute('dir', origDir);
      origText.textContent = item.original;

      origField.appendChild(origLabel);
      origField.appendChild(origText);
      entryEl.appendChild(origField);

      const transField = document.createElement('div');
      transField.className = 'test-preview-field';

      const transLabel = document.createElement('div');
      transLabel.className = 'test-preview-label translated';
      transLabel.setAttribute('dir', uiIsRtl ? 'rtl' : 'ltr');
      transLabel.textContent = `${transLabelText}:`;

      if (item.is_fallback) {
        const fallbackBadge = document.createElement('span');
        fallbackBadge.className = 'test-preview-badge-fallback';
        fallbackBadge.textContent = `(${notTransText})`;
        transLabel.appendChild(fallbackBadge);
      }

      const transText = document.createElement('div');
      transText.className = 'test-preview-text';
      const transDir = firstStrongDirection(item.translated) || (uiIsRtl ? 'rtl' : 'ltr');
      transText.setAttribute('dir', transDir);
      transText.textContent = item.translated;

      transField.appendChild(transLabel);
      transField.appendChild(transText);
      entryEl.appendChild(transField);

      container.appendChild(entryEl);
    });

    resultEl.appendChild(container);
  } else if (typeof response === 'string') {
    const textEl = document.createElement('div');
    textEl.className = 'test-preview-text';
    const dir = firstStrongDirection(response) || (uiIsRtl ? 'rtl' : 'ltr');
    textEl.setAttribute('dir', dir);
    textEl.textContent = response;
    resultEl.appendChild(textEl);
  } else {
    resultEl.textContent = JSON.stringify(response, null, 2);
  }
}

export async function testTranslationConnection(): Promise<void> {
  if (typeof document === 'undefined') return;
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) {
    notify(t('toasts.noProviderToTest'), "info");
    return;
  }
  
  const testBtn = document.getElementById('mgr-btn-test-connection') as HTMLButtonElement | null;
  if (!testBtn) return;
  const originalText = t('settings.testConnBtn') || testBtn.textContent || 'Test Connection';
  testBtn.dataset.originalText = originalText;
  testBtn.disabled = true;
  testBtn.textContent = t('modals.testingBtn');
  
  let savedOk = false;
  try {
    savedOk = await saveActiveProviderGeneral(true);
  } catch (e) {
    console.warn("Failed to silently save provider configuration before test:", e);
  }
  if (!savedOk) {
    const urlEl = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
    if (!urlEl || !urlEl.value.trim()) {
      notify(t('toasts.baseUrlRequired'), "info");
    }
    testBtn.disabled = false;
    testBtn.textContent = originalText;
    return;
  }

  const settingsState = getSettingsState();
  if (settingsState) {
    settingsState.translateAiProvider = providerName;
  }

  const providers = readProvidersSafe(settingsState);
  const p = providers.find(item => item.name === providerName);
  const models = (p && Array.isArray(p.models)) ? p.models : [];
  if (settingsState) {
    const modelBelongsToProvider = models.some(m => isModelIdMatch(m.id, settingsState.translateAiModel));
    if (!modelBelongsToProvider && models.length > 0) {
      const enabledModel = models.find(m => m.enabled !== false) || models[0];
      if (enabledModel) {
        settingsState.translateAiModel = enabledModel.id;
      }
    }
  }
  
  const testSrt = `1\n00:00:01,000 --> 00:00:05,000\nHello, this is a test of the AI translation system connection.`;
  
  const testModal = document.getElementById('translation-test-modal') as HTMLElement | null;
  const statusEl = document.getElementById('test-modal-status') as HTMLElement | null;
  const resultEl = document.getElementById('test-modal-result') as HTMLElement | null;
  const cancelBtn = document.getElementById('test-modal-cancel-btn') as HTMLElement | null;
  const okBtn = document.getElementById('test-modal-ok-btn') as HTMLElement | null;
  
  if (!testModal || !statusEl || !resultEl) {
    testBtn.disabled = false;
    testBtn.textContent = originalText;
    return;
  }

  statusEl.textContent = t('modals.testingConnection');
  statusEl.style.color = 'var(--color-cyan)';
  resultEl.innerHTML = '';
  const waitingEl = document.createElement('div');
  waitingEl.className = 'test-preview-waiting';
  waitingEl.setAttribute('dir', isRtlLanguage(getLanguage()) ? 'rtl' : 'ltr');
  waitingEl.textContent = t('modals.waitingApiResponse');
  resultEl.appendChild(waitingEl);
  
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (okBtn) okBtn.style.display = 'none';

  releaseTestModalTrap();
  testModal.style.display = 'flex';
  setTimeout(() => testModal.classList.add('show'), 10);
  _testModalTrap = _trapModalFocus(testModal, abortAndCloseTestModal);
  if (cancelBtn) {
    requestAnimationFrame(() => cancelBtn.focus());
  }

  isPreviewTesting = true;
  const currentTestId = ++previewTestId;

  let timerId: any = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      invoke('cancel_preview_translate').catch(() => {});
      reject(new Error(t('modals.connectionTimeoutDesc', { seconds: 25 })));
    }, 26000);
  });

  try {
    const invokePromise = invoke('preview_translate_first_lines', {
      settings: settingsState,
      fileContent: testSrt
    });

    const response = await Promise.race([invokePromise, timeoutPromise]);
    if (timerId) clearTimeout(timerId);
    
    if (currentTestId !== previewTestId || !isPreviewTesting) return;

    statusEl.textContent = t('modals.connectionSuccess');
    statusEl.style.color = 'var(--color-green)';
    renderPreviewTranslationResult(resultEl, response);
  } catch (err: any) {
    if (timerId) clearTimeout(timerId);
    if (currentTestId !== previewTestId || !isPreviewTesting) return;

    const errStr = typeof err === 'string' ? err : (err && err.message ? err.message : String(err));
    const isTimeout = errStr.toLowerCase().includes('timeout') || errStr.toLowerCase().includes('timed out') || errStr.includes('تایم‌اوت');
    statusEl.textContent = isTimeout ? (t('modals.connectionTimeout') || t('modals.connectionFailed')) : t('modals.connectionFailed');
    statusEl.style.color = 'var(--color-red)';
    resultEl.innerHTML = '';
    const errDiv = document.createElement('div');
    errDiv.className = 'test-preview-error';
    errDiv.setAttribute('dir', firstStrongDirection(errStr) || (isRtlLanguage(getLanguage()) ? 'rtl' : 'ltr'));
    errDiv.textContent = errStr;
    resultEl.appendChild(errDiv);
  } finally {
    if (timerId) clearTimeout(timerId);
    if (currentTestId === previewTestId) {
      isPreviewTesting = false;
      testBtn.disabled = false;
      testBtn.textContent = originalText;
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (okBtn) {
        okBtn.style.display = 'inline-flex';
        okBtn.focus();
      }
    }
  }
}

export function toggleTranslationSubSettingsVisibility(): void {
  // Deprecated: UI visibility is permanently decoupled from the auto-translate after transcription toggle.
}

// ----------------- Synchronize Global Window Bindings -----------------
export function syncTranslationProvidersWindowBindings(): void {
  if (typeof window === 'undefined') return;

  window.populateProvidersDropdown = populateProvidersDropdown;
  window.renderProvidersGrid = renderProvidersGrid;
  window.onProviderChanged = onProviderChanged;
  window.togglePasswordVisibility = togglePasswordVisibility;
  window.switchProviderTab = switchProviderTab;
  window.saveActiveProviderGeneral = saveActiveProviderGeneral;
  window.deleteProviderByName = deleteProviderByName;
  window.deleteActiveProvider = deleteActiveProvider;
  window.toEnglishDigits = toEnglishDigits;
  window.formatTokensShort = formatTokensShort;
  window.parseTokensInput = parseTokensInput;
  window.formatNumberForLang = formatNumberForLang;
  window.isReasoningSupportedModel = isReasoningSupportedModel;
  window.changeModelsPageSize = changeModelsPageSize;
  window.updateFilterCounts = updateFilterCounts;
  window.updateFilterCountsFromDOM = updateFilterCounts;
  window.clearModelsSearch = clearModelsSearch;
  window.renderModelsRegistryTable = renderModelsRegistryTable;
  window.updateActiveModelBannerUI = updateActiveModelBannerUI;
  window.syncActiveModelSelectionUI = syncActiveModelSelectionUI;
  window.syncTranslationSettingsViewIfVisible = syncTranslationSettingsViewIfVisible;
  window.setActiveModelFromTable = setActiveModelFromTable;
  window.toggleSortModels = toggleSortModels;
  window.changeModelsPage = changeModelsPage;
  window.applyModelsFilterAndRender = applyModelsFilterAndRender;
  window.addManualModelRow = addManualModelRow;
  window.fetchActiveProviderModels = fetchActiveProviderModels;
  window.saveActiveProviderModels = saveActiveProviderModels;
  window.filterModelsTable = filterModelsTable;
  window.filterModelsStatus = filterModelsStatus;
  window.openAddProviderModal = openAddProviderModal;
  window.closeProviderModal = closeProviderModal;
  window.saveProviderConfig = saveProviderConfig;
  window.showBatchErrorDialog = showBatchErrorDialog;
  window.setupTranslationEventListeners = setupTranslationEventListeners;
  window.handleTestModalBackdropClick = handleTestModalBackdropClick;
  window.abortAndCloseTestModal = abortAndCloseTestModal;
  window.closeTestModal = closeTestModal;
  window.testTranslationConnection = testTranslationConnection;
  window.toggleTranslationSubSettingsVisibility = toggleTranslationSubSettingsVisibility;
  window.syncProviderModelsFromSettings = syncProviderModelsFromSettings;
  window.flushPendingModelCatalogChanges = flushPendingModelCatalogChanges;
  (window as any).flushPendingProviderGeneralChanges = flushPendingProviderGeneralChanges;
  (window as any).hasPendingProviderGeneralChanges = hasPendingProviderGeneralChanges;

  try {
    Object.defineProperty(window, 'currentProviderModels', {
      get: () => currentProviderModels,
      set: (val: any) => { currentProviderModels = Array.isArray(val) ? val : []; },
      configurable: true,
      enumerable: true
    });
  } catch (_) {
    (window as any).currentProviderModels = currentProviderModels;
  }
}

if (typeof window !== 'undefined') {
  syncTranslationProvidersWindowBindings();
}

export const translationProviders = {
  getModels: () => currentProviderModels,
  setModels: (models: ModelObject[]) => { currentProviderModels = Array.isArray(models) ? models : []; },
  getPage: () => currentModelsPage,
  setPage: (p: number) => { currentModelsPage = p; },
  getPageSize: () => currentModelsPageSize,
  setPageSize: (s: number | 'all') => { currentModelsPageSize = s; },
  getStatusFilter: () => currentModelStatusFilter,
  setStatusFilter: (f: string) => { currentModelStatusFilter = f; },
  getSortCol: () => currentModelsSortCol,
  getSortDir: () => currentModelsSortDir,
  populateDropdown: populateProvidersDropdown,
  renderGrid: renderProvidersGrid,
  onChanged: onProviderChanged,
  switchTab: switchProviderTab,
  saveGeneral: saveActiveProviderGeneral,
  hasPendingGeneralChanges: hasPendingProviderGeneralChanges,
  flushPendingProviderGeneralChanges,
  deleteByName: deleteProviderByName,
  deleteActive: deleteActiveProvider,
  renderModelsTable: renderModelsRegistryTable,
  fetchModels: fetchActiveProviderModels,
  saveModels: saveActiveProviderModels,
  setActiveModel: setActiveModelFromTable,
  testConnection: testTranslationConnection,
  setupEventListeners: setupTranslationEventListeners,
  syncModelsFromSettings: syncProviderModelsFromSettings,
  syncActiveModelSelectionUI,
  syncTranslationSettingsViewIfVisible,
  flushPendingModelCatalogChanges,
  syncWindowBindings: syncTranslationProvidersWindowBindings
};
