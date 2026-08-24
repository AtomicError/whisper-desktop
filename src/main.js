import { hardsubController } from './hardsub.ts';

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

// Premium Glassmorphic Toast Notification System
window.showNotification = function(message, type = 'info', customDuration = null) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (type === 'error') {
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
  } else {
    // Info
    iconSvg = `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
  }
  
  const closeSvg = `<svg class="toast-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  // Extended durations: 10s for errors, 6s for info/success
  let defaultDuration = 6000;
  if (type === 'error') {
    defaultDuration = 10000;
  }
  const duration = (customDuration !== null) ? customDuration : defaultDuration;

  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-message"></div>
    <button class="toast-close-btn" title="Close">${closeSvg}</button>
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
  
  const startTimer = () => {
    if (duration <= 0 || duration === Infinity) return;
    startTime = Date.now();
    progressBar.style.width = '0%';
    timerId = setTimeout(closeToast, remainingTime);
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

// Promise-based confirm dialog using the themed modal
window._confirmModalResolve = null;

window.showConfirmModal = function(title, message, confirmButtonText = 'Delete') {
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
    
    deleteBtn.textContent = confirmButtonText;
    
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
  if (cmd === 'get_system_stats') {
    return {
      cpu: Math.random() * 8.0 + 2.0, // Mock realistic idle load
      ram: "4.8GB / 16.0GB",
      gpu: "Intel Iris Xe Graphics (idle)"
    };
  }
  if (cmd === 'load_settings') {
    return {
      selectedBackend: 'Standard',
      modelsDir: '/home/user/whisper.cpp',
      threads: 4,
      processors: 1,
      offsetT: 0,
      offsetN: 0,
      duration: 0,
      maxContext: -1,
      maxLen: 0,
      splitWord: false,
      bestOf: 5,
      beamSize: 5,
      audioCtx: 0,
      wordThold: 0.01,
      entropyThold: 2.40,
      logprobThold: -1.00,
      noSpeechThold: 0.60,
      temperature: 0.00,
      temperatureInc: 0.20,
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
      outputWords: false,
      fontPath: "",
      outputCsv: false,
      outputJson: false,
      outputJsonFull: false,
      noPrints: false,
      printSpecial: false,
      printColors: false,
      printConfidence: false,
      printProgress: false,
      noTimestamps: false,
      language: "auto",
      detectLanguage: false,
      prompt: "",
      carryPrompt: false,
      modelPath: "ggml-base.en.bin",
      inputFile: "",
      ovDevice: "CPU",
      dtwEnabled: false,
      logScore: false,
      noGPU: false,
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
// Tier 1: Direct Tauri IPC command invoke('plugin:clipboard-manager|write_text', { text })
// Tier 2: window.__TAURI__.clipboardManager.writeText(text) (if plugin global JS bundle is present)
// Tier 3: W3C Navigator Clipboard API (navigator.clipboard.writeText)
// Tier 4: Document execCommand fallback (for non-secure/legacy webview execution contexts)
const copyToClipboard = async function(text) {
  const cleanText = (text === null || text === undefined) ? '' : String(text);

  let lastError = null;

  // 1. Preferred Native IPC via Tauri Plugin Clipboard Manager
  try {
    if (typeof invoke === 'function') {
      await invoke('plugin:clipboard-manager|write_text', { text: cleanText });
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] Tauri plugin IPC command failed, trying next provider:', err);
  }

  // 2. Global Tauri Plugin Object (if JS bundle is mounted)
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

  // 3. Web Navigator Clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(cleanText);
      return;
    }
  } catch (err) {
    lastError = err;
    console.warn('[Clipboard] navigator.clipboard.writeText failed:', err);
  }

  // 4. Fallback: Hidden Textarea with document.execCommand('copy') for webview transient activation failures
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

// Global States
let activeView = 'intro';
let activeSettingsCat = 'general';
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
let lastAppendedCategory = null;

// Batch Processing State variables
let selectedMediaFiles = [];
let batchItems = [];
let isBatchMode = false;
let batchCancelActive = false;
let _unlistenFns = [];
let _modelActionsInProgress = new Set();

// Premium GNOME-Style Titlebar Window Controls Binding
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

      closeBtn.addEventListener('click', () => {
        appWindow.close().catch(err => console.error("Failed to close window:", err));
      });
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
  constructor(selectElement) {
    this.select = selectElement;
    this.instanceId = this.select.id || `custom-select-auto-${++customSelectInstanceCounter}`;
    this.container = null;
    this.trigger = null;
    this.optionsContainer = null;
    this.isOpen = false;
    this.focusedIndex = -1;
    this.typeaheadBuffer = '';
    this.typeaheadTimeout = null;
    this.init();
  }

  init() {
    this.select.style.display = 'none';

    this.container = document.createElement('div');
    this.container.className = 'custom-select-container';
    
    if (this.select.className) {
      this.container.classList.add(...this.select.className.split(' ').filter(c => c !== 'select-control'));
    }
    this.container.id = `custom-select-${this.instanceId}`;
    
    this.container.style.width = this.select.style.width || '100%';
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
          if (this.focusedIndex >= 0 && this.focusedIndex < this.optionsContainer.children.length) {
            const optDiv = this.optionsContainer.children[this.focusedIndex];
            if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
              this.select.value = optDiv.dataset.value;
              this.select.dispatchEvent(new Event('change'));
            }
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
        // WAI-ARIA Typeahead search with single-letter repeating cycle
        clearTimeout(this.typeaheadTimeout);
        const char = e.key.toLowerCase();
        const isRepeat = this.typeaheadBuffer.length === 1 && this.typeaheadBuffer === char;
        const options = Array.from(this.optionsContainer.children);

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

    this._documentClickHandler = (e) => {
      if (this.isOpen && !this.container.contains(e.target) && !this.optionsContainer.contains(e.target)) {
        this.close();
      }
    };
    document.addEventListener('click', this._documentClickHandler);

    this._scrollResizeHandler = () => {
      if (this.isOpen) {
        this.updatePosition();
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

    this.observer = new MutationObserver(() => {
      this.updateOptions();
    });
    this.observer.observe(this.select, { childList: true, attributes: true, subtree: true });

    // Register this instance globally for sync
    window.customSelectsMap.set(this.select.id || this.select, this);
  }

  getNextAvailableIndex(fromIdx, direction = 1) {
    const children = Array.from(this.optionsContainer.children);
    const len = children.length;
    if (len === 0) return -1;
    let curr = fromIdx + direction;
    while (curr >= 0 && curr < len) {
      if (!children[curr].classList.contains('disabled')) {
        return curr;
      }
      curr += direction;
    }
    return fromIdx >= 0 ? fromIdx : this.getFirstAvailableIndex();
  }

  getFirstAvailableIndex() {
    const children = Array.from(this.optionsContainer.children);
    return children.findIndex(c => !c.classList.contains('disabled'));
  }

  getLastAvailableIndex() {
    const children = Array.from(this.optionsContainer.children);
    for (let i = children.length - 1; i >= 0; i--) {
      if (!children[i].classList.contains('disabled')) return i;
    }
    return -1;
  }

  setFocusedOptionIndex(idx) {
    const children = Array.from(this.optionsContainer.children);
    children.forEach(c => c.classList.remove('focused'));

    if (idx >= 0 && idx < children.length && !children[idx].classList.contains('disabled')) {
      this.focusedIndex = idx;
      const target = children[idx];
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
    this.optionsContainer.innerHTML = '';
    const options = Array.from(this.select.options);
    const frag = document.createDocumentFragment();

    options.forEach((opt, idx) => {
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.id = `opt-${this.instanceId}-${idx}`;
      optDiv.setAttribute('role', 'option');
      optDiv.setAttribute('aria-selected', opt.value === this.select.value ? 'true' : 'false');
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;
      if (opt.disabled) {
        optDiv.classList.add('disabled');
        optDiv.setAttribute('aria-disabled', 'true');
      }
      frag.appendChild(optDiv);
    });

    this.optionsContainer.appendChild(frag);
    this.syncSelectedValue();
  }

  syncSelectedValue() {
    const selectedOpt = this.select.options[this.select.selectedIndex];
    const valText = selectedOpt ? selectedOpt.textContent : (this.select.placeholder || 'Select...');
    this.trigger.querySelector('.custom-select-value').textContent = valText;

    Array.from(this.optionsContainer.children).forEach(child => {
      const isSelected = child.dataset.value === this.select.value;
      if (isSelected) {
        child.classList.add('selected');
        child.setAttribute('aria-selected', 'true');
      } else {
        child.classList.remove('selected');
        child.setAttribute('aria-selected', 'false');
      }
    });
  }

  updatePosition() {
    if (!this.isOpen || !this.trigger || !this.optionsContainer) return;
    const rect = this.trigger.getBoundingClientRect();
    const dropdownHeight = Math.min(this.optionsContainer.scrollHeight || 220, 240);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    this.optionsContainer.style.position = 'fixed';
    this.optionsContainer.style.width = `${rect.width}px`;
    this.optionsContainer.style.left = `${rect.left}px`;
    this.optionsContainer.style.zIndex = '999999';

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
    document.querySelectorAll('.custom-select-container').forEach(c => {
      if (c !== this.container) c.classList.remove('open');
    });
    document.querySelectorAll('.custom-select-options').forEach(opt => {
      if (opt !== this.optionsContainer) {
        opt.classList.remove('open');
        opt.style.willChange = 'auto';
      }
    });

    // 1. Promote to GPU compositing layer right before animation begins
    this.optionsContainer.style.willChange = 'transform, opacity';

    // 2. Position the container first while it's still closed
    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.updatePosition();

    // Attach scroll and resize listeners only while open
    window.addEventListener('scroll', this._scrollResizeHandler, true);
    window.addEventListener('resize', this._scrollResizeHandler);

    // Focus active or selected non-disabled option
    const children = Array.from(this.optionsContainer.children);
    let selectedIdx = children.findIndex(c => c.classList.contains('selected') && !c.classList.contains('disabled'));
    if (selectedIdx === -1) {
      selectedIdx = this.getFirstAvailableIndex();
    }
    this.setFocusedOptionIndex(selectedIdx);

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

    // Detach scroll and resize listeners immediately on close
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
    document.removeEventListener('click', this._documentClickHandler);
    window.removeEventListener('scroll', this._scrollResizeHandler, true);
    window.removeEventListener('resize', this._scrollResizeHandler);
    if (this.optionsContainer && this.optionsContainer.parentNode) {
      this.optionsContainer.parentNode.removeChild(this.optionsContainer);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.observer.disconnect();
    window.customSelectsMap.delete(this.select.id || this.select);
  }
}

window.initializeCustomSelects = function() {
  document.querySelectorAll('select.select-control, select#batch-sort-select').forEach(select => {
    if (select.style.display === 'none') return; // leave hidden data-binder stubs unwrapped
    if (!select.dataset.customSelectInitialized) {
      new CustomSelect(select);
      select.dataset.customSelectInitialized = 'true';
    }
  });
};

window.syncCustomSelects = function() {
  if (window.customSelectsMap) {
    window.customSelectsMap.forEach(cs => {
      cs.syncSelectedValue();
    });
  }
};

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

  const containers = document.querySelectorAll('.settings-categories, .trans-cfg-status-bar');
  containers.forEach(el => {
    el.addEventListener('wheel', scrollWheel, { passive: false });
  });
}

// ----------------- HUD Statistics Poll & Telemetry Popover -----------------

// Centralized SVG templates for HUD metrics
const HUD_METRIC_ICONS = {
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  ram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/><path d="M2 5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z"/><path d="M6 7v4"/><path d="M10 7v4"/><path d="M14 7v4"/><path d="M18 7v4"/></svg>',
  gpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/><path d="M6 2v4"/><path d="M18 2v4"/></svg>'
};

/**
 * Pure parser for RAM usage string from backend
 * e.g. "4.2GB / 16.0GB" or "4.2 / 16.0"
 */
function parseRamStatsString(ramStr) {
  if (!ramStr || typeof ramStr !== 'string') {
    return { percent: 0, formatted: '0.0GB / 0.0GB', isValid: false };
  }
  const ramMatch = ramStr.match(/([\d.]+)\s*(?:GB)?\s*\/\s*([\d.]+)\s*(?:GB)?/i);
  if (ramMatch) {
    const used = parseFloat(ramMatch[1]);
    const total = parseFloat(ramMatch[2]);
    if (total > 0) {
      const percent = Math.min(Math.max((used / total) * 100, 0), 100);
      return { percent, formatted: ramStr.trim(), isValid: true };
    }
  }
  return { percent: 0, formatted: ramStr.trim(), isValid: false };
}

/**
 * Pure parser for GPU usage string from backend
 * e.g. "NVIDIA GeForce RTX 4090: 24.5%" or "N/A" or "Active"
 */
function parseGpuStatsString(gpuStr) {
  if (!gpuStr || typeof gpuStr !== 'string' || gpuStr.includes('N/A')) {
    return { percent: 0, hasPercent: false, isAvailable: false, raw: 'N/A' };
  }
  const gpuMatch = gpuStr.match(/(\d+(?:\.\d+)?)\s*%/);
  if (gpuMatch) {
    const percent = Math.min(Math.max(parseFloat(gpuMatch[1]), 0), 100);
    return { percent, hasPercent: true, isAvailable: true, raw: gpuStr.trim() };
  }
  return { percent: 0, hasPercent: false, isAvailable: true, raw: gpuStr.trim() };
}

const HUD_POLL_INTERVAL_MS = 3000;
const HUD_IPC_TIMEOUT_MS = 5000;
// A poll that fails/hangs still cycles every (timeout + interval); allow ~2 full
// dead cycles before flagging the cache as stale.
const HUD_STALE_AFTER_MS = (HUD_IPC_TIMEOUT_MS + HUD_POLL_INTERVAL_MS) * 2;

let _currentHoveredMetric = null;

let _lastHudPollTimestamp = 0;

function setTelemetryBarState(barEl, percent, opts = {}) {
  if (!barEl) return;
  const clamped = Math.min(Math.max(percent, 0), 100);
  barEl.style.width = `${clamped.toFixed(1)}%`;
  const level = opts.disabled ? 'disabled'
    : opts.stale ? 'stale'
    : clamped > (opts.hotAt ?? 85) ? 'hot'
    : clamped > (opts.warmAt ?? 60) ? 'warm' : '';
  barEl.className = 'telemetry-bar-fill ' + level;
}

function updateTelemetryPopoverContent(metricType) {
  const popover = document.getElementById('hud-telemetry-popover');
  if (!popover) return;

  const iconEl = document.getElementById('telemetry-icon');
  const titleEl = popover.querySelector('.telemetry-title');
  const valEl = popover.querySelector('.telemetry-main-value');
  const descEl = popover.querySelector('.telemetry-stat-desc');
  const subtextEl = popover.querySelector('.telemetry-subtext');
  const barEl = popover.querySelector('.telemetry-bar-fill');
  const badgeEl = popover.querySelector('.telemetry-badge');
  const isStale = _lastHudPollTimestamp > 0 && (Date.now() - _lastHudPollTimestamp > HUD_STALE_AFTER_MS);

  if (iconEl && HUD_METRIC_ICONS[metricType]) {
    iconEl.innerHTML = HUD_METRIC_ICONS[metricType];
  }

  if (metricType === 'cpu') {
    const cpuVal = _lastHudCpu >= 0 ? Math.min(Math.max(_lastHudCpu, 0), 100) : 0;
    if (titleEl) titleEl.textContent = 'CPU Processing Unit';
    if (valEl) valEl.textContent = `${cpuVal.toFixed(1)}%`;
    if (descEl) descEl.textContent = 'Active Load';
    if (subtextEl) subtextEl.textContent = isStale ? 'Telemetry paused (stale cache)' : 'Real-time multi-core processor usage';
    setTelemetryBarState(barEl, cpuVal, { stale: isStale });
    if (badgeEl) {
      badgeEl.textContent = isStale ? 'Cached' : (cpuVal > 85 ? 'Heavy Load' : cpuVal > 60 ? 'Elevated' : 'Optimal');
      badgeEl.className = 'telemetry-badge ' + (isStale ? 'warm' : (cpuVal > 85 ? 'hot' : cpuVal > 60 ? 'warm' : ''));
    }
  } else if (metricType === 'ram') {
    const { percent: ramPercent, formatted: ramFormatted } = parseRamStatsString(_lastHudRamStr);
    if (titleEl) titleEl.textContent = 'System Memory';
    if (valEl) valEl.textContent = `${ramPercent.toFixed(1)}%`;
    if (descEl) descEl.textContent = ramFormatted || 'RAM Allocated';
    if (subtextEl) subtextEl.textContent = isStale ? 'Telemetry paused (stale cache)' : 'Physical RAM allocated across running apps';
    setTelemetryBarState(barEl, ramPercent, { stale: isStale, warmAt: 70 });
    if (badgeEl) {
      badgeEl.textContent = isStale ? 'Cached' : (ramPercent > 85 ? 'Critical' : ramPercent > 70 ? 'High' : 'Optimal');
      badgeEl.className = 'telemetry-badge ' + (isStale ? 'warm' : (ramPercent > 85 ? 'hot' : ramPercent > 70 ? 'warm' : ''));
    }
  } else if (metricType === 'gpu') {
    const gpuInfo = parseGpuStatsString(_lastHudGpuStr);
    if (titleEl) titleEl.textContent = 'Graphics Engine';
    if (valEl) valEl.textContent = !gpuInfo.isAvailable ? 'N/A' : (gpuInfo.hasPercent ? `${gpuInfo.percent.toFixed(1)}%` : 'Active');
    if (descEl) descEl.textContent = !gpuInfo.isAvailable ? 'Not Available' : gpuInfo.raw;
    if (subtextEl) subtextEl.textContent = isStale ? 'Telemetry paused (stale cache)' : (!gpuInfo.isAvailable ? 'Hardware acceleration unavailable' : 'GPU acceleration & AI compute load');
    if (barEl) {
      if (!gpuInfo.isAvailable || !gpuInfo.hasPercent) {
        setTelemetryBarState(barEl, 0, { disabled: true });
      } else {
        setTelemetryBarState(barEl, gpuInfo.percent, { stale: isStale });
      }
    }
    if (badgeEl) {
      badgeEl.textContent = isStale ? 'Cached' : (!gpuInfo.isAvailable ? 'Offline' : (!gpuInfo.hasPercent ? 'Active' : (gpuInfo.percent > 85 ? 'High Load' : 'Optimal')));
      badgeEl.className = 'telemetry-badge ' + (isStale ? 'warm' : (!gpuInfo.isAvailable ? 'warm' : (gpuInfo.hasPercent && gpuInfo.percent > 85 ? 'hot' : '')));
    }
  }
}

function showTelemetryPopover(targetEl, metricType) {
  const popover = document.getElementById('hud-telemetry-popover');
  if (!popover || !targetEl) return;
  _currentHoveredMetric = metricType;
  
  targetEl.setAttribute('aria-expanded', 'true');
  popover.setAttribute('aria-hidden', 'false');
  updateTelemetryPopoverContent(metricType);
  popover.classList.add('visible');
  
  // Calculate position dynamically with Viewport Clamping
  const rect = targetEl.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const popoverWidth = popoverRect.width || 240;
  const popoverHeight = popoverRect.height || 110;
  
  let left = rect.right + 14;
  if (left + popoverWidth > window.innerWidth - 12) {
    left = Math.max(12, rect.left - popoverWidth - 14);
  }
  
  let top = rect.top + (rect.height / 2) - (popoverHeight / 2);
  top = Math.max(12, Math.min(top, window.innerHeight - popoverHeight - 12));
  
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
}

function hideTelemetryPopover(targetEl) {
  const popover = document.getElementById('hud-telemetry-popover');
  if (popover) {
    popover.classList.remove('visible');
    popover.setAttribute('aria-hidden', 'true');
  }
  if (targetEl && typeof targetEl.setAttribute === 'function') {
    targetEl.setAttribute('aria-expanded', 'false');
  } else {
    document.querySelectorAll('.hud-metric-row').forEach(row => row.setAttribute('aria-expanded', 'false'));
  }
  _currentHoveredMetric = null;
}

window.initHudTelemetryPopover = function() {
  const metricConfigs = [
    { el: document.getElementById('hud-metric-cpu'), type: 'cpu' },
    { el: document.getElementById('hud-metric-ram'), type: 'ram' },
    { el: document.getElementById('hud-metric-gpu'), type: 'gpu' }
  ];

  metricConfigs.forEach(({ el, type }) => {
    if (!el) return;
    el.addEventListener('mouseenter', () => showTelemetryPopover(el, type));
    el.addEventListener('mouseleave', () => hideTelemetryPopover(el));
    el.addEventListener('focusin', () => showTelemetryPopover(el, type));
    el.addEventListener('focusout', () => hideTelemetryPopover(el));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideTelemetryPopover(el);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showTelemetryPopover(el, type);
      }
    });
  });
};

let _hudTimeout = null;
let _isHudPolling = false;
let _lastHudCpu = -1;
let _lastHudRamStr = '';
let _lastHudGpuStr = '';

function stopHudPoll() {
  if (_hudTimeout) {
    clearTimeout(_hudTimeout);
    _hudTimeout = null;
  }
  _isHudPolling = false;
}

function scheduleNextHudPoll(delayMs = HUD_POLL_INTERVAL_MS) {
  if (_hudTimeout) {
    clearTimeout(_hudTimeout);
    _hudTimeout = null;
  }
  _hudTimeout = setTimeout(pollHudStats, delayMs);
}

function invokeWithTimeout(cmd, args, timeoutMs = HUD_IPC_TIMEOUT_MS) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`IPC Timeout after ${timeoutMs}ms for ${cmd}`)), timeoutMs);
  });
  return Promise.race([invoke(cmd, args), timeoutPromise]).finally(() => clearTimeout(timerId));
}

