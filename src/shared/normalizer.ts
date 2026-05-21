import { createElementId } from "./ids.js";
import type {
  DiagramElement,
  ElementBinding,
  ElementInput,
  ElementLabel,
  ElementType,
  Point,
} from "./types.js";

export type IdFactory = (prefix?: string) => string;

export interface NormalizeBatchOptions {
  existingElements?: readonly DiagramElement[];
  idFactory?: IdFactory;
  now?: () => number;
  disallowExistingIds?: boolean;
}

const DEFAULT_ELEMENT_WIDTH = 180;
const DEFAULT_ELEMENT_HEIGHT = 90;
const DEFAULT_FRAME_WIDTH = 640;
const DEFAULT_FRAME_HEIGHT = 420;
const DEFAULT_LINEAR_LENGTH = 160;
const DEFAULT_FONT_SIZE = 20;
const LABEL_HORIZONTAL_PADDING = 40;
const LABEL_VERTICAL_PADDING = 32;
const DEFAULT_BINDING_GAP = 8;

const SHAPE_TYPES = new Set<ElementType>(["rectangle", "ellipse", "diamond", "frame"]);
const LINEAR_TYPES = new Set<ElementType>(["arrow", "line"]);

export function normalizeElementBatch(
  inputs: readonly ElementInput[],
  options: NormalizeBatchOptions = {},
): DiagramElement[] {
  const idFactory = options.idFactory ?? createElementId;
  const now = options.now ?? Date.now;
  const timestamp = now();
  const existingById = toElementMap(options.existingElements ?? []);
  const reservedIds = new Set(existingById.keys());
  const inputIdByIndex = resolveInputIds(inputs, idFactory, reservedIds, options.disallowExistingIds ?? false);

  const pendingById = new Map<string, DiagramElement>();
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (!LINEAR_TYPES.has(input.type)) {
      const element = normalizeNonLinearElement(input, inputIdByIndex[index]!, timestamp);
      pendingById.set(element.id, element);
    }
  }

  const lookup = (id: string): DiagramElement | undefined => pendingById.get(id) ?? existingById.get(id);
  const normalized: DiagramElement[] = [];

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const id = inputIdByIndex[index]!;
    const element = LINEAR_TYPES.has(input.type)
      ? normalizeLinearElement(input, id, timestamp, lookup)
      : pendingById.get(id)!;
    normalized.push(element);
    pendingById.set(element.id, element);
  }

  return normalized;
}

export function rebuildBoundElements(elements: readonly DiagramElement[]): DiagramElement[] {
  const cloned = elements.map((element) => cloneElement({ ...element, boundElements: undefined }));
  const byId = toElementMap(cloned);

  for (const element of cloned) {
    if (!LINEAR_TYPES.has(element.type)) {
      continue;
    }

    for (const binding of [element.startBinding, element.endBinding]) {
      if (!binding?.elementId) {
        continue;
      }
      const target = byId.get(binding.elementId);
      if (!target) {
        continue;
      }
      const existing = target.boundElements ?? [];
      if (!existing.some((bound) => bound.id === element.id && bound.type === "arrow")) {
        target.boundElements = [...existing, { id: element.id, type: "arrow" }];
      }
    }
  }

  return cloned;
}

export function recalculateBoundLinearElements(elements: readonly DiagramElement[]): DiagramElement[] {
  const byId = toElementMap(elements);
  const recalculated = elements.map((element) => {
    if (!LINEAR_TYPES.has(element.type)) {
      return cloneElement(element);
    }

    const normalized = normalizeLinearElement(element, element.id, element.updated, (id) => {
      const target = byId.get(id);
      return target?.id === element.id ? undefined : target;
    });
    return { ...normalized, version: element.version, updated: element.updated };
  });

  return rebuildBoundElements(recalculated);
}

export function cloneElement(element: DiagramElement): DiagramElement {
  return JSON.parse(JSON.stringify(element)) as DiagramElement;
}

export function cloneElements(elements: readonly DiagramElement[]): DiagramElement[] {
  return elements.map(cloneElement);
}

export function estimateTextDimensions(text: string, fontSize = DEFAULT_FONT_SIZE): { width: number; height: number } {
  const lines = text.length > 0 ? text.split(/\r?\n/) : [""];
  const longestLine = Math.max(...lines.map((line) => line.length), 1);
  return {
    width: Math.ceil(longestLine * fontSize * 0.62) + 16,
    height: Math.ceil(lines.length * fontSize * 1.25) + 12,
  };
}

