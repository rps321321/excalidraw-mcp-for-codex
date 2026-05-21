import {
  cloneElements,
  getElementBounds,
  normalizeElementBatch,
  recalculateBoundLinearElements,
} from "./normalizer.js";
import { createElementId } from "./ids.js";
import type {
  DiagramElement,
  ElementInput,
  ElementType,
  SceneDescription,
  SceneExport,
  SceneSnapshot,
  ViewportState,
} from "./types.js";

export interface SceneStoreOptions {
  idFactory?: (prefix?: string) => string;
  now?: () => number;
}

export interface ElementQueryFilter {
  id?: string;
  type?: ElementType;
  text?: string;
  label?: string;
  groupId?: string;
  frame?: string;
}

export type ImportMode = "replace" | "merge";

export interface ViewportUpdate extends Partial<ViewportState> {
  scrollToContent?: boolean;
  scrollToElementId?: string;
}

const VIEWPORT_FIT_PADDING_X = 48;
const VIEWPORT_FIT_PADDING_Y = 96;

export class SceneStore {
  private elements: DiagramElement[] = [];
  private viewport: ViewportState = { scrollX: 0, scrollY: 0, zoom: 1 };
  private files: Record<string, unknown> = {};
  private readonly snapshots = new Map<string, SceneSnapshot>();
  private readonly idFactory: (prefix?: string) => string;
  private readonly now: () => number;

  constructor(options: SceneStoreOptions = {}) {
    this.idFactory = options.idFactory ?? createElementId;
    this.now = options.now ?? Date.now;
  }

  batchCreate(elements: readonly ElementInput[]): DiagramElement[] {
    const created = normalizeElementBatch(elements, {
      existingElements: this.elements,
      idFactory: this.idFactory,
      now: this.now,
      disallowExistingIds: true,
    });

    const createdIds = new Set(created.map((element) => element.id));
    this.elements = recalculateBoundLinearElements([...this.elements, ...created]);
    return cloneElements(this.elements.filter((element) => createdIds.has(element.id)));
  }

  updateElements(updates: ReadonlyArray<Partial<ElementInput> & { id: string }>): DiagramElement[] {
    if (updates.length === 0) {
      return [];
    }

    const byId = new Map(this.elements.map((element) => [element.id, element]));
    const updatedIds = new Set<string>();

    for (const update of updates) {
      const current = byId.get(update.id);
      if (!current) {
        throw new Error(`Cannot update missing element: ${update.id}`);
      }
      const merged = { ...current, ...update, id: current.id, type: update.type ?? current.type };
      const normalized = normalizeElementBatch([merged], {
        existingElements: [...byId.values()].filter((element) => element.id !== current.id),
        idFactory: this.idFactory,
        now: this.now,
      })[0]!;
      byId.set(update.id, { ...normalized, version: current.version + 1 });
      updatedIds.add(update.id);
    }

    this.elements = recalculateBoundLinearElements([...byId.values()]);
    return cloneElements(this.elements.filter((element) => updatedIds.has(element.id)));
  }

  deleteElements(ids: readonly string[]): DiagramElement[] {
    const idSet = new Set(ids);
    const deleted = this.elements.filter((element) => idSet.has(element.id));
    const remaining = this.elements
      .filter((element) => !idSet.has(element.id))
      .map((element) => stripMissingBindings(element, idSet));

    this.elements = recalculateBoundLinearElements(remaining);
    return cloneElements(deleted);
  }

  clear(): void {
    this.elements = [];
    this.files = {};
    this.viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
  }

  query(filter: ElementQueryFilter = {}): DiagramElement[] {
    const normalizedText = filter.text?.toLowerCase();
    const normalizedLabel = filter.label?.toLowerCase();

    return cloneElements(
      this.elements.filter((element) => {
        if (filter.id && element.id !== filter.id) {
          return false;
        }
        if (filter.type && element.type !== filter.type) {
          return false;
        }
        if (filter.groupId && !element.groupIds?.includes(filter.groupId)) {
          return false;
        }
        if (filter.frame && element.name !== filter.frame && !element.groupIds?.includes(filter.frame)) {
          return false;
        }
        if (normalizedText && !getSearchableText(element).includes(normalizedText)) {
          return false;
        }
        if (normalizedLabel && !element.label?.text.toLowerCase().includes(normalizedLabel)) {
          return false;
        }
        return true;
      }),
    );
  }

