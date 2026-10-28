import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/conversion/sha256.js";

const reference = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe("portable SHA-256", () => {
  it.each([
    ["empty", ""],
    ["ASCII", "abc"],
    ["multi-byte Unicode", "Größe 漢字 😀"],
    ["55 bytes, one padded block", "a".repeat(55)],
    ["56 bytes, padding spills into a second block", "a".repeat(56)],
    ["64 bytes, one full block", "a".repeat(64)],
    ["long input", "Revenue grew 12%. ".repeat(10_000)],
  ])("matches node:crypto for %s", (_name, text) => {
    expect(sha256Hex(text)).toBe(reference(text));
  });

  it("matches the published digest of abc", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("imports no modules", async () => {
    const source = await readFile(new URL("../../src/core/conversion/sha256.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*(import|export .* from)\b/mu);
  });
});
