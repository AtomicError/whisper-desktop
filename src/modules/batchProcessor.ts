// Batch Processing Engine & Queue Controller for Whisper Desktop
import { t, getLanguage, applyContentDirection, clearContentDirection, isolateLtr, isolateDirection } from '../i18n/index';
import { formatLocalizedNumber } from '../i18n/formatters';
import { escapeHTML, logsController } from './logsController';
import { transcriptViewer, loadTranscriptFromFile, loadTranscriptFromJsonData } from './transcriptViewer';
import { customSelectsMap } from './customSelect';
import { formatMsToTimecode } from './transcribeConfigHelpers';
import {
  getSettingsState,
  saveCurrentSettings,
  compiledBackends,
  localScannedTransModels,
  resetTranscribeTimeRange,
  updateTranscribeRangeVisibility,
  syncQuickTimeRangeUI,
  validateAndApplyQuickTimeRange,
  updateDeckScrollCue,
  SettingsState
} from './settingsManager';
import type { ProbedMediaMetadata } from './transcribePipeline';
import { MEDIA_ICON_SVGS } from './mediaIcons';

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
    probedMetadata: ProbedMediaMetadata | null;
    selectedMediaFile: string | null;
    transcriptLines: any[];
    updateMediaCardName: (name: string | null) => void;
    setWizardStepCompleted: (step: number, state: boolean) => void;
    setTranscribeStatusBadge: (status: string, text: string) => void;
    updateTranscribeWorkflowButtons: () => void;
    updateTranscribeActionButtons: (running?: boolean) => void;
    saveCurrentSettings: (immediate?: boolean) => any;
    showNotification: (msg: string, type: string) => void;
    switchView: (view: string) => void;
    sendTranscribeToTranslationStudio: () => Promise<void>;
    settingsState: SettingsState | null;
    compiledBackends: Record<string, boolean>;
    localScannedTransModels: string[];
    batchProcessor?: BatchProcessor;
    showTranscribeSetupDeck?: () => void;
    showTranscribeFilesDeck?: () => void;
    showTranscribeMediaDeck?: () => void;
    syncTranscribeDeckTabsUI?: () => void;
    getActiveTranscribeDeckTab?: () => 'setup' | 'files' | 'player';
    loadMediaIntoCompanionPlayer?: (filePath: string, autoSwitchDeck?: boolean, knownDurationSec?: number) => Promise<boolean>;
    seekCompanionPlayer?: (targetMs: number, autoPlay?: boolean, targetLineId?: number, switchToMediaDeck?: boolean) => void;
    pauseCompanionPlayer?: () => void;
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
  status: 'pending' | 'converting' | 'transcribing' | 'translating' | 'completed' | 'failed' | 'aborted' | 'skipped';
  timeSec?: number;
  speedFactor?: number;
  outputs?: string[];
  outputFiles?: BatchOutputFile[];
  outputDir?: string | null;
  subtitlePath?: string | null;
  txtPath?: string | null;
  internalJsonPath?: string | null;
  transcriptLines?: any[];
  history?: { undoStack: any[]; redoStack: any[] };
}

// Module-level state tracking
let selectedMediaFiles: string[] = [];
let batchItems: BatchItem[] = [];
let isBatchMode = false;
let isBatchExtracting = false;
let batchCancelActive = false;
let activeBatchViewerIndex = -1;
let activeBatchSelectSeq = 0;
let batchQueueEpoch = 0;
let batchProcessingIndex = -1;
let userExplicitlySelectedBatchItem = false;

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
  if (lastSlash === 0) return '/';
  if (clean.length >= 3 && clean[1] === ':' && lastSlash === 2) {
    return clean.substring(0, 3);
  }
  return lastSlash > 0 ? clean.substring(0, lastSlash) : '';
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

