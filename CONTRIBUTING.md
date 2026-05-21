# Contributing

Thanks for improving Excalidraw MCP for Codex.

## Local Setup

```powershell
npm ci
npm run build
npm run setup:codex
```

## Development Loop

Use focused changes and verify the behavior from both the MCP side and the browser side:

```powershell
npm run typecheck
npm test
npm run test:e2e
```

When editing examples or visual behavior, regenerate the gallery:

```powershell
npm run examples:generate
```

For layout or synchronization work, run the large-scene benchmark:

```powershell
npm run bench:scenes
```

## Pull Request Expectations

- Keep user-facing tool schemas backward-compatible when possible.
- Add tests for new MCP tools, importers, security checks, and rendering behavior.
- Keep file reads/writes restricted to the workspace unless the user explicitly configures otherwise.
- Do not log tokens, bearer secrets, collab room keys, or secret URLs.
- Include screenshots or regenerated gallery assets for visual changes.
- Update the Codex skill and cheatsheet when agent workflow changes.

## Diagram Quality

New diagram-producing tools should support the same loop:

```text
plan -> create/import -> layout -> screenshot -> lint -> polish -> export
```

Prefer stable IDs, bound labels, arrow bindings, and lower-level editability over one-shot image generation.
