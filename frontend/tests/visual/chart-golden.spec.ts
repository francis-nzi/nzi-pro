import { test, expect } from "@playwright/test";

/**
 * Golden-image tests for the chart library.
 *
 * Each report widget is rendered on /dev/chart-gallery with deterministic
 * fixture data (src/lib/chart-fixtures.ts) and screenshotted. The screenshot
 * is compared against the checked-in golden image in
 * tests/visual/chart-golden.spec.ts-snapshots/.
 *
 * If this test fails, a chart's appearance has changed:
 *   - Unintended? Fix the regression.
 *   - Deliberate?  Re-generate goldens with `npm run test:visual:update`
 *                  and commit the new images alongside the change.
 *
 * See CHARTS.md at the repository root for the full contract.
 */

const WIDGET_IDS = [
  "emissions_scope_donut",
  "emissions_site_donut",
  "emissions_by_activity",
  "historical_emissions_trend",
  "emissions_reduction_pathway",
  "intensity_pathway",
  "scope_year_on_year_bar",
  "scope_category_comparison",
] as const;

test.beforeEach(async ({ page }) => {
  // /dev/ is a public route (no auth required) — AuthBootstrap skips the
  // /auth/me check for paths under /dev/.
  await page.goto("/dev/chart-gallery");
  // Wait for Recharts ResponsiveContainers to measure and paint fully.
  // ResponsiveContainer needs a ResizeObserver tick after initial layout,
  // so we wait until every gallery SVG has a non-zero height.
  await page.waitForFunction(() => {
    const svgs = document.querySelectorAll("[data-gallery-widget] svg");
    if (svgs.length === 0) return false;
    return Array.from(svgs).every(svg => {
      const h = svg.getBoundingClientRect().height;
      return h > 0;
    });
  }, { timeout: 10000 });
  // Extra settle time for paint to complete.
  await page.waitForTimeout(500);
});

for (const widgetId of WIDGET_IDS) {
  test(`golden: ${widgetId}`, async ({ page }) => {
    const widget = page.locator(`[data-gallery-widget="${widgetId}"]`);
    await expect(widget).toBeVisible();
    await expect(widget).toHaveScreenshot(`${widgetId}.png`);
  });
}
