import { en, type Translations } from '../locales/en';
import { fa } from '../locales/fa';
import { es } from '../locales/es';
import { fr } from '../locales/fr';
import { de } from '../locales/de';
import { zh } from '../locales/zh';
import { ja } from '../locales/ja';
import { ru } from '../locales/ru';
import { ar } from '../locales/ar';
import { pt } from '../locales/pt';
import { it } from '../locales/it';
import { tr } from '../locales/tr';
import { ko } from '../locales/ko';

export type SupportedLanguage =
  | 'en'
  | 'fa'
  | 'es'
  | 'fr'
  | 'de'
  | 'zh'
  | 'ja'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'tr'
  | 'ko';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'en',
  'fa',
  'es',
  'fr',
  'de',
  'zh',
  'ja',
  'ru',
  'ar',
  'pt',
  'it',
  'tr',
  'ko'
];

/**
 * The product name, and deliberately the same in every interface language: it is what
 * the bundle, the installer, the launcher entry and the release notes say, so the
 * window title matches them instead of offering a second, transliterated name for the
 * same program. Only the words around it are translated (see `nav.about`). The sidebar
 * wordmark carries the same name as a literal, and like this one is not translated.
 */
export const APP_NAME = 'Whisper Desktop';

export const RTL_LANGUAGES: SupportedLanguage[] = ['fa', 'ar'];

export function isRtlLanguage(lang: string): boolean {
  return lang === 'fa' || lang === 'ar';
}

/** Hebrew, Arabic and the right-to-left scripts written between them (Syriac,
 *  Thaana, NKo, Samaritan, Mandaic, the Arabic supplements), plus their presentation
 *  forms. The interface's own RTL languages need only the first two; the rest are
 *  here so text pasted into a cue or a transcript cannot be read on the wrong side. */
const RTL_CHAR_REGEX = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/** Only letters are strong characters to the bidi algorithm. Digits, marks and
 *  punctuation are not, so a cue of Persian digits counts as having no direction
 *  of its own — which is how browsers and libass read it too. */
const LETTER_REGEX = /\p{L}/u;

/**
 * Direction of the first strong character — the P2/P3 rule CSS `dir="auto"` and
 * libass both apply — or null when the text holds none (empty, or digits and
 * punctuation only). Every field and every cue that follows its content resolves it
 * here, so none of them can disagree about a line's direction.
 */
