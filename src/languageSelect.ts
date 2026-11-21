// Renders and wires the four language dropdowns (translation targets + spoken
// languages) so Settings and the Studios always share one list, localized to
// the active UI language, with locale-aware sorting, search aliases and
// persisted "recent languages" pinning.

import { getLanguage, t } from './i18n/index';
import { customSelectsMap, prefersReducedMotion, safeRaf } from './modules/customSelect';
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
const pendingRefreshCancels = new Map<string, () => void>();
const sortedEntriesCache = new Map<string, readonly LanguageEntry[]>();

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

function getSortedEntries(kind: LanguageSelectKind, uiLang: string): readonly LanguageEntry[] {
  const cacheKey = `${kind}:${uiLang}`;
  const cached = sortedEntriesCache.get(cacheKey);
  if (cached) return cached;

  const raw = kind === 'spoken'
    ? WHISPER_SPOKEN_LANGUAGES.map((lang) => {
        const label = localizedLanguageLabel(lang.code, uiLang, lang.name);
        return {
          value: lang.code,
          label,
          search: buildSearchAliases([label, lang.name, nativeLanguageLabel(lang.code, lang.name), lang.code])
        };
      })
    : TRANSLATION_TARGET_LANGUAGES.map((lang) => {
        const label = localizedLanguageLabel(lang.code, uiLang, lang.name);
        return {
          value: lang.value,
          label,
          search: buildSearchAliases([label, lang.name, nativeLanguageLabel(lang.code, lang.name), lang.code])
        };
      });

  const compare = makeLanguageComparator(uiLang);
  const sorted = [...raw].sort((a, b) => compare(a.label, b.label) || a.value.localeCompare(b.value));
  sortedEntriesCache.set(cacheKey, sorted);
  return sorted;
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

function getSelectInstance(selectId: string): any {
  const winMap = typeof window !== 'undefined' ? ((window as any).customSelectsMap as Map<string, any> | undefined) : undefined;
  return customSelectsMap.get(selectId) || (winMap ? winMap.get(selectId) : null) || null;
}

function refreshCustomSelectInstance(select: HTMLSelectElement): void {
  const instance = getSelectInstance(select.id);
  if (instance && typeof instance.updateOptions === 'function') {
    instance.updateOptions(true);
  }
}

/**
 * Rebuilds a language dropdown: pinned "auto" first (spoken only), then a
 * "Recent languages" group (up to 3), then the remaining languages sorted per
 * the active UI locale so no language appears twice. Unknown legacy values
 * stay visible via a fallback option.
 */
export function renderLanguageSelect(select: HTMLSelectElement, kind: LanguageSelectKind, currentValue?: string): void {
  if (!select) return;
  const uiLang = getLanguage();
  const entries = getSortedEntries(kind, uiLang);

  let targetValue = (currentValue === undefined ? getCurrentSettingsValue(kind) : currentValue).trim();
  if (!targetValue) {
    targetValue = kind === 'spoken' ? AUTO_LANGUAGE_VALUE : TRANSLATION_TARGET_LANGUAGES[0].value;
  }

  const matchedEntry = entries.find((entry) => entry.value.toLowerCase() === targetValue.toLowerCase());
  if (matchedEntry) {
    targetValue = matchedEntry.value;
  } else if (kind === 'spoken' && targetValue.toLowerCase() === AUTO_LANGUAGE_VALUE) {
    targetValue = AUTO_LANGUAGE_VALUE;
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

  const recentValuesSet = new Set(recentEntries.map((entry) => entry.value.toLowerCase()));
  const remaining = entries.filter((entry) => !recentValuesSet.has(entry.value.toLowerCase()));
  if (remaining.length > 0) {
    select.appendChild(makeGroupElement(t('languages.all'), remaining));
  }

  if (!matchedEntry && !(kind === 'spoken' && targetValue === AUTO_LANGUAGE_VALUE)) {
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

function cancelPendingSingleRefresh(id: string): void {
  const cancelPending = pendingRefreshCancels.get(id);
  if (cancelPending) {
    cancelPending();
    pendingRefreshCancels.delete(id);
  }
}

function reRenderKind(kind: LanguageSelectKind, activeValue?: string, excludeId?: string): void {
  const value = activeValue !== undefined ? activeValue : getCurrentSettingsValue(kind);
  LANGUAGE_SELECT_IDS[kind].forEach((id) => {
    if (excludeId && id === excludeId) return;
    cancelPendingSingleRefresh(id);
    const el = document.getElementById(id) as HTMLSelectElement | null;
    if (el) {
      renderLanguageSelect(el, kind, value || el.value);
    }
  });
}

function scheduleActiveSelectRefresh(select: HTMLSelectElement, kind: LanguageSelectKind, value: string): void {
  const cancelPrevious = pendingRefreshCancels.get(select.id);
  if (cancelPrevious) {
    cancelPrevious();
    pendingRefreshCancels.delete(select.id);
  }

  const instance = getSelectInstance(select.id);
  const optionsEl = instance?.optionsContainer as HTMLElement | undefined;

  if (!optionsEl || typeof optionsEl.addEventListener !== 'function' || (prefersReducedMotion() && !instance.isOpen)) {
    safeRaf(() => {
      if (select.isConnected === false) return;
      renderLanguageSelect(select, kind, select.value || value);
    });
    return;
  }

  let finished = false;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (finished) return;
    finished = true;
    if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    optionsEl.removeEventListener('transitionend', onTransitionEnd);
    if (pendingRefreshCancels.get(select.id) === cancel) {
      pendingRefreshCancels.delete(select.id);
    }
  };
  const finish = () => {
    if (finished) return;
    if (select.isConnected === false || getSelectInstance(select.id) !== instance) {
      cancel();
      return;
    }
    if (instance.isOpen) {
      // User reopened before the close fade completed; wait for the next close transition
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(finish, 220);
      return;
    }
    cancel();
    renderLanguageSelect(select, kind, select.value || value);
  };
  const onTransitionEnd = (e: TransitionEvent) => {
    if (e.target === optionsEl && !instance.isOpen) finish();
  };

  pendingRefreshCancels.set(select.id, cancel);
  optionsEl.addEventListener('transitionend', onTransitionEnd);
  fallbackTimer = setTimeout(finish, 220);
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
    const chosenValue = select.value;
    // Update twin dropdowns on next frame, and defer the just-closed dropdown until its fade-out finishes
    safeRaf(() => {
      reRenderKind(kind, chosenValue, select.id);
    });
    scheduleActiveSelectRefresh(select, kind, chosenValue);
  });
}

let deferredLanguageRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let deferredLanguageRefreshGen = 0;

function cancelDeferredLanguageSelectsRefresh(): void {
  deferredLanguageRefreshGen++;
  if (deferredLanguageRefreshTimer !== null) {
    clearTimeout(deferredLanguageRefreshTimer);
    deferredLanguageRefreshTimer = null;
  }
}

function resolveSingleLanguageTriggerLabel(kind: LanguageSelectKind, value: string, uiLang: string): string {
  const trimmed = String(value || '').trim();
  if (kind === 'spoken') {
    if (!trimmed || trimmed.toLowerCase() === AUTO_LANGUAGE_VALUE) {
      return t('transcribe.langAuto');
    }
    const match = WHISPER_SPOKEN_LANGUAGES.find((lang) => lang.code.toLowerCase() === trimmed.toLowerCase());
    return match ? localizedLanguageLabel(match.code, uiLang, match.name) : trimmed;
  }
  const targetValue = trimmed || TRANSLATION_TARGET_LANGUAGES[0].value;
  const match = TRANSLATION_TARGET_LANGUAGES.find((lang) => lang.value.toLowerCase() === targetValue.toLowerCase());
  return match ? localizedLanguageLabel(match.code, uiLang, match.name) : targetValue;
}

function scheduleLanguageSelectsRefresh(): void {
  cancelDeferredLanguageSelectsRefresh();
  const uiLang = getLanguage();
  const tasks: Array<{ kind: LanguageSelectKind; id: string }> = [];

  (Object.keys(LANGUAGE_SELECT_IDS) as LanguageSelectKind[]).forEach((kind) => {
    const currentVal = getCurrentSettingsValue(kind);
    LANGUAGE_SELECT_IDS[kind].forEach((id) => {
      cancelPendingSingleRefresh(id);
      const el = document.getElementById(id) as HTMLSelectElement | null;
      if (!el) return;
      const instance = getSelectInstance(id);
      if (instance) {
        if (typeof instance.syncTriggerLabelText === 'function') {
          const val = el.value || currentVal;
          instance.syncTriggerLabelText(resolveSingleLanguageTriggerLabel(kind, val, uiLang));
        }
        if (typeof instance.setPendingOptionsRefresh === 'function') {
          instance.setPendingOptionsRefresh(() => {
            renderLanguageSelect(el, kind);
          });
        }
      }
      tasks.push({ kind, id });
    });
  });

  if (tasks.length === 0) return;

  // Rebuild heavy searchable language lists one per frame after the 800ms scramble completes
  const gen = deferredLanguageRefreshGen;
  deferredLanguageRefreshTimer = setTimeout(() => {
    deferredLanguageRefreshTimer = null;
    if (gen !== deferredLanguageRefreshGen) return;
    let idx = 0;
    const step = () => {
      if (gen !== deferredLanguageRefreshGen) return;
      while (idx < tasks.length) {
        const task = tasks[idx++];
        const el = document.getElementById(task.id) as HTMLSelectElement | null;
        if (!el) continue;
        const instance = getSelectInstance(task.id);
        if (instance?.isOpen) continue;
        if (instance && typeof instance.hasPendingOptionsRefresh === 'function' && !instance.hasPendingOptionsRefresh()) {
          continue;
        }
        renderLanguageSelect(el, task.kind);
        break;
      }
      if (idx < tasks.length && gen === deferredLanguageRefreshGen) {
        safeRaf(step);
      }
    };
    safeRaf(step);
  }, 840);
}

/** Re-renders all language dropdowns (on UI language change). */
export function refreshLanguageSelects(): void {
  cancelDeferredLanguageSelectsRefresh();
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
    window.addEventListener('whisper:languageChanged', (e: Event) => {
      const isAnimated = Boolean((e as CustomEvent)?.detail?.animated);
      if (isAnimated) {
        scheduleLanguageSelectsRefresh();
      } else {
        refreshLanguageSelects();
      }
    });
  }
}
