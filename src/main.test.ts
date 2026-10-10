import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockElement {
  public tagName: string;
  public id: string = '';
  public style: Record<string, string> = {};
  public parent: MockElement | null = null;
  public children: MockElement[] = [];
  public disabled: boolean = false;
  private attributes: Map<string, string> = new Map();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement) {
    child.parent = this;
    this.children.push(child);
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (selector.includes('display: none') && cur.style.display === 'none') return cur;
      cur = cur.parent;
    }
    return null;
  }

  contains(child: MockElement | null): boolean {
    let cur = child;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (child.tagName === 'BUTTON' || child.tagName === 'INPUT') {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  focus() {
    (globalThis as any).document.activeElement = this;
  }
}

describe('modal focus trap & accessibility', () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};
  let originalDocument: any;

  beforeEach(() => {
    listeners = {};
    originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      activeElement: null,
      addEventListener: (type: string, fn: (e: any) => void) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: (e: any) => void) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent: (e: any) => {
        const fns = listeners[e.type] || [];
        for (const fn of fns) fn(e);
      },
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  function trapModalFocus(modalEl: MockElement, closeCallback: () => void) {
    let previousActiveElement = (globalThis as any).document.activeElement;

    const isVisible = (el: MockElement) => {
      if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
      if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
      if (el.closest && el.closest('[style*="display: none"]')) return false;
      return true;
    };

    const keyHandler = (e: any) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCallback();
        return;
      }

      if (e.key === 'Tab') {
        const candidates = modalEl.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const focusable = candidates.filter(isVisible);
        if (!focusable.length) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if ((globalThis as any).document.activeElement === first || !modalEl.contains((globalThis as any).document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if ((globalThis as any).document.activeElement === last || !modalEl.contains((globalThis as any).document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    (globalThis as any).document.addEventListener('keydown', keyHandler);

    return {
      release: () => {
        (globalThis as any).document.removeEventListener('keydown', keyHandler);
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
          previousActiveElement.focus();
          previousActiveElement = null;
        }
      }
    };
  }

  it('traps Tab focus only within visible elements, skipping hidden footers', () => {
    const modal = new MockElement('DIV');
    const input1 = new MockElement('INPUT');
    modal.appendChild(input1);

    const okFooter = new MockElement('DIV');
    okFooter.style.display = 'flex';
    const btnOk = new MockElement('BUTTON');
    okFooter.appendChild(btnOk);
    modal.appendChild(okFooter);

    const confirmFooter = new MockElement('DIV');
    confirmFooter.style.display = 'none';
    const btnDelete = new MockElement('BUTTON');
    const btnCancel = new MockElement('BUTTON');
    confirmFooter.appendChild(btnDelete);
    confirmFooter.appendChild(btnCancel);
    modal.appendChild(confirmFooter);

    const closeSpy = vi.fn();
    const trap = trapModalFocus(modal, closeSpy);

    btnOk.focus();
    expect((globalThis as any).document.activeElement).toBe(btnOk);

    // Forward Tab from btnOk should wrap to input1 (skipping hidden btnDelete and btnCancel)
    let defaultPrevented = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });
    expect(defaultPrevented).toBe(true);
    expect((globalThis as any).document.activeElement).toBe(input1);

    // Shift+Tab from input1 should wrap to btnOk
    defaultPrevented = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });
    expect(defaultPrevented).toBe(true);
    expect((globalThis as any).document.activeElement).toBe(btnOk);

    // Escape triggers closeCallback
    let stopped = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: () => {},
      stopPropagation: () => { stopped = true; }
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);

    trap.release();
  });

  it('restores focus to previous active element upon release', () => {
    const trigger = new MockElement('BUTTON');
    trigger.focus();
    expect((globalThis as any).document.activeElement).toBe(trigger);

    const modal = new MockElement('DIV');
    const modalBtn = new MockElement('BUTTON');
    modal.appendChild(modalBtn);

    const trap = trapModalFocus(modal, vi.fn());
    modalBtn.focus();
    expect((globalThis as any).document.activeElement).toBe(modalBtn);

    trap.release();
    expect((globalThis as any).document.activeElement).toBe(trigger);
  });

  it('skips elements styled with visibility: hidden even when layout parent is present', () => {
    const modal = new MockElement('DIV');
    const hiddenBtn = new MockElement('BUTTON');
    hiddenBtn.style.visibility = 'hidden';
    const visibleBtn = new MockElement('BUTTON');
    modal.appendChild(hiddenBtn);
    modal.appendChild(visibleBtn);

    const trap = trapModalFocus(modal, vi.fn());
    (globalThis as any).document.activeElement = null;

    let defaultPrevented = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });

    expect(defaultPrevented).toBe(true);
    expect((globalThis as any).document.activeElement).toBe(visibleBtn);
    trap.release();
  });
});

