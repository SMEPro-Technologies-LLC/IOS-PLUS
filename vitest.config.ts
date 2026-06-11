import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "json-summary", "lcov", "cobertura"],
      reportOnFailure: true,
      clean: false,
      all: true,
      include: [
        "packages/middleware-engine/src/layers/L1_ingestion.ts",
        "packages/middleware-engine/src/layers/L2_semantic.ts",
        "packages/middleware-engine/src/layers/L7_synthesis.ts",
        "packages/middleware-engine/src/orchestrator/pipeline.ts"
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/dist/**"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80
      }
    }
  }
});
