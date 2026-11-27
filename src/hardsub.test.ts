import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HardsubController } from './hardsub';

let Controller: typeof HardsubController;
let formatHardsubStatusFn: typeof import('./hardsub').formatHardsubStatus;
let getParentDirFn: typeof import('./hardsub').getParentDir;
let joinPathFn: typeof import('./hardsub').joinPath;
let findCueAtTimeBinaryFn: typeof import('./hardsub').findCueAtTimeBinary;
let parseSubtitleContentFn: typeof import('./hardsub').parseSubtitleContent;
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
  id = '';
  tagName = '';
  className = '';
  isFragment = false;
  value = '0';
  disabled = false;
  textContent = '';
  title = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  classList = new ClassList();
  children: Control[] = [];
  selectedIndex = 0;
  closest = (_selector: string): Control | null => null;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  focus = vi.fn();
  blur = vi.fn();
  contains(_node: unknown): boolean { return false; }
  matches(_selector: string): boolean { return false; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  appendChild(child: Control) {
    if (child.isFragment) {
      this.children.push(...child.children);
      child.children = [];
    } else {
      this.children.push(child);
    }
    return child;
  }
  private _html = '';
  get innerHTML() { return this._html; }
  set innerHTML(v: string) { this._html = v; this.children = []; }
  get options() { return this.children; }
  querySelector(selector: string): Control | null {
    if (selector === 'span') {
      return this.children.find(c => (c as any).tagName === 'SPAN') ?? null;
    }
    const match = selector.match(/value="([^"]+)"/);
    if (match) {
      return this.children.find(c => c.value === match[1]) ?? null;
    }
    return null;
  }
  querySelectorAll(_selector: string): Control[] {
    return [];
  }
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
  playbackRate = 1.0;
  error: { code: number } | null = null;
  canPlayType() { return 'probably'; }
  time = 0;
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
  body = new Control();
  elements = new Map<string, Control>();
  getElementById = (id: string) => this.elements.get(id) ?? null;
  querySelectorAll = () => [];
  fonts = { load: async () => [] };
  createElement = (tag: string) => {
    const c = new Control();
    c.tagName = tag.toUpperCase();
    (c as any).getContext = () => ({
      measureText: (text: string) => ({ width: text.length * 10 }),
      save: () => {},
      restore: () => {},
      textBaseline: 'alphabetic',
      font: '',
    });
    return c;
  };
  createDocumentFragment = () => {
    const frag = new Control();
    frag.isFragment = true;
    return frag;
  };
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
  const boldBtn = new Control();
  boldBtn.classList.add('active');
  const italicBtn = new Control();
  doc.elements.set('hardsub-btn-bold', boldBtn);
  doc.elements.set('hardsub-btn-italic', italicBtn);

  const jumpBackBtn = new Control();
  const jumpFwdBtn = new Control();
  const speedBtn = new Control();
  const speedLabel = new Control();
  const timeCurrent = new Control();
  const timeTotal = new Control();
  const prevCueBtn = new Control();
  const nextCueBtn = new Control();
  doc.elements.set('hardsub-btn-jump-back', jumpBackBtn);
  doc.elements.set('hardsub-btn-jump-fwd', jumpFwdBtn);
  doc.elements.set('hardsub-btn-speed', speedBtn);
  doc.elements.set('hardsub-speed-label', speedLabel);
  doc.elements.set('hardsub-time-current', timeCurrent);
  doc.elements.set('hardsub-time-total', timeTotal);
  doc.elements.set('hardsub-btn-prev-cue', prevCueBtn);
  doc.elements.set('hardsub-btn-next-cue', nextCueBtn);

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
  const outputLocationModes = new Control();
  const outputModeInputBtn = new Control();
  const outputModeCustomBtn = new Control();
  const outputCustomRow = new Control();
  outputCustomRow.style.display = 'none';
  const outputDirText = new Control();
  const btnOpenDir = new Control();
  btnOpenDir.disabled = true;
  const btnBrowseDir = new Control();
  const btnOpenFolder = new Control();
  const btnPlayVideo = new Control();
  const telemetryBox = new Control();
  const volumeWrapper = new Control();
  const volumeBtn = new Control();
  const volumeSlider = new Control();
  volumeSlider.value = '1';
  const btnClearVideo = new Control();
  btnClearVideo.style.display = 'none';
  const btnClearSub = new Control();
  btnClearSub.style.display = 'none';
  const btnResetAll = new Control();
  btnResetAll.style.display = 'none';
  const startBtn = new Control();
  const startBtnSpan = new Control();
  (startBtnSpan as any).tagName = 'SPAN';
  startBtn.appendChild(startBtnSpan);
  doc.elements.set('btn-start-hardsub', startBtn);
  doc.elements.set('hardsub-output-location-modes', outputLocationModes);
  doc.elements.set('hardsub-output-mode-input', outputModeInputBtn);
  doc.elements.set('hardsub-output-mode-custom', outputModeCustomBtn);
  doc.elements.set('hardsub-output-custom-row', outputCustomRow);
  doc.elements.set('hardsub-output-dir-text', outputDirText);
  doc.elements.set('btn-open-hardsub-dir', btnOpenDir);
  doc.elements.set('btn-browse-hardsub-dir', btnBrowseDir);
  doc.elements.set('btn-open-hardsub-folder', btnOpenFolder);
  doc.elements.set('btn-play-hardsub-video', btnPlayVideo);
  doc.elements.set('hardsub-telemetry-box', telemetryBox);
  doc.elements.set('hardsub-volume-wrapper', volumeWrapper);
  doc.elements.set('hardsub-btn-volume', volumeBtn);
  doc.elements.set('hardsub-volume-slider', volumeSlider);
  doc.elements.set('btn-clear-hardsub-video', btnClearVideo);
  doc.elements.set('btn-clear-hardsub-sub', btnClearSub);
  doc.elements.set('btn-reset-hardsub-all', btnResetAll);
  const fullscreenBtn = new Control();
  const iconFsEnter = new Control();
  const iconFsExit = new Control();
  doc.elements.set('hardsub-btn-fullscreen', fullscreenBtn);
  doc.elements.set('hardsub-icon-fs-enter', iconFsEnter);
  doc.elements.set('hardsub-icon-fs-exit', iconFsExit);

  // Inject only event-capable DOM/media boundaries. Loading, seeking and rendering are real.
  const internal = controller as unknown as {
    videoElement: Media; videoSeekSlider: Control; videoPlayBtn: Control;
    videoIconPlay: Control; videoIconPause: Control;
    lblVideoName: Control; videoStatusBadge: Control; videoTimeDisplay: Control;
    previewCancelBtn: Control; previewRetryBtn: Control;
    volumeControlWrapper: Control; videoVolumeBtn: Control; videoVolumeSlider: Control;
    videoFullscreenBtn: Control; videoIconFsEnter: Control; videoIconFsExit: Control;
    btnClearVideo: Control; btnClearSub: Control; btnResetAll: Control;
    freezeCanvas: { width: number; height: number; style: Record<string, string> };
    freezeCtx: { clearRect(): void; drawImage(): void };
    state: { videoPath: string; outputPath: string; outputDirMode: 'input_dir' | 'custom'; outputDir: string; subtitlePath: string };
    subtitleCues: Array<{ text: string; startMs: number; endMs: number }>;
    outputLocationModes: Control;
    outputModeInputBtn: Control;
    outputModeCustomBtn: Control;
    outputCustomRow: Control;
    outputDirText: Control;
    btnOpenDir: Control;
    btnBrowseDir: Control;
    btnOpenFolder: Control;
    btnPlayVideo: Control;
    telemetryBox: Control;
    updateEncodingUIState(active: boolean): void;
    setupVideoPlayerEvents(): void;
    setOutputDirMode(mode: 'input_dir' | 'custom'): void;
    openCustomOutputDir(): Promise<void>;
    browseOutputDir(): Promise<void>;
    resetOutputDir(): void;
    updateOutputDirUI(): void;
    openOutputFolder(): Promise<void>;
    openExportedVideo(): Promise<void>;
    phase: string;
    loadSubtitleFile(subPath: string): Promise<void>;
    isPlayerFullscreen: boolean;
    toggleFullscreen(): void;
    exitPreviewFullscreen(): void;
  };
  const iconPlay = new Control();
  const iconPause = new Control();
  Object.assign(internal, {
    videoElement: video, videoSeekSlider: slider, videoPlayBtn: play, lblVideoName: label, videoStatusBadge: badge, videoTimeDisplay: time,
    videoIconPlay: iconPlay, videoIconPause: iconPause,
    outputLocationModes, outputModeInputBtn, outputModeCustomBtn, outputCustomRow, outputDirText, btnOpenDir, btnBrowseDir, btnOpenFolder, btnPlayVideo, telemetryBox,
    volumeControlWrapper: volumeWrapper, videoVolumeBtn: volumeBtn, videoVolumeSlider: volumeSlider,
    videoFullscreenBtn: fullscreenBtn, videoIconFsEnter: iconFsEnter, videoIconFsExit: iconFsExit,
    btnClearVideo, btnClearSub, btnResetAll,
  });
  const hwSelect = new Control();
  const codecSelect = new Control();
  const fontSelect = new Control();
  doc.elements.set('hardsub-hw', hwSelect);
  doc.elements.set('hardsub-codec', codecSelect);
  doc.elements.set('hardsub-font', fontSelect);
  Object.assign(internal, { hwSelect, codecSelect, fontSelect, boldToggle: boldBtn, italicToggle: italicBtn });
  Object.assign(internal, { previewCancelBtn: cancel, previewRetryBtn: retry });
  Object.assign(internal, { btnJumpBack: jumpBackBtn, btnJumpFwd: jumpFwdBtn, btnSpeed: speedBtn, speedLabel, timeCurrentEl: timeCurrent, timeTotalEl: timeTotal, prevCueBtn, nextCueBtn });
  internal.setupVideoPlayerEvents();
  (internal as any).setupEventListeners();
  const load = async (active = true) => {
    controller.prefillFilePaths('/video.mp4', '');
    await flush();
    video.ready();
    if (active) controller.setPageActive(true);
    video.pause.mockClear();
  };
  return { controller, video, slider, play, iconPlay, iconPause, label, badge, time, container, internal, load, cancel, retry, outputLocationModes, outputModeInputBtn, outputModeCustomBtn, outputCustomRow, outputDirText, btnOpenDir, btnBrowseDir, btnOpenFolder, btnPlayVideo, telemetryBox, volumeWrapper, volumeBtn, volumeSlider, btnClearVideo, btnClearSub, btnResetAll, fullscreenBtn, iconFsEnter, iconFsExit, fontSelect, boldBtn, italicBtn, startBtn, jumpBackBtn, jumpFwdBtn, speedBtn, speedLabel, timeCurrent, timeTotal, prevCueBtn, nextCueBtn };
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
  parseSubtitleContentFn = module.parseSubtitleContent;
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
    expect(video.currentTime).toBe(5);
    expect(time.textContent).toContain('00:05');
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
    expect(video.currentTime).toBe(5);
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
    expect(video.currentTime).toBe(5);
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
    expect(video.currentTime).toBe(5);
  });

  it('allows keyboard shortcuts when non-input controls like play button are active', async () => {
    const { video, load } = fixture();
    await load();
    const playButton = new Control();
    (playButton as any).tagName = 'BUTTON';
    playButton.id = 'hardsub-btn-play';
    doc.activeElement = playButton;

    // ArrowRight seeks 5s
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    video.settle();
    expect(video.currentTime).toBe(5);

    // ArrowLeft seeks -5s
    expect(key('ArrowLeft').defaultPrevented).toBe(true);
    video.settle();
    expect(video.currentTime).toBe(0);

    // ArrowUp adjusts volume
    video.volume = 0.5;
    expect(key('ArrowUp').defaultPrevented).toBe(true);
    expect(video.volume).toBeCloseTo(0.55);

    // Space toggles playback
    expect(key(' ').defaultPrevented).toBe(true);
    expect(video.play).toHaveBeenCalled();

    doc.activeElement = null;
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

  it('automatically advances direct preview to conversion when direct playback times out', async () => {
    const { controller, video } = fixture();
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation((command: string, args: PreviewArguments) => {
      if (command === 'advance_hardsub_preview') {
        return Promise.resolve({
          requestId: args.requestId,
          candidateId: 'remuxed',
          url: 'http://localhost/remuxed.mp4',
          stage: 'remux',
          source: null,
        });
      }
      return base(command, args);
    });

    controller.prefillFilePaths('/video.mp4', '');
    await flush();

    // Advance timers by direct timeout (3000ms) without calling video.ready()
    vi.advanceTimersByTime(3000);
    await flush();

    const advances = invoke.mock.calls.filter(([command]) => command === 'advance_hardsub_preview');
    expect(advances.length).toBeGreaterThanOrEqual(1);
    expect(video.src).toBe('http://localhost/remuxed.mp4');
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
      message: 'Rendering Hardsub Video... (Speed: 6.52x | 188.18 FPS)',
      active: true,
      stage: 'encoding',
      speed: '6.52x',
      fps: '188.18',
    });
    expect(formatted).toContain('6.52x');
    expect(formatted).toContain('188.18');
    expect(formatted).toContain('Rendering Hardsub Video');
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
    expect(formatted).toContain('4.12x');
    expect(formatted).toContain('120.00');
  });

  it('formats Rendering Hardsub Video messages cleanly', () => {
    const formatted = formatHardsubStatusFn({
      progress: 0.55,
      message: 'Rendering Hardsub Video... (Speed: 5.20x | 144.00 FPS)',
      active: true,
    });
    expect(formatted).toContain('5.20x');
    expect(formatted).toContain('144.00');
    expect(formatted).toContain('Rendering Hardsub Video');
  });
});

