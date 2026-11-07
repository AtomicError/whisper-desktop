// Custom Accessible Dropdown Component for Whisper Desktop
import { t, isRtlLanguage, getLanguage, applyTextDirection } from '../i18n/index';
import { normalizeForSearch } from '../languages';

export interface CustomSelectOptions {
  observe?: boolean;
  [key: string]: any;
}

export const customSelectsMap = new Map<string | HTMLElement, CustomSelect>();
let customSelectInstanceCounter = 0;

const safeRaf = (cb: () => void) => {
  const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
  if (typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(cb);
  } else if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(cb, 0);
  }
};

export class CustomSelect {
  public select: HTMLSelectElement;
  public options: CustomSelectOptions;
  public instanceId: string;
  public container: HTMLElement | null = null;
  public trigger: HTMLElement | null = null;
  public optionsContainer: HTMLElement | null = null;
  public isOpen = false;
  public focusedIndex = -1;
  public typeaheadBuffer = '';
  public typeaheadTimeout: any = null;
  public observer: MutationObserver | null = null;
  public searchable = false;
  public searchRow: HTMLElement | null = null;
  public searchInput: HTMLInputElement | null = null;
  public noResultsRow: HTMLElement | null = null;

  private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private _documentPointerHandler: ((e: PointerEvent) => void) | null = null;
  private _globalEscapeHandler: ((e: KeyboardEvent) => void) | null = null;
  private _scrollResizeHandler: ((e: Event) => void) | null = null;

  constructor(selectElement: HTMLSelectElement, options: CustomSelectOptions = {}) {
    this.select = selectElement;
    this.options = options || {};
    this.instanceId = this.select.id || `custom-select-auto-${++customSelectInstanceCounter}`;
    this.searchable = this.select.hasAttribute('data-searchable');
    this.init();
  }

