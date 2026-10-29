import { hardsubController } from './hardsub.ts';
import { translationStudioController } from './translationStudio.ts';
import { logsController } from './modules/logsController.ts';
import { themeManager } from './modules/themeManager.ts';
import { modelHub } from './modules/modelHub.ts';
import { transcriptViewer } from './modules/transcriptViewer.ts';
import { CustomSelect, customSelectsMap, initializeCustomSelects, syncCustomSelects, customSelect } from './modules/customSelect.ts';
import {
  batchProcessor,
  formatDuration,
  updateBatchSpecs,
  removeFileFromBatch,
  clearBatchQueue,
  moveBatchItemUp,
  moveBatchItemDown,
  sortBatchQueue,
  selectBatchItemTranscript,
  renderBatchQueueTable,
  runBatchExtraction,
  abortBatchExtraction,
  addBatchFiles
} from './modules/batchProcessor.ts';
import {
  translationProviders,
  populateProvidersDropdown,
  renderProvidersGrid,
  onProviderChanged,
  togglePasswordVisibility,
  switchProviderTab,
  saveActiveProviderGeneral,
  deleteProviderByName,
  deleteActiveProvider,
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  isReasoningSupportedModel,
  changeModelsPageSize,
  updateFilterCounts,
  clearModelsSearch,
  renderModelsRegistryTable,
  setActiveModelFromTable,
  toggleSortModels,
  changeModelsPage,
  applyModelsFilterAndRender,
  addManualModelRow,
  fetchActiveProviderModels,
  saveActiveProviderModels,
  filterModelsTable,
  filterModelsStatus,
  openAddProviderModal,
  closeProviderModal,
  saveProviderConfig,
  showBatchErrorDialog,
  setupTranslationEventListeners,
  handleTestModalBackdropClick,
  abortAndCloseTestModal,
  closeTestModal,
  testTranslationConnection,
  toggleTranslationSubSettingsVisibility
} from './modules/translationProviders.ts';
import {
  appModal,
  showNotification,
  showAppModal,
  closeAppModal,
  showConfirmModal,
  resolveAppConfirm,
  openAboutModal,
  closeAboutModal,
  checkForAppUpdates,
  renderUpdateCheckerUI,
  syncAppVersionUI,
  formatToastMessage,
  _trapModalFocus
} from './modules/appModal.ts';
import {
  nativeWindow,
  getBasename,
  getParentDir,
  splitFileNameAndExt,
  formatFileNameMiddleTruncate,
  updateMediaCardName,
  formatLocalizedTimeDuration,
  setTranscribeStatusBadge,
  copyToClipboard,
  openFileInEditor,
  hasActiveBackgroundJob,
  updateTaskbarProgress,
  setupTitlebar
} from './modules/nativeWindow.ts';
import { initI18n, t, setLanguage, getLanguage, translateDOM, isRtlLanguage, firstStrongDirection, applyTextDirection, applyContentDirection, clearContentDirection, isolateDirection, isolateLtr, APP_NAME } from './i18n/index.ts';
import { normalizeForSearch } from './languages.ts';
import { initLanguageSelects, renderLanguageSelect } from './languageSelect.ts';
import { recommendModelsForSystem } from './modelRecommender.ts';

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

// ----------------- Feedback, Modals & Native Window Helpers -----------------
// Extracted to src/modules/appModal.ts and src/modules/nativeWindow.ts

window.addEventListener('whisper:languageChanged', () => {
  renderUpdateCheckerUI();
  if (typeof window.updateFilterCounts === 'function') {
    window.updateFilterCounts();
  }
  if (settingsState && typeof window.renderProvidersGrid === 'function') {
    window.renderProvidersGrid();
  }
  if (settingsState && typeof window.applyModelsFilterAndRender === 'function' && translationProviders.getModels().length > 0) {
    window.applyModelsFilterAndRender(0);
  }
  if (typeof probedMetadata !== 'undefined' && probedMetadata && probedMetadata.exists) {
    renderMediaMetadata(probedMetadata);
  }
  if (batchProcessor.getIsBatchMode() && typeof renderBatchQueueTable === 'function' && Array.isArray(batchProcessor.getItems()) && batchProcessor.getItems().length > 0) {
    const fileNameEl = document.getElementById('lbl-file-name');
    if (fileNameEl) {
      fileNameEl.textContent = t('transcribe.batchModeActive');
      fileNameEl.removeAttribute('title');
    }
    renderBatchQueueTable();
  }
  const msgEl = document.getElementById('lbl-radial-msg');
  if (msgEl) {
    if (msgEl.dataset.batchSummaryTotal) {
      msgEl.textContent = t('transcribe.batchCompletedSummary', {
        success: Number(msgEl.dataset.batchSummarySuccess || 0),
        total: Number(msgEl.dataset.batchSummaryTotal || 0)
      });
    } else if (msgEl.dataset.statusCompleted === 'true') {
      msgEl.textContent = t('transcribe.progressComplete');
    }
  }
  const analyticTimeEl = document.getElementById('analytic-time');
  if (analyticTimeEl && analyticTimeEl.dataset.elapsedSeconds) {
    analyticTimeEl.textContent = formatLocalizedTimeDuration(parseFloat(analyticTimeEl.dataset.elapsedSeconds));
  }
});

// ----------------- About Modal & Confirmation Modals -----------------
// Extracted to src/modules/appModal.ts

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
      vadMaxSpeech: 30.0,
      vadSpeechPad: 30,
      vadOverlap: 0.10
    };
  }
  if (cmd === 'reset_whisper_core_settings') {
    const defaults = {
      language: "auto",
      prompt: "",
      carryPrompt: false,
      temperature: 0.0,
      temperatureInc: 0.2,
      noFallback: false,
      debugMode: false,
      translate: false,
      diarize: false,
      tinyDiarize: false,
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
      dtwEnabled: false,
      logScore: false,
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
      selectedBackend: 'Standard',
      flashAttn: true,
      deviceId: 0,
      ovDevice: "CPU",
      vad: false,
      vadModel: "ggml-silero-v6.2.0.bin",
      vadThold: 0.50,
      vadMinSpeech: 250,
      vadMinSil: 100,
      vadMaxSpeech: 30.0,
      vadSpeechPad: 30,
      vadOverlap: 0.10
    };
    return Object.assign({}, settingsState || {}, defaults);
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
window.invoke = invoke;

const listen = function(event, handler) {
  if (originalListen) {
    return originalListen(event, handler);
  }
  console.warn(`[Fallback] Mocking event listener: ${event}`);
  return Promise.resolve(() => {});
};

// ----------------- Native Clipboard & File Naming Helpers -----------------
// Extracted to src/modules/nativeWindow.ts

// Global States
let activeView = 'transcribe';
let activeSettingsCat = 'app';
let settingsState = null;
let compiledBackends = {};
let systemSpecs = null;

let selectedMediaFile = null;
let probedMetadata = null;
let wavPathForTranscription = null;
let localScannedTransModels = [];
let localScannedVadModels = [];

// Transcription State variables
let isTranscribing = false;
let _unlistenFns = [];

window.getCurrentSourceMediaFile = function() {
  if (batchProcessor.getIsBatchMode() && batchProcessor.getActiveViewerIndex() >= 0 && batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()]) {
    return batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()].path;
  }
  const batchFiles = batchProcessor.getSelectedFiles();
  return selectedMediaFile || (batchFiles && batchFiles.length > 0 ? batchFiles[0] : null) || (window.settingsState?.inputFile || null);
};

// ----------------- Taskbar Progress & Titlebar Controls -----------------
// Extracted to src/modules/nativeWindow.ts



// ----------------- Custom Dropdown Component -----------------
// Extracted to src/modules/customSelect.ts

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

// ----------------- UI Scaling & Zoom Engine + Multi-Theme Engine -----------------
// Extracted to src/modules/themeManager.ts
const applyUiZoom = themeManager.applyUiZoom;
const adjustUiZoom = themeManager.adjustUiZoom;
const setUiZoom = themeManager.setUiZoom;
const applyTheme = themeManager.applyTheme;
const resolveThemeConfig = themeManager.resolveTheme;
const isMonochromeCanvasActive = themeManager.isMonochromeCanvasActive;
const applyMonochromeCanvas = themeManager.applyMonochromeCanvas;
const toggleTheme = themeManager.toggleTheme;
const handleThemeSegmentClick = themeManager.handleThemeSegmentClick;
const switchTheme = themeManager.switchTheme;
const setupZoomKeyboardShortcuts = themeManager.setupShortcuts;

// ----------------- Central Activity Logging Center -----------------
// Extracted to src/modules/logsController.ts
const appendLogToViewport = logsController.appendLogToViewport;
const stripAnsi = logsController.stripAnsi;
const escapeHTML = logsController.escapeHTML;
const scrollLogsToBottom = logsController.scrollBottom;
const scrollLogsToTop = logsController.scrollTop;
const updateLogJumpPillVisibility = logsController.updateLogJumpPillVisibility;
const setupLogsControls = logsController.setup;
const filterLogs = logsController.filter;
const handleLogSearch = logsController.search;
const getFilteredLogs = logsController.getFilteredLogs;
const scheduleUpdateLogsButtonsState = logsController.scheduleUpdateButtons;
const updateLogsButtonsState = logsController.updateButtonsState;
const redrawLogsViewport = logsController.redraw;
const copyAllLogs = logsController.copyAll;
const clearLogsHistory = logsController.clearHistory;

// ----------------- Model Hub & Management Center -----------------
// Extracted to src/modules/modelHub.ts
const MODEL_ICON_DOWNLOAD = modelHub.ICONS.DOWNLOAD;
const MODEL_ICON_DELETE = modelHub.ICONS.DELETE;
const MODEL_ICON_PAUSE = modelHub.ICONS.PAUSE;
const MODEL_ICON_RESUME = modelHub.ICONS.RESUME;
const getModelMetaInfo = modelHub.getMetaInfo;
const formatModelDownloadProgress = modelHub.formatProgress;
const formatRemainingTime = modelHub.formatRemainingTime;
const switchModelQuickFilter = modelHub.setQuickFilter;
const switchModelCategory = modelHub.setCategory;
const clearModelSearch = modelHub.clearSearch;
const loadModelStatusesGrid = modelHub.loadStatuses;
const filterModelsGrid = modelHub.filter;
const downloadModelClick = modelHub.download;
const pauseModelClick = modelHub.pause;
const deleteModelClick = modelHub.delete;
const invalidateModelStatusesCache = modelHub.invalidateCache;
window.scanAndPopulateModels = scanAndPopulateModels;

// ----------------- Live Transcript Viewer Helper Functions -----------------
// Extracted to src/modules/transcriptViewer.ts
const autoResizeTranscriptField = transcriptViewer.autoResize;
const setupTranscriptDirection = transcriptViewer.setupDirection;
const parseTranscriptTimeRange = transcriptViewer.parseTimeRange;
const renderTranscriptLines = transcriptViewer.render;
const appendTranscriptLine = transcriptViewer.appendLine;
const filterTranscriptLines = transcriptViewer.filter;
const formatMsToTimestamp = transcriptViewer.formatMs;
const parseTimestampStringToMs = transcriptViewer.parseTimestamp;
const parseSegmentTimestamps = transcriptViewer.parseSegments;
const loadTranscriptFromFile = transcriptViewer.loadFromFile;
const copyLiveTranscriptToClipboard = transcriptViewer.copy;

