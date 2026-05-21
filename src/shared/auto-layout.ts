import { getElementBox } from "./normalizer.js";
import { routeArrows, type ElementUpdate } from "./quality.js";
import type { DiagramElement, ElementInput } from "./types.js";
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";

export const AUTO_LAYOUT_MODES = ["grid", "row", "column", "layered", "dagre"] as const;
export type AutoLayoutMode = (typeof AUTO_LAYOUT_MODES)[number];

export interface AutoLayoutOptions {
  ids?: string[];
  mode?: AutoLayoutMode;
  startX?: number;
  startY?: number;
  columns?: number;
  gapX?: number;
  gapY?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  routeArrows?: boolean;
  preserveSize?: boolean;
  rankDirection?: "LR" | "TB" | "RL" | "BT";
}

export interface AutoLayoutResult {
  summary: string;
  updates: ElementUpdate[];
  moved: number;
  routed: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface PolishSceneOptions extends AutoLayoutOptions {
  maxPasses?: number;
}

const LINEAR_TYPES = new Set(["arrow", "line"]);
const DEFAULTS = {
  startX: 80,
  startY: 140,
  gapX: 96,
  gapY: 96,
  nodeWidth: 220,
  nodeHeight: 96,
};
const DAGRE_LARGE_GRAPH_NODE_LIMIT = 1_500;

export function autoLayoutElements(elements: readonly DiagramElement[], args: AutoLayoutOptions = {}): AutoLayoutResult {
  const selectedIds = args.ids ? new Set(args.ids) : null;
  const nodes = elements
    .filter((element) => !LINEAR_TYPES.has(element.type))
    .filter((element) => !selectedIds || selectedIds.has(element.id))
    .sort(compareForLayout);
  const arrows = elements.filter((element) => LINEAR_TYPES.has(element.type));

  if (nodes.length === 0) {
    return { summary: "No non-linear elements were selected for layout.", updates: [], moved: 0, routed: 0, bounds: null };
  }

  const mode = args.mode ?? "grid";
  const startX = args.startX ?? DEFAULTS.startX;
  const startY = args.startY ?? DEFAULTS.startY;
  const gapX = args.gapX ?? DEFAULTS.gapX;
  const gapY = args.gapY ?? DEFAULTS.gapY;
  const nodeWidth = args.nodeWidth ?? DEFAULTS.nodeWidth;
  const nodeHeight = args.nodeHeight ?? DEFAULTS.nodeHeight;
  const columns = args.columns ?? defaultColumns(nodes.length, mode);
  const updates: ElementUpdate[] = mode === "dagre" || mode === "layered"
    ? dagreUpdates(nodes, arrows, {
        startX,
        startY,
        gapX,
        gapY,
        nodeWidth,
        nodeHeight,
        preserveSize: args.preserveSize,
        rankDirection: args.rankDirection ?? (mode === "layered" ? "LR" : "LR"),
      })
    : [];

  if (updates.length === 0 && mode !== "dagre" && mode !== "layered") {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      const row = mode === "row" ? 0 : mode === "column" ? index : Math.floor(index / columns);
      const column = mode === "column" ? 0 : mode === "row" ? index : index % columns;
      const width = args.preserveSize ? node.width : Math.max(node.width, nodeWidth);
      const height = args.preserveSize ? node.height : Math.max(node.height, nodeHeight);
      const x = Math.round(startX + column * (width + gapX));
      const y = Math.round(startY + row * (height + gapY));

      if (node.x !== x || node.y !== y || node.width !== width || node.height !== height) {
        updates.push({ id: node.id, x, y, width, height });
      }
    }
  }

  const preview = applyUpdates(elements, updates);
  const routed = args.routeArrows === false ? [] : routeArrows(preview, { avoidObstacles: true, style: "elbow" }).updates;
  const merged = mergeUpdates(updates, routed);
  const next = applyUpdates(elements, merged);
  const bounds = boundsFor(next.filter((element) => !LINEAR_TYPES.has(element.type)));

  return {
    summary: `Prepared ${updates.length} ${mode} layout update(s) and ${routed.length} arrow route update(s).`,
    updates: merged,
    moved: updates.length,
    routed: routed.length,
    bounds,
  };
}

export function polishScene(elements: readonly DiagramElement[], args: PolishSceneOptions = {}): AutoLayoutResult {
  const firstPass = autoLayoutElements(elements, { mode: "grid", routeArrows: true, ...args });
  if (firstPass.updates.length === 0) {
    return { ...firstPass, summary: "Scene already looks layout-stable; no polish updates prepared." };
  }

  return {
    ...firstPass,
    summary: `Polish prepared ${firstPass.updates.length} update(s): ${firstPass.moved} layout and ${firstPass.routed} routed arrow update(s).`,
  };
}

export function inputsFromUpdates(elements: readonly DiagramElement[], updates: readonly ElementUpdate[]): ElementInput[] {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return elements.map((element) => {
    const update = byId.get(element.id);
    return update ? { ...element, ...update } : { ...element };
  });
}

function applyUpdates(elements: readonly DiagramElement[], updates: readonly ElementUpdate[]): DiagramElement[] {
  const byId = new Map(updates.map((update) => [update.id, update]));
  return elements.map((element) => {
    const update = byId.get(element.id);
    return update ? { ...element, ...update } : { ...element };
  });
}

