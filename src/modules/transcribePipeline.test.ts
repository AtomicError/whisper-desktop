import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  transcribePipeline,
  getSelectedMediaFile,
  setSelectedMediaFile,
  getProbedMetadata,
  setProbedMetadata,
  getWavPathForTranscription,
  setWavPathForTranscription,
  getIsTranscribing,
  setIsTranscribing,
  toggleWizardAccordion,
  openWizardStep,
  setWizardStepCompleted,
  clearSingleMediaFile,
  browseMediaFile,
  probeSelectedFile,
  handleDroppedFiles,
  renderMediaMetadata,
  toggleTelemetryHudCollapse,
  applySingleFileSelectedUI,
  runWhisperTranscription,
  abortTranscription,
  copyMainTranscriptToClipboard,
  openOutputFolder,
  getIsTranscriptionCancelActive,
  MEDIA_ICON_SVGS,
  setIsTranscriptionCancelActive
} from './transcribePipeline';
import { batchProcessor } from './batchProcessor';
import { transcriptViewer } from './transcriptViewer';
import { workflowBridge } from './workflowBridge';
import { getSettingsState, setSettingsState } from './settingsManager';
import { resetQuickDeckState } from './transcribeQuickDeck';

class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public value = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public disabled = false;
  public textContent = '';
  public title = '';
  public dataset: Record<string, string> = {};
  private _innerHTML = '';
  public onclick: ((e: any) => void) | null = null;
  public classList = {
    add: (cls: string) => { this.className = `${this.className} ${cls}`.trim(); },
    remove: (cls: string) => { this.className = this.className.replace(cls, '').trim(); },
    contains: (cls: string) => this.className.includes(cls),
    toggle: (cls: string, force?: boolean) => {
      const exists = this.className.includes(cls);
      const shouldHave = force !== undefined ? force : !exists;
      if (shouldHave) this.classList.add(cls);
      else this.classList.remove(cls);
      return shouldHave;
    }
  };
  private attributes: Map<string, string> = new Map();

  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase();
  }

  set innerHTML(html: string) {
    this._innerHTML = html;
    if (html === '') {
      this.children = [];
    }
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name === 'title') {
      this.title = '';
    }
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockElement | null {
    return this.children.find(c => c.tagName === selector.toUpperCase()) || null;
  }

  querySelectorAll(selector: string): MockElement[] {
    return [];
  }

  addEventListener(type: string, cb: (e: any) => void) {}
  removeEventListener(type: string, cb: (e: any) => void) {}
}

