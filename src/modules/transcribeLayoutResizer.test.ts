// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { loadResolvedHtml } from '../testUtils';
import {
  DEFAULT_LEFT_PANEL_WIDTH,
  MIN_LEFT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  SNAP_THRESHOLD,
  STORAGE_KEY,
  calculateMaxLeftWidth,
  isRtlLayout,
  getTranscribeLeftPanelWidth,
  setTranscribeLeftPanelWidth,
  resetTranscribeLayoutWidth,
  initTranscribeLayoutResizer,
  updateTranscriptViewerResponsive,
  resetModuleStateForTest
} from './transcribeLayoutResizer';

describe('Transcription Studio Layout Resizer Module', () => {
  let mockStorage: Record<string, string> = {};
  let mockDocElement: any;
  let mockLayout: any;
  let mockLeftPanel: any;
  let mockResizer: any;
  let registeredListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    resetModuleStateForTest();
    mockStorage = {};
    registeredListeners = {};

    globalThis.localStorage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; }
    } as any;

    mockDocElement = {
      attributes: new Map<string, string>(),
      classes: new Set<string>(),
      getAttribute(attr: string) { return this.attributes.get(attr) || null; },
      setAttribute(attr: string, val: string) { this.attributes.set(attr, val); },
      removeAttribute(attr: string) { this.attributes.delete(attr); },
      classList: {
        contains: (c: string) => mockDocElement.classes.has(c),
        add: (c: string) => mockDocElement.classes.add(c),
        remove: (c: string) => mockDocElement.classes.delete(c)
      }
    };

    mockLayout = {
      id: 'transcribe-layout',
      style: {
        _props: new Map<string, string>(),
        setProperty(k: string, v: string) { this._props.set(k, v); },
        getPropertyValue(k: string) { return this._props.get(k) || ''; }
      },
      classes: new Set<string>(),
      classList: {
        add: (c: string) => mockLayout.classes.add(c),
        remove: (c: string) => mockLayout.classes.delete(c),
        contains: (c: string) => mockLayout.classes.has(c)
      },
      getBoundingClientRect: () => ({ width: 1200, left: 0, right: 1200 })
    };

    mockLeftPanel = {
      id: 'transcribe-left-panel',
      getBoundingClientRect: () => ({ width: 420, left: 0, right: 420 })
    };

    mockResizer = {
      id: 'transcribe-layout-resizer',
      attributes: new Map<string, string>(),
      classes: new Set<string>(),
      getAttribute(attr: string) { return this.attributes.get(attr) || null; },
      setAttribute(attr: string, val: string) { this.attributes.set(attr, val); },
      classList: {
        add: (c: string) => mockResizer.classes.add(c),
        remove: (c: string) => mockResizer.classes.delete(c),
        contains: (c: string) => mockResizer.classes.has(c),
        toggle: (c: string, force?: boolean) => {
          const state = force !== undefined ? force : !mockResizer.classes.has(c);
          if (state) mockResizer.classes.add(c);
          else mockResizer.classes.delete(c);
        }
      },
      addEventListener: (evt: string, fn: Function) => {
        if (!registeredListeners[evt]) registeredListeners[evt] = [];
        registeredListeners[evt].push(fn);
      },
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn()
    };

    const mockViewerCard = {
      id: 'transcribe-viewer-card',
      classes: new Set<string>(),
      classList: {
        add: (c: string) => mockViewerCard.classes.add(c),
        remove: (c: string) => mockViewerCard.classes.delete(c),
        contains: (c: string) => mockViewerCard.classes.has(c),
        toggle: (c: string, force?: boolean) => {
          const state = force !== undefined ? force : !mockViewerCard.classes.has(c);
          if (state) mockViewerCard.classes.add(c);
          else mockViewerCard.classes.delete(c);
        }
      },
      getBoundingClientRect: () => ({ width: 760, left: 440, right: 1200 })
    };

    globalThis.document = {
      documentElement: mockDocElement,
      body: {
        classes: new Set<string>(),
        classList: {
          add: (c: string) => globalThis.document.body.classes.add(c),
          remove: (c: string) => globalThis.document.body.classes.delete(c),
          contains: (c: string) => globalThis.document.body.classes.has(c)
        }
      },
      getElementById: (id: string) => {
        if (id === 'transcribe-layout') return mockLayout;
        if (id === 'transcribe-left-panel') return mockLeftPanel;
        if (id === 'transcribe-layout-resizer') return mockResizer;
        if (id === 'transcribe-viewer-card') return mockViewerCard;
        return null;
      }
    } as any;

    globalThis.window = {
      innerWidth: 1200,
      addEventListener: (evt: string, fn: Function) => {
        if (!registeredListeners[evt]) registeredListeners[evt] = [];
        registeredListeners[evt].push(fn);
      }
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies HTML template contains the resizer element with accessibility attributes', () => {
    const htmlPath = resolve(__dirname, '../index.html');
    const html = loadResolvedHtml(htmlPath);

    expect(html).toContain('id="transcribe-layout-resizer"');
    expect(html).toContain('class="transcribe-layout-resizer"');
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('data-i18n-title="transcribe.resizerTooltip"');
    expect(html).toContain('data-i18n-aria="transcribe.resizerAria"');
    expect(html).toContain('transcribe-resizer-line');
    expect(html).toContain('transcribe-resizer-handle');
  });

  it('calculates maximum left panel width ensuring right panel maintains min width', () => {
    // Container: 1200px. Required right: 420 + resizer 12 + gap 8 = 440px. Max left: 1200 - 440 = 760px.
    const max1200 = calculateMaxLeftWidth(1200);
    expect(max1200).toBe(760);

    // Very small screen: 800px. 800 - 440 = 360px -> Clamped to MIN_LEFT_PANEL_WIDTH (400px)
    const maxSmall = calculateMaxLeftWidth(800);
    expect(maxSmall).toBe(MIN_LEFT_PANEL_WIDTH);
  });

  it('detects RTL layout accurately via dir attribute and rtl-layout class', () => {
    expect(isRtlLayout()).toBe(false);

    mockDocElement.setAttribute('dir', 'rtl');
    expect(isRtlLayout()).toBe(true);

    mockDocElement.removeAttribute('dir');
    mockDocElement.classList.add('rtl-layout');
    expect(isRtlLayout()).toBe(true);
  });

  it('enforces minimum width floor so left panel cannot shrink below 420px', () => {
    initTranscribeLayoutResizer();

    // Attempting to set width to 300px
    const result = setTranscribeLeftPanelWidth(300, true, false);
    expect(result).toBe(MIN_LEFT_PANEL_WIDTH);
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('420px');
  });

  it('preserves currentWidth and avoids collapsing to floor when layout container has 0 width (hidden tab)', () => {
    initTranscribeLayoutResizer();
    // Set user width to 600px while tab is active
    setTranscribeLeftPanelWidth(600, true, false);
    expect(getTranscribeLeftPanelWidth()).toBe(600);

    // Simulate tab switch to another view (display: none -> width = 0)
    mockLayout.getBoundingClientRect = () => ({ width: 0, left: 0, right: 0 });

    // Window resize occurs while tab is hidden
    const result = setTranscribeLeftPanelWidth(getTranscribeLeftPanelWidth(), false, false);
    expect(result).toBe(600);
    expect(getTranscribeLeftPanelWidth()).toBe(600);
  });

  it('updates aria-valuemin, aria-valuenow, and aria-valuemax attributes on resizer', () => {
    initTranscribeLayoutResizer();
    setTranscribeLeftPanelWidth(520, true, false);

    expect(mockResizer.getAttribute('aria-valuenow')).toBe('520');
    expect(mockResizer.getAttribute('aria-valuemin')).toBe('420');
    expect(mockResizer.getAttribute('aria-valuemax')).toBe('760');
  });

  it('safely releases dragging state on lostpointercapture and window blur', () => {
    initTranscribeLayoutResizer();

    const onPointerDown = registeredListeners['pointerdown'][0];
    onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 420,
      currentTarget: mockResizer,
      preventDefault: vi.fn()
    });

    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(true);

    // Simulate lostpointercapture event
    const onLostCapture = registeredListeners['lostpointercapture'][0];
    onLostCapture();

    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(false);

    // Re-engage drag and simulate window blur
    onPointerDown({
      button: 0,
      pointerId: 2,
      clientX: 420,
      currentTarget: mockResizer,
      preventDefault: vi.fn()
    });
    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(true);

    const onBlur = registeredListeners['blur'][0];
    onBlur();
    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(false);
  });

  it('snaps magnetically to default width (420px) when within snap threshold', () => {
    initTranscribeLayoutResizer();

    // 428px is within ±20px of 420px -> should snap to 420px
    const snappedWidth = setTranscribeLeftPanelWidth(428, true, true);
    expect(snappedWidth).toBe(DEFAULT_LEFT_PANEL_WIDTH);
    expect(mockResizer.classList.contains('is-snapped')).toBe(true);
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('420px');

    // 460px is outside snap threshold -> should NOT snap
    const freeWidth = setTranscribeLeftPanelWidth(460, true, true);
    expect(freeWidth).toBe(460);
    expect(mockResizer.classList.contains('is-snapped')).toBe(false);
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('460px');
  });

  it('resets width to default and clears localStorage on double click', () => {
    initTranscribeLayoutResizer();
    setTranscribeLeftPanelWidth(650, true, false);
    expect(mockStorage[STORAGE_KEY]).toBe('650');

    resetTranscribeLayoutWidth();
    expect(getTranscribeLeftPanelWidth()).toBe(DEFAULT_LEFT_PANEL_WIDTH);
    expect(mockStorage[STORAGE_KEY]).toBeUndefined();
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('420px');
    expect(mockLayout.classes.has('is-animating')).toBe(true);
  });

  it('executes pointer drag resizing in LTR mode', () => {
    initTranscribeLayoutResizer();

    const onPointerDown = registeredListeners['pointerdown'][0];
    const onPointerMove = registeredListeners['pointermove'][0];
    const onPointerUp = registeredListeners['pointerup'][0];

    // Pointer down at clientX = 420
    const downEvt = {
      button: 0,
      pointerId: 1,
      clientX: 420,
      currentTarget: mockResizer,
      preventDefault: vi.fn()
    };
    onPointerDown(downEvt);

    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(true);
    expect(mockResizer.setPointerCapture).toHaveBeenCalledWith(1);

    // Pointer move to clientX = 570 (dragged right by +150px)
    const moveEvt = {
      pointerId: 1,
      clientX: 570
    };
    onPointerMove(moveEvt);

    expect(getTranscribeLeftPanelWidth()).toBe(570);
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('570px');

    // Pointer up
    const upEvt = {
      pointerId: 1,
      currentTarget: mockResizer
    };
    onPointerUp(upEvt);

    expect(globalThis.document.body.classList.contains('is-resizing-transcribe')).toBe(false);
    expect(mockStorage[STORAGE_KEY]).toBe('570');
  });

  it('executes pointer drag resizing in RTL mode (inverted vector)', () => {
    mockDocElement.setAttribute('dir', 'rtl');
    initTranscribeLayoutResizer();

    const onPointerDown = registeredListeners['pointerdown'][0];
    const onPointerMove = registeredListeners['pointermove'][0];
    const onPointerUp = registeredListeners['pointerup'][0];

    // Pointer down at clientX = 800
    onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 800,
      currentTarget: mockResizer,
      preventDefault: vi.fn()
    });

    // In RTL, moving left (e.g. from 800 to 650, delta = 800 - 650 = +150px) expands the panel
    onPointerMove({
      pointerId: 1,
      clientX: 650
    });

    expect(getTranscribeLeftPanelWidth()).toBe(570); // 420 + 150 = 570
    expect(mockLayout.style.getPropertyValue('--transcribe-left-panel-width')).toBe('570px');

    onPointerUp({
      pointerId: 1,
      currentTarget: mockResizer
    });

    expect(mockStorage[STORAGE_KEY]).toBe('570');
  });

  it('supports keyboard navigation with Arrow keys and Home to reset', () => {
    initTranscribeLayoutResizer();
    const onKeyDown = registeredListeners['keydown'][0];

    // ArrowRight in LTR increases width by 20px
    const rightEvt = { key: 'ArrowRight', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onKeyDown(rightEvt);
    expect(getTranscribeLeftPanelWidth()).toBe(440);
    expect(rightEvt.preventDefault).toHaveBeenCalled();
    expect(rightEvt.stopPropagation).toHaveBeenCalled();

    // Shift + ArrowRight increases width by 48px
    const shiftRightEvt = { key: 'ArrowRight', shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onKeyDown(shiftRightEvt);
    expect(getTranscribeLeftPanelWidth()).toBe(488);
    expect(shiftRightEvt.stopPropagation).toHaveBeenCalled();

    // ArrowLeft decreases width
    const leftEvt = { key: 'ArrowLeft', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onKeyDown(leftEvt);
    expect(getTranscribeLeftPanelWidth()).toBe(468);
    expect(leftEvt.stopPropagation).toHaveBeenCalled();

    // Home resets to default 420px
    const homeEvt = { key: 'Home', shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onKeyDown(homeEvt);
    expect(getTranscribeLeftPanelWidth()).toBe(DEFAULT_LEFT_PANEL_WIDTH);
    expect(homeEvt.stopPropagation).toHaveBeenCalled();
  });

  it('updates transcript viewer card responsive classes based on card width', () => {
    const viewerCard = globalThis.document.getElementById('transcribe-viewer-card');

    // Wide state (> 860px)
    updateTranscriptViewerResponsive(920);
    expect(viewerCard.classList.contains('is-compact')).toBe(false);
    expect(viewerCard.classList.contains('is-ultra-compact')).toBe(false);

    // Compact state (640px - 860px)
    updateTranscriptViewerResponsive(750);
    expect(viewerCard.classList.contains('is-compact')).toBe(true);
    expect(viewerCard.classList.contains('is-ultra-compact')).toBe(false);

    // Ultra-compact state (< 640px)
    updateTranscriptViewerResponsive(580);
    expect(viewerCard.classList.contains('is-compact')).toBe(true);
    expect(viewerCard.classList.contains('is-ultra-compact')).toBe(true);
  });
});
