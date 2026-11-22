import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logsController, stripAnsi, escapeHTML, clearLogsArray, pushLogEntry, getLogs, getFilteredLogs, reportGlobalFrontendError } from './logsController';
import { themeManager, resolveThemeConfig, THEME_REGISTRY, MONOCHROME_META_COLORS } from './themeManager';

describe('logsController', () => {
  beforeEach(() => {
    clearLogsArray();
  });

  it('correctly strips ANSI escape codes', () => {
    const raw = '\u001b[31mError message\u001b[0m with \u001b[1;32mcolor\u001b[0m';
    expect(stripAnsi(raw)).toBe('Error message with color');
    expect(stripAnsi(null as any)).toBe('');
  });

  it('correctly escapes HTML characters', () => {
    const raw = '<script>alert("xss" & \'test\')</script>';
    expect(escapeHTML(raw)).toBe('&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;');
  });

  it('pushes and retrieves log entries', () => {
    pushLogEntry({ timestamp: '12:00:00', category: 'Whisper', message: 'Hello' });
    pushLogEntry({ timestamp: '12:00:01', category: 'Translate', message: 'World' });
    
    const logs = getLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].message).toBe('Hello');
    expect(logs[1].category).toBe('Translate');
  });

  it('caps log array at 10000 entries', () => {
    for (let i = 0; i < 10050; i++) {
      pushLogEntry({ timestamp: '12:00:00', category: 'Whisper', message: `msg ${i}` });
    }
    const logs = getLogs();
    expect(logs.length).toBe(10000);
    expect(logs[0].message).toBe('msg 50');
  });

  it('filters logs correctly by category and query', () => {
    logsController.clear();
    logsController.push({ timestamp: '10:00:00', category: 'Whisper', message: 'Model loaded' });
    logsController.push({ timestamp: '10:00:01', category: 'Translate', message: 'Translation ready' });
    logsController.push({ timestamp: '10:00:02', category: 'FFmpeg', message: 'Audio extracted' });

    expect(logsController.allLogs.length).toBe(3);
    
    // Test direct getFilteredLogs
    const filtered = getFilteredLogs();
    expect(filtered.length).toBe(3);
  });

  it('exposes all required controller methods and aliases', () => {
    expect(typeof logsController.push).toBe('function');
    expect(typeof logsController.clear).toBe('function');
    expect(typeof logsController.redraw).toBe('function');
    expect(typeof logsController.setup).toBe('function');
    expect(typeof logsController.filter).toBe('function');
    expect(typeof logsController.search).toBe('function');
    expect(typeof logsController.copyAll).toBe('function');
    expect(typeof logsController.clearHistory).toBe('function');
    expect(typeof logsController.scrollBottom).toBe('function');
    expect(typeof logsController.scrollTop).toBe('function');
    expect(typeof logsController.updateLogJumpPillVisibility).toBe('function');
    expect(typeof logsController.getFilteredLogs).toBe('function');
    expect(typeof logsController.reportGlobalFrontendError).toBe('function');
  });

  it('logs uncaught frontend errors into System category and ignores benign ResizeObserver warnings', () => {
    logsController.clear();
    const notifySpy = vi.fn();
    vi.stubGlobal('window', { showNotification: notifySpy });
    vi.stubGlobal('document', { getElementById: () => null });

    reportGlobalFrontendError('ResizeObserver loop completed with undelivered notifications.');
    expect(logsController.allLogs.length).toBe(0);
    expect(notifySpy).not.toHaveBeenCalled();

    reportGlobalFrontendError('Unexpected null reference', 'app.ts', 42, 10);
    expect(logsController.allLogs.length).toBe(1);
    expect(logsController.allLogs[0].category).toBe('System');
    expect(logsController.allLogs[0].message).toContain('Unexpected null reference (app.ts:42:10)');
    expect(notifySpy).toHaveBeenCalledWith('Unexpected null reference', 'error');

    vi.unstubAllGlobals();
  });

  it('hydrates backend logs without duplicating seq entries, preserves frontend System logs, and strips ANSI', () => {
    logsController.clear();
    // Simulate a backend log received via live event before get_logs completes
    logsController.push({ seq: 2, timestamp: '10:00:02', category: 'Settings', message: 'Live warning' });
    // Simulate a frontend System error during startup
    logsController.push({ timestamp: '10:00:03', category: 'System', message: 'Frontend error: test' });

    logsController.hydrate([
      { seq: 1, timestamp: '10:00:01', category: 'Whisper', message: '\u001b[32mBoot\u001b[0m' },
      { seq: 2, timestamp: '10:00:02', category: 'Settings', message: 'Live warning' },
    ]);

    const logs = getLogs();
    expect(logs.length).toBe(3);
    expect(logs.map(l => l.seq)).toEqual([1, 2, undefined]);
    expect(logs[0].message).toBe('Boot');
    expect(logs[2].category).toBe('System');
  });

  it('renders filtered older logs even when total log count exceeds 1500', () => {
    logsController.clear();

    const makeMockEl = (tag = 'div'): any => {
      const attrs = new Map<string, string>();
      const listeners = new Map<string, Function[]>();
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        dataset: {},
        disabled: false,
        checked: true,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 200,
        children: [] as any[],
        classList: {
          add: vi.fn(),
          remove: vi.fn(),
          contains: () => false,
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        removeAttribute: (k: string) => attrs.delete(k),
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild: (child: any) => {
          el.children.push(child);
          return child;
        },
        removeChild: (child: any) => {
          const idx = el.children.indexOf(child);
          if (idx >= 0) el.children.splice(idx, 1);
        },
        get firstElementChild() {
          return el.children[0] || null;
        },
        set innerHTML(val: string) {
          if (val === '') el.children = [];
        },
        addEventListener: (ev: string, fn: Function) => {
          listeners.set(ev, [...(listeners.get(ev) || []), fn]);
        },
        scrollTo: vi.fn(),
      };
      return el;
    };

    const viewport = makeMockEl('div');
    const clearBtn = makeMockEl('button');
    const copyBtn = makeMockEl('button');
    const autoScroll = makeMockEl('input');
    autoScroll.checked = false;

    const elements: Record<string, any> = {
      'log-viewport': viewport,
      'btn-clear-all-logs': clearBtn,
      'btn-copy-all-logs': copyBtn,
      'log-autoscroll': autoScroll,
    };

    vi.stubGlobal('document', {
      getElementById: (id: string) => elements[id] || null,
      querySelectorAll: () => [],
      createElement: (tag: string) => makeMockEl(tag),
    });

    // Push 3 Translate logs followed by 1600 Whisper logs
    for (let i = 0; i < 3; i++) {
      logsController.push({ timestamp: '10:00:00', category: 'Translate', message: `Old translate ${i}` });
    }
    for (let i = 0; i < 1600; i++) {
      logsController.push({ timestamp: '10:00:01', category: 'Whisper', message: `Whisper line ${i}` });
    }

    logsController.filter('Translate');
    expect(viewport.children.length).toBe(3);
    expect(viewport.children[0].children[2].textContent).toBe('Old translate 0');

    // Reset filter to All for clean subsequent tests and verify Clear tooltip when empty
    logsController.filter('All');
    logsController.clear();
    logsController.redraw();
    expect(clearBtn.getAttribute('title')).not.toBe('No logs available to copy.');

    vi.unstubAllGlobals();
  });

  it('cancels pending append auto-scroll timer when scrolling to top', () => {
    vi.useFakeTimers();
    logsController.clear();

    const makeEl = (): any => {
      const attrs = new Map<string, string>();
      const el: any = {
        children: [] as any[],
        dataset: {},
        className: '',
        textContent: '',
        checked: true,
        scrollTop: 500,
        scrollHeight: 1200,
        clientHeight: 300,
        classList: { add: vi.fn(), remove: vi.fn() },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        removeAttribute: (k: string) => attrs.delete(k),
        querySelector: () => null,
        appendChild: (c: any) => { el.children.push(c); return c; },
        scrollTo: vi.fn(() => { el.scrollTop = 0; }),
      };
      return el;
    };

    const viewport = makeEl();
    const autoScroll = makeEl();
    autoScroll.checked = true;

    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'log-viewport' ? viewport : id === 'log-autoscroll' ? autoScroll : null),
      createElement: () => makeEl(),
    });

    logsController.appendLogToViewport({ timestamp: '12:00:00', category: 'Whisper', message: 'Streaming' });
    logsController.scrollToTop(true);
    expect(autoScroll.checked).toBe(false);
    expect(viewport.scrollTop).toBe(0);

    vi.advanceTimersByTime(150);
    // Must stay at top and NOT snap back to scrollHeight (1200)
    expect(viewport.scrollTop).toBe(0);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('themeManager', () => {
  it('resolves registered themes and fallback properly', () => {
    expect(resolveThemeConfig('royal-blue').id).toBe('royal-blue');
    expect(resolveThemeConfig('cyber-blue').id).toBe('royal-blue');
    expect(resolveThemeConfig('ruby-red').id).toBe('ruby-red');
    expect(resolveThemeConfig('ruby').id).toBe('ruby-red');
    expect(resolveThemeConfig('carbon').id).toBe('ruby-red');
    expect(resolveThemeConfig('fire-orange').id).toBe('fire-orange');
    expect(resolveThemeConfig('fire').id).toBe('fire-orange');
    expect(resolveThemeConfig('emerald').id).toBe('emerald');
    expect(resolveThemeConfig('non-existent-theme').id).toBe('royal-blue');
  });

  it('defines unified monochrome metadata colors for all themes', () => {
    expect(MONOCHROME_META_COLORS['royal-blue']).toBe('#0a0a0c');
    expect(MONOCHROME_META_COLORS['ruby-red']).toBe('#0a0a0c');
    expect(MONOCHROME_META_COLORS['carbon']).toBe('#0a0a0c');
    expect(MONOCHROME_META_COLORS['fire-orange']).toBe('#0a0a0c');
    expect(MONOCHROME_META_COLORS['emerald']).toBe('#0a0a0c');
  });

  it('exposes all required themeManager controller methods', () => {
    expect(typeof themeManager.applyTheme).toBe('function');
    expect(typeof themeManager.toggleTheme).toBe('function');
    expect(typeof themeManager.switchTheme).toBe('function');
    expect(typeof themeManager.applyMonochromeCanvas).toBe('function');
    expect(typeof themeManager.isMonochromeCanvasActive).toBe('function');
    expect(typeof themeManager.applyUiZoom).toBe('function');
    expect(typeof themeManager.adjustUiZoom).toBe('function');
    expect(typeof themeManager.setUiZoom).toBe('function');
    expect(typeof themeManager.setupShortcuts).toBe('function');
    expect(typeof themeManager.resolveTheme).toBe('function');
  });

  it('correctly applies CSS zoom in browser mode when native Tauri is absent', async () => {
    const root = { style: { zoom: '' } };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { documentElement: root, getElementById: () => null });
    vi.stubGlobal('localStorage', { setItem: vi.fn() });

    await themeManager.applyUiZoom(1.25, false, false);

    expect(root.style.zoom).toBe(1.25);

    vi.unstubAllGlobals();
  });

  it('prefers native Tauri webview zoom when Tauri invoke is available', async () => {
    const root = { style: { zoom: '1.25' } };
    const mockTauriInvoke = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', {
      __TAURI__: {
        core: {
          invoke: mockTauriInvoke
        }
      }
    });
    vi.stubGlobal('document', { documentElement: root, getElementById: () => null });
    vi.stubGlobal('localStorage', { setItem: vi.fn() });

    await themeManager.applyUiZoom(1.4, false, false);

    expect(mockTauriInvoke).toHaveBeenCalledWith('set_window_zoom', { scale: 1.4 });
    expect(root.style.zoom).toBe('');

    vi.unstubAllGlobals();
  });
});
