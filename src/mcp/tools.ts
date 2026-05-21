import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  addImageSchema,
  applyLayoutFixesSchema,
  autoLayoutSchema,
  batchCreateElementsSchema,
  compareSnapshotsSchema,
  createFromMermaidSchema,
  createDiagramPlanSchema,
  createFrameFromElementsSchema,
  createGithubReadmeAssetsSchema,
  createRepoDiagramSchema,
  createTemplateDiagramSchema,
  createVerifiedDiagramSchema,
  deleteElementsSchema,
  diagramReviewReportSchema,
  diffScenesSchema,
  duplicateElementsSchema,
  importDatabaseSchemaSchema,
  importMarkdownOutlineSchema,
  importOpenApiSchema,
  importPackageDependenciesSchema,
  importPlantUmlSchema,
  exportSelectionToImageSchema,
  exportSceneSchema,
  exportToImageSchema,
  importStructurizrSchema,
  groupElementsSchema,
  importSceneSchema,
  lintSceneSchema,
  normalizeMermaidLayoutSchema,
  polishSceneSchema,
  previewMermaidConversionSchema,
  queryElementsSchema,
  routeArrowsSchema,
  restoreSnapshotSchema,
  namedSessionSchema,
  sessionPathSchema,
  setElementOrderSchema,
  setViewportSchema,
  suggestLayoutFixesSchema,
  snapshotSceneSchema,
  tagElementsSchema,
  themeSceneSchema,
  ungroupElementsSchema,
  updateElementsSchema,
} from "../shared/schemas.js";
import type { DiagramElement, ElementInput, ViewportState } from "../shared/types.js";
import { createOpaqueId } from "../shared/security.js";
import {
  compareSceneSnapshots,
  createFrameElement,
  createGroupUpdates,
  createUngroupUpdates,
  duplicateElements,
} from "../shared/scene-ops.js";
import { autoLayoutElements, polishScene } from "../shared/auto-layout.js";
import { importDiagramSource, type ImportSourceKind } from "../shared/importers.js";
import { createGithubReadmeDiagram, createRepoDiagram } from "../shared/repo-diagrams.js";
import { createTemplateDiagram } from "../shared/templates.js";
import {
  createDiagramPlan,
  createDiagramReviewReport,
  lintScene,
  routeArrows,
  suggestLayoutFixes,
  themeScene,
  toLayoutFixUpdates,
} from "../shared/quality.js";
import {
  deleteSession,
  getSessionStatus,
  listNamedSessions,
  loadSession,
  namedSessionPath,
  saveSession,
} from "../shared/session.js";
import { defaultExportName, readJsonWorkspaceFile, writeCanvasExport, writeJsonWorkspaceFile } from "./file-io.js";
import { DIAGRAM_GUIDE } from "./guide.js";
import { errorResult, imageResult, textResult } from "./results.js";
import { createRuntime, requestCanvasExport, type ExcalidrawRuntime } from "./runtime.js";
import { convertMermaidToElementInputs } from "./mermaid.js";
import { normalizeMermaidLayout, previewMermaidConversion } from "./mermaid-enhancements.js";
import { prepareImageAsset } from "./image-assets.js";

type ToolElementUpdate = Partial<ElementInput> & { id: string };
type ToolLayoutFix = { id: string; update: ToolElementUpdate };
type ImportSourceToolArgs = z.infer<typeof importOpenApiSchema>;
type CreateVerifiedDiagramArgs = z.infer<typeof createVerifiedDiagramSchema>;

const noInputSchema = z.object({});
const startCanvasSchema = z.object({
  openBrowser: z.boolean().default(true),
});
const getCanvasScreenshotSchema = z.object({
  background: z.boolean().default(true),
});
const queryElementsToolSchema = queryElementsSchema.extend({
  label: z.string().optional(),
  frame: z.string().optional(),
});

export const TOOL_NAMES = [
  "start_canvas",
  "read_diagram_guide",
  "batch_create_elements",
  "update_elements",
  "delete_elements",
  "clear_canvas",
  "query_elements",
  "describe_scene",
  "set_viewport",
  "get_canvas_screenshot",
  "export_scene",
  "import_scene",
  "export_to_image",
  "snapshot_scene",
  "restore_snapshot",
  "create_from_mermaid",
  "lint_scene",
  "suggest_layout_fixes",
  "apply_layout_fixes",
  "route_arrows",
  "create_diagram_plan",
  "auto_layout",
  "polish_scene",
  "theme_scene",
  "compare_snapshots",
  "diff_scenes",
  "duplicate_elements",
  "group_elements",
  "ungroup_elements",
  "create_frame_from_elements",
  "add_image",
  "set_element_order",
  "tag_elements",
  "create_from_template",
  "create_repo_diagram",
  "create_github_readme_assets",
  "export_selection_to_image",
  "diagram_review_report",
  "preview_mermaid_conversion",
  "normalize_mermaid_layout",
  "import_openapi",
  "import_package_dependencies",
  "import_database_schema",
  "import_markdown_outline",
  "import_plantuml",
  "import_structurizr",
  "create_verified_diagram",
  "session_status",
  "save_session",
  "load_session",
  "list_canvas_sessions",
  "save_canvas_session",
  "switch_canvas_session",
  "delete_canvas_session",
] as const;

export type ExcalidrawToolName = (typeof TOOL_NAMES)[number];

