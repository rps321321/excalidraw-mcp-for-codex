import { createElementId } from "./ids.js";
import {
  cloneElement,
  cloneElements,
  getElementBounds,
  normalizeElementBatch,
  recalculateBoundLinearElements,
} from "./normalizer.js";
import type { DiagramElement, ElementInput, ViewportState } from "./types.js";

export type SceneLike = readonly DiagramElement[] | { elements: readonly DiagramElement[]; viewport?: ViewportState };
export type IdFactory = (prefix?: string) => string;

export interface SceneComparison {
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
    viewportChanged: boolean;
  };
  added: DiagramElement[];
  removed: DiagramElement[];
  changed: Array<{
    id: string;
    before: DiagramElement;
    after: DiagramElement;
    changedFields: string[];
  }>;
  unchangedIds: string[];
  viewport?: {
    before?: ViewportState;
    after?: ViewportState;
    changed: boolean;
  };
}

export interface DuplicateSelectedElementsOptions {
  offset?: { x?: number; y?: number };
  idFactory?: IdFactory;
  now?: () => number;
  remapGroupIds?: boolean;
}

export interface DuplicateElementsOptions extends DuplicateSelectedElementsOptions {
  ids: readonly string[];
}

export interface DuplicateElementsResult {
  elements: DiagramElement[];
  duplicatedElements: DiagramElement[];
  idMap: Record<string, string>;
  groupIdMap: Record<string, string>;
}

export interface DuplicateElementInputsResult {
  [key: string]: unknown;
  elements: ElementInput[];
  idMap: Record<string, string>;
  groupIdMap: Record<string, string>;
}

export type ElementUpdateInput = Partial<ElementInput> & { id: string };

export interface ElementUpdatesResult {
  [key: string]: unknown;
  updates: ElementUpdateInput[];
  groupId?: string;
}

export interface GroupOperationResult {
  elements: DiagramElement[];
  changedElements: DiagramElement[];
  groupId?: string;
}

export interface FrameAroundElementsOptions {
  frameId?: string;
  name?: string;
  padding?: number | { x?: number; y?: number };
  idFactory?: IdFactory;
  now?: () => number;
  groupSelectionWithFrame?: boolean;
  style?: Partial<
    Pick<
      ElementInput,
      | "backgroundColor"
      | "strokeColor"
      | "fillStyle"
      | "strokeWidth"
      | "strokeStyle"
      | "roughness"
      | "opacity"
      | "locked"
    >
  >;
  label?: string;
}

export interface FrameAroundElementsResult {
  elements: DiagramElement[];
  frame: DiagramElement;
  framedElementIds: string[];
}

export interface CreateFrameElementOptions extends FrameAroundElementsOptions {
  ids: readonly string[];
}

export interface CreateFrameElementResult {
  [key: string]: unknown;
  element: ElementInput;
  updates: ElementUpdateInput[];
  framedElementIds: string[];
  frameId: string;
}

const DEFAULT_DUPLICATE_OFFSET = { x: 32, y: 32 };
const DEFAULT_FRAME_PADDING = { x: 32, y: 32 };

export function compareScenes(beforeScene: unknown, afterScene: unknown): SceneComparison {
  const before = getSceneElements(beforeScene);
  const after = getSceneElements(afterScene);
  const beforeById = new Map(before.map((element) => [element.id, element]));
  const afterById = new Map(after.map((element) => [element.id, element]));

  const added = after.filter((element) => !beforeById.has(element.id)).map(cloneElement);
  const removed = before.filter((element) => !afterById.has(element.id)).map(cloneElement);
  const changed: SceneComparison["changed"] = [];
  const unchangedIds: string[] = [];

  for (const beforeElement of before) {
    const afterElement = afterById.get(beforeElement.id);
    if (!afterElement) {
      continue;
    }

    const changedFields = compareElementFields(beforeElement, afterElement);
    if (changedFields.length > 0) {
      changed.push({
        id: beforeElement.id,
        before: cloneElement(beforeElement),
        after: cloneElement(afterElement),
        changedFields,
      });
    } else {
      unchangedIds.push(beforeElement.id);
    }
  }

  const beforeViewport = getSceneViewport(beforeScene);
  const afterViewport = getSceneViewport(afterScene);
  const viewportChanged = stableStringify(beforeViewport) !== stableStringify(afterViewport);
  const viewport = beforeViewport || afterViewport
    ? {
        before: beforeViewport ? { ...beforeViewport } : undefined,
        after: afterViewport ? { ...afterViewport } : undefined,
        changed: viewportChanged,
      }
    : undefined;

  return {
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchangedIds.length,
      viewportChanged,
    },
    added,
    removed,
    changed,
    unchangedIds,
    viewport,
  };
}

