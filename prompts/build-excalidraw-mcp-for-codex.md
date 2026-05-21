# Build Prompt: Excalidraw MCP for Codex

You are Codex working in the repository `excalidraw-mcp-for-codex`. Build a local-first MCP server that lets Codex create, inspect, edit, verify, and export Excalidraw diagrams.

## Goal

Create a TypeScript project with:

1. A stdio MCP server that Codex can register with `codex mcp add`.
2. A local browser canvas using `@excalidraw/excalidraw`.
3. A local HTTP/WebSocket bridge so MCP tool calls update the canvas in real time.
4. A Codex skill that teaches the agent how to use the tools and verify diagrams.
5. Tests and a short README with install, run, and Codex configuration steps.

## Product Direction

Do not build only a one-shot prompt-to-diagram generator. Build a canvas toolkit with a feedback loop:

draw -> inspect scene -> screenshot/export -> fix layout -> export.

Favor element-level CRUD, stable IDs, bound labels, arrow bindings, screenshots, and import/export. Add higher-level intent tools only after the low-level tool surface is reliable.

## Parallel Execution Requirement

The user explicitly wants this build to use multiple sub-agents and parallelize as much as possible. Use sub-agents aggressively when the environment supports them. If sub-agent tooling is unavailable, follow the same work breakdown sequentially.

The lead Codex agent owns architecture, shared contracts, integration, final review, and final verification. Do not delegate the immediate blocking architecture decisions. First create or agree on the shared contracts, then split independent work across workers.

Recommended parallel split:

- Worker A, MCP core: owns `src/mcp/**`, MCP tool registration, tool handlers, approval-sensitive tool descriptions, and MCP-focused tests under `tests/mcp/**`.
- Worker B, canvas runtime: owns `src/canvas/**`, `src/web/**`, WebSocket/HTTP bridge, Excalidraw React integration, viewport handling, screenshot/export plumbing, and canvas tests under `tests/canvas/**`.
- Worker C, schemas and state: owns shared Zod schemas, element normalization, state management, snapshots, import/export path safety, and related tests under `tests/state/**`.
- Worker D, skill/docs: owns `.agents/skills/**`, `README.md`, setup docs, troubleshooting, and example prompts.
- Worker E, QA/e2e: owns Playwright or browser smoke tests under `tests/e2e/**`, verification scripts, nonblank screenshot checks, and acceptance-test fixtures.

Coordination rules:

- Assign each worker a disjoint write set before it starts.
- Tell workers they are not alone in the repo and must not revert or overwrite others' changes.
- Ask each worker to edit files directly and report changed paths.
- Keep shared types small and stable so workers can build against them.
- Do not run duplicate workers on the same implementation slice.
- After workers finish, the lead agent integrates, resolves mismatches, runs the full test suite, and performs the browser smoke test.
- Prefer parallel read-only research while scaffolding, then parallel implementation after shared interfaces exist.

## Architecture

Use a TypeScript monorepo or simple TypeScript app:

```text
src/
  mcp/
    index.ts
    tools/
    schemas.ts
    state.ts
    security.ts
  canvas/
    server.ts
    websocket.ts
    export.ts
  web/
    index.html
    src/App.tsx
.agents/
  skills/
    excalidraw-codex/
      SKILL.md
      references/cheatsheet.md
      scripts/healthcheck.cjs
```

Use:

- `@modelcontextprotocol/sdk` for MCP.
- `@excalidraw/excalidraw` for the canvas.
- `zod` for tool input schemas.
- Vite/React for the browser app.
- WebSocket for live updates.

Bind the local server to `127.0.0.1` by default.

## Required MCP Tools

Implement these first:

- `start_canvas`: starts or verifies the local canvas and returns URL/status.
- `read_diagram_guide`: returns drawing rules, element format, colors, and layout anti-patterns.
- `batch_create_elements`: creates many Excalidraw skeleton elements in one call.
- `update_elements`: updates existing elements by ID.
- `delete_elements`: deletes selected elements by ID.
- `clear_canvas`: clears all elements.
- `query_elements`: searches by ID, type, label/text, frame, or group.
- `describe_scene`: compact summary of element positions, labels, connections, and bounding box.
- `set_viewport`: fits content or centers an element.
- `get_canvas_screenshot`: returns a rendered PNG image.
- `export_scene`: writes `.excalidraw` JSON under an allowed workspace path.
- `import_scene`: loads `.excalidraw` JSON.
- `export_to_image`: writes PNG/SVG under an allowed workspace path.
- `snapshot_scene` and `restore_snapshot`.
- `create_from_mermaid`: converts Mermaid to Excalidraw elements if the package integration is straightforward; otherwise stub with a clear TODO and test coverage.

