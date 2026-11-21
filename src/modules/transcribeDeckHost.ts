// Dependency-inversion host bridge for Transcribe Studio Quick Deck & Time Range controllers.
// Breaks the circular import cycle between settingsManager, transcribeQuickDeck, and transcribeTimeRange.

export interface SettingsState {
  selectedBackend?: string;
  modelsDir?: string;
  whisperSource?: string;
  ffmpegSource?: string;
  ffmpegCustomPath?: string;
  outputDirMode?: string;
  outputDirPath?: string;
  inputFile?: string;
  threads?: number;
  processors?: number;
  offsetT?: number;
  duration?: number;
  maxContext?: number;
  maxLen?: number;
  bestOf?: number;
  beamSize?: number;
  audioCtx?: number;
  outputTxt?: boolean;
  outputVtt?: boolean;
  outputSrt?: boolean;
  outputLrc?: boolean;
  outputCsv?: boolean;
  outputJson?: boolean;
  outputJsonFull?: boolean;
  outputWts?: boolean;
  language?: string;
  translate?: boolean;
  diarize?: boolean;
  tinyDiarize?: boolean;
  dtwEnabled?: boolean;
  logScore?: boolean;
  noFallback?: boolean;
  noPrints?: boolean;
  printColors?: boolean;
  printProgress?: boolean;
  splitWord?: boolean;
  prompt?: string;
  carryPrompt?: boolean;
  wordThold?: number;
  entropyThold?: number;
  logprobThold?: number;
  noSpeechThold?: number;
  temperature?: number;
  temperatureInc?: number;
  vad?: boolean;
  vadModel?: string;
  vadThold?: number;
  vadMinSpeech?: number;
  vadMinSil?: number;
  vadMaxSpeech?: number;
  vadSpeechPad?: number;
  vadOverlap?: number;
  debugMode?: boolean;
  flashAttn?: boolean;
  deviceId?: number;
  ovDevice?: string;
  modelPath?: string;
  theme?: string;
  monochromeCanvas?: boolean;
  uiScale?: number;
  uiLanguage?: string;
  confidenceThreshold?: number;
  closeToTray?: boolean;
  recentSpokenLanguages?: string[];
  recentTranslationTargets?: string[];
  autoTransferToTranslate?: boolean;
  translateAiEnabled?: boolean;
  translateAiProvider?: string;
  translateAiModel?: string;
  translateAiTargetLang?: string;
  translateAiProviders?: string;
  translateAiCustomPrompt?: string;
  translateAiPolish?: boolean;
  [key: string]: any;
}

export interface BatchDurationItem {
  durationSec?: number | null;
}

export interface TranscribeDeckHost {
  getSettingsState: () => SettingsState | null;
  getCompiledBackends: () => Record<string, boolean>;
  getLocalScannedVadModels: () => string[];
  saveCurrentSettings: (immediate?: boolean) => any;
  selectBackend: (backend: string, showToast?: boolean) => void;
  switchSettingsCategory: (catId: string) => void;
  updateTranscribeOutputDirUI: () => void;
  safeApplyDynamicDirection: (el: HTMLElement | null) => void;
  updateStepperButtonStates: (inputOrId: string | HTMLInputElement) => void;
  isBatchRangeMode: () => boolean;
  getBatchQueueItems: () => BatchDurationItem[];
  getProbedDurationSec: () => number;
  hasActiveMedia: () => boolean;
  getCompanionCurrentTimeSec: () => number;
  notifyDeckScrollCue: () => void;
}

export type TranscribeDeckHostRegistration = Pick<
  TranscribeDeckHost,
  | 'getSettingsState'
  | 'getCompiledBackends'
  | 'getLocalScannedVadModels'
  | 'saveCurrentSettings'
  | 'selectBackend'
  | 'switchSettingsCategory'
  | 'updateTranscribeOutputDirUI'
  | 'safeApplyDynamicDirection'
  | 'updateStepperButtonStates'
> &
  Partial<
    Pick<
      TranscribeDeckHost,
      | 'isBatchRangeMode'
      | 'getBatchQueueItems'
      | 'getProbedDurationSec'
      | 'hasActiveMedia'
      | 'getCompanionCurrentTimeSec'
      | 'notifyDeckScrollCue'
    >
  >;

const getAmbientWindow = (): any => (typeof window !== 'undefined' ? window : globalThis);

function createAmbientRuntimeAccessors(): Pick<
  TranscribeDeckHost,
  | 'isBatchRangeMode'
  | 'getBatchQueueItems'
  | 'getProbedDurationSec'
  | 'hasActiveMedia'
  | 'getCompanionCurrentTimeSec'
  | 'notifyDeckScrollCue'
> {
  return {
    isBatchRangeMode: () => {
      const win = getAmbientWindow();
      if (!win) return false;
      if (typeof win.batchProcessor?.getIsBatchMode === 'function') {
        return Boolean(win.batchProcessor.getIsBatchMode());
      }
      return Boolean(win.isBatchMode);
    },
    getBatchQueueItems: () => {
      const win = getAmbientWindow();
      if (!win) return [];
      if (typeof win.batchProcessor?.getItems === 'function') {
        const items = win.batchProcessor.getItems();
        return Array.isArray(items) ? items : [];
      }
      return Array.isArray(win.batchItems) ? win.batchItems : [];
    },
    getProbedDurationSec: () => {
      const win = getAmbientWindow();
      const dur = Number(win?.probedMetadata?.durationSec || win?.getActiveMediaInfo?.()?.durationSec || 0);
      return Number.isFinite(dur) && dur > 0 ? dur : 0;
    },
    hasActiveMedia: () => {
      const win = getAmbientWindow();
      return Boolean(win?.getActiveMediaInfo?.() || win?.selectedMediaFile);
    },
    getCompanionCurrentTimeSec: () => {
      const win = getAmbientWindow();
      if (typeof win?.getCompanionCurrentTimeSec === 'function') {
        return Number(win.getCompanionCurrentTimeSec()) || 0;
      }
      return 0;
    },
    notifyDeckScrollCue: () => {
      const win = getAmbientWindow();
      if (typeof win?.updateDeckScrollCue === 'function') {
        win.updateDeckScrollCue();
      }
    }
  };
}

let registeredHost: TranscribeDeckHost | null = null;

export function registerTranscribeDeckHost(host: TranscribeDeckHostRegistration): void {
  registeredHost = {
    ...createAmbientRuntimeAccessors(),
    ...host
  };
}

export function getTranscribeDeckHost(): TranscribeDeckHost {
  if (registeredHost) {
    return registeredHost;
  }
  const win = getAmbientWindow();
  return {
    getSettingsState: () => win?.settingsState ?? null,
    getCompiledBackends: () => win?.compiledBackends ?? {},
    getLocalScannedVadModels: () => (Array.isArray(win?.localScannedVadModels) ? win.localScannedVadModels : []),
    saveCurrentSettings: (immediate?: boolean) => win?.saveCurrentSettings?.(immediate),
    selectBackend: (backend: string, showToast?: boolean) => win?.selectBackend?.(backend, showToast),
    switchSettingsCategory: (catId: string) => win?.switchSettingsCategory?.(catId),
    updateTranscribeOutputDirUI: () => win?.updateTranscribeOutputDirUI?.(),
    safeApplyDynamicDirection: (el: HTMLElement | null) => win?.applyDynamicDirection?.(el),
    updateStepperButtonStates: () => {},
    ...createAmbientRuntimeAccessors()
  };
}
