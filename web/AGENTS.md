# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Selected prototype direction

- On 2026-07-22, the selected source-of-truth mock established a warm ivory dashboard with forest-green accents, an editorial serif portfolio value, a compact left navigation, a wide daily portfolio chart, a dense holdings table, and a right-side allocation and returns rail.
- Preserve the calm, wealth-management tone, generous whitespace, fine rules, restrained shadows, and data-first hierarchy when extending the prototype.
- Keep portfolio actions explicit and quiet: solid green for the primary add action, text/icon treatments for refresh and secondary actions, and right-side drawers for focused add/edit and transaction workflows.
- On 2026-08-09, benchmark comparison was defined as relative return over the selected period, not a raw Nifty index level plotted against portfolio value; chart tooltips must explain the comparison without overflowing, and date-range controls should use a clear compact segmented state.
- On 2026-08-10, asset allocation treats the INR-listed MAFANG.NS and MONQ50.NS positions as `US Investments`; other INR ETFs are presented as `Commodities` for the current portfolio because those positions are predominantly gold and silver ETFs.
- On 2026-08-17, Gains & losses shows a signed percentage next to each P&L amount: unrealized and realized versus remaining invested cost, total versus the portfolio all-time return.
- On 2026-08-31, Asset allocation shows Commodities as its own slice (gold/silver ETFs, commodity-sector holdings, and other INR ETFs except MAFANG.NS / MONQ50.NS) with the percentage in the legend. The holdings table includes Today % and Today value columns from previous close / day P&L.
- On 2026-09-01, Asset allocation is the three-way split Indian Stocks / Commodities / US Investments. The Commodities percentage is taken from the Sector view so the slice cannot disappear when gold and silver holdings are stored as stocks.
