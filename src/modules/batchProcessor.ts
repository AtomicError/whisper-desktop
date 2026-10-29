// Batch Processing Engine & Queue Controller for Whisper Desktop
import { t, applyContentDirection, isolateLtr, isolateDirection } from '../i18n/index';
import { escapeHTML } from './logsController';
import { transcriptViewer, loadTranscriptFromFile } from './transcriptViewer';
import { customSelectsMap } from './customSelect';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare global {
  interface HTMLElement {
    disabled?: boolean;
    value?: any;
  }
  interface Window {
    removeFileFromBatch: (index: number) => void;
    clearBatchQueue: () => void;
    moveBatchItemUp: (index: number) => void;
    moveBatchItemDown: (index: number) => void;
    sortBatchQueue: (criteria: string) => void;
    selectBatchItemTranscript: (index: number) => Promise<void>;
    renderBatchQueueTable: () => void;
    runBatchExtraction: () => Promise<void>;
    abortBatchExtraction: () => Promise<void>;
    updateBatchSpecs: () => void;
    formatDuration: (dur?: number | null) => string;
    batchItems: any[];
    selectedMediaFiles: string[];
    isBatchMode: boolean;
    isBatchExtracting: boolean;
    activeBatchViewerIndex: number;
    batchProcessingIndex: number;
    userExplicitlySelectedBatchItem: boolean;
    lastTranscribedVideoPath: string | null;
    lastTranscribedSubtitlePath: string | null;
    lastTranscribedOutputDir: string | null;
    lastTranscribedOutputFiles: any[];
    customSelectsMap: any;
    probedMetadata: any;
    selectedMediaFile: string | null;
    transcriptLines: any[];
    updateMediaCardName: (name: string | null) => void;
    setWizardStepCompleted: (step: number, state: boolean) => void;
    setTranscribeStatusBadge: (status: string, text: string) => void;
    updateTranscribeWorkflowButtons: () => void;
    updateTranscribeActionButtons: (running: boolean) => void;
    saveCurrentSettings: (immediate?: boolean) => any;
    showNotification: (msg: string, type: string) => void;
    switchView: (view: string) => void;
    sendTranscribeToTranslationStudio: () => Promise<void>;
    settingsState: any;
    compiledBackends: any;
    localScannedTransModels: any[];
  }
}

export interface BatchOutputFile {
  path: string;
  name: string;
  type: 'subtitle' | 'text' | 'json' | 'csv' | 'other';
}

export interface BatchItem {
  path: string;
  name: string;
  size?: string;
  durationSec?: number | null;
  status: 'pending' | 'converting' | 'transcribing' | 'translating' | 'completed' | 'failed' | 'aborted';
  timeSec?: number;
  speedFactor?: number;
  outputs?: string[];
  outputFiles?: BatchOutputFile[];
  outputDir?: string | null;
  subtitlePath?: string | null;
  txtPath?: string | null;
  transcriptLines?: any[];
}

// Module-level state tracking
let selectedMediaFiles: string[] = [];
let batchItems: BatchItem[] = [];
let isBatchMode = false;
let isBatchExtracting = false;
let batchCancelActive = false;
let activeBatchViewerIndex = -1;
let batchProcessingIndex = -1;
let userExplicitlySelectedBatchItem = false;
let transcriptLines: any[] = [];

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): any => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

export function getBasename(filePath: string): string {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').split('/').pop() || '';
}

export function getParentDir(filePath: string): string {
  if (!filePath) return '';
  const clean = filePath.trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return lastSlash >= 0 ? clean.substring(0, lastSlash) : '';
}

