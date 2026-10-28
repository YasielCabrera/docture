import {
  defineStrategy,
  type ConversionBatchOptions,
  type ConversionResult,
  type DocumentFeatures,
  type ExtractionStrategy,
  type LoadedPage,
  type SafeConversion,
} from "docture";
import { jsonSchema } from "ai";
import { explain } from "./cli/errors.js";
import type { Io } from "./cli/io.js";
import type { CliConverter, CliExtractor } from "./define-config.js";
import { sourcesOf, type Input } from "./inputs.js";
import { errorRecord, type Item } from "./output.js";

export interface PageReport {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly chars: number;
  readonly lines: number;
}

/** One `inspect` result: what the loader produced, before any strategy ran. */
export interface InspectReport {
  readonly loader: string;
  readonly features: DocumentFeatures;
  readonly pages: readonly PageReport[];
  readonly text?: string;
  readonly lines?: readonly { readonly page: number; readonly y: number; readonly text: string }[];
  readonly render?: { readonly pageNumber: number; readonly bytes?: number; readonly error?: string };
}

export interface InspectOptions {
  /** Report on the first n loaded pages. */
  readonly maxPages?: number;
  /** One-based pages to load, passed to the loader as a request. */
  readonly pages?: readonly number[];
  readonly text: boolean;
  readonly lines: boolean;
  /** Also render the first reported page, to prove rendering works. */
  readonly render: boolean;
}

type Probe = Omit<InspectReport, "loader">;

const ANY = jsonSchema({} as Record<string, never>);

function pageReport(page: LoadedPage): PageReport {
  return {
    pageNumber: page.pageNumber,
    width: Math.round(page.width),
    height: Math.round(page.height),
    chars: page.text.trim().length,
    lines: page.lines?.length ?? 0,
  };
}

/**
 * The strategy `inspect` pushes in front of the pipeline. It reports the
 * `features` core handed it, so the report is by construction what eligibility is
 * decided from; a second implementation of `documentFeatures` would drift.
 */
export function inspectProbe(options: InspectOptions): ExtractionStrategy {
  return defineStrategy({
    name: "inspect",
    async extract(ctx) {
      ctx.signal.throwIfAborted();
      const pages =
        options.maxPages === undefined ? ctx.document.pages : ctx.document.pages.slice(0, options.maxPages);

      let render: Probe["render"];
      if (options.render) {
        const first = pages[0];
        if (first === undefined || first.image === undefined) {
          render = { pageNumber: 0, error: "no page can be rendered" };
        } else {
          try {
            const bytes = await first.image(undefined, { signal: ctx.signal });
            render = { pageNumber: first.pageNumber, bytes: bytes.byteLength };
          } catch (error) {
            ctx.signal.throwIfAborted();
            render = { pageNumber: first.pageNumber, error: explain(error).message };
          }
        }
      }

      const data: Probe = {
        features: ctx.features,
        pages: pages.map(pageReport),
        ...(options.text ? { text: pages.map((p) => p.text).join("\n\f\n") } : {}),
        ...(options.lines
          ? {
              lines: pages.flatMap((page) =>
                (page.lines ?? []).map((line) => ({
                  page: page.pageNumber,
                  y: Math.round(line.y),
                  text: line.text,
                })),
              ),
            }
          : {}),
        ...(render === undefined ? {} : { render }),
      };
      return { data };
    },
  });
}

/**
 * Inspect each input in order with an extractor wired with {@link inspectProbe}
 * first. A failed document is a failed item, never a throw.
 */
export async function* inspectInputs(
  extractor: Pick<CliExtractor, "extract">,
  inputs: readonly Input[],
  io: Pick<Io, "readStdin">,
  options: Pick<InspectOptions, "pages">,
  signal: AbortSignal,
): AsyncGenerator<Item<InspectReport>, void, undefined> {
  const sources = await sourcesOf(inputs, io, signal);
  for (const [index, source] of sources.entries()) {
    const label = inputs[index]!.label;
    try {
      const result = await extractor.extract(source, ANY, {
        signal,
        only: ["inspect"],
        ...(options.pages === undefined ? {} : { pages: options.pages }),
      });
      yield { ...(result.data as Probe), file: label, ok: true, loader: result.loader };
    } catch (error) {
      signal.throwIfAborted();
      yield errorRecord(label, explain(error));
    }
  }
}

export interface ConvertedInput {
  readonly index: number;
  readonly input: Input;
  readonly outcome: SafeConversion;
}

/** Convert inputs concurrently, yielding each as it finishes. Writes nothing. */
export async function* convertInputs(
  converter: Pick<CliConverter, "convertBatch">,
  inputs: readonly Input[],
  io: Pick<Io, "readStdin">,
  options: ConversionBatchOptions,
): AsyncGenerator<ConvertedInput, void, undefined> {
  const batch = converter.convertBatch(await sourcesOf(inputs, io, options.signal), options);
  for await (const item of batch) {
    const input = inputs[item.index];
    if (input !== undefined) yield { index: item.index, input, outcome: item.outcome };
  }
}

/** A conversion result as data: the content itself rather than a file it was written to. */
export interface ConvertedContent {
  readonly format: ConversionResult["format"];
  readonly mimeType: ConversionResult["mimeType"];
  readonly content: string;
  readonly pageCount: number;
  readonly loader: string;
  readonly method: string;
  readonly warnings: ConversionResult["warnings"];
}

export function convertedContent(result: ConversionResult): ConvertedContent {
  return {
    format: result.format,
    mimeType: result.mimeType,
    content: result.content,
    pageCount: result.pages.length,
    loader: result.loader,
    method: result.method,
    warnings: result.warnings,
  };
}
