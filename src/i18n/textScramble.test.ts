import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  scrambleText,
  scrambleBatch,
  cancelActiveScramble,
  cancelScrambleForElement,
  CYBER_HACKER_GLYPHS
} from './textScramble';
import {
  setLanguage,
  getLanguage,
  initI18n,
  translateDOM
} from './index';

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

class MockTextNode {
  public data: string;
  constructor(data: string) {
    this.data = data;
  }
  get textContent(): string {
    return this.data;
  }
}

class MockBlockSpan {
  public tagName: string;
  public className = '';
  public textContent = '';
  public attributes = new Map<string, string>();
  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }
}

class MockDomElement {
  public classList = {
    _classes: new Set<string>(),
    add: (cls: string) => { this.classList._classes.add(cls); },
    remove: (cls: string) => { this.classList._classes.delete(cls); },
    contains: (cls: string) => this.classList._classes.has(cls)
  };
  public childrenNodes: Array<MockTextNode | MockBlockSpan> = [];
  private _text = '';

  constructor(initialText = '') {
    this._text = initialText;
  }

  get textContent(): string {
    if (this.childrenNodes.length > 0) {
      return this.childrenNodes.map(n => n.textContent).join('');
    }
    return this._text;
  }

  set textContent(val: string) {
    this.childrenNodes = [];
    this._text = val;
  }

