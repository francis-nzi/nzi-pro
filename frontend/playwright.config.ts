import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for golden-image visual tests of the chart library.
 * See CHARTS.md at the repository root.
 *
 * Run:    npm run test:visual
 * Update: npm run test:visual:update   (ONLY for deliberate chart changes)
 */
export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      // Small anti-flake allowance for font antialiasing differences.
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: true,
    // Cold-boot of the dev server can be slow (large app, OneDrive-synced
    // node_modules). If this still times out, start the server yourself in a
    // second terminal (npm run dev -- --port 3100) and re-run the tests —
    // reuseExistingServer will pick it up.
    timeout: 420_000,
  },
});
