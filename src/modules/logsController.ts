// Central Activity Logging Controller for Whisper Desktop
import { t, getLanguage, formatLocalizedNumber } from '../i18n/index';
import { createFrontendErrorReporter } from './logErrorReporter';
import {
  resetLogScrollState,
  syncLastViewportScrollTop,
  armRedrawProgrammaticBottomScroll,
  scheduleRedrawBottomScroll,
  scheduleAppendAutoScroll,
  scrollLogsToBottom,
  scrollLogsToTop,
  updateLogJumpPillVisibility,
  setupLogsControls
} from './logViewportScroll';

export interface LogEntry {
  seq?: number;
  category: string;
  message: string;
  timestamp: string;
}

const MAX_STORED_LOGS = 10000;
const MAX_VIEWPORT_LINES = 1500;

let activeLogCategory = 'All';
let logSearchQuery = '';
let allLogsArray: LogEntry[] = [];
const seenBackendSeqs = new Set<number>();
let _minAcceptedBackendSeq = 0;
let _lastAppendedBackendSeq: number | null = null;
let lastAppendedCategory: string | null = null;
let _updateLogsButtonsTimer: ReturnType<typeof setTimeout> | null = null;
let _searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export {
  scrollLogsToBottom,
  scrollLogsToTop,
  updateLogJumpPillVisibility,
  setupLogsControls
};

export function formatLogTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function rebuildSeenBackendSeqs(): void {
  seenBackendSeqs.clear();
  for (const item of allLogsArray) {
    if (typeof item.seq === 'number') {
      seenBackendSeqs.add(item.seq);
    }
  }
}

function syncSearchQueryFromInput(): boolean {
  const hadPendingTimer = _searchDebounceTimer !== null;
  if (_searchDebounceTimer !== null) {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = null;
  }
  const searchInput = typeof document !== 'undefined'
    ? (document.getElementById('log-search') as HTMLInputElement | null)
    : null;
  if (searchInput) {
    const nextQuery = searchInput.value.toLowerCase().trim();
    const changed = nextQuery !== logSearchQuery;
    logSearchQuery = nextQuery;
    return hadPendingTimer || changed;
  }
  return hadPendingTimer;
}

function trimStoredLogsToCap(): void {
  if (allLogsArray.length > MAX_STORED_LOGS) {
    const evicted = allLogsArray.splice(0, allLogsArray.length - MAX_STORED_LOGS);
    for (const item of evicted) {
      if (typeof item.seq === 'number') {
        seenBackendSeqs.delete(item.seq);
        _minAcceptedBackendSeq = Math.max(_minAcceptedBackendSeq, item.seq + 1);
      }
    }
  }
}

function matchesActiveFilter(entry: LogEntry): boolean {
  if (activeLogCategory !== 'All' && entry.category !== activeLogCategory) {
    return false;
  }
  if (logSearchQuery !== '') {
    const msgMatch = Boolean(entry.message && entry.message.toLowerCase().includes(logSearchQuery));
    const catMatch = Boolean(entry.category && entry.category.toLowerCase().includes(logSearchQuery));
    if (!msgMatch && !catMatch) {
      return false;
    }
  }
  return true;
}

export function stripAnsi(str: string): string {
  if (typeof str !== 'string') return '';
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, '');
}

export function escapeHTML(str: string): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>'"]/g,
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

export function getLogs(): LogEntry[] {
  return allLogsArray;
}

export function clearLogsArray(): void {
  allLogsArray = [];
  seenBackendSeqs.clear();
  _minAcceptedBackendSeq = 0;
  _lastAppendedBackendSeq = null;
  lastAppendedCategory = null;
  if (_searchDebounceTimer !== null) {
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = null;
  }
  if (_updateLogsButtonsTimer !== null) {
    clearTimeout(_updateLogsButtonsTimer);
    _updateLogsButtonsTimer = null;
  }
  resetErrorThrottle();
  resetLogScrollState();
}

