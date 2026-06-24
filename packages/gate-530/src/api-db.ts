/**
 * Wave 1 MVP — Database Layer
 * PostgreSQL connection pool with evidence and audit persistence
 * @module api-db
 */

import pg from 'pg';
const { Pool } = pg;
import type { DatabaseConfig } from './api-config.js';
import type { ComplianceDecision } from './engine.js';

export interface DbEvidenceRecord {
  id: string;
  requestId: string;
  timestamp: string;
  decision: ComplianceDecision;
  signature: string;
  publicKey: string;
  canonicalPayload: string;
  /** Hex-encoded SHA-256 of previous record (TEXT after migration 003). */
  previousHash?: string;
  /** cos-plus supplemental field; defaults to 'compliance_decision'. */
  recordType?: string;
  /** cos-plus supplemental field; defaults to 'gate-530'. */
  createdBy?: string;
}

export interface DbAuditEvent {
  id: string;
  tableName: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'ACCESS_DENIED' | 'POLICY_VIOLATION';
  recordId: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  actorId?: string;
  actorType?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  timestamp: string;
}

export class ApiDatabase {
  private pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: config.maxConnections,
      connectionTimeoutMillis: config.connectionTimeoutMs,
      idleTimeoutMillis: config.idleTimeoutMs,
    });

    this.pool.on('error', (err) => {
      console.error('[ApiDatabase] Unexpected pool error:', err.message);
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('[ApiDatabase] Connected to PostgreSQL');
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        return { healthy: true, latencyMs: Date.now() - start };
      } finally {
        client.release();
      }
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async storeEvidence(record: DbEvidenceRecord): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO evidence_records (
          id, request_id, timestamp, decision, signature, public_key, canonical_payload,
          previous_hash, record_type, content, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          record.id,
          record.requestId,
          record.timestamp,
          JSON.stringify(record.decision),
          Buffer.from(record.signature, 'base64'),
          Buffer.from(record.publicKey, 'base64'),
          record.canonicalPayload,
          // previous_hash is now TEXT (hex); store as-is from caller
          record.previousHash ?? null,
          record.recordType ?? 'compliance_decision',
          JSON.stringify(record.decision),
          record.createdBy ?? 'gate-530',
        ]
      );
    } finally {
      client.release();
    }
  }

  async getEvidenceByRequestId(requestId: string): Promise<DbEvidenceRecord | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT id, request_id, timestamp, decision, signature, public_key, canonical_payload,
                previous_hash, record_type, created_by
         FROM evidence_records WHERE request_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [requestId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        requestId: row.request_id,
        timestamp: row.timestamp,
        decision: typeof row.decision === 'string' ? JSON.parse(row.decision) : row.decision,
        signature: row.signature ? Buffer.from(row.signature).toString('base64') : '',
        publicKey: row.public_key ? Buffer.from(row.public_key).toString('base64') : '',
        canonicalPayload: row.canonical_payload ?? '',
        // previous_hash is TEXT (hex) after migration 003
        previousHash: row.previous_hash ?? undefined,
        recordType: row.record_type ?? 'compliance_decision',
        createdBy: row.created_by ?? 'gate-530',
      };
    } finally {
      client.release();
    }
  }

  async storeAuditEvent(event: DbAuditEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO audit_events (
          id, table_name, operation, record_id, old_data, new_data, actor_id, actor_type,
          session_id, ip_address, user_agent, timestamp,
          actor, action
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          event.id,
          event.tableName,
          event.operation,
          event.recordId,
          event.oldData ? JSON.stringify(event.oldData) : null,
          event.newData ? JSON.stringify(event.newData) : null,
          event.actorId ?? null,
          event.actorType ?? null,
          event.sessionId ?? null,
          event.ipAddress ?? null,
          event.userAgent ?? null,
          event.timestamp,
          // Supplemental cos-plus columns for cross-layer query compatibility
          event.actorId ?? null,
          event.operation,
        ]
      );
    } finally {
      client.release();
    }
  }

  async getAuditEvents(filters: {
    actorId?: string;
    operation?: string;
    tableName?: string;
    limit?: number;
    offset?: number;
  }): Promise<DbAuditEvent[]> {
    const client = await this.pool.connect();
    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (filters.actorId) {
        conditions.push(`actor_id = $${paramIndex++}`);
        params.push(filters.actorId);
      }
      if (filters.operation) {
        conditions.push(`operation = $${paramIndex++}`);
        params.push(filters.operation);
      }
      if (filters.tableName) {
        conditions.push(`table_name = $${paramIndex++}`);
        params.push(filters.tableName);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limitClause = filters.limit ? `LIMIT $${paramIndex++}` : '';
      const offsetClause = filters.offset ? `OFFSET $${paramIndex++}` : '';
      if (filters.limit) params.push(filters.limit);
      if (filters.offset) params.push(filters.offset);

      const result = await client.query(
        `SELECT id, table_name, operation, record_id, old_data, new_data, actor_id, actor_type,
                session_id, ip_address, user_agent, timestamp
         FROM audit_events ${whereClause} ORDER BY timestamp DESC ${limitClause} ${offsetClause}`,
        params
      );

      return result.rows.map((row) => ({
        id: row.id,
        tableName: row.table_name,
        operation: row.operation,
        recordId: row.record_id,
        oldData: row.old_data,
        newData: row.new_data,
        actorId: row.actor_id,
        actorType: row.actor_type,
        sessionId: row.session_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        timestamp: row.timestamp,
      }));
    } finally {
      client.release();
    }
  }
}
