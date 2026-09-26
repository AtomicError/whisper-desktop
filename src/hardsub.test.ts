import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardsubController } from './hardsub';

let Controller: typeof HardsubController;
let formatHardsubStatusFn: typeof import('./hardsub').formatHardsubStatus;
let getParentDirFn: typeof import('./hardsub').getParentDir;
let joinPathFn: typeof import('./hardsub').joinPath;
let findCueAtTimeBinaryFn: typeof import('./hardsub').findCueAtTimeBinary;
const controllers: HardsubController[] = [];

class ClassList {
  private classes = new Set<string>();
  add(...tokens: string[]) { tokens.forEach(t => this.classes.add(t)); }
  remove(...tokens: string[]) { tokens.forEach(t => this.classes.delete(t)); }
  toggle(token: string, force?: boolean) {
    if (force === true) { this.classes.add(token); return true; }
    if (force === false) { this.classes.delete(token); return false; }
    if (this.classes.has(token)) { this.classes.delete(token); return false; }
    this.classes.add(token); return true;
  }
  contains(token: string) { return this.classes.has(token); }
}

class Control extends EventTarget {
  value = '0';
  disabled = false;
  textContent = '';
  title = '';
  style: Record<string, string> = {};
  classList = new ClassList();
  closest = (_selector: string): Control | null => null;
  setAttribute() {}
  focus = vi.fn();
  blur = vi.fn();
  contains(_node: unknown): boolean { return false; }
  matches(_selector: string): boolean { return false; }
  removeAttribute(_name: string) {}
}
class Media extends Control {
  paused = true;
  ended = false;
  seeking = false;
  duration = NaN;
  videoWidth = 0;
  videoHeight = 0;
  src = '';
  get currentSrc() { return this.src; }
  crossOrigin = '';
  readyState = 0;
  volume = 1;
  muted = false;
  error: { code: number } | null = null;
  canPlayType() { return 'probably'; }
  private time = 0;
  seeks: Array<{ time: number; fast: boolean }> = [];
  frames = new Map<number, () => void>();
  private frameId = 0;
  requestVideoFrameCallback(callback: () => void) { const id = ++this.frameId; this.frames.set(id, callback); return id; }
  cancelVideoFrameCallback(id: number) { this.frames.delete(id); }
  load() { this.time = 0; this.readyState = 0; this.duration = NaN; this.seeking = false; this.videoWidth = this.videoHeight = 0; }
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  metadata() { this.readyState = 1; this.duration = 100; this.videoWidth = 1920; this.videoHeight = 1080; this.dispatchEvent(new Event('loadedmetadata')); }
  ready() { this.metadata(); this.readyState = 4; this.dispatchEvent(new Event('loadeddata')); }
  get currentTime() { return this.time; }
  set currentTime(time: number) { this.seek(time, false); }
  fastSeek(time: number) { this.seek(time, true); }
  private seek(time: number, fast: boolean) {
    this.time = time;
    this.seeking = true;
    this.seeks.push({ time, fast });
    this.dispatchEvent(new Event('seeking'));
  }
  settle() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event('pause')); });
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('play')); });
}
class DocumentBoundary extends EventTarget {
  readyState = 'loading';
  activeElement: Control | null = null;
  elements = new Map<string, Control>();
  getElementById = (id: string) => this.elements.get(id) ?? null;
  querySelectorAll = () => [];
  fonts = { load: async () => [] };
}
let doc: DocumentBoundary;
type PreviewArguments = { sourcePath?: string; requestId?: number; candidateId?: string };
let invoke = vi.fn<(command: string, args: PreviewArguments) => Promise<unknown>>();
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function key(key: string, properties: Record<string, unknown> = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key, ...properties });
  doc.dispatchEvent(event);
  return event;
}
function wheel(container: Control, deltaX = 20) {
  const event = new Event('wheel', { cancelable: true });
  Object.assign(event, { deltaX, deltaY: 0 });
  container.dispatchEvent(event);
  return event;
}
function fixture() {
  const controller = new Controller();
  controllers.push(controller);
  const video = new Media();
  const slider = new Control();
  const play = new Control();
  const label = new Control();
  const badge = new Control();
  const cancel = new Control();
  const retry = new Control();
  const time = new Control();
  const container = new Control();
  doc.elements.set('hardsub-player-container', container);
  const outputDirText = new Control();
  const btnBrowseDir = new Control();
  const btnResetDir = new Control();
  const btnOpenFolder = new Control();
  const telemetryBox = new Control();
  const volumeWrapper = new Control();
  const volumeBtn = new Control();
  const volumeSlider = new Control();
  const btnClearVideo = new Control();
  const btnClearSub = new Control();
  const btnResetAll = new Control();
  doc.elements.set('hardsub-output-dir-text', outputDirText);
  doc.elements.set('btn-browse-hardsub-dir', btnBrowseDir);
  doc.elements.set('btn-reset-hardsub-dir', btnResetDir);
  doc.elements.set('btn-open-hardsub-folder', btnOpenFolder);
  doc.elements.set('hardsub-telemetry-box', telemetryBox);
  doc.elements.set('hardsub-volume-wrapper', volumeWrapper);
  doc.elements.set('hardsub-btn-volume', volumeBtn);
  doc.elements.set('hardsub-volume-slider', volumeSlider);
  doc.elements.set('btn-clear-hardsub-video', btnClearVideo);
  doc.elements.set('btn-clear-hardsub-sub', btnClearSub);
  doc.elements.set('btn-reset-hardsub-all', btnResetAll);

  // Inject only event-capable DOM/media boundaries. Loading, seeking and rendering are real.
  const internal = controller as unknown as {
    videoElement: Media; videoSeekSlider: Control; videoPlayBtn: Control;
    videoIconPlay: Control; videoIconPause: Control;
    lblVideoName: Control; videoStatusBadge: Control; videoTimeDisplay: Control;
    previewCancelBtn: Control; previewRetryBtn: Control;
    volumeControlWrapper: Control; videoVolumeBtn: Control; videoVolumeSlider: Control;
    btnClearVideo: Control; btnClearSub: Control; btnResetAll: Control;
    freezeCanvas: { width: number; height: number; style: Record<string, string> };
    freezeCtx: { clearRect(): void; drawImage(): void };
    state: { videoPath: string; outputPath: string; outputDir: string; subtitlePath: string };
    subtitleCues: Array<{ text: string; startMs: number; endMs: number }>;
    outputDirText: Control;
    btnBrowseDir: Control;
    btnResetDir: Control;
    btnOpenFolder: Control;
    telemetryBox: Control;
    updateEncodingUIState(active: boolean): void;
    setupVideoPlayerEvents(): void;
    browseOutputDir(): Promise<void>;
    resetOutputDir(): void;
    updateOutputDirUI(): void;
    openOutputFolder(): Promise<void>;
  };
  const iconPlay = new Control();
  const iconPause = new Control();
  Object.assign(internal, {
    videoElement: video, videoSeekSlider: slider, videoPlayBtn: play, lblVideoName: label, videoStatusBadge: badge, videoTimeDisplay: time,
    videoIconPlay: iconPlay, videoIconPause: iconPause,
    outputDirText, btnBrowseDir, btnResetDir, btnOpenFolder, telemetryBox,
    volumeControlWrapper: volumeWrapper, videoVolumeBtn: volumeBtn, videoVolumeSlider: volumeSlider,
    btnClearVideo, btnClearSub, btnResetAll,
  });
  Object.assign(internal, { previewCancelBtn: cancel, previewRetryBtn: retry });
  internal.setupVideoPlayerEvents();
  const load = async (active = true) => {
    controller.prefillFilePaths('/video.mp4', '');
    await flush();
    video.ready();
    if (active) controller.setPageActive(true);
    video.pause.mockClear();
  };
  return { controller, video, slider, play, iconPlay, iconPause, label, badge, time, container, internal, load, cancel, retry, outputDirText, btnBrowseDir, btnResetDir, btnOpenFolder, telemetryBox, volumeWrapper, volumeBtn, volumeSlider, btnClearVideo, btnClearSub, btnResetAll };
}

