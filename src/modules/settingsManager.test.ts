import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./appModal', () => ({
  showNotification: vi.fn(),
  showConfirmModal: vi.fn().mockResolvedValue(true)
}));

import { showConfirmModal } from './appModal';

import {
  settingsManager,
  bindSettingsToDOM,
  formatFFmpegVersion,
  formatWhisperVersion,
  refreshFFmpegStatus,
  refreshWhisperStatus,
  resyncEngineSourceControls,
  validateExecutionEnginesPreflight,
  isFfmpegBundledAvailable,
  isWhisperBundledAvailable,
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
  toggleQuickOutputFormat,
  applyRecommendedThreads,
  setQuickRangeMode,
  resetTranscribeTimeRange,
  updateTranscribeRangeVisibility,
  validateAndApplyQuickTimeRange,
  capturePlayerTimeForRange,
  syncQuickTimeRangeUI,
  setQuickMaxLen,
  activateCustomMaxLen,
  stepQuickMaxLen,
  syncQuickAdvancedUI,
  updateTranscribeUIConfigs,
  setupNumberInputControls,
  setupQuickConfigDeckEventListeners,
  setTranscribeOutputDirMode,
  browseTranscribeOutputDir,
  syncSettingsManagerWindowBindings,
  markSettingsDirty,
  flushPendingSettingsOnUnload,
  filterSettings,
  saveCurrentSettings,
  confirmResetWhisperEngine
} from './settingsManager';
import { switchTheme, applyUiZoom } from './themeManager';
import { resetQuickDeckState } from './transcribeQuickDeck';
import { setLanguage, t } from '../i18n/index';

// Headless DOM mock for Node runner
class MockElement {
  public tagName: string;
  public id = '';
  public type = '';
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
    if (selector === 'input') return this.children.find(c => c.tagName === 'INPUT') || null;
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

