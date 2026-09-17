import { hardsubController } from './hardsub.ts';
import { translationStudioController } from './translationStudio.ts';
import { initI18n, t, setLanguage, getLanguage, translateDOM, isRtlLanguage, applyTextDirection, applyContentDirection, clearContentDirection, isolateDirection, isolateLtr, APP_NAME } from './i18n/index.ts';
import { normalizeForSearch } from './languages.ts';
import { initLanguageSelects, renderLanguageSelect } from './languageSelect.ts';

// Global error catcher for visual debugging in frontend
window.onerror = function(message, source, lineno, colno, error) {
  const errDiv = document.createElement('div');
  errDiv.style.position = 'fixed';
  errDiv.style.top = '0';
  errDiv.style.left = '0';
  errDiv.style.width = '100%';
  errDiv.style.background = '#ef4444';
  errDiv.style.color = 'white';
  errDiv.style.zIndex = '100000';
  errDiv.style.padding = '16px';
  errDiv.style.fontFamily = 'monospace';
  errDiv.style.fontSize = '14px';
  errDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  errDiv.innerHTML = `<strong>Frontend Error:</strong> ${message}<br><small>at ${source}:${lineno}:${colno}</small>`;
  document.body.appendChild(errDiv);
  return false;
};

function getBasename(path) {
  if (!path) return '';
  return path.replace(/\\/g, '/').split('/').pop();
}
/**
 * The single-file card names the user's own file, so that line reads in the file's own
 * direction rather than the interface's: `01 - intro.mkv` keeps its number in front in a
 * Persian interface instead of coming out as `intro.mkv - 01`. Called with no file it goes
 * back to the interface's copy and hands the line back to the interface's direction.
 */
function updateMediaCardName(path) {
  const nameEl = document.getElementById('lbl-file-name');
  if (!nameEl) return;
  if (path) {
    const name = getBasename(path);
    nameEl.textContent = name;
    applyContentDirection(nameEl, name);
  } else {
    nameEl.textContent = t('transcribe.noFileLoaded');
    clearContentDirection(nameEl);
  }
}

function getParentDir(path) {
  if (!path) return '';
  const clean = path.trim();
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return lastSlash >= 0 ? clean.substring(0, lastSlash) : '';
}

// Premium Glassmorphic Toast Notification System
window.showNotification = function(message, type = 'info', customDuration = null) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  
  // Extended durations: 10s for errors, 6s for info/success
  let defaultDuration = 6000;
  if (type === 'error') {
    defaultDuration = 10000;
  }
  const duration = (customDuration !== null) ? customDuration : defaultDuration;

  // Smart Deduplication: if an active toast with the identical message is already visible, refresh its lifetime and progress bar
  const existingToasts = container.querySelectorAll('.toast-notification');
  for (const existing of existingToasts) {
    const msgEl = existing.querySelector('.toast-message');
    if (msgEl && msgEl.textContent.trim() === String(message).trim() && !existing.classList.contains('hide')) {
      existing.style.animation = 'none';
      void existing.offsetWidth; // trigger reflow
      existing.style.animation = '';
      if (typeof existing._restartTimer === 'function') {
        existing._restartTimer(duration);
      }
      return;
    }
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else if (type === 'warning') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    // Info
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const closeSvg = `<svg class="toast-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-message"></div>
    <button class="toast-close-btn" title="${t('common.close')}" aria-label="${t('common.close')}">${closeSvg}</button>
    <div class="toast-progress-bar"></div>
  `;
  toast.querySelector('.toast-message').textContent = message;
  
  const progressBar = toast.querySelector('.toast-progress-bar');
  if (duration > 0 && duration !== Infinity) {
    progressBar.style.transition = `width ${duration}ms linear`;
  } else {
    progressBar.style.display = 'none';
  }
  
  container.appendChild(toast);
  
  let timerId = null;
  let startTime = Date.now();
  let remainingTime = duration;
  let isPaused = false;
  
  const closeToast = () => {
    if (toast.classList.contains('hide')) return;
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 400);
  };
  
  const startTimer = (dur = remainingTime) => {
    if (dur <= 0 || dur === Infinity) return;
    startTime = Date.now();
    remainingTime = dur;
    isPaused = false;
    progressBar.style.transition = 'none';
    progressBar.style.width = '100%';
    void progressBar.offsetWidth; // trigger reflow
    progressBar.style.transition = `width ${dur}ms linear`;
    progressBar.style.width = '0%';
    if (timerId) clearTimeout(timerId);
    timerId = setTimeout(closeToast, dur);
  };
  
  const pauseTimer = () => {
    if (duration <= 0 || duration === Infinity || isPaused) return;
    isPaused = true;
    clearTimeout(timerId);
    remainingTime -= (Date.now() - startTime);
    if (remainingTime < 0) remainingTime = 0;
    const computedWidth = getComputedStyle(progressBar).width;
    progressBar.style.transition = 'none';
    progressBar.style.width = computedWidth;
  };

  const resumeTimer = () => {
    if (duration <= 0 || duration === Infinity || !isPaused) return;
    isPaused = false;
    if (remainingTime > 0) {
      startTime = Date.now();
      progressBar.style.transition = `width ${remainingTime}ms linear`;
      progressBar.style.width = '0%';
      timerId = setTimeout(closeToast, remainingTime);
    } else {
      closeToast();
    }
  };

  toast._restartTimer = (newDuration) => {
    startTimer(newDuration);
  };

  toast.addEventListener('mouseenter', pauseTimer);
  toast.addEventListener('mouseleave', resumeTimer);
  
  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeToast();
    });
  }
  
  // Animate Entry
  setTimeout(() => {
    toast.classList.add('show');
    startTimer();
  }, 20);
};

// Centered Premium Glassmorphic Modal overlay API
window.showAppModal = function(title, message, details = '') {
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
    
    // Reset footers to default (OK visible, confirm hidden)
    if (okFooter) okFooter.style.display = 'flex';
    if (confirmFooter) confirmFooter.style.display = 'none';
    
    overlay.style.display = 'flex';
    // Trigger reflow to run CSS animation
    void overlay.offsetWidth;
    overlay.classList.add('show');
  }
};

window.closeAppModal = function() {
  // If a confirm modal is open, resolve as cancelled so the caller doesn't hang.
  // Inlined (not resolveAppConfirm) to avoid recursive closeAppModal calls.
  if (window._confirmModalResolve) {
    const resolve = window._confirmModalResolve;
    window._confirmModalResolve = null;
    resolve(false);
  }
  const overlay = document.getElementById('app-modal-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.style.display = 'none';
      // Reset footers to default after hidden
      const okFooter = document.getElementById('app-modal-ok-footer');
      const confirmFooter = document.getElementById('app-modal-confirm-footer');
      if (okFooter) okFooter.style.display = 'flex';
      if (confirmFooter) confirmFooter.style.display = 'none';
    }, 300);
  }
};

let _aboutModalTimer = null;
let _aboutModalLastFocus = null;

let _updateCheckerState = {
  status: 'idle',
  latestVersion: null,
  releaseUrl: null,
  errorMsg: null
};

function compareSemver(v1, v2) {
  const clean = (v) => String(v || '').trim().replace(/^v/i, '');
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

function renderUpdateCheckerUI() {
  const card = document.getElementById('about-update-card');
  const iconWrapper = document.getElementById('about-update-icon-wrapper');
  const statusEl = document.getElementById('about-update-status');
  const subtextEl = document.getElementById('about-update-subtext');
  const btn = document.getElementById('about-update-btn');
  const btnText = document.getElementById('about-update-btn-text');

  if (!card || !statusEl || !subtextEl || !btn || !btnText) return;

  card.classList.remove('state-checking', 'state-up-to-date', 'state-update-available', 'state-error');

  const currentVer = __APP_VERSION__;

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
      btn.onclick = () => window.checkForAppUpdates();
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
        if (typeof window.openUrl === 'function') {
          window.openUrl(url);
        } else {
          window.open(url, '_blank');
        }
      };
      statusEl.removeAttribute('data-i18n');
      statusEl.textContent = t('about.updateAvailable', { version: _updateCheckerState.latestVersion });
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
      btn.onclick = () => window.checkForAppUpdates();
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
      btn.onclick = () => window.checkForAppUpdates();
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

window.checkForAppUpdates = async function() {
  if (_updateCheckerState.status === 'checking') return;

  _updateCheckerState = {
    status: 'checking',
    latestVersion: null,
    releaseUrl: null,
    errorMsg: null
  };
  renderUpdateCheckerUI();

  let timeoutId = null;
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

    const currentVer = __APP_VERSION__;

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
  } catch (err) {
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
};

window.addEventListener('whisper:languageChanged', () => {
  renderUpdateCheckerUI();
  if (typeof window.updateFilterCounts === 'function') {
    window.updateFilterCounts();
  }
  if (typeof window.applyModelsFilterAndRender === 'function' && typeof currentProviderModels !== 'undefined' && currentProviderModels && currentProviderModels.length > 0) {
    window.applyModelsFilterAndRender(0);
  }
});

function syncAppVersionUI() {
  try {
    const ver = __APP_VERSION__;
    const sidebarVer = document.getElementById('sidebar-about-version-text');
    if (sidebarVer && ver) sidebarVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;
    const modalVer = document.getElementById('about-modal-version-text');
    if (modalVer && ver) modalVer.textContent = ver.startsWith('v') ? ver : `v${ver}`;
    renderUpdateCheckerUI();
  } catch (_) {}
}

function _handleAboutModalKeydown(e) {
  const overlay = document.getElementById('about-modal-overlay');
  if (!overlay || !overlay.classList.contains('show')) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    window.closeAboutModal();
    return;
  }

  if (e.key === 'Tab') {
    const focusable = overlay.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
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

window.openAboutModal = function() {
  const overlay = document.getElementById('about-modal-overlay');
  if (overlay) {
    if (_aboutModalTimer) {
      clearTimeout(_aboutModalTimer);
      _aboutModalTimer = null;
    }
    _aboutModalLastFocus = document.activeElement;

    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');

    document.addEventListener('keydown', _handleAboutModalKeydown);

    requestAnimationFrame(() => {
      syncAppVersionUI();
      const card = overlay.querySelector('.about-modal-card');
      if (card) {
        card.focus({ preventScroll: true });
      } else {
        const closeBtn = overlay.querySelector('.about-modal-close-btn');
        if (closeBtn) closeBtn.focus({ preventScroll: true });
      }
    });
  }
};

window.closeAboutModal = function() {
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
};

let _isAboutOverlayMouseDown = false;

document.addEventListener('mousedown', (e) => {
  const overlay = document.getElementById('about-modal-overlay');
  _isAboutOverlayMouseDown = Boolean(overlay && e.target === overlay);
});

document.addEventListener('click', (e) => {
  const overlay = document.getElementById('about-modal-overlay');
  if (overlay && e.target === overlay && _isAboutOverlayMouseDown) {
    window.closeAboutModal();
  }
  _isAboutOverlayMouseDown = false;
});

// Promise-based confirm dialog using the themed modal
window._confirmModalResolve = null;

window.showConfirmModal = function(title, message, confirmButtonText = null) {
  if (window._confirmModalResolve) return Promise.resolve(false);
  return new Promise((resolve) => {
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
    
    window._confirmModalResolve = resolve;
    
    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('show');
  });
};

window.resolveAppConfirm = function(value) {
  if (window._confirmModalResolve) {
    const resolve = window._confirmModalResolve;
    window._confirmModalResolve = null;
    resolve(value);
  }
  closeAppModal();
};

// Safe Tauri API extraction
let originalInvoke = null;
let originalListen = null;

try {
  if (window.__TAURI__) {
    originalInvoke = window.__TAURI__.core.invoke;
    originalListen = window.__TAURI__.event.listen;
    window.openUrl = (url) => {
      window.__TAURI__.opener.openUrl(url).catch(() => window.open(url, '_blank'));
    };
  } else {
    console.warn("Tauri global namespace not detected. Web fallback active.");
    window.openUrl = (url) => window.open(url, '_blank');
  }
} catch (e) {
  console.error("Failed to load Tauri core APIs:", e);
  window.openUrl = (url) => window.open(url, '_blank');
}

// Redefine invoke and listen to be safe functions with mocks if original APIs are missing
const invoke = async function(cmd, args = {}) {
  if (originalInvoke) {
    return await originalInvoke(cmd, args);
  }
  console.warn(`[Fallback] Mocking command: ${cmd}`);
  
  // Return standard default fallbacks to prevent frontend TypeError crashes
  if (cmd === 'load_settings') {
    return {
      selectedBackend: 'Standard',
      modelsDir: '/home/user/whisper-desktop/models',
      threads: 4,
      processors: 1,
      offsetT: 0,
      duration: 0,
      maxContext: -1,
      maxLen: 0,
      splitWord: false,
      bestOf: 5,
      beamSize: 5,
      audioCtx: 0,
      wordThold: 0.01,
      entropyThold: 2.4,
      logprobThold: -1.0,
      noSpeechThold: 0.6,
      temperature: 0.0,
      temperatureInc: 0.2,
      debugMode: false,
      translate: false,
      diarize: false,
      tinyDiarize: false,
      noFallback: false,
      flashAttn: true,
      outputTxt: false,
      outputVtt: false,
      outputSrt: true,
      outputLrc: false,
      outputCsv: false,
      outputJson: false,
      outputJsonFull: false,
      noPrints: false,
      printColors: false,
      printConfidence: false,
      printProgress: false,
      language: "auto",
      prompt: "",
      carryPrompt: false,
      modelPath: "ggml-base.en.bin",
      inputFile: "",
      ovDevice: "CPU",
      dtwEnabled: false,
      logScore: false,
      deviceID: 0,
      vad: false,
      vadModel: "",
      vadThold: 0.50,
      vadMinSpeech: 250,
      vadMinSil: 100,
      vadMaxSpeech: 30000.0,
      vadSpeechPad: 30,
      vadOverlap: 0.10
    };
  }
  if (cmd === 'check_build') {
    return true;
  }
  if (cmd === 'scan_models') {
    return {
      transModels: ['ggml-base.en.bin', 'ggml-small.bin'],
      vadModels: ['ggml-silero-v6.2.0.bin']
    };
  }
  if (cmd === 'get_ffmpeg_status') {
    const src = (args && args.source) || 'bundled';
    return {
      configuredSource: src,
      resolvedPath: '/usr/bin/ffmpeg',
      isAvailable: true,
      version: 'ffmpeg version 7.1',
      errorMessage: null
    };
  }
  return null;
};

const listen = function(event, handler) {
  if (originalListen) {
    return originalListen(event, handler);
  }
  console.warn(`[Fallback] Mocking event listener: ${event}`);
  return Promise.resolve(() => {});
};

// Native clipboard write via tauri-plugin-clipboard-manager with multi-tier fallback.
// Tier 1: Direct Tauri native command invoke('copy_to_clipboard', { text })
// Tier 2: Tauri Plugin command invoke('plugin:clipboard-manager|write_text', { text })
// Tier 3: Global plugin object window.__TAURI__.clipboardManager
// Tier 4: W3C Navigator Clipboard API (navigator.clipboard.writeText)
// Tier 5: Document execCommand fallback
const copyToClipboard = async function(text) {
  const cleanText = (text === null || text === undefined) ? '' : String(text);

  let lastError = null;

  // 1. Direct native Rust backend IPC (100% reliable on all OS platforms & webviews)
  try {
    if (typeof invoke === 'function') {
      await invoke('copy_to_clipboard', { text: cleanText });
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] Native copy_to_clipboard command failed, trying plugin:', err);
  }

  // 2. Preferred Native IPC via Tauri Plugin Clipboard Manager
  try {
    if (typeof invoke === 'function') {
      await invoke('plugin:clipboard-manager|write_text', { text: cleanText });
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] Tauri plugin IPC command failed, trying next provider:', err);
  }

  // 3. Global Tauri Plugin Object (if JS bundle is mounted)
  try {
    const tauriClipboard = (typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.clipboardManager) || null;
    if (tauriClipboard && typeof tauriClipboard.writeText === 'function') {
      await tauriClipboard.writeText(cleanText);
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] window.__TAURI__.clipboardManager failed:', err);
  }

  // 4. Web Navigator Clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(cleanText);
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] navigator.clipboard.writeText failed:', err);
  }

  // 5. Fallback: Hidden Textarea with document.execCommand('copy') for webview transient activation failures
  try {
    if (typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = cleanText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] document.execCommand copy fallback failed:', err);
  }

  const errDetail = (lastError && (lastError.message || String(lastError))) || 'No clipboard provider available.';
  throw new Error(`Failed to copy to clipboard: ${errDetail}`);
};

// Expose globally for console testing and window access
window.copyToClipboard = copyToClipboard;

window.openFileInEditor = async function(filePath) {
  if (!filePath) return;
  try {
    await invoke('open_file_in_editor', { filePath });
  } catch (err) {
    console.warn("open_file_in_editor fallback to opener plugin:", err);
    try {
      await invoke('plugin:opener|open_path', { path: filePath });
    } catch (e2) {
      const msg = (err && (err.message || err.toString())) || String(err);
      showNotification(t('toasts.openFileError', { error: msg }), "error");
    }
  }
};

window.splitFileNameAndExt = function(filename) {
  if (!filename) return { base: '', ext: '' };
  const match = filename.match(/^(.+?)(\.[a-zA-Z]{2,5}\.[a-zA-Z0-9]{2,4}|\.[a-zA-Z0-9]{2,5})$/);
  if (match) {
    return { base: match[1], ext: match[2] };
  }
  const lastDot = filename.lastIndexOf('.');
  if (lastDot > 0) {
    return { base: filename.substring(0, lastDot), ext: filename.substring(lastDot) };
  }
  return { base: filename, ext: '' };
};

window.formatFileNameMiddleTruncate = function(filename, maxLength = 26) {
  if (!filename || typeof filename !== 'string') return '';
  if (filename.length <= maxLength) return filename;

  const { base, ext } = window.splitFileNameAndExt(filename);
  
  if (ext && ext.length > 0 && ext.length <= 10) {
    const availableForBase = maxLength - ext.length - 1; // 1 char for ellipsis '…'
    if (availableForBase >= 4 && base.length > availableForBase) {
      const frontChars = Math.ceil(availableForBase * 0.6);
      const backChars = availableForBase - frontChars;
      return `${base.slice(0, frontChars)}…${base.slice(base.length - backChars)}${ext}`;
    }
  }

  const available = maxLength - 1;
  const frontChars = Math.ceil(available / 2);
  const backChars = available - frontChars;
  return `${filename.slice(0, frontChars)}…${filename.slice(filename.length - backChars)}`;
};

// Global States
let activeView = 'transcribe';
let activeSettingsCat = 'app';
let activeLogCategory = 'All';
let logSearchQuery = '';
let settingsState = null;
let compiledBackends = {};
let allLogsArray = []; // Store raw log payloads
let systemSpecs = null;

let selectedMediaFile = null;
let probedMetadata = null;
let wavPathForTranscription = null;
let localScannedTransModels = [];
let localScannedVadModels = [];
let lastAppendedCategory = null;

// Batch Processing State variables
let selectedMediaFiles = [];
let batchItems = [];
let isBatchMode = false;
let batchCancelActive = false;
let _unlistenFns = [];
let _modelActionsInProgress = new Set();

// Model Hub Action Icons (Accessible & Reusable SVGs)
const MODEL_ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const MODEL_ICON_DELETE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const MODEL_ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const MODEL_ICON_RESUME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

function getModelMetaInfo(modelName) {
  const isVad = modelName.startsWith('silero-');
  let precisionText = isVad ? '' : t('models.prec16');
  if (!isVad) {
    if (modelName.includes('-q8_0')) {
      precisionText = t('models.prec8');
    } else if (modelName.includes('-q5_0') || modelName.includes('-q5_1')) {
      precisionText = t('models.prec5');
    }
  }

  let langText = t('models.langMulti');
  if (modelName.includes('.en')) {
    langText = t('models.langEnOnly');
  } else if (isVad) {
    langText = t('models.langVad');
  }

  return { precisionText, langText, isVad };
}

// Native OS Taskbar Progress Bar & Background Job Tracking
window.isTranscriptionRunning = false;
window.isTranslationRunning = false;
window.isHardsubRunning = false;
window.isDownloadingModelRunning = false;

window.hasActiveBackgroundJob = function() {
  return !!(
    window.isTranscriptionRunning ||
    window.isTranslationRunning ||
    window.isHardsubRunning ||
    window.isDownloadingModelRunning
  );
};

window.updateTaskbarProgress = function(progressFraction, active, statusType = 'normal') {
  if (window.__TAURI__ && window.__TAURI__.window) {
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      const appWin = getCurrentWindow();
      if (!appWin || typeof appWin.setProgressBar !== 'function') return;

      if (statusType === 'error') {
        appWin.setProgressBar({ status: 'error', progress: 100 }).catch(() => {});
        setTimeout(() => {
          appWin.setProgressBar({ status: 'none' }).catch(() => {});
        }, 4000);
      } else if (active) {
        const pct = Math.min(100, Math.max(0, Math.round((progressFraction || 0) * 100)));
        if (pct <= 0) {
          appWin.setProgressBar({ status: 'indeterminate' }).catch(() => {});
        } else {
          appWin.setProgressBar({ status: 'normal', progress: pct }).catch(() => {});
        }
      } else {
        appWin.setProgressBar({ status: 'none' }).catch(() => {});
      }
    } catch (e) {
      console.warn("Taskbar progress update failed:", e);
    }
  }
};

// Premium GNOME-Style Titlebar Window Controls Binding with Exit Guard & Double-Click Maximize
function setupTitlebar() {
  const minimizeBtn = document.getElementById('titlebar-minimize');
  const maximizeBtn = document.getElementById('titlebar-maximize');
  const closeBtn = document.getElementById('titlebar-close');

  if (!minimizeBtn || !maximizeBtn || !closeBtn) return;

  if (window.__TAURI__ && window.__TAURI__.window) {
    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      const appWindow = getCurrentWindow();

      minimizeBtn.addEventListener('click', () => {
        appWindow.minimize().catch(err => console.error("Failed to minimize window:", err));
      });

      maximizeBtn.addEventListener('click', () => {
        appWindow.toggleMaximize().catch(err => console.error("Failed to toggle maximize window:", err));
      });

      // Double-click titlebar to toggle maximize
      const titlebar = document.querySelector('.titlebar');
      if (titlebar) {
        titlebar.addEventListener('dblclick', (e) => {
          if (!e.target.closest('button')) {
            appWindow.toggleMaximize().catch(err => console.error("Failed to toggle maximize window:", err));
          }
        });
      }

      const requestSafeExit = async () => {
        // If closeToTray is enabled, minimize to system tray instead of exiting
        if (settingsState && settingsState.closeToTray) {
          try {
            await invoke('hide_to_tray');
          } catch {
            appWindow.hide().catch(err => console.error("Failed to hide window to tray:", err));
          }
          return;
        }

        if (window.hasActiveBackgroundJob()) {
          const confirmed = await window.showConfirmModal(
            t('modals.confirmExitTitle'),
            t('modals.confirmExitDesc'),
            t('modals.confirmExitBtn')
          );
          if (confirmed) {
            try {
              await invoke('exit_app');
            } catch {
              appWindow.destroy().catch(() => appWindow.close());
            }
          }
        } else {
          try {
            await invoke('exit_app');
          } catch {
            appWindow.close().catch(err => console.error("Failed to close window:", err));
          }
        }
      };

      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        requestSafeExit();
      });

      if (typeof appWindow.onCloseRequested === 'function') {
        appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          requestSafeExit();
        });
      }
    } catch (e) {
      console.error("Failed to setup native Tauri window controls:", e);
    }
  } else {
    // Browser Mock / Fallback
    minimizeBtn.addEventListener('click', () => {
      showNotification("Minimize (Fallback Mock)", "info");
    });
    maximizeBtn.addEventListener('click', () => {
      showNotification("Toggle Maximize (Fallback Mock)", "info");
    });
    closeBtn.addEventListener('click', () => {
      showNotification("Close Application (Fallback Mock)", "info");
    });
  }
}



// ----------------- Custom Dropdown Component -----------------
window.customSelectsMap = new Map();
let customSelectInstanceCounter = 0;

class CustomSelect {
  constructor(selectElement, options = {}) {
    this.select = selectElement;
    this.options = options || {};
    this.instanceId = this.select.id || `custom-select-auto-${++customSelectInstanceCounter}`;
    this.container = null;
    this.trigger = null;
    this.optionsContainer = null;
    this.isOpen = false;
    this.focusedIndex = -1;
    this.typeaheadBuffer = '';
    this.typeaheadTimeout = null;
    this.observer = null;
    this.searchable = this.select.hasAttribute('data-searchable');
    this.searchRow = null;
    this.searchInput = null;
    this.noResultsRow = null;
    this.init();
  }

