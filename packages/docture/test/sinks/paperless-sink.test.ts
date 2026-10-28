import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_USAGE, type ExtractionResult } from "docture";
import { createHash } from "node:crypto";
import { PaperlessSink } from "../../src/sinks/paperless/index.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); });
type Value = string | number | boolean | null | number[];
const nativeTypes = ["string", "longtext", "url", "date", "boolean", "integer", "float", "monetary", "documentlink", "select"];
const proposals: Value[] = ["Reference 7", "Long extracted text", "https://example.test/reference", "2026-10-28", false, 0, 1.25, "USD12.30", [44], "choice-a"];
function result(data: unknown): ExtractionResult<unknown> { return { data, method: "fixture", loader: "paperless-content", attempts: [], usage: EMPTY_USAGE, validation: { valid: true, issues: [] }, features: { mimeType: "text/plain", pageCount: 1, textLength: 120, hasTextLayer: true, hasGeometry: false, hasRenderablePages: false, form: "digital" } }; }

async function fixture(apiVersion: 9 | 10 = 10) {
  const state = {
    values: new Map<number, Value>(), targetValues: new Map<number, Value>(), tags: [2], notes: [] as { id: number; note: string }[],
    content: "Exact source text that identifies this file version. It is long enough for an ordinary text extraction strategy to process.",
    writes: [] as { method: string; body: Record<string, unknown> }[], requests: [] as string[],
    before: undefined as ((request: IncomingMessage) => void) | undefined,
    failure: undefined as "field-400-after" | "note-disconnect-after" | "note-error-after" | "deny" | "mismatch" | "unknown-note" | "rate-limit" | undefined,
    targetChange: true, mainChange: true,
  };
  const rawDocument = (target = false) => ({ id: target ? 44 : 42, root_document: null, title: target ? "Target" : "Main", content: state.content, user_can_change: target ? state.targetChange : state.mainChange, tags: [...state.tags], custom_fields: [...(target ? state.targetValues : state.values)].map(([field, value]) => ({ field, value })), correspondent: null, document_type: null, versions: [{ id: target ? 44 : 43, is_root: target, checksum: "original", added: "2026-01-02" }, ...target ? [] : [{ id: 42, is_root: true, checksum: "root-original", added: "2026-01-01" }]] });
  const json = (response: ServerResponse, body: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
  const server = createServer(async (request, response) => {
    state.requests.push(`${request.method} ${request.url}`); state.before?.(request);
    response.setHeader("X-Version", "3.3.4"); response.setHeader("X-Api-Version", String(apiVersion));
    const url = new URL(request.url ?? "", "http://local");
    if (request.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: Record<string, unknown> = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      state.writes.push({ method: url.pathname, body });
      if (state.failure === "deny") { response.writeHead(403); response.end(); return; }
      if (state.failure === "rate-limit") { response.writeHead(429); response.end(); return; }
      if (url.pathname.endsWith("notes/")) {
        if (state.failure !== "unknown-note") state.notes.push({ id: state.notes.length + 1, note: String(body.note) });
        if (state.failure === "note-disconnect-after" || state.failure === "unknown-note") { response.destroy(); return; }
        if (state.failure === "note-error-after") { json(response, { error: "indexing failed after create" }); return; }
        json(response, state.notes); return;
      }
      if (body.method === "modify_custom_fields") {
        const parameters = body.parameters as { add_custom_fields: Record<string, Value>; remove_custom_fields?: number[] };
        if (!Array.isArray(parameters.remove_custom_fields)) { response.statusCode = 400; json(response, { error: "remove_custom_fields not specified" }); return; }
        expect(parameters.remove_custom_fields).toEqual([]);
        if (state.failure !== "mismatch") for (const [field, value] of Object.entries(parameters.add_custom_fields)) {
          state.values.set(Number(field), value);
          if (Number(field) === 9 && Array.isArray(value)) state.targetValues.set(9, [...new Set([...(state.targetValues.get(9) as number[] | undefined ?? []), 42])]);
        }
        if (state.failure === "field-400-after") { response.statusCode = 400; json(response, { error: "audit failed after write" }); return; }
      } else if (body.method === "add_tag") {
        const tag = (body.parameters as { tag: number }).tag; if (!state.tags.includes(tag)) state.tags.push(tag);
      } else { response.writeHead(400); response.end(); return; }
      json(response, { result: "OK" }); return;
    }
    if (url.pathname.endsWith("custom_fields/")) { json(response, { count: 10, next: null, results: nativeTypes.map((type, index) => ({ id: index + 1, name: type, data_type: type, extra_data: type === "select" ? { select_options: [{ id: "choice-a", label: "A" }] } : {} })) }); return; }
    if (url.pathname.endsWith("tags/")) { json(response, { count: 2, next: null, results: [{ id: 2, name: "Existing" }, { id: 3, name: "Extracted" }] }); return; }
    if (url.pathname.endsWith("notes/")) { json(response, state.notes); return; }
    json(response, rawDocument(url.pathname.includes("/44/")));
  });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("no address");
  const connection = { baseUrl: `http://127.0.0.1:${address.port}/`, apiVersion };
  const provenance = { kind: "paperless" as const, schemaVersion: 1 as const, instance: connection.baseUrl, documentId: 42, fileVersionId: 43, variant: "content" as const, digest: createHash("sha256").update(state.content).digest("hex"), apiVersion, serverVersion: "3.3.4", nativeChecksum: "original", metadata: { id: 42, rootDocumentId: null, title: "Main", tags: [], customFields: [], correspondent: null, documentType: null, versions: [{ id: 43, isRoot: false, checksum: "original", added: "2026-01-02" }, { id: 42, isRoot: true, checksum: "root-original", added: "2026-01-01" }], userCanChange: true }, uiUrl: `${connection.baseUrl}documents/42/details` };
  const input = (data: unknown) => ({ provenance, extraction: result(data), schemaId: "schema-v1", mappingId: "mapping-v1", extractionId: "caller-run-1" });
  return { state, connection, input, provenance };
}

describe("Paperless fill-empty plan and apply", () => {
  it.each([9, 10] as const)("plans without writes and fills every native type through API %i", async (version) => {
    const { state, connection, input } = await fixture(version);
    const fields = proposals.map((_value, index) => ({ path: [`field${index + 1}`], fieldId: index + 1 }));
    const sink = new PaperlessSink({ ...connection, fields, evidence: "any", tagIds: [3], auditNote: "Docture extraction" });
    const data = Object.fromEntries(proposals.map((value, index) => [`field${index + 1}`, value]));
    const plan = await sink.plan(input(data));
    expect(plan.blocked).toEqual([]); expect(plan.operations).toHaveLength(12); expect(state.writes).toEqual([]);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    const applied = await sink.apply(JSON.parse(JSON.stringify(plan)));
    expect(applied.status).toBe("complete"); expect(applied.outcomes.every((outcome) => outcome.status === "applied")).toBe(true);
    expect([...state.values.values()]).toEqual(proposals); expect(state.targetValues.get(9)).toEqual([42]);
    expect(state.tags).toEqual([2, 3]); expect(state.notes).toHaveLength(1);
    const again = await sink.apply(plan);
    expect(again.outcomes.every((outcome) => outcome.status === "skipped")).toBe(true);
    expect(state.notes).toHaveLength(1); expect(state.writes).toHaveLength(12);
  });

  it("re-reads fields between operations and preserves 0, false and co-writer values", async () => {
    const { state, connection, input } = await fixture();
    state.values.set(5, false); state.values.set(6, 0);
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["first"], fieldId: 1 }, { path: ["second"], fieldId: 2 }, { path: ["flag"], fieldId: 5 }, { path: ["count"], fieldId: 6 }], evidence: "any" });
    const plan = await sink.plan(input({ first: "ours", second: "ours too", flag: true, count: 7 }));
    expect(plan.skipped.map((skip) => skip.fieldId)).toEqual([5, 6]);
    state.before = (request) => { if (request.method === "GET" && state.writes.length === 1) state.values.set(2, "human edit"); };
    const applied = await sink.apply(plan);
    expect(state.values.get(1)).toBe("ours"); expect(state.values.get(2)).toBe("human edit"); expect(state.values.get(5)).toBe(false); expect(state.values.get(6)).toBe(0);
    expect(applied.outcomes[1]).toMatchObject({ status: "skipped", current: "human edit", proposed: "ours too", reason: expect.stringContaining("nonempty") });
  });

  it("blocks invalid results, mapped conflicts, evidence failures and native invalid values before mutation", async () => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["nested", "value"], fieldId: 6 }] });
    const invalid = { ...input({ nested: { value: 1 } }), extraction: { ...result({ nested: { value: 1 } }), validation: { valid: false, issues: [{ path: "nested.value", message: "invalid" }] } } };
    expect((await sink.plan(invalid)).blocked.length).toBeGreaterThan(0);
    const conflicted = { ...input({ nested: { value: 1 } }), extraction: { ...result({ nested: { value: 1 } }), conflicts: [{ path: "nested", values: [{ value: 1, pages: [1] }, { value: 2, pages: [2] }] }] } };
    expect((await sink.plan(conflicted)).blocked.some((issue) => issue.reason.includes("conflict"))).toBe(true);
    const evidence = await sink.plan(input({ nested: { value: 1 } })); expect(evidence.blocked.some((issue) => issue.reason.includes("evidence"))).toBe(true);
    await expect(sink.apply(evidence)).rejects.toThrow(/blocked/i);
    const any = new PaperlessSink({ ...connection, fields: [{ path: ["count"], fieldId: 6 }], evidence: "any" });
    expect((await any.plan(input({ count: 1.5 }))).blocked.some((issue) => issue.reason.includes("integer"))).toBe(true);
    expect(state.writes).toEqual([]);
  });

  it("rejects changed source identity and untrusted plan operations or configured-policy overrides", async () => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["reference"], fieldId: 1 }], evidence: "any" });
    const plan = await sink.plan(input({ reference: "ours" }));
    await expect(sink.apply({ ...plan, operations: [...plan.operations, ...plan.operations] })).rejects.toThrow(/duplicate/i);
    await expect(sink.apply({ ...plan, evidence: "any" })).rejects.toThrow(/unknown|extra/i);
    const stricter = new PaperlessSink({ ...connection, fields: [{ path: ["reference"], fieldId: 1 }] });
    await expect(stricter.apply(plan)).rejects.toThrow(/configuration|marker|evidence/i);
    state.content = "source changed";
    await expect(sink.apply(plan)).rejects.toThrow(/source.*changed/i);
    expect(state.writes).toEqual([]);
  });

  it.each(["field-400-after", "note-disconnect-after", "note-error-after"] as const)("reconciles native %s after an accepted write", async (failure) => {
    const { state, connection, input } = await fixture(); state.failure = failure;
    const sink = new PaperlessSink({ ...connection, fields: failure === "field-400-after" ? [{ path: ["value"], fieldId: 1 }] : [], evidence: "any", ...(failure === "field-400-after" ? {} : { auditNote: "Audit" }) });
    const plan = await sink.plan(input({ value: "ours" }));
    const applied = await sink.apply(plan); expect(applied.outcomes[0]?.status).toBe("applied");
    await sink.apply(plan); expect(state.writes).toHaveLength(1);
  });

  it("returns partial and unknown outcomes and reconciles markers before explicit retries", async () => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["value"], fieldId: 1 }], evidence: "any", auditNote: "Audit" });
    const plan = await sink.plan(input({ value: "ours" }));
    state.failure = "unknown-note";
    const partial = await sink.apply(plan); expect(partial.status).toBe("partial"); expect(partial.outcomes.map((outcome) => outcome.status)).toEqual(["applied", "unknown"]);
    const marker = plan.marker; state.notes.push({ id: 1, note: `Audit [${marker}]` });
    state.failure = undefined;
    const retried = await sink.apply(plan); expect(retried.outcomes.map((outcome) => outcome.status)).toEqual(["skipped", "skipped"]);
    expect(state.writes).toHaveLength(2);
  });

  it("checks reciprocal documentlink values, target permissions and self-links", async () => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["related"], fieldId: 9 }], evidence: "any" });
    expect((await sink.plan(input({ related: [42] }))).blocked.some((issue) => issue.reason.includes("self"))).toBe(true);
    state.targetChange = false;
    expect((await sink.plan(input({ related: [44] }))).blocked.some((issue) => issue.reason.includes("permission"))).toBe(true);
    state.targetChange = true; state.targetValues.set(9, [99]);
    expect((await sink.plan(input({ related: [44] }))).blocked.some((issue) => issue.reason.includes("nonempty"))).toBe(true);
    state.targetValues.clear(); const plan = await sink.plan(input({ related: [44] })); state.targetValues.set(9, [99]);
    expect((await sink.apply(plan)).outcomes[0]).toMatchObject({ status: "skipped", reason: expect.stringContaining("nonempty") });
    expect(state.writes).toEqual([]);
  });

  it("retains prior outcomes when cancellation stops a later operation", async () => {
    const { state, connection, input } = await fixture(); const controller = new AbortController();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["a"], fieldId: 1 }, { path: ["b"], fieldId: 2 }], evidence: "any" });
    const plan = await sink.plan(input({ a: "first", b: "second" }));
    let afterFirstReads = 0; state.before = (request) => { if (request.method === "GET" && state.writes.length === 1 && ++afterFirstReads === 2) controller.abort(new Error("stop after first")); };
    const applied = await sink.apply(plan, { signal: controller.signal });
    expect(applied.status).toBe("cancelled"); expect(applied.outcomes[0]?.status).toBe("applied"); expect(applied.outcomes).toHaveLength(2);
  });

  it("normalizes numeric monetary values to the native string representation and keeps literal dotted paths separate", async () => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["money.amount"], fieldId: 8 }], evidence: "any" });
    const extracted = { ...input({ "money.amount": 12.3, money: { amount: 99 } }), extraction: { ...result({ "money.amount": 12.3, money: { amount: 99 } }), conflicts: [{ path: "money.amount", values: [{ value: 99, pages: [1] }, { value: 100, pages: [2] }] }] } };
    const plan = await sink.plan(extracted);
    expect(plan.blocked).toEqual([]); expect(plan.operations[0]).toMatchObject({ path: "`money.amount`", value: "12.3" });
    expect((await sink.apply(plan)).outcomes[0]?.status).toBe("applied"); expect(state.values.get(8)).toBe("12.3");
  });

  it.each(["deny", "rate-limit", "mismatch"] as const)("returns honest %s outcomes without blind retries", async (failure) => {
    const { state, connection, input } = await fixture();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["value"], fieldId: 1 }], evidence: "any" });
    const plan = await sink.plan(input({ value: "ours" })); state.failure = failure;
    const applied = await sink.apply(plan);
    expect(applied.status).toBe("partial"); expect(applied.outcomes[0]?.status).toBe(failure === "mismatch" ? "unknown" : "failed"); expect(state.writes).toHaveLength(1);
  });

  it("retains cancellation status when the final submitted operation cannot finish read-back", async () => {
    const { state, connection, input } = await fixture(); const controller = new AbortController();
    const sink = new PaperlessSink({ ...connection, fields: [{ path: ["value"], fieldId: 1 }], evidence: "any" });
    const plan = await sink.plan(input({ value: "ours" }));
    state.before = (request) => { if (request.method === "GET" && state.writes.length === 1) controller.abort(new Error("cancel final read-back")); };
    const applied = await sink.apply(plan, { signal: controller.signal });
    expect(applied.status).toBe("cancelled"); expect(applied.outcomes).toHaveLength(1); expect(applied.outcomes[0]?.status).toBe("unknown"); expect(state.values.get(1)).toBe("ours");
  });
});
