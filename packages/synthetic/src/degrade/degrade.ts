import { MissingEngineError, silentLogger } from "docture";
import { NapiCanvasRasterizer } from "docture/raster/canvas";
import type { FieldLabel, SyntheticDocument } from "../document.js";
import { streamFor } from "../rng.js";
import { transformBox, warp, type Matrix, type RawImage } from "./geometry.js";
import { profiles, resolveKnobs, type Profile, type ProfileKey, type ResolvedKnobs } from "./profiles.js";
import { addGrain, applyContrast, bedOverlay, bilevel, desaturate, motionKernel, pageMatrix, paperColour, paperOverlay, type Draw } from "./stages.js";

/** Supported optional engines of this entry: sharp for every rendition, pdfkit for PDF output. */
export const ENGINE_RANGES = { sharp: "0.35.5", pdfkit: ">=0.17.2 <0.21.0" } as const;

export interface DegradeOptions {
  readonly profile: ProfileKey | Profile;
  /** 0 to 1. Every knob is interpolated between its two ends at this value. */
  readonly severity: number;
  /** Raster resolution. Default 200. */
  readonly dpi?: number;
  /** Default `pdf`. `png` and `jpeg` need a one-page document. */
  readonly output?: "pdf" | "png" | "jpeg";
  /** Varies the random draws without changing the profile. */
  readonly salt?: string;
}

type Sharp = typeof import("sharp").default;

async function loadSharp(): Promise<Sharp> {
  try {
    return (await import("sharp")).default;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'sharp' imported from /u.test(error.message)) {
      throw new MissingEngineError("sharp", ENGINE_RANGES.sharp, "@docture/synthetic/degrade", { cause: error });
    }
    throw error;
  }
}

interface PdfImageDocument {
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: unknown) => void): void;
  addPage(options: { size: [number, number]; margin: number }): void;
  image(source: Buffer, x: number, y: number, options: { width: number; height: number }): void;
  end(): void;
}

async function loadPdfKit(): Promise<new (options: Record<string, unknown>) => PdfImageDocument> {
  try {
    return ((await import("pdfkit")) as unknown as { default: new (options: Record<string, unknown>) => PdfImageDocument }).default;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'pdfkit' imported from /u.test(error.message)) {
      throw new MissingEngineError("pdfkit", ENGINE_RANGES.pdfkit, "@docture/synthetic/degrade", { cause: error });
    }
    throw error;
  }
}

const FIXED_DATE = "2000-01-01T00:00:00Z";
const MIME_TYPES = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" } as const;

interface EncodedPage {
  readonly image: RawImage;
  /** Set when the profile stores the page as JPEG; `image` then lacks its compression artefacts. */
  readonly jpeg?: Uint8Array;
}

/**
 * A scan, low-quality scan, photo or fax rendition of a PDF document. Each page is rasterized at `dpi`,
 * aged, warped by one homography, captured and encoded; every label box goes through the same homography.
 */
export async function degrade(document: SyntheticDocument, options: DegradeOptions): Promise<SyntheticDocument> {
  const profile = typeof options.profile === "string" ? profiles[options.profile] : options.profile;
  const { severity } = options;
  const dpi = options.dpi ?? 200;
  const output = options.output ?? "pdf";
  const salt = options.salt ?? "";
  if (profile === undefined) throw new RangeError(`Unknown degradation profile "${String(options.profile)}". Known: ${Object.keys(profiles).join(", ")}`);
  if (!(severity >= 0 && severity <= 1)) throw new RangeError(`severity must be between 0 and 1, got ${severity}`);
  if (!(dpi > 0 && Number.isFinite(dpi))) throw new RangeError(`dpi must be a positive number, got ${dpi}`);
  if (document.mimeType !== "application/pdf") throw new RangeError(`degrade() needs a PDF document, got ${document.mimeType}`);
  if (output !== "pdf" && document.pages.length !== 1) throw new RangeError(`output "${output}" holds one page, but the document has ${document.pages.length}`);

  const sharp = await loadSharp();
  const rasters = await new NapiCanvasRasterizer().rasterize(
    { bytes: document.bytes, mimeType: "application/pdf" },
    { dpi, format: "png" },
    { signal: new AbortController().signal, logger: silentLogger },
  );
  const scale = dpi / 72;
  const knobs = resolveKnobs(profile, severity);
  const prefix = `degrade:${document.template.key}:${document.sample.scenario}:${profile.key}:${severity}:${salt}`;

  const matrices: Matrix[] = [];
  const encoded: EncodedPage[] = [];
  for (const raster of rasters) {
    const page = document.pages[raster.pageNumber - 1]!;
    const draw: Draw = (stage, knob) => streamFor(document.sample.seed, `${prefix}:p${page.pageNumber}:${stage}:${knob}`);
    let image = await decode(sharp, raster.bytes);
    image = await multiplyOverlay(sharp, image, paperOverlay(knobs.paper, image.width, image.height, draw));
    const matrix = pageMatrix(knobs.geometry, page, draw);
    matrices.push(matrix);
    image = warp(image, matrix, scale, knobs.geometry.surface ?? paperColour(knobs.paper));
    image = await capture(sharp, image, knobs.bed, scale, draw);
    encoded.push(await encode(sharp, image, knobs.encode, dpi));
  }

  const createdAt = typeof document.provenance.createdAt === "string" ? document.provenance.createdAt : FIXED_DATE;
  const bytes =
    output === "pdf"
      ? await assemblePdf(sharp, encoded, document, createdAt, dpi)
      : output === "png"
        ? await toPng(sharp, encoded[0]!, dpi)
        : (encoded[0]!.jpeg ?? (await rawSharp(sharp, encoded[0]!.image).withDensity(dpi).jpeg({ quality: 100 }).toBuffer()));
  const labels: FieldLabel[] = document.labels.map((label) => ({ ...label, box: transformBox(matrices[label.pageNumber - 1]!, label.box) }));
  return {
    ...document,
    bytes: new Uint8Array(bytes),
    mimeType: MIME_TYPES[output],
    labels,
    rendition: { kind: profile.key, severity, dpi, ...(output === "pdf" ? {} : { output }) },
    provenance: {
      source: { sha256: await sha256(document.bytes), provenance: document.provenance },
      createdAt,
      profile: profile.key,
      severity,
      dpi,
      salt,
      output,
      pages: matrices.map((matrix, index) => ({ pageNumber: index + 1, knobs, matrix })),
      sharp: sharp.versions,
    },
  };
}

