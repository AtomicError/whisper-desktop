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
import {
  settingsManager,
  settingsState,
  compiledBackends,
  activeSettingsCat,
  localScannedTransModels,
  localScannedVadModels,
  getSettingsState,
  setSettingsState,
  getCompiledBackends,
  setCompiledBackends,
  getActiveSettingsCat,
  setActiveSettingsCat,
  getLocalScannedTransModels,
  setLocalScannedTransModels,
  getLocalScannedVadModels,
  setLocalScannedVadModels,
  selectBackend,
  refreshBuildStatuses,
  openModelsDirectory,
  browseModelsDirectory,
  scanAndPopulateModels,
  switchSettingsCategory,
  clearSettingsSearch,
  executeFilterSettings,
  filterSettings,
  refreshSettings,
  bindSettingsToDOM,
  syncJsonConfidenceDependency,
  formatFFmpegVersion,
  refreshFFmpegStatus,
  INT_SETTING_KEYS,
  FLOAT_SETTING_KEYS,
  sanitizeSettingsPayload,
  saveCurrentSettings,
  confirmResetWhisperEngine,
  getStepperBounds,
  updateStepperButtonStates,
  updateAllStepperButtons,
  clampNumberSetting,
  incrementNumber,
  decrementNumber,
  setupNumberInputControls,
  toggleOutputDirCustomField,
  openCustomOutputDir,
  browseOutputDir,
  browseTranscribeOutputDir,
  resetTranscribeOutputDir,
  updateTranscribeOutputDirUI,
  updateTranscribeUIConfigs,
  openTranscriptionSettings,
  setupQuickConfigDeckEventListeners,
  toggleQuickVad
} from './modules/settingsManager.ts';
import {
  workflowBridge,
  lastTranscribedSubtitlePath,
  lastTranscribedVideoPath,
  lastTranscribedOutputDir,
  lastTranscribedOutputFiles,
  getLastTranscribedSubtitlePath,
  setLastTranscribedSubtitlePath,
  getLastTranscribedVideoPath,
  setLastTranscribedVideoPath,
  getLastTranscribedOutputDir,
  setLastTranscribedOutputDir,
  getLastTranscribedOutputFiles,
  setLastTranscribedOutputFiles,
  handleOutputFileButtonClick,
  toggleOutputFilesDropdown,
  renderOutputFilesDropdown,
  updateTranscribeWorkflowButtons,
  updateTranscribeActionButtons,
  sendTranscribeToTranslationStudio,
  sendTranscribeToHardsubStudio
} from './modules/workflowBridge.ts';
import {
  transcribePipeline,
  selectedMediaFile,
  probedMetadata,
  wavPathForTranscription,
  isTranscribing,
  getSelectedMediaFile,
  setSelectedMediaFile,
  getProbedMetadata,
  setProbedMetadata,
  getWavPathForTranscription,
  setWavPathForTranscription,
  getIsTranscribing,
  setIsTranscribing,
  toggleWizardAccordion,
  openWizardStep,
  setWizardStepCompleted,
  clearSingleMediaFile,
  browseMediaFile,
  renderMediaMetadata,
  probeSelectedFile,
  toggleTelemetryHudCollapse,
  runWhisperTranscription,
  abortTranscription,
  copyMainTranscriptToClipboard,
  openOutputFolder,
  copyTranscriptToClipboard,
  setupTranscribeDragAndDrop,
  handleDroppedFiles
} from './modules/transcribePipeline.ts';
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
let systemSpecs = null;

// Transcription states managed in src/modules/transcribePipeline.ts
let _unlistenFns = [];

window.getCurrentSourceMediaFile = function() {
  if (batchProcessor.getIsBatchMode() && batchProcessor.getActiveViewerIndex() >= 0 && batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()]) {
    return batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()].path;
  }
  const batchFiles = batchProcessor.getSelectedFiles();
  return getSelectedMediaFile() || (batchFiles && batchFiles.length > 0 ? batchFiles[0] : null) || (window.settingsState?.inputFile || null);
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
    wavPathForTranscription: {
      get() { return getWavPathForTranscription(); },
      set(val) { setWavPathForTranscription(val); },
      configurable: true
    },
    isTranscribing: {
      get() { return getIsTranscribing(); },
      set(val) { setIsTranscribing(val); },
      configurable: true
    },
    selectedMediaFile: {
      get() { return getSelectedMediaFile(); },
      set(val) { setSelectedMediaFile(val); },
      configurable: true
    },
    probedMetadata: {
      get() { return getProbedMetadata(); },
      set(val) { setProbedMetadata(val); },
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
      const curMedia = getSelectedMediaFile();
      if (curMedia) {
        updateMediaCardName(curMedia);
        filePathEl.textContent = curMedia;
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

// ----------------- Settings, Hardware Backends, Steppers & Models Scanning -----------------
// Extracted to src/modules/settingsManager.ts

// ----------------- Output Files Management & Studio Bridging -----------------
// Extracted to src/modules/workflowBridge.ts

// ----------------- Transcribe Pipeline & Execution Engine -----------------
// Extracted to src/modules/transcribePipeline.ts

// ----------------- Models Logic & Live Transcript Viewer -----------------
// Extracted to src/modules/modelHub.ts and src/modules/transcriptViewer.ts


// ----------------- AI Translation Configuration & Providers Handling -----------------
// Extracted to src/modules/translationProviders.ts