  replaceChildren(...nodes: Array<MockTextNode | MockBlockSpan>) {
    this.childrenNodes = nodes;
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
      const to = 'تنظیمات\u200cها';
      const result = scrambleText(from, to, 0.5);

      const zwnjIdx = to.indexOf('\u200c');
      expect(zwnjIdx).toBeGreaterThan(0);
      expect(result[zwnjIdx]).toBe('\u200c');
    });

    it('uses only uniform solid blocks (█) without mixed-density blocks (▓ ▒ ░ ■ ▪)', () => {
      const from = 'Application Theme';
      const to = 'تم ظاهری برنامه';
      const result = scrambleText(from, to, 0.4, undefined, 3, 1);

      expect(result).toContain('█');
      expect(result).not.toMatch(/[▓▒░■▪▫]/);
    });

    it('sweeps a 4 to 5 block window across strings cleanly', () => {
      const from = 'Transcription Studio';
      const to = 'استودیوی رونویسی متن';
      const result = scrambleText(from, to, 0.45, undefined, 2, 1);

      const blockCount = [...result].filter(ch => ch === '█').length;
      expect(blockCount).toBeGreaterThanOrEqual(4);
      expect(blockCount).toBeLessThanOrEqual(5);
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

    it('keeps custom-glyph output deterministic for the same step and evolves across steps', () => {
      const a1 = scrambleText('Transcription Studio', 'استودیوی رونویسی', 0.4, CYBER_HACKER_GLYPHS, 5, 97);
      const a2 = scrambleText('Transcription Studio', 'استودیوی رونویسی', 0.4, CYBER_HACKER_GLYPHS, 5, 97);
      const b1 = scrambleText('Transcription Studio', 'استودیوی رونویسی', 0.4, CYBER_HACKER_GLYPHS, 6, 97);

      expect(a1).toBe(a2);
      expect(b1).not.toBe(a1);
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

      expect(mockEl1.classList.contains('text-scrambling')).toBe(true);
      expect(mockEl2.classList.contains('text-scrambling')).toBe(true);

      cancel();

      expect(mockEl1.classList.contains('text-scrambling')).toBe(false);
      expect(mockEl2.classList.contains('text-scrambling')).toBe(false);
      expect(mockEl1.textContent).toBe('رونویسی');
      expect(mockEl2.textContent).toBe('ترجمه');
      expect(completed).toBe(false);
    });

    it('renders 4 to 5 solid block cells with scramble symbols inside and cleans up to plain text', () => {
      vi.stubGlobal('document', {
        createElement: (tag: string) => new MockBlockSpan(tag),
        createTextNode: (text: string) => new MockTextNode(text)
      });

      const domEl = new MockDomElement('Transcription');
      let completed = false;
      scrambleBatch(
        [{ el: domEl as any, targetText: 'استودیوی متن' }],
        {
          duration: 400,
          onComplete: () => {
            completed = true;
          }
        }
      );

      expect(rafCallbacks.length).toBe(1);
      // Start frame (t=0) and mid-sweep frame (t=180)
      rafCallbacks[0](0);
      rafCallbacks[rafCallbacks.length - 1](180);

      const cells = domEl.childrenNodes.filter(
        (n): n is MockBlockSpan => n instanceof MockBlockSpan
      );
      expect(cells.length).toBeGreaterThanOrEqual(4);
      expect(cells.length).toBeLessThanOrEqual(5);
      for (const cell of cells) {
        expect(cell.className).toBe('scramble-block-cell');
        expect(CYBER_HACKER_GLYPHS).toContain(cell.textContent);
      }

      // Finish frame (t=450)
      rafCallbacks[rafCallbacks.length - 1](450);

      expect(completed).toBe(true);
      expect(domEl.classList.contains('text-scrambling')).toBe(false);
      expect(domEl.childrenNodes.length).toBe(0);
      expect(domEl.textContent).toBe('استودیوی متن');
    });

    it('consecutive scrambleBatch calls cancel previous animation cleanly without text corruption', () => {
      scrambleBatch(
        [{ el: mockEl1, targetText: 'میانی' }],
        { duration: 200 }
      );

      scrambleBatch(
        [{ el: mockEl1, targetText: 'نهایی' }],
        { duration: 200 }
      );

      cancelActiveScramble();

      expect(mockEl1.textContent).toBe('نهایی');
      expect(mockEl1.classList.contains('text-scrambling')).toBe(false);
    });

    it('handles empty item array safely', () => {
      let done = false;
      scrambleBatch([], { onComplete: () => { done = true; } });
      expect(done).toBe(true);
    });

    it('wraps flex-container targets in a single inline span so flex gaps never split wave cells', () => {
      class MockFlexSpan extends MockDomElement {
        public tagName: string;
        public className = '';
        public style: Record<string, string> = {};
        public attributes = new Map<string, string>();
        constructor(tagName: string) {
          super('');
          this.tagName = tagName.toUpperCase();
        }
        setAttribute(k: string, v: string) {
          this.attributes.set(k, v);
        }
        appendChild(node: any) {
          this.childrenNodes.push(node);
        }
      }

      vi.stubGlobal('document', {
        createElement: (tag: string) => new MockFlexSpan(tag),
        createTextNode: (text: string) => new MockTextNode(text)
      });
      vi.stubGlobal('window', {
        getComputedStyle: () => ({ display: 'inline-flex' })
      });

      const flexBtn = new MockDomElement('Browse');
      const replaceSpy = vi.spyOn(flexBtn, 'replaceChildren');

      scrambleBatch([{ el: flexBtn as any, targetText: 'انتخاب فایل' }], { duration: 400 });

      rafCallbacks[0](0);
      rafCallbacks[rafCallbacks.length - 1](150);

      // Flex host itself receives only the single inline wrapper span, never individual cells
      expect(flexBtn.childrenNodes.length).toBe(1);
      const wrapper = flexBtn.childrenNodes[0] as unknown as MockFlexSpan;
      expect(wrapper.className).toBe('scramble-wave-inline');
      expect(wrapper.style.display).toBe('inline');
      expect(wrapper.childrenNodes.some(n => (n as any).className === 'scramble-block-cell')).toBe(true);

      // Step-only frame (glyphStep changes, bounds stay identical) must not call replaceChildren on flexBtn
      const callsAfterWaveMount = replaceSpy.mock.calls.length;
      rafCallbacks[rafCallbacks.length - 1](205);
      expect(replaceSpy.mock.calls.length).toBe(callsAfterWaveMount);

      // Completion restores plain targetText without wrapper
      rafCallbacks[rafCallbacks.length - 1](450);
      expect(flexBtn.childrenNodes.length).toBe(0);
      expect(flexBtn.textContent).toBe('انتخاب فایل');
    });

    it('removes text-scrambling class per item as soon as staggered item reaches 100% even for short durations', () => {
      vi.stubGlobal('document', {
        createElement: (tag: string) => new MockBlockSpan(tag),
        createTextNode: (text: string) => new MockTextNode(text)
      });

      const elA = new MockDomElement('Alpha');
      const elB = new MockDomElement('Beta');
      const elC = new MockDomElement('Gamma');
      let completed = false;

      scrambleBatch(
        [
          { el: elA as any, targetText: 'الف' },
          { el: elB as any, targetText: 'ب' },
          { el: elC as any, targetText: 'ج' }
        ],
        {
          duration: 100,
          onComplete: () => { completed = true; }
        }
      );

      // Start at t=0, then t=95 (elA has delay=0 and itemDuration=94, so elA finishes before t=100)
      rafCallbacks[0](0);
      rafCallbacks[rafCallbacks.length - 1](95);

      expect(elA.classList.contains('text-scrambling')).toBe(false);
      expect(elA.textContent).toBe('الف');
      expect(completed).toBe(false);

      // Finish at t=105
      rafCallbacks[rafCallbacks.length - 1](105);
      expect(completed).toBe(true);
      expect(elC.classList.contains('text-scrambling')).toBe(false);
      expect(elC.textContent).toBe('ج');
    });

    it('wraps grid-container targets in a single inline span so grid tracks never split wave cells', () => {
      class MockGridSpan extends MockDomElement {
        public tagName: string;
        public className = '';
        public style: Record<string, string> = {};
        public attributes = new Map<string, string>();
        constructor(tagName: string) {
          super('');
          this.tagName = tagName.toUpperCase();
        }
        setAttribute(k: string, v: string) {
          this.attributes.set(k, v);
        }
        appendChild(node: any) {
          this.childrenNodes.push(node);
        }
      }

      vi.stubGlobal('document', {
        createElement: (tag: string) => new MockGridSpan(tag),
        createTextNode: (text: string) => new MockTextNode(text)
      });
      vi.stubGlobal('window', {
        getComputedStyle: () => ({ display: 'inline-grid' })
      });

      const gridHost = new MockDomElement('Grid Label');
      scrambleBatch([{ el: gridHost as any, targetText: 'برچسب گرید' }], { duration: 400 });

      rafCallbacks[0](0);
      rafCallbacks[rafCallbacks.length - 1](150);

      expect(gridHost.childrenNodes.length).toBe(1);
      const wrapper = gridHost.childrenNodes[0] as unknown as MockGridSpan;
      expect(wrapper.className).toBe('scramble-wave-inline');
      expect(wrapper.style.display).toBe('inline');
    });

    it('detaches a single element via cancelScrambleForElement without disrupting remaining items', () => {
      const elKeep = new MockElement('Settings');
      const elDetach = new MockElement('Settings');

      scrambleBatch(
        [
          { el: elKeep as any, targetText: 'تنظیمات' },
          { el: elDetach as any, targetText: 'تنظیمات' }
        ],
        { duration: 400 }
      );

      rafCallbacks[0](0);
      rafCallbacks[rafCallbacks.length - 1](150);
      expect(elDetach.classList.contains('text-scrambling')).toBe(true);

      cancelScrambleForElement(elDetach as any);
      elDetach.textContent = 'Transcription Studio';
      expect(elDetach.classList.contains('text-scrambling')).toBe(false);

      // Advance to completion; detached element preserves its externally assigned text
      rafCallbacks[rafCallbacks.length - 1](450);
      expect(elKeep.textContent).toBe('تنظیمات');
      expect(elKeep.classList.contains('text-scrambling')).toBe(false);
      expect(elDetach.textContent).toBe('Transcription Studio');
    });

    it('unmounts flex inline wrapper when empty target completes before final cleanup frame', () => {
      class MockFlexSpan extends MockDomElement {
        public tagName: string;
        public className = '';
        public style: Record<string, string> = {};
        public attributes = new Map<string, string>();
        constructor(tagName: string) {
          super('');
          this.tagName = tagName.toUpperCase();
        }
        setAttribute(k: string, v: string) {
          this.attributes.set(k, v);
        }
        appendChild(node: any) {
          this.childrenNodes.push(node);
        }
      }

      vi.stubGlobal('document', {
        createElement: (tag: string) => new MockFlexSpan(tag),
        createTextNode: (text: string) => new MockTextNode(text)
      });
      vi.stubGlobal('window', {
        getComputedStyle: () => ({ display: 'flex' })
      });

      const emptyFlexEl = new MockDomElement('');
      const siblingEl = new MockDomElement('Beta');
      scrambleBatch(
        [
          { el: emptyFlexEl as any, targetText: '' },
          { el: siblingEl as any, targetText: 'ب' }
        ],
        { duration: 100 }
      );

      rafCallbacks[0](0);
      // With 2 items and duration=100, maxStagger=3 and itemDuration=97; at t=50 flexWrapper mounts, at t=98 emptyFlexEl hits 1.0 before siblingEl
      rafCallbacks[rafCallbacks.length - 1](50);
      expect(emptyFlexEl.childrenNodes.length).toBe(1);

      rafCallbacks[rafCallbacks.length - 1](98);
      expect(emptyFlexEl.childrenNodes.length).toBe(0);
      expect(emptyFlexEl.textContent).toBe('');
      expect(emptyFlexEl.classList.contains('text-scrambling')).toBe(false);

      rafCallbacks[rafCallbacks.length - 1](105);
    });
  });

  describe('setLanguage lifecycle & animation guards', () => {
    let prevDoc: any;
    let prevWin: any;
    let splashExists = false;

    beforeEach(() => {
      prevDoc = (globalThis as any).document;
      prevWin = (globalThis as any).window;
      splashExists = false;

      (globalThis as any).document = {
        documentElement: {
          setAttribute: vi.fn(),
          classList: { add: vi.fn(), remove: vi.fn() }
        },
        querySelectorAll: () => [],
        getElementById: (id: string) => {
          if (id === 'splash-curtain' && splashExists) {
            return { id: 'splash-curtain' };
          }
          return null;
        },
        querySelector: () => null,
        title: ''
      };
      (globalThis as any).window = {
        dispatchEvent: vi.fn(),
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame: vi.fn()
      };
    });

    afterEach(() => {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window = prevWin;
    });

    it('translates DOM immediately without animation when animated is false', () => {
      setLanguage('en', false);
      expect(getLanguage()).toBe('en');
    });

    it('bypasses animation when splash curtain is present in DOM even if animated is true', () => {
      splashExists = true;
      setLanguage('fa', true);
      expect(getLanguage()).toBe('fa');
    });

    it('initializes cleanly via initI18n with instant translation', () => {
      expect(() => initI18n()).not.toThrow();
    });

    it('never mutates elements inside #theme-wipe-overlay during translateDOM()', () => {
      const liveEl = {
        getAttribute: (k: string) => (k === 'data-i18n' ? 'nav.settings' : null),
        closest: () => null,
        textContent: 'Settings'
      };
      const wipeCloneEl = {
        getAttribute: (k: string) => (k === 'data-i18n' ? 'nav.settings' : null),
        closest: (sel: string) => (sel === '#theme-wipe-overlay' ? { id: 'theme-wipe-overlay' } : null),
        textContent: 'Settings'
      };

      (globalThis as any).document.querySelectorAll = (sel: string) =>
        sel === '[data-i18n]' ? [liveEl, wipeCloneEl] : [];

      setLanguage('fa', false);
      translateDOM();

      expect(liveEl.textContent).not.toBe('Settings');
      expect(wipeCloneEl.textContent).toBe('Settings');
    });

    it('dispatches animated: false in whisper:languageChanged detail on non-animated switches', () => {
      setLanguage('en', false);
      setLanguage('fa', false);

      const dispatchMock = (globalThis as any).window.dispatchEvent as ReturnType<typeof vi.fn>;
      expect(dispatchMock).toHaveBeenCalled();
      const lastEvt = dispatchMock.mock.calls[dispatchMock.mock.calls.length - 1][0];
      expect(lastEvt.type).toBe('whisper:languageChanged');
      expect(lastEvt.detail).toEqual({ language: 'fa', isRtl: true, animated: false });
    });
  });
});
