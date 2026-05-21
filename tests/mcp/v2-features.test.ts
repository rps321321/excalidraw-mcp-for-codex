import { describe, expect, it } from "vitest";
import { autoLayoutElements, polishScene } from "../../src/shared/auto-layout.js";
import { createRepoDiagram } from "../../src/shared/repo-diagrams.js";
import { createTemplateDiagram, DIAGRAM_TEMPLATE_KINDS } from "../../src/shared/templates.js";
import { lintScene } from "../../src/shared/quality.js";
import { SceneStore } from "../../src/shared/state.js";
import type { DiagramElement } from "../../src/shared/types.js";

function element(overrides: Partial<DiagramElement> & Pick<DiagramElement, "id" | "type">): DiagramElement {
  return {
    x: 0,
    y: 0,
    width: 180,
    height: 90,
    version: 1,
    updated: 1,
    backgroundColor: "transparent",
    strokeColor: "#1e1e1e",
    fillStyle: "hachure",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    locked: false,
    ...overrides,
    id: overrides.id,
    type: overrides.type,
  };
}

describe("v2 MCP feature helpers", () => {
  it("creates stable element sets for every built-in template", () => {
    for (const kind of DIAGRAM_TEMPLATE_KINDS) {
      const template = createTemplateDiagram({ kind });
      const ids = template.elements.flatMap((candidate) => candidate.id ? [candidate.id] : []);

      expect(template.elements.length).toBeGreaterThan(3);
      expect(new Set(ids).size).toBe(ids.length);
      expect(template.notes.length).toBeGreaterThan(0);
    }
  });

  it("prepares grid layout and arrow routing updates", () => {
    const elements = [
      element({ id: "a", type: "rectangle", x: 500, y: 20 }),
      element({ id: "b", type: "rectangle", x: 10, y: 20 }),
      element({ id: "c", type: "rectangle", x: 10, y: 20 }),
      element({ id: "a-to-c", type: "arrow", startElementId: "a", endElementId: "c", points: [[0, 0], [100, 80]] }),
    ];

    const layout = autoLayoutElements(elements, { mode: "grid", columns: 2 });
    const polish = polishScene(elements, { mode: "row" });

    expect(layout.moved).toBeGreaterThan(0);
    expect(layout.updates.map((update) => update.id)).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(polish.summary).toContain("Polish prepared");
  });

  it("uses Dagre to layer bound graph nodes", () => {
    const elements = [
      element({ id: "source", type: "rectangle", x: 500, y: 20 }),
      element({ id: "middle", type: "rectangle", x: 10, y: 20 }),
      element({ id: "target", type: "rectangle", x: 10, y: 20 }),
      element({ id: "source-to-middle", type: "arrow", startElementId: "source", endElementId: "middle", points: [[0, 0], [100, 80]] }),
      element({ id: "middle-to-target", type: "arrow", startElementId: "middle", endElementId: "target", points: [[0, 0], [100, 80]] }),
    ];

    const layout = autoLayoutElements(elements, { mode: "dagre", rankDirection: "LR" });
    const byId = new Map(layout.updates.map((update) => [update.id, update]));

    expect(layout.moved).toBeGreaterThanOrEqual(3);
    expect(byId.get("source")?.x).toBeLessThan(byId.get("middle")?.x ?? 0);
    expect(byId.get("middle")?.x).toBeLessThan(byId.get("target")?.x ?? 0);
  });

  it("builds a repository diagram from the workspace", async () => {
    const diagram = await createRepoDiagram({ maxFiles: 60, kind: "architecture" });

    expect(diagram.filesScanned).toBeGreaterThan(0);
    expect(diagram.elements.find((candidate) => candidate.id === "repo-root")).toBeTruthy();
    expect(diagram.elements.some((candidate) => candidate.type === "arrow")).toBe(true);
  });

  it("preserves scene files and image elements across export/import", () => {
    const source = new SceneStore({ now: () => 1 });
    source.addFiles({
      "image-1": { id: "image-1", mimeType: "image/png", dataURL: "data:image/png;base64,AA==" },
    });
    source.batchCreate([{ id: "hero", type: "image", fileId: "image-1", x: 10, y: 20, width: 200, height: 120 }]);

    const exported = source.exportScene();
    const target = new SceneStore({ now: () => 2 });
    target.importScene(exported, "replace");

    expect(Object.keys(target.getFiles())).toEqual(["image-1"]);
    expect(target.getElements()[0]).toMatchObject({ id: "hero", type: "image", fileId: "image-1" });
  });

  it("does not flag bound Excalidraw text as an overlap", () => {
    const elements = [
      element({ id: "shape", type: "rectangle", x: 0, y: 0, width: 220, height: 100, label: { text: "Shape" } }),
      element({ id: "bound-label", type: "text", x: 40, y: 32, width: 120, height: 32, text: "Shape", containerId: "shape" }),
    ];

    const lint = lintScene(elements);

    expect(lint.issues.map((issue) => issue.code)).not.toContain("elements_overlap");
  });
});