beforeAll(async () => {
  vi.stubGlobal('document', new DocumentBoundary());
  vi.stubGlobal('window', new EventTarget());
  const module = await import('./hardsub');
  Controller = module.HardsubController;
  formatHardsubStatusFn = module.formatHardsubStatus;
  getParentDirFn = module.getParentDir;
  joinPathFn = module.joinPath;
  findCueAtTimeBinaryFn = module.findCueAtTimeBinary;
  module.hardsubController.dispose();
});
beforeEach(() => {
  vi.useFakeTimers();
  doc = new DocumentBoundary();
  invoke = vi.fn(async (command: string, args: { sourcePath?: string; requestId?: number }) => {
    if (command === 'begin_hardsub_preview') return { requestId: args.requestId, candidateId: String(args.requestId), url: `http://localhost${args.sourcePath}`, stage: 'direct', source: null };
    if (command === 'probe_hardsub_source') throw new Error('Tools unavailable');
    return undefined;
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { __TAURI__: { core: { invoke }, event: { listen: vi.fn(async () => () => {}) } } }));
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());

describe('source selection ownership', () => {
  it.each([true, false])('keeps B after late A completion (success: %s)', async success => {
    let resolveA!: (value: unknown) => void;
    let rejectA!: (error: Error) => void;
    const a = new Promise<unknown>((resolve, reject) => { resolveA = resolve; rejectA = reject; });
    let oldRequestId = 0;
    invoke.mockImplementation(async (command: string, args: { sourcePath?: string; requestId?: number }) => {
      if (command === 'probe_hardsub_source') throw new Error('Tools unavailable');
      if (command !== 'begin_hardsub_preview') return undefined;
      if (args.sourcePath === '/A.mp4') { oldRequestId = args.requestId!; return a; }
      return { requestId: args.requestId, candidateId: 'B', url: 'http://localhost/B', stage: 'direct', source: null };
    });
    const { controller, video, label, badge, internal } = fixture();
    controller.prefillFilePaths('/A.mp4', '');
    await flush();
    controller.prefillFilePaths('/B.mp4', '');
    await flush();
    video.ready();
    const status = badge.textContent;
    if (success) resolveA({ requestId: oldRequestId, candidateId: 'A', url: 'http://localhost/A', stage: 'direct', source: null });
    else rejectA(new Error('old source unavailable'));
    await flush();
    expect(video.src).toBe('http://localhost/B');
    expect(label.textContent).toContain('B.mp4');
    expect(badge.textContent).toBe(status);
    expect(internal.state.videoPath).toBe('/B.mp4');
    expect(internal.state.outputPath).toContain('/B_hardsub.');
    controller.prefillFilePaths('', '');
    expect(internal.state.videoPath).toBe('/B.mp4');
  });

  it('prepares while inactive without autoplay and retains the source on return', async () => {
    const { controller, video, play, load } = fixture();
    await load(false);
    play.dispatchEvent(new Event('click'));
    expect(video.play).not.toHaveBeenCalled();
    expect(key(' ').defaultPrevented).toBe(false);
    controller.setPageActive(true);
    play.dispatchEvent(new Event('click'));
    expect(video.paused).toBe(false);
    const src = video.src;
    controller.setPageActive(false);
    expect(video.paused).toBe(true);
    controller.setPageActive(true);
    expect(video.src).toBe(src);
    expect(video.paused).toBe(true);
  });

  it('pauses a pending play completion and clears hidden scroll seeks', async () => {
    const { controller, video, play, container, load } = fixture();
    await load();
    let finish!: () => void;
    video.play.mockImplementation(() => new Promise<void>(resolve => { finish = () => { video.paused = false; resolve(); }; }));
    play.dispatchEvent(new Event('click'));
    wheel(container);
    const seeks = video.seeks.length;
    controller.setPageActive(false);
    finish();
    await flush();
    vi.advanceTimersByTime(500);
    expect(video.paused).toBe(true);
    expect(video.seeks).toHaveLength(seeks);
    expect(video.frames.size).toBe(0);
  });
});

describe('real hardsub seek interaction', () => {
  it('pauses during scrubbing and resumes once after the final precise seek settles', async () => {
    const { video, slider, play, load } = fixture();
    await load();
    play.dispatchEvent(new Event('click'));
    video.play.mockClear();
    slider.dispatchEvent(new Event('pointerdown'));
    expect(video.pause).toHaveBeenCalledOnce();
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    slider.value = '40';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('pointerup'));
    slider.dispatchEvent(new Event('change'));
    expect(video.play).not.toHaveBeenCalled();
    expect(video.seeks).toEqual([{ time: 20, fast: true }]);
    video.settle();
    expect(video.seeks).toEqual([{ time: 20, fast: true }, { time: 40, fast: false }]);
    expect(video.play).not.toHaveBeenCalled();
    video.settle();
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(40);
    expect(video.paused).toBe(false);
  });

  it('performs one exact release after an already-settled fast seek', async () => {
    const { video, slider, load } = fixture();
    await load();
    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    video.settle();
    slider.dispatchEvent(new Event('pointerup'));
    slider.dispatchEvent(new Event('change'));
    expect(video.seeks).toEqual([{ time: 20, fast: true }, { time: 20, fast: false }]);
    video.settle();
    expect(video.paused).toBe(true);
  });

  it('ignores gestures before readiness and accepts later seeks and time updates', async () => {
    const { controller, video, slider, container, time } = fixture();
    controller.setPageActive(true);
    controller.prefillFilePaths('/video.mp4', '');
    await flush();
    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '30';
    slider.dispatchEvent(new Event('input'));
    expect(wheel(container).defaultPrevented).toBe(false);
    video.metadata();
    key('ArrowRight');
    expect(video.seeks).toEqual([]);
    video.ready();
    key('ArrowRight');
    video.settle();
    expect(video.currentTime).toBe(10);
    expect(time.textContent).toContain('00:10');
  });

  it('settles a same-time gesture without waiting for seeked or duplicating release', async () => {
    const { video, slider, play, badge, load } = fixture();
    await load();
    play.dispatchEvent(new Event('click'));
    video.play.mockClear();
    slider.dispatchEvent(new Event('pointerdown'));
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event('pointerup'));
    slider.dispatchEvent(new Event('change'));
    expect(video.seeks).toEqual([]);
    expect(video.play).toHaveBeenCalledOnce();
    const status = badge.textContent;
    vi.advanceTimersByTime(10_001);
    expect(badge.textContent).toBe(status);
    key('ArrowRight');
    video.settle();
    expect(video.currentTime).toBe(10);
  });

  it.each(['pointercancel', 'lostpointercapture'])('does not resume a cancelled slider gesture: %s', async event => {
    const { video, slider, play, load } = fixture();
    await load();
    play.dispatchEvent(new Event('click'));
    video.play.mockClear();
    slider.dispatchEvent(new Event('pointerdown'));
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    slider.value = '50';
    slider.dispatchEvent(new Event('input'));
    slider.dispatchEvent(new Event(event));
    slider.dispatchEvent(new Event('change'));
    slider.dispatchEvent(new Event('pointerup'));
    video.settle();
    expect(video.play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(20);
  });

  it('reports a persistent retryable error after a stalled seek and recovers on selection', async () => {
    const { controller, video, slider, badge, load } = fixture();
    await load();
    const ready = badge.textContent;
    key('ArrowRight');
    vi.advanceTimersByTime(10_000);
    expect(badge.textContent).not.toBe(ready);
    const error = badge.textContent;
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('canplay'));
    expect(badge.textContent).toBe(error);
    expect(slider.disabled).toBe(true);
    controller.prefillFilePaths('/retry.mp4', '');
    await flush();
    video.ready();
    key('ArrowRight');
    video.settle();
    expect(video.currentTime).toBe(10);
    expect(slider.disabled).toBe(false);
  });

  it('dismisses paused freeze only after settlement even when video frames never arrive', async () => {
    const { video, internal, load } = fixture();
    await load();
    const canvas = { width: 100, height: 100, style: { display: 'none' } };
    internal.freezeCanvas = canvas;
    internal.freezeCtx = { clearRect() {}, drawImage() {} };
    key('ArrowRight');
    vi.advanceTimersByTime(500);
    expect(canvas.style.display).toBe('block');
    video.settle();
    vi.advanceTimersByTime(16);
    key('ArrowRight');
    vi.advanceTimersByTime(500);
    expect(canvas.style.display).toBe('block');
    video.settle();
    vi.advanceTimersByTime(32);
    expect(canvas.style.display).toBe('none');
    expect(video.frames.size).toBe(0);
  });

  it('uses the settlement timer when animation and video frame delivery are suspended', async () => {
    const { video, internal, load } = fixture();
    await load();
    const canvas = { width: 100, height: 100, style: { display: 'none' } };
    internal.freezeCanvas = canvas;
    internal.freezeCtx = { clearRect() {}, drawImage() {} };
    vi.stubGlobal('requestAnimationFrame', () => 99);
    key('ArrowRight');
    vi.advanceTimersByTime(500);
    expect(canvas.style.display).toBe('block');
    video.settle();
    vi.advanceTimersByTime(250);
    expect(canvas.style.display).toBe('none');
    expect(video.frames.size).toBe(0);
  });

  it('leaves native controls and modified/default-prevented keys alone', async () => {
    const { video, load } = fixture();
    await load();
    const native = new Control();
    native.closest = () => native;
    doc.activeElement = native;
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(key(' ').defaultPrevented).toBe(false);
    doc.activeElement = null;
    for (const properties of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }]) {
      expect(key('ArrowRight', properties).defaultPrevented).toBe(false);
    }
    const prevented = new Event('keydown', { cancelable: true });
    Object.assign(prevented, { key: 'ArrowRight' });
    prevented.preventDefault();
    doc.dispatchEvent(prevented);
    expect(video.seeks).toEqual([]);
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    video.settle();
    expect(video.currentTime).toBe(10);
  });

  it('disposal removes source and DOM listeners and rejects late readiness', async () => {
    const { controller, video, play, load } = fixture();
    await load();
    controller.dispose();
    play.dispatchEvent(new Event('click'));
    video.ready();
    expect(key(' ').defaultPrevented).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.src).toBe('');
  });
});

