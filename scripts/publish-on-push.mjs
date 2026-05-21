#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const publishBranches = (process.env.NPM_PUBLISH_ON_PUSH_BRANCHES ?? "main,master")
  .split(",")
  .map((branch) => branch.trim())
  .filter(Boolean);

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.stdio ?? "pipe",
  });
}

function readPushRefs() {
  try {
    if (process.stdin.isTTY) {
      return "";
    }
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function shouldPublishForPush(refInput) {
  if (!refInput.trim()) {
    return true;
  }

  return refInput
    .trim()
    .split(/\r?\n/)
    .some((line) => {
      const [localRef, , remoteRef] = line.trim().split(/\s+/);
      const ref = remoteRef || localRef;
      return publishBranches.some((branch) => ref === `refs/heads/${branch}`);
    });
}

function versionExists() {
  const result = run("npm", ["view", `${packageName}@${packageVersion}`, "version"]);
  if (result.status === 0 && result.stdout.trim() === packageVersion) {
    return true;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes("E404") || output.includes("404")) {
    return false;
  }

  process.stderr.write(output);
  throw new Error(`Could not check npm registry for ${packageName}@${packageVersion}.`);
}

if (process.env.SKIP_NPM_PUBLISH_ON_PUSH === "1") {
  console.log("[publish-on-push] Skipping because SKIP_NPM_PUBLISH_ON_PUSH=1.");
  process.exit(0);
}

const pushRefs = readPushRefs();
if (!shouldPublishForPush(pushRefs)) {
  console.log(
    `[publish-on-push] Skipping npm publish. Push does not target ${publishBranches.join(" or ")}.`,
  );
  process.exit(0);
}

if (versionExists()) {
  console.log(`[publish-on-push] ${packageName}@${packageVersion} is already published. Skipping.`);
  process.exit(0);
}

console.log(`[publish-on-push] Publishing ${packageName}@${packageVersion} before push.`);
const publish = run("npm", ["publish", "--access", "public"], { stdio: "inherit" });
process.exit(publish.status ?? 1);
