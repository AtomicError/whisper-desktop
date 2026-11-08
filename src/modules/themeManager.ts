// Multi-Theme & UI Scaling Engine for Whisper Desktop
import { t } from '../i18n/index';

export interface ThemeConfig {
  id: string;
  label: string;
  dataTheme?: string;
  metaColor: string;
  toastName: string;
  iconSvg?: string;
}

export const THEME_REGISTRY: Record<string, ThemeConfig> = {
  'royal-blue': {
    id: 'royal-blue',
    label: 'Royal Blue',
    dataTheme: 'royal-blue',
    metaColor: '#070913',
    toastName: 'Royal Blue (Default)',
    iconSvg: `
      <svg class="theme-btn-icon icon-royal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
        <path d="M5 21h14"/>
      </svg>
    `
  },
  'carbon': {
    id: 'carbon',
    label: 'Carbon',
    dataTheme: 'carbon',
    metaColor: '#121214',
    toastName: 'Carbon',
    iconSvg: `
      <svg class="theme-btn-icon icon-carbon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 22 12 12 22 2 12 12 2"/>
      </svg>
    `
  },
  'fire-orange': {
    id: 'fire-orange',
    label: 'Fiery Orange',
    dataTheme: 'fire-orange',
    metaColor: '#0c0a09',
    toastName: 'Fiery Orange (Fire)',
    iconSvg: `
      <svg class="theme-btn-icon icon-fire" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
      </svg>
    `
  },
  'emerald': {
    id: 'emerald',
    label: 'Emerald',
    dataTheme: 'emerald',
    metaColor: '#060e0a',
    toastName: 'Emerald',
    iconSvg: `
      <svg class="theme-btn-icon icon-emerald" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 3h12l4 6-10 13L2 9Z"/>
        <path d="M11 3 8 9l4 13 4-13-3-6"/>
        <path d="M2 9h20"/>
      </svg>
    `
  }
};

export const MONOCHROME_META_COLORS: Record<string, string> = {
  'royal-blue': '#101114',
  'cyber-blue': '#101114',
  'carbon': '#121214',
  'fire-orange': '#121111',
  'fire': '#121111',
  'emerald': '#101211'
};

let currentUiZoom = 1.0;
let zoomSaveTimeout: any = null;

export function resolveThemeConfig(themeName: string): ThemeConfig {
  if (themeName === 'carbon') {
    return THEME_REGISTRY['carbon'];
  }
  if (themeName === 'fire' || themeName === 'fire-orange') {
    return THEME_REGISTRY['fire-orange'];
  }
  if (themeName === 'emerald') {
    return THEME_REGISTRY['emerald'];
  }
  if (themeName === 'cyber-blue' || themeName === 'royal-blue') {
    return THEME_REGISTRY['royal-blue'];
  }
  return THEME_REGISTRY[themeName] || THEME_REGISTRY['royal-blue'];
}

export function isMonochromeCanvasActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-canvas') === 'monochrome';
}

export function applyMonochromeCanvas(isMonochrome: boolean, persist = true): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (isMonochrome) {
    root.setAttribute('data-canvas', 'monochrome');
  } else {
    root.removeAttribute('data-canvas');
  }

  if (persist) {
    try {
      localStorage.setItem('whisper_monochrome_canvas', isMonochrome ? 'true' : 'false');
    } catch (_) {}
  }

  const monoCheck = document.getElementById('opt-monochromeCanvas') as HTMLInputElement | null;
  if (monoCheck && monoCheck.checked !== !!isMonochrome) {
    monoCheck.checked = !!isMonochrome;
  }

  const currentThemeId = ((window as any).settingsState && (window as any).settingsState.theme)
    ? (window as any).settingsState.theme
    : (localStorage.getItem('whisper_theme_cache') || 'royal-blue');
  const config = resolveThemeConfig(currentThemeId);

  if (isMonochrome) {
    const monoBg = MONOCHROME_META_COLORS[config.id] || '#101114';
    root.style.setProperty('--bg-space', monoBg);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', monoBg);
  } else {
    if (config.id === 'royal-blue') {
      root.style.removeProperty('--bg-space');
    } else if (config.metaColor) {
      root.style.setProperty('--bg-space', config.metaColor);
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme && config.metaColor) {
      metaTheme.setAttribute('content', config.metaColor);
    }
  }
}

