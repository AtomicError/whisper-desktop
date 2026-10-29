// Settings Engine, Hardware Accelerators, Model Scanning, Number Steppers, and Output Directory Management
import { t, getLanguage, setLanguage, isolateLtr, applyTextDirection } from '../i18n/index';
import { showNotification, showConfirmModal } from './appModal';
import { getBasename, openFileInEditor } from './nativeWindow';
import { applyMonochromeCanvas, applyTheme, switchTheme, applyUiZoom } from './themeManager';
import { initLanguageSelects, renderLanguageSelect } from '../languageSelect';
import { invalidateModelStatusesCache } from './modelHub';
import type { ProviderConfig } from './translationProviders';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare global {
  interface Window {
    settingsState: any;
    compiledBackends: any;
    activeSettingsCat: string;
    localScannedTransModels: any[];
    localScannedVadModels: string[];
    selectBackend: (backend: string, isInitialSelection?: boolean) => void;
    openModelsDirectory: () => Promise<void>;
    browseModelsDirectory: () => Promise<void>;
    switchSettingsCategory: (catName: string) => void;
    clearSettingsSearch: () => void;
    filterSettings: (query: string, immediate?: boolean) => void;
    confirmResetWhisperEngine: () => Promise<void>;
    incrementNumber: (inputId: string, step?: number, immediate?: boolean) => void;
    decrementNumber: (inputId: string, step?: number, immediate?: boolean) => void;
    scanAndPopulateModels: () => Promise<void>;
    toggleOutputDirCustomField: () => void;
    openCustomOutputDir: () => Promise<void>;
    browseOutputDir: () => Promise<void>;
    browseTranscribeOutputDir: () => Promise<void>;
    resetTranscribeOutputDir: () => Promise<void>;
    updateTranscribeOutputDirUI: () => void;
    updateTranscribeUIConfigs: () => void;
    openTranscriptionSettings: () => void;
    toggleQuickVad: (forceVal?: boolean) => void;
    syncCustomSelects?: () => void;
    saveCurrentSettings: (immediate?: boolean) => any;
    refreshSettings: () => Promise<void>;
    refreshBuildStatuses: () => Promise<void>;
    setupNumberInputControls: () => void;
    setupQuickConfigDeckEventListeners: () => void;
    populateProvidersDropdown: () => void;
    onProviderChanged: (keepCurrentTab?: boolean | string, skipTableRender?: boolean) => void;
    translationStudioController?: any;
    hardsubController?: any;
    updateFilterCounts: () => void;
    renderProvidersGrid: (providers?: ProviderConfig[] | null) => void;
    applyModelsFilterAndRender: (delay?: number) => void;
    switchView: (view: string) => void;
    isBatchTranscribing?: boolean;
    updateTranscribeWorkflowButtons: () => void;
    renderMediaMetadata?: (meta: any) => void;
    probedMetadata: any;
    __TAURI__?: any;
  }
}

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

export const safeApplyDynamicDirection = (el: HTMLElement | null): void => {
  if (!el) return;
  const win = getGlobal();
  if (typeof win.applyDynamicDirection === 'function') {
    win.applyDynamicDirection(el);
  } else if (typeof applyTextDirection === 'function') {
    applyTextDirection(el);
  }
};

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

// ----------------- Global Settings States -----------------
export let settingsState: any = null;
export let compiledBackends: Record<string, boolean> = {};
export let activeSettingsCat: string = 'app';
export let localScannedTransModels: string[] = [];
export let localScannedVadModels: string[] = [];

export function getSettingsState(): any {
  const win = getGlobal();
  if (win && win.settingsState) {
    settingsState = win.settingsState;
    return settingsState;
  }
  return settingsState || null;
}

export function setSettingsState(state: any): void {
  settingsState = state;
  const win = getGlobal();
  if (win) {
    win.settingsState = state;
  }
}

export function getCompiledBackends(): Record<string, boolean> {
  return compiledBackends;
}

export function setCompiledBackends(backends: Record<string, boolean>): void {
  compiledBackends = backends;
  const win = getGlobal();
  if (win) {
    win.compiledBackends = backends;
  }
}

export function getActiveSettingsCat(): string {
  return activeSettingsCat;
}

export function setActiveSettingsCat(cat: string): void {
  activeSettingsCat = cat;
  const win = getGlobal();
  if (win) {
    win.activeSettingsCat = cat;
  }
}

export function getLocalScannedTransModels(): string[] {
  return localScannedTransModels;
}

export function setLocalScannedTransModels(models: string[]): void {
  localScannedTransModels = models;
  const win = getGlobal();
  if (win) {
    win.localScannedTransModels = models;
  }
}

export function getLocalScannedVadModels(): string[] {
  return localScannedVadModels;
}

export function setLocalScannedVadModels(models: string[]): void {
  localScannedVadModels = models;
  const win = getGlobal();
  if (win) {
    win.localScannedVadModels = models;
  }
}

// ----------------- Hardware Backends & Accelerators -----------------
export function selectBackend(backend: string, isInitialSelection = false): void {
  const current = getSettingsState();
  if (!isInitialSelection && current) {
    current.selectedBackend = backend;
    saveCurrentSettings();
    scanAndPopulateModels();
  }
  updateTranscribeUIConfigs();
}

export async function refreshBuildStatuses(): Promise<void> {
  if (typeof document === 'undefined') return;

  const allBackends = [
    { key: 'Standard', label: (typeof t === 'function' && t('transcribe.backendCpu')) || 'CPU' },
    { key: 'Vulkan', label: (typeof t === 'function' && t('transcribe.backendVulkan')) || 'Vulkan GPU' },
    { key: 'OpenVINO', label: (typeof t === 'function' && t('transcribe.backendOpenvino')) || 'OpenVINO Intel' },
    { key: 'CUDA', label: (typeof t === 'function' && t('transcribe.backendCuda')) || 'NVIDIA CUDA' }
  ];

  const availableBackends: Array<{ key: string; label: string }> = [];
  for (const b of allBackends) {
    let isCompiled = false;
    try {
      isCompiled = await invoke('check_build', { backend: b.key });
    } catch (e) {
      console.error(`Failed to check build for ${b.key}:`, e);
    }
    compiledBackends[b.key] = isCompiled;
    if (isCompiled) {
      availableBackends.push(b);
    }
  }

  // Fallback to Standard CPU if no binaries reported compiled (defensive)
  if (availableBackends.length === 0) {
    compiledBackends['Standard'] = true;
    availableBackends.push(allBackends[0]);
  }

  const win = getGlobal();
  if (win) {
    win.compiledBackends = compiledBackends;
  }

  // Dynamically populate the Active Backend dropdown with ONLY compiled backends
  const dropdown = document.getElementById('opt-selectedBackend') as HTMLSelectElement | null;
  if (dropdown) {
    const current = getSettingsState();
    const currentSelected = current ? current.selectedBackend : dropdown.value;

    // Check if options changed to prevent redundant DOM replacements
    const currentOptKeys = Array.from(dropdown.options || []).map(o => o.value);
    const newOptKeys = availableBackends.map(b => b.key);
    const optionsChanged = currentOptKeys.length !== newOptKeys.length || !currentOptKeys.every((k, i) => k === newOptKeys[i]);

    if (optionsChanged) {
      dropdown.innerHTML = '';
      availableBackends.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.key;
        opt.textContent = b.label;
        dropdown.appendChild(opt);
      });
    }

    // Auto-fallback: if current selected backend is not available, choose the best available
    const isCurrentValid = availableBackends.some(b => b.key === currentSelected);
    if (!isCurrentValid) {
      const fallbackBackend = availableBackends.find(b => b.key === 'Vulkan')?.key || availableBackends[0].key;
      if (current) {
        current.selectedBackend = fallbackBackend;
        saveCurrentSettings();
        scanAndPopulateModels();
      }
      dropdown.value = fallbackBackend;
    } else {
      dropdown.value = currentSelected;
    }

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  updateTranscribeUIConfigs();
}

