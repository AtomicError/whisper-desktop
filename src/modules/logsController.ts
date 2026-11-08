// Central Activity Logging Controller for Whisper Desktop
import { t } from '../i18n/index';

export interface LogEntry {
  category: string;
  message: string;
  timestamp: string;
}

let activeLogCategory = 'All';
let logSearchQuery = '';
let allLogsArray: LogEntry[] = [];
let lastAppendedCategory: string | null = null;
let _isProgrammaticBottomScroll = false;
let _programmaticBottomScrollTimer: any = null;
let _updateLogsButtonsTimer: any = null;

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
  lastAppendedCategory = null;
}

export function pushLogEntry(entry: LogEntry): void {
  allLogsArray.push(entry);
  if (allLogsArray.length > 10000) {
    allLogsArray.splice(0, allLogsArray.length - 10000);
  }
}

export function scrollLogsToBottom(smooth = false): void {
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
  const pill = document.getElementById('btn-logs-jump-bottom');
  if (pill) {
    pill.classList.remove('visible');
  }
  _isProgrammaticBottomScroll = true;
  clearTimeout(_programmaticBottomScrollTimer);
  _programmaticBottomScrollTimer = setTimeout(() => {
    _isProgrammaticBottomScroll = false;
  }, smooth ? 600 : 50);

  if (smooth) {
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  } else {
    viewport.scrollTop = viewport.scrollHeight;
  }
  const autoScroll = document.getElementById('log-autoscroll') as HTMLInputElement | null;
  if (autoScroll && !autoScroll.checked) {
    autoScroll.checked = true;
  }
  updateLogJumpPillVisibility();
}

export function scrollLogsToTop(smooth = false): void {
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
  if (smooth) {
    viewport.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    viewport.scrollTop = 0;
  }
  const autoScroll = document.getElementById('log-autoscroll') as HTMLInputElement | null;
  if (autoScroll) {
    autoScroll.checked = false;
  }
  updateLogJumpPillVisibility();
}

export function updateLogJumpPillVisibility(): void {
  const viewport = document.getElementById('log-viewport');
  const pill = document.getElementById('btn-logs-jump-bottom');
  if (!viewport || !pill) return;
  
  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  const isScrollable = viewport.scrollHeight > viewport.clientHeight + 60;
  
  if (isScrollable && distanceFromBottom > 140) {
    pill.classList.add('visible');
  } else {
    pill.classList.remove('visible');
  }
}

export function setupLogsControls(): void {
  const logViewport = document.getElementById('log-viewport') as any;
  if (logViewport && !logViewport._scrollHandlerAttached) {
    logViewport._scrollHandlerAttached = true;
    let scrollRaf: any = null;

    logViewport.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY < 0) {
        _isProgrammaticBottomScroll = false;
        const autoScrollEl = document.getElementById('log-autoscroll') as HTMLInputElement | null;
        if (autoScrollEl && autoScrollEl.checked) {
          autoScrollEl.checked = false;
        }
      }
    }, { passive: true });

    logViewport.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        const autoScrollEl = document.getElementById('log-autoscroll') as HTMLInputElement | null;
        const distanceFromBottom = logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight;
        if (!_isProgrammaticBottomScroll && distanceFromBottom > 140) {
          if (autoScrollEl && autoScrollEl.checked) {
            autoScrollEl.checked = false;
          }
        }
        updateLogJumpPillVisibility();
      });
    }, { passive: true });
  }

  const autoScrollEl = document.getElementById('log-autoscroll') as any;
  if (autoScrollEl && !autoScrollEl._changeHandlerAttached) {
    autoScrollEl._changeHandlerAttached = true;
    autoScrollEl.addEventListener('change', () => {
      if (autoScrollEl.checked) {
        scrollLogsToBottom(true);
      }
    });
  }
}

export function filterLogs(category: string): void {
  activeLogCategory = category;
  
  const filters = document.querySelectorAll('.filter-btn');
  filters.forEach(btn => {
    btn.classList.remove('active');
    if (btn.id === `log-filter-${category}`) {
      btn.classList.add('active');
    }
  });
  
  redrawLogsViewport();
}

