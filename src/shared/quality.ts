import { estimateTextDimensions, getElementBounds, getElementBox } from "./normalizer.js";
import type { DiagramElement, ElementInput, ElementType, Point } from "./types.js";

export type LintSeverity = "info" | "warning" | "error";
export type DiagramLayout = "row" | "column" | "grid" | "swimlane";
export type DiagramDirection = "left-to-right" | "top-to-bottom";
export type ThemePreference = "technical" | "presentation" | "soft" | "mono" | "dark" | "light" | "neutral";

export interface SceneLintIssue {
  code:
    | "empty_scene"
    | "text_too_small"
    | "text_bounds_tight"
    | "elements_overlap"
    | "arrow_unbound"
    | "arrow_crosses_element"
    | "crowded_layout";
  severity: LintSeverity;
  message: string;
  elementIds: string[];
  data?: Record<string, unknown>;
}

export interface LintSceneOptions {
  ids?: string[];
  includeWarnings?: boolean;
  minGap?: number;
  minFontSize?: number;
  headingMinFontSize?: number;
}

export interface SceneLintResult {
  score: number;
  summary: string;
  issues: SceneLintIssue[];
}

export interface DiagramReviewReport {
  score: number;
  verdict: "ready" | "needs-small-fixes" | "needs-layout-pass" | "needs-redraw";
  exportReadiness: "ready" | "review-recommended" | "fix-before-export";
  summary: string;
  metrics: {
    elementCount: number;
    shapeCount: number;
    arrowCount: number;
    textCount: number;
    bounds: ReturnType<typeof getElementBounds>;
  };
  issues: SceneLintIssue[];
  recommendations: string[];
}

export type DiagramReviewOptions = LintSceneOptions;

export interface DiagramPlanInputNode {
  id?: string;
  label: string;
  kind?: string;
  lane?: string;
}

export interface DiagramPlanInputEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramPlanRequest {
  goal?: string;
  title?: string;
  nodes?: Array<string | DiagramPlanInputNode>;
  steps?: string[];
  edges?: DiagramPlanInputEdge[];
  layout?: DiagramLayout;
  direction?: DiagramDirection;
  columns?: number;
  startX?: number;
  startY?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
  theme?: ThemePreference;
}

export interface DiagramPlanNode {
  id: string;
  label: string;
  type: Extract<ElementType, "rectangle">;
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  column: number;
  lane?: string;
  kind?: string;
}

