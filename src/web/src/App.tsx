import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DiagramElement, ViewportState } from "../../shared/types.js";
import type {
  CanvasClientMessage,
  CanvasScenePatchPayload,
  CanvasScenePayload,
  CanvasServerMessage,
} from "../../canvas/protocol.js";
import { filterElementsBySelectedIds } from "../../canvas/protocol.js";

type ConnectionState = "missing-token" | "connecting" | "connected" | "closed";
type RemoteAppState = Pick<
  AppState,
  "scrollX" | "scrollY" | "zoom" | "viewBackgroundColor" | "theme"
>;

const DEFAULT_VIEWPORT: ViewportState = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
};

function readSessionToken(): string | null {
  const searchToken = new URLSearchParams(location.search).get("token");
  if (searchToken) {
    return searchToken;
  }
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  return new URLSearchParams(hash).get("token");
}

export default function App() {
  const token = useMemo(() => readSessionToken(), []);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const applyingRemoteSceneRef = useRef(false);
  const pendingRemoteSceneRef = useRef<CanvasScenePayload | null>(null);
  const pendingSceneRef = useRef<CanvasScenePayload | null>(null);
  const pushTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const [connection, setConnection] = useState<ConnectionState>(
    token ? "connecting" : "missing-token",
  );
  const [clientCount, setClientCount] = useState(0);
  const [elementCount, setElementCount] = useState(0);
  const [lastSync, setLastSync] = useState<string>("never");
  const [lastExport, setLastExport] = useState<string>("none");

  const sendMessage = useCallback((message: CanvasClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }, []);

  const applyScene = useCallback((scene: CanvasScenePayload) => {
    const api = apiRef.current;
    if (!api) {
      pendingRemoteSceneRef.current = scene;
      return;
    }

    applyingRemoteSceneRef.current = true;
    pendingSceneRef.current = null;
    if (pushTimerRef.current !== null) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }

    const elements = toExcalidrawElements(scene.elements);
    if (scene.files && Object.keys(scene.files).length > 0) {
      api.addFiles(Object.values(scene.files) as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
    }
    api.updateScene({
      elements,
      appState: toExcalidrawAppState(scene),
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    window.setTimeout(() => {
      applyingRemoteSceneRef.current = false;
    }, 0);

    setElementCount(scene.elements.length);
    setLastSync(new Date().toLocaleTimeString());
  }, []);

  const applyScenePatch = useCallback((patch: CanvasScenePatchPayload) => {
    const api = apiRef.current;
    if (!api) {
      return;
    }

    applyingRemoteSceneRef.current = true;
    const deletedIds = new Set(patch.deletedIds ?? []);
    const current = api.getSceneElements().filter((element) => !deletedIds.has(element.id)) as unknown as DiagramElement[];
    const byId = new Map(current.map((element) => [element.id, element]));
    for (const element of patch.upserts ?? []) {
      byId.set(element.id, element);
    }
    if (patch.files && Object.keys(patch.files).length > 0) {
      api.addFiles(Object.values(patch.files) as Parameters<ExcalidrawImperativeAPI["addFiles"]>[0]);
    }
    const currentAppState = api.getAppState();
    api.updateScene({
      elements: toExcalidrawElements([...byId.values()]),
      appState: {
        ...currentAppState,
        ...patch.appState,
        scrollX: patch.viewport?.scrollX ?? currentAppState.scrollX,
        scrollY: patch.viewport?.scrollY ?? currentAppState.scrollY,
        zoom: {
          value: readZoomValue(patch.viewport?.zoom, currentAppState.zoom.value),
        },
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    window.setTimeout(() => {
      applyingRemoteSceneRef.current = false;
    }, 0);
    setElementCount(byId.size);
    setLastSync(new Date().toLocaleTimeString());
  }, []);

  const handleExportRequest = useCallback(
    async (message: Extract<CanvasServerMessage, { type: "export_request" }>) => {
      try {
        const api = apiRef.current;
        if (!api) {
          throw new Error("Excalidraw API is not ready yet.");
        }

        const elements = api
          .getSceneElements()
          .filter((element) => !element.isDeleted) as NonDeleted<ExcalidrawElement>[];
        const exportElements = filterElementsBySelectedIds(
          elements,
          message.selectedIds,
        );
        const appState = api.getAppState();
        const files = api.getFiles();

        if (message.format === "png") {
          const blob = await exportToBlob({
            elements: exportElements,
            appState: exportAppState(appState, message.background),
            files,
            mimeType: "image/png",
            exportPadding: 24,
          });
          const data = await blobToBase64(blob);
          sendMessage({
            type: "export_result",
            requestId: message.requestId,
            format: "png",
            mimeType: "image/png",
            encoding: "base64",
            data,
            selectedIds: message.selectedIds,
          });
          setLastExport(`PNG ${new Date().toLocaleTimeString()}`);
          return;
        }

        const svg = await exportToSvg({
          elements: exportElements,
          appState: exportAppState(appState, message.background),
          files,
          exportPadding: 24,
        });
        const data = new XMLSerializer().serializeToString(svg);
        sendMessage({
          type: "export_result",
          requestId: message.requestId,
          format: "svg",
          mimeType: "image/svg+xml",
          encoding: "utf8",
          data,
          selectedIds: message.selectedIds,
        });
        setLastExport(`SVG ${new Date().toLocaleTimeString()}`);
      } catch (error) {
        sendMessage({
          type: "export_result",
          requestId: message.requestId,
          error: error instanceof Error ? error.message : String(error),
          selectedIds: message.selectedIds,
        });
      }
    },
    [sendMessage],
  );

  useEffect(() => {
    if (!token) {
      return;
    }

    shouldReconnectRef.current = true;

    const connect = () => {
      setConnection("connecting");
      const wsUrl = new URL("/ws", location.href);
      wsUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("token", token);

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        setConnection("connected");
        sendMessage({ type: "client_ready", timestamp: new Date().toISOString() });
        void loadInitialScene(token, applyScene);
      });

      socket.addEventListener("message", (event) => {
        const message = parseServerMessage(event.data);
        if (!message) {
          return;
        }

        if (message.type === "server_status") {
          setClientCount(message.clientCount);
          return;
        }

        if (message.type === "scene_update") {
          applyScene(message.scene);
          return;
        }

        if (message.type === "scene_patch") {
          applyScenePatch(message.patch);
          return;
        }

        if (message.type === "viewport_update") {
          applyViewport(message.viewport, apiRef.current);
          return;
        }

        if (message.type === "export_request") {
          void handleExportRequest(message);
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        setConnection("closed");
        if (shouldReconnectRef.current) {
          reconnectTimerRef.current = window.setTimeout(connect, 1_500);
        }
      });

      socket.addEventListener("error", () => {
        setConnection("closed");
      });
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [applyScene, applyScenePatch, handleExportRequest, sendMessage, token]);

  const handleChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      if (applyingRemoteSceneRef.current) {
        return;
      }

      setElementCount(elements.filter((element) => !element.isDeleted).length);
      pendingSceneRef.current = {
        elements: elements as unknown as DiagramElement[],
        viewport: {
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
        },
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          theme: appState.theme,
        },
        files: files as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      };

      if (pushTimerRef.current !== null) {
        return;
      }

      pushTimerRef.current = window.setTimeout(() => {
        pushTimerRef.current = null;
        const scene = pendingSceneRef.current;
        pendingSceneRef.current = null;
        if (scene) {
          sendMessage({
            type: "client_scene_update",
            scene,
            timestamp: new Date().toISOString(),
          });
        }
      }, 250);
    },
    [sendMessage],
  );

  return (
    <main className="mcp-shell">
      <header className="mcp-statusbar">
        <div className="mcp-brand">
          <span className="mcp-mark" aria-hidden="true" />
          <span>Excalidraw MCP</span>
        </div>
        <StatusPill state={connection} />
        <span className="mcp-stat">Clients {clientCount}</span>
        <span className="mcp-stat">Elements {elementCount}</span>
        <span className="mcp-stat">Sync {lastSync}</span>
        <span className="mcp-stat">Export {lastExport}</span>
      </header>
      <section className="mcp-canvas" aria-label="Excalidraw canvas">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            const pendingScene = pendingRemoteSceneRef.current;
            if (pendingScene) {
              pendingRemoteSceneRef.current = null;
              applyScene(pendingScene);
            }
          }}
          initialData={{
            elements: [],
            appState: toExcalidrawAppState({
              elements: [],
              viewport: DEFAULT_VIEWPORT,
              appState: {},
              files: {},
            }),
            files: {},
          }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
            },
          }}
        />
      </section>
    </main>
  );
}

