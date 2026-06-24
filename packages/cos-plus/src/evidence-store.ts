import type { Pool, QueryResult } from 'pg';
import type { EvidenceRecord, EvidenceSearchCriteria } from './types.js';
import { insertAuditEvent } from './audit.js';

import { createHash } from 'node:crypto';

const EVIDENCE_TABLE_NAME = 'evidence_records';

export function getEvidenceTableName(): string {
  return EVIDENCE_TABLE_NAME;
}

/**
 * Ensure the evidence_records table exists with the unified schema.
 * In production, the canonical schema is applied by db/migrations/.
 * This function is a safety net for test environments and fresh setups.
 * It does NOT conflict with the migration schema because it only uses
 * CREATE TABLE IF NOT EXISTS with columns that the migration also defines.
 */
export async function createEvidenceTable(pool: Pool): Promise<void> {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${EVIDENCE_TABLE_NAME} (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      request_id        TEXT NOT NULL,
      timestamp         TIMESTAMPTZ NOT NULL DEFAULT now(),
      decision          JSONB NOT NULL DEFAULT '{}',
      signature         BYTEA,
      public_key        BYTEA,
      canonical_payload TEXT,
      previous_hash     TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      record_type       TEXT NOT NULL DEFAULT 'compliance_decision',
      content           JSONB,
      hash              TEXT,
      created_by        TEXT NOT NULL DEFAULT 'system',
      metadata          JSONB DEFAULT '{}'
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_evidence_request_id ON ${EVIDENCE_TABLE_NAME}(request_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_evidence_created_at ON ${EVIDENCE_TABLE_NAME}(created_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_evidence_record_type ON ${EVIDENCE_TABLE_NAME}(record_type);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_evidence_created_by ON ${EVIDENCE_TABLE_NAME}(created_by);
  `);
}

/**
 * Compute a SHA-256 hex hash of the record's stable content fields.
 * Used for application-layer chain integrity (cos-plus path).
 */
function computeHash(record: Omit<EvidenceRecord, 'id' | 'created_at' | 'timestamp'>): string {
  const data = JSON.stringify({
    request_id: record.request_id,
    record_type: record.record_type,
    content: record.content ?? record.decision ?? {},
    previous_hash: record.previous_hash ?? null,
    created_by: record.created_by,
  });
  return createHash('sha256').update(data).digest('hex');
}

export async function storeEvidenceRecord(pool: Pool, record: EvidenceRecord): Promise<QueryResult> {
  await createEvidenceTable(pool);

  const expectedHash = computeHash(record);
  if (record.hash && record.hash !== expectedHash) {
    throw new Error('EvidenceRecord hash mismatch: record integrity verification failed.');
  }
  const finalHash = record.hash ?? expectedHash;

  // Use content if provided; fall back to decision for gate-530 records
  const contentValue = record.content ?? record.decision ?? {};

  const sql = `
    INSERT INTO ${EVIDENCE_TABLE_NAME}
      (request_id, record_type, content, hash, previous_hash, created_by, metadata, decision)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *;
  `;
  const values = [
    record.request_id,
    record.record_type,
    JSON.stringify(contentValue),
    finalHash,
    record.previous_hash ?? null,
    record.created_by,
    record.metadata ? JSON.stringify(record.metadata) : '{}',
    JSON.stringify(record.decision ?? contentValue),
  ];

  const result = await pool.query(sql, values);

  await insertAuditEvent(pool, {
    actor: record.created_by,
    action: 'INSERT',
    table_name: EVIDENCE_TABLE_NAME,
    record_id: result.rows[0].id as string,
    new_data: contentValue,
    metadata: { record_type: record.record_type, request_id: record.request_id },
  });

  return result;
}

export async function getEvidenceByRequestId(pool: Pool, requestId: string): Promise<EvidenceRecord[]> {
  await createEvidenceTable(pool);
  const result = await pool.query(
    `
      SELECT id, request_id, timestamp, decision, signature, public_key, canonical_payload,
             previous_hash, created_at, record_type, content, hash, created_by, metadata
      FROM ${EVIDENCE_TABLE_NAME}
      WHERE request_id = $1
      ORDER BY created_at ASC;
    `,
    [requestId]
  );
  return result.rows as EvidenceRecord[];
}

export async function getEvidenceById(pool: Pool, id: string): Promise<EvidenceRecord | null> {
  await createEvidenceTable(pool);
  const result = await pool.query(
    `
      SELECT id, request_id, timestamp, decision, signature, public_key, canonical_payload,
             previous_hash, created_at, record_type, content, hash, created_by, metadata
      FROM ${EVIDENCE_TABLE_NAME}
      WHERE id = $1
      LIMIT 1;
    `,
    [id]
  );
  return (result.rows[0] as EvidenceRecord) ?? null;
}

export interface EvidenceChainResult {
  isValid: boolean;
  records: EvidenceRecord[];
  errors: string[];
}

export async function verifyEvidenceChain(pool: Pool, requestId: string): Promise<EvidenceChainResult> {
  const records = await getEvidenceByRequestId(pool, requestId);
  const errors: string[] = [];

  if (records.length === 0) {
    return { isValid: false, records: [], errors: ['No evidence records found for requestId'] };
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const expectedHash = computeHash(record);
    if (record.hash && record.hash !== expectedHash) {
      errors.push(`Hash mismatch at record ${record.id}: expected ${expectedHash}, got ${record.hash}`);
    }

    if (i > 0) {
      const prevRecord = records[i - 1];
      if (prevRecord.hash && record.previous_hash !== prevRecord.hash) {
        errors.push(
          `Chain break at record ${record.id}: previous_hash ${record.previous_hash} does not match previous record hash ${prevRecord.hash}`
        );
      }
    }
  }

  return { isValid: errors.length === 0, records, errors };
}

export async function searchEvidence(pool: Pool, criteria: EvidenceSearchCriteria): Promise<EvidenceRecord[]> {
  await createEvidenceTable(pool);

  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (criteria.requestId) {
    conditions.push(`request_id = $${paramIndex++}`);
    values.push(criteria.requestId);
  }
  if (criteria.recordType) {
    conditions.push(`record_type = $${paramIndex++}`);
    values.push(criteria.recordType);
  }
  if (criteria.createdBy) {
    conditions.push(`created_by = $${paramIndex++}`);
    values.push(criteria.createdBy);
  }
  if (criteria.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(criteria.startDate);
  }
  if (criteria.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(criteria.endDate);
  }

  const limit = criteria.limit ?? 100;
  const offset = criteria.offset ?? 0;

  const sql = `
    SELECT id, request_id, timestamp, decision, signature, public_key, canonical_payload,
           previous_hash, created_at, record_type, content, hash, created_by, metadata
    FROM ${EVIDENCE_TABLE_NAME}
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++};
  `;
  values.push(limit, offset);

  const result = await pool.query(sql, values);
  return result.rows as EvidenceRecord[];
}

export async function searchEvidenceCount(pool: Pool, criteria: EvidenceSearchCriteria): Promise<number> {
  await createEvidenceTable(pool);

  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (criteria.requestId) {
    conditions.push(`request_id = $${paramIndex++}`);
    values.push(criteria.requestId);
  }
  if (criteria.recordType) {
    conditions.push(`record_type = $${paramIndex++}`);
    values.push(criteria.recordType);
  }
  if (criteria.createdBy) {
    conditions.push(`created_by = $${paramIndex++}`);
    values.push(criteria.createdBy);
  }
  if (criteria.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(criteria.startDate);
  }
  if (criteria.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(criteria.endDate);
  }

  const sql = `SELECT COUNT(*) FROM ${EVIDENCE_TABLE_NAME} WHERE ${conditions.join(' AND ')}`;
  const result = await pool.query(sql, values);
  return parseInt(result.rows[0].count as string, 10);
}