// ----------------- Models Directory & Models Scanning -----------------
let _isBrowsingModelsDirectory = false;
let _isOpeningModelsDirectory = false;

export async function openModelsDirectory(): Promise<void> {
  if (_isOpeningModelsDirectory) return;
  _isOpeningModelsDirectory = true;

  const current = getSettingsState();
  const dirPath = (current && current.modelsDir) || (document.getElementById('opt-modelsDir') as HTMLInputElement | null)?.value;
  if (!dirPath) {
    _isOpeningModelsDirectory = false;
    return;
  }

  try {
    try {
      await invoke('verify_directory_writable', { dirPath });
    } catch (permErr) {
      showNotification(t('toasts.modelsDirNotWritable', { error: String(permErr) }), "error");
      return;
    }
    await openFileInEditor(dirPath);
  } catch (err: any) {
    console.error('Failed to open models directory:', err);
    const msg = (err && (err.message || err.toString())) || String(err);
    showNotification(t('toasts.openFolderError', { error: msg }), "error");
  } finally {
    setTimeout(() => {
      _isOpeningModelsDirectory = false;
    }, 1000);
  }
}

export async function browseModelsDirectory(): Promise<void> {
  if (_isBrowsingModelsDirectory) return;
  _isBrowsingModelsDirectory = true;

  const inputEl = document.getElementById('opt-modelsDir') as HTMLInputElement | null;
  const pathControl = inputEl?.closest('.setting-control-path');
  const browseBtn = pathControl?.querySelector('.path-browse-btn') as HTMLButtonElement | null;
  const pathField = pathControl?.querySelector('.readonly-path-field') as HTMLElement | null;
  if (browseBtn) browseBtn.disabled = true;
  if (pathField) pathField.style.pointerEvents = 'none';

  try {
    const path = await invoke('select_directory');
    if (path) {
      try {
        await invoke('verify_directory_writable', { dirPath: path });
      } catch (permErr) {
        showNotification(t('toasts.modelsDirNotWritable', { error: String(permErr) }), "error");
        return;
      }

      if (inputEl) {
        inputEl.value = path;
        inputEl.title = isolateLtr(path);
        if (inputEl.parentElement) {
          inputEl.parentElement.title = isolateLtr(path);
        }
      }
      const current = getSettingsState();
      if (current) {
        current.modelsDir = path;
        await saveCurrentSettings();
        await scanAndPopulateModels();
      }
      if (typeof invalidateModelStatusesCache === 'function') {
        invalidateModelStatusesCache();
      }
      await refreshBuildStatuses();
    }
  } catch (err) {
    console.error('Failed to select models directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    if (pathField) pathField.style.pointerEvents = '';
    _isBrowsingModelsDirectory = false;
  }
}

export async function scanAndPopulateModels(): Promise<void> {
  const win = getGlobal();
  if (win) {
    win.scanAndPopulateModels = scanAndPopulateModels;
  }
  const current = getSettingsState();
  if (!current) return;

  try {
    const res = await invoke('scan_models', {
      modelsDir: current.modelsDir,
      backend: current.selectedBackend
    });

    localScannedTransModels = res.transModels || [];
    setLocalScannedTransModels(localScannedTransModels);

    // 1. Populate Model Selection for both Settings & Quick Config Deck
    const transSelect = document.getElementById('opt-modelPath') as HTMLSelectElement | null;
    const quickSelect = document.getElementById('quick-opt-model') as HTMLSelectElement | null;

    if (transSelect) transSelect.innerHTML = '';
    if (quickSelect) quickSelect.innerHTML = '';

    const seenModelNames = new Set<string>();
    let modelMatched = false;

    const validModels = (res.transModels || []).filter((m: string) => {
      const name = getBasename(m);
      return !name.startsWith('for-tests') && !name.startsWith('No trans');
    });

    validModels.sort((a: string, b: string) => {
      const nameA = getBasename(a);
      const nameB = getBasename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (validModels.length === 0) {
      if (transSelect) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = t('transcribe.noModelsFound');
        transSelect.appendChild(emptyOpt);
      }
      if (quickSelect) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = t('transcribe.noModelsFoundDropdown');
        quickSelect.appendChild(emptyOpt);
      }
      if (current.modelPath) {
        current.modelPath = '';
      }
    } else {
      validModels.forEach((m: string) => {
        const name = getBasename(m);
        if (seenModelNames.has(name)) return;
        seenModelNames.add(name);

        if (transSelect) {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = name;
          if (m === current.modelPath) {
            opt.selected = true;
            modelMatched = true;
          }
          transSelect.appendChild(opt);
        }

        if (quickSelect) {
          const quickOpt = document.createElement('option');
          quickOpt.value = m;
          quickOpt.textContent = name;
          if (m === current.modelPath) {
            quickOpt.selected = true;
          }
          quickSelect.appendChild(quickOpt);
        }
      });
    }

    if (!modelMatched && transSelect && transSelect.options.length > 0 && transSelect.value) {
      transSelect.selectedIndex = 0;
      current.modelPath = transSelect.value;
      if (quickSelect) quickSelect.value = transSelect.value;
    }

    if (transSelect) {
      transSelect.onchange = () => {
        current.modelPath = transSelect.value;
        if (quickSelect) quickSelect.value = transSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      };
    }

    if (quickSelect) {
      quickSelect.onchange = () => {
        if (quickSelect.value) {
          current.modelPath = quickSelect.value;
          if (transSelect) transSelect.value = quickSelect.value;
          saveCurrentSettings();
          updateTranscribeUIConfigs();
        }
      };
    }

    // 2. Populate VAD Selection
    const vadSelect = document.getElementById('opt-vadModel') as HTMLSelectElement | null;
    const validVadModels = (res.vadModels || []).filter((m: string) => m !== 'No VAD models found');
    validVadModels.sort((a: string, b: string) => {
      const nameA = getBasename(a);
      const nameB = getBasename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    localScannedVadModels = validVadModels;
    setLocalScannedVadModels(localScannedVadModels);
    let vadMatched = false;

    if (vadSelect) {
      vadSelect.innerHTML = '';
      validVadModels.forEach((m: string) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = getBasename(m);
        if (m === current.vadModel) {
          opt.selected = true;
          vadMatched = true;
        }
        vadSelect.appendChild(opt);
      });
      if (!vadMatched && validVadModels.length > 0) {
        vadSelect.selectedIndex = 0;
        current.vadModel = vadSelect.value;
      } else if (validVadModels.length === 0) {
        current.vadModel = '';
      }
      vadSelect.onchange = () => {
        current.vadModel = vadSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      };
    } else {
      if (!vadMatched && validVadModels.length > 0) {
        if (!current.vadModel || !validVadModels.includes(current.vadModel)) {
          current.vadModel = validVadModels[0];
        }
      } else if (validVadModels.length === 0) {
        current.vadModel = '';
      }
    }

    // Save state if auto-selected or cleared
    if ((!modelMatched && transSelect && transSelect.options.length > 0 && transSelect.value) || (!vadMatched && validVadModels.length > 0) || (validModels.length === 0 && !modelMatched)) {
      await saveCurrentSettings();
    }

    updateTranscribeUIConfigs();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  } catch (e) {
    console.error("Failed to scan models directory:", e);
    const win = getGlobal();
    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }
}

// ----------------- Category Switch & Filter / Search -----------------
export function switchSettingsCategory(catName: string): void {
  if (typeof document === 'undefined') return;
  if (catName === 'general') catName = 'app';

  const searchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
  const hasActiveSearch = Boolean(searchInput && searchInput.value.trim().length > 0);

  if (hasActiveSearch && searchInput) {
    const targetGroup = document.getElementById(`group-${catName}`);
    if (targetGroup && targetGroup.style.display !== 'none' && targetGroup.classList.contains('active')) {
      targetGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    searchInput.value = '';
    safeApplyDynamicDirection(searchInput);
    const clearBtn = document.getElementById('settings-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  activeSettingsCat = catName;
  setActiveSettingsCat(catName);

  const scrollContainer = document.querySelector('.settings-scroll-container');
  if (scrollContainer) {
    scrollContainer.scrollTop = 0;
  }

  document.querySelectorAll('.settings-search-group-header').forEach(h => h.remove());
  const emptyEl = document.getElementById('settings-search-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  const tabs = document.querySelectorAll('.settings-cat-btn');
  tabs.forEach(tab => {
    tab.classList.remove('active', 'search-dimmed');
    const badge = tab.querySelector('.cat-match-badge');
    if (badge) badge.remove();
    if (tab.id === `cat-btn-${catName}`) {
      tab.classList.add('active');
    }
  });

  const groups = document.querySelectorAll('.settings-group');
  groups.forEach(group => {
    group.classList.remove('active');
    (group as HTMLElement).style.display = '';
    group.querySelectorAll('.setting-card').forEach(card => {
      (card as HTMLElement).style.display = '';
    });
  });

  const targetGroup = document.getElementById(`group-${catName}`);
  if (targetGroup) {
    targetGroup.classList.add('active');
    const win = getGlobal();
    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  if (typeof toggleOutputDirCustomField === 'function') {
    toggleOutputDirCustomField();
  }
}

export function clearSettingsSearch(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
    safeApplyDynamicDirection(searchInput);
    filterSettings('', true);
    searchInput.focus();
  }
}

export function executeFilterSettings(query: string): void {
  if (typeof document === 'undefined') return;
  const q = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('settings-search-clear');
  const emptyEl = document.getElementById('settings-search-empty');
  const emptyDescEl = document.getElementById('settings-search-empty-desc');
  const groups = document.querySelectorAll('.settings-group');
  const tabs = document.querySelectorAll('.settings-cat-btn');
  const scrollContainer = document.querySelector('.settings-scroll-container');

  if (clearBtn) {
    clearBtn.style.display = q ? 'flex' : 'none';
  }

  if (!q) {
    if (emptyEl) emptyEl.style.display = 'none';
    document.querySelectorAll('.settings-search-group-header').forEach(h => h.remove());

    tabs.forEach(tab => {
      tab.classList.remove('search-dimmed');
      const badge = tab.querySelector('.cat-match-badge');
      if (badge) badge.remove();
      if (tab.id === `cat-btn-${activeSettingsCat}`) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    groups.forEach(group => {
      (group as HTMLElement).style.display = '';
      group.querySelectorAll('.setting-card').forEach(card => {
        (card as HTMLElement).style.display = '';
      });
      if (group.id === `group-${activeSettingsCat}`) {
        group.classList.add('active');
      } else {
        group.classList.remove('active');
      }
    });

    if (typeof toggleOutputDirCustomField === 'function') {
      toggleOutputDirCustomField();
    }
    return;
  }

  let totalMatches = 0;
  const catMatches: Record<string, number> = {};

  const getCatTitle = (catName: string): string => {
    const tab = document.getElementById(`cat-btn-${catName}`);
    if (!tab) return catName;
    const i18nKey = tab.getAttribute('data-i18n');
    if (i18nKey && typeof t === 'function') {
      const translated = t(i18nKey);
      if (translated && translated !== i18nKey) return translated;
    }
    return tab.childNodes?.[0]?.textContent?.trim() || tab.textContent?.trim() || catName;
  };

  groups.forEach(group => {
    const catName = group.id.replace('group-', '');
    let groupMatches = 0;
    const cards = group.querySelectorAll('.setting-card');

    cards.forEach(card => {
      const searchTags = (card.getAttribute('data-search-tags') || '').toLowerCase();
      const title = (card.querySelector('.setting-title')?.textContent || '').toLowerCase();
      const desc = (card.querySelector('.setting-desc')?.textContent || '').toLowerCase();
      const descPoints = (card.querySelector('.setting-desc-points')?.textContent || '').toLowerCase();

      const optionsText = Array.from(card.querySelectorAll('select option'))
        .map(o => o.textContent?.toLowerCase() || '').join(' ');
      const subCardsText = Array.from(card.querySelectorAll('.theme-card-title, .theme-card-desc, .radio-label, .preset-label'))
        .map(el => el.textContent?.toLowerCase() || '').join(' ');

      const matches = searchTags.includes(q) ||
                      title.includes(q) ||
                      desc.includes(q) ||
                      descPoints.includes(q) ||
                      optionsText.includes(q) ||
                      subCardsText.includes(q);

      if (matches) {
        (card as HTMLElement).style.display = '';
        groupMatches++;
        totalMatches++;
      } else {
        (card as HTMLElement).style.display = 'none';
      }
    });

    catMatches[catName] = groupMatches;

    if (groupMatches > 0) {
      group.classList.add('active');
      (group as HTMLElement).style.display = 'flex';

      let header = group.querySelector(':scope > .settings-search-group-header') as HTMLElement | null;
      if (!header) {
        header = document.createElement('div');
        header.className = 'settings-search-group-header';
        group.insertBefore(header, group.firstChild);
      }
      header.textContent = getCatTitle(catName);
      header.style.display = 'flex';
    } else {
      group.classList.remove('active');
      (group as HTMLElement).style.display = 'none';
      const header = group.querySelector(':scope > .settings-search-group-header') as HTMLElement | null;
      if (header) header.style.display = 'none';
    }
  });

  tabs.forEach(tab => {
    const catName = tab.id.replace('cat-btn-', '');
    const count = catMatches[catName] || 0;
    let badge = tab.querySelector('.cat-match-badge');

    if (count > 0) {
      tab.classList.remove('search-dimmed');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cat-match-badge';
        tab.appendChild(badge);
      }
      badge.textContent = String(count);
    } else {
      tab.classList.add('search-dimmed');
      if (badge) badge.remove();
    }
  });

  if (totalMatches === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (emptyDescEl) {
      emptyDescEl.textContent = typeof t === 'function'
        ? t('settings.searchNoResultsDesc', { query: (query || '').trim() })
        : `No configuration options match "${(query || '').trim()}".`;
    }
    if (scrollContainer) scrollContainer.scrollTop = 0;
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
  }
}

let _filterSettingsTimer: any = null;

export function filterSettings(query: string, immediate = false): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
  if (searchInput) {
    safeApplyDynamicDirection(searchInput);
  }
  if (_filterSettingsTimer) {
    clearTimeout(_filterSettingsTimer);
    _filterSettingsTimer = null;
  }
  if (immediate || !query) {
    executeFilterSettings(query);
  } else {
    _filterSettingsTimer = setTimeout(() => {
      _filterSettingsTimer = null;
      executeFilterSettings(query);
    }, 80);
  }
}

// ----------------- Settings Lifecycle & Persistence -----------------
export async function refreshSettings(): Promise<void> {
  try {
    const loaded = await invoke('load_settings');
    setSettingsState(loaded);

    if (loaded && typeof loaded.uiScale === 'number') {
      applyUiZoom(loaded.uiScale, false, false);
    }

    const isMonochrome = (loaded && typeof loaded.monochromeCanvas === 'boolean')
      ? loaded.monochromeCanvas
      : (typeof localStorage !== 'undefined' && localStorage.getItem('whisper_monochrome_canvas') === 'true');
    applyMonochromeCanvas(Boolean(isMonochrome), true);

    const currentTheme = (loaded && loaded.theme) ? loaded.theme : 'royal-blue';
    applyTheme(currentTheme);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('whisper_theme_cache', currentTheme);
      }
    } catch (_) {}

    if (loaded && loaded.uiLanguage) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('whisper_language', loaded.uiLanguage);
        }
      } catch (_) {}
      if (loaded.uiLanguage !== getLanguage()) {
        setLanguage(loaded.uiLanguage, false);
      }
    }

    if (typeof document !== 'undefined') {
      const inputEl = document.getElementById('opt-modelsDir') as HTMLInputElement | null;
      if (inputEl) {
        inputEl.value = loaded.modelsDir || '';
        inputEl.title = isolateLtr(loaded.modelsDir || '');
        if (inputEl.parentElement) {
          inputEl.parentElement.title = isolateLtr(loaded.modelsDir || '');
        }
      }

      initLanguageSelects();
      bindSettingsToDOM();
    }

    await scanAndPopulateModels();
  } catch (e) {
    console.error("Failed to load settings in refreshSettings:", e);
    showNotification(t('toasts.settingsLoadError'), "error");
  }
}

export function bindSettingsToDOM(): void {
  if (typeof document === 'undefined') return;
  const current = getSettingsState();
  if (!current) return;

  const win = getGlobal();
  try {
    if (typeof win.populateProvidersDropdown === 'function') {
      win.populateProvidersDropdown();
    }
    if (typeof win.onProviderChanged === 'function') {
      win.onProviderChanged();
    }
    if (win.translationStudioController && typeof win.translationStudioController.syncFromGlobalSettings === 'function') {
      win.translationStudioController.syncFromGlobalSettings();
    }
  } catch (aiErr) {
    console.error("Error initializing AI translation elements in bindSettingsToDOM:", aiErr);
  }

  const autoTransferCheckbox = (document.getElementById('opt-autoTransferToTranslate') || document.getElementById('opt-translateAiEnabled')) as HTMLInputElement | null;
  if (autoTransferCheckbox) {
    autoTransferCheckbox.checked = !!(current.autoTransferToTranslate ?? current.translateAiEnabled);
    autoTransferCheckbox.onchange = () => {
      current.autoTransferToTranslate = autoTransferCheckbox.checked;
      current.translateAiEnabled = autoTransferCheckbox.checked;
      saveCurrentSettings();
    };
  }

  const keys = Object.keys(current);
  keys.forEach(key => {
    const el = document.getElementById(`opt-${key}`) as HTMLInputElement | HTMLSelectElement | null;
    if (el) {
      if ((el as HTMLInputElement).type === 'checkbox') {
        const chk = el as HTMLInputElement;
        chk.checked = Boolean(current[key]);
        chk.onchange = () => {
          current[key] = chk.checked;
          if (key === 'autoTransferToTranslate' || key === 'translateAiEnabled') {
            current.autoTransferToTranslate = chk.checked;
            current.translateAiEnabled = chk.checked;
          }
          if (key === 'monochromeCanvas') {
            applyMonochromeCanvas(chk.checked, true);
          }
          saveCurrentSettings();
          if (key === 'vad') {
            const quickVadInput = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
            if (quickVadInput) quickVadInput.checked = chk.checked;
            updateTranscribeUIConfigs();
          }
          if (key === 'translateAiPolish' && win.translationStudioController?.syncFromGlobalSettings) {
            win.translationStudioController.syncFromGlobalSettings();
          }
          if (key === 'outputJson' || key === 'outputJsonFull') {
            syncJsonConfidenceDependency();
          }
        };
      } else if (el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'text' || (el as HTMLInputElement).type === 'number') {
        el.value = current[key];
        if (key === 'prompt' || el.id === 'opt-prompt' || el.hasAttribute('dir')) {
          safeApplyDynamicDirection(el as HTMLElement);
          if (!(el as any)._hasDynamicDirListener) {
            (el as any)._hasDynamicDirListener = true;
            el.addEventListener('input', () => safeApplyDynamicDirection(el as HTMLElement));
          }
        }
        el.onchange = () => {
          let val: any = el.value;
          if (INT_SETTING_KEYS.has(key)) {
            val = parseInt(el.value);
            if (isNaN(val)) val = (key === 'maxContext') ? -1 : 0;
            if (key === 'bestOf' || key === 'beamSize') {
              val = Math.max(1, Math.min(8, val));
              el.value = String(val);
            }
          } else if (FLOAT_SETTING_KEYS.has(key)) {
            val = parseFloat(el.value);
            if (isNaN(val)) {
              val = (key === 'vadMaxSpeech') ? 30.0 : 0.0;
            } else if (key === 'vadMaxSpeech') {
              if (val <= 0.0 || val >= 1000.0) {
                val = 30.0;
              } else {
                val = Math.max(1.0, Math.min(300.0, val));
              }
              el.value = String(val);
            }
          }
          if (key === 'uiScale') {
            const numVal = parseFloat(val) || 1.0;
            applyUiZoom(numVal, true, false);
            return;
          }
          if (key === 'theme') {
            switchTheme(val);
            return;
          }
          if (key === 'uiLanguage') {
            setLanguage(val);
            return;
          }

          current[key] = val;
          saveCurrentSettings(true);

          if (key === 'language' || key === 'modelPath' || key === 'threads') {
            updateTranscribeUIConfigs();
          }
          if (key === 'selectedBackend') {
            refreshBuildStatuses();
          }
          if (key === 'ffmpegSource') {
            refreshFFmpegStatus(val, true);
          }
          if (key === 'translateAiProvider' && typeof win.onProviderChanged === 'function') {
            win.onProviderChanged();
          }
          if ((key === 'translateAiTargetLang' || key === 'translateAiModel') && win.translationStudioController?.syncFromGlobalSettings) {
            win.translationStudioController.syncFromGlobalSettings();
          }
          if (key === 'outputDirMode') {
            toggleOutputDirCustomField();
          }
        };
      }
    }
  });

  syncJsonConfidenceDependency();
  selectBackend(current.selectedBackend, true);
  refreshFFmpegStatus(current.ffmpegSource, false);
  toggleOutputDirCustomField();

  if (typeof win.syncCustomSelects === 'function') {
    win.syncCustomSelects();
  }

  updateAllStepperButtons();
}

export function syncJsonConfidenceDependency(): void {
  if (typeof document === 'undefined') return;
  const jsonOpt = document.getElementById('opt-outputJson') as HTMLInputElement | null;
  const jsonFullOpt = document.getElementById('opt-outputJsonFull') as HTMLInputElement | null;
  const confCard = document.getElementById('card-printConfidence') as HTMLElement | null;
  const confInput = document.getElementById('opt-printConfidence') as HTMLInputElement | null;

  const isJsonActive = Boolean((jsonOpt && jsonOpt.checked) || (jsonFullOpt && jsonFullOpt.checked));

  if (confCard) {
    if (isJsonActive) {
      confCard.style.opacity = '1';
      confCard.style.cursor = 'default';
      confCard.style.pointerEvents = 'auto';
      if (confInput) confInput.disabled = false;
      confCard.removeAttribute('title');
    } else {
      confCard.style.opacity = '0.45';
      confCard.style.cursor = 'not-allowed';
      confCard.style.pointerEvents = 'auto';
      if (confInput) {
        confInput.disabled = true;
        confInput.checked = false;
      }
      const current = getSettingsState();
      if (current && current.printConfidence) {
        current.printConfidence = false;
        saveCurrentSettings();
      }
      confCard.title = 'Requires JSON Formatted (.json) or Full Detailed JSON (-ojf) to be enabled';
    }
  }
}

// ----------------- FFmpeg Status & Version Formatting -----------------
export function formatFFmpegVersion(versionStr?: string | null): string {
  if (!versionStr || versionStr === 'Unknown version' || versionStr === 'N/A') {
    return 'Ready';
  }
  const match = versionStr.match(/version\s+([^\s]+)/i);
  const raw = match ? match[1] : versionStr.trim();

  // 1. Standard semantic version (e.g., "7.1", "7.1.1", "n7.0", "v6.0-extra", "4.4.2-0ubuntu0")
  const semverMatch = raw.match(/^[nNvV]?(\d+(\.\d+)+)/);
  if (semverMatch) {
    return `v${semverMatch[1]}`;
  }

  // 2. Git daily snapshot builds with dates (e.g., "N-126826-gc0e8b139fd-20260924" or "2024-03-07-git...")
  const dateHyphenMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateHyphenMatch) {
    return `vGit-${dateHyphenMatch[1]}.${dateHyphenMatch[2]}`;
  }
  const dateCompactMatch = raw.match(/(\d{4})(\d{2})(\d{2})/);
  if (dateCompactMatch) {
    return `vGit-${dateCompactMatch[1]}.${dateCompactMatch[2]}`;
  }

  // 3. Git build number (e.g. "N-126826-g...")
  const buildNumMatch = raw.match(/^[nN]-(\d+)/);
  if (buildNumMatch) {
    return `vGit-${buildNumMatch[1]}`;
  }

  // 4. Fallback cleanup: strip leading 'n'/'v' and trailing tags
  let fallback = raw.split('-')[0].split('_')[0];
  fallback = fallback.replace(/^[nNvV]/, '');
  if (fallback && fallback.length > 0 && !isNaN(Number(fallback))) {
    return `v${fallback}`;
  }

  return 'Ready';
}

