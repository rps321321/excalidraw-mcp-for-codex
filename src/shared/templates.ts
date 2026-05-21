import type { ElementInput } from "./types.js";

export const DIAGRAM_TEMPLATE_KINDS = [
  "c4-container",
  "flowchart",
  "swimlane",
  "sequence",
  "state-machine",
  "erd",
  "data-flow",
  "github-readme-hero",
  "mcp-tool-map",
] as const;

export type DiagramTemplateKind = (typeof DIAGRAM_TEMPLATE_KINDS)[number];

export interface CreateTemplateDiagramArgs {
  kind: DiagramTemplateKind;
  title?: string;
  startX?: number;
  startY?: number;
  theme?: "technical" | "presentation" | "soft" | "mono";
}

export interface TemplateDiagram {
  kind: DiagramTemplateKind;
  title: string;
  elements: ElementInput[];
  notes: string[];
}

interface TemplateNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  kind?: ElementInput["type"];
  metadata?: Record<string, string>;
}

interface TemplateEdge {
  from: string;
  to: string;
  id?: string;
  label?: string;
}

const DEFAULT_START = { x: 80, y: 140 };
const DEFAULT_SIZE = { width: 220, height: 88 };

export function createTemplateDiagram(args: CreateTemplateDiagramArgs): TemplateDiagram {
  const startX = args.startX ?? DEFAULT_START.x;
  const startY = args.startY ?? DEFAULT_START.y;
  const title = args.title ?? titleForKind(args.kind);
  const palette = paletteFor(args.theme ?? "technical");
  const elements: ElementInput[] = [
    {
      id: "template-title",
      type: "text",
      x: startX,
      y: Math.max(16, startY - 72),
      width: 720,
      height: 40,
      text: title,
      strokeColor: palette.text,
      metadata: { role: "title", template: args.kind },
    },
  ];

  const { nodes, edges, notes, frames } = blueprintForKind(args.kind, startX, startY, palette);
  elements.push(...(frames ?? []));
  elements.push(...nodes.map((node, index) => nodeToElement(node, palette, index)));
  elements.push(...edges.map(edgeToElement));

  return {
    kind: args.kind,
    title,
    elements,
    notes: [
      ...notes,
      "Inspect the generated template before adding details.",
      "Use stable IDs from the template for follow-up edits.",
    ],
  };
}

