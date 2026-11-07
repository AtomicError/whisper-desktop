import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  CustomSelect,
  customSelectsMap,
  initializeCustomSelects,
  syncCustomSelects,
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

  closest(selector: string): MockDOMNode | null {
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) {
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
  focus() {}
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
  });

  describe('Searchable Dropdown and Optgroup Filtering', () => {
    it('renders search input for select with data-searchable', () => {
      const selectEl = createTestSelect();
      selectEl.setAttribute('data-searchable', 'true');
      const cs = new CustomSelect(selectEl);

      expect(cs.isSearchable()).toBe(true);
      expect(cs.searchInput).toBeDefined();
      expect(cs.searchRow).toBeDefined();
      expect(cs.noResultsRow).toBeDefined();
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

    it('exposes global backwards compatibility shims and customSelect controller', () => {
      expect(customSelect.CustomSelect).toBe(CustomSelect);
      expect(customSelect.map).toBe(customSelectsMap);
      expect(typeof customSelect.initAll).toBe('function');
      expect(typeof customSelect.syncAll).toBe('function');
    });
  });
});
