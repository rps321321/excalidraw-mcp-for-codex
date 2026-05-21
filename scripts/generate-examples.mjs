#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const { createRuntime, requestCanvasExport } = await import("../dist/server/mcp/runtime.js");
const { writeCanvasExport, writeJsonWorkspaceFile } = await import("../dist/server/mcp/file-io.js");
const { convertMermaidToElementInputs } = await import("../dist/server/mcp/mermaid.js");
const { normalizeMermaidLayout } = await import("../dist/server/mcp/mermaid-enhancements.js");
const { autoLayoutElements } = await import("../dist/server/shared/auto-layout.js");
const { createRepoDiagram } = await import("../dist/server/shared/repo-diagrams.js");
const { createTemplateDiagram } = await import("../dist/server/shared/templates.js");

const runtime = createRuntime();
const examplesDir = path.join(root, "examples");
const docsAssetsDir = path.join(root, "docs", "assets");
await mkdir(examplesDir, { recursive: true });
await mkdir(docsAssetsDir, { recursive: true });

const mermaidSample = `flowchart LR
  User[Codex Agent] --> MCP[Excalidraw MCP]
  MCP --> Canvas[Live Canvas]
  MCP --> Export[PNG / SVG / JSON]
  Canvas --> Verify[Screenshot Verification]
  Verify --> MCP`;

const scenes = [
  {
    name: "repo-architecture",
    title: "Repository Architecture",
    make: async () => (await createRepoDiagram({ kind: "architecture", title: "Excalidraw MCP Repository Architecture" })).elements,
  },
  {
    name: "mcp-tool-map",
    title: "MCP Tool Map",
    make: async () => createTemplateDiagram({ kind: "mcp-tool-map", theme: "presentation" }).elements,
  },
  {
    name: "c4-container",
    title: "C4 Container Diagram",
    make: async () => createTemplateDiagram({ kind: "c4-container", theme: "technical" }).elements,
  },
  {
    name: "flowchart",
    title: "Three Box Flowchart",
    make: async () => createTemplateDiagram({ kind: "flowchart", theme: "soft" }).elements,
  },
  {
    name: "mermaid-before",
    title: "Mermaid Conversion Before Normalize",
    layout: false,
    make: async () => (await convertMermaidToElementInputs(mermaidSample)).elements,
  },
  {
    name: "mermaid-after",
    title: "Mermaid Conversion After Normalize",
    make: async () => (await normalizeMermaidLayout({ mermaidDiagram: mermaidSample, targetWidth: 1_000, targetHeight: 620 })).elements,
  },
  {
    name: "readme-hero",
    title: "README Hero Diagram",
    make: async () => createTemplateDiagram({ kind: "github-readme-hero", theme: "presentation" }).elements,
  },
];

const manifest = [];

