import { generateText, Output, type LanguageModel, type ModelMessage } from "ai";
import { asSchema, type FlexibleSchema, type ProviderOptions } from "@ai-sdk/provider-utils";
import type { Usage } from "../core/index.js";
import { storedUsage, type LlmCache } from "./cache.js";
import { modelOutputError } from "./failure.js";
import { toUsage, type PricingTable } from "./pricing.js";
import type { ConversationMessage } from "./repair.js";
import type { CallTelemetry } from "./telemetry.js";

export interface ObjectRequest {
  readonly model: LanguageModel;
  readonly modelId: string;
  readonly schema: FlexibleSchema<unknown>;
  readonly system: string;
  readonly input: { readonly prompt: string } | { readonly messages: readonly ConversationMessage[] };
  readonly cache: LlmCache | undefined;
  readonly key: string;
  readonly temperature: number | undefined;
  readonly maxRetries: number | undefined;
  readonly providerOptions: ProviderOptions | undefined;
  readonly pricing: PricingTable | undefined;
  readonly signal: AbortSignal;
  /** When the surrounding operation started, for the wall time of a failed response. */
  readonly startedAt: number;
  readonly telemetry: CallTelemetry;
  /**
   * When set, the cache keeps `rawOf(output)`, the response before validation, and a
   * hit is validated again with `schema`, so it is checked exactly like a fresh answer.
   */
  readonly rawOf?: (output: unknown) => unknown;
}

export interface ObjectResponse {
  readonly data: unknown;
  readonly usage: Partial<Usage>;
}

/** Throws `ModelOutputError` with its usage when the response does not fit the schema. */
export async function requestObject(request: ObjectRequest): Promise<ObjectResponse> {
  const cached = await request.cache?.get(request.key);
  if (cached !== undefined) {
    if (request.rawOf === undefined) return { data: cached.data, usage: toUsage(cached.usage, 0) };
    const validated = await asSchema(request.schema).validate?.(cached.data);
    if (validated?.success === true) return { data: validated.value, usage: toUsage(cached.usage, 0) };
  }

  request.signal.throwIfAborted();
  const requestStarted = Date.now();
  const input = "prompt" in request.input
    ? { prompt: request.input.prompt }
    : { messages: request.input.messages.map((message): ModelMessage => ({ ...message })) };
  const response = await generateText({
    model: request.model,
    output: Output.object({ schema: request.schema }),
    system: request.system,
    ...input,
    temperature: request.temperature ?? 0,
    maxRetries: request.maxRetries ?? 2,
    abortSignal: request.signal,
    telemetry: request.telemetry.telemetry,
    runtimeContext: request.telemetry.runtimeContext,
    ...(request.providerOptions === undefined ? {} : { providerOptions: request.providerOptions }),
  }).catch((error: unknown) => {
    throw modelOutputError(error, {
      modelId: request.modelId,
      pricing: request.pricing,
      wallMs: Date.now() - request.startedAt,
    });
  });

  await request.cache?.set(request.key, {
    data: request.rawOf === undefined ? response.output : request.rawOf(response.output),
    usage: storedUsage(response.usage),
  });
  return {
    data: response.output,
    usage: toUsage(response.usage, Date.now() - requestStarted, request.modelId, request.pricing),
  };
}
