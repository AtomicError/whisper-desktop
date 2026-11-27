import {
  t,
  isolateLtr,
  isolateDirection,
  directionAttributes,
  applyContentDirection,
  applyTextDirection,
  clearContentDirection,
  getLanguage,
  formatLocalizedNumber,
} from './i18n/index';
import { formatTokensShort } from './i18n/formatters';
import { copyToClipboard, openFileInEditor } from './modules/nativeWindow';
import { hardsubController } from './hardsub';
import { readProviders, writeProviders, isModelIdMatch, isModelReasoningSupported, type ProviderConfig, type ModelObject } from './modules/providerHelpers';
import {
  clampIntSettingValue,
  clampFloatSettingValue,
  normalizeDigitsToAscii,
  filterNumericInputPreservingLocalizedDigits,
} from './modules/transcribeConfigHelpers';

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
const TRANSLATE_OUTPUT_MODE_STORAGE_KEY = 'whisper_translate_output_dir_mode';
const TRANSLATE_OUTPUT_DIR_STORAGE_KEY = 'whisper_translate_output_dir';
const TEMP_PRESETS = new Set([0.1, 0.3, 0.6]);
const BATCH_PRESETS = new Set([10, 20, 30]);

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
  customPrompt: string;
  temperature: number;
  batchSize: number;
  outputDirMode: 'input_dir' | 'custom';
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
  private unifiedDeck: HTMLElement | null = null;
  private deckBody: HTMLElement | null = null;
  private targetLangSelect: HTMLSelectElement | null = null;
  private providerSelect: HTMLSelectElement | null = null;
  private modelSelect: HTMLSelectElement | null = null;
  private modelMetaRow: HTMLElement | null = null;
  private modelCtxChip: HTMLElement | null = null;
  private modelReasoningChip: HTMLElement | null = null;
  private providerWarningBtn: HTMLButtonElement | null = null;
  private reasoningGroup: HTMLElement | null = null;
  private reasoningPillsContainer: HTMLElement | null = null;
  private reasoningNoneBtn: HTMLButtonElement | null = null;
  private reasoningLowBtn: HTMLButtonElement | null = null;
  private reasoningMediumBtn: HTMLButtonElement | null = null;
  private reasoningHighBtn: HTMLButtonElement | null = null;
  private reasoningExtendedBtn: HTMLButtonElement | null = null;
  private btnManageProviders: HTMLButtonElement | null = null;
  private polishToggle: HTMLInputElement | null = null;
  private outputLocationModes: HTMLElement | null = null;
  private outputModeInputBtn: HTMLButtonElement | null = null;
  private outputModeCustomBtn: HTMLButtonElement | null = null;
  private outputCustomRow: HTMLElement | null = null;
  private outputDirText: HTMLElement | null = null;
  private btnOpenDir: HTMLButtonElement | null = null;
  private btnBrowseDir: HTMLButtonElement | null = null;
  private customPromptEl: HTMLTextAreaElement | null = null;
  private btnResetPrompt: HTMLButtonElement | null = null;
  private advancedToggleBtn: HTMLButtonElement | null = null;
  private advancedBody: HTMLElement | null = null;
  private advancedSummary: HTMLElement | null = null;
  private temp01Btn: HTMLButtonElement | null = null;
  private temp03Btn: HTMLButtonElement | null = null;
  private temp06Btn: HTMLButtonElement | null = null;
  private tempCustomBtn: HTMLButtonElement | null = null;
  private tempCustomRow: HTMLElement | null = null;
  private tempInput: HTMLInputElement | null = null;
  private btnTempDec: HTMLButtonElement | null = null;
  private btnTempInc: HTMLButtonElement | null = null;
  private batch10Btn: HTMLButtonElement | null = null;
  private batch20Btn: HTMLButtonElement | null = null;
  private batch30Btn: HTMLButtonElement | null = null;
  private batchCustomBtn: HTMLButtonElement | null = null;
  private batchCustomRow: HTMLElement | null = null;
  private batchInput: HTMLInputElement | null = null;
  private btnBatchDec: HTMLButtonElement | null = null;
  private btnBatchInc: HTMLButtonElement | null = null;
  private checkpointBanner: HTMLElement | null = null;
  private checkpointText: HTMLElement | null = null;
  private btnClearCheckpoint: HTMLButtonElement | null = null;

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
  private isOpeningOutputDir = false;
  private isStartingTranslation = false;
  private isCancellingTranslation = false;
  private isDisposed = false;
  private pendingSettingsSyncAfterTranslation = false;
  private hasExplicitOutputDirMode = false;
  private hasExplicitOutputDir = false;
  private deckResizeObserver: ResizeObserver | null = null;
  private openDirCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointCheckSeq = 0;
  private activeCheckpointInfo: { translatedLines: number; totalLines: number } | null = null;
  private isClearingCheckpoint = false;
  private tempCustomOpen = false;
  private batchCustomOpen = false;
  private advancedExpanded = false;
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
    customPrompt: '',
    temperature: 0.3,
    batchSize: 30,
    outputDirMode: 'input_dir',
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
      this.loadPersistedOutputDirState();
      this.syncFromGlobalSettings();
      this.updateOutputDirUI();
      this.updateModelMetaAndReasoningUI();
      this.updatePromptUI();
      this.updateAdvancedTuningUI();
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

    this.unifiedDeck = document.getElementById('translate-unified-deck');
    this.deckBody = typeof this.unifiedDeck?.querySelector === 'function'
      ? (this.unifiedDeck.querySelector('.translate-deck-body') as HTMLElement | null)
      : null;
    this.targetLangSelect = document.getElementById('translate-target-lang') as HTMLSelectElement;
    this.providerSelect = document.getElementById('translate-provider-select') as HTMLSelectElement;
    this.modelSelect = document.getElementById('translate-model-select') as HTMLSelectElement;
    this.modelMetaRow = document.getElementById('translate-model-meta-row');
    this.modelCtxChip = document.getElementById('translate-model-ctx-chip');
    this.modelReasoningChip = document.getElementById('translate-model-reasoning-chip');
    this.providerWarningBtn = document.getElementById('translate-provider-warning-btn') as HTMLButtonElement;
    this.reasoningGroup = document.getElementById('translate-reasoning-group');
    this.reasoningPillsContainer = document.getElementById('translate-reasoning-pills');
    this.reasoningNoneBtn = document.getElementById('translate-reasoning-none') as HTMLButtonElement;
    this.reasoningLowBtn = document.getElementById('translate-reasoning-low') as HTMLButtonElement;
    this.reasoningMediumBtn = document.getElementById('translate-reasoning-medium') as HTMLButtonElement;
    this.reasoningHighBtn = document.getElementById('translate-reasoning-high') as HTMLButtonElement;
    this.reasoningExtendedBtn = document.getElementById('translate-reasoning-extended') as HTMLButtonElement;
    this.btnManageProviders = document.getElementById('btn-translate-manage-providers') as HTMLButtonElement;
    this.polishToggle = document.getElementById('translate-polish-toggle') as HTMLInputElement;
    this.outputLocationModes = document.getElementById('translate-output-location-modes');
    this.outputModeInputBtn = document.getElementById('translate-output-mode-input') as HTMLButtonElement;
    this.outputModeCustomBtn = document.getElementById('translate-output-mode-custom') as HTMLButtonElement;
    this.outputCustomRow = document.getElementById('translate-output-custom-row');
    this.outputDirText = document.getElementById('translate-output-dir-text');
    this.btnOpenDir = document.getElementById('btn-open-translate-dir') as HTMLButtonElement;
    this.btnBrowseDir = document.getElementById('btn-browse-translate-dir') as HTMLButtonElement;
    this.customPromptEl = document.getElementById('translate-custom-prompt') as HTMLTextAreaElement;
    this.btnResetPrompt = document.getElementById('btn-reset-translate-prompt') as HTMLButtonElement;
    this.advancedToggleBtn = document.getElementById('btn-toggle-translate-advanced') as HTMLButtonElement;
    this.advancedBody = document.getElementById('translate-advanced-body');
    this.advancedSummary = document.getElementById('translate-advanced-summary');
    this.temp01Btn = document.getElementById('translate-temp-01') as HTMLButtonElement;
    this.temp03Btn = document.getElementById('translate-temp-03') as HTMLButtonElement;
    this.temp06Btn = document.getElementById('translate-temp-06') as HTMLButtonElement;
    this.tempCustomBtn = document.getElementById('translate-temp-custom') as HTMLButtonElement;
    this.tempCustomRow = document.getElementById('translate-temp-custom-row');
    this.tempInput = document.getElementById('translate-temp-input') as HTMLInputElement;
    this.btnTempDec = document.getElementById('btn-translate-temp-dec') as HTMLButtonElement;
    this.btnTempInc = document.getElementById('btn-translate-temp-inc') as HTMLButtonElement;
    this.batch10Btn = document.getElementById('translate-batch-10') as HTMLButtonElement;
    this.batch20Btn = document.getElementById('translate-batch-20') as HTMLButtonElement;
    this.batch30Btn = document.getElementById('translate-batch-30') as HTMLButtonElement;
    this.batchCustomBtn = document.getElementById('translate-batch-custom') as HTMLButtonElement;
    this.batchCustomRow = document.getElementById('translate-batch-custom-row');
    this.batchInput = document.getElementById('translate-batch-input') as HTMLInputElement;
    this.btnBatchDec = document.getElementById('btn-translate-batch-dec') as HTMLButtonElement;
    this.btnBatchInc = document.getElementById('btn-translate-batch-inc') as HTMLButtonElement;
    this.checkpointBanner = document.getElementById('translate-checkpoint-banner');
    this.checkpointText = document.getElementById('translate-checkpoint-text');
    this.btnClearCheckpoint = document.getElementById('btn-clear-translate-checkpoint') as HTMLButtonElement;

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
        this.scheduleCheckpointCheck(0);
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
        this.updateModelMetaAndReasoningUI();
        this.updateActionButtons();
        this.scheduleCheckpointCheck(0);
      }
    });

    this.bindListener(this.btnManageProviders, 'click', () => this.openTranslationSettings('providers'));
    this.bindListener(this.providerWarningBtn, 'click', () => this.openTranslationSettings('general'));

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
        this.scheduleCheckpointCheck(0);
      }
    });

    this.bindListener(this.outputModeInputBtn, 'click', () => {
      void this.setOutputDirMode('input_dir');
    });
    this.bindListener(this.outputModeCustomBtn, 'click', () => {
      void this.setOutputDirMode('custom');
    });
    this.bindListener(this.outputLocationModes, 'keydown', ((e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
        return;
      }
      if (this.state.isTranslating || this.isStartingTranslation) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isInputBtn = target.id === 'translate-output-mode-input';
      const isCustomBtn = target.id === 'translate-output-mode-custom';
      if (!isInputBtn && !isCustomBtn) return;

      e.preventDefault();
      const nextMode: 'input_dir' | 'custom' = isInputBtn ? 'custom' : 'input_dir';
      const nextBtn = nextMode === 'custom' ? this.outputModeCustomBtn : this.outputModeInputBtn;
      nextBtn?.focus?.();

      void this.setOutputDirMode(nextMode).then(() => {
        const activeMode = this.state.outputDirMode === 'custom' ? 'custom' : 'input_dir';
        if (activeMode === nextMode) return;
        const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
        const focusStillInGroup = !activeEl || activeEl === nextBtn || activeEl === target;
        if (!focusStillInGroup) return;
        const activeBtn = activeMode === 'custom' ? this.outputModeCustomBtn : this.outputModeInputBtn;
        activeBtn?.focus?.();
      });
    }) as EventListener);
    this.bindListener(this.btnOpenDir, 'click', () => {
      void this.openCustomOutputDir();
    });
    this.bindListener(this.btnBrowseDir, 'click', () => {
      void this.browseOutputDir();
    });

    this.bindListener(this.reasoningPillsContainer, 'click', (e) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.translate-preset-pill') as HTMLButtonElement | null;
      if (!btn || btn.disabled) return;
      const level = btn.dataset?.reasoning;
      if (!level) return;
      this.setActiveModelReasoning(level);
    });

    this.bindListener(this.customPromptEl, 'input', () => {
      if (!this.customPromptEl) return;
      if (this.state.isTranslating || this.isStartingTranslation) {
        this.customPromptEl.value = this.state.customPrompt;
        return;
      }
      applyTextDirection(this.customPromptEl);
      this.state.customPrompt = this.customPromptEl.value;
      const win = window as any;
      if (win.settingsState) {
        win.settingsState.translateAiCustomPrompt = this.state.customPrompt;
        if (typeof win.markSettingsDirty === 'function') {
          win.markSettingsDirty();
        }
        if (typeof win.saveCurrentSettings === 'function') {
          win.saveCurrentSettings(false);
        }
      }
      this.updatePromptResetButtonUI();
      this.scheduleCheckpointCheck(250);
    });

    this.bindListener(this.btnResetPrompt, 'click', () => {
      if (this.state.isTranslating || this.isStartingTranslation) return;
      this.state.customPrompt = '';
      if (this.customPromptEl) {
        this.customPromptEl.value = '';
      }
      const win = window as any;
      if (win.settingsState) {
        win.settingsState.translateAiCustomPrompt = '';
        if (typeof win.saveCurrentSettings === 'function') {
          win.saveCurrentSettings();
        }
      }
      this.updatePromptUI();
      this.scheduleCheckpointCheck(0);
    });

    this.bindListener(this.advancedToggleBtn, 'click', () => {
      this.advancedExpanded = !this.advancedExpanded;
      this.updateAdvancedDisclosureUI();
    });

    for (const btn of [this.temp01Btn, this.temp03Btn, this.temp06Btn, this.tempCustomBtn]) {
      this.bindListener(btn, 'click', () => {
        if (!btn) return;
        const val = btn.dataset?.temp;
        if (val === 'custom') {
          this.activateCustomTemperature();
        } else if (val !== undefined) {
          this.setTemperature(parseFloat(val), false);
        }
      });
    }

    this.bindListener(this.btnTempDec, 'click', () => this.stepTemperature(-0.1));
    this.bindListener(this.btnTempInc, 'click', () => this.stepTemperature(0.1));
    this.bindListener(this.tempInput, 'input', () => {
      if (!this.tempInput) return;
      const filtered = this.tempInput.value.replace(/[^\d.,٫\u06F0-\u06F9\u0660-\u0669]/g, '');
      if (filtered !== this.tempInput.value) {
        this.tempInput.value = filtered;
      }
      const normalized = normalizeDigitsToAscii(filtered).replace(/[,٫]/g, '.').trim();
      const parsed = parseFloat(normalized);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2) {
        this.setTemperature(parsed, true, true);
      }
    });
    const commitTempInput = () => {
      if (!this.tempInput) return;
      const normalized = normalizeDigitsToAscii(this.tempInput.value).replace(/[,٫]/g, '.').trim();
      const clamped = clampFloatSettingValue('translateAiTemperature', normalized);
      this.setTemperature(clamped, true);
    };
    this.bindListener(this.tempInput, 'change', commitTempInput);
    this.bindListener(this.tempInput, 'blur', commitTempInput);

    for (const btn of [this.batch10Btn, this.batch20Btn, this.batch30Btn, this.batchCustomBtn]) {
      this.bindListener(btn, 'click', () => {
        if (!btn) return;
        const val = btn.dataset?.batch;
        if (val === 'custom') {
          this.activateCustomBatchSize();
        } else if (val !== undefined) {
          this.setBatchSize(parseInt(val, 10), false);
        }
      });
    }

    this.bindListener(this.btnBatchDec, 'click', () => this.stepBatchSize(-1));
    this.bindListener(this.btnBatchInc, 'click', () => this.stepBatchSize(1));
    this.bindListener(this.batchInput, 'input', () => {
      if (!this.batchInput) return;
      const filtered = filterNumericInputPreservingLocalizedDigits(this.batchInput.value);
      if (filtered !== this.batchInput.value) {
        this.batchInput.value = filtered;
      }
      const parsed = parseInt(normalizeDigitsToAscii(filtered), 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 30) {
        this.setBatchSize(parsed, true, true);
      }
    });
    const commitBatchInput = () => {
      if (!this.batchInput) return;
      const clamped = clampIntSettingValue('translateAiBatchSize', this.batchInput.value);
      this.setBatchSize(clamped, true);
    };
    this.bindListener(this.batchInput, 'change', commitBatchInput);
    this.bindListener(this.batchInput, 'blur', commitBatchInput);

    this.bindListener(this.btnClearCheckpoint, 'click', () => {
      void this.clearCheckpoint();
    });

    this.setupDeckScrollCueObserver();

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
      if (this.sourceList) this.sourceList.scrollTop = 0;
      if (this.targetList) this.targetList.scrollTop = 0;
      this.updateActionButtons();
      this.scheduleCheckpointCheck(0);
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
    this.checkpointCheckSeq++;
    if (this.checkpointCheckTimer) {
      clearTimeout(this.checkpointCheckTimer);
      this.checkpointCheckTimer = null;
    }
    this.activeCheckpointInfo = null;
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
    this.updateCheckpointBannerUI();
    this.renderSourceCues();
    this.renderTargetCues();
    if (this.sourceList) this.sourceList.scrollTop = 0;
    if (this.targetList) this.targetList.scrollTop = 0;
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
      if (this.dropZone?.dataset) {
        this.dropZone.dataset.filePath = this.state.subtitlePath;
      }

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
      if (this.dropZone?.dataset) {
        delete this.dropZone.dataset.filePath;
      }
      this.dropZone?.setAttribute('data-i18n-title', 'translate.dropSubPrompt');
      this.dropZone?.setAttribute('title', t('translate.dropSubPrompt'));
    }

    this.updateOutputDirUI();
  }

  private setupDeckScrollCueObserver() {
    if (this.deckBody) {
      this.bindListener(this.deckBody, 'scroll', () => this.updateDeckScrollCue(), { passive: true });
    }
    if (typeof ResizeObserver !== 'undefined' && this.deckBody) {
      if (this.deckResizeObserver) {
        this.deckResizeObserver.disconnect();
      }
      const ro = new ResizeObserver(() => this.updateDeckScrollCue());
      ro.observe(this.deckBody);
      for (const el of [this.dropZone, this.outputCustomRow, this.telemetryBox]) {
        if (el) ro.observe(el);
      }
      this.deckResizeObserver = ro;
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onResize = () => this.updateDeckScrollCue();
      window.addEventListener('resize', onResize);
      this.unlisteners.push(() => window.removeEventListener?.('resize', onResize));
    }
    this.updateDeckScrollCue();
  }

  public updateDeckScrollCue() {
    if (!this.unifiedDeck || !this.deckBody) return;
    if (typeof this.deckBody.scrollHeight !== 'number' || typeof this.deckBody.clientHeight !== 'number') return;
    const hasOverflowBelow =
      this.deckBody.scrollHeight - this.deckBody.clientHeight - (this.deckBody.scrollTop || 0) > 6;
    this.unifiedDeck.classList?.toggle?.('has-scroll-below', hasOverflowBelow);
  }

  private updateOutputDirUI() {
    const isCustomMode = this.state.outputDirMode === 'custom';
    const customPath = String(this.state.outputDir || '').trim();
    const hasCustomPath = Boolean(customPath);

    if (this.outputModeInputBtn) {
      this.outputModeInputBtn.classList?.toggle?.('active', !isCustomMode);
      this.outputModeInputBtn.setAttribute?.('aria-checked', !isCustomMode ? 'true' : 'false');
      this.outputModeInputBtn.setAttribute?.('tabindex', !isCustomMode ? '0' : '-1');
    }
    if (this.outputModeCustomBtn) {
      this.outputModeCustomBtn.classList?.toggle?.('active', isCustomMode);
      this.outputModeCustomBtn.setAttribute?.('aria-checked', isCustomMode ? 'true' : 'false');
      this.outputModeCustomBtn.setAttribute?.('tabindex', isCustomMode ? '0' : '-1');
    }

    if (this.outputCustomRow) {
      this.outputCustomRow.style.display = isCustomMode ? 'block' : 'none';
    }

    if (this.outputDirText) {
      if (hasCustomPath) {
        this.outputDirText.removeAttribute?.('data-i18n');
        this.outputDirText.textContent = customPath;
        this.outputDirText.title = isolateLtr(customPath);
        this.outputDirText.classList?.add?.('has-custom-path');
      } else if (isCustomMode) {
        this.outputDirText.setAttribute?.('data-i18n', 'settings.outputDirSelectPlaceholder');
        this.outputDirText.textContent = t('settings.outputDirSelectPlaceholder') || 'Select output folder...';
        this.outputDirText.removeAttribute?.('title');
        this.outputDirText.classList?.remove?.('has-custom-path');
      } else {
        this.outputDirText.setAttribute?.('data-i18n', 'translate.sameAsSource');
        this.outputDirText.textContent = t('translate.sameAsSource');
        this.outputDirText.removeAttribute?.('title');
        this.outputDirText.classList?.remove?.('has-custom-path');
      }
    }

    if (this.btnOpenDir) {
      this.btnOpenDir.disabled = !hasCustomPath;
    }

    this.updateDeckScrollCue();
  }

  private loadPersistedOutputDirState() {
    try {
      if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return;
      const savedMode = localStorage.getItem(TRANSLATE_OUTPUT_MODE_STORAGE_KEY);
      if (savedMode === 'custom' || savedMode === 'input_dir') {
        this.state.outputDirMode = savedMode;
        this.hasExplicitOutputDirMode = true;
      }
      const savedDir = localStorage.getItem(TRANSLATE_OUTPUT_DIR_STORAGE_KEY);
      if (typeof savedDir === 'string' && savedDir.trim()) {
        this.state.outputDir = savedDir.trim();
        this.hasExplicitOutputDir = true;
      }
    } catch (_) {
      // Ignore storage access errors in restricted environments
    }
  }

  private persistOutputDirState() {
    try {
      if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
      if (this.hasExplicitOutputDirMode) {
        localStorage.setItem(TRANSLATE_OUTPUT_MODE_STORAGE_KEY, this.state.outputDirMode);
      }
      if (this.hasExplicitOutputDir) {
        localStorage.setItem(TRANSLATE_OUTPUT_DIR_STORAGE_KEY, String(this.state.outputDir || '').trim());
      }
    } catch (_) {
      // Ignore storage access errors in restricted environments
    }
  }

  private syncOutputDirToGlobalSettings() {
    const win = window as any;
    if (!win?.settingsState) return;
    if (this.hasExplicitOutputDirMode) {
      win.settingsState.translateOutputDirMode = this.state.outputDirMode;
    }
    if (this.hasExplicitOutputDir) {
      win.settingsState.translateOutputDirPath = String(this.state.outputDir || '').trim();
    }
    if (typeof win.markSettingsDirty === 'function') {
      win.markSettingsDirty();
    }
    if (typeof win.saveCurrentSettings === 'function') {
      win.saveCurrentSettings(false);
    }
  }

  public async setOutputDirMode(mode: 'input_dir' | 'custom') {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    if (mode === 'custom') {
      this.hasExplicitOutputDirMode = true;
      if (this.state.outputDirMode === 'custom') {
        this.persistOutputDirState();
        this.updateOutputDirUI();
        return;
      }
      this.state.outputDirMode = 'custom';
    } else {
      this.hasExplicitOutputDirMode = true;
      if (this.state.outputDirMode === 'input_dir') {
        this.persistOutputDirState();
        this.updateOutputDirUI();
        return;
      }
      this.state.outputDirMode = 'input_dir';
    }
    this.persistOutputDirState();
    this.syncOutputDirToGlobalSettings();
    this.updateOutputDirUI();
    this.scheduleCheckpointCheck(0);
  }

  public async openCustomOutputDir() {
    if (this.isOpeningOutputDir) return;
    const dirPath = String(this.state.outputDir || '').trim();
    if (!dirPath) {
      this.notify(t('toasts.noOutputDirFound'), 'info');
      return;
    }

    this.isOpeningOutputDir = true;
    try {
      try {
        await invoke('verify_directory_writable', { dirPath });
      } catch (permErr) {
        this.notify(t('toasts.outputDirNotWritable', { error: String(permErr) }), 'error');
        return;
      }
      await openFileInEditor(dirPath);
    } catch (err: any) {
      console.error('Failed to open output directory:', err);
      const msg = (err && (err.message || err.toString())) || String(err);
      this.notify(t('toasts.openFolderError', { error: msg }), 'error');
    } finally {
      if (this.openDirCooldownTimer) {
        clearTimeout(this.openDirCooldownTimer);
        this.openDirCooldownTimer = null;
      }
      if (this.isDisposed) {
        this.isOpeningOutputDir = false;
      } else {
        this.openDirCooldownTimer = setTimeout(() => {
          this.openDirCooldownTimer = null;
          this.isOpeningOutputDir = false;
        }, 1000);
      }
    }
  }

  public async browseOutputDir() {
    if (this.isBrowsingOutputDir || this.state.isTranslating || this.isStartingTranslation) return;
    this.isBrowsingOutputDir = true;
    if (this.btnBrowseDir) {
      this.btnBrowseDir.disabled = true;
    }
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected && !this.state.isTranslating && !this.isStartingTranslation) {
        try {
          await invoke('verify_directory_writable', { dirPath: selected });
        } catch (permErr) {
          this.notify(t('toasts.outputDirNotWritable', { error: String(permErr) }), 'error');
          return;
        }
        this.state.outputDir = selected;
        this.state.outputDirMode = 'custom';
        this.hasExplicitOutputDir = true;
        this.hasExplicitOutputDirMode = true;
        this.persistOutputDirState();
        this.syncOutputDirToGlobalSettings();
        this.updateOutputDirUI();
        this.scheduleCheckpointCheck(0);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    } finally {
      this.isBrowsingOutputDir = false;
      this.updateActionButtons();
    }
  }

  public syncFromGlobalSettings(force = false) {
    if (!force && (this.state.isTranslating || this.isStartingTranslation)) {
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

    if (typeof settings.translateAiCustomPrompt === 'string') {
      this.state.customPrompt = settings.translateAiCustomPrompt;
    }

    const nextTemp = settings.translateAiTemperature !== undefined
      ? clampFloatSettingValue('translateAiTemperature', settings.translateAiTemperature)
      : 0.3;
    this.state.temperature = Math.round(nextTemp * 10) / 10;
    this.tempCustomOpen = !TEMP_PRESETS.has(this.state.temperature);

    const rawBatch = settings.translateAiBatchSize;
    const nextBatch = (typeof rawBatch === 'number' && rawBatch <= 0)
      ? 30
      : (rawBatch !== undefined ? clampIntSettingValue('translateAiBatchSize', rawBatch) : 30);
    this.state.batchSize = nextBatch;
    this.batchCustomOpen = !BATCH_PRESETS.has(this.state.batchSize);

    if (!this.hasExplicitOutputDir) {
      const dedicatedDir = typeof settings.translateOutputDirPath === 'string' ? settings.translateOutputDirPath.trim() : '';
      const fallbackDir = typeof settings.outputDirPath === 'string' ? settings.outputDirPath.trim() : '';
      if (dedicatedDir) {
        this.state.outputDir = dedicatedDir;
        this.hasExplicitOutputDir = true;
      } else if (typeof settings.outputDirPath === 'string') {
        this.state.outputDir = fallbackDir;
      }
    }

    if (!this.hasExplicitOutputDirMode) {
      if (settings.translateOutputDirMode === 'custom' || settings.translateOutputDirMode === 'input_dir') {
        this.state.outputDirMode = settings.translateOutputDirMode;
        this.hasExplicitOutputDirMode = true;
      } else if (settings.outputDirMode === 'custom' || settings.outputDirMode === 'input_dir') {
        this.state.outputDirMode = settings.outputDirMode;
      }
    }

    this.updateOutputDirUI();
    this.updatePromptUI();
    this.updateAdvancedTuningUI();

    this.refreshProviderOptions(force);

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
    this.scheduleCheckpointCheck(0);
  }

  public refreshProviderOptions(force = false) {
    if (!this.providerSelect) return;
    if (!force && (this.state.isTranslating || this.isStartingTranslation)) {
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
      this.refreshModelOptions(force);
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

    this.refreshModelOptions(force);
  }

  public refreshModelOptions(force = false) {
    if (!this.modelSelect) return;
    if (!force && (this.state.isTranslating || this.isStartingTranslation)) {
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
      this.updateModelMetaAndReasoningUI();
      this.updatePromptUI();
      this.updateActionButtons();
      if (typeof win.syncCustomSelects === 'function') {
        win.syncCustomSelects();
      }
      this.scheduleCheckpointCheck(0);
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
      this.updateModelMetaAndReasoningUI();
      this.updatePromptUI();
      this.updateActionButtons();
      if (typeof win.syncCustomSelects === 'function') {
        win.syncCustomSelects();
      }
      this.scheduleCheckpointCheck(0);
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

    this.updateModelMetaAndReasoningUI();
    this.updatePromptUI();
    this.updateActionButtons();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
    this.scheduleCheckpointCheck(0);
  }

  public openTranslationSettings(subTab: 'general' | 'providers' = 'providers') {
    const win = window as any;
    if (typeof win.switchView === 'function') {
      win.switchView('settings');
    }
    if (typeof win.switchSettingsCategory === 'function') {
      win.switchSettingsCategory('translation');
    }
    if (typeof win.switchProviderTab === 'function') {
      win.switchProviderTab(subTab);
    }
  }

  private getActiveProviderAndModel(): {
    providers: ProviderConfig[];
    providerIndex: number;
    provider: ProviderConfig | null;
    modelIndex: number;
    model: ModelObject | null;
  } {
    const win = window as any;
    const providers = readProviders(win?.settingsState);
    const providerIndex = providers.findIndex((p) => p.name === this.state.activeProvider);
    const provider = providerIndex >= 0 ? providers[providerIndex] : null;
    const models = Array.isArray(provider?.models) ? provider!.models! : [];
    const modelIndex = models.findIndex((m) => isModelIdMatch(m.id, this.state.activeModel));
    const model = modelIndex >= 0 ? models[modelIndex] : null;
    return { providers, providerIndex, provider, modelIndex, model };
  }

  private getReasoningPillLabel(level: string): string {
    const lower = level.trim().toLowerCase();
    if (lower === 'none') return t('translate.reasoningOff') || 'Off';
    if (lower === 'low') return t('translate.reasoningLow') || 'Low';
    if (lower === 'medium') return t('translate.reasoningMedium') || 'Medium';
    if (lower === 'high') return t('translate.reasoningHigh') || 'High';
    return level.trim() || 'Medium';
  }

  private updateModelMetaAndReasoningUI() {
    const { provider, model } = this.getActiveProviderAndModel();
    const supportsReasoning = Boolean(provider && model && isModelReasoningSupported(model));
    const activeReasoning = String(model?.reasoning || 'Medium').trim() || 'Medium';

    let hasVisibleMeta = false;
    if (this.modelCtxChip) {
      const ctxVal = Number(model?.contextWindow ?? model?.context_window ?? 0);
      if (provider && model && Number.isFinite(ctxVal) && ctxVal > 0) {
        this.modelCtxChip.textContent = t('translate.metaContext', { ctx: formatTokensShort(ctxVal) });
        this.modelCtxChip.style.display = 'inline-flex';
        hasVisibleMeta = true;
      } else {
        this.modelCtxChip.style.display = 'none';
      }
    }

    if (this.modelReasoningChip) {
      if (supportsReasoning) {
        const levelLabel = this.getReasoningPillLabel(activeReasoning);
        this.modelReasoningChip.textContent = t('translate.metaReasoning', { level: levelLabel });
        this.modelReasoningChip.style.display = 'inline-flex';
        hasVisibleMeta = true;
      } else {
        this.modelReasoningChip.style.display = 'none';
      }
    }

    if (this.providerWarningBtn) {
      const baseUrl = String(provider?.baseUrl || provider?.base_url || '').trim();
      const apiKey = String(provider?.apiKey || provider?.api_key || '').trim();
      const usesKeyring = Boolean(provider?.useKeyring || provider?.use_keyring);
      const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(baseUrl);
      let warningKey = '';
      if (provider && !baseUrl) {
        warningKey = 'translate.warningMissingBaseUrl';
      } else if (provider && !apiKey && !usesKeyring && !isLocalUrl) {
        warningKey = 'translate.warningMissingApiKey';
      }
      if (warningKey) {
        this.providerWarningBtn.setAttribute?.('data-i18n', warningKey);
        this.providerWarningBtn.textContent = t(warningKey);
        this.providerWarningBtn.title = t(warningKey);
        this.providerWarningBtn.style.display = 'inline-flex';
        hasVisibleMeta = true;
      } else {
        this.providerWarningBtn.removeAttribute?.('data-i18n');
        this.providerWarningBtn.style.display = 'none';
      }
    }

    if (this.modelMetaRow) {
      this.modelMetaRow.style.display = hasVisibleMeta ? 'flex' : 'none';
    }

    if (this.reasoningGroup) {
      this.reasoningGroup.style.display = supportsReasoning ? 'flex' : 'none';
    }

    const activeLower = activeReasoning.toLowerCase();
    const stdLevels = ['none', 'low', 'medium', 'high'];
    const isExtended = supportsReasoning && !stdLevels.includes(activeLower);
    if (this.reasoningExtendedBtn) {
      if (isExtended) {
        this.reasoningExtendedBtn.dataset.reasoning = activeReasoning;
        this.reasoningExtendedBtn.textContent = this.getReasoningPillLabel(activeReasoning);
        this.reasoningExtendedBtn.style.display = 'inline-flex';
      } else {
        this.reasoningExtendedBtn.dataset.reasoning = '';
        this.reasoningExtendedBtn.style.display = 'none';
      }
    }

    const pills: Array<HTMLButtonElement | null> = [
      this.reasoningNoneBtn,
      this.reasoningLowBtn,
      this.reasoningMediumBtn,
      this.reasoningHighBtn,
      this.reasoningExtendedBtn,
    ];
    for (const pill of pills) {
      if (!pill) continue;
      const level = String(pill.dataset?.reasoning || '').trim().toLowerCase();
      const isActive = supportsReasoning && level.length > 0 && level === activeLower;
      pill.classList?.toggle?.('active', isActive);
      pill.setAttribute?.('aria-pressed', isActive ? 'true' : 'false');
    }

    this.updateDeckScrollCue();
  }

  public setActiveModelReasoning(level: string) {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    const normalizedLevel = level.trim();
    if (!normalizedLevel) return;

    const win = window as any;
    const { providers, providerIndex, modelIndex } = this.getActiveProviderAndModel();
    if (providerIndex < 0 || modelIndex < 0 || !providers[providerIndex]?.models) return;

    providers[providerIndex].models![modelIndex] = {
      ...providers[providerIndex].models![modelIndex],
      reasoning: normalizedLevel,
    };

    if (win.settingsState) {
      writeProviders(win.settingsState, providers);
      if (typeof win.syncActiveModelSelectionUI === 'function') {
        win.syncActiveModelSelectionUI(this.state.activeModel);
      }
      if (typeof win.markSettingsDirty === 'function') {
        win.markSettingsDirty();
      }
      if (typeof win.saveCurrentSettings === 'function') {
        win.saveCurrentSettings(false);
      }
    }

    this.updateModelMetaAndReasoningUI();
    this.scheduleCheckpointCheck(0);
  }

  private updatePromptResetButtonUI() {
    if (!this.btnResetPrompt) return;
    const hasCustom = this.state.customPrompt.trim().length > 0;
    this.btnResetPrompt.style.display = hasCustom ? 'inline-flex' : 'none';
  }

  private updatePromptUI() {
    const { provider } = this.getActiveProviderAndModel();
    const providerDefault = String(provider?.customPrompt || provider?.custom_prompt || '').trim();

    if (this.customPromptEl) {
      if (this.customPromptEl.value !== this.state.customPrompt) {
        this.customPromptEl.value = this.state.customPrompt;
      }
      if (!this.state.customPrompt.trim() && providerDefault) {
        const snippet = providerDefault.length > 72 ? `${providerDefault.slice(0, 69)}...` : providerDefault;
        this.customPromptEl.removeAttribute?.('data-i18n-placeholder');
        this.customPromptEl.placeholder = t('translate.promptProviderFallbackPlaceholder', { prompt: snippet });
      } else {
        this.customPromptEl.setAttribute?.('data-i18n-placeholder', 'translate.promptPlaceholder');
        this.customPromptEl.placeholder = t('translate.promptPlaceholder');
      }
      applyTextDirection(this.customPromptEl);
    }

    this.updatePromptResetButtonUI();
    this.updateDeckScrollCue();
  }

  private updateAdvancedDisclosureUI() {
    if (this.advancedToggleBtn) {
      this.advancedToggleBtn.setAttribute?.('aria-expanded', this.advancedExpanded ? 'true' : 'false');
    }
    if (this.advancedBody) {
      this.advancedBody.style.display = this.advancedExpanded ? 'flex' : 'none';
    }
    this.updateDeckScrollCue();
  }

  private updateAdvancedTuningUI(skipTempInput = false, skipBatchInput = false) {
    const temp = Math.round(clampFloatSettingValue('translateAiTemperature', this.state.temperature) * 10) / 10;
    this.state.temperature = temp;
    const batch = clampIntSettingValue('translateAiBatchSize', this.state.batchSize);
    this.state.batchSize = batch;

    const lang = getLanguage();
    if (this.advancedSummary) {
      const tempText = formatLocalizedNumber(temp, lang, 1);
      const batchText = formatLocalizedNumber(batch, lang, 0);
      this.advancedSummary.textContent = `${tempText} • ${batchText}`;
    }

    const isTempPreset = !this.tempCustomOpen && TEMP_PRESETS.has(temp);
    const tempPairs: Array<[HTMLButtonElement | null, boolean]> = [
      [this.temp01Btn, isTempPreset && Math.abs(temp - 0.1) < 0.001],
      [this.temp03Btn, isTempPreset && Math.abs(temp - 0.3) < 0.001],
      [this.temp06Btn, isTempPreset && Math.abs(temp - 0.6) < 0.001],
      [this.tempCustomBtn, this.tempCustomOpen || !TEMP_PRESETS.has(temp)],
    ];
    for (const [btn, active] of tempPairs) {
      if (!btn) continue;
      btn.classList?.toggle?.('active', active);
      btn.setAttribute?.('aria-pressed', active ? 'true' : 'false');
    }

    const showTempCustom = this.tempCustomOpen || !TEMP_PRESETS.has(temp);
    if (this.tempCustomRow) {
      this.tempCustomRow.style.display = showTempCustom ? 'flex' : 'none';
    }
    if (this.tempInput && !skipTempInput) {
      this.tempInput.value = temp.toFixed(1);
    }
    const isBusy = this.state.isTranslating || this.isStartingTranslation;
    if (this.btnTempDec) this.btnTempDec.disabled = isBusy || temp <= 0;
    if (this.btnTempInc) this.btnTempInc.disabled = isBusy || temp >= 2;

    const isBatchPreset = !this.batchCustomOpen && BATCH_PRESETS.has(batch);
    const batchPairs: Array<[HTMLButtonElement | null, boolean]> = [
      [this.batch10Btn, isBatchPreset && batch === 10],
      [this.batch20Btn, isBatchPreset && batch === 20],
      [this.batch30Btn, isBatchPreset && batch === 30],
      [this.batchCustomBtn, this.batchCustomOpen || !BATCH_PRESETS.has(batch)],
    ];
    for (const [btn, active] of batchPairs) {
      if (!btn) continue;
      btn.classList?.toggle?.('active', active);
      btn.setAttribute?.('aria-pressed', active ? 'true' : 'false');
    }

    const showBatchCustom = this.batchCustomOpen || !BATCH_PRESETS.has(batch);
    if (this.batchCustomRow) {
      this.batchCustomRow.style.display = showBatchCustom ? 'flex' : 'none';
    }
    if (this.batchInput && !skipBatchInput) {
      this.batchInput.value = String(batch);
    }
    if (this.btnBatchDec) this.btnBatchDec.disabled = isBusy || batch <= 1;
    if (this.btnBatchInc) this.btnBatchInc.disabled = isBusy || batch >= 30;

    this.updateAdvancedDisclosureUI();
  }

  public setTemperature(value: number, isCustom: boolean, skipInputRewrite = false) {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    const clamped = Math.round(clampFloatSettingValue('translateAiTemperature', value) * 10) / 10;
    this.state.temperature = clamped;
    this.tempCustomOpen = isCustom || !TEMP_PRESETS.has(clamped);

    const win = window as any;
    if (win.settingsState) {
      win.settingsState.translateAiTemperature = clamped;
      if (typeof win.markSettingsDirty === 'function') {
        win.markSettingsDirty();
      }
      if (typeof win.saveCurrentSettings === 'function') {
        win.saveCurrentSettings(false);
      }
    }

    this.updateAdvancedTuningUI(skipInputRewrite, false);
  }

  public activateCustomTemperature() {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    this.tempCustomOpen = true;
    this.updateAdvancedTuningUI();
    this.tempInput?.focus?.();
  }

  public stepTemperature(delta: number) {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    this.setTemperature(this.state.temperature + delta, true);
  }

  public setBatchSize(value: number, isCustom: boolean, skipInputRewrite = false) {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    const clamped = clampIntSettingValue('translateAiBatchSize', value);
    this.state.batchSize = clamped;
    this.batchCustomOpen = isCustom || !BATCH_PRESETS.has(clamped);

    const win = window as any;
    if (win.settingsState) {
      win.settingsState.translateAiBatchSize = clamped;
      if (typeof win.markSettingsDirty === 'function') {
        win.markSettingsDirty();
      }
      if (typeof win.saveCurrentSettings === 'function') {
        win.saveCurrentSettings(false);
      }
    }

    this.updateAdvancedTuningUI(false, skipInputRewrite);
    this.scheduleCheckpointCheck(250);
  }

  public activateCustomBatchSize() {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    this.batchCustomOpen = true;
    this.updateAdvancedTuningUI();
    this.batchInput?.focus?.();
  }

  public stepBatchSize(delta: number) {
    if (this.state.isTranslating || this.isStartingTranslation) return;
    this.setBatchSize(this.state.batchSize + delta, true);
  }

  private buildEffectiveRunSettings(baseSettings: Record<string, any> = {}): Record<string, any> {
    const trimmedDir = this.state.outputDirMode === 'custom' && this.state.outputDir
      ? this.state.outputDir.trim()
      : String(baseSettings.translateOutputDirPath || this.state.outputDir || '').trim();
    return {
      ...baseSettings,
      translateAiEnabled: true,
      translateAiTargetLang: this.state.targetLang,
      translateAiProvider: this.state.activeProvider,
      translateAiModel: this.state.activeModel,
      translateAiPolish: this.state.polishPass,
      translateAiCustomPrompt: this.state.customPrompt,
      translateAiTemperature: this.state.temperature,
      translateAiBatchSize: this.state.batchSize,
      translateOutputDirMode: this.state.outputDirMode,
      translateOutputDirPath: trimmedDir,
    };
  }

  private scheduleCheckpointCheck(delayMs = 0) {
    if (this.checkpointCheckTimer) {
      clearTimeout(this.checkpointCheckTimer);
      this.checkpointCheckTimer = null;
    }
    if (this.isDisposed || !this.state.subtitlePath || !this.state.activeModel) {
      this.checkpointCheckSeq++;
      this.activeCheckpointInfo = null;
      this.updateCheckpointBannerUI();
      return;
    }
    if (delayMs <= 0) {
      void this.refreshCheckpointStatus();
      return;
    }
    this.checkpointCheckTimer = setTimeout(() => {
      this.checkpointCheckTimer = null;
      void this.refreshCheckpointStatus();
    }, delayMs);
  }

  private async refreshCheckpointStatus() {
    if (this.isDisposed || this.state.isTranslating || this.isStartingTranslation) return;
    const subtitlePath = this.state.subtitlePath;
    if (!subtitlePath || !this.state.activeModel) {
      this.activeCheckpointInfo = null;
      this.updateCheckpointBannerUI();
      return;
    }

    const seq = ++this.checkpointCheckSeq;
    const win = window as any;
    const effectiveSettings = this.buildEffectiveRunSettings(win?.settingsState || {});
    const trimmedOutputDir = this.state.outputDirMode === 'custom' && this.state.outputDir
      ? this.state.outputDir.trim()
      : '';

    let info: { translatedLines: number; totalLines: number } | null = null;
    try {
      info = await invoke<{ translatedLines: number; totalLines: number } | null>('get_translation_checkpoint_info', {
        settings: effectiveSettings,
        subtitlePath,
        outputDir: trimmedOutputDir || null,
      });
    } catch (_) {
      info = null;
    }

    if (seq !== this.checkpointCheckSeq || this.isDisposed || this.state.subtitlePath !== subtitlePath) {
      return;
    }

    this.activeCheckpointInfo = info && typeof info.translatedLines === 'number' && info.translatedLines > 0
      ? info
      : null;
    this.updateCheckpointBannerUI();
  }

  private updateCheckpointBannerUI() {
    if (!this.checkpointBanner) return;
    const isBusy = this.state.isTranslating || this.isStartingTranslation;
    const info = this.activeCheckpointInfo;
    const show = Boolean(!isBusy && this.state.subtitlePath && info && info.translatedLines > 0);
    this.checkpointBanner.style.display = show ? 'flex' : 'none';
    if (show && info && this.checkpointText) {
      const lang = getLanguage();
      const doneText = formatLocalizedNumber(info.translatedLines, lang, 0);
      const totalValue = info.totalLines > 0 ? info.totalLines : this.state.sourceCues.length;
      const totalText = formatLocalizedNumber(totalValue, lang, 0);
      this.checkpointText.textContent = t('translate.checkpointResumable', {
        done: doneText,
        total: totalText,
      });
    }
    if (this.btnClearCheckpoint) {
      this.btnClearCheckpoint.disabled = isBusy || this.isClearingCheckpoint;
    }
    this.updateDeckScrollCue();
  }

  public async clearCheckpoint() {
    if (this.isClearingCheckpoint || this.state.isTranslating || this.isStartingTranslation) return;
    if (!this.state.subtitlePath) return;

    this.isClearingCheckpoint = true;
    this.updateCheckpointBannerUI();
    try {
      const win = window as any;
      const effectiveSettings = this.buildEffectiveRunSettings(win?.settingsState || {});
      const trimmedOutputDir = this.state.outputDirMode === 'custom' && this.state.outputDir
        ? this.state.outputDir.trim()
        : '';
      await invoke<boolean>('clear_translation_checkpoint', {
        settings: effectiveSettings,
        subtitlePath: this.state.subtitlePath,
        outputDir: trimmedOutputDir || null,
      });
      this.activeCheckpointInfo = null;
      this.notify(t('translate.checkpointClearedToast'), 'info');
    } catch (err) {
      console.error('Failed to clear translation checkpoint:', err);
    } finally {
      this.isClearingCheckpoint = false;
      this.updateCheckpointBannerUI();
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
    if (this.outputModeInputBtn) this.outputModeInputBtn.disabled = isBusy;
    if (this.outputModeCustomBtn) this.outputModeCustomBtn.disabled = isBusy;
    if (this.btnBrowseDir) this.btnBrowseDir.disabled = isBusy || this.isBrowsingOutputDir;
    if (this.targetLangSelect) this.targetLangSelect.disabled = isBusy;
    if (this.providerSelect) this.providerSelect.disabled = isBusy;
    if (this.modelSelect) this.modelSelect.disabled = isBusy;
    if (this.polishToggle) this.polishToggle.disabled = isBusy;
    for (const btn of [
      this.reasoningNoneBtn,
      this.reasoningLowBtn,
      this.reasoningMediumBtn,
      this.reasoningHighBtn,
      this.reasoningExtendedBtn,
      this.btnResetPrompt,
      this.temp01Btn,
      this.temp03Btn,
      this.temp06Btn,
      this.tempCustomBtn,
      this.batch10Btn,
      this.batch20Btn,
      this.batch30Btn,
      this.batchCustomBtn,
    ]) {
      if (btn) btn.disabled = isBusy;
    }
    if (this.customPromptEl) this.customPromptEl.disabled = isBusy;
    if (this.tempInput) this.tempInput.disabled = isBusy;
    if (this.batchInput) this.batchInput.disabled = isBusy;
    if (this.btnTempDec) this.btnTempDec.disabled = isBusy || this.state.temperature <= 0;
    if (this.btnTempInc) this.btnTempInc.disabled = isBusy || this.state.temperature >= 2;
    if (this.btnBatchDec) this.btnBatchDec.disabled = isBusy || this.state.batchSize <= 1;
    if (this.btnBatchInc) this.btnBatchInc.disabled = isBusy || this.state.batchSize >= 30;
    this.updateCheckpointBannerUI();
    if (this.btnCancel) {
      this.btnCancel.style.display = isTranslating ? 'inline-flex' : 'none';
      this.btnCancel.disabled = isTranslating ? this.isCancellingTranslation : false;
    }
    if (this.telemetryBox) {
      this.telemetryBox.style.display = (isTranslating || this.state.progress > 0 || this.lastProgressIsComplete || this.lastProgressIsCancelled || this.lastProgressIsFailed) ? 'block' : 'none';
    }
    this.updateDeckScrollCue();

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
    if (this.state.outputDirMode === 'custom' && !String(this.state.outputDir || '').trim()) {
      this.notify(t('settings.outputDirSelectPlaceholder') || t('toasts.noOutputDirFound'), 'error');
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
          let providerOrModelReconciled = false;
          if (flushedProviders.length > 0) {
            const resolvedProvider =
              flushedProviders.find((p: any) => p?.name === this.state.activeProvider) ||
              flushedProviders.find((p: any) => p?.name === globalSettings.translateAiProvider) ||
              flushedProviders[0];
            if (resolvedProvider && typeof resolvedProvider.name === 'string') {
              if (
                resolvedProvider.name !== this.state.activeProvider ||
                globalSettings.translateAiProvider !== resolvedProvider.name
              ) {
                providerOrModelReconciled = true;
              }
              this.state.activeProvider = resolvedProvider.name;
              globalSettings.translateAiProvider = resolvedProvider.name;
              if (this.providerSelect) {
                this.providerSelect.value = this.state.activeProvider;
              }
            }
            const enabledModels = Array.isArray(resolvedProvider?.models)
              ? resolvedProvider.models.filter((m: any) => m && m.enabled !== false && typeof m.id === 'string' && m.id.trim().length > 0)
              : [];
            if (enabledModels.length === 0) {
              this.state.activeModel = '';
              globalSettings.translateAiModel = '';
              if (this.modelSelect) {
                this.modelSelect.value = '';
              }
              this.pendingSettingsSyncAfterTranslation = true;
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
              providerOrModelReconciled = true;
            }
            if (providerOrModelReconciled) {
              this.refreshProviderOptions(true);
              const globalProviderSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement | null;
              if (globalProviderSelect) globalProviderSelect.value = this.state.activeProvider;
              const globalModelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement | null;
              if (globalModelSelect) globalModelSelect.value = this.state.activeModel;
              if (typeof win.syncCustomSelects === 'function') {
                win.syncCustomSelects();
              }
            }
          } else if (hadProviderListBeforeFlush) {
            this.state.activeProvider = '';
            this.state.activeModel = '';
            globalSettings.translateAiProvider = '';
            globalSettings.translateAiModel = '';
            if (this.providerSelect) this.providerSelect.value = '';
            if (this.modelSelect) this.modelSelect.value = '';
            this.pendingSettingsSyncAfterTranslation = true;
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

    const runCustomPrompt = (typeof globalSettings?.translateAiCustomPrompt === 'string' && globalSettings.translateAiCustomPrompt.length > 0)
      ? globalSettings.translateAiCustomPrompt
      : this.state.customPrompt;

    const runSettings = {
      ...this.buildEffectiveRunSettings(globalSettings),
      translateAiCustomPrompt: runCustomPrompt,
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
      const trimmedOutputDir =
        this.state.outputDirMode === 'custom' && this.state.outputDir
          ? this.state.outputDir.trim()
          : '';
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
          this.lblMsg.setAttribute?.('data-i18n', 'translate.statusCancelled');
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
      this.scheduleCheckpointCheck(0);
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
    this.updateModelMetaAndReasoningUI();
    this.updatePromptUI();
    this.updateAdvancedTuningUI();
    this.updateCheckpointBannerUI();
    this.renderSourceCues();
    this.renderTargetCues();
    if (this.sourceList) this.sourceList.scrollTop = 0;
    if (this.targetList) this.targetList.scrollTop = 0;
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
      } else {
        const msgI18nKey = this.lblMsg.getAttribute?.('data-i18n');
        if (msgI18nKey) {
          this.lblMsg.textContent = t(msgI18nKey);
        }
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
    if (this.deckResizeObserver) {
      this.deckResizeObserver.disconnect();
      this.deckResizeObserver = null;
    }
    if (this.openDirCooldownTimer) {
      clearTimeout(this.openDirCooldownTimer);
      this.openDirCooldownTimer = null;
    }
    this.checkpointCheckSeq++;
    if (this.checkpointCheckTimer) {
      clearTimeout(this.checkpointCheckTimer);
      this.checkpointCheckTimer = null;
    }
    this.isOpeningOutputDir = false;
  }
}

export const translationStudioController = new TranslationStudioController();
(window as any).translationStudioController = translationStudioController;
