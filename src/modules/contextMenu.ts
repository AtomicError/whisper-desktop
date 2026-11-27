/**
 * Native-Feel In-App Context Menu Controller
 *
 * Replaces the generic browser context menu outside native editable inputs with
 * a theme-aware, RTL/LTR-compatible, keyboard-accessible menu tailored to each
 * workstation section (Logs, Transcribe, Translate, Hardsub, Models, Settings, Modals, Toasts).
 */

import { t, isRtlLanguage, getLanguage } from '../i18n/index';
import { copyToClipboard, openFileInEditor, showInFolder, getBasename } from './nativeWindow';
import { copyAllLogs, clearLogsHistory } from './logsController';
import { copyLiveTranscriptToClipboard } from './transcriptViewer';
import { getCurrentSourceMediaFile } from './appNavigation';
import { getSelectedMediaFile } from './transcribePipeline';

export type ContextMenuIconName =
  | 'copy'
  | 'clipboardList'
  | 'selectAll'
  | 'folder'
  | 'play'
  | 'clock'
  | 'trash'
  | 'terminal'
  | 'fileText'
  | 'palette'
  | 'info';

export interface ContextMenuItemSpec {
  id: string;
  label: string;
  icon: ContextMenuIconName;
  danger?: boolean;
  disabled?: boolean;
  shortcutHint?: string;
  onSelect: () => void | Promise<void>;
}

export type ContextMenuEntry =
  | { type: 'item'; spec: ContextMenuItemSpec }
  | { type: 'separator' };

const MENU_ID = 'app-context-menu';
const VIEWPORT_PADDING = 8;

const BIDI_MARKS_RE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'file',
  'button',
  'submit',
  'reset',
  'hidden',
  'image'
]);

const ICON_INNER_PATHS: Record<ContextMenuIconName, string> = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  clipboardList: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  selectAll: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1"/><path d="M9 21h1"/><path d="M14 3h1"/><path d="M14 21h1"/><path d="M3 9v1"/><path d="M21 9v1"/><path d="M3 14v1"/><path d="M21 14v1"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
};

let _menuEl: HTMLDivElement | null = null;
let _isInitialized = false;
let _previousFocusEl: HTMLElement | null = null;
let _openedByKeyboard = false;

export function stripBidiMarks(text: string | null | undefined): string {
  return String(text ?? '').replace(BIDI_MARKS_RE, '').trim();
}

export function isNativeEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable || el.closest('[contenteditable="true"]')) {
    return true;
  }
  const textarea = el.closest('textarea');
  if (textarea) return true;

  const input = el.closest('input') as HTMLInputElement | null;
  if (!input) return false;
  const inputType = String(input.type || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(inputType);
}

export function isPreservedCustomContextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  return Boolean((target as HTMLElement).closest('#btn-companion-speed, #hardsub-btn-speed'));
}

export function isElementSelectable(el: HTMLElement | null): boolean {
  if (!el || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return false;
  try {
    const style = window.getComputedStyle(el);
    const val = style.userSelect || (style as any).webkitUserSelect || '';
    return val === 'text' || val === 'all';
  } catch {
    return false;
  }
}

export function getActiveSelectionTextForTarget(target: HTMLElement | null): string {
  if (!target || typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return '';
  }
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
    const text = sel.toString();
    if (!text || !text.trim()) return '';

    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const ancestorEl = (ancestor.nodeType === 1 ? ancestor : ancestor.parentElement) as HTMLElement | null;
    if (!ancestorEl) return '';

    const matchesTarget =
      ancestorEl === target ||
      (typeof ancestorEl.contains === 'function' && ancestorEl.contains(target)) ||
      (typeof target.contains === 'function' && target.contains(ancestorEl)) ||
      (typeof range.intersectsNode === 'function' && range.intersectsNode(target));

    if (!matchesTarget) return '';
    return text;
  } catch {
    return '';
  }
}

export function selectAllTextInElement(container: HTMLElement | null): boolean {
  if (!container || typeof document === 'undefined' || typeof window === 'undefined') return false;
  if (typeof document.createRange !== 'function' || typeof window.getSelection !== 'function') return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(container);
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  try {
    const globalCopy = typeof window !== 'undefined' ? (window as any).copyToClipboard : null;
    if (typeof globalCopy === 'function') {
      await globalCopy(text);
    } else {
      await copyToClipboard(text);
    }
  } catch (err) {
    console.warn('[ContextMenu] Clipboard write failed:', err);
  }
}

function formatLogLineText(logLine: HTMLElement): string {
  const timestamp = logLine.dataset?.timestamp || '';
  const category = logLine.dataset?.category || '';
  const msgEl = typeof logLine.querySelector === 'function' ? logLine.querySelector('.log-msg') : null;
  const msg = msgEl?.textContent ?? logLine.textContent ?? '';
  if (timestamp || category) {
    return `[${timestamp}] [${category}] ${msg}`.trim();
  }
  return String(msg).trim();
}

