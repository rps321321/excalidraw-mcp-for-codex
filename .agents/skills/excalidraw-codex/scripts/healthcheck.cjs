#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const requiredFiles = [
  "package.json",
  ".agents/skills/excalidraw-codex/SKILL.md",
  ".agents/skills/excalidraw-codex/references/cheatsheet.md",
];

const optionalBuildFiles = [
  "dist/server/mcp/index.js",
  "dist/web/index.html",
];

let failures = 0;

function pass(message) {
  console.log(`[ok] ${message}`);
}

function warn(message) {
  console.log(`[warn] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[fail] ${message}`);
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

for (const file of requiredFiles) {
  if (exists(file)) {
    pass(`${file} exists`);
  } else {
    fail(`${file} is missing`);
  }
}

let packageJson;
try {
  packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  pass("package.json is valid JSON");
} catch (error) {
  fail(`package.json could not be read: ${error.message}`);
}

if (packageJson) {
  for (const scriptName of ["build", "test", "typecheck"]) {
    if (packageJson.scripts && packageJson.scripts[scriptName]) {
      pass(`npm script "${scriptName}" is present`);
    } else {
      warn(`npm script "${scriptName}" is not present`);
    }
  }
}

for (const file of optionalBuildFiles) {
  if (exists(file)) {
    pass(`${file} exists`);
  } else {
    warn(`${file} not found; run npm run build if implementation is complete`);
  }
}

const url = process.env.EXCALIDRAW_MCP_URL;
if (url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  fetch(url, { signal: controller.signal })
    .then((response) => {
      clearTimeout(timeout);
      if (response.ok) {
        pass(`${url} responded with HTTP ${response.status}`);
      } else {
        warn(`${url} responded with HTTP ${response.status}`);
      }
      finish();
    })
    .catch((error) => {
      clearTimeout(timeout);
      warn(`${url} is not reachable: ${error.message}`);
      finish();
    });
} else {
  warn("EXCALIDRAW_MCP_URL is not set; skipping live canvas probe");
  finish();
}

function finish() {
  if (failures > 0) {
    console.error(`Healthcheck failed with ${failures} required problem(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("Healthcheck completed.");
}

