/**
 * `--model openai/gpt-5` → an AI SDK `LanguageModel`.
 *
 * In a script you write `openai("gpt-5")` and the import says which provider you
 * meant. A command line has no imports, so this has to decide — and the one thing
 * it must not do is decide silently.
 *
 * The rule, in full:
 *
 *   1. `--gateway` → the string goes to the AI SDK untouched, which routes it
 *      through the Vercel AI Gateway.
 *   2. Otherwise, if the provider's package resolves **from the working
 *      directory**, import it and build the model with it. Your project's provider,
 *      your project's version, your project's credentials.
 *   3. Otherwise, the gateway again — and if no gateway credential is set either,
 *      that is a warning on stderr before the first request, not a 401 after it.
 *
 * Which of the three happened is reported by {@link ResolvedModel.via}, and the CLI
 * prints it under `--verbose`.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LanguageModel } from "ai";
import { UsageError } from "./cli/errors.js";

export interface ResolvedModel {
  readonly model: LanguageModel;
  /** The spec as given, e.g. `openai/gpt-5`. */
  readonly id: string;
  /** `@ai-sdk/openai`, or `AI Gateway`. */
  readonly via: string;
  /** A likely misconfiguration, worth saying out loud before spending money. */
  readonly warning?: string;
}

const GATEWAY = "AI Gateway";

/**
 * Providers whose package name or export does not follow from the prefix.
 * Everything else derives: `mistral` → `@ai-sdk/mistral`, exporting `mistral`.
 */
const IRREGULAR: Readonly<Record<string, { readonly package: string; readonly export: string }>> = {
  bedrock: { package: "@ai-sdk/amazon-bedrock", export: "bedrock" },
  vertex: { package: "@ai-sdk/google-vertex", export: "vertex" },
  openrouter: { package: "@openrouter/ai-sdk-provider", export: "openrouter" },
};

/** `google-vertex` → `googleVertex`. The AI SDK's export-naming convention. */
function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function packageFor(provider: string): { readonly package: string; readonly export: string } {
  return IRREGULAR[provider] ?? { package: `@ai-sdk/${provider}`, export: camelCase(provider) };
}

/**
 * Import a provider package as the WORKING DIRECTORY would see it.
 *
 * `import()` here would resolve against this file, which under pnpm means the
 * CLI's own dependencies — not the user's. Resolving through a `require` rooted at
 * the cwd is what makes `docture` installed in a project use that project's
 * provider. The plain import is kept as a fallback for a globally-installed CLI
 * that happens to be able to see one.
 */
async function importFrom(cwd: string, specifier: string): Promise<Record<string, unknown>> {
  try {
    const resolved = createRequire(join(cwd, "__docture__.js")).resolve(specifier);
    return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  } catch {
    return (await import(specifier)) as Record<string, unknown>;
  }
}

/** Providers read a key from the environment; these are the usual names. */
const KEY_ENV: Readonly<Record<string, readonly string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  cohere: ["COHERE_API_KEY"],
  perplexity: ["PERPLEXITY_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  togetherai: ["TOGETHER_AI_API_KEY"],
  deepinfra: ["DEEPINFRA_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

const GATEWAY_ENV = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

export interface ResolveModelOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Force route 1. */
  readonly gateway?: boolean;
}

export async function resolveModel(
  spec: string,
  options: ResolveModelOptions,
): Promise<ResolvedModel> {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new UsageError("--model needs a value, e.g. openai/gpt-5.");
  }

  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    throw new UsageError(
      `--model must be <provider>/<model-id>, got "${trimmed}".`,
      "For example: openai/gpt-5, anthropic/claude-opus-5, google/gemini-2.5-pro.",
    );
  }

  const provider = trimmed.slice(0, slash);
  // Not `slice(slash + 1).split("/")[0]`: several providers serve model ids that
  // themselves contain a slash, and the id is everything after the first one.
  const modelId = trimmed.slice(slash + 1);

  if (options.gateway === true) {
    return { model: trimmed, id: trimmed, via: GATEWAY, ...gatewayWarning(options.env, trimmed) };
  }

  const target = packageFor(provider);
  let module: Record<string, unknown> | undefined;
  try {
    module = await importFrom(options.cwd, target.package);
  } catch {
    module = undefined;
  }

  if (module === undefined) {
    return {
      model: trimmed,
      id: trimmed,
      via: GATEWAY,
      ...gatewayWarning(options.env, trimmed, target.package),
    };
  }

  const factory = pickFactory(module, target.export);
  if (factory === undefined) {
    throw new UsageError(
      `"${target.package}" is installed but exports no "${target.export}" provider.`,
      "Wire the model yourself in docture.config.ts, or pass --gateway.",
    );
  }

  const model = factory(modelId);
  const missingKey = (KEY_ENV[provider] ?? []).filter((name) => options.env[name] === undefined);
  const warning =
    missingKey.length === 0
      ? undefined
      : `${missingKey.join(" / ")} is not set — ${target.package} will have no credential.`;

  return {
    model,
    id: trimmed,
    via: target.package,
    ...(warning === undefined ? {} : { warning }),
  };
}

/**
 * The provider factory: the conventional export, then `default`, then — only if
 * there is exactly one callable export — that. Anything looser would call a random
 * function with a model id.
 */
function pickFactory(
  module: Record<string, unknown>,
  name: string,
): ((id: string) => LanguageModel) | undefined {
  const candidates = [module[name], module["default"]];
  for (const candidate of candidates) {
    if (typeof candidate === "function") return candidate as (id: string) => LanguageModel;
  }
  const callable = Object.entries(module).filter(([, value]) => typeof value === "function");
  const only = callable[0];
  if (callable.length === 1 && only !== undefined) {
    return only[1] as (id: string) => LanguageModel;
  }
  return undefined;
}

function gatewayWarning(
  env: Readonly<Record<string, string | undefined>>,
  spec: string,
  missingPackage?: string,
): { warning?: string } {
  if (GATEWAY_ENV.some((name) => env[name] !== undefined)) return {};
  const because =
    missingPackage === undefined ? "" : ` (${missingPackage} is not installed here)`;
  return {
    warning:
      `"${spec}" will go through the AI Gateway${because}, and neither ` +
      `${GATEWAY_ENV.join(" nor ")} is set.`,
  };
}
