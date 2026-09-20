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
  }
});
