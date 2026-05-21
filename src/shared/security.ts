import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.EXCALIDRAW_MCP_WORKSPACE || process.cwd());
}

export function resolveWorkspacePath(filePath: string, fallbackName: string): string {
  const root = getWorkspaceRoot();
  const requested = filePath.trim() ? filePath : fallbackName;
  const resolved = path.resolve(root, requested);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to access path outside workspace: ${filePath}`);
  }
  return resolved;
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
