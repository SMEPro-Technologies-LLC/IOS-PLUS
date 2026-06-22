import type { Pool } from 'pg';
import type { PoolConfig, PoolMetrics } from './types.js';

let poolInstance: Pool | null = null;
let poolConfig: PoolConfig | null = null;

const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSSLConfig(
  ssl: PoolConfig['ssl']
): boolean | { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string } {
  if (ssl === true) {
    return { rejectUnauthorized: false };
  }
  if (ssl === false || ssl === undefined) {
    return false;
  }
  return ssl;
}

async function connectWithRetry(
  poolFactory: () => Pool,
  maxRetries: number,
  baseDelayMs: number
): Promise<Pool> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const pool = poolFactory();
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      return pool;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      await pool.end().catch(() => {
        /* ignore cleanup errors */
      });
      if (attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt + Math.random() * 1000;
        await sleep(delay);
      }
    }
  }
  throw new Error(
    `Failed to connect after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`
  );
}

export async function createPool(config: PoolConfig): Promise<Pool> {
  if (poolInstance) {
    throw new Error('Pool already initialized. Use getPool() to access the existing instance.');
  }
  poolConfig = config;

  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const { Pool: PgPool } = await import('pg');
  const poolFactory = (): Pool =>
    new PgPool({
      host: config.host ?? 'localhost',
      port: config.port ?? 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: buildSSLConfig(config.ssl),
      max: config.max ?? 20,
      min: config.min ?? 2,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10000,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    });

  poolInstance = await connectWithRetry(poolFactory, maxRetries, baseDelayMs);
  return poolInstance;
}

export async function createPoolAsync(config: PoolConfig): Promise<Pool> {
  return createPool(config);
}

export function getPool(): Pool {
  if (!poolInstance) {
    throw new Error('Database pool has not been initialized. Call createPool(config) first.');
  }
  return poolInstance;
}

export async function healthCheck(pool?: Pool): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const p = pool ?? getPool();
  const start = Date.now();
  try {
    await p.query('SELECT 1');
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getPoolMetrics(pool?: Pool): PoolMetrics {
  const p = pool ?? getPool();
  const metrics = p as unknown as Record<string, number>;
  return {
    totalCount: metrics.totalCount ?? 0,
    idleCount: metrics.idleCount ?? 0,
    waitingCount: metrics.waitingCount ?? 0,
  };
}

export async function closePool(pool?: Pool): Promise<void> {
  const p = pool ?? poolInstance;
  if (!p) return;
  await p.end();
  if (p === poolInstance) {
    poolInstance = null;
    poolConfig = null;
  }
}

export function getPoolConfig(): PoolConfig | null {
  return poolConfig ? { ...poolConfig } : null;
}
