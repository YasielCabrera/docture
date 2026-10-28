import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveSource, type LayoutPage, type RawDocument } from "docture";
import { boolFlag, numberFlag, stringFlag, type Parsed } from "../cli/args.js";
import { CliError, UsageError, type ExitCode } from "../cli/errors.js";
import { styleFor, type Io, type Style } from "../cli/io.js";
import { resolveConfig, type LoadedConfig } from "../config.js";
import { describeInput, sourcesOf, type Input } from "../inputs.js";
import { commonOptions, wiringFlags, type CommonOptions } from "../options.js";
import { reportWiring } from "../output.js";
import { localInputs, refuseInputAliases, refuseMissingLeafAliases, type ProtectedInput } from "../output-safety.js";
import { emitPlan } from "../plan.js";
import { resolveSchemaSource } from "../schema.js";
import {
  buildConversionWiring,
  buildWiring,
  planConversionWiring,
  planWiring,
  type WiringFlags,
} from "../wiring.js";
import {
  parseSavedConversion,
  parseSavedExtraction,
  reviewRequest,
  type ReviewRequest,
  type ReviewedExtraction,
} from "../review/input.js";
import { pageRenderer, type PageImage } from "../review/pages.js";
import { conversionReviewHtml, extractionReviewHtml } from "../review/render.js";

const DEFAULT_DPI = 96;

async function readSaved(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    throw new UsageError(`Cannot read "${path}": ${error instanceof Error ? error.message : String(error)}.`);
  }
}

function protectedInputs(request: ReviewRequest): ProtectedInput[] {
  const source = localInputs([request.source]);
  switch (request.kind) {
    case "saved-conversion":
      return [...source, { label: request.conversion, path: request.conversion }];
    case "saved-extraction":
      return [...source, { label: request.extraction, path: request.extraction }];
    case "convert":
    case "extract":
      return source;
  }
}

async function refuseOverwrite(out: string, request: ReviewRequest): Promise<void> {
  const inputs = protectedInputs(request);
  await refuseInputAliases(inputs, [out]);
  await refuseMissingLeafAliases(inputs, [out]);
}

async function rawOf(input: Input, io: Io, signal: AbortSignal): Promise<RawDocument> {
  const [source] = await sourcesOf([input], io, signal);
  if (source === undefined) throw new UsageError(`Nothing to read from ${describeInput(input)}.`);
  return resolveSource(source, signal);
}

function missingPages(pageNumbers: Iterable<number>, images: readonly PageImage[]): readonly number[] {
  const rendered = new Set(images.map((image) => image.pageNumber));
  return [...new Set(pageNumbers)].filter((page) => !rendered.has(page)).sort((a, b) => a - b);
}

function mismatch(what: string, missing: readonly number[], request: ReviewRequest, images: readonly PageImage[]): UsageError {
  return new UsageError(
    `${what} page${missing.length === 1 ? "" : "s"} ${missing.join(", ")}, but ${describeInput(request.source)} has ${images.length} page${images.length === 1 ? "" : "s"}.`,
    "Pass the --source the saved file was made from.",
  );
}

function sizeWarnings(pages: readonly LayoutPage[], images: ReadonlyMap<number, PageImage>): string[] {
  return pages.flatMap((page) => {
    const image = images.get(page.pageNumber);
    if (image === undefined || (Math.abs(image.width - page.width) <= 1 && Math.abs(image.height - page.height) <= 1)) return [];
    return [
      `Page ${page.pageNumber} is ${page.width}x${page.height} in the conversion but ${Math.round(image.width)}x${Math.round(image.height)} in the source; boxes may not line up.`,
    ];
  });
}

interface Prepared {
  readonly config?: LoadedConfig;
  readonly flags: WiringFlags;
  readonly schema?: string;
  readonly common: CommonOptions;
  readonly style: Style;
}