async function pollHudStats() {
  if (document.hidden) {
    stopHudPoll();
    return;
  }
  if (_isHudPolling) return;
  _isHudPolling = true;

  try {
    const stats = await invokeWithTimeout('get_system_stats');
    if (stats) {
      _lastHudPollTimestamp = Date.now();
      // 1. Update CPU only if changed
      const cpuVal = typeof stats.cpu === 'number' ? stats.cpu : parseFloat(stats.cpu) || 0;
      if (Math.abs(cpuVal - _lastHudCpu) > 0.05) {
        _lastHudCpu = cpuVal;
        const cpuEl = document.getElementById('stat-cpu');
        const cpuBarEl = document.getElementById('stat-cpu-bar');
        const cpuTrackEl = document.getElementById('stat-cpu-track');
        const clampedCpu = Math.min(Math.max(cpuVal, 0), 100);
        
        if (cpuEl) {
          cpuEl.textContent = `${cpuVal.toFixed(1)}%`;
          cpuEl.className = 'metric-value ' + (cpuVal > 85 ? 'hot' : cpuVal > 60 ? 'warm' : 'active');
        }
        if (cpuBarEl) {
          cpuBarEl.style.width = `${clampedCpu.toFixed(1)}%`;
          cpuBarEl.className = 'metric-bar-fill ' + (cpuVal > 85 ? 'hot' : cpuVal > 60 ? 'warm' : '');
        }
        if (cpuTrackEl) {
          cpuTrackEl.setAttribute('aria-valuenow', clampedCpu.toFixed(1));
          cpuTrackEl.setAttribute('aria-valuetext', `${cpuVal.toFixed(1)}%`);
        }
      }
      
      // 2. Update RAM only if changed (safe against null/undefined)
      const currentRamStr = (typeof stats.ram === 'string') ? stats.ram : '';
      if (currentRamStr !== _lastHudRamStr) {
        _lastHudRamStr = currentRamStr;
        const { percent: ramPercent, formatted: ramFormatted } = parseRamStatsString(currentRamStr);
        const ramEl = document.getElementById('stat-ram');
        const ramBarEl = document.getElementById('stat-ram-bar');
        const ramTrackEl = document.getElementById('stat-ram-track');
        
        if (ramEl) {
          ramEl.textContent = `${ramPercent.toFixed(1)}%`;
          ramEl.className = 'metric-value ' + (ramPercent > 85 ? 'hot' : ramPercent > 70 ? 'warm' : 'active');
        }
        if (ramBarEl) {
          ramBarEl.style.width = `${ramPercent.toFixed(1)}%`;
          ramBarEl.className = 'metric-bar-fill ' + (ramPercent > 85 ? 'hot' : ramPercent > 70 ? 'warm' : '');
        }
        if (ramTrackEl) {
          ramTrackEl.setAttribute('aria-valuenow', ramPercent.toFixed(1));
          ramTrackEl.setAttribute('aria-valuetext', ramFormatted || `${ramPercent.toFixed(1)}%`);
        }
      }
      
      // 3. Update GPU only if changed (safe against null/undefined)
      const currentGpuStr = (typeof stats.gpu === 'string') ? stats.gpu : '';
      if (currentGpuStr !== _lastHudGpuStr) {
        _lastHudGpuStr = currentGpuStr;
        const gpuInfo = parseGpuStatsString(currentGpuStr);
        const gpuEl = document.getElementById('stat-gpu');
        const gpuBarEl = document.getElementById('stat-gpu-bar');
        const gpuTrackEl = document.getElementById('stat-gpu-track');
        
        if (gpuEl) {
          gpuEl.textContent = !gpuInfo.isAvailable ? 'N/A' : (gpuInfo.hasPercent ? `${gpuInfo.percent.toFixed(1)}%` : 'Active');
          gpuEl.className = 'metric-value ' + (!gpuInfo.isAvailable ? '' : (gpuInfo.hasPercent && gpuInfo.percent > 85 ? 'hot' : gpuInfo.percent > 60 ? 'warm' : 'active'));
        }
        if (gpuBarEl) {
          if (!gpuInfo.isAvailable || !gpuInfo.hasPercent) {
            gpuBarEl.style.width = '0%';
            gpuBarEl.className = 'metric-bar-fill disabled';
          } else {
            gpuBarEl.style.width = `${gpuInfo.percent.toFixed(1)}%`;
            gpuBarEl.className = 'metric-bar-fill ' + (gpuInfo.percent > 85 ? 'hot' : gpuInfo.percent > 60 ? 'warm' : '');
          }
        }
        if (gpuTrackEl) {
          gpuTrackEl.setAttribute('aria-valuenow', gpuInfo.percent.toFixed(1));
          gpuTrackEl.setAttribute('aria-valuetext', gpuInfo.raw);
        }
      }

      // 4. Live update currently hovered telemetry card if visible
      if (_currentHoveredMetric) {
        updateTelemetryPopoverContent(_currentHoveredMetric);
      }
    }
  } catch (e) {
    console.error("Failed to query system stats:", e);
  } finally {
    _isHudPolling = false;
    if (!document.hidden) {
      scheduleNextHudPoll(HUD_POLL_INTERVAL_MS);
    }
  }
}

