// Workflow Bridge, Output Files Management, and Studio Bridging (Transcribe -> Translation & Hardsub)
import { t, isolateLtr } from '../i18n/index';
import { showNotification } from './appModal';
import { openFileInEditor, getBasename, formatFileNameMiddleTruncate } from './nativeWindow';
import { escapeHTML } from './logsController';
import { batchProcessor } from './batchProcessor';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare global {
  interface Window {
    lastTranscribedVideoPath: string | null;
    lastTranscribedSubtitlePath: string | null;
    lastTranscribedOutputDir: string | null;
    lastTranscribedOutputFiles: any[];
    handleOutputFileButtonClick: (event?: any) => void;
    toggleOutputFilesDropdown: (forceClose?: boolean) => void;
    renderOutputFilesDropdown: () => void;
    updateTranscribeWorkflowButtons: () => void;
    updateTranscribeActionButtons: (running?: boolean) => void;
    sendTranscribeToTranslationStudio: () => Promise<void>;
    sendTranscribeToHardsubStudio: () => void;
    selectedMediaFile: string | null;
    wavPathForTranscription: string | null;
    transcriptLines: any[];
    isTranscribing: boolean;
    switchView: (view: string) => void;
    translationStudioController?: any;
    hardsubController?: any;
    formatFileNameMiddleTruncate: (filename: string, maxLength?: number) => string;
    openFileInEditor: (filePath: string) => Promise<void>;
  }
}

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

// ----------------- State Variables -----------------
export let lastTranscribedSubtitlePath: string | null = null;
export let lastTranscribedVideoPath: string | null = null;
export let lastTranscribedOutputDir: string | null = null;
export let lastTranscribedOutputFiles: any[] = [];

export function getLastTranscribedSubtitlePath(): string | null {
  const win = getGlobal();
  if (win && 'lastTranscribedSubtitlePath' in win && win.lastTranscribedSubtitlePath !== undefined) {
    return win.lastTranscribedSubtitlePath;
  }
  return lastTranscribedSubtitlePath;
}

export function setLastTranscribedSubtitlePath(path: string | null): void {
  lastTranscribedSubtitlePath = path;
  const win = getGlobal();
  if (win) {
    win.lastTranscribedSubtitlePath = path;
  }
}

export function getLastTranscribedVideoPath(): string | null {
  const win = getGlobal();
  if (win && 'lastTranscribedVideoPath' in win && win.lastTranscribedVideoPath !== undefined) {
    return win.lastTranscribedVideoPath;
  }
  return lastTranscribedVideoPath;
}

export function setLastTranscribedVideoPath(path: string | null): void {
  lastTranscribedVideoPath = path;
  const win = getGlobal();
  if (win) {
    win.lastTranscribedVideoPath = path;
  }
}

export function getLastTranscribedOutputDir(): string | null {
  const win = getGlobal();
  if (win && 'lastTranscribedOutputDir' in win && win.lastTranscribedOutputDir !== undefined) {
    return win.lastTranscribedOutputDir;
  }
  return lastTranscribedOutputDir;
}

export function setLastTranscribedOutputDir(dir: string | null): void {
  lastTranscribedOutputDir = dir;
  const win = getGlobal();
  if (win) {
    win.lastTranscribedOutputDir = dir;
  }
}

export function getLastTranscribedOutputFiles(): any[] {
  const win = getGlobal();
  if (win && 'lastTranscribedOutputFiles' in win && Array.isArray(win.lastTranscribedOutputFiles)) {
    return win.lastTranscribedOutputFiles;
  }
  return lastTranscribedOutputFiles;
}

export function setLastTranscribedOutputFiles(files: any[]): void {
  lastTranscribedOutputFiles = Array.isArray(files) ? files : [];
  const win = getGlobal();
  if (win) {
    win.lastTranscribedOutputFiles = lastTranscribedOutputFiles;
  }
}

// ----------------- Output Files Dropdown & Actions -----------------
export function handleOutputFileButtonClick(event?: any): void {
  event?.stopPropagation?.();
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-open-output-file') as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;

  const files = getLastTranscribedOutputFiles();
  if (files.length <= 1) {
    const targetPath = files.length === 1 ? files[0].path : getLastTranscribedSubtitlePath();
    if (targetPath) {
      openFileInEditor(targetPath).catch((e: any) => {
        const msg = (e && (e.message || e.toString())) || String(e);
        showNotification(t('toasts.openFileError', { error: msg }) || msg, "error");
      });
    }
  } else {
    toggleOutputFilesDropdown();
  }
}

