// System Feedback, Toasts, Focus Trap, Confirmation & About Modals, and Online Update Checker
import { t } from '../i18n/index';
import { getLatestWhisperEngineStatus, formatWhisperEngineVersion } from './transcribeDeckHost';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare const __APP_VERSION__: string;
declare const __WHISPER_CPP_VERSION__: string;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

declare global {
  interface Window {
    showNotification: (msg: string, type: string, customDuration?: number | null, action?: ToastAction | null) => void;
    showAppModal: (title: string, message: string, details?: string) => void;
    closeAppModal: () => void;
    showConfirmModal: (title: string, message: string, confirmButtonText?: string | null) => Promise<boolean>;
    resolveAppConfirm: (value: boolean) => void;
    _confirmModalResolve?: ((value: boolean) => void) | null;
    showBatchErrorDialog: (fileName: string, errorMsg: string) => Promise<string>;
    resolveBatchError?: (choice: string) => void;
    openAboutModal: () => void;
    closeAboutModal: () => void;
    openShortcutsModal: () => void;
    closeShortcutsModal: () => void;
    checkForAppUpdates: (options?: { silent?: boolean }) => Promise<void>;
    renderUpdateCheckerUI: () => void;
    syncAppVersionUI: () => void;
    openUrl?: (url: string, target?: string) => void;
    __TAURI__?: any;
  }
}

const getGlobal = (): any => (typeof window !== 'undefined' ? window : globalThis);

const safeRaf = (cb: () => void) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(cb, 0);
  }
};

export function formatToastMessage(text: string | null | undefined): string | null | undefined {
  if (!text || typeof text !== 'string') return text;
  return text.split('\n').map(line => {
    return line.replace(/(\S+)[^\S\r\n]+(\S{1,25}[.!?،؛:»)"']?)[^\S\r\n]*$/, '$1\u00A0$2');
  }).join('\n');
}

interface ManagedToastElement extends HTMLDivElement {
  _rawMessage?: string;
  _restartTimer?: (newDuration: number) => void;
  _pauseForContextMenu?: () => void;
  _resumeAfterContextMenu?: () => void;
}

export function showNotification(
  message: any,
  type = 'info',
  customDuration: number | null = null,
  action: ToastAction | null = null
): void {
  if (typeof document === 'undefined') return;

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  
  const cleanMsg = String(message != null ? message : '').trim();
  const cleanNormalized = cleanMsg.replace(/\u00A0/g, ' ').trim();

  let defaultDuration = 6000;
  if (type === 'error') {
    defaultDuration = 10000;
  }
  const duration = (customDuration !== null) ? customDuration : defaultDuration;

  // Smart Deduplication
  const existingToasts = container.querySelectorAll('.toast-notification');
  for (const existing of Array.from(existingToasts) as ManagedToastElement[]) {
    const msgEl = existing.querySelector('.toast-message');
    const existingRaw = existing._rawMessage;
    const existingText = msgEl ? (msgEl.textContent || '').replace(/\u00A0/g, ' ').trim() : '';
    if ((existingRaw === cleanMsg || existingText === cleanNormalized) && !existing.classList.contains('hide')) {
      existing.style.animation = 'none';
      void existing.offsetWidth; // trigger reflow
      existing.style.animation = '';
      if (typeof existing._restartTimer === 'function') {
        existing._restartTimer(duration);
      }
      return;
    }
  }

  const toast = document.createElement('div') as ManagedToastElement;
  toast.className = `toast-notification toast-${type}`;
  toast._rawMessage = cleanMsg;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const closeSvg = `<svg class="toast-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-message"></div>
    <button class="toast-close-btn" title="${t('common.close')}" aria-label="${t('common.close')}">${closeSvg}</button>
    <div class="toast-progress-bar"></div>
  `;
  const msgEl = toast.querySelector('.toast-message') as HTMLElement | null;
  if (msgEl) {
    if (message && typeof message === 'string' && message.includes('\n')) {
      const newlineIndex = message.indexOf('\n');
      const header = message.substring(0, newlineIndex).trim();
      const technical = message.substring(newlineIndex + 1).trim();

      if (technical) {
        msgEl.textContent = '';
        const titleDiv = document.createElement('div');
        titleDiv.className = 'toast-title';
        titleDiv.textContent = formatToastMessage(header) || '';

        const techDiv = document.createElement('div');
        techDiv.className = 'toast-tech-detail';
        const isRtl = /[\u0600-\u06FF]/.test(technical);
        if (isRtl) {
          techDiv.setAttribute('dir', 'rtl');
          techDiv.classList.add('toast-msg-rtl');
        } else {
          techDiv.setAttribute('dir', 'ltr');
        }
        techDiv.textContent = technical;

        msgEl.appendChild(titleDiv);
        msgEl.appendChild(techDiv);
      } else {
        msgEl.textContent = formatToastMessage(header || message) || '';
      }
    } else {
      msgEl.textContent = formatToastMessage(message) || '';
    }
  }
  
  const progressBar = toast.querySelector('.toast-progress-bar') as HTMLElement | null;
  if (progressBar) {
    if (duration > 0 && duration !== Infinity) {
      progressBar.style.transition = `width ${duration}ms linear`;
    } else {
      progressBar.style.display = 'none';
    }
  }
  
  container.appendChild(toast);
  
  let timerId: any = null;
  let startTime = Date.now();
  let activeDuration = duration;
  let remainingTime = duration;
  let isPaused = false;
  
  const closeToast = () => {
    if (toast.classList.contains('hide')) return;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
      if (container && container.children.length === 0) {
        container.remove();
      }
    }, 400);
  };
  
  const isInteractionHeld = (): boolean =>
    toast.dataset?.contextMenuActive === 'true' ||
    (typeof toast.matches === 'function' && toast.matches(':hover'));

  const startTimer = (dur = remainingTime) => {
    activeDuration = dur;
    if (dur <= 0 || dur === Infinity) return;
    if (progressBar) {
      progressBar.style.display = '';
    }
    startTime = Date.now();
    remainingTime = dur;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }

    if (isInteractionHeld()) {
      isPaused = true;
      if (progressBar) {
        progressBar.style.transition = 'none';
        progressBar.style.width = '100%';
      }
      return;
    }

    isPaused = false;
    if (progressBar) {
      progressBar.style.transition = 'none';
      progressBar.style.width = '100%';
      void progressBar.offsetWidth; // trigger reflow
      progressBar.style.transition = `width ${dur}ms linear`;
      progressBar.style.width = '0%';
    }
    timerId = setTimeout(closeToast, dur);
  };
  
  const pauseTimer = () => {
    if (activeDuration <= 0 || activeDuration === Infinity || isPaused) return;
    isPaused = true;
    clearTimeout(timerId);
    remainingTime -= (Date.now() - startTime);
    if (remainingTime < 0) remainingTime = 0;
    if (progressBar && typeof getComputedStyle === 'function') {
      const computedWidth = getComputedStyle(progressBar).width;
      progressBar.style.transition = 'none';
      progressBar.style.width = computedWidth;
    }
  };

  const resumeTimer = () => {
    if (activeDuration <= 0 || activeDuration === Infinity || !isPaused) return;
    isPaused = false;
    if (remainingTime > 0) {
      startTime = Date.now();
      if (progressBar) {
        void progressBar.offsetWidth; // commit paused/reset width before starting linear shrink
        progressBar.style.transition = `width ${remainingTime}ms linear`;
        progressBar.style.width = '0%';
      }
      timerId = setTimeout(closeToast, remainingTime);
    } else {
      closeToast();
    }
  };

  toast._restartTimer = (newDuration: number) => {
    startTimer(newDuration);
  };
  toast._pauseForContextMenu = () => {
    pauseTimer();
  };
  toast._resumeAfterContextMenu = () => {
    if (typeof toast.matches === 'function' && toast.matches(':hover')) return;
    resumeTimer();
  };

  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', () => {
    if (toast.dataset?.contextMenuActive === 'true') return;
    resumeTimer();
  });
  
  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeToast();
    });
  }

  if (action && action.label && typeof action.onClick === 'function') {
    const actionBtn = document.createElement('button') as HTMLButtonElement;
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = action.label;
    actionBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeToast();
      action.onClick();
    });
    if (typeof toast.insertBefore === 'function' && closeBtn && closeBtn.parentNode === toast) {
      toast.insertBefore(actionBtn, closeBtn);
    } else {
      toast.appendChild(actionBtn);
    }
  }
  
  setTimeout(() => {
    toast.classList.add('show');
    startTimer();
  }, 20);
}

