import { readFile } from "node:fs/promises";
import { resolveWorkspacePath } from "./security.js";
import type { ElementInput } from "./types.js";

export const IMPORT_SOURCE_KINDS = [
  "openapi",
  "package-dependencies",
  "database-schema",
  "markdown-outline",
  "plantuml",
  "structurizr",
] as const;

export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

export interface ImportDiagramSourceArgs {
  kind: ImportSourceKind;
  filePath?: string;
  data?: string;
  title?: string;
  startX?: number;
  startY?: number;
  maxNodes?: number;
}

export interface ImportDiagramSourceResult {
  kind: ImportSourceKind;
  title: string;
  elements: ElementInput[];
  warnings: string[];
  sourceSummary: {
    nodes: number;
    edges: number;
  };
}

interface ParsedNode {
  id: string;
  label: string;
  kind?: string;
}

interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
}

const DEFAULT_START = { x: 80, y: 140 };
const NODE_WIDTH = 230;
const NODE_HEIGHT = 88;
const GAP_X = 100;
const GAP_Y = 100;

export async function importDiagramSource(args: ImportDiagramSourceArgs): Promise<ImportDiagramSourceResult> {
  const source = await readSource(args);
  const parsed = parseByKind(args.kind, source, args.maxNodes ?? 80);
  const title = args.title ?? titleForKind(args.kind);
  const startX = args.startX ?? DEFAULT_START.x;
  const startY = args.startY ?? DEFAULT_START.y;
  const elements = graphToElements(title, parsed.nodes, parsed.edges, startX, startY);
  return {
    kind: args.kind,
    title,
    elements,
    warnings: parsed.warnings,
    sourceSummary: { nodes: parsed.nodes.length, edges: parsed.edges.length },
  };
}

async function readSource(args: ImportDiagramSourceArgs): Promise<string> {
  if (args.data?.trim()) {
    return args.data;
  }
  if (!args.filePath) {
    throw new Error("Provide filePath or data for import.");
  }
  const resolved = resolveWorkspacePath(args.filePath, "");
  return readFile(resolved, "utf8");
}

function parseByKind(kind: ImportSourceKind, source: string, maxNodes: number): {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  warnings: string[];
} {
  if (kind === "openapi") {
    return parseOpenApi(source, maxNodes);
  }
  if (kind === "package-dependencies") {
    return parsePackageDependencies(source, maxNodes);
  }
  if (kind === "database-schema") {
    return parseDatabaseSchema(source, maxNodes);
  }
  if (kind === "markdown-outline") {
    return parseMarkdownOutline(source, maxNodes);
  }
  if (kind === "plantuml") {
    return parsePlantUml(source, maxNodes);
  }
  return parseStructurizr(source, maxNodes);
}

function parseOpenApi(source: string, maxNodes: number) {
  const warnings: string[] = [];
  const nodes: ParsedNode[] = [{ id: "api", label: "OpenAPI", kind: "api-root" }];
  const edges: ParsedEdge[] = [];
  const json = tryParseJson(source);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const root = json as { info?: { title?: string }; paths?: Record<string, Record<string, unknown>> };
    nodes[0] = { id: "api", label: root.info?.title ?? "OpenAPI", kind: "api-root" };
    for (const [route, methods] of Object.entries(root.paths ?? {}).slice(0, maxNodes - 1)) {
      const id = `route-${slugify(route)}`;
      const methodList = Object.keys(methods).filter((method) => /^[a-z]+$/i.test(method)).join(", ").toUpperCase();
      nodes.push({ id, label: `${methodList || "HTTP"}\n${route}`, kind: "route" });
      edges.push({ from: "api", to: id, label: "path" });
    }
    return { nodes, edges, warnings };
  }

  const routeMatches = [...source.matchAll(/^\s{0,4}(\/[^\s:]+)\s*:/gm)].slice(0, maxNodes - 1);
  for (const match of routeMatches) {
    const route = match[1]!;
    const id = `route-${slugify(route)}`;
    nodes.push({ id, label: route, kind: "route" });
    edges.push({ from: "api", to: id, label: "path" });
  }
  warnings.push("Parsed OpenAPI as text/YAML heuristics; JSON gives richer labels.");
  return { nodes, edges, warnings };
}

function parsePackageDependencies(source: string, maxNodes: number) {
  const root = tryParseJson(source) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null;
  if (!root) {
    return { nodes: [{ id: "package", label: "package.json" }], edges: [], warnings: ["Package dependency import expects package.json data."] };
  }
  const nodes: ParsedNode[] = [{ id: "package", label: root.name ?? "package.json", kind: "package" }];
  const edges: ParsedEdge[] = [];
  const dependencies = Object.entries({ ...(root.dependencies ?? {}), ...(root.devDependencies ?? {}) }).slice(0, maxNodes - 1);
  for (const [name, version] of dependencies) {
    const id = `dep-${slugify(name)}`;
    nodes.push({ id, label: `${name}\n${version}`, kind: "dependency" });
    edges.push({ from: "package", to: id, label: root.dependencies?.[name] ? "dep" : "dev" });
  }
  return { nodes, edges, warnings: [] };
}

