import { createDisposalScope, type FlexibleSchema, type ScopedDisposable } from "docture";
import { jsonSchema } from "ai";
import type { LoadedConfig } from "../config.js";
import type { Io } from "../cli/io.js";
import { explain } from "../cli/errors.js";
import { convertedContent, inspectProbe, type InspectReport } from "../operations.js";
import { envelope, errorRecord, recordOf, type Envelope } from "../output.js";
import { buildConversionWiring, buildWiring, type WiringFlags } from "../wiring.js";
import type { ServiceRequest } from "./protocol.js";

export interface OperationOptions {
  readonly io: Io;
  readonly config?: LoadedConfig;
  readonly flags: WiringFlags;
  readonly schemas: Readonly<Record<string, FlexibleSchema>>;
}

export interface ServiceOperations {
  run(request: ServiceRequest, signal: AbortSignal): Promise<Envelope<unknown>>;
  dispose(): Promise<void>;
}

export async function createOperations(options: OperationOptions): Promise<ServiceOperations> {
  const scope = createDisposalScope();
  const wired: { dispose(): Promise<void> }[] = [];
  const config = options.config?.config;
  const configured: ScopedDisposable[] = [
    ...(config?.loaders ?? []), ...(config?.strategies ?? []), ...(config?.classifiers ?? []),
    ...(config?.layoutAnalyzer === undefined ? [] : [config.layoutAnalyzer]),
    ...(typeof config?.extractor === "object" ? [config.extractor] : []),
    ...(typeof config?.converter === "object" ? [config.converter] : []),
  ];
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => disposed ??= (async () => {
    const results = await Promise.allSettled(wired.map((wiring) => wiring.dispose()));
    const remaining = await Promise.allSettled([scope.dispose(...configured)]);
    const failures = [...results, ...remaining].flatMap((result) => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "Service resources failed to dispose.");
  })();
  const shared = { io: options.io, flags: options.flags, disposalScope: scope, ...(options.config === undefined ? {} : { config: options.config }) };
  try {
    const conversion = await buildConversionWiring(shared);
    wired.push(conversion);
    const extraction = await buildWiring({ ...shared, needsModel: Object.keys(options.schemas).length > 0 });
    wired.push(extraction);
    const inspection = await buildWiring({ ...shared, needsModel: false, before: [inspectProbe({ text: false, lines: false, render: false })], ignoreSuppliedExtractor: true });
    wired.push(inspection);
    const inspectSchema = jsonSchema<Omit<InspectReport, "loader">>({});
    return {
      dispose,
      async run(request, signal) {
        const label = request.document.fileName ?? "document";
        const selected = request.pages === undefined ? {} : { pages: request.pages };
        try {
          if (request.route === "convert") {
            for await (const item of conversion.converter.convertBatch([request.document], { format: request.format, assets: "embedded", concurrency: 1, signal, ...selected })) {
              if (!item.outcome.ok) throw item.outcome.error;
              return envelope("convert", [{ file: label, ok: true, ...convertedContent(item.outcome.result) }]);
            }
            throw new Error("The converter returned no result.");
          }
          if (request.route === "inspect") {
            const result = await inspection.extractor.extract(request.document, inspectSchema, { signal, only: ["inspect"], ...selected });
            return envelope("inspect", [{ file: label, ok: true, ...result.data, loader: result.loader }]);
          }
          const schema = options.schemas[request.schema];
          if (schema === undefined) throw new Error("The configured schema is unavailable.");
          const result = await extraction.extractor.extract(request.document, schema, { signal, ...selected });
          return envelope("extract", [recordOf(label, result, true)]);
        } catch (error) {
          signal.throwIfAborted();
          return envelope(request.route, [errorRecord(label, explain(error))]);
        }
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
