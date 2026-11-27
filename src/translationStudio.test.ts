import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSourceFile } from './testUtils';

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
beforeEach(() => {
  invoke.mockReset();
  if (typeof localStorage !== 'undefined' && typeof localStorage.removeItem === 'function') {
    localStorage.removeItem('whisper_translate_output_dir_mode');
    localStorage.removeItem('whisper_translate_output_dir');
  }
});

describe('subtitle loading', () => {
  it('ignores an older text read that finishes after the newer file loads', async () => {
    const firstRead = deferred<string>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return filePath === '/A.txt' ? firstRead.promise : Promise.resolve('BBBB');
      if (cmd === 'probe_media_file') return Promise.resolve({ exists: false });
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    await controller.loadSubtitleFile('/B.txt');
    firstRead.resolve('AAA');
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleRawText: 'BBBB' });
    expect(invoke).not.toHaveBeenCalledWith('get_file_size', expect.anything());
  });

  it('keeps the newest file and its contents together when concurrent loads finish out of order', async () => {
    const firstRead = deferred<string>();
    const secondRead = deferred<string>();
    invoke.mockImplementation((cmd, { filePath }) => {
      if (cmd === 'read_text_file_content') return filePath === '/A.txt' ? firstRead.promise : secondRead.promise;
      if (cmd === 'probe_media_file') return Promise.resolve({ exists: false });
      return Promise.reject(new Error('Not found'));
    });
    const controller = new TranslationStudioController();
    const first = controller.loadSubtitleFile('/A.txt');
    const second = controller.loadSubtitleFile('/B.txt');
    secondRead.resolve('BBBB');
    await second;
    firstRead.resolve('AAA');
    await first;
    expect(controller.state).toMatchObject({ subtitlePath: '/B.txt', subtitleName: 'B.txt', subtitleRawText: 'BBBB' });
    expect(controller.state.sourceCues[0].text).toBe('BBBB');
  });

  it('does not restore a subtitle cleared while read_text_file_content is in flight', async () => {
    const read = deferred<string>();
    invoke.mockImplementation(cmd => cmd === 'read_text_file_content' ? read.promise : Promise.resolve(null));
    const controller = new TranslationStudioController();
    const loading = controller.loadSubtitleFile('/A.txt');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('read_text_file_content', { filePath: '/A.txt' }));
    controller.clearLoadedSubtitle();
    read.resolve('AAA');
    await loading;
    expect(controller.state).toMatchObject({ subtitlePath: '', subtitleRawText: '', sourceCues: [], companionVideoPath: null });
  });

  it.each([true, false])('ignores a stale companion probe after clearing (success: %s)', async success => {
    const probe = deferred<string | null>();
    invoke.mockImplementation(cmd => {
      if (cmd === 'read_text_file_content') return Promise.resolve('AAA');
      if (cmd === 'find_existing_video_file') return probe.promise;
      return Promise.resolve(null);
    });
    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/A.txt');
    expect(invoke).toHaveBeenCalledWith('find_existing_video_file', {
      candidates: expect.arrayContaining(['/A.mp4']),
    });
    controller.clearLoadedSubtitle();
    if (success) probe.resolve('/A.mp4');
    else probe.resolve(null);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller.state.companionVideoPath).toBeNull();
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'find_existing_video_file')).toHaveLength(1);
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

  it('copies pure subtitle text via copyToClipboard without timestamps or line numbers and notifies on failure', async () => {
    invoke.mockResolvedValueOnce(undefined);
    const controller = new TranslationStudioController();
    const notifySpy = vi.fn();
    (controller as any).notify = notifySpy;
    controller.state.translatedPath = '/output.srt';
    controller.state.translatedRawText = '1\n00:00:01,000 --> 00:00:02,000\nHello World\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond line';
    controller.state.translatedCues = [
      { id: 1, startMs: 1000, endMs: 2000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:02,000', text: 'Hello World' },
      { id: 2, startMs: 2000, endMs: 4000, startTimeStr: '00:00:02,000', endTimeStr: '00:00:04,000', text: 'Second line' },
    ];
    await controller.copyTranslatedText();
    expect(invoke).toHaveBeenCalledWith('copy_to_clipboard', { text: 'Hello World\nSecond line' });
    expect(notifySpy).toHaveBeenCalledWith('Translated subtitles copied to clipboard!', 'success');

    // All clipboard providers fail -> notifies user with error
    invoke.mockRejectedValue(new Error('Clipboard unavailable'));
    notifySpy.mockClear();
    await controller.copyTranslatedText();
    expect(notifySpy).toHaveBeenCalledWith(expect.stringContaining('Clipboard unavailable'), 'error');
  });

  it('detectCompanionVideo uses fast find_existing_video_file, falls back to probe_media_file, and does not overwrite explicit setCompanionVideo', async () => {
    invoke.mockImplementation((cmd: string, args: any) => {
      if (cmd === 'read_text_file_content') return Promise.resolve('1\n00:00:01,000 --> 00:00:02,000\nHi');
      if (cmd === 'get_file_size') return Promise.resolve(40);
      if (cmd === 'find_existing_video_file') {
        const match = (args.candidates as string[]).find(c => c === '/videos/movie.mkv');
        return Promise.resolve(match || null);
      }
      return Promise.resolve(null);
    });

    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/videos/movie.en.srt');
    await vi.waitFor(() => expect(controller.state.companionVideoPath).toBe('/videos/movie.mkv'));

    // Fallback to active Transcribe media + probe_media_file when find_existing_video_file is unavailable
    const origGetMedia = (globalThis as any).window.getCurrentSourceMediaFile;
    (globalThis as any).window.getCurrentSourceMediaFile = () => '/active/clip.ts';
    invoke.mockImplementation((cmd: string, args: any) => {
      if (cmd === 'read_text_file_content') return Promise.resolve('1\n00:00:01,000 --> 00:00:02,000\nHi');
      if (cmd === 'get_file_size') return Promise.resolve(40);
      if (cmd === 'find_existing_video_file') return Promise.reject(new Error('Unsupported'));
      if (cmd === 'probe_media_file') {
        return Promise.resolve({ exists: args.filePath === '/active/clip.ts' });
      }
      return Promise.resolve(null);
    });
    try {
      await controller.loadSubtitleFile('/other/sub.srt');
      await vi.waitFor(() => expect(controller.state.companionVideoPath).toBe('/active/clip.ts'));
    } finally {
      (globalThis as any).window.getCurrentSourceMediaFile = origGetMedia;
    }

    // Explicit setCompanionVideo (e.g. from workflowBridge) is not overwritten by an in-flight probe
    const delayedProbe = deferred<string | null>();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'read_text_file_content') return Promise.resolve('1\n00:00:01,000 --> 00:00:02,000\nHi');
      if (cmd === 'get_file_size') return Promise.resolve(40);
      if (cmd === 'find_existing_video_file') return delayedProbe.promise;
      return Promise.resolve(null);
    });
    await controller.loadSubtitleFile('/race/sub.srt');
    controller.setCompanionVideo('/explicit/source.mp4');
    delayedProbe.resolve('/race/sub.mkv');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(controller.state.companionVideoPath).toBe('/explicit/source.mp4');
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

    // With translated .srt path and cues
    controller.state.translatedPath = '/output.srt';
    controller.state.translatedCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Trans' }];
    (controller as any).updateActionButtons();
    expect(btnCopy.disabled).toBe(false);
    expect(btnCopy.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.copyTranslation');
    expect(btnOpen.disabled).toBe(false);
    expect(btnOpen.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.openOutputFolder');
    expect(btnSend.disabled).toBe(false);
    expect(btnSend.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'translate.sendToHardsub');

    // With translated .txt path: copy/open enabled, Send to Hardsub disabled with timed-sub tooltip
    controller.state.translatedPath = '/output.fa.txt';
    (controller as any).updateActionButtons();
    expect(btnCopy.disabled).toBe(false);
    expect(btnOpen.disabled).toBe(false);
    expect(btnSend.disabled).toBe(true);
    expect(btnSend.setAttribute).toHaveBeenCalledWith('data-i18n-title', 'transcribe.hardsubRequiresTimedSub');
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

    // Test fallback to open_file_in_editor when show_in_folder and opener reveal fail
    invoke.mockReset();
    invoke.mockImplementation((cmd) => {
      if (cmd === 'show_in_folder' || cmd === 'plugin:opener|reveal_item_in_dir') {
        return Promise.reject(new Error('Show failed'));
      }
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

describe('translation studio bugfixes and edge cases', () => {
  it('parses repeated/colon/3-digit LRC timestamps and filters non-translatable LRC and TXT lines', async () => {
    const lrcContent = [
      '[ar:Artist Name]',
      '[00:05.00][01:10:25]First lyric line',
      '[105:00.00]Long track line',
      '[02:00.00]♪ ♫ ♪',
      '[02:05.00]---',
    ].join('\n');

    invoke.mockImplementation((cmd: string, args: any) => {
      if (cmd === 'read_text_file_content') {
        return Promise.resolve(args.filePath.endsWith('.lrc') ? lrcContent : '\n♪ ♫\n---\nActual spoken sentence\n');
      }
      if (cmd === 'get_file_size') return Promise.resolve(100);
      return Promise.reject(new Error('Not found'));
    });

    const controller = new TranslationStudioController();
    await controller.loadSubtitleFile('/song.lrc');
    expect(controller.state.sourceCues).toHaveLength(2);
    expect(controller.state.sourceCues[0]).toMatchObject({
      startMs: 5000,
      endMs: 5000,
      startTimeStr: '00:05.00',
      text: 'First lyric line',
    });
    expect(controller.state.sourceCues[1]).toMatchObject({
      startMs: 6300000,
      startTimeStr: '105:00.00',
      text: 'Long track line',
    });

    await controller.loadSubtitleFile('/notes.txt');
    expect(controller.state.sourceCues).toHaveLength(1);
    expect(controller.state.sourceCues[0].text).toBe('Actual spoken sentence');
    controller.dispose();
  });

  it('passes translation subtitle extension filter and guards concurrent/busy directory browse', async () => {
    let resolveDir!: (val: string | null) => void;
    const origWin = (globalThis as any).window;
    const invokeLocal = vi.fn((cmd: string) => {
      if (cmd === 'select_subtitle_file') return Promise.resolve(null);
      if (cmd === 'select_directory') return new Promise<string | null>((res) => { resolveDir = res; });
      return Promise.resolve(null);
    });
    (globalThis as any).window = { ...origWin, __TAURI__: { core: { invoke: invokeLocal } } };

    try {
      const controller = new TranslationStudioController();
      await controller.browseSubtitleFile();
      expect(invokeLocal).toHaveBeenCalledWith('select_subtitle_file', { extensions: ['srt', 'vtt', 'lrc', 'txt'] });

      const firstDir = controller.browseOutputDir();
      const secondDir = controller.browseOutputDir();
      expect(invokeLocal).toHaveBeenCalledTimes(2);
      resolveDir('/tmp/out');
      await Promise.all([firstDir, secondDir]);
      expect(invokeLocal).toHaveBeenCalledWith('verify_directory_writable', { dirPath: '/tmp/out' });
      expect(controller.state.outputDir).toBe('/tmp/out');

      controller.state.isTranslating = true;
      await controller.browseOutputDir();
      expect(invokeLocal).toHaveBeenCalledTimes(3);
    } finally {
      (globalThis as any).window = origWin;
    }
  });

  it('clears stale activeProvider when empty or missing and always syncs custom selects', () => {
    const syncCustomSelects = vi.fn();
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const makeSelect = () => {
      const el: any = {
        value: '',
        innerHTML: '',
        children: [] as any[],
        appendChild: (c: any) => el.children.push(c),
      };
      return el;
    };
    const providerSelect = makeSelect();
    const modelSelect = makeSelect();

    (globalThis as any).document = {
      ...origDoc,
      createElement: vi.fn(() => ({ value: '', textContent: '' })),
    };
    (globalThis as any).window = {
      ...origWin,
      syncCustomSelects,
      settingsState: {
        translateAiProviders: '[]',
        translateAiProvider: 'OldProvider',
        translateAiModel: 'old-model',
      },
    };

    try {
      const controller = new TranslationStudioController();
      controller.state.activeProvider = 'OldProvider';
      controller.state.activeModel = 'old-model';
      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;

      controller.refreshProviderOptions();
      expect(controller.state.activeProvider).toBe('');
      expect(controller.state.activeModel).toBe('');
      expect(providerSelect.value).toBe('');
      expect(modelSelect.value).toBe('');
      expect(syncCustomSelects).toHaveBeenCalled();

      syncCustomSelects.mockClear();
      (globalThis as any).window.settingsState = {
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'gpt-4o-mini', enabled: true }] },
        ]),
        translateAiProvider: 'DeletedProvider',
        translateAiModel: 'missing-model',
      };

      controller.refreshProviderOptions();
      expect(controller.state.activeProvider).toBe('OpenAI');
      expect(controller.state.activeModel).toBe('gpt-4o-mini');
      expect(providerSelect.value).toBe('OpenAI');
      expect(modelSelect.value).toBe('gpt-4o-mini');
      expect(syncCustomSelects).toHaveBeenCalled();
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('re-enables btnCancel when cancel_transcription fails while still translating', async () => {
    invoke.mockRejectedValueOnce(new Error('IPC error'));
    const controller = new TranslationStudioController();
    const btnCancel: any = { disabled: false };
    (controller as any).btnCancel = btnCancel;
    controller.state.isTranslating = true;

    await controller.cancelTranslation();
    expect(invoke).toHaveBeenCalledWith('cancel_transcription', {});
    expect(btnCancel.disabled).toBe(false);
  });

  it('restores prior translation when busy, shows failed status on error, locks controls while running, and preserves badge data-i18n', async () => {
    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    let invokeHandler!: (cmd: string, args?: any) => Promise<any>;
    const invokeLocal = vi.fn((cmd: string, args?: any) => invokeHandler(cmd, args));

    const makeEl = () => ({
      textContent: '',
      title: '',
      className: '',
      innerHTML: '',
      style: {} as Record<string, string>,
      disabled: false,
      attrs: {} as Record<string, string>,
      setAttribute(k: string, v: string) { this.attrs[k] = v; },
      removeAttribute(k: string) { delete this.attrs[k]; },
      getAttribute(k: string) { return this.attrs[k] ?? null; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const sourceList = makeEl();
    const targetList = makeEl();
    const statusBadge = makeEl();
    const lblMsg = makeEl();
    const btnBrowseSub = makeEl();
    const targetLangSelect = makeEl();

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      settingsState: { translateAiProviders: '[]' },
      showNotification: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).sourceList = sourceList;
      (controller as any).targetList = targetList;
      (controller as any).sourceCountBadge = makeEl();
      (controller as any).targetCountBadge = makeEl();
      (controller as any).statusBadge = statusBadge;
      (controller as any).lblMsg = lblMsg;
      (controller as any).lblLines = makeEl();
      (controller as any).lblPct = makeEl();
      (controller as any).progressFill = makeEl();
      (controller as any).telemetryBox = makeEl();
      (controller as any).btnStart = makeEl();
      (controller as any).btnStartText = makeEl();
      (controller as any).btnCancel = makeEl();
      (controller as any).btnBrowseSub = btnBrowseSub;
      (controller as any).targetLangSelect = targetLangSelect;

      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      controller.state.subtitlePath = '/dir/sub.srt';
      controller.state.subtitleName = 'sub.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.activeProvider = 'OpenAI';
      controller.state.activeModel = 'gpt-4o';
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 2000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:02,000', text: 'Hello' },
      ];
      controller.state.translatedPath = '/dir/sub_fa.srt';
      controller.state.translatedName = 'sub_fa.srt';
      controller.state.translatedRawText = '1\n00:00:00,000 --> 00:00:02,000\nسلام';
      controller.state.translatedCues = [
        { id: 1, startMs: 0, endMs: 2000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:02,000', text: 'سلام' },
      ];
      (controller as any).setStatusBadge('translate.statusComplete', 'complete');
      controller.state.progress = 1;
      controller.state.currentLine = 1;
      controller.state.totalLines = 1;
      (controller as any).lastProgressIsComplete = true;
      (controller as any).progressFill.style.width = '100%';
      (controller as any).lblPct.textContent = '100%';
      (controller as any).lblLines.textContent = '1 / 1';
      lblMsg.textContent = 'AI translation completed successfully!';

      // Busy session error restores prior translated output, complete status, and telemetry DOM
      invokeHandler = vi.fn().mockRejectedValue('Another transcription or translation task is already active');
      await controller.startTranslation();
      expect(controller.state.translatedPath).toBe('/dir/sub_fa.srt');
      expect(controller.state.translatedCues).toHaveLength(1);
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusComplete');
      expect((controller as any).progressFill.style.width).toBe('100%');
      expect((controller as any).lblPct.textContent).toBe('100%');
      expect((controller as any).lblLines.textContent).toBe('1 / 1');
      expect(lblMsg.textContent).toBe('AI translation completed successfully!');
      expect(btnBrowseSub.disabled).toBe(false);
      expect(targetLangSelect.disabled).toBe(false);

      // In-flight locking and failure badge on generic error
      const pending = deferred<string[]>();
      invokeHandler = vi.fn(() => pending.promise);
      const runningPromise = controller.startTranslation();
      expect(btnBrowseSub.disabled).toBe(true);
      expect(targetLangSelect.disabled).toBe(true);
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusTranslating');

      tauriListeners['translation-status']?.({
        payload: { active: true, progress: 0.5, currentLine: 1, totalLines: 2, message: 'Resuming translation from checkpoint...' },
      });
      expect(lblMsg.textContent).toContain('1');
      expect(lblMsg.textContent).toContain('2');

      controller.refreshLocalization();
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusTranslating');
      expect(sourceList.innerHTML).toContain('aria-label="');

      pending.reject('API timeout');
      await runningPromise;
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(statusBadge.className).toBe('translate-status-badge failed');
      expect(btnBrowseSub.disabled).toBe(false);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('ignores tauri://drag-drop while translating and cleans up scroll listeners on dispose', async () => {
    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const sourceScrollRemove = vi.fn();
    const targetScrollRemove = vi.fn();

    const makeListEl = (removeFn: any) => ({
      addEventListener: vi.fn(),
      removeEventListener: removeFn,
      querySelectorAll: vi.fn(() => []),
    });

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementById: vi.fn((id: string) => {
        if (id === 'panel-translate') return { classList: { contains: (c: string) => c === 'active' } };
        if (id === 'translate-drop-zone') return { addEventListener: vi.fn(), classList: { add: vi.fn(), remove: vi.fn() } };
        if (id === 'translate-source-cues-list') return makeListEl(sourceScrollRemove);
        if (id === 'translate-target-cues-list') return makeListEl(targetScrollRemove);
        return null;
      }),
      querySelector: vi.fn((sel: string) => (sel === '.view-panel.active' ? { id: 'panel-translate' } : null)),
    };
    const invokeLocal = vi.fn().mockResolvedValue('');
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).initDOMElements();
      (controller as any).setupEventListeners();
      (controller as any).setupDropZone();
      await Promise.resolve();

      const loadSpy = vi.spyOn(controller, 'loadSubtitleFile').mockResolvedValue(true);
      controller.state.isTranslating = true;
      await tauriListeners['tauri://drag-drop']?.({ payload: { paths: ['/tmp/movie.srt'] } });
      expect(loadSpy).not.toHaveBeenCalled();

      controller.state.isTranslating = false;
      await tauriListeners['tauri://drag-drop']?.({ payload: { paths: ['/tmp/movie.srt'] } });
      expect(loadSpy).toHaveBeenCalledWith('/tmp/movie.srt');

      controller.dispose();
      expect(sourceScrollRemove).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(targetScrollRemove).toHaveBeenCalledWith('scroll', expect.any(Function));
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('guards extensionless files, HTML5 drop without path, .txt Hardsub transfer, cancel button state, data-i18n hygiene, and math angle brackets', async () => {
    const { parseSubtitleContent } = await import('./translationStudio');
    const parsed = parseSubtitleContent(
      '1\n00:00:01,000 --> 00:00:03,000\n<i>x < 5</i>\nand y > 2\n',
      'srt'
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('x < 5\nand y > 2');

    const controller = new TranslationStudioController();
    const notifySpy = vi.fn();
    (controller as any).notify = notifySpy;

    // Extensionless file named "srt" must be rejected without invoking backend
    await controller.loadSubtitleFile('/tmp/srt');
    expect(invoke).not.toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalledWith(expect.any(String), 'error');

    // Sending .txt output to Hardsub is blocked
    controller.state.translatedPath = '/tmp/notes.fa.txt';
    notifySpy.mockClear();
    controller.sendToHardsubStudio();
    expect(notifySpy).toHaveBeenCalledWith(expect.any(String), 'error');

    // btnCancel stays disabled across view mode switches while cancellation is in flight
    const btnCancel: any = { disabled: false, style: {} };
    (controller as any).btnCancel = btnCancel;
    controller.state.isTranslating = true;
    invoke.mockResolvedValueOnce(undefined);
    await controller.cancelTranslation();
    controller.setViewMode('source');
    expect(btnCancel.disabled).toBe(true);

    // Dynamic data-i18n / data-i18n-title hygiene on subtitle card and output dir
    const makeAttrEl = () => {
      const attrs: Record<string, string> = {};
      return {
        textContent: '',
        title: '',
        style: {} as Record<string, string>,
        classList: { add: vi.fn(), remove: vi.fn() },
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
      };
    };
    const dropZone = makeAttrEl();
    const lblSubName = makeAttrEl();
    const lblSubPath = makeAttrEl();
    const outputDirText = makeAttrEl();
    (controller as any).dropZone = dropZone;
    (controller as any).lblSubName = lblSubName;
    (controller as any).lblSubPath = lblSubPath;
    (controller as any).lblSubMeta = makeAttrEl();
    (controller as any).btnClearSub = makeAttrEl();
    (controller as any).outputDirText = outputDirText;
    (controller as any).btnResetDir = makeAttrEl();

    controller.state.subtitlePath = '/dir/movie.srt';
    controller.state.subtitleName = 'movie.srt';
    controller.state.subtitleExt = 'srt';
    controller.state.outputDir = '/custom/out';
    (controller as any).updateSubtitleInfoUI();
    expect(lblSubName.getAttribute('data-i18n')).toBeNull();
    expect(lblSubPath.getAttribute('data-i18n')).toBeNull();
    expect(dropZone.getAttribute('data-i18n-title')).toBeNull();
    expect(outputDirText.getAttribute('data-i18n')).toBeNull();

    controller.state.isTranslating = false;
    controller.state.outputDir = '';
    controller.clearLoadedSubtitle();
    expect(lblSubName.getAttribute('data-i18n')).toBe('translate.noSubLoaded');
    expect(lblSubPath.getAttribute('data-i18n')).toBe('translate.dropSubPrompt');
    expect(dropZone.getAttribute('data-i18n-title')).toBe('translate.dropSubPrompt');
    expect(outputDirText.getAttribute('data-i18n')).toBe('translate.sameAsSource');

    // HTML5 drop without file.path does not clear or load
    const dropHandlers: Record<string, (e: any) => any> = {};
    const dropZoneMock: any = {
      addEventListener: vi.fn((evt: string, h: any) => { dropHandlers[evt] = h; }),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    (controller as any).dropZone = dropZoneMock;
    const origWin = (globalThis as any).window;
    (globalThis as any).window = { ...origWin, __TAURI__: { core: { invoke } } };
    try {
      (controller as any).setupDropZone();
      const loadSpy = vi.spyOn(controller, 'loadSubtitleFile');
      await dropHandlers['drop']({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [{ name: 'missing-path.srt' }] },
      });
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).window = origWin;
    }

    // DOM-based cue rendering safely uses textContent without injecting HTML
    const origDoc = (globalThis as any).document;
    const makeDomNode = (tag: string) => {
      const node: any = {
        tagName: tag.toUpperCase(),
        className: '',
        id: '',
        tabIndex: 0,
        textContent: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        attrs: {} as Record<string, string>,
        children: [] as any[],
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
        removeAttribute(k: string) { delete this.attrs[k]; },
        getAttribute(k: string) { return this.attrs[k] ?? null; },
        appendChild(c: any) { this.children.push(c); return c; },
        replaceChildren(...nodes: any[]) { this.children = nodes; },
      };
      return node;
    };
    const sourceDomList = makeDomNode('div');
    const targetDomList = makeDomNode('div');
    (globalThis as any).document = {
      ...origDoc,
      createElement: (tag: string) => makeDomNode(tag),
      createDocumentFragment: () => makeDomNode('fragment'),
    };
    try {
      (controller as any).sourceList = sourceDomList;
      (controller as any).targetList = targetDomList;
      (controller as any).sourceCountBadge = makeDomNode('span');
      (controller as any).targetCountBadge = makeDomNode('span');
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: '<img src=x onerror=alert(1)>' },
      ];
      controller.state.translatedCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'سلام' },
      ];
      (controller as any).renderSourceCues();
      (controller as any).renderTargetCues();
      expect(sourceDomList.children).toHaveLength(1);
      const srcCard = sourceDomList.children[0].children ? sourceDomList.children[0] : null;
      const renderedSrc = srcCard?.tagName === 'FRAGMENT' ? srcCard.children[0] : srcCard;
      expect(renderedSrc.children[1].textContent).toBe('<img src=x onerror=alert(1)>');
      expect(renderedSrc.children[1].innerHTML).toBe('');
      expect(targetDomList.children).toHaveLength(1);
    } finally {
      (globalThis as any).document = origDoc;
    }
  });

  it('handles Nothing to translate without 100% complete contradiction, displays preflight error in telemetry, keeps btnOpenFolder enabled for empty-cue files, and updates aria-valuenow', async () => {
    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    let invokeHandler!: (cmd: string, args?: any) => Promise<any>;
    const invokeLocal = vi.fn((cmd: string, args?: any) => invokeHandler(cmd, args));

    const makeEl = () => {
      const attrs: Record<string, string> = {};
      return {
        textContent: '',
        title: '',
        className: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        disabled: false,
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    };

    const statusBadge = makeEl();
    const lblMsg = makeEl();
    const lblPct = makeEl();
    const progressFill = makeEl();
    const progressTrack = makeEl();
    const btnOpenFolder = makeEl();
    const btnCopy = makeEl();
    const btnSendToHardsub = makeEl();

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      settingsState: { translateAiProviders: '[]' },
      showNotification: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).statusBadge = statusBadge;
      (controller as any).lblMsg = lblMsg;
      (controller as any).lblLines = makeEl();
      (controller as any).lblPct = lblPct;
      (controller as any).progressFill = progressFill;
      (controller as any).progressTrack = progressTrack;
      (controller as any).telemetryBox = makeEl();
      (controller as any).btnStart = makeEl();
      (controller as any).btnStartText = makeEl();
      (controller as any).btnCancel = makeEl();
      (controller as any).btnOpenFolder = btnOpenFolder;
      (controller as any).btnCopy = btnCopy;
      (controller as any).btnSendToHardsub = btnSendToHardsub;

      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      // Nothing to translate must reset progress to 0% and never report complete
      tauriListeners['translation-status']?.({
        payload: { active: false, progress: 1.0, message: 'Nothing to translate' },
      });
      expect(progressFill.style.width).toBe('0%');
      expect(lblPct.textContent).toBe('0%');
      expect(progressTrack.getAttribute('aria-valuenow')).toBe('0');
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusReady');
      expect(lblMsg.textContent).toBe('No Translation Yet');

      // Empty translatedFiles return resets telemetry cleanly with failed status
      controller.state.subtitlePath = '/dir/sub.srt';
      controller.state.subtitleName = 'sub.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.activeProvider = 'OpenAI';
      controller.state.activeModel = 'gpt-4o';
      invokeHandler = vi.fn().mockResolvedValue([]);
      await controller.startTranslation();
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(progressFill.style.width).toBe('0%');
      expect(lblPct.textContent).toBe('0%');
      expect(lblMsg.textContent).toContain('No translated subtitle was produced');

      // Pre-flight error (before any translation-status event) populates lblMsg
      invokeHandler = vi.fn().mockRejectedValue('Output directory is not writable');
      await controller.startTranslation();
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(lblMsg.textContent).toContain('Output directory is not writable');

      // syncFromGlobalSettings is a no-op while translating
      controller.state.activeModel = 'gpt-4o';
      controller.state.isTranslating = true;
      (globalThis as any).window.settingsState = { translateAiTargetLang: 'French' };
      controller.syncFromGlobalSettings();
      expect(controller.state.targetLang).not.toBe('French');
      controller.state.isTranslating = false;

      // btnOpenFolder is enabled when translatedPath exists even if translatedCues is empty
      controller.state.translatedPath = '/dir/empty.fa.srt';
      controller.state.translatedCues = [];
      (controller as any).updateActionButtons();
      expect(btnOpenFolder.disabled).toBe(false);
      expect(btnCopy.disabled).toBe(true);
      expect(btnSendToHardsub.disabled).toBe(true);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('clears .highlighted on mouseout during scroll throttling, deduplicates DOM IDs for duplicate SRT cue numbers, parses VTT NOTE_1/REGION-A cues, and handles Tauri drag-over/leave/drop feedback', async () => {
    const { parseSubtitleContent } = await import('./translationStudio');
    const vttCues = parseSubtitleContent(
      'WEBVTT\n\nNOTE_1\n00:00:01.000 --> 00:00:02.000\nFirst\n\nNOTE This is a comment\n00:00:03.000 --> 00:00:04.000\n\nREGION-A\n00:00:05.000 --> 00:00:06.000\nSecond\n',
      'vtt'
    );
    expect(vttCues).toHaveLength(2);
    expect(vttCues[0].text).toBe('First');
    expect(vttCues[1].text).toBe('Second');

    const tauriListeners: Record<string, (e: any) => void> = {};
    const listListeners: Record<string, Record<string, (e: any) => void>> = {
      source: {},
      target: {},
    };
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    const makeDomNode = (tag: string, id = '') => {
      const classes = new Set<string>();
      const attrs: Record<string, string> = {};
      const node: any = {
        tagName: tag.toUpperCase(),
        id,
        className: '',
        tabIndex: 0,
        textContent: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        children: [] as any[],
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
        appendChild(c: any) { this.children.push(c); return c; },
        replaceChildren(...nodes: any[]) { this.children = nodes; },
        closest(sel: string) {
          if (sel === '.translate-cue-item' && (classes.has('translate-cue-item') || this.className.includes('translate-cue-item'))) {
            return node;
          }
          return null;
        },
      };
      return node;
    };

    const domNodesById = new Map<string, any>();
    const dropZone = makeDomNode('div', 'translate-drop-zone');
    dropZone.addEventListener = vi.fn();
    const sourceList = makeDomNode('div', 'translate-source-cues-list');
    sourceList.addEventListener = vi.fn((evt: string, cb: any) => { listListeners.source[evt] = cb; });
    const targetList = makeDomNode('div', 'translate-target-cues-list');
    targetList.addEventListener = vi.fn((evt: string, cb: any) => { listListeners.target[evt] = cb; });

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: (tag: string) => makeDomNode(tag),
      createDocumentFragment: () => makeDomNode('fragment'),
      getElementById: vi.fn((id: string) => domNodesById.get(id) ?? null),
      querySelector: vi.fn((sel: string) => (sel === '.view-panel.active' ? { id: 'panel-translate' } : null)),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: vi.fn() },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      showNotification: vi.fn(),
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).dropZone = dropZone;
      (controller as any).sourceList = sourceList;
      (controller as any).targetList = targetList;
      (controller as any).sourceCountBadge = makeDomNode('span');
      (controller as any).targetCountBadge = makeDomNode('span');
      (controller as any).setupDropZone();
      (controller as any).setupSynchronizedHighlighting();
      await Promise.resolve();

      // Duplicate SRT cue numbers (#1, #1) render with distinct DOM IDs (1, 2)
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'First' },
        { id: 1, startMs: 1000, endMs: 2000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:02,000', text: 'Second' },
      ];
      controller.state.translatedCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'اول' },
        { id: 1, startMs: 1000, endMs: 2000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:02,000', text: 'دوم' },
      ];
      (controller as any).renderSourceCues();
      (controller as any).renderTargetCues();
      const srcItems = sourceList.children[0].children;
      const tgtItems = targetList.children[0].children;
      expect(srcItems[0].id).toBe('translate-source-cue-1');
      expect(srcItems[1].id).toBe('translate-source-cue-2');
      expect(tgtItems[1].id).toBe('translate-target-cue-2');

      domNodesById.set(srcItems[1].id, srcItems[1]);
      domNodesById.set(tgtItems[1].id, tgtItems[1]);

      // Hover highlights both; mouseout clears even when isScrollingThrottled is true
      listListeners.source.mouseover({ target: srcItems[1] });
      expect(srcItems[1].classList.contains('highlighted')).toBe(true);
      expect(tgtItems[1].classList.contains('highlighted')).toBe(true);
      (controller as any).isScrollingThrottled = true;
      listListeners.source.mouseout({ target: srcItems[1], relatedTarget: null });
      expect(srcItems[1].classList.contains('highlighted')).toBe(false);
      expect(tgtItems[1].classList.contains('highlighted')).toBe(false);

      // Tauri drag-over/leave and unsupported extension error feedback on drop
      tauriListeners['tauri://drag-over']?.({ payload: {} });
      expect(dropZone.classList.contains('drag-over')).toBe(true);
      tauriListeners['tauri://drag-leave']?.({ payload: {} });
      expect(dropZone.classList.contains('drag-over')).toBe(false);

      await tauriListeners['tauri://drag-drop']?.({ payload: { paths: ['/tmp/video.mp4'] } });
      expect((globalThis as any).window.showNotification).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported subtitle format'),
        'error'
      );

      controller.dispose();
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('preserves SRT/VTT dialogue lines containing -->, syncs learned model limits, guards loadSubtitleFile vs startTranslation race, handles post-translation read errors and API cancelled errors, matches model case-insensitively, and flushes provider switch cleanly', async () => {
    const { parseSubtitleContent } = await import('./translationStudio');

    const srtWithArrow = parseSubtitleContent(
      '1\n00:00:01,000 --> 00:00:04,000\nInput --> Output\nNext line\n',
      'srt'
    );
    expect(srtWithArrow).toHaveLength(1);
    expect(srtWithArrow[0].text).toBe('Input --> Output\nNext line');

    const vttWithArrow = parseSubtitleContent(
      'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nA --> B\n',
      'vtt'
    );
    expect(vttWithArrow).toHaveLength(1);
    expect(vttWithArrow[0].text).toBe('A --> B');

    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const saveCurrentSettingsSpy = vi.fn();
    const showNotificationSpy = vi.fn();
    let globalProviderValue = 'OpenAI';
    let providerChangeHandler: (() => void) | null = null;
    const onProviderChangedSpy = vi.fn(() => {
      // Simulate translationProviders.ts reading old settingsState.translateAiProvider before updating to new one
      expect((globalThis as any).window.settingsState.translateAiProvider).toBe('OpenAI');
      expect(globalProviderValue).toBe('Anthropic');
      (globalThis as any).window.settingsState.translateAiProvider = globalProviderValue;
    });

    const makeEl = () => {
      const attrs: Record<string, string> = {};
      return {
        value: '',
        textContent: '',
        title: '',
        className: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        disabled: false,
        children: [] as any[],
        appendChild(c: any) { this.children.push(c); return c; },
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    };

    const statusBadge = makeEl();
    const lblMsg = makeEl();
    const providerSelect = makeEl();
    providerSelect.addEventListener = vi.fn((evt: string, h: any) => {
      if (evt === 'change') providerChangeHandler = h;
    });
    const modelSelect = makeEl();
    const globalProviderEl: any = { value: 'OpenAI' };
    Object.defineProperty(globalProviderEl, 'value', {
      get: () => globalProviderValue,
      set: (v: string) => { globalProviderValue = v; },
    });

    let invokeImpl!: (cmd: string, args?: any) => Promise<any>;
    const invokeLocal = vi.fn((cmd: string, args?: any) => invokeImpl(cmd, args));

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: vi.fn(() => ({ value: '', textContent: '' })),
      getElementById: vi.fn((id: string) => {
        if (id === 'opt-translateAiProvider') return globalProviderEl;
        return null;
      }),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      saveCurrentSettings: saveCurrentSettingsSpy,
      onProviderChanged: onProviderChangedSpy,
      showNotification: showNotificationSpy,
      settingsState: {
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'GPT-4o', enabled: true, contextWindow: 128000 }] },
          { name: 'Anthropic', models: [{ id: 'claude-3-7', enabled: true }] },
        ]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).statusBadge = statusBadge;
      (controller as any).lblMsg = lblMsg;
      (controller as any).lblLines = makeEl();
      (controller as any).lblPct = makeEl();
      (controller as any).progressFill = makeEl();
      (controller as any).progressTrack = makeEl();
      (controller as any).telemetryBox = makeEl();
      (controller as any).btnStart = makeEl();
      (controller as any).btnStartText = makeEl();
      (controller as any).btnCancel = makeEl();
      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;
      (controller as any).setupEventListeners();
      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      // Case-insensitive model matching
      controller.refreshProviderOptions();
      expect(controller.state.activeModel).toBe('GPT-4o');
      expect(modelSelect.value).toBe('GPT-4o');

      // Provider switch calls onProviderChanged before mutating settingsState.translateAiProvider
      providerSelect.value = 'Anthropic';
      providerChangeHandler!();
      expect(onProviderChangedSpy).toHaveBeenCalledWith(true, true);

      // translation-model-limits-updated updates settingsState and syncs provider cache without calling saveCurrentSettings
      const syncProviderModelsSpy = vi.fn();
      (globalThis as any).window.syncProviderModelsFromSettings = syncProviderModelsSpy;
      const updatedJson = JSON.stringify([
        { name: 'OpenAI', models: [{ id: 'GPT-4o', enabled: true, contextWindow: 32000 }] },
      ]);
      tauriListeners['translation-model-limits-updated']?.({
        payload: { translateAiProviders: updatedJson },
      });
      expect((globalThis as any).window.settingsState.translateAiProviders).toBe(updatedJson);
      expect(syncProviderModelsSpy).toHaveBeenCalledTimes(1);
      expect(saveCurrentSettingsSpy).not.toHaveBeenCalled();

      // In-flight loadSubtitleFile is ignored once startTranslation starts
      controller.state.subtitlePath = '/dir/subA.srt';
      controller.state.subtitleName = 'subA.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Alpha' },
      ];
      const slowRead = deferred<string>();
      const translationDeferred = deferred<string[]>();
      invokeImpl = (cmd: string, args: any) => {
        if (cmd === 'read_text_file_content' && args.filePath === '/dir/subB.srt') return slowRead.promise;
        if (cmd === 'translate_transcription_files') return translationDeferred.promise;
        return Promise.resolve(null);
      };

      const pendingLoad = controller.loadSubtitleFile('/dir/subB.srt');
      const runningTranslate = controller.startTranslation();
      slowRead.resolve('1\n00:00:00,000 --> 00:00:01,000\nBeta');
      await pendingLoad;
      expect(controller.state.subtitlePath).toBe('/dir/subA.srt');
      expect(controller.state.sourceCues[0].text).toBe('Alpha');

      // Upstream API error containing "cancelled" is reported as failure, not user cancellation
      translationDeferred.reject('API returned error status (402): Subscription cancelled');
      await runningTranslate;
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(lblMsg.textContent).toContain('Subscription cancelled');

      // Post-translation read_text_file_content failure clears completion state and shows error in lblMsg
      invokeImpl = (cmd: string) => {
        if (cmd === 'translate_transcription_files') {
          tauriListeners['translation-status']?.({
            payload: { active: false, progress: 1.0, currentLine: 1, totalLines: 1, message: 'AI translation complete' },
          });
          return Promise.resolve(['subA.fa.srt']);
        }
        if (cmd === 'read_text_file_content') {
          return Promise.reject(new Error('File locked by antivirus'));
        }
        return Promise.resolve(null);
      };
      await controller.startTranslation();
      expect(controller.state.translatedPath).toBe('');
      expect((controller as any).lastProgressIsComplete).toBe(false);
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(lblMsg.textContent).toContain('File locked by antivirus');

      controller.dispose();
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('preserves detailed error when late Translation failed event arrives after catch, blocks deleted inputFile fallback in sendToHardsubStudio, prevents over-stripping movie names in detectCompanionVideo, toggles role="list", and cleans up listeners in dispose()', async () => {
    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const { hardsubController } = await import('./hardsub');
    const prevPrefill = (hardsubController as any).prefillFilePaths;
    const prefillSpy = vi.fn();
    (hardsubController as any).prefillFilePaths = prefillSpy;

    const makeEl = (id = '') => {
      const attrs: Record<string, string> = {};
      const classes = new Set<string>();
      const listeners: Record<string, Array<{ cb: Function; opts?: any }>> = {};
      return {
        id,
        value: '',
        textContent: '',
        title: '',
        className: '',
        innerHTML: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        disabled: false,
        children: [] as any[],
        listeners,
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        appendChild(c: any) { this.children.push(c); return c; },
        replaceChildren(...nodes: any[]) { this.children = nodes; },
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
        addEventListener: vi.fn((evt: string, cb: Function, opts?: any) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push({ cb, opts });
        }),
        removeEventListener: vi.fn((evt: string, cb: Function) => {
          if (!listeners[evt]) return;
          listeners[evt] = listeners[evt].filter(entry => entry.cb !== cb);
        }),
      };
    };

    const dropZone = makeEl('translate-drop-zone');
    const btnBrowseSub = makeEl('btn-browse-translate-sub');
    const btnStart = makeEl('btn-start-translation');
    const btnCancel = makeEl('btn-cancel-translation');
    const sourceList = makeEl('translate-source-cues-list');
    const targetList = makeEl('translate-target-cues-list');
    const sourceCountBadge = makeEl('translate-source-count');
    const targetCountBadge = makeEl('translate-target-count');
    const lblMsg = makeEl('lbl-translate-msg');
    const statusBadge = makeEl('translate-status-badge');
    const progressFill = makeEl('translate-progress-fill');
    const progressTrack = makeEl('translate-progress-track');
    const lblPct = makeEl('lbl-translate-pct');
    const lblLines = makeEl('lbl-translate-lines');
    const telemetryBox = makeEl('translate-telemetry-box');

    const seenCandidates: string[][] = [];
    const invokeLocal = vi.fn((cmd: string, args: any) => {
      if (cmd === 'read_text_file_content') {
        return Promise.resolve('1\n00:00:01,000 --> 00:00:02,000\nHello');
      }
      if (cmd === 'get_file_size') return Promise.resolve(40);
      if (cmd === 'find_existing_video_file') {
        seenCandidates.push(args.candidates);
        return Promise.resolve(args.candidates.find((c: string) => c === '/videos/movie.mp4') || null);
      }
      if (cmd === 'translate_transcription_files') {
        return Promise.reject('API returned error status (401): Invalid API key');
      }
      return Promise.resolve(null);
    });

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: () => makeEl(),
      createDocumentFragment: () => makeEl(),
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      showNotification: vi.fn(),
      switchView: vi.fn(),
      getCurrentSourceMediaFile: () => '/deleted/stale-video.mp4',
      settingsState: {
        translateAiProviders: JSON.stringify([{ name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] }]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).dropZone = dropZone;
      (controller as any).btnBrowseSub = btnBrowseSub;
      (controller as any).btnStart = btnStart;
      (controller as any).btnCancel = btnCancel;
      (controller as any).sourceList = sourceList;
      (controller as any).targetList = targetList;
      (controller as any).sourceCountBadge = sourceCountBadge;
      (controller as any).targetCountBadge = targetCountBadge;
      (controller as any).lblMsg = lblMsg;
      (controller as any).statusBadge = statusBadge;
      (controller as any).progressFill = progressFill;
      (controller as any).progressTrack = progressTrack;
      (controller as any).lblPct = lblPct;
      (controller as any).lblLines = lblLines;
      (controller as any).telemetryBox = telemetryBox;
      (controller as any).setupEventListeners();
      (controller as any).setupDropZone();
      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      // 1. Late "Translation failed" event must NOT erase detailed error from catch block
      controller.state.subtitlePath = '/videos/alien.srt';
      controller.state.subtitleName = 'alien.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.activeModel = 'gpt-4o';
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' },
      ];
      await controller.startTranslation();
      expect(lblMsg.textContent).toContain('Invalid API key');
      expect(lblMsg.title).toContain('Invalid API key');

      tauriListeners['translation-status']?.({
        payload: { active: false, progress: 0, message: 'Translation failed' },
      });
      expect(lblMsg.textContent).toContain('Invalid API key');
      expect(lblMsg.title).toContain('Invalid API key');
      controller.refreshLocalization();
      expect(lblMsg.textContent).toContain('Invalid API key');

      // 2. detectCompanionVideo does not strip non-separated suffixes from movie names like alien.srt / avatar.srt / frozen.srt
      await controller.loadSubtitleFile('/videos/alien.srt');
      await vi.waitFor(() => expect(seenCandidates.length).toBe(1));
      expect(seenCandidates[0]).not.toContain('/videos/ali.mp4');
      expect(seenCandidates[0]).toContain('/videos/alien.mp4');
      expect(controller.state.companionVideoPath).toBeNull();

      // Completed null probe blocks resurrecting deleted getCurrentSourceMediaFile() in sendToHardsubStudio()
      controller.state.translatedPath = '/videos/alien.fa.srt';
      controller.sendToHardsubStudio();
      expect(prefillSpy).toHaveBeenCalledWith('', '/videos/alien.fa.srt');

      // Separated language/translation suffixes still match companion video
      await controller.loadSubtitleFile('/videos/movie_translated.en.srt');
      await vi.waitFor(() => expect(controller.state.companionVideoPath).toBe('/videos/movie.mp4'));

      // 3. renderCueList removes role="list" when empty and sets role="list" when populated
      expect(sourceList.getAttribute('role')).toBe('list');
      expect(targetList.getAttribute('role')).toBeNull();

      // 4. dispose() cleans up DOM listeners registered in setupEventListeners & setupDropZone
      expect(dropZone.listeners.click?.length).toBe(1);
      expect(dropZone.listeners.drop?.length).toBe(1);
      expect(btnBrowseSub.listeners.click?.length).toBe(1);
      controller.dispose();
      expect(dropZone.listeners.click?.length).toBe(0);
      expect(dropZone.listeners.drop?.length).toBe(0);
      expect(btnBrowseSub.listeners.click?.length).toBe(0);
    } finally {
      if (prevPrefill === undefined) {
        delete (hardsubController as any).prefillFilePaths;
      } else {
        (hardsubController as any).prefillFilePaths = prevPrefill;
      }
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });
});

