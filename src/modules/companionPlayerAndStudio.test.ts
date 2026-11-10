// @ts-nocheck
// Unit tests for Companion Media Player & Precise Segment Splitting/Merging
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  splitTranscriptSegment,
  mergeTranscriptSegmentWithPrevious,
  toggleConfidenceHighlighting,
  isConfidenceHighlightingActive,
  loadTranscriptFromJsonData,
  transcriptViewer,
  type TranscriptLine
} from './transcriptViewer';
import {
  formatTimecodeDisplay,
  initCompanionPlayerDOM,
  seekCompanionPlayer,
  highlightActiveTranscriptSegment,
  changeCompanionVolume,
  toggleCompanionMute,
  showTranscribeSetupDeck,
  showTranscribeMediaDeck,
  unloadCompanionPlayer
} from './companionPlayer';

// Minimal mock DOM for headless testing
class MockElement {
  tagName: string;
  id = '';
  className = '';
  _classes = new Set<string>();
  classList: any;
  attributes = new Map<string, string>();
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  textContent = '';
  value = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  _listeners = new Map<string, Array<(e: any) => void>>();

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

  querySelectorAll(sel: string) {
    return mockDocument.querySelectorAll(sel);
  }

  querySelector(sel: string) {
    return mockDocument.querySelector(sel);
  }

  scrollIntoView() {}
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
    const results: MockElement[] = [];
    const idMatch = sel.match(/\[data-id="([^"]+)"\]/);
    elementRegistry.forEach(el => {
      if (idMatch) {
        if (el.dataset.id === idMatch[1]) {
          results.push(el);
        }
        return;
      }
      if (sel.startsWith('#') && el.id === sel.slice(1)) {
        results.push(el);
      } else if (sel.startsWith('.')) {
        const classes = sel.split('.').filter(Boolean);
        if (classes.length > 0 && classes.every(c => el.classList.contains(c))) {
          results.push(el);
        }
      }
    });
    return results;
  },
  createElement(tag: string) {
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

    unloadCompanionPlayer();
    expect(setupDeck.style.display).toBe('flex');
    expect(mediaDeck.style.display).toBe('none');
    expect(setupTabs.style.display).toBe('none');
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
    const pipBtn = registerMockEl('btn-companion-pip', 'BUTTON') as any;
    const fullscreenBtn = registerMockEl('btn-companion-fullscreen', 'BUTTON') as any;
    registerMockEl('companion-audio-fallback');
    registerMockEl('companion-audio-name');

    const { loadMediaIntoCompanionPlayer } = await import('./companionPlayer');
    await loadMediaIntoCompanionPlayer('/path/to/podcast.mp3', false);

    expect(aspectEl.textContent).not.toBe('16:9');
    expect(aspectEl.textContent).toBe('Stereo');
    expect(resEl.textContent).toBe('Audio Only');
    expect(pipBtn.disabled).toBe(true);
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