export function applyTheme(themeName: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const config = resolveThemeConfig(themeName);
  const isMonochrome = isMonochromeCanvasActive();

  if (config.id === 'royal-blue') {
    root.removeAttribute('data-theme');
    if (isMonochrome) {
      root.style.setProperty('--bg-space', MONOCHROME_META_COLORS['royal-blue'] || '#101114');
    } else {
      root.style.removeProperty('--bg-space');
    }
  } else {
    root.setAttribute('data-theme', config.dataTheme || config.id);
    if (isMonochrome) {
      root.style.setProperty('--bg-space', MONOCHROME_META_COLORS[config.id] || '#101114');
    } else if (config.metaColor) {
      root.style.setProperty('--bg-space', config.metaColor);
    }
  }

  try {
    localStorage.setItem('whisper_theme_cache', config.id);
  } catch (_) {}

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    const effectiveColor = isMonochrome
      ? (MONOCHROME_META_COLORS[config.id] || '#101114')
      : config.metaColor;
    if (effectiveColor) {
      metaTheme.setAttribute('content', effectiveColor);
    }
  }

  const activeThemeId = config.id;
  const themeCardMap: Record<string, string> = {
    'royal-blue': 'theme-card-royal',
    'carbon': 'theme-card-carbon',
    'fire-orange': 'theme-card-fire',
    'fire': 'theme-card-fire',
    'emerald': 'theme-card-emerald'
  };
  const activeCardId = themeCardMap[activeThemeId] || 'theme-card-royal';

  document.querySelectorAll('.theme-picker-card').forEach(card => {
    const isActive = (card.id === activeCardId);
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  if ((window as any).syncCustomSelects) {
    (window as any).syncCustomSelects();
  }
}

export function toggleTheme(): void {
  const currentThemeAttr = document.documentElement.getAttribute('data-theme') || 'royal-blue';
  let nextTheme = 'carbon';
  if (currentThemeAttr === 'carbon') {
    nextTheme = 'fire-orange';
  } else if (currentThemeAttr === 'fire-orange' || currentThemeAttr === 'fire') {
    nextTheme = 'emerald';
  } else if (currentThemeAttr === 'emerald') {
    nextTheme = 'royal-blue';
  } else {
    nextTheme = 'carbon';
  }
  switchTheme(nextTheme);
}

export function handleThemeSegmentClick(targetTheme: string): void {
  switchTheme(targetTheme);
}

export function switchTheme(themeName: string, animated = true): void {
  const config = resolveThemeConfig(themeName);

  if ((window as any).settingsState) {
    (window as any).settingsState.theme = config.id;
    if (typeof (window as any).saveCurrentSettings === 'function') {
      (window as any).saveCurrentSettings();
    }
  }

  const shouldAnimate = animated &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (shouldAnimate) {
    const root = document.documentElement;
    root.classList.add('theme-transitioning');
    applyTheme(config.id);
    setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 280);
  } else {
    applyTheme(config.id);
  }

  const themeKey = (config.id === 'royal-blue') ? 'royal' : (config.id === 'fire-orange' || config.id === 'fire') ? 'fire' : config.id;
  const localizedThemeName = (typeof t === 'function' && t(`theme.${themeKey}`) !== `theme.${themeKey}`)
    ? t(`theme.${themeKey}`)
    : (config.toastName || config.label);
  
  const showNotification = (window as any).showNotification;
  if (showNotification) {
    showNotification(t('toasts.themeSwitched', { theme: localizedThemeName }), 'info');
  }
}

const getNativeTauriInvoke = (): any => {
  const tauri = typeof window !== 'undefined' ? (window as any).__TAURI__ : null;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return null;
};