export function _trapModalFocus(modalEl: HTMLElement, closeCallback: () => void): { release: () => void } {
  const previousActiveElement = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;

  const isVisible = (el: any): boolean => {
    if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
    if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
    if (el.closest && el.closest('[style*="display: none"], [style*="display:none"], [hidden]')) return false;
    if (typeof el.checkVisibility === 'function') {
      try {
        return el.checkVisibility({ checkVisibilityCSS: true });
      } catch (_) {}
    }
    return el.offsetParent !== null;
  };

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (
        typeof document !== 'undefined' &&
        (document.querySelector?.('.custom-select-options.open') ||
          document.getElementById?.('app-context-menu')?.classList?.contains('open'))
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      closeCallback();
      return;
    }

    if (e.key === 'Tab') {
      const candidates = Array.from(modalEl.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      const focusable = candidates.filter(isVisible) as HTMLElement[];
      if (!focusable.length) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !modalEl.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !modalEl.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', keyHandler);
  }

  return {
    release: () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', keyHandler);
      }
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        try {
          previousActiveElement.focus();
        } catch (_) {}
      }
    }
  };
}

let _appModalTrap: { release: () => void } | null = null;
let _appModalCloseTimer: ReturnType<typeof setTimeout> | null = null;
let _confirmModalResolve: ((value: boolean) => void) | null = null;

