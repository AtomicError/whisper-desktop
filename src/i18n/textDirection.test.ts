import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Tests for the one rule every content-following text field resolves its direction
 * with — the cue editor, the transcript lines and the prompt fields all go through
 * `applyTextDirection`, so a change here changes all of them at once.
 *
 * The module touches `document`/`window` as soon as a language is applied, which
 * Node has neither of, so a few stubs stand in for them and the module is imported
 * afterwards. The rule being tested is pure; the CSS that consumes
 * `data-no-strong-char` is a browser concern and is not exercised here.
 */

class FakeField {
  readonly attributes = new Map<string, string>();
  constructor(public value = '') {}
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
}

/** The rule reads `value` and sets attributes, nothing else — so a stand-in does. */
function asField(field: FakeField): HTMLElement {
  return field as unknown as HTMLElement;
}

let firstStrongDirection: typeof import('./index').firstStrongDirection;
let applyTextDirection: typeof import('./index').applyTextDirection;
let isolateLtr: typeof import('./index').isolateLtr;
let setLanguage: typeof import('./index').setLanguage;

beforeAll(async () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)) },
    window: { dispatchEvent: () => {}, syncCustomSelects: undefined },
    CustomEvent: class {
      constructor(public type: string) {}
    },
    // Anything the module asks of the document that is not listed returns null.
    document: new Proxy(
      {
        documentElement: { setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } },
        body: {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      },
      { get: (target, prop) => (prop in target ? (target as any)[prop] : () => null) },
    ),
  });

  ({ firstStrongDirection, applyTextDirection, isolateLtr, setLanguage } = await import('./index'));
});

/** What applyTextDirection() decided, as the field itself would report it. */
function directionFor(value: string, lang: 'fa' | 'en' = 'fa', fallbackDir?: 'rtl' | 'ltr') {
  setLanguage(lang);
  const field = new FakeField(value);
  applyTextDirection(asField(field), fallbackDir);
  return { dir: field.attributes.get('dir'), neutral: field.hasAttribute('data-no-strong-char') };
}

describe('firstStrongDirection', () => {
  it('reads the direction of the first strong character', () => {
    expect(firstStrongDirection('Hello, world.')).toBe('ltr');
    expect(firstStrongDirection('سلام دنیا')).toBe('rtl');
    expect(firstStrongDirection('שלום')).toBe('rtl');
  });

  it('lets the first strong character win in mixed text, whichever side it is', () => {
    expect(firstStrongDirection('Hello سلام')).toBe('ltr');
    expect(firstStrongDirection('سلام Hello')).toBe('rtl');
  });

  it('counts Latin, CJK, Indic and Thai letters as left-to-right', () => {
    // These are class L in the bidi algorithm; only the Hebrew/Arabic scripts are
    // right-to-left, which is what keeps a Hindi or Japanese line off the wrong edge.
    expect(firstStrongDirection('日本語です')).toBe('ltr');
    expect(firstStrongDirection('हिन्दी')).toBe('ltr');
    expect(firstStrongDirection('สวัสดี')).toBe('ltr');
  });

  it('skips neutrals until it finds a letter', () => {
    expect(firstStrongDirection('42 hello')).toBe('ltr');
    expect(firstStrongDirection('۱۲۳ سلام')).toBe('rtl');
  });

  it('reads every right-to-left block in its range as rtl', () => {
    // One letter from each right-to-left block the rule covers. The app's own
    // languages need Hebrew and Arabic; the rest are there so pasted text cannot be
    // read on the wrong side, and they are what pins the range's boundaries.
    const rtlLetters: [string, string][] = [
      ['\u05D0', 'Hebrew alef'],
      ['\u0628', 'Arabic beh'],
      ['\u0710', 'Syriac alaph'],
      ['\u0750', 'Arabic Supplement'],
      ['\u0780', 'Thaana haa'],
      ['\u07CA', 'NKo'],
      ['\u0800', 'Samaritan'],
      ['\u0840', 'Mandaic'],
      ['\u08A0', 'Arabic Extended-A'],
      ['\uFB1D', 'Hebrew presentation form'],
      ['\uFB50', 'Arabic presentation form A'],
      ['\uFE8D', 'Arabic presentation form B'],
    ];
    for (const [char, name] of rtlLetters) {
      expect(firstStrongDirection(char), `${name} (U+${char.charCodeAt(0).toString(16).toUpperCase()})`).toBe('rtl');
    }
  });

  it('reports no direction when there is no strong character to read', () => {
    expect(firstStrongDirection('')).toBeNull();
    expect(firstStrongDirection('...')).toBeNull();
    expect(firstStrongDirection('42%')).toBeNull();
    // Persian and Arabic-Indic digits are class AN, not strong, so a cue made only
    // of digits has no direction of its own — the same way a browser reads it.
    expect(firstStrongDirection('۱۲۳')).toBeNull();
  });
});

describe('applyTextDirection', () => {
  it('follows the content and drops the neutral marker', () => {
    expect(directionFor('Hello, world.')).toEqual({ dir: 'ltr', neutral: false });
    expect(directionFor('سلام دنیا')).toEqual({ dir: 'rtl', neutral: false });
  });

  it('falls back to the interface direction when the content has no strong character', () => {
    expect(directionFor('', 'fa')).toEqual({ dir: 'rtl', neutral: true });
    expect(directionFor('42', 'fa')).toEqual({ dir: 'rtl', neutral: true });
    expect(directionFor('', 'en')).toEqual({ dir: 'ltr', neutral: true });
  });

  it('marks a field with no strong character so styles.css can let it honour dir', () => {
    // The pairing matters: `unicode-bidi: plaintext` resolves a strong-character-less
    // paragraph to LTR regardless of `dir` (UAX #9 P3), so the marker is what gives
    // the element direction a say, and the caret the interface's side.
    const field = new FakeField('');
    applyTextDirection(asField(field), 'rtl');
    expect(field.hasAttribute('data-no-strong-char')).toBe(true);
    field.value = 'Hello';
    applyTextDirection(asField(field));
    expect(field.hasAttribute('data-no-strong-char')).toBe(false);
    field.value = '';
    applyTextDirection(asField(field));
    expect(field.hasAttribute('data-no-strong-char')).toBe(true);
  });

  it('only uses the fallback when the content has no strong character of its own', () => {
    expect(directionFor('', 'en', 'rtl').dir).toBe('rtl');
    expect(directionFor('Hello', 'fa', 'rtl').dir).toBe('ltr');
    expect(directionFor('سلام', 'en', 'ltr').dir).toBe('rtl');
  });

  it('ignores a missing element instead of throwing', () => {
    expect(() => applyTextDirection(null)).not.toThrow();
  });
});

/**
 * `isolateLtr` is what keeps a path readable in an RTL interface and in tooltips.
 * Pinned because the marks are invisible: a wrong or missing pair shows up only as a
 * leading slash drifting to the end of the path, far from the line that caused it.
 */
describe('isolateLtr', () => {
  it('wraps the string in a left-to-right isolate (LRI … PDI)', () => {
    expect(isolateLtr('/home/ahmad/vid.srt')).toBe('\u2066/home/ahmad/vid.srt\u2069');
    expect([...isolateLtr('x')]).toEqual(['\u2066', 'x', '\u2069']);
  });

  it('leaves the string itself untouched apart from the marks', () => {
    const path = 'C:\\Users\\ahmad\\vid.srt';
    expect(isolateLtr(path).slice(1, -1)).toBe(path);
  });

  it('holds up for the empty string, which the tooltips can carry', () => {
    expect(isolateLtr('')).toBe('\u2066\u2069');
  });
});