  init() {
    this.select.style.display = 'none';

    this.container = document.createElement('div');
    this.container.className = 'custom-select-container';
    
    if (this.select.className) {
      const classesToAdd = this.select.className.split(/\s+/).filter(c => Boolean(c) && c !== 'select-control');
      if (classesToAdd.length > 0) {
        this.container.classList.add(...classesToAdd);
      }
    }
    this.container.id = `custom-select-${this.instanceId}`;
    
    this.container.style.width = this.select.style.width || '100%';
    if (this.select.style.minWidth) {
      this.container.style.minWidth = this.select.style.minWidth;
    }
    if (this.select.style.maxWidth) {
      this.container.style.maxWidth = this.select.style.maxWidth;
    }
    this.container.style.height = this.select.style.height || 'auto';
    this.container.style.margin = this.select.style.margin || '0';

    this.trigger = document.createElement('div');
    this.trigger.className = 'custom-select-trigger';
    this.trigger.tabIndex = 0;
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', `options-for-${this.instanceId}`);

    this.trigger.innerHTML = `
      <span class="custom-select-value"></span>
      <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    this.container.appendChild(this.trigger);

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'custom-select-options';
    this.optionsContainer.setAttribute('role', 'listbox');
    this.optionsContainer.tabIndex = -1;
    this.optionsContainer.id = `options-for-${this.instanceId}`;
    this.optionsContainer.classList.add(`options-for-${this.instanceId}`);
    this.optionsContainer.dataset.selectId = this.instanceId;
    document.body.appendChild(this.optionsContainer);

    if (this.searchable) {
      this.searchRow = document.createElement('div');
      this.searchRow.className = 'custom-select-search-row';
      this.searchInput = document.createElement('input');
      this.searchInput.type = 'text';
      this.searchInput.className = 'custom-select-search';
      this.searchInput.autocomplete = 'off';
      this.searchInput.spellcheck = false;
      this.searchInput.setAttribute('role', 'searchbox');
      this.applySearchPlaceholder();
      this.searchInput.addEventListener('input', () => this.applyFilter(this.searchInput.value));
      this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
      this.searchRow.appendChild(this.searchInput);

      this.noResultsRow = document.createElement('div');
      this.noResultsRow.className = 'custom-select-no-results';
      this.noResultsRow.setAttribute('role', 'presentation');
    }

    this.select.parentNode.insertBefore(this.container, this.select.nextSibling);

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this._keydownHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const optDiv = this.getNavigableOptions()[this.focusedIndex];
          if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
            this.select.value = optDiv.dataset.value;
            this.select.dispatchEvent(new Event('change'));
          }
          this.close();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const nextIdx = this.getNextAvailableIndex(this.focusedIndex, 1);
          if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const prevIdx = this.getNextAvailableIndex(this.focusedIndex, -1);
          if (prevIdx !== -1) this.setFocusedOptionIndex(prevIdx);
        }
      } else if (e.key === 'Home') {
        if (this.isOpen) {
          e.preventDefault();
          const firstIdx = this.getFirstAvailableIndex();
          if (firstIdx !== -1) this.setFocusedOptionIndex(firstIdx);
        }
      } else if (e.key === 'End') {
        if (this.isOpen) {
          e.preventDefault();
          const lastIdx = this.getLastAvailableIndex();
          if (lastIdx !== -1) this.setFocusedOptionIndex(lastIdx);
        }
      } else if (e.key === 'Escape') {
        if (this.isOpen) {
          e.preventDefault();
          this.close();
        }
      } else if (e.key === 'Tab') {
        if (this.isOpen) {
          this.close();
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this.isSearchable()) {
          return; // search input owns text entry in searchable mode
        }
        // WAI-ARIA Typeahead search with single-letter repeating cycle
        clearTimeout(this.typeaheadTimeout);
        const char = e.key.toLowerCase();
        const isRepeat = this.typeaheadBuffer.length === 1 && this.typeaheadBuffer === char;
        const options = this.getNavigableOptions();

        if (isRepeat) {
          const startFrom = (this.focusedIndex + 1) % options.length;
          let matchIdx = -1;
          for (let offset = 0; offset < options.length; offset++) {
            const idx = (startFrom + offset) % options.length;
            const opt = options[idx];
            if (!opt.classList.contains('disabled') && (opt.textContent || '').trim().toLowerCase().startsWith(char)) {
              matchIdx = idx;
              break;
            }
          }
          if (matchIdx !== -1) {
            if (!this.isOpen) this.open();
            this.setFocusedOptionIndex(matchIdx);
          }
        } else {
          this.typeaheadBuffer += char;
          const matchIdx = options.findIndex(opt =>
            !opt.classList.contains('disabled') &&
            (opt.textContent || '').trim().toLowerCase().startsWith(this.typeaheadBuffer)
          );

          if (matchIdx !== -1) {
            if (!this.isOpen) {
              this.open();
            }
            this.setFocusedOptionIndex(matchIdx);
          }
        }

        this.typeaheadTimeout = setTimeout(() => {
          this.typeaheadBuffer = '';
        }, 600);
      }
    };
    this.trigger.addEventListener('keydown', this._keydownHandler);

    this._documentPointerHandler = (e) => {
      if (this.isOpen && this.container && this.optionsContainer) {
        if (!this.container.contains(e.target) && !this.optionsContainer.contains(e.target)) {
          this.close();
        }
      }
    };

    this._globalEscapeHandler = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    };

    this._scrollResizeHandler = (e) => {
      if (this.isOpen) {
        if (e && e.type === 'scroll') {
          // If scrolling anywhere outside the optionsContainer itself, close the dropdown
          if (!this.optionsContainer.contains(e.target)) {
            this.close();
          }
        } else {
          this.updatePosition();
        }
      }
    };

    // Event delegation on optionsContainer for efficient option selection
    this.optionsContainer.addEventListener('click', (e) => {
      const optDiv = e.target.closest('.custom-select-option');
      if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
        e.stopPropagation();
        this.select.value = optDiv.dataset.value;
        this.select.dispatchEvent(new Event('change'));
        this.close();
      }
    });

    this.updateOptions();

    this.select.addEventListener('change', () => {
      this.syncSelectedValue();
    });

    // Avoid running heavy MutationObservers on table row selects and static controls
    const isRowSelect = this.select && this.select.classList.contains('model-reasoning-select');
    const isPaginationSelect = this.select && this.select.classList.contains('pagination-size-select');
    const shouldObserve = this.options.observe !== undefined 
      ? Boolean(this.options.observe)
      : (!isRowSelect && !isPaginationSelect);

    if (shouldObserve) {
      this.observer = new MutationObserver(() => {
        this.updateOptions();
      });
      this.observer.observe(this.select, { childList: true, attributes: true, subtree: true });
    }

    // Register this instance globally for sync
    window.customSelectsMap.set(this.select.id || this.select, this);
  }

  getOptionDivs() {
    return Array.from(this.optionsContainer.querySelectorAll('.custom-select-option'));
  }

  getNavigableOptions() {
    return this.getOptionDivs().filter(el =>
      !el.classList.contains('disabled') && !el.classList.contains('hidden')
    );
  }

  getNextAvailableIndex(fromIdx, direction = 1) {
    const options = this.getNavigableOptions();
    const len = options.length;
    if (len === 0) return -1;
    const next = fromIdx + direction;
    if (next >= 0 && next < len) return next;
    return (fromIdx >= 0 && fromIdx < len) ? fromIdx : (direction > 0 ? 0 : len - 1);
  }

  getFirstAvailableIndex() {
    const options = this.getNavigableOptions();
    return options.length > 0 ? 0 : -1;
  }

  getLastAvailableIndex() {
    const options = this.getNavigableOptions();
    return options.length > 0 ? options.length - 1 : -1;
  }

  setFocusedOptionIndex(idx) {
    const options = this.getNavigableOptions();
    options.forEach(c => c.classList.remove('focused'));

    if (idx >= 0 && idx < options.length) {
      this.focusedIndex = idx;
      const target = options[idx];
      target.classList.add('focused');
      if (target.id) {
        this.trigger.setAttribute('aria-activedescendant', target.id);
      }
      target.scrollIntoView({ block: 'nearest' });
    } else {
      this.focusedIndex = -1;
      this.trigger.removeAttribute('aria-activedescendant');
    }
  }

  updateOptions() {
    if (!this.select || !this.optionsContainer || !this.container) return;
    this.optionsContainer.innerHTML = '';
    const frag = document.createDocumentFragment();

    if (this.isSearchable()) {
      this.applySearchPlaceholder();
      frag.appendChild(this.searchRow);
    }

    let optionIdx = 0;
    const appendOption = (opt) => {
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.id = `opt-${this.instanceId}-${optionIdx++}`;
      optDiv.setAttribute('role', 'option');
      optDiv.setAttribute('aria-selected', opt.value === this.select.value ? 'true' : 'false');
      optDiv.textContent = opt.textContent;
      optDiv.title = opt.textContent;
      optDiv.dataset.value = opt.value;
      const searchData = opt.dataset.search || opt.getAttribute('data-search');
      if (searchData) {
        optDiv.dataset.search = searchData;
      }
      if (opt.disabled) {
        optDiv.classList.add('disabled');
        optDiv.setAttribute('aria-disabled', 'true');
      }
      frag.appendChild(optDiv);
    };
    const appendGroup = (group) => {
      const labelDiv = document.createElement('div');
      labelDiv.className = 'custom-select-group-label';
      labelDiv.textContent = group.label || '';
      labelDiv.setAttribute('role', 'presentation');
      frag.appendChild(labelDiv);
      Array.from(group.children).forEach((child) => {
        if (child.tagName === 'OPTION') appendOption(child);
      });
    };

    Array.from(this.select.children).forEach((child) => {
      if (child.tagName === 'OPTGROUP') appendGroup(child);
      else if (child.tagName === 'OPTION') appendOption(child);
    });

    if (this.isSearchable()) {
      this.noResultsRow.textContent = (typeof window.t === 'function')
        ? window.t('languages.noResults')
        : 'No matching language';
      this.noResultsRow.classList.add('hidden');
      frag.appendChild(this.noResultsRow);
      this.optionsContainer.classList.add('has-search');
    } else {
      this.optionsContainer.classList.remove('has-search');
    }

    this.optionsContainer.appendChild(frag);

    // Modern Web Guidance: Detect technical/English dropdowns (e.g. model filenames, hardware devices)
    // and enforce strict LTR layout even in RTL mode so names like ggml-*.bin are left-aligned.
    const hasRtlChar = Array.from(this.select.options).some(opt => /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(opt.textContent || ''));
    if (!hasRtlChar && this.select.options.length > 0) {
      this.container.classList.add('custom-select-ltr');
      this.optionsContainer.classList.add('custom-select-ltr');
    } else {
      this.container.classList.remove('custom-select-ltr');
      this.optionsContainer.classList.remove('custom-select-ltr');
    }

    this.syncSelectedValue();
  }

  applySearchPlaceholder() {
    if (!this.searchInput) return;
    const placeholder = (typeof window.t === 'function')
      ? window.t('common.searchLanguage')
      : 'Search…';
    this.searchInput.placeholder = placeholder;
    this.searchInput.setAttribute('aria-label', placeholder);
  }

  handleSearchKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (this.getNavigableOptions().length === 0) return;
      const nextIdx = this.getNextAvailableIndex(this.focusedIndex, e.key === 'ArrowDown' ? 1 : -1);
      if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const options = this.getNavigableOptions();
      if (options.length === 0) return;
      const pickIdx = (this.focusedIndex >= 0 && this.focusedIndex < options.length) ? this.focusedIndex : 0;
      const optDiv = options[pickIdx];
      if (optDiv && optDiv.dataset.value !== undefined) {
        this.select.value = optDiv.dataset.value;
        this.select.dispatchEvent(new Event('change'));
      }
      this.close();
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // keep the global close handler from firing on the clear step
      if (this.searchInput.value) {
        this.searchInput.value = '';
        this.applyFilter('');
      } else {
        this.close();
      }
    } else if (e.key === 'Tab') {
      this.close();
    }
  }

  applyFilter(rawQuery) {
    if (!this.isSearchable()) return;
    const query = normalizeForSearch(rawQuery || '');
    let visibleCount = 0;
    this.getOptionDivs().forEach((div) => {
      const haystack = div.dataset.search !== undefined ? div.dataset.search : (div.textContent || '');
      const match = !query || normalizeForSearch(haystack).includes(query);
      div.classList.toggle('hidden', !match);
      if (match) visibleCount++;
    });
    // Collapse group headers whose section has no visible options left
    Array.from(this.optionsContainer.children).forEach((el) => {
      if (!el.classList.contains('custom-select-group-label')) return;
      let sib = el.nextElementSibling;
      let hasVisible = false;
      while (sib && !sib.classList.contains('custom-select-group-label')) {
        if (sib.classList.contains('custom-select-option') && !sib.classList.contains('hidden')) {
          hasVisible = true;
          break;
        }
        sib = sib.nextElementSibling;
      }
      el.classList.toggle('hidden', !hasVisible);
    });
    this.noResultsRow.textContent = (typeof window.t === 'function')
      ? window.t('languages.noResults')
      : 'No matching language';
    this.noResultsRow.classList.toggle('hidden', visibleCount > 0);
    this.setFocusedOptionIndex(visibleCount > 0 && this.isOpen ? 0 : -1);
  }

  clearFilter() {
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.applyFilter('');
  }

  isSearchable() {
    return Boolean(this.searchable && this.searchRow && this.searchInput && this.noResultsRow);
  }

  syncSelectedValue() {
    if (!this.select || !this.trigger || !this.optionsContainer) return;
    const selectedOpt = this.select.options ? this.select.options[this.select.selectedIndex] : null;
    const valText = selectedOpt ? selectedOpt.textContent : (this.select.placeholder || 'Select...');
    const valEl = this.trigger.querySelector('.custom-select-value');
    if (valEl) {
      valEl.textContent = valText;
      valEl.title = valText;
    }
    this.trigger.title = valText;

    if (this.optionsContainer.children) {
      Array.from(this.optionsContainer.children).forEach(child => {
        const isSelected = child.dataset && child.dataset.value === this.select.value;
        if (isSelected) {
          child.classList.add('selected');
          child.setAttribute('aria-selected', 'true');
        } else {
          child.classList.remove('selected');
          child.setAttribute('aria-selected', 'false');
        }
      });
    }
  }

  updatePosition() {
    if (!this.isOpen || !this.trigger || !this.optionsContainer) return;
    const rect = this.trigger.getBoundingClientRect();
    const maxHeight = this.isSearchable() ? 340 : 240;
    const dropdownHeight = Math.min(this.optionsContainer.scrollHeight || 220, maxHeight);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Strict pixel-perfect alignment with trigger box (no overhangs or size discrepancies)
    this.optionsContainer.style.position = 'fixed';
    this.optionsContainer.style.zIndex = '999999';

    const triggerWidth = Math.round(rect.width);
    const isReasoning = this.select && this.select.classList.contains('model-reasoning-select');
    const isPaginationSize = this.select && this.select.classList.contains('pagination-size-select');
    const minDropdownWidth = isReasoning ? 136 : (isPaginationSize ? 70 : 118);
    const targetWidth = Math.max(triggerWidth, minDropdownWidth);
    this.optionsContainer.style.width = isReasoning ? 'max-content' : 'auto';
    this.optionsContainer.style.minWidth = `${targetWidth}px`;
    this.optionsContainer.style.maxWidth = `${Math.max(targetWidth, 280)}px`;

    const measuredWidth = this.optionsContainer.getBoundingClientRect().width || targetWidth;
    const effectiveWidth = Math.max(targetWidth, Math.round(measuredWidth));
    const isRtl = (typeof isRtlLanguage === 'function' && isRtlLanguage(getLanguage())) ||
                  document.documentElement.dir === 'rtl' ||
                  document.body.dir === 'rtl';

    const leftPos = isRtl ? Math.round(rect.right - effectiveWidth) : Math.round(rect.left);
    const maxLeft = Math.max(8, window.innerWidth - effectiveWidth - 8);
    this.optionsContainer.style.left = `${Math.max(8, Math.min(leftPos, maxLeft))}px`;
    this.optionsContainer.style.right = 'auto';

    if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
      // Space below insufficient -> open upward
      this.optionsContainer.style.top = 'auto';
      this.optionsContainer.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      // Space available -> open downward
      this.optionsContainer.style.bottom = 'auto';
      this.optionsContainer.style.top = `${rect.bottom + 4}px`;
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (window.customSelectsMap) {
      window.customSelectsMap.forEach(cs => {
        if (cs !== this && cs && typeof cs.close === 'function' && cs.isOpen) {
          cs.close();
        }
      });
    }

    // 1. Promote to GPU compositing layer right before animation begins
    this.optionsContainer.style.willChange = 'transform, opacity';

    // 2. Position the container first while it's still closed
    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.updatePosition();

    // Attach document, window, scroll, and resize listeners only while open
    document.addEventListener('pointerdown', this._documentPointerHandler, true);
    document.addEventListener('keydown', this._globalEscapeHandler);
    window.addEventListener('scroll', this._scrollResizeHandler, true);
    window.addEventListener('resize', this._scrollResizeHandler);

    // Focus active or selected non-disabled option
    const options = this.getNavigableOptions();
    let selectedIdx = options.findIndex(c => c.classList.contains('selected') && !c.classList.contains('disabled'));
    if (selectedIdx === -1) {
      selectedIdx = this.getFirstAvailableIndex();
    }
    this.setFocusedOptionIndex(selectedIdx);

    // Searchable dropdowns put the caret in the filter box
    if (this.isSearchable()) {
      requestAnimationFrame(() => {
        if (this.isOpen && this.searchInput) {
          this.searchInput.focus();
        }
      });
    }

    // 3. Use double requestAnimationFrame to defer class additions to the next frames,
    // avoiding layout thrashing/reflow block while starting CSS transitions.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.isOpen) {
          this.container.classList.add('open');
          this.optionsContainer.classList.add('open');
        }
      });
    });
  }

  close() {
    this.container.classList.remove('open');
    this.optionsContainer.classList.remove('open');
    this.isOpen = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.setFocusedOptionIndex(-1);
    this.typeaheadBuffer = '';
    clearTimeout(this.typeaheadTimeout);
    if (this.isSearchable()) {
      this.clearFilter();
    }

    // Detach document, window, scroll, and resize listeners immediately on close
    document.removeEventListener('pointerdown', this._documentPointerHandler, true);
    document.removeEventListener('keydown', this._globalEscapeHandler);
    window.removeEventListener('scroll', this._scrollResizeHandler, true);
    window.removeEventListener('resize', this._scrollResizeHandler);

    // Reset will-change after transition ends to release GPU memory
    this.optionsContainer.addEventListener('transitionend', () => {
      if (!this.isOpen) {
        this.optionsContainer.style.willChange = 'auto';
      }
    }, { once: true });
  }

  destroy() {
    clearTimeout(this.typeaheadTimeout);
    if (this.trigger && this._keydownHandler) {
      this.trigger.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._documentPointerHandler) {
      document.removeEventListener('pointerdown', this._documentPointerHandler, true);
    }
    if (this._globalEscapeHandler) {
      document.removeEventListener('keydown', this._globalEscapeHandler);
    }
    window.removeEventListener('scroll', this._scrollResizeHandler, true);
    window.removeEventListener('resize', this._scrollResizeHandler);
    if (this.optionsContainer && this.optionsContainer.parentNode) {
      this.optionsContainer.parentNode.removeChild(this.optionsContainer);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
    window.customSelectsMap.delete(this.select.id || this.select);
  }
}

window.initializeCustomSelects = function() {
  document.querySelectorAll('select.select-control, select#batch-sort-select').forEach(select => {
    if (select.style.display === 'none') return; // leave hidden data-binder stubs unwrapped
    if (select.classList.contains('model-reasoning-select')) return; // handled by table pagination renderer
    if (!select.dataset.customSelectInitialized) {
      new CustomSelect(select);
      select.dataset.customSelectInitialized = 'true';
    }
  });
};

window.syncCustomSelects = function() {
  if (window.customSelectsMap) {
    window.customSelectsMap.forEach(cs => {
      cs.updateOptions();
      cs.syncSelectedValue();
    });
  }
};

/**
 * Dynamically updates text direction (ltr vs rtl) of an input/textarea
 * based on its text content, independent of the overall app UI language.
 * Falls back cleanly to current app UI direction when empty.
 *
 * Kept under this name for the rest of main.js; the rule itself lives in i18n beside
 * the language list, shared with the cue editor and the transcript lines so a line
 * cannot be read one way in one field and another way somewhere else.
 */
function applyDynamicDirection(el, defaultDir = null) {
  applyTextDirection(el, defaultDir);
}
window.applyDynamicDirection = applyDynamicDirection;

// Initialize App
// Handle responsive sidebar collapse via matchMedia + class toggle,
// combined with CSS transitions for smooth width/opacity animation
// and staggered text-span reveal when expanding.
let isCurrentlyCollapsed = null;

function setupResponsiveMenuFadeIn() {
  const sidebarMql = window.matchMedia('(max-width: 960px)');

  const handler = (e) => {
    const sidebar = document.querySelector('sidebar');
    if (!sidebar) return;

    if (e.matches) {
      if (isCurrentlyCollapsed === true) return;
      isCurrentlyCollapsed = true;
      sidebar.classList.add('sidebar-collapsed');
    } else {
      if (isCurrentlyCollapsed === false) return;
      isCurrentlyCollapsed = false;
      sidebar.classList.remove('sidebar-collapsed');
    }
  };

  // Support both modern addEventListener and legacy addListener for older WebKit/GTK engines
  if (sidebarMql.addEventListener) {
    sidebarMql.addEventListener('change', handler);
  } else if (sidebarMql.addListener) {
    sidebarMql.addListener(handler);
  }

  // Apply initial state
  handler(sidebarMql);
}

function setupHorizontalTabScroll() {
  const scrollWheel = (e) => {
    const container = e.currentTarget;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll > 0) {
      container.scrollLeft += (e.deltaY || e.deltaX);
      e.preventDefault();
    }
  };

  const containers = document.querySelectorAll('.settings-categories, .trans-cfg-status-bar, .compact-outputs');
  containers.forEach(el => {
    el.addEventListener('wheel', scrollWheel, { passive: false });
  });
}

// ----------------- UI Scaling & Zoom Engine -----------------
let currentUiZoom = 1.0;
let zoomSaveTimeout = null;

function applyUiZoom(scale, persist = true, showToast = false) {
  let numScale = typeof scale === 'number' ? scale : parseFloat(scale);
  if (isNaN(numScale) || numScale <= 0) {
    numScale = 1.0;
  }
  // Clamp scale between 70% and 160% and round to 2 decimal places
  numScale = Math.round(Math.min(Math.max(numScale, 0.70), 1.60) * 100) / 100;
  currentUiZoom = numScale;

  // Apply CSS zoom to document.documentElement (root scaling across WebKitGTK and modern WebViews)
  document.documentElement.style.zoom = numScale;
  document.body.style.zoom = '';

  // Update localStorage cache to prevent layout jump on next startup
  try {
    localStorage.setItem('whisper_ui_scale_cache', numScale.toString());
  } catch (_) {}

  // Update Settings UI Badge if present
  const badge = document.getElementById('ui-scale-badge');
  if (badge) {
    badge.textContent = `${Math.round(numScale * 100)}%`;
  }

  // Update select dropdown if present
  const selectEl = document.getElementById('opt-uiScale');
  if (selectEl) {
    const match = Array.from(selectEl.options).find(opt => Math.abs(parseFloat(opt.value) - numScale) < 0.01);
    if (match) {
      selectEl.value = match.value;
    } else {
      selectEl.value = numScale.toString();
    }
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  }

  if (showToast && typeof showNotification === 'function') {
    showNotification(t('toasts.uiScaleToast', { scale: Math.round(numScale * 100) }), "info");
  }

  if (persist && settingsState) {
    settingsState.uiScale = numScale;
    if (zoomSaveTimeout) {
      clearTimeout(zoomSaveTimeout);
    }
    zoomSaveTimeout = setTimeout(() => {
      saveCurrentSettings();
    }, 400);
  }
}

window.adjustUiZoom = function(delta) {
  const newScale = Math.round((currentUiZoom + delta) * 100) / 100;
  applyUiZoom(newScale, true, true);
};

window.setUiZoom = function(scale) {
  applyUiZoom(scale, true, true);
};

// ----------------- Multi-Theme Engine & Registry -----------------
const THEME_REGISTRY = {
  'royal-blue': {
    id: 'royal-blue',
    label: 'Royal Blue',
    dataTheme: 'royal-blue',
    metaColor: '#070913',
    toastName: 'Royal Blue (Default)',
    iconSvg: `
      <svg class="theme-btn-icon icon-royal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
        <path d="M5 21h14"/>
      </svg>
    `
  },
  'carbon': {
    id: 'carbon',
    label: 'Carbon',
    dataTheme: 'carbon',
    metaColor: '#121214',
    toastName: 'Carbon',
    iconSvg: `
      <svg class="theme-btn-icon icon-carbon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 22 12 12 22 2 12 12 2"/>
      </svg>
    `
  },
  'fire-orange': {
    id: 'fire-orange',
    label: 'Fiery Orange',
    dataTheme: 'fire-orange',
    metaColor: '#0c0a09',
    toastName: 'Fiery Orange (Fire)',
    iconSvg: `
      <svg class="theme-btn-icon icon-fire" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
      </svg>
    `
  },
  'emerald': {
    id: 'emerald',
    label: 'Emerald',
    dataTheme: 'emerald',
    metaColor: '#060e0a',
    toastName: 'Emerald',
    iconSvg: `
      <svg class="theme-btn-icon icon-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12l4 6-10 13L2 9Z"/>
        <path d="M11 3 8 9l4 13 4-13-3-6"/>
        <path d="M2 9h20"/>
      </svg>
    `
  }
};

function resolveThemeConfig(themeName) {
  if (themeName === 'carbon') {
    return THEME_REGISTRY['carbon'];
  }
  if (themeName === 'fire' || themeName === 'fire-orange') {
    return THEME_REGISTRY['fire-orange'];
  }
  if (themeName === 'emerald') {
    return THEME_REGISTRY['emerald'];
  }
  if (themeName === 'cyber-blue' || themeName === 'royal-blue') {
    return THEME_REGISTRY['royal-blue'];
  }
  return THEME_REGISTRY[themeName] || THEME_REGISTRY['royal-blue'];
}

function applyTheme(themeName) {
  const root = document.documentElement;
  const config = resolveThemeConfig(themeName);

  if (config.id === 'royal-blue') {
    root.removeAttribute('data-theme');
    root.style.removeProperty('--bg-space');
  } else {
    root.setAttribute('data-theme', config.dataTheme || config.id);
    if (config.metaColor) {
      root.style.setProperty('--bg-space', config.metaColor);
    }
  }

  // Update localStorage cache to prevent FOUC on next startup
  try {
    localStorage.setItem('whisper_theme_cache', config.id);
  } catch (_) {}

  // Update theme meta color tag
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme && config.metaColor) {
    metaTheme.setAttribute('content', config.metaColor);
  }

  // Update theme picker cards in Settings -> App Preferences
  const activeThemeId = config.id;
  const themeCardMap = {
    'royal-blue': 'theme-card-royal',
    'carbon': 'theme-card-carbon',
    'fire-orange': 'theme-card-fire',
    'fire': 'theme-card-fire',
    'emerald': 'theme-card-emerald'
  };
  const activeCardId = themeCardMap[activeThemeId] || 'theme-card-royal';

  document.querySelectorAll('.theme-picker-card').forEach(card => {
    const isActive = (card.id === activeCardId);
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  if (window.syncCustomSelects) {
    window.syncCustomSelects();
  }
}

window.toggleTheme = function() {
  const currentThemeAttr = document.documentElement.getAttribute('data-theme') || 'royal-blue';
  let nextTheme = 'carbon';
  if (currentThemeAttr === 'carbon') {
    nextTheme = 'fire-orange';
  } else if (currentThemeAttr === 'fire-orange' || currentThemeAttr === 'fire') {
    nextTheme = 'emerald';
  } else if (currentThemeAttr === 'emerald') {
    nextTheme = 'royal-blue';
  } else {
    nextTheme = 'carbon';
  }
  window.switchTheme(nextTheme);
};

window.handleThemeSegmentClick = function(targetTheme) {
  window.switchTheme(targetTheme);
};

window.switchTheme = function(themeName, animated = true) {
  const config = resolveThemeConfig(themeName);

  if (settingsState) {
    settingsState.theme = config.id;
    saveCurrentSettings();
  }

  const shouldAnimate = animated &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (shouldAnimate) {
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    applyTheme(config.id);
    setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 280);
  } else {
    applyTheme(config.id);
  }

  const themeKey = (config.id === 'royal-blue') ? 'royal' : (config.id === 'fire-orange' || config.id === 'fire') ? 'fire' : config.id;
  const localizedThemeName = (typeof t === 'function' && t(`theme.${themeKey}`) !== `theme.${themeKey}`)
    ? t(`theme.${themeKey}`)
    : (config.toastName || config.label);
  showNotification(t('toasts.themeSwitched', { theme: localizedThemeName }), 'info');
};

function setupZoomKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // ESC key closes active modals and dropdowns
    if (e.key === 'Escape') {
      const overlay = document.getElementById('app-modal-overlay');
      if (overlay && (overlay.classList.contains('show') || overlay.style.display === 'flex')) {
        if (window._confirmModalResolve) {
          window.resolveAppConfirm(false);
        } else {
          window.closeAppModal();
        }
      }
      document.querySelectorAll('.custom-select-options.open').forEach(el => {
        el.classList.remove('open');
      });
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') {
        e.preventDefault();
        window.adjustUiZoom(0.05);
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
        e.preventDefault();
        window.adjustUiZoom(-0.05);
      } else if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') {
        e.preventDefault();
        window.setUiZoom(1.0);
      }
    }
  }, { passive: false });
}

async function initApp() {
  console.log("Whisper Desktop UI Initialized!");
  
  // Initialize internationalization (i18n) and translate DOM
  initI18n();
  
  // Disable default webview context menu globally to make it feel like a native desktop app
  document.addEventListener('contextmenu', e => {
    // Allow right-click default context menu ONLY on inputs and textareas (for copy/cut/paste)
    if (!e.target.closest('input, textarea')) {
      e.preventDefault();
    }
  });
  
  // Setup custom CSD titlebar controls
  setupTitlebar();

  // Setup capturing scroll activity listener for target scrollbar containers (Font & AI Models)
  document.addEventListener('scroll', (e) => {
    const target = e.target;
    if (target && target.matches && target.matches('#models-list-scroll, .providers-table-wrapper, #provider-tab-models, #provider-tab-providers, .provider-grid, #hardsub-font, #opt-translateAiModel')) {
      target.classList.add('scrolling-active');
      clearTimeout(target._scrollTimer);
      target._scrollTimer = setTimeout(() => {
        target.classList.remove('scrolling-active');
      }, 1500);
    }
  }, true);
  
  // Initialize Custom Select components
  initializeCustomSelects();
  
  // Initialize Number Stepper Controls for keyboard and wheel input
  setupNumberInputControls();
  
  // Setup Tauri Listeners
  setupTauriListeners();
  
  // Load system specs early to guide recommendation engine
  try {
    systemSpecs = await invoke('get_system_specs');
  } catch (e) {
    console.error("Failed to load system specs on startup:", e);
    systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
  }
  
  // Initial load
  await refreshSettings();
  setupNumberInputControls();
  // Load existing logs
  try {
    const logs = await invoke('get_logs');
    if (logs) {
      const lines = logs.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          // Parse log format: [HH:MM:SS] [Category] message
          const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\] \[([^\]]+)\] (.*)$/);
          if (match) {
            allLogsArray.push({
              timestamp: match[1],
              category: match[2],
              message: match[3]
            });
          }
        }
      }
      redrawLogsViewport();
    }
  } catch (e) {
    console.error("Failed to load initial logs:", e);
  }
  if (typeof setupTranslationEventListeners === 'function') {
    setupTranslationEventListeners();
  }
  await refreshBuildStatuses();
  
  // Setup Transcribe drag & drop
  setupTranscribeDragAndDrop();

  // Setup content-based direction for transcript lines
  setupTranscriptDirection();
  
  // Setup Quick Configuration Deck listeners
  setupQuickConfigDeckEventListeners();
  
  // Setup responsive menu fade-in on window re-expand
  setupResponsiveMenuFadeIn();
  
  // Setup horizontal scroll on tab bars for narrow windows
  setupHorizontalTabScroll();
  
  // Setup Zoom Keyboard Shortcuts (Ctrl + + / - / 0)
  setupZoomKeyboardShortcuts();
  
  // Setup vertical tablist keyboard navigation (WAI-ARIA Roving Tabindex, automatic activation)
  const navItems = Array.from(document.querySelectorAll('.nav-item'));
  const moveTabFocus = (e, item) => {
    let targetIndex = -1;
    if (e.key === 'ArrowDown') {
      targetIndex = (navItems.indexOf(item) + 1) % navItems.length;
    } else if (e.key === 'ArrowUp') {
      targetIndex = (navItems.indexOf(item) - 1 + navItems.length) % navItems.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = navItems.length - 1;
    }
    return targetIndex;
  };

  navItems.forEach((item) => {
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
        return;
      }

      const targetIndex = moveTabFocus(e, item);
      if (targetIndex >= 0) {
        e.preventDefault();
        if (navItems[targetIndex]) {
          navItems[targetIndex].focus();
          navItems[targetIndex].click();
        }
      }
    });
  });

  // Listen for language change events to re-render active dynamic components
  window.addEventListener('whisper:languageChanged', () => {
    if (activeView === 'models' && typeof loadModelStatusesGrid === 'function') {
      loadModelStatusesGrid(true, true);
    }
    
    // Update transcribe dropzone and wizard step 2 buttons contextually
    const fileNameEl = document.getElementById('lbl-file-name');
    const filePathEl = document.getElementById('lbl-file-path');
    if (fileNameEl && filePathEl) {
      if (selectedMediaFile) {
        updateMediaCardName(selectedMediaFile);
        filePathEl.textContent = selectedMediaFile;
      } else if (!batchItems || batchItems.length === 0) {
        updateMediaCardName(null);
        filePathEl.textContent = t('transcribe.selectFilePrompt');
      }
    }
    
    const nextStep2Btn = document.getElementById('btn-next-step-2');
    if (nextStep2Btn) {
      if (batchItems && batchItems.length > 0) {
        nextStep2Btn.textContent = t('transcribe.continueToBatchSetup');
      } else {
        nextStep2Btn.textContent = t('transcribe.continueToTranscription');
      }
    }

    // Keep batch queue table and specs translated without affecting data
    if (batchItems && batchItems.length > 0) {
      if (typeof renderBatchQueueTable === 'function') {
        renderBatchQueueTable();
      }
      if (typeof updateBatchSpecs === 'function') {
        updateBatchSpecs();
      }
    }

    // Keep quick VAD button status translated without toggling state
    if (typeof updateTranscribeUIConfigs === 'function') {
      updateTranscribeUIConfigs();
    }

    // Maintain content-based direction on prompt input independent of UI language
    const promptInput = document.getElementById('opt-prompt');
    if (promptInput) {
      applyDynamicDirection(promptInput);
    }

    // Update backend options labels on opt-selectedBackend in settings if present
    const settingsBackendSelect = document.getElementById('opt-selectedBackend');
    if (settingsBackendSelect) {
      Array.from(settingsBackendSelect.options).forEach(opt => {
        if (opt.value === 'Standard') opt.textContent = t('transcribe.backendCpu');
        else if (opt.value === 'Vulkan') opt.textContent = t('transcribe.backendVulkan');
        else if (opt.value === 'CUDA') opt.textContent = t('transcribe.backendCuda');
        else if (opt.value === 'OpenVINO') opt.textContent = t('transcribe.backendOpenvino');
      });
      if (typeof syncCustomSelects === 'function') {
        syncCustomSelects();
      }
    }

    // If in settings view, refresh models count display
    if (activeView === 'settings' && typeof filterModelsTable === 'function') {
      filterModelsTable(0);
    }

    // If settings search is active, re-run search to update translated group headers and empty state
    const settingsSearchInput = document.getElementById('settings-search-input');
    if (settingsSearchInput && settingsSearchInput.value && typeof window.filterSettings === 'function') {
      window.filterSettings(settingsSearchInput.value);
    }
  });

  // Wire up settings search keyboard shortcuts (Escape clears search)
  const settingsSearchInput = document.getElementById('settings-search-input');
  if (settingsSearchInput && !settingsSearchInput._hasSearchEscListener) {
    settingsSearchInput._hasSearchEscListener = true;
    settingsSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (typeof window.clearSettingsSearch === 'function') {
          window.clearSettingsSearch();
        }
      }
    });
  }

  const modelSearchInput = document.getElementById('model-search');
  if (modelSearchInput && !modelSearchInput._hasSearchEscListener) {
    modelSearchInput._hasSearchEscListener = true;
    modelSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (typeof window.clearModelSearch === 'function') {
          window.clearModelSearch();
        }
      }
    });
  }

  // Wire up search focus shortcuts ('/' or Ctrl+F when not in an editable field)
  document.addEventListener('keydown', (e) => {
    const isEditing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if ((e.key === '/' && !isEditing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
      if (activeView === 'settings') {
        const input = document.getElementById('settings-search-input');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      } else if (activeView === 'models') {
        const input = document.getElementById('model-search');
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    }
  });

  // Wire up dynamic content direction on prompt input
  const promptInput = document.getElementById('opt-prompt');
  if (promptInput) {
    applyDynamicDirection(promptInput);
    if (!promptInput._hasDynamicDirListener) {
      promptInput._hasDynamicDirListener = true;
      promptInput.addEventListener('input', () => applyDynamicDirection(promptInput));
    }
  }

  // Trigger initial synchronization of dynamic components for startup language
  const isRtl = typeof isRtlLanguage === 'function' ? isRtlLanguage(getLanguage()) : (getLanguage() === 'fa' || getLanguage() === 'ar');
  window.dispatchEvent(new CustomEvent('whisper:languageChanged', { detail: { language: getLanguage(), isRtl } }));

  window.saveCurrentSettings = saveCurrentSettings;

  // Initialize dynamic version display from package.json
  syncAppVersionUI();

  // Switch to default transcribe view
  switchView('transcribe');
}

// Avoid DOMContentLoaded race condition
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Switch Views
window.switchView = function(viewName) {
  activeView = viewName;
  
  // Close any open custom dropdowns cleanly via their lifecycle method
  if (window.customSelectsMap) {
    window.customSelectsMap.forEach(cs => {
      if (cs && cs.isOpen && typeof cs.close === 'function') {
        cs.close();
      }
    });
  }

  // Update nav link active states and accessibility
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const isTarget = item.dataset.view === viewName;
    if (isTarget) {
      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
      item.setAttribute('tabindex', '0');
    } else {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
      item.setAttribute('tabindex', '-1');
    }
  });
  
  // Update view panel active states
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(panel => {
    panel.classList.remove('active');
  });
  
  const targetPanel = document.getElementById(`panel-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // The player must know whether its page is authoritative before any
  // deferred completion (URL loads, seeks, autoplay) touches the DOM.
  if (window.hardsubController && typeof window.hardsubController.setPageActive === 'function') {
    window.hardsubController.setPageActive(viewName === 'hardsub');
  }
  
  // Update Title
  const localizedViewTitle = t(`nav.${viewName}`) || APP_NAME;
  const titleEl = document.getElementById('current-view-title');
  if (titleEl) {
    titleEl.style.opacity = '0.7';
    titleEl.textContent = localizedViewTitle;
    requestAnimationFrame(() => {
      titleEl.style.opacity = '1';
    });
  }
  const titlebarEl = document.getElementById('titlebar-view-title');
  if (titlebarEl) {
    titlebarEl.textContent = localizedViewTitle;
  }

  if (viewName === 'models') {
    // Always reset search input and default to Model Guide tab when entering the view
    const searchInput = document.getElementById('model-search');
    if (searchInput) searchInput.value = '';
    currentCategoryFilter = 'guide';
    const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    const guideBtn = document.getElementById('model-cat-guide');
    if (guideBtn) guideBtn.classList.add('active');
    loadModelStatusesGrid();
  }

  if (viewName === 'translate') {
    if (window.translationStudioController) {
      window.translationStudioController.syncFromGlobalSettings();
      window.translationStudioController.refreshLocalization();
    }
  }
};


// ----------------- Real-Time Listeners -----------------

function cleanupTauriListeners() {
  _unlistenFns.forEach(fn => { try { fn(); } catch(e) {} });
  _unlistenFns = [];
}

function setupTauriListeners() {
  cleanupTauriListeners();

  const on = (event, handler) => {
    listen(event, handler).then(fn => _unlistenFns.push(fn)).catch(() => {});
  };



  // Transcription progress
  on('transcribe-status', (event) => {
    const payload = event.payload;
    window.isTranscriptionRunning = !!payload.active;
    if (typeof window.updateTaskbarProgress === 'function') {
      window.updateTaskbarProgress(payload.progress, payload.active);
    }
    
    const fillBar = document.getElementById('progress-linear-fill');
    const pctEl = document.getElementById('lbl-radial-pct');
    const msgEl = document.getElementById('lbl-radial-msg');
    const pulseDot = document.getElementById('hud-pulse-dot');
    
    const pct = (payload.progress * 100).toFixed(0);
    
    if (fillBar) fillBar.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    // Backend progress is one message with file names and paths inside it, so it keeps
    // the order it was written in rather than being re-read through the interface's.
    if (msgEl) msgEl.textContent = isolateDirection(payload.message);
    
    if (pulseDot) {
      if (payload.active) {
        pulseDot.classList.add('active');
      } else {
        pulseDot.classList.remove('active');
      }
    }
  });

  on('translation-status', (event) => {
    const payload = event.payload;
    window.isTranslationRunning = !!payload.active;
    if (typeof window.updateTaskbarProgress === 'function') {
      window.updateTaskbarProgress(payload.progress, payload.active);
    }

    const fillBar = document.getElementById('progress-linear-fill');
    const pctEl = document.getElementById('lbl-radial-pct');
    const msgEl = document.getElementById('lbl-radial-msg');
    const pulseDot = document.getElementById('hud-pulse-dot');

    const progressVal = (payload && typeof payload.progress === 'number') ? payload.progress : 0;
    const pct = Math.min(100, Math.max(0, Math.round(progressVal * 100)));

    if (fillBar) fillBar.style.width = payload.active ? `${pct}%` : (progressVal >= 1 ? '100%' : '0%');
    if (pctEl) pctEl.textContent = payload.active ? `${pct}%` : (progressVal >= 1 ? '100%' : '0%');
    if (msgEl && payload.message) msgEl.textContent = isolateDirection(payload.message);

    if (pulseDot) {
      if (payload.active) {
        pulseDot.classList.add('active');
      } else {
        pulseDot.classList.remove('active');
      }
    }
  });

  // Model download progress event listener (Event-driven targeted DOM update)
  on('model-download-status', (event) => {
    const payload = event.payload;
    if (!payload || !payload.modelName) return;

    if (payload.phase === 'starting' || payload.phase === 'downloading') {
      window.isDownloadingModelRunning = true;
      if (typeof window.updateTaskbarProgress === 'function') {
        window.updateTaskbarProgress(payload.progress, true);
      }

      // CSS.escape prevents selector breakage from quotes/brackets in names
      const card = document.querySelector(`[data-model="${CSS.escape(payload.modelName)}"]`);
      if (!card) return;

      const pct = Math.min(100, Math.round((payload.progress || 0) * 100));
      const dlMB = ((payload.downloadedBytes || 0) / 1048576).toFixed(0);
      const totalMB = ((payload.totalBytes || 0) / 1048576).toFixed(0);
      const totalKnown = payload.totalBytes > 0;

      // Backend speed is authoritative — no client-side delta math.
      let speedText = payload.phase === 'starting' ? t('models.statusConnecting') : '';
      if (!speedText) {
        if (payload.speedBps > 0) {
          const speedMbps = ((payload.speedBps * 8) / 1e6).toFixed(1);
          speedText = `${speedMbps} Mbps`;
          if (totalKnown && payload.downloadedBytes <= payload.totalBytes) {
            const remainingSeconds = Math.round((payload.totalBytes - payload.downloadedBytes) / payload.speedBps);
            speedText += ` • ${t('models.etaLabel', { time: formatRemainingTime(remainingSeconds) })}`;
          }
        } else {
          speedText = (payload.downloadedBytes || 0) > 0 ? '...' : t('models.statusStarting');
        }
      }

      // 1. Progress bar fill in-place
      const barContainer = card.querySelector('.progress-bar-container');
      if (barContainer) barContainer.style.display = 'block';
      const barFill = card.querySelector('.progress-bar-fill');
      if (barFill) barFill.style.width = `${pct}%`;

      // 2. Description text inline without DOM recreation
      const descEl = card.querySelector('.setting-desc');
      if (descEl) {
        const meta = getModelMetaInfo(payload.modelName);
        const liveStatus = t('models.downloadLiveProgress', {
          size: dlMB,
          unit: t('models.unitMB'),
          pct: totalKnown ? pct : '...',
          speedLabel: t('models.speedLabel'),
          speed: speedText
        });
        descEl.innerHTML = `
          <span class="model-badge badge-downloading">${t('models.badgeDownloading')}</span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span>${t('models.expectedSize', { size: totalMB })}</span>
          ${meta.precisionText ? `
            <span style="color: rgba(255,255,255,0.1);">|</span>
            <span>${meta.precisionText}</span>
          ` : ''}
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span>${meta.langText}</span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span style="color: var(--color-cyan);">${liveStatus}</span>
        `;
      }

      // 3. Ensure button is "Pause" in-place
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl && !ctrlEl.querySelector('[data-action="pause"]')) {
        ctrlEl.innerHTML = `<button class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: escapeHTML(payload.modelName) })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>`;
      }
      // If card is NOT in current view/tab, do NOTHING to prevent tab re-rendering!
    } else {
      window.isDownloadingModelRunning = false;
      if (typeof window.updateTaskbarProgress === 'function') {
        window.updateTaskbarProgress(0, false, payload.phase === 'failed' ? 'error' : 'normal');
      }

      // paused / completed / failed -> Reload grid state once
      _cachedModelStatuses = null;
      loadModelStatusesGrid(true, true);
      if (payload.phase === 'failed') {
        showNotification(t('toasts.modelDownloadError', { name: payload.modelName || '', error: payload.error || 'unknown error' }), "error");
      } else if (payload.phase === 'completed') {
        showNotification(t('toasts.modelDownloadSuccess', { name: `ggml-${payload.modelName}.bin` }), "success");
        scanAndPopulateModels();
      }
    }
  });

