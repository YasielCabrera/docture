import type { LayoutBox } from "docture";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { defineTemplate, gen, locales, scenario, type FieldLabel, type SyntheticDocument } from "../src/index.js";
import { degrade, profiles, transformBox, type Matrix, type Profile, type ProfileKey } from "../src/degrade/index.js";
import { renderPdf } from "../src/pdfkit/index.js";
import { invoiceModel, type Invoice } from "./fixtures.js";
import { classic } from "./templates.js";

const KEYS = Object.keys(profiles) as ProfileKey[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const RECTANGLES: readonly LayoutBox[] = [
  { x: 60, y: 70, width: 90, height: 40 },
  { x: 440, y: 80, width: 100, height: 30 },
  { x: 250, y: 380, width: 70, height: 70 },
  { x: 70, y: 720, width: 120, height: 50 },
  { x: 420, y: 700, width: 110, height: 60 },
];

const probe = defineTemplate<{ caption: string }>()({
  key: "probe",
  family: "test",
  locale: locales["en-US"],
  printed: { caption: true },
  draw(page, value) {
    page.field("caption", value.caption, { x: 250, y: 250, size: 8 });
    for (const box of RECTANGLES) page.rect(box, { fill: "#000000" });
  },
});

async function rectanglePage(): Promise<SyntheticDocument> {
  const rendered = await renderPdf(probe, { value: { caption: "probe" }, seed: 3, scenario: "base", tags: [] });
  const labels: FieldLabel[] = RECTANGLES.map((box, index) => ({ path: `rectangles[${index}]`, value: index, text: "", pageNumber: 1, box }));
  return { ...rendered, labels };
}

/** Only the geometry of `key`; every other knob does nothing. */
function geometryOnly(key: ProfileKey): Profile {
  const off = [0, 0] as const;
  return {
    key: `${key}-geometry`,
    paper: { tint: off, blotches: off, creases: off, fibre: off },
    geometry: profiles[key].geometry,
    bed: { falloff: off, shadow: off, dust: off, streaks: off, blur: off, motionBlur: off, grain: off, contrast: off },
    encode: { softness: off, greyscale: off, threshold: off, quality: [100, 100] },
  };
}

/** The bounding box, in points, of pixels darker than `level` within `around` widened by `margin` points. */
async function darkBox(png: Uint8Array, dpi: number, around: LayoutBox, margin: number, level = 64): Promise<LayoutBox | undefined> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const scale = dpi / 72;
  const left = Math.max(0, Math.floor((around.x - margin) * scale));
  const top = Math.max(0, Math.floor((around.y - margin) * scale));
  const right = Math.min(info.width - 1, Math.ceil((around.x + around.width + margin) * scale));
  const bottom = Math.min(info.height - 1, Math.ceil((around.y + around.height + margin) * scale));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * info.width + x) * info.channels]! >= level) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX === Infinity) return undefined;
  return { x: minX / scale, y: minY / scale, width: (maxX + 1 - minX) / scale, height: (maxY + 1 - minY) / scale };
}

function iou(a: LayoutBox, b: LayoutBox): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const overlap = Math.max(0, width) * Math.max(0, height);
  return overlap / (a.width * a.height + b.width * b.height - overlap);
}

