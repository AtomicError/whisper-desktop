// Renders and wires the four language dropdowns (translation targets + spoken
// languages) so Settings and the Studios always share one list, localized to
// the active UI language, with locale-aware sorting, search aliases and
// persisted "recent languages" pinning.

import { getLanguage, t } from './i18n/index';
import {
  TRANSLATION_TARGET_LANGUAGES,
  WHISPER_SPOKEN_LANGUAGES,
  localizedLanguageLabel,
  makeLanguageComparator,
  nativeLanguageLabel,
  normalizeForSearch,
  pushRecentLanguage,
  readRecentLanguages
} from './languages';

export type LanguageSelectKind = 'spoken' | 'translation';

interface LanguageEntry {
  value: string;
  label: string;
  search: string;
}

const LANGUAGE_SELECT_IDS: Record<LanguageSelectKind, string[]> = {
  spoken: ['opt-language', 'quick-opt-language'],
  translation: ['opt-translateAiTargetLang', 'translate-target-lang']
};

const AUTO_LANGUAGE_VALUE = 'auto';

function getSettingsState(): any {
  return (window as any).settingsState || null;
}

function getCurrentSettingsValue(kind: LanguageSelectKind): string {
  const state = getSettingsState();
  if (!state) return '';
  return String(kind === 'spoken' ? state.language : state.translateAiTargetLang ?? '').trim();
}

function buildSearchAliases(parts: string[]): string {
  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

function buildEntries(kind: LanguageSelectKind, uiLang: string): LanguageEntry[] {
  if (kind === 'spoken') {
    return WHISPER_SPOKEN_LANGUAGES.map((lang) => {
      const label = localizedLanguageLabel(lang.code, uiLang, lang.name);
      return {
        value: lang.code,
        label,
        search: buildSearchAliases([label, lang.name, nativeLanguageLabel(lang.code, lang.name), lang.code])
      };
    });
  }
  return TRANSLATION_TARGET_LANGUAGES.map((lang) => {
    const label = localizedLanguageLabel(lang.code, uiLang, lang.name);
    return {
      value: lang.value,
      label,
      search: buildSearchAliases([label, lang.name, nativeLanguageLabel(lang.code, lang.name), lang.code])
    };
  });
}

function buildAutoEntry(): LanguageEntry {
  const label = t('transcribe.langAuto');
  return {
    value: AUTO_LANGUAGE_VALUE,
    label,
    search: buildSearchAliases([label, 'auto', 'auto detect', 'autodetect', 'automatic'])
  };
}

function makeOptionElement(entry: LanguageEntry): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = entry.value;
  option.textContent = entry.label;
  option.setAttribute('data-search', entry.search);
  return option;
}

function makeGroupElement(label: string, entries: LanguageEntry[]): HTMLOptGroupElement {
  const group = document.createElement('optgroup');
  group.setAttribute('label', label);
  entries.forEach((entry) => group.appendChild(makeOptionElement(entry)));
  return group;
}

function refreshCustomSelectInstance(select: HTMLSelectElement): void {
  const map = (window as any).customSelectsMap as Map<string, any> | undefined;
  const instance = map ? map.get(select.id) : null;
  if (instance && typeof instance.updateOptions === 'function') {
    instance.updateOptions();
  }
}

/**
 * Rebuilds a language dropdown: pinned "auto" first (spoken only), then a
 * "Recent languages" group, then every language sorted per the active UI
 * locale. Unknown legacy values stay visible via a fallback option.
 */
export function renderLanguageSelect(select: HTMLSelectElement, kind: LanguageSelectKind, currentValue?: string): void {
  if (!select) return;
  const uiLang = getLanguage();
  const entries = buildEntries(kind, uiLang);

  let targetValue = (currentValue === undefined ? getCurrentSettingsValue(kind) : currentValue).trim();
  if (!targetValue) {
    targetValue = kind === 'spoken' ? AUTO_LANGUAGE_VALUE : TRANSLATION_TARGET_LANGUAGES[0].value;
  }

  select.innerHTML = '';

  if (kind === 'spoken') {
    select.appendChild(makeOptionElement(buildAutoEntry()));
  }

  const state = getSettingsState();
  const recentValues = readRecentLanguages(
    kind === 'spoken' ? state?.recentSpokenLanguages : state?.recentTranslationTargets
  );
  const recentEntries = recentValues
    .map((value) => entries.find((entry) => entry.value.toLowerCase() === value.toLowerCase()))
    .filter((entry): entry is LanguageEntry => Boolean(entry))
    .filter((entry) => !(kind === 'spoken' && entry.value.toLowerCase() === AUTO_LANGUAGE_VALUE));

  if (recentEntries.length > 0) {
    select.appendChild(makeGroupElement(t('languages.recent'), recentEntries));
  }

  const compare = makeLanguageComparator(uiLang);
  const sorted = [...entries].sort((a, b) => compare(a.label, b.label) || a.value.localeCompare(b.value));
  select.appendChild(makeGroupElement(t('languages.all'), sorted));

  const knownValue = entries.some((entry) => entry.value.toLowerCase() === targetValue.toLowerCase());
  if (!knownValue && !(kind === 'spoken' && targetValue.toLowerCase() === AUTO_LANGUAGE_VALUE)) {
    select.appendChild(
      makeOptionElement({
        value: targetValue,
        label: targetValue,
        search: buildSearchAliases([targetValue])
      })
    );
  }

  select.value = targetValue;
  refreshCustomSelectInstance(select);
}

function reRenderKind(kind: LanguageSelectKind, activeValue?: string): void {
  const value = activeValue !== undefined ? activeValue : getCurrentSettingsValue(kind);
  LANGUAGE_SELECT_IDS[kind].forEach((id) => {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) {
      renderLanguageSelect(el, kind, value || el.value);
    }
  });
}

function attachRecentsListener(select: HTMLSelectElement, kind: LanguageSelectKind): void {
  select.addEventListener('change', () => {
    const state = getSettingsState();
    if (!state || !select.value) return;
    if (kind === 'spoken') {
      if (select.value !== AUTO_LANGUAGE_VALUE) {
        state.recentSpokenLanguages = pushRecentLanguage(state.recentSpokenLanguages, select.value);
      }
    } else {
      state.recentTranslationTargets = pushRecentLanguage(state.recentTranslationTargets, select.value);
    }
    // Refresh both twin dropdowns so their Recent group and selected option reflect the new pick.
    reRenderKind(kind, select.value);
  });
}

/** Re-renders all language dropdowns (on UI language change). */
export function refreshLanguageSelects(): void {
  (Object.keys(LANGUAGE_SELECT_IDS) as LanguageSelectKind[]).forEach((kind) => reRenderKind(kind));
}

let languageChangedHooked = false;

export function initLanguageSelects(): void {
  (Object.keys(LANGUAGE_SELECT_IDS) as LanguageSelectKind[]).forEach((kind) => {
    LANGUAGE_SELECT_IDS[kind].forEach((id) => {
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el || el.dataset.languageSelectInit === 'true') return;
      el.dataset.languageSelectInit = 'true';
      attachRecentsListener(el, kind);
      renderLanguageSelect(el, kind);
    });
  });

  if (!languageChangedHooked) {
    languageChangedHooked = true;
    window.addEventListener('whisper:languageChanged', () => {
      refreshLanguageSelects();
    });
  }
}
