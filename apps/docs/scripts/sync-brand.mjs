import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const docs = new URL("../", import.meta.url);
const brand = new URL("../../brand/", docs);
const check = process.argv.includes("--check");

if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/sync-brand.mjs [--check]");
}

const assets = [
  ["logos/horizontal/docture-horizontal-primary.svg", "public/brand/docture-horizontal-primary.svg"],
  ["logos/horizontal/docture-horizontal-on-dark.svg", "public/brand/docture-horizontal-on-dark.svg"],
  ["tokens/brand.css", "app/brand.css"],
  ["tokens/brand.json", "lib/brand.json"],
  ["favicons/favicon.svg", "app/icon.svg"],
  ["favicons/favicon.ico", "app/favicon.ico"],
  ["favicons/apple-touch-icon.png", "app/apple-icon.png"],
  ["favicons/android-chrome-192x192.png", "public/brand/android-chrome-192x192.png"],
  ["favicons/android-chrome-512x512.png", "public/brand/android-chrome-512x512.png"],
  ["favicons/maskable-icon-512x512.png", "public/brand/maskable-icon-512x512.png"],
  ["favicons/mask-icon.svg", "public/brand/mask-icon.svg"],
  ["social/open-graph-light.png", "app/opengraph-image.png"],
];

const outputs = await Promise.all(
  assets.map(async ([source, destination]) => ({
    destination,
    content: await readFile(new URL(source, brand)),
  })),
);

const manifest = JSON.parse(await readFile(new URL("favicons/site.webmanifest", brand), "utf8"));
manifest.display = "browser";
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `/brand/${icon.src}` }));
outputs.push(
  {
    destination: "app/manifest.webmanifest",
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
  },
  {
    destination: "app/opengraph-image.alt.txt",
    content: Buffer.from("docture. Structured data from documents. Built by Powerhouse.\n"),
  },
);

const stale = [];
for (const { destination, content } of outputs) {
  const target = new URL(destination, docs);
  if (check) {
    const existing = await readFile(target).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!existing?.equals(content)) stale.push(destination);
  } else {
    await mkdir(dirname(fileURLToPath(target)), { recursive: true });
    await writeFile(target, content);
  }
}

if (stale.length > 0) {
  throw new Error(`Brand assets differ from brand/:\n${stale.join("\n")}\nRun pnpm --filter @docture/docs brand:sync.`);
}

console.info(`${check ? "Verified" : "Synced"} ${outputs.length} Docture brand assets.`);
