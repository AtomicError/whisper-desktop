import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./appModal', () => ({
  showNotification: vi.fn(),
  showConfirmModal: vi.fn().mockResolvedValue(true)
}));

import {
  settingsManager,
  formatFFmpegVersion,
  getStepperBounds,
  clampNumberSetting,
  sanitizeSettingsPayload,
  INT_SETTING_KEYS,
  FLOAT_SETTING_KEYS,
  getSettingsState,
  setSettingsState,
  getCompiledBackends,
  setCompiledBackends,
  getActiveSettingsCat,
  setActiveSettingsCat,
  getLocalScannedTransModels,
  setLocalScannedTransModels,
  getLocalScannedVadModels,
  setLocalScannedVadModels,
  incrementNumber,
  decrementNumber,
  safeApplyDynamicDirection,
  syncJsonConfidenceDependency,
  toggleOutputDirCustomField,
  updateTranscribeOutputDirUI,
  switchSettingsCategory,
  clearSettingsSearch,
  executeFilterSettings,
  refreshBuildStatuses,
  toggleQuickVad,
  syncSettingsManagerWindowBindings
} from './settingsManager';

// Headless DOM mock for Node runner
class MockElement {
  public tagName: string;
  public id = '';
  public className = '';
  public value = '';
  public textContent = '';
  public innerHTML = '';
  public title = '';
  public style: Record<string, string> = {};
  public children: MockElement[] = [];
  public childNodes: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public parentNode: MockElement | null = null;
  public firstChild: MockElement | null = null;
  public disabled = false;
  public checked = false;
  public options: MockElement[] = [];
  public selectedIndex = 0;
  public isFocused = false;
  public classList = {
    add: (...cls: string[]) => {
      cls.forEach(c => {
        if (!this.className.split(/\s+/).includes(c)) {
          this.className = `${this.className} ${c}`.trim();
        }
      });
    },
    remove: (...cls: string[]) => {
      cls.forEach(c => {
        this.className = this.className.split(/\s+/).filter(x => x !== c).join(' ').trim();
      });
    },
    contains: (cls: string) => this.className.split(/\s+/).includes(cls),
    toggle: (cls: string, force?: boolean) => {
      const exists = this.className.split(/\s+/).includes(cls);
      const shouldHave = force !== undefined ? force : !exists;
      if (shouldHave) this.classList.add(cls);
      else this.classList.remove(cls);
      return shouldHave;
    }
  };
  private attributes: Map<string, string> = new Map();
  private listeners: Record<string, ((e: any) => void)[]> = {};

  constructor(tag = 'DIV') {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    child.parentNode = this;
    this.children.push(child);
    this.childNodes.push(child);
    if (!this.firstChild) this.firstChild = child;
    if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
      this.options.push(child);
    }
    return child;
  }

  insertBefore(newNode: MockElement, referenceNode: MockElement | null) {
    newNode.parentElement = this;
    newNode.parentNode = this;
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx >= 0) {
      this.children.splice(idx, 0, newNode);
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.children.push(newNode);
      this.childNodes.push(newNode);
    }
    this.firstChild = this.children[0] || null;
    return newNode;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) {
        this.parentElement.children.splice(idx, 1);
        this.parentElement.childNodes.splice(idx, 1);
      }
      this.parentElement.firstChild = this.parentElement.children[0] || null;
    }
  }

  focus() {
    this.isFocused = true;
  }

  scrollIntoView() {}

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector === '.number-input-control' && curr.className.includes('number-input-control')) {
        return curr;
      }
      if (selector === '.setting-control-path' && curr.className.includes('setting-control-path')) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    if (selector === 'button:first-child') return this.children[0] || null;
    if (selector === 'button:last-child') return this.children[this.children.length - 1] || null;
    if (selector === '.cat-match-badge') {
      return this.children.find(c => c.className.includes('cat-match-badge')) || null;
    }
    if (selector === ':scope > .settings-search-group-header' || selector === '.settings-search-group-header') {
      return this.children.find(c => c.className.includes('settings-search-group-header')) || null;
    }
    if (selector === '.setting-title') {
      return this.children.find(c => c.className.includes('setting-title')) || null;
    }
    if (selector === '.setting-desc') {
      return this.children.find(c => c.className.includes('setting-desc')) || null;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (selector === '.setting-card' && child.className.includes('setting-card')) {
          res.push(child);
        } else if (selector === 'select option' && child.tagName === 'OPTION') {
          res.push(child);
        } else if (selector === '.settings-search-group-header' && child.className.includes('settings-search-group-header')) {
          res.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return res;
  }

  addEventListener(type: string, cb: (e: any) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(cb);
  }
}

