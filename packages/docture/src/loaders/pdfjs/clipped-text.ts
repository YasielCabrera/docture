import type { PdfJsFont, PdfJsModule, PdfJsOperatorList, PdfJsPage } from "./pdfjs.js";

type Matrix = readonly number[];
type Box = readonly [number, number, number, number];
type Point = readonly [number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const FONT_MATRIX: Matrix = [0.001, 0, 0, 0.001, 0, 0];
/** How far, in points, a text item's origin may sit from the run pdf.js drew it in. */
const TOLERANCE = 0.5;

interface GraphicsState {
  readonly ctm: Matrix;
  readonly clip: Box;
  readonly font: PdfJsFont | undefined;
  readonly fontSize: number;
  readonly fontDirection: number;
  readonly charSpacing: number;
  readonly wordSpacing: number;
  readonly hScale: number;
  readonly leading: number;
  readonly rise: number;
}

/** One `showText` operation: its text, its baseline in page space, and whether its clip hides all of it. */
interface TextRun {
  readonly text: string;
  readonly from: Point;
  readonly to: Point;
  readonly clipped: boolean;
}

type Glyph = number | { readonly unicode?: string; readonly width?: number; readonly isSpace?: boolean } | null;

/** A `getTextContent` item: its string and its page-space text matrix. */
export interface ContentText {
  readonly str: string;
  readonly transform: readonly number[];
}

/**
 * Text that `getTextContent` reports but the page never paints, because every glyph of
 * its run falls outside the clip in force when it is shown. Layout tools leave such text
 * behind when a frame's overflow, or a whole earlier page, stays in the content stream
 * under a clip that hides it.
 *
 * The clip is tracked as the bounding box of each clip path, as pdf.js itself does, so
 * a run is only called clipped when it misses that box entirely. A text item belongs to
 * the runs whose baseline holds its origin and whose text it continues; it is clipped
 * when it belongs only to clipped runs. Hidden text can sit on a visible line, so position
 * alone does not decide. Returns undefined when the page clips no text.
 */
export function clippedTextFilter(
  pdfjs: PdfJsModule,
  page: PdfJsPage,
  operators: PdfJsOperatorList,
): ((item: ContentText) => boolean) | undefined {
  const runs = textRuns(pdfjs, page, operators);
  const clipped = runs.flatMap((run, index) => (run.clipped ? [index] : []));
  if (clipped.length === 0) return undefined;
  const drawn = runs.filter((run) => !run.clipped);
  // Clipped runs are few, so they are checked first and most items skip the drawn runs.
  return (item) => {
    const origin: Point = [item.transform[4] ?? 0, item.transform[5] ?? 0];
    const text = compact(item.str);
    return clipped.some((index) => onRun(origin, runs[index]!) && hiddenFrom(runs, index, text)) &&
      !drawn.some((run) => onRun(origin, run) && startsIn(run.text, text) !== undefined);
  };
}

/**
 * How much of an item's text the run holds when the item could start inside it: all of
 * it when the run contains it, else the part the run ends with. Undefined otherwise.
 */
function startsIn(run: string, item: string): number | undefined {
  if (run.includes(item)) return item.length;
  for (let length = Math.min(run.length, item.length - 1); length > 0; length--) {
    if (run.endsWith(item.slice(0, length))) return length;
  }
  return undefined;
}

/**
 * Whether an item starting in clipped run `index` is hidden throughout: the runs that
 * follow it and hold the rest of its text, as pdf.js merges touching runs into one item,
 * are clipped too. An item that runs on into a drawn run, or whose rest cannot be traced,
 * stays.
 */
function hiddenFrom(runs: readonly TextRun[], index: number, item: string): boolean {
  const held = startsIn(runs[index]?.text ?? "", item);
  if (held === undefined) return false;
  let rest = item.slice(held);
  for (let next = index + 1; next < runs.length && rest.length > 0; next += 1) {
    const run = runs[next]!;
    if (run.text.length === 0) continue;
    if (!rest.startsWith(run.text) && !run.text.startsWith(rest)) return false;
    if (!run.clipped) return false;
    rest = rest.slice(run.text.length);
  }
  return rest.length === 0;
}

function compact(text: string): string {
  return text.replace(/\s+/gu, "");
}

function textRuns(pdfjs: PdfJsModule, page: PdfJsPage, operators: PdfJsOperatorList): TextRun[] {
  const { OPS, Util } = pdfjs;
  const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = page.view;
  const runs: TextRun[] = [];
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    ctm: IDENTITY,
    clip: [vx0, vy0, vx1, vy1],
    font: undefined,
    fontSize: 0,
    fontDirection: 1,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    leading: 0,
    rise: 0,
  };
  let pendingClip = false;
  let textMatrix: Matrix = IDENTITY;
  let lineX = 0;
  let lineY = 0;
  let x = 0;
  // A vertical font advances along y with metrics this walk does not model; positions
  // stay unknown until the next text matrix, and runs placed there are not recorded.
  let lost = false;

  const startText = (matrix: Matrix): void => {
    textMatrix = matrix;
    lineX = lineY = x = 0;
    lost = false;
  };
  const moveText = (dx: number, dy: number): void => {
    lineX += dx;
    lineY += dy;
    x = lineX;
  };

  for (const [index, operation] of operators.fnArray.entries()) {
    const args = operators.argsArray[index] ?? [];
    switch (operation) {
      case OPS.save:
        stack.push(state);
        break;
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
        state = stack.pop() ?? state;
        break;
      case OPS.transform: {
        const matrix: unknown = args;
        if (isMatrix(matrix)) state = { ...state, ctm: Util.transform(state.ctm, Array.from(matrix)) };
        break;
      }
      case OPS.paintFormXObjectBegin: {
        stack.push(state);
        const ctm = isMatrix(args[0]) ? Util.transform(state.ctm, Array.from(args[0])) : state.ctm;
        const bbox = isMatrix(args[1], 4) ? Array.from(args[1]) : undefined;
        state = { ...state, ctm, clip: bbox === undefined ? state.clip : intersect(state.clip, transformBox(ctm, bbox)) };
        break;
      }
      case OPS.clip:
      case OPS.eoClip:
        pendingClip = true;
        break;
      case OPS.constructPath: {
        const bbox = isMatrix(args[2], 4) ? Array.from(args[2]) : undefined;
        if (pendingClip && bbox !== undefined) {
          state = { ...state, clip: intersect(state.clip, transformBox(state.ctm, bbox)) };
        }
        pendingClip = false;
        break;
      }
      case OPS.beginText:
        startText(IDENTITY);
        break;
      case OPS.setTextMatrix:
        startText(isMatrix(args[0]) ? Array.from(args[0]) : IDENTITY);
        break;
      case OPS.moveText:
        moveText(num(args[0]), num(args[1]));
        break;
      case OPS.setLeadingMoveText:
        state = { ...state, leading: num(args[1]) };
        moveText(num(args[0]), num(args[1]));
        break;
      case OPS.nextLine:
        moveText(0, state.leading);
        break;
      case OPS.setLeading:
        state = { ...state, leading: -num(args[0]) };
        break;
      case OPS.setCharSpacing:
        state = { ...state, charSpacing: num(args[0]) };
        break;
      case OPS.setWordSpacing:
        state = { ...state, wordSpacing: num(args[0]) };
        break;
      case OPS.setHScale:
        state = { ...state, hScale: num(args[0]) / 100 };
        break;
      case OPS.setTextRise:
        state = { ...state, rise: num(args[0]) };
        break;
      case OPS.setFont: {
        const name = args[0];
        const loaded = typeof name === "string" && page.commonObjs.has(name) ? page.commonObjs.get(name) : undefined;
        const size = num(args[1]);
        state = {
          ...state,
          font: typeof loaded === "object" && loaded !== null ? (loaded as PdfJsFont) : state.font,
          fontSize: Math.abs(size),
          fontDirection: size < 0 ? -1 : 1,
        };
        break;
      }
      case OPS.showText: {
        if (state.font?.vertical === true) lost = true;
        if (lost || !Array.isArray(args[0])) break;
        const glyphs = args[0] as readonly Glyph[];
        const start = x;
        const end = x + advance(glyphs, state) * state.hScale * state.fontDirection;
        x = end;
        const trm = Util.transform(state.ctm, textMatrix);
        const along = [Math.min(start, end), Math.max(start, end)] as const;
        // A negative font size draws the glyphs upside down, below the baseline.
        const descent = lineY + state.rise - state.fontSize * 0.25 * state.fontDirection;
        const ascent = lineY + state.rise + state.fontSize * state.fontDirection;
        const box = transformBox(trm, [along[0], Math.min(descent, ascent), along[1], Math.max(descent, ascent)]);
        runs.push({
          text: compact(glyphs.map((glyph) => (typeof glyph === "object" && glyph !== null ? glyph.unicode ?? "" : "")).join("")),
          from: apply(trm, along[0], lineY + state.rise),
          to: apply(trm, along[1], lineY + state.rise),
          clipped: misses(box, state.clip),
        });
        break;
      }
      case OPS.beginAnnotation:
        // Annotation appearances follow the page content and are not page text.
        return runs;
    }
  }
  return runs;
}

