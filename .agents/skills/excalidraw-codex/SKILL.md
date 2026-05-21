---
name: excalidraw-codex
description: Create, inspect, edit, verify, and export Excalidraw diagrams through the local Excalidraw MCP for Codex. Use when the user asks Codex to draw diagrams, flowcharts, architecture maps, process views, system sketches, visual explanations, refine an existing Excalidraw scene, take screenshots, import/export .excalidraw JSON, or produce PNG/SVG exports using the Excalidraw MCP tools.
---

# Excalidraw MCP Workflow

Use the Excalidraw MCP as a live canvas with a feedback loop:

```text
draw -> inspect scene -> screenshot/export -> fix layout -> export
```

For production-quality diagrams, use the fuller loop:

```text
plan -> draw/import -> lint visually -> fix -> review screenshot -> export
```

Do not treat it as a one-shot prompt-to-diagram generator. Prefer stable IDs, element-level edits, screenshots, and iterative fixes.

## Standard Flow

1. Call `start_canvas` to start or verify the local canvas.
2. Call `read_diagram_guide` before drawing or making substantial edits.
3. Inspect the current scene with `describe_scene` or `query_elements` before changing existing diagrams.
4. Plan the coordinate grid, groups, IDs, labels, and arrow routes before creating elements.
5. Use `batch_create_elements` for first-pass creation.
6. Use `auto_layout` with Dagre, `route_arrows`, or `polish_scene` when spacing or routing is not already obvious.
7. Call `set_viewport` with fit-to-content behavior or center the element under review.
8. Call `get_canvas_screenshot`.
9. Fix visible issues: clipped text, overlap, cramped spacing, arrows through unrelated elements, confusing arrow labels, or poor viewport framing.
10. Export with `export_scene` or `export_to_image` when requested.

For complex diagrams, read `references/cheatsheet.md` for element examples and layout heuristics.

Use `create_verified_diagram` when the user wants a complete first draft and export in one pass. It should still be reviewed with the normal screenshot loop before claiming final quality.

Use `create_from_mermaid` when the user provides Mermaid source or explicitly asks to convert Mermaid. Treat its output as a preview: inspect it, normalize IDs and labels, fit the viewport, screenshot it, and fix spacing or arrow routing with normal element tools.

Use `create_from_template` for common starting points such as C4, flowchart, swimlane, sequence, state machine, ERD, data-flow, GitHub README hero, and MCP tool map diagrams. Use `create_repo_diagram` or `create_github_readme_assets` when the user wants repository documentation.

Use import tools for existing source material: `import_openapi`, `import_package_dependencies`, `import_database_schema`, `import_markdown_outline`, `import_plantuml`, and `import_structurizr`. Imports are a starting point; run Dagre layout, screenshot, and polish afterward.

## Sub-Agent Mode

When the user assigns Worker-style ownership, respect the declared write set. Do not edit outside it. Do not revert or overwrite changes from other workers.

Suggested split for large Excalidraw MCP work:

- Lead agent: architecture, contracts, integration, and final acceptance.
- MCP worker: tool registration, handlers, schemas, and MCP tests.
- Canvas worker: browser bridge, WebSocket/HTTP behavior, viewport, screenshot/export.
- State worker: normalization, bindings, snapshots, import/export path safety.
- Docs/skill worker: README, skill workflow, cheatsheet, visual fixtures.
- QA worker: browser smoke, nonblank screenshots, visual regression evidence.

Each worker should report changed paths and remaining risks. If two workers need the same file, pause and coordinate before editing.

## Lint, Fix, Review

After drawing or importing:

1. Run `describe_scene` and verify element count, labels, bounds, and connections.
2. Run `set_viewport` to fit content or center the area under review.
3. Run `get_canvas_screenshot`.
4. Lint the image for clipped text, overlap, unreadable labels, ambiguous arrows, wrong bindings, poor contrast, and excessive empty space.
5. Fix with `update_elements`; avoid delete/recreate unless the structure is wrong.
6. Repeat screenshot review until the diagram is visually acceptable.

