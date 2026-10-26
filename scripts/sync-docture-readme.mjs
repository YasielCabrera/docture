import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function generatedReadme(root) {
  return readFileSync(resolve(root, "README.md"), "utf8").replace(
    /(!?\[[^\]]*\]\()([^\s)]+)(\))/g,
    (whole, prefix, target, suffix) => {
      if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) return whole;
      const [path] = target.split(/[?#]/);
      let kind = "blob";
      try { if (statSync(resolve(root, path)).isDirectory()) kind = "tree"; } catch {}
      return prefix + "https://github.com/YasielCabrera/docture/" + kind + "/main/" + target.replace(/^\.\//, "") + suffix;
    },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf("--root");
  const root = flag < 0 ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(process.argv[flag + 1]);
  const target = resolve(root, "packages/docture/README.md");
  const output = generatedReadme(root);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output) throw Error("Package README is stale. Run node scripts/sync-docture-readme.mjs");
  } else {
    writeFileSync(target, output);
  }
}
