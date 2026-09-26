import { t, firstStrongDirection, applyTextDirection, applyContentDirection, clearContentDirection, isolateDirection, isolateLtr } from './i18n/index';
import { spanOrigins, assRunOrder, protectRtlPunctuation } from './hardsubLayout';

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
  throw new Error('Tauri event API not available');
};

interface SourceInfo {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  durationSec: number | null;
  videoStreamIndex: number;
  audioStreamIndex: number | null;
  startTimeSec: number;
}

interface PreviewCandidate {
  requestId: number;
  candidateId: string;
  url: string;
  stage: 'direct' | 'remux' | 'mp4' | 'webm';
  source: SourceInfo | null;
}

interface PreviewError {
  code: 'cancelled' | 'source_missing' | 'source_invalid' | 'tools_unavailable' | 'probe_failed' | 'encoder_unavailable' | 'conversion_failed' | 'storage_failed' | 'stale_request' | 'no_compatible_preview';
  detail: string;
}

interface PreviewProgress {
  requestId: number;
  stage: 'probing' | 'remux' | 'mp4' | 'webm' | 'finalizing';
  progress: number | null;
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
  outputDir?: string;
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

export function getParentDir(filePath: string): string {
  if (!filePath) return '';
  const clean = filePath.trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (lastSlash === 0) return '/';
  if (clean.length >= 3 && clean[1] === ':' && lastSlash === 2) {
    return clean.substring(0, 3);
  }
  return lastSlash > 0 ? clean.substring(0, lastSlash) : '';
}

export function joinPath(dir: string, file: string): string {
  if (!dir) return file;
  const isWindows = dir.includes('\\');
  const sep = isWindows ? '\\' : '/';
  if (dir.endsWith('/') || dir.endsWith('\\')) {
    return `${dir}${file}`;
  }
  return `${dir}${sep}${file}`;
}

export function formatHardsubStatus(data: {
  progress: number;
  message: string;
  active: boolean;
  stage?: string;
  speed?: string;
  fps?: string;
}): string {
  const pct = Math.round(data.progress * 100);
  let stage = data.stage;
  let speed = data.speed;
  let fps = data.fps;

  const rawMsg = data.message || '';
  if (!stage) {
    if (rawMsg.includes('Initializing') || rawMsg.includes('Encoder')) {
      stage = 'init';
    } else if (rawMsg.includes('Embedding Subtitles')) {
      stage = 'encoding';
    } else if (rawMsg.includes('Finalizing video export') || rawMsg.includes('Finalizing')) {
      stage = 'finalizing';
    } else if (rawMsg.includes('exported successfully')) {
      stage = 'completed';
    } else if (rawMsg.includes('cancelled') || rawMsg.includes('Cancelled')) {
      stage = 'cancelled';
    } else if (rawMsg.includes('encoding failed') || rawMsg.includes('failed')) {
      stage = 'failed';
    }
  }

  if (!speed) {
    const speedMatch = rawMsg.match(/Speed:\s*([^\s|)]+)/i);
    if (speedMatch) speed = speedMatch[1];
  }
  if (!fps) {
    const fpsMatch = rawMsg.match(/([\d.]+)\s*FPS/i);
    if (fpsMatch) fps = fpsMatch[1];
  }

  if (stage === 'init') {
    return t('hardsub.statusInitEncoder');
  }

  if (stage === 'encoding') {
    const detailParts: string[] = [];
    if (speed) {
      detailParts.push(t('hardsub.statSpeed', { speed }));
    }
    if (fps) {
      detailParts.push(t('hardsub.statFps', { fps }));
    }
    if (detailParts.length > 0) {
      return t('hardsub.statusEmbeddingStats', {
        percent: pct,
        stats: detailParts.join(' | '),
      });
    }
    return t('hardsub.statusEmbedding', { percent: pct });
  }

  if (stage === 'finalizing') {
    return t('hardsub.statusFinalizing');
  }

  if (stage === 'completed') {
    return t('hardsub.statusExportSuccess');
  }

  if (stage === 'cancelled') {
    return t('hardsub.statusEncodingCancelled');
  }

  if (stage === 'failed') {
    return t('hardsub.statusEncodingFailed');
  }

  return rawMsg ? isolateDirection(rawMsg) : '';
}

/**
 * Paragraph direction of a cue, decided by its first strong character. Text with no
 * strong character to read takes `fallback` — LTR by default, which is what libass
 * does with such a line. The rule itself lives in i18n, shared with every text field
 * that follows its content so a line cannot be read one way here and another way
 * there.
 *
 * This exists because the canvas inherits the interface's base direction: in a
 * Persian UI an English cue drawn without this renders its neutrals the wrong way
 * round ("Hello:" comes out as ":Hello") and stops matching the burned video.
 */
function detectBaseDirection(text: string, fallback: 'rtl' | 'ltr' = 'ltr'): 'rtl' | 'ltr' {
  return firstStrongDirection(text) ?? fallback;
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
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues;
}

