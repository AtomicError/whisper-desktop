import { t, APP_NAME, applyTextDirection } from '../i18n/index';
import { customSelectsMap } from './customSelect';
import { logsController } from './logsController';
import { modelHub } from './modelHub';
import { transcriptViewer } from './transcriptViewer';
import { batchProcessor } from './batchProcessor';
import { getSelectedMediaFile } from './transcribePipeline';

declare global {
  interface Window {
    activeView?: string;
    hardsubController?: any;
    translationStudioController?: any;
    getCurrentSourceMediaFile?: () => string | null;
  }
}

let activeView = 'transcribe';
let isCurrentlyCollapsed: boolean | null = null;

export function getActiveView(): string {
  return activeView;
}

export function setActiveView(view: string): void {
  activeView = view;
  if (typeof window !== 'undefined') {
    window.activeView = view;
  }
}

/**
 * Returns the currently authoritative media file across batch or single-mode
 */
export function getCurrentSourceMediaFile(): string | null {
  if (
    batchProcessor.getIsBatchMode() &&
    batchProcessor.getActiveViewerIndex() >= 0 &&
    batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()]
  ) {
    return batchProcessor.getItems()[batchProcessor.getActiveViewerIndex()].path;
  }
  const batchFiles = batchProcessor.getSelectedFiles();
  const singleMedia = getSelectedMediaFile();
  const fallbackSettings = typeof window !== 'undefined' ? (window as any).settingsState?.inputFile : null;
  return singleMedia || (batchFiles && batchFiles.length > 0 ? batchFiles[0] : null) || fallbackSettings || null;
}

if (typeof window !== 'undefined') {
  window.getCurrentSourceMediaFile = getCurrentSourceMediaFile;
}

/**
 * Switch Active View Panel and update navigation state & accessibility
 */