export function compareSceneSnapshots(left: unknown, right: unknown): SceneComparison {
  return compareScenes(left, right);
}

export function duplicateElements(
  elements: readonly DiagramElement[],
  options: DuplicateElementsOptions,
): DuplicateElementInputsResult {
  const result = duplicateSelectedElements(elements, options.ids, options);
  return {
    elements: result.duplicatedElements.map(toElementInput),
    idMap: result.idMap,
    groupIdMap: result.groupIdMap,
  };
}

export function createGroupUpdates(
  elements: readonly DiagramElement[],
  ids: readonly string[],
  groupId?: string,
): ElementUpdatesResult {
  const selectedSet = new Set(ids);
  assertKnownIds(elements, selectedSet);
  const resolvedGroupId = groupId ?? reserveUniqueId(createElementId, "group", collectReservedIds(elements));

  return {
    groupId: resolvedGroupId,
    updates: elements
      .filter((element) => selectedSet.has(element.id))
      .map((element) => {
        const groupIds = new Set(element.groupIds ?? []);
        groupIds.add(resolvedGroupId);
        return { id: element.id, groupIds: [...groupIds] };
      }),
  };
}

export function createUngroupUpdates(
  elements: readonly DiagramElement[],
  ids: readonly string[],
  groupId?: string,
): ElementUpdatesResult {
  const selectedSet = new Set(ids);
  assertKnownIds(elements, selectedSet);

  return {
    groupId,
    updates: elements
      .filter((element) => selectedSet.has(element.id))
      .map((element) => ({
        id: element.id,
        groupIds: groupId ? (element.groupIds ?? []).filter((candidate) => candidate !== groupId) : [],
      })),
  };
}

export function createFrameElement(
  elements: readonly DiagramElement[],
  options: CreateFrameElementOptions,
): CreateFrameElementResult {
  const selectedSet = new Set(options.ids);
  assertKnownIds(elements, selectedSet);

  if (selectedSet.size === 0) {
    throw new Error("Cannot create a frame around an empty selection");
  }

  const selected = elements.filter((element) => selectedSet.has(element.id));
  const bounds = getElementBounds(selected);
  if (!bounds) {
    throw new Error("Cannot create a frame without element bounds");
  }

  const idFactory = options.idFactory ?? createElementId;
  const reservedIds = collectReservedIds(elements);
  const frameId = reserveFrameId(options.frameId, idFactory, reservedIds);

  const padding = normalizePadding(options.padding);
  const element: ElementInput = {
    id: frameId,
    type: "frame",
    name: options.name ?? frameId,
    label: options.label ? { text: options.label } : undefined,
    x: bounds.x - padding.x,
    y: bounds.y - padding.y,
    width: bounds.width + padding.x * 2,
    height: bounds.height + padding.y * 2,
    backgroundColor: "transparent",
    strokeColor: "#868e96",
    strokeStyle: "dashed",
    fillStyle: "hachure",
    roughness: 1,
    ...options.style,
  };

  return {
    element,
    updates: options.groupSelectionWithFrame ? createGroupUpdates(elements, options.ids, frameId).updates : [],
    framedElementIds: [...selectedSet],
    frameId,
  };
}

export function duplicateSelectedElements(
  elements: readonly DiagramElement[],
  selectedIds: readonly string[],
  options: DuplicateSelectedElementsOptions = {},
): DuplicateElementsResult {
  const selectedSet = new Set(selectedIds);
  assertKnownIds(elements, selectedSet);

  if (selectedSet.size === 0) {
    return { elements: cloneElements(elements), duplicatedElements: [], idMap: {}, groupIdMap: {} };
  }

  const idFactory = options.idFactory ?? createElementId;
  const reservedIds = new Set(elements.map((element) => element.id));
  const selected = elements.filter((element) => selectedSet.has(element.id));
  const idMap = new Map<string, string>();

  for (const element of selected) {
    const nextId = reserveUniqueId(idFactory, element.type, reservedIds);
    idMap.set(element.id, nextId);
  }

  const groupIdMap = options.remapGroupIds === false
    ? new Map<string, string>()
    : createGroupIdMap(selected, idFactory, reservedIds);
  const offset = {
    x: options.offset?.x ?? DEFAULT_DUPLICATE_OFFSET.x,
    y: options.offset?.y ?? DEFAULT_DUPLICATE_OFFSET.y,
  };

  const duplicateInputs = selected.map((element) =>
    duplicateElementInput(element, idMap, groupIdMap, offset),
  );
  const normalizedDuplicates = normalizeElementBatch(duplicateInputs, {
    existingElements: elements,
    idFactory,
    now: options.now,
    disallowExistingIds: true,
  });
  const duplicateIds = new Set(normalizedDuplicates.map((element) => element.id));
  const nextElements = recalculateBoundLinearElements([...cloneElements(elements), ...normalizedDuplicates]);
  const duplicatedElements = nextElements.filter((element) => duplicateIds.has(element.id));

  return {
    elements: nextElements,
    duplicatedElements: cloneElements(duplicatedElements),
    idMap: Object.fromEntries(idMap),
    groupIdMap: Object.fromEntries(groupIdMap),
  };
}

