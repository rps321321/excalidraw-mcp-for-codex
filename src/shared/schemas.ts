import { z } from "zod";
import { ELEMENT_TYPES } from "./types.js";

export const MAX_ELEMENTS_PER_BATCH = 500;
export const MAX_ID_LENGTH = 256;
export const MAX_TEXT_LENGTH = 5_000;
export const MAX_IMPORT_DATA_LENGTH = 5_000_000;
export const MAX_MERMAID_LENGTH = 100_000;
export const MAX_TOOL_IDS = 500;
export const MAX_PROMPT_LENGTH = 20_000;
export const MAX_METADATA_KEYS = 50;

export const importSourceKindSchema = z.enum([
  "openapi",
  "package-dependencies",
  "database-schema",
  "markdown-outline",
  "plantuml",
  "structurizr",
]);

export const verifiedDiagramSourceSchema = z.enum([
  "template",
  "repo",
  "mermaid",
  "plan",
  "openapi",
  "package-dependencies",
  "database-schema",
  "markdown-outline",
  "plantuml",
  "structurizr",
]);

export const pointSchema = z.tuple([z.number(), z.number()]);
const idSchema = z.string().min(1).max(MAX_ID_LENGTH);
const idListSchema = z.array(idSchema).min(1).max(MAX_TOOL_IDS);

export const elementBindingSchema = z.object({
  elementId: z.string().min(1).max(MAX_ID_LENGTH),
  fixedPoint: pointSchema.nullable().optional(),
  focus: z.number().optional(),
  gap: z.number().optional(),
});

export const elementLabelSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT_LENGTH),
  fontSize: z.number().positive().optional(),
});

const metadataSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(MAX_TEXT_LENGTH), z.number(), z.boolean(), z.null()]),
).refine((value) => Object.keys(value).length <= MAX_METADATA_KEYS, {
  message: `metadata must contain at most ${MAX_METADATA_KEYS} keys`,
});

export const elementInputSchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  type: z.enum(ELEMENT_TYPES),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  label: elementLabelSchema.optional(),
  points: z.array(pointSchema).min(2).optional(),
  startBinding: elementBindingSchema.nullable().optional(),
  endBinding: elementBindingSchema.nullable().optional(),
  startElementId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  endElementId: z.string().min(1).max(MAX_ID_LENGTH).optional(),
  startArrowhead: z.string().nullable().optional(),
  endArrowhead: z.string().nullable().optional(),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
  fillStyle: z.string().optional(),
  strokeWidth: z.number().positive().optional(),
  strokeStyle: z.string().optional(),
  roughness: z.number().optional(),
  opacity: z.number().min(0).max(100).optional(),
  angle: z.number().optional(),
  roundness: z.object({ type: z.number(), value: z.number().optional() }).nullable().optional(),
  groupIds: z.array(z.string().max(MAX_ID_LENGTH)).optional(),
  locked: z.boolean().optional(),
  name: z.string().max(MAX_TEXT_LENGTH).optional(),
  fileId: z.string().max(MAX_ID_LENGTH).optional(),
  containerId: z.string().max(MAX_ID_LENGTH).nullable().optional(),
  status: z.enum(["pending", "saved", "error"]).optional(),
  scale: pointSchema.optional(),
  zIndex: z.number().int().optional(),
  metadata: metadataSchema.optional(),
});

export const batchCreateElementsSchema = z.object({
  elements: z.array(elementInputSchema).min(1).max(MAX_ELEMENTS_PER_BATCH),
});

export const updateElementsSchema = z.object({
  updates: z.array(elementInputSchema.partial().extend({ id: idSchema })).min(1).max(MAX_ELEMENTS_PER_BATCH),
});

export const deleteElementsSchema = z.object({
  ids: z.array(idSchema).min(1).max(MAX_ELEMENTS_PER_BATCH),
});

export const queryElementsSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH).optional(),
  type: z.enum(ELEMENT_TYPES).optional(),
  text: z.string().max(MAX_TEXT_LENGTH).optional(),
  groupId: z.string().max(MAX_ID_LENGTH).optional(),
});

export const exportSceneSchema = z.object({
  filePath: z.string().optional(),
});

export const importSceneSchema = z.object({
  filePath: z.string().optional(),
  data: z.string().max(MAX_IMPORT_DATA_LENGTH).optional(),
  mode: z.enum(["replace", "merge"]).default("replace"),
});