  dispatchEvent(event: { type: string; [key: string]: any }) {
    const list = this.listeners[event.type] || [];
    for (const cb of list) {
      cb(event);
    }
    return true;
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

  describe('formatWhisperVersion', () => {
    it('correctly extracts whisper.cpp version string', () => {
      expect(formatWhisperVersion('whisper.cpp version: 1.9.5-dev')).toBe('v1.9.5-dev');
      expect(formatWhisperVersion('whisper.cpp version: v2.0.0')).toBe('v2.0.0');
      expect(formatWhisperVersion('whisper.cpp version: 1.8.2')).toBe('v1.8.2');
    });

    it('handles direct semantic version strings', () => {
      expect(formatWhisperVersion('1.9.5')).toBe('v1.9.5');
      expect(formatWhisperVersion('v1.9.5')).toBe('v1.9.5');
    });

    it('falls back to Ready for missing or invalid version strings', () => {
      expect(formatWhisperVersion('')).toBe('Ready');
      expect(formatWhisperVersion(null)).toBe('Ready');
      expect(formatWhisperVersion(undefined)).toBe('Ready');
      expect(formatWhisperVersion('Unknown version')).toBe('Ready');
      expect(formatWhisperVersion('N/A')).toBe('Ready');
    });
  });

  describe('refreshWhisperStatus', () => {
    it('updates badge to ready when whisper status is available', async () => {
      const badge = new MockElement('span');
      badge.id = 'whisper-status-badge';
      (document.getElementById as any).mockReturnValue(badge);

      (window as any).__TAURI__.core.invoke = vi.fn().mockResolvedValue({
        isAvailable: true,
        configuredSource: 'system',
        resolvedPath: '/usr/bin/whisper-cli',
        version: 'whisper.cpp version: 1.9.5-dev',
        availableBackends: ['Standard', 'Vulkan', 'OpenVINO'],
        errorMessage: null
      });

      await refreshWhisperStatus('system');

      expect(badge.className).toBe('setting-status-pill ready');
      expect(badge.innerHTML).toContain('v1.9.5-dev');
      expect(badge.title).toContain('/usr/bin/whisper-cli');
      expect(badge.title).toContain('Vulkan, OpenVINO');
    });

    it('updates badge to missing when whisper-cli is not found', async () => {
      const badge = new MockElement('span');
      badge.id = 'whisper-status-badge';
      (document.getElementById as any).mockReturnValue(badge);

      (window as any).__TAURI__.core.invoke = vi.fn().mockResolvedValue({
        isAvailable: false,
        configuredSource: 'system',
        resolvedPath: 'Not Found',
        version: 'N/A',
        availableBackends: [],
        errorMessage: 'System whisper-cli not found'
      });

      await refreshWhisperStatus('system', false);

      expect(badge.className).toBe('setting-status-pill missing');
      expect(badge.innerHTML).toContain('Not Found');
    });

    it('locks Internal engine option and resyncs label when unbundled Lite edition is detected', async () => {
      const ffBadge = new MockElement('span');
      ffBadge.id = 'ffmpeg-status-badge';
      const wBadge = new MockElement('span');
      wBadge.id = 'whisper-status-badge';

      const makeSourceSelect = (id: string) => {
        const sel = new MockElement('SELECT');
        sel.id = id;
        const optBundled = new MockElement('OPTION');
        optBundled.value = 'bundled';
        optBundled.textContent = 'Internal';
        const optSystem = new MockElement('OPTION');
        optSystem.value = 'system';
        optSystem.textContent = 'System';
        sel.appendChild(optBundled);
        sel.appendChild(optSystem);
        sel.value = 'bundled';
        return { sel, optBundled, optSystem };
      };

      const ffSelect = makeSourceSelect('opt-ffmpegSource');
      const wSelect = makeSourceSelect('opt-whisperSource');
      elementRegistry.set('ffmpeg-status-badge', ffBadge);
      elementRegistry.set('whisper-status-badge', wBadge);
      elementRegistry.set('opt-ffmpegSource', ffSelect.sel);
      elementRegistry.set('opt-whisperSource', wSelect.sel);

      const syncSelectsSpy = vi.fn();
      const prevSync = (globalThis as any).window.syncCustomSelects;
      (globalThis as any).window.syncCustomSelects = syncSelectsSpy;
      setSettingsState({ ffmpegSource: 'bundled', whisperSource: 'bundled', uiLanguage: 'en' });
      await setLanguage('en', false);

      try {
        (window as any).__TAURI__.core.invoke = vi.fn().mockImplementation(async (cmd: string) => {
          if (cmd === 'get_ffmpeg_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '/usr/bin/ffmpeg',
              isAvailable: true,
              bundledAvailable: false,
              version: 'ffmpeg version 7.1',
              errorMessage: null
            };
          }
          if (cmd === 'get_whisper_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '/usr/bin/whisper-cli',
              isAvailable: true,
              bundledAvailable: false,
              version: 'whisper.cpp version: 1.9.5-dev',
              availableBackends: ['Standard', 'Vulkan'],
              errorMessage: null
            };
          }
          return {};
        });

        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);

        expect(isFfmpegBundledAvailable()).toBe(false);
        expect(isWhisperBundledAvailable()).toBe(false);
        expect(ffSelect.optBundled.disabled).toBe(true);
        expect(wSelect.optBundled.disabled).toBe(true);
        expect(ffSelect.optBundled.textContent).toContain('Not bundled');
        expect(wSelect.optBundled.textContent).toContain('Not bundled');
        expect(ffSelect.sel.value).toBe('system');
        expect(wSelect.sel.value).toBe('system');
        expect(getSettingsState()?.ffmpegSource).toBe('system');
        expect(getSettingsState()?.whisperSource).toBe('system');
        expect(syncSelectsSpy).toHaveBeenCalledWith(true, true);

        // Switching language to Persian and calling resyncEngineSourceControls keeps Not bundled hint in fa
        await setLanguage('fa', false);
        resyncEngineSourceControls();
        expect(ffSelect.optBundled.textContent).toContain('موجود نیست');
        expect(wSelect.optBundled.textContent).toContain('موجود نیست');
      } finally {
        await setLanguage('en', false);
        // Restore bundled state for subsequent test suites
        (window as any).__TAURI__.core.invoke = vi.fn().mockResolvedValue({
          configuredSource: 'bundled',
          resolvedPath: 'Internal Resources',
          isAvailable: true,
          bundledAvailable: true,
          version: 'v1.9.5',
          availableBackends: ['Standard'],
          errorMessage: null
        });
        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);
        (globalThis as any).window.syncCustomSelects = prevSync;
      }
    });

    it('validates FFmpeg and Whisper engines in preflight before media conversion', async () => {
      const switchViewSpy = vi.fn();
      const prevSwitchView = (globalThis as any).window.switchView;
      (globalThis as any).window.switchView = switchViewSpy;
      setSettingsState({ ffmpegSource: 'system', whisperSource: 'system', selectedBackend: 'Vulkan', uiLanguage: 'en' });
      await setLanguage('en', false);

      try {
        // 1. Missing FFmpeg
        (window as any).__TAURI__.core.invoke = vi.fn().mockResolvedValueOnce({
          configuredSource: 'system',
          resolvedPath: 'Not Found',
          isAvailable: false,
          bundledAvailable: false,
          version: 'N/A',
          errorMessage: 'missing ffmpeg'
        });
        expect(await validateExecutionEnginesPreflight('Vulkan')).toBe(false);
        expect(switchViewSpy).toHaveBeenCalledWith('settings');

        // 2. FFmpeg OK, Whisper backend Vulkan missing
        switchViewSpy.mockClear();
        (window as any).__TAURI__.core.invoke = vi.fn()
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '/usr/bin/ffmpeg',
            isAvailable: true,
            bundledAvailable: false,
            version: '7.1',
            errorMessage: null
          })
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '/usr/bin/whisper-cli',
            isAvailable: true,
            bundledAvailable: false,
            version: 'v1.9.5-dev',
            availableBackends: ['Standard'],
            errorMessage: null
          });
        expect(await validateExecutionEnginesPreflight('Vulkan')).toBe(false);
        expect(switchViewSpy).toHaveBeenCalledWith('settings');

        // 3. Both FFmpeg and Vulkan system backend OK
        switchViewSpy.mockClear();
        (window as any).__TAURI__.core.invoke = vi.fn()
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '/usr/bin/ffmpeg',
            isAvailable: true,
            bundledAvailable: false,
            version: '7.1',
            errorMessage: null
          })
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '/usr/bin/whisper-cli',
            isAvailable: true,
            bundledAvailable: false,
            version: 'v1.9.5-dev',
            availableBackends: ['Standard', 'Vulkan'],
            errorMessage: null
          });
        expect(await validateExecutionEnginesPreflight('Vulkan')).toBe(true);
        expect(switchViewSpy).not.toHaveBeenCalled();
      } finally {
        (globalThis as any).window.switchView = prevSwitchView;
      }
    });

    it('toggles is-unbundled hint class and localizes missing status badge across languages', async () => {
      const createSourceSelectEl = (id: string) => {
        const sel = new MockElement('SELECT');
        sel.id = id;
        const optBundled = new MockElement('OPTION');
        optBundled.value = 'bundled';
        optBundled.textContent = 'Internal';
        const optSystem = new MockElement('OPTION');
        optSystem.value = 'system';
        optSystem.textContent = 'System';
        sel.appendChild(optBundled);
        sel.appendChild(optSystem);
        sel.value = 'bundled';
        return sel;
      };

      const ffBadge = new MockElement('SPAN');
      const wBadge = new MockElement('SPAN');
      const ffPoints = new MockElement('DIV');
      const wPoints = new MockElement('DIV');
      elementRegistry.set('ffmpeg-status-badge', ffBadge);
      elementRegistry.set('whisper-status-badge', wBadge);
      elementRegistry.set('ffmpeg-source-points', ffPoints);
      elementRegistry.set('whisper-source-points', wPoints);
      elementRegistry.set('opt-ffmpegSource', createSourceSelectEl('opt-ffmpegSource'));
      elementRegistry.set('opt-whisperSource', createSourceSelectEl('opt-whisperSource'));

      const prevSettings = getSettingsState();
      setSettingsState({ ...(prevSettings || {}), ffmpegSource: 'bundled', whisperSource: 'bundled' } as any);
      const invokeMock = (globalThis as any).__TAURI__.core.invoke;

      try {
        await setLanguage('en', false);
        invokeMock
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '',
            version: '',
            isAvailable: false,
            bundledAvailable: false,
            errorMessage: 'FFmpeg not found'
          })
          .mockResolvedValueOnce({
            configuredSource: 'system',
            resolvedPath: '',
            version: '',
            isAvailable: false,
            bundledAvailable: false,
            availableBackends: [],
            errorMessage: 'Whisper not found'
          });

        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);

        expect(ffPoints.classList.contains('is-unbundled')).toBe(true);
        expect(wPoints.classList.contains('is-unbundled')).toBe(true);
        expect(ffBadge.innerHTML).toContain(t('settings.engineMissingBadge'));
        expect(wBadge.innerHTML).toContain(t('settings.engineMissingBadge'));

        await setLanguage('fa', false);
        resyncEngineSourceControls();
        const faMissingBadge = t('settings.engineMissingBadge');
        expect(ffBadge.innerHTML).toContain(faMissingBadge);
        expect(wBadge.innerHTML).toContain(faMissingBadge);

        invokeMock
          .mockResolvedValueOnce({
            configuredSource: 'bundled',
            resolvedPath: '/app/ffmpeg',
            version: 'ffmpeg version 7.1',
            isAvailable: true,
            bundledAvailable: true,
            errorMessage: null
          })
          .mockResolvedValueOnce({
            configuredSource: 'bundled',
            resolvedPath: '/app/whisper-cli',
            version: 'whisper.cpp v1.8.4',
            isAvailable: true,
            bundledAvailable: true,
            availableBackends: ['Standard'],
            errorMessage: null
          });

        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);

        expect(ffPoints.classList.contains('is-unbundled')).toBe(false);
        expect(wPoints.classList.contains('is-unbundled')).toBe(false);
      } finally {
        await setLanguage('en', false);
        setSettingsState(prevSettings);
      }
    });

    it('navigates preflight errors to app category for missing binary and transcription category for missing backend', async () => {
      const prevSwitchView = (globalThis as any).window.switchView;
      const prevSettings = getSettingsState();
      const prevActiveCat = getActiveSettingsCat();
      const switchViewSpy = vi.fn();
      (globalThis as any).window.switchView = switchViewSpy;

      const ffBadge = new MockElement('SPAN');
      const wBadge = new MockElement('SPAN');
      elementRegistry.set('ffmpeg-status-badge', ffBadge);
      elementRegistry.set('whisper-status-badge', wBadge);

      const invokeMock = (globalThis as any).__TAURI__.core.invoke;
      setSettingsState({ ...(prevSettings || {}), ffmpegSource: 'system', whisperSource: 'system' } as any);

      try {
        // Missing FFmpeg navigates to settings -> 'app'
        setActiveSettingsCat('transcription');
        invokeMock.mockResolvedValue({
          configuredSource: 'system',
          resolvedPath: '',
          version: '',
          isAvailable: false,
          bundledAvailable: false,
          errorMessage: 'missing ffmpeg'
        });
        expect(await validateExecutionEnginesPreflight('Standard')).toBe(false);
        expect(switchViewSpy).toHaveBeenCalledWith('settings');
        expect(getActiveSettingsCat()).toBe('app');

        // Healthy FFmpeg + healthy Whisper without requested Vulkan backend -> navigates to settings -> 'transcription'
        switchViewSpy.mockClear();
        setActiveSettingsCat('app');
        invokeMock.mockImplementation(async (cmd: string) => {
          if (cmd === 'get_ffmpeg_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '/usr/bin/ffmpeg',
              version: 'ffmpeg version 7.1',
              isAvailable: true,
              bundledAvailable: false,
              errorMessage: null
            };
          }
          return {
            configuredSource: 'system',
            resolvedPath: '/usr/bin/whisper-cli',
            version: 'whisper.cpp v1.8.4',
            isAvailable: true,
            bundledAvailable: false,
            availableBackends: ['Standard'],
            errorMessage: null
          };
        });
        expect(await validateExecutionEnginesPreflight('Vulkan')).toBe(false);
        expect(switchViewSpy).toHaveBeenCalledWith('settings');
        expect(getActiveSettingsCat()).toBe('transcription');
      } finally {
        (globalThis as any).window.switchView = prevSwitchView;
        setSettingsState(prevSettings);
        setActiveSettingsCat(prevActiveCat);
        invokeMock.mockResolvedValue({
          configuredSource: 'bundled',
          resolvedPath: '/app/bin',
          version: 'v1',
          isAvailable: true,
          bundledAvailable: true,
          availableBackends: ['Standard', 'Vulkan'],
          errorMessage: null
        });
        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);
      }
    });

    it('refreshes stale status badges when preflight recovers after a previously missing binary', async () => {
      const prevSettings = getSettingsState();
      const ffBadge = new MockElement('SPAN');
      const wBadge = new MockElement('SPAN');
      elementRegistry.set('ffmpeg-status-badge', ffBadge);
      elementRegistry.set('whisper-status-badge', wBadge);

      const invokeMock = (globalThis as any).__TAURI__.core.invoke;
      setSettingsState({ ...(prevSettings || {}), ffmpegSource: 'system', whisperSource: 'system' } as any);

      try {
        invokeMock.mockImplementation(async (cmd: string) => {
          if (cmd === 'get_ffmpeg_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '',
              version: '',
              isAvailable: false,
              bundledAvailable: false,
              errorMessage: 'missing'
            };
          }
          return {
            configuredSource: 'system',
            resolvedPath: '',
            version: '',
            isAvailable: false,
            bundledAvailable: false,
            availableBackends: [],
            errorMessage: 'missing'
          };
        });

        await refreshFFmpegStatus('system', false);
        await refreshWhisperStatus('system', false);
        expect(ffBadge.className).toContain('missing');
        expect(wBadge.className).toContain('missing');

        invokeMock.mockImplementation(async (cmd: string) => {
          if (cmd === 'get_ffmpeg_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '/usr/bin/ffmpeg',
              version: 'ffmpeg version 7.1',
              isAvailable: true,
              bundledAvailable: false,
              errorMessage: null
            };
          }
          if (cmd === 'get_whisper_status') {
            return {
              configuredSource: 'system',
              resolvedPath: '/usr/bin/whisper-cli',
              version: 'whisper.cpp v1.8.4',
              isAvailable: true,
              bundledAvailable: false,
              availableBackends: ['Standard', 'Vulkan'],
              errorMessage: null
            };
          }
          return {
            availableBackends: ['Standard', 'Vulkan'],
            whisperDetected: true
          };
        });

        expect(await validateExecutionEnginesPreflight('Vulkan')).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(ffBadge.className).toBe('setting-status-pill ready');
        expect(wBadge.className).toBe('setting-status-pill ready');
      } finally {
        setSettingsState(prevSettings);
        invokeMock.mockResolvedValue({
          configuredSource: 'bundled',
          resolvedPath: '/app/bin',
          version: 'v1',
          isAvailable: true,
          bundledAvailable: true,
          availableBackends: ['Standard', 'Vulkan'],
          errorMessage: null
        });
        await refreshFFmpegStatus('bundled', false);
        await refreshWhisperStatus('bundled', false);
      }
    });
  });

  describe('Stepper Bounds & Clamping', () => {
    it('returns correct bounds for threads and processors', () => {
      expect(getStepperBounds('opt-threads')).toEqual({ min: 1, max: 256 });
      expect(getStepperBounds('opt-processors')).toEqual({ min: 1, max: 64 });
      expect(clampNumberSetting('opt-threads', 500)).toBe(256);
      expect(clampNumberSetting('opt-processors', 500)).toBe(64);
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

    it('enforces at least outputSrt=true when all four output formats are false', () => {
      const cleaned = sanitizeSettingsPayload({
        outputSrt: false,
        outputVtt: false,
        outputTxt: false,
        outputLrc: false
      });
      expect(cleaned.outputSrt).toBe(true);
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
    it('runs safely as a deprecated no-op without throwing', () => {
      expect(() => syncJsonConfidenceDependency()).not.toThrow();
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

    it('updateTranscribeOutputDirUI syncs mode pills, roving tabindex, custom path row, and open-folder button across all states', () => {
      const inputModeBtn = new MockElement('BUTTON');
      inputModeBtn.id = 'quick-output-mode-input';
      const customModeBtn = new MockElement('BUTTON');
      customModeBtn.id = 'quick-output-mode-custom';
      const customRow = new MockElement('DIV');
      customRow.id = 'transcribe-output-custom-row';
      const dirText = new MockElement('DIV');
      dirText.id = 'transcribe-output-dir-text';
      const openBtn = new MockElement('BUTTON');
      openBtn.id = 'btn-open-transcribe-dir';

      elementRegistry.set('quick-output-mode-input', inputModeBtn);
      elementRegistry.set('quick-output-mode-custom', customModeBtn);
      elementRegistry.set('transcribe-output-custom-row', customRow);
      elementRegistry.set('transcribe-output-dir-text', dirText);
      elementRegistry.set('btn-open-transcribe-dir', openBtn);

      // 1. Custom mode with selected path
      setSettingsState({ outputDirMode: 'custom', outputDirPath: '/custom/output' });
      updateTranscribeOutputDirUI();

      expect(inputModeBtn.classList.contains('active')).toBe(false);
      expect(inputModeBtn.getAttribute('aria-checked')).toBe('false');
      expect(inputModeBtn.getAttribute('tabindex')).toBe('-1');
      expect(customModeBtn.classList.contains('active')).toBe(true);
      expect(customModeBtn.getAttribute('aria-checked')).toBe('true');
      expect(customModeBtn.getAttribute('tabindex')).toBe('0');
      expect(customRow.style.display).toBe('block');
      expect(dirText.textContent).toBe('/custom/output');
      expect(dirText.classList.contains('has-custom-path')).toBe(true);
      expect(dirText.getAttribute('data-i18n')).toBeNull();
      expect(openBtn.disabled).toBe(false);

      // 2. Custom mode selected in Settings before picking a path (empty path)
      setSettingsState({ outputDirMode: 'custom', outputDirPath: '' });
      updateTranscribeOutputDirUI();

      expect(customModeBtn.classList.contains('active')).toBe(true);
      expect(customModeBtn.getAttribute('tabindex')).toBe('0');
      expect(customRow.style.display).toBe('block');
      expect(dirText.classList.contains('has-custom-path')).toBe(false);
      expect(dirText.getAttribute('data-i18n')).toBe('settings.outputDirSelectPlaceholder');
      expect(openBtn.disabled).toBe(true);

      // 3. Default input_dir mode
      setSettingsState({ outputDirMode: 'input_dir', outputDirPath: '/custom/output' });
      updateTranscribeOutputDirUI();

      expect(inputModeBtn.classList.contains('active')).toBe(true);
      expect(inputModeBtn.getAttribute('aria-checked')).toBe('true');
      expect(inputModeBtn.getAttribute('tabindex')).toBe('0');
      expect(customModeBtn.classList.contains('active')).toBe(false);
      expect(customModeBtn.getAttribute('tabindex')).toBe('-1');
      expect(customRow.style.display).toBe('none');
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

  describe('Transcribe Studio Quick Config & Settings Synergy', () => {
    it('prevents disabling all output formats via toggleQuickOutputFormat and syncs pills & Settings', () => {
      const srtPill = new MockElement('BUTTON');
      srtPill.id = 'quick-fmt-srt';
      const vttPill = new MockElement('BUTTON');
      vttPill.id = 'quick-fmt-vtt';
      const optSrt = new MockElement('INPUT');
      optSrt.id = 'opt-outputSrt';
      optSrt.type = 'checkbox';
      const optVtt = new MockElement('INPUT');
      optVtt.id = 'opt-outputVtt';
      optVtt.type = 'checkbox';

      elementRegistry.set('quick-fmt-srt', srtPill);
      elementRegistry.set('quick-fmt-vtt', vttPill);
      elementRegistry.set('opt-outputSrt', optSrt);
      elementRegistry.set('opt-outputVtt', optVtt);

      setSettingsState({ outputSrt: true, outputVtt: false, outputTxt: false, outputLrc: false });

      // Cannot disable last active format (SRT)
      toggleQuickOutputFormat('outputSrt');
      expect(getSettingsState()?.outputSrt).toBe(true);
      expect(srtPill.getAttribute('aria-pressed')).toBe('true');

      // Enabling VTT succeeds and allows turning SRT off afterwards
      toggleQuickOutputFormat('outputVtt');
      expect(getSettingsState()?.outputVtt).toBe(true);
      expect(optVtt.checked).toBe(true);
      expect(vttPill.getAttribute('aria-pressed')).toBe('true');

      toggleQuickOutputFormat('outputSrt');
      expect(getSettingsState()?.outputSrt).toBe(false);
      expect(optSrt.checked).toBe(false);
    });

    it('detects and applies recommended thread count from systemSpecs.cpu_cores', async () => {
      const threadsInput = new MockElement('INPUT');
      threadsInput.id = 'opt-threads';
      threadsInput.value = '4';
      elementRegistry.set('opt-threads', threadsInput);

      (globalThis as any).window.systemSpecs = { cpu_cores: 16, total_ram_gb: 32, gpu_type: 'nvidia' };
      setSettingsState({ threads: 4 });

      await applyRecommendedThreads();

      expect(getSettingsState()?.threads).toBe(8);
      expect(threadsInput.value).toBe('8');
    });

    it('manages checkbox-controlled always-visible time range panel, trim slider sync, validation, and full reset safely', () => {
      const rangeCheckbox = new MockElement('INPUT');
      rangeCheckbox.id = 'quick-range-enabled';
      rangeCheckbox.type = 'checkbox';
      const inputsRow = new MockElement('DIV');
      inputsRow.id = 'quick-range-inputs';
      const sliderWrap = new MockElement('DIV');
      sliderWrap.id = 'quick-range-slider-wrap';
      const sliderStart = new MockElement('INPUT');
      sliderStart.id = 'quick-range-slider-start';
      const sliderEnd = new MockElement('INPUT');
      sliderEnd.id = 'quick-range-slider-end';
      const fillBar = new MockElement('DIV');
      fillBar.id = 'quick-range-fill';
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';

      elementRegistry.set(rangeCheckbox.id, rangeCheckbox);
      elementRegistry.set(inputsRow.id, inputsRow);
      elementRegistry.set(sliderWrap.id, sliderWrap);
      elementRegistry.set(sliderStart.id, sliderStart);
      elementRegistry.set(sliderEnd.id, sliderEnd);
      elementRegistry.set(fillBar.id, fillBar);
      elementRegistry.set(startInput.id, startInput);
      elementRegistry.set(endInput.id, endInput);
      elementRegistry.set(hintEl.id, hintEl);

      (globalThis as any).window.probedMetadata = null;
      setSettingsState({ offsetT: 0, duration: 0 });

      // Remains visible (disabled state) before a file is probed so slider is always discoverable
      setQuickRangeMode('custom');
      expect(rangeCheckbox.checked).toBe(true);
      expect(inputsRow.style.display).toBe('flex');
      expect(inputsRow.classList.contains('is-inactive')).toBe(false);
      expect(sliderWrap.style.display).toBe('flex');
      expect(sliderWrap.classList.contains('is-disabled')).toBe(true);
      expect(sliderStart.disabled).toBe(true);

      // Once media duration is available, slider activates cleanly with exact bounds
      (globalThis as any).window.probedMetadata = { exists: true, durationSec: 120 };
      setQuickRangeMode('custom');
      expect(sliderWrap.classList.contains('is-disabled')).toBe(false);
      expect(sliderStart.disabled).toBe(false);

      // Apply valid slice 00:30 -> 01:30 (60s duration on 120s media -> 25% start, 50% width)
      startInput.value = '00:30';
      endInput.value = '01:30';
      expect(validateAndApplyQuickTimeRange(true)).toBe(true);
      expect(getSettingsState()?.offsetT).toBe(30_000);
      expect(getSettingsState()?.duration).toBe(60_000);
      expect(fillBar.style['--trim-start-pct']).toBe('25.00%');
      expect(fillBar.style['--trim-width-pct']).toBe('50.00%');
      expect(sliderStart.value).toBe('30');
      expect(sliderEnd.value).toBe('90');

      // Invalid order blocks commit and sets error state in-place without hiding hintEl
      startInput.value = '01:00';
      endInput.value = '00:20';
      expect(validateAndApplyQuickTimeRange(true)).toBe(false);
      expect(hintEl.classList.contains('is-error')).toBe(true);

      // Reset clears offsetT/duration, keeps panel visible in dimmed inactive Full File state
      resetTranscribeTimeRange(false);
      expect(getSettingsState()?.offsetT).toBe(0);
      expect(getSettingsState()?.duration).toBe(0);
      expect(rangeCheckbox.checked).toBe(false);
      expect(inputsRow.style.display).toBe('flex');
      expect(inputsRow.classList.contains('is-inactive')).toBe(true);
    });

    it('updates maxLen 4-option presets, reveals custom stepper only in Custom mode, and syncs prompt/splitWord', () => {
      const pAuto = new MockElement('BUTTON');
      pAuto.id = 'quick-maxlen-auto';
      const p42 = new MockElement('BUTTON');
      p42.id = 'quick-maxlen-42';
      const p28 = new MockElement('BUTTON');
      p28.id = 'quick-maxlen-28';
      const pCustom = new MockElement('BUTTON');
      pCustom.id = 'quick-maxlen-custom';
      const customRow = new MockElement('DIV');
      customRow.id = 'quick-maxlen-custom-row';
      const maxLenInput = new MockElement('INPUT');
      maxLenInput.id = 'quick-adv-maxLen';
      const promptInput = new MockElement('TEXTAREA');
      promptInput.id = 'quick-adv-prompt';
      const splitChk = new MockElement('INPUT');
      splitChk.id = 'quick-adv-splitWord';
      splitChk.type = 'checkbox';

      elementRegistry.set(pAuto.id, pAuto);
      elementRegistry.set(p42.id, p42);
      elementRegistry.set(p28.id, p28);
      elementRegistry.set(pCustom.id, pCustom);
      elementRegistry.set(customRow.id, customRow);
      elementRegistry.set(maxLenInput.id, maxLenInput);
      elementRegistry.set(promptInput.id, promptInput);
      elementRegistry.set(splitChk.id, splitChk);

      setSettingsState({
        prompt: 'Domain term',
        splitWord: true,
        maxLen: 0
      });

      // Selecting preset hides custom stepper row
      setQuickMaxLen(42);
      expect(getSettingsState()?.maxLen).toBe(42);
      expect(p42.getAttribute('aria-pressed')).toBe('true');
      expect(pAuto.getAttribute('aria-pressed')).toBe('false');
      expect(pCustom.getAttribute('aria-pressed')).toBe('false');
      expect(customRow.style.display).toBe('none');

      // Activating Custom reveals stepper row and stepping adjusts value cleanly
      setQuickMaxLen(0);
      expect(customRow.style.display).toBe('none');
      activateCustomMaxLen();
      expect(pCustom.getAttribute('aria-pressed')).toBe('true');
      expect(customRow.style.display).toBe('flex');
      expect(getSettingsState()?.maxLen).toBe(40);

      stepQuickMaxLen(5);
      expect(getSettingsState()?.maxLen).toBe(45);
      expect(maxLenInput.value).toBe('45');

      syncQuickAdvancedUI();
      expect(promptInput.value).toBe('Domain term');
      expect(splitChk.checked).toBe(true);
    });

    it('isolates #quick-adv-maxLen from setupNumberInputControls so ArrowUp/Down and Persian digits update settingsState.maxLen', () => {
      const wrapper = new MockElement('DIV');
      wrapper.className = 'number-input-control transcribe-number-control';
      wrapper.setAttribute('data-custom-stepper', 'true');
      const decBtn = new MockElement('BUTTON');
      const maxLenInput = new MockElement('INPUT');
      maxLenInput.id = 'quick-adv-maxLen';
      maxLenInput.value = '40';
      const incBtn = new MockElement('BUTTON');
      wrapper.appendChild(decBtn);
      wrapper.appendChild(maxLenInput);
      wrapper.appendChild(incBtn);

      const optMaxLen = new MockElement('INPUT');
      optMaxLen.id = 'opt-maxLen';
      optMaxLen.value = '40';

      elementRegistry.set('quick-adv-maxLen', maxLenInput);
      elementRegistry.set('opt-maxLen', optMaxLen);

      const origQsa = document.querySelectorAll;
      (document as any).querySelectorAll = (sel: string) => {
        if (sel === '.number-input-control') return [wrapper];
        return origQsa.call(document, sel);
      };

      try {
        setSettingsState({ maxLen: 40 });
        setupNumberInputControls();
        setupQuickConfigDeckEventListeners();

        // setupNumberInputControls must skip data-custom-stepper
        expect((wrapper as any)._stepperInitialized).toBeUndefined();

        // ArrowUp updates settingsState.maxLen and #opt-maxLen directly
        maxLenInput.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: vi.fn() });
        expect(getSettingsState()?.maxLen).toBe(41);
        expect(optMaxLen.value).toBe('41');

        // Typing Persian digits preserves input and updates maxLen
        maxLenInput.value = '۴۸';
        maxLenInput.dispatchEvent({ type: 'input' });
        expect(maxLenInput.value).toBe('۴۸');
        expect(getSettingsState()?.maxLen).toBe(48);
        expect(optMaxLen.value).toBe('48');
      } finally {
        (document as any).querySelectorAll = origQsa;
      }
    });

    it('supports global time range slicing in Batch Mode with slider hidden, short-file warning, and all-short rejection', () => {
      const rangeGroup = new MockElement('DIV');
      rangeGroup.id = 'quick-range-group';
      const rangeCheckbox = new MockElement('INPUT');
      rangeCheckbox.id = 'quick-range-enabled';
      rangeCheckbox.type = 'checkbox';
      const inputsRow = new MockElement('DIV');
      inputsRow.id = 'quick-range-inputs';
      const sliderWrap = new MockElement('DIV');
      sliderWrap.id = 'quick-range-slider-wrap';
      const btnStartPlayer = new MockElement('BUTTON');
      btnStartPlayer.id = 'btn-range-start-player';
      const btnEndPlayer = new MockElement('BUTTON');
      btnEndPlayer.id = 'btn-range-end-player';
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      hintEl.setAttribute('data-i18n', 'transcribe.rangeFullMedia');

      elementRegistry.set(rangeGroup.id, rangeGroup);
      elementRegistry.set(rangeCheckbox.id, rangeCheckbox);
      elementRegistry.set(inputsRow.id, inputsRow);
      elementRegistry.set(sliderWrap.id, sliderWrap);
      elementRegistry.set(btnStartPlayer.id, btnStartPlayer);
      elementRegistry.set(btnEndPlayer.id, btnEndPlayer);
      elementRegistry.set(startInput.id, startInput);
      elementRegistry.set(endInput.id, endInput);
      elementRegistry.set(hintEl.id, hintEl);

      const win = globalThis as any;
      win.window.isBatchMode = true;
      win.window.batchItems = [{ durationSec: 40 }, { durationSec: 180 }];
      setSettingsState({ offsetT: 0, duration: 0 });

      updateTranscribeRangeVisibility(true);
      expect(rangeGroup.style.display).toBe('flex');
      expect(inputsRow.classList.contains('is-batch-mode')).toBe(true);
      expect(sliderWrap.style.display).toBe('none');
      expect(btnStartPlayer.style.display).toBe('none');
      expect(btnEndPlayer.style.display).toBe('none');
      expect(hintEl.getAttribute('data-i18n')).toBe('transcribe.rangeFullMedia');

      // Custom slice 01:00 -> End warns about the 40s file while staying valid for the 180s file
      setQuickRangeMode('custom');
      startInput.value = '01:00';
      endInput.value = '';
      expect(validateAndApplyQuickTimeRange(true)).toBe(true);
      expect(getSettingsState()?.offsetT).toBe(60_000);
      expect(hintEl.classList.contains('is-warning')).toBe(true);
      expect(hintEl.getAttribute('data-i18n')).toBeNull();

      // Start 05:00 exceeds all batch durations -> rejected with error
      startInput.value = '05:00';
      expect(validateAndApplyQuickTimeRange(true)).toBe(false);
      expect(hintEl.classList.contains('is-error')).toBe(true);

      // Resetting restores data-i18n="transcribe.rangeFullMedia"
      resetTranscribeTimeRange(false);
      expect(hintEl.getAttribute('data-i18n')).toBe('transcribe.rangeFullMedia');
      win.window.isBatchMode = false;
      win.window.batchItems = [];
    });

    it('switches transcribe outputDirMode to input_dir matching Settings options while preserving custom path', async () => {
      const optMode = new MockElement('SELECT');
      optMode.id = 'opt-outputDirMode';
      optMode.value = 'custom';
      elementRegistry.set('opt-outputDirMode', optMode);
      setSettingsState({ outputDirMode: 'custom', outputDirPath: '/tmp/out' });

      await setTranscribeOutputDirMode('input_dir');
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(getSettingsState()?.outputDirPath).toBe('/tmp/out');
      expect(optMode.value).toBe('input_dir');
    });

    it('preserves invalid Time Range draft inputs and error state across updateTranscribeUIConfigs calls', () => {
      resetQuickDeckState();
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      elementRegistry.set(startInput.id, startInput);
      elementRegistry.set(endInput.id, endInput);
      elementRegistry.set(hintEl.id, hintEl);

      const win = globalThis as any;
      win.window.probedMetadata = { exists: true, durationSec: 90 };
      setSettingsState({ offsetT: 10_000, duration: 20_000 });

      setQuickRangeMode('custom');
      startInput.value = '02:30';
      endInput.value = '00:45';
      expect(validateAndApplyQuickTimeRange(true)).toBe(false);
      expect(hintEl.classList.contains('is-error')).toBe(true);

      // Re-syncing UI (e.g. toggling another setting or language change) must not clobber invalid inputs
      updateTranscribeUIConfigs();
      expect(startInput.value).toBe('02:30');
      expect(endInput.value).toBe('00:45');
      expect(hintEl.classList.contains('is-error')).toBe(true);

      resetQuickDeckState();
      win.window.probedMetadata = null;
    });

    it('collapses Quick Deck custom Line Length when preset value is entered in Settings and displays maxLen > 500 accurately', () => {
      resetQuickDeckState();
      const origQsa = (document as any).querySelectorAll;
      const optMaxLen = new MockElement('INPUT');
      optMaxLen.id = 'opt-maxLen';
      optMaxLen.value = '35';
      const wrap = new MockElement('DIV');
      wrap.className = 'number-input-control';
      (wrap as any).querySelector = (sel: string) => (sel === 'input' ? optMaxLen : null);

      const autoBtn = new MockElement('BUTTON');
      autoBtn.id = 'quick-maxlen-auto';
      const p28Btn = new MockElement('BUTTON');
      p28Btn.id = 'quick-maxlen-28';
      const p42Btn = new MockElement('BUTTON');
      p42Btn.id = 'quick-maxlen-42';
      const customBtn = new MockElement('BUTTON');
      customBtn.id = 'quick-maxlen-custom';
      const customRow = new MockElement('DIV');
      customRow.id = 'quick-maxlen-custom-row';
      const quickMaxLenInput = new MockElement('INPUT');
      quickMaxLenInput.id = 'quick-adv-maxLen';

      [optMaxLen, autoBtn, p28Btn, p42Btn, customBtn, customRow, quickMaxLenInput].forEach(el =>
        elementRegistry.set(el.id, el)
      );

      (document as any).querySelectorAll = (sel: string) =>
        sel === '.number-input-control' ? [wrap] : [];

      try {
        setSettingsState({ maxLen: 0 });
        setupNumberInputControls();
        activateCustomMaxLen();
        expect(customBtn.classList.contains('active')).toBe(true);

        // Entering preset '42' in Settings #opt-maxLen collapses Custom row back to the 42 pill
        optMaxLen.value = '42';
        optMaxLen.dispatchEvent({ type: 'blur' });
        expect(getSettingsState()?.maxLen).toBe(42);
        expect(customBtn.classList.contains('active')).toBe(false);
        expect(p42Btn.classList.contains('active')).toBe(true);
        expect(customRow.style.display).toBe('none');

        // Entering maxLen > 500 in Settings displays truthfully in Quick Deck
        optMaxLen.value = '600';
        optMaxLen.dispatchEvent({ type: 'blur' });
        expect(getSettingsState()?.maxLen).toBe(600);
        expect(customBtn.classList.contains('active')).toBe(true);
        expect(quickMaxLenInput.value).toBe('600');
      } finally {
        (document as any).querySelectorAll = origQsa;
        resetQuickDeckState();
      }
    });

    it('clamps near-EOF start capture and clears earlier End value when capturing player start position', () => {
      resetQuickDeckState();
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      elementRegistry.set(startInput.id, startInput);
      elementRegistry.set(endInput.id, endInput);
      elementRegistry.set(hintEl.id, hintEl);

      const win = globalThis as any;
      win.window.selectedMediaFile = '/media/clip.mp4';
      win.window.probedMetadata = { exists: true, durationSec: 100 };
      setSettingsState({ offsetT: 0, duration: 20_000 });
      endInput.value = '00:20';

      // Player near EOF at 100s -> clamps start to 01:39 (99s) and clears 00:20 end instead of erroring
      win.window.getCompanionCurrentTimeSec = () => 100;
      capturePlayerTimeForRange('start');

      expect(startInput.value).toBe('01:39');
      expect(endInput.value).toBe('');
      expect(getSettingsState()?.offsetT).toBe(99_000);
      expect(getSettingsState()?.duration).toBe(0);
      expect(hintEl.classList.contains('is-error')).toBe(false);

      win.window.selectedMediaFile = null;
      win.window.probedMetadata = null;
      delete win.window.getCompanionCurrentTimeSec;
      resetQuickDeckState();
    });

    it('formats batch custom range summary with RTL directional arrow and LRI isolation when End is open', async () => {
      resetQuickDeckState();
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      elementRegistry.set(hintEl.id, hintEl);

      const win = globalThis as any;
      win.window.isBatchMode = true;
      win.window.batchItems = [{ durationSec: 120 }, { durationSec: 180 }];
      setSettingsState({ offsetT: 15_000, duration: 0 });

      try {
        await setLanguage('fa');
        syncQuickTimeRangeUI();
        expect(hintEl.textContent).toContain('\u206600:15\u2069 \u2190');
        expect(hintEl.getAttribute('dir')).toBeNull();
      } finally {
        await setLanguage('en');
        win.window.isBatchMode = false;
        win.window.batchItems = [];
        resetQuickDeckState();
      }
    });

    it('keeps trim slider disabled for sub-second media clips so integer-second dragging cannot exceed EOF', () => {
      resetQuickDeckState();
      const sliderWrap = new MockElement('DIV');
      sliderWrap.id = 'quick-range-slider-wrap';
      const startSlider = new MockElement('INPUT');
      startSlider.id = 'quick-range-slider-start';
      const endSlider = new MockElement('INPUT');
      endSlider.id = 'quick-range-slider-end';
      const fillEl = new MockElement('DIV');
      fillEl.id = 'quick-range-fill';
      elementRegistry.set(sliderWrap.id, sliderWrap);
      elementRegistry.set(startSlider.id, startSlider);
      elementRegistry.set(endSlider.id, endSlider);
      elementRegistry.set(fillEl.id, fillEl);

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 0.6 };
      setSettingsState({ offsetT: 0, duration: 0 });

      try {
        syncQuickTimeRangeUI();
        expect(sliderWrap.classList.contains('is-disabled')).toBe(true);
        expect(startSlider.disabled).toBe(true);
        expect(endSlider.disabled).toBe(true);

        // Short 1.2s clip (rounds to maxSec=1) must also keep integer-second slider disabled
        // so dragging endSlider to 0 cannot emit 00:00 -> 00:00 (endBeforeStart).
        win.window.probedMetadata = { exists: true, durationSec: 1.2 };
        syncQuickTimeRangeUI();
        expect(sliderWrap.classList.contains('is-disabled')).toBe(true);
        expect(startSlider.disabled).toBe(true);
        expect(endSlider.disabled).toBe(true);

        // 2.0s clip enables the integer-second trim slider cleanly
        win.window.probedMetadata = { exists: true, durationSec: 2.0 };
        syncQuickTimeRangeUI();
        expect(sliderWrap.classList.contains('is-disabled')).toBe(false);
        expect(startSlider.disabled).toBe(false);
        expect(endSlider.disabled).toBe(false);
      } finally {
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('preserves sub-second time ranges without false endBeforeStart rejection or precision loss', () => {
      resetQuickDeckState();
      const rangeCheckbox = new MockElement('INPUT');
      rangeCheckbox.id = 'quick-range-enabled';
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      [rangeCheckbox, startInput, endInput, hintEl].forEach(el => elementRegistry.set(el.id, el));

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 60 };

      try {
        // Sub-second range within the same integer second (1.5s -> 1.9s)
        setSettingsState({ offsetT: 1_500, duration: 400 });
        syncQuickTimeRangeUI();
        expect(startInput.value).toBe('00:01.5');
        expect(endInput.value).toBe('00:01.9');
        expect(validateAndApplyQuickTimeRange(true)).toBe(true);
        expect(getSettingsState()?.offsetT).toBe(1_500);
        expect(getSettingsState()?.duration).toBe(400);
        expect(hintEl.classList.contains('is-error')).toBe(false);

        // Millisecond Settings values (1.5s offset, 5.5s duration -> 7.0s end) stay exact on Start
        setSettingsState({ offsetT: 1_500, duration: 5_500 });
        syncQuickTimeRangeUI();
        expect(startInput.value).toBe('00:01.5');
        expect(endInput.value).toBe('00:07');
        expect(validateAndApplyQuickTimeRange(true)).toBe(true);
        expect(getSettingsState()?.offsetT).toBe(1_500);
        expect(getSettingsState()?.duration).toBe(5_500);
      } finally {
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('clears stale Quick Deck range validation error when Settings authoritatively updates offsetT or duration', () => {
      resetQuickDeckState();
      const optOffset = new MockElement('INPUT');
      optOffset.id = 'opt-offsetT';
      optOffset.type = 'number';
      const optDuration = new MockElement('INPUT');
      optDuration.id = 'opt-duration';
      optDuration.type = 'number';
      const rangeCheckbox = new MockElement('INPUT');
      rangeCheckbox.id = 'quick-range-enabled';
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      [optOffset, optDuration, rangeCheckbox, startInput, endInput, hintEl].forEach(el =>
        elementRegistry.set(el.id, el)
      );

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 120 };

      try {
        setSettingsState({ offsetT: 0, duration: 0 });
        bindSettingsToDOM();
        setQuickRangeMode('custom');

        // Enter invalid draft in Quick Deck -> locks validation error
        startInput.value = '99:99';
        endInput.value = '';
        expect(validateAndApplyQuickTimeRange(true)).toBe(false);
        expect(hintEl.classList.contains('is-error')).toBe(true);

        // User fixes range via Settings #opt-offsetT -> stale error clears & Quick Deck updates
        optOffset.value = '10000';
        (optOffset as any).onchange?.();

        expect(getSettingsState()?.offsetT).toBe(10_000);
        expect(startInput.value).toBe('00:10');
        expect(hintEl.classList.contains('is-error')).toBe(false);
        expect(validateAndApplyQuickTimeRange(true)).toBe(true);
      } finally {
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('isolates {max} timecode with LRI/PDI in RTL range error messages', async () => {
      resetQuickDeckState();
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      [startInput, endInput, hintEl].forEach(el => elementRegistry.set(el.id, el));

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 120 };

      try {
        await setLanguage('fa');
        setSettingsState({ offsetT: 0, duration: 0 });
        setQuickRangeMode('custom');
        startInput.value = '05:00';
        endInput.value = '';
        expect(validateAndApplyQuickTimeRange(true)).toBe(false);
        expect(hintEl.textContent).toContain('\u206602:00\u2069');
      } finally {
        await setLanguage('en');
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('syncs trim slider thumb values on reset even when the slider still holds document.activeElement (WebKit)', () => {
      resetQuickDeckState();
      const sliderWrap = new MockElement('DIV');
      sliderWrap.id = 'quick-range-slider-wrap';
      const startSlider = new MockElement('INPUT');
      startSlider.id = 'quick-range-slider-start';
      const endSlider = new MockElement('INPUT');
      endSlider.id = 'quick-range-slider-end';
      const fillEl = new MockElement('DIV');
      fillEl.id = 'quick-range-fill';
      [sliderWrap, startSlider, endSlider, fillEl].forEach(el => elementRegistry.set(el.id, el));

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 120 };
      const prevActive = (document as any).activeElement;

      try {
        setSettingsState({ offsetT: 40_000, duration: 50_000 });
        syncQuickTimeRangeUI();
        expect(startSlider.value).toBe('40');
        expect(endSlider.value).toBe('90');

        // Simulate WebKit keeping activeElement on startSlider when user clicks a reset button
        (document as any).activeElement = startSlider;
        resetTranscribeTimeRange(false);

        expect(startSlider.value).toBe('0');
        expect(endSlider.value).toBe('120');
        expect(fillEl.style['--trim-start-pct']).toBe('0.00%');
        expect(fillEl.style['--trim-width-pct']).toBe('100.00%');
      } finally {
        (document as any).activeElement = prevActive;
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('preserves sub-seconds in capturePlayerTimeForRange("end") when whole-second flooring would collide with Start', () => {
      resetQuickDeckState();
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      [startInput, endInput, hintEl].forEach(el => elementRegistry.set(el.id, el));

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.selectedMediaFile = '/media/clip.mp4';
      win.window.probedMetadata = { exists: true, durationSec: 60 };
      setSettingsState({ offsetT: 5_000, duration: 0 });
      setQuickRangeMode('custom');
      startInput.value = '00:05';
      endInput.value = '';

      try {
        // Player at 5.8s: flooring to 00:05 would trigger endBeforeStart; preserving .8 succeeds
        win.window.getCompanionCurrentTimeSec = () => 5.8;
        capturePlayerTimeForRange('end');

        expect(endInput.value).toBe('00:05.8');
        expect(getSettingsState()?.offsetT).toBe(5_000);
        expect(getSettingsState()?.duration).toBe(800);
        expect(hintEl.classList.contains('is-error')).toBe(false);
      } finally {
        win.window.selectedMediaFile = null;
        win.window.probedMetadata = null;
        delete win.window.getCompanionCurrentTimeSec;
        resetQuickDeckState();
      }
    });

    it('syncs Settings #output-dir-custom-card visibility and Custom Select trigger when switching output mode to input_dir from Quick Deck', async () => {
      const optMode = new MockElement('SELECT');
      optMode.id = 'opt-outputDirMode';
      optMode.value = 'custom';
      const customCard = new MockElement('DIV');
      customCard.id = 'output-dir-custom-card';
      customCard.style.display = 'flex';
      elementRegistry.set(optMode.id, optMode);
      elementRegistry.set(customCard.id, customCard);

      const syncSelectsMock = vi.fn();
      const prevSync = (globalThis as any).window.syncCustomSelects;
      (globalThis as any).window.syncCustomSelects = syncSelectsMock;

      try {
        setSettingsState({ outputDirMode: 'custom', outputDirPath: '/tmp/out' });
        await setTranscribeOutputDirMode('input_dir');

        expect(optMode.value).toBe('input_dir');
        expect(customCard.style.display).toBe('none');
        expect(syncSelectsMock).toHaveBeenCalled();
      } finally {
        (globalThis as any).window.syncCustomSelects = prevSync;
      }
    });

    it('setTranscribeOutputDirMode switches modes, preserves custom path, and keeps Settings in sync', async () => {
      const optMode = new MockElement('SELECT');
      optMode.id = 'opt-outputDirMode';
      optMode.value = 'custom';
      const optPath = new MockElement('INPUT');
      optPath.id = 'opt-outputDirPath';
      optPath.value = '/saved/subs';
      const customCard = new MockElement('DIV');
      customCard.id = 'output-dir-custom-card';
      const customRow = new MockElement('DIV');
      customRow.id = 'transcribe-output-custom-row';
      const dirText = new MockElement('DIV');
      dirText.id = 'transcribe-output-dir-text';

      elementRegistry.set(optMode.id, optMode);
      elementRegistry.set(optPath.id, optPath);
      elementRegistry.set(customCard.id, customCard);
      elementRegistry.set(customRow.id, customRow);
      elementRegistry.set(dirText.id, dirText);

      setSettingsState({ outputDirMode: 'custom', outputDirPath: '/saved/subs' });

      await setTranscribeOutputDirMode('input_dir');
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(getSettingsState()?.outputDirPath).toBe('/saved/subs');
      expect(optMode.value).toBe('input_dir');
      expect(customCard.style.display).toBe('none');
      expect(customRow.style.display).toBe('none');

      // Switching back to custom reuses the remembered path without invoking select_directory
      const invokeSpy = (globalThis as any).__TAURI__.core.invoke as ReturnType<typeof vi.fn>;
      invokeSpy.mockClear();

      await setTranscribeOutputDirMode('custom');
      expect(invokeSpy).not.toHaveBeenCalledWith('select_directory');
      expect(getSettingsState()?.outputDirMode).toBe('custom');
      expect(optMode.value).toBe('custom');
      expect(customCard.style.display).toBe('flex');
      expect(customRow.style.display).toBe('block');
      expect(dirText.textContent).toBe('/saved/subs');
    });

    it('setTranscribeOutputDirMode(custom) opens directory picker when path is empty and stays input_dir if cancelled', async () => {
      const optMode = new MockElement('SELECT');
      optMode.id = 'opt-outputDirMode';
      optMode.value = 'input_dir';
      const optPath = new MockElement('INPUT');
      optPath.id = 'opt-outputDirPath';
      const customCard = new MockElement('DIV');
      customCard.id = 'output-dir-custom-card';
      const customRow = new MockElement('DIV');
      customRow.id = 'transcribe-output-custom-row';

      elementRegistry.set(optMode.id, optMode);
      elementRegistry.set(optPath.id, optPath);
      elementRegistry.set(customCard.id, customCard);
      elementRegistry.set(customRow.id, customRow);

      const invokeSpy = (globalThis as any).__TAURI__.core.invoke as ReturnType<typeof vi.fn>;
      invokeSpy.mockImplementation(async (cmd: string) => {
        if (cmd === 'select_directory') return null;
        return {};
      });

      setSettingsState({ outputDirMode: 'input_dir', outputDirPath: '' });
      await setTranscribeOutputDirMode('custom');

      expect(invokeSpy).toHaveBeenCalledWith('select_directory', undefined);
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(optMode.value).toBe('input_dir');

      // Non-writable directory keeps input_dir unchanged
      invokeSpy.mockImplementation(async (cmd: string) => {
        if (cmd === 'select_directory') return '/readonly/dir';
        if (cmd === 'verify_directory_writable') throw new Error('Permission denied');
        return {};
      });
      await browseTranscribeOutputDir();
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(getSettingsState()?.outputDirPath).toBe('');

      // Now simulate choosing a writable directory
      invokeSpy.mockImplementation(async (cmd: string) => {
        if (cmd === 'select_directory') return '/picked/dir';
        return {};
      });

      await setTranscribeOutputDirMode('custom');
      expect(invokeSpy).toHaveBeenCalledWith('verify_directory_writable', { dirPath: '/picked/dir' });
      expect(getSettingsState()?.outputDirMode).toBe('custom');
      expect(getSettingsState()?.outputDirPath).toBe('/picked/dir');
      expect(optMode.value).toBe('custom');
      expect(optPath.value).toBe('/picked/dir');
      expect(customCard.style.display).toBe('flex');
      expect(customRow.style.display).toBe('block');
    });

    it('supports ArrowLeft/ArrowRight keyboard switching on #quick-output-location-modes radiogroup', async () => {
      const modeGroup = new MockElement('DIV');
      modeGroup.id = 'quick-output-location-modes';
      const inputBtn = new MockElement('BUTTON');
      inputBtn.id = 'quick-output-mode-input';
      const customBtn = new MockElement('BUTTON');
      customBtn.id = 'quick-output-mode-custom';
      const optMode = new MockElement('SELECT');
      optMode.id = 'opt-outputDirMode';
      const customRow = new MockElement('DIV');
      customRow.id = 'transcribe-output-custom-row';
      modeGroup.appendChild(inputBtn);
      modeGroup.appendChild(customBtn);

      elementRegistry.set(modeGroup.id, modeGroup);
      elementRegistry.set(inputBtn.id, inputBtn);
      elementRegistry.set(customBtn.id, customBtn);
      elementRegistry.set(optMode.id, optMode);
      elementRegistry.set(customRow.id, customRow);

      setSettingsState({ outputDirMode: 'input_dir', outputDirPath: '/saved/dir' });
      setupQuickConfigDeckEventListeners();

      modeGroup.dispatchEvent({
        type: 'keydown',
        key: 'ArrowRight',
        target: inputBtn,
        preventDefault: vi.fn()
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(customBtn.isFocused).toBe(true);
      expect(getSettingsState()?.outputDirMode).toBe('custom');
      expect(optMode.value).toBe('custom');
      expect(customRow.style.display).toBe('block');

      modeGroup.dispatchEvent({
        type: 'keydown',
        key: 'ArrowLeft',
        target: customBtn,
        preventDefault: vi.fn()
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(inputBtn.isFocused).toBe(true);
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(optMode.value).toBe('input_dir');
      expect(customRow.style.display).toBe('none');

      // Cancelling empty-path directory picker restores focus to the checked input_dir radio button
      const invokeSpy = (globalThis as any).__TAURI__.core.invoke as ReturnType<typeof vi.fn>;
      invokeSpy.mockImplementation(async (cmd: string) => {
        if (cmd === 'select_directory') return null;
        return {};
      });
      setSettingsState({ outputDirMode: 'input_dir', outputDirPath: '' });
      inputBtn.isFocused = false;
      customBtn.isFocused = false;

      modeGroup.dispatchEvent({
        type: 'keydown',
        key: 'ArrowRight',
        target: inputBtn,
        preventDefault: vi.fn()
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(getSettingsState()?.outputDirMode).toBe('input_dir');
      expect(inputBtn.isFocused).toBe(true);
      expect(inputBtn.getAttribute('aria-checked')).toBe('true');
      expect(customBtn.getAttribute('aria-checked')).toBe('false');
    });

    it('accepts Persian and Arabic digits in Settings number steppers and preserves untouched maxLen > 500 on Quick Deck blur', () => {
      resetQuickDeckState();
      const origQsa = (document as any).querySelectorAll;
      const optThreads = new MockElement('INPUT');
      optThreads.id = 'opt-threads';
      optThreads.value = '4';
      const wrap = new MockElement('DIV');
      wrap.className = 'number-input-control';
      (wrap as any).querySelector = (sel: string) => (sel === 'input' ? optThreads : null);
      (optThreads as any).closest = (sel: string) => (sel === '.number-input-control' ? wrap : null);

      const quickMaxLen = new MockElement('INPUT');
      quickMaxLen.id = 'quick-adv-maxLen';
      quickMaxLen.value = '600';
      const customRow = new MockElement('DIV');
      customRow.id = 'quick-maxlen-custom-row';
      const customBtn = new MockElement('BUTTON');
      customBtn.id = 'quick-maxlen-custom';
      [optThreads, quickMaxLen, customRow, customBtn].forEach(el => elementRegistry.set(el.id, el));

      (document as any).querySelectorAll = (sel: string) =>
        sel === '.number-input-control' ? [wrap] : [];

      try {
        setSettingsState({ threads: 4, maxLen: 600 });
        setupNumberInputControls();
        setupQuickConfigDeckEventListeners();

        // Persian digits in Settings #opt-threads must not be stripped
        optThreads.value = '۱۲';
        optThreads.dispatchEvent({ type: 'input' });
        expect(optThreads.value).toBe('۱۲');
        expect(getSettingsState()?.threads).toBe(12);

        // Arabic-Indic digits also normalize cleanly on blur
        optThreads.value = '٨';
        optThreads.dispatchEvent({ type: 'blur' });
        expect(optThreads.value).toBe('8');
        expect(getSettingsState()?.threads).toBe(8);

        // Activating Custom or blurring untouched Quick Deck input with maxLen = 600 must NOT clobber to 500
        activateCustomMaxLen();
        expect(getSettingsState()?.maxLen).toBe(600);
        expect(quickMaxLen.value).toBe('600');
        quickMaxLen.dispatchEvent({ type: 'blur' });
        expect(getSettingsState()?.maxLen).toBe(600);
      } finally {
        (document as any).querySelectorAll = origQsa;
        resetQuickDeckState();
      }
    });

    it('replaces stale red error sentence with clean neutral readout when editing an invalid range live', () => {
      resetQuickDeckState();
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';
      [startInput, endInput, hintEl].forEach(el => elementRegistry.set(el.id, el));

      const win = globalThis as any;
      win.window.isBatchMode = false;
      win.window.probedMetadata = { exists: true, durationSec: 120 };
      setSettingsState({ offsetT: 10_000, duration: 20_000 });
      setupQuickConfigDeckEventListeners();
      setQuickRangeMode('custom');

      try {
        // Trigger validation error on blur
        startInput.value = '00:50';
        endInput.value = '00:10';
        endInput.dispatchEvent({ type: 'blur' });
        expect(hintEl.classList.contains('is-error')).toBe(true);
        const errorText = hintEl.textContent;

        // While user types a still-incomplete value, error styling clears AND stale error sentence is replaced
        endInput.value = '00:';
        endInput.dispatchEvent({ type: 'input' });
        expect(hintEl.classList.contains('is-error')).toBe(false);
        expect(hintEl.textContent).not.toBe(errorText);
        expect(hintEl.textContent).toContain('00:10');
      } finally {
        win.window.probedMetadata = null;
        resetQuickDeckState();
      }
    });

    it('sets accurate noVadFound tooltip when disabling VAD with no VAD model installed', () => {
      const quickVad = new MockElement('INPUT');
      quickVad.id = 'quick-toggle-vad';
      quickVad.type = 'checkbox';
      quickVad.checked = true;
      elementRegistry.set(quickVad.id, quickVad);

      setLocalScannedVadModels([]);
      setSettingsState({ vad: true, vadModel: '' });

      toggleQuickVad(false);
      expect(getSettingsState()?.vad).toBe(false);
      expect(quickVad.title).toContain('Silero VAD');
      expect(quickVad.title).not.toContain('Click to enable');
    });

    it('keeps #opt-prompt input listener bound to live settingsState after setSettingsState replacement', () => {
      // Arrange
      const optPrompt = new MockElement('TEXTAREA');
      optPrompt.id = 'opt-prompt';
      const quickPrompt = new MockElement('TEXTAREA');
      quickPrompt.id = 'quick-adv-prompt';
      const quickCarry = new MockElement('INPUT');
      quickCarry.id = 'quick-adv-carryPrompt';
      quickCarry.type = 'checkbox';
      [optPrompt, quickPrompt, quickCarry].forEach(el => elementRegistry.set(el.id, el));

      const oldState = { prompt: 'stale', carryPrompt: true, maxLen: 42 };
      setSettingsState(oldState);
      bindSettingsToDOM();

      // Simulate engine reset replacing settingsState with a fresh object
      const freshState = { prompt: '', carryPrompt: false, maxLen: 0 };
      setSettingsState(freshState);
      bindSettingsToDOM();

      // Act
      optPrompt.value = 'Fresh technical glossary';
      optPrompt.dispatchEvent({ type: 'input' });

      // Assert: live state updates, old state is untouched, Quick Deck is NOT clobbered with stale values
      expect(getSettingsState()?.prompt).toBe('Fresh technical glossary');
      expect(oldState.prompt).toBe('stale');
      expect(quickPrompt.value).toBe('Fresh technical glossary');
      expect(quickCarry.checked).toBe(false);
    });

    it('clamps Settings #opt-offsetT/#opt-duration to Rust i32 bounds and parses Persian digits on change', () => {
      // Arrange
      const optOffset = new MockElement('INPUT');
      optOffset.id = 'opt-offsetT';
      optOffset.type = 'number';
      const optDuration = new MockElement('INPUT');
      optDuration.id = 'opt-duration';
      optDuration.type = 'number';
      [optOffset, optDuration].forEach(el => elementRegistry.set(el.id, el));

      setSettingsState({ offsetT: 0, duration: 0 });
      bindSettingsToDOM();

      // Act: exceed i32::MAX on offsetT and enter Persian digits on duration
      optOffset.value = '3000000000';
      (optOffset as any).onchange?.();
      optDuration.value = '۴۵۰۰۰';
      (optDuration as any).onchange?.();

      // Assert
      expect(getSettingsState()?.offsetT).toBe(2_147_483_000);
      expect(optOffset.value).toBe('2147483000');
      expect(getSettingsState()?.duration).toBe(45_000);
      expect(optDuration.value).toBe('45000');

      const sanitized = sanitizeSettingsPayload({ offsetT: '3500000000', threads: '۸' });
      expect(sanitized.offsetT).toBe(2_147_483_000);
      expect(sanitized.threads).toBe(8);
    });

    it('avoids redundant save_settings IPC calls when change is immediately followed by blur on steppers and quick maxLen', () => {
      // Arrange
      const origQsa = (document as any).querySelectorAll;
      const wrap = new MockElement('DIV');
      wrap.className = 'number-input-control';
      const optThreads = new MockElement('INPUT');
      optThreads.id = 'opt-threads';
      optThreads.type = 'text';
      optThreads.value = '4';
      wrap.appendChild(optThreads);
      (optThreads as any).closest = (sel: string) => (sel === '.number-input-control' ? wrap : null);

      const quickMaxLen = new MockElement('INPUT');
      quickMaxLen.id = 'quick-adv-maxLen';
      quickMaxLen.type = 'text';
      quickMaxLen.value = '40';
      [optThreads, quickMaxLen].forEach(el => elementRegistry.set(el.id, el));

      (document as any).querySelectorAll = (sel: string) => (sel === '.number-input-control' ? [wrap] : []);

      try {
        const saveSpy = vi.fn().mockResolvedValue(undefined);
        (globalThis as any).window.__TAURI__.core.invoke = saveSpy;
        setSettingsState({ threads: 4, maxLen: 40 });
        setupNumberInputControls();
        bindSettingsToDOM();
        setupQuickConfigDeckEventListeners();
        saveSpy.mockClear();

        // Act: edit stepper via input, then fire both change + blur (standard browser order)
        optThreads.value = '8';
        optThreads.dispatchEvent({ type: 'input' });
        optThreads.dispatchEvent({ type: 'change' });
        (optThreads as any).onchange?.();
        optThreads.dispatchEvent({ type: 'blur' });

        // Assert: only a single immediate save_settings call occurred
        const saveCalls = saveSpy.mock.calls.filter(c => c[0] === 'save_settings');
        expect(saveCalls).toHaveLength(1);
        expect(getSettingsState()?.threads).toBe(8);

        // Act: edit quick-adv-maxLen via input, then fire change + blur
        saveSpy.mockClear();
        vi.useFakeTimers();
        quickMaxLen.value = '55';
        quickMaxLen.dispatchEvent({ type: 'input' });
        quickMaxLen.dispatchEvent({ type: 'change' });
        quickMaxLen.dispatchEvent({ type: 'blur' });
        vi.advanceTimersByTime(300);
        vi.useRealTimers();

        const maxLenSaves = saveSpy.mock.calls.filter(c => c[0] === 'save_settings');
        expect(maxLenSaves).toHaveLength(1);
        expect(getSettingsState()?.maxLen).toBe(55);
      } finally {
        vi.useRealTimers();
        (document as any).querySelectorAll = origQsa;
        resetQuickDeckState();
      }
    });

    it('flags out-of-range Settings offsetT/duration immediately in Quick Deck when single-file duration is known', () => {
      // Arrange
      const optOffset = new MockElement('INPUT');
      optOffset.id = 'opt-offsetT';
      optOffset.type = 'number';
      const optDuration = new MockElement('INPUT');
      optDuration.id = 'opt-duration';
      optDuration.type = 'number';
      const rangeCheckbox = new MockElement('INPUT');
      rangeCheckbox.id = 'quick-range-enabled';
      rangeCheckbox.type = 'checkbox';
      const inputsRow = new MockElement('DIV');
      inputsRow.id = 'quick-range-inputs';
      const startWrap = new MockElement('DIV');
      startWrap.className = 'transcribe-range-input-wrap';
      const startInput = new MockElement('INPUT');
      startInput.id = 'quick-range-start';
      (startInput as any).closest = (sel: string) => (sel === '.transcribe-range-input-wrap' ? startWrap : null);
      const endWrap = new MockElement('DIV');
      endWrap.className = 'transcribe-range-input-wrap';
      const endInput = new MockElement('INPUT');
      endInput.id = 'quick-range-end';
      (endInput as any).closest = (sel: string) => (sel === '.transcribe-range-input-wrap' ? endWrap : null);
      const hintEl = new MockElement('DIV');
      hintEl.id = 'quick-range-hint';

      [optOffset, optDuration, rangeCheckbox, inputsRow, startInput, endInput, hintEl].forEach(el =>
        elementRegistry.set(el.id, el)
      );

      const prevProbed = (globalThis as any).window.probedMetadata;
      const prevBatch = (globalThis as any).window.isBatchMode;
      try {
        (globalThis as any).window.isBatchMode = false;
        (globalThis as any).window.probedMetadata = { exists: true, durationSec: 60 };
        setSettingsState({ offsetT: 0, duration: 0 });
        bindSettingsToDOM();

        // Act: set offsetT = 90_000ms (90s) from Settings while a 60s file is loaded
        optOffset.value = '90000';
        (optOffset as any).onchange?.();

        // Assert: Quick Deck must immediately surface error styling rather than neutral "01:30 -> 01:00"
        expect(hintEl.classList.contains('is-error')).toBe(true);
        expect(startWrap.classList.contains('is-invalid')).toBe(true);
        expect(endWrap.classList.contains('is-invalid')).toBe(true);

        // Act: fix offsetT back inside bounds (20s)
        optOffset.value = '20000';
        (optOffset as any).onchange?.();

        // Assert: error clears and neutral summary restores
        expect(hintEl.classList.contains('is-error')).toBe(false);
        expect(startWrap.classList.contains('is-invalid')).toBe(false);
        expect(hintEl.textContent).toContain('00:20');
      } finally {
        (globalThis as any).window.probedMetadata = prevProbed;
        (globalThis as any).window.isBatchMode = prevBatch;
        resetQuickDeckState();
      }
    });

    it('disables confidence threshold stepper buttons at min/max bounds and avoids redundant saves', () => {
      const decBtn = new MockElement('BUTTON');
      decBtn.id = 'btn-confidence-threshold-dec';
      const incBtn = new MockElement('BUTTON');
      incBtn.id = 'btn-confidence-threshold-inc';
      const badge = new MockElement('SPAN');
      badge.id = 'confidence-threshold-badge';
      const sel = new MockElement('SELECT');
      sel.id = 'opt-confidenceThreshold';
      [decBtn, incBtn, badge, sel].forEach(el => elementRegistry.set(el.id, el));

      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      const prevTauri = (globalThis as any).window.__TAURI__;
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };

      try {
        setSettingsState({ confidenceThreshold: 40 });
        settingsManager.syncConfidenceThresholdSettingsUI(40, false);
        expect(decBtn.disabled).toBe(true);
        expect(incBtn.disabled).toBe(false);
        expect(badge.textContent).toBe('40%');

        // Adjusting below min (40 -> 35) must be a no-op with zero invoke save calls
        expect(settingsManager.adjustConfidenceThresholdPreference(-5)).toBe(40);
        expect(invokeSpy).not.toHaveBeenCalled();

        // Adjusting up to 95 disables the increment button
        setSettingsState({ confidenceThreshold: 95 });
        settingsManager.syncConfidenceThresholdSettingsUI(95, false);
        expect(decBtn.disabled).toBe(false);
        expect(incBtn.disabled).toBe(true);
        expect(settingsManager.adjustConfidenceThresholdPreference(5)).toBe(95);
        expect(invokeSpy).not.toHaveBeenCalled();
      } finally {
        (globalThis as any).window.__TAURI__ = prevTauri;
      }
    });

    it('flushes dirty theme state on unload even when no debounce timer is active', () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      const prevTauri = (globalThis as any).window.__TAURI__;
      const prevMarkDirty = (globalThis as any).window.markSettingsDirty;
      const docObj = (globalThis as any).document as any;
      const prevDocEl = docObj.documentElement;
      const mockDocEl = new MockElement('HTML');
      (mockDocEl as any).style = { setProperty: vi.fn(), removeProperty: vi.fn() };
      docObj.documentElement = mockDocEl;
      (globalThis as any).window.__TAURI__ = { core: { invoke: invokeSpy } };
      syncSettingsManagerWindowBindings();

      try {
        // 1. switchTheme marks settings dirty synchronously via window.markSettingsDirty
        const dirtySpy = vi.fn(markSettingsDirty);
        (globalThis as any).window.markSettingsDirty = dirtySpy;
        setSettingsState({ theme: 'royal-blue', uiLanguage: 'en' });
        switchTheme('emerald', true);
        expect(dirtySpy).toHaveBeenCalledTimes(1);

        // Flush any debounce timer created by non-animated test-env finalization, then reset spy
        flushPendingSettingsOnUnload();
        invokeSpy.mockClear();

        // 2. Simulate theme/monochrome update marked dirty with NO debounce timer armed (mid-1000ms wipe)
        setSettingsState({ theme: 'fire-orange', uiLanguage: 'en' });
        markSettingsDirty();
        flushPendingSettingsOnUnload();

        expect(invokeSpy).toHaveBeenCalledTimes(1);
        expect(invokeSpy).toHaveBeenCalledWith(
          'save_settings',
          expect.objectContaining({
            settings: expect.objectContaining({ theme: 'fire-orange' })
          })
        );

        // Second flush without new dirty changes must be a no-op
        flushPendingSettingsOnUnload();
        expect(invokeSpy).toHaveBeenCalledTimes(1);
      } finally {
        flushPendingSettingsOnUnload();
        docObj.documentElement = prevDocEl;
        (globalThis as any).window.__TAURI__ = prevTauri;
        (globalThis as any).window.markSettingsDirty = prevMarkDirty;
      }
    });
  });

  describe('Settings page audit regressions', () => {
    it('re-scans models when selectedBackend changes in bindSettingsToDOM', async () => {
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'check_build') return Promise.resolve(true);
        if (cmd === 'scan_models') return Promise.resolve({ models: ['ggml-small.bin'], vadModels: [] });
        return Promise.resolve({});
      });
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const backendSel = new MockElement('SELECT');
      backendSel.id = 'opt-selectedBackend';
      const optStd = new MockElement('OPTION');
      optStd.value = 'Standard';
      const optOv = new MockElement('OPTION');
      optOv.value = 'OpenVINO';
      backendSel.appendChild(optStd);
      backendSel.appendChild(optOv);
      elementRegistry.set('opt-selectedBackend', backendSel);

      const transSel = new MockElement('SELECT');
      transSel.id = 'opt-modelPath';
      elementRegistry.set('opt-modelPath', transSel);

      setSettingsState({ selectedBackend: 'Standard', modelsDir: '/tmp/models', modelPath: 'ggml-base.bin' });
      bindSettingsToDOM();
      invokeSpy.mockClear();

      backendSel.value = 'OpenVINO';
      (backendSel as any).onchange?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(invokeSpy).toHaveBeenCalledWith('scan_models', expect.objectContaining({ backend: 'OpenVINO' }));
    });

    it('re-scans models and VAD files inside confirmResetWhisperEngine', async () => {
      vi.mocked(showConfirmModal).mockResolvedValueOnce(true);
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'reset_whisper_core_settings') {
          return Promise.resolve({
            selectedBackend: 'Standard',
            modelsDir: '/tmp/models',
            modelPath: 'ggml-base.en.bin',
            vadModel: 'ggml-silero-v6.2.0.bin',
            vad: false,
            outputSrt: true
          });
        }
        if (cmd === 'scan_models') {
          return Promise.resolve({
            models: ['ggml-base.en.bin'],
            vadModels: ['ggml-silero-v5.1.2.bin']
          });
        }
        if (cmd === 'check_build') return Promise.resolve(true);
        return Promise.resolve({});
      });
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const vadSel = new MockElement('SELECT');
      vadSel.id = 'opt-vadModel';
      elementRegistry.set('opt-vadModel', vadSel);

      await settingsManager.confirmResetWhisperEngine();

      expect(invokeSpy).toHaveBeenCalledWith('reset_whisper_core_settings', undefined);
      expect(invokeSpy).toHaveBeenCalledWith('scan_models', expect.objectContaining({ modelsDir: '/tmp/models', backend: 'Standard' }));
      expect(getSettingsState().vadModel).toBe('ggml-silero-v5.1.2.bin');
    });

    it('clamps float settings in both sanitizeSettingsPayload and bindSettingsToDOM onchange', () => {
      const cleaned = sanitizeSettingsPayload({
        vadThold: '5',
        temperature: '-1',
        temperatureInc: '4.5',
        wordThold: '2',
        noSpeechThold: '-0.4',
        vadOverlap: '3',
        entropyThold: '-2',
        logprobThold: '5',
        vadMaxSpeech: '500',
        uiScale: '2.5'
      });

      expect(cleaned.vadThold).toBe(1.0);
      expect(cleaned.temperature).toBe(0.0);
      expect(cleaned.temperatureInc).toBe(2.0);
      expect(cleaned.wordThold).toBe(1.0);
      expect(cleaned.noSpeechThold).toBe(0.0);
      expect(cleaned.vadOverlap).toBe(1.0);
      expect(cleaned.entropyThold).toBe(0.0);
      expect(cleaned.logprobThold).toBe(0.0);
      expect(cleaned.vadMaxSpeech).toBe(300.0);
      expect(cleaned.uiScale).toBe(1.6);

      const vadTholdInput = new MockElement('INPUT');
      vadTholdInput.type = 'number';
      vadTholdInput.id = 'opt-vadThold';
      elementRegistry.set('opt-vadThold', vadTholdInput);

      setSettingsState({ vadThold: 0.5 });
      bindSettingsToDOM();

      vadTholdInput.value = '5';
      (vadTholdInput as any).onchange?.();
      expect(vadTholdInput.value).toBe('1');
      expect(getSettingsState().vadThold).toBe(1.0);
    });

    it('reveals matched auto-translate cards or matching provider sub-tabs during search and restores on clear', () => {
      const mgrCard = new MockElement('DIV');
      mgrCard.id = 'provider-manager-card';

      const btnAuto = new MockElement('BUTTON');
      btnAuto.id = 'tab-btn-auto';
      btnAuto.className = 'provider-tab-btn';
      btnAuto.textContent = 'Auto-Translate';

      const btnProv = new MockElement('BUTTON');
      btnProv.id = 'tab-btn-providers';
      btnProv.className = 'provider-tab-btn active';
      btnProv.textContent = 'API Providers';

      const btnGen = new MockElement('BUTTON');
      btnGen.id = 'tab-btn-general';
      btnGen.className = 'provider-tab-btn';
      btnGen.textContent = 'Provider Configuration';

      mgrCard.appendChild(btnAuto);
      mgrCard.appendChild(btnProv);
      mgrCard.appendChild(btnGen);

      const paneAuto = new MockElement('DIV');
      paneAuto.id = 'provider-tab-auto';
      paneAuto.className = 'provider-tab-content';
      paneAuto.style.display = 'none';

      const autoCard = new MockElement('DIV');
      autoCard.className = 'setting-card';
      const autoTitle = new MockElement('DIV');
      autoTitle.className = 'setting-title';
      autoTitle.textContent = 'Enable Polish Pass';
      autoCard.appendChild(autoTitle);
      paneAuto.appendChild(autoCard);

      const paneProv = new MockElement('DIV');
      paneProv.id = 'provider-tab-providers';
      paneProv.className = 'provider-tab-content';
      paneProv.style.display = 'block';

      const paneGen = new MockElement('DIV');
      paneGen.id = 'provider-tab-general';
      paneGen.className = 'provider-tab-content';
      paneGen.style.display = 'none';
      const genLabel = new MockElement('LABEL');
      genLabel.textContent = 'Base URL';
      paneGen.appendChild(genLabel);
      paneGen.querySelectorAll = (sel: string) => (sel.includes('label') ? [genLabel] : []);

      const groupTrans = new MockElement('DIV');
      groupTrans.id = 'group-translation';
      groupTrans.className = 'settings-group';
      groupTrans.appendChild(mgrCard);
      mgrCard.appendChild(paneAuto);
      mgrCard.appendChild(paneProv);
      mgrCard.appendChild(paneGen);

      const catTrans = new MockElement('BUTTON');
      catTrans.id = 'cat-btn-translation';
      catTrans.className = 'settings-cat-btn';
      catTrans.textContent = 'AI Translation';

      elementRegistry.set('cat-btn-translation', catTrans);
      elementRegistry.set('group-translation', groupTrans);
      elementRegistry.set('provider-manager-card', mgrCard);
      elementRegistry.set('tab-btn-auto', btnAuto);
      elementRegistry.set('tab-btn-providers', btnProv);
      elementRegistry.set('tab-btn-general', btnGen);
      elementRegistry.set('provider-tab-auto', paneAuto);
      elementRegistry.set('provider-tab-providers', paneProv);
      elementRegistry.set('provider-tab-general', paneGen);

      executeFilterSettings('Polish');
      expect(paneAuto.style.display).toBe('flex');
      expect(paneProv.style.display).toBe('none');
      expect(btnAuto.classList.contains('active')).toBe(true);
      expect(catTrans.querySelector('.cat-match-badge')?.textContent).toBe('1');

      executeFilterSettings('Base URL');
      expect(paneGen.style.display).toBe('block');
      expect(paneAuto.style.display).toBe('none');
      expect(btnGen.classList.contains('active')).toBe(true);
      expect(catTrans.querySelector('.cat-match-badge')?.textContent).toBe('1');

      executeFilterSettings('');
      expect(paneProv.style.display).toBe('block');
      expect(btnProv.classList.contains('active')).toBe(true);
    });

    it('sets initial title tooltip on opt-outputDirPath during refreshSettings', async () => {
      const docObj = (globalThis as any).document as any;
      const prevDocEl = docObj.documentElement;
      const prevStorage = (globalThis as any).localStorage;
      const mockDocEl = new MockElement('HTML');
      (mockDocEl as any).style = { setProperty: vi.fn(), removeProperty: vi.fn() };
      docObj.documentElement = mockDocEl;
      const store = new Map<string, string>();
      (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k)
      };

      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'load_settings') {
          return Promise.resolve({
            selectedBackend: 'Standard',
            modelsDir: '/models/path',
            outputDirPath: '/custom/output/path',
            outputSrt: true
          });
        }
        if (cmd === 'scan_models') return Promise.resolve({ models: [], vadModels: [] });
        if (cmd === 'check_build') return Promise.resolve(true);
        return Promise.resolve({});
      });
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      try {
        const outWrap = new MockElement('DIV');
        const outInput = new MockElement('INPUT');
        outInput.type = 'text';
        outInput.id = 'opt-outputDirPath';
        outWrap.appendChild(outInput);
        elementRegistry.set('opt-outputDirPath', outInput);

        await settingsManager.refreshSettings();
        expect(outInput.value).toBe('/custom/output/path');
        expect(outInput.title).toContain('/custom/output/path');
        expect(outWrap.title).toContain('/custom/output/path');
      } finally {
        docObj.documentElement = prevDocEl;
        (globalThis as any).localStorage = prevStorage;
      }
    });

    it('marks settings dirty immediately on checkbox switch toggle so flushPendingSettingsOnUnload saves before 240ms', () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const chk = new MockElement('INPUT');
      chk.type = 'checkbox';
      chk.id = 'opt-carryPrompt';
      elementRegistry.set('opt-carryPrompt', chk);

      setSettingsState({
        carryPrompt: false,
        outputSrt: true
      });
      bindSettingsToDOM();

      chk.checked = true;
      (chk as any).onchange();

      flushPendingSettingsOnUnload();
      expect(invokeSpy).toHaveBeenCalledWith(
        'save_settings',
        expect.objectContaining({
          settings: expect.objectContaining({ carryPrompt: true })
        })
      );
    });

    it('ignores stale concurrent scanAndPopulateModels responses and populates empty VAD option when none exist', async () => {
      let resolveFirst!: (val: any) => void;
      let callCount = 0;
      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'scan_models') {
          callCount += 1;
          if (callCount === 1) {
            return new Promise(res => { resolveFirst = res; });
          }
          return Promise.resolve({ transModels: ['/models/ggml-base.bin'], vadModels: [] });
        }
        return Promise.resolve(undefined);
      });
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const transSelect = new MockElement('SELECT');
      transSelect.id = 'opt-modelPath';
      const vadSelect = new MockElement('SELECT');
      vadSelect.id = 'opt-vadModel';
      elementRegistry.set('opt-modelPath', transSelect);
      elementRegistry.set('opt-vadModel', vadSelect);

      setSettingsState({ selectedBackend: 'Standard', modelsDir: '/models', modelPath: '', vadModel: '' });

      const firstScan = settingsManager.scanAndPopulateModels();
      const secondScan = settingsManager.scanAndPopulateModels();

      await secondScan;
      resolveFirst({ transModels: ['/models/ggml-stale.bin'], vadModels: ['/models/stale-vad.bin'] });
      await firstScan;

      expect(getLocalScannedTransModels()).toEqual(['/models/ggml-base.bin']);
      expect(getLocalScannedVadModels()).toEqual([]);
      expect(vadSelect.options.length).toBe(1);
      expect(vadSelect.options[0].value).toBe('');
      expect(vadSelect.options[0].textContent).toBeTruthy();
    });

    it('keeps #output-dir-custom-card hidden during search when outputDirMode is input_dir', () => {
      const tabOutputs = new MockElement('BUTTON');
      tabOutputs.id = 'cat-btn-outputs';
      tabOutputs.className = 'settings-cat-btn';
      tabOutputs.textContent = 'Outputs';

      const groupOutputs = new MockElement('DIV');
      groupOutputs.id = 'group-outputs';
      groupOutputs.className = 'settings-group';

      const modeSelect = new MockElement('SELECT');
      modeSelect.id = 'opt-outputDirMode';
      modeSelect.value = 'input_dir';
      elementRegistry.set('opt-outputDirMode', modeSelect);

      const modeCard = new MockElement('DIV');
      modeCard.className = 'setting-card';
      const modeTitle = new MockElement('DIV');
      modeTitle.className = 'setting-title';
      modeTitle.textContent = 'Output Directory Mode';
      modeCard.appendChild(modeTitle);

      const customCard = new MockElement('DIV');
      customCard.id = 'output-dir-custom-card';
      customCard.className = 'setting-card';
      customCard.style.display = 'none';
      const customTitle = new MockElement('DIV');
      customTitle.className = 'setting-title';
      customTitle.textContent = 'Custom Output Path';
      customCard.appendChild(customTitle);

      groupOutputs.appendChild(modeCard);
      groupOutputs.appendChild(customCard);
      elementRegistry.set('cat-btn-outputs', tabOutputs);
      elementRegistry.set('group-outputs', groupOutputs);

      setSettingsState({ outputDirMode: 'input_dir' });
      executeFilterSettings('Custom Output');

      expect(customCard.style.display).toBe('none');
    });

    it('marks settings dirty immediately on #opt-autoTransferToTranslate toggle so flushPendingSettingsOnUnload saves before 240ms', () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const chk = new MockElement('INPUT');
      chk.type = 'checkbox';
      chk.id = 'opt-autoTransferToTranslate';
      elementRegistry.set('opt-autoTransferToTranslate', chk);

      setSettingsState({
        translateAiEnabled: false,
        outputSrt: true
      });
      bindSettingsToDOM();

      chk.checked = true;
      (chk as any).onchange();

      flushPendingSettingsOnUnload();
      expect(invokeSpy).toHaveBeenCalledWith(
        'save_settings',
        expect.objectContaining({
          settings: expect.objectContaining({
            translateAiEnabled: true,
            autoTransferToTranslate: true
          })
        })
      );
    });

    it('saves plain number inputs on input event via flushPendingSettingsOnUnload without rewriting el.value mid-typing', () => {
      const invokeSpy = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;

      const numInput = new MockElement('INPUT');
      numInput.type = 'number';
      numInput.id = 'opt-vadThold';
      elementRegistry.set('opt-vadThold', numInput);

      setSettingsState({
        vadThold: 0.5,
        outputSrt: true
      });
      bindSettingsToDOM();

      numInput.value = '0.75';
      numInput.dispatchEvent(new Event('input'));

      expect(getSettingsState()?.vadThold).toBe(0.75);
      expect(numInput.value).toBe('0.75');

      flushPendingSettingsOnUnload();
      expect(invokeSpy).toHaveBeenCalledWith(
        'save_settings',
        expect.objectContaining({
          settings: expect.objectContaining({ vadThold: 0.75 })
        })
      );
    });

    it('persists system fallback and re-probes status & builds when bundled whisper binary is missing', async () => {
      const prevSettings = getSettingsState();
      const wBadge = new MockElement('SPAN');
      const wSelect = new MockElement('SELECT');
      wSelect.id = 'opt-whisperSource';
      const optBundled = new MockElement('OPTION');
      optBundled.value = 'bundled';
      optBundled.textContent = 'Internal';
      const optSystem = new MockElement('OPTION');
      optSystem.value = 'system';
      optSystem.textContent = 'System';
      wSelect.appendChild(optBundled);
      wSelect.appendChild(optSystem);
      wSelect.value = 'bundled';

      elementRegistry.set('whisper-status-badge', wBadge);
      elementRegistry.set('opt-whisperSource', wSelect);

      const invokeMock = vi.fn().mockImplementation(async (cmd: string, args?: any) => {
        if (cmd === 'get_whisper_status' && args?.source === 'bundled') {
          return {
            configuredSource: 'bundled',
            resolvedPath: 'Not Bundled',
            isAvailable: false,
            bundledAvailable: false,
            version: 'N/A',
            availableBackends: [],
            errorMessage: 'Bundled binaries missing'
          };
        }
        if (cmd === 'get_whisper_status' && args?.source === 'system') {
          return {
            configuredSource: 'system',
            resolvedPath: '/usr/bin/whisper-cli',
            isAvailable: true,
            bundledAvailable: false,
            version: 'whisper.cpp v1.9.5',
            availableBackends: ['Standard', 'Vulkan'],
            errorMessage: null
          };
        }
        if (cmd === 'check_build') {
          return args?.backend === 'Standard' || args?.backend === 'Vulkan';
        }
        return {};
      });
      (globalThis as any).__TAURI__.core.invoke = invokeMock;
      setSettingsState({ whisperSource: 'bundled', selectedBackend: 'Standard', uiLanguage: 'en' });

      try {
        await refreshWhisperStatus('bundled', false);

        expect(getSettingsState()?.whisperSource).toBe('system');
        expect(wSelect.value).toBe('system');
        expect(invokeMock).toHaveBeenCalledWith('save_settings', expect.objectContaining({
          settings: expect.objectContaining({ whisperSource: 'system' })
        }));
        expect(invokeMock).toHaveBeenCalledWith('get_whisper_status', { source: 'system' });
        expect(invokeMock).toHaveBeenCalledWith('check_build', { backend: 'Vulkan' });
        expect(wBadge.className).toContain('ready');
      } finally {
        setSettingsState(prevSettings);
      }
    });

    it('flushes pending debounced/zoom/toggle settings BEFORE invoking reset_whisper_core_settings', async () => {
      vi.useFakeTimers();
      const prevSettings = getSettingsState();
      const callOrder: string[] = [];
      const invokeMock = vi.fn().mockImplementation(async (cmd: string) => {
        callOrder.push(cmd);
        if (cmd === 'reset_whisper_core_settings') {
          return { theme: 'emerald', uiScale: 1.25, uiLanguage: 'en', selectedBackend: 'Standard', modelPath: 'ggml-base.bin' };
        }
        if (cmd === 'scan_models') return { transModels: ['ggml-base.bin'], vadModels: [] };
        return true;
      });
      (globalThis as any).__TAURI__.core.invoke = invokeMock;
      setSettingsState({ theme: 'royal-blue', uiScale: 1.0, uiLanguage: 'en', closeToTray: false });
      syncSettingsManagerWindowBindings();

      try {
        await applyUiZoom(1.25, true, false);
        const cur = getSettingsState();
        if (cur) cur.closeToTray = true;
        await saveCurrentSettings(false);

        await confirmResetWhisperEngine();

        expect(callOrder.indexOf('save_settings')).toBeGreaterThanOrEqual(0);
        expect(callOrder.indexOf('save_settings')).toBeLessThan(callOrder.indexOf('reset_whisper_core_settings'));
        expect(invokeMock).toHaveBeenCalledWith(
          'save_settings',
          expect.objectContaining({
            settings: expect.objectContaining({ uiScale: 1.25, closeToTray: true })
          })
        );

        // Advancing timers must not trigger a second redundant save from cleared zoom/debounce timers
        const saveCountAfterReset = invokeMock.mock.calls.filter(c => c[0] === 'save_settings').length;
        vi.advanceTimersByTime(1000);
        expect(invokeMock.mock.calls.filter(c => c[0] === 'save_settings').length).toBe(saveCountAfterReset);
      } finally {
        vi.useRealTimers();
        setSettingsState(prevSettings);
      }
    });

    it('cancels pending debounced filterSettings timer when switchSettingsCategory is called', () => {
      vi.useFakeTimers();
      try {
        const searchInput = new MockElement('INPUT');
        searchInput.id = 'settings-search-input';
        searchInput.value = 'vulkan';
        elementRegistry.set('settings-search-input', searchInput);

        const appGroup = new MockElement('DIV');
        appGroup.id = 'group-app';
        appGroup.className = 'settings-group active';
        elementRegistry.set('group-app', appGroup);

        const gpuGroup = new MockElement('DIV');
        gpuGroup.id = 'group-gpu';
        gpuGroup.className = 'settings-group';
        elementRegistry.set('group-gpu', gpuGroup);

        const appTab = new MockElement('BUTTON');
        appTab.id = 'cat-btn-app';
        appTab.className = 'settings-cat-btn active';
        elementRegistry.set('cat-btn-app', appTab);

        const gpuTab = new MockElement('BUTTON');
        gpuTab.id = 'cat-btn-gpu';
        gpuTab.className = 'settings-cat-btn';
        elementRegistry.set('cat-btn-gpu', gpuTab);

        // Trigger debounced search, then switch category immediately before 80ms elapses
        filterSettings('vulkan', false);
        searchInput.value = '';
        switchSettingsCategory('gpu');

        vi.advanceTimersByTime(150);

        expect(getActiveSettingsCat()).toBe('gpu');
        expect(gpuGroup.classList.contains('active')).toBe(true);
        expect(appGroup.classList.contains('active')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('blocks confirmResetWhisperEngine when batch extraction is active via flag or batchProcessor', async () => {
      const confirmSpy = vi.mocked(showConfirmModal);
      confirmSpy.mockClear();
      const invokeMock = vi.fn().mockResolvedValue(undefined);
      (globalThis as any).__TAURI__.core.invoke = invokeMock;

      const win = globalThis as any;
      const prevBatchExtracting = win.isBatchExtracting;
      const prevBatchProcessor = win.batchProcessor;
      try {
        win.isBatchExtracting = true;
        await confirmResetWhisperEngine();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalledWith('reset_whisper_core_settings', expect.anything());

        win.isBatchExtracting = false;
        win.batchProcessor = { getIsExtracting: () => true };
        await confirmResetWhisperEngine();
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(invokeMock).not.toHaveBeenCalledWith('reset_whisper_core_settings', expect.anything());
      } finally {
        win.isBatchExtracting = prevBatchExtracting;
        win.batchProcessor = prevBatchProcessor;
      }
    });

    it('discards stale FFmpeg, Whisper, and build status responses resolved out of order', async () => {
      const prevSettings = getSettingsState();
      const ffBadge = new MockElement('SPAN');
      const wBadge = new MockElement('SPAN');
      const backendSel = new MockElement('SELECT');
      const optCpu = new MockElement('OPTION');
      optCpu.value = 'Standard';
      optCpu.textContent = 'CPU';
      const optVulkan = new MockElement('OPTION');
      optVulkan.value = 'Vulkan';
      optVulkan.textContent = 'Vulkan GPU';
      backendSel.appendChild(optCpu);
      backendSel.appendChild(optVulkan);

      elementRegistry.set('ffmpeg-status-badge', ffBadge);
      elementRegistry.set('whisper-status-badge', wBadge);
      elementRegistry.set('opt-selectedBackend', backendSel);
      setSettingsState({ ffmpegSource: 'bundled', whisperSource: 'bundled', selectedBackend: 'Standard' });

      let resolveFf1!: (v: any) => void;
      let resolveFf2!: (v: any) => void;
      let resolveWh1!: (v: any) => void;
      let resolveWh2!: (v: any) => void;
      let resolveBld1!: (v: boolean) => void;
      let resolveBld2!: (v: boolean) => void;
      let ffCalls = 0;
      let whCalls = 0;
      let bldCalls = 0;

      (globalThis as any).__TAURI__.core.invoke = vi.fn((cmd: string, args?: any) => {
        if (cmd === 'get_ffmpeg_status') {
          return new Promise(res => {
            if (++ffCalls === 1) resolveFf1 = res;
            else resolveFf2 = res;
          });
        }
        if (cmd === 'get_whisper_status') {
          return new Promise(res => {
            if (++whCalls === 1) resolveWh1 = res;
            else resolveWh2 = res;
          });
        }
        if (cmd === 'check_build') {
          if (args?.backend === 'Vulkan') {
            return new Promise<boolean>(res => {
              if (++bldCalls === 1) resolveBld1 = res;
              else resolveBld2 = res;
            });
          }
          return Promise.resolve(args?.backend === 'Standard');
        }
        return Promise.resolve({});
      });

      try {
        const ffP1 = refreshFFmpegStatus('system', false, false);
        const ffP2 = refreshFFmpegStatus('bundled', false, false);
        const whP1 = refreshWhisperStatus('system', false, false);
        const whP2 = refreshWhisperStatus('bundled', false, false);

        const bldP1 = refreshBuildStatuses();
        await vi.waitFor(() => expect(typeof resolveBld1).toBe('function'));
        const bldP2 = refreshBuildStatuses();
        await vi.waitFor(() => expect(typeof resolveBld2).toBe('function'));

        resolveFf2({ configuredSource: 'bundled', resolvedPath: '/b/ff', isAvailable: true, bundledAvailable: true, version: '7.1', errorMessage: null });
        resolveWh2({ configuredSource: 'bundled', resolvedPath: '/b/wh', isAvailable: true, bundledAvailable: true, version: '1.9.5', availableBackends: ['Standard'], errorMessage: null });
        resolveBld2(true);
        await Promise.all([ffP2, whP2, bldP2]);

        resolveFf1({ configuredSource: 'system', resolvedPath: '/old', isAvailable: false, bundledAvailable: true, version: 'N/A', errorMessage: 'Missing' });
        resolveWh1({ configuredSource: 'system', resolvedPath: '/old', isAvailable: false, bundledAvailable: true, version: 'N/A', availableBackends: [], errorMessage: 'Missing' });
        resolveBld1(false);
        await Promise.all([ffP1, whP1, bldP1]);

        expect(ffBadge.innerHTML).toContain('v7.1');
        expect(wBadge.innerHTML).toContain('v1.9.5');
        expect(optVulkan.disabled).toBe(false);
      } finally {
        setSettingsState(prevSettings);
      }
    });

    it('restores hasUnsavedSettings on save failure and handles dirty provider flush in flushPendingSettingsOnUnload', async () => {
      const prevSettings = getSettingsState();
      const prevFlushProv = (globalThis as any).window.flushPendingProviderGeneralChanges;
      const invokeMock = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(true);
      (globalThis as any).__TAURI__.core.invoke = invokeMock;
      setSettingsState({ theme: 'royal-blue', outputSrt: true });

      try {
        // Immediate save failure must keep dirty state so unload flushes later
        await saveCurrentSettings(true);
        expect(invokeMock).toHaveBeenCalledTimes(1);

        const dirtyFlushSpy = vi.fn().mockResolvedValue(true);
        (globalThis as any).window.flushPendingProviderGeneralChanges = dirtyFlushSpy;
        await flushPendingSettingsOnUnload();

        expect(dirtyFlushSpy).toHaveBeenCalledTimes(1);
        expect(invokeMock).toHaveBeenCalledTimes(2);
      } finally {
        (globalThis as any).window.flushPendingProviderGeneralChanges = prevFlushProv;
        setSettingsState(prevSettings);
      }
    });

    it('restores hidden #provider-tab-auto setting cards when switching to translation category after sub-tab search', () => {
      const autoCard = new MockElement('DIV');
      autoCard.className = 'setting-card';
      autoCard.style.display = 'none';

      const transTab = new MockElement('BUTTON');
      transTab.id = 'cat-btn-translation';
      transTab.className = 'settings-cat-btn';
      const transGroup = new MockElement('DIV');
      transGroup.id = 'group-translation';
      transGroup.className = 'settings-group';
      transGroup.appendChild(autoCard);
      elementRegistry.set('cat-btn-translation', transTab);
      elementRegistry.set('group-translation', transGroup);

      const origQsa = (globalThis as any).document.querySelectorAll;
      (globalThis as any).document.querySelectorAll = vi.fn((sel: string) => {
        if (sel === '#provider-tab-auto .setting-card') return [autoCard];
        return origQsa(sel);
      });

      try {
        switchSettingsCategory('translation');
        expect(autoCard.style.display).toBe('');
      } finally {
        (globalThis as any).document.querySelectorAll = origQsa;
      }
    });

    it('prompts and pauses active model downloads before switching modelsDir in browseModelsDirectory', async () => {
      const prevSettings = settingsManager.getSettingsState();
      const prevGetActive = (globalThis as any).window.getActiveModelDownloadNames;

      const modelsInput = new MockElement('INPUT');
      modelsInput.id = 'opt-modelsDir';
      modelsInput.value = '/old/models';
      elementRegistry.set('opt-modelsDir', modelsInput);

      setSettingsState({ selectedBackend: 'Standard', modelsDir: '/old/models' });
      (globalThis as any).window.getActiveModelDownloadNames = vi.fn(() => ['small']);

      const invokeSpy = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === 'select_directory') return Promise.resolve('/new/models');
        if (cmd === 'verify_directory_writable') return Promise.resolve(true);
        if (cmd === 'pause_download_model') return Promise.resolve(undefined);
        if (cmd === 'scan_models') return Promise.resolve({ transModels: [], vadModels: [] });
        return Promise.resolve(undefined);
      });
      (globalThis as any).__TAURI__.core.invoke = invokeSpy;
      const confirmSpy = vi.mocked(showConfirmModal);

      try {
        // Case 1: User cancels modal -> directory must NOT change and download must NOT pause
        confirmSpy.mockResolvedValueOnce(false);
        await settingsManager.browseModelsDirectory();
        expect(settingsManager.getSettingsState()?.modelsDir).toBe('/old/models');
        expect(invokeSpy).not.toHaveBeenCalledWith('pause_download_model', expect.anything());

        // Case 2: User confirms -> active downloads pause, then directory updates
        confirmSpy.mockResolvedValueOnce(true);
        await settingsManager.browseModelsDirectory();
        expect(invokeSpy).toHaveBeenCalledWith('pause_download_model', { modelName: 'small' });
        expect(settingsManager.getSettingsState()?.modelsDir).toBe('/new/models');
        expect(modelsInput.value).toBe('/new/models');
      } finally {
        (globalThis as any).window.getActiveModelDownloadNames = prevGetActive;
        setSettingsState(prevSettings);
      }
    });
  });
});
