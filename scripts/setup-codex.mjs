#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
run(npmCommand, ["run", "build"]);

const distEntry = path.join(root, "dist", "server", "mcp", "index.js");
const configDir = path.join(root, ".excalidraw-mcp");
const configPath = path.join(configDir, "codex-mcp.toml");
await mkdir(configDir, { recursive: true });
await writeFile(configPath, codexConfig(distEntry), "utf8");
console.log(`[ok] wrote project Codex MCP config: ${configPath}`);

run("node", [path.join(root, ".agents", "skills", "excalidraw-codex", "scripts", "healthcheck.cjs")]);

const { createExcalidrawMcpServer, TOOL_NAMES } = await import("../dist/server/mcp/index.js");
const server = createExcalidrawMcpServer();
const client = new Client({ name: "excalidraw-mcp-setup", version: "0.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools();
  const missing = TOOL_NAMES.filter((toolName) => !listed.tools.some((tool) => tool.name === toolName));
  if (missing.length > 0) {
    throw new Error(`MCP tool list is missing: ${missing.join(", ")}`);
  }
  console.log(`[ok] MCP listed ${listed.tools.length} Excalidraw tool(s).`);
} finally {
  await client.close();
  await server.close();
}

const codexInvocation = invocationFor("codex", ["mcp", "list"]);
const codexList = spawnSync(codexInvocation.command, codexInvocation.args, { encoding: "utf8" });
if (codexList.status === 0) {
  console.log("[ok] codex mcp list ran successfully.");
} else {
  console.log("[warn] codex CLI was not available or did not list MCPs in this shell.");
}

console.log("Setup completed. Use the generated TOML as project-scoped Codex MCP config or run:");
console.log(`codex mcp add excalidraw -- node ${distEntry}`);

function run(command, args) {
  const invocation = invocationFor(command, args);
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    const reason = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}${reason}`);
  }
}

function invocationFor(command, args) {
  if (command === "node") {
    return { command: process.execPath, args };
  }
  if (process.platform !== "win32") {
    return { command, args };
  }
  return {
    command: process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].map(cmdQuote).join(" ")],
  };
}

function cmdQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function codexConfig(entry) {
  return `[mcp_servers.excalidraw]
command = "node"
args = [${JSON.stringify(entry)}]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "auto"

[mcp_servers.excalidraw.tools.clear_canvas]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.delete_elements]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.import_scene]
approval_mode = "prompt"
`;
}
