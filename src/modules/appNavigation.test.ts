import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  getActiveView,
  setActiveView,
  switchView,
  applyDynamicDirection,
  refreshDynamicDirectionInputs,
  setupDynamicDirectionInputs,
  setupVerticalTabKeyboardNavigation,
  getCurrentSourceMediaFile
} from './appNavigation';
import { customSelectsMap } from './customSelect';
import { batchProcessor } from './batchProcessor';
import * as transcribePipeline from './transcribePipeline';

class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public value = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public textContent = '';
  public dataset: Record<string, string> = {};
  public eventListeners: Record<string, ((e: any) => void)[]> = {};
  public classList = {
    add: (cls: string) => { if (!this.className.includes(cls)) this.className = `${this.className} ${cls}`.trim(); },
    remove: (cls: string) => { this.className = this.className.replace(cls, '').trim(); },
    contains: (cls: string) => this.className.includes(cls),
    toggle: (cls: string, force?: boolean) => {
      const exists = this.className.includes(cls);
      const shouldHave = force !== undefined ? force : !exists;
      if (shouldHave) this.classList.add(cls);
      else this.classList.remove(cls);
      return shouldHave;
    }
  };
  private attributes: Map<string, string> = new Map();

  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector: string): MockElement | null {
    return this.children.find(c => selector.includes(c.id) || selector.includes(c.className)) || null;
  }

  querySelectorAll(selector: string): MockElement[] {
    return this.children.filter(c => selector.includes(c.className) || selector.includes(c.tagName.toLowerCase()));
  }

  addEventListener(type: string, cb: (e: any) => void) {
    this.eventListeners[type] = this.eventListeners[type] || [];
    this.eventListeners[type].push(cb);
  }

  removeEventListener(type: string, cb: (e: any) => void) {
    if (this.eventListeners[type]) {
      this.eventListeners[type] = this.eventListeners[type].filter(f => f !== cb);
    }
  }

  dispatchEvent(event: any) {
    const list = this.eventListeners[event.type] || [];
    list.forEach(cb => cb(event));
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  focus() {}
}

