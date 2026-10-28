import { readDocument, silentLogger, type DocumentLoader, type RawDocument } from "docture";
import { CliError } from "../cli/errors.js";
import type { LoadedConfig } from "../config.js";
import { baseLoaders, renderingLoaders } from "../wiring.js";

export interface PageImage {
  readonly pageNumber: number;
  /** Page size in PDF points, as the loader reported it. */
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly bytes: Uint8Array;
}

export interface PageRenderer {
  render(raw: RawDocument, signal: AbortSignal): Promise<readonly PageImage[]>;
  dispose(): Promise<void>;
}

function mimeTypeOf(bytes: Uint8Array): PageImage["mimeType"] | undefined {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

export interface PageRendererOptions {
  readonly config?: LoadedConfig;
  readonly dpi: number;
  readonly timeoutMs?: number;
  /** Dispose the configured loaders too. False when a conversion or extraction wiring already owns them. */
  readonly ownsConfiguredLoaders: boolean;
}

/** Fails here, before any document work, when a PDF loader needs @napi-rs/canvas and it is missing. */
export async function pageRenderer(options: PageRendererOptions): Promise<PageRenderer> {
  const base = baseLoaders(options.config);
  const rendering = await renderingLoaders(base, options.dpi);
  const owned: readonly { dispose?(): Promise<void> }[] = [
    ...(options.config?.config.loaders === undefined || options.ownsConfiguredLoaders ? base : []),
    ...(rendering.rasterizer === undefined ? [] : [rendering.rasterizer]),
  ];
  return {
    async render(raw, signal) {
      const { document, loader } = await readDocument(rendering.loaders, raw, silentLogger, signal, options.timeoutMs);
      const images: PageImage[] = [];
      for (const page of document.pages) {
        if (page.image === undefined) throw unrenderable(loader, page.pageNumber);
        const bytes = await page.image({ format: "png" });
        const mimeType = mimeTypeOf(bytes);
        if (mimeType === undefined) {
          throw new CliError(`Page ${page.pageNumber} rendered by ${loader.name} is neither PNG nor JPEG, so a browser cannot show it.`);
        }
        images.push({ pageNumber: page.pageNumber, width: page.width, height: page.height, mimeType, bytes });
      }
      return images;
    },
    async dispose() {
      await Promise.allSettled(owned.map((component) => component.dispose?.()));
    },
  };
}

function unrenderable(loader: DocumentLoader, pageNumber: number): CliError {
  return new CliError(
    `${loader.name} read page ${pageNumber} but cannot render it.`,
    "Review renders PDFs with @napi-rs/canvas. For other inputs, configure a loader that renders pages.",
  );
}