export function pushLogEntry(entry: LogEntry): boolean {
  if (typeof entry.seq === 'number') {
    if (entry.seq < _minAcceptedBackendSeq || seenBackendSeqs.has(entry.seq)) {
      return false;
    }

    // Keep backend entries ordered by monotonic seq even if threads emit out of order
    let insertAt = allLogsArray.length;
    for (let i = allLogsArray.length - 1; i >= 0; i--) {
      const existingSeq = allLogsArray[i].seq;
      if (typeof existingSeq === 'number') {
        if (existingSeq > entry.seq) {
          insertAt = i;
        } else {
          break;
        }
      }
    }

    // If buffer is already at capacity and entry is older than the oldest stored item, drop it
    if (insertAt === 0 && allLogsArray.length >= MAX_STORED_LOGS) {
      _minAcceptedBackendSeq = Math.max(_minAcceptedBackendSeq, entry.seq + 1);
      return false;
    }

    seenBackendSeqs.add(entry.seq);
    if (insertAt < allLogsArray.length) {
      allLogsArray.splice(insertAt, 0, entry);
      trimStoredLogsToCap();
      return true;
    }
  }
  allLogsArray.push(entry);
  trimStoredLogsToCap();
  return true;
}

export function hydrateLogs(entries: LogEntry[]): void {
  const bySeq = new Map<number, LogEntry>();
  const frontendEntries: LogEntry[] = [];

  for (const existing of allLogsArray) {
    if (typeof existing.seq === 'number') {
      if (existing.seq >= _minAcceptedBackendSeq) {
        bySeq.set(existing.seq, existing);
      }
    } else {
      frontendEntries.push(existing);
    }
  }

  for (const incoming of entries) {
    if (!incoming) continue;
    const normalized: LogEntry = {
      ...incoming,
      message: stripAnsi(incoming.message || ''),
    };
    if (typeof normalized.seq === 'number') {
      if (normalized.seq >= _minAcceptedBackendSeq) {
        bySeq.set(normalized.seq, normalized);
      }
    } else {
      frontendEntries.push(normalized);
    }
  }

  const orderedBackend = Array.from(bySeq.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, item]) => item);

  allLogsArray = [...orderedBackend, ...frontendEntries];
  trimStoredLogsToCap();
  rebuildSeenBackendSeqs();
  lastAppendedCategory = null;
}

export function filterLogs(category: string): void {
  syncSearchQueryFromInput();
  activeLogCategory = category;

  if (typeof document === 'undefined') return;
  const scope = document.getElementById('panel-logs') || document;
  const filters = scope.querySelectorAll('.filter-btn');
  filters.forEach(btn => {
    const isMatch = btn.id === `log-filter-${category}`;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });

  redrawLogsViewport();
}

export function handleLogSearch(): void {
  if (typeof document === 'undefined') return;
  const searchInput = document.getElementById('log-search') as HTMLInputElement | null;
  if (searchInput && typeof window !== 'undefined' && (window as any).applyDynamicDirection) {
    (window as any).applyDynamicDirection(searchInput);
  }
  if (_searchDebounceTimer !== null) {
    clearTimeout(_searchDebounceTimer);
  }
  _searchDebounceTimer = setTimeout(() => {
    _searchDebounceTimer = null;
    if (typeof document === 'undefined') return;
    const liveInput = document.getElementById('log-search') as HTMLInputElement | null;
    logSearchQuery = liveInput ? liveInput.value.toLowerCase().trim() : '';
    redrawLogsViewport();
  }, 120);
}

export function getFilteredLogs(): LogEntry[] {
  if (!allLogsArray || allLogsArray.length === 0) return [];
  if (activeLogCategory === 'All' && !logSearchQuery) return allLogsArray;
  return allLogsArray.filter(matchesActiveFilter);
}

export function scheduleUpdateLogsButtonsState(): void {
  if (_updateLogsButtonsTimer) return;
  _updateLogsButtonsTimer = setTimeout(() => {
    _updateLogsButtonsTimer = null;
    updateLogsButtonsState();
  }, 100);
}

