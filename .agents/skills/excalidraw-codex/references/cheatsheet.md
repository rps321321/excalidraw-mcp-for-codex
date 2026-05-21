# Excalidraw MCP Cheatsheet

Use this reference when planning diagrams, writing skeleton elements, or debugging visual quality.

## Tool Order

```text
start_canvas
read_diagram_guide
describe_scene or query_elements
batch_create_elements
auto_layout with Dagre or polish_scene when useful
set_viewport
get_canvas_screenshot
update_elements as needed
export_scene or export_to_image
```

When starting from Mermaid, call `create_from_mermaid`, then continue with `describe_scene`, `set_viewport`, `get_canvas_screenshot`, and normal element edits. Treat Mermaid output as a preview that needs normalization, not a finished diagram.

For a full first-pass workflow, call `create_verified_diagram`. It plans or imports, creates, lays out, screenshots, lints, polishes, and exports. Still inspect the screenshot before calling the diagram finished.

## Session Rhythm

- Keep the canvas session open while iterating.
- Use `snapshot_scene` before broad edits, destructive imports, or risky layout rewrites.
- Use `export_scene` when the work needs to persist beyond the active session.
- Screenshot and export can use a managed headless canvas client; open the browser canvas when you need human visual inspection.
- Prefer selection-scoped image export for a reviewed subset when the runtime supports it.
- Use named sessions for multiple diagrams: `save_canvas_session`, `list_canvas_sessions`, `switch_canvas_session`, `delete_canvas_session`.

## Lint, Fix, Review

Run this loop after every meaningful change:

1. `describe_scene` for structure.
2. `set_viewport` for framing.
3. `get_canvas_screenshot` for visual truth.
4. Fix clipped labels, bad spacing, overlaps, wrong bindings, arrow crossings, and poor contrast.
5. Screenshot again before reporting completion.

JSON correctness is necessary, but the screenshot decides whether the diagram works.

## Supported Element Types

- `rectangle`: text-bearing cards, process steps, containers.
- `ellipse`: start/end states, actors, external systems.
- `diamond`: decisions.
- `text`: titles, annotations, standalone notes.
- `arrow`: directed relationships.
- `line`: separators, non-directional connections.
- `frame`: grouped sections or named views.
- `image`: workspace-local images added through `add_image`.

## Skeleton Shape

```json
{
  "id": "auth-service",
  "type": "rectangle",
  "x": 120,
  "y": 140,
  "width": 240,
  "height": 96,
  "label": { "text": "Auth Service", "fontSize": 20 },
  "backgroundColor": "#e7f5ff",
  "strokeColor": "#1971c2"
}
```

## Skeleton Text

```json
{
  "id": "title",
  "type": "text",
  "x": 120,
  "y": 60,
  "width": 520,
  "height": 40,
  "text": "Request Flow",
  "strokeColor": "#1c1c1c"
}
```

Use the current schema returned by `read_diagram_guide`; if a styling field is not accepted, omit it and rely on default Excalidraw text styling.

Use `metadata` on elements to preserve semantics:

```json
{
  "id": "postgres",
  "type": "rectangle",
  "label": { "text": "Postgres" },
  "metadata": { "semanticType": "database", "owner": "platform" }
}
```

## Template And Repo Starts

- `create_from_template`: C4, flowchart, swimlane, sequence, state machine, ERD, data-flow, GitHub README hero, and MCP tool map.
- `create_repo_diagram`: scans the workspace and creates architecture, dependency, test-map, or API-map diagrams.
- `create_github_readme_assets`: creates a README-oriented scene; export PNG/SVG into `docs/assets`.
- `add_image`: imports a workspace-local PNG, JPG, GIF, WebP, or SVG into the scene.

## Import Starts

- `import_openapi`: endpoint map from OpenAPI JSON or YAML-like text.
- `import_package_dependencies`: package dependency graph from `package.json`.
- `import_database_schema`: table/FK diagram from SQL DDL.
- `import_markdown_outline`: heading hierarchy from Markdown.
- `import_plantuml`: simple PlantUML relationship graph.
- `import_structurizr`: C4 graph from Structurizr DSL.