  // Central logs listener
  on('log-message', (event) => {
    const payload = event.payload;
    payload.message = stripAnsi(payload.message);
    const now = new Date();
    const pad = (num) => num.toString().padStart(2, '0');
    payload.timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    allLogsArray.push(payload);
    if (allLogsArray.length > 10000) allLogsArray.splice(0, allLogsArray.length - 10000);
    appendLogToViewport(payload);

    // Intercept Whisper lines containing timestamp ranges
    if (payload.category === 'Whisper') {
      const match = payload.message.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/);
      if (match) {
        const timeRange = `[${match[1]}:${match[2]}:${match[3]} --> ${match[5]}:${match[6]}:${match[7]}]`;
        const text = match[9] || '';
        appendTranscriptLine(timeRange, text);
      }
    }
  });
}

// Append log to Viewport with AutoScroll & Filtering
function appendLogToViewport(payload) {
  // Check category filter
  if (activeLogCategory !== 'All' && payload.category !== activeLogCategory) {
    return;
  }
  
  // Check search query
  if (logSearchQuery !== '' && !payload.message.toLowerCase().includes(logSearchQuery.toLowerCase())) {
    return;
  }
  
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
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
  
  // Cap DOM children in viewport to max 1500 to prevent unbounded memory bloat
  if (viewport.children.length > 1500) {
    viewport.removeChild(viewport.firstElementChild);
  }
  
  // Handle Auto Scroll — debounced to avoid forced layout on every line
  const autoScroll = document.getElementById('log-autoscroll').checked;
  if (autoScroll) {
    clearTimeout(viewport._scrollDebounce);
    viewport._scrollDebounce = setTimeout(() => {
      viewport.scrollTop = viewport.scrollHeight;
    }, 80);
  }
}

function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, '');
}

function escapeHTML(str) {
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

window.selectBackend = function(backend, isInitialSelection = false) {
  if (!isInitialSelection && settingsState) {
    settingsState.selectedBackend = backend;
    saveCurrentSettings();
    scanAndPopulateModels();
  }
  updateTranscribeUIConfigs();
};

async function refreshBuildStatuses() {
  const allBackends = [
    { key: 'Standard', label: (typeof t === 'function' && t('transcribe.backendCpu')) || 'Standard CPU' },
    { key: 'Vulkan', label: (typeof t === 'function' && t('transcribe.backendVulkan')) || 'Vulkan GPU' },
    { key: 'OpenVINO', label: (typeof t === 'function' && t('transcribe.backendOpenvino')) || 'OpenVINO Intel' },
    { key: 'CUDA', label: (typeof t === 'function' && t('transcribe.backendCuda')) || 'NVIDIA CUDA' }
  ];

  const availableBackends = [];
  for (const b of allBackends) {
    let isCompiled = false;
    try {
      isCompiled = await invoke('check_build', { backend: b.key });
    } catch (e) {
      console.error(`Failed to check build for ${b.key}:`, e);
    }
    compiledBackends[b.key] = isCompiled;
    if (isCompiled) {
      availableBackends.push(b);
    }
  }

  // Fallback to Standard CPU if no binaries reported compiled (defensive)
  if (availableBackends.length === 0) {
    compiledBackends['Standard'] = true;
    availableBackends.push(allBackends[0]);
  }

  // Dynamically populate the Active Backend dropdown with ONLY compiled backends
  const dropdown = document.getElementById('opt-selectedBackend');
  if (dropdown) {
    const currentSelected = settingsState ? settingsState.selectedBackend : dropdown.value;
    
    // Check if options changed to prevent redundant DOM replacements
    const currentOptKeys = Array.from(dropdown.options).map(o => o.value);
    const newOptKeys = availableBackends.map(b => b.key);
    const optionsChanged = currentOptKeys.length !== newOptKeys.length || !currentOptKeys.every((k, i) => k === newOptKeys[i]);

    if (optionsChanged) {
      dropdown.innerHTML = '';
      availableBackends.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.key;
        opt.textContent = b.label;
        dropdown.appendChild(opt);
      });
    }

    // Auto-fallback: if current selected backend is not available, choose the best available
    const isCurrentValid = availableBackends.some(b => b.key === currentSelected);
    if (!isCurrentValid) {
      const fallbackBackend = availableBackends.find(b => b.key === 'Vulkan')?.key || availableBackends[0].key;
      if (settingsState) {
        settingsState.selectedBackend = fallbackBackend;
        saveCurrentSettings();
        scanAndPopulateModels();
      }
      dropdown.value = fallbackBackend;
    } else {
      dropdown.value = currentSelected;
    }

    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  }

  updateTranscribeUIConfigs();
}

let _isBrowsingModelsDirectory = false;
let _isOpeningModelsDirectory = false;

window.openModelsDirectory = async function() {
  if (_isOpeningModelsDirectory) return;
  _isOpeningModelsDirectory = true;

  const dirPath = (settingsState && settingsState.modelsDir) || document.getElementById('opt-modelsDir')?.value;
  if (!dirPath) {
    _isOpeningModelsDirectory = false;
    return;
  }

  try {
    try {
      await invoke('verify_directory_writable', { dirPath });
    } catch (permErr) {
      showNotification(t('toasts.modelsDirNotWritable', { error: String(permErr) }), "error");
      return;
    }
    await window.openFileInEditor(dirPath);
  } catch (err) {
    console.error('Failed to open models directory:', err);
    const msg = (err && (err.message || err.toString())) || String(err);
    showNotification(t('toasts.openFolderError', { error: msg }), "error");
  } finally {
    setTimeout(() => {
      _isOpeningModelsDirectory = false;
    }, 1000);
  }
};

window.browseModelsDirectory = async function() {
  if (_isBrowsingModelsDirectory) return;
  _isBrowsingModelsDirectory = true;

  const inputEl = document.getElementById('opt-modelsDir');
  const pathControl = inputEl?.closest('.setting-control-path');
  const browseBtn = pathControl?.querySelector('.path-browse-btn');
  const pathField = pathControl?.querySelector('.readonly-path-field');
  if (browseBtn) browseBtn.disabled = true;
  if (pathField) pathField.style.pointerEvents = 'none';

  try {
    const path = await invoke('select_directory');
    if (path) {
      try {
        await invoke('verify_directory_writable', { dirPath: path });
      } catch (permErr) {
        showNotification(t('toasts.modelsDirNotWritable', { error: String(permErr) }), "error");
        return;
      }

      if (inputEl) {
        inputEl.value = path;
        // Isolated so the path keeps its order in the tooltip, which the browser renders
        // with the document's direction rather than the element's styles.
        inputEl.title = isolateLtr(path);
        if (inputEl.parentElement) {
          inputEl.parentElement.title = isolateLtr(path);
        }
      }
      if (settingsState) {
        settingsState.modelsDir = path;
        await saveCurrentSettings();
        await scanAndPopulateModels();
      }
      _cachedModelStatuses = null;
      _cachedModelStatusesTime = 0;
      await refreshBuildStatuses();
    }
  } catch (err) {
    console.error('Failed to select models directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    if (pathField) pathField.style.pointerEvents = '';
    _isBrowsingModelsDirectory = false;
  }
};

window.switchSettingsCategory = function(catName) {
  if (catName === 'general') catName = 'app';
  const searchInput = document.getElementById('settings-search-input');
  const hasActiveSearch = Boolean(searchInput && searchInput.value.trim().length > 0);
  
  // If search is currently active and user clicks a category tab that has matching results,
  // smoothly scroll directly to that category section in the search view.
  if (hasActiveSearch) {
    const targetGroup = document.getElementById(`group-${catName}`);
    if (targetGroup && targetGroup.style.display !== 'none' && targetGroup.classList.contains('active')) {
      targetGroup.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // If the selected category had no matches, clear search to reveal the full category.
    searchInput.value = '';
    const clearBtn = document.getElementById('settings-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  activeSettingsCat = catName;
  
  // Reset scroll position to top when switching categories
  const scrollContainer = document.querySelector('.settings-scroll-container');
  if (scrollContainer) {
    scrollContainer.scrollTop = 0;
  }

  // Remove search headers and empty state if any
  document.querySelectorAll('.settings-search-group-header').forEach(h => h.remove());
  const emptyEl = document.getElementById('settings-search-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  // Toggle active category tabs and clear search badges/dimming
  const tabs = document.querySelectorAll('.settings-cat-btn');
  tabs.forEach(tab => {
    tab.classList.remove('active', 'search-dimmed');
    const badge = tab.querySelector('.cat-match-badge');
    if (badge) badge.remove();
    if (tab.id === `cat-btn-${catName}`) {
      tab.classList.add('active');
    }
  });
  
  // Toggle active groups and restore card visibility
  const groups = document.querySelectorAll('.settings-group');
  groups.forEach(group => {
    group.classList.remove('active');
    group.style.display = '';
    group.querySelectorAll('.setting-card').forEach(card => {
      card.style.display = '';
    });
  });
  
  const targetGroup = document.getElementById(`group-${catName}`);
  if (targetGroup) {
    targetGroup.classList.add('active');

    // Re-sync any custom dropdowns living inside this group so they recompute
    // their size/position now that the group is visible.
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  }

  // Ensure conditional cards (e.g. Custom Output Path) respect their true state
  if (typeof toggleOutputDirCustomField === 'function') {
    toggleOutputDirCustomField();
  }
};

window.clearSettingsSearch = function() {
  const searchInput = document.getElementById('settings-search-input');
  if (searchInput) {
    searchInput.value = '';
    window.filterSettings('', true);
    searchInput.focus();
  }
};

function executeFilterSettings(query) {
  const q = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('settings-search-clear');
  const emptyEl = document.getElementById('settings-search-empty');
  const emptyDescEl = document.getElementById('settings-search-empty-desc');
  const groups = document.querySelectorAll('.settings-group');
  const tabs = document.querySelectorAll('.settings-cat-btn');
  const scrollContainer = document.querySelector('.settings-scroll-container');

  if (clearBtn) {
    clearBtn.style.display = q ? 'flex' : 'none';
  }

  if (!q) {
    // Search cleared: restore normal category view
    if (emptyEl) emptyEl.style.display = 'none';
    document.querySelectorAll('.settings-search-group-header').forEach(h => h.remove());

    tabs.forEach(tab => {
      tab.classList.remove('search-dimmed');
      const badge = tab.querySelector('.cat-match-badge');
      if (badge) badge.remove();
      if (tab.id === `cat-btn-${activeSettingsCat}`) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    groups.forEach(group => {
      group.style.display = '';
      group.querySelectorAll('.setting-card').forEach(card => {
        card.style.display = '';
      });
      if (group.id === `group-${activeSettingsCat}`) {
        group.classList.add('active');
      } else {
        group.classList.remove('active');
      }
    });

    // Restore conditional cards (e.g. Custom Output Path) to their valid visibility
    if (typeof toggleOutputDirCustomField === 'function') {
      toggleOutputDirCustomField();
    }
    return;
  }

  // Active query: search across all settings groups
  let totalMatches = 0;
  const catMatches = {};

  const getCatTitle = (catName) => {
    const tab = document.getElementById(`cat-btn-${catName}`);
    if (!tab) return catName;
    const i18nKey = tab.getAttribute('data-i18n');
    if (i18nKey && typeof t === 'function') {
      const translated = t(i18nKey);
      if (translated && translated !== i18nKey) return translated;
    }
    return tab.childNodes[0]?.textContent?.trim() || tab.textContent.trim();
  };

  groups.forEach(group => {
    const catName = group.id.replace('group-', '');
    let groupMatches = 0;
    const cards = group.querySelectorAll('.setting-card');

    cards.forEach(card => {
      const searchTags = (card.getAttribute('data-search-tags') || '').toLowerCase();
      const title = (card.querySelector('.setting-title')?.textContent || '').toLowerCase();
      const desc = (card.querySelector('.setting-desc')?.textContent || '').toLowerCase();
      const descPoints = (card.querySelector('.setting-desc-points')?.textContent || '').toLowerCase();
      
      const optionsText = Array.from(card.querySelectorAll('select option'))
        .map(o => o.textContent.toLowerCase()).join(' ');
      const subCardsText = Array.from(card.querySelectorAll('.theme-card-title, .theme-card-desc, .radio-label, .preset-label'))
        .map(el => el.textContent.toLowerCase()).join(' ');

      const matches = searchTags.includes(q) ||
                      title.includes(q) ||
                      desc.includes(q) ||
                      descPoints.includes(q) ||
                      optionsText.includes(q) ||
                      subCardsText.includes(q);

      if (matches) {
        card.style.display = '';
        groupMatches++;
        totalMatches++;
      } else {
        card.style.display = 'none';
      }
    });

    catMatches[catName] = groupMatches;

    if (groupMatches > 0) {
      group.classList.add('active');
      group.style.display = 'flex';

      // Insert or update category header for group
      let header = group.querySelector(':scope > .settings-search-group-header');
      if (!header) {
        header = document.createElement('div');
        header.className = 'settings-search-group-header';
        group.insertBefore(header, group.firstChild);
      }
      header.textContent = getCatTitle(catName);
      header.style.display = 'flex';
    } else {
      group.classList.remove('active');
      group.style.display = 'none';
      const header = group.querySelector(':scope > .settings-search-group-header');
      if (header) header.style.display = 'none';
    }
  });

  // Update tabs with match badges or dim them
  tabs.forEach(tab => {
    const catName = tab.id.replace('cat-btn-', '');
    const count = catMatches[catName] || 0;
    let badge = tab.querySelector('.cat-match-badge');

    if (count > 0) {
      tab.classList.remove('search-dimmed');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cat-match-badge';
        tab.appendChild(badge);
      }
      badge.textContent = count;
    } else {
      tab.classList.add('search-dimmed');
      if (badge) badge.remove();
    }
  });

  // Handle empty state
  if (totalMatches === 0) {
    if (emptyEl) emptyEl.style.display = 'flex';
    if (emptyDescEl) {
      emptyDescEl.textContent = typeof t === 'function'
        ? t('settings.searchNoResultsDesc', { query: (query || '').trim() })
        : `No configuration options match "${(query || '').trim()}".`;
    }
    if (scrollContainer) scrollContainer.scrollTop = 0;
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
  }
}

window.filterSettings = function(query, immediate = false) {
  if (filterSettings._timer) {
    clearTimeout(filterSettings._timer);
    filterSettings._timer = null;
  }
  if (immediate || !query) {
    executeFilterSettings(query);
  } else {
    filterSettings._timer = setTimeout(() => {
      filterSettings._timer = null;
      executeFilterSettings(query);
    }, 80);
  }
};

async function refreshSettings() {
  try {
    settingsState = await invoke('load_settings');
    window.settingsState = settingsState;
    
    // Apply UI scale from loaded settings
    if (settingsState && typeof settingsState.uiScale === 'number') {
      applyUiZoom(settingsState.uiScale, false, false);
    }

    // Apply Color Theme from loaded settings
    const currentTheme = (settingsState && settingsState.theme) ? settingsState.theme : 'royal-blue';
    applyTheme(currentTheme);

    // Apply UI Language from loaded settings if specified (disk config is authoritative)
    if (settingsState && settingsState.uiLanguage) {
      if (settingsState.uiLanguage !== getLanguage()) {
        setLanguage(settingsState.uiLanguage, false);
      }
    }
    
    // Set models dir input
    const inputEl = document.getElementById('opt-modelsDir');
    if (inputEl) {
      inputEl.value = settingsState.modelsDir;
      inputEl.title = isolateLtr(settingsState.modelsDir);
      if (inputEl.parentElement) {
        inputEl.parentElement.title = isolateLtr(settingsState.modelsDir);
      }
    }
    
    // Render language dropdowns (localized, sorted, searchable) before binding
    // so the settings binder's value assignment finds their options in place
    initLanguageSelects();

    // Bind all options dynamically
    bindSettingsToDOM();
    
    // Scan models path
    await scanAndPopulateModels();
  } catch (e) {
    console.error("Failed to load settings in refreshSettings:", e);
    showNotification(t('toasts.settingsLoadError'), "error");
  }
}

function bindSettingsToDOM() {
  if (!settingsState) return;

  // Initialize AI translation elements defensively so table/provider issues never block settings loading
  try {
    if (typeof window.populateProvidersDropdown === 'function') {
      window.populateProvidersDropdown();
    }
    if (typeof window.onProviderChanged === 'function') {
      window.onProviderChanged();
    }
    if (window.translationStudioController) {
      window.translationStudioController.syncFromGlobalSettings();
    }
  } catch (aiErr) {
    console.error("Error initializing AI translation elements in bindSettingsToDOM:", aiErr);
  }
  
  // Helper to map keys
  const keys = Object.keys(settingsState);
  keys.forEach(key => {
    const el = document.getElementById(`opt-${key}`);
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = settingsState[key];
        el.onchange = () => {
          settingsState[key] = el.checked;
          saveCurrentSettings();
          if (key === 'translateAiPolish' && window.translationStudioController) {
            window.translationStudioController.syncFromGlobalSettings();
          }
          if (key === 'outputJson' || key === 'outputJsonFull') {
            syncJsonConfidenceDependency();
          }
        };
      } else if (el.tagName === 'SELECT' || el.type === 'text' || el.type === 'number') {
        el.value = settingsState[key];
        if (key === 'prompt' || el.id === 'opt-prompt' || el.hasAttribute('dir')) {
          applyDynamicDirection(el);
          if (!el._hasDynamicDirListener) {
            el._hasDynamicDirListener = true;
            el.addEventListener('input', () => applyDynamicDirection(el));
          }
        }
        el.onchange = () => {
          let val = el.value;
          if (INT_SETTING_KEYS.has(key)) {
            val = parseInt(el.value);
            if (isNaN(val)) val = 0;
            if (key === 'bestOf' || key === 'beamSize') {
              val = Math.max(1, Math.min(8, val));
              el.value = val;
            }
          } else if (FLOAT_SETTING_KEYS.has(key)) {
            val = parseFloat(el.value);
            if (isNaN(val)) val = 0.0;
          }
          if (key === 'uiScale') {
            const numVal = parseFloat(val) || 1.0;
            applyUiZoom(numVal, true, false);
            return;
          }
          if (key === 'theme') {
            switchTheme(val);
            return;
          }
          if (key === 'uiLanguage') {
            setLanguage(val);
            return;
          }

          settingsState[key] = val;
          saveCurrentSettings(true);
          
          if (key === 'language') {
            updateTranscribeUIConfigs();
          }
          if (key === 'selectedBackend') {
            refreshBuildStatuses();
          }
          if (key === 'ffmpegSource') {
            refreshFFmpegStatus(val, true);
          }
          if (key === 'translateAiProvider') {
            if (typeof onProviderChanged === 'function') {
              onProviderChanged();
            }
          }
          if ((key === 'translateAiTargetLang' || key === 'translateAiModel') && window.translationStudioController) {
            window.translationStudioController.syncFromGlobalSettings();
          }
          if (key === 'outputDirMode') {
            if (typeof toggleOutputDirCustomField === 'function') {
              toggleOutputDirCustomField();
            }
          }
        };
      }
    }
  });
  
  // Sync JSON confidence option dependency
  syncJsonConfidenceDependency();

  // Update build selection card highlight based on settings backend
  selectBackend(settingsState.selectedBackend, true);
  
  // Update FFmpeg engine status badge (passive initial check)
  refreshFFmpegStatus(settingsState.ffmpegSource, false);

  // Sync output directory custom field visibility
  if (typeof toggleOutputDirCustomField === 'function') {
    toggleOutputDirCustomField();
  }

  // Sync custom dropdown views
  if (window.syncCustomSelects) {
    window.syncCustomSelects();
  }

  // Update disabled states on stepper buttons
  if (typeof updateAllStepperButtons === 'function') {
    updateAllStepperButtons();
  }
}

function syncJsonConfidenceDependency() {
  const jsonOpt = document.getElementById('opt-outputJson');
  const jsonFullOpt = document.getElementById('opt-outputJsonFull');
  const confCard = document.getElementById('card-printConfidence');
  const confInput = document.getElementById('opt-printConfidence');

  const isJsonActive = Boolean((jsonOpt && jsonOpt.checked) || (jsonFullOpt && jsonFullOpt.checked));
  
  if (confCard) {
    if (isJsonActive) {
      confCard.style.opacity = '1';
      confCard.style.cursor = 'default';
      confCard.style.pointerEvents = 'auto';
      if (confInput) confInput.disabled = false;
      confCard.removeAttribute('title');
    } else {
      confCard.style.opacity = '0.45';
      confCard.style.cursor = 'not-allowed';
      confCard.style.pointerEvents = 'auto';
      if (confInput) {
        confInput.disabled = true;
        confInput.checked = false;
      }
      if (settingsState && settingsState.printConfidence) {
        settingsState.printConfidence = false;
        saveCurrentSettings();
      }
      confCard.title = 'Requires JSON Formatted (.json) or Full Detailed JSON (-ojf) to be enabled';
    }
  }
}

async function refreshFFmpegStatus(sourceOverride, userInitiated = false) {
  const badgeEl = document.getElementById('ffmpeg-status-badge');
  if (!badgeEl) return;

  const currentSource = sourceOverride || (settingsState ? settingsState.ffmpegSource : 'bundled');

  try {
    const info = await invoke('get_ffmpeg_status', { source: currentSource });
    if (info.isAvailable) {
      let verFormatted = 'Ready';
      if (info.version && info.version !== 'Unknown version' && info.version !== 'N/A') {
        const match = info.version.match(/version\s+([^\s]+)/i);
        let raw = match ? match[1] : info.version;
        raw = raw.split('-')[0].split('_')[0];
        if (raw.startsWith('n') || raw.startsWith('N')) {
          raw = raw.substring(1);
        }
        if (!raw.startsWith('v') && !raw.startsWith('V')) {
          raw = `v${raw}`;
        }
        verFormatted = raw;
      }
      badgeEl.className = 'setting-status-pill ready';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot blue"></span> ${verFormatted}`;
      badgeEl.title = `Source: ${info.configuredSource}\nPath: ${isolateLtr(info.resolvedPath)}\n${info.version}`;
    } else {
      badgeEl.className = 'setting-status-pill missing';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot red"></span> Not Found`;
      badgeEl.title = info.errorMessage || 'FFmpeg binary was not found';
      if (currentSource === 'system' && userInitiated) {
        showNotification(t('toasts.ffmpegNotFound'), "warning");
      }
    }
  } catch (err) {
    console.warn("Failed to check FFmpeg status:", err);
    if (badgeEl) {
      badgeEl.className = 'setting-status-pill error';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot yellow"></span> Status Error`;
    }
  }
}

const INT_SETTING_KEYS = new Set([
  'threads', 'processors', 'offsetT', 'duration', 'maxContext', 'maxLen',
  'bestOf', 'beamSize', 'audioCtx', 'deviceId', 'vadMinSpeech', 'vadMinSil', 'vadSpeechPad'
]);

const FLOAT_SETTING_KEYS = new Set([
  'wordThold', 'entropyThold', 'logprobThold', 'noSpeechThold',
  'temperature', 'temperatureInc', 'vadThold', 'vadMaxSpeech', 'vadOverlap', 'uiScale'
]);

function sanitizeSettingsPayload(state) {
  if (!state) return state;
  const clean = { ...state };
  for (const key of Object.keys(clean)) {
    if (INT_SETTING_KEYS.has(key)) {
      const parsed = parseInt(clean[key]);
      clean[key] = isNaN(parsed) ? 0 : parsed;
    } else if (FLOAT_SETTING_KEYS.has(key)) {
      const parsed = parseFloat(clean[key]);
      clean[key] = isNaN(parsed) ? 0.0 : parsed;
    }
  }
  return clean;
}

let saveSettingsDebounceTimer = null;

async function saveCurrentSettings(immediate = false) {
  if (!settingsState) return;
  
  // Ensure uiLanguage is synced
  settingsState.uiLanguage = getLanguage();

  // Ensure local state numeric values are strictly typed
  for (const key of Object.keys(settingsState)) {
    if (INT_SETTING_KEYS.has(key) && typeof settingsState[key] === 'string') {
      settingsState[key] = parseInt(settingsState[key]) || 0;
    } else if (FLOAT_SETTING_KEYS.has(key) && typeof settingsState[key] === 'string') {
      settingsState[key] = parseFloat(settingsState[key]) || 0.0;
    }
  }

  updateTranscribeUIConfigs();

  const doSave = async () => {
    try {
      const cleanPayload = sanitizeSettingsPayload(settingsState);
      await invoke('save_settings', { settings: cleanPayload });
    } catch (e) {
      console.error("Failed to save settings:", e);
      showNotification(t('toasts.settingsSaveError'), "error");
    }
  };

  if (immediate) {
    if (saveSettingsDebounceTimer) {
      clearTimeout(saveSettingsDebounceTimer);
      saveSettingsDebounceTimer = null;
    }
    await doSave();
  } else {
    if (saveSettingsDebounceTimer) {
      clearTimeout(saveSettingsDebounceTimer);
    }
    saveSettingsDebounceTimer = setTimeout(doSave, 250);
  }
}

window.addEventListener('beforeunload', () => {
  if (saveSettingsDebounceTimer && settingsState) {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = null;
    try {
      const cleanPayload = sanitizeSettingsPayload(settingsState);
      invoke('save_settings', { settings: cleanPayload });
    } catch (_) {}
  }
});

window.addEventListener('pagehide', () => {
  if (saveSettingsDebounceTimer && settingsState) {
    clearTimeout(saveSettingsDebounceTimer);
    saveSettingsDebounceTimer = null;
    try {
      const cleanPayload = sanitizeSettingsPayload(settingsState);
      invoke('save_settings', { settings: cleanPayload });
    } catch (_) {}
  }
  // Best-effort frontend disposal; backend exit handling is authoritative.
  if (window.hardsubController && typeof window.hardsubController.dispose === 'function') {
    window.hardsubController.dispose();
  }
});

function getStepperBounds(inputId) {
  let min = -Infinity;
  let max = Infinity;

  if (inputId === 'opt-threads' || inputId === 'opt-processors') {
    min = 1;
  } else if (inputId === 'opt-deviceId' || inputId === 'opt-maxLen') {
    min = 0;
  } else if (inputId === 'opt-maxContext') {
    min = -1;
  } else if (inputId === 'opt-bestOf' || inputId === 'opt-beamSize') {
    min = 1;
    max = 8;
  }
  return { min, max };
}

function updateStepperButtonStates(inputOrId) {
  const input = typeof inputOrId === 'string' ? document.getElementById(inputOrId) : inputOrId;
  if (!input) return;
  const ctrl = input.closest('.number-input-control');
  if (!ctrl) return;

  const decBtn = ctrl.querySelector('button:first-child');
  const incBtn = ctrl.querySelector('button:last-child');
  const val = parseInt(input.value);
  const { min, max } = getStepperBounds(input.id);

  if (decBtn) {
    decBtn.disabled = !isNaN(val) && val <= min;
  }
  if (incBtn) {
    incBtn.disabled = !isNaN(val) && val >= max;
  }
}

function updateAllStepperButtons() {
  document.querySelectorAll('.number-input-control input').forEach(input => {
    updateStepperButtonStates(input);
  });
}

function clampNumberSetting(inputId, val) {
  let num = parseInt(val);
  if (isNaN(num)) num = 0;
  
  const { min, max } = getStepperBounds(inputId);
  if (num < min) num = min;
  if (num > max) num = max;
  return num;
}

window.incrementNumber = function(inputId, step = 1, immediate = false) {
  const el = document.getElementById(inputId);
  if (el) {
    let currentVal = parseInt(el.value);
    if (isNaN(currentVal)) currentVal = 0;
    const nextVal = clampNumberSetting(inputId, currentVal + step);
    el.value = nextVal;
    updateStepperButtonStates(el);
    
    const key = inputId.replace('opt-', '');
    if (settingsState && key in settingsState) {
      settingsState[key] = nextVal;
      saveCurrentSettings(immediate);
    }
  }
};

window.decrementNumber = function(inputId, step = 1, immediate = false) {
  const el = document.getElementById(inputId);
  if (el) {
    let currentVal = parseInt(el.value);
    if (isNaN(currentVal)) currentVal = 0;
    const nextVal = clampNumberSetting(inputId, currentVal - step);
    el.value = nextVal;
    updateStepperButtonStates(el);
    
    const key = inputId.replace('opt-', '');
    if (settingsState && key in settingsState) {
      settingsState[key] = nextVal;
      saveCurrentSettings(immediate);
    }
  }
};

function setupNumberInputControls() {
  document.querySelectorAll('.number-input-control').forEach(ctrl => {
    const input = ctrl.querySelector('input');
    if (!input || ctrl._stepperInitialized) {
      if (input) updateStepperButtonStates(input);
      return;
    }
    ctrl._stepperInitialized = true;

    // Detect step from button onclick
    const incBtn = ctrl.querySelector('button:last-child');
    let step = 1;
    if (incBtn) {
      const match = incBtn.getAttribute('onclick')?.match(/,\s*([0-9.]+)\)/);
      if (match) step = parseFloat(match[1]) || 1;
    }

    const commitValue = (immediate = true) => {
      const clamped = clampNumberSetting(input.id, input.value);
      input.value = clamped;
      updateStepperButtonStates(input);
      const key = input.id.replace('opt-', '');
      if (settingsState && key in settingsState) {
        settingsState[key] = clamped;
        saveCurrentSettings(immediate);
      }
    };

    // Keyboard navigation (ArrowUp, ArrowDown, PageUp, PageDown, Enter, Escape)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        window.incrementNumber(input.id, step, false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        window.decrementNumber(input.id, step, false);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        window.incrementNumber(input.id, step * 5, false);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        window.decrementNumber(input.id, step * 5, false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitValue(true);
        input.blur();
      } else if (e.key === 'Escape') {
        const key = input.id.replace('opt-', '');
        if (settingsState && key in settingsState) {
          input.value = settingsState[key];
        }
        updateStepperButtonStates(input);
        input.blur();
      }
    });

    // Auto-select entire text on focus for effortless replacement
    input.addEventListener('focus', () => {
      setTimeout(() => input.select(), 10);
    });

    // Filter non-numeric characters live while typing
    input.addEventListener('input', () => {
      let cleaned = input.value.replace(/[^0-9\-]/g, '');
      if (cleaned.lastIndexOf('-') > 0) {
        cleaned = cleaned.charAt(0) === '-' ? '-' + cleaned.replace(/\-/g, '') : cleaned.replace(/\-/g, '');
      }
      input.value = cleaned;
      updateStepperButtonStates(input);
      const key = input.id.replace('opt-', '');
      if (cleaned !== '' && cleaned !== '-' && settingsState && key in settingsState) {
        const num = clampNumberSetting(input.id, cleaned);
        settingsState[key] = num;
        saveCurrentSettings(false);
      }
    });

    // Validate and persist immediately on blur / change
    input.addEventListener('blur', () => commitValue(true));
    input.addEventListener('change', () => commitValue(true));

    // Smooth notch-based mouse wheel support (active ONLY when focused to prevent scroll-trapping)
    ctrl._wheelAccumulator = 0;
    ctrl.addEventListener('wheel', (e) => {
      if (document.activeElement !== input) {
        return; // Allow page to scroll naturally when not focused
      }
      e.preventDefault();
      ctrl._wheelAccumulator = (ctrl._wheelAccumulator || 0) + e.deltaY;
      const NOTCH_THRESHOLD = 50;
      if (Math.abs(ctrl._wheelAccumulator) >= NOTCH_THRESHOLD) {
        const ticks = Math.trunc(ctrl._wheelAccumulator / NOTCH_THRESHOLD);
        ctrl._wheelAccumulator -= ticks * NOTCH_THRESHOLD;
        if (ticks < 0) {
          window.incrementNumber(input.id, step * Math.abs(ticks), false);
        } else if (ticks > 0) {
          window.decrementNumber(input.id, step * ticks, false);
        }
      }
    }, { passive: false });

    // Initial button state
    updateStepperButtonStates(input);
  });
}

