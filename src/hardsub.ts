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
  hasVideotoolbox: boolean;
}

export interface HardsubSettings {
  videoPath: string;
  subtitlePath: string;
  outputPath: string;
  outputFormat: string;
  videoCodec: string;
  hwAccel: string;
  videoQualityMode: 'preset' | 'custom';
  videoQualityPreset: 'draft' | 'balanced' | 'high' | 'lossless' | 'custom';
  videoQualityValue: number;
  videoPresetSpeed: 'fast' | 'medium' | 'slow';
  resolutionScale: 'original' | '4k' | '2k' | '1080p' | '720p' | '480p';
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  outlineSize: number;
  bgBox: boolean;
  bgBoxColor: string;
  bgBoxOpacity: number;
  bgBoxRadius: number;
  positionY: number;
  widthMargin: number;
  bold: boolean;
  italic: boolean;
  alignment: number;
  audioCodec: 'copy' | 'aac' | 'opus' | 'mp3' | 'mute';
  audioBitrate: '96k' | '128k' | '192k' | '256k' | '320k';
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

function msToAssTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hasRtlCharacters(text: string): boolean {
  const rtlRegex = /[\u0600-\u06FF\u0750-\u077F\u0590-\u05FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return rtlRegex.test(text);
}

function hexToAssColorAndAlpha(hex: string, opacity: number): string {
  const clean = hex.replace('#', '');
  let r = 'FF', g = 'FF', b = 'FF';
  if (clean.length >= 6) {
    r = clean.substring(0, 2);
    g = clean.substring(2, 4);
    b = clean.substring(4, 6);
  }
  const clamped = Math.max(0, Math.min(100, opacity));
  const alphaVal = Math.round(255 - (clamped * 2.55));
  const alphaHex = alphaVal.toString(16).toUpperCase().padStart(2, '0');
  return `&H${alphaHex}${b}${g}${r}`;
}

function generateRoundedRectASS(x: number, y: number, w: number, h: number, radius: number): string {
  let r = radius;
  r = Math.min(r, w / 2, h / 2);

  const commands = [];
  commands.push(`m ${Math.round(x + r)} ${Math.round(y)}`);
  commands.push(`l ${Math.round(x + w - r)} ${Math.round(y)}`);
  commands.push(`b ${Math.round(x + w - r + r * 0.55)} ${Math.round(y)} ${Math.round(x + w)} ${Math.round(y + r * 0.45)} ${Math.round(x + w)} ${Math.round(y + r)}`);
  commands.push(`l ${Math.round(x + w)} ${Math.round(y + h - r)}`);
  commands.push(`b ${Math.round(x + w)} ${Math.round(y + h - r + r * 0.55)} ${Math.round(x + w - r + r * 0.45)} ${Math.round(y + h)} ${Math.round(x + w - r)} ${Math.round(y + h)}`);
  commands.push(`l ${Math.round(x + r)} ${Math.round(y + h)}`);
  commands.push(`b ${Math.round(x + r * 0.45)} ${Math.round(y + h)} ${Math.round(x)} ${Math.round(y + h - r + r * 0.45)} ${Math.round(x)} ${Math.round(y + h - r)}`);
  commands.push(`l ${Math.round(x)} ${Math.round(y + r)}`);
  commands.push(`b ${Math.round(x)} ${Math.round(y + r * 0.45)} ${Math.round(x + r * 0.45)} ${Math.round(y)} ${Math.round(x + r)} ${Math.round(y)}`);

  return commands.join(' ');
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

interface TextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
}

const TAG_REGEX = /<\/?(?:i|b|u|font)\b[^>]*>|\{\\an[1-9]\}|\{\\[^}]+\}/gi;

function parseLineToSpans(text: string, defaultColor: string): { spans: TextSpan[], alignmentOverride: number | null } {
  let alignmentOverride: number | null = null;
  const spans: TextSpan[] = [];
  
  let bold = false;
  let italic = false;
  let underline = false;
  const colorStack: string[] = [defaultColor];

  TAG_REGEX.lastIndex = 0;
  let lastIndex = 0;
  
  const matches = [...text.matchAll(TAG_REGEX)];
  
  for (const match of matches) {
    const startIndex = match.index ?? 0;
    
    if (startIndex > lastIndex) {
      const txt = text.substring(lastIndex, startIndex);
      if (txt) {
        spans.push({
          text: txt,
          bold,
          italic,
          underline,
          color: colorStack[colorStack.length - 1]
        });
      }
    }
    
    const tag = match[0];
    if (tag.startsWith('<')) {
      const lower = tag.toLowerCase();
      if (lower.startsWith('<i>') || lower.startsWith('<i ')) {
        italic = true;
      } else if (lower === '</i>') {
        italic = false;
      } else if (lower.startsWith('<b>') || lower.startsWith('<b ')) {
        bold = true;
      } else if (lower === '</b>') {
        bold = false;
      } else if (lower.startsWith('<u>') || lower.startsWith('<u ')) {
        underline = true;
      } else if (lower === '</u>') {
        underline = false;
      } else if (lower.startsWith('<font') && lower.includes('color=')) {
        const colorMatch = /color=["']#?([0-9a-fA-F]{6}|[a-zA-Z]+)["']/i.exec(tag);
        if (colorMatch) {
          const val = colorMatch[1];
          const colorHex = /^[0-9a-fA-F]{6}$/.test(val) ? `#${val}` : val;
          colorStack.push(colorHex);
        } else {
          colorStack.push(defaultColor);
        }
      } else if (lower === '</font>') {
        if (colorStack.length > 1) {
          colorStack.pop();
        }
      }
    } else if (tag.startsWith('{')) {
      const commands = tag.substring(1, tag.length - 1).split('\\');
      for (const cmd of commands) {
        if (cmd.startsWith('an')) {
          const val = cmd.substring(2).trim();
          alignmentOverride = parseInt(val, 10) || null;
        } else if (cmd.startsWith('i')) {
          const val = cmd.substring(1).trim();
          italic = val === '1';
        } else if (cmd.startsWith('b')) {
          const val = cmd.substring(1).trim();
          bold = val === '1';
        } else if (cmd.startsWith('u')) {
          const val = cmd.substring(1).trim();
          underline = val === '1';
        } else if (cmd.startsWith('c&H') || cmd.startsWith('1c&H')) {
          const colorMatch = /(?:1?c&H)([0-9a-fA-F]+)&?/i.exec(cmd);
          if (colorMatch) {
            const hex = colorMatch[1];
            let cleanHex = hex;
            if (cleanHex.length > 6) {
              cleanHex = cleanHex.substring(cleanHex.length - 6);
            } else {
              cleanHex = cleanHex.padStart(6, '0');
            }
            const b = cleanHex.substring(0, 2);
            const g = cleanHex.substring(2, 4);
            const r = cleanHex.substring(4, 6);
            colorStack.push(`#${r}${g}${b}`);
          }
        } else if (cmd === 'c' || cmd === '1c') {
          if (colorStack.length > 1) {
            colorStack.pop();
          }
        }
      }
    }
    
    lastIndex = startIndex + tag.length;
  }
  
  if (lastIndex < text.length) {
    const txt = text.substring(lastIndex);
    if (txt) {
      spans.push({
        text: txt,
        bold,
        italic,
        underline,
        color: colorStack[colorStack.length - 1]
      });
    }
  }
  
  return { spans, alignmentOverride };
}

function splitSpanIntoWords(span: TextSpan): TextSpan[] {
  const words = span.text.split(/(\s+)/);
  return words
    .filter(w => w.length > 0)
    .map(w => ({
      text: w,
      bold: span.bold,
      italic: span.italic,
      underline: span.underline,
      color: span.color
    }));
}

function setSpanFont(ctx: CanvasRenderingContext2D, family: string, size: number, bold: boolean, italic: boolean) {
  const style = italic ? 'italic' : 'normal';
  const weight = bold ? 'bold' : 'normal';
  ctx.font = `${style} ${weight} ${size}px '${family}', 'Vazirmatn', 'Vazir', sans-serif`;
}

function trimTrailingWhitespace(line: TextSpan[]): TextSpan[] {
  const result = [...line];
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (/^\s+$/.test(last.text)) {
      result.pop();
    } else {
      break;
    }
  }
  return result;
}

function wrapSpans(
  spans: TextSpan[],
  maxTextWidth: number,
  ctx: CanvasRenderingContext2D,
  fontFamily: string,
  baseFontSize: number
): TextSpan[][] {
  const wrappedLines: TextSpan[][] = [];
  let currentLine: TextSpan[] = [];
  let currentLineWidth = 0;

  const wordSpans: TextSpan[] = [];
  for (const span of spans) {
    wordSpans.push(...splitSpanIntoWords(span));
  }

  for (const wordSpan of wordSpans) {
    ctx.save();
    setSpanFont(ctx, fontFamily, baseFontSize, wordSpan.bold, wordSpan.italic);
    const wordWidth = ctx.measureText(wordSpan.text).width;
    ctx.restore();

    const isWhitespace = /^\s+$/.test(wordSpan.text);

    if (currentLineWidth + wordWidth > maxTextWidth && currentLine.length > 0 && !isWhitespace) {
      wrappedLines.push(trimTrailingWhitespace(currentLine));
      if (isWhitespace) {
        currentLine = [];
        currentLineWidth = 0;
      } else {
        currentLine = [wordSpan];
        currentLineWidth = wordWidth;
      }
    } else {
      currentLine.push(wordSpan);
      currentLineWidth += wordWidth;
    }
  }

  if (currentLine.length > 0) {
    const trimmed = trimTrailingWhitespace(currentLine);
    if (trimmed.length > 0) {
      wrappedLines.push(trimmed);
    }
  }

  return wrappedLines;
}

function measureSpansWidth(ctx: CanvasRenderingContext2D, spans: TextSpan[], fontFamily: string, baseFontSize: number): number {
  let width = 0;
  for (const span of spans) {
    ctx.save();
    setSpanFont(ctx, fontFamily, baseFontSize, span.bold, span.italic);
    width += ctx.measureText(span.text).width;
    ctx.restore();
  }
  return width;
}

function drawUnderline(
  ctx: CanvasRenderingContext2D,
  width: number,
  fontSize: number,
  x: number,
  baselineY: number,
  color: string
): void {
  if (width <= 0) return;
  const underlineY = baselineY + Math.max(1, fontSize * 0.08);
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = Math.max(1, fontSize * 0.05);
  ctx.strokeStyle = color;
  ctx.moveTo(x, underlineY);
  ctx.lineTo(x + width, underlineY);
  ctx.stroke();
  ctx.restore();
}

function convertHtmlToAssTags(text: string): string {
  let result = text;
  result = result.replace(/<i>/gi, '{\\i1}').replace(/<\/i>/gi, '{\\i0}');
  result = result.replace(/<b>/gi, '{\\b1}').replace(/<\/b>/gi, '{\\b0}');
  result = result.replace(/<u>/gi, '{\\u1}').replace(/<\/u>/gi, '{\\u0}');
  result = result.replace(/<font\s+color=["']#?([0-9a-fA-F]{6})["']>/gi, (match, hex) => {
    const r = hex.substring(0, 2);
    const g = hex.substring(2, 4);
    const b = hex.substring(4, 6);
    return `{\\c&H${b}${g}${r}&}`;
  });
  result = result.replace(/<\/font>/gi, '{\\c}');
  return result;
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '');
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
  private bgBoxOpacitySlider: HTMLInputElement | null = null;
  private bgBoxOpacityVal: HTMLElement | null = null;
  private bgBoxRadiusSlider: HTMLInputElement | null = null;
  private bgBoxRadiusVal: HTMLElement | null = null;

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
  private alignmentButtons: NodeListOf<HTMLButtonElement> | null = null;
  private cancelBtn: HTMLButtonElement | null = null;

  // Canvas-based subtitle preview (ASS-matching renderer)
  private subtitleCanvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private currentSubtitleText: string = '';

  // Zero-Flicker Frame Buffer Canvas for Seamless Seeking
  private freezeCanvas: HTMLCanvasElement | null = null;
  private freezeCtx: CanvasRenderingContext2D | null = null;
  private isFreezingFrame: boolean = false;

  // Computed video display dimensions (updated by updateVideoPreviewOverlayBounds)
  private videoDisplayWidth: number = 0;
  private videoDisplayHeight: number = 0;
  private videoDisplayLeft: number = 0;
  private videoDisplayTop: number = 0;

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

  // Player Volume & Fullscreen Controls
  private videoVolumeBtn: HTMLButtonElement | null = null;
  private videoIconVolUp: HTMLElement | null = null;
  private videoIconVolMute: HTMLElement | null = null;
  private videoVolumeSlider: HTMLInputElement | null = null;
  private videoFullscreenBtn: HTMLButtonElement | null = null;
  private videoIconFsEnter: HTMLElement | null = null;
  private videoIconFsExit: HTMLElement | null = null;
  private lastVolume: number = 1.0;

  // Player Volume HUD & Custom Viewport Controls
  private volumeHud: HTMLElement | null = null;
  private hudVolUp: HTMLElement | null = null;
  private hudVolLow: HTMLElement | null = null;
  private hudVolMute: HTMLElement | null = null;
  private hudVolText: HTMLElement | null = null;
  private hudTimeout: any = null;

