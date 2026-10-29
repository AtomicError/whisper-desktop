import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
  setIsDownloadingModelRunning
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
      createElement: (tag: string) => new MockElement(tag),
      getElementById: (id: string) => elementsMap.get(id) || null
    };

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
    it('formats seconds below 60 to single-decimal seconds', () => {
      const res = formatLocalizedTimeDuration(12.4);
      expect(res).toContain('12.4');
    });

    it('formats seconds above 60 into minutes and seconds', () => {
      const res = formatLocalizedTimeDuration(125);
      expect(res).toContain('2');
      expect(res).toContain('5');
    });

    it('returns empty string for invalid or missing inputs', () => {
      expect(formatLocalizedTimeDuration(null)).toBe('');
      expect(formatLocalizedTimeDuration(undefined)).toBe('');
      expect(formatLocalizedTimeDuration(NaN)).toBe('');
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
    });
  });

  describe('nativeWindow controller namespace export', () => {
    it('exposes all expected functions and window bindings', () => {
      expect(typeof nativeWindow.getBasename).toBe('function');
      expect(typeof nativeWindow.getParentDir).toBe('function');
      expect(typeof nativeWindow.splitFileNameAndExt).toBe('function');
      expect(typeof nativeWindow.truncateFileName).toBe('function');
      expect(typeof nativeWindow.copyToClipboard).toBe('function');
      expect(typeof (window as any).getBasename).toBe('function');
      expect(typeof (window as any).copyToClipboard).toBe('function');
      expect(typeof (window as any).setupTitlebar).toBe('function');
    });
  });
});