function parseDatabaseSchema(source: string, maxNodes: number) {
  const tableMatches = [...source.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?([a-zA-Z0-9_.-]+)/gi)].slice(0, maxNodes);
  const nodes = tableMatches.map((match) => ({ id: `table-${slugify(match[1]!)}`, label: match[1]!, kind: "table" }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: ParsedEdge[] = [];
  for (const match of source.matchAll(/references\s+["`[]?([a-zA-Z0-9_.-]+)/gi)) {
    const target = `table-${slugify(match[1]!)}`;
    const sourceTable = nearestTableBefore(source, match.index ?? 0);
    const from = sourceTable ? `table-${slugify(sourceTable)}` : "";
    if (from && nodeIds.has(from) && nodeIds.has(target) && from !== target) {
      edges.push({ from, to: target, label: "FK" });
    }
  }
  return { nodes, edges, warnings: nodes.length === 0 ? ["No CREATE TABLE statements found."] : [] };
}

function parseMarkdownOutline(source: string, maxNodes: number) {
  const headings = [...source.matchAll(/^(#{1,6})\s+(.+)$/gm)].slice(0, maxNodes);
  const nodes = headings.map((match, index) => ({
    id: `heading-${index + 1}-${slugify(match[2]!)}`,
    label: `${match[1]!.length <= 2 ? "" : "  ".repeat(match[1]!.length - 2)}${match[2]!.trim()}`,
    kind: `h${match[1]!.length}`,
  }));
  const stack: Array<{ level: number; id: string }> = [];
  const edges: ParsedEdge[] = [];
  headings.forEach((match, index) => {
    const level = match[1]!.length;
    const id = nodes[index]!.id;
    while (stack.length && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      edges.push({ from: parent.id, to: id });
    }
    stack.push({ level, id });
  });
  return { nodes, edges, warnings: nodes.length === 0 ? ["No Markdown headings found."] : [] };
}

function parsePlantUml(source: string, maxNodes: number) {
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];
  for (const match of source.matchAll(/"?([A-Za-z0-9_. -]+)"?\s*(-+>|-->|->|<-+)\s*"?([A-Za-z0-9_. -]+)"?(?:\s*:\s*(.+))?/g)) {
    const left = cleanupNode(match[1]!);
    const right = cleanupNode(match[3]!);
    const from = match[2]!.startsWith("<") ? right : left;
    const to = match[2]!.startsWith("<") ? left : right;
    addParsedNode(nodes, from);
    addParsedNode(nodes, to);
    edges.push({ from: slugify(from), to: slugify(to), label: match[4]?.trim() });
    if (nodes.size >= maxNodes) {
      break;
    }
  }
  return { nodes: [...nodes.values()].slice(0, maxNodes), edges, warnings: nodes.size === 0 ? ["No PlantUML relationships found."] : [] };
}

function parseStructurizr(source: string, maxNodes: number) {
  const nodes = new Map<string, ParsedNode>();
  const edges: ParsedEdge[] = [];
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(person|softwareSystem|container|component)\s+"([^"]+)"/g)) {
    nodes.set(match[1]!, { id: match[1]!, label: match[3]!, kind: match[2] });
    if (nodes.size >= maxNodes) {
      break;
    }
  }
  for (const match of source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s+"([^"]+)")?/g)) {
    if (nodes.has(match[1]!) && nodes.has(match[2]!)) {
      edges.push({ from: match[1]!, to: match[2]!, label: match[3] });
    }
  }
  return { nodes: [...nodes.values()], edges, warnings: nodes.size === 0 ? ["No Structurizr DSL elements found."] : [] };
}

function graphToElements(
  title: string,
  rawNodes: readonly ParsedNode[],
  rawEdges: readonly ParsedEdge[],
  startX: number,
  startY: number,
): ElementInput[] {
  const nodes = rawNodes.length ? rawNodes : [{ id: "source", label: "Imported source", kind: "source" }];
  const elements: ElementInput[] = [
    { id: "import-title", type: "text", x: startX, y: Math.max(16, startY - 80), width: 720, height: 40, text: title },
  ];
  nodes.forEach((node, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    elements.push({
      id: node.id,
      type: node.kind === "decision" ? "diamond" : "rectangle",
      x: startX + column * (NODE_WIDTH + GAP_X),
      y: startY + row * (NODE_HEIGHT + GAP_Y),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: { text: node.label, fontSize: node.label.length > 28 ? 16 : 18 },
      backgroundColor: fillForKind(node.kind),
      strokeColor: strokeForKind(node.kind),
      fillStyle: "solid",
      roundness: { type: 3 },
      metadata: { semanticType: node.kind ?? "imported-node" },
    });
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of rawEdges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      continue;
    }
    elements.push({
      id: `${edge.from}-to-${edge.to}`.slice(0, 240),
      type: "arrow",
      startElementId: edge.from,
      endElementId: edge.to,
      label: edge.label ? { text: edge.label } : undefined,
    });
  }
  return elements;
}

function tryParseJson(source: string): unknown | null {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return null;
  }
}

function nearestTableBefore(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`[]?([a-zA-Z0-9_.-]+)/gi)];
  return matches.at(-1)?.[1] ?? null;
}

function addParsedNode(nodes: Map<string, ParsedNode>, label: string): void {
  nodes.set(slugify(label), { id: slugify(label), label, kind: "node" });
}

function cleanupNode(value: string): string {
  return value.replace(/^\[|\]$/g, "").trim();
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "node";
}

function titleForKind(kind: ImportSourceKind): string {
  return kind.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}

function fillForKind(kind = ""): string {
  if (/route|api/.test(kind)) return "#dbeafe";
  if (/dependency|package/.test(kind)) return "#fef3c7";
  if (/table|database/.test(kind)) return "#dcfce7";
  if (/heading|person/.test(kind)) return "#ede9fe";
  return "#f8fafc";
}

function strokeForKind(kind = ""): string {
  if (/route|api/.test(kind)) return "#1d4ed8";
  if (/dependency|package/.test(kind)) return "#b45309";
  if (/table|database/.test(kind)) return "#15803d";
  if (/heading|person/.test(kind)) return "#6d28d9";
  return "#475569";
}
