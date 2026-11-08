// Live Transcript Viewer Controller for Whisper Desktop
import { t, applyTextDirection } from '../i18n/index';
import { escapeHTML } from './logsController';

export interface TranscriptLine {
  id: number;
  timeRange: string;
  text: string;
}

let transcriptLines: TranscriptLine[] = [];
let transcriptDirty = false;
let transcriptSaveTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightSavePromise: Promise<void> | null = null;

const TRANSCRIPT_SAVE_DEBOUNCE_MS = 350;

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const getTauriInvoke = (): any => {
  const win = getGlobal();
  const tauri = win.__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return win.invoke || null;
};

/**
 * Keeps a transcript line's direction in step with what is being typed into it.
 */
export function autoResizeTranscriptField(el: HTMLElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  if (el.scrollHeight > 0) {
    el.style.height = `${el.scrollHeight}px`;
  }
}

export function setupTranscriptDirection(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const viewport = document.getElementById('transcript-viewport') as any;
  if (!viewport || viewport._hasDirectionListener) return;
  viewport._hasDirectionListener = true;
  
  viewport.addEventListener('input', (e: Event) => {
    const field = e.target as HTMLElement;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      applyTextDirection(field);
      if (field.classList.contains('transcript-text-input')) {
        autoResizeTranscriptField(field);
      }
    }
  });

  window.addEventListener('whisper:languageChanged', () => {
    viewport.querySelectorAll('.transcript-text-input').forEach((input: HTMLElement) => {
      applyTextDirection(input);
      autoResizeTranscriptField(input);
    });
  });

  window.addEventListener('resize', () => {
    viewport.querySelectorAll('.transcript-text-input').forEach((input: HTMLElement) => {
      autoResizeTranscriptField(input);
    });
  });
}

export function parseTranscriptTimeRange(timeRange: string): { raw: string; durLabel: string } {
  if (!timeRange) return { raw: '', durLabel: '' };
  const match = timeRange.match(/\[?(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*(?:-->|→)\s*(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]?/);
  if (match) {
    const start = match[1];
    const end = match[2];
    const toSec = (str: string) => {
      const parts = str.split(':');
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    };
    const diff = Math.max(0, Math.round(toSec(end) - toSec(start)));
    const durLabel = diff > 0 ? `${diff}s` : '';
    return {
      raw: `${start} → ${end}`,
      durLabel
    };
  }
  return {
    raw: timeRange.replace(/^\[|\]$/g, ''),
    durLabel: ''
  };
}

export function createTranscriptCardElement(lineObj: TranscriptLine): HTMLDivElement {
  if (typeof document === 'undefined') {
    return null as any;
  }
  const parsedTime = parseTranscriptTimeRange(lineObj.timeRange);
  
  const cardEl = document.createElement('div');
  cardEl.className = 'transcript-card transcript-line';
  cardEl.dataset.id = String(lineObj.id);

  const headerEl = document.createElement('div');
  headerEl.className = 'transcript-card-header';

  const badgeWrap = document.createElement('div');
  badgeWrap.className = 'transcript-card-badge-wrap';

  const numSpan = document.createElement('span');
  numSpan.className = 'transcript-card-num';
  numSpan.textContent = `#${lineObj.id + 1}`;
  badgeWrap.appendChild(numSpan);

  if (parsedTime.durLabel) {
    const durSpan = document.createElement('span');
    durSpan.className = 'transcript-card-dur';
    durSpan.textContent = parsedTime.durLabel;
    badgeWrap.appendChild(durSpan);
  }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'transcript-card-time';
  timeDiv.setAttribute('dir', 'ltr');

  if (parsedTime.raw && (parsedTime.raw.includes('→') || parsedTime.raw.includes('-->') || parsedTime.raw.includes(':'))) {
    timeDiv.innerHTML = `
      <svg class="transcript-time-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>${escapeHTML(parsedTime.raw)}</span>
    `;
  } else {
    timeDiv.innerHTML = `<span style="color: var(--color-text-dim); font-size: 0.72rem;">${escapeHTML(parsedTime.raw || `Line ${lineObj.id + 1}`)}</span>`;
  }

  headerEl.appendChild(badgeWrap);
  headerEl.appendChild(timeDiv);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'transcript-card-body';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.className = 'transcript-text-input';
  textarea.value = lineObj.text;
  applyTextDirection(textarea);
  textarea.oninput = () => {
    updateTranscriptLineText(lineObj.id, textarea.value);
  };
  textarea.onchange = () => {
    updateTranscriptLineText(lineObj.id, textarea.value);
    void flushPendingTranscriptEdits();
  };
  bodyEl.appendChild(textarea);

  cardEl.appendChild(headerEl);
  cardEl.appendChild(bodyEl);
  return cardEl;
}

export function renderTranscriptLines(lines: TranscriptLine[]): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport) return;
  viewport.innerHTML = '';

  const placeholder = document.getElementById('transcript-placeholder');
  if (placeholder) placeholder.remove();

  if (!lines || lines.length === 0) {
    viewport.innerHTML = `<div style="color: var(--color-text-dim); text-align: center; margin-top: 40px;" data-i18n="transcribe.noSegments">${escapeHTML(t('transcribe.noSegments') || 'No transcript segments generated yet.')}</div>`;
    const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
    if (btnCopy) btnCopy.disabled = true;
    return;
  }

  const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
  if (btnCopy) btnCopy.disabled = false;

  const frag = document.createDocumentFragment();
  lines.forEach((lineObj) => {
    const cardEl = createTranscriptCardElement(lineObj);
    frag.appendChild(cardEl);
  });
  viewport.appendChild(frag);

  viewport.querySelectorAll('.transcript-text-input').forEach((input: any) => {
    applyTextDirection(input);
    autoResizeTranscriptField(input);
  });
}

