import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Write a file so readers see either the old or the new content, never a partial one. Creates parent directories. */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Rewrites one artifact during a run without writing more often than `intervalMs`. */
export interface LiveArtifact {
  /** Schedule a rewrite with the latest content. Calls inside the interval coalesce into one write. */
  update(render: () => string): void;
  /** Write the final content now and wait for every pending write. Rejects with the first write failure. */
  finish(content: string): Promise<void>;
}

/** Create a throttled atomic writer for an artifact that is rewritten while a run progresses. */
export function liveArtifact(path: string, options: { readonly intervalMs?: number } = {}): LiveArtifact {
  const intervalMs = options.intervalMs ?? 1000;
  let latest: (() => string) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = 0;
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown;
  const enqueue = (content: () => string): void => {
    chain = chain
      .then(() => writeFileAtomic(path, content()))
      .catch((error: unknown) => {
        failure ??= error;
      });
  };

  const flush = (): void => {
    timer = undefined;
    const render = latest;
    latest = undefined;
    if (!render) return;
    lastWrite = Date.now();
    enqueue(render);
  };

  return {
    update(render) {
      latest = render;
      if (timer) return;
      timer = setTimeout(flush, Math.max(0, lastWrite + intervalMs - Date.now()));
      timer.unref?.();
    },
    async finish(content) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      latest = undefined;
      enqueue(() => content);
      await chain;
      if (failure !== undefined) throw failure;
    },
  };
}