export function registerExcalidrawTools(
  server: McpServer,
  runtime: ExcalidrawRuntime = createRuntime(),
): void {
  server.registerTool(
    "start_canvas",
    {
      title: "Start Excalidraw Canvas",
      description:
        "Start or verify the local 127.0.0.1 Excalidraw canvas bridge, optionally open it in the default browser, and return its URL, port, and connected browser count.",
      inputSchema: startCanvasSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const canvas = await runtime.ensureCanvas();
        canvas.broadcastScene();
        const opened = args.openBrowser ? await tryOpenCanvas(canvas.url) : false;
        return textResult(`Canvas ready at ${canvas.url} (${canvas.clientCount()} client(s)).`, {
          url: canvas.url,
          port: canvas.port,
          clients: canvas.clientCount(),
          opened,
        });
      }),
  );

  server.registerTool(
    "read_diagram_guide",
    {
      title: "Read Diagram Guide",
      description:
        "Return Excalidraw MCP drawing rules, supported element format, layout quality checks, and screenshot verification guidance.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult(DIAGRAM_GUIDE),
  );

  server.registerTool(
    "batch_create_elements",
    {
      title: "Batch Create Elements",
      description:
        "Create many Excalidraw skeleton elements in one atomic batch. Use stable IDs, bound labels, and arrow bindings when possible.",
      inputSchema: batchCreateElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const created = await store.batchCreate(args.elements);
        await broadcastElementsOrScene(runtime, created);
        const elements = await store.getElements();
        return textResult(`Created ${args.elements.length} element(s). Scene now has ${elements.length} element(s).`, {
          created: args.elements.length,
          total: elements.length,
          ids: newestIds(elements, args.elements),
        });
      }),
  );

  server.registerTool(
    "update_elements",
    {
      title: "Update Elements",
      description:
        "Update existing Excalidraw elements by ID. Prefer this over delete-and-recreate so bindings and user edits are preserved.",
      inputSchema: updateElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const updated = await store.updateElements(args.updates);
        await broadcastElementsOrScene(runtime, updated);
        return textResult(`Updated ${args.updates.length} element(s).`, {
          updated: args.updates.length,
          ids: args.updates.map((element) => element.id),
        });
      }),
  );

  server.registerTool(
    "delete_elements",
    {
      title: "Delete Elements",
      description:
        "Destructive: delete selected Excalidraw elements by ID. Inspect the scene first and prefer update_elements when preserving layout is possible.",
      inputSchema: deleteElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        await store.deleteElements(args.ids);
        await runtime.broadcastPatch({ deletedIds: args.ids });
        const elements = await store.getElements();
        return textResult(`Deleted ${args.ids.length} element(s). Scene now has ${elements.length} element(s).`, {
          deleted: args.ids.length,
          ids: args.ids,
          total: elements.length,
        });
      }),
  );

  server.registerTool(
    "clear_canvas",
    {
      title: "Clear Canvas",
      description:
        "Destructive: clear every element from the current Excalidraw scene. Use only when the user asked for a reset or replace.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const store = await runtime.getStore();
        await store.clear();
        await runtime.broadcastScene();
        return textResult("Canvas cleared.", { total: 0 });
      }),
  );

  server.registerTool(
    "query_elements",
    {
      title: "Query Elements",
      description:
        "Search current scene elements by ID, type, text/label, or group ID before making targeted edits.",
      inputSchema: queryElementsToolSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const result = await store.query(args);
        const matches = Array.isArray(result) ? result : [];
        return textResult(`Found ${matches.length} matching element(s).`, {
          count: matches.length,
          matches: truncateArray(matches),
        });
      }),
  );

  server.registerTool(
    "describe_scene",
    {
      title: "Describe Scene",
      description:
        "Return a compact summary of element positions, labels, connections, and overall scene bounds for inspection and layout planning.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const store = await runtime.getStore();
        const description = await store.describe();
        const bounds = description.bounds
          ? `${description.bounds.x},${description.bounds.y} ${description.bounds.width}x${description.bounds.height}`
          : "empty";
        return textResult(`Scene has ${description.count} element(s). Bounds: ${bounds}.`, {
          description,
        });
      }),
  );

  server.registerTool(
    "set_viewport",
    {
      title: "Set Viewport",
      description:
        "Fit content, center a specific element, or set canvas scroll/zoom. Use after meaningful layout changes.",
      inputSchema: setViewportSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const viewport = args as Partial<ViewportState> & {
          scrollToContent?: boolean;
          scrollToElementId?: string;
        };
        await store.setViewport(viewport);
        runtime.getCanvas()?.setViewport(viewport);
        return textResult("Viewport updated.", { viewport });
      }),
  );

  server.registerTool(
    "get_canvas_screenshot",
    {
      title: "Get Canvas Screenshot",
      description:
        "Render the current canvas as a PNG and return image content. Use this after significant changes to catch clipping, overlap, and bad arrow routing.",
      inputSchema: getCanvasScreenshotSchema,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const exportResult = await requestCanvasExport(runtime, "png", args.background);
        return imageResult(
          `Rendered PNG screenshot (${exportResult.requestId}).`,
          { data: exportResult.data, mimeType: exportResult.mimeType },
          {
            requestId: exportResult.requestId,
            format: exportResult.format,
            mimeType: exportResult.mimeType,
          },
        );
      }),
  );

  server.registerTool(
    "export_scene",
    {
      title: "Export Scene",
      description:
        "Write the current .excalidraw JSON scene under the allowed workspace path. Path traversal outside the workspace is refused.",
      inputSchema: exportSceneSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const scene = await store.exportScene();
        const resolved = await writeJsonWorkspaceFile(
          args.filePath,
          defaultExportName("scene", "excalidraw"),
          scene,
        );
        return textResult(`Exported scene JSON to ${resolved}.`, {
          path: resolved,
          elements: scene.elements.length,
        });
      }),
  );

  server.registerTool(
    "import_scene",
    {
      title: "Import Scene",
      description:
        "Destructive in replace mode: load .excalidraw JSON from workspace path or provided JSON data. Use merge mode to preserve existing content.",
      inputSchema: importSceneSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        if ((args.filePath === undefined || args.filePath === "") && (args.data === undefined || args.data === "")) {
          throw new Error("Provide either filePath or data.");
        }

        if (args.filePath !== undefined && args.filePath !== "" && args.data !== undefined && args.data !== "") {
          throw new Error("Provide filePath or data, not both.");
        }

        const scene =
          args.data !== undefined && args.data !== "" ? (JSON.parse(args.data) as unknown) : await readJsonWorkspaceFile(args.filePath ?? "");
        const store = await runtime.getStore();
        await store.importScene(scene, args.mode);
        await runtime.broadcastScene();
        const elements = await store.getElements();
        return textResult(`Imported scene in ${args.mode} mode. Scene now has ${elements.length} element(s).`, {
          mode: args.mode,
          total: elements.length,
        });
      }),
  );

  server.registerTool(
    "export_to_image",
    {
      title: "Export To Image",
      description:
        "Render the current canvas and write PNG or SVG under the allowed workspace path. Path traversal outside the workspace is refused.",
      inputSchema: exportToImageSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const exportResult = await requestCanvasExport(runtime, args.format, args.background);
        const resolved = await writeCanvasExport(
          args.filePath,
          defaultExportName("canvas", args.format),
          exportResult,
        );
        return textResult(`Exported ${args.format.toUpperCase()} image to ${resolved}.`, {
          path: resolved,
          format: args.format,
          mimeType: exportResult.mimeType,
          requestId: exportResult.requestId,
        });
      }),
  );

  server.registerTool(
    "snapshot_scene",
    {
      title: "Snapshot Scene",
      description:
        "Save an in-memory named snapshot of the scene so risky edits can be rolled back with restore_snapshot.",
      inputSchema: snapshotSceneSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const snapshot = await store.snapshot(args.name);
        return textResult(`Snapshot saved: ${args.name}.`, { name: args.name, snapshot });
      }),
  );

  server.registerTool(
    "restore_snapshot",
    {
      title: "Restore Snapshot",
      description:
        "Destructive: restore a named in-memory snapshot, replacing the current scene with the saved version.",
      inputSchema: restoreSnapshotSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        await store.restoreSnapshot(args.name);
        await runtime.broadcastScene();
        const elements = await store.getElements();
        return textResult(`Restored snapshot: ${args.name}. Scene now has ${elements.length} element(s).`, {
          name: args.name,
          total: elements.length,
        });
      }),
  );

  server.registerTool(
    "lint_scene",
    {
      title: "Lint Scene",
      description:
        "Analyze the current scene for visual quality issues such as overlap, clipped text, tiny fonts, arrow crossings, low contrast, and off-canvas content.",
      inputSchema: lintSceneSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const report = lintScene(selectElements(elements, args.ids));
        return textResult(`Found ${report.issues.length} scene issue(s).`, { report });
      }),
  );

  server.registerTool(
    "suggest_layout_fixes",
    {
      title: "Suggest Layout Fixes",
      description:
        "Return deterministic layout repair suggestions for overlap, cramped spacing, clipped text, and arrow routing without changing the scene.",
      inputSchema: suggestLayoutFixesSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const layoutResult = suggestLayoutFixes(selectElements(elements, args.ids), {
          ids: args.ids,
          maxSuggestions: args.maxSuggestions,
        });
        const suggestions = layoutFixesFromResult(layoutResult).slice(0, args.maxSuggestions);
        return textResult(`Suggested ${suggestions.length} layout fix(es).`, {
          suggestions,
          plan: withLayoutFixes(layoutResult, suggestions),
        });
      }),
  );

  server.registerTool(
    "apply_layout_fixes",
    {
      title: "Apply Layout Fixes",
      description:
        "Apply selected deterministic layout fixes. Inspect the scene and screenshot afterward because this mutates element positions and sizes.",
      inputSchema: applyLayoutFixesSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const layoutResult = suggestLayoutFixes(selectElements(elements, args.ids), {
          ids: args.ids,
          maxSuggestions: args.maxFixes,
        });
        const suggestions = layoutFixesFromResult(layoutResult);
        const filtered = args.fixIds?.length
          ? suggestions.filter((suggestion) => args.fixIds?.includes(suggestion.id))
          : suggestions.slice(0, args.maxFixes);
        const updates = toLayoutFixUpdates(
          elements,
          withLayoutFixes(layoutResult, filtered) as Parameters<typeof toLayoutFixUpdates>[1],
          {
            fixIds: args.fixIds,
            maxFixes: args.maxFixes,
          },
        ) as ToolElementUpdate[];

        if (args.dryRun) {
          return textResult(`Prepared ${updates.length} layout update(s).`, { suggestions: filtered, updates });
        }

        if (updates.length > 0) {
          await store.updateElements(updates);
          await runtime.broadcastScene();
        }

        return textResult(`Applied ${updates.length} layout update(s).`, { suggestions: filtered, updates });
      }),
  );

  server.registerTool(
    "route_arrows",
    {
      title: "Route Arrows",
      description:
        "Recalculate arrow points using straight, elbow, or orthogonal routing. Use to avoid arrows through unrelated elements.",
      inputSchema: routeArrowsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const routeResult = routeArrows(elements, {
          ids: args.ids,
          style: args.style,
          avoidObstacles: args.avoidObstacles,
          forceElbow: args.style !== "straight",
          margin: args.avoidObstacles ? undefined : 0,
        });
        const updates = updatesFromResult(routeResult);

        if (args.dryRun) {
          return textResult(`Prepared ${updates.length} arrow route update(s).`, {
            updates,
            plan: routeResult,
          });
        }

        if (updates.length > 0) {
          await store.updateElements(updates);
          await runtime.broadcastScene();
        }

        return textResult(`Routed ${updates.length} arrow(s).`, { updates, plan: routeResult });
      }),
  );

  server.registerTool(
    "create_diagram_plan",
    {
      title: "Create Diagram Plan",
      description:
        "Create a coordinate-grid plan with proposed stable IDs, element skeletons, and arrows before drawing. This does not mutate the canvas.",
      inputSchema: createDiagramPlanSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const plan = createDiagramPlan({
          title: args.goal,
          nodes: args.nodes?.map((node) => node.label),
          edges: args.edges,
          direction: args.layout === "column" ? "top-to-bottom" : "left-to-right",
          columns: args.layout === "column" ? 1 : args.layout === "grid" ? undefined : args.nodes?.length,
          startX: args.startX,
          startY: args.startY,
          nodeWidth: args.nodeWidth,
          nodeHeight: args.nodeHeight,
          gapX: args.gapX,
          gapY: args.gapY,
          theme: args.layout === "swimlane" ? "presentation" : "light",
        });
        return textResult(`Prepared a ${args.layout} diagram plan with ${plan.nodes.length} node(s).`, { plan });
      }),
  );

  server.registerTool(
    "auto_layout",
    {
      title: "Auto Layout Scene",
      description:
        "Automatically reposition selected non-linear elements into a row, column, grid, or dependency-layered layout and optionally route arrows around obstacles.",
      inputSchema: autoLayoutSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const layout = autoLayoutElements(elements, args);
        if (args.dryRun) {
          return textResult(layout.summary, { layout });
        }
        if (layout.updates.length > 0) {
          await store.updateElements(layout.updates);
          await runtime.broadcastScene();
        }
        return textResult(`Auto-layout applied ${layout.updates.length} update(s).`, { layout });
      }),
  );

  server.registerTool(
    "polish_scene",
    {
      title: "Polish Scene",
      description:
        "Run an automatic visual polish pass: layout selected elements, route arrows, and return the prepared or applied updates.",
      inputSchema: polishSceneSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const polish = polishScene(elements, args);
        if (args.dryRun) {
          return textResult(polish.summary, { polish });
        }
        if (polish.updates.length > 0) {
          await store.updateElements(polish.updates);
          await runtime.broadcastScene();
        }
        return textResult(`Polished scene with ${polish.updates.length} update(s).`, { polish });
      }),
  );

  server.registerTool(
    "create_from_template",
    {
      title: "Create From Diagram Template",
      description:
        "Create a reusable Excalidraw template such as C4, flowchart, swimlane, sequence, state machine, ERD, data-flow, README hero, or MCP tool map.",
      inputSchema: createTemplateDiagramSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const template = createTemplateDiagram(args);
        if (args.mode === "dry-run") {
          return textResult(`Prepared ${template.kind} template with ${template.elements.length} element(s).`, { template });
        }
        const store = await runtime.getStore();
        if (args.mode === "replace") {
          await store.clear();
        }
        const created = await store.batchCreate(template.elements);
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        return textResult(`Created ${createdCount(created, template.elements.length)} template element(s).`, {
          template,
          created: createdCount(created, template.elements.length),
        });
      }),
  );

  server.registerTool(
    "create_repo_diagram",
    {
      title: "Create Repository Diagram",
      description:
        "Inspect the local workspace and create a heuristic repository architecture, dependency, test-map, or API-map diagram.",
      inputSchema: createRepoDiagramSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const diagram = await createRepoDiagram(args);
        if (args.mode === "dry-run") {
          return textResult(diagram.summary, { diagram });
        }
        const store = await runtime.getStore();
        if (args.mode === "replace") {
          await store.clear();
        }
        const created = await store.batchCreate(diagram.elements);
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        return textResult(`Created repository diagram with ${createdCount(created, diagram.elements.length)} element(s).`, {
          diagram,
          created: createdCount(created, diagram.elements.length),
        });
      }),
  );

  server.registerTool(
    "create_github_readme_assets",
    {
      title: "Create GitHub README Assets",
      description:
        "Create a GitHub README-oriented repository diagram scene. Use export_to_image afterward to write PNG/SVG into docs/assets.",
      inputSchema: createGithubReadmeAssetsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const diagram = await createGithubReadmeDiagram(args);
        if (args.mode === "dry-run") {
          return textResult(diagram.summary, {
            diagram,
            suggestedPng: `${args.assetBasePath}.png`,
            suggestedSvg: `${args.assetBasePath}.svg`,
          });
        }
        const store = await runtime.getStore();
        if (args.mode === "replace") {
          await store.clear();
        }
        const created = await store.batchCreate(diagram.elements);
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        return textResult(`Created GitHub README diagram scene with ${createdCount(created, diagram.elements.length)} element(s).`, {
          diagram,
          created: createdCount(created, diagram.elements.length),
          suggestedPng: `${args.assetBasePath}.png`,
          suggestedSvg: `${args.assetBasePath}.svg`,
          updateReadmeRequested: args.updateReadme,
        });
      }),
  );

  server.registerTool(
    "theme_scene",
    {
      title: "Theme Scene",
      description:
        "Apply or preview a consistent visual theme across selected scene elements. Use after layout is stable.",
      inputSchema: themeSceneSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const themeResult = themeScene(selectElements(elements, args.ids), {
          theme: args.theme,
          ids: args.ids,
        });
        const updates = updatesFromResult(themeResult);

        if (!args.apply) {
          return textResult(`Prepared ${updates.length} theme update(s).`, {
            updates,
            plan: themeResult,
          });
        }

        if (updates.length > 0) {
          await store.updateElements(updates);
          await runtime.broadcastScene();
        }

        return textResult(`Applied ${args.theme} theme to ${updates.length} element(s).`, {
          updates,
          plan: themeResult,
        });
      }),
  );

  server.registerTool(
    "compare_snapshots",
    {
      title: "Compare Snapshots",
      description:
        "Compare two named in-memory snapshots and report added, removed, moved, resized, relabeled, and restyled elements.",
      inputSchema: compareSnapshotsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const reader = (store as { getSnapshot?: (name: string) => unknown }).getSnapshot;
        if (typeof reader !== "function") {
          throw new Error("Current store does not support snapshot comparison.");
        }
        const left = reader.call(store, args.left);
        const right = reader.call(store, args.right);
        const diff = compareSceneSnapshots(await Promise.resolve(left), await Promise.resolve(right));
        return textResult(`Snapshot diff: ${diff.summary}.`, { diff });
      }),
  );

  server.registerTool(
    "diff_scenes",
    {
      title: "Diff Scenes",
      description:
        "Compare snapshots, scene files, or the current scene and report added, removed, changed, and unchanged elements.",
      inputSchema: diffScenesSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const left = await resolveSceneForDiff(store, args.leftSnapshot, args.leftFilePath);
        const right = await resolveSceneForDiff(store, args.rightSnapshot, args.rightFilePath);
        const diff = compareSceneSnapshots(left, right);
        return textResult(`Scene diff: ${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed.`, { diff });
      }),
  );

  server.registerTool(
    "duplicate_elements",
    {
      title: "Duplicate Elements",
      description:
        "Duplicate selected elements with new stable IDs, optional offset, and remapped bindings for selected arrows.",
      inputSchema: duplicateElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const copies = duplicateElements(elements, {
          ids: args.ids,
          offset: { x: args.offsetX, y: args.offsetY },
          remapGroupIds: true,
        });
        const copyInputs = copies.elements;
        const created = copyInputs.length > 0 ? await store.batchCreate(copyInputs) : [];
        await runtime.broadcastScene();
        return textResult(`Duplicated ${createdCount(created, copyInputs.length)} element(s).`, {
          created: createdCount(created, copyInputs.length),
          ids: Array.isArray(created) ? created.map((element) => element.id) : copyInputs.flatMap((element) => element.id ? [element.id] : []),
          idMap: copies.idMap,
          requestedIdPrefix: args.idPrefix,
        });
      }),
  );

  server.registerTool(
    "group_elements",
    {
      title: "Group Elements",
      description:
        "Add a group ID to selected elements so Codex can query, move, theme, or export them as a unit.",
      inputSchema: groupElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const groupId = args.groupId ?? createOpaqueId("group");
        const result = createGroupUpdates(elements, args.ids, groupId);
        if (result.updates.length > 0) {
          await store.updateElements(result.updates);
          await runtime.broadcastScene();
        }
        return textResult(`Grouped ${result.updates.length} element(s) as ${groupId}.`, result);
      }),
  );

  server.registerTool(
    "ungroup_elements",
    {
      title: "Ungroup Elements",
      description:
        "Remove a specific group ID from selected elements, or remove all group IDs when no group ID is provided.",
      inputSchema: ungroupElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const result = createUngroupUpdates(elements, args.ids, args.groupId);
        if (result.updates.length > 0) {
          await store.updateElements(result.updates);
          await runtime.broadcastScene();
        }
        return textResult(`Ungrouped ${result.updates.length} element(s).`, result);
      }),
  );

  server.registerTool(
    "create_frame_from_elements",
    {
      title: "Create Frame From Elements",
      description:
        "Create a padded Excalidraw frame around selected elements with a stable frame ID and name.",
      inputSchema: createFrameFromElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const frame = createFrameElement(elements, {
          ids: args.ids,
          frameId: args.frameId,
          name: args.name,
          padding: args.padding,
          style: {
            backgroundColor: args.backgroundColor,
            strokeColor: args.strokeColor,
          },
        });
        const created = await store.batchCreate([frame.element]);
        if (frame.updates.length > 0) {
          await store.updateElements(frame.updates);
        }
        await runtime.broadcastScene();
        const createdFrameId = frame.frameId ?? (Array.isArray(created) ? created[0]?.id : undefined) ?? "frame";
        return textResult(`Created frame ${createdFrameId}.`, { frame, created });
      }),
  );

  server.registerTool(
    "add_image",
    {
      title: "Add Image",
      description:
        "Add a workspace-local PNG, JPEG, GIF, WebP, or SVG file as an Excalidraw image element and attach its file data to the scene.",
      inputSchema: addImageSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const asset = await prepareImageAsset(args.filePath, args.id ? `${args.id}-file` : undefined);
        await store.addFiles?.(asset.files);
        const element: ElementInput = {
          id: args.id,
          type: "image",
          x: args.x,
          y: args.y,
          width: args.width,
          height: args.height,
          fileId: asset.fileId,
          status: "saved",
          scale: [1, 1],
          label: args.label,
          metadata: args.metadata,
        };
        const created = await store.batchCreate([element]);
        await runtime.broadcastScene();
        return textResult(`Added image element ${args.id ?? asset.fileId}.`, {
          created: createdCount(created, 1),
          fileId: asset.fileId,
          files: Object.keys(asset.files),
        });
      }),
  );

  server.registerTool(
    "set_element_order",
    {
      title: "Set Element Order",
      description:
        "Move selected element IDs to front, back, forward, or backward in scene order for layering and background zones.",
      inputSchema: setElementOrderSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const scene = await store.exportScene();
        const elements = reorderElements(scene.elements, args.ids, args.position);
        await store.importScene({ ...scene, elements }, "replace");
        await runtime.broadcastScene();
        return textResult(`Moved ${args.ids.length} element(s) ${args.position}.`, { ids: args.ids, position: args.position });
      }),
  );

  server.registerTool(
    "tag_elements",
    {
      title: "Tag Elements",
      description:
        "Attach semantic metadata to selected elements so future agents can query roles such as service, database, boundary, owner, status, or documentation output.",
      inputSchema: tagElementsSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const byId = new Map(elements.map((element) => [element.id, element]));
        const updates = args.ids.map((id) => {
          const current = byId.get(id);
          if (!current) {
            throw new Error(`Cannot tag missing element: ${id}`);
          }
          return {
            id,
            metadata: args.merge ? { ...(current.metadata ?? {}), ...args.metadata } : args.metadata,
          };
        });
        await store.updateElements(updates);
        await runtime.broadcastScene();
        return textResult(`Tagged ${updates.length} element(s).`, { updates });
      }),
  );

  server.registerTool(
    "export_selection_to_image",
    {
      title: "Export Selection To Image",
      description:
        "Render selected element IDs and write PNG or SVG under the allowed workspace path. Requires a connected browser canvas.",
      inputSchema: exportSelectionToImageSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const exportResult = await requestCanvasExport(runtime, args.format, args.background, args.ids);
        const resolved = await writeCanvasExport(
          args.filePath,
          defaultExportName("selection", args.format),
          exportResult,
        );
        return textResult(`Exported ${args.ids.length} selected element(s) to ${resolved}.`, {
          path: resolved,
          format: args.format,
          mimeType: exportResult.mimeType,
          requestId: exportResult.requestId,
          ids: args.ids,
        });
      }),
  );

  server.registerTool(
    "diagram_review_report",
    {
      title: "Diagram Review Report",
      description:
        "Return a structured quality review with score, issues, recommended fixes, and export readiness.",
      inputSchema: diagramReviewReportSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const elements = await store.getElements();
        const report = createDiagramReviewReport(selectElements(elements, args.ids));
        return textResult(`Diagram review score: ${report.score}. Export readiness: ${report.verdict}.`, { report });
      }),
  );

  server.registerTool(
    "preview_mermaid_conversion",
    {
      title: "Preview Mermaid Conversion",
      description:
        "Convert Mermaid text in preview mode and report element count, estimated bounds, unsupported risks, and suggested scale without changing the canvas.",
      inputSchema: previewMermaidConversionSchema,
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const preview = await previewMermaidConversion(args);
        return textResult(`Mermaid preview: ${preview.elementCount} element(s), ${preview.warnings.length} warning(s).`, { preview });
      }),
  );

  server.registerTool(
    "normalize_mermaid_layout",
    {
      title: "Normalize Mermaid Layout",
      description:
        "Convert Mermaid to Excalidraw elements, fit it to target bounds, and optionally apply the normalized result to the canvas.",
      inputSchema: normalizeMermaidLayoutSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const conversion = await normalizeMermaidLayout(args);

        if (args.dryRun) {
          return textResult(`Prepared ${conversion.elements.length} normalized Mermaid element(s).`, { conversion });
        }

        const store = await runtime.getStore();
        if (args.mode === "replace") {
          await store.clear();
        }
        const created = await store.batchCreate(conversion.elements);
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);

        return textResult(`Created ${createdCount(created, conversion.elements.length)} normalized Mermaid element(s).`, {
          ...conversion,
          created: createdCount(created, conversion.elements.length),
        });
      }),
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_openapi",
    "Import OpenAPI Diagram",
    "Import an OpenAPI JSON or YAML-ish spec from workspace data/path and create an endpoint map with Dagre layout.",
    importOpenApiSchema,
    "openapi",
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_package_dependencies",
    "Import Package Dependency Diagram",
    "Import package.json data from workspace data/path and create a dependency graph with Dagre layout.",
    importPackageDependenciesSchema,
    "package-dependencies",
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_database_schema",
    "Import Database Schema Diagram",
    "Import SQL DDL from workspace data/path and create a table relationship diagram with Dagre layout.",
    importDatabaseSchemaSchema,
    "database-schema",
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_markdown_outline",
    "Import Markdown Outline Diagram",
    "Import Markdown headings from workspace data/path and create an outline map with hierarchy bindings.",
    importMarkdownOutlineSchema,
    "markdown-outline",
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_plantuml",
    "Import PlantUML Diagram",
    "Import simple PlantUML relationships from workspace data/path and create editable Excalidraw elements.",
    importPlantUmlSchema,
    "plantuml",
  );

  registerImportSourceTool(
    server,
    runtime,
    "import_structurizr",
    "Import Structurizr DSL Diagram",
    "Import C4 Structurizr DSL from workspace data/path and create editable Excalidraw elements.",
    importStructurizrSchema,
    "structurizr",
  );

  server.registerTool(
    "create_verified_diagram",
    {
      title: "Create Verified Diagram",
      description:
        "High-level workflow: plan or import a diagram, create elements, apply Dagre layout, theme, screenshot, lint/polish, and export PNG plus .excalidraw JSON.",
      inputSchema: createVerifiedDiagramSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => createVerifiedDiagram(runtime, args)),
  );

  server.registerTool(
    "session_status",
    {
      title: "Session Status",
      description:
        "Report whether the local persistent Excalidraw MCP session file exists and summarize its metadata.",
      inputSchema: sessionPathSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const status = await getSessionStatus(args.filePath);
        return textResult(status.exists ? `Session found at ${status.path}.` : `No session found at ${status.path}.`, { status });
      }),
  );

  server.registerTool(
    "save_session",
    {
      title: "Save Session",
      description:
        "Persist the current scene to a local workspace session file so the canvas can be restored after MCP restarts.",
      inputSchema: sessionPathSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const scene = await store.exportScene();
        const status = await saveSession(scene, args.filePath);
        return textResult(`Saved session to ${status.path}.`, { status });
      }),
  );

  server.registerTool(
    "load_session",
    {
      title: "Load Session",
      description:
        "Destructive: load the local workspace session file and replace the current canvas scene with it.",
      inputSchema: sessionPathSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const scene = await loadSession(args.filePath);
        if (!scene) {
          throw new Error("Session file does not exist.");
        }
        const store = await runtime.getStore();
        await store.importScene(scene, "replace");
        await runtime.broadcastScene();
        const elements = await store.getElements();
        return textResult(`Loaded session with ${elements.length} element(s).`, {
          elements: elements.length,
        });
      }),
  );

  server.registerTool(
    "list_canvas_sessions",
    {
      title: "List Canvas Sessions",
      description:
        "List named local canvas sessions saved under .excalidraw-mcp/sessions for multi-diagram workflows.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const sessions = await listNamedSessions();
        return textResult(`Found ${sessions.length} named canvas session(s).`, { sessions });
      }),
  );

  server.registerTool(
    "save_canvas_session",
    {
      title: "Save Canvas Session",
      description:
        "Save the current canvas under a named local session, enabling multiple diagrams/projects in one workspace.",
      inputSchema: namedSessionSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const store = await runtime.getStore();
        const status = await saveSession(await store.exportScene(), namedSessionPath(args.name));
        return textResult(`Saved named canvas session ${args.name}.`, { status, name: args.name });
      }),
  );

  server.registerTool(
    "switch_canvas_session",
    {
      title: "Switch Canvas Session",
      description:
        "Destructive: replace the current canvas with a named local canvas session from .excalidraw-mcp/sessions.",
      inputSchema: namedSessionSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const scene = await loadSession(namedSessionPath(args.name));
        if (!scene) {
          throw new Error(`Named session does not exist: ${args.name}`);
        }
        const store = await runtime.getStore();
        await store.importScene(scene, "replace");
        await runtime.broadcastScene();
        return textResult(`Switched to named canvas session ${args.name}.`, {
          name: args.name,
          elements: scene.elements.length,
          files: Object.keys(scene.files).length,
        });
      }),
  );

  server.registerTool(
    "delete_canvas_session",
    {
      title: "Delete Canvas Session",
      description:
        "Destructive: delete a named local canvas session file. This does not change the currently open canvas.",
      inputSchema: namedSessionSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const result = await deleteSession(namedSessionPath(args.name));
        return textResult(result.deleted ? `Deleted named canvas session ${args.name}.` : `No named canvas session found for ${args.name}.`, {
          ...result,
          name: args.name,
        });
      }),
  );

  server.registerTool(
    "create_from_mermaid",
    {
      title: "Create From Mermaid",
      description:
        "Convert Mermaid text to editable Excalidraw elements, then add them to the scene. Replace mode clears the current canvas first.",
      inputSchema: createFromMermaidSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const conversion = await convertMermaidToElementInputs(args.mermaidDiagram, {
          offsetX: args.offsetX,
          offsetY: args.offsetY,
          scale: args.scale,
        });
        const store = await runtime.getStore();

        if (args.mode === "replace") {
          await store.clear();
        }

        const created = await store.batchCreate(conversion.elements);
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);

        const elements = await store.getElements();
        return textResult(`Created ${createdCount(created, conversion.elements.length)} Mermaid element(s).`, {
          implemented: true,
          mode: args.mode,
          created: createdCount(created, conversion.elements.length),
          total: elements.length,
          ids: newestIds(elements, conversion.elements),
          files: Object.keys(conversion.files).length,
        });
      }),
  );
}

