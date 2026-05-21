import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

import { createOpaqueId, createSessionToken } from "../shared/security.js";
import type { SceneStore } from "../shared/state.js";
import type {
  CanvasExportResult,
  CanvasServerHandle,
  DiagramElement,
  ViewportState,
} from "../shared/types.js";
import type {
  CanvasClientMessage,
  CanvasScenePatchPayload,
  CanvasScenePayload,
  CanvasServerMessage,
  CanvasSelectionExportResult,
} from "./protocol.js";
import { isRecord, nowIso } from "./protocol.js";

const DEFAULT_HOST = "127.0.0.1";
const EXPORT_TIMEOUT_MS = 30_000;
const BODY_LIMIT = "10mb";

let activeHandle: CanvasServerHandle | null = null;

interface PendingExport {
  resolve: (result: CanvasSelectionExportResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface StoreAdapter {
  store: SceneStore;
  getScene(): CanvasScenePayload;
  setViewport(viewport: Partial<ViewportState>): void;
  applyBrowserScene(scene: CanvasScenePayload): void;
  subscribe(onChange: () => void): (() => void) | undefined;
}

export async function ensureCanvasServer(
  store: SceneStore,
): Promise<CanvasServerHandle> {
  if (activeHandle) {
    activeHandle.broadcastScene();
    return activeHandle;
  }

  const adapter = createStoreAdapter(store);
  const token = createSessionToken();
  const host = process.env.EXCALIDRAW_MCP_CANVAS_HOST || DEFAULT_HOST;
  const requestedPort = parsePort(process.env.EXCALIDRAW_MCP_CANVAS_PORT);
  const app = express();
  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  const pendingExports = new Map<string, PendingExport>();

  app.disable("x-powered-by");
  app.use(express.json({ limit: BODY_LIMIT }));

  app.get("/health", (_request, response) => {
    const scene = adapter.getScene();
    response.json({
      ok: true,
      clients: clients.size,
      elements: scene.elements.length,
      viewport: scene.viewport,
      timestamp: nowIso(),
    });
  });

  app.get("/api/scene", (request, response) => {
    if (!hasValidToken(request, token)) {
      response.status(401).json({ error: "Invalid canvas session token." });
      return;
    }

    response.json(adapter.getScene());
  });

  app.put("/api/scene", (request, response) => {
    if (!hasValidToken(request, token)) {
      response.status(401).json({ error: "Invalid canvas session token." });
      return;
    }

    const scene = normalizeScenePayload(request.body);
    adapter.applyBrowserScene(scene);
    broadcastScene("api_update");
    response.json({ ok: true, scene: adapter.getScene() });
  });

  serveWebApp(app);

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || host}`,
    );

    if (requestUrl.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (requestUrl.searchParams.get("token") !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (webSocket) => {
      wsServer.emit("connection", webSocket, request);
    });
  });

  wsServer.on("connection", (webSocket) => {
    clients.add(webSocket);
    send(webSocket, statusMessage(clients.size));
    send(webSocket, sceneMessage(adapter.getScene(), "connect"));
    broadcastStatus();

    webSocket.on("message", (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) {
        return;
      }

      if (message.type === "client_ready") {
        send(webSocket, sceneMessage(adapter.getScene(), "client_ready"));
        return;
      }

      if (message.type === "client_scene_update") {
        adapter.applyBrowserScene(message.scene);
        return;
      }

      if (message.type === "export_result") {
        handleExportResult(message, pendingExports);
      }
    });

    webSocket.on("close", () => {
      clients.delete(webSocket);
      broadcastStatus();
    });
  });

  const unsubscribe = adapter.subscribe(() => {
    broadcastScene("store_update");
  });

  const port = await listen(server, host, requestedPort);
  const url = `http://${host}:${port}/#token=${encodeURIComponent(token)}`;

  function broadcast(message: CanvasServerMessage): void {
    const serialized = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(serialized);
      }
    }
  }

  function broadcastStatus(): void {
    broadcast(statusMessage(clients.size));
  }

  function broadcastScene(reason: string): void {
    broadcast(sceneMessage(adapter.getScene(), reason));
  }

  function broadcastPatch(patch: CanvasScenePatchPayload, reason: string): void {
    broadcast({
      type: "scene_patch",
      patch: normalizeScenePatchPayload(patch),
      reason,
      timestamp: nowIso(),
    });
  }

  const handle: CanvasServerHandle = {
    url,
    port,
    token,
    clientCount: () => clients.size,
    broadcastScene: () => broadcastScene("manual"),
    broadcastPatch: (patch) => broadcastPatch(patch, "patch"),
    setViewport: (viewport) => {
      adapter.setViewport(viewport);
      broadcast({
        type: "viewport_update",
        viewport,
        timestamp: nowIso(),
      });
      broadcastScene("viewport");
    },
    requestExport: async (format, background, selectedIds) => {
      if (clients.size === 0) {
        throw new Error("Cannot export because no browser canvas is connected.");
      }

      const exportBackground = background ?? true;
      const requestId = createExportRequestId();
      const resultPromise = new Promise<CanvasSelectionExportResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingExports.delete(requestId);
          reject(new Error(`Timed out waiting for ${format} export.`));
        }, EXPORT_TIMEOUT_MS);

        pendingExports.set(requestId, { resolve, reject, timeout });
      });

      broadcast({
        type: "export_request",
        requestId,
        format,
        background: exportBackground,
        selectedIds: selectedIds === undefined ? undefined : [...selectedIds],
        timestamp: nowIso(),
      });

      return resultPromise;
    },
    close: async () => {
      unsubscribe?.();
      for (const pending of pendingExports.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Canvas server closed before export completed."));
      }
      pendingExports.clear();

      for (const client of clients) {
        client.close();
      }
      clients.clear();

      await new Promise<void>((resolve, reject) => {
        wsServer.close((wsError) => {
          if (wsError) {
            reject(wsError);
            return;
          }
          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.close((serverError) => {
          if (serverError) {
            reject(serverError);
            return;
          }
          resolve();
        });
      });

      if (activeHandle === handle) {
        activeHandle = null;
      }
    },
  };

  activeHandle = handle;
  return handle;
}