export function toggleOutputFilesDropdown(forceClose = false): void {
  if (typeof document === 'undefined') return;
  const dropdown = document.getElementById('transcribe-output-files-dropdown');
  if (!dropdown) return;
  const isCurrentlyOpen = dropdown.style.display !== 'none';
  if (forceClose || isCurrentlyOpen) {
    dropdown.style.display = 'none';
    return;
  }
  renderOutputFilesDropdown();
  dropdown.style.display = 'flex';
}

export function renderOutputFilesDropdown(): void {
  if (typeof document === 'undefined') return;
  const dropdown = document.getElementById('transcribe-output-files-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';

  const files = getLastTranscribedOutputFiles();
  files.forEach(file => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'transcribe-output-file-item';
    const displayName = formatFileNameMiddleTruncate ? formatFileNameMiddleTruncate(file.name, 24) : file.name;

    let badgeText = '';
    let badgeClass = 'file-badge';
    if (file.type === 'translated') {
      badgeText = t('transcribe.translatedSubtitle') || 'Translated';
      badgeClass += ' translated';
    } else if (file.type === 'original' || file.type === 'subtitle') {
      badgeText = t('transcribe.originalSubtitle') || 'Subtitle';
    } else if (file.type === 'text') {
      badgeText = t('transcribe.rawTranscriptText') || 'Text';
    } else if (file.type === 'json') {
      badgeText = 'JSON';
    } else if (file.type === 'csv') {
      badgeText = 'CSV';
    }

    item.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="file-name" title="${escapeHTML(file.path)}">${escapeHTML(displayName)}</span>
      ${badgeText ? `<span class="${badgeClass}">${escapeHTML(badgeText)}</span>` : ''}
    `;

    item.onclick = (e) => {
      e.stopPropagation();
      toggleOutputFilesDropdown(true);
      openFileInEditor(file.path).catch((err: any) => {
        const msg = (err && (err.message || err.toString())) || String(err);
        showNotification(t('toasts.openFileError', { error: msg }) || msg, "error");
      });
    };

    dropdown.appendChild(item);
  });
}

// ----------------- Transcribe Workflow Buttons State -----------------
export function updateTranscribeWorkflowButtons(): void {
  if (typeof document === 'undefined') return;
  const btnOpenFolder = document.getElementById('btn-open-output-folder') as HTMLButtonElement | null;
  const btnOpenFile = document.getElementById('btn-open-output-file') as HTMLButtonElement | null;
  const chevronOpenFile = document.getElementById('chevron-open-output-file');
  const btnSendTranslate = document.getElementById('btn-send-to-translation') as HTMLButtonElement | null;
  const btnSendHardsub = document.getElementById('btn-transcribe-send-to-hardsub') as HTMLButtonElement | null;
  const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;

  const win = getGlobal();
  const hasOutputDir = Boolean(getLastTranscribedOutputDir());
  const subtitlePath = getLastTranscribedSubtitlePath();
  const hasSubtitle = Boolean(subtitlePath);
  const outputFiles = getLastTranscribedOutputFiles();
  const hasFiles = outputFiles.length > 0 || hasSubtitle;
  const transcriptLines = win.transcriptLines || [];
  const hasTranscript = Boolean((Array.isArray(transcriptLines) && transcriptLines.length > 0) || hasSubtitle);

  if (btnCopy) {
    btnCopy.disabled = !hasTranscript;
  }

  if (btnOpenFile) {
    btnOpenFile.disabled = !hasFiles;
    if (outputFiles.length > 1) {
      if (chevronOpenFile) chevronOpenFile.style.display = 'inline-block';
      btnOpenFile.title = t('transcribe.openFile');
      btnOpenFile.removeAttribute('data-i18n-title');
    } else if (hasFiles) {
      if (chevronOpenFile) chevronOpenFile.style.display = 'none';
      const singleName = outputFiles.length === 1 ? outputFiles[0].name : (subtitlePath ? getBasename(subtitlePath) : '');
      btnOpenFile.title = singleName ? `${t('transcribe.openFile')}: ${singleName}` : t('transcribe.openFile');
      btnOpenFile.removeAttribute('data-i18n-title');
    } else {
      if (chevronOpenFile) chevronOpenFile.style.display = 'none';
      btnOpenFile.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnOpenFile.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }

  if (btnOpenFolder) {
    btnOpenFolder.disabled = !hasOutputDir;
    const outputDir = getLastTranscribedOutputDir();
    if (hasOutputDir && outputDir) {
      btnOpenFolder.title = isolateLtr(outputDir);
      btnOpenFolder.removeAttribute('data-i18n-title');
    } else {
      btnOpenFolder.setAttribute('title', t('transcribe.noOutputDirYet') || 'No output folder available yet');
      btnOpenFolder.setAttribute('data-i18n-title', 'transcribe.noOutputDirYet');
    }
  }

  if (btnSendTranslate) {
    btnSendTranslate.disabled = !hasSubtitle;
    if (hasSubtitle) {
      btnSendTranslate.removeAttribute('title');
      btnSendTranslate.removeAttribute('data-i18n-title');
    } else {
      btnSendTranslate.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnSendTranslate.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }

  if (btnSendHardsub) {
    btnSendHardsub.disabled = !hasSubtitle;
    if (hasSubtitle) {
      btnSendHardsub.removeAttribute('title');
      btnSendHardsub.removeAttribute('data-i18n-title');
    } else {
      btnSendHardsub.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnSendHardsub.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }
}

// ----------------- Transcribe & Batch Action Buttons State -----------------
export function updateTranscribeActionButtons(isTranscribingParam?: boolean): void {
  if (typeof document === 'undefined') return;
  const win = getGlobal();

  if (typeof isTranscribingParam === 'boolean') {
    win.isTranscribing = isTranscribingParam;
    if (!isTranscribingParam) {
      batchProcessor.setIsExtracting(false);
    } else if (batchProcessor.getIsBatchMode()) {
      batchProcessor.setIsExtracting(true);
    }
  }

  const isTranscribing = Boolean(win.isTranscribing);
  const btnRun = document.getElementById('btn-run-transcribe') as HTMLButtonElement | null;
  const btnBatch = document.getElementById('btn-run-batch') as HTMLButtonElement | null;
  const btnRunSpan = btnRun?.querySelector('span');
  const btnBatchSpan = btnBatch?.querySelector('span');
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const cancelBatchBtn = document.getElementById('btn-cancel-batch');

  const hasSingleMedia = Boolean(win.selectedMediaFile || win.wavPathForTranscription);
  const hasBatchMedia = Array.isArray(batchProcessor.getItems()) && batchProcessor.getItems().length > 0;
  const isBatchExtracting = batchProcessor.getIsExtracting();

  if (btnRun) {
    const canRun = !isTranscribing && hasSingleMedia;
    btnRun.disabled = !canRun;
    if (isTranscribing) {
      const transcribingText = t('transcribe.transcribingWithAi') || t('transcribe.statusExtracting');
      btnRun.title = transcribingText;
      btnRun.setAttribute('data-i18n-title', 'transcribe.transcribingWithAi');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.transcribingWithAi');
        btnRunSpan.textContent = transcribingText;
      }
    } else if (!hasSingleMedia) {
      btnRun.title = t('toasts.noFileSelected');
      btnRun.setAttribute('data-i18n-title', 'toasts.noFileSelected');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.startAiExtraction');
        btnRunSpan.textContent = t('transcribe.startAiExtraction');
      }
    } else {
      btnRun.title = t('transcribe.startAiExtraction');
      btnRun.setAttribute('data-i18n-title', 'transcribe.startAiExtraction');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.startAiExtraction');
        btnRunSpan.textContent = t('transcribe.startAiExtraction');
      }
    }
  }

  if (btnBatch) {
    const canRunBatch = !isBatchExtracting && hasBatchMedia;
    btnBatch.disabled = !canRunBatch;
    if (isBatchExtracting) {
      const batchRunningText = t('transcribe.transcribingWithAi') || t('transcribe.batchRunning');
      btnBatch.title = batchRunningText;
      btnBatch.setAttribute('data-i18n-title', 'transcribe.transcribingWithAi');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.transcribingWithAi');
        btnBatchSpan.textContent = batchRunningText;
      }
    } else if (!hasBatchMedia) {
      btnBatch.title = t('toasts.noFileSelected');
      btnBatch.setAttribute('data-i18n-title', 'toasts.noFileSelected');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.startBatchAiExtraction');
        btnBatchSpan.textContent = t('transcribe.startBatchAiExtraction');
      }
    } else {
      btnBatch.title = t('transcribe.startBatchAiExtraction');
      btnBatch.setAttribute('data-i18n-title', 'transcribe.startBatchAiExtraction');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.startBatchAiExtraction');
        btnBatchSpan.textContent = t('transcribe.startBatchAiExtraction');
      }
    }
  }

  if (cancelBtn) {
    const cancelSpan = cancelBtn.querySelector('span');
    if (cancelSpan) {
      cancelSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
      cancelSpan.textContent = t('transcribe.cancelTranscription');
    }
  }
  if (cancelBatchBtn) {
    const cancelBatchSpan = cancelBatchBtn.querySelector('span');
    if (cancelBatchSpan) {
      cancelBatchSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
      cancelBatchSpan.textContent = t('transcribe.cancelTranscription');
    }
  }
}

// ----------------- Studio Bridging (Translation & Hardsub) -----------------
export async function sendTranscribeToTranslationStudio(): Promise<void> {
  const subToLoad = getLastTranscribedSubtitlePath();
  if (!subToLoad) {
    showNotification(t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet', 'error');
    return;
  }

  const win = getGlobal();
  const controller = win.translationStudioController;
  if (controller && typeof controller.loadSubtitleFile === 'function') {
    await controller.loadSubtitleFile(subToLoad);
    const videoToLoad = getLastTranscribedVideoPath();
    if (videoToLoad && typeof controller.setCompanionVideo === 'function') {
      const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.webm'].some(ext => videoToLoad.toLowerCase().endsWith(ext));
      if (isVideo) {
        controller.setCompanionVideo(videoToLoad);
      }
    }
  }

  if (typeof win.switchView === 'function') {
    win.switchView('translate');
  }
  showNotification(t('transcribe.sendToTranslationDesc') || 'Generated subtitle loaded into Translation Studio.', 'info');
}

export function sendTranscribeToHardsubStudio(): void {
  const subToLoad = getLastTranscribedSubtitlePath();
  if (!subToLoad) {
    showNotification(t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet', 'error');
    return;
  }

  const win = getGlobal();
  let videoToLoad = getLastTranscribedVideoPath() || '';
  if (videoToLoad) {
    const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.webm'].some(ext => videoToLoad.toLowerCase().endsWith(ext));
    if (!isVideo) videoToLoad = '';
  }

  const controller = win.hardsubController;
  if (controller && typeof controller.prefillFilePaths === 'function') {
    controller.prefillFilePaths(videoToLoad, subToLoad);
  }

  if (typeof win.switchView === 'function') {
    win.switchView('hardsub');
  }
  showNotification(t('transcribe.sendToHardsubDesc') || t('translate.sendToHardsubDesc') || 'Loaded into Hardsub Studio', 'info');
}

// ----------------- Document Click Outside Listener -----------------
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', (e) => {
    const group = document.getElementById('transcribe-output-file-group');
    if (group && !group.contains(e.target as Node)) {
      toggleOutputFilesDropdown(true);
    }
  });
}

// ----------------- Window Global Bindings -----------------
if (typeof window !== 'undefined') {
  try {
    Object.defineProperties(window, {
      lastTranscribedSubtitlePath: {
        get() { return lastTranscribedSubtitlePath; },
        set(val: string | null) { lastTranscribedSubtitlePath = val; },
        configurable: true
      },
      lastTranscribedVideoPath: {
        get() { return lastTranscribedVideoPath; },
        set(val: string | null) { lastTranscribedVideoPath = val; },
        configurable: true
      },
      lastTranscribedOutputDir: {
        get() { return lastTranscribedOutputDir; },
        set(val: string | null) { lastTranscribedOutputDir = val; },
        configurable: true
      },
      lastTranscribedOutputFiles: {
        get() { return lastTranscribedOutputFiles; },
        set(val: any[]) { lastTranscribedOutputFiles = Array.isArray(val) ? val : []; },
        configurable: true
      }
    });
  } catch {
    window.lastTranscribedSubtitlePath = lastTranscribedSubtitlePath;
    window.lastTranscribedVideoPath = lastTranscribedVideoPath;
    window.lastTranscribedOutputDir = lastTranscribedOutputDir;
    window.lastTranscribedOutputFiles = lastTranscribedOutputFiles;
  }
  window.handleOutputFileButtonClick = handleOutputFileButtonClick;
  window.toggleOutputFilesDropdown = toggleOutputFilesDropdown;
  window.renderOutputFilesDropdown = renderOutputFilesDropdown;
  window.updateTranscribeWorkflowButtons = updateTranscribeWorkflowButtons;
  window.updateTranscribeActionButtons = updateTranscribeActionButtons;
  window.sendTranscribeToTranslationStudio = sendTranscribeToTranslationStudio;
  window.sendTranscribeToHardsubStudio = sendTranscribeToHardsubStudio;
}

export const workflowBridge = {
  getLastTranscribedSubtitlePath,
  setLastTranscribedSubtitlePath,
  getLastTranscribedVideoPath,
  setLastTranscribedVideoPath,
  getLastTranscribedOutputDir,
  setLastTranscribedOutputDir,
  getLastTranscribedOutputFiles,
  setLastTranscribedOutputFiles,
  handleOutputFileButtonClick,
  toggleOutputFilesDropdown,
  renderOutputFilesDropdown,
  updateTranscribeWorkflowButtons,
  updateTranscribeActionButtons,
  sendTranscribeToTranslationStudio,
  sendTranscribeToHardsubStudio
};

export default workflowBridge;
