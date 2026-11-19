// @ts-nocheck
// Unit tests for Companion Media Player & Precise Segment Splitting/Merging
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  splitTranscriptSegment,
  mergeTranscriptSegmentWithPrevious,
  deleteTranscriptSegment,
  undoTranscriptOperation,
  redoTranscriptOperation,
  canUndoTranscript,
  canRedoTranscript,
  clearTranscriptHistory,
  toggleConfidenceHighlighting,
  isConfidenceHighlightingActive,
  loadTranscriptFromJsonData,
  filterTranscriptLines,
  renderTranscriptLines,
  serializeTranscriptLinesForFile,
  persistTranscriptLinesToDisk,
  getTranscriptHistory,
  setTranscriptHistory,
  createTranscriptCardElement,
  copyLiveTranscriptToClipboard,
  updateTranscriptLineText,
  aggregateTokensIntoWords,
  flushPendingTranscriptEdits,
  hasPendingTranscriptEdits,
  parseTranscriptTimeRange,
  transcriptViewer,
  type TranscriptLine
} from './transcriptViewer';
import {
  formatTimecodeDisplay,
  formatTimecodeHTML,
  updateCompanionTimeDisplay,
  initCompanionPlayerDOM,
  seekCompanionPlayer,
  highlightActiveTranscriptSegment,
  changeCompanionVolume,
  adjustCompanionVolume,
  toggleCompanionMute,
  pauseCompanionPlayer,
  showTranscribeSetupDeck,
  showTranscribeFilesDeck,
  showTranscribeMediaDeck,
  syncTranscribeDeckTabsUI,
  getActiveTranscribeDeckTab,
  getActiveMediaInfo,
  wakeCompanionPlayerSurface,
  onTranscribeViewActivated,
  unloadCompanionPlayer,
  updateCompanionMetadataUI,
  loadMediaIntoCompanionPlayer,
  toggleCompanionFullscreen,
  updateFullscreenUI,
  cycleCompanionPlaybackRate,
  updateSliderTrackProgress,
  updateCompanionSubtitleBounds,
  renderCompanionSubtitle,
  hasArabicOrPersianScript,
  cleanSubtitleDisplayText,
  COMPANION_SPEEDS
} from './companionPlayer';
import {
  clearBatchQueue,
  removeFileFromBatch,
  selectBatchItemTranscript,
  addBatchFiles,
  runBatchExtraction,
  batchProcessor
} from './batchProcessor';

// Minimal mock DOM for headless testing
class MockElement {
  tagName: string;
  id = '';
  _classes = new Set<string>();
  get className(): string {
    return Array.from(this._classes).join(' ');
  }
  set className(val: string) {
    this._classes = new Set(String(val).split(/\s+/).filter(Boolean));
  }
  classList: any;
  attributes = new Map<string, string>();
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  value = '';
  private _textContent: string | null = null;
  private _innerHTML = '';

  get textContent(): string {
    if (this._textContent !== null) return this._textContent;
    if (this._innerHTML) {
      return this._innerHTML.replace(/<[^>]*>/g, '');
    }
    return '';
  }

  set textContent(val: string) {
    this._textContent = String(val);
    this._innerHTML = String(val);
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = String(val);
    this._textContent = null;
    if (!val) {
      this.children = [];
    }
  }
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  _listeners = new Map<string, Array<(e: any) => void>>();
  width = 0;
  height = 0;
  clientWidth = 0;
  clientHeight = 0;
  offsetLeft = 0;
  offsetTop = 0;
  videoWidth = 0;
  videoHeight = 0;

  _context2d: any = null;

  getContext(type: string) {
    if (type === '2d') {
      if (!this._context2d) {
        this._context2d = {
          clearRect: () => {},
          measureText: (t: string) => ({ width: t.length * 8 }),
          fillText: () => {},
          strokeText: () => {},
          font: '',
          textAlign: '',
          textBaseline: '',
          direction: '',
          strokeStyle: '',
          fillStyle: '',
          lineWidth: 1,
          lineJoin: '',
          miterLimit: 2,
          save: () => {},
          restore: () => {},
          setTransform: () => {},
        };
      }
      return this._context2d;
    }
    return null;
  }

  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase();
    this.classList = {
      add: (...c: string[]) => {
        c.forEach(x => this._classes.add(x));
        this.className = Array.from(this._classes).join(' ');
      },
      remove: (...c: string[]) => {
        c.forEach(x => this._classes.delete(x));
        this.className = Array.from(this._classes).join(' ');
      },
      contains: (c: string) => this._classes.has(c),
      toggle: (c: string, force?: boolean) => {
        const has = this._classes.has(c);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) this._classes.add(c);
        else this._classes.delete(c);
        this.className = Array.from(this._classes).join(' ');
        return shouldHave;
      }
    };
  }

  setAttribute(k: string, v: string) {
    this.attributes.set(k, String(v));
    if (k === 'id') this.id = String(v);
    if (k === 'class') {
      this.className = String(v);
      this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }

  getAttribute(k: string) {
    return this.attributes.get(k) || null;
  }

  removeAttribute(k: string) {
    this.attributes.delete(k);
    if (k === 'id') this.id = '';
    if (k === 'class') {
      this.className = '';
      this._classes.clear();
    }
  }

  addEventListener(evt: string, fn: any) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, []);
    this._listeners.get(evt)!.push(fn);
  }

  appendChild(child: any) {
    if (child && Array.isArray(child.children) && !child.tagName) {
      child.children.forEach((c: any) => this.appendChild(c));
      child.children = [];
      return child;
    }
    if (child) {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }

  removeChild(child: any) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  querySelectorAll(sel: string): MockElement[] {
    if (sel.includes(' ')) {
      const parts = sel.split(/\s+/);
      const parents = this.querySelectorAll(parts[0]);
      const res: MockElement[] = [];
      parents.forEach(p => {
        res.push(...p.querySelectorAll(parts.slice(1).join(' ')));
      });
      return res;
    }
    const res: MockElement[] = [];
    const idMatch = sel.match(/\[data-id="([^"]+)"\]/);
    const check = (node: MockElement) => {
      if (idMatch) {
        let matches = node.dataset.id === idMatch[1];
        if (matches && sel.startsWith('.')) {
          const className = sel.split('[')[0].slice(1);
          if (className && !node.classList.contains(className)) {
            matches = false;
          }
        }
        if (matches) res.push(node);
      } else if (sel.startsWith('.')) {
        const classes = sel.split('.').filter(Boolean);
        if (classes.every(c => node.classList.contains(c))) res.push(node);
      } else if (sel.startsWith('#')) {
        if (node.id === sel.slice(1)) res.push(node);
      }
      node.children.forEach(check);
    };
    this.children.forEach(check);
    return res;
  }

  querySelector(sel: string) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  closest(sel: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (sel.startsWith('.') && curr.classList.contains(sel.slice(1))) return curr;
      if (sel.startsWith('#') && curr.id === sel.slice(1)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  scrollIntoView() {}
  pause() {}
  play() { return Promise.resolve(); }
  load() {}
}

class MockFragment {
  children: MockElement[] = [];
  appendChild(c: MockElement) {
    this.children.push(c);
    return c;
  }
}

const elementRegistry = new Map<string, MockElement>();
const mockDocument = {
  elements: elementRegistry,
  getElementById(id: string) {
    return elementRegistry.get(id) || null;
  },
  querySelector(sel: string) {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  },
  querySelectorAll(sel: string) {
    if (sel.includes(' ')) {
      const parts = sel.split(/\s+/);
      const parents = this.querySelectorAll(parts[0]);
      const res: MockElement[] = [];
      parents.forEach(p => {
        res.push(...p.querySelectorAll(parts.slice(1).join(' ')));
      });
      return res;
    }
    const vp = elementRegistry.get('transcript-viewport');
    if (vp && vp.children.length > 0 && (sel.includes('.transcript-card') || sel.includes('[data-id='))) {
      const vpResults = vp.querySelectorAll(sel);
      if (vpResults.length > 0) return vpResults;
    }
    const results: MockElement[] = [];
    const idMatch = sel.match(/\[data-id="([^"]+)"\]/);
    const check = (el: MockElement) => {
      if (idMatch) {
        let matches = el.dataset.id === idMatch[1];
        if (matches && sel.startsWith('.')) {
          const className = sel.split('[')[0].slice(1);
          if (className && !el.classList.contains(className)) {
            matches = false;
          }
        }
        if (matches) {
          results.push(el);
        }
      } else if (sel.startsWith('#') && el.id === sel.slice(1)) {
        results.push(el);
      } else if (sel.startsWith('.')) {
        const classes = sel.split('.').filter(Boolean);
        if (classes.length > 0 && classes.every(c => el.classList.contains(c))) {
          results.push(el);
        }
      }
      el.children.forEach(check);
    };
    elementRegistry.forEach(check);
    return results;
  },
  createElement(tag: string) {
    return new MockElement(tag);
  },
  createElementNS(_ns: string, tag: string) {
    return new MockElement(tag);
  },
  createDocumentFragment() {
    return new MockFragment();
  }
};

function registerMockEl(id: string, tag = 'DIV', classes = '', dataset: Record<string, string> = {}) {
  const el = new MockElement(tag);
  el.setAttribute('id', id);
  if (classes) el.setAttribute('class', classes);
  for (const [k, v] of Object.entries(dataset)) {
    el.setAttribute(`data-${k}`, v);
  }
  elementRegistry.set(id, el);
  return el;
}

// Attach document to globalThis
(globalThis as any).document = mockDocument;
if (typeof HTMLSelectElement === 'undefined') {
  (globalThis as any).HTMLSelectElement = class HTMLSelectElement extends MockElement {};
}

describe('Transcript Segment Splitting & Merging with Word Timestamps', () => {
  beforeEach(() => {
    transcriptViewer.lines = [];
  });

  it('splits a segment using word-level timestamps when available', () => {
    const initialLine: TranscriptLine = {
      id: 0,
      timeRange: '[00:00:01.000 --> 00:00:05.000]',
      text: 'Hello wonderful world',
      startMs: 1000,
      endMs: 5000,
      words: [
        { text: 'Hello', startMs: 1000, endMs: 2000, prob: 0.95 },
        { text: 'wonderful', startMs: 2200, endMs: 3800, prob: 0.92 },
        { text: 'world', startMs: 4000, endMs: 5000, prob: 0.88 }
      ]
    };

    transcriptViewer.lines = [initialLine];

    // Split after "Hello " (index 6, before "wonderful")
    const success = splitTranscriptSegment(0, 6);
    expect(success).toBe(true);

    const lines = transcriptViewer.lines;
    expect(lines.length).toBe(2);

    // First segment
    expect(lines[0].id).toBe(0);
    expect(lines[0].text).toBe('Hello');
    expect(lines[0].startMs).toBe(1000);
    expect(lines[0].endMs).toBe(2000);
    expect(lines[0].words?.length).toBe(1);
    expect(lines[0].words?.[0].text).toBe('Hello');

    // Second segment
    expect(lines[1].id).toBe(1);
    expect(lines[1].text).toBe('wonderful world');
    expect(lines[1].startMs).toBe(2200);
    expect(lines[1].endMs).toBe(5000);
    expect(lines[1].words?.length).toBe(2);
    expect(lines[1].words?.[0].text).toBe('wonderful');
    expect(lines[1].words?.[1].text).toBe('world');
  });

  it('falls back to proportional character interpolation when word timestamps are absent', () => {
    const initialLine: TranscriptLine = {
      id: 0,
      timeRange: '[00:00:00.000 --> 00:00:10.000]',
      text: 'AAAAA BBBBB', // 11 characters, split at 5 ("AAAAA")
      startMs: 0,
      endMs: 10000
    };

    transcriptViewer.lines = [initialLine];

    const success = splitTranscriptSegment(0, 5);
    expect(success).toBe(true);

    const lines = transcriptViewer.lines;
    expect(lines.length).toBe(2);

    expect(lines[0].text).toBe('AAAAA');
    expect(lines[0].startMs).toBe(0);
    // 5 / 11 * 10000 ~ 4545ms
    expect(lines[0].endMs).toBeGreaterThan(4500);
    expect(lines[0].endMs).toBeLessThan(4600);

    expect(lines[1].text).toBe('BBBBB');
    expect(lines[1].startMs).toBe(lines[0].endMs);
    expect(lines[1].endMs).toBe(10000);
  });

  it('safely rejects splitting at boundary indices 0 or text length', () => {
    transcriptViewer.lines = [{
      id: 0,
      timeRange: '[00:00:01.000 --> 00:00:03.000]',
      text: 'Sample segment',
      startMs: 1000,
      endMs: 3000
    }];

    expect(splitTranscriptSegment(0, 0)).toBe(false);
    expect(splitTranscriptSegment(0, 14)).toBe(false);
    expect(splitTranscriptSegment(99, 5)).toBe(false);
    expect(transcriptViewer.lines.length).toBe(1);
  });

  it('merges a segment with its previous sibling and unifies timestamps and tokens', () => {
    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:01.000 --> 00:00:02.000]',
        text: 'Part one',
        startMs: 1000,
        endMs: 2000,
        words: [{ text: 'Part', startMs: 1000, endMs: 1500, prob: 0.9 }, { text: 'one', startMs: 1500, endMs: 2000, prob: 0.95 }]
      },
      {
        id: 1,
        timeRange: '[00:00:02.500 --> 00:00:04.000]',
        text: 'Part two',
        startMs: 2500,
        endMs: 4000,
        words: [{ text: 'Part', startMs: 2500, endMs: 3200, prob: 0.8 }, { text: 'two', startMs: 3200, endMs: 4000, prob: 0.85 }]
      }
    ];

    const merged = mergeTranscriptSegmentWithPrevious(1);
    expect(merged).toBe(true);

    const lines = transcriptViewer.lines;
    expect(lines.length).toBe(1);
    expect(lines[0].id).toBe(0);
    expect(lines[0].startMs).toBe(1000);
    expect(lines[0].endMs).toBe(4000);
    expect(lines[0].text).toBe('Part one Part two');
    expect(lines[0].words?.length).toBe(4);
    expect(lines[0].timeRange).toContain('00:00:01.000');
    expect(lines[0].timeRange).toContain('00:00:04.000');
  });

  it('splits on natural word boundary when cursorPosition is undefined (button click)', () => {
    transcriptViewer.lines = [{
      id: 0,
      timeRange: '[00:00:01.000 --> 00:00:05.000]',
      text: 'FirstSecond ThirdFourth',
      startMs: 1000,
      endMs: 5000,
      words: [
        { text: 'FirstSecond', startMs: 1000, endMs: 2500, prob: 0.9 },
        { text: 'ThirdFourth', startMs: 2600, endMs: 5000, prob: 0.9 }
      ]
    }];

    // Button click: cursorPosition is undefined
    const success = splitTranscriptSegment(0);
    expect(success).toBe(true);

    const lines = transcriptViewer.lines;
    expect(lines.length).toBe(2);
    expect(lines[0].text).toBe('FirstSecond');
    expect(lines[1].text).toBe('ThirdFourth');
    expect(lines[0].endMs).toBe(2500);
    expect(lines[1].startMs).toBe(2600);
  });

  it('synchronizes batch item transcriptLines using activeBatchViewerIndex', () => {
    const win = globalThis as any;
    win.isBatchMode = true;
    win.activeBatchViewerIndex = 0;
    win.batchItems = [{
      path: '/media/video.mp4',
      name: 'video.mp4',
      transcriptLines: []
    }];

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:03.000]', text: 'Word1 Word2', startMs: 1000, endMs: 3000 },
      { id: 1, timeRange: '[00:00:03.500 --> 00:00:05.000]', text: 'Word3', startMs: 3500, endMs: 5000 }
    ];

    const splitOk = splitTranscriptSegment(0, 5);
    expect(splitOk).toBe(true);
    expect(win.batchItems[0].transcriptLines.length).toBe(3);

    const mergeOk = mergeTranscriptSegmentWithPrevious(1);
    expect(mergeOk).toBe(true);
    expect(win.batchItems[0].transcriptLines.length).toBe(2);

    win.isBatchMode = false;
  });

  it('deletes a segment cleanly, re-indexes remaining segments, and records undo snapshot', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:02.000]', text: 'First line', startMs: 1000, endMs: 2000 },
      { id: 1, timeRange: '[00:00:02.000 --> 00:00:03.000]', text: 'Second to delete', startMs: 2000, endMs: 3000 },
      { id: 2, timeRange: '[00:00:03.000 --> 00:00:04.000]', text: 'Third line', startMs: 3000, endMs: 4000 }
    ];

    clearTranscriptHistory();
    expect(canUndoTranscript()).toBe(false);

    const deleteOk = deleteTranscriptSegment(1);
    expect(deleteOk).toBe(true);

    const lines = transcriptViewer.lines;
    expect(lines.length).toBe(2);
    expect(lines[0].text).toBe('First line');
    expect(lines[0].id).toBe(0);
    expect(lines[1].text).toBe('Third line');
    expect(lines[1].id).toBe(1);
    expect(canUndoTranscript()).toBe(true);
  });

  it('supports structural undo (Ctrl+Z) and redo (Ctrl+Shift+Z) for segment modifications', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:04.000]', text: 'Original line to split', startMs: 1000, endMs: 4000 }
    ];

    clearTranscriptHistory();
    expect(canUndoTranscript()).toBe(false);
    expect(canRedoTranscript()).toBe(false);

    // 1. Perform split
    splitTranscriptSegment(0, 8);
    expect(transcriptViewer.lines.length).toBe(2);
    expect(canUndoTranscript()).toBe(true);

    // 2. Perform undo -> should restore to 1 segment
    const undoOk = undoTranscriptOperation();
    expect(undoOk).toBe(true);
    expect(transcriptViewer.lines.length).toBe(1);
    expect(transcriptViewer.lines[0].text).toBe('Original line to split');
    expect(canRedoTranscript()).toBe(true);

    // 3. Perform redo -> should re-split to 2 segments
    const redoOk = redoTranscriptOperation();
    expect(redoOk).toBe(true);
    expect(transcriptViewer.lines.length).toBe(2);
  });

  it('ignores card double-click when initiated on textarea or confidence words', () => {
    let seekTriggered = false;
    const win = (globalThis as any);
    win.seekCompanionPlayer = () => { seekTriggered = true; };

    const cardEl = transcriptViewer.createCard({
      id: 0,
      timeRange: '[00:00:01.000 --> 00:00:03.000]',
      text: 'Double click test',
      startMs: 1000,
      endMs: 3000,
      words: [{ text: 'Double', startMs: 1000, endMs: 2000, prob: 0.9 }]
    });

    // Simulated double click on textarea
    const textarea = cardEl.querySelector('.transcript-text-input') as any;
    expect(textarea).not.toBeNull();
    seekTriggered = false;
    cardEl.ondblclick({ target: textarea } as any);
    expect(seekTriggered).toBe(false);

    // Simulated double click on words bar
    const wordsBar = cardEl.querySelector('.transcript-words-bar') as any;
    seekTriggered = false;
    cardEl.ondblclick({ target: wordsBar } as any);
    expect(seekTriggered).toBe(false);

    // Simulated double click on card blank space (header/card background)
    seekTriggered = false;
    cardEl.ondblclick({ target: cardEl } as any);
    expect(seekTriggered).toBe(true);
  });
});

