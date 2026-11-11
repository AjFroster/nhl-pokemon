import js from "@eslint/js";
import globals from "globals";

// Game logic must only use the league's seeded random numbers, so that a seed
// always replays the same way. The UI and scripts may use the real clock.
const deterministic = {
  "no-restricted-properties": [
    "error",
    {
      object: "Math",
      property: "random",
      message: "Use the league's seeded rng (src/random.js) so seeds replay exactly.",
    },
    { object: "Date", property: "now", message: "Game logic can't depend on the clock; seeds must replay exactly." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='Date']",
      message: "Game logic can't depend on the clock; seeds must replay exactly.",
    },
  ],
};

export default [
  { ignores: ["dist/", "node_modules/", "playwright-report/", "test-results/", "data/", "docs/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2025, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["src/ui/**", "e2e/**", "board/**", "game/**", "scripts/screenshots.mjs"],
    languageOptions: { globals: { ...globals.browser } },
  },
  { files: ["src/**"], ignores: ["src/ui/**", "src/random.js"], rules: deterministic },
];
