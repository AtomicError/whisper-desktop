// Live Transcript Viewer Controller for Whisper Desktop
import { t, applyTextDirection, applyContentDirection } from '../i18n/index';
import { escapeHTML } from './logsController';
import {
  CONFIDENCE_THRESHOLD_DEFAULT,
  clampConfidenceThreshold,
  classifyWordConfidence,
  isStandalonePunctuationToken,
  lineHasConfidenceData,
  transcriptHasConfidenceData,
  evaluateLineConfidence,
  computeConfidenceSummary,
  markWordAsReviewed,
  reconcileWordsAfterEdit,
  findWordOffsetInText,
  computeWordSeekMs
} from './confidenceHelpers';

export interface WordToken {
  text: string;
  startMs: number;
  endMs: number;
  prob: number;
  reviewed?: boolean;
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
let pendingTranscriptTargetFiles: string[] | null = null;
let pendingTranscriptSnapshotLines: TranscriptLine[] | null = null;
let confidenceHighlightingActive = false;
let confidenceThresholdPercent = CONFIDENCE_THRESHOLD_DEFAULT;
let confidenceLowOnlyFilter = false;
let pendingTranscriptLanguageRefresh = false;
let activeConfidenceJumpIndex = -1;
let pendingConfidenceJumpAnchor: number | null = null;
const reviewedSegmentIdsInSession = new Set<number>();

export interface UndoHistoryEntry {
  lines: TranscriptLine[];
  description: string;
}

const undoStack: UndoHistoryEntry[] = [];
const redoStack: UndoHistoryEntry[] = [];
const MAX_UNDO_DEPTH = 50;

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

function resolveLineForCard(cardEl: HTMLElement): TranscriptLine | undefined {
  const ref = (cardEl as any)._lineRef as TranscriptLine | undefined;
  const idStr = cardEl.dataset?.id;
  if (idStr !== undefined) {
    const idNum = Number(idStr);
    const found = transcriptLines.find(l => l.id === idNum);
    if (found && (!ref || found === ref)) {
      return found;
    }
  }
  return ref;
}

function buildConfidenceViewElement(lineObj: TranscriptLine): HTMLDivElement | null {
  if (typeof document === 'undefined' || !lineHasConfidenceData(lineObj)) {
    return null;
  }
  const viewEl = document.createElement('div');
  viewEl.className = 'transcript-confidence-view';
  viewEl.dataset.lineId = String(lineObj.id);
  applyContentDirection(viewEl, lineObj.text);

  const words = lineObj.words || [];
  let appendedCount = 0;
  words.forEach((w, idx) => {
    const cleanWordText = w.text.trim();
    if (!cleanWordText) return;

    if (appendedCount > 0 && typeof document.createTextNode === 'function') {
      viewEl.appendChild(document.createTextNode(' '));
    }

    const wordSpan = document.createElement('span');
    wordSpan.className = 'transcript-word';
    wordSpan.dataset.wordIdx = String(idx);
    wordSpan.setAttribute('role', 'button');

    const percentStr = Math.round(Math.max(0, Math.min(1, w.prob)) * 100).toString();
    let isFlaggedWord = false;
    if (w.reviewed) {
      wordSpan.classList.add('confidence-reviewed');
      wordSpan.title =
        t('transcribe.wordConfidenceReviewedTooltip', { word: cleanWordText }) ||
        `Word: "${cleanWordText}" • Reviewed`;
    } else {
      const severity = classifyWordConfidence(w.prob, confidenceThresholdPercent);
      if (severity === 'critical') {
        isFlaggedWord = true;
        wordSpan.classList.add('low-confidence', 'critical-confidence');
        wordSpan.title =
          t('transcribe.wordConfidenceCriticalTooltip', { word: cleanWordText, percent: percentStr }) ||
          `Word: "${cleanWordText}" • Confidence: ${percentStr}% (Very low certainty)`;
      } else if (severity === 'low') {
        isFlaggedWord = true;
        wordSpan.classList.add('low-confidence');
        wordSpan.title =
          t('transcribe.wordConfidenceLowTooltip', { word: cleanWordText, percent: percentStr }) ||
          `Word: "${cleanWordText}" • Confidence: ${percentStr}% (Low certainty)`;
      } else {
        wordSpan.title =
          t('transcribe.wordConfidenceTooltip', { word: cleanWordText, percent: percentStr }) ||
          `Word: "${cleanWordText}" • Confidence: ${percentStr}%`;
      }
    }

    // Keep only uncertain words in the Tab order so long transcripts don't create thousands of tab stops;
    // normal/reviewed words stay programmatically focusable via tabindex="-1".
    wordSpan.setAttribute('tabindex', isFlaggedWord ? '0' : '-1');
    wordSpan.textContent = cleanWordText;
    viewEl.appendChild(wordSpan);
    appendedCount++;
  });

  return appendedCount > 0 ? viewEl : null;
}

export function cloneTranscriptLine<T extends { words?: readonly WordToken[] }>(line: T): T {
  return {
    ...line,
    words: Array.isArray(line?.words) ? line.words.map(w => ({ ...w })) : undefined
  };
}

function cloneTranscriptLines(lines: readonly TranscriptLine[]): TranscriptLine[] {
  return lines.map(cloneTranscriptLine);
}

function hasActiveTextSelection(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const sel = window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
}

function getPreferredScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'auto';
  }
  return 'smooth';
}

function clearConfidenceWordFocusInViewport(preserveAnchor = false): void {
  if (!preserveAnchor) {
    pendingConfidenceJumpAnchor = null;
  }
  activeConfidenceJumpIndex = -1;
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const viewport = document.getElementById('transcript-viewport');
  if (viewport && typeof viewport.querySelectorAll === 'function') {
    viewport.querySelectorAll('.transcript-word.confidence-word-focused').forEach(el => {
      el.classList.remove('confidence-word-focused');
    });
  }
}

function syncCardConfidenceMeta(cardEl: HTMLElement, lineObj: TranscriptLine): void {
  const evalResult = evaluateLineConfidence(lineObj, confidenceThresholdPercent);
  const isReviewed =
    lineHasConfidenceData(lineObj) &&
    (evalResult.hasReviewedWords || reviewedSegmentIdsInSession.has(lineObj.id)) &&
    evalResult.flaggedCount === 0;

  if (evalResult.level === 'critical') {
    cardEl.dataset.confidenceLevel = 'critical';
  } else if (evalResult.level === 'low') {
    cardEl.dataset.confidenceLevel = 'low';
  } else {
    delete cardEl.dataset.confidenceLevel;
  }

  if (isReviewed) {
    cardEl.dataset.confidenceReviewed = 'true';
  } else {
    delete cardEl.dataset.confidenceReviewed;
  }

  const badgeWrap = cardEl.querySelector('.transcript-card-badge-wrap') as HTMLElement | null;
  if (!badgeWrap) return;

  let pill = badgeWrap.querySelector('.transcript-card-conf-pill') as HTMLElement | null;
  if (!confidenceHighlightingActive || (evalResult.flaggedCount === 0 && !isReviewed)) {
    if (pill) pill.remove();
    return;
  }

  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'transcript-card-conf-pill';
    badgeWrap.appendChild(pill);
  }

  if (evalResult.flaggedCount > 0) {
    pill.className = `transcript-card-conf-pill is-${evalResult.level}`;
    pill.textContent = String(evalResult.flaggedCount);
    pill.title =
      t('transcribe.segmentLowWordsTooltip', {
        count: evalResult.flaggedCount,
        threshold: confidenceThresholdPercent
      }) || `${evalResult.flaggedCount} word(s) below ${confidenceThresholdPercent}%`;
  } else {
    pill.className = 'transcript-card-conf-pill is-reviewed';
    pill.textContent = '✓';
    pill.title = t('transcribe.segmentReviewedTooltip') || 'Reviewed';
  }
}

function mountOrRefreshCardConfidenceView(cardEl: HTMLElement, lineObj: TranscriptLine): void {
  const bodyEl = cardEl.querySelector('.transcript-card-body') as HTMLElement | null;
  if (!bodyEl) return;

  const existing = bodyEl.querySelector('.transcript-confidence-view') as HTMLElement | null;
  if (existing) existing.remove();

  if (confidenceHighlightingActive && lineHasConfidenceData(lineObj)) {
    const viewEl = buildConfidenceViewElement(lineObj);
    if (viewEl) {
      bodyEl.appendChild(viewEl);
      cardEl.classList.add('has-confidence-view');
    } else {
      cardEl.classList.remove('has-confidence-view');
    }
  } else {
    cardEl.classList.remove('has-confidence-view');
  }

  syncCardConfidenceMeta(cardEl, lineObj);
}

function findVisibleFlaggedWordIndex(lineId: number, wordIdx: number): number {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return -1;
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport) return -1;
  const visibleFlagged = getVisibleFlaggedWordElements(viewport);
  return visibleFlagged.findIndex(el => {
    const elCard = typeof el.closest === 'function' ? (el.closest('.transcript-card') as HTMLElement | null) : null;
    return elCard?.dataset?.id === String(lineId) && el.dataset?.wordIdx === String(wordIdx);
  });
}