  // Trackpad scroll seeking state
  private isScrollingSeek: boolean = false;
  private virtualCurrentTime: number = 0;
  private scrollSeekTimeout: any = null;
  private lastThrottleSeekTime: number = 0;

  // Triple Tab Studio Navigation (Editor, Style, Export)
  private tabBtnEditor: HTMLButtonElement | null = null;
  private tabBtnStyle: HTMLButtonElement | null = null;
  private tabBtnExport: HTMLButtonElement | null = null;
  private tabViewEditor: HTMLElement | null = null;
  private tabViewStyle: HTMLElement | null = null;
  private tabViewExport: HTMLElement | null = null;
  private currentStudioTab: 'editor' | 'style' | 'export' = 'editor';

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

  // Export Panel Elements
  private resolutionSelect: HTMLSelectElement | null = null;
  private qualityBadge: HTMLElement | null = null;
  private qualityPresetsContainer: HTMLElement | null = null;
  private qualityPresetBtns: NodeListOf<HTMLButtonElement> | null = null;
  private qualitySliderContainer: HTMLElement | null = null;
  private qualityParamLabel: HTMLElement | null = null;
  private qualityParamVal: HTMLElement | null = null;
  private qualitySlider: HTMLInputElement | null = null;
  private qualityHint: HTMLElement | null = null;
  private speedPresetSelect: HTMLSelectElement | null = null;
  private audioCodecSelect: HTMLSelectElement | null = null;
  private audioBitrateContainer: HTMLElement | null = null;
  private audioBitrateSelect: HTMLSelectElement | null = null;
  private ffmpegCmdPreview: HTMLElement | null = null;
  private btnCopyFfmpegCmd: HTMLButtonElement | null = null;

  // Internal State
  private state: HardsubSettings = {
    videoPath: '',
    subtitlePath: '',
    outputPath: '',
    outputFormat: 'mp4',
    videoCodec: 'h264',
    hwAccel: 'cpu',
    videoQualityMode: 'preset',
    videoQualityPreset: 'balanced',
    videoQualityValue: 22,
    videoPresetSpeed: 'medium',
    resolutionScale: 'original',
    fontName: 'Vazirmatn',
    fontSize: 14,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineSize: 2,
    bgBox: false,
    bgBoxColor: '#000000',
    bgBoxOpacity: 50,
    bgBoxRadius: 0,
    positionY: 30,
    widthMargin: 90,
    bold: true,
    italic: false,
    alignment: 2, // Bottom center
    audioCodec: 'copy',
    audioBitrate: '192k',
  };

  private storageDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private qualityScaleSig: string | null = null;
  private qualityScaleMin = 0;
  private qualityScaleMax = 51;
  private qualityScaleHigherIsBetter = false;
  private isEncoding: boolean = false;
  private subtitleCues: SubtitleCue[] = [];
  private activeCueId: number | null = null;
  private searchFilterQuery: string = '';
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastRenderKey: string = '';
  private isUserSeeking: boolean = false;
  private isManualSeeking: boolean = false;
  private targetClickedCueId: number | null = null;
  private clickLockTimer: any = null;
  private isSubtitlesModified: boolean = false;
  private isSeekingVideo: boolean = false;
  private pendingSeekTime: number | null = null;
  private wasPlayingBeforeSeek: boolean = false;

  // libass interprets \fs as the GDI cell height (usWinAscent+usWinDescent) while the
  // canvas preview uses CSS (em) semantics; these metrics reconcile the layout bounds
  // (see get_font_render_scale on the Rust side).
  private fontMetrics: { scale: number; ascentRatio: number; descentRatio: number } = {
    scale: 1,
    ascentRatio: 0.78,
    descentRatio: 0.22,
  };

  constructor() {
    const init = () => {
      this.initDOMElements();
      [
        this.fontSizeSlider,
        this.positionYSlider,
        this.outlineSizeSlider,
        this.bgBoxOpacitySlider,
        this.bgBoxRadiusSlider,
        this.qualitySlider,
      ].forEach((slider) => {
        if (slider) this.updateSliderBackground(slider);
      });
      this.loadFontsAndHardware();
      this.loadExportSettingsFromStorage();
      this.setupEventListeners();
      this.setupExportEventListeners();
      this.setupVideoPlayerEvents();
      this.setupStudioTabEvents();
      this.setupDragAndDropListeners();
      this.listenToProgressEvents();
      this.updateQualitySliderConfig();
      this.updateQualityUI();
      this.updateAudioUI();
      this.updateFfmpegCommandPreview();
      this.updateEncodingUIState(false);
      this.updateVolumeIcons(1.0, false);

      const container = document.getElementById('hardsub-player-container');
      if (container) {
        const resizeObserver = new ResizeObserver(() => {
          this.updateVideoPreviewOverlayBounds();
          this.updateLivePreview();
        });
        resizeObserver.observe(container);
      }
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
    this.bgBoxOpacitySlider = document.getElementById('hardsub-bgbox-opacity') as HTMLInputElement;
    this.bgBoxOpacityVal = document.getElementById('hardsub-bgbox-opacity-val');
    this.bgBoxRadiusSlider = document.getElementById('hardsub-bgbox-radius') as HTMLInputElement;
    this.bgBoxRadiusVal = document.getElementById('hardsub-bgbox-radius-val');

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
    this.alignmentButtons = document.querySelectorAll('.align-btn');
    this.cancelBtn = document.getElementById('btn-cancel-hardsub') as HTMLButtonElement;

    // Export Tab Elements
    this.resolutionSelect = document.getElementById('hardsub-resolution') as HTMLSelectElement;
    this.qualityBadge = document.getElementById('hardsub-quality-badge');
    this.qualityPresetsContainer = document.getElementById('hardsub-quality-presets-container');
    this.qualityPresetBtns = document.querySelectorAll('.quality-preset-btn');
    this.qualitySliderContainer = document.getElementById('hardsub-quality-slider-container');
    this.qualityParamLabel = document.getElementById('hardsub-quality-param-label');
    this.qualityParamVal = document.getElementById('hardsub-quality-param-val');
    this.qualitySlider = document.getElementById('hardsub-quality-slider') as HTMLInputElement;
    this.qualityHint = document.getElementById('hardsub-quality-hint');
    this.speedPresetSelect = document.getElementById('hardsub-speed-preset') as HTMLSelectElement;
    this.audioCodecSelect = document.getElementById('hardsub-audio-codec') as HTMLSelectElement;
    this.audioBitrateContainer = document.getElementById('hardsub-audio-bitrate-container');
    this.audioBitrateSelect = document.getElementById('hardsub-audio-bitrate') as HTMLSelectElement;
    this.ffmpegCmdPreview = document.getElementById('hardsub-ffmpeg-cmd-preview');
    this.btnCopyFfmpegCmd = document.getElementById('btn-copy-ffmpeg-cmd') as HTMLButtonElement;

    this.subtitleCanvas = document.getElementById('hardsub-subtitle-canvas') as HTMLCanvasElement;
    if (this.subtitleCanvas) {
      this.canvasCtx = this.subtitleCanvas.getContext('2d');
    }

    this.freezeCanvas = document.getElementById('hardsub-freeze-canvas') as HTMLCanvasElement;
    if (this.freezeCanvas) {
      this.freezeCtx = this.freezeCanvas.getContext('2d');
    }

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

    // Player Volume & Fullscreen Controls
    this.videoVolumeBtn = document.getElementById('hardsub-btn-volume') as HTMLButtonElement;
    this.videoIconVolUp = document.getElementById('hardsub-icon-vol-up');
    this.videoIconVolMute = document.getElementById('hardsub-icon-vol-mute');
    this.videoVolumeSlider = document.getElementById('hardsub-volume-slider') as HTMLInputElement;
    this.videoFullscreenBtn = document.getElementById('hardsub-btn-fullscreen') as HTMLButtonElement;
    this.videoIconFsEnter = document.getElementById('hardsub-icon-fs-enter');
    this.videoIconFsExit = document.getElementById('hardsub-icon-fs-exit');

    // Query HUD elements
    this.volumeHud = document.getElementById('hardsub-volume-hud');
    this.hudVolUp = document.getElementById('hardsub-hud-vol-up');
    this.hudVolLow = document.getElementById('hardsub-hud-vol-low');
    this.hudVolMute = document.getElementById('hardsub-hud-vol-mute');
    this.hudVolText = document.getElementById('hardsub-volume-hud-text');

    // Dropzone Elements
    this.videoDropZone = document.getElementById('hardsub-video-drop-zone');
    this.subDropZone = document.getElementById('hardsub-sub-drop-zone');
    this.lblVideoName = document.getElementById('lbl-hardsub-video-name');
    this.lblVideoPath = document.getElementById('lbl-hardsub-video-path');
    this.lblSubName = document.getElementById('lbl-hardsub-sub-name');
    this.lblSubPath = document.getElementById('lbl-hardsub-sub-path');

    // Tabs (3 Dedicated Studio Panels)
    this.tabBtnEditor = document.getElementById('hardsub-tab-btn-editor') as HTMLButtonElement;
    this.tabBtnStyle = document.getElementById('hardsub-tab-btn-style') as HTMLButtonElement;
    this.tabBtnExport = document.getElementById('hardsub-tab-btn-export') as HTMLButtonElement;
    this.tabViewEditor = document.getElementById('hardsub-tab-view-editor');
    this.tabViewStyle = document.getElementById('hardsub-tab-view-style');
    this.tabViewExport = document.getElementById('hardsub-tab-view-export');

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

    this.refreshFontRenderScale();

    try {
      const hwStatus = await invoke<HardwareStatus>('check_hardware_encoders');
      if (this.hwSelect) {
        this.hwSelect.innerHTML = '';

        // Standard CPU is always available on all platforms
        const cpuOpt = document.createElement('option');
        cpuOpt.value = 'cpu';
        cpuOpt.textContent = 'Standard CPU (Universal)';
        this.hwSelect.appendChild(cpuOpt);

        if (hwStatus.hasVideotoolbox) {
          const vtOpt = document.createElement('option');
          vtOpt.value = 'videotoolbox';
          vtOpt.textContent = 'Apple VideoToolbox (Apple Silicon / Mac GPU)';
          this.hwSelect.appendChild(vtOpt);
        }

        if (hwStatus.hasNvenc) {
          const nvencOpt = document.createElement('option');
          nvencOpt.value = 'nvenc';
          nvencOpt.textContent = 'NVIDIA NVENC (GPU Acceleration)';
          this.hwSelect.appendChild(nvencOpt);
        }

        if (hwStatus.hasQsv) {
          const qsvOpt = document.createElement('option');
          qsvOpt.value = 'qsv';
          qsvOpt.textContent = 'Intel QSV (QuickSync HW)';
          this.hwSelect.appendChild(qsvOpt);
        }

        if (hwStatus.hasVaapi) {
          const vaapiOpt = document.createElement('option');
          vaapiOpt.value = 'vaapi';
          vaapiOpt.textContent = 'Linux VA-API (AMD/Intel)';
          this.hwSelect.appendChild(vaapiOpt);
        }

        // Verify if currently selected hwAccel is supported on this device
        const matchingOption = this.hwSelect.querySelector(`option[value="${this.state.hwAccel}"]`);
        if (matchingOption) {
          this.hwSelect.value = this.state.hwAccel;
        } else {
          const prevChoice = this.state.hwAccel;
          // Prefer fastest available GPU accelerator or fallback to CPU
          let fallback = 'cpu';
          if (hwStatus.hasVideotoolbox) fallback = 'videotoolbox';
          else if (hwStatus.hasNvenc) fallback = 'nvenc';
          else if (hwStatus.hasVaapi) fallback = 'vaapi';
          else if (hwStatus.hasQsv) fallback = 'qsv';

          this.state.hwAccel = fallback;
          this.hwSelect.value = fallback;

          if (prevChoice && prevChoice !== 'cpu' && prevChoice !== fallback) {
            const notifyFn = (window as any).showNotification;
            const newLabel = this.hwSelect.options[this.hwSelect.selectedIndex]?.text || fallback;
            if (typeof notifyFn === 'function') {
              notifyFn(`Selected hardware accelerator '${prevChoice}' is not supported on this device. Switched to '${newLabel}'.`, 'info', 5000);
            }
          }
        }
        this.updateSupportedCodecs();
        this.updateQualitySliderConfig();
        this.updateQualityUI();
        this.updateFfmpegCommandPreview();
      }
    } catch (e) {
      console.warn('Failed to probe hardware encoders:', e);
      this.updateSupportedCodecs();
      this.updateQualitySliderConfig();
      this.updateQualityUI();
      this.updateFfmpegCommandPreview();
    }
  }

  private updateSupportedCodecs() {
    if (!this.codecSelect) return;
    const hw = this.state.hwAccel || 'cpu';

    // Map of supported codecs per hardware accelerator
    const codecDefinitions: Record<string, Array<{ value: string; label: string }>> = {
      cpu: [
        { value: 'h264', label: 'H.264 / AVC (libx264)' },
        { value: 'h265', label: 'H.265 / HEVC (libx265)' },
        { value: 'av1', label: 'AV1 (libsvtav1 / Next Gen)' },
        { value: 'vp9', label: 'VP9 (Web Optimized)' },
        { value: 'prores', label: 'ProRes (Lossless / HQ)' },
      ],
      videotoolbox: [
        { value: 'h264', label: 'H.264 (VideoToolbox Hardware)' },
        { value: 'h265', label: 'H.265 / HEVC (VideoToolbox Hardware)' },
        { value: 'prores', label: 'ProRes (VideoToolbox Hardware)' },
      ],
      nvenc: [
        { value: 'h264', label: 'H.264 (NVIDIA NVENC)' },
        { value: 'h265', label: 'H.265 / HEVC (NVIDIA NVENC)' },
        { value: 'av1', label: 'AV1 (NVIDIA NVENC)' },
      ],
      qsv: [
        { value: 'h264', label: 'H.264 (Intel QuickSync)' },
        { value: 'h265', label: 'H.265 / HEVC (Intel QuickSync)' },
        { value: 'av1', label: 'AV1 (Intel QuickSync)' },
      ],
      vaapi: [
        { value: 'h264', label: 'H.264 (Linux VA-API)' },
        { value: 'h265', label: 'H.265 / HEVC (Linux VA-API)' },
        { value: 'av1', label: 'AV1 (Linux VA-API)' },
      ],
    };

    const options = codecDefinitions[hw] || codecDefinitions.cpu;
    const currentCodec = this.state.videoCodec;

    this.codecSelect.innerHTML = '';
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      this.codecSelect.appendChild(el);
    }

    const hasCurrent = options.some((o) => o.value === currentCodec);
    if (hasCurrent) {
      this.codecSelect.value = currentCodec;
    } else {
      this.state.videoCodec = options[0].value;
      this.codecSelect.value = options[0].value;
    }
  }

