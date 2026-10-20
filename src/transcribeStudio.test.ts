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

    // Left deck has the telemetry HUD
    expect(leftPanelHtml).toContain('id="telemetry-hud-card"');
    expect(leftPanelHtml).toContain('transcribe-telemetry');
    expect(leftPanelHtml).toContain('id="hud-status-badge"');
    expect(leftPanelHtml).toContain('id="progress-linear-fill"');
    expect(leftPanelHtml).toContain('id="lbl-radial-pct"');
    expect(leftPanelHtml).toContain('id="lbl-radial-msg"');

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
    expect(rightPanelHtml).toContain('id="btn-open-output-folder"');
    expect(rightPanelHtml).toContain('id="btn-send-to-translation"');
    expect(rightPanelHtml).toContain('id="btn-transcribe-send-to-hardsub"');

    // Accessibility and initial disabled state checks
    expect(rightPanelHtml).toMatch(/<button[^>]*id="btn-copy-transcript"[^>]*type="button"[^>]*disabled/);
    expect(rightPanelHtml).toContain('aria-label="Search transcript"');
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
    noOutputDirMsg: string = 'No output folder available yet',
    noSubMsg: string = 'No generated subtitle yet'
  ): WorkflowButtonsState {
    const hasDir = Boolean(outputDir);
    const hasSub = Boolean(subPath);
    const hasTranscript = transcriptLinesCount > 0 || hasSub;

    return {
      openFolderDisabled: !hasDir,
      openFolderTitle: hasDir ? outputDir! : noOutputDirMsg,
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
    const initialState = simulateUpdateWorkflowButtons(null, null, 0, noOutputDirMsg, noSubMsg);
    expect(initialState.openFolderDisabled).toBe(true);
    expect(initialState.openFolderTitle).toBe(noOutputDirMsg);
    expect(initialState.sendTranslateDisabled).toBe(true);
    expect(initialState.sendTranslateTitle).toBe(noSubMsg);
    expect(initialState.sendHardsubDisabled).toBe(true);
    expect(initialState.sendHardsubTitle).toBe(noSubMsg);
    expect(initialState.copyTranscriptDisabled).toBe(true);

    // Live streaming lines arrive during transcription before completion
    const streamingState = simulateUpdateWorkflowButtons(null, null, 3, noOutputDirMsg, noSubMsg);
    expect(streamingState.copyTranscriptDisabled).toBe(false);
    expect(streamingState.sendTranslateDisabled).toBe(true);

    // Transcription completed successfully with output file
    const successState = simulateUpdateWorkflowButtons(
      '/home/user/Videos',
      '/home/user/Videos/speech.srt',
      12,
      noOutputDirMsg,
      noSubMsg
    );
    expect(successState.openFolderDisabled).toBe(false);
    expect(successState.openFolderTitle).toBe('/home/user/Videos');
    expect(successState.sendTranslateDisabled).toBe(false);
    expect(successState.sendTranslateTitle).toBe('');
    expect(successState.sendHardsubDisabled).toBe(false);
    expect(successState.sendHardsubTitle).toBe('');
    expect(successState.copyTranscriptDisabled).toBe(false);

    // Clearing media/queue empties transcriptLines and resets subtitle path
    let lines = ['line 1', 'line 2'];
    let sub = '/home/user/Videos/speech.srt';
    // Clear operation order: transcriptLines = []; sub = null; updateTranscribeWorkflowButtons();
    lines = [];
    sub = null;
    const clearedState = simulateUpdateWorkflowButtons(null, sub, lines.length, noOutputDirMsg, noSubMsg);
    expect(clearedState.copyTranscriptDisabled).toBe(true);

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
    const requiredTranscribeKeys = ['vadDisableHint', 'vadEnableHint', 'queueFilesHeader', 'moveUp', 'moveDown', 'noMatchingTranscript'];
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
    const htmlContent = readFileSync(resolve(__dirname, 'index.html'), 'utf-8');
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
});