describe('transcribePipeline module', () => {
  let domMap: Map<string, MockElement>;

  beforeEach(() => {
    domMap = new Map();
    const mockBody = new MockElement('BODY');
    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      body: mockBody,
      getElementById: vi.fn((id: string) => domMap.get(id) || null),
      createElement: vi.fn((tag: string) => new MockElement(tag)),
      addEventListener: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('State Getters & Setters', () => {
    it('manages selectedMediaFile and syncs with global window', () => {
      setSelectedMediaFile('/media/video.mp4');
      expect(getSelectedMediaFile()).toBe('/media/video.mp4');
      expect((globalThis as any).window.selectedMediaFile).toBe('/media/video.mp4');

      (globalThis as any).window.selectedMediaFile = '/media/other.mkv';
      expect(getSelectedMediaFile()).toBe('/media/other.mkv');

      setSelectedMediaFile(null);
      expect(getSelectedMediaFile()).toBe(null);
    });

    it('manages probedMetadata and syncs with global window', () => {
      const meta = { exists: true, durationSec: 120, format: 'Video (mp4)' };
      setProbedMetadata(meta);
      expect(getProbedMetadata()).toEqual(meta);
      expect((globalThis as any).window.probedMetadata).toEqual(meta);

      (globalThis as any).window.probedMetadata = null;
      expect(getProbedMetadata()).toBe(null);
    });

    it('manages wavPathForTranscription and syncs with global window', () => {
      setWavPathForTranscription('/tmp/audio.wav');
      expect(getWavPathForTranscription()).toBe('/tmp/audio.wav');
      expect((globalThis as any).window.wavPathForTranscription).toBe('/tmp/audio.wav');

      (globalThis as any).window.wavPathForTranscription = '/tmp/other.wav';
      expect(getWavPathForTranscription()).toBe('/tmp/other.wav');
    });

    it('manages isTranscribing flag and syncs with global window', () => {
      setIsTranscribing(true);
      expect(getIsTranscribing()).toBe(true);
      expect((globalThis as any).window.isTranscribing).toBe(true);

      (globalThis as any).window.isTranscribing = false;
      expect(getIsTranscribing()).toBe(false);

      setIsTranscribing(false);
      expect(getIsTranscribing()).toBe(false);
      expect((globalThis as any).window.isTranscribing).toBe(false);
    });

    it('normalizes invalid or non-string paths and metadata defensively', () => {
      setSelectedMediaFile(12345 as any);
      expect(getSelectedMediaFile()).toBe(null);

      setSelectedMediaFile('');
      expect(getSelectedMediaFile()).toBe(null);

      setSelectedMediaFile('   ');
      expect(getSelectedMediaFile()).toBe(null);

      setSelectedMediaFile('  /media/trimmed.mp4  ');
      expect(getSelectedMediaFile()).toBe('/media/trimmed.mp4');

      setWavPathForTranscription({ bad: true } as any);
      expect(getWavPathForTranscription()).toBe(null);

      setWavPathForTranscription('');
      expect(getWavPathForTranscription()).toBe(null);

      setWavPathForTranscription('  /tmp/trimmed.wav  ');
      expect(getWavPathForTranscription()).toBe('/tmp/trimmed.wav');

      setProbedMetadata('not-an-object' as any);
      expect(getProbedMetadata()).toBe(null);

      setProbedMetadata(['array-not-allowed'] as any);
      expect(getProbedMetadata()).toBe(null);

      setIsTranscribing('truthy-string' as any);
      expect(getIsTranscribing()).toBe(true);

      setIsTranscribing(null as any);
      expect(getIsTranscribing()).toBe(false);
    });

    it('prevents maximum call stack recursion when window properties delegate to getters/setters', () => {
      // Simulate main.ts Object.defineProperties proxying
      Object.defineProperties(globalThis, {
        selectedMediaFile: {
          get() { return getSelectedMediaFile(); },
          set(val: string | null) { setSelectedMediaFile(val); },
          configurable: true
        },
        probedMetadata: {
          get() { return getProbedMetadata(); },
          set(val: any) { setProbedMetadata(val); },
          configurable: true
        },
        wavPathForTranscription: {
          get() { return getWavPathForTranscription(); },
          set(val: string | null) { setWavPathForTranscription(val); },
          configurable: true
        },
        isTranscribing: {
          get() { return getIsTranscribing(); },
          set(val: boolean) { setIsTranscribing(val); },
          configurable: true
        }
      });

      // Calling getters must not trigger RangeError: Maximum call stack size exceeded
      expect(() => getProbedMetadata()).not.toThrow();
      expect(() => getSelectedMediaFile()).not.toThrow();
      expect(() => getWavPathForTranscription()).not.toThrow();
      expect(() => getIsTranscribing()).not.toThrow();

      // Setting via function or window must synchronize without recursion
      setProbedMetadata({ exists: true, durationSec: 42 });
      expect(getProbedMetadata()).toEqual({ exists: true, durationSec: 42 });
      expect((globalThis as any).window.probedMetadata).toEqual({ exists: true, durationSec: 42 });

      (globalThis as any).window.selectedMediaFile = '/path/proxy_test.mp4';
      expect(getSelectedMediaFile()).toBe('/path/proxy_test.mp4');
      expect((globalThis as any).window.selectedMediaFile).toBe('/path/proxy_test.mp4');
    });
  });

  describe('Accordion Wizard Navigation', () => {
    it('toggles accordion step active state and updates chevron', () => {
      const step1 = new MockElement('DIV');
      step1.id = 'wizard-step-1';
      const chev1 = new MockElement('SPAN');
      chev1.id = 'wizard-chevron-1';

      const step2 = new MockElement('DIV');
      step2.id = 'wizard-step-2';
      const chev2 = new MockElement('SPAN');
      chev2.id = 'wizard-chevron-2';

      domMap.set(step1.id, step1);
      domMap.set(chev1.id, chev1);
      domMap.set(step2.id, step2);
      domMap.set(chev2.id, chev2);

      toggleWizardAccordion(1);
      expect(step1.classList.contains('active')).toBe(true);
      expect(chev1.textContent).toBe('▲');

      toggleWizardAccordion(1);
      expect(step1.classList.contains('active')).toBe(false);
      expect(chev1.textContent).toBe('▼');
    });

    it('opens target wizard step directly', () => {
      const step2 = new MockElement('DIV');
      step2.id = 'wizard-step-2';
      const chev2 = new MockElement('SPAN');
      chev2.id = 'wizard-chevron-2';

      domMap.set(step2.id, step2);
      domMap.set(chev2.id, chev2);

      openWizardStep(2);
      expect(step2.classList.contains('active')).toBe(true);
      expect(chev2.textContent).toBe('▲');
    });

    it('sets wizard step completion icon state', () => {
      const step1 = new MockElement('DIV');
      step1.id = 'wizard-step-1';
      const icon1 = new MockElement('SPAN');
      icon1.id = 'wizard-icon-1';

      domMap.set(step1.id, step1);
      domMap.set(icon1.id, icon1);

      setWizardStepCompleted(1, true);
      expect(step1.classList.contains('completed')).toBe(true);
      expect(icon1.innerHTML).toContain('<svg');

      setWizardStepCompleted(1, false);
      expect(step1.classList.contains('completed')).toBe(false);
      expect(icon1.textContent).toBe('1');
    });
  });

  describe('Single Media Clear & Reset', () => {
    it('resets media state, dropzone classes, and metadata display', () => {
      setSelectedMediaFile('/media/sample.mp4');
      setWavPathForTranscription('/tmp/sample.wav');
      setProbedMetadata({ exists: true });

      const dropZone = new MockElement('DIV');
      dropZone.id = 'transcribe-drop-zone';
      dropZone.classList.add('has-file');
      domMap.set(dropZone.id, dropZone);

      const filePathEl = new MockElement('SPAN');
      filePathEl.id = 'lbl-file-path';
      domMap.set(filePathEl.id, filePathEl);

      const metaType = new MockElement('SPAN');
      metaType.id = 'meta-type';
      metaType.textContent = 'Video';
      domMap.set(metaType.id, metaType);

      clearSingleMediaFile();

      expect(getSelectedMediaFile()).toBe(null);
      expect(getWavPathForTranscription()).toBe(null);
      expect(getProbedMetadata()).toBe(null);
      expect(dropZone.classList.contains('has-file')).toBe(false);
      expect(metaType.textContent).toBe('-');
    });

    it('resets meta-type-text, transcribe-media-icon, and meta-duration-text when clearing media', () => {
      const mediaIcon = new MockElement('SVG');
      mediaIcon.id = 'transcribe-media-icon';
      mediaIcon.innerHTML = '<path d="audio-icon"/>';
      const typeText = new MockElement('SPAN');
      typeText.id = 'meta-type-text';
      typeText.textContent = 'Audio';
      const durEl = new MockElement('SPAN');
      durEl.id = 'meta-duration';
      durEl.title = 'Timecode: 00:01:00';
      const durText = new MockElement('SPAN');
      durText.id = 'meta-duration-text';
      durText.textContent = '1 min';

      domMap.set(mediaIcon.id, mediaIcon);
      domMap.set(typeText.id, typeText);
      domMap.set(durEl.id, durEl);
      domMap.set(durText.id, durText);

      clearSingleMediaFile();

      expect(typeText.textContent).toBe('-');
      expect(mediaIcon.innerHTML).toBe(MEDIA_ICON_SVGS.video);
      expect(durText.textContent).toBe('-');
      expect(durEl.title).toBe('');
    });

    it('blocks clearing when transcription is actively running', () => {
      setSelectedMediaFile('/media/active.mp4');
      setIsTranscribing(true);

      clearSingleMediaFile();
      expect(getSelectedMediaFile()).toBe('/media/active.mp4');

      setIsTranscribing(false);
    });

    it('blocks clearing when batch extraction is actively running', () => {
      setSelectedMediaFile('/media/active.mp4');
      batchProcessor.setIsExtracting(true);

      clearSingleMediaFile();
      expect(getSelectedMediaFile()).toBe('/media/active.mp4');

      batchProcessor.setIsExtracting(false);
    });

    it('flushes pending transcript edits when user clears single media file', () => {
      setSelectedMediaFile('/media/to_clear.mp4');
      const dropZone = new MockElement('DIV');
      dropZone.id = 'transcribe-drop-zone';
      domMap.set(dropZone.id, dropZone);

      let flushCalled = false;
      const origFlush = transcriptViewer.flushEdits;
      (transcriptViewer as any).flushEdits = () => {
        flushCalled = true;
        return Promise.resolve();
      };

      try {
        clearSingleMediaFile();
        expect(getSelectedMediaFile()).toBe(null);
        expect(flushCalled).toBe(true);
      } finally {
        (transcriptViewer as any).flushEdits = origFlush;
      }
    });

    it('defensively sanitizes and trims paths from browseMediaFile', async () => {
      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'select_files') {
          return Promise.resolve(['  /media/selected_spaced.mp4  ', '', '   ', 123 as any]);
        }
        if (cmd === 'probe_media_file') {
          return Promise.resolve({ exists: true, format: 'mp4', size: '10 MB', durationSec: 30 });
        }
        return Promise.resolve(null);
      });

      await browseMediaFile();
      expect(getSelectedMediaFile()).toBe('/media/selected_spaced.mp4');
    });

    it('defensively sanitizes and trims dropped files in handleDroppedFiles', async () => {
      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'probe_media_file') {
          return Promise.resolve({ exists: true, format: 'mp4', size: '10 MB', durationSec: 30 });
        }
        return Promise.resolve(null);
      });

      await handleDroppedFiles(['  /media/dropped_spaced.mp4  ', '', '   ', 999 as any]);
      expect(getSelectedMediaFile()).toBe('/media/dropped_spaced.mp4');
    });
  });

  describe('Media Metadata Rendering', () => {
    it('renders format and duration cleanly without emoji', () => {
      const typeEl = new MockElement('SPAN');
      typeEl.id = 'meta-type';
      const durEl = new MockElement('SPAN');
      durEl.id = 'meta-duration';

      domMap.set(typeEl.id, typeEl);
      domMap.set(durEl.id, durEl);

      const meta = {
        exists: true,
        format: 'QuickTime / MOV / MP4 Video',
        size: '142.5 MB',
        durationSec: 125
      };

      renderMediaMetadata(meta);

      expect(typeEl.textContent).toBe('Video');
      expect(durEl.textContent.length).toBeGreaterThan(0);
      expect(durEl.title).toContain('00:02:05');
    });

    it('renders format text and SVG Lucide icons into sub-elements when present', () => {
      const mediaIcon = new MockElement('SVG');
      mediaIcon.id = 'transcribe-media-icon';
      const typeEl = new MockElement('SPAN');
      typeEl.id = 'meta-type';
      const typeText = new MockElement('SPAN');
      typeText.id = 'meta-type-text';
      const durEl = new MockElement('SPAN');
      durEl.id = 'meta-duration';
      const durText = new MockElement('SPAN');
      durText.id = 'meta-duration-text';

      domMap.set(mediaIcon.id, mediaIcon);
      domMap.set(typeEl.id, typeEl);
      domMap.set(typeText.id, typeText);
      domMap.set(durEl.id, durEl);
      domMap.set(durText.id, durText);

      // Video test
      renderMediaMetadata({
        exists: true,
        format: 'Video',
        path: '/media/sample.mp4',
        durationSec: 3665
      });
      expect(typeText.textContent).toBe('Video');
      expect(mediaIcon.innerHTML).toBe(MEDIA_ICON_SVGS.video);
      expect(durText.textContent.length).toBeGreaterThan(0);
      expect(durEl.title).toContain('01:01:05');

      // Audio test
      renderMediaMetadata({
        exists: true,
        format: 'Audio',
        path: '/media/sample.mp3',
        durationSec: 45
      });
      expect(typeText.textContent).toBe('Audio');
      expect(mediaIcon.innerHTML).toBe(MEDIA_ICON_SVGS.audio);
      expect(durText.textContent.length).toBeGreaterThan(0);
      expect(durEl.title).toContain('00:00:45');

      // Generic file test
      renderMediaMetadata({
        exists: true,
        format: 'File',
        durationSec: 0
      });
      expect(typeText.textContent).toBe('File');
      expect(mediaIcon.innerHTML).toBe(MEDIA_ICON_SVGS.file);
      expect(durText.textContent).toBe('-');
    });
  });

  describe('Telemetry HUD Collapse', () => {
    it('toggles collapsed class on telemetry card and button', () => {
      const card = new MockElement('DIV');
      card.id = 'telemetry-hud-card';
      const btn = new MockElement('BUTTON');
      btn.id = 'hud-collapse-btn';

      domMap.set(card.id, card);
      domMap.set(btn.id, btn);

      toggleTelemetryHudCollapse();
      expect(card.classList.contains('collapsed')).toBe(true);
      expect(btn.classList.contains('collapsed')).toBe(true);

      toggleTelemetryHudCollapse();
      expect(card.classList.contains('collapsed')).toBe(false);
      expect(btn.classList.contains('collapsed')).toBe(false);
    });
  });

  describe('applySingleFileSelectedUI helper', () => {
    it('configures dropzone and single-transcribe action elements', () => {
      const dropZone = new MockElement('DIV');
      dropZone.id = 'transcribe-drop-zone';
      const fileNameEl = new MockElement('SPAN');
      fileNameEl.id = 'lbl-file-name';
      const filePathEl = new MockElement('SPAN');
      filePathEl.id = 'lbl-file-path';
      const clearBtn = new MockElement('BUTTON');
      clearBtn.id = 'btn-clear-media';
      const metaBox = new MockElement('DIV');
      metaBox.id = 'media-meta-box';
      const batchBox = new MockElement('DIV');
      batchBox.id = 'batch-queue-container';

      domMap.set(dropZone.id, dropZone);
      domMap.set(fileNameEl.id, fileNameEl);
      domMap.set(filePathEl.id, filePathEl);
      domMap.set(clearBtn.id, clearBtn);
      domMap.set(metaBox.id, metaBox);
      domMap.set(batchBox.id, batchBox);

      applySingleFileSelectedUI('/media/test_ui.mp4');

      expect(dropZone.classList.contains('has-file')).toBe(true);
      expect(filePathEl.textContent).toBe('/media/test_ui.mp4');
      expect(clearBtn.style.display).toBe('inline-flex');
      expect(metaBox.style.display).toBe('flex');
      expect(batchBox.style.display).toBe('none');
    });
  });

  describe('runWhisperTranscription execution & guards', () => {
    it('blocks invocation when already transcribing or extracting', async () => {
      setIsTranscribing(true);
      const invokeMock = vi.fn();
      (globalThis as any).window.invoke = invokeMock;

      await runWhisperTranscription();
      expect(invokeMock).not.toHaveBeenCalled();

      setIsTranscribing(false);
      batchProcessor.setIsExtracting(true);

      await runWhisperTranscription();
      expect(invokeMock).not.toHaveBeenCalled();

      batchProcessor.setIsExtracting(false);
    });

    it('accepts Standard backend even if compiledBackends does not contain it', async () => {
      setSelectedMediaFile('/media/standard_backend_test.mp4');
      (globalThis as any).window.settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/models/ggml-base.bin'
      };
      (globalThis as any).window.compiledBackends = {};
      (globalThis as any).window.localScannedTransModels = ['/models/ggml-base.bin'];

      const invokeMock = vi.fn().mockResolvedValue('ok');
      (globalThis as any).window.invoke = invokeMock;

      const runBtn = new MockElement('BUTTON');
      runBtn.id = 'btn-run-transcribe';
      domMap.set(runBtn.id, runBtn);

      await runWhisperTranscription();

      expect(invokeMock).toHaveBeenCalled();
      setIsTranscribing(false);
    });

    it('accepts non-Standard backend when found in window.compiledBackends fallback', async () => {
      setSelectedMediaFile('/media/custom_backend_test.mp4');
      (globalThis as any).window.settingsState = {
        selectedBackend: 'Vulkan',
        modelPath: '/models/ggml-base.bin'
      };
      (globalThis as any).window.compiledBackends = { Vulkan: true };
      (globalThis as any).window.localScannedTransModels = ['/models/ggml-base.bin'];

      const invokeMock = vi.fn().mockResolvedValue('ok');
      (globalThis as any).window.invoke = invokeMock;

      const runBtn = new MockElement('BUTTON');
      runBtn.id = 'btn-run-transcribe';
      domMap.set(runBtn.id, runBtn);

      await runWhisperTranscription();

      expect(invokeMock).toHaveBeenCalled();
      setIsTranscribing(false);
    });
  });

  describe('abortTranscription execution & guards', () => {
    it('ignores execution when no transcription is active', async () => {
      setIsTranscribing(false);
      const invokeMock = vi.fn();
      (globalThis as any).window.invoke = invokeMock;

      await abortTranscription();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('blocks duplicate cancellation when cancel is already active', async () => {
      setIsTranscribing(true);
      let resolveInvoke: (val: any) => void;
      const invokePromise = new Promise((res) => { resolveInvoke = res; });
      const invokeMock = vi.fn().mockReturnValue(invokePromise);
      (globalThis as any).window.invoke = invokeMock;

      const p1 = abortTranscription();
      const p2 = abortTranscription();

      expect(invokeMock).toHaveBeenCalledTimes(1);

      resolveInvoke!(null);
      await Promise.all([p1, p2]);
      setIsTranscribing(false);
    });

    it('updates cancel button i18n attribute and restores state on failure', async () => {
      setIsTranscribing(true);
      const invokeMock = vi.fn().mockRejectedValueOnce(new Error('Tauri cancel failure'));
      (globalThis as any).window.invoke = invokeMock;

      const cancelSpan = new MockElement('SPAN');
      const cancelBtn = new MockElement('BUTTON');
      cancelBtn.id = 'btn-cancel-transcribe';
      cancelBtn.appendChild(cancelSpan);
      domMap.set(cancelBtn.id, cancelBtn);

      await abortTranscription();

      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(cancelBtn.disabled).toBe(false);
      expect(cancelSpan.getAttribute('data-i18n')).toBe('transcribe.cancelTranscription');

      setIsTranscribing(false);
    });

    it('abortTranscription preserves cancel lock when backend reports no active session', async () => {
      setIsTranscribing(true);
      const invokeMock = vi.fn().mockRejectedValueOnce(new Error('No active transcription or translation session'));
      (globalThis as any).window.invoke = invokeMock;

      const cancelBtn = new MockElement('BUTTON');
      cancelBtn.id = 'btn-cancel-transcribe';
      domMap.set(cancelBtn.id, cancelBtn);

      await abortTranscription();

      expect(invokeMock).toHaveBeenCalledTimes(1);
      // Cancel state is preserved
      expect(getIsTranscriptionCancelActive()).toBe(true);

      // Subsequent abort is blocked
      await abortTranscription();
      expect(invokeMock).toHaveBeenCalledTimes(1);

      setIsTranscribing(false);
    });

    it('runWhisperTranscription aborts before whisper execution if cancelled during audio conversion', async () => {
      setSelectedMediaFile('/media/cancel_during_conversion.mp4');
      (globalThis as any).window.settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/models/ggml-base.bin'
      };
      (globalThis as any).window.localScannedTransModels = ['/models/ggml-base.bin'];

      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'convert_media_file') {
          setIsTranscriptionCancelActive(true);
          return Promise.resolve('/media/cancel_during_conversion.wav');
        }
        return Promise.resolve('ok');
      });
      (globalThis as any).window.invoke = invokeMock;

      const runBtn = new MockElement('BUTTON');
      runBtn.id = 'btn-run-transcribe';
      domMap.set(runBtn.id, runBtn);

      const fillBar = new MockElement('DIV');
      fillBar.id = 'progress-linear-fill';
      domMap.set(fillBar.id, fillBar);

      const msgEl = new MockElement('SPAN');
      msgEl.id = 'lbl-radial-msg';
      domMap.set(msgEl.id, msgEl);

      await runWhisperTranscription();

      expect(invokeMock).toHaveBeenCalledWith('convert_media_file', expect.anything());
      expect(invokeMock).not.toHaveBeenCalledWith('start_transcription_task', expect.anything());
      expect(getIsTranscribing()).toBe(false);
      expect(fillBar.style.width).toBe('0%');
      expect(msgEl.getAttribute('data-i18n')).toBe('transcribe.standingBy');
    });

    it('abortTranscription displays cancellingTask toast immediately on successful backend cancel invocation', async () => {
      setIsTranscribing(true);
      const invokeMock = vi.fn().mockResolvedValue('ok');
      (globalThis as any).window.invoke = invokeMock;

      const cancelBtn = new MockElement('BUTTON');
      cancelBtn.id = 'btn-cancel-transcribe';
      domMap.set(cancelBtn.id, cancelBtn);

      try {
        await abortTranscription();

        expect(invokeMock).toHaveBeenCalledWith('cancel_transcription', undefined);
        const container = (document.body as any).children.find((c: any) => c.id === 'toast-container');
        expect(container).toBeDefined();
        const toast = container?.children[0];
        expect(toast?.className).toContain('toast-info');
      } finally {
        setIsTranscribing(false);
      }
    });

    it('runWhisperTranscription treats termination error as cancellation when isTranscriptionCancelActive is true', async () => {
      setIsTranscribing(false);
      setSelectedMediaFile('/media/cancel_with_signal.mp4');
      (globalThis as any).window.settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/models/ggml-base.bin'
      };
      (globalThis as any).window.localScannedTransModels = ['/models/ggml-base.bin'];

      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'convert_media_file') {
          return Promise.resolve('/media/cancel_with_signal.wav');
        }
        if (cmd === 'start_transcription_task') {
          setIsTranscriptionCancelActive(true);
          // Backend terminated by SIGKILL or abnormal exit code without the word 'cancelled'
          return Promise.reject(new Error('Process terminated by signal 15 (SIGTERM)'));
        }
        return Promise.resolve('ok');
      });
      (globalThis as any).window.invoke = invokeMock;

      const runBtn = new MockElement('BUTTON');
      runBtn.id = 'btn-run-transcribe';
      domMap.set(runBtn.id, runBtn);

      const fillBar = new MockElement('DIV');
      fillBar.id = 'progress-linear-fill';
      domMap.set(fillBar.id, fillBar);

      const msgEl = new MockElement('SPAN');
      msgEl.id = 'lbl-radial-msg';
      domMap.set(msgEl.id, msgEl);

      await runWhisperTranscription();

      expect(getIsTranscribing()).toBe(false);
      expect(fillBar.style.width).toBe('0%');
      expect(msgEl.getAttribute('data-i18n')).toBe('transcribe.standingBy');
      const container = (document.body as any).children.find((c: any) => c.id === 'toast-container');
      expect(container).toBeDefined();
      const lastToast = container?.children[container.children.length - 1];
      expect(lastToast?.className).toContain('toast-info');
    });
  });

  describe('copyMainTranscriptToClipboard', () => {
    it('prefers live transcript lines in memory and never copies raw Whisper logs on failure', async () => {
      let copiedText = '';
      (globalThis as any).window.invoke = vi.fn(async (cmd: string, args: any) => {
        if (cmd === 'copy_to_clipboard') {
          copiedText = args?.text ?? '';
          return;
        }
        if (cmd === 'read_text_file_content' && args?.filePath === '/custom/out/lecture.srt') {
          return '1\n00:00:00,000 --> 00:00:02,000\nParsed from custom SRT\n';
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      // 1. Live lines available in memory
      transcriptViewer.lines = [
        { id: 0, timeRange: '[00:00:00.000 --> 00:00:02.000]', text: 'First edited line' },
        { id: 1, timeRange: '[00:00:02.000 --> 00:00:04.000]', text: 'Second edited line' }
      ];

      await copyMainTranscriptToClipboard();
      expect(copiedText).toBe('First edited line\nSecond edited line');

      // 2. Empty live lines -> reads from custom output directory SRT file without falling back to Whisper logs
      transcriptViewer.clear();
      copiedText = '';
      setSelectedMediaFile('/media/lecture.mp4');
      workflowBridge.setLastTranscribedOutputDir('/custom/out');
      workflowBridge.setLastTranscribedSubtitlePath('/custom/out/lecture.srt');
      workflowBridge.setLastTranscribedOutputFiles([
        { name: 'lecture.srt', path: '/custom/out/lecture.srt', type: 'subtitle' }
      ]);

      await copyMainTranscriptToClipboard();
      expect(copiedText).toBe('Parsed from custom SRT');
    });

    it('clears previous output directory, subtitle files and resets transcript viewport and telemetry HUD when a new media file is selected via browseMediaFile', async () => {
      workflowBridge.setLastTranscribedOutputDir('/old/output');
      workflowBridge.setLastTranscribedSubtitlePath('/old/output/old.srt');
      workflowBridge.setLastTranscribedOutputFiles([{ name: 'old.srt', path: '/old/output/old.srt', type: 'subtitle' }]);

      const telemetryCard = new MockElement('DIV');
      telemetryCard.id = 'telemetry-hud-card';
      telemetryCard.style.display = 'block';
      domMap.set(telemetryCard.id, telemetryCard);

      transcriptViewer.lines = [
        { id: 0, timeRange: '[00:00:00.000 --> 00:00:02.000]', text: 'Old line' }
      ];

      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'select_files') return Promise.resolve(['/new/video.mp4']);
        if (cmd === 'probe_media_file') return Promise.resolve({ exists: true, durationSec: 30, format: 'Video' });
        return Promise.resolve(null);
      });

      await browseMediaFile();

      expect(workflowBridge.getLastTranscribedOutputDir()).toBeNull();
      expect(workflowBridge.getLastTranscribedSubtitlePath()).toBeNull();
      expect(workflowBridge.getLastTranscribedOutputFiles()).toEqual([]);
      expect(transcriptViewer.getLines().length).toBe(0);
      expect(telemetryCard.style.display).toBe('none');
    });

    it('openOutputFolder invokes show_in_folder with subtitle path or fallback directory', async () => {
      const mockInvoke = vi.fn().mockResolvedValue(null);
      (globalThis as any).window.invoke = mockInvoke;

      // 1. Target subtitle file takes precedence
      workflowBridge.setLastTranscribedSubtitlePath('/media/subs/lecture.srt');
      workflowBridge.setLastTranscribedOutputDir('/media/subs');

      await openOutputFolder();
      expect(mockInvoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/media/subs/lecture.srt' });

      // 2. Fallback to output directory when subtitle path is absent
      mockInvoke.mockReset();
      workflowBridge.setLastTranscribedSubtitlePath(null);
      workflowBridge.setLastTranscribedOutputDir('/custom/output_folder');

      await openOutputFolder();
      expect(mockInvoke).toHaveBeenCalledWith('show_in_folder', { filePath: '/custom/output_folder' });
    });

    it('browseMediaFile unloads companion player and resets previous session when a new file is selected', async () => {
      let unloaded = false;
      (globalThis as any).window.unloadCompanionPlayer = () => { unloaded = true; };

      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'select_files') return Promise.resolve(['/new/video2.mp4']);
        if (cmd === 'probe_media_file') return Promise.resolve({ exists: true, durationSec: 30, format: 'Video' });
        return Promise.resolve(null);
      });

      await browseMediaFile();
      expect(unloaded).toBe(true);
    });

    it('handleDroppedFiles unloads companion player when files are dropped', async () => {
      let unloadedCount = 0;
      (globalThis as any).window.unloadCompanionPlayer = () => { unloadedCount++; };
      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'probe_media_file') return Promise.resolve({ exists: true, durationSec: 45, format: 'Video' });
        return Promise.resolve(null);
      });

      // Single file drop
      await handleDroppedFiles(['/dropped/single.mp4']);
      expect(unloadedCount).toBe(1);

      // Multi file drop
      await handleDroppedFiles(['/dropped/multi1.mp4', '/dropped/multi2.mp4']);
      expect(unloadedCount).toBe(2);
    });

    it('preserves Settings Time Range on first file load from empty state, and resets it when replacing prior media', async () => {
      resetQuickDeckState();
      setSelectedMediaFile(null);
      batchProcessor.setIsBatchMode(false);
      batchProcessor.setItems([]);
      setSettingsState({ offsetT: 15_000, duration: 30_000 });

      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'select_files') return Promise.resolve(['/first/video.mp4']);
        if (cmd === 'probe_media_file') return Promise.resolve({ exists: true, durationSec: 120, format: 'Video' });
        return Promise.resolve(null);
      });

      // Act 1: First file load from empty state preserves pre-configured Settings offset/duration
      await browseMediaFile();
      expect(getSelectedMediaFile()).toBe('/first/video.mp4');
      expect(getSettingsState()?.offsetT).toBe(15_000);
      expect(getSettingsState()?.duration).toBe(30_000);

      // Act 2: Replacing an already-loaded file resets Time Range to Full File
      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'select_files') return Promise.resolve(['/second/video.mp4']);
        if (cmd === 'probe_media_file') return Promise.resolve({ exists: true, durationSec: 120, format: 'Video' });
        return Promise.resolve(null);
      });
      await browseMediaFile();
      expect(getSelectedMediaFile()).toBe('/second/video.mp4');
      expect(getSettingsState()?.offsetT).toBe(0);
      expect(getSettingsState()?.duration).toBe(0);
    });

    it('ignores stale probeSelectedFile results when a newer media file was selected before probing resolved', async () => {
      let resolveFirstProbe!: (val: any) => void;
      const firstProbePromise = new Promise(resolve => {
        resolveFirstProbe = resolve;
      });

      setSelectedMediaFile('/first/slow.mp4');
      setProbedMetadata(null);

      (globalThis as any).window.invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file' && args?.filePath === '/first/slow.mp4') {
          return firstProbePromise;
        }
        if (cmd === 'probe_media_file' && args?.filePath === '/second/fast.mp4') {
          return Promise.resolve({ exists: true, durationSec: 45, format: 'Video' });
        }
        return Promise.resolve(null);
      });

      const slowProbeTask = probeSelectedFile();
      setSelectedMediaFile('/second/fast.mp4');
      await probeSelectedFile();
      expect(getProbedMetadata()?.durationSec).toBe(45);

      // Now resolve the stale earlier probe; it must NOT overwrite the newer file's metadata
      resolveFirstProbe({ exists: true, durationSec: 300, format: 'Video' });
      await slowProbeTask;
      expect(getProbedMetadata()?.durationSec).toBe(45);
    });

    it('snapshots settings before WAV conversion and seeks companion player to sliced offset on completion', async () => {
      resetQuickDeckState();
      setSelectedMediaFile('/media/sliced.mp4');
      setWavPathForTranscription(null);
      setProbedMetadata({ exists: true, durationSec: 300, format: 'Video' });
      (globalThis as any).window.localScannedTransModels = ['ggml-base.bin'];
      setSettingsState({
        selectedBackend: 'Standard',
        modelPath: 'ggml-base.bin',
        inputFile: '/media/sliced.mp4',
        outputSrt: true,
        outputDirMode: 'input_dir',
        offsetT: 120_000,
        duration: 30_000
      });

      let resolveConvert!: (wav: string) => void;
      const convertPromise = new Promise<string>(resolve => {
        resolveConvert = resolve;
      });
      let capturedTaskSettings: any = null;
      const seekMock = vi.fn();
      const highlightMock = vi.fn();
      const prevSeek = (globalThis as any).window.seekCompanionPlayer;
      const prevHighlight = (globalThis as any).window.highlightActiveTranscriptSegment;
      (globalThis as any).window.seekCompanionPlayer = seekMock;
      (globalThis as any).window.highlightActiveTranscriptSegment = highlightMock;

      (globalThis as any).window.invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'convert_media_file') return convertPromise;
        if (cmd === 'start_transcription_task') {
          capturedTaskSettings = { ...args?.settings };
          return Promise.resolve({
            outputDir: '/media',
            generatedFiles: ['sliced.srt'],
            durationMs: 1200,
            speedFactor: 25.0,
            internalJsonPath: null
          });
        }
        if (cmd === 'get_transcript_session_data') {
          return Promise.resolve(
            JSON.stringify({
              transcription: [
                {
                  timestamps: { from: '00:02:00,000', to: '00:02:05,000' },
                  offsets: { from: 120_000, to: 125_000 },
                  text: 'Sliced caption'
                }
              ]
            })
          );
        }
        return Promise.resolve(null);
      });

      try {
        const runTask = runWhisperTranscription();
        await Promise.resolve();
        await Promise.resolve();

        // Mutate live settings while WAV conversion is still in flight
        const liveSettings = getSettingsState();
        if (liveSettings) {
          liveSettings.offsetT = 0;
          liveSettings.outputSrt = false;
          liveSettings.outputTxt = true;
        }

        resolveConvert('/tmp/sliced.wav');
        await runTask;

        // Task must receive the immutable run snapshot captured at start
        expect(capturedTaskSettings?.offsetT).toBe(120_000);
        expect(capturedTaskSettings?.outputSrt).toBe(true);
        // Companion player must seek to the sliced start instead of highlighting on frame 00:00
        expect(seekMock).toHaveBeenCalledWith(120_000, false, expect.any(Number));
        expect(highlightMock).not.toHaveBeenCalled();
      } finally {
        (globalThis as any).window.seekCompanionPlayer = prevSeek;
        (globalThis as any).window.highlightActiveTranscriptSegment = prevHighlight;
        resetQuickDeckState();
      }
    });

    it('clears stale probedMetadata immediately when replacing a single file and ignores stale probe rejections', async () => {
      resetQuickDeckState();
      setSelectedMediaFile('/media/first.mp4');
      setProbedMetadata({ exists: true, durationSec: 180, format: 'Video' });

      let rejectSecondProbe!: (err: Error) => void;
      const secondProbePromise = new Promise<any>((_, reject) => {
        rejectSecondProbe = reject;
      });
      let probedDuringTransition: any = 'not-checked';

      (globalThis as any).window.invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file' && args?.filePath === '/media/second.mp4') {
          // By the time probe_media_file is invoked for the replacement file, prior metadata must already be null
          probedDuringTransition = getProbedMetadata();
          return secondProbePromise;
        }
        if (cmd === 'probe_media_file' && args?.filePath === '/media/third.mp4') {
          return Promise.resolve({ exists: true, durationSec: 42, format: 'Video' });
        }
        return Promise.resolve(null);
      });

      const secondDropTask = handleDroppedFiles(['/media/second.mp4']);
      expect(probedDuringTransition).toBeNull();

      // Switch to third file before second file's probe fails
      await handleDroppedFiles(['/media/third.mp4']);
      expect(getSelectedMediaFile()).toBe('/media/third.mp4');
      expect(getProbedMetadata()?.durationSec).toBe(42);

      // Now reject the stale second probe: it must NOT clear the newly selected third file
      rejectSecondProbe(new Error('stale probe failure'));
      await secondDropTask;

      expect(getSelectedMediaFile()).toBe('/media/third.mp4');
      expect(getProbedMetadata()?.durationSec).toBe(42);
      resetQuickDeckState();
    });

    it('clears stale batchItems and invalidates in-flight batch probes on resetQueueState and single-file transitions', async () => {
      // Arrange
      resetQuickDeckState();
      let resolveBatchProbe!: (val: any) => void;
      const batchProbePromise = new Promise(resolve => {
        resolveBatchProbe = resolve;
      });

      (globalThis as any).window.invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file' && args?.filePath === '/batch/a.mp4') {
          return batchProbePromise;
        }
        if (cmd === 'probe_media_file' && args?.filePath === '/single/only.mp4') {
          return Promise.resolve({ exists: true, durationSec: 95, format: 'Video' });
        }
        return Promise.resolve({ exists: true, durationSec: 30, format: 'Video' });
      });

      // Enter batch mode with 2 files while probing /batch/a.mp4 stays in-flight
      await handleDroppedFiles(['/batch/a.mp4', '/batch/b.mp4']);
      expect(batchProcessor.getIsBatchMode()).toBe(true);
      expect(batchProcessor.getItems()).toHaveLength(2);

      // Act: exit batch mode via clearSingleMediaFile (or stale isBatchMode=false before dropping single file)
      batchProcessor.setIsBatchMode(false);
      await handleDroppedFiles(['/single/only.mp4']);

      // Assert: stale batch items are wiped and epoch invalidated
      expect(batchProcessor.getIsBatchMode()).toBe(false);
      expect(batchProcessor.getItems()).toHaveLength(0);
      expect(getSelectedMediaFile()).toBe('/single/only.mp4');
      expect(getProbedMetadata()?.durationSec).toBe(95);

      // Resolve stale batch probe and verify it does NOT mutate state or revive batch items
      resolveBatchProbe({ exists: true, durationSec: 12, size: '1 MB' });
      await Promise.resolve();
      await Promise.resolve();

      expect(batchProcessor.getIsBatchMode()).toBe(false);
      expect(batchProcessor.getItems()).toHaveLength(0);
      expect(getSelectedMediaFile()).toBe('/single/only.mp4');

      // Clearing single media file also leaves batch state completely empty
      clearSingleMediaFile();
      expect(batchProcessor.getItems()).toHaveLength(0);
      expect(batchProcessor.getSelectedFiles()).toHaveLength(0);
      resetQuickDeckState();
    });

    it('synchronizes preloaded companion player back to 00:00 when full-file transcription finishes with firstStartMs === 0', async () => {
      // Arrange
      resetQuickDeckState();
      setSelectedMediaFile('/media/full_clip.mp4');
      setWavPathForTranscription('/tmp/full_clip.wav');
      setProbedMetadata({ exists: true, durationSec: 120, format: 'Video' });
      (globalThis as any).window.localScannedTransModels = ['ggml-base.bin'];
      setSettingsState({
        selectedBackend: 'Standard',
        modelPath: 'ggml-base.bin',
        inputFile: '/media/full_clip.mp4',
        outputSrt: true,
        outputDirMode: 'input_dir',
        offsetT: 0,
        duration: 0
      });

      const seekMock = vi.fn();
      const prevSeek = (globalThis as any).window.seekCompanionPlayer;
      (globalThis as any).window.seekCompanionPlayer = seekMock;

      (globalThis as any).window.invoke = vi.fn((cmd: string) => {
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            outputDir: '/media',
            generatedFiles: ['full_clip.srt'],
            durationMs: 800,
            speedFactor: 15.0,
            internalJsonPath: null
          });
        }
        if (cmd === 'get_transcript_session_data') {
          return Promise.resolve(
            JSON.stringify({
              transcription: [
                {
                  timestamps: { from: '00:00:00,000', to: '00:00:04,000' },
                  offsets: { from: 0, to: 4_000 },
                  text: 'Starts right at zero'
                }
              ]
            })
          );
        }
        return Promise.resolve(null);
      });

      try {
        // Act
        await runWhisperTranscription();

        // Assert: seeks preloaded player cleanly to 0ms so prior scrub position cannot stay desynced
        expect(seekMock).toHaveBeenCalledWith(0, false, 0);
      } finally {
        (globalThis as any).window.seekCompanionPlayer = prevSeek;
        resetQuickDeckState();
      }
    });
  });
});
