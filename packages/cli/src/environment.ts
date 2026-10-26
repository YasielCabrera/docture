export const KEY_ENV: Readonly<Record<string, readonly string[]>> = {
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

export const GATEWAY_ENV = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

export const ENVIRONMENT: readonly (readonly [string, string])[] = [
  ["NO_COLOR", "Disable ANSI color on stdout and stderr"],
  ...[...new Set(Object.values(KEY_ENV).flat())].map(
    (name): readonly [string, string] => [name, "Credential for the locally installed model provider"],
  ),
  ["AI_GATEWAY_API_KEY", "AI Gateway credential when routing through the gateway"],
  ["VERCEL_OIDC_TOKEN", "Alternative AI Gateway credential"],
  ["OPENAI_BASE_URL", "Custom OpenAI-compatible endpoint; permits keyless local providers"],
];
