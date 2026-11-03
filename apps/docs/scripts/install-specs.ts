import core from "../../../packages/docture/package.json" with { type: "json" };
import cli from "../../../packages/cli/package.json" with { type: "json" };
import evaluation from "../../../packages/eval/package.json" with { type: "json" };
import synthetic from "../../../packages/synthetic/package.json" with { type: "json" };

const published = new Set([core.name, cli.name, evaluation.name, synthetic.name]);
export const installRanges = new Map<string, string>();
for (const manifest of [core, cli, evaluation, synthetic]) {
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (published.has(name)) continue;
    const existing = installRanges.get(name);
    if (existing !== undefined && existing !== range) throw new Error(`Conflicting documented peer requirements for ${name}: ${existing} and ${range}`);
    installRanges.set(name, range);
  }
}

export function preferredInstallSpec(name: string, range: string | undefined = installRanges.get(name)): string {
  if (range === undefined) return name;
  if (/^>=\d+$/.test(range)) return name;
  const branch = range.split(/\s*\|\|\s*/).at(-1) ?? range;
  const major = /^\^([1-9]\d*)\.0\.0$/.exec(branch)?.[1];
  if (major !== undefined) return `${name}@${major}`;
  const interval = /^>=(\d+)\.\d+\.\d+ <(\d+)\.0\.0$/.exec(branch);
  if (interval !== null && Number(interval[2]) - Number(interval[1]) > 1) return `${name}@${Number(interval[2]) - 1}`;
  return `${name}@${branch}`;
}

function packageName(specifier: string): string {
  const unquoted = specifier.replace(/^(['"])(.*)\1$/, "$2");
  const at = unquoted.indexOf("@", unquoted.startsWith("@") ? 1 : 0);
  return at === -1 ? unquoted : unquoted.slice(0, at);
}

function shellSpec(specifier: string): string {
  return /[\s<>|]/.test(specifier) ? `'${specifier}'` : specifier;
}

export function supportedInstallCommands(source: string): string {
  return source.replace(/^(\s*npm (?:install|i)\b)([^\n]*)/gm, (_match, command: string, argumentsText: string) => {
    const argumentsList = argumentsText.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
    const syntheticModel = argumentsList.some((argument) => packageName(argument) === "@docture/synthetic");
    const rewritten = argumentsList.map((argument) => {
      const name = packageName(argument);
      const range = name === "zod" && syntheticModel ? "^4.2.0" : installRanges.get(name);
      return range === undefined ? argument : shellSpec(preferredInstallSpec(name, range));
    });
    return `${command}${rewritten.length > 0 ? ` ${rewritten.join(" ")}` : ""}`;
  });
}