function startHudPoll() {
  if (_hudTimeout || _isHudPolling) return;
  pollHudStats();
}

// Automatically pause HUD polling when app is minimized/hidden to save CPU
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopHudPoll();
  } else {
    startHudPoll();
  }
});

async function initApp() {
  console.log("Whisper Manager Desktop UI Initialized!");
  
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
  
  // Start HUD polling
  startHudPoll();
  
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
  
  // Setup Dashboard drag & drop
  setupDashboardDragAndDrop();
  
  // Setup responsive menu fade-in on window re-expand
  setupResponsiveMenuFadeIn();
  
  // Setup horizontal scroll on tab bars for narrow windows
  setupHorizontalTabScroll();
  
  // Setup rich floating HUD telemetry popover
  initHudTelemetryPopover();
  
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

  // Switch to default intro view
  switchView('intro');
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
  
  // Update Title
  const titleMap = {
    'intro': 'Dashboard',
    'settings': 'Configuration Grid',
    'models': 'Model Hub',
    'transcribe': 'Transcribe File',
    'hardsub': 'Hardsub Video Studio',
    'logs': 'Central Logging Center'
  };
  document.getElementById('current-view-title').textContent = titleMap[viewName] || 'Whisper Manager';

  if (viewName === 'models') {
    // Always reset to Recommended tab when entering the view
    currentCategoryFilter = 'recommended';
    const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    const recommendedBtn = document.getElementById('model-cat-recommended');
    if (recommendedBtn) recommendedBtn.classList.add('active');
    loadModelStatusesGrid();
  }

  // Re-trigger slide-in animation for sidebar category buttons
  // (elements were hidden via display:none parent panel, so CSS animation never fired)
  if (viewName === 'settings') {
    reanimateSlideIn('.settings-categories .settings-cat-btn', 0.03);
  }
  if (viewName === 'models') {
    reanimateSlideIn('#model-categories-sidebar .settings-cat-btn', 0.03);
  }
};