export async function refreshFFmpegStatus(sourceOverride?: string, userInitiated = false): Promise<void> {
  if (typeof document === 'undefined') return;
  const badgeEl = document.getElementById('ffmpeg-status-badge');
  if (!badgeEl) return;

  const current = getSettingsState();
  const currentSource = sourceOverride || (current ? current.ffmpegSource : 'bundled');

  try {
    const info = await invoke('get_ffmpeg_status', { source: currentSource });
    if (info.isAvailable) {
      const verFormatted = formatFFmpegVersion(info.version);
      badgeEl.className = 'setting-status-pill ready';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot blue"></span> ${verFormatted}`;
      badgeEl.title = `Source: ${info.configuredSource}\nPath: ${isolateLtr(info.resolvedPath)}\n${info.version}`;
    } else {
      badgeEl.className = 'setting-status-pill missing';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot red"></span> Not Found`;
      badgeEl.title = info.errorMessage || 'FFmpeg binary was not found';
      if (currentSource === 'system' && userInitiated) {
        showNotification(t('toasts.ffmpegNotFound'), "warning");
      }
    }
  } catch (err) {
    console.warn("Failed to check FFmpeg status:", err);
    if (badgeEl) {
      badgeEl.className = 'setting-status-pill error';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot yellow"></span> Status Error`;
    }
  }
}