export interface DiagramPlanArrow {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface DiagramPlan {
  title?: string;
  goal?: string;
  layout: DiagramLayout;
  direction: DiagramDirection;
  bounds: { x: number; y: number; width: number; height: number };
  nodes: DiagramPlanNode[];
  arrows: DiagramPlanArrow[];
  elements: ElementInput[];
  notes: string[];
}

export type ElementUpdate = Partial<ElementInput> & { id: string };

export interface LayoutFix {
  id: string;
  elementId: string;
  kind: "resize" | "move" | "route-arrow";
  reason: string;
  issueCodes: SceneLintIssue["code"][];
  update: ElementUpdate;
}

export interface LayoutFixPlan {
  summary: string;
  fixes: LayoutFix[];
  arrowRoutes: ArrowRoute[];
  updates: ElementUpdate[];
}

export type LayoutFixSuggestions = LayoutFix[] & LayoutFixPlan;

export interface LayoutFixOptions {
  ids?: string[];
  maxSuggestions?: number;
  minGap?: number;
  route?: ArrowRoutingOptions;
}

export interface ToLayoutFixUpdatesOptions {
  ids?: string[];
  fixIds?: string[];
  maxFixes?: number;
  dryRun?: boolean;
  includeUnknownIds?: boolean;
}

export interface ArrowRoutingOptions {
  ids?: string[];
  style?: "straight" | "elbow" | "orthogonal";
  avoidObstacles?: boolean;
  dryRun?: boolean;
  forceElbow?: boolean;
  margin?: number;
}

export interface ArrowRoute {
  id: string;
  reason: string;
  points: Point[];
  update: ElementUpdate;
}

export interface ArrowRoutingPlan {
  routes: ArrowRoute[];
  updates: ElementUpdate[];
}

export type ArrowRouteUpdates = ElementUpdate[] & ArrowRoutingPlan;

export interface ThemeSceneOptions {
  theme?: ThemePreference;
  preference?: ThemePreference;
  ids?: string[];
  apply?: boolean;
}

export interface ThemePlan {
  name: ThemePreference;
  strokeColor: string;
  textColor: string;
  fills: Record<string, string>;
  updates: ElementUpdate[];
  notes: string[];
}

export type ThemeUpdates = ElementUpdate[] & ThemePlan;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextFit {
  text: string;
  fontSize: number;
  requiredWidth: number;
  requiredHeight: number;
}

const DEFAULT_MIN_GAP = 24;
const DEFAULT_BODY_FONT_SIZE = 16;
const DEFAULT_HEADING_FONT_SIZE = 20;
const DEFAULT_TEXT_FONT_SIZE = 20;
const SHAPE_LABEL_HORIZONTAL_PADDING = 40;
const SHAPE_LABEL_VERTICAL_PADDING = 32;
const PLAN_START_X = 80;
const PLAN_START_Y = 120;
const PLAN_NODE_WIDTH = 220;
const PLAN_NODE_HEIGHT = 96;
const PLAN_GAP_X = 80;
const PLAN_GAP_Y = 96;
const ROUTE_MARGIN = 48;

const LINEAR_TYPES = new Set<ElementType>(["arrow", "line"]);
const SHAPE_TYPES = new Set<ElementType>(["rectangle", "ellipse", "diamond", "frame", "image"]);

export function lintScene(elements: readonly DiagramElement[], options: LintSceneOptions = {}): SceneLintResult {
  const selected = selectByIds(elements, options.ids);
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  const minFontSize = options.minFontSize ?? DEFAULT_BODY_FONT_SIZE;
  const headingMinFontSize = options.headingMinFontSize ?? DEFAULT_HEADING_FONT_SIZE;
  const issues: SceneLintIssue[] = [];

  if (selected.length === 0) {
    issues.push({ code: "empty_scene", severity: "info", message: "Scene is empty.", elementIds: [] });
  }

  for (const element of selected) {
    const textFit = getTextFit(element);
    if (!textFit) {
      continue;
    }

    const requiredFontSize = isLikelyHeading(element, textFit.text) ? headingMinFontSize : minFontSize;
    if (textFit.fontSize < requiredFontSize) {
      issues.push({
        code: "text_too_small",
        severity: "warning",
        message: `Text on ${element.id} is smaller than ${requiredFontSize}px.`,
        elementIds: [element.id],
        data: { fontSize: textFit.fontSize, requiredFontSize },
      });
    }

    if (element.width < textFit.requiredWidth || element.height < textFit.requiredHeight) {
      issues.push({
        code: "text_bounds_tight",
        severity: "warning",
        message: `Text bounds on ${element.id} are too tight for the label.`,
        elementIds: [element.id],
        data: {
          width: element.width,
          height: element.height,
          requiredWidth: textFit.requiredWidth,
          requiredHeight: textFit.requiredHeight,
        },
      });
    }
  }

  for (const [first, second] of elementPairs(layoutElements(selected))) {
    const firstBox = getElementBox(first);
    const secondBox = getElementBox(second);
    const overlap = intersectionArea(firstBox, secondBox);
    if (overlap > 0) {
      issues.push({
        code: "elements_overlap",
        severity: "error",
        message: `${first.id} overlaps ${second.id}.`,
        elementIds: [first.id, second.id],
        data: { overlap },
      });
    } else if (distanceBetweenBoxes(firstBox, secondBox) < minGap) {
      issues.push({
        code: "crowded_layout",
        severity: "info",
        message: `${first.id} is very close to ${second.id}.`,
        elementIds: [first.id, second.id],
        data: { minGap },
      });
    }
  }

  for (const element of selected.filter(isLinearElement)) {
    const boundIds = getBoundIds(element);
    if (element.type === "arrow" && boundIds.length < 2) {
      issues.push({
        code: "arrow_unbound",
        severity: "warning",
        message: `${element.id} should be bound to both source and target elements.`,
        elementIds: [element.id],
        data: { boundIds },
      });
    }

    const crossingIds = arrowCrossingElementIds(element, selected);
    if (crossingIds.length > 0) {
      issues.push({
        code: "arrow_crosses_element",
        severity: "warning",
        message: `${element.id} crosses unrelated element(s): ${crossingIds.join(", ")}.`,
        elementIds: [element.id, ...crossingIds],
        data: { crossingIds },
      });
    }
  }

  const filteredIssues = options.includeWarnings === false
    ? issues.filter((issue) => issue.severity !== "info")
    : issues;
  const score = scoreIssues(filteredIssues);
  return { score, summary: summarizeLint(filteredIssues, score), issues: filteredIssues };
}

export function createDiagramReviewReport(
  elements: readonly DiagramElement[],
  options: DiagramReviewOptions = {},
): DiagramReviewReport {
  const selected = selectByIds(elements, options.ids);
  const lint = lintScene(selected, options);
  const shapeCount = selected.filter((element) => SHAPE_TYPES.has(element.type)).length;
  const arrowCount = selected.filter((element) => element.type === "arrow").length;
  const textCount = selected.filter((element) => getTextFit(element)).length;
  const verdict = verdictForScore(lint.score);

  return {
    score: lint.score,
    verdict,
    exportReadiness: verdict === "ready" ? "ready" : verdict === "needs-small-fixes" ? "review-recommended" : "fix-before-export",
    summary: lint.summary,
    metrics: {
      elementCount: selected.length,
      shapeCount,
      arrowCount,
      textCount,
      bounds: getElementBounds(selected),
    },
    issues: lint.issues,
    recommendations: recommendationsForIssues(lint.issues),
  };
}

export function createDiagramPlan(args: string | DiagramPlanRequest): DiagramPlan {
  const request = typeof args === "string" ? parsePlanText(args) : args;
  const rawNodes = normalizePlanNodes(request);
  const nodes = rawNodes.length > 0 ? rawNodes : [{ id: "start", label: "Start" }, { id: "finish", label: "Finish" }];
  const layout = request.layout ?? directionToLayout(request.direction ?? "left-to-right");
  const direction = request.direction ?? (layout === "column" ? "top-to-bottom" : "left-to-right");
  const nodeWidth = request.nodeWidth ?? PLAN_NODE_WIDTH;
  const nodeHeight = request.nodeHeight ?? PLAN_NODE_HEIGHT;
  const gapX = request.gapX ?? PLAN_GAP_X;
  const gapY = request.gapY ?? PLAN_GAP_Y;
  const startX = request.startX ?? PLAN_START_X;
  const startY = request.startY ?? PLAN_START_Y;
  const columns = request.columns ?? defaultColumns(nodes.length, layout);

  const plannedNodes = nodes.map((node, index): DiagramPlanNode => {
    const laneIndex = layout === "swimlane" ? laneIndexFor(nodes, node.lane) : 0;
    const row = layout === "row" ? 0 : layout === "swimlane" ? laneIndex : Math.floor(index / columns);
    const column = layout === "column" ? 0 : layout === "swimlane" ? index : index % columns;
    return {
      id: node.id ?? uniqueIdForLabel(node.label, nodes, index),
      label: node.label,
      kind: node.kind,
      lane: node.lane,
      type: "rectangle",
      x: startX + column * (nodeWidth + gapX),
      y: startY + row * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
      row,
      column,
    };
  });

  const nodeIds = new Set(plannedNodes.map((node) => node.id));
  const arrows = (request.edges?.length ? request.edges : consecutivePlanEdges(plannedNodes)).flatMap((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return [];
    }
    return [{
      id: `${edge.from}-to-${edge.to}`,
      from: edge.from,
      to: edge.to,
      label: edge.label,
    }];
  });

