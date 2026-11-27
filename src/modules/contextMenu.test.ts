import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage, t } from '../i18n/index';
import {
  _resetContextMenuForTest,
  closeContextMenu,
  getActiveSelectionTextForTarget,
  handleContextMenuShortcut,
  handleGlobalContextMenu,
  isContextMenuOpen,
  isNativeEditableTarget,
  isPreservedCustomContextTarget,
  openContextMenuAt,
  resolveContextMenuEntries,
  selectAllTextInElement,
  setupContextMenu,
  stripBidiMarks
} from './contextMenu';

class MockClassList {
  private set = new Set<string>();
  constructor(private syncAttr: () => void) {}
  add(...tokens: string[]) {
    for (const t of tokens) if (t) this.set.add(t);
    this.syncAttr();
  }
  remove(...tokens: string[]) {
    for (const t of tokens) this.set.delete(t);
    this.syncAttr();
  }
  contains(token: string): boolean {
    return this.set.has(token);
  }
  setFromString(val: string) {
    this.set = new Set(String(val || '').split(/\s+/).filter(Boolean));
  }
  toString() {
    return Array.from(this.set).join(' ');
  }
}

class MockElement {
  public tagName: string;
  public id = '';
  public type = '';
  public value = '';
  public disabled = false;
  public isContentEditable = false;
  public tabIndex = 0;
  public offsetWidth = 210;
  public offsetHeight = 140;
  public nodeType = 1;
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentNode: MockElement | null = null;
  public parentElement: MockElement | null = null;
  public classList: MockClassList;
  public listeners: Record<string, Array<(e: any) => void>> = {};
  private attrs = new Map<string, string>();
  private _text = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new MockClassList(() => {
      this.attrs.set('class', this.classList.toString());
    });
  }

  set className(val: string) {
    this.classList.setFromString(val);
    this.attrs.set('class', val);
  }
  get className(): string {
    return this.classList.toString();
  }

  set textContent(val: string | null) {
    this._text = val ?? '';
  }
  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map(c => c.textContent).join('');
  }

  set innerHTML(_val: string) {
    // No-op for SVG inner paths in mock
  }

  setAttribute(name: string, val: string) {
    const strVal = String(val);
    this.attrs.set(name, strVal);
    if (name === 'id') this.id = strVal;
    if (name === 'class') this.classList.setFromString(strVal);
    if (name === 'type') this.type = strVal;
    if (name.startsWith('data-')) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = strVal;
    }
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    if (child.parentNode) {
      child.parentNode.children = child.parentNode.children.filter(c => c !== child);
    }
    child.parentNode = this;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes: MockElement[]) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
      this.parentElement = null;
    }
  }

  contains(other: MockElement | null): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  matchesSingle(sel: string): boolean {
    const s = sel.trim();
    if (!s) return false;
    if (s.startsWith('#')) {
      const parts = s.split('.');
      if (this.id !== parts[0].slice(1)) return false;
      for (const cls of parts.slice(1)) {
        if (!this.classList.contains(cls)) return false;
      }
      return true;
    }
    if (s.startsWith('.')) {
      const clsList = s.slice(1).split('.');
      return clsList.every(c => this.classList.contains(c));
    }
    if (s === '[contenteditable="true"]') {
      return this.isContentEditable || this.getAttribute('contenteditable') === 'true';
    }
    const dotParts = s.split('.');
    if (this.tagName !== dotParts[0].toUpperCase()) return false;
    return dotParts.slice(1).every(c => this.classList.contains(c));
  }

  matches(selector: string): boolean {
    // Support simple comma-separated or descendant (two-part) selectors cleanly
    const parts = selector.split(',').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const tokens = part.split(/\s+/);
      if (tokens.length === 1) {
        if (this.matchesSingle(tokens[0])) return true;
      } else if (tokens.length === 2) {
        if (this.matchesSingle(tokens[1])) {
          let p = this.parentElement;
          while (p) {
            if (p.matchesSingle(tokens[0])) return true;
            p = p.parentElement;
          }
        }
      }
    }
    return false;
  }

  closest(selector: string): MockElement | null {
    const groupParts = selector.split(',').map(p => p.trim()).filter(Boolean);
    let cur: MockElement | null = this;
    while (cur) {
      for (const part of groupParts) {
        if (part === '.has-file' && cur.classList.contains('has-file')) return cur;
        if (cur.matches(part)) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const cleanSel = selector.replace(/:not\(:disabled\)/g, '');
    const onlyEnabled = selector.includes(':not(:disabled)');
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (child.matches(cleanSel) && (!onlyEnabled || !child.disabled)) {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type: string, fn: (e: any) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(ev: any) {
    if (!ev.target) ev.target = this;
    let stopped = false;
    const origStop = ev.stopPropagation;
    ev.stopPropagation = () => {
      stopped = true;
      if (typeof origStop === 'function') origStop();
    };
    const list = this.listeners[ev.type] || [];
    for (const fn of list) fn(ev);
    if (!stopped && this.parentElement) {
      this.parentElement.dispatchEvent(ev);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, stopPropagation: vi.fn(), preventDefault: vi.fn() });
  }

  focus() {
    (globalThis as any).document.activeElement = this;
  }

  blur() {
    const doc = (globalThis as any).document;
    if (doc && doc.activeElement === this) {
      doc.activeElement = doc.body || null;
    }
  }

  getBoundingClientRect() {
    return { width: 210, height: 140, top: 0, left: 0 };
  }
}

describe('contextMenu', () => {
  let docListeners: Record<string, Array<(e: any) => void>> = {};
  let winListeners: Record<string, Array<(e: any) => void>> = {};
  let bodyEl: MockElement;
  let docEl: MockElement;
  let selectionState: { text: string; ancestor: MockElement | null };
  let copySpy: ReturnType<typeof vi.fn>;
  let notifySpy: ReturnType<typeof vi.fn>;
  let origDoc: any;
  let origWin: any;

  beforeEach(() => {
    origDoc = (globalThis as any).document;
    origWin = (globalThis as any).window;
    _resetContextMenuForTest();
    docListeners = {};
    winListeners = {};
    selectionState = { text: '', ancestor: null };

    docEl = new MockElement('HTML');
    docEl.setAttribute('dir', 'ltr');
    bodyEl = new MockElement('BODY');

    const findById = (root: MockElement, id: string): MockElement | null => {
      if (root.id === id) return root;
      for (const c of root.children) {
        const hit = findById(c, id);
        if (hit) return hit;
      }
      return null;
    };

    const mockDocument = {
      documentElement: docEl,
      body: bodyEl,
      activeElement: null as MockElement | null,
      fullscreenElement: null as MockElement | null,
      createElement: (tag: string) => new MockElement(tag),
      createElementNS: (_ns: string, tag: string) => new MockElement(tag),
      createRange: () => ({
        _node: null as MockElement | null,
        selectNodeContents(node: MockElement) {
          this._node = node;
        },
        get commonAncestorContainer() {
          return this._node;
        }
      }),
      getElementById: (id: string) => findById(bodyEl, id),
      querySelector: (sel: string) => bodyEl.querySelector(sel),
      querySelectorAll: (sel: string) => bodyEl.querySelectorAll(sel),
      addEventListener: (type: string, fn: (e: any) => void) => {
        docListeners[type] = docListeners[type] || [];
        docListeners[type].push(fn);
      },
      dispatchEvent: (ev: any) => {
        for (const fn of docListeners[ev.type] || []) fn(ev);
      }
    };

    copySpy = vi.fn().mockResolvedValue(undefined);
    notifySpy = vi.fn();

    const mockWindow: any = {
      innerWidth: 1280,
      innerHeight: 720,
      copyToClipboard: copySpy,
      showNotification: notifySpy,
      getSelection: () => ({
        rangeCount: selectionState.text ? 1 : 0,
        isCollapsed: !selectionState.text,
        toString: () => selectionState.text,
        removeAllRanges: () => {
          selectionState = { text: '', ancestor: null };
        },
        addRange: (range: any) => {
          selectionState = {
            text: range._node?.textContent || '',
            ancestor: range._node || null
          };
        },
        getRangeAt: () => ({
          commonAncestorContainer: selectionState.ancestor,
          intersectsNode: (node: MockElement) => Boolean(selectionState.ancestor?.contains(node) || node.contains(selectionState.ancestor)),
          getBoundingClientRect: () => selectionState.ancestor?.getBoundingClientRect?.() ?? { width: 100, height: 20, top: 40, left: 40, right: 140, bottom: 60 }
        })
      }),
      addEventListener: (type: string, fn: (e: any) => void) => {
        winListeners[type] = winListeners[type] || [];
        winListeners[type].push(fn);
      },
      dispatchEvent: (ev: any) => {
        for (const fn of winListeners[ev.type] || []) fn(ev);
      }
    };

    (globalThis as any).document = mockDocument;
    (globalThis as any).window = mockWindow;
    setLanguage('en');
  });

  afterEach(() => {
    _resetContextMenuForTest();
    (globalThis as any).document = origDoc;
    (globalThis as any).window = origWin;
    vi.restoreAllMocks();
  });

  it('distinguishes native text inputs from non-text inputs and preserved speed buttons', () => {
    const txt = new MockElement('INPUT');
    txt.type = 'text';
    const chk = new MockElement('INPUT');
    chk.type = 'checkbox';
    const rng = new MockElement('INPUT');
    rng.type = 'range';
    const clr = new MockElement('INPUT');
    clr.type = 'color';
    const area = new MockElement('TEXTAREA');
    const ce = new MockElement('DIV');
    ce.isContentEditable = true;
    const ceChild = new MockElement('SPAN');
    ce.appendChild(ceChild);

    const compSpeed = new MockElement('BUTTON');
    compSpeed.id = 'btn-companion-speed';
    const hardsubSpeed = new MockElement('BUTTON');
    hardsubSpeed.id = 'hardsub-btn-speed';
    const hardsubSpan = new MockElement('SPAN');
    hardsubSpeed.appendChild(hardsubSpan);

    expect(isNativeEditableTarget(txt as any)).toBe(true);
    expect(isNativeEditableTarget(area as any)).toBe(true);
    expect(isNativeEditableTarget(ceChild as any)).toBe(true);
    expect(isNativeEditableTarget(chk as any)).toBe(false);
    expect(isNativeEditableTarget(rng as any)).toBe(false);
    expect(isNativeEditableTarget(clr as any)).toBe(false);

    expect(isPreservedCustomContextTarget(compSpeed as any)).toBe(true);
    expect(isPreservedCustomContextTarget(hardsubSpan as any)).toBe(true);
  });

  it('strips bidi isolate marks cleanly', () => {
    expect(stripBidiMarks('\u2066/home/user/video.mp4\u2069')).toBe('/home/user/video.mp4');
  });

  it('resolves log actions and copies reconstructed log lines cleanly', async () => {
    const viewport = new MockElement('DIV');
    viewport.id = 'log-viewport';
    const line = new MockElement('DIV');
    line.className = 'log-line';
    line.dataset.timestamp = '12:00:01';
    line.dataset.category = 'Whisper';
    const msg = new MockElement('SPAN');
    msg.className = 'log-msg';
    msg.textContent = 'Model loaded successfully';
    line.appendChild(msg);
    viewport.appendChild(line);
    bodyEl.appendChild(viewport);

    const entries = resolveContextMenuEntries(msg as any);
    expect(entries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'logs-copy-line',
      'logs-select-all',
      'logs-copy-all',
      'logs-clear-all'
    ]);

    const copyLine = entries.find(e => e.type === 'item' && e.spec.id === 'logs-copy-line') as any;
    await copyLine.spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('[12:00:01] [Whisper] Model loaded successfully');

    // Selecting text inside log message exposes Copy + Select All + bulk actions
    selectionState = { text: 'loaded', ancestor: msg };
    const selected = getActiveSelectionTextForTarget(msg as any);
    expect(selected).toBe('loaded');
    const selectedEntries = resolveContextMenuEntries(msg as any);
    expect((selectedEntries[0] as any).spec.id).toBe('copy-selection');
  });

  it('skips log bulk actions when only empty placeholder is present', () => {
    const viewport = new MockElement('DIV');
    viewport.id = 'log-viewport';
    const empty = new MockElement('DIV');
    empty.className = 'log-empty-state';
    viewport.appendChild(empty);
    bodyEl.appendChild(viewport);

    expect(resolveContextMenuEntries(viewport as any)).toEqual([]);
  });

  it('resolves file path actions for loaded single-file dropzone and skips batch summary', async () => {
    const dz = new MockElement('DIV');
    dz.id = 'transcribe-drop-zone';
    dz.className = 'has-file';
    dz.dataset.filePath = '/media/demo/interview.mp4';
    const lblName = new MockElement('H3');
    lblName.id = 'lbl-file-name';
    lblName.textContent = 'interview.mp4';
    const lblPath = new MockElement('P');
    lblPath.id = 'lbl-file-path';
    lblPath.textContent = '/media/demo/interview.mp4';
    dz.appendChild(lblName);
    dz.appendChild(lblPath);
    bodyEl.appendChild(dz);

    const entries = resolveContextMenuEntries(lblPath as any);
    expect(entries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'file-copy-path',
      'file-copy-name',
      'file-open-folder'
    ]);
    const openItem = entries.find(e => e.type === 'item' && e.spec.id === 'file-open-folder') as any;
    expect(openItem.spec.label).toBe(t('contextMenu.openContainingFolder'));
    expect(openItem.spec.label).not.toBe('transcribe.openOutputFolder');

    await (entries[0] as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('/media/demo/interview.mp4');

    dz.classList.add('is-batch-summary');
    expect(resolveContextMenuEntries(lblPath as any)).toEqual([]);
  });

  it('omits Copy File Name on custom output directories and ignores empty companion placeholder', () => {
    const outDir = new MockElement('DIV');
    outDir.id = 'transcribe-output-dir-text';
    outDir.className = 'has-custom-path';
    outDir.textContent = '/media/exports';
    bodyEl.appendChild(outDir);

    const dirEntries = resolveContextMenuEntries(outDir as any);
    expect(dirEntries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'file-copy-path',
      'file-open-folder'
    ]);
    expect((dirEntries.find(e => e.type === 'item' && e.spec.id === 'file-open-folder') as any).spec.label).toBe(
      t('contextMenu.openOutputFolder')
    );

    const compEmpty = new MockElement('SPAN');
    compEmpty.id = 'companion-meta-filename';
    compEmpty.textContent = '—';
    bodyEl.appendChild(compEmpty);
    expect(resolveContextMenuEntries(compEmpty as any)).toEqual([]);
  });

  it('matches inline code inside setting-desc-point and detects Mac shortcut hints', () => {
    const point = new MockElement('SPAN');
    point.className = 'setting-desc-point';
    const code = new MockElement('CODE');
    code.textContent = 'ggml-silero-v6.2.0.bin';
    point.appendChild(code);
    bodyEl.appendChild(point);

    const entries = resolveContextMenuEntries(code as any);
    expect(entries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'settings-copy-code'
    ]);

    const origNav = (globalThis as any).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' },
      configurable: true
    });
    try {
      selectionState = { text: 'ggml-silero', ancestor: code };
      const macEntries = resolveContextMenuEntries(code as any);
      expect((macEntries[0] as any).spec.shortcutHint).toBe('⌘C');
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: origNav,
        configurable: true
      });
    }
  });

  it('resolves transcript confidence view, translate cues, hardsub FFmpeg preview, modals, and toasts', async () => {
    // Transcript card with confidence view + hidden textarea
    const copyTransBtn = new MockElement('BUTTON');
    copyTransBtn.id = 'btn-copy-transcript';
    bodyEl.appendChild(copyTransBtn);

    const tCard = new MockElement('DIV');
    tCard.className = 'transcript-card';
    const tTime = new MockElement('DIV');
    tTime.className = 'transcript-card-time';
    const tTimeSpan = new MockElement('SPAN');
    tTimeSpan.textContent = '00:01:02 --> 00:01:05';
    tTime.appendChild(tTimeSpan);
    const playBtn = new MockElement('BUTTON');
    playBtn.className = 'btn-card-action btn-card-play';
    const playSpy = vi.fn();
    playBtn.addEventListener('click', playSpy);
    const ta = new MockElement('TEXTAREA');
    ta.className = 'transcript-text-input';
    ta.value = 'Hello confident world';
    const confView = new MockElement('DIV');
    confView.className = 'transcript-confidence-view';
    const confWord = new MockElement('SPAN');
    confWord.className = 'conf-word';
    confWord.textContent = 'Hello';
    confView.appendChild(confWord);
    tCard.appendChild(tTime);
    tCard.appendChild(playBtn);
    tCard.appendChild(ta);
    tCard.appendChild(confView);
    const tViewport = new MockElement('DIV');
    tViewport.id = 'transcript-viewport';
    tViewport.appendChild(tCard);
    bodyEl.appendChild(tViewport);

    const tEntries = resolveContextMenuEntries(confWord as any);
    expect(tEntries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'transcript-select-segment',
      'transcript-copy-segment',
      'transcript-copy-timestamp',
      'transcript-play-segment',
      'transcript-copy-all'
    ]);
    await (tEntries.find(e => e.type === 'item' && e.spec.id === 'transcript-copy-segment') as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('Hello confident world');
    (tEntries.find(e => e.type === 'item' && e.spec.id === 'transcript-play-segment') as any).spec.onSelect();
    expect(playSpy).toHaveBeenCalledTimes(1);

    // Translate cue item
    const copyTransSubBtn = new MockElement('BUTTON');
    copyTransSubBtn.id = 'btn-copy-translated';
    bodyEl.appendChild(copyTransSubBtn);
    const cueItem = new MockElement('DIV');
    cueItem.className = 'translate-cue-item';
    const cueTime = new MockElement('SPAN');
    cueTime.className = 'translate-cue-time';
    cueTime.textContent = '00:00:01.000 ➔ 00:00:03.000';
    const cueText = new MockElement('DIV');
    cueText.className = 'translate-cue-text';
    cueText.textContent = 'سلام دنیا';
    cueItem.appendChild(cueTime);
    cueItem.appendChild(cueText);
    bodyEl.appendChild(cueItem);
    const cueEntries = resolveContextMenuEntries(cueText as any);
    expect(cueEntries.filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'translate-copy-cue',
      'translate-copy-timestamp',
      'translate-copy-all'
    ]);
    await (cueEntries.find(e => e.type === 'item' && e.spec.id === 'translate-copy-cue') as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('سلام دنیا');

    // Settings test result & model ID
    const testResult = new MockElement('DIV');
    testResult.id = 'test-modal-result';
    testResult.textContent = 'HTTP 200 OK';
    bodyEl.appendChild(testResult);
    expect(resolveContextMenuEntries(testResult as any).filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'test-result-select-all',
      'test-result-copy-all'
    ]);

    const modelIdEl = new MockElement('SPAN');
    modelIdEl.className = 'model-id-display';
    modelIdEl.textContent = 'gpt-4o-mini';
    bodyEl.appendChild(modelIdEl);
    expect(resolveContextMenuEntries(modelIdEl as any).filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'model-copy-id'
    ]);

    // Modal details box & About version
    const detailsBox = new MockElement('PRE');
    detailsBox.id = 'app-modal-details';
    detailsBox.textContent = 'Error: ENOENT';
    bodyEl.appendChild(detailsBox);
    expect(resolveContextMenuEntries(detailsBox as any).filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'modal-select-all',
      'modal-copy-message'
    ]);

    const aboutVer = new MockElement('SPAN');
    aboutVer.id = 'about-modal-version-text';
    aboutVer.textContent = 'v3.1.0';
    bodyEl.appendChild(aboutVer);
    expect(resolveContextMenuEntries(aboutVer as any).filter(e => e.type === 'item').map(e => (e as any).spec.id)).toEqual([
      'about-copy-info'
    ]);

    // Hardsub FFmpeg command preview
    const ffmpeg = new MockElement('DIV');
    ffmpeg.id = 'hardsub-ffmpeg-cmd-preview';
    ffmpeg.textContent = 'ffmpeg -i video.mp4 out.mp4';
    bodyEl.appendChild(ffmpeg);
    const ffEntries = resolveContextMenuEntries(ffmpeg as any);
    await (ffEntries.find(e => e.type === 'item' && e.spec.id === 'hardsub-copy-ffmpeg') as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('ffmpeg -i video.mp4 out.mp4');

    // Toast notification
    const toast = new MockElement('DIV');
    toast.className = 'toast-notification';
    const tech = new MockElement('DIV');
    tech.className = 'toast-tech-detail';
    tech.textContent = 'Connection refused';
    toast.appendChild(tech);
    bodyEl.appendChild(toast);
    const toastEntries = resolveContextMenuEntries(tech as any);
    await (toastEntries.find(e => e.type === 'item' && e.spec.id === 'toast-copy-message') as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('Connection refused');
  });

  it('opens in RTL Persian mode, prevents default outside editable inputs, and closes on Escape', () => {
    setupContextMenu();
    setLanguage('fa');
    docEl.setAttribute('dir', 'rtl');

    const msgEl = new MockElement('DIV');
    msgEl.id = 'app-modal-message';
    msgEl.textContent = 'خطای اتصال به سرور';
    bodyEl.appendChild(msgEl);

    let prevented = false;
    handleGlobalContextMenu({
      defaultPrevented: false,
      target: msgEl,
      clientX: 300,
      clientY: 200,
      preventDefault: () => {
        prevented = true;
      }
    } as any);

    expect(prevented).toBe(true);
    expect(isContextMenuOpen()).toBe(true);

    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.getAttribute('aria-label')).toBe('منوی زمینه');
    expect(menuEl.textContent).toContain('کپی پیام');

    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    expect(isContextMenuOpen()).toBe(false);
  });

  it('allows native OS menu on textareas and suppresses browser menu on empty chrome', () => {
    setupContextMenu();

    const ta = new MockElement('TEXTAREA');
    let taPrevented = false;
    handleGlobalContextMenu({
      defaultPrevented: false,
      target: ta,
      preventDefault: () => {
        taPrevented = true;
      }
    } as any);
    expect(taPrevented).toBe(false);
    expect(isContextMenuOpen()).toBe(false);

    const chrome = new MockElement('DIV');
    let chromePrevented = false;
    handleGlobalContextMenu({
      defaultPrevented: false,
      target: chrome,
      preventDefault: () => {
        chromePrevented = true;
      }
    } as any);
    expect(chromePrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(false);
  });

  it('supports generic Copy fallback when arbitrary selectable text is highlighted and keyboard arrow navigation', async () => {
    const note = new MockElement('P');
    note.textContent = 'Custom copyable snippet';
    bodyEl.appendChild(note);

    expect(selectAllTextInElement(note as any)).toBe(true);
    const entries = resolveContextMenuEntries(note as any);
    expect(entries).toHaveLength(1);
    await (entries[0] as any).spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('Custom copyable snippet');
    expect(notifySpy).not.toHaveBeenCalled();

    setupContextMenu();
    openContextMenuAt(
      100,
      100,
      [
        { type: 'item', spec: { id: 'first', label: 'First', icon: 'copy', onSelect: vi.fn() } },
        { type: 'separator' },
        { type: 'item', spec: { id: 'second', label: 'Second', icon: 'folder', onSelect: vi.fn() } }
      ],
      true
    );

    const buttons = (document as any).querySelectorAll('.app-context-menu__item');
    expect((document as any).activeElement).toBe(buttons[0]);

    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    expect((document as any).activeElement).toBe(buttons[1]);

    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'Home',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    expect((document as any).activeElement).toBe(buttons[0]);

    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'End',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    expect((document as any).activeElement).toBe(buttons[1]);
  });

  it('normalizes position for CSS zoom, flips transform-origin at edges, and supports Shift+F10 keyboard menu', () => {
    setupContextMenu();
    docEl.style.zoom = '1.25';

    // Simulate near-bottom-right corner click in zoomed coordinates
    openContextMenuAt(
      1260,
      710,
      [{ type: 'item', spec: { id: 'one', label: 'Action', icon: 'copy', onSelect: vi.fn() } }],
      false
    );
    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.style.transformOrigin).toBe('bottom right');
    expect(parseInt(menuEl.style.left, 10)).toBeLessThanOrEqual(Math.round(1280 / 1.25) - 210);
    expect(parseInt(menuEl.style.top, 10)).toBeLessThanOrEqual(Math.round(720 / 1.25) - 140);
    closeContextMenu();
    docEl.style.zoom = '';

    // Shift+F10 on a focusable modal details box opens menu with keyboard focus and Tab restores focus
    const details = new MockElement('PRE');
    details.id = 'app-modal-details';
    details.tabIndex = 0;
    details.textContent = 'Detailed stack trace';
    details.getBoundingClientRect = () => ({ width: 300, height: 80, top: 100, left: 50, right: 350, bottom: 180 } as any);
    bodyEl.appendChild(details);
    details.focus();

    let prevented = false;
    handleContextMenuShortcut({
      defaultPrevented: false,
      key: 'F10',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: details,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: vi.fn()
    } as any);

    expect(prevented).toBe(true);
    expect(isContextMenuOpen()).toBe(true);
    const firstItem = (document as any).querySelector('.app-context-menu__item');
    expect((document as any).activeElement).toBe(firstItem);

    // Tab while opened by keyboard closes menu, stops propagation to modal trap, and restores focus to triggering element
    let tabPrevented = false;
    let tabStopped = false;
    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault: () => {
        tabPrevented = true;
      },
      stopPropagation: () => {
        tabStopped = true;
      }
    });
    expect(tabPrevented).toBe(true);
    expect(tabStopped).toBe(true);
    expect(isContextMenuOpen()).toBe(false);
    expect((document as any).activeElement).toBe(details);
  });

  it('mounts inside fullscreenElement during native fullscreen and restores to body on exit', () => {
    setupContextMenu();
    const fsHost = new MockElement('DIV');
    fsHost.id = 'companion-console';
    bodyEl.appendChild(fsHost);
    (document as any).fullscreenElement = fsHost;

    openContextMenuAt(
      120,
      140,
      [{ type: 'item', spec: { id: 'fs-copy', label: 'Copy Timecode', icon: 'clock', onSelect: vi.fn() } }],
      false,
      fsHost as any
    );

    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.parentNode).toBe(fsHost);
    expect(fsHost.children).toContain(menuEl);

    (document as any).fullscreenElement = null;
    (document as any).dispatchEvent({ type: 'fullscreenchange' });
    expect(isContextMenuOpen()).toBe(false);
    expect(menuEl.parentNode).toBe(bodyEl);
  });

  it('restores focus when executing a keyboard-opened menu item, clears keyboard-nav on mousemove, and blurs hidden focus', () => {
    setupContextMenu();
    const details = new MockElement('PRE');
    details.id = 'app-modal-details';
    details.tabIndex = 0;
    details.textContent = 'Stack trace';
    bodyEl.appendChild(details);
    details.focus();

    const selectSpy = vi.fn();
    openContextMenuAt(
      80,
      80,
      [{ type: 'item', spec: { id: 'act', label: 'Select All', icon: 'selectAll', onSelect: selectSpy } }],
      true,
      details as any
    );

    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);
    const btn = (document as any).querySelector('.app-context-menu__item');
    expect((document as any).activeElement).toBe(btn);

    btn.click();
    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(false);
    expect(menuEl.getAttribute('aria-hidden')).toBe('true');
    expect((document as any).activeElement).toBe(details);

    // Mousemove removes is-keyboard-nav; if previousFocus is unfocusable, closing blurs focus out of hidden menu
    openContextMenuAt(
      80,
      80,
      [{ type: 'item', spec: { id: 'act2', label: 'Copy', icon: 'copy', onSelect: vi.fn() } }],
      true
    );
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);
    menuEl.dispatchEvent({ type: 'mousemove' });
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(false);
    closeContextMenu();
    expect(menuEl.contains((document as any).activeElement)).toBe(false);
  });

  it('prevents native browser menu on preserved speed button, skips card action buttons, pauses toast timer, and survives log auto-scroll', () => {
    setupContextMenu();

    // Preserved speed button should always prevent raw browser menu even if its own handler returned early
    const speedBtn = new MockElement('BUTTON');
    speedBtn.id = 'hardsub-btn-speed';
    bodyEl.appendChild(speedBtn);
    let speedPrevented = false;
    handleGlobalContextMenu({
      defaultPrevented: false,
      target: speedBtn,
      preventDefault: () => {
        speedPrevented = true;
      }
    } as any);
    expect(speedPrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(false);

    // Right-clicking an action button inside transcript card does not open transcript card menu
    const card = new MockElement('DIV');
    card.className = 'transcript-card';
    const delBtn = new MockElement('BUTTON');
    delBtn.className = 'btn-card-action';
    card.appendChild(delBtn);
    bodyEl.appendChild(card);
    expect(resolveContextMenuEntries(delBtn as any)).toEqual([]);

    // Opening on a toast pauses its timer and closing resumes it
    const toast = new MockElement('DIV') as any;
    toast.className = 'toast-notification';
    const toastMsg = new MockElement('DIV');
    toastMsg.className = 'toast-message';
    toastMsg.textContent = 'Saved successfully';
    toast.appendChild(toastMsg);
    toast._pauseForContextMenu = vi.fn();
    toast._resumeAfterContextMenu = vi.fn();
    bodyEl.appendChild(toast);

    handleGlobalContextMenu({
      defaultPrevented: false,
      target: toastMsg,
      clientX: 200,
      clientY: 200,
      preventDefault: vi.fn()
    } as any);
    expect(isContextMenuOpen()).toBe(true);
    expect(toast.dataset.contextMenuActive).toBe('true');
    expect(toast._pauseForContextMenu).toHaveBeenCalledTimes(1);
    closeContextMenu();
    expect(toast.dataset.contextMenuActive).toBeUndefined();
    expect(toast._resumeAfterContextMenu).toHaveBeenCalledTimes(1);

    // Live auto-scroll inside #log-viewport keeps the menu open, while wheel closes it
    const logVp = new MockElement('DIV');
    logVp.id = 'log-viewport';
    const logLine = new MockElement('DIV');
    logLine.className = 'log-line';
    logLine.dataset.timestamp = '12:00:00';
    logLine.dataset.category = 'App';
    const msg = new MockElement('SPAN');
    msg.className = 'log-msg';
    msg.textContent = 'Streaming log';
    logLine.appendChild(msg);
    logVp.appendChild(logLine);
    bodyEl.appendChild(logVp);

    handleGlobalContextMenu({
      defaultPrevented: false,
      target: msg,
      clientX: 150,
      clientY: 150,
      preventDefault: vi.fn()
    } as any);
    expect(isContextMenuOpen()).toBe(true);
    (document as any).dispatchEvent({ type: 'scroll', target: logVp });
    expect(isContextMenuOpen()).toBe(true);
    (document as any).dispatchEvent({ type: 'wheel', target: logVp });
    expect(isContextMenuOpen()).toBe(false);

    // Shift+F10 when focus is on body but text is selected resolves the selection's menu
    const note = new MockElement('P');
    note.textContent = 'Highlighted snippet';
    bodyEl.appendChild(note);
    bodyEl.focus();
    selectAllTextInElement(note as any);
    let selPrevented = false;
    handleContextMenuShortcut({
      defaultPrevented: false,
      key: 'F10',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: bodyEl,
      preventDefault: () => {
        selPrevented = true;
      },
      stopPropagation: vi.fn()
    } as any);
    expect(selPrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(true);
  });

  it('skips buttons inside batch cards, dropzones, and generic selection fallback', () => {
    // Batch queue card action buttons must not open the file path menu
    const batchCard = new MockElement('DIV');
    batchCard.className = 'batch-queue-card';
    batchCard.dataset.path = '/media/clip.mp4';
    batchCard.dataset.name = 'clip.mp4';
    const removeBtn = new MockElement('BUTTON');
    removeBtn.className = 'btn-batch-action btn-remove-batch';
    batchCard.appendChild(removeBtn);
    bodyEl.appendChild(batchCard);

    expect(resolveContextMenuEntries(batchCard as any).length).toBeGreaterThan(0);
    expect(resolveContextMenuEntries(removeBtn as any)).toEqual([]);

    // Dropzone action buttons (Browse/Clear) must not open file path menu
    const dz = new MockElement('DIV');
    dz.id = 'transcribe-drop-zone';
    dz.className = 'has-file';
    dz.dataset.filePath = '/media/clip.mp4';
    const clearBtn = new MockElement('BUTTON');
    clearBtn.id = 'btn-clear-media';
    dz.appendChild(clearBtn);
    bodyEl.appendChild(dz);

    expect(resolveContextMenuEntries(dz as any).length).toBeGreaterThan(0);
    expect(resolveContextMenuEntries(clearBtn as any)).toEqual([]);

    // Generic selection fallback must not leak onto buttons inside a selected card
    const tCard = new MockElement('DIV');
    tCard.className = 'transcript-card';
    tCard.textContent = 'Selected card snippet';
    const playBtn = new MockElement('BUTTON');
    playBtn.className = 'btn-card-action btn-card-play';
    tCard.appendChild(playBtn);
    bodyEl.appendChild(tCard);

    selectAllTextInElement(tCard as any);
    expect(resolveContextMenuEntries(playBtn as any)).toEqual([]);
  });

  it('restores focus when navigating a mouse-opened menu with keyboard and prevents hover/focus competition', () => {
    setupContextMenu();

    const triggerBtn = new MockElement('BUTTON');
    triggerBtn.id = 'trigger-btn';
    bodyEl.appendChild(triggerBtn);
    triggerBtn.focus();

    const itemSpy = vi.fn();
    openContextMenuAt(
      120,
      120,
      [
        { type: 'item', spec: { id: 'one', label: 'First', icon: 'copy', onSelect: itemSpy } },
        { type: 'item', spec: { id: 'two', label: 'Second', icon: 'folder', onSelect: vi.fn() } }
      ],
      false,
      triggerBtn as any
    );

    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(false);
    expect((document as any).activeElement).toBe(triggerBtn);

    // ArrowDown enters keyboard navigation and moves focus into menu item
    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    const buttons = (document as any).querySelectorAll('.app-context-menu__item');
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);
    expect(buttons[0].classList.contains('is-focused')).toBe(true);
    expect((document as any).activeElement).toBe(buttons[0]);

    // Tab after keyboard navigation stops propagation and restores focus to triggerBtn
    let tabStopped = false;
    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault: vi.fn(),
      stopPropagation: () => {
        tabStopped = true;
      }
    });
    expect(tabStopped).toBe(true);
    expect(isContextMenuOpen()).toBe(false);
    expect((document as any).activeElement).toBe(triggerBtn);

    // Re-open with mouse, navigate with ArrowDown, then click via Enter/click -> restores focus
    openContextMenuAt(
      140,
      140,
      [{ type: 'item', spec: { id: 'one', label: 'First', icon: 'copy', onSelect: itemSpy } }],
      false,
      triggerBtn as any
    );
    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    const activeBtn = (document as any).querySelector('.app-context-menu__item');
    activeBtn.click();
    expect(itemSpy).toHaveBeenCalledTimes(1);
    expect((document as any).activeElement).toBe(triggerBtn);

    // Synthetic zero-delta mousemove keeps keyboard nav; real pointer movement clears .is-focused & moves focus off item
    openContextMenuAt(
      140,
      140,
      [{ type: 'item', spec: { id: 'one', label: 'First', icon: 'copy', onSelect: vi.fn() } }],
      true,
      triggerBtn as any
    );
    const kbdBtn = (document as any).querySelector('.app-context-menu__item');
    expect(kbdBtn.classList.contains('is-focused')).toBe(true);

    menuEl.dispatchEvent({ type: 'mousemove', clientX: 150, clientY: 150, movementX: 0, movementY: 0 });
    menuEl.dispatchEvent({ type: 'mousemove', clientX: 150, clientY: 150, movementX: 0, movementY: 0 });
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);

    menuEl.dispatchEvent({ type: 'mousemove', clientX: 170, clientY: 165, movementX: 20, movementY: 15 });
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(false);
    expect(kbdBtn.classList.contains('is-focused')).toBe(false);
    expect((document as any).activeElement).toBe(menuEl);
  });

  it('replays open state cleanly when reopened while already open, clamps zoom bounds, and omits empty log prefix brackets', async () => {
    setupContextMenu();
    docEl.style.zoom = '2';

    openContextMenuAt(
      100,
      100,
      [{ type: 'item', spec: { id: 'a', label: 'Alpha', icon: 'copy', onSelect: vi.fn() } }],
      false
    );
    const menuEl = (document as any).getElementById('app-context-menu');
    expect(menuEl.style.maxWidth).toBe('300px');
    expect(menuEl.style.maxHeight).toBe('344px');

    // Reopening while already open resets entrance cleanly and preserves transition
    openContextMenuAt(
      200,
      180,
      [{ type: 'item', spec: { id: 'b', label: 'Beta', icon: 'copy', onSelect: vi.fn() } }],
      false
    );
    expect(menuEl.classList.contains('open')).toBe(true);
    expect(menuEl.style.transition).toBe('');
    docEl.style.zoom = '';

    // Log line without timestamp should not emit empty '[]'
    const logVp = new MockElement('DIV');
    logVp.id = 'log-viewport';
    const logLine = new MockElement('DIV');
    logLine.className = 'log-line';
    logLine.dataset.category = 'App';
    const msg = new MockElement('SPAN');
    msg.className = 'log-msg';
    msg.textContent = 'Ready';
    logLine.appendChild(msg);
    logVp.appendChild(logLine);
    bodyEl.appendChild(logVp);

    const entries = resolveContextMenuEntries(msg as any);
    const copyLine = entries.find(e => e.type === 'item' && e.spec.id === 'logs-copy-line') as any;
    await copyLine.spec.onSelect();
    expect(copySpy).toHaveBeenCalledWith('[App] Ready');
  });

  it('handles Shift+F10 selection fallback when a button holds focus, survives live transcript auto-scroll, skips hiding toasts, and avoids mouse focus hijack', () => {
    setupContextMenu();

    // 1. Focus on an unrelated button (e.g. modal OK button) while text in modal details is selected
    const okBtn = new MockElement('BUTTON');
    okBtn.id = 'app-modal-ok-btn';
    const detailsBox = new MockElement('PRE');
    detailsBox.id = 'app-modal-details';
    detailsBox.textContent = 'Detailed error trace line';
    bodyEl.appendChild(detailsBox);
    bodyEl.appendChild(okBtn);
    okBtn.focus();
    selectAllTextInElement(detailsBox as any);

    let fallbackPrevented = false;
    handleContextMenuShortcut({
      defaultPrevented: false,
      key: 'F10',
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: okBtn,
      preventDefault: () => {
        fallbackPrevented = true;
      },
      stopPropagation: vi.fn()
    } as any);
    expect(fallbackPrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(true);
    const modalMenuIds = (document as any)
      .querySelectorAll('.app-context-menu__item')
      .map((el: any) => el.dataset.menuId);
    expect(modalMenuIds).toContain('copy-selection');
    expect(modalMenuIds).toContain('modal-copy-message');
    closeContextMenu({ restoreFocus: true });

    // 2. Live transcription auto-scroll inside #transcript-viewport keeps menu open, while wheel closes it
    const transcriptVp = new MockElement('DIV');
    transcriptVp.id = 'transcript-viewport';
    const tCard = new MockElement('DIV');
    tCard.className = 'transcript-card';
    const tTimeWrap = new MockElement('DIV');
    tTimeWrap.className = 'transcript-card-time';
    const tTimeSpan = new MockElement('SPAN');
    tTimeSpan.textContent = '00:01 - 00:03';
    tTimeWrap.appendChild(tTimeSpan);
    tCard.appendChild(tTimeWrap);
    transcriptVp.appendChild(tCard);
    bodyEl.appendChild(transcriptVp);

    handleGlobalContextMenu({
      defaultPrevented: false,
      target: tTimeSpan,
      clientX: 160,
      clientY: 160,
      preventDefault: vi.fn()
    } as any);
    expect(isContextMenuOpen()).toBe(true);
    (document as any).dispatchEvent({ type: 'scroll', target: transcriptVp });
    expect(isContextMenuOpen()).toBe(true);
    (document as any).dispatchEvent({ type: 'wheel', target: transcriptVp });
    expect(isContextMenuOpen()).toBe(false);

    // 3. Toast already fading out (.hide) must not open a context menu or get paused
    const hidingToast = new MockElement('DIV') as any;
    hidingToast.className = 'toast-notification hide';
    const hidingMsg = new MockElement('DIV');
    hidingMsg.className = 'toast-message';
    hidingMsg.textContent = 'Dismissing toast';
    hidingToast.appendChild(hidingMsg);
    bodyEl.appendChild(hidingToast);
    expect(resolveContextMenuEntries(hidingMsg as any)).toEqual([]);

    // 4. Mouse-opened -> ArrowDown -> mousemove back to pointer -> mouse click must NOT hijack focus back
    const outsideBtn = new MockElement('BUTTON');
    outsideBtn.id = 'outside-focus-btn';
    const anotherBtn = new MockElement('BUTTON');
    anotherBtn.id = 'another-btn';
    bodyEl.appendChild(outsideBtn);
    bodyEl.appendChild(anotherBtn);
    outsideBtn.focus();

    const mouseActionSpy = vi.fn();
    openContextMenuAt(
      140,
      140,
      [{ type: 'item', spec: { id: 'mouse-act', label: 'Action', icon: 'copy', onSelect: mouseActionSpy } }],
      false,
      anotherBtn as any
    );
    const menuEl = (document as any).getElementById('app-context-menu');

    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    });
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);

    // Move mouse back onto menu -> exits keyboard nav & clears _keyboardFocusActive
    menuEl.dispatchEvent({ type: 'mousemove', clientX: 175, clientY: 160, movementX: 12, movementY: 8 });
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(false);
    expect((document as any).activeElement).toBe(menuEl);

    const itemBtn = (document as any).querySelector('.app-context-menu__item');
    itemBtn.dispatchEvent({ type: 'click', target: itemBtn, detail: 1, stopPropagation: vi.fn(), preventDefault: vi.fn() });
    expect(mouseActionSpy).toHaveBeenCalledTimes(1);
    expect((document as any).activeElement).not.toBe(outsideBtn);
  });

  it('contains keyboard modality (ArrowLeft/Right, Space/Enter, single-key hotkeys), supports type-ahead, and keeps scrollbar draggable', () => {
    setupContextMenu();

    const bgBtn = new MockElement('BUTTON');
    bgBtn.id = 'bg-action-btn';
    bodyEl.appendChild(bgBtn);
    bgBtn.focus();

    const copySpyAction = vi.fn();
    const folderSpyAction = vi.fn();
    openContextMenuAt(
      120,
      120,
      [
        { type: 'item', spec: { id: 'copy-item', label: 'Copy Line', icon: 'copy', onSelect: copySpyAction } },
        { type: 'item', spec: { id: 'copy-all', label: 'Copy All', icon: 'clipboardList', onSelect: vi.fn() } },
        { type: 'item', spec: { id: 'open-dir', label: 'Open Folder', icon: 'folder', onSelect: folderSpyAction } }
      ],
      false
    );

    const menuEl = (document as any).getElementById('app-context-menu');

    // ArrowLeft/Right and single-key hotkeys (e.g. '?') must not leak behind open menu
    const arrowLeftEv = { type: 'keydown', key: 'ArrowLeft', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (document as any).dispatchEvent(arrowLeftEv);
    expect(arrowLeftEv.preventDefault).toHaveBeenCalledTimes(1);
    expect(arrowLeftEv.stopPropagation).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(true);

    const helpKeyEv = { type: 'keydown', key: '?', ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (document as any).dispatchEvent(helpKeyEv);
    expect(helpKeyEv.preventDefault).toHaveBeenCalledTimes(1);
    expect(helpKeyEv.stopPropagation).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(true);

    // Ctrl+C must pass through unblocked while menu is open
    const ctrlCEv = { type: 'keydown', key: 'c', ctrlKey: true, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (document as any).dispatchEvent(ctrlCEv);
    expect(ctrlCEv.stopPropagation).not.toHaveBeenCalled();

    // First-letter type-ahead jumps between matching items ('o' -> Open Folder, 'c' -> Copy Line -> Copy All)
    const buttons = (document as any).querySelectorAll('.app-context-menu__item');
    (document as any).dispatchEvent({ type: 'keydown', key: 'o', ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect((document as any).activeElement).toBe(buttons[2]);
    expect(menuEl.classList.contains('is-keyboard-nav')).toBe(true);

    (document as any).dispatchEvent({ type: 'keydown', key: 'c', ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect((document as any).activeElement).toBe(buttons[0]);
    (document as any).dispatchEvent({ type: 'keydown', key: 'c', ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect((document as any).activeElement).toBe(buttons[1]);

    // Space when mouse-opened (focus outside menu) closes menu and stops propagation so bgBtn/player is not triggered
    openContextMenuAt(
      120,
      120,
      [{ type: 'item', spec: { id: 'copy-item', label: 'Copy Line', icon: 'copy', onSelect: copySpyAction } }],
      false
    );
    bgBtn.focus();
    const spaceBgEv = { type: 'keydown', key: ' ', code: 'Space', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (document as any).dispatchEvent(spaceBgEv);
    expect(spaceBgEv.preventDefault).toHaveBeenCalledTimes(1);
    expect(spaceBgEv.stopPropagation).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(false);
    expect(copySpyAction).not.toHaveBeenCalled();

    // Enter when an item IS focused executes that item and stops propagation
    openContextMenuAt(
      120,
      120,
      [{ type: 'item', spec: { id: 'copy-item', label: 'Copy Line', icon: 'copy', onSelect: copySpyAction } }],
      true
    );
    const enterItemEv = { type: 'keydown', key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (document as any).dispatchEvent(enterItemEv);
    expect(enterItemEv.preventDefault).toHaveBeenCalledTimes(1);
    expect(enterItemEv.stopPropagation).toHaveBeenCalledTimes(1);
    expect(copySpyAction).toHaveBeenCalledTimes(1);
    expect(isContextMenuOpen()).toBe(false);

    // Scrollbar mousedown on overflowed menu container is not blocked, while item mousedown preserves selection
    openContextMenuAt(
      120,
      120,
      [{ type: 'item', spec: { id: 'copy-item', label: 'Copy Line', icon: 'copy', onSelect: vi.fn() } }],
      false
    );
    menuEl.clientWidth = 200;
    menuEl.clientLeft = 1;
    menuEl.clientHeight = 140;
    menuEl.scrollHeight = 280;
    menuEl.getBoundingClientRect = () => ({ left: 100, top: 100, width: 210, height: 140 });

    const scrollbarDown = { type: 'mousedown', target: menuEl, clientX: 306, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    menuEl.dispatchEvent(scrollbarDown);
    expect(scrollbarDown.preventDefault).not.toHaveBeenCalled();

    const firstItem = (document as any).querySelector('.app-context-menu__item');
    const itemDown = { type: 'mousedown', target: firstItem, clientX: 150, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    firstItem.dispatchEvent(itemDown);
    expect(itemDown.preventDefault).toHaveBeenCalledTimes(1);
  });
});