// ----------------- Numeric Typing & Sanitization -----------------
export const INT_SETTING_KEYS = new Set([
  'threads', 'processors', 'offsetT', 'duration', 'maxContext', 'maxLen',
  'bestOf', 'beamSize', 'audioCtx', 'deviceId', 'vadMinSpeech', 'vadMinSil', 'vadSpeechPad'
]);

export const FLOAT_SETTING_KEYS = new Set([
  'wordThold', 'entropyThold', 'logprobThold', 'noSpeechThold',
  'temperature', 'temperatureInc', 'vadThold', 'vadMaxSpeech', 'vadOverlap', 'uiScale'
]);

export function sanitizeSettingsPayload(state: any): any {
  if (!state) return state;
  const clean = { ...state };
  if (clean.autoTransferToTranslate !== undefined) {
    clean.translateAiEnabled = Boolean(clean.autoTransferToTranslate);
  } else if (clean.translateAiEnabled !== undefined) {
    clean.autoTransferToTranslate = Boolean(clean.translateAiEnabled);
  }
  for (const key of Object.keys(clean)) {
    if (INT_SETTING_KEYS.has(key)) {
      const parsed = parseInt(clean[key]);
      clean[key] = isNaN(parsed) ? (key === 'maxContext' ? -1 : 0) : parsed;
    } else if (FLOAT_SETTING_KEYS.has(key)) {
      const parsed = parseFloat(clean[key]);
      clean[key] = isNaN(parsed) ? (key === 'vadMaxSpeech' ? 30.0 : 0.0) : parsed;
    }
  }
  return clean;
}