  const nodeElements: ElementInput[] = plannedNodes.map((node) => ({
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    label: { text: node.label, fontSize: DEFAULT_TEXT_FONT_SIZE },
  }));
  const arrowElements: ElementInput[] = arrows.map((arrow) => ({
    id: arrow.id,
    type: "arrow",
    startElementId: arrow.from,
    endElementId: arrow.to,
    label: arrow.label ? { text: arrow.label } : undefined,
  }));
  const title = request.title ?? request.goal;
  const titleElements: ElementInput[] = title
    ? [{ id: "diagram-title", type: "text", x: startX, y: Math.max(0, startY - 64), text: title, width: 520, height: 36 }]
    : [];
  const elements = [...titleElements, ...nodeElements, ...arrowElements];

  return {
    title,
    goal: request.goal,
    layout,
    direction,
    bounds: boundsForPlan(elements),
    nodes: plannedNodes,
    arrows,
    elements,
    notes: [
      "Create node elements before arrow elements so bindings can resolve.",
      "Call set_viewport and get_canvas_screenshot after drawing, then fix visible overlap, clipping, and arrow routing.",
    ],
  };
}

export function suggestLayoutFixes(elements: readonly DiagramElement[], args: LayoutFixOptions = {}): LayoutFixSuggestions {
  const selected = selectByIds(elements, args.ids);
  const minGap = args.minGap ?? DEFAULT_MIN_GAP;
  const fixes = new Map<string, LayoutFix>();
  const placedBoxes = new Map<string, Box>();

  for (const element of layoutElements(selected).sort(compareByPosition)) {
    const textFit = getTextFit(element);
    const update: ElementUpdate = { id: element.id };
    const issueCodes: SceneLintIssue["code"][] = [];
    const reasons: string[] = [];

    if (textFit && (element.width < textFit.requiredWidth || element.height < textFit.requiredHeight)) {
      update.width = Math.max(element.width, textFit.requiredWidth);
      update.height = Math.max(element.height, textFit.requiredHeight);
      issueCodes.push("text_bounds_tight");
      reasons.push("expand tight text bounds");
    }

    let nextBox = { ...getElementBox(element), width: update.width ?? element.width, height: update.height ?? element.height };
    const blockingBox = firstOverlappingBox(nextBox, placedBoxes);
    if (blockingBox) {
      update.y = Math.max(element.y, blockingBox.y + blockingBox.height + minGap);
      nextBox = { ...nextBox, y: update.y };
      issueCodes.push("elements_overlap");
      reasons.push("move below overlapping element");
    }

    placedBoxes.set(element.id, nextBox);

    if (Object.keys(update).length > 1) {
      fixes.set(element.id, {
        id: element.id,
        elementId: element.id,
        kind: update.width || update.height ? "resize" : "move",
        reason: reasons.join("; "),
        issueCodes,
        update,
      });
    }
  }

  const arrowPlan = routeArrows(selected, args.route ?? { avoidObstacles: true, style: "elbow" });
  for (const route of arrowPlan.routes) {
    fixes.set(route.id, {
      id: route.id,
      elementId: route.id,
      kind: "route-arrow",
      reason: route.reason,
      issueCodes: ["arrow_crosses_element"],
      update: route.update,
    });
  }

  const fixList = [...fixes.values()]
    .sort((first, second) => first.id.localeCompare(second.id))
    .slice(0, args.maxSuggestions ?? Number.POSITIVE_INFINITY);
  const result = fixList as LayoutFixSuggestions;
  result.summary = fixList.length === 0 ? "No automatic layout fixes suggested." : `Suggested ${fixList.length} layout fix(es).`;
  result.fixes = result;
  result.arrowRoutes = arrowPlan.routes;
  result.updates = toLayoutFixUpdates(elements, { fixes: fixList, updates: arrowPlan.updates });
  return result;
}

