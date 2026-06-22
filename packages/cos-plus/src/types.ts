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

export interface AuditRetentionPolicy {
  retentionDays: number;
  archiveBeforePrune: boolean;
  autoPrune: boolean;
}

export interface PruneResult {
  archivedCount: number;
  deletedCount: number;
  archivedUntil: Date;
}

export interface EvidenceRecord {
  id?: string;
  request_id: string;
  record_type: string;
  content: Record<string, unknown>;
  hash: string;
  previous_hash?: string | null;
  created_at?: Date;
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

export interface EvidenceChainResult {
  isValid: boolean;
  records: EvidenceRecord[];
  errors: string[];
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

export interface VectorRecordInput {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  distance: number;
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

export interface GrantRecord {
  role: string;
  privilege: string;
  schema: string;
  table: string;
}

export interface WormStatus {
  tableName: string;
  hasWormTrigger: boolean;
  triggerName: string | null;
  isCompliant: boolean;
}

export interface WormTriggerConfig {
  tableName: string;
  triggerFunctionName: string;
  triggerName: string;
}

export interface InvariantCheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

export interface InvariantReport {
  allPassed: boolean;
  checks: InvariantCheckResult[];
  timestamp: Date;
}

export interface WormIntegrityResult {
  tableName: string;
  isCompliant: boolean;
  updateCount: number;
  deleteCount: number;
  details?: string;
}
