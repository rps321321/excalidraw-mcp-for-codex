import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { getWorkspaceRoot } from "./security.js";
import type { DiagramElement, SceneExport } from "./types.js";

export const DEFAULT_SESSION_FILE = ".excalidraw-mcp/session.json";
export const NAMED_SESSION_DIR = ".excalidraw-mcp/sessions";

export interface SessionStatus {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  source?: string;
  version?: SceneExport["version"];
  elementCount?: number;
  fileCount?: number;
  appStateKeys?: string[];
  lastElementUpdated?: number | null;
}

export async function sessionExists(filePath?: string): Promise<boolean> {
  const sessionPath = resolveSessionPath(filePath);

  try {
    const stats = await stat(sessionPath);
    return stats.isFile();
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

export async function getSessionStatus(filePath?: string): Promise<SessionStatus> {
  const sessionPath = resolveSessionPath(filePath);

  try {
    const stats = await stat(sessionPath);
    if (!stats.isFile()) {
      return { path: sessionPath, exists: false };
    }

    const scene = await loadSession(filePath);
    if (!scene) {
      return { path: sessionPath, exists: false };
    }

    return {
      path: sessionPath,
      exists: true,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      source: scene.source,
      version: scene.version,
      elementCount: scene.elements.length,
      fileCount: Object.keys(scene.files).length,
      appStateKeys: Object.keys(scene.appState).sort(),
      lastElementUpdated: lastElementUpdated(scene.elements),
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { path: sessionPath, exists: false };
    }
    throw error;
  }
}

export async function saveSession(scene: SceneExport, filePath?: string): Promise<SessionStatus> {
  assertSceneExport(scene);

  const sessionPath = resolveSessionPath(filePath);
  await mkdir(path.dirname(sessionPath), { recursive: true });

  const tempPath = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(scene, null, 2)}\n`, "utf8");
  await rename(tempPath, sessionPath);

  return getSessionStatus(filePath);
}

export async function loadSession(filePath?: string): Promise<SceneExport | null> {
  const sessionPath = resolveSessionPath(filePath);

  try {
    await access(sessionPath, constants.R_OK);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }

  const parsed = JSON.parse(await readFile(sessionPath, "utf8")) as unknown;
  assertSceneExport(parsed);
  return parsed;
}

export async function listNamedSessions(): Promise<SessionStatus[]> {
  const directory = resolveSessionPath(NAMED_SESSION_DIR);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  });
  const sessions: SessionStatus[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = `${NAMED_SESSION_DIR}/${entry.name}`;
    sessions.push(await getSessionStatus(filePath));
  }
  return sessions.sort((left, right) => (right.modifiedAt ?? "").localeCompare(left.modifiedAt ?? ""));
}

export function namedSessionPath(name: string): string {
  const safeName = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  return `${NAMED_SESSION_DIR}/${safeName}.json`;
}

export async function deleteSession(filePath?: string): Promise<{ path: string; deleted: boolean }> {
  const sessionPath = resolveSessionPath(filePath);
  try {
    await unlink(sessionPath);
    return { path: sessionPath, deleted: true };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { path: sessionPath, deleted: false };
    }
    throw error;
  }
}

function resolveSessionPath(filePath?: string): string {
  const root = getWorkspaceRoot();
  const requested = filePath?.trim() ? filePath : DEFAULT_SESSION_FILE;
  const resolved = path.resolve(root, requested);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to access session path outside workspace: ${requested}`);
  }

  return resolved;
}

function assertSceneExport(value: unknown): asserts value is SceneExport {
  if (!value || typeof value !== "object") {
    throw new Error("Session data must be an Excalidraw scene object");
  }

  const scene = value as Partial<SceneExport>;
  if (scene.type !== "excalidraw" || scene.version !== 2) {
    throw new Error("Session data must be an Excalidraw v2 scene");
  }
  if (!Array.isArray(scene.elements)) {
    throw new Error("Session data must include an elements array");
  }
  if (!scene.appState || typeof scene.appState !== "object" || Array.isArray(scene.appState)) {
    throw new Error("Session data must include an appState object");
  }
  if (!scene.files || typeof scene.files !== "object" || Array.isArray(scene.files)) {
    throw new Error("Session data must include a files object");
  }
  if (typeof scene.source !== "string") {
    throw new Error("Session data must include a source string");
  }
}

function lastElementUpdated(elements: readonly DiagramElement[]): number | null {
  const values = elements
    .map((element) => element.updated)
    .filter((updated): updated is number => typeof updated === "number" && Number.isFinite(updated));

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
