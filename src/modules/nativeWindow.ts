// Native OS Controls, Titlebar Management, Taskbar Progress, Clipboard, and File Helpers
import { t, applyContentDirection, clearContentDirection } from '../i18n/index';
import { showNotification, showConfirmModal } from './appModal';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare global {
  interface Window {
    getBasename: (path: string) => string;
    getParentDir: (path: string) => string;
    splitFileNameAndExt: (filename: string) => { base: string; ext: string };
    formatFileNameMiddleTruncate: (filename: string, maxLength?: number) => string;
    updateMediaCardName: (path: string | null) => void;
    formatLocalizedTimeDuration: (secondsVal: any) => string;
    setTranscribeStatusBadge: (statusClass: string, text: string) => void;
    copyToClipboard: (text: any) => Promise<void>;
    openFileInEditor: (filePath: string) => Promise<void>;
    isTranscriptionRunning: boolean;
    isTranslationRunning: boolean;
    isHardsubRunning: boolean;
    isDownloadingModelRunning: boolean;
    hasActiveBackgroundJob: () => boolean;
    updateTaskbarProgress: (progressFraction: number, active: boolean, statusType?: string) => void;
    setupTitlebar: () => void;
    settingsState: any;
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

// ----------------- Path & File Name Helpers -----------------
export function getBasename(path: string): string {
  if (!path) return '';
  return path.replace(/\\/g, '/').split('/').pop() || '';
}

export function getParentDir(path: string): string {
  if (!path) return '';
  const clean = path.trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return lastSlash >= 0 ? clean.substring(0, lastSlash) : '';
}

export function splitFileNameAndExt(filename: string): { base: string; ext: string } {
  if (!filename) return { base: '', ext: '' };
  const match = filename.match(/^(.+?)(\.[a-zA-Z]{2,5}\.[a-zA-Z0-9]{2,4}|\.[a-zA-Z0-9]{2,5})$/);
  if (match) {
    return { base: match[1], ext: match[2] };
  }
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) {
    return { base: filename.substring(0, lastDot), ext: filename.substring(lastDot) };
  }
  return { base: filename, ext: '' };
}

export function formatFileNameMiddleTruncate(filename: string, maxLength = 26): string {
  if (!filename || typeof filename !== 'string') return '';
  if (filename.length <= maxLength) return filename;

  const { base, ext } = splitFileNameAndExt(filename);
  
  if (ext && ext.length > 0 && ext.length <= 10) {
    const availableForBase = maxLength - ext.length - 1; // 1 char for ellipsis '…'
    if (availableForBase >= 4 && base.length > availableForBase) {
      const frontChars = Math.ceil(availableForBase * 0.6);
      const backChars = availableForBase - frontChars;
      return `${base.slice(0, frontChars)}…${base.slice(base.length - backChars)}${ext}`;
    }
  }

  const available = maxLength - 1;
  const frontChars = Math.ceil(available / 2);
  const backChars = available - frontChars;
  return `${filename.slice(0, frontChars)}…${filename.slice(filename.length - backChars)}`;
}

export function updateMediaCardName(path: string | null): void {
  if (typeof document === 'undefined') return;

  const nameEl = document.getElementById('lbl-file-name');
  if (!nameEl) return;
  if (path) {
    const name = getBasename(path);
    nameEl.textContent = name;
    applyContentDirection(nameEl, name);
  } else {
    nameEl.textContent = t('transcribe.noFileLoaded');
    clearContentDirection(nameEl);
  }
}

// ----------------- Time Duration & Transcribe Status Badge -----------------
export function formatLocalizedTimeDuration(secondsVal: any): string {
  if (secondsVal === undefined || secondsVal === null || isNaN(secondsVal)) return '';
  const num = typeof secondsVal === 'number' ? secondsVal : parseFloat(secondsVal);
  if (isNaN(num)) return '';
  if (num < 60) {
    const secStr = num.toFixed(1);
    return t('transcribe.durationSeconds', { seconds: secStr }) || t('common.durationSeconds', { seconds: secStr }) || `${secStr}s`;
  }
  const mins = Math.floor(num / 60);
  const remSec = (num % 60).toFixed(0);
  return t('transcribe.durationMinutesSeconds', { minutes: mins, seconds: remSec }) || t('common.durationMinutesSeconds', { minutes: mins, seconds: remSec }) || `${mins}m ${remSec}s`;
}

export function setTranscribeStatusBadge(statusClass: string, i18nKey?: string, fallbackText?: string): void {
  if (typeof document === 'undefined') return;

  const badge = document.getElementById('hud-status-badge');
  const textEl = document.getElementById('hud-status-text');
  const pulseDot = document.getElementById('hud-pulse-dot');
  if (badge) {
    badge.className = `transcribe-status-badge ${statusClass || ''}`.trim();
    badge.style.display = 'inline-flex';
  }
  const localized = (i18nKey ? t(i18nKey) : '') || fallbackText || '';
  if (textEl) {
    if (i18nKey) textEl.setAttribute('data-i18n', i18nKey);
    else textEl.removeAttribute('data-i18n');
    textEl.textContent = localized;
  } else if (badge) {
    if (i18nKey) badge.setAttribute('data-i18n', i18nKey);
    badge.textContent = localized;
  }
  if (pulseDot) {
    if (statusClass === 'active') {
      pulseDot.classList.add('active');
    } else {
      pulseDot.classList.remove('active');
    }
  }
}

// ----------------- Native Clipboard & Editor Open -----------------
export async function copyToClipboard(text: any): Promise<void> {
  const cleanText = (text === null || text === undefined) ? '' : String(text);
  let lastError: any = null;

  // 1. Direct native Rust backend IPC
  try {
    const inv = getTauriInvoke();
    if (inv) {
      await inv('copy_to_clipboard', { text: cleanText });
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] Native copy_to_clipboard command failed, trying plugin:', err);
  }

  // 2. Preferred Native IPC via Tauri Plugin Clipboard Manager
  try {
    const inv = getTauriInvoke();
    if (inv) {
      await inv('plugin:clipboard-manager|write_text', { text: cleanText });
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] Tauri plugin IPC command failed, trying next provider:', err);
  }

  // 3. Global Tauri Plugin Object
  try {
    const win = getGlobal();
    const tauriClipboard = (win.__TAURI__ && win.__TAURI__.clipboardManager) || null;
    if (tauriClipboard && typeof tauriClipboard.writeText === 'function') {
      await tauriClipboard.writeText(cleanText);
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] window.__TAURI__.clipboardManager failed:', err);
  }

  // 4. Web Navigator Clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(cleanText);
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] navigator.clipboard.writeText failed:', err);
  }

  // 5. Fallback: Hidden Textarea with document.execCommand('copy')
  try {
    if (typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = cleanText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] document.execCommand copy fallback failed:', err);
  }

  const errDetail = (lastError && (lastError.message || String(lastError))) || 'No clipboard provider available.';
  throw new Error(`Failed to copy to clipboard: ${errDetail}`);
}