function blueprintForKind(
  kind: DiagramTemplateKind,
  startX: number,
  startY: number,
  palette: ReturnType<typeof paletteFor>,
): { nodes: TemplateNode[]; edges: TemplateEdge[]; notes: string[]; frames?: ElementInput[] } {
  if (kind === "c4-container") {
    return {
      nodes: [
        node("person", "User", startX, startY, palette.blue, palette.blueStroke, "ellipse", "person"),
        node("web-app", "Web app", startX + 300, startY, palette.green, palette.greenStroke, "rectangle", "container"),
        node("api", "API service", startX + 600, startY, palette.yellow, palette.yellowStroke, "rectangle", "container"),
        node("db", "Database", startX + 900, startY, palette.pink, palette.pinkStroke, "rectangle", "database"),
        node("external", "External system", startX + 600, startY + 190, palette.purple, palette.purpleStroke, "rectangle", "external-system"),
      ],
      edges: [
        { from: "person", to: "web-app", label: "uses" },
        { from: "web-app", to: "api", label: "calls" },
        { from: "api", to: "db", label: "reads/writes" },
        { from: "api", to: "external", label: "integrates" },
      ],
      notes: ["C4 containers should include people, software systems, containers, and external dependencies."],
    };
  }

  if (kind === "swimlane") {
    const lanes = ["User", "Codex", "MCP Server"];
    const frames = lanes.map((lane, index): ElementInput => ({
      id: `lane-${index + 1}`,
      type: "frame",
      name: lane,
      x: startX,
      y: startY + index * 150,
      width: 940,
      height: 120,
      strokeColor: palette.muted,
      backgroundColor: "transparent",
    }));
    return {
      frames,
      nodes: [
        node("request", "Request diagram", startX + 40, startY + 25, palette.blue, palette.blueStroke),
        node("plan", "Plan layout", startX + 330, startY + 175, palette.green, palette.greenStroke),
        node("draw", "Apply tools", startX + 620, startY + 325, palette.yellow, palette.yellowStroke),
        node("review", "Review screenshot", startX + 620, startY + 175, palette.purple, palette.purpleStroke),
        node("export", "Export assets", startX + 330, startY + 25, palette.pink, palette.pinkStroke),
      ],
      edges: [
        { from: "request", to: "plan" },
        { from: "plan", to: "draw" },
        { from: "draw", to: "review" },
        { from: "review", to: "export" },
      ],
      notes: ["Swimlanes use frames named by actor or system boundary."],
    };
  }

  if (kind === "sequence") {
    return {
      nodes: [
        node("actor", "Actor", startX, startY, palette.blue, palette.blueStroke),
        node("agent", "Codex", startX + 300, startY, palette.green, palette.greenStroke),
        node("tool", "MCP tool", startX + 600, startY, palette.yellow, palette.yellowStroke),
        node("canvas", "Canvas", startX + 900, startY, palette.pink, palette.pinkStroke),
      ],
      edges: [
        { from: "actor", to: "agent", label: "prompt" },
        { from: "agent", to: "tool", label: "call" },
        { from: "tool", to: "canvas", label: "update" },
        { from: "canvas", to: "agent", label: "screenshot" },
      ],
      notes: ["Use sequence templates for call/response narratives; add vertical lifelines as plain lines if needed."],
    };
  }

  if (kind === "state-machine") {
    return {
      nodes: [
        node("idle", "Idle", startX, startY, palette.blue, palette.blueStroke, "ellipse"),
        node("planning", "Planning", startX + 280, startY, palette.green, palette.greenStroke),
        node("drawing", "Drawing", startX + 560, startY, palette.yellow, palette.yellowStroke),
        node("reviewing", "Reviewing", startX + 840, startY, palette.purple, palette.purpleStroke),
        node("done", "Done", startX + 560, startY + 190, palette.pink, palette.pinkStroke, "ellipse"),
      ],
      edges: [
        { from: "idle", to: "planning" },
        { from: "planning", to: "drawing" },
        { from: "drawing", to: "reviewing" },
        { from: "reviewing", to: "drawing", label: "fix" },
        { from: "reviewing", to: "done", label: "approved" },
      ],
      notes: ["State-machine templates work best with short verb or noun labels."],
    };
  }

  if (kind === "erd") {
    return {
      nodes: [
        node("users", "users\nid\nemail\ncreated_at", startX, startY, palette.blue, palette.blueStroke),
        node("projects", "projects\nid\nowner_id\nname", startX + 330, startY, palette.green, palette.greenStroke),
        node("diagrams", "diagrams\nid\nproject_id\nscene_json", startX + 660, startY, palette.yellow, palette.yellowStroke),
      ],
      edges: [
        { from: "users", to: "projects", label: "1:N" },
        { from: "projects", to: "diagrams", label: "1:N" },
      ],
      notes: ["ERD templates use multi-line labels; expand boxes before adding many columns."],
    };
  }

  if (kind === "data-flow") {
    return {
      nodes: [
        node("source", "Source", startX, startY, palette.blue, palette.blueStroke),
        node("ingest", "Ingest", startX + 280, startY, palette.green, palette.greenStroke),
        node("transform", "Transform", startX + 560, startY, palette.yellow, palette.yellowStroke),
        node("store", "Store", startX + 840, startY, palette.pink, palette.pinkStroke),
        node("consumer", "Consumer", startX + 560, startY + 180, palette.purple, palette.purpleStroke),
      ],
      edges: [
        { from: "source", to: "ingest" },
        { from: "ingest", to: "transform" },
        { from: "transform", to: "store" },
        { from: "store", to: "consumer" },
      ],
      notes: ["Data-flow diagrams should label storage, transforms, and external boundaries."],
    };
  }

  if (kind === "github-readme-hero") {
    return {
      nodes: [
        node("prompt", "Prompt", startX, startY, palette.blue, palette.blueStroke),
        node("agent", "Codex agent", startX + 270, startY, palette.green, palette.greenStroke),
        node("mcp", "Excalidraw MCP", startX + 560, startY, palette.yellow, palette.yellowStroke),
        node("canvas", "Live canvas", startX + 870, startY, palette.pink, palette.pinkStroke),
        node("assets", "README assets", startX + 560, startY + 180, palette.purple, palette.purpleStroke),
      ],
      edges: [
        { from: "prompt", to: "agent" },
        { from: "agent", to: "mcp" },
        { from: "mcp", to: "canvas" },
        { from: "canvas", to: "assets" },
        { from: "assets", to: "agent", label: "inspect/fix" },
      ],
      notes: ["GitHub README hero diagrams should communicate the product in one glance."],
    };
  }

  if (kind === "mcp-tool-map") {
    return {
      nodes: [
        node("create", "Create/edit", startX, startY, palette.blue, palette.blueStroke),
        node("inspect", "Inspect/query", startX + 280, startY, palette.green, palette.greenStroke),
        node("quality", "Quality tools", startX + 560, startY, palette.yellow, palette.yellowStroke),
        node("export", "Export/session", startX + 840, startY, palette.pink, palette.pinkStroke),
        node("sources", "Mermaid/repo/templates", startX + 420, startY + 180, palette.purple, palette.purpleStroke),
      ],
      edges: [
        { from: "sources", to: "create" },
        { from: "create", to: "inspect" },
        { from: "inspect", to: "quality" },
        { from: "quality", to: "create", label: "fix" },
        { from: "quality", to: "export" },
      ],
      notes: ["Use tool maps to teach agents which capability to call next."],
    };
  }

  return {
    nodes: [
      node("start", "Start", startX, startY, palette.blue, palette.blueStroke),
      node("step-1", "Step 1", startX + 280, startY, palette.green, palette.greenStroke),
      node("decision", "Decision?", startX + 560, startY, palette.yellow, palette.yellowStroke, "diamond"),
      node("finish", "Finish", startX + 840, startY, palette.pink, palette.pinkStroke),
    ],
    edges: [
      { from: "start", to: "step-1" },
      { from: "step-1", to: "decision" },
      { from: "decision", to: "finish" },
    ],
    notes: ["Flowcharts should use diamonds only for real decisions."],
  };
}

