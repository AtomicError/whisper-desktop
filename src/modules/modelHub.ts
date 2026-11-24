// Model Hub & Management Controller for Whisper Desktop
import { t } from '../i18n/index';
import { escapeHTML } from './logsController';
import { recommendModelsForSystem } from '../modelRecommender';

export interface ModelStatus {
  name: string;
  sizeBytes: number;
  downloadedBytes?: number;
  progress?: number;
  verifying?: boolean;
  status: 'Downloaded' | 'Downloading' | 'Paused' | 'NotDownloaded' | 'Not Downloaded';
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
let _loadModelsSeq = 0;
let _filterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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
    const quickFilterAria = t('models.quickFilterLabel');
    const labelMulti = t('models.filterMulti');
    const labelEn = t('models.filterEn');
    const labelQuant = t('models.filterQuant');
    const enTooltip = t('models.filterEnTooltip');
    const quantTooltip = t('models.filterQuantTooltip');

    const showMulti = counts.multi > 0 && counts.multi < counts.all;
    const showEn = counts.en > 0 && counts.en < counts.all;
    const showQuant = counts.quant > 0 && counts.quant < counts.all;

    if (showMulti || showEn || showQuant) {
      filterBarHtml = `
        <div class="model-banner-filters">
          <div class="model-segmented-control" role="tablist" aria-orientation="horizontal" aria-label="${escapeHTML(quickFilterAria)}">
            <button type="button" class="model-segment-btn ${isAll}" role="tab" aria-selected="${isAll ? 'true' : 'false'}" tabindex="${isAll ? '0' : '-1'}" data-quick-filter="all">
              <span>${escapeHTML(labelAll)}</span>
              <span class="segment-count">${formatNum(counts.all)}</span>
            </button>
            ${showMulti ? `
              <button type="button" class="model-segment-btn ${isMulti}" role="tab" aria-selected="${isMulti ? 'true' : 'false'}" tabindex="${isMulti ? '0' : '-1'}" data-quick-filter="multi">
                <span>${escapeHTML(labelMulti)}</span>
                <span class="segment-count">${formatNum(counts.multi)}</span>
              </button>
            ` : ''}
            ${showEn ? `
              <button type="button" class="model-segment-btn ${isEn}" role="tab" aria-selected="${isEn ? 'true' : 'false'}" tabindex="${isEn ? '0' : '-1'}" data-quick-filter="en" title="${escapeHTML(enTooltip)}">
                <span>${escapeHTML(labelEn)}</span>
                <span class="segment-count">${formatNum(counts.en)}</span>
              </button>
            ` : ''}
            ${showQuant ? `
              <button type="button" class="model-segment-btn ${isQuant}" role="tab" aria-selected="${isQuant ? 'true' : 'false'}" tabindex="${isQuant ? '0' : '-1'}" data-quick-filter="quant" title="${escapeHTML(quantTooltip)}">
                <span>${escapeHTML(labelQuant)}</span>
                <span class="segment-count">${formatNum(counts.quant)}</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }
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

function cancelModelSearchDebounce(): void {
  if (_filterDebounceTimer !== null) {
    clearTimeout(_filterDebounceTimer);
    _filterDebounceTimer = null;
  }
}

export function switchModelQuickFilter(filter: string): void {
  currentModelQuickFilter = filter;
  loadModelStatusesGrid(true);
}

export function switchModelCategory(category: string, clearSearch = true): void {
  currentCategoryFilter = category;
  currentModelQuickFilter = 'all';

  if (clearSearch) {
    cancelModelSearchDebounce();
  }

  if (clearSearch && typeof document !== 'undefined') {
    const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
    const win = getGlobal();
    if (searchInput) {
      searchInput.value = '';
      if (win.applyDynamicDirection) win.applyDynamicDirection(searchInput);
    }
    const clearBtn = document.getElementById('model-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  if (typeof document !== 'undefined') {
    const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
    buttons.forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('tabindex', '-1');
    });

    const activeBtn = document.getElementById(`model-cat-${category}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
      activeBtn.setAttribute('tabindex', '0');
    }

    const gridScroll = document.getElementById('models-list-scroll');
    if (gridScroll) {
      gridScroll.scrollTop = 0;
      if (typeof gridScroll.setAttribute === 'function') {
        gridScroll.setAttribute('aria-labelledby', `model-cat-${category}`);
      }
    }
  }

  loadModelStatusesGrid();
}

export function clearModelSearch(): void {
  if (typeof document === 'undefined') return;
  cancelModelSearchDebounce();
  const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
  const clearBtn = document.getElementById('model-search-clear');
  const win = getGlobal();
  if (clearBtn) clearBtn.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    if (win.applyDynamicDirection) win.applyDynamicDirection(searchInput);
    searchInput.focus();
  }
  loadModelStatusesGrid();
}

function formatNumForLang(value: number | string): string {
  const win = getGlobal();
  return typeof win.formatNumberForLang === 'function' ? win.formatNumberForLang(value) : String(value);
}

function escapeAttrSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, '\\$&');
}

function updateSpecsSubtitle(systemSpecs: any): void {
  const specsSubtitle = document.getElementById('model-specs-subtitle');
  if (!specsSubtitle || !systemSpecs) return;

  const gpuLabelMap: Record<string, string> = {
    nvidia: t('models.gpuNvidia'),
    amd: t('models.gpuAmd'),
    intel: t('models.gpuIntel'),
    apple_silicon: t('models.gpuAppleSilicon'),
    unknown: t('models.gpuCpuOnly')
  };
  const hasDetailedGpuName = systemSpecs.gpu_name && systemSpecs.gpu_name !== 'CPU Only' && systemSpecs.gpu_name !== 'Unknown';
  const gpuDisplayName = hasDetailedGpuName
    ? systemSpecs.gpu_name
    : (gpuLabelMap[systemSpecs.gpu_type] || systemSpecs.gpu_type || t('models.gpuUnknown'));
  const ramVal = Number(systemSpecs.total_ram_gb) || 8;
  const ramFormatted = ramVal % 1 === 0 ? ramVal.toFixed(0) : parseFloat(ramVal.toFixed(1)).toString();

  // Detach data-i18n so language switches/translateDOM do not overwrite the dynamic hardware summary
  specsSubtitle.removeAttribute('data-i18n');
  specsSubtitle.innerHTML = t('models.systemSpecsDetected', {
    ram: formatNumForLang(ramFormatted),
    cores: formatNumForLang(systemSpecs.cpu_cores),
    gpu: escapeHTML(gpuDisplayName)
  });
}

function filterCategoryModels(
  statuses: ModelStatus[],
  query: string,
  recResult: ReturnType<typeof recommendModelsForSystem> | null
): ModelStatus[] {
  const filtered = statuses.filter(m => {
    if (query) {
      const fullName = `ggml-${m.name}.bin`;
      return `${m.name} ${fullName}`.toLowerCase().includes(query);
    }
    if (currentCategoryFilter === 'local') return m.status === 'Downloaded';
    if (currentCategoryFilter === 'recommended') return recResult ? recResult.modelNames.includes(m.name) : false;
    if (currentCategoryFilter === 'tiny') return m.name.startsWith('tiny');
    if (currentCategoryFilter === 'base') return m.name.startsWith('base');
    if (currentCategoryFilter === 'small') return m.name.startsWith('small');
    if (currentCategoryFilter === 'medium') return m.name.startsWith('medium');
    if (currentCategoryFilter === 'large') return m.name.startsWith('large');
    if (currentCategoryFilter === 'vad') return m.name.startsWith('silero-');
    return true;
  });

  if (currentCategoryFilter === 'recommended' && !query && recResult?.models) {
    const order = [
      recResult.models.balanced.modelName,
      recResult.models.quality.modelName,
      recResult.models.fast.modelName,
      recResult.models.english.modelName,
      recResult.models.quantized.modelName
    ];
    filtered.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  }

  return filtered;
}

function matchesQuickFilter(modelName: string, query: string): boolean {
  if (query || currentCategoryFilter === 'recommended') return true;
  if (currentModelQuickFilter === 'multi') {
    return !modelName.includes('.en') && !modelName.startsWith('silero-');
  }
  if (currentModelQuickFilter === 'en') {
    return modelName.includes('.en');
  }
  if (currentModelQuickFilter === 'quant') {
    return modelName.includes('-q5') || modelName.includes('-q8');
  }
  return true;
}

export function buildActionButtonsHtml(modelName: string, status: string): string {
  const safeName = escapeHTML(modelName);
  if (status === 'Downloaded') {
    return `<button type="button" class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDeleteModel', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDelete')}</span></button>`;
  }
  if (status === 'Downloading') {
    return `<button type="button" class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: safeName })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>`;
  }
  if (status === 'Paused') {
    return `
      <button type="button" class="model-action-btn model-btn-resume" data-action="download" aria-label="${t('models.ariaResumeDownload', { name: safeName })}">${MODEL_ICON_RESUME}<span>${t('models.actionResume')}</span></button>
      <button type="button" class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDiscardDownload', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDiscard')}</span></button>
    `;
  }
  return `<button type="button" class="model-action-btn model-btn-download" data-action="download" aria-label="${t('models.ariaDownloadModel', { name: safeName })}">${MODEL_ICON_DOWNLOAD}<span>${t('models.actionDownload')}</span></button>`;
}

export function buildModelDescriptionHtml(modelName: string, status: string, sizeMB: number | string): string {
  const meta = getModelMetaInfo(modelName);
  let statusBadge = '';
  if (status === 'Downloaded') {
    statusBadge = `<span class="model-badge badge-installed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>${t('models.installedBadge')}</span></span>`;
  } else if (status === 'Downloading') {
    statusBadge = `<span class="model-badge badge-downloading">${t('models.badgeDownloading')}</span>`;
  } else if (status === 'Paused') {
    statusBadge = `<span class="model-badge badge-paused">${t('models.badgePaused')}</span>`;
  }

  const sizeText = status === 'Downloaded'
    ? (t('models.installedSize', { size: formatNumForLang(sizeMB) }) || `${sizeMB} MB`)
    : t('models.expectedSize', { size: formatNumForLang(sizeMB) });

  return `
    ${statusBadge}
    ${statusBadge ? '<span style="color: rgba(255,255,255,0.1);">|</span>' : ''}
    <span>${sizeText}</span>
    ${meta.precisionText ? `
      <span style="color: rgba(255,255,255,0.1);">|</span>
      <span>${meta.precisionText}</span>
    ` : ''}
    <span style="color: rgba(255,255,255,0.1);">|</span>
    <span>${meta.langText}</span>
  `;
}

