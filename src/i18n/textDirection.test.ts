import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Tests for the one rule every content-following piece of text resolves its direction
 * with — the cue editor, the transcript lines and the prompt fields go through
 * `applyTextDirection`, the Translation Studio's cue panes through
 * `directionAttributes`, and the subtitle card's file name through
 * `applyContentDirection` — so a change here changes all of them at once. The badges
 * and lists that hold phrases of two directions in one line build on the same rule
 * through `isolateDirection`, and so does every value interpolated into localized
 * copy, which `t()` isolates when it reads the other way round from the sentence.
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
let applyContentDirection: typeof import('./index').applyContentDirection;
let directionAttributes: typeof import('./index').directionAttributes;
let isolateDirection: typeof import('./index').isolateDirection;
let isolateLtr: typeof import('./index').isolateLtr;
let clearContentDirection: typeof import('./index').clearContentDirection;
let t: typeof import('./index').t;
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

  ({
    firstStrongDirection,
    applyTextDirection,
    applyContentDirection,
    directionAttributes,
    isolateDirection,
    isolateLtr,
    clearContentDirection,
    t,
    setLanguage,
  } = await import('./index'));
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
 * The rendered blocks a field cannot be: their text is written once, from a subtitle
 * file, so the direction has to be decided while the markup is built. It must land on
 * the same answer `applyTextDirection` would give for the same text, or a cue would
 * read one way in the panes and another in the editor.
 */
describe('directionAttributes', () => {
  it('writes the direction the text reads in, whichever way round it is', () => {
    setLanguage('en');
    expect(directionAttributes('سلام دنیا')).toBe('dir="rtl"');
    expect(directionAttributes('Hello, world.')).toBe('dir="ltr"');

    setLanguage('fa');
    expect(directionAttributes('Hello, world.')).toBe('dir="ltr"');
    expect(directionAttributes('سلام دنیا')).toBe('dir="rtl"');
  });

  it('hands text with no strong character to the interface and marks it as neutral', () => {
    setLanguage('fa');
    expect(directionAttributes('')).toBe('dir="rtl" data-no-strong-char');
    expect(directionAttributes('...')).toBe('dir="rtl" data-no-strong-char');
    expect(directionAttributes('۱۲۳')).toBe('dir="rtl" data-no-strong-char');

    setLanguage('en');
    expect(directionAttributes('42%')).toBe('dir="ltr" data-no-strong-char');
  });

  it('only uses the fallback when the text has no strong character of its own', () => {
    setLanguage('en');
    expect(directionAttributes('42%', 'rtl')).toBe('dir="rtl" data-no-strong-char');
    expect(directionAttributes('Hello', 'rtl')).toBe('dir="ltr"');
    expect(directionAttributes('', 'ltr')).toBe('dir="ltr" data-no-strong-char');
  });
});

/**
 * The element-level twin of `directionAttributes`, and the one the subtitle card's file
 * name goes through: the name is the user's own text, written once with `textContent`,
 * so its attribute has to be set alongside rather than built into markup.
 */
describe('applyContentDirection', () => {
  it('points the element at the direction of the text it was just given', () => {
    setLanguage('en');
    const name = new FakeField();
    applyContentDirection(asField(name), 'movie.srt');
    expect(name.attributes.get('dir')).toBe('ltr');
    applyContentDirection(asField(name), 'دوبله فارسی.srt');
    expect(name.attributes.get('dir')).toBe('rtl');

    // The interface is not consulted for text that can answer for itself.
    setLanguage('fa');
    applyContentDirection(asField(name), 'movie.srt');
    expect(name.attributes.get('dir')).toBe('ltr');
  });

  it('marks text with no strong character and falls back to the interface', () => {
    setLanguage('fa');
    const name = new FakeField();
    applyContentDirection(asField(name), '۱۲۳.');
    expect(name.attributes.get('dir')).toBe('rtl');
    expect(name.hasAttribute('data-no-strong-char')).toBe(true);
    applyContentDirection(asField(name), '...', 'ltr');
    expect(name.attributes.get('dir')).toBe('ltr');
  });

  it('ignores a missing element instead of throwing', () => {
    expect(() => applyContentDirection(null, 'movie.srt')).not.toThrow();
  });
});

/**
 * `isolateDirection` is what the metadata badge is built from: a line holding a
 * technical token, a localized phrase and another technical token has three
 * directions in it, and an isolate per token is what stops the bidi algorithm from
 * reading straight through them.
 */
