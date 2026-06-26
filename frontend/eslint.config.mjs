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
