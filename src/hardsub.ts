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

function convertFileSrc(filePath: string): string {
  let cleanPath = filePath.trim();
  if (cleanPath.startsWith('file://')) {
    cleanPath = decodeURIComponent(cleanPath.substring(7));
  }

  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.core && tauri.core.convertFileSrc) {
    return tauri.core.convertFileSrc(cleanPath);
  }
  if (tauri && tauri.tauri && tauri.tauri.convertFileSrc) {
    return tauri.tauri.convertFileSrc(cleanPath);
  }
  return cleanPath.startsWith('/') ? `asset://localhost${cleanPath}` : cleanPath;
}

export interface FontItem {
  name: string;
  source: string;
}

export interface HardwareStatus {
  hasQsv: boolean;
  hasNvenc: boolean;
  hasVaapi: boolean;
}

export interface HardsubSettings {
  videoPath: string;
  subtitlePath: string;
  outputPath: string;
  outputFormat: string;
  videoCodec: string;
  hwAccel: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineSize: number;
  bgBox: boolean;
  bgBoxColor: string;
  positionY: number;
  widthMargin: number;
  bold: boolean;
  italic: boolean;
  alignment: number;
  audioMode: string;
}

export interface SubtitleCue {
  id: number;
  startMs: number;
  endMs: number;
  startTimeStr: string;
  endTimeStr: string;
  text: string;
}