function mergeUpdates(primary: readonly ElementUpdate[], secondary: readonly ElementUpdate[]): ElementUpdate[] {
  const merged = new Map<string, ElementUpdate>();
  for (const update of [...primary, ...secondary]) {
    merged.set(update.id, { ...merged.get(update.id), ...update });
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function compareForLayout(left: DiagramElement, right: DiagramElement): number {
  const leftBox = getElementBox(left);
  const rightBox = getElementBox(right);
  return leftBox.y - rightBox.y || leftBox.x - rightBox.x || left.id.localeCompare(right.id);
}

function defaultColumns(count: number, mode: AutoLayoutMode): number {
  if (mode === "row") {
    return Math.max(1, count);
  }
  if (mode === "column" || mode === "layered" || mode === "dagre") {
    return 1;
  }
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

function dagreUpdates(
  nodes: readonly DiagramElement[],
  arrows: readonly DiagramElement[],
  options: {
    startX: number;
    startY: number;
    gapX: number;
    gapY: number;
    nodeWidth: number;
    nodeHeight: number;
    preserveSize?: boolean;
    rankDirection: "LR" | "TB" | "RL" | "BT";
  },
): ElementUpdate[] {
  const graph = new graphlib.Graph();
  graph.setGraph({
    rankdir: options.rankDirection,
    nodesep: options.gapX,
    ranksep: options.gapY,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(nodes.map((node) => node.id));
  if (nodes.length > DAGRE_LARGE_GRAPH_NODE_LIMIT) {
    return largeGraphLayeredUpdates(nodes, arrows, options);
  }

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: options.preserveSize ? node.width : Math.max(node.width, options.nodeWidth),
      height: options.preserveSize ? node.height : Math.max(node.height, options.nodeHeight),
    });
  }
  for (const arrow of arrows) {
    const from = arrow.startBinding?.elementId ?? arrow.startElementId;
    const to = arrow.endBinding?.elementId ?? arrow.endElementId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) {
      continue;
    }
    graph.setEdge(from, to);
  }

  try {
    dagreLayout(graph);
  } catch {
    return largeGraphLayeredUpdates(nodes, arrows, options);
  }

  const graphNodes = nodes.map((node) => {
    const layoutNode = graph.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
    return {
      node,
      x: layoutNode ? layoutNode.x - layoutNode.width / 2 : node.x,
      y: layoutNode ? layoutNode.y - layoutNode.height / 2 : node.y,
      width: layoutNode?.width ?? node.width,
      height: layoutNode?.height ?? node.height,
    };
  });
  const minX = Math.min(...graphNodes.map((entry) => entry.x));
  const minY = Math.min(...graphNodes.map((entry) => entry.y));

  return graphNodes.flatMap((entry) => {
    const x = Math.round(options.startX + entry.x - minX);
    const y = Math.round(options.startY + entry.y - minY);
    const update = { id: entry.node.id, x, y, width: Math.round(entry.width), height: Math.round(entry.height) };
    if (
      entry.node.x === update.x &&
      entry.node.y === update.y &&
      entry.node.width === update.width &&
      entry.node.height === update.height
    ) {
      return [];
    }
    return [update];
  });
}

function largeGraphLayeredUpdates(
  nodes: readonly DiagramElement[],
  arrows: readonly DiagramElement[],
  options: {
    startX: number;
    startY: number;
    gapX: number;
    gapY: number;
    nodeWidth: number;
    nodeHeight: number;
    preserveSize?: boolean;
    rankDirection: "LR" | "TB" | "RL" | "BT";
  },
): ElementUpdate[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const arrow of arrows) {
    const from = arrow.startBinding?.elementId ?? arrow.startElementId;
    const to = arrow.endBinding?.elementId ?? arrow.endElementId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to) || from === to) {
      continue;
    }
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  for (const id of queue) {
    levels.set(id, 0);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor]!;
    const nextLevel = (levels.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, nextLevel));
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  let fallbackLevel = Math.max(0, ...levels.values());
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      fallbackLevel += 1;
      levels.set(node.id, fallbackLevel);
    }
  }

  const maxLevel = Math.max(0, ...levels.values());
  const levelIndexes = new Map<number, number>();
  const updates: ElementUpdate[] = [];
  for (const node of nodes) {
    const rawLevel = levels.get(node.id) ?? 0;
    const level = options.rankDirection === "RL" || options.rankDirection === "BT" ? maxLevel - rawLevel : rawLevel;
    const index = levelIndexes.get(level) ?? 0;
    levelIndexes.set(level, index + 1);
    const width = options.preserveSize ? node.width : Math.max(node.width, options.nodeWidth);
    const height = options.preserveSize ? node.height : Math.max(node.height, options.nodeHeight);
    const horizontal = options.rankDirection === "LR" || options.rankDirection === "RL";
    const x = Math.round(options.startX + (horizontal ? level * (width + options.gapX) : index * (width + options.gapX)));
    const y = Math.round(options.startY + (horizontal ? index * (height + options.gapY) : level * (height + options.gapY)));
    if (node.x !== x || node.y !== y || node.width !== width || node.height !== height) {
      updates.push({ id: node.id, x, y, width: Math.round(width), height: Math.round(height) });
    }
  }
  return updates;
}

function boundsFor(elements: readonly DiagramElement[]): AutoLayoutResult["bounds"] {
  if (elements.length === 0) {
    return null;
  }
  const boxes = elements.map(getElementBox);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