async function runTool(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return errorResult(error);
  }
}

function newestIds(elements: DiagramElement[], inputs: ElementInput[]): string[] {
  const explicitIds = inputs.flatMap((element) => (element.id ? [element.id] : []));
  if (explicitIds.length > 0) {
    return explicitIds;
  }

  return elements.slice(-inputs.length).map((element) => element.id);
}

function truncateArray(values: unknown[], max = 50): unknown[] {
  if (values.length <= max) {
    return values;
  }

  return values.slice(0, max);
}

function selectElements(elements: DiagramElement[], ids: string[] | undefined): DiagramElement[] {
  if (!ids || ids.length === 0) {
    return elements;
  }

  const selectedIds = new Set(ids);
  return elements.filter((element) => selectedIds.has(element.id));
}

function layoutFixesFromResult(result: unknown): ToolLayoutFix[] {
  if (Array.isArray(result)) {
    return result as ToolLayoutFix[];
  }
  if (isRecord(result) && Array.isArray(result.fixes)) {
    return result.fixes as ToolLayoutFix[];
  }
  return [];
}

function withLayoutFixes(result: unknown, fixes: ToolLayoutFix[]): ToolLayoutFix[] | Record<string, unknown> {
  if (isRecord(result)) {
    return { ...result, fixes };
  }
  return fixes;
}