export const importDiagramSourceSchema = z.object({
  filePath: z.string().optional(),
  data: z.string().max(MAX_IMPORT_DATA_LENGTH).optional(),
  title: z.string().max(MAX_TEXT_LENGTH).optional(),
  startX: z.number().default(80),
  startY: z.number().default(140),
  maxNodes: z.number().int().positive().max(MAX_ELEMENTS_PER_BATCH).default(80),
  mode: z.enum(["append", "replace", "dry-run"]).default("replace"),
});

export const importOpenApiSchema = importDiagramSourceSchema;
export const importPackageDependenciesSchema = importDiagramSourceSchema;
export const importDatabaseSchemaSchema = importDiagramSourceSchema;
export const importMarkdownOutlineSchema = importDiagramSourceSchema;
export const importPlantUmlSchema = importDiagramSourceSchema;
export const importStructurizrSchema = importDiagramSourceSchema;

export const exportToImageSchema = z.object({
  format: z.enum(["png", "svg"]).default("png"),
  filePath: z.string().optional(),
  background: z.boolean().default(true),
});

export const exportSelectionToImageSchema = exportToImageSchema.extend({
  ids: idListSchema,
});

export const snapshotSceneSchema = z.object({
  name: z.string().min(1),
});

export const restoreSnapshotSchema = z.object({
  name: z.string().min(1),
});

export const setViewportSchema = z.object({
  scrollToContent: z.boolean().optional(),
  scrollToElementId: z.string().optional(),
  zoom: z.number().positive().optional(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
});

export const createFromMermaidSchema = z.object({
  mermaidDiagram: z.string().min(1).max(MAX_MERMAID_LENGTH),
  mode: z.enum(["append", "replace"]).default("append"),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  scale: z.number().min(0.25).max(5).optional(),
});

export const lintSceneSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  includeWarnings: z.boolean().default(true),
});

export const suggestLayoutFixesSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  maxSuggestions: z.number().int().positive().max(100).default(25),
});

export const applyLayoutFixesSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  fixIds: z.array(idSchema).max(100).optional(),
  maxFixes: z.number().int().positive().max(100).default(25),
  dryRun: z.boolean().default(false),
});

export const routeArrowsSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  style: z.enum(["straight", "elbow", "orthogonal"]).default("elbow"),
  avoidObstacles: z.boolean().default(true),
  dryRun: z.boolean().default(false),
});

export const createDiagramPlanSchema = z.object({
  goal: z.string().min(1).max(MAX_PROMPT_LENGTH),
  nodes: z
    .array(
      z.object({
        id: idSchema.optional(),
        label: z.string().min(1).max(MAX_TEXT_LENGTH),
        kind: z.string().max(100).optional(),
        lane: z.string().max(100).optional(),
      }),
    )
    .max(MAX_ELEMENTS_PER_BATCH)
    .optional(),
  edges: z
    .array(
      z.object({
        from: idSchema,
        to: idSchema,
        label: z.string().max(MAX_TEXT_LENGTH).optional(),
      }),
    )
    .max(MAX_ELEMENTS_PER_BATCH)
    .optional(),
  layout: z.enum(["row", "column", "grid", "swimlane"]).default("row"),
  startX: z.number().default(80),
  startY: z.number().default(120),
  nodeWidth: z.number().positive().default(220),
  nodeHeight: z.number().positive().default(96),
  gapX: z.number().positive().default(80),
  gapY: z.number().positive().default(96),
});

export const themeSceneSchema = z.object({
  theme: z.enum(["technical", "presentation", "soft", "mono", "dark"]).default("technical"),
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  apply: z.boolean().default(true),
});

export const compareSnapshotsSchema = z.object({
  left: idSchema,
  right: idSchema,
});

export const duplicateElementsSchema = z.object({
  ids: idListSchema,
  offsetX: z.number().default(32),
  offsetY: z.number().default(32),
  idPrefix: z.string().min(1).max(80).default("copy"),
  includeBoundArrows: z.boolean().default(true),
});

export const groupElementsSchema = z.object({
  ids: idListSchema,
  groupId: idSchema.optional(),
});

export const ungroupElementsSchema = z.object({
  ids: idListSchema,
  groupId: idSchema.optional(),
});

export const createFrameFromElementsSchema = z.object({
  ids: idListSchema,
  frameId: idSchema.optional(),
  name: z.string().min(1).max(MAX_TEXT_LENGTH).default("Frame"),
  padding: z.number().min(0).max(1_000).default(48),
  backgroundColor: z.string().optional(),
  strokeColor: z.string().optional(),
});

export const diagramReviewReportSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
});

export const previewMermaidConversionSchema = z.object({
  mermaidDiagram: z.string().min(1).max(MAX_MERMAID_LENGTH),
  targetWidth: z.number().positive().optional(),
  targetHeight: z.number().positive().optional(),
  scale: z.number().min(0.25).max(5).optional(),
});