export function handleLogSearch(): void {
  const searchInput = document.getElementById('log-search') as HTMLInputElement | null;
  if (searchInput && (window as any).applyDynamicDirection) {
    (window as any).applyDynamicDirection(searchInput);
  }
  const fn: any = handleLogSearch;
  if (fn._timer) clearTimeout(fn._timer);
  fn._timer = setTimeout(() => {
    fn._timer = null;
    logSearchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    redrawLogsViewport();
  }, 120);
}

export function getFilteredLogs(): LogEntry[] {
  if (!allLogsArray || allLogsArray.length === 0) return [];
  let logs = allLogsArray;
  if (activeLogCategory !== 'All') {
    logs = logs.filter(l => l.category === activeLogCategory);
  }
  if (logSearchQuery) {
    const query = logSearchQuery.toLowerCase();
    logs = logs.filter(l => 
      (l.message && l.message.toLowerCase().includes(query)) || 
      (l.category && l.category.toLowerCase().includes(query))
    );
  }
  return logs;
}

export function scheduleUpdateLogsButtonsState(): void {
  if (_updateLogsButtonsTimer) return;
  _updateLogsButtonsTimer = setTimeout(() => {
    _updateLogsButtonsTimer = null;
    updateLogsButtonsState();
  }, 100);
}

export function updateLogsButtonsState(): void {
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
    btnClear.setAttribute('title', hasAnyLogs ? t('logs.clearBtn') : t('toasts.noLogsToCopy'));
  }
}

export function appendLogToViewport(payload: LogEntry, isBatchRedraw = false): void {
  if (activeLogCategory !== 'All' && payload.category !== activeLogCategory) {
    return;
  }
  
  if (logSearchQuery !== '') {
    const q = logSearchQuery.toLowerCase();
    const msgMatch = Boolean(payload.message && payload.message.toLowerCase().includes(q));
    const catMatch = Boolean(payload.category && payload.category.toLowerCase().includes(q));
    if (!msgMatch && !catMatch) {
      return;
    }
  }
  
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;

  if (!isBatchRedraw) {
    const emptyState = viewport.querySelector('.log-empty-state');
    if (emptyState) {
      emptyState.remove();
    }
  }

  const logLine = document.createElement('div');
  logLine.className = 'log-line';
  
  const catClass = payload.category.toLowerCase();
  logLine.dataset.category = payload.category;
  if (payload.category === lastAppendedCategory) {
    logLine.innerHTML = '<span class="log-time-spacer"></span><span class="log-cat-spacer"></span><span class="log-msg">' + escapeHTML(payload.message) + '</span>';
  } else {
    logLine.innerHTML = '<span class="log-time">' + payload.timestamp + '</span><span class="log-cat ' + catClass + '">' + payload.category.toUpperCase() + '</span><span class="log-msg">' + escapeHTML(payload.message) + '</span>';
    lastAppendedCategory = payload.category;
  }
  
  viewport.appendChild(logLine);
  
  if (viewport.children.length > 1500) {
    viewport.removeChild(viewport.firstElementChild!);
  }
  
  if (isBatchRedraw) return;

  const autoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement | null)?.checked;
  const vp: any = viewport;
  if (autoScroll) {
    clearTimeout(vp._scrollDebounce);
    vp._scrollDebounce = setTimeout(() => {
      viewport.scrollTop = viewport.scrollHeight;
      updateLogJumpPillVisibility();
    }, 80);
  } else {
    updateLogJumpPillVisibility();
  }
}