function updatesFromResult(result: unknown): ToolElementUpdate[] {
  if (Array.isArray(result)) {
    return result as ToolElementUpdate[];
  }
  if (isRecord(result) && Array.isArray(result.updates)) {
    return result.updates as ToolElementUpdate[];
  }
  return [];
}

async function broadcastElementsOrScene(runtime: ExcalidrawRuntime, result: unknown): Promise<void> {
  if (Array.isArray(result)) {
    await runtime.broadcastPatch({ upserts: result as DiagramElement[] });
    return;
  }
  await runtime.broadcastScene();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registerImportSourceTool(
  server: McpServer,
  runtime: ExcalidrawRuntime,
  name: Extract<ExcalidrawToolName, `import_${string}`>,
  title: string,
  description: string,
  inputSchema: typeof importOpenApiSchema,
  kind: ImportSourceKind,
): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => {
        const imported = await importDiagramSource({ kind, ...args });
        if (args.mode === "dry-run") {
          return textResult(`Prepared ${imported.sourceSummary.nodes} ${kind} node(s) and ${imported.sourceSummary.edges} edge(s).`, {
            imported,
          });
        }

        const store = await runtime.getStore();
        if (args.mode === "replace") {
          await store.clear();
        }
        const created = await store.batchCreate(imported.elements);
        const createdIds = newestIds(await store.getElements(), imported.elements);
        const layout = autoLayoutElements(await store.getElements(), {
          ids: layoutTargetIds(await store.getElements(), createdIds),
          mode: "dagre",
          rankDirection: "LR",
          startX: args.startX,
          startY: args.startY,
        });
        if (layout.updates.length > 0) {
          await store.updateElements(layout.updates);
        }
        await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
        await runtime.broadcastScene();
        runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);

        const { elements: _omittedElements, ...importSummary } = imported;
        return textResult(`Imported ${imported.title} with ${createdCount(created, imported.elements.length)} element(s).`, {
          imported: importSummary,
          created: createdCount(created, imported.elements.length),
          ids: createdIds,
          layout,
        });
      }),
  );
}