describe('hardsub output directory management', () => {
  it('defaults to source video folder and switches between Same as Input and Custom Folder cleanly', async () => {
    const { controller, internal, outputModeInputBtn, outputModeCustomBtn, outputCustomRow, outputDirText, btnOpenDir } = fixture();
    controller.prefillFilePaths('/media/movies/intro.mp4', '');
    await flush();

    // Default output path is in the same directory as source video
    expect(internal.state.outputDirMode).toBe('input_dir');
    expect(internal.state.outputPath).toBe('/media/movies/intro_hardsub.mp4');
    expect(outputModeInputBtn.classList.contains('active')).toBe(true);
    expect(outputModeInputBtn.getAttribute('aria-checked')).toBe('true');
    expect(outputCustomRow.style.display).toBe('none');
    expect(btnOpenDir.disabled).toBe(true);

    // Select custom output directory via browse
    invoke.mockImplementation(async (command: string) => {
      if (command === 'select_directory') return '/custom/export/path';
      return undefined;
    });

    await internal.browseOutputDir();
    await flush();

    expect(internal.state.outputDirMode).toBe('custom');
    expect(internal.state.outputDir).toBe('/custom/export/path');
    expect(internal.state.outputPath).toBe('/custom/export/path/intro_hardsub.mp4');
    expect(outputModeCustomBtn.classList.contains('active')).toBe(true);
    expect(outputCustomRow.style.display).toBe('block');
    expect(outputDirText.textContent).toBe('/custom/export/path');
    expect(outputDirText.classList.contains('has-custom-path')).toBe(true);
    expect(btnOpenDir.disabled).toBe(false);

    // Switch back to Same as Input without losing the remembered custom directory
    internal.setOutputDirMode('input_dir');
    expect(internal.state.outputDirMode).toBe('input_dir');
    expect(internal.state.outputDir).toBe('/custom/export/path');
    expect(internal.state.outputPath).toBe('/media/movies/intro_hardsub.mp4');
    expect(outputCustomRow.style.display).toBe('none');

    // Switch back to Custom Folder restores the remembered directory
    internal.setOutputDirMode('custom');
    expect(internal.state.outputPath).toBe('/custom/export/path/intro_hardsub.mp4');
    expect(outputCustomRow.style.display).toBe('block');

    // Reset output directory
    internal.resetOutputDir();
    expect(internal.state.outputDirMode).toBe('input_dir');
    expect(internal.state.outputDir).toBe('');
    expect(internal.state.outputPath).toBe('/media/movies/intro_hardsub.mp4');
    expect(outputDirText.classList.contains('has-custom-path')).toBe(false);
    expect(btnOpenDir.disabled).toBe(true);
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

  it('openOutputFolder invokes show_in_folder with target file', async () => {
    const { internal } = fixture();
    internal.state.outputPath = '/media/movies/intro_hardsub.mp4';
    await internal.openOutputFolder();
    expect(invoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/media/movies/intro_hardsub.mp4' });

    // Test fallback to open_file_in_editor when show_in_folder fails
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'show_in_folder') return Promise.reject(new Error('Show failed'));
      return Promise.resolve(null);
    });
    await internal.openOutputFolder();
    expect(invoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/media/movies/intro_hardsub.mp4' });
    expect(invoke).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/media/movies' });
  });

  it('openExportedVideo invokes open_file_in_editor with target video file', async () => {
    const { internal } = fixture();
    internal.state.outputPath = '/media/movies/intro_hardsub.mp4';
    await internal.openExportedVideo();
    expect(invoke).toHaveBeenCalledWith('open_file_in_editor', { filePath: '/media/movies/intro_hardsub.mp4' });
  });

  it('clears lastExportedPath and hides open folder and play video buttons when new video is selected', async () => {
    const { controller, internal, btnOpenFolder, btnPlayVideo } = fixture();
    btnOpenFolder.style.display = 'inline-flex';
    btnPlayVideo.style.display = 'inline-flex';
    (internal as any).lastExportedPath = '/media/movies/old_hardsub.mp4';

    controller.prefillFilePaths('/media/movies/new_video.mp4', '');
    await flush();

    expect(btnOpenFolder.style.display).toBe('none');
    expect(btnPlayVideo.style.display).toBe('none');
    expect((internal as any).lastExportedPath).toBeNull();
  });

  it('manages permanent telemetry HUD and resets to idle state', async () => {
    const { controller, internal, telemetryBox } = fixture();
    // Initially and permanently visible
    telemetryBox.style.display = 'flex';

    // When encoding becomes active, telemetryBox remains visible
    internal.updateEncodingUIState(true);
    expect(telemetryBox.style.display).toBe('flex');

    // When settled completed, telemetryBox remains visible
    (internal as any).lastStatusPayload = { stage: 'completed', progress: 1.0, message: 'Done', active: false };
    internal.updateEncodingUIState(false);
    expect(telemetryBox.style.display).toBe('flex');

    // When selecting a new video, telemetryBox stays visible in idle mode
    controller.prefillFilePaths('/media/movies/another_video.mp4', '');
    await flush();
    expect(telemetryBox.style.display).toBe('flex');
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

  describe('volume controls lifecycle', () => {
    it('updates video volume on slider input', async () => {
      const { video, volumeSlider, load } = fixture();
      await load();

      volumeSlider.value = '0.6';
      volumeSlider.dispatchEvent(new Event('input'));
      expect(video.volume).toBe(0.6);
      expect(video.muted).toBe(false);
    });

    it('toggles mute on button click and restores previous volume', async () => {
      const { video, volumeBtn, volumeSlider, load } = fixture();
      await load();

      volumeSlider.value = '0.75';
      volumeSlider.dispatchEvent(new Event('input'));
      expect(video.volume).toBe(0.75);
      expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');
      expect(volumeBtn.getAttribute('data-i18n-title')).toBe('hardsub.muteAudio');

      // Click mute
      volumeBtn.dispatchEvent(new Event('click'));
      expect(video.muted).toBe(true);
      expect(volumeSlider.value).toBe('0');
      expect(volumeBtn.getAttribute('aria-label')).toBe('Unmute');
      expect(volumeBtn.getAttribute('data-i18n-title')).toBe('hardsub.unmuteAudio');

      // Click unmute
      volumeBtn.dispatchEvent(new Event('click'));
      expect(video.muted).toBe(false);
      expect(video.volume).toBe(0.75);
      expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');
      expect(volumeBtn.getAttribute('data-i18n-title')).toBe('hardsub.muteAudio');
    });

    it('preserves muted state across playVideo calls without auto-unmuting', async () => {
      const { video, volumeBtn, load, internal } = fixture();
      await load();

      // Mute the video
      volumeBtn.dispatchEvent(new Event('click'));
      expect(video.muted).toBe(true);

      // Trigger playVideo
      (internal as any).playVideo();
      expect(video.muted).toBe(true);
    });

    it('blurs volume slider when pressing Escape', async () => {
      const { volumeSlider, load } = fixture();
      await load();

      const escEvent = new Event('keydown');
      Object.assign(escEvent, { key: 'Escape' });
      volumeSlider.dispatchEvent(escEvent);
      expect(volumeSlider.blur).toHaveBeenCalled();
    });

    it('synchronizes play and fullscreen button titles and aria attributes', async () => {
      const { play, fullscreenBtn, load, internal } = fixture();
      await load();

      // Initially paused
      expect(play.getAttribute('aria-label')).toBe('Play Video');
      expect(play.getAttribute('data-i18n-title')).toBe('hardsub.playVideo');
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Toggle Fullscreen');
      expect(fullscreenBtn.getAttribute('data-i18n-title')).toBe('hardsub.toggleFullscreen');

      // Play video
      play.dispatchEvent(new Event('click'));
      await flush();
      expect(play.getAttribute('aria-label')).toBe('Pause Video');
      expect(play.getAttribute('data-i18n-title')).toBe('hardsub.pauseVideo');

      // Fullscreen change
      (internal as any).onFullscreenStateChanged(true);
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Exit Fullscreen');
      expect(fullscreenBtn.getAttribute('data-i18n-title')).toBe('hardsub.exitFullscreen');

      (internal as any).onFullscreenStateChanged(false);
      expect(fullscreenBtn.getAttribute('aria-label')).toBe('Toggle Fullscreen');
      expect(fullscreenBtn.getAttribute('data-i18n-title')).toBe('hardsub.toggleFullscreen');
    });
  });

  describe('subtitle cards rendering and auto-resize', () => {
    it('auto-resizes cue textarea based on scrollHeight and border offset', () => {
      const { internal } = fixture();
      const mockTextarea = {
        style: {} as Record<string, string>,
        scrollHeight: 120,
        offsetHeight: 122,
        clientHeight: 120,
      } as unknown as HTMLTextAreaElement;

      (internal as any).autoResizeCueTextarea(mockTextarea);
      // scrollHeight (120) + border (122 - 120 = 2) = 122px
      expect(mockTextarea.style.height).toBe('122px');

      // Accurately fits larger content without artificial cutoff
      Object.defineProperty(mockTextarea, 'scrollHeight', { value: 350, configurable: true });
      Object.defineProperty(mockTextarea, 'offsetHeight', { value: 352, configurable: true });
      Object.defineProperty(mockTextarea, 'clientHeight', { value: 350, configurable: true });
      (internal as any).autoResizeCueTextarea(mockTextarea);
      expect(mockTextarea.style.height).toBe('352px');

      // Enforces ergonomic 48px floor for short single-line content
      Object.defineProperty(mockTextarea, 'scrollHeight', { value: 36, configurable: true });
      Object.defineProperty(mockTextarea, 'offsetHeight', { value: 38, configurable: true });
      Object.defineProperty(mockTextarea, 'clientHeight', { value: 36, configurable: true });
      (internal as any).autoResizeCueTextarea(mockTextarea);
      expect(mockTextarea.style.height).toBe('48px');
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

    it('preserves manually loaded user subtitle when video without companion is selected', async () => {
      const { controller, load, internal } = fixture();
      await load();

      const subFiles: Record<string, string> = {
        '/media/user-chosen.srt': '1\n00:00:01,000 --> 00:00:04,000\nUser chosen subtitle\n',
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

      // User manually loads a subtitle via browse / loadSubtitleFile
      internal.state.subtitlePath = '/media/user-chosen.srt';
      await internal.loadSubtitleFile('/media/user-chosen.srt');
      expect(internal.state.subtitlePath).toBe('/media/user-chosen.srt');
      expect(internal.subtitleCues.length).toBe(1);

      // Now user loads a video with NO companion subtitle
      controller.prefillFilePaths('/media/no-companion.mp4', '');
      await flush();

      // The manually chosen subtitle MUST NOT be cleared!
      expect(internal.state.subtitlePath).toBe('/media/user-chosen.srt');
      expect(internal.subtitleCues.length).toBe(1);
      expect(internal.subtitleCues[0].text).toBe('User chosen subtitle');
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

    it('clearVideoState resets phase to idle, disables controls, and releases preview backend resources', async () => {
      const { controller, load, internal, play, slider, badge, jumpBackBtn, jumpFwdBtn, speedBtn, volumeBtn, volumeSlider, fullscreenBtn, prevCueBtn, nextCueBtn } = fixture();
      await load();

      expect(internal.phase).toBe('ready');
      expect((play as any).disabled).toBe(false);
      expect((slider as any).disabled).toBe(false);
      expect((jumpBackBtn as any).disabled).toBe(false);
      expect((jumpFwdBtn as any).disabled).toBe(false);
      expect((speedBtn as any).disabled).toBe(false);
      expect((volumeBtn as any).disabled).toBe(false);
      expect((volumeSlider as any).disabled).toBe(false);
      expect((fullscreenBtn as any).disabled).toBe(false);
      expect((prevCueBtn as any).disabled).toBe(false);
      expect((nextCueBtn as any).disabled).toBe(false);

      controller.clearVideoState();
      await flush();

      expect(internal.phase).toBe('idle');
      expect((play as any).disabled).toBe(true);
      expect((slider as any).disabled).toBe(true);
      expect((jumpBackBtn as any).disabled).toBe(true);
      expect((jumpFwdBtn as any).disabled).toBe(true);
      expect((speedBtn as any).disabled).toBe(true);
      expect((volumeBtn as any).disabled).toBe(true);
      expect((volumeSlider as any).disabled).toBe(true);
      expect((fullscreenBtn as any).disabled).toBe(true);
      expect((prevCueBtn as any).disabled).toBe(true);
      expect((nextCueBtn as any).disabled).toBe(true);
      expect(badge.textContent).toBe('No Video Loaded');
      expect(invoke).toHaveBeenCalledWith('release_hardsub_preview', expect.anything());
    });

    it('updates start button disabled state, title, and data-i18n-title based on video, subtitle, and encoding readiness', async () => {
      const { load, internal, startBtn } = fixture();
      const startBtnSpan = (startBtn as any).querySelector('span');
      internal.state.videoPath = '';
      internal.state.subtitlePath = '';
      internal.updateEncodingUIState(false);
      expect((startBtn as any).disabled).toBe(true);
      expect((startBtn as any).title).toBe('Please select a video file first.');
      expect((startBtn as any).getAttribute('data-i18n-title')).toBe('hardsub.selectVideoFirst');
      expect(startBtnSpan?.getAttribute('data-i18n')).toBe('hardsub.exportHardsubVideo');

      await load();
      internal.state.subtitlePath = '';
      internal.updateEncodingUIState(false);
      expect((startBtn as any).disabled).toBe(true);
      expect((startBtn as any).title).toBe('Please select a subtitle file first.');
      expect((startBtn as any).getAttribute('data-i18n-title')).toBe('hardsub.selectSubFirst');

      internal.state.subtitlePath = '/sub.srt';
      internal.updateEncodingUIState(false);
      expect((startBtn as any).disabled).toBe(false);
      expect((startBtn as any).title).toBe('Export Hardsub Video');
      expect((startBtn as any).getAttribute('data-i18n-title')).toBe('hardsub.exportHardsubVideo');
      expect(startBtnSpan?.getAttribute('data-i18n')).toBe('hardsub.exportHardsubVideo');

      internal.updateEncodingUIState(true);
      expect((startBtn as any).disabled).toBe(true);
      expect((startBtn as any).title).toBe('Exporting Hardsub Video...');
      expect((startBtn as any).getAttribute('data-i18n-title')).toBe('hardsub.exportingVideo');
      expect(startBtnSpan?.getAttribute('data-i18n')).toBe('hardsub.exportingVideo');
    });

    it('clearVideoState invalidates in-flight video preview loads via videoLoadGeneration', async () => {
      const { controller, internal, video } = fixture();
      const base = invoke.getMockImplementation()!;

      let finishPreview!: (res: any) => void;
      const beginning = new Promise(resolve => { finishPreview = resolve; });
      invoke.mockImplementation((command: string, args: any) => {
        if (command === 'begin_hardsub_preview') {
          return beginning;
        }
        return base(command, args);
      });

      // Start loading a video
      controller.prefillFilePaths('/large-video.mp4', '');
      await flush();
      expect(internal.phase).toBe('loading');

      // User clears video before preview resolves
      controller.clearVideoState();
      expect(internal.phase).toBe('idle');

      // Now delayed preview resolves
      finishPreview({ requestId: 101, candidateId: '101', url: 'http://localhost/large-video.mp4', stage: 'direct', source: null });
      await flush();

      // Must remain idle with no mounted video src
      expect(internal.phase).toBe('idle');
      expect(internal.state.videoPath).toBe('');
      expect(video.src).toBe('');
    });

    it('clearSubtitleState invalidates in-flight subtitle reads via subtitleSerial', async () => {
      const { controller, internal } = fixture();

      let finishRead!: (content: string) => void;
      invoke.mockImplementation(async (command: string) => {
        if (command === 'read_text_file_content') {
          return new Promise<string>(resolve => { finishRead = resolve; });
        }
        throw new Error('Not found');
      });

      // Start loading a slow subtitle file
      internal.state.subtitlePath = '/slow.srt';
      void internal.loadSubtitleFile('/slow.srt');

      // User clears subtitle state while read is in-flight
      controller.clearSubtitleState();
      expect(internal.state.subtitlePath).toBe('');
      expect(internal.subtitleCues.length).toBe(0);

      // Slow file finishes reading
      finishRead('1\n00:00:01,000 --> 00:00:05,000\nLate subtitle line\n');
      await flush();

      // State must remain clear
      expect(internal.state.subtitlePath).toBe('');
      expect(internal.subtitleCues.length).toBe(0);
    });

    it('toggles in-app player fullscreen and updates classes and icons', async () => {
      const { controller, internal, container, fullscreenBtn, iconFsEnter, iconFsExit, load } = fixture();
      await load();

      // Before fullscreen
      expect(internal.isPlayerFullscreen).toBe(false);
      expect(container.classList.contains('player-fullscreen')).toBe(false);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(false);

      // Trigger fullscreen toggle
      fullscreenBtn.dispatchEvent(new Event('click'));
      expect(internal.isPlayerFullscreen).toBe(true);
      expect(container.classList.contains('player-fullscreen')).toBe(true);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(true);
      expect(iconFsEnter.style.display).toBe('none');
      expect(iconFsExit.style.display).toBe('block');

      // Toggle again to exit
      fullscreenBtn.dispatchEvent(new Event('click'));
      expect(internal.isPlayerFullscreen).toBe(false);
      expect(container.classList.contains('player-fullscreen')).toBe(false);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(false);
      expect(iconFsEnter.style.display).toBe('block');
      expect(iconFsExit.style.display).toBe('none');
    });

    it('exits in-app player fullscreen when Escape key is pressed', async () => {
      const { internal, container, fullscreenBtn, iconFsEnter, iconFsExit, load } = fixture();
      await load();

      fullscreenBtn.dispatchEvent(new Event('click'));
      expect(internal.isPlayerFullscreen).toBe(true);
      expect(container.classList.contains('player-fullscreen')).toBe(true);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(true);

      // Press Escape
      key('Escape');
      expect(internal.isPlayerFullscreen).toBe(false);
      expect(container.classList.contains('player-fullscreen')).toBe(false);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(false);
      expect(iconFsEnter.style.display).toBe('block');
      expect(iconFsExit.style.display).toBe('none');
    });

    it('exitPreviewFullscreen cleanly cleans up fullscreen state', async () => {
      const { internal, container, fullscreenBtn, load } = fixture();
      await load();

      fullscreenBtn.dispatchEvent(new Event('click'));
      expect(internal.isPlayerFullscreen).toBe(true);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(true);

      internal.exitPreviewFullscreen();
      expect(internal.isPlayerFullscreen).toBe(false);
      expect(container.classList.contains('player-fullscreen')).toBe(false);
      expect(doc.body.classList.contains('hardsub-fullscreen-active')).toBe(false);
    });

    it('formatHardsubErrorMessage correctly translates structured error payloads', async () => {
      const { internal } = fixture();

      // Hardware unsupported
      const hwErr = JSON.stringify({ errorType: 'hw_unsupported', codec: 'av1', hwAccel: 'qsv', exitCode: 218 });
      const hwMsg = (internal as any).formatHardsubErrorMessage(hwErr);
      expect(hwMsg).toContain('AV1');

      // Disk full
      const diskErr = JSON.stringify({ errorType: 'disk_full' });
      const diskMsg = (internal as any).formatHardsubErrorMessage(diskErr);
      expect(diskMsg.length).toBeGreaterThan(0);

      // Permission denied
      const permErr = JSON.stringify({ errorType: 'permission_denied' });
      const permMsg = (internal as any).formatHardsubErrorMessage(permErr);
      expect(permMsg.length).toBeGreaterThan(0);

      // Corrupt input
      const corruptErr = JSON.stringify({ errorType: 'corrupt_input' });
      const corruptMsg = (internal as any).formatHardsubErrorMessage(corruptErr);
      expect(corruptMsg.length).toBeGreaterThan(0);

      // Subtitle filter
      const subErr = JSON.stringify({ errorType: 'subtitle_filter' });
      const subMsg = (internal as any).formatHardsubErrorMessage(subErr);
      expect(subMsg.length).toBeGreaterThan(0);

      // Out of memory
      const oomErr = JSON.stringify({ errorType: 'out_of_memory' });
      const oomMsg = (internal as any).formatHardsubErrorMessage(oomErr);
      expect(oomMsg.length).toBeGreaterThan(0);

      // Signal
      const sigErr = JSON.stringify({ errorType: 'signal' });
      const sigMsg = (internal as any).formatHardsubErrorMessage(sigErr);
      expect(sigMsg.length).toBeGreaterThan(0);

      // Generic error with code
      const genErr = JSON.stringify({ errorType: 'generic', exitCode: 42 });
      const genMsg = (internal as any).formatHardsubErrorMessage(genErr);
      expect(genMsg).toContain('42');

      // Fallback for non-JSON string
      const plainMsg = (internal as any).formatHardsubErrorMessage('Simple plain error');
      expect(plainMsg).toBe('Simple plain error');
    });
  });

  describe('hardware codecs filtering', () => {
    it('filters out unsupported codecs like AV1 on QSV when not supported by hardware', () => {
      const { internal } = fixture();
      const hwSelect = (internal as any).hwSelect;
      const codecSelect = (internal as any).codecSelect;

      const hwStatus = {
        hasQsv: true,
        hasNvenc: false,
        hasVaapi: false,
        hasVideotoolbox: false,
        qsvCodecs: ['h264', 'h265'], // AV1 is missing!
      };

      (internal as any).cachedHwStatus = hwStatus;
      (internal as any).populateHardwareDropdown(hwStatus);

      // Verify hwSelect has cpu and qsv
      const hwValues = hwSelect.children.map((c: any) => c.value);
      expect(hwValues).toContain('cpu');
      expect(hwValues).toContain('qsv');

      // Switch to QSV
      (internal as any).state.hwAccel = 'qsv';
      (internal as any).updateSupportedCodecs();

      // Check codec options: should only have h264 and h265, NOT av1
      const codecValues = codecSelect.children.map((c: any) => c.value);
      expect(codecValues).toEqual(['h264', 'h265']);
      expect(codecValues).not.toContain('av1');
    });

    it('automatically falls back to h264 if previously selected codec is not supported by new accelerator', () => {
      const { internal } = fixture();
      const codecSelect = (internal as any).codecSelect;

      const hwStatus = {
        hasQsv: true,
        hasNvenc: true,
        hasVaapi: false,
        hasVideotoolbox: false,
        qsvCodecs: ['h264', 'h265'],
        nvencCodecs: ['h264', 'h265', 'av1'],
      };

      (internal as any).cachedHwStatus = hwStatus;

      // Select NVENC and AV1
      (internal as any).state.hwAccel = 'nvenc';
      (internal as any).state.videoCodec = 'av1';
      (internal as any).updateSupportedCodecs();
      expect((internal as any).state.videoCodec).toBe('av1');

      // Switch to QSV which does NOT have AV1
      (internal as any).state.hwAccel = 'qsv';
      (internal as any).updateSupportedCodecs();
      expect((internal as any).state.videoCodec).toBe('h264');
      expect(codecSelect.value).toBe('h264');
    });

    it('provides all software codecs when CPU is selected', () => {
      const { internal } = fixture();
      const codecSelect = (internal as any).codecSelect;

      (internal as any).state.hwAccel = 'cpu';
      (internal as any).updateSupportedCodecs();

      const codecValues = codecSelect.children.map((c: any) => c.value);
      expect(codecValues).toEqual(['h264', 'h265', 'av1', 'vp9', 'prores']);
    });
  });

  describe('bundled fonts management and smart defaults', () => {
    it('returns Vazirmatn for Persian/Arabic language and Inter for other languages', () => {
      const { controller } = fixture();
      // By default in test environment language is 'en'
      expect(controller.getSmartDefaultFont()).toBe('Inter');
    });

    it('populates bundled fonts with English fonts first and then Persian fonts', async () => {
      const { internal, fontSelect } = fixture();
      const mockFonts = [
        { name: 'Inter', source: 'bundled' },
        { name: 'Roboto', source: 'bundled' },
        { name: 'Outfit', source: 'bundled' },
        { name: 'JetBrains Mono', source: 'bundled' },
        { name: 'Lora', source: 'bundled' },
        { name: 'Montserrat', source: 'bundled' },
        { name: 'Vazirmatn', source: 'bundled' },
        { name: 'Shabnam', source: 'bundled' },
        { name: 'Samim', source: 'bundled' },
        { name: 'Sahel', source: 'bundled' },
        { name: 'Arial', source: 'system' },
      ];

      invoke.mockImplementation(async (command: string) => {
        if (command === 'get_system_fonts') return mockFonts;
        if (command === 'check_hardware_encoders') return { hasQsv: false, hasNvenc: false, hasVaapi: false, hasVideotoolbox: false };
        if (command === 'get_font_render_scale') return { scale: 1.0, ascentRatio: 0.78, descentRatio: 0.22 };
        return undefined;
      });

      await (internal as any).loadFontsAndHardware();

      // Check optgroups
      expect(fontSelect.children.length).toBe(2);
      const bundledGroup = fontSelect.children[0];
      const systemGroup = fontSelect.children[1];

      const bundledNames = bundledGroup.children.map((c: any) => c.value);
      expect(bundledNames).toEqual([
        'Inter',
        'Roboto',
        'Outfit',
        'JetBrains Mono',
        'Lora',
        'Montserrat',
        'Vazirmatn',
        'Shabnam',
        'Samim',
        'Sahel',
      ]);

      const systemNames = systemGroup.children.map((c: any) => c.value);
      expect(systemNames).toEqual(['Arial']);
    });

    it('defers loadFontsAndHardware during active splash screen until post-splash hydration', () => {
      // Arrange
      const splashCurtain = new Control();
      doc.elements.set('splash-curtain', splashCurtain);
      doc.readyState = 'complete';
      invoke.mockClear();

      // Act
      const deferredController = new Controller();
      controllers.push(deferredController);

      // Assert
      const invokedCommands = invoke.mock.calls.map(c => c[0]);
      expect(invokedCommands).not.toContain('get_system_fonts');
      expect(invokedCommands).not.toContain('check_hardware_encoders');
      doc.elements.delete('splash-curtain');
    });
  });

  describe('font style formatting (bold and italic toggles)', () => {
    it('toggles bold and italic state and active classes when clicked', async () => {
      const { internal, boldBtn, italicBtn } = fixture();
      await flush();

      // Bold is enabled by default
      expect((internal.state as any).bold).toBe(true);
      expect((internal.state as any).italic).toBe(false);
      expect(boldBtn.classList.contains('active')).toBe(true);
      expect(italicBtn.classList.contains('active')).toBe(false);

      // Click Bold to toggle OFF
      boldBtn.dispatchEvent(new Event('click'));
      await flush();
      expect((internal.state as any).bold).toBe(false);
      expect(boldBtn.classList.contains('active')).toBe(false);

      // Click Italic to toggle ON
      italicBtn.dispatchEvent(new Event('click'));
      await flush();
      expect((internal.state as any).italic).toBe(true);
      expect(italicBtn.classList.contains('active')).toBe(true);

      // Click Italic again to toggle OFF
      italicBtn.dispatchEvent(new Event('click'));
      await flush();
      expect((internal.state as any).italic).toBe(false);
      expect(italicBtn.classList.contains('active')).toBe(false);
    });

    it('generates correct ASS tags for bold and italic styling', async () => {
      const { internal } = fixture();
      await flush();

      (internal as any).directSourceGeometry = { width: 1920, height: 1080 };
      internal.subtitleCues = [{ text: 'Hello World', startMs: 0, endMs: 2000 }];

      // Default: bold=true, italic=false -> \b1 and \i0
      (internal.state as any).bold = true;
      (internal.state as any).italic = false;
      let ass = (internal as any).generateAssContent();
      expect(ass).toContain('\\b1\\i0');

      // Toggled: bold=false, italic=true -> \b0 and \i1
      (internal.state as any).bold = false;
      (internal.state as any).italic = true;
      ass = (internal as any).generateAssContent();
      expect(ass).toContain('\\b0\\i1');

      // Both true -> \b1 and \i1
      (internal.state as any).bold = true;
      (internal.state as any).italic = true;
      ass = (internal as any).generateAssContent();
      expect(ass).toContain('\\b1\\i1');

      // Both false -> \b0 and \i0
      (internal.state as any).bold = false;
      (internal.state as any).italic = false;
      ass = (internal as any).generateAssContent();
      expect(ass).toContain('\\b0\\i0');
    });

    it('respects inline formatting tags over default style settings', async () => {
      const { internal } = fixture();
      await flush();

      (internal as any).directSourceGeometry = { width: 1920, height: 1080 };
      internal.subtitleCues = [{ text: 'Normal <i>italic</i> word', startMs: 0, endMs: 2000 }];
      (internal.state as any).bold = false;
      (internal.state as any).italic = false;
      const ass = (internal as any).generateAssContent();
      expect(ass).toContain('\\i1');
      expect(ass).toContain('\\i0');
    });
  });

  describe('subtitle format preservation and temp ASS fallback on export', () => {
    it('saves modified VTT subtitles in WebVTT format and does not corrupt ASS subtitles with SRT', async () => {
      const { internal } = fixture();
      await flush();

      const writes: Array<{ filePath: string; content: string }> = [];
      invoke.mockImplementation(async (command: string, args?: any) => {
        if (command === 'get_font_render_scale') return { scale: 1.0, ascentRatio: 0.78, descentRatio: 0.22 };
        if (command === 'write_text_file_content') {
          writes.push(args);
          return undefined;
        }
        if (command === 'start_hardsub_task') {
          return { outputPath: '/out/video_hardsub.mp4', durationMs: 1000, outputSizeMb: 5 };
        }
        return undefined;
      });

      (internal as any).directSourceGeometry = { width: 1920, height: 1080 };
      internal.state.videoPath = '/media/video.mp4';
      (internal as any).subtitlePathInput = { value: '/media/captions.vtt' };
      internal.state.subtitlePath = '/media/captions.vtt';
      internal.subtitleCues = [{ id: 1, startMs: 1000, endMs: 3500, startTimeStr: '00:00:01.000', endTimeStr: '00:00:03.500', text: 'Edited VTT cue' } as any];
      (internal as any).isSubtitlesModified = true;

      await (internal as any).startHardsub();

      const vttWrite = writes.find(w => w.filePath === '/media/captions.vtt');
      expect(vttWrite).toBeDefined();
      expect(vttWrite?.content).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nEdited VTT cue\n');
      expect((internal as any).isSubtitlesModified).toBe(false);

      // Now test with an .ass file: must not overwrite original .ass file with SRT
      writes.length = 0;
      (internal as any).subtitlePathInput = { value: '/media/styled.ass' };
      internal.state.subtitlePath = '/media/styled.ass';
      (internal as any).isSubtitlesModified = true;

      await (internal as any).startHardsub();

      const assOriginalWrite = writes.find(w => w.filePath === '/media/styled.ass');
      expect(assOriginalWrite).toBeUndefined();
      const tempAssWrite = writes.find(w => w.filePath === '/media/video.temp.ass');
      expect(tempAssWrite).toBeDefined();
      expect((internal as any).isSubtitlesModified).toBe(false);
    });
  });

  describe('modern player controls & speed integration', () => {
    it('jumps 5s back and forward safely when jump buttons are clicked', async () => {
      const { video, load, jumpBackBtn, jumpFwdBtn } = fixture();
      await load();
      video.time = 20;
      video.settle();

      jumpBackBtn.dispatchEvent(new Event('click'));
      video.settle();
      expect(video.currentTime).toBe(15);

      jumpFwdBtn.dispatchEvent(new Event('click'));
      video.settle();
      expect(video.currentTime).toBe(20);
    });

    it('cycles playback speed smoothly on click and right-click and updates label and video element', async () => {
      const { video, load, speedBtn, speedLabel } = fixture();
      await load();

      expect(speedLabel.textContent).toBe('1.0x');

      // Left-click cycles forward: 1.0 -> 1.25 -> 1.5 -> 2.0 -> 0.75 -> 1.0
      speedBtn.dispatchEvent(new Event('click'));
      expect(video.playbackRate).toBe(1.25);
      expect(speedLabel.textContent).toBe('1.25x');

      speedBtn.dispatchEvent(new Event('click'));
      expect(video.playbackRate).toBe(1.5);
      expect(speedLabel.textContent).toBe('1.5x');

      // Right-click (contextmenu) cycles backward: 1.5 -> 1.25
      const rightClickEvent = new Event('contextmenu', { cancelable: true });
      speedBtn.dispatchEvent(rightClickEvent);
      expect(rightClickEvent.defaultPrevented).toBe(true);
      expect(video.playbackRate).toBe(1.25);
      expect(speedLabel.textContent).toBe('1.25x');
    });

    it('renders timecode with millisecond precision in timeCurrent and timeTotal elements', async () => {
      const { video, load, timeCurrent, timeTotal, time, internal } = fixture();
      await load();
      video.duration = 65.432;
      video.currentTime = 12.345;

      (internal as any).updatePlaybackTime();

      expect(timeCurrent.innerHTML).toContain('00:12');
      expect(timeCurrent.innerHTML).toContain('<span class="timecode-ms">.345</span>');
      expect(timeTotal.innerHTML).toContain('01:05');
      expect(timeTotal.innerHTML).toContain('<span class="timecode-ms">.432</span>');
      // Backward compatibility element
      expect(time.textContent).toBe('00:12 / 01:05');
    });

    it('disables all media-dependent player controls when no video is loaded and enables them when ready', async () => {
      const { internal, load, play, slider, jumpBackBtn, jumpFwdBtn, prevCueBtn, nextCueBtn, speedBtn, volumeBtn, volumeSlider, fullscreenBtn } = fixture();

      // Before video is loaded (idle phase)
      (internal as any).renderPlayerPhase();
      expect(play.disabled).toBe(true);
      expect(slider.disabled).toBe(true);
      expect(jumpBackBtn.disabled).toBe(true);
      expect(jumpFwdBtn.disabled).toBe(true);
      expect(prevCueBtn.disabled).toBe(true);
      expect(nextCueBtn.disabled).toBe(true);
      expect(speedBtn.disabled).toBe(true);
      expect(volumeBtn.disabled).toBe(true);
      expect(volumeSlider.disabled).toBe(true);
      expect(fullscreenBtn.disabled).toBe(true);

      // After video loads and enters ready phase
      await load();
      expect(play.disabled).toBe(false);
      expect(slider.disabled).toBe(false);
      expect(jumpBackBtn.disabled).toBe(false);
      expect(jumpFwdBtn.disabled).toBe(false);
      expect(prevCueBtn.disabled).toBe(false);
      expect(nextCueBtn.disabled).toBe(false);
      expect(speedBtn.disabled).toBe(false);
      expect(volumeBtn.disabled).toBe(false);
      expect(volumeSlider.disabled).toBe(false);
      expect(fullscreenBtn.disabled).toBe(false);
    });
  });

  describe('subtitle parsing, ASS layout safety, and encoding locks', () => {
    it('parses MM:SS.mmm WebVTT timestamps with cue settings accurately', () => {
      const vtt = [
        'WEBVTT',
        '',
        '00:05.500 --> 00:08.200 align:start position:10%',
        'First line',
        '',
        '01:02:03.450 --> 01:02:05.000',
        'Second line',
      ].join('\n');

      const cues = parseSubtitleContentFn(vtt, 'vtt');
      expect(cues).toHaveLength(2);
      expect(cues[0].startMs).toBe(5500);
      expect(cues[0].endMs).toBe(8200);
      expect(cues[0].endTimeStr).toBe('00:08.200');
      expect(cues[1].startMs).toBe(3723450);
      expect(cues[1].endMs).toBe(3725000);
    });

    it('parses .ssa, .lrc, and .sub subtitle formats into cues', () => {
      const ssa = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello\\NWorld';
      const ssaCues = parseSubtitleContentFn(ssa, 'ssa');
      expect(ssaCues).toHaveLength(1);
      expect(ssaCues[0].startMs).toBe(1000);
      expect(ssaCues[0].endMs).toBe(3500);
      expect(ssaCues[0].text).toBe('Hello\nWorld');

      const lrc = '[ti:Song]\n[00:02.50][00:10.00]Chorus\n[00:05.00]\n[00:12.00]Verse';
      const lrcCues = parseSubtitleContentFn(lrc, 'lrc');
      expect(lrcCues).toHaveLength(3);
      expect(lrcCues[0].startMs).toBe(2500);
      expect(lrcCues[0].endMs).toBe(5000);
      expect(lrcCues[0].text).toBe('Chorus');
      expect(lrcCues[1].startMs).toBe(10000);
      expect(lrcCues[1].endMs).toBe(12000);
      expect(lrcCues[2].startMs).toBe(12000);
      expect(lrcCues[2].endMs).toBe(15000);

      const microDvd = '{1}{1}25\n{25}{75}Line one|Line two';
      const subCues = parseSubtitleContentFn(microDvd, 'sub');
      expect(subCues).toHaveLength(1);
      expect(subCues[0].startMs).toBe(1000);
      expect(subCues[0].endMs).toBe(3000);
      expect(subCues[0].text).toBe('Line one\nLine two');

      const subViewer = '00:01:00.00,00:01:05.50\nFirst[br]Second';
      const subViewerCues = parseSubtitleContentFn(subViewer, 'sub');
      expect(subViewerCues).toHaveLength(1);
      expect(subViewerCues[0].startMs).toBe(60000);
      expect(subViewerCues[0].endMs).toBe(65500);
      expect(subViewerCues[0].text).toBe('First\nSecond');
    });

    it('escapes literal braces in ASS output and keeps top/bottom lines inside frame bounds', () => {
      const { internal } = fixture();
      (internal as any).directSourceGeometry = { width: 1920, height: 1080 };
      (internal as any).fontMetrics = { scale: 0.585, ascentRatio: 0.628, descentRatio: 0.372 };
      internal.subtitleCues = [{ text: '{music} First line\nSecond line\nThird line', startMs: 0, endMs: 2000 }];

      (internal.state as any).alignment = 2; // Bottom Center
      (internal.state as any).positionY = 10;
      const bottomAss = (internal as any).generateAssContent();
      expect(bottomAss).toContain('\\{music\\}');
      const bottomYMatches = [...bottomAss.matchAll(/\\pos\([^,]+,([-\d.]+)\)/g)].map(m => parseFloat(m[1]));
      expect(bottomYMatches.length).toBe(3);
      for (const y of bottomYMatches) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(288);
      }

      (internal.state as any).alignment = 8; // Top Center
      (internal.state as any).positionY = 10;
      const topAss = (internal as any).generateAssContent();
      const topYMatches = [...topAss.matchAll(/\\pos\([^,]+,([-\d.]+)\)/g)].map(m => parseFloat(m[1]));
      expect(topYMatches.length).toBe(3);
      expect(topYMatches[0]).toBeGreaterThanOrEqual(10);
    });

    it('renders cue cards safely without raw innerHTML breakout on </textarea>', () => {
      const { internal } = fixture();
      const list = new Control();
      (internal as any).subtitleListContainer = list;
      internal.subtitleCues = [{
        id: 1,
        startMs: 0,
        endMs: 1000,
        startTimeStr: '00:00:00,000',
        endTimeStr: '00:00:01,000',
        text: 'Hello </textarea><img src=x onerror=alert(1)> &amp;',
      } as any];

      (internal as any).renderSubtitleCards();
      expect(list.children).toHaveLength(1);
      const card = list.children[0];
      expect(card.innerHTML).toBe('');
      const textarea = card.children[1];
      expect(textarea.tagName).toBe('TEXTAREA');
      expect(textarea.value).toBe('Hello </textarea><img src=x onerror=alert(1)> &amp;');
    });

    it('formats object errors like PreviewError cleanly instead of [object Object]', () => {
      const { internal } = fixture();
      const formatted = (internal as any).formatHardsubErrorMessage({
        code: 'tools_unavailable',
        detail: 'FFprobe binary not found',
      });
      expect(formatted).toBe('FFprobe binary not found');
      expect(formatted).not.toContain('[object Object]');

      const unknownObj = (internal as any).formatHardsubErrorMessage({ foo: 'bar' });
      expect(unknownObj).toBe('{"foo":"bar"}');
      expect(unknownObj).not.toContain('[object Object]');
    });

    it('locks browse buttons, prefillFilePaths, and loadSubtitleFile while encoding is active', async () => {
      const { controller, internal } = fixture();
      const browseVideo = new Control();
      const browseSub = new Control();
      doc.elements.set('btn-browse-video', browseVideo);
      doc.elements.set('btn-browse-sub', browseSub);
      (internal as any).btnBrowseVideo = browseVideo;
      (internal as any).btnBrowseSub = browseSub;
      (internal as any).setupEventListeners();

      internal.state.videoPath = '/original.mp4';
      internal.state.subtitlePath = '/original.srt';
      internal.subtitleCues = [{ text: 'Original cue', startMs: 0, endMs: 1000 } as any];

      internal.updateEncodingUIState(true);
      expect(browseVideo.disabled).toBe(true);
      expect(browseSub.disabled).toBe(true);

      browseVideo.dispatchEvent(new Event('click'));
      browseSub.dispatchEvent(new Event('click'));
      expect(invoke).not.toHaveBeenCalledWith('select_file', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('select_subtitle_file', expect.anything());

      (internal as any).selectVideoSource('/replacement.mp4');
      expect(internal.state.videoPath).toBe('/original.mp4');

      controller.prefillFilePaths('/replacement.mp4', '/replacement.srt');
      await (internal as any).loadSubtitleFile('/replacement.srt');
      await flush();
      expect(internal.state.videoPath).toBe('/original.mp4');
      expect(internal.state.subtitlePath).toBe('/original.srt');
      expect(internal.subtitleCues[0].text).toBe('Original cue');

      internal.updateEncodingUIState(false);
      expect(browseVideo.disabled).toBe(false);
      expect(browseSub.disabled).toBe(false);
    });

    it('preserves quality hint icon span when updating slider hint text', () => {
      const { internal } = fixture();
      const hintBox = new Control();
      const icon = new Control();
      icon.tagName = 'svg';
      const hintSpan = new Control();
      hintSpan.tagName = 'SPAN';
      hintBox.appendChild(icon);
      hintBox.appendChild(hintSpan);
      hintBox.querySelector = (sel: string) => sel === 'span' ? hintSpan : null;

      const slider = new Control();
      const label = new Control();
      (internal as any).qualitySlider = slider;
      (internal as any).qualityParamLabel = label;
      (internal as any).qualityHint = hintBox;

      (internal as any).updateQualitySliderConfig();
      expect(hintBox.children).toContain(icon);
      expect(hintSpan.textContent.length).toBeGreaterThan(0);
    });
  });

  describe('audit fixes: cancellation, sync, parsing, preview, and style persistence', () => {
    it('aborts startHardsub before encoding if cancelled during pre-encode checks', async () => {
      let resolveProbe!: (val: unknown) => void;
      const probePromise = new Promise((res) => { resolveProbe = res; });
      const taskbarSpy = vi.fn();
      (window as any).updateTaskbarProgress = taskbarSpy;
      (window as any).showNotification = vi.fn();

      invoke.mockImplementation(async (command: string) => {
        if (command === 'begin_hardsub_preview') return { requestId: 1, candidateId: '1', url: 'http://localhost/v.mp4', stage: 'direct', source: null };
        if (command === 'probe_hardsub_source') return probePromise;
        if (command === 'get_font_render_scale') return { scale: 0.585, ascentRatio: 0.628, descentRatio: 0.372 };
        return undefined;
      });

      const { internal, startBtn } = fixture();
      const cancelBtn = new Control();
      const cancelSpan = new Control();
      cancelSpan.tagName = 'SPAN';
      cancelBtn.appendChild(cancelSpan);
      (internal as any).cancelBtn = cancelBtn;

      const subInput = new Control();
      subInput.value = '/sub.srt';
      (internal as any).subtitlePathInput = subInput;
      internal.state.videoPath = '/v.mp4';
      internal.state.subtitlePath = '/sub.srt';
      internal.subtitleCues = [{ text: 'Hello', startMs: 0, endMs: 1000 }];

      const runPromise = (internal as any).startHardsub();
      await flush();

      // User cancels while probe_hardsub_source is still pending
      (internal as any).isCancelling = true;
      resolveProbe({ displayWidth: 1920, displayHeight: 1080, width: 1920, height: 1080, durationMs: 5000 });
      await runPromise;

      expect(invoke).not.toHaveBeenCalledWith('write_text_file_content', expect.anything());
      expect(invoke).not.toHaveBeenCalledWith('start_hardsub_task', expect.anything());
      expect((window as any).isHardsubRunning).toBe(false);
      expect(taskbarSpy).toHaveBeenCalledWith(0, false);
      expect((internal as any).lastStatusPayload?.stage).toBe('cancelled');
      expect(startBtn.disabled).toBe(false);
    });

    it('clears taskbar progress, global lock, and lastStatusPayload when hardsub-status emits cancelled', async () => {
      doc.readyState = 'complete';
      let statusHandler: ((ev: { payload: any }) => void) | null = null;
      (window as any).__TAURI__.event.listen = vi.fn(async (name: string, cb: (ev: { payload: any }) => void) => {
        if (name === 'hardsub-status') statusHandler = cb;
        return () => {};
      });
      const taskbarSpy = vi.fn();
      (window as any).updateTaskbarProgress = taskbarSpy;

      const { internal } = fixture();
      await flush();
      expect(statusHandler).not.toBeNull();

      statusHandler!({
        payload: { progress: 0.45, message: 'Encoding', active: true, stage: 'encoding' },
      });
      expect((window as any).isHardsubRunning).toBe(true);

      statusHandler!({
        payload: { progress: 0.45, message: 'Cancelled', active: false, stage: 'cancelled' },
      });

      expect((window as any).isHardsubRunning).toBe(false);
      expect(taskbarSpy).toHaveBeenLastCalledWith(0, false);
      expect((internal as any).lastStatusPayload?.stage).toBe('cancelled');
    });

    it('updates style control visibility and disabled classes even when video phase is idle', () => {
      const { internal, fontSelect } = fixture();
      const resetFont = new Control();
      const bgControls = new Control();
      const bgExtraControls = new Control();
      const outlinePicker = new Control();
      doc.elements.set('reset-fontsize', resetFont);
      doc.elements.set('hardsub-bg-controls', bgControls);
      doc.elements.set('hardsub-bg-extra-controls', bgExtraControls);
      doc.elements.set('hardsub-outline-picker-wrapper', outlinePicker);

      internal.phase = 'idle';
      (internal.state as any).fontSize = 22;
      (internal.state as any).bgBox = true;
      (internal.state as any).outlineSize = 0;

      (internal as any).updateLivePreview();

      expect(resetFont.style.display).toBe('inline-flex');
      expect(bgControls.classList.contains('control-disabled')).toBe(false);
      expect(bgExtraControls.classList.contains('control-disabled')).toBe(false);
      expect(outlinePicker.classList.contains('control-disabled')).toBe(true);
      expect(fontSelect).toBeTruthy();
    });

    it('syncs CustomSelect when Arabic subtitles trigger Vazirmatn auto-switch', async () => {
      const syncCustomSelects = vi.fn();
      (window as any).syncCustomSelects = syncCustomSelects;

      invoke.mockImplementation(async (command: string) => {
        if (command === 'read_text_file_content') {
          return '1\n00:00:00,000 --> 00:00:02,000\nسلام دنیا';
        }
        if (command === 'get_font_render_scale') {
          return { scale: 0.585, ascentRatio: 0.628, descentRatio: 0.372 };
        }
        return undefined;
      });

      const { internal, fontSelect } = fixture();
      (internal.state as any).fontName = 'Arial';
      internal.state.subtitlePath = '/fa.srt';

      await internal.loadSubtitleFile('/fa.srt');

      expect((internal.state as any).fontName).toBe('Vazirmatn');
      expect(fontSelect.value).toBe('Vazirmatn');
      expect(syncCustomSelects).toHaveBeenCalledWith(false, true);
    });

    it('detects extended companion formats and discards stale completion after refreshFontRenderScale', async () => {
      let resolveScale!: (v: unknown) => void;
      const scalePromise = new Promise((res) => { resolveScale = res; });

      invoke.mockImplementation(async (command: string, args: any) => {
        if (command === 'read_text_file_content') {
          if (args?.filePath === '/movie.lrc') return '[00:01.00]Companion LRC';
          if (args?.filePath === '/manual.srt') return '1\n00:00:00,000 --> 00:00:01,000\nManual Cue';
          throw new Error('Not found');
        }
        if (command === 'get_font_render_scale') {
          if (args?.fontName === 'Arial') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
          return scalePromise;
        }
        return undefined;
      });

      const { internal } = fixture();
      internal.state.videoPath = '/movie.mp4';
      const companionPromise = (internal as any).detectAndLoadCompanionSubtitle('/movie', '/movie.mp4');
      await flush();

      // User manually picks a subtitle while companion font metrics are still resolving
      (internal.state as any).fontName = 'Arial';
      internal.state.subtitlePath = '/manual.srt';
      await internal.loadSubtitleFile('/manual.srt');

      resolveScale({ scale: 0.585, ascentRatio: 0.628, descentRatio: 0.372 });
      const loadedCompanion = await companionPromise;

      expect(loadedCompanion).toBe(false);
      expect(internal.state.subtitlePath).toBe('/manual.srt');
      expect(internal.subtitleCues[0].text).toBe('Manual Cue');
    });

    it('updates FFmpeg preview without -noautorotate on media changes and enforces container compatibility', () => {
      const { internal } = fixture();
      const hwSelect = (internal as any).hwSelect as Control;
      const codecSelect = (internal as any).codecSelect as Control;
      const cmdPreview = new Control();
      const formatSelect = new Control();
      const audioCodecSelect = new Control();
      const vp9Opt = new Control();
      vp9Opt.value = 'vp9';
      const h264Opt = new Control();
      h264Opt.value = 'h264';
      codecSelect.appendChild(h264Opt);
      codecSelect.appendChild(vp9Opt);

      (internal as any).ffmpegCmdPreview = cmdPreview;
      (internal as any).formatSelect = formatSelect;
      (internal as any).audioCodecSelect = audioCodecSelect;
      (internal as any).setupExportEventListeners();

      (internal as any).selectVideoSource('/clips/test.mp4', true);
      expect(cmdPreview.textContent).toContain('"test.mp4"');
      expect(cmdPreview.textContent).not.toContain('-noautorotate');

      (internal as any).state.hwAccel = 'cpu';
      (internal as any).state.videoCodec = 'h264';
      (internal as any).state.audioCodec = 'aac';
      hwSelect.value = 'cpu';
      codecSelect.value = 'h264';
      formatSelect.value = 'webm';
      audioCodecSelect.value = 'aac';

      formatSelect.dispatchEvent(new Event('change'));
      expect((internal.state as any).videoCodec).toBe('vp9');
      expect((internal.state as any).audioCodec).toBe('opus');
    });

    it('renders empty search notice cleanly, resizes textareas on editor tab switch, and locks videoPlaceholder when non-idle', () => {
      const { internal } = fixture();
      const list = new Control();
      (internal as any).subtitleListContainer = list;
      internal.subtitleCues = [{
        id: 1,
        startMs: 0,
        endMs: 1000,
        startTimeStr: '00:00:00,000',
        endTimeStr: '00:00:01,000',
        text: 'Visible cue',
      } as any];
      (internal as any).searchFilterQuery = 'nonexistent';
      (internal as any).renderSubtitleCards();

      expect(list.children).toHaveLength(1);
      expect(list.children[0].className).toBe('hardsub-empty-search-notice');
      expect(list.children[0].textContent.length).toBeGreaterThan(0);

      const editorTabBtn = new Control();
      const styleTabBtn = new Control();
      const exportTabBtn = new Control();
      const editorView = new Control();
      const styleView = new Control();
      const exportView = new Control();
      (internal as any).tabBtnEditor = editorTabBtn;
      (internal as any).tabBtnStyle = styleTabBtn;
      (internal as any).tabBtnExport = exportTabBtn;
      (internal as any).tabViewEditor = editorView;
      (internal as any).tabViewStyle = styleView;
      (internal as any).tabViewExport = exportView;
      const resizeSpy = vi.fn();
      (internal as any).resizeAllCueTextareas = resizeSpy;
      (internal as any).setupStudioTabEvents();
      styleTabBtn.dispatchEvent(new Event('click'));
      editorTabBtn.dispatchEvent(new Event('click'));
      expect(resizeSpy).toHaveBeenCalled();

      const placeholder = new Control();
      (internal as any).videoPlaceholder = placeholder;
      (internal as any).setupEventListeners();
      internal.phase = 'loading';
      placeholder.dispatchEvent(new Event('click'));
      expect(invoke).not.toHaveBeenCalledWith('select_file', expect.anything());
    });

    it('preserves multi-line HTML styling and named CSS colors in ASS export and splits SRT blocks with blank whitespace lines', () => {
      const srtWithSpaces = [
        '1',
        '00:00:00,500 --> 00:00:01,500',
        'First block',
        '   \t  ',
        '2',
        '00:00:02,000 --> 00:00:03,000',
        'Second block',
      ].join('\n');
      const parsed = parseSubtitleContentFn(srtWithSpaces, 'srt');
      expect(parsed).toHaveLength(2);
      expect(parsed[1].text).toBe('Second block');

      const { internal } = fixture();
      (internal as any).directSourceGeometry = { width: 1280, height: 720 };
      (internal as any).fontMetrics = { scale: 0.585, ascentRatio: 0.628, descentRatio: 0.372 };
      (internal.state as any).bold = false;
      (internal.state as any).italic = false;
      internal.subtitleCues = [{
        text: '<i>First line\nSecond line</i> <font color="red">Alert</font>',
        startMs: 0,
        endMs: 2000,
      }];

      const ass = (internal as any).generateAssContent();
      const dialogueLines = ass.split('\n').filter((line: string) => line.startsWith('Dialogue: 1,'));
      expect(dialogueLines).toHaveLength(2);
      expect(dialogueLines[0]).toContain('\\i1');
      expect(dialogueLines[1]).toContain('\\i1');
      expect(dialogueLines[1]).toContain('\\c&H0000FF&');
    });

    it('persists and resets style settings in localStorage without persisting outputDir', () => {
      const store = new Map<string, string>();
      const prevResizeObserver = (globalThis as any).ResizeObserver;
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });

      try {
        doc.readyState = 'complete';
        const { internal, controller } = fixture();
        (internal.state as any).fontSize = 26;
        (internal.state as any).primaryColor = '#FF00AA';
        (internal.state as any).bgBox = true;
        (internal.state as any).alignment = 8;
        internal.state.outputDir = '/custom/out';
        (internal as any).saveStyleSettingsToStorage(true);

        expect(store.has('whisper_hardsub_style_settings')).toBe(true);
        const savedPayload = JSON.parse(store.get('whisper_hardsub_style_settings')!);
        expect(savedPayload.outputDir).toBeUndefined();

        const { internal: restoredInternal } = fixture();
        expect((restoredInternal.state as any).fontSize).toBe(26);
        expect((restoredInternal.state as any).primaryColor).toBe('#FF00AA');
        expect((restoredInternal.state as any).bgBox).toBe(true);
        expect((restoredInternal.state as any).alignment).toBe(8);
        expect(restoredInternal.state.outputDir).toBe('');

        (restoredInternal as any).resetStyleSettings();
        expect((restoredInternal.state as any).fontSize).toBe(14);
        expect((restoredInternal.state as any).primaryColor).toBe('#FFFFFF');
        expect((restoredInternal.state as any).bgBox).toBe(false);
        expect((restoredInternal.state as any).alignment).toBe(2);
        expect(store.has('whisper_hardsub_style_settings')).toBe(false);
        expect(controller).toBeTruthy();
      } finally {
        vi.stubGlobal('localStorage', undefined as any);
        vi.stubGlobal('ResizeObserver', prevResizeObserver);
      }
    });

    it('clears taskbar progress and preserves failure HUD state when startHardsub fails early', async () => {
      const taskbarSpy = vi.fn();
      (window as any).updateTaskbarProgress = taskbarSpy;
      (window as any).showNotification = vi.fn();
      invoke.mockImplementation(async (command: string) => {
        if (command === 'probe_hardsub_source') {
          throw new Error('ffprobe missing');
        }
        return undefined;
      });

      const { internal, startBtn } = fixture();
      const statusText = new Control();
      const progressFill = new Control();
      const progressPct = new Control();
      const telemetryBox = new Control();
      const subInput = new Control();
      subInput.value = '/sub.srt';
      (internal as any).subtitlePathInput = subInput;
      (internal as any).progressStatusText = statusText;
      (internal as any).progressFill = progressFill;
      (internal as any).progressPctText = progressPct;
      (internal as any).telemetryBox = telemetryBox;

      internal.state.videoPath = '/v.mp4';
      internal.state.subtitlePath = '/sub.srt';
      internal.subtitleCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' } as any];

      await (internal as any).startHardsub();

      expect((internal as any).lastStatusPayload?.stage).toBe('failed');
      expect(statusText.textContent).toContain('ffprobe missing');
      expect(progressFill.style.width).toBe('0%');
      expect(progressPct.textContent).toBe('0%');
      expect(taskbarSpy).toHaveBeenCalledWith(0, false);
      expect(startBtn.disabled).toBe(false);
    });

    it('loads pending subtitles inside startHardsub while keeping external browse loads locked during encode', async () => {
      let exportedSubPath: string | null = null;
      let writtenTempAss = '';
      invoke.mockImplementation(async (command: string, args?: any) => {
        if (command === 'get_font_render_scale') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
        if (command === 'probe_hardsub_source') return { displayWidth: 1920, displayHeight: 1080, width: 1920, height: 1080, durationMs: 5000 };
        if (command === 'read_text_file_content') {
          return '1\n00:00:00,000 --> 00:00:01,000\nDeferred cue\n';
        }
        if (command === 'write_text_file_content') {
          writtenTempAss = args?.content ?? '';
          return undefined;
        }
        if (command === 'start_hardsub_task') {
          exportedSubPath = args?.settings?.subtitlePath ?? null;
          // Simulate external browse attempt while encode is active
          await (internal as any).loadSubtitleFile('/other.srt');
          return { outputPath: '/out.mp4', durationMs: 100, outputSizeMb: 1 };
        }
        return undefined;
      });

      const { internal } = fixture();
      const subInput = new Control();
      subInput.value = '/sub.srt';
      (internal as any).subtitlePathInput = subInput;
      internal.state.videoPath = '/v.mp4';
      internal.state.subtitlePath = '/sub.srt';
      internal.subtitleCues = [];

      await (internal as any).startHardsub();

      expect(exportedSubPath).toBe('/v.temp.ass');
      expect(writtenTempAss).toContain('Deferred');
      expect(writtenTempAss).toContain('cue');
      expect(internal.state.subtitlePath).toBe('/sub.srt');
      expect(internal.subtitleCues).toHaveLength(1);
      expect(internal.subtitleCues[0].text).toBe('Deferred cue');
      expect(invoke).not.toHaveBeenCalledWith('read_text_file_content', { filePath: '/other.srt' });
    });

    it('refreshes font scale and re-renders live preview on fontSelect and reset, ignoring stale scale responses', async () => {
      doc.readyState = 'complete';
      let resolveInterScale!: (val: { scale: number; ascentRatio: number; descentRatio: number }) => void;
      const interPromise = new Promise<{ scale: number; ascentRatio: number; descentRatio: number }>((resolve) => {
        resolveInterScale = resolve;
      });
      let interCalls = 0;
      invoke.mockImplementation(async (command: string, args?: any) => {
        if (command === 'get_system_fonts') return ['Vazirmatn', 'Inter', 'Lora'];
        if (command === 'get_hw_accels') return [];
        if (command === 'get_font_render_scale') {
          if (args?.fontName === 'Inter') {
            interCalls += 1;
            return interCalls === 1 ? interPromise : { scale: 0.65, ascentRatio: 0.65, descentRatio: 0.35 };
          }
          if (args?.fontName === 'Lora') return { scale: 0.91, ascentRatio: 0.77, descentRatio: 0.23 };
          return { scale: 0.65, ascentRatio: 0.65, descentRatio: 0.35 };
        }
        return undefined;
      });

      const { internal, fontSelect } = fixture();
      await flush();

      const previewSpy = vi.spyOn(internal as any, 'updateLivePreview');

      fontSelect.value = 'Inter';
      fontSelect.dispatchEvent(new Event('change'));
      await flush();

      // User immediately picks Lora before Inter's scale resolves
      fontSelect.value = 'Lora';
      fontSelect.dispatchEvent(new Event('change'));
      await flush();

      expect((internal as any).fontMetrics.scale).toBe(0.91);
      const previewCallsBeforeStale = previewSpy.mock.calls.length;

      // Stale Inter scale arrives late and must be ignored
      resolveInterScale({ scale: 0.42, ascentRatio: 0.5, descentRatio: 0.5 });
      await flush();

      expect((internal as any).fontMetrics.scale).toBe(0.91);
      expect(previewSpy.mock.calls.length).toBe(previewCallsBeforeStale);

      // Reset style triggers fresh scale lookup and re-renders preview afterward
      (internal as any).resetStyleSettings();
      await flush();
      expect((internal as any).fontMetrics.scale).toBe(0.65);
      expect(previewSpy.mock.calls.length).toBeGreaterThan(previewCallsBeforeStale);
    });

    it('preserves fontSize=6 & positionY=250 in storage, syncs lastVolume on ArrowUp, clamps short cue seeks, and resets cursor on fullscreen exit', () => {
      const store = new Map<string, string>();
      const prevResizeObserver = (globalThis as any).ResizeObserver;
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      store.set('whisper_hardsub_style_settings', JSON.stringify({
        fontSize: 6,
        positionY: 220,
      }));
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });

      try {
        doc.readyState = 'complete';
        const { controller, internal, video } = fixture();
        expect((internal.state as any).fontSize).toBe(6);
        expect((internal.state as any).positionY).toBe(220);

        // Short <50ms cue clamps offset inside cue bounds instead of overshooting endMs
        expect((internal as any).getCueSeekTimeSec({ startMs: 1000, endMs: 1020 })).toBeCloseTo(1.01, 5);
        expect((internal as any).getCueSeekTimeSec({ startMs: 1000, endMs: 3000 })).toBeCloseTo(1.05, 5);

        // ArrowUp volume updates lastVolume so mute/unmute restores new level
        (internal as any).pageActive = true;
        internal.phase = 'ready';
        video.volume = 0.25;
        video.muted = false;
        const arrowUpEvent = Object.assign(new Event('keydown', { cancelable: true }), {
          key: 'ArrowUp',
          isComposing: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          shiftKey: false,
        });
        doc.dispatchEvent(arrowUpEvent);
        expect(video.volume).toBeCloseTo(0.3, 5);
        expect((internal as any).lastVolume).toBeCloseTo(0.3, 5);

        // Fullscreen exit resets hidden cursor on player container
        const playerContainer = new Control();
        playerContainer.classList.add('player-fullscreen');
        playerContainer.style.cursor = 'none';
        doc.elements.set('hardsub-player-container', playerContainer);
        (internal as any).exitPreviewFullscreen();
        expect(playerContainer.style.cursor).toBe('');

        // Localization refresh keeps cancelled/idle and failed status consistent
        const statusText = new Control();
        (internal as any).progressStatusText = statusText;
        (internal as any).lastStatusPayload = { progress: 0, message: 'Cancelled', active: false, stage: 'cancelled' };
        controller.refreshLocalization();
        expect(statusText.textContent).not.toContain('Cancelled');

        (internal as any).lastFailedErrorText = 'Codec unavailable';
        (internal as any).lastStatusPayload = { progress: 0, message: 'Hardsubbing encoding failed.', active: false, stage: 'failed' };
        controller.refreshLocalization();
        expect(statusText.textContent).toContain('Codec unavailable');
      } finally {
        vi.stubGlobal('localStorage', undefined as any);
        vi.stubGlobal('ResizeObserver', prevResizeObserver);
      }
    });

    it('guards fullscreen Escape when a modal is open, disables inner controls in disabled groups, and preserves failed error text across late status events', async () => {
      doc.readyState = 'complete';
      let statusHandler: ((ev: { payload: any }) => void) | null = null;
      (window as any).__TAURI__.event.listen = vi.fn(async (name: string, cb: (ev: { payload: any }) => void) => {
        if (name === 'hardsub-status') statusHandler = cb;
        return () => {};
      });

      const { internal } = fixture();
      await flush();

      // 1. Escape in fullscreen must not exit fullscreen while a modal overlay is open
      const playerContainer = new Control();
      doc.elements.set('hardsub-player-container', playerContainer);
      (internal as any).isPlayerFullscreen = true;
      playerContainer.classList.add('player-fullscreen');

      let modalOpen = true;
      (doc as any).querySelector = vi.fn((sel: string) => (modalOpen && sel.includes('shortcuts-modal-overlay') ? new Control() : null));
      key('Escape');
      expect((internal as any).isPlayerFullscreen).toBe(true);

      modalOpen = false;
      key('Escape');
      expect((internal as any).isPlayerFullscreen).toBe(false);

      // 2. setControlsGroupDisabled toggles .disabled on inner controls for keyboard accessibility
      const bgControls = new Control();
      const innerInput = new Control();
      const innerBtn = new Control();
      (bgControls as any).querySelectorAll = () => [innerInput, innerBtn];
      doc.elements.set('hardsub-bg-controls', bgControls);
      (internal.state as any).bgBox = false;
      (internal as any).updateUIControlsState();
      expect(bgControls.classList.contains('control-disabled')).toBe(true);
      expect(innerInput.disabled).toBe(true);
      expect(innerBtn.disabled).toBe(true);

      (internal.state as any).bgBox = true;
      (internal as any).updateUIControlsState();
      expect(bgControls.classList.contains('control-disabled')).toBe(false);
      expect(innerInput.disabled).toBe(false);
      expect(innerBtn.disabled).toBe(false);

      // 3. Late failed hardsub-status event preserves lastFailedErrorText
      const statusText = new Control();
      (internal as any).progressStatusText = statusText;
      (internal as any).lastFailedErrorText = 'NVENC unsupported';
      statusHandler!({
        payload: { progress: 0, message: 'Hardsubbing encoding failed.', active: false, stage: 'failed' },
      });
      expect(statusText.textContent).toContain('NVENC unsupported');
    });

    it('cleans up temp.ass on late pre-encode abort, preserves CRF 0, resets export HUD on new subtitle, and refreshes scale on RTL cue edit', async () => {
      const { controller, internal } = fixture();
      const qualitySlider = new Control();
      qualitySlider.value = '0';
      (internal as any).qualitySlider = qualitySlider;
      (internal.state as any).videoQualityValue = 22;

      const subInput = new Control();
      subInput.value = '/sub.srt';
      (internal as any).subtitlePathInput = subInput;
      internal.state.videoPath = '/v.mp4';
      internal.state.subtitlePath = '/sub.srt';
      internal.subtitleCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hello' } as any];
      (internal as any).sourceInfo = { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, durationSec: 10, videoStreamIndex: 0, audioStreamIndex: 1, startTimeSec: 0 };

      invoke.mockImplementation(async (command: string) => {
        if (command === 'get_font_render_scale') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
        if (command === 'write_text_file_content') {
          (internal as any).isCancelling = true;
          return undefined;
        }
        return undefined;
      });

      await (internal as any).startHardsub();
      expect((internal.state as any).videoQualityValue).toBe(0);
      expect(invoke).not.toHaveBeenCalledWith('start_hardsub_task', expect.anything());
      expect(invoke).toHaveBeenCalledWith('cleanup_hardsub_temp_ass', { filePath: '/v.temp.ass' });

      // Loading a new subtitle resets completed export HUD buttons and path
      const openFolderBtn = new Control();
      const playVideoBtn = new Control();
      openFolderBtn.style.display = 'inline-flex';
      playVideoBtn.style.display = 'inline-flex';
      (internal as any).btnOpenFolder = openFolderBtn;
      (internal as any).btnPlayVideo = playVideoBtn;
      (internal as any).lastExportedPath = '/out.mp4';
      invoke.mockImplementation(async (command: string) => {
        if (command === 'read_text_file_content') return '1\n00:00:00,000 --> 00:00:01,000\nEnglish cue\n';
        if (command === 'get_font_render_scale') return { scale: 0.82, ascentRatio: 0.78, descentRatio: 0.22 };
        return undefined;
      });
      internal.state.subtitlePath = '/new.srt';
      await internal.loadSubtitleFile('/new.srt');
      expect((internal as any).lastExportedPath).toBeNull();
      expect(openFolderBtn.style.display).toBe('none');
      expect(playVideoBtn.style.display).toBe('none');

      // Editing English cue to Persian under Inter triggers font metric refresh for Vazirmatn fallback
      const list = new Control();
      (internal as any).subtitleListContainer = list;
      (internal as any).setupEventListeners();
      (internal.state as any).fontName = 'Inter';
      const textarea = new Control();
      textarea.dataset.cueId = '1';
      textarea.value = 'متن فارسی';
      textarea.closest = (sel: string) => (sel.includes('subtitle-cue-textarea') ? textarea : null);
      const inputEv = new Event('input', { bubbles: true });
      Object.defineProperty(inputEv, 'target', { value: textarea });
      list.dispatchEvent(inputEv);
      await flush();
      expect(invoke).toHaveBeenCalledWith('get_font_render_scale', { fontName: 'Vazirmatn', bold: true, italic: false });

      // prefillFilePaths('', subPath) does not notify selectVideo when video is already loaded
      const notifySpy = vi.fn();
      (window as any).showNotification = notifySpy;
      internal.state.videoPath = '/already.mp4';
      controller.prefillFilePaths('', '/another.srt');
      expect(notifySpy).not.toHaveBeenCalled();

      // clearSubtitleState clears pending cue click lock
      (internal as any).targetClickedCueId = 1;
      controller.clearSubtitleState();
      expect((internal as any).targetClickedCueId).toBeNull();
    });

    it('enforces MOV container compatibility with VP9/AV1/Opus across format, codec, and audio changes', () => {
      const { internal } = fixture();
      const formatSelect = new Control();
      const audioCodecSelect = new Control();
      const codecSelect = (internal as any).codecSelect as Control;
      (internal as any).formatSelect = formatSelect;
      (internal as any).audioCodecSelect = audioCodecSelect;
      (window as any).showNotification = vi.fn();

      // 1. webm (vp9 + opus) -> mov switches video to h264 and audio to aac
      (internal.state as any).outputFormat = 'mov';
      (internal.state as any).videoCodec = 'vp9';
      (internal.state as any).audioCodec = 'opus';
      (internal as any).enforceContainerCompatibility('format');
      expect((internal.state as any).videoCodec).toBe('h264');
      expect((internal.state as any).audioCodec).toBe('aac');

      // 2. webm + opus -> selecting prores switches container to mov AND audio to aac
      (internal.state as any).outputFormat = 'webm';
      (internal.state as any).videoCodec = 'prores';
      (internal.state as any).audioCodec = 'opus';
      (internal as any).enforceContainerCompatibility('codec');
      expect((internal.state as any).outputFormat).toBe('mov');
      expect((internal.state as any).audioCodec).toBe('aac');
      expect(formatSelect.value).toBe('mov');
      expect(audioCodecSelect.value).toBe('aac');

      // 3. mov -> selecting vp9 or av1 switches container to mp4
      (internal.state as any).outputFormat = 'mov';
      (internal.state as any).videoCodec = 'av1';
      (internal as any).enforceContainerCompatibility('codec');
      expect((internal.state as any).outputFormat).toBe('mp4');
      expect(codecSelect).toBeTruthy();

      // 4. mov -> selecting opus switches container to mp4
      (internal.state as any).outputFormat = 'mov';
      (internal.state as any).videoCodec = 'h264';
      (internal.state as any).audioCodec = 'opus';
      (internal as any).enforceContainerCompatibility('audio');
      expect((internal.state as any).outputFormat).toBe('mp4');
    });

    it('isolates overlapping startHardsub lifecycles via encodeSerial and handles structured cancellation errors', async () => {
      doc.readyState = 'complete';
      let statusHandler: ((ev: { payload: any }) => void) | null = null;
      (window as any).__TAURI__.event.listen = vi.fn(async (name: string, cb: (ev: { payload: any }) => void) => {
        if (name === 'hardsub-status') statusHandler = cb;
        return () => {};
      });
      const taskbarSpy = vi.fn();
      (window as any).updateTaskbarProgress = taskbarSpy;
      (window as any).showNotification = vi.fn();

      let rejectFirstTask!: (err: unknown) => void;
      let resolveSecondTask!: (val: { outputPath: string; durationMs: number; outputSizeMb: number }) => void;
      let taskCallCount = 0;

      invoke.mockImplementation((command: string) => {
        if (command === 'get_font_render_scale') return Promise.resolve({ scale: 1, ascentRatio: 0.8, descentRatio: 0.2 });
        if (command === 'probe_hardsub_source') {
          return Promise.resolve({ width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, durationSec: 10, videoStreamIndex: 0, audioStreamIndex: 1, startTimeSec: 0 });
        }
        if (command === 'write_text_file_content') return Promise.resolve(undefined);
        if (command === 'start_hardsub_task') {
          taskCallCount += 1;
          if (taskCallCount === 1) {
            return new Promise((_resolve, reject) => {
              rejectFirstTask = reject;
            });
          }
          return new Promise((resolve) => {
            resolveSecondTask = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      const { internal, startBtn } = fixture();
      const subInput = new Control();
      subInput.value = '/sub.srt';
      (internal as any).subtitlePathInput = subInput;
      internal.state.videoPath = '/v.mp4';
      internal.state.subtitlePath = '/sub.srt';
      internal.subtitleCues = [{ id: 1, startMs: 0, endMs: 1000, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,000', text: 'Hi' } as any];

      const firstRun = (internal as any).startHardsub();
      await flush();
      expect(taskCallCount).toBe(1);

      // Terminal cancelled event enables UI before first invoke settles; user immediately starts encode #2
      statusHandler!({ payload: { progress: 0, message: 'Cancelled', active: false, stage: 'cancelled' } });
      expect(startBtn.disabled).toBe(false);

      const secondRun = (internal as any).startHardsub();
      await flush();
      expect(taskCallCount).toBe(2);
      expect((internal as any).isEncoding).toBe(true);
      statusHandler!({ payload: { progress: 0.5, message: 'Encoding', active: true, stage: 'encoding' } });
      expect((window as any).isHardsubRunning).toBe(true);

      // First run rejects late; it must NOT clobber encode #2's active state or taskbar progress
      taskbarSpy.mockClear();
      rejectFirstTask(new Error('Hardsubbing cancelled by user.'));
      await firstRun;
      expect((internal as any).isEncoding).toBe(true);
      expect((window as any).isHardsubRunning).toBe(true);
      expect(taskbarSpy).not.toHaveBeenCalled();

      resolveSecondTask({ outputPath: '/out.mp4', durationMs: 50, outputSizeMb: 2 });
      await secondRun;
      expect((internal as any).isEncoding).toBe(false);
      expect((internal as any).lastExportedPath).toBe('/out.mp4');

      // Structured PreviewError cancellation from probe_hardsub_source is treated as cancellation, not generic failure
      (internal as any).sourceInfo = null;
      (internal as any).directSourceGeometry = null;
      const statusText = new Control();
      (internal as any).progressStatusText = statusText;
      invoke.mockImplementation(async (command: string) => {
        if (command === 'get_font_render_scale') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
        if (command === 'probe_hardsub_source') throw { code: 'cancelled', detail: 'Preview cancelled' };
        return undefined;
      });
      await (internal as any).startHardsub();
      expect((internal as any).lastStatusPayload?.stage).toBe('cancelled');
      expect((internal as any).lastFailedErrorText).toBeNull();
    });

    it('clamps style storage to slider bounds, syncs restored codecs on load, falls back missing system fonts, and supports radiogroup keyboard nav', async () => {
      const store = new Map<string, string>();
      const prevResizeObserver = (globalThis as any).ResizeObserver;
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      store.set('whisper_hardsub_style_settings', JSON.stringify({
        fontName: 'RemovedSystemFont',
        hasCustomFontSelection: true,
        fontSize: 110,
        outlineSize: 10,
      }));
      store.set('whisper_hardsub_export_settings', JSON.stringify({
        outputFormat: 'mp4',
        hwAccel: 'nvenc',
        videoCodec: 'h265',
      }));
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });

      try {
        invoke.mockImplementation(async (command: string) => {
          if (command === 'get_system_fonts') return [{ name: 'Inter', source: 'bundled' }, { name: 'Vazirmatn', source: 'bundled' }];
          if (command === 'get_font_render_scale') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
          if (command === 'check_hardware_encoders') {
            return { hasQsv: false, hasNvenc: true, hasVaapi: false, hasVideotoolbox: false, nvencCodecs: ['h264', 'h265'] };
          }
          return undefined;
        });
        doc.readyState = 'complete';
        const preCodecSelect = new Control();
        const preHwSelect = new Control();
        const preFontSelect = new Control();
        doc.elements.set('hardsub-codec', preCodecSelect);
        doc.elements.set('hardsub-hw', preHwSelect);
        doc.elements.set('hardsub-font', preFontSelect);

        const controller = new Controller();
        controllers.push(controller);
        const internal = controller as any;
        const presetsContainer = new Control();
        const presetBtns = ['draft', 'balanced', 'high', 'lossless'].map((preset) => {
          const btn = new Control();
          btn.dataset.preset = preset;
          btn.classList.add('quality-preset-btn');
          return btn;
        });
        internal.qualityPresetsContainer = presetsContainer;
        internal.qualityPresetBtns = presetBtns;
        internal.setupExportEventListeners();

        // 1. Style storage clamped to slider maxes (64, 8)
        expect(internal.state.fontSize).toBe(64);
        expect(internal.state.outlineSize).toBe(8);

        // 2. Restored hwAccel=nvenc + videoCodec=h265 synced codecSelect options immediately
        expect(preCodecSelect.value).toBe('h265');

        // 3. Uninstalled saved font falls back to smart default instead of leaving select blank
        await controller.loadFontsAndHardware();
        expect(internal.state.fontName).toBe('Inter');
        expect(preFontSelect.value).toBe('Inter');

        // 4. Radiogroup keyboard navigation updates preset, aria-checked, and tabIndex
        (internal as any).state.videoQualityPreset = 'balanced';
        (internal as any).updateQualityUI();
        expect(presetBtns[1].getAttribute('aria-checked')).toBe('true');
        expect((presetBtns[1] as any).tabIndex).toBe(0);
        expect((presetBtns[0] as any).tabIndex).toBe(-1);

        const rightEv = Object.assign(new Event('keydown', { cancelable: true }), {
          key: 'ArrowRight',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
        presetsContainer.dispatchEvent(rightEv);
        expect((internal as any).state.videoQualityPreset).toBe('high');
        expect(presetBtns[2].getAttribute('aria-checked')).toBe('true');
        expect((presetBtns[2] as any).tabIndex).toBe(0);
        expect((presetBtns[1] as any).tabIndex).toBe(-1);
        expect(presetBtns[2].focus).toHaveBeenCalled();

        const homeEv = Object.assign(new Event('keydown', { cancelable: true }), {
          key: 'Home',
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        });
        presetsContainer.dispatchEvent(homeEv);
        expect((internal as any).state.videoQualityPreset).toBe('draft');
      } finally {
        vi.stubGlobal('localStorage', undefined as any);
        vi.stubGlobal('ResizeObserver', prevResizeObserver);
      }
    });

    it('retries cancel_hardsub_task on active status during pre-start race, uses cue seek offset for prev/next cue buttons, and updates speed preset disabled state', async () => {
      doc.readyState = 'complete';
      let statusHandler: ((ev: { payload: any }) => void) | null = null;
      (window as any).__TAURI__.event.listen = vi.fn(async (name: string, cb: (ev: { payload: any }) => void) => {
        if (name === 'hardsub-status') statusHandler = cb;
        return () => {};
      });

      const { load, internal, video, prevCueBtn, nextCueBtn } = fixture();
      await load();

      // 1. Pre-start cancel race: isCancelling is true when backend emits active init/encoding
      (internal as any).isCancelling = true;
      (internal as any).cancelRetryPending = false;
      invoke.mockResolvedValue(undefined);
      statusHandler!({ payload: { progress: 0, message: 'Initializing', active: true, stage: 'init' } });
      await flush();
      expect(invoke).toHaveBeenCalledWith('cancel_hardsub_task', {});
      expect((internal as any).cancelRetryPending).toBe(false);

      // 2. prevCueBtn and nextCueBtn use getCueSeekTimeSec offset (+50ms clamped)
      (internal as any).isCancelling = false;
      internal.subtitleCues = [
        { id: 1, startMs: 1000, endMs: 2000, startTimeStr: '00:00:01,000', endTimeStr: '00:00:02,000', text: 'First' } as any,
        { id: 2, startMs: 5000, endMs: 5040, startTimeStr: '00:00:05,000', endTimeStr: '00:00:05,040', text: 'Second' } as any,
      ];
      video.currentTime = 2.0;
      video.settle();
      nextCueBtn.dispatchEvent(new Event('click'));
      expect(video.currentTime).toBeCloseTo(5.02, 3);
      video.settle();

      video.currentTime = 5.0;
      video.settle();
      prevCueBtn.dispatchEvent(new Event('click'));
      expect(video.currentTime).toBeCloseTo(1.05, 3);
      video.settle();

      // 3. Speed preset select is disabled when encoder ignores -preset (vaapi, videotoolbox, prores)
      const speedSelect = new Control();
      const speedWrapper = new Control();
      (speedSelect as any).parentElement = speedWrapper;
      (internal as any).speedPresetSelect = speedSelect;

      (internal.state as any).hwAccel = 'vaapi';
      (internal.state as any).videoCodec = 'h264';
      (internal as any).updateSpeedPresetUI();
      expect(speedSelect.disabled).toBe(true);
      expect(speedWrapper.style.pointerEvents).toBe('none');

      (internal.state as any).hwAccel = 'cpu';
      (internal.state as any).videoCodec = 'prores';
      (internal as any).updateSpeedPresetUI();
      expect(speedSelect.disabled).toBe(true);

      (internal.state as any).hwAccel = 'cpu';
      (internal.state as any).videoCodec = 'h264';
      (internal as any).updateSpeedPresetUI();
      expect(speedSelect.disabled).toBe(false);
      expect(speedWrapper.style.pointerEvents).toBe('auto');
    });

    it('preserves explicit hasCustomFontSelection=false, clears video outputPath/search filter, notifies on failed subtitle load, and scopes ASS [Events]', async () => {
      const store = new Map<string, string>();
      const prevResizeObserver = (globalThis as any).ResizeObserver;
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      store.set('whisper_hardsub_style_settings', JSON.stringify({
        fontName: 'Inter',
        hasCustomFontSelection: false,
        fontSize: 18,
      }));
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });

      try {
        doc.readyState = 'complete';
        const controller = new Controller();
        controllers.push(controller);
        const internal = controller as any;

        // 1. Explicit hasCustomFontSelection: false must not be flipped to true just because fontName is Inter
        expect(internal.hasCustomFontSelection).toBe(false);

        // 2. clearVideoState clears stale outputPath, sourceInfo, and previewError even if a subtitle remains loaded
        internal.state.videoPath = '/v.mp4';
        internal.state.subtitlePath = '/sub.srt';
        internal.state.outputPath = '/v_hardsub.mp4';
        internal.sourceInfo = { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, durationSec: 10, videoStreamIndex: 0, audioStreamIndex: 1, startTimeSec: 0 };
        internal.previewError = { code: 'probe_failed', detail: 'bad' };
        controller.clearVideoState();
        expect(internal.state.outputPath).toBe('');
        expect(internal.sourceInfo).toBeNull();
        expect(internal.previewError).toBeNull();

        // 3. Loading a new subtitle resets active search filter; failing to read notifies the user
        const searchInput = new Control();
        searchInput.value = 'old query';
        internal.searchInput = searchInput;
        internal.searchFilterQuery = 'old query';
        const notifySpy = vi.fn();
        (window as any).showNotification = notifySpy;

        invoke.mockImplementation(async (command: string) => {
          if (command === 'read_text_file_content') return '1\n00:00:00,000 --> 00:00:01,000\nFresh cue\n';
          if (command === 'get_font_render_scale') return { scale: 1, ascentRatio: 0.8, descentRatio: 0.2 };
          return undefined;
        });
        internal.state.subtitlePath = '/fresh.srt';
        await internal.loadSubtitleFile('/fresh.srt');
        expect(internal.searchFilterQuery).toBe('');
        expect(searchInput.value).toBe('');

        invoke.mockImplementation(async (command: string) => {
          if (command === 'read_text_file_content') throw new Error('Read failed');
          return undefined;
        });
        internal.state.subtitlePath = '/broken.srt';
        await internal.loadSubtitleFile('/broken.srt');
        expect(notifySpy).toHaveBeenCalledWith(expect.any(String), 'error');
        expect(internal.state.subtitlePath).toBe('');

        // 4. ASS parser stops reading Dialogue lines if another [Section] follows [Events]
        const assCues = parseSubtitleContentFn(
          '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Valid cue\n[Fonts]\nDialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Ignored\n',
          'ass',
        );
        expect(assCues).toHaveLength(1);
        expect(assCues[0].text).toBe('Valid cue');
      } finally {
        vi.stubGlobal('localStorage', undefined as any);
        vi.stubGlobal('ResizeObserver', prevResizeObserver);
      }
    });

    it('enforces container compatibility on hardware fallback and storage restore, adjusts muted volume from zero, sets global running flag pre-probe, and updates placeholder hint on preview error', async () => {
      const store = new Map<string, string>();
      const prevResizeObserver = (globalThis as any).ResizeObserver;
      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      });
      store.set('whisper_hardsub_export_settings', JSON.stringify({
        outputFormat: 'webm',
        videoCodec: 'h264',
        hwAccel: 'cpu',
      }));
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });

      try {
        doc.readyState = 'complete';
        const { controller, internal, video, container } = fixture();
        const formatSelect = new Control();
        (internal as any).formatSelect = formatSelect;

        // 1. Storage restore fixes incompatible webm + h264 -> mp4
        expect((internal.state as any).outputFormat).toBe('mp4');

        // 2. Hardware fallback from vaapi+av1 to nvenc (without av1) switches webm -> mp4
        (internal.state as any).outputFormat = 'webm';
        (internal.state as any).videoCodec = 'av1';
        (internal.state as any).hwAccel = 'vaapi';
        (internal as any).cachedHwStatus = {
          hasQsv: false,
          hasNvenc: true,
          hasVaapi: false,
          hasVideotoolbox: false,
          qsvCodecs: [],
          nvencCodecs: ['h264', 'h265'],
          vaapiCodecs: [],
          videotoolboxCodecs: [],
        };
        (internal as any).populateHardwareDropdown((internal as any).cachedHwStatus);
        expect((internal.state as any).hwAccel).toBe('nvenc');
        expect((internal.state as any).videoCodec).toBe('h264');
        expect((internal.state as any).outputFormat).toBe('mp4');

        // 3. Muted ArrowUp / wheel starts from 0 instead of stale video.volume
        (internal as any).pageActive = true;
        video.ready();
        internal.phase = 'ready';
        video.volume = 0.8;
        video.muted = true;
        doc.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), {
          key: 'ArrowUp',
          isComposing: false,
          ctrlKey: false,
          altKey: false,
          metaKey: false,
          shiftKey: false,
        }));
        expect(video.volume).toBeCloseTo(0.05, 5);
        expect(video.muted).toBe(false);

        video.volume = 0.7;
        video.muted = true;
        container.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), {
          deltaX: 0,
          deltaY: 10,
        }));
        expect(video.volume).toBe(0);
        expect(video.muted).toBe(true);

        // 4. Placeholder hint updates on preview error/cancelled and restores on idle
        const placeholder = new Control();
        const placeholderIdle = new Control();
        const hintEl = new Control();
        placeholderIdle.querySelector = (sel: string) => (sel === '.hardsub-placeholder-hint' ? hintEl : null);
        (internal as any).videoPlaceholder = placeholder;
        (internal as any).placeholderIdle = placeholderIdle;

        internal.phase = 'cancelled';
        (internal as any).renderPlayerPhase();
        expect(hintEl.textContent).not.toContain('Select a video file above');

        internal.phase = 'idle';
        (internal as any).renderPlayerPhase();
        expect(hintEl.textContent.length).toBeGreaterThan(0);

        // 5. startHardsub sets window.isHardsubRunning=true immediately during pre-probe and resets on failure
        let rejectProbe!: (err: unknown) => void;
        invoke.mockImplementation((command: string) => {
          if (command === 'get_font_render_scale') return Promise.resolve({ scale: 1, ascentRatio: 0.8, descentRatio: 0.2 });
          if (command === 'probe_hardsub_source') {
            return new Promise((_, reject) => {
              rejectProbe = reject;
            });
          }
          return Promise.resolve(undefined);
        });
        const subInput = new Control();
        subInput.value = '/sub.srt';
        (internal as any).subtitlePathInput = subInput;
        internal.state.videoPath = '/v.mp4';
        internal.state.subtitlePath = '/sub.srt';
        (internal as any).sourceInfo = null;
        (internal as any).directSourceGeometry = null;
        (window as any).showNotification = vi.fn();

        const run = (internal as any).startHardsub();
        await flush();
        expect((window as any).isHardsubRunning).toBe(true);

        rejectProbe(new Error('Probe failed'));
        await run;
        expect((window as any).isHardsubRunning).toBe(false);
        expect(controller).toBeTruthy();
      } finally {
        vi.stubGlobal('localStorage', undefined as any);
        vi.stubGlobal('ResizeObserver', prevResizeObserver);
      }
    });

    it('keeps startHardsub running when preview is retried or cancelled mid-setup, rolls back font on superseded subtitle loads, and omits empty system optgroup', async () => {
      const { internal, retry, cancel } = fixture();
      const subInput = new Control();
      subInput.value = '/clip.srt';
      (internal as any).subtitlePathInput = subInput;
      internal.state.videoPath = '/clip.mp4';
      internal.state.subtitlePath = '/clip.srt';
      (internal as any).subtitleCues = [
        { id: 1, startMs: 0, endMs: 1200, startTimeStr: '00:00:00,000', endTimeStr: '00:00:01,200', text: 'Hello' },
      ];
      (internal as any).sourceInfo = null;
      (internal as any).directSourceGeometry = null;
      internal.phase = 'error';

      const probeResolvers: Array<(val: unknown) => void> = [];
      const startedTasks: any[] = [];
      const writtenFiles: string[] = [];
      invoke.mockImplementation((command: string, args: any) => {
        if (command === 'get_font_render_scale') {
          return Promise.resolve({ scale: 1, ascentRatio: 0.8, descentRatio: 0.2 });
        }
        if (command === 'probe_hardsub_source') {
          return new Promise((resolve) => {
            probeResolvers.push(resolve);
          });
        }
        if (command === 'begin_hardsub_preview') {
          return Promise.resolve({
            requestId: args.requestId,
            candidateId: 'cand-retry',
            url: 'http://127.0.0.1:9/media/retry',
            stage: 'direct',
            source: null,
          });
        }
        if (command === 'release_hardsub_preview') {
          return Promise.resolve(undefined);
        }
        if (command === 'write_text_file_content') {
          writtenFiles.push(args.filePath);
          return Promise.resolve(undefined);
        }
        if (command === 'start_hardsub_task') {
          startedTasks.push(args.settings);
          return Promise.resolve({ outputPath: '/clip_hardsub.mp4', durationMs: 100, outputSizeMb: 1 });
        }
        return Promise.resolve(undefined);
      });

      const exportPromise = (internal as any).startHardsub();
      await flush();

      // Trigger preview retry while startHardsub is awaiting probe_hardsub_source (increments videoLoadGeneration & clears sourceInfo)
      retry.dispatchEvent(new Event('click'));
      await flush();
      // Then cancel preview while still awaiting
      cancel.dispatchEvent(new Event('click'));
      await flush();

      const resolvedSource = {
        width: 1280,
        height: 720,
        displayWidth: 1280,
        displayHeight: 720,
        durationSec: 10,
        videoStreamIndex: 0,
        audioStreamIndex: 1,
        startTimeSec: 0,
      };
      probeResolvers.forEach((resolve) => resolve(resolvedSource));
      await exportPromise;

      expect(writtenFiles).toContain('/clip.temp.ass');
      expect(startedTasks).toHaveLength(1);
      expect(startedTasks[0].subtitlePath).toBe('/clip.temp.ass');

      // Superseded performLoadSubtitleFile restores previous fontName when aborted during refreshFontRenderScale
      let resolveScale!: (val: unknown) => void;
      invoke.mockImplementation((command: string) => {
        if (command === 'read_text_file_content') {
          return Promise.resolve('1\n00:00:00,000 --> 00:00:01,000\nسلام دنیا\n');
        }
        if (command === 'get_font_render_scale') {
          return new Promise((resolve) => {
            resolveScale = resolve;
          });
        }
        return Promise.resolve(undefined);
      });

      (internal.state as any).fontName = 'Inter';
      internal.state.subtitlePath = '/fa.srt';
      const firstSubLoad = (internal as any).performLoadSubtitleFile('/fa.srt', false);
      await flush();
      // Supersede before refreshFontRenderScale resolves
      (internal as any).subtitleSerial++;
      resolveScale({ scale: 1, ascentRatio: 0.8, descentRatio: 0.2 });
      await firstSubLoad;
      expect((internal.state as any).fontName).toBe('Inter');

      // loadFontsAndHardware omits empty system optgroup when only bundled fonts are returned
      const fontSelectEl = new Control();
      const appendedGroups: any[] = [];
      fontSelectEl.appendChild = (child: any) => {
        appendedGroups.push(child);
        return child;
      };
      (internal as any).fontSelect = fontSelectEl;
      invoke.mockImplementation((command: string) => {
        if (command === 'get_system_fonts') {
          return Promise.resolve([{ name: 'Inter', source: 'bundled' }]);
        }
        if (command === 'get_font_render_scale') {
          return Promise.resolve({ scale: 1, ascentRatio: 0.8, descentRatio: 0.2 });
        }
        if (command === 'check_hardware_encoders') {
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      });
      await (internal as any).loadFontsAndHardware();
      expect(appendedGroups).toHaveLength(1);
      expect((internal as any).systemFontOptgroup).toBeNull();
    });
  });
});



