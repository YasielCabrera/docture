import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "docture";
import { makeInvoicePdf } from "docture/testing/fixtures";
import { NapiCanvasRasterizer } from "../../../src/raster/canvas/index.js";

interface ObservedRender {
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly outcome: Promise<string>;
}

const observed: ObservedRender[] = [];
const hooks: { onRender?: () => void } = {};

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown> & {
    getDocument(options: unknown): { promise: Promise<object>; destroy(): Promise<void> };
  }>();
  const delegate = <T extends object>(target: T, overrides: Record<PropertyKey, unknown>): T =>
    new Proxy(target, {
      get(object, key) {
        if (key in overrides) return overrides[key];
        const value: unknown = Reflect.get(object, key);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  return {
    ...real,
    getDocument(options: unknown) {
      const task = real.getDocument(options);
      const promise = task.promise.then((pdf) =>
        delegate(pdf, {
          getPage: async (pageNumber: number) => {
            const page = await (pdf as { getPage(n: number): Promise<object> }).getPage(pageNumber);
            return delegate(page, {
              render: (params: unknown) => {
                const renderTask = (page as { render(p: unknown): { promise: Promise<void> } }).render(params);
                observed.push({
                  cancel: vi.spyOn(renderTask as unknown as { cancel(): void }, "cancel") as never,
                  outcome: renderTask.promise.then(
                    () => "rendered",
                    (error: unknown) => (error as { name?: string }).name ?? String(error),
                  ),
                });
                hooks.onRender?.();
                return renderTask;
              },
            });
          },
        }),
      );
      return { promise, destroy: () => task.destroy() };
    },
  };
});

afterEach(() => {
  observed.length = 0;
  delete hooks.onRender;
});

async function invoice() {
  const pdf = await makeInvoicePdf({ seed: 301 });
  return { bytes: pdf.bytes, mimeType: "application/pdf" };
}

describe("NapiCanvasRasterizer cancellation", () => {
  it("cancels the active PDF.js render task and rejects with the abort reason", async () => {
    const source = await invoice();
    const controller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    hooks.onRender = () => queueMicrotask(() => controller.abort(reason));

    await expect(
      new NapiCanvasRasterizer().rasterize(source, { dpi: 72, pages: [1] }, {
        signal: controller.signal,
        logger: silentLogger,
      }),
    ).rejects.toBe(reason);

    expect(observed).toHaveLength(1);
    expect(observed[0]!.cancel).toHaveBeenCalledTimes(1);
    expect(await observed[0]!.outcome).toBe("RenderingCancelledException");
  });

  it("removes its abort listener once the render completes", async () => {
    const source = await invoice();
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, "addEventListener");
    const removed = vi.spyOn(controller.signal, "removeEventListener");

    const pages = await new NapiCanvasRasterizer().rasterize(source, { dpi: 72, pages: [1] }, {
      signal: controller.signal,
      logger: silentLogger,
    });
    controller.abort();

    expect(pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(await observed[0]!.outcome).toBe("rendered");
    expect(observed[0]!.cancel).not.toHaveBeenCalled();
    const listeners = added.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener);
    expect(listeners).toHaveLength(1);
    expect(removed.mock.calls.filter(([type]) => type === "abort").map(([, listener]) => listener)).toEqual(listeners);
  });
});
