import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeInvoicePdf } from "docture/testing/fixtures";

export async function runExample(output = new URL("./output/", import.meta.url)) {
  const fixture = await makeInvoicePdf({ seed: 7, lineItemCount: 3 });
  await mkdir(output, { recursive: true });
  await writeFile(new URL("invoice.pdf", output), fixture.bytes);
  await writeFile(new URL("expected.json", output), JSON.stringify(fixture.expected, null, 2));
  return { pages: fixture.pageCount, expected: fixture.expected, output: fileURLToPath(output) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await runExample(), null, 2));
