// Transcription Pipeline, Media Probing, Single/Batch Drag & Drop, and Whisper Task Execution
import { t, getLanguage, isolateLtr } from '../i18n/index';
import { showNotification } from './appModal';
import {
  openFileInEditor,
  getBasename,
  getParentDir,
  updateMediaCardName,
  formatLocalizedTimeDuration,
  setTranscribeStatusBadge,
  copyToClipboard
} from './nativeWindow';
import {
  settingsState,
  saveCurrentSettings,
  compiledBackends,
  localScannedTransModels
} from './settingsManager';
import { batchProcessor, addBatchFiles, formatDuration } from './batchProcessor';
import { escapeHTML, logsController } from './logsController';
import { loadTranscriptFromFile, transcriptViewer } from './transcriptViewer';
import {
  workflowBridge,
  updateTranscribeWorkflowButtons,
  updateTranscribeActionButtons,
  sendTranscribeToTranslationStudio,
  setLastTranscribedOutputDir,
  setLastTranscribedSubtitlePath,
  setLastTranscribedVideoPath,
  setLastTranscribedOutputFiles
} from './workflowBridge';
import { formatLocalizedNumber } from './translationProviders';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare global {
  interface Window {
    selectedMediaFile: string | null;
    probedMetadata: any;
    wavPathForTranscription: string | null;
    isTranscribing: boolean;
    toggleWizardAccordion: (stepNum: number) => void;
    openWizardStep: (stepNum: number) => void;
    setWizardStepCompleted: (stepNum: number, isCompleted: boolean) => void;
    clearSingleMediaFile: () => void;
    browseMediaFile: () => Promise<void>;
    renderMediaMetadata: (meta: any) => void;
    probeSelectedFile: () => Promise<void>;
    toggleTelemetryHudCollapse: () => void;
    runWhisperTranscription: () => Promise<void>;
    abortTranscription: () => Promise<void>;
    copyMainTranscriptToClipboard: () => Promise<void>;
    openOutputFolder: () => Promise<void>;
    copyTranscriptToClipboard: () => Promise<void>;
    setupTranscribeDragAndDrop: () => void;
    handleDroppedFiles: (rawFiles: string[]) => Promise<void>;
    switchView: (view: string) => void;
    listen?: (event: string, handler: (e: any) => void) => Promise<() => void>;
    __TAURI__?: any;
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

const getTauriListen = (): ((event: string, handler: (e: any) => void) => Promise<() => void>) | null => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.event && tauri.event.listen) {
    return tauri.event.listen;
  }
  return win.listen || null;
};

const listen = (event: string, handler: (e: any) => void): Promise<() => void> => {
  const lis = getTauriListen();
  if (lis) return lis(event, handler);
  return Promise.resolve(() => {});
};

// ----------------- State Variables -----------------
export let selectedMediaFile: string | null = null;
export let probedMetadata: any = null;
export let wavPathForTranscription: string | null = null;
export let isTranscribing: boolean = false;

export function getSelectedMediaFile(): string | null {
  return selectedMediaFile;
}

export function setSelectedMediaFile(path: string | null): void {
  selectedMediaFile = typeof path === 'string' && path.trim() !== '' ? path.trim() : null;
}

export function getProbedMetadata(): any {
  return probedMetadata;
}

export function setProbedMetadata(meta: any): void {
  probedMetadata = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
}

export function getWavPathForTranscription(): string | null {
  return wavPathForTranscription;
}

export function setWavPathForTranscription(path: string | null): void {
  wavPathForTranscription = typeof path === 'string' && path.trim() !== '' ? path.trim() : null;
}

export function getIsTranscribing(): boolean {
  return isTranscribing;
}

export function setIsTranscribing(val: boolean): void {
  isTranscribing = Boolean(val);
}

// ----------------- Accordion Wizard Controls -----------------
export function toggleWizardAccordion(stepNum: number): void {
  if (typeof document === 'undefined') return;
  const stepEl = document.getElementById(`wizard-step-${stepNum}`);
  if (!stepEl) return;

  const isCurrentlyActive = stepEl.classList.contains('active');

  // Collapse all steps
  for (let i = 1; i <= 3; i++) {
    const s = document.getElementById(`wizard-step-${i}`);
    if (s) {
      s.classList.remove('active');
      const chevron = document.getElementById(`wizard-chevron-${i}`);
      if (chevron) chevron.textContent = '▼';
    }
  }

  // Toggle active class
  if (!isCurrentlyActive) {
    stepEl.classList.add('active');
    const chevron = document.getElementById(`wizard-chevron-${stepNum}`);
    if (chevron) chevron.textContent = '▲';
  }
}

export function openWizardStep(stepNum: number): void {
  if (typeof document === 'undefined') return;
  for (let i = 1; i <= 3; i++) {
    const s = document.getElementById(`wizard-step-${i}`);
    if (s) {
      s.classList.remove('active');
      const chevron = document.getElementById(`wizard-chevron-${i}`);
      if (chevron) chevron.textContent = '▼';
    }
  }

  const targetStep = document.getElementById(`wizard-step-${stepNum}`);
  if (targetStep) {
    targetStep.classList.add('active');
    const chevron = document.getElementById(`wizard-chevron-${stepNum}`);
    if (chevron) chevron.textContent = '▲';
  }
}

