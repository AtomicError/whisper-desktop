import { en, type Translations } from '../locales/en';
import { fa } from '../locales/fa';

export type SupportedLanguage = 'en' | 'fa';

const dictionaries: Record<SupportedLanguage, Translations> = {
  en,
  fa
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
  if (lang !== 'en' && lang !== 'fa') {
    lang = 'en';
  }

  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (_) {}

  const isRtl = lang === 'fa';
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
  if (activeNav && viewTitle && activeNav.dataset.view) {
    viewTitle.textContent = t(`nav.${activeNav.dataset.view}`) || viewTitle.textContent;
  }

  // Synchronize window/document title
  if (typeof document !== 'undefined') {
    document.title = t('app.title') || 'Whisper Desktop';
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
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fa') {
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
}
