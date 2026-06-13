#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const parseArgs = (argv) => {
  const out = {};
  let i = 2;
  while (i < argv.length) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for argument: ${key}`);
    }
    out[key.slice(2)] = value;
    i += 2;
  }
  return out;
};

const nowIso = () => new Date().toISOString();

const readJson = (filePath) => {
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
};

const metricCount = (summary, metricName) =>
  summary?.metrics?.[metricName]?.values?.count ?? null;

const buildDimensionalEvidence = (summaryPath) => {
  const evidence = {
    section: "3.4",
    claim: "Dimensional strain malformed-input resilience",
    generatedAt: nowIso(),
    tier: "repository-traceable",
    repositoryTraceable: true,
    repositoryVerifiedViaCiArtifact: false,
    executedInCurrentRun: false,
    observed: {
      moonshot_dimensional_4xx_total: null,
      moonshot_dimensional_5xx_total: null,
      moonshot_dimensional_socket_total: null,
    },
    notes: [
      "Set to repository-verified only when a CI run exports and parses k6 dimensional summary.",
    ],
  };

  if (!summaryPath || !fs.existsSync(summaryPath)) {
    evidence.notes.push("k6 dimensional summary was not found.");
    return evidence;
  }

  const summary = readJson(summaryPath);
  const count4xx = metricCount(summary, "moonshot_dimensional_4xx_total");
  const count5xx = metricCount(summary, "moonshot_dimensional_5xx_total");
  const socketCount = metricCount(summary, "moonshot_dimensional_socket_total");
  evidence.executedInCurrentRun = true;
  evidence.observed.moonshot_dimensional_4xx_total = count4xx;
  evidence.observed.moonshot_dimensional_5xx_total = count5xx;
  evidence.observed.moonshot_dimensional_socket_total = socketCount;

  const hasStructuredClientErrors = typeof count4xx === "number" && count4xx > 0;
  const no5xx = typeof count5xx === "number" && count5xx === 0;
  const noSocket = typeof socketCount === "number" && socketCount === 0;

  if (hasStructuredClientErrors && no5xx && noSocket) {
    evidence.tier = "repository-verified-via-ci-artifact";
    evidence.repositoryVerifiedViaCiArtifact = true;
    evidence.notes.push("Observed structured 4xx and zero 5xx/socket errors in executed run.");
  } else {
    evidence.notes.push(
      "Executed run did not satisfy all dimensional-strain criteria for repository-verified status.",
    );
  }

  return evidence;
};

const buildTestEvidence = ({ section, claim, testCommand, fuzzRuns }) => ({
  section,
  claim,
  generatedAt: nowIso(),
  tier: "repository-verified-via-ci-artifact",
  repositoryTraceable: true,
  repositoryVerifiedViaCiArtifact: true,
  executedInCurrentRun: true,
  testCommand,
  fuzzRuns: fuzzRuns ? Number.parseInt(fuzzRuns, 10) : undefined,
  notes: ["This evidence record is emitted only after the referenced test command exits successfully."],
});

const writeEvidence = (outputPath, payload) => {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = () => {
  const args = parseArgs(process.argv);
  const mode = args.mode;
  const output = args.output;

  if (!mode || !output) {
    throw new Error("Usage: --mode <dimensional|test> --output <file> [mode-specific args]");
  }

  if (mode === "dimensional") {
    writeEvidence(output, buildDimensionalEvidence(args.summary));
    return;
  }

  if (mode === "test") {
    if (!args.section || !args.claim || !args["test-command"]) {
      throw new Error("Test mode requires --section, --claim, and --test-command");
    }
    writeEvidence(
      output,
      buildTestEvidence({
        section: args.section,
        claim: args.claim,
        testCommand: args["test-command"],
        fuzzRuns: args["fuzz-runs"],
      }),
    );
    return;
  }

  throw new Error(`Unsupported mode: ${mode}`);
};

if (require.main === module) {
  main();
}

module.exports = {
  buildDimensionalEvidence,
  buildTestEvidence,
};