export function removeFileFromBatch(index: number): void {
  if (isBatchExtracting) return;
  if (index < 0 || index >= batchItems.length) return;

  if (transcriptViewer.hasPendingEdits()) {
    void transcriptViewer.flushEdits();
  }

  batchItems.splice(index, 1);
  selectedMediaFiles.splice(index, 1);

  const win = getGlobal();

  if (batchItems.length === 0) {
    clearBatchQueue();
  } else {
    if (activeBatchViewerIndex === index) {
      activeBatchViewerIndex = -1;
      const nextCompleted = batchItems.findIndex(it => it.status === 'completed');
      if (nextCompleted !== -1) {
        selectBatchItemTranscript(nextCompleted);
      } else {
        activeBatchSelectSeq++;
        if (typeof win.unloadCompanionPlayer === 'function') {
          win.unloadCompanionPlayer();
        }
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
    syncQuickTimeRangeUI();
    if (typeof win.syncTranscribeDeckTabsUI === 'function') {
      win.syncTranscribeDeckTabsUI();
    }
    updateDeckScrollCue();
    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(false);
    }
  }
};

export function clearBatchQueue(): void {
  if (isBatchExtracting) return;
  if (transcriptViewer.hasPendingEdits()) {
    void transcriptViewer.flushEdits();
  }
  batchQueueEpoch++;
  activeBatchSelectSeq++;
  batchItems = [];
  selectedMediaFiles = [];
  isBatchMode = false;
  activeBatchViewerIndex = -1;
  batchProcessingIndex = -1;
  userExplicitlySelectedBatchItem = false;

  const win = getGlobal();
  if (typeof win.unloadCompanionPlayer === 'function') {
    win.unloadCompanionPlayer();
  }
  win.selectedMediaFile = null;
  win.probedMetadata = null;
  resetTranscribeTimeRange(false);
  updateTranscribeRangeVisibility(false);
  window.lastTranscribedSubtitlePath = null;
  window.lastTranscribedVideoPath = null;
  window.lastTranscribedOutputDir = null;
  window.lastTranscribedOutputFiles = [];
  transcriptViewer.lines = [];
  if (win) win.transcriptLines = [];

  if (typeof document !== 'undefined') {
    const dropZone = document.getElementById('transcribe-drop-zone');
    if (dropZone) {
      dropZone.classList.remove('has-file');
      dropZone.classList.remove('is-batch-summary');
      dropZone.title = t('transcribe.selectFilePrompt');
      if (typeof dropZone.setAttribute === 'function') {
        dropZone.setAttribute('data-i18n-title', 'transcribe.selectFilePrompt');
      }
    }

    const fileNameEl = document.getElementById('lbl-file-name');
    if (fileNameEl) {
      fileNameEl.style.display = 'block';
      if (typeof win.updateMediaCardName === 'function') {
        win.updateMediaCardName(null);
      } else {
        if (typeof fileNameEl.setAttribute === 'function') {
          fileNameEl.setAttribute('data-i18n', 'transcribe.noFileLoaded');
        }
        fileNameEl.textContent = t('transcribe.noFileLoaded');
        clearContentDirection(fileNameEl);
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
    renderBatchQueueTable();
    const setupDeckBody =
      typeof document.querySelector === 'function'
        ? (document.querySelector('#transcribe-unified-deck .transcribe-deck-body') as HTMLElement | null)
        : null;
    if (setupDeckBody) setupDeckBody.style.display = 'flex';
    if (typeof win.showTranscribeSetupDeck === 'function') {
      win.showTranscribeSetupDeck();
    } else if (typeof win.syncTranscribeDeckTabsUI === 'function') {
      win.syncTranscribeDeckTabsUI();
    }

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

    if (typeof win.setWizardStepCompleted === 'function') {
      win.setWizardStepCompleted(1, false);
      win.setWizardStepCompleted(2, false);
      win.setWizardStepCompleted(3, false);
    }

    const mediaIcon = document.getElementById('transcribe-media-icon');
    if (mediaIcon) {
      mediaIcon.innerHTML = MEDIA_ICON_SVGS.video;
    }
    const metaTypeText = document.getElementById('meta-type-text');
    if (metaTypeText) {
      metaTypeText.textContent = '-';
    } else {
      const metaType = document.getElementById('meta-type');
      if (metaType) metaType.textContent = '-';
    }
    const durEl = document.getElementById('meta-duration');
    const durText = document.getElementById('meta-duration-text');
    if (durText) {
      durText.textContent = '-';
    } else if (durEl) {
      durEl.textContent = '-';
    }
    if (durEl) durEl.removeAttribute('title');

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
      delete msgEl.dataset.batchSummarySkipped;
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

  const currentSettings = getSettingsState();
  if (currentSettings) {
    currentSettings.inputFile = "";
    saveCurrentSettings();
  }
}

function resetBatchSortSelect(): void {
  if (typeof document === 'undefined') return;
  const sortSelect = document.getElementById('batch-sort-select') as HTMLSelectElement | null;
  if (sortSelect && sortSelect.value) {
    sortSelect.value = '';
    if (window.customSelectsMap && window.customSelectsMap.get('batch-sort-select')) {
      window.customSelectsMap.get('batch-sort-select').syncSelectedValue();
    }
  }
}

export function moveBatchItemUp(index: number): void {
  if (isBatchExtracting) return;
  if (index <= 0 || index >= batchItems.length) return;

  if (transcriptViewer.hasPendingEdits()) {
    void transcriptViewer.flushEdits();
  }

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

  resetBatchSortSelect();
  renderBatchQueueTable();
}

export function moveBatchItemDown(index: number): void {
  if (isBatchExtracting) return;
  if (index < 0 || index >= batchItems.length - 1) return;

  if (transcriptViewer.hasPendingEdits()) {
    void transcriptViewer.flushEdits();
  }

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

  resetBatchSortSelect();
  renderBatchQueueTable();
}

export function sortBatchQueue(criteria: string): void {
  if (isBatchExtracting) return;
  if (batchItems.length <= 1) {
    resetBatchSortSelect();
    return;
  }

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
    const sortSelect = document.getElementById('batch-sort-select') as HTMLSelectElement | null;
    if (sortSelect) {
      sortSelect.value = criteria;
      if (window.customSelectsMap && window.customSelectsMap.get('batch-sort-select')) {
        window.customSelectsMap.get('batch-sort-select').syncSelectedValue();
      }
    }
  }

  renderBatchQueueTable();
}

export async function selectBatchItemTranscript(index: number): Promise<void> {
  if (index < 0 || index >= batchItems.length) return;
  const item = batchItems[index];
  if (!item) return;

  const currentSeq = ++activeBatchSelectSeq;
  const isStaleSelection = (): boolean =>
    currentSeq !== activeBatchSelectSeq || !batchItems.includes(item);

  const win = getGlobal();
  const isActive = item.status === 'converting' || item.status === 'transcribing' || item.status === 'translating';
  const isCompleted = item.status === 'completed';

  if (!isCompleted && !isActive) {
    return;
  }

  // Preserve user focus and editing state if this completed item is already active and loaded
  if (activeBatchViewerIndex === index && isCompleted && userExplicitlySelectedBatchItem && Array.isArray(item.transcriptLines)) {
    return;
  }

  if (activeBatchViewerIndex !== index) {
    if (transcriptViewer.hasPendingEdits()) {
      await transcriptViewer.flushEdits();
      if (isStaleSelection()) return;
    }
    if (activeBatchViewerIndex >= 0 && activeBatchViewerIndex < batchItems.length) {
      const prevItem = batchItems[activeBatchViewerIndex];
      if (prevItem && typeof transcriptViewer.getHistory === 'function') {
        prevItem.history = transcriptViewer.getHistory();
      }
    }
  }

  if (isStaleSelection()) return;

  activeBatchViewerIndex = batchItems.indexOf(item);
  userExplicitlySelectedBatchItem = !isActive;

  if (typeof transcriptViewer.setHistory === 'function') {
    transcriptViewer.setHistory(item.history || { undoStack: [], redoStack: [] });
  }

  const cloneBatchLine = (l: any): any => ({
    ...l,
    words: Array.isArray(l?.words) ? l.words.map((w: any) => ({ ...w })) : undefined
  });

  if (isActive) {
    if (typeof win.unloadCompanionPlayer === 'function') {
      win.unloadCompanionPlayer();
    }
    if (item.transcriptLines && item.transcriptLines.length > 0) {
      transcriptViewer.lines = item.transcriptLines.map(cloneBatchLine);
      if (win && win.transcriptLines !== transcriptViewer.lines) win.transcriptLines = transcriptViewer.lines;
      transcriptViewer.render(transcriptViewer.lines);
      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }
    } else {
      transcriptViewer.lines = [];
      if (win && win.transcriptLines !== transcriptViewer.lines) win.transcriptLines = [];
      if (transcriptViewer.isConfidenceActive()) {
        transcriptViewer.toggleConfidence(false);
      } else {
        transcriptViewer.syncConfidenceUI([]);
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
    if (typeof document !== 'undefined') {
      const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
      if (btnCopy) btnCopy.disabled = ((transcriptViewer.lines?.length ?? 0) === 0);
    }
  } else if (isCompleted) {
    if (Array.isArray(item.transcriptLines)) {
      transcriptViewer.lines = item.transcriptLines.map(cloneBatchLine);
      if (win && win.transcriptLines !== transcriptViewer.lines) win.transcriptLines = transcriptViewer.lines;
      transcriptViewer.render(transcriptViewer.lines, false);
      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.scrollTop = 0;
        }
      }
    } else {
      if (item.internalJsonPath) {
        const invoke = getTauriInvoke();
        if (invoke) {
          try {
            const sessionJson: string = await invoke('get_transcript_session_data', {
              sessionFile: item.internalJsonPath
            });
            if (isStaleSelection()) return;
            if (sessionJson) {
              const loaded = await loadTranscriptFromJsonData(sessionJson, false);
              if (isStaleSelection()) return;
              if (loaded && loaded.length > 0) {
                item.transcriptLines = loaded.map(cloneBatchLine);
                const loadedLines = item.transcriptLines.map(cloneBatchLine);
                transcriptViewer.lines = loadedLines;
                if (win && win.transcriptLines !== transcriptViewer.lines) win.transcriptLines = loadedLines;
                transcriptViewer.render(loadedLines, false);
                if (typeof document !== 'undefined') {
                  const viewport = document.getElementById('transcript-viewport');
                  if (viewport) {
                    viewport.scrollTop = 0;
                  }
                }
              }
            }
          } catch (jsonErr) {
            console.warn('Could not load internal batch item session JSON:', jsonErr);
          }
        }
      }
      if (!Array.isArray(item.transcriptLines)) {
        if (item.subtitlePath) {
          try {
            const loaded = await loadTranscriptFromFile(item.subtitlePath, false);
            if (isStaleSelection()) return;
            item.transcriptLines = (loaded || []).map(cloneBatchLine);
          } catch (e) {
            console.error("Failed to load batch item subtitle:", e);
          }
        } else if (item.txtPath) {
          try {
            const loaded = await loadTranscriptFromFile(item.txtPath, false);
            if (isStaleSelection()) return;
            item.transcriptLines = (loaded || []).map(cloneBatchLine);
          } catch (e) {
            console.error("Failed to load batch item transcript:", e);
          }
        } else {
          item.transcriptLines = [];
        }
        if (isStaleSelection()) return;
        const fallbackLines = (item.transcriptLines || []).map(cloneBatchLine);
        transcriptViewer.lines = fallbackLines;
        if (win && win.transcriptLines !== transcriptViewer.lines) win.transcriptLines = fallbackLines;
        transcriptViewer.render(fallbackLines, false);
        if (typeof document !== 'undefined') {
          const viewport = document.getElementById('transcript-viewport');
          if (viewport) {
            viewport.scrollTop = 0;
          }
        }
      }
    }
    if (isStaleSelection()) return;
    if (item.path && typeof win.loadMediaIntoCompanionPlayer === 'function') {
      try {
        const viewerLines = transcriptViewer.lines || [];
        const firstLine = viewerLines.length > 0 ? viewerLines[0] : null;
        const firstStartMs =
          typeof firstLine?.startMs === 'number' && firstLine.startMs > 0 ? firstLine.startMs : 0;
        const loadResult = win.loadMediaIntoCompanionPlayer(item.path, false, item.durationSec ?? undefined);
        if (firstStartMs > 0 && typeof win.seekCompanionPlayer === 'function') {
          void Promise.resolve(loadResult).then((loaded: any) => {
            if (loaded !== false && !isStaleSelection()) {
              win.seekCompanionPlayer(firstStartMs, false, firstLine?.id, false);
            }
          });
        }
      } catch (_) {}
    }
    if (typeof document !== 'undefined') {
      const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
      if (btnCopy) btnCopy.disabled = ((transcriptViewer.lines?.length ?? 0) === 0);
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
}

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
        selectBatchItemTranscript(index);
      };
      card.ondblclick = () => {
        if (item.status !== 'completed') return;
        void selectBatchItemTranscript(index).then(() => {
          const win = getGlobal();
          if (typeof win.showTranscribeMediaDeck === 'function' && item.path) {
            win.showTranscribeMediaDeck();
          }
        });
      };
      card.onkeydown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectBatchItemTranscript(index);
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
    } else if (item.status === 'skipped') {
      badge.className = 'batch-status-badge badge-skipped';
      badge.textContent = t('transcribe.statusSkipped') || 'Skipped';
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
        moveBatchItemUp(index);
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
        moveBatchItemDown(index);
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
        removeFileFromBatch(index);
      };
    }

    actionGroup.appendChild(upBtn);
    actionGroup.appendChild(downBtn);
    actionGroup.appendChild(deleteBtn);
    bottomRow.appendChild(actionGroup);

    card.appendChild(bottomRow);
    container.appendChild(card);
  });
  updateDeckScrollCue();
}