let saveSettingsDebounceTimer: any = null;

export async function saveCurrentSettings(immediate = false): Promise<void> {
  const current = getSettingsState();
  if (!current) return;

  current.uiLanguage = getLanguage();

  for (const key of Object.keys(current)) {
    if (INT_SETTING_KEYS.has(key) && typeof current[key] === 'string') {
      const parsed = parseInt(current[key]);
      current[key] = isNaN(parsed) ? (key === 'maxContext' ? -1 : 0) : parsed;
    } else if (FLOAT_SETTING_KEYS.has(key) && typeof current[key] === 'string') {
      const parsed = parseFloat(current[key]);
      current[key] = isNaN(parsed) ? (key === 'vadMaxSpeech' ? 30.0 : 0.0) : parsed;
    }
  }

  updateTranscribeUIConfigs();

  const doSave = async () => {
    try {
      const cleanPayload = sanitizeSettingsPayload(current);
      await invoke('save_settings', { settings: cleanPayload });
    } catch (e) {
      console.error("Failed to save settings:", e);
      showNotification(t('toasts.settingsSaveError'), "error");
    }
  };

  if (immediate) {
    if (saveSettingsDebounceTimer) {
      clearTimeout(saveSettingsDebounceTimer);
      saveSettingsDebounceTimer = null;
    }
    await doSave();
  } else {
    if (saveSettingsDebounceTimer) {
      clearTimeout(saveSettingsDebounceTimer);
    }
    saveSettingsDebounceTimer = setTimeout(doSave, 250);
  }
}

export async function confirmResetWhisperEngine(): Promise<void> {
  if (typeof document === 'undefined') return;
  const win = getGlobal();
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const isBusy = (cancelBtn && cancelBtn.style.display !== 'none' && cancelBtn.style.display !== '') || win.isBatchTranscribing;
  if (isBusy) {
    showNotification(t('toasts.taskRunningWarning'), 'warning');
    return;
  }

  const confirmed = await showConfirmModal(
    t('modals.confirmResetEngineTitle'),
    t('modals.confirmResetEngineDesc'),
    t('modals.confirmResetEngineBtn')
  );
  if (!confirmed) return;

  const resetBtn = document.getElementById('btn-reset-whisper-engine') as HTMLButtonElement | null;
  const resetIcon = resetBtn ? resetBtn.querySelector('.btn-reset-icon') : null;
  if (resetBtn) resetBtn.disabled = true;
  if (resetIcon) resetIcon.classList.add('is-spinning');

  try {
    const updated = await invoke('reset_whisper_core_settings');
    if (updated) {
      setSettingsState(updated);
    }
    bindSettingsToDOM();
    updateTranscribeUIConfigs();
    if (typeof refreshBuildStatuses === 'function') {
      refreshBuildStatuses();
    }
    showNotification(t('toasts.engineSettingsReset'), 'success');
  } catch (err) {
    console.error('Failed to reset whisper engine settings:', err);
    showNotification(t('toasts.engineSettingsResetError', { error: String(err) }), 'error');
  } finally {
    if (resetIcon) {
      const cleanupSpin = () => {
        resetIcon.classList.remove('is-spinning');
        if (resetBtn) resetBtn.disabled = false;
        resetIcon.removeEventListener('animationend', cleanupSpin);
      };
      resetIcon.addEventListener('animationend', cleanupSpin);
      setTimeout(cleanupSpin, 700);
    } else if (resetBtn) {
      resetBtn.disabled = false;
    }
  }
}

// ----------------- Number Input Controls & Steppers -----------------
export function getStepperBounds(inputId: string): { min: number; max: number } {
  let min = -Infinity;
  let max = Infinity;

  if (inputId === 'opt-threads' || inputId === 'opt-processors') {
    min = 1;
  } else if (inputId === 'opt-deviceId' || inputId === 'opt-maxLen') {
    min = 0;
  } else if (inputId === 'opt-maxContext') {
    min = -1;
  } else if (inputId === 'opt-bestOf' || inputId === 'opt-beamSize') {
    min = 1;
    max = 8;
  }
  return { min, max };
}