function buildRecBadgeHtml(recInfo: any): string {
  if (!recInfo) return '';
  const roleClass = `model-badge-rec-${recInfo.role}`;
  const roleLabel = t(recInfo.badgeI18nKey) || recInfo.role;
  const iconMap: Record<string, string> = {
    balanced: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    quality: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>`,
    fast: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    english: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    quantized: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`
  };
  return `<span class="model-badge model-badge-rec ${roleClass}">${iconMap[recInfo.role] || ''}<span>${escapeHTML(roleLabel)}</span></span>`;
}

function formatCardProgressStatus(m: ModelStatus, dlBytes: number, pct: number, isVerifying: boolean): string {
  if (m.status === 'Downloading') {
    if (isVerifying) return t('models.statusVerifying');
    if (dlBytes <= 0) return t('models.statusConnecting');
    const suffix = (t('models.statusInProgress', { size: '', pct: '' }).split('•')[1] || t('models.statusConnecting')).trim();
    return `${formatModelDownloadProgress(dlBytes, m.sizeBytes, pct)} • ${suffix}`;
  }
  if (m.status === 'Paused') {
    if (dlBytes <= 0) return t('models.badgePaused');
    const suffix = (t('models.statusPaused', { size: '', pct: '' }).split('•')[1] || t('models.badgePaused')).trim();
    return `${formatModelDownloadProgress(dlBytes, m.sizeBytes, pct)} • ${suffix}`;
  }
  return '';
}

