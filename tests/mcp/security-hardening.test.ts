import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { ensureCanvasServer } from "../../src/canvas/server.js";
import { MAX_IMAGE_ASSET_BYTES, prepareImageAsset } from "../../src/mcp/image-assets.js";
import { importSceneSchema } from "../../src/shared/schemas.js";
import { SceneStore } from "../../src/shared/state.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("security hardening", () => {
  it("rejects malicious SVG image assets", async () => {
    const directory = await fixtureDir();
    const svgPath = path.join(directory, "malicious.svg");
    await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");

    await expect(prepareImageAsset(path.relative(process.cwd(), svgPath))).rejects.toThrow(/active content/);
  });

  it("rejects oversized image assets before creating a data URL", async () => {
    const directory = await fixtureDir();
    const imagePath = path.join(directory, "huge.png");
    await writeFile(imagePath, Buffer.alloc(MAX_IMAGE_ASSET_BYTES + 1));

    await expect(prepareImageAsset(path.relative(process.cwd(), imagePath))).rejects.toThrow(/too large/);
  });

  it("keeps import payload limits in schema validation", () => {
    expect(() => importSceneSchema.parse({ data: "x".repeat(5_000_001) })).toThrow();
  });

  it("rejects WebSocket connections with an invalid session token", async () => {
    const handle = await ensureCanvasServer(new SceneStore());
    const wsUrl = new URL("/ws", handle.url);
    wsUrl.searchParams.set("token", "wrong-token");
    const socket = new WebSocket(wsUrl);

    await expect(new Promise<void>((resolve, reject) => {
      socket.once("open", () => reject(new Error("Socket should not open with a wrong token.")));
      socket.once("error", () => resolve());
      socket.once("close", (code) => {
        if (code === 1006) {
          resolve();
        } else {
          reject(new Error(`Unexpected close code ${code}.`));
        }
      });
    })).resolves.toBeUndefined();

    await handle.close();
  });
});

async function fixtureDir(): Promise<string> {
  const root = path.join(process.cwd(), ".excalidraw-mcp", "test-fixtures");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "security-"));
  createdDirs.push(directory);
  return directory;
}
