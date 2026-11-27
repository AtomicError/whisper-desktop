/**
 * Native-Feel In-App Context Menu Controller
 *
 * Replaces the generic browser context menu outside native editable inputs with
 * a theme-aware, RTL/LTR-compatible, keyboard-accessible menu tailored to each
 * workstation section (Logs, Transcribe, Translate, Hardsub, Models, Settings, Modals, Toasts).
 */

import { t, isRtlLanguage, getLanguage } from '../i18n/index';
import {
  ContextMenuIconName,
  ContextMenuItemSpec,
  ContextMenuEntry,
  stripBidiMarks,
  isNativeEditableTarget,
  isPreservedCustomContextTarget,
  getActiveSelectionTextForTarget,
  getActiveSelectionContext,
  selectAllTextInElement,
  normalizeMenuEntries,
  resolveContextMenuEntries
} from './contextMenuResolvers';

export type { ContextMenuIconName, ContextMenuItemSpec, ContextMenuEntry };
export {
  stripBidiMarks,
  isNativeEditableTarget,
  isPreservedCustomContextTarget,
  getActiveSelectionTextForTarget,
  selectAllTextInElement,
  resolveContextMenuEntries
};

interface ContextMenuToastElement extends HTMLElement {
  _pauseForContextMenu?: () => void;
  _resumeAfterContextMenu?: () => void;
}

const MENU_ID = 'app-context-menu';
const VIEWPORT_PADDING = 8;

const ICON_INNER_PATHS: Record<ContextMenuIconName, string> = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  clipboardList: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  selectAll: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
};

let _menuEl: HTMLDivElement | null = null;
let _isInitialized = false;
let _previousFocusEl: HTMLElement | null = null;
let _openedByKeyboard = false;
let _keyboardFocusActive = false;
let _openedInsideLiveViewportId: string | null = null;
let _activeToastEl: ContextMenuToastElement | null = null;
let _lastPointerX: number | null = null;
let _lastPointerY: number | null = null;
const _actionHandlers = new Map<string, () => void | Promise<void>>();

function createIconSvg(name: ContextMenuIconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('app-context-menu__icon');
  svg.innerHTML = ICON_INNER_PATHS[name] || ICON_INNER_PATHS.copy;
  return svg;
}

function getMenuHostElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const fsEl = (document as any).fullscreenElement as HTMLElement | null | undefined;
  if (
    fsEl &&
    fsEl !== document.documentElement &&
    fsEl !== document.body &&
    typeof fsEl.appendChild === 'function'
  ) {
    return fsEl;
  }
  return document.body || null;
}

function clearFocusedItemClasses(menu: HTMLDivElement): void {
  const items = menu.querySelectorAll('.app-context-menu__item.is-focused');
  items.forEach((el) => el.classList.remove('is-focused'));
}

function releaseActiveToast(): void {
  if (!_activeToastEl) return;
  if (_activeToastEl.dataset) delete _activeToastEl.dataset.contextMenuActive;
  _activeToastEl._resumeAfterContextMenu?.();
  _activeToastEl = null;
}