function StatusPill({ state }: { state: ConnectionState }) {
  return (
    <span className={`mcp-pill mcp-pill-${state}`}>
      {state === "connected"
        ? "Connected"
        : state === "connecting"
          ? "Connecting"
          : state === "missing-token"
            ? "No token"
            : "Reconnecting"}
    </span>
  );
}

async function loadInitialScene(
  token: string,
  applyScene: (scene: CanvasScenePayload) => void,
): Promise<void> {
  const sceneUrl = new URL("/api/scene", location.href);
  const response = await fetch(sceneUrl, {
    headers: { "x-excalidraw-mcp-token": token },
  });
  if (!response.ok) {
    return;
  }

  applyScene((await response.json()) as CanvasScenePayload);
}

function parseServerMessage(value: unknown): CanvasServerMessage | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as CanvasServerMessage;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function toExcalidrawElements(elements: DiagramElement[]) {
  if (elements.every(looksLikeExcalidrawElement)) {
    return elements as unknown as ExcalidrawElement[];
  }

  return convertToExcalidrawElements(
    elements.map((element) => toSkeletonElement(element)) as Parameters<
      typeof convertToExcalidrawElements
    >[0],
    { regenerateIds: false },
  );
}

function looksLikeExcalidrawElement(element: DiagramElement): boolean {
  const candidate = element as unknown as Record<string, unknown>;
  return (
    typeof candidate.versionNonce === "number" &&
    typeof candidate.seed === "number" &&
    typeof candidate.angle === "number"
  );
}