function enterCardEditMode(cardEl: HTMLElement, wordIdx?: number, seekPlayer = false): void {
  const textarea = cardEl.querySelector('.transcript-text-input') as HTMLTextAreaElement | null;
  if (!textarea) return;

  const lineObj = resolveLineForCard(cardEl);
  (textarea as any)._editOriginWordIdx = typeof wordIdx === 'number' ? wordIdx : undefined;
  const originFlaggedIdx =
    confidenceHighlightingActive && lineObj && typeof wordIdx === 'number'
      ? findVisibleFlaggedWordIndex(lineObj.id, wordIdx)
      : -1;
  (textarea as any)._editOriginFlaggedIdx = originFlaggedIdx >= 0 ? originFlaggedIdx : undefined;
  cardEl.classList.add('is-editing-text');
  autoResizeTranscriptField(textarea);

  if (lineObj && typeof wordIdx === 'number' && Array.isArray(lineObj.words)) {
    const word = lineObj.words[wordIdx];
    if (word) {
      if (seekPlayer) {
        const win = getGlobal();
        if (typeof win.seekCompanionPlayer === 'function') {
          const { startMs } = extractLineStartEndMs(lineObj, lineObj.id);
          win.seekCompanionPlayer(computeWordSeekMs(word.startMs, startMs), undefined, lineObj.id);
        }
      }
      const offset = findWordOffsetInText(textarea.value, lineObj.words, wordIdx);
      if (typeof textarea.focus === 'function') {
        textarea.focus();
      }
      if (offset && typeof textarea.setSelectionRange === 'function') {
        textarea.setSelectionRange(offset.start, offset.end);
      }
      return;
    }
  }

  if (typeof textarea.focus === 'function') {
    textarea.focus();
  }
}

function handleConfidenceViewInteraction(
  cardEl: HTMLElement,
  target: HTMLElement | null,
  approveWord = false
): boolean {
  if (!target) return false;
  const wordSpan = typeof target.closest === 'function'
    ? (target.closest('.transcript-word') as HTMLElement | null)
    : (target.classList?.contains?.('transcript-word') ? target : null);
  if (wordSpan) {
    const idx = parseInt(wordSpan.dataset?.wordIdx ?? '', 10);
    if (approveWord) {
      const lineObj = resolveLineForCard(cardEl);
      if (lineObj && !Number.isNaN(idx)) {
        markConfidenceWordReviewed(lineObj.id, idx);
      }
      return true;
    }
    enterCardEditMode(cardEl, Number.isNaN(idx) ? undefined : idx, true);
    return true;
  }
  const confView = typeof target.closest === 'function'
    ? (target.closest('.transcript-confidence-view') as HTMLElement | null)
    : (target.classList?.contains?.('transcript-confidence-view') ? target : null);
  if (confView) {
    if (approveWord) return true;
    enterCardEditMode(cardEl, undefined, false);
    return true;
  }
  return false;
}

function ensureViewportConfidenceDelegation(viewport: HTMLElement | null): void {
  if (!viewport) return;
  const vp = viewport as any;
  if (vp._hasConfidenceDelegation || typeof viewport.addEventListener !== 'function') return;
  vp._hasConfidenceDelegation = true;

  viewport.addEventListener('mousedown', (e: MouseEvent) => {
    if (!e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    if (target && typeof target.closest === 'function' && target.closest('.transcript-confidence-view')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  });

  viewport.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    if (!target.closest('.transcript-confidence-view')) return;
    const cardEl = target.closest('.transcript-card') as HTMLElement | null;
    if (!cardEl) return;
    if (!e.shiftKey && hasActiveTextSelection()) return;
    if (e.shiftKey && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    if (typeof e.stopPropagation === 'function') {
      e.stopPropagation();
    }
    handleConfidenceViewInteraction(cardEl, target, Boolean(e.shiftKey));
  });

  viewport.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList?.contains('transcript-word')) return;
    const cardEl = typeof target.closest === 'function'
      ? (target.closest('.transcript-card') as HTMLElement | null)
      : null;
    if (!cardEl) return;
    e.preventDefault();
    e.stopPropagation();
    handleConfidenceViewInteraction(cardEl, target, Boolean(e.shiftKey));
  });
}

export function setupTranscriptDirection(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const viewport = document.getElementById('transcript-viewport') as any;
  if (!viewport) return;
  ensureViewportConfidenceDelegation(viewport);
  syncConfidenceButtonAndReviewBar();
  if (viewport._hasDirectionListener) return;
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

  if (typeof window.addEventListener === 'function') {
    window.addEventListener('whisper:languageChanged', () => {
      const panel = typeof document !== 'undefined' ? document.getElementById('panel-transcribe') : null;
      if (panel && !panel.classList.contains('active')) return;
      viewport.querySelectorAll('.transcript-text-input').forEach((input: HTMLElement) => {
        applyTextDirection(input);
        autoResizeTranscriptField(input);
      });
    });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        viewport.querySelectorAll('.transcript-text-input').forEach((input: HTMLElement) => {
          autoResizeTranscriptField(input);
        });
      }, 100);
    });
  }
}

