import { describe, expect, it } from "vitest";

import { importDiagramSource } from "../../src/shared/importers.js";

describe("diagram source importers", () => {
  it("imports OpenAPI paths as bound endpoint nodes", async () => {
    const result = await importDiagramSource({
      kind: "openapi",
      data: JSON.stringify({
        info: { title: "Orders API" },
        paths: {
          "/orders": { get: {}, post: {} },
          "/orders/{id}": { get: {}, delete: {} },
        },
      }),
    });

    expect(result.sourceSummary).toEqual({ nodes: 3, edges: 2 });
    expect(result.elements.some((element) => element.id === "api")).toBe(true);
    expect(result.elements.filter((element) => element.type === "arrow")).toHaveLength(2);
  });

  it("imports package dependencies and marks runtime versus dev edges", async () => {
    const result = await importDiagramSource({
      kind: "package-dependencies",
      data: JSON.stringify({
        name: "demo",
        dependencies: { react: "^18.0.0" },
        devDependencies: { vitest: "^4.0.0" },
      }),
    });

    const edgeLabels = result.elements
      .filter((element) => element.type === "arrow")
      .map((element) => element.label?.text);

    expect(edgeLabels).toEqual(expect.arrayContaining(["dep", "dev"]));
  });

  it("caps markdown import bombs by maxNodes", async () => {
    const headings = Array.from({ length: 250 }, (_, index) => `${"#".repeat(index % 4 + 1)} Heading ${index}`).join("\n");
    const result = await importDiagramSource({
      kind: "markdown-outline",
      data: headings,
      maxNodes: 12,
    });

    expect(result.sourceSummary.nodes).toBe(12);
    expect(result.elements.filter((element) => element.type === "rectangle")).toHaveLength(12);
  });

  it("imports simple PlantUML and Structurizr relationships", async () => {
    const plantUml = await importDiagramSource({
      kind: "plantuml",
      data: "@startuml\nUser -> API : calls\nAPI --> Database : reads\n@enduml",
    });
    const structurizr = await importDiagramSource({
      kind: "structurizr",
      data: 'workspace { model { user = person "User" system = softwareSystem "System" user -> system "Uses" } }',
    });

    expect(plantUml.sourceSummary.edges).toBe(2);
    expect(structurizr.sourceSummary).toEqual({ nodes: 2, edges: 1 });
  });
});
