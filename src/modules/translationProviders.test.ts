import { describe, expect, it, beforeEach } from 'vitest';
import {
  translationProviders,
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  isReasoningSupportedModel,
  formatLocalizedNumber,
  POPULAR_PROVIDER_FILTERS,
  type ModelObject
} from './translationProviders';

describe('translationProviders module', () => {
  beforeEach(() => {
    translationProviders.setModels([]);
    translationProviders.setPage(1);
    translationProviders.setPageSize(20);
    translationProviders.setStatusFilter('all');
  });

  describe('toEnglishDigits conversion', () => {
    it('converts Persian digits to English ASCII digits', () => {
      expect(toEnglishDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
      expect(toEnglishDigits('مدل ۱۲۸k')).toBe('مدل 128k');
    });

    it('converts Arabic digits to English ASCII digits', () => {
      expect(toEnglishDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    });

    it('returns empty string or non-string inputs safely', () => {
      expect(toEnglishDigits('')).toBe('');
      expect(toEnglishDigits(null)).toBe('');
      expect(toEnglishDigits(undefined)).toBe('');
      expect(toEnglishDigits(12345)).toBe('12345');
    });
  });

  describe('formatTokensShort formatting', () => {
    it('formats exact standard model context presets', () => {
      expect(formatTokensShort(2000000)).toBe('2M');
      expect(formatTokensShort(2097152)).toBe('2M');
      expect(formatTokensShort(1000000)).toBe('1M');
      expect(formatTokensShort(1048576)).toBe('1M');
      expect(formatTokensShort(512000)).toBe('512K');
      expect(formatTokensShort(524288)).toBe('512K');
      expect(formatTokensShort(256000)).toBe('256K');
      expect(formatTokensShort(128000)).toBe('128K');
      expect(formatTokensShort(64000)).toBe('64K');
      expect(formatTokensShort(32000)).toBe('32K');
      expect(formatTokensShort(16000)).toBe('16K');
      expect(formatTokensShort(8000)).toBe('8K');
      expect(formatTokensShort(4000)).toBe('4K');
    });

    it('formats arbitrary large numbers with M or K suffixes', () => {
      expect(formatTokensShort(1500000)).toBe('1.5M');
      expect(formatTokensShort(50000)).toBe('50K');
      expect(formatTokensShort(500)).toBe('500');
    });

    it('returns 0 for non-positive or invalid token numbers', () => {
      expect(formatTokensShort(0)).toBe('0');
      expect(formatTokensShort(-100)).toBe('0');
      expect(formatTokensShort(NaN)).toBe('0');
      expect(formatTokensShort('invalid')).toBe('0');
    });
  });

  describe('parseTokensInput parsing', () => {
    it('parses numeric values directly', () => {
      expect(parseTokensInput(128000)).toBe(128000);
      expect(parseTokensInput(0)).toBe(200000);
      expect(parseTokensInput(-5)).toBe(200000);
    });

    it('parses strings with M/Million suffix and Persian numerals', () => {
      expect(parseTokensInput('1M')).toBe(1000000);
      expect(parseTokensInput('1.5m')).toBe(1500000);
      expect(parseTokensInput('2 MILLION')).toBe(2000000);
      expect(parseTokensInput('۱M')).toBe(1000000);
    });

    it('parses strings with K/Thousand suffix and comma formatting', () => {
      expect(parseTokensInput('128K')).toBe(128000);
      expect(parseTokensInput('200k tokens')).toBe(200000);
      expect(parseTokensInput('128,000')).toBe(128000);
      expect(parseTokensInput('۶۴k')).toBe(64000);
    });

    it('falls back safely to 200,000 for invalid inputs', () => {
      expect(parseTokensInput('')).toBe(200000);
      expect(parseTokensInput('abc')).toBe(200000);
      expect(parseTokensInput(null)).toBe(200000);
    });
  });

  describe('formatNumberForLang localization', () => {
    it('formats digits according to active language', () => {
      const origGetLang = (globalThis as any).getLanguage;
      try {
        (globalThis as any).getLanguage = () => 'fa';
        expect(formatNumberForLang(123)).toBe('۱۲۳');

        (globalThis as any).getLanguage = () => 'ar';
        expect(formatNumberForLang(123)).toBe('١٢٣');

        (globalThis as any).getLanguage = () => 'en';
        expect(formatNumberForLang(123)).toBe('123');
      } finally {
        (globalThis as any).getLanguage = origGetLang;
      }
    });

    it('returns empty string for null or undefined', () => {
      expect(formatNumberForLang(null)).toBe('');
      expect(formatNumberForLang(undefined)).toBe('');
    });
  });

  describe('isReasoningSupportedModel detection', () => {
    it('detects reasoning support from boolean property', () => {
      expect(isReasoningSupportedModel({ id: 'm1', supportsReasoning: true })).toBe(true);
      expect(isReasoningSupportedModel({ id: 'm2', supportsReasoning: false })).toBe(false);
      expect(isReasoningSupportedModel({ id: 'm3', supports_reasoning: true })).toBe(true);
    });

    it('falls back to reasoning string if boolean is absent', () => {
      expect(isReasoningSupportedModel({ id: 'm1', reasoning: 'Medium' })).toBe(true);
      expect(isReasoningSupportedModel({ id: 'm2', reasoning: 'none' })).toBe(false);
      expect(isReasoningSupportedModel({ id: 'm3', reasoning: '' })).toBe(false);
    });

    it('returns false for falsy or unsupported models', () => {
      expect(isReasoningSupportedModel(null)).toBe(false);
      expect(isReasoningSupportedModel(undefined)).toBe(false);
    });
  });

  describe('POPULAR_PROVIDER_FILTERS tests', () => {
    it('matches known provider model IDs accurately', () => {
      const openai = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'openai');
      expect(openai?.test('gpt-4o')).toBe(true);
      expect(openai?.test('o1-mini')).toBe(true);
      expect(openai?.test('o3-mini')).toBe(true);
      expect(openai?.test('claude-3-opus')).toBe(false);

      const anthropic = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'anthropic');
      expect(anthropic?.test('claude-3-5-sonnet')).toBe(true);

      const google = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'google');
      expect(google?.test('gemini-2.0-flash')).toBe(true);

      const deepseek = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'deepseek');
      expect(deepseek?.test('deepseek-r1')).toBe(true);
    });
  });

  describe('formatLocalizedNumber utility', () => {
    it('formats localized numbers across locales and fraction digits', () => {
      expect(formatLocalizedNumber(1250.5, 'en', 1)).toBe('1,250.5');
      expect(formatLocalizedNumber(10, 'en', 0)).toBe('10');
      expect(formatLocalizedNumber(null)).toBe('');
      expect(formatLocalizedNumber(NaN)).toBe('');
    });
  });

  describe('translationProviders controller state management', () => {
    it('manages in-memory models and pagination state cleanly', () => {
      const models: ModelObject[] = [
        { id: 'gpt-4o', contextWindow: 128000, reasoning: 'None', enabled: true },
        { id: 'claude-3.5-sonnet', contextWindow: 200000, reasoning: 'None', enabled: true }
      ];

      translationProviders.setModels(models);
      expect(translationProviders.getModels()).toHaveLength(2);
      expect(translationProviders.getModels()[0].id).toBe('gpt-4o');

      translationProviders.setPage(3);
      expect(translationProviders.getPage()).toBe(3);

      translationProviders.setPageSize(50);
      expect(translationProviders.getPageSize()).toBe(50);

      translationProviders.setStatusFilter('reasoning');
      expect(translationProviders.getStatusFilter()).toBe('reasoning');
    });

    it('synchronizes window.currentProviderModels getter and setter for backward compatibility', () => {
      const models: ModelObject[] = [
        { id: 'deepseek-chat', contextWindow: 64000, reasoning: 'None', enabled: true }
      ];

      translationProviders.setModels(models);
      expect((window as any).currentProviderModels).toEqual(models);

      (window as any).currentProviderModels = [{ id: 'gemini-2.0-flash', contextWindow: 1048576 }];
      expect(translationProviders.getModels()).toHaveLength(1);
      expect(translationProviders.getModels()[0].id).toBe('gemini-2.0-flash');
    });
  });
});
