import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── Chart architecture guard (see CHARTS.md at repository root) ─────────
  // All charts must live in src/components/report-widgets (the single source
  // of truth). Importing recharts anywhere else creates a parallel chart
  // implementation that will drift — this was the root cause of a month of
  // chart regressions. The files in `ignores` are GRANDFATHERED legacy
  // importers: this list must only ever SHRINK as their charts are folded
  // into report-widgets. Never add a file to it.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/report-widgets/**",
      // Grandfathered legacy chart implementations (to be migrated):
      "src/app/insights/InsightsPageClient.tsx",
      "src/components/ClientReporting.tsx",
      "src/components/JobInsights.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "recharts",
              message:
                "Do not import recharts outside src/components/report-widgets. Add or extend a widget in report-widgets instead — parallel chart implementations drift and regress. See CHARTS.md.",
            },
          ],
        },
      ],
    },
  },

  // ── Emissions display formatting guard ──────────────────────────────────
  // All tCO2e values shown to users must go through fmt() or formatTco2e()
  // which apply defensive 2dp pre-rounding before display. Direct .toFixed()
  // calls bypass this and have caused 0.55 → "0.5" type rounding bugs.
  {
    files: [
      "src/components/JobAdvancedReports.tsx",
      "src/components/JobInsights.tsx",
      "src/components/JobIntensityYearOverYear.tsx",
      "src/components/ReportingElements.tsx",
      "src/components/ClientDashboard.tsx",
      "src/components/ClientPathwayCharts.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toFixed']",
          message:
            "Do not use .toFixed() for emissions display. Use fmt() or formatTco2e() which pre-round to 2dp before formatting, preventing IEEE-754 rounding bugs (e.g. 0.55 → '0.5').",
        },
      ],
    },
  },
]);

export default eslintConfig;
