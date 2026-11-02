import { MissingEngineError } from "docture";

/** Supported optional engine of this entry. */
export const ENGINE_RANGES = { ai: "^7.0.0" } as const;

export async function loadAi(): Promise<typeof import("ai")> {
  try {
    return await import("ai");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND" && /^Cannot find package 'ai' imported from /u.test(error.message)) {
      throw new MissingEngineError("ai", ENGINE_RANGES.ai, "@docture/synthetic/llm", { cause: error });
    }
    throw error;
  }
}