export const normalizeMermaidLayoutSchema = z.object({
  mermaidDiagram: z.string().min(1).max(MAX_MERMAID_LENGTH),
  mode: z.enum(["append", "replace"]).default("append"),
  targetWidth: z.number().positive().default(1_000),
  targetHeight: z.number().positive().default(700),
  offsetX: z.number().default(80),
  offsetY: z.number().default(120),
  dryRun: z.boolean().default(false),
});

export const sessionPathSchema = z.object({
  filePath: z.string().optional(),
});

export const autoLayoutSchema = z.object({
  ids: z.array(idSchema).max(MAX_TOOL_IDS).optional(),
  mode: z.enum(["grid", "row", "column", "layered", "dagre"]).default("dagre"),
  startX: z.number().default(80),
  startY: z.number().default(140),
  columns: z.number().int().positive().max(50).optional(),
  gapX: z.number().positive().max(2_000).default(96),
  gapY: z.number().positive().max(2_000).default(96),
  nodeWidth: z.number().positive().max(4_000).default(220),
  nodeHeight: z.number().positive().max(4_000).default(96),
  routeArrows: z.boolean().default(true),
  preserveSize: z.boolean().default(false),
  rankDirection: z.enum(["LR", "TB", "RL", "BT"]).default("LR"),
  dryRun: z.boolean().default(false),
});

export const polishSceneSchema = autoLayoutSchema.extend({
  maxPasses: z.number().int().positive().max(5).default(2),
});

export const createTemplateDiagramSchema = z.object({
  kind: z.enum([
    "c4-container",
    "flowchart",
    "swimlane",
    "sequence",
    "state-machine",
    "erd",
    "data-flow",
    "github-readme-hero",
    "mcp-tool-map",
  ]),
  title: z.string().max(MAX_TEXT_LENGTH).optional(),
  startX: z.number().default(80),
  startY: z.number().default(140),
  theme: z.enum(["technical", "presentation", "soft", "mono"]).default("technical"),
  mode: z.enum(["append", "replace", "dry-run"]).default("append"),
});

export const createVerifiedDiagramSchema = z.object({
  source: verifiedDiagramSourceSchema.default("template"),
  templateKind: z.enum([
    "c4-container",
    "flowchart",
    "swimlane",
    "sequence",
    "state-machine",
    "erd",
    "data-flow",
    "github-readme-hero",
    "mcp-tool-map",
  ]).default("flowchart"),
  repoKind: z.enum(["architecture", "dependency", "test-map", "api-map"]).default("architecture"),
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  filePath: z.string().optional(),
  data: z.string().max(MAX_IMPORT_DATA_LENGTH).optional(),
  exportBasePath: z.string().default("exports/verified-diagram"),
  mode: z.enum(["append", "replace"]).default("replace"),
  theme: z.enum(["technical", "presentation", "soft", "mono", "dark"]).default("presentation"),
  rankDirection: z.enum(["LR", "TB", "RL", "BT"]).default("LR"),
  background: z.boolean().default(true),
});

export const createRepoDiagramSchema = z.object({
  rootPath: z.string().optional(),
  kind: z.enum(["architecture", "dependency", "test-map", "api-map"]).default("architecture"),
  title: z.string().max(MAX_TEXT_LENGTH).optional(),
  maxFiles: z.number().int().positive().max(1_000).default(240),
  includePatterns: z.array(z.string().max(300)).max(25).optional(),
  mode: z.enum(["append", "replace", "dry-run"]).default("append"),
});

export const createGithubReadmeAssetsSchema = createRepoDiagramSchema.extend({
  assetBasePath: z.string().default("docs/assets/repository-architecture"),
  updateReadme: z.boolean().default(false),
});

export const addImageSchema = z.object({
  id: idSchema.optional(),
  filePath: z.string().min(1),
  x: z.number().default(80),
  y: z.number().default(140),
  width: z.number().positive().max(8_000).default(320),
  height: z.number().positive().max(8_000).default(220),
  label: elementLabelSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const setElementOrderSchema = z.object({
  ids: idListSchema,
  position: z.enum(["front", "back", "forward", "backward"]),
});

export const tagElementsSchema = z.object({
  ids: idListSchema,
  metadata: metadataSchema,
  merge: z.boolean().default(true),
});

export const diffScenesSchema = z.object({
  leftSnapshot: z.string().min(1).optional(),
  rightSnapshot: z.string().min(1).optional(),
  leftFilePath: z.string().optional(),
  rightFilePath: z.string().optional(),
});

export const namedSessionSchema = z.object({
  name: z.string().min(1).max(120),
});
