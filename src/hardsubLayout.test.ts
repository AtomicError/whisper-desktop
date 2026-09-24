import { describe, expect, it } from 'vitest';
import { spanOrigins, assRunOrder, protectRtlPunctuation } from './hardsubLayout';

/**
 * The canvas preview draws a cue line one style run at a time, so this function
 * decides the visual order of those runs. A right-to-left line must place its first
 * run at the right edge; reversing that is invisible in the DOM and only shows up as
 * mirrored Persian in the preview, which is why it is pinned here.
 */

describe('spanOrigins', () => {
  it('lays runs out from the left for a left-to-right line', () => {
    expect(spanOrigins([10, 20, 30], 100, 'ltr')).toEqual([100, 110, 130]);
  });

  it('lays runs out from the right for a right-to-left line', () => {
    // First run rightmost, last run ending on the left edge of the line box.
    expect(spanOrigins([10, 20, 30], 100, 'rtl')).toEqual([150, 130, 100]);
  });

  it('covers the line box exactly, with no gap or overlap, in either direction', () => {
    const widths = [7, 13, 5, 40];
    const total = widths.reduce((sum, width) => sum + width, 0);
    for (const direction of ['ltr', 'rtl'] as const) {
      const origins = spanOrigins(widths, 40, direction);
      const boxes = origins
        .map((x, i) => [x, x + widths[i]] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      expect(boxes[0][0]).toBe(40);
      expect(boxes[boxes.length - 1][1]).toBe(40 + total);
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i][0]).toBe(boxes[i - 1][1]);
      }
    }
  });

  it('walks leftwards for rtl and rightwards for ltr', () => {
    const widths = [10, 20, 30];
    const rtl = spanOrigins(widths, 0, 'rtl');
    const ltr = spanOrigins(widths, 0, 'ltr');
    expect(rtl[0]).toBeGreaterThan(rtl[1]);
    expect(rtl[1]).toBeGreaterThan(rtl[2]);
    expect(ltr[0]).toBeLessThan(ltr[1]);
    expect(ltr[1]).toBeLessThan(ltr[2]);
  });

  it('is identical in both directions for a single run, which is why one run never showed the bug', () => {
    expect(spanOrigins([42], 12, 'ltr')).toEqual([12]);
    expect(spanOrigins([42], 12, 'rtl')).toEqual([12]);
  });

  it('returns nothing for a line with no runs', () => {
    expect(spanOrigins([], 100, 'ltr')).toEqual([]);
    expect(spanOrigins([], 100, 'rtl')).toEqual([]);
  });
});

/**
 * `assRunOrder` decides what the burn-in script contains, and the two cases it has to
 * tell apart look identical in the DOM. The trap it guards: pre-ordering a line libass
 * would have kept as a single run mirrors a plain Persian cue that burns correctly
 * today, which is why the uniform case is pinned separately from the split one.
 */
describe('assRunOrder', () => {
  const run = (style: string) => ({ style });
  const key = (r: { style: string }) => r.style;
  const plain = run('plain');
  const italic = run('italic');

  it('keeps a uniformly styled rtl line in logical order, because libass reorders it as one run', () => {
    const runs = [plain, plain, plain];
    expect(assRunOrder(runs, 'rtl', key)).toEqual([plain, plain, plain]);
  });

  it('writes a mixed-style rtl line in visual order, because libass lays its runs out as written', () => {
    const runs = [plain, italic, plain];
    expect(assRunOrder(runs, 'rtl', key)).toEqual([plain, italic, plain].reverse());
  });

  it('treats a single run as uniform, so a one-word cue is untouched', () => {
    expect(assRunOrder([italic], 'rtl', key)).toEqual([italic]);
    expect(assRunOrder([plain], 'rtl', key)).toEqual([plain]);
  });

  it('never reorders a left-to-right line, whatever its styles', () => {
    const runs = [plain, italic, plain];
    expect(assRunOrder(runs, 'ltr', key)).toEqual(runs);
  });

  it('does not mutate the line it is given', () => {
    const runs = [plain, italic];
    assRunOrder(runs, 'rtl', key);
    expect(runs).toEqual([plain, italic]);
  });

  it('handles a line with no runs', () => {
    expect(assRunOrder([], 'rtl', key)).toEqual([]);
  });
});

describe('protectRtlPunctuation', () => {
  it('anchors trailing period on Persian text with RLM', () => {
    expect(protectRtlPunctuation('می‌شود.', 'rtl')).toBe('می‌شود.\u200F');
  });

  it('anchors leading dash on Persian text with RLM', () => {
    expect(protectRtlPunctuation('- سلام بر شما', 'rtl')).toBe('\u200F- سلام بر شما');
  });

  it('anchors quotes surrounding Persian text with RLM on both sides', () => {
    expect(protectRtlPunctuation('«سلام دنیا»', 'rtl')).toBe('\u200F«سلام دنیا»\u200F');
  });

  it('anchors exclamation mark and question mark on Persian text', () => {
    expect(protectRtlPunctuation('خیلی عالیه!', 'rtl')).toBe('خیلی عالیه!\u200F');
    expect(protectRtlPunctuation('آیا مطمئنی؟', 'rtl')).toBe('آیا مطمئنی؟\u200F');
    expect(protectRtlPunctuation('چطور؟', 'rtl')).toBe('چطور؟\u200F');
  });

  it('leaves Persian text without punctuation untouched', () => {
    expect(protectRtlPunctuation('سلام دنیا', 'rtl')).toBe('سلام دنیا');
  });

  it('never modifies left-to-right (English) text, even with punctuation', () => {
    expect(protectRtlPunctuation('This is a test.', 'ltr')).toBe('This is a test.');
    expect(protectRtlPunctuation('"Hello world!"', 'ltr')).toBe('"Hello world!"');
    expect(protectRtlPunctuation('- item', 'ltr')).toBe('- item');
  });

  it('safely handles empty string', () => {
    expect(protectRtlPunctuation('', 'rtl')).toBe('');
    expect(protectRtlPunctuation('', 'ltr')).toBe('');
  });
});
