import type {
  CanvasExportResult,
  CanvasServerHandle,
  DiagramElement,
  ElementInput,
  SceneDescription,
  SceneExport,
  SceneSnapshot,
  ViewportState,
} from "../shared/types.js";
import { closeHeadlessCanvasClient, ensureHeadlessCanvasClient } from "./headless.js";

type MaybePromise<T> = T | Promise<T>;

export interface SceneStoreLike {
  batchCreate(elements: ElementInput[]): MaybePromise<unknown>;
  updateElements(updates: Array<Partial<ElementInput> & { id: string }>): MaybePromise<unknown>;
  deleteElements(ids: string[]): MaybePromise<unknown>;
  clear(): MaybePromise<unknown>;
  query(filter: Record<string, unknown>): MaybePromise<unknown>;
  describe(): MaybePromise<SceneDescription>;
  exportScene(): MaybePromise<SceneExport>;
  importScene(scene: unknown, mode: "replace" | "merge"): MaybePromise<unknown>;
  snapshot(name: string): MaybePromise<SceneSnapshot | unknown>;
  restoreSnapshot(name: string): MaybePromise<unknown>;
  getSnapshot?(name: string): MaybePromise<SceneSnapshot | unknown>;
  setViewport(partial: Partial<ViewportState>): MaybePromise<unknown>;
  getElements(): MaybePromise<DiagramElement[]>;
  getFiles?(): MaybePromise<Record<string, unknown>>;
  addFiles?(files: Record<string, unknown>): MaybePromise<Record<string, unknown>>;
}

export interface ExcalidrawRuntime {
  getStore(): Promise<SceneStoreLike>;
  ensureCanvas(): Promise<CanvasServerHandle>;
  getCanvas(): CanvasServerHandle | undefined;
  broadcastScene(): Promise<void>;
  broadcastPatch(patch: Parameters<NonNullable<CanvasServerHandle["broadcastPatch"]>>[0]): Promise<void>;
  close(): Promise<void>;
}

const stateModulePath = "../shared/state.js";
const canvasServerModulePath = "../canvas/server.js";

export function createRuntime(): ExcalidrawRuntime {
  let storePromise: Promise<SceneStoreLike> | undefined;
  let canvasPromise: Promise<CanvasServerHandle> | undefined;
  let canvasHandle: CanvasServerHandle | undefined;

  async function getStore(): Promise<SceneStoreLike> {
    storePromise ??= loadSceneStore();
    return storePromise;
  }

  async function ensureCanvas(): Promise<CanvasServerHandle> {
    if (canvasHandle !== undefined) {
      return canvasHandle;
    }

    canvasPromise ??= (async () => {
      const store = await getStore();
      const { ensureCanvasServer } = await loadCanvasServer();
      const handle = await ensureCanvasServer(store);
      canvasHandle = handle;
      return handle;
    })();

    try {
      return await canvasPromise;
    } catch (error) {
      canvasPromise = undefined;
      throw error;
    }
  }

  async function broadcastScene(): Promise<void> {
    if (canvasHandle !== undefined) {
      canvasHandle.broadcastScene();
    }
  }

  async function broadcastPatch(patch: Parameters<NonNullable<CanvasServerHandle["broadcastPatch"]>>[0]): Promise<void> {
    if (canvasHandle?.broadcastPatch) {
      canvasHandle.broadcastPatch(patch);
      return;
    }
    await broadcastScene();
  }

  async function close(): Promise<void> {
    await closeHeadlessCanvasClient();
    if (canvasHandle !== undefined) {
      await canvasHandle.close();
      canvasHandle = undefined;
      canvasPromise = undefined;
    }
  }

  return {
    getStore,
    ensureCanvas,
    getCanvas: () => canvasHandle,
    broadcastScene,
    broadcastPatch,
    close,
  };
}

async function loadSceneStore(): Promise<SceneStoreLike> {
  const module = (await import(stateModulePath)) as {
    SceneStore?: new () => SceneStoreLike;
  };

  if (typeof module.SceneStore !== "function") {
    throw new Error("src/shared/state.ts must export SceneStore.");
  }

  return new module.SceneStore();
}

async function loadCanvasServer(): Promise<{
  ensureCanvasServer: (store: SceneStoreLike) => Promise<CanvasServerHandle>;
}> {
  const module = (await import(canvasServerModulePath)) as {
    ensureCanvasServer?: (store: SceneStoreLike) => Promise<CanvasServerHandle>;
  };

  if (typeof module.ensureCanvasServer !== "function") {
    throw new Error("src/canvas/server.ts must export ensureCanvasServer(store).");
  }

  return { ensureCanvasServer: module.ensureCanvasServer };
}

export async function requestCanvasExport(
  runtime: ExcalidrawRuntime,
  format: "png" | "svg",
  background: boolean,
  selectedIds?: string[],
): Promise<CanvasExportResult> {
  const canvas = await runtime.ensureCanvas();
  if (canvas.clientCount() === 0) {
    await ensureHeadlessCanvasClient(canvas.url);
  }
  return canvas.requestExport(format, background, selectedIds);
}
