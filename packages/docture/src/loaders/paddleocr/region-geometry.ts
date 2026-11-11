/**
 * What PaddleOCR's region boxes say about a page: how far it is tilted, and how
 * large each region's text is. A region comes with a box and text and nothing else.
 *
 * The box height alone is a poor measure of text size. The detector thresholds a probability map
 * that shrinks text by a margin proportional to area over perimeter, and
 * ppu-paddle-ocr pads that kernel without growing it back, so a long line's kernel is
 * thinner than its text and a lone digit's is thicker: at one font size a `4` came out
 * 1.8 times as tall as a line of prose. Two estimates that fail differently are
 * combined instead, by geometric mean:
 *
 *  - the kernel's area over perimeter, which cancels the shrink, and
 *  - the kernel's width over the advance width its text has in Helvetica, which
 *    reads every font in a document at the same scale even where Helvetica is wrong.
 */

/** Padding ppu-paddle-ocr added around each detected kernel, as fractions of its height. */
export interface RegionPadding {
  readonly vertical: number;
  readonly horizontal: number;
}

/** Area over perimeter of a body-text kernel, over the font size: 0.49–0.63 across v6 Tiny and Small. */
const KERNEL_SHAPE_EM = 0.55;
/** Kernel width over the Helvetica advance width of its text: 0.91–0.98 across v6 Tiny and Small. */
const KERNEL_WIDTH_EM = 0.94;
/** ppu-paddle-ocr's default padding, the frame the shape estimate was measured in. */
const MEASURED_PADDING: RegionPadding = { vertical: 0.4, horizontal: 0.6 };

/**
 * A region's font size in the unit of its box, or `undefined` for a single
 * character: the detector's blob around one glyph says little about its size, and 62%
 * of v6 Small's lone characters read more than 15% large against 2% of longer text.
 *
 * `slope` is the page's skew as `dy/dx`. On a tilted page the kernel's axis-aligned
 * rectangle is taller than the kernel by its width times the slope, and the padding
 * scales that too, so it is removed after the padding.
 */
export function regionTextSize(
  region: { readonly text: string; readonly box: readonly [number, number, number, number] },
  slope: number,
  padding: RegionPadding,
): number | undefined {
  if ([...region.text.trim()].length < 2) return undefined;
  const { kernelWidth, kernelHeight } = kernelOf(region.box, slope, padding);
  const paddedWidth = kernelWidth + 2 * MEASURED_PADDING.horizontal * kernelHeight;
  const paddedHeight = (1 + 2 * MEASURED_PADDING.vertical) * kernelHeight;
  const fromShape = (kernelHeight * paddedWidth) / (paddedWidth + paddedHeight) / KERNEL_SHAPE_EM;
  const advance = advanceWidth(region.text);
  if (advance <= 0 || kernelWidth <= 0) return fromShape;
  return Math.sqrt(fromShape * (kernelWidth / advance / KERNEL_WIDTH_EM));
}

/** The detected kernel inside a padded box, with the height a tilt adds to its rectangle taken out. */
function kernelOf(
  box: readonly [number, number, number, number],
  slope: number,
  padding: RegionPadding,
): { kernelWidth: number; kernelHeight: number } {
  const [xMin, yMin, xMax, yMax] = box;
  const rectHeight = (yMax - yMin) / (1 + 2 * Math.max(0, padding.vertical));
  const kernelWidth = Math.max(0, xMax - xMin - 2 * Math.max(0, padding.horizontal) * rectHeight);
  return { kernelWidth, kernelHeight: Math.max(rectHeight - kernelWidth * Math.abs(slope), rectHeight / 2) };
}

/**
 * How much taller the boxes are than they would be upright, as the median padded box
 * height over the median with the tilt taken out; 1 on an upright page.
 */
export function tiltGrowth(
  boxes: readonly (readonly [number, number, number, number])[],
  slope: number,
  padding: RegionPadding,
): number {
  const middle = (values: number[]): number => values.sort((a, b) => a - b)[values.length >> 1] ?? 0;
  const scale = 1 + 2 * Math.max(0, padding.vertical);
  const upright = middle(boxes.map((box) => scale * kernelOf(box, slope, padding).kernelHeight));
  const boxed = middle(boxes.map(([, yMin, , yMax]) => yMax - yMin));
  return upright > 0 && boxed > upright ? boxed / upright : 1;
}

/** Helvetica advance widths in thousandths of an em, grouped by width. */
const ADVANCES: readonly (readonly [number, string])[] = [
  [191, "'"],
  [222, "ijl"],
  [278, " ftI.,:;!/|\\[]"],
  [333, "r-()`"],
  [355, '"'],
  [389, "*"],
  [500, "cksvxyzJ"],
  [584, "+=<>~^"],
  [611, "FTZ"],
  [667, "ABEKPSVXY&"],
  [722, "CDHNRUw"],
  [778, "GOQ"],
  [833, "mM"],
  [889, "%"],
  [944, "W"],
  [1015, "@"],
];
const ADVANCE = new Map(ADVANCES.flatMap(([width, characters]) => [...characters].map((character) => [character, width / 1000] as const)));
/** Full-width scripts, set one em per character. */
const FULL_WIDTH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF00-\uFFEF]/u;
/** Digits, most lowercase letters and anything else, as a Latin text face averages. */
const TYPICAL_ADVANCE = 0.556;

function advanceWidth(text: string): number {
  let total = 0;
  for (const character of text.trim()) total += ADVANCE.get(character) ?? (FULL_WIDTH.test(character) ? 1 : TYPICAL_ADVANCE);
  return total;
}

/** Regions at least this many median box heights wide measure the tilt. */
const LONG_REGION = 8;

/**
 * How far the page is tilted, in degrees and without a sign, from how much taller its
 * long regions' boxes are than its short ones; `undefined` with too few long regions.
 *
 * A region's box is axis-aligned, so on a tilted page it grows by its kernel width
 * times the slope, scaled by the padding. Among lines of one text size, height then
 * rises with width; the median slope between pairs of long regions measures it while
 * a heading or two cannot.
 */
export function tiltFromHeights(boxes: readonly (readonly [number, number, number, number])[], padding: RegionPadding): number | undefined {
  const heights = boxes.map(([, yMin, , yMax]) => yMax - yMin).sort((a, b) => a - b);
  const typical = heights[heights.length >> 1] ?? 0;
  const long = boxes
    .map(([xMin, yMin, xMax, yMax]) => ({ width: xMax - xMin, height: yMax - yMin }))
    .filter((box) => typical > 0 && box.width > LONG_REGION * typical);
  const slopes: number[] = [];
  for (let i = 0; i < long.length; i += 1) {
    for (let j = i + 1; j < long.length; j += 1) {
      const wider = long[j]!.width - long[i]!.width;
      if (Math.abs(wider) > LONG_REGION * typical / 2) slopes.push((long[j]!.height - long[i]!.height) / wider);
    }
  }
  if (slopes.length < 6) return undefined;
  slopes.sort((a, b) => a - b);
  const growth = Math.max(0, slopes[slopes.length >> 1]!);
  return (Math.atan(growth / (1 + 2 * Math.max(0, padding.vertical))) * 180) / Math.PI;
}
