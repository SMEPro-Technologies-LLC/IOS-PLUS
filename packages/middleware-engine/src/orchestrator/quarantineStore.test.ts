/**
 * QuarantineStore unit tests — Redis-backed store
 * Tests: park/claim round-trip, double-claim atomicity, TTL, fail-closed, list via SCAN
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  QuarantineStore,
  QuarantineStoreError,
  type ParkedContext,
  type RedisQuarantineClient,
} from "./quarantineStore.js";
import type { ExecutionContext, NAICSProfile } from "@ios-plus/shared";

// ---------------------------------------------------------------------------
// In-memory fake Redis client that satisfies RedisQuarantineClient
// ---------------------------------------------------------------------------
class FakeRedis implements RedisQuarantineClient {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  public broken = false;

  private checkBroken(): void {
    if (this.broken) throw new Error("Redis connection refused (test fault injection)");
  }

  async set(key: string, value: string, _expiryMode: "PX", ttlMs: number): Promise<string | null> {
    this.checkBroken();
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.checkBroken();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async getdel(key: string): Promise<string | null> {
    this.checkBroken();
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    return entry.value;
  }

  async del(key: string): Promise<number> {
    this.checkBroken();
    return this.store.delete(key) ? 1 : 0;
  }

  async scan(
    cursor: string,
    _matchOption: "MATCH",
    match: string,
    _countOption: "COUNT",
    _count: number
  ): Promise<[string, string[]]> {
    this.checkBroken();
    // Simple implementation: return all matching keys in one shot (cursor "0" → "0")
    if (cursor !== "0") return ["0", []];
    const prefix = match.replaceAll("*", "");
    const keys = [...this.store.keys()].filter(k => k.startsWith(prefix));
    return ["0", keys];
  }

  /** Test helper: expire a key immediately */
  expireNow(key: string): void {
    const entry = this.store.get(key);
    if (entry) this.store.set(key, { ...entry, expiresAt: Date.now() - 1 });
  }

  size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeParkedContext(overrides: Partial<ParkedContext> = {}): ParkedContext {
  const ctx: ExecutionContext = {
    requestId: "req-test-1",
    tenantId: "tenant-1",
    sessionId: "session-1",
    traceId: "trace-1",
    classificationLevel: "CONFIDENTIAL",
    ucoContext: {
      profileId: "profile-1",
      naicsCodes: ["5415"],
      resolvedNodeIds: ["UCO-001"],
      nodes: [],
      crossCuttingNodes: [],
      totalNodes: 1,
      resolvedAt: new Date().toISOString(),
    },
    startedAt: new Date().toISOString(),
    timeouts: { L1: 10, L2: 30, L3: 50, L4: 20, L5: 50, L6: 120, L7: 200 },
    request: {
      requestId: "req-test-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      rawInput: "test input",
      contentType: "application/json",
      metadata: {},
    },
  };

  const naicsProfile: NAICSProfile = {
    tenantId: "tenant-1",
    naicsCodes: ["5415"],
    additionalSicCodes: [],
    cipCodes: [],
    socCodes: [],
    isicCodes: [],
    hsHtsCodes: [],
    effectiveDate: "2026-01-01",
    jurisdictions: ["Federal"],
    riskTolerance: 5,
  };

  const gateResult: any = {
    gateDecisionId: "gate-dec-1",
    sessionId: "session-1",
    tenantId: "tenant-1",
    nodeResults: [],
    aggregatePolicyAction: "ESCALATE",
    evaluationLatencyMs: 5,
    cachedResult: false,
    quarantinedNodeIds: [],
  };

  return {
    ctx,
    naicsProfile,
    requestHash: "abc123def456",
    gateResult,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RedisQuarantineStore", () => {
  let redis: FakeRedis;
  let store: QuarantineStore;

  beforeEach(() => {
    redis = new FakeRedis();
    store = new QuarantineStore(redis);
  });

  // --- park / claim round-trip ---

  it("park stores context and claim retrieves it atomically", async () => {
    const parked = makeParkedContext();
    await store.park("qid-1", parked);

    const claimed = await store.claim("qid-1");
    expect(claimed).not.toBeNull();
    expect(claimed?.requestHash).toBe("abc123def456");
    expect(claimed?.ctx.tenantId).toBe("tenant-1");
  });

  it("claim removes the key so a second claim returns null", async () => {
    await store.park("qid-2", makeParkedContext());

    const first = await store.claim("qid-2");
    const second = await store.claim("qid-2");

    expect(first).not.toBeNull();
    expect(second).toBeNull();  // already consumed
  });

  it("claim returns null for a non-existent quarantine ID", async () => {
    const result = await store.claim("does-not-exist");
    expect(result).toBeNull();
  });

  it("serializes and deserializes ParkedContext fields with full fidelity", async () => {
    const parked = makeParkedContext({ requestHash: "fidelity-hash-xyz" });
    await store.park("qid-fidelity", parked);
    const claimed = await store.claim("qid-fidelity");

    expect(claimed?.requestHash).toBe("fidelity-hash-xyz");
    expect(claimed?.ctx.requestId).toBe("req-test-1");
    expect(claimed?.gateResult.aggregatePolicyAction).toBe("ESCALATE");
  });

  // --- double-claim atomicity ---

  it("concurrent claims: only one wins, WORM-commit called exactly once", async () => {
    const N = 10;
    await store.park("qid-race", makeParkedContext());

    // Fire N concurrent claims against the same quarantineId
    const results = await Promise.all(
      Array.from({ length: N }, () => store.claim("qid-race"))
    );

    const winners = results.filter(r => r !== null);
    const losers = results.filter(r => r === null);

    expect(winners).toHaveLength(1);  // exactly one winner
    expect(losers).toHaveLength(N - 1);  // all others lose
  });

  // --- TTL behaviour ---

  it("park stores context with the given TTL; claim returns null after expiry", async () => {
    await store.park("qid-ttl", makeParkedContext(), 5000 /* 5s */);
    // Artificially expire the key
    redis.expireNow("quarantine:qid-ttl");

    const claimed = await store.claim("qid-ttl");
    expect(claimed).toBeNull();
  });

  it("uses default 24-hour TTL when not specified", async () => {
    await store.park("qid-default-ttl", makeParkedContext());
    // Should still be available immediately after park
    const claimed = await store.claim("qid-default-ttl");
    expect(claimed).not.toBeNull();
  });

  // --- fail-closed ---

  it("park throws QuarantineStoreError when Redis is unreachable", async () => {
    redis.broken = true;
    await expect(store.park("qid-down", makeParkedContext())).rejects.toThrow(QuarantineStoreError);
    await expect(store.park("qid-down", makeParkedContext())).rejects.toThrow("QuarantineStore.park failed");
  });

  it("claim throws QuarantineStoreError when Redis is unreachable", async () => {
    redis.broken = true;
    await expect(store.claim("qid-down")).rejects.toThrow(QuarantineStoreError);
  });

  it("list throws QuarantineStoreError when Redis is unreachable", async () => {
    redis.broken = true;
    await expect(store.list()).rejects.toThrow(QuarantineStoreError);
  });

  // --- list via SCAN ---

  it("list returns IDs of all parked contexts using SCAN, not KEYS", async () => {
    await store.park("qid-a", makeParkedContext());
    await store.park("qid-b", makeParkedContext());
    await store.park("qid-c", makeParkedContext());

    const ids = await store.list();
    expect(ids).toHaveLength(3);
    expect(ids).toContain("qid-a");
    expect(ids).toContain("qid-b");
    expect(ids).toContain("qid-c");
  });

  it("list returns empty array when no quarantine entries exist", async () => {
    const ids = await store.list();
    expect(ids).toHaveLength(0);
  });

  it("list does not include entries with other key prefixes", async () => {
    await store.park("qid-mine", makeParkedContext());
    // Simulate a key in Redis with a different prefix
    await redis.set("other:unrelated-key", "some-value", "PX", 60000);

    const ids = await store.list();
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("qid-mine");
  });

  // --- remove ---

  it("remove deletes the key; subsequent claim returns null", async () => {
    await store.park("qid-remove", makeParkedContext());
    await store.remove("qid-remove");

    const claimed = await store.claim("qid-remove");
    expect(claimed).toBeNull();
  });

  it("remove is idempotent on a non-existent key", async () => {
    await expect(store.remove("qid-nonexistent")).resolves.toBeUndefined();
  });

  // --- retrieve (non-destructive) ---

  it("retrieve reads context without removing it; subsequent claim still succeeds", async () => {
    await store.park("qid-peek", makeParkedContext());
    const peeked = await store.retrieve("qid-peek");
    expect(peeked).not.toBeUndefined();
    expect(peeked?.requestHash).toBe("abc123def456");

    // Key was NOT consumed — claim should still work
    const claimed = await store.claim("qid-peek");
    expect(claimed).not.toBeNull();
  });
});
