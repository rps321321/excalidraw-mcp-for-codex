#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime, type ExcalidrawRuntime } from "./runtime.js";
import { registerExcalidrawTools } from "./tools.js";

export function createExcalidrawMcpServer(runtime: ExcalidrawRuntime = createRuntime()): McpServer {
  const server = new McpServer(
    {
      name: "excalidraw-mcp-for-codex",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerExcalidrawTools(server, runtime);
  return server;
}

export async function main(): Promise<void> {
  const runtime = createRuntime();
  const server = createExcalidrawMcpServer(runtime);
  const transport = new StdioServerTransport();

  const close = async () => {
    await runtime.close();
    await server.close();
  };

  process.once("SIGINT", () => {
    void close().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}

function isEntrypoint(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isEntrypoint()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Excalidraw MCP server failed: ${message}`);
    process.exit(1);
  });
}

export { registerExcalidrawTools, TOOL_NAMES } from "./tools.js";
export type { ExcalidrawRuntime, SceneStoreLike } from "./runtime.js";