function reanimateSlideIn(selector, stagger = 0.03) {
  const items = document.querySelectorAll(selector);
  if (items.length === 0) return;
  items.forEach(item => {
    item.style.animation = 'none';
  });
  // Flush single layout recalculation on parent instead of every item
  if (items[0].parentElement) {
    void items[0].parentElement.offsetWidth;
  }
  items.forEach((item, index) => {
    item.style.animation = '';
    item.style.animationDelay = `${(index * stagger).toFixed(2)}s`;
  });
}


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
    
    const fillBar = document.getElementById('progress-linear-fill');
    const pctEl = document.getElementById('lbl-radial-pct');
    const msgEl = document.getElementById('lbl-radial-msg');
    const pulseDot = document.getElementById('hud-pulse-dot');
    
    const pct = (payload.progress * 100).toFixed(0);
    
    if (fillBar) fillBar.style.width = `${pct}%`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (msgEl) msgEl.textContent = payload.message;
    
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
    const fillBar = document.getElementById('progress-linear-fill');
    const pctEl = document.getElementById('lbl-radial-pct');
    const msgEl = document.getElementById('lbl-radial-msg');
    const pulseDot = document.getElementById('hud-pulse-dot');

    const progressVal = (payload && typeof payload.progress === 'number') ? payload.progress : 0;
    const pct = Math.min(100, Math.max(0, Math.round(progressVal * 100)));

    if (fillBar) fillBar.style.width = payload.active ? `${pct}%` : (progressVal >= 1 ? '100%' : '0%');
    if (pctEl) pctEl.textContent = payload.active ? `${pct}%` : (progressVal >= 1 ? '100%' : '0%');
    if (msgEl && payload.message) msgEl.textContent = payload.message;

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
      // CSS.escape prevents selector breakage from quotes/brackets in names
      const card = document.querySelector(`[data-model="${CSS.escape(payload.modelName)}"]`);
      if (!card) return;

      const pct = Math.min(100, Math.round((payload.progress || 0) * 100));
      const dlMB = ((payload.downloadedBytes || 0) / 1048576).toFixed(0);
      const totalMB = ((payload.totalBytes || 0) / 1048576).toFixed(0);
      const totalKnown = payload.totalBytes > 0;

      // Backend speed is authoritative — no client-side delta math.
      let speedText = payload.phase === 'starting' ? 'Connecting...' : '';
      if (!speedText) {
        if (payload.speedBps > 0) {
          const speedMbps = ((payload.speedBps * 8) / 1e6).toFixed(1);
          speedText = `${speedMbps} Mbps`;
          if (totalKnown && payload.downloadedBytes <= payload.totalBytes) {
            const remainingSeconds = Math.round((payload.totalBytes - payload.downloadedBytes) / payload.speedBps);
            speedText += ` • ETA: ${formatRemainingTime(remainingSeconds)}`;
          }
        } else {
          speedText = (payload.downloadedBytes || 0) > 0 ? '...' : 'Starting...';
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
        const isQuant = payload.modelName.includes("-q");
        descEl.innerHTML = `
          <span class="model-badge badge-downloading">Downloading</span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span>Expected Size: ${totalMB} MB</span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span style="color: ${isQuant ? 'var(--color-cyan)' : 'var(--color-royal-blue)'}; font-weight: 500;">
            ${isQuant ? 'Quantized Optimized (5-bit/8-bit)' : 'Full Precision (16-bit)'}
          </span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span style="color: var(--color-cyan);">${dlMB} MB${totalKnown ? ` (${pct}%)` : ''} • Speed: ${speedText}</span>
        `;
      }

      // 3. Ensure button is "Pause" in-place
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl && !ctrlEl.querySelector('[data-action="pause"]')) {
        ctrlEl.innerHTML = `<button class="btn-secondary" style="border-color: var(--color-gold); color: var(--color-gold); margin: 0; padding: 6px 14px; font-size: 0.8rem;" data-action="pause">Pause</button>`;
      }
      // If card is NOT in current view/tab, do NOTHING to prevent tab re-rendering!
    } else {
      // paused / completed / failed -> Reload grid state once
      loadModelStatusesGrid(true);
      if (payload.phase === 'failed') {
        showNotification(`Model download failed: ${payload.error || 'unknown error'}`, "error");
      } else if (payload.phase === 'completed') {
        showNotification(`Finished downloading ggml-${payload.modelName}.bin successfully!`, "success");
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

// ----------------- System Build Panel -----------------
function updateDashboardBackendTiles() {
  const backends = ['Standard', 'Vulkan', 'OpenVINO', 'CUDA'];
  const active = settingsState ? settingsState.selectedBackend : 'Standard';
  
  const statusEl = document.getElementById('shortcut-backend-status');
  if (statusEl) {
    statusEl.textContent = `Active Backend: ${active === 'Standard' ? 'CPU' : active}`;
  }
  
  backends.forEach(b => {
    const tile = document.getElementById(`tile-${b}`);
    if (tile) {
      tile.classList.remove('compiled', 'active-backend');
      
      const isCompiled = compiledBackends[b];
      if (isCompiled) {
        tile.classList.add('compiled');
      }
      
      if (active === b) {
        tile.classList.add('active-backend');
      }
    }
  });
}

window.dashboardSelectBackend = function(backend) {
  const isCompiled = compiledBackends[backend];
  if (!isCompiled) {
    showNotification(`The selected backend (${backend === 'Standard' ? 'CPU' : backend}) precompiled binary was not found in resources.`, "error");
    return;
  }
  
  if (settingsState) {
    settingsState.selectedBackend = backend;
    saveCurrentSettings();
    scanAndPopulateModels();
    
    // Sync dropdown in settings page
    const dropdown = document.getElementById('opt-selectedBackend');
    if (dropdown) {
      dropdown.value = backend;
      if (window.syncCustomSelects) {
        window.syncCustomSelects();
      }
    }
  }
  
  updateDashboardBackendTiles();
  showNotification(`Active backend switched to ${backend === 'Standard' ? 'CPU' : backend} successfully!`, "success");
};

window.selectBackend = function(backend, isInitialSelection = false) {
  if (!isInitialSelection && settingsState) {
    settingsState.selectedBackend = backend;
    saveCurrentSettings();
    scanAndPopulateModels();
  }
  updateDashboardBackendTiles();
};

async function refreshBuildStatuses() {
  const backends = ['Standard', 'Vulkan', 'OpenVINO', 'CUDA'];
  for (const b of backends) {
    let isCompiled = false;
    try {
      isCompiled = await invoke('check_build', { backend: b });
    } catch (e) {
      console.error(`Failed to check build for ${b}:`, e);
    }
    compiledBackends[b] = isCompiled;
  }
  updateTranscribeUIConfigs();
  updateDashboardBackendTiles();
}

window.browseModelsDirectory = async function() {
  const path = await invoke('select_directory');
  if (path) {
    const inputEl = document.getElementById('opt-modelsDir');
    if (inputEl) {
      inputEl.value = path;
    }
    if (settingsState) {
      settingsState.modelsDir = path;
      saveCurrentSettings();
      scanAndPopulateModels();
    }
    await refreshBuildStatuses();
  }
};

// ----------------- Settings Configuration Panel -----------------
window.switchSettingsCategory = function(catName) {
  activeSettingsCat = catName;
  
  // Toggle active category tabs
  const tabs = document.querySelectorAll('.settings-cat-btn');
  tabs.forEach(tab => {
    tab.classList.remove('active');
    if (tab.id === `cat-btn-${catName}`) {
      tab.classList.add('active');
    }
  });
  
  // Toggle active groups
  const groups = document.querySelectorAll('.settings-group');
  groups.forEach(group => {
    group.classList.remove('active');
  });
  
  const targetGroup = document.getElementById(`group-${catName}`);
  if (targetGroup) {
    targetGroup.classList.add('active');

    // Replay the staggered cascade animation for the now-visible cards.
    // The base .setting-card animation only runs once at load (and is skipped
    // for cards inside a display:none group at that time), so we re-trigger it
    // per category to keep the nice intro without leaving any card stuck at
    // opacity:0.
    const cards = targetGroup.querySelectorAll('.setting-card');
    if (cards.length > 0) {
      cards.forEach(card => card.classList.remove('setting-card-anim'));
      void targetGroup.offsetWidth; // single layout flush on targetGroup
      cards.forEach((card, idx) => {
        card.classList.add('setting-card-anim');
        card.style.animationDelay = `${(idx * 0.03).toFixed(2)}s`;
      });
    }

    // Re-sync any custom dropdowns living inside this group so they recompute
    // their size/position now that the group is visible.
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  }
};

async function refreshSettings() {
  try {
    settingsState = await invoke('load_settings');
    
    // Set models dir input
    const inputEl = document.getElementById('opt-modelsDir');
    if (inputEl) {
      inputEl.value = settingsState.modelsDir;
    }
    
    // Bind all options dynamically
    bindSettingsToDOM();
    
    // Scan models path
    await scanAndPopulateModels();
  } catch (e) {
    showNotification("Failed to load settings. Starting with default configuration.", "error");
  }
}

function bindSettingsToDOM() {
  if (!settingsState) return;

  // Initialize AI translation elements
  if (typeof populateProvidersDropdown === 'function') {
    populateProvidersDropdown();
    onProviderChanged();
  }
  
  if (typeof toggleTranslationSubSettingsVisibility === 'function') {
    toggleTranslationSubSettingsVisibility();
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
          if (key === 'translateAiEnabled' && typeof toggleTranslationSubSettingsVisibility === 'function') {
            toggleTranslationSubSettingsVisibility();
          }
        };
      } else if (el.tagName === 'SELECT' || el.type === 'text' || el.type === 'number') {
        el.value = settingsState[key];
        el.onchange = () => {
          let val = el.value;
          if (el.type === 'number') {
            val = parseFloat(el.value);
            if ((key === 'bestOf' || key === 'beamSize') && val > 8) {
              val = 8;
              el.value = 8;
              showNotification("Whisper limits decoding decoders to a maximum of 8 to prevent allocation crashes.", "info");
            }
            if ((key === 'bestOf' || key === 'beamSize') && val < 1) {
              val = 1;
              el.value = 1;
            }
          }
          settingsState[key] = val;
          saveCurrentSettings();
          
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
        };
      }
    }
  });
  
  // Update build selection card highlight based on settings backend
  selectBackend(settingsState.selectedBackend, true);
  
  // Update FFmpeg engine status badge (passive initial check)
  refreshFFmpegStatus(settingsState.ffmpegSource, false);

  // Sync custom dropdown views
  if (window.syncCustomSelects) {
    window.syncCustomSelects();
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
      badgeEl.title = `Source: ${info.configuredSource}\nPath: ${info.resolvedPath}\n${info.version}`;
    } else {
      badgeEl.className = 'setting-status-pill missing';
      badgeEl.innerHTML = `<span class="ffmpeg-status-dot red"></span> Not Found`;
      badgeEl.title = info.errorMessage || 'FFmpeg binary was not found';
      if (currentSource === 'system' && userInitiated) {
        showNotification("Warning: System FFmpeg was not found in PATH. Media tasks will fail until FFmpeg is installed or switched to Internal mode.", "warning");
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

async function saveCurrentSettings() {
  if (!settingsState) return;
  try {
    await invoke('save_settings', { settings: settingsState });
    updateTranscribeUIConfigs();
  } catch (e) {
    showNotification("Failed to save settings. Check disk space and file permissions.", "error");
  }
}

window.incrementNumber = function(inputId, step) {
  const el = document.getElementById(inputId);
  if (el) {
    let val = parseInt(el.value) || 0;
    val += step;
    
    // Clamp constraints
    if ((inputId === 'opt-bestOf' || inputId === 'opt-beamSize') && val > 8) {
      val = 8;
      showNotification("Whisper limits decoding decoders to a maximum of 8 to prevent allocation crashes.", "info");
    }
    
    el.value = val;
    
    const key = inputId.replace('opt-', '');
    if (settingsState && key in settingsState) {
      settingsState[key] = val;
      saveCurrentSettings();
    }
  }
};

window.decrementNumber = function(inputId, step) {
  const el = document.getElementById(inputId);
  if (el) {
    let val = parseInt(el.value) || 0;
    val -= step;
    
    // Clamp constraints
    if (inputId === 'opt-threads' && val < 1) val = 1;
    if (inputId === 'opt-processors' && val < 1) val = 1;
    if (inputId === 'opt-deviceId' && val < 0) val = 0;
    if ((inputId === 'opt-bestOf' || inputId === 'opt-beamSize') && val < 1) val = 1;
    
    el.value = val;
    
    const key = inputId.replace('opt-', '');
    if (settingsState && key in settingsState) {
      settingsState[key] = val;
      saveCurrentSettings();
    }
  }
};

async function scanAndPopulateModels() {
  if (!settingsState) return;
  
  try {
    const res = await invoke('scan_models', {
      modelsDir: settingsState.modelsDir,
      backend: settingsState.selectedBackend
    });
    
    localScannedTransModels = res.transModels || [];
    
    // 1. Populate Model Selection
    const transSelect = document.getElementById('opt-modelPath');
    transSelect.innerHTML = '';
    const seenModelNames = new Set();
    let modelMatched = false;
    res.transModels.forEach(m => {
      const name = getBasename(m);
      if (name.startsWith('for-tests') || name.startsWith('No trans')) return;
      if (seenModelNames.has(name)) return;
      seenModelNames.add(name);
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = name;
      if (m === settingsState.modelPath) {
        opt.selected = true;
        modelMatched = true;
      }
      transSelect.appendChild(opt);
    });
    if (!modelMatched && transSelect.options.length > 0) {
      transSelect.selectedIndex = 0;
      settingsState.modelPath = transSelect.value;
    }
    transSelect.onchange = () => {
      settingsState.modelPath = transSelect.value;
      saveCurrentSettings();
    };

    // 2. Populate VAD Selection
    const vadSelect = document.getElementById('opt-vadModel');
    vadSelect.innerHTML = '';
    const validVadModels = (res.vadModels || []).filter(m => m !== 'No VAD models found');
    let vadMatched = false;
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
    };

    // Save state if auto-selected
    if ((!modelMatched && transSelect.options.length > 0) || (!vadMatched && validVadModels.length > 0)) {
      await saveCurrentSettings();
    }
    
    // Sync custom dropdown views
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  } catch (e) {
    console.error("Failed to scan models directory:", e);
  }
}

window.browseFontFile = async function() {
  const file = await invoke('select_file');
  if (file) {
    document.getElementById('opt-fontPath').value = file;
    if (settingsState) {
      settingsState.fontPath = file;
      saveCurrentSettings();
    }
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
    showNotification("Cannot select files while batch extraction is active.", "info");
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
      document.getElementById('lbl-file-name').textContent = getBasename(selectedMediaFile);
      document.getElementById('lbl-file-path').textContent = selectedMediaFile;
      document.getElementById('batch-queue-container').style.display = 'none';
      
      document.getElementById('media-meta-box').style.display = 'grid';
      document.getElementById('batch-specs-box').style.display = 'none';
      document.getElementById('btn-next-step-2').textContent = 'Continue to Transcription';
      
      
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
        size: 'Pending...',
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
      document.getElementById('btn-next-step-2').textContent = 'Continue to Batch Setup';
      
      
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
      document.getElementById('lbl-radial-msg').textContent = 'Ready for Transcription';
      
      setWizardStepCompleted(3, false);
      document.getElementById('analytics-box').style.display = 'none';
    } else {
      showNotification("Selected file does not exist or cannot be probed!", "error");
    }
  } catch (e) {
    console.error("Probing failed:", e);
  }
}

