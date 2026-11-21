import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  CustomSelect,
  customSelectsMap,
  initializeCustomSelects,
  syncCustomSelects,
  prepareCustomSelectsOptionsRefresh,
  flushPreparedCustomSelectsOptionsRefresh,
  scheduleCustomSelectsOptionsRefresh,
  cancelScheduledCustomSelectsRefresh,
  customSelect
} from './customSelect';

// Lightweight, resilient DOM environment simulation for headless Node testing
class MockDOMNode {
  public tagName: string;
  public id = '';
  public className = '';
  public dataset: Record<string, string> = {};
  public style: Record<string, string> = {};
  public children: MockDOMNode[] = [];
  public parentNode: MockDOMNode | null = null;
  public nextSibling: MockDOMNode | null = null;
  public offsetWidth = 0;
  public textContent = '';
  public value = '';
  public title = '';
  public tabIndex = 0;
  public placeholder = '';
  public disabled = false;
  public hidden = false;
  public selected = false;
  public selectedIndex = 0;
  public options: any[] = [];
  public _attrs = new Map<string, string>();
  public _listeners = new Map<string, Array<(e: any) => void>>();
  private _innerHTML = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    this.classList = {
      add: (...cls: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        cls.forEach(c => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...cls: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        cls.forEach(c => set.delete(c));
        this.className = Array.from(set).join(' ');
      },
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      toggle: (c: string, force?: boolean) => {
        const has = this.classList.contains(c);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) this.classList.add(c);
        else this.classList.remove(c);
        return shouldHave;
      }
    };
  }

  public classList: {
    add: (...cls: string[]) => void;
    remove: (...cls: string[]) => void;
    contains: (c: string) => boolean;
    toggle: (c: string, force?: boolean) => boolean;
  };

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    this.children = [];
    if (!val) return;

    if (val.includes('custom-select-value')) {
      const span = new MockDOMNode('SPAN');
      span.className = 'custom-select-value';
      span.parentNode = this;
      this.children.push(span);

      const svg = new MockDOMNode('SVG');
      svg.className = 'custom-select-arrow';
      svg.parentNode = this;
      this.children.push(svg);
    }
  }

  setAttribute(k: string, v: string) {
    this._attrs.set(k, String(v));
    if (k === 'id') this.id = v;
    if (k.startsWith('data-')) {
      const camel = k.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      this.dataset[camel] = v;
    }
  }

  getAttribute(k: string): string | null {
    if (k === 'id') return this.id || null;
    return this._attrs.get(k) || null;
  }

  hasAttribute(k: string): boolean {
    if (k === 'id') return Boolean(this.id);
    return this._attrs.has(k);
  }

  removeAttribute(k: string) {
    this._attrs.delete(k);
    if (k === 'id') this.id = '';
  }

  appendChild(child: MockDOMNode) {
    if (child.tagName === 'DOCUMENT_FRAGMENT') {
      const fragmentChildren = [...child.children];
      child.children = [];
      for (const fc of fragmentChildren) {
        this.appendChild(fc);
      }
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    if (child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  insertBefore(newNode: MockDOMNode, refNode: MockDOMNode | null) {
    newNode.parentNode = this;
    if (!refNode) {
      this.children.push(newNode);
    } else {
      const idx = this.children.indexOf(refNode);
      if (idx !== -1) {
        this.children.splice(idx, 0, newNode);
      } else {
        this.children.push(newNode);
      }
    }
    return newNode;
  }

  removeChild(child: MockDOMNode) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(ev: string, handler: (e: any) => void) {
    if (!this._listeners.has(ev)) this._listeners.set(ev, []);
    this._listeners.get(ev)!.push(handler);
  }

  removeEventListener(ev: string, handler: (e: any) => void) {
    if (!this._listeners.has(ev)) return;
    const list = this._listeners.get(ev)!.filter(h => h !== handler);
    this._listeners.set(ev, list);
  }

  dispatchEvent(event: { type: string; target?: any; currentTarget?: any; stopPropagation?: () => void }) {
    try {
      if (!event.target) {
        Object.defineProperty(event, 'target', { value: this, configurable: true, writable: true });
      }
    } catch {
      // ignore
    }
    let stopped = false;
    const origStop = event.stopPropagation;
    event.stopPropagation = () => {
      stopped = true;
      if (origStop) origStop.call(event);
    };

    let curr: MockDOMNode | null = this;
    while (curr) {
      try {
        Object.defineProperty(event, 'currentTarget', { value: curr, configurable: true, writable: true });
      } catch {
        // ignore
      }
      const list = curr._listeners.get(event.type) || [];
      for (const fn of [...list]) {
        fn(event);
        if (stopped) return true;
      }
      curr = curr.parentNode;
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  contains(node: MockDOMNode | null): boolean {
    if (!node) return false;
    if (node === this) return true;
    for (const child of this.children) {
      if (child.contains(node)) return true;
    }
    return false;
  }

  get parentElement(): MockDOMNode | null {
    return this.parentNode;
  }

  get nextElementSibling(): MockDOMNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    if (idx === -1 || idx + 1 >= this.parentNode.children.length) return null;
    return this.parentNode.children[idx + 1];
  }

  closest(selector: string): MockDOMNode | null {
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) {
      return this;
    }
    if (selector === '[dir]' && (this._attrs.has('dir') || (this as any).dir)) {
      return this;
    }
    if (this.parentNode) return this.parentNode.closest(selector);
    return null;
  }

  querySelector(selector: string): MockDOMNode | null {
    const match = (el: MockDOMNode): MockDOMNode | null => {
      if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return el;
      if (selector.startsWith('#') && el.id === selector.slice(1)) return el;
      for (const child of el.children) {
        const found = match(child);
        if (found) return found;
      }
      return null;
    };
    for (const child of this.children) {
      const found = match(child);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockDOMNode[] {
    const results: MockDOMNode[] = [];
    const search = (el: MockDOMNode) => {
      if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) results.push(el);
      else if (selector.startsWith('#') && el.id === selector.slice(1)) results.push(el);
      else if (selector === 'option' && el.tagName === 'OPTION') results.push(el);
      for (const child of el.children) {
        search(child);
      }
    };
    for (const child of this.children) {
      search(child);
    }
    return results;
  }

  getBoundingClientRect() {
    return { top: 100, bottom: 136, left: 50, right: 250, width: 200, height: 36 };
  }

  scrollIntoView() {}
  focus() {
    if (typeof document !== 'undefined') {
      (document as any).activeElement = this;
    }
  }
  blur() {
    if (typeof document !== 'undefined' && (document as any).activeElement === this) {
      (document as any).activeElement = null;
    }
  }
}

describe('CustomSelect Module', () => {
  let originalDocument: any;
  let originalWindow: any;
  let mockBody: MockDOMNode;
  let mockDoc: any;
  let mockWin: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    originalWindow = (globalThis as any).window;

    mockBody = new MockDOMNode('BODY');
    mockDoc = {
      body: mockBody,
      documentElement: new MockDOMNode('HTML'),
      activeElement: null,
      createElement: (tag: string) => new MockDOMNode(tag),
      createDocumentFragment: () => new MockDOMNode('DOCUMENT_FRAGMENT'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelectorAll: (sel: string) => mockBody.querySelectorAll(sel)
    };

    mockWin = {
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      requestAnimationFrame: (cb: () => void) => { cb(); return 1; },
      t: (key: string) => key
    };

    (globalThis as any).document = mockDoc;
    (globalThis as any).window = mockWin;
    (globalThis as any).MutationObserver = class {
      observe() {}
      disconnect() {}
    };
    customSelectsMap.clear();
  });

  afterEach(() => {
    customSelectsMap.forEach(cs => cs.destroy());
    customSelectsMap.clear();
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  function createTestSelect(id = 'test-select') {
    const parent = new MockDOMNode('DIV');
    mockBody.appendChild(parent);

    const sel = new MockDOMNode('SELECT');
    sel.id = id;
    sel.className = 'select-control test-class';
    parent.appendChild(sel);

    const opt1 = new MockDOMNode('OPTION');
    opt1.value = 'opt1';
    opt1.textContent = 'Option One';
    sel.appendChild(opt1);

    const opt2 = new MockDOMNode('OPTION');
    opt2.value = 'opt2';
    opt2.textContent = 'Option Two';
    sel.appendChild(opt2);

    const opt3 = new MockDOMNode('OPTION');
    opt3.value = 'opt3';
    opt3.textContent = 'Option Three (Disabled)';
    opt3.disabled = true;
    sel.appendChild(opt3);

    sel.selectedIndex = 0;
    sel.value = 'opt1';

    return sel as any as HTMLSelectElement;
  }

  describe('Instantiation and DOM structure', () => {
    it('wraps the native select and builds accessible WAI-ARIA combobox structure', () => {
      const selectEl = createTestSelect();
      const cs = new CustomSelect(selectEl);

      // 1. Native select hidden
      expect(selectEl.style.display).toBe('none');

      // 2. Container element present with copied classes
      expect(cs.container).toBeDefined();
      expect(cs.container?.classList.contains('custom-select-container')).toBe(true);
      expect(cs.container?.classList.contains('test-class')).toBe(true);
      expect(cs.container?.classList.contains('select-control')).toBe(false);

      // 3. Accessible ARIA combobox trigger
      expect(cs.trigger).toBeDefined();
      expect(cs.trigger?.getAttribute('role')).toBe('combobox');
      expect(cs.trigger?.getAttribute('aria-haspopup')).toBe('listbox');
      expect(cs.trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(cs.trigger?.getAttribute('aria-controls')).toBe(`options-for-${cs.instanceId}`);

      // 4. Options container in body with role listbox
      expect(cs.optionsContainer).toBeDefined();
      expect(cs.optionsContainer?.getAttribute('role')).toBe('listbox');
      expect(mockBody.contains(cs.optionsContainer as any)).toBe(true);

      // 5. Options rendered
      const optionDivs = cs.getOptionDivs();
      expect(optionDivs).toHaveLength(3);
      expect(optionDivs[0].dataset.value).toBe('opt1');
      expect(optionDivs[0].textContent).toBe('Option One');
      expect(optionDivs[2].classList.contains('disabled')).toBe(true);
    });

    it('registers the instance in customSelectsMap and cleans up on destroy()', () => {
      const selectEl = createTestSelect('my-select');
      const cs = new CustomSelect(selectEl);

      expect(customSelectsMap.has('my-select')).toBe(true);
      expect(customSelectsMap.get('my-select')).toBe(cs);

      cs.destroy();
      expect(customSelectsMap.has('my-select')).toBe(false);
      expect(mockBody.contains(cs.optionsContainer as any)).toBe(false);
      expect(selectEl.dataset.customSelectInitialized).toBeUndefined();
      expect(selectEl.style.display).toBe('');

      // Can be re-initialized after destroy
      const cs2 = new CustomSelect(selectEl);
      expect(customSelectsMap.has('my-select')).toBe(true);
      expect(selectEl.dataset.customSelectInitialized).toBe('true');
      cs2.destroy();
    });
  });

  describe('Value Synchronization and Selection', () => {
    it('synchronizes selected value and updates trigger display label', () => {
      const selectEl = createTestSelect();
      const cs = new CustomSelect(selectEl);

      selectEl.selectedIndex = 1;
      selectEl.value = 'opt2';
      cs.syncSelectedValue();

      const valEl = cs.trigger?.querySelector('.custom-select-value');
      expect(valEl?.textContent).toBe('Option Two');

      const optionDivs = cs.getOptionDivs();
      expect(optionDivs[1].classList.contains('selected')).toBe(true);
      expect(optionDivs[0].classList.contains('selected')).toBe(false);
    });

    it('updates native select and dispatches change event when an option is clicked', () => {
      const selectEl = createTestSelect();
      const cs = new CustomSelect(selectEl);

      let changeFired = false;
      selectEl.addEventListener('change', () => {
        changeFired = true;
      });

      const optionDivs = cs.getOptionDivs();
      (optionDivs[1] as any).click();

      expect(selectEl.value).toBe('opt2');
      expect(changeFired).toBe(true);
      expect(cs.isOpen).toBe(false);
    });

    it('does not dispatch change event when the currently active option is re-selected', () => {
      const selectEl = createTestSelect();
      const cs = new CustomSelect(selectEl);
      expect(selectEl.value).toBe('opt1');

      let changeFired = false;
      selectEl.addEventListener('change', () => {
        changeFired = true;
      });

      const optionDivs = cs.getOptionDivs();
      (optionDivs[0] as any).click(); // optionDivs[0] is 'opt1' (already active)

      expect(selectEl.value).toBe('opt1');
      expect(changeFired).toBe(false);
      expect(cs.isOpen).toBe(false);
    });

    it('ignores clicks on disabled options', () => {
      const selectEl = createTestSelect();
      const cs = new CustomSelect(selectEl);

      let changeFired = false;
      selectEl.addEventListener('change', () => {
        changeFired = true;
      });

      const optionDivs = cs.getOptionDivs();
      (optionDivs[2] as any).click(); // disabled option

      expect(selectEl.value).toBe('opt1');
      expect(changeFired).toBe(false);
    });

    it('skips hidden options and empty disabled placeholder options during rendering', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);

      const sel = new MockDOMNode('SELECT');
      sel.id = 'placeholder-test-select';
      parent.appendChild(sel);

      const phOpt = new MockDOMNode('OPTION');
      phOpt.value = '';
      phOpt.textContent = 'Sort...';
      phOpt.disabled = true;
      phOpt.hidden = true;
      sel.appendChild(phOpt);

      const realOpt1 = new MockDOMNode('OPTION');
      realOpt1.value = 'name-asc';
      realOpt1.textContent = 'Alphabetical (A-Z)';
      sel.appendChild(realOpt1);

      const realOpt2 = new MockDOMNode('OPTION');
      realOpt2.value = 'name-desc';
      realOpt2.textContent = 'Alphabetical (Z-A)';
      sel.appendChild(realOpt2);

      sel.selectedIndex = 0;
      sel.value = '';

      const cs = new CustomSelect(sel as any);
      const optionDivs = cs.getOptionDivs();

      expect(optionDivs).toHaveLength(2);
      expect(optionDivs[0].dataset.value).toBe('name-asc');
      expect(optionDivs[1].dataset.value).toBe('name-desc');
      // Options should not carry redundant title attributes
      expect(optionDivs[0].title).toBeFalsy();
    });

    it('does not assign native title tooltips when text is not truncated or data-no-tooltip is present', () => {
      const selectEl = createTestSelect('no-tooltip-select');
      selectEl.setAttribute('data-no-tooltip', 'true');
      const cs = new CustomSelect(selectEl);

      cs.syncSelectedValue();
      const valEl = cs.trigger?.querySelector('.custom-select-value');
      expect(valEl?.hasAttribute('title')).toBe(false);
      expect(cs.trigger?.hasAttribute('title')).toBe(false);
    });

    it('propagates and synchronizes aria-label on combobox trigger', () => {
      const selectEl = createTestSelect('aria-label-select');
      selectEl.setAttribute('aria-label', 'Sort queue');
      const cs = new CustomSelect(selectEl);

      expect(cs.trigger?.getAttribute('aria-label')).toBe('Sort queue');

      selectEl.setAttribute('aria-label', 'Updated sort label');
      cs.syncSelectedValue();
      expect(cs.trigger?.getAttribute('aria-label')).toBe('Updated sort label');
    });
  });

  describe('Open, Close, Toggle Lifecycle', () => {
    it('manages open/close states and closes other open selects', () => {
      const selectEl1 = createTestSelect('select-1');
      const selectEl2 = createTestSelect('select-2');

      const cs1 = new CustomSelect(selectEl1);
      const cs2 = new CustomSelect(selectEl2);

      cs1.open();
      expect(cs1.isOpen).toBe(true);
      expect(cs1.trigger?.getAttribute('aria-expanded')).toBe('true');

      // Opening cs2 must close cs1 (mutual exclusivity)
      cs2.open();
      expect(cs2.isOpen).toBe(true);
      expect(cs1.isOpen).toBe(false);
      expect(cs1.trigger?.getAttribute('aria-expanded')).toBe('false');

      cs2.toggle();
      expect(cs2.isOpen).toBe(false);
    });

    it('respects disabled state of the native select', () => {
      const selectEl = createTestSelect();
      selectEl.disabled = true;
      const cs = new CustomSelect(selectEl);

      expect(cs.container?.classList.contains('disabled')).toBe(true);
      expect(cs.trigger?.getAttribute('aria-disabled')).toBe('true');

      cs.open();
      expect(cs.isOpen).toBe(false);

      selectEl.disabled = false;
      cs.syncDisabledState();
      expect(cs.container?.classList.contains('disabled')).toBe(false);
      expect(cs.trigger?.hasAttribute('aria-disabled')).toBe(false);
    });

    it('aligns custom select to left in RTL document when ancestor has dir="ltr"', () => {
      mockDoc.documentElement.dir = 'rtl';
      const container = new MockDOMNode('DIV');
      container.setAttribute('dir', 'ltr');
      mockBody.appendChild(container as any);

      const selectEl = createTestSelect('ltr-container-select');
      container.appendChild(selectEl as any);

      const cs = new CustomSelect(selectEl);
      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 126, left: 200, right: 320, width: 120, height: 26
        } as any);
      }
      if (cs.optionsContainer) {
        cs.optionsContainer.getBoundingClientRect = () => ({
          top: 130, bottom: 230, left: 200, right: 320, width: 120, height: 100
        } as any);
      }
      cs.open();
      // In LTR context, leftPos should align with normalizedRect.left (200px)
      expect(cs.optionsContainer?.style.left).toBe('200px');
    });

    it('aligns custom select to right edge in RTL document when dir="rtl"', () => {
      mockDoc.documentElement.dir = 'rtl';
      const selectEl = createTestSelect('rtl-select');
      const cs = new CustomSelect(selectEl);
      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 126, left: 200, right: 320, width: 120, height: 26
        } as any);
      }
      if (cs.optionsContainer) {
        cs.optionsContainer.getBoundingClientRect = () => ({
          top: 130, bottom: 230, left: 200, right: 320, width: 120, height: 100
        } as any);
      }
      cs.open();
      // In RTL context, right edge 320 - effectiveWidth 120 = 200px
      expect(cs.optionsContainer?.style.left).toBe('200px');
    });
  });

  describe('Searchable Dropdown and Optgroup Filtering', () => {
    it('renders search input for select with data-searchable', () => {
      const selectEl = createTestSelect();
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      expect(cs.isSearchable()).toBe(true);
      expect(cs.searchInput).toBeDefined();
      expect(cs.searchRow).toBeDefined();
      expect(cs.optionsList).toBeDefined();
      expect(cs.noResultsRow).toBeDefined();
      expect(cs.optionsContainer?.children[0]).toBe(cs.searchRow);
      expect(cs.optionsContainer?.children[1]).toBe(cs.optionsList);
      expect(cs.optionsList?.contains(cs.searchRow as any)).toBe(false);
    });

    it('filters options and collapses empty optgroups', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const groupA = new MockDOMNode('OPTGROUP');
      groupA.setAttribute('label', 'Group A');
      selectEl.appendChild(groupA);

      const optA1 = new MockDOMNode('OPTION');
      optA1.value = 'apple';
      optA1.textContent = 'Apple';
      groupA.appendChild(optA1);

      const optA2 = new MockDOMNode('OPTION');
      optA2.value = 'avocado';
      optA2.textContent = 'Avocado';
      groupA.appendChild(optA2);

      const groupB = new MockDOMNode('OPTGROUP');
      groupB.setAttribute('label', 'Group B');
      selectEl.appendChild(groupB);

      const optB1 = new MockDOMNode('OPTION');
      optB1.value = 'banana';
      optB1.textContent = 'Banana';
      groupB.appendChild(optB1);

      const cs = new CustomSelect(selectEl as any);

      // Search for "ban"
      cs.applyFilter('ban');

      const optionDivs = cs.getOptionDivs();
      const appleOpt = optionDivs.find(d => d.dataset.value === 'apple');
      const bananaOpt = optionDivs.find(d => d.dataset.value === 'banana');

      expect(appleOpt?.classList.contains('hidden')).toBe(true);
      expect(bananaOpt?.classList.contains('hidden')).toBe(false);

      expect(cs.noResultsRow?.classList.contains('hidden')).toBe(true);

      // Search for non-existent item
      cs.applyFilter('nonexistent');
      expect(cs.noResultsRow?.classList.contains('hidden')).toBe(false);
    });

    it('identifies model selects and resolves model-specific placeholders', () => {
      const selectEl = createTestSelect('opt-whisperModel');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      expect(cs.isModelSelect()).toBe(true);
      expect(cs.getSearchPlaceholder()).toBe('settings.searchModelsPlaceholder');
    });

    it('restores focus to trigger when closing or selecting from search input via Enter or Escape', () => {
      const selectEl = createTestSelect();
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      const triggerFocusSpy = vi.spyOn(cs.trigger as any, 'focus');

      // Test Escape when search query is empty
      cs.open();
      cs.handleSearchKeydown({ key: 'Escape', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(triggerFocusSpy).toHaveBeenCalled();

      triggerFocusSpy.mockClear();

      // Test Enter on active option
      cs.open();
      cs.handleSearchKeydown({ key: 'Enter', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(triggerFocusSpy).toHaveBeenCalled();
    });

    it('keeps focus on the currently selected option when opening a searchable dropdown', () => {
      const selectEl = createTestSelect('searchable-model-select');
      selectEl.setAttribute('data-searchable', 'true');
      selectEl.selectedIndex = 1;
      selectEl.value = 'opt2';
      const cs = new CustomSelect(selectEl);

      cs.open();

      const optionDivs = cs.getOptionDivs();
      expect(cs.focusedIndex).toBe(1);
      expect(optionDivs[0].classList.contains('focused')).toBe(false);
      expect(optionDivs[0].classList.contains('selected')).toBe(false);
      expect(optionDivs[1].classList.contains('focused')).toBe(true);
      expect(optionDivs[1].classList.contains('selected')).toBe(true);
    });

    it('focuses top match during active search and restores focus to selected option when query is cleared', () => {
      const selectEl = createTestSelect('searchable-clear-select');
      selectEl.setAttribute('data-searchable', 'true');
      selectEl.selectedIndex = 1;
      selectEl.value = 'opt2';
      const cs = new CustomSelect(selectEl);

      cs.open();
      expect(cs.focusedIndex).toBe(1);

      cs.applyFilter('one');
      expect(cs.focusedIndex).toBe(0);
      expect(cs.getNavigableOptions()[0].dataset.value).toBe('opt1');

      cs.applyFilter('');
      expect(cs.focusedIndex).toBe(1);
      expect(cs.getNavigableOptions()[1].dataset.value).toBe('opt2');
    });

    it('marks at most one option as selected when duplicate values exist across optgroups', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'dup-lang-select';
      parent.appendChild(selectEl);

      const recentGroup = new MockDOMNode('OPTGROUP');
      recentGroup.setAttribute('label', 'Recent');
      selectEl.appendChild(recentGroup);

      const optRecent = new MockDOMNode('OPTION');
      optRecent.value = 'af';
      optRecent.textContent = 'Afrikaans';
      recentGroup.appendChild(optRecent);

      const allGroup = new MockDOMNode('OPTGROUP');
      allGroup.setAttribute('label', 'All');
      selectEl.appendChild(allGroup);

      const optAll = new MockDOMNode('OPTION');
      optAll.value = 'af';
      optAll.textContent = 'Afrikaans';
      allGroup.appendChild(optAll);

      selectEl.value = 'af';
      const cs = new CustomSelect(selectEl as any);

      const selectedDivs = cs.getOptionDivs().filter(div => div.classList.contains('selected'));
      const ariaSelectedDivs = cs.getOptionDivs().filter(div => div.getAttribute('aria-selected') === 'true');
      expect(selectedDivs).toHaveLength(1);
      expect(ariaSelectedDivs).toHaveLength(1);
      expect(Array.from(cs.optionsContainer?.children || []).some(
        c => c.classList.contains('custom-select-group-label') && c.hasAttribute('aria-selected')
      )).toBe(false);
    });

    it('wires WAI-ARIA combobox/listbox roles and tracks aria-activedescendant on searchInput', () => {
      const selectEl = createTestSelect('aria-search-select');
      selectEl.setAttribute('data-searchable', 'true');
      selectEl.selectedIndex = 1;
      selectEl.value = 'opt2';
      const cs = new CustomSelect(selectEl);

      expect(cs.optionsContainer?.getAttribute('role')).toBe('presentation');
      expect(cs.optionsList?.getAttribute('role')).toBe('listbox');
      expect(cs.trigger?.getAttribute('role')).toBe('button');
      expect(cs.searchInput?.getAttribute('role')).toBe('combobox');
      expect(cs.searchInput?.getAttribute('aria-controls')).toBe(cs.optionsList?.id);
      expect(cs.noResultsRow?.getAttribute('role')).toBe('status');
      expect(cs.noResultsRow?.getAttribute('aria-live')).toBe('polite');

      cs.open();
      expect(cs.searchInput?.getAttribute('aria-expanded')).toBe('true');
      expect(cs.searchInput?.getAttribute('aria-activedescendant')).toBe(cs.getOptionDivs()[1].id);
      expect(cs.trigger?.hasAttribute('aria-activedescendant')).toBe(false);

      cs.close();
      expect(cs.searchInput?.getAttribute('aria-expanded')).toBe('false');
      expect(cs.searchInput?.hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('toggles search clear button visibility and clears active query on click', () => {
      const selectEl = createTestSelect('clear-btn-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);
      cs.open();

      expect(cs.searchClearBtn?.classList.contains('hidden')).toBe(true);

      if (cs.searchInput) cs.searchInput.value = 'one';
      cs.applyFilter('one');
      expect(cs.searchClearBtn?.classList.contains('hidden')).toBe(false);

      cs.searchClearBtn?.click();
      expect(cs.searchInput?.value).toBe('');
      expect(cs.searchClearBtn?.classList.contains('hidden')).toBe(true);
      expect(cs.getNavigableOptions()).toHaveLength(2);
    });

    it('matches both visible option text and data-search aliases', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'alias-search-select';
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const opt = new MockDOMNode('OPTION');
      opt.value = 'large-v3';
      opt.textContent = 'Whisper Large V3';
      opt.setAttribute('data-search', 'multilingual turbo');
      selectEl.appendChild(opt);

      const cs = new CustomSelect(selectEl as any);

      cs.applyFilter('whisper');
      expect(cs.getNavigableOptions()).toHaveLength(1);

      cs.applyFilter('multilingual');
      expect(cs.getNavigableOptions()).toHaveLength(1);
    });

    it('clamps dropdown maxHeight and flips upward when spaceAbove exceeds spaceBelow in short viewports', () => {
      mockWin.innerHeight = 400;
      const selectEl = createTestSelect('short-viewport-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 250, bottom: 286, left: 40, right: 240, width: 200, height: 36
        } as any);
      }
      if (cs.optionsList) {
        (cs.optionsList as any).scrollHeight = 300;
      }

      cs.open();
      expect(cs.optionsContainer?.dataset.placement).toBe('top');
      expect(cs.optionsContainer?.style.maxHeight).toBe('240px');
      expect(cs.optionsContainer?.style.bottom).toBe('154px');
    });

    it('unifies pointer hover with keyboard focusedIndex without dual highlights', () => {
      const selectEl = createTestSelect('hover-focus-select');
      const cs = new CustomSelect(selectEl);
      cs.open();
      expect(cs.focusedIndex).toBe(0);

      const opt2 = cs.getNavigableOptions()[1];
      cs.optionsContainer?.dispatchEvent({
        type: 'pointermove',
        clientX: 120,
        clientY: 160,
        target: opt2
      } as any);

      expect(cs.focusedIndex).toBe(1);
      expect(cs.getNavigableOptions()[0].classList.contains('focused')).toBe(false);
      expect(opt2.classList.contains('focused')).toBe(true);
    });

    it('returns focus to trigger on Tab from searchInput and sets dir="ltr" on LTR technical selects', () => {
      const selectEl = createTestSelect('tab-ltr-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      expect(cs.container?.getAttribute('dir')).toBe('ltr');
      expect(cs.optionsContainer?.getAttribute('dir')).toBe('ltr');

      const triggerFocusSpy = vi.spyOn(cs.trigger as any, 'focus');
      cs.open();
      cs.handleSearchKeydown({ key: 'Tab', shiftKey: false, stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(triggerFocusSpy).toHaveBeenCalled();
      expect(cs.isOpen).toBe(false);

      const shiftPreventDefault = vi.fn();
      triggerFocusSpy.mockClear();
      cs.open();
      cs.handleSearchKeydown({ key: 'Tab', shiftKey: true, stopPropagation: vi.fn(), preventDefault: shiftPreventDefault } as any);
      expect(shiftPreventDefault).toHaveBeenCalled();
      expect(triggerFocusSpy).toHaveBeenCalled();
      expect(cs.isOpen).toBe(false);
    });

    it('supports multi-word tokenized search and prioritizes prefix matches', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'multiword-select';
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const opt1 = new MockDOMNode('OPTION');
      opt1.value = 'large-v3-turbo';
      opt1.textContent = 'Whisper Large V3 Turbo';
      selectEl.appendChild(opt1);

      const opt2 = new MockDOMNode('OPTION');
      opt2.value = 'fa-prefix';
      opt2.textContent = 'Afrikaans (af)';
      selectEl.appendChild(opt2);

      const opt3 = new MockDOMNode('OPTION');
      opt3.value = 'fa';
      opt3.textContent = 'Farsi (fa)';
      selectEl.appendChild(opt3);

      const cs = new CustomSelect(selectEl as any);
      cs.open();

      cs.applyFilter('whisper turbo');
      expect(cs.getNavigableOptions().map(o => o.dataset.value)).toEqual(['large-v3-turbo']);

      cs.applyFilter('fa');
      // Both Afrikaans (contains "fa"?) No: "afrikaans" doesn't contain "fa", let's test "af" matching Afrikaans (prefix) over another match
      const opt4 = new MockDOMNode('OPTION');
      opt4.value = 'naf';
      opt4.textContent = 'North African';
      selectEl.appendChild(opt4);
      cs.updateOptions();

      cs.applyFilter('af');
      const visible = cs.getNavigableOptions();
      expect(visible.length).toBeGreaterThanOrEqual(2);
      expect(visible[cs.focusedIndex].dataset.value).toBe('fa-prefix');
    });

    it('normalizes offsetTop relative to optionsList when offsetParent is optionsContainer', () => {
      const selectEl = createTestSelect('offset-scroll-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);
      cs.open();

      if (cs.optionsList) {
        (cs.optionsList as any).scrollTop = 30;
        (cs.optionsList as any).clientHeight = 180;
        (cs.optionsList as any).offsetTop = 49;
      }
      const opt0 = cs.getNavigableOptions()[0] as any;
      opt0.offsetParent = cs.optionsContainer;
      opt0.offsetTop = 53; // 49 (searchRow) + 4 (list top)
      opt0.offsetHeight = 36;

      cs.setFocusedOptionIndex(0, true, false);
      expect((cs.optionsList as any).scrollTop).toBe(0);
    });

    it('locks measured dropdown width while open so RTL filtering does not shrink or misalign', () => {
      mockDoc.documentElement.dir = 'rtl';
      const selectEl = createTestSelect('rtl-width-lock');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 136, left: 240, right: 400, width: 160, height: 36
        } as any);
      }
      if (cs.optionsContainer) {
        cs.optionsContainer.getBoundingClientRect = () => ({
          top: 140, bottom: 300, left: 140, right: 400, width: 260, height: 160
        } as any);
      }

      cs.open();
      expect(cs.optionsContainer?.style.width).toBe('260px');
      expect(cs.optionsContainer?.style.left).toBe('140px');

      cs.applyFilter('one');
      cs.updatePosition();
      expect(cs.optionsContainer?.style.width).toBe('260px');
      expect(cs.optionsContainer?.style.left).toBe('140px');
    });

    it('defers clearing search query until close transition completes', () => {
      const selectEl = createTestSelect('deferred-close-reset');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      cs.open();
      if (cs.searchInput) cs.searchInput.value = 'one';
      cs.applyFilter('one');
      expect(cs.getNavigableOptions()).toHaveLength(1);

      cs.close();
      // During fade-out, filtered list and query remain intact (no mid-fade visual jump)
      expect(cs.searchInput?.value).toBe('one');
      expect(cs.getNavigableOptions()).toHaveLength(1);

      // Simulate transitionend on optionsContainer
      cs.optionsContainer?.dispatchEvent({ type: 'transitionend', target: cs.optionsContainer } as any);
      expect(cs.searchInput?.value).toBe('');
      expect(cs.getNavigableOptions()).toHaveLength(2);
    });

    it('keeps searchRow mounted and preserves active filter when updateOptions runs while open', () => {
      const selectEl = createTestSelect('open-update-options');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      cs.open();
      if (cs.searchInput) cs.searchInput.value = 'two';
      cs.applyFilter('two');
      expect(cs.getNavigableOptions().map(o => o.dataset.value)).toEqual(['opt2']);

      const newOpt = new MockDOMNode('OPTION');
      newOpt.value = 'opt4';
      newOpt.textContent = 'Option Two Extra';
      selectEl.appendChild(newOpt as any);
      cs.updateOptions();

      expect(cs.optionsContainer?.children[0]).toBe(cs.searchRow);
      expect(cs.searchInput?.value).toBe('two');
      expect(cs.getNavigableOptions().map(o => o.dataset.value)).toEqual(['opt2', 'opt4']);
    });

    it('never overflows availableSpace when viewport is very short and supports PageUp/PageDown', () => {
      mockWin.innerHeight = 160;
      const selectEl = createTestSelect('tiny-viewport-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 60, bottom: 96, left: 20, right: 220, width: 200, height: 36
        } as any);
      }
      if (cs.optionsList) {
        (cs.optionsList as any).scrollHeight = 300;
      }

      cs.open();
      // spaceAbove = 60, spaceBelow = 64 -> availableSpace = 64 -> maxHeight = 54px (< 110px)
      expect(cs.optionsContainer?.style.maxHeight).toBe('54px');

      cs.handleSearchKeydown({ key: 'PageDown', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(cs.focusedIndex).toBe(1);
      cs.handleSearchKeydown({ key: 'PageUp', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(cs.focusedIndex).toBe(0);
    });

    it('uses offsetWidth over transform-scaled getBoundingClientRect width when measuring dropdown width', () => {
      const selectEl = createTestSelect('offset-width-select');
      const cs = new CustomSelect(selectEl);

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 136, left: 40, right: 200, width: 160, height: 36
        } as any);
      }
      if (cs.optionsContainer) {
        // Simulate pre-open scale(0.985) shrinking bounding rect width from 260px -> 256px
        (cs.optionsContainer as any).offsetWidth = 260;
        cs.optionsContainer.getBoundingClientRect = () => ({
          top: 140, bottom: 300, left: 40, right: 296, width: 256, height: 160
        } as any);
      }

      cs.open();
      expect(cs.optionsContainer?.style.width).toBe('260px');
    });

    it('aligns technical LTR dropdown to right edge in RTL document unless external ancestor specifies dir="ltr"', () => {
      mockDoc.documentElement.dir = 'rtl';
      mockDoc.documentElement.appendChild(mockBody);

      const selectEl = createTestSelect('rtl-tech-align');
      const cs = new CustomSelect(selectEl);
      expect(cs.container?.getAttribute('dir')).toBe('ltr');

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 136, left: 240, right: 400, width: 160, height: 36
        } as any);
      }
      if (cs.optionsContainer) {
        (cs.optionsContainer as any).offsetWidth = 240;
      }

      cs.open();
      // Right edge aligned with trigger right (400 - 240 = 160), not hijacked by container's dir="ltr"
      expect(cs.optionsContainer?.style.left).toBe('160px');
      cs.close();

      // Now wrap inside an explicit external dir="ltr" ancestor (e.g. media controls)
      (cs.container?.parentNode as any).setAttribute('dir', 'ltr');
      cs.open();
      expect(cs.optionsContainer?.style.left).toBe('240px');
    });

    it('returns focus to trigger on mouse selection and blurs hidden searchInput on close', () => {
      const selectEl = createTestSelect('focus-cleanup-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      cs.open();
      expect(mockDoc.activeElement).toBe(cs.searchInput);

      // Click option -> closes dropdown and restores focus to trigger
      const opt2 = cs.getNavigableOptions()[1];
      cs.selectOption(opt2);
      expect(cs.isOpen).toBe(false);
      expect(mockDoc.activeElement).toBe(cs.trigger);

      // Reopen and close externally -> blurs searchInput instead of leaving focus trapped in closed popup
      cs.open();
      expect(mockDoc.activeElement).toBe(cs.searchInput);
      cs.close();
      expect(mockDoc.activeElement).toBeNull();
    });

    it('honors data-dropdown-min-width on non-reasoning selects even when trigger is narrower', () => {
      const selectEl = createTestSelect('batch-sort-select');
      selectEl.setAttribute('data-dropdown-min-width', '215');
      const cs = new CustomSelect(selectEl);

      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 100, bottom: 136, left: 20, right: 160, width: 140, height: 36
        } as any);
      }
      if (cs.optionsContainer) {
        (cs.optionsContainer as any).offsetWidth = 170;
      }

      cs.open();
      expect(cs.optionsContainer?.style.minWidth).toBe('215px');
      expect(cs.optionsContainer?.style.width).toBe('215px');
    });

    it('adds open class before focusing searchInput so visibility:hidden never blocks focus', () => {
      const selectEl = createTestSelect('focus-order-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      let wasOpenOnFocus = false;
      const origFocus = cs.searchInput!.focus.bind(cs.searchInput);
      cs.searchInput!.focus = () => {
        wasOpenOnFocus = Boolean(cs.optionsContainer?.classList.contains('open'));
        origFocus();
      };

      cs.open();
      expect(wasOpenOnFocus).toBe(true);
      expect(mockDoc.activeElement).toBe(cs.searchInput);
    });

    it('keeps UI RTL direction on searchRow and noResultsRow even when technical optionsContainer is dir="ltr"', () => {
      mockDoc.documentElement.dir = 'rtl';
      const selectEl = createTestSelect('rtl-model-search');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      cs.open();
      expect(cs.optionsContainer?.getAttribute('dir')).toBe('ltr');
      expect(cs.searchRow?.getAttribute('dir')).toBe('rtl');
      expect(cs.noResultsRow?.getAttribute('dir')).toBe('rtl');
    });

    it('toggles keyboard-nav class on keyboard navigation and clears it on pointer move', () => {
      const selectEl = createTestSelect('keyboard-nav-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);
      cs.open();

      cs.handleSearchKeydown({ key: 'ArrowDown', stopPropagation: vi.fn(), preventDefault: vi.fn() } as any);
      expect(cs.optionsContainer?.classList.contains('keyboard-nav')).toBe(true);

      const opt1 = cs.getNavigableOptions()[0];
      cs.optionsContainer?.dispatchEvent({
        type: 'pointermove',
        clientX: 90,
        clientY: 140,
        target: opt1
      } as any);
      expect(cs.optionsContainer?.classList.contains('keyboard-nav')).toBe(false);
    });

    it('never exceeds availableSpace in ultra-short viewports and prioritizes exact option values in search', () => {
      mockWin.innerHeight = 120;
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'ultra-short-value-match';
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const opt1 = new MockDOMNode('OPTION');
      opt1.value = 'other';
      opt1.textContent = 'Other (fa-extra)';
      selectEl.appendChild(opt1);

      const opt2 = new MockDOMNode('OPTION');
      opt2.value = 'fa';
      opt2.textContent = 'فارسی (fa)';
      selectEl.appendChild(opt2);

      const cs = new CustomSelect(selectEl as any);
      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => ({
          top: 40, bottom: 80, left: 20, right: 220, width: 200, height: 40
        } as any);
      }
      if (cs.optionsList) {
        (cs.optionsList as any).scrollHeight = 200;
      }

      cs.open();
      // spaceAbove = 40, spaceBelow = 40 -> availableSpace = 40 -> maxHeight = 36px (<= 40px)
      expect(cs.optionsContainer?.style.maxHeight).toBe('36px');

      cs.applyFilter('fa');
      const visible = cs.getNavigableOptions();
      expect(visible[cs.focusedIndex].dataset.value).toBe('fa');
    });

    it('toggles starts-with-group on optionsList instead of dynamic option margins', () => {
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'group-padding-select';
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const topOpt = new MockDOMNode('OPTION');
      topOpt.value = 'auto';
      topOpt.textContent = 'Auto';
      selectEl.appendChild(topOpt);

      const grp = new MockDOMNode('OPTGROUP');
      grp.setAttribute('label', 'All');
      const optA = new MockDOMNode('OPTION');
      optA.value = 'fa';
      optA.textContent = 'Farsi';
      grp.appendChild(optA);
      selectEl.appendChild(grp);

      const cs = new CustomSelect(selectEl as any);
      expect(cs.optionsList?.classList.contains('starts-with-group')).toBe(false);

      cs.applyFilter('farsi');
      expect(cs.optionsList?.classList.contains('starts-with-group')).toBe(true);

      cs.clearFilter();
      expect(cs.optionsList?.classList.contains('starts-with-group')).toBe(false);
    });

    it('releases willChange after open transition completes and resets isOpen on destroy', () => {
      // Arrange
      const selectEl = createTestSelect('will-change-release-select');
      const cs = new CustomSelect(selectEl);

      // Act
      cs.open();
      expect(cs.optionsContainer?.style.willChange).toBe('transform, opacity');

      cs.optionsContainer?.dispatchEvent({ type: 'transitionend', target: cs.optionsContainer } as any);

      // Assert
      expect(cs.optionsContainer?.style.willChange).toBe('auto');
      expect(cs.isOpen).toBe(true);

      cs.destroy();
      expect(cs.isOpen).toBe(false);
    });

    it('expands dropdown width when trigger widens on window resize without shrinking on filter', () => {
      // Arrange
      const selectEl = createTestSelect('resize-grow-select');
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      let triggerRect = { top: 100, bottom: 136, left: 40, right: 240, width: 200, height: 36 };
      if (cs.trigger) {
        cs.trigger.getBoundingClientRect = () => triggerRect as any;
      }
      if (cs.optionsContainer) {
        (cs.optionsContainer as any).offsetWidth = 240;
      }

      // Act
      cs.open();
      expect(cs.optionsContainer?.style.width).toBe('240px');

      // Filtering keeps locked width (240px)
      cs.applyFilter('one');
      cs.updatePosition();
      expect(cs.optionsContainer?.style.width).toBe('240px');

      // Window resize widens trigger to 360px -> dropdown grows to match trigger
      triggerRect = { top: 100, bottom: 136, left: 40, right: 400, width: 360, height: 36 };
      cs.updatePosition();

      // Assert
      expect(cs.optionsContainer?.style.width).toBe('360px');
    });

    it('prioritizes multi-word prefix matches in pickBestMatchIndex', () => {
      // Arrange
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'multiword-rank-select';
      selectEl.setAttribute('data-searchable', 'true');
      parent.appendChild(selectEl);

      const opt1 = new MockDOMNode('OPTION');
      opt1.value = 'other';
      opt1.textContent = 'Model mywhisper superturbo';
      selectEl.appendChild(opt1);

      const opt2 = new MockDOMNode('OPTION');
      opt2.value = 'large-v3-turbo';
      opt2.textContent = 'Whisper Large V3 Turbo';
      selectEl.appendChild(opt2);

      const cs = new CustomSelect(selectEl as any);
      cs.open();

      // Act
      cs.applyFilter('whisper turbo');
      const visible = cs.getNavigableOptions();

      // Assert
      expect(visible).toHaveLength(2);
      expect(visible[cs.focusedIndex].dataset.value).toBe('large-v3-turbo');
    });

    it('sets keyboard-nav on keyboard open/typeahead and supports starts-with-group on non-searchable selects', () => {
      // Arrange
      const parent = new MockDOMNode('DIV');
      mockBody.appendChild(parent);
      const selectEl = new MockDOMNode('SELECT');
      selectEl.id = 'non-search-group-select';
      parent.appendChild(selectEl);

      const grp = new MockDOMNode('OPTGROUP');
      grp.setAttribute('label', 'Section A');
      const opt1 = new MockDOMNode('OPTION');
      opt1.value = 'alpha';
      opt1.textContent = 'Alpha';
      const opt2 = new MockDOMNode('OPTION');
      opt2.value = 'beta';
      opt2.textContent = 'Beta';
      grp.appendChild(opt1);
      grp.appendChild(opt2);
      selectEl.appendChild(grp);

      const cs = new CustomSelect(selectEl as any);

      // Assert starts-with-group on non-searchable container
      expect(cs.optionsContainer?.classList.contains('starts-with-group')).toBe(true);

      // Act: keyboard typeahead opens and enables keyboard-nav
      cs.trigger?.dispatchEvent({ key: 'b', preventDefault: vi.fn(), stopPropagation: vi.fn(), type: 'keydown' } as any);

      // Assert
      expect(cs.isOpen).toBe(true);
      expect(cs.optionsContainer?.classList.contains('keyboard-nav')).toBe(true);
      expect(cs.focusedIndex).toBe(1);
    });

    it('wires aria-labelledby from associated label[for] when select lacks aria-label', () => {
      // Arrange
      const labelEl = new MockDOMNode('LABEL');
      labelEl.setAttribute('for', 'labeled-select');
      labelEl.textContent = 'Per page';
      mockDoc.querySelector = (selector: string) => (
        selector === 'label[for="labeled-select"]' ? labelEl : null
      );

      const selectEl = createTestSelect('labeled-select');

      // Act
      const cs = new CustomSelect(selectEl);

      // Assert
      expect(labelEl.id).toBe('label-for-labeled-select');
      expect(cs.trigger?.getAttribute('aria-labelledby')).toBe('label-for-labeled-select');
    });
  });

  describe('Global Batch and Window Helpers', () => {
    it('synchronizes all registered custom select instances via syncCustomSelects()', () => {
      const selectEl = createTestSelect('sync-sel');
      const cs = new CustomSelect(selectEl);

      const newOpt = new MockDOMNode('OPTION');
      newOpt.value = 'dyn-opt';
      newOpt.textContent = 'Dynamic Option';
      selectEl.appendChild(newOpt as any);
      selectEl.selectedIndex = 3;
      selectEl.value = 'dyn-opt';

      syncCustomSelects();

      const valEl = cs.trigger?.querySelector('.custom-select-value');
      expect(valEl?.textContent).toBe('Dynamic Option');
    });

    it('supports updateOptions flag in syncCustomSelects(updateOptions)', () => {
      const selectEl = createTestSelect('sync-opt-flag');
      const cs = new CustomSelect(selectEl);
      const updateOptionsSpy = vi.spyOn(cs, 'updateOptions');
      const syncSelectedValueSpy = vi.spyOn(cs, 'syncSelectedValue');

      syncCustomSelects(false);
      expect(updateOptionsSpy).not.toHaveBeenCalled();
      expect(syncSelectedValueSpy).toHaveBeenCalled();

      updateOptionsSpy.mockClear();
      syncSelectedValueSpy.mockClear();

      syncCustomSelects(true);
      expect(updateOptionsSpy).toHaveBeenCalledWith(true);
      expect(syncSelectedValueSpy).toHaveBeenCalledTimes(1);
    });

    it('skips trigger tooltip measurement when updateOptions(true) is called', () => {
      const selectEl = createTestSelect('skip-tooltip-sel');
      const cs = new CustomSelect(selectEl);
      const tooltipSpy = vi.spyOn(cs, 'updateTriggerTooltip');

      cs.updateOptions(true);
      expect(tooltipSpy).not.toHaveBeenCalled();

      cs.updateOptions(false);
      expect(tooltipSpy).toHaveBeenCalledTimes(1);
    });

    it('flushes deferred options refresh immediately when open() is called before scheduled rAF completes', () => {
      const selectEl = createTestSelect('deferred-open-sel');
      const cs = new CustomSelect(selectEl);
      const updateSpy = vi.spyOn(cs, 'updateOptions');

      const win = (globalThis as any).window;
      const prevRaf = win.requestAnimationFrame;
      const queued: Array<() => void> = [];
      win.requestAnimationFrame = (cb: () => void) => {
        queued.push(cb);
        return queued.length;
      };

      try {
        scheduleCustomSelectsOptionsRefresh(true, 1);
        expect(queued.length).toBe(1);
        expect(updateSpy).not.toHaveBeenCalled();

        // User opens dropdown before queued rAF chunk runs
        cs.open();
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy).toHaveBeenCalledWith(true);

        // Draining queued rAF afterwards must not re-run updateOptions for the already-flushed select
        queued.forEach(fn => fn());
        expect(updateSpy).toHaveBeenCalledTimes(1);
      } finally {
        win.requestAnimationFrame = prevRaf;
        cs.close();
        cancelScheduledCustomSelectsRefresh();
      }
    });

    it('prepares deferred options refresh on-demand and flushes skipped open selects upon close()', () => {
      const selectEl = createTestSelect('deferred-close-sel');
      const cs = new CustomSelect(selectEl);
      const updateSpy = vi.spyOn(cs, 'updateOptions');

      const win = (globalThis as any).window;
      const prevRaf = win.requestAnimationFrame;
      const queued: Array<() => void> = [];
      win.requestAnimationFrame = (cb: () => void) => {
        queued.push(cb);
        return queued.length;
      };

      try {
        // 1. Register pending refresh immediately (before 800ms scramble completes)
        prepareCustomSelectsOptionsRefresh(true);
        expect(cs.hasPendingOptionsRefresh()).toBe(true);
        expect(updateSpy).not.toHaveBeenCalled();

        // 2. Keep dropdown open while chunked flush runs -> skipped because isOpen === true
        cs.isOpen = true;
        flushPreparedCustomSelectsOptionsRefresh(true, 6);
        queued.forEach(fn => fn());
        expect(updateSpy).not.toHaveBeenCalled();
        expect(cs.hasPendingOptionsRefresh()).toBe(true);

        // 3. Closing dropdown flushes the pending refresh via finalizeCloseVisuals
        cs.isOpen = false;
        cs.close();
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(cs.hasPendingOptionsRefresh()).toBe(false);
      } finally {
        win.requestAnimationFrame = prevRaf;
        cancelScheduledCustomSelectsRefresh();
      }
    });

    it('clears stale trigger title when syncSelectedValue(true) skips tooltip measurement', () => {
      const selectEl = createTestSelect('stale-title-sel');
      const cs = new CustomSelect(selectEl);
      const valEl = cs.trigger?.querySelector('.custom-select-value') as HTMLElement;
      valEl.title = 'Old Language Title';
      cs.trigger!.title = 'Old Language Title';
      const tooltipSpy = vi.spyOn(cs, 'updateTriggerTooltip');

      cs.syncSelectedValue(true);

      expect(tooltipSpy).not.toHaveBeenCalled();
      expect(valEl.getAttribute('title')).toBeNull();
      expect(cs.trigger!.getAttribute('title')).toBeNull();
    });

    it('ignores MutationObserver rebuilds and drains pending records while deferred refresh is armed', () => {
      const takeRecordsSpy = vi.fn(() => [{ type: 'childList' }]);
      let observerCb: (() => void) | null = null;

      const PrevObserver = (globalThis as any).MutationObserver;
      (globalThis as any).MutationObserver = class {
        constructor(cb: () => void) {
          observerCb = cb;
        }
        observe() {}
        disconnect() {}
        takeRecords = takeRecordsSpy;
      };

      try {
        const guardedSelect = createTestSelect('observer-guard-sel');
        const guardedCs = new CustomSelect(guardedSelect);
        const guardedUpdateSpy = vi.spyOn(guardedCs, 'updateOptions');

        guardedCs.setPendingOptionsRefresh(() => {
          guardedCs.updateOptions(true);
        });
        expect(takeRecordsSpy).toHaveBeenCalled();

        // Simulate queued MutationObserver firing while _pendingOptionsRefresh is armed
        expect(observerCb).not.toBeNull();
        observerCb!();
        expect(guardedUpdateSpy).not.toHaveBeenCalled();
        expect(guardedCs.hasPendingOptionsRefresh()).toBe(true);

        // Once opened, pending refresh flushes cleanly
        guardedCs.open();
        expect(guardedUpdateSpy).toHaveBeenCalledTimes(1);
        expect(guardedUpdateSpy).toHaveBeenCalledWith(true);
        guardedCs.close();
        guardedCs.destroy();
      } finally {
        (globalThis as any).MutationObserver = PrevObserver;
      }
    });

    it('exposes global backwards compatibility shims and customSelect controller', () => {
      expect(customSelect.CustomSelect).toBe(CustomSelect);
      expect(customSelect.map).toBe(customSelectsMap);
      expect(typeof customSelect.initAll).toBe('function');
      expect(typeof customSelect.syncAll).toBe('function');
    });
  });
});
