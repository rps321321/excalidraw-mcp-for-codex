import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  batchCreateElementsSchema,
  createFromMermaidSchema,
  importSceneSchema,
  MAX_ELEMENTS_PER_BATCH,
  MAX_IMPORT_DATA_LENGTH,
  MAX_MERMAID_LENGTH,
} from "../../src/shared/schemas.js";
import { createSessionToken, resolveWorkspacePath } from "../../src/shared/security.js";

describe("MCP validation and path safety", () => {
  it("caps batch size and large string payloads", () => {
    const elements = Array.from({ length: MAX_ELEMENTS_PER_BATCH + 1 }, (_, index) => ({
      id: `box-${index}`,
      type: "rectangle",
    }));

    expect(() => batchCreateElementsSchema.parse({ elements })).toThrow();
    expect(() => createFromMermaidSchema.parse({ mermaidDiagram: "x".repeat(MAX_MERMAID_LENGTH + 1) })).toThrow();
    expect(() => importSceneSchema.parse({ data: "x".repeat(MAX_IMPORT_DATA_LENGTH + 1) })).toThrow();
  });

  it("refuses paths outside the configured workspace", () => {
    const previousWorkspace = process.env.EXCALIDRAW_MCP_WORKSPACE;
    const root = mkdtempSync(path.join(os.tmpdir(), "excalidraw-mcp-"));
    process.env.EXCALIDRAW_MCP_WORKSPACE = root;

    try {
      expect(resolveWorkspacePath("exports/scene.excalidraw", "")).toBe(
        path.join(root, "exports", "scene.excalidraw"),
      );
      expect(() => resolveWorkspacePath("../outside.excalidraw", "")).toThrow(/outside workspace/);
    } finally {
      if (previousWorkspace === undefined) {
        delete process.env.EXCALIDRAW_MCP_WORKSPACE;
      } else {
        process.env.EXCALIDRAW_MCP_WORKSPACE = previousWorkspace;
      }
    }
  });

  it("creates high-entropy URL-safe session tokens", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(first).not.toBe(second);
  });
});