export function updateStepperButtonStates(inputOrId: string | HTMLInputElement): void {
  if (typeof document === 'undefined') return;
  const input = typeof inputOrId === 'string' ? (document.getElementById(inputOrId) as HTMLInputElement | null) : inputOrId;
  if (!input) return;
  const ctrl = input.closest('.number-input-control');
  if (!ctrl) return;

  const decBtn = ctrl.querySelector('button:first-child') as HTMLButtonElement | null;
  const incBtn = ctrl.querySelector('button:last-child') as HTMLButtonElement | null;
  const val = parseInt(input.value);
  const { min, max } = getStepperBounds(input.id);

  if (decBtn) {
    decBtn.disabled = !isNaN(val) && val <= min;
  }
  if (incBtn) {
    incBtn.disabled = !isNaN(val) && val >= max;
  }
}

export function updateAllStepperButtons(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.number-input-control input').forEach(input => {
    updateStepperButtonStates(input as HTMLInputElement);
  });
}

export function clampNumberSetting(inputId: string, val: any): number {
  let num = parseInt(val);
  if (isNaN(num)) num = (inputId === 'opt-maxContext' ? -1 : 0);

  const { min, max } = getStepperBounds(inputId);
  if (num < min) num = min;
  if (num > max) num = max;
  return num;
}

export function incrementNumber(inputId: string, step = 1, immediate = false): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(inputId) as HTMLInputElement | null;
  if (el) {
    let currentVal = parseInt(el.value);
    if (isNaN(currentVal)) currentVal = (inputId === 'opt-maxContext' ? -1 : 0);
    const nextVal = clampNumberSetting(inputId, currentVal + step);
    el.value = String(nextVal);
    updateStepperButtonStates(el);

    const key = inputId.replace('opt-', '');
    const current = getSettingsState();
    if (current && key in current) {
      current[key] = nextVal;
      saveCurrentSettings(immediate);
    }
  }
}

export function decrementNumber(inputId: string, step = 1, immediate = false): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(inputId) as HTMLInputElement | null;
  if (el) {
    let currentVal = parseInt(el.value);
    if (isNaN(currentVal)) currentVal = (inputId === 'opt-maxContext' ? -1 : 0);
    const nextVal = clampNumberSetting(inputId, currentVal - step);
    el.value = String(nextVal);
    updateStepperButtonStates(el);

    const key = inputId.replace('opt-', '');
    const current = getSettingsState();
    if (current && key in current) {
      current[key] = nextVal;
      saveCurrentSettings(immediate);
    }
  }
}

export function setupNumberInputControls(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.number-input-control').forEach(ctrl => {
    const input = ctrl.querySelector('input') as HTMLInputElement | null;
    if (!input || (ctrl as any)._stepperInitialized) {
      if (input) updateStepperButtonStates(input);
      return;
    }
    (ctrl as any)._stepperInitialized = true;

    const incBtn = ctrl.querySelector('button:last-child');
    let step = 1;
    if (incBtn) {
      const match = incBtn.getAttribute('onclick')?.match(/,\s*([0-9.]+)\)/);
      if (match) step = parseFloat(match[1]) || 1;
    }

    const commitValue = (immediate = true) => {
      const clamped = clampNumberSetting(input.id, input.value);
      input.value = String(clamped);
      updateStepperButtonStates(input);
      const key = input.id.replace('opt-', '');
      const current = getSettingsState();
      if (current && key in current) {
        current[key] = clamped;
        saveCurrentSettings(immediate);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        incrementNumber(input.id, step, false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        decrementNumber(input.id, step, false);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        incrementNumber(input.id, step * 5, false);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        decrementNumber(input.id, step * 5, false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitValue(true);
        input.blur();
      } else if (e.key === 'Escape') {
        const key = input.id.replace('opt-', '');
        const current = getSettingsState();
        if (current && key in current) {
          input.value = String(current[key]);
        }
        updateStepperButtonStates(input);
        input.blur();
      }
    });

    input.addEventListener('focus', () => {
      setTimeout(() => input.select(), 10);
    });

    input.addEventListener('input', () => {
      let cleaned = input.value.replace(/[^0-9\-]/g, '');
      if (cleaned.lastIndexOf('-') > 0) {
        cleaned = cleaned.charAt(0) === '-' ? '-' + cleaned.replace(/\-/g, '') : cleaned.replace(/\-/g, '');
      }
      input.value = cleaned;
      updateStepperButtonStates(input);
      const key = input.id.replace('opt-', '');
      const current = getSettingsState();
      if (cleaned !== '' && cleaned !== '-' && current && key in current) {
        const num = clampNumberSetting(input.id, cleaned);
        current[key] = num;
        saveCurrentSettings(false);
      }
    });

    input.addEventListener('blur', () => commitValue(true));
    input.addEventListener('change', () => commitValue(true));

    (ctrl as any)._wheelAccumulator = 0;
    ctrl.addEventListener('wheel', (e: any) => {
      if (document.activeElement !== input) {
        return;
      }
      e.preventDefault();
      (ctrl as any)._wheelAccumulator = ((ctrl as any)._wheelAccumulator || 0) + e.deltaY;
      const NOTCH_THRESHOLD = 50;
      if (Math.abs((ctrl as any)._wheelAccumulator) >= NOTCH_THRESHOLD) {
        const ticks = Math.trunc((ctrl as any)._wheelAccumulator / NOTCH_THRESHOLD);
        (ctrl as any)._wheelAccumulator -= ticks * NOTCH_THRESHOLD;
        if (ticks < 0) {
          incrementNumber(input.id, step * Math.abs(ticks), false);
        } else if (ticks > 0) {
          decrementNumber(input.id, step * ticks, false);
        }
      }
    }, { passive: false });

    updateStepperButtonStates(input);
  });
}

// ----------------- Output Directory Management -----------------
export function toggleOutputDirCustomField(): void {
  if (typeof document === 'undefined') return;
  const modeEl = document.getElementById('opt-outputDirMode') as HTMLSelectElement | null;
  const cardEl = document.getElementById('output-dir-custom-card');
  const wrapEl = document.getElementById('output-dir-custom-wrap');

  if (cardEl) {
    if (modeEl && modeEl.value === 'custom') {
      cardEl.style.display = 'flex';
    } else {
      cardEl.style.display = 'none';
    }
  }
  if (wrapEl) {
    if (modeEl && modeEl.value === 'custom') {
      wrapEl.style.display = 'flex';
    } else {
      wrapEl.style.display = 'none';
    }
  }
  if (typeof updateTranscribeOutputDirUI === 'function') {
    updateTranscribeOutputDirUI();
  }
}

let _isBrowsingOutputDir = false;
let _isOpeningOutputDir = false;

export async function openCustomOutputDir(): Promise<void> {
  if (_isOpeningOutputDir) return;
  _isOpeningOutputDir = true;

  const current = getSettingsState();
  const dirPath = (current && current.outputDirPath) || (document.getElementById('opt-outputDirPath') as HTMLInputElement | null)?.value;
  if (!dirPath) {
    _isOpeningOutputDir = false;
    showNotification(t('toasts.noOutputDirFound'), "info");
    return;
  }

  try {
    try {
      await invoke('verify_directory_writable', { dirPath });
    } catch (permErr) {
      showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
      return;
    }
    await openFileInEditor(dirPath);
  } catch (err: any) {
    console.error('Failed to open output directory:', err);
    const msg = (err && (err.message || err.toString())) || String(err);
    showNotification(t('toasts.openFolderError', { error: msg }), "error");
  } finally {
    setTimeout(() => {
      _isOpeningOutputDir = false;
    }, 1000);
  }
}