function parseTimeToMs(timeStr: string): number {
  const parts = timeStr.trim().split(/[:,\.]/);
  if (parts.length < 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseInt(parts[2], 10) || 0;
  let ms = 0;
  if (parts[3]) {
    const rawMs = parts[3].padEnd(3, '0').substring(0, 3);
    ms = parseInt(rawMs, 10) || 0;
  }
  return h * 3600000 + m * 60000 + s * 1000 + ms;
}

function msToSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const msec = Math.floor(ms % 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msec).padStart(3, '0')}`;
}

function formatSecondsToDisplay(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseSubtitleContent(content: string, ext: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (ext === 'ass') {
    const lines = normalized.split('\n');
    let inEvents = false;
    let cueId = 1;
    for (const line of lines) {
      if (line.startsWith('[Events]')) {
        inEvents = true;
        continue;
      }
      if (inEvents && line.startsWith('Dialogue:')) {
        const parts = line.substring(9).split(',');
        if (parts.length >= 10) {
          const startStr = parts[1].trim();
          const endStr = parts[2].trim();
          const text = parts.slice(9).join(',').replace(/\\N/g, '\n').replace(/\{[^}]+\}/g, '').trim();
          const startMs = parseTimeToMs(startStr);
          const endMs = parseTimeToMs(endStr);
          cues.push({
            id: cueId++,
            startMs,
            endMs,
            startTimeStr: startStr,
            endTimeStr: endStr,
            text,
          });
        }
      }
    }
  } else {
    const blocks = normalized.split(/\n\n+/);
    let cueId = 1;
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      let timeLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('-->')) {
          timeLineIdx = i;
          break;
        }
      }
      if (timeLineIdx !== -1) {
        const times = lines[timeLineIdx].split('-->');
        if (times.length === 2) {
          const startStr = times[0].trim();
          const endStr = times[1].trim();
          const text = lines.slice(timeLineIdx + 1).join('\n').trim();
          const startMs = parseTimeToMs(startStr);
          const endMs = parseTimeToMs(endStr);
          cues.push({
            id: cueId++,
            startMs,
            endMs,
            startTimeStr: startStr.split(' ')[0],
            endTimeStr: endStr.split(' ')[0],
            text,
          });
        }
      }
    }
  }
  return cues;
}

function convertCuesToSrt(cues: SubtitleCue[]): string {
  return cues
    .map((cue, idx) => {
      return `${idx + 1}\n${msToSrtTime(cue.startMs)} --> ${msToSrtTime(cue.endMs)}\n${cue.text}\n`;
    })
    .join('\n');
}

export class HardsubController {
  private videoPathInput: HTMLInputElement | null = null;
  private subtitlePathInput: HTMLInputElement | null = null;
  private fontSelect: HTMLSelectElement | null = null;
  private fontSizeSlider: HTMLInputElement | null = null;
  private fontSizeVal: HTMLElement | null = null;
  private positionYSlider: HTMLInputElement | null = null;
  private positionYVal: HTMLElement | null = null;
  private outlineSizeSlider: HTMLInputElement | null = null;
  private outlineSizeVal: HTMLElement | null = null;

  // Color controls
  private primaryColorPicker: HTMLInputElement | null = null;
  private outlineColorPicker: HTMLInputElement | null = null;
  private bgBoxToggle: HTMLInputElement | null = null;
  private bgBoxColorPicker: HTMLInputElement | null = null;

  // Color Swatches & Hex Indicators
  private swatchText: HTMLElement | null = null;
  private swatchOutline: HTMLElement | null = null;
  private swatchBg: HTMLElement | null = null;
  private hexTextLabel: HTMLElement | null = null;
  private hexOutlineLabel: HTMLElement | null = null;
  private hexBgLabel: HTMLElement | null = null;

  // Buttons & Toggles
  private boldToggle: HTMLButtonElement | null = null;
  private italicToggle: HTMLButtonElement | null = null;
  private formatSelect: HTMLSelectElement | null = null;
  private codecSelect: HTMLSelectElement | null = null;
  private hwSelect: HTMLSelectElement | null = null;
  private audioSelect: HTMLSelectElement | null = null;
  private alignmentButtons: NodeListOf<HTMLButtonElement> | null = null;
  private cancelBtn: HTMLButtonElement | null = null;

  // Preview elements
  private previewBox: HTMLElement | null = null;
  private previewText: HTMLElement | null = null;
  private previewInput: HTMLInputElement | null = null;

  // Real Video Player & Media Controls
  private videoElement: HTMLVideoElement | null = null;
  private videoPlaceholder: HTMLElement | null = null;
  private videoStatusBadge: HTMLElement | null = null;
  private videoPlayBtn: HTMLButtonElement | null = null;
  private videoIconPlay: HTMLElement | null = null;
  private videoIconPause: HTMLElement | null = null;
  private videoSeekSlider: HTMLInputElement | null = null;
  private videoTimeDisplay: HTMLElement | null = null;
  private prevCueBtn: HTMLButtonElement | null = null;
  private nextCueBtn: HTMLButtonElement | null = null;

  // Dual Tab Studio Navigation
  private tabBtnEditor: HTMLButtonElement | null = null;
  private tabBtnSettings: HTMLButtonElement | null = null;
  private tabViewEditor: HTMLElement | null = null;
  private tabViewSettings: HTMLElement | null = null;

  // Block Subtitle Editor Elements
  private searchInput: HTMLInputElement | null = null;
  private subtitleCountBadge: HTMLElement | null = null;
  private subtitleListContainer: HTMLElement | null = null;
  private emptyCueNotice: HTMLElement | null = null;

  // Dropzone Elements
  private videoDropZone: HTMLElement | null = null;
  private subDropZone: HTMLElement | null = null;
  private lblVideoName: HTMLElement | null = null;
  private lblVideoPath: HTMLElement | null = null;
  private lblSubName: HTMLElement | null = null;
  private lblSubPath: HTMLElement | null = null;

  // Telemetry HUD elements
  private progressFill: HTMLElement | null = null;
  private progressStatusText: HTMLElement | null = null;
  private progressPctText: HTMLElement | null = null;
  private hudPulseDot: HTMLElement | null = null;

  // Internal State
  private state: HardsubSettings = {
    videoPath: '',
    subtitlePath: '',
    outputPath: '',
    outputFormat: 'mp4',
    videoCodec: 'h264',
    hwAccel: 'cpu',
    fontName: 'Vazirmatn',
    fontSize: 24,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineSize: 2,
    bgBox: false,
    bgBoxColor: '#000000',
    positionY: 30,
    widthMargin: 90,
    bold: true,
    italic: false,
    alignment: 2, // Bottom center
    audioMode: 'copy',
  };

  private isEncoding: boolean = false;
  private subtitleCues: SubtitleCue[] = [];
  private activeCueId: number | null = null;
  private searchFilterQuery: string = '';
  private isUserSeeking: boolean = false;
  private isManualSeeking: boolean = false;
  private targetClickedCueId: number | null = null;
  private clickLockTimer: any = null;
  private isSubtitlesModified: boolean = false;

  constructor() {
    const init = () => {
      this.initDOMElements();
      this.loadFontsAndHardware();
      this.setupEventListeners();
      this.setupVideoPlayerEvents();
      this.setupStudioTabEvents();
      this.setupDragAndDropListeners();
      this.listenToProgressEvents();
      this.updateLivePreview();
      this.updateEncodingUIState(false);
      window.addEventListener('resize', () => this.updateVideoPreviewOverlayBounds());
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  private initDOMElements() {
    this.videoPathInput = document.getElementById('hardsub-video-path') as HTMLInputElement;
    this.subtitlePathInput = document.getElementById('hardsub-sub-path') as HTMLInputElement;
    this.fontSelect = document.getElementById('hardsub-font') as HTMLSelectElement;
    this.fontSizeSlider = document.getElementById('hardsub-fontsize') as HTMLInputElement;
    this.fontSizeVal = document.getElementById('hardsub-fontsize-val');
    this.positionYSlider = document.getElementById('hardsub-posy') as HTMLInputElement;
    this.positionYVal = document.getElementById('hardsub-posy-val');
    this.outlineSizeSlider = document.getElementById('hardsub-outline-size') as HTMLInputElement;
    this.outlineSizeVal = document.getElementById('hardsub-outline-val');

    this.primaryColorPicker = document.getElementById('hardsub-color-text') as HTMLInputElement;
    this.outlineColorPicker = document.getElementById('hardsub-color-outline') as HTMLInputElement;
    this.bgBoxToggle = document.getElementById('hardsub-bgbox-toggle') as HTMLInputElement;
    this.bgBoxColorPicker = document.getElementById('hardsub-color-bg') as HTMLInputElement;

    this.swatchText = document.getElementById('hardsub-swatch-text');
    this.swatchOutline = document.getElementById('hardsub-swatch-outline');
    this.swatchBg = document.getElementById('hardsub-swatch-bg');
    this.hexTextLabel = document.getElementById('hardsub-hex-text');
    this.hexOutlineLabel = document.getElementById('hardsub-hex-outline');
    this.hexBgLabel = document.getElementById('hardsub-hex-bg');

    this.boldToggle = document.getElementById('hardsub-btn-bold') as HTMLButtonElement;
    this.italicToggle = document.getElementById('hardsub-btn-italic') as HTMLButtonElement;
    this.formatSelect = document.getElementById('hardsub-format') as HTMLSelectElement;
    this.codecSelect = document.getElementById('hardsub-codec') as HTMLSelectElement;
    this.hwSelect = document.getElementById('hardsub-hw') as HTMLSelectElement;
    this.audioSelect = document.getElementById('hardsub-audio') as HTMLSelectElement;
    this.alignmentButtons = document.querySelectorAll('.align-btn');
    this.cancelBtn = document.getElementById('btn-cancel-hardsub') as HTMLButtonElement;

    this.previewBox = document.getElementById('hardsub-preview-box');
    this.previewText = document.getElementById('hardsub-preview-text');
    this.previewInput = document.getElementById('hardsub-preview-input') as HTMLInputElement;

    // Video Player & Controls
    this.videoElement = document.getElementById('hardsub-video-element') as HTMLVideoElement;
    this.videoPlaceholder = document.getElementById('hardsub-video-placeholder');
    this.videoStatusBadge = document.getElementById('hardsub-video-status-badge');
    this.videoPlayBtn = document.getElementById('hardsub-btn-play') as HTMLButtonElement;
    this.videoIconPlay = document.getElementById('hardsub-icon-play');
    this.videoIconPause = document.getElementById('hardsub-icon-pause');
    this.videoSeekSlider = document.getElementById('hardsub-video-seek') as HTMLInputElement;
    this.videoTimeDisplay = document.getElementById('hardsub-video-time');
    this.prevCueBtn = document.getElementById('hardsub-btn-prev-cue') as HTMLButtonElement;
    this.nextCueBtn = document.getElementById('hardsub-btn-next-cue') as HTMLButtonElement;

    // Dropzone Elements
    this.videoDropZone = document.getElementById('hardsub-video-drop-zone');
    this.subDropZone = document.getElementById('hardsub-sub-drop-zone');
    this.lblVideoName = document.getElementById('lbl-hardsub-video-name');
    this.lblVideoPath = document.getElementById('lbl-hardsub-video-path');
    this.lblSubName = document.getElementById('lbl-hardsub-sub-name');
    this.lblSubPath = document.getElementById('lbl-hardsub-sub-path');

    // Tabs
    this.tabBtnEditor = document.getElementById('hardsub-tab-btn-editor') as HTMLButtonElement;
    this.tabBtnSettings = document.getElementById('hardsub-tab-btn-settings') as HTMLButtonElement;
    this.tabViewEditor = document.getElementById('hardsub-tab-view-editor');
    this.tabViewSettings = document.getElementById('hardsub-tab-view-settings');

    // Subtitle Editor Block List
    this.searchInput = document.getElementById('hardsub-search-input') as HTMLInputElement;
    this.subtitleCountBadge = document.getElementById('hardsub-subtitle-count');
    this.subtitleListContainer = document.getElementById('hardsub-subtitle-list');
    this.emptyCueNotice = document.getElementById('hardsub-empty-cue-notice');

    // HUD
    this.progressFill = document.getElementById('hardsub-progress-fill');
    this.progressStatusText = document.getElementById('hardsub-status-text');
    this.progressPctText = document.getElementById('hardsub-pct-text');
    this.hudPulseDot = document.getElementById('hardsub-hud-pulse');
  }

  private async loadFontsAndHardware() {
    try {
      const fonts = await invoke<FontItem[]>('get_system_fonts');
      if (this.fontSelect && fonts.length > 0) {
        this.fontSelect.innerHTML = '';

        const bundledGroup = document.createElement('optgroup');
        bundledGroup.label = '— Bundled Fonts —';

        const systemGroup = document.createElement('optgroup');
        systemGroup.label = '— System Fonts —';

        fonts.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f.name.toString();
          opt.textContent = f.source === 'bundled' ? `★ ${f.name}` : f.name.toString();
          if (f.source === 'bundled') {
            bundledGroup.appendChild(opt);
          } else {
            systemGroup.appendChild(opt);
          }
        });

        this.fontSelect.appendChild(bundledGroup);
        this.fontSelect.appendChild(systemGroup);
        this.fontSelect.value = 'Vazirmatn';
      }
    } catch (e) {
      console.warn('Failed to load system fonts:', e);
    }

    try {
      const hwStatus = await invoke<HardwareStatus>('check_hardware_encoders');
      if (this.hwSelect) {
        const qsvOpt = this.hwSelect.querySelector('option[value="qsv"]') as HTMLOptionElement;
        const nvencOpt = this.hwSelect.querySelector('option[value="nvenc"]') as HTMLOptionElement;
        const vaapiOpt = this.hwSelect.querySelector('option[value="vaapi"]') as HTMLOptionElement;

        if (qsvOpt) {
          qsvOpt.textContent = hwStatus.hasQsv ? 'Intel QSV (QuickSync HW)' : 'Intel QSV (Not detected)';
        }
        if (nvencOpt) {
          nvencOpt.textContent = hwStatus.hasNvenc ? 'NVIDIA NVENC (GPU Acceleration)' : 'NVIDIA NVENC (Not detected)';
        }
        if (vaapiOpt) {
          vaapiOpt.textContent = hwStatus.hasVaapi ? 'Linux VA-API (AMD/Intel)' : 'Linux VA-API (Not detected)';
        }
      }
    } catch (e) {
      console.warn('Failed to probe hardware encoders:', e);
    }
  }

  private setupEventListeners() {
    // Browse Video File
    document.getElementById('btn-browse-video')?.addEventListener('click', async () => {
      const selected = await invoke<string | null>('select_file');
      if (selected) {
        if (this.videoPathInput) this.videoPathInput.value = selected;
        this.state.videoPath = selected;
        this.loadVideoMedia(selected);
        this.autoSuggestSubtitleAndOutput(selected);
      }
    });

    // Browse Subtitle File
    document.getElementById('btn-browse-sub')?.addEventListener('click', async () => {
      const selected = await invoke<string | null>('select_subtitle_file');
      if (selected) {
        if (this.subtitlePathInput) this.subtitlePathInput.value = selected;
        this.state.subtitlePath = selected;
        this.loadSubtitleFile(selected);
      }
    });

    // Font Select
    this.fontSelect?.addEventListener('change', () => {
      this.state.fontName = this.fontSelect!.value;
      this.updateLivePreview();
    });

    // Custom Live Preview Text Input
    this.previewInput?.addEventListener('input', () => {
      this.updateLivePreview();
    });

    // Font Size Slider
    this.fontSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.fontSizeSlider!.value, 10);
      this.state.fontSize = val;
      if (this.fontSizeVal) this.fontSizeVal.textContent = `${val}px`;
      this.updateLivePreview();
    });
    document.getElementById('reset-fontsize')?.addEventListener('click', () => {
      this.state.fontSize = 24;
      if (this.fontSizeSlider) this.fontSizeSlider.value = '24';
      if (this.fontSizeVal) this.fontSizeVal.textContent = '24px';
      this.updateLivePreview();
    });

    // Position Y Slider
    this.positionYSlider?.addEventListener('input', () => {
      const val = parseInt(this.positionYSlider!.value, 10);
      this.state.positionY = val;
      if (this.positionYVal) this.positionYVal.textContent = `${val}px`;
      this.updateLivePreview();
    });
    document.getElementById('reset-posy')?.addEventListener('click', () => {
      this.state.positionY = 30;
      if (this.positionYSlider) this.positionYSlider.value = '30';
      if (this.positionYVal) this.positionYVal.textContent = '30px';
      this.updateLivePreview();
    });

    // Outline Size Slider
    this.outlineSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.outlineSizeSlider!.value, 10);
      this.state.outlineSize = val;
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = `${val}px`;
      if (this.hexOutlineLabel) this.hexOutlineLabel.textContent = `${this.state.outlineColor} (${val}px)`;
      this.updateLivePreview();
    });
    document.getElementById('reset-outline')?.addEventListener('click', () => {
      this.state.outlineSize = 2;
      if (this.outlineSizeSlider) this.outlineSizeSlider.value = '2';
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = '2px';
      if (this.hexOutlineLabel) this.hexOutlineLabel.textContent = `${this.state.outlineColor} (2px)`;
      this.updateLivePreview();
    });

    // Color Pickers
    this.primaryColorPicker?.addEventListener('input', () => {
      this.state.primaryColor = this.primaryColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });

    this.outlineColorPicker?.addEventListener('input', () => {
      this.state.outlineColor = this.outlineColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });

    this.bgBoxToggle?.addEventListener('change', () => {
      this.state.bgBox = this.bgBoxToggle!.checked;
      this.updateLivePreview();
    });
    this.bgBoxColorPicker?.addEventListener('input', () => {
      this.state.bgBoxColor = this.bgBoxColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });

    // Color Preset Dots
    document.querySelectorAll('.color-preset-dot').forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const btn = e.currentTarget as HTMLButtonElement;
        const color = btn.dataset.color || '#FFFFFF';
        const target = btn.dataset.target || 'text';
        if (target === 'bg') {
          this.state.bgBoxColor = color;
          if (this.bgBoxColorPicker) this.bgBoxColorPicker.value = color;
        } else {
          this.state.primaryColor = color;
          if (this.primaryColorPicker) this.primaryColorPicker.value = color;
        }
        this.updateColorSwatches();
        this.updateLivePreview();
      });
    });

    // Bold Toggle
    this.boldToggle?.addEventListener('click', () => {
      this.state.bold = !this.state.bold;
      this.boldToggle!.classList.toggle('active', this.state.bold);
      this.updateLivePreview();
    });

    // Italic Toggle
    this.italicToggle?.addEventListener('click', () => {
      this.state.italic = !this.state.italic;
      this.italicToggle!.classList.toggle('active', this.state.italic);
      this.updateLivePreview();
    });

    // Format & Codec & HW Acceleration
    this.formatSelect?.addEventListener('change', () => {
      this.state.outputFormat = this.formatSelect!.value;
    });
    this.codecSelect?.addEventListener('change', () => {
      this.state.videoCodec = this.codecSelect!.value;
    });
    this.hwSelect?.addEventListener('change', () => {
      this.state.hwAccel = this.hwSelect!.value;
    });
    this.audioSelect?.addEventListener('change', () => {
      this.state.audioMode = this.audioSelect!.value;
    });

    // Alignment Buttons
    this.alignmentButtons?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const alignVal = parseInt(btn.dataset.align || '2', 10);
        this.state.alignment = alignVal;
        this.alignmentButtons?.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateLivePreview();
      });
    });

    // Subtitle Search Input
    this.searchInput?.addEventListener('input', () => {
      this.searchFilterQuery = this.searchInput!.value.trim().toLowerCase();
      this.renderSubtitleCards();
    });

    // Start Hardsub Button
    document.getElementById('btn-start-hardsub')?.addEventListener('click', () => {
      this.startHardsub();
    });

    // Cancel Hardsub Button
    this.cancelBtn?.addEventListener('click', async () => {
      try {
        await invoke('cancel_transcription');
        this.updateEncodingUIState(false);
      } catch (e) {
        console.warn('Cancel hardsub error:', e);
      }
    });
  }

  private setupStudioTabEvents() {
    this.tabBtnEditor?.addEventListener('click', () => {
      this.tabBtnEditor?.classList.add('active');
      this.tabBtnSettings?.classList.remove('active');
      if (this.tabViewEditor) this.tabViewEditor.style.display = 'flex';
      if (this.tabViewSettings) this.tabViewSettings.style.display = 'none';
    });

    this.tabBtnSettings?.addEventListener('click', () => {
      this.tabBtnSettings?.classList.add('active');
      this.tabBtnEditor?.classList.remove('active');
      if (this.tabViewSettings) this.tabViewSettings.style.display = 'flex';
      if (this.tabViewEditor) this.tabViewEditor.style.display = 'none';
    });
  }

  private setupVideoPlayerEvents() {
    if (!this.videoElement) return;

    // Play / Pause Toggle
    this.videoPlayBtn?.addEventListener('click', () => {
      if (this.videoElement?.paused) {
        const p = this.videoElement.play();
        if (p !== undefined) {
          p.catch((err) => console.warn('Video playback notice:', err));
        }
      } else {
        this.videoElement?.pause();
      }
    });

    this.videoElement.addEventListener('error', () => {
      const err = this.videoElement?.error;
      console.warn('HTML5 Video Error:', err);
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Format Error';
        this.videoStatusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        this.videoStatusBadge.style.color = '#EF4444';
      }
    });

    this.videoElement.addEventListener('loadedmetadata', () => {
      this.updateVideoPreviewOverlayBounds();
      this.updateLivePreview();
    });

    this.videoElement.addEventListener('seeked', () => {
      this.isManualSeeking = false;
      if (this.videoElement) {
        this.syncActiveSubtitleWithTime(this.videoElement.currentTime * 1000);
      }
    });

    this.videoElement.addEventListener('canplay', () => {
      if (this.videoStatusBadge && this.videoElement?.paused) {
        this.videoStatusBadge.textContent = 'Video Loaded';
        this.videoStatusBadge.style.background = 'rgba(45, 127, 255, 0.15)';
        this.videoStatusBadge.style.color = 'var(--color-cyan)';
      }
    });

    this.videoElement.addEventListener('playing', () => {
      if (this.videoIconPlay) this.videoIconPlay.style.display = 'none';
      if (this.videoIconPause) this.videoIconPause.style.display = 'block';
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Playing Live';
        this.videoStatusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        this.videoStatusBadge.style.color = '#10B981';
      }
    });

    this.videoElement.addEventListener('pause', () => {
      if (this.videoIconPlay) this.videoIconPlay.style.display = 'block';
      if (this.videoIconPause) this.videoIconPause.style.display = 'none';
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Paused';
        this.videoStatusBadge.style.background = 'rgba(45, 127, 255, 0.15)';
        this.videoStatusBadge.style.color = 'var(--color-cyan)';
      }
    });

    // Time update & Sync subtitle overlay
    this.videoElement.addEventListener('timeupdate', () => {
      if (!this.videoElement) return;
      const cur = this.videoElement.currentTime;
      const dur = this.videoElement.duration || 1;
      const pct = (cur / dur) * 100;

      if (!this.isUserSeeking && this.videoSeekSlider) {
        this.videoSeekSlider.value = String(pct);
        this.updateSeekSliderProgress(pct);
      }

      if (this.videoTimeDisplay) {
        this.videoTimeDisplay.textContent = `${formatSecondsToDisplay(cur)} / ${formatSecondsToDisplay(dur)}`;
      }

      this.syncActiveSubtitleWithTime(cur * 1000);
    });

    // Seek Slider Drag
    this.videoSeekSlider?.addEventListener('input', () => {
      this.isUserSeeking = true;
      if (this.videoElement && this.videoSeekSlider) {
        const pct = parseFloat(this.videoSeekSlider.value);
        this.updateSeekSliderProgress(pct);
        const targetTime = (this.videoElement.duration || 0) * (pct / 100);
        this.videoElement.currentTime = targetTime;
      }
    });

    this.videoSeekSlider?.addEventListener('change', () => {
      this.isUserSeeking = false;
    });

    // Jump to Prev / Next Cue
    this.prevCueBtn?.addEventListener('click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const prev = [...this.subtitleCues].reverse().find((c) => c.startMs < curMs - 300);
      if (prev) {
        this.videoElement.currentTime = prev.startMs / 1000;
      }
    });

    this.nextCueBtn?.addEventListener('click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const next = this.subtitleCues.find((c) => c.startMs > curMs + 100);
      if (next) {
        this.videoElement.currentTime = next.startMs / 1000;
      }
    });
  }

  private setupDragAndDropListeners() {
    const videoDrop = document.getElementById('hardsub-video-drop-zone');
    const subDrop = document.getElementById('hardsub-sub-drop-zone');
    const hardsubPanel = document.getElementById('panel-hardsub');

    const handleFiles = (files: string[]) => {
      files.forEach((filePath) => {
        const lower = filePath.toLowerCase();
        if (
          lower.endsWith('.mp4') ||
          lower.endsWith('.mkv') ||
          lower.endsWith('.webm') ||
          lower.endsWith('.mov') ||
          lower.endsWith('.avi') ||
          lower.endsWith('.flv') ||
          lower.endsWith('.wmv') ||
          lower.endsWith('.m4v')
        ) {
          if (this.videoPathInput) this.videoPathInput.value = filePath;
          this.state.videoPath = filePath;
          this.loadVideoMedia(filePath);
          this.autoSuggestSubtitleAndOutput(filePath);
        } else if (
          lower.endsWith('.srt') ||
          lower.endsWith('.vtt') ||
          lower.endsWith('.ass') ||
          lower.endsWith('.lrc')
        ) {
          if (this.subtitlePathInput) this.subtitlePathInput.value = filePath;
          this.state.subtitlePath = filePath;
          this.loadSubtitleFile(filePath);
        }
      });
    };

    [videoDrop, subDrop].forEach((zone) => {
      if (!zone) return;

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
      });

      zone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');
      });

      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const filePaths: string[] = Array.from(e.dataTransfer.files).map(
            (f: any) => f.path || f.name
          );
          handleFiles(filePaths);
        }
      });
    });

    listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
      if (hardsubPanel && hardsubPanel.style.display !== 'none') {
        const files = event.payload.paths;
        if (files && files.length > 0) {
          handleFiles(files);
        }
      }
    });
  }

  private updateVideoPreviewOverlayBounds() {
    if (!this.videoElement || !this.previewBox) return;

    const container = document.getElementById('hardsub-player-container');
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const videoW = this.videoElement.videoWidth;
    const videoH = this.videoElement.videoHeight;

    if (!videoW || !videoH || containerWidth === 0 || containerHeight === 0) {
      this.previewBox.style.width = '100%';
      this.previewBox.style.height = '100%';
      this.previewBox.style.left = '0px';
      this.previewBox.style.top = '0px';
      return;
    }

    const containerAspect = containerWidth / containerHeight;
    const videoAspect = videoW / videoH;

    let displayWidth: number;
    let displayHeight: number;

    if (videoAspect > containerAspect) {
      displayWidth = containerWidth;
      displayHeight = containerWidth / videoAspect;
    } else {
      displayHeight = containerHeight;
      displayWidth = containerHeight * videoAspect;
    }

    const left = (containerWidth - displayWidth) / 2;
    const top = (containerHeight - displayHeight) / 2;

    this.previewBox.style.width = `${displayWidth}px`;
    this.previewBox.style.height = `${displayHeight}px`;
    this.previewBox.style.left = `${left}px`;
    this.previewBox.style.top = `${top}px`;
  }

  private updateSeekSliderProgress(pct: number) {
    if (this.videoSeekSlider) {
      const val = Math.max(0, Math.min(100, pct));
      this.videoSeekSlider.style.background = `linear-gradient(to right, var(--color-royal-blue) 0%, var(--color-royal-blue) ${val}%, rgba(255, 255, 255, 0.1) ${val}%, rgba(255, 255, 255, 0.1) 100%)`;
    }
  }

  private updateVideoDropzoneUI(videoPath: string) {
    if (!videoPath) {
      if (this.lblVideoName) this.lblVideoName.textContent = 'No Video Loaded';
      if (this.lblVideoPath) this.lblVideoPath.textContent = 'Drag & drop video (.mp4, .mkv, .mov)';
      this.videoDropZone?.classList.remove('has-file');
      return;
    }

    const lastSlash = Math.max(videoPath.lastIndexOf('/'), videoPath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? videoPath.substring(lastSlash + 1) : videoPath;

    if (this.lblVideoName) this.lblVideoName.textContent = `✓ ${fileName}`;
    if (this.lblVideoPath) this.lblVideoPath.textContent = videoPath;
    this.videoDropZone?.classList.add('has-file');
  }

  private updateSubDropzoneUI(subPath: string, cueCount?: number) {
    if (!subPath) {
      if (this.lblSubName) this.lblSubName.textContent = 'No Subtitle Loaded';
      if (this.lblSubPath) this.lblSubPath.textContent = 'Drag & drop subtitle (.srt, .vtt, .ass)';
      this.subDropZone?.classList.remove('has-file');
      return;
    }

    const lastSlash = Math.max(subPath.lastIndexOf('/'), subPath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? subPath.substring(lastSlash + 1) : subPath;
    const countStr = typeof cueCount === 'number' ? ` (${cueCount} Cues)` : '';

    if (this.lblSubName) this.lblSubName.textContent = `✓ ${fileName}${countStr}`;
    if (this.lblSubPath) this.lblSubPath.textContent = subPath;
    this.subDropZone?.classList.add('has-file');
  }

  private async loadVideoMedia(videoPath: string) {
    if (!videoPath || !this.videoElement) return;
    try {
      let streamUrl = '';
      try {
        streamUrl = await invoke<string>('get_media_stream_url', { path: videoPath });
      } catch (err) {
        console.warn('Fallback to convertFileSrc:', err);
        streamUrl = convertFileSrc(videoPath);
      }

      this.videoElement.src = streamUrl;
      this.videoElement.style.display = 'block';
      if (this.videoPlaceholder) this.videoPlaceholder.style.display = 'none';
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Video Loaded';
        this.videoStatusBadge.style.background = 'rgba(45, 127, 255, 0.15)';
        this.videoStatusBadge.style.color = 'var(--color-cyan)';
      }
      this.updateVideoDropzoneUI(videoPath);
      this.updateVideoPreviewOverlayBounds();
    } catch (e) {
      console.warn('Failed to load video media URL:', e);
    }
  }

  private async loadSubtitleFile(subPath: string) {
    if (!subPath) return;
    try {
      const content = await invoke<string>('read_text_file_content', { filePath: subPath });
      const lastDot = subPath.lastIndexOf('.');
      const ext = lastDot > 0 ? subPath.substring(lastDot + 1).toLowerCase() : 'srt';
      this.subtitleCues = parseSubtitleContent(content, ext);
      this.isSubtitlesModified = false;
      this.updateSubDropzoneUI(subPath, this.subtitleCues.length);
      this.renderSubtitleCards();
    } catch (e) {
      console.warn('Failed to read subtitle file content:', e);
    }
  }

  private renderSubtitleCards() {
    if (!this.subtitleListContainer) return;

    if (this.subtitleCues.length === 0) {
      this.subtitleListContainer.innerHTML = '';
      if (this.emptyCueNotice) this.emptyCueNotice.style.display = 'flex';
      if (this.subtitleCountBadge) this.subtitleCountBadge.textContent = '0 Cues';
      return;
    }

    if (this.emptyCueNotice) this.emptyCueNotice.style.display = 'none';

    const filtered = this.subtitleCues.filter((cue) => {
      if (!this.searchFilterQuery) return true;
      return cue.text.toLowerCase().includes(this.searchFilterQuery);
    });

    if (this.subtitleCountBadge) {
      this.subtitleCountBadge.textContent = `${filtered.length} Cues`;
    }

    this.subtitleListContainer.innerHTML = '';

    filtered.forEach((cue) => {
      const card = document.createElement('div');
      card.className = `subtitle-cue-card ${this.activeCueId === cue.id ? 'active' : ''}`;
      card.id = `subtitle-cue-${cue.id}`;

      card.innerHTML = `
        <div class="subtitle-cue-header">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="subtitle-cue-time">${cue.startTimeStr} → ${cue.endTimeStr}</span>
            <span class="subtitle-cue-active-badge">ACTIVE</span>
          </div>
          <button class="pill-btn jump-cue-btn" style="padding: 2px 8px; font-size: 0.72rem; height: 22px;" title="Jump video to cue time">
            ▶ Play
          </button>
        </div>
        <textarea class="subtitle-cue-textarea" data-cue-id="${cue.id}">${cue.text}</textarea>
      `;

      card.querySelector('.jump-cue-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.videoElement) {
          this.targetClickedCueId = cue.id;
          this.activeCueId = cue.id;
          this.highlightActiveCard(cue.id);
          if (this.previewText) {
            this.previewText.textContent = cue.text;
          }
          if (this.clickLockTimer) clearTimeout(this.clickLockTimer);
          this.clickLockTimer = setTimeout(() => {
            this.targetClickedCueId = null;
          }, 800);

          this.videoElement.currentTime = (cue.startMs + 50) / 1000;
          const p = this.videoElement.play();
          if (p !== undefined) {
            p.catch((err) => console.warn('Jump play warning:', err));
          }
        }
      });

      card.addEventListener('click', () => {
        if (this.videoElement) {
          this.targetClickedCueId = cue.id;
          this.activeCueId = cue.id;
          this.highlightActiveCard(cue.id);
          if (this.previewText) {
            this.previewText.textContent = cue.text;
          }
          if (this.clickLockTimer) clearTimeout(this.clickLockTimer);
          this.clickLockTimer = setTimeout(() => {
            this.targetClickedCueId = null;
          }, 800);

          this.videoElement.currentTime = (cue.startMs + 50) / 1000;
        }
      });

      const textarea = card.querySelector('textarea') as HTMLTextAreaElement;
      textarea?.addEventListener('input', () => {
        cue.text = textarea.value;
        this.isSubtitlesModified = true;
        if (this.activeCueId === cue.id && this.previewText) {
          this.previewText.textContent = cue.text;
        }
      });

      this.subtitleListContainer?.appendChild(card);
    });
  }

  private syncActiveSubtitleWithTime(curMs: number) {
    if (this.targetClickedCueId !== null) {
      const clickedCue = this.subtitleCues.find((c) => c.id === this.targetClickedCueId);
      if (clickedCue) {
        if (this.activeCueId !== clickedCue.id) {
          this.activeCueId = clickedCue.id;
          this.highlightActiveCard(clickedCue.id);
        }
        if (this.previewText) {
          this.previewText.textContent = clickedCue.text;
        }
        return;
      }
    }

    const activeCue = this.subtitleCues.find((c) => curMs >= c.startMs && curMs < c.endMs);

    if (activeCue) {
      if (this.activeCueId !== activeCue.id) {
        this.activeCueId = activeCue.id;
        this.highlightActiveCard(activeCue.id);
      }
      if (this.previewText) {
        this.previewText.textContent = activeCue.text;
      }
    } else {
      if (this.activeCueId !== null) {
        this.activeCueId = null;
        this.highlightActiveCard(null);
      }
      if (this.previewText && this.previewInput) {
        this.previewText.textContent = this.previewInput.value || 'Sample Subtitle Live Preview Text';
      }
    }
  }

  private highlightActiveCard(cueId: number | null) {
    document.querySelectorAll('.subtitle-cue-card').forEach((el) => {
      el.classList.remove('active');
    });

    if (cueId !== null) {
      const activeEl = document.getElementById(`subtitle-cue-${cueId}`);
      if (activeEl) {
        activeEl.classList.add('active');
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  public prefillFilePaths(videoPath: string, subPath: string) {
    if (videoPath) {
      if (this.videoPathInput) this.videoPathInput.value = videoPath;
      this.state.videoPath = videoPath;
      this.loadVideoMedia(videoPath);
    }
    if (subPath) {
      if (this.subtitlePathInput) this.subtitlePathInput.value = subPath;
      this.state.subtitlePath = subPath;
      this.loadSubtitleFile(subPath);
    }
    if (videoPath) {
      this.autoSuggestSubtitleAndOutput(videoPath);
    }
  }

  private autoSuggestSubtitleAndOutput(videoPath: string) {
    const lastDot = videoPath.lastIndexOf('.');
    if (lastDot > 0) {
      const basePath = videoPath.substring(0, lastDot);
      if (!this.state.subtitlePath) {
        const srtPath = `${basePath}.srt`;
        if (this.subtitlePathInput) {
          this.subtitlePathInput.value = srtPath;
          this.state.subtitlePath = srtPath;
          this.loadSubtitleFile(srtPath);
        }
      }
      this.state.outputPath = `${basePath}_hardsub.${this.state.outputFormat}`;
    }
  }

  private updateColorSwatches() {
    if (this.swatchText) this.swatchText.style.background = this.state.primaryColor;
    if (this.hexTextLabel) this.hexTextLabel.textContent = this.state.primaryColor;

    if (this.swatchOutline) this.swatchOutline.style.background = this.state.outlineColor;
    if (this.hexOutlineLabel) this.hexOutlineLabel.textContent = `${this.state.outlineColor} (${this.state.outlineSize}px)`;

    if (this.swatchBg) this.swatchBg.style.background = this.state.bgBoxColor;
    if (this.hexBgLabel) this.hexBgLabel.textContent = this.state.bgBoxColor;
  }

  private updateLivePreview() {
    if (!this.previewText) return;

    this.updateVideoPreviewOverlayBounds();

    if (this.previewInput && this.previewInput.value && !this.activeCueId) {
      this.previewText.textContent = this.previewInput.value;
    }

    this.previewText.style.fontFamily = `'${this.state.fontName}', sans-serif`;

    const previewHeight = this.previewBox?.clientHeight || 240;
    const scaledFontSize = Math.max(10, (this.state.fontSize * previewHeight) / 288);
    this.previewText.style.fontSize = `${scaledFontSize}px`;

    this.previewText.style.color = this.state.primaryColor;
    this.previewText.style.fontWeight = this.state.bold ? 'bold' : 'normal';
    this.previewText.style.fontStyle = this.state.italic ? 'italic' : 'normal';
    this.previewText.style.marginBottom = `${this.state.positionY}px`;

    if (this.state.outlineSize > 0) {
      const s = this.state.outlineSize;
      const c = this.state.outlineColor;
      (this.previewText.style as any).webkitTextStroke = `${s}px ${c}`;
      (this.previewText.style as any).paintOrder = 'stroke fill';
      (this.previewText.style as any).webkitPaintOrder = 'stroke fill';
      (this.previewText.style as any).strokeLinejoin = 'round';
      (this.previewText.style as any).webkitStrokeLinejoin = 'round';
      this.previewText.style.textShadow = `0 1px 3px ${c}`;
    } else {
      (this.previewText.style as any).webkitTextStroke = '0px transparent';
      (this.previewText.style as any).paintOrder = 'normal';
      (this.previewText.style as any).webkitPaintOrder = 'normal';
      this.previewText.style.textShadow = 'none';
    }

    if (this.state.bgBox) {
      this.previewText.style.backgroundColor = this.state.bgBoxColor;
      this.previewText.style.padding = '4px 14px';
      this.previewText.style.borderRadius = '6px';
    } else {
      this.previewText.style.backgroundColor = 'transparent';
      this.previewText.style.padding = '0';
    }

    if (this.previewBox) {
      switch (this.state.alignment) {
        case 1:
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'flex-start';
          break;
        case 3:
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'flex-end';
          break;
        case 6:
          this.previewBox.style.justifyContent = 'flex-start';
          this.previewBox.style.alignItems = 'center';
          break;
        default:
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'center';
          break;
      }
    }

    this.updateColorSwatches();
    this.updateUIControlsState();
  }

  private updateUIControlsState() {
    const resetFont = document.getElementById('reset-fontsize');
    if (resetFont) resetFont.style.display = this.state.fontSize !== 24 ? 'inline-flex' : 'none';

    const resetOutline = document.getElementById('reset-outline');
    if (resetOutline) resetOutline.style.display = this.state.outlineSize !== 2 ? 'inline-flex' : 'none';

    const resetPosy = document.getElementById('reset-posy');
    if (resetPosy) resetPosy.style.display = this.state.positionY !== 30 ? 'inline-flex' : 'none';

    const bgControls = document.getElementById('hardsub-bg-controls');
    if (bgControls) {
      bgControls.classList.toggle('control-disabled', !this.state.bgBox);
    }

    const outlinePicker = document.getElementById('hardsub-outline-picker-wrapper');
    if (outlinePicker) {
      outlinePicker.classList.toggle('control-disabled', this.state.outlineSize === 0);
    }
  }

  private updateEncodingUIState(active: boolean) {
    this.isEncoding = active;

    const startBtn = document.getElementById('btn-start-hardsub') as HTMLButtonElement;
    const startBtnSpan = startBtn?.querySelector('span');
    if (startBtn) {
      startBtn.disabled = active;
      if (startBtnSpan) {
        startBtnSpan.textContent = active ? 'Exporting Hardsub Video...' : 'Export Hardsub Video';
      }
      startBtn.style.opacity = active ? '0.7' : '1';
      startBtn.style.cursor = active ? 'not-allowed' : 'pointer';
    }

    if (this.cancelBtn) {
      this.cancelBtn.style.display = active ? 'inline-flex' : 'none';
    }

    if (this.hudPulseDot) {
      if (active) {
        this.hudPulseDot.classList.add('active');
        this.hudPulseDot.style.backgroundColor = '';
      } else {
        this.hudPulseDot.classList.remove('active');
        this.hudPulseDot.style.backgroundColor = 'var(--color-text-dim)';
      }
    }
  }

  private listenToProgressEvents() {
    listen<{ progress: number; message: string; active: boolean }>('hardsub-status', (event) => {
      const data = event.payload;
      const pct = Math.round(data.progress * 100);

      if (this.progressFill) {
        this.progressFill.style.width = `${pct}%`;
      }
      if (this.progressPctText) {
        this.progressPctText.textContent = `${pct}%`;
      }
      if (this.progressStatusText) {
        this.progressStatusText.textContent = data.message;
      }

      this.updateEncodingUIState(data.active);
    });
  }

  private async startHardsub() {
    this.state.videoPath = this.videoPathInput?.value.trim() || '';
    this.state.subtitlePath = this.subtitlePathInput?.value.trim() || '';

    if (!this.state.videoPath) {
      alert('Please select a video file first.');
      return;
    }
    if (!this.state.subtitlePath) {
      alert('Please select a subtitle file first.');
      return;
    }

    if (this.isSubtitlesModified && this.subtitleCues.length > 0) {
      try {
        const srtContent = convertCuesToSrt(this.subtitleCues);
        await invoke('write_text_file_content', {
          filePath: this.state.subtitlePath,
          content: srtContent,
        });
        console.log('Saved modified subtitle content to disk');
      } catch (e) {
        console.warn('Failed to save edited subtitles to disk:', e);
      }
    }

    if (!this.state.outputPath) {
      this.autoSuggestSubtitleAndOutput(this.state.videoPath);
    }

    try {
      this.updateEncodingUIState(true);
      if (this.progressStatusText) {
        this.progressStatusText.textContent = 'Initializing FFmpeg Encoder...';
      }

      await invoke('start_hardsub_task', {
        settings: this.state,
      });
    } catch (e: any) {
      const msg = String(e || '');
      if (msg.includes('cancelled') || msg.includes('Cancelled')) {
        console.log('Hardsub task cancelled by user');
        if (this.progressStatusText) {
          this.progressStatusText.textContent = 'Encoding cancelled.';
        }
      } else {
        alert(`Hardsub failed: ${e}`);
        if (this.progressStatusText) {
          this.progressStatusText.textContent = `Error: ${e}`;
        }
      }
    } finally {
      this.updateEncodingUIState(false);
    }
  }
}

export const hardsubController = new HardsubController();
