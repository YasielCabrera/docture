import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "docture";

describe("bounded concurrent mapping", () => {
  it("keeps undefined input values and returns results in input order", async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let count = 0;
    const task = mapWithConcurrency([undefined, 7], 2, async (value, index) => {
      if (++count === 2) started.resolve();
      await (index === 0 ? first.promise : second.promise);
      return value === undefined ? "absent" : String(value);
    });
    await started.promise;
    second.resolve();
    first.resolve();
    expect(await task).toEqual(["absent", "7"]);
  });

  it("retains the first failure and observes an aborted sibling before returning", async () => {
    const first = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const started: number[] = [];
    const drained: number[] = [];
    const task = mapWithConcurrency([0,1,2,3], 2, async (index, _position, signal) => {
      started.push(index);
      if (index === 0) {
        await first.promise;
        throw new Error("first failure");
      }
      secondStarted.resolve();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => { drained.push(index); reject(new Error("sibling stopped")); }, { once: true });
      });
    });
    const result = task.catch((error: unknown) => error);
    await secondStarted.promise;
    first.resolve();
    expect(await result).toMatchObject({ message: "first failure" });
    expect(started).toEqual([0,1]);
    expect(drained).toEqual([1]);
  });

  it("rejects invalid concurrency and honors an already aborted caller", async () => {
    for (const concurrency of [0, -1, 1.5, Infinity]) {
      await expect(mapWithConcurrency([1], concurrency, async (value) => value))
        .rejects.toThrow("concurrency must be a positive integer");
    }
    const caller = new AbortController();
    caller.abort(new DOMException("cancelled", "AbortError"));
    let calls = 0;
    await expect(mapWithConcurrency([1], 1, async (value) => { calls += 1; return value; }, caller.signal))
      .rejects.toMatchObject({ name: "AbortError", message: "cancelled" });
    expect(calls).toBe(0);
  });
});
