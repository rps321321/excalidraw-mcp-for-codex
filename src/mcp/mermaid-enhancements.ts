import type { ElementInput, Point } from "../shared/types.js";
import { convertMermaidToElementInputs } from "./mermaid.js";

export interface MermaidBoundsEstimate {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MermaidLayoutOptions {
  targetWidth?: number;
  targetHeight?: number;
  offsetX?: number;
  offsetY?: number;
  padding?: number;
  scale?: number;
  minScale?: number;
  maxScale?: number;
}

export interface MermaidPreviewArgs extends MermaidLayoutOptions {
  mermaidDiagram: string;
  largeDiagramElementThreshold?: number;
}

export interface MermaidPreviewResult {
  warnings: string[];
  bounds: MermaidBoundsEstimate | null;
  elementCount: number;
  suggestedScale: number;
}

export interface MermaidNormalizeArgs extends MermaidLayoutOptions {
  mermaidDiagram: string;
  largeDiagramElementThreshold?: number;
}

export interface MermaidNormalizeResult {
  elements: ElementInput[];
  files: Record<string, unknown>;
  bounds: MermaidBoundsEstimate | null;
  warnings: string[];
  scale: number;
}

const DEFAULT_MIN_SCALE = 0.2;
const DEFAULT_MAX_SCALE = 3;
const DEFAULT_LARGE_DIAGRAM_ELEMENT_THRESHOLD = 80;
const LOW_RISK_DIAGRAM_TYPES = new Set(["flowchart", "graph"]);
const KNOWN_MERMAID_DIAGRAM_TYPES = new Set([
  "architecture-beta",
  "block-beta",
  "c4component",
  "c4container",
  "c4context",
  "c4deployment",
  "classdiagram",
  "classdiagram-v2",
  "erdiagram",
  "flowchart",
  "gantt",
  "gitgraph",
  "graph",
  "journey",
  "mindmap",
  "packet-beta",
  "pie",
  "quadrantchart",
  "requirementdiagram",
  "sankey-beta",
  "sequencediagram",
  "statediagram",
  "statediagram-v2",
  "timeline",
  "xychart-beta",
]);

export async function previewMermaidConversion(
  args: MermaidPreviewArgs,
): Promise<MermaidPreviewResult> {
  const conversion = await convertForPreview(args.mermaidDiagram);
  const elements = conversion.elements;
  const bounds = estimateElementInputBounds(elements);
  const suggestedScale = calculateSuggestedScale(bounds, args);

  return {
    warnings: [
      ...conversion.warnings,
      ...collectWarnings(args.mermaidDiagram, elements, bounds, suggestedScale, args),
    ],
    bounds,
    elementCount: elements.length,
    suggestedScale,
  };
}

export async function normalizeMermaidLayout(
  args: MermaidNormalizeArgs,
): Promise<MermaidNormalizeResult> {
  const conversion = await convertAtNeutralScale(args.mermaidDiagram);
  const bounds = estimateElementInputBounds(conversion.elements);
  if (!bounds) {
    return {
      elements: [],
      files: conversion.files,
      bounds: null,
      warnings: collectWarnings(args.mermaidDiagram, [], null, 1, args),
      scale: 1,
    };
  }

  const scale = clampScale(args.scale ?? calculateSuggestedScale(bounds, args), args);
  const padding = normalizePadding(args.padding);
  const targetX = (args.offsetX ?? 0) + padding;
  const targetY = (args.offsetY ?? 0) + padding;
  const elements = conversion.elements.map((element) => transformElement(element, bounds, scale, targetX, targetY));
  const normalizedBounds = estimateElementInputBounds(elements);

  return {
    elements,
    files: conversion.files,
    bounds: normalizedBounds,
    warnings: collectWarnings(args.mermaidDiagram, elements, normalizedBounds, scale, args),
    scale,
  };
}

function estimateElementInputBounds(elements: readonly ElementInput[]): MermaidBoundsEstimate | null {
  if (elements.length === 0) {
    return null;
  }

  const boxes = elements.map(estimateElementBox);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: roundCoordinate(minX),
    y: roundCoordinate(minY),
    width: roundCoordinate(Math.max(1, maxX - minX)),
    height: roundCoordinate(Math.max(1, maxY - minY)),
  };
}