export function showAppModal(title: string, message: string, details = ''): void {
  if (typeof document === 'undefined') return;

  if (_appModalCloseTimer !== null) {
    clearTimeout(_appModalCloseTimer);
    _appModalCloseTimer = null;
  }
  if (_appModalTrap) {
    _appModalTrap.release();
    _appModalTrap = null;
  }
  const overlay = document.getElementById('app-modal-overlay');
  const titleEl = document.getElementById('app-modal-title');
  const msgEl = document.getElementById('app-modal-message');
  const detailsEl = document.getElementById('app-modal-details');
  const okFooter = document.getElementById('app-modal-ok-footer');
  const confirmFooter = document.getElementById('app-modal-confirm-footer');
  
  if (overlay && titleEl && msgEl && detailsEl) {
    titleEl.textContent = title;
    msgEl.textContent = message;
    
    if (details) {
      detailsEl.textContent = details;
      detailsEl.style.display = 'block';
    } else {
      detailsEl.style.display = 'none';
    }
    
    if (okFooter) okFooter.style.display = 'flex';
    if (confirmFooter) confirmFooter.style.display = 'none';
    
    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');

    _appModalTrap = _trapModalFocus(overlay, () => {
      const win = getGlobal();
      if (_confirmModalResolve || win._confirmModalResolve) {
        resolveAppConfirm(false);
      } else {
        closeAppModal();
      }
    });

    safeRaf(() => {
      if (typeof document === 'undefined') return;
      const okBtn = document.getElementById('app-modal-close-btn');
      if (okBtn && okBtn.offsetParent !== null) {
        okBtn.focus();
      } else {
        const first = overlay.querySelector('button:not([disabled])') as HTMLElement | null;
        if (first) first.focus();
      }
    });
  }
}

export function closeAppModal(): void {
  if (typeof document === 'undefined') return;

  if (_appModalCloseTimer !== null) {
    clearTimeout(_appModalCloseTimer);
    _appModalCloseTimer = null;
  }
  if (_appModalTrap) {
    _appModalTrap.release();
    _appModalTrap = null;
  }
  const win = getGlobal();
  const resolve = _confirmModalResolve || win._confirmModalResolve;
  if (resolve) {
    _confirmModalResolve = null;
    win._confirmModalResolve = null;
    resolve(false);
  }
  const overlay = document.getElementById('app-modal-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    _appModalCloseTimer = setTimeout(() => {
      _appModalCloseTimer = null;
      if (!overlay.classList.contains('show')) {
        overlay.style.display = 'none';
        const okFooter = document.getElementById('app-modal-ok-footer');
        const confirmFooter = document.getElementById('app-modal-confirm-footer');
        if (okFooter) okFooter.style.display = 'flex';
        if (confirmFooter) confirmFooter.style.display = 'none';
      }
    }, 300);
  }
}

export function showConfirmModal(title: string, message: string, confirmButtonText: string | null = null): Promise<boolean> {
  const win = getGlobal();
  if (_confirmModalResolve || win._confirmModalResolve) return Promise.resolve(false);

  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }

    const overlay = document.getElementById('app-modal-overlay');
    const titleEl = document.getElementById('app-modal-title');
    const msgEl = document.getElementById('app-modal-message');
    const detailsEl = document.getElementById('app-modal-details');
    const okFooter = document.getElementById('app-modal-ok-footer');
    const confirmFooter = document.getElementById('app-modal-confirm-footer');
    const deleteBtn = document.getElementById('app-modal-delete-btn');
    
    if (!overlay || !titleEl || !msgEl || !detailsEl || !okFooter || !confirmFooter || !deleteBtn) {
      resolve(false);
      return;
    }
    
    titleEl.textContent = title;
    msgEl.textContent = message;
    detailsEl.style.display = 'none';
    
    deleteBtn.textContent = confirmButtonText || t('modals.deleteBtn') || 'Delete';
    
    okFooter.style.display = 'none';
    confirmFooter.style.display = 'flex';
    
    if (_appModalCloseTimer !== null) {
      clearTimeout(_appModalCloseTimer);
      _appModalCloseTimer = null;
    }
    if (_appModalTrap) {
      _appModalTrap.release();
      _appModalTrap = null;
    }
    _confirmModalResolve = resolve;
    win._confirmModalResolve = resolve;
    
    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');

    _appModalTrap = _trapModalFocus(overlay, () => {
      resolveAppConfirm(false);
    });

    safeRaf(() => {
      if (typeof document === 'undefined') return;
      const cancelBtn = document.getElementById('app-modal-cancel-btn');
      if (cancelBtn && cancelBtn.offsetParent !== null) {
        cancelBtn.focus();
      } else {
        const first = overlay.querySelector('button:not([disabled])') as HTMLElement | null;
        if (first) first.focus();
      }
    });
  });
}

export function resolveAppConfirm(value: boolean): void {
  const win = getGlobal();
  const resolve = _confirmModalResolve || win._confirmModalResolve;
  if (resolve) {
    _confirmModalResolve = null;
    win._confirmModalResolve = null;
    resolve(value);
  }
  closeAppModal();
}

// ----------------- About Modal & Update Checker -----------------
let _aboutModalTimer: any = null;
let _aboutModalLastFocus: HTMLElement | null = null;

export interface UpdateCheckerState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';
  latestVersion: string | null;
  releaseUrl: string | null;
  errorMsg: string | null;
}

let _updateCheckerState: UpdateCheckerState = {
  status: 'idle',
  latestVersion: null,
  releaseUrl: null,
  errorMsg: null
};

export function getUpdateCheckerState(): UpdateCheckerState {
  return _updateCheckerState;
}

let _isBackgroundUpdateCheck = false;
let _updateCheckGeneration = 0;
let _activeUpdateController: AbortController | null = null;

