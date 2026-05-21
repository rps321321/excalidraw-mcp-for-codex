import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createExcalidrawMcpServer, TOOL_NAMES } from "../../src/mcp/index.js";

describe("MCP tool registration", () => {
  it("registers the required Excalidraw tools", () => {
    const server = createExcalidrawMcpServer();
    const registeredTools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;

    expect(Object.keys(registeredTools).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("lists tools through a real MCP client transport", async () => {
    const server = createExcalidrawMcpServer();
    const client = new Client({ name: "excalidraw-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();

      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    } finally {
      await client.close();
      await server.close();
    }
  });
});
