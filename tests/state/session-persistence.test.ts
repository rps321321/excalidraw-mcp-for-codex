import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SceneExport } from "../../src/shared/types.js";
import {
  DEFAULT_SESSION_FILE,
  getSessionStatus,
  loadSession,
  saveSession,
  sessionExists,
} from "../../src/shared/session.js";

const tempRoots: string[] = [];
let previousWorkspace: string | undefined;

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "excalidraw-session-"));
  tempRoots.push(root);
  process.env.EXCALIDRAW_MCP_WORKSPACE = root;
  return root;
}

function createScene(): SceneExport {
  return {
    type: "excalidraw",
    version: 2,
    source: "session-test",
    elements: [
      {
        id: "box-a",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        version: 1,
        updated: 100,
        label: { text: "Saved" },
      },
      {
        id: "note",
        type: "text",
        x: 180,
        y: 30,
        width: 96,
        height: 36,
        version: 1,
        updated: 250,
        text: "Session note",
      },
    ],
    appState: { scrollX: -10, scrollY: -20, zoom: 1.25 },
    files: { "image-1": { mimeType: "image/png" } },
  };
}

beforeEach(() => {
  previousWorkspace = process.env.EXCALIDRAW_MCP_WORKSPACE;
});

afterEach(async () => {
  if (previousWorkspace === undefined) {
    delete process.env.EXCALIDRAW_MCP_WORKSPACE;
  } else {
    process.env.EXCALIDRAW_MCP_WORKSPACE = previousWorkspace;
  }
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session persistence", () => {
  it("resolves the default session path inside the workspace", async () => {
    const workspaceRoot = await createTempWorkspace();
    const status = await getSessionStatus();

    expect(status).toEqual({
      path: path.join(workspaceRoot, ".excalidraw-mcp", "session.json"),
      exists: false,
    });
    expect(DEFAULT_SESSION_FILE).toBe(".excalidraw-mcp/session.json");
  });

  it("refuses session paths outside the workspace", async () => {
    const workspaceRoot = await createTempWorkspace();
    const outsideWorkspace = path.resolve(workspaceRoot, "..", "session.json");

    await expect(sessionExists("../session.json")).rejects.toThrow(/outside workspace/);
    await expect(getSessionStatus(outsideWorkspace)).rejects.toThrow(/outside workspace/);
    await expect(loadSession("../session.json")).rejects.toThrow(/outside workspace/);
    await expect(saveSession(createScene(), outsideWorkspace)).rejects.toThrow(/outside workspace/);
  });

  it("saves and loads the raw scene export", async () => {
    const workspaceRoot = await createTempWorkspace();
    const scene = createScene();
    const sessionPath = path.join(workspaceRoot, ".excalidraw-mcp", "session.json");

    const beforeSave = await sessionExists();
    const status = await saveSession(scene);
    const loaded = await loadSession();
    const raw = await readFile(sessionPath, "utf8");

    expect(beforeSave).toBe(false);
    expect(await sessionExists()).toBe(true);
    expect(loaded).toEqual(scene);
    expect(JSON.parse(raw)).toEqual(scene);
    expect(status).toMatchObject({
      path: sessionPath,
      exists: true,
      source: "session-test",
      version: 2,
      elementCount: 2,
      fileCount: 1,
      appStateKeys: ["scrollX", "scrollY", "zoom"],
      lastElementUpdated: 250,
    });
    expect(status.sizeBytes).toBeGreaterThan(0);
    expect(status.modifiedAt).toEqual(expect.any(String));
  });

  it("supports an explicit workspace-relative session path", async () => {
    const workspaceRoot = await createTempWorkspace();
    const customPath = "sessions/custom-session.json";

    await saveSession(createScene(), customPath);

    expect(await sessionExists(customPath)).toBe(true);
    expect(await loadSession(customPath)).toEqual(createScene());
    expect((await getSessionStatus(customPath)).path).toBe(path.join(workspaceRoot, "sessions", "custom-session.json"));
  });

  it("returns null and absent metadata when no session exists", async () => {
    const workspaceRoot = await createTempWorkspace();

    expect(await loadSession()).toBeNull();
    expect(await getSessionStatus()).toEqual({
      path: path.join(workspaceRoot, ".excalidraw-mcp", "session.json"),
      exists: false,
    });
  });

  it("rejects invalid scene data on save and load", async () => {
    const workspaceRoot = await createTempWorkspace();
    const sessionPath = path.join(workspaceRoot, ".excalidraw-mcp", "session.json");

    await expect(saveSession({ type: "not-excalidraw" } as unknown as SceneExport)).rejects.toThrow(/Excalidraw v2 scene/);
    await saveSession(createScene());
    await rm(sessionPath);
    await import("node:fs/promises").then(({ mkdir, writeFile }) =>
      mkdir(path.dirname(sessionPath), { recursive: true }).then(() => writeFile(sessionPath, "{\"type\":\"bad\"}", "utf8")),
    );

    await expect(loadSession()).rejects.toThrow(/Excalidraw v2 scene/);
  });
});
