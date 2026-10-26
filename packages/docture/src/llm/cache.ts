/**
 * Response caching.
 *
 * Two uses, both real: an eval that re-scores the same corpus should not pay for the
 * same completions twice, and a test suite that hits a live model should be
 * replayable offline.
 *
 * The key covers everything that could change the answer — model id, prompts, and
 * the JSON Schema. Leave any of those out and a schema change silently returns the
 * old shape.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RawUsage } from "./pricing.js";
import type { ProviderOptions } from "@ai-sdk/provider-utils";

/**
 * What goes into one user message.
 *
 * A `file` part, not the deprecated `image` part — same bytes, and the shape the AI
 * SDK carries forward. `VisionStrategy` sends pages the same way.
 */
export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly data: Uint8Array; readonly mediaType: string };

/**
 * A stable digest of the message content, for the cache key.
 *
 * Image bytes are hashed rather than embedded: the key must change when the picture
 * does, and a base64 page at 120 dpi is a bad thing to keep in memory just to name a
 * cache entry.
 */
export function fingerprint(content: readonly ContentPart[]): string {
  const hash = createHash("sha256");
  for (const part of content) {
    if (part.type === "text") {
      hash.update("t:");
      hash.update(part.text);
    } else {
      hash.update("f:");
      hash.update(part.mediaType);
      hash.update(part.data);
    }
  }
  return hash.digest("hex");
}

export interface CachedResponse {
  readonly data: unknown;
  readonly usage: RawUsage;
}

export function storedUsage(raw: RawUsage): RawUsage {
  return {
    ...(raw.inputTokens === undefined ? {} : { inputTokens: raw.inputTokens }),
    ...(raw.outputTokens === undefined ? {} : { outputTokens: raw.outputTokens }),
    ...(raw.totalTokens === undefined ? {} : { totalTokens: raw.totalTokens }),
    ...(raw.inputTokenDetails === undefined ? {} : { inputTokenDetails: raw.inputTokenDetails }),
  };
}

export interface LlmCache {
  get(key: string): Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse): Promise<void>;
  clear?(): Promise<void>;
}

export interface CacheKeyParts {
  readonly provider: string;
  readonly providerOptions?: ProviderOptions;
  readonly modelId: string;
  readonly temperature: number | undefined;
  readonly system: string;
  readonly prompt: string;
  readonly jsonSchema: unknown;
  /** Distinguishes a vision request from a text one over the same page. */
  readonly variant?: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  const hash = createHash("sha256");
  hash.update(parts.provider);
  hash.update("\0");
  hash.update(parts.modelId);
  hash.update("\0");
  hash.update(String(parts.temperature ?? 0));
  hash.update("\0");
  hash.update(parts.system);
  hash.update("\0");
  hash.update(parts.prompt);
  hash.update("\0");
  hash.update(JSON.stringify(parts.jsonSchema));
  hash.update("\0");
  hash.update(parts.variant ?? "");
  if (parts.providerOptions !== undefined && Object.keys(parts.providerOptions).length > 0) {
    hash.update("\0providerOptions\0");
    hash.update(JSON.stringify(parts.providerOptions, (_key, value: unknown) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value));
  }
  return hash.digest("hex");
}

/** Bounded in-process cache. Enough for one eval run. */
export function memoryCache(maxEntries = 500): LlmCache {
  const entries = new Map<string, CachedResponse>();
  return {
    async get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        // Refresh recency: re-inserting moves the key to the end of the Map order.
        entries.delete(key);
        entries.set(key, value);
      }
      return value === undefined ? undefined : structuredClone(value);
    },
    async set(key, value) {
      entries.delete(key);
      entries.set(key, structuredClone(value));
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    async clear() {
      entries.clear();
    },
  };
}

/**
 * Disk cache, one JSON file per key, sharded two levels deep.
 *
 * Sharded because a flat directory of tens of thousands of files is slow to list on
 * every filesystem that matters.
 */
export function fileCache(root: string): LlmCache {
  const pathFor = (key: string): string => join(root, key.slice(0, 2), key.slice(2, 4), `${key}.json`);

  return {
    async get(key) {
      try {
        const raw = await readFile(pathFor(key), "utf8");
        return JSON.parse(raw) as CachedResponse;
      } catch {
        // A missing or corrupt entry is a miss, never an error: a broken cache must
        // not be able to fail a run.
        return undefined;
      }
    },
    async set(key, value) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value), "utf8");
    },
  };
}
