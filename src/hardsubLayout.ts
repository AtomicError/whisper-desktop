/**
 * Line layout for the subtitle preview and the burn-in script.
 *
 * The preview draws a cue line run by run, because each style run needs its own font,
 * colour and outline and a canvas can only set those per `fillText` call. Laying those
 * runs out left to right is only correct for a line that reads left to right: a
 * right-to-left line puts its first run — the words the sentence starts with — at the
 * right edge of the line box and walks left.
 *
 * That is the order the bidi algorithm gives the line, and it is the order libass
 * renders when the runs share one style: libass splits its runs on style changes rather
 * than on tag blocks, so a line of one style stays a single run and is reordered as a
 * whole. Runs that differ in style are the awkward case — libass resolves each of them
 * on its own and places them in the order written, so a line handed to it in logical
 * order burns in that order rather than the visible one. `assRunOrder` below is what
 * closes that gap, and it is deliberately conditional, because the two cases need
 * opposite handling.
 */

/**
 * Left edge of every run on a line, in logical (not visual) order.
 *
 * `widths` are the measured widths of the runs as they are drawn, and `startX` is the
 * left edge of the whole line box, which the alignment has already placed. Every run
 * is returned exactly once, and the runs together cover `[startX, startX + total]`
 * with no gap or overlap in either direction.
 */
export function spanOrigins(
  widths: number[],
  startX: number,
  direction: 'rtl' | 'ltr',
): number[] {
  if (direction === 'ltr') {
    const origins: number[] = [];
    let x = startX;
    for (const width of widths) {
      origins.push(x);
      x += width;
    }
    return origins;
  }

  const origins = new Array<number>(widths.length);
  let x = startX + widths.reduce((total, width) => total + width, 0);
  for (let i = 0; i < widths.length; i++) {
    x -= widths[i];
    origins[i] = x;
  }
  return origins;
}

/**
 * The order the runs of one cue line must be written into the ASS script, so that what
 * libass burns matches what the preview draws.
 *
 * libass splits the line into runs at style changes — not at tag blocks — and resolves
 * each run on its own, placing the runs in the order written. The two halves of that
 * behaviour pull in opposite directions:
 *
 *  - A line whose runs all share one style stays a single run, and libass reorders that
 *    run as a whole — so the runs must stay in logical order. Writing them in visual
 *    order would hand libass a mirrored line and mirror it back on screen.
 *  - A line whose runs differ in style keeps them apart and lays them out in the order
 *    written — so those have to be written in visual order, or the burn is mirrored, as
 *    the preview never is.
 *
 * Left-to-right lines are unaffected: their visual and logical order are the same.
 * `styleKey` identifies a run's style; runs that differ in any part of it are runs libass
 * lays out separately.
 */
export function assRunOrder<T>(
  runs: T[],
  direction: 'rtl' | 'ltr',
  styleKey: (run: T) => string,
): T[] {
  if (direction !== 'rtl') return runs;
  const uniform = runs.every((run) => styleKey(run) === styleKey(runs[0]));
  return uniform ? runs : [...runs].reverse();
}

/**
 * Protects neutral punctuation (., !, ?, :, -, (), quotes, etc.) at span boundaries in RTL text
 * by anchoring them with Unicode Right-to-Left Marks (\u200F).
 *
 * In Unicode Bidirectional Algorithm (UAX #9), neutral punctuation characters at the edge
 * of an RTL run inherit the base direction of the paragraph (which defaults to LTR in
 * libass and standard renderers). This causes a trailing period in "شما می‌شود." to jump
 * to the far right, rendering erroneously as ".شما می‌شود". Anchoring with \u200F
 * enforces RTL resolution so the punctuation remains visually on the left where it belongs.
 *
 * LTR text is returned completely untouched.
 */
