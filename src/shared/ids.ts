import crypto from "node:crypto";

export function createElementId(prefix = "el"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

