import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  invoke,
  listen,
  mapTranscribeStatusKey,
  cleanupTauriListeners,
  setupTauriListeners,
  getUnlistenFns,
  getActiveModelDownloadsCount,
  getActiveModelDownloadNames,
  setOriginalInvoke,
  setOriginalListen
} from './tauriEvents';
import { getIsDownloadingModelRunning } from './nativeWindow';
import { modelHub } from './modelHub';
import { transcriptViewer } from './transcriptViewer';
import { logsController } from './logsController';

class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public textContent = '';
  public dataset: Record<string, string> = {};
  public classList = {
    add: (cls: string) => { if (!this.className.includes(cls)) this.className = `${this.className} ${cls}`.trim(); },
    remove: (cls: string) => { this.className = this.className.replace(cls, '').trim(); },
    contains: (cls: string) => this.className.includes(cls),
    toggle: (cls: string, force?: boolean) => {
      const exists = this.className.includes(cls);
      const shouldHave = force !== undefined ? force : !exists;
      if (shouldHave) this.classList.add(cls);
      else this.classList.remove(cls);
      return shouldHave;
    }
  };
  private attributes: Map<string, string> = new Map();

  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockElement | null {
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    return [];
  }

  addEventListener(type: string, cb: (e: any) => void) {}
  removeEventListener(type: string, cb: (e: any) => void) {}
}

