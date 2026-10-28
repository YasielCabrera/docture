import { afterEach, expect, it, vi } from "vitest";
import { errorCodeOf, resolveSource } from "docture";

afterEach(() => vi.unstubAllGlobals());

it.each(["request", "body"])("maps an HTTP %s failure to a typed source error with its cause", async (stage) => {
  const cause = new TypeError("connection lost");
  const fetcher = stage === "request"
    ? vi.fn().mockRejectedValue(cause)
    : vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => { throw cause; } });
  vi.stubGlobal("fetch", fetcher);
  const failure: unknown = await resolveSource("https://example.test/document.pdf").catch((error: unknown) => error);
  expect(errorCodeOf(failure)).toBe("UNSUPPORTED_SOURCE");
  expect(failure).toMatchObject({ cause, message: expect.stringContaining("https://example.test/document.pdf") });
});

it("preserves the caller's cancellation reason through source resolution", async () => {
  const abort = new DOMException("cancelled by caller", "AbortError");
  const controller = new AbortController();
  controller.abort(abort);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
  await expect(resolveSource("https://example.test/document.pdf", controller.signal)).rejects.toBe(abort);
});