export function firstStrongDirection(text: string): 'rtl' | 'ltr' | null {
  for (const char of text) {
    if (!LETTER_REGEX.test(char)) continue;
    return RTL_CHAR_REGEX.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * Wraps a technical string — a file path, a version — in a left-to-right isolate, so
 * it keeps its own order wherever it is shown, including inside right-to-left text and
 * in tooltips the browser renders itself.
 *
 * A path is mostly neutral characters with ASCII letters between them, and a leading
 * `/` is neutral too: in a right-to-left paragraph the run boundary rules hand it the
 * paragraph's direction, so `/home/vid.srt` comes out as `home/vid.srt/`. Isolating the
 * path fixes the order without touching the surrounding text — the interface's own
 * language still decides how the sentence around it reads.
 */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`;
}

/**
 * Wraps a phrase in a bidi isolate in the direction that phrase reads in — the twin of
 * `isolateLtr` for localized copy that has to keep its own order inside a line whose
 * direction is the interface's.
 *
 * The translation card's metadata badge is where it earns its keep: `SRT • 12 قطعه •
 * 921 B` is three tokens of three different directions in one line, and unisolated the
 * bidi algorithm reads straight through them — the count's digits are claimed by the
 * Latin run beside them and come back on the wrong side of it, and the neutral space
 * between two tokens is handed to whichever run the rules reach first. One isolate per
 * token keeps every token whole, and leaves the ` • ` separators to the interface's own
 * direction, so the badge reads right to left in a Persian interface and left to right
 * in an English one without a token changing its shape.
 */
export function isolateDirection(text: string, fallbackDir?: 'rtl' | 'ltr'): string {
  const { dir } = resolveTextDirection(text, fallbackDir);
  return dir === 'rtl' ? `\u2067${text}\u2069` : `\u2066${text}\u2069`;
}

/**
 * The direction a piece of text lays out in, and whether that direction is the text's
 * own or the interface's. Text with a strong character to read follows it; text without
 * one (empty, digits, punctuation) has no direction of its own and takes `fallbackDir`,
 * or the interface direction when no fallback is given.
 *
 * Every field and every cue that follows its content resolves it here, so none of them
 * can disagree about a line's direction.
 */
function resolveTextDirection(
  text: string,
  fallbackDir?: 'rtl' | 'ltr'
): { dir: 'rtl' | 'ltr'; neutral: boolean } {
  const strong = firstStrongDirection(text);
  return {
    dir: strong || fallbackDir || (isRtlLanguage(getLanguage()) ? 'rtl' : 'ltr'),
    neutral: strong === null,
  };
}

/**
 * The `dir` — plus, for text with no strong character to read, the marker that lets it
 * honour that `dir` — for content written once as markup rather than edited in a field:
 * the cue panes, which render their text through this and cannot be given attributes
 * after the fact the way `applyTextDirection` does for a field.
 */
export function directionAttributes(text: string, fallbackDir?: 'rtl' | 'ltr'): string {
  const { dir, neutral } = resolveTextDirection(text, fallbackDir);
  return neutral ? `dir="${dir}" data-no-strong-char` : `dir="${dir}"`;
}

/**
 * Points an element whose content was just written with `textContent` at the direction
 * that content calls for — the element-level twin of `directionAttributes`, for the
 * surfaces the code fills in rather than the markup. A file name and a cue both arrive
 * as the user's own text, so each reads in its own direction whatever the interface is
 * doing around it.
 *
 * The `data-no-strong-char` flag matters as much as `dir` does. A field styled
 * `unicode-bidi: plaintext` (the cue editor, the transcript lines) resolves each
 * paragraph from its own content, but a paragraph with no strong character settles
 * on LTR by the bidi algorithm itself — UAX #9 P3 — whatever the element's
 * direction says, which is what parks the caret on the left in an empty field even
 * in a Persian interface. Content with no strong character has no direction of its
 * own, so styles.css has such an element honour its `dir` instead.
 */
export function applyContentDirection(
  el: HTMLElement | null,
  text: string,
  fallbackDir?: 'rtl' | 'ltr'
): void {
  if (!el) return;
  const { dir, neutral } = resolveTextDirection(text, fallbackDir);
  el.setAttribute('dir', dir);
  if (neutral) {
    el.setAttribute('data-no-strong-char', '');
  } else {
    el.removeAttribute('data-no-strong-char');
  }
}

/**
 * The same decision for a text field, whose content is its `value`. A rendered block
 * takes it at render time through `directionAttributes`, above, and a filled element
 * through `applyContentDirection`, so a cue reads the same way in a field, in the
 * preview and in the panes.
 */
export function applyTextDirection(el: HTMLElement | null, fallbackDir?: 'rtl' | 'ltr'): void {
  if (!el) return;
  applyContentDirection(el, (el as HTMLInputElement).value || '', fallbackDir);
}

const dictionaries: Record<SupportedLanguage, Translations> = {
  en,
  fa,
  es,
  fr,
  de,
  zh,
  ja,
  ru,
  ar,
  pt,
  it,
  tr,
  ko
};

const STORAGE_KEY = 'whisper_language';

let currentLang: SupportedLanguage = 'en';

function getNestedValue(obj: any, path: string): string | undefined {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export function t(key: string, params?: Record<string, string | number>): string {
  // 1. Try current language
  let text = getNestedValue(dictionaries[currentLang], key);

  // 2. Fallback to English if not found
  if (text === undefined && currentLang !== 'en') {
    text = getNestedValue(dictionaries.en, key);
  }

  // 3. Fallback to the key itself if missing
  if (text === undefined) {
    return key;
  }

  // 4. Interpolate parameters like {name}, {count} safely without regex special replacement interpretation
  if (params && typeof params === 'object') {
    for (const [paramKey, val] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), () => String(val));
    }
  }

  return text;
}

export function getLanguage(): SupportedLanguage {
  return currentLang;
}

export function translateDOM(root: Document | Element = document): void {
  // Translate text content
  const textElements = root.querySelectorAll<HTMLElement>('[data-i18n]');
  for (const el of textElements) {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  }

  // Translate rich HTML content with defensive sanitization
  const htmlElements = root.querySelectorAll<HTMLElement>('[data-i18n-html]');
  for (const el of htmlElements) {
    const key = el.getAttribute('data-i18n-html');
    if (key) {
      const raw = t(key);
      const clean = raw
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
      el.innerHTML = clean;
    }
  }

  // Translate specific helper attributes
  const placeholderEls = root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]');
  for (const el of placeholderEls) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.setAttribute('placeholder', t(key));
    }
  }

  const titleEls = root.querySelectorAll<HTMLElement>('[data-i18n-title]');
  for (const el of titleEls) {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
    }
  }

  const ariaEls = root.querySelectorAll<HTMLElement>('[data-i18n-aria]');
  for (const el of ariaEls) {
    const key = el.getAttribute('data-i18n-aria');
    if (key) {
      el.setAttribute('aria-label', t(key));
    }
  }

  // Translate compound attributes (format: "title:key,placeholder:key2")
  const attrElements = root.querySelectorAll<HTMLElement>('[data-i18n-attr]');
  for (const el of attrElements) {
    const rawAttr = el.getAttribute('data-i18n-attr');
    if (!rawAttr) continue;
    const pairs = rawAttr.split(',');
    for (const pair of pairs) {
      const [attrName, key] = pair.split(':').map((s) => s.trim());
      if (attrName && key) {
        el.setAttribute(attrName, t(key));
      }
    }
  }
}

export function setLanguage(lang: SupportedLanguage, notify: boolean = true): void {
  if (!SUPPORTED_LANGUAGES.includes(lang)) {
    lang = 'en';
  }

  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (_) {}

  const isRtl = isRtlLanguage(lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
  if (isRtl) {
    document.documentElement.classList.add('rtl-layout');
  } else {
    document.documentElement.classList.remove('rtl-layout');
  }

  // Sync select dropdown in UI if present
  const selectEl = document.getElementById('opt-uiLanguage') as HTMLSelectElement | null;
  if (selectEl && selectEl.value !== lang) {
    selectEl.value = lang;
  }

  // Update DOM translations
  translateDOM();

  // Synchronize custom selects if initialized
  if (typeof (window as any).syncCustomSelects === 'function') {
    (window as any).syncCustomSelects();
  }

  // Synchronize current view title
  const activeNav = document.querySelector<HTMLElement>('.nav-item.active');
  const viewTitle = document.getElementById('current-view-title');
  const titlebarViewTitle = document.getElementById('titlebar-view-title');
  if (activeNav && activeNav.dataset.view) {
    const locTitle = t(`nav.${activeNav.dataset.view}`);
    if (viewTitle && locTitle) viewTitle.textContent = locTitle;
    if (titlebarViewTitle && locTitle) titlebarViewTitle.textContent = locTitle;
  }

  // Synchronize window/document title
  if (typeof document !== 'undefined') {
    document.title = APP_NAME;
  }

  // Synchronize with settingsState and save to backend if available
  if (typeof window !== 'undefined') {
    const win = window as any;
    if (win.settingsState && win.settingsState.uiLanguage !== lang) {
      win.settingsState.uiLanguage = lang;
      if (typeof win.saveCurrentSettings === 'function') {
        win.saveCurrentSettings(true);
      }
    }
  }

  // Dispatch global event for components that listen to language change
  window.dispatchEvent(new CustomEvent('whisper:languageChanged', { detail: { language: lang, isRtl } }));

  // Notify user if changed manually
  if (notify && typeof (window as any).showNotification === 'function') {
    (window as any).showNotification(t('toasts.langChanged'), 'info', 3000);
  }
}

export function initI18n(): void {
  let initialLang: SupportedLanguage = 'en';
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
      initialLang = saved;
    }
  } catch (_) {}

  setLanguage(initialLang, false);
}

// Expose globals for convenience across the existing vanilla codebase
if (typeof window !== 'undefined') {
  (window as any).t = t;
  (window as any).setLanguage = setLanguage;
  (window as any).getLanguage = getLanguage;
  (window as any).translateDOM = translateDOM;
  (window as any).isRtlLanguage = isRtlLanguage;
  (window as any).SUPPORTED_LANGUAGES = SUPPORTED_LANGUAGES;
  (window as any).RTL_LANGUAGES = RTL_LANGUAGES;
}