function bindMenuElementListeners(menu: HTMLDivElement): void {
  if ((menu as any)._contextMenuBound) return;
  (menu as any)._contextMenuBound = true;

  // Prevent mousedown inside the menu from clearing text selection or dismissing immediately,
  // while leaving the menu's own scrollbar track/thumb draggable when overflowed.
  menu.addEventListener('mousedown', (e: MouseEvent) => {
    const rawTarget = e.target as HTMLElement | null;
    if (
      rawTarget === menu &&
      typeof menu.clientWidth === 'number' &&
      menu.clientWidth > 0 &&
      typeof menu.scrollHeight === 'number' &&
      menu.scrollHeight > menu.clientHeight &&
      typeof menu.getBoundingClientRect === 'function'
    ) {
      const rect = menu.getBoundingClientRect();
      const cssZoom = getCssZoomFactor();
      const clientLeft = typeof menu.clientLeft === 'number' ? menu.clientLeft : 0;
      const clickOffsetX = (e.clientX - rect.left) / cssZoom;
      if (clickOffsetX < clientLeft || clickOffsetX >= clientLeft + menu.clientWidth) {
        return;
      }
    }
    e.preventDefault();
  });
  menu.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
  });
  menu.addEventListener('mousemove', (e: MouseEvent) => {
    if (
      typeof e.movementX === 'number' &&
      typeof e.movementY === 'number' &&
      e.movementX === 0 &&
      e.movementY === 0
    ) {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        _lastPointerX = e.clientX;
        _lastPointerY = e.clientY;
      }
      return;
    }
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      if (
        _lastPointerX !== null &&
        _lastPointerY !== null &&
        Math.abs(e.clientX - _lastPointerX) < 2 &&
        Math.abs(e.clientY - _lastPointerY) < 2
      ) {
        return;
      }
      _lastPointerX = e.clientX;
      _lastPointerY = e.clientY;
    }

    if (menu.classList.contains('is-keyboard-nav')) {
      menu.classList.remove('is-keyboard-nav');
      clearFocusedItemClasses(menu);
      if (!_openedByKeyboard) {
        _keyboardFocusActive = false;
      }
      const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (activeEl && activeEl !== menu && typeof menu.contains === 'function' && menu.contains(activeEl)) {
        menu.focus?.({ preventScroll: true });
      }
    }
  });
  menu.addEventListener('click', (e: MouseEvent) => {
    const rawTarget = e.target as HTMLElement | null;
    const btn = rawTarget && typeof rawTarget.closest === 'function'
      ? (rawTarget.closest('.app-context-menu__item') as HTMLButtonElement | null)
      : null;
    if (!btn || btn.disabled) return;
    e.stopPropagation();
    const menuId = btn.dataset?.menuId || '';
    const handler = _actionHandlers.get(menuId);
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    // Distinguish focused menu item / keyboard Enter-Space (detail === 0) from mouse clicks after pointer fallback to menu container
    const activeItemInsideMenu = Boolean(
      activeEl &&
      activeEl !== menu &&
      typeof menu.contains === 'function' &&
      menu.contains(activeEl)
    );
    const shouldRestoreFocus = _openedByKeyboard || _keyboardFocusActive || activeItemInsideMenu || e.detail === 0;
    closeContextMenu({ restoreFocus: shouldRestoreFocus });
    if (handler) {
      void handler();
    }
  });
}

function ensureMenuElement(): HTMLDivElement | null {
  const host = getMenuHostElement();
  if (!host) return null;

  if (_menuEl) {
    bindMenuElementListeners(_menuEl);
    if (_menuEl.parentNode !== host) {
      host.appendChild(_menuEl);
    }
    return _menuEl;
  }

  const existing = document.getElementById(MENU_ID) as HTMLDivElement | null;
  if (existing) {
    _menuEl = existing;
    bindMenuElementListeners(_menuEl);
    if (_menuEl.parentNode !== host) {
      host.appendChild(_menuEl);
    }
    return _menuEl;
  }

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'app-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-hidden', 'true');
  menu.tabIndex = -1;
  bindMenuElementListeners(menu);

  host.appendChild(menu);
  _menuEl = menu;
  return menu;
}

/** Return true when the custom context menu is currently open. */
export function isContextMenuOpen(): boolean {
  return Boolean(_menuEl && _menuEl.classList.contains('open'));
}

/** Close the context menu and optionally restore focus to the triggering element. */
export function closeContextMenu(options?: { restoreFocus?: boolean }): void {
  if (!_menuEl) return;
  const wasOpen = _menuEl.classList.contains('open');

  const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  const activeInsideMenu = Boolean(
    activeEl &&
    typeof _menuEl.contains === 'function' &&
    _menuEl.contains(activeEl)
  );

  if (
    wasOpen &&
    options?.restoreFocus &&
    (_openedByKeyboard || _keyboardFocusActive || activeInsideMenu) &&
    _previousFocusEl
  ) {
    try {
      _previousFocusEl.focus?.({ preventScroll: true });
    } catch {
      // Ignore focus errors on detached elements
    }
  }

  const postRestoreActive = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (
    activeInsideMenu &&
    postRestoreActive &&
    typeof _menuEl.contains === 'function' &&
    _menuEl.contains(postRestoreActive)
  ) {
    try {
      postRestoreActive.blur?.();
    } catch {
      // Ignore blur errors
    }
  }

  _menuEl.classList.remove('open');
  _menuEl.classList.remove('is-keyboard-nav');
  clearFocusedItemClasses(_menuEl);
  _menuEl.setAttribute('aria-hidden', 'true');
  _actionHandlers.clear();
  _previousFocusEl = null;
  _openedByKeyboard = false;
  _keyboardFocusActive = false;
  _openedInsideLiveViewportId = null;
  _lastPointerX = null;
  _lastPointerY = null;

  releaseActiveToast();
}