export function resetUpdateCheckerState(clearStorage = false): void {
  _isBackgroundUpdateCheck = false;
  _updateCheckGeneration++;
  if (_activeUpdateController) {
    _activeUpdateController.abort();
    _activeUpdateController = null;
  }
  _updateCheckerState = {
    status: 'idle',
    latestVersion: null,
    releaseUrl: null,
    errorMsg: null
  };
  if (clearStorage) {
    removeStorageItem(UPDATE_CACHE_STORAGE_KEY);
    removeStorageItem(UPDATE_NOTIFIED_VERSION_KEY);
  }
}

export function compareSemver(v1: string, v2: string): number {
  const clean = (v: string) => String(v || '').trim().replace(/^v/i, '');
  const [clean1, pre1] = clean(v1).split('-');
  const [clean2, pre2] = clean(v2).split('-');
  const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

  const len = Math.max(parts1.length, parts2.length, 3);
  for (let i = 0; i < len; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  if (pre1 && !pre2) return -1;
  if (!pre1 && pre2) return 1;
  if (pre1 && pre2) {
    const p1 = pre1.split('.');
    const p2 = pre2.split('.');
    const pLen = Math.max(p1.length, p2.length);
    for (let i = 0; i < pLen; i++) {
      const seg1 = p1[i];
      const seg2 = p2[i];
      if (seg1 === undefined) return -1;
      if (seg2 === undefined) return 1;
      const n1 = parseInt(seg1, 10);
      const n2 = parseInt(seg2, 10);
      if (!isNaN(n1) && !isNaN(n2)) {
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
      } else {
        const cmp = seg1.localeCompare(seg2);
        if (cmp !== 0) return cmp > 0 ? 1 : -1;
      }
    }
  }
  return 0;
}

export function renderSidebarUpdateIndicator(): void {
  if (typeof document === 'undefined') return;

  const sidebarBtn = document.getElementById('sidebar-about-btn');
  if (!sidebarBtn) return;

  const badge = document.getElementById('sidebar-about-update-badge');
  const hasUpdate = _updateCheckerState.status === 'available';

  if (hasUpdate) {
    sidebarBtn.classList.add('has-update');
    sidebarBtn.setAttribute('data-update-available', 'true');
    sidebarBtn.removeAttribute('data-i18n-title');
    const availableTitle = t('about.updateAvailable', { version: _updateCheckerState.latestVersion || '' });
    sidebarBtn.title = availableTitle;
    sidebarBtn.setAttribute('aria-label', availableTitle);
    if (badge) {
      badge.hidden = false;
      if (!badge.classList?.contains('text-scrambling')) {
        badge.textContent = t('about.sidebarUpdateBadge');
      }
    }
  } else {
    sidebarBtn.classList.remove('has-update');
    sidebarBtn.removeAttribute('data-update-available');
    sidebarBtn.setAttribute('data-i18n-title', 'nav.about');
    const defaultTitle = t('nav.about');
    sidebarBtn.title = defaultTitle;
    sidebarBtn.setAttribute('aria-label', defaultTitle);
    if (badge) {
      badge.hidden = true;
      badge.textContent = '';
    }
  }
}

export function renderUpdateCheckerUI(): void {
  if (typeof document === 'undefined') return;

  renderSidebarUpdateIndicator();

  const card = document.getElementById('about-update-card');
  const iconWrapper = document.getElementById('about-update-icon-wrapper');
  const statusEl = document.getElementById('about-update-status');
  const subtextEl = document.getElementById('about-update-subtext');
  const btn = document.getElementById('about-update-btn') as HTMLButtonElement | null;
  const btnText = document.getElementById('about-update-btn-text');

  if (!card || !statusEl || !subtextEl || !btn || !btnText) return;

  card.classList.remove('state-checking', 'state-up-to-date', 'state-update-available', 'state-error');

  const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';
  const setTextSafe = (el: HTMLElement, text: string) => {
    if (!el.classList?.contains('text-scrambling')) {
      el.textContent = text;
    }
  };

  switch (_updateCheckerState.status) {
    case 'checking':
      card.classList.add('state-checking');
      btn.disabled = true;
      btn.onclick = null;
      statusEl.removeAttribute('data-i18n');
      setTextSafe(statusEl, t('about.checkingUpdates'));
      subtextEl.textContent = 'api.github.com';
      btnText.removeAttribute('data-i18n');
      setTextSafe(btnText, t('about.checkingShort'));
      if (iconWrapper) {
        iconWrapper.innerHTML = `
          <svg class="about-update-icon icon-checking" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        `;
      }
      break;

    case 'up-to-date':
      card.classList.add('state-up-to-date');
      btn.disabled = false;
      btn.onclick = () => checkForAppUpdates();
      statusEl.removeAttribute('data-i18n');
      setTextSafe(statusEl, t('about.upToDate'));
      subtextEl.textContent = `v${currentVer}`;
      btnText.removeAttribute('data-i18n');
      setTextSafe(btnText, t('about.checkAgain'));
      if (iconWrapper) {
        iconWrapper.innerHTML = `
          <svg class="about-update-icon icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        `;
      }
      break;

    case 'available':
      card.classList.add('state-update-available');
      btn.disabled = false;
      btn.onclick = () => {
        const url = _updateCheckerState.releaseUrl || 'https://github.com/AtomicError/whisper-desktop/releases/latest';
        const win = getGlobal();
        if (typeof win.openUrl === 'function') {
          win.openUrl(url);
        } else {
          window.open(url, '_blank');
        }
      };
      statusEl.removeAttribute('data-i18n');
      setTextSafe(statusEl, t('about.updateAvailable', { version: _updateCheckerState.latestVersion || '' }));
      subtextEl.textContent = `v${currentVer} → ${_updateCheckerState.latestVersion}`;
      btnText.removeAttribute('data-i18n');
      setTextSafe(btnText, t('about.viewRelease'));
      if (iconWrapper) {
        iconWrapper.innerHTML = `
          <svg class="about-update-icon icon-update" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        `;
      }
      break;

    case 'error':
      card.classList.add('state-error');
      btn.disabled = false;
      btn.onclick = () => checkForAppUpdates();
      statusEl.removeAttribute('data-i18n');
      setTextSafe(statusEl, t('about.updateError'));
      subtextEl.textContent = _updateCheckerState.errorMsg || 'GitHub API unreachable';
      btnText.removeAttribute('data-i18n');
      setTextSafe(btnText, t('about.retryCheck'));
      if (iconWrapper) {
        iconWrapper.innerHTML = `
          <svg class="about-update-icon icon-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        `;
      }
      break;

    case 'idle':
    default:
      btn.disabled = false;
      btn.onclick = () => checkForAppUpdates();
      statusEl.setAttribute('data-i18n', 'about.updateTitle');
      setTextSafe(statusEl, t('about.updateTitle'));
      subtextEl.textContent = 'GitHub Releases';
      btnText.setAttribute('data-i18n', 'about.checkUpdate');
      setTextSafe(btnText, t('about.checkUpdate'));
      if (iconWrapper) {
        iconWrapper.innerHTML = `
          <svg class="about-update-icon icon-idle" id="about-update-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
            <path d="M16 21h5v-5"/>
          </svg>
        `;
      }
      break;
  }
}

const MIN_UPDATE_CHECK_DELAY_MS = 600;
const UPDATE_CHECK_TIMEOUT_MS = 8000;
const STARTUP_UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CACHE_STORAGE_KEY = 'whisper_update_check_cache';
const UPDATE_NOTIFIED_VERSION_KEY = 'whisper_last_notified_update_version';

interface UpdateCheckCache {
  checkedAt: number;
  latestVersion: string;
  releaseUrl: string;
}

function readStorageItem(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      return localStorage.getItem(key);
    }
  } catch (_) {}
  return null;
}

function writeStorageItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
      localStorage.setItem(key, value);
    }
  } catch (_) {}
}

function removeStorageItem(key: string): void {
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
      localStorage.removeItem(key);
    }
  } catch (_) {}
}

const DEFAULT_RELEASES_URL = 'https://github.com/AtomicError/whisper-desktop/releases/latest';

function isSafeHttpsUrl(url: string | undefined | null): url is string {
  return typeof url === 'string' && url.trim().startsWith('https://');
}

function formatReleaseTag(tag: string): string {
  const trimmed = tag.trim();
  return /^v/i.test(trimmed) ? `v${trimmed.slice(1)}` : `v${trimmed}`;
}

function readUpdateCache(): UpdateCheckCache | null {
  const raw = readStorageItem(UPDATE_CACHE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>;
    const ageMs = typeof parsed.checkedAt === 'number' ? Date.now() - parsed.checkedAt : NaN;
    if (
      typeof parsed.checkedAt === 'number' &&
      Number.isFinite(parsed.checkedAt) &&
      ageMs >= 0 &&
      ageMs < STARTUP_UPDATE_CHECK_TTL_MS &&
      typeof parsed.latestVersion === 'string' &&
      parsed.latestVersion.trim().length > 0 &&
      isSafeHttpsUrl(parsed.releaseUrl)
    ) {
      return {
        checkedAt: parsed.checkedAt,
        latestVersion: parsed.latestVersion.trim(),
        releaseUrl: parsed.releaseUrl.trim()
      };
    }
  } catch (_) {}
  return null;
}

function writeUpdateCache(latestVersion: string, releaseUrl: string): void {
  const payload: UpdateCheckCache = {
    checkedAt: Date.now(),
    latestVersion,
    releaseUrl
  };
  writeStorageItem(UPDATE_CACHE_STORAGE_KEY, JSON.stringify(payload));
}

function notifyUpdateAvailableOnce(latestVersion: string): boolean {
  if (!latestVersion) return false;
  const lastNotified = readStorageItem(UPDATE_NOTIFIED_VERSION_KEY);
  if (lastNotified === latestVersion) return false;

  writeStorageItem(UPDATE_NOTIFIED_VERSION_KEY, latestVersion);
  showNotification(
    t('about.updateAvailable', { version: latestVersion }),
    'info',
    9000,
    {
      label: t('about.viewUpdate'),
      onClick: () => openAboutModal()
    }
  );
  return true;
}

