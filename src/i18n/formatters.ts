// Universal i18n & Numeric Formatting Utilities for Whisper Desktop
import { getLanguage } from './index';

export function toEnglishDigits(str: unknown): string {
  const persianMap: Record<string, string> = { '۰':'0', '۱':'1', '۲':'2', '۳':'3', '۴':'4', '۵':'5', '۶':'6', '۷':'7', '۸':'8', '۹':'9' };
  const arabicMap: Record<string, string> = { '٠':'0', '١':'1', '٢':'2', '٣':'3', '٤':'4', '٥':'5', '٦':'6', '٧':'7', '٨':'8', '٩':'9' };
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[۰-۹]/g, d => persianMap[d] || d).replace(/[٠-٩]/g, d => arabicMap[d] || d);
}

export function formatTokensShort(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '0';
  const n = typeof num === 'number' ? Math.round(num) : parseInt(String(num), 10);
  if (isNaN(n) || n <= 0) return '0';
  
  if (n === 2097152 || n === 2000000) return '2M';
  if (n === 1048576 || n === 1000000) return '1M';
  if (n === 524288 || n === 512000) return '512K';
  if (n === 262144 || n === 256000) return '256K';
  if (n === 131072 || n === 128000) return '128K';
  if (n === 65536 || n === 64000) return '64K';
  if (n === 32768 || n === 32000) return '32K';
  if (n === 16384 || n === 16000) return '16K';
  if (n === 8192 || n === 8000) return '8K';
  if (n === 4096 || n === 4000) return '4K';
  
  if (n >= 1000000) {
    if (n % 1000000 === 0) return (n / 1000000) + 'M';
    if (n % 1048576 === 0) return (n / 1048576) + 'M';
    const val = n / 1000000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  
  if (n >= 1000) {
    if (n % 1000 === 0) return (n / 1000) + 'K';
    if (n % 1024 === 0) return (n / 1024) + 'K';
    const val = n / 1000;
    return (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1).replace(/\.0$/, '')) + 'K';
  }
  return n.toLocaleString();
}

export function parseTokensInput(val: unknown): number {
  if (typeof val === 'number') {
    return !isNaN(val) && val > 0 ? Math.round(val) : 200000;
  }
  if (!val) return 200000;
  const str = toEnglishDigits(String(val).trim().toUpperCase());
  
  const matchM = str.match(/^(\d+(?:\.\d+)?)\s*(?:M|MILLION)(?:\s*TOKENS?)?$/);
  if (matchM) {
    const num = parseFloat(matchM[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000000) : 200000;
  }

  const matchK = str.match(/^(\d+(?:\.\d+)?)\s*(?:K|THOUSAND)(?:\s*TOKENS?)?$/);
  if (matchK) {
    const num = parseFloat(matchK[1]);
    return !isNaN(num) && num > 0 ? Math.round(num * 1000) : 200000;
  }

  const matchNum = str.match(/^([\d,]+)(?:\s*TOKENS?)?$/);
  if (matchNum) {
    const cleaned = matchNum[1].replace(/,/g, '');
    const num = parseInt(cleaned, 10);
    return !isNaN(num) && num > 0 ? num : 200000;
  }

  return 200000;
}

export function formatNumberForLang(num: number | string | null | undefined): string {
  if (num === null || num === undefined) return '';
  const str = String(num);
  const resolveGetLang = () =>
    (typeof window !== 'undefined' && typeof (window as any).getLanguage === 'function' ? (window as any).getLanguage() : null) ||
    (typeof globalThis !== 'undefined' && typeof (globalThis as any).getLanguage === 'function' ? (globalThis as any).getLanguage() : null) ||
    (typeof getLanguage === 'function' ? getLanguage() : 'en');
  const lang = resolveGetLang();
  if (lang === 'fa') {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return str.replace(/[0-9]/g, d => persianDigits[Number(d)]);
  }
  if (lang === 'ar') {
    const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return str.replace(/[0-9]/g, d => arabicDigits[Number(d)]);
  }
  return str;
}

export function formatLocalizedNumber(num: number | string | null | undefined, lang = getLanguage(), maxFrac = 1): string {
  if (num === undefined || num === null || num === '') return '';
  const n = typeof num === 'number' ? num : parseFloat(String(num));
  if (isNaN(n)) return '';

  const cleanLang = (lang || 'en').toLowerCase().trim();
  let localeCode = 'en-US';
  if (cleanLang === 'fa') localeCode = 'fa-IR';
  else if (cleanLang === 'ar') localeCode = 'ar-SA';
  else if (cleanLang === 'de') localeCode = 'de-DE';
  else if (cleanLang === 'es') localeCode = 'es-ES';
  else if (cleanLang === 'fr') localeCode = 'fr-FR';
  else if (cleanLang === 'it') localeCode = 'it-IT';
  else if (cleanLang === 'ja') localeCode = 'ja-JP';
  else if (cleanLang === 'ko') localeCode = 'ko-KR';
  else if (cleanLang === 'pt') localeCode = 'pt-BR';
  else if (cleanLang === 'ru') localeCode = 'ru-RU';
  else if (cleanLang === 'tr') localeCode = 'tr-TR';
  else if (cleanLang === 'zh') localeCode = 'zh-CN';

  try {
    return new Intl.NumberFormat(localeCode, {
      maximumFractionDigits: maxFrac
    }).format(n);
  } catch (_) {
    return n.toFixed(maxFrac);
  }
}