export function toLayoutFixUpdates(
  elements: readonly DiagramElement[],
  suggestions: readonly LayoutFix[] | { fixes: readonly LayoutFix[]; updates?: readonly ElementUpdate[] },
  args: ToLayoutFixUpdatesOptions = {},
): ElementUpdate[] {
  const knownIds = new Set(elements.map((element) => element.id));
  const fixIds = args.fixIds ? new Set(args.fixIds) : null;
  const suggestionList = isLayoutFixArray(suggestions) ? suggestions : suggestions.fixes;
  const extraUpdates = isLayoutFixArray(suggestions) ? [] : suggestions.updates ?? [];
  const merged = new Map<string, ElementUpdate>();

  for (const fix of suggestionList) {
    if (fixIds && !fixIds.has(fix.id)) {
      continue;
    }
    addUpdate(merged, knownIds, fix.update, args.includeUnknownIds);
    if (merged.size >= (args.maxFixes ?? Number.POSITIVE_INFINITY)) {
      break;
    }
  }

  for (const update of extraUpdates) {
    addUpdate(merged, knownIds, update, args.includeUnknownIds);
  }

  return [...merged.values()].sort((first, second) => first.id.localeCompare(second.id));
}

function isLayoutFixArray(
  suggestions: readonly LayoutFix[] | { fixes: readonly LayoutFix[]; updates?: readonly ElementUpdate[] },
): suggestions is readonly LayoutFix[] {
  return Array.isArray(suggestions);
}

export function routeArrows(elements: readonly DiagramElement[], args: ArrowRoutingOptions = {}): ArrowRouteUpdates {
  const selectedArrowIds = args.ids ? new Set(args.ids) : null;
  const margin = args.margin ?? ROUTE_MARGIN;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const routes: ArrowRoute[] = [];

  for (const arrow of elements.filter(isLinearElement)) {
    if (selectedArrowIds && !selectedArrowIds.has(arrow.id)) {
      continue;
    }

    const startId = arrow.startBinding?.elementId ?? arrow.startElementId;
    const endId = arrow.endBinding?.elementId ?? arrow.endElementId;
    const start = startId ? byId.get(startId) : undefined;
    const end = endId ? byId.get(endId) : undefined;
    if (!start || !end) {
      continue;
    }

    const crossings = arrowCrossingElementIds(arrow, elements);
    const style = args.forceElbow ? "elbow" : args.style ?? "elbow";
    const needsRoute =
      style !== "straight" ||
      args.avoidObstacles === true && crossings.length > 0 ||
      Math.abs(centerOf(start)[1] - centerOf(end)[1]) > 24;

    if (!needsRoute) {
      continue;
    }

    const points = style === "straight"
      ? [anchorPoint(start, end, margin / 6), anchorPoint(end, start, margin / 6)]
      : planElbowRoute(start, end, elements, new Set([arrow.id, start.id, end.id]), margin);
    const update = toLinearUpdate(arrow.id, points);
    routes.push({
      id: arrow.id,
      reason: crossings.length > 0 ? `avoid ${crossings.join(", ")}` : "use readable arrow route",
      points,
      update,
    });
  }

  const sortedRoutes = routes.sort((first, second) => first.id.localeCompare(second.id));
  const updates = sortedRoutes.map((route) => route.update) as ArrowRouteUpdates;
  updates.routes = sortedRoutes;
  updates.updates = updates;
  return updates;
}

