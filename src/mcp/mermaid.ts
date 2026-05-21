import type { ElementInput, ElementLabel, ElementType, Point } from "../shared/types.js";

export interface MermaidConversionOptions {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
}

export interface MermaidConversionResult {
  elements: ElementInput[];
  files: Record<string, unknown>;
}

type SkeletonElement = Record<string, unknown>;

const SUPPORTED_TYPES = new Set<ElementType>([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
  "frame",
]);

const DEFAULT_OFFSET_X = 48;
const DEFAULT_OFFSET_Y = 96;
const DEFAULT_SCALE = 1.75;

let mermaidDomReady = false;

export async function convertMermaidToElementInputs(
  definition: string,
  options: MermaidConversionOptions = {},
): Promise<MermaidConversionResult> {
  await ensureMermaidDomEnvironment();

  const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
  const result = await parseMermaidWithFallback(parseMermaidToExcalidraw, definition);
  const offsetX = options.offsetX ?? DEFAULT_OFFSET_X;
  const offsetY = options.offsetY ?? DEFAULT_OFFSET_Y;
  const scale = options.scale ?? DEFAULT_SCALE;
  const origin = getSkeletonOrigin(result.elements);
  const elements = result.elements.map((element) => skeletonToElementInput(element, offsetX, offsetY, scale, origin));

  return {
    elements,
    files: (result.files ?? {}) as Record<string, unknown>,
  };
}

async function parseMermaidWithFallback(
  parseMermaidToExcalidraw: (
    definition: string,
    config?: Record<string, unknown>,
  ) => Promise<{ elements: SkeletonElement[]; files?: unknown }>,
  definition: string,
): Promise<{ elements: SkeletonElement[]; files?: unknown }> {
  const config = {
    startOnLoad: false,
    maxEdges: 2_000,
    maxTextSize: Math.max(1_000, definition.length + 100),
    flowchart: { curve: "linear" },
    themeVariables: { fontSize: "20px" },
  };

  try {
    return await parseMermaidToExcalidraw(definition, config);
  } catch (error) {
    if (!definition.includes('"')) {
      throw mermaidError(error);
    }
  }

  try {
    return await parseMermaidToExcalidraw(definition.replace(/"/g, "'"), config);
  } catch (error) {
    throw mermaidError(error);
  }
}

async function ensureMermaidDomEnvironment(): Promise<void> {
  if (mermaidDomReady) {
    return;
  }

  if (typeof document === "undefined" || typeof window === "undefined") {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });

    defineGlobal("window", dom.window);
    defineGlobal("document", dom.window.document);
    defineGlobal("navigator", dom.window.navigator);

    for (const key of [
      "Element",
      "HTMLElement",
      "SVGElement",
      "SVGGraphicsElement",
      "DOMParser",
      "XMLSerializer",
      "Node",
    ]) {
      const value = (dom.window as unknown as Record<string, unknown>)[key];
      if (value) {
        defineGlobal(key, value);
      }
    }

    defineGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));

    if (!dom.window.requestAnimationFrame) {
      dom.window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
        setTimeout(() => callback(Date.now()), 16) as unknown as number);
    }
    if (!dom.window.cancelAnimationFrame) {
      dom.window.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof window.cancelAnimationFrame;
    }

    defineGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
    defineGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  }

  installCssStyleSheetPolyfill();
  installSvgMeasurementFallback();
  mermaidDomReady = true;
}

function installCssStyleSheetPolyfill(): void {
  const existing = (globalThis as unknown as { CSSStyleSheet?: unknown }).CSSStyleSheet;
  if (
    typeof existing === "function" &&
    "insertRule" in (existing as { prototype: Record<string, unknown> }).prototype
  ) {
    return;
  }

  class CSSStyleSheetPolyfill {
    cssRules: Array<{ cssText: string }> = [];

    replaceSync(text: string): void {
      this.cssRules = text ? [{ cssText: text }] : [];
    }

    insertRule(rule: string, index = this.cssRules.length): number {
      this.cssRules.splice(index, 0, { cssText: rule });
      return index;
    }
  }

  defineGlobal("CSSStyleSheet", CSSStyleSheetPolyfill);
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "CSSStyleSheet", {
      value: CSSStyleSheetPolyfill,
      configurable: true,
      writable: true,
    });
  }
}

function installSvgMeasurementFallback(): void {
  const svgElement = (globalThis as unknown as { SVGElement?: typeof SVGElement }).SVGElement;
  if (!svgElement || "getBBox" in svgElement.prototype) {
    return;
  }

  Object.defineProperty(svgElement.prototype, "getBBox", {
    configurable: true,
    value(this: SVGElement) {
      const text = this.textContent?.trim() ?? "";
      const width = readSvgAttribute(this, "width", text ? Math.max(40, text.length * 10) : 100);
      const height = readSvgAttribute(this, "height", text ? 28 : 40);
      return {
        x: readSvgAttribute(this, "x", 0),
        y: readSvgAttribute(this, "y", 0),
        width,
        height,
      };
    },
  });
}

