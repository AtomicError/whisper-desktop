// Single source of truth for transcription and translation language lists.
// Display labels come from CLDR via Intl.DisplayNames in the active UI language,
// so no per-language translation files are needed.

export interface WhisperLanguage {
  /** whisper.cpp language code passed to `-l` */
  code: string;
  /** English name (fallback label + search alias) */
  name: string;
}

export interface TranslationLanguage {
  /** Exact value persisted in settings.translateAiTargetLang (English name) */
  value: string;
  /** BCP-47 code used with Intl.DisplayNames */
  code: string;
  /** English name (fallback label + search alias) */
  name: string;
}

// All languages supported by whisper.cpp (g_lang map).
export const WHISPER_SPOKEN_LANGUAGES: WhisperLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'ru', name: 'Russian' },
  { code: 'ko', name: 'Korean' },
  { code: 'fr', name: 'French' },
  { code: 'ja', name: 'Japanese' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'ca', name: 'Catalan' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ar', name: 'Arabic' },
  { code: 'sv', name: 'Swedish' },
  { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fi', name: 'Finnish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'he', name: 'Hebrew' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'el', name: 'Greek' },
  { code: 'ms', name: 'Malay' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'da', name: 'Danish' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'ta', name: 'Tamil' },
  { code: 'no', name: 'Norwegian' },
  { code: 'th', name: 'Thai' },
  { code: 'ur', name: 'Urdu' },
  { code: 'hr', name: 'Croatian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'la', name: 'Latin' },
  { code: 'mi', name: 'Maori' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'cy', name: 'Welsh' },
  { code: 'sk', name: 'Slovak' },
  { code: 'te', name: 'Telugu' },
  { code: 'fa', name: 'Persian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'sr', name: 'Serbian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'kn', name: 'Kannada' },
  { code: 'et', name: 'Estonian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'br', name: 'Breton' },
  { code: 'eu', name: 'Basque' },
  { code: 'is', name: 'Icelandic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sw', name: 'Swahili' },
  { code: 'gl', name: 'Galician' },
  { code: 'mr', name: 'Marathi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'si', name: 'Sinhala' },
  { code: 'km', name: 'Khmer' },
  { code: 'sn', name: 'Shona' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'so', name: 'Somali' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'oc', name: 'Occitan' },
  { code: 'ka', name: 'Georgian' },
  { code: 'be', name: 'Belarusian' },
  { code: 'tg', name: 'Tajik' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'am', name: 'Amharic' },
  { code: 'yi', name: 'Yiddish' },
  { code: 'lo', name: 'Lao' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'fo', name: 'Faroese' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'ps', name: 'Pashto' },
  { code: 'tk', name: 'Turkmen' },
  { code: 'nn', name: 'Nynorsk' },
  { code: 'mt', name: 'Maltese' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'my', name: 'Burmese' },
  { code: 'bo', name: 'Tibetan' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'as', name: 'Assamese' },
  { code: 'tt', name: 'Tatar' },
  { code: 'haw', name: 'Hawaiian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ba', name: 'Bashkir' },
  { code: 'jw', name: 'Javanese' },
  { code: 'su', name: 'Sundanese' },
  { code: 'yue', name: 'Cantonese' }
];

// Unified translation target list (Settings and Translation Studio render the
// same entries). `value` must stay byte-identical to previously stored settings.
export const TRANSLATION_TARGET_LANGUAGES: TranslationLanguage[] = [
  { value: 'Persian', code: 'fa', name: 'Persian' },
  { value: 'English', code: 'en', name: 'English' },
  { value: 'Simplified Chinese', code: 'zh-Hans', name: 'Simplified Chinese' },
  { value: 'Traditional Chinese', code: 'zh-Hant', name: 'Traditional Chinese' },
  { value: 'Spanish', code: 'es', name: 'Spanish' },
  { value: 'French', code: 'fr', name: 'French' },
  { value: 'German', code: 'de', name: 'German' },
  { value: 'Japanese', code: 'ja', name: 'Japanese' },
  { value: 'Korean', code: 'ko', name: 'Korean' },
  { value: 'Hindi', code: 'hi', name: 'Hindi' },
  { value: 'Arabic', code: 'ar', name: 'Arabic' },
  { value: 'Russian', code: 'ru', name: 'Russian' },
  { value: 'Portuguese (Brazil)', code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { value: 'Portuguese (Portugal)', code: 'pt-PT', name: 'Portuguese (Portugal)' },
  { value: 'Indonesian', code: 'id', name: 'Indonesian' },
  { value: 'Vietnamese', code: 'vi', name: 'Vietnamese' },
  { value: 'Italian', code: 'it', name: 'Italian' },
  { value: 'Cantonese', code: 'yue', name: 'Cantonese' },
  { value: 'Turkish', code: 'tr', name: 'Turkish' },
  { value: 'Hebrew', code: 'he', name: 'Hebrew' },
  { value: 'Urdu', code: 'ur', name: 'Urdu' },
  { value: 'Pashto', code: 'ps', name: 'Pashto' },
  { value: 'Dari', code: 'fa-AF', name: 'Dari' },
  { value: 'Central Kurdish', code: 'ckb', name: 'Central Kurdish' },
  { value: 'Northern Kurdish', code: 'kmr', name: 'Northern Kurdish' },
  { value: 'Polish', code: 'pl', name: 'Polish' },
  { value: 'Ukrainian', code: 'uk', name: 'Ukrainian' },
  { value: 'Dutch', code: 'nl', name: 'Dutch' },
  { value: 'Romanian', code: 'ro', name: 'Romanian' },
  { value: 'Greek', code: 'el', name: 'Greek' },
  { value: 'Hungarian', code: 'hu', name: 'Hungarian' },
  { value: 'Swedish', code: 'sv', name: 'Swedish' },
  { value: 'Czech', code: 'cs', name: 'Czech' },
  { value: 'Catalan', code: 'ca', name: 'Catalan' },
  { value: 'Serbian', code: 'sr', name: 'Serbian' },
  { value: 'Bulgarian', code: 'bg', name: 'Bulgarian' },
  { value: 'Armenian', code: 'hy', name: 'Armenian' },
  { value: 'Danish', code: 'da', name: 'Danish' },
  { value: 'Albanian', code: 'sq', name: 'Albanian' },
  { value: 'Finnish', code: 'fi', name: 'Finnish' },
  { value: 'Norwegian Bokmål', code: 'nb', name: 'Norwegian Bokmål' },
  { value: 'Slovak', code: 'sk', name: 'Slovak' },
  { value: 'Croatian', code: 'hr', name: 'Croatian' },
  { value: 'Belarusian', code: 'be', name: 'Belarusian' },
  { value: 'Sicilian', code: 'scn', name: 'Sicilian' },
  { value: 'Georgian', code: 'ka', name: 'Georgian' },
  { value: 'Lombard', code: 'lmo', name: 'Lombard' },
  { value: 'Lithuanian', code: 'lt', name: 'Lithuanian' },
  { value: 'Galician', code: 'gl', name: 'Galician' },
  { value: 'Bosnian', code: 'bs', name: 'Bosnian' },
  { value: 'Slovenian', code: 'sl', name: 'Slovenian' },
  { value: 'Macedonian', code: 'mk', name: 'Macedonian' },
  { value: 'Latvian', code: 'lv', name: 'Latvian' },
  { value: 'Estonian', code: 'et', name: 'Estonian' },
  { value: 'Icelandic', code: 'is', name: 'Icelandic' },
  { value: 'Maltese', code: 'mt', name: 'Maltese' },
  { value: 'Welsh', code: 'cy', name: 'Welsh' },
  { value: 'Irish', code: 'ga', name: 'Irish' },
  { value: 'Breton', code: 'br', name: 'Breton' },
  { value: 'Basque', code: 'eu', name: 'Basque' },
  { value: 'Yiddish', code: 'yi', name: 'Yiddish' },
  { value: 'Luxembourgish', code: 'lb', name: 'Luxembourgish' },
  { value: 'Occitan', code: 'oc', name: 'Occitan' },
  { value: 'Aragonese', code: 'an', name: 'Aragonese' },
  { value: 'Latin', code: 'la', name: 'Latin' },
  { value: 'Esperanto', code: 'eo', name: 'Esperanto' },
  { value: 'Uzbek', code: 'uz', name: 'Uzbek' },
  { value: 'Kazakh', code: 'kk', name: 'Kazakh' },
  { value: 'Kyrgyz', code: 'ky', name: 'Kyrgyz' },
  { value: 'Turkmen', code: 'tk', name: 'Turkmen' },
  { value: 'Azerbaijani', code: 'az', name: 'Azerbaijani' },
  { value: 'Tajik', code: 'tg', name: 'Tajik' },
  { value: 'Mongolian', code: 'mn', name: 'Mongolian' },
  { value: 'Bashkir', code: 'ba', name: 'Bashkir' },
  { value: 'Tatar', code: 'tt', name: 'Tatar' },
  { value: 'Uyghur', code: 'ug', name: 'Uyghur' },
  { value: 'Bengali', code: 'bn', name: 'Bengali' },
  { value: 'Marathi', code: 'mr', name: 'Marathi' },
  { value: 'Telugu', code: 'te', name: 'Telugu' },
  { value: 'Tamil', code: 'ta', name: 'Tamil' },
  { value: 'Gujarati', code: 'gu', name: 'Gujarati' },
  { value: 'Kannada', code: 'kn', name: 'Kannada' },
  { value: 'Punjabi', code: 'pa', name: 'Punjabi' },
  { value: 'Malayalam', code: 'ml', name: 'Malayalam' },
  { value: 'Bhojpuri', code: 'bho', name: 'Bhojpuri' },
  { value: 'Maithili', code: 'mai', name: 'Maithili' },
  { value: 'Nepali', code: 'ne', name: 'Nepali' },
  { value: 'Sinhala', code: 'si', name: 'Sinhala' },
  { value: 'Assamese', code: 'as', name: 'Assamese' },
  { value: 'Konkani', code: 'kok', name: 'Konkani' },
  { value: 'Sanskrit', code: 'sa', name: 'Sanskrit' },
  { value: 'Thai', code: 'th', name: 'Thai' },
  { value: 'Lao', code: 'lo', name: 'Lao' },
  { value: 'Burmese', code: 'my', name: 'Burmese' },
  { value: 'Khmer', code: 'km', name: 'Khmer' },
  { value: 'Malay', code: 'ms', name: 'Malay' },
  { value: 'Filipino', code: 'fil', name: 'Filipino' },
  { value: 'Javanese', code: 'jv', name: 'Javanese' },
  { value: 'Sundanese', code: 'su', name: 'Sundanese' },
  { value: 'Acehnese', code: 'ace', name: 'Acehnese' },
  { value: 'Pangasinan', code: 'pag', name: 'Pangasinan' },
  { value: 'Pampangan', code: 'pam', name: 'Pampangan' },
  { value: 'Cebuano', code: 'ceb', name: 'Cebuano' },
  { value: 'Swahili', code: 'sw', name: 'Swahili' },
  { value: 'Hausa', code: 'ha', name: 'Hausa' },
  { value: 'Amharic', code: 'am', name: 'Amharic' },
  { value: 'Igbo', code: 'ig', name: 'Igbo' },
  { value: 'Wolof', code: 'wo', name: 'Wolof' },
  { value: 'Xhosa', code: 'xh', name: 'Xhosa' },
  { value: 'Zulu', code: 'zu', name: 'Zulu' },
  { value: 'Afrikaans', code: 'af', name: 'Afrikaans' },
  { value: 'Oromo', code: 'om', name: 'Oromo' },
  { value: 'Southern Sotho', code: 'st', name: 'Southern Sotho' },
  { value: 'Tswana', code: 'tn', name: 'Tswana' },
  { value: 'Tsonga', code: 'ts', name: 'Tsonga' },
  { value: 'Malagasy', code: 'mg', name: 'Malagasy' },
  { value: 'Lingala', code: 'ln', name: 'Lingala' },
  { value: 'Haitian Creole', code: 'ht', name: 'Haitian Creole' },
  { value: 'Quechua', code: 'qu', name: 'Quechua' },
  { value: 'Aymara', code: 'ay', name: 'Aymara' },
  { value: 'Guarani', code: 'gn', name: 'Guarani' },
  { value: 'Maori', code: 'mi', name: 'Maori' }
];

// CLDR alias fixes for codes Intl.DisplayNames may not resolve directly.
const DISPLAY_NAME_ALIASES: Record<string, string> = {
  jw: 'jv' // whisper uses legacy Javanese code
};

const MAX_RECENT_LANGUAGES = 3;

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function getDisplayNames(locale: string): Intl.DisplayNames | null {
  if (displayNamesCache.has(locale)) {
    return displayNamesCache.get(locale) ?? null;
  }
  let instance: Intl.DisplayNames | null = null;
  try {
    if (typeof Intl !== 'undefined' && typeof (Intl as any).DisplayNames === 'function') {
      instance = new Intl.DisplayNames([locale], { type: 'language' });
    }
  } catch (_) {
    instance = null;
  }
  displayNamesCache.set(locale, instance);
  return instance;
}

function resolveDisplayName(dn: Intl.DisplayNames | null, code: string): string | undefined {
  if (!dn) return undefined;
  try {
    const resolved = dn.of(DISPLAY_NAME_ALIASES[code] ?? code);
    // CLDR returns the input code when the language is unknown
    if (resolved && resolved.toLowerCase() !== code.toLowerCase()) {
      return resolved;
    }
  } catch (_) {
    /* fall through */
  }
  return undefined;
}

/** Localized label for a BCP-47 code in the given UI language (CLDR-based). */
export function localizedLanguageLabel(code: string, uiLang: string, fallback: string): string {
  const localized = resolveDisplayName(getDisplayNames(uiLang), code);
  return localized || fallback;
}

/** Name of the language in its own language (native script), for search. */
export function nativeLanguageLabel(code: string, fallback: string): string {
  return resolveDisplayName(getDisplayNames(code), code) || fallback;
}

/** Locale-aware comparator for localized language labels. */
export function makeLanguageComparator(uiLang: string): (a: string, b: string) => number {
  let collator: Intl.Collator;
  try {
    collator = new Intl.Collator(uiLang, { sensitivity: 'base', usage: 'sort' });
  } catch (_) {
    collator = new Intl.Collator('en', { sensitivity: 'base', usage: 'sort' });
  }
  return (a: string, b: string) => collator.compare(a, b) || a.localeCompare(b);
}

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/**
 * Normalizes text for language search: case-, diacritic- and Arabic-variant
 * insensitive; drops the Arabic definite article so "الإنجليزية" matches a
 * query like "انجليزيه".
 */
export function normalizeForSearch(input: string): string {
  let s = (input || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(ARABIC_DIACRITICS, '');
  s = s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[يى]/g, 'ی')
    .replace(/[كک]/g, 'ک');
  // \b is unusable with Arabic (non-\w chars); anchor on string start/space instead.
  s = s.replace(/(^|\s)ال(?=\S{2,})/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

/** True when the normalized query matches any of the haystack aliases. */
export function matchesLanguageQuery(query: string, haystacks: string[]): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return haystacks.some((hay) => normalizeForSearch(hay).includes(q));
}

/** Front-inserts a value into a recents list (dedup, capped). */
export function pushRecentLanguage(list: unknown, value: string, max = MAX_RECENT_LANGUAGES): string[] {
  if (!value || value.toLowerCase() === 'auto') {
    return readRecentLanguages(list);
  }
  const base = Array.isArray(list)
    ? list.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.toLowerCase() !== 'auto')
    : [];
  const next = [value, ...base.filter((v) => v !== value)];
  return next.slice(0, max);
}

/** Reads a recents list defensively from settings state. */
export function readRecentLanguages(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  return source
    .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.toLowerCase() !== 'auto')
    .slice(0, MAX_RECENT_LANGUAGES);
}

