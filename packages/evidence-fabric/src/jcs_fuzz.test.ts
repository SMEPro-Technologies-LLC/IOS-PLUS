import { describe, expect, it } from "vitest";
import fc from "fast-check";
import * as ed from "@noble/ed25519";
import { canonicalize } from "json-canonicalize";

const encoder = new TextEncoder();

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

const shuffleObjectKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => shuffleObjectKeys(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const shuffled = [...entries].reverse();
    return Object.fromEntries(shuffled.map(([k, v]) => [k, shuffleObjectKeys(v)]));
  }
  return value;
};

describe("JCS fuzz properties", () => {
  it("canonicalization is deterministic and key-order independent", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (value) => {
        const canonicalA = canonicalize(value);
        const canonicalB = canonicalize(value);
        expect(canonicalA).toBe(canonicalB);

        const shuffled = shuffleObjectKeys(value);
        const canonicalShuffled = canonicalize(shuffled);
        expect(canonicalA).toBe(canonicalShuffled);

        const roundTripped = JSON.parse(JSON.stringify(value));
        const canonicalRoundTrip = canonicalize(roundTripped);
        expect(canonicalA).toBe(canonicalRoundTrip);
      }),
      { numRuns: NUM_RUNS, seed: 530 },
    );
  });

  it("Ed25519 sign/verify succeeds and mutated bytes fail", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), fc.uint8Array({ minLength: 32, maxLength: 32 }), async (value, privateKey) => {
        const message = encoder.encode(canonicalize(value));
        const signature = await ed.signAsync(message, privateKey);
        const publicKey = await ed.getPublicKeyAsync(privateKey);

        await expect(ed.verifyAsync(signature, message, publicKey)).resolves.toBe(true);

        const mutated = new Uint8Array(message);
        const firstByte = mutated[0] ?? 0;
        mutated[0] = firstByte ^ 0x01;

        await expect(ed.verifyAsync(signature, mutated, publicKey)).resolves.toBe(false);
      }),
      { numRuns: NUM_RUNS, seed: 530 },
    );
  });
});