export function updateLogsButtonsState(): void {
  if (typeof document === 'undefined') return;
  const hasAnyLogs = Boolean(allLogsArray && allLogsArray.length > 0);
  const filteredLogs = getFilteredLogs();
  const hasFilteredLogs = filteredLogs.length > 0;

  const btnScrollTop = document.getElementById('btn-scroll-top-logs') as HTMLButtonElement | null;
  if (btnScrollTop) {
    btnScrollTop.disabled = !hasFilteredLogs;
  }
  const btnScrollBottom = document.getElementById('btn-scroll-bottom-logs') as HTMLButtonElement | null;
  if (btnScrollBottom) {
    btnScrollBottom.disabled = !hasFilteredLogs;
  }

  const btnCopy = document.getElementById('btn-copy-all-logs');
  if (btnCopy) {
    if (!hasFilteredLogs) {
      btnCopy.setAttribute('disabled', 'true');
    } else {
      btnCopy.removeAttribute('disabled');
    }
    let copyTitle = t('logs.copyBtn');
    if (!hasAnyLogs) {
      copyTitle = t('toasts.noLogsToCopy');
    } else if (!hasFilteredLogs) {
      copyTitle = t('toasts.noMatchingLogsToCopy');
    }
    btnCopy.setAttribute('title', copyTitle);
  }
  const btnClear = document.getElementById('btn-clear-all-logs');
  if (btnClear) {
    if (!hasAnyLogs) {
      btnClear.setAttribute('disabled', 'true');
    } else {
      btnClear.removeAttribute('disabled');
    }
    btnClear.setAttribute('title', hasAnyLogs ? t('logs.clearBtn') : t('logs.emptyLogs'));
  }
}

function buildCategoryClass(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function createHeaderSpans(timestamp: string, category: string): { timeEl: HTMLSpanElement; catEl: HTMLSpanElement } {
  const catClass = buildCategoryClass(category);
  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = timestamp;

  const catEl = document.createElement('span');
  catEl.className = catClass ? `log-cat ${catClass}` : 'log-cat';
  catEl.textContent = category.toUpperCase();
  return { timeEl, catEl };
}

function createLogLineElement(payload: LogEntry): HTMLDivElement {
  const logLine = document.createElement('div');
  logLine.className = 'log-line';

  const category = payload.category || '';
  const timestamp = payload.timestamp || '';
  logLine.dataset.category = category;
  logLine.dataset.timestamp = timestamp;

  if (category === lastAppendedCategory) {
    const timeSpacer = document.createElement('span');
    timeSpacer.className = 'log-time-spacer';
    const catSpacer = document.createElement('span');
    catSpacer.className = 'log-cat-spacer';
    logLine.appendChild(timeSpacer);
    logLine.appendChild(catSpacer);
  } else {
    const { timeEl, catEl } = createHeaderSpans(timestamp, category);
    logLine.appendChild(timeEl);
    logLine.appendChild(catEl);
    lastAppendedCategory = category;
  }

  const msgEl = document.createElement('span');
  msgEl.className = 'log-msg';
  msgEl.textContent = payload.message || '';
  logLine.appendChild(msgEl);

  return logLine;
}

function promoteFirstLogLineHeader(viewport: HTMLElement): void {
  const first = viewport.firstElementChild as HTMLElement | null;
  if (!first || typeof first.querySelector !== 'function' || typeof first.replaceChild !== 'function') {
    return;
  }
  const timeSpacer = first.querySelector('.log-time-spacer');
  const catSpacer = first.querySelector('.log-cat-spacer');
  if (!timeSpacer && !catSpacer) return;

  const category = first.dataset.category || '';
  const timestamp = first.dataset.timestamp || '';
  const { timeEl, catEl } = createHeaderSpans(timestamp, category);
  if (timeSpacer) first.replaceChild(timeEl, timeSpacer);
  if (catSpacer) first.replaceChild(catEl, catSpacer);
}

function syncEmptyStateForNonMatchingAppend(): void {
  if (typeof document === 'undefined') return;
  const viewport = document.getElementById('log-viewport');
  if (!viewport || typeof viewport.querySelector !== 'function') return;
  const emptyTextEl = viewport.querySelector('.log-empty-state .log-empty-text') as HTMLElement | null;
  if (emptyTextEl && allLogsArray.length > 0 && emptyTextEl.getAttribute('data-i18n') === 'logs.emptyLogs') {
    emptyTextEl.setAttribute('data-i18n', 'logs.noMatchingLogs');
    emptyTextEl.textContent = t('logs.noMatchingLogs');
  }
}

export function appendLogToViewport(payload: LogEntry, isBatchRedraw = false): void {
  if (!matchesActiveFilter(payload)) {
    syncEmptyStateForNonMatchingAppend();
    return;
  }

  if (typeof document === 'undefined') return;

  if (typeof payload.seq === 'number') {
    if (_lastAppendedBackendSeq !== null && payload.seq < _lastAppendedBackendSeq) {
      redrawLogsViewport(true);
      return;
    }
    _lastAppendedBackendSeq = payload.seq;
  }

  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;

  if (!isBatchRedraw) {
    const emptyState = viewport.querySelector('.log-empty-state');
    if (emptyState) {
      emptyState.remove();
    }
  }

  const logLine = createLogLineElement(payload);
  viewport.appendChild(logLine);

  if (viewport.children.length > MAX_VIEWPORT_LINES && viewport.firstElementChild) {
    viewport.removeChild(viewport.firstElementChild);
    promoteFirstLogLineHeader(viewport);
  }

  if (isBatchRedraw) return;

  const autoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement | null)?.checked;
  if (autoScroll) {
    scheduleAppendAutoScroll(viewport);
  } else {
    updateLogJumpPillVisibility();
  }
}

