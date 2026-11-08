import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  workflowBridge,
  getLastTranscribedSubtitlePath,
  setLastTranscribedSubtitlePath,
  getLastTranscribedVideoPath,
  setLastTranscribedVideoPath,
  getLastTranscribedOutputDir,
  setLastTranscribedOutputDir,
  getLastTranscribedOutputFiles,
  setLastTranscribedOutputFiles,
  toggleOutputFilesDropdown,
  renderOutputFilesDropdown,
  updateTranscribeWorkflowButtons,
  updateTranscribeActionButtons,
  sendTranscribeToTranslationStudio,
  sendTranscribeToHardsubStudio,
  isSupportedVideoFile,
  SUPPORTED_COMPANION_VIDEO_EXTENSIONS
} from './workflowBridge';
import {
  transcriptViewer,
  updateTranscriptLineText,
  serializeTranscriptLinesForFile
} from './transcriptViewer';

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

describe('workflowBridge module', () => {
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
    it('manages lastTranscribedSubtitlePath and syncs with global window', () => {
      setLastTranscribedSubtitlePath('/output/movie.srt');
      expect(getLastTranscribedSubtitlePath()).toBe('/output/movie.srt');
      expect((globalThis as any).window.lastTranscribedSubtitlePath).toBe('/output/movie.srt');

      // Test reverse reactivity from window mutation
      (globalThis as any).window.lastTranscribedSubtitlePath = '/batch/output.srt';
      expect(getLastTranscribedSubtitlePath()).toBe('/batch/output.srt');

      (globalThis as any).window.lastTranscribedSubtitlePath = null;
      expect(getLastTranscribedSubtitlePath()).toBe(null);
    });

    it('manages lastTranscribedVideoPath and syncs with global window', () => {
      setLastTranscribedVideoPath('/media/video.mp4');
      expect(getLastTranscribedVideoPath()).toBe('/media/video.mp4');
      expect((globalThis as any).window.lastTranscribedVideoPath).toBe('/media/video.mp4');

      (globalThis as any).window.lastTranscribedVideoPath = '/batch/video2.mp4';
      expect(getLastTranscribedVideoPath()).toBe('/batch/video2.mp4');
    });

    it('manages lastTranscribedOutputDir and syncs with global window', () => {
      setLastTranscribedOutputDir('/custom/output');
      expect(getLastTranscribedOutputDir()).toBe('/custom/output');
      expect((globalThis as any).window.lastTranscribedOutputDir).toBe('/custom/output');

      (globalThis as any).window.lastTranscribedOutputDir = '/batch/outdir';
      expect(getLastTranscribedOutputDir()).toBe('/batch/outdir');
    });

    it('manages lastTranscribedOutputFiles and ensures array integrity', () => {
      const files = [{ name: 'sub.srt', path: '/sub.srt', type: 'subtitle' }];
      setLastTranscribedOutputFiles(files);
      expect(getLastTranscribedOutputFiles()).toEqual(files);
      expect((globalThis as any).window.lastTranscribedOutputFiles).toEqual(files);

      // Verify defensive copy prevents external mutation
      files.push({ name: 'mutation.srt', path: '/mutation.srt', type: 'subtitle' });
      expect(getLastTranscribedOutputFiles()).toHaveLength(1);

      // Test reverse reactivity from window mutation (e.g. from batchProcessor)
      const batchFiles = [{ name: 'batch.srt', path: '/batch.srt', type: 'subtitle' }];
      (globalThis as any).window.lastTranscribedOutputFiles = batchFiles;
      expect(getLastTranscribedOutputFiles()).toEqual(batchFiles);

      setLastTranscribedOutputFiles(null as any);
      expect(getLastTranscribedOutputFiles()).toEqual([]);
    });

    it('normalizes non-string path arguments to null defensively and trims strings', () => {
      setLastTranscribedSubtitlePath(123 as any);
      expect(getLastTranscribedSubtitlePath()).toBe(null);

      setLastTranscribedSubtitlePath('');
      expect(getLastTranscribedSubtitlePath()).toBe(null);

      setLastTranscribedSubtitlePath('   ');
      expect(getLastTranscribedSubtitlePath()).toBe(null);

      setLastTranscribedSubtitlePath('  /output/trimmed.srt  ');
      expect(getLastTranscribedSubtitlePath()).toBe('/output/trimmed.srt');

      setLastTranscribedVideoPath({ invalid: true } as any);
      expect(getLastTranscribedVideoPath()).toBe(null);

      setLastTranscribedVideoPath('');
      expect(getLastTranscribedVideoPath()).toBe(null);

      setLastTranscribedVideoPath('  /media/trimmed.mp4  ');
      expect(getLastTranscribedVideoPath()).toBe('/media/trimmed.mp4');

      setLastTranscribedOutputDir(undefined as any);
      expect(getLastTranscribedOutputDir()).toBe(null);

      setLastTranscribedOutputDir('   ');
      expect(getLastTranscribedOutputDir()).toBe(null);

      setLastTranscribedOutputDir('  /output/trimmed_dir  ');
      expect(getLastTranscribedOutputDir()).toBe('/output/trimmed_dir');
    });

    it('prevents maximum call stack recursion when window properties delegate to getters/setters', () => {
      Object.defineProperties(globalThis, {
        lastTranscribedSubtitlePath: {
          get() { return getLastTranscribedSubtitlePath(); },
          set(val: string | null) { setLastTranscribedSubtitlePath(val); },
          configurable: true
        },
        lastTranscribedVideoPath: {
          get() { return getLastTranscribedVideoPath(); },
          set(val: string | null) { setLastTranscribedVideoPath(val); },
          configurable: true
        },
        lastTranscribedOutputDir: {
          get() { return getLastTranscribedOutputDir(); },
          set(val: string | null) { setLastTranscribedOutputDir(val); },
          configurable: true
        },
        lastTranscribedOutputFiles: {
          get() { return getLastTranscribedOutputFiles(); },
          set(val: any[]) { setLastTranscribedOutputFiles(val); },
          configurable: true
        }
      });

      // Calling getters must not trigger RangeError: Maximum call stack size exceeded
      expect(() => getLastTranscribedSubtitlePath()).not.toThrow();
      expect(() => getLastTranscribedVideoPath()).not.toThrow();
      expect(() => getLastTranscribedOutputDir()).not.toThrow();
      expect(() => getLastTranscribedOutputFiles()).not.toThrow();

      // Setting via function or window must synchronize without recursion
      setLastTranscribedSubtitlePath('/output/recursion_test.srt');
      expect(getLastTranscribedSubtitlePath()).toBe('/output/recursion_test.srt');
      expect((globalThis as any).window.lastTranscribedSubtitlePath).toBe('/output/recursion_test.srt');

      (globalThis as any).window.lastTranscribedVideoPath = '/media/recursion_test.mp4';
      expect(getLastTranscribedVideoPath()).toBe('/media/recursion_test.mp4');
      expect((globalThis as any).window.lastTranscribedVideoPath).toBe('/media/recursion_test.mp4');
    });
  });

  describe('Dropdown Rendering and Visibility', () => {
    it('toggles dropdown visibility cleanly', () => {
      const dropdown = new MockElement('DIV');
      dropdown.id = 'transcribe-output-files-dropdown';
      dropdown.style.display = 'none';
      domMap.set(dropdown.id, dropdown);

      toggleOutputFilesDropdown();
      expect(dropdown.style.display).toBe('flex');

      toggleOutputFilesDropdown();
      expect(dropdown.style.display).toBe('none');

      toggleOutputFilesDropdown(true);
      expect(dropdown.style.display).toBe('none');
    });

    it('renders output file buttons with appropriate badges', () => {
      const dropdown = new MockElement('DIV');
      dropdown.id = 'transcribe-output-files-dropdown';
      domMap.set(dropdown.id, dropdown);

      setLastTranscribedOutputFiles([
        { name: 'movie.srt', path: '/movie.srt', type: 'subtitle' },
        { name: 'movie_fa.srt', path: '/movie_fa.srt', type: 'translated' },
        { name: 'transcript.txt', path: '/transcript.txt', type: 'text' },
        { name: 'metadata.json', path: '/metadata.json', type: 'json' }
      ]);

      renderOutputFilesDropdown();
      expect(dropdown.children.length).toBe(4);
      expect(dropdown.children[0].innerHTML).toContain('movie.srt');
      expect(dropdown.children[1].innerHTML).toContain('translated');
      expect(dropdown.children[2].innerHTML).toContain('Text');
      expect(dropdown.children[3].innerHTML).toContain('JSON');
    });
  });

  describe('Workflow Buttons Lifecycle', () => {
    it('disables workflow buttons when no output or transcript exists', () => {
      const btnOpenFolder = new MockElement('BUTTON');
      btnOpenFolder.id = 'btn-open-output-folder';
      const btnOpenFile = new MockElement('BUTTON');
      btnOpenFile.id = 'btn-open-output-file';
      const btnSendTranslate = new MockElement('BUTTON');
      btnSendTranslate.id = 'btn-send-to-translation';
      const btnSendHardsub = new MockElement('BUTTON');
      btnSendHardsub.id = 'btn-transcribe-send-to-hardsub';
      const btnCopy = new MockElement('BUTTON');
      btnCopy.id = 'btn-copy-transcript';

      domMap.set(btnOpenFolder.id, btnOpenFolder);
      domMap.set(btnOpenFile.id, btnOpenFile);
      domMap.set(btnSendTranslate.id, btnSendTranslate);
      domMap.set(btnSendHardsub.id, btnSendHardsub);
      domMap.set(btnCopy.id, btnCopy);

      setLastTranscribedSubtitlePath(null);
      setLastTranscribedOutputDir(null);
      setLastTranscribedOutputFiles([]);
      (globalThis as any).window.transcriptLines = [];

      updateTranscribeWorkflowButtons();

      expect(btnOpenFolder.disabled).toBe(true);
      expect(btnOpenFile.disabled).toBe(true);
      expect(btnSendTranslate.disabled).toBe(true);
      expect(btnSendHardsub.disabled).toBe(true);
      expect(btnCopy.disabled).toBe(true);
    });

    it('enables workflow buttons and updates single file title when outputs exist', () => {
      const btnOpenFolder = new MockElement('BUTTON');
      btnOpenFolder.id = 'btn-open-output-folder';
      const btnOpenFile = new MockElement('BUTTON');
      btnOpenFile.id = 'btn-open-output-file';
      const btnSendTranslate = new MockElement('BUTTON');
      btnSendTranslate.id = 'btn-send-to-translation';
      const btnSendHardsub = new MockElement('BUTTON');
      btnSendHardsub.id = 'btn-transcribe-send-to-hardsub';
      const btnCopy = new MockElement('BUTTON');
      btnCopy.id = 'btn-copy-transcript';

      domMap.set(btnOpenFolder.id, btnOpenFolder);
      domMap.set(btnOpenFile.id, btnOpenFile);
      domMap.set(btnSendTranslate.id, btnSendTranslate);
      domMap.set(btnSendHardsub.id, btnSendHardsub);
      domMap.set(btnCopy.id, btnCopy);

      setLastTranscribedSubtitlePath('/output/movie.srt');
      setLastTranscribedOutputDir('/output');
      setLastTranscribedOutputFiles([{ name: 'movie.srt', path: '/output/movie.srt', type: 'subtitle' }]);

      updateTranscribeWorkflowButtons();

      expect(btnOpenFolder.disabled).toBe(false);
      expect(btnOpenFile.disabled).toBe(false);
      expect(btnSendTranslate.disabled).toBe(false);
      expect(btnSendHardsub.disabled).toBe(false);
      expect(btnCopy.disabled).toBe(false);
      expect(btnOpenFile.title).toContain('movie.srt');
    });
  });

  describe('Studio Bridging Operations', () => {
    it('dispatches translation studio transfer and companion video', async () => {
      setLastTranscribedSubtitlePath('/output/audio.srt');
      setLastTranscribedVideoPath('/media/video.mp4');

      const mockLoadSub = vi.fn().mockResolvedValue(undefined);
      const mockSetCompanion = vi.fn();
      const mockSwitchView = vi.fn();

      (globalThis as any).window.translationStudioController = {
        loadSubtitleFile: mockLoadSub,
        setCompanionVideo: mockSetCompanion
      };
      (globalThis as any).window.switchView = mockSwitchView;
      (globalThis as any).window.showNotification = vi.fn();

      await sendTranscribeToTranslationStudio();

      expect(mockLoadSub).toHaveBeenCalledWith('/output/audio.srt');
      expect(mockSetCompanion).toHaveBeenCalledWith('/media/video.mp4');
      expect(mockSwitchView).toHaveBeenCalledWith('translate');
    });

    it('prefills hardsub studio and switches view', () => {
      setLastTranscribedSubtitlePath('/output/interview.srt');
      setLastTranscribedVideoPath('/media/interview.mkv');

      const mockPrefill = vi.fn();
      const mockSwitchView = vi.fn();

      (globalThis as any).window.hardsubController = {
        prefillFilePaths: mockPrefill
      };
      (globalThis as any).window.switchView = mockSwitchView;
      (globalThis as any).window.showNotification = vi.fn();

      sendTranscribeToHardsubStudio();

      expect(mockPrefill).toHaveBeenCalledWith('/media/interview.mkv', '/output/interview.srt');
      expect(mockSwitchView).toHaveBeenCalledWith('hardsub');
    });

    it('supports extended video formats and suppresses audio-only formats for companion video', async () => {
      expect(isSupportedVideoFile('/media/clip.ts')).toBe(true);
      expect(isSupportedVideoFile('/media/clip.WMV')).toBe(true);
      expect(isSupportedVideoFile('/media/clip.flv')).toBe(true);
      expect(isSupportedVideoFile('/media/clip.m4v')).toBe(true);
      expect(isSupportedVideoFile('  /media/clip.mp4  ')).toBe(true);
      expect(isSupportedVideoFile('   ')).toBe(false);
      expect(isSupportedVideoFile('/media/audio.mp3')).toBe(false);
      expect(isSupportedVideoFile('/media/voice.wav')).toBe(false);
      expect(isSupportedVideoFile('')).toBe(false);
      expect(isSupportedVideoFile(null)).toBe(false);

      // Verify extended video format (.ts) is forwarded to Translation Studio
      setLastTranscribedSubtitlePath('/output/broadcast.srt');
      setLastTranscribedVideoPath('/media/broadcast.ts');
      const mockSetCompanionTs = vi.fn();
      (globalThis as any).window.translationStudioController = {
        loadSubtitleFile: vi.fn().mockResolvedValue(undefined),
        setCompanionVideo: mockSetCompanionTs
      };
      await sendTranscribeToTranslationStudio();
      expect(mockSetCompanionTs).toHaveBeenCalledWith('/media/broadcast.ts');

      // Verify audio-only file (.wav) is NOT set as companion video in Translation Studio
      setLastTranscribedVideoPath('/media/podcast.wav');
      const mockSetCompanionAudio = vi.fn();
      (globalThis as any).window.translationStudioController = {
        loadSubtitleFile: vi.fn().mockResolvedValue(undefined),
        setCompanionVideo: mockSetCompanionAudio
      };
      await sendTranscribeToTranslationStudio();
      expect(mockSetCompanionAudio).not.toHaveBeenCalled();

      // Verify extended video format (.wmv) is forwarded to Hardsub Studio
      setLastTranscribedVideoPath('/media/presentation.wmv');
      const mockPrefillVideo = vi.fn();
      (globalThis as any).window.hardsubController = { prefillFilePaths: mockPrefillVideo };
      sendTranscribeToHardsubStudio();
      expect(mockPrefillVideo).toHaveBeenCalledWith('/media/presentation.wmv', '/output/broadcast.srt');

      // Verify audio-only file (.mp3) is cleared before prefilling Hardsub Studio
      setLastTranscribedVideoPath('/media/song.mp3');
      const mockPrefillAudio = vi.fn();
      (globalThis as any).window.hardsubController = { prefillFilePaths: mockPrefillAudio };
      sendTranscribeToHardsubStudio();
      expect(mockPrefillAudio).toHaveBeenCalledWith('', '/output/broadcast.srt');
    });

    it('flushes live transcript edits to disk before sending to Translation or Hardsub Studio', async () => {
      const writeCalls: Array<{ filePath: string; content: string }> = [];
      (globalThis as any).window.invoke = vi.fn(async (cmd: string, args: any) => {
        if (cmd === 'write_text_file_content') {
          writeCalls.push(args);
        }
        return undefined;
      });

      setLastTranscribedSubtitlePath('/output/edited.srt');
      setLastTranscribedOutputFiles([
        { name: 'edited.srt', path: '/output/edited.srt', type: 'subtitle' },
        { name: 'edited.txt', path: '/output/edited.txt', type: 'text' }
      ]);

      transcriptViewer.lines = [
        { id: 0, timeRange: '[00:00:01.000 --> 00:00:03.500]', text: 'Original typo text' }
      ];

      // User edits line in Live Transcript Viewer
      updateTranscriptLineText(0, 'Corrected subtitle text');
      expect(transcriptViewer.hasPendingEdits()).toBe(true);

      let subtitleWrittenBeforeLoad = false;
      (globalThis as any).window.translationStudioController = {
        loadSubtitleFile: vi.fn(async () => {
          subtitleWrittenBeforeLoad = writeCalls.some(c => c.filePath === '/output/edited.srt');
        })
      };

      await sendTranscribeToTranslationStudio();

      expect(subtitleWrittenBeforeLoad).toBe(true);
      expect(writeCalls).toEqual(
        expect.arrayContaining([
          {
            filePath: '/output/edited.srt',
            content: '1\n00:00:01,000 --> 00:00:03,500\nCorrected subtitle text\n'
          },
          {
            filePath: '/output/edited.txt',
            content: 'Corrected subtitle text\n'
          }
        ])
      );
      expect(transcriptViewer.hasPendingEdits()).toBe(false);

      // Verify VTT serialization format as well
      const vttContent = serializeTranscriptLinesForFile(transcriptViewer.getLines(), '/output/edited.vtt');
      expect(vttContent).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\nCorrected subtitle text\n');
    });
  });
});