function createStoreAdapter(store: SceneStore): StoreAdapter {
  const dynamicStore = store as unknown as Record<string, unknown>;

  return {
    store,
    getScene() {
      const rawScene = callStoreMethod(dynamicStore, "getScene");
      if (rawScene) {
        return normalizeScenePayload(rawScene);
      }

      const exported = callStoreMethod(dynamicStore, "exportScene");
      if (exported) {
        return normalizeScenePayload(exported);
      }

      const elements = callStoreMethod(dynamicStore, "getElements");
      const viewport = callStoreMethod(dynamicStore, "getViewport");
      const appState = callStoreMethod(dynamicStore, "getAppState");
      const files = callStoreMethod(dynamicStore, "getFiles");

      return normalizeScenePayload({
        elements,
        viewport,
        appState,
        files,
      });
    },
    setViewport(viewport) {
      if (callStoreMethod(dynamicStore, "setViewport", viewport)) {
        return;
      }
      if (callStoreMethod(dynamicStore, "updateViewport", viewport)) {
        return;
      }

      const current = this.getScene();
      this.applyBrowserScene({
        ...current,
        viewport: { ...current.viewport, ...viewport },
      });
    },
    applyBrowserScene(scene) {
      const normalized = normalizeScenePayload(scene);
      if (callStoreMethod(dynamicStore, "replaceScene", normalized)) {
        return;
      }
      if (callStoreMethod(dynamicStore, "setScene", normalized)) {
        return;
      }
      if (callStoreMethod(dynamicStore, "loadScene", normalized)) {
        return;
      }
      if (callStoreMethod(dynamicStore, "importScene", normalized, "replace")) {
        return;
      }
      callStoreMethod(dynamicStore, "updateScene", normalized);
    },
    subscribe(onChange) {
      const unsubscribe =
        callStoreMethod(dynamicStore, "subscribe", onChange) ||
        callStoreMethod(dynamicStore, "onChange", onChange);

      return typeof unsubscribe === "function"
        ? (unsubscribe as () => void)
        : undefined;
    },
  };
}

function callStoreMethod(
  store: Record<string, unknown>,
  methodName: string,
  ...args: unknown[]
): unknown {
  const method = store[methodName];
  if (typeof method !== "function") {
    return undefined;
  }

  return method.apply(store, args);
}

function normalizeScenePayload(value: unknown): CanvasScenePayload {
  const record = isRecord(value) ? value : {};
  const elements = Array.isArray(record.elements)
    ? (record.elements as DiagramElement[])
    : [];
  const viewport = normalizeViewport(record.viewport ?? record.appState);
  const appState = isRecord(record.appState) ? record.appState : {};
  const files = isRecord(record.files) ? record.files : {};
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : nowIso();

  return {
    elements,
    viewport,
    appState,
    files,
    updatedAt,
  };
}