async function scanAndPopulateModels() {
  if (!settingsState) return;
  
  try {
    const res = await invoke('scan_models', {
      modelsDir: settingsState.modelsDir,
      backend: settingsState.selectedBackend
    });
    
    localScannedTransModels = res.transModels || [];
    
    // 1. Populate Model Selection for both Settings & Quick Config Deck
    const transSelect = document.getElementById('opt-modelPath');
    const quickSelect = document.getElementById('quick-opt-model');
    
    if (transSelect) transSelect.innerHTML = '';
    if (quickSelect) quickSelect.innerHTML = '';
    
    const seenModelNames = new Set();
    let modelMatched = false;
    
    const validModels = (res.transModels || []).filter(m => {
      const name = getBasename(m);
      return !name.startsWith('for-tests') && !name.startsWith('No trans');
    });

    validModels.sort((a, b) => {
      const nameA = getBasename(a);
      const nameB = getBasename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (validModels.length === 0) {
      if (transSelect) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = t('transcribe.noModelsFound');
        transSelect.appendChild(emptyOpt);
      }
      if (quickSelect) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = t('transcribe.noModelsFoundDropdown');
        quickSelect.appendChild(emptyOpt);
      }
    } else {
      validModels.forEach(m => {
        const name = getBasename(m);
        if (seenModelNames.has(name)) return;
        seenModelNames.add(name);
        
        if (transSelect) {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = name;
          if (m === settingsState.modelPath) {
            opt.selected = true;
            modelMatched = true;
          }
          transSelect.appendChild(opt);
        }

        if (quickSelect) {
          const quickOpt = document.createElement('option');
          quickOpt.value = m;
          quickOpt.textContent = name;
          if (m === settingsState.modelPath) {
            quickOpt.selected = true;
          }
          quickSelect.appendChild(quickOpt);
        }
      });
    }

    if (!modelMatched && transSelect && transSelect.options.length > 0 && transSelect.value) {
      transSelect.selectedIndex = 0;
      settingsState.modelPath = transSelect.value;
      if (quickSelect) quickSelect.value = transSelect.value;
    }
    
    if (transSelect) {
      transSelect.onchange = () => {
        settingsState.modelPath = transSelect.value;
        if (quickSelect) quickSelect.value = transSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      };
    }

    if (quickSelect) {
      quickSelect.onchange = () => {
        if (quickSelect.value) {
          settingsState.modelPath = quickSelect.value;
          if (transSelect) transSelect.value = quickSelect.value;
          saveCurrentSettings();
          updateTranscribeUIConfigs();
        }
      };
    }

    // 2. Populate VAD Selection
    const vadSelect = document.getElementById('opt-vadModel');
    const validVadModels = (res.vadModels || []).filter(m => m !== 'No VAD models found');
    validVadModels.sort((a, b) => {
      const nameA = getBasename(a);
      const nameB = getBasename(b);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
    });
    localScannedVadModels = validVadModels;
    let vadMatched = false;

    if (vadSelect) {
      vadSelect.innerHTML = '';
      validVadModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = getBasename(m);
        if (m === settingsState.vadModel) {
          opt.selected = true;
          vadMatched = true;
        }
        vadSelect.appendChild(opt);
      });
      if (!vadMatched && validVadModels.length > 0) {
        vadSelect.selectedIndex = 0;
        settingsState.vadModel = vadSelect.value;
      } else if (validVadModels.length === 0) {
        settingsState.vadModel = '';
      }
      vadSelect.onchange = () => {
        settingsState.vadModel = vadSelect.value;
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      };
    } else {
      if (!vadMatched && validVadModels.length > 0) {
        if (!settingsState.vadModel || !validVadModels.includes(settingsState.vadModel)) {
          settingsState.vadModel = validVadModels[0];
        }
      } else if (validVadModels.length === 0) {
        settingsState.vadModel = '';
      }
    }

    // Save state if auto-selected
    if ((!modelMatched && transSelect && transSelect.options.length > 0 && transSelect.value) || (!vadMatched && validVadModels.length > 0)) {
      await saveCurrentSettings();
    }
    
    updateTranscribeUIConfigs();

    // Sync custom dropdown views
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  } catch (e) {
    console.error("Failed to scan models directory:", e);
  }
}

window.toggleOutputDirCustomField = function() {
  const modeEl = document.getElementById('opt-outputDirMode');
  const cardEl = document.getElementById('output-dir-custom-card');
  const wrapEl = document.getElementById('output-dir-custom-wrap');
  if (cardEl) {
    if (modeEl && modeEl.value === 'custom') {
      cardEl.style.display = 'flex';
    } else {
      cardEl.style.display = 'none';
    }
  }
  if (wrapEl) {
    if (modeEl && modeEl.value === 'custom') {
      wrapEl.style.display = 'flex';
    } else {
      wrapEl.style.display = 'none';
    }
  }
};

let _isBrowsingOutputDir = false;
let _isOpeningOutputDir = false;

window.openCustomOutputDir = async function() {
  if (_isOpeningOutputDir) return;
  _isOpeningOutputDir = true;

  const dirPath = (settingsState && settingsState.outputDirPath) || document.getElementById('opt-outputDirPath')?.value;
  if (!dirPath) {
    _isOpeningOutputDir = false;
    showNotification(t('toasts.noOutputDirFound'), "info");
    return;
  }

  try {
    try {
      await invoke('verify_directory_writable', { dirPath });
    } catch (permErr) {
      showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
      return;
    }
    await window.openFileInEditor(dirPath);
  } catch (err) {
    console.error('Failed to open output directory:', err);
    const msg = (err && (err.message || err.toString())) || String(err);
    showNotification(t('toasts.openFolderError', { error: msg }), "error");
  } finally {
    setTimeout(() => {
      _isOpeningOutputDir = false;
    }, 1000);
  }
};

window.browseOutputDir = async function() {
  if (_isBrowsingOutputDir) return;
  _isBrowsingOutputDir = true;

  const inputEl = document.getElementById('opt-outputDirPath');
  const pathControl = inputEl?.closest('.setting-control-path');
  const browseBtn = pathControl?.querySelector('.path-browse-btn');
  const pathField = pathControl?.querySelector('.readonly-path-field');
  if (browseBtn) browseBtn.disabled = true;
  if (pathField) pathField.style.pointerEvents = 'none';

  try {
    const dir = await invoke('select_directory');
    if (dir) {
      try {
        await invoke('verify_directory_writable', { dirPath: dir });
      } catch (permErr) {
        showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
        return;
      }

      if (inputEl) {
        inputEl.value = dir;
        inputEl.title = isolateLtr(dir);
        if (inputEl.parentElement) {
          inputEl.parentElement.title = isolateLtr(dir);
        }
      }
      if (settingsState) {
        settingsState.outputDirPath = dir;
        await saveCurrentSettings();
      }
    }
  } catch (err) {
    console.error('Failed to select output directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    if (pathField) pathField.style.pointerEvents = '';
    _isBrowsingOutputDir = false;
  }
};



// ----------------- Transcribe Panel & Accordion Wizard -----------------
window.toggleWizardAccordion = function(stepNum) {
  const stepEl = document.getElementById(`wizard-step-${stepNum}`);
  if (!stepEl) return;
  
  const isCurrentlyActive = stepEl.classList.contains('active');
  
  // Collapse all steps
  for (let i = 1; i <= 3; i++) {
    const s = document.getElementById(`wizard-step-${i}`);
    if (s) {
      s.classList.remove('active');
      const chevron = document.getElementById(`wizard-chevron-${i}`);
      if (chevron) chevron.textContent = '▼';
    }
  }
  
  // Toggle active class
  if (!isCurrentlyActive) {
    stepEl.classList.add('active');
    const chevron = document.getElementById(`wizard-chevron-${stepNum}`);
    if (chevron) chevron.textContent = '▲';
  }
};

window.openWizardStep = function(stepNum) {
  for (let i = 1; i <= 3; i++) {
    const s = document.getElementById(`wizard-step-${i}`);
    if (s) {
      s.classList.remove('active');
      const chevron = document.getElementById(`wizard-chevron-${i}`);
      if (chevron) chevron.textContent = '▼';
    }
  }
  
  const targetStep = document.getElementById(`wizard-step-${stepNum}`);
  if (targetStep) {
    targetStep.classList.add('active');
    const chevron = document.getElementById(`wizard-chevron-${stepNum}`);
    if (chevron) chevron.textContent = '▲';
  }
};

function setWizardStepCompleted(stepNum, isCompleted) {
  const stepEl = document.getElementById(`wizard-step-${stepNum}`);
  const iconEl = document.getElementById(`wizard-icon-${stepNum}`);
  if (!stepEl || !iconEl) return;
  
  if (isCompleted) {
    stepEl.classList.add('completed');
    iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;color:var(--color-green);"><path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else {
    stepEl.classList.remove('completed');
    iconEl.textContent = stepNum;
  }
}

window.browseMediaFile = async function() {
  const startBtn = document.getElementById('btn-run-batch');
  if (startBtn && startBtn.disabled) {
    showNotification(t('toasts.batchActiveSelectBlocked'), "info");
    return;
  }
  const files = await invoke('select_files');
  if (files && files.length > 0) {
    selectedMediaFiles = files;
    
    if (files.length === 1) {
      isBatchMode = false;
      selectedMediaFile = files[0];
      
      // Update UI for Single-file Mode
      document.getElementById('lbl-file-name').style.display = 'block';
      document.getElementById('lbl-file-path').style.display = 'block';
      updateMediaCardName(selectedMediaFile);
      document.getElementById('lbl-file-path').textContent = selectedMediaFile;
      document.getElementById('batch-queue-container').style.display = 'none';
      
      document.getElementById('media-meta-box').style.display = 'grid';
      document.getElementById('batch-specs-box').style.display = 'none';
      document.getElementById('btn-next-step-2').textContent = t('transcribe.continueToTranscription');
      
      
      document.getElementById('batch-controls-box').style.display = 'none';
      document.getElementById('btn-run-transcribe').style.display = 'inline-flex';
      document.getElementById('btn-cancel-transcribe').style.display = 'none';
      document.getElementById('wizard-step-3').style.display = 'block';
      
      wavPathForTranscription = null;
      
      if (settingsState) {
        settingsState.inputFile = selectedMediaFile;
        saveCurrentSettings();
      }
      
      setWizardStepCompleted(1, true);
      await probeSelectedFile();
    } else {
      isBatchMode = true;
      selectedMediaFile = null; // Clear single-file state
      
      // Update UI for Batch Mode
      document.getElementById('lbl-file-name').style.display = 'none';
      document.getElementById('lbl-file-path').style.display = 'none';
      document.getElementById('batch-queue-container').style.display = 'block';
      
      // Populate batch table state
      batchItems = files.map(filePath => ({
        path: filePath,
        name: getBasename(filePath),
        size: t('transcribe.statusPending') + '...',
        durationSec: null,
        status: 'pending',
        timeSec: 0,
        speedFactor: 0.0,
        outputs: []
      }));
      
      renderBatchQueueTable();
      updateBatchSpecs();
      
      // Setup specs details for batch
      document.getElementById('media-meta-box').style.display = 'none';
      document.getElementById('batch-specs-box').style.display = 'block';
      document.getElementById('batch-files-count').textContent = files.length;
      document.getElementById('btn-next-step-2').textContent = t('transcribe.continueToBatchSetup');
      
      
      document.getElementById('batch-controls-box').style.display = 'block';
      document.getElementById('btn-run-transcribe').style.display = 'none';
      document.getElementById('btn-cancel-transcribe').style.display = 'none';
      
      setWizardStepCompleted(1, true);
      setWizardStepCompleted(2, true);
      
      // Probe file sizes and durations sequentially to avoid race / DOM thrash
      (async () => {
        for (let idx = 0; idx < files.length; idx++) {
          try {
            const meta = await invoke('probe_media_file', { filePath: files[idx] });
            if (meta && meta.exists) {
              batchItems[idx].size = meta.size;
              batchItems[idx].durationSec = meta.durationSec;
            }
          } catch (err) {
            console.error("Failed to probe file in batch:", err);
          }
        }
        renderBatchQueueTable();
        updateBatchSpecs();
      })();
      
      setTimeout(() => {
        openWizardStep(2);
      }, 500);
    }
  }
};

async function probeSelectedFile() {
  if (!selectedMediaFile) return;
  
  try {
    probedMetadata = await invoke('probe_media_file', { filePath: selectedMediaFile });
    
    if (probedMetadata.exists) {
      document.getElementById('media-meta-box').style.display = 'grid';
      document.getElementById('meta-type').textContent = probedMetadata.format;
      document.getElementById('meta-size').textContent = probedMetadata.size;
      
      const recText = `Backend: ${settingsState.selectedBackend} (${settingsState.threads} threads)`;
      document.getElementById('meta-recommendation').textContent = recText;
      
      const dur = probedMetadata.durationSec;
      const hours = Math.floor(dur / 3600);
      const minutes = Math.floor((dur % 3600) / 60);
      const seconds = Math.floor(dur % 60);
      const durStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      document.getElementById('meta-duration').textContent = durStr;
      
      setWizardStepCompleted(2, true);
      openWizardStep(2);
      
      const fillBar = document.getElementById('progress-linear-fill');
      if (fillBar) fillBar.style.width = '0%';
      document.getElementById('lbl-radial-pct').textContent = '0%';
      document.getElementById('lbl-radial-msg').textContent = t('transcribe.readyForTranscription');
      
      setWizardStepCompleted(3, false);
      document.getElementById('analytics-box').style.display = 'none';
    } else {
      showNotification(t('toasts.fileNotFoundOrInvalid'), "error");
    }
  } catch (e) {
    console.error("Probing failed:", e);
    showNotification(t('toasts.metaReadError'), "error");
  }
}

window.toggleTelemetryHudCollapse = function() {
  const card = document.getElementById('telemetry-hud-card');
  const btn = document.getElementById('hud-collapse-btn');
  if (card && btn) {
    const isCollapsed = card.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', isCollapsed);
  }
};

function updateTranscribeUIConfigs() {
  if (!settingsState) return;
  
  const backend = settingsState.selectedBackend || 'Standard';
  const backendEl = document.getElementById('trans-cfg-backend');
  if (backendEl) {
    backendEl.textContent = backend;
    backendEl.title = backend;
  }
  
  // 1. Sync Quick Engine / Backend Select (Show ONLY compiled/available backends)
  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend');
  if (quickBackendSelect) {
    const backendDefs = [
      { key: 'Standard', label: t('transcribe.backendCpu') },
      { key: 'Vulkan', label: t('transcribe.backendVulkan') },
      { key: 'CUDA', label: t('transcribe.backendCuda') },
      { key: 'OpenVINO', label: t('transcribe.backendOpenvino') }
    ];
    
    // Filter to only include compiled backends (Standard CPU is always present as fallback)
    const availableBackends = backendDefs.filter(b => b.key === 'Standard' || Boolean(compiledBackends[b.key]));
    
    // Rebuild options if the list of available backends has changed
    const currentKeys = Array.from(quickBackendSelect.options).map(o => o.value).join(',');
    const targetKeys = availableBackends.map(b => b.key).join(',');
    if (currentKeys !== targetKeys) {
      quickBackendSelect.innerHTML = '';
      availableBackends.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.key;
        opt.textContent = b.label;
        if (b.key === backend) {
          opt.selected = true;
        }
        quickBackendSelect.appendChild(opt);
      });
    } else {
      Array.from(quickBackendSelect.options).forEach(opt => {
        const match = availableBackends.find(b => b.key === opt.value);
        if (match && opt.textContent !== match.label) {
          opt.textContent = match.label;
        }
      });
    }
    quickBackendSelect.value = backend;
  }
  
  const model = getBasename(settingsState.modelPath) || 'None';
  const modelEl = document.getElementById('trans-cfg-model');
  if (modelEl) {
    modelEl.textContent = model;
    modelEl.title = model;
  }

  // 2. Sync Quick Model Select
  const quickModelSelect = document.getElementById('quick-opt-model');
  if (quickModelSelect && settingsState.modelPath) {
    quickModelSelect.value = settingsState.modelPath;
  }

  // 3. Sync Quick Language Select (re-render keeps localization, sort order,
  //    recents and legacy custom values in sync with settingsState.language)
  const quickLangSelect = document.getElementById('quick-opt-language');
  if (quickLangSelect) {
    renderLanguageSelect(quickLangSelect, 'spoken', (settingsState.language || 'auto').trim());
  }
  
  // 4. Sync Quick VAD Button State & Tooltip
  const hasVadModel = Boolean(localScannedVadModels && localScannedVadModels.length > 0 && settingsState.vadModel);
  const vadActive = Boolean(settingsState.vad && hasVadModel);
  const vadModelName = settingsState.vadModel ? getBasename(settingsState.vadModel) : 'Default';

  const vadEl = document.getElementById('trans-cfg-vad');
  if (vadEl) {
    vadEl.textContent = vadActive ? 'ON' : 'OFF';
    vadEl.className = vadActive ? 'val-gold' : 'val-muted';
    vadEl.title = vadActive ? `VAD Active (${vadModelName})` : 'VAD Disabled';
  }
  
  const quickVadBtn = document.getElementById('quick-toggle-vad');
  const quickVadText = document.getElementById('quick-vad-status-text');
  if (quickVadBtn && quickVadText) {
    if (vadActive) {
      quickVadBtn.classList.add('active');
      quickVadText.textContent = t('transcribe.vadActiveStatus');
      quickVadBtn.title = `Silero VAD Active (${vadModelName}) - Click to disable`;
    } else {
      quickVadBtn.classList.remove('active');
      if (hasVadModel) {
        quickVadText.textContent = t('transcribe.vadDisabledStatus');
        quickVadBtn.title = `Silero VAD Disabled (${vadModelName}) - Click to enable`;
      } else {
        quickVadText.textContent = t('transcribe.vadNoModelStatus');
        quickVadBtn.title = 'No Silero VAD model found on system - Click for instructions';
      }
    }
  }
  
  const transCfgTranslation = document.getElementById('trans-cfg-translation');
  if (transCfgTranslation) {
    const translationEnabled = settingsState.translateAiEnabled === true;
    let translationText = 'OFF';
    let fullTitle = 'Translation Disabled';
    if (translationEnabled) {
      const aiModel = settingsState.translateAiModel || '';
      translationText = aiModel ? `ON (${aiModel})` : 'ON';
      fullTitle = aiModel ? `Translation Active: ${aiModel}` : 'Translation Active';
    }
    transCfgTranslation.textContent = translationText;
    transCfgTranslation.title = fullTitle;
    transCfgTranslation.className = translationEnabled ? 'val-green' : 'val-muted';
  }

  // Sync custom dropdown visuals
  if (window.syncCustomSelects) {
    window.syncCustomSelects();
  }
}

