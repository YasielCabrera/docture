import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, readFile, readdir, stat, unlink } from "node:fs/promises";
import { basename, extname, join, dirname, resolve } from "node:path";
import type { CaseDocument, Dataset, EvalCase, ExpectedLocation, TagValue } from "../case.js";
import type { DraftableDataset } from "../dataset/index.js";
import { DatasetError } from "../errors.js";
import { isPlainObject } from "../json.js";
import { compareCodeUnits } from "../order.js";
import { writeFileAtomic } from "./artifacts.js";

/** Make a lazy filesystem document; an explicit MIME type overrides extension inference. */
export function fileDocument(path: string, mimeType?: string): CaseDocument {
  const types: Readonly<Record<string, string>> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".html": "text/html",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".json": "application/json",
  };
  return {
    name: basename(path),
    mimeType: mimeType ?? types[extname(path).toLowerCase()] ?? "application/octet-stream",
    async bytes() {
      return readFile(path);
    },
  };
}
const isMissing = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
async function contentHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function hashedDocument(path: string): Promise<CaseDocument> {
  return { ...fileDocument(path), hash: await contentHash(path) };
}
/** Configuration of a folder-per-case adapter. */
export interface FolderDatasetOptions<T> {
  readonly id?: string;
  readonly documents: string | RegExp | ((files: readonly string[]) => readonly string[]);
  readonly expected: string;
  readonly draft?: string;
  /** Expected locations file, read when present. Default `locations.json`. */
  readonly locations?: string;
  readonly toExpected?: (json: unknown, caseId: string) => T;
  readonly tags?: (caseId: string, dir: string) => EvalCase["tags"];
  readonly group?: (caseId: string) => string;
  readonly include?: readonly string[];
  readonly drafts?: "error" | "skip" | "include";
}
interface FolderCase {
  readonly id: string;
  readonly dir: string;
  readonly documents: readonly CaseDocument[];
  readonly signedOff: boolean;
  readonly drafted: boolean;
  readonly located: boolean;
}

/**
 * Discover one case per subfolder of `root`; folders whose name starts with `.` are ignored. Documents load
 * lazily, but each listed document's content is hashed while listing, because the resume key and the dataset
 * fingerprint must survive a fresh checkout, which resets modification times. Fails on a missing root, document
 * or expected file, a draft without sign-off unless `drafts` allows it, and an unknown `include` id.
 */
export function folderDataset<T = unknown>(root: string, options: FolderDatasetOptions<T>): DraftableDataset<T> {
  const draftName = options.draft ?? "expected.draft.json";
  const locationsName = options.locations ?? "locations.json";
  const caseDir = (id: string): string => {
    if (!id || id === "." || id === ".." || /[/\\]/u.test(id)) throw new DatasetError(`Invalid folder case id ${id}.`, id);
    return join(root, id);
  };
  const metadata = (id: string, dir: string): Pick<EvalCase, "tags" | "group"> => {
    const tags = options.tags?.(id, dir);
    const group = options.group?.(id);
    return { ...(tags === undefined ? {} : { tags }), ...(group === undefined ? {} : { group }) };
  };
  const scan = async (signal: AbortSignal | undefined, hash: boolean): Promise<FolderCase[]> => {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (cause) {
      throw new DatasetError(isMissing(cause) ? `Dataset root ${root} does not exist.` : `Cannot list dataset root ${root}.`, undefined, {
        cause,
      });
    }
    const folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort(compareCodeUnits);
    const missing = options.include?.filter((id) => !folders.includes(id)) ?? [];
    if (missing.length) throw new DatasetError(`Unknown include ids: ${missing.join(", ")}`);
    const found: FolderCase[] = [];
    for (const id of folders) {
      signal?.throwIfAborted();
      if (options.include && !options.include.includes(id)) continue;
      const dir = caseDir(id);
      const files = await readdir(dir);
      const selector = options.documents;
      const names =
        typeof selector === "string"
          ? [selector]
          : typeof selector === "function"
            ? selector(files)
            : files
                .filter((file) => {
                  selector.lastIndex = 0;
                  return selector.test(file);
                })
                .sort(compareCodeUnits);
      if (!names.length) throw new DatasetError(`${id}: no documents.`, id);
      const documents: CaseDocument[] = [];
      for (const file of names) {
        const path = join(dir, file);
        if (!(await exists(path))) throw new DatasetError(`${id}: missing document ${file}.`, id);
        documents.push(hash ? await hashedDocument(path) : fileDocument(path));
      }
      found.push({
        id,
        dir,
        documents,
        signedOff: await exists(join(dir, options.expected)),
        drafted: await exists(join(dir, draftName)),
        located: await exists(join(dir, locationsName)),
      });
    }
    return found;
  };
  return {
    id: options.id ?? basename(resolve(root)),
    async cases(context) {
      const cases: EvalCase<T>[] = [];
      for (const found of await scan(context?.signal, true)) {
        const { id, dir } = found;
        let path = join(dir, options.expected);
        let status: "signed-off" | "draft" = "signed-off";
        if (!found.signedOff) {
          if (!found.drafted) throw new DatasetError(`${id}: missing ${options.expected}.`, id);
          if (options.drafts === "skip") continue;
          if (options.drafts !== "include") throw new DatasetError(`${id}: draft requires sign-off.`, id);
          path = join(dir, draftName);
          status = "draft";
        }
        let value: unknown;
        try {
          value = JSON.parse(await readFile(path, "utf8"));
        } catch (cause) {
          throw new DatasetError(`${id}: invalid expected JSON.`, id, { cause });
        }
        const expected = options.toExpected ? options.toExpected(value, id) : (value as T);
        let locations: EvalCase["locations"];
        if (found.located) {
          let json: unknown;
          try {
            json = JSON.parse(await readFile(join(dir, locationsName), "utf8"));
          } catch (cause) {
            throw new DatasetError(`${id}: invalid ${locationsName}.`, id, { cause });
          }
          const parsed = parseLocations(json);
          if (typeof parsed === "string") throw new DatasetError(`${id}: ${locationsName} ${parsed}.`, id);
          locations = parsed;
        }
        cases.push({ id, documents: found.documents, expected, status, ...metadata(id, dir), ...(locations === undefined ? {} : { locations }) });
      }
      return cases;
    },
    async pendingCases(context) {
      return (await scan(context?.signal, false))
        .filter((found) => !found.signedOff)
        .map(({ id, dir, documents }) => ({ id, documents, ...metadata(id, dir) }));
    },
    async writeExpected(id, value, writeOptions) {
      const dir = caseDir(id);
      let isDirectory = false;
      try {
        isDirectory = (await stat(dir)).isDirectory();
      } catch (cause) {
        if (!isMissing(cause)) throw new DatasetError(`${id}: cannot read the case directory.`, id, { cause });
      }
      if (!isDirectory) throw new DatasetError(`${id}: missing case directory.`, id);
      await writeFileAtomic(join(dir, writeOptions.draft ? draftName : options.expected), JSON.stringify(value, null, 2) + "\n");
    },
    async signOff(id) {
      const dir = caseDir(id);
      const draft = join(dir, draftName);
      try {
        await link(draft, join(dir, options.expected));
        await unlink(draft);
      } catch (cause) {
        throw new DatasetError(`${id}: sign-off requires a draft and no existing expected file.`, id, { cause });
      }
    },
  };
}