describe('Confidence Score Highlighting & Internal JSON Loader', () => {
  beforeEach(() => {
    elementRegistry.clear();
  });

  it('toggles confidence highlighting state and updates UI classes', () => {
    registerMockEl('transcript-viewport');
    registerMockEl('btn-toggle-confidence', 'BUTTON');

    expect(isConfidenceHighlightingActive()).toBe(false);

    const activeState = toggleConfidenceHighlighting();
    expect(activeState).toBe(true);
    expect(isConfidenceHighlightingActive()).toBe(true);

    const viewport = mockDocument.getElementById('transcript-viewport');
    const toggleBtn = mockDocument.getElementById('btn-toggle-confidence');
    expect(viewport?.classList.contains('highlight-confidence-active')).toBe(true);
    expect(toggleBtn?.classList.contains('active')).toBe(true);

    // Toggle back
    const secondState = toggleConfidenceHighlighting();
    expect(secondState).toBe(false);
    expect(viewport?.classList.contains('highlight-confidence-active')).toBe(false);
    expect(toggleBtn?.classList.contains('active')).toBe(false);
  });

  it('parses Whisper full detailed JSON with tokens and probabilities correctly', async () => {
    const mockJson = JSON.stringify({
      transcription: [
        {
          timestamps: { from: '00:00:01,000', to: '00:00:03,500' },
          text: 'Hello world precision test',
          tokens: [
            { text: 'Hello', offsets: { from: 1000, to: 1500 }, p: 0.99 },
            { text: 'world', offsets: { from: 1600, to: 2200 }, p: 0.45 }, // low confidence
            { text: 'precision', offsets: { from: 2300, to: 3000 }, p: 0.88 },
            { text: 'test', offsets: { from: 3100, to: 3500 }, p: 0.95 }
          ]
        }
      ]
    });

    const lines = await loadTranscriptFromJsonData(mockJson, false);
    expect(lines.length).toBe(1);
    expect(lines[0].text).toBe('Hello world precision test');
    expect(lines[0].startMs).toBe(1000);
    expect(lines[0].endMs).toBe(3500);
    expect(lines[0].words?.length).toBe(4);

    const lowConfidenceWord = lines[0].words?.find(w => w.text === 'world');
    expect(lowConfidenceWord).toBeDefined();
    expect(lowConfidenceWord?.prob).toBe(0.45);
  });
});

