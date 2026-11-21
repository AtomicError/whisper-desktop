/**
 * Whisper Desktop - Main Application Bootstrap & Entry Point
 */

import { hardsubController } from './hardsub';
import './translationStudio';
import { logsController, reportGlobalFrontendError } from './modules/logsController';
import { themeManager } from './modules/themeManager';
import { modelHub } from './modules/modelHub';
import { transcriptViewer } from './modules/transcriptViewer';
import { initCompanionPlayerDOM } from './modules/companionPlayer';
import { initTranscribeLayoutResizer } from './modules/transcribeLayoutResizer';
import { initializeCustomSelects, syncCustomSelects, customSelectsMap } from './modules/customSelect';
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
  applyModelsFilterAndRender
} from './modules/translationProviders';
import {
  syncAppVersionUI,
  renderUpdateCheckerUI,
  runStartupUpdateCheck
} from './modules/appModal';
import {
  setupTitlebar,
  formatLocalizedTimeDuration,
  updateMediaCardName
} from './modules/nativeWindow';
import {
  getSettingsState,
  refreshSettings,
  refreshBuildStatuses,
  refreshFFmpegStatus,
  refreshWhisperStatus,
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
import { initI18n, t, getLanguage, isRtlLanguage, clearContentDirection } from './i18n/index';
import { formatLocalizedNumber } from './i18n/formatters';
import type { SystemSpecs } from './modelRecommender';

// Global error catcher integrated with application logger and toast system
if (typeof window !== 'undefined') {
  window.onerror = reportGlobalFrontendError;
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
let deferredSettingsSearchFilterTimer: ReturnType<typeof setTimeout> | null = null;

window.addEventListener('whisper:languageChanged', (e: Event) => {
  const isAnimated = Boolean((e as CustomEvent)?.detail?.animated);
  renderUpdateCheckerUI();
  updateFilterCounts();
  const currentSettings = getSettingsState();
  if (currentSettings) {
    renderProvidersGrid();
  }
  if (currentSettings && translationProviders.getModels().length > 0) {
    applyModelsFilterAndRender(isAnimated ? (getActiveView() === 'settings' ? 820 : 900) : 0);
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
  if (msgEl && !msgEl.classList.contains('text-scrambling')) {
    if (msgEl.dataset.batchSummaryTotal) {
      const lang = getLanguage();
      const successStr = formatLocalizedNumber(Number(msgEl.dataset.batchSummarySuccess || 0), lang, 0);
      const totalStr = formatLocalizedNumber(Number(msgEl.dataset.batchSummaryTotal || 0), lang, 0);
      const skipped = Number(msgEl.dataset.batchSummarySkipped || 0);
      if (skipped > 0) {
        msgEl.textContent = t('transcribe.batchCompletedSummaryWithSkipped', {
          success: successStr,
          total: totalStr,
          skipped: formatLocalizedNumber(skipped, lang, 0)
        });
      } else {
        msgEl.textContent = t('transcribe.batchCompletedSummary', {
          success: successStr,
          total: totalStr
        });
      }
    } else if (msgEl.dataset.statusCompleted === 'true') {
      msgEl.textContent = t('transcribe.progressComplete');
    }
  }

  const analyticTimeEl = document.getElementById('analytic-time');
  if (analyticTimeEl && analyticTimeEl.dataset.elapsedSeconds && !analyticTimeEl.classList.contains('text-scrambling')) {
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
      if (typeof filePathEl.removeAttribute === 'function') {
        filePathEl.removeAttribute('data-i18n');
      }
      if (!filePathEl.classList.contains('text-scrambling')) {
        filePathEl.textContent = curMedia;
      }
    } else if (!batchProcessor.getItems() || batchProcessor.getItems().length === 0) {
      if (!fileNameEl.classList.contains('text-scrambling')) {
        updateMediaCardName(null);
      }
      if (typeof filePathEl.setAttribute === 'function') {
        filePathEl.setAttribute('data-i18n', 'transcribe.selectFilePrompt');
      }
      if (!filePathEl.classList.contains('text-scrambling')) {
        filePathEl.textContent = t('transcribe.selectFilePrompt');
      }
    } else if (batchProcessor.getIsBatchMode() && batchProcessor.getItems().length > 0) {
      if (typeof fileNameEl.setAttribute === 'function') {
        fileNameEl.setAttribute('data-i18n', 'transcribe.batchModeActive');
      }
      if (!fileNameEl.classList.contains('text-scrambling')) {
        fileNameEl.textContent = t('transcribe.batchModeActive');
      }
      if (typeof fileNameEl.removeAttribute === 'function') {
        fileNameEl.removeAttribute('title');
      }
      clearContentDirection(fileNameEl);
    }
  }

  const nextStep2Btn = document.getElementById('btn-next-step-2');
  if (nextStep2Btn && !nextStep2Btn.classList.contains('text-scrambling')) {
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
    const backendCs = customSelectsMap.get('opt-selectedBackend');
    if (backendCs) {
      backendCs.updateOptions(true);
    }
  }

  if (deferredSettingsSearchFilterTimer !== null) {
    clearTimeout(deferredSettingsSearchFilterTimer);
    deferredSettingsSearchFilterTimer = null;
  }
  const settingsSearchInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
  if (settingsSearchInput && settingsSearchInput.value) {
    if (isAnimated && getActiveView() === 'settings') {
      // Wait for the 800ms scramble wave so card titles/descriptions hold resolved text before filtering
      deferredSettingsSearchFilterTimer = setTimeout(() => {
        deferredSettingsSearchFilterTimer = null;
        const liveInput = document.getElementById('settings-search-input') as HTMLInputElement | null;
        if (liveInput && liveInput.value) {
          filterSettings(liveInput.value, true);
        }
      }, 820);
    } else {
      filterSettings(settingsSearchInput.value, true);
    }
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

  // Phase 1: Keep main thread completely idle while GPU-composited splash entrance choreography completes
  if (!prefersReducedMotion) {
    await new Promise(resolve => setTimeout(resolve, 920));
  }

  // Phase 2: Hydrate core UI & settings while the completed splash lockup holds steady on screen
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

  // Custom UI components & lightweight event listeners initialization
  initializeCustomSelects();
  setupNumberInputControls();
  setupTauriListeners();
  logsController.setup();
  setupTranslationEventListeners();
  setupTranscribeDragAndDrop();
  transcriptViewer.setupDirection();
  initCompanionPlayerDOM();
  initTranscribeLayoutResizer();
  setupQuickConfigDeckEventListeners();
  setupResponsiveMenuFadeIn();
  setupHorizontalTabScroll();
  themeManager.setupShortcuts();
  setupVerticalTabKeyboardNavigation();
  setupSearchShortcuts();
  setupDynamicDirectionInputs();
  syncAppVersionUI();

  // Initial settings load
  await refreshSettings();

  // Prepare initial view and sync localized dynamic labels while curtain is still opaque
  const isRtl = typeof isRtlLanguage === 'function' ? isRtlLanguage(getLanguage()) : (getLanguage() === 'fa' || getLanguage() === 'ar');
  window.dispatchEvent(new CustomEvent('whisper:languageChanged', { detail: { language: getLanguage(), isRtl } }));
  switchView('transcribe');
  updateTranscribeActionButtons(false);

  // Guarantee a clean visual hold after DOM hydration so layout commits before crossfade starts
  const targetSplashDuration = prefersReducedMotion ? 100 : 1280;
  const elapsed = performance.now() - splashStartTime;
  const minPostHydrationHold = prefersReducedMotion ? 0 : 160;
  const remaining = Math.max(minPostHydrationHold, targetSplashDuration - elapsed);

  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining));
  }

  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  // Phase 3: Trigger smooth GPU crossfade of #splash-curtain -> #app-container
  dismissSplashCurtain();

  // Wait for the 350ms splash fade-out transition to finish completely before starting background IPC/process probes
  if (!prefersReducedMotion) {
    await new Promise(resolve => setTimeout(resolve, 360));
  }

  // Phase 4: Non-blocking post-boot background hydration
  try {
    systemSpecs = await invoke('get_system_specs');
  } catch (e) {
    console.error("Failed to load system specs on startup:", e);
    systemSpecs = { total_ram_gb: 8.0, cpu_cores: 4, gpu_type: 'unknown' };
  }

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
  await refreshBuildStatuses();
  void refreshFFmpegStatus();
  void refreshWhisperStatus();
  void hardsubController.loadFontsAndHardware();
  void runStartupUpdateCheck(getSettingsState()?.autoCheckUpdates !== false);

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
