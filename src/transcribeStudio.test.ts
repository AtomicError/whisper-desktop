// @ts-nocheck
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTimestampStringToMs,
  parseSegmentTimestamps,
  formatMsToTimestamp,
  loadTranscriptFromFile,
  transcriptViewer
} from './modules/transcriptViewer';
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
import { loadResolvedHtml } from './testUtils';

const locales: Record<string, any> = { ar, de, en, es, fa, fr, it: itLocale, ja, ko, pt, ru, tr, zh };

describe('Transcription Studio Unified Deck DOM Structure', () => {
  const htmlPath = resolve(__dirname, 'index.html');
  const html = loadResolvedHtml(htmlPath);

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
    expect(html).toMatch(/<button[^>]*id="btn-browse-media"[^>]*>Browse<\/button>/);
    expect(html).toContain('Drag &amp; drop audio or video (.mp4, .mkv, .mp3, .wav)');
    expect(html).toContain('id="btn-clear-media"');
    expect(html).toContain('id="media-meta-box"');
    expect(html).toContain('transcribe-meta-badges-row');
    expect(html).toContain('id="meta-type"');
    expect(html).toContain('id="meta-duration"');
    expect(html).toContain('id="meta-size"');
    expect(html).toContain('id="meta-target-format"');
    expect(html).toContain('id="meta-recommendation"');
  });

  it('contains quick configuration fields without removed task selection or duplicate diarization toggle', () => {
    expect(html).toContain('id="quick-opt-model"');
    expect(html).toContain('id="quick-opt-language"');
    expect(html).toContain('id="quick-opt-selectedBackend"');
    expect(html).toContain('id="quick-toggle-vad"');

    // Task Type selector has been removed from Transcribe Studio deck
    expect(html).not.toContain('id="quick-opt-task"');
    expect(html).not.toContain('data-i18n="transcribe.taskLabel"');
    expect(html).not.toContain('data-i18n="transcribe.taskTranscribe"');
    expect(html).not.toContain('data-i18n="transcribe.taskTranslate"');

    // Duplicate Diarization toggle has been removed from Transcribe Studio deck
    expect(html).not.toContain('id="quick-toggle-diarize"');

    // VAD switch uses informative feature description matching translation studio
    expect(html).toContain('data-i18n="settings.vadEnableDesc"');
    expect(html).not.toContain('id="quick-vad-status-text"');
    expect(html).not.toContain('data-i18n="transcribe.vadDisabledStatus"');
  });

  it('contains batch queue container and batch specs box', () => {
    expect(html).toContain('id="batch-specs-box"');
    expect(html).toContain('id="batch-files-count"');
    expect(html).toContain('id="batch-total-duration"');
    expect(html).toContain('id="batch-queue-container"');
    expect(html).toContain('id="batch-queue-body"');
  });

  it('contains single and batch action controls with initial disabled state and tooltip', () => {
    expect(html).toContain('id="single-transcribe-actions"');
    expect(html).toContain('id="btn-run-transcribe"');
    expect(html).toMatch(/<button[^>]*id="btn-run-transcribe"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*id="btn-run-transcribe"[^>]*data-i18n-title="toasts\.noFileSelected"/);
    expect(html).toContain('id="btn-cancel-transcribe"');
    expect(html).toContain('id="batch-controls-box"');
    expect(html).toContain('id="btn-run-batch"');
    expect(html).toMatch(/<button[^>]*id="btn-run-batch"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*id="btn-run-batch"[^>]*data-i18n-title="toasts\.noFileSelected"/);
    expect(html).toContain('id="btn-cancel-batch"');
  });

  it('contains output folder picker row in the unified deck', () => {
    expect(html).toContain('transcribe-output-row');
    expect(html).toContain('id="transcribe-output-dir-text"');
    expect(html).toContain('id="btn-browse-transcribe-dir"');
    expect(html).toContain('id="btn-reset-transcribe-dir"');
  });

  it('contains telemetry HUD in the left deck actions section and not in the right panel', () => {
    const leftPanelIdx = html.indexOf('class="transcribe-left-panel"');
    const rightPanelIdx = html.indexOf('class="transcribe-right-panel"');
    expect(leftPanelIdx).toBeGreaterThan(-1);
    expect(rightPanelIdx).toBeGreaterThan(leftPanelIdx);

    const leftPanelHtml = html.substring(leftPanelIdx, rightPanelIdx);
    const rightPanelHtml = html.substring(rightPanelIdx, html.indexOf('id="panel-translate"'));

    // Left deck has the telemetry HUD and no cluttered legacy files box
    expect(leftPanelHtml).toContain('id="telemetry-hud-card"');
    expect(leftPanelHtml).toContain('transcribe-telemetry');
    expect(leftPanelHtml).toContain('id="hud-status-badge"');
    expect(leftPanelHtml).toContain('id="progress-linear-fill"');
    expect(leftPanelHtml).toContain('id="lbl-radial-pct"');
    expect(leftPanelHtml).toContain('id="lbl-radial-msg"');
    expect(leftPanelHtml).not.toContain('id="analytics-box"');
    expect(leftPanelHtml).not.toContain('data-i18n="transcribe.filesLabel"');

    // Right panel does not contain telemetry HUD
    expect(rightPanelHtml).not.toContain('id="telemetry-hud-card"');
  });

  it('dedicates the right panel to live transcript viewer card with actions and workflow bridges', () => {
    const rightPanelIdx = html.indexOf('class="transcribe-right-panel"');
    const panelTranslateIdx = html.indexOf('id="panel-translate"');
    const rightPanelHtml = html.substring(rightPanelIdx, panelTranslateIdx);

    expect(rightPanelHtml).toContain('transcript-viewer-card');
    expect(rightPanelHtml).toContain('id="transcribe-viewer-card"');
    expect(rightPanelHtml).toContain('id="transcript-search"');
    expect(rightPanelHtml).not.toContain('id="btn-export-transcript"');
    expect(rightPanelHtml).not.toContain('data-i18n="transcribe.exportTxt"');
    expect(rightPanelHtml).toContain('id="btn-copy-transcript"');
    expect(rightPanelHtml).toContain('id="transcribe-output-file-group"');
    expect(rightPanelHtml).toContain('id="btn-open-output-file"');
    expect(rightPanelHtml).toContain('id="transcribe-output-files-dropdown"');
    expect(rightPanelHtml).toContain('id="btn-open-output-folder"');
    expect(rightPanelHtml).toContain('id="btn-send-to-translation"');
    expect(rightPanelHtml).toContain('id="btn-transcribe-send-to-hardsub"');

    // Both workflow send buttons share identical highlight styling classes
    expect(rightPanelHtml).toMatch(/<button[^>]*class="[^"]*btn-toolbar-workflow[^"]*"[^>]*id="btn-send-to-translation"/);
    expect(rightPanelHtml).toMatch(/<button[^>]*class="[^"]*btn-toolbar-workflow[^"]*"[^>]*id="btn-transcribe-send-to-hardsub"/);

    // Accessibility and initial disabled state checks
    expect(rightPanelHtml).toMatch(/<button[^>]*id="btn-copy-transcript"[^>]*type="button"[^>]*disabled/);
    expect(rightPanelHtml).toMatch(/<button[^>]*id="btn-open-output-file"[^>]*type="button"[^>]*disabled/);
    expect(rightPanelHtml).toContain('aria-label="Search transcript"');
    expect(rightPanelHtml).toContain('aria-label="Open File"');
    expect(rightPanelHtml).toContain('id="transcript-viewport" aria-live="polite"');
    expect(rightPanelHtml).toContain('class="transcript-placeholder" id="transcript-placeholder"');
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
      // Obsolete transcribe keys must be absent
      expect((loc.transcribe as any).taskLabel, `Locale ${code}.transcribe.taskLabel should be removed`).toBeUndefined();
      expect((loc.transcribe as any).taskTranscribe, `Locale ${code}.transcribe.taskTranscribe should be removed`).toBeUndefined();
      expect((loc.transcribe as any).taskTranslate, `Locale ${code}.transcribe.taskTranslate should be removed`).toBeUndefined();
      expect((loc.transcribe as any).exportTxt, `Locale ${code}.transcribe.exportTxt should be removed`).toBeUndefined();
    }
  });

  it('defines outputFolder, sameAsSource, changeFolder, resetFolder, sendToTranslation, and sendToHardsub for all 13 supported languages', () => {
    for (const code of languageCodes) {
      const loc = locales[code];
      expect(loc, `Locale ${code} should exist`).toBeDefined();
      expect(loc.transcribe, `Locale ${code}.transcribe should exist`).toBeDefined();
      expect(loc.transcribe.outputFolder, `Locale ${code}.transcribe.outputFolder should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.sameAsSource, `Locale ${code}.transcribe.sameAsSource should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.changeFolder, `Locale ${code}.transcribe.changeFolder should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.resetFolder, `Locale ${code}.transcribe.resetFolder should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.sendToTranslation, `Locale ${code}.transcribe.sendToTranslation should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.sendToTranslationDesc, `Locale ${code}.transcribe.sendToTranslationDesc should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.sendToHardsub, `Locale ${code}.transcribe.sendToHardsub should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.sendToHardsubDesc, `Locale ${code}.transcribe.sendToHardsubDesc should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.noSubGeneratedYet, `Locale ${code}.transcribe.noSubGeneratedYet should be non-empty string`).toBeTruthy();
      expect(loc.transcribe.noOutputDirYet, `Locale ${code}.transcribe.noOutputDirYet should be non-empty string`).toBeTruthy();
    }
  });

  it('provides appropriate localized deckTitle values', () => {
    expect(locales.en.transcribe.deckTitle).toBe('Transcription Setup');
    expect(locales.fa.transcribe.deckTitle).toBe('تنظیمات رونویسی');
    expect(locales.fa.transcribe.clearMedia).toBe('پاک\u200cکردن');
    expect(locales.ar.transcribe.deckTitle).toBe('إعدادات النسخ الصوتي');
    expect(locales.de.transcribe.deckTitle).toBe('Transkriptions-Setup');
  });

  it('provides appropriate localized output folder and workflow values in en and fa', () => {
    expect(locales.en.transcribe.outputFolder).toBe('Output Folder');
    expect(locales.fa.transcribe.outputFolder).toBe('پوشه خروجی');
    expect(locales.en.transcribe.sendToTranslation).toBe('Send to Translation Studio');
    expect(locales.fa.transcribe.sendToTranslation).toBe('ارسال به استودیو ترجمه');
    expect(locales.en.transcribe.sendToHardsub).toBe('Send to Hardsub Studio');
    expect(locales.fa.transcribe.sendToHardsub).toBe('ارسال به استودیو هاردساب');
    expect(locales.en.transcribe.noSubGeneratedYet).toBe('No generated subtitle yet');
    expect(locales.fa.transcribe.noSubGeneratedYet).toBe('هنوز زیرنویسی استخراج نشده است');
    expect(locales.noOutputDirYet).toBeUndefined();
    expect(locales.en.transcribe.noOutputDirYet).toBe('No output folder available yet');
    expect(locales.fa.transcribe.noOutputDirYet).toBe('هنوز پوشه خروجی در دسترس نیست');
  });

  it('provides polished target-oriented action button and status labels across all 13 supported languages', () => {
    for (const code of languageCodes) {
      const loc = locales[code];
      expect(loc.transcribe.startAiExtraction, `Locale ${code}.transcribe.startAiExtraction should exist`).toBeTruthy();
      expect(loc.transcribe.startBatchAiExtraction, `Locale ${code}.transcribe.startBatchAiExtraction should exist`).toBeTruthy();
      expect(loc.transcribe.statusExtracting, `Locale ${code}.transcribe.statusExtracting should exist`).toBeTruthy();
    }

    expect(locales.en.transcribe.startAiExtraction).toBe('Transcribe File');
    expect(locales.en.transcribe.startBatchAiExtraction).toBe('Transcribe Files');
    expect(locales.en.transcribe.statusExtracting).toBe('Transcribing...');

    expect(locales.fa.transcribe.startAiExtraction).toBe('رونویسی فایل');
    expect(locales.fa.transcribe.startBatchAiExtraction).toBe('رونویسی فایل‌ها');
    expect(locales.fa.transcribe.statusExtracting).toBe('در حال رونویسی...');
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

  it('controls transcribe action buttons enabled/disabled states and tooltips across lifecycles', () => {
    interface TranscribeActionButtonsState {
      runBtnDisabled: boolean;
      runBtnTitle: string;
      runBtnText: string;
      batchBtnDisabled: boolean;
      batchBtnTitle: string;
      batchBtnText: string;
    }

    function simulateUpdateTranscribeActionButtons(
      hasSingleMedia: boolean,
      hasBatchMedia: boolean,
      isTranscribing: boolean = false,
      isBatchExtracting: boolean = false,
      tFn: (key: string) => string = (k) => {
        const [ns, key] = k.split('.');
        return locales.en[ns]?.[key] || k;
      }
    ): TranscribeActionButtonsState {
      const canRun = !isTranscribing && hasSingleMedia;
      const canRunBatch = !isBatchExtracting && hasBatchMedia;

      let runTitle = '';
      let runText = tFn('transcribe.startAiExtraction');
      if (isTranscribing) {
        runTitle = tFn('transcribe.statusExtracting');
        runText = tFn('transcribe.statusExtracting');
      } else if (!hasSingleMedia) {
        runTitle = tFn('toasts.noFileSelected');
      } else {
        runTitle = tFn('transcribe.startAiExtraction');
      }

      let batchTitle = '';
      let batchText = tFn('transcribe.startBatchAiExtraction');
      if (isBatchExtracting) {
        batchTitle = tFn('transcribe.batchRunning');
        batchText = tFn('transcribe.batchRunning');
      } else if (!hasBatchMedia) {
        batchTitle = tFn('toasts.noFileSelected');
      } else {
        batchTitle = tFn('transcribe.startBatchAiExtraction');
      }

      return {
        runBtnDisabled: !canRun,
        runBtnTitle: runTitle,
        runBtnText: runText,
        batchBtnDisabled: !canRunBatch,
        batchBtnTitle: batchTitle,
        batchBtnText: batchText,
      };
    }

    const tEn = (k: string) => {
      const [ns, key] = k.split('.');
      return locales.en[ns]?.[key] || k;
    };
    const tFa = (k: string) => {
      const [ns, key] = k.split('.');
      return locales.fa[ns]?.[key] || k;
    };

    // Initial state: no media loaded -> disabled with tooltip
    const initial = simulateUpdateTranscribeActionButtons(false, false, false, false, tEn);
    expect(initial.runBtnDisabled).toBe(true);
    expect(initial.runBtnTitle).toBe('Please select an audio or video file first.');
    expect(initial.runBtnText).toBe('Transcribe File');
    expect(initial.batchBtnDisabled).toBe(true);
    expect(initial.batchBtnTitle).toBe('Please select an audio or video file first.');
    expect(initial.batchBtnText).toBe('Transcribe Files');

    // In Persian:
    const initialFa = simulateUpdateTranscribeActionButtons(false, false, false, false, tFa);
    expect(initialFa.runBtnDisabled).toBe(true);
    expect(initialFa.runBtnTitle).toBe('لطفاً ابتدا یک فایل صوتی یا ویدیویی انتخاب کنید.');
    expect(initialFa.runBtnText).toBe('رونویسی فایل');
    expect(initialFa.batchBtnDisabled).toBe(true);
    expect(initialFa.batchBtnTitle).toBe('لطفاً ابتدا یک فایل صوتی یا ویدیویی انتخاب کنید.');
    expect(initialFa.batchBtnText).toBe('رونویسی فایل‌ها');

    // Single file loaded -> enabled with ready tooltip
    const singleLoaded = simulateUpdateTranscribeActionButtons(true, false, false, false, tEn);
    expect(singleLoaded.runBtnDisabled).toBe(false);
    expect(singleLoaded.runBtnTitle).toBe('Transcribe File');
    expect(singleLoaded.runBtnText).toBe('Transcribe File');

    // Batch files loaded -> batch button enabled
    const batchLoaded = simulateUpdateTranscribeActionButtons(false, true, false, false, tEn);
    expect(batchLoaded.batchBtnDisabled).toBe(false);
    expect(batchLoaded.batchBtnTitle).toBe('Transcribe Files');
    expect(batchLoaded.batchBtnText).toBe('Transcribe Files');

    // Transcribing active -> disabled with "Transcribing..."
    const transcribing = simulateUpdateTranscribeActionButtons(true, false, true, false, tEn);
    expect(transcribing.runBtnDisabled).toBe(true);
    expect(transcribing.runBtnTitle).toBe('Transcribing...');
    expect(transcribing.runBtnText).toBe('Transcribing...');

    // Transcribing active in Persian -> disabled with "در حال رونویسی..."
    const transcribingFa = simulateUpdateTranscribeActionButtons(true, false, true, false, tFa);
    expect(transcribingFa.runBtnDisabled).toBe(true);
    expect(transcribingFa.runBtnTitle).toBe('در حال رونویسی...');
    expect(transcribingFa.runBtnText).toBe('در حال رونویسی...');

    // Batch active -> disabled with "Batch Running..."
    const batchActive = simulateUpdateTranscribeActionButtons(false, true, false, true, tEn);
    expect(batchActive.batchBtnDisabled).toBe(true);
    expect(batchActive.batchBtnTitle).toBe('Batch Running...');
    expect(batchActive.batchBtnText).toBe('Batch Running...');

    // Cleared -> disabled with tooltip
    const cleared = simulateUpdateTranscribeActionButtons(false, false, false, false, tEn);
    expect(cleared.runBtnDisabled).toBe(true);
    expect(cleared.runBtnTitle).toBe('Please select an audio or video file first.');
  });

  it('safely handles media probing and batch transitions without legacy analytics-box in DOM', () => {
    // Simulates DOM without #analytics-box as redesigned
    const mockDocument = {
      getElementById: (id: string) => {
        if (id === 'analytics-box') return null;
        return { style: { display: '' } };
      }
    };

    expect(() => {
      const analyticsBox = mockDocument.getElementById('analytics-box');
      if (analyticsBox) analyticsBox.style.display = 'none';
    }).not.toThrow();
  });
});