export async function openFileInEditor(filePath: string): Promise<void> {
  if (!filePath) return;
  try {
    await invoke('open_file_in_editor', { filePath });
  } catch (err) {
    console.warn("open_file_in_editor fallback to opener plugin:", err);
    try {
      await invoke('plugin:opener|open_path', { path: filePath });
    } catch (e2) {
      const msg = (err && ((err as any).message || (err as any).toString())) || String(err);
      showNotification(t('toasts.openFileError', { error: msg }), "error");
    }
  }
}

// ----------------- Background Job Tracking & Taskbar Progress -----------------
let isTranscriptionRunningState = false;
let isTranslationRunningState = false;
let isHardsubRunningState = false;
let isDownloadingModelRunningState = false;

export function getIsTranscriptionRunning(): boolean {
  const win = getGlobal();
  return win.isTranscriptionRunning ?? isTranscriptionRunningState;
}

export function setIsTranscriptionRunning(val: boolean): void {
  isTranscriptionRunningState = val;
  const win = getGlobal();
  win.isTranscriptionRunning = val;
}

export function getIsTranslationRunning(): boolean {
  const win = getGlobal();
  return win.isTranslationRunning ?? isTranslationRunningState;
}

export function setIsTranslationRunning(val: boolean): void {
  isTranslationRunningState = val;
  const win = getGlobal();
  win.isTranslationRunning = val;
}