export function appendTranscriptLine(timeRange: string, text: string): void {
  const cleanText = text.trim();
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const isBatchRunning = win.isBatchExtracting && win.batchProcessingIndex >= 0 && win.batchItems && win.batchItems[win.batchProcessingIndex];
  const activeItem = isBatchRunning ? win.batchItems[win.batchProcessingIndex] : null;

  if (isBatchRunning && activeItem) {
    if (!activeItem.transcriptLines) activeItem.transcriptLines = [];
  }

  const lineObj: TranscriptLine = {
    timeRange,
    text: cleanText,
    id: (isBatchRunning && activeItem) ? activeItem.transcriptLines.length : transcriptLines.length
  };

  if (isBatchRunning && activeItem) {
    activeItem.transcriptLines.push({ ...lineObj });
    if (win.activeBatchViewerIndex !== win.batchProcessingIndex) {
      return;
    }
  }

  transcriptLines.push({ ...lineObj });

  if (typeof document === 'undefined') return;

  const placeholder = document.getElementById('transcript-placeholder');
  if (placeholder) placeholder.remove();
  
  const viewport = document.getElementById('transcript-viewport') as any;
  if (!viewport) return;

  const lingeringInit = viewport.querySelector('.transcript-initializing-state, [data-i18n="transcribe.aiModelInitializing"]');
  if (lingeringInit) lingeringInit.remove();

  const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
  if (btnCopy) btnCopy.disabled = false;

  const cardEl = createTranscriptCardElement(lineObj);
  viewport.appendChild(cardEl);

  const textarea = cardEl.querySelector('.transcript-text-input') as HTMLElement | null;
  if (textarea) autoResizeTranscriptField(textarea);

  while (viewport.children.length > 2000) {
    viewport.removeChild(viewport.firstElementChild!);
  }

  clearTimeout(viewport._scrollDebounce);
  viewport._scrollDebounce = setTimeout(() => {
    viewport.scrollTop = viewport.scrollHeight;
  }, 80);
}

