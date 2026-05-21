# Excalidraw MCP for Codex Research Report

Research date: 2026-05-21

## Executive Summary

The best path for "Excalidraw MCP for Codex" is a local-first MCP toolkit, not only a one-shot prompt-to-diagram renderer.

Recommended build:

1. A TypeScript stdio MCP server for Codex.
2. A local browser canvas powered by `@excalidraw/excalidraw`.
3. A WebSocket/REST bridge so MCP tool calls update the canvas in real time.
4. A Codex skill with drawing workflows, layout rules, and verification steps.
5. Optional remote integrations later: Excalidraw+ MCP, MCP Apps, and two-way webhook/event workflows.

Why this approach:

- Codex can configure local stdio MCP servers with `codex mcp add`.
- Excalidraw works well programmatically through element skeletons, `convertToExcalidrawElements`, `excalidrawAPI.updateScene`, and scene export/import.
- The strongest community examples add live preview, element CRUD, screenshot feedback, layout guidance, and agent skills.
- Forum posts repeatedly show that diagram quality depends on tool descriptions and workflow discipline, not just access to Excalidraw.

## Local Workspace Finding

The current workspace was empty when researched. There is no existing implementation to extend yet, so this report assumes a greenfield project.

## Sources Reviewed

Official docs:

- [OpenAI Codex MCP docs](https://developers.openai.com/codex/mcp)
- [OpenAI Codex skills docs](https://developers.openai.com/codex/skills)
- [OpenAI Docs MCP setup](https://developers.openai.com/learn/docs-mcp)
- [Model Context Protocol SDK docs](https://modelcontextprotocol.io/docs/sdk)
- [MCP TypeScript SDK server docs](https://ts.sdk.modelcontextprotocol.io/documents/server.html)
- [MCP Apps docs](https://modelcontextprotocol.io/extensions/apps/overview)
- [Excalidraw+ MCP public beta docs](https://plus.excalidraw.com/docs/mcp)
- [Excalidraw+ MCP tools](https://plus.excalidraw.com/docs/mcp/tools)
- [Excalidraw+ MCP getting started](https://plus.excalidraw.com/docs/mcp/getting-started)
- [Excalidraw developer docs](https://docs.excalidraw.com/docs)
- [Excalidraw React integration](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/integration)
- [Excalidraw API prop docs](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/api/props/excalidraw-api)
- [Creating Excalidraw elements programmatically](https://docs.excalidraw.com/docs/%40excalidraw/excalidraw/api/excalidraw-element-skeleton)
- [Mermaid to Excalidraw package docs](https://docs.excalidraw.com/docs/%40excalidraw/mermaid-to-excalidraw/installation)

Community repos:

- [excalidraw/excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp)
- [Scofieldfree/excalidraw-mcp](https://github.com/Scofieldfree/excalidraw-mcp)
- [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)
- [dev-smurf/excaliclaude](https://github.com/dev-smurf/excaliclaude)
- [sshwarts/napkin](https://github.com/sshwarts/napkin)
- [lesleslie/excalidraw-mcp](https://github.com/lesleslie/excalidraw-mcp)

Forum and community discussion:

- [I built an easy-to-use Excalidraw MCP server](https://www.reddit.com/r/Excalidraw/comments/1pmjtfu/i_built_an_easytouse_excalidraw_mcp_server/)
- [Yet Another Excalidraw MCP](https://www.reddit.com/r/Excalidraw/comments/1t4tdwa/yet_another_excalidraw_mcp/)
- [Public API & MCP beta is here](https://www.reddit.com/r/Excalidraw/comments/1ta6jp4/public_api_mcp_beta_is_here/)
- [I built an MCP server that lets Claude draw on your Excalidraw canvas in real-time](https://www.reddit.com/r/claude/comments/1srn8oc/i_built_an_mcp_server_that_lets_claude_draw_on/)

## Codex Requirements

Codex supports MCP through both CLI and config files.

Practical setup options:

```bash
codex mcp add excalidraw -- node C:\path\to\excalidraw-mcp\dist\index.js
```

For streamable HTTP:

```bash
codex mcp add excalidraw --url http://127.0.0.1:3131/mcp
```

Config shape:

```toml
[mcp_servers.excalidraw]
command = "node"
args = ["C:\\path\\to\\excalidraw-mcp\\dist\\index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

Useful Codex options from current docs:

- `enabled_tools` / `disabled_tools` for tool allow or deny lists.
- `default_tools_approval_mode` and per-tool approval modes.
- `url`, `bearer_token_env_var`, `http_headers`, and `env_http_headers` for streamable HTTP servers.
- Project-scoped `.codex/config.toml` can be used in trusted projects.

Important note on skills:

- Current OpenAI docs describe `.agents/skills` for repo/user skills.
- This desktop environment exposes skills under `.codex/skills` as well.
- For maximum compatibility, create a repo skill in `.agents/skills/excalidraw-codex/SKILL.md`, then test whether the current Codex Desktop build also needs a mirrored `.codex/skills` install.

## Excalidraw Technical Facts That Matter

Useful official APIs:

- `@excalidraw/excalidraw` provides the React canvas component.
- Excalidraw is client-side only in frameworks like Next.js, so SSR must be avoided.
- `excalidrawAPI.updateScene()` can update the active scene.
- `excalidrawAPI.getSceneElements()` and `getSceneElementsIncludingDeleted()` can read canvas state.
- `excalidrawAPI.scrollToContent()` supports viewport fitting.
- `onChange`, `onPointerDown`, and `onPointerUp` help detect manual edits.
- `initialData` can load `elements`, `appState`, `files`, and `libraryItems`.
- `convertToExcalidrawElements()` turns simpler skeleton elements into full Excalidraw elements.
- Skeleton elements support shape labels, labelled arrows, arrow bindings, and frames.
- `@excalidraw/mermaid-to-excalidraw` can parse Mermaid into Excalidraw skeleton elements, then those need conversion before rendering.

Design implication:

Use skeleton-style inputs at the MCP boundary, then normalize them through Excalidraw's own helpers instead of hand-writing full Excalidraw element JSON wherever possible.

## Existing Implementations Compared

| Project | Architecture | Strong Ideas To Reuse | Caveats |
|---|---|---|---|
| `excalidraw/excalidraw-mcp` | MCP App with embedded UI resource and remote `https://mcp.excalidraw.com` | Streaming inline diagram UI, camera moves, Excalidraw export, polished agent cheat sheet | Best for clients with MCP Apps support. Codex support for embedded MCP Apps is not clearly documented, so do not depend on this as the primary Codex UX. |
| `Scofieldfree/excalidraw-mcp` | Local stdio MCP plus local HTTP/WebSocket canvas | Easy `npx` install, real-time preview, multi-session, Mermaid, export, templates | Tool surface is smaller than the most capable canvas-toolkit repos. |
| `yctimlin/mcp_excalidraw` | Separate canvas server plus stdio MCP server | 26-tool toolkit, screenshot feedback, `describe_scene`, import/export, snapshots, alignment, grouping, Codex/Claude skill, REST fallback | More moving parts. Needs a running canvas server before the MCP server is useful. |
| `dev-smurf/excaliclaude` | MCP server joins native Excalidraw collab rooms | Uses real Excalidraw collaboration, no API key, no browser extension, E2E room key model, strong layout rules embedded in tools | Built around collab URLs and Claude naming, less directly aligned to Codex-local app control. |
| `sshwarts/napkin` | Shared Excalidraw canvas plus MCP HTTP server and optional webhook | Intent-based API, agent and human share one whiteboard, two-way "canvas wakes agent" model, event-sourcing idea | More experimental and broader than an MVP. Webhook wakeups are outside normal MCP-only operation. |
| `lesleslie/excalidraw-mcp` | Python FastMCP plus TypeScript canvas | Auto-manages canvas server, Python-side monitoring, large test surface, hybrid architecture | Heavier stack. Includes checked-in `node_modules` in the repo snapshot, which is not a pattern to copy. |

## Community Pattern Notes

Recurring signal from forums and READMEs:

- Editability matters. Users dislike diagrams that only render inline and disappear from the working canvas.
- Live browser sync is a major quality-of-life feature.
- Agents need to inspect what they drew. `describe_scene` and screenshot/export tools create the feedback loop.
- Tool descriptions are part of the product. Layout guidance embedded directly in the tool descriptions improved results in `excaliclaude`.
- Coordinates alone are brittle. Napkin's intent-based idea, such as `add_node`, `connect`, and `layout`, is worth adding after the lower-level CRUD is stable.
- Permissions matter. Excalidraw+ public beta explicitly added API-key permissions so agents can be useful without unrestricted delete access.
- Event logs may be better than snapshots for human-agent collaboration. A recent event window is easier for an agent to reason about than a whole-scene diff.

## Recommended Architecture

### MVP: Local Canvas Toolkit For Codex

Use a TypeScript monorepo:

```text
excalidraw-mcp-for-codex/
  package.json
  tsconfig.json
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

Process model:

1. Codex launches the MCP server through stdio.
2. MCP server starts or connects to a local canvas HTTP server on `127.0.0.1`.
3. The browser opens `http://127.0.0.1:<port>`.
4. MCP tools mutate scene state.
5. The canvas receives updates through WebSocket and applies them with Excalidraw APIs.
6. The canvas can send manual edits back to the server through `onChange`.
7. Screenshot/export tools ask the browser/canvas side to render the exact result the user sees.

Recommended transport:

- Primary: stdio MCP for Codex.
- Secondary: local HTTP API for fallback scripts and tests.
- Later: streamable HTTP MCP only if needed for remote clients.

## Tool Surface

Start with low-level, reliable tools:

| Tool | Purpose | Approval |
|---|---|---|
| `start_canvas` | Start/open local canvas and return URL/status | auto |
| `read_diagram_guide` | Return drawing rules, element format, colors, layout anti-patterns | auto |
| `batch_create_elements` | Add many skeleton elements in one call | auto |
| `update_elements` | Move, resize, restyle, relabel existing elements | auto |
| `delete_elements` | Delete selected elements by ID | prompt |
| `clear_canvas` | Clear the whole scene | prompt |
| `query_elements` | Search by type, ID, label/text, frame, group | auto |
| `describe_scene` | Compact agent-readable summary of layout, bounds, labels, connections | auto |
| `set_viewport` | Fit content, center element, set zoom/scroll | auto |
| `get_canvas_screenshot` | Return rendered PNG for visual verification | auto |
| `export_scene` | Save `.excalidraw` JSON under an allowed workspace directory | auto |
| `import_scene` | Load `.excalidraw` JSON | prompt |
| `export_to_image` | Save PNG/SVG under allowed workspace directory | auto |
| `create_from_mermaid` | Convert Mermaid to Excalidraw elements | auto |
| `snapshot_scene` | Save named in-memory or file-backed snapshot | auto |
| `restore_snapshot` | Restore a saved snapshot | prompt |

Then add higher-level intent tools after CRUD stabilizes:

| Tool | Purpose |
|---|---|
| `add_node` | Add a labelled node without coordinates, using layout engine defaults |
| `connect_nodes` | Bind arrows between nodes by label or ID |
| `auto_layout` | Run Dagre/ELK/layout rules and update element positions |
| `create_architecture_diagram` | Generate common architecture layout templates |
| `create_slide_frames` | Create Excalidraw frame-based slide decks |

## Element Schema Rules

At the MCP boundary, accept simplified Excalidraw skeleton elements:

```json
{
  "id": "api",
  "type": "rectangle",
  "x": 240,
  "y": 120,
  "width": 180,
  "height": 70,
  "label": { "text": "API Service" },
  "backgroundColor": "#dbeafe",
  "strokeColor": "#2563eb"
}
```

Arrow binding:

```json
{
  "type": "arrow",
  "startBinding": { "elementId": "api", "fixedPoint": [1, 0.5] },
  "endBinding": { "elementId": "db", "fixedPoint": [0, 0.5] },
  "endArrowhead": "arrow"
}
```

Internal normalization should:

- Generate stable IDs when absent.
- Preserve IDs when supplied.
- Use `convertToExcalidrawElements()` where possible.
- Keep labels as bound text, not separate overlapping text, when the label belongs to a shape.
- Keep standalone text for titles, subtitles, annotations, slide body copy, and zone labels.
- Normalize arrow bindings and update target `boundElements`.
- Reject or clamp huge input payloads.

## Quality Rules To Put In Tool Descriptions

These should live in `read_diagram_guide` and the tool descriptions:

- Plan the grid before drawing.
- Use rectangles/cards for text-bearing blocks.
- Avoid labels centered inside large background zones; place zone labels as standalone text near the top-left.
- Use minimum readable font sizes: 16 for body text, 20 for headings.
- Use generous text bounds. Clipping usually means the bounds are too tight.
- Avoid diagonal arrows through unrelated elements.
- Use elbowed or waypoint arrows around obstacles.
- Use arrow labels sparingly.
- Use `describe_scene` before editing an existing canvas.
- Use `get_canvas_screenshot` after each significant batch, then fix overlap, clipping, and arrow routing before continuing.
- Prefer updating existing IDs over deleting and recreating elements, because deleting breaks bindings and continuity.

## Persistence And File I/O

MVP persistence options:

- In-memory state for active session.
- File-backed snapshots in `.excalidraw-mcp/snapshots/`.
- Exported scenes in `diagrams/` or user-provided paths under the workspace.

Path safety:

- Resolve paths before writing.
- Restrict exports/imports to the workspace unless the user explicitly opts into another base directory.
- Never let a tool write arbitrary files outside allowed directories by default.

## Security Model

Recommended defaults:

- Bind HTTP/WebSocket servers to `127.0.0.1`.
- Use a random session token for local HTTP/WebSocket operations.
- Do not expose the local server on `0.0.0.0` unless explicitly configured.
- Validate all tool inputs with Zod.
- Rate-limit large batch operations, for example maximum 500 elements per call.
- Put delete, clear, import, remote upload/share, and network-exposed modes behind Codex approval.
- Never log API keys, collab room keys, bearer tokens, or full share URLs with secrets.
- If supporting Excalidraw+ MCP/API, store the API key in an environment variable and use least-privilege permissions.

Suggested Codex approval config:

```toml
[mcp_servers.excalidraw]
command = "node"
args = ["dist/index.js"]
default_tools_approval_mode = "auto"

[mcp_servers.excalidraw.tools.clear_canvas]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.delete_elements]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.import_scene]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.restore_snapshot]
approval_mode = "prompt"

[mcp_servers.excalidraw.tools.export_to_excalidraw_url]
approval_mode = "prompt"
```

## Test Plan

Unit tests:

- Zod schema validation.
- Element ID generation.
- Skeleton-to-Excalidraw normalization.
- Label and bound-text handling.
- Arrow binding creation and update.
- Safe file path checks.
- State snapshot/restore.

Integration tests:

- MCP `tools/list` includes expected tools.
- MCP `batch_create_elements` updates canvas state.
- REST fallback endpoints work.
- WebSocket broadcasts element changes.
- Import/export round trip preserves elements and app state.

Browser tests:

- Start local canvas and verify it renders.
- Create diagram through MCP/REST.
- Take screenshot and assert nonblank image.
- Verify no obvious overlap for a simple generated flowchart.
- Verify export PNG/SVG and `.excalidraw` JSON files are produced.

Manual smoke:

```bash
npm ci
npm run build
npm test
node dist/index.js --health
codex mcp add excalidraw -- node C:\absolute\path\dist\index.js
codex mcp list
```

## Implementation Phases

### Phase 1: Working Local Canvas

- Create TypeScript project.
- Build React/Vite Excalidraw canvas.
- Add HTTP/WebSocket state bridge.
- Add stdio MCP server.
- Implement `start_canvas`, `read_diagram_guide`, `batch_create_elements`, `query_elements`, `describe_scene`, `clear_canvas`.
- Verify with a simple Codex MCP call.

### Phase 2: Closed Feedback Loop

- Add screenshot/export tools.
- Add import/export `.excalidraw`.
- Add snapshots.
- Add update/delete/group/align/distribute.
- Add Codex skill with workflow and cheatsheet.

### Phase 3: Diagram Intelligence

- Add Mermaid conversion.
- Add higher-level node/connect/layout tools.
- Add architecture and slide templates.
- Add quality checks for text clipping, overlaps, and arrow crossings.

### Phase 4: Collaboration And Remote Options

- Optional Excalidraw+ MCP/API integration.
- Optional native Excalidraw collaboration-room integration.
- Optional webhook/event log so manual canvas edits can trigger agent follow-up.
- Optional MCP Apps support if Codex host support becomes clear.

## Parallel Build Strategy

The implementation prompt should authorize sub-agents explicitly. The best pattern is lead-agent ownership of architecture and integration, plus parallel workers with disjoint write sets.

Recommended split:

| Worker | Ownership | Output |
|---|---|---|
| Lead agent | Architecture, shared contracts, integration, final verification | Project skeleton, shared interfaces, merged implementation, final test run |
| Worker A | MCP core | `src/mcp/**`, tool registration, handlers, MCP tests |
| Worker B | Canvas runtime | `src/canvas/**`, `src/web/**`, WebSocket/HTTP bridge, Excalidraw UI, canvas tests |
| Worker C | Schemas and state | Zod schemas, element normalization, scene state, snapshots, path safety, state tests |
| Worker D | Skill and docs | `.agents/skills/**`, README, troubleshooting, example prompts |
| Worker E | QA and e2e | Browser smoke tests, screenshot checks, acceptance fixtures |

Parallelization guardrails:

- Define shared interfaces first.
- Give each worker an explicit file ownership boundary.
- Workers should edit files directly and list changed paths.
- Workers should not revert or overwrite changes from other workers.
- The lead agent should integrate results and run the full build/test/browser verification before calling the task complete.

## Decisions To Make Before Coding

1. Local only or Excalidraw+ aware?
   - Recommendation: local first, Excalidraw+ optional.

2. One process or two processes?
   - Recommendation: one MCP launcher process that starts the canvas server internally for easy Codex install.

3. Do we support MCP Apps immediately?
   - Recommendation: no. Build core MCP tools and local browser canvas first. Add MCP Apps later as a compatibility layer.

4. Do we expose intent tools in MVP?
   - Recommendation: no. Start with CRUD plus verification, then add intent/layout once the data model is stable.

5. Skill location?
   - Recommendation: add `.agents/skills/excalidraw-codex/SKILL.md`; optionally mirror into `.codex/skills` for this local Desktop setup after testing.

## Best Prompt For The Build

Use the implementation prompt in [`../prompts/build-excalidraw-mcp-for-codex.md`](../prompts/build-excalidraw-mcp-for-codex.md).