describe('settingsManager module', () => {
  let elementRegistry: Map<string, MockElement>;

  beforeEach(() => {
    elementRegistry = new Map();
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI__ = {
      core: {
        invoke: vi.fn().mockResolvedValue({})
      }
    };
    const mockBody = new MockElement('BODY');
    (globalThis as any).document = {
      body: mockBody,
      getElementById: vi.fn((id: string) => elementRegistry.get(id) || null),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === '.settings-search-group-header') {
          return Array.from(elementRegistry.values()).filter(e => e.className.includes('settings-search-group-header'));
        }
        if (selector === '.settings-cat-btn') {
          return Array.from(elementRegistry.values()).filter(e => e.className.includes('settings-cat-btn'));
        }
        if (selector === '.settings-group') {
          return Array.from(elementRegistry.values()).filter(e => e.className.includes('settings-group'));
        }
        if (selector === '.number-input-control input') {
          return Array.from(elementRegistry.values()).filter(e => e.closest('.number-input-control') && e.tagName === 'INPUT');
        }
        return [];
      }),
      querySelector: vi.fn((selector: string) => {
        if (selector === '.settings-scroll-container') {
          return new MockElement('DIV');
        }
        return null;
      }),
      createElement: vi.fn((tag: string) => new MockElement(tag))
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatFFmpegVersion', () => {
    it('correctly extracts date from BtbN Git snapshot build', () => {
      const btbNVersion = 'ffmpeg version N-126826-gc0e8b139fd-20260924 Copyright (c) 2000-2026 the FFmpeg developers';
      expect(formatFFmpegVersion(btbNVersion)).toBe('vGit-2026.09');
    });

    it('correctly extracts date from Gyan Git build with hyphens', () => {
      const gyanVersion = 'ffmpeg version 2024-03-07-git-8a1efbb4f2-full_build-www.gyan.dev';
      expect(formatFFmpegVersion(gyanVersion)).toBe('vGit-2024.03');
    });

    it('correctly extracts standard semantic release versions', () => {
      expect(formatFFmpegVersion('ffmpeg version 7.1 Copyright (c)')).toBe('v7.1');
      expect(formatFFmpegVersion('ffmpeg version 7.0.1-1ubuntu0 Copyright (c)')).toBe('v7.0.1');
      expect(formatFFmpegVersion('n6.1.1')).toBe('v6.1.1');
      expect(formatFFmpegVersion('v4.4.2')).toBe('v4.4.2');
    });

    it('correctly formats Git build number when no date is present', () => {
      const buildOnly = 'ffmpeg version N-112345-gabcdef123';
      expect(formatFFmpegVersion(buildOnly)).toBe('vGit-112345');
    });

    it('falls back to Ready for missing or invalid version strings', () => {
      expect(formatFFmpegVersion('')).toBe('Ready');
      expect(formatFFmpegVersion(null)).toBe('Ready');
      expect(formatFFmpegVersion(undefined)).toBe('Ready');
      expect(formatFFmpegVersion('Unknown version')).toBe('Ready');
      expect(formatFFmpegVersion('N/A')).toBe('Ready');
    });
  });

  describe('Stepper Bounds & Clamping', () => {
    it('returns correct bounds for threads and processors', () => {
      expect(getStepperBounds('opt-threads')).toEqual({ min: 1, max: Infinity });
      expect(getStepperBounds('opt-processors')).toEqual({ min: 1, max: Infinity });
    });

    it('returns correct bounds for maxContext and deviceId', () => {
      expect(getStepperBounds('opt-maxContext')).toEqual({ min: -1, max: Infinity });
      expect(getStepperBounds('opt-deviceId')).toEqual({ min: 0, max: Infinity });
      expect(getStepperBounds('opt-maxLen')).toEqual({ min: 0, max: Infinity });
    });

    it('returns strict min and max bounds for beamSize and bestOf', () => {
      expect(getStepperBounds('opt-bestOf')).toEqual({ min: 1, max: 8 });
      expect(getStepperBounds('opt-beamSize')).toEqual({ min: 1, max: 8 });
    });

    it('clamps numeric values strictly within bounds', () => {
      expect(clampNumberSetting('opt-threads', 0)).toBe(1);
      expect(clampNumberSetting('opt-threads', 16)).toBe(16);
      expect(clampNumberSetting('opt-maxContext', -10)).toBe(-1);
      expect(clampNumberSetting('opt-bestOf', 12)).toBe(8);
      expect(clampNumberSetting('opt-bestOf', -2)).toBe(1);
      expect(clampNumberSetting('opt-maxContext', 'invalid')).toBe(-1);
      expect(clampNumberSetting('opt-threads', 'invalid')).toBe(1);
    });
  });

  describe('Payload Sanitization', () => {
    it('coerces and sanitizes numeric integer keys', () => {
      const payload = {
        threads: '6',
        processors: '2',
        maxContext: 'invalid',
        beamSize: '5'
      };
      const cleaned = sanitizeSettingsPayload(payload);
      expect(cleaned.threads).toBe(6);
      expect(cleaned.processors).toBe(2);
      expect(cleaned.maxContext).toBe(-1);
      expect(cleaned.beamSize).toBe(5);
    });

    it('coerces and sanitizes numeric float keys', () => {
      const payload = {
        temperature: '0.2',
        vadThold: '0.6',
        vadMaxSpeech: 'invalid'
      };
      const cleaned = sanitizeSettingsPayload(payload);
      expect(cleaned.temperature).toBe(0.2);
      expect(cleaned.vadThold).toBe(0.6);
      expect(cleaned.vadMaxSpeech).toBe(30.0);
    });

    it('synchronizes autoTransferToTranslate and translateAiEnabled safely', () => {
      const payload1 = { autoTransferToTranslate: true };
      const cleaned1 = sanitizeSettingsPayload(payload1);
      expect(cleaned1.translateAiEnabled).toBe(true);

      const payload2 = { translateAiEnabled: false };
      const cleaned2 = sanitizeSettingsPayload(payload2);
      expect(cleaned2.autoTransferToTranslate).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
      expect(sanitizeSettingsPayload(null)).toBe(null);
      expect(sanitizeSettingsPayload(undefined)).toBe(undefined);
    });
  });

  describe('State Getters & Setters', () => {
    it('manages settingsState and syncs with global window', () => {
      const stateObj = { modelPath: 'test.bin', selectedBackend: 'Vulkan' };
      setSettingsState(stateObj);
      expect(getSettingsState()).toBe(stateObj);
      expect((globalThis as any).window.settingsState).toBe(stateObj);
    });

    it('manages compiledBackends dictionary', () => {
      const backends = { Standard: true, Vulkan: true, CUDA: false };
      setCompiledBackends(backends);
      expect(getCompiledBackends()).toEqual(backends);
      expect((globalThis as any).window.compiledBackends).toEqual(backends);
    });

    it('manages activeSettingsCat', () => {
      setActiveSettingsCat('audio');
      expect(getActiveSettingsCat()).toBe('audio');
      expect((globalThis as any).window.activeSettingsCat).toBe('audio');
    });

    it('manages localScannedTransModels and localScannedVadModels', () => {
      const models = ['/path/to/ggml-base.bin', '/path/to/ggml-small.bin'];
      const vadModels = ['/path/to/silero.bin'];
      setLocalScannedTransModels(models);
      setLocalScannedVadModels(vadModels);
      expect(getLocalScannedTransModels()).toEqual(models);
      expect(getLocalScannedVadModels()).toEqual(vadModels);
    });
  });

  describe('Stepper Increment and Decrement', () => {
    it('increments number and updates input value within bounds', () => {
      const state = { threads: 4 };
      setSettingsState(state);

      const input = new MockElement('INPUT');
      input.id = 'opt-threads';
      input.value = '4';

      const ctrl = new MockElement('DIV');
      ctrl.className = 'number-input-control';
      ctrl.appendChild(new MockElement('BUTTON')); // dec
      ctrl.appendChild(input);
      ctrl.appendChild(new MockElement('BUTTON')); // inc

      elementRegistry.set('opt-threads', input);

      incrementNumber('opt-threads', 1, true);
      expect(input.value).toBe('5');
      expect(state.threads).toBe(5);

      decrementNumber('opt-threads', 2, true);
      expect(input.value).toBe('3');
      expect(state.threads).toBe(3);
    });
  });

  describe('safeApplyDynamicDirection', () => {
    it('invokes window.applyDynamicDirection without throwing when function is defined', () => {
      const applyMock = vi.fn();
      (globalThis as any).window.applyDynamicDirection = applyMock;
      const el = new MockElement('INPUT') as any;

      expect(() => safeApplyDynamicDirection(el)).not.toThrow();
      expect(applyMock).toHaveBeenCalledWith(el);
    });

    it('gracefully handles null element or missing function', () => {
      delete (globalThis as any).window.applyDynamicDirection;
      expect(() => safeApplyDynamicDirection(null)).not.toThrow();
      const el = new MockElement('INPUT') as any;
      expect(() => safeApplyDynamicDirection(el)).not.toThrow();
    });
  });

  describe('syncJsonConfidenceDependency', () => {
    it('disables confidence option when both json switches are unchecked', () => {
      const jsonOpt = new MockElement('INPUT');
      jsonOpt.id = 'opt-outputJson';
      jsonOpt.checked = false;

      const jsonFullOpt = new MockElement('INPUT');
      jsonFullOpt.id = 'opt-outputJsonFull';
      jsonFullOpt.checked = false;

      const confCard = new MockElement('DIV');
      confCard.id = 'card-printConfidence';

      const confInput = new MockElement('INPUT');
      confInput.id = 'opt-printConfidence';
      confInput.checked = true;

      elementRegistry.set('opt-outputJson', jsonOpt);
      elementRegistry.set('opt-outputJsonFull', jsonFullOpt);
      elementRegistry.set('card-printConfidence', confCard);
      elementRegistry.set('opt-printConfidence', confInput);

      const state = { printConfidence: true };
      setSettingsState(state);

      syncJsonConfidenceDependency();

      expect(confCard.style.opacity).toBe('0.45');
      expect(confInput.disabled).toBe(true);
      expect(confInput.checked).toBe(false);
      expect(state.printConfidence).toBe(false);
    });

    it('enables confidence option when json output switch is active', () => {
      const jsonOpt = new MockElement('INPUT');
      jsonOpt.id = 'opt-outputJson';
      jsonOpt.checked = true;

      const confCard = new MockElement('DIV');
      confCard.id = 'card-printConfidence';

      const confInput = new MockElement('INPUT');
      confInput.id = 'opt-printConfidence';
      confInput.disabled = true;

      elementRegistry.set('opt-outputJson', jsonOpt);
      elementRegistry.set('card-printConfidence', confCard);
      elementRegistry.set('opt-printConfidence', confInput);

      syncJsonConfidenceDependency();

      expect(confCard.style.opacity).toBe('1');
      expect(confInput.disabled).toBe(false);
    });
  });

  describe('Output Directory Controls', () => {
    it('toggleOutputDirCustomField toggles custom card visibility', () => {
      const modeSelect = new MockElement('SELECT');
      modeSelect.id = 'opt-outputDirMode';
      modeSelect.value = 'custom';

      const card = new MockElement('DIV');
      card.id = 'output-dir-custom-card';

      const wrap = new MockElement('DIV');
      wrap.id = 'output-dir-custom-wrap';

      elementRegistry.set('opt-outputDirMode', modeSelect);
      elementRegistry.set('output-dir-custom-card', card);
      elementRegistry.set('output-dir-custom-wrap', wrap);

      toggleOutputDirCustomField();
      expect(card.style.display).toBe('flex');
      expect(wrap.style.display).toBe('flex');

      modeSelect.value = 'source';
      toggleOutputDirCustomField();
      expect(card.style.display).toBe('none');
      expect(wrap.style.display).toBe('none');
    });

    it('updateTranscribeOutputDirUI displays custom directory path and reset button', () => {
      const dirText = new MockElement('DIV');
      dirText.id = 'transcribe-output-dir-text';

      const resetBtn = new MockElement('BUTTON');
      resetBtn.id = 'btn-reset-transcribe-dir';

      elementRegistry.set('transcribe-output-dir-text', dirText);
      elementRegistry.set('btn-reset-transcribe-dir', resetBtn);

      setSettingsState({ outputDirMode: 'custom', outputDirPath: '/custom/output' });
      updateTranscribeOutputDirUI();

      expect(dirText.textContent).toBe('/custom/output');
      expect(resetBtn.style.display).toBe('inline-flex');

      setSettingsState({ outputDirMode: 'source', outputDirPath: '' });
      updateTranscribeOutputDirUI();

      expect(resetBtn.style.display).toBe('none');
    });
  });

  describe('Category Switching and Search Filters', () => {
    it('switchSettingsCategory activates target tab and displays corresponding group', () => {
      const tabApp = new MockElement('BUTTON');
      tabApp.id = 'cat-btn-app';
      tabApp.className = 'settings-cat-btn';

      const tabTrans = new MockElement('BUTTON');
      tabTrans.id = 'cat-btn-transcription';
      tabTrans.className = 'settings-cat-btn';

      const groupApp = new MockElement('DIV');
      groupApp.id = 'group-app';
      groupApp.className = 'settings-group';

      const groupTrans = new MockElement('DIV');
      groupTrans.id = 'group-transcription';
      groupTrans.className = 'settings-group';

      elementRegistry.set('cat-btn-app', tabApp);
      elementRegistry.set('cat-btn-transcription', tabTrans);
      elementRegistry.set('group-app', groupApp);
      elementRegistry.set('group-transcription', groupTrans);

      switchSettingsCategory('transcription');

      expect(getActiveSettingsCat()).toBe('transcription');
      expect(tabTrans.classList.contains('active')).toBe(true);
      expect(groupTrans.classList.contains('active')).toBe(true);
      expect(tabApp.classList.contains('active')).toBe(false);
    });

    it('executeFilterSettings filters cards and updates category match counts', () => {
      const tabApp = new MockElement('BUTTON');
      tabApp.id = 'cat-btn-app';
      tabApp.className = 'settings-cat-btn';
      tabApp.textContent = 'General';

      const groupApp = new MockElement('DIV');
      groupApp.id = 'group-app';
      groupApp.className = 'settings-group';

      const card1 = new MockElement('DIV');
      card1.className = 'setting-card';
      const title1 = new MockElement('DIV');
      title1.className = 'setting-title';
      title1.textContent = 'Hardware Acceleration';
      card1.appendChild(title1);

      const card2 = new MockElement('DIV');
      card2.className = 'setting-card';
      const title2 = new MockElement('DIV');
      title2.className = 'setting-title';
      title2.textContent = 'UI Appearance';
      card2.appendChild(title2);

      groupApp.appendChild(card1);
      groupApp.appendChild(card2);

      elementRegistry.set('cat-btn-app', tabApp);
      elementRegistry.set('group-app', groupApp);

      executeFilterSettings('Hardware');

      expect(card1.style.display).toBe('');
      expect(card2.style.display).toBe('none');
      expect(groupApp.classList.contains('active')).toBe(true);
      const badge = tabApp.querySelector('.cat-match-badge');
      expect(badge?.textContent).toBe('1');
    });

    it('clearSettingsSearch clears input and restores view', () => {
      const searchInput = new MockElement('INPUT');
      searchInput.id = 'settings-search-input';
      searchInput.value = 'Whisper';
      elementRegistry.set('settings-search-input', searchInput);

      clearSettingsSearch();
      expect(searchInput.value).toBe('');
      expect(searchInput.isFocused).toBe(true);
    });
  });

  describe('refreshBuildStatuses', () => {
    it('queries backend availability and falls back to Standard CPU when none are compiled', async () => {
      const invokeMock = vi.fn().mockImplementation((cmd, args) => {
        if (cmd === 'check_build') return Promise.resolve(false);
        return Promise.resolve({});
      });
      (globalThis as any).__TAURI__.core.invoke = invokeMock;

      const dropdown = new MockElement('SELECT');
      dropdown.id = 'opt-selectedBackend';
      elementRegistry.set('opt-selectedBackend', dropdown);

      setSettingsState({ selectedBackend: 'Vulkan' });

      await refreshBuildStatuses();

      const backends = getCompiledBackends();
      expect(backends['Standard']).toBe(true);
      expect(getSettingsState().selectedBackend).toBe('Standard');
    });
  });

  describe('toggleQuickVad', () => {
    it('prevents activating VAD when no VAD model is present in system', () => {
      setLocalScannedVadModels([]);
      const state = { vad: false, vadModel: '' };
      setSettingsState(state);

      toggleQuickVad(true);
      expect(state.vad).toBe(false);
    });

    it('toggles VAD state successfully when valid VAD model exists', () => {
      setLocalScannedVadModels(['/path/to/silero_vad.onnx']);
      const state = { vad: false, vadModel: '/path/to/silero_vad.onnx' };
      setSettingsState(state);

      toggleQuickVad(true);
      expect(state.vad).toBe(true);

      toggleQuickVad(false);
      expect(state.vad).toBe(false);
    });
  });

  describe('Window bindings reactive sync', () => {
    beforeEach(() => {
      syncSettingsManagerWindowBindings();
    });

    it('synchronizes settingsState bidirectionally via getters and setters', () => {
      const win = (globalThis as any).window;
      expect(win).toBeDefined();

      // Setting via module setter reflects on window.settingsState
      setSettingsState({ language: 'fa', selectedBackend: 'Vulkan' });
      expect(win.settingsState).toBeDefined();
      expect(win.settingsState.language).toBe('fa');
      expect(win.settingsState.selectedBackend).toBe('Vulkan');

      // Setting via window.settingsState reflects in getSettingsState()
      win.settingsState = { language: 'en', selectedBackend: 'CPU' };
      expect(getSettingsState().language).toBe('en');
      expect(getSettingsState().selectedBackend).toBe('CPU');
    });

    it('synchronizes compiledBackends, scanned models, and active category bidirectionally', () => {
      const win = (globalThis as any).window;

      // compiledBackends
      win.compiledBackends = { Vulkan: true, CUDA: false };
      expect(getCompiledBackends().Vulkan).toBe(true);
      expect(getCompiledBackends().CUDA).toBe(false);

      setCompiledBackends({ Metal: true });
      expect(win.compiledBackends.Metal).toBe(true);

      // localScannedTransModels
      win.localScannedTransModels = ['model-a.bin', 'model-b.bin'];
      expect(getLocalScannedTransModels()).toEqual(['model-a.bin', 'model-b.bin']);

      setLocalScannedTransModels(['model-c.bin']);
      expect(win.localScannedTransModels).toEqual(['model-c.bin']);

      // localScannedVadModels
      win.localScannedVadModels = ['vad-1.onnx'];
      expect(getLocalScannedVadModels()).toEqual(['vad-1.onnx']);

      setLocalScannedVadModels(['vad-2.onnx']);
      expect(win.localScannedVadModels).toEqual(['vad-2.onnx']);

      // activeSettingsCat
      win.activeSettingsCat = 'general';
      expect(getActiveSettingsCat()).toBe('general');

      setActiveSettingsCat('advanced');
      expect(win.activeSettingsCat).toBe('advanced');
    });
  });
});