// ----------------- Batch Processing Queue Helpers & Engine -----------------
export function formatDuration(dur?: number | null): string {
  if (dur === undefined || dur === null || isNaN(dur) || dur < 0) {
    const resolveT = () => (typeof window !== 'undefined' && (window as any).t) || (typeof globalThis !== 'undefined' && (globalThis as any).t) || t;
    const pendingText = resolveT()('transcribe.statusPending') || t('transcribe.statusPending') || 'Pending';
    return `${pendingText}...`;
  }
  const hours = Math.floor(dur / 3600);
  const minutes = Math.floor((dur % 3600) / 60);
  const seconds = Math.floor(dur % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function updateBatchSpecs(): void {
  if (typeof document === 'undefined') return;
  const countEl = document.getElementById('batch-files-count');
  if (countEl) countEl.textContent = String(batchItems.length);

  let totalDur = 0;
  let hasPending = false;
  batchItems.forEach(item => {
    if (item.durationSec !== undefined && item.durationSec !== null && !isNaN(item.durationSec)) {
      totalDur += item.durationSec;
    } else {
      hasPending = true;
    }
  });

  const totalDurationEl = document.getElementById('batch-total-duration');
  if (totalDurationEl) {
    if (hasPending && totalDur === 0) {
      totalDurationEl.textContent = t('transcribe.calculating');
    } else {
      totalDurationEl.textContent = formatDuration(totalDur) + (hasPending ? t('transcribe.calculatingSuffix') : '');
    }
    applyContentDirection(totalDurationEl, totalDurationEl.textContent, 'ltr');
  }
}

window.removeFileFromBatch = function(index: number) {
  if (isBatchExtracting) return;
  if (index < 0 || index >= batchItems.length) return;

  batchItems.splice(index, 1);
  selectedMediaFiles.splice(index, 1);

  const win = getGlobal();

  if (batchItems.length === 0) {
    window.clearBatchQueue();
  } else {
    if (activeBatchViewerIndex === index) {
      activeBatchViewerIndex = -1;
      const nextCompleted = batchItems.findIndex(it => it.status === 'completed');
      if (nextCompleted !== -1 && typeof window.selectBatchItemTranscript === 'function') {
        window.selectBatchItemTranscript(nextCompleted);
      } else {
        transcriptLines = [];
        transcriptViewer.lines = [];
        if (win) win.transcriptLines = [];

        if (typeof document !== 'undefined') {
          const viewport = document.getElementById('transcript-viewport');
          if (viewport) {
            viewport.innerHTML = `
              <div class="transcript-placeholder" id="transcript-placeholder">
                <svg class="transcript-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <div class="transcript-empty-title" data-i18n="transcribe.liveViewerTitle">${escapeHTML(t('transcribe.liveViewerTitle') || 'Live Transcript Viewer')}</div>
                <div class="transcript-empty-desc" data-i18n="transcribe.streamNotice">${escapeHTML(t('transcribe.streamNotice') || 'Start transcription to stream live text preview.')}</div>
              </div>
            `;
          }
          const btnCopy = document.getElementById('btn-copy-transcript');
          if (btnCopy) btnCopy.disabled = true;
        }

        window.lastTranscribedSubtitlePath = null;
        window.lastTranscribedVideoPath = null;
        window.lastTranscribedOutputDir = null;
        window.lastTranscribedOutputFiles = [];

        if (typeof window.updateTranscribeWorkflowButtons === 'function') {
          window.updateTranscribeWorkflowButtons();
        }
      }
    } else if (activeBatchViewerIndex > index) {
      activeBatchViewerIndex--;
    }

    renderBatchQueueTable();
    updateBatchSpecs();
    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(false);
    }
  }
};

window.clearBatchQueue = function() {
  if (isBatchExtracting) return;
  batchItems = [];
  selectedMediaFiles = [];
  isBatchMode = false;
  activeBatchViewerIndex = -1;
  batchProcessingIndex = -1;
  userExplicitlySelectedBatchItem = false;

  const win = getGlobal();
  win.selectedMediaFile = null;
  window.lastTranscribedSubtitlePath = null;
  window.lastTranscribedVideoPath = null;
  window.lastTranscribedOutputDir = null;
  window.lastTranscribedOutputFiles = [];
  transcriptLines = [];
  transcriptViewer.lines = [];
  if (win) win.transcriptLines = [];

  if (typeof document !== 'undefined') {
    const dropZone = document.getElementById('transcribe-drop-zone');
    if (dropZone) dropZone.classList.remove('has-file');

    const fileNameEl = document.getElementById('lbl-file-name');
    if (fileNameEl) {
      fileNameEl.style.display = 'block';
      if (typeof win.updateMediaCardName === 'function') {
        win.updateMediaCardName(null);
      }
    }

    const filePathEl = document.getElementById('lbl-file-path');
    if (filePathEl) {
      filePathEl.style.display = 'block';
      filePathEl.textContent = t('transcribe.selectFilePrompt');
      filePathEl.removeAttribute('title');
    }

    const clearBtn = document.getElementById('btn-clear-media');
    if (clearBtn) clearBtn.style.display = 'none';

    const batchQueueContainer = document.getElementById('batch-queue-container');
    if (batchQueueContainer) batchQueueContainer.style.display = 'none';

    const metaBox = document.getElementById('media-meta-box');
    if (metaBox) metaBox.style.display = 'none';
    const batchSpecsBox = document.getElementById('batch-specs-box');
    if (batchSpecsBox) batchSpecsBox.style.display = 'none';

    const nextStepBtn = document.getElementById('btn-next-step-2');
    if (nextStepBtn) nextStepBtn.textContent = t('transcribe.continueToTranscription');

    const batchControlsBox = document.getElementById('batch-controls-box');
    if (batchControlsBox) batchControlsBox.style.display = 'none';
    const singleActions = document.getElementById('single-transcribe-actions');
    if (singleActions) singleActions.style.display = 'flex';
    const runBtn = document.getElementById('btn-run-transcribe');
    if (runBtn) runBtn.style.display = 'inline-flex';
    const cancelBtn = document.getElementById('btn-cancel-transcribe');
    if (cancelBtn) cancelBtn.style.display = 'none';

    const wizardStep3 = document.getElementById('wizard-step-3');
    if (wizardStep3) wizardStep3.style.display = 'block';

    if (typeof win.setWizardStepCompleted === 'function') {
      win.setWizardStepCompleted(1, false);
      win.setWizardStepCompleted(2, false);
      win.setWizardStepCompleted(3, false);
    }

    const metaType = document.getElementById('meta-type');
    if (metaType) metaType.textContent = '-';
    const metaSize = document.getElementById('meta-size');
    if (metaSize) metaSize.textContent = '-';
    const durEl = document.getElementById('meta-duration');
    if (durEl) {
      durEl.textContent = '-';
      durEl.removeAttribute('title');
    }
    const metaRec = document.getElementById('meta-recommendation');
    if (metaRec) metaRec.textContent = '-';
    win.probedMetadata = null;

    const fillBar = document.getElementById('progress-linear-fill');
    if (fillBar) fillBar.style.width = '0%';
    const pctEl = document.getElementById('lbl-radial-pct');
    if (pctEl) {
      pctEl.removeAttribute('data-i18n');
      pctEl.textContent = '0%';
    }
    const msgEl = document.getElementById('lbl-radial-msg') as HTMLElement | null;
    if (msgEl) {
      delete msgEl.dataset.batchSummarySuccess;
      delete msgEl.dataset.batchSummaryTotal;
      msgEl.setAttribute('data-i18n', 'transcribe.standingBy');
      msgEl.textContent = t('transcribe.standingBy');
    }

    const telemetryCard = document.getElementById('telemetry-hud-card');
    if (telemetryCard) telemetryCard.style.display = 'none';
    if (typeof win.setTranscribeStatusBadge === 'function') {
      win.setTranscribeStatusBadge('', 'transcribe.standingBy');
    }
    const badgeEl = document.getElementById('hud-status-badge');
    if (badgeEl) badgeEl.style.display = 'none';
    const metricsEl = document.getElementById('transcribe-metrics');
    if (metricsEl) metricsEl.style.display = 'none';
    const analyticTimeEl = document.getElementById('analytic-time') as HTMLElement | null;
    if (analyticTimeEl) delete analyticTimeEl.dataset.elapsedSeconds;
    if (msgEl) delete msgEl.dataset.statusCompleted;

    const viewport = document.getElementById('transcript-viewport');
    if (viewport) {
      viewport.innerHTML = `
        <div class="transcript-placeholder" id="transcript-placeholder">
          <svg class="transcript-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <div class="transcript-empty-title" data-i18n="transcribe.liveViewerTitle">${escapeHTML(t('transcribe.liveViewerTitle') || 'Live Transcript Viewer')}</div>
          <div class="transcript-empty-desc" data-i18n="transcribe.streamNotice">${escapeHTML(t('transcribe.streamNotice') || 'Start transcription to stream live text preview.')}</div>
        </div>
      `;
    }
    const searchInput = document.getElementById('transcript-search') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';

    const sortSelect = document.getElementById('batch-sort-select');
    if (sortSelect) {
      sortSelect.value = '';
      if (window.customSelectsMap && window.customSelectsMap.get('batch-sort-select')) {
        window.customSelectsMap.get('batch-sort-select').syncSelectedValue();
      }
    }
  }

  if (typeof window.updateTranscribeWorkflowButtons === 'function') {
    window.updateTranscribeWorkflowButtons();
  }
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(false);
  }

  if (win.settingsState) {
    win.settingsState.inputFile = "";
    if (typeof win.saveCurrentSettings === 'function') {
      win.saveCurrentSettings();
    }
  }

  if (typeof win.showNotification === 'function') {
    win.showNotification(t('toasts.queueCleared'), "info");
  }
};