function normalizeMenuEntries(entries: ContextMenuEntry[]): ContextMenuEntry[] {
  const result: ContextMenuEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'separator') {
      if (result.length === 0 || result[result.length - 1].type === 'separator') continue;
      result.push(entry);
    } else {
      result.push(entry);
    }
  }
  while (result.length > 0 && result[result.length - 1].type === 'separator') {
    result.pop();
  }
  return result;
}

function getCopyShortcutHint(): string {
  if (typeof navigator !== 'undefined') {
    const platform = `${(navigator as any).userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`;
    if (/\b(Mac|Macintosh|MacIntel|iPhone|iPad|iPod)\b/i.test(platform)) {
      return '⌘C';
    }
  }
  return 'Ctrl+C';
}

function addSelectionCopyEntry(entries: ContextMenuEntry[], selectedText: string, shortcutHint = getCopyShortcutHint()): void {
  if (!selectedText) return;
  entries.push({
    type: 'item',
    spec: {
      id: 'copy-selection',
      label: t('common.copy'),
      icon: 'copy',
      shortcutHint,
      onSelect: () => copyText(selectedText)
    }
  });
}

function buildLogsEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  const viewport = target.closest('#log-viewport') as HTMLElement | null;
  if (!viewport) return null;

  const hasLogs = Boolean(viewport.querySelector('.log-line'));
  const entries: ContextMenuEntry[] = [];
  addSelectionCopyEntry(entries, selectedText);

  if (!selectedText) {
    const logLine = target.closest('.log-line') as HTMLElement | null;
    if (logLine) {
      const lineText = formatLogLineText(logLine);
      if (lineText) {
        entries.push({
          type: 'item',
          spec: {
            id: 'logs-copy-line',
            label: t('contextMenu.copyLine'),
            icon: 'copy',
            onSelect: () => copyText(lineText)
          }
        });
      }
    }
  }

  if (hasLogs) {
    entries.push({
      type: 'item',
      spec: {
        id: 'logs-select-all',
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(viewport);
        }
      }
    });
    entries.push({ type: 'separator' });
    entries.push({
      type: 'item',
      spec: {
        id: 'logs-copy-all',
        label: t('contextMenu.copyAllLogs'),
        icon: 'clipboardList',
        onSelect: () => copyAllLogs()
      }
    });
    entries.push({
      type: 'item',
      spec: {
        id: 'logs-clear-all',
        label: t('contextMenu.clearLogs'),
        icon: 'trash',
        danger: true,
        onSelect: () => clearLogsHistory()
      }
    });
  }

  return normalizeMenuEntries(entries);
}

function buildFilePathEntries(
  path: string,
  name: string,
  selectedText: string,
  openFolderLabel: string,
  openAction: () => void | Promise<void>,
  options?: { isDirectory?: boolean }
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];
  addSelectionCopyEntry(entries, selectedText);

  const isDirectory = Boolean(options?.isDirectory);
  const cleanPath = stripBidiMarks(path);
  const cleanName = isDirectory ? '' : (stripBidiMarks(name) || (cleanPath ? getBasename(cleanPath) : ''));

  if (cleanPath) {
    entries.push({
      type: 'item',
      spec: {
        id: 'file-copy-path',
        label: t('contextMenu.copyPath'),
        icon: 'copy',
        onSelect: () => copyText(cleanPath)
      }
    });
  }
  if (!isDirectory && cleanName && cleanName !== cleanPath) {
    entries.push({
      type: 'item',
      spec: {
        id: 'file-copy-name',
        label: t('contextMenu.copyFileName'),
        icon: 'fileText',
        onSelect: () => copyText(cleanName)
      }
    });
  }
  if (cleanPath) {
    entries.push({ type: 'separator' });
    entries.push({
      type: 'item',
      spec: {
        id: 'file-open-folder',
        label: openFolderLabel,
        icon: 'folder',
        onSelect: openAction
      }
    });
  }

  return normalizeMenuEntries(entries);
}

interface DropzoneFileSpec {
  selector: string;
  pathLabelId: string;
  nameLabelId: string;
  excludeClass?: string;
}

const DROPZONE_FILE_SPECS: DropzoneFileSpec[] = [
  {
    selector: '#transcribe-drop-zone',
    pathLabelId: 'lbl-file-path',
    nameLabelId: 'lbl-file-name',
    excludeClass: 'is-batch-summary'
  },
  {
    selector: '#translate-drop-zone',
    pathLabelId: 'lbl-translate-sub-path',
    nameLabelId: 'lbl-translate-sub-name'
  },
  {
    selector: '#hardsub-video-drop-zone',
    pathLabelId: 'lbl-hardsub-video-path',
    nameLabelId: 'lbl-hardsub-video-name'
  },
  {
    selector: '#hardsub-sub-drop-zone',
    pathLabelId: 'lbl-hardsub-sub-path',
    nameLabelId: 'lbl-hardsub-sub-name'
  }
];

function buildFilesAndPathsEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  // 1. Batch Queue Cards
  const batchCard = target.closest('.batch-queue-card') as HTMLElement | null;
  if (batchCard) {
    const path = batchCard.dataset?.path || stripBidiMarks(batchCard.querySelector('.batch-card-name')?.getAttribute('title'));
    const name = batchCard.dataset?.name || stripBidiMarks(batchCard.querySelector('.batch-card-name')?.textContent);
    if (path || name) {
      return buildFilePathEntries(
        path,
        name,
        selectedText,
        t('contextMenu.openContainingFolder'),
        () => showInFolder(path)
      );
    }
  }

  // 2. Single-File & Studio Dropzones
  for (const spec of DROPZONE_FILE_SPECS) {
    const zone = target.closest(spec.selector) as HTMLElement | null;
    if (!zone || !zone.classList.contains('has-file')) continue;
    if (spec.excludeClass && zone.classList.contains(spec.excludeClass)) continue;

    const lblPath = document.getElementById(spec.pathLabelId)?.textContent;
    const lblName = document.getElementById(spec.nameLabelId)?.textContent;
    const fallbackMedia = spec.selector === '#transcribe-drop-zone' ? getSelectedMediaFile() : '';
    const filePath = zone.dataset?.filePath || fallbackMedia || stripBidiMarks(lblPath);
    if (filePath) {
      return buildFilePathEntries(
        filePath,
        stripBidiMarks(lblName) || getBasename(filePath),
        selectedText,
        t('contextMenu.openContainingFolder'),
        () => showInFolder(filePath)
      );
    }
  }

  // 3. Custom Output Directory Readouts
  const outputDisplay = target.closest('#transcribe-output-dir-text, #translate-output-dir-text, #hardsub-output-dir-text') as HTMLElement | null;
  if (outputDisplay && outputDisplay.classList.contains('has-custom-path')) {
    const dirPath = stripBidiMarks(outputDisplay.textContent);
    if (dirPath) {
      return buildFilePathEntries(
        dirPath,
        '',
        selectedText,
        t('contextMenu.openOutputFolder'),
        () => openFileInEditor(dirPath),
        { isDirectory: true }
      );
    }
  }

  // 4. Companion Media Filename & Timecode
  const companionName = target.closest('#companion-meta-filename') as HTMLElement | null;
  if (companionName) {
    const rawName = stripBidiMarks(companionName.textContent);
    const name = rawName && rawName !== '—' ? rawName : '';
    const fullPath = stripBidiMarks(getCurrentSourceMediaFile());
    if (name || fullPath) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      if (name) {
        entries.push({
          type: 'item',
          spec: {
            id: 'companion-copy-name',
            label: t('contextMenu.copyFileName'),
            icon: 'fileText',
            onSelect: () => copyText(name)
          }
        });
      }
      if (fullPath) {
        entries.push({
          type: 'item',
          spec: {
            id: 'companion-copy-path',
            label: t('contextMenu.copyPath'),
            icon: 'copy',
            onSelect: () => copyText(fullPath)
          }
        });
        entries.push({ type: 'separator' });
        entries.push({
          type: 'item',
          spec: {
            id: 'companion-open-folder',
            label: t('contextMenu.openContainingFolder'),
            icon: 'folder',
            onSelect: () => showInFolder(fullPath)
          }
        });
      }
      return normalizeMenuEntries(entries);
    }
  }

  const companionTime = target.closest('.companion-timecode') as HTMLElement | null;
  if (companionTime) {
    const tc = stripBidiMarks(companionTime.textContent);
    if (tc) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'companion-copy-timecode',
          label: t('contextMenu.copyTimecode'),
          icon: 'clock',
          onSelect: () => copyText(tc)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  return null;
}

function buildTranscriptEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  const card = target.closest('.transcript-card') as HTMLElement | null;
  const viewport = target.closest('#transcript-viewport') as HTMLElement | null;
  if (!card && !viewport) return null;

  const entries: ContextMenuEntry[] = [];
  addSelectionCopyEntry(entries, selectedText);

  if (card) {
    const confView = card.querySelector('.transcript-confidence-view') as HTMLElement | null;
    if (confView && confView.contains(target)) {
      entries.push({
        type: 'item',
        spec: {
          id: 'transcript-select-segment',
          label: t('contextMenu.selectAll'),
          icon: 'selectAll',
          onSelect: () => {
            selectAllTextInElement(confView);
          }
        }
      });
    }

    const textarea = card.querySelector('.transcript-text-input') as HTMLTextAreaElement | null;
    const segmentText = (textarea?.value ?? confView?.textContent ?? '').trim();
    if (segmentText) {
      entries.push({
        type: 'item',
        spec: {
          id: 'transcript-copy-segment',
          label: t('contextMenu.copySegment'),
          icon: 'copy',
          onSelect: () => copyText(segmentText)
        }
      });
    }

    const timeEl = card.querySelector('.transcript-card-time span') as HTMLElement | null;
    const timeText = stripBidiMarks(timeEl?.textContent);
    if (timeText) {
      entries.push({
        type: 'item',
        spec: {
          id: 'transcript-copy-timestamp',
          label: t('contextMenu.copyTimestamp'),
          icon: 'clock',
          onSelect: () => copyText(timeText)
        }
      });
    }

    const playBtn = card.querySelector('.btn-card-play') as HTMLButtonElement | null;
    if (playBtn && !playBtn.disabled) {
      entries.push({
        type: 'item',
        spec: {
          id: 'transcript-play-segment',
          label: t('transcribe.playSegment'),
          icon: 'play',
          onSelect: () => {
            playBtn.click();
          }
        }
      });
    }
  }

  const copyAllBtn = document.getElementById('btn-copy-transcript') as HTMLButtonElement | null;
  const hasLines = Boolean(document.querySelector('#transcript-viewport .transcript-card'));
  if (hasLines && copyAllBtn && !copyAllBtn.disabled) {
    entries.push({ type: 'separator' });
    entries.push({
      type: 'item',
      spec: {
        id: 'transcript-copy-all',
        label: t('transcribe.copyTranscript'),
        icon: 'clipboardList',
        onSelect: () => copyLiveTranscriptToClipboard()
      }
    });
  }

  return normalizeMenuEntries(entries);
}

function buildTranslateCueEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  const cueItem = target.closest('.translate-cue-item') as HTMLElement | null;
  if (!cueItem) return null;

  const entries: ContextMenuEntry[] = [];
  addSelectionCopyEntry(entries, selectedText);

  const textEl = cueItem.querySelector('.translate-cue-text') as HTMLElement | null;
  const cueText = (textEl?.textContent ?? '').trim();
  if (cueText) {
    entries.push({
      type: 'item',
      spec: {
        id: 'translate-copy-cue',
        label: t('contextMenu.copySubtitle'),
        icon: 'copy',
        onSelect: () => copyText(cueText)
      }
    });
  }

  const timeEl = cueItem.querySelector('.translate-cue-time') as HTMLElement | null;
  const timeText = stripBidiMarks(timeEl?.textContent);
  if (timeText) {
    entries.push({
      type: 'item',
      spec: {
        id: 'translate-copy-timestamp',
        label: t('contextMenu.copyTimestamp'),
        icon: 'clock',
        onSelect: () => copyText(timeText)
      }
    });
  }

  const copyAllBtn = document.getElementById('btn-copy-translated') as HTMLButtonElement | null;
  if (copyAllBtn && !copyAllBtn.disabled) {
    entries.push({ type: 'separator' });
    entries.push({
      type: 'item',
      spec: {
        id: 'translate-copy-all',
        label: t('translate.copyTranslation'),
        icon: 'clipboardList',
        onSelect: () => {
          copyAllBtn.click();
        }
      }
    });
  }

  return normalizeMenuEntries(entries);
}

function buildHardsubEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  // 1. FFmpeg command preview
  const ffmpegPreview = target.closest('#hardsub-ffmpeg-cmd-preview') as HTMLElement | null;
  if (ffmpegPreview) {
    const cmdText = stripBidiMarks(ffmpegPreview.textContent);
    if (!cmdText) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    entries.push({
      type: 'item',
      spec: {
        id: 'hardsub-select-ffmpeg',
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(ffmpegPreview);
        }
      }
    });
    entries.push({
      type: 'item',
      spec: {
        id: 'hardsub-copy-ffmpeg',
        label: t('contextMenu.copyCommand'),
        icon: 'terminal',
        onSelect: () => copyText(cmdText)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 2. Hardsub preview error detail
  const previewDetail = target.closest('#hardsub-preview-detail') as HTMLElement | null;
  if (previewDetail) {
    const msg = stripBidiMarks(previewDetail.textContent);
    if (!msg) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    entries.push({
      type: 'item',
      spec: {
        id: 'hardsub-select-detail',
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(previewDetail);
        }
      }
    });
    entries.push({
      type: 'item',
      spec: {
        id: 'hardsub-copy-detail',
        label: t('contextMenu.copyMessage'),
        icon: 'copy',
        onSelect: () => copyText(msg)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 3. Color Hex Readouts
  const hexEl = target.closest('#hardsub-hex-text, #hardsub-hex-bg') as HTMLElement | null;
  if (hexEl) {
    const hex = stripBidiMarks(hexEl.textContent);
    if (!hex) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    entries.push({
      type: 'item',
      spec: {
        id: 'hardsub-copy-hex',
        label: t('contextMenu.copyColorCode'),
        icon: 'palette',
        onSelect: () => copyText(hex)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 4. Hardsub Video Timecodes
  const hardsubTime = target.closest('#hardsub-time-current, #hardsub-time-total, .hardsub-timecode') as HTMLElement | null;
  if (hardsubTime) {
    const tc = stripBidiMarks(hardsubTime.textContent);
    if (tc) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'hardsub-copy-timecode',
          label: t('contextMenu.copyTimecode'),
          icon: 'clock',
          onSelect: () => copyText(tc)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  // 5. Hardsub Subtitle Cue Card (outside textarea which uses native menu)
  const cueCard = target.closest('.subtitle-cue-card') as HTMLElement | null;
  if (cueCard) {
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);

    const cueTextarea = cueCard.querySelector('textarea.subtitle-cue-textarea') as HTMLTextAreaElement | null;
    const cueText = (cueTextarea?.value ?? '').trim();
    if (cueText) {
      entries.push({
        type: 'item',
        spec: {
          id: 'hardsub-copy-cue-text',
          label: t('contextMenu.copySubtitle'),
          icon: 'copy',
          onSelect: () => copyText(cueText)
        }
      });
    }

    const cueTime = stripBidiMarks(cueCard.querySelector('.subtitle-cue-time')?.textContent);
    if (cueTime) {
      entries.push({
        type: 'item',
        spec: {
          id: 'hardsub-copy-cue-time',
          label: t('contextMenu.copyTimestamp'),
          icon: 'clock',
          onSelect: () => copyText(cueTime)
        }
      });
    }

    const jumpBtn = cueCard.querySelector('.jump-cue-btn') as HTMLButtonElement | null;
    if (jumpBtn && !jumpBtn.disabled) {
      entries.push({
        type: 'item',
        spec: {
          id: 'hardsub-play-cue',
          label: t('hardsub.cuePlay'),
          icon: 'play',
          onSelect: () => {
            jumpBtn.click();
          }
        }
      });
    }

    return normalizeMenuEntries(entries);
  }

  return null;
}

function buildSettingsAndModelsEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  // 1. Translation Test Result Modal Box
  const testResultEl = target.closest('#test-modal-result') as HTMLElement | null;
  if (testResultEl) {
    const fullText = (testResultEl.textContent ?? '').trim();
    if (!fullText) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    entries.push({
      type: 'item',
      spec: {
        id: 'test-result-select-all',
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(testResultEl);
        }
      }
    });
    entries.push({
      type: 'item',
      spec: {
        id: 'test-result-copy-all',
        label: t('contextMenu.copyMessage'),
        icon: 'copy',
        onSelect: () => copyText(fullText)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 2. AI Translation Models Table ID / Active Model Chip
  const modelIdEl = target.closest('.model-id-display, .active-model-chip-model') as HTMLElement | null;
  if (modelIdEl) {
    const modelId = stripBidiMarks(modelIdEl.textContent);
    if (modelId) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'model-copy-id',
          label: t('contextMenu.copyModelId'),
          icon: 'copy',
          onSelect: () => copyText(modelId)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  const modelMetaEl = target.closest('.model-ctx-value, .active-model-chip-provider') as HTMLElement | null;
  if (modelMetaEl) {
    const val = stripBidiMarks(modelMetaEl.textContent);
    if (val) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'model-meta-copy',
          label: t('common.copy'),
          icon: 'copy',
          onSelect: () => copyText(val)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  // 3. Inline <code> snippets in settings descriptions
  const codeEl = target.closest('.setting-desc code, .setting-desc-point code, .setting-desc-points code') as HTMLElement | null;
  if (codeEl) {
    const codeText = stripBidiMarks(codeEl.textContent);
    if (codeText) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'settings-copy-code',
          label: t('common.copy'),
          icon: 'copy',
          onSelect: () => copyText(codeText)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  // 4. Model Hub Filename & Hardware Specs
  const modelTitleEl = target.closest('.setting-card[data-model] .setting-title') as HTMLElement | null;
  if (modelTitleEl) {
    const fileName = stripBidiMarks(modelTitleEl.textContent);
    if (fileName) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'modelhub-copy-filename',
          label: t('contextMenu.copyFileName'),
          icon: 'copy',
          onSelect: () => copyText(fileName)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  const specsSubtitle = target.closest('#model-specs-subtitle') as HTMLElement | null;
  if (specsSubtitle) {
    const specs = stripBidiMarks(specsSubtitle.textContent);
    if (specs) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'modelhub-copy-specs',
          label: t('common.copy'),
          icon: 'copy',
          onSelect: () => copyText(specs)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  return null;
}

function buildModalAndToastEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  // 1. Error/Details Modal Box & Modal Messages
  const modalBox = target.closest('#app-modal-details, #app-modal-message, #batch-error-message') as HTMLElement | null;
  if (modalBox) {
    const text = (modalBox.textContent ?? '').trim();
    if (!text) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    entries.push({
      type: 'item',
      spec: {
        id: 'modal-select-all',
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(modalBox);
        }
      }
    });
    entries.push({
      type: 'item',
      spec: {
        id: 'modal-copy-message',
        label: t('contextMenu.copyMessage'),
        icon: 'copy',
        onSelect: () => copyText(text)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 2. Toast Notifications (capturing text immediately before any auto-dismiss)
  const toastEl = target.closest('.toast-notification') as HTMLElement | null;
  if (toastEl) {
    if (target.closest('button')) return null;
    const techEl = toastEl.querySelector('.toast-tech-detail') as HTMLElement | null;
    const msgEl = toastEl.querySelector('.toast-message') as HTMLElement | null;
    const copySource =
      techEl && techEl.contains(target)
        ? (techEl.textContent ?? '').trim()
        : ((msgEl?.textContent ?? '').trim() || (techEl?.textContent ?? '').trim());
    if (!copySource) return null;
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    if (techEl && techEl.contains(target)) {
      entries.push({
        type: 'item',
        spec: {
          id: 'toast-select-all',
          label: t('contextMenu.selectAll'),
          icon: 'selectAll',
          onSelect: () => {
            selectAllTextInElement(techEl);
          }
        }
      });
    }
    entries.push({
      type: 'item',
      spec: {
        id: 'toast-copy-message',
        label: t('contextMenu.copyMessage'),
        icon: 'copy',
        onSelect: () => copyText(copySource)
      }
    });
    return normalizeMenuEntries(entries);
  }

  // 3. About Modal Version & Diagnostic Info
  const aboutEl = target.closest(
    '.about-version-chip, #about-modal-version-text, .about-engine-version-chip, #about-whisper-version-text, .about-spec-value, #about-update-subtext'
  ) as HTMLElement | null;
  if (aboutEl) {
    const val = stripBidiMarks(aboutEl.textContent);
    if (val) {
      const entries: ContextMenuEntry[] = [];
      addSelectionCopyEntry(entries, selectedText);
      entries.push({
        type: 'item',
        spec: {
          id: 'about-copy-info',
          label: t('contextMenu.copyVersionInfo'),
          icon: 'info',
          onSelect: () => copyText(val)
        }
      });
      return normalizeMenuEntries(entries);
    }
  }

  return null;
}

export function resolveContextMenuEntries(target: HTMLElement | null): ContextMenuEntry[] {
  if (!target) return [];
  const selectedText = getActiveSelectionTextForTarget(target);

  const resolvers = [
    buildLogsEntries,
    buildFilesAndPathsEntries,
    buildTranscriptEntries,
    buildTranslateCueEntries,
    buildHardsubEntries,
    buildSettingsAndModelsEntries,
    buildModalAndToastEntries
  ];

  for (const resolver of resolvers) {
    const entries = resolver(target, selectedText);
    if (entries && entries.length > 0) {
      return entries;
    }
  }

  // Generic fallback: if the user selected text in any selectable surface, always offer Copy!
  if (selectedText) {
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    return entries;
  }

  return [];
}

function createIconSvg(name: ContextMenuIconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('app-context-menu__icon');
  svg.innerHTML = ICON_INNER_PATHS[name] || ICON_INNER_PATHS.copy;
  return svg;
}

function ensureMenuElement(): HTMLDivElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (_menuEl && _menuEl.parentNode === document.body) {
    return _menuEl;
  }

  const existing = document.getElementById(MENU_ID) as HTMLDivElement | null;
  if (existing) {
    _menuEl = existing;
    return _menuEl;
  }

  const menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.className = 'app-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-hidden', 'true');
  menu.tabIndex = -1;

  // Prevent mousedown inside the menu from clearing text selection or dismissing immediately
  menu.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
  });
  menu.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
  });

  document.body.appendChild(menu);
  _menuEl = menu;
  return menu;
}

export function isContextMenuOpen(): boolean {
  return Boolean(_menuEl && _menuEl.classList.contains('open'));
}

export function closeContextMenu(options?: { restoreFocus?: boolean }): void {
  if (!_menuEl) return;
  const wasOpen = _menuEl.classList.contains('open');
  _menuEl.classList.remove('open');
  _menuEl.setAttribute('aria-hidden', 'true');

  if (wasOpen && options?.restoreFocus && _openedByKeyboard && _previousFocusEl) {
    try {
      _previousFocusEl.focus?.({ preventScroll: true });
    } catch {
      // Ignore focus errors on detached elements
    }
  }
  _previousFocusEl = null;
  _openedByKeyboard = false;
}

function getCssZoomFactor(): number {
  if (typeof document === 'undefined' || !document.documentElement?.style) return 1;
  const parsed = parseFloat(document.documentElement.style.zoom || '1');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function positionMenu(menu: HTMLDivElement, clientX: number, clientY: number): void {
  const cssZoom = getCssZoomFactor();
  const vw = (typeof window !== 'undefined' ? window.innerWidth : 1280) / cssZoom;
  const vh = (typeof window !== 'undefined' ? window.innerHeight : 720) / cssZoom;
  const anchorX = clientX / cssZoom;
  const anchorY = clientY / cssZoom;

  menu.style.left = '0px';
  menu.style.top = '0px';

  const rect = typeof menu.getBoundingClientRect === 'function'
    ? menu.getBoundingClientRect()
    : { width: 210, height: 140 };
  const width = (menu.offsetWidth && menu.offsetWidth > 0)
    ? menu.offsetWidth
    : ((rect.width ? rect.width / cssZoom : 0) || 210);
  const height = (menu.offsetHeight && menu.offsetHeight > 0)
    ? menu.offsetHeight
    : ((rect.height ? rect.height / cssZoom : 0) || 140);

  const isRtl =
    (typeof document !== 'undefined' && document.documentElement?.getAttribute('dir') === 'rtl') ||
    isRtlLanguage(getLanguage());

  let x = isRtl ? anchorX - width : anchorX;
  let y = anchorY;
  let originX: 'left' | 'right' = isRtl ? 'right' : 'left';
  let originY: 'top' | 'bottom' = 'top';

  if (x + width > vw - VIEWPORT_PADDING) {
    x = Math.max(VIEWPORT_PADDING, anchorX - width);
    originX = 'right';
  }
  if (x < VIEWPORT_PADDING) {
    x = Math.min(vw - width - VIEWPORT_PADDING, Math.max(VIEWPORT_PADDING, anchorX));
    originX = 'left';
  }
  if (y + height > vh - VIEWPORT_PADDING) {
    y = Math.max(VIEWPORT_PADDING, anchorY - height);
    originY = 'bottom';
  }

  x = Math.max(VIEWPORT_PADDING, Math.min(x, Math.max(VIEWPORT_PADDING, vw - width - VIEWPORT_PADDING)));
  y = Math.max(VIEWPORT_PADDING, Math.min(y, Math.max(VIEWPORT_PADDING, vh - height - VIEWPORT_PADDING)));

  menu.style.transformOrigin = `${originY} ${originX}`;
  menu.style.left = `${Math.round(x)}px`;
  menu.style.top = `${Math.round(y)}px`;
}

export function openContextMenuAt(
  clientX: number,
  clientY: number,
  entries: ContextMenuEntry[],
  openedByKeyboard = false
): boolean {
  const normalized = normalizeMenuEntries(entries);
  if (normalized.length === 0) {
    closeContextMenu();
    return false;
  }

  const menu = ensureMenuElement();
  if (!menu) return false;

  _previousFocusEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  _openedByKeyboard = openedByKeyboard;

  menu.replaceChildren();
  menu.setAttribute('aria-label', t('contextMenu.menuAria'));

  for (const entry of normalized) {
    if (entry.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'app-context-menu__separator';
      sep.setAttribute('role', 'separator');
      menu.appendChild(sep);
      continue;
    }

    const { spec } = entry;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = spec.danger ? 'app-context-menu__item app-context-menu__item--danger' : 'app-context-menu__item';
    btn.dataset.menuId = spec.id;
    btn.setAttribute('role', 'menuitem');
    if (spec.disabled) {
      btn.disabled = true;
    }

    btn.appendChild(createIconSvg(spec.icon));

    const labelSpan = document.createElement('span');
    labelSpan.className = 'app-context-menu__label';
    labelSpan.textContent = spec.label;
    btn.appendChild(labelSpan);

    if (spec.shortcutHint) {
      const hintSpan = document.createElement('span');
      hintSpan.className = 'app-context-menu__hint';
      hintSpan.textContent = spec.shortcutHint;
      btn.appendChild(hintSpan);
    }

    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeContextMenu();
      void spec.onSelect();
    });

    menu.appendChild(btn);
  }

  positionMenu(menu, clientX, clientY);
  menu.classList.add('open');
  menu.setAttribute('aria-hidden', 'false');

  if (openedByKeyboard) {
    const firstBtn = menu.querySelector('.app-context-menu__item:not(:disabled)') as HTMLButtonElement | null;
    firstBtn?.focus?.({ preventScroll: true });
  }

  return true;
}

function moveMenuFocus(direction: 1 | -1 | 'first' | 'last'): void {
  if (!_menuEl) return;
  const items = Array.from(
    _menuEl.querySelectorAll('.app-context-menu__item:not(:disabled)')
  ) as HTMLButtonElement[];
  if (items.length === 0) return;

  if (direction === 'first') {
    items[0].focus({ preventScroll: true });
    return;
  }
  if (direction === 'last') {
    items[items.length - 1].focus({ preventScroll: true });
    return;
  }

  const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIdx =
    activeIdx === -1
      ? direction === 1 ? 0 : items.length - 1
      : (activeIdx + direction + items.length) % items.length;
  items[nextIdx].focus({ preventScroll: true });
}

export function handleGlobalContextMenu(e: MouseEvent): void {
  if (e.defaultPrevented) return;
  const target = e.target as HTMLElement | null;

  // Preserve specialized speed controls that bind their own right-click action
  if (isPreservedCustomContextTarget(target)) {
    closeContextMenu();
    return;
  }

  // Allow native OS Cut/Copy/Paste/Undo menu inside text inputs & textareas
  if (isNativeEditableTarget(target)) {
    closeContextMenu();
    return;
  }

  // Always suppress the raw browser context menu outside editable inputs
  e.preventDefault();

  const entries = resolveContextMenuEntries(target);
  if (entries.length === 0) {
    closeContextMenu();
    return;
  }

  openContextMenuAt(e.clientX, e.clientY, entries, false);
}

export function handleContextMenuShortcut(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const isContextKey = e.key === 'ContextMenu';
  const isShiftF10 = e.shiftKey && e.key === 'F10' && !e.ctrlKey && !e.metaKey && !e.altKey;
  if (!isContextKey && !isShiftF10) return;

  const activeFallback = typeof document !== 'undefined' ? document.activeElement : null;
  const target = (
    e.target && typeof (e.target as HTMLElement).closest === 'function'
      ? e.target
      : activeFallback
  ) as HTMLElement | null;

  if (!target || isPreservedCustomContextTarget(target) || isNativeEditableTarget(target)) {
    return;
  }

  const entries = resolveContextMenuEntries(target);
  if (entries.length === 0) return;

  e.preventDefault();
  e.stopPropagation();

  const isRtl =
    (typeof document !== 'undefined' && document.documentElement?.getAttribute('dir') === 'rtl') ||
    isRtlLanguage(getLanguage());

  let anchorX = 16;
  let anchorY = 16;
  if (typeof target.getBoundingClientRect === 'function') {
    const rect = target.getBoundingClientRect() as DOMRect;
    if (rect && (rect.width > 0 || rect.height > 0)) {
      anchorX = isRtl ? Math.max(8, (rect.right ?? rect.left) - 8) : rect.left + 8;
      anchorY = Math.max(8, (rect.bottom ?? rect.top) - 4);
    }
  }

  openContextMenuAt(anchorX, anchorY, entries, true);
}

export function setupContextMenu(): void {
  if (_isInitialized || typeof document === 'undefined') return;
  _isInitialized = true;

  document.addEventListener('contextmenu', handleGlobalContextMenu);

  document.addEventListener('pointerdown', (e: Event) => {
    if (!isContextMenuOpen()) return;
    const target = e.target as Node | null;
    if (_menuEl && target && _menuEl.contains(target)) return;
    closeContextMenu();
  }, true);

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isContextMenuOpen()) {
      handleContextMenuShortcut(e);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeContextMenu({ restoreFocus: true });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      moveMenuFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      moveMenuFocus(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      moveMenuFocus('first');
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      moveMenuFocus('last');
      return;
    }
    if (e.key === 'Tab') {
      if (_openedByKeyboard) {
        e.preventDefault();
      }
      closeContextMenu({ restoreFocus: _openedByKeyboard });
    }
  }, true);

  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => closeContextMenu());
    window.addEventListener('resize', () => closeContextMenu());
    window.addEventListener('whisper:languageChanged', () => closeContextMenu());
  }

  document.addEventListener('scroll', (e: Event) => {
    if (!isContextMenuOpen()) return;
    if (_menuEl && (e.target === _menuEl || (_menuEl.contains && _menuEl.contains(e.target as Node)))) {
      return;
    }
    closeContextMenu();
  }, { capture: true, passive: true });
}

export function _resetContextMenuForTest(): void {
  _menuEl?.remove?.();
  _menuEl = null;
  _isInitialized = false;
  _previousFocusEl = null;
  _openedByKeyboard = false;
}
