import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Extractor as PortableExtractor, type ExtractorOptions } from "../core/extractor.js";
import { DocumentConverter as PortableConverter, type DocumentConverterOptions } from "../core/converter.js";
import { Process as PortableProcess } from "../core/process.js";
import { UnsupportedSourceError, MissingComponentError, messageOf } from "../core/pipeline/errors.js";
import { resolveSourceWithFiles, type SourceResolver } from "../core/pipeline/source.js";
import type { Classification } from "../core/contracts/classifier.js";
import { createCheckedExtractor as portableCheckedExtractor } from "../core/checked.js";

export * from "../core/index.js";

const READ_FAILURES: Readonly<Record<string, readonly [problem: string, fix: string]>> = {
  ENOENT: ["no such file", "Check the path; a relative path resolves from the current directory."],
  ENOTDIR: ["a parent of this path is not a directory", "Check the path."],
  EISDIR: ["it is a directory", "Pass a file inside it instead."],
  EACCES: ["permission denied", "Grant read access to the file, or run as a user who has it."],
  EPERM: ["permission denied", "Grant read access to the file, or run as a user who has it."],
};

export const resolveNodeSource: SourceResolver = (source, signal) => resolveSourceWithFiles(source, signal, async (file, abort) => {
  let path = typeof file === "string" ? file : file.href;
  try {
    if (file instanceof URL) path = fileURLToPath(file);
    const bytes = new Uint8Array(await readFile(path, abort === undefined ? {} : { signal: abort }));
    return { bytes, fileName: basename(path) };
  } catch (error) {
    abort?.throwIfAborted();
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined;
    const known = code === undefined ? undefined : READ_FAILURES[code];
    const reason = known === undefined ? messageOf(error) : `${known[0]} (${code}). ${known[1]}`;
    throw new UnsupportedSourceError(`Cannot read ${path}: ${reason}`, { cause: error });
  }
});

export { resolveNodeSource as resolveSource };

export class Extractor extends PortableExtractor {
  constructor(options: ExtractorOptions = {}) {
    super({ sourceResolver: resolveNodeSource, ...options });
  }
}

export class DocumentConverter extends PortableConverter {
  constructor(options: DocumentConverterOptions = {}) {
    super({ sourceResolver: resolveNodeSource, ...options });
  }
}

export class Process<C extends readonly Classification[] = readonly Classification[]> extends PortableProcess<C> {
  constructor(options: { readonly sourceResolver?: SourceResolver } = {}) {
    super({ sourceResolver: resolveNodeSource, ...options });
  }
}

export function createExtractor(options: ExtractorOptions): Extractor {
  if ((options.loaders ?? []).length === 0) throw new MissingComponentError("createExtractor needs at least one loader.");
  return new Extractor(options);
}

export function createDocumentConverter(options: DocumentConverterOptions = {}): DocumentConverter {
  return new DocumentConverter(options);
}

export const createCheckedExtractor: typeof portableCheckedExtractor = (options) =>
  portableCheckedExtractor({ ...options, sourceResolver: options.sourceResolver ?? resolveNodeSource });
