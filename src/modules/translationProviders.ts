// AI Translation Configuration, Providers Registry, & Models Management
import { t, isRtlLanguage, getLanguage, firstStrongDirection } from '../i18n/index';
import { escapeHTML } from './logsController';
import { CustomSelect, customSelectsMap } from './customSelect';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

export interface ModelObject {
  id: string;
  contextWindow?: number;
  context_window?: number;
  reasoning?: string;
  supportsReasoning?: boolean;
  supports_reasoning?: boolean;
  enabled?: boolean;
}

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  base_url?: string;
  apiFormat?: string;
  api_format?: string;
  apiKey?: string;
  api_key?: string;
  useKeyring?: boolean;
  use_keyring?: boolean;
  models?: ModelObject[];
  customPrompt?: string;
  custom_prompt?: string;
}

declare global {
  interface Window {
    populateProvidersDropdown: () => void;
    renderProvidersGrid: (providers?: ProviderConfig[] | null) => void;
    onProviderChanged: (keepCurrentTab?: boolean | string, skipTableRender?: boolean) => void;
    togglePasswordVisibility: (inputId: string, btn: HTMLElement) => Promise<void>;
    switchProviderTab: (tab: string) => void;
    saveActiveProviderGeneral: (silent?: boolean) => Promise<void>;
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
    translationStudioController?: any;
    settingsState: any;
    saveCurrentSettings: (immediate?: boolean) => any;
    showNotification: (msg: string, type: string) => void;
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

const getSettingsState = (): any => {
  const win = getGlobal();
  return win.settingsState || null;
};

const saveSettings = async (): Promise<void> => {
  const win = getGlobal();
  if (typeof win.saveCurrentSettings === 'function') {
    await win.saveCurrentSettings();
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

export function formatLocalizedNumber(num: any, lang = getLanguage(), maxFrac = 1): string {
  if (num === null || num === undefined || num === '' || isNaN(num)) return '';
  if (lang === 'fa') {
    return Number(num).toLocaleString('fa-IR', { maximumFractionDigits: maxFrac });
  }
  if (lang === 'ar') {
    return Number(num).toLocaleString('ar-SA', { maximumFractionDigits: maxFrac });
  }
  return Number(num).toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

import { _trapModalFocus } from './appModal';
export { _trapModalFocus };

// ----------------- State & Helpers -----------------
export const POPULAR_PROVIDER_FILTERS = [
  { id: 'openai', label: 'OpenAI', test: (id: string) => id.includes('openai') || id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') },
  { id: 'anthropic', label: 'Anthropic', test: (id: string) => id.includes('anthropic') || id.startsWith('claude') },
  { id: 'google', label: 'Google', test: (id: string) => id.includes('google') || id.startsWith('gemini') },
  { id: 'meta', label: 'Meta', test: (id: string) => id.includes('meta') || id.includes('llama') },
  { id: 'deepseek', label: 'DeepSeek', test: (id: string) => id.includes('deepseek') },
  { id: 'mistral', label: 'Mistral', test: (id: string) => id.includes('mistral') },
  { id: 'amazon', label: 'Amazon', test: (id: string) => id.includes('amazon') || id.startsWith('nova') },
  { id: 'qwen', label: 'Qwen', test: (id: string) => id.includes('qwen') }
];

let currentProviderModels: ModelObject[] = [];
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
let _batchErrorModalTrap: any = null;

export function toEnglishDigits(str: any): string {
  const persianMap: Record<string, string> = { '۰':'0', '۱':'1', '۲':'2', '۳':'3', '۴':'4', '۵':'5', '۶':'6', '۷':'7', '۸':'8', '۹':'9' };
  const arabicMap: Record<string, string> = { '٠':'0', '١':'1', '٢':'2', '٣':'3', '٤':'4', '٥':'5', '٦':'6', '٧':'7', '٨':'8', '٩':'9' };
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[۰-۹]/g, d => persianMap[d] || d).replace(/[٠-٩]/g, d => arabicMap[d] || d);
}

export function formatTokensShort(num: any): string {
  const n = parseInt(num, 10);
  if (isNaN(n) || n <= 0) return '0';
  
  if (n === 2097152 || n === 2000000) return '2M';
  if (n === 1048576 || n === 1000000) return '1M';
  if (n === 524288 || n === 512000) return '512K';
  if (n === 262144 || n === 256000) return '256K';
  if (n === 131072 || n === 128000) return '128K';
  if (n === 65536 || n === 64000) return '64K';
  if (n === 32768 || n === 32000) return '32K';
  if (n === 16384 || n === 16000) return '16K';
  if (n === 8192 || n === 8000) return '8K';
  if (n === 4096 || n === 4000) return '4K';
  
  if (n >= 1000000) {
    if (n % 1000000 === 0) return (n / 1000000) + 'M';
    if (n % 1048576 === 0) return (n / 1048576) + 'M';
    const val = n / 1000000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  
  if (n >= 1000) {
    if (n % 1000 === 0) return (n / 1000) + 'K';
    if (n % 1024 === 0) return (n / 1024) + 'K';
    const val = n / 1000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return n.toLocaleString();
}

export function parseTokensInput(val: any): number {
  if (typeof val === 'number') {
    return !isNaN(val) && val > 0 ? Math.round(val) : 200000;
  }
  if (!val) return 200000;
  const str = toEnglishDigits(String(val).trim().toUpperCase());
  
  const matchM = str.match(/^(\d+(?:\.\d+)?)\s*(?:M|MILLION)(?:\s*TOKENS?)?$/);
  if (matchM) {
    const num = parseFloat(matchM[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000000) : 200000;
  }

  const matchK = str.match(/^(\d+(?:\.\d+)?)\s*(?:K|THOUSAND)(?:\s*TOKENS?)?$/);
  if (matchK) {
    const num = parseFloat(matchK[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000) : 200000;
  }

  const matchNum = str.match(/^([\d,]+)(?:\s*TOKENS?)?$/);
  if (matchNum) {
    const cleaned = matchNum[1].replace(/,/g, '');
    const num = parseInt(cleaned, 10);
    return !isNaN(num) && num > 0 ? num : 200000;
  }

  return 200000;
}

export function formatNumberForLang(num: any): string {
  if (num === null || num === undefined) return '';
  const str = String(num);
  const resolveGetLang = () =>
    (typeof (window as any).getLanguage === 'function' ? (window as any).getLanguage() : null) ||
    (typeof (globalThis as any).getLanguage === 'function' ? (globalThis as any).getLanguage() : null) ||
    (typeof getLanguage === 'function' ? getLanguage() : 'en');
  const lang = resolveGetLang();
  if (lang === 'fa') {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return str.replace(/[0-9]/g, d => persianDigits[Number(d)]);
  }
  if (lang === 'ar') {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return str.replace(/[0-9]/g, d => arabicDigits[Number(d)]);
  }
  return str;
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
      try {
        const settings = getSettingsState();
        const providers = JSON.parse((settings && settings.translateAiProviders) || '[]');
        for (const p of providers) {
          if (Array.isArray(p.models)) {
            const m = p.models.find((mod: any) => mod && mod.id === modelObj);
            if (m) {
              found = m;
              break;
            }
          }
        }
      } catch (e) {}
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

function saveActiveProviderModelsDebounced(): void {
  const settings = getSettingsState();
  if (!settings) return;
  const currentProvider = settings.translateAiProvider;
  clearTimeout(modelSaveDebounceTimer);
  modelSaveDebounceTimer = setTimeout(() => {
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
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
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

export function renderProvidersGrid(providers: ProviderConfig[] | null = null): void {
  if (typeof document === 'undefined') return;
  const grid = document.getElementById('providers-tiles-grid');
  if (!grid) return;
  const settingsState = getSettingsState();
  if (providers === null && !settingsState) return;

  grid.innerHTML = '';
  
  if (providers === null) {
    try {
      providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
    } catch (e) {
      console.error(e);
      providers = [];
    }
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
        <button class="provider-tile-delete" title="${t('settings.deleteProvider')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    `;
    
    tile.onclick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.provider-tile-delete')) return;
      
      const select = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
      if (select) {
        select.value = p.name;
        onProviderChanged(true);
      }
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
  grid.appendChild(addTile);
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
  
  renderProvidersGrid();
  
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const provider = providers.find(p => p.name === providerName);
  
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
    
    const keyVal = provider.apiKey || provider.api_key || '';
    const keyInput = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
    if (keyInput) {
      keyInput.type = 'password';
      const eyeBtn = keyInput.nextElementSibling as HTMLElement | null;
      if (eyeBtn) eyeBtn.style.color = 'var(--color-text-muted)';
      
      if (keyVal === '__KEYRING__') {
        keyInput.value = '••••••••••••••••';
        keyInput.dataset.isKeyring = 'true';
        
        (async () => {
          try {
            const realKey = await invoke('get_keyring_credential', { providerName });
            const currentSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
            if (currentSelect && currentSelect.value === providerName) {
              keyInput.value = realKey;
              keyInput.dataset.isKeyring = 'false';
            }
          } catch (e) {
            console.error("Background keyring credential fetch failed:", e);
            const currentSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
            if (currentSelect && currentSelect.value === providerName) {
              keyInput.value = '';
              keyInput.placeholder = 'sk-...';
              keyInput.dataset.isKeyring = 'false';
            }
          }
        })();
      } else {
        keyInput.value = keyVal;
        keyInput.dataset.isKeyring = 'false';
      }
    }
    
    modelSelect.innerHTML = '';
    const enabledModels = (provider.models || []).filter(m => m.enabled !== false);
    
    enabledModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.id} (${(m.contextWindow || m.context_window || 200000).toLocaleString()} tokens)`;
      modelSelect.appendChild(opt);
    });
    
    if (settingsState) {
      const hasModel = enabledModels.some(m => m.id === settingsState.translateAiModel);
      if (!hasModel && enabledModels.length > 0) {
        settingsState.translateAiModel = enabledModels[0].id;
      } else if (enabledModels.length === 0) {
        settingsState.translateAiModel = '';
      }
      modelSelect.value = settingsState.translateAiModel || '';
      updateActiveModelBannerUI(settingsState.translateAiModel);
    }
    
    if (!skipTableRender) {
      renderModelsRegistryTable(provider);
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
    if (keyEl) keyEl.value = '';
    const countEl = document.getElementById('provider-models-count');
    if (countEl) countEl.textContent = '0';
    
    const tbody = document.getElementById('mgr-models-tbody');
    if (tbody) tbody.innerHTML = '';
  }

  if (window.translationStudioController) {
    window.translationStudioController.refreshModelOptions();
  }
  
  saveSettings();
  triggerUpdateTranscribeUI();
}

export async function togglePasswordVisibility(inputId: string, btn: HTMLElement): Promise<void> {
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!input) return;
  const svg = btn.querySelector('svg');
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  
  if (input.type === 'password') {
    if (input.dataset.isKeyring === 'true' && providerSelect && providerSelect.value) {
      (btn as HTMLButtonElement).disabled = true;
      try {
        const realKey = await invoke('get_keyring_credential', { providerName: providerSelect.value });
        input.value = realKey;
        input.dataset.isKeyring = 'false';
      } catch (e) {
        notify(t('toasts.keyringLoadError', { error: String(e) }), "error");
      } finally {
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
    input.type = 'password';
    btn.style.color = 'var(--color-text-muted)';
    if (svg) {
      svg.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      `;
    }
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
  
  if (btnAuto) btnAuto.classList.remove('active');
  if (btnProv) btnProv.classList.remove('active');
  if (btnGen) btnGen.classList.remove('active');
  if (btnMod) btnMod.classList.remove('active');
  
  if (divAuto) divAuto.style.display = 'none';
  if (divProv) divProv.style.display = 'none';
  if (divGen) divGen.style.display = 'none';
  if (divMod) divMod.style.display = 'none';
  
  let activeDiv: HTMLElement | null = null;
  if (tab === 'auto') {
    if (btnAuto) btnAuto.classList.add('active');
    if (divAuto) { divAuto.style.display = 'flex'; activeDiv = divAuto; }
  } else if (tab === 'providers') {
    if (btnProv) btnProv.classList.add('active');
    if (divProv) { divProv.style.display = 'block'; activeDiv = divProv; }
  } else if (tab === 'general') {
    if (btnGen) btnGen.classList.add('active');
    if (divGen) { divGen.style.display = 'block'; activeDiv = divGen; }
  } else {
    if (btnMod) btnMod.classList.add('active');
    if (divMod) { divMod.style.display = 'block'; activeDiv = divMod; }
    
    const settingsState = getSettingsState();
    if (currentProviderModels.length === 0 && settingsState && settingsState.translateAiProvider) {
      try {
        const providers = JSON.parse(settingsState.translateAiProviders || '[]');
        const curProv = providers.find((p: any) => p.name === settingsState.translateAiProvider);
        if (curProv && curProv.models && curProv.models.length > 0) {
          renderModelsRegistryTable(curProv);
        } else {
          applyModelsFilterAndRender(0);
        }
      } catch (e) {
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

export async function saveActiveProviderGeneral(silent = false): Promise<void> {
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) return;
  
  const settingsState = getSettingsState();
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const urlEl = document.getElementById('mgr-provider-url') as HTMLInputElement | null;
  const fmtEl = document.getElementById('mgr-provider-format') as HTMLSelectElement | null;
  const keyEl = document.getElementById('mgr-provider-key') as HTMLInputElement | null;
  const promptEl = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;

  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiFormat = fmtEl ? fmtEl.value : 'Chat completions';
  const key = keyEl ? keyEl.value.trim() : '';
  const customPrompt = promptEl ? promptEl.value.trim() : '';
  
  if (!baseUrl) {
    if (!silent) notify(t('toasts.baseUrlRequired'), "info");
    return;
  }
  
  let keyToSave = provider.apiKey || provider.api_key || '';
  let useKeyring = provider.useKeyring !== false;
  
  if (key === '') {
    try {
      await invoke('delete_keyring_credential', { providerName });
    } catch (e) {}
    keyToSave = '';
    useKeyring = false;
  } else if (key !== '••••••••••••••••') {
    try {
      await invoke('store_keyring_credential', { providerName, key });
      keyToSave = '__KEYRING__';
      useKeyring = true;
    } catch (e) {
      console.warn("Failed to store API Key in system keyring, saving in file:", e);
      keyToSave = key;
      useKeyring = false;
    }
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
  if (settingsState) {
    settingsState.translateAiProviders = JSON.stringify(providers);
  }
  
  await saveSettings();
  
  const select = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (select) select.value = providerName;
  
  if (!silent) {
    notify(t('toasts.providerSettingsSaved'), "success");
  }
}

export async function deleteProviderByName(providerName: string): Promise<void> {
  if (!providerName) return;
  
  const confirmed = await confirmModal(
    t('modals.confirmDeleteProviderTitle'),
    t('modals.confirmDeleteProviderDesc', { name: providerName }),
    t('modals.deleteBtn')
  );
  if (!confirmed) return;
  
  const settingsState = getSettingsState();
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
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
    settingsState.translateAiProviders = JSON.stringify(providers);
    if (settingsState.translateAiProvider === providerName) {
      settingsState.translateAiProvider = providers.length > 0 ? providers[0].name : '';
    }
  }
  
  await saveSettings();
  populateProvidersDropdown();
  onProviderChanged(true);
  
  notify(t('toasts.providerDeleted'), "info");
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

export function renderModelsRegistryTable(provider: ProviderConfig): void {
  currentProviderModels = (provider && provider.models ? provider.models : []).map(m => {
    const isReasoning = isReasoningSupportedModel(m);
    let reasoningVal = isReasoning
      ? ((m.reasoning !== undefined && m.reasoning !== null && m.reasoning !== '') ? m.reasoning : 'Medium')
      : 'None';
    return {
      id: m.id || '',
      contextWindow: parseTokensInput(m.contextWindow || m.context_window || 200000),
      reasoning: reasoningVal,
      supportsReasoning: typeof m.supportsReasoning === 'boolean'
        ? m.supportsReasoning
        : (typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : (isReasoning ? true : undefined)),
      enabled: m.enabled !== false
    };
  });
  
  currentModelsPage = 1;
  currentModelsSortCol = null;
  currentModelsSortDir = 'none';
  updateFilterCounts();
  applyModelsFilterAndRender(0);
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
        activeCell.innerHTML = `
          <div class="model-active-badge is-active" title="${t('settings.activeBadge')}">
            <span class="active-dot"></span>
            <span class="badge-text">${t('settings.activeBadge')}</span>
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
        activeCell.innerHTML = `
          <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${t('settings.setActiveBadge')}" aria-label="${t('settings.setActiveBadge')}">
            <span class="radio-circle"></span>
          </button>
        `;
      }
      const actionCell = row.querySelector('.td-action');
      if (actionCell) {
        actionCell.innerHTML = `
          <button type="button" class="model-btn-trash" title="Remove Model Row" aria-label="Remove Model Row">
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
          const aActive = (a.id === activeModelId) ? 1 : 0;
          const bActive = (b.id === activeModelId) ? 1 : 0;
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
        const isActive = modelObj.id === activeModelId && !!activeModelId;
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

  row.innerHTML = `
    <div class="td-cell td-active" role="cell">
      ${isActive ? `
        <div class="model-active-badge is-active" title="${t('settings.activeBadge')}">
          <span class="active-dot"></span>
          <span class="badge-text">${t('settings.activeBadge')}</span>
        </div>
      ` : `
        <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${t('settings.setActiveBadge')}" aria-label="${t('settings.setActiveBadge')}">
          <span class="radio-circle"></span>
        </button>
      `}
    </div>
    <div class="td-cell td-id" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-id-input" value="" placeholder="e.g. gpt-4o-mini" title="Model Identifier" />
      ` : `
        <div class="model-id-wrapper" dir="ltr">
          <div class="model-id-display" title="${escapeHTML(fullId)}">${providerPrefix ? `<span class="model-id-prefix">${escapeHTML(providerPrefix)}</span>` : ''}<span class="model-id-name">${escapeHTML(modelName)}</span></div>
          ${isFree ? '<span class="model-tag-free">FREE</span>' : ''}
        </div>
      `}
    </div>
    <div class="td-cell td-ctx" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-ctx-input" value="${formattedCtx}" data-raw-tokens="${modelObj.contextWindow}" placeholder="128K" title="Context tokens: ${formattedCtx} (${Number(modelObj.contextWindow).toLocaleString()})" />
      ` : `
        <span class="model-ctx-value" title="Context tokens: ${formattedCtx} (${Number(modelObj.contextWindow).toLocaleString()})">${formattedCtx}</span>
      `}
    </div>
    <div class="td-cell td-reasoning" role="cell">
      ${supportsReasoning ? `
        <select id="${selectId}" class="select-control model-reasoning-select${isReasoningActive ? ' reasoning-active' : ''}">
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
        <span class="reasoning-none-dash" title="${t('settings.reasoningNotSupported')}" aria-label="${t('settings.reasoningNotSupported')}">—</span>
      `}
    </div>
    <div class="td-cell td-action" role="cell">
      ${isActive ? '' : `
        <button type="button" class="model-btn-trash" title="Remove Model Row" aria-label="Remove Model Row">
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

  const handleActivate = () => {
    if (!modelObj.id || !modelObj.id.trim()) {
      notify(t('toasts.noModelIdError'), 'info');
      return;
    }
    if (!isActive) {
      setActiveModelFromTable(modelObj.id.trim());
    }
  };

  row.addEventListener('click', (e: MouseEvent) => {
    const trashBtn = (e.target as HTMLElement).closest('.model-btn-trash');
    if (trashBtn) {
      e.stopPropagation();
      const settings = getSettingsState();
      const currentActive = ((settings && settings.translateAiModel) || '').toLowerCase();
      const thisId = (modelObj.id || '').toLowerCase();
      if (isActive || (currentActive && currentActive === thisId)) {
        notify(t('toasts.cannotDeleteActiveModel'), "info");
        return;
      }
      const idx = currentProviderModels.indexOf(modelObj);
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
      (e.target as HTMLElement).closest('.reasoning-none-dash')
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
          modelObj.id = val;
          row.dataset.modelId = val.toLowerCase();
          if (isActive) {
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

  const idInput = row.querySelector('.model-id-input') as HTMLInputElement | null;
  if (idInput) {
    idInput.addEventListener('click', e => e.stopPropagation());
    idInput.addEventListener('input', () => {
      const val = idInput.value.trim();
      modelObj.id = val;
      row.dataset.modelId = val.toLowerCase();
    });
    idInput.addEventListener('blur', () => {
      const val = idInput.value.trim();
      if (val) {
        updateFilterCounts();
        saveActiveProviderModelsDebounced();
        setTimeout(() => {
          if (!row.contains(document.activeElement)) {
            applyModelsFilterAndRender(0);
          }
        }, 120);
      } else {
        setTimeout(() => {
          if (!row.contains(document.activeElement)) {
            const idx = currentProviderModels.indexOf(modelObj);
            if (idx !== -1 && !modelObj.id) {
              currentProviderModels.splice(idx, 1);
              updateFilterCounts();
              applyModelsFilterAndRender(0);
            }
          }
        }, 120);
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
      setTimeout(() => {
        if (!row.contains(document.activeElement)) {
          applyModelsFilterAndRender(0);
        }
      }, 120);
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

export async function fetchActiveProviderModels(): Promise<void> {
  if (typeof document === 'undefined') return;
  const providerSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  
  const settingsState = getSettingsState();
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
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
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `
    <svg class="btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
    <span>${t('common.loading')}</span>
  `;
  
  if ((!apiKey || apiKey === '••••••••••••••••') && (provider.useKeyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__')) {
    try {
      apiKey = await invoke('get_keyring_credential', { providerName });
    } catch(e) {}
  }
  
  try {
    const modelsList = await invoke('fetch_provider_models', { baseUrl, apiKey, apiFormat });
    const currentActive = settingsState ? settingsState.translateAiModel : '';
    
    const existingMap = new Map<string, any>();
    if (provider && Array.isArray(provider.models)) {
      provider.models.forEach(pm => {
        if (pm && pm.id) existingMap.set(pm.id, pm);
      });
    }

    currentProviderModels = modelsList.map((m: any) => {
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
      return {
        id: modelId,
        contextWindow: parseTokensInput(modelCtx),
        reasoning,
        supportsReasoning: isReasoning,
        enabled
      };
    });
    
    if (!currentActive && currentProviderModels.length > 0 && settingsState) {
      settingsState.translateAiModel = currentProviderModels[0].id;
    }
    
    currentModelsPage = 1;
    currentModelsSortCol = null;
    currentModelsSortDir = 'none';
    updateFilterCounts();
    await saveActiveProviderModels(true, false);
    notify(t('toasts.modelsFetchedSuccess', { count: modelsList.length }), "success");
  } catch (e) {
    notify(t('toasts.modelsFetchError', { error: String(e) }), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

export async function saveActiveProviderModels(
  keepCurrentTab = false,
  skipTableRender = false,
  targetProviderName: string | null = null
): Promise<void> {
  const settingsState = getSettingsState();
  const providerName = targetProviderName || (settingsState ? settingsState.translateAiProvider : '');
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const validModels: ModelObject[] = [];
  const seenIds = new Set<string>();
  currentProviderModels.forEach(m => {
    const trimmedId = (m.id || '').trim();
    if (trimmedId && !seenIds.has(trimmedId)) {
      seenIds.add(trimmedId);
      const supportsReasoning = typeof m.supportsReasoning === 'boolean'
        ? m.supportsReasoning
        : (typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : undefined);

      validModels.push({
        id: trimmedId,
        contextWindow: m.contextWindow || 200000,
        reasoning: m.reasoning || 'None',
        supportsReasoning: supportsReasoning !== undefined
          ? supportsReasoning
          : (m.reasoning && m.reasoning.toLowerCase() !== 'none' ? true : undefined),
        enabled: m.enabled !== false
      });
    }
  });

  provider.models = validModels;
  providers[providerIdx] = provider;
  if (settingsState) {
    settingsState.translateAiProviders = JSON.stringify(providers);
  }

  const isCurrentActiveProvider = providerName === (settingsState ? settingsState.translateAiProvider : '');
  if (isCurrentActiveProvider && settingsState) {
    if (!validModels.some(m => m.id === settingsState.translateAiModel)) {
      settingsState.translateAiModel = validModels.length > 0 ? validModels[0].id : '';
    }
    
    if (typeof document !== 'undefined') {
      const selectDOM = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
      if (selectDOM) {
        selectDOM.innerHTML = '';
        validModels.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.id;
          selectDOM.appendChild(opt);
        });
        selectDOM.value = settingsState.translateAiModel;
      }
    }
    
    updateActiveModelBannerUI(settingsState.translateAiModel);
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
  if (_providerModalTrap) {
    _providerModalTrap.release();
    _providerModalTrap = null;
  }
  const nameEl = document.getElementById('provider-name') as HTMLInputElement | null;
  const urlEl = document.getElementById('provider-url') as HTMLInputElement | null;
  const keyEl = document.getElementById('provider-key') as HTMLInputElement | null;

  if (nameEl) nameEl.value = '';
  if (urlEl) urlEl.value = '';
  if (keyEl) keyEl.value = '';
  
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
  if (typeof document !== 'undefined') {
    const modal = document.getElementById('translation-provider-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => { modal.style.display = 'none'; }, 300);
    }
  }
}

export async function saveProviderConfig(): Promise<void> {
  if (typeof document === 'undefined') return;
  const nameEl = document.getElementById('provider-name') as HTMLInputElement | null;
  const urlEl = document.getElementById('provider-url') as HTMLInputElement | null;
  const fmtEl = document.getElementById('provider-format') as HTMLSelectElement | null;
  const keyEl = document.getElementById('provider-key') as HTMLInputElement | null;

  const name = nameEl ? nameEl.value.trim() : '';
  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiFormat = fmtEl ? fmtEl.value : 'Chat completions';
  const key = keyEl ? keyEl.value.trim() : '';
  
  if (!name || !baseUrl) {
    notify(t('toasts.nameAndUrlRequired'), "info");
    return;
  }
  
  let keyToSave = key;
  let useKeyring = false;
  
  if (key) {
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
  
  const settingsState = getSettingsState();
  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {
    console.error(e);
  }
  
  if (providers.some(p => p.name === name)) {
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
  
  providers.push(providerData);
  if (settingsState) {
    settingsState.translateAiProviders = JSON.stringify(providers);
    settingsState.translateAiProvider = name;
  }
  
  await saveSettings();
  populateProvidersDropdown();
  onProviderChanged('general');
  closeProviderModal();
  
  notify(t('toasts.providerAddedSuccess'), "success");
}

// ----------------- Batch Error Dialog -----------------
export function showBatchErrorDialog(fileName: string, errorMsg: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('abort');
      return;
    }
    if (_batchErrorModalTrap) {
      _batchErrorModalTrap.release();
      _batchErrorModalTrap = null;
    }
    const modal = document.getElementById('batch-error-modal');
    const msgEl = document.getElementById('batch-error-message');
    if (msgEl) {
      msgEl.textContent = t('modals.batchErrorFormatted', { file: fileName, error: errorMsg });
    }
    
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);
      
      _batchErrorModalTrap = _trapModalFocus(modal, () => {
        if (window.resolveBatchError) window.resolveBatchError('abort');
      });
    }

    window.resolveBatchError = function(choice: string) {
      if (_batchErrorModalTrap) {
        _batchErrorModalTrap.release();
        _batchErrorModalTrap = null;
      }
      if (modal) {
        modal.classList.remove('show');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
      }
      resolve(choice);
    };

    requestAnimationFrame(() => {
      if (modal) {
        const retryBtn = (modal.querySelector('button.btn-primary') || modal.querySelector('button')) as HTMLButtonElement | null;
        if (retryBtn) retryBtn.focus();
      }
    });
  });
}

// ----------------- Event Listeners Setup -----------------
export function setupTranslationEventListeners(): void {
  if (typeof document === 'undefined') return;
  const urlInput = document.getElementById('mgr-provider-url');
  const formatSelect = document.getElementById('mgr-provider-format');
  const keyInput = document.getElementById('mgr-provider-key');
  const promptTextarea = document.getElementById('mgr-provider-prompt') as HTMLTextAreaElement | null;
  
  const triggerAutoSave = () => {
    saveActiveProviderGeneral(true);
  };
  
  if (urlInput) urlInput.addEventListener('change', triggerAutoSave);
  if (formatSelect) formatSelect.addEventListener('change', triggerAutoSave);
  if (keyInput) keyInput.addEventListener('change', triggerAutoSave);
  if (promptTextarea) {
    applyDynamicDir(promptTextarea);
    promptTextarea.addEventListener('input', () => applyDynamicDir(promptTextarea));
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
function _handleTestModalKeydown(e: KeyboardEvent): void {
  if (typeof document === 'undefined') return;
  const modal = document.getElementById('translation-test-modal');
  if (!modal || !modal.classList.contains('show')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    abortAndCloseTestModal();
  }
}

export function handleTestModalBackdropClick(event: any): void {
  if (event.target && event.target.id === 'translation-test-modal') {
    abortAndCloseTestModal();
  }
}

export async function abortAndCloseTestModal(): Promise<void> {
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
    document.removeEventListener('keydown', _handleTestModalKeydown);
  }
}

export function closeTestModal(): void {
  if (isPreviewTesting) {
    abortAndCloseTestModal();
    return;
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
    document.removeEventListener('keydown', _handleTestModalKeydown);
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
  
  try {
    await saveActiveProviderGeneral(true);
  } catch (e) {
    console.warn("Failed to silently save provider configuration before test:", e);
  }

  const settingsState = getSettingsState();
  if (settingsState) {
    settingsState.translateAiProvider = providerName;
  }

  let providers: ProviderConfig[] = [];
  try {
    providers = JSON.parse((settingsState && settingsState.translateAiProviders) || '[]');
  } catch (e) {}
  const p = providers.find(item => item.name === providerName);
  const models = (p && Array.isArray(p.models)) ? p.models : [];
  if (settingsState) {
    const modelBelongsToProvider = models.some(m => m.id === settingsState.translateAiModel);
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
  
  if (!testModal || !statusEl || !resultEl) return;

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

  testModal.style.display = 'flex';
  setTimeout(() => testModal.classList.add('show'), 10);
  document.addEventListener('keydown', _handleTestModalKeydown);

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
  deleteByName: deleteProviderByName,
  deleteActive: deleteActiveProvider,
  renderModelsTable: renderModelsRegistryTable,
  fetchModels: fetchActiveProviderModels,
  saveModels: saveActiveProviderModels,
  setActiveModel: setActiveModelFromTable,
  testConnection: testTranslationConnection,
  setupEventListeners: setupTranslationEventListeners,
  syncWindowBindings: syncTranslationProvidersWindowBindings
};
