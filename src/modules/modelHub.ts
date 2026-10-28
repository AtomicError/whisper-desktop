// Model Hub & Management Controller for Whisper Desktop
import { t } from '../i18n/index';
import { escapeHTML } from './logsController';
import { recommendModelsForSystem } from '../modelRecommender';

export interface ModelStatus {
  name: string;
  sizeBytes: number;
  downloadedBytes?: number;
  progress?: number;
  status: 'Downloaded' | 'Downloading' | 'Paused' | 'NotDownloaded';
}

export interface ModelMetaInfo {
  precisionText: string;
  langText: string;
  isVad: boolean;
}

export const MODEL_ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
export const MODEL_ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
export const MODEL_ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
export const MODEL_ICON_RESUME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

let currentCategoryFilter = 'recommended';
let currentModelQuickFilter = 'all';
let _cachedModelStatuses: ModelStatus[] | null = null;
let _cachedModelStatusesTime = 0;
const MODEL_STATUS_CACHE_TTL = 3500;
const _modelActionsInProgress = new Set<string>();

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): any => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

export function invalidateModelStatusesCache(): void {
  _cachedModelStatuses = null;
  _cachedModelStatusesTime = 0;
}

export function getModelMetaInfo(modelName: string): ModelMetaInfo {
  const safeName = String(modelName || '');
  const isVad = safeName.startsWith('silero-');
  let precisionText = isVad ? '' : t('models.prec16');
  if (!isVad) {
    if (safeName.includes('-q8_0')) {
      precisionText = t('models.prec8');
    } else if (safeName.includes('-q5_0') || safeName.includes('-q5_1')) {
      precisionText = t('models.prec5');
    }
  }

  let langText = t('models.langMulti');
  if (safeName.includes('.en')) {
    langText = t('models.langEnOnly');
  } else if (isVad) {
    langText = t('models.langVad');
  }

  return { precisionText, langText, isVad };
}

export function formatModelDownloadProgress(downloadedBytes: any, totalBytes: any, progressPct: any): string {
  const dlBytes = Math.max(0, Math.floor(Number(downloadedBytes) || 0));
  const total = Math.max(0, Math.floor(Number(totalBytes) || 0));
  const isSubMegabyte = (total > 0 && total < 1048576) || (total === 0 && dlBytes < 1048576);

  let sizeNum: number;
  let unitText: string;

  if (isSubMegabyte || dlBytes < 1048576) {
    sizeNum = dlBytes === 0 ? 0 : Math.max(1, Math.round(dlBytes / 1024));
    unitText = t('models.unitKB') || t('transcribe.unitKB') || 'KB';
  } else {
    sizeNum = Math.round(dlBytes / 1048576);
    unitText = t('models.unitMB') || 'MB';
  }

  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const sizeFormatted = typeof win.formatNumberForLang === 'function'
    ? win.formatNumberForLang(sizeNum)
    : String(sizeNum);
  const pctFormatted = total > 0
    ? (typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(Math.min(100, Math.round(progressPct || 0))) : String(Math.min(100, Math.round(progressPct || 0))))
    : '...';

  const liveTemplate = t('models.downloadLiveProgress', {
    size: sizeFormatted,
    unit: unitText,
    pct: pctFormatted,
    speedLabel: '',
    speed: ''
  });
  const parts = liveTemplate.split('•');
  let result = parts.length >= 1 ? parts[0].trim() : `${sizeFormatted} ${unitText} (${pctFormatted}%)`;
  if (total <= 0) {
    result = result.replace(/%\s*(\.|\u2026)+|(\.|\u2026)+\s*[%٪]/g, '...');
  }
  return result;
}