function renderEmptyLogState(viewport: HTMLElement): void {
  const hasAnyLogs = Boolean(allLogsArray && allLogsArray.length > 0);
  const emptyKey = hasAnyLogs ? 'logs.noMatchingLogs' : 'logs.emptyLogs';
  viewport.innerHTML = `
    <div class="log-empty-state">
      <svg class="log-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
      <div class="log-empty-text" data-i18n="${emptyKey}">${escapeHTML(t(emptyKey))}</div>
    </div>
  `;
}

export function redrawLogsViewport(preserveScroll = false): void {
  if (_updateLogsButtonsTimer) {
    clearTimeout(_updateLogsButtonsTimer);
    _updateLogsButtonsTimer = null;
  }
  resetLogScrollState();
  lastAppendedCategory = null;
  _lastAppendedBackendSeq = null;
  if (typeof document === 'undefined') return;

  const viewport = document.getElementById('log-viewport');
  updateLogsButtonsState();
  if (!viewport) return;

  const autoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement | null)?.checked;
  const savedScrollTop = preserveScroll && !autoScroll ? viewport.scrollTop : 0;
  if (autoScroll) {
    armRedrawProgrammaticBottomScroll();
  }

  viewport.innerHTML = '';

  const logsToRender = getFilteredLogs().slice(-MAX_VIEWPORT_LINES);
  const fragment = typeof document.createDocumentFragment === 'function'
    ? document.createDocumentFragment()
    : null;

  for (const payload of logsToRender) {
    if (typeof payload.seq === 'number') {
      _lastAppendedBackendSeq = payload.seq;
    }
    const logLine = createLogLineElement(payload);
    if (fragment) {
      fragment.appendChild(logLine);
    } else {
      viewport.appendChild(logLine);
    }
  }

  if (fragment && logsToRender.length > 0) {
    viewport.appendChild(fragment);
  }

  if (viewport.children.length === 0) {
    renderEmptyLogState(viewport);
  }

  if (autoScroll) {
    scheduleRedrawBottomScroll(viewport);
  } else {
    if (preserveScroll) {
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      viewport.scrollTop = Math.min(savedScrollTop, maxScrollTop);
    }
    syncLastViewportScrollTop(viewport.scrollTop);
    updateLogJumpPillVisibility();
  }
}

export async function copyAllLogs(): Promise<void> {
  if (syncSearchQueryFromInput()) {
    redrawLogsViewport();
  }
  const filteredLogs = getFilteredLogs();
  const win = typeof window !== 'undefined' ? (window as any) : null;
  const showNotification = win?.showNotification;
  const copyToClipboard = win?.copyToClipboard;
  if (!filteredLogs || filteredLogs.length === 0) {
    const hasAnyLogs = Boolean(allLogsArray && allLogsArray.length > 0);
    if (showNotification) showNotification(hasAnyLogs ? t('toasts.noMatchingLogsToCopy') : t('toasts.noLogsToCopy'), "warning");
    return;
  }
  const rawLogs = filteredLogs.map(l => `[${l.timestamp}] [${l.category}] ${l.message}`).join('\n');
  if (!rawLogs.trim()) {
    if (showNotification) showNotification(t('toasts.noLogsToCopy'), "warning");
    return;
  }
  try {
    if (copyToClipboard) await copyToClipboard(rawLogs);
    if (!showNotification) return;
    if (activeLogCategory === 'Whisper' && !logSearchQuery) {
      showNotification(t('toasts.logsCopiedWhisper'), "success");
    } else if (activeLogCategory === 'Translate' && !logSearchQuery) {
      showNotification(t('toasts.logsCopiedTranslate'), "success");
    } else if (activeLogCategory !== 'All' || logSearchQuery) {
      const formattedCount = formatLocalizedNumber(filteredLogs.length, getLanguage(), 0) || String(filteredLogs.length);
      showNotification(t('toasts.logsCopiedFiltered', { count: formattedCount }), "success");
    } else {
      showNotification(t('toasts.logsCopied'), "success");
    }
  } catch (e: any) {
    const msg = (e && (e.message || e.toString())) || String(e);
    if (showNotification) showNotification(t('toasts.logsCopyError', { error: msg }), "error");
  }
}