describe('isolateDirection', () => {
  it('wraps the text in an isolate of its own direction (RLI/LRI … PDI)', () => {
    expect(isolateDirection('سلام دنیا')).toBe('\u2067سلام دنیا\u2069');
    expect(isolateDirection('Hello')).toBe('\u2066Hello\u2069');
    expect(isolateDirection('921 B')).toBe('\u2066921 B\u2069');
  });

  it('reads the text, not the interface, so a Latin token is left-to-right in Persian', () => {
    setLanguage('fa');
    expect(isolateDirection('SRT')).toBe('\u2066SRT\u2069');
    setLanguage('en');
    expect(isolateDirection('قطعه')).toBe('\u2067قطعه\u2069');
  });

  it('hands text with no strong character to the interface, or to the fallback', () => {
    setLanguage('fa');
    expect(isolateDirection('42')).toBe('\u206742\u2069');
    expect(isolateDirection('42', 'ltr')).toBe('\u206642\u2069');
    setLanguage('en');
    expect(isolateDirection('...')).toBe('\u2066...\u2069');
  });

  it('keeps every token of the metadata badge separable, in both interfaces', () => {
    // The string the badge is rendered from. A Persian count written next to `SRT`
    // without its isolate is what puts the digits on the far side of the Latin run
    // (UAX #9 W7) and the space between two tokens in the wrong place; the marks are
    // invisible, so the arrangement they produce is pinned here instead.
    const badge = () =>
      [
        isolateDirection('SRT'),
        isolateDirection(t('translate.cuesCount', { count: 12 })),
        isolateDirection('921 B'),
      ].join(' • ');

    setLanguage('fa');
    expect(badge()).toBe('\u2066SRT\u2069 • \u206712 قطعه\u2069 • \u2066921 B\u2069');

    setLanguage('en');
    expect(badge()).toBe('\u2066SRT\u2069 • \u206612 cues\u2069 • \u2066921 B\u2069');
  });
});

/**
 * `clearContentDirection` is the other half of `applyContentDirection`: the moment a
 * card's content stops being the user's file and becomes the interface's own copy
 * again. A `dir` left behind by the file that is gone lays the localized copy out in
 * the direction of that file.
 */
describe('clearContentDirection', () => {
  it('takes back the direction and the marker a file name left behind', () => {
    const name = new FakeField('');
    applyContentDirection(asField(name), '01 - intro.mkv');
    expect(name.attributes.get('dir')).toBe('ltr');

    clearContentDirection(asField(name));
    expect(name.attributes.has('dir')).toBe(false);
    expect(name.hasAttribute('data-no-strong-char')).toBe(false);
  });

  it('clears text with no strong character too, marker and all', () => {
    const name = new FakeField('');
    applyContentDirection(asField(name), '۱۲۳.');
    expect(name.hasAttribute('data-no-strong-char')).toBe(true);

    clearContentDirection(asField(name));
    expect(name.attributes.has('dir')).toBe(false);
    expect(name.hasAttribute('data-no-strong-char')).toBe(false);
  });

  it('takes a missing element, which a card without that line passes', () => {
    expect(() => clearContentDirection(null)).not.toThrow();
  });
});

/**
 * A value interpolated into localized copy is a token of its own, and the one place
 * every such value passes through is `t()`. A path or a file name that reads the other
 * way round from the sentence it lands in is isolated, so it is not read apart by the
 * bidi algorithm on the way in; a value that already reads with the sentence — a count,
 * or copy written in the interface's own language — is left exactly as it is.
 */
describe('t() interpolation', () => {
  it('isolates a path that reads the other way round from the copy', () => {
    setLanguage('fa');
    expect(t('toasts.openFolderError', { error: '/home/ahmad/Videos' })).toContain(
      '\u2066/home/ahmad/Videos\u2069'
    );
  });

  it('isolates a file name for the same reason, keeping its extension with it', () => {
    setLanguage('fa');
    expect(t('modals.confirmDeleteModelDesc', { name: 'q5_k_m' })).toContain(
      '\u2066q5_k_m\u2069'
    );
  });

  it('isolates right-to-left copy in a left-to-right interface', () => {
    setLanguage('en');
    expect(t('modals.confirmDeleteModelDesc', { name: 'دوبله' })).toContain(
      '\u2067دوبله\u2069'
    );
  });

  it('leaves a count alone, in either interface', () => {
    setLanguage('fa');
    const faMessage = t('toasts.filesLoaded', { count: 3 });
    expect(faMessage).toContain('3');
    expect(faMessage).not.toContain('\u2066');
    expect(faMessage).not.toContain('\u2067');

    setLanguage('en');
    expect(t('toasts.filesLoaded', { count: 3 })).not.toContain('\u2066');
  });

  it('leaves a value written in the interface’s own language alone', () => {
    setLanguage('fa');
    const faMessage = t('modals.confirmDeleteProviderDesc', { name: 'اوپن‌ای‌آی' });
    expect(faMessage).toContain('اوپن‌ای‌آی');
    expect(faMessage).not.toContain('\u2066');
    expect(faMessage).not.toContain('\u2067');
  });

  it('substitutes a value with no direction of its own without inventing one', () => {
    setLanguage('fa');
    expect(t('toasts.filesLoaded', { count: '...' })).toContain('...');
    expect(t('toasts.filesLoaded', { count: '...' })).not.toContain('\u2066');
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
