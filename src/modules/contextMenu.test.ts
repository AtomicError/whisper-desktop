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
    const list = this.listeners[ev.type] || [];
    for (const fn of list) fn(ev);
  }

  click() {
    this.dispatchEvent({ type: 'click', stopPropagation: vi.fn(), preventDefault: vi.fn() });
  }

  focus() {
    (globalThis as any).document.activeElement = this;
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
          intersectsNode: (node: MockElement) => Boolean(selectionState.ancestor?.contains(node) || node.contains(selectionState.ancestor))
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

    // Tab while opened by keyboard closes menu and restores focus to triggering element
    let tabPrevented = false;
    (document as any).dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault: () => {
        tabPrevented = true;
      },
      stopPropagation: vi.fn()
    });
    expect(tabPrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(false);
    expect((document as any).activeElement).toBe(details);
  });
});