interface GitHubReleaseResponse {
  tag_name?: string;
  name?: string;
  html_url?: string;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<{ latestTag: string; releaseUrl: string }> {
  const cacheBuster = `t=${Date.now()}`;
  const targetUrl = `https://api.github.com/repos/AtomicError/whisper-desktop/releases/latest?${cacheBuster}`;

  const res = await fetch(targetUrl, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      'Accept': 'application/vnd.github.v3+json'
    },
    signal
  });

  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('Rate limit exceeded');
    } else if (res.status === 404) {
      throw new Error('No release found');
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const data: GitHubReleaseResponse = await res.json();
  const latestTag = (data.tag_name || data.name || '').trim();
  const releaseUrl = isSafeHttpsUrl(data.html_url) ? data.html_url.trim() : DEFAULT_RELEASES_URL;

  if (!latestTag) {
    throw new Error('Invalid release metadata');
  }

  return { latestTag, releaseUrl };
}

export async function checkForAppUpdates(options?: { silent?: boolean }): Promise<void> {
  const silent = Boolean(options?.silent);
  if (silent) {
    if (_updateCheckerState.status === 'checking' || _isBackgroundUpdateCheck) return;
    _isBackgroundUpdateCheck = true;
  } else {
    if (_updateCheckerState.status === 'checking') return;
    _isBackgroundUpdateCheck = false;
    if (_activeUpdateController) {
      _activeUpdateController.abort();
      _activeUpdateController = null;
    }
    _updateCheckerState = {
      status: 'checking',
      latestVersion: null,
      releaseUrl: null,
      errorMsg: null
    };
    renderUpdateCheckerUI();
  }

  const generation = ++_updateCheckGeneration;
  const controller = new AbortController();
  _activeUpdateController = controller;
  let timeoutId: any = null;
  let uiRendered = false;

  try {
    timeoutId = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);

    const minDelay = silent ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, MIN_UPDATE_CHECK_DELAY_MS));
    let fetchError: any = null;
    let releaseData: { latestTag: string; releaseUrl: string } | null = null;

    try {
      releaseData = await fetchLatestRelease(controller.signal);
    } catch (e) {
      fetchError = e;
    }

    await minDelay;

    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (generation !== _updateCheckGeneration) {
      return;
    }

    if (fetchError) {
      throw fetchError;
    }

    const latestTag = releaseData?.latestTag || '';
    const releaseUrl = isSafeHttpsUrl(releaseData?.releaseUrl) ? releaseData!.releaseUrl.trim() : DEFAULT_RELEASES_URL;
    const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';
    const isNewer = compareSemver(latestTag, currentVer) > 0;
    const formattedTag = formatReleaseTag(latestTag);

    writeUpdateCache(formattedTag, releaseUrl);

    _updateCheckerState = {
      status: isNewer ? 'available' : 'up-to-date',
      latestVersion: formattedTag,
      releaseUrl,
      errorMsg: null
    };

    if (silent && isNewer) {
      renderUpdateCheckerUI();
      uiRendered = true;
      notifyUpdateAvailableOnce(formattedTag);
    }
  } catch (err: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (generation !== _updateCheckGeneration) {
      return;
    }
    if (silent) {
      console.debug('[Updater] Silent startup update check failed:', err?.message || err);
      return;
    }
    let msg = 'GitHub API unreachable';
    if (err && err.name === 'AbortError') {
      msg = 'Connection timed out';
    } else if (err && err.message) {
      msg = err.message;
    }
    _updateCheckerState = {
      status: 'error',
      latestVersion: null,
      releaseUrl: null,
      errorMsg: msg
    };
  } finally {
    if (_activeUpdateController === controller) {
      _activeUpdateController = null;
    }
    if (silent && generation === _updateCheckGeneration) {
      _isBackgroundUpdateCheck = false;
    }
    if (!uiRendered && generation === _updateCheckGeneration) {
      renderUpdateCheckerUI();
    }
  }
}

export async function runStartupUpdateCheck(autoCheckEnabled = true): Promise<void> {
  if (!autoCheckEnabled) return;

  const cached = readUpdateCache();
  if (cached) {
    const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';
    const isNewer = compareSemver(cached.latestVersion, currentVer) > 0;
    _updateCheckerState = {
      status: isNewer ? 'available' : 'up-to-date',
      latestVersion: cached.latestVersion,
      releaseUrl: cached.releaseUrl,
      errorMsg: null
    };
    renderUpdateCheckerUI();
    if (isNewer) {
      notifyUpdateAvailableOnce(cached.latestVersion);
    }
    return;
  }

  await checkForAppUpdates({ silent: true });
}

export function syncAppVersionUI(): void {
  if (typeof document === 'undefined') return;

  try {
    const ver = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const sidebarVer = document.getElementById('sidebar-about-version-text');
    if (sidebarVer && ver) sidebarVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;
    const modalVer = document.getElementById('about-modal-version-text');
    if (modalVer && ver) modalVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;

    const liveWhisper = getLatestWhisperEngineStatus();
    const useLiveWhisper = liveWhisper && (liveWhisper.bundledAvailable === false || liveWhisper.configuredSource === 'system');
    const whisperEl = document.getElementById('about-whisper-version-text');
    if (whisperEl) {
      if (useLiveWhisper) {
        const sysLabel = t('settings.whisperSystem') || 'System';
        if (liveWhisper.isAvailable) {
          const cleaned = formatWhisperEngineVersion(liveWhisper.version);
          whisperEl.textContent = `${cleaned} (${sysLabel})`;
        } else {
          const missingLabel = t('settings.engineMissingBadge') || 'Not Found';
          whisperEl.textContent = `${sysLabel} (${missingLabel})`;
        }
      } else {
        const whisperVer = typeof __WHISPER_CPP_VERSION__ !== 'undefined' ? __WHISPER_CPP_VERSION__ : 'v1.7.4';
        if (whisperVer) {
          whisperEl.textContent = whisperVer.startsWith('v') ? whisperVer : `v${whisperVer}`;
        }
      }
    }

    renderUpdateCheckerUI();
  } catch (_) {}
}