export function groupElementIds(
  elements: readonly DiagramElement[],
  selectedIds: readonly string[],
  groupId: string,
): GroupOperationResult {
  if (!groupId) {
    throw new Error("groupId is required");
  }

  const selectedSet = new Set(selectedIds);
  assertKnownIds(elements, selectedSet);

  const nextElements = cloneElements(elements).map((element) => {
    if (!selectedSet.has(element.id)) {
      return element;
    }
    const groupIds = new Set(element.groupIds ?? []);
    groupIds.add(groupId);
    return { ...element, groupIds: [...groupIds] };
  });

  return {
    elements: nextElements,
    changedElements: cloneElements(nextElements.filter((element) => selectedSet.has(element.id))),
    groupId,
  };
}

export function ungroupElementIds(
  elements: readonly DiagramElement[],
  selectedIds: readonly string[],
  groupId?: string,
): GroupOperationResult {
  const selectedSet = new Set(selectedIds);
  assertKnownIds(elements, selectedSet);

  const nextElements = cloneElements(elements).map((element) => {
    if (!selectedSet.has(element.id)) {
      return element;
    }
    const groupIds = groupId
      ? (element.groupIds ?? []).filter((candidate) => candidate !== groupId)
      : [];
    return { ...element, groupIds };
  });

  return {
    elements: nextElements,
    changedElements: cloneElements(nextElements.filter((element) => selectedSet.has(element.id))),
    groupId,
  };
}

export function createFrameAroundElements(
  elements: readonly DiagramElement[],
  selectedIds: readonly string[],
  options: FrameAroundElementsOptions = {},
): FrameAroundElementsResult {
  const selectedSet = new Set(selectedIds);
  assertKnownIds(elements, selectedSet);

  if (selectedSet.size === 0) {
    throw new Error("Cannot create a frame around an empty selection");
  }

  const selected = elements.filter((element) => selectedSet.has(element.id));
  const bounds = getElementBounds(selected);
  if (!bounds) {
    throw new Error("Cannot create a frame without element bounds");
  }

  const idFactory = options.idFactory ?? createElementId;
  const reservedIds = new Set(elements.map((element) => element.id));
  const frameId = reserveFrameId(options.frameId, idFactory, reservedIds);

  const padding = normalizePadding(options.padding);
  const baseElements = options.groupSelectionWithFrame
    ? groupElementIds(elements, selectedIds, frameId).elements
    : cloneElements(elements);
  const [frame] = normalizeElementBatch(
    [
      {
        id: frameId,
        type: "frame",
        name: options.name ?? frameId,
        label: options.label ? { text: options.label } : undefined,
        x: bounds.x - padding.x,
        y: bounds.y - padding.y,
        width: bounds.width + padding.x * 2,
        height: bounds.height + padding.y * 2,
        backgroundColor: "transparent",
        strokeColor: "#868e96",
        strokeStyle: "dashed",
        fillStyle: "hachure",
        roughness: 1,
        ...options.style,
      },
    ],
    {
      existingElements: baseElements,
      idFactory,
      now: options.now,
      disallowExistingIds: true,
    },
  );

  const nextElements = [...baseElements, frame!];
  return {
    elements: cloneElements(nextElements),
    frame: cloneElement(frame!),
    framedElementIds: [...selectedSet],
  };
}