export function setWizardStepCompleted(stepNum: number, isCompleted: boolean): void {
  if (typeof document === 'undefined') return;
  const stepEl = document.getElementById(`wizard-step-${stepNum}`);
  const iconEl = document.getElementById(`wizard-icon-${stepNum}`);
  if (!stepEl || !iconEl) return;

  if (isCompleted) {
    stepEl.classList.add('completed');
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;color:var(--color-green);"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else {
    stepEl.classList.remove('completed');
    iconEl.textContent = String(stepNum);
  }
}

// ----------------- Media File Selection & Reset -----------------
export function clearSingleMediaFile(): void {
  if (typeof document === 'undefined') return;
  setSelectedMediaFile(null);
  batchProcessor.setSelectedFiles([]);
  setWavPathForTranscription(null);
  setProbedMetadata(null);
  batchProcessor.setIsBatchMode(false);

  const dropZone = document.getElementById('transcribe-drop-zone');
  if (dropZone) dropZone.classList.remove('has-file');

  const fileNameEl = document.getElementById('lbl-file-name');
  if (fileNameEl) {
    updateMediaCardName(null);
  }
  const filePathEl = document.getElementById('lbl-file-path');
  if (filePathEl) {
    filePathEl.textContent = t('transcribe.selectFilePrompt');
    filePathEl.style.display = 'block';
    filePathEl.removeAttribute('title');
  }

  const clearBtn = document.getElementById('btn-clear-media');
  if (clearBtn) clearBtn.style.display = 'none';

  const metaBox = document.getElementById('media-meta-box');
  if (metaBox) metaBox.style.display = 'none';

  const batchSpecsBox = document.getElementById('batch-specs-box');
  if (batchSpecsBox) batchSpecsBox.style.display = 'none';

  const batchQueueContainer = document.getElementById('batch-queue-container');
  if (batchQueueContainer) batchQueueContainer.style.display = 'none';

  const batchControlsBox = document.getElementById('batch-controls-box');
  if (batchControlsBox) batchControlsBox.style.display = 'none';

  const singleActions = document.getElementById('single-transcribe-actions');
  if (singleActions) singleActions.style.display = 'flex';

  const btnRun = document.getElementById('btn-run-transcribe');
  if (btnRun) btnRun.style.display = 'inline-flex';
  const btnCancel = document.getElementById('btn-cancel-transcribe');
  if (btnCancel) btnCancel.style.display = 'none';

  const typeEl = document.getElementById('meta-type');
  if (typeEl) typeEl.textContent = '-';
  const sizeEl = document.getElementById('meta-size');
  if (sizeEl) sizeEl.textContent = '-';
  const durEl = document.getElementById('meta-duration');
  if (durEl) {
    durEl.textContent = '-';
    durEl.removeAttribute('title');
  }
  const recEl = document.getElementById('meta-recommendation');
  if (recEl) recEl.textContent = '-';

  const currentSettings = settingsState || getGlobal().settingsState;
  if (currentSettings) {
    currentSettings.inputFile = '';
    saveCurrentSettings();
  }

  const fillBar = document.getElementById('progress-linear-fill');
  if (fillBar) fillBar.style.width = '0%';
  const pctEl = document.getElementById('lbl-radial-pct');
  if (pctEl) {
    pctEl.removeAttribute('data-i18n');
    pctEl.textContent = '0%';
  }
  const msgEl = document.getElementById('lbl-radial-msg') as HTMLElement | null;
  if (msgEl) {
    msgEl.setAttribute('data-i18n', 'transcribe.standingBy');
    msgEl.textContent = t('transcribe.standingBy');
  }

  const analyticsBox = document.getElementById('analytics-box');
  if (analyticsBox) analyticsBox.style.display = 'none';

  const telemetryCard = document.getElementById('telemetry-hud-card');
  if (telemetryCard) telemetryCard.style.display = 'none';
  setTranscribeStatusBadge('', 'transcribe.standingBy');
  const badgeEl = document.getElementById('hud-status-badge');
  if (badgeEl) badgeEl.style.display = 'none';
  const metricsEl = document.getElementById('transcribe-metrics');
  if (metricsEl) metricsEl.style.display = 'none';
  const analyticTimeEl = document.getElementById('analytic-time') as HTMLElement | null;
  if (analyticTimeEl) delete (analyticTimeEl.dataset as any).elapsedSeconds;
  if (msgEl) delete (msgEl.dataset as any).statusCompleted;

  setLastTranscribedSubtitlePath(null);
  setLastTranscribedVideoPath(null);
  setLastTranscribedOutputDir(null);
  setLastTranscribedOutputFiles([]);
  transcriptViewer.lines = [];
  const win = getGlobal();
  win.transcriptLines = [];

  updateTranscribeWorkflowButtons();
  updateTranscribeActionButtons(false);

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
}