function updateTranscribeUIConfigs() {
  if (!settingsState) return;
  
  const backend = settingsState.selectedBackend || 'Standard';
  const backendEl = document.getElementById('trans-cfg-backend');
  if (backendEl) {
    backendEl.textContent = backend;
    backendEl.title = backend;
  }
  
  const model = getBasename(settingsState.modelPath) || 'None';
  const modelEl = document.getElementById('trans-cfg-model');
  if (modelEl) {
    modelEl.textContent = model;
    modelEl.title = model;
  }
  
  const vad = settingsState.vad ? 'ON' : 'OFF';
  const vadEl = document.getElementById('trans-cfg-vad');
  if (vadEl) {
    vadEl.textContent = vad;
    vadEl.className = settingsState.vad ? 'val-gold' : 'val-muted';
    vadEl.title = settingsState.vad ? `VAD Active (${settingsState.vadModel || 'Default'})` : 'VAD Disabled';
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
}

window.runWhisperTranscription = async function() {
  const btn = document.getElementById('btn-run-transcribe');
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const fillBar = document.getElementById('progress-linear-fill');
  const pctEl = document.getElementById('lbl-radial-pct');
  const msgEl = document.getElementById('lbl-radial-msg');
  const pulseDot = document.getElementById('hud-pulse-dot');

  if (!selectedMediaFile && !wavPathForTranscription) {
    showNotification("No media file selected!", "info");
    return;
  }

  const isCompiled = compiledBackends[settingsState.selectedBackend];
  if (!isCompiled) {
    showNotification(`The selected backend (${settingsState.selectedBackend}) precompiled binary was not found in resources! Please choose a different backend in the configuration.`, "error");
    switchView('settings');
    return;
  }

  const modelExists = localScannedTransModels.includes(settingsState.modelPath);
  if (!modelExists) {
    const modelName = getBasename(settingsState.modelPath) || 'selected model';
    showNotification(`The selected model file '${modelName}' does not exist locally. Please select a valid model in General Configuration!`, "error");
    return;
  }

  btn.disabled = true;
  document.getElementById('analytics-box').style.display = 'none';

  // Clear transcript preview
  transcriptLines = [];
  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = '<div style="color: var(--color-cyan); text-align: center; margin-top: 40px; font-weight: 500;">AI model is initializing...</div>';
  }

  try {
    // Phase 1: Auto-convert to WAV if not already done
    if (!wavPathForTranscription) {
      btn.textContent = 'Converting to WAV...';
      if (msgEl) msgEl.textContent = 'Converting audio to 16kHz WAV...';
      if (fillBar) {
        fillBar.style.width = '50%';
        fillBar.classList.add('indeterminate');
      }
      if (pctEl) pctEl.textContent = 'Converting...';

      wavPathForTranscription = await invoke('convert_media_file', { filePath: selectedMediaFile });

      if (fillBar) fillBar.classList.remove('indeterminate');
      if (msgEl) msgEl.textContent = 'WAV Ready! Transcribing...';
    }

    // Phase 2: Run Whisper transcription
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    btn.textContent = 'AI Transcribing...';

    const result = await invoke('start_transcription_task', {
      settings: settingsState,
      wavPath: wavPathForTranscription,
      durationSec: probedMetadata ? probedMetadata.durationSec : 60.0
    });

    // Load final transcript from the text file
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      const parentDir = settingsState.inputFile.substring(0, settingsState.inputFile.lastIndexOf('/'));
      const txtFile = result.generatedFiles.find(f => f.endsWith('.txt'));
      if (txtFile) {
        await loadTranscriptFromFile(`${parentDir}/${txtFile}`);
      }
    }

    document.getElementById('analytics-box').style.display = 'flex';
    document.getElementById('analytic-time').textContent = `${(result.durationMs / 1000).toFixed(1)}s`;
    document.getElementById('analytic-speed').textContent = `${result.speedFactor.toFixed(1)}x Real-time`;

    const badgesRow = document.getElementById('badge-outputs-row');
    badgesRow.innerHTML = '';
    result.generatedFiles.forEach(f => {
      const badge = document.createElement('span');
      badge.className = 'output-badge';
      badge.textContent = f;
      badgesRow.appendChild(badge);
    });

    // Mark Step 3 as completed and notify user immediately when transcription succeeds
    setWizardStepCompleted(3, true);
    showNotification("Transcription completed successfully!", "success");

    // Run AI Translation if enabled
    if (settingsState.translateAiEnabled && result.generatedFiles && result.generatedFiles.length > 0) {
      try {
        const parentDir = settingsState.inputFile.substring(0, settingsState.inputFile.lastIndexOf('/'));
        btn.textContent = 'AI Translating...';
        showNotification("Starting AI translation of generated files...", "info");

        const translatedFiles = await invoke('translate_transcription_files', {
          settings: settingsState,
          generatedFiles: result.generatedFiles,
          parentDir: parentDir
        });

        translatedFiles.forEach(f => {
          const badge = document.createElement('span');
          badge.className = 'output-badge';
          badge.textContent = f;
          badgesRow.appendChild(badge);
        });

        showNotification("AI translation completed successfully!", "success");
      } catch (err) {
        const errMsg = (typeof err === 'string') ? err : (err && err.toString ? err.toString() : '');
        if (errMsg.toLowerCase().includes('cancelled')) {
          // Bubble up to outer catch so it shows the proper "cancelled" message
          // and marks the step as incomplete.
          throw err;
        } else {
          showNotification("AI translation failed: " + errMsg, "error");
        }
      }
    }
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    setWizardStepCompleted(3, false);
    if (errMsg.toLowerCase().includes('cancelled by the user') || errMsg.toLowerCase().includes('was cancelled by the user')) {
      showNotification("Transcription cancelled by the user.", "info");
      if (msgEl) msgEl.textContent = 'Cancelled';
    } else {
      showNotification("Transcription failed: " + errMsg, "error");
      if (msgEl) msgEl.textContent = 'Task Failed';
    }
  } finally {
    // ALWAYS clear the temporary WAV state since it has been cleaned up by the backend
    wavPathForTranscription = null;
    btn.disabled = false;
    btn.textContent = 'Start AI Extraction';
    if (fillBar) fillBar.classList.remove('indeterminate');
    // Guarantee the HUD pulse dot can never get stuck (success, error, or cancel).
    if (pulseDot) pulseDot.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.display = 'none';
    }
  }
};

window.abortTranscription = async function() {
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling...';
  }
  
  try {
    await invoke('cancel_transcription');
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    if (!errMsg.includes("No active transcription or translation session")) {
      showNotification("Failed to cancel process: " + errMsg, "error");
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
    }
  }
};