function cleanupBatchExtractionState(
  cancelBtn: HTMLButtonElement | null,
  sortSelect: HTMLSelectElement | null,
  clearBtn: HTMLButtonElement | null
): void {
  isBatchExtracting = false;
  batchCancelActive = false;
  batchProcessingIndex = -1;

  const win = getGlobal();
  if (win) {
    try {
      win.isBatchExtracting = false;
      win.batchProcessingIndex = -1;
    } catch (_) {}
    if (typeof win.updateTranscribeActionButtons === 'function') {
      try {
        win.updateTranscribeActionButtons(false);
      } catch (_) {}
    }
    if (typeof win.updateTranscribeWorkflowButtons === 'function') {
      try {
        win.updateTranscribeWorkflowButtons();
      } catch (_) {}
    }
  }

  const activeCancelBtn = cancelBtn || (typeof document !== 'undefined' ? (document.getElementById('btn-cancel-batch') as HTMLButtonElement | null) : null);
  if (activeCancelBtn) {
    try {
      activeCancelBtn.disabled = false;
      const cancelSpan = activeCancelBtn.querySelector('span');
      if (cancelSpan) {
        cancelSpan.setAttribute('data-i18n', 'transcribe.cancelBatch');
        cancelSpan.textContent = t('transcribe.cancelBatch');
      } else {
        activeCancelBtn.textContent = t('transcribe.cancelBatch');
      }
      activeCancelBtn.style.display = 'none';
    } catch (_) {}
  }

  const activeSortSelect = sortSelect || (typeof document !== 'undefined' ? (document.getElementById('batch-sort-select') as HTMLSelectElement | null) : null);
  if (activeSortSelect) {
    try {
      activeSortSelect.disabled = false;
    } catch (_) {}
  }

  const activeClearBtn = clearBtn || (typeof document !== 'undefined' ? (document.getElementById('btn-clear-batch') as HTMLButtonElement | null) : null);
  if (activeClearBtn) {
    try {
      activeClearBtn.disabled = false;
    } catch (_) {}
  }

  try {
    const fillBar = typeof document !== 'undefined' ? document.getElementById('progress-linear-fill') : null;
    if (fillBar) fillBar.classList.remove('indeterminate');
  } catch (_) {}

  try {
    const pulseDot = typeof document !== 'undefined' ? document.getElementById('hud-pulse-dot') : null;
    if (pulseDot) pulseDot.classList.remove('active');
  } catch (_) {}

  try {
    const btnCopy = typeof document !== 'undefined' ? (document.getElementById('btn-copy-transcript') as HTMLButtonElement | null) : null;
    if (btnCopy && (transcriptViewer.lines?.length ?? 0) === 0) {
      btnCopy.disabled = true;
    }
  } catch (_) {}

  try {
    renderBatchQueueTable();
  } catch (_) {}
}

