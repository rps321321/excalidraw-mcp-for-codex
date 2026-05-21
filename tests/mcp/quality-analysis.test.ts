import { describe, expect, it } from "vitest";
import {
  createDiagramPlan,
  createDiagramReviewReport,
  lintScene,
  routeArrows,
  suggestLayoutFixes,
  themeScene,
  toLayoutFixUpdates,
} from "../../src/shared/quality.js";
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

describe("quality analysis helpers", () => {
  it("lints tight labels, overlap, and unbound arrows", () => {
    const elements = [
      element({
        id: "tiny",
        type: "rectangle",
        width: 70,
        height: 28,
        label: { text: "Very long label", fontSize: 12 },
      }),
      element({ id: "overlap", type: "rectangle", x: 40, y: 12, width: 100, height: 70 }),
      element({ id: "loose-arrow", type: "arrow", x: 0, y: 160, points: [[0, 0], [120, 0]] }),
    ];

    const lint = lintScene(elements);
    expect(lint.score).toBeLessThan(100);
    expect(lint.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["text_too_small", "text_bounds_tight", "elements_overlap", "arrow_unbound"]),
    );

    const report = createDiagramReviewReport(elements);
    expect(report.verdict).not.toBe("ready");
    expect(report.recommendations).toContain("Expand text-bearing elements so labels have comfortable padding.");
  });

  it("creates deterministic diagram plans from text", () => {
    const plan = createDiagramPlan("Start -> Review -> Ship");

    expect(plan.direction).toBe("left-to-right");
    expect(plan.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
      ["start", 80, 120],
      ["review", 380, 120],
      ["ship", 680, 120],
    ]);
    expect(plan.arrows.map((arrow) => [arrow.from, arrow.to])).toEqual([
      ["start", "review"],
      ["review", "ship"],
    ]);
  });

  it("suggests layout fixes and converts them to update_elements payloads", () => {
    const elements = [
      element({ id: "first", type: "rectangle", x: 0, y: 0, width: 160, height: 80, label: { text: "First" } }),
      element({ id: "second", type: "rectangle", x: 80, y: 20, width: 160, height: 80, label: { text: "Second" } }),
      element({ id: "small", type: "rectangle", x: 320, y: 0, width: 40, height: 20, label: { text: "Needs space" } }),
    ];

    const plan = suggestLayoutFixes(elements);
    const updates = toLayoutFixUpdates(elements, plan);

    expect(plan.fixes.map((fix) => fix.id)).toEqual(expect.arrayContaining(["second", "small"]));
    expect(updates.find((update) => update.id === "second")?.y).toBeGreaterThan(20);
    expect(updates.find((update) => update.id === "small")?.width).toBeGreaterThan(40);
  });

  it("plans elbow arrow routes around obstacles", () => {
    const elements = [
      element({ id: "start", type: "rectangle", x: 0, y: 0, width: 100, height: 60 }),
      element({ id: "end", type: "rectangle", x: 320, y: 120, width: 100, height: 60 }),
      element({ id: "blocker", type: "rectangle", x: 180, y: 20, width: 70, height: 180 }),
      element({
        id: "start-to-end",
        type: "arrow",
        x: 100,
        y: 30,
        width: 220,
        height: 120,
        points: [[0, 0], [220, 120]],
        startBinding: { elementId: "start" },
        endBinding: { elementId: "end" },
      }),
    ];

    const plan = routeArrows(elements);
    const update = plan.updates.find((candidate) => candidate.id === "start-to-end");

    expect(plan.routes).toHaveLength(1);
    expect(update?.points?.length).toBeGreaterThanOrEqual(4);
    expect(update?.x).toBeGreaterThan(100);
  });

  it("plans theme updates without mutating elements", () => {
    const elements = [
      element({ id: "box", type: "rectangle" }),
      element({ id: "note", type: "text", text: "Note" }),
      element({ id: "flow", type: "arrow", points: [[0, 0], [100, 0]] }),
    ];

    const plan = themeScene(elements, { preference: "presentation" });

    expect(plan.name).toBe("presentation");
    expect(plan.fills.accent1).toBe("#dbeafe");
    expect(plan.updates).toContainEqual(
      expect.objectContaining({ id: "box", backgroundColor: "#dbeafe", fillStyle: "solid" }),
    );
    expect(elements[0]!.backgroundColor).toBe("transparent");
  });
});
