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

// Premium Glassmorphic Toast Notification System
window.showNotification = function(message, type = 'info') {
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
  
  toast.innerHTML = `
    ${iconSvg}
    <div class="toast-message">${message}</div>
  `;
  
  container.appendChild(toast);
  
  // Animate Entry
  setTimeout(() => toast.classList.add('show'), 20);
  
  // Auto Pruning
  setTimeout(() => {
    toast.classList.remove('show');
    toast.classList.add('hide');
    setTimeout(() => {
      toast.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 400);
  }, 3200);
};

// Centered Premium Glassmorphic Modal overlay API
window.showAppModal = function(title, message, details = '') {
  const overlay = document.getElementById('app-modal-overlay');
  const titleEl = document.getElementById('app-modal-title');
  const msgEl = document.getElementById('app-modal-message');
  const detailsEl = document.getElementById('app-modal-details');
  
  if (overlay && titleEl && msgEl && detailsEl) {
    titleEl.textContent = title;
    msgEl.textContent = message;
    
    if (details) {
      detailsEl.textContent = details;
      detailsEl.style.display = 'block';
    } else {
      detailsEl.style.display = 'none';
    }
    
    overlay.style.display = 'flex';
    // Trigger reflow to run CSS animation
    void overlay.offsetWidth;
    overlay.classList.add('show');
  }
};

window.closeAppModal = function() {
  const overlay = document.getElementById('app-modal-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 300);
  }
};

// Safe Tauri API extraction
let originalInvoke = null;
let originalListen = null;

try {
  if (window.__TAURI__) {
    originalInvoke = window.__TAURI__.core.invoke;
    originalListen = window.__TAURI__.event.listen;
  } else {
    console.warn("Tauri global namespace not detected. Web fallback active.");
  }
} catch (e) {
  console.error("Failed to load Tauri core APIs:", e);
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
      gpu: "Intel Iris Xe Graphics (💤 IDLE)"
    };
  }
  if (cmd === 'load_settings') {
    return {
      preset: 'safe',
      selectedBackend: 'Standard',
      cloneDir: '/home/user/whisper.cpp',
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
      fontPath: "".to_string || "",
      outputCsv: false,
      outputJson: false,
      outputJsonFull: false,
      noPrints: false,
      printSpecial: false,
      printColors: false,
      printConfidence: true,
      printProgress: false,
      noTimestamps: false,
      language: "auto",
      detectLanguage: false,
      prompt: "",
      carryPrompt: false,
      modelPath: "models/ggml-base.en.bin",
      inputFile: "",
      ovDevice: "CPU",
      dtwModel: "",
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
    return false;
  }
  if (cmd === 'scan_models') {
    return {
      transModels: ['models/ggml-base.en.bin', 'models/ggml-small.bin'],
      vadModels: ['models/ggml-silero-v6.2.0.bin']
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

// Global States
let activeView = 'intro';
let activeSettingsCat = 'general';
let activeLogCategory = 'All';
let logSearchQuery = '';
let settingsState = null;
let compiledBackends = {};
let allLogsArray = []; // Store raw log payloads
let systemSpecs = null;
let selectedBackendsForBuild = ['Standard'];

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

function recommendCompilationBackend() {
  if (!systemSpecs) return;
  
  // Hide all recommendation pills first
  const pills = document.querySelectorAll('.recommendation-pill');
  pills.forEach(p => p.style.display = 'none');
  
  // Determine recommended backends based on GPU
  let recBackends = ['Standard'];
  if (systemSpecs.gpu_type === 'nvidia') {
    recBackends = ['CUDA'];
  } else if (systemSpecs.gpu_type === 'amd') {
    recBackends = ['Vulkan'];
  } else if (systemSpecs.gpu_type === 'intel') {
    recBackends = ['OpenVINO', 'Vulkan'];
  }
  
  recBackends.forEach(backend => {
    const recPill = document.getElementById(`rec-${backend}`);
    if (recPill) {
      recPill.style.display = 'inline-block';
    }
  });
  
  // Auto-select the first non-Standard backend initially if any
  const firstNonCpu = recBackends.find(b => b !== 'Standard');
  if (firstNonCpu) {
    selectBackend(firstNonCpu, true);
    
    // Auto-select additional recommended backends as well
    recBackends.forEach(b => {
      if (b !== 'Standard' && b !== firstNonCpu) {
        if (!selectedBackendsForBuild.includes(b)) {
          selectBackend(b);
        }
      }
    });
  }
}

// ----------------- Custom Dropdown Component -----------------
window.customSelectsMap = new Map();

class CustomSelect {
  constructor(selectElement) {
    this.select = selectElement;
    this.container = null;
    this.trigger = null;
    this.optionsContainer = null;
    this.isOpen = false;
    this.init();
  }

  init() {
    this.select.style.display = 'none';

    this.container = document.createElement('div');
    this.container.className = 'custom-select-container';
    
    if (this.select.className) {
      this.container.classList.add(...this.select.className.split(' ').filter(c => c !== 'select-control'));
    }
    if (this.select.id) {
      this.container.id = `custom-select-${this.select.id}`;
    }
    
    this.container.style.width = this.select.style.width || '100%';
    this.container.style.height = this.select.style.height || 'auto';
    this.container.style.margin = this.select.style.margin || '0';

    this.trigger = document.createElement('div');
    this.trigger.className = 'custom-select-trigger';
    this.trigger.innerHTML = `
      <span class="custom-select-value"></span>
      <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    this.container.appendChild(this.trigger);

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'custom-select-options';
    this.container.appendChild(this.optionsContainer);

    this.select.parentNode.insertBefore(this.container, this.select.nextSibling);

    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.container.contains(e.target)) {
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

  updateOptions() {
    this.optionsContainer.innerHTML = '';
    const options = Array.from(this.select.options);

    options.forEach(opt => {
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;

      optDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select.value = opt.value;
        this.select.dispatchEvent(new Event('change'));
        this.close();
      });

      this.optionsContainer.appendChild(optDiv);
    });

    this.syncSelectedValue();
  }

  syncSelectedValue() {
    const selectedOpt = this.select.options[this.select.selectedIndex];
    const valText = selectedOpt ? selectedOpt.textContent : (this.select.placeholder || 'Select...');
    this.trigger.querySelector('.custom-select-value').textContent = valText;

    Array.from(this.optionsContainer.children).forEach(child => {
      if (child.dataset.value === this.select.value) {
        child.classList.add('selected');
      } else {
        child.classList.remove('selected');
      }
    });
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
      if (c !== this.container) {
        c.classList.remove('open');
        c.closest('.setting-card, .wizard-step')?.classList.remove('has-active-dropdown');
      }
    });

    // Check if we should open upward
    const rect = this.trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownHeight = 250;
    
    if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
      this.container.classList.add('open-upward');
    } else {
      this.container.classList.remove('open-upward');
    }

    this.container.classList.add('open');
    this.container.closest('.setting-card, .wizard-step')?.classList.add('has-active-dropdown');
    this.isOpen = true;
  }

  close() {
    this.container.classList.remove('open');
    this.container.closest('.setting-card, .wizard-step')?.classList.remove('has-active-dropdown');
    this.isOpen = false;
  }
}

window.initializeCustomSelects = function() {
  document.querySelectorAll('select.select-control, select#batch-sort-select').forEach(select => {
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
  await refreshBuildStatuses();
  recommendCompilationBackend();
  
  // Setup Dashboard drag & drop
  setupDashboardDragAndDrop();
  
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
  
  // Update nav link active states
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.classList.remove('active');
    const onclickStr = item.getAttribute('onclick');
    if (onclickStr && onclickStr.includes(viewName)) {
      item.classList.add('active');
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
    'build': 'System Build',
    'settings': 'Configuration Grid',
    'models': 'Model Manager',
    'transcribe': 'Transcribe File',
    'logs': 'Central Logging Center'
  };
  document.getElementById('current-view-title').textContent = titleMap[viewName] || 'Whisper Manager';

  if (viewName === 'models') {
    loadModelStatusesGrid();
  }
};

// ----------------- HUD Statistics Poll -----------------
function startHudPoll() {
  setInterval(async () => {
    try {
      const stats = await invoke('get_system_stats');
      
      // Update CPU
      const cpuEl = document.getElementById('stat-cpu');
      cpuEl.textContent = `${stats.cpu.toFixed(1)}%`;
      cpuEl.className = 'stat-value ' + (stats.cpu > 70 ? 'warm' : 'active');
      
      // Update RAM
      document.getElementById('stat-ram').textContent = stats.ram;
      
      // Update GPU
      const gpuEl = document.getElementById('stat-gpu');
      gpuEl.textContent = stats.gpu;
      gpuEl.className = 'stat-value ' + (stats.gpu.includes('N/A') ? '' : 'active');
    } catch (e) {
      console.error("Failed to query system stats:", e);
    }
  }, 2000);
}

// ----------------- Real-Time Listeners -----------------
function setupTauriListeners() {
  // Build compilation logs & progress
  listen('build-status', (event) => {
    const payload = event.payload;
    const progressBlock = document.getElementById('build-progress-block');
    const fillEl = document.getElementById('build-progress-bar');
    const labelEl = document.getElementById('build-progress-msg');
    const pctEl = document.getElementById('build-progress-pct');
    
    if (payload.active) {
      progressBlock.style.display = 'block';
      const pct = (payload.progress * 100).toFixed(0);
      fillEl.style.width = `${pct}%`;
      labelEl.textContent = payload.message;
      pctEl.textContent = `${pct}%`;
      fillEl.style.backgroundColor = 'var(--color-cyan)';
    } else {
      if (payload.error) {
        fillEl.style.width = '100%';
        fillEl.style.backgroundColor = 'var(--color-red)';
        labelEl.textContent = payload.message;
        pctEl.textContent = 'Failed';
        // Alert the user with package installation instructions
        showAppModal("Compilation Error", payload.message || "An error occurred during compilation.", payload.error);
      } else {
        fillEl.style.width = '100%';
        fillEl.style.backgroundColor = 'var(--color-green)';
        labelEl.textContent = payload.message;
        pctEl.textContent = '100%';
        showNotification("Build completed successfully!", "success");
      }
      setTimeout(async () => {
        progressBlock.style.display = 'none';
        // Reset color to cyan for next build
        fillEl.style.backgroundColor = 'var(--color-cyan)';
        await refreshBuildStatuses();
      }, 7000);
    }
  });

  // Transcription progress
  listen('transcribe-status', (event) => {
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

  // Model download progress
  listen('model-download-status', (event) => {
    const payload = event.payload;
    
    // Reload model statuses grid to show the progress update in real-time
    loadModelStatusesGrid(true);
    
    if (!payload.active) {
      if (payload.error) {
        showNotification(`Model download failed: ${payload.error}`, "error");
      } else {
        showNotification(`Finished downloading ggml-${payload.model_name}.bin successfully!`, "success");
        scanAndPopulateModels();
      }
    }
  });

  // Central logs listener
  listen('log-message', (event) => {
    const payload = event.payload;
    payload.message = stripAnsi(payload.message);
    const now = new Date();
    const pad = (num) => num.toString().padStart(2, '0');
    payload.timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    allLogsArray.push(payload);
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
  if (payload.category === lastAppendedCategory) {
    logLine.innerHTML = `<span class="log-time-spacer"></span><span class="log-cat-spacer"></span><span class="log-msg">${escapeHTML(payload.message)}</span>`;
  } else {
    logLine.innerHTML = `<span class="log-time">${payload.timestamp}</span><span class="log-cat ${catClass}">${payload.category.toUpperCase()}</span><span class="log-msg">${escapeHTML(payload.message)}</span>`;
    lastAppendedCategory = payload.category;
  }
  
  viewport.appendChild(logLine);
  
  // Handle Auto Scroll
  const autoScroll = document.getElementById('log-autoscroll').checked;
  if (autoScroll) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

function stripAnsi(str) {
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  return str.replace(ansiRegex, '');
}

function escapeHTML(str) {
  const cleanStr = stripAnsi(str);
  return cleanStr.replace(/[&<>'"]/g, 
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
    showNotification(`The selected backend (${backend === 'Standard' ? 'CPU' : backend}) is not compiled yet! Please click above to compile it first.`, "info");
    return;
  }
  
  if (settingsState) {
    settingsState.selectedBackend = backend;
    saveCurrentSettings();
    scanAndPopulateModels();
  }
  
  // Update the System Build selection to match
  selectedBackendsForBuild = [backend];
  const backends = ['Standard', 'Vulkan', 'OpenVINO', 'CUDA'];
  backends.forEach(b => {
    const card = document.getElementById(`backend-${b}`);
    if (card) {
      if (b === backend) card.classList.add('active');
      else card.classList.remove('active');
    }
    const chk = document.getElementById(`chk-${b}`);
    if (chk) {
      chk.checked = (b === backend);
    }
  });
  
  const labelMap = {
    'Standard': 'Standard CPU',
    'Vulkan': 'Vulkan GPU',
    'OpenVINO': 'OpenVINO Intel',
    'CUDA': 'NVIDIA CUDA'
  };
  const selectedLabels = selectedBackendsForBuild.map(b => labelMap[b] || b);
  const compTitle = document.getElementById('compilation-title');
  if (compTitle) {
    compTitle.textContent = `${selectedLabels.join(', ')} Compilation`;
  }
  
  updateDashboardBackendTiles();
  showNotification(`Active backend switched to ${backend === 'Standard' ? 'CPU' : backend} successfully!`, "success");
};

// ----------------- System Build Panel -----------------
async function refreshBuildStatuses() {
  const backends = ['Standard', 'Vulkan', 'OpenVINO', 'CUDA'];
  const cloneDir = document.getElementById('build-clone-dir').value || '';
  
  for (const b of backends) {
    const isCompiled = await invoke('check_build', { cloneDir, backend: b });
    compiledBackends[b] = isCompiled;
    
    const badge = document.getElementById(`badge-${b}`);
    if (badge) {
      if (isCompiled) {
        badge.textContent = 'Installed';
        badge.className = 'backend-status-badge installed';
      } else {
        badge.textContent = 'Not Compiled';
        badge.className = 'backend-status-badge missing';
      }
    }
  }
  
  // Update transcription card configs too
  updateTranscribeUIConfigs();
  updateDashboardBackendTiles();
}


window.selectBackend = function(backend, isInitialSelection = false) {
  if (isInitialSelection) {
    selectedBackendsForBuild = [backend];
    
    const backends = ['Standard', 'Vulkan', 'OpenVINO', 'CUDA'];
    backends.forEach(b => {
      const card = document.getElementById(`backend-${b}`);
      if (card) {
        if (b === backend) card.classList.add('active');
        else card.classList.remove('active');
      }
      const chk = document.getElementById(`chk-${b}`);
      if (chk) {
        chk.checked = (b === backend);
      }
    });
  } else {
    if (selectedBackendsForBuild.includes(backend)) {
      if (selectedBackendsForBuild.length === 1) {
        showNotification("You must select at least one backend to compile.", "info");
        return;
      }
      selectedBackendsForBuild = selectedBackendsForBuild.filter(b => b !== backend);
      const card = document.getElementById(`backend-${backend}`);
      if (card) card.classList.remove('active');
      const chk = document.getElementById(`chk-${backend}`);
      if (chk) chk.checked = false;
    } else {
      selectedBackendsForBuild.push(backend);
      const card = document.getElementById(`backend-${backend}`);
      if (card) card.classList.add('active');
      const chk = document.getElementById(`chk-${backend}`);
      if (chk) chk.checked = true;
    }
  }

  // Update compile title with list of selected backends
  const labelMap = {
    'Standard': 'Standard CPU',
    'Vulkan': 'Vulkan GPU',
    'OpenVINO': 'OpenVINO Intel',
    'CUDA': 'NVIDIA CUDA'
  };
  const selectedLabels = selectedBackendsForBuild.map(b => labelMap[b] || b);
  document.getElementById('compilation-title').textContent = `${selectedLabels.join(', ')} Compilation`;
  
  if (settingsState) {
    if (selectedBackendsForBuild.includes(backend)) {
      settingsState.selectedBackend = backend;
      saveCurrentSettings();
      scanAndPopulateModels();
    }
  }
  
  updateDashboardBackendTiles();
};

window.browseCloneDirectory = async function() {
  const path = await invoke('select_directory');
  if (path) {
    document.getElementById('build-clone-dir').value = path;
    if (settingsState) {
      settingsState.cloneDir = path;
      saveCurrentSettings();
      scanAndPopulateModels();
    }
    await refreshBuildStatuses();
  }
};

window.runGitOperations = async function() {
  const cloneDir = document.getElementById('build-clone-dir').value;
  if (!cloneDir) {
    showNotification("Please select or type a repository path first!", "info");
    return;
  }
  
  const btn = document.getElementById('btn-git-op');
  btn.disabled = true;
  btn.textContent = 'Cloning / Updating...';
  
  try {
    await invoke('start_git_operations', { cloneDir });
    showNotification("Git task launched successfully! Follow progress in the Central Logging Center.", "success");
    switchView('logs');
  } catch (e) {
    showNotification("Error spawning git commands: " + e, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Clone / Update Repo';
  }
};

window.runBackendBuild = async function() {
  const cloneDir = document.getElementById('build-clone-dir').value;
  if (!cloneDir) {
    showNotification("Please select or type a repository path first!", "info");
    return;
  }
  
  const btn = document.getElementById('btn-run-build');
  btn.disabled = true;
  
  try {
    await invoke('start_multi_compilations', { cloneDir, backends: selectedBackendsForBuild });
    showNotification(`Compilation launched successfully for: ${selectedBackendsForBuild.join(', ')}! Check the progress logs.`, "success");
    switchView('logs');
  } catch (e) {
    showNotification("Error spawning compile commands: " + e, "error");
  } finally {
    btn.disabled = false;
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
  }
};

async function refreshSettings() {
  try {
    settingsState = await invoke('load_settings');
    
    // Set clone dir input
    document.getElementById('build-clone-dir').value = settingsState.cloneDir;
    
    // Bind all options dynamically
    bindSettingsToDOM();
    
    // Scan models path
    await scanAndPopulateModels();
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

function bindSettingsToDOM() {
  if (!settingsState) return;
  
  // Update Presets UI
  document.getElementById('preset-safe').classList.remove('active');
  document.getElementById('preset-professional').classList.remove('active');
  const presetBtn = document.getElementById(`preset-${settingsState.preset}`);
  if (presetBtn) {
    presetBtn.classList.add('active');
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
        };
      }
    }
  });
  
  // Update build selection card highlight based on settings backend
  selectBackend(settingsState.selectedBackend, true);
  
  // Sync custom dropdown views
  if (window.syncCustomSelects) {
    window.syncCustomSelects();
  }
}

async function saveCurrentSettings() {
  if (!settingsState) return;
  try {
    await invoke('save_settings', { settings: settingsState });
    updateTranscribeUIConfigs();
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

window.switchPreset = async function(preset) {
  try {
    settingsState = await invoke('apply_preset', { preset });
    bindSettingsToDOM();
    await scanAndPopulateModels();
    showNotification(`Preset switched to ${preset.toUpperCase()} successfully!`, "success");
  } catch (e) {
    showNotification("Failed to apply preset: " + e, "error");
  }
};

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
      cloneDir: settingsState.cloneDir,
      backend: settingsState.selectedBackend
    });
    
    localScannedTransModels = res.transModels || [];
    
    // 1. Populate Model Selection
    const transSelect = document.getElementById('opt-modelPath');
    transSelect.innerHTML = '';
    res.transModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m.split('/').pop(); // Show only filename
      if (m === settingsState.modelPath) {
        opt.selected = true;
      }
      transSelect.appendChild(opt);
    });
    transSelect.onchange = () => {
      settingsState.modelPath = transSelect.value;
      saveCurrentSettings();
    };

    // 2. Populate VAD Selection
    const vadSelect = document.getElementById('opt-vadModel');
    vadSelect.innerHTML = '';
    res.vadModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m.split('/').pop();
      if (m === settingsState.vadModel) {
        opt.selected = true;
      }
      vadSelect.appendChild(opt);
    });
    vadSelect.onchange = () => {
      settingsState.vadModel = vadSelect.value;
      saveCurrentSettings();
    };
    
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
  for (let i = 1; i <= 4; i++) {
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
  for (let i = 1; i <= 4; i++) {
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
      document.getElementById('lbl-file-name').textContent = selectedMediaFile.split('/').pop();
      document.getElementById('lbl-file-path').textContent = selectedMediaFile;
      document.getElementById('batch-queue-container').style.display = 'none';
      
      document.getElementById('media-meta-box').style.display = 'grid';
      document.getElementById('batch-specs-box').style.display = 'none';
      document.getElementById('btn-next-step-2').textContent = 'Continue to Conversion';
      
      document.getElementById('btn-run-ffmpeg').style.display = 'inline-flex';
      document.getElementById('batch-controls-box').style.display = 'none';
      document.getElementById('wizard-step-4').style.display = 'block';
      
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
        name: filePath.split('/').pop(),
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
      
      document.getElementById('btn-run-ffmpeg').style.display = 'none';
      document.getElementById('batch-controls-box').style.display = 'block';
      document.getElementById('wizard-step-4').style.display = 'none';
      
      setWizardStepCompleted(1, true);
      setWizardStepCompleted(2, true);
      
      // Probe file sizes and durations asynchronously to avoid freezing the UI thread
      files.forEach(async (f, idx) => {
        try {
          const meta = await invoke('probe_media_file', { filePath: f });
          if (meta && meta.exists) {
            batchItems[idx].size = meta.size;
            batchItems[idx].durationSec = meta.durationSec;
            renderBatchQueueTable();
            updateBatchSpecs();
          }
        } catch (err) {
          console.error("Failed to probe file in batch:", err);
        }
      });
      
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
      
      const recText = `Backend: ${settingsState.selectedBackend} (${settingsState.threads} threads) | Preset: ${settingsState.preset.toUpperCase()}`;
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
      document.getElementById('lbl-radial-msg').textContent = 'Ready for WAV Convert';
      
      setWizardStepCompleted(3, false);
      setWizardStepCompleted(4, false);
      document.getElementById('btn-next-to-transcribe').style.display = 'none';
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
  
  const backend = settingsState.selectedBackend;
  document.getElementById('trans-cfg-backend').textContent = backend;
  
  const model = settingsState.modelPath.split('/').pop() || 'None';
  document.getElementById('trans-cfg-model').textContent = model;
  
  const vad = settingsState.vad ? 'ON' : 'OFF';
  document.getElementById('trans-cfg-vad').textContent = vad;
}

window.runFFmpegConversion = async function() {
  if (!selectedMediaFile) return;
  
  const btn = document.getElementById('btn-run-ffmpeg');
  btn.disabled = true;
  btn.textContent = 'Converting via FFmpeg...';
  
  try {
    const wavPath = await invoke('convert_media_file', { filePath: selectedMediaFile });
    wavPathForTranscription = wavPath;
    
    setWizardStepCompleted(3, true);
    document.getElementById('btn-next-to-transcribe').style.display = 'inline-flex';
    
    document.getElementById('lbl-radial-msg').textContent = 'WAV Ready! Click Next';
    showNotification("FFmpeg converted successfully! Audio is ready for transcription.", "success");
    
    setTimeout(() => {
      openWizardStep(4);
    }, 800);
  } catch (e) {
    showNotification("FFmpeg audio conversion failed: " + e, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run FFmpeg Conversion';
  }
};

window.runWhisperTranscription = async function() {
  if (!wavPathForTranscription || !probedMetadata) {
    showNotification("Please convert the media file to WAV format first in Step 3!", "info");
    openWizardStep(3);
    return;
  }
  
  const isCompiled = compiledBackends[settingsState.selectedBackend];
  if (!isCompiled) {
    showNotification(`The selected backend (${settingsState.selectedBackend}) is not compiled yet! Please go to the 'System Build' panel and build it first.`, "info");
    switchView('build');
    return;
  }
  
  const modelExists = localScannedTransModels.includes(settingsState.modelPath);
  if (!modelExists) {
    const modelName = settingsState.modelPath.split('/').pop() || 'selected model';
    showNotification(`The selected model file '${modelName}' does not exist locally. Please select a valid model in General Configuration!`, "error");
    return;
  }
  
  const btn = document.getElementById('btn-run-transcribe');
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  
  btn.disabled = true;
  btn.textContent = 'AI Transcribing...';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  
  document.getElementById('analytics-box').style.display = 'none';

  // Clear transcript preview
  transcriptLines = [];
  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = '<div style="color: var(--color-cyan); text-align: center; margin-top: 40px; font-weight: 500;">AI model is initializing...</div>';
  }
  
  try {
    const result = await invoke('start_transcription_task', {
      settings: settingsState,
      wavPath: wavPathForTranscription,
      durationSec: probedMetadata.durationSec
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
    
    setWizardStepCompleted(4, true);
    showNotification("Transcription completed successfully!", "success");
  } catch (e) {
    setWizardStepCompleted(4, false);
    if (e.includes("cancelled") || e.includes("terminated") || e.includes("aborted") || e.includes("signal")) {
      showNotification("Transcription aborted by the user.", "info");
      document.getElementById('lbl-radial-msg').textContent = 'Aborted';
    } else {
      showNotification("Transcription execution failed: " + e, "error");
      document.getElementById('lbl-radial-msg').textContent = 'Task Failed';
    }
  } finally {
    // ALWAYS clear the temporary WAV state since it has been cleaned up by the backend
    wavPathForTranscription = null;
    setWizardStepCompleted(3, false);
    document.getElementById('btn-next-to-transcribe').style.display = 'none';
    
    btn.disabled = false;
    btn.textContent = 'Start AI Extraction';
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
    cancelBtn.textContent = 'Aborting...';
  }
  
  try {
    await invoke('cancel_transcription');
    showNotification("Aborting AI process...", "info");
  } catch (e) {
    showNotification("Failed to cancel process: " + e, "error");
  } finally {
    if (cancelBtn) {
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.display = 'none';
    }
  }
};

window.copyTranscriptToClipboard = async function() {
  if (!selectedMediaFile) return;
  
  // Read base path and .txt path
  // Since selectedMediaFile is /path/to/media.mp4, we extract its base name and check for .txt file
  const base = selectedMediaFile.substring(0, selectedMediaFile.lastIndexOf('.')) || selectedMediaFile;
  const txtFile = `${base}.txt`;
  
  try {
    // We can run a shell copy of the written transcript file
    const content = await invoke('get_logs'); // Fallback to raw log string
    // In our Rust backend, we have a custom copy_to_clipboard command which reads clipboard natively.
    // Let's copy the full logs or display a notice.
    // Actually, we'll read the main generated files using standard commands or copy log text.
    // Since copy_to_clipboard is bound in Rust main.rs, let's copy the activity logs for now!
    // Or we can let users copy all logs. Let's send the central logs to the clipboard.
    const allLogs = allLogsArray
      .filter(l => l.category === 'Whisper')
      .map(l => l.message)
      .join('\n');
      
    await invoke('copy_to_clipboard', { text: allLogs });
    showNotification("Transcription text copied to clipboard successfully!", "success");
  } catch (e) {
    showNotification("Failed to copy transcript: " + e, "error");
  }
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
  
  // Redraw viewport
  redrawLogsViewport();
};

window.handleLogSearch = function() {
  logSearchQuery = document.getElementById('log-search').value;
  redrawLogsViewport();
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
    await invoke('copy_to_clipboard', { text: rawLogs });
    showNotification("All logs copied to clipboard!", "success");
  } catch (e) {
    showNotification("Failed to copy logs: " + e, "error");
  }
};

window.clearLogsHistory = async function() {
  if (confirm("Are you sure you want to clear the entire log history?")) {
    allLogsArray = [];
    lastAppendedCategory = null;
    await invoke('clear_logs');
    redrawLogsViewport();
  }
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
  document.getElementById('btn-next-step-2').textContent = 'Continue to Conversion';
  
  document.getElementById('btn-run-ffmpeg').style.display = 'inline-flex';
  document.getElementById('batch-controls-box').style.display = 'none';
  document.getElementById('wizard-step-4').style.display = 'block';
  
  // Set steps 1, 2, 3, 4 as incomplete
  setWizardStepCompleted(1, false);
  setWizardStepCompleted(2, false);
  setWizardStepCompleted(3, false);
  setWizardStepCompleted(4, false);
  
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
    actionTd.style.display = 'flex';
    actionTd.style.alignItems = 'center';
    actionTd.style.justifyContent = 'center';
    actionTd.style.gap = '8px';
    
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
    
    actionTd.appendChild(upBtn);
    actionTd.appendChild(downBtn);
    actionTd.appendChild(deleteBtn);
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
      
      // Override settingsState inputFile to point to this item's path so outputs are generated next to the original file
      const originalInputFile = settingsState.inputFile;
      settingsState.inputFile = item.path;

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
      
      // Restore original setting
      settingsState.inputFile = originalInputFile;
      
      item.status = 'completed';
      item.timeSec = result.durationMs / 1000;
      item.speedFactor = result.speedFactor;
      item.outputs = result.generatedFiles;
      successCount++;
      
      renderBatchQueueTable();
    } catch (err) {
      item.status = 'failed';
      renderBatchQueueTable();
      showNotification(`Failed to process '${item.name}': ${err}`, "error");
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
    document.getElementById('lbl-file-name').textContent = selectedMediaFile.split('/').pop();
    document.getElementById('lbl-file-path').textContent = selectedMediaFile;
    document.getElementById('batch-queue-container').style.display = 'none';
    
    document.getElementById('media-meta-box').style.display = 'grid';
    document.getElementById('batch-specs-box').style.display = 'none';
    document.getElementById('btn-next-step-2').textContent = 'Continue to Conversion';
    document.getElementById('btn-run-ffmpeg').style.display = 'inline-flex';
    document.getElementById('batch-controls-box').style.display = 'none';
    document.getElementById('wizard-step-4').style.display = 'block';
    
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
      name: filePath.split('/').pop(),
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
    document.getElementById('btn-run-ffmpeg').style.display = 'none';
    document.getElementById('batch-controls-box').style.display = 'block';
    document.getElementById('wizard-step-4').style.display = 'none';
    
    setWizardStepCompleted(1, true);
    setWizardStepCompleted(2, true);
    
    files.forEach(async (f, idx) => {
      try {
        const meta = await invoke('probe_media_file', { filePath: f });
        if (meta && meta.exists) {
          batchItems[idx].size = meta.size;
          batchItems[idx].durationSec = meta.durationSec;
          renderBatchQueueTable();
          updateBatchSpecs();
        }
      } catch (err) {
        console.error("Failed to probe file in batch:", err);
      }
    });
    
    setTimeout(() => {
      openWizardStep(2);
    }, 500);
  }
  
  switchView('transcribe');
  showNotification(`Successfully loaded ${files.length} file(s) via Drag & Drop!`, "success");
}


// ----------------- Model Manager Logic -----------------
let modelStatusPollInterval = null;
let prevDownloadedBytesMap = new Map();
let prevTimestampMap = new Map();
let lastKnownSpeedMap = new Map();
let currentCategoryFilter = 'recommended';

function formatRemainingTime(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return "Unknown";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function startModelStatusPolling() {
  if (modelStatusPollInterval) return;
  modelStatusPollInterval = setInterval(async () => {
    if (activeView === 'models') {
      await loadModelStatusesGrid(true);
    } else {
      clearInterval(modelStatusPollInterval);
      modelStatusPollInterval = null;
    }
  }, 1000);
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
  if (!settingsState) return;
  
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
    const statuses = await invoke('get_all_models_status', { cloneDir: settingsState.cloneDir });
    const grid = document.getElementById('models-list-scroll');
    if (!grid) return;
    
    const query = document.getElementById('model-search').value.toLowerCase();
    
    grid.innerHTML = '';
    
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
      if (query && !m.name.toLowerCase().includes(query)) {
        return;
      }

      // EXCLUSIVE SEPARATION:
      // Downloaded models should only show in the "local" tab, and not anywhere else!
      if (currentCategoryFilter === 'local') {
        if (m.status !== 'Downloaded') return;
      } else {
        if (m.status === 'Downloaded') return;
        
        // Filter catalog tabs by size families or recommended status
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
      
      const card = document.createElement('div');
      card.className = 'setting-card';
      card.dataset.name = m.name;
      
      let badgeHtml = '';
      if (m.status === 'Downloading') {
        badgeHtml = `<span class="model-badge badge-downloading">${m.status}</span>`;
      } else if (m.status === 'Paused') {
        badgeHtml = `<span class="model-badge badge-paused">${m.status}</span>`;
      }
      
      let isRecommended = recList.includes(m.name);
      const sizeMB = (m.sizeBytes / 1024 / 1024).toFixed(0);
      const dlMB = (m.downloadedBytes / 1024 / 1024).toFixed(0);

      let speedText = '';
      let remainingText = '';
      
      if (m.status === 'Downloading') {
        const now = Date.now();
        const prevBytes = prevDownloadedBytesMap.get(m.name) || 0;
        const prevTime = prevTimestampMap.get(m.name) || now;
        
        const deltaBytes = m.downloadedBytes - prevBytes;
        const deltaTime = (now - prevTime) / 1000;
        
        prevDownloadedBytesMap.set(m.name, m.downloadedBytes);
        prevTimestampMap.set(m.name, now);
        
        if (deltaBytes > 0 && deltaTime > 0) {
          const speedBytesPerSec = deltaBytes / deltaTime;
          const speedMBPerSec = (speedBytesPerSec / 1024 / 1024).toFixed(1);
          speedText = `${speedMBPerSec} MB/s`;
          lastKnownSpeedMap.set(m.name, speedText);
          
          const remainingBytes = m.sizeBytes - m.downloadedBytes;
          const remainingSeconds = Math.round(remainingBytes / speedBytesPerSec);
          remainingText = ` • ETA: ${formatRemainingTime(remainingSeconds)}`;
        } else {
          if (m.downloadedBytes === 0) {
            speedText = 'Starting...';
          } else {
            speedText = lastKnownSpeedMap.get(m.name) || '0.0 MB/s';
          }
        }
      } else {
        prevDownloadedBytesMap.delete(m.name);
        prevTimestampMap.delete(m.name);
        lastKnownSpeedMap.delete(m.name);
      }
      
      let actionButtons = '';
      if (m.status === 'Downloaded') {
        actionButtons = `
          <button class="btn-secondary" style="border-color: var(--color-red); color: var(--color-red); margin: 0; padding: 6px 14px; font-size: 0.8rem;" onclick="deleteModelClick('${m.name}')">Delete</button>
        `;
      } else if (m.status === 'Downloading') {
        actionButtons = `
          <button class="btn-secondary" style="border-color: var(--color-gold); color: var(--color-gold); margin: 0; padding: 6px 14px; font-size: 0.8rem;" onclick="pauseModelClick('${m.name}')">Pause</button>
        `;
      } else if (m.status === 'Paused') {
        actionButtons = `
          <button class="btn-primary" style="margin: 0; padding: 6px 14px; font-size: 0.8rem;" onclick="downloadModelClick('${m.name}')">Resume</button>
          <button class="btn-secondary" style="border-color: var(--color-red); color: var(--color-red); margin: 0; padding: 6px 14px; font-size: 0.8rem;" onclick="deleteModelClick('${m.name}')">Discard</button>
        `;
      } else {
        actionButtons = `
          <button class="btn-primary" style="margin: 0; padding: 6px 14px; font-size: 0.8rem; min-width: 100px;" onclick="downloadModelClick('${m.name}')">Download</button>
        `;
      }
      
      const pct = (m.progress * 100).toFixed(0);
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
      
      card.innerHTML = `
        <div class="setting-info" style="flex-grow: 1; padding-right: 20px;">
          <div class="setting-label-row" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span class="setting-title" style="font-size: 1.05rem; font-weight: 600; color: #fff;">ggml-${m.name}.bin</span>
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
              <span style="color: var(--color-cyan);">${dlMB} MB (${pct}%) • Speed: ${speedText}${remainingText}</span>
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
    
    const hasActiveDownloads = statuses.some(m => m.status === 'Downloading');
    if (hasActiveDownloads) {
      startModelStatusPolling();
    }
  } catch (err) {
    console.error("Failed to load model statuses:", err);
  }
};

window.filterModelsGrid = function() {
  loadModelStatusesGrid();
};

window.downloadModelClick = async function(name) {
  if (!settingsState) return;
  
  try {
    showNotification(`Downloading ggml-${name}.bin...`, "info");
    
    await invoke('start_download_model_task', {
      cloneDir: settingsState.cloneDir,
      modelName: name
    });
    
    // Refresh UI and start active polling
    await loadModelStatusesGrid();
    startModelStatusPolling();
  } catch (err) {
    showNotification("Failed to start download: " + err, "error");
  }
};

window.pauseModelClick = async function(name) {
  try {
    await invoke('pause_download_model', { modelName: name });
    showNotification(`Paused ggml-${name}.bin download`, "info");
    await loadModelStatusesGrid();
  } catch (err) {
    showNotification("Failed to pause download: " + err, "error");
  }
};

window.deleteModelClick = async function(name) {
  const confirm = window.confirm(`Are you sure you want to delete / discard the model ggml-${name}.bin?`);
  if (!confirm) return;
  
  try {
    await invoke('delete_model_file', {
      cloneDir: settingsState.cloneDir,
      modelName: name
    });
    showNotification(`Deleted ggml-${name}.bin`, "success");
    await loadModelStatusesGrid();
    // Scan configuration dropdown to sync options
    await scanAndPopulateModels();
  } catch (err) {
    showNotification("Failed to delete model: " + err, "error");
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
  lineEl.innerHTML = `
    <span class="transcript-time">${timeRange}</span>
    <div class="transcript-text">
      <input type="text" class="transcript-text-input" value="${escapeHTML(cleanText)}" onchange="updateTranscriptLineText(${lineObj.id}, this.value)" />
    </div>
  `;
  viewport.appendChild(lineEl);
  viewport.scrollTop = viewport.scrollHeight;
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

window.copyTranscriptToClipboard = async function() {
  if (transcriptLines.length === 0) {
    showNotification("No transcript text to copy.", "info");
    return;
  }
  
  const textToCopy = transcriptLines
    .map(l => l.text)
    .join('\n');
    
  try {
    await invoke('copy_to_clipboard', { text: textToCopy });
    showNotification("Transcript copied to clipboard!", "success");
  } catch (err) {
    showNotification("Failed to copy transcript: " + err, "error");
  }
};