export function themeScene(
  elements: readonly DiagramElement[],
  args: ThemePreference | ThemeSceneOptions = {},
): ThemeUpdates {
  const theme = typeof args === "string" ? args : args.theme ?? args.preference ?? "technical";
  const selected = selectByIds(elements, typeof args === "string" ? undefined : args.ids);
  const palette = themePalette(theme);
  const updates: ElementUpdate[] = [];
  let fillIndex = 0;

  for (const element of selected) {
    if (isLinearElement(element)) {
      updates.push({ id: element.id, strokeColor: palette.stroke });
      continue;
    }

    if (element.type === "text") {
      updates.push({ id: element.id, strokeColor: palette.text });
      continue;
    }

    if (element.type === "frame") {
      updates.push({ id: element.id, strokeColor: palette.mutedStroke, backgroundColor: palette.frameFill });
      continue;
    }

    const fill = palette.fills[fillIndex % palette.fills.length]!;
    updates.push({ id: element.id, strokeColor: palette.stroke, backgroundColor: fill, fillStyle: "solid" });
    fillIndex += 1;
  }

  const result = updates as ThemeUpdates;
  result.name = theme;
  result.strokeColor = palette.stroke;
  result.textColor = palette.text;
  result.fills = Object.fromEntries(palette.fills.map((fill, index) => [`accent${index + 1}`, fill]));
  result.updates = result;
  result.notes = [
    "Use fills to group meaning, status, or ownership.",
    "Keep text and arrow strokes high contrast against shape fills.",
  ];
  return result;
}

function selectByIds<T extends { id: string }>(elements: readonly T[], ids?: readonly string[]): T[] {
  if (!ids || ids.length === 0) {
    return [...elements];
  }
  const selectedIds = new Set(ids);
  return elements.filter((element) => selectedIds.has(element.id));
}

function getTextFit(element: DiagramElement): TextFit | null {
  if (isBoundTextElement(element)) {
    return null;
  }
  const text = element.type === "text" ? element.text : element.label?.text;
  if (!text) {
    return null;
  }

  const fontSize = getFontSize(element);
  const estimated = estimateTextDimensions(text, fontSize);
  return {
    text,
    fontSize,
    requiredWidth: estimated.width + (element.type === "text" ? 0 : SHAPE_LABEL_HORIZONTAL_PADDING),
    requiredHeight: estimated.height + (element.type === "text" ? 0 : SHAPE_LABEL_VERTICAL_PADDING),
  };
}

function getFontSize(element: DiagramElement): number {
  const looseElement = element as DiagramElement & { fontSize?: unknown };
  if (typeof looseElement.fontSize === "number") {
    return looseElement.fontSize;
  }
  return element.label?.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
}

function isLikelyHeading(element: DiagramElement, text: string): boolean {
  return element.type === "text" && text.length <= 42 && !/[.!?]$/.test(text);
}

function layoutElements(elements: readonly DiagramElement[]): DiagramElement[] {
  return elements.filter((element) => !isLinearElement(element) && element.type !== "frame" && !isBoundTextElement(element));
}

function isLinearElement(element: DiagramElement): boolean {
  return LINEAR_TYPES.has(element.type);
}

function elementPairs(elements: readonly DiagramElement[]): Array<[DiagramElement, DiagramElement]> {
  const pairs: Array<[DiagramElement, DiagramElement]> = [];
  for (let first = 0; first < elements.length; first += 1) {
    for (let second = first + 1; second < elements.length; second += 1) {
      pairs.push([elements[first]!, elements[second]!]);
    }
  }
  return pairs;
}

function intersectionArea(first: Box, second: Box): number {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  return Math.max(0, width) * Math.max(0, height);
}

function distanceBetweenBoxes(first: Box, second: Box): number {
  const dx = Math.max(second.x - (first.x + first.width), first.x - (second.x + second.width), 0);
  const dy = Math.max(second.y - (first.y + first.height), first.y - (second.y + second.height), 0);
  return Math.hypot(dx, dy);
}

function scoreIssues(issues: readonly SceneLintIssue[]): number {
  const penalty = issues.reduce((total, issue) => {
    if (issue.severity === "error") {
      return total + 25;
    }
    if (issue.severity === "warning") {
      return total + 10;
    }
    return total + 3;
  }, 0);
  return Math.max(0, 100 - penalty);
}