export function getIsHardsubRunning(): boolean {
  const win = getGlobal();
  return win.isHardsubRunning ?? isHardsubRunningState;
}

export function setIsHardsubRunning(val: boolean): void {
  isHardsubRunningState = val;
  const win = getGlobal();
  win.isHardsubRunning = val;
}

export function getIsDownloadingModelRunning(): boolean {
  const win = getGlobal();
  return win.isDownloadingModelRunning ?? isDownloadingModelRunningState;
}

export function setIsDownloadingModelRunning(val: boolean): void {
  isDownloadingModelRunningState = val;
  const win = getGlobal();
  win.isDownloadingModelRunning = val;
}

export function hasActiveBackgroundJob(): boolean {
  return !!(
    getIsTranscriptionRunning() ||
    getIsTranslationRunning() ||
    getIsHardsubRunning() ||
    getIsDownloadingModelRunning()
  );
}

export function updateTaskbarProgress(progressFraction: number, active: boolean, statusType = 'normal'): void {
  const win = getGlobal();
  if (win.__TAURI__ && win.__TAURI__.window) {
    try {
      const { getCurrentWindow } = win.__TAURI__.window;
      const appWin = getCurrentWindow();
      if (!appWin || typeof appWin.setProgressBar !== 'function') return;

      if (statusType === 'error') {
        appWin.setProgressBar({ status: 'error', progress: 100 }).catch(() => {});
        setTimeout(() => {
          appWin.setProgressBar({ status: 'none' }).catch(() => {});
        }, 4000);
      } else if (active) {
        const pct = Math.min(100, Math.max(0, Math.round((progressFraction || 0) * 100)));
        if (pct <= 0) {
          appWin.setProgressBar({ status: 'indeterminate' }).catch(() => {});
        } else {
          appWin.setProgressBar({ status: 'normal', progress: pct }).catch(() => {});
        }
      } else {
        appWin.setProgressBar({ status: 'none' }).catch(() => {});
      }
    } catch (e) {
      console.warn("Taskbar progress update failed:", e);
    }
  }
}