function getCssZoomFactor(): number {
  if (typeof document === 'undefined' || !document.documentElement?.style) return 1;
  const parsed = parseFloat(document.documentElement.style.zoom || '1');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function positionMenu(menu: HTMLDivElement, clientX: number, clientY: number): void {
  const cssZoom = getCssZoomFactor();
  const vw = (typeof window !== 'undefined' ? window.innerWidth : 1280) / cssZoom;
  const vh = (typeof window !== 'undefined' ? window.innerHeight : 720) / cssZoom;
  const anchorX = clientX / cssZoom;
  const anchorY = clientY / cssZoom;

  const maxMenuWidth = Math.max(120, Math.round(Math.min(300, vw - VIEWPORT_PADDING * 2)));
  const maxMenuHeight = Math.max(80, Math.round(vh - VIEWPORT_PADDING * 2));
  menu.style.maxWidth = `${maxMenuWidth}px`;
  menu.style.maxHeight = `${maxMenuHeight}px`;

  menu.style.left = '0px';
  menu.style.top = '0px';

  const rect = typeof menu.getBoundingClientRect === 'function'
    ? menu.getBoundingClientRect()
    : { width: 210, height: 140 };
  const width = (menu.offsetWidth && menu.offsetWidth > 0)
    ? menu.offsetWidth
    : ((rect.width ? rect.width / cssZoom : 0) || 210);
  const height = (menu.offsetHeight && menu.offsetHeight > 0)
    ? menu.offsetHeight
    : ((rect.height ? rect.height / cssZoom : 0) || 140);

  const isRtl =
    (typeof document !== 'undefined' && document.documentElement?.getAttribute('dir') === 'rtl') ||
    isRtlLanguage(getLanguage());

  let x = isRtl ? anchorX - width : anchorX;
  let y = anchorY;

  if (x + width > vw - VIEWPORT_PADDING) {
    x = Math.max(VIEWPORT_PADDING, anchorX - width);
  }
  if (x < VIEWPORT_PADDING) {
    x = Math.min(vw - width - VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, anchorX));
  }
  if (y + height > vh - VIEWPORT_PADDING) {
    y = Math.max(VIEWPORT_PADDING, anchorY - height);
  }

  x = Math.max(VIEWPORT_PADDING, Math.min(x, Math.max(VIEWPORT_PADDING, vw - width - VIEWPORT_PADDING)));
  y = Math.max(VIEWPORT_PADDING, Math.min(y, Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING)));

  const originX: 'left' | 'right' = x + width * 0.5 < anchorX ? 'right' : 'left';
  const originY: 'top' | 'bottom' = y + height * 0.5 < anchorY ? 'bottom' : 'top';

  menu.style.transformOrigin = `${originY} ${originX}`;
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}