export async function applyUiZoom(scale: number | string, persist = true, showToast = false): Promise<void> {
  let numScale = typeof scale === 'number' ? scale : parseFloat(scale);
  if (isNaN(numScale) || numScale <= 0) {
    numScale = 1.0;
  }
  numScale = Math.round(Math.min(Math.max(numScale, 0.70), 1.60) * 100) / 100;
  currentUiZoom = numScale;

  let nativeZoomSuccess = false;
  const invoke = getNativeTauriInvoke();
  const isSplashBootHydration =
    !persist &&
    !showToast &&
    typeof document !== 'undefined' &&
    Boolean(document.getElementById('splash-curtain')) &&
    !document.documentElement?.classList?.contains('app-ready');

  if (invoke && isSplashBootHydration) {
    // Native WebKit zoom was already applied synchronously by Tauri's Rust .setup() hook at window creation.
    nativeZoomSuccess = true;
    if (typeof document !== 'undefined') {
      if (document.documentElement) document.documentElement.style.zoom = '';
      if (document.body) document.body.style.zoom = '';
    }
  } else if (invoke) {
    try {
      await invoke('set_window_zoom', { scale: numScale });
      nativeZoomSuccess = true;
      if (typeof document !== 'undefined') {
        if (document.documentElement) document.documentElement.style.zoom = '';
        if (document.body) document.body.style.zoom = '';
      }
    } catch (err) {
      console.warn('[Zoom] Native set_window_zoom failed, falling back to CSS zoom:', err);
    }
  }

  if (!nativeZoomSuccess && typeof document !== 'undefined') {
    if (document.documentElement) document.documentElement.style.zoom = numScale as any;
    if (document.body) document.body.style.zoom = '';
  }

  try {
    localStorage.setItem('whisper_ui_scale_cache', numScale.toString());
  } catch (_) {}

  const badge = document.getElementById('ui-scale-badge');
  if (badge) {
    badge.textContent = `${Math.round(numScale * 100)}%`;
  }

  const selectEl = document.getElementById('opt-uiScale') as HTMLSelectElement | null;
  if (selectEl) {
    const match = Array.from(selectEl.options).find(opt => Math.abs(parseFloat(opt.value) - numScale) < 0.01);
    if (match) {
      selectEl.value = match.value;
    } else {
      selectEl.value = numScale.toString();
    }
    if ((window as any).syncCustomSelects) {
      (window as any).syncCustomSelects();
    }
  }

  const showNotification = (window as any).showNotification;
  if (showToast && typeof showNotification === 'function') {
    showNotification(t('toasts.uiScaleToast', { scale: Math.round(numScale * 100) }), "info");
  }

  if (persist && (window as any).settingsState) {
    (window as any).settingsState.uiScale = numScale;
    if (zoomSaveTimeout) {
      clearTimeout(zoomSaveTimeout);
    }
    zoomSaveTimeout = setTimeout(() => {
      if (typeof (window as any).saveCurrentSettings === 'function') {
        (window as any).saveCurrentSettings();
      }
    }, 400);
  }
}

export function adjustUiZoom(delta: number): void {
  const newScale = Math.round((currentUiZoom + delta) * 100) / 100;
  applyUiZoom(newScale, true, true);
}

export function setUiZoom(scale: number | string): void {
  applyUiZoom(scale, true, true);
}

export function setupZoomKeyboardShortcuts(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const providerModal = document.getElementById('translation-provider-modal') as HTMLElement | null;
      if (providerModal && (providerModal.classList.contains('show') || providerModal.style.display === 'flex')) {
        if (typeof (window as any).closeProviderModal === 'function') {
          (window as any).closeProviderModal();
        }
      }
      const batchModal = document.getElementById('batch-error-modal') as HTMLElement | null;
      if (batchModal && (batchModal.classList.contains('show') || batchModal.style.display === 'flex')) {
        if (typeof (window as any).resolveBatchError === 'function') {
          (window as any).resolveBatchError('abort');
        }
      }
      const overlay = document.getElementById('app-modal-overlay') as HTMLElement | null;
      if (overlay && (overlay.classList.contains('show') || overlay.style.display === 'flex')) {
        if ((window as any)._confirmModalResolve) {
          (window as any).resolveAppConfirm(false);
        } else if (typeof (window as any).closeAppModal === 'function') {
          (window as any).closeAppModal();
        }
      }
      document.querySelectorAll('.custom-select-options.open').forEach(el => {
        el.classList.remove('open');
      });
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') {
        e.preventDefault();
        adjustUiZoom(0.05);
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
        e.preventDefault();
        adjustUiZoom(-0.05);
      } else if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') {
        e.preventDefault();
        setUiZoom(1.0);
      }
    }
  }, { passive: false });
}

// Bind to window for global inline HTML onclick handlers
if (typeof window !== 'undefined') {
  (window as any).applyMonochromeCanvas = applyMonochromeCanvas;
  (window as any).isMonochromeCanvasActive = isMonochromeCanvasActive;
  (window as any).applyTheme = applyTheme;
  (window as any).toggleTheme = toggleTheme;
  (window as any).handleThemeSegmentClick = handleThemeSegmentClick;
  (window as any).switchTheme = switchTheme;
  (window as any).applyUiZoom = applyUiZoom;
  (window as any).adjustUiZoom = adjustUiZoom;
  (window as any).setUiZoom = setUiZoom;
}

export const themeManager = {
  applyTheme,
  toggleTheme,
  switchTheme,
  applyMonochromeCanvas,
  isMonochromeCanvasActive,
  applyUiZoom,
  adjustUiZoom,
  setUiZoom,
  setupShortcuts: setupZoomKeyboardShortcuts,
  resolveTheme: resolveThemeConfig,
  THEME_REGISTRY,
  MONOCHROME_META_COLORS
};