export function findCueAtTimeBinary(cues: SubtitleCue[], curMs: number, maxDuration?: number): SubtitleCue | undefined {
  if (!cues.length) return undefined;
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (cues[mid].startMs <= curMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate !== -1) {
    const cue = cues[candidate];
    if (curMs >= cue.startMs && curMs < cue.endMs) {
      return cue;
    }
    for (let i = candidate - 1; i >= 0; i--) {
      const prev = cues[i];
      if (maxDuration !== undefined && curMs - prev.startMs > maxDuration) break;
      if (curMs >= prev.startMs && curMs < prev.endMs) {
        return prev;
      }
    }
  }
  return undefined;
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

function measureSpanWidths(ctx: CanvasRenderingContext2D, spans: TextSpan[], fontFamily: string, baseFontSize: number): number[] {
  return spans.map((span) => {
    ctx.save();
    setSpanFont(ctx, fontFamily, baseFontSize, span.bold, span.italic);
    const width = ctx.measureText(span.text).width;
    ctx.restore();
    return width;
  });
}

function measureSpansWidth(ctx: CanvasRenderingContext2D, spans: TextSpan[], fontFamily: string, baseFontSize: number): number {
  return measureSpanWidths(ctx, spans, fontFamily, baseFontSize).reduce((total, width) => total + width, 0);
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
  private placeholderIdle: HTMLElement | null = null;
  private placeholderLoading: HTMLElement | null = null;
  private placeholderLoadingText: HTMLElement | null = null;
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

  // Media Resource Accordion Elements
  private mediaStepEl: HTMLElement | null = null;
  private mediaStepHeader: HTMLElement | null = null;
  private mediaStepIcon: HTMLElement | null = null;
  private mediaStepChevron: HTMLElement | null = null;
  private mediaSummaryBadge: HTMLElement | null = null;

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
  private telemetryBox: HTMLElement | null = null;

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
  private outputDirText: HTMLElement | null = null;
  private btnBrowseDir: HTMLButtonElement | null = null;
  private btnResetDir: HTMLButtonElement | null = null;
  private btnOpenFolder: HTMLButtonElement | null = null;
  private lastExportedPath: string | null = null;
  private lastStatusPayload: {
    progress: number;
    message: string;
    active: boolean;
    stage?: string;
    speed?: string;
    fps?: string;
  } | null = null;

  // Internal State
  private state: HardsubSettings = {
    videoPath: '',
    subtitlePath: '',
    outputPath: '',
    outputDir: '',
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
  private cachedHwStatus: HardwareStatus | null = null;
  private updateAlignmentUI: () => void = () => {};
  private subtitleCues: SubtitleCue[] = [];
  private maxCueDuration: number = 0;
  private activeCueId: number | null = null;
  private searchFilterQuery: string = '';
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastRenderKey: string = '';
  private _lastUIStateKey: string = '';
  private isUserSeeking: boolean = false;
  private targetClickedCueId: number | null = null;
  private clickLockTimer: any = null;
  private isSubtitlesModified: boolean = false;
  private isSeekingVideo: boolean = false;
  private pendingSeek: { time: number; precise: boolean } | null = null;
  private wasPlayingBeforeSeek: boolean = false;
  private videoLoadGeneration = 0;
  private pageActive = false;
  private disposed = false;
  private phase: 'idle' | 'loading' | 'preparing' | 'ready' | 'error' | 'cancelled' = 'idle';
  private playbackError: 'network' | 'decode' | 'timeout' | null = null;
  private candidateId = '';
  private expectedMediaUrl = '';
  private playIntent = false;
  private playSerial = 0;
  private domTeardowns: Array<() => void> = [];
  private mediaTeardowns: Array<() => void> = [];
  private nativeTeardowns: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private controlsTimeout: ReturnType<typeof setTimeout> | null = null;
  private clickTimeout: ReturnType<typeof setTimeout> | null = null;
  private accordionTimeout: ReturnType<typeof setTimeout> | null = null;
  private seekWatchdog: ReturnType<typeof setTimeout> | null = null;
  private freezeTimeout: ReturnType<typeof setTimeout> | null = null;
  private freezeAnimationFrame: number | null = null;
  private videoFrameCallback: number | null = null;
  private seekSerial = 0;
  private activeSeekPrecise = true;
  private previewRequestCounter = Date.now() * 1000;
  private previewRequestId: number | null = null;
  private previewUnlisten: (() => void) | null = null;
  private previewStage: PreviewProgress['stage'] | null = null;
  private previewProgress: number | null = null;
  private previewError: PreviewError | null = null;
  private previewCandidateStage: PreviewCandidate['stage'] | null = null;
  private attemptedCandidates = new Set<string>();
  private loadingTimeout: ReturnType<typeof setTimeout> | null = null;
  private sourceInfo: SourceInfo | null = null;
  private directSourceGeometry: { width: number; height: number } | null = null;
  private previewStatus: HTMLElement | null = null;
  private previewStatusText: HTMLElement | null = null;
  private previewProgressElement: HTMLProgressElement | null = null;
  private previewDetail: HTMLElement | null = null;
  private previewOriginalNote: HTMLElement | null = null;
  private previewCancelBtn: HTMLButtonElement | null = null;
  private previewRetryBtn: HTMLButtonElement | null = null;

  private on<K extends keyof GlobalEventHandlersEventMap>(target: EventTarget | null | undefined, type: K, handler: (event: GlobalEventHandlersEventMap[K]) => void, options?: AddEventListenerOptions): void;
  private on(target: EventTarget | null | undefined, type: string, handler: EventListener, options?: AddEventListenerOptions): void;
  private on(target: EventTarget | null | undefined, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    if (!target || this.disposed) return;
    target.addEventListener(type, handler, options);
    this.domTeardowns.push(() => target.removeEventListener(type, handler, options));
  }

  private retainNativeListener(registration: Promise<() => void>): void {
    void registration.then(unlisten => {
      if (this.disposed) unlisten();
      else this.nativeTeardowns.push(unlisten);
    }).catch(error => console.warn('Could not register hardsub listener:', error));
  }

  public setPageActive(active: boolean): void {
    if (this.disposed || this.pageActive === active) return;
    this.pageActive = active;
    if (!active) {
      this.clearPlayerWork();
      this.videoElement?.pause();
    } else if (this.phase === 'ready') {
      this.updateVideoPreviewOverlayBounds();
      this.updatePlaybackTime();
    }
    this.renderPlayerPhase();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pageActive = false;
    ++this.videoLoadGeneration;
    this.resetVideoSource();
    void this.releasePreview();
    this.phase = 'idle';
    this.resizeObserver?.disconnect();
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    if (this.storageDebounceTimer !== null) clearTimeout(this.storageDebounceTimer);
    if (this.searchDebounceTimer !== null) clearTimeout(this.searchDebounceTimer);
    for (const teardown of this.domTeardowns.splice(0)) teardown();
    for (const teardown of this.nativeTeardowns.splice(0)) teardown();
  }

  private clearPlayerWork(): void {
    this.playIntent = false;
    this.wasPlayingBeforeSeek = false;
    this.isUserSeeking = false;
    this.isScrollingSeek = false;
    this.isSeekingVideo = false;
    this.pendingSeek = null;
    this.virtualCurrentTime = 0;
    this.lastThrottleSeekTime = 0;
    this.targetClickedCueId = null;
    for (const timer of [this.scrollSeekTimeout, this.clickLockTimer, this.hudTimeout, this.controlsTimeout, this.clickTimeout, this.accordionTimeout, this.seekWatchdog]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.scrollSeekTimeout = this.clickLockTimer = this.hudTimeout = null;
    this.controlsTimeout = this.clickTimeout = this.accordionTimeout = this.seekWatchdog = null;
    ++this.seekSerial;
    ++this.playSerial;
    this.cancelFreezeCallbacks();
    this.dismissFreezeFrame();
    if (this.volumeHud) this.volumeHud.style.display = 'none';
  }

  private resetVideoSource(): void {
    this.clearLoadingTimeout();
    for (const teardown of this.mediaTeardowns.splice(0)) teardown();
    this.clearPlayerWork();
    this.candidateId = '';
    this.expectedMediaUrl = '';
    this.videoElement?.pause();
    this.videoElement?.removeAttribute('src');
    this.videoElement?.load();
    if (this.videoElement) this.videoElement.style.display = 'none';
    if (this.videoPlaceholder) {
      this.videoPlaceholder.style.display = 'flex';
      this.videoPlaceholder.style.cursor = 'pointer';
      if (this.placeholderIdle) this.placeholderIdle.style.display = 'flex';
      if (this.placeholderLoading) this.placeholderLoading.style.display = 'none';
    }
    if (this.videoSeekSlider) this.videoSeekSlider.value = '0';
    this.updateSeekSliderProgress(0);
    if (this.videoTimeDisplay) this.videoTimeDisplay.textContent = '00:00 / 00:00';
    this.activeCueId = null;
    document.querySelectorAll('.subtitle-cue-card.active').forEach(card => card.classList.remove('active'));
    this.currentSubtitleText = '';
    this._lastRenderKey = '';
    if (this.subtitleCanvas) this.canvasCtx?.clearRect(0, 0, this.subtitleCanvas.width, this.subtitleCanvas.height);
    this.videoDisplayWidth = this.videoDisplayHeight = this.videoDisplayLeft = this.videoDisplayTop = 0;
  }

  private canInteractWithVideo(): boolean {
    return !this.disposed && this.pageActive && this.phase === 'ready' && !!this.videoElement;
  }

  private canSeek(): boolean {
    const video = this.videoElement;
    return this.canInteractWithVideo() && !!video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
  }

  private isInteractiveTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    return !!element && (!!element.isContentEditable || !!element.closest?.('input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="tab"], [role="tablist"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="dialog"], #hardsub-video-placeholder, #hardsub-preview-status'));
  }

  private playVideo(): void {
    const video = this.videoElement;
    if (!video || !this.canInteractWithVideo()) return;
    const generation = this.videoLoadGeneration;
    const candidate = this.candidateId;
    const serial = ++this.playSerial;
    this.playIntent = true;
    this.syncPlayPauseUI();
    void video.play().then(() => {
      if (generation !== this.videoLoadGeneration || candidate !== this.candidateId) return;
      if (!this.canInteractWithVideo() || !this.playIntent) video.pause();
    }).catch(() => {
      if (serial === this.playSerial && generation === this.videoLoadGeneration && candidate === this.candidateId) {
        this.playIntent = false;
        this.syncPlayPauseUI();
      }
    });
  }

  private togglePlayback(): void {
    if (!this.canInteractWithVideo() || !this.videoElement) return;
    const isPlayingOrIntended = (this.playIntent || !this.videoElement.paused) && !this.videoElement.ended;
    if (isPlayingOrIntended) {
      ++this.playSerial;
      this.playIntent = false;
      this.wasPlayingBeforeSeek = false;
      this.videoElement.pause();
      this.syncPlayPauseUI();
    } else {
      this.playVideo();
    }
  }

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
      if (this.disposed) return;
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

      let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      const container = document.getElementById('hardsub-player-container');
      if (container) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
          this.resizeFrame = requestAnimationFrame(() => {
            this.resizeFrame = null;
            if (!this.disposed) {
              this.updateVideoPreviewOverlayBounds(false);
              if (resizeDebounceTimer !== null) clearTimeout(resizeDebounceTimer);
              resizeDebounceTimer = setTimeout(() => {
                resizeDebounceTimer = null;
                if (!this.disposed) this.updateVideoPreviewOverlayBounds(true);
              }, 60);
            }
          });
        });
        this.resizeObserver.observe(container);
      }
    };

    if (document.readyState === 'loading') {
      this.on(document, 'DOMContentLoaded', init);
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
    this.placeholderIdle = document.getElementById('hardsub-placeholder-idle');
    this.placeholderLoading = document.getElementById('hardsub-placeholder-loading');
    this.placeholderLoadingText = document.getElementById('hardsub-placeholder-loading-text');
    this.videoStatusBadge = document.getElementById('hardsub-video-status-badge');
    this.previewStatus = document.getElementById('hardsub-preview-status');
    this.previewStatusText = document.getElementById('hardsub-preview-status-text');
    this.previewProgressElement = document.getElementById('hardsub-preview-progress') as HTMLProgressElement;
    this.previewDetail = document.getElementById('hardsub-preview-detail');
    this.previewOriginalNote = document.getElementById('hardsub-preview-original-note');
    this.previewCancelBtn = document.getElementById('btn-cancel-hardsub-preview') as HTMLButtonElement;
    this.previewRetryBtn = document.getElementById('btn-retry-hardsub-preview') as HTMLButtonElement;
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

    // Media Resource Accordion Elements
    this.mediaStepEl = document.getElementById('hardsub-media-step');
    this.mediaStepHeader = document.getElementById('hardsub-media-step-header');
    this.mediaStepIcon = document.getElementById('hardsub-media-step-icon');
    this.mediaStepChevron = document.getElementById('hardsub-media-chevron');
    this.mediaSummaryBadge = document.getElementById('hardsub-media-summary-badge');

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
    this.telemetryBox = document.getElementById('hardsub-telemetry-box');

    // Output Folder Controls & Completion Action
    this.outputDirText = document.getElementById('hardsub-output-dir-text');
    this.btnBrowseDir = document.getElementById('btn-browse-hardsub-dir') as HTMLButtonElement;
    this.btnResetDir = document.getElementById('btn-reset-hardsub-dir') as HTMLButtonElement;
    this.btnOpenFolder = document.getElementById('btn-open-hardsub-folder') as HTMLButtonElement;
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
      this.cachedHwStatus = hwStatus;
      this.populateHardwareDropdown(hwStatus);
    } catch (e) {
      console.warn('Failed to probe hardware encoders:', e);
      this.updateSupportedCodecs();
      this.updateQualitySliderConfig();
      this.updateQualityUI();
      this.updateFfmpegCommandPreview();
    }
  }

  private populateHardwareDropdown(hwStatus: HardwareStatus) {
    if (!this.hwSelect) return;
    this.hwSelect.innerHTML = '';

    // Standard CPU is always available on all platforms
    const cpuOpt = document.createElement('option');
    cpuOpt.value = 'cpu';
    cpuOpt.textContent = t('hardsub.hwCpu');
    this.hwSelect.appendChild(cpuOpt);

    if (hwStatus.hasVideotoolbox) {
      const vtOpt = document.createElement('option');
      vtOpt.value = 'videotoolbox';
      vtOpt.textContent = t('hardsub.hwVt');
      this.hwSelect.appendChild(vtOpt);
    }

    if (hwStatus.hasNvenc) {
      const nvencOpt = document.createElement('option');
      nvencOpt.value = 'nvenc';
      nvencOpt.textContent = t('hardsub.hwNvenc');
      this.hwSelect.appendChild(nvencOpt);
    }

    if (hwStatus.hasQsv) {
      const qsvOpt = document.createElement('option');
      qsvOpt.value = 'qsv';
      qsvOpt.textContent = t('hardsub.hwQsv');
      this.hwSelect.appendChild(qsvOpt);
    }

    if (hwStatus.hasVaapi) {
      const vaapiOpt = document.createElement('option');
      vaapiOpt.value = 'vaapi';
      vaapiOpt.textContent = t('hardsub.hwVaapi');
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
          notifyFn(t('hardsub.hwNotSupportedSwitch', { prev: prevChoice, curr: newLabel }), 'info', 5000);
        }
      }
    }
    this.updateSupportedCodecs();
    this.updateQualitySliderConfig();
    this.updateQualityUI();
    this.updateFfmpegCommandPreview();
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
    this.on(this.subtitleListContainer, 'click', (e) => {
      const target = e.target as HTMLElement;
      if (!target) return;
    
      const jumpBtn = target.closest('.jump-cue-btn') as HTMLElement;
      if (jumpBtn) {
        e.stopPropagation();
        const card = jumpBtn.closest('.subtitle-cue-card') as HTMLElement;
        const cueId = card ? parseInt(card.dataset.cueId || '0', 10) : 0;
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue && this.canSeek() && this.videoElement) {
          this.targetClickedCueId = cue.id;
          this.activeCueId = cue.id;
          this.highlightActiveCard(cue.id);
          this.currentSubtitleText = cue.text;
          this.renderSubtitleOnCanvas();
          if (this.clickLockTimer) clearTimeout(this.clickLockTimer);
          this.clickLockTimer = setTimeout(() => {
            this.targetClickedCueId = null;
          }, 800);
    
          this.wasPlayingBeforeSeek = true;
          this.videoElement.pause();
          this.performSafeSeek((cue.startMs + 50) / 1000);
        }
        return;
      }
    
      const card = target.closest('.subtitle-cue-card') as HTMLElement;
      if (card && !target.closest('textarea')) {
        const cueId = parseInt(card.dataset.cueId || '0', 10);
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue && this.canSeek() && this.videoElement) {
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

    this.on(this.subtitleListContainer, 'input', (e) => {
      const textarea = (e.target as HTMLElement).closest('textarea.subtitle-cue-textarea') as HTMLTextAreaElement;
      if (textarea) {
        const cueId = parseInt(textarea.dataset.cueId || '0', 10);
        const cue = this.subtitleCues.find((c) => c.id === cueId);
        if (cue) {
          cue.text = textarea.value;
          // Keep the field's direction in step with its content, so clearing a cue
          // mid-edit puts the caret back on the interface's side.
          applyTextDirection(textarea);
          this.isSubtitlesModified = true;
          if (this.activeCueId === cue.id) {
            this.currentSubtitleText = cue.text;
            this.renderSubtitleOnCanvas(true);
          }
        }
      }
    });

    // Media Resource Accordion Toggle
    this.on(this.mediaStepHeader, 'click', () => {
      this.toggleMediaAccordion();
    });

    // Clicking placeholder in player expands the accordion and triggers browse
    this.on(this.videoPlaceholder, 'click', () => {
      this.toggleMediaAccordion(true);
      document.getElementById('btn-browse-video')?.click();
    });

    // Browse Video File
    this.on(document.getElementById('btn-browse-video'), 'click', async () => {
      const selected = await invoke<string | null>('select_file');
      if (selected) {
        this.selectVideoSource(selected);
      }
    });

    // Browse Subtitle File
    this.on(document.getElementById('btn-browse-sub'), 'click', async () => {
      const selected = await invoke<string | null>('select_subtitle_file');
      if (selected) {
        if (this.subtitlePathInput) this.subtitlePathInput.value = selected;
        this.state.subtitlePath = selected;
        this.loadSubtitleFile(selected);
      }
    });

    // Font Select
    this.on(this.fontSelect, 'change', () => {
      this.state.fontName = this.fontSelect!.value;
      this.refreshFontRenderScale();
      this.updateLivePreview();
    });

    // Font Size Slider
    this.on(this.fontSizeSlider, 'input', () => {
      const val = parseInt(this.fontSizeSlider!.value, 10);
      this.state.fontSize = val;
      if (this.fontSizeVal) this.fontSizeVal.textContent = `${val}px`;
      this.updateSliderBackground(this.fontSizeSlider!);
      this.updateLivePreview();
    });
    this.on(document.getElementById('reset-fontsize'), 'click', () => {
      this.state.fontSize = 14;
      if (this.fontSizeSlider) {
        this.fontSizeSlider.value = '14';
        this.updateSliderBackground(this.fontSizeSlider);
      }
      if (this.fontSizeVal) this.fontSizeVal.textContent = '14px';
      this.updateLivePreview();
    });

    // Position Y Slider
    this.on(this.positionYSlider, 'input', () => {
      const val = parseInt(this.positionYSlider!.value, 10);
      this.state.positionY = val;
      if (this.positionYVal) this.positionYVal.textContent = `${val}px`;
      this.updateSliderBackground(this.positionYSlider!);
      this.updateLivePreview();
    });
    this.on(document.getElementById('reset-posy'), 'click', () => {
      this.state.positionY = 30;
      if (this.positionYSlider) {
        this.positionYSlider.value = '30';
        this.updateSliderBackground(this.positionYSlider);
      }
      if (this.positionYVal) this.positionYVal.textContent = '30px';
      this.updateLivePreview();
    });

    // Outline Size Slider
    this.on(this.outlineSizeSlider, 'input', () => {
      const val = parseInt(this.outlineSizeSlider!.value, 10);
      this.state.outlineSize = val;
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = `${val}px`;
      this.updateSliderBackground(this.outlineSizeSlider!);
      this.updateLivePreview();
    });
    this.on(document.getElementById('reset-outline'), 'click', () => {
      this.state.outlineSize = 2;
      if (this.outlineSizeSlider) {
        this.outlineSizeSlider.value = '2';
        this.updateSliderBackground(this.outlineSizeSlider);
      }
      if (this.outlineSizeVal) this.outlineSizeVal.textContent = '2px';
      this.updateLivePreview();
    });

    // Color Pickers
    this.on(this.primaryColorPicker, 'input', () => {
      this.state.primaryColor = this.primaryColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });

    this.on(this.outlineColorPicker, 'input', () => {
      this.state.outlineColor = this.outlineColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });

    this.on(this.bgBoxToggle, 'change', () => {
      this.state.bgBox = this.bgBoxToggle!.checked;
      this.updateLivePreview();
    });
    this.on(this.bgBoxColorPicker, 'input', () => {
      this.state.bgBoxColor = this.bgBoxColorPicker!.value.toUpperCase();
      this.updateColorSwatches();
      this.updateLivePreview();
    });
    this.on(this.bgBoxOpacitySlider, 'input', () => {
      this.state.bgBoxOpacity = parseInt(this.bgBoxOpacitySlider!.value, 10);
      if (this.bgBoxOpacityVal) this.bgBoxOpacityVal.textContent = `${this.state.bgBoxOpacity}%`;
      this.updateSliderBackground(this.bgBoxOpacitySlider!);
      this.updateLivePreview();
    });
    this.on(this.bgBoxRadiusSlider, 'input', () => {
      this.state.bgBoxRadius = parseInt(this.bgBoxRadiusSlider!.value, 10);
      if (this.bgBoxRadiusVal) this.bgBoxRadiusVal.textContent = `${this.state.bgBoxRadius}px`;
      this.updateSliderBackground(this.bgBoxRadiusSlider!);
      this.updateLivePreview();
    });

    // Color Preset Dots
    document.querySelectorAll('.color-preset-dot').forEach((dot) => {
      this.on(dot, 'click', (e) => {
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
    this.on(this.boldToggle, 'click', () => {
      this.state.bold = !this.state.bold;
      this.boldToggle!.classList.toggle('active', this.state.bold);
      this.refreshFontRenderScale();
      this.updateLivePreview();
    });

    // Italic Toggle
    this.on(this.italicToggle, 'click', () => {
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
    const getAlignName = (code: number): string => {
      switch (code) {
        case 7: return t('hardsub.alignTopLeft');
        case 8: return t('hardsub.alignTopCenter');
        case 9: return t('hardsub.alignTopRight');
        case 4: return t('hardsub.alignMiddleLeft');
        case 5: return t('hardsub.alignMiddleCenter');
        case 6: return t('hardsub.alignMiddleRight');
        case 1: return t('hardsub.alignBottomLeft');
        case 2: return t('hardsub.alignBottomCenter');
        case 3: return t('hardsub.alignBottomRight');
        default: return t('hardsub.alignBottomCenter');
      }
    };

    let currentV = 'bottom';
    let currentH = 'center';

    const updateAlignmentState = () => {
      const key = `${currentV}-${currentH}`;
      const code = alignMap[key] || 2;
      this.state.alignment = code;
      if (alignValLabel) {
        alignValLabel.textContent = getAlignName(code);
      }

      // Disable/gray out Vertical Offset when aligned to Middle (as MarginV has no effect in ASS for middle alignment)
      const posyWrapper = document.getElementById('hardsub-posy-wrapper');
      const posyTitle = document.getElementById('lbl-posy-title');
      if (posyWrapper) {
        if (currentV === 'middle') {
          posyWrapper.classList.add('control-disabled');
          if (posyTitle) posyTitle.textContent = t('hardsub.vOffsetMiddleLocked');
        } else {
          posyWrapper.classList.remove('control-disabled');
          if (posyTitle) posyTitle.textContent = currentV === 'top' ? t('hardsub.vMarginTop') : t('hardsub.vMarginBottom');
        }
      }

      this.updateLivePreview();
    };

    this.updateAlignmentUI = updateAlignmentState;

    this.on(window, 'whisper:languageChanged', () => {
      this.refreshLocalization();
    });

    document.querySelectorAll('.align-v-btn').forEach((btn) => {
      this.on(btn, 'click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        currentV = target.dataset.v || 'bottom';
        document.querySelectorAll('.align-v-btn').forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        updateAlignmentState();
      });
    });

    document.querySelectorAll('.align-h-btn').forEach((btn) => {
      this.on(btn, 'click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        currentH = target.dataset.h || 'center';
        document.querySelectorAll('.align-h-btn').forEach((b) => b.classList.remove('active'));
        target.classList.add('active');
        updateAlignmentState();
      });
    });

    // Subtitle Search Input
    this.on(this.searchInput, 'input', () => {
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
    this.on(document.getElementById('btn-start-hardsub'), 'click', () => {
      this.startHardsub();
    });

    // Cancel Hardsub Button
    this.on(this.cancelBtn, 'click', async () => {
      try {
        await invoke('cancel_hardsub_task');
        this.updateEncodingUIState(false);
      } catch (e) {
        console.warn('Cancel hardsub error:', e);
      }
    });

    // Output Directory Controls
    this.on(this.btnBrowseDir, 'click', () => {
      this.browseOutputDir();
    });

    this.on(this.btnResetDir, 'click', () => {
      this.resetOutputDir();
    });

    this.on(this.btnOpenFolder, 'click', () => {
      this.openOutputFolder();
    });
  }

  private setupExportEventListeners() {
    // Format Select
    this.on(this.formatSelect, 'change', () => {
      this.state.outputFormat = this.formatSelect!.value;
      if (this.state.videoPath) {
        this.updateComputedOutputPath();
      }
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Hardware Accelerator Select
    this.on(this.hwSelect, 'change', () => {
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
    this.on(this.codecSelect, 'change', () => {
      this.state.videoCodec = this.codecSelect!.value;
      this.updateQualitySliderConfig();
      if (this.state.videoQualityMode === 'preset') {
        this.syncQualityPresetToSlider();
      }
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Resolution Select
    this.on(this.resolutionSelect, 'change', () => {
      this.state.resolutionScale = (this.resolutionSelect!.value || 'original') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Quality Preset Buttons (Interactive snapping)
    this.qualityPresetBtns?.forEach((btn) => {
      this.on(btn, 'click', () => {
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
    this.on(this.qualitySlider, 'input', () => {
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
    this.on(this.speedPresetSelect, 'change', () => {
      this.state.videoPresetSpeed = (this.speedPresetSelect!.value || 'medium') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Audio Codec Select
    this.on(this.audioCodecSelect, 'change', () => {
      this.state.audioCodec = (this.audioCodecSelect!.value || 'copy') as any;
      this.updateAudioUI();
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Audio Bitrate Select
    this.on(this.audioBitrateSelect, 'change', () => {
      this.state.audioBitrate = (this.audioBitrateSelect!.value || '192k') as any;
      this.saveExportSettingsToStorage();
      this.updateFfmpegCommandPreview();
    });

    // Copy FFmpeg Command Button (uses global multi-tier clipboard helper from main.js)
    this.on(this.btnCopyFfmpegCmd, 'click', async () => {
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
        notify(t('hardsub.ffmpegCmdCopied'), 'success');
      } catch (e) {
        console.warn('Failed to copy command to clipboard:', e);
        notify(t('hardsub.failedCopyCmd'), 'error');
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
      this.qualityParamLabel.textContent = t('hardsub.labelQualityApple');
      min = 1;
      max = 100;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintHigherQuality1100');
      }
    } else if (hw === 'nvenc') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityNvenc');
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality151');
      }
    } else if (hw === 'qsv') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityQsv');
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality151');
      }
    } else if (hw === 'vaapi') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityVaapi');
      min = 1;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality151');
      }
    } else if (codec === 'prores') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityProRes');
      min = 0;
      max = 5;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintProRes');
      }
    } else if (codec === 'av1') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityCrf', { encoder: 'libsvtav1' });
      min = 0;
      max = 63;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality063');
      }
    } else if (codec === 'vp9') {
      this.qualityParamLabel.textContent = t('hardsub.labelQualityCrf', { encoder: 'libvpx-vp9' });
      min = 0;
      max = 63;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality063');
      }
    } else {
      const encoderName = codec === 'h265' ? 'libx265' : 'libx264';
      this.qualityParamLabel.textContent = t('hardsub.labelQualityCrf', { encoder: encoderName });
      min = 0;
      max = 51;
      if (this.qualityHint) {
        this.qualityHint.textContent = t('hardsub.hintLowerQuality051');
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
        draft: t('hardsub.presetDraft'),
        balanced: t('hardsub.presetBalanced'),
        high: t('hardsub.presetHigh'),
        lossless: t('hardsub.presetUltra'),
      };
      if (badgeNames[activePreset]) {
        this.qualityBadge.textContent = badgeNames[activePreset];
        this.qualityBadge.style.color = 'var(--color-royal-blue)';
        this.qualityBadge.style.borderColor = 'rgba(var(--color-royal-blue-rgb), 0.3)';
        this.qualityBadge.style.background = 'rgba(var(--color-royal-blue-rgb), 0.15)';
      } else {
        this.qualityBadge.textContent = t('hardsub.customQuality', { val: this.state.videoQualityValue });
        this.qualityBadge.style.color = 'var(--color-cyan)';
        this.qualityBadge.style.borderColor = 'rgba(var(--color-cyan-rgb), 0.3)';
        this.qualityBadge.style.background = 'rgba(var(--color-cyan-rgb), 0.15)';
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

  public refreshLocalization() {
    if (this.cachedHwStatus) {
      this.populateHardwareDropdown(this.cachedHwStatus);
    } else {
      this.updateSupportedCodecs();
      this.updateQualitySliderConfig();
      this.updateQualityUI();
      this.updateFfmpegCommandPreview();
    }
    this.updateAudioUI();
    this.updateAlignmentUI();
    this.updateVideoDropzoneUI(this.state.videoPath);
    this.updateSubDropzoneUI(this.state.subtitlePath, this.subtitleCues.length);
    this.renderSubtitleCards();
    this.renderPlayerPhase();
    this.updateOutputDirUI();
    if (this.progressStatusText && this.lastStatusPayload) {
      this.progressStatusText.textContent = formatHardsubStatus(this.lastStatusPayload);
    }
    this.updateEncodingUIState(this.isEncoding);
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
        el.style.display = isActive ? 'flex' : 'none';
      };

      updateView(this.tabViewEditor, tab === 'editor');
      updateView(this.tabViewStyle, tab === 'style');
      updateView(this.tabViewExport, tab === 'export');
    };

    syncTabStates();

    this.on(this.tabBtnEditor, 'click', () => switchTab('editor'));
    this.on(this.tabBtnStyle, 'click', () => switchTab('style'));
    this.on(this.tabBtnExport, 'click', () => switchTab('export'));

    const tabsContainer = this.tabBtnEditor?.closest('.hardsub-tabs-container');
    this.on(tabsContainer, 'keydown', (e: KeyboardEvent) => {
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

  private renderPlayerPhase(): void {
    const ready = this.phase === 'ready';
    const busy = this.phase === 'loading' || this.phase === 'preparing';
    const recovery = this.phase === 'error' || this.phase === 'cancelled';
    const actionsVisible = document.fullscreenElement?.id !== 'hardsub-player-container';
    for (const control of [this.videoPlayBtn, this.videoSeekSlider, this.prevCueBtn, this.nextCueBtn]) {
      if (control) control.disabled = !ready;
    }
    const playing = ready && !!this.videoElement && (this.playIntent || !this.videoElement.paused) && !this.videoElement.ended;
    const message = this.phase === 'idle' ? t('hardsub.noVideoLoaded')
      : this.phase === 'loading' ? t('hardsub.previewLoading')
      : this.phase === 'preparing' ? this.previewStage === 'remux' ? t('hardsub.previewRemuxing')
        : this.previewStage === 'finalizing' ? t('hardsub.previewFinalizing')
        : this.previewStage === 'mp4' || this.previewStage === 'webm' ? t('hardsub.previewConverting') : t('hardsub.previewProbing')
      : this.phase === 'cancelled' ? t('hardsub.previewCancelled')
      : this.phase === 'error' ? this.playbackError === 'network' ? t('hardsub.previewNetworkError')
        : this.playbackError === 'timeout' ? t('hardsub.previewTimeout')
        : this.previewError?.code === 'tools_unavailable' || this.previewError?.code === 'encoder_unavailable' ? t('hardsub.previewToolsUnavailable')
        : this.playbackError === 'decode' || this.previewError?.code === 'no_compatible_preview' ? t('hardsub.previewDecodeError') : t('hardsub.previewUnavailable')
      : playing ? t('hardsub.statusPlaying') : t('hardsub.statusPaused');
    if (this.videoStatusBadge) {
      this.videoStatusBadge.textContent = message;
      this.videoStatusBadge.style.background = this.phase === 'error' ? 'rgba(239, 68, 68, 0.2)'
        : playing ? 'rgba(16, 185, 129, 0.2)' : 'rgba(var(--color-royal-blue-rgb), 0.15)';
      this.videoStatusBadge.style.color = this.phase === 'error' ? '#EF4444' : playing ? '#10B981' : 'var(--color-royal-blue)';
    }
    const showPreviewCard = busy || recovery;
    if (this.previewStatus) this.previewStatus.style.display = showPreviewCard ? 'flex' : 'none';
    if (this.previewStatusText && this.previewStatusText.textContent !== message) this.previewStatusText.textContent = message;
    if (this.previewCancelBtn) {
      this.previewCancelBtn.hidden = !busy || !actionsVisible;
      this.previewCancelBtn.style.display = busy && actionsVisible ? 'inline-flex' : 'none';
      this.previewCancelBtn.textContent = t('hardsub.previewCancel');
    }
    if (this.previewRetryBtn) {
      this.previewRetryBtn.hidden = !recovery || !actionsVisible;
      this.previewRetryBtn.style.display = recovery && actionsVisible ? 'inline-flex' : 'none';
      this.previewRetryBtn.textContent = t('hardsub.previewRetry');
    }
    if (this.previewProgressElement) {
      this.previewProgressElement.hidden = !busy;
      if (this.previewProgress === null) this.previewProgressElement.removeAttribute('value');
      else this.previewProgressElement.value = this.previewProgress;
    }
    if (this.previewDetail) {
      this.previewDetail.hidden = this.phase !== 'error' || !this.previewError?.detail;
      this.previewDetail.textContent = this.phase === 'error' ? this.previewError?.detail ?? '' : '';
    }
    if (this.previewOriginalNote) {
      this.previewOriginalNote.hidden = this.phase !== 'preparing';
      this.previewOriginalNote.textContent = t('hardsub.previewOriginalUnchanged');
    }
    if (this.videoPlaceholder) {
      if (ready) {
        this.videoPlaceholder.style.display = 'none';
      } else {
        this.videoPlaceholder.style.display = 'flex';
        this.videoPlaceholder.style.cursor = this.phase === 'idle' ? 'pointer' : 'default';
        if (this.placeholderIdle) this.placeholderIdle.style.display = busy ? 'none' : 'flex';
        if (this.placeholderLoading) {
          this.placeholderLoading.style.display = busy ? 'flex' : 'none';
          if (this.placeholderLoadingText && busy) {
            this.placeholderLoadingText.textContent = message;
          }
        }
      }
    }
  }

  private syncPlayPauseUI(): void {
    const playing = this.phase === 'ready' && !!this.videoElement && (this.playIntent || !this.videoElement.paused) && !this.videoElement.ended;
    if (this.videoIconPlay) this.videoIconPlay.style.display = playing ? 'none' : 'block';
    if (this.videoIconPause) this.videoIconPause.style.display = playing ? 'block' : 'none';
    this.renderPlayerPhase();
  }

  private failPlayback(error: 'network' | 'decode' | 'timeout'): void {
    this.playbackError = error;
    this.clearLoadingTimeout();
    this.phase = 'error';
    this.clearPlayerWork();
    this.videoElement?.pause();
    this.exitPreviewFullscreen();
    this.syncPlayPauseUI();
  }

  private attachMediaListeners(generation: number, candidate: string, url: string): void {
    const video = this.videoElement;
    if (!video) return;
    const current = () => !this.disposed && generation === this.videoLoadGeneration && candidate === this.candidateId && url === this.expectedMediaUrl;
    const onMedia = (type: string, handler: () => void) => {
      const guarded = () => { if (current()) handler(); };
      video.addEventListener(type, guarded);
      this.mediaTeardowns.push(() => video.removeEventListener(type, guarded));
    };
    const ready = () => {
      if (this.phase !== 'loading' || video.readyState < 2) return;
      this.clearLoadingTimeout();
      this.previewProgress = null;
      if (this.previewCandidateStage === 'direct' && video.videoWidth > 0 && video.videoHeight > 0) {
        this.directSourceGeometry = { width: video.videoWidth, height: video.videoHeight };
      }
      this.phase = 'ready';
      this.updateVideoPreviewOverlayBounds();
      this.updatePlaybackTime();
      this.syncPlayPauseUI();
    };
    onMedia('loadedmetadata', () => {
      if (this.previewCandidateStage === 'direct' && video.videoWidth > 0 && video.videoHeight > 0) {
        this.directSourceGeometry = { width: video.videoWidth, height: video.videoHeight };
      }
      if (this.phase === 'loading') {
        this.updateVideoPreviewOverlayBounds();
        if (video.readyState >= 2) ready();
      }
    });
    onMedia('loadeddata', ready);
    onMedia('canplay', ready);
    onMedia('canplaythrough', ready);
    onMedia('progress', () => {
      if (this.phase === 'loading') {
        this.resetLoadingTimeout(generation, candidate, 45_000);
      }
    });
    onMedia('error', () => {
      if (this.phase !== 'loading' && this.phase !== 'ready') return;
      if (video.error?.code === 2) this.failPlayback('network');
      else if (video.error?.code === 3 || video.error?.code === 4) void this.advancePreview(generation, candidate);
    });
    onMedia('seeking', () => {
      if (this.canInteractWithVideo()) this.captureFreezeFrame();
    });
    onMedia('seeked', () => {
      if (this.isSeekingVideo && !video.seeking && this.canInteractWithVideo()) this.settleSeek();
    });
    const syncPlaying = () => {
      if (!this.canInteractWithVideo() || !this.playIntent) video.pause();
      this.syncPlayPauseUI();
    };
    onMedia('play', syncPlaying);
    onMedia('playing', syncPlaying);
    onMedia('pause', () => {
      this.playIntent = false;
      this.syncPlayPauseUI();
    });
    onMedia('ended', () => { this.playIntent = false; this.updatePlaybackTime(); this.syncPlayPauseUI(); });
    onMedia('timeupdate', () => {
      if (this.phase === 'loading' && video.readyState >= 2) ready();
      if (this.canInteractWithVideo() && !this.isUserSeeking && !this.isScrollingSeek && !this.isSeekingVideo) this.updatePlaybackTime();
    });

    if (video.readyState >= 2) {
      ready();
    }
  }

  private updatePlaybackTime(): void {
    const video = this.videoElement;
    if (!video || this.phase !== 'ready') return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const pct = duration ? video.currentTime / duration * 100 : 0;
    if (this.videoSeekSlider) this.videoSeekSlider.value = String(pct);
    this.updateSeekSliderProgress(pct);
    if (this.videoTimeDisplay) this.videoTimeDisplay.textContent = `${formatSecondsToDisplay(video.currentTime)} / ${formatSecondsToDisplay(duration)}`;
    this.syncActiveSubtitleWithTime(video.currentTime * 1000);
  }

  private setupVideoPlayerEvents() {
    if (!this.videoElement) return;
    this.on(this.previewCancelBtn, 'click', () => this.cancelPreview());
    this.on(this.previewRetryBtn, 'click', () => {
      if (this.phase === 'error' || this.phase === 'cancelled') void this.loadVideoMedia(this.state.videoPath);
    });

    this.on(this.videoPlayBtn, 'click', () => this.togglePlayback());

    // Seek Slider Drag
    this.on(this.videoSeekSlider, 'pointerdown', () => {
      if (!this.canSeek() || !this.videoElement) return;
      this.isUserSeeking = true;
      this.wasPlayingBeforeSeek = this.wasPlayingBeforeSeek || !this.videoElement.paused || this.playIntent;
      this.videoElement.pause();
    });

    this.on(this.videoSeekSlider, 'input', () => {
      if (!this.canSeek() || !this.videoElement) return;
      if (!this.isUserSeeking) {
        this.wasPlayingBeforeSeek = this.wasPlayingBeforeSeek || !this.videoElement.paused || this.playIntent;
        this.videoElement.pause();
      }
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
      if (!this.isUserSeeking || !this.canSeek()) return;
      this.isUserSeeking = false;
      if (this.videoElement && this.videoSeekSlider) {
        const pct = parseFloat(this.videoSeekSlider.value);
        const targetTime = (this.videoElement.duration || 0) * (pct / 100);
        this.performSafeSeek(targetTime, false);
      }
    };

    this.on(this.videoSeekSlider, 'change', handleSeekRelease);
    this.on(this.videoSeekSlider, 'pointerup', handleSeekRelease);
    const cancelGesture = () => {
      if (!this.isUserSeeking) return;
      this.isUserSeeking = false;
      this.wasPlayingBeforeSeek = false;
      this.playIntent = false;
      this.pendingSeek = null;
      if (!this.isSeekingVideo) this.scheduleDismissFreezeFrame();
    };
    this.on(this.videoSeekSlider, 'pointercancel', cancelGesture);
    this.on(this.videoSeekSlider, 'lostpointercapture', cancelGesture);

    // Jump to Prev / Next Cue
    this.on(this.prevCueBtn, 'click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const prev = [...this.subtitleCues].reverse().find((c) => c.startMs < curMs - 300);
      if (prev) {
        this.performSafeSeek(prev.startMs / 1000);
      }
    });

    this.on(this.nextCueBtn, 'click', () => {
      if (!this.videoElement || this.subtitleCues.length === 0) return;
      const curMs = this.videoElement.currentTime * 1000;
      const next = this.subtitleCues.find((c) => c.startMs > curMs + 100);
      if (next) {
        this.performSafeSeek(next.startMs / 1000);
      }
    });

    // Volume slider & Mute button listeners
    this.on(this.videoVolumeSlider, 'input', () => {
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

    this.on(this.videoVolumeSlider, 'change', () => {
      this.videoVolumeSlider?.blur();
    });

    this.on(this.videoVolumeBtn, 'click', () => {
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
    this.on(this.videoFullscreenBtn, 'click', () => {
      this.toggleFullscreen();
    });

    // Listen to Fullscreen changes
    this.on(document, 'fullscreenchange', () => {
      const isFs = !!document.fullscreenElement;
      if (this.videoIconFsEnter) this.videoIconFsEnter.style.display = isFs ? 'none' : 'block';
      if (this.videoIconFsExit) this.videoIconFsExit.style.display = isFs ? 'block' : 'none';
      this.renderPlayerPhase();
      this.updateVideoPreviewOverlayBounds(false);
      setTimeout(() => {
        if (!this.disposed) this.updateVideoPreviewOverlayBounds(true);
      }, 100);
    });

    // Auto-hide controls inside player container on mouse inactivity (especially for fullscreen)
    const container = document.getElementById('hardsub-player-container');
    const controls = document.getElementById('hardsub-video-controls');

    const showControlsFunc = () => {
      if (!controls || !this.pageActive) return;
      controls.classList.add('show-controls');
      if (container) container.style.cursor = 'default';
      
      if (this.controlsTimeout !== null) clearTimeout(this.controlsTimeout);
      this.controlsTimeout = setTimeout(() => {
        const isHoveringControls = controls.matches(':hover');
        if (this.videoElement && !this.videoElement.paused && !isHoveringControls) {
          controls.classList.remove('show-controls');
          if (document.fullscreenElement && container) {
            container.style.cursor = 'none';
          }
        }
      }, 2500);
    };

    this.on(container, 'mousemove', showControlsFunc);
    this.on(container, 'mouseenter', showControlsFunc);
    this.on(container, 'click', showControlsFunc);

    // Custom Viewport mouse interactions on container (Play/Pause, Fullscreen, Volume HUD)
    this.on(container, 'click', (e) => {
      if (!this.canInteractWithVideo() || e.defaultPrevented || this.isInteractiveTarget(e.target) || (controls && controls.contains(e.target as Node))) return;
      if (this.clickTimeout !== null) clearTimeout(this.clickTimeout);
      const generation = this.videoLoadGeneration;
      const candidate = this.candidateId;
      this.clickTimeout = setTimeout(() => {
        this.clickTimeout = null;
        if (generation === this.videoLoadGeneration && candidate === this.candidateId) this.togglePlayback();
      }, 200);
    });
    this.on(container, 'dblclick', (e) => {
      if (!this.canInteractWithVideo() || e.defaultPrevented || this.isInteractiveTarget(e.target) || (controls && controls.contains(e.target as Node))) return;
      if (this.clickTimeout !== null) clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
      this.toggleFullscreen();
    });

    this.on(container, 'wheel', (e) => {
      if (!this.canSeek() || !this.videoElement || e.defaultPrevented || this.isInteractiveTarget(e.target)) return;
      e.preventDefault();
    
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal scroll: seek video virtually
        if (!this.isScrollingSeek) {
          this.isScrollingSeek = true;
          this.virtualCurrentTime = this.videoElement.currentTime;
          if (!this.videoElement.paused || this.playIntent) {
            this.wasPlayingBeforeSeek = true;
            this.playIntent = false;
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
          const generation = this.videoLoadGeneration;
          const candidate = this.candidateId;
          this.scrollSeekTimeout = setTimeout(() => {
            this.scrollSeekTimeout = null;
            if (generation !== this.videoLoadGeneration || candidate !== this.candidateId || !this.canSeek()) return;
            this.isScrollingSeek = false;
            this.performSafeSeek(this.virtualCurrentTime, false);
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
    this.on(document, 'keydown', (e) => {
      if (!this.canInteractWithVideo() || !this.videoElement || e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || this.isInteractiveTarget(e.target) || this.isInteractiveTarget(document.activeElement)) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!this.canSeek()) return;
        e.preventDefault();
        this.performSafeSeek(this.videoElement.currentTime + (e.key === 'ArrowLeft' ? -10 : 10));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const volume = Math.max(0, Math.min(1, this.videoElement.volume + (e.key === 'ArrowUp' ? 0.05 : -0.05)));
        this.videoElement.volume = volume;
        this.videoElement.muted = volume === 0;
        this.updateVolumeIcons(volume, this.videoElement.muted);
        this.showVolumeHUD(volume, this.videoElement.muted);
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        this.togglePlayback();
      }
    });
  }

  private setupDragAndDropListeners() {
    const videoDrop = document.getElementById('hardsub-video-drop-zone');
    const subDrop = document.getElementById('hardsub-sub-drop-zone');

    const SUPPORTED_VIDEO_EXTS = new Set([
      '.mp4', '.mkv', '.avi', '.mov', '.flv', '.webm', '.m4v', '.wmv',
      '.ts', '.mts', '.m2ts', '.3gp', '.3g2', '.mpeg', '.mpg', '.vob', '.ogv', '.f4v'
    ]);

    const SUPPORTED_SUB_EXTS = new Set([
      '.srt', '.vtt', '.ass', '.ssa', '.sub', '.lrc'
    ]);

    const handleFiles = (files: string[]) => {
      if (!this.pageActive || this.disposed) return;
      const lastVideoIndex = files.findLastIndex((filePath) => {
        const lastDot = filePath.lastIndexOf('.');
        return SUPPORTED_VIDEO_EXTS.has(lastDot !== -1 ? filePath.substring(lastDot).toLowerCase() : '');
      });
      files.forEach((filePath, index) => {
        const lastDot = filePath.lastIndexOf('.');
        const ext = lastDot !== -1 ? filePath.substring(lastDot).toLowerCase() : '';
        if (SUPPORTED_VIDEO_EXTS.has(ext)) {
          if (index === lastVideoIndex) this.selectVideoSource(filePath);
        } else if (SUPPORTED_SUB_EXTS.has(ext)) {
          if (this.subtitlePathInput) this.subtitlePathInput.value = filePath;
          this.state.subtitlePath = filePath;
          this.loadSubtitleFile(filePath);
        }
      });
    };

    [videoDrop, subDrop].forEach((zone) => {
      if (!zone) return;

      this.on(zone, 'dragover', (e) => {
        if (!this.pageActive) return;
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('drag-over');
      });

      this.on(zone, 'dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('drag-over');
      });

      this.on(zone, 'drop', (e) => {
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

    this.retainNativeListener(listen<{ paths: string[]; position: { x: number; y: number } }>('tauri://drag-drop', (event) => {
      if (this.pageActive && !this.disposed) {
        const files = event.payload.paths;
        if (files && files.length > 0) {
          handleFiles(files);
        }
      }
    }));
  }

  private updateVideoPreviewOverlayBounds(fullRedraw = true) {
    if (!this.videoElement || !this.subtitleCanvas) return;

    const container = document.getElementById('hardsub-player-container');
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const videoW = this.sourceInfo?.displayWidth ?? this.directSourceGeometry?.width ?? (this.previewCandidateStage === 'direct' ? this.videoElement.videoWidth : 0);
    const videoH = this.sourceInfo?.displayHeight ?? this.directSourceGeometry?.height ?? (this.previewCandidateStage === 'direct' ? this.videoElement.videoHeight : 0);
    const videoElW = this.videoElement.clientWidth;
    const videoElH = this.videoElement.clientHeight;

    if (!videoW || !videoH || containerWidth === 0 || containerHeight === 0 || videoElW === 0 || videoElH === 0) {
      this.videoDisplayWidth = containerWidth;
      this.videoDisplayHeight = containerHeight;
      this.videoDisplayLeft = 0;
      this.videoDisplayTop = 0;
      if (fullRedraw && (this.subtitleCanvas.width !== containerWidth || this.subtitleCanvas.height !== containerHeight)) {
        this.subtitleCanvas.width = containerWidth;
        this.subtitleCanvas.height = containerHeight;
        this._lastRenderKey = '';
      }
      this.subtitleCanvas.style.width = `${containerWidth}px`;
      this.subtitleCanvas.style.height = `${containerHeight}px`;
      this.subtitleCanvas.style.left = '0px';
      this.subtitleCanvas.style.top = '0px';
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

    this.subtitleCanvas.style.width = `${roundedW}px`;
    this.subtitleCanvas.style.height = `${roundedH}px`;
    this.subtitleCanvas.style.left = leftPx;
    this.subtitleCanvas.style.top = topPx;

    if (fullRedraw) {
      const dimsChanged = this.subtitleCanvas.width !== roundedW || this.subtitleCanvas.height !== roundedH;
      if (dimsChanged) {
        this.subtitleCanvas.width = roundedW;
        this.subtitleCanvas.height = roundedH;
        this._lastRenderKey = '';
      }
      this.renderSubtitleOnCanvas(true);
    }
  }

  private captureFreezeFrame(force = false) {
    if (!this.videoElement || !this.freezeCanvas || !this.freezeCtx) return;
    if (this.videoElement.readyState < 2) return;
    // Prevent overwriting a valid frozen frame unless forced (e.g. on intermediate seeked frames)
    if (!force && this.isFreezingFrame) return;

    try {
      const w = Math.round(this.videoDisplayWidth) || this.freezeCanvas.width;
      const h = Math.round(this.videoDisplayHeight) || this.freezeCanvas.height;
      if (w > 0 && h > 0) {
        if (this.freezeCanvas.width !== w || this.freezeCanvas.height !== h) {
          this.freezeCanvas.width = w;
          this.freezeCanvas.height = h;
        }
        this.freezeCanvas.style.left = `${Math.round(this.videoDisplayLeft)}px`;
        this.freezeCanvas.style.top = `${Math.round(this.videoDisplayTop)}px`;
        this.freezeCtx.clearRect(0, 0, w, h);
        this.freezeCtx.drawImage(this.videoElement, 0, 0, w, h);
        this.freezeCanvas.style.display = 'block';
        this.isFreezingFrame = true;
      }
    } catch {
      // Ignore cross-origin capture errors if any
    }
  }

  private cancelFreezeCallbacks(): void {
    if (this.videoFrameCallback !== null) {
      this.videoElement?.cancelVideoFrameCallback?.(this.videoFrameCallback);
      this.videoFrameCallback = null;
    }
    if (this.freezeAnimationFrame !== null) {
      cancelAnimationFrame(this.freezeAnimationFrame);
      this.freezeAnimationFrame = null;
    }
    if (this.freezeTimeout !== null) {
      clearTimeout(this.freezeTimeout);
      this.freezeTimeout = null;
    }
  }

  private scheduleDismissFreezeFrame(): void {
    if (!this.isFreezingFrame || this.isSeekingVideo || this.pendingSeek !== null) return;
    const generation = this.videoLoadGeneration;
    const candidate = this.candidateId;
    const serial = this.seekSerial;
    const dismiss = () => {
      if (generation !== this.videoLoadGeneration || candidate !== this.candidateId || serial !== this.seekSerial || this.isSeekingVideo || this.pendingSeek !== null) return;
      this.cancelFreezeCallbacks();
      this.dismissFreezeFrame();
    };
    // Paused video frame callbacks need not fire. Paint twice after settlement and
    // retain a timer fallback for throttled animation frames in native webviews.
    this.freezeAnimationFrame = requestAnimationFrame(() => {
      this.freezeAnimationFrame = requestAnimationFrame(() => {
        this.freezeAnimationFrame = null;
        dismiss();
      });
    });
    this.freezeTimeout = setTimeout(dismiss, 250);
  }

  private dismissFreezeFrame() {
    if (!this.freezeCanvas) return;
    this.freezeCanvas.style.display = 'none';
    this.isFreezingFrame = false;
  }

  private performSafeSeek(targetTime: number, fast = false): void {
    const video = this.videoElement;
    if (!video || !this.canSeek() || !Number.isFinite(targetTime)) return;
    const time = Math.max(0, Math.min(video.duration, targetTime));
    if (this.isSeekingVideo || video.seeking) {
      this.pendingSeek = { time, precise: !fast };
      if (!this.isSeekingVideo) {
        this.isSeekingVideo = true;
        const generation = this.videoLoadGeneration;
        const candidate = this.candidateId;
        this.seekWatchdog = setTimeout(() => {
          if (generation === this.videoLoadGeneration && candidate === this.candidateId && this.isSeekingVideo) this.failPlayback('timeout');
        }, 10_000);
      }
      return;
    }
    this.dispatchSeek(time, !fast, !fast && !this.activeSeekPrecise);
  }

  private dispatchSeek(time: number, precise: boolean, forcePrecise = false): void {
    const video = this.videoElement;
    if (!video || !this.canSeek()) return;
    this.cancelFreezeCallbacks();
    const serial = ++this.seekSerial;
    if (Math.abs(time - video.currentTime) < 0.001 && !forcePrecise) {
      this.activeSeekPrecise = true;
      this.settleSeek();
      return;
    }
    this.captureFreezeFrame();
    this.isSeekingVideo = true;
    this.activeSeekPrecise = precise;
    const generation = this.videoLoadGeneration;
    const candidate = this.candidateId;
    if (video.requestVideoFrameCallback) {
      this.videoFrameCallback = video.requestVideoFrameCallback(() => {
        this.videoFrameCallback = null;
        if (serial === this.seekSerial && generation === this.videoLoadGeneration && candidate === this.candidateId && !this.isSeekingVideo && this.pendingSeek === null) {
          this.cancelFreezeCallbacks();
          this.dismissFreezeFrame();
        }
      });
    }
    this.seekWatchdog = setTimeout(() => {
      if (serial === this.seekSerial && generation === this.videoLoadGeneration && candidate === this.candidateId && this.isSeekingVideo) this.failPlayback('timeout');
    }, 10_000);
    try {
      if (!precise && typeof video.fastSeek === 'function') video.fastSeek(time);
      else video.currentTime = time;
      // Native same-position assignments are allowed to complete without seeked.
      if (!video.seeking && Math.abs(video.currentTime - time) < 0.001) this.settleSeek();
    } catch {
      this.failPlayback('decode');
    }
  }

  private settleSeek(): void {
    if (this.seekWatchdog !== null) {
      clearTimeout(this.seekWatchdog);
      this.seekWatchdog = null;
    }
    const wasPrecise = this.activeSeekPrecise;
    this.isSeekingVideo = false;
    const next = this.pendingSeek;
    this.pendingSeek = null;
    if (next) {
      this.dispatchSeek(next.time, next.precise, next.precise && !wasPrecise);
      return;
    }
    this.updatePlaybackTime();
    this.scheduleDismissFreezeFrame();
    if (!this.isUserSeeking && !this.isScrollingSeek && this.wasPlayingBeforeSeek) {
      this.wasPlayingBeforeSeek = false;
      this.playVideo();
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
    if (!this.canInteractWithVideo()) return;
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

  public toggleMediaAccordion(forceOpen?: boolean) {
    if (!this.mediaStepEl) return;
    const shouldOpen = forceOpen !== undefined ? forceOpen : !this.mediaStepEl.classList.contains('active');
    if (shouldOpen) {
      this.mediaStepEl.classList.add('active');
    } else {
      this.mediaStepEl.classList.remove('active');
    }
    this.updateVideoPreviewOverlayBounds();
  }

  private updateMediaAccordionSummary() {
    if (!this.mediaStepEl) return;
    const hasVideo = !!this.state.videoPath;
    const hasSub = !!this.state.subtitlePath;

    if (hasVideo) {
      this.mediaStepEl.classList.add('completed');
      if (this.mediaStepIcon) {
        this.mediaStepIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;color:var(--color-green);"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      }
    } else {
      this.mediaStepEl.classList.remove('completed');
      if (this.mediaStepIcon) {
        this.mediaStepIcon.textContent = '1';
      }
    }

    if (this.mediaSummaryBadge) {
      if (hasVideo) {
        const lastSlash = Math.max(this.state.videoPath.lastIndexOf('/'), this.state.videoPath.lastIndexOf('\\'));
        const vName = lastSlash >= 0 ? this.state.videoPath.substring(lastSlash + 1) : this.state.videoPath;
        // A name and a count, and each reads its own way: the badge is built from one
        // isolate per token instead of one line of mixed directions, which is what used
        // to hand the count's digits to the name beside them and print the extension on
        // the far side of the badge. The count comes from the interface's own keys — the
        // same two the cue list under the card uses, so a subtitle file that parsed to no
        // cues reads "0 Cues" in Persian rather than an English "Sub Loaded".
        const subCount = this.subtitleCues.length > 0
          ? ` • ${t('hardsub.cuesCount', { count: this.subtitleCues.length })}`
          : (hasSub ? ` • ${t('hardsub.cuesCountZero')}` : '');
        this.mediaSummaryBadge.innerHTML = '';
        const checkSpan = document.createElement('span');
        checkSpan.textContent = '✓';
        checkSpan.style.flexShrink = '0';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = vName;
        nameSpan.className = 'hardsub-summary-name';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        nameSpan.style.minWidth = '0';
        nameSpan.style.flex = '1 1 auto';
        applyContentDirection(nameSpan, vName);

        this.mediaSummaryBadge.appendChild(checkSpan);
        this.mediaSummaryBadge.appendChild(nameSpan);

        if (subCount) {
          const countSpan = document.createElement('span');
          countSpan.textContent = subCount;
          countSpan.style.flexShrink = '0';
          countSpan.style.whiteSpace = 'nowrap';
          this.mediaSummaryBadge.appendChild(countSpan);
        }

        this.mediaSummaryBadge.title = `Video: ${isolateLtr(this.state.videoPath)}${hasSub ? `\nSubtitle: ${isolateLtr(this.state.subtitlePath)}` : ''}`;
        this.mediaSummaryBadge.style.display = 'inline-flex';
      } else {
        this.mediaSummaryBadge.innerHTML = '';
        this.mediaSummaryBadge.style.display = 'none';
      }
    }
  }

  private updateVideoDropzoneUI(videoPath: string) {
    if (!videoPath) {
      if (this.lblVideoName) {
        this.lblVideoName.textContent = t('hardsub.noVideoLoaded');
        clearContentDirection(this.lblVideoName);
      }
      if (this.lblVideoPath) this.lblVideoPath.textContent = t('hardsub.dropVideoPrompt');
      this.videoDropZone?.classList.remove('has-file');
      this.updateMediaAccordionSummary();
      return;
    }

    const lastSlash = Math.max(videoPath.lastIndexOf('/'), videoPath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? videoPath.substring(lastSlash + 1) : videoPath;

    // A name is the user's own text and reads in its own direction: `01 - intro.mkv`
    // keeps its number in front in a Persian interface instead of coming out as
    // `intro.mkv - 01`, and `[Group] Show - 01.mkv` keeps its tag where it was written.
    if (this.lblVideoName) {
      this.lblVideoName.textContent = `✓ ${fileName}`;
      applyContentDirection(this.lblVideoName, fileName);
    }
    if (this.lblVideoPath) this.lblVideoPath.textContent = videoPath;
    this.videoDropZone?.classList.add('has-file');
    this.updateMediaAccordionSummary();
  }

  private updateSubDropzoneUI(subPath: string, cueCount?: number) {
    if (!subPath) {
      if (this.lblSubName) {
        this.lblSubName.textContent = t('hardsub.noSubLoaded');
        clearContentDirection(this.lblSubName);
      }
      if (this.lblSubPath) this.lblSubPath.textContent = t('hardsub.dropSubPrompt');
      this.subDropZone?.classList.remove('has-file');
      this.updateMediaAccordionSummary();
      return;
    }

    const lastSlash = Math.max(subPath.lastIndexOf('/'), subPath.lastIndexOf('\\'));
    const fileName = lastSlash >= 0 ? subPath.substring(lastSlash + 1) : subPath;
    // The count is a token of its own and the name is another, so each is isolated in
    // the direction it reads in and the parentheses between them stay the interface's.
    const countStr = typeof cueCount === 'number'
      ? ` (${isolateDirection(t('hardsub.cuesCount', { count: cueCount }))})`
      : '';

    if (this.lblSubName) {
      this.lblSubName.textContent = `✓ ${fileName}${countStr}`;
      applyContentDirection(this.lblSubName, fileName);
    }
    if (this.lblSubPath) this.lblSubPath.textContent = subPath;
    this.subDropZone?.classList.add('has-file');
    this.updateMediaAccordionSummary();
  }

  private selectVideoSource(videoPath: string): void {
    if (this.disposed) return;
    this.state.videoPath = videoPath;
    this.lastExportedPath = null;
    this.lastStatusPayload = null;
    if (this.btnOpenFolder) {
      this.btnOpenFolder.style.display = 'none';
    }
    if (this.telemetryBox) {
      this.telemetryBox.style.display = 'none';
    }
    if (this.progressFill) {
      this.progressFill.style.width = '0%';
    }
    if (this.progressPctText) {
      this.progressPctText.textContent = '0%';
    }
    if (this.progressStatusText) {
      this.progressStatusText.textContent = t('transcribe.standingBy');
    }
    if (this.videoPathInput) this.videoPathInput.value = videoPath;
    this.updateVideoDropzoneUI(videoPath);
    this.autoSuggestSubtitleAndOutput(videoPath);
    void this.loadVideoMedia(videoPath);
  }

  private isCurrentVideoLoad(generation: number, videoPath: string): boolean {
    return !this.disposed && generation === this.videoLoadGeneration && videoPath === this.state.videoPath;
  }

  private clearLoadingTimeout(): void {
    if (this.loadingTimeout !== null) clearTimeout(this.loadingTimeout);
    this.loadingTimeout = null;
  }

  private resetLoadingTimeout(generation: number, candidateId: string, durationMs = 45_000): void {
    this.clearLoadingTimeout();
    this.loadingTimeout = setTimeout(() => {
      if (generation === this.videoLoadGeneration && this.candidateId === candidateId && this.phase === 'loading') {
        this.failPlayback('timeout');
      }
    }, durationMs);
  }

  private exitPreviewFullscreen(): void {
    if (document.fullscreenElement?.id === 'hardsub-player-container') {
      void document.exitFullscreen().then(() => {
        if (!this.disposed) this.renderPlayerPhase();
      }).catch(() => {});
    }
  }

  private async releasePreview(): Promise<void> {
    const requestId = this.previewRequestId;
    this.previewRequestId = null;
    this.previewUnlisten?.();
    this.previewUnlisten = null;
    if (requestId !== null) await invoke('release_hardsub_preview', { requestId }).catch(() => {});
  }

  private cancelPreview(): void {
    if (this.phase !== 'loading' && this.phase !== 'preparing') return;
    ++this.videoLoadGeneration;
    this.resetVideoSource();
    void this.releasePreview();
    this.phase = 'cancelled';
    this.previewProgress = null;
    this.previewError = null;
    this.exitPreviewFullscreen();
    this.syncPlayPauseUI();
    this.previewRetryBtn?.focus();
  }

  private failPreview(error: unknown): void {
    const structured = error && typeof error === 'object' && 'code' in error && 'detail' in error ? error as PreviewError : null;
    // Diagnostics are bounded plain text. Never expose a media capability URL.
    this.previewError = {
      code: structured?.code ?? 'source_invalid',
      detail: String(structured?.detail ?? '').replace(/https?:\/\/[^\s<>"']+/gi, '[URL]').slice(0, 4096),
    };
    this.playbackError = null;
    this.clearLoadingTimeout();
    this.resetVideoSource();
    this.phase = structured?.code === 'cancelled' ? 'cancelled' : 'error';
    this.previewProgress = null;
    this.exitPreviewFullscreen();
    void this.releasePreview();
    this.syncPlayPauseUI();
  }

  private async loadVideoMedia(videoPath: string): Promise<void> {
    const generation = ++this.videoLoadGeneration;
    this.resetVideoSource();
    const released = this.releasePreview();
    this.activeSeekPrecise = true;
    this.attemptedCandidates.clear();
    this.sourceInfo = null;
    this.directSourceGeometry = null;
    this.previewCandidateStage = null;
    this.previewStage = null;
    this.previewProgress = null;
    this.previewError = null;
    if (this.disposed || !videoPath || !this.videoElement) return;
    const requestId = ++this.previewRequestCounter;
    this.previewRequestId = requestId;
    this.phase = 'loading';
    this.playbackError = null;
    this.syncPlayPauseUI();
    const current = () => this.isCurrentVideoLoad(generation, videoPath) && this.previewRequestId === requestId;
    try {
      await released;
      if (!current()) return;
      const unlisten = await listen<PreviewProgress>('hardsub-preview-progress', ({ payload }) => {
        if (!current() || payload.requestId !== requestId || this.phase !== 'preparing') return;
        this.previewStage = payload.stage;
        this.previewProgress = typeof payload.progress === 'number' && Number.isFinite(payload.progress) ? Math.min(0.99, Math.max(0, payload.progress)) : null;
        this.renderPlayerPhase();
      });
      if (!current()) { unlisten?.(); return; }
      this.previewUnlisten = unlisten ?? null;
      const candidate = await invoke<PreviewCandidate>('begin_hardsub_preview', { requestId, sourcePath: videoPath });
      if (!current()) {
        await invoke('release_hardsub_preview', { requestId }).catch(() => {});
        return;
      }
      this.attemptPreviewCandidate(candidate, generation);
      // Native playback remains usable when tools are absent. Metadata belongs
      // to the original, never the temporary candidate's scaled dimensions.
      void invoke<SourceInfo>('probe_hardsub_source', { sourcePath: videoPath }).then(source => {
        if (!current()) return;
        this.sourceInfo = source;
        this.updateVideoPreviewOverlayBounds();
      }).catch(() => {});
    } catch (error) {
      if (current()) this.failPreview(error);
    }
  }

  private attemptPreviewCandidate(candidate: PreviewCandidate, generation: number): void {
    const video = this.videoElement;
    if (!video || generation !== this.videoLoadGeneration || candidate.requestId !== this.previewRequestId) return;
    if (this.attemptedCandidates.has(candidate.candidateId)) {
      this.failPreview({ code: 'no_compatible_preview', detail: '' });
      return;
    }
    this.attemptedCandidates.add(candidate.candidateId);
    this.resetVideoSource();
    this.phase = 'loading';
    this.previewProgress = null;
    this.previewCandidateStage = candidate.stage;
    if (candidate.source) this.sourceInfo = candidate.source;
    this.candidateId = candidate.candidateId;
    this.expectedMediaUrl = candidate.url;
    this.attachMediaListeners(generation, candidate.candidateId, candidate.url);
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';
    video.src = candidate.url;
    video.load();
    video.style.display = 'block';
    if (this.videoPlaceholder) this.videoPlaceholder.style.display = 'none';
    if (this.subtitleCanvas) this.subtitleCanvas.style.display = 'block';
    this.syncPlayPauseUI();
    this.updateVideoPreviewOverlayBounds();
    this.resetLoadingTimeout(generation, candidate.candidateId, 45_000);
    this.accordionTimeout = setTimeout(() => {
      if (generation !== this.videoLoadGeneration || this.candidateId !== candidate.candidateId || !this.pageActive) return;
      this.toggleMediaAccordion(false);
    }, 250);
  }

  private async advancePreview(generation: number, candidateId: string): Promise<void> {
    const video = this.videoElement;
    const requestId = this.previewRequestId;
    if (!video || requestId === null || generation !== this.videoLoadGeneration || candidateId !== this.candidateId || (this.phase !== 'loading' && this.phase !== 'ready')) return;
    // Invalidate media listeners synchronously, before invoking conversion, so
    // duplicate decode errors and aborts cannot advance the same candidate twice.
    this.phase = 'preparing';
    this.resetVideoSource();
    this.previewStage = 'probing';
    this.previewProgress = null;
    this.playbackError = null;
    this.exitPreviewFullscreen();
    this.syncPlayPauseUI();
    try {
      const candidate = await invoke<PreviewCandidate>('advance_hardsub_preview', {
        requestId, candidateId,
        mp4Supported: video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') !== '',
        webmSupported: video.canPlayType('video/webm; codecs="vp9, opus"') !== '',
      });
      if (this.disposed || generation !== this.videoLoadGeneration || requestId !== this.previewRequestId) {
        await invoke('release_hardsub_preview', { requestId }).catch(() => {});
        return;
      }
      this.attemptPreviewCandidate(candidate, generation);
    } catch (error) {
      if (!this.disposed && generation === this.videoLoadGeneration && requestId === this.previewRequestId) this.failPreview(error);
    }
  }

  private async loadSubtitleFile(subPath: string) {
    if (!subPath) return;
    try {
      const content = await invoke<string>('read_text_file_content', { filePath: subPath });
      if (this.disposed || this.state.subtitlePath !== subPath) return;
      const lastDot = subPath.lastIndexOf('.');
      const ext = lastDot > 0 ? subPath.substring(lastDot + 1).toLowerCase() : 'srt';
      this.subtitleCues = parseSubtitleContent(content, ext);
      this.maxCueDuration = this.subtitleCues.reduce((max, c) => Math.max(max, c.endMs - c.startMs), 0);
      this.isSubtitlesModified = false;
      this._lastRenderKey = '';
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
      if (this.subtitleCountBadge) this.subtitleCountBadge.textContent = t('hardsub.cuesCountZero');
      return;
    }

    if (this.emptyCueNotice) this.emptyCueNotice.style.display = 'none';

    const filtered = this.subtitleCues.filter((cue) => {
      if (!this.searchFilterQuery) return true;
      return cue.text.toLowerCase().includes(this.searchFilterQuery);
    });

    if (this.subtitleCountBadge) {
      this.subtitleCountBadge.textContent = t('hardsub.cuesCount', { count: filtered.length });
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
            <span class="subtitle-cue-active-badge">${t('hardsub.cueActive')}</span>
          </div>
          <button class="pill-btn jump-cue-btn" style="padding: 2px 8px; font-size: 0.72rem; height: 22px;" title="${t('hardsub.cuePlayTooltip')}">
            ▶ ${t('hardsub.cuePlay')}
          </button>
        </div>
        <textarea class="subtitle-cue-textarea" data-cue-id="${cue.id}">${cue.text}</textarea>
      `;

      const cueField = card.querySelector<HTMLTextAreaElement>('textarea.subtitle-cue-textarea');
      if (cueField) applyTextDirection(cueField);

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
        if (this.currentSubtitleText !== clickedCue.text) {
          this.currentSubtitleText = clickedCue.text;
          this.renderSubtitleOnCanvas();
        }
        return;
      }
    }

    const activeCue = findCueAtTimeBinary(this.subtitleCues, curMs, this.maxCueDuration);

    if (activeCue) {
      if (this.activeCueId !== activeCue.id) {
        this.activeCueId = activeCue.id;
        this.highlightActiveCard(activeCue.id);
      }
      if (this.currentSubtitleText !== activeCue.text) {
        this.currentSubtitleText = activeCue.text;
        this.renderSubtitleOnCanvas();
      }
    } else {
      if (this.activeCueId !== null) {
        this.activeCueId = null;
        this.highlightActiveCard(null);
      }
      if (this.currentSubtitleText !== '') {
        this.currentSubtitleText = '';
        this.renderSubtitleOnCanvas();
      }
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
    if (subPath) {
      if (this.subtitlePathInput) this.subtitlePathInput.value = subPath;
      this.state.subtitlePath = subPath;
      this.loadSubtitleFile(subPath);
    }
    if (videoPath) {
      this.selectVideoSource(videoPath);
    } else if (subPath) {
      const notifyFn = (window as any).showNotification;
      if (typeof notifyFn === 'function') {
        notifyFn(t('hardsub.subLoadedSelectVideo'), 'info');
      }
      const videoZone = document.getElementById('hardsub-video-drop-zone');
      if (videoZone) {
        videoZone.classList.add('pulse-attention');
        setTimeout(() => videoZone.classList.remove('pulse-attention'), 3500);
      }
    }
  }

  private updateComputedOutputPath() {
    if (!this.state.videoPath) return;
    const originalVideoPath = this.state.videoPath;
    const lastSlash = Math.max(originalVideoPath.lastIndexOf('/'), originalVideoPath.lastIndexOf('\\'));
    const fileNameWithExt = lastSlash >= 0 ? originalVideoPath.substring(lastSlash + 1) : originalVideoPath;
    const lastDot = fileNameWithExt.lastIndexOf('.');
    const stem = lastDot > 0 ? fileNameWithExt.substring(0, lastDot) : fileNameWithExt;
    const format = this.state.outputFormat || 'mp4';
    const outFileName = `${stem}_hardsub.${format}`;

    if (this.state.outputDir) {
      this.state.outputPath = joinPath(this.state.outputDir, outFileName);
    } else {
      const parentDir = getParentDir(originalVideoPath);
      this.state.outputPath = parentDir ? joinPath(parentDir, outFileName) : `${stem}_hardsub.${format}`;
    }
  }

  public async browseOutputDir() {
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected) {
        this.state.outputDir = selected;
        this.updateComputedOutputPath();
        this.updateOutputDirUI();
        this.updateFfmpegCommandPreview();
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  }

  public resetOutputDir() {
    this.state.outputDir = '';
    this.updateComputedOutputPath();
    this.updateOutputDirUI();
    this.updateFfmpegCommandPreview();
  }

  private updateOutputDirUI() {
    if (!this.outputDirText || !this.btnResetDir) return;
    if (this.state.outputDir) {
      this.outputDirText.textContent = this.state.outputDir;
      this.outputDirText.title = isolateLtr(this.state.outputDir);
      this.outputDirText.classList.add('has-custom-path');
      this.btnResetDir.style.display = 'inline-flex';
    } else {
      this.outputDirText.textContent = t('hardsub.sameAsSource');
      this.outputDirText.removeAttribute('title');
      this.outputDirText.classList.remove('has-custom-path');
      this.btnResetDir.style.display = 'none';
    }
  }

  public async openOutputFolder() {
    const targetPath = this.lastExportedPath || this.state.outputPath;
    const targetFolder = (targetPath ? getParentDir(targetPath) : '') || this.state.outputDir;
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
      const notifyFn = (window as any).showNotification;
      if (typeof notifyFn === 'function') {
        notifyFn(String(err || 'Failed to open output directory'), 'error');
      }
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
      this.updateComputedOutputPath();
      this.updateOutputDirUI();
    }
  }

  private updateColorSwatches() {
    if (this.swatchText) this.swatchText.style.background = this.state.primaryColor;
    if (this.hexTextLabel) this.hexTextLabel.textContent = this.state.primaryColor;

    if (this.swatchOutline) this.swatchOutline.style.background = this.state.outlineColor;

    if (this.swatchBg) this.swatchBg.style.background = this.state.bgBoxColor;
    if (this.hexBgLabel) this.hexBgLabel.textContent = this.state.bgBoxColor;
  }

  private updateLivePreview() {
    this.updateVideoPreviewOverlayBounds();
    this.updateColorSwatches();

    // Ensure font is loaded before rendering on canvas
    const fontSpec = `16px '${this.state.fontName}'`;
    const generation = this.videoLoadGeneration;
    const candidate = this.candidateId;
    document.fonts.load(fontSpec).then(() => {
      if (!this.disposed && generation === this.videoLoadGeneration && candidate === this.candidateId) this.renderSubtitleOnCanvas(true);
    }).catch(() => {
      // Fallback: render with whatever font is available
      if (!this.disposed && generation === this.videoLoadGeneration && candidate === this.candidateId) this.renderSubtitleOnCanvas(true);
    });
  }

  /**
   * Canvas-based subtitle renderer that matches libass/ASS rendering algorithm.
   * Uses the same PlayResY=288 reference height and scaling logic as FFmpeg's
   * subtitles filter with original_size parameter.
   */
  private renderSubtitleOnCanvas(force: boolean = false) {
    if (this.disposed || this.phase !== 'ready') return;

    // Only update UI controls and color swatches when styling state actually changes or forced
    const uiStateKey = `${this.state.fontSize}|${this.state.outlineSize}|${this.state.positionY}|${this.state.bgBox}|${this.state.primaryColor}|${this.state.outlineColor}|${this.state.bgBoxColor}`;
    if (force || this._lastUIStateKey !== uiStateKey) {
      this._lastUIStateKey = uiStateKey;
      this.updateUIControlsState();
      this.updateColorSwatches();
    }

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
      uiStateKey,
      this.state.fontName, this.state.widthMargin, this.state.alignment,
      this.state.bold, this.state.italic, this.state.bgBoxOpacity, this.state.bgBoxRadius,
      this.fontMetrics.scale, this.fontMetrics.ascentRatio, this.fontMetrics.descentRatio,
    ].join('|');
    if (!force && this._lastRenderKey === renderKey) return;
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
      const lineWidths = measureSpanWidths(ctx, lineSpans, this.state.fontName, renderedFontSize);
      const totalLineWidth = lineWidths.reduce((total, width) => total + width, 0);
      let startX: number;
      if (textAlignmentStr === 'left') {
        startX = anchorX;
      } else if (textAlignmentStr === 'right') {
        startX = anchorX - totalLineWidth;
      } else {
        startX = anchorX - totalLineWidth / 2;
      }

      // The line reads in the direction of its own first strong character, and its runs
      // follow that order: a right-to-left line starts at the right edge and walks left.
      // That is the bidi order. A run with no strong character of its own — a space, a
      // dash — takes the line's direction, as the bidi algorithm resolves it, and the
      // runs' edges are the same either way. assRunOrder writes the burn script in the
      // matching order.
      const lineDirection = detectBaseDirection(lineSpans.map((span) => span.text).join(''));
      const spanX = spanOrigins(lineWidths, startX, lineDirection);

      ctx.textAlign = 'left';

      for (let i = 0; i < lineSpans.length; i++) {
        const span = lineSpans[i];
        setSpanFont(ctx, this.state.fontName, renderedFontSize, span.bold, span.italic);

        // Let the run's own content pick the base direction instead of inheriting the
        // interface direction, then hint the same direction to the renderer.
        const spanDirection = firstStrongDirection(span.text) ?? lineDirection;
        ctx.direction = spanDirection;
        const formattedSpan = protectRtlPunctuation(span.text, spanDirection);
        const spanText = spanDirection === 'rtl' ? `\u202B${formattedSpan}\u202C` : span.text;
        const x = spanX[i];

        // --- Outline (matching ASS Outline with contour expansion) ---
        if (renderedOutline > 0) {
          ctx.save();
          ctx.strokeStyle = this.state.outlineColor;
          ctx.lineWidth = renderedOutline * 2; // ASS Outline expands outward; strokeText is centered
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeText(spanText, x, y);
          ctx.restore();
        }

        // --- Fill text (primary color) ---
        ctx.fillStyle = span.color;
        ctx.fillText(spanText, x, y);

        // --- Draw underline if requested ---
        if (span.underline) {
          drawUnderline(ctx, lineWidths[i], renderedFontSize, x, y, span.color);
        }
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
        startBtnSpan.textContent = active ? t('hardsub.exportingVideo') : t('hardsub.exportHardsubVideo');
      }
      startBtn.style.opacity = active ? '0.7' : '1';
      startBtn.style.cursor = active ? 'not-allowed' : 'pointer';
    }

    if (this.cancelBtn) {
      this.cancelBtn.style.display = active ? 'inline-flex' : 'none';
    }

    if (this.btnBrowseDir) {
      this.btnBrowseDir.disabled = active;
    }
    if (this.btnResetDir) {
      this.btnResetDir.disabled = active;
    }
    if (active && this.btnOpenFolder) {
      this.btnOpenFolder.style.display = 'none';
    }

    if (this.telemetryBox) {
      if (active) {
        this.telemetryBox.style.display = 'flex';
      } else {
        const isSettled = this.lastStatusPayload && (
          this.lastStatusPayload.stage === 'completed' ||
          this.lastStatusPayload.progress >= 1.0 ||
          this.lastStatusPayload.stage === 'cancelled' ||
          this.lastStatusPayload.stage === 'failed'
        );
        if (!isSettled) {
          this.telemetryBox.style.display = 'none';
        }
      }
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
    this.retainNativeListener(listen<{
      progress: number;
      message: string;
      active: boolean;
      stage?: string;
      speed?: string;
      fps?: string;
    }>('hardsub-status', (event) => {
      if (this.disposed) return;
      const data = event.payload;
      this.lastStatusPayload = data;
      if (this.telemetryBox && data.active) {
        this.telemetryBox.style.display = 'flex';
      }
      const pct = Math.round(data.progress * 100);

      (window as any).isHardsubRunning = !!data.active;
      if (typeof (window as any).updateTaskbarProgress === 'function') {
        (window as any).updateTaskbarProgress(data.progress, data.active);
      }

      if (this.progressFill) {
        this.progressFill.style.width = `${pct}%`;
      }
      if (this.progressPctText) {
        this.progressPctText.textContent = `${pct}%`;
      }
      if (this.progressStatusText) {
        this.progressStatusText.textContent = formatHardsubStatus(data);
      }

      if (!data.active && (data.stage === 'completed' || data.progress >= 1.0)) {
        if (this.progressFill) {
          this.progressFill.style.width = '100%';
        }
        if (this.progressPctText) {
          this.progressPctText.textContent = '100%';
        }
        if (this.btnOpenFolder) {
          this.btnOpenFolder.style.display = 'inline-flex';
        }
      }

      this.updateEncodingUIState(data.active);
    }));
  }
  private generateAssContent(): string {
    const videoW = this.sourceInfo?.displayWidth ?? this.directSourceGeometry?.width;
    const videoH = this.sourceInfo?.displayHeight ?? this.directSourceGeometry?.height;
    if (!videoW || !videoH || !Number.isFinite(videoW) || !Number.isFinite(videoH)) throw new Error(t('hardsub.previewUnavailable'));
    const videoAspect = videoW / videoH;

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

          // Every span below gets its own tag block, but libass splits its runs on style
          // changes rather than on tag blocks: a line whose spans share one style stays a
          // single run, one whose spans differ is resolved and placed run by run. That is
          // what decides whether the spans are written in logical or in visual order, and
          // assRunOrder holds the rule — it is what keeps an RTL line with a styled word
          // from burning mirrored without also mirroring a plain one.
          const lineText = lineSpans.map((span) => span.text).join('');
          const lineDirection = detectBaseDirection(lineText);
          const orderedSpans = assRunOrder(
            lineSpans,
            lineDirection,
            (span) => `${span.bold}|${span.italic}|${span.underline}|${span.color}`,
          );

          let assLineText = '';
          for (const span of orderedSpans) {
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

            const spanDirection = firstStrongDirection(span.text) ?? lineDirection;
            const formattedText = protectRtlPunctuation(span.text, spanDirection);
            assLineText += `{${bTag}${iTag}${uTag}${cTag}}${formattedText}`;
          }

          if (lineDirection === 'rtl') {
            assLineText = `\u200F${assLineText}\u200F`;
          }

          events += `Dialogue: 1,${startStr},${endStr},TextStyle,,0,0,0,,{\\an${dialogueAlignment}}{\\pos(${X},${lineY})}${assLineText}\n`;
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
    if (this.isEncoding || this.disposed) return;
    const originalVideoPath = this.state.videoPath;
    const generation = this.videoLoadGeneration;
    const current = () => this.isCurrentVideoLoad(generation, originalVideoPath);
    this.state.subtitlePath = this.subtitlePathInput?.value.trim() || '';

    if (!this.state.videoPath) {
      if ((window as any).showNotification) {
        (window as any).showNotification(t('hardsub.selectVideoFirst'), 'warning');
      } else {
        alert(t('hardsub.selectVideoFirst'));
      }
      return;
    }
    if (!this.state.subtitlePath) {
      if ((window as any).showNotification) {
        (window as any).showNotification(t('hardsub.selectSubFirst'), 'warning');
      } else {
        alert(t('hardsub.selectSubFirst'));
      }
      return;
    }

    const originalSubPath = this.state.subtitlePath;
    let exportSubtitlePath = originalSubPath;
    this.updateEncodingUIState(true);
    try {
      await this.refreshFontRenderScale();
      if (!current()) return;
      if (!this.sourceInfo) {
        try {
          const source = await invoke<SourceInfo>('probe_hardsub_source', { sourcePath: originalVideoPath });
          if (!current()) return;
          this.sourceInfo = source;
        } catch (error) {
          if (!current()) return;
          if (!this.directSourceGeometry) throw error;
        }
      }

    if (this.subtitleCues.length === 0 && originalSubPath) {
      await this.loadSubtitleFile(originalSubPath);
      if (!current()) return;
    }

    if (this.isSubtitlesModified && this.subtitleCues.length > 0) {
      try {
        const srtContent = convertCuesToSrt(this.subtitleCues);
        await invoke('write_text_file_content', {
          filePath: originalSubPath,
          content: srtContent,
        });
        if (!current()) return;
        console.log('Saved modified subtitle content to disk');
      } catch (e) {
        console.warn('Failed to save edited subtitles to disk:', e);
      }
    }

    if (!this.state.outputPath) {
      this.autoSuggestSubtitleAndOutput(originalVideoPath);
    }

    if (this.subtitleCues.length > 0) {
      try {
        const lastDot = originalVideoPath.lastIndexOf('.');
        const tempAssPath = originalVideoPath.substring(0, lastDot) + '.temp.ass';
        const assContent = this.generateAssContent();
        await invoke('write_text_file_content', {
          filePath: tempAssPath,
          content: assContent,
        });
        if (!current()) return;

        console.log('Generated temporary ASS subtitle file with styled vector boxes');
        exportSubtitlePath = tempAssPath;
      } catch (e) {
        console.warn('Failed to generate temporary ASS subtitles, falling back to original:', e);
      }
    }

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

      if (this.progressFill) {
        this.progressFill.style.width = '0%';
      }
      if (this.progressPctText) {
        this.progressPctText.textContent = '0%';
      }
      if (this.progressStatusText) {
        this.progressStatusText.textContent = t('hardsub.statusInitEncoder');
      }

      this.lastExportedPath = null;
      if (this.btnOpenFolder) {
        this.btnOpenFolder.style.display = 'none';
      }
      if (this.telemetryBox) {
        this.telemetryBox.style.display = 'flex';
      }
      this.updateComputedOutputPath();

      if (!current()) return;
      const result = await invoke<{ outputPath: string; durationMs: number; outputSizeMb: number }>('start_hardsub_task', {
        settings: { ...this.state, videoPath: originalVideoPath, subtitlePath: exportSubtitlePath },
      });
      if (result?.outputPath) {
        this.lastExportedPath = result.outputPath;
      }
      if (this.progressFill) {
        this.progressFill.style.width = '100%';
      }
      if (this.progressPctText) {
        this.progressPctText.textContent = '100%';
      }
      if (this.btnOpenFolder) {
        this.btnOpenFolder.style.display = 'inline-flex';
      }
      if (this.progressStatusText) {
        this.progressStatusText.textContent = t('hardsub.statusExportSuccess');
      }
    } catch (e: any) {
      const msg = String(e || '');
      if (msg.includes('cancelled') || msg.includes('Cancelled')) {
        console.log('Hardsub task cancelled by user');
        if (this.progressStatusText) {
          this.progressStatusText.textContent = t('hardsub.statusEncodingCancelled');
        }
      } else {
        if ((window as any).showNotification) {
          (window as any).showNotification(t('hardsub.encodingFailed', { error: String(e) }), "error");
        } else {
          alert(t('hardsub.encodingFailed', { error: String(e) }));
        }
        if (this.progressStatusText) {
          this.progressStatusText.textContent = t('hardsub.statusEncodingError', { error: String(e) });
        }
      }
    } finally {
      this.updateEncodingUIState(false);
    }
  }
}

export const hardsubController = new HardsubController();
(window as any).hardsubController = hardsubController;
