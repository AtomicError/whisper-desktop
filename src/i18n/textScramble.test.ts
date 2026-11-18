import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  scrambleText,
  scrambleBatch,
  cancelActiveScramble,
  CYBER_HACKER_GLYPHS
} from './textScramble';

class MockElement {
  public textContent = '';
  public classList = {
    _classes: new Set<string>(),
    add: (cls: string) => { this.classList._classes.add(cls); },
    remove: (cls: string) => { this.classList._classes.delete(cls); },
    contains: (cls: string) => this.classList._classes.has(cls)
  };

  constructor(initialText = '') {
    this.textContent = initialText;
  }
}

describe('textScramble Engine', () => {
  describe('scrambleText pure algorithm', () => {
    it('returns original text when progress is zero or negative', () => {
      expect(scrambleText('English', 'فارسی', 0)).toBe('English');
      expect(scrambleText('English', 'فارسی', -0.5)).toBe('English');
    });

    it('returns target text when progress reaches or exceeds 1.0', () => {
      expect(scrambleText('English', 'فارسی', 1.0)).toBe('فارسی');
      expect(scrambleText('English', 'فارسی', 1.5)).toBe('فارسی');
    });

    it('preserves spaces so word boundaries do not collapse', () => {
      const from = 'Transcription Studio';
      const to = 'استودیوی رونویسی';
      const result = scrambleText(from, to, 0.5);

      const toSpaceIdx = to.indexOf(' ');
      expect(toSpaceIdx).toBeGreaterThan(0);
      expect(result[toSpaceIdx]).toBe(' ');
    });

    it('preserves Persian zero-width non-joiner (ZWNJ / نیم‌فاصله)', () => {
      const from = 'Settings';
      const to = 'تنظیمات\u200cها'; // contains ZWNJ
      const result = scrambleText(from, to, 0.5);

      const zwnjIdx = to.indexOf('\u200c');
      expect(zwnjIdx).toBeGreaterThan(0);
      expect(result[zwnjIdx]).toBe('\u200c');
    });

    it('does not erase deciphered target characters when previous text had spaces or ZWNJ', () => {
      // fromText has spaces at 1, 3, 5; targetText has no spaces
      const res = scrambleText('A B C D', '1234567', 0.8);
      // At progress 0.8, cursor is at index 6, characters 0-5 must be '123456'
      expect(res.slice(0, 6)).toBe('123456');

      // fromText has ZWNJ at index 7 ('تنظیمات\u200cها'); targetText has 'n' at index 7 ('Preferences')
      const resZwnj = scrambleText('تنظیمات\u200cها', 'Preferences', 0.8);
      expect(resZwnj.slice(0, 9)).toBe('Preferenc');
    });

    it('handles transition between different string lengths gracefully', () => {
      const shortStr = 'Logs';
      const longStr = 'گزارش‌های سیستم';
      const result = scrambleText(shortStr, longStr, 0.6);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles empty strings cleanly without throwing', () => {
      expect(scrambleText('', '', 0.5)).toBe('');
      expect(scrambleText('Test', '', 1.0)).toBe('');
      expect(scrambleText('', 'Target', 1.0)).toBe('Target');
    });

    it('uses provided custom characters for scrambling', () => {
      const from = 'AAAA';
      const to = 'BBBB';
      const customChars = '$';
      const result = scrambleText(from, to, 0.35, customChars);

      expect(result).toContain('$');
    });
  });

  describe('scrambleBatch DOM animation', () => {
    let mockEl1: any;
    let mockEl2: any;
    let rafCallbacks: Array<(time: number) => void> = [];

    beforeEach(() => {
      mockEl1 = new MockElement('Transcribe');
      mockEl2 = new MockElement('Translate');
      rafCallbacks = [];

      vi.stubGlobal('requestAnimationFrame', (cb: (time: number) => void) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
      vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
      cancelActiveScramble();
      vi.unstubAllGlobals();
    });

    it('attaches text-scrambling class during animation and removes it on completion', () => {
      let completed = false;
      const cancel = scrambleBatch(
        [
          { el: mockEl1, targetText: 'رونویسی' },
          { el: mockEl2, targetText: 'ترجمه' }
        ],
        {
          duration: 100,
          onComplete: () => {
            completed = true;
          }
        }
      );

      // Animation is in flight
      expect(mockEl1.classList.contains('text-scrambling')).toBe(true);
      expect(mockEl2.classList.contains('text-scrambling')).toBe(true);

      // Cancel / finish
      cancel();

      expect(mockEl1.classList.contains('text-scrambling')).toBe(false);
      expect(mockEl2.classList.contains('text-scrambling')).toBe(false);
      expect(mockEl1.textContent).toBe('رونویسی');
      expect(mockEl2.textContent).toBe('ترجمه');
    });

    it('consecutive scrambleBatch calls cancel previous animation cleanly without text corruption', () => {
      scrambleBatch(
        [{ el: mockEl1, targetText: 'میانی' }],
        { duration: 200 }
      );

      // Second immediate call
      scrambleBatch(
        [{ el: mockEl1, targetText: 'نهایی' }],
        { duration: 200 }
      );

      // Cancelling all
      cancelActiveScramble();

      expect(mockEl1.textContent).toBe('نهایی');
      expect(mockEl1.classList.contains('text-scrambling')).toBe(false);
    });

    it('handles empty item array safely', () => {
      let done = false;
      scrambleBatch([], { onComplete: () => { done = true; } });
      expect(done).toBe(true);
    });
  });
});
