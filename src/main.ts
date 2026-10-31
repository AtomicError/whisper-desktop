/**
 * Whisper Desktop - Main Application Bootstrap & Entry Point
 */

import './hardsub';
import './translationStudio';
import { logsController } from './modules/logsController';
import { themeManager } from './modules/themeManager';
import { modelHub } from './modules/modelHub';
import { transcriptViewer } from './modules/transcriptViewer';
import { initializeCustomSelects, syncCustomSelects } from './modules/customSelect';
import {
  batchProcessor,
  updateBatchSpecs,
  renderBatchQueueTable
} from './modules/batchProcessor';
import {
  translationProviders,
  setupTranslationEventListeners,
  updateFilterCounts,
  renderProvidersGrid,
  applyModelsFilterAndRender,
  filterModelsTable
} from './modules/translationProviders';
import {
  syncAppVersionUI,
  renderUpdateCheckerUI
} from './modules/appModal';
import {
  setupTitlebar,
  formatLocalizedTimeDuration,
  updateMediaCardName
} from './modules/nativeWindow';
import {
  settingsState,
  refreshSettings,
  refreshBuildStatuses,
  scanAndPopulateModels,
  setupNumberInputControls,
  updateTranscribeUIConfigs,
  setupQuickConfigDeckEventListeners,
  saveCurrentSettings,
  filterSettings
} from './modules/settingsManager';
import {
  updateTranscribeActionButtons
} from './modules/workflowBridge';
import {
  getSelectedMediaFile,
  getProbedMetadata,
  setupTranscribeDragAndDrop,
  renderMediaMetadata
} from './modules/transcribePipeline';
import {
  invoke,
  listen,
  openUrl,
  setupTauriListeners
} from './modules/tauriEvents';
import {
  getActiveView,
  switchView,
  setupResponsiveMenuFadeIn,
  setupHorizontalTabScroll,
  setupVerticalTabKeyboardNavigation,
  setupSearchShortcuts,
  setupDynamicDirectionInputs,
  refreshDynamicDirectionInputs,
  applyDynamicDirection,
  getCurrentSourceMediaFile
} from './modules/appNavigation';
import { initI18n, t, getLanguage, isRtlLanguage } from './i18n/index';
import type { SystemSpecs } from './modelRecommender';