function setupQuickConfigDeckEventListeners() {
  // 1. Quick Language Selection Listener
  const quickLangSelect = document.getElementById('quick-opt-language');
  if (quickLangSelect) {
    quickLangSelect.addEventListener('change', () => {
      if (settingsState) {
        settingsState.language = quickLangSelect.value;
        const cfgLangInput = document.getElementById('opt-language');
        if (cfgLangInput) {
          cfgLangInput.value = quickLangSelect.value;
        }
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  // 2. Quick Engine / Backend Selection Listener
  const quickBackendSelect = document.getElementById('quick-opt-selectedBackend');
  if (quickBackendSelect) {
    quickBackendSelect.addEventListener('change', async () => {
      const backend = quickBackendSelect.value;
      const isCompiled = backend === 'Standard' || Boolean(compiledBackends[backend]);
      if (!isCompiled) {
        showNotification(t('toasts.backendNotFound', { backend: backend === 'Standard' ? 'CPU' : backend }), "error");
        if (settingsState) {
          quickBackendSelect.value = settingsState.selectedBackend;
          if (window.syncCustomSelects) window.syncCustomSelects();
        }
        return;
      }
      if (settingsState) {
        selectBackend(backend, false);
        const cfgBackendSelect = document.getElementById('opt-selectedBackend');
        if (cfgBackendSelect) {
          cfgBackendSelect.value = backend;
        }
        showNotification(t('toasts.backendSwitched', { backend: backend === 'Standard' ? 'Standard CPU' : backend + ' GPU' }), "success");
      }
    });
  }
}

window.toggleQuickVad = function() {
  if (!settingsState) return;
  
  const willEnable = !settingsState.vad;
  if (willEnable) {
    const hasVadModel = Boolean(localScannedVadModels && localScannedVadModels.length > 0 && settingsState.vadModel);
    if (!hasVadModel) {
      showNotification(t('toasts.noVadFound'), "warning");
      return;
    }
  }

  settingsState.vad = willEnable;
  const cfgVadCheckbox = document.getElementById('opt-vad');
  if (cfgVadCheckbox) {
    cfgVadCheckbox.checked = settingsState.vad;
  }
  saveCurrentSettings();
  updateTranscribeUIConfigs();
  const vadModelName = settingsState.vadModel ? getBasename(settingsState.vadModel) : 'Silero VAD';
  showNotification(settingsState.vad ? t('toasts.vadEnabled', { model: vadModelName }) : t('toasts.vadDisabled'), "info");
};

window.runWhisperTranscription = async function() {
  const btn = document.getElementById('btn-run-transcribe');
  const btnSpan = btn?.querySelector('span');
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  const fillBar = document.getElementById('progress-linear-fill');
  const pctEl = document.getElementById('lbl-radial-pct');
  const msgEl = document.getElementById('lbl-radial-msg');
  const pulseDot = document.getElementById('hud-pulse-dot');

  if (!selectedMediaFile && !wavPathForTranscription) {
    showNotification(t('toasts.noFileSelected'), "info");
    return;
  }

  const isCompiled = compiledBackends[settingsState.selectedBackend];
  if (!isCompiled) {
    showNotification(t('toasts.backendNotFound', { backend: settingsState.selectedBackend }), "error");
    switchView('settings');
    return;
  }

  const modelExists = localScannedTransModels.includes(settingsState.modelPath);
  if (!modelExists) {
    showNotification(t('toasts.noModelFound'), "error");
    return;
  }

  btn.disabled = true;
  document.getElementById('analytics-box').style.display = 'none';

  // Clear transcript preview
  transcriptLines = [];
  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = `<div style="color: var(--color-cyan); text-align: center; margin-top: 40px; font-weight: 500;">${t('transcribe.aiModelInitializing')}</div>`;
  }

  try {
    // Phase 1: Auto-convert to WAV if not already done
    if (!wavPathForTranscription) {
      if (btnSpan) btnSpan.textContent = t('transcribe.convertingToWav'); else btn.textContent = t('transcribe.convertingToWav');
      if (msgEl) msgEl.textContent = t('transcribe.convertingAudio16k');
      if (fillBar) {
        fillBar.style.width = '50%';
        fillBar.classList.add('indeterminate');
      }
      if (pctEl) pctEl.textContent = t('transcribe.convertingProgress');

      wavPathForTranscription = await invoke('convert_media_file', { filePath: selectedMediaFile });

      if (fillBar) fillBar.classList.remove('indeterminate');
      if (msgEl) msgEl.textContent = t('transcribe.wavReadyTranscribing');
    }

    // Phase 2: Run Whisper transcription
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (btnSpan) btnSpan.textContent = t('transcribe.aiTranscribingStatus'); else btn.textContent = t('transcribe.aiTranscribingStatus');

    const result = await invoke('start_transcription_task', {
      settings: settingsState,
      wavPath: wavPathForTranscription,
      durationSec: probedMetadata ? probedMetadata.durationSec : 60.0
    });

    // Load final transcript from the text file
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      const outputDir = result.outputDir || getParentDir(settingsState.inputFile);
      const txtFile = result.generatedFiles.find(f => f.endsWith('.txt'));
      if (txtFile) {
        const sep = outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
        await loadTranscriptFromFile(`${outputDir}${sep}${txtFile}`);
      }
    }

    document.getElementById('analytics-box').style.display = 'flex';
    document.getElementById('analytic-time').textContent = `${(result.durationMs / 1000).toFixed(1)}s`;
    document.getElementById('analytic-speed').textContent = `${result.speedFactor.toFixed(1)}x Real-time`;

    const badgesRow = document.getElementById('badge-outputs-row');
    badgesRow.innerHTML = '';
    const outputDir = result.outputDir || getParentDir(settingsState.inputFile);
    window.lastTranscribedOutputDir = outputDir;
    const sep = outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';

    const createRoyalBadge = (filename) => {
      const fullPath = `${outputDir}${sep}${filename}`;
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'output-badge royal-badge';
      badge.title = `Click to open "${filename}" in default text editor`;
      const displayName = window.formatFileNameMiddleTruncate(filename, 26);
      badge.innerHTML = `
        <svg class="badge-icon-file" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span class="badge-name">${escapeHTML(displayName)}</span>
        <svg class="badge-icon-open" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      `;
      badge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.openFileInEditor(fullPath);
      };
      return badge;
    };

    result.generatedFiles.forEach(f => {
      badgesRow.appendChild(createRoyalBadge(f));
    });

    // Mark Step 3 as completed and notify user immediately when transcription succeeds
    setWizardStepCompleted(3, true);
    const elapsedSec = result.durationMs ? (result.durationMs / 1000) : 0;
    showNotification(t('toasts.transcriptionComplete', { time: formatDuration(elapsedSec) }), "success");

    // Run AI Translation if enabled
    if (settingsState.translateAiEnabled && result.generatedFiles && result.generatedFiles.length > 0) {
      try {
        if (btnSpan) btnSpan.textContent = t('transcribe.aiTranslating'); else btn.textContent = t('transcribe.aiTranslating');
        showNotification(t('toasts.aiTranslateStart'), "info");

        const translatedFiles = await invoke('translate_transcription_files', {
          settings: settingsState,
          generatedFiles: result.generatedFiles,
          parentDir: outputDir
        });

        translatedFiles.forEach(f => {
          badgesRow.appendChild(createRoyalBadge(f));
        });

        showNotification(t('toasts.aiTranslateComplete'), "success");
      } catch (err) {
        const errMsg = (typeof err === 'string') ? err : (err && err.toString ? err.toString() : '');
        if (errMsg.toLowerCase().includes('cancelled')) {
          // Bubble up to outer catch so it shows the proper "cancelled" message
          // and marks the step as incomplete.
          throw err;
        } else {
          showNotification(t('toasts.aiTranslateError', { error: errMsg }), "error");
        }
      }
    }
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    setWizardStepCompleted(3, false);
    if (errMsg.toLowerCase().includes('cancelled by the user') || errMsg.toLowerCase().includes('was cancelled by the user')) {
      showNotification(t('toasts.transcriptionCancelled'), "info");
      if (msgEl) msgEl.textContent = t('transcribe.cancelled');
    } else {
      showNotification(t('toasts.transcriptionError', { error: errMsg }), "error");
      if (msgEl) msgEl.textContent = t('transcribe.taskFailed');
    }
  } finally {
    // ALWAYS clear the temporary WAV state since it has been cleaned up by the backend
    wavPathForTranscription = null;
    btn.disabled = false;
    if (btnSpan) btnSpan.textContent = t('transcribe.startAiExtraction'); else btn.textContent = t('transcribe.startAiExtraction');
    if (fillBar) fillBar.classList.remove('indeterminate');
    // Guarantee the HUD pulse dot can never get stuck (success, error, or cancel).
    if (pulseDot) pulseDot.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) cancelBtnSpan.textContent = t('common.cancel'); else cancelBtn.textContent = t('common.cancel');
      cancelBtn.style.display = 'none';
    }
  }
};

window.abortTranscription = async function() {
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelling'); else cancelBtn.textContent = t('transcribe.cancelling');
  }
  
  try {
    await invoke('cancel_transcription');
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    if (!errMsg.includes("No active transcription or translation session")) {
      showNotification(t('toasts.cancelProcessError', { error: errMsg }), "error");
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) cancelBtnSpan.textContent = t('common.cancel'); else cancelBtn.textContent = t('common.cancel');
    }
  }
};