function extractLineStartEndMs(line: TranscriptLine, fallbackIndex: number): { startMs: number; endMs: number } {
  const match = (line.timeRange || '').match(
    /(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:-->|→)\s*(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)/
  );
  if (match) {
    const startMs = parseTimestampStringToMs(match[1]);
    const endMs = parseTimestampStringToMs(match[2]);
    if (startMs !== null && endMs !== null) {
      return { startMs, endMs: Math.max(startMs, endMs) };
    }
  }
  const fallbackStart = fallbackIndex * 2000;
  return { startMs: fallbackStart, endMs: fallbackStart + 2000 };
}

function formatMsToSrtTimestamp(ms: number): string {
  return formatMsToTimestamp(ms).replace('.', ',');
}

function formatMsToLrcTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(Number(ms) || 0));
  const totalSec = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const hundredths = Math.floor((totalMs % 1000) / 10);
  return `[${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}]`;
}

export function serializeTranscriptLinesForFile(lines: TranscriptLine[], filePath: string): string | null {
  if (!filePath || !Array.isArray(lines) || lines.length === 0) return null;
  const ext = (filePath.split('.').pop() || '').toLowerCase();

  if (ext === 'srt') {
    return lines
      .map((line, idx) => {
        const { startMs, endMs } = extractLineStartEndMs(line, idx);
        return `${idx + 1}\n${formatMsToSrtTimestamp(startMs)} --> ${formatMsToSrtTimestamp(endMs)}\n${line.text}\n`;
      })
      .join('\n');
  }

  if (ext === 'vtt') {
    const body = lines
      .map((line, idx) => {
        const { startMs, endMs } = extractLineStartEndMs(line, idx);
        return `${idx + 1}\n${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}\n${line.text}\n`;
      })
      .join('\n');
    return `WEBVTT\n\n${body}`;
  }

  if (ext === 'lrc') {
    return (
      lines
        .map((line, idx) => {
          const { startMs } = extractLineStartEndMs(line, idx);
          const singleLine = (line.text || '').replace(/\r?\n/g, ' ').trim();
          return `${formatMsToLrcTimestamp(startMs)}${singleLine}`;
        })
        .join('\n') + '\n'
    );
  }

  if (ext === 'txt') {
    return lines.map(l => l.text).join('\n') + '\n';
  }

  if (ext === 'csv') {
    const rows = lines.map((line, idx) => {
      const { startMs, endMs } = extractLineStartEndMs(line, idx);
      const escaped = (line.text || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
      return `${startMs},${endMs},"${escaped}"`;
    });
    return `start,end,text\n${rows.join('\n')}\n`;
  }

  if (ext === 'tsv') {
    const rows = lines.map((line, idx) => {
      const { startMs, endMs } = extractLineStartEndMs(line, idx);
      const escaped = (line.text || '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      return `${startMs}\t${endMs}\t${escaped}`;
    });
    return `start\tend\ttext\n${rows.join('\n')}\n`;
  }

  return null;
}

function collectActiveTranscriptTargetFiles(): string[] {
  const win = getGlobal();
  const targets = new Set<string>();

  const addIfSupported = (p: unknown) => {
    if (typeof p !== 'string' || !p.trim()) return;
    const clean = p.trim();
    const ext = (clean.split('.').pop() || '').toLowerCase();
    if (['srt', 'vtt', 'lrc', 'txt', 'csv', 'tsv'].includes(ext)) {
      targets.add(clean);
    }
  };

  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && Array.isArray(win.batchItems)) {
    const item = win.batchItems[win.activeBatchViewerIndex];
    if (item) {
      if (Array.isArray(item.outputFiles)) {
        item.outputFiles.forEach((f: any) => {
          if (f && f.type !== 'translated') addIfSupported(f.path);
        });
      }
      addIfSupported(item.subtitlePath);
      addIfSupported(item.txtPath);
    }
  }

  if (Array.isArray(win.lastTranscribedOutputFiles)) {
    win.lastTranscribedOutputFiles.forEach((f: any) => {
      if (f && f.type !== 'translated') addIfSupported(f.path);
    });
  }
  addIfSupported(win.lastTranscribedSubtitlePath);

  return Array.from(targets);
}

export async function persistTranscriptLinesToDisk(): Promise<void> {
  if (!transcriptDirty) return;
  const invoke = getTauriInvoke();
  if (!invoke) {
    transcriptDirty = false;
    return;
  }

  const targetFiles = collectActiveTranscriptTargetFiles();
  if (targetFiles.length === 0 || transcriptLines.length === 0) {
    transcriptDirty = false;
    return;
  }

  const linesSnapshot = transcriptLines.map(l => ({ ...l }));
  transcriptDirty = false;

  for (const filePath of targetFiles) {
    const content = serializeTranscriptLinesForFile(linesSnapshot, filePath);
    if (content !== null) {
      try {
        await invoke('write_text_file_content', { filePath, content });
      } catch (err) {
        console.warn('Failed to persist transcript edits to file:', filePath, err);
      }
    }
  }
}

function scheduleTranscriptDiskSync(): void {
  if (transcriptSaveTimer !== null) {
    clearTimeout(transcriptSaveTimer);
  }
  transcriptSaveTimer = setTimeout(() => {
    transcriptSaveTimer = null;
    inFlightSavePromise = persistTranscriptLinesToDisk().finally(() => {
      inFlightSavePromise = null;
    });
  }, TRANSCRIPT_SAVE_DEBOUNCE_MS);
}

export function hasPendingTranscriptEdits(): boolean {
  return transcriptDirty || transcriptSaveTimer !== null || inFlightSavePromise !== null;
}

export async function flushPendingTranscriptEdits(): Promise<void> {
  if (transcriptSaveTimer !== null) {
    clearTimeout(transcriptSaveTimer);
    transcriptSaveTimer = null;
  }
  if (inFlightSavePromise) {
    await inFlightSavePromise;
  }
  if (transcriptDirty) {
    inFlightSavePromise = persistTranscriptLinesToDisk().finally(() => {
      inFlightSavePromise = null;
    });
    await inFlightSavePromise;
  }
}

export function updateTranscriptLineText(id: number, value: string): void {
  let changed = false;
  const line = transcriptLines.find(l => l.id === id);
  if (line) {
    if (line.text !== value) changed = true;
    line.text = value;
  }
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    const item = win.batchItems[win.activeBatchViewerIndex];
    if (item.transcriptLines) {
      const itemLine = item.transcriptLines.find((l: any) => l.id === id);
      if (itemLine) {
        if (itemLine.text !== value) changed = true;
        itemLine.text = value;
      }
    }
  }
  if (changed) {
    transcriptDirty = true;
    scheduleTranscriptDiskSync();
  }
}