describe('compatible preview recovery', () => {
  it('advances one decode failure once but never transcodes transport errors', async () => {
    const { video, badge, retry, load } = fixture();
    await load();
    const base = invoke.getMockImplementation()!;
    let finish!: (candidate: unknown) => void;
    const preparation = new Promise<unknown>(resolve => { finish = resolve; });
    invoke.mockImplementation((command: string, args: PreviewArguments) => command === 'advance_hardsub_preview' ? preparation : base(command, args));
    video.error = { code: 3 };
    video.dispatchEvent(new Event('error'));
    video.dispatchEvent(new Event('error'));
    const advances = invoke.mock.calls.filter(([command]) => command === 'advance_hardsub_preview');
    expect(advances).toHaveLength(1);
    const requestId = advances[0][1].requestId;
    finish({ requestId, candidateId: 'converted', url: 'http://localhost/converted', stage: 'mp4', source: null });
    await flush();
    video.error = null;
    video.ready();
    expect(video.src).toBe('http://localhost/converted');
    video.error = { code: 2 };
    video.dispatchEvent(new Event('error'));
    expect(invoke.mock.calls.filter(([command]) => command === 'advance_hardsub_preview')).toHaveLength(1);
    expect(retry.style.display).toBe('inline-flex');
    expect(badge.textContent).toContain('stream');
  });

  it('cancel and retry cannot restore a pending old candidate', async () => {
    const { controller, video, cancel, retry, badge, internal } = fixture();
    const base = invoke.getMockImplementation()!;
    let finish!: (candidate: unknown) => void;
    const beginning = new Promise<unknown>(resolve => { finish = resolve; });
    invoke.mockImplementationOnce((_command: string, _args: unknown) => beginning);
    controller.prefillFilePaths('/video.mp4', '');
    await flush();
    const requestId = invoke.mock.calls.find(([command]) => command === 'begin_hardsub_preview')![1].requestId;
    cancel.dispatchEvent(new Event('click'));
    expect(video.src).toBe('');
    expect(badge.textContent).toContain('cancelled');
    invoke.mockImplementation(base);
    retry.dispatchEvent(new Event('click'));
    await flush();
    video.ready();
    finish({ requestId, candidateId: 'obsolete', url: 'http://localhost/obsolete', stage: 'direct', source: null });
    await flush();
    expect(video.src).toBe('http://localhost/video.mp4');
    expect(internal.state.videoPath).toBe('/video.mp4');
    expect(invoke).toHaveBeenCalledWith('release_hardsub_preview', { requestId });
  });
});