/** Populate and display the context menu at the requested viewport coordinates. */
export function openContextMenuAt(
  clientX: number,
  clientY: number,
  entries: ContextMenuEntry[],
  openedByKeyboard = false,
  contextTarget?: HTMLElement | null
): boolean {
  const normalized = normalizeMenuEntries(entries);
  if (normalized.length === 0) {
    closeContextMenu();
    return false;
  }

  const menu = ensureMenuElement();
  if (!menu) return false;

  const wasOpen = menu.classList.contains('open');
  const currentActive = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  if (!currentActive || typeof menu.contains !== 'function' || !menu.contains(currentActive)) {
    _previousFocusEl = currentActive;
  }
  _openedByKeyboard = openedByKeyboard;
  _keyboardFocusActive = openedByKeyboard;
  _lastPointerX = null;
  _lastPointerY = null;

  if (_activeToastEl && (!contextTarget || typeof _activeToastEl.contains !== 'function' || !_activeToastEl.contains(contextTarget))) {
    releaseActiveToast();
  }

  const liveViewport =
    contextTarget && typeof contextTarget.closest === 'function'
      ? (contextTarget.closest('#log-viewport, #transcript-viewport') as HTMLElement | null)
      : null;
  _openedInsideLiveViewportId = liveViewport?.id || null;

  const toastEl =
    contextTarget && typeof contextTarget.closest === 'function'
      ? (contextTarget.closest('.toast-notification') as ContextMenuToastElement | null)
      : null;
  if (toastEl && !toastEl.classList?.contains('hide')) {
    _activeToastEl = toastEl;
    if (toastEl.dataset) toastEl.dataset.contextMenuActive = 'true';
    toastEl._pauseForContextMenu?.();
  }

  _actionHandlers.clear();
  menu.replaceChildren();
  menu.setAttribute('aria-label', t('contextMenu.menuAria'));

  for (const entry of normalized) {
    if (entry.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'app-context-menu__separator';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      continue;
    }

    const { spec } = entry;
    _actionHandlers.set(spec.id, spec.onSelect);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = spec.danger ? 'app-context-menu__item app-context-menu__item--danger' : 'app-context-menu__item';
    btn.dataset.menuId = spec.id;
    btn.setAttribute('role', 'menuitem');
    if (spec.disabled) {
      btn.disabled = true;
    }

    btn.appendChild(createIconSvg(spec.icon));

    const labelSpan = document.createElement('span');
    labelSpan.className = 'app-context-menu__label';
    labelSpan.textContent = spec.label;
    btn.appendChild(labelSpan);

    if (spec.shortcutHint) {
      const hintSpan = document.createElement('span');
      hintSpan.className = 'app-context-menu__hint';
      hintSpan.textContent = spec.shortcutHint;
      btn.appendChild(hintSpan);
    }

    menu.appendChild(btn);
  }

  if (openedByKeyboard) {
    menu.classList.add('is-keyboard-nav');
  } else {
    menu.classList.remove('is-keyboard-nav');
  }

  if (wasOpen) {
    const prevTransition = menu.style.transition || '';
    menu.style.transition = 'none';
    menu.classList.remove('open');
    positionMenu(menu, clientX, clientY);
    void menu.offsetWidth;
    menu.style.transition = prevTransition;
  } else {
    positionMenu(menu, clientX, clientY);
    // Force layout flush so the entrance scale/opacity micro-transition plays on initial mount too
    void menu.offsetWidth;
  }
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');

  if (openedByKeyboard) {
    const firstBtn = menu.querySelector('.app-context-menu__item:not(:disabled)') as HTMLButtonElement | null;
    if (firstBtn) {
      focusMenuItem(firstBtn);
    }
  }

  return true;
}

function focusMenuItem(targetBtn: HTMLButtonElement): void {
  if (!_menuEl) return;
  _keyboardFocusActive = true;
  _menuEl.classList.add('is-keyboard-nav');
  clearFocusedItemClasses(_menuEl);
  targetBtn.classList.add('is-focused');
  targetBtn.focus?.({ preventScroll: true });
}

function moveMenuFocus(direction: 1 | -1 | 'first' | 'last'): void {
  if (!_menuEl) return;
  _keyboardFocusActive = true;
  _menuEl.classList.add('is-keyboard-nav');
  const items = Array.from(
    _menuEl.querySelectorAll('.app-context-menu__item:not(:disabled)')
  ) as HTMLButtonElement[];
  if (items.length === 0) return;

  let targetBtn: HTMLButtonElement;
  if (direction === 'first') {
    targetBtn = items[0];
  } else if (direction === 'last') {
    targetBtn = items[items.length - 1];
  } else {
    const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIdx =
      activeIdx === -1
        ? direction === 1 ? 0 : items.length - 1
        : (activeIdx + direction + items.length) % items.length;
    targetBtn = items[nextIdx];
  }
  focusMenuItem(targetBtn);
}

function jumpMenuFocusByChar(char: string): void {
  if (!_menuEl) return;
  const items = Array.from(
    _menuEl.querySelectorAll('.app-context-menu__item:not(:disabled)')
  ) as HTMLButtonElement[];
  if (items.length === 0) return;

  const needle = char.toLocaleLowerCase();
  const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
  for (let offset = 1; offset <= items.length; offset++) {
    const candidate = items[(activeIdx + offset + items.length) % items.length];
    const labelEl = typeof candidate.querySelector === 'function'
      ? candidate.querySelector('.app-context-menu__label')
      : null;
    const labelText = String(labelEl?.textContent ?? candidate.textContent ?? '').trim();
    if (labelText.toLocaleLowerCase().startsWith(needle)) {
      focusMenuItem(candidate);
      return;
    }
  }
}

function handleOpenMenuKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeContextMenu({ restoreFocus: true });
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    moveMenuFocus(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    moveMenuFocus(-1);
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    e.stopPropagation();
    moveMenuFocus('first');
    return;
  }
  if (e.key === 'End') {
    e.preventDefault();
    e.stopPropagation();
    moveMenuFocus('last');
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key === 'Tab') {
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const activeInsideMenu = Boolean(_menuEl && activeEl && typeof _menuEl.contains === 'function' && _menuEl.contains(activeEl));
    const hasMenuFocus = _openedByKeyboard || _keyboardFocusActive || activeInsideMenu;
    if (hasMenuFocus) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeContextMenu({ restoreFocus: hasMenuFocus });
    return;
  }
  if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    e.stopPropagation();
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const activeInsideMenu = Boolean(_menuEl && activeEl && typeof _menuEl.contains === 'function' && _menuEl.contains(activeEl));
    const activeBtn =
      activeInsideMenu &&
      activeEl !== _menuEl &&
      activeEl &&
      typeof activeEl.closest === 'function'
        ? (activeEl.closest('.app-context-menu__item') as HTMLButtonElement | null)
        : null;
    if (activeBtn && !activeBtn.disabled) {
      activeBtn.click();
      return;
    }
    closeContextMenu({ restoreFocus: _openedByKeyboard || _keyboardFocusActive || activeInsideMenu });
    return;
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key && e.key.length === 1) {
    e.preventDefault();
    e.stopPropagation();
    jumpMenuFocusByChar(e.key);
  }
}

/** Global `contextmenu` handler that routes editable inputs to OS menus and opens custom menus elsewhere. */
export function handleGlobalContextMenu(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;

  // Preserve specialized speed controls that bind their own right-click action
  if (isPreservedCustomContextTarget(target)) {
    e.preventDefault();
    closeContextMenu();
    return;
  }

  // Allow native OS Cut/Copy/Paste/Undo menu inside text inputs & textareas
  if (isNativeEditableTarget(target)) {
    closeContextMenu();
    return;
  }

  // Always suppress the raw browser context menu outside editable inputs
  e.preventDefault();

  const entries = resolveContextMenuEntries(target);
  if (entries.length === 0) {
    closeContextMenu();
    return;
  }

  openContextMenuAt(e.clientX, e.clientY, entries, false, target);
}

function resolveKeyboardShortcutContext(): { target: HTMLElement | null; selectionRect: DOMRect | null } {
  if (typeof document === 'undefined') return { target: null, selectionRect: null };
  const activeFallback = document.activeElement as HTMLElement | null;
  if (
    activeFallback &&
    activeFallback !== document.body &&
    activeFallback !== document.documentElement &&
    typeof activeFallback.closest === 'function'
  ) {
    return { target: activeFallback, selectionRect: null };
  }

  const selCtx = getActiveSelectionContext();
  if (selCtx.target) {
    return selCtx;
  }

  return { target: activeFallback, selectionRect: null };
}

