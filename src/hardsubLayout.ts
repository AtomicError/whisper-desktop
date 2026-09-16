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
