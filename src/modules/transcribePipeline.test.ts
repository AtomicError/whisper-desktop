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
  handleDroppedFiles,
  renderMediaMetadata,
  toggleTelemetryHudCollapse,
  applySingleFileSelectedUI,
  runWhisperTranscription,
  abortTranscription,
  getIsTranscriptionCancelActive,
  setIsTranscriptionCancelActive
} from './transcribePipeline';
import { batchProcessor } from './batchProcessor';

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
    it('renders format, file size, duration, and backend info', () => {
      const typeEl = new MockElement('SPAN');
      typeEl.id = 'meta-type';
      const sizeEl = new MockElement('SPAN');
      sizeEl.id = 'meta-size';
      const durEl = new MockElement('SPAN');
      durEl.id = 'meta-duration';
      const recEl = new MockElement('SPAN');
      recEl.id = 'meta-recommendation';

      domMap.set(typeEl.id, typeEl);
      domMap.set(sizeEl.id, sizeEl);
      domMap.set(durEl.id, durEl);
      domMap.set(recEl.id, recEl);

      (globalThis as any).window.settingsState = {
        selectedBackend: 'Vulkan',
        threads: 6
      };

      const meta = {
        exists: true,
        format: 'QuickTime / MOV / MP4 Video',
        size: '142.5 MB',
        durationSec: 125
      };

      renderMediaMetadata(meta);

      expect(typeEl.textContent).toContain('🎥');
      expect(sizeEl.textContent).toContain('MB');
      expect(durEl.textContent.length).toBeGreaterThan(0);
      expect(durEl.title).toContain('00:02:05');
      expect(recEl.textContent).toContain('Vulkan');
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
});