  private async refreshFontRenderScale() {
    try {
      this.fontMetrics = await invoke<{ scale: number; ascentRatio: number; descentRatio: number }>('get_font_render_scale', {
        fontName: this.state.fontName,
        bold: this.state.bold,
        italic: this.state.italic,
      });
    } catch (e: any) {
      console.warn('Failed to fetch font render scale, using defaults:', e);
      this.fontMetrics = { scale: 1, ascentRatio: 0.78, descentRatio: 0.22 };
    }
  }

  private setupEventListeners() {
    // Delegated click and input events on subtitleListContainer for high-performance cue interaction
    this.subtitleListContainer?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      const jumpBtn = target.closest('.jump-cue-btn') as HTMLElement;
      if (jumpBtn) {
        e.stopPropagation();
        const card = jumpBtn.closest('.subtitle-cue-card') as HTMLElement;
        const cueId = card ? parseInt(card.dataset.cueId || '0', 10) : 0;
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue && this.videoElement) {
          this.targetClickedCueId = cue.id;
          this.activeCueId = cue.id;
          this.highlightActiveCard(cue.id);
          this.currentSubtitleText = cue.text;
          this.renderSubtitleOnCanvas();
          if (this.clickLockTimer) clearTimeout(this.clickLockTimer);
          this.clickLockTimer = setTimeout(() => {
            this.targetClickedCueId = null;
          }, 800);

          this.performSafeSeek((cue.startMs + 50) / 1000);
          const p = this.videoElement.play();
          if (p !== undefined) {
            p.catch((err) => console.warn('Jump play warning:', err));
          }
        }
        return;
      }

