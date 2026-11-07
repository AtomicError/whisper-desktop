import { describe, expect, it } from 'vitest';
import {
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  formatLocalizedNumber
} from './formatters';

describe('i18n Formatters Unit Tests', () => {
  describe('toEnglishDigits', () => {
    it('converts Persian digits to standard ASCII digits', () => {
      expect(toEnglishDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
      expect(toEnglishDigits('مدل ۱۲۳')).toBe('مدل 123');
    });

    it('converts Arabic digits to standard ASCII digits', () => {
      expect(toEnglishDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
      expect(toEnglishDigits('رقم ٤٥٦')).toBe('رقم 456');
    });

    it('handles non-string, null, and undefined values safely', () => {
      expect(toEnglishDigits(null)).toBe('');
      expect(toEnglishDigits(undefined)).toBe('');
      expect(toEnglishDigits(12345)).toBe('12345');
    });
  });

  describe('formatTokensShort', () => {
    it('formats round and large token counts using K and M suffixes', () => {
      expect(formatTokensShort(2000000)).toBe('2M');
      expect(formatTokensShort(1048576)).toBe('1M');
      expect(formatTokensShort(128000)).toBe('128K');
      expect(formatTokensShort(1500000)).toBe('1.5M');
      expect(formatTokensShort(4500)).toBe('4.5K');
    });

    it('returns 0 or local formatted string for small/invalid inputs', () => {
      expect(formatTokensShort(0)).toBe('0');
      expect(formatTokensShort(-10)).toBe('0');
      expect(formatTokensShort('invalid')).toBe('0');
      expect(formatTokensShort(500)).toBe('500');
    });
  });

  describe('parseTokensInput', () => {
    it('parses numbers directly', () => {
      expect(parseTokensInput(128000)).toBe(128000);
      expect(parseTokensInput(0)).toBe(200000);
    });

    it('parses token shorthand strings with M, K, and commas', () => {
      expect(parseTokensInput('2M')).toBe(2000000);
      expect(parseTokensInput('1.5M tokens')).toBe(1500000);
      expect(parseTokensInput('128k')).toBe(128000);
      expect(parseTokensInput('32,000')).toBe(32000);
      expect(parseTokensInput('۲M')).toBe(2000000);
    });

    it('falls back to default 200,000 for invalid/empty input', () => {
      expect(parseTokensInput('')).toBe(200000);
      expect(parseTokensInput(null)).toBe(200000);
      expect(parseTokensInput('invalid string')).toBe(200000);
    });
  });

  describe('formatNumberForLang', () => {
    const win = (typeof window !== 'undefined' ? window : globalThis) as any;

    it('converts digits to Persian when language is fa', () => {
      win.getLanguage = () => 'fa';
      expect(formatNumberForLang(12345)).toBe('۱۲۳۴۵');
      expect(formatNumberForLang('100 MB')).toBe('۱۰۰ MB');
    });

    it('converts digits to Arabic when language is ar', () => {
      win.getLanguage = () => 'ar';
      expect(formatNumberForLang(12345)).toBe('١٢٣٤٥');
    });

    it('keeps standard ASCII digits for English and other languages', () => {
      win.getLanguage = () => 'en';
      expect(formatNumberForLang(12345)).toBe('12345');
    });

    it('handles null and undefined gracefully', () => {
      expect(formatNumberForLang(null)).toBe('');
      expect(formatNumberForLang(undefined)).toBe('');
    });
  });

  describe('formatLocalizedNumber', () => {
    it('formats localized numbers using Intl.NumberFormat according to language', () => {
      expect(formatLocalizedNumber(1250.5, 'en', 1)).toBe('1,250.5');
      expect(formatLocalizedNumber(null)).toBe('');
      expect(formatLocalizedNumber('not a number')).toBe('');
    });
  });
});