function buildModelCardElement(m: ModelStatus, recInfo: any): HTMLElement {
  const card = document.createElement('div');
  card.className = 'setting-card';
  card.setAttribute('data-model', m.name);
  card.dataset.status = m.status;

  const sizeMB = Math.max(1, Math.round((m.sizeBytes || 0) / 1048576));
  card.dataset.sizeMb = String(sizeMB);

  const dlBytes = m.downloadedBytes || 0;
  const isVerifying = m.status === 'Downloading' && Boolean(m.verifying);
  const pct = isVerifying ? 100 : Math.round((m.progress || 0) * 100);
  const safeName = escapeHTML(m.name);
  const showProgressBlock = m.status === 'Downloading' || m.status === 'Paused' ? 'block' : 'none';

  const vadBadgeHtml = m.name.startsWith('silero-')
    ? `<span class="model-badge model-badge-vad" title="${t('models.badgeVadTitle')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg><span>${t('models.badgeVad')}</span></span>`
    : '';
  const recReasonHtml = recInfo
    ? `<div class="model-rec-description">${escapeHTML(t(recInfo.reasonI18nKey) || recInfo.reasonFallback)}</div>`
    : '';
  const progressStatusHtml = formatCardProgressStatus(m, dlBytes, pct, isVerifying);
  const barBg = m.status === 'Downloading' ? 'var(--color-cyan)' : 'var(--color-gold)';
  const barShadow = m.status === 'Downloading' ? 'var(--shadow-neon-cyan)' : 'var(--shadow-neon-gold)';

  card.innerHTML = `
    <div class="setting-info">
      <div class="setting-label-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
        <span class="setting-title" dir="ltr" style="font-size: 1.05rem; font-weight: 600; color: #fff;">ggml-${safeName}.bin</span>
        ${buildRecBadgeHtml(recInfo)}
        ${vadBadgeHtml}
      </div>
      <div class="setting-desc" style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        ${buildModelDescriptionHtml(m.name, m.status, sizeMB)}
      </div>
      ${recReasonHtml}
      <div class="model-progress-block" style="display: ${showProgressBlock};">
        <div class="model-progress-status ${m.status === 'Paused' ? 'status-paused' : 'status-downloading'}">
          ${progressStatusHtml}
        </div>
        <div class="progress-bar-container" style="height: 6px; border-radius: 3px; background: rgba(255,255,255,0.05); overflow: hidden; border: 1px solid rgba(255,255,255,0.02);">
          <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: ${barBg}; box-shadow: ${barShadow}; transition: width 0.3s ease;"></div>
        </div>
      </div>
    </div>
    <div class="setting-control">
      ${buildActionButtonsHtml(m.name, m.status)}
    </div>
  `;
  return card;
}