describe('translation studio regression fixes', () => {
  it('defers refreshProviderOptions/refreshModelOptions during active or starting translation and flushes after finish', async () => {
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const listenersByEl: Record<string, Record<string, Function[]>> = {};

    const makeMockEl = (id = '') => {
      const attrs: Record<string, string> = {};
      const children: any[] = [];
      const el: any = {
        id,
        value: '',
        checked: false,
        title: '',
        textContent: '',
        disabled: false,
        style: {},
        classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
        children,
        get innerHTML() {
          return '';
        },
        set innerHTML(_v: string) {
          children.length = 0;
        },
        appendChild: (c: any) => {
          children.push(c);
          return c;
        },
        setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
        removeAttribute: vi.fn((k: string) => { delete attrs[k]; }),
        getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
        addEventListener: vi.fn((evt: string, cb: Function) => {
          listenersByEl[id] ??= {};
          listenersByEl[id][evt] ??= [];
          listenersByEl[id][evt].push(cb);
        }),
        removeEventListener: vi.fn(),
        querySelectorAll: vi.fn(() => []),
      };
      return el;
    };

    const providerSelect = makeMockEl('providerSelect');
    const modelSelect = makeMockEl('modelSelect');
    const polishToggle = makeMockEl('polishToggle');
    const telemetryBox = makeMockEl('telemetryBox');
    const statusBadge = makeMockEl('statusBadge');
    const progressFill = makeMockEl('progressFill');
    const progressTrack = makeMockEl('progressTrack');
    const lblPct = makeMockEl('lblPct');
    const lblLines = makeMockEl('lblLines');
    const lblMsg = makeMockEl('lblMsg');

    const tauriListeners: Record<string, (e: any) => void> = {};
    const translationDeferred = deferred<string[]>();
    const flushCatalogSpy = vi.fn(() => {
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'OpenAI', models: [{ id: 'gpt-4o-flushed', enabled: true }] },
      ]);
    });
    const flushGeneralSpy = vi.fn(async () => {
      (globalThis as any).window.settingsState.translateAiCustomPrompt = 'Flushed prompt';
    });
    const saveSettingsSpy = vi.fn();
    const markDirtySpy = vi.fn();
    const invokeLocal = vi.fn((cmd: string, _args?: any) => {
      if (cmd === 'translate_transcription_files') return translationDeferred.promise;
      return Promise.resolve(null);
    });

    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: () => makeMockEl(),
      createDocumentFragment: () => makeMockEl(),
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      showNotification: vi.fn(),
      flushPendingModelCatalogChanges: flushCatalogSpy,
      flushPendingProviderGeneralChanges: flushGeneralSpy,
      saveCurrentSettings: saveSettingsSpy,
      markSettingsDirty: markDirtySpy,
      settingsState: {
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
        ]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiTargetLang: 'Persian',
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;
      (controller as any).polishToggle = polishToggle;
      (controller as any).telemetryBox = telemetryBox;
      (controller as any).statusBadge = statusBadge;
      (controller as any).progressFill = progressFill;
      (controller as any).progressTrack = progressTrack;
      (controller as any).lblPct = lblPct;
      (controller as any).lblLines = lblLines;
      (controller as any).lblMsg = lblMsg;
      (controller as any).setupEventListeners();
      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      // 1. polishToggle calls saveCurrentSettings synchronously without waiting on setTimeout
      polishToggle.checked = true;
      for (const cb of listenersByEl.polishToggle?.change || []) {
        cb();
      }
      expect(markDirtySpy).toHaveBeenCalledTimes(1);
      expect(saveSettingsSpy).toHaveBeenCalledTimes(1);

      // 2. Empty provider list shows selectProvider prompt instead of stale noModelError
      (globalThis as any).window.settingsState.translateAiProviders = '[]';
      controller.refreshProviderOptions();
      expect(providerSelect.children[0].textContent).toBe('Select Provider');

      // Restore provider and prepare subtitle
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
      ]);
      controller.refreshProviderOptions();
      controller.state.subtitlePath = '/videos/demo.srt';
      controller.state.subtitleName = 'demo.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.activeProvider = 'OpenAI';
      controller.state.activeModel = 'gpt-4o';
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' },
      ];

      // 3. startTranslation flushes debounced provider/model changes before snapshotting settings
      const runPromise = controller.startTranslation();
      await vi.waitFor(() => expect(invokeLocal).toHaveBeenCalledWith('translate_transcription_files', expect.anything()));
      expect(flushCatalogSpy).toHaveBeenCalledWith();
      expect(flushGeneralSpy).toHaveBeenCalledWith();
      const callArgs = invokeLocal.mock.calls.find(c => c[0] === 'translate_transcription_files')?.[1] as any;
      expect(callArgs.settings.translateAiCustomPrompt).toBe('Flushed prompt');
      expect(callArgs.settings.translateAiProviders).toContain('gpt-4o-flushed');
      expect(callArgs.settings.translateAiModel).toBe('gpt-4o-flushed');
      expect(controller.state.activeModel).toBe('gpt-4o-flushed');

      // 4. Mid-flight refreshProviderOptions / refreshModelOptions are blocked & deferred until completion
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
      ]);
      (globalThis as any).window.settingsState.translateAiProvider = 'Anthropic';
      (globalThis as any).window.settingsState.translateAiModel = 'claude-sonnet';
      controller.refreshProviderOptions();
      controller.refreshModelOptions();
      expect(controller.state.activeProvider).toBe('OpenAI');
      expect(controller.state.activeModel).toBe('gpt-4o-flushed');

      // Finish with empty output [], then fire late "Nothing to translate" status event
      translationDeferred.resolve([]);
      await runPromise;
      // After finish, deferred settings sync runs automatically
      expect(controller.state.activeProvider).toBe('Anthropic');
      expect(controller.state.activeModel).toBe('claude-sonnet');
      // Late "Nothing to translate" must preserve failed emptyTranslationError & visible telemetry
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      tauriListeners['translation-status']?.({
        payload: { active: false, progress: 1.0, message: 'Nothing to translate' },
      });
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusFailed');
      expect(lblMsg.getAttribute('data-i18n')).toBe('translate.emptyTranslationError');
      expect(telemetryBox.style.display).toBe('block');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('wires aria-controls and tabpanel roles cleanly on view mode tabs in translate.html and setViewMode', () => {
    const html = loadSourceFile('views/translate.html');
    expect(html).toContain('id="btn-view-split"');
    expect(html).toContain('aria-controls="translate-preview-grid"');
    expect(html).toContain('aria-controls="translate-source-pane"');
    expect(html).toContain('aria-controls="translate-target-pane"');
    expect(html).toContain('id="translate-preview-grid" role="tabpanel" aria-labelledby="btn-view-split"');
    expect(html).toContain('id="translate-output-location-modes" role="radiogroup" aria-labelledby="lbl-translate-output-folder"');
    expect(html).toContain('id="translate-output-mode-input" data-output-mode="input_dir" role="radio" aria-checked="true"');
    expect(html).toContain('id="translate-output-mode-custom" data-output-mode="custom" role="radio" aria-checked="false"');
    expect(html).toContain('id="translate-output-custom-row"');
    expect(html).toContain('id="btn-open-translate-dir"');
    expect(html).toContain('id="btn-browse-translate-dir" data-i18n="common.browse" type="button" aria-describedby="translate-output-dir-text"');
    expect(html).not.toContain('id="btn-reset-translate-dir"');

    const controller = new TranslationStudioController();
    const mkAttrEl = () => {
      const attrs: Record<string, string> = {};
      return {
        style: {} as Record<string, string>,
        classList: { add: vi.fn(), remove: vi.fn() },
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
        removeAttribute: (k: string) => { delete attrs[k]; },
        getAttribute: (k: string) => attrs[k] ?? null,
      };
    };
    const previewGrid = mkAttrEl();
    const sourcePane = mkAttrEl();
    const targetPane = mkAttrEl();
    (controller as any).previewGrid = previewGrid;
    (controller as any).sourcePane = sourcePane;
    (controller as any).targetPane = targetPane;

    controller.setViewMode('source');
    expect(previewGrid.getAttribute('role')).toBeNull();
    expect(sourcePane.getAttribute('role')).toBe('tabpanel');
    expect(sourcePane.getAttribute('aria-labelledby')).toBe('btn-view-source');
    expect(targetPane.getAttribute('role')).toBeNull();

    controller.setViewMode('target');
    expect(previewGrid.getAttribute('role')).toBeNull();
    expect(targetPane.getAttribute('role')).toBe('tabpanel');
    expect(targetPane.getAttribute('aria-labelledby')).toBe('btn-view-target');
    expect(sourcePane.getAttribute('role')).toBeNull();

    controller.setViewMode('split');
    expect(previewGrid.getAttribute('role')).toBe('tabpanel');
    expect(previewGrid.getAttribute('aria-labelledby')).toBe('btn-view-split');
    expect(sourcePane.getAttribute('role')).toBeNull();
    expect(targetPane.getAttribute('role')).toBeNull();
  });

  it('omits fabricated 3s duration badge on LRC cues while showing duration on SRT cues', () => {
    const controller = new TranslationStudioController();
    const lrcHtmlContainer: any = { innerHTML: '', removeAttribute: vi.fn() };
    (controller as any).renderCueList(lrcHtmlContainer, [
      { id: 1, startMs: 5000, endMs: 5000, startTimeStr: '00:05.00', endTimeStr: '', text: 'Lyric line' },
    ], false);
    expect(lrcHtmlContainer.innerHTML).not.toContain('translate-cue-dur');

    const srtHtmlContainer: any = { innerHTML: '', removeAttribute: vi.fn() };
    (controller as any).renderCueList(srtHtmlContainer, [
      { id: 1, startMs: 1000, endMs: 4000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:04,000', text: 'Spoken line' },
    ], false);
    expect(srtHtmlContainer.innerHTML).toContain('translate-cue-dur');
    expect(srtHtmlContainer.innerHTML).toContain('3 sec');
  });

  it('formats subtitle cue count badge using localized Persian digits in fa mode', async () => {
    const { setLanguage, getLanguage } = await import('./i18n/index');
    const prevLang = getLanguage();
    const origDoc = (globalThis as any).document;
    (globalThis as any).document = {
      ...origDoc,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: {
        setAttribute: vi.fn(),
        getAttribute: () => 'rtl',
        classList: { add: vi.fn(), remove: vi.fn() },
      },
      body: { classList: { add: vi.fn(), remove: vi.fn() } },
    };
    const controller = new TranslationStudioController();
    const lblSubMeta: any = { textContent: '', style: {} as Record<string, string>, setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const mkAttr = () => ({ textContent: '', title: '', style: {} as Record<string, string>, classList: { add: vi.fn(), remove: vi.fn() }, setAttribute: vi.fn(), removeAttribute: vi.fn() });
    (controller as any).lblSubName = mkAttr();
    (controller as any).lblSubPath = mkAttr();
    (controller as any).lblSubMeta = lblSubMeta;
    (controller as any).btnClearSub = mkAttr();
    controller.state.subtitlePath = '/dir/movie.srt';
    controller.state.subtitleName = 'movie.srt';
    controller.state.subtitleExt = 'srt';
    controller.state.sourceCues = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi',
    }));

    setLanguage('fa');
    try {
      (controller as any).updateSubtitleInfoUI();
      expect(lblSubMeta.textContent).toContain('۱۲');
      expect(lblSubMeta.textContent).not.toContain('12');
    } finally {
      setLanguage(prevLang);
      (globalThis as any).document = origDoc;
    }
  });

  it('keeps sync scrolling working after pointerdown on source followed by arrow navigation into target and releases stale pointer driver', async () => {
    vi.useFakeTimers();
    try {
      const controller = new TranslationStudioController();
      const sourceHandlers: Record<string, any> = {};
      const targetHandlers: Record<string, any> = {};
      const sourceCue: any = {
        classList: { contains: (c: string) => c === 'translate-cue-item', add: vi.fn(), remove: vi.fn() },
        dataset: { id: '1' },
        focus: vi.fn(),
        scrollIntoView: vi.fn(),
        closest: (sel: string) => (sel === '.translate-cue-item' ? sourceCue : null),
      };
      const targetCue1: any = {
        classList: { contains: (c: string) => c === 'translate-cue-item', add: vi.fn(), remove: vi.fn() },
        dataset: { id: '1' },
        focus: vi.fn(),
        scrollIntoView: vi.fn(),
        closest: (sel: string) => (sel === '.translate-cue-item' ? targetCue1 : null),
      };
      const targetCue2: any = {
        classList: { contains: (c: string) => c === 'translate-cue-item', add: vi.fn(), remove: vi.fn() },
        dataset: { id: '2' },
        focus: vi.fn(),
        scrollIntoView: vi.fn(),
        closest: (sel: string) => (sel === '.translate-cue-item' ? targetCue2 : null),
      };
      targetCue1.nextElementSibling = targetCue2;

      const sourceList: any = {
        scrollTop: 0, scrollHeight: 1000, clientHeight: 200,
        addEventListener: vi.fn((evt: string, h: any) => { sourceHandlers[evt] = h; }),
        removeEventListener: vi.fn(),
      };
      const targetList: any = {
        scrollTop: 500, scrollHeight: 1000, clientHeight: 200,
        addEventListener: vi.fn((evt: string, h: any) => { targetHandlers[evt] = h; }),
        removeEventListener: vi.fn(),
      };
      sourceCue.parentElement = sourceList;
      targetCue1.parentElement = targetList;
      targetCue2.parentElement = targetList;

      (controller as any).sourceList = sourceList;
      (controller as any).targetList = targetList;

      const origDoc = (globalThis as any).document;
      const origWin = (globalThis as any).window;
      const rafCallbacks: FrameRequestCallback[] = [];
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
      (globalThis as any).document = {
        documentElement: { getAttribute: () => 'ltr' },
        getElementById: (id: string) => (id === 'translate-target-cue-1' ? targetCue1 : null),
      };
      try {
        (controller as any).setupSynchronizedHighlighting();
        (controller as any).setupSynchronizedScrolling();

        // Pointerdown on source without scroll sets temporary driver on sourceList
        sourceHandlers['pointerdown']();
        expect((controller as any).activeScrollDriver).toBe(sourceList);

        // Navigating via ArrowRight -> Target, then ArrowDown in Target switches driver to targetList
        sourceHandlers['keydown']({
          key: 'ArrowRight', defaultPrevented: false, isComposing: false,
          ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
          target: sourceCue, preventDefault: vi.fn(),
        });
        expect((controller as any).activeScrollDriver).toBe(targetList);

        targetHandlers['keydown']({
          key: 'ArrowDown', defaultPrevented: false, isComposing: false,
          ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
          target: targetCue1, preventDefault: vi.fn(),
        });
        targetHandlers['scroll']();
        while (rafCallbacks.length) rafCallbacks.shift()!(0);
        expect(sourceList.scrollTop).toBe(500);

        // Stale pointerdown driver clears automatically after timeout
        vi.advanceTimersByTime(250);
        sourceHandlers['pointerdown']();
        expect((controller as any).activeScrollDriver).toBe(sourceList);
        vi.advanceTimersByTime(200);
        expect((controller as any).activeScrollDriver).toBeNull();
      } finally {
        (globalThis as any).document = origDoc;
        (globalThis as any).window = origWin;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up late-resolving listen() unlisteners if dispose() ran first', async () => {
    const lateUnlisten = vi.fn();
    const d1 = deferred<(() => void) | undefined>();
    const d2 = deferred<(() => void) | undefined>();
    const origWin = (globalThis as any).window;
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke },
        event: {
          listen: vi.fn((name: string) => name === 'translation-status' ? d1.promise : d2.promise),
        },
      },
    };
    try {
      const controller = new TranslationStudioController();
      (controller as any).listenToProgressEvents();
      controller.dispose();
      d1.resolve(lateUnlisten);
      d2.resolve(undefined);
      await Promise.resolve();
      await Promise.resolve();
      expect(lateUnlisten).toHaveBeenCalledTimes(1);
      expect((controller as any).unlisteners).toHaveLength(0);
    } finally {
      (globalThis as any).window = origWin;
    }
  });

  it('ignores HTML5 dragleave when moving onto child elements and blocks btnResetDir while busy', async () => {
    const controller = new TranslationStudioController();
    const dropHandlers: Record<string, any> = {};
    const childNode = { id: 'child' };
    const outsideNode = { id: 'outside' };
    const dropZoneMock: any = {
      addEventListener: vi.fn((evt: string, h: any) => { dropHandlers[evt] = h; }),
      removeEventListener: vi.fn(),
      contains: vi.fn((node: any) => node === childNode),
      classList: { add: vi.fn(), remove: vi.fn() },
    };
    (controller as any).dropZone = dropZoneMock;
    (controller as any).setupDropZone();

    dropHandlers['dragleave']({ preventDefault: vi.fn(), stopPropagation: vi.fn(), relatedTarget: childNode });
    expect(dropZoneMock.classList.remove).not.toHaveBeenCalled();

    dropHandlers['dragleave']({ preventDefault: vi.fn(), stopPropagation: vi.fn(), relatedTarget: outsideNode });
    expect(dropZoneMock.classList.remove).toHaveBeenCalledWith('drag-over');

    // outputModeInputBtn guard during active translation
    const btnHandlers: Record<string, any> = {};
    const outputModeInputBtn: any = { addEventListener: vi.fn((evt: string, h: any) => { btnHandlers[evt] = h; }), style: {}, classList: { toggle: vi.fn() }, setAttribute: vi.fn() };
    (controller as any).outputModeInputBtn = outputModeInputBtn;
    (controller as any).setupEventListeners();
    controller.state.outputDir = '/custom/out';
    controller.state.outputDirMode = 'custom';
    controller.state.isTranslating = true;
    btnHandlers['click']();
    expect(controller.state.outputDir).toBe('/custom/out');
    expect(controller.state.outputDirMode).toBe('custom');
  });

  it('retries early cancel_transcription when session startup is not yet Translating and respects reduced motion', async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      invoke.mockImplementation((cmd: string) => {
        if (cmd === 'cancel_transcription') {
          attempts++;
          if (attempts === 1) return Promise.reject(new Error('No active transcription or translation session'));
          return Promise.resolve(undefined);
        }
        return Promise.resolve(null);
      });

      const controller = new TranslationStudioController();
      controller.state.isTranslating = true;
      (controller as any).btnCancel = { disabled: false };

      const cancelPromise = controller.cancelTranslation();
      await vi.advanceTimersByTimeAsync(70);
      await cancelPromise;

      expect(attempts).toBe(2);
      expect((controller as any).isCancellingTranslation).toBe(true);

      // prefers-reduced-motion selects 'auto' scroll behavior
      const origWin = (globalThis as any).window;
      const scrollSpy = vi.fn();
      (globalThis as any).window = {
        ...origWin,
        matchMedia: vi.fn(() => ({ matches: true })),
      };
      try {
        (controller as any).scrollCueIntoView({ scrollIntoView: scrollSpy });
        expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
      } finally {
        (globalThis as any).window = origWin;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks config controls and reverts change events during isStartingTranslation flush, and handles flush rejection cleanly', async () => {
    const flushDeferred = deferred<boolean>();
    const flushCatalogSpy = vi.fn(() => true);
    const flushGeneralSpy = vi.fn(() => flushDeferred.promise);
    const showNotification = vi.fn();

    const origWin = (globalThis as any).window;
    (globalThis as any).window = {
      ...origWin,
      settingsState: { translateAiProviders: '[]' },
      flushPendingModelCatalogChanges: flushCatalogSpy,
      flushPendingProviderGeneralChanges: flushGeneralSpy,
      showNotification,
    };

    try {
      const controller = new TranslationStudioController();
      const providerHandlers: Record<string, any> = {};
      const providerSelect: any = {
        value: 'OpenAI',
        disabled: false,
        addEventListener: vi.fn((evt: string, h: any) => { providerHandlers[evt] = h; }),
        removeEventListener: vi.fn(),
      };
      const modelSelect: any = { value: 'gpt-4o', disabled: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      const targetLangSelect: any = { value: 'Persian', disabled: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      const polishToggle: any = { checked: false, disabled: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      const btnStart: any = { disabled: false, title: '', setAttribute: vi.fn() };

      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;
      (controller as any).targetLangSelect = targetLangSelect;
      (controller as any).polishToggle = polishToggle;
      (controller as any).btnStart = btnStart;
      (controller as any).setupEventListeners();

      controller.state.subtitlePath = '/tmp/movie.srt';
      controller.state.subtitleName = 'movie.srt';
      controller.state.activeProvider = 'OpenAI';
      controller.state.activeModel = 'gpt-4o';
      controller.state.targetLang = 'Persian';
      controller.state.polishPass = false;

      const startPromise = controller.startTranslation();

      // Immediately locked before flushPendingProviderGeneralChanges resolves
      expect((controller as any).isStartingTranslation).toBe(true);
      expect(providerSelect.disabled).toBe(true);
      expect(modelSelect.disabled).toBe(true);
      expect(targetLangSelect.disabled).toBe(true);
      expect(polishToggle.disabled).toBe(true);
      expect(btnStart.disabled).toBe(true);
      expect(flushCatalogSpy).toHaveBeenCalledWith();
      expect(flushGeneralSpy).toHaveBeenCalledWith();

      // Changing provider during startup flush must be ignored and reverted
      providerSelect.value = 'Anthropic';
      providerHandlers['change']();
      expect(controller.state.activeProvider).toBe('OpenAI');
      expect(providerSelect.value).toBe('OpenAI');

      // If flush rejects, startTranslation catches cleanly, unlocks controls, and never invokes backend
      flushDeferred.reject(new Error('Keyring locked'));
      await startPromise;

      expect((controller as any).isStartingTranslation).toBe(false);
      expect(controller.state.isTranslating).toBe(false);
      expect(providerSelect.disabled).toBe(false);
      expect(btnStart.disabled).toBe(false);
      expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('Keyring locked'), 'error');
      expect(invoke).not.toHaveBeenCalledWith('translate_transcription_files', expect.anything());
    } finally {
      (globalThis as any).window = origWin;
    }
  });

  it('loadSubtitleFile returns true on success and false on unsupported format or read failure', async () => {
    const controller = new TranslationStudioController();
    expect(await controller.loadSubtitleFile('/tmp/video.mp4')).toBe(false);

    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'read_text_file_content') return Promise.reject(new Error('Not found'));
      return Promise.resolve(null);
    });
    expect(await controller.loadSubtitleFile('/tmp/missing.srt')).toBe(false);

    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'read_text_file_content') return Promise.resolve('1\n00:00:01,000 --> 00:00:02,000\nHi\n');
      return Promise.resolve(null);
    });
    expect(await controller.loadSubtitleFile('/tmp/ok.srt')).toBe(true);
  });

  it('aborts startTranslation when flush disables all models, resolves cancel race cleanly, and updates model before fallback save', async () => {
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;
    const tauriListeners: Record<string, (e: any) => void> = {};

    const makeEl = () => {
      const attrs: Record<string, string> = {};
      const children: any[] = [];
      const handlers: Record<string, Function[]> = {};
      return {
        value: '',
        disabled: false,
        title: '',
        textContent: '',
        style: {} as Record<string, string>,
        children,
        handlers,
        get innerHTML() { return ''; },
        set innerHTML(_v: string) { children.length = 0; },
        appendChild: (c: any) => { children.push(c); return c; },
        setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
        removeAttribute: vi.fn((k: string) => { delete attrs[k]; }),
        getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
        classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
        addEventListener: vi.fn((evt: string, cb: Function) => {
          handlers[evt] ??= [];
          handlers[evt].push(cb);
        }),
        removeEventListener: vi.fn(),
      } as any;
    };

    const providerSelect = makeEl();
    const modelSelect = makeEl();
    const statusBadge = makeEl();
    const lblMsg = makeEl();
    const progressFill = makeEl();
    const progressTrack = makeEl();
    const lblPct = makeEl();
    const lblLines = makeEl();
    const telemetryBox = makeEl();

    const showNotification = vi.fn();
    let savedSettingsSnapshot: any = null;
    const saveCurrentSettings = vi.fn(() => {
      savedSettingsSnapshot = { ...(globalThis as any).window.settingsState };
    });

    const invokeLocal = vi.fn();
    const createdOptions: any[] = [];
    (globalThis as any).document = {
      readyState: 'loading',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      createElement: () => {
        const opt: any = { value: '', textContent: '', disabled: false, selected: false };
        createdOptions.push(opt);
        return opt;
      },
      getElementById: vi.fn(() => null),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      showNotification,
      saveCurrentSettings,
      settingsState: {
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
          { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
        ]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiTargetLang: 'Persian',
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;
      (controller as any).statusBadge = statusBadge;
      (controller as any).lblMsg = lblMsg;
      (controller as any).progressFill = progressFill;
      (controller as any).progressTrack = progressTrack;
      (controller as any).lblPct = lblPct;
      (controller as any).lblLines = lblLines;
      (controller as any).telemetryBox = telemetryBox;
      (controller as any).setupEventListeners();
      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      // 1. Empty model placeholder option must be disabled so CustomSelect treats it as non-selectable
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'OpenAI', models: [] },
      ]);
      controller.refreshProviderOptions();
      expect(modelSelect.children[0].value).toBe('');
      expect(modelSelect.children[0].disabled).toBe(true);

      // 2. Fallback provider change (no win.onProviderChanged) updates activeModel BEFORE saveCurrentSettings()
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
        { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
      ]);
      controller.refreshProviderOptions();
      providerSelect.value = 'Anthropic';
      for (const cb of providerSelect.handlers.change || []) cb();
      expect(saveCurrentSettings).toHaveBeenCalledTimes(1);
      expect(savedSettingsSnapshot.translateAiProvider).toBe('Anthropic');
      expect(savedSettingsSnapshot.translateAiModel).toBe('claude-sonnet');

      // 3. startTranslation aborts before running if flushPendingModelCatalogChanges removes/disables all models
      controller.state.subtitlePath = '/dir/sub.srt';
      controller.state.subtitleName = 'sub.srt';
      controller.state.subtitleExt = 'srt';
      controller.state.sourceCues = [
        { id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' },
      ];
      (globalThis as any).window.flushPendingModelCatalogChanges = () => {
        (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
          { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: false }] },
        ]);
      };
      await controller.startTranslation();
      expect(invokeLocal).not.toHaveBeenCalledWith('translate_transcription_files', expect.anything());
      expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'error');
      expect(controller.state.isTranslating).toBe(false);

      // 4. Cancel race: backend emits "Translation failed" while isCancellingTranslation is true, then rejects
      (globalThis as any).window.flushPendingModelCatalogChanges = undefined;
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
      ]);
      controller.refreshProviderOptions();

      const pending = deferred<string[]>();
      invokeLocal.mockImplementation((cmd: string) => {
        if (cmd === 'translate_transcription_files') return pending.promise;
        return Promise.resolve(null);
      });
      const runPromise = controller.startTranslation();
      await vi.waitFor(() => expect(invokeLocal).toHaveBeenCalledWith('translate_transcription_files', expect.anything()));

      await controller.cancelTranslation();
      tauriListeners['translation-status']?.({
        payload: { active: false, progress: 0.4, currentLine: 1, totalLines: 5, message: 'Translation failed' },
      });
      pending.reject(new Error('Upstream aborted'));
      await runPromise;

      expect((controller as any).lastProgressIsFailed).toBe(false);
      expect((controller as any).lastProgressIsCancelled).toBe(true);
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusCancelled');
      expect(lblMsg.textContent).toBe('Translation Cancelled');

      controller.refreshLocalization();
      expect(statusBadge.getAttribute('data-i18n')).toBe('translate.statusCancelled');
      expect(lblMsg.textContent).toBe('Translation Cancelled');
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('syncs CustomSelects and settingsState on provider/model reconciliation, preserves cancel data-i18n before status events, and resets cue list scrollTop on load and clear', async () => {
    const tauriListeners: Record<string, (e: any) => void> = {};
    const origDoc = (globalThis as any).document;
    const origWin = (globalThis as any).window;

    let invokeHandler: (cmd: string, args?: any) => Promise<any> = async () => null;
    const invokeLocal = vi.fn((cmd: string, args?: any) => invokeHandler(cmd, args));
    const syncCustomSelects = vi.fn();
    const showNotification = vi.fn();

    const makeSelect = () => {
      const el: any = {
        value: '',
        disabled: false,
        children: [] as any[],
        handlers: {} as Record<string, Function[]>,
        set innerHTML(v: string) {
          if (v === '') this.children = [];
        },
        appendChild(child: any) {
          this.children.push(child);
          if (child.selected) this.value = child.value;
        },
        addEventListener(ev: string, cb: Function) {
          (this.handlers[ev] ||= []).push(cb);
        },
        removeEventListener: vi.fn(),
      };
      return el;
    };

    const makeEl = () => {
      const attrs: Record<string, string> = {};
      return {
        textContent: '',
        title: '',
        className: '',
        innerHTML: '',
        scrollTop: 0,
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        disabled: false,
        classList: { add: vi.fn(), remove: vi.fn(), contains: () => false },
        setAttribute(k: string, v: string) { attrs[k] = v; },
        removeAttribute(k: string) { delete attrs[k]; },
        getAttribute(k: string) { return attrs[k] ?? null; },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
    };

    const providerSelect = makeSelect();
    const modelSelect = makeSelect();
    const lblMsg = makeEl();
    const statusBadge = makeEl();
    const progressFill = makeEl();
    const progressTrack = makeEl();
    const lblPct = makeEl();
    const lblLines = makeEl();
    const telemetryBox = makeEl();
    const sourceList = makeEl();
    const targetList = makeEl();
    const sourceCountBadge = makeEl();
    const targetCountBadge = makeEl();

    (globalThis as any).document = {
      readyState: 'loading',
      title: '',
      documentElement: {
        setAttribute: vi.fn(),
        getAttribute: () => null,
        classList: { add: vi.fn(), remove: vi.fn() },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        value: '',
        textContent: '',
        disabled: false,
        selected: false,
        className: '',
        dataset: {},
        style: {},
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
      }),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: { invoke: invokeLocal },
        event: {
          listen: vi.fn((ev: string, cb: (e: any) => void) => {
            tauriListeners[ev] = cb;
            return Promise.resolve(() => {});
          }),
        },
      },
      syncCustomSelects,
      showNotification,
      settingsState: {
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
          { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
        ]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiTargetLang: 'Persian',
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).providerSelect = providerSelect;
      (controller as any).modelSelect = modelSelect;
      (controller as any).lblMsg = lblMsg;
      (controller as any).statusBadge = statusBadge;
      (controller as any).progressFill = progressFill;
      (controller as any).progressTrack = progressTrack;
      (controller as any).lblPct = lblPct;
      (controller as any).lblLines = lblLines;
      (controller as any).telemetryBox = telemetryBox;
      (controller as any).sourceList = sourceList;
      (controller as any).targetList = targetList;
      (controller as any).sourceCountBadge = sourceCountBadge;
      (controller as any).targetCountBadge = targetCountBadge;
      (controller as any).setupEventListeners();
      (controller as any).listenToProgressEvents();
      await Promise.resolve();

      controller.refreshProviderOptions();
      syncCustomSelects.mockClear();

      // 1. Scroll position resets on loadSubtitleFile and clearLoadedSubtitle
      sourceList.scrollTop = 240;
      targetList.scrollTop = 180;
      invokeHandler = async (cmd: string) => {
        if (cmd === 'read_text_file_content') {
          return '1\n00:00:01,000 --> 00:00:02,000\nHello\n';
        }
        return null;
      };
      await controller.loadSubtitleFile('/dir/movie.srt');
      expect(sourceList.scrollTop).toBe(0);
      expect(targetList.scrollTop).toBe(0);

      sourceList.scrollTop = 120;
      targetList.scrollTop = 90;
      controller.clearLoadedSubtitle();
      expect(sourceList.scrollTop).toBe(0);
      expect(targetList.scrollTop).toBe(0);

      // Load subtitle again for translation tests
      await controller.loadSubtitleFile('/dir/movie.srt');

      // 2. When flush disables all models of active provider, abort AND rebuild modelSelect + syncCustomSelects
      (globalThis as any).window.flushPendingModelCatalogChanges = () => {
        (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
          { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: false }] },
        ]);
      };
      await controller.startTranslation();
      expect(invokeLocal).not.toHaveBeenCalledWith('translate_transcription_files', expect.anything());
      expect(modelSelect.children).toHaveLength(1);
      expect(modelSelect.children[0].value).toBe('');
      expect(modelSelect.children[0].disabled).toBe(true);
      expect(syncCustomSelects).toHaveBeenCalled();

      // 3. When flush replaces active provider/model with another enabled option, reconcile UI + settingsState + CustomSelects
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
        { name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] },
      ]);
      controller.refreshProviderOptions();
      syncCustomSelects.mockClear();

      (globalThis as any).window.flushPendingModelCatalogChanges = () => {
        (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify([
          { name: 'Anthropic', models: [{ id: 'claude-sonnet', enabled: true }] },
        ]);
        (globalThis as any).window.settingsState.translateAiProvider = 'Anthropic';
        (globalThis as any).window.settingsState.translateAiModel = 'claude-sonnet';
      };

      const pending = deferred<string[]>();
      invokeHandler = (cmd: string) => {
        if (cmd === 'translate_transcription_files') return pending.promise;
        return Promise.resolve(null);
      };

      const runPromise = controller.startTranslation();
      await vi.waitFor(() => expect(invokeLocal).toHaveBeenCalledWith('translate_transcription_files', expect.anything()));
      expect(controller.state.activeProvider).toBe('Anthropic');
      expect(controller.state.activeModel).toBe('claude-sonnet');
      expect(providerSelect.value).toBe('Anthropic');
      expect(modelSelect.value).toBe('claude-sonnet');
      expect(syncCustomSelects).toHaveBeenCalled();

      // 4. Cancel before any translation-status event preserves data-i18n on lblMsg for refreshLocalization()
      (globalThis as any).window.flushPendingModelCatalogChanges = undefined;
      await controller.cancelTranslation();
      pending.reject(new Error('Translation cancelled by user'));
      await runPromise;

      expect(lblMsg.getAttribute('data-i18n')).toBe('translate.statusCancelled');
      expect(lblMsg.textContent).toBe('Translation Cancelled');

      const { setLanguage } = await import('./i18n/index');
      setLanguage('fa', false);
      controller.refreshLocalization();
      expect(lblMsg.getAttribute('data-i18n')).toBe('translate.statusCancelled');
      expect(lblMsg.textContent).toBe('ترجمه لغو شد');
      setLanguage('en', false);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('matches Transcribe Output Files Save Location behavior: preserves custom path, verifies writability, opens folder, supports keyboard navigation, and updates scroll cue', async () => {
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const showNotification = vi.fn();

    let nextSelectedDir: string | null = null;
    let writableError: Error | null = null;
    const invokeLocal = vi.fn(async (cmd: string, args?: any) => {
      if (cmd === 'select_directory') return nextSelectedDir;
      if (cmd === 'verify_directory_writable') {
        if (writableError) throw writableError;
        return null;
      }
      if (cmd === 'open_file_in_editor') return null;
      if (cmd === 'translate_transcription_files') return ['movie.fa.srt'];
      if (cmd === 'read_text_file_content') return '1\n00:00:01,000 --> 00:00:02,000\nسلام\n';
      return null;
    });

    const makeEl = (id: string) => {
      const attrs: Record<string, string> = {};
      const listeners: Record<string, Function[]> = {};
      const classes = new Set<string>();
      return {
        id,
        disabled: false,
        textContent: '',
        title: '',
        style: {} as Record<string, string>,
        focus: vi.fn(),
        setAttribute: (k: string, v: string) => { attrs[k] = v; },
        removeAttribute: (k: string) => { delete attrs[k]; },
        getAttribute: (k: string) => attrs[k] ?? null,
        addEventListener: (evt: string, fn: Function) => { (listeners[evt] ??= []).push(fn); },
        removeEventListener: (evt: string, fn: Function) => {
          listeners[evt] = (listeners[evt] ?? []).filter(f => f !== fn);
        },
        dispatch: (evt: string, payload: any = {}) => {
          for (const fn of listeners[evt] ?? []) fn(payload);
        },
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          toggle: (c: string, force?: boolean) => {
            const next = force !== undefined ? force : !classes.has(c);
            if (next) classes.add(c);
            else classes.delete(c);
            return next;
          },
          contains: (c: string) => classes.has(c),
        },
      };
    };

    const unifiedDeck = makeEl('translate-unified-deck');
    const deckBody: any = { ...makeEl('deck-body'), scrollHeight: 800, clientHeight: 400, scrollTop: 0 };
    const modeGroup = makeEl('translate-output-location-modes');
    const modeInputBtn = makeEl('translate-output-mode-input');
    const modeCustomBtn = makeEl('translate-output-mode-custom');
    const customRow = makeEl('translate-output-custom-row');
    const outputDirText = makeEl('translate-output-dir-text');
    const btnOpenDir = makeEl('btn-open-translate-dir');
    const btnBrowseDir = makeEl('btn-browse-translate-dir');

    (globalThis as any).document = {
      ...origDoc,
      activeElement: modeCustomBtn,
    };
    (globalThis as any).window = {
      ...origWin,
      showNotification,
      __TAURI__: { core: { invoke: invokeLocal } },
    };

    const controller = new TranslationStudioController();
    (controller as any).unifiedDeck = unifiedDeck;
    (controller as any).deckBody = deckBody;
    (controller as any).outputLocationModes = modeGroup;
    (controller as any).outputModeInputBtn = modeInputBtn;
    (controller as any).outputModeCustomBtn = modeCustomBtn;
    (controller as any).outputCustomRow = customRow;
    (controller as any).outputDirText = outputDirText;
    (controller as any).btnOpenDir = btnOpenDir;
    (controller as any).btnBrowseDir = btnBrowseDir;
    (controller as any).setupEventListeners();
    (controller as any).updateOutputDirUI();

    try {
      // 1. Scroll cue reflects overflow on .translate-deck-body
      expect(unifiedDeck.classList.contains('has-scroll-below')).toBe(true);
      deckBody.scrollTop = 398;
      controller.updateDeckScrollCue();
      expect(unifiedDeck.classList.contains('has-scroll-below')).toBe(false);

      // 2. Switching to custom with empty path expands custom panel without opening OS directory picker
      modeGroup.dispatch('keydown', {
        key: 'ArrowRight',
        target: modeInputBtn,
        preventDefault: vi.fn(),
      });
      await vi.waitFor(() => expect(modeCustomBtn.focus).toHaveBeenCalled());
      expect(invokeLocal).not.toHaveBeenCalledWith('select_directory', expect.anything());
      expect(controller.state.outputDirMode).toBe('custom');
      expect(modeCustomBtn.getAttribute('aria-checked')).toBe('true');
      expect(modeInputBtn.getAttribute('aria-checked')).toBe('false');
      expect(customRow.style.display).toBe('block');
      expect(outputDirText.getAttribute('data-i18n')).toBe('settings.outputDirSelectPlaceholder');
      expect(btnOpenDir.disabled).toBe(true);

      // 2b. Starting translation while custom mode has no folder prompts user and does not run backend
      (globalThis as any).window.settingsState = {
        translateAiProviders: JSON.stringify([{ name: 'OpenAI', models: [{ id: 'gpt-4o', enabled: true }] }]),
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
      };
      controller.state.activeProvider = 'OpenAI';
      controller.state.activeModel = 'gpt-4o';
      controller.state.subtitlePath = '/src/movie.srt';
      controller.state.subtitleName = 'movie.srt';
      controller.state.subtitleExt = 'srt';
      await controller.startTranslation();
      expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'error');
      expect(invokeLocal).not.toHaveBeenCalledWith('translate_transcription_files', expect.anything());

      // 3. Selecting non-writable folder via Browse shows error and keeps empty path
      showNotification.mockClear();
      nextSelectedDir = '/readonly/dir';
      writableError = new Error('Permission denied');
      await controller.browseOutputDir();
      expect(invokeLocal).toHaveBeenCalledWith('verify_directory_writable', { dirPath: '/readonly/dir' });
      expect(controller.state.outputDir).toBe('');
      expect(controller.state.outputDirMode).toBe('custom');
      expect(customRow.style.display).toBe('block');
      expect(btnOpenDir.disabled).toBe(true);
      expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('Permission denied'), 'error');

      // 4. Selecting writable folder via Browse populates path and enables open button
      writableError = null;
      nextSelectedDir = '/tmp/translated-out';
      await controller.browseOutputDir();
      expect(controller.state.outputDir).toBe('/tmp/translated-out');
      expect(controller.state.outputDirMode).toBe('custom');
      expect(customRow.style.display).toBe('block');
      expect(outputDirText.textContent).toBe('/tmp/translated-out');
      expect(btnOpenDir.disabled).toBe(false);

      // 5. Switching back to input_dir hides custom row while preserving remembered path
      await controller.setOutputDirMode('input_dir');
      expect(controller.state.outputDirMode).toBe('input_dir');
      expect(controller.state.outputDir).toBe('/tmp/translated-out');
      expect(customRow.style.display).toBe('none');

      // 6. startTranslation in input_dir mode passes outputDir: null despite preserved custom path
      await controller.startTranslation();
      expect(invokeLocal).toHaveBeenCalledWith(
        'translate_transcription_files',
        expect.objectContaining({ outputDir: null, parentDir: '/src' })
      );

      // 7. Switching back to custom restores without browsing and startTranslation passes custom path
      invokeLocal.mockClear();
      await controller.setOutputDirMode('custom');
      expect(invokeLocal).not.toHaveBeenCalledWith('select_directory', expect.anything());
      expect(customRow.style.display).toBe('block');
      await controller.startTranslation();
      expect(invokeLocal).toHaveBeenCalledWith(
        'translate_transcription_files',
        expect.objectContaining({ outputDir: '/tmp/translated-out' })
      );

      // 8. openCustomOutputDir verifies writability and opens directory
      invokeLocal.mockClear();
      await controller.openCustomOutputDir();
      expect(invokeLocal).toHaveBeenCalledWith('verify_directory_writable', { dirPath: '/tmp/translated-out' });
      expect(invokeLocal).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/tmp/translated-out' });

      // 9. Action section is pinned outside .translate-deck-body in translate.html
      const html = loadSourceFile('views/translate.html');
      const deckBodyIdx = html.indexOf('<div class="translate-deck-body">');
      const actionsIdx = html.indexOf('<div class="translate-actions-section">');
      const previewColIdx = html.indexOf('<!-- Right Column: Dual Subtitle Comparison Deck -->');
      expect(deckBodyIdx).toBeGreaterThan(-1);
      expect(actionsIdx).toBeGreaterThan(deckBodyIdx);
      expect(previewColIdx).toBeGreaterThan(actionsIdx);
    } finally {
      controller.dispose();
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('persists and restores outputDirMode and outputDir across controller instances via localStorage', async () => {
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const origStorage = (globalThis as any).localStorage;
    const storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => { storageMap.set(k, v); },
      removeItem: (k: string) => { storageMap.delete(k); },
    };

    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).document = {
      ...origDoc,
      readyState: 'complete',
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: {
          invoke: vi.fn(async (cmd: string) => {
            if (cmd === 'select_directory') return '/persisted/subs';
            if (cmd === 'verify_directory_writable') return null;
            return null;
          }),
        },
      },
    };

    try {
      const first = new TranslationStudioController();
      await first.browseOutputDir();
      expect(storageMap.get('whisper_translate_output_dir_mode')).toBe('custom');
      expect(storageMap.get('whisper_translate_output_dir')).toBe('/persisted/subs');
      first.dispose();

      const second = new TranslationStudioController();
      expect(second.state.outputDirMode).toBe('custom');
      expect(second.state.outputDir).toBe('/persisted/subs');
      await second.setOutputDirMode('input_dir');
      expect(storageMap.get('whisper_translate_output_dir_mode')).toBe('input_dir');
      expect(storageMap.get('whisper_translate_output_dir')).toBe('/persisted/subs');
      second.dispose();

      const third = new TranslationStudioController();
      expect(third.state.outputDirMode).toBe('input_dir');
      expect(third.state.outputDir).toBe('/persisted/subs');
      third.dispose();
    } finally {
      (globalThis as any).localStorage = origStorage;
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('pre-populates outputDir from global settingsState.outputDirPath when no Translate override is saved', async () => {
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const origStorage = (globalThis as any).localStorage;
    const storageMap = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => { storageMap.set(k, v); },
      removeItem: (k: string) => { storageMap.delete(k); },
    };

    const outputDirText: any = {
      textContent: '',
      title: '',
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    };
    const btnOpenDir: any = { disabled: true };
    const customRow: any = { style: { display: 'none' } };

    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).document = {
      ...origDoc,
      readyState: 'complete',
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      settingsState: {
        outputDirMode: 'input_dir',
        outputDirPath: '/global/transcribe/output',
      },
      __TAURI__: {
        core: {
          invoke: vi.fn(async (cmd: string) => {
            if (cmd === 'select_directory') return '/translate/custom/override';
            if (cmd === 'verify_directory_writable') return null;
            return null;
          }),
        },
      },
    };

    try {
      const controller = new TranslationStudioController();
      (controller as any).outputDirText = outputDirText;
      (controller as any).btnOpenDir = btnOpenDir;
      (controller as any).outputCustomRow = customRow;

      controller.syncFromGlobalSettings();
      expect(controller.state.outputDir).toBe('/global/transcribe/output');
      expect(controller.state.outputDirMode).toBe('input_dir');

      // Clearing global settings.outputDirPath also clears non-overridden outputDir
      (globalThis as any).window.settingsState.outputDirPath = '';
      controller.syncFromGlobalSettings();
      expect(controller.state.outputDir).toBe('');
      (globalThis as any).window.settingsState.outputDirPath = '/global/transcribe/output';
      controller.syncFromGlobalSettings();
      expect(controller.state.outputDir).toBe('/global/transcribe/output');

      // Clicking Custom Folder shows the pre-populated global path immediately
      await controller.setOutputDirMode('custom');
      expect(customRow.style.display).toBe('block');
      expect(outputDirText.textContent).toBe('/global/transcribe/output');
      expect(btnOpenDir.disabled).toBe(false);

      // Picking a dedicated folder in Translate overrides and persists independently
      await controller.browseOutputDir();
      expect(controller.state.outputDir).toBe('/translate/custom/override');
      (globalThis as any).window.settingsState.outputDirPath = '';
      controller.syncFromGlobalSettings();
      expect(controller.state.outputDir).toBe('/translate/custom/override');
      controller.dispose();
    } finally {
      (globalThis as any).localStorage = origStorage;
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });

  it('ignores modified arrow keys on output location radiogroup and skips cooldown timer after dispose', async () => {
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const listeners: Record<string, Function[]> = {};
    const modeGroup: any = {
      addEventListener: (evt: string, fn: Function) => { (listeners[evt] ??= []).push(fn); },
      removeEventListener: vi.fn(),
    };
    const modeInputBtn: any = { id: 'translate-output-mode-input', focus: vi.fn(), classList: { toggle: vi.fn() }, setAttribute: vi.fn() };
    const modeCustomBtn: any = { id: 'translate-output-mode-custom', focus: vi.fn(), classList: { toggle: vi.fn() }, setAttribute: vi.fn() };

    let resolveWritable!: () => void;
    const writablePromise = new Promise<void>((r) => { resolveWritable = r; });

    (globalThis as any).document = {
      ...origDoc,
      readyState: 'complete',
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: {
        core: {
          invoke: vi.fn(async (cmd: string) => {
            if (cmd === 'verify_directory_writable') {
              await writablePromise;
              return null;
            }
            if (cmd === 'open_file_in_editor') return null;
            return null;
          }),
        },
      },
    };

    const controller = new TranslationStudioController();
    (controller as any).outputLocationModes = modeGroup;
    (controller as any).outputModeInputBtn = modeInputBtn;
    (controller as any).outputModeCustomBtn = modeCustomBtn;
    (controller as any).setupEventListeners();

    try {
      const preventDefault = vi.fn();
      for (const fn of listeners['keydown'] ?? []) {
        fn({ key: 'ArrowRight', altKey: true, target: modeInputBtn, preventDefault });
      }
      expect(preventDefault).not.toHaveBeenCalled();
      expect(controller.state.outputDirMode).toBe('input_dir');

      controller.state.outputDir = '/tmp/out';
      const openPromise = controller.openCustomOutputDir();
      controller.dispose();
      resolveWritable();
      await openPromise;
      expect((controller as any).openDirCooldownTimer).toBeNull();
      expect((controller as any).isOpeningOutputDir).toBe(false);
    } finally {
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    }
  });
});

