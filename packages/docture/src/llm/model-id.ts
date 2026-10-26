import type { LanguageModel } from "ai";

export function providerOf(model: LanguageModel): string {
  return typeof model === "string" ? "gateway" : model.provider;
}

/** A gateway model is a plain string; a provider instance carries `modelId`. */
export function modelIdOf(model: LanguageModel): string {
  if (typeof model === "string") return model;
  return (model as { readonly modelId?: string }).modelId ?? "unknown";
}
