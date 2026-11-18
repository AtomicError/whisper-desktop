/**
 * Terminal Block Cursor / Typewriter Decipher Rewriting Engine
 * for Whisper Desktop (Tauri + Vanilla TypeScript).
 *
 * Visibly rewrites text from previous language to target language, character by character,
 * guided by a high-contrast terminal block cursor (█) and authentic terminal glyphs.
 */

export const TERMINAL_BLOCK_GLYPHS: string[] = ['█', '█', '█', '▓', '█', '▌', '█', '■'];
// Backward-compatible aliases:
export const TERMINAL_CURSOR_GLYPHS = TERMINAL_BLOCK_GLYPHS;
export const CYBER_HACKER_GLYPHS = '█▓▒░■▌▀▄$#&?';

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
}

let activeCancelHandler: (() => void) | null = null;

/**
 * Pure function: calculates the rewritten string at a given progress (0.0 to 1.0).
 * Characters are rewritten progressively from start to end with an active terminal block cursor (█).
 * Preserves spaces and Persian Zero-Width Non-Joiners (\u200c).
 */
export function scrambleText(
  fromText: string,
  targetText: string,
  progress: number,
  glyphs: string | string[] = TERMINAL_BLOCK_GLYPHS
): string {
  if (progress <= 0) return fromText;
  if (progress >= 1) return targetText;

  const targetLen = targetText.length;
  const fromLen = fromText.length;
  if (targetLen === 0 && fromLen === 0) return '';

  const cursor = Math.floor(progress * (targetLen + 1));
  const glyphCount = glyphs.length;

  let result = '';

  for (let i = 0; i < targetLen; i++) {
    // Preserve Persian ZWNJ (نیم‌فاصله) in target text across transitions
    if (targetText[i] === '\u200c') {
      result += '\u200c';
      continue;
    }

    // Preserve space boundaries so layouts and word wrapping never jump or collapse
    if (targetText[i] === ' ') {
      result += ' ';
      continue;
    }

    if (i < cursor) {
      result += targetText[i];
    } else if (i === cursor) {
      const glyph = glyphs[Math.floor(Math.random() * glyphCount)];
      result += glyph;
    } else {
      if (i < fromLen) {
        result += fromText[i];
      }
    }
  }

  if (fromLen > targetLen) {
    const remainingTail = fromLen - targetLen;
    const fadeOutCount = Math.max(0, Math.floor(remainingTail * (1 - progress)));
    for (let j = targetLen; j < targetLen + fadeOutCount; j++) {
      if (fromText[j] === '\u200c') {
        result += '\u200c';
      } else if (fromText[j] === ' ') {
        result += ' ';
      } else {
        result += fromText[j];
      }
    }
  }

  return result;
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
}

/**
 * Executes a single, coordinated requestAnimationFrame rewrite batch across multiple
 * visible DOM elements. Guarantees 60fps performance without redundant per-element timers.
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

  const duration = options?.duration ?? 1000;
  const glyphs = options?.chars ?? TERMINAL_CURSOR_GLYPHS;
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const validStates: ActiveItemState[] = [];
  for (const item of items) {
    if (item.el && typeof item.el.textContent === 'string') {
      validStates.push({
        el: item.el,
        fromText: item.el.textContent || '',
        targetText: item.targetText
      });
      item.el.classList.add('text-scrambling');
    }
  }

  if (validStates.length === 0) {
    options?.onComplete?.();
    return () => {};
  }

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
  };

  const cancelHandler = () => cleanup(true);
  activeCancelHandler = cancelHandler;

  const tick = (now: number) => {
    if (isDone) return;

    const elapsed = now - startTime;
    const progress = Math.min(1.0, elapsed / duration);

    for (const state of validStates) {
      state.el.textContent = scrambleText(state.fromText, state.targetText, progress, glyphs);
    }

    if (progress < 1.0) {
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
