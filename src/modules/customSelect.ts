// Custom Accessible Dropdown Component for Whisper Desktop
import { t, isRtlLanguage, getLanguage, applyTextDirection } from '../i18n/index';
import { normalizeForSearch } from '../languages';

export interface CustomSelectOptions {
  observe?: boolean;
  [key: string]: any;
}

interface CachedOptionEntry {
  el: HTMLElement;
  searchText: string;
  labelText: string;
  valueText: string;
}

const SEARCH_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg>';

const CLEAR_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';

export const customSelectsMap = new Map<string | HTMLElement, CustomSelect>();
let customSelectInstanceCounter = 0;

export const safeRaf = (cb: () => void) => {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  if (typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(cb);
  } else if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(cb, 0);
  }
};

export const prefersReducedMotion = (): boolean => (
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

function translateText(key: string): string {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  const translate = typeof win.t === 'function' ? win.t : t;
  return translate(key);
}

export class CustomSelect {
  public select: HTMLSelectElement;
  public options: CustomSelectOptions;
  public instanceId: string;
  public container: HTMLElement | null = null;
  public trigger: HTMLElement | null = null;
  public optionsContainer: HTMLElement | null = null;
  public optionsList: HTMLElement | null = null;
  public isOpen = false;
  public focusedIndex = -1;
  public typeaheadBuffer = '';
  public typeaheadTimeout: any = null;
  public observer: MutationObserver | null = null;
  public searchable = false;
  public searchRow: HTMLElement | null = null;
  public searchInput: HTMLInputElement | null = null;
  public searchClearBtn: HTMLButtonElement | null = null;
  public noResultsRow: HTMLElement | null = null;

  private _triggerClickHandler: ((e: MouseEvent) => void) | null = null;
  private _triggerPointerEnterHandler: (() => void) | null = null;
  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _optionsClickHandler: ((e: MouseEvent) => void) | null = null;
  private _optionsPointerMoveHandler: ((e: PointerEvent) => void) | null = null;
  private _selectChangeHandler: (() => void) | null = null;
  private _searchInputHandler: (() => void) | null = null;
  private _searchKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _clearPointerDownHandler: ((e: PointerEvent) => void) | null = null;
  private _clearClickHandler: ((e: MouseEvent) => void) | null = null;
  private _documentPointerHandler: ((e: PointerEvent) => void) | null = null;
  private _globalEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private _scrollResizeHandler: ((e: Event) => void) | null = null;
  private _optionElementMap = new WeakMap<HTMLElement, HTMLOptionElement>();
  private _cachedOptionByEl = new WeakMap<HTMLElement, CachedOptionEntry>();
  private _cachedOptions: CachedOptionEntry[] = [];
  private _lastPointerX = -1;
  private _lastPointerY = -1;
  private _lockedOpenUpward: boolean | null = null;
  private _lockedDropdownWidth: number | null = null;
  private _openCleanupCancel: (() => void) | null = null;
  private _closeCleanupCancel: (() => void) | null = null;
  private _pendingOptionsRefresh: (() => void) | null = null;

  constructor(selectElement: HTMLSelectElement, options: CustomSelectOptions = {}) {
    this.select = selectElement;
    this.options = options || {};
    this.instanceId = this.select.id || `custom-select-auto-${++customSelectInstanceCounter}`;
    this.searchable = this.select.hasAttribute('data-searchable');
    this.init();
  }

  public init(): void {
    if (typeof document === 'undefined') return;
    const existingKey = this.select.id || this.select;
    if (customSelectsMap.has(existingKey)) {
      const existing = customSelectsMap.get(existingKey);
      if (existing && existing !== this) {
        existing.destroy();
      }
    }
    if (this.select.dataset) {
      this.select.dataset.customSelectInitialized = 'true';
    }

    this.select.style.display = 'none';

    this.container = document.createElement('div');
    this.container.className = 'custom-select-container';
    
    if (this.select.className) {
      const classesToAdd = this.select.className.split(/\s+/).filter(c => Boolean(c) && c !== 'select-control');
      if (classesToAdd.length > 0) {
        this.container.classList.add(...classesToAdd);
      }
    }
    this.container.id = `custom-select-${this.instanceId}`;
    
    this.container.style.width = this.select.style.width || '100%';
    if (this.select.style.minWidth) {
      this.container.style.minWidth = this.select.style.minWidth;
    }
    if (this.select.style.maxWidth) {
      this.container.style.maxWidth = this.select.style.maxWidth;
    }
    this.container.style.height = this.select.style.height || 'auto';
    this.container.style.margin = this.select.style.margin || '0';

    this.trigger = document.createElement('div');
    this.trigger.className = 'custom-select-trigger';
    this.trigger.tabIndex = 0;
    this.trigger.setAttribute('role', this.searchable ? 'button' : 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    const listboxId = this.searchable
      ? `options-list-for-${this.instanceId}`
      : `options-for-${this.instanceId}`;
    this.trigger.setAttribute('aria-controls', listboxId);
    const initialAriaLabel = this.select.getAttribute('aria-label');
    if (initialAriaLabel) {
      this.trigger.setAttribute('aria-label', initialAriaLabel);
    }

    this.trigger.innerHTML = `
      <span class="custom-select-value"></span>
      <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    this.container.appendChild(this.trigger);

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'custom-select-options';
    this.optionsContainer.setAttribute('role', this.searchable ? 'presentation' : 'listbox');
    this.optionsContainer.tabIndex = -1;
    this.optionsContainer.id = `options-for-${this.instanceId}`;
    this.optionsContainer.classList.add(`options-for-${this.instanceId}`);
    this.optionsContainer.dataset.selectId = this.instanceId;
    document.body.appendChild(this.optionsContainer);

    if (this.searchable) {
      this.initSearchElements(listboxId, initialAriaLabel);
    }

    if (this.select.parentNode) {
      this.select.parentNode.insertBefore(this.container, this.select.nextSibling);
    }

    this._triggerClickHandler = (e: MouseEvent) => {
      e.stopPropagation();
      if (this.select.disabled) return;
      this.toggle();
    };
    this.trigger.addEventListener('click', this._triggerClickHandler);

    this._triggerPointerEnterHandler = () => {
      this.updateTriggerTooltip();
    };
    this.trigger.addEventListener('pointerenter', this._triggerPointerEnterHandler);

    this._keydownHandler = (e: KeyboardEvent) => {
      if (this.select.disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
          this.optionsContainer?.classList.add('keyboard-nav');
        } else {
          const optDiv = this.getNavigableOptions()[this.focusedIndex];
          if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
            this.selectOption(optDiv);
          } else {
            this.close();
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
          this.optionsContainer?.classList.add('keyboard-nav');
        } else {
          this.optionsContainer?.classList.add('keyboard-nav');
          const nextIdx = this.getNextAvailableIndex(this.focusedIndex, 1);
          if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
          this.optionsContainer?.classList.add('keyboard-nav');
        } else {
          this.optionsContainer?.classList.add('keyboard-nav');
          const prevIdx = this.getNextAvailableIndex(this.focusedIndex, -1);
          if (prevIdx !== -1) this.setFocusedOptionIndex(prevIdx);
        }
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        if (this.isOpen) {
          e.preventDefault();
          this.moveFocusByPage(e.key === 'PageDown' ? 5 : -5);
        }
      } else if (e.key === 'Home') {
        if (this.isOpen) {
          e.preventDefault();
          this.optionsContainer?.classList.add('keyboard-nav');
          const firstIdx = this.getFirstAvailableIndex();
          if (firstIdx !== -1) this.setFocusedOptionIndex(firstIdx);
        }
      } else if (e.key === 'End') {
        if (this.isOpen) {
          e.preventDefault();
          this.optionsContainer?.classList.add('keyboard-nav');
          const lastIdx = this.getLastAvailableIndex();
          if (lastIdx !== -1) this.setFocusedOptionIndex(lastIdx);
        }
      } else if (e.key === 'Escape') {
        if (this.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          this.close();
        }
      } else if (e.key === 'Tab') {
        if (this.isOpen) {
          this.close();
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (this.isSearchable()) {
          return; // search input owns text entry in searchable mode
        }
        // WAI-ARIA Typeahead search with single-letter repeating cycle
        clearTimeout(this.typeaheadTimeout);
        const char = e.key.toLowerCase();
        const isRepeat = this.typeaheadBuffer.length === 1 && this.typeaheadBuffer === char;
        const options = this.getNavigableOptions();

        if (isRepeat) {
          const startFrom = (this.focusedIndex + 1) % options.length;
          let matchIdx = -1;
          for (let offset = 0; offset < options.length; offset++) {
            const idx = (startFrom + offset) % options.length;
            const opt = options[idx];
            if (!opt.classList.contains('disabled') && (opt.textContent || '').trim().toLowerCase().startsWith(char)) {
              matchIdx = idx;
              break;
            }
          }
          if (matchIdx !== -1) {
            if (!this.isOpen) this.open();
            this.optionsContainer?.classList.add('keyboard-nav');
            this.setFocusedOptionIndex(matchIdx);
          }
        } else {
          this.typeaheadBuffer += char;
          const matchIdx = options.findIndex(opt =>
            !opt.classList.contains('disabled') &&
            (opt.textContent || '').trim().toLowerCase().startsWith(this.typeaheadBuffer)
          );

          if (matchIdx !== -1) {
            if (!this.isOpen) {
              this.open();
            }
            this.optionsContainer?.classList.add('keyboard-nav');
            this.setFocusedOptionIndex(matchIdx);
          }
        }

        this.typeaheadTimeout = setTimeout(() => {
          this.typeaheadBuffer = '';
        }, 600);
      }
    };
    this.trigger.addEventListener('keydown', this._keydownHandler);

    this._documentPointerHandler = (e: PointerEvent) => {
      if (this.isOpen && this.container && this.optionsContainer) {
        const target = e.target as Node;
        if (!this.container.contains(target) && !this.optionsContainer.contains(target)) {
          this.close();
        }
      }
    };

    this._globalEscapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };

    this._scrollResizeHandler = (e: Event) => {
      if (this.isOpen) {
        if (e && e.type === 'scroll') {
          // If scrolling anywhere outside the optionsContainer itself, close the dropdown
          if (this.optionsContainer && !this.optionsContainer.contains(e.target as Node)) {
            this.close();
          }
        } else {
          this.updatePosition();
        }
      }
    };

    // Event delegation on optionsContainer for option selection and unified pointer focus
    this._optionsClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const optDiv = target.closest('.custom-select-option') as HTMLElement | null;
      if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
        e.stopPropagation();
        this.selectOption(optDiv);
      }
    };
    this.optionsContainer.addEventListener('click', this._optionsClickHandler);

    this._optionsPointerMoveHandler = (e: PointerEvent) => {
      if (!this.isOpen) return;
      const clientX = typeof e.clientX === 'number' ? e.clientX : -1;
      const clientY = typeof e.clientY === 'number' ? e.clientY : -1;
      if (clientX === this._lastPointerX && clientY === this._lastPointerY) return;
      this._lastPointerX = clientX;
      this._lastPointerY = clientY;
      this.optionsContainer?.classList.remove('keyboard-nav');

      const target = e.target as HTMLElement | null;
      const optDiv = target && typeof target.closest === 'function'
        ? (target.closest('.custom-select-option') as HTMLElement | null)
        : null;
      if (!optDiv || optDiv.classList.contains('disabled') || optDiv.classList.contains('hidden')) return;
      if (optDiv.classList.contains('focused')) return;
      const idx = this.getNavigableOptions().indexOf(optDiv);
      if (idx !== -1 && idx !== this.focusedIndex) {
        this.setFocusedOptionIndex(idx, false);
      }
    };
    this.optionsContainer.addEventListener('pointermove', this._optionsPointerMoveHandler as any);

    this.updateOptions();

    this._selectChangeHandler = () => {
      this.syncSelectedValue();
    };
    this.select.addEventListener('change', this._selectChangeHandler);

    // Avoid running heavy MutationObservers on table row selects and static controls
    const isRowSelect = this.select && this.select.classList.contains('model-reasoning-select');
    const isPaginationSelect = this.select && this.select.classList.contains('pagination-size-select');
    const shouldObserve = this.options.observe !== undefined 
      ? Boolean(this.options.observe)
      : (!isRowSelect && !isPaginationSelect);

    if (shouldObserve && typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => {
        if (this._pendingOptionsRefresh) {
          this.syncDisabledState();
          return;
        }
        this.updateOptions();
        this.syncDisabledState();
      });
      this.observer.observe(this.select, { childList: true, attributes: true, subtree: true });
    }

    this.syncDisabledState();

    // Register this instance globally for sync
    customSelectsMap.set(this.select.id || this.select, this);
    if (typeof window !== 'undefined' && (window as any).customSelectsMap) {
      (window as any).customSelectsMap.set(this.select.id || this.select, this);
    }
  }

  private initSearchElements(listboxId: string, initialAriaLabel: string | null): void {
    this.searchRow = document.createElement('div');
    this.searchRow.className = 'custom-select-search-row';

    const searchBox = document.createElement('div');
    searchBox.className = 'custom-select-search-box';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'custom-select-search-icon';
    searchIcon.setAttribute('aria-hidden', 'true');
    searchIcon.innerHTML = SEARCH_ICON_SVG;

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'custom-select-search';
    this.searchInput.autocomplete = 'off';
    this.searchInput.spellcheck = false;
    this.searchInput.setAttribute('role', 'combobox');
    this.searchInput.setAttribute('aria-autocomplete', 'list');
    this.searchInput.setAttribute('aria-controls', listboxId);
    this.searchInput.setAttribute('aria-expanded', 'false');

    this.searchClearBtn = document.createElement('button') as HTMLButtonElement;
    this.searchClearBtn.type = 'button';
    this.searchClearBtn.className = 'custom-select-search-clear hidden';
    this.searchClearBtn.tabIndex = -1;
    this.searchClearBtn.innerHTML = CLEAR_ICON_SVG;

    this.applySearchPlaceholder();
    if (typeof applyTextDirection === 'function') {
      applyTextDirection(this.searchInput);
    }

    this._searchInputHandler = () => {
      if (typeof applyTextDirection === 'function' && this.searchInput) {
        applyTextDirection(this.searchInput);
      }
      if (this.searchInput) {
        this.applyFilter(this.searchInput.value);
      }
    };
    this._searchKeydownHandler = (e: KeyboardEvent) => this.handleSearchKeydown(e);
    this.searchInput.addEventListener('input', this._searchInputHandler);
    this.searchInput.addEventListener('keydown', this._searchKeydownHandler);

    this._clearPointerDownHandler = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    this._clearClickHandler = (e: MouseEvent) => {
      e.stopPropagation();
      this.clearFilter();
      if (this.searchInput && typeof this.searchInput.focus === 'function') {
        this.searchInput.focus();
      }
    };
    this.searchClearBtn.addEventListener('pointerdown', this._clearPointerDownHandler as any);
    this.searchClearBtn.addEventListener('click', this._clearClickHandler);

    searchBox.appendChild(searchIcon);
    searchBox.appendChild(this.searchInput);
    searchBox.appendChild(this.searchClearBtn);
    this.searchRow.appendChild(searchBox);

    this.noResultsRow = document.createElement('div');
    this.noResultsRow.className = 'custom-select-no-results';
    this.noResultsRow.setAttribute('role', 'status');
    this.noResultsRow.setAttribute('aria-live', 'polite');

    this.optionsList = document.createElement('div');
    this.optionsList.className = 'custom-select-list';
    this.optionsList.id = listboxId;
    this.optionsList.setAttribute('role', 'listbox');
    if (initialAriaLabel) {
      this.optionsList.setAttribute('aria-label', initialAriaLabel);
    }
    this.syncSearchChromeDirection();
  }

  private getEffectiveUiDirection(): 'rtl' | 'ltr' {
    if (typeof document === 'undefined') return 'ltr';
    const isDocRtl = (typeof isRtlLanguage === 'function' && isRtlLanguage(getLanguage())) ||
                     document.documentElement.dir === 'rtl' ||
                     document.body.dir === 'rtl';
    return isDocRtl ? 'rtl' : 'ltr';
  }

  private syncSearchChromeDirection(): void {
    const uiDir = this.getEffectiveUiDirection();
    if (this.searchRow) {
      this.searchRow.setAttribute('dir', uiDir);
    }
    if (this.noResultsRow) {
      this.noResultsRow.setAttribute('dir', uiDir);
    }
  }

  private syncListTopPadding(): void {
    const listHost = (this.isSearchable() && this.optionsList) ? this.optionsList : this.optionsContainer;
    if (!listHost) return;
    let firstVisible: HTMLElement | null = null;
    for (let i = 0; i < listHost.children.length; i++) {
      const child = listHost.children[i] as HTMLElement;
      if (!child.classList.contains('hidden')) {
        firstVisible = child;
        break;
      }
    }
    listHost.classList.toggle(
      'starts-with-group',
      Boolean(firstVisible && firstVisible.classList.contains('custom-select-group-label'))
    );
  }

  private moveFocusByPage(delta: number): void {
    this.optionsContainer?.classList.add('keyboard-nav');
    const options = this.getNavigableOptions();
    if (options.length === 0) return;
    const baseIdx = this.focusedIndex >= 0 ? this.focusedIndex : 0;
    const targetIdx = Math.max(0, Math.min(options.length - 1, baseIdx + delta));
    this.setFocusedOptionIndex(targetIdx);
  }

  private syncAccessibleName(): void {
    if (!this.select || !this.trigger) return;
    const ariaLabel = this.select.getAttribute('aria-label');
    if (ariaLabel) {
      this.trigger.setAttribute('aria-label', ariaLabel);
      this.trigger.removeAttribute('aria-labelledby');
      if (this.optionsList) {
        this.optionsList.setAttribute('aria-label', ariaLabel);
        this.optionsList.removeAttribute('aria-labelledby');
      }
      return;
    }

    this.trigger.removeAttribute('aria-label');
    if (this.optionsList) this.optionsList.removeAttribute('aria-label');

    let labelId: string | null = null;
    if (this.select.id && typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const escapedId = this.select.id.replace(/["\\]/g, '\\$&');
      const labelEl = document.querySelector(`label[for="${escapedId}"]`) as HTMLElement | null;
      if (labelEl) {
        if (!labelEl.id) {
          labelEl.id = `label-for-${this.instanceId}`;
        }
        labelId = labelEl.id;
      }
    }

    if (labelId) {
      this.trigger.setAttribute('aria-labelledby', labelId);
      if (this.optionsList) this.optionsList.setAttribute('aria-labelledby', labelId);
    } else {
      this.trigger.removeAttribute('aria-labelledby');
      if (this.optionsList) this.optionsList.removeAttribute('aria-labelledby');
    }
  }

  private scheduleTransitionCleanup(
    containerEl: HTMLElement,
    onComplete: () => void,
    onCancelRegister: (cancel: (() => void) | null) => void,
    fallbackMs = 220
  ): void {
    if (prefersReducedMotion() || typeof containerEl.addEventListener !== 'function') {
      onComplete();
      return;
    }
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (done) return;
      done = true;
      if (timer !== null) clearTimeout(timer);
      containerEl.removeEventListener('transitionend', onEnd as any);
      onCancelRegister(null);
    };
    const onEnd = (e?: TransitionEvent) => {
      if (e && e.target !== containerEl) return;
      cleanup();
      onComplete();
    };
    onCancelRegister(cleanup);
    containerEl.addEventListener('transitionend', onEnd as any);
    timer = setTimeout(() => {
      cleanup();
      onComplete();
    }, fallbackMs);
  }

  public syncDisabledState(): void {
    if (!this.container || !this.trigger) return;
    const isDisabled = Boolean(this.select && this.select.disabled);
    if (isDisabled) {
      this.container.classList.add('disabled');
      this.trigger.setAttribute('aria-disabled', 'true');
      this.trigger.tabIndex = -1;
      if (this.isOpen) this.close();
    } else {
      this.container.classList.remove('disabled');
      this.trigger.removeAttribute('aria-disabled');
      this.trigger.tabIndex = 0;
    }
  }

  public getOptionDivs(): HTMLElement[] {
    if (!this.optionsContainer) return [];
    if (this._cachedOptions.length > 0) {
      return this._cachedOptions.map(entry => entry.el);
    }
    return Array.from(this.optionsContainer.querySelectorAll('.custom-select-option'));
  }

  public getNavigableOptions(): HTMLElement[] {
    return this.getOptionDivs().filter(el =>
      !el.classList.contains('disabled') && !el.classList.contains('hidden')
    );
  }

  public getNextAvailableIndex(fromIdx: number, direction = 1): number {
    const options = this.getNavigableOptions();
    const len = options.length;
    if (len === 0) return -1;
    const next = fromIdx + direction;
    if (next >= 0 && next < len) return next;
    return (fromIdx >= 0 && fromIdx < len) ? fromIdx : (direction > 0 ? 0 : len - 1);
  }

  public getFirstAvailableIndex(): number {
    const options = this.getNavigableOptions();
    return options.length > 0 ? 0 : -1;
  }

  public getLastAvailableIndex(): number {
    const options = this.getNavigableOptions();
    return options.length > 0 ? options.length - 1 : -1;
  }

  private getActiveDescendantHost(): HTMLElement | null {
    return this.isSearchable() && this.searchInput ? this.searchInput : this.trigger;
  }

  private scrollOptionIntoView(target: HTMLElement, center = false): void {
    const scrollHost = (this.isSearchable() && this.optionsList) ? this.optionsList : this.optionsContainer;
    if (!scrollHost) return;
    if (
      typeof scrollHost.scrollTop !== 'number' ||
      typeof scrollHost.clientHeight !== 'number' ||
      typeof target.offsetTop !== 'number' ||
      typeof target.offsetHeight !== 'number' ||
      scrollHost.clientHeight === 0
    ) {
      if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: center ? 'center' : 'nearest' });
      }
      return;
    }

    const rawTop = target.offsetTop;
    const isScrollHostOffsetParent = target.offsetParent === scrollHost || scrollHost === this.optionsContainer;
    const optTop = isScrollHostOffsetParent ? rawTop : Math.max(0, rawTop - (scrollHost.offsetTop || 0));
    const optBottom = optTop + target.offsetHeight;
    const viewTop = scrollHost.scrollTop;
    const viewBottom = viewTop + scrollHost.clientHeight;
    const stickyOffset = this.hasGroupLabels(scrollHost) ? 28 : 4;

    if (center) {
      scrollHost.scrollTop = Math.max(0, optTop - Math.floor((scrollHost.clientHeight - target.offsetHeight) / 2));
      return;
    }

    if (optTop - stickyOffset < viewTop) {
      scrollHost.scrollTop = Math.max(0, optTop - stickyOffset);
    } else if (optBottom + 4 > viewBottom) {
      scrollHost.scrollTop = optBottom + 4 - scrollHost.clientHeight;
    }
  }

  private hasGroupLabels(host: HTMLElement): boolean {
    for (let i = 0; i < host.children.length; i++) {
      const child = host.children[i] as HTMLElement;
      if (child.classList?.contains('custom-select-group-label') && !child.classList.contains('hidden')) {
        return true;
      }
    }
    return false;
  }

  public setFocusedOptionIndex(idx: number, shouldScroll = true, centerScroll = false): void {
    const options = this.getNavigableOptions();
    options.forEach(c => c.classList.remove('focused'));

    const activeHost = this.getActiveDescendantHost();
    const inactiveHost = activeHost === this.searchInput ? this.trigger : this.searchInput;
    if (inactiveHost) {
      inactiveHost.removeAttribute('aria-activedescendant');
    }

    if (idx >= 0 && idx < options.length) {
      this.focusedIndex = idx;
      const target = options[idx];
      target.classList.add('focused');
      if (target.id && activeHost) {
        activeHost.setAttribute('aria-activedescendant', target.id);
      }
      if (shouldScroll) {
        this.scrollOptionIntoView(target, centerScroll);
      }
    } else {
      this.focusedIndex = -1;
      if (activeHost) {
        activeHost.removeAttribute('aria-activedescendant');
      }
    }
  }

  public updateOptions(skipTooltip = false): void {
    if (!this.select || !this.optionsContainer || !this.container) return;
    this._pendingOptionsRefresh = null;
    const wasOpen = this.isOpen;
    this._cachedOptions = [];
    this._cachedOptionByEl = new WeakMap<HTMLElement, CachedOptionEntry>();
    const frag = document.createDocumentFragment();

    const isSearchable = this.isSearchable();
    let optionIdx = 0;
    const appendOption = (opt: HTMLOptionElement) => {
      if (opt.hidden || (opt.disabled && opt.value === '')) {
        return;
      }
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.id = `opt-${this.instanceId}-${optionIdx++}`;
      optDiv.setAttribute('role', 'option');
      optDiv.setAttribute('aria-selected', 'false');
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;
      this._optionElementMap.set(optDiv, opt);
      const searchData = opt.dataset.search || opt.getAttribute('data-search');
      if (searchData) {
        optDiv.dataset.search = searchData;
      }
      if (opt.disabled) {
        optDiv.classList.add('disabled');
        optDiv.setAttribute('aria-disabled', 'true');
      }
      if (isSearchable) {
        const labelText = normalizeForSearch(opt.textContent || '');
        const normalizedAlias = searchData ? normalizeForSearch(searchData) : '';
        const cachedEntry: CachedOptionEntry = {
          el: optDiv,
          labelText,
          valueText: normalizeForSearch(opt.value || ''),
          searchText: normalizedAlias ? `${labelText} ${normalizedAlias}` : labelText
        };
        this._cachedOptions.push(cachedEntry);
        this._cachedOptionByEl.set(optDiv, cachedEntry);
      } else {
        this._cachedOptions.push({ el: optDiv, labelText: '', valueText: '', searchText: '' });
      }
      frag.appendChild(optDiv);
    };
    const appendGroup = (group: HTMLOptGroupElement) => {
      const labelDiv = document.createElement('div');
      labelDiv.className = 'custom-select-group-label';
      labelDiv.textContent = group.label || '';
      labelDiv.setAttribute('role', 'presentation');
      frag.appendChild(labelDiv);
      Array.from(group.children).forEach((child) => {
        if (child.tagName === 'OPTION') appendOption(child as HTMLOptionElement);
      });
    };

    Array.from(this.select.children).forEach((child) => {
      if (child.tagName === 'OPTGROUP') appendGroup(child as HTMLOptGroupElement);
      else if (child.tagName === 'OPTION') appendOption(child as HTMLOptionElement);
    });

    if (this.isSearchable() && this.searchRow && this.optionsList && this.noResultsRow) {
      this.applySearchPlaceholder();
      this.noResultsRow.textContent = this.getNoResultsText();
      this.noResultsRow.classList.add('hidden');
      frag.appendChild(this.noResultsRow);
      this.optionsList.innerHTML = '';
      this.optionsList.appendChild(frag);
      if (this.searchRow.parentNode !== this.optionsContainer || this.optionsList.parentNode !== this.optionsContainer) {
        this.optionsContainer.innerHTML = '';
        this.optionsContainer.appendChild(this.searchRow);
        this.optionsContainer.appendChild(this.optionsList);
      }
      this.optionsContainer.classList.add('has-search');
      this.syncListTopPadding();
    } else {
      this.optionsContainer.classList.remove('has-search');
      this.optionsContainer.innerHTML = '';
      this.optionsContainer.appendChild(frag);
      this.syncListTopPadding();
    }

    // Modern Web Guidance: Detect technical/English dropdowns (e.g. model filenames, hardware devices)
    // and enforce strict LTR layout even in RTL mode so names like ggml-*.bin are left-aligned.
    const hasRtlChar = Array.from(this.select.options).some(opt => /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(opt.textContent || ''));
    if (!hasRtlChar && this.select.options.length > 0) {
      this.container.classList.add('custom-select-ltr');
      this.optionsContainer.classList.add('custom-select-ltr');
      this.container.setAttribute('dir', 'ltr');
      this.optionsContainer.setAttribute('dir', 'ltr');
    } else {
      this.container.classList.remove('custom-select-ltr');
      this.optionsContainer.classList.remove('custom-select-ltr');
      this.container.removeAttribute('dir');
      this.optionsContainer.removeAttribute('dir');
    }

    this.syncSelectedValue(skipTooltip);
    if (wasOpen) {
      if (this.isSearchable() && this.searchInput) {
        this.applyFilter(this.searchInput.value);
      } else {
        const navigable = this.getNavigableOptions();
        const selectedIdx = navigable.findIndex(c => c.classList.contains('selected'));
        this.setFocusedOptionIndex(selectedIdx !== -1 ? selectedIdx : this.getFirstAvailableIndex(), false);
      }
      this.updatePosition();
    }
    if (this.observer && typeof this.observer.takeRecords === 'function') {
      this.observer.takeRecords();
    }
  }

  public isModelSelect(): boolean {
    return Boolean(
      this.select.hasAttribute('data-model-select') ||
      (this.select.id && this.select.id.toLowerCase().includes('model'))
    );
  }

  public getSearchPlaceholder(): string {
    if (this.select.dataset.searchPlaceholderKey) {
      return translateText(this.select.dataset.searchPlaceholderKey);
    }
    if (this.select.dataset.searchPlaceholder) {
      return this.select.dataset.searchPlaceholder;
    }
    if (this.isModelSelect()) {
      return translateText('settings.searchModelsPlaceholder') || 'Search models by identifier...';
    }
    return translateText('common.searchLanguage') || 'Search…';
  }

  public getNoResultsText(): string {
    if (this.select.dataset.searchNoResultsKey) {
      return translateText(this.select.dataset.searchNoResultsKey);
    }
    if (this.select.dataset.searchNoResults) {
      return this.select.dataset.searchNoResults;
    }
    if (this.isModelSelect()) {
      return translateText('settings.noMatchingModels') || 'No Matching Models Found';
    }
    return translateText('languages.noResults') || 'No matching language';
  }

  public applySearchPlaceholder(): void {
    if (!this.searchInput) return;
    const placeholder = this.getSearchPlaceholder();
    this.searchInput.placeholder = placeholder;
    this.searchInput.setAttribute('aria-label', placeholder);
    if (this.searchClearBtn) {
      this.searchClearBtn.setAttribute('aria-label', translateText('common.clear') || 'Clear');
    }
    if (typeof applyTextDirection === 'function') {
      applyTextDirection(this.searchInput);
    }
    this.syncSearchChromeDirection();
  }

  public handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this.optionsContainer?.classList.add('keyboard-nav');
      if (this.getNavigableOptions().length === 0) return;
      const nextIdx = this.getNextAvailableIndex(this.focusedIndex, e.key === 'ArrowDown' ? 1 : -1);
      if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      e.stopPropagation();
      this.moveFocusByPage(e.key === 'PageDown' ? 5 : -5);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const options = this.getNavigableOptions();
      if (options.length === 0) return;
      const pickIdx = (this.focusedIndex >= 0 && this.focusedIndex < options.length) ? this.focusedIndex : 0;
      const optDiv = options[pickIdx];
      if (optDiv && optDiv.dataset.value !== undefined) {
        this.selectOption(optDiv);
      } else {
        this.close();
      }
      if (this.trigger && typeof this.trigger.focus === 'function') {
        this.trigger.focus();
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // keep the global close handler from firing on the clear step
      if (this.searchInput && this.searchInput.value) {
        this.clearFilter();
      } else {
        this.close();
        if (this.trigger && typeof this.trigger.focus === 'function') {
          this.trigger.focus();
        }
      }
    } else if (e.key === 'Tab') {
      if (e.shiftKey) {
        e.preventDefault();
      }
      this.close();
      if (this.trigger && typeof this.trigger.focus === 'function') {
        this.trigger.focus();
      }
    }
  }

  private pickBestMatchIndex(navigable: HTMLElement[], query: string, tokens?: string[]): number {
    if (navigable.length === 0) return -1;
    const activeTokens = tokens && tokens.length > 0 ? tokens : query.split(/\s+/).filter(Boolean);
    const getLabel = (el: HTMLElement) => this._cachedOptionByEl.get(el)?.labelText ?? normalizeForSearch(el.textContent || '');
    const getValue = (el: HTMLElement) => this._cachedOptionByEl.get(el)?.valueText ?? normalizeForSearch(el.dataset.value || '');
    const getSearch = (el: HTMLElement) => this._cachedOptionByEl.get(el)?.searchText ?? normalizeForSearch(`${el.textContent || ''} ${el.dataset.search || ''}`);
    const hasWordPrefix = (text: string) => {
      const words = text.split(/[\s()[\],.]+/).filter(Boolean);
      if (activeTokens.length > 1) {
        return activeTokens.every(tok => words.some(word => word.startsWith(tok)));
      }
      return words.some(word => word.startsWith(query));
    };

    const exactIdx = navigable.findIndex(el => getLabel(el) === query || getValue(el) === query);
    if (exactIdx !== -1) return exactIdx;

    const prefixIdx = navigable.findIndex(el => getLabel(el).startsWith(query));
    if (prefixIdx !== -1) return prefixIdx;

    const wordPrefixIdx = navigable.findIndex(el => hasWordPrefix(getLabel(el)));
    if (wordPrefixIdx !== -1) return wordPrefixIdx;

    const aliasWordPrefixIdx = navigable.findIndex(el => hasWordPrefix(getSearch(el)));
    return aliasWordPrefixIdx !== -1 ? aliasWordPrefixIdx : 0;
  }

  public applyFilter(rawQuery: string): void {
    if (!this.isSearchable() || !this.optionsContainer) return;
    const query = normalizeForSearch(rawQuery || '');
    const tokens = query ? query.split(/\s+/).filter(Boolean) : [];
    if (this.searchClearBtn) {
      this.searchClearBtn.classList.toggle('hidden', !rawQuery);
    }
    let visibleCount = 0;
    if (this._cachedOptions.length > 0) {
      this._cachedOptions.forEach(({ el, searchText }) => {
        const match = tokens.length === 0 || tokens.every(tok => searchText.includes(tok));
        el.classList.toggle('hidden', !match);
        if (match) visibleCount++;
      });
    } else {
      this.getOptionDivs().forEach((div) => {
        const normalized = normalizeForSearch(`${div.textContent || ''} ${div.dataset.search || ''}`);
        const match = tokens.length === 0 || tokens.every(tok => normalized.includes(tok));
        div.classList.toggle('hidden', !match);
        if (match) visibleCount++;
      });
    }
    // Collapse group headers whose section has no visible options left
    const groupHost = this.optionsList || this.optionsContainer;
    Array.from(groupHost.children).forEach((el) => {
      if (!el.classList.contains('custom-select-group-label')) return;
      let sib = el.nextElementSibling as HTMLElement | null;
      let hasVisible = false;
      while (sib && !sib.classList.contains('custom-select-group-label')) {
        if (sib.classList.contains('custom-select-option') && !sib.classList.contains('hidden')) {
          hasVisible = true;
          break;
        }
        sib = sib.nextElementSibling as HTMLElement | null;
      }
      el.classList.toggle('hidden', !hasVisible);
    });
    if (this.noResultsRow) {
      this.noResultsRow.textContent = this.getNoResultsText();
      this.noResultsRow.classList.toggle('hidden', visibleCount > 0);
    }
    this.syncListTopPadding();
    if (!this.isOpen || visibleCount === 0) {
      this.setFocusedOptionIndex(-1);
      return;
    }
    const navigable = this.getNavigableOptions();
    if (!query) {
      const selectedIdx = navigable.findIndex(c => c.classList.contains('selected'));
      this.setFocusedOptionIndex(selectedIdx !== -1 ? selectedIdx : 0, true, selectedIdx !== -1);
      return;
    }
    this.setFocusedOptionIndex(this.pickBestMatchIndex(navigable, query, tokens));
  }

  public clearFilter(): void {
    if (this.searchInput) {
      this.searchInput.value = '';
      if (typeof applyTextDirection === 'function') {
        applyTextDirection(this.searchInput);
      }
    }
    this.applyFilter('');
  }

  public isSearchable(): boolean {
    return Boolean(this.searchable && this.searchRow && this.searchInput && this.noResultsRow);
  }

  public getPlaceholder(): string {
    if (this.select.dataset.placeholderKey) {
      return translateText(this.select.dataset.placeholderKey);
    }
    if (this.select.dataset.placeholder) {
      return this.select.dataset.placeholder;
    }
    if (this.select.getAttribute('placeholder')) {
      return this.select.getAttribute('placeholder') || '';
    }
    return translateText('common.select') || 'Select...';
  }

  public updateTriggerTooltip(): void {
    if (!this.select || !this.trigger) return;
    const valEl = this.trigger.querySelector('.custom-select-value') as HTMLElement | null;
    const valText = valEl ? (valEl.textContent || '') : '';
    const allowTooltip = !this.select.hasAttribute('data-no-tooltip');
    const isTruncated = Boolean(valEl && valEl.clientWidth > 0 && valEl.scrollWidth > valEl.clientWidth);
    if (valEl) {
      if (allowTooltip && isTruncated) {
        valEl.title = valText;
      } else {
        valEl.removeAttribute('title');
      }
    }
    if (allowTooltip && isTruncated) {
      this.trigger.title = valText;
    } else {
      this.trigger.removeAttribute('title');
    }
  }

  public syncSelectedValue(skipTooltip = false): void {
    if (!this.select || !this.trigger || !this.optionsContainer) return;
    let selectedOpt = this.select.options ? this.select.options[this.select.selectedIndex] : null;
    if (!selectedOpt || selectedOpt.value !== this.select.value) {
      const opts = Array.from(this.select.options || []);
      const found = opts.find((o: any) => o.value === this.select.value);
      if (found) selectedOpt = found;
    }
    const valText = (selectedOpt && selectedOpt.textContent) ? selectedOpt.textContent : this.getPlaceholder();
    const valEl = this.trigger.querySelector('.custom-select-value') as HTMLElement | null;
    if (valEl) {
      valEl.textContent = valText;
    }
    if (!skipTooltip) {
      this.updateTriggerTooltip();
    } else {
      if (valEl) valEl.removeAttribute('title');
      this.trigger.removeAttribute('title');
    }
    this.syncAccessibleName();

    const optionDivs = this.getOptionDivs();
    let hasMarkedSelected = false;
    optionDivs.forEach((optDiv) => {
      const linkedOpt = this._optionElementMap.get(optDiv);
      const isSelected = !hasMarkedSelected && (
        selectedOpt && linkedOpt
          ? linkedOpt === selectedOpt
          : optDiv.dataset.value === this.select.value
      );
      if (isSelected) {
        hasMarkedSelected = true;
        optDiv.classList.add('selected');
        optDiv.setAttribute('aria-selected', 'true');
      } else {
        optDiv.classList.remove('selected');
        optDiv.setAttribute('aria-selected', 'false');
      }
    });
  }

  public updatePosition(): void {
    if (!this.isOpen || !this.trigger || !this.optionsContainer || typeof document === 'undefined') return;
    const rect = this.trigger.getBoundingClientRect();
    const cssZoom = parseFloat(document.documentElement.style.zoom || '1') || 1;
    const isReasoning = Boolean(this.select && this.select.classList.contains('model-reasoning-select'));
    const isPaginationSize = Boolean(this.select && this.select.classList.contains('pagination-size-select'));
    const lockTriggerWidth = isReasoning || this.select.dataset?.dropdownWidth === 'trigger';
    const dataMaxHeight = parseInt(this.select.dataset?.dropdownMaxHeight || '', 10);
    const maxHeight = Number.isFinite(dataMaxHeight) && dataMaxHeight > 0
      ? dataMaxHeight
      : (isReasoning ? 290 : (this.isSearchable() ? 340 : 240));
    const rawHeight = this.isSearchable() && this.searchRow && this.optionsList
      ? ((this.searchRow.offsetHeight || 0) + (this.optionsList.scrollHeight || 0))
      : (this.optionsContainer.scrollHeight || 0);
    const dropdownHeight = Math.min(rawHeight || 220, maxHeight);

    // Normalize coordinates for environments with CSS zoom
    const viewportHeight = window.innerHeight / cssZoom;
    const viewportWidth = window.innerWidth / cssZoom;
    const normalizedRect = {
      left: rect.left / cssZoom,
      right: rect.right / cssZoom,
      top: rect.top / cssZoom,
      bottom: rect.bottom / cssZoom,
      width: rect.width / cssZoom,
    };

    const spaceBelow = Math.max(0, viewportHeight - normalizedRect.bottom);
    const spaceAbove = Math.max(0, normalizedRect.top);

    // Strict pixel-perfect alignment with trigger box (no overhangs or size discrepancies)
    this.optionsContainer.style.position = 'fixed';
    this.optionsContainer.style.zIndex = 'var(--z-portal-dropdown, 1000010)';

    const triggerWidth = Math.round(normalizedRect.width);
    const dataMinWidth = parseInt(this.select.dataset?.dropdownMinWidth || '', 10);
    let minDropdownWidth = 118;
    if (lockTriggerWidth) {
      minDropdownWidth = triggerWidth;
    } else if (Number.isFinite(dataMinWidth) && dataMinWidth > 0) {
      minDropdownWidth = dataMinWidth;
    } else if (isPaginationSize) {
      minDropdownWidth = 70;
    }

    const targetWidth = Math.max(triggerWidth, minDropdownWidth);
    const viewportMaxWidth = Math.max(120, Math.round(viewportWidth - 16));
    const maxDropdownWidth = lockTriggerWidth
      ? targetWidth
      : Math.min(Math.max(targetWidth, 280), viewportMaxWidth);

    let effectiveWidth: number;
    if (lockTriggerWidth) {
      effectiveWidth = targetWidth;
      this.optionsContainer.style.width = `${effectiveWidth}px`;
      this.optionsContainer.style.minWidth = `${Math.min(effectiveWidth, maxDropdownWidth)}px`;
      this.optionsContainer.style.maxWidth = `${maxDropdownWidth}px`;
    } else if (this._lockedDropdownWidth !== null) {
      effectiveWidth = Math.min(Math.max(targetWidth, this._lockedDropdownWidth), viewportMaxWidth);
      this.optionsContainer.style.width = `${effectiveWidth}px`;
      this.optionsContainer.style.minWidth = `${Math.min(targetWidth, effectiveWidth)}px`;
      this.optionsContainer.style.maxWidth = `${maxDropdownWidth}px`;
    } else {
      this.optionsContainer.style.width = 'auto';
      this.optionsContainer.style.minWidth = `${Math.min(targetWidth, maxDropdownWidth)}px`;
      this.optionsContainer.style.maxWidth = `${maxDropdownWidth}px`;
      // Prefer layout offsetWidth so pre-open CSS transform (e.g. scale(0.985)) never shrinks measured width
      const rawOffsetWidth = this.optionsContainer.offsetWidth;
      const measuredWidth = (typeof rawOffsetWidth === 'number' && rawOffsetWidth > 0)
        ? rawOffsetWidth
        : ((this.optionsContainer.getBoundingClientRect().width / cssZoom) || targetWidth);
      effectiveWidth = Math.min(Math.max(targetWidth, Math.round(measuredWidth)), viewportMaxWidth);
      this._lockedDropdownWidth = effectiveWidth;
      this.optionsContainer.style.width = `${effectiveWidth}px`;
    }

    const isDocRtl = this.getEffectiveUiDirection() === 'rtl';

    // Check external ancestors only (skip this.container, which may carry dir="ltr" solely for technical option text)
    const externalHost = (this.container?.parentElement || this.container?.parentNode) as HTMLElement | null;
    const ancestorDir = externalHost && typeof externalHost.closest === 'function'
      ? externalHost.closest('[dir]')?.getAttribute('dir')
      : null;
    const isEffectiveRtl = ancestorDir ? ancestorDir === 'rtl' : isDocRtl;

    const leftPos = (isReasoning || !isEffectiveRtl)
      ? Math.round(normalizedRect.left)
      : Math.round(normalizedRect.right - effectiveWidth);
    const maxLeft = Math.max(8, viewportWidth - effectiveWidth - 8);
    this.optionsContainer.style.left = `${Math.max(8, Math.min(leftPos, maxLeft))}px`;
    this.optionsContainer.style.right = 'auto';

    const openUpward = this._lockedOpenUpward !== null
      ? this._lockedOpenUpward
      : (spaceBelow < dropdownHeight && spaceAbove > spaceBelow);
    this._lockedOpenUpward = openUpward;

    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const paddedSpace = Math.floor(availableSpace - 10);
    const clampedMaxHeight = paddedSpace >= 48
      ? Math.min(maxHeight, paddedSpace)
      : Math.min(maxHeight, Math.max(24, Math.floor(availableSpace - 4)));
    this.optionsContainer.style.maxHeight = `${clampedMaxHeight}px`;

    if (openUpward) {
      this.optionsContainer.dataset.placement = 'top';
      this.optionsContainer.style.top = 'auto';
      this.optionsContainer.style.bottom = `${viewportHeight - normalizedRect.top + 4}px`;
    } else {
      this.optionsContainer.dataset.placement = 'bottom';
      this.optionsContainer.style.bottom = 'auto';
      this.optionsContainer.style.top = `${normalizedRect.bottom + 4}px`;
    }

    if (!this.optionsContainer.classList.contains('open')) {
      // Commit pre-open placement transform (e.g. upward translateY(6px)) before .open triggers transition
      void this.optionsContainer.offsetHeight;
    }
  }

  public selectOption(optDiv: HTMLElement): void {
    if (!optDiv || optDiv.classList.contains('disabled') || optDiv.dataset.value === undefined) {
      return;
    }
    const newValue = optDiv.dataset.value;
    const oldValue = this.select.value;
    const hasChanged = oldValue !== newValue;
    const wasSearchable = this.isSearchable();

    // 1. Immediate visual and value synchronization (0ms feedback) when value changes
    if (hasChanged) {
      this.select.value = newValue;
      this.syncSelectedValue();
    }

    // 2. Immediately initiate closing sequence so the dropdown starts closing at 0ms
    this.close();
    if (wasSearchable && this.trigger && typeof this.trigger.focus === 'function') {
      this.trigger.focus();
    }

    // 3. Dispatch change event to consumers only if value actually changed (HTML select standard)
    if (hasChanged) {
      this.select.dispatchEvent(new Event('change'));
    }
  }

  public toggle(): void {
    if (this.select && this.select.disabled) return;
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public setPendingOptionsRefresh(fn: (() => void) | null): void {
    this._pendingOptionsRefresh = fn;
    if (fn && this.observer && typeof this.observer.takeRecords === 'function') {
      this.observer.takeRecords();
    }
  }

  public hasPendingOptionsRefresh(): boolean {
    return this._pendingOptionsRefresh !== null;
  }

  public flushPendingOptionsRefresh(): void {
    if (this._pendingOptionsRefresh) {
      const fn = this._pendingOptionsRefresh;
      this._pendingOptionsRefresh = null;
      fn();
    }
  }

  public syncTriggerLabelText(overrideText?: string): void {
    if (!this.select || !this.trigger) return;
    let valText = overrideText;
    if (valText === undefined) {
      let selectedOpt = this.select.options ? this.select.options[this.select.selectedIndex] : null;
      if (!selectedOpt || selectedOpt.value !== this.select.value) {
        const opts = Array.from(this.select.options || []);
        const found = opts.find((o: any) => o.value === this.select.value);
        if (found) selectedOpt = found;
      }
      valText = (selectedOpt && selectedOpt.textContent) ? selectedOpt.textContent : this.getPlaceholder();
    }
    const valEl = this.trigger.querySelector('.custom-select-value') as HTMLElement | null;
    if (valEl && valEl.textContent !== valText) {
      valEl.textContent = valText;
    }
    this.syncAccessibleName();
  }

  public open(): void {
    if ((this.select && this.select.disabled) || !this.optionsContainer || !this.trigger || !this.container) return;
    if (this.isOpen) return;
    this.flushPendingOptionsRefresh();
    if (customSelectsMap) {
      customSelectsMap.forEach(cs => {
        if (cs !== this && cs && typeof cs.close === 'function' && cs.isOpen) {
          cs.close();
        }
      });
    }

    if (this._openCleanupCancel) {
      this._openCleanupCancel();
      this._openCleanupCancel = null;
    }
    if (this._closeCleanupCancel) {
      this._closeCleanupCancel();
      this._closeCleanupCancel = null;
    }
    this._lockedOpenUpward = null;
    this._lockedDropdownWidth = null;
    this._lastPointerX = -1;
    this._lastPointerY = -1;

    // Reset any active search filter before measuring container height and focusing selected option
    if (this.isSearchable()) {
      this.clearFilter();
      if (typeof applyTextDirection === 'function' && this.searchInput) {
        applyTextDirection(this.searchInput);
      }
      this.syncSearchChromeDirection();
    }

    // 1. Promote to GPU compositing layer right before animation begins
    this.optionsContainer.style.willChange = 'transform, opacity';

    // 2. Position the container first while it's still closed
    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    if (this.isSearchable() && this.searchInput) {
      this.searchInput.setAttribute('aria-expanded', 'true');
    }
    this.updatePosition();

    // Attach document, window, scroll, and resize listeners only while open
    if (this._documentPointerHandler) {
      document.addEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.addEventListener('keydown', this._globalEscapeHandler, true);
    }
    if (this._scrollResizeHandler) {
      window.addEventListener('scroll', this._scrollResizeHandler, true);
      window.addEventListener('resize', this._scrollResizeHandler);
    }

    // Focus active or selected non-disabled option
    const options = this.getNavigableOptions();
    let selectedIdx = options.findIndex(c => c.classList.contains('selected') && !c.classList.contains('disabled'));
    if (selectedIdx === -1) {
      selectedIdx = this.getFirstAvailableIndex();
      const scrollHost = (this.isSearchable() && this.optionsList) ? this.optionsList : this.optionsContainer;
      if (scrollHost && typeof scrollHost.scrollTop === 'number') {
        scrollHost.scrollTop = 0;
      }
    }
    this.setFocusedOptionIndex(selectedIdx, true, true);

    // 3. Activate .open on next animation frame, then focus searchInput once visibility is visible
    safeRaf(() => {
      if (this.isOpen && this.container && this.optionsContainer) {
        const containerEl = this.optionsContainer;
        this.container.classList.add('open');
        containerEl.classList.add('open');
        if (this.isSearchable() && this.searchInput && typeof this.searchInput.focus === 'function') {
          this.searchInput.focus({ preventScroll: true });
        }
        // Release GPU layer lock once open transition completes so hovering never causes subpixel jitter
        this.scheduleTransitionCleanup(
          containerEl,
          () => {
            if (this.isOpen && this.optionsContainer === containerEl) {
              containerEl.style.willChange = 'auto';
            }
          },
          (cancel) => {
            this._openCleanupCancel = cancel;
          }
        );
      }
    });
  }

  public close(): void {
    if (!this.container || !this.optionsContainer || !this.trigger) return;
    if (this._openCleanupCancel) {
      this._openCleanupCancel();
      this._openCleanupCancel = null;
    }
    if (this._closeCleanupCancel) {
      this._closeCleanupCancel();
      this._closeCleanupCancel = null;
    }
    const wasOpen = this.isOpen;
    if (wasOpen && !prefersReducedMotion()) {
      this.optionsContainer.style.willChange = 'transform, opacity';
    }
    this.container.classList.remove('open');
    this.optionsContainer.classList.remove('open', 'keyboard-nav');
    this.isOpen = false;
    this._lockedOpenUpward = null;
    this._lockedDropdownWidth = null;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (this.searchInput) {
      this.searchInput.setAttribute('aria-expanded', 'false');
    }
    const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (activeEl && this.optionsContainer.contains(activeEl) && typeof activeEl.blur === 'function') {
      activeEl.blur();
    }
    this.setFocusedOptionIndex(-1, false);
    this.typeaheadBuffer = '';
    clearTimeout(this.typeaheadTimeout);

    // Detach document, window, scroll, and resize listeners immediately on close
    if (this._documentPointerHandler) {
      document.removeEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.removeEventListener('keydown', this._globalEscapeHandler, true);
    }
    if (this._scrollResizeHandler) {
      window.removeEventListener('scroll', this._scrollResizeHandler, true);
      window.removeEventListener('resize', this._scrollResizeHandler);
    }

    const finalizeCloseVisuals = () => {
      if (this.isOpen || !this.optionsContainer) return;
      this.optionsContainer.style.willChange = 'auto';
      this.optionsContainer.style.width = '';
      if (this.isSearchable()) {
        this.clearFilter();
      }
      this.flushPendingOptionsRefresh();
    };

    if (wasOpen) {
      this.scheduleTransitionCleanup(
        this.optionsContainer,
        finalizeCloseVisuals,
        (cancel) => {
          this._closeCleanupCancel = cancel;
        }
      );
    } else {
      finalizeCloseVisuals();
    }
  }

  public destroy(): void {
    clearTimeout(this.typeaheadTimeout);
    this._pendingOptionsRefresh = null;
    this.isOpen = false;
    this._lockedOpenUpward = null;
    this._lockedDropdownWidth = null;
    if (this._openCleanupCancel) {
      this._openCleanupCancel();
      this._openCleanupCancel = null;
    }
    if (this._closeCleanupCancel) {
      this._closeCleanupCancel();
      this._closeCleanupCancel = null;
    }
    if (this.trigger) {
      if (this._triggerClickHandler) this.trigger.removeEventListener('click', this._triggerClickHandler);
      if (this._triggerPointerEnterHandler) this.trigger.removeEventListener('pointerenter', this._triggerPointerEnterHandler);
      if (this._keydownHandler) this.trigger.removeEventListener('keydown', this._keydownHandler);
    }
    if (this.optionsContainer) {
      if (this._optionsClickHandler) this.optionsContainer.removeEventListener('click', this._optionsClickHandler);
      if (this._optionsPointerMoveHandler) {
        this.optionsContainer.removeEventListener('pointermove', this._optionsPointerMoveHandler as any);
      }
    }
    if (this.searchInput) {
      if (this._searchInputHandler) this.searchInput.removeEventListener('input', this._searchInputHandler);
      if (this._searchKeydownHandler) this.searchInput.removeEventListener('keydown', this._searchKeydownHandler);
    }
    if (this.searchClearBtn) {
      if (this._clearPointerDownHandler) this.searchClearBtn.removeEventListener('pointerdown', this._clearPointerDownHandler as any);
      if (this._clearClickHandler) this.searchClearBtn.removeEventListener('click', this._clearClickHandler);
    }
    if (this.select && this._selectChangeHandler) {
      this.select.removeEventListener('change', this._selectChangeHandler);
    }
    if (this._documentPointerHandler) {
      document.removeEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.removeEventListener('keydown', this._globalEscapeHandler, true);
    }
    if (this._scrollResizeHandler) {
      window.removeEventListener('scroll', this._scrollResizeHandler, true);
      window.removeEventListener('resize', this._scrollResizeHandler);
    }
    if (this.optionsContainer && this.optionsContainer.parentNode) {
      this.optionsContainer.parentNode.removeChild(this.optionsContainer);
    }
    this._cachedOptions = [];
    this.optionsList = null;
    this.searchRow = null;
    this.searchInput = null;
    this.searchClearBtn = null;
    this.noResultsRow = null;
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.select?.dataset?.customSelectInitialized) {
      delete this.select.dataset.customSelectInitialized;
    }
    if (this.select) {
      this.select.style.display = '';
    }
    customSelectsMap.delete(this.select.id || this.select);
    if (typeof window !== 'undefined' && (window as any).customSelectsMap) {
      (window as any).customSelectsMap.delete(this.select.id || this.select);
    }
  }
}

export function initializeCustomSelects(): void {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('select.select-control, select#batch-sort-select').forEach(select => {
    const sel = select as HTMLSelectElement;
    if (sel.style.display === 'none') return; // leave hidden data-binder stubs unwrapped
    if (sel.classList.contains('model-reasoning-select')) return; // handled by table pagination renderer
    if (!sel.dataset.customSelectInitialized) {
      new CustomSelect(sel);
      sel.dataset.customSelectInitialized = 'true';
    }
  });
}

let scheduledOptionsRefreshGen = 0;

export function cancelScheduledCustomSelectsRefresh(): void {
  scheduledOptionsRefreshGen++;
  if (customSelectsMap) {
    customSelectsMap.forEach(cs => {
      if (typeof cs.setPendingOptionsRefresh === 'function') {
        cs.setPendingOptionsRefresh(null);
      }
    });
  }
}

function isExcludedFromBatchRefresh(cs: CustomSelect, excludeLanguageSelects: boolean): boolean {
  return Boolean(
    excludeLanguageSelects &&
      (cs.select?.hasAttribute?.('data-language-select') ||
        cs.select?.classList?.contains?.('model-reasoning-select'))
  );
}

export function syncCustomSelects(updateOptions = false, excludeLanguageSelects = false): void {
  if (customSelectsMap) {
    customSelectsMap.forEach(cs => {
      if (isExcludedFromBatchRefresh(cs, excludeLanguageSelects)) {
        return;
      }
      if (updateOptions) {
        cs.updateOptions(true);
      } else {
        cs.syncSelectedValue(true);
      }
    });
  }
}

export function prepareCustomSelectsOptionsRefresh(excludeLanguageSelects = true): void {
  cancelScheduledCustomSelectsRefresh();
  if (!customSelectsMap || customSelectsMap.size === 0) return;

  customSelectsMap.forEach(cs => {
    if (isExcludedFromBatchRefresh(cs, excludeLanguageSelects)) {
      return;
    }
    cs.setPendingOptionsRefresh(() => {
      cs.updateOptions(true);
    });
  });
}

export function flushPreparedCustomSelectsOptionsRefresh(excludeLanguageSelects = true, batchSize = 6): void {
  if (!customSelectsMap || customSelectsMap.size === 0) return;

  const gen = scheduledOptionsRefreshGen;
  const queue: CustomSelect[] = [];
  customSelectsMap.forEach(cs => {
    if (isExcludedFromBatchRefresh(cs, excludeLanguageSelects)) {
      return;
    }
    if (typeof cs.hasPendingOptionsRefresh === 'function' ? cs.hasPendingOptionsRefresh() : Boolean((cs as any)._pendingOptionsRefresh)) {
      queue.push(cs);
    }
  });

  if (queue.length === 0) return;

  let cursor = 0;
  const processChunk = () => {
    if (gen !== scheduledOptionsRefreshGen) return;
    const end = Math.min(queue.length, cursor + batchSize);
    for (; cursor < end; cursor++) {
      const cs = queue[cursor];
      if (!cs.isOpen && cs.select?.isConnected !== false) {
        cs.flushPendingOptionsRefresh();
      }
    }
    if (cursor < queue.length && gen === scheduledOptionsRefreshGen) {
      safeRaf(processChunk);
    }
  };

  safeRaf(processChunk);
}

export function scheduleCustomSelectsOptionsRefresh(excludeLanguageSelects = true, batchSize = 6): void {
  prepareCustomSelectsOptionsRefresh(excludeLanguageSelects);
  flushPreparedCustomSelectsOptionsRefresh(excludeLanguageSelects, batchSize);
}

// Bind to window for global backwards-compatibility and inline HTML handlers
if (typeof window !== 'undefined') {
  (window as any).CustomSelect = CustomSelect;
  (window as any).customSelectsMap = customSelectsMap;
  (window as any).initializeCustomSelects = initializeCustomSelects;
  (window as any).syncCustomSelects = syncCustomSelects;
  (window as any).prepareCustomSelectsOptionsRefresh = prepareCustomSelectsOptionsRefresh;
  (window as any).flushPreparedCustomSelectsOptionsRefresh = flushPreparedCustomSelectsOptionsRefresh;
  (window as any).scheduleCustomSelectsOptionsRefresh = scheduleCustomSelectsOptionsRefresh;
  (window as any).cancelScheduledCustomSelectsRefresh = cancelScheduledCustomSelectsRefresh;
}

export const customSelect = {
  CustomSelect,
  map: customSelectsMap,
  initAll: initializeCustomSelects,
  syncAll: syncCustomSelects,
  prepareOptionsRefresh: prepareCustomSelectsOptionsRefresh,
  flushPreparedOptionsRefresh: flushPreparedCustomSelectsOptionsRefresh,
  scheduleOptionsRefresh: scheduleCustomSelectsOptionsRefresh,
  cancelScheduledOptionsRefresh: cancelScheduledCustomSelectsRefresh
};
