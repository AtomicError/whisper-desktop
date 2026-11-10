// Live Transcript Viewer Controller for Whisper Desktop
import { t, applyTextDirection } from '../i18n/index';
import { escapeHTML } from './logsController';

export interface WordToken {
  text: string;
  startMs: number;
  endMs: number;
  prob: number;
}

export interface TranscriptLine {
  id: number;
  timeRange: string;
  text: string;
  startMs?: number;
  endMs?: number;
  words?: WordToken[];
}

let transcriptLines: TranscriptLine[] = [];
let transcriptDirty = false;
let transcriptSaveTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightSavePromise: Promise<void> | null = null;
let confidenceHighlightingActive = false;

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

  const { startMs } = extractLineStartEndMs(lineObj, lineObj.id);

  // Card Action Buttons (Play, Split, Merge)
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'transcript-card-actions';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'btn-card-action btn-card-play';
  const playTitle = t('transcribe.playSegment') || 'Play segment';
  playBtn.title = playTitle;
  playBtn.setAttribute('aria-label', playTitle);
  playBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  `;
  playBtn.onclick = (e) => {
    e.stopPropagation();
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs);
    }
  };
  actionsWrap.appendChild(playBtn);

  const splitBtn = document.createElement('button');
  splitBtn.type = 'button';
  splitBtn.className = 'btn-card-action btn-card-split';
  const splitTitle = t('transcribe.splitSegment') || 'Split segment (Enter)';
  splitBtn.title = splitTitle;
  splitBtn.setAttribute('aria-label', splitTitle);
  splitBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  `;
  splitBtn.onclick = (e) => {
    e.stopPropagation();
    splitTranscriptSegment(lineObj.id);
  };
  actionsWrap.appendChild(splitBtn);

  if (lineObj.id > 0) {
    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'btn-card-action btn-card-merge';
    const mergeTitle = t('transcribe.mergeSegment') || 'Merge with previous (Backspace)';
    mergeBtn.title = mergeTitle;
    mergeBtn.setAttribute('aria-label', mergeTitle);
    mergeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/>
        <path d="m20 22-5-5"/>
      </svg>
    `;
    mergeBtn.onclick = (e) => {
      e.stopPropagation();
      mergeTranscriptSegmentWithPrevious(lineObj.id);
    };
    actionsWrap.appendChild(mergeBtn);
  }

  headerEl.appendChild(actionsWrap);

  headerEl.onclick = () => {
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs);
    }
  };

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
  textarea.onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      splitTranscriptSegment(lineObj.id, textarea.selectionStart);
    } else if (e.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0 && lineObj.id > 0) {
      e.preventDefault();
      mergeTranscriptSegmentWithPrevious(lineObj.id);
    } else if (e.key === 'Tab') {
      const targetId = e.shiftKey ? lineObj.id - 1 : lineObj.id + 1;
      const targetInput = document.querySelector(`.transcript-card[data-id="${targetId}"] .transcript-text-input`) as HTMLTextAreaElement | null;
      if (targetInput) {
        e.preventDefault();
        targetInput.focus();
      }
    }
  };
  bodyEl.appendChild(textarea);

  // Word-level confidence badges / clickable words bar
  if (Array.isArray(lineObj.words) && lineObj.words.length > 0) {
    const wordsBar = document.createElement('div');
    wordsBar.className = 'transcript-words-bar';
    if (!confidenceHighlightingActive) {
      wordsBar.classList.add('confidence-bar-dimmed');
    }
    lineObj.words.forEach(w => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'transcript-word';
      const isLow = w.prob < 0.60;
      if (isLow) {
        wordSpan.classList.add('low-confidence');
        wordSpan.title = `Word: "${w.text.trim()}" • Confidence: ${Math.round(w.prob * 100)}% (Low certainty)`;
      } else {
        wordSpan.title = `Word: "${w.text.trim()}" • Confidence: ${Math.round(w.prob * 100)}%`;
      }
      wordSpan.textContent = w.text.trim();
      wordSpan.onclick = (e) => {
        e.stopPropagation();
        const win = getGlobal();
        if (typeof win.seekCompanionPlayer === 'function') {
          win.seekCompanionPlayer(w.startMs);
        }
      };
      wordsBar.appendChild(wordSpan);
    });
    bodyEl.appendChild(wordsBar);
  }

  cardEl.ondblclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.btn-card-action')) return;
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs);
    }
  };

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
  if (typeof line.startMs === 'number' && typeof line.endMs === 'number') {
    return { startMs: line.startMs, endMs: Math.max(line.startMs, line.endMs) };
  }
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

export function isConfidenceHighlightingActive(): boolean {
  return confidenceHighlightingActive;
}

export function toggleConfidenceHighlighting(): boolean {
  confidenceHighlightingActive = !confidenceHighlightingActive;
  if (typeof document !== 'undefined') {
    const btn = document.getElementById('btn-toggle-confidence');
    const viewerCard = document.getElementById('transcribe-viewer-card');
    const viewport = document.getElementById('transcript-viewport');
    if (btn) {
      if (confidenceHighlightingActive) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (viewerCard) {
      if (confidenceHighlightingActive) {
        viewerCard.classList.add('highlight-confidence-active');
      } else {
        viewerCard.classList.remove('highlight-confidence-active');
      }
    }
    if (viewport) {
      if (confidenceHighlightingActive) {
        viewport.classList.add('highlight-confidence-active');
      } else {
        viewport.classList.remove('highlight-confidence-active');
      }
    }
  }
  return confidenceHighlightingActive;
}

export function splitTranscriptSegment(lineId: number, cursorPosition?: number): boolean {
  const index = transcriptLines.findIndex(l => l.id === lineId);
  if (index === -1) return false;
  const line = transcriptLines[index];
  const { startMs, endMs } = extractLineStartEndMs(line, line.id);

  // Sync latest text from active DOM textarea if present
  let fullText = line.text;
  if (typeof document !== 'undefined') {
    const domTextarea = document.querySelector(`.transcript-card[data-id="${line.id}"] .transcript-text-input`) as HTMLTextAreaElement | null;
    if (domTextarea && typeof domTextarea.value === 'string') {
      fullText = domTextarea.value;
      line.text = fullText;
    }
  }

  // Determine split character position
  if (typeof cursorPosition === 'number' && (cursorPosition <= 0 || cursorPosition >= fullText.length)) {
    return false;
  }

  let splitPos: number;
  if (typeof cursorPosition === 'number') {
    splitPos = cursorPosition;
  } else {
    // Button click: find natural whitespace boundary closest to the middle of fullText
    const mid = Math.floor(fullText.length / 2);
    let bestSpace = -1;
    let bestDist = Infinity;
    for (let i = 0; i < fullText.length; i++) {
      if (/\s/.test(fullText[i])) {
        const dist = Math.abs(i - mid);
        if (dist < bestDist) {
          bestDist = dist;
          bestSpace = i;
        }
      }
    }
    splitPos = bestSpace !== -1 ? bestSpace : mid;
  }

  if (splitPos <= 0 || splitPos >= fullText.length) {
    return false;
  }

  const leftText = fullText.slice(0, splitPos).trim();
  const rightText = fullText.slice(splitPos).trim();
  if (!leftText && !rightText) return false;

  let splitEndMs = startMs;
  let splitStartMs = endMs;
  let leftWords: WordToken[] | undefined;
  let rightWords: WordToken[] | undefined;

  if (Array.isArray(line.words) && line.words.length > 1) {
    let searchIdx = 0;
    let splitWordIdx = -1;
    for (let i = 0; i < line.words.length; i++) {
      const wText = line.words[i].text.trim();
      if (!wText) continue;
      const foundPos = fullText.indexOf(wText, searchIdx);
      if (foundPos !== -1) {
        const wordEndPos = foundPos + wText.length;
        searchIdx = wordEndPos;
        if (splitPos <= foundPos) {
          splitWordIdx = i - 1;
          break;
        } else if (splitPos <= wordEndPos) {
          splitWordIdx = i;
          break;
        }
      }
    }
    if (splitWordIdx === -1 && searchIdx > 0 && splitPos >= searchIdx) {
      splitWordIdx = line.words.length - 1;
    }
    if (splitWordIdx < 0) {
      splitWordIdx = 0;
    } else if (splitWordIdx >= line.words.length - 1) {
      splitWordIdx = line.words.length - 2;
    }

    leftWords = line.words.slice(0, splitWordIdx + 1);
    rightWords = line.words.slice(splitWordIdx + 1);
    if (leftWords.length > 0 && rightWords.length > 0) {
      splitEndMs = leftWords[leftWords.length - 1].endMs;
      splitStartMs = rightWords[0].startMs;
    } else {
      const ratio = Math.max(0.05, Math.min(0.95, splitPos / Math.max(1, fullText.length)));
      const mid = Math.round(startMs + ratio * Math.max(0, endMs - startMs));
      splitEndMs = mid;
      splitStartMs = mid;
    }
  } else {
    // Proportional character/punctuation interpolation fallback
    const ratio = Math.max(0.05, Math.min(0.95, splitPos / Math.max(1, fullText.length)));
    const mid = Math.round(startMs + ratio * Math.max(0, endMs - startMs));
    splitEndMs = mid;
    splitStartMs = mid;
  }

  // Ensure timestamps are monotonically non-decreasing and bounded by [startMs, endMs]
  splitEndMs = Math.min(endMs, Math.max(startMs, splitEndMs));
  splitStartMs = Math.max(splitEndMs, Math.min(endMs, splitStartMs));

  const line1: TranscriptLine = {
    id: line.id,
    timeRange: `[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(splitEndMs)}]`,
    text: leftText || fullText,
    startMs,
    endMs: splitEndMs,
    words: leftWords,
  };

  const line2: TranscriptLine = {
    id: line.id + 1,
    timeRange: `[${formatMsToTimestamp(splitStartMs)} --> ${formatMsToTimestamp(endMs)}]`,
    text: rightText || '',
    startMs: splitStartMs,
    endMs,
    words: rightWords,
  };

  transcriptLines.splice(index, 1, line1, line2);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  transcriptDirty = true;

  // Sync batch mode if active
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = transcriptLines.map(l => ({ ...l }));
  }

  renderTranscriptLines(transcriptLines);

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const nextInput = document.querySelector(`.transcript-card[data-id="${index + 1}"] .transcript-text-input`) as HTMLTextAreaElement | null;
      if (nextInput && typeof nextInput.focus === 'function') {
        nextInput.focus();
        if (typeof nextInput.setSelectionRange === 'function') {
          nextInput.setSelectionRange(0, 0);
        }
        const card = nextInput.closest('.transcript-card');
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, 30);

  scheduleTranscriptDiskSync();
  return true;
}

export function mergeTranscriptSegmentWithPrevious(lineId: number): boolean {
  const index = transcriptLines.findIndex(l => l.id === lineId);
  if (index <= 0) return false;

  const currLine = transcriptLines[index];
  const prevLine = transcriptLines[index - 1];

  const prevTimes = extractLineStartEndMs(prevLine, prevLine.id);
  const currTimes = extractLineStartEndMs(currLine, currLine.id);

  const unifiedStartMs = prevTimes.startMs;
  const unifiedEndMs = Math.max(prevTimes.endMs, currTimes.endMs);

  let currText = currLine.text;
  let prevText = prevLine.text;
  if (typeof document !== 'undefined') {
    const currTextarea = document.querySelector(`.transcript-card[data-id="${currLine.id}"] .transcript-text-input`) as HTMLTextAreaElement | null;
    const prevTextarea = document.querySelector(`.transcript-card[data-id="${prevLine.id}"] .transcript-text-input`) as HTMLTextAreaElement | null;
    if (currTextarea && typeof currTextarea.value === 'string') currText = currTextarea.value;
    if (prevTextarea && typeof prevTextarea.value === 'string') prevText = prevTextarea.value;
  }

  const prevLen = prevText.length;
  let mergedText = prevText.trim();
  if (currText.trim()) {
    mergedText = mergedText ? `${mergedText} ${currText.trim()}` : currText.trim();
  }

  let mergedWords: WordToken[] | undefined;
  if (Array.isArray(prevLine.words) || Array.isArray(currLine.words)) {
    mergedWords = [...(prevLine.words || []), ...(currLine.words || [])];
  }

  prevLine.text = mergedText;
  prevLine.startMs = unifiedStartMs;
  prevLine.endMs = unifiedEndMs;
  prevLine.timeRange = `[${formatMsToTimestamp(unifiedStartMs)} --> ${formatMsToTimestamp(unifiedEndMs)}]`;
  prevLine.words = mergedWords;

  transcriptLines.splice(index, 1);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  transcriptDirty = true;

  // Sync batch mode if active
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = transcriptLines.map(l => ({ ...l }));
  }

  renderTranscriptLines(transcriptLines);

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const prevInput = document.querySelector(`.transcript-card[data-id="${index - 1}"] .transcript-text-input`) as HTMLTextAreaElement | null;
      if (prevInput && typeof prevInput.focus === 'function') {
        prevInput.focus();
        if (typeof prevInput.setSelectionRange === 'function') {
          const targetPos = Math.min(mergedText.length, prevLen + 1);
          prevInput.setSelectionRange(targetPos, targetPos);
        }
        const card = prevInput.closest('.transcript-card');
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, 30);

  scheduleTranscriptDiskSync();
  return true;
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

export function parseAndApplyTranscriptContent(text: string, ext: string, shouldRender = true): TranscriptLine[] {
  try {
    const parsedLines: TranscriptLine[] = [];

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
            let startMs = 0;
            let endMs = 0;
            if (seg.timestamps && seg.timestamps.from && seg.timestamps.to) {
              timeRange = `[${seg.timestamps.from.replace(',', '.')} --> ${seg.timestamps.to.replace(',', '.')}]`;
              startMs = parseTimestampStringToMs(seg.timestamps.from) ?? 0;
              endMs = parseTimestampStringToMs(seg.timestamps.to) ?? 0;
            } else if (seg.offsets && typeof seg.offsets.from === 'number' && typeof seg.offsets.to === 'number') {
              startMs = seg.offsets.from;
              endMs = seg.offsets.to;
              timeRange = `[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}]`;
            } else if ((typeof seg.start === 'number' || typeof seg.start === 'string') && (typeof seg.end === 'number' || typeof seg.end === 'string')) {
              const parsedTimes = parseSegmentTimestamps(seg.start, seg.end);
              if (parsedTimes) {
                startMs = parsedTimes.startMs;
                endMs = parsedTimes.endMs;
                timeRange = `[${formatMsToTimestamp(startMs)} --> ${formatMsToTimestamp(endMs)}]`;
              } else {
                timeRange = `Line ${idx + 1}`;
              }
            } else {
              timeRange = `Line ${idx + 1}`;
            }
            const cleanText = (seg.text || seg.content || '').trim();

            const words: WordToken[] = [];
            if (Array.isArray(seg.tokens)) {
              seg.tokens.forEach((tok: any) => {
                const rawTok = tok.text || '';
                if (!rawTok || rawTok.startsWith('[_') || rawTok.startsWith('<|')) return;
                const tokStart = (tok.offsets && typeof tok.offsets.from === 'number') ? tok.offsets.from : (parseTimestampStringToMs(tok.timestamps?.from) ?? startMs);
                const tokEnd = (tok.offsets && typeof tok.offsets.to === 'number') ? tok.offsets.to : (parseTimestampStringToMs(tok.timestamps?.to) ?? endMs);
                const prob = (typeof tok.p === 'number') ? tok.p : (typeof tok.prob === 'number' ? tok.prob : (typeof tok.confidence === 'number' ? tok.confidence : 1.0));
                words.push({
                  text: rawTok,
                  startMs: tokStart,
                  endMs: tokEnd,
                  prob,
                });
              });
            }

            if (cleanText) {
              parsedLines.push({
                timeRange,
                text: cleanText,
                id: parsedLines.length,
                startMs,
                endMs,
                words: words.length > 0 ? words : undefined,
              });
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
    console.error("Failed to parse transcript content:", err);
    return [];
  }
}

export async function loadTranscriptFromFile(fullPath: string, shouldRender = true): Promise<TranscriptLine[]> {
  try {
    const invoke = getTauriInvoke();
    if (!invoke) return [];
    const text: string = await invoke('read_text_file_content', { filePath: fullPath });
    const ext = (fullPath.split('.').pop() || '').toLowerCase();
    return parseAndApplyTranscriptContent(text, ext, shouldRender);
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

export async function loadTranscriptFromJsonData(jsonData: string, shouldRender = true): Promise<TranscriptLine[]> {
  try {
    return parseAndApplyTranscriptContent(jsonData, 'json', shouldRender);
  } catch (err) {
    console.error("Failed to load transcript from json data:", err);
    return [];
  }
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
  (window as any).loadTranscriptFromJsonData = loadTranscriptFromJsonData;
  (window as any).splitTranscriptSegment = splitTranscriptSegment;
  (window as any).mergeTranscriptSegmentWithPrevious = mergeTranscriptSegmentWithPrevious;
  (window as any).toggleConfidenceHighlighting = toggleConfidenceHighlighting;
  (window as any).isConfidenceHighlightingActive = isConfidenceHighlightingActive;
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
  splitSegment: splitTranscriptSegment,
  mergeSegment: mergeTranscriptSegmentWithPrevious,
  toggleConfidence: toggleConfidenceHighlighting,
  isConfidenceActive: isConfidenceHighlightingActive,
  loadFromJson: loadTranscriptFromJsonData,
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
