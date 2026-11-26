import {
  t,
  isolateLtr,
  isolateDirection,
  directionAttributes,
  applyContentDirection,
  clearContentDirection,
  getLanguage,
  formatLocalizedNumber,
} from './i18n/index';
import { copyToClipboard } from './modules/nativeWindow';
import { hardsubController } from './hardsub';
import { isModelIdMatch } from './modules/providerHelpers';

const invoke = async <T>(cmd: string, args: Record<string, any> = {}): Promise<T> => {
  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return await tauri.core.invoke(cmd, args);
  }
  throw new Error(`Tauri core API not available for command: ${cmd}`);
};

const listen = async <T>(event: string, handler: (e: { payload: T }) => void): Promise<(() => void) | undefined> => {
  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.event && tauri.event.listen) {
    return await tauri.event.listen(event, handler);
  }
};

export const SUPPORTED_TRANSLATION_EXTENSIONS = ['srt', 'vtt', 'lrc', 'txt'] as const;

export interface SubtitleCue {
  id: number;
  startMs: number;
  endMs: number;
  startTimeStr: string;
  endTimeStr: string;
  text: string;
}

export interface TranslationStudioState {
  subtitlePath: string;
  subtitleName: string;
  subtitleExt: string;
  subtitleRawText: string;
  sourceCues: SubtitleCue[];
  translatedPath: string;
  translatedName: string;
  translatedRawText: string;
  translatedCues: SubtitleCue[];
  targetLang: string;
  activeProvider: string;
  activeModel: string;
  polishPass: boolean;
  outputDir: string;
  companionVideoPath: string | null;
  isTranslating: boolean;
  progress: number;
  progressMsg: string;
  currentLine: number;
  totalLines: number;
  viewMode: 'split' | 'source' | 'target';
}

export const SUPPORTED_VIDEO_EXTENSIONS: readonly string[] = [
  '.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.m4v', '.wmv',
  '.ts', '.mts', '.m2ts', '.3gp', '.3g2', '.mpeg', '.mpg', '.vob', '.ogv', '.f4v'
];

function escapeHTML(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getParentDir(filePath: string): string {
  if (!filePath) return '';
  const clean = filePath.trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (lastSlash === 0) return '/';
  if (clean.length >= 3 && clean[1] === ':' && lastSlash === 2) {
    return clean.substring(0, 3);
  }
  return lastSlash > 0 ? clean.substring(0, lastSlash) : '';
}

function joinPath(dir: string, file: string): string {
  if (!dir) return file;
  const isWindows = dir.includes('\\');
  const sep = isWindows ? '\\' : '/';
  if (dir.endsWith('/') || dir.endsWith('\\')) {
    return `${dir}${file}`;
  }
  return `${dir}${sep}${file}`;
}

function parseTimeToMs(timeStr: string, isLrc = false): number {
  if (!timeStr) return 0;
  let clean = timeStr.trim().replace(',', '.');
  if (isLrc) {
    // LRC supports [mm:ss:cc] (two colons) as well as [mm:ss.cc]
    const partsColon = clean.split(':');
    if (partsColon.length === 3 && !clean.includes('.')) {
      clean = `${partsColon[0]}:${partsColon[1]}.${partsColon[2]}`;
    }
  }
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return 0;
}

const SEPARATORS_ONLY_RE = /^[-=*_~#/]+$/;
const MUSIC_ONLY_RE = /^[♪♫♩♬\s]+$/;
const HAS_ALNUM_RE = /[\p{L}\p{N}]/u;
const SUBTITLE_TIMELINE_RE = /^\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{1,3}(?:\s|$)/;

function isSubtitleTimeline(line: string): boolean {
  return SUBTITLE_TIMELINE_RE.test(line);
}

function isTranslatableLineText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  if (SEPARATORS_ONLY_RE.test(trimmed)) return false;
  if (MUSIC_ONLY_RE.test(trimmed)) return false;
  return HAS_ALNUM_RE.test(trimmed);
}

export function parseSubtitleContent(content: string, ext: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  if (!content) return cues;

  // Strip UTF-8 BOM if present
  let cleanContent = content;
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1);
  }

  const normalized = cleanContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const extLower = (ext || '').toLowerCase();

  if (extLower === 'lrc') {
    const lines = normalized.split('\n');
    let cueId = 1;
    const lrcTsRe = /^\[(\d{1,3}:\d{2}(?:[.:]\d{2,3})?)\]/;
    for (let i = 0; i < lines.length; i++) {
      let rest = lines[i];
      const timestamps: string[] = [];
      let m = rest.match(lrcTsRe);
      while (m) {
        timestamps.push(m[1]);
        rest = rest.slice(m[0].length);
        m = rest.match(lrcTsRe);
      }
      if (timestamps.length > 0) {
        const text = rest.trim();
        if (!isTranslatableLineText(text)) continue;
        const timeStr = timestamps[0];
        const startMs = parseTimeToMs(timeStr, true);
        cues.push({
          id: cueId++,
          startMs,
          endMs: startMs,
          startTimeStr: timeStr,
          endTimeStr: '',
          text,
        });
      }
    }
  } else if (extLower === 'txt') {
    const lines = normalized.split('\n');
    let cueId = 1;
    for (const line of lines) {
      const trimmed = line.trim();
      if (isTranslatableLineText(trimmed)) {
        cues.push({
          id: cueId++,
          startMs: 0,
          endMs: 0,
          startTimeStr: '',
          endTimeStr: '',
          text: trimmed,
        });
      }
    }
  } else if (extLower === 'srt' || extLower === 'vtt') {
    // Robust line-by-line parser matching Rust backend formatter
    const lines = normalized.split('\n');
    let cueId = 1;
    let i = 0;
    const total = lines.length;
    let lastPotentialCueNum = '';

    while (i < total) {
      const line = lines[i];

      // Skip VTT metadata blocks (NOTE, STYLE, REGION) using word boundaries so
      // cue IDs like NOTE_1 or REGION-A are never misparsed as metadata blocks.
      if (extLower === 'vtt') {
        const trimmedStart = line.trimStart();
        const trimmedFull = trimmedStart.trimEnd();
        const isVttMeta =
          trimmedStart === 'NOTE' ||
          trimmedStart.startsWith('NOTE ') ||
          trimmedStart.startsWith('NOTE\t') ||
          trimmedFull === 'STYLE' ||
          trimmedFull === 'REGION';
        if (isVttMeta) {
          i++;
          while (i < total && lines[i].trim() !== '') {
            i++;
          }
          continue;
        }
      }

      if (isSubtitleTimeline(line)) {
        const times = line.split('-->');
        if (times.length === 2) {
          const startStr = times[0].trim().split(/\s+/)[0];
          const endStr = times[1].trim().split(/\s+/)[0];
          const currentCueNum = lastPotentialCueNum;
          lastPotentialCueNum = '';

          // Collect dialogue lines until next empty line or next timeline
          const dialogueParts: string[] = [];
          i++;
          while (i < total && lines[i].trim() !== '' && !isSubtitleTimeline(lines[i])) {
            // Check if this line is actually a cue number for the subsequent timeline
            const nextLineIsTimeline = (i + 1 < total) && isSubtitleTimeline(lines[i + 1]);
            if (/^\d+$/.test(lines[i].trim()) && nextLineIsTimeline) {
              break;
            }
            dialogueParts.push(lines[i]);
            i++;
          }

          const rawText = dialogueParts.join('\n').replace(/<\/?[a-zA-Z][^>\n]*>/g, '').trim();
          if (rawText || startStr) {
            const parsedId = currentCueNum && /^\d+$/.test(currentCueNum)
              ? parseInt(currentCueNum, 10)
              : cueId;

            cues.push({
              id: parsedId,
              startMs: parseTimeToMs(startStr),
              endMs: parseTimeToMs(endStr),
              startTimeStr: startStr,
              endTimeStr: endStr,
              text: rawText,
            });
            cueId = parsedId + 1;
          }
          continue;
        }
      } else {
        const trimmed = line.trim();
        if (/^\d+$/.test(trimmed)) {
          lastPotentialCueNum = trimmed;
        } else if (trimmed !== '') {
          lastPotentialCueNum = '';
        }
      }
      i++;
    }
  }

  return cues;
}

export class TranslationStudioController {
  private dropZone: HTMLElement | null = null;
  private lblSubName: HTMLElement | null = null;
  private lblSubPath: HTMLElement | null = null;
  private lblSubMeta: HTMLElement | null = null;
  private btnBrowseSub: HTMLButtonElement | null = null;
  private btnClearSub: HTMLButtonElement | null = null;

  // Quick Deck Elements
  private targetLangSelect: HTMLSelectElement | null = null;
  private providerSelect: HTMLSelectElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private btnManageProviders: HTMLButtonElement | null = null;
  private polishToggle: HTMLInputElement | null = null;
  private outputDirText: HTMLElement | null = null;
  private btnBrowseDir: HTMLButtonElement | null = null;
  private btnResetDir: HTMLButtonElement | null = null;

  // Telemetry & Action Elements
  private btnStart: HTMLButtonElement | null = null;
  private btnStartText: HTMLElement | null = null;
  private btnCancel: HTMLButtonElement | null = null;
  private telemetryBox: HTMLElement | null = null;
  private progressTrack: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private lblPct: HTMLElement | null = null;
  private lblLines: HTMLElement | null = null;
  private lblMsg: HTMLElement | null = null;
  private statusBadge: HTMLElement | null = null;

  // Dual Preview Elements
  private previewGrid: HTMLElement | null = null;
  private sourcePane: HTMLElement | null = null;
  private targetPane: HTMLElement | null = null;
  private sourceList: HTMLElement | null = null;
  private targetList: HTMLElement | null = null;
  private sourceCountBadge: HTMLElement | null = null;
  private targetCountBadge: HTMLElement | null = null;
  private btnCopy: HTMLButtonElement | null = null;
  private btnOpenFolder: HTMLButtonElement | null = null;
  private btnViewSplit: HTMLButtonElement | null = null;
  private btnViewSource: HTMLButtonElement | null = null;
  private btnViewTarget: HTMLButtonElement | null = null;
  private btnSendToHardsub: HTMLButtonElement | null = null;

  private activeScrollDriver: HTMLElement | null = null;
  private isScrollingThrottled: boolean = false;
  private scrollThrottledTimeout: any = null;
  private pointerDriverTimeout: any = null;
  private syncScrollRaf: number | null = null;
  private subtitleLoadId = 0;
  private activeLoadToken = 0;
  private companionProbeSeq = 0;
  private companionProbeCompleted = false;
  private isBrowsingSubtitle = false;
  private isBrowsingOutputDir = false;
  private isStartingTranslation = false;
  private isCancellingTranslation = false;
  private isDisposed = false;
  private pendingSettingsSyncAfterTranslation = false;
  private statusBadgeKey = 'translate.statusReady';
  private statusBadgeModifier = '';
  private lastProgressPayload: any = null;
  private lastProgressIsComplete = false;
  private lastProgressIsCancelled = false;
  private lastProgressIsFailed = false;
  private lastPreflightError = '';
  private unlisteners: Array<() => void> = [];

  public state: TranslationStudioState = {
    subtitlePath: '',
    subtitleName: '',
    subtitleExt: '',
    subtitleRawText: '',
    sourceCues: [],
    translatedPath: '',
    translatedName: '',
    translatedRawText: '',
    translatedCues: [],
    targetLang: 'Persian',
    activeProvider: '',
    activeModel: '',
    polishPass: false,
    outputDir: '',
    companionVideoPath: null,
    isTranslating: false,
    progress: 0,
    progressMsg: '',
    currentLine: 0,
    totalLines: 0,
    viewMode: 'split',
  };

