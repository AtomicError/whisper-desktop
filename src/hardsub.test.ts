import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardsubController } from './hardsub';

let Controller: typeof HardsubController;
const controllers: HardsubController[] = [];
class Control extends EventTarget {
  value = '0';
  disabled = false;
  textContent = '';
  style: Record<string, string> = {};
  closest = (_selector: string): Control | null => null;
  setAttribute() {}
  focus() {}
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
  // Inject only event-capable DOM/media boundaries. Loading, seeking and rendering are real.
  const internal = controller as unknown as {
    videoElement: Media; videoSeekSlider: Control; videoPlayBtn: Control;
    lblVideoName: Control; videoStatusBadge: Control; videoTimeDisplay: Control;
    previewCancelBtn: Control; previewRetryBtn: Control;
    freezeCanvas: { width: number; height: number; style: Record<string, string> };
    freezeCtx: { clearRect(): void; drawImage(): void };
    state: { videoPath: string; outputPath: string };
    setupVideoPlayerEvents(): void;
  };
  Object.assign(internal, { videoElement: video, videoSeekSlider: slider, videoPlayBtn: play, lblVideoName: label, videoStatusBadge: badge, videoTimeDisplay: time });
  Object.assign(internal, { previewCancelBtn: cancel, previewRetryBtn: retry });
  internal.setupVideoPlayerEvents();
  const load = async (active = true) => {
    controller.prefillFilePaths('/video.mp4', '');
    await flush();
    video.ready();
    if (active) controller.setPageActive(true);
    video.pause.mockClear();
  };
  return { controller, video, slider, play, label, badge, time, container, internal, load, cancel, retry };
}

beforeAll(async () => {
  vi.stubGlobal('document', new DocumentBoundary());
  vi.stubGlobal('window', new EventTarget());
  const module = await import('./hardsub');
  Controller = module.HardsubController;
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