/** Keyboard `ContextMenu` / `Shift+F10` handler supporting focused controls and active text selections. */
export function handleContextMenuShortcut(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const isContextKey = e.key === 'ContextMenu';
  const isShiftF10 = e.shiftKey && e.key === 'F10' && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!isContextKey && !isShiftF10) return;

  const rawTarget = e.target as HTMLElement | null;
  if (isPreservedCustomContextTarget(rawTarget) || isNativeEditableTarget(rawTarget)) {
    return;
  }

  const isGenericEventTarget =
    !rawTarget ||
    typeof rawTarget.closest !== 'function' ||
    rawTarget === document.body ||
    rawTarget === document.documentElement;

  const resolved = isGenericEventTarget
    ? resolveKeyboardShortcutContext()
    : { target: rawTarget, selectionRect: null };

  let target = resolved.target;
  let selectionRect = resolved.selectionRect;

  if (target && (isPreservedCustomContextTarget(target) || isNativeEditableTarget(target))) {
    return;
  }

  let entries = target ? resolveContextMenuEntries(target) : [];
  if (entries.length === 0) {
    const selCtx = getActiveSelectionContext();
    if (selCtx.target && !isPreservedCustomContextTarget(selCtx.target) && !isNativeEditableTarget(selCtx.target)) {
      const selEntries = resolveContextMenuEntries(selCtx.target);
      if (selEntries.length > 0) {
        target = selCtx.target;
        selectionRect = selCtx.selectionRect;
        entries = selEntries;
      }
    }
  }

  if (!target || entries.length === 0) return;

  e.preventDefault();
  e.stopPropagation();

  const isRtl =
    (typeof document !== 'undefined' && document.documentElement?.getAttribute('dir') === 'rtl') ||
    isRtlLanguage(getLanguage());

  const cssZoom = getCssZoomFactor();
  const vhPx = typeof window !== 'undefined' ? window.innerHeight : 720;
  let anchorX = 16 * cssZoom;
  let anchorY = 16 * cssZoom;

  const rect =
    selectionRect ||
    (typeof target.getBoundingClientRect === 'function' ? (target.getBoundingClientRect() as DOMRect) : null);

  if (rect && (rect.width > 0 || rect.height > 0)) {
    const clampedTop = Math.max(0, rect.top ?? 0);
    const clampedBottom = Math.min(vhPx, rect.bottom ?? rect.top ?? 0);
    anchorX = isRtl
      ? Math.max(8 * cssZoom, (rect.right ?? rect.left) - 8 * cssZoom)
      : Math.max(8 * cssZoom, rect.left + 8 * cssZoom);
    anchorY = clampedBottom > clampedTop + 8 * cssZoom
      ? Math.max(8 * cssZoom, clampedBottom - 4 * cssZoom)
      : Math.max(8 * cssZoom, clampedTop + 8 * cssZoom);
  }

  openContextMenuAt(anchorX, anchorY, entries, true, target);
}

/** Register global context menu, keyboard navigation, scroll, resize, and fullscreen listeners. */
export function setupContextMenu(): void {
  if (_isInitialized || typeof document === 'undefined') return;
  _isInitialized = true;

  document.addEventListener('contextmenu', handleGlobalContextMenu);

  document.addEventListener('pointerdown', (e: Event) => {
    if (!isContextMenuOpen()) return;
    const target = e.target as Node | null;
    if (_menuEl && target && _menuEl.contains(target)) return;
    closeContextMenu();
  }, true);

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isContextMenuOpen()) {
      handleContextMenuShortcut(e);
      return;
    }
    handleOpenMenuKeydown(e);
  }, true);

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => closeContextMenu());
    window.addEventListener('resize', () => closeContextMenu());
    window.addEventListener('whisper:languageChanged', () => closeContextMenu());
  }

  document.addEventListener('wheel', (e: Event) => {
    if (!isContextMenuOpen()) return;
    if (_menuEl && (e.target === _menuEl || (_menuEl.contains && _menuEl.contains(e.target as Node)))) {
      return;
    }
    closeContextMenu();
  }, { capture: true, passive: true });

  document.addEventListener('scroll', (e: Event) => {
    if (!isContextMenuOpen()) return;
    if (_menuEl && (e.target === _menuEl || (_menuEl.contains && _menuEl.contains(e.target as Node)))) {
      return;
    }
    const scrollTargetId = (e.target as HTMLElement | null)?.id || '';
    if (_openedInsideLiveViewportId && scrollTargetId === _openedInsideLiveViewportId) {
      return;
    }
    closeContextMenu();
  }, { capture: true, passive: true });

  document.addEventListener('fullscreenchange', () => {
    closeContextMenu();
    if (_menuEl) {
      const host = getMenuHostElement();
      if (host && _menuEl.parentNode !== host) {
        host.appendChild(_menuEl);
      }
    }
  });
}

/** Reset singleton module state between unit tests. */
export function _resetContextMenuForTest(): void {
  if (_activeToastEl) {
    if (_activeToastEl.dataset) delete _activeToastEl.dataset.contextMenuActive;
    _activeToastEl = null;
  }
  _actionHandlers.clear();
  _menuEl?.remove?.();
  _menuEl = null;
  _isInitialized = false;
  _previousFocusEl = null;
  _openedByKeyboard = false;
  _keyboardFocusActive = false;
  _openedInsideLiveViewportId = null;
  _lastPointerX = null;
  _lastPointerY = null;
}
