// System Feedback, Toasts, Focus Trap, Confirmation & About Modals, and Online Update Checker
import { t } from '../i18n/index';

if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

declare const __APP_VERSION__: string;
declare const __WHISPER_CPP_VERSION__: string;

declare global {
  interface Window {
    showNotification: (msg: string, type: string) => void;
    showAppModal: (title: string, message: string, details?: string) => void;
    closeAppModal: () => void;
    showConfirmModal: (title: string, message: string, confirmButtonText?: string | null) => Promise<boolean>;
    resolveAppConfirm: (value: boolean) => void;
    _confirmModalResolve?: ((value: boolean) => void) | null;
    showBatchErrorDialog: (fileName: string, errorMsg: string) => Promise<string>;
    resolveBatchError?: (choice: string) => void;
    openAboutModal: () => void;
    closeAboutModal: () => void;
    checkForAppUpdates: () => Promise<void>;
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

export function showNotification(message: any, type = 'info', customDuration: number | null = null): void {
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
  for (const existing of Array.from(existingToasts) as any[]) {
    const msgEl = existing.querySelector('.toast-message');
    const existingRaw = existing._rawMessage;
    const existingText = msgEl ? msgEl.textContent.replace(/\u00A0/g, ' ').trim() : '';
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

  const toast = document.createElement('div') as any;
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
  
  const startTimer = (dur = remainingTime) => {
    if (dur <= 0 || dur === Infinity) return;
    startTime = Date.now();
    remainingTime = dur;
    isPaused = false;
    if (progressBar) {
      progressBar.style.transition = 'none';
      progressBar.style.width = '100%';
      void progressBar.offsetWidth; // trigger reflow
      progressBar.style.transition = `width ${dur}ms linear`;
      progressBar.style.width = '0%';
    }
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(closeToast, dur);
  };
  
  const pauseTimer = () => {
    if (duration <= 0 || duration === Infinity || isPaused) return;
    isPaused = true;
    clearTimeout(timerId);
    remainingTime -= (Date.now() - startTime);
    if (remainingTime < 0) remainingTime = 0;
    if (progressBar) {
      const computedWidth = getComputedStyle(progressBar).width;
      progressBar.style.transition = 'none';
      progressBar.style.width = computedWidth;
    }
  };

  const resumeTimer = () => {
    if (duration <= 0 || duration === Infinity || !isPaused) return;
    isPaused = false;
    if (remainingTime > 0) {
      startTime = Date.now();
      if (progressBar) {
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

  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', resumeTimer);
  
  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeToast();
    });
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
let _confirmModalResolve: ((value: boolean) => void) | null = null;

export function showAppModal(title: string, message: string, details = ''): void {
  if (typeof document === 'undefined') return;

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
    setTimeout(() => {
      overlay.style.display = 'none';
      const okFooter = document.getElementById('app-modal-ok-footer');
      const confirmFooter = document.getElementById('app-modal-confirm-footer');
      if (okFooter) okFooter.style.display = 'flex';
      if (confirmFooter) confirmFooter.style.display = 'none';
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

export function renderUpdateCheckerUI(): void {
  if (typeof document === 'undefined') return;

  const card = document.getElementById('about-update-card');
  const iconWrapper = document.getElementById('about-update-icon-wrapper');
  const statusEl = document.getElementById('about-update-status');
  const subtextEl = document.getElementById('about-update-subtext');
  const btn = document.getElementById('about-update-btn') as HTMLButtonElement | null;
  const btnText = document.getElementById('about-update-btn-text');

  if (!card || !statusEl || !subtextEl || !btn || !btnText) return;

  card.classList.remove('state-checking', 'state-up-to-date', 'state-update-available', 'state-error');

  const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';

  switch (_updateCheckerState.status) {
    case 'checking':
      card.classList.add('state-checking');
      btn.disabled = true;
      btn.onclick = null;
      statusEl.removeAttribute('data-i18n');
      statusEl.textContent = t('about.checkingUpdates');
      subtextEl.textContent = 'api.github.com';
      btnText.removeAttribute('data-i18n');
      btnText.textContent = t('about.checkingShort');
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
      statusEl.textContent = t('about.upToDate');
      subtextEl.textContent = `v${currentVer}`;
      btnText.removeAttribute('data-i18n');
      btnText.textContent = t('about.checkAgain');
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
      statusEl.textContent = t('about.updateAvailable', { version: _updateCheckerState.latestVersion || '' });
      subtextEl.textContent = `v${currentVer} → ${_updateCheckerState.latestVersion}`;
      btnText.removeAttribute('data-i18n');
      btnText.textContent = t('about.viewRelease');
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
      statusEl.textContent = t('about.updateError');
      subtextEl.textContent = _updateCheckerState.errorMsg || 'GitHub API unreachable';
      btnText.removeAttribute('data-i18n');
      btnText.textContent = t('about.retryCheck');
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
      statusEl.textContent = t('about.updateTitle');
      subtextEl.textContent = 'GitHub Releases';
      btnText.setAttribute('data-i18n', 'about.checkUpdate');
      btnText.textContent = t('about.checkUpdate');
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

export async function checkForAppUpdates(): Promise<void> {
  if (_updateCheckerState.status === 'checking') return;

  _updateCheckerState = {
    status: 'checking',
    latestVersion: null,
    releaseUrl: null,
    errorMsg: null
  };
  renderUpdateCheckerUI();

  let timeoutId: any = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch('https://api.github.com/repos/AtomicError/whisper-desktop/releases/latest', {
      headers: {
        'Accept': 'application/vnd.github.v3+json'
      },
      signal: controller.signal
    });
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (!res.ok) {
      if (res.status === 403) {
        throw new Error('Rate limit exceeded');
      } else if (res.status === 404) {
        throw new Error('No release found');
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    const latestTag = (data.tag_name || data.name || '').trim();
    const releaseUrl = data.html_url || 'https://github.com/AtomicError/whisper-desktop/releases/latest';

    if (!latestTag) {
      throw new Error('Invalid release metadata');
    }

    const currentVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';

    if (compareSemver(latestTag, currentVer) > 0) {
      _updateCheckerState = {
        status: 'available',
        latestVersion: latestTag.startsWith('v') ? latestTag : `v${latestTag}`,
        releaseUrl: releaseUrl,
        errorMsg: null
      };
    } else {
      _updateCheckerState = {
        status: 'up-to-date',
        latestVersion: latestTag.startsWith('v') ? latestTag : `v${latestTag}`,
        releaseUrl: releaseUrl,
        errorMsg: null
      };
    }
  } catch (err: any) {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
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
    renderUpdateCheckerUI();
  }
}

export function syncAppVersionUI(): void {
  if (typeof document === 'undefined') return;

  try {
    const ver = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const sidebarVer = document.getElementById('sidebar-about-version-text');
    if (sidebarVer && ver) sidebarVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;
    const modalVer = document.getElementById('about-modal-version-text');
    if (modalVer && ver) modalVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;

    const whisperVer = typeof __WHISPER_CPP_VERSION__ !== 'undefined' ? __WHISPER_CPP_VERSION__ : 'v1.7.4';
    const whisperEl = document.getElementById('about-whisper-version-text');
    if (whisperEl && whisperVer) whisperEl.textContent = whisperVer.startsWith('v') ? whisperVer : `v${whisperVer}`;

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
    _aboutModalLastFocus = document.activeElement as HTMLElement | null;

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
      try {
        _aboutModalLastFocus.focus();
      } catch (_) {}
      _aboutModalLastFocus = null;
    }
  }
}

let _isAboutOverlayMouseDown = false;

export function setupAboutModalEvents(): void {
  if (typeof document === 'undefined') return;

  document.addEventListener('mousedown', (e) => {
    const overlay = document.getElementById('about-modal-overlay');
    _isAboutOverlayMouseDown = Boolean(overlay && e.target === overlay);
  });

  document.addEventListener('click', (e) => {
    const overlay = document.getElementById('about-modal-overlay');
    if (overlay && e.target === overlay && _isAboutOverlayMouseDown) {
      closeAboutModal();
    }
    _isAboutOverlayMouseDown = false;
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
  syncVersionUI: syncAppVersionUI,
  openAbout: openAboutModal,
  closeAbout: closeAboutModal,
  getUpdateState: getUpdateCheckerState,
  syncWindowBindings: syncAppModalWindowBindings
};