export function parseTranscriptTimeRange(timeRange: string): { raw: string; durLabel: string } {
  if (!timeRange) return { raw: '', durLabel: '' };
  const match = timeRange.match(/\[?(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:-->|→)\s*(\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)\]?/);
  if (match) {
    const start = match[1];
    const end = match[2];
    const toSec = (str: string) => {
      const parts = str.split(':');
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2].replace(',', '.'));
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
  (cardEl as any)._lineRef = lineObj;

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
      win.seekCompanionPlayer(startMs, true, lineObj.id);
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

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-card-action btn-card-delete';
  const deleteTitle = t('transcribe.deleteSegment') || 'Delete segment';
  deleteBtn.title = deleteTitle;
  deleteBtn.setAttribute('aria-label', deleteTitle);
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
      <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
    </svg>
  `;
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteTranscriptSegment(lineObj.id);
  };
  actionsWrap.appendChild(deleteBtn);

  headerEl.appendChild(actionsWrap);

  headerEl.onclick = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest('.btn-card-action')) return;
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs, undefined, lineObj.id);
    }
  };

  const bodyEl = document.createElement('div');
  bodyEl.className = 'transcript-card-body';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.className = 'transcript-text-input';
  textarea.value = lineObj.text;
  (textarea as any)._hasTyped = false;
  let sessionSnapshotTaken = false;
  applyTextDirection(textarea);
  textarea.onfocus = () => {
    sessionSnapshotTaken = false;
    const liveLine = resolveLineForCard(cardEl) || lineObj;
    (textarea as any)._preEditWords = Array.isArray(liveLine?.words)
      ? liveLine.words.map(w => ({ ...w }))
      : undefined;
    cardEl.classList.add('is-editing-text');
    autoResizeTranscriptField(textarea);
    const win = getGlobal();
    if (typeof win.highlightActiveTranscriptSegment === 'function') {
      win.highlightActiveTranscriptSegment(startMs / 1000, lineObj.id);
    }
  };
  textarea.oninput = () => {
    if (!sessionSnapshotTaken) {
      sessionSnapshotTaken = true;
      recordTranscriptHistorySnapshot('Text Edit');
    }
    (textarea as any)._hasTyped = true;
    const preEditWords = (textarea as any)._preEditWords as readonly WordToken[] | undefined;
    updateTranscriptLineText(lineObj.id, textarea.value, preEditWords);
  };
  textarea.onblur = () => {
    const didType = Boolean((textarea as any)._hasTyped);
    const exitingViaEscape = Boolean((textarea as any)._exitingViaEscape);
    const originWordIdx = (textarea as any)._editOriginWordIdx as number | undefined;
    (textarea as any)._hasTyped = false;
    (textarea as any)._exitingViaEscape = false;
    (textarea as any)._editOriginWordIdx = undefined;
    (textarea as any)._editOriginFlaggedIdx = undefined;
    (textarea as any)._preEditWords = undefined;
    sessionSnapshotTaken = false;
    cardEl.classList.remove('is-editing-text');
    if (confidenceHighlightingActive) {
      const prevFocusedWord = !didType
        ? (cardEl.querySelector('.transcript-word.confidence-word-focused') as HTMLElement | null)
        : null;
      const prevFocusedIdx = prevFocusedWord?.dataset?.wordIdx;
      const liveLine = resolveLineForCard(cardEl) || lineObj;
      if (didType) {
        reviewedSegmentIdsInSession.add(liveLine.id);
      }
      if (!hasTranscriptConfidenceData()) {
        toggleConfidenceHighlighting(false);
        return;
      }
      mountOrRefreshCardConfidenceView(cardEl, liveLine);
      let restoredWord: HTMLElement | null = null;
      if (prevFocusedIdx !== undefined && prevFocusedIdx !== '') {
        restoredWord = cardEl.querySelector(
          `.transcript-word.low-confidence[data-word-idx="${prevFocusedIdx}"]`
        ) as HTMLElement | null;
        if (restoredWord) {
          restoredWord.classList.add('confidence-word-focused');
        } else {
          activeConfidenceJumpIndex = -1;
        }
      }
      if (exitingViaEscape && typeof cardEl.querySelector === 'function') {
        const focusTarget =
          restoredWord ||
          (typeof originWordIdx === 'number'
            ? (cardEl.querySelector(`.transcript-word[data-word-idx="${originWordIdx}"]`) as HTMLElement | null)
            : null);
        if (focusTarget && typeof focusTarget.focus === 'function') {
          try {
            focusTarget.focus({ preventScroll: true });
          } catch (_) {
            focusTarget.focus();
          }
        }
      }
      syncConfidenceButtonAndReviewBar();
    }
  };
  textarea.onchange = () => {
    updateTranscriptLineText(lineObj.id, textarea.value);
    void flushPendingTranscriptEdits();
  };
  textarea.onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && confidenceHighlightingActive) {
      e.preventDefault();
      (textarea as any)._exitingViaEscape = true;
      try {
        if (typeof textarea.blur === 'function') {
          textarea.blur();
        }
      } finally {
        (textarea as any)._exitingViaEscape = false;
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      splitTranscriptSegment(lineObj.id, textarea.selectionStart);
    } else if (e.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0 && lineObj.id > 0) {
      e.preventDefault();
      mergeTranscriptSegmentWithPrevious(lineObj.id);
    } else if (e.key === 'Tab') {
      const allCards = Array.from(document.querySelectorAll('.transcript-card')) as HTMLElement[];
      const visibleCards = allCards.filter(c => c.style.display !== 'none');
      const currentCard = (e.target as HTMLElement).closest('.transcript-card') as HTMLElement;
      const currentIndex = visibleCards.indexOf(currentCard);
      if (currentIndex !== -1) {
        const nextCard = e.shiftKey ? visibleCards[currentIndex - 1] : visibleCards[currentIndex + 1];
        const targetInput = nextCard?.querySelector('.transcript-text-input') as HTMLTextAreaElement | null;
        if (nextCard && targetInput) {
          e.preventDefault();
          nextCard.classList.add('is-editing-text');
          autoResizeTranscriptField(targetInput);
          targetInput.focus();
        }
      }
    }
  };
  bodyEl.appendChild(textarea);

  cardEl.onmousedown = (e: MouseEvent) => {
    if (!e.shiftKey) return;
    const inViewport = typeof cardEl.closest === 'function' && cardEl.closest('#transcript-viewport');
    if (inViewport) return;
    const target = e.target as HTMLElement | null;
    if (target && typeof target.closest === 'function' && target.closest('.transcript-confidence-view')) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
    }
  };

  cardEl.onclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const isAction = typeof target?.closest === 'function' && target.closest('.btn-card-action');
    const isConfView = typeof target?.closest === 'function' &&
      (target.closest('.transcript-confidence-view') || target.closest('.transcript-words-bar'));
    const isTextarea = (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
      target?.tagName === 'TEXTAREA' ||
      target?.classList?.contains('transcript-text-input');
    const isHeader = typeof target?.closest === 'function' && target.closest('.transcript-card-header');
    if (isConfView) {
      // Handle standalone detached cards (viewport delegation handles mounted cards)
      const inViewport = typeof cardEl.closest === 'function' && cardEl.closest('#transcript-viewport');
      if (!inViewport && (e.shiftKey || !hasActiveTextSelection())) {
        if (e.shiftKey && typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        if (typeof e.stopPropagation === 'function') {
          e.stopPropagation();
        }
        handleConfidenceViewInteraction(cardEl, target, Boolean(e.shiftKey));
      }
      return;
    }
    if (isAction || isTextarea || isHeader) {
      return;
    }
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs, undefined, lineObj.id);
    }
  };

  cardEl.ondblclick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const isAction = typeof target?.closest === 'function' && target.closest('.btn-card-action');
    const isConfView = typeof target?.closest === 'function' &&
      (target.closest('.transcript-confidence-view') || target.closest('.transcript-words-bar'));
    const isTextarea = (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) ||
      target?.tagName === 'TEXTAREA' ||
      target?.classList?.contains('transcript-text-input');
    if (isAction || isConfView || isTextarea) {
      return;
    }
    const win = getGlobal();
    if (typeof win.seekCompanionPlayer === 'function') {
      win.seekCompanionPlayer(startMs, undefined, lineObj.id);
    }
  };

  cardEl.appendChild(headerEl);
  cardEl.appendChild(bodyEl);

  if (confidenceHighlightingActive) {
    mountOrRefreshCardConfidenceView(cardEl, lineObj);
  }

  return cardEl;
}

export function renderTranscriptLines(lines: TranscriptLine[], preserveScroll = true): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport) return;
  ensureViewportConfidenceDelegation(viewport);
  const vp = viewport as any;
  if (!preserveScroll && vp._scrollDebounce) {
    clearTimeout(vp._scrollDebounce);
    delete vp._scrollDebounce;
  }
  const prevScrollTop = preserveScroll ? viewport.scrollTop : 0;
  viewport.innerHTML = '';

  const placeholder = document.getElementById('transcript-placeholder');
  if (placeholder) placeholder.remove();

  const btnCopy = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;

  if (!lines || lines.length === 0) {
    viewport.innerHTML = `<div style="color: var(--color-text-dim); text-align: center; margin-top: 40px;" data-i18n="transcribe.noSegments">${escapeHTML(t('transcribe.noSegments') || 'No transcript segments generated yet.')}</div>`;
    if (btnCopy) btnCopy.disabled = true;
    if (confidenceHighlightingActive) {
      toggleConfidenceHighlighting(false);
    } else {
      syncConfidenceButtonAndReviewBar(lines);
    }
    updateUndoRedoButtonsUI();
    return;
  }

  if (btnCopy) btnCopy.disabled = false;

  const hasConfidenceData = transcriptHasConfidenceData(lines);
  if (confidenceHighlightingActive && !hasConfidenceData) {
    confidenceHighlightingActive = false;
    confidenceLowOnlyFilter = false;
    activeConfidenceJumpIndex = -1;
    pendingConfidenceJumpAnchor = null;
    reviewedSegmentIdsInSession.clear();
    const viewerCard = document.getElementById('transcribe-viewer-card');
    if (viewerCard) viewerCard.classList.remove('highlight-confidence-active');
    viewport.classList.remove('highlight-confidence-active');
  }

  updateUndoRedoButtonsUI();

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

  syncConfidenceButtonAndReviewBar(lines);

  if (prevScrollTop > 0) {
    viewport.scrollTop = prevScrollTop;
  }

  const searchInput = document.getElementById('transcript-search') as HTMLInputElement | null;
  if ((searchInput && searchInput.value.trim() !== '') || (confidenceHighlightingActive && confidenceLowOnlyFilter)) {
    filterTranscriptLines();
  }

  const win = getGlobal();
  if (typeof win.renderCompanionSubtitle === 'function') {
    win.renderCompanionSubtitle(true);
  }
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
  if (!filePath || !Array.isArray(lines)) return null;
  const ext = (filePath.split('.').pop() || '').toLowerCase();

  if (lines.length === 0) {
    if (ext === 'vtt') return 'WEBVTT\n\n';
    if (ext === 'csv') return 'start,end,text\n';
    if (ext === 'tsv') return 'start\tend\ttext\n';
    if (['srt', 'lrc', 'txt'].includes(ext)) return '';
    return null;
  }

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
  } else {
    if (Array.isArray(win.lastTranscribedOutputFiles)) {
      win.lastTranscribedOutputFiles.forEach((f: any) => {
        if (f && f.type !== 'translated') addIfSupported(f.path);
      });
    }
    addIfSupported(win.lastTranscribedSubtitlePath);
  }

  return Array.from(targets);
}

export async function persistTranscriptLinesToDisk(): Promise<void> {
  if (!transcriptDirty) return;
  const invoke = getTauriInvoke();
  if (!invoke) {
    transcriptDirty = false;
    pendingTranscriptTargetFiles = null;
    pendingTranscriptSnapshotLines = null;
    return;
  }

  const targetFiles = (pendingTranscriptTargetFiles && pendingTranscriptTargetFiles.length > 0)
    ? pendingTranscriptTargetFiles
    : collectActiveTranscriptTargetFiles();
  const linesSnapshot = (pendingTranscriptSnapshotLines && pendingTranscriptSnapshotLines.length > 0)
    ? pendingTranscriptSnapshotLines
    : cloneTranscriptLines(transcriptLines);

  pendingTranscriptTargetFiles = null;
  pendingTranscriptSnapshotLines = null;

  if (targetFiles.length === 0) {
    transcriptDirty = false;
    return;
  }

  transcriptDirty = false;

  let anySuccess = false;
  let errorCount = 0;
  for (const filePath of targetFiles) {
    const content = serializeTranscriptLinesForFile(linesSnapshot, filePath);
    if (content !== null) {
      try {
        await invoke('write_text_file_content', { filePath, content });
        anySuccess = true;
      } catch (err) {
        errorCount++;
        console.warn('Failed to persist transcript edits to file:', filePath, err);
      }
    }
  }

  // If writes were attempted and all failed, keep dirty flag so pending changes are not lost
  if (!anySuccess && errorCount > 0) {
    transcriptDirty = true;
  }
}

function scheduleTranscriptDiskSync(): void {
  transcriptDirty = true;
  if (!pendingTranscriptTargetFiles) {
    const currentTargets = collectActiveTranscriptTargetFiles();
    if (currentTargets.length > 0) {
      pendingTranscriptTargetFiles = currentTargets;
    }
  }
  pendingTranscriptSnapshotLines = cloneTranscriptLines(transcriptLines);
  if (transcriptSaveTimer !== null) {
    clearTimeout(transcriptSaveTimer);
  }
  transcriptSaveTimer = setTimeout(() => {
    transcriptSaveTimer = null;
    const runSave = async () => {
      if (inFlightSavePromise) {
        try {
          await inFlightSavePromise;
        } catch (_) {}
      }
      await persistTranscriptLinesToDisk();
    };
    inFlightSavePromise = runSave().finally(() => {
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

export function updateTranscriptLineText(
  id: number,
  value: string,
  baseWordsOverride?: readonly WordToken[]
): void {
  let changed = false;
  const line = transcriptLines.find(l => l.id === id);
  if (line) {
    if (line.text !== value) {
      changed = true;
      const { startMs, endMs } = extractLineStartEndMs(line, line.id);
      const sourceWords = baseWordsOverride ?? line.words;
      line.words = reconcileWordsAfterEdit(sourceWords, value, startMs, endMs);
    }
    line.text = value;
  }
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    const item = win.batchItems[win.activeBatchViewerIndex];
    if (item.transcriptLines) {
      const itemLine = item.transcriptLines.find((l: any) => l.id === id);
      if (itemLine) {
        if (itemLine.text !== value) {
          changed = true;
          const { startMs, endMs } = extractLineStartEndMs(itemLine, itemLine.id);
          itemLine.words = line?.words
            ? line.words.map(w => ({ ...w }))
            : reconcileWordsAfterEdit(baseWordsOverride ?? itemLine.words, value, startMs, endMs);
        }
        itemLine.text = value;
      }
    }
  }
  if (changed) {
    const cardEl = (typeof document !== 'undefined' && typeof document.querySelector === 'function')
      ? ((document.querySelector(`.transcript-card[data-id="${id}"]`) ||
          (typeof document.getElementById === 'function' ? document.getElementById(`transcript-card-${id}`) : null)) as HTMLElement | null)
      : null;

    if (confidenceHighlightingActive) {
      reviewedSegmentIdsInSession.add(id);
      const editingTextarea =
        cardEl && typeof cardEl.querySelector === 'function'
          ? (cardEl.querySelector('.transcript-text-input') as any)
          : null;
      const originFlaggedIdx = editingTextarea?._editOriginFlaggedIdx;
      if (typeof originFlaggedIdx === 'number' && originFlaggedIdx >= 0) {
        pendingConfidenceJumpAnchor = originFlaggedIdx;
      } else if (activeConfidenceJumpIndex >= 0) {
        pendingConfidenceJumpAnchor = activeConfidenceJumpIndex;
      }
      clearConfidenceWordFocusInViewport(pendingConfidenceJumpAnchor !== null);
    }
    if (cardEl && line) {
      if (confidenceHighlightingActive && !cardEl.classList.contains('is-editing-text')) {
        mountOrRefreshCardConfidenceView(cardEl, line);
      } else if (!line.words) {
        const existingView = cardEl.querySelector('.transcript-confidence-view') as HTMLElement | null;
        if (existingView) existingView.remove();
        cardEl.classList.remove('has-confidence-view');
      }
      syncCardConfidenceMeta(cardEl, line);
    }
    if (confidenceHighlightingActive && !hasTranscriptConfidenceData()) {
      if (!cardEl || !cardEl.classList.contains('is-editing-text')) {
        toggleConfidenceHighlighting(false);
      } else {
        syncConfidenceButtonAndReviewBar();
      }
    } else {
      syncConfidenceButtonAndReviewBar();
    }
    transcriptDirty = true;
    scheduleTranscriptDiskSync();
    if (typeof win.renderCompanionSubtitle === 'function') {
      win.renderCompanionSubtitle(true);
    }
  }
}

export function hasTranscriptConfidenceData(lines: readonly TranscriptLine[] = transcriptLines): boolean {
  return transcriptHasConfidenceData(lines);
}

export function getConfidenceThreshold(): number {
  return confidenceThresholdPercent;
}

export function isConfidenceHighlightingActive(): boolean {
  return confidenceHighlightingActive;
}

export function isConfidenceLowOnlyFilterActive(): boolean {
  return confidenceLowOnlyFilter;
}

function refreshAllRenderedConfidenceViews(): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport) return;
  const cards = Array.from(viewport.querySelectorAll('.transcript-card')) as HTMLElement[];
  cards.forEach(cardEl => {
    const lineObj = resolveLineForCard(cardEl);
    if (!lineObj) return;
    if (!confidenceHighlightingActive) {
      cardEl.classList.remove('is-editing-text');
    }
    mountOrRefreshCardConfidenceView(cardEl, lineObj);
  });
}

function getVisibleFlaggedWordElements(viewport: HTMLElement | null): HTMLElement[] {
  if (!viewport || typeof viewport.querySelectorAll !== 'function') return [];
  const allFlagged = Array.from(viewport.querySelectorAll('.transcript-word.low-confidence')) as HTMLElement[];
  return allFlagged.filter(el => {
    const card = typeof el.closest === 'function' ? (el.closest('.transcript-card') as HTMLElement | null) : null;
    return !card || card.style.display !== 'none';
  });
}

function syncConfidenceJumpControls(fallbackCount?: number): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const viewport = document.getElementById('transcript-viewport');
  const prevBtn = document.getElementById('btn-confidence-prev') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('btn-confidence-next') as HTMLButtonElement | null;
  const counterEl = document.getElementById('confidence-jump-counter') as HTMLElement | null;

  let visibleCount = typeof fallbackCount === 'number' ? fallbackCount : 0;
  if (confidenceHighlightingActive && viewport && typeof viewport.querySelectorAll === 'function') {
    const hasCards = viewport.querySelectorAll('.transcript-card').length > 0;
    if (hasCards) {
      visibleCount = getVisibleFlaggedWordElements(viewport).length;
    } else if (typeof fallbackCount !== 'number') {
      visibleCount = computeConfidenceSummary(transcriptLines, confidenceThresholdPercent).lowWordCount;
    }
  } else if (typeof fallbackCount !== 'number') {
    visibleCount = computeConfidenceSummary(transcriptLines, confidenceThresholdPercent).lowWordCount;
  }

  const disableJump = !confidenceHighlightingActive || visibleCount === 0;
  if (prevBtn) prevBtn.disabled = disableJump;
  if (nextBtn) nextBtn.disabled = disableJump;

  if (disableJump || activeConfidenceJumpIndex >= visibleCount) {
    activeConfidenceJumpIndex = -1;
  }

  if (counterEl) {
    if (!disableJump && activeConfidenceJumpIndex >= 0) {
      counterEl.textContent = `${activeConfidenceJumpIndex + 1} / ${visibleCount}`;
      counterEl.hidden = false;
    } else {
      counterEl.textContent = '';
      counterEl.hidden = true;
    }
  }
}

export function syncConfidenceButtonAndReviewBar(lines: readonly TranscriptLine[] = transcriptLines): void {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const summary = computeConfidenceSummary(lines, confidenceThresholdPercent);
  const win = getGlobal();
  const isRunning = Boolean(win?.isTranscribing || win?.isBatchExtracting);

  const btn = document.getElementById('btn-toggle-confidence') as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = isRunning || !summary.hasConfidenceData;
    btn.setAttribute('aria-pressed', String(!isRunning && confidenceHighlightingActive));
    if (!isRunning && confidenceHighlightingActive) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
    const tooltipText = summary.hasConfidenceData
      ? (t('transcribe.toggleConfidenceTooltip', { threshold: confidenceThresholdPercent }) ||
          `Highlight uncertain words (below ${confidenceThresholdPercent}%)`)
      : (t('transcribe.confidenceUnavailableTooltip') ||
          'Word-level confidence data is unavailable for this transcript');
    btn.title = tooltipText;
  }

  const btnBadge = document.getElementById('confidence-btn-badge');
  if (btnBadge) {
    if (!isRunning && summary.hasConfidenceData && summary.lowWordCount > 0) {
      btnBadge.textContent = String(summary.lowWordCount);
      btnBadge.style.display = '';
      btnBadge.classList.toggle('is-critical', summary.criticalWordCount > 0);
    } else {
      btnBadge.textContent = '';
      btnBadge.style.display = 'none';
      btnBadge.classList.remove('is-critical');
    }
  }

  const reviewBar = document.getElementById('confidence-review-bar') as HTMLElement | null;
  if (reviewBar) {
    const showBar = !isRunning && confidenceHighlightingActive && summary.hasConfidenceData;
    reviewBar.hidden = !showBar;
    reviewBar.dataset.state = showBar ? 'open' : 'closed';
  }

  const statusKey = summary.lowWordCount > 0
    ? (summary.criticalWordCount > 0 ? 'critical' : 'low')
    : 'ok';

  const statusWrap = document.getElementById('confidence-review-status');
  if (statusWrap) {
    statusWrap.dataset.status = statusKey;
  }

  const summaryEl = document.getElementById('confidence-review-summary');
  if (summaryEl) {
    if (summary.lowWordCount > 0) {
      summaryEl.textContent =
        t('transcribe.confidenceReviewSummary', {
          words: summary.lowWordCount,
          segments: summary.flaggedSegmentCount
        }) || `${summary.lowWordCount} uncertain in ${summary.flaggedSegmentCount} segments`;
    } else {
      summaryEl.textContent =
        t('transcribe.confidenceAllClear', { threshold: confidenceThresholdPercent }) ||
        'No uncertain words';
    }
    summaryEl.dataset.status = statusKey;
  }

  const quickSelect = document.getElementById('confidence-threshold-quick') as HTMLSelectElement | null;
  if (quickSelect) {
    if (quickSelect.value !== String(confidenceThresholdPercent)) {
      quickSelect.value = String(confidenceThresholdPercent);
    }
    const win = getGlobal();
    const csMap = win?.customSelectsMap;
    if (csMap && typeof csMap.get === 'function') {
      const cs = csMap.get('confidence-threshold-quick');
      if (cs && typeof cs.syncSelectedValue === 'function') {
        cs.syncSelectedValue();
      }
    }
  }

  const filterBtn = document.getElementById('btn-confidence-filter-low') as HTMLButtonElement | null;
  if (filterBtn) {
    filterBtn.classList.toggle('active', confidenceLowOnlyFilter);
    filterBtn.setAttribute('aria-pressed', String(confidenceLowOnlyFilter));
    filterBtn.disabled = !summary.hasConfidenceData || (summary.lowWordCount === 0 && !confidenceLowOnlyFilter);
  }

  syncConfidenceJumpControls(summary.lowWordCount);
}

export function setConfidenceThreshold(percent: number, persist = true): number {
  const clamped = clampConfidenceThreshold(percent);
  const changed = clamped !== confidenceThresholdPercent;
  confidenceThresholdPercent = clamped;
  if (changed) {
    activeConfidenceJumpIndex = -1;
    pendingConfidenceJumpAnchor = null;
  }

  if (changed && confidenceHighlightingActive) {
    refreshAllRenderedConfidenceViews();
    if (confidenceLowOnlyFilter) {
      filterTranscriptLines();
    }
  }
  syncConfidenceButtonAndReviewBar();

  if (persist) {
    const win = getGlobal();
    if (typeof win.setConfidenceThresholdPreference === 'function') {
      win.setConfidenceThresholdPreference(clamped, true);
    }
  }

  return clamped;
}

export function toggleConfidenceLowOnlyFilter(forceState?: boolean): boolean {
  const next = typeof forceState === 'boolean' ? forceState : !confidenceLowOnlyFilter;
  confidenceLowOnlyFilter = next;
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  if (!confidenceLowOnlyFilter) {
    reviewedSegmentIdsInSession.clear();
    if (confidenceHighlightingActive) {
      refreshAllRenderedConfidenceViews();
    }
  }
  syncConfidenceButtonAndReviewBar();
  filterTranscriptLines();
  return confidenceLowOnlyFilter;
}

export function markConfidenceWordReviewed(lineId: number, wordIdx: number): boolean {
  const line = transcriptLines.find(l => l.id === lineId);
  if (!line || !Array.isArray(line.words)) return false;
  const word = line.words[wordIdx];
  if (!word || word.reviewed) return false;
  if (classifyWordConfidence(word.prob, confidenceThresholdPercent) === 'ok') return false;

  const updatedWords = markWordAsReviewed(line.words, wordIdx);
  if (!updatedWords) return false;

  // Capture the approved word's index among visible flagged words BEFORE refreshing DOM
  // so subsequent Alt+Down / Alt+Up continues cleanly from this position instead of resetting to #1.
  const removedFlaggedIndex = findVisibleFlaggedWordIndex(lineId, wordIdx);

  recordTranscriptHistorySnapshot('Review Word');
  line.words = updatedWords;

  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    const item = win.batchItems[win.activeBatchViewerIndex];
    const itemLine = item?.transcriptLines?.find((l: any) => l.id === lineId);
    if (itemLine) {
      itemLine.words = updatedWords.map(w => ({ ...w }));
    }
  }

  reviewedSegmentIdsInSession.add(lineId);
  if (removedFlaggedIndex >= 0) {
    pendingConfidenceJumpAnchor = removedFlaggedIndex;
  } else if (activeConfidenceJumpIndex >= 0) {
    pendingConfidenceJumpAnchor = activeConfidenceJumpIndex;
  }
  clearConfidenceWordFocusInViewport(pendingConfidenceJumpAnchor !== null);

  if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
    const cardEl = (document.querySelector(`.transcript-card[data-id="${lineId}"]`) ||
      (typeof document.getElementById === 'function' ? document.getElementById(`transcript-card-${lineId}`) : null)) as HTMLElement | null;
    if (cardEl) {
      const activeEl = typeof document.activeElement !== 'undefined' ? document.activeElement : null;
      const hadFocusInCard = Boolean(
        activeEl &&
        (activeEl === cardEl ||
          (typeof cardEl.contains === 'function' && cardEl.contains(activeEl)) ||
          (typeof (activeEl as HTMLElement).closest === 'function' && (activeEl as HTMLElement).closest('.transcript-card') === cardEl))
      );
      mountOrRefreshCardConfidenceView(cardEl, line);
      if (hadFocusInCard && typeof cardEl.querySelector === 'function') {
        const restoredWordEl = cardEl.querySelector(`.transcript-word[data-word-idx="${wordIdx}"]`) as HTMLElement | null;
        if (restoredWordEl && typeof restoredWordEl.focus === 'function') {
          try {
            restoredWordEl.focus({ preventScroll: true });
          } catch (_) {
            restoredWordEl.focus();
          }
        }
      }
    }
  }

  syncConfidenceButtonAndReviewBar();
  return true;
}

export function jumpToConfidenceWord(direction: 1 | -1 = 1): boolean {
  if (typeof document === 'undefined' || !confidenceHighlightingActive) return false;
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport) return false;

  // Exit any card currently in inline edit mode so highlighted words are visible and reachable
  if (typeof viewport.querySelectorAll === 'function') {
    const editingCards = Array.from(viewport.querySelectorAll('.transcript-card.is-editing-text')) as HTMLElement[];
    editingCards.forEach(cardEl => {
      const textarea = cardEl.querySelector('.transcript-text-input') as HTMLTextAreaElement | null;
      if (textarea && typeof textarea.blur === 'function' && document.activeElement === textarea) {
        textarea.blur();
      }
      if (cardEl.classList.contains('is-editing-text')) {
        cardEl.classList.remove('is-editing-text');
        const liveLine = resolveLineForCard(cardEl);
        if (liveLine) {
          mountOrRefreshCardConfidenceView(cardEl, liveLine);
        }
      }
    });
  }

  const visibleFlagged = getVisibleFlaggedWordElements(viewport);

  if (visibleFlagged.length === 0) {
    activeConfidenceJumpIndex = -1;
    pendingConfidenceJumpAnchor = null;
    syncConfidenceJumpControls(0);
    return false;
  }

  viewport.querySelectorAll('.transcript-word.confidence-word-focused').forEach(el => {
    el.classList.remove('confidence-word-focused');
  });

  if (activeConfidenceJumpIndex < 0 || activeConfidenceJumpIndex >= visibleFlagged.length) {
    if (pendingConfidenceJumpAnchor !== null) {
      const anchor = Math.max(0, Math.min(visibleFlagged.length, pendingConfidenceJumpAnchor));
      activeConfidenceJumpIndex = direction >= 0
        ? (anchor % visibleFlagged.length)
        : ((anchor - 1 + visibleFlagged.length) % visibleFlagged.length);
      pendingConfidenceJumpAnchor = null;
    } else {
      activeConfidenceJumpIndex = direction >= 0 ? 0 : visibleFlagged.length - 1;
    }
  } else {
    pendingConfidenceJumpAnchor = null;
    activeConfidenceJumpIndex = (activeConfidenceJumpIndex + direction + visibleFlagged.length) % visibleFlagged.length;
  }

  const targetWordEl = visibleFlagged[activeConfidenceJumpIndex];
  targetWordEl.classList.add('confidence-word-focused');
  syncConfidenceJumpControls(visibleFlagged.length);

  const activeEl = typeof document.activeElement !== 'undefined' ? document.activeElement : null;
  const isStepperBtnFocused = Boolean(
    activeEl && (activeEl.id === 'btn-confidence-prev' || activeEl.id === 'btn-confidence-next')
  );
  if (!isStepperBtnFocused && typeof targetWordEl.focus === 'function') {
    try {
      targetWordEl.focus({ preventScroll: true });
    } catch (_) {
      targetWordEl.focus();
    }
  }

  const targetCard = typeof targetWordEl.closest === 'function'
    ? (targetWordEl.closest('.transcript-card') as HTMLElement | null)
    : null;

  if (targetCard) {
    if (typeof targetCard.scrollIntoView === 'function') {
      targetCard.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'center' });
    }
    const lineObj = resolveLineForCard(targetCard);
    const wordIdx = parseInt(targetWordEl.dataset?.wordIdx ?? '', 10);
    if (lineObj && !Number.isNaN(wordIdx) && Array.isArray(lineObj.words) && lineObj.words[wordIdx]) {
      const { startMs } = extractLineStartEndMs(lineObj, lineObj.id);
      const seekMs = computeWordSeekMs(lineObj.words[wordIdx].startMs, startMs);
      const win = getGlobal();
      if (typeof win.seekCompanionPlayer === 'function') {
        win.seekCompanionPlayer(seekMs, undefined, lineObj.id);
      } else if (typeof win.highlightActiveTranscriptSegment === 'function') {
        win.highlightActiveTranscriptSegment(seekMs / 1000, lineObj.id);
      }
    }
  }

  return true;
}

export function toggleConfidenceHighlighting(forceState?: boolean): boolean {
  confidenceHighlightingActive = typeof forceState === 'boolean' ? forceState : !confidenceHighlightingActive;
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;

  if (!confidenceHighlightingActive) {
    confidenceLowOnlyFilter = false;
    reviewedSegmentIdsInSession.clear();
  }

  if (typeof document !== 'undefined') {
    const viewerCard = document.getElementById('transcribe-viewer-card');
    const viewport = document.getElementById('transcript-viewport');
    if (viewerCard) {
      viewerCard.classList.toggle('highlight-confidence-active', confidenceHighlightingActive);
    }
    if (viewport) {
      viewport.classList.toggle('highlight-confidence-active', confidenceHighlightingActive);
      viewport.querySelectorAll('.transcript-word.confidence-word-focused').forEach(el => {
        el.classList.remove('confidence-word-focused');
      });
    }
    refreshAllRenderedConfidenceViews();
    if (!confidenceHighlightingActive && viewport) {
      viewport.querySelectorAll('.transcript-text-input').forEach((input: any) => {
        autoResizeTranscriptField(input);
      });
    }
    syncConfidenceButtonAndReviewBar();
    filterTranscriptLines();
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
    const cardEl = document.querySelector(`.transcript-card[data-id="${line.id}"]`);
    const domTextarea = (cardEl ? cardEl.querySelector('.transcript-text-input') : null) as HTMLTextAreaElement | null;
    if (domTextarea && (domTextarea.tagName === 'TEXTAREA' || domTextarea.classList?.contains?.('transcript-text-input')) && typeof domTextarea.value === 'string') {
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
  if (!leftText || !rightText) return false;

  recordTranscriptHistorySnapshot('Split');

  let splitEndMs = startMs;
  let splitStartMs = endMs;
  let leftWords: WordToken[] | undefined;
  let rightWords: WordToken[] | undefined;

  if (Array.isArray(line.words) && line.words.length >= 1) {
    let searchIdx = 0;
    let splitWordIdx = -1;
    let splitInsideWord = false;
    let splitWordStartPos = 0;
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
          splitInsideWord = splitPos > foundPos && splitPos < wordEndPos;
          splitWordStartPos = foundPos;
          break;
        }
      }
    }
    if (splitWordIdx === -1 && searchIdx > 0 && splitPos >= searchIdx) {
      splitWordIdx = line.words.length - 1;
    }

    if (splitWordIdx === -1) {
      const ratio = Math.max(0.05, Math.min(0.95, splitPos / Math.max(1, fullText.length)));
      const mid = Math.round(startMs + ratio * Math.max(0, endMs - startMs));
      splitEndMs = mid;
      splitStartMs = mid;
      leftWords = undefined;
      rightWords = undefined;
    } else if (splitInsideWord) {
      const splitWord = line.words[splitWordIdx];
      const wordLen = Math.max(1, splitWord.text.trim().length);
      const localOffset = Math.max(1, Math.min(wordLen - 1, splitPos - splitWordStartPos));
      const midMs = Math.round(
        splitWord.startMs + (localOffset / wordLen) * Math.max(0, splitWord.endMs - splitWord.startMs)
      );
      splitEndMs = Math.min(endMs, Math.max(startMs, midMs));
      splitStartMs = splitEndMs;
      const leftPrevWords = line.words.slice(0, splitWordIdx + 1).map((w, idx, arr) =>
        idx === arr.length - 1 ? { ...w, endMs: splitEndMs } : { ...w }
      );
      const rightPrevWords = line.words.slice(splitWordIdx).map((w, idx) =>
        idx === 0 ? { ...w, startMs: splitStartMs } : { ...w }
      );
      leftWords = reconcileWordsAfterEdit(leftPrevWords, leftText, startMs, splitEndMs);
      rightWords = reconcileWordsAfterEdit(rightPrevWords, rightText, splitStartMs, endMs);
    } else {
      leftWords = line.words.slice(0, splitWordIdx + 1).map(w => ({ ...w }));
      rightWords = line.words.slice(splitWordIdx + 1).map(w => ({ ...w }));
      if (leftWords.length > 0 && rightWords.length > 0) {
        splitEndMs = leftWords[leftWords.length - 1].endMs;
        splitStartMs = rightWords[0].startMs;
        const leftJoined = leftWords.map(w => w.text.trim()).filter(Boolean).join(' ');
        const rightJoined = rightWords.map(w => w.text.trim()).filter(Boolean).join(' ');
        const normLeft = leftText.split(/\s+/).filter(Boolean).join(' ');
        const normRight = rightText.split(/\s+/).filter(Boolean).join(' ');
        if (leftJoined !== normLeft || rightJoined !== normRight) {
          leftWords = undefined;
          rightWords = undefined;
        }
      } else {
        const ratio = Math.max(0.05, Math.min(0.95, splitPos / Math.max(1, fullText.length)));
        const mid = Math.round(startMs + ratio * Math.max(0, endMs - startMs));
        splitEndMs = mid;
        splitStartMs = mid;
        leftWords = undefined;
        rightWords = undefined;
      }
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
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  transcriptDirty = true;

  // Sync batch mode if active
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = cloneTranscriptLines(transcriptLines);
  }

  renderTranscriptLines(transcriptLines);

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const nextInput = document.querySelector(`.transcript-card[data-id="${index + 1}"] .transcript-text-input`) as HTMLTextAreaElement | null;
      if (nextInput && typeof nextInput.focus === 'function') {
        const card = nextInput.closest('.transcript-card') as HTMLElement | null;
        if (card && card.style.display === 'none') {
          return;
        }
        if (card) {
          card.classList.add('is-editing-text');
        }
        autoResizeTranscriptField(nextInput);
        nextInput.focus();
        if (typeof nextInput.setSelectionRange === 'function') {
          nextInput.setSelectionRange(0, 0);
        }
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'nearest' });
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
    const currCard = document.querySelector(`.transcript-card[data-id="${currLine.id}"]`);
    const prevCard = document.querySelector(`.transcript-card[data-id="${prevLine.id}"]`);
    const currTextarea = (currCard ? currCard.querySelector('.transcript-text-input') : null) as HTMLTextAreaElement | null;
    const prevTextarea = (prevCard ? prevCard.querySelector('.transcript-text-input') : null) as HTMLTextAreaElement | null;
    if (currTextarea && (currTextarea.tagName === 'TEXTAREA' || currTextarea.classList?.contains?.('transcript-text-input')) && typeof currTextarea.value === 'string') {
      currText = currTextarea.value;
    }
    if (prevTextarea && (prevTextarea.tagName === 'TEXTAREA' || prevTextarea.classList?.contains?.('transcript-text-input')) && typeof prevTextarea.value === 'string') {
      prevText = prevTextarea.value;
    }
  }

  currLine.text = currText;
  prevLine.text = prevText;

  const prevLen = prevText.length;
  let mergedText = prevText.trim();
  if (currText.trim()) {
    mergedText = mergedText ? `${mergedText} ${currText.trim()}` : currText.trim();
  }

  let mergedWords: WordToken[] | undefined;
  if (Array.isArray(prevLine.words) && Array.isArray(currLine.words)) {
    mergedWords = [...prevLine.words, ...currLine.words];
  } else {
    mergedWords = undefined;
  }

  recordTranscriptHistorySnapshot('Merge');

  prevLine.text = mergedText;
  prevLine.startMs = unifiedStartMs;
  prevLine.endMs = unifiedEndMs;
  prevLine.timeRange = `[${formatMsToTimestamp(unifiedStartMs)} --> ${formatMsToTimestamp(unifiedEndMs)}]`;
  prevLine.words = mergedWords;

  transcriptLines.splice(index, 1);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  transcriptDirty = true;

  // Sync batch mode if active
  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = cloneTranscriptLines(transcriptLines);
  }

  renderTranscriptLines(transcriptLines);

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const prevInput = document.querySelector(`.transcript-card[data-id="${index - 1}"] .transcript-text-input`) as HTMLTextAreaElement | null;
      if (prevInput && typeof prevInput.focus === 'function') {
        const card = prevInput.closest('.transcript-card') as HTMLElement | null;
        if (card && card.style.display === 'none') {
          return;
        }
        if (card) {
          card.classList.add('is-editing-text');
        }
        autoResizeTranscriptField(prevInput);
        prevInput.focus();
        if (typeof prevInput.setSelectionRange === 'function') {
          const targetPos = Math.min(mergedText.length, prevLen + 1);
          prevInput.setSelectionRange(targetPos, targetPos);
        }
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'nearest' });
        }
      }
    }
  }, 30);

  scheduleTranscriptDiskSync();
  return true;
}

export function recordTranscriptHistorySnapshot(description = 'Edit'): void {
  const snapshot: TranscriptLine[] = cloneTranscriptLines(transcriptLines);
  undoStack.push({ lines: snapshot, description });
  if (undoStack.length > MAX_UNDO_DEPTH) {
    undoStack.shift();
  }
  redoStack.length = 0;
  updateUndoRedoButtonsUI();
}

export function canUndoTranscript(): boolean {
  return undoStack.length > 0;
}

export function canRedoTranscript(): boolean {
  return redoStack.length > 0;
}

export function clearTranscriptHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoRedoButtonsUI();
}

export function getTranscriptHistory(): { undoStack: UndoHistoryEntry[]; redoStack: UndoHistoryEntry[] } {
  return {
    undoStack: undoStack.map(entry => ({
      description: entry.description,
      lines: cloneTranscriptLines(entry.lines)
    })),
    redoStack: redoStack.map(entry => ({
      description: entry.description,
      lines: cloneTranscriptLines(entry.lines)
    }))
  };
}

export function setTranscriptHistory(history?: { undoStack?: UndoHistoryEntry[]; redoStack?: UndoHistoryEntry[] } | null): void {
  undoStack.length = 0;
  redoStack.length = 0;
  if (history && Array.isArray(history.undoStack)) {
    history.undoStack.forEach(entry => {
      undoStack.push({
        description: entry.description,
        lines: cloneTranscriptLines(entry.lines)
      });
    });
  }
  if (history && Array.isArray(history.redoStack)) {
    history.redoStack.forEach(entry => {
      redoStack.push({
        description: entry.description,
        lines: cloneTranscriptLines(entry.lines)
      });
    });
  }
  updateUndoRedoButtonsUI();
}

export function updateUndoRedoButtonsUI(): void {
  if (typeof document === 'undefined') return;
  const undoBtn = document.getElementById('btn-undo-transcript') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('btn-redo-transcript') as HTMLButtonElement | null;
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

export function undoTranscriptOperation(): boolean {
  if (undoStack.length === 0) return false;
  const currentSnapshot: TranscriptLine[] = cloneTranscriptLines(transcriptLines);
  redoStack.push({ lines: currentSnapshot, description: 'Revert' });
  if (redoStack.length > MAX_UNDO_DEPTH) {
    redoStack.shift();
  }

  const previous = undoStack.pop()!;
  transcriptLines = cloneTranscriptLines(previous.lines);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  transcriptDirty = true;

  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = cloneTranscriptLines(transcriptLines);
  }

  renderTranscriptLines(transcriptLines);
  scheduleTranscriptDiskSync();
  updateUndoRedoButtonsUI();
  return true;
}

export function redoTranscriptOperation(): boolean {
  if (redoStack.length === 0) return false;
  const currentSnapshot: TranscriptLine[] = cloneTranscriptLines(transcriptLines);
  undoStack.push({ lines: currentSnapshot, description: 'Undo' });
  if (undoStack.length > MAX_UNDO_DEPTH) {
    undoStack.shift();
  }

  const next = redoStack.pop()!;
  transcriptLines = cloneTranscriptLines(next.lines);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  transcriptDirty = true;

  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = cloneTranscriptLines(transcriptLines);
  }

  renderTranscriptLines(transcriptLines);
  scheduleTranscriptDiskSync();
  updateUndoRedoButtonsUI();
  return true;
}

export function deleteTranscriptSegment(lineId: number): boolean {
  const index = transcriptLines.findIndex(l => l.id === lineId);
  if (index === -1) return false;

  recordTranscriptHistorySnapshot('Delete');

  transcriptLines.splice(index, 1);
  transcriptLines.forEach((l, idx) => { l.id = idx; });
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  transcriptDirty = true;

  const win = getGlobal();
  if (win.isBatchMode && win.activeBatchViewerIndex >= 0 && win.batchItems && win.batchItems[win.activeBatchViewerIndex]) {
    win.batchItems[win.activeBatchViewerIndex].transcriptLines = cloneTranscriptLines(transcriptLines);
  }

  renderTranscriptLines(transcriptLines);

  setTimeout(() => {
    if (typeof document !== 'undefined') {
      const targetIndex = Math.min(index, transcriptLines.length - 1);
      if (targetIndex >= 0) {
        const card = (document.querySelector(`.transcript-card[data-id="${targetIndex}"]`) ||
          (typeof document.getElementById === 'function' ? document.getElementById(`transcript-card-${targetIndex}`) : null)) as HTMLElement | null;
        if (card && card.style.display === 'none') {
          return;
        }
        if (confidenceHighlightingActive && card?.classList?.contains('has-confidence-view')) {
          const focusWord = (card.querySelector('.transcript-word.low-confidence') ||
            card.querySelector('.transcript-word')) as HTMLElement | null;
          if (focusWord && typeof focusWord.focus === 'function') {
            try {
              focusWord.focus({ preventScroll: true });
            } catch (_) {
              focusWord.focus();
            }
          }
          if (typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'nearest' });
          }
          return;
        }
        const targetInput = (card
          ? card.querySelector('.transcript-text-input')
          : document.querySelector(`.transcript-card[data-id="${targetIndex}"] .transcript-text-input`)) as HTMLTextAreaElement | null;
        if (targetInput && typeof targetInput.focus === 'function') {
          const targetCard = card || (typeof targetInput.closest === 'function' ? (targetInput.closest('.transcript-card') as HTMLElement | null) : null);
          if (targetCard && targetCard.style.display === 'none') {
            return;
          }
          targetInput.focus();
          if (targetCard && typeof targetCard.scrollIntoView === 'function') {
            targetCard.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: 'nearest' });
          }
        }
      }
    }
  }, 30);

  scheduleTranscriptDiskSync();
  return true;
}

function normalizeSearchText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[\u200C\u200B]/g, '')
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterTranscriptLines(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('transcript-search') as HTMLInputElement | null;
  const win = getGlobal();
  if (searchInput && win.applyDynamicDirection) {
    win.applyDynamicDirection(searchInput);
  }
  const rawQuery = searchInput ? searchInput.value.trim() : '';
  const query = normalizeSearchText(rawQuery);
  const queryNoSpace = query.replace(/\s+/g, '');
  const applyLowOnly = confidenceHighlightingActive && confidenceLowOnlyFilter;
  const lines = document.querySelectorAll('.transcript-line');
  const viewport = document.getElementById('transcript-viewport');
  let matchCount = 0;

  lines.forEach((lineEl: any) => {
    const textInput = lineEl.querySelector('.transcript-text-input');
    if (textInput) {
      const normText = normalizeSearchText(textInput.value);
      const matchesSearch = !query ||
        normText.includes(query) ||
        (queryNoSpace.length >= 2 && normText.replace(/\s+/g, '').includes(queryNoSpace));

      let matchesConfidence = true;
      if (applyLowOnly) {
        const lineObj = resolveLineForCard(lineEl);
        const evalRes = evaluateLineConfidence(lineObj, confidenceThresholdPercent);
        const keepEditedVisible =
          (lineObj ? reviewedSegmentIdsInSession.has(lineObj.id) : false) ||
          Boolean(lineEl.classList?.contains('is-editing-text'));
        matchesConfidence = evalRes.flaggedCount > 0 || keepEditedVisible;
      }

      const match = matchesSearch && matchesConfidence;
      lineEl.style.display = match ? 'flex' : 'none';
      if (match) {
        matchCount++;
        autoResizeTranscriptField(textInput);
      }
    }
  });

  if (viewport && typeof viewport.querySelectorAll === 'function') {
    activeConfidenceJumpIndex = -1;
    pendingConfidenceJumpAnchor = null;
    viewport.querySelectorAll('.transcript-word.confidence-word-focused').forEach(el => {
      el.classList.remove('confidence-word-focused');
    });
  }

  if (viewport && lines.length > 0) {
    let emptySearchEl =
      document.getElementById('transcript-search-empty') ||
      (typeof viewport.querySelector === 'function'
        ? (viewport.querySelector('.transcript-empty-notice') as HTMLElement | null)
        : null);
    if ((query || applyLowOnly) && matchCount === 0) {
      if (!emptySearchEl) {
        emptySearchEl = document.createElement('div');
        emptySearchEl.id = 'transcript-search-empty';
        emptySearchEl.className = 'transcript-empty-notice';
        viewport.appendChild(emptySearchEl);
      }
      emptySearchEl.innerHTML = '';
      if (applyLowOnly && !query) {
        emptySearchEl.className = 'transcript-empty-notice transcript-empty-notice--confidence';
        emptySearchEl.removeAttribute('data-i18n');

        const iconWrap = document.createElement('div');
        iconWrap.className = 'transcript-empty-notice-icon';
        iconWrap.setAttribute('aria-hidden', 'true');
        iconWrap.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        `;

        const titleEl = document.createElement('div');
        titleEl.className = 'transcript-empty-notice-title';
        titleEl.textContent =
          t('transcribe.confidenceAllClear', { threshold: confidenceThresholdPercent }) ||
          'No uncertain words';

        const descEl = document.createElement('div');
        descEl.className = 'transcript-empty-notice-desc';
        descEl.textContent =
          t('transcribe.confidenceAllClearDesc', { threshold: confidenceThresholdPercent }) ||
          `All words are above the ${confidenceThresholdPercent}% threshold.`;

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'btn-secondary transcript-empty-reset-btn';
        resetBtn.textContent =
          t('transcribe.confidenceShowAllSegments') || 'Show all segments';
        resetBtn.onclick = () => {
          toggleConfidenceLowOnlyFilter(false);
        };

        emptySearchEl.appendChild(iconWrap);
        emptySearchEl.appendChild(titleEl);
        emptySearchEl.appendChild(descEl);
        emptySearchEl.appendChild(resetBtn);
      } else {
        emptySearchEl.className = 'transcript-empty-notice transcript-empty-notice--search';
        emptySearchEl.setAttribute('data-i18n', 'transcribe.noMatchingTranscript');
        emptySearchEl.textContent = t('transcribe.noMatchingTranscript') || 'No matching transcript lines found.';
      }
      emptySearchEl.style.display = 'flex';
    } else if (emptySearchEl) {
      emptySearchEl.style.display = 'none';
    }
  }

  if (confidenceHighlightingActive) {
    syncConfidenceJumpControls();
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

export function aggregateTokensIntoWords(
  tokens: any[],
  segStartMs: number,
  segEndMs: number,
  cleanText?: string
): WordToken[] {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];

  const validTokens: Array<{ text: string; startMs: number; endMs: number; prob: number }> = [];
  for (const tok of tokens) {
    const rawTok = tok.text || '';
    if (!rawTok || rawTok.startsWith('[_') || rawTok.startsWith('<|')) continue;
    const tokStart = (tok.offsets && typeof tok.offsets.from === 'number')
      ? tok.offsets.from
      : (parseTimestampStringToMs(tok.timestamps?.from) ?? segStartMs);
    const tokEnd = (tok.offsets && typeof tok.offsets.to === 'number')
      ? tok.offsets.to
      : (parseTimestampStringToMs(tok.timestamps?.to) ?? segEndMs);
    const prob = (typeof tok.p === 'number')
      ? tok.p
      : (typeof tok.prob === 'number'
          ? tok.prob
          : (typeof tok.confidence === 'number' ? tok.confidence : 1.0));
    validTokens.push({ text: rawTok, startMs: tokStart, endMs: tokEnd, prob });
  }

  if (validTokens.length === 0) return [];

  const words: WordToken[] = [];
  let currentWord: { text: string; startMs: number; endMs: number; prob: number; hasLexicalProb: boolean } | null = null;
  let textSearchIdx = 0;
  let lastMatchedEndIdx = 0;

  for (let i = 0; i < validTokens.length; i++) {
    const tok = validTokens[i];
    const tokTrimmed = tok.text.trim();
    if (!tokTrimmed) continue;
    const tokIsPunct = isStandalonePunctuationToken(tokTrimmed);

    let isContinuation = false;

    if (cleanText && currentWord) {
      const foundIdx = cleanText.indexOf(tokTrimmed, textSearchIdx);
      if (foundIdx !== -1) {
        const between = cleanText.slice(lastMatchedEndIdx, foundIdx);
        if (between.length === 0 || !/\s/.test(between)) {
          isContinuation = true;
        }
        lastMatchedEndIdx = foundIdx + tokTrimmed.length;
        textSearchIdx = lastMatchedEndIdx;
      } else {
        isContinuation = !/^\s/.test(tok.text);
      }
    } else if (cleanText) {
      const foundIdx = cleanText.indexOf(tokTrimmed, textSearchIdx);
      if (foundIdx !== -1) {
        lastMatchedEndIdx = foundIdx + tokTrimmed.length;
        textSearchIdx = lastMatchedEndIdx;
      }
    } else if (currentWord) {
      isContinuation = !/^\s/.test(tok.text);
    }

    if (isContinuation && currentWord) {
      currentWord.text += tokTrimmed;
      currentWord.endMs = Math.max(currentWord.endMs, tok.endMs);
      if (!tokIsPunct) {
        if (currentWord.hasLexicalProb) {
          currentWord.prob = Math.min(currentWord.prob, tok.prob);
        } else {
          // Leading punctuation (e.g. opening quote/paren) should not poison the following word
          currentWord.prob = tok.prob;
          currentWord.hasLexicalProb = true;
        }
      } else if (!currentWord.hasLexicalProb) {
        currentWord.prob = Math.min(currentWord.prob, tok.prob);
      }
    } else {
      if (currentWord && currentWord.text.trim()) {
        words.push({
          text: currentWord.text.trim(),
          startMs: currentWord.startMs,
          endMs: currentWord.endMs,
          prob: currentWord.prob,
        });
      }
      currentWord = {
        text: tokTrimmed,
        startMs: tok.startMs,
        endMs: tok.endMs,
        prob: tok.prob,
        hasLexicalProb: !tokIsPunct,
      };
    }
  }

  if (currentWord && currentWord.text.trim()) {
    words.push({
      text: currentWord.text.trim(),
      startMs: currentWord.startMs,
      endMs: currentWord.endMs,
      prob: currentWord.prob,
    });
  }

  return words;
}

