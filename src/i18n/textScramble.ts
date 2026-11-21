/**
 * Solid Block Cell Decipher Rewriting Engine
 * for Whisper Desktop (Tauri + Vanilla TypeScript).
 *
 * Sweeps a 4–5 cell wave of uniform solid blocks across each visible label;
 * cipher symbols (@ # $ % & ? * !) morph inside each solid block before
 * resolving to the target character and removing the block.
 */

export const TERMINAL_BLOCK_GLYPHS: string[] = ['█'];
// Backward-compatible aliases:
export const TERMINAL_CURSOR_GLYPHS = TERMINAL_BLOCK_GLYPHS;
export const CYBER_HACKER_GLYPHS = '@#$%&?*!';

const BLOCK_SCRAMBLE_GLYPHS: readonly string[] = ['@', '#', '$', '%', '&', '?', '*', '!'];
const GLYPH_STEP_MS = 54;
const MAX_WAVE_WIDTH = 5;

export interface ScrambleOptions {
  duration?: number;
  chars?: string | string[];
  onComplete?: () => void;
}

export interface ScrambleItem {
  el: HTMLElement;
  targetText: string;
}

interface ActiveItemState {
  el: HTMLElement;
  fromText: string;
  targetText: string;
  delay: number;
  seed: number;
  useDomCells: boolean;
  prefixNode: Text | null;
  suffixNode: Text | null;
  waveCells: HTMLElement[];
  cellTextNodes: Array<Text | null>;
  separatorNodes: Text[];
  nodesScratch: Node[];
  flexWrapper: HTMLSpanElement | null;
  flexMounted: boolean;
  lastResolved: number;
  lastWaveEnd: number;
  lastTailLen: number;
  lastStep: number;
}

let activeCancelHandler: (() => void) | null = null;
let activeElementDetacher: ((el: HTMLElement) => void) | null = null;

