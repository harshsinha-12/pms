# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Selected prototype direction

- On 2026-07-22, the selected source-of-truth mock established a warm ivory dashboard with forest-green accents, an editorial serif portfolio value, a compact left navigation, a wide daily portfolio chart, a dense holdings table, and a right-side allocation and returns rail.
- Preserve the calm, wealth-management tone, generous whitespace, fine rules, restrained shadows, and data-first hierarchy when extending the prototype.
- Keep portfolio actions explicit and quiet: solid green for the primary add action, text/icon treatments for refresh and secondary actions, and right-side drawers for focused add/edit and transaction workflows.