export function filterTranscriptLines(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('transcript-search') as HTMLInputElement | null;
  const win = getGlobal();
  if (searchInput && win.applyDynamicDirection) {
    win.applyDynamicDirection(searchInput);
  }
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const lines = document.querySelectorAll('.transcript-line');
  const viewport = document.getElementById('transcript-viewport');
  let matchCount = 0;

  lines.forEach((lineEl: any) => {
    const textInput = lineEl.querySelector('.transcript-text-input');
    if (textInput) {
      const match = !query || textInput.value.toLowerCase().includes(query);
      lineEl.style.display = match ? 'flex' : 'none';
      if (match) {
        matchCount++;
        autoResizeTranscriptField(textInput);
      }
    }
  });

  if (viewport && lines.length > 0) {
    let emptySearchEl = document.getElementById('transcript-search-empty');
    if (query && matchCount === 0) {
      if (!emptySearchEl) {
        emptySearchEl = document.createElement('div');
        emptySearchEl.id = 'transcript-search-empty';
        emptySearchEl.className = 'transcript-empty-notice';
        emptySearchEl.style.cssText = 'padding: 32px 16px; text-align: center; color: var(--color-text-dim); font-size: 0.85rem; user-select: none;';
        viewport.appendChild(emptySearchEl);
      }
      emptySearchEl.setAttribute('data-i18n', 'transcribe.noMatchingTranscript');
      emptySearchEl.textContent = t('transcribe.noMatchingTranscript') || 'No matching transcript lines found.';
      emptySearchEl.style.display = 'block';
    } else if (emptySearchEl) {
      emptySearchEl.style.display = 'none';
    }
  }
}

