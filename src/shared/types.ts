export const ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "frame",
  "image",
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export type Point = [number, number];

export interface ElementLabel {
  text: string;
  fontSize?: number;
}

export interface ElementBinding {
  elementId: string;
  fixedPoint?: Point | null;
  focus?: number;
  gap?: number;
}

export interface ElementInput {
  id?: string;
  type: ElementType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  label?: ElementLabel;
  points?: Point[];
  startBinding?: ElementBinding | null;
  endBinding?: ElementBinding | null;
  startElementId?: string;
  endElementId?: string;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  backgroundColor?: string;
  strokeColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  angle?: number;
  roundness?: { type: number; value?: number } | null;
  groupIds?: string[];
  locked?: boolean;
  name?: string;
  fileId?: string;
  containerId?: string | null;
  status?: "pending" | "saved" | "error";
  scale?: Point;
  zIndex?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface DiagramElement extends ElementInput {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  updated: number;
  boundElements?: Array<{ id: string; type: "arrow" | "text" }>;
}

export interface ViewportState {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

export interface SceneSnapshot {
  name: string;
  elements: DiagramElement[];
  viewport: ViewportState;
  files?: Record<string, unknown>;
  createdAt: string;
}

export interface SceneExport {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: DiagramElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface SceneDescription {
  count: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  elements: Array<{
    id: string;
    type: ElementType;
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    label?: string;
    connections?: { start?: string; end?: string };
  }>;
}

export interface CanvasExportResult {
  requestId: string;
  format: "png" | "svg";
  mimeType: "image/png" | "image/svg+xml";
  data: string;
  encoding: "base64" | "utf8";
}

export interface CanvasServerHandle {
  url: string;
  port: number;
  token: string;
  clientCount(): number;
  broadcastScene(): void;
  broadcastPatch?(patch: {
    upserts?: DiagramElement[];
    deletedIds?: string[];
    viewport?: Partial<ViewportState>;
    appState?: Record<string, unknown>;
    files?: Record<string, unknown>;
    updatedAt?: string;
  }): void;
  setViewport(viewport: Partial<ViewportState>): void;
  requestExport(format: "png" | "svg", background?: boolean, selectedIds?: string[]): Promise<CanvasExportResult>;
  close(): Promise<void>;
}