async function convertAtNeutralScale(
  mermaidDiagram: string,
): Promise<{ elements: ElementInput[]; files: Record<string, unknown> }> {
  return convertMermaidToElementInputs(mermaidDiagram, {
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
}

async function convertForPreview(
  mermaidDiagram: string,
): Promise<{ elements: ElementInput[]; warnings: string[] }> {
  try {
    const conversion = await convertAtNeutralScale(mermaidDiagram);
    return { elements: conversion.elements, warnings: [] };
  } catch (error) {
    return {
      elements: [],
      warnings: [`Mermaid conversion preview failed: ${errorMessage(error)}`],
    };
  }
}

function calculateSuggestedScale(
  bounds: MermaidBoundsEstimate | null,
  options: MermaidLayoutOptions,
): number {
  if (!bounds) {
    return 1;
  }

  const padding = normalizePadding(options.padding);
  const usableWidth = usableDimension(options.targetWidth, padding);
  const usableHeight = usableDimension(options.targetHeight, padding);
  const widthScale = usableWidth === null ? Number.POSITIVE_INFINITY : usableWidth / bounds.width;
  const heightScale = usableHeight === null ? Number.POSITIVE_INFINITY : usableHeight / bounds.height;
  const fitScale = Math.min(widthScale, heightScale);

  if (!Number.isFinite(fitScale)) {
    return clampScale(options.scale ?? 1, options);
  }

  return clampScale(fitScale, options);
}

function detectUnsupportedWarnings(mermaidDiagram: string): string[] {
  const diagramType = readDiagramType(mermaidDiagram);
  if (!diagramType) {
    return ["Could not detect a Mermaid diagram type; conversion may fail before layout normalization."];
  }

  if (!KNOWN_MERMAID_DIAGRAM_TYPES.has(diagramType)) {
    return [`Mermaid diagram type "${diagramType}" is not recognized by the preview heuristics.`];
  }

  return [];
}

function collectWarnings(
  mermaidDiagram: string,
  elements: readonly ElementInput[],
  bounds: MermaidBoundsEstimate | null,
  scale: number,
  options: MermaidPreviewArgs | MermaidNormalizeArgs,
): string[] {
  return [
    ...detectUnsupportedWarnings(mermaidDiagram),
    ...detectRiskWarnings(mermaidDiagram, elements, bounds, scale, options),
  ];
}

function detectRiskWarnings(
  mermaidDiagram: string,
  elements: readonly ElementInput[],
  bounds: MermaidBoundsEstimate | null,
  suggestedScale: number,
  options: MermaidPreviewArgs | MermaidNormalizeArgs,
): string[] {
  const warnings: string[] = [];
  const diagramType = readDiagramType(mermaidDiagram);
  const lineCount = mermaidDiagram.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  const longLabel = longestInlineLabel(mermaidDiagram);
  const arrowLikeCount = countMatches(mermaidDiagram, /-->|---|-.->|==>/g);
  const elementThreshold = options.largeDiagramElementThreshold ?? DEFAULT_LARGE_DIAGRAM_ELEMENT_THRESHOLD;

  if (diagramType && !LOW_RISK_DIAGRAM_TYPES.has(diagramType)) {
    warnings.push(
      `Diagram type "${diagramType}" may convert with reduced editability; inspect labels and connectors after import.`,
    );
  }
  if (elements.length > elementThreshold) {
    warnings.push(`Converted scene has ${elements.length} elements; consider splitting it before detailed editing.`);
  }
  if (lineCount > 80) {
    warnings.push(`Mermaid source has ${lineCount} non-empty lines; screenshot verification is recommended.`);
  }
  if (longLabel.length > 48) {
    warnings.push(`Long label detected (${longLabel.length} characters); text may need wider boxes after conversion.`);
  }
  if (arrowLikeCount > 60) {
    warnings.push(`Diagram has about ${arrowLikeCount} connector declarations; arrow routing may need cleanup.`);
  }
  if (/\bsubgraph\b/i.test(mermaidDiagram)) {
    warnings.push("Subgraphs may convert as loose grouped regions; inspect spacing and containment.");
  }
  if (/<\/?[a-z][\s\S]*?>/i.test(mermaidDiagram)) {
    warnings.push("HTML-like label content may not preserve exact formatting in Excalidraw.");
  }
  if (/\bclick\s+\w+/i.test(mermaidDiagram)) {
    warnings.push("Mermaid click/link directives are not represented as editable Excalidraw interactions.");
  }
  if (bounds && (bounds.width > 2400 || bounds.height > 1600)) {
    warnings.push(`Large bounds estimate ${bounds.width}x${bounds.height}; normalize with a target size before import.`);
  }
  if (suggestedScale < 0.45) {
    warnings.push(`Suggested scale ${suggestedScale} is small; labels may become hard to read.`);
  }

  return warnings;
}

function transformElement(
  element: ElementInput,
  sourceBounds: MermaidBoundsEstimate,
  scale: number,
  targetX: number,
  targetY: number,
): ElementInput {
  return pruneUndefined({
    ...element,
    x: transformCoordinate(element.x ?? 0, sourceBounds.x, scale, targetX),
    y: transformCoordinate(element.y ?? 0, sourceBounds.y, scale, targetY),
    width: scaleOptionalPositive(element.width, scale),
    height: scaleOptionalPositive(element.height, scale),
    points: scalePoints(element.points, scale),
    label: element.label
      ? pruneUndefined({
          ...element.label,
          fontSize: scaleOptionalPositive(element.label.fontSize, scale),
        })
      : undefined,
    strokeWidth: scaleOptionalPositive(element.strokeWidth, Math.sqrt(scale)),
  });
}

function estimateElementBox(element: ElementInput): MermaidBoundsEstimate {
  const x = element.x ?? 0;
  const y = element.y ?? 0;

  if ((element.type === "arrow" || element.type === "line") && element.points && element.points.length > 0) {
    const absolutePoints = element.points.map(([pointX, pointY]) => [x + pointX, y + pointY] as Point);
    const minX = Math.min(...absolutePoints.map(([pointX]) => pointX));
    const minY = Math.min(...absolutePoints.map(([, pointY]) => pointY));
    const maxX = Math.max(...absolutePoints.map(([pointX]) => pointX));
    const maxY = Math.max(...absolutePoints.map(([, pointY]) => pointY));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  return {
    x,
    y,
    width: element.width ?? defaultWidth(element),
    height: element.height ?? defaultHeight(element),
  };
}

function readDiagramType(mermaidDiagram: string): string | null {
  const firstContentLine = mermaidDiagram
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));

  if (!firstContentLine) {
    return null;
  }

  const firstToken = firstContentLine.split(/\s+/)[0];
  return firstToken ? firstToken.toLowerCase() : null;
}

function longestInlineLabel(mermaidDiagram: string): string {
  const labelMatches = mermaidDiagram.match(/\[[^\]]+\]|\([^)]+\)|\{[^}]+\}/g) ?? [];
  return labelMatches
    .map((label) => label.replace(/^[[({]+|[\])}]+$/g, "").trim())
    .reduce((longest, label) => (label.length > longest.length ? label : longest), "");
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function usableDimension(value: number | undefined, padding: number): number | null {
  if (value === undefined) {
    return null;
  }

  return Math.max(1, value - padding * 2);
}

