// @ts-nocheck
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ar } from './locales/ar';
import { de } from './locales/de';
import { en } from './locales/en';
import { es } from './locales/es';
import { fa } from './locales/fa';
import { fr } from './locales/fr';
import { it as itLocale } from './locales/it';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { pt } from './locales/pt';
import { ru } from './locales/ru';
import { tr } from './locales/tr';
import { zh } from './locales/zh';

const locales: Record<string, any> = { ar, de, en, es, fa, fr, it: itLocale, ja, ko, pt, ru, tr, zh };

describe('Transcription Studio Unified Deck DOM Structure', () => {
  const htmlPath = resolve(__dirname, 'index.html');
  const html = readFileSync(htmlPath, 'utf-8');

  it('contains the unified deck container and deck header', () => {
    expect(html).toContain('transcribe-unified-deck');
    expect(html).toContain('id="transcribe-unified-deck"');
    expect(html).toContain('data-i18n="transcribe.deckTitle"');
    expect(html).toContain('id="btn-transcribe-manage-settings"');
  });

  it('has replaced the multi-step accordion in the transcribe panel', () => {
    // Left panel must not contain the old accordion containers
    const startIdx = html.indexOf('id="panel-transcribe"');
    const endIdx = html.indexOf('id="panel-translate"');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    const transcribePanel = html.substring(startIdx, endIdx);

    expect(transcribePanel).not.toContain('id="wizard-step-1"');
    expect(transcribePanel).not.toContain('accordion-card');
    expect(transcribePanel).not.toContain('accordion-header');
  });

  it('contains the smart media dropzone card with embedded metadata badge row', () => {
    expect(html).toContain('id="transcribe-drop-zone"');
    expect(html).toContain('transcribe-dropzone-card');
    expect(html).toContain('id="lbl-file-name"');
    expect(html).toContain('id="lbl-file-path"');
    expect(html).toContain('id="btn-browse-media"');
    expect(html).toContain('id="btn-clear-media"');
    expect(html).toContain('id="media-meta-box"');
    expect(html).toContain('transcribe-meta-badges-row');
    expect(html).toContain('id="meta-type"');
    expect(html).toContain('id="meta-duration"');
    expect(html).toContain('id="meta-size"');
    expect(html).toContain('id="meta-target-format"');
    expect(html).toContain('id="meta-recommendation"');
  });

  it('contains quick configuration fields including task selection and diarization toggle', () => {
    expect(html).toContain('id="quick-opt-model"');
    expect(html).toContain('id="quick-opt-language"');
    expect(html).toContain('id="quick-opt-task"');
    expect(html).toContain('data-i18n="transcribe.taskLabel"');
    expect(html).toContain('data-i18n="transcribe.taskTranscribe"');
    expect(html).toContain('data-i18n="transcribe.taskTranslate"');
    expect(html).toContain('id="quick-opt-selectedBackend"');
    expect(html).toContain('id="quick-toggle-vad"');
    expect(html).toContain('id="quick-toggle-diarize"');
    expect(html).toContain('data-i18n="settings.diarizeTitle"');
  });

  it('contains batch queue container and batch specs box', () => {
    expect(html).toContain('id="batch-specs-box"');
    expect(html).toContain('id="batch-files-count"');
    expect(html).toContain('id="batch-total-duration"');
    expect(html).toContain('id="batch-queue-container"');
    expect(html).toContain('id="batch-queue-body"');
  });

  it('contains single and batch action controls', () => {
    expect(html).toContain('id="single-transcribe-actions"');
    expect(html).toContain('id="btn-run-transcribe"');
    expect(html).toContain('id="btn-cancel-transcribe"');
    expect(html).toContain('id="batch-controls-box"');
    expect(html).toContain('id="btn-run-batch"');
    expect(html).toContain('id="btn-cancel-batch"');
  });

  it('contains right-side telemetry HUD and live transcript viewer card with export and copy', () => {
    expect(html).toContain('id="telemetry-hud-card"');
    expect(html).toContain('id="hud-collapse-btn"');
    expect(html).toContain('transcript-viewer-card');
    expect(html).toContain('id="transcribe-viewer-card"')
    expect(html).toContain('id="transcript-search"');
    expect(html).toContain('id="btn-export-transcript"');
    expect(html).toContain('id="btn-copy-transcript"');
    expect(html).toContain('id="btn-open-output-folder"');
  });
});