export async function browseMediaFile(): Promise<void> {
  if (batchProcessor.getIsExtracting() || getIsTranscribing()) {
    showNotification(t('toasts.batchActiveSelectBlocked'), "info");
    return;
  }
  const rawFiles = await invoke('select_files');
  const files = Array.isArray(rawFiles)
    ? Array.from(new Set(rawFiles.map(f => (typeof f === 'string' ? f.trim() : '')).filter(f => f.length > 0)))
    : [];
  if (files.length > 0) {
    if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
      await addBatchFiles(files);
      return;
    }

    batchProcessor.setSelectedFiles(files);

    if (files.length === 1) {
      batchProcessor.setIsBatchMode(false);
      setSelectedMediaFile(files[0]);

      if (typeof document !== 'undefined') {
        const dropZone = document.getElementById('transcribe-drop-zone');
        if (dropZone) dropZone.classList.add('has-file');

        // Update UI for Single-file Mode
        const fileNameEl = document.getElementById('lbl-file-name');
        const filePathEl = document.getElementById('lbl-file-path');
        if (fileNameEl) fileNameEl.style.display = 'block';
        if (filePathEl) filePathEl.style.display = 'block';
        updateMediaCardName(files[0]);
        if (filePathEl) {
          filePathEl.textContent = files[0];
          filePathEl.title = isolateLtr(files[0]);
        }

        const clearBtn = document.getElementById('btn-clear-media');
        if (clearBtn) clearBtn.style.display = 'inline-flex';

        const batchQueueContainer = document.getElementById('batch-queue-container');
        if (batchQueueContainer) batchQueueContainer.style.display = 'none';

        const metaBox = document.getElementById('media-meta-box');
        if (metaBox) metaBox.style.display = 'flex';
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
      }

      setWavPathForTranscription(null);
      updateTranscribeActionButtons(false);

      const currentSettings = settingsState || getGlobal().settingsState;
      if (currentSettings) {
        currentSettings.inputFile = files[0];
        saveCurrentSettings();
      }

      setWizardStepCompleted(1, true);
      await probeSelectedFile();
    } else {
      await addBatchFiles(files);
    }
  }
}

// ----------------- Metadata Probing & Display -----------------
export function renderMediaMetadata(meta: any): void {
  if (typeof document === 'undefined' || !meta || !meta.exists) return;

  const typeEl = document.getElementById('meta-type');
  const sizeEl = document.getElementById('meta-size');
  const durEl = document.getElementById('meta-duration');
  const recEl = document.getElementById('meta-recommendation');

  const lang = getLanguage();

  // 1. File Type (Localized with emoji)
  if (typeEl) {
    const rawFmt = meta.format || '';
    if (rawFmt.includes('Video')) {
      typeEl.textContent = `${t('transcribe.formatVideo')} 🎥`;
    } else if (rawFmt.includes('Audio')) {
      typeEl.textContent = `${t('transcribe.formatAudio')} 🎵`;
    } else if (rawFmt.includes('File')) {
      typeEl.textContent = `${t('transcribe.formatFile')} 📁`;
    } else {
      typeEl.textContent = rawFmt || '-';
    }
  }

  // 2. File Size (Properly isolated RTL/LTR numbers and localized units)
  if (sizeEl) {
    const rawSize = meta.size || '';
    const match = rawSize.match(/([\d.]+)\s*([A-Za-z]+)?/);
    if (match) {
      const num = parseFloat(match[1]);
      const unitKey = (match[2] || 'MB').toUpperCase();
      let localizedUnit = unitKey;
      if (unitKey === 'GB') localizedUnit = t('transcribe.unitGB');
      else if (unitKey === 'MB') localizedUnit = t('transcribe.unitMB');
      else if (unitKey === 'KB') localizedUnit = t('transcribe.unitKB');
      else if (unitKey === 'B') localizedUnit = t('transcribe.unitB');

      const formattedNum = formatLocalizedNumber(num, lang, 1);
      sizeEl.textContent = `${formattedNum} ${localizedUnit}`;
    } else {
      sizeEl.textContent = rawSize || '-';
    }
  }

  // 3. Duration (Human conversational localized format + digital timecode tooltip)
  if (durEl) {
    const dur = Math.round(meta.durationSec || 0);
    const hours = Math.floor(dur / 3600);
    const minutes = Math.floor((dur % 3600) / 60);
    const seconds = Math.floor(dur % 60);
    const digitalTimecode = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (dur <= 0) {
      durEl.textContent = '-';
      durEl.removeAttribute('title');
    } else {
      const hStr = formatLocalizedNumber(hours, lang, 0);
      const mStr = formatLocalizedNumber(minutes, lang, 0);
      const sStr = formatLocalizedNumber(seconds, lang, 0);

      let text = '';
      if (hours > 0) {
        if (minutes > 0 && seconds > 0) {
          text = t('transcribe.durationHoursMinutesSeconds', { hours: hStr, minutes: mStr, seconds: sStr });
        } else if (minutes > 0) {
          text = t('transcribe.durationHoursMinutes', { hours: hStr, minutes: mStr });
        } else {
          text = t('transcribe.durationHours', { hours: hStr });
        }
      } else if (minutes > 0) {
        if (seconds > 0) {
          text = t('transcribe.durationMinutesSeconds', { minutes: mStr, seconds: sStr });
        } else {
          text = t('transcribe.durationMinutes', { minutes: mStr });
        }
      } else {
        text = t('transcribe.durationSeconds', { seconds: sStr });
      }
      durEl.textContent = text;
      durEl.title = t('transcribe.timecodeTooltip', { timecode: digitalTimecode });
    }
  }

  // 4. Engine / Backend & Threads
  const currentSettings = settingsState || getGlobal().settingsState;
  if (recEl && currentSettings) {
    const backendRaw = currentSettings.selectedBackend || 'Standard';
    const backendName = backendRaw === 'Standard' ? t('transcribe.backendStandard') : backendRaw;
    const threadsVal = formatLocalizedNumber(currentSettings.threads || 4, lang, 0);
    recEl.textContent = t('transcribe.backendStatus', {
      backend: backendName,
      threads: threadsVal
    });
  }
}

