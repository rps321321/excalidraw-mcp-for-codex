import { describe, expect, it } from "vitest";
import { getLinearAbsoluteEndpoints } from "../../src/shared/normalizer.js";
import { SceneStore } from "../../src/shared/state.js";

function createStore(): SceneStore {
  let nextId = 1;
  return new SceneStore({
    idFactory: (prefix = "el") => `${prefix}_${nextId++}`,
    now: () => Date.parse("2026-01-01T00:00:00.000Z"),
  });
}

describe("SceneStore", () => {
  it("batch creates elements with stable IDs, generated IDs, and defaults", () => {
    const store = createStore();

    const created = store.batchCreate([
      { id: "box-a", type: "rectangle", x: 10, y: 20, label: { text: "Alpha" } },
      { type: "text", text: "Loose note" },
    ]);

    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ id: "box-a", type: "rectangle", x: 10, y: 20 });
    expect(created[0]!.width).toBeGreaterThan(0);
    expect(created[0]!.height).toBeGreaterThan(0);
    expect(created[1]).toMatchObject({ id: "text_1", type: "text", text: "Loose note" });
  });

  it("normalizes shape text into labels and expands bounds for readable text", () => {
    const store = createStore();

    const [shape] = store.batchCreate([
      { id: "long-label", type: "rectangle", width: 20, height: 10, text: "A long readable label" },
    ]);

    expect(shape!.label).toEqual({ text: "A long readable label" });
    expect(shape!.text).toBeUndefined();
    expect(shape!.width).toBeGreaterThan(20);
    expect(shape!.height).toBeGreaterThan(10);
  });

  it("binds arrows to same-batch and existing elements and updates target boundElements", () => {
    const store = createStore();

    store.batchCreate([
      { id: "start", type: "rectangle", x: 0, y: 0, width: 180, height: 90, label: { text: "Start" } },
      { id: "flow", type: "arrow", startElementId: "start", endElementId: "end", label: { text: "next" } },
      { id: "end", type: "rectangle", x: 320, y: 0, width: 180, height: 90, label: { text: "End" } },
    ]);

    const elements = store.getElements();
    const arrow = elements.find((element) => element.id === "flow")!;
    const start = elements.find((element) => element.id === "start")!;
    const end = elements.find((element) => element.id === "end")!;
    const endpoints = getLinearAbsoluteEndpoints(arrow)!;

    expect(arrow.startBinding).toEqual({ elementId: "start" });
    expect(arrow.endBinding).toEqual({ elementId: "end" });
    expect(start.boundElements).toEqual([{ id: "flow", type: "arrow" }]);
    expect(end.boundElements).toEqual([{ id: "flow", type: "arrow" }]);
    expect(endpoints.start[0]).toBeGreaterThan(start.x + start.width);
    expect(endpoints.end[0]).toBeLessThan(end.x);
  });

  it("queries elements and describes scene connections and bounds", () => {
    const store = createStore();
    store.batchCreate([
      { id: "api", type: "rectangle", x: 50, y: 25, label: { text: "API Gateway" }, groupIds: ["backend"] },
      { id: "worker", type: "rectangle", x: 300, y: 25, label: { text: "Worker" }, groupIds: ["backend"] },
      { id: "api-to-worker", type: "arrow", startElementId: "api", endElementId: "worker" },
    ]);

    expect(store.query({ text: "gateway" }).map((element) => element.id)).toEqual(["api"]);
    expect(store.query({ type: "rectangle" })).toHaveLength(2);
    expect(store.query({ groupId: "backend" })).toHaveLength(2);

    const description = store.describe();
    expect(description.count).toBe(3);
    expect(description.bounds).toMatchObject({ x: 50, y: 25 });
    expect(description.elements.find((element) => element.id === "api-to-worker")!.connections).toEqual({
      start: "api",
      end: "worker",
    });
  });

  it("snapshots and restores scene elements and viewport", () => {
    const store = createStore();
    store.batchCreate([{ id: "box", type: "rectangle", x: 10, y: 10, label: { text: "Original" } }]);
    store.setViewport({ scrollX: -10, scrollY: -20, zoom: 1.5 });

    const snapshot = store.snapshot("before-edit");
    store.updateElements([{ id: "box", label: { text: "Changed" } }]);
    store.setViewport({ scrollX: -200, scrollY: -300, zoom: 0.75 });

    const restored = store.restoreSnapshot("before-edit");
    const [box] = store.getElements();

    expect(snapshot.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(restored.viewport).toEqual({ scrollX: -10, scrollY: -20, zoom: 1.5 });
    expect(box!.label?.text).toBe("Original");
    expect(store.exportScene().appState).toEqual({ scrollX: -10, scrollY: -20, zoom: 1.5 });
  });

  it("exports and imports an Excalidraw scene round trip", () => {
    const source = createStore();
    source.batchCreate([
      { id: "left", type: "rectangle", x: 0, y: 0, label: { text: "Left" } },
      { id: "right", type: "rectangle", x: 260, y: 0, label: { text: "Right" } },
      { id: "left-to-right", type: "arrow", startElementId: "left", endElementId: "right" },
    ]);
    source.setViewport({ scrollX: -40, scrollY: -30, zoom: 1.25 });

    const exported = source.exportScene();
    const target = createStore();
    const imported = target.importScene(exported, "replace");

    expect(exported.type).toBe("excalidraw");
    expect(imported.map((element) => element.id)).toEqual(["left", "right", "left-to-right"]);
    expect(target.exportScene().appState).toEqual({ scrollX: -40, scrollY: -30, zoom: 1.25 });
    expect(target.describe().elements.find((element) => element.id === "left-to-right")!.connections).toEqual({
      start: "left",
      end: "right",
    });
  });
});