export async function browseOutputDir(): Promise<void> {
  if (_isBrowsingOutputDir) return;
  _isBrowsingOutputDir = true;

  const inputEl = document.getElementById('opt-outputDirPath') as HTMLInputElement | null;
  const pathControl = inputEl?.closest('.setting-control-path');
  const browseBtn = pathControl?.querySelector('.path-browse-btn') as HTMLButtonElement | null;
  const pathField = pathControl?.querySelector('.readonly-path-field') as HTMLElement | null;
  if (browseBtn) browseBtn.disabled = true;
  if (pathField) pathField.style.pointerEvents = 'none';

  try {
    const dir = await invoke('select_directory');
    if (dir) {
      try {
        await invoke('verify_directory_writable', { dirPath: dir });
      } catch (permErr) {
        showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
        return;
      }

      if (inputEl) {
        inputEl.value = dir;
        inputEl.title = isolateLtr(dir);
        if (inputEl.parentElement) {
          inputEl.parentElement.title = isolateLtr(dir);
        }
      }
      const current = getSettingsState();
      if (current) {
        current.outputDirPath = dir;
        await saveCurrentSettings();
      }
      updateTranscribeOutputDirUI();
    }
  } catch (err) {
    console.error('Failed to select output directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    if (pathField) pathField.style.pointerEvents = '';
    _isBrowsingOutputDir = false;
  }
}

let _isBrowsingTranscribeOutputDir = false;

export async function browseTranscribeOutputDir(): Promise<void> {
  if (_isBrowsingTranscribeOutputDir) return;
  _isBrowsingTranscribeOutputDir = true;
  const browseBtn = document.getElementById('btn-browse-transcribe-dir') as HTMLButtonElement | null;
  if (browseBtn) browseBtn.disabled = true;

  try {
    const dir = await invoke('select_directory');
    if (dir) {
      try {
        await invoke('verify_directory_writable', { dirPath: dir });
      } catch (permErr) {
        showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
        return;
      }
      const current = getSettingsState();
      if (current) {
        current.outputDirMode = 'custom';
        current.outputDirPath = dir;
        const optMode = document.getElementById('opt-outputDirMode') as HTMLSelectElement | null;
        if (optMode) optMode.value = 'custom';
        const optPath = document.getElementById('opt-outputDirPath') as HTMLInputElement | null;
        if (optPath) {
          optPath.value = dir;
          optPath.title = isolateLtr(dir);
        }
        await saveCurrentSettings();
      }
      updateTranscribeOutputDirUI();
    }
  } catch (err) {
    console.error('Failed to select transcribe output directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    _isBrowsingTranscribeOutputDir = false;
  }
}

export async function resetTranscribeOutputDir(): Promise<void> {
  const resetBtn = document.getElementById('btn-reset-transcribe-dir') as HTMLButtonElement | null;
  if (resetBtn) resetBtn.disabled = true;
  try {
    const current = getSettingsState();
    if (current) {
      current.outputDirMode = 'source';
      current.outputDirPath = '';
      const optMode = document.getElementById('opt-outputDirMode') as HTMLSelectElement | null;
      if (optMode) optMode.value = 'source';
      const optPath = document.getElementById('opt-outputDirPath') as HTMLInputElement | null;
      if (optPath) {
        optPath.value = '';
        optPath.removeAttribute('title');
      }
      await saveCurrentSettings();
    }
    updateTranscribeOutputDirUI();
  } finally {
    if (resetBtn) resetBtn.disabled = false;
  }
}

export function updateTranscribeOutputDirUI(): void {
  if (typeof document === 'undefined') return;
  const dirTextEl = document.getElementById('transcribe-output-dir-text');
  const resetBtn = document.getElementById('btn-reset-transcribe-dir');
  if (!dirTextEl || !resetBtn) return;

  const current = getSettingsState();
  const isCustom = current && current.outputDirMode === 'custom' && current.outputDirPath;
  if (isCustom) {
    dirTextEl.textContent = current.outputDirPath;
    dirTextEl.title = isolateLtr(current.outputDirPath);
    dirTextEl.classList.add('has-custom-path');
    resetBtn.style.display = 'inline-flex';
  } else {
    dirTextEl.textContent = t('transcribe.sameAsSource') || t('translate.sameAsSource') || 'Same as source file folder';
    dirTextEl.removeAttribute('title');
    dirTextEl.classList.remove('has-custom-path');
    resetBtn.style.display = 'none';
  }
}

// ----------------- Transcribe Quick Configuration Deck & UI Configs -----------------
export function updateTranscribeUIConfigs(): void {
  if (typeof document === 'undefined') return;
  const current = getSettingsState();
  if (!current) return;

  const backend = current.selectedBackend || 'Standard';
  const backendEl = document.getElementById('trans-cfg-backend');
  if (backendEl) {
    backendEl.textContent = backend;
    backendEl.title = backend;
  }

  const win = getGlobal();
  const probed = win.probedMetadata;
  if (probed && probed.exists && typeof win.renderMediaMetadata === 'function') {
    win.renderMediaMetadata(probed);
  }

  // 1. Sync Quick Engine / Backend Select
  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend') as HTMLSelectElement | null;
  if (quickBackendSelect) {
    const backendDefs = [
      { key: 'Standard', label: t('transcribe.backendCpu') },
      { key: 'Vulkan', label: t('transcribe.backendVulkan') },
      { key: 'CUDA', label: t('transcribe.backendCuda') },
      { key: 'OpenVINO', label: t('transcribe.backendOpenvino') }
    ];

    const availableBackends = backendDefs.filter(b => b.key === 'Standard' || Boolean(compiledBackends[b.key]));
    const currentKeys = Array.from(quickBackendSelect.options || []).map(o => o.value).join(',');
    const targetKeys = availableBackends.map(b => b.key).join(',');
    if (currentKeys !== targetKeys) {
      quickBackendSelect.innerHTML = '';
      availableBackends.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.key;
        opt.textContent = b.label;
        if (b.key === backend) {
          opt.selected = true;
        }
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

  const model = getBasename(current.modelPath) || 'None';
  const modelEl = document.getElementById('trans-cfg-model');
  if (modelEl) {
    modelEl.textContent = model;
    modelEl.title = model;
  }

  // 2. Sync Quick Model Select
  const quickModelSelect = document.getElementById('quick-opt-model') as HTMLSelectElement | null;
  if (quickModelSelect && current.modelPath) {
    quickModelSelect.value = current.modelPath;
  }

  // 3. Sync Quick Language Select
  const quickLangSelect = document.getElementById('quick-opt-language') as HTMLSelectElement | null;
  if (quickLangSelect) {
    renderLanguageSelect(quickLangSelect, 'spoken', (current.language || 'auto').trim());
  }

  // 4. Sync Quick VAD Button State & Tooltip
  const hasVadModel = Boolean(localScannedVadModels && localScannedVadModels.length > 0 && current.vadModel);
  const vadActive = Boolean(current.vad && hasVadModel);
  const vadModelName = current.vadModel ? getBasename(current.vadModel) : 'Default';

  const vadEl = document.getElementById('trans-cfg-vad');
  if (vadEl) {
    vadEl.textContent = vadActive ? 'ON' : 'OFF';
    vadEl.className = vadActive ? 'val-gold' : 'val-muted';
    vadEl.title = vadActive ? `${t('transcribe.vadActive')} (${vadModelName})` : t('transcribe.vadDisabled');
  }

  const quickVadBtn = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
  if (quickVadBtn) {
    if ('checked' in quickVadBtn) {
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

  const transCfgTranslation = document.getElementById('trans-cfg-translation');
  if (transCfgTranslation) {
    const translationEnabled = Boolean(current?.autoTransferToTranslate ?? current?.translateAiEnabled);
    let translationText = 'OFF';
    let fullTitle = 'Auto-Transfer to Translation Studio Disabled';
    if (translationEnabled) {
      translationText = 'ON';
      fullTitle = 'Auto-Transfer to Translation Studio Active';
    }
    transCfgTranslation.textContent = translationText;
    transCfgTranslation.title = fullTitle;
    transCfgTranslation.className = translationEnabled ? 'val-green' : 'val-muted';
  }

  updateTranscribeOutputDirUI();

  if (typeof win.updateTranscribeWorkflowButtons === 'function') {
    win.updateTranscribeWorkflowButtons();
  }

  if (typeof win.syncCustomSelects === 'function') {
    win.syncCustomSelects();
  }
}

export function openTranscriptionSettings(): void {
  const win = getGlobal();
  if (typeof win.switchView === 'function') {
    win.switchView('settings');
    switchSettingsCategory('transcription');
  }
}

export function setupQuickConfigDeckEventListeners(): void {
  if (typeof document === 'undefined') return;

  const quickModelSelect = document.getElementById('quick-opt-model') as HTMLSelectElement | null;
  if (quickModelSelect) {
    quickModelSelect.addEventListener('change', () => {
      const current = getSettingsState();
      if (current && quickModelSelect.value) {
        current.modelPath = quickModelSelect.value;
        const cfgModelSelect = document.getElementById('opt-modelPath') as HTMLSelectElement | null;
        if (cfgModelSelect) {
          cfgModelSelect.value = quickModelSelect.value;
        }
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  const quickLangSelect = document.getElementById('quick-opt-language') as HTMLSelectElement | null;
  if (quickLangSelect) {
    quickLangSelect.addEventListener('change', () => {
      const current = getSettingsState();
      if (current) {
        current.language = quickLangSelect.value;
        const cfgLangInput = document.getElementById('opt-language') as HTMLInputElement | null;
        if (cfgLangInput) {
          cfgLangInput.value = quickLangSelect.value;
        }
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend') as HTMLSelectElement | null;
  if (quickBackendSelect) {
    quickBackendSelect.addEventListener('change', async () => {
      const backend = quickBackendSelect.value;
      const isCompiled = backend === 'Standard' || Boolean(compiledBackends[backend]);
      const current = getSettingsState();
      if (!isCompiled) {
        showNotification(t('toasts.backendNotFound', { backend: backend === 'Standard' ? 'CPU' : backend }), "error");
        if (current) {
          quickBackendSelect.value = current.selectedBackend;
          const win = getGlobal();
          if (typeof win.syncCustomSelects === 'function') win.syncCustomSelects();
        }
        return;
      }
      if (current) {
        selectBackend(backend, false);
        const cfgBackendSelect = document.getElementById('opt-selectedBackend') as HTMLSelectElement | null;
        if (cfgBackendSelect) {
          cfgBackendSelect.value = backend;
        }
        const backendLabel = backend === 'Standard' ? ((typeof t === 'function' && t('transcribe.backendCpu')) || 'CPU') : backend + ' GPU';
        showNotification(t('toasts.backendSwitched', { backend: backendLabel }), "success");
      }
    });
  }
}

export function toggleQuickVad(forceVal?: boolean): void {
  const current = getSettingsState();
  if (!current) return;

  const willEnable = (typeof forceVal === 'boolean') ? forceVal : !current.vad;
  if (willEnable) {
    const hasVadModel = Boolean(localScannedVadModels && localScannedVadModels.length > 0 && current.vadModel);
    if (!hasVadModel) {
      showNotification(t('toasts.noVadFound'), "warning");
      const quickVadInput = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
      if (quickVadInput) quickVadInput.checked = false;
      return;
    }
  }

  current.vad = willEnable;
  const cfgVadCheckbox = document.getElementById('opt-vad') as HTMLInputElement | null;
  if (cfgVadCheckbox) {
    cfgVadCheckbox.checked = current.vad;
  }
  const quickVadInput = document.getElementById('quick-toggle-vad') as HTMLInputElement | null;
  if (quickVadInput) {
    quickVadInput.checked = current.vad;
  }
  saveCurrentSettings();
  updateTranscribeUIConfigs();
  const vadModelName = current.vadModel ? getBasename(current.vadModel) : 'Silero VAD';
  showNotification(current.vad ? t('toasts.vadEnabled', { model: vadModelName }) : t('toasts.vadDisabled'), "info");
}

// ----------------- Auto Unload / Disposal Event Listeners -----------------
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    const current = getSettingsState();
    if (saveSettingsDebounceTimer && current) {
      clearTimeout(saveSettingsDebounceTimer);
      saveSettingsDebounceTimer = null;
      try {
        const cleanPayload = sanitizeSettingsPayload(current);
        invoke('save_settings', { settings: cleanPayload });
      } catch (_) {}
    }
  });

  window.addEventListener('pagehide', () => {
    const current = getSettingsState();
    if (saveSettingsDebounceTimer && current) {
      clearTimeout(saveSettingsDebounceTimer);
      saveSettingsDebounceTimer = null;
      try {
        const cleanPayload = sanitizeSettingsPayload(current);
        invoke('save_settings', { settings: cleanPayload });
      } catch (_) {}
    }
    const win = getGlobal();
    if (win.hardsubController && typeof win.hardsubController.dispose === 'function') {
      win.hardsubController.dispose();
    }
  });
}

// ----------------- Bindings to Window Global Object -----------------
if (typeof window !== 'undefined') {
  window.settingsState = settingsState;
  window.compiledBackends = compiledBackends;
  window.activeSettingsCat = activeSettingsCat;
  window.localScannedTransModels = localScannedTransModels;
  window.localScannedVadModels = localScannedVadModels;
  window.selectBackend = selectBackend;
  window.openModelsDirectory = openModelsDirectory;
  window.browseModelsDirectory = browseModelsDirectory;
  window.switchSettingsCategory = switchSettingsCategory;
  window.clearSettingsSearch = clearSettingsSearch;
  window.filterSettings = filterSettings;
  window.confirmResetWhisperEngine = confirmResetWhisperEngine;
  window.incrementNumber = incrementNumber;
  window.decrementNumber = decrementNumber;
  window.scanAndPopulateModels = scanAndPopulateModels;
  window.toggleOutputDirCustomField = toggleOutputDirCustomField;
  window.openCustomOutputDir = openCustomOutputDir;
  window.browseOutputDir = browseOutputDir;
  window.browseTranscribeOutputDir = browseTranscribeOutputDir;
  window.resetTranscribeOutputDir = resetTranscribeOutputDir;
  window.updateTranscribeOutputDirUI = updateTranscribeOutputDirUI;
  window.updateTranscribeUIConfigs = updateTranscribeUIConfigs;
  window.openTranscriptionSettings = openTranscriptionSettings;
  window.toggleQuickVad = toggleQuickVad;
  window.saveCurrentSettings = saveCurrentSettings;
  window.refreshSettings = refreshSettings;
  window.refreshBuildStatuses = refreshBuildStatuses;
  window.setupNumberInputControls = setupNumberInputControls;
  window.setupQuickConfigDeckEventListeners = setupQuickConfigDeckEventListeners;
}

export const settingsManager = {
  getSettingsState,
  setSettingsState,
  getCompiledBackends,
  setCompiledBackends,
  getActiveSettingsCat,
  setActiveSettingsCat,
  getLocalScannedTransModels,
  setLocalScannedTransModels,
  getLocalScannedVadModels,
  setLocalScannedVadModels,
  selectBackend,
  refreshBuildStatuses,
  openModelsDirectory,
  browseModelsDirectory,
  scanAndPopulateModels,
  switchSettingsCategory,
  clearSettingsSearch,
  executeFilterSettings,
  filterSettings,
  refreshSettings,
  bindSettingsToDOM,
  syncJsonConfidenceDependency,
  formatFFmpegVersion,
  refreshFFmpegStatus,
  INT_SETTING_KEYS,
  FLOAT_SETTING_KEYS,
  sanitizeSettingsPayload,
  saveCurrentSettings,
  confirmResetWhisperEngine,
  getStepperBounds,
  updateStepperButtonStates,
  updateAllStepperButtons,
  clampNumberSetting,
  incrementNumber,
  decrementNumber,
  setupNumberInputControls,
  toggleOutputDirCustomField,
  openCustomOutputDir,
  browseOutputDir,
  browseTranscribeOutputDir,
  resetTranscribeOutputDir,
  updateTranscribeOutputDirUI,
  updateTranscribeUIConfigs,
  openTranscriptionSettings,
  setupQuickConfigDeckEventListeners,
  toggleQuickVad,
  safeApplyDynamicDirection
};

export default settingsManager;
