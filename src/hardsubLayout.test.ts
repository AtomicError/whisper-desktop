import { describe, expect, it } from 'vitest';
import {
  spanOrigins,
  assRunOrder,
  protectRtlPunctuation,
  calculateSubtitleBoxGeometry,
  hasArabicScript,
  isArabicScriptFont,
  resolveEffectiveFont,
  toAssFontName,
} from './hardsubLayout';

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

describe('calculateSubtitleBoxGeometry', () => {
  it('computes balanced top and bottom padding around text baseline', () => {
    const geo = calculateSubtitleBoxGeometry({
      firstBaselineY: 200,
      lastBaselineY: 200,
      maxLineWidth: 250,
      fontSize: 16,
      anchorX: 256,
      alignment: 'center',
      bgBoxRadius: 0,
      scaleFactor: 1,
    });

    // boxTop = 200 - 16 * 0.85 - 6 = 200 - 13.6 - 6 = 180.4
    expect(geo.boxY).toBe(180.4);
    // boxBottom = 200 + 16 * 0.35 + 6 = 200 + 5.6 + 6 = 211.6
    // boxHeight = 211.6 - 180.4 = 31.2
    expect(geo.boxHeight).toBe(31.2);
    // Equal clearance for cap-height (~11.5px) and descender (~3.5px)
    expect(200 - geo.boxY).toBeCloseTo(19.6, 1);
    expect((geo.boxY + geo.boxHeight) - 200).toBeCloseTo(11.6, 1);
  });

  it('dynamically increases horizontal padding when corner radius increases to prevent text collisions', () => {
    const rectGeo = calculateSubtitleBoxGeometry({
      firstBaselineY: 100,
      lastBaselineY: 100,
      maxLineWidth: 300,
      fontSize: 16,
      anchorX: 256,
      alignment: 'center',
      bgBoxRadius: 0,
    });
    // Default base horizontal padding is 12px
    expect(rectGeo.paddingH).toBe(12);
    expect(rectGeo.boxWidth).toBe(324);

    const roundedGeo = calculateSubtitleBoxGeometry({
      firstBaselineY: 100,
      lastBaselineY: 100,
      maxLineWidth: 300,
      fontSize: 16,
      anchorX: 256,
      alignment: 'center',
      bgBoxRadius: 16,
    });
    // 6 + 16 * 0.5 = 14px padding to guarantee text never hits the corner curve
    expect(roundedGeo.paddingH).toBe(14);
    expect(roundedGeo.boxWidth).toBe(328);
    // Clamped to half of box height (31.2 / 2 = 15.6) to prevent border distortion
    expect(roundedGeo.radius).toBe(15.6);
  });

  it('correctly aligns horizontal position for center, left, and right alignments', () => {
    const baseInput = {
      firstBaselineY: 100,
      lastBaselineY: 100,
      maxLineWidth: 200,
      fontSize: 16,
      anchorX: 100,
      bgBoxRadius: 0,
    };

    const center = calculateSubtitleBoxGeometry({ ...baseInput, alignment: 'center' });
    expect(center.boxX).toBe(100 - center.boxWidth / 2);

    const left = calculateSubtitleBoxGeometry({ ...baseInput, alignment: 'left' });
    expect(left.boxX).toBe(100 - center.paddingH);

    const right = calculateSubtitleBoxGeometry({ ...baseInput, alignment: 'right' });
    expect(right.boxX).toBe(100 - center.boxWidth + center.paddingH);
  });

  it('correctly covers multi-line captions from first baseline to last baseline', () => {
    const geo = calculateSubtitleBoxGeometry({
      firstBaselineY: 180,
      lastBaselineY: 220, // 2-3 lines span 40px
      maxLineWidth: 150,
      fontSize: 16,
      anchorX: 81,
      alignment: 'center',
      bgBoxRadius: 8,
    });

    expect(geo.boxY).toBeCloseTo(180 - 16 * 0.85 - 6, 2);
    expect(geo.boxY + geo.boxHeight).toBeCloseTo(220 + 16 * 0.35 + 6, 2);
  });

  it('clamps corner radius so it cannot exceed half the box height or width', () => {
    const geo = calculateSubtitleBoxGeometry({
      firstBaselineY: 100,
      lastBaselineY: 100,
      maxLineWidth: 50,
      fontSize: 10,
      anchorX: 100,
      alignment: 'center',
      bgBoxRadius: 50, // excessively large radius
    });

    expect(geo.radius).toBeLessThanOrEqual(geo.boxHeight / 2);
    expect(geo.radius).toBeLessThanOrEqual(geo.boxWidth / 2);
  });

  it('uses precise textAscent and textDescent when provided for symmetrical padding', () => {
    const geo = calculateSubtitleBoxGeometry({
      firstBaselineY: 100,
      lastBaselineY: 100,
      maxLineWidth: 200,
      fontSize: 16,
      anchorX: 100,
      alignment: 'center',
      bgBoxRadius: 0,
      textAscent: 17.5,
      textDescent: 8.5,
    });

    // PaddingV is 6px by default (scaleFactor = 1)
    expect(geo.boxY).toBe(100 - 17.5 - 6);
    expect(geo.boxY + geo.boxHeight).toBe(100 + 8.5 + 6);
    expect(geo.boxHeight).toBe(17.5 + 8.5 + 12);
  });
});