export function parseAndApplyTranscriptContent(text: string, ext: string, shouldRender = true, preserveScroll = false): TranscriptLine[] {
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
      reviewedSegmentIdsInSession.clear();
      activeConfidenceJumpIndex = -1;
      pendingConfidenceJumpAnchor = null;
      clearTranscriptHistory();
      renderTranscriptLines(transcriptLines, preserveScroll);
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

            const words = Array.isArray(seg.tokens)
              ? aggregateTokensIntoWords(seg.tokens, startMs, endMs, cleanText)
              : [];

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
    const lines = parseAndApplyTranscriptContent(text, ext, shouldRender, false);
    if (shouldRender && typeof document !== 'undefined') {
      const viewport = document.getElementById('transcript-viewport');
      if (viewport) {
        viewport.scrollTop = 0;
      }
    }
    return lines;
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
    const searchInput = typeof document !== 'undefined'
      ? (document.getElementById('transcript-search') as HTMLInputElement | null)
      : null;
    const rawQuery = searchInput ? searchInput.value.trim() : '';

    let linesToCopy = transcriptLines;
    let isFiltered = false;

    if (rawQuery && typeof document !== 'undefined') {
      const visibleCards = Array.from(document.querySelectorAll('.transcript-line')) as HTMLElement[];
      const filteredLines: TranscriptLine[] = [];
      visibleCards.forEach(card => {
        if (card.style.display !== 'none') {
          const id = Number(card.dataset.id);
          const line = transcriptLines.find(l => l.id === id);
          if (line) filteredLines.push(line);
        }
      });
      linesToCopy = filteredLines;
      isFiltered = true;
    }

    if (isFiltered && linesToCopy.length === 0) {
      if (showNotification) showNotification(t('transcribe.noMatchingTranscript'), "info");
      return;
    }

    const textToCopy = linesToCopy
      .map(l => l.text)
      .join('\n');
      
    try {
      if (copyToClipboard) await copyToClipboard(textToCopy);
      triggerBtnFeedback();
      if (showNotification) {
        if (isFiltered) {
          showNotification(t('toasts.filteredTranscriptCopied', { count: linesToCopy.length }), "success");
        } else {
          showNotification(t('toasts.liveTranscriptCopied'), "success");
        }
      }
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
  reviewedSegmentIdsInSession.clear();
  activeConfidenceJumpIndex = -1;
  pendingConfidenceJumpAnchor = null;
  clearTranscriptHistory();
  if (confidenceHighlightingActive) {
    toggleConfidenceHighlighting(false);
  }
  renderTranscriptLines([]);
}

export async function loadTranscriptFromJsonData(jsonData: string, shouldRender = true): Promise<TranscriptLine[]> {
  try {
    const lines = parseAndApplyTranscriptContent(jsonData, 'json', shouldRender, false);
    if (shouldRender && typeof document !== 'undefined') {
      const viewport = document.getElementById('transcript-viewport');
      if (viewport) {
        viewport.scrollTop = 0;
      }
    }
    return lines;
  } catch (err) {
    console.error("Failed to load transcript from json data:", err);
    return [];
  }
}

// Keyboard shortcut listener for structural Undo/Redo and Confidence word navigation
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const isConfidenceNav =
      confidenceHighlightingActive &&
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp');
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd && !isConfidenceNav) return;

    // Do not intercept if an application modal overlay is open
    const modalOverlay = document.getElementById('app-modal-overlay');
    if (modalOverlay && modalOverlay.style.display !== 'none') return;
    const shortcutsOverlay = document.getElementById('shortcuts-modal-overlay');
    if (shortcutsOverlay && (shortcutsOverlay.classList.contains('show') || shortcutsOverlay.style.display !== 'none')) return;

    // Only active when transcribe panel is active
    const transcribePanel = document.getElementById('panel-transcribe');
    if (!transcribePanel || !transcribePanel.classList.contains('active')) return;

    const activeEl = document.activeElement;
    const isTranscriptField =
      typeof HTMLTextAreaElement !== 'undefined' &&
      activeEl instanceof HTMLTextAreaElement &&
      activeEl.classList.contains('transcript-text-input');
    const isOtherInput = !isTranscriptField && (
      (typeof HTMLInputElement !== 'undefined' && activeEl instanceof HTMLInputElement) ||
      (typeof HTMLTextAreaElement !== 'undefined' && activeEl instanceof HTMLTextAreaElement) ||
      (typeof HTMLSelectElement !== 'undefined' && activeEl instanceof HTMLSelectElement) ||
      Boolean((activeEl as HTMLElement)?.isContentEditable)
    );

    if (isConfidenceNav) {
      if (isOtherInput) return;
      e.preventDefault();
      jumpToConfidenceWord(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    const hasTypedInCurrent = isTranscriptField && Boolean((activeEl as any)?._hasTyped);
    const shouldBlockStudioUndo = isOtherInput || hasTypedInCurrent;

    if ((e.key.toLowerCase() === 'z' && e.shiftKey) || (e.key.toLowerCase() === 'y' && !e.shiftKey)) {
      if (!shouldBlockStudioUndo && canRedoTranscript()) {
        e.preventDefault();
        redoTranscriptOperation();
      }
    } else if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (!shouldBlockStudioUndo && canUndoTranscript()) {
        e.preventDefault();
        undoTranscriptOperation();
      }
    }
  });
}

