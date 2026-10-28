/**
 * `@docture/cli/mcp`: Docture's convert and inspect tools as a Model Context
 * Protocol server.
 *
 * ```ts
 * import { createMcpServer } from "@docture/cli/mcp";
 * import { processIo } from "@docture/cli";
 * import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *
 * const server = await createMcpServer({ io: processIo() });
 * await server.connect(new StdioServerTransport());
 * ```
 *
 * Needs the optional peer `@modelcontextprotocol/sdk`. The root `@docture/cli`
 * entry never loads it.
 */

export { createMcpServer } from "./server.js";
export type { McpServerOptions } from "./server.js";
export { ENGINE_RANGES } from "./engines.js";
