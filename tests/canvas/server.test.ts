import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { ensureCanvasServer } from "../../src/canvas/server.js";
import type { CanvasServerMessage } from "../../src/canvas/protocol.js";
import type { CanvasScenePayload } from "../../src/canvas/protocol.js";
import type { SceneStore } from "../../src/shared/state.js";

type Listener = () => void;

class FakeSceneStore {
  private scene: CanvasScenePayload = {
    elements: [],
    viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
    appState: {},
    files: {},
  };

  private listeners = new Set<Listener>();

  getScene() {
    return this.scene;
  }

  setScene(scene: CanvasScenePayload) {
    this.scene = scene;
    this.emit();
  }

  setViewport(viewport: Partial<CanvasScenePayload["viewport"]>) {
    this.scene = {
      ...this.scene,
      viewport: { ...this.scene.viewport, ...viewport },
    };
    this.emit();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

let activeHandle: Awaited<ReturnType<typeof ensureCanvasServer>> | null = null;

afterEach(async () => {
  await activeHandle?.close();
  activeHandle = null;
});

describe("canvas server runtime", () => {
  it("serves health and token-protected scene JSON", async () => {
    const store = new FakeSceneStore();
    activeHandle = await ensureCanvasServer(store as unknown as SceneStore);

    const health = await fetch(new URL("/health", activeHandle.url));
    expect(health.ok).toBe(true);

    const unauthorized = await fetch(
      new URL("/api/scene", activeHandle.url),
    );
    expect(unauthorized.status).toBe(401);

    const scene = await fetch(
      new URL("/api/scene", activeHandle.url),
      { headers: { "x-excalidraw-mcp-token": activeHandle.token } },
    );
    expect(scene.ok).toBe(true);
    await expect(scene.json()).resolves.toMatchObject({
      elements: [],
      viewport: { zoom: 1 },
    });
  });

  it("broadcasts scene changes and resolves browser export results", async () => {
    const store = new FakeSceneStore();
    activeHandle = await ensureCanvasServer(store as unknown as SceneStore);
    const socket = await connect(activeHandle.url, activeHandle.token);

    socket.send(JSON.stringify({ type: "client_ready" }));
    const firstScene = await waitForMessage(socket, "scene_update");
    expect(firstScene.scene.elements).toHaveLength(0);

    const updatePromise = waitForMessage(socket, "scene_update");
    store.setScene({
      elements: [
        {
          id: "box_a",
          type: "rectangle",
          x: 10,
          y: 20,
          width: 120,
          height: 80,
          version: 1,
          updated: Date.now(),
        },
      ],
      viewport: { scrollX: 0, scrollY: 0, zoom: 1 },
      appState: {},
      files: {},
    });

    const update = await updatePromise;
    expect(update.scene.elements[0]?.id).toBe("box_a");

    const exportRequestPromise = waitForMessage(socket, "export_request");
    const exportPromise = activeHandle.requestExport("svg", true);
    const request = await exportRequestPromise;
    expect(request.format).toBe("svg");

    socket.send(
      JSON.stringify({
        type: "export_result",
        requestId: request.requestId,
        format: "svg",
        mimeType: "image/svg+xml",
        encoding: "utf8",
        data: "<svg />",
      }),
    );

    await expect(exportPromise).resolves.toMatchObject({
      requestId: request.requestId,
      format: "svg",
      data: "<svg />",
    });

    socket.close();
  });
});

async function connect(url: string, token: string): Promise<WebSocket> {
  const wsUrl = new URL("/ws", url);
  wsUrl.protocol = "ws:";
  wsUrl.searchParams.set("token", token);

  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function waitForMessage<T extends CanvasServerMessage["type"]>(
  socket: WebSocket,
  type: T,
): Promise<Extract<CanvasServerMessage, { type: T }>> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as CanvasServerMessage;
      if (message.type === type) {
        socket.off("message", onMessage);
        resolve(message as Extract<CanvasServerMessage, { type: T }>);
      }
    };

    socket.on("message", onMessage);
  });
}