describe('tauriEvents module', () => {
  let domMap: Map<string, MockElement>;

  beforeEach(() => {
    domMap = new Map();
    cleanupTauriListeners();
    setOriginalInvoke(null);
    setOriginalListen(null);

    const fillBar = new MockElement('DIV');
    fillBar.id = 'progress-linear-fill';
    domMap.set('progress-linear-fill', fillBar);

    const pctEl = new MockElement('DIV');
    pctEl.id = 'lbl-radial-pct';
    domMap.set('lbl-radial-pct', pctEl);

    const msgEl = new MockElement('DIV');
    msgEl.id = 'lbl-radial-msg';
    domMap.set('lbl-radial-msg', msgEl);

    const hudCard = new MockElement('DIV');
    hudCard.id = 'telemetry-hud-card';
    domMap.set('telemetry-hud-card', hudCard);

    const pulseDot = new MockElement('DIV');
    pulseDot.id = 'hud-pulse-dot';
    domMap.set('hud-pulse-dot', pulseDot);

    const badge = new MockElement('DIV');
    badge.id = 'badge-transcribe-status';
    domMap.set('badge-transcribe-status', badge);

    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      body: new MockElement('BODY'),
      getElementById: (id: string) => domMap.get(id) || null,
      querySelector: (selector: string) => null,
      querySelectorAll: (selector: string) => [],
      createElement: (tag: string) => new MockElement(tag)
    };
  });

  afterEach(() => {
    cleanupTauriListeners();
    vi.restoreAllMocks();
  });

  describe('mapTranscribeStatusKey helper', () => {
    it('maps known stages to correct translation keys', () => {
      expect(mapTranscribeStatusKey({ stage: 'converting' })).toBe('transcribe.convertingAudio16k');
      expect(mapTranscribeStatusKey({ stage: 'wav_ready' })).toBe('transcribe.wavReadyTranscribing');
      expect(mapTranscribeStatusKey({ stage: 'model_init' })).toBe('transcribe.progressTranscribe');
      expect(mapTranscribeStatusKey({ stage: 'transcribing' })).toBe('transcribe.aiTranscribingStatus');
      expect(mapTranscribeStatusKey({ stage: 'completed' })).toBe('transcribe.progressComplete');
      expect(mapTranscribeStatusKey({ stage: 'aborted' })).toBe('transcribe.cancelled');
      expect(mapTranscribeStatusKey({ stage: 'failed' })).toBe('transcribe.taskFailed');
    });

    it('falls back to message string matching when stage is absent', () => {
      expect(mapTranscribeStatusKey({ message: 'Converting to 16kHz WAV...' })).toBe('transcribe.convertingAudio16k');
      expect(mapTranscribeStatusKey({ message: 'Conversion complete, starting transcription' })).toBe('transcribe.wavReadyTranscribing');
      expect(mapTranscribeStatusKey({ message: 'Running Whisper AI model on CPU' })).toBe('transcribe.progressTranscribe');
      expect(mapTranscribeStatusKey({ message: 'Transcribing: 45%' })).toBe('transcribe.aiTranscribingStatus');
      expect(mapTranscribeStatusKey({ message: 'Transcription successfully completed' })).toBe('transcribe.progressComplete');
      expect(mapTranscribeStatusKey({ message: 'Aborted' })).toBe('transcribe.cancelled');
      expect(mapTranscribeStatusKey({ message: 'Task Failed' })).toBe('transcribe.taskFailed');
    });

    it('returns null for empty or unrecognized payloads', () => {
      expect(mapTranscribeStatusKey(null)).toBeNull();
      expect(mapTranscribeStatusKey({})).toBeNull();
      expect(mapTranscribeStatusKey({ message: 'Random log output' })).toBeNull();
    });
  });

  describe('invoke & listen safe fallbacks', () => {
    it('returns standard mock settings when originalInvoke is missing', async () => {
      const settings = await invoke('load_settings');
      expect(settings).toBeDefined();
      expect(settings.threads).toBe(4);
      expect(settings.modelPath).toBe('ggml-base.en.bin');
    });

    it('returns reset defaults when invoking reset_whisper_core_settings', async () => {
      const reset = await invoke('reset_whisper_core_settings');
      expect(reset).toBeDefined();
      expect(reset.language).toBe('auto');
      expect(reset.temperature).toBe(0.0);
    });

    it('mocks scan_models and check_build gracefully', async () => {
      const build = await invoke('check_build');
      expect(build).toBe(true);

      const models = await invoke('scan_models');
      expect(models.transModels).toContain('ggml-base.en.bin');
      expect(models.vadModels).toContain('ggml-silero-v6.2.0.bin');
    });

    it('delegates to originalInvoke when configured', async () => {
      const mockFn = vi.fn().mockResolvedValue({ custom: 123 });
      setOriginalInvoke(mockFn);

      const result = await invoke('custom_command', { arg1: 'test' });
      expect(mockFn).toHaveBeenCalledWith('custom_command', { arg1: 'test' });
      expect(result).toEqual({ custom: 123 });
    });
  });

  describe('event listener registration and lifecycle', () => {
    it('registers event handlers and stores unlisten callbacks', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      const mockUnlisten = vi.fn();
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(mockUnlisten);
      }));

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(getUnlistenFns().length).toBe(4);

      cleanupTauriListeners();
      expect(mockUnlisten).toHaveBeenCalledTimes(4);
      expect(getUnlistenFns().length).toBe(0);
    });

    it('handles transcribe-status events and updates UI elements', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      handlers['transcribe-status']({
        payload: {
          active: true,
          progress: 0.42,
          stage: 'transcribing'
        }
      });

      const fillBar = domMap.get('progress-linear-fill');
      const pctEl = domMap.get('lbl-radial-pct');
      expect(fillBar?.style.width).toBe('42%');
      expect(pctEl?.textContent).toBe('42%');
    });

    it('handles translation-status events and toggles pulse dot', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      const pulseDot = domMap.get('hud-pulse-dot');

      handlers['translation-status']({
        payload: {
          active: true,
          progress: 0.75,
          message: 'Translating with AI...'
        }
      });

      expect(pulseDot?.classList.contains('active')).toBe(true);

      handlers['translation-status']({
        payload: {
          active: false,
          progress: 1.0,
          message: 'AI translation complete'
        }
      });

      expect(pulseDot?.classList.contains('active')).toBe(false);
    });

    it('intercepts Whisper log messages and appends transcript cues', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      const appendSpy = vi.spyOn(transcriptViewer, 'appendLine').mockImplementation(() => {});

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      handlers['log-message']({
        payload: {
          timestamp: '09:15:30',
          category: 'Whisper',
          message: '[00:00:01.000 --> 00:00:03.500] Hello world subtitle segment'
        }
      });

      expect(appendSpy).toHaveBeenCalledWith('[00:00:01 --> 00:00:03]', 'Hello world subtitle segment');
      expect(logsController.allLogs[logsController.allLogs.length - 1].timestamp).toBe('09:15:30');

      handlers['log-message']({
        payload: {
          category: 'Whisper',
          message: 'Fallback timestamp test'
        }
      });
      expect(logsController.allLogs[logsController.allLogs.length - 1].timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      appendSpy.mockRestore();
    });

    it('does not append duplicate DOM log lines when log-message repeats an already-seen seq', async () => {
      logsController.clear();
      const viewport = new MockElement('DIV') as MockElement & { innerHTML?: string };
      viewport.id = 'log-viewport';
      Object.defineProperty(viewport, 'innerHTML', {
        set(val: string) {
          if (val === '') viewport.children = [];
        },
        configurable: true,
      });
      domMap.set('log-viewport', viewport);

      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      logsController.hydrate([
        { seq: 42, timestamp: '11:00:00', category: 'Settings', message: 'Hydrated setting warning' }
      ]);
      logsController.redraw();
      expect(viewport.children.length).toBe(1);

      // Simulate late in-flight event with same seq arriving after hydrate/redraw
      handlers['log-message']({
        payload: {
          seq: 42,
          timestamp: '11:00:00',
          category: 'Settings',
          message: 'Hydrated setting warning'
        }
      });

      expect(logsController.allLogs.length).toBe(1);
      expect(viewport.children.length).toBe(1);
    });

    it('keeps isDownloadingModelRunning active across parallel model downloads until all finish', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      const setProgressBarMock = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = {
        window: {
          getCurrentWindow: () => ({ setProgressBar: setProgressBarMock })
        }
      };

      const loadSpy = vi.spyOn(modelHub, 'loadStatuses').mockResolvedValue(undefined);
      (globalThis as any).window.showNotification = vi.fn();

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Start two concurrent model downloads
      handlers['model-download-status']({
        payload: { modelName: 'small', phase: 'downloading', progress: 0.4, downloadedBytes: 400, totalBytes: 1000, speedBps: 100 }
      });
      handlers['model-download-status']({
        payload: { modelName: 'base', phase: 'downloading', progress: 0.8, downloadedBytes: 800, totalBytes: 1000, speedBps: 100 }
      });

      expect(getActiveModelDownloadsCount()).toBe(2);
      expect(getIsDownloadingModelRunning()).toBe(true);
      expect(setProgressBarMock).toHaveBeenLastCalledWith({ status: 'normal', progress: 60 });

      // Completing one model must NOT clear active download flag or taskbar progress while the second is still running
      handlers['model-download-status']({
        payload: { modelName: 'base', phase: 'completed', progress: 1, downloadedBytes: 1000, totalBytes: 1000, speedBps: 0 }
      });

      expect(getActiveModelDownloadsCount()).toBe(1);
      expect(getIsDownloadingModelRunning()).toBe(true);
      expect(setProgressBarMock).toHaveBeenLastCalledWith({ status: 'normal', progress: 40 });

      // Pausing/completing the last remaining model clears both
      handlers['model-download-status']({
        payload: { modelName: 'small', phase: 'paused', progress: 0.4, downloadedBytes: 400, totalBytes: 1000, speedBps: 0 }
      });

      expect(getActiveModelDownloadsCount()).toBe(0);
      expect(getIsDownloadingModelRunning()).toBe(false);
      expect(setProgressBarMock).toHaveBeenLastCalledWith({ status: 'none' });

      loadSpy.mockRestore();
      delete (globalThis as any).window.__TAURI__;
    });

    it('handles verifying phase without clearing active download protection', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      const barFill = new MockElement('DIV');
      const statusEl = new MockElement('DIV') as MockElement & { innerHTML?: string };
      statusEl.innerHTML = '';
      const progressBlock = new MockElement('DIV');
      const barContainer = new MockElement('DIV');
      const card = new MockElement('DIV') as any;
      card.dataset.model = 'large-v3';
      card.querySelector = (sel: string) => {
        if (sel === '.model-progress-block') return progressBlock;
        if (sel === '.progress-bar-container') return barContainer;
        if (sel === '.progress-bar-fill') return barFill;
        if (sel === '.model-progress-status') return statusEl;
        if (sel === '[data-action="pause"]') return new MockElement('BUTTON');
        if (sel === '.badge-downloading') return new MockElement('SPAN');
        return null;
      };

      const origQuerySelector = (globalThis as any).document.querySelector;
      (globalThis as any).document.querySelector = (sel: string) => (sel.includes('large-v3') ? card : origQuerySelector(sel));

      const loadSpy = vi.spyOn(modelHub, 'loadStatuses').mockResolvedValue(undefined);
      (globalThis as any).window.showNotification = vi.fn();

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      handlers['model-download-status']({
        payload: { modelName: 'large-v3', phase: 'verifying', progress: 1, downloadedBytes: 3095033483, totalBytes: 3095033483, speedBps: 0 }
      });

      expect(getActiveModelDownloadsCount()).toBe(1);
      expect(getIsDownloadingModelRunning()).toBe(true);
      expect(barFill.style.width).toBe('100%');
      expect(statusEl.innerHTML).toBe('Verifying integrity...');

      handlers['model-download-status']({
        payload: { modelName: 'large-v3', phase: 'completed', progress: 1, downloadedBytes: 3095033483, totalBytes: 3095033483, speedBps: 0 }
      });
      expect(getActiveModelDownloadsCount()).toBe(0);
      expect(getIsDownloadingModelRunning()).toBe(false);

      loadSpy.mockRestore();
      (globalThis as any).document.querySelector = origQuerySelector;
    });

    it('exposes active model download names and clears stall timer even when card is off-screen', async () => {
      const handlers: Record<string, (e: any) => void> = {};
      setOriginalListen(vi.fn().mockImplementation((event: string, handler: (e: any) => void) => {
        handlers[event] = handler;
        return Promise.resolve(() => {});
      }));

      setupTauriListeners();
      await new Promise(resolve => setTimeout(resolve, 10));

      (globalThis as any).window._modelStallTimers = {
        tiny: setTimeout(() => {}, 10000)
      };

      handlers['model-download-status']({
        payload: { modelName: 'tiny', phase: 'downloading', progress: 0.5, downloadedBytes: 1000, totalBytes: 2000, speedBps: 500 }
      });

      expect(getActiveModelDownloadNames()).toEqual(['tiny']);
      expect((globalThis as any).window._modelStallTimers.tiny).toBeUndefined();
    });
  });
});
