import type {
  CanvasExportResult,
  DiagramElement,
  ViewportState,
} from "../shared/types.js";

export interface CanvasSelectionExportResult extends CanvasExportResult {
  selectedIds?: string[];
}

export interface CanvasScenePayload {
  elements: DiagramElement[];
  viewport: ViewportState;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  updatedAt?: string;
}

export interface CanvasScenePatchPayload {
  upserts?: DiagramElement[];
  deletedIds?: string[];
  viewport?: Partial<ViewportState>;
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
  updatedAt?: string;
}

export type CanvasServerMessage =
  | {
      type: "server_status";
      clientCount: number;
      timestamp: string;
    }
  | {
      type: "scene_update";
      scene: CanvasScenePayload;
      reason?: string;
      timestamp: string;
    }
  | {
      type: "scene_patch";
      patch: CanvasScenePatchPayload;
      reason?: string;
      timestamp: string;
    }
  | {
      type: "viewport_update";
      viewport: Partial<ViewportState>;
      timestamp: string;
    }
  | {
      type: "export_request";
      requestId: string;
      format: "png" | "svg";
      background: boolean;
      selectedIds?: string[];
      timestamp: string;
    };

export type CanvasClientMessage =
  | {
      type: "client_ready";
      timestamp?: string;
    }
  | {
      type: "client_scene_update";
      scene: CanvasScenePayload;
      timestamp?: string;
    }
  | ({
      type: "export_result";
      error?: string;
      selectedIds?: string[];
    } & Partial<CanvasSelectionExportResult>);

export function filterElementsBySelectedIds<T extends { id: string }>(
  elements: readonly T[],
  selectedIds?: readonly string[],
): T[] {
  if (selectedIds === undefined) {
    return [...elements];
  }

  const selected = new Set(selectedIds);
  return elements.filter((element) => selected.has(element.id));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function nowIso(): string {
  return new Date().toISOString();
}
