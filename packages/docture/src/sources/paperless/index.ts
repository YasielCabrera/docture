import { PaperlessTransport, PaperlessError, positiveInteger, type PaperlessConnectionOptions } from "../../paperless/transport.js";
import { checkedLimit, id, parsePage, parseDefinition, parseNamedObject, parseNotes, record, type PaperlessCustomFieldDefinition, type PaperlessNamedObject, type PaperlessNote } from "../../paperless/schema.js";
import { readPaperlessSource, type PaperlessReadOptions, type PaperlessSourceResult } from "../../paperless/read.js";
export type { PaperlessReadOptions, PaperlessSourceResult } from "../../paperless/read.js";

export { PaperlessError } from "../../paperless/transport.js";
export type { PaperlessApiVersion, PaperlessConnectionOptions, PaperlessFailure } from "../../paperless/transport.js";
export type { PaperlessDocument, PaperlessMetadata, PaperlessFieldValue, PaperlessValue, PaperlessVersion, PaperlessCustomFieldDefinition, PaperlessFieldType, PaperlessNamedObject, PaperlessNote } from "../../paperless/schema.js";
export type { PaperlessProvenance } from "../../paperless/provenance.js";

export type PaperlessContextKind = "customFields" | "tags" | "correspondents" | "documentTypes" | "notes";
export type PaperlessContextEntry =
  | { readonly kind: "customFields"; readonly values: readonly PaperlessCustomFieldDefinition[] }
  | { readonly kind: "tags" | "correspondents" | "documentTypes"; readonly values: readonly PaperlessNamedObject[] }
  | { readonly kind: "notes"; readonly values: readonly PaperlessNote[] };
export interface PaperlessQueryOptions extends PaperlessReadOptions {
  readonly query?: string;
  readonly limit: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export class PaperlessSource {
  readonly #transport: PaperlessTransport;
  constructor(options: PaperlessConnectionOptions) { this.#transport = new PaperlessTransport(options); }

  async read(documentId: number, options: PaperlessReadOptions): Promise<PaperlessSourceResult> {
    return readPaperlessSource(this.#transport, documentId, options);
  }

  async *query(options: PaperlessQueryOptions): AsyncGenerator<PaperlessSourceResult> {
    const limit = checkedLimit(options.limit, 100, "query limit", 10_000);
    const pageSize = checkedLimit(options.pageSize, Math.min(limit, 100), "pageSize", 100);
    const maxPages = checkedLimit(options.maxPages, 100, "maxPages", 1_000);
    const first = new URL("api/documents/", this.#transport.instance);
    first.searchParams.set("page_size", String(pageSize)); first.searchParams.set("truncate_content", "false");
    if (options.query !== undefined) { if (options.query.length > 8_192) throw new PaperlessError("Paperless query exceeds the length limit.", "configuration"); first.searchParams.set("query", options.query); }
    let next: string | null = first.href;
    let count = 0; let pages = 0;
    const visited = new Set<string>();
    while (next !== null && count < limit) {
      options.signal?.throwIfAborted();
      if (++pages > maxPages) throw new PaperlessError("Paperless query pagination limit exceeded.", "limit");
      const url = this.#transport.url(next);
      if (url.pathname !== first.pathname || visited.has(url.href)) throw new PaperlessError("Paperless returned an untrusted or repeated pagination URL.");
      visited.add(url.href);
      const page = parsePage((await this.#transport.json(url.href, options.signal)).value);
      for (const raw of page.results) {
        const documentId = id(record(raw, "Paperless query document").id, "Paperless query document ID");
        yield await this.read(documentId, options);
        if (++count >= limit) return;
      }
      next = page.next === null ? null : new URL(page.next, url).href;
    }
  }

  async context(documentId: number, options: { readonly include: readonly PaperlessContextKind[]; readonly limit?: number; readonly signal?: AbortSignal }): Promise<readonly PaperlessContextEntry[]> {
    positiveInteger(documentId, "documentId");
    const limit = checkedLimit(options.limit, 100, "context limit", 10_000);
    const entries: PaperlessContextEntry[] = [];
    for (const kind of new Set(options.include)) {
      if (kind === "notes") {
        const notes = parseNotes((await this.#transport.json(`api/documents/${documentId}/notes/`, options.signal)).value);
        if (notes.length > limit) throw new PaperlessError("Paperless notes context limit exceeded.", "limit");
        entries.push({ kind, values: notes }); continue;
      }
      const route = kind === "customFields" ? "custom_fields" : kind === "documentTypes" ? "document_types" : kind === "correspondents" ? "correspondents" : kind === "tags" ? "tags" : undefined;
      if (route === undefined) throw new PaperlessError("Unknown Paperless context kind.", "configuration");
      const first = this.#transport.url(`api/${route}/?page_size=100`);
      let next: string | null = first.href;
      const values: unknown[] = [];
      const visited = new Set<string>();
      while (next !== null) {
        const url = this.#transport.url(next);
        if (url.pathname !== first.pathname || visited.has(url.href)) throw new PaperlessError("Paperless returned untrusted or repeated context pagination.");
        visited.add(url.href);
        const page = parsePage((await this.#transport.json(url.href, options.signal)).value);
        values.push(...page.results);
        if (values.length > limit || visited.size > 100) throw new PaperlessError("Paperless context limit exceeded.", "limit");
        next = page.next === null ? null : new URL(page.next, url).href;
      }
      if (kind === "customFields") entries.push({ kind, values: values.map(parseDefinition) });
      else entries.push({ kind, values: values.map(parseNamedObject) });
    }
    return entries;
  }
}

export function paperlessSource(options: PaperlessConnectionOptions): PaperlessSource { return new PaperlessSource(options); }