async function createVerifiedDiagram(
  runtime: ExcalidrawRuntime,
  args: CreateVerifiedDiagramArgs,
): Promise<CallToolResult> {
  const prepared = await prepareVerifiedDiagramElements(args);
  const store = await runtime.getStore();
  if (args.mode === "replace") {
    await store.clear();
  }

  const created = await store.batchCreate(prepared.elements);
  let elements = await store.getElements();
  const createdIds = newestIds(elements, prepared.elements);
  const layoutIds = layoutTargetIds(elements, createdIds);
  const layout = autoLayoutElements(elements, {
    ids: layoutIds,
    mode: "dagre",
    rankDirection: args.rankDirection,
    startX: 80,
    startY: 140,
    routeArrows: true,
  });
  if (layout.updates.length > 0) {
    await store.updateElements(layout.updates);
  }

  elements = await store.getElements();
  const theme = themeScene(selectElements(elements, createdIds), { theme: args.theme });
  const themeUpdates = updatesFromResult(theme);
  if (themeUpdates.length > 0) {
    await store.updateElements(themeUpdates);
  }

  elements = await store.getElements();
  const polish = polishScene(elements, {
    ids: layoutTargetIds(elements, createdIds),
    mode: "dagre",
    rankDirection: args.rankDirection,
    routeArrows: true,
    maxPasses: 2,
  });
  if (polish.updates.length > 0) {
    await store.updateElements(polish.updates);
  }

  await store.setViewport({ scrollToContent: true } as Partial<ViewportState>);
  await runtime.broadcastScene();
  runtime.getCanvas()?.setViewport({ scrollToContent: true } as Partial<ViewportState>);

  const scene = await store.exportScene();
  const report = createDiagramReviewReport(scene.elements);
  const exportBasePath = stripKnownDiagramExtension(args.exportBasePath);
  const screenshot = await requestCanvasExport(runtime, "png", args.background);
  const pngPath = await writeCanvasExport(`${exportBasePath}.png`, `${exportBasePath}.png`, screenshot);
  const scenePath = await writeJsonWorkspaceFile(`${exportBasePath}.excalidraw`, `${exportBasePath}.excalidraw`, scene);

  return textResult(`Verified diagram created and exported. Review score: ${report.score}.`, {
    source: args.source,
    summary: prepared.summary,
    created: createdCount(created, prepared.elements.length),
    ids: createdIds,
    layout,
    polish,
    report,
    exports: {
      png: pngPath,
      scene: scenePath,
      requestId: screenshot.requestId,
    },
  });
}