window.copyMainTranscriptToClipboard = async function() {
  const copyBtn = document.getElementById('btn-copy-main-transcript');

  const triggerFeedback = () => {
    if (copyBtn) {
      if (!copyBtn._origHtml) {
        copyBtn._origHtml = copyBtn.innerHTML;
      }
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-inline-end:5px; color:#4ade80;"><polyline points="20 6 9 17 4 12"/></svg>
        ${t('transcribe.copied')}
      `;
      clearTimeout(copyBtn._copyFeedbackTimer);
      copyBtn._copyFeedbackTimer = setTimeout(() => {
        if (copyBtn && copyBtn._origHtml) {
          copyBtn.innerHTML = copyBtn._origHtml;
          copyBtn._origHtml = null;
        }
      }, 2000);
    }
  };

  if (!selectedMediaFile) {
    showNotification(t('toasts.noMediaOrTranscribe'), "info");
    return;
  }
  
  const base = selectedMediaFile.substring(0, selectedMediaFile.lastIndexOf('.')) || selectedMediaFile;
  const txtFile = `${base}.txt`;
  
  try {
    const content = await invoke('read_text_file_content', { filePath: txtFile });
    await copyToClipboard(content);
    triggerFeedback();
    showNotification(t('toasts.fileCopied'), "success");
  } catch (e) {
    // Fallback: copy Whisper logs
    const fallback = allLogsArray
      .filter(l => l.category === 'Whisper')
      .map(l => l.message)
      .join('\n');
    if (fallback) {
      try {
        await copyToClipboard(fallback);
        triggerFeedback();
        showNotification(t('toasts.transcriptNotFoundFallback'), "info");
      } catch (e2) {
        const msg = (e2 && (e2.message || e2.toString())) || String(e2);
        showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
      }
    } else {
      const msg = (e && (e.message || e.toString())) || String(e);
      showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
    }
  }
};

window.openOutputFolder = async function() {
  const dir = window.lastTranscribedOutputDir || (settingsState && settingsState.inputFile ? getParentDir(settingsState.inputFile) : (selectedMediaFile ? getParentDir(selectedMediaFile) : null));
  if (dir) {
    try {
      await window.openFileInEditor(dir);
    } catch (e) {
      const msg = (e && (e.message || e.toString())) || String(e);
      showNotification(t('toasts.openFolderError', { error: msg }), "error");
    }
  } else {
    showNotification(t('toasts.noOutputDirFound'), "info");
  }
};

// Dispatcher alias for backward compatibility
window.copyTranscriptToClipboard = async function() {
  await window.copyMainTranscriptToClipboard();
};

// ----------------- Central Logging Center -----------------
window.filterLogs = function(category) {
  activeLogCategory = category;
  
  // Toggle filter tabs
  const filters = document.querySelectorAll('.filter-btn');
  filters.forEach(btn => {
    btn.classList.remove('active');
    if (btn.id === `log-filter-${category}`) {
      btn.classList.add('active');
    }
  });
  
  redrawLogsViewport();
};

window.handleLogSearch = function() {
  if (window.handleLogSearch._timer) clearTimeout(window.handleLogSearch._timer);
  window.handleLogSearch._timer = setTimeout(() => {
    window.handleLogSearch._timer = null;
    const searchInput = document.getElementById('log-search');
    logSearchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    redrawLogsViewport();
  }, 120);
};

function redrawLogsViewport() {
  lastAppendedCategory = null;
  const viewport = document.getElementById('log-viewport');
  if (!viewport) return;
  viewport.innerHTML = '';
  
  // Render the last 1500 logs to ensure responsive DOM performance
  const logsToRender = allLogsArray.slice(-1500);
  logsToRender.forEach(payload => {
    appendLogToViewport(payload);
  });
}

window.copyAllLogs = async function() {
  const rawLogs = allLogsArray.map(l => `[${l.timestamp}] [${l.category}] ${l.message}`).join('\n');
  try {
    await copyToClipboard(rawLogs);
    showNotification(t('toasts.logsCopied'), "success");
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || String(e);
    showNotification(t('toasts.logsCopyError', { error: msg }), "error");
  }
};

window.clearLogsHistory = async function() {
  const confirmed = await showConfirmModal(
    t('modals.confirmClearLogsTitle'),
    t('modals.confirmClearLogsDesc'),
    t('modals.confirmClearLogsBtn')
  );
  if (!confirmed) return;
  allLogsArray = [];
  lastAppendedCategory = null;
  await invoke('clear_logs');
  redrawLogsViewport();
};

// ----------------- Batch Processing Queue Helpers & Engine -----------------
function formatDuration(dur) {
  if (dur === undefined || dur === null || isNaN(dur)) return 'Pending...';
  const hours = Math.floor(dur / 3600);
  const minutes = Math.floor((dur % 3600) / 60);
  const seconds = Math.floor(dur % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateBatchSpecs() {
  document.getElementById('batch-files-count').textContent = batchItems.length;
  let totalDur = 0;
  let hasPending = false;
  batchItems.forEach(item => {
    if (item.durationSec !== undefined && item.durationSec !== null && !isNaN(item.durationSec)) {
      totalDur += item.durationSec;
    } else {
      hasPending = true;
    }
  });
  
  const totalDurationEl = document.getElementById('batch-total-duration');
  if (totalDurationEl) {
    if (hasPending && totalDur === 0) {
      totalDurationEl.textContent = t('transcribe.calculating');
    } else {
      totalDurationEl.textContent = formatDuration(totalDur) + (hasPending ? t('transcribe.calculatingSuffix') : '');
    }
  }
}

window.removeFileFromBatch = function(index) {
  batchItems.splice(index, 1);
  selectedMediaFiles.splice(index, 1);
  
  if (batchItems.length === 0) {
    clearBatchQueue();
  } else {
    renderBatchQueueTable();
    updateBatchSpecs();
  }
};

window.clearBatchQueue = function() {
  batchItems = [];
  selectedMediaFiles = [];
  isBatchMode = false;
  selectedMediaFile = null;
  
  // Revert UI to initial empty single-file state
  document.getElementById('lbl-file-name').style.display = 'block';
  document.getElementById('lbl-file-path').style.display = 'block';
  updateMediaCardName(null);
  document.getElementById('lbl-file-path').textContent = t('transcribe.selectFilePrompt');
  document.getElementById('batch-queue-container').style.display = 'none';
  
  document.getElementById('media-meta-box').style.display = 'grid';
  document.getElementById('batch-specs-box').style.display = 'none';
  document.getElementById('btn-next-step-2').textContent = t('transcribe.continueToTranscription');
  
  
  document.getElementById('batch-controls-box').style.display = 'none';
  document.getElementById('wizard-step-3').style.display = 'block';
  
  // Set steps 1, 2, 3 as incomplete
  setWizardStepCompleted(1, false);
  setWizardStepCompleted(2, false);
  setWizardStepCompleted(3, false);
  
  // Clear any meta values
  document.getElementById('meta-type').textContent = '-';
  document.getElementById('meta-size').textContent = '-';
  document.getElementById('meta-duration').textContent = '-';
  document.getElementById('meta-recommendation').textContent = '-';
  
  if (settingsState) {
    settingsState.inputFile = "";
    saveCurrentSettings();
  }
  
  showNotification(t('toasts.queueCleared'), "info");
};

window.moveBatchItemUp = function(index) {
  if (index <= 0 || index >= batchItems.length) return;
  // Swap in batchItems
  const tempItem = batchItems[index];
  batchItems[index] = batchItems[index - 1];
  batchItems[index - 1] = tempItem;

  // Swap in selectedMediaFiles
  const tempFile = selectedMediaFiles[index];
  selectedMediaFiles[index] = selectedMediaFiles[index - 1];
  selectedMediaFiles[index - 1] = tempFile;

  renderBatchQueueTable();
};

window.moveBatchItemDown = function(index) {
  if (index < 0 || index >= batchItems.length - 1) return;
  // Swap in batchItems
  const tempItem = batchItems[index];
  batchItems[index] = batchItems[index + 1];
  batchItems[index + 1] = tempItem;

  // Swap in selectedMediaFiles
  const tempFile = selectedMediaFiles[index];
  selectedMediaFiles[index] = selectedMediaFiles[index + 1];
  selectedMediaFiles[index + 1] = tempFile;

  renderBatchQueueTable();
};

window.sortBatchQueue = function(criteria) {
  if (batchItems.length <= 1) return;
  
  const zipped = batchItems.map((item, index) => ({
    item,
    filePath: selectedMediaFiles[index]
  }));

  if (criteria === 'name-asc') {
    zipped.sort((a, b) => a.item.name.localeCompare(b.item.name));
  } else if (criteria === 'name-desc') {
    zipped.sort((a, b) => b.item.name.localeCompare(a.item.name));
  } else if (criteria === 'duration-asc') {
    zipped.sort((a, b) => {
      const da = a.item.durationSec || 0;
      const db = b.item.durationSec || 0;
      return da - db;
    });
  } else if (criteria === 'duration-desc') {
    zipped.sort((a, b) => {
      const da = a.item.durationSec || 0;
      const db = b.item.durationSec || 0;
      return db - da;
    });
  }

  batchItems = zipped.map(z => z.item);
  selectedMediaFiles = zipped.map(z => z.filePath);

  // Reset dropdown value
  const sortSelect = document.getElementById('batch-sort-select');
  if (sortSelect) sortSelect.value = '';

  renderBatchQueueTable();
  showNotification(t('toasts.queueSorted'), "success");
};

function renderBatchQueueTable() {
  const tbody = document.getElementById('batch-queue-body');
  if (!tbody) return;
  
  const countChip = document.getElementById('lbl-batch-count');
  if (countChip) countChip.textContent = batchItems.length;

  tbody.innerHTML = '';
  batchItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = 'batch-row';
    
    // Name column
    const nameTd = document.createElement('td');
    nameTd.textContent = item.name;
    // A queued file's name is the user's own text, so it reads in its own direction
    // whatever the interface is doing around it — the same treatment the single-file
    // card above gives the same name.
    applyContentDirection(nameTd, item.name);
    nameTd.title = isolateLtr(item.path);
    tr.appendChild(nameTd);
    
    // Duration column
    const durationTd = document.createElement('td');
    durationTd.textContent = formatDuration(item.durationSec);
    tr.appendChild(durationTd);
    
    // Status column
    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    
    if (item.status === 'pending') {
      badge.className = 'batch-status-badge badge-pending';
      badge.textContent = t('transcribe.statusPending');
    } else if (item.status === 'converting') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusConverting');
    } else if (item.status === 'transcribing') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusExtracting');
    } else if (item.status === 'translating') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = t('transcribe.statusTranslating');
    } else if (item.status === 'completed') {
      badge.className = 'batch-status-badge badge-completed';
      badge.textContent = t('transcribe.statusCompleted');
    } else if (item.status === 'failed') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = t('transcribe.statusFailed');
    } else if (item.status === 'aborted') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = t('transcribe.statusAborted');
    }
    
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);
    
    // Action column
    const actionTd = document.createElement('td');
    actionTd.className = 'batch-action-cell';
    
    const actionGroup = document.createElement('div');
    actionGroup.className = 'batch-action-group';
    
    const startBtn = document.getElementById('btn-run-batch');
    const isRunning = startBtn && startBtn.disabled;
    
    // Up button
    const upBtn = document.createElement('button');
    upBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="m18 15-6-6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    upBtn.style.background = 'transparent';
    upBtn.style.border = 'none';
    upBtn.style.color = 'var(--color-cyan)';
    upBtn.style.padding = '4px';
    upBtn.style.display = 'inline-flex';
    upBtn.style.alignItems = 'center';
    upBtn.style.justifyContent = 'center';
    upBtn.title = 'Move up';
    
    if (isRunning || index === 0) {
      upBtn.disabled = true;
      upBtn.style.opacity = '0.3';
      upBtn.style.cursor = 'not-allowed';
    } else {
      upBtn.style.cursor = 'pointer';
      upBtn.onclick = (e) => {
        e.stopPropagation();
        moveBatchItemUp(index);
      };
    }
    
    // Down button
    const downBtn = document.createElement('button');
    downBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    downBtn.style.background = 'transparent';
    downBtn.style.border = 'none';
    downBtn.style.color = 'var(--color-cyan)';
    downBtn.style.padding = '4px';
    downBtn.style.display = 'inline-flex';
    downBtn.style.alignItems = 'center';
    downBtn.style.justifyContent = 'center';
    downBtn.title = 'Move down';
    
    if (isRunning || index === batchItems.length - 1) {
      downBtn.disabled = true;
      downBtn.style.opacity = '0.3';
      downBtn.style.cursor = 'not-allowed';
    } else {
      downBtn.style.cursor = 'pointer';
      downBtn.onclick = (e) => {
        e.stopPropagation();
        moveBatchItemDown(index);
      };
    }
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    deleteBtn.style.background = 'transparent';
    deleteBtn.style.border = 'none';
    deleteBtn.style.color = 'var(--color-red)';
    deleteBtn.style.padding = '4px';
    deleteBtn.style.display = 'inline-flex';
    deleteBtn.style.alignItems = 'center';
    deleteBtn.style.justifyContent = 'center';
    deleteBtn.title = 'Remove from queue';
    
    if (isRunning) {
      deleteBtn.disabled = true;
      deleteBtn.style.opacity = '0.3';
      deleteBtn.style.cursor = 'not-allowed';
    } else {
      deleteBtn.style.cursor = 'pointer';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        removeFileFromBatch(index);
      };
    }
    
    actionGroup.appendChild(upBtn);
    actionGroup.appendChild(downBtn);
    actionGroup.appendChild(deleteBtn);
    actionTd.appendChild(actionGroup);
    tr.appendChild(actionTd);
    
    tbody.appendChild(tr);
  });
}

window.runBatchExtraction = async function() {
  if (!isBatchMode || batchItems.length === 0) return;
  
  const startBtn = document.getElementById('btn-run-batch');
  const startBtnSpan = startBtn?.querySelector('span');
  const cancelBtn = document.getElementById('btn-cancel-batch');
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  const sortSelect = document.getElementById('batch-sort-select');
  const clearBtn = document.getElementById('btn-clear-batch');
  
  startBtn.disabled = true;
  if (startBtnSpan) startBtnSpan.textContent = t('transcribe.batchRunning'); else startBtn.textContent = t('transcribe.batchRunning');
  if (sortSelect) sortSelect.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
  
  if (cancelBtn) {
    cancelBtn.style.display = 'inline-flex';
    cancelBtn.disabled = false;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelBatch'); else cancelBtn.textContent = t('transcribe.cancelBatch');
  }
  
  batchCancelActive = false;
  document.getElementById('analytics-box').style.display = 'none';
  
  // Set up global progress tracking
  const fillBar = document.getElementById('progress-linear-fill');
  const pctEl = document.getElementById('lbl-radial-pct');
  const msgEl = document.getElementById('lbl-radial-msg');
  
  let successCount = 0;
  let totalCount = batchItems.length;
  
  for (let i = 0; i < totalCount; i++) {
    if (batchCancelActive) {
      batchItems[i].status = 'aborted';
      continue;
    }
    
    const item = batchItems[i];
    item.status = 'converting';
    renderBatchQueueTable();
    
    // Update global progress bar
    const globalPct = ((i / totalCount) * 100).toFixed(0);
    if (fillBar) fillBar.style.width = `${globalPct}%`;
    if (pctEl) pctEl.textContent = `${globalPct}%`;
    if (msgEl) msgEl.textContent = t('transcribe.batchConvertingProgress', { current: i + 1, total: totalCount, name: item.name });
    
    let currentWavPath = null;

        // Override settingsState inputFile to point to this item's path so outputs are generated next to the original file
        const originalInputFile = settingsState.inputFile;
        settingsState.inputFile = item.path;

        try {
          // 1. Run FFmpeg conversion
          currentWavPath = await invoke('convert_media_file', { filePath: item.path });

          if (batchCancelActive) {
            item.status = 'aborted';
            renderBatchQueueTable();
            continue;
          }

          // 2. Run Whisper Transcription
          item.status = 'transcribing';
          renderBatchQueueTable();

          if (msgEl) msgEl.textContent = t('transcribe.batchExtractingProgress', { current: i + 1, total: totalCount, name: item.name });

          // Clear transcript preview for this file
      transcriptLines = [];
      const viewport = document.getElementById('transcript-viewport');
      if (viewport) {
        viewport.innerHTML = `<div style="color: var(--color-cyan); text-align: center; margin-top: 40px; font-weight: 500;">${t('transcribe.aiModelInitializing')}</div>`;
      }
      
      const result = await invoke('start_transcription_task', {
        settings: settingsState,
        wavPath: currentWavPath,
        durationSec: item.durationSec || 60.0
      });

      // Load final transcript from the text file
      if (result.generatedFiles && result.generatedFiles.length > 0) {
        const outputDir = result.outputDir || getParentDir(item.path);
        const txtFile = result.generatedFiles.find(f => f.endsWith('.txt'));
        if (txtFile) {
          const sep = outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
          await loadTranscriptFromFile(`${outputDir}${sep}${txtFile}`);
        }
      }
      
      // Run AI Translation if enabled
      let translationSuccess = false;
      item.outputs = result.generatedFiles;
      
      while (!translationSuccess && settingsState.translateAiEnabled && result.generatedFiles && result.generatedFiles.length > 0) {
        if (batchCancelActive) break;
        
        try {
          item.status = 'translating';
          renderBatchQueueTable();
          // Message only — the percentage bar is driven by per-chunk
          // 'translation-status' events from the backend, so it keeps
          // moving instead of freezing at the batch-item fraction.
          if (msgEl) msgEl.textContent = t('transcribe.batchTranslatingProgress', { current: i + 1, total: totalCount, name: item.name });
          
          const outputDir = result.outputDir || getParentDir(item.path);
          const translatedFiles = await invoke('translate_transcription_files', {
            settings: settingsState,
            generatedFiles: result.generatedFiles,
            parentDir: outputDir
          });
          
          item.outputs = [...result.generatedFiles, ...translatedFiles];
          translationSuccess = true;
        } catch (transErr) {
          console.error("Batch translation error:", transErr);
          const errMsg = (typeof transErr === 'string') ? transErr : (transErr && transErr.toString ? transErr.toString() : '');
          if (errMsg.toLowerCase().includes('cancelled')) {
            batchCancelActive = true;
            item.status = 'aborted';
            renderBatchQueueTable();
            break;
          }
          const choice = await showBatchErrorDialog(item.name, transErr);
          if (choice === 'retry') {
            // continues the while loop to retry
          } else if (choice === 'skip') {
            translationSuccess = true; // exit loop, proceed with transcription outputs only
          } else { // abort
            batchCancelActive = true;
            item.status = 'aborted';
            renderBatchQueueTable();
            break;
          }
        }
      }
      
      if (batchCancelActive) {
        continue;
      }
      
      item.status = 'completed';
      item.timeSec = result.durationMs / 1000;
      item.speedFactor = result.speedFactor;
      successCount++;
      
      renderBatchQueueTable();
    } catch (err) {
      item.status = 'failed';
      renderBatchQueueTable();
      showNotification(t('toasts.batchItemError', { name: item.name, error: String(err) }), "error");
    } finally {
      settingsState.inputFile = originalInputFile;
    }
  }
  
  // Batch processing completed
  if (fillBar) fillBar.style.width = '100%';
  if (pctEl) pctEl.textContent = '100%';
  
  if (batchCancelActive) {
    if (msgEl) msgEl.textContent = t('transcribe.batchExtractionCancelled');
    showNotification(t('toasts.batchCancelled'), "info");
  } else {
    if (msgEl) msgEl.textContent = t('transcribe.batchCompletedSummary', { success: successCount, total: totalCount });
    showNotification(t('toasts.batchComplete', { success: successCount, total: totalCount }), "success");
  }
  
  // Reset buttons
  startBtn.disabled = false;
  if (startBtnSpan) startBtnSpan.textContent = t('transcribe.startBatchAiExtraction'); else startBtn.textContent = t('transcribe.startBatchAiExtraction');
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (sortSelect) sortSelect.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
  
  renderBatchQueueTable();
  
  setWizardStepCompleted(3, true);
};

window.abortBatchExtraction = async function() {
  const cancelBtn = document.getElementById('btn-cancel-batch');
  const cancelBtnSpan = cancelBtn?.querySelector('span');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.aborting'); else cancelBtn.textContent = t('transcribe.aborting');
  }
  
  batchCancelActive = true;
  
  try {
    // Terminate active whisper process immediately
    await invoke('cancel_transcription');
    showNotification(t('toasts.cancellingTask'), "info");
  } catch (err) {
    console.error("Failed to cancel active whisper process:", err);
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      const cancelSpan = cancelBtn.querySelector('span');
      if (cancelSpan) {
        cancelSpan.textContent = t('common.cancel');
      } else {
        cancelBtn.innerHTML = `<span data-i18n="common.cancel">${t('common.cancel')}</span>`;
      }
      cancelBtn.style.display = 'none';
    }
  }
};

// ----------------- Transcribe Interactive Drag & Drop -----------------
function setupTranscribeDragAndDrop() {
  const transZone = document.getElementById('transcribe-drop-zone');
  if (!transZone) return;

  // HTML5 Standard drag-drop events
  transZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.add('drag-over');
  });
  
  transZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.remove('drag-over');
  });
  
  transZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    transZone.classList.remove('drag-over');
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).map(f => f.path || f.name);
      await handleDroppedFiles(files);
    }
  });

  // Native Tauri drag-drop events
  if (window.__TAURI__) {
    try {
      let _lastDragOverTime = 0;
      listen('tauri://drag-over', (event) => {
        const now = performance.now();
        if (now - _lastDragOverTime < 35) return;
        _lastDragOverTime = now;

        const ratio = window.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;
        
        const rect = transZone.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          transZone.classList.add('drag-over');
        } else {
          transZone.classList.remove('drag-over');
        }
      });

      listen('tauri://drag-leave', () => {
        transZone.classList.remove('drag-over');
      });

      listen('tauri://drag-drop', async (event) => {
        const ratio = window.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;
        
        transZone.classList.remove('drag-over');
        
        const rect = transZone.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const files = event.payload.paths;
          if (files && files.length > 0) {
            await handleDroppedFiles(files);
          }
        }
      });
    } catch (err) {
      console.error("Failed to setup native Tauri drag-drop listeners:", err);
    }
  }
}

async function handleDroppedFiles(files) {
  const startBtn = document.getElementById('btn-run-batch');
  if (startBtn && startBtn.disabled) {
    showNotification(t('toasts.batchActiveDropBlocked'), "info");
    return;
  }
  selectedMediaFiles = files;
  
  if (files.length === 1) {
    isBatchMode = false;
    selectedMediaFile = files[0];
    
    document.getElementById('lbl-file-name').style.display = 'block';
    document.getElementById('lbl-file-path').style.display = 'block';
    updateMediaCardName(selectedMediaFile);
    document.getElementById('lbl-file-path').textContent = selectedMediaFile;
    document.getElementById('batch-queue-container').style.display = 'none';
    
    document.getElementById('media-meta-box').style.display = 'grid';
    document.getElementById('batch-specs-box').style.display = 'none';
    document.getElementById('btn-next-step-2').textContent = t('transcribe.continueToTranscription');
    
    document.getElementById('batch-controls-box').style.display = 'none';
    document.getElementById('wizard-step-3').style.display = 'block';
    
    if (settingsState) {
      settingsState.inputFile = selectedMediaFile;
      saveCurrentSettings();
    }
    
    setWizardStepCompleted(1, true);
    await probeSelectedFile();
  } else {
    isBatchMode = true;
    selectedMediaFile = null;
    
    document.getElementById('lbl-file-name').style.display = 'none';
    document.getElementById('lbl-file-path').style.display = 'none';
    document.getElementById('batch-queue-container').style.display = 'block';
    
    batchItems = files.map(filePath => ({
      path: filePath,
      name: getBasename(filePath),
      size: t('transcribe.statusPending') + '...',
      durationSec: null,
      status: 'pending',
      timeSec: 0,
      speedFactor: 0.0,
      outputs: []
    }));
    
    renderBatchQueueTable();
    updateBatchSpecs();
    
    document.getElementById('media-meta-box').style.display = 'none';
    document.getElementById('batch-specs-box').style.display = 'block';
    document.getElementById('batch-files-count').textContent = files.length;
    document.getElementById('btn-next-step-2').textContent = t('transcribe.continueToBatchSetup');
    
    document.getElementById('batch-controls-box').style.display = 'block';
    document.getElementById('btn-run-transcribe').style.display = 'none';
    document.getElementById('btn-cancel-transcribe').style.display = 'none';
    
    setWizardStepCompleted(1, true);
    setWizardStepCompleted(2, true);
    
    (async () => {
      for (let idx = 0; idx < files.length; idx++) {
        try {
          const meta = await invoke('probe_media_file', { filePath: files[idx] });
          if (meta && meta.exists) {
            batchItems[idx].size = meta.size;
            batchItems[idx].durationSec = meta.durationSec;
          }
        } catch (err) {
          console.error("Failed to probe file in batch:", err);
        }
      }
      renderBatchQueueTable();
      updateBatchSpecs();
    })();
    
    setTimeout(() => {
      openWizardStep(2);
    }, 500);
  }
  
  switchView('transcribe');
  showNotification(t('toasts.filesLoaded', { count: files.length }), "success");
}


// ----------------- Models Logic -----------------
let currentCategoryFilter = 'guide';

function formatRemainingTime(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return t('models.timeUnknown');
  if (seconds < 60) return t('models.timeSec', { s: seconds });
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return t('models.timeMinSec', { m, s });
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return t('models.timeHourMinSec', { h, m, s });
}

function renderModelGuide(grid) {
  grid.innerHTML = `
    <div class="model-guide-container">
      <!-- 1. Hero Overview Card -->
      <div class="guide-hero-card">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="width: 36px; height: 36px; border-radius: 9px; background: rgba(var(--color-royal-blue-rgb), 0.2); display: flex; align-items: center; justify-content: center; color: var(--color-royal-blue); flex-shrink: 0;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
          </div>
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin: 0;">${t('models.guideHeroTitle')}</h3>
            <p style="font-size: 0.84rem; color: var(--color-text-muted); margin: 3px 0 0 0;">${t('models.guideHeroSubtitle')}</p>
          </div>
        </div>
      </div>

      <!-- 2. Model Families Comparison Grid -->
      <div class="guide-grid">
        <div class="guide-card guide-card-large">
          <div class="guide-card-header">
            <div class="guide-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z"/></svg>
            </div>
            <div>
              <div class="guide-card-title">${t('models.guideLargeTitle')}</div>
              <div class="guide-card-subtitle" style="font-size: 0.74rem; font-weight: 500;">${t('models.guideLargeSubtitle')}</div>
            </div>
          </div>
          <div class="guide-card-body">
            ${t('models.guideLargeBody')}
          </div>
          <div style="margin-top: 10px; font-size: 0.76rem; color: var(--color-text-dim);">
            ${t('models.guideLargeSpecs')}
          </div>
        </div>

        <div class="guide-card guide-card-medium">
          <div class="guide-card-header">
            <div class="guide-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            </div>
            <div>
              <div class="guide-card-title">${t('models.guideMediumTitle')}</div>
              <div class="guide-card-subtitle" style="font-size: 0.74rem; font-weight: 500;">${t('models.guideMediumSubtitle')}</div>
            </div>
          </div>
          <div class="guide-card-body">
            ${t('models.guideMediumBody')}
          </div>
          <div style="margin-top: 10px; font-size: 0.76rem; color: var(--color-text-dim);">
            ${t('models.guideMediumSpecs')}
          </div>
        </div>

        <div class="guide-card guide-card-small">
          <div class="guide-card-header">
            <div class="guide-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </div>
            <div>
              <div class="guide-card-title">${t('models.guideSmallTitle')}</div>
              <div class="guide-card-subtitle" style="font-size: 0.74rem; font-weight: 500;">${t('models.guideSmallSubtitle')}</div>
            </div>
          </div>
          <div class="guide-card-body">
            ${t('models.guideSmallBody')}
          </div>
          <div style="margin-top: 10px; font-size: 0.76rem; color: var(--color-text-dim);">
            ${t('models.guideSmallSpecs')}
          </div>
        </div>

        <div class="guide-card guide-card-base">
          <div class="guide-card-header">
            <div class="guide-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            </div>
            <div>
              <div class="guide-card-title">${t('models.guideBaseTinyTitle')}</div>
              <div class="guide-card-subtitle" style="font-size: 0.74rem; font-weight: 500;">${t('models.guideBaseTinySubtitle')}</div>
            </div>
          </div>
          <div class="guide-card-body">
            ${t('models.guideBaseTinyBody')}
          </div>
          <div style="margin-top: 10px; font-size: 0.76rem; color: var(--color-text-dim);">
            ${t('models.guideBaseTinySpecs')}
          </div>
        </div>
      </div>

      <!-- 3. Key Concepts to Know -->
      <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 2px;">
        <div class="guide-concept-card guide-concept-lang">
          <div class="guide-concept-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
          </div>
          <div>
            <div style="font-weight: 600; color: #fff; font-size: 0.88rem; margin-bottom: 2px;">${t('models.guideConceptEnTitle')}</div>
            <div style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
              ${t('models.guideConceptEnBody')}
            </div>
          </div>
        </div>

        <div class="guide-concept-card guide-concept-quant">
          <div class="guide-concept-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 14 10 14 10 20"></polyline>
              <polyline points="20 10 14 10 14 4"></polyline>
              <line x1="14" y1="10" x2="21" y2="3"></line>
              <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
          </div>
          <div>
            <div style="font-weight: 600; color: #fff; font-size: 0.88rem; margin-bottom: 2px;">${t('models.guideConceptQuantTitle')}</div>
            <div style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
              ${t('models.guideConceptQuantBody')}
            </div>
          </div>
        </div>

        <div class="guide-concept-card guide-concept-vad">
          <div class="guide-concept-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </div>
          <div>
            <div style="font-weight: 600; color: #fff; font-size: 0.88rem; margin-bottom: 2px;">${t('models.guideConceptVadTitle')}</div>
            <div style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.45;">
              ${t('models.guideConceptVadBody')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.switchModelCategory = function(category, clearSearch = true) {
  currentCategoryFilter = category;
  
  if (clearSearch) {
    const searchInput = document.getElementById('model-search');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('model-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = document.getElementById(`model-cat-${category}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }

  const gridScroll = document.getElementById('models-list-scroll');
  if (gridScroll) {
    gridScroll.scrollTop = 0;
  }
  
  loadModelStatusesGrid();
};

window.clearModelSearch = function() {
  const searchInput = document.getElementById('model-search');
  const clearBtn = document.getElementById('model-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  loadModelStatusesGrid();
};

let _cachedModelStatuses = null;
let _cachedModelStatusesTime = 0;
const MODEL_STATUS_CACHE_TTL = 3500;

window.loadModelStatusesGrid = async function(isSilent = false, forceRefresh = false) {
  if (!settingsState) {
    try {
      settingsState = await invoke('load_settings');
    } catch (e) {
      console.error("Failed to load settings in loadModelStatusesGrid:", e);
      return;
    }
  }
  
  // 1. Fetch system specifications if not already loaded
  if (!systemSpecs) {
    try {
      systemSpecs = await invoke('get_system_specs');
    } catch (e) {
      console.error("Failed to load system specs:", e);
      systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
    }
  }

  // Update specs subtitle UI helper
  const specsSubtitle = document.getElementById('model-specs-subtitle');
  if (specsSubtitle && systemSpecs) {
    const gpuLabelMap = {
      'nvidia': t('models.gpuNvidia'),
      'amd': t('models.gpuAmd'),
      'intel': t('models.gpuIntel'),
      'unknown': t('models.gpuCpuOnly')
    };
    const gpuName = gpuLabelMap[systemSpecs.gpu_type] || systemSpecs.gpu_type || t('models.gpuUnknown');
    specsSubtitle.innerHTML = t('models.systemSpecsDetected', {
      ram: systemSpecs.total_ram_gb.toFixed(1),
      cores: systemSpecs.cpu_cores,
      gpu: gpuName
    });
  }
  
  try {
    const now = Date.now();
    let statuses = _cachedModelStatuses;
    if (forceRefresh || !statuses || (now - _cachedModelStatusesTime > MODEL_STATUS_CACHE_TTL)) {
      statuses = await invoke('get_all_models_status', { modelsDir: settingsState.modelsDir });
      _cachedModelStatuses = statuses;
      _cachedModelStatusesTime = now;
    }

    const grid = document.getElementById('models-list-scroll');
    if (!grid) return;
    
    const searchInput = document.getElementById('model-search');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    
    // Model Guide Overview Display
    if (currentCategoryFilter === 'guide' && !query) {
      renderModelGuide(grid);
      return;
    }

    grid.innerHTML = '';
    if (!grid._modelDelegate) {
      grid.addEventListener('click', function(e) {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const card = btn.closest('[data-model]');
        if (!card) return;
        const name = card.dataset.model;
        switch (btn.dataset.action) {
          case 'delete': deleteModelClick(name); break;
          case 'pause':  pauseModelClick(name); break;
          case 'download': downloadModelClick(name); break;
        }
      });
      grid._modelDelegate = true;
    }
    
    let renderedCount = 0;

    statuses.forEach(m => {
      if (query) {
        const fullName = `ggml-${m.name}.bin`;
        const searchTarget = `${m.name} ${fullName}`.toLowerCase();
        if (!searchTarget.includes(query)) {
          return;
        }
      }

      // Category Filter Logic:
      // - "local" tab is a dedicated quick-filter showing ONLY downloaded models on disk
      // - All family category tabs (tiny, base, small, medium, large, vad, all) show all models (downloadable & downloaded)
      if (currentCategoryFilter === 'local') {
        if (m.status !== 'Downloaded') return;
      } else if (!query) {
        if (currentCategoryFilter === 'tiny') {
          if (!m.name.startsWith("tiny")) return;
        } else if (currentCategoryFilter === 'base') {
          if (!m.name.startsWith("base")) return;
        } else if (currentCategoryFilter === 'small') {
          if (!m.name.startsWith("small")) return;
        } else if (currentCategoryFilter === 'medium') {
          if (!m.name.startsWith("medium")) return;
        } else if (currentCategoryFilter === 'large') {
          if (!m.name.startsWith("large")) return;
        } else if (currentCategoryFilter === 'vad') {
          if (!m.name.startsWith("silero-")) return;
        }
      }
      
      const card = document.createElement('div');
      card.className = 'setting-card';
      card.dataset.name = m.name;
      card.setAttribute('data-model', m.name);
      
      const sizeMB = (m.sizeBytes / 1024 / 1024).toFixed(0);
      const dlMB = (m.downloadedBytes / 1024 / 1024).toFixed(0);
      const pct = Math.round((m.progress || 0) * 100);
      const safeName = escapeHTML(m.name);
      const meta = getModelMetaInfo(m.name);

      let actionButtons = '';
      if (m.status === 'Downloaded') {
        actionButtons = `
          <button class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDeleteModel', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDelete')}</span></button>
        `;
      } else if (m.status === 'Downloading') {
        actionButtons = `
          <button class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: safeName })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>
        `;
      } else if (m.status === 'Paused') {
        actionButtons = `
          <button class="model-action-btn model-btn-resume" data-action="download" aria-label="${t('models.ariaResumeDownload', { name: safeName })}">${MODEL_ICON_RESUME}<span>${t('models.actionResume')}</span></button>
          <button class="model-action-btn model-btn-delete" data-action="delete" aria-label="${t('models.ariaDiscardDownload', { name: safeName })}">${MODEL_ICON_DELETE}<span>${t('models.actionDiscard')}</span></button>
        `;
      } else {
        actionButtons = `
          <button class="model-action-btn model-btn-download" data-action="download" aria-label="${t('models.ariaDownloadModel', { name: safeName })}">${MODEL_ICON_DOWNLOAD}<span>${t('models.actionDownload')}</span></button>
        `;
      }
      
      const showProgressBlock = m.status === 'Downloading' || m.status === 'Paused' ? 'block' : 'none';
      
      let badgeHtml = '';
      if (m.name.startsWith('silero-')) {
        badgeHtml = `<span class="model-badge model-badge-vad" title="${t('models.badgeVadTitle')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg><span>${t('models.badgeVad')}</span></span>`;
      }

      let statusBadge = '';
      if (m.status === 'Downloaded') {
        statusBadge = `<span class="model-badge badge-installed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>${t('models.installedBadge')}</span></span>`;
      } else if (m.status === 'Downloading') {
        statusBadge = `<span class="model-badge badge-downloading">${t('models.badgeDownloading')}</span>`;
      } else if (m.status === 'Paused') {
        statusBadge = `<span class="model-badge badge-paused">${t('models.badgePaused')}</span>`;
      }

      card.innerHTML = `
        <div class="setting-info" style="flex-grow: 1; padding-inline-end: 20px;">
          <div class="setting-label-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="setting-title" style="font-size: 1.05rem; font-weight: 600; color: #fff;">ggml-${safeName}.bin</span>
            ${badgeHtml}
          </div>
          <div class="setting-desc" style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${statusBadge}
            ${statusBadge ? '<span style="color: rgba(255,255,255,0.1);">|</span>' : ''}
            <span>${t('models.expectedSize', { size: sizeMB })}</span>
            ${meta.precisionText ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span>${meta.precisionText}</span>
            ` : ''}
            <span style="color: rgba(255,255,255,0.1);">|</span>
            <span>${meta.langText}</span>
            ${m.status === 'Downloading' ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span style="color: var(--color-cyan);">${t('models.statusInProgress', { size: dlMB, pct })}</span>
            ` : ''}
            ${m.status === 'Paused' ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span style="color: var(--color-gold);">${t('models.statusPaused', { size: dlMB, pct })}</span>
            ` : ''}
          </div>
          <div class="progress-bar-container" style="display: ${showProgressBlock}; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.05); overflow: hidden; margin-top: 10px; border: 1px solid rgba(255,255,255,0.02); max-width: 500px;">
            <div class="progress-bar-fill" style="width: ${pct}%; height: 100%; background: ${m.status === 'Downloading' ? 'var(--color-cyan)' : 'var(--color-gold)'}; box-shadow: ${m.status === 'Downloading' ? 'var(--shadow-neon-cyan)' : 'var(--shadow-neon-gold)'}; transition: width 0.3s ease;"></div>
          </div>
        </div>
        <div class="setting-control" style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-shrink: 0; min-width: 160px;">
          ${actionButtons}
        </div>
      `;
      grid.appendChild(card);
      renderedCount++;
    });

    if (renderedCount === 0) {
      grid.innerHTML = `
        <div class="models-empty-state" style="padding: 48px 20px;">
          <div class="models-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </div>
          <div class="models-empty-title">${t('models.emptyTitle')}</div>
          <div class="models-empty-desc">${query ? t('models.emptyDescQuery', { query: escapeHTML(query) }) : t('models.emptyDescCategory')}</div>
          ${query ? `<button type="button" class="btn-secondary btn-sm" onclick="clearModelSearch()" style="margin-top: 8px;">${t('models.emptyClearSearch')}</button>` : ''}
        </div>
      `;
    }
    
  } catch (err) {
    console.error("Failed to load model statuses:", err);
  }
};

window.filterModelsGrid = function() {
  const searchInput = document.getElementById('model-search');
  const clearBtn = document.getElementById('model-search-clear');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

  // Debounce: the search box calls this per keystroke, and a full grid rebuild
  // + IPC round-trip on every key makes typing janky.
  if (filterModelsGrid._timer) clearTimeout(filterModelsGrid._timer);
  filterModelsGrid._timer = setTimeout(() => {
    filterModelsGrid._timer = null;
    // If typing a search while currently on Guide tab, automatically switch to 'all' category
    if (query && currentCategoryFilter === 'guide') {
      currentCategoryFilter = 'all';
      const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
      buttons.forEach(btn => btn.classList.remove('active'));
      const allBtn = document.getElementById('model-cat-all');
      if (allBtn) allBtn.classList.add('active');
    }
    loadModelStatusesGrid();
  }, 250);
};

window.downloadModelClick = async function(name) {
  if (!settingsState || _modelActionsInProgress.has(name)) return;
  _modelActionsInProgress.add(name);
  try {
    showNotification(t('toasts.modelDownloadStarted', { name: `ggml-${name}.bin` }), "info");
    
    // Invalidate model status cache so any tab switch/search filter re-fetches latest downloading status
    _cachedModelStatuses = null;

    // Immediate in-place button swap to Pause
    const card = document.querySelector(`[data-model="${name}"]`);
    if (card) {
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl) {
        ctrlEl.innerHTML = `<button class="model-action-btn model-btn-pause" data-action="pause" aria-label="Pause downloading ggml-${escapeHTML(name)}.bin">${MODEL_ICON_PAUSE}<span>Pause</span></button>`;
      }
    }

    await invoke('start_download_model_task', {
      modelsDir: settingsState.modelsDir,
      modelName: name
    });
  } catch (err) {
    showNotification(t('toasts.modelDownloadStartError', { error: String(err) }), "error");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

window.pauseModelClick = async function(name) {
  if (_modelActionsInProgress.has(name)) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('pause_download_model', { modelName: name });
    showNotification(t('toasts.modelDownloadPaused', { name: `ggml-${name}.bin` }), "info");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
  } catch (err) {
    showNotification(t('toasts.modelDownloadPauseError', { error: String(err) }), "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

window.deleteModelClick = async function(name) {
  if (_modelActionsInProgress.has(name)) return;
  const confirmed = await showConfirmModal(
    t('modals.confirmDeleteModelTitle'),
    t('modals.confirmDeleteModelDesc', { name }),
    t('modals.deleteBtn')
  );
  if (!confirmed) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('delete_model_file', {
      modelsDir: settingsState.modelsDir,
      modelName: name
    });
    showNotification(t('toasts.modelDeleted', { name: `ggml-${name}.bin` }), "success");
    _cachedModelStatuses = null;
    await loadModelStatusesGrid(false, true);
    // Scan configuration dropdown to sync options
    await scanAndPopulateModels();
  } catch (err) {
    showNotification(t('toasts.modelDeleteError', { error: String(err) }), "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

// ----------------- Live Transcript Viewer Helper Functions -----------------
let transcriptLines = [];

/**
 * Keeps a transcript line's direction in step with what is being typed into it. The
 * lines are created in bulk (a long transcription can hold hundreds of them, and the
 * viewport caps the DOM at 2000), so one delegated listener covers them all instead
 * of a listener per input — each line opens on the side its content reads from, and
 * a line emptied while editing falls back to the interface direction.
 */
function setupTranscriptDirection() {
  const viewport = document.getElementById('transcript-viewport');
  if (!viewport || viewport._hasDirectionListener) return;
  viewport._hasDirectionListener = true;
  viewport.addEventListener('input', (e) => {
    const field = e.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      applyTextDirection(field);
    }
  });

  // A language switch changes the interface direction, which is what the lines with no
  // strong character of their own fall back to. The hardsub cue fields re-resolve for
  // the same reason when the cue list is re-rendered.
  window.addEventListener('whisper:languageChanged', () => {
    viewport.querySelectorAll('.transcript-text-input').forEach((input) => applyTextDirection(input));
  });
}

function appendTranscriptLine(timeRange, text) {
  const placeholder = document.getElementById('transcript-placeholder');
  if (placeholder) placeholder.remove();
  
  const viewport = document.getElementById('transcript-viewport');
  
  // Clean text
  const cleanText = text.trim();
  
  const lineObj = { timeRange, text: cleanText, id: transcriptLines.length };
  transcriptLines.push(lineObj);
  
  const lineEl = document.createElement('div');
  lineEl.className = 'transcript-line';
  lineEl.dataset.id = lineObj.id;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'transcript-time';
  timeSpan.textContent = timeRange;

  const textDiv = document.createElement('div');
  textDiv.className = 'transcript-text';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'transcript-text-input';
  input.value = cleanText;
  applyTextDirection(input);
  input.onchange = function() { updateTranscriptLineText(lineObj.id, this.value); };
  textDiv.appendChild(input);

  lineEl.appendChild(timeSpan);
  lineEl.appendChild(textDiv);
  viewport.appendChild(lineEl);

  // Cap DOM children in viewport (mirrors the log-viewport cap) so a very long
  // transcription can't grow thousands of live <input> nodes. The full data
  // stays in `transcriptLines` for copy/export.
  while (viewport.children.length > 2000) {
    viewport.removeChild(viewport.firstElementChild);
  }

  clearTimeout(viewport._scrollDebounce);
  viewport._scrollDebounce = setTimeout(() => {
    viewport.scrollTop = viewport.scrollHeight;
  }, 80);
}

window.updateTranscriptLineText = function(id, value) {
  const line = transcriptLines.find(l => l.id === id);
  if (line) {
    line.text = value;
  }
};

window.filterTranscriptLines = function() {
  const query = document.getElementById('transcript-search').value.toLowerCase();
  const lines = document.querySelectorAll('.transcript-line');
  lines.forEach(lineEl => {
    const textInput = lineEl.querySelector('.transcript-text-input');
    if (textInput) {
      const match = textInput.value.toLowerCase().includes(query);
      lineEl.style.display = match ? 'flex' : 'none';
    }
  });
};

window.loadTranscriptFromFile = async function(fullPath) {
  try {
    const text = await invoke('read_text_file_content', { filePath: fullPath });
    
    // Clear transcript lines
    transcriptLines = [];
    const viewport = document.getElementById('transcript-viewport');
    viewport.innerHTML = '';
    
    // Split text by newlines and add to viewer
    const lines = text.split('\n');
    lines.forEach((lineText, idx) => {
      if (!lineText.trim()) return;
      
      const lineObj = { timeRange: `Line ${idx + 1}`, text: lineText.trim(), id: idx };
      transcriptLines.push(lineObj);
      
      const lineEl = document.createElement('div');
      lineEl.className = 'transcript-line';
      lineEl.dataset.id = lineObj.id;
      lineEl.innerHTML = `
        <span class="transcript-time" style="color: var(--color-text-muted); font-family: inherit; font-size: 0.75rem;">[L${idx + 1}]</span>
        <div class="transcript-text">
          <input type="text" class="transcript-text-input" value="${escapeHTML(lineText.trim())}" onchange="updateTranscriptLineText(${lineObj.id}, this.value)" />
        </div>
      `;
      applyTextDirection(lineEl.querySelector('.transcript-text-input'));
      viewport.appendChild(lineEl);
    });
    
    if (transcriptLines.length === 0) {
      viewport.innerHTML = `<div style="color: var(--color-text-dim); text-align: center; margin-top: 40px;">Transcript is empty.</div>`;
    }
  } catch (err) {
    console.error("Failed to load transcript file:", err);
  }
};

window.copyLiveTranscriptToClipboard = async function() {
  const btn = document.getElementById('btn-copy-transcript');
  const triggerBtnFeedback = () => {
    if (btn) {
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
  };

  if (transcriptLines && transcriptLines.length > 0) {
    const textToCopy = transcriptLines
      .map(l => l.text)
      .join('\n');
      
    try {
      await copyToClipboard(textToCopy);
      triggerBtnFeedback();
      showNotification(t('toasts.liveTranscriptCopied'), "success");
      return;
    } catch (err) {
      const msg = (err && (err.message || err.toString())) || String(err);
      showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
      return;
    }
  }

  // Fallback: check transcript viewport text if transcriptLines array is unpopulated
  const viewport = document.getElementById('transcript-viewport');
  if (viewport && viewport.innerText && !viewport.innerText.includes("Start transcription to stream")) {
    const rawPreview = viewport.innerText.trim();
    if (rawPreview.length > 0) {
      try {
        await copyToClipboard(rawPreview);
        triggerBtnFeedback();
        showNotification(t('toasts.previewCopied'), "success");
        return;
      } catch (err) {
        const msg = (err && (err.message || err.toString())) || String(err);
        showNotification(t('toasts.copyTranscriptError', { error: msg }), "error");
        return;
      }
    }
  }

  // If live viewer is empty, attempt to copy the main output file
  if (selectedMediaFile) {
    await window.copyMainTranscriptToClipboard();
  } else {
    showNotification(t('toasts.noTranscriptToCopy'), "info");
  }
};

window.copyEditorTranscriptToClipboard = window.copyLiveTranscriptToClipboard;

// ----------------- AI Translation Configuration & Providers Handling -----------------
window.populateProvidersDropdown = function() {
  const select = document.getElementById('opt-translateAiProvider');
  if (!select) return;
  select.innerHTML = '';
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  providers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  
  if (providers.length > 0 && !settingsState.translateAiProvider) {
    settingsState.translateAiProvider = providers[0].name;
  }
  
  select.value = settingsState.translateAiProvider || '';
  
  // Render the tiles grid
  renderProvidersGrid(providers);

  if (window.translationStudioController) {
    window.translationStudioController.refreshProviderOptions();
  }
};

window.renderProvidersGrid = function(providers = null) {
  const grid = document.getElementById('providers-tiles-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  if (providers === null) {
    try {
      providers = JSON.parse(settingsState.translateAiProviders || '[]');
    } catch (e) {
      console.error(e);
      providers = [];
    }
  }
  
  const activeName = settingsState.translateAiProvider || '';
  
  providers.forEach(p => {
    const tile = document.createElement('div');
    const isActive = p.name === activeName;
    tile.className = `provider-tile${isActive ? ' active' : ''}`;
    
    const formatStr = p.apiFormat || p.api_format || 'Chat completions';
    let iconSvg = '';
    let brandClass = '';
    
    if (formatStr === 'Chat completions') {
      brandClass = 'format-openai';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #10b981;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    } else if (formatStr === 'Anthropic messages') {
      brandClass = 'format-anthropic';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #8b5cf6;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
    } else if (formatStr === 'Responses') {
      brandClass = 'format-gemini';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #06b6d4;"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>`;
    } else {
      brandClass = 'format-custom';
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: #f59e0b;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path></svg>`;
    }
    
    tile.innerHTML = `
      <div class="provider-tile-header">
        <div class="provider-tile-icon-wrapper ${brandClass}">
          ${iconSvg}
        </div>
        <div class="provider-tile-meta">
          <div class="provider-tile-name" title="${escapeHTML(p.name)}">${escapeHTML(p.name)}</div>
          <div class="provider-tile-format" title="${escapeHTML(formatStr)}">${escapeHTML(formatStr)}</div>
        </div>
      </div>
      <div class="provider-tile-footer">
        <span class="provider-tile-badge ${isActive ? 'active' : ''}">
          ${isActive ? '<span class="pulse-dot"></span>ACTIVE' : 'INACTIVE'}
        </span>
        <button class="provider-tile-delete" title="Delete Provider">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    `;
    
    tile.onclick = (e) => {
      if (e.target.closest('.provider-tile-delete')) return;
      
      const select = document.getElementById('opt-translateAiProvider');
      if (select) {
        select.value = p.name;
        onProviderChanged(true); // Keep current tab (which is 'providers')
      }
    };
    
    const delBtn = tile.querySelector('.provider-tile-delete');
    delBtn.onclick = (e) => {
      e.stopPropagation();
      deleteProviderByName(p.name);
    };
    
    grid.appendChild(tile);
  });
  
  // Add "+ Add Provider" tile
  const addTile = document.createElement('div');
  addTile.className = 'provider-tile-add';
  addTile.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span style="font-size: 0.88rem; font-weight: 500;">Add Provider</span>
  `;
  addTile.onclick = () => openAddProviderModal();
  grid.appendChild(addTile);
};

window.onProviderChanged = function(keepCurrentTab = false, skipTableRender = false) {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  const modelSelect = document.getElementById('opt-translateAiModel');
  const mgrCard = document.getElementById('provider-manager-card');
  if (!providerSelect || !modelSelect || !mgrCard) return;
  
  if (modelSaveDebounceTimer) {
    clearTimeout(modelSaveDebounceTimer);
    modelSaveDebounceTimer = null;
    saveActiveProviderModels(true, true, settingsState.translateAiProvider);
  }

  const providerName = providerSelect.value;
  settingsState.translateAiProvider = providerName;
  
  // Re-render the grid to highlight the active tile
  renderProvidersGrid();
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const provider = providers.find(p => p.name === providerName);
  
  const genPlaceholder = document.getElementById('general-placeholder-overlay');
  const genFields = document.getElementById('general-config-fields');
  const modelsPlaceholder = document.getElementById('models-placeholder-overlay');
  const modelsFields = document.getElementById('models-catalog-fields');
  
  if (provider) {
    if (genPlaceholder) genPlaceholder.style.display = 'none';
    if (genFields) genFields.style.display = 'block';
    
    if (modelsPlaceholder) modelsPlaceholder.style.display = 'none';
    if (modelsFields) modelsFields.style.display = 'block';
    
    if (typeof keepCurrentTab === 'string') {
      switchProviderTab(keepCurrentTab);
    } else if (!keepCurrentTab) {
      const activeBtn = document.querySelector('.provider-tab-btn.active');
      if (activeBtn && activeBtn.id === 'tab-btn-providers') {
        switchProviderTab('providers');
      } else if (activeBtn && activeBtn.id === 'tab-btn-general') {
        switchProviderTab('general');
      } else if (activeBtn && activeBtn.id === 'tab-btn-models') {
        switchProviderTab('models');
      } else {
        switchProviderTab('auto');
      }
    }
    
    // Load General configuration fields
    document.getElementById('mgr-provider-url').value = provider.baseUrl || provider.base_url || '';
    document.getElementById('mgr-provider-format').value = provider.apiFormat || provider.api_format || 'Chat completions';
    const providerPromptEl = document.getElementById('mgr-provider-prompt');
    providerPromptEl.value = provider.customPrompt || provider.custom_prompt || '';
    applyDynamicDirection(providerPromptEl);
    
    // Set API Key field. If stored in Keyring, we show a generic placeholder value and mark it for lazy retrieval.
    const keyVal = provider.apiKey || provider.api_key || '';
    const keyInput = document.getElementById('mgr-provider-key');
    keyInput.type = 'password';
    
    // Reset any custom active color on eye button
    const eyeBtn = keyInput.nextElementSibling;
    if (eyeBtn) eyeBtn.style.color = 'var(--color-text-muted)';
    
    if (keyVal === '__KEYRING__') {
      keyInput.value = '••••••••••••••••'; // Temporary placeholder length
      keyInput.dataset.isKeyring = 'true';
      
      // Load real password length asynchronously in background to avoid freezing UI
      (async () => {
        try {
          const realKey = await invoke('get_keyring_credential', { providerName });
          const currentSelect = document.getElementById('opt-translateAiProvider');
          if (currentSelect && currentSelect.value === providerName) {
            keyInput.value = realKey;
            keyInput.dataset.isKeyring = 'false';
          }
        } catch (e) {
          console.error("Background keyring credential fetch failed:", e);
          const currentSelect = document.getElementById('opt-translateAiProvider');
          if (currentSelect && currentSelect.value === providerName) {
            keyInput.value = '';
            keyInput.placeholder = 'sk-...';
            keyInput.dataset.isKeyring = 'false';
          }
        }
      })();
    } else {
      keyInput.value = keyVal;
      keyInput.dataset.isKeyring = 'false';
    }
    
    // Load models dropdown (ONLY enabled ones)
    modelSelect.innerHTML = '';
    const enabledModels = (provider.models || []).filter(m => m.enabled !== false);
    
    enabledModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.id} (${(m.contextWindow || m.context_window || 200000).toLocaleString()} tokens)`;
      modelSelect.appendChild(opt);
    });
    
    // Auto-select first model if not set or not in enabled list
    const hasModel = enabledModels.some(m => m.id === settingsState.translateAiModel);
    if (!hasModel && enabledModels.length > 0) {
      settingsState.translateAiModel = enabledModels[0].id;
    } else if (enabledModels.length === 0) {
      settingsState.translateAiModel = '';
    }
    modelSelect.value = settingsState.translateAiModel || '';
    
    // Update active model top status banner
    updateActiveModelBannerUI(settingsState.translateAiModel);
    
    // Render models registry
    if (!skipTableRender) {
      renderModelsRegistryTable(provider);
    }
  } else {
    if (genPlaceholder) genPlaceholder.style.display = 'flex';
    if (genFields) genFields.style.display = 'none';
    
    if (modelsPlaceholder) modelsPlaceholder.style.display = 'flex';
    if (modelsFields) modelsFields.style.display = 'none';
    
    if (typeof keepCurrentTab === 'string') {
      switchProviderTab(keepCurrentTab);
    } else if (!keepCurrentTab) {
      const activeBtn = document.querySelector('.provider-tab-btn.active');
      if (activeBtn && activeBtn.id === 'tab-btn-providers') {
        switchProviderTab('providers');
      } else if (activeBtn && activeBtn.id === 'tab-btn-general') {
        switchProviderTab('general');
      } else if (activeBtn && activeBtn.id === 'tab-btn-models') {
        switchProviderTab('models');
      } else {
        switchProviderTab('auto');
      }
    }
    
    modelSelect.innerHTML = '';
    settingsState.translateAiModel = '';
    modelSelect.value = '';
    
    const bannerEl = document.getElementById('active-model-banner');
    if (bannerEl) {
      bannerEl.style.display = 'none';
    }
    
    document.getElementById('mgr-provider-url').value = '';
    document.getElementById('mgr-provider-format').value = 'Chat completions';
    document.getElementById('mgr-provider-prompt').value = '';
    document.getElementById('mgr-provider-key').value = '';
    document.getElementById('provider-models-count').textContent = '0';
    
    const tbody = document.getElementById('mgr-models-tbody');
    if (tbody) tbody.innerHTML = '';
  }

  if (window.translationStudioController) {
    window.translationStudioController.refreshModelOptions();
  }
  
  saveCurrentSettings();
  updateTranscribeUIConfigs();
};

window.togglePasswordVisibility = async function(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const svg = btn.querySelector('svg');
  const providerSelect = document.getElementById('opt-translateAiProvider');
  
  if (input.type === 'password') {
    // If key is saved in keyring, load it lazily only on-demand when user wants to view it
    if (input.dataset.isKeyring === 'true' && providerSelect && providerSelect.value) {
      btn.disabled = true;
      try {
        const realKey = await invoke('get_keyring_credential', { providerName: providerSelect.value });
        input.value = realKey;
        input.dataset.isKeyring = 'false'; // Loaded
      } catch (e) {
        showNotification(t('toasts.keyringLoadError', { error: String(e) }), "error");
      } finally {
        btn.disabled = false;
      }
    }
    
    input.type = 'text';
    btn.style.color = 'var(--color-cyan)';
    svg.innerHTML = `
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    `;
  } else {
    input.type = 'password';
    btn.style.color = 'var(--color-text-muted)';
    svg.innerHTML = `
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    `;
  }
};

window.switchProviderTab = function(tab) {
  if (window.customSelectsMap) {
    window.customSelectsMap.forEach(cs => {
      if (cs && cs.isOpen && typeof cs.close === 'function') cs.close();
    });
  }

  const btnAuto = document.getElementById('tab-btn-auto');
  const btnProv = document.getElementById('tab-btn-providers');
  const btnGen = document.getElementById('tab-btn-general');
  const btnMod = document.getElementById('tab-btn-models');
  
  const divAuto = document.getElementById('provider-tab-auto');
  const divProv = document.getElementById('provider-tab-providers');
  const divGen = document.getElementById('provider-tab-general');
  const divMod = document.getElementById('provider-tab-models');
  
  if (btnAuto) btnAuto.classList.remove('active');
  if (btnProv) btnProv.classList.remove('active');
  if (btnGen) btnGen.classList.remove('active');
  if (btnMod) btnMod.classList.remove('active');
  
  if (divAuto) divAuto.style.display = 'none';
  if (divProv) divProv.style.display = 'none';
  if (divGen) divGen.style.display = 'none';
  if (divMod) divMod.style.display = 'none';
  
  let activeDiv = null;
  if (tab === 'auto') {
    if (btnAuto) btnAuto.classList.add('active');
    if (divAuto) { divAuto.style.display = 'flex'; activeDiv = divAuto; }
  } else if (tab === 'providers') {
    if (btnProv) btnProv.classList.add('active');
    if (divProv) { divProv.style.display = 'block'; activeDiv = divProv; }
  } else if (tab === 'general') {
    if (btnGen) btnGen.classList.add('active');
    if (divGen) { divGen.style.display = 'block'; activeDiv = divGen; }
  } else {
    if (btnMod) btnMod.classList.add('active');
    if (divMod) { divMod.style.display = 'block'; activeDiv = divMod; }
    
    if (typeof applyModelsFilterAndRender === 'function') {
      if (currentProviderModels.length === 0 && settingsState.translateAiProvider) {
        try {
          const providers = JSON.parse(settingsState.translateAiProviders || '[]');
          const curProv = providers.find(p => p.name === settingsState.translateAiProvider);
          if (curProv && curProv.models && curProv.models.length > 0) {
            renderModelsRegistryTable(curProv);
          } else {
            applyModelsFilterAndRender(0);
          }
        } catch (e) {
          applyModelsFilterAndRender(0);
        }
      } else {
        applyModelsFilterAndRender(0);
      }
    }
  }
  
  // Force restart CSS scale-fade-blur transition animation on the active tab content
  if (activeDiv) {
    activeDiv.style.animation = 'none';
    void activeDiv.offsetWidth; // force synchronous layout reflow
    activeDiv.style.animation = '';
  }
};

window.saveActiveProviderGeneral = async function(silent = false) {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) return;
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const baseUrl = document.getElementById('mgr-provider-url').value.trim();
  const apiFormat = document.getElementById('mgr-provider-format').value;
  const key = document.getElementById('mgr-provider-key').value.trim();
  const customPrompt = document.getElementById('mgr-provider-prompt').value.trim();
  
  if (!baseUrl) {
    if (!silent) showNotification(t('toasts.baseUrlRequired'), "info");
    return;
  }
  
  let keyToSave = provider.apiKey || provider.api_key || '';
  let useKeyring = provider.useKeyring !== false;
  
  // If the user cleared the key, delete from keyring
  if (key === '') {
    try {
      await invoke('delete_keyring_credential', { providerName });
    } catch (e) {}
    keyToSave = '';
    useKeyring = false;
  } else if (key !== '••••••••••••••••') {
    // If the user modified the key
    try {
      await invoke('store_keyring_credential', { providerName, key });
      keyToSave = '__KEYRING__';
      useKeyring = true;
    } catch (e) {
      console.warn("Failed to store API Key in system keyring, saving in file:", e);
      keyToSave = key;
      useKeyring = false;
    }
  }
  
  provider.baseUrl = baseUrl;
  provider.apiFormat = apiFormat;
  provider.apiKey = keyToSave;
  provider.useKeyring = useKeyring;
  provider.customPrompt = customPrompt;
  
  // Clean old keys if they exist
  delete provider.base_url;
  delete provider.api_format;
  delete provider.api_key;
  delete provider.use_keyring;
  delete provider.custom_prompt;
  
  providers[providerIdx] = provider;
  settingsState.translateAiProviders = JSON.stringify(providers);
  
  await saveCurrentSettings();
  
  const select = document.getElementById('opt-translateAiProvider');
  if (select) select.value = providerName;
  
  if (!silent) {
    showNotification(t('toasts.providerSettingsSaved'), "success");
  }
};

window.deleteProviderByName = async function(providerName) {
  if (!providerName) return;
  
  const confirmed = await showConfirmModal(
    t('modals.confirmDeleteProviderTitle'),
    t('modals.confirmDeleteProviderDesc', { name: providerName }),
    t('modals.deleteBtn')
  );
  if (!confirmed) return;
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  if (provider.useKeyring || provider.use_keyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__') {
    try {
      await invoke('delete_keyring_credential', { providerName });
    } catch(e) {}
  }
  
  providers.splice(providerIdx, 1);
  settingsState.translateAiProviders = JSON.stringify(providers);
  
  if (settingsState.translateAiProvider === providerName) {
    settingsState.translateAiProvider = providers.length > 0 ? providers[0].name : '';
  }
  
  await saveCurrentSettings();
  populateProvidersDropdown();
  onProviderChanged(true);
  
  showNotification(t('toasts.providerDeleted'), "info");
};

window.deleteActiveProvider = async function() {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) return;
  
  await deleteProviderByName(providerName);
};

window.toEnglishDigits = function(str) {
  const persianMap = { '۰':'0', '۱':'1', '۲':'2', '۳':'3', '۴':'4', '۵':'5', '۶':'6', '۷':'7', '۸':'8', '۹':'9' };
  const arabicMap = { '٠':'0', '١':'1', '٢':'2', '٣':'3', '٤':'4', '٥':'5', '٦':'6', '٧':'7', '٨':'8', '٩':'9' };
  if (typeof str !== 'string') return str;
  return str.replace(/[۰-۹]/g, d => persianMap[d] || d).replace(/[٠-٩]/g, d => arabicMap[d] || d);
};

window.formatTokensShort = function(num) {
  const n = parseInt(num, 10);
  if (isNaN(n) || n <= 0) return '0';
  
  // Exact standard model context presets
  if (n === 2097152 || n === 2000000) return '2M';
  if (n === 1048576 || n === 1000000) return '1M';
  if (n === 524288 || n === 512000) return '512K';
  if (n === 262144 || n === 256000) return '256K';
  if (n === 131072 || n === 128000) return '128K';
  if (n === 65536 || n === 64000) return '64K';
  if (n === 32768 || n === 32000) return '32K';
  if (n === 16384 || n === 16000) return '16K';
  if (n === 8192 || n === 8000) return '8K';
  if (n === 4096 || n === 4000) return '4K';
  
  if (n >= 1000000) {
    if (n % 1000000 === 0) {
      return (n / 1000000) + 'M';
    }
    if (n % 1048576 === 0) {
      return (n / 1048576) + 'M';
    }
    const val = n / 1000000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  
  if (n >= 1000) {
    if (n % 1000 === 0) {
      return (n / 1000) + 'K';
    }
    if (n % 1024 === 0) {
      return (n / 1024) + 'K';
    }
    const val = n / 1000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return n.toLocaleString();
};

window.parseTokensInput = function(val) {
  if (typeof val === 'number') {
    return !isNaN(val) && val > 0 ? Math.round(val) : 200000;
  }
  if (!val) return 200000;
  const str = toEnglishDigits(String(val).trim().toUpperCase());
  
  // Check for M/Million suffix (e.g., "1M", "1.5M", "2 million", "1m tokens")
  const matchM = str.match(/^(\d+(?:\.\d+)?)\s*(?:M|MILLION)(?:\s*TOKENS?)?$/);
  if (matchM) {
    const num = parseFloat(matchM[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000000) : 200000;
  }

  // Check for K/Thousand suffix (e.g., "128K", "200k tokens", "64 k")
  const matchK = str.match(/^(\d+(?:\.\d+)?)\s*(?:K|THOUSAND)(?:\s*TOKENS?)?$/);
  if (matchK) {
    const num = parseFloat(matchK[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000) : 200000;
  }

  // Check for pure integer / comma-separated digits (e.g., "128,000", "200000", "200000 tokens")
  const matchNum = str.match(/^([\d,]+)(?:\s*TOKENS?)?$/);
  if (matchNum) {
    const cleaned = matchNum[1].replace(/,/g, '');
    const num = parseInt(cleaned, 10);
    return !isNaN(num) && num > 0 ? num : 200000;
  }

  // Non-numeric strings or arbitrary text fallback safely to 200,000
  return 200000;
};

let currentProviderModels = [];
let currentModelsSortCol = null;
let currentModelsSortDir = 'none';
let currentModelsPage = 1;
const DEFAULT_MODELS_PAGE_SIZE = 20;
let currentModelsPageSize = (function() {
  const saved = localStorage.getItem('whisper_models_page_size');
  if (saved === 'all') return 'all';
  const parsed = parseInt(saved, 10);
  return (parsed === 20 || parsed === 50 || parsed === 100) ? parsed : DEFAULT_MODELS_PAGE_SIZE;
})();

window.changeModelsPageSize = function(newSize) {
  if (newSize === 'all') {
    currentModelsPageSize = 'all';
    localStorage.setItem('whisper_models_page_size', 'all');
  } else {
    const parsed = parseInt(newSize, 10);
    currentModelsPageSize = isNaN(parsed) || parsed <= 0 ? DEFAULT_MODELS_PAGE_SIZE : parsed;
    localStorage.setItem('whisper_models_page_size', String(currentModelsPageSize));
  }
  currentModelsPage = 1;
  window.applyModelsFilterAndRender(0);
};

window.isReasoningSupportedModel = function(modelObj) {
  if (!modelObj) return false;
  if (typeof modelObj === 'object') {
    if (typeof modelObj.supportsReasoning === 'boolean') {
      return modelObj.supportsReasoning;
    }
    if (typeof modelObj.supports_reasoning === 'boolean') {
      return modelObj.supports_reasoning;
    }
    // Backward-compatibility fallback for legacy saved models without metadata:
    const reasoning = (modelObj.reasoning || '').trim().toLowerCase();
    if (reasoning && reasoning !== 'none') return true;
    return false;
  }
  if (typeof modelObj === 'string') {
    let found = currentProviderModels.find(m => m && m.id === modelObj);
    if (!found) {
      try {
        const providers = JSON.parse(settingsState.translateAiProviders || '[]');
        for (const p of providers) {
          if (Array.isArray(p.models)) {
            const m = p.models.find(mod => mod && mod.id === modelObj);
            if (m) {
              found = m;
              break;
            }
          }
        }
      } catch (e) {}
    }
    if (found) {
      return window.isReasoningSupportedModel(found);
    }
  }
  return false;
};

let currentModelStatusFilter = 'all';
let filterTimeout = null;
let modelSaveDebounceTimer = null;

function destroyModelRowCustomSelects(parentEl) {
  if (!parentEl) return;
  const selects = parentEl.querySelectorAll('select.model-reasoning-select');
  selects.forEach(sel => {
    let inst = null;
    if (window.customSelectsMap) {
      inst = (sel.id ? window.customSelectsMap.get(sel.id) : null) || window.customSelectsMap.get(sel);
      if (sel.id) window.customSelectsMap.delete(sel.id);
      window.customSelectsMap.delete(sel);
    }
    if (inst && typeof inst.destroy === 'function') {
      try {
        inst.destroy();
      } catch (err) {
        console.warn("Error destroying custom select:", err);
      }
    }
    delete sel.dataset.customSelectInitialized;
  });
}

window.formatNumberForLang = function(num) {
  if (num === null || num === undefined) return '';
  const str = String(num);
  if (typeof getLanguage === 'function') {
    const lang = getLanguage();
    if (lang === 'fa') {
      const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
      return str.replace(/[0-9]/g, d => persianDigits[d]);
    }
    if (lang === 'ar') {
      const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
      return str.replace(/[0-9]/g, d => arabicDigits[d]);
    }
  }
  return str;
};

const POPULAR_PROVIDER_FILTERS = [
  { id: 'openai', label: 'OpenAI', test: id => id.includes('openai') || id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') },
  { id: 'anthropic', label: 'Anthropic', test: id => id.includes('anthropic') || id.startsWith('claude') },
  { id: 'google', label: 'Google', test: id => id.includes('google') || id.startsWith('gemini') },
  { id: 'meta', label: 'Meta', test: id => id.includes('meta') || id.includes('llama') },
  { id: 'deepseek', label: 'DeepSeek', test: id => id.includes('deepseek') },
  { id: 'mistral', label: 'Mistral', test: id => id.includes('mistral') },
  { id: 'amazon', label: 'Amazon', test: id => id.includes('amazon') || id.startsWith('nova') },
  { id: 'qwen', label: 'Qwen', test: id => id.includes('qwen') }
];

window.updateFilterCounts = function() {
  const totalCount = currentProviderModels.length;
  const freeCount = currentProviderModels.filter(m => (m.id || '').toLowerCase().includes('free')).length;
  const reasoningCount = currentProviderModels.filter(m => {
    if (!window.isReasoningSupportedModel(m)) return false;
    const r = (m && m.reasoning ? String(m.reasoning).trim().toLowerCase() : '');
    return Boolean(r && r !== 'none');
  }).length;

  const countBadge = document.getElementById('provider-models-count');
  if (countBadge) countBadge.textContent = window.formatNumberForLang(totalCount);

  const pillsContainer = document.getElementById('models-filter-pills') || document.querySelector('.models-filter-pills');
  if (!pillsContainer) return;

  const filterDefs = [
    {
      id: 'all',
      label: t('settings.allModels') || 'All Models',
      count: totalCount,
      dotClass: ''
    }
  ];

  if (freeCount > 0 || currentModelStatusFilter === 'free') {
    filterDefs.push({
      id: 'free',
      label: t('settings.freeTier') || 'Free Tier',
      count: freeCount,
      dotClass: 'filter-dot-free'
    });
  }

  // Consecutive: All Models -> Free Tier -> Reasoning as requested by user
  if (reasoningCount > 0 || currentModelStatusFilter === 'reasoning') {
    filterDefs.push({
      id: 'reasoning',
      label: t('settings.reasoning') || 'Reasoning',
      count: reasoningCount,
      dotClass: 'filter-dot-reasoning'
    });
  }

  POPULAR_PROVIDER_FILTERS.forEach(p => {
    const pCount = currentProviderModels.filter(m => p.test((m.id || '').toLowerCase())).length;
    if (pCount > 0 || currentModelStatusFilter === p.id) {
      filterDefs.push({
        id: p.id,
        label: p.label,
        count: pCount,
        dotClass: ''
      });
    }
  });

  if (!filterDefs.some(f => f.id === currentModelStatusFilter)) {
    currentModelStatusFilter = 'all';
  }

  pillsContainer.innerHTML = filterDefs.map(f => `
    <button type="button" class="btn-filter ${currentModelStatusFilter === f.id ? 'active' : ''}" data-filter="${f.id}" onclick="filterModelsStatus('${f.id}')" id="filter-models-${f.id}">
      ${f.dotClass ? `<span class="${f.dotClass}"></span>` : ''}
      <span>${escapeHTML(f.label)}</span>
      <span class="filter-badge" id="filter-count-${f.id}">${window.formatNumberForLang(f.count)}</span>
    </button>
  `).join('');
};

window.updateFilterCountsFromDOM = window.updateFilterCounts;

window.clearModelsSearch = function() {
  const searchInput = document.getElementById('mgr-models-search');
  const clearBtn = document.getElementById('mgr-models-search-clear');
  if (searchInput) searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  currentModelsPage = 1;
  window.filterModelsStatus('all', 0);
  if (searchInput) searchInput.focus();
};

window.renderModelsRegistryTable = function(provider) {
  currentProviderModels = (provider && provider.models ? provider.models : []).map(m => {
    const isReasoning = window.isReasoningSupportedModel(m);
    let reasoningVal = isReasoning
      ? ((m.reasoning !== undefined && m.reasoning !== null && m.reasoning !== '') ? m.reasoning : 'Medium')
      : 'None';
    return {
      id: m.id || '',
      contextWindow: window.parseTokensInput(m.contextWindow || m.context_window || 200000),
      reasoning: reasoningVal,
      supportsReasoning: typeof m.supportsReasoning === 'boolean'
        ? m.supportsReasoning
        : (typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : (isReasoning ? true : undefined)),
      enabled: m.enabled !== false
    };
  });
  
  currentModelsPage = 1;
  currentModelsSortCol = null;
  currentModelsSortDir = 'none';
  window.updateFilterCounts();
  window.applyModelsFilterAndRender(0);
};

function updateSortHeaderIcons() {
  const cols = ['active', 'id', 'ctx', 'reasoning'];
  cols.forEach(col => {
    const th = document.querySelector(`.models-table-head .th-${col}`);
    const icon = document.getElementById(`sort-icon-${col}`);
    if (!th || !icon) return;
    
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (currentModelsSortCol === col) {
      if (currentModelsSortDir === 'asc') {
        th.classList.add('sorted-asc');
        th.setAttribute('aria-sort', 'ascending');
        icon.textContent = '▲';
      } else if (currentModelsSortDir === 'desc') {
        th.classList.add('sorted-desc');
        th.setAttribute('aria-sort', 'descending');
        icon.textContent = '▼';
      } else {
        th.setAttribute('aria-sort', 'none');
        icon.textContent = '↕';
      }
    } else {
      th.setAttribute('aria-sort', 'none');
      icon.textContent = '↕';
    }
  });
}

function saveActiveProviderModelsDebounced() {
  const currentProvider = settingsState.translateAiProvider;
  clearTimeout(modelSaveDebounceTimer);
  modelSaveDebounceTimer = setTimeout(() => {
    if (settingsState.translateAiProvider === currentProvider) {
      saveActiveProviderModels(true, true, currentProvider);
    }
  }, 200);
}

function updateActiveModelBannerUI(modelId) {
  const bannerEl = document.getElementById('active-model-banner');
  const bannerVal = document.getElementById('active-model-banner-value');
  const providerName = settingsState.translateAiProvider || '';
  if (bannerEl && bannerVal) {
    if (modelId && providerName) {
      bannerVal.innerHTML = `
        <div class="active-model-chip-group">
          <span class="active-model-chip-provider">${escapeHTML(providerName)}</span>
          <span class="active-model-chip-model">${escapeHTML(modelId)}</span>
        </div>
      `;
      bannerEl.style.display = 'flex';
    } else {
      bannerEl.style.display = 'none';
    }
  }
}
window.updateActiveModelBannerUI = updateActiveModelBannerUI;

window.setActiveModelFromTable = async function(modelId) {
  if (!modelId) return;
  const prevActiveModelId = settingsState.translateAiModel;
  if (prevActiveModelId === modelId) return;

  settingsState.translateAiModel = modelId;
  
  // Atomically synchronize in-memory models into provider settings and populate DOM select options
  await saveActiveProviderModels(true, true);
  
  updateActiveModelBannerUI(modelId);
  
  const selectDOM = document.getElementById('opt-translateAiModel');
  if (selectDOM) selectDOM.value = modelId;
  
  await saveCurrentSettings();
  updateTranscribeUIConfigs();
  if (window.translationStudioController) {
    window.translationStudioController.syncFromGlobalSettings();
  }
  
  // If sorted by active column, row ordering changes, so re-render table
  if (currentModelsSortCol === 'active') {
    window.applyModelsFilterAndRender(0);
    return;
  }

  // Otherwise, perform sleek zero-flicker in-place DOM update without resetting scroll
  const tbody = document.getElementById('mgr-models-tbody');
  if (!tbody) return;

  const rows = tbody.querySelectorAll('.model-data-row');
  rows.forEach(row => {
    const rowModelId = (row.dataset.modelId || '').toLowerCase();
    const isNowActive = rowModelId === modelId.toLowerCase();
    const wasActive = row.classList.contains('active-model-row');

    if (isNowActive && !wasActive) {
      row.classList.add('active-model-row');
      row.setAttribute('aria-selected', 'true');
      row.setAttribute('aria-checked', 'true');
      const activeCell = row.querySelector('.td-active');
      if (activeCell) {
        activeCell.innerHTML = `
          <div class="model-active-badge is-active" title="${t('settings.activeBadge')}">
            <span class="active-dot"></span>
            <span class="badge-text">${t('settings.activeBadge')}</span>
          </div>
        `;
      }
      const actionCell = row.querySelector('.td-action');
      if (actionCell) {
        actionCell.innerHTML = '';
      }
    } else if (!isNowActive && wasActive) {
      row.classList.remove('active-model-row');
      row.setAttribute('aria-selected', 'false');
      row.setAttribute('aria-checked', 'false');
      const activeCell = row.querySelector('.td-active');
      if (activeCell) {
        activeCell.innerHTML = `
          <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${t('settings.setActiveBadge')}" aria-label="${t('settings.setActiveBadge')}">
            <span class="radio-circle"></span>
          </button>
        `;
      }
      const actionCell = row.querySelector('.td-action');
      if (actionCell) {
        actionCell.innerHTML = `
          <button type="button" class="model-btn-trash" title="Remove Model Row" aria-label="Remove Model Row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        `;
      }
    }
  });
};

window.toggleSortModels = function(col) {
  if (currentModelsSortCol === col) {
    const initialDir = (col === 'id') ? 'asc' : 'desc';
    const secondDir = (initialDir === 'asc') ? 'desc' : 'asc';
    
    if (currentModelsSortDir === initialDir) {
      currentModelsSortDir = secondDir;
    } else if (currentModelsSortDir === secondDir) {
      currentModelsSortDir = 'none';
      currentModelsSortCol = null;
    } else {
      currentModelsSortDir = initialDir;
    }
  } else {
    currentModelsSortCol = col;
    currentModelsSortDir = (col === 'id') ? 'asc' : 'desc';
  }
  currentModelsPage = 1;
  window.applyModelsFilterAndRender(0);
};

window.changeModelsPage = function(delta) {
  currentModelsPage += delta;
  window.applyModelsFilterAndRender(0);
  const container = document.getElementById('mgr-models-tbody');
  if (container) container.scrollTop = 0;
};

window.applyModelsFilterAndRender = function(delay = 0) {
  clearTimeout(filterTimeout);
  const execute = () => {
    const searchEl = document.getElementById('mgr-models-search');
    const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const clearBtn = document.getElementById('mgr-models-search-clear');
    if (clearBtn) {
      clearBtn.style.display = query ? 'flex' : 'none';
    }

    // 1. Filter
    let filtered = currentProviderModels.filter(m => {
      const idLower = (m.id || '').toLowerCase();
      if (query && !idLower.includes(query)) return false;
      if (currentModelStatusFilter === 'all') return true;
      if (currentModelStatusFilter === 'free') return idLower.includes('free');
      if (currentModelStatusFilter === 'reasoning') {
        if (!window.isReasoningSupportedModel(m)) return false;
        const r = (m && m.reasoning ? String(m.reasoning).trim().toLowerCase() : '');
        return Boolean(r && r !== 'none');
      }
      const prov = POPULAR_PROVIDER_FILTERS.find(p => p.id === currentModelStatusFilter);
      if (prov) return prov.test(idLower);
      return true;
    });

    // 2. Sort
    if (currentModelsSortCol && currentModelsSortDir !== 'none') {
      const dir = currentModelsSortDir === 'asc' ? 1 : -1;
      const activeModelId = settingsState.translateAiModel || '';
      
      filtered.sort((a, b) => {
        if (currentModelsSortCol === 'active') {
          const aActive = (a.id === activeModelId) ? 1 : 0;
          const bActive = (b.id === activeModelId) ? 1 : 0;
          return (aActive - bActive) * dir;
        } else if (currentModelsSortCol === 'id') {
          return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }) * dir;
        } else if (currentModelsSortCol === 'ctx') {
          return (a.contextWindow - b.contextWindow) * dir;
        } else if (currentModelsSortCol === 'reasoning') {
          const rank = {
            'none': 0,
            'minimal': 1,
            'low': 2,
            'medium': 3,
            'high': 4,
            'xhigh': 5,
            'max': 6
          };
          const aRank = rank[(a.reasoning || '').toLowerCase()] ?? 0;
          const bRank = rank[(b.reasoning || '').toLowerCase()] ?? 0;
          return (aRank - bRank) * dir;
        }
        return 0;
      });
    }

    updateSortHeaderIcons();

    // 3. Pagination
    const totalFiltered = filtered.length;
    const pageSize = currentModelsPageSize === 'all' ? Math.max(1, totalFiltered) : currentModelsPageSize;
    const totalPages = currentModelsPageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalFiltered / pageSize));
    if (currentModelsPage > totalPages) currentModelsPage = totalPages;
    if (currentModelsPage < 1) currentModelsPage = 1;

    const startIndex = currentModelsPageSize === 'all' ? 0 : (currentModelsPage - 1) * pageSize;
    const endIndex = currentModelsPageSize === 'all' ? totalFiltered : Math.min(startIndex + pageSize, totalFiltered);
    const pageItems = filtered.slice(startIndex, endIndex);

    // 4. Counts & Stats Bar
    const showingCountEl = document.getElementById('models-showing-count');
    if (showingCountEl) {
      if (currentProviderModels.length === 0) {
        showingCountEl.textContent = t('settings.zeroModels');
      } else if (query || currentModelStatusFilter !== 'all') {
        if (totalFiltered <= pageSize || currentModelsPageSize === 'all') {
          showingCountEl.textContent = t('settings.showingModelsCount', {
            visible: window.formatNumberForLang(totalFiltered),
            total: window.formatNumberForLang(currentProviderModels.length)
          });
        } else {
          showingCountEl.textContent = t('settings.showingFilteredPageRange', {
            start: window.formatNumberForLang(totalFiltered > 0 ? startIndex + 1 : 0),
            end: window.formatNumberForLang(endIndex),
            visible: window.formatNumberForLang(totalFiltered),
            total: window.formatNumberForLang(currentProviderModels.length)
          });
        }
      } else {
        if (totalFiltered <= pageSize || currentModelsPageSize === 'all') {
          showingCountEl.textContent = t('settings.showingAllModelsCount', {
            total: window.formatNumberForLang(currentProviderModels.length)
          });
        } else {
          showingCountEl.textContent = t('settings.showingPageRange', {
            start: window.formatNumberForLang(startIndex + 1),
            end: window.formatNumberForLang(endIndex),
            total: window.formatNumberForLang(totalFiltered)
          });
        }
      }
    }

    // 5. Render rows
    const tbody = document.getElementById('mgr-models-tbody');
    if (tbody) {
      const prevScrollTop = tbody.scrollTop;
      destroyModelRowCustomSelects(tbody);
      tbody.innerHTML = '';
      const activeModelId = settingsState.translateAiModel || '';
      const frag = document.createDocumentFragment();
      pageItems.forEach((modelObj, idx) => {
        const isActive = modelObj.id === activeModelId && !!activeModelId;
        const row = createModelRowElement(modelObj, isActive, startIndex + idx);
        frag.appendChild(row);
      });
      tbody.appendChild(frag);

      // Restore scroll position after DOM rebuild
      if (prevScrollTop > 0) {
        tbody.scrollTop = prevScrollTop;
      }

      // Initialize CustomSelect on reasoning dropdowns safely after row is in DOM (without heavy MutationObservers)
      const selects = tbody.querySelectorAll('select.model-reasoning-select');
      selects.forEach(sel => {
        if (!sel.dataset.customSelectInitialized) {
          try {
            const cs = new CustomSelect(sel, { observe: false });
            sel.dataset.customSelectInitialized = 'true';
            const container = cs.container || sel.closest('.custom-select-container');
            if (container) {
              if (sel.value.toLowerCase() === 'none') {
                container.classList.remove('reasoning-active');
              } else {
                container.classList.add('reasoning-active');
              }
            }
          } catch (selErr) {
            console.error("Failed to initialize CustomSelect on reasoning select:", selErr);
          }
        }
      });
    }

    // 6. Pagination UI
    const pagContainer = document.getElementById('mgr-models-pagination');
    const pagInfo = document.getElementById('mgr-pagination-info');
    const pagIndicator = document.getElementById('mgr-pagination-page-indicator');
    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    const pageSizeSelect = document.getElementById('models-page-size-select');
    const pagNav = pagContainer ? pagContainer.querySelector('.pagination-nav') : null;

    if (pageSizeSelect) {
      if (!pageSizeSelect.dataset.customSelectInitialized) {
        new CustomSelect(pageSizeSelect, { observe: false });
        pageSizeSelect.dataset.customSelectInitialized = 'true';
      }
      pageSizeSelect.value = String(currentModelsPageSize);
      const cs = window.customSelectsMap && window.customSelectsMap.get('models-page-size-select');
      if (cs) {
        cs.syncSelectedValue();
      }
    }

    const tableWrapper = document.getElementById('mgr-models-table-wrapper');
    if (pagContainer) {
      if (totalFiltered > 0) {
        pagContainer.style.display = 'flex';
        if (tableWrapper) tableWrapper.classList.add('has-pagination');
        if (pagInfo) {
          if (currentModelsPageSize === 'all' || totalFiltered <= pageSize) {
            pagInfo.textContent = t('settings.showingAllModelsCount', {
              total: window.formatNumberForLang(totalFiltered)
            });
          } else {
            pagInfo.textContent = t('settings.showingPageRange', {
              start: window.formatNumberForLang(totalFiltered > 0 ? startIndex + 1 : 0),
              end: window.formatNumberForLang(endIndex),
              total: window.formatNumberForLang(totalFiltered)
            });
          }
        }
        if (pagNav) {
          pagNav.style.display = 'flex';
        }
        const hidePageNavButtons = totalPages <= 1 || currentModelsPageSize === 'all';
        const pagDivider = pagContainer.querySelector('.pagination-divider');
        if (pagDivider) {
          pagDivider.style.display = hidePageNavButtons ? 'none' : 'block';
        }
        if (btnPrev) {
          btnPrev.style.display = hidePageNavButtons ? 'none' : 'inline-flex';
          btnPrev.disabled = currentModelsPage <= 1;
        }
        if (btnNext) {
          btnNext.style.display = hidePageNavButtons ? 'none' : 'inline-flex';
          btnNext.disabled = currentModelsPage >= totalPages;
        }
        if (pagIndicator) {
          pagIndicator.style.display = hidePageNavButtons ? 'none' : 'inline-block';
          pagIndicator.textContent = t('settings.pageOf', {
            current: window.formatNumberForLang(currentModelsPage),
            total: window.formatNumberForLang(totalPages)
          });
        }
      } else {
        pagContainer.style.display = 'none';
        if (tableWrapper) tableWrapper.classList.remove('has-pagination');
      }
    }

    // 7. Empty states
    const emptyState = document.getElementById('mgr-models-empty-state');
    const emptyTitle = emptyState ? emptyState.querySelector('.models-empty-title') : null;
    const emptyDesc = emptyState ? emptyState.querySelector('.models-empty-desc') : null;
    const emptyResetBtn = document.getElementById('mgr-models-empty-reset-btn');
    const headEl = document.querySelector('.models-table-head');
    const bodyEl = document.querySelector('.models-table-body');

    if (emptyState) {
      if (currentProviderModels.length === 0) {
        emptyState.style.display = 'flex';
        if (emptyTitle) emptyTitle.textContent = t('settings.noModelsConfiguredTitle');
        if (emptyDesc) emptyDesc.textContent = t('settings.noModelsConfiguredDesc');
        if (emptyResetBtn) emptyResetBtn.style.display = 'none';
        if (headEl) headEl.style.display = 'none';
        if (bodyEl) bodyEl.style.display = 'none';
      } else if (totalFiltered === 0) {
        emptyState.style.display = 'flex';
        if (emptyTitle) emptyTitle.textContent = t('settings.noMatchingModelsTitle');
        if (emptyDesc) emptyDesc.textContent = t('settings.noMatchingModelsDesc');
        if (emptyResetBtn) emptyResetBtn.style.display = 'inline-flex';
        if (headEl) headEl.style.display = 'none';
        if (bodyEl) bodyEl.style.display = 'none';
      } else {
        emptyState.style.display = 'none';
        if (headEl) headEl.style.display = 'grid';
        if (bodyEl) bodyEl.style.display = 'block';
      }
    }
  };

  if (delay > 0) {
    filterTimeout = setTimeout(execute, delay);
  } else {
    execute();
  }
};

function createModelRowElement(modelObj, isActive, index = 0) {
  const row = document.createElement('div');
  row.className = `model-data-row${isActive ? ' active-model-row' : ''}`;
  row.dataset.modelId = (modelObj.id || '').trim().toLowerCase();
  row.dataset.reasoning = modelObj.reasoning || 'None';
  row.setAttribute('role', 'row');
  row.setAttribute('aria-selected', isActive ? 'true' : 'false');
  row.setAttribute('aria-checked', isActive ? 'true' : 'false');
  row.setAttribute('tabindex', '0');
  
  const isFree = (modelObj.id || '').toLowerCase().includes('free');
  const formattedCtx = window.formatTokensShort(modelObj.contextWindow);
  const safeId = (modelObj.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const selectId = `model-reasoning-${safeId}-${index}`;

  const supportsReasoning = window.isReasoningSupportedModel(modelObj);
  const curReasoning = (modelObj.reasoning || 'None').trim();
  const curReasoningLower = curReasoning.toLowerCase();
  const isReasoningActive = curReasoningLower !== 'none' && curReasoningLower !== '';

  const fullId = (modelObj.id || '').trim();
  let providerPrefix = '';
  let modelName = fullId;
  const slashIdx = fullId.indexOf('/');
  if (slashIdx !== -1) {
    providerPrefix = fullId.substring(0, slashIdx + 1);
    modelName = fullId.substring(slashIdx + 1);
  }

  const isManualNew = !fullId;

  row.innerHTML = `
    <div class="td-cell td-active" role="cell">
      ${isActive ? `
        <div class="model-active-badge is-active" title="${t('settings.activeBadge')}">
          <span class="active-dot"></span>
          <span class="badge-text">${t('settings.activeBadge')}</span>
        </div>
      ` : `
        <button type="button" class="model-radio-btn" role="radio" aria-checked="false" title="${t('settings.setActiveBadge')}" aria-label="${t('settings.setActiveBadge')}">
          <span class="radio-circle"></span>
        </button>
      `}
    </div>
    <div class="td-cell td-id" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-id-input" value="" placeholder="e.g. gpt-4o-mini" title="Model Identifier" />
      ` : `
        <div class="model-id-wrapper" dir="ltr">
          <div class="model-id-display" title="${escapeHTML(fullId)}">${providerPrefix ? `<span class="model-id-prefix">${escapeHTML(providerPrefix)}</span>` : ''}<span class="model-id-name">${escapeHTML(modelName)}</span></div>
          ${isFree ? '<span class="model-tag-free">FREE</span>' : ''}
        </div>
      `}
    </div>
    <div class="td-cell td-ctx" role="cell">
      ${isManualNew ? `
        <input type="text" class="model-cell-input model-ctx-input" value="${formattedCtx}" data-raw-tokens="${modelObj.contextWindow}" placeholder="128K" title="Context tokens: ${formattedCtx} (${Number(modelObj.contextWindow).toLocaleString()})" />
      ` : `
        <span class="model-ctx-value" title="Context tokens: ${formattedCtx} (${Number(modelObj.contextWindow).toLocaleString()})">${formattedCtx}</span>
      `}
    </div>
    <div class="td-cell td-reasoning" role="cell">
      ${supportsReasoning ? `
        <select id="${selectId}" class="select-control model-reasoning-select${isReasoningActive ? ' reasoning-active' : ''}">
          <option value="None" ${curReasoningLower === 'none' ? 'selected' : ''}>None</option>
          <option value="Minimal" ${curReasoningLower === 'minimal' ? 'selected' : ''}>Minimal</option>
          <option value="Low" ${curReasoningLower === 'low' ? 'selected' : ''}>Low</option>
          <option value="Medium" ${curReasoningLower === 'medium' ? 'selected' : ''}>Medium</option>
          <option value="High" ${curReasoningLower === 'high' ? 'selected' : ''}>High</option>
          <option value="XHigh" ${curReasoningLower === 'xhigh' ? 'selected' : ''}>XHigh</option>
          <option value="Max" ${curReasoningLower === 'max' ? 'selected' : ''}>Max</option>
        </select>
      ` : `
        <span class="reasoning-none-dash" title="${t('settings.reasoningNotSupported')}" aria-label="${t('settings.reasoningNotSupported')}">—</span>
      `}
    </div>
    <div class="td-cell td-action" role="cell">
      ${isActive ? '' : `
        <button type="button" class="model-btn-trash" title="Remove Model Row" aria-label="Remove Model Row">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `}
    </div>
  `;

  const handleActivate = () => {
    if (!modelObj.id || !modelObj.id.trim()) {
      showNotification(t('toasts.noModelIdError'), 'info');
      return;
    }
    if (!isActive) {
      window.setActiveModelFromTable(modelObj.id.trim());
    }
  };

  row.addEventListener('click', (e) => {
    const trashBtn = e.target.closest('.model-btn-trash');
    if (trashBtn) {
      e.stopPropagation();
      const currentActive = (settingsState.translateAiModel || '').toLowerCase();
      const thisId = (modelObj.id || '').toLowerCase();
      if (isActive || (currentActive && currentActive === thisId)) {
        showNotification(t('toasts.cannotDeleteActiveModel'), "info");
        return;
      }
      const idx = currentProviderModels.indexOf(modelObj);
      if (idx !== -1) {
        currentProviderModels.splice(idx, 1);
      }
      window.updateFilterCounts();
      saveActiveProviderModelsDebounced();
      window.applyModelsFilterAndRender(0);
      return;
    }

    if (
      e.target.closest('.model-reasoning-select') ||
      e.target.closest('.custom-select-container') ||
      e.target.closest('input') ||
      e.target.closest('.reasoning-none-dash')
    ) {
      return;
    }
    handleActivate();
  });

  row.addEventListener('keydown', (e) => {
    if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handleActivate();
    }
  });

  const radioBtn = row.querySelector('.model-radio-btn');
  if (radioBtn) {
    radioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleActivate();
    });
  }

  const reasoningSelect = row.querySelector('.model-reasoning-select');
  if (reasoningSelect) {
    reasoningSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      modelObj.reasoning = reasoningSelect.value;
      row.dataset.reasoning = reasoningSelect.value;
      if (typeof modelObj.supportsReasoning !== 'boolean') {
        modelObj.supportsReasoning = true;
      }
      const cs = window.customSelectsMap && (window.customSelectsMap.get(reasoningSelect.id) || window.customSelectsMap.get(reasoningSelect));
      const container = (cs && cs.container) || (reasoningSelect.nextElementSibling && reasoningSelect.nextElementSibling.classList.contains('custom-select-container') ? reasoningSelect.nextElementSibling : reasoningSelect.closest('.custom-select-container'));
      if (container) {
        if (reasoningSelect.value.toLowerCase() === 'none') {
          container.classList.remove('reasoning-active');
        } else {
          container.classList.add('reasoning-active');
        }
      }
      window.updateFilterCounts();
      saveActiveProviderModelsDebounced();
      if (currentModelStatusFilter === 'reasoning') {
        window.applyModelsFilterAndRender(0);
      }
    });
  }

  // Inline editing on double click
  const idDisplay = row.querySelector('.model-id-display');
  if (idDisplay) {
    idDisplay.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'model-cell-input model-id-input';
      input.value = modelObj.id || '';
      input.style.direction = 'ltr';
      input.style.textAlign = 'left';
      input.addEventListener('click', ev => ev.stopPropagation());

      let discarded = false;
      const onBlur = () => {
        if (discarded) return;
        commit();
      };
      const cancel = () => {
        discarded = true;
        input.removeEventListener('blur', onBlur);
        window.applyModelsFilterAndRender(0);
      };
      const commit = () => {
        if (discarded) return;
        discarded = true;
        input.removeEventListener('blur', onBlur);
        const val = input.value.trim();
        if (val && val !== modelObj.id) {
          modelObj.id = val;
          row.dataset.modelId = val.toLowerCase();
          if (isActive) {
            settingsState.translateAiModel = val;
            updateActiveModelBannerUI(val);
          }
          window.updateFilterCounts();
          saveActiveProviderModelsDebounced();
        }
        window.applyModelsFilterAndRender(0);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', onBlur);
      idDisplay.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  const ctxValue = row.querySelector('.model-ctx-value');
  if (ctxValue) {
    ctxValue.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'model-cell-input model-ctx-input';
      input.value = formattedCtx;
      input.style.maxWidth = '80px';
      input.style.margin = '0 auto';
      input.addEventListener('click', ev => ev.stopPropagation());

      let discarded = false;
      const onBlur = () => {
        if (discarded) return;
        commit();
      };
      const cancel = () => {
        discarded = true;
        input.removeEventListener('blur', onBlur);
        window.applyModelsFilterAndRender(0);
      };
      const commit = () => {
        if (discarded) return;
        discarded = true;
        input.removeEventListener('blur', onBlur);
        const rawTokens = window.parseTokensInput(input.value);
        if (rawTokens !== modelObj.contextWindow) {
          modelObj.contextWindow = rawTokens;
          saveActiveProviderModelsDebounced();
        }
        window.applyModelsFilterAndRender(0);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', onBlur);
      ctxValue.replaceWith(input);
      input.focus();
      input.select();
    });
  }

  // Handle inputs for newly added manual model
  const idInput = row.querySelector('.model-id-input');
  if (idInput) {
    idInput.addEventListener('click', e => e.stopPropagation());
    idInput.addEventListener('input', () => {
      const val = idInput.value.trim();
      modelObj.id = val;
      row.dataset.modelId = val.toLowerCase();
    });
    idInput.addEventListener('blur', () => {
      const val = idInput.value.trim();
      if (val) {
        window.updateFilterCounts();
        saveActiveProviderModelsDebounced();
        setTimeout(() => {
          if (!row.contains(document.activeElement)) {
            window.applyModelsFilterAndRender(0);
          }
        }, 120);
      } else {
        setTimeout(() => {
          if (!row.contains(document.activeElement)) {
            const idx = currentProviderModels.indexOf(modelObj);
            if (idx !== -1 && !modelObj.id) {
              currentProviderModels.splice(idx, 1);
              window.updateFilterCounts();
              window.applyModelsFilterAndRender(0);
            }
          }
        }, 120);
      }
    });
    idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        idInput.blur();
      }
    });
  }

  const ctxInput = row.querySelector('.model-ctx-input');
  if (ctxInput) {
    ctxInput.addEventListener('click', e => e.stopPropagation());
    ctxInput.addEventListener('change', () => {
      const rawTokens = window.parseTokensInput(ctxInput.value);
      modelObj.contextWindow = rawTokens;
      saveActiveProviderModelsDebounced();
    });
    ctxInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!row.contains(document.activeElement)) {
          window.applyModelsFilterAndRender(0);
        }
      }, 120);
    });
    ctxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        ctxInput.blur();
      }
    });
  }

  const handleKeyNavigation = (e) => {
    if (e.key === 'ArrowDown') {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('model-data-row')) {
        e.preventDefault();
        const target = next.querySelector('.model-cell-input') || next;
        target.focus();
      }
    } else if (e.key === 'ArrowUp') {
      const prev = row.previousElementSibling;
      if (prev && prev.classList.contains('model-data-row')) {
        e.preventDefault();
        const target = prev.querySelector('.model-cell-input') || prev;
        target.focus();
      }
    }
  };

  row.addEventListener('keydown', handleKeyNavigation);

  return row;
}

window.addManualModelRow = function(modelId = "", contextWindow = 200000, reasoning = "None", isActive = false, focus = false, supportsReasoning = true) {
  const newModel = {
    id: modelId,
    contextWindow: window.parseTokensInput(contextWindow),
    reasoning: reasoning || 'None',
    supportsReasoning: typeof supportsReasoning === 'boolean' ? supportsReasoning : true,
    enabled: true
  };
  currentProviderModels.unshift(newModel);
  if (isActive && modelId) {
    settingsState.translateAiModel = modelId;
  }
  currentModelsPage = 1;
  currentModelStatusFilter = 'all';
  window.updateFilterCounts();
  window.applyModelsFilterAndRender(0);
  
  if (focus) {
    setTimeout(() => {
      const firstInput = document.querySelector('#mgr-models-tbody .model-id-input');
      if (firstInput) {
        firstInput.focus();
      }
    }, 50);
  }
};

window.fetchActiveProviderModels = async function() {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const provider = providers.find(p => p.name === providerName);
  if (!provider) return;
  
  const baseUrl = document.getElementById('mgr-provider-url').value.trim();
  const apiFormat = document.getElementById('mgr-provider-format').value;
  let apiKey = document.getElementById('mgr-provider-key').value.trim();
  
  if (!baseUrl) {
    showNotification(t('toasts.baseUrlRequiredFetch'), "info");
    return;
  }
  
  const btn = document.getElementById('mgr-btn-fetch-models');
  btn.disabled = true;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `
    <svg class="btn-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
    </svg>
    <span>${t('common.loading')}</span>
  `;
  
  if ((!apiKey || apiKey === '••••••••••••••••') && (provider.useKeyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__')) {
    try {
      apiKey = await invoke('get_keyring_credential', { providerName });
    } catch(e) {}
  }
  
  try {
    const modelsList = await invoke('fetch_provider_models', { baseUrl, apiKey, apiFormat });
    const currentActive = settingsState.translateAiModel;
    
    const existingMap = new Map();
    if (provider && Array.isArray(provider.models)) {
      provider.models.forEach(pm => {
        if (pm && pm.id) existingMap.set(pm.id, pm);
      });
    }

    currentProviderModels = modelsList.map((m, idx) => {
      const modelId = String((m && typeof m === 'object') ? m.id : m);
      const modelCtx = (m && typeof m === 'object') ? (m.contextWindow || m.context_window || 200000) : 200000;
      const isReasoning = window.isReasoningSupportedModel(m);
      const existing = existingMap.get(modelId);

      let reasoning = isReasoning ? 'Medium' : 'None';
      let enabled = true;
      if (existing) {
        if (isReasoning) {
          reasoning = (existing.reasoning && existing.reasoning.toLowerCase() !== 'none')
            ? existing.reasoning
            : 'None';
        } else {
          reasoning = 'None';
        }
        if (typeof existing.enabled === 'boolean') {
          enabled = existing.enabled;
        }
      }
      return {
        id: modelId,
        contextWindow: window.parseTokensInput(modelCtx),
        reasoning,
        supportsReasoning: isReasoning,
        enabled
      };
    });
    
    if (!currentActive && currentProviderModels.length > 0) {
      settingsState.translateAiModel = currentProviderModels[0].id;
    }
    
    currentModelsPage = 1;
    currentModelsSortCol = null;
    currentModelsSortDir = 'none';
    window.updateFilterCounts();
    await saveActiveProviderModels(true, false);
    showNotification(t('toasts.modelsFetchedSuccess', { count: modelsList.length }), "success");
  } catch (e) {
    showNotification(t('toasts.modelsFetchError', { error: String(e) }), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
};

window.saveActiveProviderModels = async function(keepCurrentTab = false, skipTableRender = false, targetProviderName = null) {
  const providerName = targetProviderName || settingsState.translateAiProvider;
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const validModels = [];
  const seenIds = new Set();
  currentProviderModels.forEach(m => {
    const trimmedId = (m.id || '').trim();
    if (trimmedId && !seenIds.has(trimmedId)) {
      seenIds.add(trimmedId);
      const supportsReasoning = typeof m.supportsReasoning === 'boolean'
        ? m.supportsReasoning
        : (typeof m.supports_reasoning === 'boolean' ? m.supports_reasoning : undefined);

      validModels.push({
        id: trimmedId,
        contextWindow: m.contextWindow || 200000,
        reasoning: m.reasoning || 'None',
        supportsReasoning: supportsReasoning !== undefined
          ? supportsReasoning
          : (m.reasoning && m.reasoning.toLowerCase() !== 'none' ? true : undefined),
        enabled: m.enabled !== false
      });
    }
  });

  provider.models = validModels;
  providers[providerIdx] = provider;
  settingsState.translateAiProviders = JSON.stringify(providers);

  const isCurrentActiveProvider = providerName === settingsState.translateAiProvider;
  if (isCurrentActiveProvider) {
    if (!validModels.some(m => m.id === settingsState.translateAiModel)) {
      settingsState.translateAiModel = validModels.length > 0 ? validModels[0].id : '';
    }
    
    const selectDOM = document.getElementById('opt-translateAiModel');
    if (selectDOM) {
      selectDOM.innerHTML = '';
      validModels.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.id;
        selectDOM.appendChild(opt);
      });
      selectDOM.value = settingsState.translateAiModel;
    }
    
    updateActiveModelBannerUI(settingsState.translateAiModel);
  }
  
  await saveCurrentSettings();
  if (isCurrentActiveProvider) {
    updateTranscribeUIConfigs();
    if (window.translationStudioController) {
      window.translationStudioController.refreshModelOptions();
    }
    if (!skipTableRender) {
      window.applyModelsFilterAndRender(0);
    }
  }
};

window.filterModelsTable = function(delay = 150) {
  currentModelsPage = 1;
  window.applyModelsFilterAndRender(delay);
};

window.filterModelsStatus = function(status, delay = 0) {
  currentModelStatusFilter = status;
  
  const pillsContainer = document.getElementById('models-filter-pills') || document.querySelector('.models-filter-pills');
  if (pillsContainer) {
    pillsContainer.querySelectorAll('.btn-filter').forEach(btn => {
      if (btn.dataset.filter === status || btn.id === `filter-models-${status}`) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  
  currentModelsPage = 1;
  const container = document.getElementById('mgr-models-tbody');
  if (container) {
    container.scrollTop = 0;
  }
  
  window.applyModelsFilterAndRender(delay);
};

window.openAddProviderModal = function() {
  document.getElementById('provider-name').value = '';
  document.getElementById('provider-url').value = '';
  document.getElementById('provider-key').value = '';
  
  const modal = document.getElementById('translation-provider-modal');
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('show'), 10);
};

window.closeProviderModal = function() {
  const modal = document.getElementById('translation-provider-modal');
  modal.classList.remove('show');
  setTimeout(() => modal.style.display = 'none', 300);
};

window.saveProviderConfig = async function() {
  const name = document.getElementById('provider-name').value.trim();
  const baseUrl = document.getElementById('provider-url').value.trim();
  const apiFormat = document.getElementById('provider-format').value;
  const key = document.getElementById('provider-key').value.trim();
  
  if (!name || !baseUrl) {
    showNotification(t('toasts.nameAndUrlRequired'), "info");
    return;
  }
  
  let keyToSave = key;
  let useKeyring = false;
  
  if (key) {
    try {
      await invoke('store_keyring_credential', { providerName: name, key });
      keyToSave = '__KEYRING__';
      useKeyring = true;
    } catch (e) {
      console.warn("Failed to store API Key in system keyring:", e);
      keyToSave = key;
      useKeyring = false;
    }
  }
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  if (providers.some(p => p.name === name)) {
    showNotification(t('toasts.providerNameExists', { name }), "error");
    return;
  }
  
  const providerData = {
    name,
    baseUrl: baseUrl,
    apiKey: keyToSave,
    apiFormat: apiFormat,
    useKeyring: useKeyring,
    models: [],
    customPrompt: ""
  };
  
  providers.push(providerData);
  settingsState.translateAiProviders = JSON.stringify(providers);
  settingsState.translateAiProvider = name;
  
  await saveCurrentSettings();
  populateProvidersDropdown();
  onProviderChanged('general'); // Switch directly to Provider Configuration tab for newly created provider
  closeProviderModal();
  
  showNotification(t('toasts.providerAddedSuccess'), "success");
};

window.showBatchErrorDialog = function(fileName, errorMsg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('batch-error-modal');
    document.getElementById('batch-error-message').textContent = t('modals.batchErrorFormatted', { file: fileName, error: errorMsg });
    
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    
    window.resolveBatchError = function(choice) {
      modal.classList.remove('show');
      setTimeout(() => modal.style.display = 'none', 300);
      resolve(choice);
    };
  });
};

window.setupTranslationEventListeners = function() {
  const urlInput = document.getElementById('mgr-provider-url');
  const formatSelect = document.getElementById('mgr-provider-format');
  const keyInput = document.getElementById('mgr-provider-key');
  const promptTextarea = document.getElementById('mgr-provider-prompt');
  
  const triggerAutoSave = () => {
    saveActiveProviderGeneral(true); // Save silently
  };
  
  if (urlInput) urlInput.addEventListener('change', triggerAutoSave);
  if (formatSelect) formatSelect.addEventListener('change', triggerAutoSave);
  if (keyInput) keyInput.addEventListener('change', triggerAutoSave);
  if (promptTextarea) {
    applyDynamicDirection(promptTextarea);
    promptTextarea.addEventListener('input', () => applyDynamicDirection(promptTextarea));
    promptTextarea.addEventListener('change', triggerAutoSave);
  }

  const addCustomModelBtn = document.getElementById('mgr-btn-add-custom-model');
  if (addCustomModelBtn) {
    addCustomModelBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('mgr-models-search');
      if (searchInput && searchInput.value) {
        window.clearModelsSearch();
      }
      window.addManualModelRow("", 200000, "None", false, true);
      const container = document.getElementById('mgr-models-tbody');
      if (container) container.scrollTop = 0;
    });
  }
};

let isPreviewTesting = false;
let previewTestId = 0;

function _handleTestModalKeydown(e) {
  const modal = document.getElementById('translation-test-modal');
  if (!modal || !modal.classList.contains('show')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    window.abortAndCloseTestModal();
  }
}

window.handleTestModalBackdropClick = function(event) {
  if (event.target && event.target.id === 'translation-test-modal') {
    window.abortAndCloseTestModal();
  }
};

window.abortAndCloseTestModal = async function() {
  if (isPreviewTesting) {
    isPreviewTesting = false;
    previewTestId++; // Invalidate any delayed in-flight response
    try {
      await invoke('cancel_preview_translate');
    } catch (e) {
      console.warn("Failed to cancel preview translate backend:", e);
    }
    const testBtn = document.getElementById('mgr-btn-test-connection');
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.textContent = testBtn.dataset.originalText || t('settings.testConnBtn') || 'Test Connection';
    }
    showNotification(t('toasts.testCancelled'), "info");
  }
  const modal = document.getElementById('translation-test-modal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => {
      if (!modal.classList.contains('show')) {
        modal.style.display = 'none';
      }
    }, 300);
  }
  document.removeEventListener('keydown', _handleTestModalKeydown);
};

window.closeTestModal = function() {
  if (isPreviewTesting) {
    window.abortAndCloseTestModal();
    return;
  }
  const modal = document.getElementById('translation-test-modal');
  if (modal) {
    modal.classList.remove('show');
    setTimeout(() => {
      if (!modal.classList.contains('show')) {
        modal.style.display = 'none';
      }
    }, 300);
  }
  document.removeEventListener('keydown', _handleTestModalKeydown);
  const testBtn = document.getElementById('mgr-btn-test-connection');
  if (testBtn && !isPreviewTesting) {
    testBtn.disabled = false;
    testBtn.textContent = testBtn.dataset.originalText || t('settings.testConnBtn') || 'Test Connection';
  }
};

window.testTranslationConnection = async function() {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) {
    showNotification(t('toasts.noProviderToTest'), "info");
    return;
  }
  
  const testBtn = document.getElementById('mgr-btn-test-connection');
  const originalText = t('settings.testConnBtn') || testBtn.textContent;
  testBtn.dataset.originalText = originalText;
  testBtn.disabled = true;
  testBtn.textContent = t('modals.testingBtn');
  
  // Make sure general settings are saved silently first
  try {
    await saveActiveProviderGeneral(true);
  } catch (e) {
    console.warn("Failed to silently save provider configuration before test:", e);
  }

  // Synchronize settingsState provider
  settingsState.translateAiProvider = providerName;

  // Validate or fallback to an active/enabled model of this specific provider
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {}
  const p = providers.find(item => item.name === providerName);
  const models = (p && Array.isArray(p.models)) ? p.models : [];
  const modelBelongsToProvider = models.some(m => m.id === settingsState.translateAiModel);
  if (!modelBelongsToProvider && models.length > 0) {
    const enabledModel = models.find(m => m.enabled !== false) || models[0];
    if (enabledModel) {
      settingsState.translateAiModel = enabledModel.id;
    }
  }
  
  const testSrt = `1\n00:00:01,000 --> 00:00:05,000\nHello, this is a test of the AI translation system connection.`;
  
  const testModal = document.getElementById('translation-test-modal');
  const statusEl = document.getElementById('test-modal-status');
  const resultEl = document.getElementById('test-modal-result');
  const cancelBtn = document.getElementById('test-modal-cancel-btn');
  const okBtn = document.getElementById('test-modal-ok-btn');
  
  statusEl.textContent = t('modals.testingConnection');
  statusEl.style.color = 'var(--color-cyan)';
  resultEl.textContent = t('modals.waitingApiResponse');
  
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  if (okBtn) okBtn.style.display = 'none';

  testModal.style.display = 'flex';
  setTimeout(() => testModal.classList.add('show'), 10);
  document.addEventListener('keydown', _handleTestModalKeydown);

  isPreviewTesting = true;
  const currentTestId = ++previewTestId;

  // Client-side safety timeout (26 seconds)
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      // Abort backend preview request immediately
      invoke('cancel_preview_translate').catch(() => {});
      reject(new Error(t('modals.connectionTimeoutDesc', { seconds: 25 })));
    }, 26000);
  });

  try {
    const invokePromise = invoke('preview_translate_first_lines', {
      settings: settingsState,
      fileContent: testSrt
    });

    const response = await Promise.race([invokePromise, timeoutPromise]);
    if (timerId) clearTimeout(timerId);
    
    if (currentTestId !== previewTestId || !isPreviewTesting) return;

    statusEl.textContent = t('modals.connectionSuccess');
    statusEl.style.color = 'var(--color-green)';
    resultEl.textContent = response;
  } catch (err) {
    if (timerId) clearTimeout(timerId);
    if (currentTestId !== previewTestId || !isPreviewTesting) return;

    const errStr = typeof err === 'string' ? err : (err && err.message ? err.message : String(err));
    const isTimeout = errStr.toLowerCase().includes('timeout') || errStr.toLowerCase().includes('timed out') || errStr.includes('تایم‌اوت');
    statusEl.textContent = isTimeout ? (t('modals.connectionTimeout') || t('modals.connectionFailed')) : t('modals.connectionFailed');
    statusEl.style.color = 'var(--color-red)';
    resultEl.textContent = errStr;
  } finally {
    if (timerId) clearTimeout(timerId);
    if (currentTestId === previewTestId) {
      isPreviewTesting = false;
      testBtn.disabled = false;
      testBtn.textContent = originalText;
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (okBtn) {
        okBtn.style.display = 'inline-flex';
        okBtn.focus();
      }
    }
  }
};

window.toggleTranslationSubSettingsVisibility = function() {
  // Deprecated: UI visibility is permanently decoupled from the auto-translate after transcription toggle.
};
