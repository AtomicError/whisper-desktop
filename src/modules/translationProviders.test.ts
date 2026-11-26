import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  translationProviders,
  toEnglishDigits,
  formatTokensShort,
  parseTokensInput,
  formatNumberForLang,
  isReasoningSupportedModel,
  formatLocalizedNumber,
  POPULAR_PROVIDER_FILTERS,
  openAddProviderModal,
  saveProviderConfig,
  onProviderChanged,
  switchProviderTab,
  saveActiveProviderGeneral,
  togglePasswordVisibility,
  createModelRowElement,
  setActiveModelFromTable,
  fetchActiveProviderModels,
  renderProvidersGrid,
  renderModelsRegistryTable,
  saveActiveProviderModels,
  testTranslationConnection,
  closeProviderModal,
  setupTranslationEventListeners,
  hasPendingProviderGeneralChanges,
  flushPendingProviderGeneralChanges,
  syncProviderModelsFromSettings,
  syncTranslationSettingsViewIfVisible,
  syncActiveModelSelectionUI,
  addManualModelRow,
  type ModelObject
} from './translationProviders';
import { setSettingsState, getSettingsState } from './settingsManager';

describe('translationProviders module', () => {
  beforeEach(() => {
    translationProviders.setModels([]);
    translationProviders.setPage(1);
    translationProviders.setPageSize(20);
    translationProviders.setStatusFilter('all');
  });

  describe('toEnglishDigits conversion', () => {
    it('converts Persian digits to English ASCII digits', () => {
      expect(toEnglishDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
      expect(toEnglishDigits('مدل ۱۲۸k')).toBe('مدل 128k');
    });

    it('converts Arabic digits to English ASCII digits', () => {
      expect(toEnglishDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    });

    it('returns empty string or non-string inputs safely', () => {
      expect(toEnglishDigits('')).toBe('');
      expect(toEnglishDigits(null)).toBe('');
      expect(toEnglishDigits(undefined)).toBe('');
      expect(toEnglishDigits(12345)).toBe('12345');
    });
  });

  describe('formatTokensShort formatting', () => {
    it('formats exact standard model context presets', () => {
      expect(formatTokensShort(2000000)).toBe('2M');
      expect(formatTokensShort(2097152)).toBe('2M');
      expect(formatTokensShort(1000000)).toBe('1M');
      expect(formatTokensShort(1048576)).toBe('1M');
      expect(formatTokensShort(512000)).toBe('512K');
      expect(formatTokensShort(524288)).toBe('512K');
      expect(formatTokensShort(256000)).toBe('256K');
      expect(formatTokensShort(128000)).toBe('128K');
      expect(formatTokensShort(64000)).toBe('64K');
      expect(formatTokensShort(32000)).toBe('32K');
      expect(formatTokensShort(16000)).toBe('16K');
      expect(formatTokensShort(8000)).toBe('8K');
      expect(formatTokensShort(4000)).toBe('4K');
    });

    it('formats arbitrary large numbers with M or K suffixes', () => {
      expect(formatTokensShort(1500000)).toBe('1.5M');
      expect(formatTokensShort(50000)).toBe('50K');
      expect(formatTokensShort(500)).toBe('500');
    });

    it('returns 0 for non-positive or invalid token numbers', () => {
      expect(formatTokensShort(0)).toBe('0');
      expect(formatTokensShort(-100)).toBe('0');
      expect(formatTokensShort(NaN)).toBe('0');
      expect(formatTokensShort('invalid')).toBe('0');
    });
  });

  describe('parseTokensInput parsing', () => {
    it('parses numeric values directly', () => {
      expect(parseTokensInput(128000)).toBe(128000);
      expect(parseTokensInput(0)).toBe(200000);
      expect(parseTokensInput(-5)).toBe(200000);
    });

    it('parses strings with M/Million suffix and Persian numerals', () => {
      expect(parseTokensInput('1M')).toBe(1000000);
      expect(parseTokensInput('1.5m')).toBe(1500000);
      expect(parseTokensInput('2 MILLION')).toBe(2000000);
      expect(parseTokensInput('۱M')).toBe(1000000);
    });

    it('parses strings with K/Thousand suffix and comma formatting', () => {
      expect(parseTokensInput('128K')).toBe(128000);
      expect(parseTokensInput('200k tokens')).toBe(200000);
      expect(parseTokensInput('128,000')).toBe(128000);
      expect(parseTokensInput('۶۴k')).toBe(64000);
    });

    it('falls back safely to 200,000 for invalid inputs', () => {
      expect(parseTokensInput('')).toBe(200000);
      expect(parseTokensInput('abc')).toBe(200000);
      expect(parseTokensInput(null)).toBe(200000);
    });
  });

  describe('formatNumberForLang localization', () => {
    it('formats digits according to active language', () => {
      const origGetLang = (globalThis as any).getLanguage;
      try {
        (globalThis as any).getLanguage = () => 'fa';
        expect(formatNumberForLang(123)).toBe('۱۲۳');

        (globalThis as any).getLanguage = () => 'ar';
        expect(formatNumberForLang(123)).toBe('١٢٣');

        (globalThis as any).getLanguage = () => 'en';
        expect(formatNumberForLang(123)).toBe('123');
      } finally {
        (globalThis as any).getLanguage = origGetLang;
      }
    });

    it('returns empty string for null or undefined', () => {
      expect(formatNumberForLang(null)).toBe('');
      expect(formatNumberForLang(undefined)).toBe('');
    });
  });

  describe('isReasoningSupportedModel detection', () => {
    it('detects reasoning support from boolean property', () => {
      expect(isReasoningSupportedModel({ id: 'm1', supportsReasoning: true })).toBe(true);
      expect(isReasoningSupportedModel({ id: 'm2', supportsReasoning: false })).toBe(false);
      expect(isReasoningSupportedModel({ id: 'm3', supports_reasoning: true })).toBe(true);
    });

    it('falls back to reasoning string if boolean is absent', () => {
      expect(isReasoningSupportedModel({ id: 'm1', reasoning: 'Medium' })).toBe(true);
      expect(isReasoningSupportedModel({ id: 'm2', reasoning: 'none' })).toBe(false);
      expect(isReasoningSupportedModel({ id: 'm3', reasoning: '' })).toBe(false);
    });

    it('returns false for falsy or unsupported models', () => {
      expect(isReasoningSupportedModel(null)).toBe(false);
      expect(isReasoningSupportedModel(undefined)).toBe(false);
    });
  });

  describe('POPULAR_PROVIDER_FILTERS tests', () => {
    it('matches known provider model IDs accurately', () => {
      const openai = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'openai');
      expect(openai?.test('gpt-4o')).toBe(true);
      expect(openai?.test('o1-mini')).toBe(true);
      expect(openai?.test('o3-mini')).toBe(true);
      expect(openai?.test('claude-3-opus')).toBe(false);

      const anthropic = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'anthropic');
      expect(anthropic?.test('claude-3-5-sonnet')).toBe(true);

      const google = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'google');
      expect(google?.test('gemini-2.0-flash')).toBe(true);

      const deepseek = POPULAR_PROVIDER_FILTERS.find(f => f.id === 'deepseek');
      expect(deepseek?.test('deepseek-r1')).toBe(true);
    });
  });

  describe('formatLocalizedNumber utility', () => {
    it('formats localized numbers across locales and fraction digits', () => {
      expect(formatLocalizedNumber(1250.5, 'en', 1)).toBe('1,250.5');
      expect(formatLocalizedNumber(10, 'en', 0)).toBe('10');
      expect(formatLocalizedNumber(null)).toBe('');
      expect(formatLocalizedNumber(NaN)).toBe('');
    });
  });

  describe('translationProviders controller state management', () => {
    it('manages in-memory models and pagination state cleanly', () => {
      const models: ModelObject[] = [
        { id: 'gpt-4o', contextWindow: 128000, reasoning: 'None', enabled: true },
        { id: 'claude-3.5-sonnet', contextWindow: 200000, reasoning: 'None', enabled: true }
      ];

      translationProviders.setModels(models);
      expect(translationProviders.getModels()).toHaveLength(2);
      expect(translationProviders.getModels()[0].id).toBe('gpt-4o');

      translationProviders.setPage(3);
      expect(translationProviders.getPage()).toBe(3);

      translationProviders.setPageSize(50);
      expect(translationProviders.getPageSize()).toBe(50);

      translationProviders.setStatusFilter('reasoning');
      expect(translationProviders.getStatusFilter()).toBe('reasoning');
    });

    it('synchronizes window.currentProviderModels getter and setter for backward compatibility', () => {
      const models: ModelObject[] = [
        { id: 'deepseek-chat', contextWindow: 64000, reasoning: 'None', enabled: true }
      ];

      translationProviders.setModels(models);
      expect((window as any).currentProviderModels).toEqual(models);

      (window as any).currentProviderModels = [{ id: 'gemini-2.0-flash', contextWindow: 1048576 }];
      expect(translationProviders.getModels()).toHaveLength(1);
      expect(translationProviders.getModels()[0].id).toBe('gemini-2.0-flash');
    });
  });

  describe('Provider & Models audit bug regressions', () => {
    let prevDoc: any;
    let prevTauri: any;
    let prevNotify: any;
    let prevRaf: any;
    let registry: Map<string, any>;

    const makeEl = (tag: string, id = ''): any => {
      const el: any = {
        tagName: tag.toUpperCase(),
        id,
        className: '',
        value: '',
        checked: false,
        disabled: false,
        type: 'text',
        placeholder: '',
        textContent: '',
        _innerHTML: '',
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children: [] as any[],
        options: [] as any[],
        listeners: {} as Record<string, ((e: any) => void)[]>,
        nextElementSibling: null as any,
        classList: {
          add(cls: string) {
            const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
            set.add(cls);
            el.className = Array.from(set).join(' ');
          },
          remove(cls: string) {
            const set = new Set((el.className || '').split(/\s+/).filter(Boolean));
            set.delete(cls);
            el.className = Array.from(set).join(' ');
          },
          contains(cls: string) {
            return (el.className || '').split(/\s+/).filter(Boolean).includes(cls);
          }
        },
        setAttribute(k: string, v: string) {
          el[`_attr_${k}`] = v;
        },
        getAttribute(k: string) {
          return el[`_attr_${k}`] ?? null;
        },
        removeAttribute(k: string) {
          delete el[`_attr_${k}`];
          if (k === 'title') el.title = '';
        },
        appendChild(child: any) {
          el.children.push(child);
          if (el.tagName === 'SELECT' && child.tagName === 'OPTION') el.options.push(child);
          return child;
        },
        addEventListener(type: string, fn: (e: any) => void) {
          el.listeners[type] = el.listeners[type] || [];
          el.listeners[type].push(fn);
        },
        removeEventListener(type: string, fn: (e: any) => void) {
          el.listeners[type] = (el.listeners[type] || []).filter((f: any) => f !== fn);
        },
        dispatchClick(targetOverride?: any) {
          const ev = { target: targetOverride || el, stopPropagation: () => {}, preventDefault: () => {} };
          (el.listeners.click || []).forEach((fn: any) => fn(ev));
        },
        closest(sel: string) {
          if (sel.startsWith('.') && el.classList.contains(sel.slice(1))) return el;
          return null;
        },
        querySelector(sel: string) {
          if (sel === '.td-active') return el._tdActive || null;
          if (sel === '.td-action') return el._tdAction || null;
          if (sel === '.model-id-display') return el._idDisplay || null;
          if (sel === '.model-id-input') return el._idInput || null;
          if (sel === '.model-radio-btn') return el._radioBtn || null;
          if (sel === '.model-btn-trash') return el._trashBtn || null;
          if (sel === 'svg') return null;
          return null;
        },
        querySelectorAll(sel: string) {
          if (sel === '.model-data-row') return el.children.filter((c: any) => c.classList.contains('model-data-row'));
          return [];
        },
        focus() {},
        select() {},
        get innerHTML() {
          return el._innerHTML;
        },
        set innerHTML(v: string) {
          el._innerHTML = v;
          if (v.includes('td-active')) {
            el._tdActive = makeEl('div');
            el._tdAction = makeEl('div');
            el._idDisplay = makeEl('div');
            el._idDisplay.replaceWith = (inputNode: any) => {
              el._replacedInput = inputNode;
            };
          }
          if (v.includes('model-id-input')) {
            el._idInput = makeEl('input');
          }
        }
      };
      if (id) registry.set(id, el);
      return el;
    };

    beforeEach(() => {
      prevDoc = (globalThis as any).document;
      prevTauri = (globalThis as any).window.__TAURI__;
      prevNotify = (globalThis as any).window.showNotification;
      prevRaf = (globalThis as any).requestAnimationFrame;
      registry = new Map();

      (globalThis as any).requestAnimationFrame = (cb: () => void) => {
        cb();
        return 0;
      };
      (globalThis as any).window.showNotification = vi.fn();
      (globalThis as any).document = {
        getElementById: (id: string) => registry.get(id) || null,
        createElement: (tag: string) => makeEl(tag),
        createDocumentFragment: () => makeEl('fragment'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelector: () => null,
        querySelectorAll: () => []
      };
    });

    afterEach(() => {
      (globalThis as any).document = prevDoc;
      (globalThis as any).window.__TAURI__ = prevTauri;
      (globalThis as any).window.showNotification = prevNotify;
      (globalThis as any).requestAnimationFrame = prevRaf;
      vi.restoreAllMocks();
    });

    it('respects #provider-use-keyring checkbox, checks duplicate before storing credential, and resets checkbox on openAddProviderModal', async () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const nameEl = makeEl('input', 'provider-name');
      const urlEl = makeEl('input', 'provider-url');
      const fmtEl = makeEl('select', 'provider-format');
      const keyEl = makeEl('input', 'provider-key');
      const keyringChk = makeEl('input', 'provider-use-keyring');
      const modal = makeEl('div', 'translation-provider-modal');
      modal.querySelectorAll = () => [];

      keyringChk.checked = false;
      openAddProviderModal();
      expect(keyringChk.checked).toBe(true);

      // Case 1: User unchecks system keyring storage
      setSettingsState({ translateAiProviders: '[]', translateAiProvider: '' });
      nameEl.value = 'LocalProxy';
      urlEl.value = 'https://proxy.local/v1';
      fmtEl.value = 'Chat completions';
      keyEl.value = 'plain-secret-key';
      keyringChk.checked = false;

      await saveProviderConfig();

      expect(invokeSpy).not.toHaveBeenCalledWith('store_keyring_credential', expect.anything());
      const savedProviders = JSON.parse(getSettingsState().translateAiProviders);
      expect(savedProviders[0].apiKey).toBe('plain-secret-key');
      expect(savedProviders[0].useKeyring).toBe(false);

      // Case 2: Duplicate name does not touch keyring before failing validation
      invokeSpy.mockClear();
      keyringChk.checked = true;
      nameEl.value = 'LocalProxy';
      urlEl.value = 'https://other.local/v1';
      keyEl.value = 'should-not-overwrite-keyring';
      await saveProviderConfig();
      expect(invokeSpy).not.toHaveBeenCalledWith('store_keyring_credential', expect.anything());
    });

    it('preserves keyring secret when get_keyring_credential fails on provider load and another field saves', async () => {
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_keyring_credential') return Promise.reject(new Error('Keyring locked'));
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'OpenAI';
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'provider-manager-card');
      const urlInput = makeEl('input', 'mgr-provider-url');
      const fmtSelect = makeEl('select', 'mgr-provider-format');
      const keyInput = makeEl('input', 'mgr-provider-key');
      const eyeBtn = makeEl('button');
      keyInput.nextElementSibling = eyeBtn;
      const promptEl = makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: '',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '__KEYRING__', useKeyring: true, models: [] }
        ])
      });

      onProviderChanged('general');
      await new Promise(r => setTimeout(r, 0));

      expect(keyInput.value).toBe('••••••••••••••••');
      expect(keyInput.dataset.isKeyring).toBe('true');
      expect(keyInput.dataset.keyringError).toBe('true');

      // Clicking eye button keeps input as password on keyring error
      await togglePasswordVisibility('mgr-provider-key', eyeBtn);
      expect(keyInput.type).toBe('password');

      // Changing another field and saving must NOT delete the keyring secret
      urlInput.value = 'https://api.openai.com/v2';
      promptEl.value = 'Updated prompt';
      await saveActiveProviderGeneral(true);

      expect(invokeSpy).not.toHaveBeenCalledWith('delete_keyring_credential', expect.anything());
      const providersAfter = JSON.parse(getSettingsState().translateAiProviders);
      expect(providersAfter[0].apiKey).toBe('__KEYRING__');
      expect(providersAfter[0].useKeyring).toBe(true);
    });

    it('keeps row activation, deletion, and rename accurate after in-place setActiveModelFromTable', async () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const tbody = makeEl('div', 'mgr-models-tbody');
      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'OpenRouter';
      makeEl('select', 'opt-translateAiModel');

      const modelA: ModelObject = { id: 'model-a', contextWindow: 128000, reasoning: 'None', enabled: true };
      const modelB: ModelObject = { id: 'model-b', contextWindow: 128000, reasoning: 'None', enabled: true };
      translationProviders.setModels([modelA, modelB]);
      setSettingsState({
        translateAiProvider: 'OpenRouter',
        translateAiModel: 'model-a',
        translateAiProviders: JSON.stringify([
          { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', useKeyring: false, models: [modelA, modelB] }
        ])
      });

      const rowA = createModelRowElement(modelA, true, 0);
      const rowB = createModelRowElement(modelB, false, 1);
      tbody.appendChild(rowA);
      tbody.appendChild(rowB);

      // Switch active model from A -> B in-place
      await setActiveModelFromTable('model-b');
      expect(getSettingsState().translateAiModel).toBe('model-b');
      expect(rowA.classList.contains('active-model-row')).toBe(false);
      expect(rowB.classList.contains('active-model-row')).toBe(true);

      // Renaming newly active row B (while still the same in-place DOM row created with isActive=false) updates translateAiModel
      (rowB as any)._idDisplay.listeners.dblclick[0]({ stopPropagation: () => {} });
      const renameInput = (rowB as any)._replacedInput;
      renameInput.value = 'model-b-renamed';
      renameInput.listeners.keydown[0]({ key: 'Enter', preventDefault: () => {} });
      expect(getSettingsState().translateAiModel).toBe('model-b-renamed');

      // Re-create rows cleanly for reactivation & delete check on previously active row A
      const freshA = createModelRowElement(modelA, true, 0);
      const freshB = createModelRowElement(modelB, false, 1);
      tbody.children = [freshA, freshB];
      setSettingsState({
        translateAiProvider: 'OpenRouter',
        translateAiModel: 'model-a',
        translateAiProviders: JSON.stringify([
          { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', useKeyring: false, models: [modelA, modelB] }
        ])
      });
      await setActiveModelFromTable('model-b-renamed');

      // Previously active row A can now be re-activated
      (freshA as any).dispatchClick();
      await Promise.resolve();
      expect(getSettingsState().translateAiModel).toBe('model-a');

      // Switch back to model-b-renamed, then delete A (must succeed instead of triggering cannotDeleteActiveModel)
      await setActiveModelFromTable('model-b-renamed');
      const trashTarget = { closest: (s: string) => (s === '.model-btn-trash' ? {} : null) };
      (freshA as any).dispatchClick(trashTarget);
      expect(translationProviders.getModels().map(m => m.id)).toEqual(['model-b-renamed']);
    });

    it('does not overwrite active provider B models when provider A fetchActiveProviderModels completes late', async () => {
      let resolveFetch!: (val: any) => void;
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'fetch_provider_models') {
          return new Promise(res => {
            resolveFetch = res;
          });
        }
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'ProviderA';
      const urlInput = makeEl('input', 'mgr-provider-url');
      urlInput.value = 'https://a.example/v1';
      makeEl('select', 'mgr-provider-format').value = 'Chat completions';
      makeEl('input', 'mgr-provider-key').value = 'key-a';
      makeEl('button', 'mgr-btn-fetch-models');

      const existingBModels: ModelObject[] = [{ id: 'b-only-model', contextWindow: 64000, reasoning: 'None', enabled: true }];
      translationProviders.setModels(existingBModels);
      setSettingsState({
        translateAiProvider: 'ProviderA',
        translateAiModel: '',
        translateAiProviders: JSON.stringify([
          { name: 'ProviderA', baseUrl: 'https://a.example/v1', apiKey: 'key-a', useKeyring: false, models: [] },
          { name: 'ProviderB', baseUrl: 'https://b.example/v1', apiKey: 'key-b', useKeyring: false, models: existingBModels }
        ])
      });

      const fetchPromise = fetchActiveProviderModels();
      await Promise.resolve();

      // Switch active provider to ProviderB before ProviderA response arrives
      getSettingsState().translateAiProvider = 'ProviderB';
      getSettingsState().translateAiModel = 'b-only-model';
      translationProviders.setModels(existingBModels);

      resolveFetch([{ id: 'a-fetched-model', contextWindow: 128000 }]);
      await fetchPromise;

      // Active provider B state and currentProviderModels must remain untouched
      expect(getSettingsState().translateAiProvider).toBe('ProviderB');
      expect(getSettingsState().translateAiModel).toBe('b-only-model');
      expect(translationProviders.getModels().map(m => m.id)).toEqual(['b-only-model']);

      // ProviderA got its fetched models persisted cleanly
      const updatedProviders = JSON.parse(getSettingsState().translateAiProviders);
      const provA = updatedProviders.find((p: any) => p.name === 'ProviderA');
      const provB = updatedProviders.find((p: any) => p.name === 'ProviderB');
      expect(provA.models.map((m: any) => m.id)).toEqual(['a-fetched-model']);
      expect(provB.models.map((m: any) => m.id)).toEqual(['b-only-model']);
    });

    it('syncs CustomSelect widgets on onProviderChanged so #mgr-provider-format stays updated', () => {
      const syncSpy = vi.fn();
      (globalThis as any).window.syncCustomSelects = syncSpy;

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'Anthropic';
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'provider-manager-card');
      makeEl('input', 'mgr-provider-url');
      const fmtSelect = makeEl('select', 'mgr-provider-format');
      makeEl('input', 'mgr-provider-key');
      makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'Anthropic',
        translateAiModel: '',
        translateAiProviders: JSON.stringify([
          { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiFormat: 'Anthropic messages', apiKey: 'sk', useKeyring: false, models: [] }
        ])
      });

      onProviderChanged('general', true);
      expect(fmtSelect.value).toBe('Anthropic messages');
      expect(syncSpy).toHaveBeenCalledWith(false, true);
      delete (globalThis as any).window.syncCustomSelects;
    });

    it('aborts testTranslationConnection when #mgr-provider-url is cleared instead of testing stale baseUrl', async () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'OpenAI';
      const urlInput = makeEl('input', 'mgr-provider-url');
      urlInput.value = '';
      makeEl('select', 'mgr-provider-format').value = 'Chat completions';
      makeEl('input', 'mgr-provider-key').value = 'sk-test';
      const testBtn = makeEl('button', 'mgr-btn-test-connection');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://stale.example/v1', apiKey: 'sk-test', useKeyring: false, models: [{ id: 'gpt-4o' }] }
        ])
      });

      await testTranslationConnection();

      expect(invokeSpy).not.toHaveBeenCalledWith('preview_translate_first_lines', expect.anything());
      expect(testBtn.disabled).toBe(false);
    });

    it('preserves maxOutputTokens and vision across render, save, and fetch merges', async () => {
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'fetch_provider_models') {
          return Promise.resolve([{ id: 'claude-sonnet', contextWindow: 200000 }]);
        }
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'Anthropic';
      makeEl('select', 'opt-translateAiModel');
      makeEl('input', 'mgr-provider-url').value = 'https://api.anthropic.com';
      makeEl('select', 'mgr-provider-format').value = 'Anthropic messages';
      makeEl('input', 'mgr-provider-key').value = 'sk-ant';
      makeEl('button', 'mgr-btn-fetch-models');

      const initialModel = {
        id: 'claude-sonnet',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        vision: true,
        reasoning: 'Medium',
        supportsReasoning: true,
        enabled: true
      };
      setSettingsState({
        translateAiProvider: 'Anthropic',
        translateAiModel: 'claude-sonnet',
        translateAiProviders: JSON.stringify([
          { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant', useKeyring: false, models: [initialModel] }
        ])
      });

      renderModelsRegistryTable({ name: 'Anthropic', models: [initialModel] });
      expect(translationProviders.getModels()[0].maxOutputTokens).toBe(8192);
      expect(translationProviders.getModels()[0].vision).toBe(true);

      await saveActiveProviderModels(true, true, 'Anthropic');
      let saved = JSON.parse(getSettingsState().translateAiProviders);
      expect(saved[0].models[0].maxOutputTokens).toBe(8192);
      expect(saved[0].models[0].vision).toBe(true);

      await fetchActiveProviderModels();
      saved = JSON.parse(getSettingsState().translateAiProviders);
      expect(saved[0].models[0].maxOutputTokens).toBe(8192);
      expect(saved[0].models[0].vision).toBe(true);
    });

    it('does not activate row when clicking inline-editable .model-id-display or .model-ctx-value', () => {
      const modelA: ModelObject = { id: 'model-a', contextWindow: 128000, reasoning: 'None', enabled: true };
      const modelB: ModelObject = { id: 'model-b', contextWindow: 128000, reasoning: 'None', enabled: true };
      translationProviders.setModels([modelA, modelB]);
      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'model-a',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', useKeyring: false, models: [modelA, modelB] }
        ])
      });

      const rowB = createModelRowElement(modelB, false, 1);
      (rowB as any).dispatchClick({ closest: (s: string) => (s === '.model-id-display' ? {} : null) });
      expect(getSettingsState().translateAiModel).toBe('model-a');

      (rowB as any).dispatchClick({ closest: (s: string) => (s === '.model-ctx-value' ? {} : null) });
      expect(getSettingsState().translateAiModel).toBe('model-a');
    });

    it('flushes debounced model catalog edits synchronously via flushPendingModelCatalogChanges', () => {
      const modelA: ModelObject = { id: 'model-a', contextWindow: 128000, reasoning: 'None', enabled: true };
      const modelB: ModelObject = { id: 'model-b', contextWindow: 64000, reasoning: 'None', enabled: true };
      translationProviders.setModels([modelA, modelB]);
      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'model-a',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', useKeyring: false, models: [modelA, modelB] }
        ])
      });

      const rowB = createModelRowElement(modelB, false, 1);
      (rowB as any).dispatchClick({ closest: (s: string) => (s === '.model-btn-trash' ? {} : null) });

      expect(translationProviders.getModels().map(m => m.id)).toEqual(['model-a']);
      const flushed = translationProviders.flushPendingModelCatalogChanges();
      expect(flushed).toBe(true);

      const savedProviders = JSON.parse(getSettingsState().translateAiProviders);
      expect(savedProviders[0].models.map((m: any) => m.id)).toEqual(['model-a']);
      expect(translationProviders.flushPendingModelCatalogChanges()).toBe(false);
    });

    it('unlocks #mgr-btn-fetch-models when switching providers mid-fetch and ignores stale finally resets', async () => {
      let resolveFetchA!: (models: any[]) => void;
      const invokeSpy = vi.fn().mockImplementation((cmd: string, args?: any) => {
        if (cmd === 'fetch_provider_models' && args?.baseUrl === 'https://a.example/v1') {
          return new Promise(res => { resolveFetchA = res; });
        }
        if (cmd === 'fetch_provider_models' && args?.baseUrl === 'https://b.example/v1') {
          return Promise.resolve([{ id: 'b-model', contextWindow: 64000 }]);
        }
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'ProviderA';
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'provider-manager-card');
      const urlInput = makeEl('input', 'mgr-provider-url');
      urlInput.value = 'https://a.example/v1';
      makeEl('select', 'mgr-provider-format').value = 'Chat completions';
      makeEl('input', 'mgr-provider-key').value = 'key-a';
      const fetchBtn = makeEl('button', 'mgr-btn-fetch-models');
      fetchBtn.innerHTML = '<span>Fetch Models</span>';

      setSettingsState({
        translateAiProvider: 'ProviderA',
        translateAiModel: '',
        translateAiProviders: JSON.stringify([
          { name: 'ProviderA', baseUrl: 'https://a.example/v1', apiKey: 'key-a', useKeyring: false, models: [] },
          { name: 'ProviderB', baseUrl: 'https://b.example/v1', apiKey: 'key-b', useKeyring: false, models: [] }
        ])
      });

      const fetchAPromise = fetchActiveProviderModels();
      expect(fetchBtn.disabled).toBe(true);

      provSelect.value = 'ProviderB';
      onProviderChanged(true, true);
      expect(fetchBtn.disabled).toBe(false);
      expect(fetchBtn.innerHTML).toBe('<span>Fetch Models</span>');

      await fetchActiveProviderModels();
      expect(fetchBtn.disabled).toBe(false);

      resolveFetchA([{ id: 'a-model', contextWindow: 128000 }]);
      await fetchAPromise;

      const providersAfter = JSON.parse(getSettingsState().translateAiProviders);
      expect(providersAfter.find((p: any) => p.name === 'ProviderA').models.map((m: any) => m.id)).toEqual(['a-model']);
      expect(providersAfter.find((p: any) => p.name === 'ProviderB').models.map((m: any) => m.id)).toEqual(['b-model']);
    });

    it('filters disabled models consistently in saveActiveProviderModels and updates aria-selected in switchProviderTab', async () => {
      (globalThis as any).window.__TAURI__ = { core: { invoke: vi.fn().mockResolvedValue(undefined) } };

      const modelSelect = makeEl('select', 'opt-translateAiModel');
      const disabledModel: ModelObject = { id: 'disabled-m', contextWindow: 64000, reasoning: 'None', enabled: false };
      const enabledModel: ModelObject = { id: 'enabled-m', contextWindow: 128000, reasoning: 'None', enabled: true };
      translationProviders.setModels([disabledModel, enabledModel]);

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'disabled-m',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', useKeyring: false, models: [disabledModel, enabledModel] }
        ])
      });

      await saveActiveProviderModels(true, true, 'OpenAI');
      expect(getSettingsState().translateAiModel).toBe('enabled-m');
      expect(modelSelect.options.map((o: any) => o.value)).toEqual(['enabled-m']);

      const btnAuto = makeEl('button', 'tab-btn-auto');
      const btnGen = makeEl('button', 'tab-btn-general');
      makeEl('div', 'provider-tab-auto');
      makeEl('div', 'provider-tab-general');
      switchProviderTab('general');
      expect(btnAuto.getAttribute('aria-selected')).toBe('false');
      expect(btnGen.getAttribute('aria-selected')).toBe('true');
    });

    it('restores testBtn.disabled when testTranslationConnection returns early without modal DOM', async () => {
      (globalThis as any).window.__TAURI__ = { core: { invoke: vi.fn().mockResolvedValue(undefined) } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'OpenAI';
      makeEl('input', 'mgr-provider-url').value = 'https://api.openai.com/v1';
      makeEl('select', 'mgr-provider-format').value = 'Chat completions';
      makeEl('input', 'mgr-provider-key').value = 'sk-test';
      const testBtn = makeEl('button', 'mgr-btn-test-connection');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', useKeyring: false, models: [{ id: 'gpt-4o' }] }
        ])
      });

      await testTranslationConnection();
      expect(testBtn.disabled).toBe(false);
    });

    it('clears currentProviderModels and destroys row CustomSelects when no provider remains in onProviderChanged', () => {
      const destroyMock = vi.fn();
      const staleSel = makeEl('select', 'model-reasoning-stale');
      staleSel.className = 'model-reasoning-select';
      staleSel.dataset = { customSelectInitialized: 'true' };

      const tbody = makeEl('tbody', 'mgr-models-tbody');
      tbody.children = [staleSel];
      tbody.querySelectorAll = (sel: string) => (sel.includes('model-reasoning-select') ? [staleSel] : []);

      (globalThis as any).window.customSelectsMap = new Map([
        ['model-reasoning-stale', { destroy: destroyMock }]
      ]);

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = '';
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'provider-manager-card');
      const countEl = makeEl('span', 'provider-models-count');

      translationProviders.setModels([
        { id: 'stale-model', contextWindow: 128000, reasoning: 'None', vision: false, enabled: true }
      ]);
      setSettingsState({
        translateAiProvider: '',
        translateAiModel: '',
        translateAiProviders: '[]'
      });

      onProviderChanged(true, false);

      expect(destroyMock).toHaveBeenCalledTimes(1);
      expect(translationProviders.getModels()).toEqual([]);
      expect(countEl.textContent).toBe('0');
      expect((globalThis as any).window.customSelectsMap.size).toBe(0);
    });

    it('renders provider tiles and add-tile with keyboard button semantics and delete button type', () => {
      const grid = makeEl('div', 'providers-tiles-grid');
      grid.appendChild = (child: any) => {
        grid.children.push(child);
        return child;
      };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      const opt1 = makeEl('option');
      opt1.value = 'OpenAI';
      provSelect.appendChild(opt1);
      provSelect.value = 'OpenAI';

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', apiFormat: 'Chat completions', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [] }
        ])
      });

      renderProvidersGrid();

      expect(grid.children.length).toBe(2);
      const tile = grid.children[0];
      const addTile = grid.children[1];
      expect(tile.getAttribute('role')).toBe('button');
      expect(tile.tabIndex).toBe(0);
      expect(tile.getAttribute('aria-pressed')).toBe('true');
      expect(tile.innerHTML).toContain('type="button"');
      expect(addTile.getAttribute('role')).toBe('button');
      expect(addTile.tabIndex).toBe(0);
    });

    it('preserves useKeyring: false on edit and supports toggling #mgr-provider-use-keyring migration', async () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'CustomProvider';
      const urlInput = makeEl('input', 'mgr-provider-url');
      const fmtSelect = makeEl('select', 'mgr-provider-format');
      const keyInput = makeEl('input', 'mgr-provider-key');
      const keyringChk = makeEl('input', 'mgr-provider-use-keyring');
      const promptInput = makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'CustomProvider',
        translateAiProviders: JSON.stringify([
          { name: 'CustomProvider', baseUrl: 'https://old.example/v1', apiFormat: 'Chat completions', apiKey: 'plain-key', useKeyring: false, models: [] }
        ])
      });

      // Case 1: Editing URL with useKeyring unchecked preserves plaintext storage
      urlInput.value = 'https://new.example/v1';
      fmtSelect.value = 'Chat completions';
      keyInput.value = 'plain-key';
      keyringChk.checked = false;
      promptInput.value = '';
      await saveActiveProviderGeneral(true);

      let saved = JSON.parse(getSettingsState().translateAiProviders)[0];
      expect(saved.baseUrl).toBe('https://new.example/v1');
      expect(saved.useKeyring).toBe(false);
      expect(saved.apiKey).toBe('plain-key');
      expect(invokeSpy).not.toHaveBeenCalledWith('store_keyring_credential', expect.anything());

      // Case 2: Toggling #mgr-provider-use-keyring ON migrates key into OS keyring
      keyringChk.checked = true;
      await saveActiveProviderGeneral(true);
      expect(invokeSpy).toHaveBeenCalledWith('store_keyring_credential', {
        providerName: 'CustomProvider',
        key: 'plain-key'
      });
      saved = JSON.parse(getSettingsState().translateAiProviders)[0];
      expect(saved.useKeyring).toBe(true);
      expect(saved.apiKey).toBe('__KEYRING__');

      // Case 3: Toggling #mgr-provider-use-keyring OFF migrates back to plaintext and removes keyring secret
      invokeSpy.mockClear();
      invokeSpy.mockImplementation((cmd: string) => {
        if (cmd === 'get_keyring_credential') return Promise.resolve('recovered-keyring-key');
        return Promise.resolve(undefined);
      });
      keyInput.value = '••••••••••••••••';
      keyInput.dataset.isKeyring = 'true';
      keyringChk.checked = false;
      await saveActiveProviderGeneral(true);
      expect(invokeSpy).toHaveBeenCalledWith('delete_keyring_credential', { providerName: 'CustomProvider' });
      saved = JSON.parse(getSettingsState().translateAiProviders)[0];
      expect(saved.useKeyring).toBe(false);
      expect(saved.apiKey).toBe('recovered-keyring-key');
    });

    it('guards togglePasswordVisibility against provider switches and resets eye state on onProviderChanged', async () => {
      let resolveKeyring!: (val: string) => void;
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'get_keyring_credential') {
          return new Promise<string>(res => {
            resolveKeyring = res;
          });
        }
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'ProvA';
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'provider-manager-card');
      makeEl('input', 'mgr-provider-url');
      makeEl('select', 'mgr-provider-format');
      const keyInput = makeEl('input', 'mgr-provider-key');
      keyInput.type = 'password';
      keyInput.value = '••••••••••••••••';
      keyInput.dataset.isKeyring = 'true';
      const svgEl = makeEl('svg');
      const eyeBtn = makeEl('button');
      eyeBtn.querySelector = (sel: string) => (sel === 'svg' ? svgEl : null);
      keyInput.nextElementSibling = eyeBtn;
      makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'ProvA',
        translateAiProviders: JSON.stringify([
          { name: 'ProvA', baseUrl: 'https://a.example/v1', apiKey: '__KEYRING__', useKeyring: true, models: [] },
          { name: 'ProvB', baseUrl: 'https://b.example/v1', apiKey: 'b-plain-key', useKeyring: false, models: [] }
        ])
      });

      // Reveal key for ProvA, then switch to ProvB before keyring resolves
      const revealPromise = togglePasswordVisibility('mgr-provider-key', eyeBtn as any);
      provSelect.value = 'ProvB';
      getSettingsState().translateAiProvider = 'ProvB';
      onProviderChanged('general', true);

      resolveKeyring('secret-from-prov-a');
      await revealPromise;

      expect(keyInput.value).toBe('b-plain-key');
      expect(keyInput.type).toBe('password');
      expect(svgEl.innerHTML).toContain('M1 12s4-8 11-8');
    });

    it('rejects duplicate model IDs case-insensitively on inline rename and manual row blur', () => {
      const m1: ModelObject = { id: 'gpt-4o', contextWindow: 128000, reasoning: 'None', enabled: true };
      const m2: ModelObject = { id: 'claude-sonnet', contextWindow: 200000, reasoning: 'None', enabled: true };
      translationProviders.setModels([m1, m2]);
      setSettingsState({
        translateAiProvider: 'OpenRouter',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', useKeyring: false, models: [m1, m2] }
        ])
      });

      const row2 = createModelRowElement(m2, false, 1);
      (row2 as any)._idDisplay.listeners.dblclick[0]({ stopPropagation: () => {} });
      const renameInput = (row2 as any)._replacedInput;
      renameInput.value = 'GPT-4O';
      renameInput.listeners.keydown[0]({ key: 'Enter', preventDefault: () => {} });

      // Duplicate rename must be ignored and original model ID preserved
      expect(m2.id).toBe('claude-sonnet');
      expect((globalThis as any).window.showNotification).toHaveBeenCalled();

      // Manual blank row entering duplicate ID gets removed cleanly on blur
      ((globalThis as any).window.showNotification as any).mockClear();
      addManualModelRow('', 200000, 'None', false, false);
      const draftRow = createModelRowElement(translationProviders.getModels()[0], false, 0);
      const idInput = draftRow.querySelector('.model-id-input') as any;
      idInput.value = 'GPT-4O';
      idInput.listeners.input[0]();
      idInput.listeners.blur[0]();

      expect(translationProviders.getModels().map(m => m.id)).toEqual(['gpt-4o', 'claude-sonnet']);
      expect((globalThis as any).window.showNotification).toHaveBeenCalled();
    });

    it('guards saveProviderConfig double-submits, resets #provider-format, and prevents closeProviderModal timeout race', async () => {
      vi.useFakeTimers();
      try {
        let resolveKeyring!: () => void;
        const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
          if (cmd === 'store_keyring_credential') {
            return new Promise<void>(res => {
              resolveKeyring = res;
            });
          }
          return Promise.resolve(undefined);
        });
        (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

        const modal = makeEl('div', 'translation-provider-modal');
        modal.querySelectorAll = () => [];
        const nameEl = makeEl('input', 'provider-name');
        const urlEl = makeEl('input', 'provider-url');
        const fmtEl = makeEl('select', 'provider-format');
        const keyEl = makeEl('input', 'provider-key');
        const keyringChk = makeEl('input', 'provider-use-keyring');
        const saveBtn = makeEl('button', 'provider-modal-save-btn');

        // Closing then quickly reopening must not hide modal after 300ms
        openAddProviderModal();
        closeProviderModal();
        vi.advanceTimersByTime(100);
        fmtEl.value = 'Responses';
        openAddProviderModal();
        expect(fmtEl.value).toBe('Chat completions');
        vi.advanceTimersByTime(300);
        expect(modal.style.display).toBe('flex');
        expect(modal.classList.contains('show')).toBe(true);

        // Concurrent double click while store_keyring_credential is in flight runs only once
        setSettingsState({ translateAiProviders: '[]', translateAiProvider: '' });
        nameEl.value = 'FastProvider';
        urlEl.value = 'https://fast.example/v1';
        keyEl.value = 'secret-1';
        keyringChk.checked = true;

        const firstSave = saveProviderConfig();
        const secondSave = saveProviderConfig();
        expect(saveBtn.disabled).toBe(true);

        resolveKeyring();
        await Promise.all([firstSave, secondSave]);

        const saved = JSON.parse(getSettingsState().translateAiProviders);
        expect(saved.length).toBe(1);
        expect(saveBtn.disabled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('tracks dirty provider general edits and flushes them via flushPendingProviderGeneralChanges', async () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const provSelect = makeEl('select', 'opt-translateAiProvider');
      provSelect.value = 'OpenAI';
      const urlInput = makeEl('input', 'mgr-provider-url');
      urlInput.value = 'https://api.openai.com/v1';
      makeEl('select', 'mgr-provider-format').value = 'Chat completions';
      const keyInput = makeEl('input', 'mgr-provider-key');
      keyInput.value = 'sk-old';
      makeEl('input', 'mgr-provider-use-keyring').checked = false;
      makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiProviders: JSON.stringify([
          { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-old', useKeyring: false, models: [] }
        ])
      });

      setupTranslationEventListeners();
      expect(hasPendingProviderGeneralChanges()).toBe(false);
      expect(flushPendingProviderGeneralChanges()).toBeNull();

      urlInput.value = 'https://api.custom.openai.com/v1';
      urlInput.listeners.input[0]();
      expect(hasPendingProviderGeneralChanges()).toBe(true);

      const flushPromise = flushPendingProviderGeneralChanges();
      expect(flushPromise).not.toBeNull();
      await flushPromise;

      expect(hasPendingProviderGeneralChanges()).toBe(false);
      const saved = JSON.parse(getSettingsState().translateAiProviders)[0];
      expect(saved.baseUrl).toBe('https://api.custom.openai.com/v1');
    });

    it('does not overwrite newly selected provider models after onProviderChanged(..., true) followed by switchProviderTab("models")', async () => {
      makeEl('div', 'provider-manager-card');
      const provSelect = makeEl('select', 'opt-translateAiProvider');
      const modelSelect = makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'providers-tiles-grid');
      makeEl('div', 'general-placeholder-overlay');
      makeEl('div', 'general-config-fields');
      makeEl('div', 'models-placeholder-overlay');
      makeEl('div', 'models-catalog-fields');
      makeEl('div', 'models-table-body');
      makeEl('span', 'provider-models-count');
      makeEl('div', 'provider-tab-auto');
      makeEl('div', 'provider-tab-providers');
      makeEl('div', 'provider-tab-general');
      makeEl('div', 'provider-tab-models');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-1',
            useKeyring: false,
            models: [{ id: 'gpt-4o', contextWindow: 128000, enabled: true }]
          },
          {
            name: 'Anthropic',
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-2',
            useKeyring: false,
            models: [{ id: 'claude-sonnet-4', contextWindow: 200000, enabled: true }]
          }
        ])
      });

      // Initial load renders OpenAI into currentProviderModels
      provSelect.value = 'OpenAI';
      onProviderChanged('general', false);
      expect(translationProviders.getModels().map(m => m.id)).toEqual(['gpt-4o']);

      // Simulate Translation Studio switching provider with skipTableRender=true
      provSelect.value = 'Anthropic';
      onProviderChanged(true, true);
      expect(translationProviders.getModels().map(m => m.id)).toEqual(['claude-sonnet-4']);

      // Opening the Models tab in Settings must render & save Anthropic's models, never OpenAI's
      switchProviderTab('models');
      await saveActiveProviderModels(true, true);

      const savedProviders = JSON.parse(getSettingsState().translateAiProviders);
      const anthropic = savedProviders.find((p: any) => p.name === 'Anthropic');
      const openai = savedProviders.find((p: any) => p.name === 'OpenAI');
      expect(anthropic.models.map((m: any) => m.id)).toEqual(['claude-sonnet-4']);
      expect(openai.models.map((m: any) => m.id)).toEqual(['gpt-4o']);
      expect(modelSelect.value).toBe('claude-sonnet-4');
    });

    it('syncProviderModelsFromSettings refreshes cached currentProviderModels without calling saveCurrentSettings', async () => {
      makeEl('div', 'provider-manager-card');
      const provSelect = makeEl('select', 'opt-translateAiProvider');
      const modelSelect = makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'providers-tiles-grid');
      makeEl('div', 'general-placeholder-overlay');
      makeEl('div', 'general-config-fields');
      makeEl('div', 'models-placeholder-overlay');
      makeEl('div', 'models-catalog-fields');
      makeEl('div', 'models-table-body');
      makeEl('span', 'provider-models-count');
      makeEl('div', 'provider-tab-auto');
      makeEl('div', 'provider-tab-providers');
      makeEl('div', 'provider-tab-general');
      makeEl('div', 'provider-tab-models');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-1',
            useKeyring: false,
            models: [{ id: 'gpt-4o', contextWindow: 128000, enabled: true }]
          }
        ])
      });

      provSelect.value = 'OpenAI';
      onProviderChanged('general', false);
      expect(translationProviders.getModels()[0].contextWindow).toBe(128000);

      // Simulate backend translation-model-limits-updated mutating settingsState.translateAiProviders
      const prevSave = (globalThis as any).window.saveCurrentSettings;
      const saveSpy = vi.fn();
      (globalThis as any).window.saveCurrentSettings = saveSpy;
      try {
        getSettingsState().translateAiProviders = JSON.stringify([
          {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-1',
            useKeyring: false,
            models: [{ id: 'gpt-4o', contextWindow: 32768, maxOutputTokens: 8192, enabled: true }]
          }
        ]);

        syncProviderModelsFromSettings();
        expect(saveSpy).not.toHaveBeenCalled();
        expect(translationProviders.getModels()[0].contextWindow).toBe(32768);
        expect(translationProviders.getModels()[0].maxOutputTokens).toBe(8192);
        expect(modelSelect.value).toBe('gpt-4o');

        // Subsequent saveActiveProviderModels must preserve the reactively learned limits
        await saveActiveProviderModels(true, true);
        const saved = JSON.parse(getSettingsState().translateAiProviders)[0];
        expect(saved.models[0].contextWindow).toBe(32768);
        expect(saved.models[0].maxOutputTokens).toBe(8192);
      } finally {
        (globalThis as any).window.saveCurrentSettings = prevSave;
      }
    });

    it('defers keyring unlock when switching provider outside Settings and syncs stale Models table & pending keyring on return', async () => {
      const invokeSpy = vi.fn().mockImplementation((cmd: string, args: any) => {
        if (cmd === 'get_keyring_credential') return Promise.resolve(`secret-for-${args.providerName}`);
        return Promise.resolve(undefined);
      });
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      const settingsPanel = makeEl('section', 'panel-settings');
      const translationGroup = makeEl('div', 'group-translation');
      translationGroup.classList.add('active');
      makeEl('div', 'provider-manager-card');
      const provSelect = makeEl('select', 'opt-translateAiProvider');
      makeEl('select', 'opt-translateAiModel');
      makeEl('div', 'providers-tiles-grid');
      makeEl('div', 'general-placeholder-overlay');
      makeEl('div', 'general-config-fields');
      makeEl('div', 'models-placeholder-overlay');
      makeEl('div', 'models-catalog-fields');
      const tbody = makeEl('div', 'mgr-models-tbody');
      tbody.appendChild = (child: any) => {
        if (child && child.tagName === 'FRAGMENT' && Array.isArray(child.children)) {
          tbody.children.push(...child.children);
        } else {
          tbody.children.push(child);
        }
        return child;
      };
      const origInnerHtmlDescriptor = Object.getOwnPropertyDescriptor(tbody, 'innerHTML');
      Object.defineProperty(tbody, 'innerHTML', {
        get: () => origInnerHtmlDescriptor?.get?.call(tbody) ?? tbody._innerHTML,
        set: (v: string) => {
          tbody.children = [];
          origInnerHtmlDescriptor?.set?.call(tbody, v);
        },
        configurable: true,
      });
      makeEl('div', 'models-table-body');
      const countEl = makeEl('span', 'provider-models-count');
      const genTab = makeEl('div', 'provider-tab-general');
      const modelsTab = makeEl('div', 'provider-tab-models');
      makeEl('div', 'provider-tab-auto');
      makeEl('div', 'provider-tab-providers');
      makeEl('input', 'mgr-provider-url');
      makeEl('select', 'mgr-provider-format');
      const keyInput = makeEl('input', 'mgr-provider-key');
      keyInput.nextElementSibling = makeEl('button');
      makeEl('textarea', 'mgr-provider-prompt');

      setSettingsState({
        translateAiProvider: 'OpenAI',
        translateAiModel: 'gpt-4o',
        translateAiProviders: JSON.stringify([
          {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-1',
            useKeyring: false,
            models: [{ id: 'gpt-4o', contextWindow: 128000, enabled: true }]
          },
          {
            name: 'Anthropic',
            baseUrl: 'https://api.anthropic.com',
            apiKey: '__KEYRING__',
            useKeyring: true,
            models: [
              { id: 'claude-sonnet-4', contextWindow: 200000, enabled: true },
              { id: 'claude-haiku-4', contextWindow: 200000, enabled: true }
            ]
          }
        ])
      });

      // Initially Settings -> Models tab rendered OpenAI
      settingsPanel.classList.add('active');
      modelsTab.style.display = 'block';
      genTab.style.display = 'none';
      provSelect.value = 'OpenAI';
      onProviderChanged('models', false);
      expect(countEl.textContent).toBe('1');
      expect(tbody.querySelectorAll('.model-data-row').map((r: any) => r.dataset.modelId)).toEqual(['gpt-4o']);

      // Leave Settings and switch provider from Translation Studio
      settingsPanel.classList.remove('active');
      provSelect.value = 'Anthropic';
      onProviderChanged(true, true);

      expect(countEl.textContent).toBe('2');
      expect(keyInput.dataset.keyringPending).toBe('true');
      expect(invokeSpy).not.toHaveBeenCalledWith('get_keyring_credential', expect.anything());

      // Return to Settings while Models tab is already visible -> table refreshes to Anthropic
      settingsPanel.classList.add('active');
      syncTranslationSettingsViewIfVisible();
      expect(tbody.querySelectorAll('.model-data-row').map((r: any) => r.dataset.modelId)).toEqual([
        'claude-sonnet-4',
        'claude-haiku-4',
      ]);
      expect(invokeSpy).not.toHaveBeenCalledWith('get_keyring_credential', expect.anything());

      // syncActiveModelSelectionUI updates active row highlight to claude-haiku-4
      getSettingsState().translateAiModel = 'claude-haiku-4';
      syncActiveModelSelectionUI('claude-haiku-4');
      const haikuRow = tbody.querySelectorAll('.model-data-row').find((r: any) => r.dataset.modelId === 'claude-haiku-4');
      expect(haikuRow.classList.contains('active-model-row')).toBe(true);

      // Opening General tab flushes the deferred keyring fetch
      modelsTab.style.display = 'none';
      genTab.style.display = 'block';
      switchProviderTab('general');
      await new Promise(r => setTimeout(r, 0));
      expect(invokeSpy).toHaveBeenCalledWith('get_keyring_credential', { providerName: 'Anthropic' });
      expect(keyInput.value).toBe('secret-for-Anthropic');
      expect(keyInput.dataset.keyringPending).toBeUndefined();
    });
  });
});