async function prepareVerifiedDiagramElements(args: CreateVerifiedDiagramArgs): Promise<{
  summary: string;
  elements: ElementInput[];
}> {
  if (args.source === "template") {
    const template = createTemplateDiagram({
      kind: args.templateKind,
      title: args.prompt,
      theme: templateTheme(args.theme),
    });
    return {
      summary: `Template: ${template.kind}`,
      elements: template.elements,
    };
  }

  if (args.source === "repo") {
    const diagram = await createRepoDiagram({
      kind: args.repoKind,
      title: args.prompt,
    });
    return {
      summary: diagram.summary,
      elements: diagram.elements,
    };
  }

  if (args.source === "mermaid") {
    const conversion = await convertMermaidToElementInputs(
      args.data ?? args.prompt ?? "flowchart LR\n  A[Start] --> B[Process]\n  B --> C[Finish]",
    );
    return {
      summary: `Mermaid conversion with ${conversion.elements.length} element(s).`,
      elements: conversion.elements,
    };
  }

  if (args.source === "plan") {
    const plan = createDiagramPlan(args.prompt ?? "Start -> Process -> Finish");
    return {
      summary: `Plan: ${plan.title ?? plan.goal ?? "verified diagram"}`,
      elements: plan.elements,
    };
  }

  if (isImportKind(args.source)) {
    const imported = await importDiagramSource({
      kind: args.source,
      filePath: args.filePath,
      data: args.data,
      title: args.prompt,
    });
    return {
      summary: `Imported ${imported.sourceSummary.nodes} node(s) and ${imported.sourceSummary.edges} edge(s) from ${args.source}.`,
      elements: imported.elements,
    };
  }

  throw new Error(`Unsupported verified diagram source: ${args.source satisfies never}`);
}

