import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { runL1 } from "./L1_ingestion.js";

const parseFuzzRuns = (): number => {
  const raw = process.env["FUZZ_RUNS"];
  if (!raw) {
    return 200;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 200;
  }
  return parsed;
};

const NUM_RUNS = parseFuzzRuns();
fc.configureGlobal({ numRuns: NUM_RUNS, seed: 530 });

describe("L1 fuzz properties", () => {
  it("runL1 never throws and returns a structured layer result", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), async (tenantId, rawInput) => {
        const result = await runL1({
          requestId: "fuzz-req",
          tenantId,
          sessionId: "fuzz-session",
          rawInput,
          contentType: "application/json",
          metadata: {},
        });

        expect(result.layer).toBe(1);
        expect(typeof result.success).toBe("boolean");
        expect(typeof result.latencyMs).toBe("number");
        expect(typeof result.normalizedInput).toBe("string");

        if (!result.success) {
          expect(typeof result.error).toBe("string");
          expect(result.error && result.error.length > 0).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS, seed: 530 },
    );
  });

  it("NFKC normalization is idempotent for successful results", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (rawInput) => {
        const result = await runL1({
          requestId: "fuzz-req",
          tenantId: "tenant-123",
          sessionId: "fuzz-session",
          rawInput,
          contentType: "application/json",
          metadata: {},
        });

        if (!result.success) {
          return;
        }

        const once = result.normalizedInput;
        const twice = once.normalize("NFKC");
        expect(twice).toBe(once);
      }),
      { numRuns: NUM_RUNS, seed: 530 },
    );
  });

  it("handles lone surrogate and null-byte regression inputs", async () => {
    const loneSurrogate = await runL1({
      requestId: "fuzz-req",
      tenantId: "tenant-123",
      sessionId: "fuzz-session",
      rawInput: "\uD800",
      contentType: "application/json",
      metadata: {},
    });

    const nullByte = await runL1({
      requestId: "fuzz-req",
      tenantId: "tenant-123",
      sessionId: "fuzz-session",
      rawInput: "\u0000",
      contentType: "application/json",
      metadata: {},
    });

    expect(loneSurrogate.layer).toBe(1);
    expect(nullByte.layer).toBe(1);
  });
});
