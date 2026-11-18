import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { transcriptViewer } from './transcriptViewer';
import {
  batchProcessor,
  formatDuration,
  getBasename,
  getParentDir,
  sortBatchQueue,
  moveBatchItemUp,
  moveBatchItemDown,
  clearBatchQueue,
  removeFileFromBatch,
  addBatchFiles,
  runBatchExtraction,
  abortBatchExtraction,
  selectBatchItemTranscript,
  type BatchItem
} from './batchProcessor';

describe('batchProcessor module', () => {
  beforeEach(() => {
    // Reset state before each test
    batchProcessor.setItems([]);
    batchProcessor.setSelectedFiles([]);
    batchProcessor.setIsBatchMode(false);
    batchProcessor.setActiveViewerIndex(-1);
    batchProcessor.setProcessingIndex(-1);
  });

  describe('formatDuration utility', () => {
    it('handles invalid, null, undefined, and negative durations gracefully', () => {
      const origT = (globalThis as any).t;
      (globalThis as any).t = (k: string) => (k === 'transcribe.statusPending' ? 'Pending' : k);
      try {
        expect(formatDuration(null)).toBe('Pending...');
        expect(formatDuration(undefined)).toBe('Pending...');
        expect(formatDuration(NaN)).toBe('Pending...');
        expect(formatDuration(-10)).toBe('Pending...');
      } finally {
        (globalThis as any).t = origT;
      }
    });

    it('formats short durations as mm:ss and long durations as hh:mm:ss', () => {
      expect(formatDuration(0)).toBe('00:00:00');
      expect(formatDuration(45)).toBe('00:00:45');
      expect(formatDuration(125)).toBe('00:02:05');
      expect(formatDuration(3665)).toBe('01:01:05');
      expect(formatDuration(7200)).toBe('02:00:00');
    });
  });

  describe('path utilities (getBasename, getParentDir)', () => {
    it('extracts basenames correctly across POSIX and Windows paths', () => {
      expect(getBasename('')).toBe('');
      expect(getBasename('/home/user/video.mp4')).toBe('video.mp4');
      expect(getBasename('C:\\Users\\admin\\media\\audio.wav')).toBe('audio.wav');
    });

    it('extracts parent directories correctly across POSIX and Windows paths', () => {
      expect(getParentDir('')).toBe('');
      expect(getParentDir('/home/user/video.mp4')).toBe('/home/user');
      expect(getParentDir('C:\\Users\\admin\\media\\audio.wav')).toBe('C:\\Users\\admin\\media');
    });
  });

  describe('state encapsulation and bindings', () => {
    it('allows getting and setting batch items and selected files safely', () => {
      const sampleItems: BatchItem[] = [
        { path: '/a.mp4', name: 'a.mp4', status: 'pending', durationSec: 10 },
        { path: '/b.mp4', name: 'b.mp4', status: 'pending', durationSec: 20 }
      ];

      batchProcessor.setItems(sampleItems);
      expect(batchProcessor.getItems()).toHaveLength(2);
      expect(batchProcessor.getItems()[0].name).toBe('a.mp4');

      batchProcessor.setSelectedFiles(['/a.mp4', '/b.mp4']);
      expect(batchProcessor.getSelectedFiles()).toEqual(['/a.mp4', '/b.mp4']);

      batchProcessor.setIsBatchMode(true);
      expect(batchProcessor.getIsBatchMode()).toBe(true);

      batchProcessor.setActiveViewerIndex(1);
      expect(batchProcessor.getActiveViewerIndex()).toBe(1);

      batchProcessor.setProcessingIndex(0);
      expect(batchProcessor.getProcessingIndex()).toBe(0);
    });
  });

  describe('queue reordering (moveBatchItemUp / moveBatchItemDown)', () => {
    beforeEach(() => {
      const items: BatchItem[] = [
        { path: '/1.mp4', name: '1.mp4', status: 'pending' },
        { path: '/2.mp4', name: '2.mp4', status: 'pending' },
        { path: '/3.mp4', name: '3.mp4', status: 'pending' }
      ];
      batchProcessor.setItems(items);
      batchProcessor.setSelectedFiles(['/1.mp4', '/2.mp4', '/3.mp4']);
    });

    it('moves an item up and updates activeBatchViewerIndex', () => {
      batchProcessor.setActiveViewerIndex(1);
      moveBatchItemUp(1);

      const items = batchProcessor.getItems();
      expect(items[0].name).toBe('2.mp4');
      expect(items[1].name).toBe('1.mp4');
      expect(batchProcessor.getActiveViewerIndex()).toBe(0);
    });

    it('does nothing when moving up the first item or out of bounds index', () => {
      moveBatchItemUp(0);
      expect(batchProcessor.getItems()[0].name).toBe('1.mp4');

      moveBatchItemUp(-1);
      moveBatchItemUp(99);
      expect(batchProcessor.getItems()[0].name).toBe('1.mp4');
    });

    it('moves an item down and updates activeBatchViewerIndex', () => {
      batchProcessor.setActiveViewerIndex(1);
      moveBatchItemDown(1);

      const items = batchProcessor.getItems();
      expect(items[1].name).toBe('3.mp4');
      expect(items[2].name).toBe('2.mp4');
      expect(batchProcessor.getActiveViewerIndex()).toBe(2);
    });

    it('does nothing when moving down the last item or out of bounds index', () => {
      moveBatchItemDown(2);
      expect(batchProcessor.getItems()[2].name).toBe('3.mp4');

      moveBatchItemDown(-5);
      moveBatchItemDown(10);
      expect(batchProcessor.getItems()[2].name).toBe('3.mp4');
    });

    it('resets batch-sort-select to empty when user manually moves an item up or down', () => {
      const select = { id: 'batch-sort-select', value: 'name-asc' };
      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => (id === 'batch-sort-select' ? select : null))
      };

      let syncCalled = false;
      (window as any).customSelectsMap = new Map();
      (window as any).customSelectsMap.set('batch-sort-select', {
        syncSelectedValue: () => { syncCalled = true; }
      });

      try {
        moveBatchItemDown(0);
        expect(select.value).toBe('');
        expect(syncCalled).toBe(true);
      } finally {
        (globalThis as any).document = prevDoc;
        delete (window as any).customSelectsMap;
      }
    });
  });

  describe('queue sorting (sortBatchQueue)', () => {
    beforeEach(() => {
      const items: BatchItem[] = [
        { path: '/part10.mp4', name: 'part10.mp4', status: 'pending', durationSec: 300 },
        { path: '/part2.mp4', name: 'part2.mp4', status: 'pending', durationSec: 50 },
        { path: '/part1.mp4', name: 'part1.mp4', status: 'pending', durationSec: 150 }
      ];
      batchProcessor.setItems(items);
      batchProcessor.setSelectedFiles(['/part10.mp4', '/part2.mp4', '/part1.mp4']);
    });

    it('sorts naturally by name-asc (part1, part2, part10)', () => {
      sortBatchQueue('name-asc');
      const names = batchProcessor.getItems().map(it => it.name);
      expect(names).toEqual(['part1.mp4', 'part2.mp4', 'part10.mp4']);
    });

    it('sorts by name-desc (part10, part2, part1)', () => {
      sortBatchQueue('name-desc');
      const names = batchProcessor.getItems().map(it => it.name);
      expect(names).toEqual(['part10.mp4', 'part2.mp4', 'part1.mp4']);
    });

    it('sorts by duration-asc (50s, 150s, 300s)', () => {
      sortBatchQueue('duration-asc');
      const durations = batchProcessor.getItems().map(it => it.durationSec);
      expect(durations).toEqual([50, 150, 300]);
    });

    it('sorts by duration-desc (300s, 150s, 50s)', () => {
      sortBatchQueue('duration-desc');
      const durations = batchProcessor.getItems().map(it => it.durationSec);
      expect(durations).toEqual([300, 150, 50]);
    });

    it('sets batch-sort-select value to criteria and calls syncSelectedValue', () => {
      const select = { id: 'batch-sort-select', value: '' };
      const prevDoc = (globalThis as any).document;
      const prevShowNotify = (window as any).showNotification;
      (window as any).showNotification = vi.fn();
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => (id === 'batch-sort-select' ? select : null))
      };

      let syncCalled = false;
      (window as any).customSelectsMap = new Map();
      (window as any).customSelectsMap.set('batch-sort-select', {
        syncSelectedValue: () => { syncCalled = true; }
      });

      try {
        sortBatchQueue('name-asc');
        expect(select.value).toBe('name-asc');
        expect(syncCalled).toBe(true);
      } finally {
        (globalThis as any).document = prevDoc;
        (window as any).showNotification = prevShowNotify;
        delete (window as any).customSelectsMap;
      }
    });

    it('resets batch-sort-select when sortBatchQueue is called with 0 or 1 item', () => {
      batchProcessor.setItems([{ path: '/part1.mp4', name: 'part1.mp4', status: 'pending' }]);
      const select = { id: 'batch-sort-select', value: 'name-asc' };
      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => (id === 'batch-sort-select' ? select : null))
      };

      let syncCalled = false;
      (window as any).customSelectsMap = new Map();
      (window as any).customSelectsMap.set('batch-sort-select', {
        syncSelectedValue: () => { syncCalled = true; }
      });

      try {
        sortBatchQueue('name-asc');
        expect(select.value).toBe('');
        expect(syncCalled).toBe(true);
      } finally {
        (globalThis as any).document = prevDoc;
        delete (window as any).customSelectsMap;
      }
    });
  });

  describe('item removal and queue clearing', () => {
    it('removes a specific item and updates selectedMediaFiles', () => {
      const items: BatchItem[] = [
        { path: '/a.mp4', name: 'a.mp4', status: 'pending' },
        { path: '/b.mp4', name: 'b.mp4', status: 'pending' }
      ];
      batchProcessor.setItems(items);
      batchProcessor.setSelectedFiles(['/a.mp4', '/b.mp4']);

      removeFileFromBatch(0);
      expect(batchProcessor.getItems()).toHaveLength(1);
      expect(batchProcessor.getItems()[0].name).toBe('b.mp4');
      expect(batchProcessor.getSelectedFiles()).toEqual(['/b.mp4']);
    });

    it('clears entire queue and resets viewer indices', () => {
      const items: BatchItem[] = [
        { path: '/a.mp4', name: 'a.mp4', status: 'pending' },
        { path: '/b.mp4', name: 'b.mp4', status: 'pending' }
      ];
      batchProcessor.setItems(items);
      batchProcessor.setSelectedFiles(['/a.mp4', '/b.mp4']);
      batchProcessor.setActiveViewerIndex(0);

      clearBatchQueue();
      expect(batchProcessor.getItems()).toHaveLength(0);
      expect(batchProcessor.getSelectedFiles()).toHaveLength(0);
      expect(batchProcessor.getActiveViewerIndex()).toBe(-1);
    });
  });

  describe('addBatchFiles and workflow integration', () => {
    it('returns false when files array is empty or batch extraction is active', async () => {
      expect(await addBatchFiles([])).toBe(false);

      batchProcessor.setIsExtracting(true);
      expect(await addBatchFiles(['/video1.mp4'])).toBe(false);
      batchProcessor.setIsExtracting(false);
    });

    it('initializes batch mode and populates items when entering from empty state', async () => {
      const success = await addBatchFiles(['/media/file1.mp4', '/media/file2.mkv']);
      expect(success).toBe(true);
      expect(batchProcessor.getIsBatchMode()).toBe(true);
      expect(batchProcessor.getItems()).toHaveLength(2);
      expect(batchProcessor.getItems()[0].name).toBe('file1.mp4');
      expect(batchProcessor.getItems()[1].name).toBe('file2.mkv');
      expect(batchProcessor.getSelectedFiles()).toEqual(['/media/file1.mp4', '/media/file2.mkv']);
    });

    it('appends unique new files to an existing batch queue and rejects duplicates', async () => {
      await addBatchFiles(['/file1.mp4']);
      expect(batchProcessor.getItems()).toHaveLength(1);

      // Duplicate addition
      const dupResult = await addBatchFiles(['/file1.mp4']);
      expect(dupResult).toBe(false);
      expect(batchProcessor.getItems()).toHaveLength(1);

      // Append new file
      const appendResult = await addBatchFiles(['/file1.mp4', '/file2.mp4']);
      expect(appendResult).toBe(true);
      expect(batchProcessor.getItems()).toHaveLength(2);
      expect(batchProcessor.getItems()[1].name).toBe('file2.mp4');
    });

    it('synchronizes batchProcessor getters/setters with window properties', () => {
      window.isBatchMode = true;
      expect(batchProcessor.getIsBatchMode()).toBe(true);

      const sampleItems = [{ path: '/test.mp4', name: 'test.mp4', status: 'pending' as const }];
      window.batchItems = sampleItems as any;
      expect(batchProcessor.getItems()).toHaveLength(1);
      expect(batchProcessor.getItems()[0].name).toBe('test.mp4');

      // Verify defensive copy prevents external mutation
      sampleItems.push({ path: '/mutated.mp4', name: 'mutated.mp4', status: 'pending' as const });
      expect(batchProcessor.getItems()).toHaveLength(1);

      window.selectedMediaFiles = ['  /test.mp4  ', '', '   ', 123 as any];
      expect(batchProcessor.getSelectedFiles()).toEqual(['/test.mp4']);

      // Verify defensive copy prevents external mutation on selectedMediaFiles
      const filesRef = batchProcessor.getSelectedFiles();
      filesRef.push('/pushed.mp4');
      expect(batchProcessor.getSelectedFiles()).toEqual(['/test.mp4']);

      window.activeBatchViewerIndex = 0;
      expect(batchProcessor.getActiveViewerIndex()).toBe(0);

      window.batchProcessingIndex = 0;
      expect(batchProcessor.getProcessingIndex()).toBe(0);
    });
  });

  describe('batch extraction runner & abort guards', () => {
    it('runBatchExtraction blocks re-entrant calls when extraction is already in progress', async () => {
      batchProcessor.setIsExtracting(true);
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([{ path: '/test.mp4', name: 'test.mp4', status: 'pending' }]);

      const invokeMock = vi.fn();
      (window as any).invoke = invokeMock;

      await runBatchExtraction();
      expect(invokeMock).not.toHaveBeenCalled();

      batchProcessor.setIsExtracting(false);
    });

    it('abortBatchExtraction ignores execution when no extraction is active', async () => {
      batchProcessor.setIsExtracting(false);
      const invokeMock = vi.fn();
      (window as any).invoke = invokeMock;

      await abortBatchExtraction();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('abortBatchExtraction resets cancel lock and allows retry when backend invoke fails', async () => {
      batchProcessor.setIsExtracting(true);
      const invokeMock = vi.fn().mockRejectedValueOnce(new Error('IPC failure')).mockResolvedValueOnce('ok');
      (window as any).invoke = invokeMock;

      const notifyMock = vi.fn();
      (window as any).showNotification = notifyMock;

      const span = {
        setAttribute: vi.fn(),
        textContent: ''
      };
      const cancelBtn = {
        id: 'btn-cancel-batch',
        disabled: true,
        style: { display: 'inline-flex' },
        querySelector: vi.fn().mockImplementation((sel: string) => (sel === 'span' ? span : null))
      };
      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => (id === 'btn-cancel-batch' ? cancelBtn : null))
      };

      try {
        // First attempt fails
        await abortBatchExtraction();
        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(notifyMock).toHaveBeenCalled();
        expect(cancelBtn.style.display).toBe('inline-flex');
        expect(cancelBtn.disabled).toBe(false);
        expect(span.setAttribute).toHaveBeenCalledWith('data-i18n', 'transcribe.aborting');
        expect(span.setAttribute).toHaveBeenCalledWith('data-i18n', 'transcribe.cancelBatch');

        // Second attempt is allowed because lock was released on failure
        await abortBatchExtraction();
        expect(invokeMock).toHaveBeenCalledTimes(2);
      } finally {
        (globalThis as any).document = prevDoc;
        batchProcessor.setIsExtracting(false);
        batchProcessor.setCancelActive(false);
      }
    });

    it('abortBatchExtraction preserves cancel state and hides telemetry when backend reports no active session', async () => {
      batchProcessor.setIsExtracting(true);
      batchProcessor.setCancelActive(false);
      const invokeMock = vi.fn().mockRejectedValueOnce('No active transcription or translation session');
      (window as any).invoke = invokeMock;

      const notifyMock = vi.fn();
      (window as any).showNotification = notifyMock;

      const telemetryCard = { style: { display: 'block' } };
      const cancelBtn = {
        id: 'btn-cancel-batch',
        disabled: true,
        style: { display: 'inline-flex' },
        querySelector: vi.fn().mockReturnValue(null)
      };
      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-cancel-batch') return cancelBtn;
          if (id === 'telemetry-hud-card') return telemetryCard;
          return null;
        })
      };

      try {
        await abortBatchExtraction();
        expect(invokeMock).toHaveBeenCalledTimes(1);
        expect(notifyMock).toHaveBeenCalled();
        expect(telemetryCard.style.display).toBe('none');

        // Subsequent abort is blocked because batchCancelActive remains true
        await abortBatchExtraction();
        expect(invokeMock).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).document = prevDoc;
        batchProcessor.setIsExtracting(false);
        batchProcessor.setCancelActive(false);
      }
    });

    it('runBatchExtraction marks current item as aborted and resets radial HUD message and cancel flag on cancel', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/test1.mp4', name: 'test1.mp4', status: 'pending' },
        { path: '/test2.mp4', name: 'test2.mp4', status: 'pending' }
      ]);

      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin'
      };
      (window as any).localScannedTransModels = ['/model.bin'];

      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'convert_media_file') {
          return Promise.resolve('/test1.wav');
        }
        if (cmd === 'start_transcription_task') {
          // Simulate user cancelling during the task
          batchProcessor.setCancelActive(true);
          return Promise.reject(new Error('Process was cancelled by the user'));
        }
        return Promise.resolve('ok');
      });
      (window as any).invoke = invokeMock;

      const msgEl = {
        textContent: '',
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        dataset: { batchSummarySuccess: '1' }
      };
      const fillBar = { style: { width: '50%' } };
      const pctEl = { textContent: '50%' };
      const telemetryCard = { style: { display: 'block' } };
      const cancelSpan = { setAttribute: vi.fn(), textContent: '' };
      const cancelBtn = {
        style: { display: 'inline-flex' },
        disabled: false,
        querySelector: vi.fn().mockReturnValue(cancelSpan)
      };

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'lbl-radial-msg') return msgEl;
          if (id === 'progress-linear-fill') return fillBar;
          if (id === 'lbl-radial-pct') return pctEl;
          if (id === 'telemetry-hud-card') return telemetryCard;
          if (id === 'btn-cancel-batch') return cancelBtn;
          return null;
        })
      };

      try {
        await runBatchExtraction();

        const items = batchProcessor.getItems();
        expect(items[0].status).toBe('aborted');
        expect(items[1].status).toBe('aborted');
        expect(batchProcessor.getCancelActive()).toBe(false);
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect(msgEl.setAttribute).toHaveBeenCalledWith('data-i18n', 'transcribe.standingBy');
        expect(cancelSpan.setAttribute).toHaveBeenCalledWith('data-i18n', 'transcribe.cancelBatch');
        expect((msgEl.dataset as any).batchSummarySuccess).toBeUndefined();
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('setIsExtracting(false) automatically resets batchCancelActive', () => {
      batchProcessor.setIsExtracting(false);
      batchProcessor.setCancelActive(true);
      expect(batchProcessor.getCancelActive()).toBe(true);

      batchProcessor.setIsExtracting(false);
      expect(batchProcessor.getCancelActive()).toBe(false);
    });

    it('guarantees finally block resets isBatchExtracting and re-enables UI controls when pre-loop setup throws', async () => {
      // Arrange
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/preloop-error.mp4', name: 'preloop-error.mp4', status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin'
      };
      (window as any).localScannedTransModels = ['/model.bin'];
      (window as any).invoke = vi.fn().mockResolvedValue('ok');

      let actionButtonsState: boolean | undefined;
      (window as any).updateTranscribeActionButtons = vi.fn().mockImplementation((state: boolean) => {
        actionButtonsState = state;
      });

      const cancelSpan = { setAttribute: vi.fn(), textContent: '' };
      const cancelBtn = {
        style: { display: 'none' },
        disabled: false,
        querySelector: vi.fn().mockReturnValue(cancelSpan)
      };
      const sortSelect = { disabled: false };
      const clearBtn = { disabled: false };

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-cancel-batch') return cancelBtn;
          if (id === 'batch-sort-select') return sortSelect;
          if (id === 'btn-clear-batch') return clearBtn;
          if (id === 'telemetry-hud-card') throw new Error('Simulated DOM access crash in pre-loop HUD setup');
          return null;
        })
      };

      try {
        // Act
        await runBatchExtraction();

        // Assert
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect((window as any).isBatchExtracting).toBe(false);
        expect(batchProcessor.getProcessingIndex()).toBe(-1);
        expect(cancelBtn.style.display).toBe('none');
        expect(sortSelect.disabled).toBe(false);
        expect(clearBtn.disabled).toBe(false);
        expect(actionButtonsState).toBe(false);
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('guarantees finally block resets isBatchExtracting when post-loop autoTransfer throws', async () => {
      // Arrange
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/postloop-error.mp4', name: 'postloop-error.mp4', status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin',
        autoTransferToTranslate: true
      };
      (window as any).localScannedTransModels = ['/model.bin'];

      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'convert_media_file') return Promise.resolve('/postloop-error.wav');
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            outputDir: '/out',
            generatedFiles: ['postloop-error.srt'],
            durationMs: 1000,
            speedFactor: 2.0
          });
        }
        return Promise.resolve('ok');
      });
      (window as any).invoke = invokeMock;

      (window as any).sendTranscribeToTranslationStudio = vi.fn().mockRejectedValue(
        new Error('Unhandled network crash in translation studio transfer')
      );

      const cancelSpan = { setAttribute: vi.fn(), textContent: '' };
      const cancelBtn = {
        style: { display: 'none' },
        disabled: false,
        querySelector: vi.fn().mockReturnValue(cancelSpan)
      };
      const sortSelect = { disabled: false };
      const clearBtn = { disabled: false };
      const fillBar = { style: { width: '0%' }, classList: { remove: vi.fn() } };
      const pctEl = { textContent: '0%', removeAttribute: vi.fn() };
      const msgEl = { textContent: '', removeAttribute: vi.fn(), dataset: {} };

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-cancel-batch') return cancelBtn;
          if (id === 'batch-sort-select') return sortSelect;
          if (id === 'btn-clear-batch') return clearBtn;
          if (id === 'progress-linear-fill') return fillBar;
          if (id === 'lbl-radial-pct') return pctEl;
          if (id === 'lbl-radial-msg') return msgEl;
          return null;
        })
      };

      try {
        // Act
        await runBatchExtraction();

        // Assert
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect((window as any).isBatchExtracting).toBe(false);
        expect(batchProcessor.getProcessingIndex()).toBe(-1);
        expect(cancelBtn.style.display).toBe('none');
        expect(sortSelect.disabled).toBe(false);
        expect(clearBtn.disabled).toBe(false);
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('prevents permanent state lockup and permits immediate re-execution after an unhandled failure', async () => {
      // Arrange
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/retry-test.mp4', name: 'retry-test.mp4', status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin'
      };
      (window as any).localScannedTransModels = ['/model.bin'];

      let shouldFail = true;
      const invokeMock = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'convert_media_file') {
          if (shouldFail) {
            throw new Error('Fatal unhandled media convert crash');
          }
          return Promise.resolve('/retry-test.wav');
        }
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            outputDir: '/out',
            generatedFiles: ['retry-test.srt'],
            durationMs: 1200,
            speedFactor: 1.5
          });
        }
        return Promise.resolve('ok');
      });
      (window as any).invoke = invokeMock;

      const cancelSpan = { setAttribute: vi.fn(), textContent: '' };
      const cancelBtn = {
        style: { display: 'none' },
        disabled: false,
        querySelector: vi.fn().mockReturnValue(cancelSpan)
      };
      const sortSelect = { disabled: false };
      const clearBtn = { disabled: false };
      const fillBar = { style: { width: '0%' }, classList: { remove: vi.fn() } };
      const pctEl = { textContent: '0%', removeAttribute: vi.fn() };
      const msgEl = { textContent: '', removeAttribute: vi.fn(), dataset: {} };

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-cancel-batch') return cancelBtn;
          if (id === 'batch-sort-select') return sortSelect;
          if (id === 'btn-clear-batch') return clearBtn;
          if (id === 'progress-linear-fill') return fillBar;
          if (id === 'lbl-radial-pct') return pctEl;
          if (id === 'lbl-radial-msg') return msgEl;
          return null;
        })
      };

      try {
        // Act 1: Run with failure
        await runBatchExtraction();

        // Assert 1: Flag MUST NOT remain stuck at true
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect((window as any).isBatchExtracting).toBe(false);

        // Act 2: Retry with successful backend
        shouldFail = false;
        batchProcessor.setItems([
          { path: '/retry-test.mp4', name: 'retry-test.mp4', status: 'pending' }
        ]);
        await runBatchExtraction();

        // Assert 2: Second run executed completely without being blocked
        expect(batchProcessor.getItems()[0].status).toBe('completed');
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect(cancelBtn.style.display).toBe('none');
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('marks in-flight converting item as failed, clears pulse dot, and restores viewport on unhandled crash', async () => {
      // Arrange
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/inflight-crash.mp4', name: 'inflight-crash.mp4', status: 'pending' },
        { path: '/pending-next.mp4', name: 'pending-next.mp4', status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin'
      };
      (window as any).localScannedTransModels = ['/model.bin'];

      const cancelSpan = { setAttribute: vi.fn(), textContent: '' };
      const cancelBtn = {
        style: { display: 'none' },
        disabled: false,
        querySelector: vi.fn().mockReturnValue(cancelSpan)
      };
      const sortSelect = { disabled: false };
      const clearBtn = { disabled: false };
      let callCount = 0;
      const fillBar = {
        get style() {
          callCount++;
          if (callCount >= 1) {
            throw new Error('Simulated DOM access crash during active item loop HUD update');
          }
          return { width: '0%' } as any;
        },
        classList: { remove: vi.fn() }
      };
      const pctEl = { textContent: '0%', removeAttribute: vi.fn() };
      const msgEl = { textContent: '', removeAttribute: vi.fn(), dataset: {} };
      const pulseDot = { classList: { add: vi.fn(), remove: vi.fn() } };
      const viewport = {
        innerHTML: '<div id="transcript-placeholder" class="transcript-initializing-state"><div class="transcript-spinner"></div></div>',
        querySelector: vi.fn().mockImplementation((selector: string) => {
          if (selector === '.transcript-initializing-state') return {};
          return null;
        })
      };

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-cancel-batch') return cancelBtn;
          if (id === 'batch-sort-select') return sortSelect;
          if (id === 'btn-clear-batch') return clearBtn;
          if (id === 'progress-linear-fill') return fillBar;
          if (id === 'lbl-radial-pct') return pctEl;
          if (id === 'lbl-radial-msg') return msgEl;
          if (id === 'hud-pulse-dot') return pulseDot;
          if (id === 'transcript-viewport') return viewport;
          return null;
        })
      };

      try {
        // Act
        await runBatchExtraction();

        // Assert
        expect(batchProcessor.getIsExtracting()).toBe(false);
        expect((window as any).isBatchExtracting).toBe(false);
        expect(batchProcessor.getProcessingIndex()).toBe(-1);
        // Active item must NOT remain stuck in 'converting'
        expect(batchProcessor.getItems()[0].status).toBe('failed');
        expect(pulseDot.classList.remove).toHaveBeenCalledWith('active');
        expect(viewport.innerHTML).toContain('transcript-placeholder');
        expect(viewport.innerHTML).not.toContain('transcript-spinner');
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });
  });

  describe('selectBatchItemTranscript', () => {
    it('ignores invalid or out of bounds indices safely', async () => {
      batchProcessor.setItems([{ path: '/test.mp4', name: 'test.mp4', status: 'completed' }]);
      batchProcessor.setActiveViewerIndex(-1);

      await selectBatchItemTranscript(-1);
      expect(batchProcessor.getActiveViewerIndex()).toBe(-1);

      await selectBatchItemTranscript(10);
      expect(batchProcessor.getActiveViewerIndex()).toBe(-1);
    });

    it('notifies when attempting to select a pending item', async () => {
      const showNotificationMock = vi.fn();
      (window as any).showNotification = showNotificationMock;

      batchProcessor.setItems([{ path: '/pending.mp4', name: 'pending.mp4', status: 'pending' }]);
      batchProcessor.setActiveViewerIndex(-1);

      await selectBatchItemTranscript(0);
      expect(batchProcessor.getActiveViewerIndex()).toBe(-1);
      expect(showNotificationMock).toHaveBeenCalled();
    });

    it('selects completed item and updates active viewer index, window output paths, and resets viewport scroll', async () => {
      const renderSpy = vi.spyOn(transcriptViewer, 'render').mockImplementation(() => {});
      batchProcessor.setItems([
        {
          path: '/media/video.mp4',
          name: 'video.mp4',
          status: 'completed',
          subtitlePath: '/media/video.srt',
          transcriptLines: [{ start: '00:00', end: '00:05', text: 'Hello world' }]
        }
      ]);
      batchProcessor.setActiveViewerIndex(-1);

      await selectBatchItemTranscript(0);

      expect(batchProcessor.getActiveViewerIndex()).toBe(0);
      expect((window as any).lastTranscribedVideoPath).toBe('/media/video.mp4');
      expect((window as any).lastTranscribedSubtitlePath).toBe('/media/video.srt');
      expect(renderSpy).toHaveBeenCalledWith(expect.any(Array), false);
      renderSpy.mockRestore();
    });
  });

  describe('batchProcessor window global bindings', () => {
    it('blocks runBatchExtraction when single transcription is already active', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([{ path: '/file.mp4', name: 'file.mp4', status: 'pending' }]);
      (window as any).isTranscribing = true;

      const notifyMock = vi.fn();
      (window as any).showNotification = notifyMock;
      const invokeMock = vi.fn();
      (window as any).invoke = invokeMock;

      await runBatchExtraction();

      expect(invokeMock).not.toHaveBeenCalled();
      expect(notifyMock).toHaveBeenCalled();
      (window as any).isTranscribing = false;
    });

    it('exposes all clean exported functions on window', () => {
      expect(typeof (window as any).removeFileFromBatch).toBe('function');
      expect(typeof (window as any).clearBatchQueue).toBe('function');
      expect(typeof (window as any).moveBatchItemUp).toBe('function');
      expect(typeof (window as any).moveBatchItemDown).toBe('function');
      expect(typeof (window as any).sortBatchQueue).toBe('function');
      expect(typeof (window as any).selectBatchItemTranscript).toBe('function');
      expect(typeof (window as any).runBatchExtraction).toBe('function');
      expect(typeof (window as any).abortBatchExtraction).toBe('function');
    });

    it('synchronizes batchItems and selectedMediaFiles reactively', () => {
      (window as any).batchItems = [{ path: '/item.mp4', name: 'item.mp4', status: 'pending' }];
      expect(batchProcessor.getItems()).toHaveLength(1);
      expect(batchProcessor.getItems()[0].name).toBe('item.mp4');

      (window as any).selectedMediaFiles = ['/a.mp4', '/b.mp4'];
      expect(batchProcessor.getSelectedFiles()).toEqual(['/a.mp4', '/b.mp4']);
    });
  });
});