function summarizeLint(issues: readonly SceneLintIssue[], score: number): string {
  if (issues.length === 0) {
    return `No quality issues found. Score ${score}.`;
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const infos = issues.length - errors - warnings;
  return `Found ${issues.length} issue(s): ${errors} error(s), ${warnings} warning(s), ${infos} info. Score ${score}.`;
}

function verdictForScore(score: number): DiagramReviewReport["verdict"] {
  if (score >= 90) {
    return "ready";
  }
  if (score >= 75) {
    return "needs-small-fixes";
  }
  if (score >= 50) {
    return "needs-layout-pass";
  }
  return "needs-redraw";
}

function recommendationsForIssues(issues: readonly SceneLintIssue[]): string[] {
  const recommendations = new Map<SceneLintIssue["code"], string>([
    ["empty_scene", "Create the main objects before requesting screenshot or export."],
    ["text_too_small", "Increase small labels to at least body text size."],
    ["text_bounds_tight", "Expand text-bearing elements so labels have comfortable padding."],
    ["elements_overlap", "Move overlapping elements into a grid with at least 24px spacing."],
    ["arrow_unbound", "Bind arrows to source and target element IDs."],
    ["arrow_crosses_element", "Route arrows with elbow points around unrelated elements."],
    ["crowded_layout", "Increase spacing between nearby elements."],
  ]);
  return uniqueStrings(issues.map((issue) => recommendations.get(issue.code) ?? ""));
}

function parsePlanText(text: string): DiagramPlanRequest {
  const normalized = text.trim();
  if (normalized.includes("->")) {
    const labels = uniqueStrings(normalized.split("->").map(cleanupLabel));
    const nodes = labels.map((label) => ({ id: slugify(label), label }));
    return { goal: normalized, nodes, edges: consecutiveNodeEdges(nodes), layout: "row" };
  }
  return { goal: normalized, nodes: uniqueStrings(normalized.split(/\r?\n|,|;/).map(cleanupLabel)), layout: "row" };
}

function normalizePlanNodes(request: DiagramPlanRequest): DiagramPlanInputNode[] {
  const values = request.nodes?.length ? request.nodes : request.steps;
  if (!values || values.length === 0) {
    return [];
  }

  const normalized = values.map((node) => {
    if (typeof node === "string") {
      return { id: slugify(node), label: node };
    }
    return { ...node, id: node.id ?? slugify(node.label) };
  });
  return dedupeNodes(normalized);
}

function dedupeNodes(nodes: readonly DiagramPlanInputNode[]): DiagramPlanInputNode[] {
  const seen = new Map<string, number>();
  return nodes.map((node, index) => {
    const base = node.id ?? slugify(node.label);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...node, id: count === 0 ? base : `${base}-${count + 1}` };
  }).filter((node) => node.label.trim() || node.id || indexIsFinite(node));
}

function indexIsFinite(_node: DiagramPlanInputNode): boolean {
  return true;
}

function directionToLayout(direction: DiagramDirection): DiagramLayout {
  return direction === "top-to-bottom" ? "column" : "row";
}

function defaultColumns(count: number, layout: DiagramLayout): number {
  if (layout === "column" || layout === "swimlane") {
    return 1;
  }
  if (layout === "grid") {
    return Math.ceil(Math.sqrt(Math.max(count, 1)));
  }
  return Math.max(count, 1);
}

function laneIndexFor(nodes: readonly DiagramPlanInputNode[], lane: string | undefined): number {
  if (!lane) {
    return 0;
  }
  return uniqueStrings(nodes.map((node) => node.lane ?? "")).indexOf(lane);
}

function uniqueIdForLabel(label: string, nodes: readonly DiagramPlanInputNode[], index: number): string {
  const base = slugify(label);
  const previous = nodes.slice(0, index).filter((node) => slugify(node.label) === base).length;
  return previous === 0 ? base : `${base}-${previous + 1}`;
}

function consecutivePlanEdges(nodes: readonly DiagramPlanNode[]): DiagramPlanInputEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1]!.id }));
}

function consecutiveNodeEdges(nodes: readonly DiagramPlanInputNode[]): DiagramPlanInputEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({ from: node.id ?? slugify(node.label), to: nodes[index + 1]!.id ?? slugify(nodes[index + 1]!.label) }));
}

function cleanupLabel(value: string): string {
  return value.replace(/^[-*\d.)\s]+/, "").trim();
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "node";
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

