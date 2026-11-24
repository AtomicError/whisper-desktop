import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { loadResolvedHtml } from '../testUtils';
import {
  transcriptViewer,
  formatMsToTimestamp,
  parseTimestampStringToMs,
  parseSegmentTimestamps,
  parseTranscriptTimeRange,
  getTranscriptLines,
  clearTranscriptLines
} from './transcriptViewer';
import {
  modelHub,
  getModelMetaInfo,
  formatModelDownloadProgress,
  formatRemainingTime,
  invalidateModelStatusesCache,
  renderFamilyHeaderBanner
} from './modelHub';

describe('transcriptViewer', () => {
  beforeEach(() => {
    transcriptViewer.clear();
  });

  describe('Timestamp formatting and parsing', () => {
    it('formats millisecond integers to standard [HH:MM:SS.mmm] timestamp format', () => {
      expect(formatMsToTimestamp(0)).toBe('00:00:00.000');
      expect(formatMsToTimestamp(4920)).toBe('00:00:04.920');
      expect(formatMsToTimestamp(83456)).toBe('00:01:23.456');
      expect(formatMsToTimestamp(3604920)).toBe('01:00:04.920');
      expect(formatMsToTimestamp(10800500)).toBe('03:00:00.500');
    });

    it('parses various timestamp strings to millisecond numbers', () => {
      expect(parseTimestampStringToMs('00:00:00.000')).toBe(0);
      expect(parseTimestampStringToMs('00:00:04.920')).toBe(4920);
      expect(parseTimestampStringToMs('00:01:23.456')).toBe(83456);
      expect(parseTimestampStringToMs('00:01:23,456')).toBe(83456);
      expect(parseTimestampStringToMs('03:00:00.500')).toBe(10800500);
      expect(parseTimestampStringToMs('invalid')).toBeNull();
      expect(parseTimestampStringToMs(null as any)).toBeNull();
    });

    it('parses segment timestamps across integer ms, float seconds, and colons', () => {
      // whisper.cpp integer ms
      expect(parseSegmentTimestamps(0, 4920)).toEqual({ startMs: 0, endMs: 4920 });
      expect(parseSegmentTimestamps(50000, 54920)).toEqual({ startMs: 50000, endMs: 54920 });

      // OpenAI Whisper float seconds
      expect(parseSegmentTimestamps('0.0', '4.92')).toEqual({ startMs: 0, endMs: 4920 });

      // Long audio > 2.7 hours (> 10,000s)
      expect(parseSegmentTimestamps('10800.5', '10805.2')).toEqual({ startMs: 10800500, endMs: 10805200 });

      // Colon formats
      expect(parseSegmentTimestamps('00:01:23.456', '00:01:27.890')).toEqual({ startMs: 83456, endMs: 87890 });
      expect(parseSegmentTimestamps('"01:00:00.000"', '"01:00:04.920"')).toEqual({ startMs: 3600000, endMs: 3604920 });

      // Invalid handling
      expect(parseSegmentTimestamps(null, null)).toBeNull();
      expect(parseSegmentTimestamps('abc', '123')).toBeNull();
    });

    it('parses bracketed transcript time range strings', () => {
      expect(parseTranscriptTimeRange('[00:00:01.000 --> 00:00:03.500]')).toEqual({
        raw: '00:00:01.000 → 00:00:03.500',
        durLabel: '3s'
      });
      expect(parseTranscriptTimeRange('00:00:01.000 --> 00:00:03.500')).toEqual({
        raw: '00:00:01.000 → 00:00:03.500',
        durLabel: '3s'
      });
      expect(parseTranscriptTimeRange('Line 1')).toEqual({
        raw: 'Line 1',
        durLabel: ''
      });
      expect(parseTranscriptTimeRange('')).toEqual({
        raw: '',
        durLabel: ''
      });
    });
  });

  describe('Transcript state and controller', () => {
    it('manages transcript lines array state and clearing', () => {
      expect(transcriptViewer.getLines()).toEqual([]);
      transcriptViewer.lines = [
        { id: 0, timeRange: '[00:00:00.000 --> 00:00:02.000]', text: 'Line 1' },
        { id: 1, timeRange: '[00:00:02.000 --> 00:00:04.000]', text: 'Line 2' }
      ];
      expect(transcriptViewer.getLines().length).toBe(2);
      expect(transcriptViewer.lines[0].text).toBe('Line 1');

      transcriptViewer.clear();
      expect(transcriptViewer.getLines().length).toBe(0);
    });

    it('exposes all required controller methods, named functions, and window shims', () => {
      expect(typeof transcriptViewer.getLines).toBe('function');
      expect(typeof transcriptViewer.clear).toBe('function');
      expect(typeof transcriptViewer.appendLine).toBe('function');
      expect(typeof transcriptViewer.render).toBe('function');
      expect(typeof transcriptViewer.createCard).toBe('function');
      expect(typeof transcriptViewer.updateLineText).toBe('function');
      expect(typeof transcriptViewer.filter).toBe('function');
      expect(typeof transcriptViewer.copy).toBe('function');
      expect(typeof transcriptViewer.loadFromFile).toBe('function');
      expect(typeof transcriptViewer.autoResize).toBe('function');
      expect(typeof transcriptViewer.setupDirection).toBe('function');
      expect(typeof transcriptViewer.parseTimeRange).toBe('function');
      expect(typeof transcriptViewer.formatMs).toBe('function');
      expect(typeof transcriptViewer.parseTimestamp).toBe('function');
      expect(typeof transcriptViewer.parseSegments).toBe('function');

      // Named functions
      expect(typeof getTranscriptLines).toBe('function');
      expect(typeof clearTranscriptLines).toBe('function');

      // Global window backwards-compatibility shims
      if (typeof window !== 'undefined') {
        expect(typeof (window as any).parseTranscriptTimeRange).toBe('function');
        expect(typeof (window as any).getTranscriptLines).toBe('function');
        expect(typeof (window as any).clearTranscriptLines).toBe('function');
        expect(typeof (window as any).renderTranscriptLines).toBe('function');
        expect(typeof (window as any).appendTranscriptLine).toBe('function');
        expect(typeof (window as any).copyLiveTranscriptToClipboard).toBe('function');
        expect(typeof (window as any).renderFamilyHeaderBanner).toBe('function');
      }
    });

    it('creates transcript card DOM elements and updates line text', () => {
      const originalDoc = (globalThis as any).document;
      class MockElement {
        public tagName: string;
        public className = '';
        public dataset: Record<string, string> = {};
        public style: Record<string, string> = {};
        public children: MockElement[] = [];
        public textContent = '';
        public value = '';
        public rows = 1;
        public innerHTML = '';
        private attrs = new Map<string, string>();
        constructor(tag: string) { this.tagName = tag.toUpperCase(); }
        setAttribute(k: string, v: string) { this.attrs.set(k, v); }
        removeAttribute(k: string) { this.attrs.delete(k); }
        appendChild(c: MockElement) { this.children.push(c); }
        querySelector(selector: string): MockElement | null {
          const match = (el: MockElement): MockElement | null => {
            if (selector.startsWith('.') && el.className.split(' ').includes(selector.slice(1))) return el;
            for (const child of el.children) {
              const found = match(child);
              if (found) return found;
            }
            return null;
          };
          return match(this);
        }
      }

      (globalThis as any).document = {
        createElement: (tag: string) => new MockElement(tag)
      };

      try {
        const card = transcriptViewer.createCard({
          id: 0,
          timeRange: '[00:00:01.000 --> 00:00:03.500]',
          text: 'Initial text'
        }) as any;
        expect(card).toBeDefined();
        expect(card.className).toContain('transcript-card');
        expect(card.querySelector('.transcript-card-num')?.textContent).toBe('#1');
        const textarea = card.querySelector('.transcript-text-input');
        expect(textarea.value).toBe('Initial text');

        transcriptViewer.lines = [{ id: 0, timeRange: '[00:00:01.000 --> 00:00:03.500]', text: 'Initial text' }];
        transcriptViewer.updateLineText(0, 'Updated content');
        expect(transcriptViewer.lines[0].text).toBe('Updated content');
      } finally {
        (globalThis as any).document = originalDoc;
      }
    });

    it('manages batch stream isolation: stores to active item and avoids view hijack when reading another item', () => {
      const originalWindow = (globalThis as any).window;
      const batchItem0 = { id: 0, path: '/audio/0.mp3', transcriptLines: [] as any[] };
      const batchItem1 = { id: 1, path: '/audio/1.mp3', transcriptLines: [] as any[] };

      (globalThis as any).window = {
        isBatchExtracting: true,
        batchProcessingIndex: 1, // Currently processing item 1
        batchItems: [batchItem0, batchItem1],
        activeBatchViewerIndex: 0, // User clicked item 0 to view historical transcript
        isBatchMode: true
      };

      try {
        transcriptViewer.lines = [{ id: 0, timeRange: '[00:00:00.000 --> 00:00:01.000]', text: 'Item 0 line' }];

        // Whisper streams a line for currently processing item 1
        transcriptViewer.appendLine('[00:00:05.000 --> 00:00:08.000]', 'Item 1 streaming line');

        // 1. Line MUST be recorded in active item's in-memory transcriptLines
        expect(batchItem1.transcriptLines).toHaveLength(1);
        expect(batchItem1.transcriptLines[0].text).toBe('Item 1 streaming line');

        // 2. Viewer lines MUST NOT be hijacked (viewer was viewing item 0)
        expect(transcriptViewer.lines).toHaveLength(1);
        expect(transcriptViewer.lines[0].text).toBe('Item 0 line');
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });
});

describe('modelHub', () => {
  describe('getModelMetaInfo', () => {
    it('resolves precision and language metadata for Whisper models', () => {
      const tinyEn = getModelMetaInfo('tiny.en');
      expect(tinyEn.langText).toBe('English Only');
      expect(tinyEn.isVad).toBe(false);

      const base = getModelMetaInfo('base');
      expect(base.langText).toBe('Multilingual (100+ Languages)');
      expect(base.isVad).toBe(false);

      const q5 = getModelMetaInfo('base-q5_1');
      expect(q5.precisionText).toBe('5-bit Quantized');

      const q8 = getModelMetaInfo('small-q8_0');
      expect(q8.precisionText).toBe('8-bit Quantized');
    });

    it('identifies VAD model properly', () => {
      const vad = getModelMetaInfo('silero-vad.onnx');
      expect(vad.isVad).toBe(true);
      expect(vad.langText).toBe('Voice Activity Detection (VAD)');
    });

    it('safely handles null, undefined, or empty model names', () => {
      const empty = getModelMetaInfo('');
      expect(empty.isVad).toBe(false);
      expect(empty.langText).toBe('Multilingual (100+ Languages)');

      const nil = getModelMetaInfo(null as any);
      expect(nil.isVad).toBe(false);
      expect(nil.langText).toBe('Multilingual (100+ Languages)');
    });
  });

  describe('formatModelDownloadProgress', () => {
    it('formats downloaded bytes and percentage accurately', () => {
      // Sub-megabyte formatted as KB
      const progressKb = formatModelDownloadProgress(512000, 1024000, 50);
      expect(progressKb).toContain('500');
      expect(progressKb).toContain('50%');

      // Megabyte scale formatted as MB
      const progressMb = formatModelDownloadProgress(50 * 1048576, 100 * 1048576, 50);
      expect(progressMb).toContain('50');
      expect(progressMb).toContain('MB');
      expect(progressMb).toContain('50%');
    });

    it('handles indeterminate total with ellipsis', () => {
      const progressIndeterminate = formatModelDownloadProgress(10485760, 0, 0);
      expect(progressIndeterminate).toContain('10');
      expect(progressIndeterminate).toContain('MB');
      expect(progressIndeterminate).toContain('...');
    });
  });

  describe('formatRemainingTime', () => {
    it('formats seconds, minutes, and hours properly', () => {
      expect(formatRemainingTime(0)).toBe('Unknown');
      expect(formatRemainingTime(-5)).toBe('Unknown');
      expect(formatRemainingTime(45)).toContain('45');
      expect(formatRemainingTime(180)).toContain('3');
      expect(formatRemainingTime(3600)).toContain('1');
    });
  });

  describe('modelHub controller methods', () => {
    it('exposes all required modelHub controller methods and SVG icons', () => {
      expect(typeof modelHub.loadStatuses).toBe('function');
      expect(typeof modelHub.download).toBe('function');
      expect(typeof modelHub.pause).toBe('function');
      expect(typeof modelHub.delete).toBe('function');
      expect(typeof modelHub.filter).toBe('function');
      expect(typeof modelHub.setCategory).toBe('function');
      expect(typeof modelHub.setQuickFilter).toBe('function');
      expect(typeof modelHub.setFilter).toBe('function');
      expect(typeof modelHub.clearSearch).toBe('function');
      expect(typeof modelHub.getMetaInfo).toBe('function');
      expect(typeof modelHub.formatProgress).toBe('function');
      expect(typeof modelHub.formatRemainingTime).toBe('function');
      expect(typeof modelHub.renderBanner).toBe('function');
      expect(typeof modelHub.invalidateCache).toBe('function');
      expect(typeof invalidateModelStatusesCache).toBe('function');

      // Executing invalidate cache should run without throwing
      expect(() => modelHub.invalidateCache()).not.toThrow();

      expect(modelHub.ICONS.DOWNLOAD).toContain('<svg');
      expect(modelHub.ICONS.DELETE).toContain('<svg');
      expect(modelHub.ICONS.PAUSE).toContain('<svg');
      expect(modelHub.ICONS.RESUME).toContain('<svg');
    });

    it('renders family header banner for categories', () => {
      const banner = modelHub.renderBanner('base', { all: 3, multi: 2, en: 1, quant: 0 });
      expect(banner).toContain('model-family-banner');
      expect(banner).toContain('Base');
      expect(banner).toContain('model-segment-btn');
    });
  });

  describe('Model Hub reliability, search, race guards, and accessibility', () => {
    const origWindow = (globalThis as any).window;
    const origDocument = (globalThis as any).document;

    afterEach(() => {
      (globalThis as any).window = origWindow;
      (globalThis as any).document = origDocument;
      invalidateModelStatusesCache();
      vi.restoreAllMocks();
    });

    function setupMinimalModelHubDom(initialSearch = '') {
      const children: any[] = [];
      const attrs = new Map<string, string>();
      const specsSubtitle = {
        attributes: new Map<string, string>([['data-i18n', 'models.subtitle']]),
        innerHTML: '',
        removeAttribute(k: string) { this.attributes.delete(k); },
        getAttribute(k: string) { return this.attributes.get(k) || null; }
      };
      const searchInput = { value: initialSearch, focus: vi.fn() };
      const clearBtn = { style: { display: 'none' } };
      const grid: any = {
        scrollTop: 120,
        children,
        _modelDelegate: false,
        set innerHTML(val: string) {
          if (val === '') children.length = 0;
        },
        insertAdjacentHTML(_pos: string, html: string) {
          children.push({ isBanner: true, html });
        },
        appendChild(el: any) {
          children.push(el);
          return el;
        },
        addEventListener: vi.fn()
      };

      const elements: Record<string, any> = {
        'model-specs-subtitle': specsSubtitle,
        'models-list-scroll': grid,
        'model-search': searchInput,
        'model-search-clear': clearBtn
      };

      const makeEl = () => ({
        className: '',
        dataset: {} as Record<string, string>,
        innerHTML: '',
        style: {} as Record<string, string>,
        attrs: new Map<string, string>(),
        setAttribute(k: string, v: string) { this.attrs.set(k, v); },
        getAttribute(k: string) { return this.attrs.get(k) || null; }
      });

      (globalThis as any).document = {
        getElementById: (id: string) => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => makeEl()
      };

      (globalThis as any).window = {
        settingsState: { modelsDir: '/tmp/models' },
        systemSpecs: { total_ram_gb: 16, cpu_cores: 8, gpu_type: 'unknown', gpu_name: 'CPU Only' },
        invoke: vi.fn()
      };

      return { grid, searchInput, specsSubtitle, attrs };
    }

    it('ignores stale get_all_models_status responses when a newer refresh completes first', async () => {
      const { grid, specsSubtitle } = setupMinimalModelHubDom();

      let resolveStale!: (val: any) => void;
      const stalePromise = new Promise(r => { resolveStale = r; });

      let callCount = 0;
      (globalThis as any).window.invoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_all_models_status') {
          callCount++;
          if (callCount === 1) return stalePromise;
          return Promise.resolve([
            { name: 'small', sizeBytes: 487601967, downloadedBytes: 1000, progress: 0.1, status: 'Paused' }
          ]);
        }
        return Promise.resolve(null);
      });

      modelHub.setCategory('small', true);
      const staleLoad = modelHub.loadStatuses(false, true);
      const freshLoad = modelHub.loadStatuses(true, true);

      await freshLoad;
      expect(grid.children.some((c: any) => !c.isBanner && c.innerHTML.includes('badge-paused'))).toBe(true);

      // Now resolve the older slow call with stale Downloading state
      resolveStale([
        { name: 'small', sizeBytes: 487601967, downloadedBytes: 1000, progress: 0.1, status: 'Downloading' }
      ]);
      await staleLoad;

      // Grid must retain the newer Paused state, not revert to Downloading
      const card = grid.children.find((c: any) => !c.isBanner);
      expect(card.innerHTML).toContain('badge-paused');
      expect(card.innerHTML).not.toContain('badge-downloading');
      expect(specsSubtitle.getAttribute('data-i18n')).toBeNull();
    });

    it('searches globally across all categories (including local) and ignores hidden quick filters during search', async () => {
      const { grid, searchInput } = setupMinimalModelHubDom();
      (globalThis as any).window.invoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_all_models_status') {
          return Promise.resolve([
            { name: 'tiny', sizeBytes: 77691713, downloadedBytes: 77691713, progress: 1, status: 'Downloaded' },
            { name: 'tiny.en', sizeBytes: 77704715, downloadedBytes: 0, progress: 0, status: 'NotDownloaded' },
            { name: 'large-v3', sizeBytes: 3095033483, downloadedBytes: 0, progress: 0, status: 'NotDownloaded' }
          ]);
        }
        return Promise.resolve(null);
      });

      // Activate 'tiny' category + 'en' quick filter, then type 'large-v3'
      modelHub.setCategory('tiny', true);
      modelHub.setQuickFilter('en');
      searchInput.value = 'large-v3';
      await modelHub.loadStatuses(false, true);

      const cards1 = grid.children.filter((c: any) => !c.isBanner && c.attrs);
      expect(cards1.length).toBe(1);
      expect(cards1[0].getAttribute('data-model')).toBe('large-v3');

      // Switch to 'local' category and search for non-downloaded 'large-v3'
      modelHub.setCategory('local', false);
      await modelHub.loadStatuses(false, true);
      const cards2 = grid.children.filter((c: any) => !c.isBanner && c.attrs);
      expect(cards2.length).toBe(1);
      expect(cards2[0].getAttribute('data-model')).toBe('large-v3');
    });

    it('reloads model statuses grid when pause_download_model fails so card never stays stuck', async () => {
      setupMinimalModelHubDom();
      const notifySpy = vi.fn();
      (globalThis as any).window.showNotification = notifySpy;
      (globalThis as any).window.invoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'pause_download_model') return Promise.reject(new Error('No active download session'));
        if (cmd === 'get_all_models_status') return Promise.resolve([]);
        return Promise.resolve(null);
      });

      await modelHub.pause('small');
      expect(notifySpy).toHaveBeenCalled();
      expect((globalThis as any).window.invoke).toHaveBeenCalledWith('get_all_models_status', { modelsDir: '/tmp/models' });
    });

    it('uses accessible button tabs with role=tab in models.html category sidebar', () => {
      const html = loadResolvedHtml();
      const sidebarMatch = html.match(/id="model-categories-sidebar"[\s\S]*?<\/div>\s*<div class="settings-scroll-container"/);
      expect(sidebarMatch).toBeTruthy();
      const sidebarHtml = sidebarMatch![0];
      expect(sidebarHtml).toContain('role="tablist"');
      expect(sidebarHtml).toContain('aria-orientation="vertical"');
      expect(sidebarHtml).toContain('<button type="button" role="tab"');
      expect(sidebarHtml).toContain('aria-controls="models-list-scroll"');
      expect(sidebarHtml).not.toContain('<div class="settings-cat-btn');
    });

    it('bypasses cache during active downloads so progress does not jump backward on quick-filter switch', async () => {
      setupMinimalModelHubDom();
      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_all_models_status') {
          return Promise.resolve([
            { name: 'tiny', sizeBytes: 77691713, downloadedBytes: 10000000, progress: 0.13, status: 'Downloading' },
            { name: 'tiny.en', sizeBytes: 77704715, downloadedBytes: 0, progress: 0, status: 'NotDownloaded' }
          ]);
        }
        return Promise.resolve(null);
      });
      (globalThis as any).window.invoke = invokeMock;

      modelHub.setCategory('tiny', true);
      await modelHub.loadStatuses(false, true);
      invokeMock.mockClear();

      // Switching quick filter within cache TTL must re-fetch while a download is active
      modelHub.setQuickFilter('multi');
      await Promise.resolve();
      await Promise.resolve();
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });

    it('renders accessible error state with retry action when get_all_models_status fails', async () => {
      const { grid } = setupMinimalModelHubDom();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (globalThis as any).window.invoke = vi.fn().mockRejectedValue(new Error('Permission denied'));

      await modelHub.loadStatuses(false, true);
      expect(grid.children.length).toBe(1);
      expect(grid.children[0].innerHTML).toContain('Unable to Load Models');
      expect(grid.children[0].innerHTML).toContain('data-action="retry-load"');
    });

    it('renders accessible quick-filter tabs with roving tabindex and data-quick-filter', () => {
      const banner = modelHub.renderBanner('tiny', { all: 6, multi: 3, en: 3, quant: 4 });
      expect(banner).toContain('aria-orientation="horizontal"');
      expect(banner).toContain('data-quick-filter="all"');
      expect(banner).toContain('tabindex="0"');
      expect(banner).toContain('tabindex="-1"');
      expect(banner).not.toContain('onclick="switchModelQuickFilter');
    });

    it('uses discard copy when discarding a paused partial download', async () => {
      setupMinimalModelHubDom();
      const confirmSpy = vi.fn().mockResolvedValue(true);
      const notifySpy = vi.fn();
      (globalThis as any).window.showConfirmModal = confirmSpy;
      (globalThis as any).window.showNotification = notifySpy;
      (globalThis as any).window.invoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_all_models_status') {
          return Promise.resolve([
            { name: 'small', sizeBytes: 487601967, downloadedBytes: 1000, progress: 0.1, status: 'Paused' }
          ]);
        }
        return Promise.resolve(null);
      });

      await modelHub.loadStatuses(false, true);
      await modelHub.delete('small');

      expect(confirmSpy).toHaveBeenCalledWith(
        'Discard Partial Download',
        expect.stringContaining('partial download'),
        'Discard'
      );
      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('discarded'),
        'success'
      );
    });

    it('renders verifying status and 100% progress bar when backend reports verifying: true', async () => {
      const { grid } = setupMinimalModelHubDom();
      (globalThis as any).window.invoke = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_all_models_status') {
          return Promise.resolve([
            { name: 'large-v3', sizeBytes: 3095033483, downloadedBytes: 3095033483, progress: 1, verifying: true, status: 'Downloading' }
          ]);
        }
        return Promise.resolve(null);
      });

      modelHub.setCategory('large', true);
      await modelHub.loadStatuses(false, true);

      const card = grid.children.find((c: any) => !c.isBanner);
      expect(card).toBeDefined();
      expect(card.innerHTML).toContain('Verifying integrity...');
      expect(card.innerHTML).toContain('width: 100%');
    });

    it('omits redundant single-tab quick filter bar when no sub-filters apply', () => {
      const banner = modelHub.renderBanner('local', { all: 2, multi: 2, en: 0, quant: 0 });
      expect(banner).not.toContain('model-segmented-control');
      expect(banner).not.toContain('model-segment-btn');
    });

    it('preserves keyboard focus onto pause button and updates dataset.status on downloadModelClick', async () => {
      setupMinimalModelHubDom();
      const pauseBtn = { focus: vi.fn() };
      const downloadBtn = { id: 'btn-dl' };
      const ctrlEl = {
        innerHTML: '',
        contains: (el: any) => el === downloadBtn,
        querySelector: (sel: string) => (sel === 'button[data-action="pause"]' ? pauseBtn : null)
      };
      const card: any = {
        dataset: { model: 'small', status: 'NotDownloaded', sizeMb: '465' },
        querySelector: (sel: string) => (sel === '.setting-control' ? ctrlEl : null)
      };
      (globalThis as any).document.activeElement = downloadBtn;
      (globalThis as any).document.querySelector = (sel: string) => (sel.includes('small') ? card : null);
      (globalThis as any).window.invoke = vi.fn().mockResolvedValue(undefined);

      await modelHub.download('small');

      expect(card.dataset.status).toBe('Downloading');
      expect(ctrlEl.innerHTML).toContain('data-action="pause"');
      expect(pauseBtn.focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('localizes #model-search-clear tooltip and aria-label in models.html', () => {
      const html = loadResolvedHtml();
      const clearMatch = html.match(/id="model-search-clear"[^>]*>/);
      expect(clearMatch).toBeTruthy();
      expect(clearMatch![0]).toContain('data-i18n-title="models.emptyClearSearch"');
      expect(clearMatch![0]).toContain('data-i18n-aria="models.emptyClearSearch"');
    });
  });
});