function skeletonToElementInput(
  element: SkeletonElement,
  offsetX: number,
  offsetY: number,
  scale: number,
  origin: Point,
): ElementInput {
  const type = readString(element.type);
  if (!type || !SUPPORTED_TYPES.has(type as ElementType)) {
    throw new Error(`Mermaid produced unsupported Excalidraw element type: ${type || "unknown"}`);
  }

  const startElementId = readEndpointId(element.start);
  const endElementId = readEndpointId(element.end);
  const points = readPoints(element.points, scale);

  return pruneUndefined({
    type: type as ElementType,
    id: readString(element.id),
    x: scaleCoordinate(readNumber(element.x, 0), origin[0], scale, offsetX),
    y: scaleCoordinate(readNumber(element.y, 0), origin[1], scale, offsetY),
    width: scalePositiveNumber(element.width, scale),
    height: scalePositiveNumber(element.height, scale),
    text: type === "text" ? readString(element.text) ?? "" : undefined,
    label: readLabel(element.label),
    points: startElementId && endElementId && isStraightLine(points) ? undefined : points,
    startElementId,
    endElementId,
    startBinding: endpointToBinding(element.start),
    endBinding: endpointToBinding(element.end),
    startArrowhead: readNullableString(element.startArrowhead),
    endArrowhead: readNullableString(element.endArrowhead),
    backgroundColor: readString(element.backgroundColor),
    strokeColor: readString(element.strokeColor),
    fillStyle: readString(element.fillStyle),
    strokeWidth: scalePositiveNumber(element.strokeWidth, Math.sqrt(scale)),
    strokeStyle: readString(element.strokeStyle),
    roughness: readNumberOrUndefined(element.roughness),
    opacity: readNumberOrUndefined(element.opacity),
    roundness: readRoundness(element.roundness),
    groupIds: readStringArray(element.groupIds),
    locked: typeof element.locked === "boolean" ? element.locked : undefined,
    name: readString(element.name),
  }) as ElementInput;
}

function endpointToBinding(value: unknown): ElementInput["startBinding"] {
  const elementId = readEndpointId(value);
  return elementId ? { elementId } : undefined;
}

function readEndpointId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return readString((value as { id?: unknown }).id);
}

function readLabel(value: unknown): ElementLabel | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const text = readString(record.text);
  if (!text?.trim()) {
    return undefined;
  }

  return pruneUndefined({
    text,
    fontSize: readPositiveNumber(record.fontSize),
  });
}

function getSkeletonOrigin(elements: SkeletonElement[]): Point {
  const xs = elements.map((element) => readNumberOrUndefined(element.x)).filter((value): value is number => value !== undefined);
  const ys = elements.map((element) => readNumberOrUndefined(element.y)).filter((value): value is number => value !== undefined);

  return [xs.length > 0 ? Math.min(...xs) : 0, ys.length > 0 ? Math.min(...ys) : 0];
}

function scaleCoordinate(value: number, origin: number, scale: number, offset: number): number {
  return Math.round((origin + (value - origin) * scale + offset) * 100) / 100;
}

function scalePositiveNumber(value: unknown, scale: number): number | undefined {
  const number = readPositiveNumber(value);
  return number === undefined ? undefined : Math.round(number * scale * 100) / 100;
}

function readPoints(value: unknown, scale: number): Point[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const points = value.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      return [];
    }

    const x = point[0];
    const y = point[1];
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
      ? ([[Math.round(x * scale * 100) / 100, Math.round(y * scale * 100) / 100]] as Point[])
      : [];
  });

  return points.length >= 2 ? points : undefined;
}

function isStraightLine(points: Point[] | undefined): boolean {
  if (!points || points.length < 2) {
    return false;
  }

  const first = points[0]!;
  const sameX = points.every(([x]) => Math.abs(x - first[0]) < 0.5);
  const sameY = points.every(([, y]) => Math.abs(y - first[1]) < 0.5);
  return sameX || sameY;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function readRoundness(value: unknown): ElementInput["roundness"] {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const type = (value as { type?: unknown }).type;
  const roundnessValue = (value as { value?: unknown }).value;
  if (typeof type !== "number" || !Number.isFinite(type)) {
    return undefined;
  }

  return pruneUndefined({
    type,
    value: typeof roundnessValue === "number" && Number.isFinite(roundnessValue) ? roundnessValue : undefined,
  });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readSvgAttribute(element: SVGElement, name: string, fallback: number): number {
  const value = element.getAttribute(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function mermaidError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Mermaid conversion failed: ${message}`);
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
