import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "./security.js";
import type { ElementInput } from "./types.js";

export const REPO_DIAGRAM_KINDS = ["architecture", "dependency", "test-map", "api-map"] as const;
export type RepoDiagramKind = (typeof REPO_DIAGRAM_KINDS)[number];

export interface CreateRepoDiagramArgs {
  rootPath?: string;
  kind?: RepoDiagramKind;
  title?: string;
  maxFiles?: number;
  includePatterns?: string[];
}

export interface RepoDiagramResult {
  rootPath: string;
  kind: RepoDiagramKind;
  title: string;
  filesScanned: number;
  elements: ElementInput[];
  summary: string;
  notes: string[];
}

interface RepoFile {
  relativePath: string;
  segments: string[];
  extension: string;
}

const IGNORE_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  ".next",
  ".turbo",
  "build",
  "out",
]);

const PALETTE = {
  blue: "#dbeafe",
  blueStroke: "#1d4ed8",
  green: "#dcfce7",
  greenStroke: "#15803d",
  yellow: "#fef3c7",
  yellowStroke: "#b45309",
  pink: "#fce7f3",
  pinkStroke: "#be185d",
  purple: "#ede9fe",
  purpleStroke: "#6d28d9",
  gray: "#f8fafc",
  grayStroke: "#475569",
};

export async function createRepoDiagram(args: CreateRepoDiagramArgs = {}): Promise<RepoDiagramResult> {
  const rootPath = resolveWorkspacePath(args.rootPath ?? "", ".");
  const maxFiles = args.maxFiles ?? 240;
  const files = await collectFiles(rootPath, maxFiles);
  const filtered = filterFiles(files, args.includePatterns);
  const kind = args.kind ?? "architecture";
  const title = args.title ?? titleForKind(kind);
  const rootLabel = await readPackageName(rootPath) ?? path.basename(rootPath);
  const elements = buildRepoElements(filtered, kind, title, rootLabel);

  return {
    rootPath,
    kind,
    title,
    filesScanned: filtered.length,
    elements,
    summary: `Prepared a ${kind} diagram from ${filtered.length} repository file(s).`,
    notes: [
      "The repo diagram is heuristic; inspect and refine labels after creation.",
      "Generated IDs are stable for the same top-level module names.",
      "Use auto_layout and route_arrows after adding domain-specific details.",
    ],
  };
}

export async function createGithubReadmeDiagram(args: CreateRepoDiagramArgs = {}): Promise<RepoDiagramResult> {
  const result = await createRepoDiagram({ ...args, kind: args.kind ?? "architecture", title: args.title ?? "Repository Architecture" });
  return {
    ...result,
    elements: [
      ...result.elements,
      {
        id: "github-readme-export",
        type: "rectangle",
        x: 1060,
        y: 520,
        width: 240,
        height: 92,
        label: { text: "GitHub README\nPNG / SVG", fontSize: 19 },
        backgroundColor: PALETTE.green,
        strokeColor: PALETTE.greenStroke,
        fillStyle: "solid",
        roundness: { type: 3 },
        metadata: { semanticType: "documentation-output" },
      },
      {
        id: "repo-to-readme",
        type: "arrow",
        startElementId: "repo-root",
        endElementId: "github-readme-export",
        strokeColor: PALETTE.greenStroke,
      },
    ],
    notes: [
      ...result.notes,
      "Export the generated scene to docs/assets and reference the PNG from README.md.",
    ],
  };
}

async function collectFiles(rootPath: string, maxFiles: number): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  const queue = [rootPath];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (IGNORE_NAMES.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
      files.push({
        relativePath,
        segments: relativePath.split("/"),
        extension: path.extname(entry.name).toLowerCase(),
      });
      if (files.length >= maxFiles) {
        break;
      }
    }
  }

  return files;
}

function filterFiles(files: readonly RepoFile[], patterns?: readonly string[]): RepoFile[] {
  if (!patterns || patterns.length === 0) {
    return [...files];
  }
  return files.filter((file) => patterns.some((pattern) => file.relativePath.includes(pattern)));
}

function buildRepoElements(files: readonly RepoFile[], kind: RepoDiagramKind, title: string, rootLabel: string): ElementInput[] {
  const topGroups = groupByTopSegment(files);
  const elements: ElementInput[] = [
    {
      id: "repo-title",
      type: "text",
      x: 80,
      y: 40,
      width: 780,
      height: 40,
      text: title,
      strokeColor: "#111827",
      metadata: { role: "title", diagramKind: kind },
    },
    card("repo-root", 80, 140, 230, 96, rootLabel, PALETTE.blue, PALETTE.blueStroke, "repository"),
  ];

  const modules = topGroups.slice(0, 8);
  modules.forEach((group, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const id = `module-${slugify(group.name)}`;
    const label = `${group.name}\n${group.files.length} file${group.files.length === 1 ? "" : "s"}`;
    elements.push(card(id, 410 + column * 230, 130 + row * 165, 190, 96, label, fillForGroup(group.name), strokeForGroup(group.name), "module"));
    elements.push({
      id: `repo-root-to-${id}`,
      type: "arrow",
      startElementId: "repo-root",
      endElementId: id,
      strokeColor: PALETTE.grayStroke,
    });
  });

  const focusNodes = focusElementsForKind(files, kind);
  focusNodes.forEach((focus, index) => {
    const id = `focus-${slugify(focus.label)}`;
    elements.push(card(id, 410 + (index % 3) * 260, 515 + Math.floor(index / 3) * 150, 220, 88, focus.label, focus.fill, focus.stroke, focus.semanticType));
    const parentId = focus.parent ? `module-${slugify(focus.parent)}` : "repo-root";
    elements.push({
      id: `${parentId}-to-${id}`,
      type: "arrow",
      startElementId: parentId,
      endElementId: id,
      strokeColor: focus.stroke,
      label: focus.edgeLabel ? { text: focus.edgeLabel } : undefined,
    });
  });

  return elements;
}