  public init(): void {
    if (typeof document === 'undefined') return;

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
    this.trigger.setAttribute('role', 'combobox');
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', `options-for-${this.instanceId}`);
    const initialAriaLabel = this.select.getAttribute('aria-label');
    if (initialAriaLabel) {
      this.trigger.setAttribute('aria-label', initialAriaLabel);
    }

    this.trigger.innerHTML = `
      <span class="custom-select-value"></span>
      <svg class="custom-select-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    this.container.appendChild(this.trigger);

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'custom-select-options';
    this.optionsContainer.setAttribute('role', 'listbox');
    this.optionsContainer.tabIndex = -1;
    this.optionsContainer.id = `options-for-${this.instanceId}`;
    this.optionsContainer.classList.add(`options-for-${this.instanceId}`);
    this.optionsContainer.dataset.selectId = this.instanceId;
    document.body.appendChild(this.optionsContainer);

    if (this.searchable) {
      this.searchRow = document.createElement('div');
      this.searchRow.className = 'custom-select-search-row';
      this.searchInput = document.createElement('input');
      this.searchInput.type = 'text';
      this.searchInput.className = 'custom-select-search';
      this.searchInput.autocomplete = 'off';
      this.searchInput.spellcheck = false;
      this.searchInput.setAttribute('role', 'searchbox');
      this.applySearchPlaceholder();
      if (typeof applyTextDirection === 'function') {
        applyTextDirection(this.searchInput);
      }
      this.searchInput.addEventListener('input', () => {
        if (typeof applyTextDirection === 'function' && this.searchInput) {
          applyTextDirection(this.searchInput);
        }
        if (this.searchInput) {
          this.applyFilter(this.searchInput.value);
        }
      });
      this.searchInput.addEventListener('keydown', (e: KeyboardEvent) => this.handleSearchKeydown(e));
      this.searchRow.appendChild(this.searchInput);

      this.noResultsRow = document.createElement('div');
      this.noResultsRow.className = 'custom-select-no-results';
      this.noResultsRow.setAttribute('role', 'presentation');
    }

    if (this.select.parentNode) {
      this.select.parentNode.insertBefore(this.container, this.select.nextSibling);
    }

    this.trigger.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (this.select.disabled) return;
      this.toggle();
    });

    this._keydownHandler = (e: KeyboardEvent) => {
      if (this.select.disabled) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const optDiv = this.getNavigableOptions()[this.focusedIndex];
          if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
            this.select.value = optDiv.dataset.value;
            this.select.dispatchEvent(new Event('change'));
          }
          this.close();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const nextIdx = this.getNextAvailableIndex(this.focusedIndex, 1);
          if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.isOpen) {
          this.open();
        } else {
          const prevIdx = this.getNextAvailableIndex(this.focusedIndex, -1);
          if (prevIdx !== -1) this.setFocusedOptionIndex(prevIdx);
        }
      } else if (e.key === 'Home') {
        if (this.isOpen) {
          e.preventDefault();
          const firstIdx = this.getFirstAvailableIndex();
          if (firstIdx !== -1) this.setFocusedOptionIndex(firstIdx);
        }
      } else if (e.key === 'End') {
        if (this.isOpen) {
          e.preventDefault();
          const lastIdx = this.getLastAvailableIndex();
          if (lastIdx !== -1) this.setFocusedOptionIndex(lastIdx);
        }
      } else if (e.key === 'Escape') {
        if (this.isOpen) {
          e.preventDefault();
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

    // Event delegation on optionsContainer for efficient option selection
    this.optionsContainer.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const optDiv = target.closest('.custom-select-option') as HTMLElement | null;
      if (optDiv && optDiv.dataset.value !== undefined && !optDiv.classList.contains('disabled')) {
        e.stopPropagation();
        this.select.value = optDiv.dataset.value;
        this.select.dispatchEvent(new Event('change'));
        this.close();
      }
    });

    this.updateOptions();

    this.select.addEventListener('change', () => {
      this.syncSelectedValue();
    });

    // Avoid running heavy MutationObservers on table row selects and static controls
    const isRowSelect = this.select && this.select.classList.contains('model-reasoning-select');
    const isPaginationSelect = this.select && this.select.classList.contains('pagination-size-select');
    const shouldObserve = this.options.observe !== undefined 
      ? Boolean(this.options.observe)
      : (!isRowSelect && !isPaginationSelect);

    if (shouldObserve && typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => {
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

  public setFocusedOptionIndex(idx: number): void {
    const options = this.getNavigableOptions();
    options.forEach(c => c.classList.remove('focused'));

    if (idx >= 0 && idx < options.length) {
      this.focusedIndex = idx;
      const target = options[idx];
      target.classList.add('focused');
      if (target.id && this.trigger) {
        this.trigger.setAttribute('aria-activedescendant', target.id);
      }
      target.scrollIntoView({ block: 'nearest' });
    } else {
      this.focusedIndex = -1;
      if (this.trigger) {
        this.trigger.removeAttribute('aria-activedescendant');
      }
    }
  }

  public updateOptions(): void {
    if (!this.select || !this.optionsContainer || !this.container) return;
    this.optionsContainer.innerHTML = '';
    const frag = document.createDocumentFragment();

    if (this.isSearchable() && this.searchRow) {
      this.applySearchPlaceholder();
      frag.appendChild(this.searchRow);
    }

    let optionIdx = 0;
    const appendOption = (opt: HTMLOptionElement) => {
      if (opt.hidden || (opt.disabled && opt.value === '')) {
        return;
      }
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      optDiv.id = `opt-${this.instanceId}-${optionIdx++}`;
      optDiv.setAttribute('role', 'option');
      optDiv.setAttribute('aria-selected', opt.value === this.select.value ? 'true' : 'false');
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;
      const searchData = opt.dataset.search || opt.getAttribute('data-search');
      if (searchData) {
        optDiv.dataset.search = searchData;
      }
      if (opt.disabled) {
        optDiv.classList.add('disabled');
        optDiv.setAttribute('aria-disabled', 'true');
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

    if (this.isSearchable() && this.noResultsRow) {
      this.noResultsRow.textContent = this.getNoResultsText();
      this.noResultsRow.classList.add('hidden');
      frag.appendChild(this.noResultsRow);
      this.optionsContainer.classList.add('has-search');
    } else {
      this.optionsContainer.classList.remove('has-search');
    }

    this.optionsContainer.appendChild(frag);

    // Modern Web Guidance: Detect technical/English dropdowns (e.g. model filenames, hardware devices)
    // and enforce strict LTR layout even in RTL mode so names like ggml-*.bin are left-aligned.
    const hasRtlChar = Array.from(this.select.options).some(opt => /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(opt.textContent || ''));
    if (!hasRtlChar && this.select.options.length > 0) {
      this.container.classList.add('custom-select-ltr');
      this.optionsContainer.classList.add('custom-select-ltr');
    } else {
      this.container.classList.remove('custom-select-ltr');
      this.optionsContainer.classList.remove('custom-select-ltr');
    }

    this.syncSelectedValue();
  }

  public isModelSelect(): boolean {
    return Boolean(
      this.select.hasAttribute('data-model-select') ||
      (this.select.id && this.select.id.toLowerCase().includes('model'))
    );
  }

  public getSearchPlaceholder(): string {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    const translate = typeof win.t === 'function' ? win.t : t;
    if (this.select.dataset.searchPlaceholderKey) {
      return translate(this.select.dataset.searchPlaceholderKey);
    }
    if (this.select.dataset.searchPlaceholder) {
      return this.select.dataset.searchPlaceholder;
    }
    if (this.isModelSelect()) {
      return translate('settings.searchModelsPlaceholder') || 'Search models by identifier...';
    }
    return translate('common.searchLanguage') || 'Search…';
  }

  public getNoResultsText(): string {
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    const translate = typeof win.t === 'function' ? win.t : t;
    if (this.select.dataset.searchNoResultsKey) {
      return translate(this.select.dataset.searchNoResultsKey);
    }
    if (this.select.dataset.searchNoResults) {
      return this.select.dataset.searchNoResults;
    }
    if (this.isModelSelect()) {
      return translate('settings.noMatchingModels') || 'No Matching Models Found';
    }
    return translate('languages.noResults') || 'No matching language';
  }

  public applySearchPlaceholder(): void {
    if (!this.searchInput) return;
    const placeholder = this.getSearchPlaceholder();
    this.searchInput.placeholder = placeholder;
    this.searchInput.setAttribute('aria-label', placeholder);
    if (typeof applyTextDirection === 'function') {
      applyTextDirection(this.searchInput);
    }
  }

  public handleSearchKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (this.getNavigableOptions().length === 0) return;
      const nextIdx = this.getNextAvailableIndex(this.focusedIndex, e.key === 'ArrowDown' ? 1 : -1);
      if (nextIdx !== -1) this.setFocusedOptionIndex(nextIdx);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const options = this.getNavigableOptions();
      if (options.length === 0) return;
      const pickIdx = (this.focusedIndex >= 0 && this.focusedIndex < options.length) ? this.focusedIndex : 0;
      const optDiv = options[pickIdx];
      if (optDiv && optDiv.dataset.value !== undefined) {
        this.select.value = optDiv.dataset.value;
        this.select.dispatchEvent(new Event('change'));
      }
      this.close();
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // keep the global close handler from firing on the clear step
      if (this.searchInput && this.searchInput.value) {
        this.searchInput.value = '';
        this.applyFilter('');
      } else {
        this.close();
      }
    } else if (e.key === 'Tab') {
      this.close();
    }
  }

  public applyFilter(rawQuery: string): void {
    if (!this.isSearchable() || !this.optionsContainer) return;
    const query = normalizeForSearch(rawQuery || '');
    let visibleCount = 0;
    this.getOptionDivs().forEach((div) => {
      const haystack = div.dataset.search !== undefined ? div.dataset.search : (div.textContent || '');
      const match = !query || normalizeForSearch(haystack).includes(query);
      div.classList.toggle('hidden', !match);
      if (match) visibleCount++;
    });
    // Collapse group headers whose section has no visible options left
    Array.from(this.optionsContainer.children).forEach((el) => {
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
    this.setFocusedOptionIndex(visibleCount > 0 && this.isOpen ? 0 : -1);
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
    const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
    const translate = typeof win.t === 'function' ? win.t : t;
    if (this.select.dataset.placeholderKey) {
      return translate(this.select.dataset.placeholderKey);
    }
    if (this.select.dataset.placeholder) {
      return this.select.dataset.placeholder;
    }
    if (this.select.getAttribute('placeholder')) {
      return this.select.getAttribute('placeholder') || '';
    }
    return translate('common.select') || 'Select...';
  }

  public syncSelectedValue(): void {
    if (!this.select || !this.trigger || !this.optionsContainer) return;
    let selectedOpt = this.select.options ? this.select.options[this.select.selectedIndex] : null;
    if (!selectedOpt || selectedOpt.value !== this.select.value) {
      const opts = Array.from(this.select.options || []);
      const found = opts.find((o: any) => o.value === this.select.value);
      if (found) selectedOpt = found;
    }
    const valText = (selectedOpt && selectedOpt.textContent) ? selectedOpt.textContent : this.getPlaceholder();
    const valEl = this.trigger.querySelector('.custom-select-value') as HTMLElement | null;
    const allowTooltip = !this.select.hasAttribute('data-no-tooltip');
    const isTruncated = Boolean(valEl && valEl.scrollWidth > valEl.clientWidth);
    if (valEl) {
      valEl.textContent = valText;
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

    const currentAriaLabel = this.select.getAttribute('aria-label');
    if (currentAriaLabel) {
      this.trigger.setAttribute('aria-label', currentAriaLabel);
    } else {
      this.trigger.removeAttribute('aria-label');
    }

    if (this.optionsContainer.children) {
      Array.from(this.optionsContainer.children).forEach((child: any) => {
        const isSelected = child.dataset && child.dataset.value === this.select.value;
        if (isSelected) {
          child.classList.add('selected');
          child.setAttribute('aria-selected', 'true');
        } else {
          child.classList.remove('selected');
          child.setAttribute('aria-selected', 'false');
        }
      });
    }
  }

  public updatePosition(): void {
    if (!this.isOpen || !this.trigger || !this.optionsContainer || typeof document === 'undefined') return;
    const rect = this.trigger.getBoundingClientRect();
    const cssZoom = parseFloat(document.documentElement.style.zoom || '1') || 1;
    const maxHeight = this.isSearchable() ? 340 : 240;
    const dropdownHeight = Math.min(this.optionsContainer.scrollHeight || 220, maxHeight);

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

    const spaceBelow = viewportHeight - normalizedRect.bottom;
    const spaceAbove = normalizedRect.top;

    // Strict pixel-perfect alignment with trigger box (no overhangs or size discrepancies)
    this.optionsContainer.style.position = 'fixed';
    this.optionsContainer.style.zIndex = '999999';

    const triggerWidth = Math.round(normalizedRect.width);
    const isReasoning = this.select && this.select.classList.contains('model-reasoning-select');
    const isPaginationSize = this.select && this.select.classList.contains('pagination-size-select');
    const minDropdownWidth = isReasoning ? triggerWidth : (isPaginationSize ? 70 : 118);
    const targetWidth = Math.max(triggerWidth, minDropdownWidth);
    this.optionsContainer.style.width = isReasoning ? `${triggerWidth}px` : 'auto';
    this.optionsContainer.style.minWidth = `${targetWidth}px`;
    this.optionsContainer.style.maxWidth = isReasoning ? `${triggerWidth}px` : `${Math.max(targetWidth, 280)}px`;

    const measuredWidth = (this.optionsContainer.getBoundingClientRect().width / cssZoom) || targetWidth;
    const effectiveWidth = Math.max(targetWidth, Math.round(measuredWidth));
    const isRtl = (typeof isRtlLanguage === 'function' && isRtlLanguage(getLanguage())) ||
                  document.documentElement.dir === 'rtl' ||
                  document.body.dir === 'rtl';

    const leftPos = isReasoning
      ? Math.round(normalizedRect.left)
      : (isRtl ? Math.round(normalizedRect.right - effectiveWidth) : Math.round(normalizedRect.left));
    const maxLeft = Math.max(8, viewportWidth - effectiveWidth - 8);
    this.optionsContainer.style.left = `${Math.max(8, Math.min(leftPos, maxLeft))}px`;
    this.optionsContainer.style.right = 'auto';

    if (spaceBelow < dropdownHeight && spaceAbove > dropdownHeight) {
      // Space below insufficient -> open upward
      this.optionsContainer.style.top = 'auto';
      this.optionsContainer.style.bottom = `${viewportHeight - normalizedRect.top + 4}px`;
    } else {
      // Space available -> open downward
      this.optionsContainer.style.bottom = 'auto';
      this.optionsContainer.style.top = `${normalizedRect.bottom + 4}px`;
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

  public open(): void {
    if (this.select && this.select.disabled || !this.optionsContainer || !this.trigger || !this.container) return;
    if (customSelectsMap) {
      customSelectsMap.forEach(cs => {
        if (cs !== this && cs && typeof cs.close === 'function' && cs.isOpen) {
          cs.close();
        }
      });
    }

    // 1. Promote to GPU compositing layer right before animation begins
    this.optionsContainer.style.willChange = 'transform, opacity';

    // 2. Position the container first while it's still closed
    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.updatePosition();

    // Attach document, window, scroll, and resize listeners only while open
    if (this._documentPointerHandler) {
      document.addEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.addEventListener('keydown', this._globalEscapeHandler);
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
    }
    this.setFocusedOptionIndex(selectedIdx);

    // Searchable dropdowns put the caret in the filter box
    if (this.isSearchable()) {
      if (typeof applyTextDirection === 'function' && this.searchInput) {
        applyTextDirection(this.searchInput);
      }
      safeRaf(() => {
        if (this.isOpen && this.searchInput) {
          this.searchInput.focus();
        }
      });
    }

    // 3. Use double safeRaf to defer class additions to the next frames,
    // avoiding layout thrashing/reflow block while starting CSS transitions.
    safeRaf(() => {
      safeRaf(() => {
        if (this.isOpen && this.container && this.optionsContainer) {
          this.container.classList.add('open');
          this.optionsContainer.classList.add('open');
        }
      });
    });
  }

  public close(): void {
    if (!this.container || !this.optionsContainer || !this.trigger) return;
    this.container.classList.remove('open');
    this.optionsContainer.classList.remove('open');
    this.isOpen = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.setFocusedOptionIndex(-1);
    this.typeaheadBuffer = '';
    clearTimeout(this.typeaheadTimeout);
    if (this.isSearchable()) {
      this.clearFilter();
    }

    // Detach document, window, scroll, and resize listeners immediately on close
    if (this._documentPointerHandler) {
      document.removeEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.removeEventListener('keydown', this._globalEscapeHandler);
    }
    if (this._scrollResizeHandler) {
      window.removeEventListener('scroll', this._scrollResizeHandler, true);
      window.removeEventListener('resize', this._scrollResizeHandler);
    }

    // Reset will-change after transition ends to release GPU memory
    this.optionsContainer.addEventListener('transitionend', () => {
      if (!this.isOpen && this.optionsContainer) {
        this.optionsContainer.style.willChange = 'auto';
      }
    }, { once: true });
  }

  public destroy(): void {
    clearTimeout(this.typeaheadTimeout);
    if (this.trigger && this._keydownHandler) {
      this.trigger.removeEventListener('keydown', this._keydownHandler);
    }
    if (this._documentPointerHandler) {
      document.removeEventListener('pointerdown', this._documentPointerHandler as any, true);
    }
    if (this._globalEscapeHandler) {
      document.removeEventListener('keydown', this._globalEscapeHandler);
    }
    if (this._scrollResizeHandler) {
      window.removeEventListener('scroll', this._scrollResizeHandler, true);
      window.removeEventListener('resize', this._scrollResizeHandler);
    }
    if (this.optionsContainer && this.optionsContainer.parentNode) {
      this.optionsContainer.parentNode.removeChild(this.optionsContainer);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.observer) {
      this.observer.disconnect();
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

export function syncCustomSelects(): void {
  if (customSelectsMap) {
    customSelectsMap.forEach(cs => {
      cs.updateOptions();
      cs.syncSelectedValue();
    });
  }
}

// Bind to window for global backwards-compatibility and inline HTML handlers
if (typeof window !== 'undefined') {
  (window as any).CustomSelect = CustomSelect;
  (window as any).customSelectsMap = customSelectsMap;
  (window as any).initializeCustomSelects = initializeCustomSelects;
  (window as any).syncCustomSelects = syncCustomSelects;
}

export const customSelect = {
  CustomSelect,
  map: customSelectsMap,
  initAll: initializeCustomSelects,
  syncAll: syncCustomSelects
};
