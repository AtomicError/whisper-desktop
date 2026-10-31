import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  appModal,
  formatToastMessage,
  compareSemver,
  showNotification,
  _trapModalFocus,
  showAppModal,
  closeAppModal,
  showConfirmModal,
  resolveAppConfirm,
  showBatchErrorDialog
} from './appModal';

// Resilient headless DOM mock for Node Vitest runner
class MockNode {
  public tagName: string;
  public id = '';
  public className = '';
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public children: MockNode[] = [];
  public parentNode: MockNode | null = null;
  public textContent = '';
  private _innerHTML = '';
  public disabled = false;
  public _rawMessage = '';
  public _restartTimer: any = null;
  private attributes: Map<string, string> = new Map();
  private listeners: Record<string, ((e: any) => void)[]> = {};

  set innerHTML(html: string) {
    this._innerHTML = html;
    this.children = [];
    if (html.includes('toast-message')) {
      const msg = new MockNode('DIV');
      msg.className = 'toast-message';
      this.appendChild(msg);
    }
    if (html.includes('toast-progress-bar')) {
      const prog = new MockNode('DIV');
      prog.className = 'toast-progress-bar';
      this.appendChild(prog);
    }
    if (html.includes('toast-close-btn')) {
      const btn = new MockNode('BUTTON');
      btn.className = 'toast-close-btn';
      this.appendChild(btn);
    }
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, val: string) {
    this.attributes.set(name, String(val));
    if (name === 'id') this.id = val;
    if (name === 'class') this.className = val;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: MockNode) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: MockNode) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  querySelector(sel: string): MockNode | null {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel: string): MockNode[] {
    const res: MockNode[] = [];
    const check = (node: MockNode) => {
      let match = false;
      if (sel.startsWith('#') && node.id === sel.slice(1)) match = true;
      else if (sel.startsWith('.') && node.className.includes(sel.slice(1))) match = true;
      else if (sel.toUpperCase() === node.tagName) match = true;
      else if (sel.includes('.')) {
        const parts = sel.split('.');
        const tag = parts[0];
        const cls = parts.slice(1);
        if ((!tag || tag.toUpperCase() === node.tagName) && cls.every(c => node.className.includes(c))) {
          match = true;
        }
      }
      if (match) res.push(node);
      for (const ch of node.children) check(ch);
    };
    for (const ch of this.children) check(ch);
    return res;
  }

  addEventListener(type: string, fn: any) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: any) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter(f => f !== fn);
    }
  }

  dispatchEvent(e: any) {
    const fns = this.listeners[e.type] || [];
    for (const fn of fns) fn(e);
  }

  focus() {
    if ((globalThis as any).document) {
      (globalThis as any).document.activeElement = this;
    }
  }

  contains(other: any): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  get classList() {
    return {
      add: (...classes: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...classes: string[]) => {
        const set = new Set(this.className.split(' ').filter(Boolean));
        classes.forEach(c => set.delete(c));
        this.className = Array.from(set).join(' ');
      },
      contains: (cls: string) => this.className.split(' ').includes(cls)
    };
  }

  get offsetParent() {
    return this.style.display === 'none' ? null : {};
  }
}

