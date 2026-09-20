import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockElement {
  public tagName: string;
  public id: string = '';
  public style: Record<string, string> = {};
  public parent: MockElement | null = null;
  public children: MockElement[] = [];
  public disabled: boolean = false;
  private attributes: Map<string, string> = new Map();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement) {
    child.parent = this;
    this.children.push(child);
  }

  closest(selector: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (selector.includes('display: none') && cur.style.display === 'none') return cur;
      cur = cur.parent;
    }
    return null;
  }

  contains(child: MockElement | null): boolean {
    let cur = child;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parent;
    }
    return false;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (child.tagName === 'BUTTON' || child.tagName === 'INPUT') {
          results.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  focus() {
    (globalThis as any).document.activeElement = this;
  }
}

describe('modal focus trap & accessibility', () => {
  let listeners: Record<string, ((e: any) => void)[]> = {};
  let originalDocument: any;

  beforeEach(() => {
    listeners = {};
    originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      activeElement: null,
      addEventListener: (type: string, fn: (e: any) => void) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: (e: any) => void) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent: (e: any) => {
        const fns = listeners[e.type] || [];
        for (const fn of fns) fn(e);
      },
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  function trapModalFocus(modalEl: MockElement, closeCallback: () => void) {
    let previousActiveElement = (globalThis as any).document.activeElement;

    const isVisible = (el: MockElement) => {
      if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
      if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
      if (el.closest && el.closest('[style*="display: none"]')) return false;
      return true;
    };

    const keyHandler = (e: any) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeCallback();
        return;
      }

      if (e.key === 'Tab') {
        const candidates = modalEl.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const focusable = candidates.filter(isVisible);
        if (!focusable.length) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if ((globalThis as any).document.activeElement === first || !modalEl.contains((globalThis as any).document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if ((globalThis as any).document.activeElement === last || !modalEl.contains((globalThis as any).document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    (globalThis as any).document.addEventListener('keydown', keyHandler);

    return {
      release: () => {
        (globalThis as any).document.removeEventListener('keydown', keyHandler);
        if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
          previousActiveElement.focus();
          previousActiveElement = null;
        }
      }
    };
  }

  it('traps Tab focus only within visible elements, skipping hidden footers', () => {
    const modal = new MockElement('DIV');
    const input1 = new MockElement('INPUT');
    modal.appendChild(input1);

    const okFooter = new MockElement('DIV');
    okFooter.style.display = 'flex';
    const btnOk = new MockElement('BUTTON');
    okFooter.appendChild(btnOk);
    modal.appendChild(okFooter);

    const confirmFooter = new MockElement('DIV');
    confirmFooter.style.display = 'none';
    const btnDelete = new MockElement('BUTTON');
    const btnCancel = new MockElement('BUTTON');
    confirmFooter.appendChild(btnDelete);
    confirmFooter.appendChild(btnCancel);
    modal.appendChild(confirmFooter);

    const closeSpy = vi.fn();
    const trap = trapModalFocus(modal, closeSpy);

    btnOk.focus();
    expect((globalThis as any).document.activeElement).toBe(btnOk);

    // Forward Tab from btnOk should wrap to input1 (skipping hidden btnDelete and btnCancel)
    let defaultPrevented = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });
    expect(defaultPrevented).toBe(true);
    expect((globalThis as any).document.activeElement).toBe(input1);

    // Shift+Tab from input1 should wrap to btnOk
    defaultPrevented = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => {}
    });
    expect(defaultPrevented).toBe(true);
    expect((globalThis as any).document.activeElement).toBe(btnOk);

    // Escape triggers closeCallback
    let stopped = false;
    (globalThis as any).document.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: () => {},
      stopPropagation: () => { stopped = true; }
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);

    trap.release();
  });

  it('restores focus to previous active element upon release', () => {
    const trigger = new MockElement('BUTTON');
    trigger.focus();
    expect((globalThis as any).document.activeElement).toBe(trigger);

    const modal = new MockElement('DIV');
    const modalBtn = new MockElement('BUTTON');
    modal.appendChild(modalBtn);

    const trap = trapModalFocus(modal, vi.fn());
    modalBtn.focus();
    expect((globalThis as any).document.activeElement).toBe(modalBtn);

    trap.release();
    expect((globalThis as any).document.activeElement).toBe(trigger);
  });
});
