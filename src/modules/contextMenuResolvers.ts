/**
 * Context Menu Entry Resolvers & Text Selection Utilities
 *
 * Pure DOM-inspection helpers and section-specific menu builders for the
 * in-app context menu controller.
 */

import { t } from '../i18n/index';
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

/** Remove directional isolation/formatting marks from copied UI text. */
export function stripBidiMarks(text: string | null | undefined): string {
  return String(text ?? '').replace(BIDI_MARKS_RE, '').trim();
}

/** Return true when the target should keep the native OS editing context menu. */
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

/** Return true for speed-cycler buttons that bind custom right-click handlers. */
export function isPreservedCustomContextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== 'function') return false;
  return Boolean((target as HTMLElement).closest('#btn-companion-speed, #hardsub-btn-speed'));
}

/** Extract non-empty selected text only when the current selection relates to `target`. */
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

/** Resolve the ancestor element and bounding rect for the active non-collapsed selection. */
export function getActiveSelectionContext(): { target: HTMLElement | null; selectionRect: DOMRect | null } {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return { target: null, selectionRect: null };
  }
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { target: null, selectionRect: null };
    }
    const text = sel.toString();
    if (!text || !text.trim()) {
      return { target: null, selectionRect: null };
    }
    const range = sel.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const ancestorEl = (ancestor.nodeType === 1 ? ancestor : ancestor.parentElement) as HTMLElement | null;
    if (ancestorEl && typeof ancestorEl.closest === 'function') {
      const rect = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
      const hasRect = Boolean(rect && (rect.width > 0 || rect.height > 0));
      return { target: ancestorEl, selectionRect: hasRect ? rect : null };
    }
  } catch {
    // Ignore selection lookup errors
  }
  return { target: null, selectionRect: null };
}

/** Select all text contents inside a read-only container element. */
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
  const msg = String(msgEl?.textContent ?? logLine.textContent ?? '').trim();
  const prefixParts: string[] = [];
  if (timestamp) prefixParts.push(`[${timestamp}]`);
  if (category) prefixParts.push(`[${category}]`);
  return prefixParts.length > 0 ? `${prefixParts.join(' ')} ${msg}`.trim() : msg;
}

/** Deduplicate adjacent separators and trim leading/trailing separators. */
export function normalizeMenuEntries(entries: ContextMenuEntry[]): ContextMenuEntry[] {
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

function buildSingleCopyEntries(
  text: string,
  selectedText: string,
  id: string,
  label: string,
  icon: ContextMenuIconName,
  options?: { selectAllTarget?: HTMLElement; selectAllId?: string }
): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];
  addSelectionCopyEntry(entries, selectedText);
  if (options?.selectAllTarget && options.selectAllId) {
    const targetEl = options.selectAllTarget;
    entries.push({
      type: 'item',
      spec: {
        id: options.selectAllId,
        label: t('contextMenu.selectAll'),
        icon: 'selectAll',
        onSelect: () => {
          selectAllTextInElement(targetEl);
        }
      }
    });
  }
  entries.push({
    type: 'item',
    spec: {
      id,
      label,
      icon,
      onSelect: () => copyText(text)
    }
  });
  return normalizeMenuEntries(entries);
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

function buildFilesAndPathsEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  // 1. Batch Queue Cards (skip card action buttons like move up/down/remove)
  const batchCard = target.closest('.batch-queue-card') as HTMLElement | null;
  if (batchCard) {
    if (target.closest('button')) return null;
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

  // 2. Single-File & Studio Dropzones (skip Browse/Clear buttons inside dropzones)
  for (const spec of DROPZONE_FILE_SPECS) {
    const zone = target.closest(spec.selector) as HTMLElement | null;
    if (!zone || !zone.classList.contains('has-file')) continue;
    if (spec.excludeClass && zone.classList.contains(spec.excludeClass)) continue;
    if (target.closest('button')) return null;

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
      return buildSingleCopyEntries(tc, selectedText, 'companion-copy-timecode', t('contextMenu.copyTimecode'), 'clock');
    }
  }

  return null;
}