export function redrawLogsViewport(): void {
  if (_updateLogsButtonsTimer) {
    clearTimeout(_updateLogsButtonsTimer);
    _updateLogsButtonsTimer = null;
  }
  lastAppendedCategory = null;
  const viewport = document.getElementById('log-viewport');
  updateLogsButtonsState();
  if (!viewport) return;
  viewport.innerHTML = '';
  
  const logsToRender = allLogsArray.slice(-1500);
  logsToRender.forEach(payload => {
    appendLogToViewport(payload, true);
  });

  if (viewport.children.length === 0) {
    const hasAnyLogs = Boolean(allLogsArray && allLogsArray.length > 0);
    const emptyKey = hasAnyLogs ? 'logs.noMatchingLogs' : 'logs.emptyLogs';
    viewport.innerHTML = `
      <div class="log-empty-state">
        <svg class="log-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
        <div class="log-empty-text" data-i18n="${emptyKey}">${escapeHTML(t(emptyKey))}</div>
      </div>
    `;
  }

  const autoScroll = (document.getElementById('log-autoscroll') as HTMLInputElement | null)?.checked;
  if (autoScroll) {
    requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
      updateLogJumpPillVisibility();
    });
  } else {
    updateLogJumpPillVisibility();
  }
}

export async function copyAllLogs(): Promise<void> {
  const filteredLogs = getFilteredLogs();
  const showNotification = (window as any).showNotification;
  const copyToClipboard = (window as any).copyToClipboard;
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
    if (activeLogCategory === 'Whisper') {
      showNotification(t('toasts.logsCopiedWhisper'), "success");
    } else if (activeLogCategory === 'Translate') {
      showNotification(t('toasts.logsCopiedTranslate'), "success");
    } else if (activeLogCategory !== 'All' || logSearchQuery) {
      showNotification(t('toasts.logsCopiedFiltered', { count: filteredLogs.length }), "success");
    } else {
      showNotification(t('toasts.logsCopied'), "success");
    }
  } catch (e: any) {
    const msg = (e && (e.message || e.toString())) || String(e);
    if (showNotification) showNotification(t('toasts.logsCopyError', { error: msg }), "error");
  }
}

const getTauriInvoke = (): any => {
  const tauri = (window as any).__TAURI__;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return (window as any).invoke || null;
};

export async function clearLogsHistory(invokeFn?: any): Promise<void> {
  if (!allLogsArray || allLogsArray.length === 0) return;
  const showConfirmModal = (window as any).showConfirmModal;
  const invoke = invokeFn || getTauriInvoke();
  if (showConfirmModal) {
    const confirmed = await showConfirmModal(
      t('modals.confirmClearLogsTitle'),
      t('modals.confirmClearLogsDesc'),
      t('modals.confirmClearLogsBtn')
    );
    if (!confirmed) return;
  }
  clearLogsArray();
  if (invoke) {
    try {
      await invoke('clear_logs');
    } catch (e) {
      console.warn('[Logs] Failed to invoke clear_logs:', e);
    }
  }
  redrawLogsViewport();
}

let _lastGlobalErrorToastAt = 0;

export function reportGlobalFrontendError(
  message: string | Event,
  source?: string,
  lineno?: number,
  colno?: number,
  error?: Error
): boolean {
  const msgText = typeof message === 'string'
    ? message
    : (error?.message || 'Unexpected frontend error');

  if (msgText.includes('ResizeObserver loop')) {
    return false;
  }

  const locationParts = [source, lineno, colno].filter(v => v !== undefined && v !== null && v !== '');
  const locationSuffix = locationParts.length > 0 ? ` (${locationParts.join(':')})` : '';
  const formattedLog = `Frontend error: ${msgText}${locationSuffix}`;

  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const entry: LogEntry = {
    category: 'System',
    message: formattedLog,
    timestamp
  };

  try {
    pushLogEntry(entry);
    scheduleUpdateLogsButtonsState();
    appendLogToViewport(entry);
  } catch (_) {
    // Ignore secondary logging errors
  }

  const nowMs = Date.now();
  if (nowMs - _lastGlobalErrorToastAt > 3000) {
    _lastGlobalErrorToastAt = nowMs;
    try {
      const showNotification = typeof window !== 'undefined' ? (window as any).showNotification : null;
      if (typeof showNotification === 'function') {
        showNotification(msgText, 'error');
      }
    } catch (_) {
      // Ignore secondary notification errors
    }
  }

  return false;
}

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
  set allLogs(arr) { allLogsArray = arr; },
  push: pushLogEntry,
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
  reportGlobalFrontendError
};