export async function runBatchExtraction(): Promise<void> {
  const win = getGlobal();
  // Concurrency guard: Mutual exclusion with single-file pipeline without direct circular import
  const isSingleTranscribing = Boolean(
    win && (
      win.isTranscribing ||
      (win.transcribePipeline && typeof win.transcribePipeline.getIsTranscribing === 'function' && win.transcribePipeline.getIsTranscribing())
    )
  );

  if (isBatchExtracting || isSingleTranscribing) {
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.taskRunningWarning'), "info");
    }
    return;
  }
  if (!isBatchMode || batchItems.length === 0) return;

  if (!validateAndApplyQuickTimeRange(true)) {
    if (typeof win.showTranscribeSetupDeck === 'function') {
      win.showTranscribeSetupDeck();
    }
    if (typeof win.showNotification === 'function') {
      win.showNotification(
        t('transcribe.rangeErrorInvalidAction') || 'Please fix the custom time range before transcribing.',
        'error'
      );
    }
    return;
  }

  const invoke = getTauriInvoke();
  if (!invoke) return;

  const runSettings: SettingsState = { ...(getSettingsState() || {}) };
  const backend = runSettings.selectedBackend || 'Standard';
  const isCompiled = backend === 'Standard' || Boolean(compiledBackends[backend]);
  if (!isCompiled) {
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.backendNotFound', { backend }), "error");
    }
    if (typeof win.switchView === 'function') win.switchView('settings');
    return;
  }

  const scannedModels = localScannedTransModels.length > 0 ? localScannedTransModels : (win.localScannedTransModels || []);
  const modelExists = scannedModels.includes(runSettings.modelPath);
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
  if (win) {
    try {
      win.isBatchExtracting = true;
    } catch (_) {}
  }
  try {
    if (typeof window !== 'undefined' && typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(true);
    }
    if (sortSelect) sortSelect.disabled = true;
    if (clearBtn) clearBtn.disabled = true;

    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.disabled = false;
      if (cancelBtnSpan) {
        cancelBtnSpan.setAttribute('data-i18n', 'transcribe.cancelBatch');
        cancelBtnSpan.textContent = t('transcribe.cancelBatch');
      } else {
        cancelBtn.textContent = t('transcribe.cancelBatch');
      }
    }

    batchCancelActive = false;
    if (typeof win.unloadCompanionPlayer === 'function') {
      try {
        win.unloadCompanionPlayer();
      } catch (_) {}
    } else if (typeof win.pauseCompanionPlayer === 'function') {
      try {
        win.pauseCompanionPlayer();
      } catch (_) {}
    }
    if (typeof win.showTranscribeFilesDeck === 'function') {
      try {
        win.showTranscribeFilesDeck();
      } catch (_) {}
    } else if (typeof document !== 'undefined') {
      const batchQueueContainer = document.getElementById('batch-queue-container');
      if (batchQueueContainer) batchQueueContainer.style.display = 'flex';
    }
    const telemetryCard = document.getElementById('telemetry-hud-card');
    if (telemetryCard) telemetryCard.style.display = 'block';
    if (typeof win.setTranscribeStatusBadge === 'function') {
      win.setTranscribeStatusBadge('active', 'transcribe.batchRunning');
    }
    const metricsEl = document.getElementById('transcribe-metrics');
    if (metricsEl) metricsEl.style.display = 'none';

    activeBatchSelectSeq++;
    batchProcessingIndex = -1;
    userExplicitlySelectedBatchItem = false;
    window.lastTranscribedSubtitlePath = null;
    window.lastTranscribedOutputDir = null;
    window.lastTranscribedVideoPath = null;
    window.lastTranscribedOutputFiles = [];
    transcriptViewer.lines = [];
    if (win) win.transcriptLines = [];
    activeBatchViewerIndex = 0; // Follow first item initially

    batchItems.forEach(item => {
      item.status = 'pending';
      item.transcriptLines = [];
      item.outputs = [];
      item.outputFiles = [];
      item.subtitlePath = null;
      item.txtPath = null;
      item.timeSec = 0;
      item.speedFactor = 0.0;
    });

    if (typeof window !== 'undefined' && typeof window.updateTranscribeWorkflowButtons === 'function') {
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
    let skippedCount = 0;
    const totalCount = batchItems.length;
    const batchOffsetMs = Math.max(0, Number(runSettings.offsetT || 0));

    for (let i = 0; i < totalCount; i++) {
    batchProcessingIndex = i;
    if (batchCancelActive) {
      batchItems[i].status = 'aborted';
      continue;
    }

    const item = batchItems[i];
    item.transcriptLines = [];

    if (batchOffsetMs > 0 && !(typeof item.durationSec === 'number' && item.durationSec > 0)) {
      try {
        const meta = await invoke('probe_media_file', { filePath: item.path });
        if (meta && meta.exists && typeof meta.durationSec === 'number' && meta.durationSec > 0) {
          item.size = meta.size || item.size;
          item.durationSec = meta.durationSec;
        }
      } catch (_) {}
      if (batchCancelActive) {
        item.status = 'aborted';
        renderBatchQueueTable();
        continue;
      }
    }

    if (
      batchOffsetMs > 0 &&
      typeof item.durationSec === 'number' &&
      item.durationSec > 0 &&
      batchOffsetMs >= Math.max(1, Math.round(item.durationSec * 1000))
    ) {
      item.status = 'skipped';
      skippedCount++;
      renderBatchQueueTable();
      const offsetStr = formatMsToTimecode(batchOffsetMs, true);
      const skipMsg =
        t('toasts.batchItemSkippedShort', {
          name: item.name,
          start: isolateLtr(offsetStr)
        }) || `Skipped '${item.name}': shorter than start time (${offsetStr}).`;
      logsController.push({
        category: 'Batch',
        message: skipMsg,
        timestamp: new Date().toLocaleTimeString()
      });
      const skipPct = (((i + 1) / totalCount) * 100).toFixed(0);
      if (fillBar) fillBar.style.width = `${skipPct}%`;
      if (pctEl) pctEl.textContent = `${skipPct}%`;
      continue;
    }

    if (!userExplicitlySelectedBatchItem) {
      activeBatchViewerIndex = i;
    }

    item.status = 'converting';
    renderBatchQueueTable();

    const globalPct = ((i / totalCount) * 100).toFixed(0);
    if (fillBar) fillBar.style.width = `${globalPct}%`;
    if (pctEl) pctEl.textContent = `${globalPct}%`;
    if (msgEl) msgEl.textContent = t('transcribe.batchConvertingProgress', { current: i + 1, total: totalCount, name: item.name });

    let currentWavPath: string | null = null;
    const itemSettings: SettingsState = { ...runSettings, inputFile: item.path };

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
        transcriptViewer.lines = [];
        if (win) win.transcriptLines = [];
        window.lastTranscribedSubtitlePath = null;
        if (typeof window !== 'undefined' && typeof window.updateTranscribeWorkflowButtons === 'function') {
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
        settings: itemSettings,
        wavPath: currentWavPath,
        durationSec: item.durationSec || 60.0
      });

      item.internalJsonPath = result.internalJsonPath || null;

      // Populate transcript lines with exact word-level timestamps & confidence from internal JSON
      let loadedFromInternalJson = false;
      if (result.internalJsonPath) {
        try {
          const sessionJson: string = await invoke('get_transcript_session_data', {
            sessionFile: result.internalJsonPath
          });
          if (sessionJson) {
            const shouldRender = (activeBatchViewerIndex === i);
            const parsedLines = await loadTranscriptFromJsonData(sessionJson, shouldRender);
            if (parsedLines && parsedLines.length > 0) {
              item.transcriptLines = parsedLines.map((l: any) => ({
                ...l,
                words: Array.isArray(l?.words) ? l.words.map((w: any) => ({ ...w })) : undefined
              }));
              if (shouldRender && win && win.transcriptLines !== transcriptViewer.lines) {
                win.transcriptLines = transcriptViewer.lines;
              }
              loadedFromInternalJson = true;
            }
          }
        } catch (jsonErr) {
          console.warn('Could not load internal batch session JSON:', jsonErr);
        }
      }

      if (!loadedFromInternalJson && (!item.transcriptLines || item.transcriptLines.length === 0) && result.generatedFiles && result.generatedFiles.length > 0) {
        const outputDir = result.outputDir || getParentDir(item.path);
        const subFile = result.generatedFiles.find((f: string) => f.endsWith('.srt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.vtt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.lrc')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.txt'));
        if (subFile) {
          const sep = outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
          const subFullPath = `${outputDir}${sep}${subFile}`;
          const shouldRender = (activeBatchViewerIndex === i);
          const loaded = await loadTranscriptFromFile(subFullPath, shouldRender);
          item.transcriptLines = (loaded || []).map((l: any) => ({ ...l }));
          if (shouldRender && win && win.transcriptLines !== transcriptViewer.lines) {
            win.transcriptLines = transcriptViewer.lines;
          }
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

      const rawItemOutputDir = (runSettings.outputDirMode === 'custom' && runSettings.outputDirPath) ? runSettings.outputDirPath : (result.outputDir || getParentDir(item.path));
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

      const txtFileObj = outputFilesList.find(f => f.name.endsWith('.txt'));
      item.txtPath = txtFileObj ? txtFileObj.path : (item.subtitlePath || null);

      if (activeBatchViewerIndex === i) {
        window.lastTranscribedOutputDir = item.outputDir;
        window.lastTranscribedSubtitlePath = item.subtitlePath;
        window.lastTranscribedVideoPath = item.path;
        window.lastTranscribedOutputFiles = item.outputFiles;
        if (typeof window !== 'undefined' && typeof window.updateTranscribeWorkflowButtons === 'function') {
          window.updateTranscribeWorkflowButtons();
        }
      }

      renderBatchQueueTable();
    } catch (err: any) {
      const errMsg = (typeof err === 'string') ? err : (err && err.toString ? err.toString() : '');
      const isCancelled = batchCancelActive ||
        errMsg.toLowerCase().includes('cancelled') ||
        errMsg.toLowerCase().includes('aborted');

      if (isCancelled) {
        item.status = 'aborted';
        renderBatchQueueTable();
      } else {
        item.status = 'failed';
        renderBatchQueueTable();
        if (typeof win.showNotification === 'function') {
          win.showNotification(t('toasts.batchItemError', { name: item.name, error: String(err) }), "error");
        }
      }
    }
  }

    const wasCancelled = batchCancelActive;

    if (wasCancelled) {
      if (telemetryCard) telemetryCard.style.display = 'none';
      if (fillBar) fillBar.style.width = '0%';
      if (pctEl) pctEl.textContent = '0%';
      if (metricsEl) metricsEl.style.display = 'none';
      if (msgEl) {
        delete (msgEl.dataset as any).batchSummarySuccess;
        delete (msgEl.dataset as any).batchSummaryTotal;
        delete (msgEl.dataset as any).batchSummarySkipped;
        delete (msgEl.dataset as any).statusCompleted;
        msgEl.setAttribute('data-i18n', 'transcribe.standingBy');
        msgEl.textContent = t('transcribe.standingBy');
      }
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
      const lang = getLanguage();
      const successStr = formatLocalizedNumber(successCount, lang, 0);
      const totalStr = formatLocalizedNumber(totalCount, lang, 0);
      const skippedStr = formatLocalizedNumber(skippedCount, lang, 0);
      if (msgEl) {
        msgEl.removeAttribute('data-i18n');
        msgEl.dataset.batchSummarySuccess = String(successCount);
        msgEl.dataset.batchSummaryTotal = String(totalCount);
        if (skippedCount > 0) {
          msgEl.dataset.batchSummarySkipped = String(skippedCount);
          msgEl.textContent = t('transcribe.batchCompletedSummaryWithSkipped', {
            success: successStr,
            total: totalStr,
            skipped: skippedStr
          });
        } else {
          delete (msgEl.dataset as any).batchSummarySkipped;
          msgEl.textContent = t('transcribe.batchCompletedSummary', { success: successStr, total: totalStr });
        }
      }
      if (typeof win.showNotification === 'function') {
        if (skippedCount > 0) {
          win.showNotification(
            t('toasts.batchCompleteWithSkipped', { success: successStr, total: totalStr, skipped: skippedStr }),
            successCount > 0 ? "info" : "warning"
          );
        } else {
          win.showNotification(t('toasts.batchComplete', { success: successStr, total: totalStr }), "success");
        }
      }
      if (typeof win.setTranscribeStatusBadge === 'function') {
        if (successCount > 0) {
          win.setTranscribeStatusBadge('complete', 'transcribe.statusComplete');
        } else if (skippedCount > 0) {
          win.setTranscribeStatusBadge('warning', 'transcribe.statusSkipped');
        } else {
          win.setTranscribeStatusBadge('cancelled', 'transcribe.statusFailed');
        }
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
        if (viewedItem.path && typeof win.loadMediaIntoCompanionPlayer === 'function') {
          try {
            const alreadyLoadedInPlayer =
              typeof win.getActiveMediaInfo === 'function' &&
              (win.getActiveMediaInfo() as any)?.filePath === viewedItem.path;
            const lines = Array.isArray(viewedItem.transcriptLines) ? viewedItem.transcriptLines : (transcriptViewer.lines || []);
            const firstLine = lines.length > 0 ? lines[0] : null;
            const firstStartMs =
              typeof firstLine?.startMs === 'number' && firstLine.startMs > 0 ? firstLine.startMs : 0;
            const loadResult = await win.loadMediaIntoCompanionPlayer(
              viewedItem.path,
              false,
              viewedItem.durationSec ?? undefined
            );
            if (!alreadyLoadedInPlayer && firstStartMs > 0 && loadResult !== false && typeof win.seekCompanionPlayer === 'function') {
              win.seekCompanionPlayer(firstStartMs, false, firstLine?.id, false);
            }
          } catch (_) {}
        }
      } else if (latestCompletedIdx === -1) {
        activeBatchViewerIndex = -1;
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
      if (typeof window !== 'undefined' && typeof window.updateTranscribeWorkflowButtons === 'function') {
        window.updateTranscribeWorkflowButtons();
      }
    }

    renderBatchQueueTable();
    if (!wasCancelled) {
      if (typeof win.syncTranscribeDeckTabsUI === 'function') {
        win.syncTranscribeDeckTabsUI();
      }
      updateDeckScrollCue();
    }

    const autoTransferEnabled = Boolean(runSettings.autoTransferToTranslate ?? runSettings.translateAiEnabled);
    const hasTranslatable = Boolean(
      window.lastTranscribedSubtitlePath ||
      (window.lastTranscribedOutputFiles || []).some((f: any) =>
        f?.type === 'text' || String(f?.name || '').toLowerCase().endsWith('.txt')
      )
    );
    if (!wasCancelled && successCount > 0 && autoTransferEnabled && hasTranslatable) {
      if (typeof window.sendTranscribeToTranslationStudio === 'function') {
        await window.sendTranscribeToTranslationStudio();
      }
    }

    if (typeof win.setWizardStepCompleted === 'function') {
      win.setWizardStepCompleted(3, !wasCancelled && successCount > 0);
    }
  } catch (outerErr: any) {
    const errMsg = (typeof outerErr === 'string') ? outerErr : (outerErr?.message || (outerErr && outerErr.toString ? outerErr.toString() : ''));
    console.error('Unhandled error during batch extraction:', outerErr);
    const wasCancelled = batchCancelActive ||
      errMsg.toLowerCase().includes('cancelled') ||
      errMsg.toLowerCase().includes('aborted');

    if (wasCancelled) {
      batchItems.forEach(it => {
        if (it.status === 'pending' || it.status === 'converting' || it.status === 'transcribing') {
          it.status = 'aborted';
        }
      });
    } else if (batchProcessingIndex >= 0 && batchProcessingIndex < batchItems.length) {
      const activeItem = batchItems[batchProcessingIndex];
      if (activeItem && (activeItem.status === 'converting' || activeItem.status === 'transcribing')) {
        activeItem.status = 'failed';
      }
    }

    try {
      const telemetryCard = typeof document !== 'undefined' ? document.getElementById('telemetry-hud-card') : null;
      const fillBar = typeof document !== 'undefined' ? document.getElementById('progress-linear-fill') : null;
      const pctEl = typeof document !== 'undefined' ? document.getElementById('lbl-radial-pct') : null;
      const metricsEl = typeof document !== 'undefined' ? document.getElementById('transcribe-metrics') : null;
      const msgEl = typeof document !== 'undefined' ? (document.getElementById('lbl-radial-msg') as HTMLElement | null) : null;

      if (wasCancelled) {
        if (telemetryCard) telemetryCard.style.display = 'none';
        if (fillBar) fillBar.style.width = '0%';
        if (pctEl) pctEl.textContent = '0%';
        if (metricsEl) metricsEl.style.display = 'none';
        if (msgEl) {
          delete (msgEl.dataset as any).batchSummarySuccess;
          delete (msgEl.dataset as any).batchSummaryTotal;
          delete (msgEl.dataset as any).batchSummarySkipped;
          delete (msgEl.dataset as any).statusCompleted;
          if (typeof msgEl.setAttribute === 'function') {
            msgEl.setAttribute('data-i18n', 'transcribe.standingBy');
          }
          msgEl.textContent = t('transcribe.standingBy');
        }
        if (typeof win.setTranscribeStatusBadge === 'function') {
          win.setTranscribeStatusBadge('', 'transcribe.standingBy');
        }
        if (typeof win.showNotification === 'function') {
          win.showNotification(t('toasts.batchCancelled'), "info");
        }
      } else {
        if (typeof win.showNotification === 'function') {
          win.showNotification(t('toasts.batchItemError', { name: 'Batch', error: errMsg || String(outerErr) }), "error");
        }
        if (typeof win.setTranscribeStatusBadge === 'function') {
          win.setTranscribeStatusBadge('cancelled', 'transcribe.statusFailed');
        }
        if (msgEl) {
          delete (msgEl.dataset as any).batchSummarySuccess;
          delete (msgEl.dataset as any).batchSummaryTotal;
          delete (msgEl.dataset as any).batchSummarySkipped;
          delete (msgEl.dataset as any).statusCompleted;
          if (typeof msgEl.setAttribute === 'function') {
            msgEl.setAttribute('data-i18n', 'transcribe.taskFailed');
          }
          msgEl.textContent = t('transcribe.taskFailed');
        }
      }

      if (typeof document !== 'undefined') {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport && viewport.querySelector('.transcript-initializing-state')) {
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

      if (typeof win.setWizardStepCompleted === 'function') {
        win.setWizardStepCompleted(3, false);
      }
    } catch (hudErr) {
      console.warn('Failed to update HUD on batch error:', hudErr);
    }
  } finally {
    cleanupBatchExtractionState(cancelBtn, sortSelect, clearBtn);
  }
}

export async function abortBatchExtraction(): Promise<void> {
  if (!isBatchExtracting || batchCancelActive) return;
  const doc = typeof document !== 'undefined' ? document : null;
  const cancelBtn = doc ? (doc.getElementById('btn-cancel-batch') as HTMLButtonElement | null) : null;
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    if (cancelBtnSpan) {
      cancelBtnSpan.setAttribute('data-i18n', 'transcribe.aborting');
      cancelBtnSpan.textContent = t('transcribe.aborting');
    } else {
      cancelBtn.textContent = t('transcribe.aborting');
    }
  }

  batchCancelActive = true;
  const invoke = getTauriInvoke();
  const win = getGlobal();

  try {
    if (invoke) {
      await invoke('cancel_transcription');
    }
    const telemetryCard = doc ? doc.getElementById('telemetry-hud-card') : null;
    if (telemetryCard) telemetryCard.style.display = 'none';
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.cancellingTask'), "info");
    }
  } catch (err: any) {
    const errMsg = (typeof err === 'string') ? err : (err && err.toString ? err.toString() : '');
    const isNoActiveSession = errMsg.includes("No active transcription or translation session");

    if (isNoActiveSession) {
      // Backend was not actively running whisper (e.g. converting audio via ffmpeg or between batch items).
      // Cancellation of the batch should STILL proceed cleanly!
      const telemetryCard = doc ? doc.getElementById('telemetry-hud-card') : null;
      if (telemetryCard) telemetryCard.style.display = 'none';
      if (typeof win.showNotification === 'function') {
        win.showNotification(t('toasts.cancellingTask'), "info");
      }
      return;
    }

    batchCancelActive = false;
    console.error("Failed to cancel active whisper process:", err);
    if (typeof win.showNotification === 'function') {
      win.showNotification(t('toasts.cancelProcessError', { error: errMsg }), "error");
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      const cancelSpan = cancelBtn.querySelector('span');
      if (cancelSpan) {
        cancelSpan.setAttribute('data-i18n', 'transcribe.cancelBatch');
        cancelSpan.textContent = t('transcribe.cancelBatch');
      } else {
        cancelBtn.textContent = t('transcribe.cancelBatch');
      }
      cancelBtn.style.display = 'inline-flex';
    }
  }
};

