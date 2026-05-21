import { describe, expect, it } from "vitest";
import { normalizeElementBatch } from "../../src/shared/normalizer.js";
import {
  compareSceneSnapshots,
  createFrameElement,
  createGroupUpdates,
  createUngroupUpdates,
  duplicateElements,
} from "../../src/shared/scene-ops.js";
import type { DiagramElement, ElementInput } from "../../src/shared/types.js";

function createElements(inputs: readonly ElementInput[], now = 1): DiagramElement[] {
  return normalizeElementBatch(inputs, { now: () => now });
}

function createIdFactory(): (prefix?: string) => string {
  let nextId = 1;
  return (prefix = "id") => `${prefix}-copy-${nextId++}`;
}

function applyUpdates(elements: readonly DiagramElement[], updates: ReadonlyArray<Partial<ElementInput> & { id: string }>): DiagramElement[] {
  const updatesById = new Map(updates.map((update) => [update.id, update]));
  return elements.map((element) => ({ ...element, ...updatesById.get(element.id) }));
}

describe("advanced scene operations", () => {
  it("compares scenes and snapshots by added, removed, changed, unchanged, and viewport changes", () => {
    const before = createElements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 60, label: { text: "A" } },
      { id: "b", type: "rectangle", x: 180, y: 0, width: 100, height: 60, label: { text: "B" } },
      { id: "old", type: "text", x: 0, y: 120, text: "Remove me" },
    ]);
    const after = createElements([
      { id: "a", type: "rectangle", x: 12, y: 0, width: 100, height: 60, label: { text: "A" } },
      { id: "b", type: "rectangle", x: 180, y: 0, width: 100, height: 60, label: { text: "B" } },
      { id: "new", type: "text", x: 0, y: 120, text: "Add me" },
    ]);

    const comparison = compareSceneSnapshots(
      { elements: before, viewport: { scrollX: 0, scrollY: 0, zoom: 1 } },
      { elements: after, viewport: { scrollX: -20, scrollY: 0, zoom: 1 } },
    );

    expect(comparison.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1, viewportChanged: true });
    expect(comparison.added.map((element) => element.id)).toEqual(["new"]);
    expect(comparison.removed.map((element) => element.id)).toEqual(["old"]);
    expect(comparison.changed[0]).toMatchObject({ id: "a", changedFields: ["x"] });
    expect(comparison.unchangedIds).toEqual(["b"]);
    expect(comparison.viewport).toEqual({
      before: { scrollX: 0, scrollY: 0, zoom: 1 },
      after: { scrollX: -20, scrollY: 0, zoom: 1 },
      changed: true,
    });
  });

  it("duplicates selected elements with remapped IDs, bindings, groups, and an offset", () => {
    const elements = createElements([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 120, height: 70, label: { text: "A" }, groupIds: ["flow"] },
      { id: "b", type: "rectangle", x: 220, y: 0, width: 120, height: 70, label: { text: "B" }, groupIds: ["flow"] },
      { id: "a-to-b", type: "arrow", startElementId: "a", endElementId: "b", groupIds: ["flow"] },
    ]);

    const result = duplicateElements(elements, {
      ids: ["a", "b", "a-to-b"],
      offset: { x: 50, y: 80 },
      idFactory: createIdFactory(),
      now: () => 2,
    });

    expect(result.elements).toHaveLength(3);
    expect(result.elements.map((element) => element.id)).toEqual(["rectangle-copy-1", "rectangle-copy-2", "arrow-copy-3"]);
    expect(result.idMap).toEqual({
      a: "rectangle-copy-1",
      b: "rectangle-copy-2",
      "a-to-b": "arrow-copy-3",
    });
    expect(result.groupIdMap.flow).toBe("group-copy-4");

    const duplicatedA = result.elements.find((element) => element.id === "rectangle-copy-1")!;
    const duplicatedB = result.elements.find((element) => element.id === "rectangle-copy-2")!;
    const duplicatedArrow = result.elements.find((element) => element.id === "arrow-copy-3")!;

    expect(duplicatedA).toMatchObject({ x: 50, y: 80, groupIds: ["group-copy-4"] });
    expect(duplicatedB).toMatchObject({ x: 270, y: 80, groupIds: ["group-copy-4"] });
    expect(duplicatedArrow.startBinding).toEqual({ elementId: "rectangle-copy-1" });
    expect(duplicatedArrow.endBinding).toEqual({ elementId: "rectangle-copy-2" });
    expect("boundElements" in duplicatedA).toBe(false);
    expect(elements[0]!.groupIds).toEqual(["flow"]);
  });

  it("groups and ungroups selected element IDs without duplicating group IDs", () => {
    const elements = createElements([
      { id: "a", type: "rectangle", groupIds: ["existing"] },
      { id: "b", type: "text", text: "B" },
      { id: "c", type: "ellipse" },
    ]);

    const grouped = createGroupUpdates(elements, ["a", "b"], "review");
    expect(grouped.updates.map((element) => [element.id, element.groupIds])).toEqual([
      ["a", ["existing", "review"]],
      ["b", ["review"]],
    ]);

    const groupedElements = applyUpdates(elements, grouped.updates);
    const groupedAgain = createGroupUpdates(groupedElements, ["a"], "review");
    expect(groupedAgain.updates.find((element) => element.id === "a")!.groupIds).toEqual(["existing", "review"]);

    const ungroupedOne = createUngroupUpdates(groupedElements, ["a"], "review");
    expect(ungroupedOne.updates.find((element) => element.id === "a")!.groupIds).toEqual(["existing"]);
    expect(groupedElements.find((element) => element.id === "b")!.groupIds).toEqual(["review"]);

    const fullyUngrouped = createUngroupUpdates(groupedElements, ["a", "b"]);
    expect(fullyUngrouped.updates.map((element) => [element.id, element.groupIds])).toEqual([
      ["a", []],
      ["b", []],
    ]);
  });

  it("creates a padded frame around selected elements and can tag the framed selection", () => {
    const elements = createElements([
      { id: "left", type: "rectangle", x: 10, y: 20, width: 100, height: 60, label: { text: "Left" } },
      { id: "right", type: "rectangle", x: 300, y: 20, width: 100, height: 60, label: { text: "Right" } },
      { id: "outside", type: "text", x: 900, y: 20, text: "Outside" },
    ]);

    const result = createFrameElement(elements, {
      ids: ["left", "right"],
      frameId: "frame-main",
      name: "Main flow",
      padding: 20,
      groupSelectionWithFrame: true,
      now: () => 2,
    });

    expect(result.element).toMatchObject({
      id: "frame-main",
      type: "frame",
      name: "Main flow",
      x: -10,
      y: 0,
      width: 448,
      height: 109,
    });
    expect(result.updates).toEqual([
      { id: "left", groupIds: ["frame-main"] },
      { id: "right", groupIds: ["frame-main"] },
    ]);
  });
});