Do not claim the diagram is finished from JSON alone.

## Editing Rules

- Always inspect existing scenes before editing.
- Prefer `update_elements` against existing IDs over delete-and-recreate.
- Use `snapshot_scene` before broad or risky changes and before importing over an existing session.
- Use `restore_snapshot` if an edit degrades the diagram.
- Use `delete_elements` and `clear_canvas` only when the user request clearly calls for removal.
- Keep IDs stable and human-readable when future edits are likely.
- Use generated IDs only for disposable or low-importance elements.
- Keep a canvas session alive across iterative edits when possible; use `export_scene` for durable persistence between sessions.

## Layout Rules

- Plan coordinates before drawing.
- Use Dagre layout for layered graphs, dependency maps, source imports, and large diagrams.
- Use readable font sizes: body text at least `16`, headings at least `20`.
- Give text-bearing shapes generous width and height.
- Use shape labels for text that belongs to a shape.
- Use standalone text for titles, annotations, zone labels, and explanatory copy.
- Use rectangles/cards for text-heavy blocks.
- Avoid centered labels on huge background zones.
- Avoid arrows through unrelated elements.
- Use elbowed or waypoint arrows around obstacles when possible.
- Use arrow labels sparingly and keep them short.

## Element Model

Create simplified skeleton elements at the MCP boundary. Supported types are:

```text
rectangle, ellipse, diamond, text, arrow, line, frame
```

Common fields:

```json
{
  "id": "stable-id",
  "type": "rectangle",
  "x": 120,
  "y": 160,
  "width": 220,
  "height": 90,
  "label": { "text": "Readable label", "fontSize": 20 },
  "backgroundColor": "#e7f5ff",
  "strokeColor": "#1971c2"
}
```

Arrow bindings can use same-request references:

```json
{
  "id": "arrow-a-to-b",
  "type": "arrow",
  "startElementId": "step-a",
  "endElementId": "step-b",
  "label": { "text": "next" }
}
```

## Verification Checklist

After significant changes, call `get_canvas_screenshot` and check:

- All important text is visible and readable.
- Text does not clip or overflow shape boundaries.
- Elements do not overlap unless intentionally layered.
- Arrow starts and ends are visually attached to the right shapes.
- Arrow routes avoid unrelated shapes.
- The viewport frames the diagram without excessive empty space.
- Colors have enough contrast for labels and arrows.

If the screenshot is blank or clearly wrong, call `describe_scene`, `set_viewport`, and retry screenshot before reporting success.

## Export Guidance

- Use `export_scene` for editable `.excalidraw` JSON.
- Use `export_to_image` with `png` for sharing or visual review.
- Use `export_to_image` with `svg` for scalable documentation assets.
- Screenshot and export tools can start a managed headless canvas client when no visible browser is connected.
- Prefer selection-scoped export when the user asks for one part of a larger scene and the tool/runtime supports selected IDs.
- Keep export paths inside the workspace unless the user explicitly configures another allowed root.

## Release Helpers

- `npm run setup:codex`: build, write project config, run healthcheck, and verify MCP tool listing.
- `npm run examples:generate`: regenerate gallery PNG/SVG/.excalidraw outputs and demo assets.
- `npm run bench:scenes`: measure 100, 500, 1,000, and 5,000 element scene performance.

## Visual Fixtures

Use `tests/fixtures/visual/*.json` as small reference scenes for smoke checks, visual regression, and examples. The fixture set covers flowcharts, architecture maps, swimlanes, decision trees, sequence-like interaction sketches, and normalized Mermaid-import output.

## Optional Healthcheck

From the repository root, run:

```powershell
node .\.agents\skills\excalidraw-codex\scripts\healthcheck.cjs
```

Use the result to quickly identify missing files, missing build output, or an unreachable canvas endpoint.
