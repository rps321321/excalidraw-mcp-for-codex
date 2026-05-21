import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { convertMermaidToElementInputs } from "../../src/mcp/mermaid.js";
import { registerExcalidrawTools } from "../../src/mcp/tools.js";
import { SceneStore } from "../../src/shared/state.js";
import type { ExcalidrawRuntime } from "../../src/mcp/runtime.js";

describe("Mermaid conversion", () => {
  it("converts a Mermaid flowchart into editable Excalidraw element inputs", async () => {
    const result = await convertMermaidToElementInputs(
      "flowchart LR\n  A[Input] --> B[Process]\n  B --> C[Output]",
    );

    expect(result.elements).toHaveLength(5);
    expect(result.elements.find((element) => element.id === "A")).toMatchObject({
      type: "rectangle",
      label: { text: "Input" },
    });
    expect(result.elements.find((element) => element.id === "A_B")).toMatchObject({
      type: "arrow",
      startElementId: "A",
      endElementId: "B",
    });
  });

  it("wires create_from_mermaid through the MCP tool handler and scene store", async () => {
    const store = new SceneStore({
      idFactory: (prefix = "el") => `${prefix}_generated`,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    const tools = registerToolsForTest(store);

    const result = await tools.create_from_mermaid({
      mermaidDiagram: "flowchart LR\n  A[Input] --> B[Output]",
      mode: "replace",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      implemented: true,
      created: 3,
      total: 3,
    });
    expect(store.describe().elements.find((element) => element.id === "A_B")?.connections).toEqual({
      start: "A",
      end: "B",
    });
  });
});

function registerToolsForTest(store: SceneStore): Record<string, (args: Record<string, unknown>) => Promise<CallToolResult>> {
  const tools: Record<string, (args: Record<string, unknown>) => Promise<CallToolResult>> = {};
  const server = {
    registerTool(name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<CallToolResult>) {
      tools[name] = handler;
    },
  } as unknown as McpServer;
  const runtime: ExcalidrawRuntime = {
    getStore: async () => store,
    ensureCanvas: async () => {
      throw new Error("Canvas is not needed for this test.");
    },
    getCanvas: () => undefined,
    broadcastScene: async () => {},
    close: async () => {},
  };

  registerExcalidrawTools(server, runtime);
  return tools;
}
