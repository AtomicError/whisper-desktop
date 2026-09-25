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
        'recReasonFastEnBudget',
        'recReasonQualityMediumEn',
        'recReasonBalancedEnCapable',
        'recReasonFastEnCapable',
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
  }

  it('validates fa locale translation improvements', () => {
    expect(fa.transcribe.wizardStep3).toBe('شروع رونویسی');
    expect(fa.settings.aiTranslatePoints).toContain('<bdi>OpenAI</bdi>، <bdi>Claude</bdi>');
    expect(fa.settings.targetLangPoints).toContain('بیش از ۱۰۰ زبان زنده دنیا با رسم‌الخط بومی');
    expect(fa.settings.providerCustomPromptPlaceholder).toBe('شما یک مترجم حرفه‌ای هستید...');
    expect(fa.translate.sourceSub).toBe('زیرنویس اصلی');
    expect(fa.translate.viewSource).toBe('فقط اصلی');
    expect(fa.translate.sameAsSource).toBe('مشابه پوشه فایل اصلی');
    expect(fa.hardsub.videoSection).toBe('ویدیوی اصلی');
    expect(fa.translate.progressLines).toContain('{current}');
  });
});

