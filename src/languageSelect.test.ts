import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguageSelects, refreshLanguageSelects, renderLanguageSelect } from './languageSelect';
import { TRANSLATION_TARGET_LANGUAGES, WHISPER_SPOKEN_LANGUAGES } from './languages';

class FakeOption {
  public tagName = 'OPTION';
  public value = '';
  public textContent = '';
  public attrs = new Map<string, string>();
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
}

class FakeOptGroup {
  public tagName = 'OPTGROUP';
  public children: FakeOption[] = [];
  public attrs = new Map<string, string>();
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  appendChild(child: FakeOption) {
    this.children.push(child);
    return child;
  }
}

class FakeSelect {
  public id = 'test-lang-select';
  public children: Array<FakeOption | FakeOptGroup> = [];
  public value = '';
  set innerHTML(_val: string) {
    this.children = [];
  }
  appendChild(child: FakeOption | FakeOptGroup) {
    this.children.push(child);
    return child;
  }
}

describe('languageSelect', () => {
  let originalDocument: any;
  let originalWindow: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    originalWindow = (globalThis as any).window;
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag.toLowerCase() === 'optgroup') return new FakeOptGroup();
        return new FakeOption();
      }
    };
    (globalThis as any).window = {
      settingsState: {
        language: 'en',
        recentSpokenLanguages: ['en', 'fa', 'hi'],
        translateAiTargetLang: 'Afrikaans',
        recentTranslationTargets: ['Afrikaans', 'Acehnese', 'Nepali']
      }
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it('does not duplicate recent spoken languages inside the All Languages group', () => {
    // Arrange
    const select = new FakeSelect();

    // Act
    renderLanguageSelect(select as unknown as HTMLSelectElement, 'spoken', 'en');

    // Assert
    const groups = select.children.filter((c): c is FakeOptGroup => c.tagName === 'OPTGROUP');
    expect(groups).toHaveLength(2);

    const recentValues = groups[0].children.map(o => o.value);
    const allValues = groups[1].children.map(o => o.value);

    expect(recentValues).toEqual(['en', 'fa', 'hi']);
    for (const recent of recentValues) {
      expect(allValues).not.toContain(recent);
    }
    expect(recentValues.length + allValues.length).toBe(WHISPER_SPOKEN_LANGUAGES.length);
    expect(select.value).toBe('en');
  });

  it('does not duplicate recent translation targets inside the All Languages group', () => {
    // Arrange
    const select = new FakeSelect();

    // Act
    renderLanguageSelect(select as unknown as HTMLSelectElement, 'translation', 'Afrikaans');

    // Assert
    const groups = select.children.filter((c): c is FakeOptGroup => c.tagName === 'OPTGROUP');
    expect(groups).toHaveLength(2);

    const recentValues = groups[0].children.map(o => o.value);
    const allValues = groups[1].children.map(o => o.value);

    expect(recentValues).toEqual(['Afrikaans', 'Acehnese', 'Nepali']);
    for (const recent of recentValues) {
      expect(allValues).not.toContain(recent);
    }
    expect(recentValues.length + allValues.length).toBe(TRANSLATION_TARGET_LANGUAGES.length);
    expect(select.value).toBe('Afrikaans');
  });

  it('canonicalizes case-insensitive target values to match the option value', () => {
    const select = new FakeSelect();
    renderLanguageSelect(select as unknown as HTMLSelectElement, 'translation', 'afrikaans');
    expect(select.value).toBe('Afrikaans');

    const spokenSelect = new FakeSelect();
    renderLanguageSelect(spokenSelect as unknown as HTMLSelectElement, 'spoken', 'FA');
    expect(spokenSelect.value).toBe('fa');
  });

  it('defers active select refresh until reopened dropdown closes again', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(e: any) => void>>();
    const optionsListeners = new Map<string, Array<(e: any) => void>>();
    const select = new FakeSelect() as any;
    select.id = 'opt-language';
    select.dataset = {};
    select.addEventListener = (ev: string, fn: (e: any) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev)!.push(fn);
    };

    const instance = {
      isOpen: true,
      updateOptions: vi.fn(),
      optionsContainer: {
        addEventListener: (ev: string, fn: (e: any) => void) => {
          if (!optionsListeners.has(ev)) optionsListeners.set(ev, []);
          optionsListeners.get(ev)!.push(fn);
        },
        removeEventListener: (ev: string, fn: (e: any) => void) => {
          const list = (optionsListeners.get(ev) || []).filter(h => h !== fn);
          optionsListeners.set(ev, list);
        }
      }
    };

    (globalThis as any).document.getElementById = (id: string) => (id === 'opt-language' ? select : null);
    (globalThis as any).window.addEventListener = vi.fn();
    (globalThis as any).window.customSelectsMap = new Map([['opt-language', instance]]);

    initLanguageSelects();
    instance.updateOptions.mockClear();

    // User picks 'fa' while dropdown stays reopened within 220ms
    select.value = 'fa';
    (listeners.get('change') || []).forEach(fn => fn({}));

    vi.advanceTimersByTime(220);
    // Still open -> must not disruptively re-render while open
    expect(instance.updateOptions).not.toHaveBeenCalled();

    // User closes dropdown -> retry timer refreshes recents cleanly
    instance.isOpen = false;
    vi.advanceTimersByTime(220);
    expect(instance.updateOptions).toHaveBeenCalledTimes(1);
    const groups = select.children.filter((c: any) => c.tagName === 'OPTGROUP');
    expect(groups[0].children[0].value).toBe('fa');

    vi.useRealTimers();
  });

  it('cancels pending active refresh when refreshLanguageSelects() re-renders immediately', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(e: any) => void>>();
    const select = new FakeSelect() as any;
    select.id = 'opt-language';
    select.dataset = {};
    select.addEventListener = (ev: string, fn: (e: any) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev)!.push(fn);
    };

    const instance = {
      isOpen: false,
      updateOptions: vi.fn(),
      optionsContainer: {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    };

    (globalThis as any).document.getElementById = (id: string) => (id === 'opt-language' ? select : null);
    (globalThis as any).window.addEventListener = vi.fn();
    (globalThis as any).window.customSelectsMap = new Map([['opt-language', instance]]);

    initLanguageSelects();
    instance.updateOptions.mockClear();

    select.value = 'fa';
    (listeners.get('change') || []).forEach(fn => fn({}));

    refreshLanguageSelects();
    expect(instance.updateOptions).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(220);
    // Stale deferred refresh was cancelled, so no redundant second updateOptions call occurs
    expect(instance.updateOptions).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('cancels active refresh cleanly when dropdown instance is destroyed while open', () => {
    // Arrange
    vi.useFakeTimers();
    const listeners = new Map<string, Array<(e: any) => void>>();
    const select = new FakeSelect() as any;
    select.id = 'opt-language';
    select.dataset = {};
    select.isConnected = true;
    select.addEventListener = (ev: string, fn: (e: any) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev)!.push(fn);
    };

    const removeEventListenerSpy = vi.fn();
    const instance = {
      isOpen: true,
      updateOptions: vi.fn(),
      optionsContainer: {
        addEventListener: vi.fn(),
        removeEventListener: removeEventListenerSpy
      }
    };

    (globalThis as any).document.getElementById = (id: string) => (id === 'opt-language' ? select : null);
    (globalThis as any).window.addEventListener = vi.fn();
    const winMap = new Map([['opt-language', instance]]);
    (globalThis as any).window.customSelectsMap = winMap;

    initLanguageSelects();
    instance.updateOptions.mockClear();

    // Act: select changes, then instance is destroyed/unregistered while still marked open
    select.value = 'fa';
    (listeners.get('change') || []).forEach(fn => fn({}));
    winMap.delete('opt-language');

    vi.advanceTimersByTime(1000);

    // Assert: cancelled cleanly on first tick without polling forever or updating destroyed instance
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(instance.updateOptions).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