export async function reviewCommand(parsed: Parsed, io: Io, signal: AbortSignal): Promise<ExitCode> {
  const common = commonOptions(parsed, io.color);
  const style = styleFor(common.color);
  const request = await reviewRequest(parsed, io.cwd);
  const dpi = numberFlag(parsed, "dpi", { min: 36, max: 1200, integer: true }) ?? DEFAULT_DPI;
  const out = resolve(io.cwd, stringFlag(parsed, "out") ?? "review.html");
  await refuseOverwrite(out, request);

  const config = await resolveConfig({
    cwd: io.cwd,
    ...(common.configPath === undefined ? {} : { explicit: common.configPath }),
    ...(common.noConfig ? { disabled: true } : {}),
  });
  const flags = wiringFlags(parsed);
  const schema = stringFlag(parsed, "schema");
  const prepared: Prepared = {
    ...(config === undefined ? {} : { config }),
    ...(schema === undefined ? {} : { schema }),
    flags,
    common,
    style,
  };

  const saved = await parseSaved(request);
  if (boolFlag(parsed, "dry-run")) return planReview(io, request, prepared, dpi, out);

  const renderer = await pageRenderer({
    ...(config === undefined ? {} : { config }),
    dpi,
    ...(flags.timeoutMs === undefined ? {} : { timeoutMs: flags.timeoutMs }),
    ownsConfiguredLoaders: saved !== undefined,
  });
  try {
    const title = request.source.label;
    const raw = await rawOf(request.source, io, signal);
    const reviewer =
      saved !== undefined
        ? { review: async () => saved, dispose: async () => {} }
        : request.kind === "convert"
          ? await conversionReviewer(io, prepared)
          : await extractionReviewer(io, prepared);
    // The reviewer's wiring shares the configured loaders with the renderer, so it stays open until the pages are rendered.
    try {
      const reviewed = await reviewer.review(raw, signal);
      const images = await renderer.render(raw, signal);
      const html = reviewHtml(reviewed, title, images, request, (warnings) => reportWiring(io, common, style, [], warnings));
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, html, "utf8");
      if (!common.quiet) {
        const pages = `${images.length} page${images.length === 1 ? "" : "s"}`;
        io.diagnostic(`${style.green("✓")} ${style.bold(title)} ${style.dim("→")} ${out} · ${pages}\n`);
      }
      return 0;
    } finally {
      await reviewer.dispose();
    }
  } finally {
    await renderer.dispose();
  }
}

type Reviewed =
  | { readonly kind: "conversion"; readonly pages: readonly LayoutPage[] }
  | { readonly kind: "extraction"; readonly extraction: ReviewedExtraction };

interface Reviewer {
  review(raw: RawDocument, signal: AbortSignal): Promise<Reviewed>;
  dispose(): Promise<void>;
}

async function parseSaved(request: ReviewRequest): Promise<Reviewed | undefined> {
  switch (request.kind) {
    case "saved-conversion":
      return { kind: "conversion", pages: parseSavedConversion(await readSaved(request.conversion), request.conversion) };
    case "saved-extraction":
      return {
        kind: "extraction",
        extraction: parseSavedExtraction(await readSaved(request.extraction), request.extraction, request.item),
      };
    case "convert":
    case "extract":
      return undefined;
  }
}

function reviewHtml(
  reviewed: Reviewed,
  title: string,
  images: readonly PageImage[],
  request: ReviewRequest,
  warn: (warnings: readonly string[]) => void,
): string {
  switch (reviewed.kind) {
    case "conversion": {
      const missing = missingPages(reviewed.pages.map((page) => page.pageNumber), images);
      if (missing.length > 0) throw mismatch("The conversion has", missing, request, images);
      const byPage = new Map(images.map((image) => [image.pageNumber, image]));
      warn(sizeWarnings(reviewed.pages, byPage));
      return conversionReviewHtml({ title, pages: reviewed.pages, images: byPage });
    }
    case "extraction": {
      const missing = missingPages(reviewed.extraction.cited?.sources.map((line) => line.pageNumber) ?? [], images);
      if (missing.length > 0) throw mismatch("The result cites", missing, request, images);
      return extractionReviewHtml({ title, images, extraction: reviewed.extraction });
    }
  }
}

