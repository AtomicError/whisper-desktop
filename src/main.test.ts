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

    return {
      isModelSelect,
      placeholder: getSearchPlaceholder(),
      noResults: getNoResultsText(),
    };
  }

  const mockT = (key: string) => {
    const dict: Record<string, string> = {
      'settings.searchModelsPlaceholder': 'جستجوی مدل‌ها با شناسه...',
      'settings.noMatchingModels': 'هیچ مدل منطبقی یافت نشد',
      'common.searchLanguage': 'جستجوی زبان...',
      'languages.noResults': 'زبانی یافت نشد',
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