  constructor() {
    const init = () => {
      this.initDOMElements();
      this.setupEventListeners();
      this.setupDropZone();
      this.listenToProgressEvents();
      this.syncFromGlobalSettings();
      this.updateActionButtons();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  }

  private initDOMElements() {
    this.dropZone = document.getElementById('translate-drop-zone');
    this.lblSubName = document.getElementById('lbl-translate-sub-name');
    this.lblSubPath = document.getElementById('lbl-translate-sub-path');
    this.lblSubMeta = document.getElementById('lbl-translate-sub-meta');
    this.btnBrowseSub = document.getElementById('btn-browse-translate-sub') as HTMLButtonElement;
    this.btnClearSub = document.getElementById('btn-clear-translate-sub') as HTMLButtonElement;

    this.targetLangSelect = document.getElementById('translate-target-lang') as HTMLSelectElement;
    this.providerSelect = document.getElementById('translate-provider-select') as HTMLSelectElement;
    this.modelSelect = document.getElementById('translate-model-select') as HTMLSelectElement;
    this.btnManageProviders = document.getElementById('btn-translate-manage-providers') as HTMLButtonElement;
    this.polishToggle = document.getElementById('translate-polish-toggle') as HTMLInputElement;
    this.outputDirText = document.getElementById('translate-output-dir-text');
    this.btnBrowseDir = document.getElementById('btn-browse-translate-dir') as HTMLButtonElement;
    this.btnResetDir = document.getElementById('btn-reset-translate-dir') as HTMLButtonElement;

    this.btnStart = document.getElementById('btn-start-translation') as HTMLButtonElement;
    this.btnStartText = document.getElementById('btn-start-translation-text');
    this.btnCancel = document.getElementById('btn-cancel-translation') as HTMLButtonElement;
    this.telemetryBox = document.getElementById('translate-telemetry-box');
    this.progressTrack = document.getElementById('translate-progress-track');
    this.progressFill = document.getElementById('translate-progress-fill');
    this.lblPct = document.getElementById('lbl-translate-pct');
    this.lblLines = document.getElementById('lbl-translate-lines');
    this.lblMsg = document.getElementById('lbl-translate-msg');
    this.statusBadge = document.getElementById('translate-status-badge');

    this.previewGrid = document.getElementById('translate-preview-grid');
    this.sourcePane = document.getElementById('translate-source-pane');
    this.targetPane = document.getElementById('translate-target-pane');
    this.sourceList = document.getElementById('translate-source-cues-list');
    this.targetList = document.getElementById('translate-target-cues-list');
    this.sourceCountBadge = document.getElementById('translate-source-count');
    this.targetCountBadge = document.getElementById('translate-target-count');
    this.btnCopy = document.getElementById('btn-copy-translated') as HTMLButtonElement;
    this.btnOpenFolder = document.getElementById('btn-open-translated-dir') as HTMLButtonElement;
    this.btnViewSplit = document.getElementById('btn-view-split') as HTMLButtonElement;
    this.btnViewSource = document.getElementById('btn-view-source') as HTMLButtonElement;
    this.btnViewTarget = document.getElementById('btn-view-target') as HTMLButtonElement;
    this.btnSendToHardsub = document.getElementById('btn-send-to-hardsub') as HTMLButtonElement;
  }

  private bindListener(
    el: { addEventListener?: Function; removeEventListener?: Function } | null | undefined,
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    if (!el || typeof el.addEventListener !== 'function') return;
    if (options !== undefined) {
      el.addEventListener(event, handler, options);
      this.unlisteners.push(() => el.removeEventListener?.(event, handler, options));
    } else {
      el.addEventListener(event, handler);
      this.unlisteners.push(() => el.removeEventListener?.(event, handler));
    }
  }

  private setupEventListeners() {
    this.bindListener(this.dropZone, 'click', (e) => {
      if (this.state.subtitlePath) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      this.browseSubtitleFile();
    });

    this.bindListener(this.btnBrowseSub, 'click', () => this.browseSubtitleFile());
    this.bindListener(this.btnClearSub, 'click', () => this.clearLoadedSubtitle());

    this.bindListener(this.targetLangSelect, 'change', () => {
      if (this.targetLangSelect) {
        if (this.state.isTranslating || this.isStartingTranslation) {
          this.targetLangSelect.value = this.state.targetLang;
          return;
        }
        this.state.targetLang = this.targetLangSelect.value;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiTargetLang = this.state.targetLang;
          const settingsSelect = document.getElementById('opt-translateAiTargetLang') as HTMLSelectElement;
          if (settingsSelect) settingsSelect.value = this.state.targetLang;
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
      }
    });

    this.bindListener(this.providerSelect, 'change', () => {
      if (this.providerSelect) {
        if (this.state.isTranslating || this.isStartingTranslation) {
          this.providerSelect.value = this.state.activeProvider;
          return;
        }
        this.state.activeProvider = this.providerSelect.value;
        const win = window as any;
        if (win.settingsState) {
          const globalProviderSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
          if (globalProviderSelect && typeof win.onProviderChanged === 'function') {
            globalProviderSelect.value = this.state.activeProvider;
            // Let onProviderChanged flush any pending debounced model edits for the
            // previous provider before overwriting settingsState.translateAiProvider.
            win.onProviderChanged(true, true);
            return;
          }
          win.settingsState.translateAiProvider = this.state.activeProvider;
          if (globalProviderSelect) {
            globalProviderSelect.value = this.state.activeProvider;
          }
          this.refreshModelOptions();
          win.settingsState.translateAiModel = this.state.activeModel;
          const globalModelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
          if (globalModelSelect) {
            globalModelSelect.value = this.state.activeModel;
          }
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        } else {
          this.refreshModelOptions();
        }
      }
    });

    this.bindListener(this.modelSelect, 'change', () => {
      if (this.modelSelect) {
        if (this.state.isTranslating || this.isStartingTranslation) {
          this.modelSelect.value = this.state.activeModel;
          return;
        }
        this.state.activeModel = this.modelSelect.value;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiModel = this.state.activeModel;
          const globalModelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement;
          if (globalModelSelect) {
            globalModelSelect.value = this.state.activeModel;
          }
          if (typeof win.syncActiveModelSelectionUI === 'function') {
            win.syncActiveModelSelectionUI(this.state.activeModel);
          } else if (typeof win.updateActiveModelBannerUI === 'function') {
            win.updateActiveModelBannerUI(this.state.activeModel);
          }
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
        this.updateActionButtons();
      }
    });

    this.bindListener(this.btnManageProviders, 'click', () => {
      const win = window as any;
      if (typeof win.switchView === 'function') {
        win.switchView('settings');
        if (typeof win.switchSettingsCategory === 'function') {
          win.switchSettingsCategory('translation');
        } else if (typeof win.switchSettingsTab === 'function') {
          win.switchSettingsTab('translation');
        }
      }
    });

    this.bindListener(this.polishToggle, 'change', () => {
      if (this.polishToggle) {
        if (this.state.isTranslating || this.isStartingTranslation) {
          this.polishToggle.checked = this.state.polishPass;
          return;
        }
        this.state.polishPass = this.polishToggle.checked;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiPolish = this.state.polishPass;
          const globalPolish = document.getElementById('opt-translateAiPolish') as HTMLInputElement;
          if (globalPolish) globalPolish.checked = this.state.polishPass;
          if (typeof win.markSettingsDirty === 'function') {
            win.markSettingsDirty();
          }
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
      }
    });

    this.bindListener(this.btnBrowseDir, 'click', () => this.browseOutputDir());
    this.bindListener(this.btnResetDir, 'click', () => {
      if (this.state.isTranslating || this.isStartingTranslation) return;
      this.state.outputDir = '';
      this.updateOutputDirUI();
    });

    this.bindListener(this.btnStart, 'click', () => this.startTranslation());
    this.bindListener(this.btnCancel, 'click', () => this.cancelTranslation());

    this.bindListener(this.btnCopy, 'click', () => this.copyTranslatedText());
    this.bindListener(this.btnOpenFolder, 'click', () => this.openOutputFolder());

    this.bindListener(this.btnViewSplit, 'click', () => this.setViewMode('split'));
    this.bindListener(this.btnViewSource, 'click', () => this.setViewMode('source'));
    this.bindListener(this.btnViewTarget, 'click', () => this.setViewMode('target'));

    const tabs = ['split', 'source', 'target'] as const;
    const viewSegmented = this.btnViewSplit?.closest('.translate-view-segmented') as HTMLElement | null;
    if (viewSegmented) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const currentIdx = tabs.indexOf(this.state.viewMode);
        let targetIdx = -1;
        const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
        const isNext = e.key === 'ArrowDown' || (isRtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight');
        const isPrev = e.key === 'ArrowUp' || (isRtl ? e.key === 'ArrowRight' : e.key === 'ArrowLeft');

        if (isNext) {
          targetIdx = (currentIdx + 1) % tabs.length;
        } else if (isPrev) {
          targetIdx = (currentIdx - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          targetIdx = 0;
        } else if (e.key === 'End') {
          targetIdx = tabs.length - 1;
        }

        if (targetIdx !== -1) {
          e.preventDefault();
          const targetMode = tabs[targetIdx];
          this.setViewMode(targetMode);
          const targetBtn = targetMode === 'split' ? this.btnViewSplit : targetMode === 'source' ? this.btnViewSource : this.btnViewTarget;
          targetBtn?.focus();
        }
      };
      this.bindListener(viewSegmented, 'keydown', onKeyDown as EventListener);
    }

    this.bindListener(this.btnSendToHardsub, 'click', () => this.sendToHardsubStudio());

    this.setupSynchronizedScrolling();
    this.setupSynchronizedHighlighting();
    this.setupStudioShortcuts();

    // Re-render strings when language changes globally (defer inactive panel until switchView('translate'))
    const onLanguageChange = () => {
      const panel = typeof document !== 'undefined' ? document.getElementById('panel-translate') : null;
      if (panel && !panel.classList.contains('active')) return;
      this.refreshLocalization();
    };
    window.addEventListener?.('whisper:languageChanged', onLanguageChange);
    this.unlisteners.push(() => window.removeEventListener?.('whisper:languageChanged', onLanguageChange));
  }

  private isEditingField(el: HTMLElement | null): boolean {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (typeof el.closest === 'function') {
      return Boolean(
        el.closest(
          'textarea, select, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]), [contenteditable]:not([contenteditable="false"]), .custom-select-container.open, .custom-select-trigger[aria-expanded="true"]'
        )
      );
    }
    if (el.classList?.contains('custom-select-trigger') && el.getAttribute?.('aria-expanded') === 'true') {
      return true;
    }
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const inputType = ((el as HTMLInputElement).type || '').toLowerCase();
      return inputType !== 'button' && inputType !== 'submit' && inputType !== 'reset' && inputType !== 'checkbox';
    }
    return false;
  }

  private isCustomSelectTrigger(el: HTMLElement | null): boolean {
    if (!el) return false;
    if (typeof el.closest === 'function') {
      return Boolean(el.closest('.custom-select-trigger'));
    }
    return Boolean(el.classList?.contains('custom-select-trigger'));
  }

  private matchesShortcutLetter(e: KeyboardEvent, letter: string, code: string): boolean {
    const keyLower = (e.key || '').toLowerCase();
    return keyLower === letter || (e.code === code && !/^[a-z]$/i.test(e.key || ''));
  }

  private focusInitialCueFromKeyboard(e: KeyboardEvent, target: HTMLElement | null, activeEl: HTMLElement | null) {
    const isBlockedContext = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A') return true;
      if (typeof el.closest === 'function') {
        return Boolean(
          el.closest('.translate-cue-item, .translate-left-panel, button, a, [role="tab"], .custom-select-trigger')
        );
      }
      return false;
    };

    if (isBlockedContext(target) || isBlockedContext(activeEl)) return;

    const pickItems = (list: HTMLElement | null) =>
      (list && typeof list.querySelectorAll === 'function')
        ? list.querySelectorAll('.translate-cue-item')
        : null;

    const preferredItems = pickItems(this.state.viewMode === 'target' ? this.targetList : this.sourceList);
    const items = (preferredItems && preferredItems.length > 0)
      ? preferredItems
      : (this.state.viewMode === 'split' ? pickItems(this.targetList) : null);
    if (!items || items.length === 0) return;

