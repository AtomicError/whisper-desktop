import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hardsub', () => ({ hardsubController: {} }));

let TranslationStudioController: typeof import('./translationStudio').TranslationStudioController;
const invoke = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeAll(async () => {
  vi.stubGlobal('document', { readyState: 'loading', addEventListener: vi.fn() });
  vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
  ({ TranslationStudioController } = await import('./translationStudio'));
});

afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { invoke.mockReset(); });

describe('subtitle loading', () => {
  it('ignores an older text read that finishes after the newer file loads', async () => {
    const firstRead = deferred<string>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return filePath === '/A.txt' ? firstRead.promise : Promise.resolve('BBBB');
      if (cmd === 'get_file_size') return Promise.resolve(4);
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    await controller.loadSubtitleFile('/B.txt');
    firstRead.resolve('AAA');
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleRawText: 'BBBB' });
    expect(invoke).not.toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' });
  });

  it('keeps the newest file and its contents together when size lookups finish out of order', async () => {
    const firstSize = deferred<number>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return Promise.resolve(filePath === '/A.txt' ? 'AAA' : 'BBBB');
      if (cmd === 'get_file_size') return filePath === '/A.txt' ? firstSize.promise : Promise.resolve(4);
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' }));
    expect(controller.state.subtitlePath).toBe('');
    await controller.loadSubtitleFile('/B.txt');
    firstSize.resolve(3);
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleName: 'B.txt', subtitleRawText: 'BBBB', subtitleSize: 4 });
    expect(controller.state.sourceCues[0].text).toBe('BBBB');
  });

  it('does not restore a subtitle cleared during its size lookup', async () => {
    const size = deferred<number>();
    invoke.mockImplementation(cmd => cmd === 'read_text_file_content' ? Promise.resolve('AAA') : size.promise);
    const controller = new TranslationStudioController();
    const loading = controller.loadSubtitleFile('/A.txt');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('get_file_size', { filePath: '/A.txt' }));
    controller.clearLoadedSubtitle();
    size.resolve(3);
    await loading;
    expect(controller.state).toMatchObject({ subtitlePath: '', subtitleRawText: '', subtitleSize: 0, sourceCues: [], companionVideoPath: null });
  });

  it.each([true, false])('ignores a stale companion probe after clearing (success: %s)', async success => {
    const probe = deferred<unknown>();
    invoke.mockImplementation(cmd => {
      if (cmd === 'read_text_file_content') return Promise.resolve('AAA');
      if (cmd === 'get_file_size') return Promise.resolve(3);
      return probe.promise;
    });
    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/A.txt');
    expect(invoke).toHaveBeenCalledWith('probe_media_file', { filePath: '/A.mp4' });
    controller.clearLoadedSubtitle();
    if (success) probe.resolve({});
    else probe.reject(new Error('Not found'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller.state.companionVideoPath).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'probe_media_file')).toHaveLength(1);
  });

  it.each([12, null])('uses disk bytes or UTF-8 fallback for Persian text (size: %s)', async size => {
    invoke.mockImplementation(cmd => {
      if (cmd === 'read_text_file_content') return Promise.resolve('سلام');
      if (cmd === 'get_file_size' && size !== null) return Promise.resolve(size);
      return Promise.reject(new Error('Unavailable'));
    });
    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/A.txt');
    expect(controller.state.subtitleSize).toBe(size ?? 8);
  });

  it('dispose unlistens all registered Tauri event listeners without error', () => {
    const controller = new TranslationStudioController();
    const mockUnlisten = vi.fn();
    (controller as any).unlisteners.push(mockUnlisten);
    (controller as any).scrollThrottledTimeout = setTimeout(() => {}, 1000);
    (controller as any).syncScrollRaf = 123;
    controller.dispose();
    expect(mockUnlisten).toHaveBeenCalledTimes(1);
    expect((controller as any).unlisteners).toHaveLength(0);
    expect((controller as any).scrollThrottledTimeout).toBeNull();
    expect((controller as any).syncScrollRaf).toBeNull();
  });

  it('copies pure subtitle text without timestamps or line numbers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const controller = new TranslationStudioController();
    (controller as any).notify = vi.fn();
    controller.state.translatedPath = '/output.srt';
    controller.state.translatedRawText = '1\n00:00:01,000 --> 00:00:02,000\nHello World\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond line';
    controller.state.translatedCues = [
      { id: 1, startMs: 1000, endMs: 2000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:02,000', text: 'Hello World' },
      { id: 2, startMs: 2000, endMs: 4000, startTimeStr: '00:00:02,000', endTimeStr: '00:00:04,000', text: 'Second line' },
    ];
    await controller.copyTranslatedText();
    expect(writeText).toHaveBeenCalledWith('Hello World\nSecond line');
  });

  it('attaches video on companion chip click only for valid video extensions', async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === 'select_file') return Promise.resolve('/videos/movie.mp4');
      if (cmd === 'probe_media_file') return Promise.resolve({ duration_sec: 120 });
      return Promise.resolve(null);
    });
    const controller = new TranslationStudioController();
    const setCompanionSpy = vi.spyOn(controller, 'setCompanionVideo');
    await controller.promptAndAttachCompanionVideo();
    expect(invoke).toHaveBeenCalledWith('select_file', {});
    expect(invoke).toHaveBeenCalledWith('probe_media_file', { filePath: '/videos/movie.mp4' });
    expect(setCompanionSpy).toHaveBeenCalledWith('/videos/movie.mp4');
  });

  it('ignores non-video file on companion chip click', async () => {
    invoke.mockImplementation((cmd) => {
      if (cmd === 'select_file') return Promise.resolve('/audios/track.mp3');
      return Promise.resolve(null);
    });
    const controller = new TranslationStudioController();
    const setCompanionSpy = vi.spyOn(controller, 'setCompanionVideo');
    await controller.promptAndAttachCompanionVideo();
    expect(invoke).toHaveBeenCalledWith('select_file', {});
    expect(invoke).not.toHaveBeenCalledWith('probe_media_file', expect.anything());
    expect(setCompanionSpy).not.toHaveBeenCalled();
  });

  it('accepts extended video formats (.ts, .wmv, .flv, .mpeg) as valid companion videos', async () => {
    invoke.mockImplementation((cmd, args) => {
      if (cmd === 'select_file') return Promise.resolve('/videos/broadcast.ts');
      if (cmd === 'probe_media_file') return Promise.resolve({ duration_sec: 45 });
      return Promise.resolve(null);
    });
    const controller = new TranslationStudioController();
    const setCompanionSpy = vi.spyOn(controller, 'setCompanionVideo');
    await controller.promptAndAttachCompanionVideo();
    expect(invoke).toHaveBeenCalledWith('select_file', {});
    expect(invoke).toHaveBeenCalledWith('probe_media_file', { filePath: '/videos/broadcast.ts' });
    expect(setCompanionSpy).toHaveBeenCalledWith('/videos/broadcast.ts');
  });

  it('updates start button disabled state and tooltip title based on subtitle, model, and translating readiness', () => {
    const controller = new TranslationStudioController();
    const setAttribute = vi.fn();
    const btnStart = { disabled: false, title: '', setAttribute } as unknown as HTMLButtonElement;
    (controller as any).btnStart = btnStart;

    // Initially no subtitle
    controller.state.subtitlePath = '';
    controller.state.activeModel = 'gpt-4o';
    controller.state.isTranslating = false;
    (controller as any).updateActionButtons();
    expect(btnStart.disabled).toBe(true);
    expect(btnStart.title).toBe('Please select a subtitle file first.');
    expect(setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.noSubSelectedError');

    // Subtitle loaded but no active model
    controller.state.subtitlePath = '/sub.srt';
    controller.state.activeModel = '';
    (controller as any).updateActionButtons();
    expect(btnStart.disabled).toBe(true);
    expect(btnStart.title).toBe('No active translation model selected. Please configure a provider and model.');
    expect(setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.noModelError');

    // Both ready
    controller.state.activeModel = 'gpt-4o';
    (controller as any).updateActionButtons();
    expect(btnStart.disabled).toBe(false);
    expect(btnStart.title).toBe('Translate Subtitle');
    expect(setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.startTranslate');

    // In translation progress
    controller.state.isTranslating = true;
    (controller as any).updateActionButtons();
    expect(btnStart.disabled).toBe(true);
    expect(btnStart.title).toBe('Translating with AI...');
    expect(setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.translating');
  });

  it('updates translation action buttons data-i18n-title and disabled attributes', () => {
    const controller = new TranslationStudioController();
    const btnCopy = { disabled: true, title: '', setAttribute: vi.fn() };
    const btnOpen = { disabled: true, title: '', setAttribute: vi.fn() };
    const btnSend = { disabled: true, title: '', setAttribute: vi.fn() };
    (controller as any).btnCopy = btnCopy;
    (controller as any).btnOpenFolder = btnOpen;
    (controller as any).btnSendToHardsub = btnSend;

    // No translated path or cues
    controller.state.translatedPath = '';
    controller.state.translatedCues = [];
    (controller as any).updateActionButtons();
    expect(btnCopy.disabled).toBe(true);
    expect(btnCopy.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.emptyTargetTitle');
    expect(btnOpen.disabled).toBe(true);
    expect(btnOpen.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.emptyTargetTitle');
    expect(btnSend.disabled).toBe(true);
    expect(btnSend.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.emptyTargetTitle');

    // With translated path and cues
    controller.state.translatedPath = '/output.srt';
    controller.state.translatedCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Trans' }];
    (controller as any).updateActionButtons();
    expect(btnCopy.disabled).toBe(false);
    expect(btnCopy.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.copyTranslation');
    expect(btnOpen.disabled).toBe(false);
    expect(btnOpen.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.openOutputFolder');
    expect(btnSend.disabled).toBe(false);
    expect(btnSend.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.sendToHardsub');
  });

  it('clears loaded subtitle and notifies error when reading subtitle file fails', async () => {
    invoke.mockImplementation((cmd) => {
      if (cmd === 'read_text_file_content') return Promise.reject(new Error('Permission denied'));
      return Promise.resolve(null);
    });
    const controller = new TranslationStudioController();
    const notifySpy = vi.fn();
    (controller as any).notify = notifySpy;
    controller.state.subtitlePath = '/old.srt';

    await controller.loadSubtitleFile('/bad.srt');
    expect(controller.state.subtitlePath).toBe('');
    expect(notifySpy).toHaveBeenCalledWith('Permission denied', 'error');
  });

  it('openOutputFolder invokes show_in_folder with target translated file and handles fallback', async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    const controller = new TranslationStudioController();
    controller.state.translatedPath = '/output/movie_persian.srt';

    await controller.openOutputFolder();
    expect(invoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/output/movie_persian.srt' });

    // Test fallback to open_file_in_editor when show_in_folder fails
    invoke.mockReset();
    invoke.mockImplementation((cmd) => {
      if (cmd === 'show_in_folder') return Promise.reject(new Error('Show failed'));
      return Promise.resolve(null);
    });

    await controller.openOutputFolder();
    expect(invoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/output/movie_persian.srt' });
    expect(invoke).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/output' });
  });

  it('updates aria-selected and active classes on view mode buttons when switching view modes', () => {
    const controller = new TranslationStudioController();
    const createMockBtn = () => {
      const classes = new Set<string>();
      const attrs = new Map<string, string>();
      return {
        classList: {
          add: vi.fn((cls: string) => classes.add(cls)),
          remove: vi.fn((cls: string) => classes.delete(cls)),
          contains: (cls: string) => classes.has(cls),
        },
        setAttribute: vi.fn((name: string, val: string) => attrs.set(name, val)),
        getAttribute: (name: string) => attrs.get(name) ?? null,
      };
    };

    const btnSplit = createMockBtn();
    const btnSource = createMockBtn();
    const btnTarget = createMockBtn();

    (controller as any).btnViewSplit = btnSplit;
    (controller as any).btnViewSource = btnSource;
    (controller as any).btnViewTarget = btnTarget;

    controller.setViewMode('source');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('aria-selected', 'true');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('tabindex', '0');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(btnSource.classList.add).toHaveBeenCalledWith('active');
    expect(btnSplit.classList.remove).toHaveBeenCalledWith('active');

    controller.setViewMode('target');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('aria-selected', 'true');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('tabindex', '0');

    controller.setViewMode('split');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('aria-selected', 'true');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('aria-selected', 'false');
    expect(btnSplit.setAttribute).toHaveBeenCalledWith('tabindex', '0');
    expect(btnSource.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(btnTarget.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
  });

  it('navigates view mode tabs with keyboard in LTR and RTL directions', () => {
    let keyHandler: ((e: any) => void) | null = null;
    const viewSegmented = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'keydown') keyHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };

    const createMockBtn = (id: string) => ({
      id,
      closest: vi.fn(() => viewSegmented),
      focus: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setAttribute: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn() },
    });

    const btnSplit = createMockBtn('btn-view-split');
    const btnSource = createMockBtn('btn-view-source');
    const btnTarget = createMockBtn('btn-view-target');

    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    let docDir = 'ltr';
    (globalThis as any).document = {
      ...origDoc,
      documentElement: {
        getAttribute: (attr: string) => (attr === 'dir' ? docDir : null),
      },
    };
    (globalThis as any).window = {
      ...origWin,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).btnViewSplit = btnSplit;
      (controller as any).btnViewSource = btnSource;
      (controller as any).btnViewTarget = btnTarget;
      (controller as any).setupEventListeners();
      expect(keyHandler).toBeDefined();

      const trigger = (key: string, extra = {}) => {
        const event = { key, defaultPrevented: false, preventDefault: vi.fn(() => { event.defaultPrevented = true; }), ...extra };
        keyHandler!(event);
        return event;
      };

      // Initial state is 'split' (index 0)
      expect(controller.state.viewMode).toBe('split');

      // LTR: ArrowRight moves next (split -> source)
      trigger('ArrowRight');
      expect(controller.state.viewMode).toBe('source');
      expect(btnSource.focus).toHaveBeenCalled();

      // LTR: ArrowRight moves next (source -> target)
      trigger('ArrowRight');
      expect(controller.state.viewMode).toBe('target');
      expect(btnTarget.focus).toHaveBeenCalled();

      // LTR: ArrowLeft moves prev (target -> source)
      trigger('ArrowLeft');
      expect(controller.state.viewMode).toBe('source');

      // Home moves to first (split)
      trigger('Home');
      expect(controller.state.viewMode).toBe('split');

      // End moves to last (target)
      trigger('End');
      expect(controller.state.viewMode).toBe('target');

      // Now switch to RTL
      docDir = 'rtl';
      // In RTL: ArrowRight moves prev (target -> source)
      trigger('ArrowRight');
      expect(controller.state.viewMode).toBe('source');

      // In RTL: ArrowLeft moves next (source -> target)
      trigger('ArrowLeft');
      expect(controller.state.viewMode).toBe('target');

      // Modifiers like Ctrl should be ignored
      trigger('ArrowLeft', { ctrlKey: true });
      expect(controller.state.viewMode).toBe('target');

      // Dispose removes listener
      controller.dispose();
      expect(viewSegmented.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('handles Translation Studio keyboard shortcuts with panel, modal, and input guards', () => {
    let docKeyHandler: ((e: any) => void) | null = null;
    let isTranslatePanelActive = true;
    let openOverlaySelectorResult: any = null;
    let activeEl: any = null;

    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    const removeEventListener = vi.fn();
    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'keydown') docKeyHandler = handler;
      }),
      removeEventListener,
      getElementById: vi.fn((id: string) => {
        if (id === 'panel-translate') {
          return { classList: { contains: (cls: string) => cls === 'active' && isTranslatePanelActive } };
        }
        return null;
      }),
      querySelector: vi.fn(() => openOverlaySelectorResult),
      get activeElement() {
        return activeEl;
      },
    };
    (globalThis as any).window = {
      ...origWin,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).setupEventListeners();
      expect(docKeyHandler).toBeDefined();

      const startSpy = vi.spyOn(controller, 'startTranslation').mockResolvedValue();
      const browseSpy = vi.spyOn(controller, 'browseSubtitleFile').mockResolvedValue();
      const copySpy = vi.spyOn(controller, 'copyTranslatedText').mockResolvedValue();
      const viewSpy = vi.spyOn(controller, 'setViewMode');

      const dispatch = (overrides: Record<string, any>) => {
        const event = {
          key: '',
          code: '',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          shiftKey: false,
          defaultPrevented: false,
          isComposing: false,
          target: null,
          preventDefault: vi.fn(() => { event.defaultPrevented = true; }),
          ...overrides,
        };
        docKeyHandler!(event);
        return event;
      };

      // 1/2/3 view mode switching (including Digit codes for non-Latin keyboard layouts)
      dispatch({ key: '2', code: 'Digit2' });
      expect(viewSpy).toHaveBeenCalledWith('source');
      dispatch({ key: '۳', code: 'Digit3' });
      expect(viewSpy).toHaveBeenCalledWith('target');
      dispatch({ key: '1', code: 'Digit1' });
      expect(viewSpy).toHaveBeenCalledWith('split');

      // Ctrl+O opens subtitle file when not translating
      dispatch({ key: 'o', ctrlKey: true });
      expect(browseSpy).toHaveBeenCalledTimes(1);

      // Ctrl+Enter requires subtitlePath + activeModel
      dispatch({ key: 'Enter', ctrlKey: true });
      expect(startSpy).not.toHaveBeenCalled();

      controller.state.subtitlePath = '/sub.srt';
      controller.state.activeModel = 'gpt-4o';
      dispatch({ key: 'Enter', ctrlKey: true });
      expect(startSpy).toHaveBeenCalledTimes(1);

      // Ctrl+Shift+C prevents default even before translated cues exist (avoid DevTools inspect leak)
      const earlyCopyEvent = dispatch({ key: 'C', ctrlKey: true, shiftKey: true });
      expect(earlyCopyEvent.preventDefault).toHaveBeenCalledTimes(1);
      expect(copySpy).not.toHaveBeenCalled();

      controller.state.translatedPath = '/out.srt';
      controller.state.translatedCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' }];
      dispatch({ key: 'C', ctrlKey: true, shiftKey: true });
      expect(copySpy).toHaveBeenCalledTimes(1);

      // Non-Latin keyboard layouts (e.g. Persian) trigger Ctrl+O and Ctrl+Shift+C via code fallback
      dispatch({ key: 'خ', code: 'KeyO', ctrlKey: true });
      expect(browseSpy).toHaveBeenCalledTimes(2);
      dispatch({ key: 'ژ', code: 'KeyC', ctrlKey: true, shiftKey: true });
      expect(copySpy).toHaveBeenCalledTimes(2);

      // Numpad with NumLock ON works, while NumLock OFF navigation keys (End/ArrowDown/PageDown) are ignored
      dispatch({ key: 'End', code: 'Numpad1' });
      dispatch({ key: 'ArrowDown', code: 'Numpad2' });
      dispatch({ key: 'PageDown', code: 'Numpad3' });
      expect(viewSpy).toHaveBeenCalledTimes(3);
      dispatch({ key: '2', code: 'Numpad2' });
      expect(viewSpy).toHaveBeenLastCalledWith('source');
      dispatch({ key: '1', code: 'Numpad1' });
      expect(viewSpy).toHaveBeenLastCalledWith('split');

      // Key repeat is ignored
      dispatch({ key: 'o', code: 'KeyO', ctrlKey: true, repeat: true });
      expect(browseSpy).toHaveBeenCalledTimes(2);

      // Blocked when editing an input/textarea, but allowed on checkbox (polish toggle)
      activeEl = { tagName: 'INPUT', type: 'text', isContentEditable: false };
      dispatch({ key: '2', code: 'Digit2' });
      dispatch({ key: 'Enter', ctrlKey: true });
      expect(viewSpy).toHaveBeenCalledTimes(5);
      expect(startSpy).toHaveBeenCalledTimes(1);

      activeEl = { tagName: 'INPUT', type: 'checkbox', isContentEditable: false };
      dispatch({ key: '2', code: 'Digit2' });
      expect(viewSpy).toHaveBeenCalledTimes(6);
      dispatch({ key: '1', code: 'Digit1' });
      expect(viewSpy).toHaveBeenCalledTimes(7);

      // CustomSelect trigger (closed): 1/2/3 must not hijack typeahead, while Ctrl+Enter / Ctrl+O still work
      activeEl = {
        tagName: 'DIV',
        classList: { contains: (c: string) => c === 'custom-select-trigger' },
        getAttribute: (attr: string) => (attr === 'aria-expanded' ? 'false' : null),
        closest: (sel: string) => (sel.includes('.custom-select-trigger') && !sel.includes('[aria-expanded="true"]') ? activeEl : null),
      };
      dispatch({ key: '2', code: 'Digit2', target: activeEl });
      expect(viewSpy).toHaveBeenCalledTimes(7);
      dispatch({ key: 'Enter', ctrlKey: true, target: activeEl });
      expect(startSpy).toHaveBeenCalledTimes(2);

      // CustomSelect trigger opening/open (aria-expanded="true" or .custom-select-container.open): all shortcuts blocked
      activeEl = {
        tagName: 'DIV',
        classList: { contains: (c: string) => c === 'custom-select-trigger' },
        getAttribute: (attr: string) => (attr === 'aria-expanded' ? 'true' : null),
        closest: (sel: string) => (sel.includes('.custom-select-trigger[aria-expanded="true"]') || sel.includes('.custom-select-container.open') ? activeEl : null),
      };
      dispatch({ key: 'Enter', ctrlKey: true, target: activeEl });
      dispatch({ key: 'o', ctrlKey: true, target: activeEl });
      expect(startSpy).toHaveBeenCalledTimes(2);
      expect(browseSpy).toHaveBeenCalledTimes(2);
      activeEl = null;

      // Blocked when modal or dropdown is open
      openOverlaySelectorResult = {};
      dispatch({ key: 'o', ctrlKey: true });
      expect(browseSpy).toHaveBeenCalledTimes(2);
      openOverlaySelectorResult = null;

      // Blocked when translate panel is inactive
      isTranslatePanelActive = false;
      dispatch({ key: 'o', ctrlKey: true });
      expect(browseSpy).toHaveBeenCalledTimes(2);
      isTranslatePanelActive = true;

      // Blocked during active translation, yet Ctrl+O / Ctrl+Shift+C still preventDefault
      controller.state.isTranslating = true;
      const busyOpenEvt = dispatch({ key: 'o', ctrlKey: true });
      dispatch({ key: 'Enter', ctrlKey: true });
      const busyCopyEvt = dispatch({ key: 'C', ctrlKey: true, shiftKey: true });
      expect(busyOpenEvt.preventDefault).toHaveBeenCalledTimes(1);
      expect(busyCopyEvt.preventDefault).toHaveBeenCalledTimes(1);
      expect(browseSpy).toHaveBeenCalledTimes(2);
      expect(startSpy).toHaveBeenCalledTimes(2);
      expect(copySpy).toHaveBeenCalledTimes(2);

      // Dispose cleans up document keydown listener
      controller.dispose();
      expect(removeEventListener).toHaveBeenCalledWith('keydown', docKeyHandler);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('focuses initial cue on ArrowDown/ArrowUp outside left panel and ignores modified cue navigation', async () => {
    let docKeyHandler: ((e: any) => void) | null = null;
    let sourceKeyHandler: ((e: any) => void) | null = null;
    let activeEl: any = null;

    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    const makeCue = (id: string) => ({
      dataset: { id },
      classList: { contains: (c: string) => c === 'translate-cue-item' },
      closest: vi.fn((sel: string) => (sel.includes('.translate-cue-item') ? makeCue(id) : null)),
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
      nextElementSibling: null as any,
      previousElementSibling: null as any,
    });

    const sourceCue1 = makeCue('1');
    const sourceCue2 = makeCue('2');
    sourceCue1.nextElementSibling = sourceCue2;
    sourceCue2.previousElementSibling = sourceCue1;
    const targetCue1 = makeCue('1');

    const sourceListEl = {
      addEventListener: vi.fn((evt: string, h: any) => {
        if (evt === 'keydown') sourceKeyHandler = h;
      }),
      querySelectorAll: vi.fn(() => [sourceCue1, sourceCue2]),
    };
    const targetListEl = {
      addEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => [targetCue1]),
    };

    let resolveDialog: ((val: string | null) => void) | null = null;
    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === 'keydown') docKeyHandler = handler;
      }),
      removeEventListener: vi.fn(),
      getElementById: vi.fn((id: string) => {
        if (id === 'panel-translate') {
          return { classList: { contains: (cls: string) => cls === 'active' } };
        }
        if (id === 'translate-source-cues-list') return sourceListEl;
        if (id === 'translate-target-cues-list') return targetListEl;
        return null;
      }),
      querySelector: vi.fn(() => null),
      get activeElement() {
        return activeEl;
      },
    };
    const invokeMock = vi.fn((cmd: string) => {
      if (cmd === 'select_subtitle_file') {
        return new Promise<string | null>((res) => {
          resolveDialog = res;
        });
      }
      return Promise.resolve(null);
    });
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: { core: { invoke: invokeMock } },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).initDOMElements();
      (controller as any).setupEventListeners();

      expect(docKeyHandler).toBeDefined();
      expect(sourceKeyHandler).toBeDefined();

      // ArrowDown enters first source cue in split/source mode; ArrowUp enters last source cue
      const downEvt = { key: 'ArrowDown', code: 'ArrowDown', defaultPrevented: false, isComposing: false, repeat: false, target: null, preventDefault: vi.fn() };
      docKeyHandler!(downEvt);
      expect(downEvt.preventDefault).toHaveBeenCalled();
      expect(sourceCue1.focus).toHaveBeenCalledTimes(1);

      const upEvt = { key: 'ArrowUp', code: 'ArrowUp', defaultPrevented: false, isComposing: false, repeat: false, target: null, preventDefault: vi.fn() };
      docKeyHandler!(upEvt);
      expect(upEvt.preventDefault).toHaveBeenCalled();
      expect(sourceCue2.focus).toHaveBeenCalledTimes(1);

      // In target-only mode, ArrowDown focuses target cue
      controller.setViewMode('target');
      docKeyHandler!({ key: 'ArrowDown', code: 'ArrowDown', defaultPrevented: false, isComposing: false, repeat: false, target: null, preventDefault: vi.fn() });
      expect(targetCue1.focus).toHaveBeenCalledTimes(1);

      // In source-only mode with empty source list, ArrowDown does not fall back to hidden target cues
      controller.setViewMode('source');
      sourceListEl.querySelectorAll.mockReturnValueOnce([]);
      const hiddenFallbackEvt = { key: 'ArrowDown', code: 'ArrowDown', defaultPrevented: false, isComposing: false, repeat: false, target: null, preventDefault: vi.fn() };
      docKeyHandler!(hiddenFallbackEvt);
      expect(hiddenFallbackEvt.preventDefault).not.toHaveBeenCalled();
      expect(targetCue1.focus).toHaveBeenCalledTimes(1);

      // Ignored inside left panel or when already inside a cue
      activeEl = { tagName: 'DIV', closest: vi.fn((sel: string) => (sel.includes('.translate-left-panel') ? {} : null)) };
      docKeyHandler!({ key: 'ArrowDown', code: 'ArrowDown', defaultPrevented: false, isComposing: false, repeat: false, target: activeEl, preventDefault: vi.fn() });
      expect(targetCue1.focus).toHaveBeenCalledTimes(1);
      activeEl = null;

      // Modified arrow keys inside cue list do not navigate cues
      const modCueEvt = { key: 'ArrowDown', altKey: true, defaultPrevented: false, target: sourceCue1, preventDefault: vi.fn() };
      sourceKeyHandler!(modCueEvt);
      expect(modCueEvt.preventDefault).not.toHaveBeenCalled();

      // Concurrent browseSubtitleFile calls while dialog is open are ignored
      const firstBrowse = controller.browseSubtitleFile();
      const secondBrowse = controller.browseSubtitleFile();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      resolveDialog!(null);
      await Promise.all([firstBrowse, secondBrowse]);

      // Pending startTranslation guard blocks Ctrl+O / browseSubtitleFile and clearLoadedSubtitle
      controller.state.subtitlePath = '/sub.srt';
      (controller as any).isStartingTranslation = true;
      const startingOpenEvt = { key: 'o', code: 'KeyO', ctrlKey: true, defaultPrevented: false, isComposing: false, repeat: false, target: null, preventDefault: vi.fn() };
      docKeyHandler!(startingOpenEvt);
      expect(startingOpenEvt.preventDefault).toHaveBeenCalledTimes(1);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      controller.clearLoadedSubtitle();
      expect(controller.state.subtitlePath).toBe('/sub.srt');
      (controller as any).isStartingTranslation = false;
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });
});