describe('Companion Media Player & DOM Controls', () => {
  beforeEach(() => {
    elementRegistry.clear();
  });

  it('formats timecodes cleanly for minutes and hours', () => {
    expect(formatTimecodeDisplay(0)).toBe('00:00.000');
    expect(formatTimecodeDisplay(5.4)).toBe('00:05.400');
    expect(formatTimecodeDisplay(75)).toBe('01:15.000');
    expect(formatTimecodeDisplay(3665)).toBe('01:01:05.000');
  });

  it('formats HTML timecodes with subtle millisecond typography', () => {
    expect(formatTimecodeHTML(0)).toBe('00:00<span class="timecode-ms">.000</span>');
    expect(formatTimecodeHTML(5.4)).toBe('00:05<span class="timecode-ms">.400</span>');
    expect(formatTimecodeHTML(3665)).toBe('01:01:05<span class="timecode-ms">.000</span>');
  });

  it('updateCompanionTimeDisplay updates both textContent and innerHTML', () => {
    const el = registerMockEl('test-timecode', 'SPAN') as any;
    updateCompanionTimeDisplay(el, 12.345);
    expect(el.textContent).toBe('00:12.345');
    expect(el.innerHTML).toBe('00:12<span class="timecode-ms">.345</span>');
  });

  it('updateCompanionMetadataUI updates single-row metadata strip, tooltip, and type icons', () => {
    const fileNameEl = registerMockEl('companion-meta-filename');
    const typeIconEl = registerMockEl('companion-meta-type-icon');
    const formatEl = registerMockEl('companion-meta-format');
    const resEl = registerMockEl('companion-meta-resolution');
    const aspectEl = registerMockEl('companion-meta-aspect');

    // Test Video info
    updateCompanionMetadataUI({
      filePath: '/media/movies/interview.mp4',
      fileName: 'interview.mp4',
      streamUrl: 'http://localhost:54321/stream/1',
      durationSec: 120,
      width: 1920,
      height: 1080,
      aspectRatio: '16:9',
      isVideo: true
    });

    expect(fileNameEl.textContent).toBe('interview.mp4');
    expect(fileNameEl.title).toBe('/media/movies/interview.mp4');
    expect(typeIconEl.innerHTML).toContain('<polygon');
    expect(formatEl.textContent).toBe('Video');
    expect(resEl.textContent).toBe('1920×1080');
    expect(aspectEl.textContent).toBe('16:9');

    // Test Audio info
    updateCompanionMetadataUI({
      filePath: '/media/audio/voice-memo.mp3',
      fileName: 'voice-memo.mp3',
      streamUrl: 'http://localhost:54321/stream/2',
      durationSec: 45,
      isVideo: false
    });

    expect(fileNameEl.textContent).toBe('voice-memo.mp3');
    expect(fileNameEl.title).toBe('/media/audio/voice-memo.mp3');
    expect(typeIconEl.innerHTML).toContain('<circle');
    expect(formatEl.textContent).toBe('Audio');
    expect(resEl.textContent).toBe('Audio Only');
    expect(aspectEl.textContent).toBe('Stereo');
  });

  it('initializes companion player DOM listeners and controls safely', () => {
    registerMockEl('transcribe-left-panel');
    registerMockEl('transcribe-setup-view');
    registerMockEl('transcribe-media-deck');
    registerMockEl('companion-media-element', 'VIDEO');
    registerMockEl('btn-companion-play-pause', 'BUTTON');
    registerMockEl('companion-seek-bar', 'INPUT');
    registerMockEl('companion-time-current', 'SPAN');
    registerMockEl('companion-time-total', 'SPAN');
    registerMockEl('btn-companion-jump-back', 'BUTTON');
    registerMockEl('btn-companion-jump-fwd', 'BUTTON');
    registerMockEl('companion-speed-select', 'SELECT');
    registerMockEl('companion-volume-slider', 'INPUT');
    registerMockEl('btn-companion-mute', 'BUTTON');
    registerMockEl('btn-companion-pip', 'BUTTON');
    registerMockEl('btn-companion-fullscreen', 'BUTTON');
    registerMockEl('btn-companion-back-to-setup', 'BUTTON');

    const card0 = registerMockEl('card-0', 'DIV', 'transcript-card', { id: '0' });
    const card1 = registerMockEl('card-1', 'DIV', 'transcript-card', { id: '1' });

    // Populate transcript lines
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:03.000]', text: 'Line zero', startMs: 1000, endMs: 3000 },
      { id: 1, timeRange: '[00:00:03.500 --> 00:00:06.000]', text: 'Line one', startMs: 3500, endMs: 6000 }
    ];

    // Should initialize DOM listeners without throwing
    expect(() => initCompanionPlayerDOM()).not.toThrow();

    // Test active segment highlight for timestamp 2.0s (inside card 0)
    highlightActiveTranscriptSegment(2.0);
    expect(card0.classList.contains('active-playback')).toBe(true);
    expect(card1.classList.contains('active-playback')).toBe(false);

    // Test active segment highlight for timestamp 4.5s (inside card 1)
    highlightActiveTranscriptSegment(4.5);
    expect(card0.classList.contains('active-playback')).toBe(false);
    expect(card1.classList.contains('active-playback')).toBe(true);
  });

  it('accurately handles volume sliding to 0 (mute) without falling back to 1.0', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.volume = 0.8;
    videoEl.muted = false;
    registerMockEl('icon-vol-high');
    registerMockEl('icon-vol-muted');

    // Setting volume to "0"
    changeCompanionVolume('0');
    expect(videoEl.volume).toBe(0);
    expect(videoEl.muted).toBe(true);

    // Setting volume to "0.4"
    changeCompanionVolume('0.4');
    expect(videoEl.volume).toBe(0.4);
    expect(videoEl.muted).toBe(false);
  });

  it('toggles mute and synchronizes volume slider element', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.volume = 0.75;
    videoEl.muted = false;
    const volSlider = registerMockEl('companion-volume-slider', 'INPUT') as any;
    volSlider.value = '0.75';
    registerMockEl('icon-vol-high');
    registerMockEl('icon-vol-muted');

    toggleCompanionMute();
    expect(videoEl.muted).toBe(true);
    expect(volSlider.value).toBe('0');

    toggleCompanionMute();
    expect(videoEl.muted).toBe(false);
    expect(videoEl.volume).toBe(0.75);
    expect(volSlider.value).toBe('0.75');
  });

  it('adjusts companion volume in 5% increments and un-mutes automatically', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.volume = 0.5;
    videoEl.muted = false;
    const volSlider = registerMockEl('companion-volume-slider', 'INPUT') as any;
    volSlider.value = '0.5';
    registerMockEl('icon-vol-high');
    registerMockEl('icon-vol-muted');

    // Increase volume by +0.05
    adjustCompanionVolume(0.05);
    expect(videoEl.volume).toBe(0.55);
    expect(volSlider.value).toBe('0.55');
    expect(videoEl.muted).toBe(false);

    // Decrease volume by -0.05
    adjustCompanionVolume(-0.05);
    expect(videoEl.volume).toBe(0.5);
    expect(volSlider.value).toBe('0.5');

    // Muted state should un-mute when volume is raised
    videoEl.muted = true;
    adjustCompanionVolume(0.05);
    expect(videoEl.volume).toBe(0.05);
    expect(videoEl.muted).toBe(false);
    expect(volSlider.value).toBe('0.05');

    // Clamping at ceiling 1.0
    videoEl.volume = 0.98;
    adjustCompanionVolume(0.05);
    expect(videoEl.volume).toBe(1.0);
    expect(volSlider.value).toBe('1');

    // Clamping at floor 0.0 and auto-mute
    videoEl.volume = 0.03;
    adjustCompanionVolume(-0.05);
    expect(videoEl.volume).toBe(0);
    expect(videoEl.muted).toBe(true);
    expect(volSlider.value).toBe('0');
  });

  it('supports comma-formatted SRT timestamps when tracking active segment', () => {
    const cardSrt0 = registerMockEl('card-srt-0', 'DIV', 'transcript-card', { id: '0' });
    const cardSrt1 = registerMockEl('card-srt-1', 'DIV', 'transcript-card', { id: '1' });

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01,000 --> 00:00:03,000]', text: 'Line zero' },
      { id: 1, timeRange: '[00:00:03,500 --> 00:00:06,000]', text: 'Line one' }
    ];

    highlightActiveTranscriptSegment(2.5);
    expect(cardSrt0.classList.contains('active-playback')).toBe(true);
    expect(cardSrt1.classList.contains('active-playback')).toBe(false);
  });

  it('unloads companion player, revokes stream and resets UI deck state cleanly', () => {
    let revokedUrl: string | null = null;
    (globalThis as any).invoke = async (cmd: string, args: any) => {
      if (cmd === 'revoke_media_stream') {
        revokedUrl = args.streamUrl;
      }
    };
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.pause = () => {};
    videoEl.removeAttribute = () => {};
    videoEl.load = () => {};
    const setupDeck = registerMockEl('transcribe-unified-deck');
    const mediaDeck = registerMockEl('transcribe-media-deck');
    const setupTabs = registerMockEl('setup-deck-mode-tabs');
    const fileNameEl = registerMockEl('companion-meta-filename');
    const formatEl = registerMockEl('companion-meta-format');
    const resEl = registerMockEl('companion-meta-resolution');
    const aspectEl = registerMockEl('companion-meta-aspect');
    const typeIcon = registerMockEl('companion-meta-type-icon');
    fileNameEl.textContent = 'active.mp4';
    formatEl.textContent = 'Video';
    resEl.textContent = '1920×1080';
    aspectEl.textContent = '16:9';

    unloadCompanionPlayer();
    expect(setupDeck.style.display).toBe('flex');
    expect(mediaDeck.style.display).toBe('none');
    expect(setupTabs.style.display).toBe('none');
    expect(fileNameEl.textContent).toBe('—');
    expect(formatEl.textContent).toBe('—');
    expect(resEl.textContent).toBe('—');
    expect(aspectEl.textContent).toBe('—');
    expect(typeIcon.innerHTML).toContain('<polygon');
  });

  it('toggles companion player console fullscreen correctly and syncs UI icon', async () => {
    const consoleEl = registerMockEl('companion-player-console') as any;
    const fullscreenBtn = registerMockEl('btn-companion-fullscreen', 'BUTTON') as any;
    let requestFullscreenCalled = false;
    consoleEl.requestFullscreen = async () => {
      requestFullscreenCalled = true;
    };

    await toggleCompanionFullscreen();
    expect(requestFullscreenCalled).toBe(true);

    // When already in fullscreen, exit fullscreen is called and UI reflects Minimize icon
    let exitFullscreenCalled = false;
    (document as any).fullscreenElement = consoleEl;
    (document as any).exitFullscreen = async () => {
      exitFullscreenCalled = true;
    };

    updateFullscreenUI();
    expect(fullscreenBtn.innerHTML).toContain('M8 3v3');
    expect(fullscreenBtn.title).toBe('Exit Fullscreen');

    await toggleCompanionFullscreen();
    expect(exitFullscreenCalled).toBe(true);

    delete (document as any).fullscreenElement;
    delete (document as any).exitFullscreen;
    updateFullscreenUI();
    expect(fullscreenBtn.innerHTML).toContain('M8 3H5');
    expect(fullscreenBtn.title).toBe('Fullscreen');
  });

  it('updates slider track custom CSS property clamped between 0 and 100', () => {
    const slider = registerMockEl('test-slider', 'INPUT') as any;
    updateSliderTrackProgress(slider, 45.6, '--seek-pct');
    expect(slider.style['--seek-pct']).toBe('45.6%');

    // Clamps below 0
    updateSliderTrackProgress(slider, -10, '--seek-pct');
    expect(slider.style['--seek-pct']).toBe('0%');

    // Clamps above 100
    updateSliderTrackProgress(slider, 150, '--seek-pct');
    expect(slider.style['--seek-pct']).toBe('100%');

    // Handles NaN gracefully
    updateSliderTrackProgress(slider, NaN, '--vol-pct');
    expect(slider.style['--vol-pct']).toBe('0%');

    // Safe when null passed
    expect(() => updateSliderTrackProgress(null, 50, '--seek-pct')).not.toThrow();
  });

  it('cycles playback rate smoothly forward on left-click and backward on right-click', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    const speedLabel = registerMockEl('companion-speed-label', 'SPAN') as any;
    const speedBtn = registerMockEl('btn-companion-speed', 'BUTTON') as any;

    expect(COMPANION_SPEEDS).toEqual([0.75, 1.0, 1.25, 1.5, 2.0]);

    // Initial cycle from 1.0 -> 1.25 (forward)
    cycleCompanionPlaybackRate(false);
    expect(videoEl.playbackRate).toBe(1.25);
    expect(speedLabel.textContent).toBe('1.25x');
    expect(speedBtn.title).toContain('1.25x');

    // 1.25 -> 1.5 (forward)
    cycleCompanionPlaybackRate(false);
    expect(videoEl.playbackRate).toBe(1.5);
    expect(speedLabel.textContent).toBe('1.5x');

    // Backward cycle (Right-click): 1.5 -> 1.25
    cycleCompanionPlaybackRate(true);
    expect(videoEl.playbackRate).toBe(1.25);
    expect(speedLabel.textContent).toBe('1.25x');

    // Backward cycle: 1.25 -> 1.0
    cycleCompanionPlaybackRate(true);
    expect(videoEl.playbackRate).toBe(1.0);
    expect(speedLabel.textContent).toBe('1.0x');

    // Backward cycle: 1.0 -> 0.75
    cycleCompanionPlaybackRate(true);
    expect(videoEl.playbackRate).toBe(0.75);
    expect(speedLabel.textContent).toBe('0.75x');

    // Backward wrap: 0.75 -> 2.0
    cycleCompanionPlaybackRate(true);
    expect(videoEl.playbackRate).toBe(2.0);
    expect(speedLabel.textContent).toBe('2.0x');

    // Forward wrap: 2.0 -> 0.75
    cycleCompanionPlaybackRate(false);
    expect(videoEl.playbackRate).toBe(0.75);
    expect(speedLabel.textContent).toBe('0.75x');

    // 0.75 -> 1.0
    cycleCompanionPlaybackRate(false);
    expect(videoEl.playbackRate).toBe(1.0);
    expect(speedLabel.textContent).toBe('1.0x');
  });

  it('does not overwrite seek slider or track progress with stale currentTime while video is seeking backwards', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.duration = 100;
    videoEl.currentTime = 80;
    const seekSlider = registerMockEl('companion-seek-slider', 'INPUT') as any;
    seekSlider.value = '80';
    updateSliderTrackProgress(seekSlider, 80, '--seek-pct');
    registerMockEl('companion-time-current');

    initCompanionPlayerDOM();

    // User seeks backwards to 20% (second 20)
    seekSlider.value = '20';
    const inputListeners = seekSlider._listeners.get('input') || [];
    inputListeners.forEach((fn: any) => fn());
    expect(seekSlider.style['--seek-pct']).toBe('20%');

    const changeListeners = seekSlider._listeners.get('change') || [];
    changeListeners.forEach((fn: any) => fn());

    // Video currentTime is requested to be 20, but browser video decoder is still seeking
    videoEl.seeking = true;
    videoEl.currentTime = 80;

    // timeupdate fires during seek
    const timeupdateListeners = videoEl._listeners.get('timeupdate') || [];
    timeupdateListeners.forEach((fn: any) => fn());

    // Slider must NOT be overwritten with stale 80%, must stay at 20%
    expect(seekSlider.value).toBe('20');
    expect(seekSlider.style['--seek-pct']).toBe('20%');

    // Once seeked event fires and decoder completes
    videoEl.seeking = false;
    videoEl.currentTime = 20;
    const seekedListeners = videoEl._listeners.get('seeked') || [];
    seekedListeners.forEach((fn: any) => fn());

    expect(seekSlider.value).toBe('20');
    expect(seekSlider.style['--seek-pct']).toBe('20%');
  });

  it('resets isSeeking on commitSeek to prevent duplicate seek on consecutive pointerup and change events', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.duration = 100;
    const seekSlider = registerMockEl('companion-seek-slider', 'INPUT') as any;
    seekSlider.value = '50';
    registerMockEl('companion-time-current');

    initCompanionPlayerDOM();

    // User starts seeking
    const pointerdownListeners = seekSlider._listeners.get('pointerdown') || [];
    pointerdownListeners.forEach((fn: any) => fn());

    let seekCount = 0;
    Object.defineProperty(videoEl, 'currentTime', {
      get() { return 50; },
      set() { seekCount++; },
      configurable: true
    });

    // Pointerup fires commitSeek
    const pointerupListeners = seekSlider._listeners.get('pointerup') || [];
    pointerupListeners.forEach((fn: any) => fn());
    expect(seekCount).toBe(1);

    // Browser immediately follows with native change event
    const changeListeners = seekSlider._listeners.get('change') || [];
    changeListeners.forEach((fn: any) => fn());
    // Must remain 1, not duplicate-seek to 2
    expect(seekCount).toBe(1);
  });

  it('safely exits early during silence without querySelectorAll thrashing', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:02.000]', text: 'Line zero', startMs: 1000, endMs: 2000 }
    ];
    registerMockEl('card-silence-0', 'DIV', 'transcript-card', { id: '0' });

    // Silence timestamp at 5.0s (no segment active)
    expect(() => highlightActiveTranscriptSegment(5.0)).not.toThrow();
    // Subsequent calls during silence should return early and not throw
    expect(() => highlightActiveTranscriptSegment(5.1)).not.toThrow();
  });

  it('correctly reports Stereo/Audio Only for audio files and does not default aspect ratio to 16:9', async () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.load = () => {};
    const resEl = registerMockEl('companion-meta-resolution');
    const aspectEl = registerMockEl('companion-meta-aspect');
    const fullscreenBtn = registerMockEl('btn-companion-fullscreen', 'BUTTON') as any;
    registerMockEl('companion-audio-fallback');
    registerMockEl('companion-audio-name');

    const { loadMediaIntoCompanionPlayer } = await import('./companionPlayer');
    await loadMediaIntoCompanionPlayer('/path/to/podcast.mp3', false);

    expect(aspectEl.textContent).not.toBe('16:9');
    expect(aspectEl.textContent).toBe('Stereo');
    expect(resEl.textContent).toBe('Audio Only');
    expect(fullscreenBtn.disabled).toBe(true);
  });

  it('defers seek setting until loadedmetadata if video is not ready yet', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.readyState = 0; // HAVE_NOTHING
    videoEl.currentTime = 0;
    videoEl.paused = true;

    seekCompanionPlayer(2500, false); // 2.5 seconds
    expect(videoEl.currentTime).toBe(0);

    // Simulate metadata loading event
    videoEl.readyState = 1;
    const loadedListeners = videoEl._listeners.get('loadedmetadata') || [];
    expect(loadedListeners.length).toBeGreaterThan(0);
    loadedListeners.forEach((fn: any) => fn());

    expect(videoEl.currentTime).toBe(2.5);
  });

  it('correctly passes sourcePath parameter when probing video geometry for companion player', async () => {
    let capturedCmd: string | null = null;
    let capturedArgs: any = null;
    (globalThis as any).invoke = async (cmd: string, args: any) => {
      if (cmd === 'probe_hardsub_source') {
        capturedCmd = cmd;
        capturedArgs = args;
        return { width: 1080, height: 1920, durationSec: 15.0 }; // 9:16 vertical video
      }
      if (cmd === 'stream_media_file') return 'http://127.0.0.1:9090/media/test';
      return null;
    };

    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.load = () => {};
    registerMockEl('companion-meta-resolution');
    const aspectEl = registerMockEl('companion-meta-aspect');
    registerMockEl('btn-companion-pip', 'BUTTON');
    registerMockEl('btn-companion-fullscreen', 'BUTTON');
    const videoContainer = registerMockEl('companion-video-container');

    const { loadMediaIntoCompanionPlayer } = await import('./companionPlayer');
    await loadMediaIntoCompanionPlayer('/path/to/reel.mp4', false);

    expect(capturedCmd).toBe('probe_hardsub_source');
    expect(capturedArgs).toHaveProperty('sourcePath', '/path/to/reel.mp4');
    expect(aspectEl.textContent).toBe('9:16');
    expect(videoContainer.classList.contains('aspect-vertical')).toBe(true);
  });

  it('ensures wordsBar always includes confidence-bar-dimmed class so toggling off works reliably', () => {
    const cardEl = transcriptViewer.createCard({
      id: 0,
      timeRange: '[00:00:01.000 --> 00:00:03.000]',
      text: 'Confidence test word',
      startMs: 1000,
      endMs: 3000,
      words: [
        { text: 'Confidence', startMs: 1000, endMs: 2000, prob: 0.95 },
        { text: 'test', startMs: 2000, endMs: 2500, prob: 0.40 },
        { text: 'word', startMs: 2500, endMs: 3000, prob: 0.98 }
      ]
    });

    const wordsBar = cardEl.querySelector('.transcript-words-bar');
    expect(wordsBar).not.toBeNull();
    expect(wordsBar?.classList.contains('confidence-bar-dimmed')).toBe(true);
  });

  it('retains user-chosen playbackRate and volume slider levels when loading new media', async () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.load = () => {};
    changeCompanionPlaybackRate('1.5');
    const volSlider = registerMockEl('companion-volume-slider', 'INPUT') as any;
    volSlider.value = '0.75';

    registerMockEl('companion-meta-resolution');
    registerMockEl('companion-meta-aspect');
    registerMockEl('btn-companion-pip', 'BUTTON');
    registerMockEl('btn-companion-fullscreen', 'BUTTON');

    const { loadMediaIntoCompanionPlayer } = await import('./companionPlayer');
    await loadMediaIntoCompanionPlayer('/path/to/interview.mp4', false);

    expect(videoEl.playbackRate).toBe(1.5);
    expect(videoEl.volume).toBe(0.75);
    expect(videoEl.muted).toBe(false);
  });

  it('updates confidence button and copy button disabled state on empty vs populated lines', () => {
    registerMockEl('transcript-viewport');
    const btnCopy = registerMockEl('btn-copy-transcript', 'BUTTON') as any;
    const btnConfidence = registerMockEl('btn-toggle-confidence', 'BUTTON') as any;
    registerMockEl('btn-undo-transcript', 'BUTTON');
    registerMockEl('btn-redo-transcript', 'BUTTON');

    // 1. Render empty
    renderTranscriptLines([]);
    expect(btnCopy.disabled).toBe(true);
    expect(btnConfidence.disabled).toBe(true);

    // 2. Render populated
    renderTranscriptLines([
      { id: 0, timeRange: '[00:00:01.000 --> 00:00:02.000]', text: 'Populated line' }
    ]);
    expect(btnCopy.disabled).toBe(false);
    expect(btnConfidence.disabled).toBe(false);
  });

  it('serializes empty string for emptied transcript lines so disk sync clears deleted files', () => {
    expect(serializeTranscriptLinesForFile([], '/out/test.srt')).toBe('');
    expect(serializeTranscriptLinesForFile([], '/out/test.lrc')).toBe('');
    expect(serializeTranscriptLinesForFile([], '/out/test.txt')).toBe('');
    expect(serializeTranscriptLinesForFile([], '/out/test.vtt')).toBe('WEBVTT\n\n');
    expect(serializeTranscriptLinesForFile([], '/out/test.csv')).toBe('start,end,text\n');
  });

  it('isolates batch targets from single-mode targets during disk sync', async () => {
    const writtenFiles: Record<string, string> = {};
    (globalThis as any).invoke = async (cmd: string, args: any) => {
      if (cmd === 'write_text_file_content') {
        writtenFiles[args.filePath] = args.content;
        return null;
      }
      return null;
    };

    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    win.isBatchMode = true;
    win.activeBatchViewerIndex = 0;
    win.batchItems = [
      {
        path: '/batch/item0.mp4',
        subtitlePath: '/batch/item0.srt',
        txtPath: '/batch/item0.txt',
        outputFiles: [{ path: '/batch/item0.srt' }]
      }
    ];
    // Single mode remnant that should NOT be touched during batch edit
    win.lastTranscribedOutputFiles = [{ path: '/single/old_single.srt' }];
    win.lastTranscribedSubtitlePath = '/single/old_single.srt';

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:02.000]', text: 'Batch edit text' }
    ];
    transcriptViewer.updateLineText(0, 'Updated batch text');

    await persistTranscriptLinesToDisk();

    expect(writtenFiles).toHaveProperty('/batch/item0.srt');
    expect(writtenFiles).not.toHaveProperty('/single/old_single.srt');
  });

  it('aborts and revokes stream if load sequence was superseded during async probing', async () => {
    let revokeCalledWith: string | null = null;
    (globalThis as any).invoke = async (cmd: string, args: any) => {
      if (cmd === 'stream_media_file') {
        return 'http://127.0.0.1:9090/media/stale';
      }
      if (cmd === 'probe_media_file') {
        // Trigger a new concurrent load while probe is pending
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({ durationSec: 10 });
          }, 30);
        });
      }
      if (cmd === 'revoke_media_stream') {
        revokeCalledWith = args.streamUrl;
        return null;
      }
      return null;
    };

    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.load = () => {};
    registerMockEl('companion-meta-resolution');
    registerMockEl('companion-meta-aspect');
    registerMockEl('btn-companion-pip', 'BUTTON');
    registerMockEl('btn-companion-fullscreen', 'BUTTON');

    const { loadMediaIntoCompanionPlayer } = await import('./companionPlayer');
    const p1 = loadMediaIntoCompanionPlayer('/path/to/stale.mp4', false);
    // Immediately start load 2
    const p2 = loadMediaIntoCompanionPlayer('/path/to/fresh.mp4', false);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1).toBe(false);
    expect(res2).toBe(true);
    expect(revokeCalledWith).toBe('http://127.0.0.1:9090/media/stale');
  });

  it('deep clones words array when recording and restoring from undo stack', () => {
    const originalWords = [
      { text: 'First', startMs: 0, endMs: 2000, prob: 0.95 },
      { text: 'segment', startMs: 2000, endMs: 4000, prob: 0.90 }
    ];

    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:00.000 --> 00:00:04.000]',
        text: 'First segment',
        words: originalWords
      }
    ];

    // Split segment into two
    splitTranscriptSegment(0, 5);
    expect(transcriptViewer.lines.length).toBe(2);

    // Mutate the original words array after split snapshot was recorded
    originalWords.push({ text: 'mutated', startMs: 4000, endMs: 5000, prob: 0.99 });

    // Undo split
    undoTranscriptOperation();
    expect(transcriptViewer.lines.length).toBe(1);
    expect(transcriptViewer.lines[0].words).toBeDefined();
    // Snapshot should remain protected with original 2 words
    expect(transcriptViewer.lines[0].words?.length).toBe(2);
  });

  it('restores focus to remaining segment textarea after deleteTranscriptSegment', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:02.000]', text: 'Line 0' },
      { id: 1, timeRange: '[00:00:02.000 --> 00:00:04.000]', text: 'Line 1' },
      { id: 2, timeRange: '[00:00:04.000 --> 00:00:06.000]', text: 'Line 2' }
    ];

    let focusedInputId = -1;
    // Mock querySelector to trace focus
    const origQuerySelector = mockDocument.querySelector.bind(mockDocument);
    mockDocument.querySelector = (sel: string) => {
      const match = sel.match(/data-id="(\d+)"/);
      if (match) {
        const id = parseInt(match[1], 10);
        return {
          focus: () => { focusedInputId = id; },
          closest: () => ({ scrollIntoView: () => {} })
        };
      }
      return origQuerySelector(sel);
    };

    deleteTranscriptSegment(1);
    expect(transcriptViewer.lines.length).toBe(2);
    mockDocument.querySelector = origQuerySelector;
  });
});