window.moveBatchItemUp = function(index: number) {
  if (isBatchExtracting) return;
  if (index <= 0 || index >= batchItems.length) return;

  const tempItem = batchItems[index];
  batchItems[index] = batchItems[index - 1];
  batchItems[index - 1] = tempItem;

  const tempFile = selectedMediaFiles[index];
  selectedMediaFiles[index] = selectedMediaFiles[index - 1];
  selectedMediaFiles[index - 1] = tempFile;

  if (activeBatchViewerIndex === index) {
    activeBatchViewerIndex = index - 1;
  } else if (activeBatchViewerIndex === index - 1) {
    activeBatchViewerIndex = index;
  }

  renderBatchQueueTable();
};

window.moveBatchItemDown = function(index: number) {
  if (isBatchExtracting) return;
  if (index < 0 || index >= batchItems.length - 1) return;

  const tempItem = batchItems[index];
  batchItems[index] = batchItems[index + 1];
  batchItems[index + 1] = tempItem;

  const tempFile = selectedMediaFiles[index];
  selectedMediaFiles[index] = selectedMediaFiles[index + 1];
  selectedMediaFiles[index + 1] = tempFile;

  if (activeBatchViewerIndex === index) {
    activeBatchViewerIndex = index + 1;
  } else if (activeBatchViewerIndex === index + 1) {
    activeBatchViewerIndex = index;
  }

  renderBatchQueueTable();
};

window.sortBatchQueue = function(criteria: string) {
  if (isBatchExtracting) return;
  if (batchItems.length <= 1) return;

  const selectedPath = activeBatchViewerIndex >= 0 && batchItems[activeBatchViewerIndex] ? batchItems[activeBatchViewerIndex].path : null;

  const zipped = batchItems.map((item, index) => ({
    item,
    filePath: selectedMediaFiles[index]
  }));

  if (criteria === 'name-asc') {
    zipped.sort((a, b) => {
      const nameA = String(a.item?.name || '');
      const nameB = String(b.item?.name || '');
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else if (criteria === 'name-desc') {
    zipped.sort((a, b) => {
      const nameA = String(a.item?.name || '');
      const nameB = String(b.item?.name || '');
      return nameB.localeCompare(nameA, undefined, { numeric: true, sensitivity: 'base' });
    });
  } else if (criteria === 'duration-asc') {
    zipped.sort((a, b) => {
      const da = a.item.durationSec || 0;
      const db = b.item.durationSec || 0;
      return da - db;
    });
  } else if (criteria === 'duration-desc') {
    zipped.sort((a, b) => {
      const da = a.item.durationSec || 0;
      const db = b.item.durationSec || 0;
      return db - da;
    });
  }

  batchItems = zipped.map(z => z.item);
  selectedMediaFiles = zipped.map(z => z.filePath);

  if (selectedPath) {
    activeBatchViewerIndex = batchItems.findIndex(it => it.path === selectedPath);
  }

  const win = getGlobal();
  if (typeof document !== 'undefined') {
    const sortSelect = document.getElementById('batch-sort-select');
    if (sortSelect) {
      sortSelect.value = '';
      if (window.customSelectsMap && window.customSelectsMap.get('batch-sort-select')) {
        window.customSelectsMap.get('batch-sort-select').syncSelectedValue();
      }
    }
  }

  renderBatchQueueTable();
  if (typeof win.showNotification === 'function') {
    win.showNotification(t('toasts.queueSorted'), "success");
  }
};

window.selectBatchItemTranscript = async function(index: number): Promise<void> {
  if (index < 0 || index >= batchItems.length) return;
  const item = batchItems[index];
  if (!item) return;

  const win = getGlobal();
  const isActive = item.status === 'converting' || item.status === 'transcribing' || item.status === 'translating';
  const isCompleted = item.status === 'completed';

  if (!isCompleted && !isActive) {
    if (item.status === 'pending' && typeof win.showNotification === 'function') {
      win.showNotification(t('transcribe.statusPending') || "Pending...", "info");
    }
    return;
  }

  activeBatchViewerIndex = index;
  userExplicitlySelectedBatchItem = !isActive;

  if (isActive) {
    if (item.transcriptLines && item.transcriptLines.length > 0) {
      transcriptLines = item.transcriptLines.map((l: any) => ({ ...l }));
      transcriptViewer.lines = item.transcriptLines.map((l: any) => ({ ...l }));
      if (win) win.transcriptLines = transcriptLines;
      transcriptViewer.render(transcriptLines);
      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }
    } else {
      transcriptLines = [];
      transcriptViewer.lines = [];
      if (win) win.transcriptLines = [];
      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.innerHTML = `
            <div id="transcript-placeholder" class="transcript-initializing-state">
              <div class="transcript-spinner"></div>
              <div class="transcript-initializing-text" data-i18n="transcribe.aiModelInitializing">${escapeHTML(t('transcribe.aiModelInitializing'))}</div>
            </div>
          `;
        }
      }
    }
    if (typeof document !== 'undefined') {
      const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
      if (btnCopy) btnCopy.disabled = (transcriptLines.length === 0);
    }
  } else if (isCompleted) {
    if (item.transcriptLines && item.transcriptLines.length > 0) {
      transcriptLines = item.transcriptLines.map((l: any) => ({ ...l }));
      transcriptViewer.lines = item.transcriptLines.map((l: any) => ({ ...l }));
      if (win) win.transcriptLines = transcriptLines;
      transcriptViewer.render(transcriptLines);
    } else if (item.subtitlePath) {
      try {
        const loaded = await loadTranscriptFromFile(item.subtitlePath, true);
        item.transcriptLines = (loaded || []).map((l: any) => ({ ...l }));
      } catch (e) {
        console.error("Failed to load batch item subtitle:", e);
      }
    } else if (item.txtPath) {
      try {
        const loaded = await loadTranscriptFromFile(item.txtPath, true);
        item.transcriptLines = (loaded || []).map((l: any) => ({ ...l }));
      } catch (e) {
        console.error("Failed to load batch item transcript:", e);
      }
    } else {
      transcriptLines = [];
      transcriptViewer.lines = [];
      if (win) win.transcriptLines = [];
      transcriptViewer.render([]);
    }
    if (typeof document !== 'undefined') {
      const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
      if (btnCopy) btnCopy.disabled = (transcriptLines.length === 0);
    }
  }

  window.lastTranscribedOutputDir = item.outputDir || getParentDir(item.path);
  window.lastTranscribedSubtitlePath = item.subtitlePath || null;
  window.lastTranscribedVideoPath = item.path;
  window.lastTranscribedOutputFiles = item.outputFiles || [];

  renderBatchQueueTable();

  if (typeof window.updateTranscribeWorkflowButtons === 'function') {
    window.updateTranscribeWorkflowButtons();
  }
};