function normalizeScenePatchPayload(value: unknown): CanvasScenePatchPayload {
  const record = isRecord(value) ? value : {};
  const upserts = Array.isArray(record.upserts) ? (record.upserts as DiagramElement[]) : undefined;
  const deletedIds = Array.isArray(record.deletedIds)
    ? record.deletedIds.filter((id): id is string => typeof id === "string")
    : undefined;
  const viewport = isRecord(record.viewport) ? normalizePartialViewport(record.viewport) : undefined;
  const appState = isRecord(record.appState) ? record.appState : undefined;
  const files = isRecord(record.files) ? record.files : undefined;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : nowIso();
  return { upserts, deletedIds, viewport, appState, files, updatedAt };
}

function normalizePartialViewport(value: Record<string, unknown>): Partial<ViewportState> {
  const viewport: Partial<ViewportState> = {};
  if (typeof value.scrollX === "number") {
    viewport.scrollX = value.scrollX;
  }
  if (typeof value.scrollY === "number") {
    viewport.scrollY = value.scrollY;
  }
  if (typeof value.zoom === "number") {
    viewport.zoom = value.zoom;
  }
  return viewport;
}

function normalizeViewport(value: unknown): ViewportState {
  const record = isRecord(value) ? value : {};
  return {
    scrollX: readNumber(record.scrollX, 0),
    scrollY: readNumber(record.scrollY, 0),
    zoom: readNumber(record.zoom, 1),
  };
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid EXCALIDRAW_MCP_CANVAS_PORT value: ${value}`);
  }

  return port;
}

async function listen(
  server: http.Server,
  host: string,
  port: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Canvas server did not report a TCP port."));
        return;
      }
      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function hasValidToken(
  request: express.Request,
  expectedToken: string,
): boolean {
  const headerToken = request.header("x-excalidraw-mcp-token");
  const queryToken =
    typeof request.query.token === "string" ? request.query.token : undefined;
  return headerToken === expectedToken || queryToken === expectedToken;
}

function send(webSocket: WebSocket, message: CanvasServerMessage): void {
  if (webSocket.readyState === webSocket.OPEN) {
    webSocket.send(JSON.stringify(message));
  }
}

function statusMessage(clientCount: number): CanvasServerMessage {
  return {
    type: "server_status",
    clientCount,
    timestamp: nowIso(),
  };
}

function sceneMessage(
  scene: CanvasScenePayload,
  reason: string,
): CanvasServerMessage {
  return {
    type: "scene_update",
    scene,
    reason,
    timestamp: nowIso(),
  };
}

function parseClientMessage(raw: string): CanvasClientMessage | null {
  try {
    const message = JSON.parse(raw) as unknown;
    if (!isRecord(message) || typeof message.type !== "string") {
      return null;
    }
    return message as CanvasClientMessage;
  } catch {
    return null;
  }
}

function handleExportResult(
  message: CanvasClientMessage,
  pendingExports: Map<string, PendingExport>,
): void {
  if (message.type !== "export_result" || !message.requestId) {
    return;
  }

  const pending = pendingExports.get(message.requestId);
  if (!pending) {
    return;
  }

  pendingExports.delete(message.requestId);
  clearTimeout(pending.timeout);

  if (message.error) {
    pending.reject(new Error(message.error));
    return;
  }

  if (
    !message.format ||
    !message.mimeType ||
    !message.data ||
    !message.encoding
  ) {
    pending.reject(new Error("Browser returned an incomplete export result."));
    return;
  }

  pending.resolve({
    requestId: message.requestId,
    format: message.format,
    mimeType: message.mimeType,
    data: message.data,
    encoding: message.encoding,
    selectedIds: message.selectedIds,
  });
}

function createExportRequestId(): string {
  return createOpaqueId("export");
}

function serveWebApp(app: express.Express): void {
  const webDist = resolveWebDistPath();
  const indexPath = path.join(webDist, "index.html");

  if (fs.existsSync(indexPath)) {
    app.use(express.static(webDist));
    app.get(/.*/, (_request, response) => {
      response.sendFile(indexPath);
    });
    return;
  }

  app.get(/.*/, (_request, response) => {
    response
      .status(503)
      .type("html")
      .send(
        "<!doctype html><title>Excalidraw MCP</title><main>Build the web app with npm run build:web before opening the canvas.</main>",
      );
  });
}

function resolveWebDistPath(): string {
  const cwdDist = path.resolve(process.cwd(), "dist", "web");
  if (fs.existsSync(cwdDist)) {
    return cwdDist;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDirectory = path.dirname(currentFile);
  return path.resolve(currentDirectory, "..", "..", "web");
}
