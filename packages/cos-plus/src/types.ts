export interface AuditEvent {
  id?: string;
  actor: string;
  action: string;
  table_name: string;
  record_id: string;
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  created_at?: Date;
  correlation_id?: string;
}

export interface AuditQueryOptions {
  table?: string;
  actor?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  recordId?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'actor' | 'action';
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Unified evidence record matching the converged evidence_records schema.
 *
 * Fields from the migration-defined schema (gate-530 primary path):
 *   - decision, signature, public_key, canonical_payload, previous_hash
 *
 * Fields added for cos-plus application-layer usage:
 *   - record_type, content, hash, created_by, metadata
 *
 * When inserting via cos-plus, set record_type/content/hash/created_by.
 * When inserting via gate-530, set decision/signature/public_key/canonical_payload.
 * previous_hash is shared between both paths (stored as hex string).
 */
export interface EvidenceRecord {
  id?: string;
  request_id: string;
  timestamp?: Date;
  // Migration-schema crypto fields (gate-530 path)
  decision?: Record<string, unknown>;
  signature?: string | null;
  public_key?: string | null;
  canonical_payload?: string | null;
  // Shared chain field (hex-encoded SHA-256 of previous record)
  previous_hash?: string | null;
  created_at?: Date;
  // cos-plus supplemental fields
  record_type: string;
  content?: Record<string, unknown>;
  hash?: string | null;
  created_by: string;
  metadata?: Record<string, unknown>;
}

export interface EvidenceSearchCriteria {
  requestId?: string;
  recordType?: string;
  createdBy?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface PoolConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean; ca?: string; cert?: string; key?: string };
  max?: number;
  min?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface PoolMetrics {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