export function formatMsToTimestamp(ms: number | string): string {
  const totalMs = Math.max(0, Math.round(Number(ms) || 0));
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const remMs = totalMs % 1000;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${remMs.toString().padStart(3, '0')}`;
}

export function parseTimestampStringToMs(str: string): number | null {
  if (!str) return null;
  const s = String(str).replace(/^["']|["']$/g, '').trim().replace(',', '.');
  if (s.includes(':')) {
    const parts = s.split(':');
    if (parts.length === 3) {
      const h = parseFloat(parts[0].replace(/^["']|["']$/g, '')) || 0;
      const m = parseFloat(parts[1].replace(/^["']|["']$/g, '')) || 0;
      const sec = parseFloat(parts[2].replace(/^["']|["']$/g, '')) || 0;
      return Math.round((h * 3600 + m * 60 + sec) * 1000);
    } else if (parts.length === 2) {
      const m = parseFloat(parts[0].replace(/^["']|["']$/g, '')) || 0;
      const sec = parseFloat(parts[1].replace(/^["']|["']$/g, '')) || 0;
      return Math.round((m * 60 + sec) * 1000);
    }
  }
  return null;
}

export function parseSegmentTimestamps(rawStart: any, rawEnd: any): { startMs: number; endMs: number } | null {
  if (rawStart === undefined || rawStart === null || rawEnd === undefined || rawEnd === null) {
    return null;
  }
  const sClean = typeof rawStart === 'string' ? rawStart.replace(/^["']|["']$/g, '').trim() : String(rawStart);
  const eClean = typeof rawEnd === 'string' ? rawEnd.replace(/^["']|["']$/g, '').trim() : String(rawEnd);

  if (sClean.includes(':') || eClean.includes(':')) {
    const s = parseTimestampStringToMs(sClean);
    const e = parseTimestampStringToMs(eClean);
    if (s !== null && e !== null) {
      return { startMs: Math.max(0, s), endMs: Math.max(0, e) };
    }
  }
  const sNum = parseFloat(sClean);
  const eNum = parseFloat(eClean);
  if (isNaN(sNum) || isNaN(eNum)) {
    return null;
  }
  const diff = eNum - sNum;
  const isFractional = sClean.includes('.') || eClean.includes('.') || !Number.isInteger(sNum) || !Number.isInteger(eNum);
  if (isFractional || (diff <= 30 && diff >= 0)) {
    return {
      startMs: Math.max(0, Math.round(sNum * 1000)),
      endMs: Math.max(0, Math.round(eNum * 1000))
    };
  } else {
    return {
      startMs: Math.max(0, Math.round(sNum)),
      endMs: Math.max(0, Math.round(eNum))
    };
  }
}

export async function loadTranscriptFromFile(fullPath: string, shouldRender = true): Promise<TranscriptLine[]> {
  try {
    const invoke = getTauriInvoke();
    if (!invoke) return [];
    const text: string = await invoke('read_text_file_content', { filePath: fullPath });
    
    const parsedLines: TranscriptLine[] = [];
    const ext = (fullPath.split('.').pop() || '').toLowerCase();

    const applyParsedIfRender = (lines: TranscriptLine[]): TranscriptLine[] => {
      if (shouldRender) {
        if (transcriptSaveTimer !== null) {
          clearTimeout(transcriptSaveTimer);
          transcriptSaveTimer = null;
        }
        transcriptDirty = false;
        transcriptLines = lines;
        renderTranscriptLines(transcriptLines);
      }
      return lines;
    };

    // 1. JSON Parser
    if (ext === 'json' || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        const segments = Array.isArray(parsed) ? parsed : (parsed.transcription || parsed.segments || parsed.results || []);
        if (Array.isArray(segments) && segments.length > 0) {
          segments.forEach((seg: any, idx: number) => {
            let timeRange = '';
            if (seg.timestamps && seg.timestamps.from && seg.timestamps.to) {
              timeRange = `[${seg.timestamps.from.replace(',', '.')} --> ${seg.timestamps.to.replace(',', '.')}]`;
            } else if (seg.offsets && typeof seg.offsets.from === 'number' && typeof seg.offsets.to === 'number') {
              timeRange = `[${formatMsToTimestamp(seg.offsets.from)} --> ${formatMsToTimestamp(seg.offsets.to)}]`;
            } else if ((typeof seg.start === 'number' || typeof seg.start === 'string') && (typeof seg.end === 'number' || typeof seg.end === 'string')) {
              const parsedTimes = parseSegmentTimestamps(seg.start, seg.end);
              if (parsedTimes) {
                timeRange = `[${formatMsToTimestamp(parsedTimes.startMs)} --> ${formatMsToTimestamp(parsedTimes.endMs)}]`;
              } else {
                timeRange = `Line ${idx + 1}`;
              }
            } else {
              timeRange = `Line ${idx + 1}`;
            }
            const cleanText = (seg.text || seg.content || '').trim();
            if (cleanText) {
              parsedLines.push({ timeRange, text: cleanText, id: idx });
            }
          });
          if (parsedLines.length > 0) {
            return applyParsedIfRender(parsedLines);
          }
        }
      } catch (_) {}
    }

    // 2. LRC Parser
    if (ext === 'lrc' || /^\[\d{1,2}:\d{2}/m.test(text)) {
      const rawLines = text.split('\n');
      const lrcRegex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
      const parsedCues: Array<{ ms: number; text: string }> = [];
      rawLines.forEach(l => {
        const match = l.trim().match(lrcRegex);
        if (match) {
          const min = parseInt(match[1], 10) || 0;
          const sec = parseInt(match[2], 10) || 0;
          const ms = parseInt((match[3] || '0').padEnd(3, '0').slice(0, 3), 10) || 0;
          const totalMs = (min * 60 + sec) * 1000 + ms;
          const textContent = match[4].trim();
          if (textContent) {
            parsedCues.push({ ms: totalMs, text: textContent });
          }
        }
      });
      if (parsedCues.length > 0) {
        parsedCues.forEach((cue, idx) => {
          const nextMs = (idx + 1 < parsedCues.length) ? parsedCues[idx + 1].ms : (cue.ms + 3000);
          const timeRange = `[${formatMsToTimestamp(cue.ms)} --> ${formatMsToTimestamp(nextMs)}]`;
          parsedLines.push({ timeRange, text: cue.text, id: idx });
        });
        return applyParsedIfRender(parsedLines);
      }
    }

    // 3. CSV / TSV Parser
    if (ext === 'csv' || ext === 'tsv') {
      const sep = ext === 'tsv' ? '\t' : ',';
      const rawLines = text.split('\n');
      let cueId = 0;
      let startCol = 0;
      let endCol = 1;
      let textCol = 2;

      rawLines.forEach((l, idx) => {
        const line = l.trim();
        if (!line) return;

        if (idx === 0 && (line.toLowerCase().includes('start') || line.toLowerCase().includes('text'))) {
          const headerCols = line.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim().toLowerCase());
          const sIdx = headerCols.findIndex(c => c === 'start' || c === 'start_time' || c === 'from');
          const eIdx = headerCols.findIndex(c => c === 'end' || c === 'end_time' || c === 'to');
          const tIdx = headerCols.findIndex(c => c === 'text' || c === 'content' || c === 'sentence');
          if (sIdx !== -1 && eIdx !== -1) {
            startCol = sIdx;
            endCol = eIdx;
            if (tIdx !== -1) textCol = tIdx;
          }
          return;
        }

        const cols = line.split(sep);
        const minCols = Math.max(startCol, endCol, textCol) + 1;
        if (cols.length >= minCols) {
          const rawStart = cols[startCol].trim();
          const rawEnd = cols[endCol].trim();
          let textVal = '';
          if (textCol === cols.length - 1 || textCol === 2) {
            textVal = cols.slice(textCol).join(sep);
          } else {
            textVal = cols[textCol];
          }
          textVal = textVal.replace(/^["']|["']$/g, '').replace(/""/g, '"').trim();
          const parsedTimes = parseSegmentTimestamps(rawStart, rawEnd);
          if (parsedTimes && textVal) {
            const timeRange = `[${formatMsToTimestamp(parsedTimes.startMs)} --> ${formatMsToTimestamp(parsedTimes.endMs)}]`;
            parsedLines.push({ timeRange, text: textVal, id: cueId++ });
          }
        }
      });
      if (parsedLines.length > 0) {
        return applyParsedIfRender(parsedLines);
      }
    }

    // 4. Subtitle format (SRT / VTT)
    const isSub = (ext === 'srt' || ext === 'vtt' || text.includes('-->')) && ext !== 'txt';

    if (isSub) {
      const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      let i = 0;
      const total = lines.length;
      let cueId = 0;

      while (i < total) {
        const line = lines[i];

        if (ext === 'vtt' && (line.startsWith('WEBVTT') || line.startsWith('NOTE') || line.startsWith('STYLE') || line.startsWith('REGION'))) {
          i++;
          while (i < total && lines[i].trim() !== '') i++;
          continue;
        }

        if (line.includes('-->')) {
          const parts = line.split('-->');
          if (parts.length === 2) {
            const startRaw = parts[0].trim().split(' ')[0].replace(',', '.');
            const endRaw = parts[1].trim().split(' ')[0].replace(',', '.');
            const timeRange = `[${startRaw} --> ${endRaw}]`;

            const textParts: string[] = [];
            i++;
            while (i < total && lines[i].trim() !== '' && !lines[i].includes('-->')) {
              if (/^\d+$/.test(lines[i].trim()) && (i + 1 < total) && lines[i + 1].includes('-->')) {
                break;
              }
              textParts.push(lines[i]);
              i++;
            }

            const cleanText = textParts.join('\n').replace(/<[^>]+>/g, '').trim();
            if (cleanText || startRaw) {
              parsedLines.push({ timeRange, text: cleanText, id: cueId++ });
            }
            continue;
          }
        }
        i++;
      }
    } else {
      // 5. Plain text format
      const lines = text.split('\n');
      let lineId = 0;
      lines.forEach((lineText) => {
        const trimmed = lineText.trim();
        if (!trimmed) return;
        parsedLines.push({ timeRange: `Line ${lineId + 1}`, text: trimmed, id: lineId++ });
      });
    }

    return applyParsedIfRender(parsedLines);
  } catch (err) {
    console.error("Failed to load transcript file:", err);
    return [];
  }
}

export async function copyLiveTranscriptToClipboard(): Promise<void> {
  const btn = document.getElementById('btn-copy-transcript') as any;
  const win = getGlobal();
  const showNotification = win.showNotification;
  const copyToClipboard = win.copyToClipboard;
  
  const triggerBtnFeedback = () => {
    if (btn) {
      const span = btn.querySelector('span');
      if (span) {
        if (!span._origText) {
          span._origText = span.textContent;
        }
        span.textContent = t('transcribe.copied');
        clearTimeout(btn._copyFeedbackTimer);
        btn._copyFeedbackTimer = setTimeout(() => {
          if (span && span._origText) {
            span.textContent = span._origText;
            span._origText = null;
          }
        }, 2000);
      } else {
        if (!btn._origText) {
          btn._origText = btn.textContent;
        }
        btn.textContent = t('transcribe.copied');
        clearTimeout(btn._copyFeedbackTimer);
        btn._copyFeedbackTimer = setTimeout(() => {
          if (btn && btn._origText) {
            btn.textContent = btn._origText;
            btn._origText = null;
          }
        }, 2000);
      }
    }
  };

  if (transcriptLines && transcriptLines.length > 0) {
    const textToCopy = transcriptLines
      .map(l => l.text)
      .join('\n');
      
    try {
      if (copyToClipboard) await copyToClipboard(textToCopy);
      triggerBtnFeedback();
      if (showNotification) showNotification(t('toasts.liveTranscriptCopied'), "success");
      return;
    } catch (err: any) {
      const msg = (err && (err.message || err.toString())) || String(err);
      if (showNotification) showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
      return;
    }
  }

  const viewport = document.getElementById('transcript-viewport');
  if (viewport && !viewport.querySelector('.transcript-placeholder') && !viewport.querySelector('.transcript-initializing-state')) {
    const rawPreview = (viewport as HTMLElement).innerText?.trim() || '';
    if (rawPreview.length > 0) {
      try {
        if (copyToClipboard) await copyToClipboard(rawPreview);
        triggerBtnFeedback();
        if (showNotification) showNotification(t('toasts.previewCopied'), "success");
        return;
      } catch (err: any) {
        const msg = (err && (err.message || err.toString())) || String(err);
        if (showNotification) showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
        return;
      }
    }
  }

  if (win.selectedMediaFile && typeof win.copyMainTranscriptToClipboard === 'function') {
    await win.copyMainTranscriptToClipboard();
  } else {
    if (showNotification) showNotification(t('toasts.noTranscriptToCopy'), "info");
  }
}

export function getTranscriptLines(): TranscriptLine[] {
  return transcriptLines;
}

export function clearTranscriptLines(): void {
  if (transcriptSaveTimer !== null) {
    clearTimeout(transcriptSaveTimer);
    transcriptSaveTimer = null;
  }
  transcriptDirty = false;
  transcriptLines = [];
  renderTranscriptLines([]);
}

// Bind to window for HTML onclick/oninput handlers
if (typeof window !== 'undefined') {
  (window as any).autoResizeTranscriptField = autoResizeTranscriptField;
  (window as any).createTranscriptCardElement = createTranscriptCardElement;
  (window as any).renderTranscriptLines = renderTranscriptLines;
  (window as any).appendTranscriptLine = appendTranscriptLine;
  (window as any).updateTranscriptLineText = updateTranscriptLineText;
  (window as any).flushPendingTranscriptEdits = flushPendingTranscriptEdits;
  (window as any).hasPendingTranscriptEdits = hasPendingTranscriptEdits;
  (window as any).serializeTranscriptLinesForFile = serializeTranscriptLinesForFile;
  (window as any).filterTranscriptLines = filterTranscriptLines;
  (window as any).formatMsToTimestamp = formatMsToTimestamp;
  (window as any).parseTimestampStringToMs = parseTimestampStringToMs;
  (window as any).parseSegmentTimestamps = parseSegmentTimestamps;
  (window as any).parseTranscriptTimeRange = parseTranscriptTimeRange;
  (window as any).loadTranscriptFromFile = loadTranscriptFromFile;
  (window as any).copyLiveTranscriptToClipboard = copyLiveTranscriptToClipboard;
  (window as any).copyEditorTranscriptToClipboard = copyLiveTranscriptToClipboard;
  (window as any).getTranscriptLines = getTranscriptLines;
  (window as any).clearTranscriptLines = clearTranscriptLines;
}

export const transcriptViewer = {
  get lines() { return transcriptLines; },
  set lines(val: TranscriptLine[]) {
    if (transcriptSaveTimer !== null) {
      clearTimeout(transcriptSaveTimer);
      transcriptSaveTimer = null;
    }
    transcriptDirty = false;
    transcriptLines = val;
  },
  getLines: getTranscriptLines,
  clear: clearTranscriptLines,
  appendLine: appendTranscriptLine,
  render: renderTranscriptLines,
  createCard: createTranscriptCardElement,
  updateLineText: updateTranscriptLineText,
  flushEdits: flushPendingTranscriptEdits,
  hasPendingEdits: hasPendingTranscriptEdits,
  serializeForFile: serializeTranscriptLinesForFile,
  filter: filterTranscriptLines,
  copy: copyLiveTranscriptToClipboard,
  loadFromFile: loadTranscriptFromFile,
  autoResize: autoResizeTranscriptField,
  setupDirection: setupTranscriptDirection,
  parseTimeRange: parseTranscriptTimeRange,
  formatMs: formatMsToTimestamp,
  parseTimestamp: parseTimestampStringToMs,
  parseSegments: parseSegmentTimestamps
};