  describe(): SceneDescription {
    const bounds = getElementBounds(this.elements);

    return {
      count: this.elements.length,
      bounds,
      elements: this.elements.map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        text: element.text,
        label: element.label?.text,
        connections:
          element.startBinding || element.endBinding
            ? {
                start: element.startBinding?.elementId,
                end: element.endBinding?.elementId,
              }
            : undefined,
      })),
    };
  }

  exportScene(): SceneExport {
    return {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-mcp-for-codex",
      elements: cloneElements(this.elements),
      appState: { ...this.viewport },
      files: cloneRecord(this.files),
    };
  }

  importScene(scene: unknown, mode: ImportMode = "replace"): DiagramElement[] {
    const sourceElements = extractSceneElements(scene);
    const sourceFiles = extractSceneFiles(scene);
    const imported = mode === "merge" ? this.prepareMergedImport(sourceElements) : sourceElements;
    const normalized = normalizeElementBatch(imported, {
      existingElements: mode === "merge" ? this.elements : [],
      idFactory: this.idFactory,
      now: this.now,
      disallowExistingIds: mode === "merge",
    });

    const importedIds = new Set(normalized.map((element) => element.id));
    this.elements = mode === "merge"
      ? recalculateBoundLinearElements([...this.elements, ...normalized])
      : recalculateBoundLinearElements(normalized);
    this.files = mode === "merge" ? { ...this.files, ...sourceFiles } : sourceFiles;

    const importedViewport = extractViewport(scene);
    if (mode === "replace" && importedViewport) {
      this.viewport = importedViewport;
    }

    return cloneElements(this.elements.filter((element) => importedIds.has(element.id)));
  }

  snapshot(name: string): SceneSnapshot {
    const snapshot: SceneSnapshot = {
      name,
      elements: cloneElements(this.elements),
      viewport: { ...this.viewport },
      files: cloneRecord(this.files),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.snapshots.set(name, cloneSnapshot(snapshot));
    return cloneSnapshot(snapshot);
  }

  restoreSnapshot(name: string): SceneSnapshot {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${name}`);
    }

    this.elements = cloneElements(snapshot.elements);
    this.viewport = { ...snapshot.viewport };
    this.files = cloneRecord(snapshot.files ?? {});
    return cloneSnapshot(snapshot);
  }

  getSnapshot(name: string): SceneSnapshot {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${name}`);
    }

    return cloneSnapshot(snapshot);
  }

  setViewport(partial: ViewportUpdate): ViewportState {
    const next = { ...this.viewport };

    if (partial.scrollToContent) {
      const bounds = getElementBounds(this.elements);
      if (bounds) {
        next.scrollX = -bounds.x + VIEWPORT_FIT_PADDING_X;
        next.scrollY = -bounds.y + VIEWPORT_FIT_PADDING_Y;
      }
    }

    if (partial.scrollToElementId) {
      const element = this.elements.find((candidate) => candidate.id === partial.scrollToElementId);
      if (!element) {
        throw new Error(`Cannot scroll to missing element: ${partial.scrollToElementId}`);
      }
      next.scrollX = -element.x + VIEWPORT_FIT_PADDING_X;
      next.scrollY = -element.y + VIEWPORT_FIT_PADDING_Y;
    }

    if (partial.scrollX !== undefined) {
      next.scrollX = partial.scrollX;
    }
    if (partial.scrollY !== undefined) {
      next.scrollY = partial.scrollY;
    }
    if (partial.zoom !== undefined) {
      if (partial.zoom <= 0) {
        throw new Error("Viewport zoom must be positive");
      }
      next.zoom = partial.zoom;
    }

    this.viewport = next;
    return { ...this.viewport };
  }

  getElements(): DiagramElement[] {
    return cloneElements(this.elements);
  }

  getFiles(): Record<string, unknown> {
    return cloneRecord(this.files);
  }

  addFiles(files: Record<string, unknown>): Record<string, unknown> {
    this.files = { ...this.files, ...cloneRecord(files) };
    return this.getFiles();
  }

  getViewport(): ViewportState {
    return { ...this.viewport };
  }

  getScene(): SceneExport {
    return this.exportScene();
  }

  replaceScene(scene: unknown): DiagramElement[] {
    return this.importScene(scene, "replace");
  }

  private prepareMergedImport(elements: readonly ElementInput[]): ElementInput[] {
    const existingIds = new Set(this.elements.map((element) => element.id));
    const idMap = new Map<string, string>();

    for (const element of elements) {
      if (element.id && existingIds.has(element.id)) {
        idMap.set(element.id, this.idFactory(element.type));
      }
    }

    if (idMap.size === 0) {
      return elements.map((element) => ({ ...element }));
    }

    return elements.map((element) => {
      const nextId = element.id ? idMap.get(element.id) ?? element.id : undefined;
      const startElementId = element.startBinding?.elementId ?? element.startElementId;
      const endElementId = element.endBinding?.elementId ?? element.endElementId;
      return {
        ...element,
        id: nextId,
        startElementId: startElementId ? idMap.get(startElementId) ?? startElementId : undefined,
        endElementId: endElementId ? idMap.get(endElementId) ?? endElementId : undefined,
        startBinding: element.startBinding
          ? { ...element.startBinding, elementId: idMap.get(element.startBinding.elementId) ?? element.startBinding.elementId }
          : undefined,
        endBinding: element.endBinding
          ? { ...element.endBinding, elementId: idMap.get(element.endBinding.elementId) ?? element.endBinding.elementId }
          : undefined,
      };
    });
  }
}