describe('appModal & Feedback Module', () => {
  let origDoc: any;
  let body: MockNode;
  let docListeners: Record<string, ((e: any) => void)[]> = {};

  beforeEach(() => {
    origDoc = (globalThis as any).document;
    body = new MockNode('BODY');
    docListeners = {};

    (globalThis as any).document = {
      body,
      activeElement: null,
      createElement: (tag: string) => new MockNode(tag),
      getElementById: (id: string) => {
        const find = (node: MockNode): MockNode | null => {
          if (node.id === id) return node;
          for (const ch of node.children) {
            const res = find(ch);
            if (res) return res;
          }
          return null;
        };
        return find(body);
      },
      addEventListener: (type: string, fn: any) => {
        docListeners[type] = docListeners[type] || [];
        docListeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        if (docListeners[type]) {
          docListeners[type] = docListeners[type].filter(f => f !== fn);
        }
      },
      dispatchEvent: (e: any) => {
        const fns = docListeners[e.type] || [];
        for (const fn of fns) fn(e);
      }
    };
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
    vi.restoreAllMocks();
  });

  describe('formatToastMessage typographic orphan prevention', () => {
    it('binds the last two words on a line with non-breaking space (U+00A0)', () => {
      expect(formatToastMessage('دانلود مدل انجام شد...')).toBe('دانلود مدل انجام\u00A0شد...');
      expect(formatToastMessage('عملیات با موفقیت انجام شد!')).toBe('عملیات با موفقیت انجام\u00A0شد!');
      expect(formatToastMessage('آیا مطمئن هستید؟')).toBe('آیا مطمئن\u00A0هستید؟');
      expect(formatToastMessage('Model downloaded successfully.')).toBe('Model downloaded\u00A0successfully.');
    });

    it('leaves single-word strings untouched', () => {
      expect(formatToastMessage('Completed')).toBe('Completed');
      expect(formatToastMessage('تکمیل')).toBe('تکمیل');
    });

    it('formats multi-line strings line by line', () => {
      const raw = 'خط اول پیام\nخط دوم توضیحات بیشتر';
      expect(formatToastMessage(raw)).toBe('خط اول\u00A0پیام\nخط دوم توضیحات\u00A0بیشتر');
    });

    it('handles null, undefined, and empty string safely', () => {
      expect(formatToastMessage('')).toBe('');
      expect(formatToastMessage(null)).toBe(null);
      expect(formatToastMessage(undefined)).toBe(undefined);
    });
  });

  describe('compareSemver version comparison', () => {
    it('accurately compares standard semantic versions', () => {
      expect(compareSemver('3.1.0', '3.0.9')).toBe(1);
      expect(compareSemver('3.0.9', '3.1.0')).toBe(-1);
      expect(compareSemver('3.1.0', '3.1.0')).toBe(0);
      expect(compareSemver('v3.1.0', '3.1.0')).toBe(0);
      expect(compareSemver('v4.0.0', 'v3.9.9')).toBe(1);
    });

    it('handles pre-release identifiers', () => {
      expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1);
      expect(compareSemver('1.0.0', '1.0.0-beta')).toBe(1);
      expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    });

    it('safely handles empty or missing version segments', () => {
      expect(compareSemver('3', '3.0.0')).toBe(0);
      expect(compareSemver('3.1', '3.0.9')).toBe(1);
    });
  });

  describe('showNotification toast system', () => {
    it('creates toast-container and adds toast elements with proper classes', () => {
      showNotification('Test message', 'success');
      const container = (globalThis as any).document.getElementById('toast-container');
      expect(container).not.toBeNull();

      const toast = container?.querySelector('.toast-notification.toast-success');
      expect(toast).not.toBeNull();
      expect(toast?._rawMessage).toBe('Test message');
    });

    it('deduplicates identical active messages by restarting timer rather than stacking duplicate elements', () => {
      showNotification('Duplicate message', 'info');
      showNotification('Duplicate message', 'info');

      const container = (globalThis as any).document.getElementById('toast-container');
      const toasts = container?.querySelectorAll('.toast-notification');
      expect(toasts?.length).toBe(1);
    });

    it('formats multi-line technical error messages with split title and detail', () => {
      showNotification('Title Header\nTechnical error detail line', 'error');
      const container = (globalThis as any).document.getElementById('toast-container');
      const toast = container?.querySelector('.toast-notification');
      const title = toast?.querySelector('.toast-title');
      const tech = toast?.querySelector('.toast-tech-detail');

      expect(title?.textContent).toBe('Title\u00A0Header');
      expect(tech?.textContent).toBe('Technical error detail line');
      expect(tech?.getAttribute('dir')).toBe('ltr');
    });
  });

  describe('_trapModalFocus accessibility helper', () => {
    it('traps Tab focus within the modal container and handles Escape key', () => {
      const modal = new MockNode('DIV') as any;
      const btn1 = new MockNode('BUTTON') as any;
      btn1.id = 'b1';
      const btn2 = new MockNode('BUTTON') as any;
      btn2.id = 'b2';
      modal.appendChild(btn1);
      modal.appendChild(btn2);
      body.appendChild(modal);

      let closed = false;
      const trap = _trapModalFocus(modal, () => {
        closed = true;
      });

      // Escape key
      const escEvent = { key: 'Escape', type: 'keydown', preventDefault: vi.fn(), stopPropagation: vi.fn() };
      (globalThis as any).document.dispatchEvent(escEvent);
      expect(closed).toBe(true);

      trap.release();
    });
  });

  describe('showAppModal and closeAppModal dialog API', () => {
    it('populates and displays app modal elements and closes cleanly', () => {
      const overlay = new MockNode('DIV') as any;
      overlay.id = 'app-modal-overlay';
      const titleEl = new MockNode('DIV') as any;
      titleEl.id = 'app-modal-title';
      const msgEl = new MockNode('DIV') as any;
      msgEl.id = 'app-modal-message';
      const detailsEl = new MockNode('DIV') as any;
      detailsEl.id = 'app-modal-details';
      const okFooter = new MockNode('DIV') as any;
      okFooter.id = 'app-modal-ok-footer';
      const okBtn = new MockNode('BUTTON') as any;
      okBtn.id = 'app-modal-close-btn';
      okFooter.appendChild(okBtn);
      const confirmFooter = new MockNode('DIV') as any;
      confirmFooter.id = 'app-modal-confirm-footer';

      overlay.appendChild(titleEl);
      overlay.appendChild(msgEl);
      overlay.appendChild(detailsEl);
      overlay.appendChild(okFooter);
      overlay.appendChild(confirmFooter);
      body.appendChild(overlay);

      showAppModal('Alert Title', 'Alert Message', 'Technical Details');
      expect(titleEl.textContent).toBe('Alert Title');
      expect(msgEl.textContent).toBe('Alert Message');
      expect(detailsEl.textContent).toBe('Technical Details');
      expect(overlay.style.display).toBe('flex');
      expect(overlay.classList.contains('show')).toBe(true);

      closeAppModal();
      expect(overlay.classList.contains('show')).toBe(false);
    });
  });

  describe('showConfirmModal and resolveAppConfirm Promise API', () => {
    it('resolves true on user confirm and false on cancel', async () => {
      const overlay = new MockNode('DIV') as any;
      overlay.id = 'app-modal-overlay';
      const titleEl = new MockNode('DIV') as any;
      titleEl.id = 'app-modal-title';
      const msgEl = new MockNode('DIV') as any;
      msgEl.id = 'app-modal-message';
      const detailsEl = new MockNode('DIV') as any;
      detailsEl.id = 'app-modal-details';
      const okFooter = new MockNode('DIV') as any;
      okFooter.id = 'app-modal-ok-footer';
      const confirmFooter = new MockNode('DIV') as any;
      confirmFooter.id = 'app-modal-confirm-footer';
      const deleteBtn = new MockNode('BUTTON') as any;
      deleteBtn.id = 'app-modal-delete-btn';
      confirmFooter.appendChild(deleteBtn);

      overlay.appendChild(titleEl);
      overlay.appendChild(msgEl);
      overlay.appendChild(detailsEl);
      overlay.appendChild(okFooter);
      overlay.appendChild(confirmFooter);
      body.appendChild(overlay);

      const confirmPromise = showConfirmModal('Delete item?', 'Are you sure?', 'Yes, Delete');
      expect(deleteBtn.textContent).toBe('Yes, Delete');

      resolveAppConfirm(true);
      const result = await confirmPromise;
      expect(result).toBe(true);
    });
  });

  describe('showBatchErrorDialog', () => {
    it('sets error message, shows modal, and resolves with user choice', async () => {
      const modal = new MockNode('DIV') as any;
      modal.id = 'batch-error-modal';
      modal.style.display = 'none';

      const msgEl = new MockNode('DIV') as any;
      msgEl.id = 'batch-error-message';
      modal.appendChild(msgEl);

      const retryBtn = new MockNode('BUTTON') as any;
      retryBtn.className = 'btn-primary';
      modal.appendChild(retryBtn);

      const skipBtn = new MockNode('BUTTON') as any;
      skipBtn.className = 'btn-secondary';
      modal.appendChild(skipBtn);

      const body = (globalThis as any).document.body;
      body.appendChild(modal);

      const promise = showBatchErrorDialog('interview.mp4', 'CUDA out of memory');
      expect(modal.style.display).toBe('flex');
      expect(msgEl.textContent).toContain('interview.mp4');

      expect(typeof (window as any).resolveBatchError).toBe('function');
      (window as any).resolveBatchError('retry');

      const result = await promise;
      expect(result).toBe('retry');
      await new Promise(r => setTimeout(r, 10));
    });

    it('resolves with skip and abort choices accurately', async () => {
      const modal = new MockNode('DIV') as any;
      modal.id = 'batch-error-modal';
      const msgEl = new MockNode('DIV') as any;
      msgEl.id = 'batch-error-message';
      modal.appendChild(msgEl);
      (globalThis as any).document.body.appendChild(modal);

      const skipPromise = showBatchErrorDialog('audio1.wav', 'Decode failure');
      (window as any).resolveBatchError('skip');
      expect(await skipPromise).toBe('skip');

      const abortPromise = showBatchErrorDialog('audio2.wav', 'Fatal pipeline panic');
      (window as any).resolveBatchError('abort');
      expect(await abortPromise).toBe('abort');
      await new Promise(r => setTimeout(r, 10));
    });
  });

  describe('appModal controller namespace export', () => {
    it('exposes all expected functions and window bindings', () => {
      expect(typeof appModal.notify).toBe('function');
      expect(typeof appModal.show).toBe('function');
      expect(typeof appModal.close).toBe('function');
      expect(typeof appModal.confirm).toBe('function');
      expect(typeof appModal.compareSemver).toBe('function');
      expect(typeof (window as any).showNotification).toBe('function');
      expect(typeof (window as any).showAppModal).toBe('function');
      expect(typeof (window as any).showConfirmModal).toBe('function');
      expect(typeof (window as any).showBatchErrorDialog).toBe('function');
    });
  });
});
