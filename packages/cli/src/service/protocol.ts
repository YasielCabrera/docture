import type { ConversionFormat, RawDocument } from "docture";

export type ServiceRoute = "convert" | "inspect" | "extract";

export class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export type ServiceRequest = {
  readonly document: RawDocument;
  readonly pages?: readonly number[];
} & (
  | { readonly route: "convert"; readonly format: ConversionFormat }
  | { readonly route: "inspect" }
  | { readonly route: "extract"; readonly schema: string }
);

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpFailure(400, "INVALID_REQUEST", `${name} must be an object.`);
  return Object.fromEntries(Object.entries(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new HttpFailure(400, "INVALID_REQUEST", `${name} contains an unsupported field.`);
}

function optionalString(value: unknown, name: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new HttpFailure(400, "INVALID_REQUEST", `${name} must be a nonempty string of at most ${max} characters.`);
  return value;
}

export function routeOf(url: string | undefined): ServiceRoute {
  if (url === "/convert") return "convert";
  if (url === "/inspect") return "inspect";
  if (url === "/extract") return "extract";
  throw new HttpFailure(404, "NOT_FOUND", "Use /convert, /inspect or /extract.");
}

export function parseRequest(route: ServiceRoute, input: unknown, schemas: Readonly<Record<string, unknown>>): ServiceRequest {
  const value = record(input, "request");
  exactKeys(value, route === "convert" ? ["document", "pages", "format"] : route === "extract" ? ["document", "pages", "schema"] : ["document", "pages"], "request");
  const document = record(value["document"], "document");
  exactKeys(document, ["data", "mimeType", "fileName"], "document");
  const data = document["data"];
  if (typeof data !== "string" || data.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)) throw new HttpFailure(400, "INVALID_REQUEST", "document.data must be nonempty canonical base64.");
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (Buffer.from(bytes).toString("base64") !== data) throw new HttpFailure(400, "INVALID_REQUEST", "document.data must be canonical base64.");
  const mimeType = optionalString(document["mimeType"], "document.mimeType", 200);
  const fileName = optionalString(document["fileName"], "document.fileName", 255);
  const raw = { bytes, ...(mimeType === undefined ? {} : { mimeType }), ...(fileName === undefined ? {} : { fileName }) };
  const pages = value["pages"];
  if (pages !== undefined && (!Array.isArray(pages) || pages.length === 0 || pages.length > 10_000 || !pages.every((page) => Number.isSafeInteger(page) && page >= 1))) throw new HttpFailure(400, "INVALID_REQUEST", "pages must be a nonempty array of positive integer page numbers.");
  const selected = pages === undefined ? {} : { pages: Array.from(pages, Number) };
  if (route === "convert") {
    const format = value["format"] ?? "markdown";
    if (format !== "text" && format !== "markdown" && format !== "html" && format !== "json") throw new HttpFailure(400, "INVALID_REQUEST", "format must be text, markdown, html or json.");
    return { route, document: raw, ...selected, format };
  }
  if (route === "extract") {
    const schema = value["schema"];
    if (typeof schema !== "string" || !Object.hasOwn(schemas, schema)) throw new HttpFailure(400, "INVALID_REQUEST", "schema must name a configured schema.");
    return { route, document: raw, ...selected, schema };
  }
  return { route, document: raw, ...selected };
}