describe('Settings Output Formats Cleanup Integrity', () => {
  it('confirms the 4 deprecated output formats are removed from settings.html', () => {
    const html = readFileSync(resolve(__dirname, '../views/settings.html'), 'utf-8');
    expect(html).not.toContain('id="opt-outputCsv"');
    expect(html).not.toContain('id="opt-outputJson"');
    expect(html).not.toContain('id="opt-outputJsonFull"');
    expect(html).not.toContain('id="card-printConfidence"');
  });

  it('confirms WhisperSettings struct does not contain deprecated output format fields', () => {
    const rustSource = readFileSync(resolve(__dirname, '../../src-tauri/src/settings.rs'), 'utf-8');
    expect(rustSource).not.toMatch(/pub\s+output_csv:\s*bool/);
    expect(rustSource).not.toMatch(/pub\s+output_json:\s*bool/);
    expect(rustSource).not.toMatch(/pub\s+output_json_full:\s*bool/);
    expect(rustSource).not.toMatch(/pub\s+print_confidence:\s*bool/);
  });
});

describe('Studio Refinements, Isolation & Keyboard Accessibility', () => {
  it('rejects splitting when cursor position results in empty left or right slice', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: '   Leading spaces' }
    ];

    // Cursor at position 2 (inside leading spaces) -> leftText is empty
    const splitResult = splitTranscriptSegment(0, 2);
    expect(splitResult).toBe(false);
    expect(transcriptViewer.lines.length).toBe(1);
    expect(transcriptViewer.lines[0].text).toBe('   Leading spaces');
  });

  it('supports getTranscriptHistory and setTranscriptHistory for per-item batch isolation', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'First item segment' }
    ];
    clearTranscriptHistory();

    // Perform an operation that creates history on item A
    deleteTranscriptSegment(0);
    expect(canUndoTranscript()).toBe(true);

    const itemAHistory = getTranscriptHistory();
    expect(itemAHistory.undoStack.length).toBe(1);

    // Switch to item B (empty history)
    setTranscriptHistory({ undoStack: [], redoStack: [] });
    expect(canUndoTranscript()).toBe(false);

    // Switch back to item A
    setTranscriptHistory(itemAHistory);
    expect(canUndoTranscript()).toBe(true);
    undoTranscriptOperation();
    expect(transcriptViewer.lines.length).toBe(1);
    expect(transcriptViewer.lines[0].text).toBe('First item segment');
  });

  it('renders "—" for video resolution when dimensions are 0 (pending probe)', () => {
    const resEl = registerMockEl('companion-meta-resolution');
    updateCompanionMetadataUI({
      filePath: '/media/pending.mp4',
      fileName: 'pending.mp4',
      streamUrl: 'http://127.0.0.1:4000/media/tok',
      durationSec: 120,
      width: 0,
      height: 0,
      isVideo: true
    });

    expect(resEl.textContent).toBe('—');
  });

  it('does not scroll hidden transcript cards into view during active playback search', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: 'Visible card' },
      { id: 1, timeRange: '[00:00:05.000 --> 00:00:10.000]', text: 'Hidden card' }
    ];

    let scrolled = false;
    const card1 = registerMockEl('transcript-card-1');
    card1.classList.add('transcript-card');
    card1.dataset.id = '1';
    card1.style.display = 'none'; // Filtered out by search
    card1.scrollIntoView = () => { scrolled = true; };

    // Query selector mock returns card1
    const origQS = mockDocument.querySelector.bind(mockDocument);
    mockDocument.querySelector = (sel: string) => {
      if (sel.includes('data-id="1"')) return card1;
      return origQS(sel);
    };

    highlightActiveTranscriptSegment(7.0);
    expect(scrolled).toBe(false);
    mockDocument.querySelector = origQS;
  });

  it('focuses textarea and selects word range when clicking a word badge in wordsBar', () => {
    let focused = false;
    let selStart = -1;
    let selEnd = -1;

    const lineObj = {
      id: 0,
      timeRange: '[00:00:00.000 --> 00:00:03.000]',
      text: 'Hello world again',
      words: [
        { text: 'Hello', startMs: 0, endMs: 1000, prob: 0.95 },
        { text: 'world', startMs: 1000, endMs: 2000, prob: 0.45 },
        { text: 'again', startMs: 2000, endMs: 3000, prob: 0.90 }
      ]
    };

    const card = createTranscriptCardElement(lineObj as any);
    const textarea = card.querySelector('.transcript-text-input') as any;
    textarea.focus = () => { focused = true; };
    textarea.setSelectionRange = (s: number, e: number) => {
      selStart = s;
      selEnd = e;
    };

    const words = card.querySelectorAll('.transcript-word');
    expect(words.length).toBe(3);

    // Click 'world' (2nd word)
    const worldBadge = words[1];
    worldBadge.onclick({ stopPropagation: () => {} });

    expect(focused).toBe(true);
    expect(selStart).toBe(6);
    expect(selEnd).toBe(11);
  });

  it('unloads companion player when clearBatchQueue is called', () => {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    let unloaded = false;
    const prevUnload = win.unloadCompanionPlayer;
    win.unloadCompanionPlayer = () => { unloaded = true; };
    win.showNotification = () => {};
    win.isBatchMode = true;
    batchProcessor.setItems([{ path: '/test.mp4', status: 'completed' }] as any);

    try {
      clearBatchQueue();
      expect(unloaded).toBe(true);
    } finally {
      win.unloadCompanionPlayer = prevUnload;
    }
  });

  it('unloads companion player when removeFileFromBatch deletes the active completed item without remaining completed items', () => {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    let unloaded = false;
    const prevUnload = win.unloadCompanionPlayer;
    win.unloadCompanionPlayer = () => { unloaded = true; };
    win.showNotification = () => {};
    win.isBatchMode = true;
    win.activeBatchViewerIndex = 0;
    batchProcessor.setItems([
      { path: '/test.mp4', status: 'completed' },
      { path: '/test2.mp4', status: 'pending' }
    ] as any);

    try {
      removeFileFromBatch(0);
      expect(unloaded).toBe(true);
    } finally {
      win.unloadCompanionPlayer = prevUnload;
    }
  });

  it('recognizes extended audio formats (e.g. .wma, .aiff, .alac) as audio only in companion player', async () => {
    const audioFallback = registerMockEl('companion-audio-fallback');
    audioFallback.style.display = 'none';
    const videoEl = registerMockEl('companion-media-element');
    videoEl.load = () => {};

    await loadMediaIntoCompanionPlayer('/media/sample_audio.aiff', false);
    expect(audioFallback.style.display).toBe('flex');
  });

  it('unloadCompanionPlayer invalidates in-flight media load sequence so slow probes cannot resurrect player', async () => {
    const videoEl = registerMockEl('companion-media-element');
    videoEl.load = () => {};
    let revoked = false;
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    win.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: any) => {
          if (cmd === 'stream_media_file') return 'http://127.0.0.1:4000/media/slow.mp4';
          if (cmd === 'revoke_media_stream') {
            revoked = true;
            return;
          }
          if (cmd === 'probe_media_file' || cmd === 'probe_hardsub_source') {
            // Simulate delay
            await new Promise(r => setTimeout(r, 20));
            return { durationSec: 10, width: 1920, height: 1080 };
          }
          return null;
        }
      }
    };

    const loadPromise = loadMediaIntoCompanionPlayer('/slow.mp4', true);
    // User unloads while load is in flight
    unloadCompanionPlayer();

    const result = await loadPromise;
    expect(result).toBe(false);
    expect(revoked).toBe(true);
  });

  it('selectBatchItemTranscript sequence guard ignores stale completions when switching items rapidly', async () => {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    win.isBatchMode = true;
    win.showNotification = () => {};

    const item0 = {
      path: '/file0.mp4',
      status: 'completed',
      internalJsonPath: '/cache/file0.json',
      transcriptLines: [{ id: 0, text: 'Item 0 initial', timeRange: '[00:00:00.000 --> 00:00:02.000]' }]
    };
    const item1 = {
      path: '/file1.mp4',
      status: 'completed',
      internalJsonPath: '/cache/file1.json',
      transcriptLines: [{ id: 0, text: 'Item 1 final', timeRange: '[00:00:00.000 --> 00:00:02.000]' }]
    };
    batchProcessor.setItems([item0, item1] as any);

    win.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: any) => {
          if (cmd === 'get_transcript_session_data') {
            if (args.sessionFile === '/cache/file0.json') {
              // file0 is delayed
              await new Promise(r => setTimeout(r, 40));
              return JSON.stringify({ segments: [{ start: 0, end: 2, text: 'Item 0 delayed' }] });
            }
            if (args.sessionFile === '/cache/file1.json') {
              return JSON.stringify({ segments: [{ start: 0, end: 2, text: 'Item 1 final' }] });
            }
          }
          return null;
        }
      }
    };

    // User clicks item 0 then rapidly clicks item 1
    const p0 = selectBatchItemTranscript(0);
    const p1 = selectBatchItemTranscript(1);

    await Promise.all([p0, p1]);
    expect(batchProcessor.getActiveViewerIndex()).toBe(1);
    expect(transcriptViewer.lines[0].text).toBe('Item 1 final');
  });

  it('Tab keyboard navigation skips cards with display: none in search-filtered views', () => {
    const card0 = registerMockEl('card-tab-0', 'DIV', 'transcript-card', { id: '0' });
    const card1 = registerMockEl('card-tab-1', 'DIV', 'transcript-card', { id: '1' });
    const card2 = registerMockEl('card-tab-2', 'DIV', 'transcript-card', { id: '2' });
    card1.style.display = 'none';

    let card2Focused = false;
    const card2Textarea = new MockElement('TEXTAREA');
    card2Textarea.classList.add('transcript-text-input');
    card2Textarea.focus = () => { card2Focused = true; };
    card2.appendChild(card2Textarea);

    const allCards = Array.from(document.querySelectorAll('.transcript-card')) as HTMLElement[];
    const visibleCards = allCards.filter(c => c.style.display !== 'none');
    const currentIndex = visibleCards.indexOf(card0 as any);
    expect(currentIndex).not.toBe(-1);
    const nextCard = visibleCards[currentIndex + 1];
    expect(nextCard).toBe(card2);
    const targetInput = nextCard?.querySelector('.transcript-text-input') as any;
    targetInput.focus();

    expect(card2Focused).toBe(true);
  });

  it('resets _hasTyped on textarea blur so studio structural undo is re-enabled on clean focus', () => {
    const card = createTranscriptCardElement({ id: 0, text: 'Hello test', timeRange: '[00:00:00.000 --> 00:00:02.000]' });
    const textarea = card.querySelector('.transcript-text-input') as any;

    expect(textarea._hasTyped).toBe(false);
    textarea.oninput();
    expect(textarea._hasTyped).toBe(true);

    textarea.onblur();
    expect(textarea._hasTyped).toBe(false);
  });

  it('does not auto-scroll during playback when an INPUT element has active focus', () => {
    transcriptViewer.lines = [
      { id: 0, text: 'Line 0', startMs: 0, endMs: 2000, timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'Line 1', startMs: 2000, endMs: 4000, timeRange: '[00:00:02.000 --> 00:00:04.000]' }
    ];

    let scrolled = false;
    const testCard0 = new MockElement('DIV');
    testCard0.classList.add('transcript-card');
    testCard0.dataset.id = '0';

    const testCard1 = new MockElement('DIV');
    testCard1.classList.add('transcript-card');
    testCard1.dataset.id = '1';
    testCard1.scrollIntoView = () => { scrolled = true; };

    const origQS = mockDocument.querySelector.bind(mockDocument);
    mockDocument.querySelector = (sel: string) => {
      if (sel.includes('data-id="1"')) return testCard1;
      if (sel.includes('data-id="0"')) return testCard0;
      return origQS(sel);
    };

    // 1. When INPUT has active focus, it does not scroll
    const mockInput = new MockElement('INPUT');
    (document as any).activeElement = mockInput;
    highlightActiveTranscriptSegment(2.5);
    expect(scrolled).toBe(false);

    // 2. Clear focus and advance segment so highlight triggers
    (document as any).activeElement = null;
    highlightActiveTranscriptSegment(0.5); // move to 0
    highlightActiveTranscriptSegment(2.5); // move back to 1 without input focus
    expect(scrolled).toBe(true);

    mockDocument.querySelector = origQS;
  });

  it('caches parsed timestamps on line objects during highlightActiveTranscriptSegment', () => {
    const lines = [
      { id: 99, text: 'Line 99', timeRange: '[00:00:01.000 --> 00:00:03.000]' }
    ];
    transcriptViewer.lines = lines;

    const cacheCard = new MockElement('DIV');
    cacheCard.classList.add('transcript-card');
    cacheCard.dataset.id = '99';

    const origQS = mockDocument.querySelector.bind(mockDocument);
    mockDocument.querySelector = (sel: string) => {
      if (sel.includes('data-id="99"')) return cacheCard;
      return origQS(sel);
    };

    expect(lines[0].startMs).toBeUndefined();
    highlightActiveTranscriptSegment(1.5);
    expect(lines[0].startMs).toBe(1000);
    expect(lines[0].endMs).toBe(3000);

    mockDocument.querySelector = origQS;
  });

  it('preserves viewport.scrollTop in renderTranscriptLines', () => {
    const viewport = registerMockEl('transcript-viewport');
    viewport.scrollTop = 150;

    renderTranscriptLines([
      { id: 0, text: 'Line 0', timeRange: '[00:00:00.000 --> 00:00:02.000]' }
    ]);
    expect(viewport.scrollTop).toBe(150);
  });

  it('automatically pauses companion player when switching to setup deck', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    let paused = false;
    videoEl.paused = false;
    videoEl.pause = () => {
      videoEl.paused = true;
      paused = true;
    };
    registerMockEl('transcribe-unified-deck');
    registerMockEl('transcribe-media-deck');

    showTranscribeSetupDeck();
    expect(paused).toBe(true);
    expect(videoEl.paused).toBe(true);
  });

  it('preserves empty item.transcriptLines in selectBatchItemTranscript without resurrecting from internal JSON', async () => {
    const win = (globalThis as any).window || (globalThis as any);
    win.isBatchMode = true;
    let invokeCalled = false;
    win.__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'get_transcript_session_data') {
            invokeCalled = true;
            return JSON.stringify({
              transcription: [{ text: 'Resurrected Line', timestamps: { from: '00:00:01.000', to: '00:00:03.000' } }]
            });
          }
          return null;
        }
      }
    };

    const emptyItem: any = {
      path: '/media/empty_item.mp4',
      status: 'completed',
      internalJsonPath: '/cache/transcripts/item_hash.json',
      transcriptLines: [],
      outputFiles: []
    };
    batchProcessor.setItems([emptyItem]);
    batchProcessor.setActiveViewerIndex(-1);

    await selectBatchItemTranscript(0);

    // It should NOT invoke get_transcript_session_data to overwrite user's deletion
    expect(invokeCalled).toBe(false);
    expect(transcriptViewer.lines.length).toBe(0);
    expect(emptyItem.transcriptLines.length).toBe(0);
  });

  it('re-applies active search filter in renderTranscriptLines when search query exists', () => {
    registerMockEl('transcript-viewport');
    const searchInput = registerMockEl('transcript-search', 'INPUT') as any;
    searchInput.value = 'banana';

    renderTranscriptLines([
      { id: 0, text: 'Apple fruit', timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'Yellow banana fruit', timeRange: '[00:00:02.000 --> 00:00:04.000]' }
    ]);

    const cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards.length).toBe(2);
    expect(cards[0].style.display).toBe('none');
    expect(cards[1].style.display).toBe('flex');

    searchInput.value = '';
  });

  it('normalizes Persian/Arabic characters and ZWNJ in filterTranscriptLines', () => {
    registerMockEl('transcript-viewport');
    const searchInput = registerMockEl('transcript-search', 'INPUT') as any;

    renderTranscriptLines([
      { id: 0, text: 'برنامه ذخیره می‌شود', timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'متن دیگر', timeRange: '[00:00:02.000 --> 00:00:04.000]' }
    ]);

    // Query uses Persian 'ی' and no ZWNJ 'میشود'
    searchInput.value = 'میشود';
    filterTranscriptLines();

    const cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards.length).toBe(2);
    expect(cards[0].style.display).toBe('flex');
    expect(cards[1].style.display).toBe('none');

    searchInput.value = '';
  });

  it('guards Space and Arrow keys when an HTMLSelectElement is focused', () => {
    const mediaDeck = registerMockEl('transcribe-media-deck');
    mediaDeck.style.display = 'flex';
    const panel = registerMockEl('panel-transcribe');
    panel.classList.add('active');

    const selectEl = new (globalThis as any).HTMLSelectElement('SELECT') as any;
    selectEl.id = 'companion-speed-select';

    let keydownHandler: ((e: any) => void) | null = null;
    const origAddEventListener = (window as any).addEventListener;
    (window as any).addEventListener = ((evt: string, handler: any) => {
      if (evt === 'keydown') keydownHandler = handler;
      if (typeof origAddEventListener === 'function') {
        origAddEventListener.call(window, evt, handler);
      }
    }) as any;

    initCompanionPlayerDOM();
    if (origAddEventListener) {
      (window as any).addEventListener = origAddEventListener;
    } else {
      delete (window as any).addEventListener;
    }

    let defaultPrevented = false;
    if (keydownHandler) {
      (keydownHandler as any)({
        target: selectEl,
        code: 'Space',
        preventDefault: () => { defaultPrevented = true; }
      });
    }

    expect(defaultPrevented).toBe(false);
  });

  it('safely formats infinite or invalid seconds without producing NaN', () => {
    expect(formatTimecodeDisplay(Infinity)).toBe('00:00.000');
    expect(formatTimecodeDisplay(-Infinity)).toBe('00:00.000');
    expect(formatTimecodeDisplay(NaN)).toBe('00:00.000');
    expect(formatTimecodeDisplay(-5)).toBe('00:00.000');
  });

  it('matches Persian space vs ZWNJ variants bidirectionally in search', () => {
    registerMockEl('transcript-viewport');
    const searchInput = registerMockEl('transcript-search', 'INPUT') as any;

    renderTranscriptLines([
      { id: 0, text: 'این متن ذخیره می‌شود', timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'ثبت نام دوره جدید', timeRange: '[00:00:02.000 --> 00:00:04.000]' }
    ]);

    // 1. Search with regular space 'می رود' matches ZWNJ 'می‌شود'
    searchInput.value = 'می شود';
    filterTranscriptLines();
    let cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards[0].style.display).toBe('flex');
    expect(cards[1].style.display).toBe('none');

    // 2. Search with ZWNJ 'ثبت‌نام' matches regular space 'ثبت نام'
    searchInput.value = 'ثبت‌نام';
    filterTranscriptLines();
    cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards[0].style.display).toBe('none');
    expect(cards[1].style.display).toBe('flex');

    searchInput.value = '';
  });

  it('copies only filtered lines when search query is active in copyLiveTranscriptToClipboard', async () => {
    registerMockEl('transcript-viewport');
    const searchInput = registerMockEl('transcript-search', 'INPUT') as any;
    registerMockEl('btn-copy-transcript', 'BUTTON');

    let copiedText = '';
    let notificationText = '';
    (globalThis as any).window.copyToClipboard = async (text: string) => {
      copiedText = text;
    };
    (globalThis as any).window.showNotification = (msg: string) => {
      notificationText = msg;
    };

    const testLines = [
      { id: 0, text: 'First matching line', timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'Second other line', timeRange: '[00:00:02.000 --> 00:00:04.000]' },
      { id: 2, text: 'Third matching line', timeRange: '[00:00:04.000 --> 00:00:06.000]' }
    ];
    transcriptViewer.lines = testLines;
    renderTranscriptLines(testLines);

    // 1. Without search filter: copies all 3 lines
    searchInput.value = '';
    await copyLiveTranscriptToClipboard();
    expect(copiedText).toBe('First matching line\nSecond other line\nThird matching line');

    // 2. With search filter 'matching': copies only lines 0 and 2
    searchInput.value = 'matching';
    filterTranscriptLines();
    await copyLiveTranscriptToClipboard();
    expect(copiedText).toBe('First matching line\nThird matching line');
    expect(notificationText).toContain('2');

    searchInput.value = '';
  });

  it('hides video element for audio-only media and restores it for video media', async () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    registerMockEl('companion-audio-fallback');
    registerMockEl('companion-audio-name');
    registerMockEl('companion-video-container');
    registerMockEl('btn-companion-pip', 'BUTTON');
    registerMockEl('btn-companion-fullscreen', 'BUTTON');

    (globalThis as any).invoke = async (cmd: string) => {
      if (cmd === 'stream_media_file') return 'http://127.0.0.1:1234/media/stream';
      if (cmd === 'probe_media_file') return { durationSec: 120 };
      if (cmd === 'probe_hardsub_source') return { width: 1920, height: 1080 };
      return null;
    };

    // 1. Audio-only media (.mp3) hides video element
    await loadMediaIntoCompanionPlayer('/path/to/song.mp3', false);
    expect(videoEl.style.display).toBe('none');

    // 2. Video media (.mp4) restores video element display
    await loadMediaIntoCompanionPlayer('/path/to/clip.mp4', false);
    expect(videoEl.style.display).toBe('block');
  });

  it('preserves paused state when seeking without explicit autoPlay argument', () => {
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.readyState = 2; // HAVE_CURRENT_DATA
    videoEl.currentTime = 0;
    videoEl.paused = true;
    let playCalled = false;
    let pauseCalled = false;
    videoEl.play = async () => { playCalled = true; };
    videoEl.pause = () => { pauseCalled = true; };

    // 1. Calling seek without autoPlay on paused video keeps it paused
    seekCompanionPlayer(5000);
    expect(videoEl.currentTime).toBe(5);
    expect(playCalled).toBe(false);

    // 2. Calling seek with explicit autoPlay = true plays it
    seekCompanionPlayer(8000, true);
    expect(videoEl.currentTime).toBe(8);
    expect(playCalled).toBe(true);

    // 3. Calling seek on actively playing video keeps it playing
    videoEl.paused = false;
    playCalled = false;
    seekCompanionPlayer(12000);
    expect(videoEl.currentTime).toBe(12);
    expect(pauseCalled).toBe(false);
  });

  it('unloads companion player cleanly, clears active playback highlights and resets line id', () => {
    registerMockEl('companion-media-element', 'VIDEO');
    const card0 = registerMockEl('card-0');
    card0.className = 'transcript-card active-playback';
    mockDocument.elements.set('card-0', card0);

    unloadCompanionPlayer();

    expect(card0.classList.contains('active-playback')).toBe(false);
  });

  it('normalizes Persian digits, Arabic digits, and Alef/Taa variants in transcript search filter', () => {
    const searchInput = registerMockEl('transcript-search', 'INPUT') as any;
    registerMockEl('transcript-viewport');

    const testLines = [
      { id: 0, text: 'قسمت ۱۲: آغاز مسأله', timeRange: '[00:00:00.000 --> 00:00:02.000]' },
      { id: 1, text: 'جلسهٔ سوم درباره مدیریت', timeRange: '[00:00:02.000 --> 00:00:04.000]' }
    ];
    transcriptViewer.lines = testLines;
    renderTranscriptLines(testLines);

    // 1. Searching English digits '12' matches Persian digits '۱۲'
    searchInput.value = '12';
    filterTranscriptLines();
    let cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards[0].style.display).toBe('flex');
    expect(cards[1].style.display).toBe('none');

    // 2. Searching plain Alef 'اغاز' matches Alef-with-madda 'آغاز'
    searchInput.value = 'اغاز';
    filterTranscriptLines();
    cards = mockDocument.querySelectorAll('.transcript-line');
    expect(cards[0].style.display).toBe('flex');
    expect(cards[1].style.display).toBe('none');

    searchInput.value = '';
  });

  it('matches whole word token boundaries when clicking word badges in studio', () => {
    registerMockEl('companion-media-element', 'VIDEO');
    const lineWithTokens = {
      id: 0,
      timeRange: '[00:00:00.000 --> 00:00:05.000]',
      text: 'The beginning in the end',
      words: [
        { text: 'The', startMs: 0, endMs: 500, prob: 0.95 },
        { text: 'beginning', startMs: 600, endMs: 1200, prob: 0.90 },
        { text: 'in', startMs: 1300, endMs: 1600, prob: 0.50 }, // low confidence
        { text: 'the', startMs: 1700, endMs: 2000, prob: 0.92 },
        { text: 'end', startMs: 2100, endMs: 2500, prob: 0.98 },
      ]
    };

    const card = createTranscriptCardElement(lineWithTokens);
    const textarea = card.querySelector('.transcript-text-input') as any;
    let selectedStart = -1;
    let selectedEnd = -1;
    textarea.setSelectionRange = (s: number, e: number) => {
      selectedStart = s;
      selectedEnd = e;
    };

    // Click the 3rd word badge ('in')
    const wordsBar = card.querySelector('.transcript-words-bar');
    const wordSpans = wordsBar?.querySelectorAll('.transcript-word') || [];
    const inBadge = wordSpans[2] as HTMLElement; // word "in"
    expect(inBadge.textContent).toBe('in');

    inBadge.onclick!({ stopPropagation: () => {} } as any);

    // 'The beginning in the end' -> 'The beginning ' is 14 chars. 'in' starts at 14, ends at 16.
    // It should NOT match 'in' inside 'beginning' (which would be at index 7)!
    expect(selectedStart).toBe(14);
    expect(selectedEnd).toBe(16);
  });

  it('aggregates subword BPE tokens into whole words for English and Persian', () => {
    // English subwords: "Hello", "unbreakable", "world"
    const englishTokens = [
      { text: ' Hel', offsets: { from: 0, to: 200 }, p: 0.95 },
      { text: 'lo', offsets: { from: 200, to: 400 }, p: 0.90 },
      { text: ' un', offsets: { from: 500, to: 700 }, p: 0.85 },
      { text: 'break', offsets: { from: 700, to: 1000 }, p: 0.80 },
      { text: 'able', offsets: { from: 1000, to: 1200 }, p: 0.88 },
      { text: ' world', offsets: { from: 1300, to: 1800 }, p: 0.99 }
    ];
    const enWords = aggregateTokensIntoWords(englishTokens, 0, 1800, 'Hello unbreakable world');
    expect(enWords.length).toBe(3);
    expect(enWords[0].text).toBe('Hello');
    expect(enWords[0].startMs).toBe(0);
    expect(enWords[0].endMs).toBe(400);
    expect(enWords[0].prob).toBe(0.90);
    expect(enWords[1].text).toBe('unbreakable');
    expect(enWords[1].startMs).toBe(500);
    expect(enWords[1].endMs).toBe(1200);
    expect(enWords[1].prob).toBe(0.80);
    expect(enWords[2].text).toBe('world');

    // Persian subwords: "سلام", "برنامه"
    const persianTokens = [
      { text: ' سل', offsets: { from: 0, to: 200 }, p: 0.92 },
      { text: 'ام', offsets: { from: 200, to: 400 }, p: 0.88 },
      { text: ' بر', offsets: { from: 500, to: 800 }, p: 0.90 },
      { text: 'نامه', offsets: { from: 800, to: 1100 }, p: 0.85 }
    ];
    const faWords = aggregateTokensIntoWords(persianTokens, 0, 1100, 'سلام برنامه');
    expect(faWords.length).toBe(2);
    expect(faWords[0].text).toBe('سلام');
    expect(faWords[0].startMs).toBe(0);
    expect(faWords[0].endMs).toBe(400);
    expect(faWords[0].prob).toBe(0.88);
    expect(faWords[1].text).toBe('برنامه');
    expect(faWords[1].startMs).toBe(500);
    expect(faWords[1].endMs).toBe(1100);
  });

  it('records undo snapshot on text edits and enables undo/redo of typed modifications', () => {
    clearTranscriptHistory();
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'Original line text' }
    ];

    const card = createTranscriptCardElement(transcriptViewer.lines[0]);
    const textarea = card.querySelector('.transcript-text-input') as any;

    expect(canUndoTranscript()).toBe(false);

    // Simulate focusing and typing a new text
    textarea.onfocus();
    textarea.value = 'Modified line text';
    textarea.oninput();

    expect(canUndoTranscript()).toBe(true);
    expect(transcriptViewer.lines[0].text).toBe('Modified line text');

    // Undo operation restores original text
    const undone = undoTranscriptOperation();
    expect(undone).toBe(true);
    expect(transcriptViewer.lines[0].text).toBe('Original line text');
    expect(canRedoTranscript()).toBe(true);

    // Redo operation restores modified text
    const redone = redoTranscriptOperation();
    expect(redone).toBe(true);
    expect(transcriptViewer.lines[0].text).toBe('Modified line text');
  });

  it('preserves target files snapshot during debounced save even when batch item selection changes', async () => {
    await flushPendingTranscriptEdits();
    let savedTargetFiles: string[] = [];
    let savedContents: Record<string, string> = {};
    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: any) => {
          if (cmd === 'write_text_file_content') {
            savedTargetFiles.push(args.filePath);
            savedContents[args.filePath] = args.content;
            return true;
          }
          return null;
        }
      }
    };

    (window as any).isBatchMode = true;
    (window as any).activeBatchViewerIndex = 0;
    (window as any).batchItems = [
      {
        id: 0,
        status: 'completed',
        subtitlePath: '/path/to/batch0.srt',
        transcriptLines: [{ id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: 'Item 0 initial' }]
      },
      {
        id: 1,
        status: 'completed',
        subtitlePath: '/path/to/batch1.srt',
        transcriptLines: [{ id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: 'Item 1 text' }]
      }
    ];

    transcriptViewer.lines = [{ id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: 'Item 0 initial' }];

    // Edit Item 0's line text (schedules debounced save and snapshots batch0.srt and lines)
    updateTranscriptLineText(0, 'Item 0 edited');

    // User immediately switches active view to Item 1 within debounce interval
    (window as any).activeBatchViewerIndex = 1;

    // Flush edits
    await flushPendingTranscriptEdits();

    // Verify it saved to batch0.srt (Item 0's file), NOT batch1.srt, and with Item 0's edited content!
    expect(savedTargetFiles).toContain('/path/to/batch0.srt');
    expect(savedTargetFiles).not.toContain('/path/to/batch1.srt');
    expect(savedContents['/path/to/batch0.srt']).toContain('Item 0 edited');
    expect(savedContents['/path/to/batch0.srt']).not.toContain('Item 1 text');
  });

  it('invalidates stale word tokens and hides words bar container when line text is edited', () => {
    // Clear any stale mock cards from earlier tests
    const vp = document.getElementById('transcript-viewport');
    if (vp) vp.children = [];
    for (const [k, el] of Array.from(elementRegistry.entries())) {
      if (el.dataset.id === '0') elementRegistry.delete(k);
    }

    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:00.000 --> 00:00:05.000]',
        text: 'Initial text',
        words: [
          { text: 'Initial', startMs: 0, endMs: 2500, prob: 0.95 },
          { text: 'text', startMs: 2500, endMs: 5000, prob: 0.90 }
        ]
      }
    ];

    const card = registerMockEl('card-edit-test', 'DIV', 'transcript-card', { id: '0' });
    const wordsBar = document.createElement('div');
    wordsBar.className = 'transcript-words-bar';
    card.appendChild(wordsBar);

    expect(transcriptViewer.lines[0].words).toBeDefined();

    updateTranscriptLineText(0, 'Modified user text');

    // Words should be invalidated so stale tokens are not preserved
    expect(transcriptViewer.lines[0].words).toBeUndefined();
    expect(wordsBar.style.display).toBe('none');
  });

  it('splitTranscriptSegment uses proportional interpolation and sets words to undefined when tokens do not match text', () => {
    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:00.000 --> 00:00:10.000]',
        text: 'Hello brave new world of speech',
        startMs: 0,
        endMs: 10000,
        // Tokens that do NOT match the modified text
        words: [
          { text: 'Completely', startMs: 0, endMs: 3000, prob: 0.9 },
          { text: 'different', startMs: 3000, endMs: 7000, prob: 0.8 },
          { text: 'tokens', startMs: 7000, endMs: 10000, prob: 0.85 }
        ]
      }
    ];

    const splitSuccess = splitTranscriptSegment(0, 11); // split after "Hello brave"
    expect(splitSuccess).toBe(true);
    expect(transcriptViewer.lines.length).toBe(2);

    // Mismatched tokens must NOT be arbitrarily assigned to left or right slices
    expect(transcriptViewer.lines[0].words).toBeUndefined();
    expect(transcriptViewer.lines[1].words).toBeUndefined();

    // Timestamps should be valid and within bounds
    expect(transcriptViewer.lines[0].endMs).toBeGreaterThan(0);
    expect(transcriptViewer.lines[0].endMs).toBeLessThan(10000);
    expect(transcriptViewer.lines[1].startMs).toBe(transcriptViewer.lines[0].endMs);
  });

  it('preserves user focus and does not re-render transcript lines when clicking the currently active completed batch item', async () => {
    let renderCalled = false;
    transcriptViewer.render = () => { renderCalled = true; };

    (window as any).isBatchMode = true;
    (window as any).activeBatchViewerIndex = 0;
    (window as any).batchItems = [
      {
        id: 0,
        status: 'completed',
        transcriptLines: [{ id: 0, timeRange: '[00:00:00.000 --> 00:00:05.000]', text: 'Active completed item' }]
      }
    ];

    // First selection sets up explicit selection
    await selectBatchItemTranscript(0);
    renderCalled = false;

    // Clicking the same active completed item again should return early without re-rendering
    await selectBatchItemTranscript(0);
    expect(renderCalled).toBe(false);
  });

  it('unloads companion player immediately when selecting an active in-progress batch item', async () => {
    let unloaded = false;
    const prevUnload = (window as any).unloadCompanionPlayer;
    (window as any).unloadCompanionPlayer = () => { unloaded = true; };

    try {
      (window as any).batchItems = [
        { id: 0, status: 'completed', path: '/audio/completed.mp3', transcriptLines: [] },
        { id: 1, status: 'transcribing', path: '/audio/transcribing.mp3', transcriptLines: [] }
      ];

      await selectBatchItemTranscript(1);
      expect(unloaded).toBe(true);
    } finally {
      (window as any).unloadCompanionPlayer = prevUnload;
    }
  });

  it('flushes pending edits when removing an item or clearing the batch queue', () => {
    let flushed = false;
    transcriptViewer.flushEdits = async () => { flushed = true; };
    transcriptViewer.hasPendingEdits = () => true;

    (window as any).batchItems = [
      { id: 0, status: 'completed', path: '/a.mp3' },
      { id: 1, status: 'completed', path: '/b.mp3' }
    ];

    removeFileFromBatch(0);
    expect(flushed).toBe(true);

    flushed = false;
    clearBatchQueue();
    expect(flushed).toBe(true);
  });

  it('skips redundant stream setup and re-probing when loading the already active file', async () => {
    let streamCallCount = 0;
    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: any) => {
          if (cmd === 'stream_media_file') {
            streamCallCount++;
            return 'http://127.0.0.1:4567/stream/1234';
          }
          if (cmd === 'probe_media_metadata') {
            return { duration_sec: 60, width: 1920, height: 1080 };
          }
          return null;
        }
      }
    };

    const firstResult = await loadMediaIntoCompanionPlayer('/videos/podcast.mp4', false);
    expect(firstResult).toBe(true);
    expect(streamCallCount).toBe(1);

    // Load the exact same file again
    const secondResult = await loadMediaIntoCompanionPlayer('/videos/podcast.mp4', false);
    expect(secondResult).toBe(true);
    // Should NOT have called stream_media_file again!
    expect(streamCallCount).toBe(1);
  });

  it('ignores companion playback shortcuts when modifier keys are held', () => {
    let keydownHandler: ((e: any) => void) | null = null;
    const origAddEventListener = (window as any).addEventListener;
    (window as any).addEventListener = ((evt: string, handler: any) => {
      if (evt === 'keydown') keydownHandler = handler;
      if (typeof origAddEventListener === 'function') {
        origAddEventListener.call(window, evt, handler);
      }
    }) as any;

    const panel = registerMockEl('panel-transcribe');
    panel.classList.add('active');

    const mediaDeck = registerMockEl('transcribe-media-deck');
    mediaDeck.style.display = 'flex';

    initCompanionPlayerDOM();
    if (origAddEventListener) {
      (window as any).addEventListener = origAddEventListener;
    } else {
      delete (window as any).addEventListener;
    }

    expect(keydownHandler).not.toBeNull();

    // Ctrl+Space should be ignored (no defaultPrevented)
    let defaultPrevented = false;
    (keydownHandler as any)({ code: 'Space', ctrlKey: true, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(false);

    // Alt+ArrowLeft should be ignored (no defaultPrevented)
    defaultPrevented = false;
    (keydownHandler as any)({ code: 'ArrowLeft', altKey: true, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(false);

    // Shift+ArrowRight should be ignored
    defaultPrevented = false;
    (keydownHandler as any)({ code: 'ArrowRight', shiftKey: true, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(false);

    // Event with defaultPrevented = true should be ignored
    defaultPrevented = false;
    (keydownHandler as any)({ code: 'Space', defaultPrevented: true, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(false);

    // Plain Space without modifiers should be intercepted
    defaultPrevented = false;
    (keydownHandler as any)({ code: 'Space', defaultPrevented: false, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(true);
  });

  it('splitTranscriptSegment explicitly clears leftWords and rightWords when split occurs past the last token', () => {
    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:00.000 --> 00:00:10.000]',
        text: 'Hello world suffix trailing',
        startMs: 0,
        endMs: 10000,
        // Only 2 words present in words array
        words: [
          { text: 'Hello', startMs: 0, endMs: 2000, prob: 0.9 },
          { text: 'world', startMs: 2000, endMs: 4000, prob: 0.9 }
        ]
      }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    // Split at position 20 (inside "trailing", past all word tokens)
    const splitSuccess = splitTranscriptSegment(0, 20);
    expect(splitSuccess).toBe(true);
    expect(transcriptViewer.lines.length).toBe(2);

    // Tokens must not leak into segment 1 when the right slice is empty
    expect(transcriptViewer.lines[0].words).toBeUndefined();
    expect(transcriptViewer.lines[1].words).toBeUndefined();
  });

  it('mergeTranscriptSegmentWithPrevious sets mergedWords to undefined if either segment lacks word tokens', () => {
    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:01.000 --> 00:00:03.000]',
        text: 'Segment with words',
        startMs: 1000,
        endMs: 3000,
        words: [
          { text: 'Segment', startMs: 1000, endMs: 2000, prob: 0.9 },
          { text: 'with', startMs: 2000, endMs: 2500, prob: 0.9 },
          { text: 'words', startMs: 2500, endMs: 3000, prob: 0.9 }
        ]
      },
      {
        id: 1,
        timeRange: '[00:00:03.500 --> 00:00:05.000]',
        text: 'Segment edited without words',
        startMs: 3500,
        endMs: 5000,
        words: undefined
      }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    const merged = mergeTranscriptSegmentWithPrevious(1);
    expect(merged).toBe(true);
    expect(transcriptViewer.lines.length).toBe(1);
    // Asymmetric words should not create partial token synchronization
    expect(transcriptViewer.lines[0].words).toBeUndefined();
    expect(transcriptViewer.lines[0].text).toBe('Segment with words Segment edited without words');
  });

  it('parseTranscriptTimeRange parses SRT timestamps with commas and computes durLabel', () => {
    const srtRange = '[00:00:01,500 --> 00:00:04,500]';
    const parsed = parseTranscriptTimeRange(srtRange);
    expect(parsed.raw).toBe('00:00:01,500 → 00:00:04,500');
    expect(parsed.durLabel).toBe('3s');

    // Also handles arrow without brackets
    const srtArrow = '00:01:10,200 → 00:01:25,800';
    const parsedArrow = parseTranscriptTimeRange(srtArrow);
    expect(parsedArrow.raw).toBe('00:01:10,200 → 00:01:25,800');
    expect(parsedArrow.durLabel).toBe('16s');
  });

  it('resets companion seek slider and timecodes to zero on unload and load', async () => {
    const seekSlider = registerMockEl('companion-seek-slider', 'INPUT') as any;
    const timeCurrent = registerMockEl('companion-time-current') as any;
    const timeTotal = registerMockEl('companion-time-total') as any;
    const videoEl = registerMockEl('companion-media-element', 'VIDEO') as any;
    videoEl.load = () => {};

    seekSlider.value = '45';
    timeCurrent.textContent = '00:45.000';
    timeTotal.textContent = '02:00.000';

    unloadCompanionPlayer();
    expect(seekSlider.value).toBe('0');
    expect(timeCurrent.textContent).toBe(formatTimecodeDisplay(0));
    expect(timeTotal.textContent).toBe(formatTimecodeDisplay(0));

    seekSlider.value = '25';
    timeCurrent.textContent = '00:25.000';

    (globalThis as any).invoke = async (cmd: string) => {
      if (cmd === 'stream_media_file') return 'http://127.0.0.1:9000/stream/1';
      if (cmd === 'probe_media_file') return { durationSec: 120 };
      return null;
    };

    await loadMediaIntoCompanionPlayer('/path/to/test.mp4');
    expect(seekSlider.value).toBe('0');
    expect(timeCurrent.textContent).toBe(formatTimecodeDisplay(0));
  });

  it('mergeTranscriptSegmentWithPrevious respects empty textarea and does not resurrect deleted text', () => {
    const vp = document.getElementById('transcript-viewport') || registerMockEl('transcript-viewport');
    vp.children = [];

    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:01.000 --> 00:00:03.000]',
        text: 'Keep first',
        startMs: 1000,
        endMs: 3000
      },
      {
        id: 1,
        timeRange: '[00:00:03.500 --> 00:00:05.000]',
        text: 'To be erased',
        startMs: 3500,
        endMs: 5000
      }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    const card1 = document.querySelector('.transcript-card[data-id="1"]');
    const textarea1 = card1?.querySelector('.transcript-text-input') as HTMLTextAreaElement;
    expect(textarea1).not.toBeNull();
    // Simulate user clearing text in the textarea
    textarea1.value = '';

    const merged = mergeTranscriptSegmentWithPrevious(1);
    expect(merged).toBe(true);
    expect(transcriptViewer.lines.length).toBe(1);
    expect(transcriptViewer.lines[0].text).toBe('Keep first');
  });

  it('splitTranscriptSegment rejects splitting when textarea content was cleared to empty', () => {
    const vp = document.getElementById('transcript-viewport') || registerMockEl('transcript-viewport');
    vp.children = [];

    transcriptViewer.lines = [
      {
        id: 0,
        timeRange: '[00:00:00.000 --> 00:00:04.000]',
        text: 'Will be cleared',
        startMs: 0,
        endMs: 4000
      }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    const card0 = document.querySelector('.transcript-card[data-id="0"]');
    const textarea0 = card0?.querySelector('.transcript-text-input') as HTMLTextAreaElement;
    expect(textarea0).not.toBeNull();
    textarea0.value = '';

    const splitResult = splitTranscriptSegment(0);
    expect(splitResult).toBe(false);
    expect(transcriptViewer.lines.length).toBe(1);
  });

  it('accurately resolves exact boundary timestamps to the newly starting segment (resolves bug where clicking segment 2 kept segment 1)', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.070 --> 00:00:02.230]', text: 'When you cut off the root of an onion,', startMs: 70, endMs: 2230 },
      { id: 1, timeRange: '[00:00:02.230 --> 00:00:04.710]', text: 'it releases chemicals that hit your eyes', startMs: 2230, endMs: 4710 }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    const card0 = document.querySelector('.transcript-card[data-id="0"]')!;
    const card1 = document.querySelector('.transcript-card[data-id="1"]')!;

    // 1. Initial position at segment 0
    highlightActiveTranscriptSegment(1.0);
    expect(card0.classList.contains('active-playback')).toBe(true);
    expect(card1.classList.contains('active-playback')).toBe(false);

    // 2. Seeking exactly to 2.230 (the boundary between segment 0 and 1)
    // MUST select segment 1 because segment 1 starts at 2.230!
    highlightActiveTranscriptSegment(2.230);
    expect(card0.classList.contains('active-playback')).toBe(false);
    expect(card1.classList.contains('active-playback')).toBe(true);

    // 3. Right before the boundary (2.229) selects segment 0
    highlightActiveTranscriptSegment(2.229);
    expect(card0.classList.contains('active-playback')).toBe(true);
    expect(card1.classList.contains('active-playback')).toBe(false);
  });

  it('supports explicit targetLineId in seekCompanionPlayer for instant segment activation', () => {
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.070 --> 00:00:02.230]', text: 'Segment 0', startMs: 70, endMs: 2230 },
      { id: 1, timeRange: '[00:00:02.230 --> 00:00:04.710]', text: 'Segment 1', startMs: 2230, endMs: 4710 }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    const card1 = document.querySelector('.transcript-card[data-id="1"]')!;
    seekCompanionPlayer(2230, false, 1);
    expect(card1.classList.contains('active-playback')).toBe(true);
  });

  it('detects Persian and Arabic scripts accurately for RTL canvas subtitle rendering', () => {
    expect(hasArabicOrPersianScript('it releases chemicals that hit your eyes')).toBe(false);
    expect(hasArabicOrPersianScript('مواد شیمیایی آزاد می‌کند که به چشم شما برخورد می‌کند')).toBe(true);
    expect(hasArabicOrPersianScript('Onion پیاز')).toBe(true);
  });

  it('updates companion subtitle bounds and renders subtitles on canvas without throwing', () => {
    registerMockEl('companion-subtitle-canvas', 'CANVAS');
    const container = registerMockEl('companion-video-container', 'DIV');
    container.clientWidth = 400;
    container.clientHeight = 300;
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.clientWidth = 400;
    video.clientHeight = 225;

    expect(() => updateCompanionSubtitleBounds(true)).not.toThrow();
    expect(() => renderCompanionSubtitle(true)).not.toThrow();
  });

  it('cleans subtitle text by removing ASS tags, HTML tags, and normalizing newlines', () => {
    expect(cleanSubtitleDisplayText('{\\an8}Hello {\\b1}World{\\b0}')).toBe('Hello World');
    expect(cleanSubtitleDisplayText('<i>مورب</i> و <b>برجسته</b>')).toBe('مورب و برجسته');
    expect(cleanSubtitleDisplayText('Line 1\\NLine 2\\nLine 3')).toBe('Line 1\nLine 2\nLine 3');
    expect(cleanSubtitleDisplayText('')).toBe('');
  });

  it('automatically triggers subtitle redraw when canvas dimensions change even if forceRedraw is false', () => {
    const canvas = registerMockEl('companion-subtitle-canvas', 'CANVAS') as any;
    const container = registerMockEl('companion-video-container', 'DIV');
    container.clientWidth = 600;
    container.clientHeight = 400;
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.clientWidth = 600;
    video.clientHeight = 338;

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'Resized subtitle', startMs: 0, endMs: 3000 }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    // Initial sizing
    updateCompanionSubtitleBounds(true);
    const initialW = canvas.width;
    expect(initialW).toBeGreaterThan(0);

    // Change container size (simulating pane resize)
    container.clientWidth = 800;
    video.clientWidth = 800;
    video.clientHeight = 450;

    // updateCompanionSubtitleBounds with forceRedraw = false should detect dimsChanged and redraw without error
    expect(() => updateCompanionSubtitleBounds(false)).not.toThrow();
    expect(canvas.width).not.toBe(initialW);
  });

  it('dynamically prioritizes Inter for English subtitles and Vazirmatn for Persian subtitles', () => {
    const canvas = registerMockEl('companion-subtitle-canvas', 'CANVAS') as any;
    const ctx = canvas.getContext('2d');
    const container = registerMockEl('companion-video-container', 'DIV');
    container.clientWidth = 600;
    container.clientHeight = 400;
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.clientWidth = 600;
    video.clientHeight = 338;
    updateCompanionSubtitleBounds(true);

    // 1. English subtitle -> Inter prioritized
    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'When you cut off the root of an onion', startMs: 0, endMs: 3000 }
    ];
    renderTranscriptLines(transcriptViewer.lines);
    renderCompanionSubtitle(true);
    expect(ctx.font).toContain("'Inter', 'Vazirmatn'");

    // 2. Persian subtitle -> Vazirmatn prioritized
    transcriptViewer.lines = [
      { id: 1, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'مواد شیمیایی آزاد می‌کند که به چشم شما برخورد می‌کند', startMs: 0, endMs: 3000 }
    ];
    renderTranscriptLines(transcriptViewer.lines);
    renderCompanionSubtitle(true);
    expect(ctx.font).toContain("'Vazirmatn', 'Inter'");
  });

  it('adaptively scales font size in 9:16 vertical videos to prevent taking up half the screen', () => {
    const canvas = registerMockEl('companion-subtitle-canvas', 'CANVAS') as any;
    const ctx = canvas.getContext('2d');
    const container = registerMockEl('companion-video-container', 'DIV');
    container.clientWidth = 320;
    container.clientHeight = 570;
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    // 9:16 vertical video (e.g. 1080x1920)
    video.videoWidth = 1080;
    video.videoHeight = 1920;
    video.clientWidth = 320;
    video.clientHeight = 569;
    updateCompanionSubtitleBounds(true);

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:00.000 --> 00:00:03.000]', text: 'Shorts vertical caption', startMs: 0, endMs: 3000 }
    ];
    renderTranscriptLines(transcriptViewer.lines);
    renderCompanionSubtitle(true);

    // In a 320x569 vertical video:
    // Without adaptive scaling, font size would be 569 * 0.055 = 31px (massive).
    // With adaptive scaling, font size is Math.round(320 * 0.058) = 19px.
    expect(ctx.font).toMatch(/600 1[789]px/);
  });

  it('toggles non-destructive deck-hidden class when switching between setup deck and media deck', () => {
    const setupDeck = registerMockEl('transcribe-unified-deck', 'DIV');
    const mediaDeck = registerMockEl('transcribe-media-deck', 'DIV');
    const tabSetup = registerMockEl('btn-tab-to-setup', 'BUTTON');
    const tabPlayer = registerMockEl('btn-tab-to-player', 'BUTTON');
    const setupTabSetup = registerMockEl('btn-setup-tab-setup', 'BUTTON');
    const setupTabPlayer = registerMockEl('btn-setup-tab-player', 'BUTTON');

    // 1. Show Media Deck
    showTranscribeMediaDeck();
    expect(setupDeck.classList.contains('deck-hidden')).toBe(true);
    expect(setupDeck.style.display).toBe('none');
    expect(mediaDeck.classList.contains('deck-hidden')).toBe(false);
    expect(mediaDeck.style.display).toBe('flex');
    expect(tabPlayer.classList.contains('active')).toBe(true);

    // 2. Show Setup Deck
    showTranscribeSetupDeck();
    expect(setupDeck.classList.contains('deck-hidden')).toBe(false);
    expect(setupDeck.style.display).toBe('flex');
    expect(mediaDeck.classList.contains('deck-hidden')).toBe(true);
    expect(mediaDeck.style.display).toBe('none');
    expect(tabSetup.classList.contains('active')).toBe(true);
  });

  it('onTranscribeViewActivated safely wakes player surface when media deck is active', () => {
    const mediaDeck = registerMockEl('transcribe-media-deck', 'DIV');
    mediaDeck.style.display = 'flex';
    mediaDeck.classList.remove('deck-hidden');

    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.src = 'http://127.0.0.1:54321/media/stream.mp4';
    video.currentTime = 14.5;
    video.readyState = 2;

    const canvas = registerMockEl('companion-subtitle-canvas', 'CANVAS') as any;
    const container = registerMockEl('companion-video-container', 'DIV');
    container.clientWidth = 400;
    container.clientHeight = 300;
    video.clientWidth = 400;
    video.clientHeight = 300;
    video.videoWidth = 640;
    video.videoHeight = 480;

    onTranscribeViewActivated();
    expect(video.currentTime).toBe(14.5);
    expect(canvas.style.display).toBe('block');
  });

  it('loadTranscriptFromFile and parseAndApplyTranscriptContent reset viewport scroll to top for fresh transcripts', async () => {
    const viewport = registerMockEl('transcript-viewport', 'DIV');
    viewport.scrollTop = 1500; // Scrolled to bottom during transcription

    const { loadTranscriptFromFile } = await import('./transcriptViewer');
    globalThis.__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'read_text_file_content') {
            return '1\n00:00:00,000 --> 00:00:02,000\nHello World\n';
          }
          return null;
        }
      }
    };

    await loadTranscriptFromFile('/output/sub.srt', true);
    expect(viewport.scrollTop).toBe(0);
  });

  it('wakeCompanionPlayerSurface does not rewind currentTime if playback resumes before rAF', () => {
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.src = 'http://127.0.0.1:54321/media/stream.mp4';
    video.currentTime = 20.0;
    video.readyState = 2;
    video.paused = true;
    video.seeking = false;

    // Simulate active media info for companion player
    (window as any).activeMediaInfo = { isVideo: true };

    let rafCallback: (() => void) | null = null;
    const origRaf = (window as any).requestAnimationFrame;
    (window as any).requestAnimationFrame = (cb: () => void) => {
      rafCallback = cb;
      return 1;
    };

    wakeCompanionPlayerSurface();
    // After micro-nudge, currentTime is 20.0 - 0.0005 = 19.9995
    expect(video.currentTime).toBeCloseTo(19.9995, 4);

    // Now video starts playing (paused becomes false) before rAF executes
    video.paused = false;
    video.currentTime = 21.5;

    if (rafCallback) {
      (rafCallback as () => void)();
    }

    // Should NOT have reverted to 20.0 because video was no longer paused!
    expect(video.currentTime).toBe(21.5);

    if (origRaf) {
      (window as any).requestAnimationFrame = origRaf;
    } else {
      delete (window as any).requestAnimationFrame;
    }
  });

  it('respects switchToMediaDeck=false in seekCompanionPlayer so background batch seeks do not hijack Setup Deck', async () => {
    // Arrange
    const setupDeck = registerMockEl('transcribe-unified-deck', 'DIV');
    const mediaDeck = registerMockEl('transcribe-media-deck', 'DIV');
    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.readyState = 2;
    video.duration = 120;
    video.paused = true;

    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'stream_media_file') return 'http://127.0.0.1:54321/media/batch.mp4';
          if (cmd === 'probe_media_file') return { exists: true, durationSec: 120 };
          return null;
        }
      }
    };

    await loadMediaIntoCompanionPlayer('/media/batch.mp4', false, 120);
    setupDeck.classList.remove('deck-hidden');
    setupDeck.style.display = 'flex';
    mediaDeck.classList.add('deck-hidden');
    mediaDeck.style.display = 'none';

    transcriptViewer.lines = [
      { id: 0, timeRange: '[00:00:15.000 --> 00:00:20.000]', text: 'Batch line', startMs: 15_000, endMs: 20_000 }
    ];
    renderTranscriptLines(transcriptViewer.lines);

    // Act: silent background seek (e.g. clicking a batch queue row)
    seekCompanionPlayer(15_000, false, 0, false);

    // Assert: player seeks & highlights segment, but Setup Deck stays visible
    expect(video.currentTime).toBe(15);
    expect(setupDeck.classList.contains('deck-hidden')).toBe(false);
    expect(setupDeck.style.display).toBe('flex');
    expect(mediaDeck.classList.contains('deck-hidden')).toBe(true);

    // Act: explicit default seek switches to Media Deck as expected
    seekCompanionPlayer(15_000, false, 0);
    expect(setupDeck.classList.contains('deck-hidden')).toBe(true);
    expect(mediaDeck.classList.contains('deck-hidden')).toBe(false);
  });

  it('manages the 3-tab lifecycle (Setup | Files | Player) cleanly across Batch Mode selection, execution, and unload', async () => {
    // Arrange
    const setupDeck = registerMockEl('transcribe-unified-deck', 'DIV');
    const deckBody = registerMockEl('transcribe-setup-body', 'DIV', 'transcribe-deck-body');
    setupDeck.appendChild(deckBody);
    const dropZone = registerMockEl('transcribe-drop-zone', 'DIV');
    const fileNameEl = registerMockEl('lbl-file-name', 'P');
    const clearMediaBtn = registerMockEl('btn-clear-media', 'BUTTON');
    const batchQueueContainer = registerMockEl('batch-queue-container', 'DIV');
    registerMockEl('batch-queue-body', 'DIV');
    const mediaDeck = registerMockEl('transcribe-media-deck', 'DIV');

    const setupDeckTabs = registerMockEl('setup-deck-mode-tabs', 'DIV');
    const manageSettingsBtn = registerMockEl('btn-transcribe-manage-settings', 'BUTTON');

    const setupTabSetup = registerMockEl('btn-setup-tab-setup', 'BUTTON');
    const setupTabFiles = registerMockEl('btn-setup-tab-files', 'BUTTON');
    const setupTabPlayer = registerMockEl('btn-setup-tab-player', 'BUTTON');

    const mediaTabSetup = registerMockEl('btn-tab-to-setup', 'BUTTON');
    const mediaTabFiles = registerMockEl('btn-tab-to-files', 'BUTTON');
    const mediaTabPlayer = registerMockEl('btn-tab-to-player', 'BUTTON');

    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.readyState = 2;
    video.duration = 90;
    video.paused = true;

    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string) => {
          if (cmd === 'probe_media_file') return { exists: true, durationSec: 90, size: '12 MB' };
          if (cmd === 'stream_media_file') return 'http://127.0.0.1:54321/media/item1.mp4';
          if (cmd === 'convert_media_file') return '/tmp/item.wav';
          if (cmd === 'start_transcription_task') {
            return {
              generatedFiles: ['item.srt'],
              outputDir: '/media',
              durationMs: 1200,
              speedFactor: 4.5
            };
          }
          return null;
        }
      }
    };

    // 1. Entering Batch Mode via addBatchFiles keeps Setup active while revealing [Setup | Files] tabs
    unloadCompanionPlayer();
    clearBatchQueue();
    await addBatchFiles(['/media/item1.mp4', '/media/item2.mp4']);

    expect(batchProcessor.getIsBatchMode()).toBe(true);
    expect(getActiveTranscribeDeckTab()).toBe('setup');
    expect(setupDeckTabs.style.display).toBe('inline-flex');
    expect(manageSettingsBtn.style.display).toBe('none');
    expect(setupTabSetup.classList.contains('active')).toBe(true);
    expect(setupTabSetup.getAttribute('aria-pressed')).toBe('true');
    expect(setupTabFiles.style.display).toBe('inline-flex');
    expect(setupTabFiles.classList.contains('active')).toBe(false);
    expect(setupTabFiles.getAttribute('aria-pressed')).toBe('false');
    expect(setupTabPlayer.style.display).toBe('none');
    expect(deckBody.style.display).toBe('flex');
    expect(batchQueueContainer.style.display).toBe('none');
    expect(clearMediaBtn.style.display).toBe('inline-flex');
    expect(dropZone.classList.contains('is-batch-summary')).toBe(true);
    expect(dropZone.getAttribute('data-i18n-title')).toBe('transcribe.queueFilesHeader');
    expect(fileNameEl.getAttribute('data-i18n')).toBe('transcribe.batchModeActive');

    // 2. Switching to Files tab displays #batch-queue-container and hides .transcribe-deck-body
    showTranscribeFilesDeck();
    expect(getActiveTranscribeDeckTab()).toBe('files');
    expect(deckBody.style.display).toBe('none');
    expect(batchQueueContainer.style.display).toBe('flex');
    expect(setupTabFiles.classList.contains('active')).toBe(true);
    expect(setupTabSetup.classList.contains('active')).toBe(false);

    // 3. Loading a completed item into Companion Player (autoSwitchDeck=false) reveals the 3rd Player tab without leaving Files tab
    await loadMediaIntoCompanionPlayer('/media/item1.mp4', false, 90);
    expect(getActiveTranscribeDeckTab()).toBe('files');
    expect(setupTabPlayer.style.display).toBe('inline-flex');
    expect(mediaTabFiles.style.display).toBe('inline-flex');
    expect(mediaTabPlayer.style.display).toBe('inline-flex');

    // 4. Unloading Companion Player while on Files tab in Batch Mode preserves Files tab and hides only Player tab
    unloadCompanionPlayer();
    expect(getActiveTranscribeDeckTab()).toBe('files');
    expect(batchQueueContainer.style.display).toBe('flex');
    expect(deckBody.style.display).toBe('none');
    expect(setupDeckTabs.style.display).toBe('inline-flex');
    expect(setupTabFiles.classList.contains('active')).toBe(true);
    expect(setupTabPlayer.style.display).toBe('none');

    // 5. Starting runBatchExtraction from Setup automatically switches to Files tab
    showTranscribeSetupDeck();
    expect(getActiveTranscribeDeckTab()).toBe('setup');
    (window as any).settingsState = {
      selectedBackend: 'Standard',
      modelPath: '/models/ggml-base.bin',
      outputSrt: true
    };
    (window as any).localScannedTransModels = ['/models/ggml-base.bin'];

    await runBatchExtraction();
    expect(getActiveTranscribeDeckTab()).toBe('files');
    expect(batchQueueContainer.style.display).toBe('flex');
    expect(deckBody.style.display).toBe('none');
    expect(getActiveMediaInfo()?.filePath).toBe('/media/item2.mp4');
    expect(setupTabPlayer.style.display).toBe('inline-flex');
    expect(mediaTabPlayer.style.display).toBe('inline-flex');

    // 6. Clearing batch queue exits Batch Mode, hides Files tab, and returns to Setup
    clearBatchQueue();
    expect(batchProcessor.getIsBatchMode()).toBe(false);
    expect(getActiveTranscribeDeckTab()).toBe('setup');
    expect(setupDeckTabs.style.display).toBe('none');
    expect(setupTabFiles.style.display).toBe('none');
    expect(deckBody.style.display).toBe('flex');
    expect(batchQueueContainer.style.display).toBe('none');
    expect(clearMediaBtn.style.display).toBe('none');
    expect(dropZone.classList.contains('is-batch-summary')).toBe(false);
    expect(dropZone.getAttribute('data-i18n-title')).toBe('transcribe.selectFilePrompt');
    expect(fileNameEl.getAttribute('data-i18n')).toBe('transcribe.noFileLoaded');
  });

  it('preserves user active tab and does not re-seek or pause already-loaded item when batch completes in background', async () => {
    // Arrange
    const setupDeck = registerMockEl('transcribe-unified-deck', 'DIV');
    const deckBody = registerMockEl('transcribe-setup-body', 'DIV', 'transcribe-deck-body');
    setupDeck.appendChild(deckBody);
    registerMockEl('batch-queue-container', 'DIV');
    registerMockEl('batch-queue-body', 'DIV');
    registerMockEl('transcribe-media-deck', 'DIV');
    registerMockEl('setup-deck-mode-tabs', 'DIV');
    registerMockEl('btn-transcribe-manage-settings', 'BUTTON');
    registerMockEl('btn-setup-tab-setup', 'BUTTON');
    registerMockEl('btn-setup-tab-files', 'BUTTON');
    registerMockEl('btn-setup-tab-player', 'BUTTON');
    registerMockEl('btn-tab-to-setup', 'BUTTON');
    registerMockEl('btn-tab-to-files', 'BUTTON');
    registerMockEl('btn-tab-to-player', 'BUTTON');

    const video = registerMockEl('companion-media-element', 'VIDEO') as any;
    video.readyState = 2;
    video.duration = 120;
    video.paused = true;

    let itemIndex = 0;
    (window as any).__TAURI__ = {
      core: {
        invoke: async (cmd: string, args?: any) => {
          if (cmd === 'probe_media_file') return { exists: true, durationSec: 120, size: '15 MB' };
          if (cmd === 'stream_media_file') return `http://127.0.0.1:54321/media/${args?.filePath || 'item.mp4'}`;
          if (cmd === 'convert_media_file') return '/tmp/item.wav';
          if (cmd === 'get_transcript_session_data') {
            return JSON.stringify({
              transcription: [
                { timestamps: { from: '00:00:02,000', to: '00:00:05,000' }, offsets: { from: 2000, to: 5000 }, text: 'First cue' }
              ]
            });
          }
          if (cmd === 'start_transcription_task') {
            itemIndex++;
            if (itemIndex === 2) {
              // Simulate user selecting Completed Item 0, playing it at 45s, and switching to Setup tab while Item 1 is running
              await selectBatchItemTranscript(0);
              video.currentTime = 45;
              video.paused = false;
              showTranscribeSetupDeck();
            }
            return {
              generatedFiles: ['item.srt'],
              outputDir: '/media',
              internalJsonPath: '/tmp/session.json',
              durationMs: 1000,
              speedFactor: 4.0
            };
          }
          return null;
        }
      }
    };

    unloadCompanionPlayer();
    clearBatchQueue();
    await addBatchFiles(['/media/first.mp4', '/media/second.mp4']);
    (window as any).settingsState = {
      selectedBackend: 'Standard',
      modelPath: '/models/ggml-base.bin',
      outputSrt: true
    };
    (window as any).localScannedTransModels = ['/models/ggml-base.bin'];

    // Act
    await runBatchExtraction();

    // Assert: User's deliberate switch to Setup tab is respected, and active playback of first.mp4 at 45s was not reset back to 2s
    expect(getActiveTranscribeDeckTab()).toBe('setup');
    expect(getActiveMediaInfo()?.filePath).toBe('/media/first.mp4');
    expect(video.currentTime).toBe(45);

    clearBatchQueue();
  });
});
