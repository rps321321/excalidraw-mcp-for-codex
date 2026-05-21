import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(
  text: string,
  structuredContent?: Record<string, unknown>,
): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: "text", text }],
  };

  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }

  return result;
}

export function imageResult(
  text: string,
  image: { data: string; mimeType: string },
  structuredContent?: Record<string, unknown>,
): CallToolResult {
  const result: CallToolResult = {
    content: [
      { type: "text", text },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ],
  };

  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }

  return result;
}

export function errorResult(error: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: `Error: ${errorMessage(error)}` }],
    isError: true,
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