// ----------------- Titlebar Window Controls Binding -----------------
export function setupTitlebar(): void {
  if (typeof document === 'undefined') return;

  const minimizeBtn = document.getElementById('titlebar-minimize');
  const maximizeBtn = document.getElementById('titlebar-maximize');
  const closeBtn = document.getElementById('titlebar-close');

  if (!minimizeBtn || !maximizeBtn || !closeBtn) return;

  const win = getGlobal();
  if (win.__TAURI__ && win.__TAURI__.window) {
    try {
      const { getCurrentWindow } = win.__TAURI__.window;
      const appWindow = getCurrentWindow();

      minimizeBtn.addEventListener('click', () => {
        appWindow.minimize().catch((err: any) => console.error("Failed to minimize window:", err));
      });

      maximizeBtn.addEventListener('click', () => {
        appWindow.toggleMaximize().catch((err: any) => console.error("Failed to toggle maximize window:", err));
      });

      // Double-click titlebar to toggle maximize
      const titlebar = document.querySelector('.titlebar');
      if (titlebar) {
        titlebar.addEventListener('dblclick', (e: any) => {
          if (!e.target.closest('button')) {
            appWindow.toggleMaximize().catch((err: any) => console.error("Failed to toggle maximize window:", err));
          }
        });
      }

      const requestSafeExit = async () => {
        const settingsState = win.settingsState || null;
        if (settingsState && settingsState.closeToTray) {
          try {
            await invoke('hide_to_tray');
          } catch {
            appWindow.hide().catch((err: any) => console.error("Failed to hide window to tray:", err));
          }
          return;
        }

        if (hasActiveBackgroundJob()) {
          const confirmed = await showConfirmModal(
            t('modals.confirmExitTitle'),
            t('modals.confirmExitDesc'),
            t('modals.confirmExitBtn')
          );
          if (confirmed) {
            try {
              await invoke('exit_app');
            } catch {
              appWindow.destroy().catch(() => appWindow.close());
            }
          }
        } else {
          try {
            await invoke('exit_app');
          } catch {
            appWindow.close().catch((err: any) => console.error("Failed to close window:", err));
          }
        }
      };

      closeBtn.addEventListener('click', (e: MouseEvent) => {
        e.preventDefault();
        requestSafeExit();
      });

      if (typeof appWindow.onCloseRequested === 'function') {
        appWindow.onCloseRequested(async (event: any) => {
          event.preventDefault();
          requestSafeExit();
        });
      }
    } catch (e) {
      console.error("Failed to setup native Tauri window controls:", e);
    }
  } else {
    // Browser Mock / Fallback
    minimizeBtn.addEventListener('click', () => {
      showNotification("Minimize (Fallback Mock)", "info");
    });
    maximizeBtn.addEventListener('click', () => {
      showNotification("Toggle Maximize (Fallback Mock)", "info");
    });
    closeBtn.addEventListener('click', () => {
      showNotification("Close Application (Fallback Mock)", "info");
    });
  }
}

// ----------------- Synchronize Window Bindings -----------------
export function syncNativeWindowBindings(): void {
  if (typeof window === 'undefined') return;

  window.getBasename = getBasename;
  window.getParentDir = getParentDir;
  window.splitFileNameAndExt = splitFileNameAndExt;
  window.formatFileNameMiddleTruncate = formatFileNameMiddleTruncate;
  window.updateMediaCardName = updateMediaCardName;
  window.formatLocalizedTimeDuration = formatLocalizedTimeDuration;
  window.setTranscribeStatusBadge = setTranscribeStatusBadge;
  window.copyToClipboard = copyToClipboard;
  window.openFileInEditor = openFileInEditor;
  window.hasActiveBackgroundJob = hasActiveBackgroundJob;
  window.updateTaskbarProgress = updateTaskbarProgress;
  window.setupTitlebar = setupTitlebar;

  if (window.isTranscriptionRunning === undefined) window.isTranscriptionRunning = false;
  if (window.isTranslationRunning === undefined) window.isTranslationRunning = false;
  if (window.isHardsubRunning === undefined) window.isHardsubRunning = false;
  if (window.isDownloadingModelRunning === undefined) window.isDownloadingModelRunning = false;
}

if (typeof window !== 'undefined') {
  syncNativeWindowBindings();
}

export const nativeWindow = {
  getBasename,
  getParentDir,
  splitFileNameAndExt,
  truncateFileName: formatFileNameMiddleTruncate,
  updateMediaCardName,
  formatDuration: formatLocalizedTimeDuration,
  setStatusBadge: setTranscribeStatusBadge,
  copyToClipboard,
  openFileInEditor,
  isTranscriptionRunning: getIsTranscriptionRunning,
  setIsTranscriptionRunning,
  isTranslationRunning: getIsTranslationRunning,
  setIsTranslationRunning,
  isHardsubRunning: getIsHardsubRunning,
  setIsHardsubRunning,
  isDownloadingModelRunning: getIsDownloadingModelRunning,
  setIsDownloadingModelRunning,
  hasActiveJob: hasActiveBackgroundJob,
  updateTaskbarProgress,
  setupTitlebar,
  syncWindowBindings: syncNativeWindowBindings
};