describe('logs category filter & copy', () => {
  const sampleLogs = [
    { timestamp: '10:00:00', category: 'Whisper', message: 'Model loaded' },
    { timestamp: '10:00:01', category: 'Translate', message: 'Prompt sent' },
    { timestamp: '10:00:02', category: 'Whisper', message: 'Decoding audio' },
    { timestamp: '10:00:03', category: 'System', message: 'Memory safe' },
  ];

  function filterLogs(logs: any[], activeCategory: string, query = '') {
    if (!logs || logs.length === 0) return [];
    let result = logs;
    if (activeCategory !== 'All') {
      result = result.filter(l => l.category === activeCategory);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(l =>
        (l.message && l.message.toLowerCase().includes(q)) ||
        (l.category && l.category.toLowerCase().includes(q))
      );
    }
    return result;
  }

  it('filters whisper logs when whisper tab is active', () => {
    const whisperLogs = filterLogs(sampleLogs, 'Whisper');
    expect(whisperLogs.length).toBe(2);
    expect(whisperLogs.every(l => l.category === 'Whisper')).toBe(true);
  });

  it('filters translate logs when translate tab is active', () => {
    const translateLogs = filterLogs(sampleLogs, 'Translate');
    expect(translateLogs.length).toBe(1);
    expect(translateLogs[0].message).toBe('Prompt sent');
  });

  it('copies all logs when all tab is active', () => {
    const all = filterLogs(sampleLogs, 'All');
    expect(all.length).toBe(4);
  });

  it('filters by search query', () => {
    const searched = filterLogs(sampleLogs, 'All', 'decoding');
    expect(searched.length).toBe(1);
    expect(searched[0].message).toBe('Decoding audio');
  });

  it('matches logs when search query matches category name', () => {
    const searched = filterLogs(sampleLogs, 'All', 'whisper');
    expect(searched.length).toBe(2);
  });
});

describe('number localization formatting', () => {
  function formatLocalizedNumber(num: any, lang: string, maxFrac = 1) {
    if (num === null || num === undefined || num === '' || isNaN(num)) return '';
    if (lang === 'fa') {
      return Number(num).toLocaleString('fa-IR', { maximumFractionDigits: maxFrac });
    }
    if (lang === 'ar') {
      return Number(num).toLocaleString('ar-SA', { maximumFractionDigits: maxFrac });
    }
    return Number(num).toLocaleString('en-US', { maximumFractionDigits: maxFrac });
  }

  it('formats numbers with Persian digits for fa', () => {
    const result = formatLocalizedNumber(4, 'fa', 0);
    expect(result).toBe('۴');
  });

  it('formats numbers with Arabic-Indic digits for ar', () => {
    const result = formatLocalizedNumber(8, 'ar', 0);
    expect(result).toBe('٨');
  });

  it('formats numbers with Latin digits for other locales', () => {
    expect(formatLocalizedNumber(8, 'en', 0)).toBe('8');
    expect(formatLocalizedNumber(8, 'de', 0)).toBe('8');
  });

  it('returns empty string for empty input, null, or undefined', () => {
    expect(formatLocalizedNumber('', 'fa', 0)).toBe('');
    expect(formatLocalizedNumber(null, 'fa', 0)).toBe('');
    expect(formatLocalizedNumber(undefined, 'fa', 0)).toBe('');
  });
});

describe('toast message multi-line rendering', () => {
  function parseToastContent(message: string) {
    if (message && typeof message === 'string' && message.includes('\n')) {
      const newlineIndex = message.indexOf('\n');
      const header = message.substring(0, newlineIndex).trim();
      const technical = message.substring(newlineIndex + 1).trim();
      if (technical) {
        return {
          isMultiLine: true,
          header,
          technical,
        };
      }
      return {
        isMultiLine: false,
        text: header || message,
      };
    }
    return {
      isMultiLine: false,
      text: message,
    };
  }

  it('correctly splits multi-line error into header and technical detail', () => {
    const errorMsg = 'رونویسی با خطا مواجه شد:\nVulkan GPU (whisper-cli-vulkan) was terminated unexpectedly by a system signal.';
    const parsed = parseToastContent(errorMsg);
    expect(parsed.isMultiLine).toBe(true);
    expect(parsed.header).toBe('رونویسی با خطا مواجه شد:');
    expect(parsed.technical).toBe('Vulkan GPU (whisper-cli-vulkan) was terminated unexpectedly by a system signal.');
  });

  it('falls back to single-line when technical detail after newline is empty', () => {
    const errorMsg = 'خطا در بارگذاری تنظیمات:\n';
    const parsed = parseToastContent(errorMsg);
    expect(parsed.isMultiLine).toBe(false);
    expect(parsed.text).toBe('خطا در بارگذاری تنظیمات:');
  });

  it('keeps single-line messages intact', () => {
    const infoMsg = 'متن رونویسی با موفقیت کپی شد!';
    const parsed = parseToastContent(infoMsg);
    expect(parsed.isMultiLine).toBe(false);
    expect(parsed.text).toBe(infoMsg);
  });
});