After importing, use `auto_layout` with `mode: "dagre"`, `set_viewport`, and `get_canvas_screenshot`.

## Bound Arrow

```json
{
  "id": "web-to-api",
  "type": "arrow",
  "startElementId": "web-client",
  "endElementId": "api-service",
  "label": { "text": "HTTPS" },
  "endArrowhead": "arrow"
}
```

Prefer `startElementId` and `endElementId` for normal shape-to-shape connections. Use explicit `points` only when routing matters.

## Three-Box Flowchart Example

```json
{
  "elements": [
    {
      "id": "collect",
      "type": "rectangle",
      "x": 80,
      "y": 140,
      "width": 190,
      "height": 84,
      "label": { "text": "Collect input", "fontSize": 18 },
      "backgroundColor": "#e7f5ff",
      "strokeColor": "#1971c2"
    },
    {
      "id": "process",
      "type": "rectangle",
      "x": 350,
      "y": 140,
      "width": 190,
      "height": 84,
      "label": { "text": "Process", "fontSize": 18 },
      "backgroundColor": "#fff4e6",
      "strokeColor": "#e8590c"
    },
    {
      "id": "publish",
      "type": "rectangle",
      "x": 620,
      "y": 140,
      "width": 190,
      "height": 84,
      "label": { "text": "Publish result", "fontSize": 18 },
      "backgroundColor": "#ebfbee",
      "strokeColor": "#2b8a3e"
    },
    {
      "id": "collect-to-process",
      "type": "arrow",
      "startElementId": "collect",
      "endElementId": "process"
    },
    {
      "id": "process-to-publish",
      "type": "arrow",
      "startElementId": "process",
      "endElementId": "publish"
    }
  ]
}
```

## Layout Heuristics

- Leave at least `60` px between major cards.
- Use Dagre for dependency layers, source imports, and large relationship maps.
- Use rows for sequences and columns for ownership boundaries.
- Keep cards in a row the same height unless content strongly differs.
- Put decision diamonds between the step that asks and the branches that answer.
- Use frames for lanes only when they clarify ownership or phases.
- Keep background frames lightly colored with strong enough contrast for foreground elements.
- Route arrows around cards instead of through them.
- Use short labels: one to four words is usually enough.

## Mermaid Preview Normalize

After `create_from_mermaid`:

- Rename generated IDs to stable, human-readable IDs if future edits are likely.
- Convert long Mermaid node text into concise shape labels.
- Align rows and columns manually; Mermaid layout may be technically correct but visually uneven.
- Replace crossing or diagonal arrows with cleaner routes when needed.
- Screenshot before export, especially for branch-heavy graphs.

## Visual Fixtures

Fixtures under `tests/fixtures/visual` are small scene inputs for regression checks and examples:

- `flowchart.json`: linear process with three boxes.
- `architecture.json`: clients, API, services, and datastore.
- `swimlane.json`: ownership lanes with handoffs.
- `decision-tree.json`: question node with branches and outcomes.
- `sequence-ish.json`: timeline messages without pretending to be UML-perfect.
- `mermaid-import.json`: normalized scene shape expected after Mermaid import.

## Color Starters

Use restrained, readable colors:

- Blue: `#e7f5ff` fill, `#1971c2` stroke.
- Green: `#ebfbee` fill, `#2b8a3e` stroke.
- Orange: `#fff4e6` fill, `#e8590c` stroke.
- Gray: `#f8f9fa` fill, `#495057` stroke.
- Red warning: `#fff5f5` fill, `#c92a2a` stroke.

## Visual QA

Fix these before exporting:

- Blank screenshot.
- Text clipped by shape bounds.
- Text too small to read.
- Labels floating far from the intended shape.
- Arrow head attached to the wrong element.
- Arrow crossing through unrelated text or cards.
- Large empty margins after viewport fitting.
- Duplicate IDs or labels that make future edits ambiguous.

## Release Helpers

- `npm run setup:codex`: build, generate project config, run healthcheck, verify MCP listing.
- `npm run examples:generate`: generate gallery PNG/SVG/.excalidraw assets and visual golden manifest.
- `npm run bench:scenes`: benchmark 100, 500, 1,000, and 5,000 element scenes.