      const card = target.closest('.subtitle-cue-card') as HTMLElement;
      if (card && !target.closest('textarea')) {
        const cueId = parseInt(card.dataset.cueId || '0', 10);
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue && this.videoElement) {
          this.targetClickedCueId = cue.id;
          this.activeCueId = cue.id;
          this.highlightActiveCard(cue.id);
          this.currentSubtitleText = cue.text;
          this.renderSubtitleOnCanvas();
          if (this.clickLockTimer) clearTimeout(this.clickLockTimer);
          this.clickLockTimer = setTimeout(() => {
            this.targetClickedCueId = null;
          }, 800);

          this.performSafeSeek((cue.startMs + 50) / 1000);
        }
      }
    });

    this.subtitleListContainer?.addEventListener('input', (e) => {
      const textarea = (e.target as HTMLElement).closest('textarea.subtitle-cue-textarea') as HTMLTextAreaElement;
      if (textarea) {
        const cueId = parseInt(textarea.dataset.cueId || '0', 10);
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue) {
          cue.text = textarea.value;
          this.isSubtitlesModified = true;
          if (this.activeCueId === cue.id) {
            this.currentSubtitleText = cue.text;
            this.renderSubtitleOnCanvas();
          }
        }
      }
    });

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
      this.refreshFontRenderScale();
      this.updateLivePreview();
    });

    // Font Size Slider
    this.fontSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.fontSizeSlider!.value, 10);
      this.state.fontSize = val;
      if (this.fontSizeVal) this.fontSizeVal.textContent = `${val}px`;
      this.updateSliderBackground(this.fontSizeSlider!);
      this.updateLivePreview();
    });
    document.getElementById('reset-fontsize')?.addEventListener('click', () => {
      this.state.fontSize = 14;
      if (this.fontSizeSlider) {
        this.fontSizeSlider.value = '14';
        this.updateSliderBackground(this.fontSizeSlider);
      }
      if (this.fontSizeVal) this.fontSizeVal.textContent = '14px';
      this.updateLivePreview();
    });

    // Position Y Slider
    this.positionYSlider?.addEventListener('input', () => {
      const val = parseInt(this.positionYSlider!.value, 10);
      this.state.positionY = val;
      if (this.positionYVal) this.positionYVal.textContent = `${val}px`;
      this.updateSliderBackground(this.positionYSlider!);
      this.updateLivePreview();
    });
    document.getElementById('reset-posy')?.addEventListener('click', () => {
      this.state.positionY = 30;
      if (this.positionYSlider) {
        this.positionYSlider.value = '30';
        this.updateSliderBackground(this.positionYSlider);
      }
      if (this.positionYVal) this.positionYVal.textContent = '30px';
      this.updateLivePreview();
    });

    // Outline Size Slider
    this.outlineSizeSlider?.addEventListener('input', () => {
      const val = parseInt(this.outlineSizeSlider!.value, 10);
      this.state.outlineSize = val;
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = `${val}px`;
      if (this.hexOutlineLabel) this.hexOutlineLabel.textContent = `${this.state.outlineColor} (${val}px)`;
      this.updateSliderBackground(this.outlineSizeSlider!);
      this.updateLivePreview();
    });
    document.getElementById('reset-outline')?.addEventListener('click', () => {
      this.state.outlineSize = 2;
      if (this.outlineSizeSlider) {
        this.outlineSizeSlider.value = '2';
        this.updateSliderBackground(this.outlineSizeSlider);
      }
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
    this.bgBoxOpacitySlider?.addEventListener('input', () => {
      this.state.bgBoxOpacity = parseInt(this.bgBoxOpacitySlider!.value, 10);
      if (this.bgBoxOpacityVal) this.bgBoxOpacityVal.textContent = `${this.state.bgBoxOpacity}%`;
      this.updateSliderBackground(this.bgBoxOpacitySlider!);
      this.updateLivePreview();
    });
    this.bgBoxRadiusSlider?.addEventListener('input', () => {
      this.state.bgBoxRadius = parseInt(this.bgBoxRadiusSlider!.value, 10);
      if (this.bgBoxRadiusVal) this.bgBoxRadiusVal.textContent = `${this.state.bgBoxRadius}px`;
      this.updateSliderBackground(this.bgBoxRadiusSlider!);
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
      this.refreshFontRenderScale();
      this.updateLivePreview();
    });

    // Italic Toggle
    this.italicToggle?.addEventListener('click', () => {
      this.state.italic = !this.state.italic;
      this.italicToggle!.classList.toggle('active', this.state.italic);
      this.refreshFontRenderScale();
      this.updateLivePreview();
    });

    // Format & Codec & HW Acceleration

    // Alignment Controls (Independent Vertical + Horizontal Segmented Pickers)
    const alignValLabel = document.getElementById('hardsub-align-val');
    const alignMap: Record<string, number> = {
      'top-left': 7, 'top-center': 8, 'top-right': 9,
      'middle-left': 4, 'middle-center': 5, 'middle-right': 6,
      'bottom-left': 1, 'bottom-center': 2, 'bottom-right': 3
    };
    const alignNames: Record<number, string> = {
      7: 'Top Left', 8: 'Top Center', 9: 'Top Right',
      4: 'Middle Left', 5: 'Middle Center', 6: 'Middle Right',
      1: 'Bottom Left', 2: 'Bottom Center', 3: 'Bottom Right'
    };

    let currentV = 'bottom';
    let currentH = 'center';

    const updateAlignmentState = () => {
      const key = `${currentV}-${currentH}`;
      const code = alignMap[key] || 2;
      this.state.alignment = code;
      if (alignValLabel) {
        alignValLabel.textContent = alignNames[code] || 'Bottom Center';
      }

      // Disable/gray out Vertical Offset when aligned to Middle (as MarginV has no effect in ASS for middle alignment)
      const posyWrapper = document.getElementById('hardsub-posy-wrapper');
      const posyTitle = document.getElementById('lbl-posy-title');
      if (posyWrapper) {
        if (currentV === 'middle') {
          posyWrapper.classList.add('control-disabled');
          if (posyTitle) posyTitle.textContent = 'Vertical Offset (Middle Locked)';
        } else {
          posyWrapper.classList.remove('control-disabled');
          if (posyTitle) posyTitle.textContent = `Vertical Margin (${currentV === 'top' ? 'Top' : 'Bottom'})`;
        }
      }

      this.updateLivePreview();
    };

    document.querySelectorAll('.align-v-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        currentV = target.dataset.v || 'bottom';
        document.querySelectorAll('.align-v-btn').forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        updateAlignmentState();
      });
    });

    document.querySelectorAll('.align-h-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        currentH = target.dataset.h || 'center';
        document.querySelectorAll('.align-h-btn').forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        updateAlignmentState();
      });
    });

    // Subtitle Search Input
    this.searchInput?.addEventListener('input', () => {
      // Debounced: a full cue-list rebuild per keystroke is far too heavy for
      // feature-length subtitle files (1-2k cues).
      this.searchFilterQuery = this.searchInput!.value.trim().toLowerCase();
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchDebounceTimer = null;
        this.renderSubtitleCards();
      }, 250);
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

  private setupExportEventListeners() {
    // Format Select
    this.formatSelect?.addEventListener('change', () => {
      this.state.outputFormat = this.formatSelect!.value;
      if (this.state.videoPath) {
        this.autoSuggestSubtitleAndOutput(this.state.videoPath);
      }
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Hardware Accelerator Select
    this.hwSelect?.addEventListener('change', () => {
      this.state.hwAccel = this.hwSelect!.value;
      this.updateSupportedCodecs();
      this.updateQualitySliderConfig();
      if (this.state.videoQualityMode === 'preset') {
        this.syncQualityPresetToSlider();
      }
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Video Codec Select
    this.codecSelect?.addEventListener('change', () => {
      this.state.videoCodec = this.codecSelect!.value;
      this.updateQualitySliderConfig();
      if (this.state.videoQualityMode === 'preset') {
        this.syncQualityPresetToSlider();
      }
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Resolution Select
    this.resolutionSelect?.addEventListener('change', () => {
      this.state.resolutionScale = (this.resolutionSelect!.value || 'original') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Quality Preset Buttons (Interactive snapping)
    this.qualityPresetBtns?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = (btn.dataset.preset || 'balanced') as 'draft' | 'balanced' | 'high' | 'lossless';
        this.state.videoQualityPreset = p;
        this.state.videoQualityMode = 'preset';
        this.syncQualityPresetToSlider();
        this.updateQualityUI();
        this.saveExportSettingsToStorage();
        this.updateFfmpegCommandPreview();
      });
    });

    // Custom Quality Slider (Interactive bidirectional adjustment)
    this.qualitySlider?.addEventListener('input', () => {
      if (!this.qualitySlider) return;
      const parsedVal = parseInt(this.qualitySlider.value, 10);
      const val = Number.isNaN(parsedVal) ? this.state.videoQualityValue : parsedVal;
      this.state.videoQualityValue = val;
      if (this.qualityParamVal) {
        this.qualityParamVal.textContent = String(val);
      }
      this.updateSliderBackground(this.qualitySlider);

      // Check if current value matches any preset
      const presets: Array<'draft' | 'balanced' | 'high' | 'lossless'> = ['draft', 'balanced', 'high', 'lossless'];
      const matched = presets.find((p) => this.getRecommendedQualityValue(p) === val);
      if (matched) {
        this.state.videoQualityPreset = matched;
        this.state.videoQualityMode = 'preset';
      } else {
        this.state.videoQualityPreset = 'custom';
        this.state.videoQualityMode = 'custom';
      }

      this.updateQualityUI();
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Speed Preset Select
    this.speedPresetSelect?.addEventListener('change', () => {
      this.state.videoPresetSpeed = (this.speedPresetSelect!.value || 'medium') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Audio Codec Select
    this.audioCodecSelect?.addEventListener('change', () => {
      this.state.audioCodec = (this.audioCodecSelect!.value || 'copy') as any;
      this.updateAudioUI();
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Audio Bitrate Select
    this.audioBitrateSelect?.addEventListener('change', () => {
      this.state.audioBitrate = (this.audioBitrateSelect!.value || '192k') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Copy FFmpeg Command Button (uses global multi-tier clipboard helper from main.js)
    this.btnCopyFfmpegCmd?.addEventListener('click', async () => {
      const text = this.ffmpegCmdPreview?.textContent?.trim();
      if (!text) return;
      const notifyFn = (window as any).showNotification;
      const notify = (msg: string, type: string) => {
        if (typeof notifyFn === 'function') {
          notifyFn(msg, type, 3000);
        }
      };
      try {
        const copyFn = (window as any).copyToClipboard;
        if (typeof copyFn === 'function') {
          await copyFn(text);
        } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text);
        } else {
          throw new Error('No clipboard provider available');
        }
        notify('FFmpeg command copied to clipboard!', 'success');
      } catch (e) {
        console.warn('Failed to copy command to clipboard:', e);
        notify('Failed to copy FFmpeg command.', 'error');
      }
    });
  }

  private updateQualitySliderConfig() {
    if (!this.qualitySlider || !this.qualityParamLabel) return;
    const hw = this.state.hwAccel || 'cpu';
    const codec = this.state.videoCodec || 'h264';

    let min = 0;
    let max = 51;

    if (hw === 'videotoolbox' && codec !== 'prores') {
      this.qualityParamLabel.textContent = 'Quality % (Apple VideoToolbox)';
      min = 1;
      max = 100;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Higher value = Higher visual quality & larger file size (1-100)';
      }
    } else if (hw === 'nvenc') {
      this.qualityParamLabel.textContent = 'CQ (NVIDIA Constant Quality)';
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (1-51)';
      }
    } else if (hw === 'qsv') {
      this.qualityParamLabel.textContent = 'Global Quality (Intel QuickSync)';
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (1-51)';
      }
    } else if (hw === 'vaapi') {
      this.qualityParamLabel.textContent = 'QP (Linux VA-API Constant QP)';
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (1-51)';
      }
    } else if (codec === 'prores') {
      this.qualityParamLabel.textContent = 'ProRes Profile (0=Proxy, 1=LT, 2=Std, 3=HQ, 4=4444)';
      min = 0;
      max = 5;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Higher profile = Higher bit depth & lower compression';
      }
    } else if (codec === 'av1') {
      this.qualityParamLabel.textContent = 'CRF (libsvtav1 Constant Rate Factor)';
      min = 0;
      max = 63;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (0-63)';
      }
    } else if (codec === 'vp9') {
      this.qualityParamLabel.textContent = 'CRF (libvpx-vp9 Constant Rate Factor)';
      min = 0;
      max = 63;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (0-63)';
      }
    } else {
      const encoderName = codec === 'h265' ? 'libx265' : 'libx264';
      this.qualityParamLabel.textContent = `CRF (${encoderName} Constant Rate Factor)`;
      min = 0;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = 'Lower value = Higher visual quality & larger file size (0-51)';
      }
    }

    this.qualitySlider.min = String(min);
    this.qualitySlider.max = String(max);
    this.qualitySlider.step = '1';

    // Direction of the quality scale: for VideoToolbox q:v and ProRes profile,
    // higher = better; every CRF/CQ/GlobalQuality/QP scale is inverted.
    const higherIsBetter = codec === 'prores' || hw === 'videotoolbox';
    const scaleSig = `${hw}|${codec}`;

    if (this.state.videoQualityPreset !== 'custom') {
      this.syncQualityPresetToSlider();
    } else {
      let val = this.state.videoQualityValue;
      if (this.qualityScaleSig !== null && this.qualityScaleSig !== scaleSig) {
        // Remap the custom value across encoder scales so the quality *intent*
        // survives direction-inverted ranges (e.g. x264 CRF 22 -> mid-high
        // VideoToolbox q:v instead of garbage-low, or a sane ProRes profile
        // instead of clamping straight to 4444 XQ).
        const prevSpan = Math.max(1, this.qualityScaleMax - this.qualityScaleMin);
        const frac = this.qualityScaleHigherIsBetter
          ? (val - this.qualityScaleMin) / prevSpan
          : 1 - (val - this.qualityScaleMin) / prevSpan;
        const q = Math.min(1, Math.max(0, frac));
        val = higherIsBetter
          ? Math.round(min + q * (max - min))
          : Math.round(min + (1 - q) * (max - min));
      }
      if (val < min) val = min;
      if (val > max) val = max;
      this.state.videoQualityValue = val;
      this.qualitySlider.value = String(val);
      if (this.qualityParamVal) {
        this.qualityParamVal.textContent = String(val);
      }
      this.updateSliderBackground(this.qualitySlider);
    }

    this.qualityScaleSig = scaleSig;
    this.qualityScaleMin = min;
    this.qualityScaleMax = max;
    this.qualityScaleHigherIsBetter = higherIsBetter;
    this.updateQualityUI();
  }

  private getRecommendedQualityValue(preset: 'draft' | 'balanced' | 'high' | 'lossless' | 'custom'): number {
    const hw = this.state.hwAccel || 'cpu';
    const codec = this.state.videoCodec || 'h264';

    if (hw === 'videotoolbox' && codec === 'prores') {
      switch (preset) {
        case 'draft': return 1; // LT
        case 'high': return 3; // HQ
        case 'lossless': return 4; // 4444
        default: return 2; // Standard
      }
    }

    if (hw === 'videotoolbox') {
      switch (preset) {
        case 'draft': return 50;
        case 'high': return 78;
        case 'lossless': return 90;
        default: return 65;
      }
    }

    if ((hw === 'nvenc' || hw === 'qsv' || hw === 'vaapi') && codec === 'av1') {
      switch (preset) {
        case 'draft': return 32;
        case 'high': return 20;
        case 'lossless': return 16;
        default: return 26;
      }
    }

    if (hw === 'nvenc' || hw === 'qsv' || hw === 'vaapi') {
      switch (preset) {
        case 'draft': return 28;
        case 'high': return 18;
        case 'lossless': return 14;
        default: return 22;
      }
    }

    if (codec === 'prores') {
      switch (preset) {
        case 'draft': return 1; // LT
        case 'high': return 3; // HQ
        case 'lossless': return 4; // 4444
        default: return 2; // Standard
      }
    }

    if (codec === 'av1') {
      switch (preset) {
        case 'draft': return 34;
        case 'high': return 22;
        case 'lossless': return 18;
        default: return 28;
      }
    }

    if (codec === 'vp9') {
      switch (preset) {
        case 'draft': return 36;
        case 'high': return 24;
        case 'lossless': return 18;
        default: return 30;
      }
    }

    if (codec === 'h265') {
      switch (preset) {
        case 'draft': return 29;
        case 'high': return 20;
        case 'lossless': return 16;
        default: return 24;
      }
    }

    // Default H.264 (libx264)
    switch (preset) {
      case 'draft': return 28;
      case 'high': return 18;
      case 'lossless': return 14;
      default: return 22;
    }
  }

  private syncQualityPresetToSlider() {
    if (this.state.videoQualityPreset !== 'custom') {
      const recVal = this.getRecommendedQualityValue(this.state.videoQualityPreset);
      this.state.videoQualityValue = recVal;
      if (this.qualitySlider) {
        this.qualitySlider.value = String(recVal);
        this.updateSliderBackground(this.qualitySlider);
      }
      if (this.qualityParamVal) {
        this.qualityParamVal.textContent = String(recVal);
      }
    }
  }

  private updateQualityUI() {
    const activePreset = this.state.videoQualityPreset;

    // Active state is styled exclusively via the .quality-preset-btn.active CSS
    // rules (single source of truth) — no inline style duplication here.
    this.qualityPresetBtns?.forEach((btn) => {
      const isActive = btn.dataset.preset === activePreset;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });

    if (this.qualityBadge) {
      const badgeNames: Record<string, string> = {
        draft: 'Draft',
        balanced: 'Balanced',
        high: 'High Quality',
        lossless: 'Ultra / Master',
      };
      if (badgeNames[activePreset]) {
        this.qualityBadge.textContent = badgeNames[activePreset];
        this.qualityBadge.style.color = 'var(--color-royal-blue)';
        this.qualityBadge.style.borderColor = 'rgba(59, 130, 246, 0.3)';
        this.qualityBadge.style.background = 'rgba(59, 130, 246, 0.15)';
      } else {
        this.qualityBadge.textContent = `Custom (${this.state.videoQualityValue})`;
        this.qualityBadge.style.color = 'var(--color-cyan)';
        this.qualityBadge.style.borderColor = 'rgba(6, 182, 212, 0.3)';
        this.qualityBadge.style.background = 'rgba(6, 182, 212, 0.15)';
      }
    }
  }

  private updateAudioUI() {
    const isCopyOrMute = this.state.audioCodec === 'copy' || this.state.audioCodec === 'mute';
    if (this.audioBitrateContainer) {
      this.audioBitrateContainer.style.opacity = isCopyOrMute ? '0.4' : '1';
      this.audioBitrateContainer.style.pointerEvents = isCopyOrMute ? 'none' : 'auto';
    }
    if (this.audioBitrateSelect) {
      this.audioBitrateSelect.disabled = isCopyOrMute;
    }
  }

  private updateFfmpegCommandPreview() {
    if (!this.ffmpegCmdPreview) return;
    const args: string[] = ['ffmpeg', '-nostdin', '-progress', 'pipe:1'];

    if (this.state.hwAccel === 'vaapi') {
      args.push('-vaapi_device', '/dev/dri/renderD128');
    }

    const inputName = this.state.videoPath ? `"${this.state.videoPath.split(/[/\\]/).pop() || this.state.videoPath}"` : '"input.mp4"';
    const subName = this.state.subtitlePath ? `"${this.state.subtitlePath.split(/[/\\]/).pop() || this.state.subtitlePath}"` : '"subtitles.ass"';
    const outputExt = this.state.outputFormat || 'mp4';
    const outputName = `"output.${outputExt}"`;

    args.push('-noautorotate', '-y', '-i', inputName);

    // Video Filter
    const vfParts: string[] = [`subtitles=${subName}`];
    if (this.state.resolutionScale && this.state.resolutionScale !== 'original') {
      const scaleMap: Record<string, string> = {
        '4k': 'scale=3840:-2:flags=bicubic',
        '2k': 'scale=2560:-2:flags=bicubic',
        '1080p': 'scale=1920:-2:flags=bicubic',
        '720p': 'scale=1280:-2:flags=bicubic',
        '480p': 'scale=854:-2:flags=bicubic',
      };
      if (scaleMap[this.state.resolutionScale]) {
        vfParts.push(scaleMap[this.state.resolutionScale]);
      }
    }
    if (this.state.hwAccel === 'vaapi') {
      vfParts.push('format=nv12,hwupload');
    }
    args.push('-vf', `"${vfParts.join(',')}"`);

    // Video Encoder Flags
    const hw = this.state.hwAccel || 'cpu';
    const codec = this.state.videoCodec || 'h264';
    const qVal = this.state.videoQualityValue;
    const speed = this.state.videoPresetSpeed || 'medium';

    if (hw === 'qsv') {
      const qsvCodec = codec === 'h265' ? 'hevc_qsv' : codec === 'av1' ? 'av1_qsv' : 'h264_qsv';
      const qsvPreset = speed === 'fast' ? 'faster' : speed === 'slow' ? 'slow' : 'medium';
      args.push('-c:v', qsvCodec, '-preset', qsvPreset, '-global_quality', String(qVal));
    } else if (hw === 'nvenc') {
      const nvCodec = codec === 'h265' ? 'hevc_nvenc' : codec === 'av1' ? 'av1_nvenc' : 'h264_nvenc';
      const nvPreset = speed === 'fast' ? 'p2' : speed === 'slow' ? 'p6' : 'p4';
      args.push('-c:v', nvCodec, '-preset', nvPreset, '-cq', String(qVal));
    } else if (hw === 'vaapi') {
      const vaCodec = codec === 'h265' ? 'hevc_vaapi' : codec === 'av1' ? 'av1_vaapi' : 'h264_vaapi';
      args.push('-c:v', vaCodec, '-qp', String(qVal));
    } else if (hw === 'videotoolbox') {
      if (codec === 'prores') {
        args.push('-c:v', 'prores_videotoolbox', '-profile:v', String(qVal));
      } else {
        const vtCodec = codec === 'h265' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
        args.push('-c:v', vtCodec, '-q:v', String(qVal));
      }
    } else {
      // CPU
      if (codec === 'h265') {
        const cpuPreset = speed === 'fast' ? 'fast' : speed === 'slow' ? 'slow' : 'medium';
        args.push('-c:v', 'libx265', '-crf', String(qVal), '-preset', cpuPreset);
      } else if (codec === 'av1') {
        const svtPreset = speed === 'fast' ? '8' : speed === 'slow' ? '4' : '6';
        args.push('-c:v', 'libsvtav1', '-crf', String(qVal), '-preset', svtPreset);
      } else if (codec === 'vp9') {
        const deadline = speed === 'fast' ? 'realtime' : 'good';
        const cpuUsed = speed === 'fast' ? '4' : speed === 'slow' ? '0' : '2';
        args.push('-c:v', 'libvpx-vp9', '-crf', String(qVal), '-b:v', '0', '-deadline', deadline, '-cpu-used', cpuUsed);
      } else if (codec === 'prores') {
        args.push('-c:v', 'prores_ks', '-profile:v', String(qVal));
      } else {
        const cpuPreset = speed === 'fast' ? 'faster' : speed === 'slow' ? 'slow' : 'medium';
        args.push('-c:v', 'libx264', '-crf', String(qVal), '-preset', cpuPreset);
      }
    }

    // Audio Flags
    if (this.state.audioCodec === 'mute') {
      args.push('-an');
    } else if (this.state.audioCodec === 'aac') {
      args.push('-c:a', 'aac', '-b:a', this.state.audioBitrate || '192k');
    } else if (this.state.audioCodec === 'opus') {
      args.push('-c:a', 'libopus', '-b:a', this.state.audioBitrate || '192k');
    } else if (this.state.audioCodec === 'mp3') {
      args.push('-c:a', 'libmp3lame', '-b:a', this.state.audioBitrate || '192k');
    } else {
      args.push('-c:a', 'copy');
    }

    args.push(outputName);

    this.ffmpegCmdPreview.textContent = args.join(' ');
  }

  private loadExportSettingsFromStorage() {
    try {
      const raw = localStorage.getItem('whisper_hardsub_export_settings');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      const validFormats = ['mp4', 'mkv', 'webm', 'mov'];
      const validSpeeds = ['fast', 'medium', 'slow'];
      const validScales = ['original', '4k', '2k', '1080p', '720p', '480p'];
      const validAudioCodecs = ['copy', 'aac', 'opus', 'mp3', 'mute'];
      const validAudioBitrates = ['96k', '128k', '192k', '256k', '320k'];
      const validPresets = ['draft', 'balanced', 'high', 'lossless', 'custom'];

      if (typeof parsed.outputFormat === 'string' && validFormats.includes(parsed.outputFormat)) {
        this.state.outputFormat = parsed.outputFormat;
      }
      if (typeof parsed.videoCodec === 'string') {
        this.state.videoCodec = parsed.videoCodec;
      }
      if (typeof parsed.hwAccel === 'string') {
        this.state.hwAccel = parsed.hwAccel;
      }
      if (typeof parsed.videoQualityPreset === 'string' && validPresets.includes(parsed.videoQualityPreset)) {
        this.state.videoQualityPreset = parsed.videoQualityPreset as any;
        this.state.videoQualityMode = parsed.videoQualityPreset === 'custom' ? 'custom' : 'preset';
      }
      if (typeof parsed.videoQualityValue === 'number' && !Number.isNaN(parsed.videoQualityValue)) {
        this.state.videoQualityValue = Math.max(0, Math.min(100, parsed.videoQualityValue));
      }
      if (typeof parsed.videoPresetSpeed === 'string' && validSpeeds.includes(parsed.videoPresetSpeed)) {
        this.state.videoPresetSpeed = parsed.videoPresetSpeed as any;
      }
      if (typeof parsed.resolutionScale === 'string' && validScales.includes(parsed.resolutionScale)) {
        this.state.resolutionScale = parsed.resolutionScale as any;
      }
      if (typeof parsed.audioCodec === 'string' && validAudioCodecs.includes(parsed.audioCodec)) {
        this.state.audioCodec = parsed.audioCodec as any;
      }
      if (typeof parsed.audioBitrate === 'string' && validAudioBitrates.includes(parsed.audioBitrate)) {
        this.state.audioBitrate = parsed.audioBitrate as any;
      }

      // Sync DOM inputs with restored state
      if (this.formatSelect) this.formatSelect.value = this.state.outputFormat;
      if (this.hwSelect) this.hwSelect.value = this.state.hwAccel;
      if (this.resolutionSelect) this.resolutionSelect.value = this.state.resolutionScale;
      if (this.speedPresetSelect) this.speedPresetSelect.value = this.state.videoPresetSpeed;
      if (this.audioCodecSelect) this.audioCodecSelect.value = this.state.audioCodec;
      if (this.audioBitrateSelect) this.audioBitrateSelect.value = this.state.audioBitrate;
    } catch (e) {
      console.warn('Failed to load hardsub export settings:', e);
    }
  }

  private saveExportSettingsToStorage(immediate = false) {
    const doSave = () => {
      try {
        const toSave = {
          outputFormat: this.state.outputFormat,
          videoCodec: this.state.videoCodec,
          hwAccel: this.state.hwAccel,
          videoQualityMode: this.state.videoQualityMode,
          videoQualityPreset: this.state.videoQualityPreset,
          videoQualityValue: this.state.videoQualityValue,
          videoPresetSpeed: this.state.videoPresetSpeed,
          resolutionScale: this.state.resolutionScale,
          audioCodec: this.state.audioCodec,
          audioBitrate: this.state.audioBitrate,
        };
        localStorage.setItem('whisper_hardsub_export_settings', JSON.stringify(toSave));
      } catch (e) {
        console.warn('Failed to save hardsub export settings:', e);
      }
    };

    if (immediate) {
      if (this.storageDebounceTimer) {
        clearTimeout(this.storageDebounceTimer);
        this.storageDebounceTimer = null;
      }
      doSave();
    } else {
      if (this.storageDebounceTimer) clearTimeout(this.storageDebounceTimer);
      this.storageDebounceTimer = setTimeout(doSave, 120);
    }
  }

  private setupStudioTabEvents() {
    const tabs = ['editor', 'style', 'export'] as const;
    type StudioTab = (typeof tabs)[number];
    const tabButtons: Record<StudioTab, HTMLButtonElement | null> = {
      editor: this.tabBtnEditor,
      style: this.tabBtnStyle,
      export: this.tabBtnExport,
    };

    // Roving tabindex per APG: only the active tab stays in the Tab order
    const syncTabStates = () => {
      for (const tab of tabs) {
        const btn = tabButtons[tab];
        if (!btn) continue;
        const isActive = tab === this.currentStudioTab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
        btn.tabIndex = isActive ? 0 : -1;
      }
    };

    const switchTab = (tab: StudioTab, focus = false) => {
      if (focus) tabButtons[tab]?.focus();
      if (this.currentStudioTab === tab) return;

      const isForward = tabs.indexOf(tab) > tabs.indexOf(this.currentStudioTab);
      this.currentStudioTab = tab;
      syncTabStates();

      const updateView = (el: HTMLElement | null, isActive: boolean) => {
        if (!el) return;
        if (isActive) {
          el.style.display = 'flex';
          el.classList.remove('slide-from-right', 'slide-from-left', 'fade-enter');
          void el.offsetHeight; // force DOM reflow
          el.classList.add(isForward ? 'slide-from-right' : 'slide-from-left');
        } else {
          el.style.display = 'none';
          el.classList.remove('slide-from-right', 'slide-from-left', 'fade-enter');
        }
      };

      updateView(this.tabViewEditor, tab === 'editor');
      updateView(this.tabViewStyle, tab === 'style');
      updateView(this.tabViewExport, tab === 'export');
    };

    syncTabStates();

    this.tabBtnEditor?.addEventListener('click', () => switchTab('editor'));
    this.tabBtnStyle?.addEventListener('click', () => switchTab('style'));
    this.tabBtnExport?.addEventListener('click', () => switchTab('export'));

    const tabsContainer = this.tabBtnEditor?.closest('.hardsub-tabs-container');
    tabsContainer?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      let targetIdx = -1;
      if (e.key === 'ArrowRight') {
        targetIdx = (tabs.indexOf(this.currentStudioTab) + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        targetIdx = (tabs.indexOf(this.currentStudioTab) - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        targetIdx = 0;
      } else if (e.key === 'End') {
        targetIdx = tabs.length - 1;
      }

      if (targetIdx !== -1) {
        e.preventDefault();
        switchTab(tabs[targetIdx], true);
      }
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
      // Abort (code 1) is a normal event when seeking or switching sources; ignore it
      if (err && (err.code === 1 || (typeof MediaError !== 'undefined' && err.code === MediaError.MEDIA_ERR_ABORTED))) {
        return;
      }
      console.warn('HTML5 Video Error:', err);
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Format Error';
        this.videoStatusBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        this.videoStatusBadge.style.color = '#EF4444';
      }
    });

    this.videoElement.addEventListener('loadedmetadata', () => {
      this.updateVideoPreviewOverlayBounds();
      if (this.videoElement) {
        this.syncActiveSubtitleWithTime(this.videoElement.currentTime * 1000);
      }
      this.updateLivePreview();
    });

    this.videoElement.addEventListener('seeking', () => {
      this.captureFreezeFrame();
      if (this.videoElement) {
        this.syncActiveSubtitleWithTime(this.videoElement.currentTime * 1000);
      }
    });

    this.videoElement.addEventListener('seeked', () => {
      this.isManualSeeking = false;
      if (this.videoElement) {
        this.syncActiveSubtitleWithTime(this.videoElement.currentTime * 1000);
      }

      // Live Scrubbing Preview: Update the freeze canvas with the newly decoded frame
      this.captureFreezeFrame(true);

      if (this.pendingSeekTime !== null && this.videoElement) {
        const nextTime = this.pendingSeekTime;
        this.pendingSeekTime = null;
        if ((this.isUserSeeking || this.isScrollingSeek) && typeof (this.videoElement as any).fastSeek === 'function') {
          (this.videoElement as any).fastSeek(nextTime);
        } else {
          this.videoElement.currentTime = nextTime;
        }
      } else {
        this.isSeekingVideo = false;
        this.scheduleDismissFreezeFrame();
      }
    });

    this.videoElement.addEventListener('canplay', () => {
      if (!this.isSeekingVideo && this.pendingSeekTime === null) {
        this.scheduleDismissFreezeFrame();
      }
      if (this.videoStatusBadge && this.videoElement?.paused) {
        this.videoStatusBadge.textContent = 'Video Loaded';
        this.videoStatusBadge.style.background = 'rgba(45, 127, 255, 0.15)';
        this.videoStatusBadge.style.color = 'var(--color-royal-blue)';
      }
    });

    this.videoElement.addEventListener('playing', () => {
      this.scheduleDismissFreezeFrame();
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
        this.videoStatusBadge.style.color = 'var(--color-royal-blue)';
      }
    });

    this.videoElement.addEventListener('timeupdate', () => {
      if (!this.videoElement || this.isUserSeeking || this.isScrollingSeek) return;
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
    this.videoSeekSlider?.addEventListener('pointerdown', () => {
      if (this.videoElement && !this.videoElement.paused) {
        this.wasPlayingBeforeSeek = true;
        this.videoElement.pause();
      }
    });

    this.videoSeekSlider?.addEventListener('input', () => {
      this.isUserSeeking = true;
      if (this.videoElement && this.videoSeekSlider) {
        const pct = parseFloat(this.videoSeekSlider.value);
        this.updateSeekSliderProgress(pct);
        const targetTime = (this.videoElement.duration || 0) * (pct / 100);
        
        if (this.videoTimeDisplay) {
          this.videoTimeDisplay.textContent = `${formatSecondsToDisplay(targetTime)} / ${formatSecondsToDisplay(this.videoElement.duration || 0)}`;
        }

        this.syncActiveSubtitleWithTime(targetTime * 1000);
        this.performSafeSeek(targetTime, true);
      }
    });

    const handleSeekRelease = () => {
      this.isUserSeeking = false;
      if (this.videoElement && this.videoSeekSlider) {
        const pct = parseFloat(this.videoSeekSlider.value);
        const targetTime = (this.videoElement.duration || 0) * (pct / 100);
        this.performSafeSeek(targetTime, false);
      }
      if (this.wasPlayingBeforeSeek && this.videoElement) {
        this.wasPlayingBeforeSeek = false;
        this.videoElement.play().catch(() => {});
      }
    };

    this.videoSeekSlider?.addEventListener('change', handleSeekRelease);
    this.videoSeekSlider?.addEventListener('pointerup', handleSeekRelease);

    // Jump to Prev / Next Cue
    this.prevCueBtn?.addEventListener('click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const prev = [...this.subtitleCues].reverse().find((c) => c.startMs < curMs - 300);
      if (prev) {
        this.performSafeSeek(prev.startMs / 1000);
      }
    });

    this.nextCueBtn?.addEventListener('click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const next = this.subtitleCues.find((c) => c.startMs > curMs + 100);
      if (next) {
        this.performSafeSeek(next.startMs / 1000);
      }
    });

    // Volume slider & Mute button listeners
    this.videoVolumeSlider?.addEventListener('input', () => {
      if (this.videoElement && this.videoVolumeSlider) {
        const val = parseFloat(this.videoVolumeSlider.value);
        this.videoElement.volume = val;
        this.videoElement.muted = (val === 0);
        this.updateVolumeIcons(val, this.videoElement.muted);
        if (val > 0) {
          this.lastVolume = val;
        }
      }
    });

    this.videoVolumeSlider?.addEventListener('change', () => {
      this.videoVolumeSlider?.blur();
    });

    this.videoVolumeBtn?.addEventListener('click', () => {
      if (this.videoElement) {
        const isMuted = !this.videoElement.muted;
        this.videoElement.muted = isMuted;
        
        let volumeToSet = parseFloat(this.videoVolumeSlider?.value || '1');
        if (isMuted) {
          const currentSliderVal = parseFloat(this.videoVolumeSlider?.value || '1');
          if (currentSliderVal > 0) {
            this.lastVolume = currentSliderVal;
          }
          volumeToSet = 0;
        } else {
          volumeToSet = this.lastVolume > 0 ? this.lastVolume : 0.8;
          this.videoElement.volume = volumeToSet;
        }
        
        this.updateVolumeIcons(volumeToSet, isMuted);
        this.videoVolumeBtn?.blur();
      }
    });

    // Fullscreen Toggle
    this.videoFullscreenBtn?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    // Listen to Fullscreen changes
    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement;
      if (this.videoIconFsEnter) this.videoIconFsEnter.style.display = isFs ? 'none' : 'block';
      if (this.videoIconFsExit) this.videoIconFsExit.style.display = isFs ? 'block' : 'none';
    });

    // Auto-hide controls inside player container on mouse inactivity (especially for fullscreen)
    const container = document.getElementById('hardsub-player-container');
    const controls = document.getElementById('hardsub-video-controls');
    let controlsTimeout: any = null;

    const showControlsFunc = () => {
      if (!controls) return;
      controls.classList.add('show-controls');
      if (container) container.style.cursor = 'default';
      
      if (controlsTimeout) clearTimeout(controlsTimeout);
      controlsTimeout = setTimeout(() => {
        const isHoveringControls = controls.matches(':hover');
        if (this.videoElement && !this.videoElement.paused && !isHoveringControls) {
          controls.classList.remove('show-controls');
          if (document.fullscreenElement && container) {
            container.style.cursor = 'none';
          }
        }
      }, 2500);
    };

    container?.addEventListener('mousemove', showControlsFunc);
    container?.addEventListener('mouseenter', showControlsFunc);
    container?.addEventListener('click', showControlsFunc);

    // Custom Viewport mouse interactions on container (Play/Pause, Fullscreen, Volume HUD)
    let clickTimeout: any = null;
    container?.addEventListener('click', (e) => {
      const controls = document.getElementById('hardsub-video-controls');
      if (controls && (e.target === controls || controls.contains(e.target as Node))) {
        return;
      }

      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
        this.toggleFullscreen();
      } else {
        clickTimeout = setTimeout(() => {
          clickTimeout = null;
          if (this.videoElement) {
            if (this.videoElement.paused) {
              this.videoElement.play().catch((err) => console.warn('Video playback notice:', err));
            } else {
              this.videoElement.pause();
            }
          }
        }, 200);
      }
    });

    container?.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.videoElement) return;

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal scroll: seek video virtually
        if (!this.isScrollingSeek) {
          this.isScrollingSeek = true;
          this.virtualCurrentTime = this.videoElement.currentTime;
          if (!this.videoElement.paused) {
            this.wasPlayingBeforeSeek = true;
            this.videoElement.pause();
          }
        }

        const duration = this.videoElement.duration || 0;
        if (duration > 0) {
          // Accumulate horizontal scroll delta (scaled for smooth velocity-based seeking)
          this.virtualCurrentTime = Math.max(0, Math.min(duration, this.virtualCurrentTime + e.deltaX * 0.03));

          // 1. Instantly update seek slider
          const pct = (this.virtualCurrentTime / duration) * 100;
          if (this.videoSeekSlider) {
            this.videoSeekSlider.value = String(pct);
            this.updateSeekSliderProgress(pct);
          }

          // 2. Instantly update time display
          if (this.videoTimeDisplay) {
            this.videoTimeDisplay.textContent = `${formatSecondsToDisplay(this.virtualCurrentTime)} / ${formatSecondsToDisplay(duration)}`;
          }

          // 3. Instantly update canvas subtitle overlay
          this.syncActiveSubtitleWithTime(this.virtualCurrentTime * 1000);

          // 4. Safely seek via single-flight queue (throttled to max once every 30ms)
          const now = Date.now();
          if (now - this.lastThrottleSeekTime > 30) {
            this.performSafeSeek(this.virtualCurrentTime, true);
            this.lastThrottleSeekTime = now;
          }

          // 5. Debounce the final precise seek when scrolling stops
          if (this.scrollSeekTimeout) clearTimeout(this.scrollSeekTimeout);
          this.scrollSeekTimeout = setTimeout(() => {
            if (this.videoElement) {
              this.performSafeSeek(this.virtualCurrentTime, false);
              if (this.wasPlayingBeforeSeek) {
                this.wasPlayingBeforeSeek = false;
                this.videoElement.play().catch(() => {});
              }
            }
            this.isScrollingSeek = false;
          }, 120);
        }
      } else {
        // Vertical scroll: adjust volume
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        const newVal = Math.max(0, Math.min(1, this.videoElement.volume + delta));
        
        this.videoElement.volume = newVal;
        this.videoElement.muted = (newVal === 0);
        if (this.videoVolumeSlider) {
          this.videoVolumeSlider.value = String(newVal);
        }
        this.updateVolumeIcons(newVal, this.videoElement.muted);
        if (newVal > 0) {
          this.lastVolume = newVal;
        }

        this.showVolumeHUD(newVal, this.videoElement.muted);
      }
    }, { passive: false });

    // Global Keyboard Shortcuts for player
    document.addEventListener('keydown', (e) => {
      // Ignore shortcuts if the user is typing in form inputs, textareas or contenteditables
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (!this.videoElement) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.performSafeSeek(Math.max(0, this.videoElement.currentTime - 10));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.performSafeSeek(Math.min(this.videoElement.duration || 0, this.videoElement.currentTime + 10));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.videoVolumeSlider) {
          const newVal = Math.min(1, this.videoElement.volume + 0.05);
          this.videoElement.volume = newVal;
          this.videoElement.muted = (newVal === 0);
          this.videoVolumeSlider.value = String(newVal);
          this.updateVolumeIcons(newVal, this.videoElement.muted);
          this.showVolumeHUD(newVal, this.videoElement.muted);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.videoVolumeSlider) {
          const newVal = Math.max(0, this.videoElement.volume - 0.05);
          this.videoElement.volume = newVal;
          this.videoElement.muted = (newVal === 0);
          this.videoVolumeSlider.value = String(newVal);
          this.updateVolumeIcons(newVal, this.videoElement.muted);
          this.showVolumeHUD(newVal, this.videoElement.muted);
        }
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (this.videoElement.paused) {
          this.videoElement.play().catch((err) => console.warn('Video playback notice:', err));
        } else {
          this.videoElement.pause();
        }
      }
    });
  }

  private setupDragAndDropListeners() {
    const videoDrop = document.getElementById('hardsub-video-drop-zone');
    const subDrop = document.getElementById('hardsub-sub-drop-zone');
    const hardsubPanel = document.getElementById('panel-hardsub');

    const SUPPORTED_VIDEO_EXTS = new Set([
      '.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.m4v', '.wmv',
      '.ts', '.mts', '.m2ts', '.3gp', '.3g2', '.mpeg', '.mpg', '.vob', '.ogv', '.f4v'
    ]);

    const SUPPORTED_SUB_EXTS = new Set([
      '.srt', '.vtt', '.ass', '.ssa', '.sub', '.lrc'
    ]);

    const handleFiles = (files: string[]) => {
      files.forEach((filePath) => {
        const lastDot = filePath.lastIndexOf('.');
        const ext = lastDot !== -1 ? filePath.substring(lastDot).toLowerCase() : '';
        if (SUPPORTED_VIDEO_EXTS.has(ext)) {
          if (this.videoPathInput) this.videoPathInput.value = filePath;
          this.state.videoPath = filePath;
          this.loadVideoMedia(filePath);
          this.autoSuggestSubtitleAndOutput(filePath);
        } else if (SUPPORTED_SUB_EXTS.has(ext)) {
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
    if (!this.videoElement || !this.subtitleCanvas) return;

    const container = document.getElementById('hardsub-player-container');
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const videoW = this.videoElement.videoWidth;
    const videoH = this.videoElement.videoHeight;
    const videoElW = this.videoElement.clientWidth;
    const videoElH = this.videoElement.clientHeight;

    if (!videoW || !videoH || containerWidth === 0 || containerHeight === 0 || videoElW === 0 || videoElH === 0) {
      this.videoDisplayWidth = containerWidth;
      this.videoDisplayHeight = containerHeight;
      this.videoDisplayLeft = 0;
      this.videoDisplayTop = 0;
      this.subtitleCanvas.width = containerWidth;
      this.subtitleCanvas.height = containerHeight;
      this.subtitleCanvas.style.left = '0px';
      this.subtitleCanvas.style.top = '0px';
      if (this.freezeCanvas) {
        this.freezeCanvas.width = containerWidth;
        this.freezeCanvas.height = containerHeight;
        this.freezeCanvas.style.left = '0px';
        this.freezeCanvas.style.top = '0px';
      }
      return;
    }

    const videoElAspect = videoElW / videoElH;
    const videoAspect = videoW / videoH;

    let displayWidth: number;
    let displayHeight: number;

    if (videoAspect > videoElAspect) {
      displayWidth = videoElW;
      displayHeight = videoElW / videoAspect;
    } else {
      displayHeight = videoElH;
      displayWidth = videoElH * videoAspect;
    }

    const left = this.videoElement.offsetLeft + (videoElW - displayWidth) / 2;
    const top = this.videoElement.offsetTop + (videoElH - displayHeight) / 2;

    // Store computed dimensions for canvas renderer
    this.videoDisplayWidth = displayWidth;
    this.videoDisplayHeight = displayHeight;
    this.videoDisplayLeft = left;
    this.videoDisplayTop = top;

    // Size and position the canvas to exactly cover the video display area
    const roundedW = Math.round(displayWidth);
    const roundedH = Math.round(displayHeight);
    const leftPx = `${Math.round(left)}px`;
    const topPx = `${Math.round(top)}px`;

    this.subtitleCanvas.width = roundedW;
    this.subtitleCanvas.height = roundedH;
    this.subtitleCanvas.style.left = leftPx;
    this.subtitleCanvas.style.top = topPx;

    if (this.freezeCanvas) {
      this.freezeCanvas.width = roundedW;
      this.freezeCanvas.height = roundedH;
      this.freezeCanvas.style.left = leftPx;
      this.freezeCanvas.style.top = topPx;
    }

    // Redraw subtitle on resized canvas
    this.renderSubtitleOnCanvas();
  }

  private captureFreezeFrame(force = false) {
    if (!this.videoElement || !this.freezeCanvas || !this.freezeCtx) return;
    if (this.videoElement.readyState < 2) return;
    // Prevent overwriting a valid frozen frame unless forced (e.g. on intermediate seeked frames)
    if (!force && this.isFreezingFrame) return;

    try {
      const w = this.freezeCanvas.width;
      const h = this.freezeCanvas.height;
      if (w > 0 && h > 0) {
        this.freezeCtx.clearRect(0, 0, w, h);
        this.freezeCtx.drawImage(this.videoElement, 0, 0, w, h);
        this.freezeCanvas.style.display = 'block';
        this.isFreezingFrame = true;
      }
    } catch {
      // Ignore cross-origin capture errors if any
    }
  }

  private scheduleDismissFreezeFrame() {
    if (!this.freezeCanvas || !this.isFreezingFrame) return;

    if (this.videoElement && typeof (this.videoElement as any).requestVideoFrameCallback === 'function') {
      (this.videoElement as any).requestVideoFrameCallback(() => {
        if (!this.isSeekingVideo && this.pendingSeekTime === null) {
          this.dismissFreezeFrame();
        }
      });
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.isSeekingVideo && this.pendingSeekTime === null) {
            this.dismissFreezeFrame();
          }
        });
      });
    }
  }

  private dismissFreezeFrame() {
    if (!this.freezeCanvas) return;
    this.freezeCanvas.style.display = 'none';
    this.isFreezingFrame = false;
  }

  private performSafeSeek(targetTime: number, fast: boolean = false) {
    if (!this.videoElement) return;
    const duration = this.videoElement.duration || 0;
    const clamped = Math.max(0, Math.min(duration, targetTime));

    this.captureFreezeFrame();

    if (this.isSeekingVideo || this.videoElement.seeking) {
      this.pendingSeekTime = clamped;
    } else {
      this.isSeekingVideo = true;
      this.pendingSeekTime = null;
      if (fast && typeof (this.videoElement as any).fastSeek === 'function') {
        (this.videoElement as any).fastSeek(clamped);
      } else {
        this.videoElement.currentTime = clamped;
      }
    }
  }

  private updateSeekSliderProgress(pct: number) {
    if (this.videoSeekSlider) {
      const val = Math.max(0, Math.min(100, pct));
      this.videoSeekSlider.style.background = `linear-gradient(to right, var(--color-royal-blue) 0%, var(--color-royal-blue) ${val}%, rgba(255, 255, 255, 0.1) ${val}%, rgba(255, 255, 255, 0.1) 100%)`;
    }
  }

  private updateVolumeIcons(volume: number, muted: boolean) {
    if (muted || volume === 0) {
      if (this.videoIconVolUp) this.videoIconVolUp.style.display = 'none';
      if (this.videoIconVolMute) this.videoIconVolMute.style.display = 'block';
      if (this.videoVolumeSlider) {
        this.videoVolumeSlider.value = '0';
        this.videoVolumeSlider.style.background = `linear-gradient(to right, var(--color-royal-blue) 0%, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.1) 100%)`;
      }
    } else {
      if (this.videoIconVolUp) this.videoIconVolUp.style.display = 'block';
      if (this.videoIconVolMute) this.videoIconVolMute.style.display = 'none';
      if (this.videoVolumeSlider) {
        this.videoVolumeSlider.value = String(volume);
        const pct = volume * 100;
        this.videoVolumeSlider.style.background = `linear-gradient(to right, var(--color-royal-blue) 0%, var(--color-royal-blue) ${pct}%, rgba(255, 255, 255, 0.1) ${pct}%, rgba(255, 255, 255, 0.1) 100%)`;
      }
    }
  }

  private toggleFullscreen() {
    const container = document.getElementById('hardsub-player-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch((err) => {
        console.warn('Error entering fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  private showVolumeHUD(volume: number, muted: boolean) {
    if (!this.volumeHud) return;

    if (this.hudTimeout) {
      clearTimeout(this.hudTimeout);
      this.hudTimeout = null;
    }

    const pct = Math.round(volume * 100);
    if (this.hudVolText) {
      this.hudVolText.textContent = `${pct}%`;
    }

    // Toggle icons
    if (muted || volume === 0) {
      if (this.hudVolUp) this.hudVolUp.style.display = 'none';
      if (this.hudVolLow) this.hudVolLow.style.display = 'none';
      if (this.hudVolMute) this.hudVolMute.style.display = 'block';
    } else if (volume <= 0.5) {
      if (this.hudVolUp) this.hudVolUp.style.display = 'none';
      if (this.hudVolLow) this.hudVolLow.style.display = 'block';
      if (this.hudVolMute) this.hudVolMute.style.display = 'none';
    } else {
      if (this.hudVolUp) this.hudVolUp.style.display = 'block';
      if (this.hudVolLow) this.hudVolLow.style.display = 'none';
      if (this.hudVolMute) this.hudVolMute.style.display = 'none';
    }

    // Show HUD
    this.volumeHud.style.display = 'flex';
    // Force reflow to ensure the transition is animated
    this.volumeHud.offsetHeight;
    this.volumeHud.style.opacity = '1';
    this.volumeHud.style.transform = 'translateY(0)';

    // Schedule hide
    this.hudTimeout = setTimeout(() => {
      if (this.volumeHud) {
        this.volumeHud.style.opacity = '0';
        this.volumeHud.style.transform = 'translateY(-10px)';
        // Wait for CSS transition to complete (250ms) before hiding
        this.hudTimeout = setTimeout(() => {
          if (this.volumeHud && this.volumeHud.style.opacity === '0') {
            this.volumeHud.style.display = 'none';
          }
        }, 250);
      }
    }, 1500);
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

      this.videoElement.crossOrigin = 'anonymous';
      this.videoElement.src = streamUrl;
      this.videoElement.load();
      this.videoElement.style.display = 'block';
      this.isSeekingVideo = false;
      this.pendingSeekTime = null;
      if (this.videoPlaceholder) this.videoPlaceholder.style.display = 'none';
      if (this.subtitleCanvas) this.subtitleCanvas.style.display = 'block';
      if (this.videoStatusBadge) {
        this.videoStatusBadge.textContent = 'Video Loaded';
        this.videoStatusBadge.style.background = 'rgba(45, 127, 255, 0.15)';
        this.videoStatusBadge.style.color = 'var(--color-royal-blue)';
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
      if (this.videoElement) {
        this.syncActiveSubtitleWithTime(this.videoElement.currentTime * 1000);
      }
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

    const frag = document.createDocumentFragment();

    filtered.forEach((cue) => {
      const card = document.createElement('div');
      card.className = `subtitle-cue-card ${this.activeCueId === cue.id ? 'active' : ''}`;
      card.id = `subtitle-cue-${cue.id}`;
      card.dataset.cueId = String(cue.id);

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
        <textarea class="subtitle-cue-textarea" dir="auto" data-cue-id="${cue.id}">${cue.text}</textarea>
      `;

      frag.appendChild(card);
    });

    this.subtitleListContainer.appendChild(frag);
  }

  private syncActiveSubtitleWithTime(curMs: number) {
    if (this.targetClickedCueId !== null) {
      const clickedCue = this.subtitleCues.find((c) => c.id === this.targetClickedCueId);
      if (clickedCue) {
        if (this.activeCueId !== clickedCue.id) {
          this.activeCueId = clickedCue.id;
          this.highlightActiveCard(clickedCue.id);
        }
        this.currentSubtitleText = clickedCue.text;
        this.renderSubtitleOnCanvas();
        return;
      }
    }

    const activeCue = this.subtitleCues.find((c) => curMs >= c.startMs && curMs < c.endMs);

    if (activeCue) {
      if (this.activeCueId !== activeCue.id) {
        this.activeCueId = activeCue.id;
        this.highlightActiveCard(activeCue.id);
      }
      this.currentSubtitleText = activeCue.text;
      this.renderSubtitleOnCanvas();
    } else {
      if (this.activeCueId !== null) {
        this.activeCueId = null;
        this.highlightActiveCard(null);
      }
      this.currentSubtitleText = '';
      this.renderSubtitleOnCanvas();
    }
  }

  private updateSliderBackground(slider: HTMLInputElement) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, var(--color-royal-blue) 0%, var(--color-royal-blue) ${pct}%, rgba(255, 255, 255, 0.1) ${pct}%, rgba(255, 255, 255, 0.1) 100%)`;
  }

  private highlightActiveCard(cueId: number | null) {
    document.querySelectorAll('.subtitle-cue-card').forEach((el) => {
      el.classList.remove('active');
    });

    if (cueId !== null) {
      const activeEl = document.getElementById(`subtitle-cue-${cueId}`);
      if (activeEl) {
        activeEl.classList.add('active');
        if (!this.isUserSeeking) {
          activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
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
    this.updateVideoPreviewOverlayBounds();
    this.updateColorSwatches();

    // Ensure font is loaded before rendering on canvas
    const fontSpec = `16px '${this.state.fontName}'`;
    document.fonts.load(fontSpec).then(() => {
      this.renderSubtitleOnCanvas();
    }).catch(() => {
      // Fallback: render with whatever font is available
      this.renderSubtitleOnCanvas();
    });
  }

  /**
   * Canvas-based subtitle renderer that matches libass/ASS rendering algorithm.
   * Uses the same PlayResY=288 reference height and scaling logic as FFmpeg's
   * subtitles filter with original_size parameter.
   */
  private renderSubtitleOnCanvas() {
    this.updateUIControlsState();
    this.updateColorSwatches();

    const ctx = this.canvasCtx;
    const canvas = this.subtitleCanvas;
    if (!ctx || !canvas) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    if (canvasW === 0 || canvasH === 0) return;

    // Dirty check: skip the expensive parse/wrap/measure pipeline when nothing
    // visible changed. This fires on every timeupdate and wheel tick.
    const renderKey = [
      this.currentSubtitleText,
      canvasW, canvasH,
      JSON.stringify(this.state),
      JSON.stringify(this.fontMetrics),
    ].join('|');
    if (this._lastRenderKey === renderKey) return;
    this._lastRenderKey = renderKey;

    // Clear entire canvas
    ctx.clearRect(0, 0, canvasW, canvasH);

    const text = this.currentSubtitleText;
    if (!text) return;

    // --- ASS-matching scale factor ---
    // PlayResY = 288 (our reference canvas height, same as original_size in FFmpeg)
    const PLAY_RES_Y = 288;
    const scaleFactor = canvasH / PLAY_RES_Y;

    const renderedFontSize = Math.max(4, this.state.fontSize * scaleFactor);
    const renderedOutline = this.state.outlineSize * scaleFactor;
    const renderedMarginV = this.state.positionY * scaleFactor;

    // --- Split text into lines ---
    const lines = text.split('\n');
    const lineHeight = renderedFontSize * 1.35; // ASS default line spacing ≈ 1.35x

    // --- widthMargin is a percentage (e.g. 90 = text occupies 90% of canvas width) ---
    // Convert to actual pixel side-margin for positioning
    const maxTextWidth = canvasW * (this.state.widthMargin / 100);
    const sideMarginPx = (canvasW - maxTextWidth) / 2;

    // --- Parse and Wrap spans ---
    const parsedLines: { spans: TextSpan[]; alignmentOverride: number | null }[] = lines.map((line) =>
      parseLineToSpans(line, this.state.primaryColor)
    );

    // alignmentOverride from any of the parsed lines (if present)
    let alignmentOverride: number | null = null;
    for (const parsed of parsedLines) {
      if (parsed.alignmentOverride !== null) {
        alignmentOverride = parsed.alignmentOverride;
        break;
      }
    }

    const activeAlignment = alignmentOverride ?? this.state.alignment;

    const wrappedLines: TextSpan[][] = [];
    for (const parsed of parsedLines) {
      const lineWrapped = wrapSpans(parsed.spans, maxTextWidth, ctx, this.state.fontName, renderedFontSize);
      wrappedLines.push(...lineWrapped);
    }

    // --- Compute alignment-based position (ASS numpad alignment) ---
    let anchorX: number; // horizontal anchor
    let anchorY: number; // Y of the BOTTOM line's baseline

    const isTop = [7, 8, 9].includes(activeAlignment);
    const isMiddle = [4, 5, 6].includes(activeAlignment);
    const isLeft = [1, 4, 7].includes(activeAlignment);
    const isRight = [3, 6, 9].includes(activeAlignment);
    const isCenter = [2, 5, 8].includes(activeAlignment);

    const textAlignmentStr = isLeft ? 'left' : isRight ? 'right' : 'center';

    // Horizontal alignment
    if (isLeft) {
      anchorX = sideMarginPx;
    } else if (isRight) {
      anchorX = canvasW - sideMarginPx;
    } else {
      anchorX = canvasW / 2;
    }

    // Vertical position (7,8,9 = Top; 4,5,6 = Middle; 1,2,3 = Bottom)
    if (isTop) {
      anchorY = renderedMarginV + renderedFontSize;
    } else if (isMiddle) {
      anchorY = canvasH / 2;
    } else {
      anchorY = canvasH - renderedMarginV;
    }

    // --- Draw one background around the entire caption block ---
    const lineMetrics = wrappedLines.map((line) => measureSpansWidth(ctx, line, this.state.fontName, renderedFontSize));
    const maxLineWidth = Math.max(...lineMetrics, 0);
    const totalFontHeight = renderedFontSize / this.fontMetrics.scale;
    const textAscent = totalFontHeight * this.fontMetrics.ascentRatio;
    const textDescent = totalFontHeight * this.fontMetrics.descentRatio;

    const firstBaselineY = isTop
      ? anchorY - textAscent
      : isMiddle
        ? anchorY - ((wrappedLines.length - 1) * lineHeight) / 2
        : anchorY - ((wrappedLines.length - 1) * lineHeight) / 2;
    const lastBaselineY = isTop
      ? anchorY + ((wrappedLines.length - 1) * lineHeight) - textAscent
      : isMiddle
        ? anchorY + ((wrappedLines.length - 1) * lineHeight) / 2
        : anchorY + ((wrappedLines.length - 1) * lineHeight) / 2;

    if (this.state.bgBox && maxLineWidth > 0) {
      const padding = 6 * scaleFactor;
      const boxWidth = maxLineWidth + padding * 2;
      const boxHeight = (lastBaselineY - firstBaselineY) + textAscent + textDescent + padding * 2;
      const boxX = textAlignmentStr === 'center'
        ? anchorX - boxWidth / 2
        : textAlignmentStr === 'right'
          ? anchorX - boxWidth
          : anchorX - padding;
      const boxY = firstBaselineY - textAscent - padding;
      const radius = Math.min(this.state.bgBoxRadius * scaleFactor, boxWidth / 2, boxHeight / 2);

      ctx.save();
      ctx.fillStyle = this.state.bgBoxColor;
      ctx.globalAlpha = this.state.bgBoxOpacity / 100;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
      ctx.fill();
      ctx.restore();
    }

    // --- Draw each line ---
    ctx.textBaseline = 'alphabetic';

    for (let i = 0; i < wrappedLines.length; i++) {
      const lineSpans = wrappedLines[i];
      let y: number;

      if (isTop) {
        y = anchorY + (i * lineHeight) - textAscent;
      } else if (isMiddle) {
        y = anchorY - ((wrappedLines.length - 1) * lineHeight) / 2 + (i * lineHeight);
      } else {
        y = anchorY - ((wrappedLines.length - 1) * lineHeight) / 2 + (i * lineHeight);
      }

      // Calculate startX for this line based on alignment and width
      const totalLineWidth = measureSpansWidth(ctx, lineSpans, this.state.fontName, renderedFontSize);
      let startX: number;
      if (textAlignmentStr === 'left') {
        startX = anchorX;
      } else if (textAlignmentStr === 'right') {
        startX = anchorX - totalLineWidth;
      } else {
        startX = anchorX - totalLineWidth / 2;
      }

      let currentX = startX;
      ctx.textAlign = 'left'; // Draw spans left-to-right from startX

      for (const span of lineSpans) {
        setSpanFont(ctx, this.state.fontName, renderedFontSize, span.bold, span.italic);

        const spanText = hasRtlCharacters(span.text) ? `\u202B${span.text}\u202C` : span.text;
        const spanWidth = ctx.measureText(span.text).width;

        // --- Outline (matching ASS Outline with contour expansion) ---
        if (renderedOutline > 0) {
          ctx.save();
          ctx.strokeStyle = this.state.outlineColor;
          ctx.lineWidth = renderedOutline * 2; // ASS Outline expands outward; strokeText is centered
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeText(spanText, currentX, y);
          ctx.restore();
        }

        // --- Fill text (primary color) ---
        ctx.fillStyle = span.color;
        ctx.fillText(spanText, currentX, y);

        // --- Draw underline if requested ---
        if (span.underline) {
          drawUnderline(ctx, spanWidth, renderedFontSize, currentX, y, span.color);
        }

        currentX += spanWidth;
      }
    }
  }

  private updateUIControlsState() {
    const resetFont = document.getElementById('reset-fontsize');
    if (resetFont) resetFont.style.display = this.state.fontSize !== 14 ? 'inline-flex' : 'none';

    const resetOutline = document.getElementById('reset-outline');
    if (resetOutline) resetOutline.style.display = this.state.outlineSize !== 2 ? 'inline-flex' : 'none';

    const resetPosy = document.getElementById('reset-posy');
    if (resetPosy) resetPosy.style.display = this.state.positionY !== 30 ? 'inline-flex' : 'none';

    const bgControls = document.getElementById('hardsub-bg-controls');
    const bgExtraControls = document.getElementById('hardsub-bg-extra-controls');
    if (bgControls) {
      bgControls.classList.toggle('control-disabled', !this.state.bgBox);
    }
    if (bgExtraControls) {
      bgExtraControls.classList.toggle('control-disabled', !this.state.bgBox);
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
  private generateAssContent(): string {
    const videoW = this.videoElement?.videoWidth || 1920;
    const videoH = this.videoElement?.videoHeight || 1080;
    const videoAspect = videoH > 0 ? videoW / videoH : 1.777;

    // Use a reference resolution of 288px (same as the canvas preview logic)
    const PLAY_RES_Y = 288;
    const PLAY_RES_X = Math.round(PLAY_RES_Y * videoAspect);

    // All coordinates and sizing are written in the 288p script coordinate space (scaleFactor = 1)
    const scaleFactor = 1;

    const safeFontName = this.state.fontName === 'Inter' ? 'Inter 24pt' : this.state.fontName.replace(/,/g, '').replace(/['"]/g, '');
    const assPrimary = hexToAssColorAndAlpha(this.state.primaryColor, 100);
    const assOutline = hexToAssColorAndAlpha(this.state.outlineColor, 100);
    const assBg = hexToAssColorAndAlpha(this.state.bgBoxColor, this.state.bgBoxOpacity);
    const alignment = this.state.alignment;
    const assAlignment = alignment;
    const marginLR = Math.round(((100 - this.state.widthMargin) / 200) * PLAY_RES_X);

    // Create temp canvas to measure text widths and perform line wrapping
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = PLAY_RES_X;
    tempCanvas.height = PLAY_RES_Y;
    const tempCtx = tempCanvas.getContext('2d');

    // libass sizes glyphs by the font's GDI cell height (usWinAscent+usWinDescent)
    // instead of the em box, so divide the font size to make the hardsub match
    // the canvas preview (which uses CSS em semantics).
    const assFontSize = Math.round((this.state.fontSize / this.fontMetrics.scale) * 100) / 100;

    const textStyle = `Style: TextStyle,${safeFontName},${assFontSize},${assPrimary},&H000000FF,${assOutline},&HFFFFFFFF,${this.state.bold ? -1 : 0},${this.state.italic ? -1 : 0},0,0,100,100,0,0,1,${this.state.outlineSize},0,${assAlignment},${marginLR},${marginLR},${this.state.positionY},1`;
    const boxStyle = `Style: BoxStyle,${safeFontName},${assFontSize},${assBg},&H000000FF,${assBg},${assBg},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`;

    let events = '';
    if (tempCtx) {
      tempCtx.textBaseline = 'alphabetic';

      const maxTextWidth = PLAY_RES_X * (this.state.widthMargin / 100);
      const lineHeight = this.state.fontSize * 1.35;
      const totalFontHeight = this.state.fontSize / this.fontMetrics.scale;
      const textAscent = totalFontHeight * this.fontMetrics.ascentRatio;
      const textDescent = totalFontHeight * this.fontMetrics.descentRatio;
      const padding = 6 * scaleFactor;

      this.subtitleCues.forEach((cue) => {
        const startStr = msToAssTime(cue.startMs);
        const endStr = msToAssTime(cue.endMs);
        const lines = cue.text.split('\n');

        // Parse lines to spans
        const parsedLines = lines.map((line) => parseLineToSpans(line, this.state.primaryColor));

        // Find active alignment override for the cue
        let alignmentOverride: number | null = null;
        for (const parsed of parsedLines) {
          if (parsed.alignmentOverride !== null) {
            alignmentOverride = parsed.alignmentOverride;
            break;
          }
        }
        const activeAlignment = alignmentOverride ?? this.state.alignment;

        const cueIsTopAss = [7, 8, 9].includes(activeAlignment);
        const cueIsMiddleAss = [4, 5, 6].includes(activeAlignment);
        const cueIsLeftAss = [1, 4, 7].includes(activeAlignment);
        const cueIsRightAss = [3, 6, 9].includes(activeAlignment);

        // Wrap spans to fit within maxTextWidth
        const wrappedLines: TextSpan[][] = [];
        for (const parsed of parsedLines) {
          const lineWrapped = wrapSpans(parsed.spans, maxTextWidth, tempCtx, this.state.fontName, this.state.fontSize);
          wrappedLines.push(...lineWrapped);
        }

        const lineMetrics = wrappedLines.map((line) => measureSpansWidth(tempCtx, line, this.state.fontName, this.state.fontSize));
        const maxLineWidth = Math.max(...lineMetrics, 0);

        let X = 0;
        if (cueIsLeftAss) {
          X = marginLR;
        } else if (cueIsRightAss) {
          X = PLAY_RES_X - marginLR;
        } else {
          X = PLAY_RES_X / 2;
        }

        let Y = 0;
        if (cueIsTopAss) {
          Y = this.state.positionY * scaleFactor;
        } else if (cueIsMiddleAss) {
          Y = PLAY_RES_Y / 2;
        } else {
          Y = PLAY_RES_Y - (this.state.positionY * scaleFactor);
        }

        const anchorY = cueIsTopAss ? Y + this.state.fontSize : Y;

        const firstBaselineY = cueIsTopAss
          ? anchorY - textAscent
          : anchorY - ((wrappedLines.length - 1) * lineHeight) / 2;

        const lastBaselineY = cueIsTopAss
          ? anchorY + ((wrappedLines.length - 1) * lineHeight) - textAscent
          : anchorY + ((wrappedLines.length - 1) * lineHeight) / 2;

        const boxY = firstBaselineY - textAscent - padding;

        if (this.state.bgBox && maxLineWidth > 0) {
          const boxWidth = maxLineWidth + padding * 2;
          const boxHeight = (lastBaselineY - firstBaselineY) + textAscent + textDescent + padding * 2;
          
          let x = 0;
          if (cueIsLeftAss) {
            x = -padding;
          } else if (cueIsRightAss) {
            x = -boxWidth + padding;
          } else {
            x = -boxWidth / 2;
          }

          const drawingPath = generateRoundedRectASS(x, 0, boxWidth, boxHeight, this.state.bgBoxRadius * scaleFactor);
          events += `Dialogue: 0,${startStr},${endStr},BoxStyle,,0,0,0,,{\\an7}{\\pos(${X},${boxY})}{\\p1}${drawingPath}{\\p0}\n`;
        }

        wrappedLines.forEach((lineSpans, index) => {
          let lineBaselineY = 0;
          if (cueIsTopAss) {
            lineBaselineY = anchorY + index * lineHeight - textAscent;
          } else {
            lineBaselineY = anchorY - ((wrappedLines.length - 1) * lineHeight) / 2 + index * lineHeight;
          }
          const lineY = lineBaselineY - textAscent;
          let dialogueAlignment = 8;
          if (cueIsLeftAss) {
            dialogueAlignment = 7;
          } else if (cueIsRightAss) {
            dialogueAlignment = 9;
          }

          let assLineText = '';
          for (const span of lineSpans) {
            const bTag = span.bold ? '\\b1' : '\\b0';
            const iTag = span.italic ? '\\i1' : '\\i0';
            const uTag = span.underline ? '\\u1' : '\\u0';

            const cleanColor = span.color.replace('#', '');
            let assColor = 'FFFFFF';
            if (cleanColor.length === 6) {
              const r = cleanColor.substring(0, 2);
              const g = cleanColor.substring(2, 4);
              const b = cleanColor.substring(4, 6);
              assColor = `${b}${g}${r}`;
            }
            const cTag = `\\c&H${assColor}&`;

            assLineText += `{${bTag}${iTag}${uTag}${cTag}}${span.text}`;
          }

          const finalLineText = hasRtlCharacters(assLineText) ? `\u202B${assLineText}\u202C` : assLineText;
          events += `Dialogue: 1,${startStr},${endStr},TextStyle,,0,0,0,,{\\an${dialogueAlignment}}{\\pos(${X},${lineY})}${finalLineText}\n`;
        });
      });
    }

    return `[Script Info]
Title: Hardsub Temporary Script
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: ${PLAY_RES_X}
PlayResY: ${PLAY_RES_Y}
; FontRenderScale: ${this.fontMetrics.scale}
; FontSize: ${this.state.fontSize}
; AssFontSize: ${assFontSize}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${textStyle}
${boxStyle}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
  }

  private async startHardsub() {
    // Make sure the font render scale is up to date before generating the ASS
    // (avoids a race with a pending refreshFontRenderScale() call).
    await this.refreshFontRenderScale();

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

    const originalSubPath = this.state.subtitlePath;

    if (this.subtitleCues.length === 0 && originalSubPath) {
      await this.loadSubtitleFile(originalSubPath);
    }

    if (this.isSubtitlesModified && this.subtitleCues.length > 0) {
      try {
        const srtContent = convertCuesToSrt(this.subtitleCues);
        await invoke('write_text_file_content', {
          filePath: originalSubPath,
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

    if (this.subtitleCues.length > 0) {
      try {
        const lastDot = this.state.videoPath.lastIndexOf('.');
        const tempAssPath = this.state.videoPath.substring(0, lastDot) + '.temp.ass';
        const assContent = this.generateAssContent();
        await invoke('write_text_file_content', {
          filePath: tempAssPath,
          content: assContent,
        });
        // Save a debug copy in the project root to inspect the exact styles and events
        await invoke('write_text_file_content', {
          filePath: '/home/ahmad/Projects/whisper-desktop/debug_subtitles.ass',
          content: assContent,
        });

        console.log('Generated temporary ASS subtitle file with styled vector boxes');
        this.state.subtitlePath = tempAssPath;
      } catch (e) {
        console.warn('Failed to generate temporary ASS subtitles, falling back to original:', e);
      }
    }

    try {
      // Ensure all export settings dropdown values and slider values are synced with state
      if (this.codecSelect?.value) {
        this.state.videoCodec = this.codecSelect.value;
      }
      if (this.formatSelect?.value) {
        this.state.outputFormat = this.formatSelect.value;
      }
      if (this.hwSelect?.value) {
        this.state.hwAccel = this.hwSelect.value;
      }
      if (this.resolutionSelect?.value) {
        this.state.resolutionScale = this.resolutionSelect.value as any;
      }
      if (this.speedPresetSelect?.value) {
        this.state.videoPresetSpeed = this.speedPresetSelect.value as any;
      }
      if (this.audioCodecSelect?.value) {
        this.state.audioCodec = this.audioCodecSelect.value as any;
      }
      if (this.audioBitrateSelect?.value) {
        this.state.audioBitrate = this.audioBitrateSelect.value as any;
      }
      if (this.qualitySlider?.value) {
        this.state.videoQualityValue = parseInt(this.qualitySlider.value, 10) || this.state.videoQualityValue;
      }
      // Persist immediately: encoding is starting and the app may close before
      // the debounced write fires.
      this.saveExportSettingsToStorage(true);

      this.updateEncodingUIState(true);
      if (this.progressFill) {
        this.progressFill.style.width = '0%';
      }
      if (this.progressPctText) {
        this.progressPctText.textContent = '0%';
      }
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
        if ((window as any).showNotification) {
          (window as any).showNotification(`Hardsub encoding failed: ${e}`, "error");
        } else {
          alert(`Hardsub failed: ${e}`);
        }
        if (this.progressStatusText) {
          this.progressStatusText.textContent = `Error: ${e}`;
        }
      }
    } finally {
      this.updateEncodingUIState(false);
      this.state.subtitlePath = originalSubPath; // Restore original path in UI state
    }
  }
}

export const hardsubController = new HardsubController();