/** The run's advance in text space before horizontal scaling, as pdf.js's canvas computes it. */
function advance(glyphs: readonly Glyph[], state: GraphicsState): number {
  const fontMatrix = state.font?.fontMatrix ?? FONT_MATRIX;
  let total = 0;
  for (const glyph of glyphs) {
    if (typeof glyph === "number") total -= (glyph * state.fontSize) / 1000;
    else if (glyph !== null) {
      const spacing = (glyph.isSpace === true ? state.wordSpacing : 0) + state.charSpacing;
      total += (glyph.width ?? 0) * state.fontSize * (fontMatrix[0] ?? 0.001) + spacing * state.fontDirection;
    }
  }
  return total;
}

function onRun(point: Point, run: TextRun): boolean {
  const [px, py] = point;
  const [ax, ay] = run.from;
  const dx = run.to[0] - ax;
  const dy = run.to[1] - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= TOLERANCE;
}

function apply(m: Matrix, x: number, y: number): Point {
  return [(m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0), (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0)];
}

function transformBox(m: Matrix, [x0 = 0, y0 = 0, x1 = 0, y1 = 0]: readonly number[]): Box {
  const points = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function intersect(a: Box, b: Box): Box {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Written so that NaN geometry compares false and its text is kept. */
function misses(box: Box, clip: Box): boolean {
  return (
    clip[0] > clip[2] || clip[1] > clip[3] ||
    box[2] < clip[0] || box[0] > clip[2] || box[3] < clip[1] || box[1] > clip[3]
  );
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isMatrix(value: unknown, length = 6): value is ArrayLike<number> {
  return (
    (Array.isArray(value) || ArrayBuffer.isView(value)) &&
    (value as ArrayLike<unknown>).length >= length &&
    Array.from(value as ArrayLike<unknown>).every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}