export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0 || !isFinite(seconds)) return t('models.timeUnknown');
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) {
    return t('models.timeSec', { s: typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(Math.max(1, totalSeconds)) : String(Math.max(1, totalSeconds)) });
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return t('models.timeMin', { m: typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(Math.max(1, totalMinutes)) : String(Math.max(1, totalMinutes)) });
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (remainingMinutes === 0) {
    return t('models.timeHour', { h: typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(hours) : String(hours) });
  }
  return t('models.timeHourMin', {
    h: typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(hours) : String(hours),
    m: typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(remainingMinutes) : String(remainingMinutes),
  });
}

export function renderFamilyHeaderBanner(category: string, counts = { all: 0, multi: 0, en: 0, quant: 0 }): string {
  let iconSvg = '';
  let title = '';
  let subtitle = '';
  let body = '';
  let specs = '';

  switch (category) {
    case 'recommended': {
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      title = t('models.catRecommendedTitle');
      body = t('models.catRecommendedBody');
      specs = '';
      break;
    }
    case 'tiny':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
      title = t('models.guideTinyTitle');
      subtitle = t('models.guideTinySubtitle');
      body = t('models.guideTinyBody');
      specs = t('models.guideTinySpecs');
      break;
    case 'base':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="15" x2="23" y2="15"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="15" x2="4" y2="15"/></svg>`;
      title = t('models.guideBaseTitle');
      subtitle = t('models.guideBaseSubtitle');
      body = t('models.guideBaseBody');
      specs = t('models.guideBaseSpecs');
      break;
    case 'small':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
      title = t('models.guideSmallTitle');
      subtitle = t('models.guideSmallSubtitle');
      body = t('models.guideSmallBody');
      specs = t('models.guideSmallSpecs');
      break;
    case 'medium':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;
      title = t('models.guideMediumTitle');
      subtitle = t('models.guideMediumSubtitle');
      body = t('models.guideMediumBody');
      specs = t('models.guideMediumSpecs');
      break;
    case 'large':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z"/></svg>`;
      title = t('models.guideLargeTitle');
      subtitle = t('models.guideLargeSubtitle');
      body = t('models.guideLargeBody');
      specs = t('models.guideLargeSpecs');
      break;
    case 'vad':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
      title = t('models.badgeVadTitle');
      subtitle = t('models.guideVadSubtitle');
      body = t('models.guideVadBody');
      specs = t('models.guideVadSpecs');
      break;
    case 'local':
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      title = t('models.catLocal');
      subtitle = t('models.catLocalSubtitle');
      body = t('models.subtitle');
      break;
    case 'all':
    default:
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
      title = t('models.catAll');
      subtitle = t('models.title');
      body = t('models.subtitle');
      break;
  }

  const specsHtml = specs ? `<div class="model-family-specs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; opacity:0.85;"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><span>${escapeHTML(specs)}</span></div>` : '';

  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const formatNum = (n: number) => typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(n) : String(n);

  let filterBarHtml = '';
  if (category === 'vad') {
    filterBarHtml = `
      <div class="model-banner-filters">
        <div class="model-filter-info-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          <span>${escapeHTML(t('models.badgeVadTitle'))} (${formatNum(counts.all)})</span>
        </div>
      </div>
    `;
  } else if (category === 'recommended') {
    filterBarHtml = '';
  } else if (counts.all > 0) {
    const isAll = currentModelQuickFilter === 'all' ? 'active' : '';
    const isMulti = currentModelQuickFilter === 'multi' ? 'active' : '';
    const isEn = currentModelQuickFilter === 'en' ? 'active' : '';
    const isQuant = currentModelQuickFilter === 'quant' ? 'active' : '';

    const labelAll = t('models.filterAll');
    const labelMulti = t('models.filterMulti');
    const labelEn = t('models.filterEn');
    const labelQuant = t('models.filterQuant');
    const enTooltip = t('models.filterEnTooltip');
    const quantTooltip = t('models.filterQuantTooltip');

    const showMulti = counts.multi > 0 && counts.multi < counts.all;
    const showEn = counts.en > 0 && counts.en < counts.all;
    const showQuant = counts.quant > 0 && counts.quant < counts.all;

    filterBarHtml = `
      <div class="model-banner-filters">
        <div class="model-segmented-control" role="tablist" aria-label="${escapeHTML(labelAll)}">
          <button type="button" class="model-segment-btn ${isAll}" role="tab" aria-selected="${isAll ? 'true' : 'false'}" onclick="switchModelQuickFilter('all')">
            <span>${escapeHTML(labelAll)}</span>
            <span class="segment-count">${formatNum(counts.all)}</span>
          </button>
          ${showMulti ? `
            <button type="button" class="model-segment-btn ${isMulti}" role="tab" aria-selected="${isMulti ? 'true' : 'false'}" onclick="switchModelQuickFilter('multi')">
              <span>${escapeHTML(labelMulti)}</span>
              <span class="segment-count">${formatNum(counts.multi)}</span>
            </button>
          ` : ''}
          ${showEn ? `
            <button type="button" class="model-segment-btn ${isEn}" role="tab" aria-selected="${isEn ? 'true' : 'false'}" onclick="switchModelQuickFilter('en')" title="${escapeHTML(enTooltip)}">
              <span>${escapeHTML(labelEn)}</span>
              <span class="segment-count">${formatNum(counts.en)}</span>
            </button>
          ` : ''}
          ${showQuant ? `
            <button type="button" class="model-segment-btn ${isQuant}" role="tab" aria-selected="${isQuant ? 'true' : 'false'}" onclick="switchModelQuickFilter('quant')" title="${escapeHTML(quantTooltip)}">
              <span>${escapeHTML(labelQuant)}</span>
              <span class="segment-count">${formatNum(counts.quant)}</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  return `
    <div class="model-family-banner">
      <div class="model-family-banner-top">
        <div class="model-family-identity">
          <div class="model-family-icon">${iconSvg}</div>
          <div class="model-family-title-wrap">
            <span class="model-family-title">${escapeHTML(title)}</span>
            ${subtitle ? `<span class="model-family-subtitle">${escapeHTML(subtitle)}</span>` : ''}
          </div>
        </div>
        ${specsHtml}
      </div>
      ${body ? `<p class="model-family-body">${body}</p>` : ''}
      ${filterBarHtml}
    </div>
  `;
}

export function switchModelQuickFilter(filter: string): void {
  currentModelQuickFilter = filter;
  loadModelStatusesGrid(true);
}

export function switchModelCategory(category: string, clearSearch = true): void {
  currentCategoryFilter = category;
  currentModelQuickFilter = 'all';
  
  if (clearSearch && typeof document !== 'undefined') {
    const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    if (searchInput) {
      searchInput.value = '';
      if (win.applyDynamicDirection) win.applyDynamicDirection(searchInput);
    }
    const clearBtn = document.getElementById('model-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  if (typeof document !== 'undefined') {
    const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    const activeBtn = document.getElementById(`model-cat-${category}`);
    if (activeBtn) activeBtn.classList.add('active');

    const gridScroll = document.getElementById('models-list-scroll');
    if (gridScroll) gridScroll.scrollTop = 0;
  }
  
  loadModelStatusesGrid();
}

export function clearModelSearch(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
  const clearBtn = document.getElementById('model-search-clear');
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  if (clearBtn) clearBtn.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    if (win.applyDynamicDirection) win.applyDynamicDirection(searchInput);
    searchInput.focus();
  }
  loadModelStatusesGrid();
}

export async function loadModelStatusesGrid(isSilent = false, forceRefresh = false): Promise<void> {
  if (typeof document === 'undefined') return;
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const invoke = getTauriInvoke();
  if (!invoke) return;

  let settingsState = win.settingsState;
  if (!settingsState) {
    try {
      settingsState = await invoke('load_settings');
      win.settingsState = settingsState;
    } catch (e) {
      console.error("Failed to load settings in loadModelStatusesGrid:", e);
      return;
    }
  }

  const modelsDir = settingsState?.modelsDir || (document.getElementById('opt-modelsDir') as HTMLInputElement)?.value;
  if (!modelsDir) return;

  let systemSpecs = win.systemSpecs;
  if (!systemSpecs) {
    try {
      systemSpecs = await invoke('get_system_specs');
      win.systemSpecs = systemSpecs;
    } catch (e) {
      console.error("Failed to load system specs:", e);
      systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
      win.systemSpecs = systemSpecs;
    }
  }

  const specsSubtitle = document.getElementById('model-specs-subtitle');
  if (specsSubtitle && systemSpecs) {
    const gpuLabelMap: Record<string, string> = {
      'nvidia': t('models.gpuNvidia'),
      'amd': t('models.gpuAmd'),
      'intel': t('models.gpuIntel'),
      'apple_silicon': t('models.gpuAppleSilicon'),
      'unknown': t('models.gpuCpuOnly')
    };
    const hasDetailedGpuName = systemSpecs.gpu_name && systemSpecs.gpu_name !== 'CPU Only' && systemSpecs.gpu_name !== 'Unknown';
    const gpuDisplayName = hasDetailedGpuName ? systemSpecs.gpu_name : (gpuLabelMap[systemSpecs.gpu_type] || systemSpecs.gpu_type || t('models.gpuUnknown'));
    const ramVal = systemSpecs.total_ram_gb;
    const ramFormatted = (ramVal % 1 === 0 ? ramVal.toFixed(0) : parseFloat(ramVal.toFixed(1)).toString());
    const formatNum = (v: any) => typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(v) : String(v);

    specsSubtitle.innerHTML = t('models.systemSpecsDetected', {
      ram: formatNum(ramFormatted),
      cores: formatNum(systemSpecs.cpu_cores),
      gpu: escapeHTML(gpuDisplayName)
    });
  }
  
  try {
    const now = Date.now();
    let statuses = _cachedModelStatuses;
    if (forceRefresh || !statuses || (now - _cachedModelStatusesTime > MODEL_STATUS_CACHE_TTL)) {
      statuses = await invoke('get_all_models_status', { modelsDir });
      _cachedModelStatuses = statuses;
      _cachedModelStatusesTime = now;
    }

    const grid = document.getElementById('models-list-scroll') as any;
    if (!grid) return;
    
    const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    const recResult = recommendModelsForSystem(systemSpecs);
    const recMap = new Map();
    if (recResult && recResult.models) {
      recMap.set(recResult.models.balanced.modelName, recResult.models.balanced);
      recMap.set(recResult.models.quality.modelName, recResult.models.quality);
      recMap.set(recResult.models.fast.modelName, recResult.models.fast);
      recMap.set(recResult.models.english.modelName, recResult.models.english);
      recMap.set(recResult.models.quantized.modelName, recResult.models.quantized);
    }

    const categoryModels = (statuses || []).filter(m => {
      if (query) {
        const fullName = `ggml-${m.name}.bin`;
        const searchTarget = `${m.name} ${fullName}`.toLowerCase();
        if (!searchTarget.includes(query)) return false;
      }
      if (currentCategoryFilter === 'local') {
        return m.status === 'Downloaded';
      } else if (!query) {
        if (currentCategoryFilter === 'recommended') return recResult ? recResult.modelNames.includes(m.name) : false;
        if (currentCategoryFilter === 'tiny') return m.name.startsWith("tiny");
        if (currentCategoryFilter === 'base') return m.name.startsWith("base");
        if (currentCategoryFilter === 'small') return m.name.startsWith("small");
        if (currentCategoryFilter === 'medium') return m.name.startsWith("medium");
        if (currentCategoryFilter === 'large') return m.name.startsWith("large");
        if (currentCategoryFilter === 'vad') return m.name.startsWith("silero-");
      }
      return true;
    });

    if (currentCategoryFilter === 'recommended' && !query && recResult && recResult.models) {
      const order = [
        recResult.models.balanced.modelName,
        recResult.models.quality.modelName,
        recResult.models.fast.modelName,
        recResult.models.english.modelName,
        recResult.models.quantized.modelName
      ];
      categoryModels.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    }

    const counts = {
      all: categoryModels.length,
      multi: categoryModels.filter(m => !m.name.includes('.en') && !m.name.startsWith('silero-')).length,
      en: categoryModels.filter(m => m.name.includes('.en')).length,
      quant: categoryModels.filter(m => m.name.includes('-q5') || m.name.includes('-q8')).length
    };

    const showMulti = counts.multi > 0 && counts.multi < counts.all;
    const showEn = counts.en > 0 && counts.en < counts.all;
    const showQuant = counts.quant > 0 && counts.quant < counts.all;

    if (currentCategoryFilter !== 'recommended') {
      if (currentModelQuickFilter === 'en' && !showEn) {
        currentModelQuickFilter = 'all';
      } else if (currentModelQuickFilter === 'multi' && !showMulti) {
        currentModelQuickFilter = 'all';
      } else if (currentModelQuickFilter === 'quant' && !showQuant) {
        currentModelQuickFilter = 'all';
      }
    }

    grid.innerHTML = '';

    if (!query) {
      const bannerHtml = renderFamilyHeaderBanner(currentCategoryFilter, counts);
      if (bannerHtml) {
        grid.insertAdjacentHTML('beforeend', bannerHtml);
      }
    }

    if (!grid._modelDelegate) {
      grid.addEventListener('click', function(e: MouseEvent) {
        const target = e.target as HTMLElement;
        const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
        if (!btn) return;
        const card = btn.closest('[data-model]') as HTMLElement | null;
        if (!card) return;
        const name = card.dataset.model;
        if (!name) return;
        switch (btn.dataset.action) {
          case 'delete': deleteModelClick(name); break;
          case 'pause':  pauseModelClick(name); break;
          case 'download': downloadModelClick(name); break;
        }
      });
      grid._modelDelegate = true;
    }
    
    let renderedCount = 0;
    const formatNum = (v: any) => typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(v) : String(v);

    categoryModels.forEach(m => {
      if (currentCategoryFilter !== 'recommended') {
        if (currentModelQuickFilter === 'multi') {
          if (m.name.includes('.en') || m.name.startsWith('silero-')) return;
        } else if (currentModelQuickFilter === 'en') {
          if (!m.name.includes('.en')) return;
        } else if (currentModelQuickFilter === 'quant') {
          if (!m.name.includes('-q5') && !m.name.includes('-q8')) return;
        }
      }

      const card = document.createElement('div');
      card.className = 'setting-card';
      card.dataset.name = m.name;
      card.setAttribute('data-model', m.name);
      const sizeMB = Math.max(1, Math.round((m.sizeBytes || 0) / 1048576));
      card.dataset.sizeMb = String(sizeMB);
      const dlBytes = m.downloadedBytes || 0;
      const pct = Math.round((m.progress || 0) * 100);
      const safeName = escapeHTML(m.name);
      const meta = getModelMetaInfo(m.name);

      let actionButtons = '';
      if (m.status === 'Downloaded') {
        actionButtons = `
          <button class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDeleteModel', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDelete')}</span></button>
        `;
      } else if (m.status === 'Downloading') {
        actionButtons = `
          <button class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: safeName })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>
        `;
      } else if (m.status === 'Paused') {
        actionButtons = `
          <button class="model-action-btn model-btn-resume" data-action="download" aria-label="${t('models.ariaResumeDownload', { name: safeName })}">${MODEL_ICON_RESUME}<span>${t('models.actionResume')}</span></button>
          <button class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDiscardDownload', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDiscard')}</span></button>
        `;
      } else {
        actionButtons = `
          <button class="model-action-btn model-btn-download" data-action="download" aria-label="${t('models.ariaDownloadModel', { name: safeName })}">${MODEL_ICON_DOWNLOAD}<span>${t('models.actionDownload')}</span></button>
        `;
      }
      
      const showProgressBlock = m.status === 'Downloading' || m.status === 'Paused' ? 'block' : 'none';
      
      let badgeHtml = '';
      if (m.name.startsWith('silero-')) {
        badgeHtml = `<span class="model-badge model-badge-vad" title="${t('models.badgeVadTitle')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg><span>${t('models.badgeVad')}</span></span>`;
      }

      let statusBadge = '';
      if (m.status === 'Downloaded') {
        statusBadge = `<span class="model-badge badge-installed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>${t('models.installedBadge')}</span></span>`;
      } else if (m.status === 'Downloading') {
        statusBadge = `<span class="model-badge badge-downloading">${t('models.badgeDownloading')}</span>`;
      } else if (m.status === 'Paused') {
        statusBadge = `<span class="model-badge badge-paused">${t('models.badgePaused')}</span>`;
      }

      const recInfo = recMap.get(m.name);
      let recBadgeHtml = '';
      if (recInfo) {
        const roleClass = `model-badge-rec-${recInfo.role}`;
        const roleLabel = t(recInfo.badgeI18nKey) || recInfo.role;
        let roleIcon = '';
        if (recInfo.role === 'balanced') {
          roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
        } else if (recInfo.role === 'quality') {
          roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`;
        } else if (recInfo.role === 'fast') {
          roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
        } else if (recInfo.role === 'english') {
          roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
        } else if (recInfo.role === 'quantized') {
          roleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
        }
        recBadgeHtml = `<span class="model-badge model-badge-rec ${roleClass}">${roleIcon}<span>${escapeHTML(roleLabel)}</span></span>`;
      }

      let recReasonHtml = '';
      if (recInfo && (currentCategoryFilter === 'recommended' || !query)) {
        const reasonText = t(recInfo.reasonI18nKey) || recInfo.reasonFallback;
        recReasonHtml = `<div class="model-rec-description">${escapeHTML(reasonText)}</div>`;
      }

      card.innerHTML = `
        <div class="setting-info" style="flex-grow: 1; padding-inline-end: 20px;">
          <div class="setting-label-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <span class="setting-title" style="font-size: 1.05rem; font-weight: 600; color: #fff;">ggml-${safeName}.bin</span>
            ${recBadgeHtml}
            ${badgeHtml}
          </div>
          <div class="setting-desc" style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${statusBadge}
            ${statusBadge ? '<span style="color: rgba(255,255,255,0.1);">|</span>' : ''}
            <span>${m.status === 'Downloaded' ? (t('models.installedSize', { size: formatNum(sizeMB) }) || `${sizeMB} MB`) : t('models.expectedSize', { size: formatNum(sizeMB) })}</span>
            ${meta.precisionText ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span>${meta.precisionText}</span>
            ` : ''}
            <span style="color: rgba(255,255,255,0.1);">|</span>
            <span>${meta.langText}</span>
          </div>
          ${recReasonHtml}
          <div class="model-progress-block" style="display: ${showProgressBlock};">
            <div class="model-progress-status ${m.status === 'Paused' ? 'status-paused' : 'status-downloading'}">
              ${m.status === 'Downloading' ? (
                dlBytes <= 0
                  ? t('models.statusConnecting')
                  : `${formatModelDownloadProgress(dlBytes, m.sizeBytes, pct)} • ${(t('models.statusInProgress', { size: '', pct: '' }).split('•')[1] || t('models.statusConnecting')).trim()}`
              ) : ''}
              ${m.status === 'Paused' ? (
                dlBytes <= 0
                  ? t('models.badgePaused')
                  : `${formatModelDownloadProgress(dlBytes, m.sizeBytes, pct)} • ${(t('models.statusPaused', { size: '', pct: '' }).split('•')[1] || t('models.badgePaused')).trim()}`
              ) : ''}
            </div>
            <div class="progress-bar-container" style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.05); overflow: hidden; border: 1px solid rgba(255,255,255,0.02);">
              <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: ${m.status === 'Downloading' ? 'var(--color-cyan)' : 'var(--color-gold)'}; box-shadow: ${m.status === 'Downloading' ? 'var(--shadow-neon-cyan)' : 'var(--shadow-neon-gold)'}; transition: width 0.3s ease;"></div>
            </div>
          </div>
        </div>
        <div class="setting-control" style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-shrink: 0; min-width: 160px;">
          ${actionButtons}
        </div>
      `;
      grid.appendChild(card);
      renderedCount++;
    });

    if (renderedCount === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'models-empty-state';
      emptyDiv.style.padding = '48px 20px';
      emptyDiv.innerHTML = `
        <div class="models-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
        </div>
        <div class="models-empty-title">${t('models.emptyTitle')}</div>
        <div class="models-empty-desc">${query ? t('models.emptyDescQuery', { query: escapeHTML(query) }) : t('models.emptyDescCategory')}</div>
        ${query ? `<button type="button" class="btn-secondary btn-sm" onclick="clearModelSearch()" style="margin-top: 8px;">${t('models.emptyClearSearch')}</button>` : ''}
      `;
      grid.appendChild(emptyDiv);
    }
  } catch (err) {
    console.error("Failed to load model statuses:", err);
  }
}

export function filterModelsGrid(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  if (searchInput && win.applyDynamicDirection) {
    win.applyDynamicDirection(searchInput);
  }
  const clearBtn = document.getElementById('model-search-clear');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

  const fn: any = filterModelsGrid;
  if (fn._timer) clearTimeout(fn._timer);
  fn._timer = setTimeout(() => {
    fn._timer = null;
    loadModelStatusesGrid();
  }, 250);
}

export async function downloadModelClick(name: string): Promise<void> {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const invoke = getTauriInvoke();
  const showNotification = win.showNotification;
  const modelsDir = win.settingsState?.modelsDir || (typeof document !== 'undefined' ? (document.getElementById('opt-modelsDir') as HTMLInputElement)?.value : undefined);

  if (!modelsDir || _modelActionsInProgress.has(name) || !invoke) return;
  _modelActionsInProgress.add(name);
  try {
    if (showNotification) showNotification(t('toasts.modelDownloadStarted', { name: `ggml-${name}.bin` }), "info");
    _cachedModelStatuses = null;

    const card = document.querySelector(`[data-model="${name}"]`);
    if (card) {
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl) {
        ctrlEl.innerHTML = `<button class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: escapeHTML(name) })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>`;
      }
      const progressBlock = card.querySelector('.model-progress-block') as HTMLElement | null;
      if (progressBlock) progressBlock.style.display = 'block';
      const statusEl = card.querySelector('.model-progress-status') as HTMLElement | null;
      if (statusEl) {
        if (!statusEl.textContent?.trim()) {
          statusEl.textContent = t('models.statusStarting');
        } else if (statusEl.textContent.includes('•')) {
          const parts = statusEl.textContent.split('•');
          statusEl.textContent = `${parts[0].trim()} • ${t('models.statusConnecting')}`;
        } else {
          statusEl.textContent = t('models.statusStarting');
        }
        statusEl.classList.remove('status-paused');
        statusEl.classList.add('status-downloading');
        statusEl.style.color = '';
      }
      const barFill = card.querySelector('.progress-bar-fill') as HTMLElement | null;
      if (barFill) {
        barFill.style.background = 'var(--color-cyan)';
        barFill.style.boxShadow = 'var(--shadow-neon-cyan)';
      }
    }

    await invoke('start_download_model_task', {
      modelsDir,
      modelName: name
    });
  } catch (err: any) {
    if (showNotification) showNotification(t('toasts.modelDownloadStartError', { error: String(err) }), "error");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
  } finally {
    _modelActionsInProgress.delete(name);
  }
}

export async function pauseModelClick(name: string): Promise<void> {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const invoke = getTauriInvoke();
  const showNotification = win.showNotification;
  if (_modelActionsInProgress.has(name) || !invoke) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('pause_download_model', { modelName: name });
    if (showNotification) showNotification(t('toasts.modelDownloadPaused', { name: `ggml-${name}.bin` }), "info");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
  } catch (err: any) {
    if (showNotification) showNotification(t('toasts.modelDownloadPauseError', { error: String(err) }), "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
}

export async function deleteModelClick(name: string): Promise<void> {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const invoke = getTauriInvoke();
  const showNotification = win.showNotification;
  const showConfirmModal = win.showConfirmModal;
  const modelsDir = win.settingsState?.modelsDir || (typeof document !== 'undefined' ? (document.getElementById('opt-modelsDir') as HTMLInputElement)?.value : undefined);

  if (_modelActionsInProgress.has(name) || !invoke || !modelsDir) return;
  if (showConfirmModal) {
    const confirmed = await showConfirmModal(
      t('modals.confirmDeleteModelTitle'),
      t('modals.confirmDeleteModelDesc', { name }),
      t('modals.deleteBtn')
    );
    if (!confirmed) return;
  }
  _modelActionsInProgress.add(name);
  try {
    await invoke('delete_model_file', {
      modelsDir,
      modelName: name
    });
    if (showNotification) showNotification(t('toasts.modelDeleted', { name: `ggml-${name}.bin` }), "success");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
    if (typeof win.scanAndPopulateModels === 'function') {
      await win.scanAndPopulateModels();
    }
  } catch (err: any) {
    if (showNotification) showNotification(t('toasts.modelDeleteError', { error: String(err) }), "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
}

// Bind to window for HTML onclick/oninput handlers
if (typeof window !== 'undefined') {
  (window as any).switchModelQuickFilter = switchModelQuickFilter;
  (window as any).switchModelCategory = switchModelCategory;
  (window as any).clearModelSearch = clearModelSearch;
  (window as any).loadModelStatusesGrid = loadModelStatusesGrid;
  (window as any).filterModelsGrid = filterModelsGrid;
  (window as any).downloadModelClick = downloadModelClick;
  (window as any).pauseModelClick = pauseModelClick;
  (window as any).deleteModelClick = deleteModelClick;
  (window as any).formatModelDownloadProgress = formatModelDownloadProgress;
  (window as any).formatRemainingTime = formatRemainingTime;
  (window as any).getModelMetaInfo = getModelMetaInfo;
  (window as any).invalidateModelStatusesCache = invalidateModelStatusesCache;
  (window as any).renderFamilyHeaderBanner = renderFamilyHeaderBanner;
}

export const modelHub = {
  loadStatuses: loadModelStatusesGrid,
  download: downloadModelClick,
  pause: pauseModelClick,
  delete: deleteModelClick,
  filter: filterModelsGrid,
  setCategory: switchModelCategory,
  setQuickFilter: switchModelQuickFilter,
  setFilter: switchModelQuickFilter,
  clearSearch: clearModelSearch,
  getMetaInfo: getModelMetaInfo,
  formatProgress: formatModelDownloadProgress,
  formatRemainingTime,
  renderBanner: renderFamilyHeaderBanner,
  invalidateCache: invalidateModelStatusesCache,
  ICONS: {
    DOWNLOAD: MODEL_ICON_DOWNLOAD,
    DELETE: MODEL_ICON_DELETE,
    PAUSE: MODEL_ICON_PAUSE,
    RESUME: MODEL_ICON_RESUME
  }
};
