export const DIAGRAM_GUIDE = `Excalidraw MCP drawing guide

Workflow
- Plan the coordinate grid before drawing.
- Call describe_scene before editing an existing scene.
- Prefer stable IDs and update existing elements instead of deleting and recreating.
- Use batch_create_elements for related changes so labels, arrows, and IDs stay coordinated.
- Use create_from_template for common C4, flowchart, swimlane, sequence, ERD, state, data-flow, README hero, and MCP tool map starts.
- Use create_repo_diagram or create_github_readme_assets for repository documentation diagrams.
- Use import_openapi, import_package_dependencies, import_database_schema, import_markdown_outline, import_plantuml, or import_structurizr when source files already describe the diagram.
- Use create_verified_diagram for a high-level first pass that plans/imports, lays out, screenshots, lints, polishes, and exports.
- Use create_from_mermaid only when starting from Mermaid source, then inspect and refine the generated elements.
- Use auto_layout with Dagre, route_arrows, or polish_scene when spacing or routing is not already clean.
- Call set_viewport after layout changes.
- Call get_canvas_screenshot after significant changes and fix visible clipping, overlap, and arrow routing before exporting.

Element format
- Supported types: rectangle, ellipse, diamond, text, arrow, line, frame, image.
- Text-bearing shapes should use label: { "text": "..." }.
- Workspace-local image files should be added with add_image so file data is attached safely.
- Use metadata for semantic roles such as service, database, owner, status, trust-boundary, or documentation-output.
- Titles, annotations, zone labels, and body copy that do not belong to a shape should use standalone text elements.
- Arrow labels are supported with label: { "text": "..." }.
- Use startBinding/endBinding or startElementId/endElementId to bind arrows to shapes.
- Preserve IDs unless the user explicitly asks to regenerate the scene.

Layout quality
- Body font size should be at least 16.
- Heading font size should be at least 20.
- Use Dagre for graph layers, dependency maps, source imports, and larger diagrams.
- Keep text bounds generous; avoid tight boxes around labels.
- Use rectangles or cards for text-bearing blocks.
- Do not put centered labels on huge background zones.
- Avoid arrows through unrelated elements.
- Use elbowed or waypoint arrows around obstacles.
- Use arrow labels sparingly and only when they clarify the relationship.
- Use named canvas sessions when working on several diagrams in one repo.

Color guidance
- Use high-contrast text and strokes.
- Keep fills subtle for process diagrams.
- Use color to group meaning, status, or ownership; avoid coloring everything differently.

Verification
- describe_scene catches missing elements and rough bounds.
- get_canvas_screenshot is the source of truth for visual polish.
- Screenshot and image export can start a managed headless canvas when no visible browser is connected.
- Fix clipping, overlap, unreadable labels, cramped arrows, and hidden content before export.
- Generated examples and golden visual checks live under examples/.`;