function normalizePadding(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function clampScale(value: number, options: MermaidLayoutOptions): number {
  const minScale = options.minScale ?? DEFAULT_MIN_SCALE;
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const finiteValue = Number.isFinite(value) && value > 0 ? value : 1;
  return roundCoordinate(Math.min(Math.max(finiteValue, minScale), maxScale));
}

function transformCoordinate(value: number, sourceOrigin: number, scale: number, targetOrigin: number): number {
  return roundCoordinate((value - sourceOrigin) * scale + targetOrigin);
}

function scaleOptionalPositive(value: number | undefined, scale: number): number | undefined {
  return value === undefined ? undefined : roundCoordinate(Math.max(1, value * scale));
}

function scalePoints(points: Point[] | undefined, scale: number): Point[] | undefined {
  return points?.map(([x, y]) => [roundCoordinate(x * scale), roundCoordinate(y * scale)] as Point);
}

function defaultWidth(element: ElementInput): number {
  if (element.type === "text") {
    return Math.max(40, (element.text ?? element.label?.text ?? "").length * 12);
  }

  return element.type === "arrow" || element.type === "line" ? 160 : 180;
}

function defaultHeight(element: ElementInput): number {
  if (element.type === "text") {
    return 32;
  }

  return element.type === "arrow" || element.type === "line" ? 1 : 90;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