export async function probeSelectedFile(): Promise<void> {
  const currentMedia = getSelectedMediaFile();
  if (!currentMedia) return;

  try {
    const meta = await invoke('probe_media_file', { filePath: currentMedia });
    setProbedMetadata(meta);

    if (meta.exists) {
      if (typeof document !== 'undefined') {
        const metaBox = document.getElementById('media-meta-box');
        if (metaBox) metaBox.style.display = 'flex';
        renderMediaMetadata(meta);

        setWizardStepCompleted(2, true);
        openWizardStep(2);

        const fillBar = document.getElementById('progress-linear-fill');
        if (fillBar) fillBar.style.width = '0%';
        const pctEl = document.getElementById('lbl-radial-pct');
        if (pctEl) {
          pctEl.removeAttribute('data-i18n');
          pctEl.textContent = '0%';
        }
        const msgEl = document.getElementById('lbl-radial-msg') as HTMLElement | null;
        if (msgEl) {
          delete (msgEl.dataset as any).batchSummarySuccess;
          delete (msgEl.dataset as any).batchSummaryTotal;
          msgEl.setAttribute('data-i18n', 'transcribe.readyForTranscription');
          msgEl.textContent = t('transcribe.readyForTranscription');
        }

        setWizardStepCompleted(3, false);
        const analyticsBox = document.getElementById('analytics-box');
        if (analyticsBox) analyticsBox.style.display = 'none';
      }
    } else {
      showNotification(t('toasts.fileNotFoundOrInvalid'), "error");
      clearSingleMediaFile();
    }
  } catch (e) {
    console.error("Probing failed:", e);
    showNotification(t('toasts.metaReadError'), "error");
    clearSingleMediaFile();
  }
}

export function toggleTelemetryHudCollapse(): void {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('telemetry-hud-card');
  const btn = document.getElementById('hud-collapse-btn');
  if (card && btn) {
    const isCollapsed = card.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', isCollapsed);
  }
}

