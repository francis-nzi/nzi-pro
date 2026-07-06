# CHARTS.md — Chart Architecture Contract

**Read this before touching ANY chart, graph, or report visual in this repository.**
This applies to human developers and to AI coding agents (Claude Code, Codex, etc.) equally.

## The one rule

> Every chart, on every surface, is rendered by a component in
> `frontend/src/components/report-widgets/` — the single source of truth —
> fed by data, never by copied code.

Background: as of July 2026 this codebase contained eight parallel implementations
of the same charts (inline Recharts copies, matplotlib, captured PNGs, a second
Recharts major in the Portal). Every "fix" to one copy silently diverged the others,
causing weeks of visual regressions. The full diagnosis and migration plan are in
`NZI_Pro_Chart_Architecture_Review.docx`.

## Hard rules

1. **Never import `recharts` outside `frontend/src/components/report-widgets/`.**
   An ESLint rule (`frontend/eslint.config.mjs`, "Chart architecture guard") enforces
   this. A grandfathered list of legacy files exists; it must only shrink. If you need
   a chart somewhere, import the widget; if no widget fits, extend or add one in
   report-widgets.

2. **Never hardcode chart or brand colours.** Use the tokens in
   `frontend/src/lib/chart-colors.ts` / `chart-tokens.ts`. Do not create new local
   `SCOPE_COLORS`-style constants in components. (`#F26624` inline styles in the
   Portal are legacy — do not add more.)

3. **Never add a new chart rendering technology.** No matplotlib charts, no new
   chart libraries, no hand-drawn SVG/canvas charts. PDF output renders the same
   React widgets via Playwright printing `/jobs/{id}/report-live?print=1`.

4. **Snapshot data, not pixels.** If a surface needs a frozen view of a report
   (Portal publishing, report versions), freeze the input JSON and re-render it with
   the shared widgets. Do not screenshot charts into PNGs and store them.
   (The legacy `job_widget_pngs` capture pipeline is being retired — do not extend it.)

5. **Do not change chart appearance without updating goldens.** Golden-image tests
   pin the canonical appearance of every widget. If your change alters how a chart
   looks, that must be deliberate, and you must regenerate goldens in the same commit.

## Golden-image visual tests

- Canonical rendering lives at **`/dev/chart-gallery`** (fixture data only —
  never add API calls or live data to that page).
- Fixture data: `frontend/src/lib/chart-fixtures.ts`. Changing fixture values
  invalidates goldens — only do so deliberately.
- Run the tests:
  ```bash
  cd frontend
  npm install                     # first time: installs @playwright/test
  npx playwright install chromium # first time only
  npm run test:visual             # compare against goldens
  npm run test:visual:update      # regenerate goldens (DELIBERATE changes only)
  ```
- The first ever run of `test:visual:update` creates the initial goldens in
  `frontend/tests/visual/chart-golden.spec.ts-snapshots/`. Commit them.
- **A failing visual test is a regression, not an inconvenience.** Never "fix" a
  failing visual test by blindly updating goldens; first confirm the change was
  intended.

## Where things live

| Concern | Location |
|---|---|
| Chart components (source of truth) | `frontend/src/components/report-widgets/` |
| Widget IDs | `report-widgets/registry.ts` (`REPORT_WIDGET_IDS`) |
| Colour tokens | `frontend/src/lib/chart-colors.ts`, `chart-tokens.ts` |
| Fixture data | `frontend/src/lib/chart-fixtures.ts` |
| Gallery page | `frontend/src/app/dev/chart-gallery/page.tsx` |
| Visual tests | `frontend/tests/visual/chart-golden.spec.ts` |
| PDF engine | Playwright only (`services/playwright_browser.py`; DocRaptor was removed July 2026) |

## Direction of travel (do not fight it)

The migration plan (see `NZI_Pro_Chart_Architecture_Review.docx`) is:
report-widgets becomes a shared `packages/nzi-charts` workspace package consumed by
both `frontend/` and `portal/`; the Portal upgrades to the same React/Next/Recharts
majors; the PNG capture pipeline and matplotlib chart generation are deleted.
Work with this direction: fold legacy inline charts into report-widgets when you
touch them; never create new parallel implementations.
