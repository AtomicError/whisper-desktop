import { t, isolateDirection } from '../i18n/index';
import {
  logsController,
  stripAnsi,
  formatLogTimestamp,
  appendLogToViewport,
  scheduleUpdateLogsButtonsState
} from './logsController';
import { modelHub } from './modelHub';
import { batchProcessor } from './batchProcessor';
import { transcriptViewer } from './transcriptViewer';
import {
  setTranscribeStatusBadge,
  updateTaskbarProgress,
  setIsTranscriptionRunning,
  setIsTranslationRunning,
  setIsDownloadingModelRunning,
  getIsTranscriptionRunning,
  getIsTranscribingActive,
  getIsTranslationRunning,
  getIsHardsubRunning,
  getIsDownloadingModelRunning
} from './nativeWindow';
import { showNotification } from './appModal';
import { scanAndPopulateModels } from './settingsManager';

declare global {
  interface Window {
    __TAURI__?: any;
    invoke?: (cmd: string, args?: any) => Promise<any>;
    listen?: (event: string, handler: (event: any) => void) => Promise<() => void>;
    _modelStallTimers?: Record<string, any>;
  }
}

// Safe Tauri API extraction
let originalInvoke: ((cmd: string, args?: any) => Promise<any>) | null = null;
let originalListen: ((event: string, handler: (event: any) => void) => Promise<() => void>) | null = null;

try {
  if (typeof window !== 'undefined' && window.__TAURI__) {
    originalInvoke = window.__TAURI__.core?.invoke || null;
    originalListen = window.__TAURI__.event?.listen || null;
    window.openUrl = (url: string) => {
      if (window.__TAURI__?.opener?.openUrl) {
        window.__TAURI__.opener.openUrl(url).catch(() => window.open(url, '_blank'));
      } else {
        window.open(url, '_blank');
      }
    };
  } else if (typeof window !== 'undefined') {
    console.warn('Tauri global namespace not detected. Web fallback active.');
    window.openUrl = (url: string) => window.open(url, '_blank');
  }
} catch (e) {
  console.error('Failed to load Tauri core APIs:', e);
  if (typeof window !== 'undefined') {
    window.openUrl = (url: string) => window.open(url, '_blank');
  }
}

export function setOriginalInvoke(fn: ((cmd: string, args?: any) => Promise<any>) | null) {
  originalInvoke = fn;
}

export function setOriginalListen(fn: ((event: string, handler: (event: any) => void) => Promise<() => void>) | null) {
  originalListen = fn;
}

export const openUrl = (url: string) => {
  if (typeof window !== 'undefined' && typeof window.openUrl === 'function') {
    window.openUrl(url);
  } else if (typeof window !== 'undefined') {
    window.open(url, '_blank');
  }
};

/**
 * Safe invoke wrapper with sensible fallbacks for test & browser environments
 */
export const invoke = async function(cmd: string, args: any = {}): Promise<any> {
  if (originalInvoke) {
    return await originalInvoke(cmd, args);
  }
  console.warn(`[Fallback] Mocking command: ${cmd}`);

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
      noPrints: false,
      printColors: false,
      printProgress: false,
      language: 'auto',
      prompt: '',
      carryPrompt: false,
      modelPath: 'ggml-base.en.bin',
      inputFile: '',
      ovDevice: 'CPU',
      dtwEnabled: false,
      logScore: false,
      deviceId: 0,
      vad: false,
      vadModel: '',
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
      language: 'auto',
      prompt: '',
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
      noPrints: false,
      printColors: false,
      printProgress: false,
      selectedBackend: 'Standard',
      flashAttn: true,
      deviceId: 0,
      ovDevice: 'CPU',
      vad: false,
      vadModel: 'ggml-silero-v6.2.0.bin',
      vadThold: 0.50,
      vadMinSpeech: 250,
      vadMinSil: 100,
      vadMaxSpeech: 30.0,
      vadSpeechPad: 30,
      vadOverlap: 0.10
    };
    const currentSettings = (typeof window !== 'undefined' && (window as any).settingsState) || {};
    return Object.assign({}, currentSettings, defaults);
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
      bundledAvailable: true,
      version: 'ffmpeg version 7.1',
      errorMessage: null
    };
  }

  if (cmd === 'get_whisper_status') {
    const src = (args && args.source) || 'bundled';
    return {
      configuredSource: src,
      resolvedPath: '/usr/bin/whisper-cli',
      isAvailable: true,
      bundledAvailable: true,
      version: 'whisper.cpp version: 1.9.5-dev',
      availableBackends: ['Standard', 'Vulkan', 'OpenVINO'],
      errorMessage: null
    };
  }

  return null;
};