export function _handleAboutModalKeydown(e: KeyboardEvent): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('about-modal-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeAboutModal();
    return;
  }

  if (e.key === 'Tab') {
    const focusable = overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;

    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const card = overlay.querySelector('.about-modal-card');

    if (e.shiftKey) {
      const isFirst = document.activeElement === first;
      const isCard = document.activeElement === card;
      const isOutside = !overlay.contains(document.activeElement);
      if (isFirst || isCard || isOutside) {
        e.preventDefault();
        last.focus();
      }
    } else {
      const isLast = document.activeElement === last;
      const isOutside = !overlay.contains(document.activeElement);
      if (isLast || isOutside) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

export function openAboutModal(): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('about-modal-overlay');
  if (overlay) {
    if (_aboutModalTimer) {
      clearTimeout(_aboutModalTimer);
      _aboutModalTimer = null;
    }
    const activeEl = document.activeElement as HTMLElement | null;
    const isInsideToast = Boolean(
      activeEl &&
      (
        (typeof activeEl.closest === 'function' && activeEl.closest('.toast-notification')) ||
        (typeof activeEl.className === 'string' && activeEl.className.includes('toast-action-btn'))
      )
    );
    _aboutModalLastFocus = isInsideToast
      ? (document.getElementById('sidebar-about-btn') as HTMLElement | null)
      : activeEl;

    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');

    document.addEventListener('keydown', _handleAboutModalKeydown);

    safeRaf(() => {
      if (typeof document === 'undefined') return;
      syncAppVersionUI();
      const card = overlay.querySelector('.about-modal-card') as HTMLElement | null;
      if (card) {
        card.focus({ preventScroll: true });
      } else {
        const closeBtn = overlay.querySelector('.about-modal-close-btn') as HTMLElement | null;
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      }
    });
  }
}

export function closeAboutModal(): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('about-modal-overlay');
  if (overlay) {
    if (_aboutModalTimer) {
      clearTimeout(_aboutModalTimer);
    }
    overlay.classList.remove('show');
    document.removeEventListener('keydown', _handleAboutModalKeydown);

    _aboutModalTimer = setTimeout(() => {
      overlay.style.display = 'none';
      _aboutModalTimer = null;
    }, 250);

    if (_aboutModalLastFocus && typeof _aboutModalLastFocus.focus === 'function') {
      const isInDom = typeof document.body?.contains === 'function' ? document.body.contains(_aboutModalLastFocus) : true;
      const targetFocus = isInDom
        ? _aboutModalLastFocus
        : (document.getElementById('sidebar-about-btn') as HTMLElement | null);
      if (targetFocus && typeof targetFocus.focus === 'function') {
        try {
          targetFocus.focus();
        } catch (_) {}
      }
      _aboutModalLastFocus = null;
    }
  }
}

let _isAboutOverlayMouseDown = false;
let _isShortcutsOverlayMouseDown = false;
let _shortcutsModalTimer: ReturnType<typeof setTimeout> | null = null;
let _shortcutsModalLastFocus: HTMLElement | null = null;

