import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { expandEmail } from "docture/inputs/email";
import { runExample } from "./index.js";

it("reads the real DOCX and email body and invoice attachment", async () => {
  const result = await runExample();
  expect(result.report).toContain("Quarterly report");
  expect(result.report).toContain("42");
  expect(result.email.map((part) => part.text)).toEqual([
    "Please find the supply invoice attached.\n",
    expect.stringContaining("INV-2026-0142"),
  ]);
  expect(result.email[1]?.text).toContain("$717.30");
});

it("preserves the exact approved PDF bytes in the persisted email", async () => {
  const email = await expandEmail({ bytes: await readFile(new URL("./invoice.eml", import.meta.url)), mimeType: "message/rfc822" });
  const attachment = email.parts.find((part) => part.kind === "attachment");
  expect(attachment?.document.bytes).toEqual(new Uint8Array(await readFile(new URL("./invoice.pdf", import.meta.url))));
});
