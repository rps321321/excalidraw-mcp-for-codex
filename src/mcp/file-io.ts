import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "../shared/security.js";
import type { CanvasExportResult } from "../shared/types.js";

export function defaultExportName(kind: string, extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `exports/${kind}-${stamp}.${extension}`;
}

export async function writeJsonWorkspaceFile(
  filePath: string | undefined,
  fallbackName: string,
  data: unknown,
): Promise<string> {
  const resolved = resolveWorkspacePath(filePath ?? "", fallbackName);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return resolved;
}

export async function readJsonWorkspaceFile(filePath: string): Promise<unknown> {
  const resolved = resolveWorkspacePath(filePath, "");
  const contents = await readFile(resolved, "utf8");
  return JSON.parse(contents) as unknown;
}

export async function writeCanvasExport(
  filePath: string | undefined,
  fallbackName: string,
  exportResult: CanvasExportResult,
): Promise<string> {
  const resolved = resolveWorkspacePath(filePath ?? "", fallbackName);
  await mkdir(path.dirname(resolved), { recursive: true });

  if (exportResult.encoding === "base64") {
    await writeFile(resolved, Buffer.from(exportResult.data, "base64"));
  } else {
    await writeFile(resolved, exportResult.data, "utf8");
  }

  return resolved;
}
