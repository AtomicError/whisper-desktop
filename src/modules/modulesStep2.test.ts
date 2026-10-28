import { describe, expect, it, beforeEach } from 'vitest';
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
});