window.copyMainTranscriptToClipboard = async function() {
  if (!selectedMediaFile) {
    showNotification("No media file selected or transcribed yet.", "info");
    return;
  }
  
  const base = selectedMediaFile.substring(0, selectedMediaFile.lastIndexOf('.')) || selectedMediaFile;
  const txtFile = `${base}.txt`;
  
  try {
    const content = await invoke('read_text_file_content', { filePath: txtFile });
    await copyToClipboard(content);
    showNotification("Transcription text copied to clipboard successfully!", "success");
  } catch (e) {
    // Fallback: copy Whisper logs
    const fallback = allLogsArray
      .filter(l => l.category === 'Whisper')
      .map(l => l.message)
      .join('\n');
    if (fallback) {
      try {
        await copyToClipboard(fallback);
        showNotification("Transcript file not found; copied log output instead.", "info");
      } catch (e2) {
        const msg = (e2 && (e2.message || e2.toString())) || String(e2);
        showNotification("Failed to copy transcript: " + msg, "error");
      }
    } else {
      const msg = (e && (e.message || e.toString())) || String(e);
      showNotification("Failed to copy transcript: " + msg, "error");
    }
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
  
  // Toggle visibility instead of rebuilding DOM
  const logLines = document.querySelectorAll('#log-viewport .log-line');
  logLines.forEach(el => {
    if (activeLogCategory === 'All' || (el.dataset.category && el.dataset.category === activeLogCategory)) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
};

window.handleLogSearch = function() {
  logSearchQuery = document.getElementById('log-search').value.toLowerCase();
  
  // Toggle visibility instead of rebuilding DOM
  const logLines = document.querySelectorAll('#log-viewport .log-line');
  logLines.forEach(el => {
    const msgEl = el.querySelector('.log-msg');
    if (activeLogCategory !== 'All' && el.dataset.category !== activeLogCategory) {
      el.style.display = 'none';
      return;
    }
    if (logSearchQuery === '' || (msgEl && msgEl.textContent.toLowerCase().includes(logSearchQuery))) {
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
};

function redrawLogsViewport() {
  lastAppendedCategory = null;
  const viewport = document.getElementById('log-viewport');
  viewport.innerHTML = '';
  
  allLogsArray.forEach(payload => {
    appendLogToViewport(payload);
  });
}

window.copyAllLogs = async function() {
  const rawLogs = allLogsArray.map(l => `[${l.timestamp}] [${l.category}] ${l.message}`).join('\n');
  try {
    await copyToClipboard(rawLogs);
    showNotification("All logs copied to clipboard!", "success");
  } catch (e) {
    const msg = (e && (e.message || e.toString())) || String(e);
    showNotification("Failed to copy logs: " + msg, "error");
  }
};

window.clearLogsHistory = async function() {
  const confirmed = await showConfirmModal('Clear Log History', 'Are you sure you want to clear the entire log history?', 'Clear');
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
      totalDurationEl.textContent = 'Calculating...';
    } else {
      totalDurationEl.textContent = formatDuration(totalDur) + (hasPending ? ' (calculating...)' : '');
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
  document.getElementById('lbl-file-name').textContent = 'No Media File Loaded';
  document.getElementById('lbl-file-path').textContent = 'Select audio or video file';
  document.getElementById('batch-queue-container').style.display = 'none';
  
  document.getElementById('media-meta-box').style.display = 'grid';
  document.getElementById('batch-specs-box').style.display = 'none';
  document.getElementById('btn-next-step-2').textContent = 'Continue to Transcription';
  
  
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
  
  showNotification("Batch queue cleared.", "info");
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
  showNotification("Queue sorted successfully!", "success");
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
    nameTd.title = item.path;
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
      badge.textContent = 'Pending';
    } else if (item.status === 'converting') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = 'Converting...';
    } else if (item.status === 'transcribing') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = 'Extracting...';
    } else if (item.status === 'translating') {
      badge.className = 'batch-status-badge badge-processing';
      badge.textContent = 'Translating...';
    } else if (item.status === 'completed') {
      badge.className = 'batch-status-badge badge-completed';
      badge.textContent = 'Completed';
    } else if (item.status === 'failed') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = 'Failed';
    } else if (item.status === 'aborted') {
      badge.className = 'batch-status-badge badge-failed';
      badge.textContent = 'Aborted';
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
  const cancelBtn = document.getElementById('btn-cancel-batch');
  const sortSelect = document.getElementById('batch-sort-select');
  const clearBtn = document.getElementById('btn-clear-batch');
  
  startBtn.disabled = true;
  startBtn.textContent = 'Batch Running...';
  if (sortSelect) sortSelect.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
  
  if (cancelBtn) {
    cancelBtn.style.display = 'inline-flex';
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel Batch';
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
    if (msgEl) msgEl.textContent = `[${i + 1}/${totalCount}] Converting: '${item.name}'...`;
    
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

          if (msgEl) msgEl.textContent = `[${i + 1}/${totalCount}] Extracting: '${item.name}'...`;

          // Clear transcript preview for this file
      transcriptLines = [];
      const viewport = document.getElementById('transcript-viewport');
      if (viewport) {
        viewport.innerHTML = '<div style="color: var(--color-cyan); text-align: center; margin-top: 40px; font-weight: 500;">AI model is initializing...</div>';
      }
      
      const result = await invoke('start_transcription_task', {
        settings: settingsState,
        wavPath: currentWavPath,
        durationSec: item.durationSec || 60.0
      });

      // Load final transcript from the text file
      if (result.generatedFiles && result.generatedFiles.length > 0) {
        const parentDir = settingsState.inputFile.substring(0, settingsState.inputFile.lastIndexOf('/'));
        const txtFile = result.generatedFiles.find(f => f.endsWith('.txt'));
        if (txtFile) {
          await loadTranscriptFromFile(`${parentDir}/${txtFile}`);
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
          if (msgEl) msgEl.textContent = `[${i + 1}/${totalCount}] Translating: '${item.name}'...`;
          
          const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
          const translatedFiles = await invoke('translate_transcription_files', {
            settings: settingsState,
            generatedFiles: result.generatedFiles,
            parentDir: parentDir
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
      showNotification(`Failed to process '${item.name}': ${err}`, "error");
    } finally {
      settingsState.inputFile = originalInputFile;
    }
  }
  
  // Batch processing completed
  if (fillBar) fillBar.style.width = '100%';
  if (pctEl) pctEl.textContent = '100%';
  
  if (batchCancelActive) {
    if (msgEl) msgEl.textContent = 'Batch extraction cancelled';
    showNotification("Batch extraction cancelled by the user.", "info");
  } else {
    if (msgEl) msgEl.textContent = `Completed! ${successCount}/${totalCount} files processed.`;
    showNotification(`Batch extraction completed successfully! ${successCount}/${totalCount} files processed.`, "success");
  }
  
  // Reset buttons
  startBtn.disabled = false;
  startBtn.textContent = 'Start Batch AI Extraction';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (sortSelect) sortSelect.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
  
  renderBatchQueueTable();
  
  setWizardStepCompleted(3, true);
};

window.abortBatchExtraction = async function() {
  const cancelBtn = document.getElementById('btn-cancel-batch');
  if (cancelBtn) {
    cancelBtn.disabled = true;
    cancelBtn.textContent = 'Aborting...';
  }
  
  batchCancelActive = true;
  
  try {
    // Terminate active whisper process immediately
    await invoke('cancel_transcription');
    showNotification("Cancelling active task...", "info");
  } catch (err) {
    console.error("Failed to cancel active whisper process:", err);
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.display = 'none';
    }
  }
};

// ----------------- Dashboard Interactive Drag & Drop HUD -----------------
function setupDashboardDragAndDrop() {
  const dashZone = document.getElementById('dashboard-drag-zone');
  const transZone = document.getElementById('transcribe-drop-zone');
  
  const zones = [
    { el: dashZone, labelId: 'dashboard-drag-status-text', defaultLabel: "Drag & Drop Audio/Video files here to transcribe instantly!", hoverLabel: "Drop now to transcribe!" },
    { el: transZone, labelId: null, defaultLabel: null, hoverLabel: null }
  ];
  
  zones.forEach(zone => {
    const el = zone.el;
    if (!el) return;
    
    // HTML5 Standard drag-drop events
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
      if (zone.labelId) {
        document.getElementById(zone.labelId).textContent = zone.hoverLabel;
      }
    });
    
    el.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      if (zone.labelId) {
        document.getElementById(zone.labelId).textContent = zone.defaultLabel;
      }
    });
    
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      if (zone.labelId) {
        document.getElementById(zone.labelId).textContent = zone.defaultLabel;
      }
      
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files).map(f => f.path || f.name);
        await handleDashboardDroppedFiles(files);
      }
    });
  });

  // Native Tauri drag-drop events
  if (window.__TAURI__) {
    try {
      listen('tauri://drag-over', (event) => {
        const ratio = window.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;
        
        zones.forEach(zone => {
          const el = zone.el;
          if (!el) return;
          
          const rect = el.getBoundingClientRect();
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            el.classList.add('drag-over');
            if (zone.labelId) {
              document.getElementById(zone.labelId).textContent = zone.hoverLabel;
            }
          } else {
            el.classList.remove('drag-over');
            if (zone.labelId) {
              document.getElementById(zone.labelId).textContent = zone.defaultLabel;
            }
          }
        });
      });

      listen('tauri://drag-leave', () => {
        zones.forEach(zone => {
          const el = zone.el;
          if (!el) return;
          el.classList.remove('drag-over');
          if (zone.labelId) {
            document.getElementById(zone.labelId).textContent = zone.defaultLabel;
          }
        });
      });

      listen('tauri://drag-drop', async (event) => {
        const ratio = window.devicePixelRatio || 1;
        const x = event.payload.position.x / ratio;
        const y = event.payload.position.y / ratio;
        
        zones.forEach(async (zone) => {
          const el = zone.el;
          if (!el) return;
          
          el.classList.remove('drag-over');
          if (zone.labelId) {
            document.getElementById(zone.labelId).textContent = zone.defaultLabel;
          }
          
          const rect = el.getBoundingClientRect();
          if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            const files = event.payload.paths;
            if (files && files.length > 0) {
              await handleDashboardDroppedFiles(files);
            }
          }
        });
      });
    } catch (err) {
      console.error("Failed to setup native Tauri drag-drop listeners:", err);
    }
  }
}