function isImportKind(value: string): value is ImportSourceKind {
  return [
    "openapi",
    "package-dependencies",
    "database-schema",
    "markdown-outline",
    "plantuml",
    "structurizr",
  ].includes(value);
}

function layoutTargetIds(elements: readonly DiagramElement[], ids: readonly string[]): string[] {
  const selected = new Set(ids);
  return elements
    .filter((element) => selected.has(element.id))
    .filter((element) => !["arrow", "line", "text"].includes(element.type))
    .map((element) => element.id);
}

function templateTheme(theme: CreateVerifiedDiagramArgs["theme"]): "technical" | "presentation" | "soft" | "mono" {
  return theme === "dark" ? "technical" : theme;
}

function stripKnownDiagramExtension(filePath: string): string {
  return filePath.replace(/\.(png|svg|excalidraw|json)$/i, "");
}

async function resolveSceneForDiff(
  store: Awaited<ReturnType<ExcalidrawRuntime["getStore"]>>,
  snapshotName?: string,
  filePath?: string,
): Promise<unknown> {
  if (snapshotName) {
    const reader = (store as { getSnapshot?: (name: string) => unknown }).getSnapshot;
    if (typeof reader !== "function") {
      throw new Error("Current store does not support snapshot reads.");
    }
    return await Promise.resolve(reader.call(store, snapshotName));
  }
  if (filePath) {
    return readJsonWorkspaceFile(filePath);
  }
  return store.exportScene();
}