if (typeof window !== 'undefined') {
  window.invoke = invoke;
}

/**
 * Safe listen wrapper
 */
export const listen = function(event: string, handler: (event: any) => void): Promise<() => void> {
  if (originalListen) {
    return originalListen(event, handler);
  }
  console.warn(`[Fallback] Mocking event listener: ${event}`);
  return Promise.resolve(() => {});
};

if (typeof window !== 'undefined') {
  window.listen = listen;
}

/**
 * Map transcribe status payload to localized translation key
 */
export function mapTranscribeStatusKey(payload: any): string | null {
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

let _unlistenFns: Array<() => void> = [];
const _activeModelDownloads = new Map<string, number>();

export function getActiveModelDownloadsCount(): number {
  return _activeModelDownloads.size;
}

export function getActiveModelDownloadNames(): string[] {
  return Array.from(_activeModelDownloads.keys());
}

if (typeof window !== 'undefined') {
  (window as any).getActiveModelDownloadNames = getActiveModelDownloadNames;
}

function getAggregateModelDownloadProgress(): number {
  if (_activeModelDownloads.size === 0) return 0;
  let total = 0;
  _activeModelDownloads.forEach(p => {
    total += p;
  });
  return total / _activeModelDownloads.size;
}

export function cleanupTauriListeners(): void {
  _unlistenFns.forEach(fn => {
    try { fn(); } catch (_) {}
  });
  _unlistenFns = [];
  _activeModelDownloads.clear();
  setIsDownloadingModelRunning(false);
  if (typeof window !== 'undefined' && window._modelStallTimers) {
    Object.values(window._modelStallTimers).forEach(timer => clearTimeout(timer));
    window._modelStallTimers = {};
  }
}

export function getUnlistenFns(): Array<() => void> {
  return _unlistenFns;
}

/**
 * Setup real-time event listeners across the Tauri application
 */
export function setupTauriListeners(): void {
  cleanupTauriListeners();

  const on = (event: string, handler: (event: any) => void) => {
    listen(event, handler)
      .then(fn => {
        if (typeof fn === 'function') {
          _unlistenFns.push(fn);
        }
      })
      .catch(() => {});
  };

  // 1. Transcription Progress Event Listener
  on('transcribe-status', (event: any) => {
    const payload = event?.payload;
    if (!payload) return;
    setIsTranscriptionRunning(!!payload.active);
    updateTaskbarProgress(payload.progress, payload.active);

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

    const pct = ((payload.progress || 0) * 100).toFixed(0);

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
          delete msgEl.dataset.batchSummarySkipped;
          delete msgEl.dataset.statusCompleted;
          msgEl.setAttribute('data-i18n', i18nKey);
          msgEl.textContent = t(i18nKey);
        } else if (payload.message) {
          delete msgEl.dataset.batchSummarySuccess;
          delete msgEl.dataset.batchSummaryTotal;
          delete msgEl.dataset.batchSummarySkipped;
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

  // 2. Translation Progress Event Listener
  on('translation-status', (event: any) => {
    const payload = event?.payload;
    if (!payload) return;
    const isActive = !!payload.active;
    setIsTranslationRunning(isActive);
    if (isActive) {
      updateTaskbarProgress(payload.progress, true);
    } else {
      const hasOtherActiveJob =
        getIsTranscriptionRunning() ||
        getIsTranscribingActive() ||
        getIsHardsubRunning() ||
        _activeModelDownloads.size > 0 ||
        getIsDownloadingModelRunning();
      if (!hasOtherActiveJob) {
        const isFailed = payload.message === 'Translation failed';
        updateTaskbarProgress(0, false, isFailed ? 'error' : 'normal');
      }
    }
  });

  // 3. Model Download Progress Event Listener
  on('model-download-status', (event: any) => {
    const payload = event?.payload;
    if (!payload || !payload.modelName) return;

    if (payload.phase === 'starting' || payload.phase === 'downloading' || payload.phase === 'verifying') {
      const progressVal = payload.phase === 'verifying'
        ? 1
        : (Number.isFinite(Number(payload.progress)) ? Math.max(0, Math.min(1, Number(payload.progress))) : 0);
      _activeModelDownloads.set(payload.modelName, progressVal);
      setIsDownloadingModelRunning(true);
      updateTaskbarProgress(getAggregateModelDownloadProgress(), true);

      const isVerifying = payload.phase === 'verifying';
      const pct = isVerifying ? 100 : Math.min(100, Math.round((payload.progress || 0) * 100));
      const totalKnown = payload.totalBytes > 0;
      const dlBytes = Math.max(0, payload.downloadedBytes || 0);
      const isConnecting = !isVerifying && (payload.phase === 'starting' || payload.speedBps <= 0);

      // Always cancel any prior stall watchdog before short-circuiting if the card is off-screen
      if (typeof window !== 'undefined') {
        window._modelStallTimers = window._modelStallTimers || {};
        if (window._modelStallTimers[payload.modelName]) {
          clearTimeout(window._modelStallTimers[payload.modelName]);
          delete window._modelStallTimers[payload.modelName];
        }
      }

      // CSS.escape prevents selector breakage from special chars in names
      const selectorName = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(payload.modelName)
        : String(payload.modelName).replace(/["\\]/g, '\\$&');
      const card = document.querySelector(`[data-model="${selectorName}"]`) as HTMLElement | null;
      if (!card) return;

      // 1. Progress bar & status display in-place
      const progressBlock = card.querySelector('.model-progress-block') as HTMLElement | null;
      if (progressBlock) progressBlock.style.display = 'block';
      const barContainer = card.querySelector('.progress-bar-container') as HTMLElement | null;
      if (barContainer) barContainer.style.display = 'block';
      const barFill = card.querySelector('.progress-bar-fill') as HTMLElement | null;
      if (barFill) {
        barFill.style.width = `${pct}%`;
        barFill.style.background = 'var(--color-cyan)';
        barFill.style.boxShadow = 'var(--shadow-neon-cyan)';
      }

      // 2. Status text above progress bar (clean progress + smooth ETA without speed noise)
      if (!isVerifying && !isConnecting && totalKnown && dlBytes <= payload.totalBytes) {
        const rawSeconds = (payload.totalBytes - dlBytes) / payload.speedBps;
        if (rawSeconds > 0 && isFinite(rawSeconds)) {
          const cardAny = card as any;
          if (!cardAny._smoothedEtaSeconds || cardAny._smoothedEtaSeconds <= 0) {
            cardAny._smoothedEtaSeconds = rawSeconds;
          } else {
            // Exponential moving average: 85% previous smoothed, 15% new sample to eliminate jitter
            cardAny._smoothedEtaSeconds = 0.85 * cardAny._smoothedEtaSeconds + 0.15 * rawSeconds;
          }
        }
      }

      let liveStatus = '';
      const cardAny = card as any;
      if (isVerifying) {
        cardAny._smoothedEtaSeconds = null;
        liveStatus = t('models.statusVerifying');
      } else if (dlBytes <= 0) {
        cardAny._smoothedEtaSeconds = null;
        liveStatus = payload.phase === 'starting' ? t('models.statusStarting') : t('models.statusConnecting');
      } else {
        const prefix = modelHub.formatProgress(dlBytes, payload.totalBytes, pct);
        if (isConnecting) {
          cardAny._smoothedEtaSeconds = null;
          liveStatus = `${prefix} • ${t('models.statusConnecting')}`;
        } else if (cardAny._smoothedEtaSeconds && cardAny._smoothedEtaSeconds > 0) {
          const etaText = t('models.etaLabel', { time: modelHub.formatRemainingTime(cardAny._smoothedEtaSeconds) });
          liveStatus = `${prefix} • ${isolateDirection(etaText)}`;
        } else {
          const inProgressSuffix = (t('models.statusInProgress', { size: '', pct: '' }).split('•')[1] || t('models.statusConnecting')).trim();
          liveStatus = `${prefix} • ${inProgressSuffix}`;
        }
      }

      // Manage stall detection watchdog (switches to connecting state if stream stalls for >= 3s)
      if (typeof window !== 'undefined' && !isVerifying && !isConnecting && payload.phase === 'downloading') {
        window._modelStallTimers![payload.modelName] = setTimeout(() => {
          const targetCard = document.querySelector(`[data-model="${selectorName}"]`) as any;
          if (targetCard && targetCard === card && targetCard.querySelector('.model-btn-pause')) {
            const statusEl = targetCard.querySelector('.model-progress-status');
            if (statusEl) {
              targetCard._smoothedEtaSeconds = null;
              if (dlBytes <= 0) {
                statusEl.textContent = t('models.statusConnecting');
              } else {
                const prefix = modelHub.formatProgress(dlBytes, payload.totalBytes, pct);
                statusEl.textContent = `${prefix} • ${t('models.statusConnecting')}`;
              }
            }
          }
        }, 3000);
      }

      let statusEl = card.querySelector('.model-progress-status') as HTMLElement | null;
      if (!statusEl && barContainer && barContainer.parentNode) {
        statusEl = document.createElement('div');
        statusEl.className = 'model-progress-status status-downloading';
        barContainer.parentNode.insertBefore(statusEl, barContainer);
      }
      const nowTime = Date.now();
      const lastTextUpdate = cardAny._lastStatusTextUpdate || 0;
      const isPhaseChange = cardAny._lastPhase !== payload.phase || cardAny._lastIsConnecting !== isConnecting;
      if (nowTime - lastTextUpdate >= 650 || isPhaseChange) {
        cardAny._lastStatusTextUpdate = nowTime;
        cardAny._lastPhase = payload.phase;
        cardAny._lastIsConnecting = isConnecting;
        if (statusEl) {
          statusEl.textContent = liveStatus;
          statusEl.classList.remove('status-paused');
          statusEl.classList.add('status-downloading');
          statusEl.style.color = '';
        }
      }

      // 3. Keep description metadata clean without dynamic metrics
      const descEl = card.querySelector('.setting-desc') as HTMLElement | null;
      if (descEl && !descEl.querySelector('.badge-downloading')) {
        const totalBytesForDesc = Number(card.dataset.sizeBytes) || (totalKnown ? payload.totalBytes : 0);
        const displayedSizeMB = totalKnown
          ? Math.max(1, Math.round(payload.totalBytes / 1048576))
          : (card.dataset.sizeMb || 1);
        descEl.innerHTML = modelHub.buildDescriptionHtml(payload.modelName, 'Downloading', displayedSizeMB, totalBytesForDesc);
      }

      // 4. Ensure button is "Pause" in-place and lock it during SHA-256 verification or in-flight pause
      const ctrlEl = card.querySelector('.setting-control') as HTMLElement | null;
      if (ctrlEl) {
        const existingPauseBtn = ctrlEl.querySelector('[data-action="pause"]') as HTMLButtonElement | null;
        if (!existingPauseBtn) {
          ctrlEl.innerHTML = modelHub.buildActionButtonsHtml(payload.modelName, 'Downloading', isVerifying);
        } else {
          const isPauseBusy = existingPauseBtn.getAttribute?.('aria-busy') === 'true';
          existingPauseBtn.disabled = isVerifying || isPauseBusy;
          existingPauseBtn.classList?.toggle?.('is-verifying', isVerifying);
          if (isVerifying) {
            existingPauseBtn.setAttribute('aria-disabled', 'true');
          } else {
            existingPauseBtn.removeAttribute('aria-disabled');
          }
        }
      }
    } else {
      if (typeof window !== 'undefined' && window._modelStallTimers && window._modelStallTimers[payload.modelName]) {
        clearTimeout(window._modelStallTimers[payload.modelName]);
        delete window._modelStallTimers[payload.modelName];
      }
      _activeModelDownloads.delete(payload.modelName);
      const hasRemainingDownloads = _activeModelDownloads.size > 0;
      setIsDownloadingModelRunning(hasRemainingDownloads);
      if (hasRemainingDownloads) {
        updateTaskbarProgress(getAggregateModelDownloadProgress(), true);
      } else {
        const hasOtherActiveJob =
          getIsTranscriptionRunning() ||
          getIsTranscribingActive() ||
          getIsTranslationRunning() ||
          getIsHardsubRunning();
        if (!hasOtherActiveJob) {
          updateTaskbarProgress(0, false, payload.phase === 'failed' ? 'error' : 'normal');
        }
      }

      // Reload grid state once
      modelHub.invalidateCache();
      modelHub.loadStatuses(true, true);
      if (payload.phase === 'failed') {
        showNotification(t('toasts.modelDownloadError', { name: payload.modelName || '', error: payload.error || 'unknown error' }), 'error');
      } else if (payload.phase === 'completed') {
        showNotification(t('toasts.modelDownloadSuccess', { name: `ggml-${payload.modelName}.bin` }), 'success');
        scanAndPopulateModels();
      }
    }
  });

  // 4. Central Log Message Event Listener
  on('log-message', (event: any) => {
    const payload = event?.payload;
    if (!payload) return;
    payload.message = stripAnsi(payload.message || '');
    if (!payload.timestamp) {
      payload.timestamp = formatLogTimestamp();
    }
    if (logsController.push(payload)) {
      scheduleUpdateLogsButtonsState();
      appendLogToViewport(payload);
    }

    // Intercept Whisper lines containing timestamp ranges
    if (payload.category === 'Whisper' && payload.message) {
      const match = payload.message.match(/\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/);
      if (match) {
        const timeRange = `[${match[1]}:${match[2]}:${match[3]} --> ${match[5]}:${match[6]}:${match[7]}]`;
        const text = match[9] || '';
        transcriptViewer.appendLine(timeRange, text);
      }
    }
  });
}