// ----------------- Whisper Transcription Engine -----------------
export async function runWhisperTranscription(): Promise<void> {
  if (typeof document === 'undefined') return;
  const win = getGlobal();

  const btn = document.getElementById('btn-run-transcribe') as HTMLButtonElement | null;
  const btnSpan = btn?.querySelector('span');
  const cancelBtn = document.getElementById('btn-cancel-transcribe') as HTMLButtonElement | null;
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  const fillBar = document.getElementById('progress-linear-fill') as HTMLElement | null;
  const pctEl = document.getElementById('lbl-radial-pct') as HTMLElement | null;
  const msgEl = document.getElementById('lbl-radial-msg') as HTMLElement | null;
  const pulseDot = document.getElementById('hud-pulse-dot') as HTMLElement | null;

  const currentMedia = getSelectedMediaFile();
  let currentWav = getWavPathForTranscription();

  if (!currentMedia && !currentWav) {
    showNotification(t('toasts.noFileSelected'), "info");
    return;
  }

  const currentSettings = settingsState || win.settingsState;
  const backend = currentSettings?.selectedBackend || 'Standard';
  const isCompiled = compiledBackends[backend];
  if (!isCompiled) {
    showNotification(t('toasts.backendNotFound', { backend }), "error");
    if (typeof win.switchView === 'function') {
      win.switchView('settings');
    }
    return;
  }

  const modelExists = localScannedTransModels.includes(currentSettings?.modelPath);
  if (!modelExists) {
    showNotification(t('toasts.noModelFound'), "error");
    if (!localScannedTransModels || localScannedTransModels.length === 0) {
      if (typeof win.switchView === 'function') win.switchView('models');
    }
    return;
  }

  setIsTranscribing(true);
  updateTranscribeActionButtons(true);

  const analyticsBox = document.getElementById('analytics-box');
  if (analyticsBox) analyticsBox.style.display = 'none';

  const telemetryCard = document.getElementById('telemetry-hud-card');
  if (telemetryCard) telemetryCard.style.display = 'block';
  setTranscribeStatusBadge('active', 'transcribe.statusExtracting');
  const metricsEl = document.getElementById('transcribe-metrics');
  if (metricsEl) metricsEl.style.display = 'none';
  const analyticTimeEl = document.getElementById('analytic-time') as HTMLElement | null;
  if (analyticTimeEl) delete (analyticTimeEl.dataset as any).elapsedSeconds;
  if (msgEl) delete (msgEl.dataset as any).statusCompleted;

  // Clear transcript preview
  transcriptViewer.lines = [];
  win.transcriptLines = [];
  setLastTranscribedSubtitlePath(null);
  setLastTranscribedOutputFiles([]);
  updateTranscribeWorkflowButtons();

  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = `
      <div id="transcript-placeholder" class="transcript-initializing-state">
        <div class="transcript-spinner"></div>
        <div class="transcript-initializing-text" data-i18n="transcribe.aiModelInitializing">${escapeHTML(t('transcribe.aiModelInitializing'))}</div>
      </div>
    `;
  }

  try {
    // Phase 1: Auto-convert to WAV if not already done
    if (!currentWav) {
      if (btnSpan) {
        btnSpan.setAttribute('data-i18n', 'transcribe.convertingToWav');
        btnSpan.textContent = t('transcribe.convertingToWav');
      } else if (btn) {
        btn.textContent = t('transcribe.convertingToWav');
      }
      if (msgEl) {
        msgEl.setAttribute('data-i18n', 'transcribe.convertingAudio16k');
        msgEl.textContent = t('transcribe.convertingAudio16k');
      }
      if (fillBar) {
        fillBar.style.width = '50%';
        fillBar.classList.add('indeterminate');
      }
      if (pctEl) {
        pctEl.setAttribute('data-i18n', 'transcribe.convertingProgress');
        pctEl.textContent = t('transcribe.convertingProgress');
      }

      currentWav = await invoke('convert_media_file', { filePath: currentMedia });
      setWavPathForTranscription(currentWav);

      if (fillBar) fillBar.classList.remove('indeterminate');
      if (msgEl) {
        msgEl.setAttribute('data-i18n', 'transcribe.wavReadyTranscribing');
        msgEl.textContent = t('transcribe.wavReadyTranscribing');
      }
    }

    // Phase 2: Run Whisper transcription
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      if (cancelBtnSpan) {
        cancelBtnSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
        cancelBtnSpan.textContent = t('transcribe.cancelTranscription');
      }
    }
    const transcribingText = t('transcribe.statusExtracting') || 'Extracting...';
    if (btnSpan) {
      btnSpan.setAttribute('data-i18n', 'transcribe.statusExtracting');
      btnSpan.textContent = transcribingText;
    } else if (btn) {
      btn.textContent = transcribingText;
    }

    const currentProbed = getProbedMetadata();
    const result = await invoke('start_transcription_task', {
      settings: currentSettings,
      wavPath: currentWav,
      durationSec: currentProbed ? currentProbed.durationSec : 60.0
    });

    // Load final transcript from the text file
    const rawOutputDir = result.outputDir || ((currentSettings && currentSettings.outputDirMode === 'custom' && currentSettings.outputDirPath) ? currentSettings.outputDirPath : getParentDir(currentSettings?.inputFile || currentMedia));
    const outputDir = (rawOutputDir && (rawOutputDir.endsWith('/') || rawOutputDir.endsWith('\\'))) ? rawOutputDir.slice(0, -1) : rawOutputDir;
    const sep = outputDir && outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
    setLastTranscribedOutputDir(outputDir);

    const generatedOutputFiles: any[] = [];
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      result.generatedFiles.forEach((f: string) => {
        let type = 'other';
        if (f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.lrc')) {
          type = 'subtitle';
        } else if (f.endsWith('.txt')) {
          type = 'text';
        } else if (f.endsWith('.json')) {
          type = 'json';
        } else if (f.endsWith('.csv')) {
          type = 'csv';
        }
        generatedOutputFiles.push({
          path: `${outputDir}${sep}${f}`,
          name: f,
          type
        });
      });
      setLastTranscribedOutputFiles(generatedOutputFiles);

      // Fallback: If transcriptLines was not populated via live events, load from generated subtitle/text file
      if ((!transcriptViewer.lines || transcriptViewer.lines.length === 0) && result.generatedFiles && result.generatedFiles.length > 0) {
        const subFile = result.generatedFiles.find((f: string) => f.endsWith('.srt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.vtt')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.lrc')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.json')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.csv')) ||
                        result.generatedFiles.find((f: string) => f.endsWith('.txt'));
        if (subFile) {
          await loadTranscriptFromFile(`${outputDir}${sep}${subFile}`);
        }
      }
    }

    const elapsedVal = result.durationMs ? (result.durationMs / 1000) : 0;
    const speedFactor = (result.speedFactor || 0).toFixed(1);
    const analyticTimeEl = document.getElementById('analytic-time') as HTMLElement | null;
    const analyticSpeedEl = document.getElementById('analytic-speed') as HTMLElement | null;
    if (analyticTimeEl) {
      (analyticTimeEl.dataset as any).elapsedSeconds = String(elapsedVal);
      analyticTimeEl.textContent = formatLocalizedTimeDuration(elapsedVal);
    }
    if (analyticSpeedEl) {
      (analyticSpeedEl.dataset as any).speedFactor = speedFactor;
      analyticSpeedEl.textContent = `${speedFactor}x`;
    }

    // Mark Step 3 as completed and notify user immediately when transcription succeeds
    setWizardStepCompleted(3, true);
    showNotification(t('toasts.transcriptionComplete', { time: formatDuration(elapsedVal) }), "success");

    setTranscribeStatusBadge('complete', 'transcribe.statusComplete');
    if (metricsEl) metricsEl.style.display = 'inline-flex';

    if (msgEl) {
      delete (msgEl.dataset as any).batchSummarySuccess;
      delete (msgEl.dataset as any).batchSummaryTotal;
      (msgEl.dataset as any).statusCompleted = 'true';
      msgEl.setAttribute('data-i18n', 'transcribe.progressComplete');
      msgEl.textContent = t('transcribe.progressComplete');
    }

    // Find generated subtitle file (.srt, .vtt, or .lrc) and update workflow bridging
    const subFile = result.generatedFiles?.find((f: string) => f.endsWith('.srt')) ||
                    result.generatedFiles?.find((f: string) => f.endsWith('.vtt')) ||
                    result.generatedFiles?.find((f: string) => f.endsWith('.lrc'));
    if (subFile) {
      setLastTranscribedSubtitlePath(`${outputDir}${sep}${subFile}`);
    }
    setLastTranscribedVideoPath(currentMedia || (currentSettings ? currentSettings.inputFile : null));
    updateTranscribeWorkflowButtons();

    // Auto-Transfer to Translation Studio if enabled
    const autoTransferEnabled = Boolean(currentSettings?.autoTransferToTranslate ?? currentSettings?.translateAiEnabled);
    if (autoTransferEnabled && workflowBridge.getLastTranscribedSubtitlePath()) {
      await sendTranscribeToTranslationStudio();
    }
  } catch (e: any) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    setWizardStepCompleted(3, false);
    const isCancelled = errMsg.toLowerCase().includes('cancelled by the user') || errMsg.toLowerCase().includes('was cancelled by the user') || errMsg.toLowerCase().includes('aborted');
    if (isCancelled) {
      if (telemetryCard) telemetryCard.style.display = 'none';
      if (fillBar) fillBar.style.width = '0%';
      if (pctEl) pctEl.textContent = '0%';
      if (metricsEl) metricsEl.style.display = 'none';
      setTranscribeStatusBadge('', 'transcribe.standingBy');
      showNotification(t('toasts.transcriptionCancelled'), "info");
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
    } else {
      showNotification(t('toasts.transcriptionError', { error: errMsg }), "error");
      setTranscribeStatusBadge('cancelled', 'transcribe.statusFailed');
      if (msgEl) {
        delete (msgEl.dataset as any).batchSummarySuccess;
        delete (msgEl.dataset as any).batchSummaryTotal;
        delete (msgEl.dataset as any).statusCompleted;
        msgEl.setAttribute('data-i18n', 'transcribe.taskFailed');
        msgEl.textContent = t('transcribe.taskFailed');
      }
    }
  } finally {
    setIsTranscribing(false);
    setWavPathForTranscription(null);
    updateTranscribeActionButtons(false);
    if (fillBar) fillBar.classList.remove('indeterminate');
    if (pulseDot) pulseDot.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) {
        cancelBtnSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
        cancelBtnSpan.textContent = t('transcribe.cancelTranscription');
      } else {
        cancelBtn.textContent = t('transcribe.cancelTranscription');
      }
      cancelBtn.style.display = 'none';
    }
  }
}

