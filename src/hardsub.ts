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
  name: String;
  source: String;
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
  private primaryColorPicker: HTMLInputElement | null = null;
  private outlineColorPicker: HTMLInputElement | null = null;
  private bgBoxToggle: HTMLInputElement | null = null;
  private bgBoxColorPicker: HTMLInputElement | null = null;
  private boldToggle: HTMLButtonElement | null = null;
  private italicToggle: HTMLButtonElement | null = null;
  private formatSelect: HTMLSelectElement | null = null;
  private codecSelect: HTMLSelectElement | null = null;
  private hwSelect: HTMLSelectElement | null = null;
  private audioSelect: HTMLSelectElement | null = null;
  private alignmentButtons: NodeListOf<HTMLButtonElement> | null = null;
  
  // Preview elements
  private previewBox: HTMLElement | null = null;
  private previewText: HTMLElement | null = null;
  private progressBar: HTMLElement | null = null;
  private progressStatusText: HTMLElement | null = null;

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
    // Wait for DOM to load before initializing elements
    document.addEventListener('DOMContentLoaded', () => {
      this.initDOMElements();
      this.loadFontsAndHardware();
      this.setupEventListeners();
      this.listenToProgressEvents();
      this.updateLivePreview();
    });
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
    this.boldToggle = document.getElementById('hardsub-btn-bold') as HTMLButtonElement;
    this.italicToggle = document.getElementById('hardsub-btn-italic') as HTMLButtonElement;
    this.formatSelect = document.getElementById('hardsub-format') as HTMLSelectElement;
    this.codecSelect = document.getElementById('hardsub-codec') as HTMLSelectElement;
    this.hwSelect = document.getElementById('hardsub-hw') as HTMLSelectElement;
    this.audioSelect = document.getElementById('hardsub-audio') as HTMLSelectElement;
    this.alignmentButtons = document.querySelectorAll('.align-btn');

    this.previewBox = document.getElementById('hardsub-preview-box');
    this.previewText = document.getElementById('hardsub-preview-text');
    this.progressBar = document.getElementById('hardsub-progress-bar');
    this.progressStatusText = document.getElementById('hardsub-status-text');
  }

  private async loadFontsAndHardware() {
    try {
      // 1. Fetch system & bundled fonts from Rust
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
      // 2. Probe hardware encoders (Intel QSV, NVENC, VAAPI)
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
      const selected = await invoke<string | null>('select_file');
      if (selected && this.subtitlePathInput) {
        this.subtitlePathInput.value = selected;
        this.state.subtitlePath = selected;
      }
    });

    // Font Select
    this.fontSelect?.addEventListener('change', () => {
      this.state.fontName = this.fontSelect!.value;
      this.updateLivePreview();
    });

    // Font Size Slider
    this.fontSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.fontSizeSlider!.value, 10);
      this.state.fontSize = val;
      if (this.fontSizeVal) this.fontSizeVal.textContent = `${val}px`;
      this.updateLivePreview();
    });

    // Position Y Slider
    this.positionYSlider?.addEventListener('input', () => {
      const val = parseInt(this.positionYSlider!.value, 10);
      this.state.positionY = val;
      if (this.positionYVal) this.positionYVal.textContent = `${val}px`;
      this.updateLivePreview();
    });

    // Outline Size Slider
    this.outlineSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.outlineSizeSlider!.value, 10);
      this.state.outlineSize = val;
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = `${val}px`;
      this.updateLivePreview();
    });

    // Primary Text Color
    this.primaryColorPicker?.addEventListener('input', () => {
      this.state.primaryColor = this.primaryColorPicker!.value;
      this.updateLivePreview();
    });

    // Outline Color
    this.outlineColorPicker?.addEventListener('input', () => {
      this.state.outlineColor = this.outlineColorPicker!.value;
      this.updateLivePreview();
    });

    // Background Box Toggle & Color
    this.bgBoxToggle?.addEventListener('change', () => {
      this.state.bgBox = this.bgBoxToggle!.checked;
      this.updateLivePreview();
    });
    this.bgBoxColorPicker?.addEventListener('input', () => {
      this.state.bgBoxColor = this.bgBoxColorPicker!.value;
      this.updateLivePreview();
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
    document.getElementById('btn-cancel-hardsub')?.addEventListener('click', async () => {
      try {
        await invoke('cancel_transcription');
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

  private updateLivePreview() {
    if (!this.previewText) return;

    this.previewText.style.fontFamily = `'${this.state.fontName}', sans-serif`;
    this.previewText.style.fontSize = `${this.state.fontSize}px`;
    this.previewText.style.color = this.state.primaryColor;
    this.previewText.style.fontWeight = this.state.bold ? 'bold' : 'normal';
    this.previewText.style.fontStyle = this.state.italic ? 'italic' : 'normal';
    this.previewText.style.marginBottom = `${this.state.positionY}px`;

    // Text Outline / Stroke Effect via CSS text-shadow
    if (this.state.outlineSize > 0) {
      const s = this.state.outlineSize;
      const c = this.state.outlineColor;
      this.previewText.style.textShadow = `
        -${s}px -${s}px 0 ${c},
         ${s}px -${s}px 0 ${c},
        -${s}px  ${s}px 0 ${c},
         ${s}px  ${s}px 0 ${c},
         0px -${s}px 0 ${c},
         0px  ${s}px 0 ${c},
        -${s}px  0px 0 ${c},
         ${s}px  0px 0 ${c}
      `;
    } else {
      this.previewText.style.textShadow = 'none';
    }

    // Background Box
    if (this.state.bgBox) {
      this.previewText.style.backgroundColor = this.state.bgBoxColor;
      this.previewText.style.padding = '4px 12px';
      this.previewText.style.borderRadius = '4px';
    } else {
      this.previewText.style.backgroundColor = 'transparent';
      this.previewText.style.padding = '0';
    }

    // Alignment
    if (this.previewBox) {
      switch (this.state.alignment) {
        case 1: // Bottom Left
          this.previewBox.style.justifyContent = 'flex-start';
          this.previewBox.style.alignItems = 'flex-end';
          break;
        case 3: // Bottom Right
          this.previewBox.style.justifyContent = 'flex-end';
          this.previewBox.style.alignItems = 'flex-end';
          break;
        case 6: // Top Center
          this.previewBox.style.justifyContent = 'center';
          this.previewBox.style.alignItems = 'flex-start';
          break;
        default: // 2 = Bottom Center
          this.previewBox.style.justifyContent = 'center';
          this.previewBox.style.alignItems = 'flex-end';
          break;
      }
    }
  }

  private listenToProgressEvents() {
    listen<{ progress: number; message: string; active: boolean }>('hardsub-status', (event) => {
      const data = event.payload;
      if (this.progressBar) {
        this.progressBar.style.width = `${Math.round(data.progress * 100)}%`;
      }
      if (this.progressStatusText) {
        this.progressStatusText.textContent = data.message;
      }
      this.isEncoding = data.active;
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
      this.isEncoding = true;
      if (this.progressStatusText) {
        this.progressStatusText.textContent = 'Starting FFmpeg encoding...';
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
      this.isEncoding = false;
    }
  }
}

// Instantiate global controller instance
export const hardsubController = new HardsubController();