function focusElementsForKind(files: readonly RepoFile[], kind: RepoDiagramKind): Array<{
  label: string;
  parent?: string;
  edgeLabel?: string;
  fill: string;
  stroke: string;
  semanticType: string;
}> {
  if (kind === "dependency") {
    return dependencyFocus(files);
  }
  if (kind === "test-map") {
    return [
      {
        label: `${countMatching(files, "/tests/") || countMatching(files, "test")} tests`,
        parent: "tests",
        edgeLabel: "verifies",
        fill: PALETTE.purple,
        stroke: PALETTE.purpleStroke,
        semanticType: "test-suite",
      },
      {
        label: `${countExtensions(files, [".ts", ".tsx"])} TypeScript files`,
        parent: "src",
        edgeLabel: "covers",
        fill: PALETTE.green,
        stroke: PALETTE.greenStroke,
        semanticType: "source-code",
      },
    ];
  }
  if (kind === "api-map") {
    return files
      .filter((file) => /tools|server|api|route|controller/i.test(file.relativePath))
      .slice(0, 5)
      .map((file) => ({
        label: file.relativePath,
        parent: file.segments[0],
        edgeLabel: "exposes",
        fill: PALETTE.yellow,
        stroke: PALETTE.yellowStroke,
        semanticType: "api-surface",
      }));
  }

  return [
    {
      label: `${countExtensions(files, [".ts", ".tsx"])} TS modules`,
      parent: "src",
      edgeLabel: "implements",
      fill: PALETTE.green,
      stroke: PALETTE.greenStroke,
      semanticType: "implementation",
    },
    {
      label: `${countExtensions(files, [".md"])} docs`,
      parent: "docs",
      edgeLabel: "explains",
      fill: PALETTE.pink,
      stroke: PALETTE.pinkStroke,
      semanticType: "documentation",
    },
  ];
}

function dependencyFocus(files: readonly RepoFile[]) {
  const packageFile = files.find((file) => file.relativePath === "package.json");
  if (!packageFile) {
    return [];
  }
  return [
    {
      label: "package.json\ndependencies",
      parent: packageFile.segments[0],
      edgeLabel: "declares",
      fill: PALETTE.yellow,
      stroke: PALETTE.yellowStroke,
      semanticType: "dependency-manifest",
    },
  ];
}

async function readPackageName(rootPath: string): Promise<string | null> {
  try {
    const packageJson = JSON.parse(await readFile(path.join(rootPath, "package.json"), "utf8")) as { name?: string };
    return packageJson.name ?? null;
  } catch {
    return null;
  }
}

function groupByTopSegment(files: readonly RepoFile[]): Array<{ name: string; files: RepoFile[] }> {
  const groups = new Map<string, RepoFile[]>();
  for (const file of files) {
    const top = file.segments.length > 1 ? file.segments[0]! : file.relativePath;
    groups.set(top, [...(groups.get(top) ?? []), file]);
  }
  return [...groups.entries()]
    .map(([name, groupFiles]) => ({ name, files: groupFiles }))
    .sort((left, right) => right.files.length - left.files.length || left.name.localeCompare(right.name));
}

function card(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  backgroundColor: string,
  strokeColor: string,
  semanticType: string,
): ElementInput {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    label: { text, fontSize: text.length > 32 || text.includes("\n") ? 17 : 20 },
    backgroundColor,
    strokeColor,
    fillStyle: "solid",
    roundness: { type: 3 },
    metadata: { semanticType },
  };
}

function fillForGroup(name: string): string {
  if (name === "src") {
    return PALETTE.green;
  }
  if (name === "tests") {
    return PALETTE.purple;
  }
  if (name === "docs" || name === "README.md") {
    return PALETTE.pink;
  }
  if (name === "package.json") {
    return PALETTE.yellow;
  }
  return PALETTE.gray;
}

function strokeForGroup(name: string): string {
  if (name === "src") {
    return PALETTE.greenStroke;
  }
  if (name === "tests") {
    return PALETTE.purpleStroke;
  }
  if (name === "docs" || name === "README.md") {
    return PALETTE.pinkStroke;
  }
  if (name === "package.json") {
    return PALETTE.yellowStroke;
  }
  return PALETTE.grayStroke;
}

function countExtensions(files: readonly RepoFile[], extensions: readonly string[]): number {
  const set = new Set(extensions);
  return files.filter((file) => set.has(file.extension)).length;
}

function countMatching(files: readonly RepoFile[], pattern: string): number {
  const normalized = pattern.toLowerCase();
  return files.filter((file) => file.relativePath.toLowerCase().includes(normalized)).length;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "item";
}

function titleForKind(kind: RepoDiagramKind): string {
  if (kind === "test-map") {
    return "Repository Test Map";
  }
  if (kind === "api-map") {
    return "Repository API Map";
  }
  if (kind === "dependency") {
    return "Repository Dependency Map";
  }
  return "Repository Architecture";
}