function buildTranscriptEntries(target: HTMLElement, selectedText: string): ContextMenuEntry[] | null {
  const card = target.closest('.transcript-card') as HTMLElement | null;
  const viewport = target.closest('#transcript-viewport') as HTMLElement | null;
  if (!card && !viewport) return null;
  if (target.closest('button')) return null;

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
  if (target.closest('button')) return null;

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
    return buildSingleCopyEntries(cmdText, selectedText, 'hardsub-copy-ffmpeg', t('contextMenu.copyCommand'), 'terminal', {
      selectAllTarget: ffmpegPreview,
      selectAllId: 'hardsub-select-ffmpeg'
    });
  }

  // 2. Hardsub preview error detail
  const previewDetail = target.closest('#hardsub-preview-detail') as HTMLElement | null;
  if (previewDetail) {
    const msg = stripBidiMarks(previewDetail.textContent);
    if (!msg) return null;
    return buildSingleCopyEntries(msg, selectedText, 'hardsub-copy-detail', t('contextMenu.copyMessage'), 'copy', {
      selectAllTarget: previewDetail,
      selectAllId: 'hardsub-select-detail'
    });
  }

  // 3. Color Hex Readouts
  const hexEl = target.closest('#hardsub-hex-text, #hardsub-hex-bg') as HTMLElement | null;
  if (hexEl) {
    const hex = stripBidiMarks(hexEl.textContent);
    if (!hex) return null;
    return buildSingleCopyEntries(hex, selectedText, 'hardsub-copy-hex', t('contextMenu.copyColorCode'), 'palette');
  }

  // 4. Hardsub Video Timecodes
  const hardsubTime = target.closest('#hardsub-time-current, #hardsub-time-total, .hardsub-timecode') as HTMLElement | null;
  if (hardsubTime) {
    const tc = stripBidiMarks(hardsubTime.textContent);
    if (tc) {
      return buildSingleCopyEntries(tc, selectedText, 'hardsub-copy-timecode', t('contextMenu.copyTimecode'), 'clock');
    }
  }

  // 5. Hardsub Subtitle Cue Card (outside textarea which uses native menu)
  const cueCard = target.closest('.subtitle-cue-card') as HTMLElement | null;
  if (cueCard) {
    if (target.closest('button')) return null;
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
    return buildSingleCopyEntries(fullText, selectedText, 'test-result-copy-all', t('contextMenu.copyMessage'), 'copy', {
      selectAllTarget: testResultEl,
      selectAllId: 'test-result-select-all'
    });
  }

  // 2. AI Translation Models Table ID / Active Model Chip
  const modelIdEl = target.closest('.model-id-display, .active-model-chip-model') as HTMLElement | null;
  if (modelIdEl) {
    const modelId = stripBidiMarks(modelIdEl.textContent);
    if (modelId) {
      return buildSingleCopyEntries(modelId, selectedText, 'model-copy-id', t('contextMenu.copyModelId'), 'copy');
    }
  }

  const modelMetaEl = target.closest('.model-ctx-value, .active-model-chip-provider') as HTMLElement | null;
  if (modelMetaEl) {
    const val = stripBidiMarks(modelMetaEl.textContent);
    if (val) {
      return buildSingleCopyEntries(val, selectedText, 'model-meta-copy', t('common.copy'), 'copy');
    }
  }

  // 3. Inline <code> snippets in settings descriptions
  const codeEl = target.closest('.setting-desc code, .setting-desc-point code, .setting-desc-points code') as HTMLElement | null;
  if (codeEl) {
    const codeText = stripBidiMarks(codeEl.textContent);
    if (codeText) {
      return buildSingleCopyEntries(codeText, selectedText, 'settings-copy-code', t('common.copy'), 'copy');
    }
  }

  // 4. Model Hub Filename & Hardware Specs
  const modelTitleEl = target.closest('.setting-card[data-model] .setting-title') as HTMLElement | null;
  if (modelTitleEl) {
    const fileName = stripBidiMarks(modelTitleEl.textContent);
    if (fileName) {
      return buildSingleCopyEntries(fileName, selectedText, 'modelhub-copy-filename', t('contextMenu.copyFileName'), 'copy');
    }
  }

  const specsSubtitle = target.closest('#model-specs-subtitle') as HTMLElement | null;
  if (specsSubtitle) {
    const specs = stripBidiMarks(specsSubtitle.textContent);
    if (specs) {
      return buildSingleCopyEntries(specs, selectedText, 'modelhub-copy-specs', t('common.copy'), 'copy');
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
    return buildSingleCopyEntries(text, selectedText, 'modal-copy-message', t('contextMenu.copyMessage'), 'copy', {
      selectAllTarget: modalBox,
      selectAllId: 'modal-select-all'
    });
  }

  // 2. Toast Notifications (skip dismissing toasts and close/action buttons)
  const toastEl = target.closest('.toast-notification') as HTMLElement | null;
  if (toastEl) {
    if (toastEl.classList?.contains('hide') || target.closest('button')) return null;
    const techEl = toastEl.querySelector('.toast-tech-detail') as HTMLElement | null;
    const msgEl = toastEl.querySelector('.toast-message') as HTMLElement | null;
    const copySource =
      techEl && techEl.contains(target)
        ? (techEl.textContent ?? '').trim()
        : ((msgEl?.textContent ?? '').trim() || (techEl?.textContent ?? '').trim());
    if (!copySource) return null;
    return buildSingleCopyEntries(copySource, selectedText, 'toast-copy-message', t('contextMenu.copyMessage'), 'copy',
      techEl && techEl.contains(target)
        ? { selectAllTarget: techEl, selectAllId: 'toast-select-all' }
        : undefined
    );
  }

  // 3. About Modal Version & Diagnostic Info
  const aboutEl = target.closest(
    '.about-version-chip, #about-modal-version-text, .about-engine-version-chip, #about-whisper-version-text, .about-spec-value, #about-update-subtext'
  ) as HTMLElement | null;
  if (aboutEl) {
    const val = stripBidiMarks(aboutEl.textContent);
    if (val) {
      return buildSingleCopyEntries(val, selectedText, 'about-copy-info', t('contextMenu.copyVersionInfo'), 'info');
    }
  }

  return null;
}

/** Resolve all applicable context menu entries for a target DOM element. */
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

  // Generic fallback: offer Copy for selected text, but never hijack right-clicks on action buttons
  if (selectedText && !target.closest('button')) {
    const entries: ContextMenuEntry[] = [];
    addSelectionCopyEntry(entries, selectedText);
    return entries;
  }

  return [];
}