export async function addBatchFiles(files: string[]): Promise<boolean> {
  if (isBatchExtracting) return false;
  const rawList = Array.isArray(files)
    ? files.map(f => (typeof f === 'string' ? f.trim() : '')).filter(f => f.length > 0)
    : [];
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
    resetBatchSortSelect();

    if (typeof document !== 'undefined') {
      const dropZone = document.getElementById('transcribe-drop-zone');
      if (dropZone) {
        dropZone.classList.add('has-file');
        dropZone.classList.add('is-batch-summary');
        dropZone.title = t('transcribe.queueFilesHeader');
        if (typeof dropZone.setAttribute === 'function') {
          dropZone.setAttribute('data-i18n-title', 'transcribe.queueFilesHeader');
        }
      }
      const fileNameEl = document.getElementById('lbl-file-name');
      if (fileNameEl) {
        if (typeof fileNameEl.setAttribute === 'function') {
          fileNameEl.setAttribute('data-i18n', 'transcribe.batchModeActive');
        }
        fileNameEl.textContent = t('transcribe.batchModeActive');
        if (typeof fileNameEl.removeAttribute === 'function') {
          fileNameEl.removeAttribute('title');
        }
        clearContentDirection(fileNameEl);
      }
      const countEl = document.getElementById('batch-files-count');
      if (countEl) countEl.textContent = String(batchItems.length);
      const clearBtn = document.getElementById('btn-clear-media');
      if (clearBtn) clearBtn.style.display = 'inline-flex';
    }

    renderBatchQueueTable();
    updateBatchSpecs();
    syncQuickTimeRangeUI();
    if (typeof win.syncTranscribeDeckTabsUI === 'function') {
      win.syncTranscribeDeckTabsUI();
    }
    updateDeckScrollCue();
    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(false);
    }

    const invoke = getTauriInvoke();
    if (invoke) {
      const probeEpoch = batchQueueEpoch;
      (async () => {
        for (const item of newItems) {
          if (probeEpoch !== batchQueueEpoch) return;
          if (!batchItems.includes(item)) continue;
          try {
            const meta = await invoke('probe_media_file', { filePath: item.path });
            if (probeEpoch !== batchQueueEpoch) return;
            if (meta && meta.exists && batchItems.includes(item)) {
              item.size = meta.size;
              item.durationSec = meta.durationSec;
            }
          } catch (err) {
            console.error("Failed to probe file in batch:", err);
          }
        }
        if (probeEpoch !== batchQueueEpoch) return;
        renderBatchQueueTable();
        updateBatchSpecs();
        syncQuickTimeRangeUI();
        updateDeckScrollCue();
      })();
    }

    return true;
  }

  // Case 2: Entering Batch Mode (either initial multi-selection or replacing single file)
  const hadPriorSingle = Boolean(win.selectedMediaFile);
  batchQueueEpoch++;
  activeBatchSelectSeq++;
  isBatchMode = true;
  win.selectedMediaFile = null;
  win.probedMetadata = null;
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
  resetBatchSortSelect();

  if (typeof win.unloadCompanionPlayer === 'function') {
    win.unloadCompanionPlayer();
  }
  if (hadPriorSingle) {
    resetTranscribeTimeRange(true);
  }
  updateTranscribeRangeVisibility(true);

  if (typeof document !== 'undefined') {
    const dropZone = document.getElementById('transcribe-drop-zone');
    if (dropZone) {
      dropZone.classList.add('has-file');
      dropZone.classList.add('is-batch-summary');
      dropZone.title = t('transcribe.queueFilesHeader');
      if (typeof dropZone.setAttribute === 'function') {
        dropZone.setAttribute('data-i18n-title', 'transcribe.queueFilesHeader');
      }
    }

    const fileNameEl = document.getElementById('lbl-file-name');
    const filePathEl = document.getElementById('lbl-file-path');
    if (fileNameEl) {
      fileNameEl.style.display = 'block';
      if (typeof fileNameEl.setAttribute === 'function') {
        fileNameEl.setAttribute('data-i18n', 'transcribe.batchModeActive');
      }
      fileNameEl.textContent = t('transcribe.batchModeActive');
      if (typeof fileNameEl.removeAttribute === 'function') {
        fileNameEl.removeAttribute('title');
      }
      clearContentDirection(fileNameEl);
    }
    if (filePathEl) filePathEl.style.display = 'none';

    const clearBtn = document.getElementById('btn-clear-media');
    if (clearBtn) clearBtn.style.display = 'inline-flex';

    const batchQueueContainer = document.getElementById('batch-queue-container');
    if (batchQueueContainer) batchQueueContainer.style.display = 'none';

    const metaBox = document.getElementById('media-meta-box');
    if (metaBox) metaBox.style.display = 'none';
    const mediaIcon = document.getElementById('transcribe-media-icon');
    if (mediaIcon) {
      mediaIcon.innerHTML = MEDIA_ICON_SVGS.batch;
    }
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
  }

  if (typeof win.setWizardStepCompleted === 'function') {
    win.setWizardStepCompleted(1, true);
    win.setWizardStepCompleted(2, true);
  }

  renderBatchQueueTable();
  updateBatchSpecs();
  syncQuickTimeRangeUI();
  if (typeof win.showTranscribeSetupDeck === 'function') {
    win.showTranscribeSetupDeck();
  } else if (typeof win.syncTranscribeDeckTabsUI === 'function') {
    win.syncTranscribeDeckTabsUI();
  }
  updateDeckScrollCue();
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(false);
  }

  const invoke = getTauriInvoke();
  if (invoke) {
    const probeEpoch = batchQueueEpoch;
    const createdItems = [...batchItems];
    (async () => {
      for (const item of createdItems) {
        if (probeEpoch !== batchQueueEpoch) return;
        if (!batchItems.includes(item)) continue;
        try {
          const meta = await invoke('probe_media_file', { filePath: item.path });
          if (probeEpoch !== batchQueueEpoch) return;
          if (meta && meta.exists && batchItems.includes(item)) {
            item.size = meta.size;
            item.durationSec = meta.durationSec;
          }
        } catch (err) {
          console.error("Failed to probe file in batch:", err);
        }
      }
      if (probeEpoch !== batchQueueEpoch) return;
      renderBatchQueueTable();
      updateBatchSpecs();
      syncQuickTimeRangeUI();
      const currentSettings = getSettingsState();
      if (currentSettings && (Number(currentSettings.offsetT || 0) > 0 || Number(currentSettings.duration || 0) > 0)) {
        validateAndApplyQuickTimeRange(true);
      }
      updateDeckScrollCue();
    })();
  }

  return true;
}