export function getElementBounds(elements: readonly DiagramElement[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (elements.length === 0) {
    return null;
  }

  const boxes = elements.map((element) => getElementBox(element));
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function getElementBox(element: DiagramElement): { x: number; y: number; width: number; height: number } {
  if (LINEAR_TYPES.has(element.type) && element.points && element.points.length > 0) {
    const absolutePoints = element.points.map(([x, y]) => [element.x + x, element.y + y] as Point);
    const minX = Math.min(...absolutePoints.map(([x]) => x));
    const minY = Math.min(...absolutePoints.map(([, y]) => y));
    const maxX = Math.max(...absolutePoints.map(([x]) => x));
    const maxY = Math.max(...absolutePoints.map(([, y]) => y));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

export function getLinearAbsoluteEndpoints(element: DiagramElement): { start: Point; end: Point } | null {
  if (!LINEAR_TYPES.has(element.type) || !element.points || element.points.length < 2) {
    return null;
  }

  const first = element.points[0]!;
  const last = element.points[element.points.length - 1]!;
  return {
    start: [element.x + first[0], element.y + first[1]],
    end: [element.x + last[0], element.y + last[1]],
  };
}

function resolveInputIds(
  inputs: readonly ElementInput[],
  idFactory: IdFactory,
  reservedIds: Set<string>,
  disallowExistingIds: boolean,
): string[] {
  const batchIds = new Set<string>();

  return inputs.map((input) => {
    let id = input.id;
    if (id) {
      if (batchIds.has(id)) {
        throw new Error(`Duplicate element id in batch: ${id}`);
      }
      if (disallowExistingIds && reservedIds.has(id)) {
        throw new Error(`Element already exists: ${id}`);
      }
    } else {
      do {
        id = idFactory(input.type);
      } while (batchIds.has(id) || reservedIds.has(id));
    }

    batchIds.add(id);
    reservedIds.add(id);
    return id;
  });
}

function normalizeNonLinearElement(input: ElementInput, id: string, timestamp: number): DiagramElement {
  const type = input.type;
  const isText = type === "text";
  const label = normalizeLabel(input);
  const text = isText ? input.text ?? input.label?.text ?? "" : undefined;
  const estimatedText = isText
    ? estimateTextDimensions(text ?? "")
    : label
      ? estimateTextDimensions(label.text, label.fontSize)
      : null;

  const defaultWidth = type === "frame" ? DEFAULT_FRAME_WIDTH : isText ? estimatedText!.width : DEFAULT_ELEMENT_WIDTH;
  const defaultHeight = type === "frame" ? DEFAULT_FRAME_HEIGHT : isText ? estimatedText!.height : DEFAULT_ELEMENT_HEIGHT;
  const minWidth = estimatedText ? estimatedText.width + (isText ? 0 : LABEL_HORIZONTAL_PADDING) : 1;
  const minHeight = estimatedText ? estimatedText.height + (isText ? 0 : LABEL_VERTICAL_PADDING) : 1;

  return pruneUndefined({
    ...copyCommonElementProps(input),
    id,
    type,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: Math.max(input.width ?? defaultWidth, minWidth),
    height: Math.max(input.height ?? defaultHeight, minHeight),
    text,
    label: isText ? undefined : label,
    points: undefined,
    version: 1,
    updated: timestamp,
  });
}

function normalizeLinearElement(
  input: ElementInput,
  id: string,
  timestamp: number,
  lookup: (id: string) => DiagramElement | undefined,
): DiagramElement {
  const startBinding = normalizeBinding(input.startBinding, input.startElementId);
  const endBinding = normalizeBinding(input.endBinding, input.endElementId);
  const startElement = startBinding ? lookup(startBinding.elementId) : undefined;
  const endElement = endBinding ? lookup(endBinding.elementId) : undefined;
  const points = resolveLinearPoints(input, startBinding, endBinding, startElement, endElement);
  const x = points.origin[0];
  const y = points.origin[1];

  return pruneUndefined({
    ...copyCommonElementProps(input),
    id,
    type: input.type,
    x,
    y,
    width: Math.max(input.width ?? points.width, 1),
    height: Math.max(input.height ?? points.height, 1),
    points: points.relative,
    startBinding: startBinding ?? undefined,
    endBinding: endBinding ?? undefined,
    startElementId: startBinding?.elementId,
    endElementId: endBinding?.elementId,
    startArrowhead: input.startArrowhead ?? null,
    endArrowhead: input.endArrowhead ?? (input.type === "arrow" ? "arrow" : null),
    label: normalizeLabel(input),
    text: undefined,
    version: 1,
    updated: timestamp,
  });
}

function resolveLinearPoints(
  input: ElementInput,
  startBinding: ElementBinding | undefined,
  endBinding: ElementBinding | undefined,
  startElement: DiagramElement | undefined,
  endElement: DiagramElement | undefined,
): { origin: Point; relative: Point[]; width: number; height: number } {
  if (input.points && input.points.length >= 2) {
    const origin: Point = [input.x ?? input.points[0]![0], input.y ?? input.points[0]![1]];
    const relative =
      input.x === undefined && input.y === undefined
        ? input.points.map(([x, y]) => [x - origin[0], y - origin[1]] as Point)
        : input.points.map(([x, y]) => [x, y] as Point);
    return linearPointMetrics(origin, relative);
  }

  const fallbackStart: Point = [input.x ?? 0, input.y ?? 0];
  const fallbackEnd: Point = [fallbackStart[0] + (input.width ?? DEFAULT_LINEAR_LENGTH), fallbackStart[1]];
  let start = startElement
    ? edgePoint(startElement, endElement, fallbackEnd, startBinding?.fixedPoint, startBinding?.gap)
    : fallbackStart;
  let end = endElement ? edgePoint(endElement, startElement, start, endBinding?.fixedPoint, endBinding?.gap) : fallbackEnd;

  if (startElement && !endElement) {
    start = edgePoint(startElement, undefined, end, startBinding?.fixedPoint, startBinding?.gap);
  }
  if (endElement && !startElement) {
    end = edgePoint(endElement, undefined, start, endBinding?.fixedPoint, endBinding?.gap);
  }

  return linearPointMetrics(start, [
    [0, 0],
    [end[0] - start[0], end[1] - start[1]],
  ]);
}

function linearPointMetrics(origin: Point, relative: Point[]): { origin: Point; relative: Point[]; width: number; height: number } {
  const minX = Math.min(...relative.map(([x]) => x));
  const minY = Math.min(...relative.map(([, y]) => y));
  const maxX = Math.max(...relative.map(([x]) => x));
  const maxY = Math.max(...relative.map(([, y]) => y));
  return {
    origin,
    relative,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function edgePoint(
  element: DiagramElement,
  towardElement: DiagramElement | undefined,
  fallbackToward: Point,
  fixedPoint: Point | null | undefined,
  gap = DEFAULT_BINDING_GAP,
): Point {
  if (fixedPoint) {
    return [element.x + element.width * fixedPoint[0], element.y + element.height * fixedPoint[1]];
  }

  const center = elementCenter(element);
  const targetCenter = towardElement ? elementCenter(towardElement) : fallbackToward;
  const dx = targetCenter[0] - center[0];
  const dy = targetCenter[1] - center[1];
  const halfWidth = Math.max(element.width / 2, 1);
  const halfHeight = Math.max(element.height / 2, 1);
  const divisor = Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight, 1);
  const edgeX = center[0] + dx / divisor;
  const edgeY = center[1] + dy / divisor;
  const distance = Math.hypot(dx, dy) || 1;

  return [edgeX + (dx / distance) * gap, edgeY + (dy / distance) * gap];
}

function elementCenter(element: DiagramElement): Point {
  const box = getElementBox(element);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

function normalizeBinding(binding: ElementBinding | null | undefined, elementId: string | undefined): ElementBinding | undefined {
  const resolvedElementId = binding?.elementId ?? elementId;
  if (!resolvedElementId) {
    return undefined;
  }

  return pruneUndefined({
    elementId: resolvedElementId,
    fixedPoint: binding?.fixedPoint,
    focus: binding?.focus,
    gap: binding?.gap,
  });
}

function normalizeLabel(input: ElementInput): ElementLabel | undefined {
  if (input.label) {
    return { ...input.label };
  }
  if (SHAPE_TYPES.has(input.type) && input.text) {
    return { text: input.text };
  }
  return undefined;
}

function copyCommonElementProps(input: ElementInput): Partial<DiagramElement> {
  return pruneUndefined({
    backgroundColor: input.backgroundColor ?? "transparent",
    strokeColor: input.strokeColor ?? "#1e1e1e",
    fillStyle: input.fillStyle ?? "hachure",
    strokeWidth: input.strokeWidth ?? 2,
    strokeStyle: input.strokeStyle ?? "solid",
    roughness: input.roughness ?? 1,
    opacity: input.opacity ?? 100,
    angle: input.angle ?? 0,
    roundness: input.roundness,
    groupIds: input.groupIds ? [...input.groupIds] : [],
    locked: input.locked ?? false,
    name: input.name,
    fileId: input.fileId,
    containerId: input.containerId,
    status: input.status,
    scale: input.scale ? [...input.scale] : undefined,
    zIndex: input.zIndex,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  });
}

function toElementMap(elements: readonly DiagramElement[]): Map<string, DiagramElement> {
  return new Map(elements.map((element) => [element.id, element]));
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