    const cue = (e.key === 'ArrowDown' ? items[0] : items[items.length - 1]) as HTMLElement;
    e.preventDefault();
    cue.focus?.();
    const owningList = cue.parentElement === this.targetList
      ? this.targetList
      : (cue.parentElement === this.sourceList ? this.sourceList : null);
    if (owningList) this.setTemporaryScrollDriver(owningList);
    this.scrollCueIntoView(cue);
  }

  private setupStudioShortcuts() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    const onStudioKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;

      const translatePanel = typeof document.getElementById === 'function' ? document.getElementById('panel-translate') : null;
      if (!translatePanel || !translatePanel.classList?.contains('active')) return;

      const hasOpenOverlay = typeof document.querySelector === 'function' && Boolean(
        document.querySelector(
          '.modal-overlay.show, #app-modal-overlay:not([style*="display: none"]), .custom-select-options.open, .custom-select-container.open, .custom-select-trigger[aria-expanded="true"]'
        )
      );
      if (hasOpenOverlay) return;

      const target = e.target as HTMLElement | null;
      const activeEl = (typeof document.activeElement !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
      if (this.isEditingField(target) || this.isEditingField(activeEl)) return;

      this.handleStudioShortcutKey(e, target, activeEl);
    };

    document.addEventListener('keydown', onStudioKeyDown);
    this.unlisteners.push(() => document.removeEventListener?.('keydown', onStudioKeyDown));
  }

  private handleStudioShortcutKey(e: KeyboardEvent, target: HTMLElement | null, activeEl: HTMLElement | null) {
    const isCtrlOrCmd = Boolean(e.ctrlKey || e.metaKey);

    if (isCtrlOrCmd && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      const canStart = !this.state.isTranslating && !this.isStartingTranslation && Boolean(this.state.subtitlePath) && Boolean(this.state.activeModel) && !this.btnStart?.disabled;
      if (!canStart) return;
      e.preventDefault();
      void this.startTranslation();
      return;
    }

    if (isCtrlOrCmd && !e.altKey && !e.shiftKey && this.matchesShortcutLetter(e, 'o', 'KeyO')) {
      e.preventDefault();
      if (this.state.isTranslating || this.isStartingTranslation || this.isBrowsingSubtitle) return;
      void this.browseSubtitleFile();
      return;
    }

    if (isCtrlOrCmd && e.shiftKey && !e.altKey && this.matchesShortcutLetter(e, 'c', 'KeyC')) {
      e.preventDefault();
      const canCopy = !this.state.isTranslating && Boolean(this.state.translatedPath) && this.state.translatedCues.length > 0;
      if (!canCopy) return;
      void this.copyTranslatedText();
      return;
    }

    if (isCtrlOrCmd || e.altKey || e.shiftKey) return;
    if (this.isCustomSelectTrigger(target) || this.isCustomSelectTrigger(activeEl)) return;

    const isNumpadNavKey = Boolean(e.code?.startsWith('Numpad')) && /^(End|ArrowDown|PageDown)$/i.test(e.key || '');
    if (!isNumpadNavKey) {
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') {
        e.preventDefault();
        this.setViewMode('split');
        return;
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') {
        e.preventDefault();
        this.setViewMode('source');
        return;
      }
      if (e.code === 'Digit3' || e.code === 'Numpad3' || e.key === '3') {
        e.preventDefault();
        this.setViewMode('target');
        return;
      }
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this.focusInitialCueFromKeyboard(e, target, activeEl);
    }
  }

  private scrollCueIntoView(el: HTMLElement | null) {
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    el.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }

  private setTemporaryScrollDriver(driver: HTMLElement | null) {
    this.activeScrollDriver = driver;
    if (this.pointerDriverTimeout) {
      clearTimeout(this.pointerDriverTimeout);
      this.pointerDriverTimeout = null;
    }
    if (driver) {
      this.pointerDriverTimeout = setTimeout(() => {
        this.pointerDriverTimeout = null;
        if (!this.isScrollingThrottled && this.activeScrollDriver === driver) {
          this.activeScrollDriver = null;
        }
      }, 200);
    }
  }

  private registerAsyncUnlisten(promise: Promise<(() => void) | undefined>) {
    promise
      .then((unlisten) => {
        if (!unlisten) return;
        if (this.isDisposed) {
          try {
            unlisten();
          } catch (_) {}
        } else {
          this.unlisteners.push(unlisten);
        }
      })
      .catch(() => {});
  }

  private markScrolling() {
    this.isScrollingThrottled = true;
    if (this.pointerDriverTimeout) {
      clearTimeout(this.pointerDriverTimeout);
      this.pointerDriverTimeout = null;
    }
    if (this.scrollThrottledTimeout) clearTimeout(this.scrollThrottledTimeout);
    this.scrollThrottledTimeout = setTimeout(() => {
      this.scrollThrottledTimeout = null;
      this.isScrollingThrottled = false;
      this.activeScrollDriver = null;
    }, 120);
  }

  private setupSynchronizedHighlighting() {
    const setHighlight = (cueId: string, highlight: boolean) => {
      const sourceEl = document.getElementById(`translate-source-cue-${cueId}`);
      const targetEl = document.getElementById(`translate-target-cue-${cueId}`);
      if (highlight) {
        if (sourceEl) sourceEl.classList.add('highlighted');
        if (targetEl) targetEl.classList.add('highlighted');
      } else {
        if (sourceEl) sourceEl.classList.remove('highlighted');
        if (targetEl) targetEl.classList.remove('highlighted');
      }
    };

    const handleMouseOver = (e: MouseEvent) => {
      if (this.isScrollingThrottled) return;
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;
      setHighlight(cueId, true);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const related = (e.relatedTarget as HTMLElement)?.closest('.translate-cue-item');
      if (related === target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;
      setHighlight(cueId, false);
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;
      setHighlight(cueId, true);
    };

    const handleFocusOut = (e: FocusEvent) => {
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const related = (e.relatedTarget as HTMLElement)?.closest('.translate-cue-item');
      if (related === target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;
      setHighlight(cueId, false);
    };

    const focusMovedCue = (cueEl: HTMLElement) => {
      cueEl.focus?.();
      const owningList = cueEl.parentElement === this.targetList
        ? this.targetList
        : (cueEl.parentElement === this.sourceList ? this.sourceList : null);
      if (owningList) this.setTemporaryScrollDriver(owningList);
      this.scrollCueIntoView(cueEl);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;

      if (e.key === 'ArrowDown') {
        const next = target.nextElementSibling as HTMLElement | null;
        if (next && next.classList.contains('translate-cue-item')) {
          e.preventDefault();
          focusMovedCue(next);
        }
      } else if (e.key === 'ArrowUp') {
        const prev = target.previousElementSibling as HTMLElement | null;
        if (prev && prev.classList.contains('translate-cue-item')) {
          e.preventDefault();
          focusMovedCue(prev);
        }
      } else if (e.key === 'Home') {
        const parent = target.parentElement;
        const first = parent?.querySelector('.translate-cue-item') as HTMLElement | null;
        if (first) {
          e.preventDefault();
          focusMovedCue(first);
        }
      } else if (e.key === 'End') {
        const parent = target.parentElement;
        const items = parent?.querySelectorAll('.translate-cue-item');
        if (items && items.length > 0) {
          const last = items[items.length - 1] as HTMLElement;
          e.preventDefault();
          focusMovedCue(last);
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (this.state.viewMode === 'split') {
          const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
          const isSource = target.parentElement === this.sourceList;
          const cueId = target.dataset.id;
          if (cueId) {
            const shouldJumpToTarget = isRtl ? (e.key === 'ArrowLeft' && isSource) : (e.key === 'ArrowRight' && isSource);
            const shouldJumpToSource = isRtl ? (e.key === 'ArrowRight' && !isSource) : (e.key === 'ArrowLeft' && !isSource);
            if (shouldJumpToTarget) {
              const counterpart = document.getElementById(`translate-target-cue-${cueId}`);
              if (counterpart) {
                e.preventDefault();
                focusMovedCue(counterpart);
              }
            } else if (shouldJumpToSource) {
              const counterpart = document.getElementById(`translate-source-cue-${cueId}`);
              if (counterpart) {
                e.preventDefault();
                focusMovedCue(counterpart);
              }
            }
          }
        }
      }
    };

    const listeners: Array<[string, EventListener]> = [
      ['mouseover', handleMouseOver as EventListener],
      ['mouseout', handleMouseOut as EventListener],
      ['focusin', handleFocusIn as EventListener],
      ['focusout', handleFocusOut as EventListener],
      ['keydown', handleKeyDown as EventListener],
    ];
    for (const listEl of [this.sourceList, this.targetList]) {
      if (!listEl) continue;
      for (const [evt, handler] of listeners) {
        listEl.addEventListener(evt, handler);
        this.unlisteners.push(() => listEl.removeEventListener?.(evt, handler));
      }
    }
  }

  private setupSynchronizedScrolling() {
    if (!this.sourceList || !this.targetList) return;

    const onSourceScroll = () => {
      if (this.state.viewMode !== 'split') return;
      // If targetList is driving, ignore sourceList scroll event to prevent feedback loop
      if (this.activeScrollDriver && this.activeScrollDriver !== this.sourceList) return;
      if (!this.activeScrollDriver) this.activeScrollDriver = this.sourceList;

      this.markScrolling();

      if (this.syncScrollRaf) cancelAnimationFrame(this.syncScrollRaf);
      this.syncScrollRaf = requestAnimationFrame(() => {
        this.syncScrollRaf = null;
        if (!this.sourceList || !this.targetList) return;
        const sourceMax = this.sourceList.scrollHeight - this.sourceList.clientHeight;
        if (sourceMax > 0) {
          const ratio = this.sourceList.scrollTop / sourceMax;
          const targetMax = this.targetList.scrollHeight - this.targetList.clientHeight;
          this.targetList.scrollTop = Math.round(ratio * targetMax);
        }
      });
    };

    const onTargetScroll = () => {
      if (this.state.viewMode !== 'split') return;
      // If sourceList is driving, ignore targetList scroll event to prevent feedback loop
      if (this.activeScrollDriver && this.activeScrollDriver !== this.targetList) return;
      if (!this.activeScrollDriver) this.activeScrollDriver = this.targetList;

      this.markScrolling();

      if (this.syncScrollRaf) cancelAnimationFrame(this.syncScrollRaf);
      this.syncScrollRaf = requestAnimationFrame(() => {
        this.syncScrollRaf = null;
        if (!this.sourceList || !this.targetList) return;
        const targetMax = this.targetList.scrollHeight - this.targetList.clientHeight;
        if (targetMax > 0) {
          const ratio = this.targetList.scrollTop / targetMax;
          const sourceMax = this.sourceList.scrollHeight - this.sourceList.clientHeight;
          this.sourceList.scrollTop = Math.round(ratio * sourceMax);
        }
      });
    };

    const onSourcePointer = () => { this.setTemporaryScrollDriver(this.sourceList); };
    const onTargetPointer = () => { this.setTemporaryScrollDriver(this.targetList); };

    this.sourceList.addEventListener('wheel', onSourcePointer, { passive: true });
    this.sourceList.addEventListener('pointerdown', onSourcePointer, { passive: true });
    this.sourceList.addEventListener('scroll', onSourceScroll, { passive: true });

    this.targetList.addEventListener('wheel', onTargetPointer, { passive: true });
    this.targetList.addEventListener('pointerdown', onTargetPointer, { passive: true });
    this.targetList.addEventListener('scroll', onTargetScroll, { passive: true });

    this.unlisteners.push(() => {
      this.sourceList?.removeEventListener('wheel', onSourcePointer);
      this.sourceList?.removeEventListener('pointerdown', onSourcePointer);
      this.sourceList?.removeEventListener('scroll', onSourceScroll);
      this.targetList?.removeEventListener('wheel', onTargetPointer);
      this.targetList?.removeEventListener('pointerdown', onTargetPointer);
      this.targetList?.removeEventListener('scroll', onTargetScroll);
    });
  }

  private setupDropZone() {
    if (!this.dropZone) return;

    const highlight = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state.isTranslating || this.isStartingTranslation) return;
      this.dropZone?.classList.add('drag-over');
    };

    const unhighlight = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone?.classList.remove('drag-over');
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const related = e.relatedTarget as Node | null;
      if (related && typeof this.dropZone?.contains === 'function' && this.dropZone.contains(related)) {
        return;
      }
      this.dropZone?.classList.remove('drag-over');
    };

    this.bindListener(this.dropZone, 'dragenter', highlight as EventListener);
    this.bindListener(this.dropZone, 'dragover', highlight as EventListener);
    this.bindListener(this.dropZone, 'dragleave', onDragLeave as EventListener);
    this.bindListener(this.dropZone, 'drop', (async (e: DragEvent) => {
      unhighlight(e);
      if (this.state.isTranslating || this.isStartingTranslation) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const path = (file as any).path;
        if (typeof path === 'string' && path.trim().length > 0) {
          await this.loadSubtitleFile(path.trim());
        }
      }
    }) as EventListener);

    const isTranslatePanelActive = () => {
      const activePanel = document.querySelector('.view-panel.active');
      return Boolean(activePanel && activePanel.id === 'panel-translate');
    };

    this.registerAsyncUnlisten(listen<any>('tauri://drag-over', () => {
      if (this.state.isTranslating || this.isStartingTranslation || !isTranslatePanelActive()) return;
      this.dropZone?.classList.add('drag-over');
    }));

    this.registerAsyncUnlisten(listen<any>('tauri://drag-leave', () => {
      this.dropZone?.classList.remove('drag-over');
    }));

    this.registerAsyncUnlisten(listen<any>('tauri://drag-drop', async (event: any) => {
      this.dropZone?.classList.remove('drag-over');
      if (this.state.isTranslating || this.isStartingTranslation) return;
      if (!isTranslatePanelActive()) return;
      const paths = event.payload?.paths;
      if (Array.isArray(paths) && paths.length > 0) {
        const path = paths[0];
        if (typeof path === 'string' && path.trim().length > 0) {
          await this.loadSubtitleFile(path.trim());
        }
      }
    }));
  }

  public async browseSubtitleFile() {
    if (this.isBrowsingSubtitle || this.state.isTranslating || this.isStartingTranslation) return;
    this.isBrowsingSubtitle = true;
    try {
      const selectedPath = await invoke<string | null>('select_subtitle_file', {
        extensions: [...SUPPORTED_TRANSLATION_EXTENSIONS],
      });
      if (selectedPath) {
        await this.loadSubtitleFile(selectedPath);
      }
    } catch (err) {
      console.error('Failed to select subtitle file:', err);
      this.notify(t('translate.noSubSelectedError'), 'error');
    } finally {
      this.isBrowsingSubtitle = false;
    }
  }

  public async loadSubtitleFile(filePath: string): Promise<boolean> {
    if (!filePath || this.state.isTranslating || this.isStartingTranslation) return false;

    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    const lastDot = fileName.lastIndexOf('.');
    const ext = lastDot > 0 ? fileName.substring(lastDot + 1).toLowerCase() : '';

    if (!(SUPPORTED_TRANSLATION_EXTENSIONS as readonly string[]).includes(ext)) {
      this.notify(t('translate.unsupportedFormatError'), 'error');
      return false;
    }

    const loadId = ++this.subtitleLoadId;
    const loadToken = ++this.activeLoadToken;
    this.companionProbeCompleted = false;
    try {
      const content = await invoke<string>('read_text_file_content', { filePath });
      if (
        loadToken !== this.activeLoadToken ||
        loadId !== this.subtitleLoadId ||
        this.state.isTranslating ||
        this.isStartingTranslation
      ) return false;

      this.state.subtitlePath = filePath;
      this.state.subtitleName = fileName;
      this.state.subtitleExt = ext;
      this.state.subtitleRawText = content;
      this.state.sourceCues = parseSubtitleContent(content, ext);

      this.state.translatedPath = '';
      this.state.translatedName = '';
      this.state.translatedRawText = '';
      this.state.translatedCues = [];
      this.state.progress = 0;
      this.state.progressMsg = '';
      this.state.currentLine = 0;
      this.state.totalLines = this.state.sourceCues.length;

      if (this.progressFill) this.progressFill.style.width = '0%';
      this.progressTrack?.setAttribute?.('aria-valuenow', '0');
      if (this.lblPct) this.lblPct.textContent = '0%';
      if (this.lblLines) this.lblLines.style.display = 'none';
      if (this.lblMsg) {
        this.lblMsg.removeAttribute?.('data-i18n');
        this.lblMsg.removeAttribute?.('title');
        this.lblMsg.title = '';
        this.lblMsg.textContent = '';
      }
      this.clearProgressMeta();
      this.setStatusBadge('translate.statusReady', '');

      this.updateSubtitleInfoUI();
      this.renderSourceCues();
      this.renderTargetCues();
      this.updateActionButtons();
      void this.detectCompanionVideo(filePath, loadId);
      return true;
    } catch (err: any) {
      if (
        loadToken !== this.activeLoadToken ||
        loadId !== this.subtitleLoadId ||
        this.state.isTranslating ||
        this.isStartingTranslation
      ) return false;
      console.error('Failed to load subtitle file:', err);
      this.clearLoadedSubtitle();
      const errMsg = err?.message || (typeof err === 'string' ? err : null) || t('translate.noSubSelectedError');
      this.notify(errMsg, 'error');
      return false;
    }
  }

  public clearLoadedSubtitle() {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    this.subtitleLoadId++;
    this.activeLoadToken++;
    this.companionProbeSeq++;
    this.companionProbeCompleted = false;
    this.state.subtitlePath = '';
    this.state.subtitleName = '';
    this.state.subtitleExt = '';
    this.state.subtitleRawText = '';
    this.state.sourceCues = [];
    this.state.translatedPath = '';
    this.state.translatedName = '';
    this.state.translatedRawText = '';
    this.state.translatedCues = [];
    this.state.companionVideoPath = null;
    this.state.progress = 0;
    this.state.progressMsg = '';
    this.state.currentLine = 0;
    this.state.totalLines = 0;

    if (this.progressFill) this.progressFill.style.width = '0%';
    this.progressTrack?.setAttribute?.('aria-valuenow', '0');
    if (this.lblPct) this.lblPct.textContent = '0%';
    if (this.lblLines) this.lblLines.style.display = 'none';
    if (this.lblMsg) {
      this.lblMsg.removeAttribute?.('data-i18n');
      this.lblMsg.removeAttribute?.('title');
      this.lblMsg.title = '';
      this.lblMsg.textContent = '';
    }
    this.clearProgressMeta();
    this.setStatusBadge('translate.statusReady', '');

    this.updateSubtitleInfoUI();
    this.renderSourceCues();
    this.renderTargetCues();
    this.updateActionButtons();
  }

  public setCompanionVideo(candidate: string) {
    this.companionProbeSeq++;
    this.companionProbeCompleted = true;
    this.state.companionVideoPath = candidate;
  }

  private async detectCompanionVideo(subtitlePath: string, loadId: number) {
    const probeSeq = ++this.companionProbeSeq;
    this.companionProbeCompleted = false;
    this.state.companionVideoPath = null;

    const lastDot = subtitlePath.lastIndexOf('.');
    if (lastDot <= 0) {
      this.companionProbeCompleted = true;
      return;
    }
    const baseStem = subtitlePath.substring(0, lastDot);

    // Also check if baseStem ends with a language code (e.g. movie.en or movie.fa) or translation suffix
    const cleanTranslationSuffix = (stem: string) => {
      return stem
        .replace(/([._ -]+(translated|translation|ترجمه شده|ترجمه))+$/i, '')
        .replace(/\.[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)?$/i, '')
        .replace(/([._ -]+(fa|en|ar|es|fr|de|ru|zh|ja|ko|it|pt|tr))+$/i, '')
        .trim();
    };

    const strippedStem = baseStem.replace(/\.[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)?$/, '');
    const candidateStems = new Set<string>();
    candidateStems.add(baseStem);
    if (strippedStem && strippedStem !== baseStem) {
      candidateStems.add(strippedStem);
    }
    const cleanedBase = cleanTranslationSuffix(baseStem);
    if (cleanedBase && cleanedBase !== baseStem) {
      candidateStems.add(cleanedBase);
    }
    const cleanedStripped = cleanTranslationSuffix(strippedStem);
    if (cleanedStripped && cleanedStripped !== strippedStem) {
      candidateStems.add(cleanedStripped);
    }

    const candidates: string[] = [];
    for (const stem of candidateStems) {
      for (const ext of SUPPORTED_VIDEO_EXTENSIONS) {
        candidates.push(`${stem}${ext}`);
      }
    }

    // Fallback: Check if there's an active media file in Transcription Studio that is a video
    const win = window as any;
    const activeMedia: string | null = (typeof win.getCurrentSourceMediaFile === 'function')
      ? win.getCurrentSourceMediaFile()
      : (win.selectedMediaFile || win.settingsState?.inputFile || null);

    if (activeMedia && typeof activeMedia === 'string') {
      const isVideoExt = SUPPORTED_VIDEO_EXTENSIONS.some(ext => activeMedia.toLowerCase().endsWith(ext));
      if (isVideoExt && !candidates.includes(activeMedia)) {
        candidates.push(activeMedia);
      }
    }

    if (candidates.length === 0) {
      this.companionProbeCompleted = true;
      return;
    }

    try {
      const found = await invoke<string | null>('find_existing_video_file', { candidates });
      if (loadId !== this.subtitleLoadId || probeSeq !== this.companionProbeSeq) return;
      if (typeof found === 'string' && found.trim().length > 0) {
        this.state.companionVideoPath = found;
      }
      this.companionProbeCompleted = true;
      return;
    } catch (_) {
      // Fallback for older backends/mocks without find_existing_video_file
    }

    for (const candidate of candidates) {
      if (loadId !== this.subtitleLoadId || probeSeq !== this.companionProbeSeq) return;
      try {
        const meta = await invoke<{ exists?: boolean } | null>('probe_media_file', { filePath: candidate });
        if (loadId !== this.subtitleLoadId || probeSeq !== this.companionProbeSeq) return;
        if (meta?.exists) {
          this.state.companionVideoPath = candidate;
          this.companionProbeCompleted = true;
          return;
        }
      } catch (_) {
        // probe error, continue searching
      }
    }
    if (loadId === this.subtitleLoadId && probeSeq === this.companionProbeSeq) {
      this.companionProbeCompleted = true;
    }
  }

  private updateSubtitleInfoUI() {
    if (!this.lblSubName || !this.lblSubPath || !this.lblSubMeta || !this.btnClearSub) return;

    if (this.state.subtitlePath) {
      // A subtitle's name is the user's own text, so it reads in its own direction
      // rather than the interface's: `دوبله فارسی.srt` keeps its name on the right and
      // its extension at the end of the reading order, and `movie.srt` keeps both on
      // the left. Only the line's *alignment* belongs to the interface — it is the
      // card's own side that names hug (see the `.has-file .translate-sub-name` rule).
      this.lblSubName.removeAttribute?.('data-i18n');
      this.lblSubName.textContent = this.state.subtitleName;
      applyContentDirection(this.lblSubName, this.state.subtitleName);
      this.lblSubName.title = isolateLtr(this.state.subtitlePath);
      this.lblSubPath.removeAttribute?.('data-i18n');
      this.lblSubPath.textContent = this.state.subtitlePath;
      this.lblSubPath.title = isolateLtr(this.state.subtitlePath);

      const cueCount = this.state.sourceCues.length;
      const localizedCueCount = formatLocalizedNumber(cueCount, getLanguage(), 0);
      const extUpper = this.state.subtitleExt.toUpperCase();
      // Format and cue count, each isolated in the direction it reads in.
      // Isolating each token keeps both whole and hands the ` • ` between them to
      // the interface, so the badge reads in the interface's own order in every
      // language and a Persian reader gets the count as `12 قطعه`, not `قطعه 12`.
      this.lblSubMeta.textContent = [
        isolateDirection(extUpper),
        isolateDirection(t('translate.cuesCount', { count: localizedCueCount })),
      ].join(' • ');
      this.lblSubMeta.style.display = 'inline-flex';

      this.btnClearSub.style.display = 'inline-flex';
      this.dropZone?.classList.add('has-file');
      // A tooltip is the browser's to render, and a path in a right-to-left interface
      // is what `isolateLtr` exists for — the same treatment the two titles above and
      // every other path tooltip in the app already get.
      this.dropZone?.removeAttribute?.('data-i18n-title');
      this.dropZone?.setAttribute('title', isolateLtr(this.state.subtitlePath));
    } else {
      // Back to the interface's own copy, and back to the interface's direction — a
      // `dir` left behind by the last file would outlive it.
      this.lblSubName.setAttribute?.('data-i18n', 'translate.noSubLoaded');
      this.lblSubName.textContent = t('translate.noSubLoaded');
      clearContentDirection(this.lblSubName);
      this.lblSubName.removeAttribute('title');
      this.lblSubPath.setAttribute?.('data-i18n', 'translate.dropSubPrompt');
      this.lblSubPath.textContent = t('translate.dropSubPrompt');
      this.lblSubPath.removeAttribute('title');
      this.lblSubMeta.style.display = 'none';
      this.btnClearSub.style.display = 'none';
      this.dropZone?.classList.remove('has-file');
      this.dropZone?.setAttribute('data-i18n-title', 'translate.dropSubPrompt');
      this.dropZone?.setAttribute('title', t('translate.dropSubPrompt'));
    }

    this.updateOutputDirUI();
  }

  private updateOutputDirUI() {
    if (!this.outputDirText || !this.btnResetDir) return;
    if (this.state.outputDir) {
      this.outputDirText.removeAttribute?.('data-i18n');
      this.outputDirText.textContent = this.state.outputDir;
      this.outputDirText.title = isolateLtr(this.state.outputDir);
      this.outputDirText.classList.add('has-custom-path');
      this.btnResetDir.style.display = 'inline-flex';
    } else {
      this.outputDirText.setAttribute?.('data-i18n', 'translate.sameAsSource');
      this.outputDirText.textContent = t('translate.sameAsSource');
      this.outputDirText.removeAttribute('title');
      this.outputDirText.classList.remove('has-custom-path');
      this.btnResetDir.style.display = 'none';
    }
  }

  public async browseOutputDir() {
    if (this.isBrowsingOutputDir || this.state.isTranslating || this.isStartingTranslation) return;
    this.isBrowsingOutputDir = true;
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected && !this.state.isTranslating && !this.isStartingTranslation) {
        this.state.outputDir = selected;
        this.updateOutputDirUI();
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    } finally {
      this.isBrowsingOutputDir = false;
    }
  }

  public syncFromGlobalSettings() {
    if (this.state.isTranslating || this.isStartingTranslation) {
      this.pendingSettingsSyncAfterTranslation = true;
      return;
    }
    const win = window as any;
    const settings = win.settingsState;
    if (!settings) return;

    if (settings.translateAiTargetLang) {
      this.state.targetLang = settings.translateAiTargetLang;
      if (this.targetLangSelect && this.targetLangSelect.value !== this.state.targetLang) {
        this.targetLangSelect.value = this.state.targetLang;
      }
    }

    if (typeof settings.translateAiPolish === 'boolean') {
      this.state.polishPass = settings.translateAiPolish;
      if (this.polishToggle) this.polishToggle.checked = this.state.polishPass;
    }

    this.refreshProviderOptions();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  public refreshProviderOptions() {
    if (!this.providerSelect) return;
    if (this.state.isTranslating || this.isStartingTranslation) {
      this.pendingSettingsSyncAfterTranslation = true;
      return;
    }
    const win = window as any;
    const settings = win.settingsState;
    if (!settings) return;

    let providers: any[] = [];
    try {
      providers = JSON.parse(settings.translateAiProviders || '[]');
    } catch (_) {
      providers = [];
    }

    this.providerSelect.innerHTML = '';
    if (providers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = t('translate.selectProvider');
      this.providerSelect.appendChild(opt);
      this.state.activeProvider = '';
      this.providerSelect.value = '';
      this.refreshModelOptions();
      return;
    }

    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      this.providerSelect?.appendChild(opt);
    });

    const configured = settings.translateAiProvider;
    const hasConfigured = Boolean(configured && providers.some(p => p.name === configured));
    const activeName = hasConfigured ? configured : (providers[0] ? providers[0].name : '');
    this.state.activeProvider = activeName;
    this.providerSelect.value = activeName;

    this.refreshModelOptions();
  }

  public refreshModelOptions() {
    if (!this.modelSelect) return;
    if (this.state.isTranslating || this.isStartingTranslation) {
      this.pendingSettingsSyncAfterTranslation = true;
      return;
    }
    const win = window as any;
    const settings = win.settingsState;
    if (!settings) return;

    let providers: any[] = [];
    try {
      providers = JSON.parse(settings.translateAiProviders || '[]');
    } catch (_) {
      providers = [];
    }

    const provider = providers.find(p => p.name === this.state.activeProvider);
    this.modelSelect.innerHTML = '';

    if (!provider || !provider.models || provider.models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = t('translate.noModelError');
      this.modelSelect.appendChild(opt);
      this.state.activeModel = '';
      this.modelSelect.value = '';
      this.updateActionButtons();
      if (typeof win.syncCustomSelects === 'function') {
        win.syncCustomSelects();
      }
      return;
    }

    const enabledModels = provider.models.filter((m: any) => m.enabled !== false);
    if (enabledModels.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = t('translate.noModelError');
      this.modelSelect.appendChild(opt);
      this.state.activeModel = '';
      this.modelSelect.value = '';
      this.updateActionButtons();
      if (typeof win.syncCustomSelects === 'function') {
        win.syncCustomSelects();
      }
      return;
    }

    enabledModels.forEach((m: any) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      this.modelSelect?.appendChild(opt);
    });

    const matchedModel = enabledModels.find((m: any) => isModelIdMatch(m.id, settings.translateAiModel));
    this.state.activeModel = matchedModel ? matchedModel.id : enabledModels[0].id;
    this.modelSelect.value = this.state.activeModel;

    this.updateActionButtons();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  private clearProgressMeta() {
    this.lastProgressPayload = null;
    this.lastProgressIsComplete = false;
    this.lastProgressIsCancelled = false;
    this.lastProgressIsFailed = false;
    this.lastPreflightError = '';
  }

  private setStatusBadge(key: string, modifier: '' | 'active' | 'complete' | 'cancelled' | 'failed' = '') {
    this.statusBadgeKey = key;
    this.statusBadgeModifier = modifier;
    if (!this.statusBadge) return;
    this.statusBadge.setAttribute?.('data-i18n', key);
    this.statusBadge.textContent = t(key);
    this.statusBadge.className = modifier ? `translate-status-badge ${modifier}` : 'translate-status-badge';
  }

  private restoreStatusBadge() {
    this.setStatusBadge(
      this.statusBadgeKey || 'translate.statusReady',
      (this.statusBadgeModifier || '') as '' | 'active' | 'complete' | 'cancelled' | 'failed'
    );
  }

  private formatDurationBadge(durSec: number): string {
    if (durSec <= 0) return '';
    const localizedSec = formatLocalizedNumber(durSec, getLanguage(), 0);
    const label = t('transcribe.durationSeconds', { seconds: localizedSec });
    return (!label || label === 'transcribe.durationSeconds') ? `${localizedSec}s` : label;
  }

  private formatCueAriaLabel(id: number, translated: boolean): string {
    const key = translated ? 'translate.translatedCueAriaLabel' : 'translate.cueAriaLabel';
    const label = t(key, { id: String(id) });
    if (!label || label === key) {
      return translated ? `Translated cue #${id}` : `Cue #${id}`;
    }
    return label;
  }

  private isTimedSubtitlePath(filePath: string): boolean {
    if (!filePath) return false;
    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0) return false;
    const ext = fileName.substring(lastDot + 1).toLowerCase();
    return ext === 'srt' || ext === 'vtt' || ext === 'lrc';
  }

  private renderCueList(listEl: HTMLElement, cues: SubtitleCue[], translated: boolean) {
    if (cues.length === 0) {
      listEl.removeAttribute?.('role');
      const emptyTitle = t(translated ? 'translate.emptyTargetTitle' : 'translate.emptySourceTitle');
      const emptyDesc = t(translated ? 'translate.emptyTargetDesc' : 'translate.emptySourceDesc');
      if (typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof listEl.appendChild === 'function') {
        const emptyPane = document.createElement('div');
        emptyPane.className = 'translate-empty-pane';
        emptyPane.innerHTML = translated
          ? `<svg class="translate-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`
          : `<svg class="translate-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
        const titleEl = document.createElement('div');
        titleEl.className = 'translate-empty-title';
        titleEl.textContent = emptyTitle;
        const descEl = document.createElement('div');
        descEl.className = 'translate-empty-desc';
        descEl.textContent = emptyDesc;
        emptyPane.appendChild(titleEl);
        emptyPane.appendChild(descEl);
        if (typeof listEl.replaceChildren === 'function') {
          listEl.replaceChildren(emptyPane);
        } else {
          listEl.innerHTML = '';
          listEl.appendChild(emptyPane);
        }
      } else {
        listEl.innerHTML = `
          <div class="translate-empty-pane">
            <svg class="translate-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              ${translated
                ? '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>'
                : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'}
            </svg>
            <div class="translate-empty-title">${escapeHTML(emptyTitle)}</div>
            <div class="translate-empty-desc">${escapeHTML(emptyDesc)}</div>
          </div>
        `;
      }
      return;
    }

    listEl.setAttribute?.('role', 'list');

    if (typeof document !== 'undefined' && typeof document.createElement === 'function' && typeof listEl.appendChild === 'function') {
      const container: Node = typeof document.createDocumentFragment === 'function'
        ? document.createDocumentFragment()
        : (() => {
            if (typeof listEl.replaceChildren === 'function') listEl.replaceChildren();
            else listEl.innerHTML = '';
            return listEl;
          })();

      for (let idx = 0; idx < cues.length; idx++) {
        const cue = cues[idx];
        const domKey = String(idx + 1);
        const durSec = (cue.endTimeStr && cue.endMs > cue.startMs)
          ? Math.max(0, Math.round((cue.endMs - cue.startMs) / 1000))
          : 0;
        const durLabel = this.formatDurationBadge(durSec);
        const cueAriaLabel = this.formatCueAriaLabel(cue.id, translated);

        const item = document.createElement('div');
        item.className = translated ? 'translate-cue-item translate-cue-translated' : 'translate-cue-item';
        item.dataset.id = domKey;
        item.id = `${translated ? 'translate-target-cue' : 'translate-source-cue'}-${domKey}`;
        item.setAttribute('role', 'listitem');
        item.tabIndex = 0;
        item.setAttribute('aria-label', cueAriaLabel);

        const header = document.createElement('div');
        header.className = 'translate-cue-header';

        const badgeWrap = document.createElement('div');
        badgeWrap.className = 'translate-cue-badge-wrap';
        const numEl = document.createElement('span');
        numEl.className = 'translate-cue-num';
        numEl.textContent = `#${cue.id}`;
        badgeWrap.appendChild(numEl);
        if (durLabel) {
          const durEl = document.createElement('span');
          durEl.className = 'translate-cue-dur';
          durEl.textContent = durLabel;
          badgeWrap.appendChild(durEl);
        }
        header.appendChild(badgeWrap);

        if (cue.startTimeStr) {
          const timeEl = document.createElement('span');
          timeEl.className = 'translate-cue-time';
          timeEl.setAttribute('dir', 'ltr');
          timeEl.textContent = cue.endTimeStr ? `${cue.startTimeStr} ➔ ${cue.endTimeStr}` : cue.startTimeStr;
          header.appendChild(timeEl);
        }

        const textEl = document.createElement('div');
        textEl.className = translated ? 'translate-cue-text translate-cue-text-target' : 'translate-cue-text';
        textEl.textContent = cue.text;
        applyContentDirection(textEl, cue.text);

        item.appendChild(header);
        item.appendChild(textEl);
        container.appendChild(item);
      }

      if (container !== listEl) {
        if (typeof listEl.replaceChildren === 'function') {
          listEl.replaceChildren(container);
        } else {
          listEl.innerHTML = '';
          listEl.appendChild(container);
        }
      }
      return;
    }

    const html = cues.map((cue, idx) => {
      const domKey = String(idx + 1);
      const durSec = (cue.endTimeStr && cue.endMs > cue.startMs)
        ? Math.max(0, Math.round((cue.endMs - cue.startMs) / 1000))
        : 0;
      const durLabel = this.formatDurationBadge(durSec);
      const cueAriaLabel = this.formatCueAriaLabel(cue.id, translated);
      const itemCls = translated ? 'translate-cue-item translate-cue-translated' : 'translate-cue-item';
      const idPrefix = translated ? 'translate-target-cue' : 'translate-source-cue';
      const textCls = translated ? 'translate-cue-text translate-cue-text-target' : 'translate-cue-text';
      return `
      <div class="${itemCls}" data-id="${domKey}" id="${idPrefix}-${domKey}" role="listitem" tabindex="0" aria-label="${escapeHTML(cueAriaLabel)}">
        <div class="translate-cue-header">
          <div class="translate-cue-badge-wrap">
            <span class="translate-cue-num">#${cue.id}</span>
            ${durLabel ? `<span class="translate-cue-dur">${escapeHTML(durLabel)}</span>` : ''}
          </div>
          ${cue.startTimeStr ? `<span class="translate-cue-time" dir="ltr">${escapeHTML(cue.startTimeStr)}${cue.endTimeStr ? ` ➔ ${escapeHTML(cue.endTimeStr)}` : ''}</span>` : ''}
        </div>
        <div class="${textCls}" ${directionAttributes(cue.text)}>${escapeHTML(cue.text)}</div>
      </div>
    `;
    }).join('');

    listEl.innerHTML = html;
  }

  private renderSourceCues() {
    if (!this.sourceList || !this.sourceCountBadge) return;
    this.sourceCountBadge.textContent = String(this.state.sourceCues.length);
    this.renderCueList(this.sourceList, this.state.sourceCues, false);
  }

  private renderTargetCues() {
    if (!this.targetList || !this.targetCountBadge) return;
    this.targetCountBadge.textContent = String(this.state.translatedCues.length);
    this.renderCueList(this.targetList, this.state.translatedCues, true);
  }

  private updateActionButtons() {
    const hasSub = !!this.state.subtitlePath;
    const isTranslating = this.state.isTranslating;
    const isBusy = isTranslating || this.isStartingTranslation;

    if (this.btnStart) {
      this.btnStart.disabled = !hasSub || isBusy || !this.state.activeModel;
      if (!hasSub) {
        this.btnStart.title = t('translate.noSubSelectedError');
        this.btnStart.setAttribute?.('data-i18n-title', 'translate.noSubSelectedError');
      } else if (!this.state.activeModel) {
        this.btnStart.title = t('translate.noModelError');
        this.btnStart.setAttribute?.('data-i18n-title', 'translate.noModelError');
      } else if (isBusy) {
        this.btnStart.title = t('translate.translating');
        this.btnStart.setAttribute?.('data-i18n-title', 'translate.translating');
      } else {
        this.btnStart.title = t('translate.startTranslate');
        this.btnStart.setAttribute?.('data-i18n-title', 'translate.startTranslate');
      }
    }
    if (this.btnStartText) {
      const startKey = isBusy ? 'translate.translating' : 'translate.startTranslate';
      this.btnStartText.setAttribute?.('data-i18n', startKey);
      this.btnStartText.textContent = t(startKey);
    }
    if (this.btnBrowseSub) this.btnBrowseSub.disabled = isBusy;
    if (this.btnClearSub) this.btnClearSub.disabled = isBusy;
    if (this.btnBrowseDir) this.btnBrowseDir.disabled = isBusy;
    if (this.btnResetDir) this.btnResetDir.disabled = isBusy;
    if (this.targetLangSelect) this.targetLangSelect.disabled = isBusy;
    if (this.providerSelect) this.providerSelect.disabled = isBusy;
    if (this.modelSelect) this.modelSelect.disabled = isBusy;
    if (this.polishToggle) this.polishToggle.disabled = isBusy;
    if (this.btnCancel) {
      this.btnCancel.style.display = isTranslating ? 'inline-flex' : 'none';
      this.btnCancel.disabled = isTranslating ? this.isCancellingTranslation : false;
    }
    if (this.telemetryBox) {
      this.telemetryBox.style.display = (isTranslating || this.state.progress > 0 || this.lastProgressIsComplete || this.lastProgressIsCancelled || this.lastProgressIsFailed) ? 'block' : 'none';
    }

    const hasTranslatedFile = !isBusy && !!this.state.translatedPath;
    const hasTranslation = hasTranslatedFile && this.state.translatedCues.length > 0;
    const hasTimedTranslation = hasTranslation && this.isTimedSubtitlePath(this.state.translatedPath);
    if (this.btnCopy) {
      this.btnCopy.disabled = !hasTranslation;
      this.btnCopy.title = hasTranslation ? t('translate.copyTranslation') : t('translate.emptyTargetTitle');
      this.btnCopy.setAttribute?.('data-i18n-title', hasTranslation ? 'translate.copyTranslation' : 'translate.emptyTargetTitle');
    }
    if (this.btnOpenFolder) {
      this.btnOpenFolder.disabled = !hasTranslatedFile;
      this.btnOpenFolder.title = hasTranslatedFile ? t('translate.openOutputFolder') : t('translate.emptyTargetTitle');
      this.btnOpenFolder.setAttribute?.('data-i18n-title', hasTranslatedFile ? 'translate.openOutputFolder' : 'translate.emptyTargetTitle');
    }
    if (this.btnSendToHardsub) {
      this.btnSendToHardsub.disabled = !hasTimedTranslation;
      const hardsubTitleKey = !hasTranslation
        ? 'translate.emptyTargetTitle'
        : (hasTimedTranslation ? 'translate.sendToHardsub' : 'transcribe.hardsubRequiresTimedSub');
      this.btnSendToHardsub.title = t(hardsubTitleKey);
      this.btnSendToHardsub.setAttribute?.('data-i18n-title', hardsubTitleKey);
    }
  }

  private listenToProgressEvents() {
    this.registerAsyncUnlisten(listen<any>('translation-status', (event) => {
      const payload = event.payload;
      if (!payload) return;

      const progressVal = typeof payload.progress === 'number' ? payload.progress : 0;
      this.state.progress = progressVal;
      this.state.progressMsg = payload.message || '';

      if (typeof payload.currentLine === 'number') {
        this.state.currentLine = payload.currentLine;
      }
      if (typeof payload.totalLines === 'number' && payload.totalLines > 0) {
        this.state.totalLines = payload.totalLines;
      } else if (!this.state.totalLines && this.state.sourceCues.length > 0) {
        this.state.totalLines = this.state.sourceCues.length;
      }

      const pct = Math.min(100, Math.max(0, Math.round(progressVal * 100)));

      const rawMsg = typeof payload.message === 'string' ? payload.message : '';
      // When translation is complete or progress reached 100%, line counter should display full completion (e.g. 12 / 12)
      const isCancelled = rawMsg === 'Translation cancelled';
      const isFailed = rawMsg === 'Translation failed';
      const isEmpty = rawMsg === 'Nothing to translate';
      const isComplete = !isCancelled && !isFailed && !isEmpty && (rawMsg === 'AI translation complete' || (!payload.active && (progressVal >= 1.0 || pct >= 100)));
      const preserveDetailedError =
        (isFailed || isEmpty) &&
        (Boolean(this.lastPreflightError) || (isEmpty && this.lastProgressIsFailed));

      if (isEmpty && !preserveDetailedError) {
        this.state.progress = 0;
        this.state.currentLine = 0;
      } else if (isComplete && this.state.totalLines > 0) {
        this.state.currentLine = this.state.totalLines;
      } else if (this.state.totalLines > 0 && this.state.currentLine > this.state.totalLines) {
        this.state.currentLine = this.state.totalLines;
      }

      const displayPct = isEmpty ? 0 : pct;

      if (!preserveDetailedError) {
        this.lastProgressPayload = payload;
        this.lastProgressIsComplete = isComplete;
        this.lastProgressIsCancelled = isCancelled;
        this.lastProgressIsFailed = isFailed;
        this.lastPreflightError = '';
      } else {
        this.lastProgressPayload = null;
      }

      if (this.telemetryBox) {
        this.telemetryBox.style.display = (payload.active || this.state.progress > 0 || isComplete || isCancelled || isFailed || isEmpty || preserveDetailedError) ? 'block' : 'none';
      }

      if (!preserveDetailedError) {
        if (this.progressFill) {
          this.progressFill.style.width = `${displayPct}%`;
        }
        this.progressTrack?.setAttribute?.('aria-valuenow', String(displayPct));
        if (this.lblPct) {
          this.lblPct.textContent = `${displayPct}%`;
        }
      }
      if (this.lblLines && !preserveDetailedError) {
        if (this.state.totalLines > 0) {
          this.lblLines.textContent = `${this.state.currentLine} / ${this.state.totalLines}`;
          this.lblLines.style.display = 'inline';
        } else {
          this.lblLines.style.display = 'none';
        }
      }
      if (this.lblMsg && rawMsg && !preserveDetailedError) {
        this.lblMsg.removeAttribute?.('data-i18n');
        this.lblMsg.removeAttribute?.('title');
        this.lblMsg.title = '';
        this.lblMsg.textContent = this.formatProgressMessage(payload, isComplete, isCancelled, isFailed);
      }
      if (this.statusBadge && !preserveDetailedError) {
        if (payload.active) {
          this.setStatusBadge('translate.statusTranslating', 'active');
        } else if (isCancelled) {
          this.setStatusBadge('translate.statusCancelled', 'cancelled');
        } else if (isFailed) {
          this.setStatusBadge('translate.statusFailed', 'failed');
        } else if (isEmpty) {
          this.setStatusBadge('translate.statusReady', '');
        } else if (rawMsg === 'AI translation complete' || isComplete) {
          this.setStatusBadge('translate.statusComplete', 'complete');
        }
      }
    }));

    this.registerAsyncUnlisten(listen<{ translateAiProviders?: string }>('translation-model-limits-updated', (event) => {
      const updatedProviders = event?.payload?.translateAiProviders;
      if (typeof updatedProviders !== 'string' || !updatedProviders) return;
      const win = window as any;
      if (win?.settingsState) {
        win.settingsState.translateAiProviders = updatedProviders;
        if (typeof win.syncProviderModelsFromSettings === 'function') {
          win.syncProviderModelsFromSettings();
        }
      }
    }));
  }

  public async startTranslation() {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    if (!this.state.subtitlePath) {
      this.notify(t('translate.noSubSelectedError'), 'error');
      return;
    }
    if (!this.state.activeModel) {
      this.notify(t('translate.noModelError'), 'error');
      return;
    }

    this.activeLoadToken++;
    this.isStartingTranslation = true;
    this.updateActionButtons();
    let globalSettings: any;
    try {
      const win = window as any;
      const hadProviderListBeforeFlush = (() => {
        try {
          const raw = win.settingsState?.translateAiProviders;
          if (typeof raw !== 'string' || !raw.trim()) return false;
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) && parsed.length > 0;
        } catch (_) {
          return false;
        }
      })();
      if (typeof win.flushPendingModelCatalogChanges === 'function') {
        win.flushPendingModelCatalogChanges();
      }
      if (typeof win.flushPendingProviderGeneralChanges === 'function') {
        await win.flushPendingProviderGeneralChanges();
      }
      globalSettings = win.settingsState;
      if (!globalSettings) {
        try {
          globalSettings = await invoke('load_settings');
          win.settingsState = globalSettings;
        } catch (_) {
          globalSettings = {};
        }
      }
      if (typeof globalSettings?.translateAiProviders === 'string' && globalSettings.translateAiProviders.trim().length > 0) {
        let flushedProviders: any[] = [];
        let parsedValid = false;
        try {
          const parsed = JSON.parse(globalSettings.translateAiProviders);
          if (Array.isArray(parsed)) {
            flushedProviders = parsed;
            parsedValid = true;
          }
        } catch (_) {
          parsedValid = false;
        }
        if (parsedValid) {
          if (flushedProviders.length > 0) {
            const resolvedProvider =
              flushedProviders.find((p: any) => p?.name === this.state.activeProvider) ||
              flushedProviders.find((p: any) => p?.name === globalSettings.translateAiProvider) ||
              flushedProviders[0];
            if (resolvedProvider && typeof resolvedProvider.name === 'string') {
              this.state.activeProvider = resolvedProvider.name;
              if (this.providerSelect) {
                this.providerSelect.value = this.state.activeProvider;
              }
            }
            const enabledModels = Array.isArray(resolvedProvider?.models)
              ? resolvedProvider.models.filter((m: any) => m && m.enabled !== false && typeof m.id === 'string' && m.id.trim().length > 0)
              : [];
            if (enabledModels.length === 0) {
              this.state.activeModel = '';
              if (this.modelSelect) {
                this.modelSelect.value = '';
              }
              this.notify(t('translate.noModelError'), 'error');
              return;
            }
            const matchedCurrent = enabledModels.find((m: any) => isModelIdMatch(m.id, this.state.activeModel));
            if (matchedCurrent) {
              this.state.activeModel = matchedCurrent.id;
            } else {
              const matchedGlobal = enabledModels.find((m: any) => isModelIdMatch(m.id, globalSettings.translateAiModel));
              const nextModel = matchedGlobal || enabledModels[0];
              this.state.activeModel = nextModel.id;
              if (this.modelSelect) {
                this.modelSelect.value = this.state.activeModel;
              }
              globalSettings.translateAiModel = this.state.activeModel;
            }
          } else if (hadProviderListBeforeFlush) {
            this.state.activeProvider = '';
            this.state.activeModel = '';
            if (this.providerSelect) this.providerSelect.value = '';
            if (this.modelSelect) this.modelSelect.value = '';
            this.notify(t('translate.noModelError'), 'error');
            return;
          }
        }
      }
      this.isCancellingTranslation = false;
      this.state.isTranslating = true;
    } catch (prepErr: any) {
      console.error('Failed to prepare translation settings:', prepErr);
      const errMsg = prepErr?.message || String(prepErr || '');
      this.notify(t('translate.translationError', { error: errMsg }), 'error');
      return;
    } finally {
      this.isStartingTranslation = false;
      if (!this.state.isTranslating) {
        if (this.pendingSettingsSyncAfterTranslation) {
          this.pendingSettingsSyncAfterTranslation = false;
          this.syncFromGlobalSettings();
        }
        this.updateActionButtons();
      }
    }

    const parentDir = getParentDir(this.state.subtitlePath);
    const fileName = this.state.subtitleName;

    const runSettings = {
      ...globalSettings,
      translateAiEnabled: true,
      translateAiTargetLang: this.state.targetLang,
      translateAiProvider: this.state.activeProvider,
      translateAiModel: this.state.activeModel,
      translateAiPolish: this.state.polishPass,
    };

    const prevTranslation = {
      translatedPath: this.state.translatedPath,
      translatedName: this.state.translatedName,
      translatedRawText: this.state.translatedRawText,
      translatedCues: this.state.translatedCues,
      progress: this.state.progress,
      progressMsg: this.state.progressMsg,
      currentLine: this.state.currentLine,
      totalLines: this.state.totalLines,
      statusBadgeKey: this.statusBadgeKey,
      statusBadgeModifier: this.statusBadgeModifier,
      lastProgressPayload: this.lastProgressPayload,
      lastProgressIsComplete: this.lastProgressIsComplete,
      lastProgressIsCancelled: this.lastProgressIsCancelled,
      lastProgressIsFailed: this.lastProgressIsFailed,
      lastPreflightError: this.lastPreflightError,
      lblMsgText: this.lblMsg?.textContent || '',
      lblMsgI18n: this.lblMsg?.getAttribute?.('data-i18n') || '',
      lblMsgTitle: this.lblMsg?.title || '',
    };

    this.state.progress = 0;
    this.state.currentLine = 0;
    this.state.translatedPath = '';
    this.state.translatedName = '';
    this.state.translatedRawText = '';
    this.state.translatedCues = [];
    this.clearProgressMeta();
    this.renderTargetCues();

    if (!this.state.totalLines && this.state.sourceCues.length > 0) {
      this.state.totalLines = this.state.sourceCues.length;
    }
    if (this.progressFill) this.progressFill.style.width = '0%';
    this.progressTrack?.setAttribute?.('aria-valuenow', '0');
    if (this.lblPct) this.lblPct.textContent = '0%';
    if (this.lblLines && this.state.totalLines > 0) {
      this.lblLines.textContent = `0 / ${this.state.totalLines}`;
      this.lblLines.style.display = 'inline';
    }
    if (this.lblMsg) {
      this.lblMsg.removeAttribute?.('data-i18n');
      this.lblMsg.removeAttribute?.('title');
      this.lblMsg.title = '';
      this.lblMsg.textContent = '';
    }
    this.updateActionButtons();
    this.setStatusBadge('translate.statusTranslating', 'active');

    try {
      const trimmedOutputDir = this.state.outputDir ? this.state.outputDir.trim() : '';
      const translatedFiles = await invoke<string[]>('translate_transcription_files', {
        settings: runSettings,
        generatedFiles: [fileName],
        parentDir: parentDir,
        outputDir: trimmedOutputDir || null,
      });

      if (translatedFiles && translatedFiles.length > 0) {
        const outName = translatedFiles[0];
        const effectiveDir = trimmedOutputDir || parentDir;
        const outPath = joinPath(effectiveDir, outName);

        const transContent = await invoke<string>('read_text_file_content', { filePath: outPath });
        this.state.translatedPath = outPath;
        this.state.translatedName = outName;
        this.state.translatedRawText = transContent;
        const outExt = outName.split('.').pop()?.toLowerCase() || this.state.subtitleExt;
        this.state.translatedCues = parseSubtitleContent(transContent, outExt);

        this.renderTargetCues();

        this.state.progress = 1.0;
        if (!this.state.totalLines && this.state.sourceCues.length > 0) {
          this.state.totalLines = this.state.sourceCues.length;
        }
        if (this.state.totalLines > 0) {
          this.state.currentLine = this.state.totalLines;
        }
        if (this.progressFill) this.progressFill.style.width = '100%';
        this.progressTrack?.setAttribute?.('aria-valuenow', '100');
        if (this.lblPct) this.lblPct.textContent = '100%';
        if (this.lblLines && this.state.totalLines > 0) {
          this.lblLines.textContent = `${this.state.currentLine} / ${this.state.totalLines}`;
          this.lblLines.style.display = 'inline';
        }

        this.setStatusBadge('translate.statusComplete', 'complete');

        this.notify(t('translate.translationSuccess'), 'success');
      } else {
        this.state.progress = 0;
        this.state.currentLine = 0;
        this.clearProgressMeta();
        this.lastProgressPayload = null;
        this.lastProgressIsComplete = false;
        this.lastProgressIsCancelled = false;
        this.lastProgressIsFailed = true;
        this.lastPreflightError = '';
        if (this.progressFill) this.progressFill.style.width = '0%';
        this.progressTrack?.setAttribute?.('aria-valuenow', '0');
        if (this.lblPct) this.lblPct.textContent = '0%';
        if (this.lblMsg) {
          this.lblMsg.removeAttribute?.('title');
          this.lblMsg.title = '';
          this.lblMsg.setAttribute?.('data-i18n', 'translate.emptyTranslationError');
          this.lblMsg.textContent = t('translate.emptyTranslationError');
        }
        this.setStatusBadge('translate.statusFailed', 'failed');
        this.notify(t('translate.emptyTranslationError'), 'error');
      }
    } catch (err: any) {
      const errMsg = String(err || '');
      const isBusySession = errMsg.toLowerCase().includes('already active');
      if (isBusySession) {
        if (prevTranslation.translatedPath) {
          this.state.translatedPath = prevTranslation.translatedPath;
          this.state.translatedName = prevTranslation.translatedName;
          this.state.translatedRawText = prevTranslation.translatedRawText;
          this.state.translatedCues = prevTranslation.translatedCues;
          this.renderTargetCues();
        }
        this.state.progress = prevTranslation.progress;
        this.state.progressMsg = prevTranslation.progressMsg;
        this.state.currentLine = prevTranslation.currentLine;
        this.state.totalLines = prevTranslation.totalLines;
        this.lastProgressPayload = prevTranslation.lastProgressPayload;
        this.lastProgressIsComplete = prevTranslation.lastProgressIsComplete;
        this.lastProgressIsCancelled = prevTranslation.lastProgressIsCancelled;
        this.lastProgressIsFailed = prevTranslation.lastProgressIsFailed;
        this.lastPreflightError = prevTranslation.lastPreflightError;

        const restoredPct = Math.min(100, Math.max(0, Math.round((prevTranslation.progress || 0) * 100)));
        if (this.progressFill) this.progressFill.style.width = `${restoredPct}%`;
        this.progressTrack?.setAttribute?.('aria-valuenow', String(restoredPct));
        if (this.lblPct) this.lblPct.textContent = `${restoredPct}%`;
        if (this.lblLines) {
          if (prevTranslation.totalLines > 0 && (prevTranslation.progress > 0 || prevTranslation.lastProgressIsComplete || prevTranslation.lastProgressIsCancelled || prevTranslation.lastProgressIsFailed)) {
            this.lblLines.textContent = `${prevTranslation.currentLine} / ${prevTranslation.totalLines}`;
            this.lblLines.style.display = 'inline';
          } else {
            this.lblLines.style.display = 'none';
          }
        }
        if (this.lblMsg) {
          if (prevTranslation.lblMsgI18n) {
            this.lblMsg.setAttribute?.('data-i18n', prevTranslation.lblMsgI18n);
          } else {
            this.lblMsg.removeAttribute?.('data-i18n');
          }
          if (prevTranslation.lblMsgTitle) {
            this.lblMsg.title = prevTranslation.lblMsgTitle;
          } else {
            this.lblMsg.removeAttribute?.('title');
            this.lblMsg.title = '';
          }
          this.lblMsg.textContent = prevTranslation.lblMsgText;
        }
        this.setStatusBadge(
          prevTranslation.statusBadgeKey || 'translate.statusReady',
          (prevTranslation.statusBadgeModifier || '') as '' | 'active' | 'complete' | 'cancelled' | 'failed'
        );
        this.notify(t('translate.translationError', { error: errMsg }), 'error');
      } else if (
        this.isCancellingTranslation ||
        this.lastProgressIsCancelled ||
        errMsg.toLowerCase() === 'translation cancelled by user' ||
        errMsg.toLowerCase().includes('translation cancelled')
      ) {
        this.lastProgressIsComplete = false;
        this.lastProgressIsFailed = false;
        this.lastProgressIsCancelled = true;
        this.lastPreflightError = '';
        if (this.lblMsg) {
          this.lblMsg.removeAttribute?.('data-i18n');
          this.lblMsg.removeAttribute?.('title');
          this.lblMsg.title = '';
          this.lblMsg.textContent = t('translate.statusCancelled');
        }
        this.setStatusBadge('translate.statusCancelled', 'cancelled');
        this.notify(t('translate.translationCancelledToast'), 'info');
      } else {
        this.lastProgressIsComplete = false;
        this.lastProgressIsCancelled = false;
        this.lastProgressIsFailed = true;
        this.lastProgressPayload = null;
        this.lastPreflightError = errMsg;
        if (this.lblMsg) {
          this.lblMsg.removeAttribute?.('data-i18n');
          const detail = errMsg.trim() || t('translate.statusFailed');
          this.lblMsg.textContent = isolateDirection(detail);
          this.lblMsg.title = detail;
        }
        this.setStatusBadge('translate.statusFailed', 'failed');
        this.notify(t('translate.translationError', { error: errMsg }), 'error');
      }
    } finally {
      this.isCancellingTranslation = false;
      this.state.isTranslating = false;
      if (this.pendingSettingsSyncAfterTranslation) {
        this.pendingSettingsSyncAfterTranslation = false;
        this.syncFromGlobalSettings();
      }
      this.updateActionButtons();
    }
  }

  public async cancelTranslation() {
    if (!this.state.isTranslating) return;
    this.isCancellingTranslation = true;
    if (this.btnCancel) {
      this.btnCancel.disabled = true;
    }

    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await invoke('cancel_transcription');
        return;
      } catch (err) {
        const errLower = String(err || '').toLowerCase();
        const isNotYetActive = errLower.includes('no active transcription or translation session');
        if (isNotYetActive && attempt < maxAttempts - 1 && this.state.isTranslating && !this.isDisposed) {
          await new Promise(resolve => setTimeout(resolve, 60));
          continue;
        }
        this.isCancellingTranslation = false;
        console.error('Failed to cancel translation:', err);
        if (this.state.isTranslating && !this.isDisposed) {
          if (this.btnCancel) this.btnCancel.disabled = false;
          this.notify(t('translate.translationError', { error: String(err) }), 'error');
        }
        return;
      }
    }
  }

  private formatProgressMessage(payload: any, isComplete: boolean, isCancelled: boolean, isFailed = false): string {
    const raw = payload.message || '';
    if (isCancelled || raw === 'Translation cancelled') {
      return t('translate.statusCancelled');
    }
    if (isFailed || raw === 'Translation failed') {
      return t('translate.statusFailed');
    }
    if (raw.includes('could not be translated')) {
      const countMatch = raw.match(/^(\d+)/);
      return t('translate.untranslatedNotice', { count: countMatch ? countMatch[1] : '1' });
    }
    if (raw === 'Nothing to translate') {
      return t('translate.emptyTargetTitle');
    }
    if (isComplete || raw === 'AI translation complete') {
      return t('translate.translationSuccess');
    }
    if (raw.startsWith('Translating with AI')) {
      return t('translate.translating');
    }
    if (raw.startsWith('Resuming translation')) {
      const cur = this.state.currentLine;
      const tot = this.state.totalLines;
      const fileName = this.state.subtitleName || '';
      if (payload.totalFiles && payload.totalFiles > 1 && payload.fileIndex) {
        return t('translate.resumingBatchLines', {
          fileIdx: String(payload.fileIndex),
          totalFiles: String(payload.totalFiles),
          current: String(cur),
          total: String(tot),
          file: fileName
        });
      }
      if (tot > 0) {
        return t('translate.resumingLines', {
          current: String(cur),
          total: String(tot),
          file: fileName
        });
      }
      return t('translate.translating');
    }
    if (raw.startsWith('Translating AI')) {
      const match = raw.match(/\((.*?)\)$/);
      const fileName = match ? match[1] : (this.state.subtitleName || '');
      const cur = this.state.currentLine;
      const tot = this.state.totalLines;
      if (payload.totalFiles && payload.totalFiles > 1 && payload.fileIndex) {
        return t('translate.progressBatchLines', {
          fileIdx: String(payload.fileIndex),
          totalFiles: String(payload.totalFiles),
          current: String(cur),
          total: String(tot),
          file: fileName
        });
      }
      if (tot > 0) {
        return t('translate.progressLines', {
          current: String(cur),
          total: String(tot),
          file: fileName
        });
      }
      return t('translate.translating');
    }
    return isolateDirection(raw);
  }

  public async copyTranslatedText() {
    if (!this.state.translatedPath || (!this.state.translatedRawText && this.state.translatedCues.length === 0)) return;
    const textToCopy = this.state.translatedCues.length > 0
      ? this.state.translatedCues.map(c => c.text).join('\n')
      : this.state.translatedRawText;
    try {
      await copyToClipboard(textToCopy);
      this.notify(t('translate.copiedTranslation'), 'success');
    } catch (err: any) {
      console.error('Failed to copy to clipboard:', err);
      this.notify(err?.message || String(err), 'error');
    }
  }

  public async openOutputFolder() {
    if (!this.state.translatedPath) return;
    const target = this.state.translatedPath;
    try {
      const win = window as any;
      if (typeof win.showInFolder === 'function') {
        await win.showInFolder(target);
        return;
      }
      await invoke('show_in_folder', { filePath: target });
    } catch (err) {
      try {
        const win = window as any;
        const targetFolder = getParentDir(target) || target;
        if (typeof win.openFileInEditor === 'function') {
          await win.openFileInEditor(targetFolder);
          return;
        }
        await invoke('open_file_in_editor', { filePath: targetFolder });
        return;
      } catch (fallbackErr) {
        console.error('Failed to open folder fallback:', fallbackErr);
      }
      console.error('Failed to open folder:', err);
      this.notify(t('toasts.openFolderError', { error: String(err) }) || String(err), 'error');
    }
  }

  public setViewMode(mode: 'split' | 'source' | 'target') {
    this.state.viewMode = mode;
    [this.btnViewSplit, this.btnViewSource, this.btnViewTarget].forEach(btn => btn?.classList.remove('active'));

    if (mode === 'split') this.btnViewSplit?.classList.add('active');
    else if (mode === 'source') this.btnViewSource?.classList.add('active');
    else if (mode === 'target') this.btnViewTarget?.classList.add('active');

    this.btnViewSplit?.setAttribute?.('aria-selected', String(mode === 'split'));
    this.btnViewSource?.setAttribute?.('aria-selected', String(mode === 'source'));
    this.btnViewTarget?.setAttribute?.('aria-selected', String(mode === 'target'));

    this.btnViewSplit?.setAttribute?.('tabindex', mode === 'split' ? '0' : '-1');
    this.btnViewSource?.setAttribute?.('tabindex', mode === 'source' ? '0' : '-1');
    this.btnViewTarget?.setAttribute?.('tabindex', mode === 'target' ? '0' : '-1');

    if (this.previewGrid && this.sourcePane && this.targetPane) {
      if (mode === 'split') {
        this.previewGrid.classList.remove('view-source-only', 'view-target-only');
        this.previewGrid.setAttribute?.('role', 'tabpanel');
        this.previewGrid.setAttribute?.('aria-labelledby', 'btn-view-split');
        this.sourcePane.removeAttribute?.('role');
        this.sourcePane.removeAttribute?.('aria-labelledby');
        this.targetPane.removeAttribute?.('role');
        this.targetPane.removeAttribute?.('aria-labelledby');
        this.sourcePane.style.display = 'flex';
        this.targetPane.style.display = 'flex';
      } else if (mode === 'source') {
        this.previewGrid.classList.add('view-source-only');
        this.previewGrid.classList.remove('view-target-only');
        this.previewGrid.removeAttribute?.('role');
        this.previewGrid.removeAttribute?.('aria-labelledby');
        this.sourcePane.setAttribute?.('role', 'tabpanel');
        this.sourcePane.setAttribute?.('aria-labelledby', 'btn-view-source');
        this.targetPane.removeAttribute?.('role');
        this.targetPane.removeAttribute?.('aria-labelledby');
        this.sourcePane.style.display = 'flex';
        this.targetPane.style.display = 'none';
      } else if (mode === 'target') {
        this.previewGrid.classList.add('view-target-only');
        this.previewGrid.classList.remove('view-source-only');
        this.previewGrid.removeAttribute?.('role');
        this.previewGrid.removeAttribute?.('aria-labelledby');
        this.targetPane.setAttribute?.('role', 'tabpanel');
        this.targetPane.setAttribute?.('aria-labelledby', 'btn-view-target');
        this.sourcePane.removeAttribute?.('role');
        this.sourcePane.removeAttribute?.('aria-labelledby');
        this.sourcePane.style.display = 'none';
        this.targetPane.style.display = 'flex';
      }
    }

    this.updateActionButtons();
  }

  public sendToHardsubStudio() {
    const subToLoad = this.state.translatedPath;
    if (!subToLoad) {
      this.notify(t('translate.emptyTargetTitle'), 'error');
      return;
    }
    if (!this.isTimedSubtitlePath(subToLoad)) {
      this.notify(t('transcribe.hardsubRequiresTimedSub'), 'error');
      return;
    }

    let videoToLoad = this.state.companionVideoPath || '';
    if (!videoToLoad && !this.companionProbeCompleted) {
      const win = window as any;
      const activeMedia: string | null = (typeof win.getCurrentSourceMediaFile === 'function')
        ? win.getCurrentSourceMediaFile()
        : (win.selectedMediaFile || win.settingsState?.inputFile || null);

      if (activeMedia && typeof activeMedia === 'string') {
        if (SUPPORTED_VIDEO_EXTENSIONS.some(ext => activeMedia.toLowerCase().endsWith(ext))) {
          videoToLoad = activeMedia;
        }
      }
    }

    if (hardsubController && typeof hardsubController.prefillFilePaths === 'function') {
      hardsubController.prefillFilePaths(videoToLoad, subToLoad);
    }

    const win = window as any;
    if (typeof win.switchView === 'function') {
      win.switchView('hardsub');
    }
  }

  public refreshLocalization() {
    this.updateSubtitleInfoUI();
    this.renderSourceCues();
    this.renderTargetCues();
    this.updateActionButtons();
    this.restoreStatusBadge();
    if (this.lblMsg) {
      if (this.lastProgressPayload) {
        this.lblMsg.textContent = this.formatProgressMessage(
          this.lastProgressPayload,
          this.lastProgressIsComplete,
          this.lastProgressIsCancelled,
          this.lastProgressIsFailed
        );
      } else if (this.lastPreflightError) {
        this.lblMsg.textContent = isolateDirection(this.lastPreflightError);
      } else if (this.lblMsg.getAttribute?.('data-i18n') === 'translate.emptyTranslationError') {
        this.lblMsg.textContent = t('translate.emptyTranslationError');
      }
    }
    if (!this.state.isTranslating && !this.isStartingTranslation && (this.providerSelect?.value === '' || this.modelSelect?.value === '')) {
      this.refreshProviderOptions();
    }
  }

  private notify(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    const win = window as any;
    if (typeof win.showNotification === 'function') {
      try {
        win.showNotification(msg, type);
        return;
      } catch (_) {}
    }
    console.log(`[Notification ${type}]: ${msg}`);
  }

  public dispose() {
    this.isDisposed = true;
    this.subtitleLoadId++;
    this.activeLoadToken++;
    for (const unlisten of this.unlisteners) {
      try {
        unlisten();
      } catch (err) {
        console.warn('Error during TranslationStudioController unlisten:', err);
      }
    }
    this.unlisteners = [];
    if (this.scrollThrottledTimeout) {
      clearTimeout(this.scrollThrottledTimeout);
      this.scrollThrottledTimeout = null;
    }
    if (this.pointerDriverTimeout) {
      clearTimeout(this.pointerDriverTimeout);
      this.pointerDriverTimeout = null;
    }
    if (this.syncScrollRaf !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.syncScrollRaf);
      }
      this.syncScrollRaf = null;
    }
  }
}

export const translationStudioController = new TranslationStudioController();
(window as any).translationStudioController = translationStudioController;