function boundsForPlan(elements: readonly ElementInput[]): { x: number; y: number; width: number; height: number } {
  const boxes = elements.filter((element) => !LINEAR_TYPES.has(element.type)).map((element) => ({
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? PLAN_NODE_WIDTH,
    height: element.height ?? PLAN_NODE_HEIGHT,
  }));
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function compareByPosition(first: DiagramElement, second: DiagramElement): number {
  return first.y - second.y || first.x - second.x || first.id.localeCompare(second.id);
}

function firstOverlappingBox(box: Box, boxes: ReadonlyMap<string, Box>): Box | null {
  for (const existing of [...boxes.values()].sort(compareBoxes)) {
    if (intersectionArea(box, existing) > 0) {
      return existing;
    }
  }
  return null;
}

function compareBoxes(first: Box, second: Box): number {
  return first.y - second.y || first.x - second.x || first.width - second.width || first.height - second.height;
}

function addUpdate(
  merged: Map<string, ElementUpdate>,
  knownIds: ReadonlySet<string>,
  update: ElementUpdate,
  includeUnknownIds = false,
): void {
  if (!includeUnknownIds && !knownIds.has(update.id)) {
    return;
  }
  merged.set(update.id, { ...merged.get(update.id), ...update });
}

function getBoundIds(element: DiagramElement): string[] {
  return uniqueStrings([
    element.startBinding?.elementId ?? element.startElementId ?? "",
    element.endBinding?.elementId ?? element.endElementId ?? "",
  ]);
}

function arrowCrossingElementIds(arrow: DiagramElement, elements: readonly DiagramElement[]): string[] {
  const path = getAbsolutePath(arrow);
  if (path.length < 2) {
    return [];
  }
  const ignored = new Set([arrow.id, ...getBoundIds(arrow)]);
  return elements
    .filter((element) => !ignored.has(element.id) && !isLinearElement(element) && element.type !== "frame" && !isBoundTextElement(element))
    .filter((element) => pathIntersectsBox(path, insetBox(getElementBox(element), 2)))
    .map((element) => element.id)
    .sort();
}

function isBoundTextElement(element: DiagramElement): boolean {
  const loose = element as DiagramElement & { containerId?: unknown };
  return element.type === "text" && typeof loose.containerId === "string" && loose.containerId.length > 0;
}

function getAbsolutePath(element: DiagramElement): Point[] {
  if (!element.points || element.points.length < 2) {
    return [];
  }
  return element.points.map(([x, y]) => [element.x + x, element.y + y]);
}

function pathIntersectsBox(path: readonly Point[], box: Box): boolean {
  for (let index = 0; index < path.length - 1; index += 1) {
    if (segmentIntersectsBox(path[index]!, path[index + 1]!, box)) {
      return true;
    }
  }
  return false;
}

function segmentIntersectsBox(start: Point, end: Point, box: Box): boolean {
  if (!segmentBoundsOverlapBox(start, end, box)) {
    return false;
  }
  if (pointInBox(start, box) || pointInBox(end, box)) {
    return true;
  }
  const topLeft: Point = [box.x, box.y];
  const topRight: Point = [box.x + box.width, box.y];
  const bottomRight: Point = [box.x + box.width, box.y + box.height];
  const bottomLeft: Point = [box.x, box.y + box.height];
  return (
    segmentsIntersect(start, end, topLeft, topRight) ||
    segmentsIntersect(start, end, topRight, bottomRight) ||
    segmentsIntersect(start, end, bottomRight, bottomLeft) ||
    segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function segmentBoundsOverlapBox(start: Point, end: Point, box: Box): boolean {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);
  return maxX >= box.x && minX <= box.x + box.width && maxY >= box.y && minY <= box.y + box.height;
}

function pointInBox(point: Point, box: Box): boolean {
  return point[0] > box.x && point[0] < box.x + box.width && point[1] > box.y && point[1] < box.y + box.height;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = direction(c, d, a);
  const d2 = direction(c, d, b);
  const d3 = direction(a, b, c);
  const d4 = direction(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function direction(a: Point, b: Point, c: Point): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
}

function insetBox(box: Box, inset: number): Box {
  return {
    x: box.x + inset,
    y: box.y + inset,
    width: Math.max(1, box.width - inset * 2),
    height: Math.max(1, box.height - inset * 2),
  };
}

function planElbowRoute(
  start: DiagramElement,
  end: DiagramElement,
  elements: readonly DiagramElement[],
  ignoredIds: ReadonlySet<string>,
  margin: number,
): Point[] {
  const startPoint = anchorPoint(start, end, margin / 6);
  const endPoint = anchorPoint(end, start, margin / 6);
  const horizontal = Math.abs(endPoint[0] - startPoint[0]) >= Math.abs(endPoint[1] - startPoint[1]);
  const obstacles = elements.filter((element) => !ignoredIds.has(element.id) && !isLinearElement(element) && element.type !== "frame");

  if (horizontal) {
    const midX = chooseFreeMidX((startPoint[0] + endPoint[0]) / 2, startPoint, endPoint, obstacles, margin);
    return dedupePoints([startPoint, [midX, startPoint[1]], [midX, endPoint[1]], endPoint]);
  }

  const midY = chooseFreeMidY((startPoint[1] + endPoint[1]) / 2, startPoint, endPoint, obstacles, margin);
  return dedupePoints([startPoint, [startPoint[0], midY], [endPoint[0], midY], endPoint]);
}

function anchorPoint(element: DiagramElement, toward: DiagramElement, gap: number): Point {
  const box = getElementBox(element);
  const center = centerOf(element);
  const target = centerOf(toward);
  const dx = target[0] - center[0];
  const dy = target[1] - center[1];
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? [box.x + box.width + gap, center[1]] : [box.x - gap, center[1]];
  }
  return dy >= 0 ? [center[0], box.y + box.height + gap] : [center[0], box.y - gap];
}

function chooseFreeMidX(initial: number, start: Point, end: Point, obstacles: readonly DiagramElement[], margin: number): number {
  let midX = initial;
  const yMin = Math.min(start[1], end[1]);
  const yMax = Math.max(start[1], end[1]);
  const forward = end[0] >= start[0];
  for (const obstacle of obstacles) {
    const box = getElementBox(obstacle);
    if (box.y - margin <= yMax && box.y + box.height + margin >= yMin && midX >= box.x - margin && midX <= box.x + box.width + margin) {
      midX = forward ? box.x + box.width + margin : box.x - margin;
    }
  }
  return Math.round(midX);
}

function chooseFreeMidY(initial: number, start: Point, end: Point, obstacles: readonly DiagramElement[], margin: number): number {
  let midY = initial;
  const xMin = Math.min(start[0], end[0]);
  const xMax = Math.max(start[0], end[0]);
  const forward = end[1] >= start[1];
  for (const obstacle of obstacles) {
    const box = getElementBox(obstacle);
    if (box.x - margin <= xMax && box.x + box.width + margin >= xMin && midY >= box.y - margin && midY <= box.y + box.height + margin) {
      midY = forward ? box.y + box.height + margin : box.y - margin;
    }
  }
  return Math.round(midY);
}

function centerOf(element: DiagramElement): Point {
  const box = getElementBox(element);
  return [box.x + box.width / 2, box.y + box.height / 2];
}

function toLinearUpdate(id: string, absolutePoints: readonly Point[]): ElementUpdate {
  const origin = absolutePoints[0]!;
  const relative = absolutePoints.map(([x, y]) => [Math.round(x - origin[0]), Math.round(y - origin[1])] as Point);
  return {
    id,
    x: Math.round(origin[0]),
    y: Math.round(origin[1]),
    points: relative,
    width: Math.max(1, Math.max(...relative.map(([x]) => x)) - Math.min(...relative.map(([x]) => x))),
    height: Math.max(1, Math.max(...relative.map(([, y]) => y)) - Math.min(...relative.map(([, y]) => y))),
  };
}

function dedupePoints(points: readonly Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      result.push([Math.round(point[0]), Math.round(point[1])]);
    }
  }
  return result;
}