export function _handleShortcutsModalKeydown(e: KeyboardEvent): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('shortcuts-modal-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;

  if (e.key === 'Escape' || ((e.key === '?' || e.key === '؟') && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    e.preventDefault();
    e.stopPropagation();
    closeShortcutsModal();
    return;
  }

  if (e.key === 'Tab') {
    const focusable = overlay.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const card = overlay.querySelector('.shortcuts-modal-card');

    if (e.shiftKey) {
      const isFirst = document.activeElement === first;
      const isCard = document.activeElement === card;
      const isOutside = !overlay.contains(document.activeElement);
      if (isFirst || isCard || isOutside) {
        e.preventDefault();
        last.focus();
      }
    } else {
      const isLast = document.activeElement === last;
      const isOutside = !overlay.contains(document.activeElement);
      if (isLast || isOutside) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

export function openShortcutsModal(): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('shortcuts-modal-overlay');
  if (overlay) {
    if (_shortcutsModalTimer) {
      clearTimeout(_shortcutsModalTimer);
      _shortcutsModalTimer = null;
    }
    if (!overlay.classList.contains('show')) {
      _shortcutsModalLastFocus = (document.activeElement as HTMLElement) || null;
    }

    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');

    document.addEventListener('keydown', _handleShortcutsModalKeydown);

    safeRaf(() => {
      if (typeof document === 'undefined') return;
      const card = overlay.querySelector('.shortcuts-modal-card') as HTMLElement | null;
      if (card) {
        card.focus({ preventScroll: true });
      } else {
        const closeBtn = overlay.querySelector('.btn-shortcuts-close, .about-modal-close-btn') as HTMLElement | null;
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      }
    });
  }
}

export function closeShortcutsModal(): void {
  if (typeof document === 'undefined') return;

  const overlay = document.getElementById('shortcuts-modal-overlay');
  if (overlay) {
    if (_shortcutsModalTimer) {
      clearTimeout(_shortcutsModalTimer);
    }
    overlay.classList.remove('show');
    document.removeEventListener('keydown', _handleShortcutsModalKeydown);

    _shortcutsModalTimer = setTimeout(() => {
      overlay.style.display = 'none';
      _shortcutsModalTimer = null;
    }, 220);

    if (_shortcutsModalLastFocus && typeof _shortcutsModalLastFocus.focus === 'function') {
      try {
        _shortcutsModalLastFocus.focus();
      } catch (_) {}
      _shortcutsModalLastFocus = null;
    }
  }
}

export function setupAboutModalEvents(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('mousedown', (e) => {
    const aboutOverlay = document.getElementById('about-modal-overlay');
    _isAboutOverlayMouseDown = Boolean(aboutOverlay && e.target === aboutOverlay);
    const shortcutsOverlay = document.getElementById('shortcuts-modal-overlay');
    _isShortcutsOverlayMouseDown = Boolean(shortcutsOverlay && e.target === shortcutsOverlay);
  });

  document.addEventListener('click', (e) => {
    const aboutOverlay = document.getElementById('about-modal-overlay');
    if (aboutOverlay && e.target === aboutOverlay && _isAboutOverlayMouseDown) {
      closeAboutModal();
    }
    const shortcutsOverlay = document.getElementById('shortcuts-modal-overlay');
    if (shortcutsOverlay && e.target === shortcutsOverlay && _isShortcutsOverlayMouseDown) {
      closeShortcutsModal();
    }
    _isAboutOverlayMouseDown = false;
    _isShortcutsOverlayMouseDown = false;
  });
}

// ----------------- Batch Error Dialog -----------------
let _batchErrorModalTrap: { release: () => void } | null = null;

export function showBatchErrorDialog(fileName: string, errorMsg: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve('abort');
      return;
    }
    if (_batchErrorModalTrap) {
      _batchErrorModalTrap.release();
      _batchErrorModalTrap = null;
    }
    const modal = document.getElementById('batch-error-modal');
    const msgEl = document.getElementById('batch-error-message');
    if (msgEl) {
      msgEl.textContent = t('modals.batchErrorFormatted', { file: fileName, error: errorMsg });
    }

    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => modal.classList.add('show'), 10);

      _batchErrorModalTrap = _trapModalFocus(modal, () => {
        const win = getGlobal();
        if (typeof win.resolveBatchError === 'function') {
          win.resolveBatchError('abort');
        }
      });
    }

    const win = getGlobal();
    win.resolveBatchError = function(choice: string) {
      if (_batchErrorModalTrap) {
        _batchErrorModalTrap.release();
        _batchErrorModalTrap = null;
      }
      if (modal) {
        modal.classList.remove('show');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
      }
      resolve(choice);
    };

    safeRaf(() => {
      if (modal) {
        const retryBtn = (modal.querySelector('button.btn-primary') || modal.querySelector('button')) as HTMLButtonElement | null;
        if (retryBtn) retryBtn.focus();
      }
    });
  });
}

// ----------------- Synchronize Window Bindings -----------------
export function syncAppModalWindowBindings(): void {
  const win = getGlobal();
  if (!win) return;

  win.showNotification = showNotification;
  win.showAppModal = showAppModal;
  win.closeAppModal = closeAppModal;
  win.showConfirmModal = showConfirmModal;
  win.resolveAppConfirm = resolveAppConfirm;
  win.showBatchErrorDialog = showBatchErrorDialog;
  win.openAboutModal = openAboutModal;
  win.closeAboutModal = closeAboutModal;
  win.openShortcutsModal = openShortcutsModal;
  win.closeShortcutsModal = closeShortcutsModal;
  win.checkForAppUpdates = checkForAppUpdates;
  win.renderUpdateCheckerUI = renderUpdateCheckerUI;
  win.syncAppVersionUI = syncAppVersionUI;
}

if (typeof window !== 'undefined') {
  syncAppModalWindowBindings();
  setupAboutModalEvents();
}

export const appModal = {
  formatToast: formatToastMessage,
  notify: showNotification,
  trapFocus: _trapModalFocus,
  show: showAppModal,
  close: closeAppModal,
  confirm: showConfirmModal,
  resolveConfirm: resolveAppConfirm,
  showBatchErrorDialog,
  compareSemver,
  renderUpdateUI: renderUpdateCheckerUI,
  checkUpdates: checkForAppUpdates,
  checkStartupUpdates: runStartupUpdateCheck,
  fetchLatestRelease,
  syncVersionUI: syncAppVersionUI,
  openAbout: openAboutModal,
  closeAbout: closeAboutModal,
  openShortcuts: openShortcutsModal,
  closeShortcuts: closeShortcutsModal,
  getUpdateState: getUpdateCheckerState,
  resetUpdateState: resetUpdateCheckerState,
  syncWindowBindings: syncAppModalWindowBindings
};
