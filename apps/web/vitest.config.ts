/**
 * Vitest — @roadsen/web
 *
 * Environnement jsdom (composants React, SSR via renderToString).
 * Tests de composants uniquement — les e2e sont dans playwright.config.ts racine.
 *
 * Confidentialité (DoD §8) : aucun import @roadsen/engines ici ou dans les tests.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.tsx", "src/**/*.test.ts", "tests/**/*.test.tsx"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "text"],
      all: true,
      include: ["src/components/**/*.tsx", "src/components/**/*.ts"],
      exclude: ["src/**/*.test.tsx", "src/**/*.test.ts"],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 55,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