// Legacy and module proxy getter/setters on window for cross-module state access
if (typeof window !== 'undefined') {
  Object.defineProperties(window, {
    transcriptLines: {
      get() { return transcriptViewer.lines; },
      set(val) { transcriptViewer.lines = val; },
      configurable: true
    },
    selectedMediaFile: {
      get() { return selectedMediaFile; },
      set(val) { selectedMediaFile = val; },
      configurable: true
    },
    isBatchMode: {
      get() { return batchProcessor.getIsBatchMode(); },
      set(val) { batchProcessor.setIsBatchMode(val); },
      configurable: true
    },
    isBatchExtracting: {
      get() { return batchProcessor.getIsExtracting(); },
      set(val) { batchProcessor.setIsExtracting(val); },
      configurable: true
    },
    batchItems: {
      get() { return batchProcessor.getItems(); },
      set(val) { batchProcessor.setItems(val); },
      configurable: true
    },
    batchProcessingIndex: {
      get() { return batchProcessor.getProcessingIndex(); },
      set(val) { batchProcessor.setProcessingIndex(val); },
      configurable: true
    },
    activeBatchViewerIndex: {
      get() { return batchProcessor.getActiveViewerIndex(); },
      set(val) { batchProcessor.setActiveViewerIndex(val); },
      configurable: true
    },
    selectedMediaFiles: {
      get() { return batchProcessor.getSelectedFiles(); },
      set(val) { batchProcessor.setSelectedFiles(val); },
      configurable: true
    },
    systemSpecs: {
      get() { return systemSpecs; },
      set(val) { systemSpecs = val; },
      configurable: true
    }
  });
}