export function resetBatchQueueState(): void {
  batchQueueEpoch++;
  activeBatchSelectSeq++;
  batchItems = [];
  selectedMediaFiles = [];
  isBatchMode = false;
  activeBatchViewerIndex = -1;
  batchProcessingIndex = -1;
  userExplicitlySelectedBatchItem = false;
}

export const batchProcessor = {
  getItems: () => [...batchItems],
  setItems: (items: BatchItem[]) => { batchItems = Array.isArray(items) ? [...items] : []; },
  getSelectedFiles: () => [...selectedMediaFiles],
  setSelectedFiles: (files: string[]) => {
    selectedMediaFiles = Array.isArray(files)
      ? files.map(f => (typeof f === 'string' ? f.trim() : '')).filter(f => f.length > 0)
      : [];
  },
  getIsBatchMode: () => isBatchMode,
  setIsBatchMode: (val: boolean) => { isBatchMode = Boolean(val); },
  resetQueueState: resetBatchQueueState,
  getIsExtracting: () => isBatchExtracting,
  setIsExtracting: (val: boolean) => {
    isBatchExtracting = Boolean(val);
    if (!isBatchExtracting) {
      batchCancelActive = false;
    }
  },
  getCancelActive: () => batchCancelActive,
  setCancelActive: (val: boolean) => { batchCancelActive = Boolean(val); },
  getActiveViewerIndex: () => activeBatchViewerIndex,
  setActiveViewerIndex: (idx: number) => { activeBatchViewerIndex = idx; },
  getProcessingIndex: () => batchProcessingIndex,
  setProcessingIndex: (idx: number) => { batchProcessingIndex = idx; },
  formatDuration,
  updateSpecs: updateBatchSpecs,
  removeFile: removeFileFromBatch,
  clearQueue: clearBatchQueue,
  moveUp: moveBatchItemUp,
  moveDown: moveBatchItemDown,
  sortQueue: sortBatchQueue,
  selectTranscript: selectBatchItemTranscript,
  renderTable: renderBatchQueueTable,
  runExtraction: runBatchExtraction,
  abortExtraction: abortBatchExtraction,
  addFiles: addBatchFiles,
  syncWindowBindings: syncBatchProcessorWindowBindings
};