// Global error catcher for visual debugging in frontend
if (typeof window !== 'undefined') {
  window.onerror = function(message: string | Event, source?: string, lineno?: number, colno?: number, error?: Error): boolean {
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
}

// Global system specifications cache
let systemSpecs: SystemSpecs | null = null;

// Cross-module backward compatibility proxies on window
if (typeof window !== 'undefined') {
  window.invoke = invoke;
  window.listen = listen;
  window.openUrl = openUrl;
  window.switchView = switchView;
  window.applyDynamicDirection = applyDynamicDirection;
  window.getCurrentSourceMediaFile = getCurrentSourceMediaFile;
  window.scanAndPopulateModels = scanAndPopulateModels;
  window.saveCurrentSettings = saveCurrentSettings;

  Object.defineProperties(window, {
    transcriptLines: {
      get() { return transcriptViewer.lines; },
      set(val: any[]) { transcriptViewer.lines = val; },
      configurable: true
    },
    systemSpecs: {
      get() { return systemSpecs; },
      set(val: SystemSpecs | null) { systemSpecs = val; },
      configurable: true
    }
  });
}

// Unified language change coordinator
window.addEventListener('whisper:languageChanged', () => {
  renderUpdateCheckerUI();
  updateFilterCounts();
  if (settingsState) {
    renderProvidersGrid();
  }
  if (settingsState && translationProviders.getModels().length > 0) {
    applyModelsFilterAndRender(0);
  }

  const curMetadata = getProbedMetadata();
  if (curMetadata && curMetadata.exists) {
    renderMediaMetadata(curMetadata);
  }

  const hasBatchItems = batchProcessor.getIsBatchMode() && Array.isArray(batchProcessor.getItems()) && batchProcessor.getItems().length > 0;
  if (hasBatchItems) {
    renderBatchQueueTable();
    updateBatchSpecs();
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

  logsController.updateButtonsState();

  if (getActiveView() === 'models') {
    modelHub.loadStatuses(true, true);
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
      fileNameEl.removeAttribute('title');
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

  updateTranscribeUIConfigs();
  refreshDynamicDirectionInputs();

  const settingsBackendSelect = document.getElementById('opt-selectedBackend') as HTMLSelectElement | null;
  if (settingsBackendSelect) {
    Array.from(settingsBackendSelect.options).forEach(opt => {
      if (opt.value === 'Standard') opt.textContent = t('transcribe.backendCpu');
      else if (opt.value === 'Vulkan') opt.textContent = t('transcribe.backendVulkan');
      else if (opt.value === 'CUDA') opt.textContent = t('transcribe.backendCuda');
      else if (opt.value === 'OpenVINO') opt.textContent = t('transcribe.backendOpenvino');
    });
  }

  syncCustomSelects();

  if (getActiveView() === 'settings') {
    filterModelsTable(0);
  }

  const settingsSearchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
  if (settingsSearchInput && settingsSearchInput.value) {
    filterSettings(settingsSearchInput.value);
  }

  updateTranscribeActionButtons();
});

/**
 * Main application initializer
 */
export async function initApp(): Promise<void> {
  console.log("Whisper Desktop UI Initialized!");

  const splashStartTime = performance.now();
  let splashDismissed = false;
  let splashFailSafeTimer: ReturnType<typeof setTimeout> | null = null;

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

  splashFailSafeTimer = setTimeout(dismissSplashCurtain, 5000);

  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReducedMotion) {
    await new Promise(resolve => setTimeout(resolve, 850));
  }

  // Initialize internationalization (i18n) and translate DOM
  initI18n();

  // Desktop native feel: disable context menu outside inputs/textareas
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest('input, textarea')) {
      e.preventDefault();
    }
  });

  // Setup native titlebar and controls
  setupTitlebar();

  // Scroll active class helper
  document.addEventListener('scroll', (e: Event) => {
    const target = e.target as (HTMLElement & { _scrollTimer?: ReturnType<typeof setTimeout> }) | null;
    if (target && target.classList && typeof target.classList.add === 'function') {
      target.classList.add('scrolling-active');
      clearTimeout(target._scrollTimer);
      target._scrollTimer = setTimeout(() => {
        target.classList.remove('scrolling-active');
      }, 1500);
    }
  }, { capture: true, passive: true });

  // Custom UI components initialization
  initializeCustomSelects();
  setupNumberInputControls();
  setupTauriListeners();

  // Initial settings load
  await refreshSettings();

  // Zero-FOUC Reveal
  const targetSplashDuration = prefersReducedMotion ? 100 : 1150;
  const elapsed = performance.now() - splashStartTime;
  const remaining = Math.max(0, targetSplashDuration - elapsed);

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }

  dismissSplashCurtain();

  // Load system specs
  try {
    systemSpecs = await invoke('get_system_specs');
  } catch (e) {
    console.error("Failed to load system specs on startup:", e);
    systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
  }

  // Load existing logs
  try {
    const logs = await invoke('get_logs');
    if (logs && typeof logs === 'string') {
      const lines = logs.trim().split('\n');
      for (const line of lines) {
        if (line.trim()) {
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

  logsController.redraw();
  logsController.setup();
  setupTranslationEventListeners();
  await refreshBuildStatuses();

  // Transcribe drag & drop & UI listeners
  setupTranscribeDragAndDrop();
  transcriptViewer.setupDirection();
  setupQuickConfigDeckEventListeners();
  setupResponsiveMenuFadeIn();
  setupHorizontalTabScroll();
  themeManager.setupShortcuts();
  setupVerticalTabKeyboardNavigation();
  setupSearchShortcuts();
  setupDynamicDirectionInputs();

  // Initial sync of dynamic components
  const isRtl = typeof isRtlLanguage === 'function' ? isRtlLanguage(getLanguage()) : (getLanguage() === 'fa' || getLanguage() === 'ar');
  window.dispatchEvent(new CustomEvent('whisper:languageChanged', { detail: { language: getLanguage(), isRtl } }));

  // Dynamic version synchronization
  syncAppVersionUI();

  // Default view
  switchView('transcribe');
  updateTranscribeActionButtons(false);

  // Unfreeze theme transitions
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
