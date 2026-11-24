// Multi-Theme & UI Scaling Engine for Whisper Desktop

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
  'ruby-red': {
    id: 'ruby-red',
    label: 'Ruby Red',
    dataTheme: 'ruby-red',
    metaColor: '#120707',
    toastName: 'Ruby Red',
    iconSvg: `
      <svg class="theme-btn-icon icon-ruby" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 22 12 12 22 2 12 12 2"/>
      </svg>
    `
  },
  'ruby': {
    id: 'ruby-red',
    label: 'Ruby Red',
    dataTheme: 'ruby-red',
    metaColor: '#120707',
    toastName: 'Ruby Red',
    iconSvg: `
      <svg class="theme-btn-icon icon-ruby" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 22 12 12 22 2 12 12 2"/>
      </svg>
    `
  },
  'carbon': {
    id: 'ruby-red',
    label: 'Ruby Red',
    dataTheme: 'ruby-red',
    metaColor: '#120707',
    toastName: 'Ruby Red',
    iconSvg: `
      <svg class="theme-btn-icon icon-ruby" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 22 12 12 22 2 12 12 2"/>
      </svg>
    `
  },
  'fire-orange': {
    id: 'fire-orange',
    label: 'Fiery Orange',
    dataTheme: 'fire-orange',
    metaColor: '#100803',
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

export const NEUTRAL_CANVAS_COLOR = '#0a0a0c';

export const MONOCHROME_META_COLORS: Record<string, string> = {
  'royal-blue': NEUTRAL_CANVAS_COLOR,
  'cyber-blue': NEUTRAL_CANVAS_COLOR,
  'ruby-red': NEUTRAL_CANVAS_COLOR,
  'ruby': NEUTRAL_CANVAS_COLOR,
  'carbon': NEUTRAL_CANVAS_COLOR,
  'fire-orange': NEUTRAL_CANVAS_COLOR,
  'fire': NEUTRAL_CANVAS_COLOR,
  'emerald': NEUTRAL_CANVAS_COLOR
};

let currentUiZoom = 1.0;
let zoomSaveTimeout: any = null;

/** Cancels any pending debounced zoom save timer and reports whether one was armed. */
export function clearPendingUiZoomSave(): boolean {
  if (zoomSaveTimeout) {
    clearTimeout(zoomSaveTimeout);
    zoomSaveTimeout = null;
    return true;
  }
  return false;
}

export function resolveThemeConfig(themeName: string): ThemeConfig {
  if (themeName === 'ruby-red' || themeName === 'ruby' || themeName === 'carbon') {
    return THEME_REGISTRY['ruby-red'];
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

export function applyMonochromeCanvas(isMonochrome: boolean, persist = true, animated = true): void {
  if (typeof document === 'undefined') return;
  cancelActiveThemeWipe();
  const root = document.documentElement;
  const currentActive = isMonochromeCanvasActive();

  const applyDomChanges = () => {
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
      const monoBg = MONOCHROME_META_COLORS[config.id] || NEUTRAL_CANVAS_COLOR;
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

    if ((window as any).settingsState) {
      (window as any).settingsState.monochromeCanvas = isMonochrome;
      if (persist && typeof (window as any).markSettingsDirty === 'function') {
        (window as any).markSettingsDirty();
      }
    }
  };

  if (currentActive === isMonochrome) {
    applyDomChanges();
    return;
  }

  const isTestEnv = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'test';
  const shouldAnimate = animated && !isTestEnv &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof requestAnimationFrame === 'function';

  const appContainer = document.getElementById('app-container');
  if (!shouldAnimate || !appContainer) {
    applyDomChanges();
    return;
  }

  const currentThemeId = ((window as any).settingsState && (window as any).settingsState.theme)
    ? (window as any).settingsState.theme
    : (localStorage.getItem('whisper_theme_cache') || 'royal-blue');
  const config = resolveThemeConfig(currentThemeId);
  const oldCanvasAttr = currentActive ? 'monochrome' : null;

  runThemeWipe(
    config.id,
    oldCanvasAttr,
    applyDomChanges
  );
}

export function applyTheme(themeName: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const config = resolveThemeConfig(themeName);
  const isMonochrome = isMonochromeCanvasActive();

  if (config.id === 'royal-blue') {
    root.removeAttribute('data-theme');
    if (isMonochrome) {
      root.style.setProperty('--bg-space', MONOCHROME_META_COLORS['royal-blue'] || NEUTRAL_CANVAS_COLOR);
    } else {
      root.style.removeProperty('--bg-space');
    }
  } else {
    root.setAttribute('data-theme', config.dataTheme || config.id);
    if (isMonochrome) {
      root.style.setProperty('--bg-space', MONOCHROME_META_COLORS[config.id] || NEUTRAL_CANVAS_COLOR);
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
      ? (MONOCHROME_META_COLORS[config.id] || NEUTRAL_CANVAS_COLOR)
      : config.metaColor;
    if (effectiveColor) {
      metaTheme.setAttribute('content', effectiveColor);
    }
  }

  const activeThemeId = config.id;
  const themeCardMap: Record<string, string> = {
    'royal-blue': 'theme-card-royal',
    'ruby-red': 'theme-card-ruby',
    'ruby': 'theme-card-ruby',
    'carbon': 'theme-card-ruby',
    'fire-orange': 'theme-card-fire',
    'fire': 'theme-card-fire',
    'emerald': 'theme-card-emerald'
  };
  const targetCardId = themeCardMap[activeThemeId] || 'theme-card-royal';

  document.querySelectorAll('.theme-picker-card').forEach(card => {
    if (card.closest('#theme-wipe-overlay')) return;
    const isActive = (card.id === targetCardId || (targetCardId === 'theme-card-ruby' && card.id === 'theme-card-carbon'));
    card.classList.toggle('active', isActive);
    card.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

export function toggleTheme(): void {
  const currentThemeAttr = document.documentElement.getAttribute('data-theme') || 'royal-blue';
  let nextTheme = 'ruby-red';
  if (currentThemeAttr === 'ruby-red' || currentThemeAttr === 'carbon') {
    nextTheme = 'fire-orange';
  } else if (currentThemeAttr === 'fire-orange' || currentThemeAttr === 'fire') {
    nextTheme = 'emerald';
  } else if (currentThemeAttr === 'emerald') {
    nextTheme = 'royal-blue';
  } else {
    nextTheme = 'ruby-red';
  }
  switchTheme(nextTheme);
}

export function handleThemeSegmentClick(targetTheme: string): void {
  switchTheme(targetTheme);
}

let activeThemeWipeCancel: (() => void) | null = null;

export function cancelActiveThemeWipe(): void {
  if (activeThemeWipeCancel) {
    activeThemeWipeCancel();
    activeThemeWipeCancel = null;
  }
}

export function runThemeWipe(
  oldThemeId: string,
  oldCanvasAttr: string | null,
  onApplyNewState: () => void,
  onComplete?: () => void
): void {
  if (typeof document === 'undefined') {
    onApplyNewState();
    onComplete?.();
    return;
  }

  cancelActiveThemeWipe();

  const appContainer = document.getElementById('app-container');
  if (!appContainer) {
    onApplyNewState();
    onComplete?.();
    return;
  }

  const isRtl = document.documentElement.getAttribute('dir') === 'rtl' ||
    document.documentElement.classList.contains('rtl-layout');

  const titlebar = document.querySelector('.titlebar');

  // 1. Capture live scroll offsets & form states BEFORE mutating the real app
  const origAppElements = appContainer.querySelectorAll('*');
  const savedScrolls: Array<{ index: number; scrollTop: number; scrollLeft: number }> = [];
  const rootScrollTop = appContainer.scrollTop;
  const rootScrollLeft = appContainer.scrollLeft;

  origAppElements.forEach((el, index) => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.scrollTop !== 0 || htmlEl.scrollLeft !== 0) {
      savedScrolls.push({
        index,
        scrollTop: htmlEl.scrollTop,
        scrollLeft: htmlEl.scrollLeft
      });
    }
  });

  // 2. Create overlay containing the cloned app in the OLD theme and canvas state.
  // Keep original element IDs so #app-container, #theme-card-*, and #id-scoped CSS rules
  // render with 100% pixel-accurate layout parity (overlay is appended AFTER real DOM,
  // marked inert + aria-hidden + pointer-events: none).
  const overlay = document.createElement('div');
  overlay.id = 'theme-wipe-overlay';
  overlay.setAttribute('data-theme', oldThemeId);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('inert', '');
  if (oldCanvasAttr) {
    overlay.setAttribute('data-canvas', oldCanvasAttr);
  }

  const cloneWrap = document.createElement('div');
  cloneWrap.className = 'theme-wipe-clone-content';

  if (titlebar) {
    cloneWrap.appendChild(titlebar.cloneNode(true));
  }
  const clonedApp = appContainer.cloneNode(true) as HTMLElement;
  cloneWrap.appendChild(clonedApp);
  overlay.appendChild(cloneWrap);

  // Synchronize live form control states (checked / value) onto the clone
  const cloneAppElements = clonedApp.querySelectorAll('*');
  origAppElements.forEach((orig, idx) => {
    const clone = cloneAppElements[idx];
    if (!clone) return;
    if (orig instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
      if (orig.type === 'checkbox' || orig.type === 'radio') {
        clone.checked = orig.checked;
      } else {
        clone.value = orig.value;
      }
    } else if (orig instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
      clone.value = orig.value;
    } else if (orig instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
      clone.value = orig.value;
    }
  });

  // Synchronize canvas pixel buffers so graphic surfaces / subtitle overlays are preserved in the clone
  const origCanvases = appContainer.querySelectorAll<HTMLCanvasElement>('canvas');
  const cloneCanvases = clonedApp.querySelectorAll<HTMLCanvasElement>('canvas');
  origCanvases.forEach((orig, idx) => {
    const clone = cloneCanvases[idx];
    if (clone && orig.width > 0 && orig.height > 0) {
      clone.width = orig.width;
      clone.height = orig.height;
      const ctx = clone.getContext('2d');
      if (ctx) {
        try {
          ctx.drawImage(orig, 0, 0);
        } catch (_) {}
      }
    }
  });

  // Neutralize media elements in visual clone to prevent double-buffering or GStreamer hardware conflicts
  cloneWrap.querySelectorAll('video, audio').forEach((media) => {
    try {
      (media as HTMLMediaElement).pause();
      (media as HTMLMediaElement).muted = true;
      (media as HTMLMediaElement).removeAttribute('autoplay');
    } catch (_) {}
  });

  // Strip Tauri drag regions from visual clone to prevent native window hit-test collisions
  cloneWrap.querySelectorAll('[data-tauri-drag-region]').forEach((el) => el.removeAttribute('data-tauri-drag-region'));

  // 3. Create the SVG Laser Blade Layer (luminous white line cutting across the seam)
  const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgLayer.setAttribute('class', 'theme-wipe-svg-layer');
  svgLayer.setAttribute('aria-hidden', 'true');

  const bladeLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  bladeLine.setAttribute('class', 'theme-wipe-blade-line');
  svgLayer.appendChild(bladeLine);

  // 4. Switch the real underlying app to the NEW state BEFORE attaching the clone overlay
  // so document.querySelectorAll(...) inside onApplyNewState cannot mutate the clone!
  onApplyNewState();

  // 5. Attach overlay + blade to DOM, then restore captured scroll positions (requires live layout boxes)
  document.body.appendChild(overlay);
  document.body.appendChild(svgLayer);

  if (rootScrollTop !== 0 || rootScrollLeft !== 0) {
    clonedApp.scrollTop = rootScrollTop;
    clonedApp.scrollLeft = rootScrollLeft;
  }
  for (const entry of savedScrolls) {
    const cloneEl = cloneAppElements[entry.index] as HTMLElement | undefined;
    if (cloneEl) {
      cloneEl.scrollTop = entry.scrollTop;
      cloneEl.scrollLeft = entry.scrollLeft;
    }
  }

  // 4. Smooth 1000ms cinematic diagonal wipe loop
  let rafId: number | null = null;
  let isDone = false;
  const duration = 1000;
  let startTime: number | null = null;

  const cleanup = () => {
    if (isDone) return;
    isDone = true;
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    overlay.remove();
    svgLayer.remove();
    if (activeThemeWipeCancel === cancelHandler) {
      activeThemeWipeCancel = null;
    }
  };

  const cancelHandler = () => {
    cleanup();
  };
  activeThemeWipeCancel = cancelHandler;

  const tick = (now: number) => {
    if (isDone) return;
    if (startTime === null) startTime = now;

    const elapsed = Math.max(0, now - startTime);
    const progress = Math.min(1.0, elapsed / duration);

    // Smooth, cinematic sine-based ease-in-out for steady, tangible momentum
    const eased = -(Math.cos(Math.PI * progress) - 1) / 2;

    const W = window.innerWidth || document.documentElement.clientWidth || 1024;
    const H = window.innerHeight || document.documentElement.clientHeight || 768;

    const T = eased * 2.2;

    let x1 = 0;
    let y1 = 0;
    let x2 = 0;
    let y2 = 0;

    if (T <= 1.0) {
      x1 = T * W;
      y1 = 0;
      x2 = 0;
      y2 = T * H;
    } else {
      x1 = W;
      y1 = (T - 1.0) * H;
      x2 = (T - 1.0) * W;
      y2 = H;
    }

    if (!isRtl) {
      // LTR: Top-Left to Bottom-Right
      bladeLine.setAttribute('x1', x1.toFixed(1));
      bladeLine.setAttribute('y1', y1.toFixed(1));
      bladeLine.setAttribute('x2', x2.toFixed(1));
      bladeLine.setAttribute('y2', y2.toFixed(1));

      if (T <= 1.0) {
        overlay.style.clipPath = `polygon(${x1.toFixed(1)}px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px, 0px ${y2.toFixed(1)}px)`;
      } else if (T < 2.0) {
        overlay.style.clipPath = `polygon(${W}px ${y1.toFixed(1)}px, ${W}px ${H}px, ${x2.toFixed(1)}px ${H}px)`;
      } else {
        overlay.style.clipPath = 'polygon(0 0, 0 0, 0 0)';
      }
    } else {
      // RTL: Top-Right to Bottom-Left
      const rx1 = W - x1;
      const rx2 = W - x2;

      bladeLine.setAttribute('x1', rx1.toFixed(1));
      bladeLine.setAttribute('y1', y1.toFixed(1));
      bladeLine.setAttribute('x2', rx2.toFixed(1));
      bladeLine.setAttribute('y2', y2.toFixed(1));

      if (T <= 1.0) {
        overlay.style.clipPath = `polygon(${rx1.toFixed(1)}px 0px, 0px 0px, 0px ${H}px, ${W}px ${H}px, ${W}px ${y2.toFixed(1)}px)`;
      } else if (T < 2.0) {
        overlay.style.clipPath = `polygon(0px ${y1.toFixed(1)}px, 0px ${H}px, ${rx2.toFixed(1)}px ${H}px)`;
      } else {
        overlay.style.clipPath = 'polygon(0 0, 0 0, 0 0)';
      }
    }

    if (progress < 1.0) {
      rafId = requestAnimationFrame(tick);
    } else {
      cleanup();
      onComplete?.();
    }
  };

  rafId = requestAnimationFrame(tick);
}

export function switchTheme(themeName: string, animated = true): void {
  if (typeof document === 'undefined') return;

  cancelActiveThemeWipe();

  const config = resolveThemeConfig(themeName);
  const currentThemeAttr = document.documentElement.getAttribute('data-theme') || 'royal-blue';
  const oldThemeId = resolveThemeConfig(currentThemeAttr).id;
  const currentCanvasAttr = document.documentElement.getAttribute('data-canvas');

  const isTestEnv = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.env?.NODE_ENV === 'test';
  const shouldAnimate = animated && !isTestEnv &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof requestAnimationFrame === 'function';

  const finalizeThemeSwitch = () => {
    if ((window as any).settingsState) {
      (window as any).settingsState.theme = config.id;
      if (typeof (window as any).saveCurrentSettings === 'function') {
        (window as any).saveCurrentSettings(false);
      }
    }
  };

  // Synchronize settingsState immediately so the active state is consistent across the app
  // and mark settings dirty so an early window close still persists the new theme to disk.
  if ((window as any).settingsState) {
    (window as any).settingsState.theme = config.id;
    if (typeof (window as any).markSettingsDirty === 'function') {
      (window as any).markSettingsDirty();
    }
  }

  const appContainer = document.getElementById('app-container');

  if (!shouldAnimate || !appContainer || oldThemeId === config.id) {
    applyTheme(config.id);
    finalizeThemeSwitch();
    return;
  }

  runThemeWipe(
    oldThemeId,
    currentCanvasAttr,
    () => applyTheme(config.id),
    finalizeThemeSwitch
  );
}

const getNativeTauriInvoke = (): any => {
  const tauri = typeof window !== 'undefined' ? (window as any).__TAURI__ : null;
  if (tauri && tauri.core && tauri.core.invoke) {
    return tauri.core.invoke;
  }
  return null;
};

/**
 * Applies UI zoom scale across native Tauri webview and fallback CSS zoom.
 * Note: `showToast` parameter is preserved for signature compatibility with boot routines
 * and is checked to distinguish splash boot hydration (!persist && !showToast) from user actions.
 */
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
      (window as any).syncCustomSelects(false, true);
    }
  }

  if (persist && (window as any).settingsState) {
    (window as any).settingsState.uiScale = numScale;
    if (typeof (window as any).markSettingsDirty === 'function') {
      (window as any).markSettingsDirty();
    }
    if (zoomSaveTimeout) {
      clearTimeout(zoomSaveTimeout);
    }
    zoomSaveTimeout = setTimeout(() => {
      zoomSaveTimeout = null;
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
      if (e.defaultPrevented) return;
      const openSelects = document.querySelectorAll('.custom-select-options.open');
      if (openSelects.length > 0) {
        const selectsMap = (window as any).customSelectsMap;
        if (selectsMap && typeof selectsMap.forEach === 'function') {
          selectsMap.forEach((cs: any) => {
            if (cs && cs.isOpen && typeof cs.close === 'function') {
              cs.close();
            }
          });
        }
        openSelects.forEach(el => el.classList.remove('open'));
        return;
      }
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
  (window as any).runThemeWipe = runThemeWipe;
  (window as any).applyUiZoom = applyUiZoom;
  (window as any).adjustUiZoom = adjustUiZoom;
  (window as any).setUiZoom = setUiZoom;
  (window as any).clearPendingUiZoomSave = clearPendingUiZoomSave;
}

export const themeManager = {
  applyTheme,
  toggleTheme,
  switchTheme,
  runThemeWipe,
  applyMonochromeCanvas,
  isMonochromeCanvasActive,
  applyUiZoom,
  adjustUiZoom,
  setUiZoom,
  clearPendingUiZoomSave,
  setupShortcuts: setupZoomKeyboardShortcuts,
  resolveTheme: resolveThemeConfig,
  THEME_REGISTRY,
  MONOCHROME_META_COLORS
};
