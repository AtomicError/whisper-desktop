import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { setLanguage } from '../i18n/index';
import {
  nativeWindow,
  getBasename,
  getParentDir,
  splitFileNameAndExt,
  formatFileNameMiddleTruncate,
  formatLocalizedTimeDuration,
  setTranscribeStatusBadge,
  hasActiveBackgroundJob,
  setIsTranscriptionRunning,
  setIsTranslationRunning,
  setIsHardsubRunning,
  setIsDownloadingModelRunning,
  getIsTranscriptionRunning,
  getIsTranslationRunning,
  getIsHardsubRunning,
  getIsDownloadingModelRunning,
  getIsTranscribingActive,
  showInFolder,
  openFileInEditor
} from './nativeWindow';

class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public style: Record<string, string> = {};
  public textContent = '';
  private attributes: Map<string, string> = new Map();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = val;
    if (name === 'class') this.className = val;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  get classList() {
    return {
      add: (...classes: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...classes: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c => set.delete(c));
        this.className = Array.from(set).join(' ');
      },
      contains: (cls: string) => this.className.split(' ').includes(cls)
    };
  }
}

describe('nativeWindow & OS Module', () => {
  let origDoc: any;
  let elementsMap: Map<string, MockElement>;

  beforeEach(() => {
    origDoc = (globalThis as any).document;
    elementsMap = new Map();

    (globalThis as any).document = {
      documentElement: new MockElement('HTML'),
      createElement: (tag: string) => new MockElement(tag),
      getElementById: (id: string) => elementsMap.get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => null
    };
    (globalThis as any).window.dispatchEvent = vi.fn();

    setIsTranscriptionRunning(false);
    setIsTranslationRunning(false);
    setIsHardsubRunning(false);
    setIsDownloadingModelRunning(false);
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
  });

  describe('Path and File Helpers', () => {
    it('getBasename extracts file name from Linux and Windows paths', () => {
      expect(getBasename('/home/user/video.mp4')).toBe('video.mp4');
      expect(getBasename('C:\\Users\\whisper\\audio.wav')).toBe('audio.wav');
      expect(getBasename('file_only.mkv')).toBe('file_only.mkv');
      expect(getBasename('')).toBe('');
    });

    it('getParentDir extracts parent directory correctly', () => {
      expect(getParentDir('/home/user/media/audio.wav')).toBe('/home/user/media');
      expect(getParentDir('C:\\Users\\media\\audio.wav')).toBe('C:\\Users\\media');
      expect(getParentDir('/audio.wav')).toBe('/');
      expect(getParentDir('C:\\audio.wav')).toBe('C:\\');
      expect(getParentDir('audio.wav')).toBe('');
      expect(getParentDir('')).toBe('');
    });

    it('splitFileNameAndExt splits base name and extension including compound extensions', () => {
      expect(splitFileNameAndExt('video.mp4')).toEqual({ base: 'video', ext: '.mp4' });
      expect(splitFileNameAndExt('archive.tar.gz')).toEqual({ base: 'archive', ext: '.tar.gz' });
      expect(splitFileNameAndExt('model.ggml.bin')).toEqual({ base: 'model', ext: '.ggml.bin' });
      expect(splitFileNameAndExt('noextension')).toEqual({ base: 'noextension', ext: '' });
      expect(splitFileNameAndExt('')).toEqual({ base: '', ext: '' });
    });

    it('formatFileNameMiddleTruncate performs smart middle truncation', () => {
      const shortName = 'short.mp4';
      expect(formatFileNameMiddleTruncate(shortName, 20)).toBe('short.mp4');

      const longName = 'this_is_a_very_long_file_name_for_testing.mp4';
      const truncated = formatFileNameMiddleTruncate(longName, 20);
      expect(truncated.length).toBeLessThanOrEqual(20);
      expect(truncated).toContain('…');
      expect(truncated.endsWith('.mp4')).toBe(true);

      expect(formatFileNameMiddleTruncate('')).toBe('');
    });
  });

  describe('formatLocalizedTimeDuration helper', () => {
    it('formats seconds below 60 to single-decimal seconds when fractional', () => {
      const res = formatLocalizedTimeDuration(12.4);
      expect(res).toContain('12.4');
    });

    it('formats whole seconds cleanly without decimal points', () => {
      const res = formatLocalizedTimeDuration(7);
      expect(res).toBe('7 sec');
    });

    it('formats 0 seconds cleanly as 0 sec', () => {
      const res = formatLocalizedTimeDuration(0);
      expect(res).toBe('0 sec');
    });

    it('formats seconds above 60 into minutes and seconds', () => {
      const res = formatLocalizedTimeDuration(125);
      expect(res).toContain('2');
      expect(res).toContain('5');
    });

    it('handles minute boundary overflow correctly without producing 60 sec', () => {
      // 119.8s rounds to 120s which should be cleanly "2 min" and NOT "1 min 60 sec"
      const res1 = formatLocalizedTimeDuration(119.8);
      expect(res1).toBe('2 min');

      // 59.96s rounds to 60s which should be "1 min"
      const res2 = formatLocalizedTimeDuration(59.96);
      expect(res2).toBe('1 min');
    });

    it('formats durations over an hour with hours, minutes, and seconds', () => {
      const res = formatLocalizedTimeDuration(3665);
      expect(res).toContain('1');
      expect(res).toContain('5');
    });

    it('handles hour boundary overflow correctly without producing 60 min or 60 sec', () => {
      // 3599.8s rounds to 3600s which should be "1 hr"
      const res = formatLocalizedTimeDuration(3599.8);
      expect(res).toBe('1 hr');
    });

    it('localizes time duration in Persian cleanly with Persian digits', () => {
      try {
        setLanguage('fa', false);
        const res = formatLocalizedTimeDuration(7);
        expect(res).toBe('۷ ثانیه');
      } finally {
        setLanguage('en', false);
      }
    });

    it('returns empty string for invalid, negative, infinite, or missing inputs', () => {
      expect(formatLocalizedTimeDuration(null)).toBe('');
      expect(formatLocalizedTimeDuration(undefined)).toBe('');
      expect(formatLocalizedTimeDuration(NaN)).toBe('');
      expect(formatLocalizedTimeDuration(Infinity)).toBe('');
      expect(formatLocalizedTimeDuration(-Infinity)).toBe('');
      expect(formatLocalizedTimeDuration(-5)).toBe('');
      expect(formatLocalizedTimeDuration('')).toBe('');
    });
  });

  describe('setTranscribeStatusBadge DOM rendering', () => {
    it('updates status badge and pulse dot classes in DOM', () => {
      const badge = new MockElement('DIV');
      badge.id = 'hud-status-badge';
      elementsMap.set('hud-status-badge', badge);

      const text = new MockElement('SPAN');
      text.id = 'hud-status-text';
      elementsMap.set('hud-status-text', text);

      const dot = new MockElement('SPAN');
      dot.id = 'hud-pulse-dot';
      elementsMap.set('hud-pulse-dot', dot);

      setTranscribeStatusBadge('active', '', 'Processing');
      expect(badge.className).toContain('active');
      expect(text.textContent).toBe('Processing');
      expect(dot.classList.contains('active')).toBe(true);

      setTranscribeStatusBadge('', '', 'Idle');
      expect(dot.classList.contains('active')).toBe(false);
    });
  });

  describe('Background job tracking', () => {
    it('tracks active jobs across transcription, translation, hardsub, and downloads', () => {
      expect(hasActiveBackgroundJob()).toBe(false);

      setIsTranscriptionRunning(true);
      expect(hasActiveBackgroundJob()).toBe(true);

      setIsTranscriptionRunning(false);
      setIsTranslationRunning(true);
      expect(hasActiveBackgroundJob()).toBe(true);

      setIsTranslationRunning(false);
      setIsDownloadingModelRunning(true);
      expect(hasActiveBackgroundJob()).toBe(true);

      setIsDownloadingModelRunning(false);
      expect(hasActiveBackgroundJob()).toBe(false);

      (window as any).isBatchExtracting = true;
      expect(hasActiveBackgroundJob()).toBe(true);
      (window as any).isBatchExtracting = false;
      expect(hasActiveBackgroundJob()).toBe(false);

      (window as any).isTranscribing = true;
      expect(getIsTranscribingActive()).toBe(true);
      expect(hasActiveBackgroundJob()).toBe(true);
      (window as any).isTranscribing = false;
      expect(getIsTranscribingActive()).toBe(false);
      expect(hasActiveBackgroundJob()).toBe(false);
    });

    it('synchronizes window job properties with module state without recursive loops', () => {
      // Direct setter synchronizes to window
      setIsTranscriptionRunning(true);
      expect(getIsTranscriptionRunning()).toBe(true);
      expect((window as any).isTranscriptionRunning).toBe(true);

      // Window assignment synchronizes to module state
      (window as any).isTranscriptionRunning = false;
      expect(getIsTranscriptionRunning()).toBe(false);
      expect((window as any).isTranscriptionRunning).toBe(false);

      // Translation state
      setIsTranslationRunning(true);
      expect(getIsTranslationRunning()).toBe(true);
      expect((window as any).isTranslationRunning).toBe(true);
      (window as any).isTranslationRunning = false;
      expect(getIsTranslationRunning()).toBe(false);

      // Hardsub state
      setIsHardsubRunning(true);
      expect(getIsHardsubRunning()).toBe(true);
      expect((window as any).isHardsubRunning).toBe(true);
      (window as any).isHardsubRunning = false;
      expect(getIsHardsubRunning()).toBe(false);

      // Downloading model state
      setIsDownloadingModelRunning(true);
      expect(getIsDownloadingModelRunning()).toBe(true);
      expect((window as any).isDownloadingModelRunning).toBe(true);
      (window as any).isDownloadingModelRunning = false;
      expect(getIsDownloadingModelRunning()).toBe(false);
    });
  });

  describe('showInFolder and openFileInEditor', () => {
    it('invokes show_in_folder on native backend', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(undefined);
      (window as any).__TAURI__ = { core: { invoke: mockInvoke } };

      await showInFolder('/home/user/output.srt');
      expect(mockInvoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/home/user/output.srt' });
    });

    it('falls back to opener plugin and parent directory on IPC failures', async () => {
      const mockInvoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'show_in_folder') throw new Error('Show in folder failed');
        if (cmd === 'plugin:opener|reveal_item_in_dir') throw new Error('Plugin reveal failed');
        if (cmd === 'open_file_in_editor') return Promise.resolve();
        return Promise.resolve();
      });
      (window as any).__TAURI__ = { core: { invoke: mockInvoke } };

      await showInFolder('/home/user/output.srt');
      expect(mockInvoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/home/user/output.srt' });
      expect(mockInvoke).toHaveBeenCalledWith('plugin:opener|reveal_item_in_dir', { path: '/home/user/output.srt' });
      expect(mockInvoke).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/home/user' });
    });
  });

  describe('nativeWindow controller namespace export', () => {
    it('exposes all expected functions and window bindings', () => {
      expect(typeof nativeWindow.getBasename).toBe('function');
      expect(typeof nativeWindow.getParentDir).toBe('function');
      expect(typeof nativeWindow.splitFileNameAndExt).toBe('function');
      expect(typeof nativeWindow.truncateFileName).toBe('function');
      expect(typeof nativeWindow.copyToClipboard).toBe('function');
      expect(typeof nativeWindow.showInFolder).toBe('function');
      expect(typeof nativeWindow.openFileInEditor).toBe('function');
      expect(typeof (window as any).getBasename).toBe('function');
      expect(typeof (window as any).copyToClipboard).toBe('function');
      expect(typeof (window as any).setupTitlebar).toBe('function');
      expect(typeof (window as any).showInFolder).toBe('function');
      expect(typeof (window as any).openFileInEditor).toBe('function');
    });

    it('flushes and awaits pending settings before invoking exit_app when closing titlebar', async () => {
      const prevDoc = (globalThis as any).document;
      const prevTauri = (globalThis as any).window.__TAURI__;
      const prevFlush = (globalThis as any).window.flushPendingSettingsOnUnload;
      const prevSettings = (globalThis as any).window.settingsState;

      const makeBtn = (id: string) => {
        const listeners: Record<string, Function[]> = {};
        return {
          id,
          listeners,
          addEventListener: (ev: string, fn: Function) => {
            listeners[ev] = listeners[ev] || [];
            listeners[ev].push(fn);
          },
          click: () => {
            (listeners['click'] || []).forEach(fn => fn({ preventDefault: () => {} }));
          }
        };
      };

      const minBtn = makeBtn('titlebar-minimize');
      const maxBtn = makeBtn('titlebar-maximize');
      const closeBtn = makeBtn('titlebar-close');
      const events: string[] = [];

      const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
        events.push(`invoke:${cmd}`);
      });

      const appWindowMock = {
        minimize: vi.fn().mockResolvedValue(undefined),
        toggleMaximize: vi.fn().mockResolvedValue(undefined),
        hide: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        onCloseRequested: vi.fn()
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'titlebar-minimize') return minBtn;
          if (id === 'titlebar-maximize') return maxBtn;
          if (id === 'titlebar-close') return closeBtn;
          return null;
        },
        querySelector: () => null
      };
      (globalThis as any).window.__TAURI__ = {
        core: { invoke: invokeMock },
        window: { getCurrentWindow: () => appWindowMock }
      };
      (globalThis as any).window.settingsState = { closeToTray: false };
      (globalThis as any).window.flushPendingSettingsOnUnload = vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        events.push('flush');
      });

      try {
        nativeWindow.setupTitlebar();
        closeBtn.click();
        await new Promise(resolve => setTimeout(resolve, 10));

        expect((globalThis as any).window.flushPendingSettingsOnUnload).toHaveBeenCalledTimes(1);
        expect(invokeMock.mock.calls.some(c => c[0] === 'exit_app')).toBe(true);
        expect(events).toEqual(['flush', 'invoke:exit_app']);
      } finally {
        (globalThis as any).document = prevDoc;
        (globalThis as any).window.__TAURI__ = prevTauri;
        (globalThis as any).window.flushPendingSettingsOnUnload = prevFlush;
        (globalThis as any).window.settingsState = prevSettings;
      }
    });
  });
});