async function initApp() {
  console.log("Whisper Desktop UI Initialized!");

  const splashStartTime = performance.now();
  let splashDismissed = false;
  let splashFailSafeTimer = null;

  const dismissSplashCurtain = () => {
    if (splashDismissed) return;
    splashDismissed = true;

    if (splashFailSafeTimer) {
      clearTimeout(splashFailSafeTimer);
      splashFailSafeTimer = null;
    }

    const splash = document.getElementById('splash-curtain');
    if (splash) {
      splash.classList.add('splash-leaving');
    }

    document.documentElement.classList.add('app-ready');
    document.documentElement.classList.remove('theme-initializing');

    if (splash) {
      setTimeout(() => {
        try {
          splash.remove();
        } catch (_) {}
      }, 400);
    }
  };

  // Defensive fail-safe curtain release to guarantee UI visibility even on unexpected load errors
  splashFailSafeTimer = setTimeout(dismissSplashCurtain, 5000);
  
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Decouple entrance animation from JavaScript execution:
  // Allow the 850ms entrance animation to run with 0% main-thread CPU contention for butter-smooth 60/120fps motion
  if (!prefersReducedMotion) {
    await new Promise(resolve => setTimeout(resolve, 850));
  }
  
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

  // Setup capturing scroll activity listener for all scrollable containers across the application
  document.addEventListener('scroll', (e) => {
    const target = e.target;
    if (target && target.classList && typeof target.classList.add === 'function') {
      target.classList.add('scrolling-active');
      clearTimeout(target._scrollTimer);
      target._scrollTimer = setTimeout(() => {
        target.classList.remove('scrolling-active');
      }, 1500);
    }
  }, { capture: true, passive: true });
  
  // Initialize Custom Select components
  initializeCustomSelects();
  
  // Initialize Number Stepper Controls for keyboard and wheel input
  setupNumberInputControls();
  
  // Setup Tauri Listeners
  setupTauriListeners();
  
  // Initial load settings from disk first so theme & language are applied immediately
  await refreshSettings();

  // Seamless Zero-FOUC Reveal: Complete branded splash animation before revealing the hydrated UI
  const targetSplashDuration = prefersReducedMotion ? 100 : 1150;
  const elapsed = performance.now() - splashStartTime;
  const remaining = Math.max(0, targetSplashDuration - elapsed);

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }

  dismissSplashCurtain();

  // Load system specs to guide recommendation engine
  try {
    systemSpecs = await invoke('get_system_specs');
  } catch (e) {
    console.error("Failed to load system specs on startup:", e);
    systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
  }
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
            logsController.push({
              timestamp: match[1],
              category: match[2],
              message: match[3]
            });
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to load initial logs:", e);
  }
  redrawLogsViewport();
  setupLogsControls();
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
    updateLogsButtonsState();
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
      } else if (!batchProcessor.getItems() || batchProcessor.getItems().length === 0) {
        updateMediaCardName(null);
        filePathEl.textContent = t('transcribe.selectFilePrompt');
      } else if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
        fileNameEl.textContent = `${batchProcessor.getItems().length} ${t('transcribe.queueFiles')}`;
      }
    }
    
    const nextStep2Btn = document.getElementById('btn-next-step-2');
    if (nextStep2Btn) {
      if (batchProcessor.getItems() && batchProcessor.getItems().length > 0) {
        nextStep2Btn.textContent = t('transcribe.continueToBatchSetup');
      } else {
        nextStep2Btn.textContent = t('transcribe.continueToTranscription');
      }
    }

    // Keep batch queue table and specs translated without affecting data
    if (batchProcessor.getItems() && batchProcessor.getItems().length > 0) {
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

    // Maintain content-based direction on prompt and search inputs independent of UI language
    const promptInput = document.getElementById('opt-prompt');
    if (promptInput) {
      applyDynamicDirection(promptInput);
    }
    const appSearchIds = [
      'settings-search-input',
      'mgr-models-search',
      'model-search',
      'transcript-search',
      'log-search',
      'hardsub-search-input'
    ];
    appSearchIds.forEach(id => {
      const input = document.getElementById(id);
      if (input) applyDynamicDirection(input);
    });

    // Update backend options labels on opt-selectedBackend in settings if present
    const settingsBackendSelect = document.getElementById('opt-selectedBackend');
    if (settingsBackendSelect) {
      Array.from(settingsBackendSelect.options).forEach(opt => {
        if (opt.value === 'Standard') opt.textContent = t('transcribe.backendCpu');
        else if (opt.value === 'Vulkan') opt.textContent = t('transcribe.backendVulkan');
        else if (opt.value === 'CUDA') opt.textContent = t('transcribe.backendCuda');
        else if (opt.value === 'OpenVINO') opt.textContent = t('transcribe.backendOpenvino');
      });
    }

    if (typeof syncCustomSelects === 'function') {
      syncCustomSelects();
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

    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons();
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

  // Wire up dynamic content direction on all search inputs across the application
  const appSearchIds = [
    'settings-search-input',
    'mgr-models-search',
    'model-search',
    'transcript-search',
    'log-search',
    'hardsub-search-input'
  ];
  appSearchIds.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      applyDynamicDirection(input);
      if (!input._hasDynamicDirListener) {
        input._hasDynamicDirListener = true;
        input.addEventListener('input', () => applyDynamicDirection(input));
      }
    }
  });

  // Trigger initial synchronization of dynamic components for startup language
  const isRtl = typeof isRtlLanguage === 'function' ? isRtlLanguage(getLanguage()) : (getLanguage() === 'fa' || getLanguage() === 'ar');
  window.dispatchEvent(new CustomEvent('whisper:languageChanged', { detail: { language: getLanguage(), isRtl } }));

  window.saveCurrentSettings = saveCurrentSettings;

  // Initialize dynamic version display from package.json
  syncAppVersionUI();

  // Switch to default transcribe view
  switchView('transcribe');
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(false);
  }

  // Lift the initial startup transition freeze after first layout has completed
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove('theme-initializing');
    });
  });
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
    if (viewName === 'transcribe') {
      requestAnimationFrame(() => {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.querySelectorAll('.transcript-text-input').forEach(autoResizeTranscriptField);
        }
      });
    } else if (viewName === 'logs') {
      requestAnimationFrame(() => {
        const viewport = document.getElementById('log-viewport');
        const autoScroll = document.getElementById('log-autoscroll');
        if (viewport && (!autoScroll || autoScroll.checked)) {
          viewport.scrollTop = viewport.scrollHeight;
        }
        if (typeof updateLogJumpPillVisibility === 'function') {
          updateLogJumpPillVisibility();
        }
      });
    }
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

  if (viewName === 'models') {
    // Always reset search input and default to Recommended category when entering the view
    if (typeof switchModelCategory === 'function') {
      switchModelCategory('recommended', true);
    } else {
      loadModelStatusesGrid();
    }
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



  function mapTranscribeStatusKey(payload) {
    if (!payload) return null;
    if (payload.stage) {
      switch (payload.stage) {
        case 'converting': return 'transcribe.convertingAudio16k';
        case 'wav_ready': return 'transcribe.wavReadyTranscribing';
        case 'model_init': return 'transcribe.progressTranscribe';
        case 'transcribing': return 'transcribe.aiTranscribingStatus';
        case 'completed': return 'transcribe.progressComplete';
        case 'aborted': return 'transcribe.cancelled';
        case 'failed': return 'transcribe.taskFailed';
      }
    }
    const msg = (typeof payload.message === 'string') ? payload.message : '';
    if (msg.includes('Converting to 16kHz WAV')) return 'transcribe.convertingAudio16k';
    if (msg.includes('Conversion complete')) return 'transcribe.wavReadyTranscribing';
    if (msg.includes('Running Whisper AI model')) return 'transcribe.progressTranscribe';
    if (msg.startsWith('Transcribing:')) return 'transcribe.aiTranscribingStatus';
    if (msg.includes('Transcription successfully completed')) return 'transcribe.progressComplete';
    if (msg === 'Aborted') return 'transcribe.cancelled';
    if (msg === 'Task Failed') return 'transcribe.taskFailed';
    return null;
  }

  // Transcription progress
  on('transcribe-status', (event) => {
    const payload = event.payload;
    if (!payload) return;
    window.isTranscriptionRunning = !!payload.active;
    if (typeof window.updateTaskbarProgress === 'function') {
      window.updateTaskbarProgress(payload.progress, payload.active);
    }
    
    const fillBar = document.getElementById('progress-linear-fill');
    const pctEl = document.getElementById('lbl-radial-pct');
    const msgEl = document.getElementById('lbl-radial-msg');
    
    if (payload.stage === 'aborted' || payload.message === 'Aborted') {
      const telemetryCard = document.getElementById('telemetry-hud-card');
      if (telemetryCard) telemetryCard.style.display = 'none';
      if (fillBar) fillBar.style.width = '0%';
      if (pctEl) pctEl.textContent = '0%';
      setTranscribeStatusBadge('', 'transcribe.standingBy');
      return;
    }

    const pct = (payload.progress * 100).toFixed(0);
    
    if (fillBar) fillBar.style.width = `${pct}%`;
    if (pctEl) {
      pctEl.removeAttribute('data-i18n');
      pctEl.textContent = `${pct}%`;
    }
    
    if (msgEl) {
      if (batchProcessor.getIsBatchMode() && payload.stage === 'completed') {
        // In batch mode, single file completion is orchestrated by the batch queue
      } else {
        const i18nKey = mapTranscribeStatusKey(payload);
        if (i18nKey) {
          delete msgEl.dataset.batchSummarySuccess;
          delete msgEl.dataset.batchSummaryTotal;
          delete msgEl.dataset.statusCompleted;
          msgEl.setAttribute('data-i18n', i18nKey);
          msgEl.textContent = t(i18nKey);
        } else if (payload.message) {
          delete msgEl.dataset.batchSummarySuccess;
          delete msgEl.dataset.batchSummaryTotal;
          delete msgEl.dataset.statusCompleted;
          msgEl.removeAttribute('data-i18n');
          msgEl.textContent = isolateDirection(payload.message);
        }
      }
    }
    
    if (payload.active) {
      setTranscribeStatusBadge('active', 'transcribe.statusExtracting');
    }
  });

  on('translation-status', (event) => {
    const payload = event.payload;
    if (!payload) return;
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
    if (pctEl) {
      pctEl.removeAttribute('data-i18n');
      pctEl.textContent = payload.active ? `${pct}%` : (progressVal >= 1 ? '100%' : '0%');
    }
    if (msgEl && payload.message) {
      const msg = payload.message;
      delete msgEl.dataset.batchSummarySuccess;
      delete msgEl.dataset.batchSummaryTotal;
      if (msg.includes('Translating with AI') || msg.includes('Translating AI:')) {
        msgEl.setAttribute('data-i18n', 'transcribe.aiTranslating');
        msgEl.textContent = t('transcribe.aiTranslating');
      } else if (msg.includes('AI translation complete')) {
        msgEl.setAttribute('data-i18n', 'translate.statusComplete');
        msgEl.textContent = t('translate.statusComplete');
      } else if (msg.includes('Translation cancelled')) {
        msgEl.setAttribute('data-i18n', 'translate.statusCancelled');
        msgEl.textContent = t('translate.statusCancelled');
      } else {
        msgEl.removeAttribute('data-i18n');
        msgEl.textContent = isolateDirection(payload.message);
      }
    }

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
      const totalMB = ((payload.totalBytes || 0) / 1048576).toFixed(0);
      const totalKnown = payload.totalBytes > 0;
      const dlBytes = Math.max(0, payload.downloadedBytes || 0);

      // 1. Progress bar & status display in-place
      const progressBlock = card.querySelector('.model-progress-block');
      if (progressBlock) progressBlock.style.display = 'block';
      const barContainer = card.querySelector('.progress-bar-container');
      if (barContainer) barContainer.style.display = 'block';
      const barFill = card.querySelector('.progress-bar-fill');
      if (barFill) {
        barFill.style.width = `${pct}%`;
        barFill.style.background = 'var(--color-cyan)';
        barFill.style.boxShadow = 'var(--shadow-neon-cyan)';
      }

      // 2. Status text above progress bar (clean progress + smooth ETA without speed noise)
      const isConnecting = payload.phase === 'starting' || payload.speedBps <= 0;

      if (!isConnecting && totalKnown && dlBytes <= payload.totalBytes) {
        const rawSeconds = (payload.totalBytes - dlBytes) / payload.speedBps;
        if (rawSeconds > 0 && isFinite(rawSeconds)) {
          if (!card._smoothedEtaSeconds || card._smoothedEtaSeconds <= 0) {
            card._smoothedEtaSeconds = rawSeconds;
          } else {
            // Exponential moving average: 85% previous smoothed, 15% new sample to eliminate jitter
            card._smoothedEtaSeconds = 0.85 * card._smoothedEtaSeconds + 0.15 * rawSeconds;
          }
        }
      }

      let liveStatus = '';
      if (dlBytes <= 0) {
        card._smoothedEtaSeconds = null;
        liveStatus = payload.phase === 'starting' ? t('models.statusStarting') : t('models.statusConnecting');
      } else {
        const prefix = formatModelDownloadProgress(dlBytes, payload.totalBytes, pct);
        if (isConnecting) {
          card._smoothedEtaSeconds = null;
          liveStatus = `${prefix} • ${t('models.statusConnecting')}`;
        } else if (card._smoothedEtaSeconds && card._smoothedEtaSeconds > 0) {
          const etaText = t('models.etaLabel', { time: formatRemainingTime(card._smoothedEtaSeconds) });
          liveStatus = `${prefix} • ${isolateDirection(etaText)}`;
        } else {
          const inProgressSuffix = (t('models.statusInProgress', { size: '', pct: '' }).split('•')[1] || t('models.statusConnecting')).trim();
          liveStatus = `${prefix} • ${inProgressSuffix}`;
        }
      }

      // Manage stall detection watchdog (switches to connecting state if stream stalls for >= 3s)
      window._modelStallTimers = window._modelStallTimers || {};
      if (window._modelStallTimers[payload.modelName]) {
        clearTimeout(window._modelStallTimers[payload.modelName]);
        delete window._modelStallTimers[payload.modelName];
      }
      if (!isConnecting && payload.phase === 'downloading') {
        window._modelStallTimers[payload.modelName] = setTimeout(() => {
          const targetCard = document.querySelector(`[data-model="${CSS.escape(payload.modelName)}"]`);
          if (targetCard && targetCard.querySelector('.model-btn-pause')) {
            const statusEl = targetCard.querySelector('.model-progress-status');
            if (statusEl) {
              targetCard._smoothedEtaSeconds = null;
              if (dlBytes <= 0) {
                statusEl.innerHTML = t('models.statusConnecting');
              } else {
                const prefix = formatModelDownloadProgress(dlBytes, payload.totalBytes, pct);
                statusEl.innerHTML = `${prefix} • ${t('models.statusConnecting')}`;
              }
            }
          }
        }, 3000);
      }

      let statusEl = card.querySelector('.model-progress-status');
      if (!statusEl && barContainer) {
        statusEl = document.createElement('div');
        statusEl.className = 'model-progress-status status-downloading';
        barContainer.parentNode.insertBefore(statusEl, barContainer);
      }
      const nowTime = Date.now();
      const lastTextUpdate = card._lastStatusTextUpdate || 0;
      const isPhaseChange = card._lastPhase !== payload.phase || card._lastIsConnecting !== isConnecting;
      if (nowTime - lastTextUpdate >= 650 || isPhaseChange) {
        card._lastStatusTextUpdate = nowTime;
        card._lastPhase = payload.phase;
        card._lastIsConnecting = isConnecting;
        if (statusEl) {
          statusEl.innerHTML = liveStatus;
          statusEl.classList.remove('status-paused');
          statusEl.classList.add('status-downloading');
          statusEl.style.color = '';
        }
      }

      // 3. Keep description metadata clean without dynamic metrics
      const descEl = card.querySelector('.setting-desc');
      if (descEl && (!descEl.querySelector('.badge-downloading') || descEl.querySelector('span[style*="var(--color-cyan)"]'))) {
        const meta = getModelMetaInfo(payload.modelName);
        const displayedSizeMB = totalKnown
          ? Math.max(1, Math.round(payload.totalBytes / 1048576))
          : (card.dataset.sizeMb || totalMB);
        descEl.innerHTML = `
          <span class="model-badge badge-downloading">${t('models.badgeDownloading')}</span>
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span>${t('models.expectedSize', { size: window.formatNumberForLang(displayedSizeMB) })}</span>
          ${meta.precisionText ? `
            <span style="color: rgba(255,255,255,0.1);">|</span>
            <span>${meta.precisionText}</span>
          ` : ''}
          <span style="color: rgba(255,255,255,0.1);">|</span>
          <span>${meta.langText}</span>
        `;
      }

      // 3. Ensure button is "Pause" in-place
      const ctrlEl = card.querySelector('.setting-control');
      if (ctrlEl && !ctrlEl.querySelector('[data-action="pause"]')) {
        ctrlEl.innerHTML = `<button class="model-action-btn model-btn-pause" data-action="pause" aria-label="${t('models.ariaPauseDownload', { name: escapeHTML(payload.modelName) })}">${MODEL_ICON_PAUSE}<span>${t('models.actionPause')}</span></button>`;
      }
      // If card is NOT in current view/tab, do NOTHING to prevent tab re-rendering!
    } else {
      if (window._modelStallTimers && window._modelStallTimers[payload.modelName]) {
        clearTimeout(window._modelStallTimers[payload.modelName]);
        delete window._modelStallTimers[payload.modelName];
      }
      window.isDownloadingModelRunning = false;
      if (typeof window.updateTaskbarProgress === 'function') {
        window.updateTaskbarProgress(0, false, payload.phase === 'failed' ? 'error' : 'normal');
      }

      // paused / completed / failed -> Reload grid state once
      if (typeof invalidateModelStatusesCache === 'function') {
        invalidateModelStatusesCache();
      }
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
    logsController.push(payload);
    scheduleUpdateLogsButtonsState();
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
    { key: 'Standard', label: (typeof t === 'function' && t('transcribe.backendCpu')) || 'CPU' },
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
      if (typeof invalidateModelStatusesCache === 'function') {
        invalidateModelStatusesCache();
      }
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
    applyDynamicDirection(searchInput);
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
    applyDynamicDirection(searchInput);
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
  const searchInput = document.getElementById('settings-search-input');
  if (searchInput) {
    applyDynamicDirection(searchInput);
  }
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

    // Apply Monochrome Canvas from loaded settings (or localStorage cache)
    const isMonochrome = (settingsState && typeof settingsState.monochromeCanvas === 'boolean')
      ? settingsState.monochromeCanvas
      : (localStorage.getItem('whisper_monochrome_canvas') === 'true');
    applyMonochromeCanvas(isMonochrome, true);

    // Apply Color Theme from loaded settings and sync localStorage cache
    const currentTheme = (settingsState && settingsState.theme) ? settingsState.theme : 'royal-blue';
    applyTheme(currentTheme);
    try {
      localStorage.setItem('whisper_theme_cache', currentTheme);
    } catch (_) {}

    // Apply UI Language from loaded settings if specified (disk config is authoritative)
    if (settingsState && settingsState.uiLanguage) {
      try {
        localStorage.setItem('whisper_language', settingsState.uiLanguage);
      } catch (_) {}
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
  const autoTransferCheckbox = document.getElementById('opt-autoTransferToTranslate') || document.getElementById('opt-translateAiEnabled');
  if (autoTransferCheckbox) {
    autoTransferCheckbox.checked = !!(settingsState.autoTransferToTranslate ?? settingsState.translateAiEnabled);
    autoTransferCheckbox.onchange = () => {
      settingsState.autoTransferToTranslate = autoTransferCheckbox.checked;
      settingsState.translateAiEnabled = autoTransferCheckbox.checked;
      saveCurrentSettings();
    };
  }

  const keys = Object.keys(settingsState);
  keys.forEach(key => {
    const el = document.getElementById(`opt-${key}`);
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = settingsState[key];
        el.onchange = () => {
          settingsState[key] = el.checked;
          if (key === 'autoTransferToTranslate' || key === 'translateAiEnabled') {
            settingsState.autoTransferToTranslate = el.checked;
            settingsState.translateAiEnabled = el.checked;
          }
          if (key === 'monochromeCanvas') {
            applyMonochromeCanvas(el.checked, true);
          }
          saveCurrentSettings();
          if (key === 'vad') {
            const quickVadInput = document.getElementById('quick-toggle-vad');
            if (quickVadInput) quickVadInput.checked = el.checked;
            updateTranscribeUIConfigs();
          }
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
            if (isNaN(val)) val = (key === 'maxContext') ? -1 : 0;
            if (key === 'bestOf' || key === 'beamSize') {
              val = Math.max(1, Math.min(8, val));
              el.value = val;
            }
          } else if (FLOAT_SETTING_KEYS.has(key)) {
            val = parseFloat(el.value);
            if (isNaN(val)) {
              val = (key === 'vadMaxSpeech') ? 30.0 : 0.0;
            } else if (key === 'vadMaxSpeech') {
              if (val <= 0.0 || val >= 1000.0) {
                val = 30.0;
              } else {
                val = Math.max(1.0, Math.min(300.0, val));
              }
              el.value = val;
            }
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
          if (key === 'modelPath' || key === 'threads') {
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

function formatFFmpegVersion(versionStr) {
  if (!versionStr || versionStr === 'Unknown version' || versionStr === 'N/A') {
    return 'Ready';
  }
  const match = versionStr.match(/version\s+([^\s]+)/i);
  const raw = match ? match[1] : versionStr.trim();

  // 1. Standard semantic version (e.g., "7.1", "7.1.1", "n7.0", "v6.0-extra", "4.4.2-0ubuntu0")
  const semverMatch = raw.match(/^[nNvV]?(\d+(\.\d+)+)/);
  if (semverMatch) {
    return `v${semverMatch[1]}`;
  }

  // 2. Git daily snapshot builds with dates (e.g., "N-126826-gc0e8b139fd-20260924" or "2024-03-07-git...")
  const dateHyphenMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateHyphenMatch) {
    return `vGit-${dateHyphenMatch[1]}.${dateHyphenMatch[2]}`;
  }
  const dateCompactMatch = raw.match(/(\d{4})(\d{2})(\d{2})/);
  if (dateCompactMatch) {
    return `vGit-${dateCompactMatch[1]}.${dateCompactMatch[2]}`;
  }

  // 3. Git build number (e.g. "N-126826-g...")
  const buildNumMatch = raw.match(/^[nN]-(\d+)/);
  if (buildNumMatch) {
    return `vGit-${buildNumMatch[1]}`;
  }

  // 4. Fallback cleanup: strip leading 'n'/'v' and trailing tags
  let fallback = raw.split('-')[0].split('_')[0];
  fallback = fallback.replace(/^[nNvV]/, '');
  if (fallback && fallback.length > 0 && !isNaN(Number(fallback))) {
    return `v${fallback}`;
  }

  return 'Ready';
}

async function refreshFFmpegStatus(sourceOverride, userInitiated = false) {
  const badgeEl = document.getElementById('ffmpeg-status-badge');
  if (!badgeEl) return;

  const currentSource = sourceOverride || (settingsState ? settingsState.ffmpegSource : 'bundled');

  try {
    const info = await invoke('get_ffmpeg_status', { source: currentSource });
    if (info.isAvailable) {
      const verFormatted = formatFFmpegVersion(info.version);
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
  if (clean.autoTransferToTranslate !== undefined) {
    clean.translateAiEnabled = Boolean(clean.autoTransferToTranslate);
  } else if (clean.translateAiEnabled !== undefined) {
    clean.autoTransferToTranslate = Boolean(clean.translateAiEnabled);
  }
  for (const key of Object.keys(clean)) {
    if (INT_SETTING_KEYS.has(key)) {
      const parsed = parseInt(clean[key]);
      clean[key] = isNaN(parsed) ? (key === 'maxContext' ? -1 : 0) : parsed;
    } else if (FLOAT_SETTING_KEYS.has(key)) {
      const parsed = parseFloat(clean[key]);
      clean[key] = isNaN(parsed) ? (key === 'vadMaxSpeech' ? 30.0 : 0.0) : parsed;
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
      const parsed = parseInt(settingsState[key]);
      settingsState[key] = isNaN(parsed) ? (key === 'maxContext' ? -1 : 0) : parsed;
    } else if (FLOAT_SETTING_KEYS.has(key) && typeof settingsState[key] === 'string') {
      const parsed = parseFloat(settingsState[key]);
      settingsState[key] = isNaN(parsed) ? (key === 'vadMaxSpeech' ? 30.0 : 0.0) : parsed;
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

window.confirmResetWhisperEngine = async function() {
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const isBusy = (cancelBtn && cancelBtn.style.display !== 'none' && cancelBtn.style.display !== '') || window.isBatchTranscribing;
  if (isBusy) {
    showNotification(t('toasts.taskRunningWarning'), 'warning');
    return;
  }

  const confirmed = await showConfirmModal(
    t('modals.confirmResetEngineTitle'),
    t('modals.confirmResetEngineDesc'),
    t('modals.confirmResetEngineBtn')
  );
  if (!confirmed) return;

  const resetBtn = document.getElementById('btn-reset-whisper-engine');
  const resetIcon = resetBtn ? resetBtn.querySelector('.btn-reset-icon') : null;
  if (resetBtn) resetBtn.disabled = true;
  if (resetIcon) resetIcon.classList.add('is-spinning');

  try {
    const updated = await invoke('reset_whisper_core_settings');
    if (updated) {
      settingsState = updated;
      window.settingsState = updated;
    }
    // Synchronize all settings DOM inputs, selects, and stepper states
    bindSettingsToDOM();
    updateTranscribeUIConfigs();
    if (typeof refreshBuildStatuses === 'function') {
      refreshBuildStatuses();
    }
    showNotification(t('toasts.engineSettingsReset'), 'success');
  } catch (err) {
    console.error('Failed to reset whisper engine settings:', err);
    showNotification(t('toasts.engineSettingsResetError', { error: String(err) }), 'error');
  } finally {
    if (resetIcon) {
      const cleanupSpin = () => {
        resetIcon.classList.remove('is-spinning');
        if (resetBtn) resetBtn.disabled = false;
        resetIcon.removeEventListener('animationend', cleanupSpin);
      };
      resetIcon.addEventListener('animationend', cleanupSpin);
      // Fallback timer for reduced motion or tab-switching edge cases
      setTimeout(cleanupSpin, 700);
    } else if (resetBtn) {
      resetBtn.disabled = false;
    }
  }
};

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
  if (isNaN(num)) num = (inputId === 'opt-maxContext' ? -1 : 0);
  
  const { min, max } = getStepperBounds(inputId);
  if (num < min) num = min;
  if (num > max) num = max;
  return num;
}

window.incrementNumber = function(inputId, step = 1, immediate = false) {
  const el = document.getElementById(inputId);
  if (el) {
    let currentVal = parseInt(el.value);
    if (isNaN(currentVal)) currentVal = (inputId === 'opt-maxContext' ? -1 : 0);
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
    if (isNaN(currentVal)) currentVal = (inputId === 'opt-maxContext' ? -1 : 0);
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
  window.scanAndPopulateModels = scanAndPopulateModels;
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
      if (settingsState.modelPath) {
        settingsState.modelPath = '';
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

    // Save state if auto-selected or cleared
    if ((!modelMatched && transSelect && transSelect.options.length > 0 && transSelect.value) || (!vadMatched && validVadModels.length > 0) || (validModels.length === 0 && !modelMatched)) {
      await saveCurrentSettings();
    }
    
    updateTranscribeUIConfigs();

    // Sync custom dropdown views
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
  } catch (e) {
    console.error("Failed to scan models directory:", e);
    if (window.syncCustomSelects) {
      window.syncCustomSelects();
    }
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
  if (typeof updateTranscribeOutputDirUI === 'function') {
    updateTranscribeOutputDirUI();
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
      if (typeof updateTranscribeOutputDirUI === 'function') {
        updateTranscribeOutputDirUI();
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

let _isBrowsingTranscribeOutputDir = false;

window.browseTranscribeOutputDir = async function() {
  if (_isBrowsingTranscribeOutputDir) return;
  _isBrowsingTranscribeOutputDir = true;
  const browseBtn = document.getElementById('btn-browse-transcribe-dir');
  if (browseBtn) browseBtn.disabled = true;

  try {
    const dir = await invoke('select_directory');
    if (dir) {
      try {
        await invoke('verify_directory_writable', { dirPath: dir });
      } catch (permErr) {
        showNotification(t('toasts.outputDirNotWritable', { error: String(permErr) }), "error");
        return;
      }
      if (settingsState) {
        settingsState.outputDirMode = 'custom';
        settingsState.outputDirPath = dir;
        const optMode = document.getElementById('opt-outputDirMode');
        if (optMode) optMode.value = 'custom';
        const optPath = document.getElementById('opt-outputDirPath');
        if (optPath) {
          optPath.value = dir;
          optPath.title = isolateLtr(dir);
        }
        await saveCurrentSettings();
      }
      updateTranscribeOutputDirUI();
    }
  } catch (err) {
    console.error('Failed to select transcribe output directory:', err);
  } finally {
    if (browseBtn) browseBtn.disabled = false;
    _isBrowsingTranscribeOutputDir = false;
  }
};

window.resetTranscribeOutputDir = async function() {
  const resetBtn = document.getElementById('btn-reset-transcribe-dir');
  if (resetBtn) resetBtn.disabled = true;
  try {
    if (settingsState) {
      settingsState.outputDirMode = 'source';
      settingsState.outputDirPath = '';
      const optMode = document.getElementById('opt-outputDirMode');
      if (optMode) optMode.value = 'source';
      const optPath = document.getElementById('opt-outputDirPath');
      if (optPath) {
        optPath.value = '';
        optPath.removeAttribute('title');
      }
      await saveCurrentSettings();
    }
    updateTranscribeOutputDirUI();
  } finally {
    if (resetBtn) resetBtn.disabled = false;
  }
};

window.updateTranscribeOutputDirUI = function() {
  const dirTextEl = document.getElementById('transcribe-output-dir-text');
  const resetBtn = document.getElementById('btn-reset-transcribe-dir');
  if (!dirTextEl || !resetBtn) return;

  const isCustom = settingsState && settingsState.outputDirMode === 'custom' && settingsState.outputDirPath;
  if (isCustom) {
    dirTextEl.textContent = settingsState.outputDirPath;
    dirTextEl.title = isolateLtr(settingsState.outputDirPath);
    dirTextEl.classList.add('has-custom-path');
    resetBtn.style.display = 'inline-flex';
  } else {
    dirTextEl.textContent = t('transcribe.sameAsSource') || t('translate.sameAsSource') || 'Same as source file folder';
    dirTextEl.removeAttribute('title');
    dirTextEl.classList.remove('has-custom-path');
    resetBtn.style.display = 'none';
  }
};

window.lastTranscribedSubtitlePath = null;
window.lastTranscribedVideoPath = null;
window.lastTranscribedOutputFiles = [];

window.handleOutputFileButtonClick = function(event) {
  event?.stopPropagation();
  const btn = document.getElementById('btn-open-output-file');
  if (!btn || btn.disabled) return;

  const files = window.lastTranscribedOutputFiles || [];
  if (files.length <= 1) {
    const targetPath = files.length === 1 ? files[0].path : window.lastTranscribedSubtitlePath;
    if (targetPath) {
      window.openFileInEditor(targetPath).catch((e) => {
        const msg = (e && (e.message || e.toString())) || String(e);
        showNotification(t('toasts.openFileError', { error: msg }) || msg, "error");
      });
    }
  } else {
    window.toggleOutputFilesDropdown();
  }
};

window.toggleOutputFilesDropdown = function(forceClose) {
  const dropdown = document.getElementById('transcribe-output-files-dropdown');
  if (!dropdown) return;
  const isCurrentlyOpen = dropdown.style.display !== 'none';
  if (forceClose || isCurrentlyOpen) {
    dropdown.style.display = 'none';
    return;
  }
  window.renderOutputFilesDropdown();
  dropdown.style.display = 'flex';
};

window.renderOutputFilesDropdown = function() {
  const dropdown = document.getElementById('transcribe-output-files-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';

  const files = window.lastTranscribedOutputFiles || [];
  files.forEach(file => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'transcribe-output-file-item';
    const displayName = window.formatFileNameMiddleTruncate ? window.formatFileNameMiddleTruncate(file.name, 24) : file.name;

    let badgeText = '';
    let badgeClass = 'file-badge';
    if (file.type === 'translated') {
      badgeText = t('transcribe.translatedSubtitle') || 'Translated';
      badgeClass += ' translated';
    } else if (file.type === 'original' || file.type === 'subtitle') {
      badgeText = t('transcribe.originalSubtitle') || 'Subtitle';
    } else if (file.type === 'text') {
      badgeText = t('transcribe.rawTranscriptText') || 'Text';
    } else if (file.type === 'json') {
      badgeText = 'JSON';
    } else if (file.type === 'csv') {
      badgeText = 'CSV';
    }

    item.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span class="file-name" title="${escapeHTML(file.path)}">${escapeHTML(displayName)}</span>
      ${badgeText ? `<span class="${badgeClass}">${escapeHTML(badgeText)}</span>` : ''}
    `;

    item.onclick = (e) => {
      e.stopPropagation();
      window.toggleOutputFilesDropdown(true);
      window.openFileInEditor(file.path).catch((err) => {
        const msg = (err && (err.message || err.toString())) || String(err);
        showNotification(t('toasts.openFileError', { error: msg }) || msg, "error");
      });
    };

    dropdown.appendChild(item);
  });
};

document.addEventListener('click', (e) => {
  const group = document.getElementById('transcribe-output-file-group');
  if (group && !group.contains(e.target)) {
    window.toggleOutputFilesDropdown(true);
  }
});

window.updateTranscribeWorkflowButtons = function() {
  const btnOpenFolder = document.getElementById('btn-open-output-folder');
  const btnOpenFile = document.getElementById('btn-open-output-file');
  const chevronOpenFile = document.getElementById('chevron-open-output-file');
  const btnSendTranslate = document.getElementById('btn-send-to-translation');
  const btnSendHardsub = document.getElementById('btn-transcribe-send-to-hardsub');
  const btnCopy = document.getElementById('btn-copy-transcript');

  const hasOutputDir = Boolean(window.lastTranscribedOutputDir);
  const hasSubtitle = Boolean(window.lastTranscribedSubtitlePath);
  const outputFiles = window.lastTranscribedOutputFiles || [];
  const hasFiles = outputFiles.length > 0 || hasSubtitle;
  const hasTranscript = Boolean((typeof transcriptLines !== 'undefined' && transcriptLines && transcriptLines.length > 0) || hasSubtitle);

  if (btnCopy) {
    btnCopy.disabled = !hasTranscript;
  }

  if (btnOpenFile) {
    btnOpenFile.disabled = !hasFiles;
    if (outputFiles.length > 1) {
      if (chevronOpenFile) chevronOpenFile.style.display = 'inline-block';
      btnOpenFile.title = t('transcribe.openFile');
      btnOpenFile.removeAttribute('data-i18n-title');
    } else if (hasFiles) {
      if (chevronOpenFile) chevronOpenFile.style.display = 'none';
      const singleName = outputFiles.length === 1 ? outputFiles[0].name : (window.lastTranscribedSubtitlePath ? getBasename(window.lastTranscribedSubtitlePath) : '');
      btnOpenFile.title = singleName ? `${t('transcribe.openFile')}: ${singleName}` : t('transcribe.openFile');
      btnOpenFile.removeAttribute('data-i18n-title');
    } else {
      if (chevronOpenFile) chevronOpenFile.style.display = 'none';
      btnOpenFile.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnOpenFile.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }

  if (btnOpenFolder) {
    btnOpenFolder.disabled = !hasOutputDir;
    if (hasOutputDir) {
      btnOpenFolder.title = isolateLtr(window.lastTranscribedOutputDir);
      btnOpenFolder.removeAttribute('data-i18n-title');
    } else {
      btnOpenFolder.setAttribute('title', t('transcribe.noOutputDirYet') || 'No output folder available yet');
      btnOpenFolder.setAttribute('data-i18n-title', 'transcribe.noOutputDirYet');
    }
  }
  if (btnSendTranslate) {
    btnSendTranslate.disabled = !hasSubtitle;
    if (hasSubtitle) {
      btnSendTranslate.removeAttribute('title');
      btnSendTranslate.removeAttribute('data-i18n-title');
    } else {
      btnSendTranslate.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnSendTranslate.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }
  if (btnSendHardsub) {
    btnSendHardsub.disabled = !hasSubtitle;
    if (hasSubtitle) {
      btnSendHardsub.removeAttribute('title');
      btnSendHardsub.removeAttribute('data-i18n-title');
    } else {
      btnSendHardsub.setAttribute('title', t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet');
      btnSendHardsub.setAttribute('data-i18n-title', 'transcribe.noSubGeneratedYet');
    }
  }
};

window.updateTranscribeActionButtons = function(isTranscribingParam) {
  if (typeof isTranscribingParam === 'boolean') {
    if (!isTranscribingParam) {
      isTranscribing = false;
      batchProcessor.setIsExtracting(false);
    } else if (batchProcessor.getIsBatchMode()) {
      batchProcessor.setIsExtracting(true);
    } else {
      isTranscribing = true;
    }
  }

  const btnRun = document.getElementById('btn-run-transcribe');
  const btnBatch = document.getElementById('btn-run-batch');
  const btnRunSpan = btnRun?.querySelector('span');
  const btnBatchSpan = btnBatch?.querySelector('span');
  const cancelBtn = document.getElementById('btn-cancel-transcribe');
  const cancelBatchBtn = document.getElementById('btn-cancel-batch');

  const hasSingleMedia = Boolean(selectedMediaFile || wavPathForTranscription);
  const hasBatchMedia = Array.isArray(batchProcessor.getItems()) && batchProcessor.getItems().length > 0;
  const isBatchExtracting = batchProcessor.getIsExtracting();

  if (btnRun) {
    const canRun = !isTranscribing && hasSingleMedia;
    btnRun.disabled = !canRun;
    if (isTranscribing) {
      const transcribingText = t('transcribe.transcribingWithAi') || t('transcribe.statusExtracting');
      btnRun.title = transcribingText;
      btnRun.setAttribute('data-i18n-title', 'transcribe.transcribingWithAi');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.transcribingWithAi');
        btnRunSpan.textContent = transcribingText;
      }
    } else if (!hasSingleMedia) {
      btnRun.title = t('toasts.noFileSelected');
      btnRun.setAttribute('data-i18n-title', 'toasts.noFileSelected');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.startAiExtraction');
        btnRunSpan.textContent = t('transcribe.startAiExtraction');
      }
    } else {
      btnRun.title = t('transcribe.startAiExtraction');
      btnRun.setAttribute('data-i18n-title', 'transcribe.startAiExtraction');
      if (btnRunSpan) {
        btnRunSpan.setAttribute('data-i18n', 'transcribe.startAiExtraction');
        btnRunSpan.textContent = t('transcribe.startAiExtraction');
      }
    }
  }

  if (btnBatch) {
    const canRunBatch = !isBatchExtracting && hasBatchMedia;
    btnBatch.disabled = !canRunBatch;
    if (isBatchExtracting) {
      const batchRunningText = t('transcribe.transcribingWithAi') || t('transcribe.batchRunning');
      btnBatch.title = batchRunningText;
      btnBatch.setAttribute('data-i18n-title', 'transcribe.transcribingWithAi');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.transcribingWithAi');
        btnBatchSpan.textContent = batchRunningText;
      }
    } else if (!hasBatchMedia) {
      btnBatch.title = t('toasts.noFileSelected');
      btnBatch.setAttribute('data-i18n-title', 'toasts.noFileSelected');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.startBatchAiExtraction');
        btnBatchSpan.textContent = t('transcribe.startBatchAiExtraction');
      }
    } else {
      btnBatch.title = t('transcribe.startBatchAiExtraction');
      btnBatch.setAttribute('data-i18n-title', 'transcribe.startBatchAiExtraction');
      if (btnBatchSpan) {
        btnBatchSpan.setAttribute('data-i18n', 'transcribe.startBatchAiExtraction');
        btnBatchSpan.textContent = t('transcribe.startBatchAiExtraction');
      }
    }
  }

  if (cancelBtn) {
    const cancelSpan = cancelBtn.querySelector('span');
    if (cancelSpan) {
      cancelSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
      cancelSpan.textContent = t('transcribe.cancelTranscription');
    }
  }
  if (cancelBatchBtn) {
    const cancelBatchSpan = cancelBatchBtn.querySelector('span');
    if (cancelBatchSpan) {
      cancelBatchSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
      cancelBatchSpan.textContent = t('transcribe.cancelTranscription');
    }
  }
};

window.sendTranscribeToTranslationStudio = async function() {
  const subToLoad = window.lastTranscribedSubtitlePath;
  if (!subToLoad) {
    showNotification(t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet', 'error');
    return;
  }

  const controller = window.translationStudioController || translationStudioController;
  if (controller && typeof controller.loadSubtitleFile === 'function') {
    await controller.loadSubtitleFile(subToLoad);
    const videoToLoad = window.lastTranscribedVideoPath;
    if (videoToLoad && typeof controller.setCompanionVideo === 'function') {
      const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.webm'].some(ext => videoToLoad.toLowerCase().endsWith(ext));
      if (isVideo) {
        controller.setCompanionVideo(videoToLoad);
      }
    }
  }

  if (typeof window.switchView === 'function') {
    window.switchView('translate');
  }
  showNotification(t('transcribe.sendToTranslationDesc') || 'Generated subtitle loaded into Translation Studio.', 'info');
};

window.sendTranscribeToHardsubStudio = function() {
  const subToLoad = window.lastTranscribedSubtitlePath;
  if (!subToLoad) {
    showNotification(t('transcribe.noSubGeneratedYet') || 'No generated subtitle yet', 'error');
    return;
  }

  let videoToLoad = window.lastTranscribedVideoPath || '';
  if (videoToLoad) {
    const isVideo = ['.mp4', '.mkv', '.mov', '.avi', '.webm'].some(ext => videoToLoad.toLowerCase().endsWith(ext));
    if (!isVideo) videoToLoad = '';
  }

  const controller = window.hardsubController || hardsubController;
  if (controller && typeof controller.prefillFilePaths === 'function') {
    controller.prefillFilePaths(videoToLoad, subToLoad);
  }

  if (typeof window.switchView === 'function') {
    window.switchView('hardsub');
  }
  showNotification(t('transcribe.sendToHardsubDesc') || t('translate.sendToHardsubDesc') || 'Loaded into Hardsub Studio', 'info');
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

window.clearSingleMediaFile = function() {
  selectedMediaFile = null;
  batchProcessor.setSelectedFiles([]);
  wavPathForTranscription = null;
  probedMetadata = null;
  batchProcessor.setIsBatchMode(false);

  const dropZone = document.getElementById('transcribe-drop-zone');
  if (dropZone) dropZone.classList.remove('has-file');

  const fileNameEl = document.getElementById('lbl-file-name');
  if (fileNameEl) {
    updateMediaCardName(null);
  }
  const filePathEl = document.getElementById('lbl-file-path');
  if (filePathEl) {
    filePathEl.textContent = t('transcribe.selectFilePrompt');
    filePathEl.style.display = 'block';
    filePathEl.removeAttribute('title');
  }

  const clearBtn = document.getElementById('btn-clear-media');
  if (clearBtn) clearBtn.style.display = 'none';

  const metaBox = document.getElementById('media-meta-box');
  if (metaBox) metaBox.style.display = 'none';

  const batchSpecsBox = document.getElementById('batch-specs-box');
  if (batchSpecsBox) batchSpecsBox.style.display = 'none';

  const batchQueueContainer = document.getElementById('batch-queue-container');
  if (batchQueueContainer) batchQueueContainer.style.display = 'none';

  const batchControlsBox = document.getElementById('batch-controls-box');
  if (batchControlsBox) batchControlsBox.style.display = 'none';

  const singleActions = document.getElementById('single-transcribe-actions');
  if (singleActions) singleActions.style.display = 'flex';

  const btnRun = document.getElementById('btn-run-transcribe');
  if (btnRun) btnRun.style.display = 'inline-flex';
  const btnCancel = document.getElementById('btn-cancel-transcribe');
  if (btnCancel) btnCancel.style.display = 'none';

  const typeEl = document.getElementById('meta-type');
  if (typeEl) typeEl.textContent = '-';
  const sizeEl = document.getElementById('meta-size');
  if (sizeEl) sizeEl.textContent = '-';
  const durEl = document.getElementById('meta-duration');
  if (durEl) {
    durEl.textContent = '-';
    durEl.removeAttribute('title');
  }
  const recEl = document.getElementById('meta-recommendation');
  if (recEl) recEl.textContent = '-';

  if (settingsState) {
    settingsState.inputFile = '';
    saveCurrentSettings();
  }

  const fillBar = document.getElementById('progress-linear-fill');
  if (fillBar) fillBar.style.width = '0%';
  const pctEl = document.getElementById('lbl-radial-pct');
  if (pctEl) {
    pctEl.removeAttribute('data-i18n');
    pctEl.textContent = '0%';
  }
  const msgEl = document.getElementById('lbl-radial-msg');
  if (msgEl) {
    msgEl.setAttribute('data-i18n', 'transcribe.standingBy');
    msgEl.textContent = t('transcribe.standingBy');
  }

  const analyticsBox = document.getElementById('analytics-box');
  if (analyticsBox) analyticsBox.style.display = 'none';

  const telemetryCard = document.getElementById('telemetry-hud-card');
  if (telemetryCard) telemetryCard.style.display = 'none';
  setTranscribeStatusBadge('', 'transcribe.standingBy');
  const badgeEl = document.getElementById('hud-status-badge');
  if (badgeEl) badgeEl.style.display = 'none';
  const metricsEl = document.getElementById('transcribe-metrics');
  if (metricsEl) metricsEl.style.display = 'none';
  const analyticTimeEl = document.getElementById('analytic-time');
  if (analyticTimeEl) delete analyticTimeEl.dataset.elapsedSeconds;
  if (msgEl) delete msgEl.dataset.statusCompleted;

  window.lastTranscribedSubtitlePath = null;
  window.lastTranscribedVideoPath = null;
  window.lastTranscribedOutputDir = null;
  window.lastTranscribedOutputFiles = [];
  transcriptLines = [];
  if (typeof window.updateTranscribeWorkflowButtons === 'function') {
    window.updateTranscribeWorkflowButtons();
  }
  if (typeof window.updateTranscribeActionButtons === 'function') {
    window.updateTranscribeActionButtons(false);
  }

  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = `
      <div class="transcript-placeholder" id="transcript-placeholder">
        <svg class="transcript-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <div class="transcript-empty-title" data-i18n="transcribe.liveViewerTitle">${escapeHTML(t('transcribe.liveViewerTitle') || 'Live Transcript Viewer')}</div>
        <div class="transcript-empty-desc" data-i18n="transcribe.streamNotice">${escapeHTML(t('transcribe.streamNotice') || 'Start transcription to stream live text preview.')}</div>
      </div>
    `;
  }
  const searchInput = document.getElementById('transcript-search');
  if (searchInput) searchInput.value = '';
};

window.browseMediaFile = async function() {
  if (batchProcessor.getIsExtracting() || isTranscribing) {
    showNotification(t('toasts.batchActiveSelectBlocked'), "info");
    return;
  }
  const rawFiles = await invoke('select_files');
  if (rawFiles && rawFiles.length > 0) {
    const files = Array.from(new Set(rawFiles));
    if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
      await addBatchFiles(files);
      return;
    }

    batchProcessor.setSelectedFiles(files);
    
    if (files.length === 1) {
      batchProcessor.setIsBatchMode(false);
      selectedMediaFile = files[0];
      
      const dropZone = document.getElementById('transcribe-drop-zone');
      if (dropZone) dropZone.classList.add('has-file');

      // Update UI for Single-file Mode
      const fileNameEl = document.getElementById('lbl-file-name');
      const filePathEl = document.getElementById('lbl-file-path');
      if (fileNameEl) fileNameEl.style.display = 'block';
      if (filePathEl) filePathEl.style.display = 'block';
      updateMediaCardName(selectedMediaFile);
      if (filePathEl) {
        filePathEl.textContent = selectedMediaFile;
        filePathEl.title = isolateLtr(selectedMediaFile);
      }

      const clearBtn = document.getElementById('btn-clear-media');
      if (clearBtn) clearBtn.style.display = 'inline-flex';

      const batchQueueContainer = document.getElementById('batch-queue-container');
      if (batchQueueContainer) batchQueueContainer.style.display = 'none';
      
      const metaBox = document.getElementById('media-meta-box');
      if (metaBox) metaBox.style.display = 'flex';
      const batchSpecsBox = document.getElementById('batch-specs-box');
      if (batchSpecsBox) batchSpecsBox.style.display = 'none';
      
      const nextStepBtn = document.getElementById('btn-next-step-2');
      if (nextStepBtn) nextStepBtn.textContent = t('transcribe.continueToTranscription');
      
      const batchControlsBox = document.getElementById('batch-controls-box');
      if (batchControlsBox) batchControlsBox.style.display = 'none';
      const singleActions = document.getElementById('single-transcribe-actions');
      if (singleActions) singleActions.style.display = 'flex';
      const runBtn = document.getElementById('btn-run-transcribe');
      if (runBtn) runBtn.style.display = 'inline-flex';
      const cancelBtn = document.getElementById('btn-cancel-transcribe');
      if (cancelBtn) cancelBtn.style.display = 'none';
      
      const wizardStep3 = document.getElementById('wizard-step-3');
      if (wizardStep3) wizardStep3.style.display = 'block';
      
      wavPathForTranscription = null;
      if (typeof window.updateTranscribeActionButtons === 'function') {
        window.updateTranscribeActionButtons(false);
      }
      
      if (settingsState) {
        settingsState.inputFile = selectedMediaFile;
        saveCurrentSettings();
      }
      
      setWizardStepCompleted(1, true);
      await probeSelectedFile();
    } else {
      await addBatchFiles(files);
    }
  }
};

function formatLocalizedNumber(num, lang = getLanguage(), maxFrac = 1) {
  if (num === null || num === undefined || num === '' || isNaN(num)) return '';
  if (lang === 'fa') {
    return Number(num).toLocaleString('fa-IR', { maximumFractionDigits: maxFrac });
  }
  if (lang === 'ar') {
    return Number(num).toLocaleString('ar-SA', { maximumFractionDigits: maxFrac });
  }
  return Number(num).toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

function renderMediaMetadata(meta) {
  if (!meta || !meta.exists) return;

  const typeEl = document.getElementById('meta-type');
  const sizeEl = document.getElementById('meta-size');
  const durEl = document.getElementById('meta-duration');
  const recEl = document.getElementById('meta-recommendation');

  const lang = getLanguage();

  // 1. File Type (Localized with emoji)
  if (typeEl) {
    const rawFmt = meta.format || '';
    if (rawFmt.includes('Video')) {
      typeEl.textContent = `${t('transcribe.formatVideo')} 🎥`;
    } else if (rawFmt.includes('Audio')) {
      typeEl.textContent = `${t('transcribe.formatAudio')} 🎵`;
    } else if (rawFmt.includes('File')) {
      typeEl.textContent = `${t('transcribe.formatFile')} 📁`;
    } else {
      typeEl.textContent = rawFmt || '-';
    }
  }

  // 2. File Size (Properly isolated RTL/LTR numbers and localized units)
  if (sizeEl) {
    const rawSize = meta.size || '';
    const match = rawSize.match(/([\d.]+)\s*([A-Za-z]+)?/);
    if (match) {
      const num = parseFloat(match[1]);
      const unitKey = (match[2] || 'MB').toUpperCase();
      let localizedUnit = unitKey;
      if (unitKey === 'GB') localizedUnit = t('transcribe.unitGB');
      else if (unitKey === 'MB') localizedUnit = t('transcribe.unitMB');
      else if (unitKey === 'KB') localizedUnit = t('transcribe.unitKB');
      else if (unitKey === 'B') localizedUnit = t('transcribe.unitB');

      const formattedNum = formatLocalizedNumber(num, lang, 1);
      sizeEl.textContent = `${formattedNum} ${localizedUnit}`;
    } else {
      sizeEl.textContent = rawSize || '-';
    }
  }

  // 3. Duration (Human conversational localized format + digital timecode tooltip)
  if (durEl) {
    const dur = Math.round(meta.durationSec || 0);
    const hours = Math.floor(dur / 3600);
    const minutes = Math.floor((dur % 3600) / 60);
    const seconds = Math.floor(dur % 60);
    const digitalTimecode = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (dur <= 0) {
      durEl.textContent = '-';
      durEl.removeAttribute('title');
    } else {
      const hStr = formatLocalizedNumber(hours, lang, 0);
      const mStr = formatLocalizedNumber(minutes, lang, 0);
      const sStr = formatLocalizedNumber(seconds, lang, 0);

      let text = '';
      if (hours > 0) {
        if (minutes > 0 && seconds > 0) {
          text = t('transcribe.durationHoursMinutesSeconds', { hours: hStr, minutes: mStr, seconds: sStr });
        } else if (minutes > 0) {
          text = t('transcribe.durationHoursMinutes', { hours: hStr, minutes: mStr });
        } else {
          text = t('transcribe.durationHours', { hours: hStr });
        }
      } else if (minutes > 0) {
        if (seconds > 0) {
          text = t('transcribe.durationMinutesSeconds', { minutes: mStr, seconds: sStr });
        } else {
          text = t('transcribe.durationMinutes', { minutes: mStr });
        }
      } else {
        text = t('transcribe.durationSeconds', { seconds: sStr });
      }
      durEl.textContent = text;
      durEl.title = t('transcribe.timecodeTooltip', { timecode: digitalTimecode });
    }
  }

  // 4. Engine / Backend & Threads
  if (recEl && settingsState) {
    const backendRaw = settingsState.selectedBackend || 'Standard';
    const backendName = backendRaw === 'Standard' ? t('transcribe.backendStandard') : backendRaw;
    const threadsVal = formatLocalizedNumber(settingsState.threads || 4, lang, 0);
    recEl.textContent = t('transcribe.backendStatus', {
      backend: backendName,
      threads: threadsVal
    });
  }
}

async function probeSelectedFile() {
  if (!selectedMediaFile) return;
  
  try {
    probedMetadata = await invoke('probe_media_file', { filePath: selectedMediaFile });
    
    if (probedMetadata.exists) {
      const metaBox = document.getElementById('media-meta-box');
      if (metaBox) metaBox.style.display = 'flex';
      renderMediaMetadata(probedMetadata);
      
      setWizardStepCompleted(2, true);
      openWizardStep(2);
      
      const fillBar = document.getElementById('progress-linear-fill');
      if (fillBar) fillBar.style.width = '0%';
      const pctEl = document.getElementById('lbl-radial-pct');
      if (pctEl) {
        pctEl.removeAttribute('data-i18n');
        pctEl.textContent = '0%';
      }
      const msgEl = document.getElementById('lbl-radial-msg');
      if (msgEl) {
        delete msgEl.dataset.batchSummarySuccess;
        delete msgEl.dataset.batchSummaryTotal;
        msgEl.setAttribute('data-i18n', 'transcribe.readyForTranscription');
        msgEl.textContent = t('transcribe.readyForTranscription');
      }
      
      setWizardStepCompleted(3, false);
      const analyticsBox = document.getElementById('analytics-box');
      if (analyticsBox) analyticsBox.style.display = 'none';
    } else {
      showNotification(t('toasts.fileNotFoundOrInvalid'), "error");
      if (typeof window.clearSingleMediaFile === 'function') window.clearSingleMediaFile();
    }
  } catch (e) {
    console.error("Probing failed:", e);
    showNotification(t('toasts.metaReadError'), "error");
    if (typeof window.clearSingleMediaFile === 'function') window.clearSingleMediaFile();
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
  
  if (typeof probedMetadata !== 'undefined' && probedMetadata && probedMetadata.exists) {
    renderMediaMetadata(probedMetadata);
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
    vadEl.title = vadActive ? `${t('transcribe.vadActive')} (${vadModelName})` : t('transcribe.vadDisabled');
  }
  
  const quickVadBtn = document.getElementById('quick-toggle-vad');
  if (quickVadBtn) {
    if ('checked' in quickVadBtn) {
      quickVadBtn.checked = vadActive;
    }
    if (vadActive) {
      quickVadBtn.classList.add('active');
      quickVadBtn.title = `${t('transcribe.vadActive')} (${vadModelName}) - ${t('transcribe.vadDisableHint') || 'Click to disable'}`;
    } else {
      quickVadBtn.classList.remove('active');
      if (hasVadModel) {
        quickVadBtn.title = `${t('transcribe.vadDisabled')} (${vadModelName}) - ${t('transcribe.vadEnableHint') || 'Click to enable'}`;
      } else {
        quickVadBtn.title = t('toasts.noVadFound') || 'No Silero VAD model found on system';
      }
    }
  }
  
  const transCfgTranslation = document.getElementById('trans-cfg-translation');
  if (transCfgTranslation) {
    const translationEnabled = Boolean(settingsState?.autoTransferToTranslate ?? settingsState?.translateAiEnabled);
    let translationText = 'OFF';
    let fullTitle = 'Auto-Transfer to Translation Studio Disabled';
    if (translationEnabled) {
      translationText = 'ON';
      fullTitle = 'Auto-Transfer to Translation Studio Active';
    }
    transCfgTranslation.textContent = translationText;
    transCfgTranslation.title = fullTitle;
    transCfgTranslation.className = translationEnabled ? 'val-green' : 'val-muted';
  }

  // 5. Sync Transcribe Output Folder UI & Workflow Buttons
  if (typeof updateTranscribeOutputDirUI === 'function') {
    updateTranscribeOutputDirUI();
  }
  if (typeof updateTranscribeWorkflowButtons === 'function') {
    updateTranscribeWorkflowButtons();
  }

  // Sync custom dropdown visuals
  if (window.syncCustomSelects) {
    window.syncCustomSelects();
  }
}

window.openTranscriptionSettings = function() {
  if (typeof window.switchView === 'function') {
    window.switchView('settings');
    if (typeof window.switchSettingsCategory === 'function') {
      window.switchSettingsCategory('transcription');
    }
  }
};

function setupQuickConfigDeckEventListeners() {
  // 1. Quick Model Selection Listener
  const quickModelSelect = document.getElementById('quick-opt-model');
  if (quickModelSelect) {
    quickModelSelect.addEventListener('change', () => {
      if (settingsState && quickModelSelect.value) {
        settingsState.modelPath = quickModelSelect.value;
        const cfgModelSelect = document.getElementById('opt-modelPath');
        if (cfgModelSelect) {
          cfgModelSelect.value = quickModelSelect.value;
        }
        saveCurrentSettings();
        updateTranscribeUIConfigs();
      }
    });
  }

  // 2. Quick Language Selection Listener
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
        const backendLabel = backend === 'Standard' ? ((typeof t === 'function' && t('transcribe.backendCpu')) || 'CPU') : backend + ' GPU';
        showNotification(t('toasts.backendSwitched', { backend: backendLabel }), "success");
      }
    });
  }
}

window.toggleQuickVad = function(forceVal) {
  if (!settingsState) return;
  
  const willEnable = (typeof forceVal === 'boolean') ? forceVal : !settingsState.vad;
  if (willEnable) {
    const hasVadModel = Boolean(localScannedVadModels && localScannedVadModels.length > 0 && settingsState.vadModel);
    if (!hasVadModel) {
      showNotification(t('toasts.noVadFound'), "warning");
      const quickVadInput = document.getElementById('quick-toggle-vad');
      if (quickVadInput) quickVadInput.checked = false;
      return;
    }
  }

  settingsState.vad = willEnable;
  const cfgVadCheckbox = document.getElementById('opt-vad');
  if (cfgVadCheckbox) {
    cfgVadCheckbox.checked = settingsState.vad;
  }
  const quickVadInput = document.getElementById('quick-toggle-vad');
  if (quickVadInput) {
    quickVadInput.checked = settingsState.vad;
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
    if (!localScannedTransModels || localScannedTransModels.length === 0) {
      if (typeof switchView === 'function') switchView('models');
    }
    return;
  }

  isTranscribing = true;
  if (typeof updateTranscribeActionButtons === 'function') {
    updateTranscribeActionButtons(true);
  }
  const analyticsBox = document.getElementById('analytics-box');
  if (analyticsBox) analyticsBox.style.display = 'none';

  const telemetryCard = document.getElementById('telemetry-hud-card');
  if (telemetryCard) telemetryCard.style.display = 'block';
  setTranscribeStatusBadge('active', 'transcribe.statusExtracting');
  const metricsEl = document.getElementById('transcribe-metrics');
  if (metricsEl) metricsEl.style.display = 'none';
  const analyticTimeEl = document.getElementById('analytic-time');
  if (analyticTimeEl) delete analyticTimeEl.dataset.elapsedSeconds;
  if (msgEl) delete msgEl.dataset.statusCompleted;

  // Clear transcript preview
  transcriptLines = [];
  window.lastTranscribedSubtitlePath = null;
  window.lastTranscribedOutputFiles = [];
  if (typeof updateTranscribeWorkflowButtons === 'function') {
    updateTranscribeWorkflowButtons();
  }
  const viewport = document.getElementById('transcript-viewport');
  if (viewport) {
    viewport.innerHTML = `
      <div id="transcript-placeholder" class="transcript-initializing-state">
        <div class="transcript-spinner"></div>
        <div class="transcript-initializing-text" data-i18n="transcribe.aiModelInitializing">${escapeHTML(t('transcribe.aiModelInitializing'))}</div>
      </div>
    `;
  }

  try {
    // Phase 1: Auto-convert to WAV if not already done
    if (!wavPathForTranscription) {
      if (btnSpan) {
        btnSpan.setAttribute('data-i18n', 'transcribe.convertingToWav');
        btnSpan.textContent = t('transcribe.convertingToWav');
      } else {
        btn.textContent = t('transcribe.convertingToWav');
      }
      if (msgEl) {
        msgEl.setAttribute('data-i18n', 'transcribe.convertingAudio16k');
        msgEl.textContent = t('transcribe.convertingAudio16k');
      }
      if (fillBar) {
        fillBar.style.width = '50%';
        fillBar.classList.add('indeterminate');
      }
      if (pctEl) {
        pctEl.setAttribute('data-i18n', 'transcribe.convertingProgress');
        pctEl.textContent = t('transcribe.convertingProgress');
      }

      wavPathForTranscription = await invoke('convert_media_file', { filePath: selectedMediaFile });

      if (fillBar) fillBar.classList.remove('indeterminate');
      if (msgEl) {
        msgEl.setAttribute('data-i18n', 'transcribe.wavReadyTranscribing');
        msgEl.textContent = t('transcribe.wavReadyTranscribing');
      }
    }

    // Phase 2: Run Whisper transcription
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      if (cancelBtnSpan) {
        cancelBtnSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
        cancelBtnSpan.textContent = t('transcribe.cancelTranscription');
      }
    }
    const transcribingText = t('transcribe.statusExtracting') || 'Extracting...';
    if (btnSpan) {
      btnSpan.setAttribute('data-i18n', 'transcribe.statusExtracting');
      btnSpan.textContent = transcribingText;
    } else {
      btn.textContent = transcribingText;
    }

    const result = await invoke('start_transcription_task', {
      settings: settingsState,
      wavPath: wavPathForTranscription,
      durationSec: probedMetadata ? probedMetadata.durationSec : 60.0
    });

    // Load final transcript from the text file
    const rawOutputDir = result.outputDir || ((settingsState && settingsState.outputDirMode === 'custom' && settingsState.outputDirPath) ? settingsState.outputDirPath : getParentDir(settingsState?.inputFile || selectedMediaFile));
    const outputDir = (rawOutputDir && (rawOutputDir.endsWith('/') || rawOutputDir.endsWith('\\'))) ? rawOutputDir.slice(0, -1) : rawOutputDir;
    const sep = outputDir && outputDir.includes('\\') && !outputDir.includes('/') ? '\\' : '/';
    window.lastTranscribedOutputDir = outputDir;

    window.lastTranscribedOutputFiles = [];
    if (result.generatedFiles && result.generatedFiles.length > 0) {
      result.generatedFiles.forEach(f => {
        let type = 'other';
        if (f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.lrc')) {
          type = 'subtitle';
        } else if (f.endsWith('.txt')) {
          type = 'text';
        } else if (f.endsWith('.json')) {
          type = 'json';
        } else if (f.endsWith('.csv')) {
          type = 'csv';
        }
        window.lastTranscribedOutputFiles.push({
          path: `${outputDir}${sep}${f}`,
          name: f,
          type
        });
      });
      // Fallback: If transcriptLines was not populated via live events, load from generated subtitle/text file
      if ((!transcriptLines || transcriptLines.length === 0) && result.generatedFiles && result.generatedFiles.length > 0) {
        const subFile = result.generatedFiles.find(f => f.endsWith('.srt')) ||
                        result.generatedFiles.find(f => f.endsWith('.vtt')) ||
                        result.generatedFiles.find(f => f.endsWith('.lrc')) ||
                        result.generatedFiles.find(f => f.endsWith('.json')) ||
                        result.generatedFiles.find(f => f.endsWith('.csv')) ||
                        result.generatedFiles.find(f => f.endsWith('.txt'));
        if (subFile) {
          await loadTranscriptFromFile(`${outputDir}${sep}${subFile}`);
        }
      }
    }

    const elapsedVal = result.durationMs ? (result.durationMs / 1000) : 0;
    const speedFactor = (result.speedFactor || 0).toFixed(1);
    const analyticTimeEl = document.getElementById('analytic-time');
    const analyticSpeedEl = document.getElementById('analytic-speed');
    if (analyticTimeEl) {
      analyticTimeEl.dataset.elapsedSeconds = String(elapsedVal);
      analyticTimeEl.textContent = formatLocalizedTimeDuration(elapsedVal);
    }
    if (analyticSpeedEl) {
      analyticSpeedEl.dataset.speedFactor = speedFactor;
      analyticSpeedEl.textContent = `${speedFactor}x`;
    }

    // Mark Step 3 as completed and notify user immediately when transcription succeeds
    setWizardStepCompleted(3, true);
    showNotification(t('toasts.transcriptionComplete', { time: formatDuration(elapsedVal) }), "success");

    setTranscribeStatusBadge('complete', 'transcribe.statusComplete');
    if (metricsEl) metricsEl.style.display = 'inline-flex';

    if (msgEl) {
      delete msgEl.dataset.batchSummarySuccess;
      delete msgEl.dataset.batchSummaryTotal;
      msgEl.dataset.statusCompleted = 'true';
      msgEl.setAttribute('data-i18n', 'transcribe.progressComplete');
      msgEl.textContent = t('transcribe.progressComplete');
    }

    // Find generated subtitle file (.srt, .vtt, or .lrc) and update workflow bridging
    const subFile = result.generatedFiles?.find(f => f.endsWith('.srt')) ||
                    result.generatedFiles?.find(f => f.endsWith('.vtt')) ||
                    result.generatedFiles?.find(f => f.endsWith('.lrc'));
    if (subFile) {
      window.lastTranscribedSubtitlePath = `${outputDir}${sep}${subFile}`;
    }
    window.lastTranscribedVideoPath = selectedMediaFile || (settingsState ? settingsState.inputFile : null);
    if (typeof updateTranscribeWorkflowButtons === 'function') {
      updateTranscribeWorkflowButtons();
    }

    // Auto-Transfer to Translation Studio if enabled
    const autoTransferEnabled = Boolean(settingsState?.autoTransferToTranslate ?? settingsState?.translateAiEnabled);
    if (autoTransferEnabled && window.lastTranscribedSubtitlePath) {
      if (typeof window.sendTranscribeToTranslationStudio === 'function') {
        await window.sendTranscribeToTranslationStudio();
      }
    }
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    setWizardStepCompleted(3, false);
    const isCancelled = errMsg.toLowerCase().includes('cancelled by the user') || errMsg.toLowerCase().includes('was cancelled by the user') || errMsg.toLowerCase().includes('aborted');
    if (isCancelled) {
      if (telemetryCard) telemetryCard.style.display = 'none';
      if (fillBar) fillBar.style.width = '0%';
      if (pctEl) pctEl.textContent = '0%';
      if (metricsEl) metricsEl.style.display = 'none';
      setTranscribeStatusBadge('', 'transcribe.standingBy');
      showNotification(t('toasts.transcriptionCancelled'), "info");
      const viewport = document.getElementById('transcript-viewport');
      if (viewport && viewport.querySelector('.transcript-initializing-state')) {
        viewport.innerHTML = `
          <div class="transcript-placeholder" id="transcript-placeholder">
            <svg class="transcript-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <div class="transcript-empty-title" data-i18n="transcribe.liveViewerTitle">${escapeHTML(t('transcribe.liveViewerTitle') || 'Live Transcript Viewer')}</div>
            <div class="transcript-empty-desc" data-i18n="transcribe.streamNotice">${escapeHTML(t('transcribe.streamNotice') || 'Start transcription to stream live text preview.')}</div>
          </div>
        `;
      }
    } else {
      showNotification(t('toasts.transcriptionError', { error: errMsg }), "error");
      setTranscribeStatusBadge('cancelled', 'transcribe.statusFailed');
      if (msgEl) {
        delete msgEl.dataset.batchSummarySuccess;
        delete msgEl.dataset.batchSummaryTotal;
        delete msgEl.dataset.statusCompleted;
        msgEl.setAttribute('data-i18n', 'transcribe.taskFailed');
        msgEl.textContent = t('transcribe.taskFailed');
      }
    }
  } finally {
    isTranscribing = false;
    // ALWAYS clear the temporary WAV state since it has been cleaned up by the backend
    wavPathForTranscription = null;
    if (typeof updateTranscribeActionButtons === 'function') {
      updateTranscribeActionButtons(false);
    }
    if (fillBar) fillBar.classList.remove('indeterminate');
    // Guarantee the HUD pulse dot can never get stuck (success, error, or cancel).
    if (pulseDot) pulseDot.classList.remove('active');
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) {
        cancelBtnSpan.setAttribute('data-i18n', 'transcribe.cancelTranscription');
        cancelBtnSpan.textContent = t('transcribe.cancelTranscription');
      } else {
        cancelBtn.textContent = t('transcribe.cancelTranscription');
      }
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
    const telemetryCard = document.getElementById('telemetry-hud-card');
    if (telemetryCard) telemetryCard.style.display = 'none';
    const metricsEl = document.getElementById('transcribe-metrics');
    if (metricsEl) metricsEl.style.display = 'none';
    setTranscribeStatusBadge('', 'transcribe.standingBy');
  } catch (e) {
    const errMsg = (typeof e === 'string') ? e : (e && e.toString ? e.toString() : '');
    if (!errMsg.includes("No active transcription or translation session")) {
      showNotification(t('toasts.cancelProcessError', { error: errMsg }), "error");
    }
    if (cancelBtn) {
      cancelBtn.disabled = false;
      if (cancelBtnSpan) cancelBtnSpan.textContent = t('transcribe.cancelTranscription'); else cancelBtn.textContent = t('transcribe.cancelTranscription');
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
    const fallback = logsController.allLogs
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

// ----------------- Batch Processing Queue Helpers & Engine -----------------
// Extracted to src/modules/batchProcessor.ts

// ----------------- Transcribe Interactive Drag & Drop -----------------
function setupTranscribeDragAndDrop() {
  const transZone = document.getElementById('transcribe-drop-zone');
  if (!transZone) return;

  transZone.addEventListener('click', (e) => {
    if (selectedMediaFile || (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0)) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    browseMediaFile();
  });

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

async function handleDroppedFiles(rawFiles) {
  if (batchProcessor.getIsExtracting() || isTranscribing) {
    showNotification(t('toasts.batchActiveDropBlocked'), "info");
    return;
  }

  const files = Array.isArray(rawFiles) ? Array.from(new Set(rawFiles)) : [];
  if (files.length === 0) return;

  if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
    await addBatchFiles(files);
    switchView('transcribe');
    return;
  }

  batchProcessor.setSelectedFiles(files);
  
  if (files.length === 1) {
    batchProcessor.setIsBatchMode(false);
    selectedMediaFile = files[0];
    
    const dropZone = document.getElementById('transcribe-drop-zone');
    if (dropZone) dropZone.classList.add('has-file');

    const fileNameEl = document.getElementById('lbl-file-name');
    const filePathEl = document.getElementById('lbl-file-path');
    if (fileNameEl) fileNameEl.style.display = 'block';
    if (filePathEl) filePathEl.style.display = 'block';
    updateMediaCardName(selectedMediaFile);
    if (filePathEl) {
      filePathEl.textContent = selectedMediaFile;
      filePathEl.title = isolateLtr(selectedMediaFile);
    }

    const clearBtn = document.getElementById('btn-clear-media');
    if (clearBtn) clearBtn.style.display = 'inline-flex';

    const batchQueueContainer = document.getElementById('batch-queue-container');
    if (batchQueueContainer) batchQueueContainer.style.display = 'none';
    
    const metaBox = document.getElementById('media-meta-box');
    if (metaBox) metaBox.style.display = 'flex';
    const batchSpecsBox = document.getElementById('batch-specs-box');
    if (batchSpecsBox) batchSpecsBox.style.display = 'none';

    const nextStepBtn = document.getElementById('btn-next-step-2');
    if (nextStepBtn) nextStepBtn.textContent = t('transcribe.continueToTranscription');
    
    const batchControlsBox = document.getElementById('batch-controls-box');
    if (batchControlsBox) batchControlsBox.style.display = 'none';
    const singleActions = document.getElementById('single-transcribe-actions');
    if (singleActions) singleActions.style.display = 'flex';
    const runBtn = document.getElementById('btn-run-transcribe');
    if (runBtn) runBtn.style.display = 'inline-flex';
    const cancelBtn = document.getElementById('btn-cancel-transcribe');
    if (cancelBtn) cancelBtn.style.display = 'none';
    
    const wizardStep3 = document.getElementById('wizard-step-3');
    if (wizardStep3) wizardStep3.style.display = 'block';
    
    wavPathForTranscription = null;
    if (typeof window.updateTranscribeActionButtons === 'function') {
      window.updateTranscribeActionButtons(false);
    }
    
    if (settingsState) {
      settingsState.inputFile = selectedMediaFile;
      saveCurrentSettings();
    }
    
    setWizardStepCompleted(1, true);
    await probeSelectedFile();
  } else {
    await addBatchFiles(files);
    setTimeout(() => {
      openWizardStep(2);
    }, 500);
  }
  
  switchView('transcribe');
  showNotification(t('toasts.filesLoaded', { count: files.length }), "success");
}


// ----------------- Models Logic & Live Transcript Viewer -----------------
// Extracted to src/modules/modelHub.ts and src/modules/transcriptViewer.ts


// ----------------- AI Translation Configuration & Providers Handling -----------------
// Extracted to src/modules/translationProviders.ts
