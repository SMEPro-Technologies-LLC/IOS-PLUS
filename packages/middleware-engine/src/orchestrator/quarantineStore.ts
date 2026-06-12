import type { ExecutionContext, NAICSProfile } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";

export interface ParkedContext {
  ctx: ExecutionContext;
  naicsProfile: NAICSProfile;
  requestHash: string;
  gateResult: Gate530EvaluationResult;
  createdAt: number;
}

/** Internal shape stored in Redis — includes originalTtlMs to support re-park-on-failure. */
export interface StoredContext extends ParkedContext {
  _ttlMs: number;
}

const KEY_PREFIX = "quarantine:";
const DEFAULT_TTL_MS = +(process.env["QUARANTINE_TTL_MS"] ?? String(24 * 60 * 60 * 1000));

/**
 * Structured error thrown when the Redis-backed QuarantineStore is unreachable.
 * Transport layer maps this to a 503 with a structured JSON body.
 */
export class QuarantineStoreError extends Error {
  public readonly originalError: unknown;
  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = "QuarantineStoreError";
    this.originalError = originalError;
  }
}

/**
 * Minimal ioredis-compatible interface for injectable fakes/mocks in tests.
 * The real Redis client satisfies this interface.
 */
export interface RedisQuarantineClient {
  set(key: string, value: string, expiryMode: "PX", time: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
  getdel(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  scan(
    cursor: string,
    matchOption: "MATCH",
    match: string,
    countOption: "COUNT",
    count: number
  ): Promise<[string, string[]]>;
}

/**
 * Redis-backed QuarantineStore.
 *
 * Failure semantics on resumePipeline error:
 *   If the pipeline throws after a successful claim(), the caller (transport layer)
 *   SHOULD call park() again with the original context and its remaining TTL so
 *   the verdict can be retried. Use parked._ttlMs and parked.createdAt to compute
 *   the remaining TTL: Math.max(0, parked.createdAt + parked._ttlMs - Date.now()).
 *
 * All methods throw QuarantineStoreError if Redis is unreachable (fail-closed).
 */
export class QuarantineStore {
  constructor(private readonly redis: RedisQuarantineClient) {}

  /**
   * Parks a context under key `quarantine:<id>` with a native Redis TTL.
   * Throws QuarantineStoreError if Redis is unreachable.
   */
  async park(quarantineId: string, parked: ParkedContext, ttlMs = DEFAULT_TTL_MS): Promise<void> {
    const key = `${KEY_PREFIX}${quarantineId}`;
    const stored: StoredContext = { ...parked, _ttlMs: ttlMs };
    try {
      await this.redis.set(key, JSON.stringify(stored), "PX", ttlMs);
    } catch (err) {
      throw new QuarantineStoreError(`QuarantineStore.park failed for ${quarantineId}`, err);
    }
  }

  /**
   * Non-destructive read; returns the context without removing it.
   * Returns undefined if not found. Throws QuarantineStoreError if Redis is unreachable.
   */
  async retrieve(quarantineId: string): Promise<ParkedContext | undefined> {
    const key = `${KEY_PREFIX}${quarantineId}`;
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return undefined;
      return JSON.parse(raw) as StoredContext;
    } catch (err) {
      throw new QuarantineStoreError(`QuarantineStore.retrieve failed for ${quarantineId}`, err);
    }
  }

  /**
   * Atomically claims (retrieves AND removes) a parked context using Redis GETDEL.
   * Exactly one concurrent caller will receive the context; the rest receive null.
   * Returns null if the context was already claimed or has expired.
   * Throws QuarantineStoreError if Redis is unreachable.
   *
   * On pipeline failure after a successful claim, re-park with remaining TTL:
   *   const remaining = Math.max(1000, parked.createdAt + parked._ttlMs - Date.now());
   *   await quarantineStore.park(id, parked, remaining);
   */
  async claim(quarantineId: string): Promise<StoredContext | null> {
    const key = `${KEY_PREFIX}${quarantineId}`;
    let raw: string | null;
    try {
      raw = await this.redis.getdel(key);
    } catch (err) {
      throw new QuarantineStoreError(`QuarantineStore.claim failed for ${quarantineId}`, err);
    }
    if (raw === null) return null;
    return JSON.parse(raw) as StoredContext;
  }

  /**
   * Explicitly removes a key. Idempotent (no-op if key absent).
   * Throws QuarantineStoreError if Redis is unreachable.
   */
  async remove(quarantineId: string): Promise<void> {
    const key = `${KEY_PREFIX}${quarantineId}`;
    try {
      await this.redis.del(key);
    } catch (err) {
      throw new QuarantineStoreError(`QuarantineStore.remove failed for ${quarantineId}`, err);
    }
  }

  /**
   * Lists all quarantine IDs using SCAN (never KEYS) to avoid blocking Redis.
   * Throws QuarantineStoreError if Redis is unreachable.
   */
  async list(): Promise<string[]> {
    const ids: string[] = [];
    let cursor = "0";
    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", 100);
        cursor = nextCursor;
        for (const k of keys) {
          ids.push(k.slice(KEY_PREFIX.length));
        }
      } while (cursor !== "0");
    } catch (err) {
      if (err instanceof QuarantineStoreError) throw err;
      throw new QuarantineStoreError("QuarantineStore.list failed", err);
    }
    return ids;
  }
}

/**
 * Module-level singleton backed by the process Redis URL.
 * Tests mock "ioredis" at the module level so this uses the injected mock.
 */
import { Redis } from "ioredis";

const _redisUrl = process.env["REDIS_URL"] ?? "redis://redis:6379";
const _redisClient = new Redis(_redisUrl, {
  maxRetriesPerRequest: 0,
  connectTimeout: 2000,
  lazyConnect: true,
});

export const quarantineStore = new QuarantineStore(_redisClient);
