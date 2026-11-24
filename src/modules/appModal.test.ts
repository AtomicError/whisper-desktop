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
  showBatchErrorDialog,
  checkForAppUpdates,
  runStartupUpdateCheck,
  fetchLatestRelease,
  renderUpdateCheckerUI,
  getUpdateCheckerState,
  resetUpdateCheckerState,
  syncAppVersionUI,
  _handleShortcutsModalKeydown
} from './appModal';
import { setLatestWhisperEngineStatus } from './transcribeDeckHost';

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
  public hidden = false;
  public title = '';
  public type = '';
  public onclick: any = null;
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

    it('resolves false and allows subsequent confirm modals when closed directly via closeAppModal', async () => {
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

      // First confirm modal closed directly via closeAppModal (e.g., Escape key)
      const firstPromise = showConfirmModal('First title', 'First question');
      closeAppModal();
      const firstResult = await firstPromise;
      expect(firstResult).toBe(false);

      // Second confirm modal must open successfully and not be blocked by stale state
      const secondPromise = showConfirmModal('Second title', 'Second question');
      expect(titleEl.textContent).toBe('Second title');
      resolveAppConfirm(true);
      const secondResult = await secondPromise;
      expect(secondResult).toBe(true);
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

  describe('fetchLatestRelease & Update Checker API', () => {
    let origFetch: any;

    beforeEach(() => {
      origFetch = (globalThis as any).fetch;
      resetUpdateCheckerState();
    });

    afterEach(() => {
      (globalThis as any).fetch = origFetch;
      resetUpdateCheckerState();
    });

    it('sends fetch request with cache: no-store and cache-busting timestamp', async () => {
      let requestedUrl = '';
      let requestOptions: any = null;

      (globalThis as any).fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        requestedUrl = url;
        requestOptions = opts;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v3.1.0',
            html_url: 'https://github.com/AtomicError/whisper-desktop/releases/latest'
          })
        };
      });

      const res = await fetchLatestRelease();
      expect(res.latestTag).toBe('v3.1.0');
      expect(requestedUrl).toContain('https://api.github.com/repos/AtomicError/whisper-desktop/releases/latest?t=');
      expect(requestOptions.cache).toBe('no-store');
      expect(requestOptions.headers['Cache-Control']).toBeUndefined();
      expect(requestOptions.headers['Accept']).toBe('application/vnd.github.v3+json');
    });

    it('throws domain errors on HTTP 403 rate limits and 404 missing release', async () => {
      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403
      });
      await expect(fetchLatestRelease()).rejects.toThrow('Rate limit exceeded');

      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      });
      await expect(fetchLatestRelease()).rejects.toThrow('No release found');
    });

    it('executes consecutive update checks smoothly when button is clicked again', async () => {
      // Arrange DOM tree for update checker card
      const card = new MockNode('DIV');
      card.id = 'about-update-card';
      const iconWrapper = new MockNode('DIV');
      iconWrapper.id = 'about-update-icon-wrapper';
      const statusEl = new MockNode('SPAN');
      statusEl.id = 'about-update-status';
      const subtextEl = new MockNode('SPAN');
      subtextEl.id = 'about-update-subtext';
      const btn = new MockNode('BUTTON');
      btn.id = 'about-update-btn';
      const btnText = new MockNode('SPAN');
      btnText.id = 'about-update-btn-text';
      btn.appendChild(btnText);
      card.appendChild(iconWrapper);
      card.appendChild(statusEl);
      card.appendChild(subtextEl);
      card.appendChild(btn);
      (globalThis as any).document.body.appendChild(card);

      let fetchCallCount = 0;
      (globalThis as any).fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v3.1.0',
            html_url: 'https://github.com/AtomicError/whisper-desktop/releases/latest'
          })
        };
      });

      renderUpdateCheckerUI();
      expect(getUpdateCheckerState().status).toBe('idle');

      // First check
      await checkForAppUpdates();
      expect(fetchCallCount).toBe(1);
      expect(getUpdateCheckerState().status).toBe('up-to-date');
      expect(card.classList.contains('state-up-to-date')).toBe(true);
      expect(btn.disabled).toBe(false);
      expect(typeof btn.onclick).toBe('function');

      // Second check: simulate user clicking the button again
      const secondCheckPromise = btn.onclick();
      expect(getUpdateCheckerState().status).toBe('checking');
      expect(card.classList.contains('state-checking')).toBe(true);
      expect(btn.disabled).toBe(true);

      await secondCheckPromise;
      expect(fetchCallCount).toBe(2);
      expect(getUpdateCheckerState().status).toBe('up-to-date');
      expect(card.classList.contains('state-up-to-date')).toBe(true);
      expect(btn.disabled).toBe(false);
    });

    it('sets available state when a newer version is released', async () => {
      const card = new MockNode('DIV');
      card.id = 'about-update-card';
      const iconWrapper = new MockNode('DIV');
      iconWrapper.id = 'about-update-icon-wrapper';
      const statusEl = new MockNode('SPAN');
      statusEl.id = 'about-update-status';
      const subtextEl = new MockNode('SPAN');
      subtextEl.id = 'about-update-subtext';
      const btn = new MockNode('BUTTON');
      btn.id = 'about-update-btn';
      const btnText = new MockNode('SPAN');
      btnText.id = 'about-update-btn-text';
      btn.appendChild(btnText);
      card.appendChild(iconWrapper);
      card.appendChild(statusEl);
      card.appendChild(subtextEl);
      card.appendChild(btn);
      (globalThis as any).document.body.appendChild(card);

      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v4.0.0',
          html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v4.0.0'
        })
      });

      await checkForAppUpdates();
      expect(getUpdateCheckerState().status).toBe('available');
      expect(getUpdateCheckerState().latestVersion).toBe('v4.0.0');
      expect(card.classList.contains('state-update-available')).toBe(true);
    });

    it('sets error state when network request fails', async () => {
      const card = new MockNode('DIV');
      card.id = 'about-update-card';
      const iconWrapper = new MockNode('DIV');
      iconWrapper.id = 'about-update-icon-wrapper';
      const statusEl = new MockNode('SPAN');
      statusEl.id = 'about-update-status';
      const subtextEl = new MockNode('SPAN');
      subtextEl.id = 'about-update-subtext';
      const btn = new MockNode('BUTTON');
      btn.id = 'about-update-btn';
      const btnText = new MockNode('SPAN');
      btnText.id = 'about-update-btn-text';
      btn.appendChild(btnText);
      card.appendChild(iconWrapper);
      card.appendChild(statusEl);
      card.appendChild(subtextEl);
      card.appendChild(btn);
      (globalThis as any).document.body.appendChild(card);

      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      await checkForAppUpdates();
      expect(getUpdateCheckerState().status).toBe('error');
      expect(getUpdateCheckerState().errorMsg).toBe('Network offline');
      expect(card.classList.contains('state-error')).toBe(true);
    });
  });

  describe('runStartupUpdateCheck, sidebar indicator & one-time toast', () => {
    let origFetch: any;
    let origLocalStorage: any;
    let memStorage: Map<string, string>;

    function setupSidebarAndAboutDom() {
      const sidebarBtn = new MockNode('BUTTON');
      sidebarBtn.id = 'sidebar-about-btn';
      const sidebarBadge = new MockNode('SPAN');
      sidebarBadge.id = 'sidebar-about-update-badge';
      sidebarBadge.hidden = true;
      sidebarBtn.appendChild(sidebarBadge);

      const aboutOverlay = new MockNode('DIV');
      aboutOverlay.id = 'about-modal-overlay';
      aboutOverlay.style.display = 'none';
      const aboutCard = new MockNode('DIV');
      aboutCard.className = 'about-modal-card';
      aboutOverlay.appendChild(aboutCard);

      const body = (globalThis as any).document.body;
      body.appendChild(sidebarBtn);
      body.appendChild(aboutOverlay);
      return { sidebarBtn, sidebarBadge, aboutOverlay };
    }

    beforeEach(() => {
      origFetch = (globalThis as any).fetch;
      origLocalStorage = (globalThis as any).localStorage;
      memStorage = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => (memStorage.has(k) ? memStorage.get(k)! : null),
        setItem: (k: string, v: string) => { memStorage.set(k, String(v)); },
        removeItem: (k: string) => { memStorage.delete(k); },
        clear: () => { memStorage.clear(); }
      };
      resetUpdateCheckerState(true);
    });

    afterEach(() => {
      resetUpdateCheckerState(true);
      (globalThis as any).fetch = origFetch;
      (globalThis as any).localStorage = origLocalStorage;
    });

    it('skips network check when auto-check setting is disabled', async () => {
      // Arrange
      const fetchSpy = vi.fn();
      (globalThis as any).fetch = fetchSpy;

      // Act
      await runStartupUpdateCheck(false);

      // Assert
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getUpdateCheckerState().status).toBe('idle');
    });

    it('updates sidebar badge and shows one-time clickable toast when newer release is found', async () => {
      // Arrange
      const { sidebarBtn, sidebarBadge, aboutOverlay } = setupSidebarAndAboutDom();
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v4.2.0',
          html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v4.2.0'
        })
      });
      (globalThis as any).fetch = fetchSpy;

      // Act — first startup check
      await runStartupUpdateCheck(true);

      // Assert — sidebar badge active + single toast with View button
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getUpdateCheckerState().status).toBe('available');
      expect(sidebarBtn.classList.contains('has-update')).toBe(true);
      expect(sidebarBtn.getAttribute('data-update-available')).toBe('true');
      expect(sidebarBadge.hidden).toBe(false);
      expect(sidebarBadge.textContent.length).toBeGreaterThan(0);

      const toasts = (globalThis as any).document.body.querySelectorAll('.toast-notification');
      expect(toasts.length).toBe(1);
      const actionBtn = toasts[0].querySelector('.toast-action-btn');
      expect(actionBtn).not.toBeNull();

      // Act — click toast action button -> opens About modal
      actionBtn!.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      expect(aboutOverlay.style.display).toBe('flex');
      expect(aboutOverlay.classList.contains('show')).toBe(true);

      // Act — second startup check within TTL for same version
      toasts[0].remove();
      await runStartupUpdateCheck(true);

      // Assert — cached (no extra fetch), sidebar badge stays active, NO duplicate toast
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(sidebarBtn.classList.contains('has-update')).toBe(true);
      expect((globalThis as any).document.body.querySelectorAll('.toast-notification').length).toBe(0);
    });

    it('fails silently on offline/network error without setting error state or showing toast', async () => {
      // Arrange
      const { sidebarBtn, sidebarBadge } = setupSidebarAndAboutDom();
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      // Act
      await runStartupUpdateCheck(true);

      // Assert
      expect(getUpdateCheckerState().status).toBe('idle');
      expect(sidebarBtn.classList.contains('has-update')).toBe(false);
      expect(sidebarBadge.hidden).toBe(true);
      expect((globalThis as any).document.body.querySelectorAll('.toast-notification').length).toBe(0);
    });

    it('treats cached version equal to current version as up-to-date without showing update badge', async () => {
      // Arrange
      const { sidebarBtn, sidebarBadge } = setupSidebarAndAboutDom();
      memStorage.set(
        'whisper_update_check_cache',
        JSON.stringify({
          checkedAt: Date.now(),
          latestVersion: 'v3.1.0',
          releaseUrl: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v3.1.0'
        })
      );
      const fetchSpy = vi.fn();
      (globalThis as any).fetch = fetchSpy;

      // Act
      await runStartupUpdateCheck(true);

      // Assert
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getUpdateCheckerState().status).toBe('up-to-date');
      expect(sidebarBtn.classList.contains('has-update')).toBe(false);
      expect(sidebarBadge.hidden).toBe(true);
      expect((globalThis as any).document.body.querySelectorAll('.toast-notification').length).toBe(0);
    });

    it('normalizes uppercase V tag prefixes, syncs data-i18n-title, and restores focus to sidebar button when opened from toast', async () => {
      // Arrange
      const { sidebarBtn } = setupSidebarAndAboutDom();
      sidebarBtn.setAttribute('data-i18n-title', 'nav.about');
      (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'V4.3.0',
          html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/V4.3.0'
        })
      });

      // Act
      await runStartupUpdateCheck(true);

      // Assert
      expect(getUpdateCheckerState().latestVersion).toBe('v4.3.0');
      expect(sidebarBtn.getAttribute('data-i18n-title')).toBeNull();

      const toast = (globalThis as any).document.body.querySelector('.toast-notification');
      const actionBtn = toast?.querySelector('.toast-action-btn');
      expect(actionBtn).not.toBeNull();

      actionBtn!.focus();
      actionBtn!.dispatchEvent({ type: 'click', stopPropagation: vi.fn() });
      (window as any).closeAboutModal();
      expect((globalThis as any).document.activeElement).toBe(sidebarBtn);
    });

    it('ignores future-dated or non-https cached payloads and fetches fresh release metadata', async () => {
      // Arrange
      setupSidebarAndAboutDom();
      memStorage.set(
        'whisper_update_check_cache',
        JSON.stringify({
          checkedAt: Date.now() + 60_000,
          latestVersion: 'v9.9.9',
          releaseUrl: 'http://insecure.example.com/release'
        })
      );
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v3.1.0',
          html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v3.1.0'
        })
      });
      (globalThis as any).fetch = fetchSpy;

      // Act
      await runStartupUpdateCheck(true);

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(getUpdateCheckerState().status).toBe('up-to-date');
      expect(getUpdateCheckerState().latestVersion).toBe('v3.1.0');
    });

    it('aborts an in-flight silent startup check when a manual check is triggered', async () => {
      // Arrange
      setupSidebarAndAboutDom();
      let silentSignal: AbortSignal | undefined;
      let resolveSilent: ((val: any) => void) | null = null;

      (globalThis as any).fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
        if (!silentSignal) {
          silentSignal = opts?.signal;
          return new Promise((resolve) => {
            resolveSilent = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v4.5.0',
            html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v4.5.0'
          })
        });
      });

      // Act
      const silentPromise = checkForAppUpdates({ silent: true });
      expect(silentSignal?.aborted).toBe(false);

      await checkForAppUpdates();
      expect(silentSignal?.aborted).toBe(true);

      // Resolve superseded silent request with stale data and verify it is ignored
      resolveSilent?.({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v3.1.0',
          html_url: 'https://github.com/AtomicError/whisper-desktop/releases/tag/v3.1.0'
        })
      });
      await silentPromise;

      // Assert
      expect(getUpdateCheckerState().status).toBe('available');
      expect(getUpdateCheckerState().latestVersion).toBe('v4.5.0');
    });
  });

  describe('shortcuts modal dialog controller', () => {
    it('opens and closes shortcuts modal smoothly and handles Escape and question mark keys', () => {
      const overlay = document.createElement('div');
      overlay.id = 'shortcuts-modal-overlay';
      overlay.style.display = 'none';

      const card = document.createElement('div');
      card.className = 'shortcuts-modal-card';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn-shortcuts-close';
      card.appendChild(closeBtn);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      expect(typeof (window as any).openShortcutsModal).toBe('function');
      expect(typeof (window as any).closeShortcutsModal).toBe('function');
      expect(typeof appModal.openShortcuts).toBe('function');
      expect(typeof appModal.closeShortcuts).toBe('function');

      (window as any).openShortcutsModal();
      expect(overlay.style.display).toBe('flex');
      expect(overlay.classList.contains('show')).toBe(true);

      // Trigger Escape key via event handler
      const escEvent = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      _handleShortcutsModalKeydown(escEvent);
      expect(escEvent.preventDefault).toHaveBeenCalled();
      expect(overlay.classList.contains('show')).toBe(false);

      // Test Persian question mark key "؟"
      (window as any).openShortcutsModal();
      expect(overlay.classList.contains('show')).toBe(true);
      const faEvent = { key: '؟', preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
      _handleShortcutsModalKeydown(faEvent);
      expect(faEvent.preventDefault).toHaveBeenCalled();
      expect(overlay.classList.contains('show')).toBe(false);

      overlay.remove();
    });
  });

  describe('appModal controller namespace export', () => {
    it('exposes all expected functions and window bindings', () => {
      expect(typeof appModal.notify).toBe('function');
      expect(typeof appModal.show).toBe('function');
      expect(typeof appModal.close).toBe('function');
      expect(typeof appModal.confirm).toBe('function');
      expect(typeof appModal.compareSemver).toBe('function');
      expect(typeof appModal.openShortcuts).toBe('function');
      expect(typeof appModal.closeShortcuts).toBe('function');
      expect(typeof (window as any).showNotification).toBe('function');
      expect(typeof (window as any).showAppModal).toBe('function');
      expect(typeof (window as any).showConfirmModal).toBe('function');
      expect(typeof (window as any).showBatchErrorDialog).toBe('function');
      expect(typeof (window as any).openShortcutsModal).toBe('function');
      expect(typeof (window as any).closeShortcutsModal).toBe('function');
    });
  });

  describe('syncAppVersionUI live whisper version in Lite/system mode', () => {
    it('shows system whisper-cli version in About modal when unbundled or running system source', () => {
      const whisperEl = document.createElement('span');
      whisperEl.id = 'about-whisper-version-text';
      document.body.appendChild(whisperEl);

      try {
        setLatestWhisperEngineStatus({
          configuredSource: 'system',
          resolvedPath: '/usr/bin/whisper-cli',
          isAvailable: true,
          bundledAvailable: false,
          version: 'whisper.cpp version: 1.9.5-dev',
          availableBackends: ['Standard', 'Vulkan'],
          errorMessage: null
        });
        syncAppVersionUI();
        expect(whisperEl.textContent).toBe('v1.9.5-dev (System)');

        setLatestWhisperEngineStatus({
          configuredSource: 'system',
          resolvedPath: 'Not Found',
          isAvailable: false,
          bundledAvailable: false,
          version: 'N/A',
          availableBackends: [],
          errorMessage: 'Missing'
        });
        syncAppVersionUI();
        expect(whisperEl.textContent).toBe('System (Not Found)');

        setLatestWhisperEngineStatus({
          configuredSource: 'bundled',
          resolvedPath: 'Internal Resources',
          isAvailable: true,
          bundledAvailable: true,
          version: 'v1.9.5',
          availableBackends: ['Standard'],
          errorMessage: null
        });
        syncAppVersionUI();
        expect(whisperEl.textContent).toBe('v1.7.4');
      } finally {
        setLatestWhisperEngineStatus(null);
        whisperEl.remove();
      }
    });
  });

  describe('Modal Close Race & CustomSelect Escape Guard', () => {
    it('does not hide app modal when reopened within 300ms after closeAppModal', () => {
      vi.useFakeTimers();
      try {
        const overlay = new MockNode('DIV');
        overlay.id = 'app-modal-overlay';
        const titleEl = new MockNode('DIV');
        titleEl.id = 'app-modal-title';
        const msgEl = new MockNode('DIV');
        msgEl.id = 'app-modal-message';
        const detailsEl = new MockNode('DIV');
        detailsEl.id = 'app-modal-details';
        body.appendChild(overlay);
        body.appendChild(titleEl);
        body.appendChild(msgEl);
        body.appendChild(detailsEl);

        showAppModal('First', 'Message 1');
        expect(overlay.classList.contains('show')).toBe(true);
        expect(overlay.style.display).toBe('flex');

        closeAppModal();
        expect(overlay.classList.contains('show')).toBe(false);

        vi.advanceTimersByTime(100);
        showAppModal('Second', 'Message 2');
        expect(overlay.classList.contains('show')).toBe(true);
        expect(overlay.style.display).toBe('flex');

        vi.advanceTimersByTime(300);
        expect(overlay.style.display).toBe('flex');
        expect(overlay.classList.contains('show')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips modal Escape close in _trapModalFocus while a CustomSelect dropdown is open', () => {
      const modal = new MockNode('DIV');
      body.appendChild(modal);
      const closeCb = vi.fn();

      const prevQs = (document as any).querySelector;
      (document as any).querySelector = vi.fn().mockImplementation((sel: string) =>
        sel === '.custom-select-options.open' ? new MockNode('DIV') : null
      );

      const trap = _trapModalFocus(modal as any, closeCb);
      try {
        const escOpen = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        (document as any).dispatchEvent({ type: 'keydown', ...escOpen });
        expect(closeCb).not.toHaveBeenCalled();

        ((document as any).querySelector as any).mockReturnValue(null);
        const escClosed = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        (document as any).dispatchEvent({ type: 'keydown', ...escClosed });
        expect(closeCb).toHaveBeenCalledTimes(1);
      } finally {
        trap.release();
        (document as any).querySelector = prevQs;
      }
    });
  });
});