export type BatchProcessor = typeof batchProcessor;

export { renderBatchQueueTable };

export function syncBatchProcessorWindowBindings(): void {
  const win = getGlobal();
  if (!win) return;

  win.removeFileFromBatch = removeFileFromBatch;
  win.clearBatchQueue = clearBatchQueue;
  win.moveBatchItemUp = moveBatchItemUp;
  win.moveBatchItemDown = moveBatchItemDown;
  win.sortBatchQueue = sortBatchQueue;
  win.selectBatchItemTranscript = selectBatchItemTranscript;
  win.renderBatchQueueTable = renderBatchQueueTable;
  win.runBatchExtraction = runBatchExtraction;
  win.abortBatchExtraction = abortBatchExtraction;
  win.updateBatchSpecs = updateBatchSpecs;
  win.formatDuration = formatDuration;
  win.addBatchFiles = addBatchFiles;
  win.batchProcessor = batchProcessor;

  try {
    Object.defineProperties(win, {
      isBatchMode: {
        get() { return isBatchMode; },
        set(val: boolean) { isBatchMode = Boolean(val); },
        configurable: true,
        enumerable: true
      },
      isBatchExtracting: {
        get() { return isBatchExtracting; },
        set(val: boolean) {
          isBatchExtracting = Boolean(val);
          if (!isBatchExtracting) {
            batchCancelActive = false;
          }
        },
        configurable: true,
        enumerable: true
      },
      batchItems: {
        get() { return [...batchItems]; },
        set(val: BatchItem[]) { batchItems = Array.isArray(val) ? [...val] : []; },
        configurable: true,
        enumerable: true
      },
      batchProcessingIndex: {
        get() { return batchProcessingIndex; },
        set(val: number) { batchProcessingIndex = Number(val); },
        configurable: true,
        enumerable: true
      },
      activeBatchViewerIndex: {
        get() { return activeBatchViewerIndex; },
        set(val: number) { activeBatchViewerIndex = Number(val); },
        configurable: true,
        enumerable: true
      },
      selectedMediaFiles: {
        get() { return [...selectedMediaFiles]; },
        set(val: string[]) {
          selectedMediaFiles = Array.isArray(val)
            ? val.map(f => (typeof f === 'string' ? f.trim() : '')).filter(f => f.length > 0)
            : [];
        },
        configurable: true,
        enumerable: true
      },
      userExplicitlySelectedBatchItem: {
        get() { return userExplicitlySelectedBatchItem; },
        set(val: boolean) { userExplicitlySelectedBatchItem = Boolean(val); },
        configurable: true,
        enumerable: true
      }
    });
  } catch {
    // Already defined or restricted
  }
}

if (typeof window !== 'undefined') {
  syncBatchProcessorWindowBindings();
}