function reorderElements(
  elements: readonly DiagramElement[],
  ids: readonly string[],
  position: "front" | "back" | "forward" | "backward",
): DiagramElement[] {
  const selected = new Set(ids);
  const ordered = elements.map((element) => ({ ...element }));
  const missing = ids.filter((id) => !ordered.some((element) => element.id === id));
  if (missing.length > 0) {
    throw new Error(`Cannot reorder missing element(s): ${missing.join(", ")}`);
  }

  if (position === "front" || position === "back") {
    const picked = ordered.filter((element) => selected.has(element.id));
    const rest = ordered.filter((element) => !selected.has(element.id));
    return position === "front" ? [...rest, ...picked] : [...picked, ...rest];
  }

  const step = position === "forward" ? 1 : -1;
  const next = [...ordered];
  const indexes = position === "forward"
    ? [...next.keys()].reverse()
    : [...next.keys()];
  for (const index of indexes) {
    const element = next[index]!;
    if (!selected.has(element.id)) {
      continue;
    }
    const target = index + step;
    if (target < 0 || target >= next.length || selected.has(next[target]!.id)) {
      continue;
    }
    [next[index], next[target]] = [next[target]!, next[index]!];
  }
  return next;
}

async function tryOpenCanvas(url: string): Promise<boolean> {
  if (process.env.EXCALIDRAW_MCP_NO_OPEN === "1") {
    return false;
  }

  try {
    const { default: open } = await import("open");
    await open(url, { wait: false });
    return true;
  } catch {
    return false;
  }
}

function createdCount(created: unknown, fallback: number): number {
  return Array.isArray(created) ? created.length : fallback;
}