export function flushPendingTranscriptLanguageRefresh(): void {
  if (!pendingTranscriptLanguageRefresh) return;
  pendingTranscriptLanguageRefresh = false;
  if (transcriptLines && transcriptLines.length > 0) {
    renderTranscriptLines(transcriptLines);
  } else {
    syncConfidenceButtonAndReviewBar();
  }
  updateUndoRedoButtonsUI();
}

// Guarantee in-flight debounced edits are flushed before window unloads
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    void flushPendingTranscriptEdits();
  });
  window.addEventListener('pagehide', () => {
    void flushPendingTranscriptEdits();
  });
  window.addEventListener('whisper:languageChanged', () => {
    const panel = typeof document !== 'undefined' ? document.getElementById('panel-transcribe') : null;
    if (panel && !panel.classList.contains('active')) {
      pendingTranscriptLanguageRefresh = true;
      return;
    }
    pendingTranscriptLanguageRefresh = false;
    if (transcriptLines && transcriptLines.length > 0) {
      renderTranscriptLines(transcriptLines);
    } else {
      syncConfidenceButtonAndReviewBar();
    }
    updateUndoRedoButtonsUI();
  });
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
  (window as any).aggregateTokensIntoWords = aggregateTokensIntoWords;
  (window as any).splitTranscriptSegment = splitTranscriptSegment;
  (window as any).mergeTranscriptSegmentWithPrevious = mergeTranscriptSegmentWithPrevious;
  (window as any).deleteTranscriptSegment = deleteTranscriptSegment;
  (window as any).undoTranscriptOperation = undoTranscriptOperation;
  (window as any).redoTranscriptOperation = redoTranscriptOperation;
  (window as any).canUndoTranscript = canUndoTranscript;
  (window as any).canRedoTranscript = canRedoTranscript;
  (window as any).clearTranscriptHistory = clearTranscriptHistory;
  (window as any).getTranscriptHistory = getTranscriptHistory;
  (window as any).setTranscriptHistory = setTranscriptHistory;
  (window as any).toggleConfidenceHighlighting = toggleConfidenceHighlighting;
  (window as any).isConfidenceHighlightingActive = isConfidenceHighlightingActive;
  (window as any).hasTranscriptConfidenceData = hasTranscriptConfidenceData;
  (window as any).getConfidenceThreshold = getConfidenceThreshold;
  (window as any).setConfidenceThreshold = setConfidenceThreshold;
  (window as any).toggleConfidenceLowOnlyFilter = toggleConfidenceLowOnlyFilter;
  (window as any).isConfidenceLowOnlyFilterActive = isConfidenceLowOnlyFilterActive;
  (window as any).markConfidenceWordReviewed = markConfidenceWordReviewed;
  (window as any).jumpToConfidenceWord = jumpToConfidenceWord;
  (window as any).syncConfidenceButtonAndReviewBar = syncConfidenceButtonAndReviewBar;
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
    reviewedSegmentIdsInSession.clear();
    activeConfidenceJumpIndex = -1;
    pendingConfidenceJumpAnchor = null;
  },
  getLines: getTranscriptLines,
  clear: clearTranscriptLines,
  appendLine: appendTranscriptLine,
  render: renderTranscriptLines,
  createCard: createTranscriptCardElement,
  updateLineText: updateTranscriptLineText,
  splitSegment: splitTranscriptSegment,
  mergeSegment: mergeTranscriptSegmentWithPrevious,
  deleteSegment: deleteTranscriptSegment,
  undo: undoTranscriptOperation,
  redo: redoTranscriptOperation,
  canUndo: canUndoTranscript,
  canRedo: canRedoTranscript,
  clearHistory: clearTranscriptHistory,
  getHistory: getTranscriptHistory,
  setHistory: setTranscriptHistory,
  toggleConfidence: toggleConfidenceHighlighting,
  isConfidenceActive: isConfidenceHighlightingActive,
  hasConfidenceData: hasTranscriptConfidenceData,
  getConfidenceThreshold,
  setConfidenceThreshold,
  toggleConfidenceLowOnly: toggleConfidenceLowOnlyFilter,
  isConfidenceLowOnly: isConfidenceLowOnlyFilterActive,
  markConfidenceWordReviewed,
  jumpToConfidenceWord,
  syncConfidenceUI: syncConfidenceButtonAndReviewBar,
  loadFromJson: loadTranscriptFromJsonData,
  aggregateTokens: aggregateTokensIntoWords,
  flushEdits: flushPendingTranscriptEdits,
  flushPendingLanguageRefresh: flushPendingTranscriptLanguageRefresh,
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