export function protectRtlPunctuation(text: string, direction: 'rtl' | 'ltr'): string {
  if (direction !== 'rtl' || !text) return text;
  let res = text;
  if (/[\p{P}\p{S}]$/u.test(res)) {
    res = res + '\u200F';
  }
  if (/^[\p{P}\p{S}]/u.test(res)) {
    res = '\u200F' + res;
  }
  return res;
}

export interface SubtitleBoxGeometry {
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  radius: number;
  paddingH: number;
  paddingV: number;
}

export interface SubtitleBoxInput {
  firstBaselineY: number;
  lastBaselineY: number;
  maxLineWidth: number;
  fontSize: number;
  anchorX: number;
  alignment: 'left' | 'center' | 'right';
  bgBoxRadius: number;
  scaleFactor?: number;
  textAscent?: number;
  textDescent?: number;
}

/**
 * Computes balanced geometry for subtitle background boxes (both Canvas preview and ASS vector shape).
 *
 * Ensures:
 * 1. Symmetrical top and bottom padding around text glyphs by anchoring to visual typography metrics
 *    (ascent and descent) rather than arbitrary uncompensated font cell bounds.
 * 2. Ample horizontal padding that dynamically clears the corner radius curve, preventing text
 *    from colliding with rounded corners.
 */
export function calculateSubtitleBoxGeometry(input: SubtitleBoxInput): SubtitleBoxGeometry {
  const scale = input.scaleFactor ?? 1;
  const paddingV = 6 * scale;
  const radius = Math.max(0, input.bgBoxRadius * scale);
  // Guarantee that horizontal padding always clears the corner radius curve with comfortable margin
  const paddingH = Math.max(12 * scale, 6 * scale + radius * 0.5);

  const boxWidth = Math.round((input.maxLineWidth + paddingH * 2) * 100) / 100;
  const ascent = input.textAscent ?? input.fontSize * 0.85;
  const descent = input.textDescent ?? input.fontSize * 0.35;
  const boxTop = input.firstBaselineY - ascent - paddingV;
  const boxBottom = input.lastBaselineY + descent + paddingV;
  const boxHeight = Math.round((boxBottom - boxTop) * 100) / 100;
  const boxY = Math.round(boxTop * 100) / 100;

  let boxX = 0;
  if (input.alignment === 'left') {
    boxX = input.anchorX - paddingH;
  } else if (input.alignment === 'right') {
    boxX = input.anchorX - boxWidth + paddingH;
  } else {
    boxX = input.anchorX - boxWidth / 2;
  }
  boxX = Math.round(boxX * 100) / 100;

  const clampedRadius = Math.min(radius, boxWidth / 2, boxHeight / 2);

  return {
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    radius: clampedRadius,
    paddingH,
    paddingV,
  };
}

/**
 * Detects if a text contains Arabic/Persian Unicode characters.
 */
export function hasArabicScript(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text);
}

/**
 * Checks if a font name is a font designed for Arabic/Persian script.
 */
export function isArabicScriptFont(fontName: string): boolean {
  const arabicFonts = ['vazirmatn', 'vazir', 'shabnam', 'samim', 'sahel'];
  const clean = fontName.trim().toLowerCase();
  return arabicFonts.some((f) => clean.includes(f));
}

/**
 * Resolves the effective font for rendering and metrics calculation.
 * If text contains Arabic/Persian script and the chosen font does not support it,
 * automatically falls back to 'Vazirmatn' to prevent desynced background boxes
 * caused by uncontrollable renderer fallback.
 */
export function resolveEffectiveFont(selectedFont: string, text: string): string {
  if (hasArabicScript(text) && !isArabicScriptFont(selectedFont)) {
    return 'Vazirmatn';
  }
  return selectedFont;
}

/**
 * Maps display font names to their internal OpenType Font Family (Name ID 1)
 * required by libass / Fontconfig.
 */
export function toAssFontName(fontName: string): string {
  const clean = fontName.replace(/,/g, '').replace(/['"]/g, '').trim();
  if (clean.toLowerCase() === 'inter') {
    return 'Inter 24pt';
  }
  return clean;
}