export function switchView(viewName: string): void {
  setActiveView(viewName);

  // Close any open custom dropdowns cleanly via their lifecycle method
  if (customSelectsMap) {
    customSelectsMap.forEach(cs => {
      if (cs && cs.isOpen && typeof cs.close === 'function') {
        cs.close();
      }
    });
  }

  // Update nav link active states and accessibility
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    const isTarget = (item as HTMLElement).dataset.view === viewName;
    if (isTarget) {
      item.classList.add('active');
      item.setAttribute('aria-selected', 'true');
      item.setAttribute('tabindex', '0');
    } else {
      item.classList.remove('active');
      item.setAttribute('aria-selected', 'false');
      item.setAttribute('tabindex', '-1');
    }
  });

  // Update view panel active states
  const panels = document.querySelectorAll('.view-panel');
  panels.forEach(panel => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(`panel-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
    if (viewName === 'transcribe') {
      requestAnimationFrame(() => {
        const viewport = document.getElementById('transcript-viewport');
        if (viewport) {
          viewport.querySelectorAll('.transcript-text-input').forEach(el => {
            transcriptViewer.autoResize(el as HTMLElement);
          });
        }
      });
    } else if (viewName === 'logs') {
      requestAnimationFrame(() => {
        const viewport = document.getElementById('log-viewport');
        const autoScroll = document.getElementById('log-autoscroll') as HTMLInputElement | null;
        if (viewport && (!autoScroll || autoScroll.checked)) {
          viewport.scrollTop = viewport.scrollHeight;
        }
        logsController.updateLogJumpPillVisibility();
      });
    }
  }

  // Authoritative hardsub page state management
  if (typeof window !== 'undefined' && window.hardsubController && typeof window.hardsubController.setPageActive === 'function') {
    window.hardsubController.setPageActive(viewName === 'hardsub');
  }

  // Update Header Title with transition
  const localizedViewTitle = t(`nav.${viewName}`) || APP_NAME;
  const titleEl = document.getElementById('current-view-title');
  if (titleEl) {
    titleEl.style.opacity = '0.7';
    titleEl.textContent = localizedViewTitle;
    requestAnimationFrame(() => {
      titleEl.style.opacity = '1';
    });
  }

  if (viewName === 'models') {
    modelHub.setCategory('recommended', true);
  }

  if (viewName === 'translate') {
    if (typeof window !== 'undefined' && window.translationStudioController) {
      window.translationStudioController.syncFromGlobalSettings();
      window.translationStudioController.refreshLocalization();
    }
  }
}

if (typeof window !== 'undefined') {
  window.switchView = switchView;
}

/**
 * Dynamically updates text direction (ltr vs rtl) of an input/textarea
 * based on its text content, independent of the overall app UI language.
 */
export function applyDynamicDirection(el: HTMLElement, defaultDir: 'ltr' | 'rtl' | null = null): void {
  applyTextDirection(el, defaultDir);
}

if (typeof window !== 'undefined') {
  window.applyDynamicDirection = applyDynamicDirection;
}

/**
 * Setup responsive sidebar collapse via matchMedia + class toggle
 */
export function setupResponsiveMenuFadeIn(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;

  const sidebarMql = window.matchMedia('(max-width: 960px)');

  const handler = (e: MediaQueryList | MediaQueryListEvent) => {
    const sidebar = document.querySelector('sidebar');
    if (!sidebar) return;

    if (e.matches) {
      if (isCurrentlyCollapsed === true) return;
      isCurrentlyCollapsed = true;
      sidebar.classList.add('sidebar-collapsed');
    } else {
      if (isCurrentlyCollapsed === false) return;
      isCurrentlyCollapsed = false;
      sidebar.classList.remove('sidebar-collapsed');
    }
  };

  if (sidebarMql.addEventListener) {
    sidebarMql.addEventListener('change', handler);
  } else if ((sidebarMql as any).addListener) {
    (sidebarMql as any).addListener(handler);
  }

  handler(sidebarMql);
}

/**
 * Horizontal mouse-wheel scroll on tab bars for narrow windows
 */
export function setupHorizontalTabScroll(): void {
  const scrollWheel = (e: WheelEvent) => {
    const container = e.currentTarget as HTMLElement;
    const maxScroll = container.scrollWidth - container.clientWidth;
    if (maxScroll > 0) {
      container.scrollLeft += (e.deltaY || e.deltaX);
      e.preventDefault();
    }
  };

  const containers = document.querySelectorAll('.settings-categories, .compact-outputs');
  containers.forEach(el => {
    el.addEventListener('wheel', scrollWheel as EventListener, { passive: false });
  });
}

/**
 * Vertical tablist keyboard navigation (WAI-ARIA Roving Tabindex, automatic activation)
 */
export function setupVerticalTabKeyboardNavigation(): void {
  const navItems = Array.from(document.querySelectorAll('.nav-item')) as HTMLElement[];
  if (!navItems.length) return;

  const moveTabFocus = (e: KeyboardEvent, item: HTMLElement): number => {
    let targetIndex = -1;
    if (e.key === 'ArrowDown') {
      targetIndex = (navItems.indexOf(item) + 1) % navItems.length;
    } else if (e.key === 'ArrowUp') {
      targetIndex = (navItems.indexOf(item) - 1 + navItems.length) % navItems.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = navItems.length - 1;
    }
    return targetIndex;
  };

  navItems.forEach(item => {
    item.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.click();
        return;
      }

      const targetIndex = moveTabFocus(e, item);
      if (targetIndex >= 0) {
        e.preventDefault();
        if (navItems[targetIndex]) {
          navItems[targetIndex].focus();
          navItems[targetIndex].click();
        }
      }
    });
  });
}

/**
 * Global search shortcuts (Escape clears search, '/' or Ctrl+F focuses search in active view)
 */
export function setupSearchShortcuts(): void {
  const settingsSearchInput = document.getElementById('settings-search-input') as (HTMLInputElement & { _hasSearchEscListener?: boolean }) | null;
  if (settingsSearchInput && !settingsSearchInput._hasSearchEscListener) {
    settingsSearchInput._hasSearchEscListener = true;
    settingsSearchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (typeof window !== 'undefined' && typeof (window as any).clearSettingsSearch === 'function') {
          (window as any).clearSettingsSearch();
        }
      }
    });
  }

  const modelSearchInput = document.getElementById('model-search') as (HTMLInputElement & { _hasSearchEscListener?: boolean }) | null;
  if (modelSearchInput && !modelSearchInput._hasSearchEscListener) {
    modelSearchInput._hasSearchEscListener = true;
    modelSearchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (typeof window !== 'undefined' && typeof (window as any).clearModelSearch === 'function') {
          (window as any).clearModelSearch();
        }
      }
    });
  }

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const isEditing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if ((e.key === '/' && !isEditing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
      if (activeView === 'settings') {
        const input = document.getElementById('settings-search-input') as HTMLInputElement | null;
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      } else if (activeView === 'models') {
        const input = document.getElementById('model-search') as HTMLInputElement | null;
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    }
  });
}

/**
 * Re-evaluates content-based direction on prompt and search inputs across the app
 */
export function refreshDynamicDirectionInputs(): void {
  const promptInput = document.getElementById('opt-prompt') as HTMLElement | null;
  if (promptInput) {
    applyDynamicDirection(promptInput);
  }

  const appSearchIds = [
    'settings-search-input',
    'mgr-models-search',
    'model-search',
    'transcript-search',
    'log-search',
    'hardsub-search-input'
  ];

  appSearchIds.forEach(id => {
    const input = document.getElementById(id) as HTMLElement | null;
    if (input) {
      applyDynamicDirection(input);
    }
  });
}

/**
 * Attach dynamic content direction listeners to inputs & search bars across the app
 */
export function setupDynamicDirectionInputs(): void {
  refreshDynamicDirectionInputs();

  const promptInput = document.getElementById('opt-prompt') as (HTMLInputElement & { _hasDynamicDirListener?: boolean }) | null;
  if (promptInput && !promptInput._hasDynamicDirListener) {
    promptInput._hasDynamicDirListener = true;
    promptInput.addEventListener('input', () => applyDynamicDirection(promptInput));
  }

  const appSearchIds = [
    'settings-search-input',
    'mgr-models-search',
    'model-search',
    'transcript-search',
    'log-search',
    'hardsub-search-input'
  ];

  appSearchIds.forEach(id => {
    const input = document.getElementById(id) as (HTMLInputElement & { _hasDynamicDirListener?: boolean }) | null;
    if (input && !input._hasDynamicDirListener) {
      input._hasDynamicDirListener = true;
      input.addEventListener('input', () => applyDynamicDirection(input));
    }
  });
}