const getTauriInvoke = (): any => {
  if (typeof window === 'undefined') return null;
  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return (window as any).invoke || null;
};

export async function clearLogsHistory(invokeFn?: any): Promise<void> {
  if (!allLogsArray || allLogsArray.length === 0) return;
  const showConfirmModal = typeof window !== 'undefined' ? (window as any).showConfirmModal : null;
  const invoke = invokeFn || getTauriInvoke();
  if (showConfirmModal) {
    const confirmed = await showConfirmModal(
      t('modals.confirmClearLogsTitle'),
      t('modals.confirmClearLogsDesc'),
      t('modals.confirmClearLogsBtn')
    );
    if (!confirmed) return;
  }

  let maxSeenSeq = -1;
  for (const item of allLogsArray) {
    if (typeof item.seq === 'number' && item.seq > maxSeenSeq) {
      maxSeenSeq = item.seq;
    }
  }
  const pendingWatermark = Math.max(_minAcceptedBackendSeq, maxSeenSeq >= 0 ? maxSeenSeq + 1 : 0);

  clearLogsArray();
  _minAcceptedBackendSeq = pendingWatermark;

  if (invoke) {
    try {
      const nextSeq = await invoke('clear_logs');
      if (typeof nextSeq === 'number' && Number.isFinite(nextSeq)) {
        _minAcceptedBackendSeq = Math.max(_minAcceptedBackendSeq, nextSeq);
        allLogsArray = allLogsArray.filter(item => typeof item.seq !== 'number' || item.seq >= _minAcceptedBackendSeq);
        rebuildSeenBackendSeqs();
      }
    } catch (e) {
      console.warn('[Logs] Failed to invoke clear_logs:', e);
    }
  }
  redrawLogsViewport();
}

const {
  reportGlobalFrontendError,
  reportUnhandledRejection,
  resetThrottle: resetErrorThrottle
} = createFrontendErrorReporter({
  formatTimestamp: formatLogTimestamp,
  onRecord: (entry) => {
    pushLogEntry(entry);
    scheduleUpdateLogsButtonsState();
    appendLogToViewport(entry);
  }
});

export { reportGlobalFrontendError, reportUnhandledRejection };

// Bind to window for global inline HTML onclick handlers
if (typeof window !== 'undefined') {
  (window as any).scrollLogsToBottom = scrollLogsToBottom;
  (window as any).scrollLogsToTop = scrollLogsToTop;
  (window as any).updateLogJumpPillVisibility = updateLogJumpPillVisibility;
  (window as any).filterLogs = filterLogs;
  (window as any).handleLogSearch = handleLogSearch;
  (window as any).copyAllLogs = copyAllLogs;
  (window as any).clearLogsHistory = clearLogsHistory;
  (window as any).setupLogsControls = setupLogsControls;
  (window as any).redrawLogsViewport = redrawLogsViewport;
  (window as any).getFilteredLogs = getFilteredLogs;
}

export const logsController = {
  get allLogs() { return allLogsArray; },
  set allLogs(arr) {
    allLogsArray = arr;
    lastAppendedCategory = null;
    _lastAppendedBackendSeq = null;
    trimStoredLogsToCap();
    rebuildSeenBackendSeqs();
  },
  push: pushLogEntry,
  hydrate: hydrateLogs,
  clear: clearLogsArray,
  appendLogToViewport,
  redraw: redrawLogsViewport,
  setup: setupLogsControls,
  filter: filterLogs,
  search: handleLogSearch,
  copyAll: copyAllLogs,
  clearHistory: clearLogsHistory,
  scheduleUpdateButtons: scheduleUpdateLogsButtonsState,
  updateButtonsState: updateLogsButtonsState,
  scrollBottom: scrollLogsToBottom,
  scrollTop: scrollLogsToTop,
  scrollToBottom: scrollLogsToBottom,
  scrollToTop: scrollLogsToTop,
  updateLogJumpPillVisibility,
  getFilteredLogs,
  stripAnsi,
  escapeHTML,
  formatLogTimestamp,
  reportGlobalFrontendError,
  reportUnhandledRejection
};