function hashCell(index: number, step: number, seed: number): number {
  let h = (index * 374761393 + step * 668265263 + seed * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function pickCellSymbol(
  index: number,
  step: number,
  seed: number,
  customGlyphs: string | string[] | null
): string {
  const pool = customGlyphs && customGlyphs.length > 0 ? customGlyphs : BLOCK_SCRAMBLE_GLYPHS;
  const h = hashCell(index, step, seed);
  return pool[h % pool.length];
}

function computeWaveWindow(
  targetLen: number,
  progress: number
): { resolvedCount: number; waveEnd: number; waveWidth: number } {
  if (targetLen <= 0) {
    return { resolvedCount: 0, waveEnd: 0, waveWidth: 0 };
  }
  const waveWidth = targetLen <= 4 ? targetLen : targetLen <= 8 ? 4 : MAX_WAVE_WIDTH;
  const totalTravel = targetLen + waveWidth;
  const leadEdge = Math.max(1, Math.min(totalTravel, Math.ceil(progress * totalTravel)));
  const resolvedCount = Math.max(0, Math.min(targetLen, leadEdge - waveWidth));
  const waveEnd = Math.min(targetLen, leadEdge);
  return { resolvedCount, waveEnd, waveWidth };
}

function computeTailEnd(fromLen: number, waveEnd: number, targetLen: number, progress: number): number {
  if (fromLen <= waveEnd) return waveEnd;
  if (fromLen <= targetLen) return fromLen;
  const remainingExtra = fromLen - targetLen;
  const keptExtra = Math.max(0, Math.floor(remainingExtra * (1 - progress)));
  return Math.max(waveEnd, targetLen + keptExtra);
}

/**
 * Pure function: calculates a string representation at progress (0.0 to 1.0)
 * using only the uniform solid block glyph (or custom chars), preserving spaces and ZWNJ.
 */
export function scrambleText(
  fromText: string,
  targetText: string,
  progress: number,
  glyphs: string | string[] = TERMINAL_BLOCK_GLYPHS,
  step?: number,
  seed: number = 1
): string {
  if (progress <= 0) return fromText;
  if (progress >= 1) return targetText;

  const targetLen = targetText.length;
  const fromLen = fromText.length;
  if (targetLen === 0 && fromLen === 0) return '';

  const { resolvedCount, waveEnd } = computeWaveWindow(targetLen, progress);
  const customPool = glyphs !== TERMINAL_BLOCK_GLYPHS ? glyphs : null;
  const frameStep = step ?? Math.floor(progress * 24);
  const tailEnd = computeTailEnd(fromLen, waveEnd, targetLen, progress);

  let result = '';
  for (let i = 0; i < waveEnd; i++) {
    const ch = targetText[i];
    if (ch === '\u200c' || ch === ' ') {
      result += ch;
    } else if (i < resolvedCount) {
      result += ch;
    } else {
      result += customPool && customPool.length > 0
        ? pickCellSymbol(i, frameStep, seed, customPool)
        : '█';
    }
  }

  for (let j = waveEnd; j < tailEnd; j++) {
    result += fromText[j];
  }
  return result;
}

function createDomItemState(
  el: HTMLElement,
  fromText: string,
  targetText: string,
  delay: number,
  seed: number,
  isFlexHost: boolean
): ActiveItemState {
  const canUseDomCells =
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function' &&
    typeof document.createTextNode === 'function' &&
    typeof el.replaceChildren === 'function';

  const waveCells: HTMLElement[] = [];
  const cellTextNodes: Array<Text | null> = [];
  const separatorNodes: Text[] = [];
  let flexWrapper: HTMLSpanElement | null = null;

  if (canUseDomCells) {
    for (let i = 0; i < MAX_WAVE_WIDTH; i++) {
      const cell = document.createElement('i');
      cell.className = 'scramble-block-cell';
      cell.setAttribute('aria-hidden', 'true');
      if (typeof cell.appendChild === 'function') {
        const textNode = document.createTextNode('');
        cell.appendChild(textNode);
        cellTextNodes.push(textNode);
      } else {
        cellTextNodes.push(null);
      }
      waveCells.push(cell);
      separatorNodes.push(document.createTextNode(' '));
    }

    if (isFlexHost) {
      const span = document.createElement('span');
      if (typeof span.replaceChildren === 'function') {
        span.className = 'scramble-wave-inline';
        if (span.style) {
          span.style.display = 'inline';
        }
        flexWrapper = span;
      }
    }
  }

  return {
    el,
    fromText,
    targetText,
    delay,
    seed,
    useDomCells: canUseDomCells,
    prefixNode: canUseDomCells ? document.createTextNode('') : null,
    suffixNode: canUseDomCells ? document.createTextNode('') : null,
    waveCells,
    cellTextNodes,
    separatorNodes,
    nodesScratch: [],
    flexWrapper,
    flexMounted: false,
    lastResolved: -1,
    lastWaveEnd: -1,
    lastTailLen: -1,
    lastStep: -1
  };
}

function setCellSymbol(state: ActiveItemState, cellIdx: number, symbol: string): HTMLElement | undefined {
  const cell = state.waveCells[cellIdx];
  if (!cell) return undefined;
  const textNode = state.cellTextNodes[cellIdx];
  if (textNode) {
    if (textNode.data !== symbol) {
      textNode.data = symbol;
    }
  } else {
    cell.textContent = symbol;
  }
  return cell;
}

function renderDomWave(
  state: ActiveItemState,
  progress: number,
  glyphStep: number,
  customGlyphs: string | string[] | null
): void {
  const targetLen = state.targetText.length;
  const fromLen = state.fromText.length;
  const { resolvedCount, waveEnd } = computeWaveWindow(targetLen, progress);
  const tailEnd = computeTailEnd(fromLen, waveEnd, targetLen, progress);
  const tailLen = Math.max(0, tailEnd - waveEnd);

  const boundsChanged =
    resolvedCount !== state.lastResolved ||
    waveEnd !== state.lastWaveEnd ||
    tailLen !== state.lastTailLen;
  const stepChanged = glyphStep !== state.lastStep;

  if (!boundsChanged && !stepChanged) return;

  if (!boundsChanged) {
    let cellIdx = 0;
    for (let i = resolvedCount; i < waveEnd; i++) {
      const ch = state.targetText[i];
      if (ch === ' ' || ch === '\u200c') continue;
      setCellSymbol(state, cellIdx++, pickCellSymbol(i, glyphStep, state.seed, customGlyphs));
    }
    state.lastStep = glyphStep;
    return;
  }

  const nodes = state.nodesScratch;
  nodes.length = 0;

  if (resolvedCount > 0 && state.prefixNode) {
    state.prefixNode.data = state.targetText.slice(0, resolvedCount);
    nodes.push(state.prefixNode);
  }

  let cellIdx = 0;
  let sepIdx = 0;
  for (let i = resolvedCount; i < waveEnd; i++) {
    const ch = state.targetText[i];
    if (ch === ' ' || ch === '\u200c') {
      const sep = state.separatorNodes[sepIdx++];
      if (sep) {
        if (sep.data !== ch) sep.data = ch;
        nodes.push(sep);
      }
      continue;
    }
    const cell = setCellSymbol(state, cellIdx++, pickCellSymbol(i, glyphStep, state.seed, customGlyphs));
    if (cell) {
      nodes.push(cell);
    }
  }

  if (tailLen > 0 && state.suffixNode) {
    state.suffixNode.data = state.fromText.slice(waveEnd, tailEnd);
    nodes.push(state.suffixNode);
  }

  if (state.flexWrapper) {
    state.flexWrapper.replaceChildren(...nodes);
    if (!state.flexMounted) {
      state.el.replaceChildren(state.flexWrapper);
      state.flexMounted = true;
    }
  } else {
    state.el.replaceChildren(...nodes);
  }

  state.lastResolved = resolvedCount;
  state.lastWaveEnd = waveEnd;
  state.lastTailLen = tailLen;
  state.lastStep = glyphStep;
}

/**
 * Cancels any currently active scramble animation, immediately locking all
 * affected elements to their target translated text.
 */
export function cancelActiveScramble(): void {
  if (activeCancelHandler) {
    activeCancelHandler();
    activeCancelHandler = null;
  }
  activeElementDetacher = null;
}

/**
 * Detaches a single element from an active scramble animation without snapping
 * its textContent back to the stale targetText (useful when external state like
 * switchView() assigns a newer label mid-animation).
 */
export function cancelScrambleForElement(el: HTMLElement | null): void {
  if (!el) return;
  if (activeElementDetacher) {
    activeElementDetacher(el);
  } else {
    el.classList?.remove('text-scrambling');
  }
}

/**
 * Executes a single coordinated requestAnimationFrame rewrite batch across visible
 * DOM elements using 4–5 solid block cells whose inner symbols scramble before resolving.
 */
export function scrambleBatch(
  items: ScrambleItem[],
  options?: ScrambleOptions
): () => void {
  cancelActiveScramble();

  if (!items || items.length === 0) {
    options?.onComplete?.();
    return () => {};
  }

  const duration = options?.duration ?? 800;
  const glyphs = options?.chars ?? TERMINAL_CURSOR_GLYPHS;
  const customGlyphs = glyphs !== TERMINAL_BLOCK_GLYPHS ? glyphs : null;
  let startTime: number | null = null;

  const canReadDisplay = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function';
  const rawItems: Array<{ el: HTMLElement; fromText: string; targetText: string; isFlexHost: boolean }> = [];
  for (const item of items) {
    if (item.el && typeof item.el.textContent === 'string') {
      let isFlexHost = false;
      if (canReadDisplay) {
        try {
          const disp = window.getComputedStyle(item.el).display;
          isFlexHost = disp === 'flex' || disp === 'inline-flex' || disp === 'grid' || disp === 'inline-grid';
        } catch (_) {}
      }
      rawItems.push({
        el: item.el,
        fromText: item.el.textContent || '',
        targetText: item.targetText,
        isFlexHost
      });
    }
  }

  if (rawItems.length === 0) {
    options?.onComplete?.();
    return () => {};
  }

  const maxStagger = rawItems.length > 1
    ? Math.min(70, Math.floor(duration * 0.1), (rawItems.length - 1) * 3)
    : 0;
  const itemDuration = Math.max(1, duration - maxStagger);

  const validStates: ActiveItemState[] = rawItems.map((item, idx) => {
    item.el.classList.add('text-scrambling');
    const delay = rawItems.length > 1 ? (idx / (rawItems.length - 1)) * maxStagger : 0;
    return createDomItemState(item.el, item.fromText, item.targetText, delay, (idx + 1) * 97, item.isFlexHost);
  });

  let rafId: number | null = null;
  let isDone = false;

  const cleanup = (snapToTarget: boolean) => {
    if (isDone) return;
    isDone = true;

    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    for (const state of validStates) {
      state.el.classList.remove('text-scrambling');
      if (snapToTarget) {
        state.el.textContent = state.targetText;
      }
    }

    if (activeCancelHandler === cancelHandler) {
      activeCancelHandler = null;
    }
    if (activeElementDetacher === detachElement) {
      activeElementDetacher = null;
    }
  };

  const detachElement = (targetEl: HTMLElement) => {
    if (isDone) return;
    targetEl.classList?.remove('text-scrambling');
    for (let i = validStates.length - 1; i >= 0; i--) {
      if (validStates[i].el === targetEl) {
        validStates.splice(i, 1);
      }
    }
  };

  const cancelHandler = () => cleanup(true);
  activeCancelHandler = cancelHandler;
  activeElementDetacher = detachElement;

  const tick = (now: number) => {
    if (isDone) return;
    if (startTime === null) startTime = now;

    const elapsed = Math.max(0, now - startTime);
    const glyphStep = Math.floor(elapsed / GLYPH_STEP_MS);

    for (const state of validStates) {
      if (elapsed < state.delay) continue;
      const localRaw = Math.min(1.0, (elapsed - state.delay) / itemDuration);
      if (localRaw >= 1.0) {
        state.el.classList.remove('text-scrambling');
        if (
          state.flexMounted ||
          state.lastResolved !== state.targetText.length ||
          state.lastWaveEnd !== state.targetText.length ||
          state.lastTailLen !== 0
        ) {
          state.el.textContent = state.targetText;
          state.flexMounted = false;
          state.lastResolved = state.targetText.length;
          state.lastWaveEnd = state.targetText.length;
          state.lastTailLen = 0;
        }
        continue;
      }

      const localProgress = Math.max(0.04, localRaw);
      if (state.useDomCells) {
        renderDomWave(state, localProgress, glyphStep, customGlyphs);
      } else {
        state.el.textContent = scrambleText(
          state.fromText,
          state.targetText,
          localProgress,
          glyphs,
          glyphStep,
          state.seed
        );
      }
    }

    if (elapsed < duration) {
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(tick);
      } else {
        cleanup(true);
        options?.onComplete?.();
      }
    } else {
      cleanup(true);
      options?.onComplete?.();
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(tick);
  } else {
    cleanup(true);
    options?.onComplete?.();
  }

  return cancelHandler;
}