function rawSharp(sharp: Sharp, image: RawImage): ReturnType<Sharp> {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: image.channels as 1 | 3 } });
}

async function toRaw(pipeline: ReturnType<Sharp>): Promise<RawImage> {
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: info.channels };
}

function decode(sharp: Sharp, png: Uint8Array): Promise<RawImage> {
  return toRaw(sharp(png).flatten({ background: "#ffffff" }));
}

async function multiplyOverlay(sharp: Sharp, image: RawImage, overlay: string | undefined): Promise<RawImage> {
  if (overlay === undefined) return image;
  const composed = await toRaw(rawSharp(sharp, image).composite([{ input: Buffer.from(overlay), blend: "multiply" }]));
  return composed.channels === image.channels ? composed : toRaw(rawSharp(sharp, composed).removeAlpha());
}

async function capture(sharp: Sharp, image: RawImage, knobs: ResolvedKnobs["bed"], scale: number, draw: Draw): Promise<RawImage> {
  let out = await multiplyOverlay(sharp, image, bedOverlay(knobs, image.width, image.height, scale, draw));
  const sigma = knobs.blur * scale;
  if (sigma >= 0.3) out = await toRaw(rawSharp(sharp, out).blur(sigma));
  const kernel = motionKernel(knobs.motionBlur * scale, draw);
  if (kernel !== undefined) out = await toRaw(rawSharp(sharp, out).convolve(kernel));
  addGrain(out, knobs.grain, draw);
  applyContrast(out, knobs.contrast);
  return out;
}

async function encode(sharp: Sharp, image: RawImage, knobs: ResolvedKnobs["encode"], dpi: number): Promise<EncodedPage> {
  let out = image;
  const factor = 1 - knobs.softness;
  if (factor < 1) {
    const small = await toRaw(rawSharp(sharp, out).resize(Math.max(1, Math.round(out.width * factor)), Math.max(1, Math.round(out.height * factor)), { fit: "fill" }));
    out = await toRaw(rawSharp(sharp, small).resize(image.width, image.height, { fit: "fill", kernel: "cubic" }));
  }
  out = desaturate(out, knobs.greyscale);
  if (knobs.threshold > 0) out = bilevel(out, knobs.threshold);
  if (knobs.quality >= 100) return { image: out };
  return { image: out, jpeg: new Uint8Array(await rawSharp(sharp, out).withDensity(dpi).jpeg({ quality: Math.max(1, Math.round(knobs.quality)) }).toBuffer()) };
}

async function toPng(sharp: Sharp, page: EncodedPage, dpi: number): Promise<Uint8Array> {
  const source = page.jpeg === undefined ? rawSharp(sharp, page.image) : sharp(page.jpeg);
  return new Uint8Array(await source.withDensity(dpi).png().toBuffer());
}

async function assemblePdf(sharp: Sharp, pages: readonly EncodedPage[], document: SyntheticDocument, createdAt: string, dpi: number): Promise<Uint8Array> {
  const PDFDocument = await loadPdfKit();
  const date = new Date(createdAt);
  const pdf = new PDFDocument({
    autoFirstPage: false,
    info: { Title: `${document.template.key} ${document.sample.scenario} ${document.sample.seed}`, Producer: "@docture/synthetic", Creator: document.template.key, CreationDate: date, ModDate: date },
  });
  const chunks: Uint8Array[] = [];
  const done = new Promise<void>((resolve, reject) => {
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", resolve);
    pdf.on("error", reject);
  });
  for (const [index, page] of pages.entries()) {
    const { width, height } = document.pages[index]!;
    pdf.addPage({ size: [width, height], margin: 0 });
    const bytes = page.jpeg ?? (await toPng(sharp, page, dpi));
    pdf.image(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, 0, { width, height });
  }
  pdf.end();
  await done;
  return concat(chunks);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