const sha = async (bytes: Uint8Array): Promise<string> => Buffer.from(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toString("hex");
const pageMatrix = (document: SyntheticDocument, index = 0): Matrix => (document.provenance.pages as { matrix: Matrix }[])[index]!.matrix;
const withoutBoxes = (labels: readonly FieldLabel[]) => labels.map(({ box: _box, ...rest }) => rest);

describe("degrade", () => {
  it.each([
    ["scan", 0.2],
    ["scan", 0.55],
    ["scan", 0.9],
    ["photo", 0.2],
    ["photo", 0.55],
    ["photo", 0.9],
  ] as const)("moves each label box with the pixels it labels under %s geometry at severity %s", async (key, severity) => {
    const source = await rectanglePage();
    const degraded = await degrade(source, { profile: geometryOnly(key), severity, output: "png" });
    expect(degraded.mimeType).toBe("image/png");
    expect(pageMatrix(degraded)).not.toEqual(IDENTITY);
    for (const [index, label] of degraded.labels.entries()) {
      const found = await darkBox(degraded.bytes, 200, label.box, 12);
      expect(found, `rectangle ${index}`).not.toBeUndefined();
      expect(iou(found!, label.box), `rectangle ${index}`).toBeGreaterThanOrEqual(0.9);
      expect(iou(found!, RECTANGLES[index]!), `rectangle ${index} moved`).toBeLessThan(iou(found!, label.box));
    }
  });

  it("leaves geometry and labels untouched at severity 0", async () => {
    const source = await renderPdf(classic, await invoiceModel.sample({ seed: 11 }));
    for (const key of KEYS) {
      const degraded = await degrade(source, { profile: key, severity: 0, dpi: 72, output: "png" });
      expect(pageMatrix(degraded)).toEqual(IDENTITY);
      expect(degraded.labels).toEqual(source.labels);
    }
    const box = { x: 10.1, y: 20.7, width: 30.3, height: 4.9 };
    expect(transformBox(IDENTITY, box)).toEqual(box);
  });

  it("maps a box through a homography to the bounding box of its corners", () => {
    const rotateQuarterTurn: Matrix = [0, -1, 100, 1, 0, 0, 0, 0, 1];
    expect(transformBox(rotateQuarterTurn, { x: 10, y: 20, width: 30, height: 5 })).toEqual({ x: 75, y: 10, width: 5, height: 30 });
    const halveDepth: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 2];
    expect(transformBox(halveDepth, { x: 10, y: 20, width: 30, height: 4 })).toEqual({ x: 5, y: 10, width: 15, height: 2 });
  });

  it("gives identical bytes for the same input and options, and different draws for a different salt", async () => {
    const source = await renderPdf(classic, await invoiceModel.sample({ seed: 5 }));
    const options = { profile: "photo", severity: 0.7, dpi: 100 } as const;
    const first = await degrade(source, options);
    const second = await degrade(source, options);
    expect(await sha(second.bytes)).toBe(await sha(first.bytes));
    expect(second.labels).toEqual(first.labels);
    const salted = await degrade(source, { ...options, salt: "b" });
    expect(await sha(salted.bytes)).not.toBe(await sha(first.bytes));
    expect(pageMatrix(salted)).not.toEqual(pageMatrix(first));
    expect(salted.labels.map((label) => label.path)).toEqual(source.labels.map((label) => label.path));
  });

  it("keeps the ground truth and records the rendition for every profile at severity 0.9", async () => {
    const long = scenario<Invoice>({ name: "long", fields: { lineItems: gen.array({ length: 40 }) } });
    const source = await renderPdf(classic, await invoiceModel.sample({ seed: 2, scenario: long }));
    expect(source.pages).toHaveLength(2);
    for (const key of KEYS) {
      const degraded = await degrade(source, { profile: key, severity: 0.9 });
      expect(degraded.mimeType).toBe("application/pdf");
      expect(new TextDecoder().decode(degraded.bytes.slice(0, 5))).toBe("%PDF-");
      expect(degraded.rendition).toEqual({ kind: key, severity: 0.9, dpi: 200 });
      expect(degraded.expected).toEqual(source.expected);
      expect(degraded.pages).toEqual(source.pages);
      expect(withoutBoxes(degraded.labels)).toEqual(withoutBoxes(source.labels));
      expect(degraded.provenance).toMatchObject({ profile: key, severity: 0.9, dpi: 200, salt: "", source: { sha256: await sha(source.bytes) } });
      const [first, second] = degraded.provenance.pages as { matrix: Matrix }[];
      expect(second!.matrix).not.toEqual(first!.matrix);
      for (const label of degraded.labels) {
        const original = source.labels.find((one) => one.path === label.path)!;
        expect(label.box).toEqual(transformBox(pageMatrix(degraded, label.pageNumber - 1), original.box));
      }
    }
  });

  it("keeps every label box on the page at severity 1", async () => {
    const long = scenario<Invoice>({ name: "long", fields: { lineItems: gen.array({ length: 40 }) } });
    const source = await renderPdf(classic, await invoiceModel.sample({ seed: 2, scenario: long }));
    for (const key of KEYS) {
      for (const salt of ["a", "b", "c", "d"]) {
        const degraded = await degrade(source, { profile: key, severity: 1, dpi: 24, salt });
        for (const { box, pageNumber } of degraded.labels) {
          const page = degraded.pages[pageNumber - 1]!;
          expect(box.x, `${key} ${salt}`).toBeGreaterThanOrEqual(0);
          expect(box.y, `${key} ${salt}`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, `${key} ${salt}`).toBeLessThanOrEqual(page.width);
          expect(box.y + box.height, `${key} ${salt}`).toBeLessThanOrEqual(page.height);
        }
      }
    }
  });

  it("records the render dpi in PNG and JPEG output, so pixel readers size the page as the labels do", async () => {
    const source = await rectanglePage();
    for (const output of ["png", "jpeg"] as const) {
      const image = await degrade(source, { profile: "scan", severity: 0.3, dpi: 144, output });
      const { density, width } = await sharp(image.bytes).metadata();
      expect([output, density, width]).toEqual([output, 144, Math.floor((595.28 * 144) / 72)]);
    }
  });

  it("rejects image output for a multi-page document", async () => {
    const long = scenario<Invoice>({ name: "long", fields: { lineItems: gen.array({ length: 40 }) } });
    const source = await renderPdf(classic, await invoiceModel.sample({ seed: 2, scenario: long }));
    await expect(degrade(source, { profile: "scan", severity: 0.5, output: "png" })).rejects.toThrow(new RangeError('output "png" holds one page, but the document has 2'));
  });
});