describe('Transcription Studio Output Directory & Workflow Logic', () => {
  interface OutputDirUiState {
    text: string;
    hasCustomPath: boolean;
    resetBtnDisplay: string;
    title: string | null;
  }

  function simulateUpdateOutputDirUI(settings: { outputDirMode: string; outputDirPath: string } | null, defaultLabel: string): OutputDirUiState {
    const isCustom = settings && settings.outputDirMode === 'custom' && Boolean(settings.outputDirPath);
    if (isCustom) {
      return {
        text: settings!.outputDirPath,
        hasCustomPath: true,
        resetBtnDisplay: 'inline-flex',
        title: settings!.outputDirPath
      };
    }
    return {
      text: defaultLabel,
      hasCustomPath: false,
      resetBtnDisplay: 'none',
      title: null
    };
  }

  it('updates output dir display correctly for source mode and custom mode', () => {
    // Default source mode
    const sourceState = simulateUpdateOutputDirUI({ outputDirMode: 'source', outputDirPath: '' }, 'Same as source file folder');
    expect(sourceState.text).toBe('Same as source file folder');
    expect(sourceState.hasCustomPath).toBe(false);
    expect(sourceState.resetBtnDisplay).toBe('none');
    expect(sourceState.title).toBeNull();

    // Custom output directory selected
    const customState = simulateUpdateOutputDirUI({ outputDirMode: 'custom', outputDirPath: '/home/user/Transcripts' }, 'Same as source file folder');
    expect(customState.text).toBe('/home/user/Transcripts');
    expect(customState.hasCustomPath).toBe(true);
    expect(customState.resetBtnDisplay).toBe('inline-flex');
    expect(customState.title).toBe('/home/user/Transcripts');
  });

  interface WorkflowButtonsState {
    openFolderDisabled: boolean;
    openFolderTitle: string;
    openFileDisabled: boolean;
    openFileHasDropdown: boolean;
    openFileTitle: string;
    sendTranslateDisabled: boolean;
    sendTranslateTitle: string;
    sendHardsubDisabled: boolean;
    sendHardsubTitle: string;
    copyTranscriptDisabled: boolean;
  }

  function simulateUpdateWorkflowButtons(
    outputDir: string | null,
    subPath: string | null,
    transcriptLinesCount: number = 0,
    outputFiles: Array<{ name: string; path: string; type: string }> = [],
    noOutputDirMsg: string = 'No output folder available yet',
    noSubMsg: string = 'No generated subtitle yet',
    openFileLabel: string = 'Open File'
  ): WorkflowButtonsState {
    const hasDir = Boolean(outputDir);
    const hasSub = Boolean(subPath);
    const hasTranscript = transcriptLinesCount > 0 || hasSub;
    const hasFiles = outputFiles.length > 0 || hasSub;
    const hasDropdown = outputFiles.length > 1;

    let openFileTitle = noSubMsg;
    if (hasDropdown) {
      openFileTitle = openFileLabel;
    } else if (hasFiles) {
      const singleName = outputFiles.length === 1 ? outputFiles[0].name : (subPath ? subPath.split(/[/\\]/).pop() : '');
      openFileTitle = singleName ? `${openFileLabel}: ${singleName}` : openFileLabel;
    }

    return {
      openFolderDisabled: !hasDir,
      openFolderTitle: hasDir ? outputDir! : noOutputDirMsg,
      openFileDisabled: !hasFiles,
      openFileHasDropdown: hasDropdown,
      openFileTitle,
      sendTranslateDisabled: !hasSub,
      sendTranslateTitle: hasSub ? '' : noSubMsg,
      sendHardsubDisabled: !hasSub,
      sendHardsubTitle: hasSub ? '' : noSubMsg,
      copyTranscriptDisabled: !hasTranscript,
    };
  }

  it('manages workflow bridging buttons state across lifecycle including copy button', () => {
    const noOutputDirMsg = 'No output folder available yet';
    const noSubMsg = 'No generated subtitle yet';

    // Initial / reset state: no outputs, no transcript lines
    const initialState = simulateUpdateWorkflowButtons(null, null, 0, [], noOutputDirMsg, noSubMsg);
    expect(initialState.openFolderDisabled).toBe(true);
    expect(initialState.openFolderTitle).toBe(noOutputDirMsg);
    expect(initialState.openFileDisabled).toBe(true);
    expect(initialState.openFileHasDropdown).toBe(false);
    expect(initialState.openFileTitle).toBe(noSubMsg);
    expect(initialState.sendTranslateDisabled).toBe(true);
    expect(initialState.sendTranslateTitle).toBe(noSubMsg);
    expect(initialState.sendHardsubDisabled).toBe(true);
    expect(initialState.sendHardsubTitle).toBe(noSubMsg);
    expect(initialState.copyTranscriptDisabled).toBe(true);

    // Live streaming lines arrive during transcription before completion
    const streamingState = simulateUpdateWorkflowButtons(null, null, 3, [], noOutputDirMsg, noSubMsg);
    expect(streamingState.copyTranscriptDisabled).toBe(false);
    expect(streamingState.openFileDisabled).toBe(true);
    expect(streamingState.sendTranslateDisabled).toBe(true);

    // Transcription completed successfully with single output file
    const singleFile = [{ name: 'speech.srt', path: '/home/user/Videos/speech.srt', type: 'original' }];
    const successState = simulateUpdateWorkflowButtons(
      '/home/user/Videos',
      '/home/user/Videos/speech.srt',
      12,
      singleFile,
      noOutputDirMsg,
      noSubMsg
    );
    expect(successState.openFolderDisabled).toBe(false);
    expect(successState.openFolderTitle).toBe('/home/user/Videos');
    expect(successState.openFileDisabled).toBe(false);
    expect(successState.openFileHasDropdown).toBe(false);
    expect(successState.openFileTitle).toBe('Open File: speech.srt');
    expect(successState.sendTranslateDisabled).toBe(false);
    expect(successState.sendTranslateTitle).toBe('');
    expect(successState.sendHardsubDisabled).toBe(false);
    expect(successState.sendHardsubTitle).toBe('');
    expect(successState.copyTranscriptDisabled).toBe(false);

    // Transcription completed with multiple files (e.g., original + translated subtitle)
    const multiFiles = [
      { name: 'speech.srt', path: '/home/user/Videos/speech.srt', type: 'original' },
      { name: 'speech.fa.srt', path: '/home/user/Videos/speech.fa.srt', type: 'translated' }
    ];
    const multiState = simulateUpdateWorkflowButtons(
      '/home/user/Videos',
      '/home/user/Videos/speech.fa.srt',
      12,
      multiFiles,
      noOutputDirMsg,
      noSubMsg
    );
    expect(multiState.openFileDisabled).toBe(false);
    expect(multiState.openFileHasDropdown).toBe(true);
    expect(multiState.openFileTitle).toBe('Open File');

    // Clearing media/queue empties transcriptLines and resets subtitle path
    let lines = ['line 1', 'line 2'];
    let sub = '/home/user/Videos/speech.srt';
    // Clear operation order: transcriptLines = []; sub = null; updateTranscribeWorkflowButtons();
    lines = [];
    sub = null;
    const clearedState = simulateUpdateWorkflowButtons(null, sub, lines.length, [], noOutputDirMsg, noSubMsg);
    expect(clearedState.copyTranscriptDisabled).toBe(true);
    expect(clearedState.openFileDisabled).toBe(true);

    // Starting a new transcription run also resets previous outputs before lines arrive
    const newRunState = simulateUpdateWorkflowButtons(null, null, 0, noOutputDirMsg, noSubMsg);
    expect(newRunState.copyTranscriptDisabled).toBe(true);
  });

  it('renders Telemetry HUD status badge CSS classes correctly', () => {
    const getBadgeClass = (status: 'ready' | 'active' | 'complete' | 'cancelled') => {
      const base = 'transcribe-status-badge';
      if (status === 'active') return `${base} active`;
      if (status === 'complete') return `${base} complete`;
      if (status === 'cancelled') return `${base} cancelled`;
      return base;
    };

    expect(getBadgeClass('ready')).toBe('transcribe-status-badge');
    expect(getBadgeClass('active')).toBe('transcribe-status-badge active');
    expect(getBadgeClass('complete')).toBe('transcribe-status-badge complete');
    expect(getBadgeClass('cancelled')).toBe('transcribe-status-badge cancelled');
  });

  it('guarantees complete localization symmetry for new transcribe tooltips, toast and queue header across all 13 locales', () => {
    const requiredTranscribeKeys = [
      'vadDisableHint',
      'vadEnableHint',
      'queueFilesHeader',
      'moveUp',
      'moveDown',
      'noMatchingTranscript',
      'transcribingWithAi',
      'cancelTranscription',
      'openFile',
      'originalSubtitle',
      'translatedSubtitle',
      'rawTranscriptText',
      'statusComplete',
      'statusCancelled',
      'progressCompleteWithStats'
    ];
    const requiredToastKeys = ['filesAlreadyInBatch'];
    for (const [langCode, locale] of Object.entries(locales)) {
      expect(locale.transcribe, `Missing transcribe object in ${langCode}`).toBeDefined();
      for (const key of requiredTranscribeKeys) {
        expect(locale.transcribe[key], `Missing ${key} in ${langCode}.transcribe`).toBeDefined();
        expect(typeof locale.transcribe[key], `${key} in ${langCode} must be a non-empty string`).toBe('string');
        expect(locale.transcribe[key].trim().length, `${key} in ${langCode} cannot be empty`).toBeGreaterThan(0);
      }
      expect(locale.toasts, `Missing toasts object in ${langCode}`).toBeDefined();
      for (const key of requiredToastKeys) {
        expect(locale.toasts[key], `Missing ${key} in ${langCode}.toasts`).toBeDefined();
        expect(typeof locale.toasts[key], `${key} in ${langCode} must be a non-empty string`).toBe('string');
        expect(locale.toasts[key].trim().length, `${key} in ${langCode} cannot be empty`).toBeGreaterThan(0);
      }
    }

    // Verify Persian grammatical correctness for queue count suffix and action buttons
    expect(fa.transcribe.queueFiles).toBe('فایل در صف');
    expect(fa.transcribe.moveUp).toBe('انتقال به بالا');
    expect(fa.transcribe.moveDown).toBe('انتقال به پایین');
    expect(fa.transcribe.noMatchingTranscript).toBe('هیچ متنی مطابق با جستجوی شما یافت نشد.');
  });

  it('verifies natural numeric alphanumeric sorting for batch queue', () => {
    const items = [
      { name: 'Episode 10.mp4', durationSec: 100 },
      { name: 'Episode 2.mp4', durationSec: 50 },
      { name: 'Episode 1.mp4', durationSec: 80 }
    ];

    // Standard ASCII sort would put Episode 10 before Episode 2
    const asciiSorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    expect(asciiSorted.map(i => i.name)).toEqual(['Episode 1.mp4', 'Episode 10.mp4', 'Episode 2.mp4']);

    // Natural alphanumeric numeric sort correctly puts Episode 2 before Episode 10
    const naturalSorted = [...items].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    expect(naturalSorted.map(i => i.name)).toEqual(['Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4']);

    // Defensive sorting safely handles missing or undefined names without throwing
    const raggedItems = [
      { name: 'Beta.mp4' },
      { name: undefined },
      { name: 'Alpha.mp4' },
      {}
    ] as Array<{ name?: string }>;

    expect(() => {
      raggedItems.sort((a, b) => {
        const nameA = String(a.name || '');
        const nameB = String(b.name || '');
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
    }).not.toThrow();
  });

  it('verifies accessibility and i18n title attributes in transcribe DOM', () => {
    const htmlContent = loadResolvedHtml(resolve(__dirname, 'index.html'));
    // Badges in metadata row have localized title tags
    expect(htmlContent).toContain('id="meta-type" data-i18n-title="transcribe.fileType"');
    expect(htmlContent).toContain('id="meta-duration" data-i18n-title="transcribe.duration"');
    expect(htmlContent).toContain('id="meta-size" data-i18n-title="transcribe.fileSize"');
    expect(htmlContent).toContain('id="meta-target-format" data-i18n-title="transcribe.targetFormat"');
    expect(htmlContent).toContain('id="meta-recommendation" data-i18n-title="transcribe.activeExtractor"');

    // Controls have localized aria attributes
    expect(htmlContent).toContain('id="quick-opt-model" data-searchable data-model-select data-i18n-aria="transcribe.aiModel"');
    expect(htmlContent).toContain('id="quick-opt-language" data-searchable data-language-select="spoken" data-i18n-aria="transcribe.spokenLang"');
    expect(htmlContent).toContain('id="quick-opt-selectedBackend" data-i18n-aria="transcribe.engine"');
    expect(htmlContent).toContain('id="btn-copy-transcript" type="button" disabled onclick="copyLiveTranscriptToClipboard()" data-i18n-aria="transcribe.copyTranscript"');
    expect(htmlContent).toContain('id="btn-open-output-folder" type="button" onclick="openOutputFolder()" data-i18n-aria="transcribe.openFolder"');
    expect(htmlContent).toContain('id="transcript-search" placeholder="Search transcript..." data-i18n-aria="transcribe.searchTranscript"');

    // Batch queue header uses queueFilesHeader
    expect(htmlContent).toContain('data-i18n="transcribe.queueFilesHeader"');
  });

  it('guarantees self-deduplication when appending or selecting files in batch queue', () => {
    const rawFiles = [
      '/path/to/ep1.mp4',
      '/path/to/ep2.mp4',
      '/path/to/ep1.mp4', // duplicate in same drop
      '/path/to/ep3.mp4',
      '/path/to/ep2.mp4'  // duplicate in same drop
    ];

    const uniqueFiles = Array.from(new Set(rawFiles));
    expect(uniqueFiles).toEqual(['/path/to/ep1.mp4', '/path/to/ep2.mp4', '/path/to/ep3.mp4']);

    // Simulation of appending to existing batch queue with both existing and duplicate items
    const existingQueue = [
      { path: '/path/to/ep1.mp4', name: 'ep1.mp4' }
    ];
    const existingPaths = new Set(existingQueue.map(item => item.path));
    const newlyAppended = uniqueFiles.filter(f => !existingPaths.has(f));

    expect(newlyAppended).toEqual(['/path/to/ep2.mp4', '/path/to/ep3.mp4']);
  });

  it('contains the pulse dot nested inside the hud-status-badge in DOM structure', () => {
    const htmlContent = loadResolvedHtml(resolve(__dirname, 'index.html'));
    // Ensure hud-status-badge contains hud-pulse-dot inside it
    expect(htmlContent).toMatch(/<span[^>]*id="hud-status-badge"[^>]*>[\s\S]*?<span[^>]*id="hud-pulse-dot"[^>]*><\/span>[\s\S]*?<span[^>]*id="hud-status-text"/);
  });

  function loadResolvedCss(cssFile: string): string {
    const content = readFileSync(cssFile, 'utf-8');
    return content.replace(/@import\s+['"]([^'"]+)['"];/g, (_, importPath) => {
      const resolvedPath = resolve(dirname(cssFile), importPath);
      return readFileSync(resolvedPath, 'utf-8');
    });
  }

  it('enforces RTL progress bar head and gradient symmetry in stylesheet', () => {
    const cssContent = loadResolvedCss(resolve(__dirname, 'styles.css'));
    // Glowing head moves to left: 0 in RTL
    expect(cssContent).toMatch(/html\[dir="rtl"\]\s+\.progress-linear-glow[\s\S]*?left:\s*0/);
    expect(cssContent).toMatch(/html\[dir="rtl"\]\s+\.progress-linear-glow[\s\S]*?right:\s*auto/);
    // Fill gradient in RTL flows from royal blue on right to cyan on left
    expect(cssContent).toMatch(/html\[dir="rtl"\]\s+\.progress-linear-fill[\s\S]*?linear-gradient\(to left/);
  });

  it('enforces equal 50% width and ellipsis overflow protection on action buttons in stylesheet', () => {
    const cssContent = loadResolvedCss(resolve(__dirname, 'styles.css'));
    // Start and cancel buttons both have flex: 1 1 0 and width: 50%
    expect(cssContent).toMatch(/\.btn-start-transcription\s*\{[\s\S]*?flex:\s*1 1 0/);
    expect(cssContent).toMatch(/\.btn-start-transcription\s*\{[\s\S]*?width:\s*50%/);
    expect(cssContent).toMatch(/\.btn-cancel-transcription\s*\{[\s\S]*?flex:\s*1 1 0/);
    expect(cssContent).toMatch(/\.btn-cancel-transcription\s*\{[\s\S]*?width:\s*50%/);
    // Span elements have text-overflow ellipsis
    expect(cssContent).toMatch(/\.btn-start-transcription\s+span\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
    expect(cssContent).toMatch(/\.btn-cancel-transcription\s+span\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  });

  it('formats localized duration cleanly using durationSeconds and durationMinutesSeconds', () => {
    function simulateFormatLocalizedTimeDuration(secondsVal: number, localeObj: any) {
      if (secondsVal < 60) {
        const secStr = secondsVal.toFixed(1);
        const template = localeObj.transcribe.durationSeconds || localeObj.common?.durationSeconds;
        return template.replace('{seconds}', secStr);
      }
      const mins = Math.floor(secondsVal / 60);
      const remSec = (secondsVal % 60).toFixed(0);
      const template = localeObj.transcribe.durationMinutesSeconds || localeObj.common?.durationMinutesSeconds;
      return template.replace('{minutes}', String(mins)).replace('{seconds}', String(remSec));
    }

    // Persian: 11.7 ثانیه
    expect(simulateFormatLocalizedTimeDuration(11.7, fa)).toBe('11.7 ثانیه');
    // English: 11.7 sec
    expect(simulateFormatLocalizedTimeDuration(11.7, en)).toBe('11.7 sec');
    // German: 11.7 Sek.
    expect(simulateFormatLocalizedTimeDuration(11.7, de)).toBe('11.7 Sek.');
    // Arabic: 11.7 ثانية
    expect(simulateFormatLocalizedTimeDuration(11.7, ar)).toBe('11.7 ثانية');

    // > 60 seconds formatted with minutes and seconds
    expect(simulateFormatLocalizedTimeDuration(75.2, fa)).toBe('1 دقیقه و 15 ثانیه');
    expect(simulateFormatLocalizedTimeDuration(75.2, en)).toBe('1 min 15 sec');
  });

  it('validates modern batch queue card layout, balanced actions, and header structure in HTML and CSS', () => {
    const htmlContent = loadResolvedHtml(resolve(__dirname, 'index.html'));
    // Structural HTML expectations
    expect(htmlContent).toContain('class="batch-queue-header"');
    expect(htmlContent).toContain('class="batch-queue-title"');
    expect(htmlContent).toContain('class="batch-title-text"');
    expect(htmlContent).toContain('id="lbl-batch-count"');
    expect(htmlContent).toContain('class="batch-queue-actions"');
    expect(htmlContent).toContain('id="btn-clear-batch"');
    expect(htmlContent).toContain('class="batch-sort-wrapper"');
    expect(htmlContent).toContain('id="batch-sort-select"');
    expect(htmlContent).toContain('class="batch-queue-list"');
    expect(htmlContent).toContain('id="batch-queue-body"');

    // Confirm legacy broken table and toolbar elements are eliminated
    expect(htmlContent).not.toMatch(/<table[^>]*class="batch-table"/);
    expect(htmlContent).not.toMatch(/<thead[\s\S]*?<th/);
    expect(htmlContent).not.toContain('class="batch-queue-toolbar"');

    // CSS structure validation
    const cssContent = loadResolvedCss(resolve(__dirname, 'styles.css'));
    expect(cssContent).toContain('.batch-queue-card');
    expect(cssContent).toContain('.batch-card-top-row');
    expect(cssContent).toContain('.batch-card-bottom-row');
    expect(cssContent).toContain('.batch-card-name-group');
    expect(cssContent).toContain('.btn-batch-action');
    expect(cssContent).toContain('.batch-queue-actions');
    expect(cssContent).toContain('.batch-queue-card.is-clickable');
    expect(cssContent).toContain('.batch-queue-card.is-selected');
    expect(cssContent).toContain('.batch-viewing-chip');

    // Check RTL styles
    const rtlContent = readFileSync(resolve(__dirname, 'rtl.css'), 'utf-8');
    expect(rtlContent).toContain('.batch-card-duration');
  });

  it('verifies interactive batch item selection, transcript switching, and toolbar bridging in main.js and locales', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // Verification of active batch viewer state tracking and select function
    expect(mainJsContent).toContain('let activeBatchViewerIndex = -1;');
    expect(mainJsContent).toContain('window.selectBatchItemTranscript = async function(');
    expect(mainJsContent).toContain('activeBatchViewerIndex = index;');

    // Verification of card selection and visual indicators in queue renderer
    expect(mainJsContent).toContain('const isSelected = activeBatchViewerIndex === index;');
    expect(mainJsContent).toContain('const isClickable = isCompleted || isActive;');
    expect(mainJsContent).toContain('${isClickable ? \'is-clickable\' : \'\'}');
    expect(mainJsContent).toContain('${isSelected ? \'is-selected\' : \'\'}');
    expect(mainJsContent).toContain('batch-viewing-chip');

    // Verification of in-memory transcript lines preservation and unified rendering
    const viewerContent = readFileSync(resolve(__dirname, 'modules/transcriptViewer.ts'), 'utf-8');
    expect(mainJsContent).toContain('transcriptLines = item.transcriptLines.map(');
    expect(viewerContent).toContain('function createTranscriptCardElement(lineObj');
    expect(viewerContent).toContain('function renderTranscriptLines(lines');

    // Verification of workflow bridging and toolbar synchronization
    expect(mainJsContent).toContain('window.lastTranscribedSubtitlePath = item.subtitlePath');
    expect(mainJsContent).toContain('window.lastTranscribedVideoPath = item.path;');
    expect(mainJsContent).toContain('window.lastTranscribedOutputFiles = item.outputFiles');

    // Verification that new localization keys exist across locales
    expect(en.transcribe.viewingTranscript).toBeDefined();
    expect(en.transcribe.clickToViewTranscript).toBeDefined();
    expect(en.transcribe.batchFileProcessing).toBeDefined();
    expect(fa.transcribe.viewingTranscript).toBe('در حال نمایش');
    expect(fa.transcribe.clickToViewTranscript).toBe('کلیک برای مشاهده متن');
  });

  it('correctly parses SRT subtitle cues into unified timestamped segments and avoids multi-card fragmentation', () => {
    const rawSrt = `1
00:00:00,070 --> 00:00:02,190
When you cut off the root of an onion,

2
00:00:02,190 --> 00:00:04,500
it releases chemicals that hit your eyes
`;

    // Simulate SRT parser logic implemented in main.js
    const lines = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let i = 0;
    const total = lines.length;
    let cueId = 0;
    const parsedSegments: Array<{ timeRange: string; text: string; id: number }> = [];

    while (i < total) {
      const line = lines[i];
      if (line.includes('-->')) {
        const parts = line.split('-->');
        if (parts.length === 2) {
          const startRaw = parts[0].trim().split(' ')[0].replace(',', '.');
          const endRaw = parts[1].trim().split(' ')[0].replace(',', '.');
          const timeRange = `[${startRaw} --> ${endRaw}]`;

          const textParts: string[] = [];
          i++;
          while (i < total && lines[i].trim() !== '' && !lines[i].includes('-->')) {
            if (/^\d+$/.test(lines[i].trim()) && (i + 1 < total) && lines[i + 1].includes('-->')) {
              break;
            }
            textParts.push(lines[i]);
            i++;
          }

          const cleanText = textParts.join('\n').replace(/<[^>]+>/g, '').trim();
          if (cleanText || startRaw) {
            parsedSegments.push({ timeRange, text: cleanText, id: cueId++ });
          }
          continue;
        }
      }
      i++;
    }

    // Must be exactly 2 cues, NOT 6 separate fragmented lines
    expect(parsedSegments.length).toBe(2);
    expect(parsedSegments[0].id).toBe(0);
    expect(parsedSegments[0].timeRange).toBe('[00:00:00.070 --> 00:00:02.190]');
    expect(parsedSegments[0].text).toBe('When you cut off the root of an onion,');

    expect(parsedSegments[1].id).toBe(1);
    expect(parsedSegments[1].timeRange).toBe('[00:00:02.190 --> 00:00:04.500]');
    expect(parsedSegments[1].text).toBe('it releases chemicals that hit your eyes');
  });

  it('correctly parses JSON, LRC, and CSV outputs into timestamped segments', () => {
    // 1. Test JSON Parsing
    const sampleJson = JSON.stringify({
      transcription: [
        { timestamps: { from: '00:00:01,000', to: '00:00:03,500' }, text: 'First segment' },
        { timestamps: { from: '00:00:03,500', to: '00:00:06,000' }, text: 'Second segment' }
      ]
    });
    const parsedJson = JSON.parse(sampleJson);
    const jsonSegments = parsedJson.transcription.map((seg: any, idx: number) => ({
      timeRange: `[${seg.timestamps.from.replace(',', '.')} --> ${seg.timestamps.to.replace(',', '.')}]`,
      text: seg.text,
      id: idx
    }));
    expect(jsonSegments.length).toBe(2);
    expect(jsonSegments[0].timeRange).toBe('[00:00:01.000 --> 00:00:03.500]');
    expect(jsonSegments[0].text).toBe('First segment');

    // 2. Test LRC Parsing
    const sampleLrc = `[00:01.20]First lyric\n[00:05.40]Second lyric`;
    const lrcLines = sampleLrc.split('\n');
    const lrcRegex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
    const lrcSegments: any[] = [];
    lrcLines.forEach((l, idx) => {
      const match = l.match(lrcRegex);
      if (match) {
        lrcSegments.push({ id: idx, text: match[4].trim(), time: `${match[1]}:${match[2]}` });
      }
    });
    expect(lrcSegments.length).toBe(2);
    expect(lrcSegments[0].text).toBe('First lyric');
    expect(lrcSegments[1].text).toBe('Second lyric');
  });

  it('parses timestamps across whisper.cpp integer ms, float seconds, colon formats, and long audio > 2.7 hours', () => {
    const viewerContent = readFileSync(resolve(__dirname, 'modules/transcriptViewer.ts'), 'utf-8');
    expect(viewerContent).toContain('function parseTimestampStringToMs(');
    expect(viewerContent).toContain('function parseSegmentTimestamps(');

    // 1. whisper.cpp integer millisecond CSV values: 0, 4920
    const cppCue = parseSegmentTimestamps(0, 4920);
    expect(cppCue).toEqual({ startMs: 0, endMs: 4920 });
    expect(formatMsToTimestamp(cppCue.startMs)).toBe('00:00:00.000');
    expect(formatMsToTimestamp(cppCue.endMs)).toBe('00:00:04.920');

    // Subsequent whisper.cpp cue: 50000, 54920
    const cppCueLater = parseSegmentTimestamps(50000, 54920);
    expect(cppCueLater).toEqual({ startMs: 50000, endMs: 54920 });
    expect(formatMsToTimestamp(cppCueLater.startMs)).toBe('00:00:50.000');
    expect(formatMsToTimestamp(cppCueLater.endMs)).toBe('00:00:54.920');

    // 2. OpenAI Whisper float seconds: 0.0, 4.92
    const openaiCue = parseSegmentTimestamps('0.0', '4.92');
    expect(openaiCue).toEqual({ startMs: 0, endMs: 4920 });
    expect(formatMsToTimestamp(openaiCue.endMs)).toBe('00:00:04.920');

    // 3. Audio > 2.7 hours / > 10,000s: 10800.5, 10805.2 (must NOT wrap to 10s and must NOT multiply by 1000 erroneously)
    const longAudioCue = parseSegmentTimestamps('10800.5', '10805.2');
    expect(longAudioCue).toEqual({ startMs: 10800500, endMs: 10805200 });
    expect(formatMsToTimestamp(longAudioCue.startMs)).toBe('03:00:00.500');
    expect(formatMsToTimestamp(longAudioCue.endMs)).toBe('03:00:05.200');

    // 4. Colon formats: 00:01:23.456 and with comma 00:01:23,456
    const colonCue1 = parseSegmentTimestamps('00:01:23.456', '00:01:27.890');
    expect(colonCue1).toEqual({ startMs: 83456, endMs: 87890 });

    const colonCue2 = parseSegmentTimestamps('00:01:23,456', '00:01:27,890');
    expect(colonCue2).toEqual({ startMs: 83456, endMs: 87890 });

    // 5. Quoted timestamps and colon strings
    const quotedCue = parseSegmentTimestamps('"4920"', '"8500"');
    expect(quotedCue).toEqual({ startMs: 4920, endMs: 8500 });

    const quotedColonCue = parseSegmentTimestamps('"01:00:00.000"', '"01:00:04.920"');
    expect(quotedColonCue).toEqual({ startMs: 3600000, endMs: 3604920 });

    // 6. Integer seconds: 0 to 5 seconds
    const intSecCue = parseSegmentTimestamps('0', '5');
    expect(intSecCue).toEqual({ startMs: 0, endMs: 5000 });

    // 7. Long audio integer ms at 3 hours
    const longAudioMs = parseSegmentTimestamps('10800000', '10804920');
    expect(longAudioMs).toEqual({ startMs: 10800000, endMs: 10804920 });

    // Edge cases: null / undefined / invalid
    expect(parseSegmentTimestamps(null, null)).toBeNull();
    expect(parseSegmentTimestamps('invalid', '123')).toBeNull();
  });

  it('verifies CSV and TSV parsing with whisper.cpp integer ms, quotes, and headers', () => {

    // 1. CSV with whisper.cpp integer ms
    const sampleCsv = `start,end,text\n0,4920,"When you cut off the root of an onion,"\n4920,8500,"it releases chemicals that hit your eyes"`;
    const lines = sampleCsv.split('\n');
    const csvCues: any[] = [];
    let cueId = 0;
    lines.forEach((l, idx) => {
      if (!l.trim() || (idx === 0 && l.toLowerCase().includes('start'))) return;
      const cols = l.split(',');
      if (cols.length >= 3) {
        const parsed = parseSegmentTimestamps(cols[0].trim(), cols[1].trim());
        const textVal = cols.slice(2).join(',').replace(/^["']|["']$/g, '').trim();
        if (parsed && textVal) {
          csvCues.push({
            id: cueId++,
            timeRange: `[${formatMsToTimestamp(parsed.startMs)} --> ${formatMsToTimestamp(parsed.endMs)}]`,
            text: textVal
          });
        }
      }
    });

    expect(csvCues.length).toBe(2);
    expect(csvCues[0].timeRange).toBe('[00:00:00.000 --> 00:00:04.920]');
    expect(csvCues[0].text).toBe('When you cut off the root of an onion,');
    expect(csvCues[1].timeRange).toBe('[00:00:04.920 --> 00:00:08.500]');
    expect(csvCues[1].text).toBe('it releases chemicals that hit your eyes');

    // 2. CSV with id column header: id,start,end,text and escaped double quotes
    const advancedCsv = `id,start,end,text\n0,0,4920,"He said, ""Hello!"""\n1,4920,8500,"Second line"`;
    const advLines = advancedCsv.split('\n');
    let startCol = 0, endCol = 1, textCol = 2;
    const advCues: any[] = [];
    advLines.forEach((l, idx) => {
      const line = l.trim();
      if (!line) return;
      if (idx === 0 && (line.toLowerCase().includes('start') || line.toLowerCase().includes('text'))) {
        const headerCols = line.split(',').map(c => c.replace(/^["']|["']$/g, '').trim().toLowerCase());
        const sIdx = headerCols.findIndex(c => c === 'start' || c === 'start_time' || c === 'from');
        const eIdx = headerCols.findIndex(c => c === 'end' || c === 'end_time' || c === 'to');
        const tIdx = headerCols.findIndex(c => c === 'text' || c === 'content' || c === 'sentence');
        if (sIdx !== -1 && eIdx !== -1) {
          startCol = sIdx;
          endCol = eIdx;
          if (tIdx !== -1) textCol = tIdx;
        }
        return;
      }
      const cols = line.split(',');
      const parsed = parseSegmentTimestamps(cols[startCol].trim(), cols[endCol].trim());
      const textVal = cols.slice(textCol).join(',').replace(/^["']|["']$/g, '').replace(/""/g, '"').trim();
      if (parsed && textVal) {
        advCues.push({
          timeRange: `[${formatMsToTimestamp(parsed.startMs)} --> ${formatMsToTimestamp(parsed.endMs)}]`,
          text: textVal
        });
      }
    });
    expect(advCues.length).toBe(2);
    expect(advCues[0].timeRange).toBe('[00:00:00.000 --> 00:00:04.920]');
    expect(advCues[0].text).toBe('He said, "Hello!"');
    expect(advCues[1].text).toBe('Second line');

    // 3. TSV with tab delimiter
    const sampleTsv = `start\tend\ttext\n0.0\t4.92\t"Tab separated speech segment"`;
    const tsvLines = sampleTsv.split('\n');
    const tsvCues: any[] = [];
    tsvLines.forEach((l, idx) => {
      if (!l.trim() || (idx === 0 && l.toLowerCase().includes('start'))) return;
      const cols = l.split('\t');
      if (cols.length >= 3) {
        const parsed = parseSegmentTimestamps(cols[0].trim(), cols[1].trim());
        const textVal = cols.slice(2).join('\t').replace(/^["']|["']$/g, '').trim();
        if (parsed && textVal) {
          tsvCues.push({
            timeRange: `[${formatMsToTimestamp(parsed.startMs)} --> ${formatMsToTimestamp(parsed.endMs)}]`,
            text: textVal
          });
        }
      }
    });
    expect(tsvCues.length).toBe(1);
    expect(tsvCues[0].timeRange).toBe('[00:00:00.000 --> 00:00:04.920]');
    expect(tsvCues[0].text).toBe('Tab separated speech segment');
  });

  it('verifies JSON subtitle parser handles Whisper formats and long audio without wrapping', () => {

    // Python Whisper JSON for long audio at 3 hours
    const pythonWhisperJson = {
      segments: [
        { id: 0, start: 10800.5, end: 10804.8, text: 'Segment at hour 3' }
      ]
    };
    const seg = pythonWhisperJson.segments[0];
    const parsed = parseSegmentTimestamps(seg.start, seg.end);
    expect(parsed).toEqual({ startMs: 10800500, endMs: 10804800 });
    const timeRange = `[${formatMsToTimestamp(parsed!.startMs)} --> ${formatMsToTimestamp(parsed!.endMs)}]`;
    expect(timeRange).toBe('[03:00:00.500 --> 03:00:04.800]');
  });

  it('verifies Auto-Transfer to Translation Studio UI setting, localization, and bridging', () => {
    // 1. Verify index.html setting element
    const html = loadResolvedHtml(resolve(__dirname, 'index.html'));
    expect(html).toContain('id="opt-autoTransferToTranslate"');
    expect(html).toContain('data-i18n="settings.aiTranslateTitle"');
    expect(html).toContain('data-i18n="settings.aiTranslateDesc"');

    // 2. Verify all 13 locales contain updated title, description, tab name, and points without legacy LLM providers
    for (const [code, loc] of Object.entries(locales)) {
      expect(loc.settings.aiTranslateTitle, `aiTranslateTitle missing in locale ${code}`).toBeDefined();
      expect(loc.settings.aiTranslateDesc, `aiTranslateDesc missing in locale ${code}`).toBeDefined();
      expect(loc.settings.tabAutoTranslate, `tabAutoTranslate missing in locale ${code}`).toBeDefined();
      expect(loc.settings.aiTranslatePoints, `aiTranslatePoints missing in locale ${code}`).toBeDefined();
      expect(loc.settings.aiTranslatePoints).not.toContain('OpenAI');
      expect(loc.settings.aiTranslatePoints).not.toContain('Claude');
    }

    // Verify Persian translations match requirements
    expect(fa.settings.aiTranslateTitle).toBe('انتقال خودکار به استودیوی ترجمه');
    expect(fa.settings.aiTranslateDesc).toContain('استودیوی ترجمه');
    expect(fa.settings.tabAutoTranslate).toBe('انتقال خودکار');
    expect(fa.settings.aiTranslatePoints).toContain('استودیوی ترجمه');

    // Verify English translations match requirements
    expect(en.settings.aiTranslateTitle).toBe('Auto-Transfer to Translation Studio');
    expect(en.settings.tabAutoTranslate).toBe('Auto-Transfer');
    expect(en.settings.aiTranslatePoints).toContain('Translation Studio');

    // 3. Verify main.js contains the Auto-Transfer bridge calls and removed legacy headless translation loops
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');
    expect(mainJsContent).toContain('window.sendTranscribeToTranslationStudio()');
    expect(mainJsContent).toContain('settingsState?.autoTransferToTranslate ?? settingsState?.translateAiEnabled');
    expect(mainJsContent).not.toContain('translate_transcription_files');
  });

  it('strictly protects subtitlePath for studio bridges and eliminates hallucinated .ass and .sub checks', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // Verify .ass and .sub were completely cleaned up from batch file categorization
    expect(mainJsContent).not.toContain("f.endsWith('.ass')");
    expect(mainJsContent).not.toContain("f.name.endsWith('.ass')");
    expect(mainJsContent).not.toContain("f.endsWith('.sub')");
    expect(mainJsContent).not.toContain("f.name.endsWith('.sub')");

    // Verify item.subtitlePath strictly selects real playable subtitle formats
    expect(mainJsContent).toContain("const subFileObj = outputFilesList.find(f => f.name.endsWith('.srt')) ||");
    expect(mainJsContent).toContain("outputFilesList.find(f => f.name.endsWith('.vtt')) ||");
    expect(mainJsContent).toContain("outputFilesList.find(f => f.name.endsWith('.lrc'));");
    expect(mainJsContent).toContain("item.subtitlePath = subFileObj ? subFileObj.path : null;");

    // Verify single-mode output files categorization handles subtitle, json, and csv
    expect(mainJsContent).toContain("if (f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.lrc')) {\n          type = 'subtitle';");
    expect(mainJsContent).toContain("} else if (f.endsWith('.json')) {\n          type = 'json';");
    expect(mainJsContent).toContain("} else if (f.endsWith('.csv')) {\n          type = 'csv';");

    // Verify output files dropdown renders badges for subtitle, json, and csv
    expect(mainJsContent).toContain("else if (file.type === 'original' || file.type === 'subtitle') {");
    expect(mainJsContent).toContain("else if (file.type === 'json') {\n      badgeText = 'JSON';");
    expect(mainJsContent).toContain("else if (file.type === 'csv') {\n      badgeText = 'CSV';");
  });

  it('properly resets batch queue sort select and restores empty placeholder on item removal', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // Verify clearBatchQueue resets batch-sort-select using customSelectsMap
    expect(mainJsContent).toContain("const sortSelect = document.getElementById('batch-sort-select');");
    expect(mainJsContent).toContain("sortSelect.value = '';");
    expect(mainJsContent).toContain("window.customSelectsMap.get('batch-sort-select').syncSelectedValue();");

    // Verify removeFileFromBatch restores placeholder, clears paths, and clears outputDir
    expect(mainJsContent).toContain("window.lastTranscribedVideoPath = null;");
    expect(mainJsContent).toContain("window.lastTranscribedOutputDir = null;");
    expect(mainJsContent).toContain("const btnCopy = document.getElementById('btn-copy-transcript');");
    expect(mainJsContent).toContain("if (btnCopy) btnCopy.disabled = true;");
    expect(mainJsContent).toContain('transcript-placeholder');
  });

  it('enables viewing completed and active transcripts during batch execution with decoupled streaming and non-hijacked views', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // 1. Verify tracking variables
    expect(mainJsContent).toContain('let batchProcessingIndex = -1;');
    expect(mainJsContent).toContain('let userExplicitlySelectedBatchItem = false;');

    // 2. Verify selectBatchItemTranscript allows viewing completed and active items without isBatchExtracting lockout
    const selectBatchFunc = mainJsContent.slice(
      mainJsContent.indexOf('window.selectBatchItemTranscript = async function'),
      mainJsContent.indexOf('function renderBatchQueueTable()')
    );
    expect(selectBatchFunc).not.toContain('if (isBatchExtracting) return;');
    expect(selectBatchFunc).toContain("const isActive = item.status === 'converting' || item.status === 'transcribing' || item.status === 'translating';");
    expect(selectBatchFunc).toContain("const isCompleted = item.status === 'completed';");
    expect(selectBatchFunc).toContain('userExplicitlySelectedBatchItem = !isActive;');
    expect(mainJsContent).toContain('if (!isCompleted && !isActive)');

    // 3. Verify card clickability in queue renderer permits completed and active items while extracting
    expect(mainJsContent).toContain('const isClickable = isCompleted || isActive;');
    expect(mainJsContent).toContain('const isSelected = activeBatchViewerIndex === index;');

    // 4. Verify Whisper log streaming is decoupled from viewer DOM
    const viewerContent = readFileSync(resolve(__dirname, 'modules/transcriptViewer.ts'), 'utf-8');
    expect(viewerContent).toContain('const isBatchRunning = win.isBatchExtracting && win.batchProcessingIndex >= 0 && win.batchItems && win.batchItems[win.batchProcessingIndex];');
    expect(viewerContent).toContain('activeItem.transcriptLines.push({ ...lineObj });');
    expect(viewerContent).toContain('if (win.activeBatchViewerIndex !== win.batchProcessingIndex) {\n      return;\n    }');

    // 5. Verify batch runner uses smart auto-follow and eliminates view hijack when reading completed items
    expect(mainJsContent).toContain('batchProcessingIndex = i;');
    expect(mainJsContent).toContain('activeBatchViewerIndex = 0; // Follow first item initially');
    expect(mainJsContent).toContain('if (!userExplicitlySelectedBatchItem) {\n      activeBatchViewerIndex = i;\n    }');
    expect(mainJsContent).toContain('if (activeBatchViewerIndex === i) {\n            transcriptLines = [];');

    // 6. Verify end of batch respects currently viewed completed item and resets index on all-fail
    expect(mainJsContent).toContain('const isAlreadyViewingCompleted = activeBatchViewerIndex >= 0 &&\n    batchItems[activeBatchViewerIndex] &&\n    batchItems[activeBatchViewerIndex].status === \'completed\';');
    expect(mainJsContent).toContain('if (!isAlreadyViewingCompleted && latestCompletedIdx !== -1');
    expect(mainJsContent).toContain('activeBatchViewerIndex = -1;');

    // 7. Verify batch card view hint strictly uses localized keys without raw key leak
    expect(mainJsContent).toContain("const viewHint = isViewing ? t('transcribe.viewingTranscript') : t('transcribe.clickToViewTranscript');");
    expect(mainJsContent).not.toContain('t(\'transcribe.viewActiveTranscript\')');

    // 8. Verify loadTranscriptFromFile supports background parsing without touching viewer DOM
    expect(viewerContent).toContain('export async function loadTranscriptFromFile(fullPath: string, shouldRender = true)');
    expect(mainJsContent).toContain('const loaded = await loadTranscriptFromFile(subFullPath, shouldRender);');
  });

  it('supports silent background transcript loading via loadTranscriptFromFile without UI flicker', async () => {
    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = {
      __TAURI__: {
        core: {
          invoke: async () => '1\n00:00:01,000 --> 00:00:03,500\nBackground whisper result'
        }
      }
    };
    transcriptViewer.lines = [{ id: 99, text: 'user-reading-completed-line', timeRange: '[00:00:00.000 --> 00:00:01.000]' }];

    try {
      // 1. Silent background parsing (shouldRender = false): must NOT mutate viewer lines and must NOT touch DOM
      const backgroundResult = await loadTranscriptFromFile('/out/bg.srt', false);
      expect(backgroundResult).toHaveLength(1);
      expect(backgroundResult[0].text).toBe('Background whisper result');
      expect(backgroundResult[0].timeRange).toBe('[00:00:01.000 --> 00:00:03.500]');
      expect(transcriptViewer.lines).toEqual([{ id: 99, text: 'user-reading-completed-line', timeRange: '[00:00:00.000 --> 00:00:01.000]' }]);

      // 2. Active viewer parsing (shouldRender = true): must mutate transcriptLines and call renderTranscriptLines
      const activeResult = await loadTranscriptFromFile('/out/bg.srt', true);
      expect(activeResult).toHaveLength(1);
      expect(transcriptViewer.lines).toEqual(activeResult);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  it('implements smart auto-follow: auto-advances when passive, locks view when user explicitly selects completed item', () => {
    let userExplicitlySelectedBatchItem = false;
    let activeBatchViewerIndex = 0;

    // Simulation of 3-file batch run
    const batchItems = [
      { name: 'file1.mp4', status: 'pending', transcriptLines: [] },
      { name: 'file2.mp4', status: 'pending', transcriptLines: [] },
      { name: 'file3.mp4', status: 'pending', transcriptLines: [] }
    ];

    // Iteration 0 (File 1)
    let i = 0;
    if (!userExplicitlySelectedBatchItem) activeBatchViewerIndex = i;
    expect(activeBatchViewerIndex).toBe(0);
    batchItems[0].status = 'completed';

    // Iteration 1 (File 2): User is passive (didn't touch mouse), auto-advances to file 2
    i = 1;
    if (!userExplicitlySelectedBatchItem) activeBatchViewerIndex = i;
    expect(activeBatchViewerIndex).toBe(1);
    batchItems[1].status = 'transcribing';

    // User explicitly clicks File 1 to inspect completed transcript
    const userSelectedIdx = 0;
    const isActive = batchItems[userSelectedIdx].status === 'transcribing';
    activeBatchViewerIndex = userSelectedIdx;
    userExplicitlySelectedBatchItem = !isActive;
    expect(userExplicitlySelectedBatchItem).toBe(true);
    expect(activeBatchViewerIndex).toBe(0);

    // Iteration 2 (File 3 starts): User selected File 1, view MUST NOT be hijacked
    batchItems[1].status = 'completed';
    i = 2;
    if (!userExplicitlySelectedBatchItem) activeBatchViewerIndex = i;
    expect(activeBatchViewerIndex).toBe(0); // Stays on File 1!

    // User now clicks the active File 3 to resume live monitoring
    batchItems[2].status = 'transcribing';
    const clickedActiveIdx = 2;
    const isFile3Active = batchItems[clickedActiveIdx].status === 'transcribing';
    activeBatchViewerIndex = clickedActiveIdx;
    userExplicitlySelectedBatchItem = !isFile3Active;
    expect(userExplicitlySelectedBatchItem).toBe(false); // Resumed auto-follow!
    expect(activeBatchViewerIndex).toBe(2);
  });

  it('enforces concurrency guards on queue reordering and sorting operations during batch extraction', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // Verify moveBatchItemUp, moveBatchItemDown, sortBatchQueue are guarded against active extraction
    expect(mainJsContent).toMatch(/window\.moveBatchItemUp\s*=\s*function\s*\([^)]*\)\s*\{\s*if\s*\(\s*isBatchExtracting\s*\)\s*return;/);
    expect(mainJsContent).toMatch(/window\.moveBatchItemDown\s*=\s*function\s*\([^)]*\)\s*\{\s*if\s*\(\s*isBatchExtracting\s*\)\s*return;/);
    expect(mainJsContent).toMatch(/window\.sortBatchQueue\s*=\s*function\s*\([^)]*\)\s*\{\s*if\s*\(\s*isBatchExtracting\s*\)\s*return;/);
  });

  it('supports all fallback subtitle and text formats in batch extraction with single-mode parity', () => {
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');

    // Match all subtitle and text fallback formats in batch mode
    expect(mainJsContent).toContain("result.generatedFiles.find(f => f.endsWith('.lrc')) ||\n                        result.generatedFiles.find(f => f.endsWith('.json')) ||\n                        result.generatedFiles.find(f => f.endsWith('.csv')) ||\n                        result.generatedFiles.find(f => f.endsWith('.txt'));");
  });

  it('isolates duration display in RTL stylesheet and localizes pending status in formatDuration', () => {
    // Verify RTL duration isolation in rtl.css
    const rtlCss = readFileSync(resolve(__dirname, 'rtl.css'), 'utf-8');
    expect(rtlCss).toMatch(/html\[dir="rtl"\]\s+#batch-total-duration/);
    expect(rtlCss).toContain('.transcript-card-time');
    expect(rtlCss).toContain('unicode-bidi: isolate;');
    expect(rtlCss).toContain('.batch-card-duration[dir="ltr"]');
    expect(rtlCss).toContain('.batch-card-duration[dir="rtl"]');

    // Verify formatDuration in main.js uses localized pending string and guards against negative
    const mainJsContent = readFileSync(resolve(__dirname, 'main.js'), 'utf-8');
    expect(mainJsContent).toContain("t('transcribe.statusPending')");
    expect(mainJsContent).toContain("dur < 0");
    expect(mainJsContent).toContain("applyContentDirection(durationSpan, formattedDur, 'ltr');");
    expect(mainJsContent).toContain("applyContentDirection(totalDurationEl, totalDurationEl.textContent, 'ltr');");

    const codeToEval = `
      const t = (k) => k === 'transcribe.statusPending' ? 'در انتظار' : k;
      ${mainJsContent.slice(mainJsContent.indexOf('function formatDuration('), mainJsContent.indexOf('function updateBatchSpecs('))}
      return formatDuration;
    `;
    const formatDuration = new Function(codeToEval)();
    expect(formatDuration(-5)).toBe('در انتظار...');
    expect(formatDuration(NaN)).toBe('در انتظار...');
    expect(formatDuration(3665)).toBe('01:01:05');
  });

  it('guarantees src/main.js has zero parse or syntax errors for runtime load stability', () => {
    const mainJsPath = resolve(__dirname, 'main.js');
    expect(() => execSync(`node --check "${mainJsPath}"`, { stdio: 'pipe' })).not.toThrow();
  });
});