async function handleDashboardDroppedFiles(files) {
  const startBtn = document.getElementById('btn-run-batch');
  if (startBtn && startBtn.disabled) {
    showNotification("Cannot load dropped files while batch extraction is active.", "info");
    return;
  }
  selectedMediaFiles = files;
  
  if (files.length === 1) {
    isBatchMode = false;
    selectedMediaFile = files[0];
    
    document.getElementById('lbl-file-name').style.display = 'block';
    document.getElementById('lbl-file-path').style.display = 'block';
    document.getElementById('lbl-file-name').textContent = getBasename(selectedMediaFile);
    document.getElementById('lbl-file-path').textContent = selectedMediaFile;
    document.getElementById('batch-queue-container').style.display = 'none';
    
    document.getElementById('media-meta-box').style.display = 'grid';
    document.getElementById('batch-specs-box').style.display = 'none';
    document.getElementById('btn-next-step-2').textContent = 'Continue to Transcription';
    
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
      size: 'Pending...',
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
    document.getElementById('btn-next-step-2').textContent = 'Continue to Batch Setup';
    
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
  showNotification(`Successfully loaded ${files.length} file(s) via Drag & Drop!`, "success");
}


// ----------------- Models Logic -----------------
let currentCategoryFilter = 'recommended';

function formatRemainingTime(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

window.switchModelCategory = function(category) {
  currentCategoryFilter = category;
  
  const buttons = document.querySelectorAll('#model-categories-sidebar .settings-cat-btn');
  buttons.forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = document.getElementById(`model-cat-${category}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
  
  loadModelStatusesGrid();
};

window.loadModelStatusesGrid = async function(isSilent = false) {
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
      'nvidia': 'NVIDIA Dedicated GPU (CUDA Supported)',
      'amd': 'AMD GPU (Vulkan Supported)',
      'intel': 'Intel GPU (OpenVINO/Vulkan Supported)',
      'unknown': 'CPU Only / Undetected GPU'
    };
    const gpuName = gpuLabelMap[systemSpecs.gpu_type] || systemSpecs.gpu_type || 'Unknown GPU';
    specsSubtitle.innerHTML = `
      System detected: <strong style="color: var(--color-cyan);">${systemSpecs.total_ram_gb.toFixed(1)} GB RAM</strong>, 
      <strong style="color: var(--color-cyan);">${systemSpecs.cpu_cores} CPU Cores</strong>, 
      <strong style="color: var(--color-cyan);">${gpuName}</strong>. 
      Recommended models optimized for your hardware are highlighted below.
    `;
  }
  
  try {
    const statuses = await invoke('get_all_models_status', { modelsDir: settingsState.modelsDir });

    const grid = document.getElementById('models-list-scroll');
    if (!grid) return;
    
    const searchInput = document.getElementById('model-search');
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    
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
    
    // Determine dynamic list of recommended models based on specs and GPU
    let recList = ["tiny", "tiny.en", "base", "base.en"];
    const hasGpuAcceleration = systemSpecs.gpu_type === 'nvidia' || systemSpecs.gpu_type === 'amd' || systemSpecs.gpu_type === 'intel';
    
    if (hasGpuAcceleration) {
      if (systemSpecs.total_ram_gb >= 16.0) {
        recList = ["base", "base.en", "small", "small.en", "medium", "medium.en", "large-v3-turbo", "small-q8_0"];
      } else if (systemSpecs.total_ram_gb >= 8.0) {
        recList = ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "large-v3-turbo", "small-q8_0"];
      } else {
        recList = ["tiny", "tiny.en", "base", "base.en", "base-q8_0"];
      }
    } else {
      if (systemSpecs.total_ram_gb >= 16.0) {
        recList = ["base", "base.en", "small", "small.en", "base-q8_0", "small-q8_0"];
      } else if (systemSpecs.total_ram_gb >= 8.0) {
        recList = ["tiny", "tiny.en", "base", "base.en", "base-q8_0", "small-q8_0"];
      }
    }
    
    statuses.forEach(m => {
      if (query) {
        const fullName = `ggml-${m.name}.bin`;
        const searchTarget = `${m.name} ${fullName}`.toLowerCase();
        if (!searchTarget.includes(query)) {
          return;
        }
      }

      // EXCLUSIVE SEPARATION:
      // Downloaded models should only show in the "local" tab, and not anywhere else!
      if (currentCategoryFilter === 'local') {
        if (m.status !== 'Downloaded') return;
      } else {
        if (m.status === 'Downloaded') return;

        // When a search query is active, bypass category tabs and show all matches
        if (!query) {
          if (currentCategoryFilter === 'recommended') {
            if (!recList.includes(m.name)) return;
          } else if (currentCategoryFilter === 'tiny') {
            if (!m.name.startsWith("tiny")) return;
          } else if (currentCategoryFilter === 'base') {
            if (!m.name.startsWith("base")) return;
          } else if (currentCategoryFilter === 'small') {
            if (!m.name.startsWith("small")) return;
          } else if (currentCategoryFilter === 'medium') {
            if (!m.name.startsWith("medium")) return;
          } else if (currentCategoryFilter === 'large') {
            if (!m.name.startsWith("large")) return;
          }
        }
      }
      
      const card = document.createElement('div');
      card.className = 'setting-card';
      card.dataset.name = m.name;
      card.setAttribute('data-model', m.name);
      
      let badgeHtml = '';
      if (m.status === 'Downloading') {
        badgeHtml = `<span class="model-badge badge-downloading">${m.status}</span>`;
      } else if (m.status === 'Paused') {
        badgeHtml = `<span class="model-badge badge-paused">${m.status}</span>`;
      }
      
      let isRecommended = recList.includes(m.name);
      const sizeMB = (m.sizeBytes / 1024 / 1024).toFixed(0);
      const dlMB = (m.downloadedBytes / 1024 / 1024).toFixed(0);
      const pct = Math.round((m.progress || 0) * 100);
      let actionButtons = '';
      if (m.status === 'Downloaded') {
        actionButtons = `
          <button class="btn-secondary" style="border-color: var(--color-red); color: var(--color-red); margin: 0; padding: 6px 14px; font-size: 0.8rem;" data-action="delete">Delete</button>
        `;
      } else if (m.status === 'Downloading') {
        actionButtons = `
          <button class="btn-secondary" style="border-color: var(--color-gold); color: var(--color-gold); margin: 0; padding: 6px 14px; font-size: 0.8rem;" data-action="pause">Pause</button>
        `;
      } else if (m.status === 'Paused') {
        actionButtons = `
          <button class="btn-primary" style="margin: 0; padding: 6px 14px; font-size: 0.8rem; justify-content: center;" data-action="download">Resume</button>
          <button class="btn-secondary" style="border-color: var(--color-red); color: var(--color-red); margin: 0; padding: 6px 14px; font-size: 0.8rem;" data-action="delete">Discard</button>
        `;
      } else {
        actionButtons = `
          <button class="btn-primary" style="margin: 0; padding: 6px 14px; font-size: 0.8rem; min-width: 100px; justify-content: center;" data-action="download">Download</button>
        `;
      }
      
      const showProgressBlock = m.status === 'Downloading' || m.status === 'Paused' ? 'block' : 'none';
      const isQuant = m.name.includes("-q");
      
      let recommendedBadge = '';
      if (isRecommended) {
        let reason = "Recommended";
        if (hasGpuAcceleration && (m.name.includes("small") || m.name.includes("medium") || m.name.includes("turbo"))) {
          reason = `${systemSpecs.gpu_type.toUpperCase()} GPU Recommended`;
        } else if (m.name.includes("-q")) {
          reason = "Fast CPU Quantized";
        } else if (m.name.startsWith("tiny") || m.name.startsWith("base")) {
          reason = "Lightweight & Fast";
        }
        recommendedBadge = `<span class="model-badge" style="background: rgba(6, 182, 212, 0.08); color: var(--color-cyan); border: 1px solid rgba(6, 182, 212, 0.25); margin-right: 6px;" title="${reason}">★ ${reason}</span>`;
      }
      
      const safeName = escapeHTML(m.name);
      card.innerHTML = `
        <div class="setting-info" style="flex-grow: 1; padding-right: 20px;">
          <div class="setting-label-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="setting-title" style="font-size: 1.05rem; font-weight: 600; color: #fff;">ggml-${safeName}.bin</span>
            ${recommendedBadge}
          </div>
          <div class="setting-desc" style="font-size: 0.82rem; color: var(--color-text-muted); line-height: 1.4; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${badgeHtml}
            ${badgeHtml ? '<span style="color: rgba(255,255,255,0.1);">|</span>' : ''}
            <span>Expected Size: ${sizeMB} MB</span>
            <span style="color: rgba(255,255,255,0.1);">|</span>
            <span style="color: ${isQuant ? 'var(--color-cyan)' : 'var(--color-royal-blue)'}; font-weight: 500;">
              ${isQuant ? 'Quantized Optimized (5-bit/8-bit)' : 'Full Precision (16-bit)'}
            </span>
            ${m.status === 'Downloading' ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span style="color: var(--color-cyan);">${dlMB} MB (${pct}%) • In progress</span>
            ` : ''}
            ${m.status === 'Paused' ? `
              <span style="color: rgba(255,255,255,0.1);">|</span>
              <span style="color: var(--color-gold);">${dlMB} MB (${pct}%) • Paused</span>
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
    });
    
  } catch (err) {
    console.error("Failed to load model statuses:", err);
  }
};

window.filterModelsGrid = function() {
  loadModelStatusesGrid();
};

window.downloadModelClick = async function(name) {
  if (!settingsState || _modelActionsInProgress.has(name)) return;
  _modelActionsInProgress.add(name);
  try {
    showNotification(`Downloading ggml-${name}.bin...`, "info");
    
    // Immediate in-place button swap to Pause
    const card = document.querySelector(`[data-model="${name}"]`);
    if (card) {
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl) {
        ctrlEl.innerHTML = `<button class="btn-secondary" style="border-color: var(--color-gold); color: var(--color-gold); margin: 0; padding: 6px 14px; font-size: 0.8rem;" data-action="pause">Pause</button>`;
      }
    }

    await invoke('start_download_model_task', {
      modelsDir: settingsState.modelsDir,
      modelName: name
    });
  } catch (err) {
    showNotification("Failed to start download: " + err, "error");
    await loadModelStatusesGrid();
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

window.pauseModelClick = async function(name) {
  if (_modelActionsInProgress.has(name)) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('pause_download_model', { modelName: name });
    showNotification(`Paused ggml-${name}.bin download`, "info");
    await loadModelStatusesGrid();
  } catch (err) {
    showNotification("Failed to pause download: " + err, "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

window.deleteModelClick = async function(name) {
  if (_modelActionsInProgress.has(name)) return;
  const confirmed = await showConfirmModal(
    'Delete Model',
    `Are you sure you want to delete / discard the model ggml-${name}.bin?`
  );
  if (!confirmed) return;
  _modelActionsInProgress.add(name);
  try {
    await invoke('delete_model_file', {
      modelsDir: settingsState.modelsDir,
      modelName: name
    });
    showNotification(`Deleted ggml-${name}.bin`, "success");
    await loadModelStatusesGrid();
    // Scan configuration dropdown to sync options
    await scanAndPopulateModels();
  } catch (err) {
    showNotification("Failed to delete model: " + err, "error");
  } finally {
    _modelActionsInProgress.delete(name);
  }
};

// ----------------- Live Transcript Viewer Helper Functions -----------------
let transcriptLines = [];

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
  input.onchange = function() { updateTranscriptLineText(lineObj.id, this.value); };
  textDiv.appendChild(input);

  lineEl.appendChild(timeSpan);
  lineEl.appendChild(textDiv);
  viewport.appendChild(lineEl);
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
  if (transcriptLines && transcriptLines.length > 0) {
    const textToCopy = transcriptLines
      .map(l => l.text)
      .join('\n');
      
    try {
      await copyToClipboard(textToCopy);
      showNotification("Live transcript copied to clipboard!", "success");
      return;
    } catch (err) {
      const msg = (err && (err.message || err.toString())) || String(err);
      showNotification("Failed to copy transcript: " + msg, "error");
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
        showNotification("Transcript preview copied to clipboard!", "success");
        return;
      } catch (err) {
        const msg = (err && (err.message || err.toString())) || String(err);
        showNotification("Failed to copy transcript: " + msg, "error");
        return;
      }
    }
  }

  // If live viewer is empty, attempt to copy the main output file
  if (selectedMediaFile) {
    await window.copyMainTranscriptToClipboard();
  } else {
    showNotification("No transcript text available to copy.", "info");
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
    
    if (!keepCurrentTab) {
      switchProviderTab('providers');
    }
    
    // Load General configuration fields
    document.getElementById('mgr-provider-url').value = provider.baseUrl || provider.base_url || '';
    document.getElementById('mgr-provider-format').value = provider.apiFormat || provider.api_format || 'Chat completions';
    document.getElementById('mgr-provider-prompt').value = provider.customPrompt || provider.custom_prompt || '';
    
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
    const bannerEl = document.getElementById('active-model-banner');
    const bannerVal = document.getElementById('active-model-banner-value');
    if (bannerEl && bannerVal) {
      if (settingsState.translateAiModel) {
        bannerVal.innerHTML = `
          <div class="active-model-chip-group">
            <span class="active-model-chip-provider">${escapeHTML(providerName)}</span>
            <span class="active-model-chip-model">${escapeHTML(settingsState.translateAiModel)}</span>
          </div>
        `;
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }
    
    // Render models registry
    if (!skipTableRender) {
      renderModelsRegistryTable(provider);
    }
  } else {
    if (genPlaceholder) genPlaceholder.style.display = 'flex';
    if (genFields) genFields.style.display = 'none';
    
    if (modelsPlaceholder) modelsPlaceholder.style.display = 'flex';
    if (modelsFields) modelsFields.style.display = 'none';
    
    if (!keepCurrentTab) {
      switchProviderTab('providers');
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
        showNotification("Failed to load secure API key: " + e, "error");
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
  const btnProv = document.getElementById('tab-btn-providers');
  const btnGen = document.getElementById('tab-btn-general');
  const btnMod = document.getElementById('tab-btn-models');
  
  const divProv = document.getElementById('provider-tab-providers');
  const divGen = document.getElementById('provider-tab-general');
  const divMod = document.getElementById('provider-tab-models');
  
  if (btnProv) btnProv.classList.remove('active');
  if (btnGen) btnGen.classList.remove('active');
  if (btnMod) btnMod.classList.remove('active');
  
  if (divProv) divProv.style.display = 'none';
  if (divGen) divGen.style.display = 'none';
  if (divMod) divMod.style.display = 'none';
  
  let activeDiv = null;
  if (tab === 'providers') {
    if (btnProv) btnProv.classList.add('active');
    if (divProv) { divProv.style.display = 'block'; activeDiv = divProv; }
  } else if (tab === 'general') {
    if (btnGen) btnGen.classList.add('active');
    if (divGen) { divGen.style.display = 'block'; activeDiv = divGen; }
  } else {
    if (btnMod) btnMod.classList.add('active');
    if (divMod) { divMod.style.display = 'block'; activeDiv = divMod; }
    
    const search = document.getElementById('mgr-models-search');
    if (search) search.value = '';
    if (typeof filterModelsStatus === 'function') {
      filterModelsStatus('all', 450);
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
    if (!silent) showNotification("Base URL is required.", "info");
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
    showNotification("Provider settings saved successfully!", "success");
  }
};

window.deleteProviderByName = async function(providerName) {
  if (!providerName) return;
  
  const confirmed = await showConfirmModal('Delete Provider', `Are you sure you want to delete the provider '${providerName}'?`);
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
  
  showNotification("Provider deleted.", "info");
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

window.renderModelsRegistryTable = function(provider) {
  const tbody = document.getElementById('mgr-models-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const models = provider.models || [];
  document.getElementById('provider-models-count').textContent = models.length;
  
  // Sort: active model first, then the rest
  const activeModelId = settingsState.translateAiModel;
  const sortedModels = [...models].sort((a, b) => {
    if (a.id === activeModelId) return -1;
    if (b.id === activeModelId) return 1;
    return 0;
  });
  
  sortedModels.forEach(m => {
    const isModelActive = m.id === activeModelId;
    addManualModelRow(
      m.id || '',
      m.contextWindow || m.context_window || 200000,
      m.reasoning || 'None',
      isModelActive
    );
  });
};

window.addManualModelRow = function(modelId = "", contextWindow = 200000, reasoning = "None", isActive = false, focus = false) {
  const tbody = document.getElementById('mgr-models-tbody');
  if (!tbody) return;
  
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.04)';
  tr.dataset.modelId = modelId.toLowerCase();
  tr.dataset.reasoning = reasoning;
  if (isActive) {
    tr.classList.add('active-model-row');
  }
  
  tr.innerHTML = `
    <td style="width: 15%; text-align: center;">
      <label class="radio-container">
        <input type="radio" name="mgr-active-model" class="model-active-radio" ${isActive ? 'checked' : ''} />
        <span class="custom-radio"></span>
      </label>
    </td>
    <td style="width: 40%;"><input type="text" class="model-row-input model-id-input" value="${escapeHTML(modelId)}" placeholder="e.g. gpt-4o-mini" /></td>
    <td style="width: 20%;"><input type="text" inputmode="numeric" class="model-row-input model-ctx-input" value="${contextWindow}" /></td>
    <td style="width: 15%;">
      <select class="select-control model-reasoning-select">
        <option value="None" ${reasoning === 'None' ? 'selected' : ''}>None</option>
        <option value="Low" ${reasoning === 'Low' ? 'selected' : ''}>Low</option>
        <option value="Medium" ${reasoning === 'Medium' ? 'selected' : ''}>Medium</option>
        <option value="High" ${reasoning === 'High' ? 'selected' : ''}>High</option>
      </select>
    </td>
    <td style="width: 10%; text-align: center;">
      <button class="model-btn-trash" title="Remove Model Row">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </td>
  `;
  if (focus) {
    tbody.insertBefore(tr, tbody.firstChild);
  } else {
    tbody.appendChild(tr);
  }

  const idInput = tr.querySelector('.model-id-input');
  const ctxInput = tr.querySelector('.model-ctx-input');
  const reasoningSelect = tr.querySelector('.model-reasoning-select');
  new CustomSelect(reasoningSelect);
  const activeRadio = tr.querySelector('.model-active-radio');
  const trashBtn = tr.querySelector('.model-btn-trash');
  
  const triggerAutoSave = () => {
    saveActiveProviderModels(true, true);
  };
  
  const updateReasoningStyle = () => {
    const el = reasoningSelect.closest('.custom-select-container') || reasoningSelect;
    if (reasoningSelect.value === 'None') {
      el.classList.add('reasoning-none');
      el.classList.remove('reasoning-active');
    } else {
      el.classList.remove('reasoning-none');
      el.classList.add('reasoning-active');
    }
  };
  
  idInput.addEventListener('change', () => {
    tr.dataset.modelId = idInput.value.toLowerCase();
    triggerAutoSave();
  });
  
  ctxInput.addEventListener('input', () => {
    let cleanVal = toEnglishDigits(ctxInput.value).replace(/[^0-9]/g, '');
    ctxInput.value = cleanVal;
  });
  ctxInput.addEventListener('change', triggerAutoSave);
  
  reasoningSelect.addEventListener('change', () => {
    tr.dataset.reasoning = reasoningSelect.value;
    updateReasoningStyle();
    triggerAutoSave();
  });
  
  updateReasoningStyle();
  
  activeRadio.addEventListener('change', () => {
    const siblingRows = tbody.querySelectorAll('tr');
    siblingRows.forEach(r => r.classList.remove('active-model-row'));
    tr.classList.add('active-model-row');
    
    // Move this row to the very top of tbody immediately
    tbody.insertBefore(tr, tbody.firstChild);
    
    triggerAutoSave();
  });
  
  trashBtn.addEventListener('click', () => {
    if (activeRadio.checked) {
      showNotification("The active model row cannot be deleted. Please set another model as active first.", "info");
      return;
    }
    tr.remove();
    triggerAutoSave();
  });

  if (focus) {
    setTimeout(() => {
      if (idInput) {
        idInput.focus({ preventScroll: true });
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
    showNotification("Please provide a Base URL to fetch models.", "info");
    return;
  }
  
  const btn = document.getElementById('mgr-btn-fetch-models');
  btn.disabled = true;
  btn.textContent = 'Fetching...';
  
  if ((!apiKey || apiKey === '••••••••••••••••') && (provider.useKeyring || provider.apiKey === '__KEYRING__' || provider.api_key === '__KEYRING__')) {
    try {
      apiKey = await invoke('get_keyring_credential', { providerName });
    } catch(e) {}
  }
  
  try {
    const modelsList = await invoke('fetch_provider_models', { baseUrl, apiKey, apiFormat });
    const tbody = document.getElementById('mgr-models-tbody');
    tbody.innerHTML = '';
    
    const currentActive = settingsState.translateAiModel;
    
    modelsList.forEach((m, idx) => {
      const modelId = (m && typeof m === 'object') ? m.id : m;
      const modelCtx = (m && typeof m === 'object') ? (m.contextWindow || 200000) : 200000;
      const idLower = modelId.toLowerCase();
      let reasoning = (idLower.includes('reasoning') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('deepseek-r1')) ? 'High' : 'None';
      const makeActive = !currentActive && idx === 0;
      addManualModelRow(modelId, modelCtx, reasoning, makeActive);
    });
    
    await saveActiveProviderModels(true, false);
    showNotification(`Successfully fetched ${modelsList.length} models!`, "success");
  } catch (e) {
    showNotification("Failed to fetch models: " + e, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Fetch Models';
  }
};

window.saveActiveProviderModels = async function(keepCurrentTab = false, skipTableRender = false) {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  
  let providers = [];
  try {
    providers = JSON.parse(settingsState.translateAiProviders || '[]');
  } catch (e) {
    console.error(e);
  }
  
  const providerIdx = providers.findIndex(p => p.name === providerName);
  if (providerIdx === -1) return;
  
  const provider = providers[providerIdx];
  const models = [];
  const rows = document.querySelectorAll('#mgr-models-tbody tr');
  let activeModelId = '';
  
  rows.forEach(row => {
    const idInput = row.querySelector('.model-id-input');
    const ctxInput = row.querySelector('.model-ctx-input');
    const reasoningSelect = row.querySelector('.model-reasoning-select');
    const activeRadio = row.querySelector('.model-active-radio');
    if (!idInput) return;
    
    const modelId = idInput.value.trim();
    const contextWindow = parseInt(ctxInput.value) || 200000;
    const reasoning = reasoningSelect.value;
    
    if (modelId) {
      models.push({ id: modelId, contextWindow, reasoning, enabled: true });
      if (activeRadio && activeRadio.checked) {
        activeModelId = modelId;
      }
    }
  });
  
  if (!activeModelId && models.length > 0) activeModelId = models[0].id;
  
  settingsState.translateAiModel = activeModelId;
  provider.models = models;
  providers[providerIdx] = provider;
  settingsState.translateAiProviders = JSON.stringify(providers);
  
  const selectDOM = document.getElementById('opt-translateAiModel');
  if (selectDOM) {
    selectDOM.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.id;
      selectDOM.appendChild(opt);
    });
    selectDOM.value = activeModelId;
  }
  
  const bannerEl = document.getElementById('active-model-banner');
  const bannerVal = document.getElementById('active-model-banner-value');
  if (bannerEl && bannerVal) {
    if (activeModelId) {
      bannerVal.innerHTML = `
        <div class="active-model-chip-group">
          <span class="active-model-chip-provider">${escapeHTML(providerName)}</span>
          <span class="active-model-chip-model">${escapeHTML(activeModelId)}</span>
        </div>
      `;
      bannerEl.style.display = 'flex';
    } else {
      bannerEl.style.display = 'none';
    }
  }
  
  await saveCurrentSettings();
  updateTranscribeUIConfigs();
  
  if (!skipTableRender) {
    renderModelsRegistryTable(provider);
  }
};

let currentModelStatusFilter = 'all';
let filterTimeout;

window.filterModelsTable = function(delay = 150) {
  clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    const query = document.getElementById('mgr-models-search').value.toLowerCase();
    const rows = document.querySelectorAll('#mgr-models-tbody tr');
    
    rows.forEach(row => {
      // Active model row is ALWAYS shown, regardless of query or status filter!
      if (row.classList.contains('active-model-row')) {
        row.style.display = '';
        return;
      }
      
      const modelId = row.dataset.modelId || '';
      const isFree = modelId.includes('free');
      const reasoning = row.dataset.reasoning || 'None';
      const hasReasoning = reasoning !== 'None';
      
      const matchQuery = modelId.includes(query);
      let matchStatus = true;
      
      if (currentModelStatusFilter === 'free') {
        matchStatus = isFree;
      } else if (currentModelStatusFilter === 'reasoning') {
        matchStatus = hasReasoning;
      }
      
      if (matchQuery && matchStatus) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  }, delay);
};

window.filterModelsStatus = function(status, delay = 150) {
  currentModelStatusFilter = status;
  
  const filters = ['all', 'free', 'reasoning'];
  filters.forEach(f => {
    const btn = document.getElementById(`filter-models-${f}`);
    if (btn) {
      if (f === status) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  
  const container = document.querySelector('#provider-tab-models .providers-table-wrapper');
  if (container) {
    container.scrollTop = 0;
  }
  
  filterModelsTable(delay);
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
    showNotification("Name and Base URL are required.", "info");
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
    showNotification(`A provider named '${name}' already exists.`, "error");
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
  onProviderChanged(false); // Load general tab for newly created provider
  closeProviderModal();
  
  showNotification("Provider added successfully! Configure its models below.", "success");
};

window.showBatchErrorDialog = function(fileName, errorMsg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('batch-error-modal');
    document.getElementById('batch-error-message').textContent = `Failed to translate '${fileName}': ${errorMsg}`;
    
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
  if (promptTextarea) promptTextarea.addEventListener('change', triggerAutoSave);

  const addCustomModelBtn = document.getElementById('mgr-btn-add-custom-model');
  if (addCustomModelBtn) {
    addCustomModelBtn.addEventListener('click', () => {
      window.addManualModelRow("", 200000, "None", false, true);
    });
  }
};

window.closeTestModal = function() {
  const modal = document.getElementById('translation-test-modal');
  modal.classList.remove('show');
  setTimeout(() => modal.style.display = 'none', 300);
};

window.testTranslationConnection = async function() {
  const providerSelect = document.getElementById('opt-translateAiProvider');
  if (!providerSelect) return;
  const providerName = providerSelect.value;
  if (!providerName) {
    showNotification("No active provider selected to test.", "info");
    return;
  }
  
  const testBtn = document.getElementById('mgr-btn-test-connection');
  const originalText = testBtn.textContent;
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  
  // Make sure general settings are saved silently first
  await saveActiveProviderGeneral(true);
  
  const testSrt = `1\n00:00:01,000 --> 00:00:05,000\nHello, this is a test of the AI translation system connection.`;
  
  const testModal = document.getElementById('translation-test-modal');
  const statusEl = document.getElementById('test-modal-status');
  const resultEl = document.getElementById('test-modal-result');
  
  statusEl.textContent = 'Testing connection...';
  statusEl.style.color = 'var(--color-cyan)';
  resultEl.textContent = 'Waiting for response from translation API...';
  
  testModal.style.display = 'flex';
  setTimeout(() => testModal.classList.add('show'), 10);
  
  try {
    const response = await invoke('preview_translate_first_lines', {
      settings: settingsState,
      fileContent: testSrt
    });
    
    statusEl.textContent = 'Connection Successful!';
    statusEl.style.color = 'var(--color-green)';
    resultEl.textContent = response;
  } catch (err) {
    statusEl.textContent = 'Connection Failed!';
    statusEl.style.color = 'var(--color-red)';
    resultEl.textContent = err;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = originalText;
  }
};

window.toggleTranslationSubSettingsVisibility = function() {
  const enabled = settingsState.translateAiEnabled === true;
  const group = document.getElementById('group-translation');
  if (!group) return;
  
  const cards = group.querySelectorAll('.setting-card, .provider-manager-card');
  cards.forEach(c => {
    const checkbox = c.querySelector('#opt-translateAiEnabled');
    if (checkbox) return;
    c.style.display = enabled ? '' : 'none';
  });
};