export async function abortTranscription(): Promise<void> {
  const cancelBtn = document.getElementById('btn-cancel-transcribe') as HTMLButtonElement | null;
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelling'); else cancelBtn.textContent = t('transcribe.cancelling');
  }

  try {
    await invoke('cancel_transcription');
    const telemetryCard = document.getElementById('telemetry-hud-card');
    if (telemetryCard) telemetryCard.style.display = 'none';
    const metricsEl = document.getElementById('transcribe-metrics');
    if (metricsEl) metricsEl.style.display = 'none';
    setTranscribeStatusBadge('', 'transcribe.standingBy');
  } catch (e: any) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    if (!errMsg.includes("No active transcription or translation session")) {
      showNotification(t('toasts.cancelProcessError', { error: errMsg }), "error");
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelTranscription'); else cancelBtn.textContent = t('transcribe.cancelTranscription');
    }
  }
}

export async function copyMainTranscriptToClipboard(): Promise<void> {
  const copyBtn = document.getElementById('btn-copy-main-transcript') as any;

  const triggerFeedback = () => {
    if (copyBtn) {
      if (!copyBtn._origHtml) {
        copyBtn._origHtml = copyBtn.innerHTML;
      }
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-inline-end:5px; color:#4ade80;"><polyline points="20 6 9 17 4 12"/></svg>
        ${t('transcribe.copied')}
      `;
      clearTimeout(copyBtn._copyFeedbackTimer);
      copyBtn._copyFeedbackTimer = setTimeout(() => {
        if (copyBtn && copyBtn._origHtml) {
          copyBtn.innerHTML = copyBtn._origHtml;
          copyBtn._origHtml = null;
        }
      }, 2000);
    }
  };

  const currentMedia = getSelectedMediaFile();
  if (!currentMedia) {
    showNotification(t('toasts.noMediaOrTranscribe'), "info");
    return;
  }

  const base = currentMedia.substring(0, currentMedia.lastIndexOf('.')) || currentMedia;
  const txtFile = `${base}.txt`;

  try {
    const content = await invoke('read_text_file_content', { filePath: txtFile });
    await copyToClipboard(content);
    triggerFeedback();
    showNotification(t('toasts.fileCopied'), "success");
  } catch (e) {
    // Fallback: copy Whisper logs
    const fallback = logsController.allLogs
      .filter((l: any) => l.category === 'Whisper')
      .map((l: any) => l.message)
      .join('\n');
    if (fallback) {
      try {
        await copyToClipboard(fallback);
        triggerFeedback();
        showNotification(t('toasts.transcriptNotFoundFallback'), "info");
      } catch (e2: any) {
        const msg = (e2 && (e2.message || e2.toString())) || String(e2);
        showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
      }
    } else {
      const msg = (e && ((e as any).message || (e as any).toString())) || String(e);
      showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
    }
  }
}

export async function openOutputFolder(): Promise<void> {
  const currentMedia = getSelectedMediaFile();
  const currentSettings = settingsState || getGlobal().settingsState;
  const dir = workflowBridge.getLastTranscribedOutputDir() || (currentSettings && currentSettings.inputFile ? getParentDir(currentSettings.inputFile) : (currentMedia ? getParentDir(currentMedia) : null));
  if (dir) {
    try {
      await openFileInEditor(dir);
    } catch (e: any) {
      const msg = (e && (e.message || e.toString())) || String(e);
      showNotification(t('toasts.openFolderError', { error: msg }), "error");
    }
  } else {
    showNotification(t('toasts.noOutputDirFound'), "info");
  }
}

export async function copyTranscriptToClipboard(): Promise<void> {
  await copyMainTranscriptToClipboard();
}

// ----------------- Drag & Drop Event Listeners -----------------
export function setupTranscribeDragAndDrop(): void {
  if (typeof document === 'undefined') return;
  const transZone = document.getElementById('transcribe-drop-zone');
  if (!transZone) return;

  transZone.addEventListener('click', (e: any) => {
    if (getSelectedMediaFile() || (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0)) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    browseMediaFile();
  });

  // HTML5 Standard drag-drop events
  transZone.addEventListener('dragover', (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.add('drag-over');
  });

  transZone.addEventListener('dragleave', (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.remove('drag-over');
  });

  transZone.addEventListener('drop', async (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.remove('drag-over');

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).map((f: any) => f.path || f.name);
      await handleDroppedFiles(files);
    }
  });

  // Native Tauri drag-drop events
  const win = getGlobal();
  if (win.__TAURI__) {
    try {
      let _lastDragOverTime = 0;
      listen('tauri://drag-over', (event: any) => {
        const now = performance.now();
        if (now - _lastDragOverTime < 35) return;
        _lastDragOverTime = now;

        const ratio = win.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;

        const rect = transZone.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          transZone.classList.add('drag-over');
        } else {
          transZone.classList.remove('drag-over');
        }
      });

      listen('tauri://drag-leave', () => {
        transZone.classList.remove('drag-over');
      });

      listen('tauri://drag-drop', async (event: any) => {
        transZone.classList.remove('drag-over');

        const ratio = win.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;

        const rect = transZone.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const files = event.payload.paths;
          if (files && files.length > 0) {
            await handleDroppedFiles(files);
          }
        }
      });
    } catch (err) {
      console.error("Failed to setup native Tauri drag-drop listeners:", err);
    }
  }
}

export async function handleDroppedFiles(rawFiles: string[]): Promise<void> {
  if (batchProcessor.getIsExtracting() || getIsTranscribing()) {
    showNotification(t('toasts.batchActiveDropBlocked'), "info");
    return;
  }

  const files = Array.isArray(rawFiles)
    ? Array.from(new Set(rawFiles.map(f => (typeof f === 'string' ? f.trim() : '')).filter(f => f.length > 0)))
    : [];
  if (files.length === 0) return;

  const win = getGlobal();
  if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
    await addBatchFiles(files);
    if (typeof win.switchView === 'function') {
      win.switchView('transcribe');
    }
    return;
  }

  batchProcessor.setSelectedFiles(files);

  if (files.length === 1) {
    batchProcessor.setIsBatchMode(false);
    setSelectedMediaFile(files[0]);

    if (typeof document !== 'undefined') {
      const dropZone = document.getElementById('transcribe-drop-zone');
      if (dropZone) dropZone.classList.add('has-file');

      const fileNameEl = document.getElementById('lbl-file-name');
      const filePathEl = document.getElementById('lbl-file-path');
      if (fileNameEl) fileNameEl.style.display = 'block';
      if (filePathEl) filePathEl.style.display = 'block';
      updateMediaCardName(files[0]);
      if (filePathEl) {
        filePathEl.textContent = files[0];
        filePathEl.title = isolateLtr(files[0]);
      }

      const clearBtn = document.getElementById('btn-clear-media');
      if (clearBtn) clearBtn.style.display = 'inline-flex';

      const batchQueueContainer = document.getElementById('batch-queue-container');
      if (batchQueueContainer) batchQueueContainer.style.display = 'none';

      const metaBox = document.getElementById('media-meta-box');
      if (metaBox) metaBox.style.display = 'flex';
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
    }

    setWavPathForTranscription(null);
    updateTranscribeActionButtons(false);

    const currentSettings = settingsState || win.settingsState;
    if (currentSettings) {
      currentSettings.inputFile = files[0];
      saveCurrentSettings();
    }

    setWizardStepCompleted(1, true);
    await probeSelectedFile();
  } else {
    await addBatchFiles(files);
    setTimeout(() => {
      openWizardStep(2);
    }, 500);
  }

  if (typeof win.switchView === 'function') {
    win.switchView('transcribe');
  }
  showNotification(t('toasts.filesLoaded', { count: files.length }), "success");
}

// ----------------- Window Global Bindings -----------------
export function syncTranscribePipelineWindowBindings(): void {
  const win = getGlobal();
  if (!win) return;

  try {
    Object.defineProperties(win, {
      selectedMediaFile: {
        get() { return selectedMediaFile; },
        set(val: string | null) { setSelectedMediaFile(val); },
        configurable: true
      },
      probedMetadata: {
        get() { return probedMetadata; },
        set(val: any) { setProbedMetadata(val); },
        configurable: true
      },
      wavPathForTranscription: {
        get() { return wavPathForTranscription; },
        set(val: string | null) { setWavPathForTranscription(val); },
        configurable: true
      },
      isTranscribing: {
        get() { return isTranscribing; },
        set(val: boolean) { setIsTranscribing(val); },
        configurable: true
      }
    });
  } catch {
    win.selectedMediaFile = selectedMediaFile;
    win.probedMetadata = probedMetadata;
    win.wavPathForTranscription = wavPathForTranscription;
    win.isTranscribing = isTranscribing;
  }
  win.toggleWizardAccordion = toggleWizardAccordion;
  win.openWizardStep = openWizardStep;
  win.setWizardStepCompleted = setWizardStepCompleted;
  win.clearSingleMediaFile = clearSingleMediaFile;
  win.browseMediaFile = browseMediaFile;
  win.renderMediaMetadata = renderMediaMetadata;
  win.probeSelectedFile = probeSelectedFile;
  win.toggleTelemetryHudCollapse = toggleTelemetryHudCollapse;
  win.runWhisperTranscription = runWhisperTranscription;
  win.abortTranscription = abortTranscription;
  win.copyMainTranscriptToClipboard = copyMainTranscriptToClipboard;
  win.openOutputFolder = openOutputFolder;
  win.copyTranscriptToClipboard = copyTranscriptToClipboard;
  win.setupTranscribeDragAndDrop = setupTranscribeDragAndDrop;
  win.handleDroppedFiles = handleDroppedFiles;
}

if (typeof window !== 'undefined') {
  syncTranscribePipelineWindowBindings();
}

export const transcribePipeline = {
  getSelectedMediaFile,
  setSelectedMediaFile,
  getProbedMetadata,
  setProbedMetadata,
  getWavPathForTranscription,
  setWavPathForTranscription,
  getIsTranscribing,
  setIsTranscribing,
  toggleWizardAccordion,
  openWizardStep,
  setWizardStepCompleted,
  clearSingleMediaFile,
  browseMediaFile,
  renderMediaMetadata,
  probeSelectedFile,
  toggleTelemetryHudCollapse,
  runWhisperTranscription,
  abortTranscription,
  copyMainTranscriptToClipboard,
  openOutputFolder,
  copyTranscriptToClipboard,
  setupTranscribeDragAndDrop,
  handleDroppedFiles,
  syncWindowBindings: syncTranscribePipelineWindowBindings
};

export default transcribePipeline;