function node(
  id: string,
  label: string,
  x: number,
  y: number,
  fill: string,
  stroke: string,
  kind: ElementInput["type"] = "rectangle",
  semanticType?: string,
): TemplateNode {
  return { id, label, x, y, fill, stroke, kind, metadata: semanticType ? { semanticType } : undefined };
}

function nodeToElement(node: TemplateNode, palette: ReturnType<typeof paletteFor>, index: number): ElementInput {
  return {
    id: node.id,
    type: node.kind ?? "rectangle",
    x: node.x,
    y: node.y,
    width: node.width ?? DEFAULT_SIZE.width,
    height: node.height ?? DEFAULT_SIZE.height,
    label: { text: node.label, fontSize: node.label.includes("\n") ? 17 : 20 },
    backgroundColor: node.fill ?? palette.fills[index % palette.fills.length]!,
    strokeColor: node.stroke ?? palette.stroke,
    fillStyle: "solid",
    roundness: node.kind === "diamond" ? undefined : { type: 3 },
    metadata: node.metadata,
  };
}

function edgeToElement(edge: TemplateEdge): ElementInput {
  return {
    id: edge.id ?? `${edge.from}-to-${edge.to}`,
    type: "arrow",
    startElementId: edge.from,
    endElementId: edge.to,
    label: edge.label ? { text: edge.label } : undefined,
    strokeWidth: 2,
  };
}

function titleForKind(kind: DiagramTemplateKind): string {
  return kind
    .split("-")
    .map((part) => part === "c4" || part === "mcp" || part === "erd" ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function paletteFor(theme: NonNullable<CreateTemplateDiagramArgs["theme"]>) {
  if (theme === "mono") {
    return {
      text: "#111827",
      stroke: "#374151",
      muted: "#9ca3af",
      blue: "#f3f4f6",
      blueStroke: "#374151",
      green: "#e5e7eb",
      greenStroke: "#374151",
      yellow: "#f9fafb",
      yellowStroke: "#374151",
      pink: "#f3f4f6",
      pinkStroke: "#374151",
      purple: "#e5e7eb",
      purpleStroke: "#374151",
      fills: ["#f3f4f6", "#e5e7eb", "#f9fafb"],
    };
  }

  if (theme === "soft") {
    return {
      text: "#1f2937",
      stroke: "#475569",
      muted: "#94a3b8",
      blue: "#e0f2fe",
      blueStroke: "#0369a1",
      green: "#dcfce7",
      greenStroke: "#15803d",
      yellow: "#fef9c3",
      yellowStroke: "#a16207",
      pink: "#fce7f3",
      pinkStroke: "#be185d",
      purple: "#ede9fe",
      purpleStroke: "#6d28d9",
      fills: ["#e0f2fe", "#dcfce7", "#fef9c3", "#fce7f3", "#ede9fe"],
    };
  }

  return {
    text: "#111827",
    stroke: "#334155",
    muted: "#64748b",
    blue: "#dbeafe",
    blueStroke: "#1d4ed8",
    green: "#dcfce7",
    greenStroke: "#15803d",
    yellow: "#fef3c7",
    yellowStroke: "#b45309",
    pink: "#fce7f3",
    pinkStroke: "#be185d",
    purple: "#ede9fe",
    purpleStroke: "#6d28d9",
    fills: ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#ede9fe"],
  };
}
