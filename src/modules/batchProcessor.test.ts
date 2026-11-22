import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { transcriptViewer } from './transcriptViewer';
import { logsController } from './logsController';
import { updateTranscribeActionButtons, updateTranscribeWorkflowButtons } from './workflowBridge';
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

    it('guards against attempting to select a pending item', async () => {
      batchProcessor.setItems([{ path: '/pending.mp4', name: 'pending.mp4', status: 'pending' }]);
      batchProcessor.setActiveViewerIndex(-1);

      await selectBatchItemTranscript(0);
      expect(batchProcessor.getActiveViewerIndex()).toBe(-1);
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

    it('pre-skips batch items shorter than settings.offsetT without calling FFmpeg or Whisper', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/short.mp4', name: 'short.mp4', durationSec: 25, status: 'pending' },
        { path: '/long.mp4', name: 'long.mp4', durationSec: 120, status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin',
        offsetT: 60_000,
        duration: 0
      };
      (window as any).localScannedTransModels = ['/model.bin'];
      const notifyMock = vi.fn();
      (window as any).showNotification = notifyMock;

      const convertedPaths: string[] = [];
      (window as any).invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'convert_media_file') {
          convertedPaths.push(args.filePath);
          return Promise.resolve('/tmp/long.wav');
        }
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            outputDir: '/out',
            generatedFiles: ['long.srt'],
            durationMs: 1000,
            speedFactor: 2.0
          });
        }
        return Promise.resolve('ok');
      });

      const msgEl = { textContent: '', removeAttribute: vi.fn(), setAttribute: vi.fn(), dataset: {} as Record<string, string> };
      const fillBar = { style: { width: '0%' }, classList: { remove: vi.fn() } };
      const pctEl = { textContent: '0%', removeAttribute: vi.fn() };
      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'lbl-radial-msg') return msgEl;
          if (id === 'progress-linear-fill') return fillBar;
          if (id === 'lbl-radial-pct') return pctEl;
          return null;
        })
      };

      const pushLogSpy = vi.spyOn(logsController, 'push');
      const appendLogSpy = vi.spyOn(logsController, 'appendLogToViewport');
      const updateBtnsSpy = vi.spyOn(logsController, 'scheduleUpdateButtons');
      try {
        await runBatchExtraction();

        expect(convertedPaths).toEqual(['/long.mp4']);
        expect(batchProcessor.getItems()[0].status).toBe('skipped');
        expect(batchProcessor.getItems()[1].status).toBe('completed');
        expect(msgEl.dataset.batchSummarySkipped).toBe('1');
        expect(notifyMock).toHaveBeenCalledWith(expect.any(String), 'info');
        const skipLogCall = pushLogSpy.mock.calls.find(
          ([entry]) => entry?.category === 'Batch' && String(entry.message).includes('short.mp4')
        );
        expect(skipLogCall).toBeDefined();
        expect(skipLogCall?.[0].timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(skipLogCall?.[0].message).toContain('01:00');
        expect(skipLogCall?.[0].message).not.toContain('{start}');
        expect(appendLogSpy).toHaveBeenCalledWith(skipLogCall?.[0]);
        expect(updateBtnsSpy).toHaveBeenCalled();
      } finally {
        pushLogSpy.mockRestore();
        appendLogSpy.mockRestore();
        updateBtnsSpy.mockRestore();
        (globalThis as any).document = prevDoc;
      }
    });

    it('snapshots settings at batch start so mid-run mutations do not alter queued items or mutate global inputFile', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/first.mp4', name: 'first.mp4', durationSec: 120, status: 'pending' },
        { path: '/second.mp4', name: 'second.mp4', durationSec: 120, status: 'pending' }
      ]);
      const liveSettings: any = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin',
        inputFile: '/original.mp4',
        offsetT: 10_000,
        duration: 20_000,
        outputSrt: true,
        outputTxt: false
      };
      (window as any).settingsState = liveSettings;
      (window as any).localScannedTransModels = ['/model.bin'];
      (window as any).showNotification = vi.fn();

      const capturedTaskSettings: any[] = [];
      (window as any).invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'convert_media_file') {
          return Promise.resolve(`/tmp/${args.filePath.replace('/', '')}.wav`);
        }
        if (cmd === 'start_transcription_task') {
          capturedTaskSettings.push({ ...args.settings });
          // Simulate user toggling quick settings while the first batch file is running
          if (capturedTaskSettings.length === 1) {
            liveSettings.offsetT = 90_000;
            liveSettings.outputTxt = true;
          }
          return Promise.resolve({
            outputDir: '/out',
            generatedFiles: ['out.srt'],
            durationMs: 500,
            speedFactor: 4.0
          });
        }
        return Promise.resolve('ok');
      });

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = { getElementById: vi.fn().mockReturnValue(null) };

      try {
        await runBatchExtraction();

        expect(capturedTaskSettings).toHaveLength(2);
        expect(capturedTaskSettings[0].inputFile).toBe('/first.mp4');
        expect(capturedTaskSettings[1].inputFile).toBe('/second.mp4');
        expect(capturedTaskSettings[1].offsetT).toBe(10_000);
        expect(capturedTaskSettings[1].outputTxt).toBe(false);
        expect(liveSettings.inputFile).toBe('/original.mp4');
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('assigns async probed durations by item reference even if queue is sorted mid-probe and aborts on clear', async () => {
      const resolvers: Record<string, (val: any) => void> = {};
      (window as any).invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file') {
          return new Promise(resolve => {
            resolvers[args.filePath] = resolve;
          });
        }
        return Promise.resolve('ok');
      });

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = { getElementById: vi.fn().mockReturnValue(null) };

      try {
        await addBatchFiles(['/z_short.mp4', '/a_long.mp4']);

        // Sort alphabetically while first probe is still in flight: order becomes [a_long, z_short]
        sortBatchQueue('name-asc');
        expect(batchProcessor.getItems().map(i => i.path)).toEqual(['/a_long.mp4', '/z_short.mp4']);

        // Resolve first probe (/z_short.mp4 -> 15s), then second (/a_long.mp4 -> 300s)
        resolvers['/z_short.mp4']({ exists: true, size: '1 MB', durationSec: 15 });
        await Promise.resolve();
        await Promise.resolve();
        resolvers['/a_long.mp4']({ exists: true, size: '20 MB', durationSec: 300 });
        await Promise.resolve();
        await Promise.resolve();

        const items = batchProcessor.getItems();
        expect(items.find(i => i.path === '/z_short.mp4')?.durationSec).toBe(15);
        expect(items.find(i => i.path === '/a_long.mp4')?.durationSec).toBe(300);

        // Now start a new batch probe and immediately clear queue before it resolves
        await addBatchFiles(['/x.mp4', '/y.mp4']);
        clearBatchQueue();
        resolvers['/x.mp4']?.({ exists: true, size: '2 MB', durationSec: 50 });
        await Promise.resolve();
        await Promise.resolve();
        expect(batchProcessor.getIsBatchMode()).toBe(false);
        expect(batchProcessor.getItems()).toHaveLength(0);
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('probes unknown duration on-demand during runBatchExtraction when offsetT > 0 and skips short files', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/unprobed_short.mp4', name: 'unprobed_short.mp4', durationSec: null, status: 'pending' },
        { path: '/unprobed_long.mp4', name: 'unprobed_long.mp4', durationSec: null, status: 'pending' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin',
        offsetT: 60_000,
        duration: 0,
        outputSrt: true
      };
      (window as any).localScannedTransModels = ['/model.bin'];
      (window as any).showNotification = vi.fn();

      const convertedPaths: string[] = [];
      (window as any).invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file') {
          if (args.filePath === '/unprobed_short.mp4') {
            return Promise.resolve({ exists: true, size: '1 MB', durationSec: 20 });
          }
          return Promise.resolve({ exists: true, size: '10 MB', durationSec: 180 });
        }
        if (cmd === 'convert_media_file') {
          convertedPaths.push(args.filePath);
          return Promise.resolve('/tmp/long.wav');
        }
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            outputDir: '/out',
            generatedFiles: ['unprobed_long.srt'],
            durationMs: 1000,
            speedFactor: 2.0
          });
        }
        return Promise.resolve('ok');
      });

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = { getElementById: vi.fn().mockReturnValue(null) };

      try {
        await runBatchExtraction();
        expect(convertedPaths).toEqual(['/unprobed_long.mp4']);
        expect(batchProcessor.getItems()[0].status).toBe('skipped');
        expect(batchProcessor.getItems()[0].durationSec).toBe(20);
        expect(batchProcessor.getItems()[1].status).toBe('completed');
        expect(batchProcessor.getItems()[1].durationSec).toBe(180);
      } finally {
        (globalThis as any).document = prevDoc;
      }
    });

    it('resets stale item statuses on re-run and uses warning status badge when all batch items are skipped', async () => {
      batchProcessor.setIsBatchMode(true);
      batchProcessor.setItems([
        { path: '/short_a.mp4', name: 'short_a.mp4', durationSec: null, status: 'completed' },
        { path: '/short_b.mp4', name: 'short_b.mp4', durationSec: null, status: 'failed' }
      ]);
      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: '/model.bin',
        offsetT: 60_000,
        duration: 0,
        outputSrt: true
      };
      (window as any).localScannedTransModels = ['/model.bin'];
      (window as any).showNotification = vi.fn();
      const badgeMock = vi.fn();
      const prevBadge = (window as any).setTranscribeStatusBadge;
      (window as any).setTranscribeStatusBadge = badgeMock;

      let observedSecondItemStatusDuringFirstProbe: string | undefined;
      (window as any).invoke = vi.fn((cmd: string, args: any) => {
        if (cmd === 'probe_media_file') {
          if (args.filePath === '/short_a.mp4') {
            observedSecondItemStatusDuringFirstProbe = batchProcessor.getItems()[1].status;
          }
          return Promise.resolve({ exists: true, size: '1 MB', durationSec: 15 });
        }
        return Promise.resolve('ok');
      });

      const prevDoc = (globalThis as any).document;
      (globalThis as any).document = { getElementById: vi.fn().mockReturnValue(null) };

      try {
        await runBatchExtraction();
        // Stale 'failed' badge must be cleared to 'pending' before processing starts
        expect(observedSecondItemStatusDuringFirstProbe).toBe('pending');
        expect(batchProcessor.getItems().map(i => i.status)).toEqual(['skipped', 'skipped']);
        // All-skipped batch must display warning badge instead of green 'complete'
        expect(badgeMock).toHaveBeenLastCalledWith('warning', 'transcribe.statusSkipped');
      } finally {
        (window as any).setTranscribeStatusBadge = prevBadge;
        (globalThis as any).document = prevDoc;
      }
    });

    it('enables #btn-run-batch and updates its tooltip immediately when entering batch mode with 2+ files', async () => {
      const attrs: Record<string, string> = { 'data-i18n-title': 'toasts.noFileSelected' };
      const btnBatchSpan = {
        textContent: '',
        setAttribute: vi.fn()
      };
      const btnBatch: any = {
        disabled: true,
        title: 'Please select an audio or video file first.',
        style: { display: 'none' },
        querySelector: vi.fn().mockReturnValue(btnBatchSpan),
        setAttribute: vi.fn((k: string, v: string) => { attrs[k] = v; }),
        getAttribute: vi.fn((k: string) => attrs[k] ?? null)
      };
      const batchControlsBox = { style: { display: 'none' } };
      const singleActions = { style: { display: 'flex' } };

      const prevDoc = (globalThis as any).document;
      const prevUpdateActionBtns = (window as any).updateTranscribeActionButtons;
      (globalThis as any).document = {
        getElementById: vi.fn().mockImplementation((id: string) => {
          if (id === 'btn-run-batch') return btnBatch;
          if (id === 'batch-controls-box') return batchControlsBox;
          if (id === 'single-transcribe-actions') return singleActions;
          return null;
        })
      };
      (window as any).updateTranscribeActionButtons = updateTranscribeActionButtons;
      (window as any).invoke = vi.fn().mockResolvedValue({ exists: true, size: '5 MB', durationSec: 90 });

      try {
        await addBatchFiles(['/clip1.mp4', '/clip2.mp4']);

        expect(batchProcessor.getIsBatchMode()).toBe(true);
        expect(batchProcessor.getItems()).toHaveLength(2);
        expect(btnBatch.style.display).toBe('inline-flex');
        expect(btnBatch.disabled).toBe(false);
        expect(attrs['data-i18n-title']).toBe('transcribe.startBatchAiExtraction');
        expect(btnBatch.title).not.toContain('select an audio or video file');
      } finally {
        clearBatchQueue();
        (window as any).updateTranscribeActionButtons = prevUpdateActionBtns;
        (globalThis as any).document = prevDoc;
      }
    });

    it('clears stale single-file probedMetadata on Single -> Batch -> Clear so empty deck trim slider stays disabled', async () => {
      const prevDoc = (globalThis as any).document;
      const prevProbed = (window as any).probedMetadata;
      const prevSelected = (window as any).selectedMediaFile;
      const prevInvoke = (window as any).invoke;

      const makeEl = (tag: string, id: string) => {
        const classes = new Set<string>();
        const el: any = {
          tagName: tag,
          id,
          style: {},
          value: '',
          placeholder: '',
          max: '100',
          disabled: true,
          checked: false,
          textContent: '',
          dataset: {},
          classList: {
            add: (...c: string[]) => c.forEach(x => classes.add(x)),
            remove: (...c: string[]) => c.forEach(x => classes.delete(x)),
            toggle: (c: string, force?: boolean) => (force ?? !classes.has(c) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c)
          },
          setAttribute: vi.fn(),
          removeAttribute: vi.fn(),
          closest: () => null
        };
        return el;
      };

      const sliderWrap = makeEl('DIV', 'quick-range-slider-wrap');
      const startSlider = makeEl('INPUT', 'quick-range-slider-start');
      const endSlider = makeEl('INPUT', 'quick-range-slider-end');
      const endInput = makeEl('INPUT', 'quick-range-end');
      const fillEl = makeEl('DIV', 'quick-range-fill');
      const els: Record<string, any> = {
        'quick-range-slider-wrap': sliderWrap,
        'quick-range-slider-start': startSlider,
        'quick-range-slider-end': endSlider,
        'quick-range-end': endInput,
        'quick-range-fill': fillEl
      };

      (globalThis as any).document = {
        getElementById: (id: string) => els[id] || null,
        querySelector: () => null,
        querySelectorAll: () => []
      };
      (window as any).invoke = vi.fn().mockResolvedValue({ exists: true, durationSec: 30, size: '1 MB' });

      try {
        // Simulate prior single file with 120s probedMetadata
        (window as any).selectedMediaFile = '/media/prior_single.mp4';
        (window as any).probedMetadata = { exists: true, durationSec: 120 };

        // Enter Batch Mode -> must clear stale single-file probedMetadata immediately
        await addBatchFiles(['/media/b1.mp4', '/media/b2.mp4']);
        expect((window as any).probedMetadata).toBeNull();

        // Clear Batch Queue -> empty deck must keep trim slider disabled and End placeholder '--:--'
        clearBatchQueue();
        expect((window as any).probedMetadata).toBeNull();
        expect(sliderWrap.classList.contains('is-disabled')).toBe(true);
        expect(startSlider.disabled).toBe(true);
        expect(endSlider.disabled).toBe(true);
        expect(endInput.placeholder).toBe('--:--');
      } finally {
        (window as any).probedMetadata = prevProbed;
        (window as any).selectedMediaFile = prevSelected;
        (window as any).invoke = prevInvoke;
        (globalThis as any).document = prevDoc;
      }
    });

    it('seeks companion player to first sliced segment startMs when selecting a completed batch item', async () => {
      const prevLoad = (window as any).loadMediaIntoCompanionPlayer;
      const prevSeek = (window as any).seekCompanionPlayer;
      const loadMock = vi.fn().mockResolvedValue(true);
      const seekMock = vi.fn();
      (window as any).loadMediaIntoCompanionPlayer = loadMock;
      (window as any).seekCompanionPlayer = seekMock;

      try {
        batchProcessor.setIsBatchMode(true);
        batchProcessor.setItems([
          {
            path: '/media/sliced_batch.mp4',
            name: 'sliced_batch.mp4',
            durationSec: 180,
            status: 'completed',
            subtitlePath: '/media/sliced_batch.srt',
            outputDir: '/media',
            outputFiles: [{ path: '/media/sliced_batch.srt', name: 'sliced_batch.srt', type: 'subtitle' }],
            transcriptLines: [
              { id: 1, startMs: 45_000, endMs: 50_000, text: 'Batch sliced line' }
            ]
          }
        ]);

        await selectBatchItemTranscript(0);
        await Promise.resolve();

        expect(loadMock).toHaveBeenCalledWith('/media/sliced_batch.mp4', false, 180);
        expect(seekMock).toHaveBeenCalledWith(45_000, false, 1, false);
      } finally {
        clearBatchQueue();
        (window as any).loadMediaIntoCompanionPlayer = prevLoad;
        (window as any).seekCompanionPlayer = prevSeek;
      }
    });

    it('clears #batch-queue-body DOM and aborts in-flight selectBatchItemTranscript loads when clearBatchQueue is called', async () => {
      // Arrange
      const prevDoc = (globalThis as any).document;
      const prevInvoke = (window as any).invoke;
      const prevLoad = (window as any).loadMediaIntoCompanionPlayer;
      const loadMock = vi.fn().mockResolvedValue(true);
      (window as any).loadMediaIntoCompanionPlayer = loadMock;

      let resolveSessionJson!: (val: string) => void;
      (window as any).invoke = vi.fn((cmd: string) => {
        if (cmd === 'get_transcript_session_data') {
          return new Promise<string>(resolve => {
            resolveSessionJson = resolve;
          });
        }
        return Promise.resolve(null);
      });

      const queueBody = { innerHTML: '<div class="batch-queue-card">Stale Card</div>' };
      const countChip = { textContent: '2' };
      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'batch-queue-body') return queueBody;
          if (id === 'lbl-batch-count') return countChip;
          return null;
        },
        querySelector: () => null,
        querySelectorAll: () => []
      };

      try {
        batchProcessor.setIsBatchMode(true);
        batchProcessor.setItems([
          {
            path: '/media/inflight.mp4',
            name: 'inflight.mp4',
            status: 'completed',
            internalJsonPath: '/tmp/inflight_session.json'
          }
        ]);

        // Act: start async transcript selection, then clear queue before IPC resolves
        const selectTask = selectBatchItemTranscript(0);
        clearBatchQueue();

        expect(queueBody.innerHTML).toBe('');
        expect(countChip.textContent).toBe('0');

        resolveSessionJson(
          JSON.stringify({
            transcription: [
              { timestamps: { from: '00:00:01,000', to: '00:00:03,000' }, offsets: { from: 1000, to: 3000 }, text: 'Stale cue' }
            ]
          })
        );
        await selectTask;

        // Assert: stale in-flight load must not repopulate viewer or companion player after clear
        expect(batchProcessor.getActiveViewerIndex()).toBe(-1);
        expect(loadMock).not.toHaveBeenCalled();
        expect((window as any).lastTranscribedVideoPath).toBeNull();
      } finally {
        (window as any).loadMediaIntoCompanionPlayer = prevLoad;
        (window as any).invoke = prevInvoke;
        (globalThis as any).document = prevDoc;
      }
    });

    it('keeps #btn-copy-transcript enabled after a 2-file batch completes without manual item switching', async () => {
      // Arrange
      const prevDoc = (globalThis as any).document;
      const prevInvoke = (window as any).invoke;
      const prevWorkflowBtns = (window as any).updateTranscribeWorkflowButtons;
      const prevModels = (window as any).localScannedTransModels;
      const prevSettings = (window as any).settingsState;

      const btnCopy: any = { disabled: true };
      const viewport: any = {
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        appendChild: vi.fn(),
        querySelector: () => null,
        querySelectorAll: () => []
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'btn-copy-transcript') return btnCopy;
          if (id === 'transcript-viewport') return viewport;
          return null;
        },
        createElement: () => ({
          className: '',
          style: {},
          dataset: {},
          setAttribute: vi.fn(),
          removeAttribute: vi.fn(),
          addEventListener: vi.fn(),
          appendChild: vi.fn(),
          querySelector: () => null,
          classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: () => false }
        }),
        createDocumentFragment: () => ({ appendChild: vi.fn() }),
        querySelector: () => null,
        querySelectorAll: () => []
      };

      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: 'ggml-base.en.bin',
        outputDirMode: 'source'
      };
      (window as any).localScannedTransModels = ['ggml-base.en.bin'];
      (window as any).updateTranscribeWorkflowButtons = updateTranscribeWorkflowButtons;

      (window as any).invoke = vi.fn((cmd: string, args?: any) => {
        if (cmd === 'convert_media_file') {
          return Promise.resolve(`${args.filePath}.wav`);
        }
        if (cmd === 'start_transcription_task') {
          const isSecond = String(args?.wavPath || '').includes('second.mp4');
          return Promise.resolve({
            internalJsonPath: isSecond ? '/tmp/second.json' : '/tmp/first.json',
            outputDir: '/media',
            generatedFiles: [isSecond ? 'second.srt' : 'first.srt'],
            durationMs: 1200,
            speedFactor: 4.5
          });
        }
        if (cmd === 'get_transcript_session_data') {
          const isSecond = String(args?.sessionFile || '').includes('second.json');
          return Promise.resolve(
            JSON.stringify({
              transcription: [
                {
                  timestamps: { from: '00:00:00,000', to: '00:00:02,000' },
                  offsets: { from: 0, to: 2000 },
                  text: isSecond ? 'Second file transcript line' : 'First file transcript line'
                }
              ]
            })
          );
        }
        return Promise.resolve(null);
      });

      try {
        batchProcessor.setIsBatchMode(true);
        batchProcessor.setItems([
          { path: '/media/first.mp4', name: 'first.mp4', durationSec: 10, status: 'pending' },
          { path: '/media/second.mp4', name: 'second.mp4', durationSec: 12, status: 'pending' }
        ]);

        // Act
        await runBatchExtraction();

        // Assert
        expect(batchProcessor.getItems().map(i => i.status)).toEqual(['completed', 'completed']);
        expect(batchProcessor.getActiveViewerIndex()).toBe(1);
        expect(transcriptViewer.lines).toHaveLength(1);
        expect(transcriptViewer.lines[0].text).toBe('Second file transcript line');
        expect(btnCopy.disabled).toBe(false);
      } finally {
        clearBatchQueue();
        (window as any).updateTranscribeWorkflowButtons = prevWorkflowBtns;
        (window as any).localScannedTransModels = prevModels;
        (window as any).settingsState = prevSettings;
        (window as any).invoke = prevInvoke;
        (globalThis as any).document = prevDoc;
      }
    });

    it('disables #btn-copy-transcript after batch completion when the viewed item produces zero segments', async () => {
      // Arrange
      const prevDoc = (globalThis as any).document;
      const prevInvoke = (window as any).invoke;
      const prevWorkflowBtns = (window as any).updateTranscribeWorkflowButtons;
      const prevModels = (window as any).localScannedTransModels;
      const prevSettings = (window as any).settingsState;

      const btnCopy: any = { disabled: false };
      const viewport: any = {
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        appendChild: vi.fn(),
        querySelector: () => null,
        querySelectorAll: () => []
      };

      (globalThis as any).document = {
        getElementById: (id: string) => {
          if (id === 'btn-copy-transcript') return btnCopy;
          if (id === 'transcript-viewport') return viewport;
          return null;
        },
        querySelector: () => null,
        querySelectorAll: () => []
      };

      (window as any).settingsState = {
        selectedBackend: 'Standard',
        modelPath: 'ggml-base.en.bin',
        outputDirMode: 'source'
      };
      (window as any).localScannedTransModels = ['ggml-base.en.bin'];
      (window as any).updateTranscribeWorkflowButtons = updateTranscribeWorkflowButtons;

      (window as any).invoke = vi.fn((cmd: string) => {
        if (cmd === 'convert_media_file') return Promise.resolve('/media/silent.mp4.wav');
        if (cmd === 'start_transcription_task') {
          return Promise.resolve({
            internalJsonPath: null,
            outputDir: '/media',
            generatedFiles: ['silent.srt'],
            durationMs: 500,
            speedFactor: 10.0
          });
        }
        if (cmd === 'read_text_file_content') return Promise.resolve('');
        return Promise.resolve(null);
      });

      try {
        batchProcessor.setIsBatchMode(true);
        batchProcessor.setItems([
          { path: '/media/silent.mp4', name: 'silent.mp4', durationSec: 5, status: 'pending' }
        ]);

        // Act
        await runBatchExtraction();

        // Assert
        expect(batchProcessor.getItems()[0].status).toBe('completed');
        expect(transcriptViewer.lines).toHaveLength(0);
        expect(btnCopy.disabled).toBe(true);
      } finally {
        clearBatchQueue();
        (window as any).updateTranscribeWorkflowButtons = prevWorkflowBtns;
        (window as any).localScannedTransModels = prevModels;
        (window as any).settingsState = prevSettings;
        (window as any).invoke = prevInvoke;
        (globalThis as any).document = prevDoc;
      }
    });
  });
});