function toSkeletonElement(element: DiagramElement): Record<string, unknown> {
  const base: Record<string, unknown> = {
    ...element,
    id: element.id,
    type: element.type,
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? defaultWidth(element.type),
    height: element.height ?? defaultHeight(element.type),
  };

  if (element.type === "text") {
    base.text = element.text || element.label?.text || "";
  }

  if (element.type === "frame") {
    base.children = [];
    if (element.name) {
      base.name = element.name;
    }
  }

  if (element.type === "image") {
    base.fileId = element.fileId;
    base.status = element.status ?? "saved";
    base.scale = element.scale ?? [1, 1];
  }

  if (element.type === "arrow" || element.type === "line") {
    base.points = element.points || [
      [0, 0],
      [base.width as number, base.height as number],
    ];
    const startElementId = element.startElementId || element.startBinding?.elementId;
    const endElementId = element.endElementId || element.endBinding?.elementId;
    if (startElementId) {
      base.start = { id: startElementId };
    }
    if (endElementId) {
      base.end = { id: endElementId };
    }
  }

  return base;
}

function defaultWidth(type: DiagramElement["type"]): number {
  return type === "text" ? 220 : type === "arrow" || type === "line" ? 120 : type === "image" ? 320 : 180;
}

function defaultHeight(type: DiagramElement["type"]): number {
  return type === "text" ? 40 : type === "arrow" || type === "line" ? 0 : type === "image" ? 220 : 96;
}

function toExcalidrawAppState(scene: CanvasScenePayload): RemoteAppState {
  const appState = scene.appState || {};
  const viewport = scene.viewport || DEFAULT_VIEWPORT;
  const zoom = readZoomValue(appState.zoom, viewport.zoom);

  return {
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    zoom: { value: zoom },
    theme: appState.theme === "dark" ? "dark" : "light",
    viewBackgroundColor:
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : "#ffffff",
  };
}

function exportAppState(appState: AppState, background: boolean): Partial<AppState> {
  return {
    ...appState,
    exportBackground: background,
    viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
  };
}

function readZoomValue(value: unknown, fallback: number): AppState["zoom"]["value"] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value as AppState["zoom"]["value"];
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  ) {
    return value.value as AppState["zoom"]["value"];
  }

  return fallback as AppState["zoom"]["value"];
}

function applyViewport(
  viewport: Partial<ViewportState>,
  api: ExcalidrawImperativeAPI | null,
): void {
  if (!api) {
    return;
  }

  const current = api.getAppState();
  api.updateScene({
    appState: {
      scrollX: viewport.scrollX ?? current.scrollX,
      scrollY: viewport.scrollY ?? current.scrollY,
      zoom: {
        value: readZoomValue(viewport.zoom, current.zoom.value),
      },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
