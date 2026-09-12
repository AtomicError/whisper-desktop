import { t } from './i18n/index';
import { hardsubController } from './hardsub';

const invoke = async <T>(cmd: string, args: Record<string, any> = {}): Promise<T> => {
  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return await tauri.core.invoke(cmd, args);
  }
  throw new Error(`Tauri core API not available for command: ${cmd}`);
};

const listen = async <T>(event: string, handler: (e: { payload: T }) => void) => {
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
  subtitleSize: number;
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

function escapeHTML(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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

function parseTimeToMs(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(',', '.');
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
    const lrcRegex = /\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\](.*)/;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(lrcRegex);
      if (match) {
        const timeStr = match[1];
        const text = match[2].trim();
        const startMs = parseTimeToMs(timeStr);
        cues.push({
          id: cueId++,
          startMs,
          endMs: startMs + 3000,
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
      if (trimmed) {
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

      // Skip VTT metadata blocks (NOTE, STYLE, REGION)
      if (extLower === 'vtt') {
        const trimmedStart = line.trimStart();
        if (trimmedStart.startsWith('NOTE') || trimmedStart.startsWith('STYLE') || trimmedStart.startsWith('REGION')) {
          i++;
          while (i < total && lines[i].trim() !== '') {
            i++;
          }
          continue;
        }
      }

      if (line.includes('-->')) {
        const times = line.split('-->');
        if (times.length === 2) {
          const startStr = times[0].trim().split(' ')[0];
          const endStr = times[1].trim().split(' ')[0];

          // Collect dialogue lines until next empty line or next timeline
          const dialogueParts: string[] = [];
          i++;
          while (i < total && lines[i].trim() !== '' && !lines[i].includes('-->')) {
            // Check if this line is actually a cue number for the subsequent timeline
            const nextLineIsTimeline = (i + 1 < total) && lines[i + 1].includes('-->');
            if (/^\d+$/.test(lines[i].trim()) && nextLineIsTimeline) {
              lastPotentialCueNum = lines[i].trim();
              break;
            }
            dialogueParts.push(lines[i]);
            i++;
          }

          const rawText = dialogueParts.join('\n').replace(/<[^>]+>/g, '').trim();
          if (rawText || startStr) {
            const parsedId = lastPotentialCueNum && /^\d+$/.test(lastPotentialCueNum)
              ? parseInt(lastPotentialCueNum, 10)
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
          lastPotentialCueNum = '';
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
  private companionChip: HTMLElement | null = null;
  private lblCompanionName: HTMLElement | null = null;

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

  // Hardsub CTA
  private hardsubCtaCard: HTMLElement | null = null;
  private btnSendToHardsub: HTMLButtonElement | null = null;

  private isSyncingScroll: boolean = false;

  public state: TranslationStudioState = {
    subtitlePath: '',
    subtitleName: '',
    subtitleSize: 0,
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
    polishPass: true,
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
    this.companionChip = document.getElementById('translate-companion-chip');
    this.lblCompanionName = document.getElementById('lbl-companion-video-name');

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

    this.hardsubCtaCard = document.getElementById('translate-hardsub-cta-card');
    this.btnSendToHardsub = document.getElementById('btn-send-to-hardsub') as HTMLButtonElement;
  }

  private setupEventListeners() {
    this.dropZone?.addEventListener('click', (e) => {
      if (this.state.subtitlePath) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      this.browseSubtitleFile();
    });

    this.btnBrowseSub?.addEventListener('click', () => this.browseSubtitleFile());
    this.btnClearSub?.addEventListener('click', () => this.clearLoadedSubtitle());

    this.targetLangSelect?.addEventListener('change', () => {
      if (this.targetLangSelect) {
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

    this.providerSelect?.addEventListener('change', () => {
      if (this.providerSelect) {
        this.state.activeProvider = this.providerSelect.value;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiProvider = this.state.activeProvider;
          const globalProviderSelect = document.getElementById('opt-translateAiProvider') as HTMLSelectElement;
          if (globalProviderSelect) {
            globalProviderSelect.value = this.state.activeProvider;
          }
          if (typeof win.onProviderChanged === 'function') {
            win.onProviderChanged(true, true);
          }
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
        this.refreshModelOptions();
      }
    });

    this.modelSelect?.addEventListener('change', () => {
      if (this.modelSelect) {
        this.state.activeModel = this.modelSelect.value;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiModel = this.state.activeModel;
          const globalModelSelect = document.getElementById('opt-translateAiModel') as HTMLSelectElement;
          if (globalModelSelect) {
            globalModelSelect.value = this.state.activeModel;
          }
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
        this.updateActionButtons();
      }
    });

    this.btnManageProviders?.addEventListener('click', () => {
      const win = window as any;
      if (typeof win.switchView === 'function') {
        win.switchView('settings');
        if (typeof win.switchSettingsTab === 'function') {
          win.switchSettingsTab('translation');
        }
      }
    });

    this.polishToggle?.addEventListener('change', () => {
      if (this.polishToggle) {
        this.state.polishPass = this.polishToggle.checked;
        const win = window as any;
        if (win.settingsState) {
          win.settingsState.translateAiPolish = this.state.polishPass;
          const globalPolish = document.getElementById('opt-translateAiPolish') as HTMLInputElement;
          if (globalPolish) globalPolish.checked = this.state.polishPass;
          if (typeof win.saveCurrentSettings === 'function') {
            win.saveCurrentSettings();
          }
        }
      }
    });

    this.btnBrowseDir?.addEventListener('click', () => this.browseOutputDir());
    this.btnResetDir?.addEventListener('click', () => {
      this.state.outputDir = '';
      this.updateOutputDirUI();
    });

    this.btnStart?.addEventListener('click', () => this.startTranslation());
    this.btnCancel?.addEventListener('click', () => this.cancelTranslation());

    this.btnCopy?.addEventListener('click', () => this.copyTranslatedText());
    this.btnOpenFolder?.addEventListener('click', () => this.openOutputFolder());

    this.btnViewSplit?.addEventListener('click', () => this.setViewMode('split'));
    this.btnViewSource?.addEventListener('click', () => this.setViewMode('source'));
    this.btnViewTarget?.addEventListener('click', () => this.setViewMode('target'));

    this.btnSendToHardsub?.addEventListener('click', () => this.sendToHardsubStudio());

    this.setupSynchronizedScrolling();
    this.setupSynchronizedHighlighting();

    // Re-render strings when language changes globally
    window.addEventListener('whisper:languageChanged', () => {
      this.refreshLocalization();
    });
  }

  private setupSynchronizedHighlighting() {
    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;

      this.sourceList?.querySelectorAll(`.translate-cue-item[data-id="${cueId}"]`).forEach(el => el.classList.add('highlighted'));
      this.targetList?.querySelectorAll(`.translate-cue-item[data-id="${cueId}"]`).forEach(el => el.classList.add('highlighted'));
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('.translate-cue-item') as HTMLElement | null;
      if (!target) return;
      const cueId = target.dataset.id;
      if (!cueId) return;

      this.sourceList?.querySelectorAll(`.translate-cue-item[data-id="${cueId}"]`).forEach(el => el.classList.remove('highlighted'));
      this.targetList?.querySelectorAll(`.translate-cue-item[data-id="${cueId}"]`).forEach(el => el.classList.remove('highlighted'));
    };

    this.sourceList?.addEventListener('mouseover', handleMouseOver);
    this.sourceList?.addEventListener('mouseout', handleMouseOut);
    this.targetList?.addEventListener('mouseover', handleMouseOver);
    this.targetList?.addEventListener('mouseout', handleMouseOut);
  }

  private setupSynchronizedScrolling() {
    if (!this.sourceList || !this.targetList) return;

    this.sourceList.addEventListener('scroll', () => {
      if (this.isSyncingScroll || this.state.viewMode !== 'split') return;
      this.isSyncingScroll = true;
      if (this.sourceList && this.targetList) {
        const scrollRange = this.sourceList.scrollHeight - this.sourceList.clientHeight;
        if (scrollRange > 0) {
          const ratio = this.sourceList.scrollTop / scrollRange;
          this.targetList.scrollTop = ratio * (this.targetList.scrollHeight - this.targetList.clientHeight);
        }
      }
      requestAnimationFrame(() => { this.isSyncingScroll = false; });
    });

    this.targetList.addEventListener('scroll', () => {
      if (this.isSyncingScroll || this.state.viewMode !== 'split') return;
      this.isSyncingScroll = true;
      if (this.sourceList && this.targetList) {
        const scrollRange = this.targetList.scrollHeight - this.targetList.clientHeight;
        if (scrollRange > 0) {
          const ratio = this.targetList.scrollTop / scrollRange;
          this.sourceList.scrollTop = ratio * (this.sourceList.scrollHeight - this.sourceList.clientHeight);
        }
      }
      requestAnimationFrame(() => { this.isSyncingScroll = false; });
    });
  }

  private setupDropZone() {
    if (!this.dropZone) return;

    const highlight = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone?.classList.add('drag-over');
    };

    const unhighlight = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone?.classList.remove('drag-over');
    };

    this.dropZone.addEventListener('dragenter', highlight);
    this.dropZone.addEventListener('dragover', highlight);
    this.dropZone.addEventListener('dragleave', unhighlight);
    this.dropZone.addEventListener('drop', async (e: DragEvent) => {
      unhighlight(e);
      if (this.state.isTranslating) return;

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const path = (file as any).path || file.name;
        await this.loadSubtitleFile(path);
      }
    });

    const tauri = (window as any).__TAURI__;
    if (tauri && tauri.event && tauri.event.listen) {
      tauri.event.listen('tauri://drag-drop', async (event: any) => {
        const paths = event.payload?.paths;
        if (Array.isArray(paths) && paths.length > 0) {
          const path = paths[0];
          const ext = path.split('.').pop()?.toLowerCase();
          if (ext && (SUPPORTED_TRANSLATION_EXTENSIONS as readonly string[]).includes(ext)) {
            const activePanel = document.querySelector('.view-panel.active');
            if (activePanel && activePanel.id === 'panel-translate') {
              await this.loadSubtitleFile(path);
            }
          }
        }
      });
    }
  }

  public async browseSubtitleFile() {
    try {
      const selectedPath = await invoke<string | null>('select_subtitle_file');
      if (selectedPath) {
        await this.loadSubtitleFile(selectedPath);
      }
    } catch (err) {
      console.error('Failed to select subtitle file:', err);
      this.notify(t('translate.noSubSelectedError'), 'error');
    }
  }

  public async loadSubtitleFile(filePath: string) {
    if (!filePath) return;

    const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (!(SUPPORTED_TRANSLATION_EXTENSIONS as readonly string[]).includes(ext)) {
      this.notify(t('translate.unsupportedFormatError'), 'error');
      return;
    }

    try {
      const content = await invoke<string>('read_text_file_content', { filePath });

      this.state.subtitlePath = filePath;
      this.state.subtitleName = fileName;
      this.state.subtitleExt = ext;
      this.state.subtitleSize = content.length;
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
      if (this.lblPct) this.lblPct.textContent = '0%';
      if (this.lblLines) this.lblLines.style.display = 'none';
      if (this.lblMsg) this.lblMsg.textContent = '';
      if (this.statusBadge) {
        this.statusBadge.textContent = t('translate.statusReady');
        this.statusBadge.className = 'translate-status-badge';
      }

      this.updateSubtitleInfoUI();
      this.renderSourceCues();
      this.renderTargetCues();
      this.updateActionButtons();
      this.detectCompanionVideo(filePath);
    } catch (err: any) {
      console.error('Failed to load subtitle file:', err);
      this.notify(String(err || t('translate.noSubSelectedError')), 'error');
    }
  }

  public clearLoadedSubtitle() {
    if (this.state.isTranslating) return;
    this.state.subtitlePath = '';
    this.state.subtitleName = '';
    this.state.subtitleSize = 0;
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
    if (this.lblPct) this.lblPct.textContent = '0%';
    if (this.lblLines) this.lblLines.style.display = 'none';
    if (this.lblMsg) this.lblMsg.textContent = '';
    if (this.statusBadge) {
      this.statusBadge.textContent = t('translate.statusReady');
      this.statusBadge.className = 'translate-status-badge';
    }

    this.updateSubtitleInfoUI();
    this.renderSourceCues();
    this.renderTargetCues();
    this.updateActionButtons();
  }

  private async detectCompanionVideo(subtitlePath: string) {
    this.state.companionVideoPath = null;
    if (this.companionChip) this.companionChip.style.display = 'none';

    const lastDot = subtitlePath.lastIndexOf('.');
    if (lastDot <= 0) return;
    const baseStem = subtitlePath.substring(0, lastDot);
    const videoExtensions = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v'];

    // Also check if baseStem ends with a language code (e.g. movie.en or movie.fa)
    const strippedStem = baseStem.replace(/\.[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)?$/, '');
    const candidateStems = [baseStem];
    if (strippedStem && strippedStem !== baseStem) {
      candidateStems.push(strippedStem);
    }

    for (const stem of candidateStems) {
      for (const ext of videoExtensions) {
        const candidate = `${stem}${ext}`;
        try {
          await invoke('probe_media_file', { filePath: candidate });
          this.state.companionVideoPath = candidate;
          if (this.companionChip && this.lblCompanionName) {
            const candidateName = candidate.split(/[\/\\]/).pop() || '';
            this.lblCompanionName.textContent = candidateName;
            this.companionChip.title = candidate;
            this.companionChip.style.display = 'inline-flex';
          }
          return;
        } catch (_) {
          // Not found, continue searching
        }
      }
    }
  }

  private updateSubtitleInfoUI() {
    if (!this.lblSubName || !this.lblSubPath || !this.lblSubMeta || !this.btnClearSub) return;

    if (this.state.subtitlePath) {
      this.lblSubName.textContent = this.state.subtitleName;
      this.lblSubName.title = this.state.subtitlePath;
      this.lblSubPath.textContent = this.state.subtitlePath;
      this.lblSubPath.title = this.state.subtitlePath;

      const cueCount = this.state.sourceCues.length;
      const sizeStr = formatBytes(this.state.subtitleSize);
      const extUpper = this.state.subtitleExt.toUpperCase();
      this.lblSubMeta.textContent = `${extUpper} • ${t('translate.cuesCount', { count: cueCount })} • ${sizeStr}`;
      this.lblSubMeta.style.display = 'inline-flex';

      this.btnClearSub.style.display = 'inline-flex';
      this.dropZone?.classList.add('has-file');
      this.dropZone?.setAttribute('title', this.state.subtitlePath);
    } else {
      this.lblSubName.textContent = t('translate.noSubLoaded');
      this.lblSubName.removeAttribute('title');
      this.lblSubPath.textContent = t('translate.dropSubPrompt');
      this.lblSubPath.removeAttribute('title');
      this.lblSubMeta.style.display = 'none';
      this.btnClearSub.style.display = 'none';
      this.dropZone?.classList.remove('has-file');
      this.dropZone?.setAttribute('title', t('translate.dropSubPrompt'));
      if (this.companionChip) {
        this.companionChip.style.display = 'none';
        this.companionChip.removeAttribute('title');
      }
    }

    this.updateOutputDirUI();
  }

  private updateOutputDirUI() {
    if (!this.outputDirText || !this.btnResetDir) return;
    if (this.state.outputDir) {
      this.outputDirText.textContent = this.state.outputDir;
      this.outputDirText.title = this.state.outputDir;
      this.outputDirText.classList.add('has-custom-path');
      this.btnResetDir.style.display = 'inline-flex';
    } else {
      this.outputDirText.textContent = t('translate.sameAsSource');
      this.outputDirText.removeAttribute('title');
      this.outputDirText.classList.remove('has-custom-path');
      this.btnResetDir.style.display = 'none';
    }
  }

  public async browseOutputDir() {
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected) {
        this.state.outputDir = selected;
        this.updateOutputDirUI();
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  }

  public syncFromGlobalSettings() {
    const win = window as any;
    const settings = win.settingsState;
    if (!settings) return;

    if (settings.translateAiTargetLang) {
      this.state.targetLang = settings.translateAiTargetLang;
      if (this.targetLangSelect && this.targetLangSelect.value !== this.state.targetLang) {
        this.targetLangSelect.value = this.state.targetLang;
        this.targetLangSelect.dispatchEvent(new Event('change'));
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
      opt.textContent = t('translate.noModelError');
      this.providerSelect.appendChild(opt);
      this.refreshModelOptions();
      return;
    }

    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      this.providerSelect?.appendChild(opt);
    });

    const activeName = settings.translateAiProvider || (providers[0] ? providers[0].name : '');
    this.state.activeProvider = activeName;
    this.providerSelect.value = activeName;

    this.refreshModelOptions();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  public refreshModelOptions() {
    if (!this.modelSelect) return;
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
      opt.textContent = t('translate.noModelError');
      this.modelSelect.appendChild(opt);
      this.state.activeModel = '';
      this.updateActionButtons();
      return;
    }

    const enabledModels = provider.models.filter((m: any) => m.enabled !== false);
    if (enabledModels.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('translate.noModelError');
      this.modelSelect.appendChild(opt);
      this.state.activeModel = '';
      this.updateActionButtons();
      return;
    }

    enabledModels.forEach((m: any) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      this.modelSelect?.appendChild(opt);
    });

    const hasCurrent = enabledModels.some((m: any) => m.id === settings.translateAiModel);
    this.state.activeModel = hasCurrent ? settings.translateAiModel : enabledModels[0].id;
    this.modelSelect.value = this.state.activeModel;

    this.updateActionButtons();

    if (typeof win.syncCustomSelects === 'function') {
      win.syncCustomSelects();
    }
  }

  private renderSourceCues() {
    if (!this.sourceList || !this.sourceCountBadge) return;
    this.sourceCountBadge.textContent = String(this.state.sourceCues.length);

    if (this.state.sourceCues.length === 0) {
      this.sourceList.innerHTML = `
        <div class="translate-empty-pane">
          <svg class="translate-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <div class="translate-empty-title">${escapeHTML(t('translate.emptySourceTitle'))}</div>
          <div class="translate-empty-desc">${escapeHTML(t('translate.emptySourceDesc'))}</div>
        </div>
      `;
      return;
    }

    const html = this.state.sourceCues.map(cue => `
      <div class="translate-cue-item" data-id="${cue.id}">
        <div class="translate-cue-header">
          <span class="translate-cue-num">#${cue.id}</span>
          ${cue.startTimeStr ? `<span class="translate-cue-time">${escapeHTML(cue.startTimeStr)}${cue.endTimeStr ? ` ➔ ${escapeHTML(cue.endTimeStr)}` : ''}</span>` : ''}
        </div>
        <div class="translate-cue-text">${escapeHTML(cue.text)}</div>
      </div>
    `).join('');

    this.sourceList.innerHTML = html;
  }

  private renderTargetCues() {
    if (!this.targetList || !this.targetCountBadge) return;
    this.targetCountBadge.textContent = String(this.state.translatedCues.length);

    if (this.state.translatedCues.length === 0) {
      this.targetList.innerHTML = `
        <div class="translate-empty-pane">
          <svg class="translate-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="m5 8 6 6"/>
            <path d="m4 14 6-6 2-3"/>
            <path d="M2 5h12"/>
            <path d="M7 2h1"/>
            <path d="m22 22-5-10-5 10"/>
            <path d="M14 18h6"/>
          </svg>
          <div class="translate-empty-title">${escapeHTML(t('translate.emptyTargetTitle'))}</div>
          <div class="translate-empty-desc">${escapeHTML(t('translate.emptyTargetDesc'))}</div>
        </div>
      `;
      return;
    }

    const html = this.state.translatedCues.map(cue => `
      <div class="translate-cue-item translate-cue-translated" data-id="${cue.id}">
        <div class="translate-cue-header">
          <span class="translate-cue-num">#${cue.id}</span>
          ${cue.startTimeStr ? `<span class="translate-cue-time">${escapeHTML(cue.startTimeStr)}${cue.endTimeStr ? ` ➔ ${escapeHTML(cue.endTimeStr)}` : ''}</span>` : ''}
        </div>
        <div class="translate-cue-text translate-cue-text-target" dir="auto">${escapeHTML(cue.text)}</div>
      </div>
    `).join('');

    this.targetList.innerHTML = html;
  }

  private updateActionButtons() {
    const hasSub = !!this.state.subtitlePath;
    const isTranslating = this.state.isTranslating;

    if (this.btnStart) {
      this.btnStart.disabled = !hasSub || isTranslating || !this.state.activeModel;
    }
    if (this.btnStartText) {
      this.btnStartText.textContent = isTranslating ? t('translate.translating') : t('translate.startTranslate');
    }
    if (this.btnCancel) {
      this.btnCancel.style.display = isTranslating ? 'inline-flex' : 'none';
      this.btnCancel.disabled = false;
    }
    if (this.telemetryBox) {
      this.telemetryBox.style.display = (isTranslating || this.state.progress > 0) ? 'block' : 'none';
    }

    const hasTranslation = !this.state.isTranslating && !!this.state.translatedPath && this.state.translatedCues.length > 0;
    if (this.btnCopy) {
      this.btnCopy.disabled = !hasTranslation;
      this.btnCopy.title = hasTranslation ? t('translate.copyTranslation') : t('translate.emptyTargetTitle');
    }
    if (this.btnOpenFolder) {
      this.btnOpenFolder.disabled = !hasTranslation;
      this.btnOpenFolder.title = hasTranslation ? t('translate.openOutputFolder') : t('translate.emptyTargetTitle');
    }
    if (this.btnSendToHardsub) {
      this.btnSendToHardsub.disabled = !hasTranslation;
      this.btnSendToHardsub.title = hasTranslation ? t('translate.sendToHardsub') : t('translate.emptyTargetTitle');
    }
  }

  private listenToProgressEvents() {
    listen<any>('translation-status', (event) => {
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

      // When translation is complete or progress reached 100%, line counter should display full completion (e.g. 12 / 12)
      const isCancelled = payload.message === 'Translation cancelled';
      const isComplete = !isCancelled && (payload.message === 'AI translation complete' || (!payload.active && (progressVal >= 1.0 || pct >= 100)));
      if (isComplete && this.state.totalLines > 0) {
        this.state.currentLine = this.state.totalLines;
      } else if (this.state.totalLines > 0 && this.state.currentLine > this.state.totalLines) {
        this.state.currentLine = this.state.totalLines;
      }

      if (this.telemetryBox) {
        this.telemetryBox.style.display = (payload.active || this.state.progress > 0 || isComplete) ? 'block' : 'none';
      }

      if (this.progressFill) {
        this.progressFill.style.width = `${pct}%`;
      }
      if (this.lblPct) {
        this.lblPct.textContent = `${pct}%`;
      }
      if (this.lblLines) {
        if (this.state.totalLines > 0) {
          this.lblLines.textContent = `${this.state.currentLine} / ${this.state.totalLines}`;
          this.lblLines.style.display = 'inline';
        } else {
          this.lblLines.style.display = 'none';
        }
      }
      if (this.lblMsg && payload.message) {
        this.lblMsg.textContent = payload.message;
      }
      if (this.statusBadge) {
        if (payload.active) {
          this.statusBadge.textContent = t('translate.statusTranslating');
          this.statusBadge.className = 'translate-status-badge active';
        } else if (isCancelled) {
          this.statusBadge.textContent = t('translate.statusCancelled');
          this.statusBadge.className = 'translate-status-badge cancelled';
        } else if (payload.message === 'AI translation complete' || isComplete) {
          this.statusBadge.textContent = t('translate.statusComplete');
          this.statusBadge.className = 'translate-status-badge complete';
        }
      }
    });
  }

  public async startTranslation() {
    if (!this.state.subtitlePath) {
      this.notify(t('translate.noSubSelectedError'), 'error');
      return;
    }
    if (!this.state.activeModel) {
      this.notify(t('translate.noModelError'), 'error');
      return;
    }

    const win = window as any;
    let globalSettings = win.settingsState;
    if (!globalSettings) {
      try {
        globalSettings = await invoke('load_settings');
        win.settingsState = globalSettings;
      } catch (_) {
        globalSettings = {};
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

    this.state.isTranslating = true;
    this.state.progress = 0;
    this.state.currentLine = 0;
    this.state.translatedPath = '';
    this.state.translatedName = '';
    this.state.translatedRawText = '';
    this.state.translatedCues = [];
    this.renderTargetCues();

    if (!this.state.totalLines && this.state.sourceCues.length > 0) {
      this.state.totalLines = this.state.sourceCues.length;
    }
    if (this.progressFill) this.progressFill.style.width = '0%';
    if (this.lblPct) this.lblPct.textContent = '0%';
    if (this.lblLines && this.state.totalLines > 0) {
      this.lblLines.textContent = `0 / ${this.state.totalLines}`;
      this.lblLines.style.display = 'inline';
    }
    if (this.lblMsg) this.lblMsg.textContent = '';
    this.updateActionButtons();

    if (this.statusBadge) {
      this.statusBadge.textContent = t('translate.statusTranslating');
      this.statusBadge.className = 'translate-status-badge active';
    }

    try {
      const translatedFiles = await invoke<string[]>('translate_transcription_files', {
        settings: runSettings,
        generatedFiles: [fileName],
        parentDir: parentDir,
      });

      if (translatedFiles && translatedFiles.length > 0) {
        const outName = translatedFiles[0];
        let outPath = joinPath(parentDir, outName);

        if (this.state.outputDir && this.state.outputDir !== parentDir) {
          try {
            const outContent = await invoke<string>('read_text_file_content', { filePath: outPath });
            const customPath = joinPath(this.state.outputDir, outName);
            await invoke('write_text_file_content', { filePath: customPath, content: outContent });
            outPath = customPath;
          } catch (writeErr) {
            console.warn('Could not mirror translated file to custom outputDir:', writeErr);
          }
        }

        this.state.translatedPath = outPath;
        this.state.translatedName = outName;

        const transContent = await invoke<string>('read_text_file_content', { filePath: outPath });
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
        if (this.lblPct) this.lblPct.textContent = '100%';
        if (this.lblLines && this.state.totalLines > 0) {
          this.lblLines.textContent = `${this.state.currentLine} / ${this.state.totalLines}`;
          this.lblLines.style.display = 'inline';
        }

        if (this.statusBadge) {
          this.statusBadge.textContent = t('translate.statusComplete');
          this.statusBadge.className = 'translate-status-badge complete';
        }

        this.notify(t('translate.translationSuccess'), 'success');
      } else {
        if (this.statusBadge) {
          this.statusBadge.textContent = t('translate.statusReady');
          this.statusBadge.className = 'translate-status-badge';
        }
        this.notify(t('translate.emptyTranslationError'), 'error');
      }
    } catch (err: any) {
      const errMsg = String(err || '');
      if (errMsg.toLowerCase().includes('cancelled')) {
        if (this.statusBadge) {
          this.statusBadge.textContent = t('translate.statusCancelled');
          this.statusBadge.className = 'translate-status-badge cancelled';
        }
        this.notify(t('translate.translationCancelledToast'), 'info');
      } else {
        if (this.statusBadge) {
          this.statusBadge.textContent = t('translate.statusReady');
          this.statusBadge.className = 'translate-status-badge';
        }
        this.notify(t('translate.translationError', { error: errMsg }), 'error');
      }
    } finally {
      this.state.isTranslating = false;
      this.updateActionButtons();
    }
  }

  public async cancelTranslation() {
    try {
      if (this.btnCancel) {
        this.btnCancel.disabled = true;
      }
      await invoke('cancel_transcription');
    } catch (err) {
      console.error('Failed to cancel translation:', err);
    }
  }

  public async copyTranslatedText() {
    if (!this.state.translatedPath || (!this.state.translatedRawText && this.state.translatedCues.length === 0)) return;
    const textToCopy = this.state.translatedRawText || this.state.translatedCues.map(c => c.text).join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        await invoke('copy_to_clipboard', { text: textToCopy });
      }
      this.notify(t('translate.copiedTranslation'), 'success');
    } catch (e) {
      try {
        await invoke('copy_to_clipboard', { text: textToCopy });
        this.notify(t('translate.copiedTranslation'), 'success');
      } catch (invokeErr) {
        console.error('Failed to copy to clipboard:', invokeErr);
      }
    }
  }

  public async openOutputFolder() {
    if (!this.state.translatedPath) return;
    const targetFolder = getParentDir(this.state.translatedPath);
    if (!targetFolder) return;
    try {
      const win = window as any;
      if (typeof win.openFileInEditor === 'function') {
        await win.openFileInEditor(targetFolder);
        return;
      }
      await invoke('open_file_in_editor', { filePath: targetFolder });
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  }

  public setViewMode(mode: 'split' | 'source' | 'target') {
    this.state.viewMode = mode;
    [this.btnViewSplit, this.btnViewSource, this.btnViewTarget].forEach(btn => btn?.classList.remove('active'));

    if (mode === 'split') this.btnViewSplit?.classList.add('active');
    else if (mode === 'source') this.btnViewSource?.classList.add('active');
    else if (mode === 'target') this.btnViewTarget?.classList.add('active');

    if (this.previewGrid && this.sourcePane && this.targetPane) {
      if (mode === 'split') {
        this.previewGrid.classList.remove('view-source-only', 'view-target-only');
        this.sourcePane.style.display = 'flex';
        this.targetPane.style.display = 'flex';
      } else if (mode === 'source') {
        this.previewGrid.classList.add('view-source-only');
        this.previewGrid.classList.remove('view-target-only');
        this.sourcePane.style.display = 'flex';
        this.targetPane.style.display = 'none';
      } else if (mode === 'target') {
        this.previewGrid.classList.add('view-target-only');
        this.previewGrid.classList.remove('view-source-only');
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

    if (hardsubController && typeof hardsubController.prefillFilePaths === 'function') {
      hardsubController.prefillFilePaths(this.state.companionVideoPath || '', subToLoad);
    }

    const win = window as any;
    if (typeof win.switchView === 'function') {
      win.switchView('hardsub');
    }

    this.notify(t('translate.sendToHardsubDesc'), 'info');
  }

  public refreshLocalization() {
    this.updateSubtitleInfoUI();
    this.renderSourceCues();
    this.renderTargetCues();
    this.updateActionButtons();
  }

  private notify(msg: string, type: 'info' | 'success' | 'error' = 'info') {
    const win = window as any;
    if (typeof win.showNotification === 'function') {
      win.showNotification(msg, type);
    } else {
      console.log(`[Notification ${type}]: ${msg}`);
    }
  }
}

export const translationStudioController = new TranslationStudioController();
(window as any).translationStudioController = translationStudioController;
