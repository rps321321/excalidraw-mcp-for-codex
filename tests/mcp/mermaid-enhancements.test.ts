import { describe, expect, it } from "vitest";

import {
  normalizeMermaidLayout,
  previewMermaidConversion,
} from "../../src/mcp/mermaid-enhancements.js";

describe("Mermaid enhancement helpers", () => {
  it("previews a Mermaid conversion with count, bounds, warnings, and suggested scale", async () => {
    const preview = await previewMermaidConversion({
      mermaidDiagram: "flowchart LR\n  A[Input] --> B[Process]\n  B --> C[Output]",
      targetWidth: 500,
      targetHeight: 260,
      padding: 20,
    });

    expect(preview.elementCount).toBe(5);
    expect(preview.bounds).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    expect(preview.warnings).toEqual([]);
    expect(preview.suggestedScale).toBeGreaterThan(0);
    expect(preview.suggestedScale).toBeLessThanOrEqual(3);
  });

  it("reports risk warnings for long labels and subgraphs", async () => {
    const preview = await previewMermaidConversion({
      mermaidDiagram: [
        "flowchart TB",
        "  subgraph Zone",
        "    A[This is a very long label that should trigger a readable bounds warning for the agent]",
        "  end",
      ].join("\n"),
    });

    expect(preview.warnings.some((warning) => warning.includes("Long label"))).toBe(true);
    expect(preview.warnings.some((warning) => warning.includes("Subgraphs"))).toBe(true);
  });

  it("normalizes layout into target bounds while preserving IDs and bindings", async () => {
    const result = await normalizeMermaidLayout({
      mermaidDiagram: "flowchart LR\n  A[Input] --> B[Output]",
      targetWidth: 360,
      targetHeight: 180,
      offsetX: 10,
      offsetY: 20,
      padding: 5,
    });

    expect(result.elements.find((element) => element.id === "A")).toMatchObject({
      type: "rectangle",
      label: { text: "Input" },
    });
    expect(result.elements.find((element) => element.id === "A_B")).toMatchObject({
      type: "arrow",
      startElementId: "A",
      endElementId: "B",
    });
    expect(result.files).toEqual({});
    expect(result.scale).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
    expect(result.bounds).not.toBeNull();
    expect(result.bounds!.x).toBeGreaterThanOrEqual(15);
    expect(result.bounds!.y).toBeGreaterThanOrEqual(25);
    expect(result.bounds!.width).toBeLessThanOrEqual(350);
    expect(result.bounds!.height).toBeLessThanOrEqual(170);
  });

  it("returns normalized metadata for direct MCP handler use", async () => {
    const result = await normalizeMermaidLayout({
      mermaidDiagram: "flowchart LR\n  A[One] --> B[Two]",
      targetWidth: 320,
      targetHeight: 160,
    });

    expect(result).toMatchObject({
      elements: expect.any(Array),
      files: {},
      bounds: expect.any(Object),
      warnings: [],
      scale: expect.any(Number),
    });
    expect(result.elements).toHaveLength(3);
  });
});