try {
  for (const scene of scenes) {
    const paths = await exportScene(scene);
    manifest.push({
      name: scene.name,
      title: scene.title,
      ...paths,
      png: await fileMetrics(paths.png),
      svg: await fileMetrics(paths.svg),
    });
    console.log(`[ok] generated ${scene.name}`);
  }

  await writeFile(
    path.join(examplesDir, "golden-manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), scenes: manifest }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(examplesDir, "README.md"), galleryReadme(manifest), "utf8");
  await buildDemoGif(await exportDemoFrames());
} finally {
  await runtime.close();
}

async function exportScene(scene) {
  const store = await runtime.getStore();
  await store.clear();
  const inputs = await scene.make();
  await store.batchCreate(inputs);

  if (scene.layout !== false) {
    const elements = await store.getElements();
    const layout = autoLayoutElements(elements, {
      ids: elements.filter((element) => !["arrow", "line", "text"].includes(element.type)).map((element) => element.id),
      mode: "dagre",
      rankDirection: "LR",
      routeArrows: true,
    });
    if (layout.updates.length > 0) {
      await store.updateElements(layout.updates);
    }
  }

  await store.setViewport({ scrollToContent: true });
  await runtime.broadcastScene();
  runtime.getCanvas()?.setViewport({ scrollToContent: true });

  const scenePath = `examples/${scene.name}.excalidraw`;
  const pngPath = `examples/${scene.name}.png`;
  const svgPath = `examples/${scene.name}.svg`;
  await writeJsonWorkspaceFile(scenePath, scenePath, await store.exportScene());
  await writeCanvasExport(pngPath, pngPath, await requestCanvasExport(runtime, "png", true));
  await writeCanvasExport(svgPath, svgPath, await requestCanvasExport(runtime, "svg", true));

  return {
    scene: scenePath,
    png: path.join(root, pngPath),
    svg: path.join(root, svgPath),
  };
}

async function fileMetrics(filePath) {
  const info = await stat(filePath);
  const metrics = { path: path.relative(root, filePath).replaceAll("\\", "/"), bytes: info.size };
  if (filePath.endsWith(".png")) {
    const buffer = await readFile(filePath);
    return {
      ...metrics,
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return metrics;
}

function galleryReadme(entries) {
  const cards = entries.map((entry) => `### ${entry.title}

![${entry.title}](./${path.basename(entry.png.path)})

- Scene: [${path.basename(entry.scene)}](./${path.basename(entry.scene)})
- SVG: [${path.basename(entry.svg.path)}](./${path.basename(entry.svg.path)})
`).join("\n");

  return `# Excalidraw MCP Example Gallery

Generated with \`npm run examples:generate\` after \`npm run build\`.

${cards}`;
}

async function buildDemoGif(framePaths) {
  if (framePaths.length === 0) {
    return;
  }

  const frameDir = path.dirname(framePaths[0]);
  const output = path.join(docsAssetsDir, "excalidraw-mcp-demo.gif");
  const result = spawnSync("ffmpeg", [
    "-y",
    "-framerate",
    "1",
    "-i",
    path.join(frameDir, "demo-frame-%02d.png"),
    "-vf",
    "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2:color=white",
    "-loop",
    "0",
    output,
  ], { stdio: "ignore" });

  if (result.status === 0) {
    console.log(`[ok] generated ${path.relative(root, output)}`);
  } else {
    console.log("[warn] ffmpeg was unavailable or failed; skipped demo GIF.");
  }
}

async function exportDemoFrames() {
  const frameDir = path.join(docsAssetsDir, "demo-frames");
  await mkdir(frameDir, { recursive: true });
  const framePaths = [];

  for (const [index, frame] of demoStoryboards().entries()) {
    const store = await runtime.getStore();
    await store.clear();
    await store.batchCreate(frame.elements);
    await store.setViewport({ scrollToContent: true });
    await runtime.broadcastScene();
    runtime.getCanvas()?.setViewport({ scrollToContent: true });

    const framePath = path.join(frameDir, `demo-frame-${String(index + 1).padStart(2, "0")}.png`);
    const scenePath = path.join(frameDir, `demo-frame-${String(index + 1).padStart(2, "0")}.excalidraw`);
    await writeCanvasExport(framePath, framePath, await requestCanvasExport(runtime, "png", true));
    await writeJsonWorkspaceFile(scenePath, scenePath, await store.exportScene());
    framePaths.push(framePath);
  }

  return framePaths;
}

function demoStoryboards() {
  return [
    storyboardFrame("01", "Local-first Excalidraw MCP", [
      card("codex", 56, 170, 170, 92, "Codex\nagent", "#e0f2fe", "#0369a1"),
      card("mcp", 292, 150, 190, 132, "MCP\nserver", "#eef2ff", "#4f46e5"),
      card("canvas", 548, 150, 190, 132, "Live\ncanvas", "#dcfce7", "#15803d"),
      card("exports", 790, 170, 130, 92, "PNG\nSVG\nJSON", "#fef3c7", "#b45309"),
      arrow("codex-to-mcp", "codex", "mcp"),
      arrow("mcp-to-canvas", "mcp", "canvas"),
      arrow("canvas-to-exports", "canvas", "exports"),
      pill("loop", 330, 356, 300, 58, "draw -> inspect -> screenshot -> fix", "#fff7ed", "#ea580c"),
    ]),
    storyboardFrame("02", "Tool map agents can actually use", [
      card("crud", 80, 150, 210, 118, "Element CRUD\ncreate\nupdate\ndelete", "#dbeafe", "#2563eb"),
      card("inspect", 375, 150, 210, 118, "Inspect\nquery\ndescribe\ndiff", "#dcfce7", "#16a34a"),
      card("layout", 670, 150, 210, 118, "Layout\nDagre\npolish\nroute", "#fef3c7", "#ca8a04"),
      card("import", 80, 318, 210, 118, "Imports\nOpenAPI\nSQL\nC4", "#fce7f3", "#be185d"),
      card("verify", 375, 318, 210, 118, "Verify\nscreenshot\nlint\ntests", "#ede9fe", "#7c3aed"),
      card("export", 670, 318, 210, 118, "Export\nPNG\nSVG\nscene", "#ccfbf1", "#0f766e"),
    ]),
    storyboardFrame("03", "create_verified_diagram workflow", [
      card("plan", 40, 228, 100, 82, "Plan", "#dbeafe", "#2563eb", 20),
      card("create", 195, 228, 100, 82, "Create", "#dcfce7", "#15803d", 20),
      card("layout-v", 350, 228, 100, 82, "Layout", "#fef3c7", "#b45309", 20),
      card("shot", 505, 228, 100, 82, "Shot", "#ede9fe", "#6d28d9", 20),
      card("lint", 660, 228, 100, 82, "Lint", "#fee2e2", "#b91c1c", 20),
      card("export-v", 815, 228, 100, 82, "Export", "#ccfbf1", "#0f766e", 20),
      arrow("plan-create", "plan", "create"),
      arrow("create-layout", "create", "layout-v"),
      arrow("layout-shot", "layout-v", "shot"),
      arrow("shot-lint", "shot", "lint"),
      arrow("lint-export", "lint", "export-v"),
      pill("fix", 330, 360, 300, 58, "polish pass repeats until readable", "#f8fafc", "#475569"),
    ]),
    storyboardFrame("04", "Better imports become editable diagrams", [
      card("sources", 64, 152, 210, 190, "Source files\n\nOpenAPI\npackage.json\nSQL\nMarkdown\nPlantUML\nStructurizr", "#f8fafc", "#475569"),
      card("parser", 374, 190, 180, 112, "Zod-validated\nimporters", "#eef2ff", "#4f46e5"),
      card("scene", 654, 160, 230, 172, "Editable scene\n\nstable IDs\nbound labels\narrow bindings", "#dcfce7", "#15803d"),
      arrow("sources-parser", "sources", "parser"),
      arrow("parser-scene", "parser", "scene"),
      pill("note", 314, 374, 344, 58, "imports start the diagram; agents still inspect and refine", "#fff7ed", "#ea580c"),
    ]),
    storyboardFrame("05", "Release-ready local safety checks", [
      card("local", 72, 142, 220, 110, "127.0.0.1\nlocal bridge", "#dbeafe", "#2563eb"),
      card("auth", 370, 142, 220, 110, "session token\nHTTP + WS auth", "#ede9fe", "#7c3aed"),
      card("paths", 668, 142, 220, 110, "workspace paths\nno traversal", "#dcfce7", "#15803d"),
      card("tests", 222, 318, 220, 110, "51 tests\nbrowser smoke", "#fef3c7", "#b45309"),
      card("bench", 520, 318, 220, 110, "5,000 elements\nbenchmark pass", "#ccfbf1", "#0f766e"),
      arrow("local-auth", "local", "auth"),
      arrow("auth-paths", "auth", "paths"),
      arrow("tests-bench", "tests", "bench"),
    ]),
  ];
}

function storyboardFrame(id, title, elements) {
  return {
    id,
    title,
    elements: [
      background(`frame-${id}-bg`),
      header(`frame-${id}-title`, title),
      ...elements,
    ],
  };
}

function background(id) {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 960,
    height: 540,
    backgroundColor: "#ffffff",
    strokeColor: "#ffffff",
    fillStyle: "solid",
    roughness: 0,
  };
}

function header(id, text) {
  return {
    id,
    type: "rectangle",
    x: 48,
    y: 42,
    width: 864,
    height: 72,
    label: { text, fontSize: 30 },
    backgroundColor: "#ffffff",
    strokeColor: "#0f172a",
    fillStyle: "solid",
    strokeWidth: 1,
    roundness: { type: 3 },
  };
}

function card(id, x, y, width, height, text, backgroundColor, strokeColor, fontSize = 22) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    label: { text, fontSize },
    backgroundColor,
    strokeColor,
    fillStyle: "solid",
    strokeWidth: 2,
    roundness: { type: 3 },
  };
}

function pill(id, x, y, width, height, text, backgroundColor, strokeColor) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    label: { text, fontSize: 20 },
    backgroundColor,
    strokeColor,
    fillStyle: "solid",
    strokeWidth: 2,
    roundness: { type: 3 },
  };
}

function arrow(id, from, to, label) {
  return {
    id,
    type: "arrow",
    startElementId: from,
    endElementId: to,
    endArrowhead: "arrow",
    strokeColor: "#334155",
    strokeWidth: 2,
    label: label ? { text: label, fontSize: 18 } : undefined,
  };
}
