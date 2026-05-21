import { readFile } from "node:fs/promises";
import path from "node:path";
import { createOpaqueId, resolveWorkspacePath } from "../shared/security.js";

export interface PreparedImageAsset {
  fileId: string;
  files: Record<string, unknown>;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
export const MAX_IMAGE_ASSET_BYTES = 5_000_000;
const DANGEROUS_SVG_PATTERN = /<script\b|<foreignObject\b|javascript:|on[a-z]+\s*=/i;

export async function prepareImageAsset(filePath: string, requestedId?: string): Promise<PreparedImageAsset> {
  const resolved = resolveWorkspacePath(filePath, "");
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error(`Unsupported image extension: ${extension || "(none)"}`);
  }

  const data = await readFile(resolved);
  if (data.byteLength > MAX_IMAGE_ASSET_BYTES) {
    throw new Error(`Image asset is too large: ${data.byteLength} bytes. Maximum is ${MAX_IMAGE_ASSET_BYTES} bytes.`);
  }
  if (mimeType === "image/svg+xml" && DANGEROUS_SVG_PATTERN.test(data.toString("utf8"))) {
    throw new Error("SVG image contains active content and was refused.");
  }

  const fileId = requestedId ?? createOpaqueId("image");
  return {
    fileId,
    files: {
      [fileId]: {
        id: fileId,
        mimeType,
        dataURL: `data:${mimeType};base64,${data.toString("base64")}`,
        created: Date.now(),
        lastRetrieved: Date.now(),
      },
    },
  };
}
