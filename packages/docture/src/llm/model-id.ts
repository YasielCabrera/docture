import type { LanguageModel } from "ai";

/** A gateway model is a plain string; a provider instance carries `modelId`. */
export function modelIdOf(model: LanguageModel): string {
  if (typeof model === "string") return model;
  return (model as { readonly modelId?: string }).modelId ?? "unknown";
}
