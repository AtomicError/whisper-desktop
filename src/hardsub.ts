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

  // Telemetry HUD elements
  private progressFill: HTMLElement | null = null;
  private progressStatusText: HTMLElement | null = null;
  private progressPctText: HTMLElement | null = null;
  private hudPulseDot: HTMLElement | null = null;

  // Internal state
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

  constructor() {
    const init = () => {
      this.initDOMElements();
      this.loadFontsAndHardware();
      this.setupEventListeners();
      this.listenToProgressEvents();
      this.updateLivePreview();
      this.updateEncodingUIState(false);
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
      if (selected && this.videoPathInput) {
        this.videoPathInput.value = selected;
        this.state.videoPath = selected;
        this.autoSuggestSubtitleAndOutput(selected);
      }
    });

    // Browse Subtitle File
    document.getElementById('btn-browse-sub')?.addEventListener('click', async () => {
      const selected = await invoke<string | null>('select_subtitle_file');
      if (selected && this.subtitlePathInput) {
        this.subtitlePathInput.value = selected;
        this.state.subtitlePath = selected;
      }
    });

    // Font Select & Scroll Activity
    let fontScrollTimer: any = null;
    this.fontSelect?.addEventListener('scroll', () => {
      this.fontSelect?.classList.add('scrolling-active');
      clearTimeout(fontScrollTimer);
      fontScrollTimer = setTimeout(() => {
        this.fontSelect?.classList.remove('scrolling-active');
      }, 1500);
    });
    this.fontSelect?.addEventListener('change', () => {
      this.state.fontName = this.fontSelect!.value;
      this.updateLivePreview();
    });

    // Custom Live Preview Text Input
    this.previewInput?.addEventListener('input', () => {
      this.updateLivePreview();
    });

    // Font Size Slider & Reset
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

    // Position Y Slider & Reset
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

    // Outline Size Slider & Reset
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

    // Color Pickers & Preset Swatches
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

    // Color Preset Buttons
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

  public prefillFilePaths(videoPath: string, subPath: string) {
    if (this.videoPathInput) {
      this.videoPathInput.value = videoPath;
      this.state.videoPath = videoPath;
    }
    if (this.subtitlePathInput) {
      this.subtitlePathInput.value = subPath;
      this.state.subtitlePath = subPath;
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

    if (this.previewInput && this.previewInput.value) {
      this.previewText.textContent = this.previewInput.value;
    }

    this.previewText.style.fontFamily = `'${this.state.fontName}', sans-serif`;
    
    // Scale font size proportionally to preview container height vs ASS baseline (288)
    const previewHeight = this.previewBox?.clientHeight || 200;
    const scaledFontSize = Math.max(10, (this.state.fontSize * previewHeight) / 288);
    this.previewText.style.fontSize = `${scaledFontSize}px`;

    this.previewText.style.color = this.state.primaryColor;
    this.previewText.style.fontWeight = this.state.bold ? 'bold' : 'normal';
    this.previewText.style.fontStyle = this.state.italic ? 'italic' : 'normal';
    this.previewText.style.marginBottom = `${this.state.positionY}px`;

    // Outline / Stroke using crisp hardware-accelerated WebKit text stroke & paint-order
    if (this.state.outlineSize > 0) {
      const s = this.state.outlineSize;
      const c = this.state.outlineColor;
      (this.previewText.style as any).webkitTextStroke = `${s}px ${c}`;
      (this.previewText.style as any).paintOrder = 'stroke fill';
      (this.previewText.style as any).strokeLinejoin = 'round';
      this.previewText.style.textShadow = '0 2px 10px rgba(0,0,0,0.6)';
    } else {
      (this.previewText.style as any).webkitTextStroke = '0px transparent';
      this.previewText.style.textShadow = 'none';
    }

    // Background Box
    if (this.state.bgBox) {
      this.previewText.style.backgroundColor = this.state.bgBoxColor;
      this.previewText.style.padding = '4px 14px';
      this.previewText.style.borderRadius = '6px';
    } else {
      this.previewText.style.backgroundColor = 'transparent';
      this.previewText.style.padding = '0';
    }

    // Flexbox Alignment mapping
    if (this.previewBox) {
      switch (this.state.alignment) {
        case 1: // Bottom Left
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'flex-start';
          break;
        case 3: // Bottom Right
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'flex-end';
          break;
        case 6: // Top Center
          this.previewBox.style.justifyContent = 'flex-start';
          this.previewBox.style.alignItems = 'center';
          break;
        default: // 2 = Bottom Center
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'center';
          break;
      }
    }

    this.updateColorSwatches();
  }

  private updateEncodingUIState(active: boolean) {
    this.isEncoding = active;

    if (this.cancelBtn) {
      this.cancelBtn.style.display = active ? 'inline-flex' : 'none';
    }

    if (this.hudPulseDot) {
      this.hudPulseDot.style.background = active ? 'var(--color-royal-blue)' : '#9ca3af';
      this.hudPulseDot.classList.toggle('pulse-active', active);
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

    if (!this.state.outputPath) {
      this.autoSuggestSubtitleAndOutput(this.state.videoPath);
    }

    try {
      this.updateEncodingUIState(true);
      if (this.progressStatusText) {
        this.progressStatusText.textContent = 'Initializing FFmpeg encoder...';
      }
      
      await invoke('start_hardsub_task', {
        settings: this.state,
      });

    } catch (e: any) {
      alert(`Hardsub failed: ${e}`);
      if (this.progressStatusText) {
        this.progressStatusText.textContent = `Error: ${e}`;
      }
    } finally {
      this.updateEncodingUIState(false);
    }
  }
}

export const hardsubController = new HardsubController();