describe('toast notification formatting and orphan prevention', () => {
  function formatToastMessage(text: string | null | undefined): string | null | undefined {
    if (!text || typeof text !== 'string') return text;
    return text.split('\n').map(line => {
      return line.replace(/(\S+)[^\S\r\n]+(\S{1,25}[.!?،؛:»)"']?)[^\S\r\n]*$/, '$1\u00A0$2');
    }).join('\n');
  }

  it('prevents orphan word at the end of Persian toast messages', () => {
    const raw = 'مدل ggml-silero-vad-v6.2.3.bin از دیسک حذف شد.';
    const formatted = formatToastMessage(raw);
    expect(formatted).toBe('مدل ggml-silero-vad-v6.2.3.bin از دیسک حذف\u00A0شد.');
  });

  it('prevents orphan word for English messages', () => {
    const raw = 'Transcription completed successfully.';
    const formatted = formatToastMessage(raw);
    expect(formatted).toBe('Transcription completed\u00A0successfully.');
  });

  it('preserves multi-line structure and explicit newlines without collapsing lines', () => {
    const raw = 'خط اول\nدوم';
    const formatted = formatToastMessage(raw);
    expect(formatted).toBe('خط\u00A0اول\nدوم');
    expect(formatted?.includes('\n')).toBe(true);
  });

  it('applies orphan prevention to each multi-word line in a multi-line message', () => {
    const raw = 'خط اول پیام مهم\nخط دوم توضیحات تکمیلی شد.';
    const formatted = formatToastMessage(raw);
    expect(formatted).toBe('خط اول پیام\u00A0مهم\nخط دوم توضیحات تکمیلی\u00A0شد.');
  });

  it('handles various trailing punctuation characters gracefully', () => {
    expect(formatToastMessage('دانلود مدل انجام شد...')).toBe('دانلود مدل انجام\u00A0شد...');
    expect(formatToastMessage('عملیات با موفقیت انجام شد!')).toBe('عملیات با موفقیت انجام\u00A0شد!');
    expect(formatToastMessage('آیا مطمئن هستید؟')).toBe('آیا مطمئن\u00A0هستید؟');
    expect(formatToastMessage('دانلود نسخه آزمایشی (تست)')).toBe('دانلود نسخه آزمایشی\u00A0(تست)');
    expect(formatToastMessage('فایل ذخیره شد.')).toBe('فایل ذخیره\u00A0شد.');
  });

  it('does not inappropriately bind massive unbroken technical paths', () => {
    const longToken = '/very/long/unbroken/path/to/models/without/any/spaces/ggml-v6.2.3.bin';
    const raw = `دانلود ${longToken}`;
    const formatted = formatToastMessage(raw);
    // Because the second token exceeds 25 chars, normal wrap boundary is preserved
    expect(formatted).toBe(`دانلود ${longToken}`);
  });

  it('preserves single-word messages without crashing', () => {
    expect(formatToastMessage('Completed')).toBe('Completed');
    expect(formatToastMessage('تکمیل')).toBe('تکمیل');
  });

  it('handles trailing whitespace cleanly', () => {
    expect(formatToastMessage('مدل ذخیره شد.   ')).toBe('مدل ذخیره\u00A0شد.');
  });

  it('handles empty and null inputs gracefully', () => {
    expect(formatToastMessage('')).toBe('');
    expect(formatToastMessage(null as any)).toBe(null);
    expect(formatToastMessage(undefined as any)).toBe(undefined);
  });
});

describe('CustomSelect model search placeholder and label resolution', () => {
  function resolveCustomSelectLabels(selectEl: {
    hasAttribute: (attr: string) => boolean;
    id?: string;
    dataset?: Record<string, string>;
  }, tFn?: (key: string) => string) {
    const isModelSelect = Boolean(
      selectEl.hasAttribute('data-model-select') ||
      (selectEl.id && selectEl.id.toLowerCase().includes('model'))
    );

    const getSearchPlaceholder = () => {
      if (selectEl.dataset?.searchPlaceholderKey && typeof tFn === 'function') {
        return tFn(selectEl.dataset.searchPlaceholderKey);
      }
      if (selectEl.dataset?.searchPlaceholder) {
        return selectEl.dataset.searchPlaceholder;
      }
      if (isModelSelect) {
        return (typeof tFn === 'function')
          ? tFn('settings.searchModelsPlaceholder')
          : 'Search models by identifier...';
      }
      return (typeof tFn === 'function')
        ? tFn('common.searchLanguage')
        : 'Search…';
    };

    const getNoResultsText = () => {
      if (selectEl.dataset?.searchNoResultsKey && typeof tFn === 'function') {
        return tFn(selectEl.dataset.searchNoResultsKey);
      }
      if (selectEl.dataset?.searchNoResults) {
        return selectEl.dataset.searchNoResults;
      }
      if (isModelSelect) {
        return (typeof tFn === 'function')
          ? tFn('settings.noMatchingModels')
          : 'No Matching Models Found';
      }
      return (typeof tFn === 'function')
        ? tFn('languages.noResults')
        : 'No matching language';
    };

    const getPlaceholder = () => {
      if (selectEl.dataset?.placeholderKey && typeof tFn === 'function') {
        return tFn(selectEl.dataset.placeholderKey);
      }
      if (selectEl.dataset?.placeholder) {
        return selectEl.dataset.placeholder;
      }
      if ((selectEl as any).placeholder) {
        return (selectEl as any).placeholder;
      }
      return (typeof tFn === 'function')
        ? tFn('common.select')
        : 'Select...';
    };

    return {
      isModelSelect,
      placeholder: getSearchPlaceholder(),
      noResults: getNoResultsText(),
      defaultPlaceholder: getPlaceholder(),
    };
  }

  const mockT = (key: string) => {
    const dict: Record<string, string> = {
      'settings.searchModelsPlaceholder': 'جستجوی مدل‌ها با شناسه...',
      'settings.noMatchingModels': 'هیچ مدل منطبقی یافت نشد',
      'common.searchLanguage': 'جستجوی زبان...',
      'languages.noResults': 'زبانی یافت نشد',
      'common.select': 'انتخاب...',
    };
    return dict[key] || key;
  };

  it('detects model select with data-model-select attribute and returns model translations', () => {
    const el = {
      hasAttribute: (attr: string) => attr === 'data-model-select' || attr === 'data-searchable',
      id: 'quick-opt-model',
    };
    const resolved = resolveCustomSelectLabels(el, mockT);
    expect(resolved.isModelSelect).toBe(true);
    expect(resolved.placeholder).toBe('جستجوی مدل‌ها با شناسه...');
    expect(resolved.noResults).toBe('هیچ مدل منطبقی یافت نشد');
  });

  it('detects translation studio model dropdown with translate-model-select ID', () => {
    const el = {
      hasAttribute: (attr: string) => attr === 'data-searchable',
      id: 'translate-model-select',
    };
    const resolved = resolveCustomSelectLabels(el, mockT);
    expect(resolved.isModelSelect).toBe(true);
    expect(resolved.placeholder).toBe('جستجوی مدل‌ها با شناسه...');
    expect(resolved.noResults).toBe('هیچ مدل منطبقی یافت نشد');
  });

  it('falls back to language placeholder and no-results for standard language dropdowns', () => {
    const el = {
      hasAttribute: (attr: string) => attr === 'data-searchable',
      id: 'opt-language',
    };
    const resolved = resolveCustomSelectLabels(el, mockT);
    expect(resolved.isModelSelect).toBe(false);
    expect(resolved.placeholder).toBe('جستجوی زبان...');
    expect(resolved.noResults).toBe('زبانی یافت نشد');
  });

  it('supports explicit custom dataset overrides', () => {
    const el = {
      hasAttribute: (attr: string) => attr === 'data-searchable',
      id: 'custom-picker',
      dataset: {
        searchPlaceholder: 'Type to filter...',
        searchNoResults: 'Nothing found',
      },
    };
    const resolved = resolveCustomSelectLabels(el, mockT);
    expect(resolved.isModelSelect).toBe(false);
    expect(resolved.placeholder).toBe('Type to filter...');
    expect(resolved.noResults).toBe('Nothing found');
    expect(resolved.defaultPlaceholder).toBe('انتخاب...');
  });

  it('supports custom placeholderKey or placeholder attributes for default trigger value', () => {
    const elWithKey = {
      hasAttribute: () => false,
      dataset: { placeholderKey: 'common.select' },
    };
    expect(resolveCustomSelectLabels(elWithKey, mockT).defaultPlaceholder).toBe('انتخاب...');

    const elWithCustom = {
      hasAttribute: () => false,
      dataset: { placeholder: 'Custom Value' },
    };
    expect(resolveCustomSelectLabels(elWithCustom, mockT).defaultPlaceholder).toBe('Custom Value');
  });
});

describe('parseTranscriptTimeRange', () => {
  function parseTranscriptTimeRange(timeRange?: string | null) {
    if (!timeRange) return { raw: '', durLabel: '' };
    const match = timeRange.match(/\[?(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*(?:-->|→)\s*(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]?/);
    if (match) {
      const start = match[1];
      const end = match[2];
      const toSec = (str: string) => {
        const parts = str.split(':');
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
      };
      const diff = Math.max(0, Math.round(toSec(end) - toSec(start)));
      const durLabel = diff > 0 ? `${diff}s` : '';
      return {
        raw: `${start} → ${end}`,
        durLabel
      };
    }
    return {
      raw: timeRange.replace(/^\[|\]$/g, ''),
      durLabel: ''
    };
  }

  it('parses standard Whisper timestamp range with brackets and calculates duration', () => {
    const res = parseTranscriptTimeRange('[00:00:01.000 --> 00:00:04.500]');
    expect(res.raw).toBe('00:00:01.000 → 00:00:04.500');
    expect(res.durLabel).toBe('4s');
  });

  it('parses short timestamps without milliseconds', () => {
    const res = parseTranscriptTimeRange('[00:01:10 --> 00:01:25]');
    expect(res.raw).toBe('00:01:10 → 00:01:25');
    expect(res.durLabel).toBe('15s');
  });

  it('supports unicode arrow syntax without enclosing brackets', () => {
    const res = parseTranscriptTimeRange('00:00:10 → 00:00:12');
    expect(res.raw).toBe('00:00:10 → 00:00:12');
    expect(res.durLabel).toBe('2s');
  });

  it('suppresses duration badge when duration rounds to zero seconds', () => {
    const res = parseTranscriptTimeRange('[00:00:01.100 --> 00:00:01.400]');
    expect(res.raw).toBe('00:00:01.100 → 00:00:01.400');
    expect(res.durLabel).toBe('');
  });

  it('gracefully handles non-timestamp text and strips surrounding brackets', () => {
    expect(parseTranscriptTimeRange('[L12]')).toEqual({ raw: 'L12', durLabel: '' });
    expect(parseTranscriptTimeRange('Line 5')).toEqual({ raw: 'Line 5', durLabel: '' });
  });

  it('returns empty result for falsy or empty input', () => {
    expect(parseTranscriptTimeRange('')).toEqual({ raw: '', durLabel: '' });
    expect(parseTranscriptTimeRange(null)).toEqual({ raw: '', durLabel: '' });
    expect(parseTranscriptTimeRange(undefined)).toEqual({ raw: '', durLabel: '' });
  });
});

describe('formatFFmpegVersion', () => {
  function formatFFmpegVersion(versionStr?: string | null): string {
    if (!versionStr || versionStr === 'Unknown version' || versionStr === 'N/A') {
      return 'Ready';
    }
    const match = versionStr.match(/version\s+([^\s]+)/i);
    const raw = match ? match[1] : versionStr.trim();

    // 1. Standard semantic version (e.g., "7.1", "7.1.1", "n7.0", "v6.0-extra", "4.4.2-0ubuntu0")
    const semverMatch = raw.match(/^[nNvV]?(\d+(\.\d+)+)/);
    if (semverMatch) {
      return `v${semverMatch[1]}`;
    }

    // 2. Git daily snapshot builds with dates (e.g., "N-126826-gc0e8b139fd-20260924" or "2024-03-07-git...")
    const dateHyphenMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateHyphenMatch) {
      return `vGit-${dateHyphenMatch[1]}.${dateHyphenMatch[2]}`;
    }
    const dateCompactMatch = raw.match(/(\d{4})(\d{2})(\d{2})/);
    if (dateCompactMatch) {
      return `vGit-${dateCompactMatch[1]}.${dateCompactMatch[2]}`;
    }

    // 3. Git build number (e.g. "N-126826-g...")
    const buildNumMatch = raw.match(/^[nN]-(\d+)/);
    if (buildNumMatch) {
      return `vGit-${buildNumMatch[1]}`;
    }

    // 4. Fallback cleanup: strip leading 'n'/'v' and trailing tags
    let fallback = raw.split('-')[0].split('_')[0];
    fallback = fallback.replace(/^[nNvV]/, '');
    if (fallback && fallback.length > 0 && !isNaN(Number(fallback))) {
      return `v${fallback}`;
    }

    return 'Ready';
  }

  it('correctly extracts date from BtbN Git snapshot build', () => {
    const raw = 'ffmpeg version N-126826-gc0e8b139fd-20260924 Copyright (c) 2000-2026 the FFmpeg developers';
    expect(formatFFmpegVersion(raw)).toBe('vGit-2026.09');
  });

  it('correctly extracts date from Gyan Git build with hyphens', () => {
    const raw = 'ffmpeg version 2024-03-07-git-8287515db5-full_build-www.gyan.dev';
    expect(formatFFmpegVersion(raw)).toBe('vGit-2024.03');
  });

  it('correctly extracts standard semantic release versions', () => {
    expect(formatFFmpegVersion('ffmpeg version 7.1-static https://johnvansickle.com/ffmpeg/')).toBe('v7.1');
    expect(formatFFmpegVersion('ffmpeg version 7.1.1 Copyright (c) 2000-2025')).toBe('v7.1.1');
    expect(formatFFmpegVersion('ffmpeg version n7.0-4-g8e9124')).toBe('v7.0');
    expect(formatFFmpegVersion('ffmpeg version 4.4.2-0ubuntu0.22.04.1')).toBe('v4.4.2');
  });

  it('correctly formats Git build number when no date is present', () => {
    expect(formatFFmpegVersion('ffmpeg version N-112000-g12345')).toBe('vGit-112000');
  });

  it('falls back to Ready for missing or invalid version strings', () => {
    expect(formatFFmpegVersion('')).toBe('Ready');
    expect(formatFFmpegVersion(null)).toBe('Ready');
    expect(formatFFmpegVersion('Unknown version')).toBe('Ready');
    expect(formatFFmpegVersion('N/A')).toBe('Ready');
  });
});

describe('Monochrome Canvas Engine', () => {
  const MONOCHROME_META_COLORS = {
    'royal-blue': '#101114',
    'cyber-blue': '#101114',
    'carbon': '#121214',
    'fire-orange': '#121111',
    'fire': '#121111',
    'emerald': '#101211'
  };

  it('provides distinct, dedicated monochrome surfaces for each theme', () => {
    expect(MONOCHROME_META_COLORS['royal-blue']).toBe('#101114');
    expect(MONOCHROME_META_COLORS['carbon']).toBe('#121214');
    expect(MONOCHROME_META_COLORS['fire-orange']).toBe('#121111');
    expect(MONOCHROME_META_COLORS['emerald']).toBe('#101211');

    // Royal Blue and Fire Orange have distinct surface hues
    expect(MONOCHROME_META_COLORS['royal-blue']).not.toBe(MONOCHROME_META_COLORS['fire-orange']);
    // Royal Blue and Emerald have distinct surface hues
    expect(MONOCHROME_META_COLORS['royal-blue']).not.toBe(MONOCHROME_META_COLORS['emerald']);
  });

  it('updates DOM attributes and localStorage correctly when toggling', () => {
    const store: Record<string, string> = {};
    const mockLocalStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; }
    };
    const mockRoot = new MockElement('HTML');

    function applyCanvas(isMono: boolean) {
      if (isMono) {
        mockRoot.setAttribute('data-canvas', 'monochrome');
      } else {
        (mockRoot as any).attributes.delete('data-canvas');
      }
      mockLocalStorage.setItem('whisper_monochrome_canvas', isMono ? 'true' : 'false');
    }

    applyCanvas(true);
    expect(mockRoot.getAttribute('data-canvas')).toBe('monochrome');
    expect(mockLocalStorage.getItem('whisper_monochrome_canvas')).toBe('true');

    applyCanvas(false);
    expect(mockRoot.getAttribute('data-canvas')).toBeNull();
    expect(mockLocalStorage.getItem('whisper_monochrome_canvas')).toBe('false');
  });
});

describe('Model Hub Card Size Display', () => {
  it('correctly uses installedSize for Downloaded models and expectedSize for non-downloaded models', () => {
    const formatSizeText = (m: { status: string }, sizeMB: string, t: (k: string, p?: any) => string) => {
      return m.status === 'Downloaded'
        ? (t('models.installedSize', { size: sizeMB }) || `${sizeMB} MB`)
        : t('models.expectedSize', { size: sizeMB });
    };

    const mockT = (key: string, params?: { size: string }) => {
      if (key === 'models.installedSize') return `Size: ${params?.size} MB`;
      if (key === 'models.expectedSize') return `Expected Size: ${params?.size} MB`;
      return '';
    };

    const installedModel = { status: 'Downloaded' };
    const pendingModel = { status: 'Pending' };

    expect(formatSizeText(installedModel, '42', mockT)).toBe('Size: 42 MB');
    expect(formatSizeText(pendingModel, '42', mockT)).toBe('Expected Size: 42 MB');
  });
});

describe('Model Dropdown Population and Fallback Sync', () => {
  it('clears settingsState.modelPath when no valid models are installed', () => {
    const settingsState = { modelPath: '/models/ggml-base.bin' };
    const validModels: string[] = [];

    const syncModels = (models: string[], state: { modelPath: string }) => {
      let modelMatched = false;
      if (models.length === 0) {
        if (state.modelPath) {
          state.modelPath = '';
        }
      } else {
        modelMatched = models.includes(state.modelPath);
        if (!modelMatched) {
          state.modelPath = models[0];
        }
      }
      return modelMatched;
    };

    const matched = syncModels(validModels, settingsState);
    expect(matched).toBe(false);
    expect(settingsState.modelPath).toBe('');
  });

  it('auto-selects first available model when currently selected model is deleted', () => {
    const settingsState = { modelPath: '/models/ggml-medium.bin' };
    const validModels = ['/models/ggml-base.bin', '/models/ggml-small.bin'];

    const syncModels = (models: string[], state: { modelPath: string }) => {
      let modelMatched = false;
      if (models.length === 0) {
        if (state.modelPath) state.modelPath = '';
      } else {
        modelMatched = models.includes(state.modelPath);
        if (!modelMatched) {
          state.modelPath = models[0];
        }
      }
      return modelMatched;
    };

    const matched = syncModels(validModels, settingsState);
    expect(matched).toBe(false);
    expect(settingsState.modelPath).toBe('/models/ggml-base.bin');
  });
});

describe('Model Download Progress and Zero-Byte State Formatting', () => {
  const formatModelDownloadProgress = (
    downloadedBytes: number,
    totalBytes: number,
    progressPct: number,
    mockT: (key: string, params?: any) => string,
    formatNum: (n: number | string) => string = (n) => String(n)
  ) => {
    const dlBytes = Math.max(0, Math.floor(Number(downloadedBytes) || 0));
    const total = Math.max(0, Math.floor(Number(totalBytes) || 0));
    const isSubMegabyte = (total > 0 && total < 1048576) || (total === 0 && dlBytes < 1048576);

    let sizeNum: number;
    let unitText: string;

    if (isSubMegabyte || dlBytes < 1048576) {
      sizeNum = dlBytes === 0 ? 0 : Math.max(1, Math.round(dlBytes / 1024));
      unitText = mockT('models.unitKB') || 'KB';
    } else {
      sizeNum = Math.round(dlBytes / 1048576);
      unitText = mockT('models.unitMB') || 'MB';
    }

    const sizeFormatted = formatNum(sizeNum);
    const pctFormatted = total > 0 ? formatNum(Math.min(100, Math.round(progressPct || 0))) : '...';

    const liveTemplate = mockT('models.downloadLiveProgress', {
      size: sizeFormatted,
      unit: unitText,
      pct: pctFormatted,
      speedLabel: '',
      speed: ''
    });
    const parts = liveTemplate.split('•');
    let result = parts.length >= 1 ? parts[0].trim() : `${sizeFormatted} ${unitText} (${pctFormatted}%)`;
    if (total <= 0) {
      result = result.replace(/%\s*(\.|\u2026)+|(\.|\u2026)+\s*[%٪]/g, '...');
    }
    return result;
  };

  const getLiveDownloadStatus = (
    payload: { phase: string; downloadedBytes: number; totalBytes: number; progress: number; speedBps: number },
    smoothedEtaSeconds: number | null,
    mockT: (key: string, params?: any) => string,
    formatNum: (n: number | string) => string = (n) => String(n)
  ) => {
    const dlBytes = Math.max(0, payload.downloadedBytes || 0);
    const isConnecting = payload.phase === 'starting' || payload.speedBps <= 0;
    const pct = Math.min(100, Math.round((payload.progress || 0) * 100));

    if (dlBytes <= 0) {
      return payload.phase === 'starting' ? mockT('models.statusStarting') : mockT('models.statusConnecting');
    }

    const prefix = formatModelDownloadProgress(dlBytes, payload.totalBytes, pct, mockT, formatNum);
    if (isConnecting) {
      return `${prefix} • ${mockT('models.statusConnecting')}`;
    } else if (smoothedEtaSeconds && smoothedEtaSeconds > 0) {
      return `${prefix} • ${mockT('models.etaLabel', { time: `${smoothedEtaSeconds}s` })}`;
    } else {
      const inProgressSuffix = (mockT('models.statusInProgress', { size: '', pct: '' }).split('•')[1] || mockT('models.statusConnecting')).trim();
      return `${prefix} • ${inProgressSuffix}`;
    }
  };

  const mockEnT = (key: string, params?: any) => {
    switch (key) {
      case 'models.unitMB': return 'MB';
      case 'models.unitKB': return 'KB';
      case 'models.statusStarting': return 'Starting...';
      case 'models.statusConnecting': return 'Connecting...';
      case 'models.badgePaused': return 'Paused';
      case 'models.etaLabel': return `ETA: ${params?.time}`;
      case 'models.statusInProgress': return '{size} MB ({pct}%) • In progress';
      case 'models.statusPaused': return '{size} MB ({pct}%) • Paused';
      case 'models.downloadLiveProgress': return `${params?.size} ${params?.unit} (${params?.pct}%) • : `;
      default: return '';
    }
  };

  const mockFaT = (key: string, params?: any) => {
    switch (key) {
      case 'models.unitMB': return 'مگابایت';
      case 'models.unitKB': return 'کیلوبایت';
      case 'models.statusStarting': return 'در حال شروع...';
      case 'models.statusConnecting': return 'در حال اتصال...';
      case 'models.badgePaused': return 'متوقف‌شده';
      case 'models.etaLabel': return `زمان باقی‌مانده: ${params?.time}`;
      case 'models.statusInProgress': return '{size} مگابایت ({pct}٪) • در حال دانلود';
      case 'models.statusPaused': return '{size} مگابایت ({pct}٪) • متوقف‌شده';
      case 'models.downloadLiveProgress': return `${params?.size} ${params?.unit} (${params?.pct}٪) • : `;
      default: return '';
    }
  };

  it('shows clean Starting... / Connecting... without awkward "0 MB" when downloadedBytes is 0', () => {
    const startingPayload = {
      phase: 'starting',
      downloadedBytes: 0,
      totalBytes: 885098,
      progress: 0,
      speedBps: 0
    };
    expect(getLiveDownloadStatus(startingPayload, null, mockEnT)).toBe('Starting...');
    expect(getLiveDownloadStatus(startingPayload, null, mockFaT)).toBe('در حال شروع...');

    const connectingPayload = {
      phase: 'downloading',
      downloadedBytes: 0,
      totalBytes: 885098,
      progress: 0,
      speedBps: 0
    };
    expect(getLiveDownloadStatus(connectingPayload, null, mockEnT)).toBe('Connecting...');
    expect(getLiveDownloadStatus(connectingPayload, null, mockFaT)).toBe('در حال اتصال...');
  });

  it('formats Silero VAD (sub-megabyte) progress in KB instead of 0 MB throughout the download', () => {
    const sileroTotalBytes = 885098; // ~864 KB

    // ~146 KB (17%)
    const p1 = formatModelDownloadProgress(150000, sileroTotalBytes, 17, mockEnT);
    expect(p1).toBe('146 KB (17%)');

    // ~488 KB (55%)
    const p2 = formatModelDownloadProgress(500000, sileroTotalBytes, 55, mockEnT);
    expect(p2).toBe('488 KB (55%)');

    // Finished ~864 KB (100%)
    const p3 = formatModelDownloadProgress(sileroTotalBytes, sileroTotalBytes, 100, mockEnT);
    expect(p3).toBe('864 KB (100%)');

    // Exactly 0 bytes formatted without fake 1 KB
    const pZero = formatModelDownloadProgress(0, sileroTotalBytes, 0, mockEnT);
    expect(pZero).toBe('0 KB (0%)');

    // Unknown total size (streaming without Content-Length)
    const pUnknown = formatModelDownloadProgress(500000, 0, 0, mockEnT);
    expect(pUnknown).toBe('488 KB (...)');

    // In Persian with Persian digits
    const toFaDigits = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
    const pFa = formatModelDownloadProgress(500000, sileroTotalBytes, 55, mockFaT, toFaDigits);
    expect(pFa).toBe('۴۸۸ کیلوبایت (۵۵٪)');

    const pFaUnknown = formatModelDownloadProgress(500000, 0, 0, mockFaT, toFaDigits);
    expect(pFaUnknown).toBe('۴۸۸ کیلوبایت (...)');

    // In Turkish with leading percent symbol (%55 vs indeterminate ...)
    const mockTrT = (key: string, params?: any) => {
      switch (key) {
        case 'models.unitMB': return 'MB';
        case 'models.unitKB': return 'KB';
        case 'models.downloadLiveProgress': return `${params?.size} ${params?.unit} (%${params?.pct}) • : `;
        default: return '';
      }
    };
    const pTr = formatModelDownloadProgress(500000, sileroTotalBytes, 55, mockTrT);
    expect(pTr).toBe('488 KB (%55)');

    const pTrUnknown = formatModelDownloadProgress(500000, 0, 0, mockTrT);
    expect(pTrUnknown).toBe('488 KB (...)');
  });

  it('formats large Whisper models in KB for initial chunk (< 1 MB) and MB thereafter', () => {
    const whisperBaseTotal = 147951465; // ~141 MB

    // First chunk: 400 KB transferred (< 1 MB) -> formats cleanly in KB
    const initialChunk = formatModelDownloadProgress(409600, whisperBaseTotal, 0, mockEnT);
    expect(initialChunk).toBe('400 KB (0%)');

    // Substantial transfer: 20 MB transferred
    const midTransfer = formatModelDownloadProgress(20971520, whisperBaseTotal, 14, mockEnT);
    expect(midTransfer).toBe('20 MB (14%)');
  });

  it('renders live status with smooth ETA and proper localized labels once data transfers', () => {
    const sileroTotalBytes = 885098;
    const activePayload = {
      phase: 'downloading',
      downloadedBytes: 450000,
      totalBytes: sileroTotalBytes,
      progress: 0.51,
      speedBps: 200000
    };

    const statusEn = getLiveDownloadStatus(activePayload, 2, mockEnT);
    expect(statusEn).toBe('439 KB (51%) • ETA: 2s');

    const toFaDigits = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
    const statusFa = getLiveDownloadStatus(activePayload, 2, mockFaT, toFaDigits);
    expect(statusFa).toBe('۴۳۹ کیلوبایت (۵۱٪) • زمان باقی‌مانده: 2s');
  });

  it('preserves downloaded progress and updates status to Connecting when resuming a paused card', () => {
    const getResumeDownloadStatus = (currentText: string, mockT: (key: string) => string) => {
      if (!currentText.trim()) return mockT('models.statusStarting');
      if (currentText.includes('•')) {
        const parts = currentText.split('•');
        return `${parts[0].trim()} • ${mockT('models.statusConnecting')}`;
      }
      return mockT('models.statusStarting');
    };

    // Starting from scratch with no prior progress
    expect(getResumeDownloadStatus('', mockEnT)).toBe('Starting...');
    expect(getResumeDownloadStatus('', mockFaT)).toBe('در حال شروع...');

    // Resuming paused Silero VAD transfer
    expect(getResumeDownloadStatus('439 KB (51%) • Paused', mockEnT)).toBe('439 KB (51%) • Connecting...');
    expect(getResumeDownloadStatus('۴۳۹ کیلوبایت (۵۱٪) • متوقف‌شده', mockFaT)).toBe('۴۳۹ کیلوبایت (۵۱٪) • در حال اتصال...');
  });
});