function themePalette(theme: ThemePreference): {
  stroke: string;
  mutedStroke: string;
  text: string;
  frameFill: string;
  fills: string[];
} {
  if (theme === "dark") {
    return { stroke: "#f8fafc", mutedStroke: "#94a3b8", text: "#f8fafc", frameFill: "#18212b", fills: ["#1f3a5f", "#214c3a", "#5a3a24", "#4d345f"] };
  }
  if (theme === "mono") {
    return { stroke: "#262626", mutedStroke: "#737373", text: "#171717", frameFill: "#f5f5f5", fills: ["#f5f5f5", "#e5e5e5", "#fafafa"] };
  }
  if (theme === "soft" || theme === "light") {
    return { stroke: "#1e1e1e", mutedStroke: "#94a3b8", text: "#1f2937", frameFill: "#f8fafc", fills: ["#e8f4ff", "#eefcf3", "#fff4df", "#f4edff", "#ffeaf0"] };
  }
  if (theme === "presentation") {
    return { stroke: "#1f2937", mutedStroke: "#64748b", text: "#111827", frameFill: "#f8fafc", fills: ["#dbeafe", "#dcfce7", "#fef3c7", "#fce7f3", "#e0e7ff"] };
  }
  return { stroke: "#22304a", mutedStroke: "#64748b", text: "#111827", frameFill: "#f8fafc", fills: ["#e0f2fe", "#dcfce7", "#fef9c3", "#ede9fe"] };
}