function stripMissingBindings(element: DiagramElement, deletedIds: Set<string>): DiagramElement {
  const next = { ...element };
  if (next.startBinding && deletedIds.has(next.startBinding.elementId)) {
    next.startBinding = undefined;
    next.startElementId = undefined;
  }
  if (next.endBinding && deletedIds.has(next.endBinding.elementId)) {
    next.endBinding = undefined;
    next.endElementId = undefined;
  }
  return next;
}

function extractSceneElements(scene: unknown): ElementInput[] {
  if (!scene || typeof scene !== "object") {
    throw new Error("Scene import must be an object with an elements array");
  }

  const maybeElements = (scene as { elements?: unknown }).elements;
  if (!Array.isArray(maybeElements)) {
    throw new Error("Scene import must include an elements array");
  }

  return maybeElements.map((element) => {
    if (!element || typeof element !== "object") {
      throw new Error("Scene elements must be objects");
    }
    return { ...(element as ElementInput) };
  });
}

function extractViewport(scene: unknown): ViewportState | null {
  if (!scene || typeof scene !== "object") {
    return null;
  }

  const appState = (scene as { appState?: unknown }).appState;
  if (!appState || typeof appState !== "object") {
    return null;
  }

  const { scrollX, scrollY, zoom } = appState as Partial<ViewportState>;
  if (typeof scrollX === "number" && typeof scrollY === "number" && typeof zoom === "number" && zoom > 0) {
    return { scrollX, scrollY, zoom };
  }

  return null;
}

function extractSceneFiles(scene: unknown): Record<string, unknown> {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    return {};
  }
  const files = (scene as { files?: unknown }).files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return {};
  }
  return cloneRecord(files as Record<string, unknown>);
}

function cloneSnapshot(snapshot: SceneSnapshot): SceneSnapshot {
  return {
    name: snapshot.name,
    elements: cloneElements(snapshot.elements),
    viewport: { ...snapshot.viewport },
    files: cloneRecord(snapshot.files ?? {}),
    createdAt: snapshot.createdAt,
  };
}

function getSearchableText(element: DiagramElement): string {
  return [
    element.text,
    element.label?.text,
    element.name,
    element.metadata ? Object.values(element.metadata).join(" ") : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
