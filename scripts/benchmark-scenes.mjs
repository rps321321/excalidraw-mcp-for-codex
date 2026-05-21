#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const { SceneStore } = await import("../dist/server/shared/state.js");
const { autoLayoutElements } = await import("../dist/server/shared/auto-layout.js");

const counts = [100, 500, 1_000, 5_000];
const results = [];

for (const count of counts) {
  const store = new SceneStore();
  const inputs = createSceneInputs(count);

  const createStart = performance.now();
  store.batchCreate(inputs);
  const createMs = performance.now() - createStart;

  const layoutStart = performance.now();
  const layout = autoLayoutElements(store.getElements(), { mode: "dagre", rankDirection: "LR", routeArrows: true });
  const layoutMs = performance.now() - layoutStart;

  const patchStart = performance.now();
  if (layout.updates.length > 0) {
    store.updateElements(layout.updates.slice(0, Math.min(500, layout.updates.length)));
  }
  const patchMs = performance.now() - patchStart;

  const exportStart = performance.now();
  const exported = store.exportScene();
  const exportMs = performance.now() - exportStart;
  const jsonBytes = Buffer.byteLength(JSON.stringify(exported), "utf8");
  const memory = process.memoryUsage();

  results.push({
    count,
    createMs: round(createMs),
    layoutMs: round(layoutMs),
    patchMs: round(patchMs),
    exportSceneMs: round(exportMs),
    heapUsedMb: round(memory.heapUsed / 1024 / 1024),
    jsonBytes,
    layoutUpdates: layout.updates.length,
  });

  console.log(`[ok] ${count} elements: create ${round(createMs)}ms, layout ${round(layoutMs)}ms, export ${round(exportMs)}ms`);
}

const outputDir = path.join(root, "benchmarks");
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "performance-benchmark.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`,
  "utf8",
);
await writeFile(path.join(outputDir, "performance-benchmark.md"), markdown(results), "utf8");

function createSceneInputs(totalElements) {
  const nodeCount = Math.ceil(totalElements / 2);
  const arrowCount = totalElements - nodeCount;
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index + 1}`,
    type: "rectangle",
    x: (index % 20) * 260,
    y: Math.floor(index / 20) * 140,
    width: 210,
    height: 84,
    label: { text: `Node ${index + 1}`, fontSize: 18 },
  }));
  const arrows = Array.from({ length: arrowCount }, (_, index) => ({
    id: `edge-${index + 1}`,
    type: "arrow",
    startElementId: `node-${index + 1}`,
    endElementId: `node-${Math.min(index + 2, nodeCount)}`,
  }));
  return [...nodes, ...arrows];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function markdown(rows) {
  const body = rows.map((row) =>
    `| ${row.count} | ${row.createMs} | ${row.layoutMs} | ${row.patchMs} | ${row.exportSceneMs} | ${row.heapUsedMb} | ${row.layoutUpdates} |`,
  ).join("\n");

  return `# Scene Performance Benchmark

Measured with \`npm run bench:scenes\`.

| Elements | Create ms | Dagre layout ms | Patch ms | Scene export ms | Heap MB | Layout updates |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${body}
`;
}
