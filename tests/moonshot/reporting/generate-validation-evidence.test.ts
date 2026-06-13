import { describe, expect, it } from "vitest";

const {
  buildDimensionalEvidence,
  buildTestEvidence,
} = require("../../../scripts/validation/generate-validation-evidence.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("generate-validation-evidence", () => {
  it("marks dimensional run as repository-verified when criteria are met", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dimensional-evidence-"));
    try {
      const summaryPath = path.join(dir, "summary.json");
      fs.writeFileSync(
        summaryPath,
        JSON.stringify({
          metrics: {
            moonshot_dimensional_4xx_total: { values: { count: 12 } },
            moonshot_dimensional_5xx_total: { values: { count: 0 } },
            moonshot_dimensional_socket_total: { values: { count: 0 } },
          },
        }),
      );

      const evidence = buildDimensionalEvidence(summaryPath);
      expect(evidence.repositoryVerifiedViaCiArtifact).toBe(true);
      expect(evidence.tier).toBe("repository-verified-via-ci-artifact");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds explicit test evidence records", () => {
    const evidence = buildTestEvidence({
      section: "3.5",
      claim: "Gate 530 unit tests",
      testCommand: "npm run test --workspace @ios-plus/gate-530 -- src/gate-530.test.ts",
      fuzzRuns: "200",
    });

    expect(evidence.executedInCurrentRun).toBe(true);
    expect(evidence.repositoryVerifiedViaCiArtifact).toBe(true);
    expect(evidence.fuzzRuns).toBe(200);
  });
});