function duplicateElementInput(
  element: DiagramElement,
  idMap: ReadonlyMap<string, string>,
  groupIdMap: ReadonlyMap<string, string>,
  offset: { x: number; y: number },
): ElementInput {
  const startElementId = remapOptionalId(element.startBinding?.elementId ?? element.startElementId, idMap);
  const endElementId = remapOptionalId(element.endBinding?.elementId ?? element.endElementId, idMap);
  const groupIds = (element.groupIds ?? []).map((groupId) => groupIdMap.get(groupId) ?? groupId);

  return {
    ...element,
    id: idMap.get(element.id),
    x: element.x + offset.x,
    y: element.y + offset.y,
    groupIds,
    startElementId,
    endElementId,
    startBinding: element.startBinding
      ? { ...element.startBinding, elementId: remapOptionalId(element.startBinding.elementId, idMap)! }
      : undefined,
    endBinding: element.endBinding
      ? { ...element.endBinding, elementId: remapOptionalId(element.endBinding.elementId, idMap)! }
      : undefined,
  };
}

function compareElementFields(before: DiagramElement, after: DiagramElement): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => stableStringify(before[key as keyof DiagramElement]) !== stableStringify(after[key as keyof DiagramElement]))
    .sort();
}

function createGroupIdMap(
  elements: readonly DiagramElement[],
  idFactory: IdFactory,
  reservedIds: Set<string>,
): Map<string, string> {
  const groupIds = new Set(elements.flatMap((element) => element.groupIds ?? []));
  const groupIdMap = new Map<string, string>();

  for (const groupId of groupIds) {
    groupIdMap.set(groupId, reserveUniqueId(idFactory, "group", reservedIds));
  }

  return groupIdMap;
}

function reserveUniqueId(idFactory: IdFactory, prefix: string, reservedIds: Set<string>): string {
  let id = idFactory(prefix);
  while (reservedIds.has(id)) {
    id = idFactory(prefix);
  }
  reservedIds.add(id);
  return id;
}

function reserveFrameId(frameId: string | undefined, idFactory: IdFactory, reservedIds: Set<string>): string {
  if (frameId) {
    if (reservedIds.has(frameId)) {
      throw new Error(`Element already exists: ${frameId}`);
    }
    reservedIds.add(frameId);
    return frameId;
  }

  return reserveUniqueId(idFactory, "frame", reservedIds);
}

function collectReservedIds(elements: readonly DiagramElement[]): Set<string> {
  return new Set(elements.flatMap((element) => [element.id, ...(element.groupIds ?? [])]));
}

function assertKnownIds(elements: readonly DiagramElement[], selectedIds: ReadonlySet<string>): void {
  const knownIds = new Set(elements.map((element) => element.id));
  const missing = [...selectedIds].filter((id) => !knownIds.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown element id(s): ${missing.join(", ")}`);
  }
}

function toElementInput(element: DiagramElement): ElementInput {
  const { version: _version, updated: _updated, boundElements: _boundElements, ...input } = cloneElement(element);
  return input;
}

function getSceneElements(scene: unknown): readonly DiagramElement[] {
  if (Array.isArray(scene)) {
    return scene as DiagramElement[];
  }
  if (scene && typeof scene === "object" && Array.isArray((scene as { elements?: unknown }).elements)) {
    return (scene as { elements: DiagramElement[] }).elements;
  }
  throw new Error("Scene comparison requires an element array or snapshot-like object");
}

function getSceneViewport(scene: unknown): ViewportState | undefined {
  if (!scene || typeof scene !== "object" || Array.isArray(scene) || !("viewport" in scene)) {
    return undefined;
  }
  const viewport = (scene as { viewport?: Partial<ViewportState> }).viewport;
  if (
    typeof viewport?.scrollX === "number" &&
    typeof viewport.scrollY === "number" &&
    typeof viewport.zoom === "number"
  ) {
    return { scrollX: viewport.scrollX, scrollY: viewport.scrollY, zoom: viewport.zoom };
  }
  return undefined;
}

function normalizePadding(padding: FrameAroundElementsOptions["padding"]): { x: number; y: number } {
  if (typeof padding === "number") {
    return { x: padding, y: padding };
  }
  return {
    x: padding?.x ?? DEFAULT_FRAME_PADDING.x,
    y: padding?.y ?? DEFAULT_FRAME_PADDING.y,
  };
}

function remapOptionalId(id: string | undefined, idMap: ReadonlyMap<string, string>): string | undefined {
  return id ? idMap.get(id) ?? id : undefined;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(sortForStringify(value));
}

function sortForStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStringify);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortForStringify(entryValue)]),
  );
}
