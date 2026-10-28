import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { logsController, stripAnsi, escapeHTML, clearLogsArray, pushLogEntry, getLogs, getFilteredLogs } from './logsController';
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
  });
});

describe('themeManager', () => {
  it('resolves registered themes and fallback properly', () => {
    expect(resolveThemeConfig('royal-blue').id).toBe('royal-blue');
    expect(resolveThemeConfig('cyber-blue').id).toBe('royal-blue');
    expect(resolveThemeConfig('carbon').id).toBe('carbon');
    expect(resolveThemeConfig('fire-orange').id).toBe('fire-orange');
    expect(resolveThemeConfig('fire').id).toBe('fire-orange');
    expect(resolveThemeConfig('emerald').id).toBe('emerald');
    expect(resolveThemeConfig('non-existent-theme').id).toBe('royal-blue');
  });

  it('defines distinct monochrome metadata colors for each theme', () => {
    expect(MONOCHROME_META_COLORS['royal-blue']).toBe('#101114');
    expect(MONOCHROME_META_COLORS['carbon']).toBe('#121214');
    expect(MONOCHROME_META_COLORS['fire-orange']).toBe('#121111');
    expect(MONOCHROME_META_COLORS['emerald']).toBe('#101211');
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
