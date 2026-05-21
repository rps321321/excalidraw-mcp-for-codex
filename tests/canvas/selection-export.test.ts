import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import {
  filterElementsBySelectedIds,
  type CanvasSelectionExportResult,
  type CanvasServerMessage,
} from "../../src/canvas/protocol.js";
import { ensureCanvasServer } from "../../src/canvas/server.js";
import type { CanvasScenePayload } from "../../src/canvas/protocol.js";
import type { SceneStore } from "../../src/shared/state.js";

type Listener = () => void;

class FakeSceneStore {
  private scene: CanvasScenePayload = {
    elements: [
      {
        id: "box-a",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        version: 1,
        updated: Date.now(),
      },
      {
        id: "box-b",
        type: "rectangle",
        x: 180,
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
  };

  private listeners = new Set<Listener>();

  getScene() {
    return this.scene;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let activeHandle: Awaited<ReturnType<typeof ensureCanvasServer>> | null = null;

afterEach(async () => {
  await activeHandle?.close();
  activeHandle = null;
});

describe("canvas selection export", () => {
  it("filters elements only when selected IDs are provided", () => {
    const elements = [
      { id: "box-a", value: 1 },
      { id: "box-b", value: 2 },
      { id: "arrow-a-b", value: 3 },
    ];

    expect(filterElementsBySelectedIds(elements).map((element) => element.id)).toEqual([
      "box-a",
      "box-b",
      "arrow-a-b",
    ]);
    expect(
      filterElementsBySelectedIds(elements, ["box-b", "missing"]).map(
        (element) => element.id,
      ),
    ).toEqual(["box-b"]);
    expect(filterElementsBySelectedIds(elements, [])).toEqual([]);
  });

  it("forwards selected IDs on export requests and result payloads", async () => {
    const store = new FakeSceneStore();
    activeHandle = await ensureCanvasServer(store as unknown as SceneStore);
    const socket = await connect(activeHandle.url, activeHandle.token);

    try {
      socket.send(JSON.stringify({ type: "client_ready" }));
      await waitForMessage(socket, "scene_update");

      const exportRequestPromise = waitForMessage(socket, "export_request");
      const exportPromise = activeHandle.requestExport("svg", false, ["box-b"]);
      const request = await exportRequestPromise;

      expect(request).toMatchObject({
        type: "export_request",
        format: "svg",
        background: false,
        selectedIds: ["box-b"],
      });

      socket.send(
        JSON.stringify({
          type: "export_result",
          requestId: request.requestId,
          format: "svg",
          mimeType: "image/svg+xml",
          encoding: "utf8",
          data: "<svg data-selection=\"box-b\" />",
          selectedIds: request.selectedIds,
        }),
      );

      const result = (await exportPromise) as CanvasSelectionExportResult;
      expect(result).toMatchObject({
        requestId: request.requestId,
        format: "svg",
        data: "<svg data-selection=\"box-b\" />",
        selectedIds: ["box-b"],
      });
    } finally {
      socket.close();
    }
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
