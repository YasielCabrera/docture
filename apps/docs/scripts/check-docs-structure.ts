import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { LegacyDoc } from "../lib/legacy-destination.js";

const metaSchema = z.object({ pages: z.array(z.string()), root: z.boolean().optional(), pagesIndex: z.string().optional() });

const areas = ["getting-started", "extraction", "conversion", "evaluation", "synthetic", "cli", "integrations", "resources"];

export async function checkDocsStructure(root: string, routes: ReadonlyMap<string, ReadonlySet<string>>, migration: ReadonlyMap<string, LegacyDoc>): Promise<string[]> {
  const failures: string[] = [];
  const rootMeta = metaSchema.parse(JSON.parse(await readFile(join(root, "meta.json"), "utf8")));
  if (rootMeta.pages.filter((page) => areas.includes(page)).join() !== areas.join()) failures.push("Documentation areas must follow the agreed order.");
  for (const area of areas) {
    const meta = metaSchema.parse(JSON.parse(await readFile(join(root, area, "meta.json"), "utf8")));
    if (meta.root !== false) failures.push(`${area}: explicitly disable section roots to keep the shared sidebar`);
  }
  async function visit(directory: string, top: boolean): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    const meta = metaSchema.parse(JSON.parse(await readFile(join(directory, "meta.json"), "utf8")));
    if (!top && meta.root === true) failures.push(`${directory}: sidebar roots replace the shared documentation tree`);
    if (!top && entries.some((entry) => entry.name === "index.mdx") && meta.pagesIndex !== "index") failures.push(`${directory}: link the section heading to its introduction with pagesIndex`);
    const listed = meta.pages.filter((page) => !page.startsWith("---"));
    if (new Set(listed).size !== listed.length) failures.push(`${directory}: navigation repeats a page`);
    const navigation = [...listed, ...meta.pagesIndex === undefined ? [] : [meta.pagesIndex]];
    if (meta.pagesIndex !== undefined && listed.includes(meta.pagesIndex)) failures.push(`${directory}: section introduction must appear only on the section link`);
    const actual = entries.filter((entry) => entry.isDirectory() || entry.name.endsWith(".mdx")).map((entry) => entry.name.replace(/\.mdx$/, ""));
    for (const name of actual) if (!navigation.includes(name)) failures.push(`${directory}: page or folder is missing from navigation: ${name}`);
    for (const name of navigation) if (!actual.includes(name)) failures.push(`${directory}: navigation points to a missing page or folder: ${name}`);
    for (const entry of entries) if (entry.isDirectory()) await visit(join(directory, entry.name), false);
  }
  await visit(root, true);
  for (const [old, entry] of migration) {
    if (routes.has(old)) failures.push(`Legacy route shadows a canonical page: ${old}`);
    for (const target of [entry.to, ...Object.values(entry.anchors)]) {
      const [path, anchor] = target.split("#", 2);
      const page = path === undefined ? undefined : routes.get(path);
      if (page === undefined) failures.push(`${old}: migration destination is missing: ${target}`);
      else if (anchor !== undefined && !page.has(anchor)) failures.push(`${old}: migration anchor is missing: ${target}`);
    }
  }
  return failures;
}