describe('Phase 2 Translation Setup parity controls', () => {
  const createEl = (id: string) => ({
    id,
    value: '',
    textContent: '',
    title: '',
    placeholder: '',
    disabled: false,
    checked: false,
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    attributes: new Map<string, string>(),
    classes: new Set<string>(),
    setAttribute(k: string, v: string) { this.attributes.set(k, v); },
    getAttribute(k: string) { return this.attributes.get(k) ?? null; },
    removeAttribute(k: string) { this.attributes.delete(k); },
    classList: {
      add: function (c: string) { (this as any)._set.add(c); },
      remove: function (c: string) { (this as any)._set.delete(c); },
      toggle: function (c: string, force?: boolean) {
        if (force === undefined) {
          if ((this as any)._set.has(c)) (this as any)._set.delete(c);
          else (this as any)._set.add(c);
        } else if (force) {
          (this as any)._set.add(c);
        } else {
          (this as any)._set.delete(c);
        }
      },
      contains: function (c: string) { return (this as any)._set.has(c); },
      _set: new Set<string>(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    focus: vi.fn(),
    appendChild: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
  });

  function setupPhase2Harness() {
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const elements = new Map<string, any>();
    for (const id of [
      'translate-provider-select',
      'translate-model-select',
      'translate-model-meta-row',
      'translate-model-ctx-chip',
      'translate-provider-warning-btn',
      'translate-reasoning-group',
      'translate-reasoning-pills',
      'translate-reasoning-none',
      'translate-reasoning-low',
      'translate-reasoning-medium',
      'translate-reasoning-high',
      'translate-reasoning-extended',
      'translate-custom-prompt',
      'btn-reset-translate-prompt',
      'btn-toggle-translate-advanced',
      'translate-advanced-body',
      'translate-advanced-summary',
      'translate-temp-01',
      'translate-temp-03',
      'translate-temp-06',
      'translate-temp-custom',
      'translate-temp-custom-row',
      'translate-temp-input',
      'btn-translate-temp-dec',
      'btn-translate-temp-inc',
      'translate-batch-10',
      'translate-batch-20',
      'translate-batch-30',
      'translate-batch-custom',
      'translate-batch-custom-row',
      'translate-batch-input',
      'btn-translate-batch-dec',
      'btn-translate-batch-inc',
      'translate-checkpoint-banner',
      'translate-checkpoint-text',
      'btn-clear-translate-checkpoint',
    ]) {
      const el = createEl(id);
      if (id === 'translate-reasoning-none') el.dataset.reasoning = 'None';
      if (id === 'translate-reasoning-low') el.dataset.reasoning = 'Low';
      if (id === 'translate-reasoning-medium') el.dataset.reasoning = 'Medium';
      if (id === 'translate-reasoning-high') el.dataset.reasoning = 'High';
      el.classList._set = el.classes;
      elements.set(id, el);
    }

    const saveCurrentSettings = vi.fn();
    const markSettingsDirty = vi.fn();
    const syncActiveModelSelectionUI = vi.fn();
    const showNotification = vi.fn();

    const tauriInvoke = vi.fn(async (cmd: string, _args?: Record<string, any>) => {
      if (cmd === 'read_text_file_content') return '1\n00:00:01,000 --> 00:00:02,000\nHello world\n';
      if (cmd === 'get_translation_checkpoint_info') return { translatedLines: 4, totalLines: 12 };
      if (cmd === 'clear_translation_checkpoint') return true;
      if (cmd === 'translate_transcription_files') return [];
      return null;
    });

    (globalThis as any).document = {
      ...origDoc,
      readyState: 'complete',
      getElementById: vi.fn((id: string) => elements.get(id) ?? null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      createElement: (tag: string) => createEl(tag),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as any).window = {
      ...origWin,
      __TAURI__: { core: { invoke: tauriInvoke } },
      saveCurrentSettings,
      markSettingsDirty,
      syncActiveModelSelectionUI,
      showNotification,
      settingsState: {
        translateAiTargetLang: 'Persian',
        translateAiProvider: 'OpenAI',
        translateAiModel: 'o3-mini',
        translateAiPolish: false,
        translateAiCustomPrompt: '',
        translateAiTemperature: 0.3,
        translateAiBatchSize: 30,
        translateOutputDirMode: 'custom',
        translateOutputDirPath: '/dedicated/out',
        outputDirMode: 'input_dir',
        outputDirPath: '/global/out',
        translateAiProviders: JSON.stringify([
          {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            useKeyring: false,
            customPrompt: 'Use formal tone.',
            models: [
              { id: 'o3-mini', contextWindow: 128000, supportsReasoning: true, reasoning: 'Medium', enabled: true },
              { id: 'gpt-4o-mini', contextWindow: 64000, supportsReasoning: false, enabled: true },
            ],
          },
        ]),
      },
    };

    const controller = new TranslationStudioController();
    const cleanup = () => {
      controller.dispose();
      (globalThis as any).document = origDoc;
      (globalThis as any).window = origWin;
    };

    return { controller, elements, tauriInvoke, saveCurrentSettings, syncActiveModelSelectionUI, showNotification, cleanup };
  }

  it('displays model context metadata, warning chip, and updates reasoning effort cleanly', () => {
    const { controller, elements, saveCurrentSettings, syncActiveModelSelectionUI, cleanup } = setupPhase2Harness();
    try {
      expect(elements.get('translate-model-meta-row').style.display).toBe('flex');
      expect(elements.get('translate-model-ctx-chip').textContent).toContain('128K');
      expect(elements.get('translate-provider-warning-btn').style.display).toBe('inline-flex');
      expect(elements.get('translate-reasoning-group').style.display).toBe('flex');
      expect(elements.get('translate-reasoning-medium').getAttribute('aria-pressed')).toBe('true');

      controller.setActiveModelReasoning('High');
      expect(elements.get('translate-reasoning-high').getAttribute('aria-pressed')).toBe('true');
      expect(elements.get('translate-reasoning-medium').getAttribute('aria-pressed')).toBe('false');
      expect(saveCurrentSettings).toHaveBeenCalledWith(false);
      expect(syncActiveModelSelectionUI).toHaveBeenCalledWith('o3-mini');

      // Extended reasoning value appears dynamically in the extended pill
      controller.setActiveModelReasoning('XHigh');
      expect(elements.get('translate-reasoning-extended').style.display).toBe('inline-flex');
      expect(elements.get('translate-reasoning-extended').dataset.reasoning).toBe('XHigh');
      expect(elements.get('translate-reasoning-extended').getAttribute('aria-pressed')).toBe('true');

      // Switching to non-reasoning model hides reasoning controls
      (globalThis as any).window.settingsState.translateAiModel = 'gpt-4o-mini';
      controller.syncFromGlobalSettings();
      expect(elements.get('translate-reasoning-group').style.display).toBe('none');
      expect(elements.get('translate-model-ctx-chip').textContent).toContain('64K');

      // When provider has API key configured, warning row stays hidden
      const providers = JSON.parse((globalThis as any).window.settingsState.translateAiProviders);
      providers[0].apiKey = 'sk-valid';
      (globalThis as any).window.settingsState.translateAiProviders = JSON.stringify(providers);
      controller.syncFromGlobalSettings();
      expect(elements.get('translate-provider-warning-btn').style.display).toBe('none');
      expect(elements.get('translate-model-meta-row').style.display).toBe('none');

      // Verify translate.html removes redundant reasoning badge and keeps active pill hover specificity intact
      const html = loadSourceFile('views/translate.html');
      expect(html).not.toContain('translate-model-reasoning-chip');
      const css = loadSourceFile('styles/views/translate.css');
      expect(css).toContain('.translate-preset-pill.active:hover:not(:disabled)');
    } finally {
      cleanup();
    }
  });

  it('syncs custom prompt, temperature/batch presets & steppers, and dedicated output location', async () => {
    const { controller, elements, tauriInvoke, cleanup } = setupPhase2Harness();
    try {
      // Dedicated translateOutputDir takes precedence over global outputDirPath
      expect(controller.state.outputDirMode).toBe('custom');
      expect(controller.state.outputDir).toBe('/dedicated/out');
      expect(elements.get('translate-custom-prompt').placeholder).toContain('Use formal tone.');
      expect(elements.get('btn-reset-translate-prompt').style.display).toBe('none');

      // Setting temperature & batch presets/custom values updates summary & clamps bounds
      controller.setTemperature(2.8, true);
      expect(controller.state.temperature).toBe(2);
      controller.stepTemperature(-1.9);
      expect(controller.state.temperature).toBe(0.1);
      controller.setBatchSize(-5, false);
      expect(controller.state.batchSize).toBe(30);
      controller.setBatchSize(1, true);
      expect(controller.state.batchSize).toBe(1);
      controller.setBatchSize(18, true);
      expect(controller.state.batchSize).toBe(18);
      expect(elements.get('translate-advanced-summary').textContent).toContain('18');
      expect(elements.get('translate-batch-custom-row').style.display).toBe('flex');

      // Sync prompt & start translation forwards all Phase 2 settings
      (globalThis as any).window.settingsState.translateAiCustomPrompt = 'Keep names untranslated';
      controller.syncFromGlobalSettings();
      expect(elements.get('btn-reset-translate-prompt').style.display).toBe('inline-flex');

      await controller.loadSubtitleFile('/subs/episode1.srt');
      await controller.startTranslation();

      const translateCall = tauriInvoke.mock.calls.find(([cmd]) => cmd === 'translate_transcription_files');
      expect(translateCall).toBeTruthy();
      expect((translateCall![1] as any).settings).toMatchObject({
        translateAiCustomPrompt: 'Keep names untranslated',
        translateAiTemperature: 0.1,
        translateAiBatchSize: 18,
        translateOutputDirMode: 'custom',
        translateOutputDirPath: '/dedicated/out',
      });
    } finally {
      cleanup();
    }
  });

  it('displays resumable checkpoint banner on subtitle load and clears checkpoint via backend command', async () => {
    const { controller, elements, tauriInvoke, showNotification, cleanup } = setupPhase2Harness();
    try {
      await controller.loadSubtitleFile('/subs/movie.srt');
      await vi.waitFor(() => {
        expect(elements.get('translate-checkpoint-banner').style.display).toBe('flex');
      });
      expect(elements.get('translate-checkpoint-text').textContent).toContain('4');
      expect(elements.get('translate-checkpoint-text').textContent).toContain('12');

      await controller.clearCheckpoint();
      expect(tauriInvoke).toHaveBeenCalledWith('clear_translation_checkpoint', expect.objectContaining({
        subtitlePath: '/subs/movie.srt',
        outputDir: '/dedicated/out',
      }));
      expect(elements.get('translate-checkpoint-banner').style.display).toBe('none');
      expect(showNotification).toHaveBeenCalled();

      controller.clearLoadedSubtitle();
      expect(elements.get('translate-checkpoint-banner').style.display).toBe('none');
    } finally {
      cleanup();
    }
  });

  it('keeps reasoning controls visible when toggling Off on legacy models without supportsReasoning and preserves 2-decimal temperature', () => {
    const { controller, elements, cleanup } = setupPhase2Harness();
    try {
      const win = (globalThis as any).window;
      win.settingsState.translateAiProviders = JSON.stringify([
        {
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          useKeyring: false,
          customPrompt: '',
          models: [
            { id: 'o3-mini', contextWindow: 128000, reasoning: 'Medium', enabled: true },
          ],
        },
      ]);
      controller.syncFromGlobalSettings();

      expect(elements.get('translate-reasoning-group').style.display).toBe('flex');
      controller.setActiveModelReasoning('None');
      expect(elements.get('translate-reasoning-group').style.display).toBe('flex');
      expect(elements.get('translate-reasoning-none').getAttribute('aria-pressed')).toBe('true');

      const savedProviders = JSON.parse(win.settingsState.translateAiProviders);
      expect(savedProviders[0].models[0].supportsReasoning).toBe(true);
      expect(savedProviders[0].models[0].reasoning).toBe('None');

      controller.setTemperature(0.25, true);
      expect(controller.state.temperature).toBe(0.25);
      expect(elements.get('translate-temp-input').value).toBe('0.25');
      expect(elements.get('translate-advanced-summary').textContent).toContain('0.25');
    } finally {
      cleanup();
    }
  });

  it('stacks Translation Studio panels sequentially without overlap on <=1024px viewports', () => {
    const responsiveCss = loadSourceFile('styles/base/responsive.css');
    const scrollbarsCss = loadSourceFile('styles/base/scrollbars.css');

    const blockIdx = responsiveCss.indexOf('@media (max-width: 1024px)');
    expect(blockIdx).toBeGreaterThan(-1);
    const stackedBlock = responsiveCss.slice(blockIdx);

    expect(stackedBlock).toMatch(/#panel-translate[\s\S]*?overflow-y:\s*auto/);
    expect(stackedBlock).toMatch(/\.translate-layout[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*min-content;[\s\S]*?flex:\s*none;/);
    expect(stackedBlock).toMatch(/\.translate-left-panel[\s\S]*?min-height:\s*min-content;[\s\S]*?overflow:\s*visible;[\s\S]*?flex:\s*none;/);
    expect(stackedBlock).toMatch(/\.translate-right-panel[\s\S]*?flex:\s*none;/);
    expect(scrollbarsCss).toContain('#panel-translate::-webkit-scrollbar');
  });
});