function attachModelGridDelegate(grid: any): void {
  if (grid._modelDelegate) return;
  grid.addEventListener('click', function(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const quickFilterBtn = target.closest('button[data-quick-filter]') as HTMLButtonElement | null;
    if (quickFilterBtn) {
      const qf = quickFilterBtn.dataset.quickFilter;
      if (qf) switchModelQuickFilter(qf);
      return;
    }

    const btn = target.closest('button[data-action]') as HTMLButtonElement | null;
    if (!btn) return;
    if (btn.dataset.action === 'clear-search') {
      clearModelSearch();
      return;
    }
    if (btn.dataset.action === 'retry-load') {
      loadModelStatusesGrid(false, true);
      return;
    }
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

  grid.addEventListener('keydown', function(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const tabBtn = target?.closest?.('.model-segment-btn') as HTMLButtonElement | null;
    if (!tabBtn) return;

    const tablist = tabBtn.closest('.model-segmented-control');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll('.model-segment-btn')) as HTMLButtonElement[];
    const idx = tabs.indexOf(tabBtn);
    if (idx < 0 || tabs.length === 0) return;

    const isRtl = typeof document !== 'undefined' && document.documentElement?.getAttribute('dir') === 'rtl';
    const nextKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
    const prevKey = isRtl ? 'ArrowRight' : 'ArrowLeft';

    let nextIdx = -1;
    if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    else if (e.key === nextKey) nextIdx = (idx + 1) % tabs.length;
    else if (e.key === prevKey) nextIdx = (idx - 1 + tabs.length) % tabs.length;

    if (nextIdx >= 0 && tabs[nextIdx]) {
      e.preventDefault();
      const targetFilter = tabs[nextIdx].dataset.quickFilter;
      if (targetFilter) {
        tabs[nextIdx].focus();
        switchModelQuickFilter(targetFilter);
      }
    }
  });
  grid._modelDelegate = true;
}

function renderModelsEmptyState(grid: HTMLElement, query: string): void {
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
    ${query ? `<button type="button" class="btn-secondary" data-action="clear-search">${t('models.emptyClearSearch')}</button>` : ''}
  `;
  grid.appendChild(emptyDiv);
}

function renderModelsErrorState(grid: HTMLElement): void {
  const focusSnap = captureGridFocus(grid);
  grid.innerHTML = '';
  attachModelGridDelegate(grid);
  const errDiv = document.createElement('div');
  errDiv.className = 'models-empty-state';
  errDiv.style.padding = '48px 20px';
  errDiv.innerHTML = `
    <div class="models-empty-icon" style="color: var(--color-red);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    </div>
    <div class="models-empty-title">${escapeHTML(t('models.loadErrorTitle'))}</div>
    <div class="models-empty-desc">${escapeHTML(t('models.loadErrorDesc'))}</div>
    <button type="button" class="btn-secondary" data-action="retry-load">${escapeHTML(t('models.retryLoad'))}</button>
  `;
  grid.appendChild(errDiv);
  restoreGridFocus(grid, focusSnap);
}

type GridFocusSnapshot =
  | { kind: 'quickFilter'; filter: string }
  | { kind: 'cardAction'; model: string; action: string; cardIndex: number }
  | { kind: 'gridAction'; action: string }
  | null;

function focusWithoutScroll(el: HTMLElement | null): void {
  if (!el || typeof el.focus !== 'function') return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

function captureGridFocus(grid: HTMLElement): GridFocusSnapshot {
  const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (!activeEl || typeof activeEl.closest !== 'function' || activeEl.closest('#models-list-scroll') !== grid) {
    return null;
  }
  const qf = activeEl.dataset?.quickFilter;
  if (qf) return { kind: 'quickFilter', filter: qf };

  const action = activeEl.dataset?.action;
  const card = activeEl.closest('[data-model]') as HTMLElement | null;
  if (action && card?.dataset?.model) {
    const cards = typeof grid.querySelectorAll === 'function'
      ? Array.from(grid.querySelectorAll('[data-model]'))
      : [];
    const cardIndex = Math.max(0, cards.indexOf(card));
    return { kind: 'cardAction', model: card.dataset.model, action, cardIndex };
  }
  if (action) return { kind: 'gridAction', action };
  return null;
}

function restoreGridFocus(grid: HTMLElement, snap: GridFocusSnapshot): void {
  if (!snap || typeof grid.querySelector !== 'function') return;
  let target: HTMLElement | null = null;
  if (snap.kind === 'quickFilter') {
    target = grid.querySelector(`button[data-quick-filter="${escapeAttrSelector(snap.filter)}"]`);
  } else if (snap.kind === 'cardAction') {
    const cardSel = `[data-model="${escapeAttrSelector(snap.model)}"]`;
    target = grid.querySelector(`${cardSel} button[data-action="${escapeAttrSelector(snap.action)}"]`)
      || grid.querySelector(`${cardSel} button[data-action]`);
    if (!target && typeof grid.querySelectorAll === 'function') {
      const remainingCards = Array.from(grid.querySelectorAll('[data-model]')) as HTMLElement[];
      if (remainingCards.length > 0) {
        const fallbackCard = remainingCards[Math.min(snap.cardIndex, remainingCards.length - 1)];
        target = fallbackCard?.querySelector('button[data-action]') as HTMLElement | null;
      } else {
        target = grid.querySelector('button[data-action="clear-search"]')
          || (typeof document !== 'undefined' ? document.getElementById(`model-cat-${currentCategoryFilter}`) : null);
      }
    }
  } else if (snap.kind === 'gridAction') {
    target = grid.querySelector(`button[data-action="${escapeAttrSelector(snap.action)}"]`);
  }
  focusWithoutScroll(target);
}

async function resolveModelHubSettings(win: any, invoke: any, loadSeq: number): Promise<any | null> {
  if (win.settingsState) return win.settingsState;
  const loaded = await invoke('load_settings');
  if (loadSeq !== _loadModelsSeq) return null;
  win.settingsState = loaded;
  return loaded;
}

async function resolveModelHubSpecs(win: any, invoke: any, loadSeq: number): Promise<any | null> {
  if (win.systemSpecs) return win.systemSpecs;
  let specs: any;
  try {
    specs = await invoke('get_system_specs');
  } catch (e) {
    console.error("Failed to load system specs:", e);
    specs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
  }
  if (loadSeq !== _loadModelsSeq) return null;
  win.systemSpecs = specs;
  return specs;
}

async function fetchModelStatuses(
  invoke: any,
  modelsDir: string,
  forceRefresh: boolean,
  loadSeq: number
): Promise<ModelStatus[] | null> {
  const now = Date.now();
  const cached = _cachedModelStatuses;
  const hasCachedActive = Array.isArray(cached) && cached.some(m => m.status === 'Downloading');
  if (!forceRefresh && cached && !hasCachedActive && (now - _cachedModelStatusesTime <= MODEL_STATUS_CACHE_TTL)) {
    return cached;
  }
  const fresh = await invoke('get_all_models_status', { modelsDir });
  if (loadSeq !== _loadModelsSeq) return null;
  _cachedModelStatuses = fresh;
  _cachedModelStatusesTime = Date.now();
  return fresh;
}

function syncQuickFilterWithCounts(counts: { all: number; multi: number; en: number; quant: number }): void {
  if (currentCategoryFilter === 'recommended') return;
  if (currentModelQuickFilter === 'en' && !(counts.en > 0 && counts.en < counts.all)) {
    currentModelQuickFilter = 'all';
  } else if (currentModelQuickFilter === 'multi' && !(counts.multi > 0 && counts.multi < counts.all)) {
    currentModelQuickFilter = 'all';
  } else if (currentModelQuickFilter === 'quant' && !(counts.quant > 0 && counts.quant < counts.all)) {
    currentModelQuickFilter = 'all';
  }
}

function renderModelHubGrid(
  grid: HTMLElement & { _modelDelegate?: boolean },
  statuses: ModelStatus[],
  systemSpecs: any
): void {
  const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const recResult = recommendModelsForSystem(systemSpecs);
  const recMap = new Map<string, any>();
  if (recResult?.models) {
    Object.values(recResult.models).forEach(rec => recMap.set(rec.modelName, rec));
  }

  const categoryModels = filterCategoryModels(statuses, query, recResult);
  const counts = {
    all: categoryModels.length,
    multi: categoryModels.filter(m => !m.name.includes('.en') && !m.name.startsWith('silero-')).length,
    en: categoryModels.filter(m => m.name.includes('.en')).length,
    quant: categoryModels.filter(m => m.name.includes('-q5') || m.name.includes('-q8')).length
  };
  syncQuickFilterWithCounts(counts);

  const focusSnap = captureGridFocus(grid);
  const prevScrollTop = grid.scrollTop;
  grid.innerHTML = '';
  attachModelGridDelegate(grid);

  if (!query) {
    const bannerHtml = renderFamilyHeaderBanner(currentCategoryFilter, counts);
    if (bannerHtml) grid.insertAdjacentHTML('beforeend', bannerHtml);
  }

  let renderedCount = 0;
  for (const m of categoryModels) {
    if (!matchesQuickFilter(m.name, query)) continue;
    grid.appendChild(buildModelCardElement(m, recMap.get(m.name)));
    renderedCount++;
  }
  if (renderedCount === 0) renderModelsEmptyState(grid, query);

  grid.scrollTop = prevScrollTop;
  restoreGridFocus(grid, focusSnap);
}

export async function loadModelStatusesGrid(_isSilent = false, forceRefresh = false): Promise<void> {
  if (typeof document === 'undefined') return;
  const win = getGlobal();
  const invoke = getTauriInvoke();
  if (!invoke) return;

  const loadSeq = ++_loadModelsSeq;
  const gridEl = document.getElementById('models-list-scroll') as (HTMLElement & { _modelDelegate?: boolean }) | null;

  let settingsState: any;
  try {
    settingsState = await resolveModelHubSettings(win, invoke, loadSeq);
    if (!settingsState) return;
  } catch (e) {
    console.error("Failed to load settings in loadModelStatusesGrid:", e);
    if (gridEl) renderModelsErrorState(gridEl);
    return;
  }

  const modelsDir = settingsState?.modelsDir || (document.getElementById('opt-modelsDir') as HTMLInputElement)?.value;
  if (!modelsDir) {
    if (gridEl) renderModelsErrorState(gridEl);
    return;
  }

  const systemSpecs = await resolveModelHubSpecs(win, invoke, loadSeq);
  if (!systemSpecs) return;
  updateSpecsSubtitle(systemSpecs);

  try {
    const statuses = await fetchModelStatuses(invoke, modelsDir, forceRefresh, loadSeq);
    if (statuses === null) return;
    const grid = document.getElementById('models-list-scroll') as (HTMLElement & { _modelDelegate?: boolean }) | null;
    if (grid) renderModelHubGrid(grid, statuses || [], systemSpecs);
  } catch (err) {
    console.error("Failed to load model statuses:", err);
    if (gridEl) renderModelsErrorState(gridEl);
  }
}

export function filterModelsGrid(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('model-search') as HTMLInputElement | null;
  const win = getGlobal();
  if (searchInput && win.applyDynamicDirection) {
    win.applyDynamicDirection(searchInput);
  }
  const clearBtn = document.getElementById('model-search-clear');
  const hasInput = Boolean(searchInput && searchInput.value.length > 0);
  if (clearBtn) clearBtn.style.display = hasInput ? 'flex' : 'none';

  cancelModelSearchDebounce();
  _filterDebounceTimer = setTimeout(() => {
    _filterDebounceTimer = null;
    loadModelStatusesGrid();
  }, 250);
}

export async function downloadModelClick(name: string): Promise<void> {
  const win = getGlobal();
  const invoke = getTauriInvoke();
  const showNotification = win.showNotification;
  const modelsDir = win.settingsState?.modelsDir || (typeof document !== 'undefined' ? (document.getElementById('opt-modelsDir') as HTMLInputElement)?.value : undefined);

  if (!modelsDir || _modelActionsInProgress.has(name) || !invoke) return;
  _modelActionsInProgress.add(name);
  try {
    _cachedModelStatuses = null;

    const card = typeof document !== 'undefined'
      ? (document.querySelector(`[data-model="${escapeAttrSelector(name)}"]`) as HTMLElement | null)
      : null;
    if (card) {
      card.dataset.status = 'Downloading';
      const ctrlEl = card.querySelector('.setting-control') as HTMLElement | null;
      if (ctrlEl) {
        const hadFocus = typeof document !== 'undefined'
          && Boolean(document.activeElement && typeof ctrlEl.contains === 'function' && ctrlEl.contains(document.activeElement));
        ctrlEl.innerHTML = buildActionButtonsHtml(name, 'Downloading');
        if (hadFocus && typeof ctrlEl.querySelector === 'function') {
          const pauseBtn = ctrlEl.querySelector('button[data-action="pause"]') as HTMLElement | null;
          if (pauseBtn && typeof pauseBtn.focus === 'function') {
            try {
              pauseBtn.focus({ preventScroll: true });
            } catch {
              pauseBtn.focus();
            }
          }
        }
      }
      const descEl = card.querySelector('.setting-desc');
      if (descEl) {
        descEl.innerHTML = buildModelDescriptionHtml(name, 'Downloading', card.dataset.sizeMb || 1);
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
  const win = getGlobal();
  const invoke = getTauriInvoke();
  const showNotification = win.showNotification;
  if (_modelActionsInProgress.has(name) || !invoke) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('pause_download_model', { modelName: name });
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
  } catch (err: any) {
    if (showNotification) showNotification(t('toasts.modelDownloadPauseError', { error: String(err) }), "error");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
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
  const card = typeof document !== 'undefined'
    ? (document.querySelector(`[data-model="${escapeAttrSelector(name)}"]`) as HTMLElement | null)
    : null;
  const isDiscard = card?.dataset?.status === 'Paused'
    || Boolean(_cachedModelStatuses?.some(m => m.name === name && m.status === 'Paused'));

  if (showConfirmModal) {
    const confirmed = await showConfirmModal(
      t(isDiscard ? 'modals.confirmDiscardModelTitle' : 'modals.confirmDeleteModelTitle'),
      t(isDiscard ? 'modals.confirmDiscardModelDesc' : 'modals.confirmDeleteModelDesc', { name }),
      t(isDiscard ? 'modals.discardBtn' : 'modals.deleteBtn')
    );
    if (!confirmed) return;
  }
  _modelActionsInProgress.add(name);
  try {
    await invoke('delete_model_file', {
      modelsDir,
      modelName: name
    });
    if (showNotification) {
      showNotification(t(isDiscard ? 'toasts.modelDiscarded' : 'toasts.modelDeleted', { name: `ggml-${name}.bin` }), "success");
    }
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
  buildActionButtonsHtml,
  buildDescriptionHtml: buildModelDescriptionHtml,
  invalidateCache: invalidateModelStatusesCache,
  ICONS: {
    DOWNLOAD: MODEL_ICON_DOWNLOAD,
    DELETE: MODEL_ICON_DELETE,
    PAUSE: MODEL_ICON_PAUSE,
    RESUME: MODEL_ICON_RESUME
  }
};