describe('hardsub path utilities', () => {
  it('correctly extracts parent directory for Unix and Windows paths', () => {
    expect(getParentDirFn('/home/user/video.mp4')).toBe('/home/user');
    expect(getParentDirFn('/video.mp4')).toBe('/');
    expect(getParentDirFn('C:\\Videos\\sample.mkv')).toBe('C:\\Videos');
    expect(getParentDirFn('C:\\sample.mkv')).toBe('C:\\');
    expect(getParentDirFn('')).toBe('');
  });

  it('correctly joins paths for Unix and Windows', () => {
    expect(joinPathFn('/home/user', 'out.mp4')).toBe('/home/user/out.mp4');
    expect(joinPathFn('/home/user/', 'out.mp4')).toBe('/home/user/out.mp4');
    expect(joinPathFn('C:\\Videos', 'out.mp4')).toBe('C:\\Videos\\out.mp4');
    expect(joinPathFn('C:\\Videos\\', 'out.mp4')).toBe('C:\\Videos\\out.mp4');
    expect(joinPathFn('', 'out.mp4')).toBe('out.mp4');
  });
});

describe('formatHardsubStatus localization', () => {
  it('formats encoding stage with speed and fps telemetry', () => {
    const formatted = formatHardsubStatusFn({
      progress: 0.82,
      message: 'Embedding Subtitles into Video... 82% (Speed: 6.52x | 188.18 FPS)',
      active: true,
      stage: 'encoding',
      speed: '6.52x',
      fps: '188.18',
    });
    expect(formatted).toContain('82%');
    expect(formatted).toContain('6.52x');
    expect(formatted).toContain('188.18');
  });

  it('formats finalizing stage', () => {
    const formatted = formatHardsubStatusFn({
      progress: 0.99,
      message: 'Finalizing video export...',
      active: true,
      stage: 'finalizing',
    });
    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('formats completion stage', () => {
    const formatted = formatHardsubStatusFn({
      progress: 1.0,
      message: 'Hardsub video exported successfully!',
      active: false,
      stage: 'completed',
    });
    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('falls back to regex extraction from raw English messages', () => {
    const formatted = formatHardsubStatusFn({
      progress: 0.45,
      message: 'Embedding Subtitles into Video... 45% (Speed: 4.12x | 120.00 FPS)',
      active: true,
    });
    expect(formatted).toContain('45%');
    expect(formatted).toContain('4.12x');
    expect(formatted).toContain('120.00');
  });
});

describe('hardsub output directory management', () => {
  it('defaults to source video folder and updates when output directory is set or reset', async () => {
    const { controller, internal, outputDirText, btnResetDir } = fixture();
    controller.prefillFilePaths('/media/movies/intro.mp4', '');
    await flush();

    // Default output path is in the same directory as source video
    expect(internal.state.outputPath).toBe('/media/movies/intro_hardsub.mp4');
    expect(outputDirText.classList.contains('has-custom-path')).toBe(false);
    expect(btnResetDir.style.display).toBe('none');

    // Select custom output directory
    invoke.mockImplementation(async (command: string) => {
      if (command === 'select_directory') return '/custom/export/path';
      return undefined;
    });

    await internal.browseOutputDir();
    await flush();

    expect(internal.state.outputDir).toBe('/custom/export/path');
    expect(internal.state.outputPath).toBe('/custom/export/path/intro_hardsub.mp4');
    expect(outputDirText.textContent).toBe('/custom/export/path');
    expect(outputDirText.classList.contains('has-custom-path')).toBe(true);
    expect(btnResetDir.style.display).toBe('inline-flex');

    // Reset output directory
    internal.resetOutputDir();
    expect(internal.state.outputDir).toBe('');
    expect(internal.state.outputPath).toBe('/media/movies/intro_hardsub.mp4');
    expect(outputDirText.classList.contains('has-custom-path')).toBe(false);
    expect(btnResetDir.style.display).toBe('none');
  });

  it('formats init stage and fallback for encoder initialization', () => {
    const fromStage = formatHardsubStatusFn({
      progress: 0.0,
      message: 'Initializing FFmpeg Encoder...',
      active: true,
      stage: 'init',
    });
    expect(fromStage).toBeTruthy();

    const fromRaw = formatHardsubStatusFn({
      progress: 0.0,
      message: 'Initializing FFmpeg Encoder...',
      active: true,
    });
    expect(fromRaw).toBe(fromStage);
  });

  it('formats cancelled and failed stages', () => {
    const cancelled = formatHardsubStatusFn({
      progress: 0.0,
      message: 'Hardsubbing cancelled by user.',
      active: false,
      stage: 'cancelled',
    });
    expect(cancelled).toBeTruthy();

    const failed = formatHardsubStatusFn({
      progress: 0.0,
      message: 'Hardsubbing encoding failed.',
      active: false,
      stage: 'failed',
    });
    expect(failed).toBeTruthy();
  });

  it('openOutputFolder invokes open_file_in_editor with target directory', async () => {
    const { internal } = fixture();
    internal.state.outputPath = '/media/movies/intro_hardsub.mp4';
    await internal.openOutputFolder();
    expect(invoke).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/media/movies' });
  });

  it('clears lastExportedPath and hides open folder button when new video is selected', async () => {
    const { controller, internal, btnOpenFolder } = fixture();
    btnOpenFolder.style.display = 'inline-flex';
    (internal as any).lastExportedPath = '/media/movies/old_hardsub.mp4';

    controller.prefillFilePaths('/media/movies/new_video.mp4', '');
    await flush();

    expect(btnOpenFolder.style.display).toBe('none');
    expect((internal as any).lastExportedPath).toBeNull();
  });

  it('manages progressive disclosure of telemetry HUD during and after encoding', async () => {
    const { controller, internal, telemetryBox } = fixture();
    // Initially hidden
    telemetryBox.style.display = 'none';

    // When encoding becomes active, telemetryBox reveals
    internal.updateEncodingUIState(true);
    expect(telemetryBox.style.display).toBe('flex');

    // When settled completed, telemetryBox remains visible
    (internal as any).lastStatusPayload = { stage: 'completed', progress: 1.0, message: 'Done', active: false };
    internal.updateEncodingUIState(false);
    expect(telemetryBox.style.display).toBe('flex');

    // When selecting a new video, telemetryBox resets to hidden
    controller.prefillFilePaths('/media/movies/another_video.mp4', '');
    await flush();
    expect(telemetryBox.style.display).toBe('none');
  });

  describe('findCueAtTimeBinary', () => {
    const cues = [
      { id: 1, startMs: 1000, endMs: 3000, startTimeStr: '00:01', endTimeStr: '00:03', text: 'First' },
      { id: 2, startMs: 5000, endMs: 8000, startTimeStr: '00:05', endTimeStr: '00:08', text: 'Second' },
      { id: 3, startMs: 8000, endMs: 10000, startTimeStr: '00:08', endTimeStr: '00:10', text: 'Third' },
      { id: 4, startMs: 9500, endMs: 12000, startTimeStr: '00:09', endTimeStr: '00:12', text: 'Fourth (overlapping)' },
    ];

    it('handles empty cues array', () => {
      expect(findCueAtTimeBinaryFn([], 500)).toBeUndefined();
    });

    it('returns undefined before first cue', () => {
      expect(findCueAtTimeBinaryFn(cues, 500)).toBeUndefined();
    });

    it('finds cue at start boundary', () => {
      const cue = findCueAtTimeBinaryFn(cues, 1000);
      expect(cue?.id).toBe(1);
    });

    it('finds cue within its duration', () => {
      const cue = findCueAtTimeBinaryFn(cues, 2000);
      expect(cue?.id).toBe(1);
    });

    it('returns undefined at end boundary when no cue starts there', () => {
      expect(findCueAtTimeBinaryFn(cues, 3000)).toBeUndefined();
    });

    it('returns undefined during gaps between cues', () => {
      expect(findCueAtTimeBinaryFn(cues, 4000)).toBeUndefined();
    });

    it('finds adjacent cue at exact handover time', () => {
      const cue = findCueAtTimeBinaryFn(cues, 8000);
      expect(cue?.id).toBe(3);
    });

    it('finds overlapping cues correctly', () => {
      const cue = findCueAtTimeBinaryFn(cues, 9800);
      // At 9800, cue 4 started at 9500
      expect(cue?.id).toBe(4);
    });

    it('returns undefined past the last cue', () => {
      expect(findCueAtTimeBinaryFn(cues, 15000)).toBeUndefined();
    });

    it('correctly finds long cues spanning more than 30 seconds despite intermediate cues', () => {
      const longCues = [
        { id: 10, startMs: 0, endMs: 50000, startTimeStr: '00:00', endTimeStr: '00:50', text: 'Long Intro' },
        { id: 11, startMs: 5000, endMs: 8000, startTimeStr: '00:05', endTimeStr: '00:08', text: 'Short Interlude' },
      ];
      // At 35000 (35s), candidate is #11 (startMs 5000), but #11 ended at 8000.
      // Binary search backwards must locate #10 despite delta > 30,000ms.
      const foundWithoutMax = findCueAtTimeBinaryFn(longCues, 35000);
      expect(foundWithoutMax?.id).toBe(10);

      const foundWithMax = findCueAtTimeBinaryFn(longCues, 35000, 50000);
      expect(foundWithMax?.id).toBe(10);

      // If maxDuration is strictly smaller than the delta, it will prune
      const pruned = findCueAtTimeBinaryFn(longCues, 35000, 10000);
      expect(pruned).toBeUndefined();
    });
  });

  describe('optimistic playback and playIntent concurrency', () => {
    it('provides instant optimistic play feedback and allows immediate pause during startup', async () => {
      const { video, play, iconPlay, iconPause, badge, load } = fixture();
      await load();

      let resolvePlay!: () => void;
      video.play.mockImplementation(() => new Promise<void>((resolve) => {
        resolvePlay = () => { video.paused = false; resolve(); };
      }));

      // Initially paused
      expect(iconPlay.style.display).not.toBe('none');
      expect(iconPause.style.display).toBe('none');

      // 1. User clicks Play
      play.dispatchEvent(new Event('click'));

      // Optimistic instant feedback
      expect(iconPlay.style.display).toBe('none');
      expect(iconPause.style.display).toBe('block');
      expect(badge.textContent).toBe('Playing Live');

      // 2. User immediately clicks again before play() resolves (wants to pause)
      play.dispatchEvent(new Event('click'));

      // Must pause and immediately flip UI back, not call playVideo() again
      expect(video.pause).toHaveBeenCalledOnce();
      expect(iconPlay.style.display).toBe('block');
      expect(iconPause.style.display).toBe('none');
      expect(badge.textContent).toBe('Paused');

      // Resolving old play promise should not restart playback
      resolvePlay();
      await flush();
      expect(video.paused).toBe(true);
    });

    it('isolates aborted play rejection from subsequent play request via playSerial', async () => {
      const { video, play, iconPlay, iconPause, load } = fixture();
      await load();

      let rejectPlay1!: (err: Error) => void;
      const play1Promise = new Promise<void>((_, reject) => { rejectPlay1 = reject; });

      video.play.mockImplementationOnce(() => play1Promise);

      // Start play attempt #1
      play.dispatchEvent(new Event('click'));
      expect(iconPlay.style.display).toBe('none');
      expect(iconPause.style.display).toBe('block');

      // Immediately cancel / pause play #1
      play.dispatchEvent(new Event('click'));
      expect(iconPlay.style.display).toBe('block');
      expect(iconPause.style.display).toBe('none');

      // Now start play attempt #2
      let resolvePlay2!: () => void;
      video.play.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolvePlay2 = () => { video.paused = false; resolve(); };
      }));
      play.dispatchEvent(new Event('click'));
      expect(iconPlay.style.display).toBe('none');
      expect(iconPause.style.display).toBe('block');

      // Play #1 rejects with AbortError asynchronously
      rejectPlay1(new Error('AbortError'));
      await flush();

      // UI should STILL reflect active play attempt #2, not wiped by play #1 catch
      expect(iconPlay.style.display).toBe('none');
      expect(iconPause.style.display).toBe('block');

      // Play #2 completes successfully
      resolvePlay2();
      await flush();
      expect(video.paused).toBe(false);
      expect(iconPlay.style.display).toBe('none');
      expect(iconPause.style.display).toBe('block');
    });

    it('preserves play intent during wheel scroll seeking and resumes playback', async () => {
      const { video, play, container, load } = fixture();
      await load();

      let resolvePlay!: () => void;
      video.play.mockImplementation(() => new Promise<void>((resolve) => {
        resolvePlay = () => { video.paused = false; resolve(); };
      }));

      // Click play (intent set)
      play.dispatchEvent(new Event('click'));

      // Wheel scroll horizontally while play is in-flight (video.paused is still true)
      wheel(container, 30);
      expect(video.pause).toHaveBeenCalled();

      // Settle fast seek and scroll seek debounce
      video.settle();
      vi.advanceTimersByTime(150);
      // Settle final precise seek
      video.settle();

      // Should automatically re-trigger playVideo once seek settles
      expect(video.play).toHaveBeenCalledTimes(2);
    });
  });

  describe('volume controls collapse and lifecycle', () => {
    it('blurs and collapses volume slider when mouse leaves wrapper if not dragging', async () => {
      const { volumeWrapper, volumeSlider, load } = fixture();
      await load();

      // Mouse leaves wrapper while not dragging
      volumeWrapper.dispatchEvent(new Event('mouseleave'));
      expect(volumeSlider.blur).toHaveBeenCalled();
    });

    it('does not blur volume slider prematurely during active drag, but blurs when drag finishes outside wrapper', async () => {
      const { volumeWrapper, volumeSlider, load } = fixture();
      await load();

      // Start drag
      volumeSlider.dispatchEvent(new Event('pointerdown'));
      volumeSlider.blur.mockClear();

      // Mouse temporarily leaves wrapper during active drag
      volumeWrapper.dispatchEvent(new Event('mouseleave'));
      expect(volumeSlider.blur).not.toHaveBeenCalled();

      // Wrapper is not hovered when drag ends
      volumeWrapper.matches = (sel: string) => sel === ':hover' ? false : false;
      window.dispatchEvent(new Event('pointerup'));
      vi.advanceTimersByTime(10);
      expect(volumeSlider.blur).toHaveBeenCalled();
    });

    it('blurs volume slider when clicking outside or pressing Escape', async () => {
      const { volumeWrapper, volumeSlider, load } = fixture();
      await load();

      // Escape key
      const escEvent = new Event('keydown');
      Object.assign(escEvent, { key: 'Escape' });
      volumeSlider.dispatchEvent(escEvent);
      expect(volumeSlider.blur).toHaveBeenCalled();

      // Clicking outside
      doc.activeElement = volumeSlider;
      volumeWrapper.contains = () => false;
      doc.dispatchEvent(new Event('pointerdown'));
      expect(volumeSlider.blur).toHaveBeenCalledTimes(2);
    });
  });

  describe('companion subtitle detection and video switching lifecycle', () => {
    it('detects companion subtitle on first video load and also on subsequent video switches', async () => {
      const { controller, load, internal } = fixture();
      await load();

      const subFiles: Record<string, string> = {
        '/media/episode1.srt': '1\n00:00:01,000 --> 00:00:04,000\nHello from Episode 1\n',
        '/media/episode2.vtt': 'WEBVTT\n\n00:00:02.000 --> 00:00:05.000\nHello from Episode 2\n',
        '/media/custom.srt': '1\n00:00:00,500 --> 00:00:02,000\nCustom explicit sub\n',
      };

      invoke.mockImplementation(async (command: string, args: { filePath?: string; sourcePath?: string; requestId?: number }) => {
        if (command === 'read_text_file_content' && args.filePath && subFiles[args.filePath]) {
          return subFiles[args.filePath];
        }
        if (command === 'begin_hardsub_preview') {
          return { requestId: args.requestId, candidateId: String(args.requestId), url: `http://localhost${args.sourcePath}`, stage: 'direct', source: null };
        }
        throw new Error('Not found');
      });

      // 1. First video load: episode1.mp4 has episode1.srt
      controller.prefillFilePaths('/media/episode1.mp4', '');
      await flush();

      expect(internal.state.subtitlePath).toBe('/media/episode1.srt');
      expect(internal.subtitleCues.length).toBe(1);
      expect(internal.subtitleCues[0].text).toBe('Hello from Episode 1');

      // 2. Second video load: episode2.mp4 has episode2.vtt
      // MUST NOT retain episode1.srt! It must auto-detect episode2.vtt
      controller.prefillFilePaths('/media/episode2.mp4', '');
      await flush();

      expect(internal.state.subtitlePath).toBe('/media/episode2.vtt');
      expect(internal.subtitleCues.length).toBe(1);
      expect(internal.subtitleCues[0].text).toBe('Hello from Episode 2');

      // 3. Third video load: episode3.mp4 has NO companion subtitle
      // MUST cleanly clear the previous subtitle state
      controller.prefillFilePaths('/media/episode3.mp4', '');
      await flush();

      expect(internal.state.subtitlePath).toBe('');
      expect(internal.subtitleCues.length).toBe(0);

      // 4. Explicit subtitle provided via prefillFilePaths is preserved
      controller.prefillFilePaths('/media/episode3.mp4', '/media/custom.srt');
      await flush();

      expect(internal.state.subtitlePath).toBe('/media/custom.srt');
      expect(internal.subtitleCues.length).toBe(1);
      expect(internal.subtitleCues[0].text).toBe('Custom explicit sub');
    });
  });

  describe('granular clear and global reset functionality', () => {
    it('manages button visibility based on loaded media', async () => {
      const { controller, load, internal, btnClearVideo, btnClearSub, btnResetAll } = fixture();
      await load();

      // Video is loaded from load()
      expect(internal.state.videoPath).toBe('/video.mp4');
      expect(btnClearVideo.style.display).toBe('inline-flex');
      expect(btnClearSub.style.display).toBe('none');
      expect(btnResetAll.style.display).toBe('inline-flex');

      // Clear video
      controller.clearVideoState();
      expect(internal.state.videoPath).toBe('');
      expect(btnClearVideo.style.display).toBe('none');
      expect(btnResetAll.style.display).toBe('none');

      // Now load only a subtitle
      invoke.mockImplementation(async (command: string) => {
        if (command === 'read_text_file_content') return '1\n00:00:01,000 --> 00:00:02,000\nSub line\n';
        throw new Error('Not found');
      });
      controller.prefillFilePaths('', '/sub.srt');
      await flush();

      expect(internal.state.subtitlePath).toBe('/sub.srt');
      expect(btnClearVideo.style.display).toBe('none');
      expect(btnClearSub.style.display).toBe('inline-flex');
      expect(btnResetAll.style.display).toBe('inline-flex');

      // Clear subtitle
      controller.clearSubtitleState();
      expect(internal.state.subtitlePath).toBe('');
      expect(internal.subtitleCues.length).toBe(0);
      expect(btnClearSub.style.display).toBe('none');
      expect(btnResetAll.style.display).toBe('none');
    });

    it('resetAllMedia clears both video and subtitle state completely', async () => {
      const { controller, load, internal, btnClearVideo, btnClearSub, btnResetAll } = fixture();
      await load();

      invoke.mockImplementation(async (command: string) => {
        if (command === 'read_text_file_content') return '1\n00:00:01,000 --> 00:00:02,000\nSub line\n';
        throw new Error('Not found');
      });
      controller.prefillFilePaths('/video.mp4', '/sub.srt');
      await flush();

      expect(internal.state.videoPath).toBe('/video.mp4');
      expect(internal.state.subtitlePath).toBe('/sub.srt');
      expect(btnClearVideo.style.display).toBe('inline-flex');
      expect(btnClearSub.style.display).toBe('inline-flex');
      expect(btnResetAll.style.display).toBe('inline-flex');

      // Reset all media
      controller.resetAllMedia();
      expect(internal.state.videoPath).toBe('');
      expect(internal.state.subtitlePath).toBe('');
      expect(internal.subtitleCues.length).toBe(0);
      expect(btnClearVideo.style.display).toBe('none');
      expect(btnClearSub.style.display).toBe('none');
      expect(btnResetAll.style.display).toBe('none');
    });

    it('prevents clearing media while encoding is active', async () => {
      const { controller, load, internal } = fixture();
      await load();

      internal.updateEncodingUIState(true);
      controller.clearVideoState();
      // Should not have cleared because isEncoding is true
      expect(internal.state.videoPath).toBe('/video.mp4');

      controller.resetAllMedia();
      expect(internal.state.videoPath).toBe('/video.mp4');
    });
  });
});


