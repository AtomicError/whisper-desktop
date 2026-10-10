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

describe('locale consistency for speed presets', () => {
  const locales = { ar, de, en, es, fa, fr, it: itLocale, ja, ko, pt, ru, tr, zh };

  for (const [code, dict] of Object.entries(locales)) {
    it(`locale ${code} has all required speed preset keys`, () => {
      expect(dict).toBeDefined();
      const hardsub = (dict as any).hardsub;
      expect(hardsub).toBeDefined();
      expect(typeof hardsub.speedPresetFast).toBe('string');
      expect(hardsub.speedPresetFast.length).toBeGreaterThan(0);
      expect(typeof hardsub.speedPresetMedium).toBe('string');
      expect(hardsub.speedPresetMedium.length).toBeGreaterThan(0);
      expect(typeof hardsub.speedPresetSlow).toBe('string');
      expect(hardsub.speedPresetSlow.length).toBeGreaterThan(0);
      expect(typeof hardsub.playVideo).toBe('string');
      expect(hardsub.playVideo.length).toBeGreaterThan(0);
      const toasts = (dict as any).toasts;
      expect(toasts).toBeDefined();
      expect(typeof toasts.openVideoError).toBe('string');
      expect(toasts.openVideoError.length).toBeGreaterThan(0);
    });

    it(`locale ${code} has all media metadata specification keys`, () => {
      const transcribe = (dict as any).transcribe;
      expect(transcribe).toBeDefined();
      expect(typeof transcribe.formatVideo).toBe('string');
      expect(transcribe.formatVideo.length).toBeGreaterThan(0);
      expect(typeof transcribe.formatAudio).toBe('string');
      expect(transcribe.formatAudio.length).toBeGreaterThan(0);
      expect(typeof transcribe.formatFile).toBe('string');
      expect(transcribe.formatFile.length).toBeGreaterThan(0);
      expect(typeof transcribe.backendStandard).toBe('string');
      expect(transcribe.backendStandard.length).toBeGreaterThan(0);
      expect(typeof transcribe.backendStatus).toBe('string');
      expect(transcribe.backendStatus).toContain('{backend}');
      expect(transcribe.backendStatus).toContain('{threads}');
      expect(typeof transcribe.unitGB).toBe('string');
      expect(typeof transcribe.unitMB).toBe('string');
      expect(typeof transcribe.unitKB).toBe('string');
      expect(typeof transcribe.unitB).toBe('string');
      expect(typeof transcribe.durationHours).toBe('string');
      expect(typeof transcribe.durationHoursMinutes).toBe('string');
      expect(typeof transcribe.durationHoursMinutesSeconds).toBe('string');
      expect(typeof transcribe.durationMinutesSeconds).toBe('string');
      expect(typeof transcribe.durationMinutes).toBe('string');
      expect(typeof transcribe.durationSeconds).toBe('string');
      expect(typeof transcribe.timecodeTooltip).toBe('string');
      expect(transcribe.timecodeTooltip).toContain('{timecode}');
    });

    it(`locale ${code} has all required transcribe progress and status keys`, () => {
      const transcribe = (dict as any).transcribe;
      expect(transcribe).toBeDefined();
      const requiredKeys = [
        'convertingAudio16k',
        'wavReadyTranscribing',
        'progressTranscribe',
        'aiTranscribingStatus',
        'progressComplete',
        'readyForTranscription',
        'standingBy',
        'cancelled',
        'taskFailed',
        'convertingProgress',
        'batchCompletedSummary',
        'batchExtractionCancelled'
      ];
      for (const key of requiredKeys) {
        expect(typeof transcribe[key]).toBe('string');
        expect(transcribe[key].length).toBeGreaterThan(0);
      }
    });

    it(`locale ${code} formats transcription and translation errors on newlines`, () => {
      const toasts = (dict as any).toasts;
      expect(toasts).toBeDefined();
      expect(toasts.transcriptionError).toContain(':\n{error}');
      expect(toasts.aiTranslateError).toContain(':\n{error}');
      expect(typeof toasts.logsCopiedWhisper).toBe('string');
      expect(typeof toasts.logsCopiedTranslate).toBe('string');
      expect(typeof toasts.logsCopiedFiltered).toBe('string');
      expect(typeof toasts.noMatchingLogsToCopy).toBe('string');
    });

    it(`locale ${code} has all required log scroll keys`, () => {
      const logs = (dict as any).logs;
      expect(logs).toBeDefined();
      const requiredLogKeys = ['scrollToBottom', 'scrollToTop', 'jumpToBottom'];
      for (const key of requiredLogKeys) {
        expect(typeof logs[key]).toBe('string');
        expect(logs[key].length).toBeGreaterThan(0);
      }
    });

    it(`locale ${code} has all required GPU hardware spec keys`, () => {
      const models = (dict as any).models;
      expect(models).toBeDefined();
      const requiredGpuKeys = ['gpuNvidia', 'gpuAmd', 'gpuIntel', 'gpuAppleSilicon', 'gpuCpuOnly', 'gpuUnknown'];
      for (const key of requiredGpuKeys) {
        expect(typeof models[key]).toBe('string');
        expect(models[key].length).toBeGreaterThan(0);
      }
    });

    it(`locale ${code} has all required model recommendation scenario and filter keys`, () => {
      const models = (dict as any).models;
      expect(models).toBeDefined();
      const requiredScenarioKeys = [
        'recFilterUniversal',
        'recFilterEn',
        'recFilterQuant',
        'recFilterUniversalTooltip',
        'recFilterEnTooltip',
        'recFilterQuantTooltip',
        'recRoleEnglish',
        'recRoleQuantized',
        'recTitleEnglish',
        'recTitleQuantized',
        'recReasonBalancedEnEntry',
        'recReasonQualityEnEntry',
        'recReasonFastEnEntry',
        'recReasonBalancedEnBudget',
        'recReasonQualityMediumEnQuant',
        'recReasonQualityMediumEnQ8',
        'recReasonFastEnBudget',
        'recReasonQualityMediumEn',
        'recReasonBalancedEnCapable',
        'recReasonFastEnCapable',
        'recReasonBalancedBaseQuant',
        'recReasonBalancedQuant',
        'recReasonQualityQuantLarge',
        'recReasonQualityQuantTurbo',
        'recReasonFastQuant',
      ];
      for (const key of requiredScenarioKeys) {
        expect(typeof models[key]).toBe('string');
        expect(models[key].length).toBeGreaterThan(0);
      }
    });

    it(`locale ${code} has all required provider and format keys`, () => {
      const settings = (dict as any).settings;
      expect(settings).toBeDefined();
      const requiredSettingsKeys = [
        'addProvider',
        'activeBadge',
        'inactiveBadge',
        'clearSearch'
      ];
      for (const key of requiredSettingsKeys) {
        expect(typeof settings[key]).toBe('string');
        expect(settings[key].length).toBeGreaterThan(0);
      }
    });
    it(`locale ${code} has common.select defined`, () => {
      const common = (dict as any).common;
      expect(common).toBeDefined();
      expect(typeof common.select).toBe('string');
      expect(common.select.length).toBeGreaterThan(0);
    });
    it(`locale ${code} has models.speedUnitMB and models.speedUnitKB defined`, () => {
      const models = (dict as any).models;
      expect(models).toBeDefined();
      expect(typeof models.speedUnitMB).toBe('string');
      expect(models.speedUnitMB.length).toBeGreaterThan(0);
      expect(typeof models.speedUnitKB).toBe('string');
      expect(models.speedUnitKB.length).toBeGreaterThan(0);
    });

    it(`locale ${code} has models.unitMB and models.unitKB defined`, () => {
      const models = (dict as any).models;
      expect(models).toBeDefined();
      expect(typeof models.unitMB).toBe('string');
      expect(models.unitMB.length).toBeGreaterThan(0);
      expect(typeof models.unitKB).toBe('string');
      expect(models.unitKB.length).toBeGreaterThan(0);
    });

    it(`locale ${code} has models.installedSize and translate.deckTitle defined`, () => {
      const models = (dict as any).models;
      expect(models).toBeDefined();
      expect(typeof models.installedSize).toBe('string');
      expect(models.installedSize.length).toBeGreaterThan(0);
      expect(models.installedSize).toContain('{size}');

      const translate = (dict as any).translate;
      expect(translate).toBeDefined();
      expect(typeof translate.deckTitle).toBe('string');
      expect(translate.deckTitle.length).toBeGreaterThan(0);
    });

    it(`locale ${code} uses clean transcription terminology without generic Whisper branding`, () => {
      const models = (dict as any).models;
      const transcribe = (dict as any).transcribe;
      const settings = (dict as any).settings;

      expect(models.title).not.toMatch(/\bwhisper\b/i);
      expect(models.title).not.toContain('ویسپر');

      expect(transcribe.modelLabel).not.toMatch(/\bwhisper\b/i);
      expect(transcribe.modelLabel).not.toContain('ویسپر');

      expect(transcribe.taskLabel).not.toMatch(/\bwhisper\b/i);
      expect(transcribe.taskLabel).not.toContain('ویسپر');

      expect(transcribe.progressTranscribe).not.toMatch(/\bwhisper\b/i);
      expect(transcribe.progressTranscribe).not.toContain('ویسپر');

      expect(transcribe.pipelineDesc).not.toMatch(/\bwhisper\b/i);
      expect(transcribe.pipelineDesc).not.toContain('ویسپر');

      expect(settings.modelSelectDesc).not.toMatch(/\bwhisper\b/i);
      expect(settings.modelSelectDesc).not.toContain('ویسپر');

      expect(settings.backendDesc).not.toMatch(/\bwhisper\b/i);
      expect(settings.backendDesc).not.toContain('ویسپر');

      expect(settings.threadsDesc).not.toMatch(/\bwhisper\b/i);
      expect(settings.threadsDesc).not.toContain('ویسپر');

      expect(settings.resetDesc).not.toMatch(/\bwhisper\b/i);
      expect(settings.resetDesc).not.toContain('ویسپر');
    });
  }

  it('validates fa locale translation improvements', () => {
    expect(fa.common.select).toBe('انتخاب...');
    expect(fa.models.speedUnitMB).toBe('مگابایت بر ثانیه');
    expect(fa.models.speedUnitKB).toBe('کیلوبایت بر ثانیه');
    expect(fa.transcribe.wizardStep3).toBe('شروع رونویسی');
    expect(fa.models.title).toBe('مرکز مدل‌های رونویسی');
    expect(fa.transcribe.modelLabel).toBe('مدل رونویسی');
    expect(fa.transcribe.taskLabel).toBe('نوع عملیات');
    expect(fa.transcribe.taskTranslate).toBe('ترجمه به انگلیسی (موتور صوتی داخلی)');
    expect(fa.transcribe.progressTranscribe).toBe('در حال تبدیل گفتار به متن...');
    expect(fa.settings.printSpecialDesc).not.toContain('ویسپر');
    expect(fa.settings.aiTranslatePoints).toContain('<bdi>OpenAI</bdi>، <bdi>Claude</bdi>');
    expect(fa.settings.targetLangPoints).toContain('بیش از ۱۰۰ زبان زنده دنیا با رسم‌الخط بومی');
    expect(fa.settings.providerCustomPromptPlaceholder).toBe('شما یک مترجم حرفه‌ای هستید...');
    expect(fa.settings.addProvider).toBe('افزودن ارائه‌دهنده');
    expect(fa.settings.activeBadge).toBe('فعال');
    expect(fa.settings.inactiveBadge).toBe('غیرفعال');
    expect(fa.translate.sourceSub).toBe('زیرنویس اصلی');
    expect(fa.translate.viewSource).toBe('فقط اصلی');
    expect(fa.translate.sameAsSource).toBe('مشابه پوشه فایل اصلی');
    expect(fa.hardsub.videoSection).toBe('ویدیوی اصلی');
    expect(fa.hardsub.playVideo).toBe('پخش ویدیو');
    expect(fa.translate.progressLines).toContain('{current}');
  });

  it('validates en locale terminology improvements', () => {
    expect(en.models.title).toBe('Model Hub');
    expect(en.transcribe.modelLabel).toBe('Transcription Model');
    expect(en.transcribe.modelPlaceholder).toBe('Select a transcription model...');
    expect(en.transcribe.taskLabel).toBe('Task Type');
    expect(en.transcribe.taskTranslate).toBe('Translate to English (Built-in Engine)');
    expect(en.transcribe.progressTranscribe).toBe('Transcribing speech...');
    expect(en.transcribe.pipelineDesc).toBe('FFmpeg Conversion & Audio Transcription');
    expect(en.models.guideHeroTitle).toBe('Transcription Model Architecture & Selection Guide');
  });
});