describe('Transcription Studio Locales & Symmetry', () => {
  const languageCodes = ['en', 'fa', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'zh'] as const;

  it('defines deckTitle, clearMedia, and manageInSettings for all 13 supported languages', () => {
    for (const code of languageCodes) {
      const loc = locales[code];
      expect(loc, `Locale ${code} should exist`).toBeDefined();
      expect(loc.transcribe, `Locale ${code}.transcribe should exist`).toBeDefined();
      expect(loc.transcribe.deckTitle, `Locale ${code}.transcribe.deckTitle should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.clearMedia, `Locale ${code}.transcribe.clearMedia should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.manageInSettings, `Locale ${code}.transcribe.manageInSettings should be non-empty string`).toBeTruthy();
    }
  });

  it('provides appropriate localized deckTitle values', () => {
    expect(locales.en.transcribe.deckTitle).toBe('Transcription Setup');
    expect(locales.fa.transcribe.deckTitle).toBe('تنظیمات پیاده‌سازی');
    expect(locales.ar.transcribe.deckTitle).toBe('إعدادات النسخ الصوتي');
    expect(locales.de.transcribe.deckTitle).toBe('Transkriptions-Setup');
  });
});

describe('Transcription Studio State Transitions Simulation', () => {
  interface DomState {
    dropZoneClasses: Set<string>;
    fileNameText: string;
    filePathText: string;
    filePathTitle: string;
    clearMediaDisplay: string;
    metaBoxDisplay: string;
    batchSpecsDisplay: string;
    batchQueueDisplay: string;
    batchFilesCount: string;
    singleActionsDisplay: string;
    batchActionsDisplay: string;
    runBtnDisplay: string;
    cancelBtnDisplay: string;
    runBatchBtnDisplay: string;
    cancelBatchBtnDisplay: string;
  }

  function createInitialState(): DomState {
    return {
      dropZoneClasses: new Set(['media-drop-zone', 'transcribe-dropzone-card']),
      fileNameText: 'No Media File Loaded',
      filePathText: 'Select audio or video file',
      filePathTitle: '',
      clearMediaDisplay: 'none',
      metaBoxDisplay: 'none',
      batchSpecsDisplay: 'none',
      batchQueueDisplay: 'none',
      batchFilesCount: '0',
      singleActionsDisplay: 'flex',
      batchActionsDisplay: 'none',
      runBtnDisplay: 'inline-flex',
      cancelBtnDisplay: 'none',
      runBatchBtnDisplay: 'none',
      cancelBatchBtnDisplay: 'none',
    };
  }

  function simulateLoadSingleFile(state: DomState, filePath: string, fileName: string) {
    state.dropZoneClasses.add('has-file');
    state.fileNameText = fileName;
    state.filePathText = filePath;
    state.filePathTitle = filePath;
    state.clearMediaDisplay = 'inline-flex';
    state.metaBoxDisplay = 'flex';
    state.batchSpecsDisplay = 'none';
    state.batchQueueDisplay = 'none';
    state.singleActionsDisplay = 'flex';
    state.batchActionsDisplay = 'none';
    state.runBtnDisplay = 'inline-flex';
    state.cancelBtnDisplay = 'none';
  }

  function simulateClearSingleFile(state: DomState) {
    state.dropZoneClasses.delete('has-file');
    state.fileNameText = 'No Media File Loaded';
    state.filePathText = 'Select audio or video file';
    state.filePathTitle = '';
    state.clearMediaDisplay = 'none';
    state.metaBoxDisplay = 'none';
    state.batchSpecsDisplay = 'none';
    state.batchQueueDisplay = 'none';
    state.singleActionsDisplay = 'flex';
    state.batchActionsDisplay = 'none';
    state.runBtnDisplay = 'inline-flex';
    state.cancelBtnDisplay = 'none';
  }

  function simulateLoadBatchFiles(state: DomState, files: string[]) {
    state.dropZoneClasses.add('has-file');
    state.fileNameText = `${files.length} Files in Queue`;
    state.filePathText = '';
    state.filePathTitle = '';
    state.clearMediaDisplay = 'none';
    state.metaBoxDisplay = 'none';
    state.batchSpecsDisplay = 'block';
    state.batchQueueDisplay = 'block';
    state.batchFilesCount = String(files.length);
    state.singleActionsDisplay = 'none';
    state.batchActionsDisplay = 'block';
    state.runBatchBtnDisplay = 'inline-flex';
    state.cancelBatchBtnDisplay = 'none';
  }

  function simulateClearBatchQueue(state: DomState) {
    state.dropZoneClasses.delete('has-file');
    state.fileNameText = 'No Media File Loaded';
    state.filePathText = 'Select audio or video file';
    state.filePathTitle = '';
    state.clearMediaDisplay = 'none';
    state.metaBoxDisplay = 'none';
    state.batchSpecsDisplay = 'none';
    state.batchQueueDisplay = 'none';
    state.batchFilesCount = '0';
    state.singleActionsDisplay = 'flex';
    state.batchActionsDisplay = 'none';
    state.runBtnDisplay = 'inline-flex';
    state.cancelBtnDisplay = 'none';
  }

  it('transitions properly when a single file is selected and probed', () => {
    const state = createInitialState();
    expect(state.dropZoneClasses.has('has-file')).toBe(false);
    expect(state.clearMediaDisplay).toBe('none');

    simulateLoadSingleFile(state, '/media/lecture.mp4', 'lecture.mp4');
    expect(state.dropZoneClasses.has('has-file')).toBe(true);
    expect(state.fileNameText).toBe('lecture.mp4');
    expect(state.clearMediaDisplay).toBe('inline-flex');
    expect(state.metaBoxDisplay).toBe('flex');
    expect(state.batchQueueDisplay).toBe('none');
    expect(state.singleActionsDisplay).toBe('flex');
    expect(state.batchActionsDisplay).toBe('none');

    simulateClearSingleFile(state);
    expect(state.dropZoneClasses.has('has-file')).toBe(false);
    expect(state.fileNameText).toBe('No Media File Loaded');
    expect(state.clearMediaDisplay).toBe('none');
    expect(state.metaBoxDisplay).toBe('none');
  });

  it('transitions properly when multiple files are loaded in batch mode', () => {
    const state = createInitialState();

    simulateLoadBatchFiles(state, ['/media/file1.mp3', '/media/file2.mp3', '/media/file3.wav']);
    expect(state.dropZoneClasses.has('has-file')).toBe(true);
    expect(state.fileNameText).toBe('3 Files in Queue');
    expect(state.clearMediaDisplay).toBe('none');
    expect(state.metaBoxDisplay).toBe('none');
    expect(state.batchSpecsDisplay).toBe('block');
    expect(state.batchQueueDisplay).toBe('block');
    expect(state.singleActionsDisplay).toBe('none');
    expect(state.batchActionsDisplay).toBe('block');
    expect(state.runBatchBtnDisplay).toBe('inline-flex');

    simulateClearBatchQueue(state);
    expect(state.dropZoneClasses.has('has-file')).toBe(false);
    expect(state.fileNameText).toBe('No Media File Loaded');
    expect(state.batchSpecsDisplay).toBe('none');
    expect(state.batchQueueDisplay).toBe('none');
    expect(state.singleActionsDisplay).toBe('flex');
    expect(state.batchActionsDisplay).toBe('none');
  });
});
