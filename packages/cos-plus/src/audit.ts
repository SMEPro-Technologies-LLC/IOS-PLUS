import type { Pool, QueryResult } from 'pg';
import type { AuditEvent, AuditQueryOptions } from './types.js';

const AUDIT_TABLE_NAME = 'audit_events';
const AUDIT_ARCHIVE_TABLE_NAME = 'audit_events_archive';
const DEFAULT_RETENTION_DAYS = 2555; // 7 years

export function getAuditTableName(): string {
  return AUDIT_TABLE_NAME;
}

export function getAuditArchiveTableName(): string {
  return AUDIT_ARCHIVE_TABLE_NAME;
}

export async function createAuditTable(pool: Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE_NAME} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      old_data JSONB,
      new_data JSONB,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      correlation_id TEXT
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON ${AUDIT_TABLE_NAME}(created_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_table_name ON ${AUDIT_TABLE_NAME}(table_name);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON ${AUDIT_TABLE_NAME}(actor);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_correlation_id ON ${AUDIT_TABLE_NAME}(correlation_id);
  `);
}

export async function createAuditArchiveTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AUDIT_ARCHIVE_TABLE_NAME} (
      id UUID PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      old_data JSONB,
      new_data JSONB,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL,
      correlation_id TEXT,
      archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function insertAuditEvent(pool: Pool, event: AuditEvent): Promise<QueryResult> {
  const sql = `
    INSERT INTO ${AUDIT_TABLE_NAME} (actor, action, table_name, record_id, old_data, new_data, metadata, created_at, correlation_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9)
    RETURNING *;
  `;
  const values = [
    event.actor,
    event.action,
    event.table_name,
    event.record_id,
    event.old_data ? JSON.stringify(event.old_data) : null,
    event.new_data ? JSON.stringify(event.new_data) : null,
    event.metadata ? JSON.stringify(event.metadata) : '{}',
    event.created_at ?? null,
    event.correlation_id ?? null,
  ];
  return pool.query(sql, values);
}

export async function getAuditTrail(pool: Pool, options: AuditQueryOptions = {}): Promise<AuditEvent[]> {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (options.table) {
    conditions.push(`table_name = $${paramIndex++}`);
    values.push(options.table);
  }
  if (options.actor) {
    conditions.push(`actor = $${paramIndex++}`);
    values.push(options.actor);
  }
  if (options.action) {
    conditions.push(`action = $${paramIndex++}`);
    values.push(options.action);
  }
  if (options.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(options.endDate);
  }
  if (options.recordId) {
    conditions.push(`record_id = $${paramIndex++}`);
    values.push(options.recordId);
  }
  if (options.correlationId) {
    conditions.push(`correlation_id = $${paramIndex++}`);
    values.push(options.correlationId);
  }

  const orderColumn = options.orderBy ?? 'created_at';
  const orderDirection = options.orderDirection ?? 'DESC';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  const sql = `
    SELECT id, actor, action, table_name, record_id, old_data, new_data, metadata, created_at, correlation_id
    FROM ${AUDIT_TABLE_NAME}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT $${paramIndex++} OFFSET $${paramIndex++};
  `;
  values.push(limit, offset);

  const result = await pool.query(sql, values);
  return result.rows as AuditEvent[];
}

export async function getAuditCount(pool: Pool, options: AuditQueryOptions = {}): Promise<number> {
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (options.table) {
    conditions.push(`table_name = $${paramIndex++}`);
    values.push(options.table);
  }
  if (options.actor) {
    conditions.push(`actor = $${paramIndex++}`);
    values.push(options.actor);
  }
  if (options.action) {
    conditions.push(`action = $${paramIndex++}`);
    values.push(options.action);
  }
  if (options.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(options.endDate);
  }
  if (options.recordId) {
    conditions.push(`record_id = $${paramIndex++}`);
    values.push(options.recordId);
  }
  if (options.correlationId) {
    conditions.push(`correlation_id = $${paramIndex++}`);
    values.push(options.correlationId);
  }

  const sql = `SELECT COUNT(*) FROM ${AUDIT_TABLE_NAME} WHERE ${conditions.join(' AND ')}`;
  const result = await pool.query(sql, values);
  return parseInt(result.rows[0].count as string, 10);
}

export interface WormIntegrityResult {
  tableName: string;
  isCompliant: boolean;
  updateCount: number;
  deleteCount: number;
  details?: string;
}

export async function verifyWormIntegrity(pool: Pool): Promise<WormIntegrityResult[]> {
  const tablesResult = await pool.query(`
    SELECT schemaname, relname
    FROM pg_stat_user_tables
    WHERE relname LIKE '%audit%' OR relname LIKE '%evidence%'
  `);

  const results: WormIntegrityResult[] = [];
  for (const row of tablesResult.rows) {
    const tableName = row.relname as string;
    const statsResult = await pool.query(
      `
        SELECT n_tup_upd, n_tup_del
        FROM pg_stat_user_tables
        WHERE relname = $1
      `,
      [tableName]
    );
    const stats = statsResult.rows[0];
    const updateCount = stats ? (stats.n_tup_upd as number) : 0;
    const deleteCount = stats ? (stats.n_tup_del as number) : 0;

    // Also verify trigger existence
    const triggerResult = await pool.query(
      `
        SELECT COUNT(*) as cnt
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = $1
        AND t.tgname LIKE 'worm_%'
      `,
      [tableName]
    );
    const triggerCount = parseInt(triggerResult.rows[0].cnt as string, 10);

    results.push({
      tableName,
      isCompliant: updateCount === 0 && deleteCount === 0 && triggerCount > 0,
      updateCount,
      deleteCount,
      details: `Triggers: ${triggerCount}, Updates: ${updateCount}, Deletes: ${deleteCount}`,
    });
  }
  return results;
}

export interface AuditRetentionPolicy {
  retentionDays: number;
  archiveBeforePrune: boolean;
  autoPrune: boolean;
}

export function getAuditRetentionPolicy(): AuditRetentionPolicy {
  return {
    retentionDays: DEFAULT_RETENTION_DAYS,
    archiveBeforePrune: true,
    autoPrune: false,
  };
}

export interface PruneResult {
  archivedCount: number;
  deletedCount: number;
  archivedUntil: Date;
}

export async function pruneAuditEvents(pool: Pool, beforeDate: Date): Promise<PruneResult> {
  await createAuditArchiveTable(pool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Temporarily disable WORM trigger to allow archive+delete of expired records
    // This is a controlled exception: only system-level pruning may bypass WORM
    await client.query(`
      ALTER TABLE ${AUDIT_TABLE_NAME} DISABLE TRIGGER worm_${AUDIT_TABLE_NAME};
    `);

    // Archive events before moving to archive table
    const archiveResult = await client.query(
      `
        INSERT INTO ${AUDIT_ARCHIVE_TABLE_NAME}
        (id, actor, action, table_name, record_id, old_data, new_data, metadata, created_at, correlation_id, archived_at)
        SELECT id, actor, action, table_name, record_id, old_data, new_data, metadata, created_at, correlation_id, now()
        FROM ${AUDIT_TABLE_NAME}
        WHERE created_at < $1
        RETURNING id;
      `,
      [beforeDate]
    );
    const archivedCount = archiveResult.rowCount ?? 0;

    // Delete from main table
    const deleteResult = await client.query(
      `
        DELETE FROM ${AUDIT_TABLE_NAME}
        WHERE created_at < $1;
      `,
      [beforeDate]
    );
    const deletedCount = deleteResult.rowCount ?? 0;

    // Re-enable WORM trigger
    await client.query(`
      ALTER TABLE ${AUDIT_TABLE_NAME} ENABLE TRIGGER worm_${AUDIT_TABLE_NAME};
    `);

    // Audit the prune operation itself
    await client.query(
      `
        INSERT INTO ${AUDIT_TABLE_NAME} (actor, action, table_name, record_id, new_data, metadata, created_at)
        VALUES ('system', 'PRUNE', $1, 'batch', $2, $3, now());
      `,
      [
        AUDIT_TABLE_NAME,
        JSON.stringify({ archivedCount, deletedCount, beforeDate: beforeDate.toISOString() }),
        JSON.stringify({ operation: 'prune', archivedUntil: beforeDate.toISOString(), wormBypass: true }),
      ]
    );

    await client.query('COMMIT');
    return { archivedCount, deletedCount, archivedUntil: beforeDate };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