function renderBatchQueueTable(): void {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('batch-queue-body');
  if (!container) return;

  const countChip = document.getElementById('lbl-batch-count');
  if (countChip) countChip.textContent = String(batchItems.length);

  container.innerHTML = '';
  const isRunning = isBatchExtracting;

  batchItems.forEach((item, index) => {
    const card = document.createElement('div');
    const isActive = item.status === 'converting' || item.status === 'transcribing' || item.status === 'translating';
    const isCompleted = item.status === 'completed';
    const isSelected = activeBatchViewerIndex === index;
    const isClickable = isCompleted || isActive;

    card.className = `batch-queue-card batch-row ${isActive ? 'is-active' : ''} ${isClickable ? 'is-clickable' : ''} ${isSelected ? 'is-selected' : ''}`;
    card.dataset.index = String(index);

    if (isClickable) {
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const isViewing = activeBatchViewerIndex === index;
      const viewHint = isViewing ? t('transcribe.viewingTranscript') : t('transcribe.clickToViewTranscript');
      card.title = `${item.name}\n${viewHint}`;
      card.setAttribute('aria-label', `${item.name} - ${viewHint}`);

      card.onclick = () => {
        window.selectBatchItemTranscript(index);
      };
      card.onkeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.selectBatchItemTranscript(index);
        }
      };
    } else {
      card.title = item.name;
    }

    const topRow = document.createElement('div');
    topRow.className = 'batch-card-top-row';

    const nameGroup = document.createElement('div');
    nameGroup.className = 'batch-card-name-group';

    const fileIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    fileIcon.setAttribute('viewBox', '0 0 24 24');
    fileIcon.setAttribute('fill', 'none');
    fileIcon.setAttribute('stroke', 'currentColor');
    fileIcon.setAttribute('stroke-width', '2');
    fileIcon.setAttribute('stroke-linecap', 'round');
    fileIcon.setAttribute('stroke-linejoin', 'round');
    fileIcon.classList.add('batch-card-file-icon');
    fileIcon.innerHTML = `<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line>`;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'batch-card-name';
    nameSpan.textContent = item.name;
    applyContentDirection(nameSpan, item.name);
    nameSpan.title = isolateLtr(item.path);

    nameGroup.appendChild(fileIcon);
    nameGroup.appendChild(nameSpan);

    const durationSpan = document.createElement('span');
    durationSpan.className = 'batch-card-duration';
    const formattedDur = formatDuration(item.durationSec);
    durationSpan.textContent = formattedDur;
    applyContentDirection(durationSpan, formattedDur, 'ltr');

    topRow.appendChild(nameGroup);
    topRow.appendChild(durationSpan);
    card.appendChild(topRow);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'batch-card-bottom-row';

    const statusWrapper = document.createElement('div');
    statusWrapper.className = 'batch-card-status-wrapper';

    const badge = document.createElement('span');
    if (item.status === 'pending') {
      badge.className = 'batch-status-badge badge-pending';
      badge.textContent = t('transcribe.statusPending');
    } else if (item.status === 'converting') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusConverting');
    } else if (item.status === 'transcribing') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusExtracting');
    } else if (item.status === 'translating') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusTranslating');
    } else if (item.status === 'completed') {
      badge.className = 'batch-status-badge badge-completed';
      badge.textContent = t('transcribe.statusCompleted');
    } else if (item.status === 'failed') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = t('transcribe.statusFailed');
    } else if (item.status === 'aborted') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = t('transcribe.statusAborted');
    }
    statusWrapper.appendChild(badge);

    if (isSelected) {
      const viewingChip = document.createElement('span');
      viewingChip.className = 'batch-viewing-chip';
      viewingChip.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg><span>${escapeHTML(t('transcribe.viewingTranscript'))}</span>`;
      statusWrapper.appendChild(viewingChip);
    }

    bottomRow.appendChild(statusWrapper);

    const actionGroup = document.createElement('div');
    actionGroup.className = 'batch-action-group';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn-batch-action btn-move-up';
    upBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="m18 15-6-6-6 6"/></svg>`;
    const moveUpText = t('transcribe.moveUp') || 'Move up';
    upBtn.title = moveUpText;
    upBtn.setAttribute('aria-label', moveUpText);

    if (isRunning || index === 0) {
      upBtn.disabled = true;
    } else {
      upBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        window.moveBatchItemUp(index);
      };
    }

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn-batch-action btn-move-down';
    downBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="m6 9 6 6 6-6"/></svg>`;
    const moveDownText = t('transcribe.moveDown') || 'Move down';
    downBtn.title = moveDownText;
    downBtn.setAttribute('aria-label', moveDownText);

    if (isRunning || index === batchItems.length - 1) {
      downBtn.disabled = true;
    } else {
      downBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        window.moveBatchItemDown(index);
      };
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-batch-action btn-batch-remove';
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    const removeText = t('transcribe.removeFile') || 'Remove file';
    deleteBtn.title = removeText;
    deleteBtn.setAttribute('aria-label', removeText);

    if (isRunning) {
      deleteBtn.disabled = true;
    } else {
      deleteBtn.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        window.removeFileFromBatch(index);
      };
    }

    actionGroup.appendChild(upBtn);
    actionGroup.appendChild(downBtn);
    actionGroup.appendChild(deleteBtn);
    bottomRow.appendChild(actionGroup);

    card.appendChild(bottomRow);
    container.appendChild(card);
  });
}

window.runBatchExtraction = async function(): Promise<void> {
  if (!isBatchMode || batchItems.length === 0) return;

  const win = getGlobal();
  const invoke = getTauriInvoke();
  if (!invoke) return;

  const settings = win.settingsState || {};
  const isCompiled = settings.selectedBackend === 'Standard' || Boolean((win.compiledBackends || {})[settings.selectedBackend]);
  if (!isCompiled) {
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.backendNotFound', { backend: settings.selectedBackend }), "error");
    }
    if (typeof win.switchView === 'function') win.switchView('settings');
    return;
  }

  const scannedModels = win.localScannedTransModels || [];
  const modelExists = scannedModels.includes(settings.modelPath);
  if (!modelExists) {
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.noModelFound'), "error");
    }
    if (!scannedModels || scannedModels.length === 0) {
      if (typeof win.switchView === 'function') win.switchView('models');
    }
    return;
  }

  const cancelBtn = document.getElementById('btn-cancel-batch') as HTMLButtonElement | null;
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  const sortSelect = document.getElementById('batch-sort-select') as HTMLSelectElement | null;
  const clearBtn = document.getElementById('btn-clear-batch') as HTMLButtonElement | null;

  isBatchExtracting = true;
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(true);
  }
  if (sortSelect) sortSelect.disabled = true;
  if (clearBtn) clearBtn.disabled = true;

  if (cancelBtn) {
    cancelBtn.style.display = 'inline-flex';
    cancelBtn.disabled = false;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelBatch'); else cancelBtn.textContent = t('transcribe.cancelBatch');
  }

  batchCancelActive = false;
  const analyticsBox = document.getElementById('analytics-box');
  if (analyticsBox) analyticsBox.style.display = 'none';

  const telemetryCard = document.getElementById('telemetry-hud-card');
  if (telemetryCard) telemetryCard.style.display = 'block';
  if (typeof win.setTranscribeStatusBadge === 'function') {
    win.setTranscribeStatusBadge('active', 'transcribe.batchRunning');
  }
  const metricsEl = document.getElementById('transcribe-metrics');
  if (metricsEl) metricsEl.style.display = 'none';

  batchProcessingIndex = -1;
  userExplicitlySelectedBatchItem = false;
  window.lastTranscribedSubtitlePath = null;
  window.lastTranscribedOutputDir = null;
  window.lastTranscribedVideoPath = null;
  window.lastTranscribedOutputFiles = [];
  transcriptLines = [];
  transcriptViewer.lines = [];
  if (win) win.transcriptLines = [];
  activeBatchViewerIndex = 0; // Follow first item initially

  batchItems.forEach(item => {
    item.transcriptLines = [];
    item.outputs = [];
    item.outputFiles = [];
    item.subtitlePath = null;
    item.txtPath = null;
    item.timeSec = 0;
    item.speedFactor = 0.0;
  });

  if (typeof window.updateTranscribeWorkflowButtons === 'function') {
    window.updateTranscribeWorkflowButtons();
  }
  renderBatchQueueTable();

  if (typeof document !== 'undefined') {
    const initialViewport = document.getElementById('transcript-viewport');
    if (initialViewport) {
      initialViewport.innerHTML = `
        <div id="transcript-placeholder" class="transcript-initializing-state">
          <div class="transcript-spinner"></div>
          <div class="transcript-initializing-text" data-i18n="transcribe.aiModelInitializing">${escapeHTML(t('transcribe.aiModelInitializing'))}</div>
        </div>
      `;
    }
  }

  const fillBar = document.getElementById('progress-linear-fill');
  const pctEl = document.getElementById('lbl-radial-pct');
  const msgEl = document.getElementById('lbl-radial-msg') as HTMLElement | null;

  let successCount = 0;
  const totalCount = batchItems.length;

  for (let i = 0; i < totalCount; i++) {
    batchProcessingIndex = i;
    if (batchCancelActive) {
      batchItems[i].status = 'aborted';
      continue;
    }

    if (!userExplicitlySelectedBatchItem) {
      activeBatchViewerIndex = i;
    }

    const item = batchItems[i];
    item.transcriptLines = [];
    item.status = 'converting';
    renderBatchQueueTable();

    const globalPct = ((i / totalCount) * 100).toFixed(0);
    if (fillBar) fillBar.style.width = `${globalPct}%`;
    if (pctEl) pctEl.textContent = `${globalPct}%`;
    if (msgEl) msgEl.textContent = t('transcribe.batchConvertingProgress', { current: i + 1, total: totalCount, name: item.name });

    let currentWavPath: string | null = null;
    const originalInputFile = settings.inputFile;
    settings.inputFile = item.path;

    try {
      currentWavPath = await invoke('convert_media_file', { filePath: item.path });

      if (batchCancelActive) {
        item.status = 'aborted';
        renderBatchQueueTable();
        continue;
      }

      item.status = 'transcribing';
      renderBatchQueueTable();

      if (msgEl) msgEl.textContent = t('transcribe.batchExtractingProgress', { current: i + 1, total: totalCount, name: item.name });

      if (activeBatchViewerIndex === i) {
        transcriptLines = [];
        transcriptViewer.lines = [];
        if (win) win.transcriptLines = [];
        window.lastTranscribedSubtitlePath = null;
        if (typeof window.updateTranscribeWorkflowButtons === 'function') {
          window.updateTranscribeWorkflowButtons();
        }
        if (typeof document !== 'undefined') {
          const viewport = document.getElementById('transcript-viewport');
          if (viewport) {
            viewport.innerHTML = `
              <div id="transcript-placeholder" class="transcript-initializing-state">
                <div class="transcript-spinner"></div>
                <div class="transcript-initializing-text" data-i18n="transcribe.aiModelInitializing">${escapeHTML(t('transcribe.aiModelInitializing'))}</div>
              </div>
            `;
          }
        }
      }

      const result = await invoke('start_transcription_task', {
        settings,
        wavPath: currentWavPath,
        durationSec: item.durationSec || 60.0
      });

      if ((!item.transcriptLines || item.transcriptLines.length === 0) && result.generatedFiles && result.generatedFiles.length > 0) {
        const outputDir = result.outputDir || getParentDir(item.path);
        const subFile = result.generatedFiles.find((f: string) => f.endsWith('.srt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.vtt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.lrc')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.json')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.csv')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.txt'));
        if (subFile) {
          const sep = outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
          const subFullPath = `${outputDir}${sep}${subFile}`;
          const shouldRender = (activeBatchViewerIndex === i);
          const loaded = await loadTranscriptFromFile(subFullPath, shouldRender);
          item.transcriptLines = (loaded || []).map((l: any) => ({ ...l }));
        }
      }

      item.outputs = result.generatedFiles || [];
      item.status = 'completed';
      item.timeSec = (result.durationMs || 0) / 1000;
      item.speedFactor = result.speedFactor || 0.0;
      successCount++;

      if (!item.transcriptLines) {
        item.transcriptLines = [];
      }

      const rawItemOutputDir = (settings && settings.outputDirMode === 'custom' && settings.outputDirPath) ? settings.outputDirPath : (result.outputDir || getParentDir(item.path));
      const itemOutputDir = (rawItemOutputDir && (rawItemOutputDir.endsWith('/') || rawItemOutputDir.endsWith('\\'))) ? rawItemOutputDir.slice(0, -1) : rawItemOutputDir;
      const sep = itemOutputDir && itemOutputDir.includes('\\') && !itemOutputDir.includes('/') ? '\\' : '/';
      item.outputDir = itemOutputDir;

      const allGenerated: string[] = result.generatedFiles || [];
      const outputFilesList: BatchOutputFile[] = [];
      allGenerated.forEach(f => {
        let type: BatchOutputFile['type'] = 'other';
        if (f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.lrc')) {
          type = 'subtitle';
        } else if (f.endsWith('.txt')) {
          type = 'text';
        } else if (f.endsWith('.json')) {
          type = 'json';
        } else if (f.endsWith('.csv')) {
          type = 'csv';
        }
        outputFilesList.push({
          path: `${itemOutputDir}${sep}${f}`,
          name: f,
          type
        });
      });
      item.outputFiles = outputFilesList;

      const subFileObj = outputFilesList.find(f => f.name.endsWith('.srt')) ||
                         outputFilesList.find(f => f.name.endsWith('.vtt')) ||
                         outputFilesList.find(f => f.name.endsWith('.lrc'));
      item.subtitlePath = subFileObj ? subFileObj.path : null;

      const txtFileObj = outputFilesList.find(f => f.name.endsWith('.txt')) ||
                         outputFilesList.find(f => f.name.endsWith('.json') || f.name.endsWith('.csv'));
      item.txtPath = txtFileObj ? txtFileObj.path : (item.subtitlePath || null);

      if (activeBatchViewerIndex === i) {
        window.lastTranscribedOutputDir = item.outputDir;
        window.lastTranscribedSubtitlePath = item.subtitlePath;
        window.lastTranscribedVideoPath = item.path;
        window.lastTranscribedOutputFiles = item.outputFiles;
        if (typeof window.updateTranscribeWorkflowButtons === 'function') {
          window.updateTranscribeWorkflowButtons();
        }
      }

      renderBatchQueueTable();
    } catch (err) {
      item.status = 'failed';
      renderBatchQueueTable();
      if (typeof win.showNotification === 'function') {
        win.showNotification(t('toasts.batchItemError', { name: item.name, error: String(err) }), "error");
      }
    } finally {
      settings.inputFile = originalInputFile;
    }
  }

  isBatchExtracting = false;
  batchProcessingIndex = -1;
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(false);
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (sortSelect) sortSelect.disabled = false;
  if (clearBtn) clearBtn.disabled = false;

  if (batchCancelActive) {
    if (telemetryCard) telemetryCard.style.display = 'none';
    if (fillBar) fillBar.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (metricsEl) metricsEl.style.display = 'none';
    if (typeof win.setTranscribeStatusBadge === 'function') {
      win.setTranscribeStatusBadge('', 'transcribe.standingBy');
    }
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.batchCancelled'), "info");
    }
  } else {
    if (fillBar) fillBar.style.width = '100%';
    if (pctEl) {
      pctEl.removeAttribute('data-i18n');
      pctEl.textContent = '100%';
    }
    if (msgEl) {
      msgEl.removeAttribute('data-i18n');
      msgEl.textContent = t('transcribe.batchCompletedSummary', { success: successCount, total: totalCount });
      msgEl.dataset.batchSummarySuccess = String(successCount);
      msgEl.dataset.batchSummaryTotal = String(totalCount);
    }
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.batchComplete', { success: successCount, total: totalCount }), "success");
    }
    if (typeof win.setTranscribeStatusBadge === 'function') {
      win.setTranscribeStatusBadge('complete', 'transcribe.statusComplete');
    }
  }

  let latestCompletedIdx = -1;
  for (let k = batchItems.length - 1; k >= 0; k--) {
    if (batchItems[k].status === 'completed') {
      latestCompletedIdx = k;
      break;
    }
  }

  const isAlreadyViewingCompleted = activeBatchViewerIndex >= 0 &&
    batchItems[activeBatchViewerIndex] &&
    batchItems[activeBatchViewerIndex].status === 'completed';

  if (!isAlreadyViewingCompleted && latestCompletedIdx !== -1 && typeof window.selectBatchItemTranscript === 'function') {
    await window.selectBatchItemTranscript(latestCompletedIdx);
  } else {
    if (isAlreadyViewingCompleted) {
      const viewedItem = batchItems[activeBatchViewerIndex];
      window.lastTranscribedOutputDir = viewedItem.outputDir || getParentDir(viewedItem.path);
      window.lastTranscribedSubtitlePath = viewedItem.subtitlePath || null;
      window.lastTranscribedVideoPath = viewedItem.path;
      window.lastTranscribedOutputFiles = viewedItem.outputFiles || [];
    } else if (latestCompletedIdx === -1) {
      activeBatchViewerIndex = -1;
      transcriptLines = [];
      transcriptViewer.lines = [];
      if (win) win.transcriptLines = [];
      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.innerHTML = `
            <div class="transcript-placeholder" id="transcript-placeholder">
              <svg class="transcript-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <div class="transcript-empty-title" data-i18n="transcribe.liveViewerTitle">${escapeHTML(t('transcribe.liveViewerTitle') || 'Live Transcript Viewer')}</div>
              <div class="transcript-empty-desc" data-i18n="transcribe.streamNotice">${escapeHTML(t('transcribe.streamNotice') || 'Start transcription to stream live text preview.')}</div>
            </div>
          `;
        }
      }
    }
    renderBatchQueueTable();
    if (typeof window.updateTranscribeWorkflowButtons === 'function') {
      window.updateTranscribeWorkflowButtons();
    }
  }

  renderBatchQueueTable();

  const autoTransferEnabled = Boolean(settings?.autoTransferToTranslate ?? settings?.translateAiEnabled);
  if (!batchCancelActive && successCount > 0 && autoTransferEnabled && window.lastTranscribedSubtitlePath) {
    if (typeof window.sendTranscribeToTranslationStudio === 'function') {
      await window.sendTranscribeToTranslationStudio();
    }
  }

  if (typeof win.setWizardStepCompleted === 'function') {
    win.setWizardStepCompleted(3, true);
  }
};

window.abortBatchExtraction = async function(): Promise<void> {
  const cancelBtn = document.getElementById('btn-cancel-batch') as HTMLButtonElement | null;
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.aborting'); else cancelBtn.textContent = t('transcribe.aborting');
  }

  batchCancelActive = true;
  const invoke = getTauriInvoke();
  const win = getGlobal();

  try {
    if (invoke) {
      await invoke('cancel_transcription');
    }
    const telemetryCard = document.getElementById('telemetry-hud-card');
    if (telemetryCard) telemetryCard.style.display = 'none';
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.cancellingTask'), "info");
    }
  } catch (err) {
    console.error("Failed to cancel active whisper process:", err);
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      const cancelSpan = cancelBtn.querySelector('span');
      if (cancelSpan) {
        cancelSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
        cancelSpan.textContent = t('transcribe.cancelTranscription');
      } else {
        cancelBtn.innerHTML = `<span data-i18n="transcribe.cancelTranscription">${t('transcribe.cancelTranscription')}</span>`;
      }
      cancelBtn.style.display = 'none';
    }
  }
};

export async function addBatchFiles(files: string[]): Promise<boolean> {
  if (isBatchExtracting) return false;
  const rawList = Array.isArray(files) ? files : [];
  if (rawList.length === 0) return false;

  const uniqueFiles = Array.from(new Set(rawList));
  const win = getGlobal();

  // Case 1: Already in batch mode with items in queue -> append new files
  if (isBatchMode && batchItems.length > 0) {
    const existingPaths = new Set(batchItems.map(item => item.path));
    const newFiles = uniqueFiles.filter(f => !existingPaths.has(f));

    if (newFiles.length === 0) {
      if (typeof win.showNotification === 'function') {
        win.showNotification(t('toasts.filesAlreadyInBatch') || 'Selected files are already in the batch queue', "info");
      }
      return false;
    }

    const newItems: BatchItem[] = newFiles.map(filePath => ({
      path: filePath,
      name: getBasename(filePath),
      size: (t('transcribe.statusPending') || 'Pending') + '...',
      durationSec: null,
      status: 'pending',
      timeSec: 0,
      speedFactor: 0.0,
      outputs: []
    }));

    batchItems = batchItems.concat(newItems);
    selectedMediaFiles = batchItems.map(item => item.path);

    if (typeof document !== 'undefined') {
      const fileNameEl = document.getElementById('lbl-file-name');
      if (fileNameEl) {
        fileNameEl.textContent = t('transcribe.batchModeActive');
        fileNameEl.removeAttribute('title');
      }
      const countEl = document.getElementById('batch-files-count');
      if (countEl) countEl.textContent = String(batchItems.length);
    }

    renderBatchQueueTable();
    updateBatchSpecs();

    const invoke = getTauriInvoke();
    if (invoke) {
      (async () => {
        for (const item of newItems) {
          try {
            const meta = await invoke('probe_media_file', { filePath: item.path });
            if (meta && meta.exists) {
              item.size = meta.size;
              item.durationSec = meta.durationSec;
            }
          } catch (err) {
            console.error("Failed to probe file in batch:", err);
          }
        }
        renderBatchQueueTable();
        updateBatchSpecs();
      })();
    }

    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.filesLoaded', { count: newFiles.length }), "success");
    }
    return true;
  }

  // Case 2: Entering Batch Mode (either initial multi-selection or replacing single file)
  isBatchMode = true;
  win.selectedMediaFile = null;

  if (typeof document !== 'undefined') {
    const dropZone = document.getElementById('transcribe-drop-zone');
    if (dropZone) dropZone.classList.add('has-file');

    const fileNameEl = document.getElementById('lbl-file-name');
    const filePathEl = document.getElementById('lbl-file-path');
    if (fileNameEl) {
      fileNameEl.style.display = 'block';
      fileNameEl.textContent = t('transcribe.batchModeActive');
      fileNameEl.removeAttribute('title');
    }
    if (filePathEl) filePathEl.style.display = 'none';

    const clearBtn = document.getElementById('btn-clear-media');
    if (clearBtn) clearBtn.style.display = 'none';

    const batchQueueContainer = document.getElementById('batch-queue-container');
    if (batchQueueContainer) batchQueueContainer.style.display = 'block';

    const metaBox = document.getElementById('media-meta-box');
    if (metaBox) metaBox.style.display = 'none';
    const batchSpecsBox = document.getElementById('batch-specs-box');
    if (batchSpecsBox) batchSpecsBox.style.display = 'flex';
    const countEl = document.getElementById('batch-files-count');
    if (countEl) countEl.textContent = String(uniqueFiles.length);

    const nextStepBtn = document.getElementById('btn-next-step-2');
    if (nextStepBtn) nextStepBtn.textContent = t('transcribe.continueToBatchSetup');

    const singleActions = document.getElementById('single-transcribe-actions');
    if (singleActions) singleActions.style.display = 'none';
    const batchControlsBox = document.getElementById('batch-controls-box');
    if (batchControlsBox) batchControlsBox.style.display = 'block';
    const runBatchBtn = document.getElementById('btn-run-batch');
    if (runBatchBtn) runBatchBtn.style.display = 'inline-flex';
    const cancelBatchBtn = document.getElementById('btn-cancel-batch');
    if (cancelBatchBtn) cancelBatchBtn.style.display = 'none';

    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(false);
    }
  }

  if (typeof win.setWizardStepCompleted === 'function') {
    win.setWizardStepCompleted(1, true);
    win.setWizardStepCompleted(2, true);
  }

  activeBatchViewerIndex = -1;
  batchItems = uniqueFiles.map(filePath => ({
    path: filePath,
    name: getBasename(filePath),
    size: (t('transcribe.statusPending') || 'Pending') + '...',
    durationSec: null,
    status: 'pending',
    timeSec: 0,
    speedFactor: 0.0,
    outputs: []
  }));
  selectedMediaFiles = batchItems.map(item => item.path);

  renderBatchQueueTable();
  updateBatchSpecs();

  const invoke = getTauriInvoke();
  if (invoke) {
    (async () => {
      for (let idx = 0; idx < uniqueFiles.length; idx++) {
        try {
          const meta = await invoke('probe_media_file', { filePath: uniqueFiles[idx] });
          if (meta && meta.exists && batchItems[idx]) {
            batchItems[idx].size = meta.size;
            batchItems[idx].durationSec = meta.durationSec;
          }
        } catch (err) {
          console.error("Failed to probe file in batch:", err);
        }
      }
      renderBatchQueueTable();
      updateBatchSpecs();
    })();
  }

  return true;
}

export function syncBatchProcessorWindowBindings(): void {
  const win = getGlobal();
  if (!win) return;

  win.removeFileFromBatch = window.removeFileFromBatch;
  win.clearBatchQueue = window.clearBatchQueue;
  win.moveBatchItemUp = window.moveBatchItemUp;
  win.moveBatchItemDown = window.moveBatchItemDown;
  win.sortBatchQueue = window.sortBatchQueue;
  win.selectBatchItemTranscript = window.selectBatchItemTranscript;
  win.renderBatchQueueTable = renderBatchQueueTable;
  win.runBatchExtraction = window.runBatchExtraction;
  win.abortBatchExtraction = window.abortBatchExtraction;
  win.updateBatchSpecs = updateBatchSpecs;
  win.formatDuration = formatDuration;
  win.addBatchFiles = addBatchFiles;

  try {
    Object.defineProperties(win, {
      isBatchMode: {
        get() { return isBatchMode; },
        set(val: boolean) { isBatchMode = Boolean(val); },
        configurable: true
      },
      isBatchExtracting: {
        get() { return isBatchExtracting; },
        set(val: boolean) { isBatchExtracting = Boolean(val); },
        configurable: true
      },
      batchItems: {
        get() { return batchItems; },
        set(val: BatchItem[]) { batchItems = Array.isArray(val) ? val : []; },
        configurable: true
      },
      batchProcessingIndex: {
        get() { return batchProcessingIndex; },
        set(val: number) { batchProcessingIndex = Number(val); },
        configurable: true
      },
      activeBatchViewerIndex: {
        get() { return activeBatchViewerIndex; },
        set(val: number) { activeBatchViewerIndex = Number(val); },
        configurable: true
      },
      selectedMediaFiles: {
        get() { return selectedMediaFiles; },
        set(val: string[]) { selectedMediaFiles = Array.isArray(val) ? val : []; },
        configurable: true
      },
      userExplicitlySelectedBatchItem: {
        get() { return userExplicitlySelectedBatchItem; },
        set(val: boolean) { userExplicitlySelectedBatchItem = Boolean(val); },
        configurable: true
      }
    });
  } catch {
    // Already defined or restricted
  }
}

if (typeof window !== 'undefined') {
  syncBatchProcessorWindowBindings();
}

export const removeFileFromBatch = window.removeFileFromBatch;
export const clearBatchQueue = window.clearBatchQueue;
export const moveBatchItemUp = window.moveBatchItemUp;
export const moveBatchItemDown = window.moveBatchItemDown;
export const sortBatchQueue = window.sortBatchQueue;
export const selectBatchItemTranscript = window.selectBatchItemTranscript;
export const runBatchExtraction = window.runBatchExtraction;
export const abortBatchExtraction = window.abortBatchExtraction;
export { renderBatchQueueTable };

export const batchProcessor = {
  getItems: () => batchItems,
  setItems: (items: BatchItem[]) => { batchItems = Array.isArray(items) ? items : []; },
  getSelectedFiles: () => selectedMediaFiles,
  setSelectedFiles: (files: string[]) => { selectedMediaFiles = Array.isArray(files) ? files : []; },
  getIsBatchMode: () => isBatchMode,
  setIsBatchMode: (val: boolean) => { isBatchMode = Boolean(val); },
  getIsExtracting: () => isBatchExtracting,
  setIsExtracting: (val: boolean) => { isBatchExtracting = Boolean(val); },
  getActiveViewerIndex: () => activeBatchViewerIndex,
  setActiveViewerIndex: (idx: number) => { activeBatchViewerIndex = idx; },
  getProcessingIndex: () => batchProcessingIndex,
  setProcessingIndex: (idx: number) => { batchProcessingIndex = idx; },
  formatDuration,
  updateSpecs: updateBatchSpecs,
  removeFile: window.removeFileFromBatch,
  clearQueue: window.clearBatchQueue,
  moveUp: window.moveBatchItemUp,
  moveDown: window.moveBatchItemDown,
  sortQueue: window.sortBatchQueue,
  selectTranscript: window.selectBatchItemTranscript,
  renderTable: renderBatchQueueTable,
  runExtraction: window.runBatchExtraction,
  abortExtraction: window.abortBatchExtraction,
  addFiles: addBatchFiles,
  syncWindowBindings: syncBatchProcessorWindowBindings
};
