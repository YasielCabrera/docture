/**
 * AI SDK telemetry for every model call docture makes.
 *
 * Each call carries a fixed `functionId` (`docture.<stage>.<component>`) and a
 * `docture` runtime-context entry naming the document, pages and chunk it covered.
 * Documents are often sensitive, so `recordInputs` and `recordOutputs` default to
 * `false`. They are flags each integration honours; the AI SDK still hands prompts
 * and answers to integration callbacks.
 */

import type { TelemetryOptions } from "ai";

export interface LlmTelemetryOptions
  extends Pick<TelemetryOptions, "isEnabled" | "recordInputs" | "recordOutputs" | "integrations"> {
  /** Recorded on every call next to docture's own `docture` entry. */
  readonly runtimeContext?: Readonly<Record<string, unknown>>;
  /** Default `true`. `false` keeps the source file name out of telemetry. */
  readonly documentLabel?: boolean;
}

export type TelemetryStage = "extract" | "vision" | "classify" | "layout" | "split" | "repair";

export interface TelemetryScope {
  readonly stage: TelemetryStage;
  readonly component: string;
  readonly document?: string | undefined;
  readonly pages?: readonly number[];
  readonly chunk?: number;
}

export interface CallTelemetry {
  readonly telemetry: TelemetryOptions;
  readonly runtimeContext: Record<string, unknown>;
}

export function callTelemetry(options: LlmTelemetryOptions | undefined, scope: TelemetryScope): CallTelemetry {
  const document = options?.documentLabel === false ? undefined : scope.document;
  const runtimeContext: Record<string, unknown> = {
    ...options?.runtimeContext,
    docture: {
      stage: scope.stage,
      component: scope.component,
      ...(document === undefined ? {} : { document }),
      ...(scope.pages === undefined ? {} : { pages: [...scope.pages] }),
      ...(scope.chunk === undefined ? {} : { chunk: scope.chunk }),
    },
  };
  return {
    runtimeContext,
    telemetry: {
      functionId: `docture.${scope.stage}.${scope.component}`,
      recordInputs: options?.recordInputs ?? false,
      recordOutputs: options?.recordOutputs ?? false,
      includeRuntimeContext: Object.fromEntries(Object.keys(runtimeContext).map((key) => [key, true])),
      ...(options?.isEnabled === undefined ? {} : { isEnabled: options.isEnabled }),
      ...(options?.integrations === undefined ? {} : { integrations: options.integrations }),
    },
  };
}
