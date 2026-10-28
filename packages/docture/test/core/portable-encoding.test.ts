import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { base64 } from "../../src/core/conversion/base64.js";
import { sha256Hex } from "../../src/core/conversion/sha256.js";

it.each([0, 1, 2, 3, 255, 256, 65536])("encodes %i arbitrary bytes as canonical base64", (length) => {
  const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 251) % 256);
  expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
});

it.each(["", "Pressure 😀\n東京", "a".repeat(1000)])("portable hashing retains SHA-256 UTF-8 identity", (value) => {
  expect(sha256Hex(value)).toBe(createHash("sha256").update(value).digest("hex"));
});