async function conversionReviewer(io: Io, prepared: Prepared): Promise<Reviewer> {
  const wiring = await buildConversionWiring({ io, ...(prepared.config === undefined ? {} : { config: prepared.config }), flags: prepared.flags });
  reportWiring(io, prepared.common, prepared.style, wiring.notes, wiring.warnings);
  return {
    async review(raw, signal) {
      for await (const item of wiring.converter.convertBatch([raw], { format: "json", assets: "omit", signal })) {
        if (!item.outcome.ok) throw item.outcome.error;
        return { kind: "conversion", pages: item.outcome.result.pages };
      }
      throw new CliError("The converter returned no result.");
    },
    dispose: () => wiring.dispose(),
  };
}

async function extractionReviewer(io: Io, prepared: Prepared): Promise<Reviewer> {
  const schema = await resolveSchemaSource({ ...schemaOptions(prepared), cwd: io.cwd, command: "review" });
  const wiring = await buildWiring({
    io,
    ...(prepared.config === undefined ? {} : { config: prepared.config }),
    flags: { ...prepared.flags, citations: true },
    needsModel: true,
  });
  reportWiring(io, prepared.common, prepared.style, [...wiring.notes, schema.describe], [...wiring.warnings, ...schema.warnings]);
  return {
    async review(raw, signal) {
      const result = await wiring.extractor.extract(raw, schema.schema, { signal });
      return {
        kind: "extraction",
        extraction:
          result.citations === undefined || result.citationSources === undefined
            ? { data: result.data }
            : { data: result.data, cited: { citations: result.citations, sources: result.citationSources } },
      };
    },
    dispose: () => wiring.dispose(),
  };
}

function schemaOptions(prepared: Prepared): { specifier?: string; fromConfig?: NonNullable<LoadedConfig["config"]["schema"]> } {
  const fromConfig = prepared.config?.config.schema;
  return {
    ...(prepared.schema === undefined ? {} : { specifier: prepared.schema }),
    ...(fromConfig === undefined ? {} : { fromConfig }),
  };
}

async function planReview(io: Io, request: ReviewRequest, prepared: Prepared, dpi: number, out: string): Promise<ExitCode> {
  const output = { to: "file" as const, path: out };
  const configInput = prepared.config === undefined ? {} : { config: prepared.config };
  switch (request.kind) {
    case "convert": {
      const plan = await planConversionWiring({ io, ...configInput, flags: prepared.flags });
      reportWiring(io, prepared.common, prepared.style, plan.notes, plan.warnings);
      return emitPlan(io, "review", [request.source], plan, () => ({ review: "conversion", ...plan.pipeline, dpi, output }));
    }
    case "extract": {
      const schema = await resolveSchemaSource({ ...schemaOptions(prepared), cwd: io.cwd, command: "review" });
      const plan = await planWiring({ io, ...configInput, flags: { ...prepared.flags, citations: true }, needsModel: true });
      reportWiring(io, prepared.common, prepared.style, [...plan.notes, schema.describe], [...plan.warnings, ...schema.warnings]);
      return emitPlan(io, "review", [request.source], plan, () => ({
        review: "extraction",
        ...plan.pipeline,
        schema: schema.origin,
        dpi,
        output,
      }));
    }
    case "saved-conversion":
    case "saved-extraction": {
      const review = request.kind === "saved-conversion" ? "conversion" : "extraction";
      const from = request.kind === "saved-conversion" ? request.conversion : request.extraction;
      const loaders = prepared.config?.config.loaders?.map((loader) => loader.name) ?? ["pdfjs"];
      return emitPlan(io, "review", [request.source], { dispose: async () => {} }, () => ({
        review,
        saved: { path: from, ...(request.kind === "saved-extraction" && request.item !== undefined ? { item: request.item } : {}) },
        loaders,
        dpi,
        output,
      }));
    }
  }
}