## Element Rules

Accept simplified Excalidraw skeleton JSON at the MCP boundary.

Support:

- `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame`.
- Shape labels with `label: { "text": "..." }`.
- Arrow labels.
- Arrow bindings with `startBinding` / `endBinding`.
- Stable custom IDs.
- Generated IDs when omitted.
- Batch creation with same-request references.

Normalize internally:

- Use Excalidraw helpers such as `convertToExcalidrawElements()` where possible.
- Keep labels as bound text when text belongs to a shape.
- Use standalone text for titles, annotations, zone labels, and slide body copy.
- Preserve IDs unless explicitly regenerating.
- Keep target shape `boundElements` in sync when arrows are bound.

## Safety Requirements

- Validate every tool input with Zod.
- Limit payload size and element count.
- Restrict file import/export to the workspace by default.
- Put destructive tools behind clear MCP descriptions so Codex can prompt for approval.
- Never log API keys, bearer tokens, collab room keys, or secret URLs.
- Use a random session token for local HTTP/WebSocket requests if practical.
- Do not bind to `0.0.0.0` unless explicitly configured.

## Codex Skill

Create `.agents/skills/excalidraw-codex/SKILL.md` with:

- Front matter `name` and `description`.
- Trigger language for drawing, editing, exporting, inspecting, and refining Excalidraw diagrams.
- Workflow:
  1. Call `start_canvas`.
  2. Call `read_diagram_guide`.
  3. Plan the coordinate grid.
  4. Use `batch_create_elements`.
  5. Call `set_viewport`.
  6. Call `get_canvas_screenshot`.
  7. Fix clipping, overlap, and arrow routing.
  8. Export when requested.
- A concise cheatsheet in `references/cheatsheet.md`.
- A `scripts/healthcheck.cjs` helper if useful.

## Quality Rules For Tool Descriptions

Put these rules in `read_diagram_guide` and relevant tool descriptions:

- Plan before drawing.
- Use readable font sizes: body >= 16, headings >= 20.
- Keep text bounds generous.
- Use rectangles/cards for text-bearing blocks.
- Do not put centered labels on huge background zones.
- Avoid arrows through unrelated elements.
- Use elbowed or waypoint arrows around obstacles.
- Use arrow labels sparingly.
- Always inspect existing scenes before editing.
- Prefer updating existing IDs over delete and recreate.
- Always screenshot after significant changes and fix visible issues.

## Tests

Add unit and integration coverage for:

- Tool registration.
- Zod validation.
- Batch creation.
- Label normalization.
- Arrow binding.
- Query and describe scene.
- Snapshot and restore.
- Safe file path checks.
- Export/import round trip.
- WebSocket broadcast.
- Browser smoke test or Playwright test that verifies the canvas is nonblank after drawing.

## Documentation

Add `README.md` with:

- What the project does.
- Install/build/run commands.
- Codex MCP registration example:

```bash
codex mcp add excalidraw -- node C:\absolute\path\to\dist\index.js
```

- Project-scoped config example:

```toml
[mcp_servers.excalidraw]
command = "node"
args = ["C:\\absolute\\path\\to\\dist\\index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "auto"

[mcp_servers.excalidraw.tools.clear_canvas]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.delete_elements]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.import_scene]
approval_mode = "prompt"
```

- Troubleshooting for port conflicts, canvas not open, MCP server not visible, screenshot/export failures, and Windows path issues.

## Acceptance Criteria

The project is done when:

1. `npm ci`, `npm run build`, and tests pass.
2. Codex can list the Excalidraw MCP tools.
3. A simple prompt can create a three-box flowchart.
4. The local canvas updates in real time.
5. `describe_scene` reports the created elements.
6. `get_canvas_screenshot` returns a nonblank image.
7. Exported `.excalidraw` JSON can be imported back.
8. The Codex skill is present and explains the workflow.