/** Validate an `EvalCase.locations` object read from disk, or describe the first problem. */
function parseLocations(value: unknown): NonNullable<EvalCase["locations"]> | string {
  if (!isPlainObject(value)) return "must be an object of location arrays";
  for (const [path, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) return `at ${path} must be an array`;
    for (const entry of entries as unknown[]) {
      if (!isPlainObject(entry)) return `at ${path} must hold objects`;
      const { pageNumber, box } = entry;
      if (!Number.isSafeInteger(pageNumber) || (pageNumber as number) < 1) return `at ${path} needs a positive integer pageNumber`;
      if (box === undefined) continue;
      if (!isPlainObject(box) || !(["x", "y", "width", "height"] as const).every((key) => Number.isFinite(box[key])))
        return `at ${path} needs a box of finite x, y, width and height`;
      if ((box.width as number) < 0 || (box.height as number) < 0) return `at ${path} needs a box with non-negative width and height`;
    }
  }
  return value as Readonly<Record<string, readonly ExpectedLocation[]>>;
}

const isTagValue = (value: unknown): boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * Load a JSONL manifest with `id`, `documents` (paths relative to `base`, default the manifest's folder) and
 * `expected` on each line, plus optional `tags`, `params`, `group` and `locations`. Errors name the manifest line and case.
 */
export function jsonlDataset<T = unknown>(
  manifest: string,
  options: { readonly id?: string; readonly base?: string; readonly toExpected?: (json: unknown, id: string) => T } = {},
): Dataset<T> {
  const name = basename(manifest);
  return {
    id: options.id ?? name,
    async cases(context) {
      let text: string;
      try {
        text = await readFile(manifest, "utf8");
      } catch (cause) {
        throw new DatasetError(isMissing(cause) ? `Manifest ${manifest} does not exist.` : `Cannot read manifest ${manifest}.`, undefined, {
          cause,
        });
      }
      const cases: EvalCase<T>[] = [];
      for (const [index, line] of text.split(/\r?\n/u).entries()) {
        if (!line.trim()) continue;
        context?.signal?.throwIfAborted();
        const at = `${name} line ${index + 1}`;
        let row: unknown;
        try {
          row = JSON.parse(line);
        } catch (cause) {
          throw new DatasetError(`${at}: invalid JSON.`, undefined, { cause });
        }
        const id = isPlainObject(row) && typeof row.id === "string" ? row.id : undefined;
        if (!isPlainObject(row) || id === undefined || !Array.isArray(row.documents) || !("expected" in row))
          throw new DatasetError(`${at}: rows require id, documents and expected.`, id);
        const fail = (problem: string): never => {
          throw new DatasetError(`${at}: ${problem}.`, id);
        };
        if (!row.documents.length) fail("no documents");
        const documents: CaseDocument[] = [];
        for (const file of row.documents) {
          if (typeof file !== "string") fail("document paths must be strings");
          const path = resolve(options.base ?? dirname(manifest), String(file));
          if (!(await exists(path))) fail(`missing document ${String(file)}`);
          documents.push(await hashedDocument(path));
        }
        const { tags, params, group } = row;
        const locations = row.locations === undefined ? undefined : parseLocations(row.locations);
        if (typeof locations === "string") fail(`locations ${locations}`);
        if (tags !== undefined && !(isPlainObject(tags) && Object.values(tags).every(isTagValue)))
          fail("tags must be an object of strings, numbers or booleans");
        if (params !== undefined && !isPlainObject(params)) fail("params must be an object");
        if (group !== undefined && typeof group !== "string") fail("group must be a string");
        cases.push({
          id,
          documents,
          expected: options.toExpected ? options.toExpected(row.expected, id) : (row.expected as T),
          ...(isPlainObject(tags)
            ? { tags: Object.fromEntries(Object.entries(tags).filter((entry): entry is [string, TagValue] => isTagValue(entry[1]))) }
            : {}),
          ...(isPlainObject(params) ? { params } : {}),
          ...(typeof group === "string" ? { group } : {}),
          ...(typeof locations === "object" ? { locations } : {}),
        });
      }
      return cases;
    },
  };
}