describe('hasArabicScript', () => {
  it('detects Persian and Arabic text correctly', () => {
    expect(hasArabicScript('مواد شیمیایی آزاد می‌کند')).toBe(true);
    expect(hasArabicScript('سلام دنیا!')).toBe(true);
    expect(hasArabicScript('Hello world!')).toBe(false);
    expect(hasArabicScript('12345')).toBe(false);
    expect(hasArabicScript('')).toBe(false);
  });
});

describe('isArabicScriptFont', () => {
  it('correctly classifies Arabic-supporting and Latin-only fonts', () => {
    expect(isArabicScriptFont('Vazirmatn')).toBe(true);
    expect(isArabicScriptFont('Shabnam')).toBe(true);
    expect(isArabicScriptFont('Samim')).toBe(true);
    expect(isArabicScriptFont('Sahel')).toBe(true);
    expect(isArabicScriptFont('Inter')).toBe(false);
    expect(isArabicScriptFont('Outfit')).toBe(false);
    expect(isArabicScriptFont('Roboto')).toBe(false);
    expect(isArabicScriptFont('JetBrains Mono')).toBe(false);
  });
});

describe('resolveEffectiveFont', () => {
  it('falls back to Vazirmatn if Persian text is used with a Latin-only font', () => {
    expect(resolveEffectiveFont('Outfit', 'مواد شیمیایی آزاد می‌کند')).toBe('Vazirmatn');
    expect(resolveEffectiveFont('Inter', 'سلام')).toBe('Vazirmatn');
    expect(resolveEffectiveFont('JetBrains Mono', 'تست')).toBe('Vazirmatn');
  });

  it('keeps original font if text is English or font already supports Arabic', () => {
    expect(resolveEffectiveFont('Outfit', 'Despite what you may think')).toBe('Outfit');
    expect(resolveEffectiveFont('JetBrains Mono', 'console.log("hello")')).toBe('JetBrains Mono');
    expect(resolveEffectiveFont('Shabnam', 'سلام دنیا')).toBe('Shabnam');
    expect(resolveEffectiveFont('Vazirmatn', 'سلام دنیا')).toBe('Vazirmatn');
  });
});

describe('toAssFontName', () => {
  it('maps fonts with internal OpenType naming quirks to their Name ID 1 family name', () => {
    expect(toAssFontName('Inter')).toBe('Inter 24pt');
    expect(toAssFontName('Montserrat')).toBe('Montserrat Thin');
  });

  it('preserves standard font names cleanly', () => {
    expect(toAssFontName('Outfit')).toBe('Outfit');
    expect(toAssFontName('JetBrains Mono')).toBe('JetBrains Mono');
    expect(toAssFontName('Roboto')).toBe('Roboto');
    expect(toAssFontName('Vazirmatn')).toBe('Vazirmatn');
    expect(toAssFontName('Lora')).toBe('Lora');
  });

  it('cleans invalid characters', () => {
    expect(toAssFontName('"Montserrat",')).toBe('Montserrat Thin');
    expect(toAssFontName("'Inter'")).toBe('Inter 24pt');
  });
});



