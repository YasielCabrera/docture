export const ENGINE_RANGES = {
  "@modelcontextprotocol/sdk": "1.32.2",
} as const;

export type Engine = keyof typeof ENGINE_RANGES;

/** Load the SDK, turning its absence into an install hint rather than a resolver error. */
export async function importEngine<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ERR_MODULE_NOT_FOUND"
      ? /^Cannot find package '([^']+)' imported from /.exec(error.message)?.[1]
      : undefined;
    const engine = Object.keys(ENGINE_RANGES).find((name): name is Engine => name === missing);
    if (engine === undefined) throw error;
    const { MissingEngineError } = await import("docture");
    throw new MissingEngineError(engine, ENGINE_RANGES[engine], "@docture/cli/mcp", { cause: error });
  }
}