describe('appNavigation module', () => {
  let navItems: MockElement[];
  let panels: MockElement[];
  let domMap: Map<string, MockElement>;

  beforeEach(() => {
    domMap = new Map();
    navItems = ['transcribe', 'translate', 'hardsub', 'models', 'settings', 'logs'].map(name => {
      const el = new MockElement('DIV');
      el.id = `nav-tab-${name}`;
      el.className = `nav-item ${name === 'transcribe' ? 'active' : ''}`;
      el.dataset.view = name;
      el.setAttribute('tabindex', name === 'transcribe' ? '0' : '-1');
      el.setAttribute('aria-selected', name === 'transcribe' ? 'true' : 'false');
      domMap.set(el.id, el);
      return el;
    });

    panels = ['transcribe', 'translate', 'hardsub', 'models', 'settings', 'logs'].map(name => {
      const el = new MockElement('DIV');
      el.id = `panel-${name}`;
      el.className = `view-panel ${name === 'transcribe' ? 'active' : ''}`;
      domMap.set(el.id, el);
      return el;
    });

    const titleEl = new MockElement('SPAN');
    titleEl.id = 'current-view-title';
    domMap.set('current-view-title', titleEl);

    (globalThis as any).window = globalThis;
    (globalThis as any).document = {
      body: new MockElement('BODY'),
      getElementById: (id: string) => domMap.get(id) || null,
      querySelector: (selector: string) => {
        if (selector === 'sidebar') return new MockElement('SIDEBAR');
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.nav-item') return navItems;
        if (selector === '.view-panel') return panels;
        return [];
      },
      createElement: (tag: string) => new MockElement(tag)
    };

    (globalThis as any).window.hardsubController = {
      setPageActive: vi.fn()
    };
    (globalThis as any).window.translationStudioController = {
      syncFromGlobalSettings: vi.fn(),
      refreshLocalization: vi.fn()
    };
    (globalThis as any).window.requestAnimationFrame = (cb: () => void) => cb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('View State & switchView', () => {
    it('initializes and switches view cleanly', () => {
      setActiveView('transcribe');
      expect(getActiveView()).toBe('transcribe');

      switchView('translate');
      expect(getActiveView()).toBe('translate');

      const transTab = domMap.get('nav-tab-transcribe');
      const translateTab = domMap.get('nav-tab-translate');
      const transPanel = domMap.get('panel-transcribe');
      const translatePanel = domMap.get('panel-translate');

      expect(transTab?.classList.contains('active')).toBe(false);
      expect(transTab?.getAttribute('aria-selected')).toBe('false');
      expect(transTab?.getAttribute('tabindex')).toBe('-1');

      expect(translateTab?.classList.contains('active')).toBe(true);
      expect(translateTab?.getAttribute('aria-selected')).toBe('true');
      expect(translateTab?.getAttribute('tabindex')).toBe('0');

      expect(transPanel?.classList.contains('active')).toBe(false);
      expect(translatePanel?.classList.contains('active')).toBe(true);
    });

    it('informs hardsub controller of page active status', () => {
      switchView('hardsub');
      expect((window as any).hardsubController.setPageActive).toHaveBeenCalledWith(true);

      switchView('settings');
      expect((window as any).hardsubController.setPageActive).toHaveBeenCalledWith(false);
    });

    it('closes open custom dropdowns on view change', () => {
      const mockDropdown = {
        isOpen: true,
        close: vi.fn()
      };
      customSelectsMap.set('test-select', mockDropdown as any);

      switchView('logs');
      expect(mockDropdown.close).toHaveBeenCalled();

      customSelectsMap.delete('test-select');
    });
  });

  describe('Dynamic Direction Helper', () => {
    it('applies RTL direction to Persian/Arabic inputs', () => {
      const input = new MockElement('INPUT');
      input.value = 'سلام دنیا این یک متن آزمایشی است';
      applyDynamicDirection(input as any);

      expect(input.getAttribute('dir')).toBe('rtl');
    });

    it('applies LTR direction to Latin inputs', () => {
      const input = new MockElement('INPUT');
      input.value = 'Hello world English transcription text';
      applyDynamicDirection(input as any);

      expect(input.getAttribute('dir')).toBe('ltr');
    });

    it('refreshDynamicDirectionInputs updates prompt and search inputs across the app', () => {
      const promptInput = new MockElement('INPUT');
      promptInput.id = 'opt-prompt';
      promptInput.value = 'این یک پرامپت فارسی برای مدل است';
      domMap.set('opt-prompt', promptInput);

      const searchInput = new MockElement('INPUT');
      searchInput.id = 'settings-search-input';
      searchInput.value = 'GPU acceleration';
      domMap.set('settings-search-input', searchInput);

      refreshDynamicDirectionInputs();

      expect(promptInput.getAttribute('dir')).toBe('rtl');
      expect(searchInput.getAttribute('dir')).toBe('ltr');
    });
  });

  describe('getCurrentSourceMediaFile', () => {
    it('prefers batch active item in batch mode', () => {
      vi.spyOn(batchProcessor, 'getIsBatchMode').mockReturnValue(true);
      vi.spyOn(batchProcessor, 'getActiveViewerIndex').mockReturnValue(0);
      vi.spyOn(batchProcessor, 'getItems').mockReturnValue([{ path: '/video/batch_item_1.mp4' }] as any);

      expect(getCurrentSourceMediaFile()).toBe('/video/batch_item_1.mp4');

      vi.restoreAllMocks();
    });

    it('falls back to single media file when not in batch mode', () => {
      vi.spyOn(batchProcessor, 'getIsBatchMode').mockReturnValue(false);
      vi.spyOn(transcribePipeline, 'getSelectedMediaFile').mockReturnValue('/video/single_sample.mp4');

      expect(getCurrentSourceMediaFile()).toBe('/video/single_sample.mp4');

      vi.restoreAllMocks();
    });
  });

  describe('Keyboard Navigation', () => {
    it('navigates vertical tablist with Arrow keys', () => {
      setupVerticalTabKeyboardNavigation();

      const firstTab = navItems[0];
      const secondTab = navItems[1];

      const clickSpy = vi.spyOn(secondTab, 'click');

      const arrowDownEvent = { key: 'ArrowDown', type: 'keydown', preventDefault: vi.fn() };
      firstTab.dispatchEvent(arrowDownEvent);

      expect(clickSpy).toHaveBeenCalled();
    });
  });
});
