import type { Pool } from 'pg';

export interface InvariantCheckResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

export async function checkTableExists(pool: Pool, tableName: string): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = $1
      ) as exists;
    `,
    [tableName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `table_exists_${tableName}`,
    passed: exists,
    message: exists ? `Table ${tableName} exists.` : `Table ${tableName} does not exist.`,
  };
}

export async function checkColumnExists(
  pool: Pool,
  tableName: string,
  columnName: string
): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) as exists;
    `,
    [tableName, columnName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `column_exists_${tableName}.${columnName}`,
    passed: exists,
    message: exists
      ? `Column ${columnName} exists on ${tableName}.`
      : `Column ${columnName} does not exist on ${tableName}.`,
  };
}

export async function checkConstraintExists(
  pool: Pool,
  tableName: string,
  constraintName: string
): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = $1 AND constraint_name = $2
      ) as exists;
    `,
    [tableName, constraintName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `constraint_exists_${tableName}.${constraintName}`,
    passed: exists,
    message: exists
      ? `Constraint ${constraintName} exists on ${tableName}.`
      : `Constraint ${constraintName} does not exist on ${tableName}.`,
  };
}

export async function checkTriggerExists(
  pool: Pool,
  tableName: string,
  triggerName: string
): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND t.tgname = $2
      ) as exists;
    `,
    [tableName, triggerName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `trigger_exists_${tableName}.${triggerName}`,
    passed: exists,
    message: exists
      ? `Trigger ${triggerName} exists on ${tableName}.`
      : `Trigger ${triggerName} does not exist on ${tableName}.`,
  };
}

export async function checkIndexExists(
  pool: Pool,
  tableName: string,
  indexName: string
): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2
      ) as exists;
    `,
    [tableName, indexName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `index_exists_${tableName}.${indexName}`,
    passed: exists,
    message: exists
      ? `Index ${indexName} exists on ${tableName}.`
      : `Index ${indexName} does not exist on ${tableName}.`,
  };
}

export async function checkExtensionExists(pool: Pool, extensionName: string): Promise<InvariantCheckResult> {
  const result = await pool.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = $1
      ) as exists;
    `,
    [extensionName]
  );
  const exists = result.rows[0].exists as boolean;
  return {
    name: `extension_exists_${extensionName}`,
    passed: exists,
    message: exists
      ? `Extension ${extensionName} is installed.`
      : `Extension ${extensionName} is not installed.`,
  };
}

export interface InvariantReport {
  allPassed: boolean;
  checks: InvariantCheckResult[];
  timestamp: Date;
}

export async function verifyInvariants(pool: Pool): Promise<InvariantReport> {
  const checks: InvariantCheckResult[] = [];

  // Required tables for compliance OS
  const requiredTables = ['audit_events', 'evidence_records', 'schema_migrations'];
  for (const table of requiredTables) {
    checks.push(await checkTableExists(pool, table));
  }

  // Required extensions
  checks.push(await checkExtensionExists(pool, 'vector'));
  checks.push(await checkExtensionExists(pool, 'pgcrypto'));
  checks.push(await checkExtensionExists(pool, 'uuid-ossp'));

  // Audit table columns
  const auditColumns = ['id', 'actor', 'action', 'table_name', 'record_id', 'old_data', 'new_data', 'metadata', 'created_at', 'correlation_id'];
  for (const col of auditColumns) {
    checks.push(await checkColumnExists(pool, 'audit_events', col));
  }

  // Evidence table columns
  const evidenceColumns = ['id', 'request_id', 'record_type', 'content', 'hash', 'previous_hash', 'created_at', 'created_by', 'metadata'];
  for (const col of evidenceColumns) {
    checks.push(await checkColumnExists(pool, 'evidence_records', col));
  }

  // WORM triggers on audit and evidence tables
  const wormTables = ['audit_events', 'evidence_records'];
  for (const table of wormTables) {
    checks.push(await checkTriggerExists(pool, table, `worm_${table}`));
  }

  // Required indexes
  checks.push(await checkIndexExists(pool, 'audit_events', 'idx_audit_created_at'));
  checks.push(await checkIndexExists(pool, 'audit_events', 'idx_audit_table_name'));
  checks.push(await checkIndexExists(pool, 'evidence_records', 'idx_evidence_request_id'));
  checks.push(await checkIndexExists(pool, 'evidence_records', 'idx_evidence_created_at'));

  const allPassed = checks.every((c) => c.passed);
  return { allPassed, checks, timestamp: new Date() };
}

export class InvariantVerifier {
  private pool: Pool;
  private customChecks: Array<(pool: Pool) => Promise<InvariantCheckResult>> = [];

  constructor(pool: Pool) {
    this.pool = pool;
  }

  addCustomCheck(check: (pool: Pool) => Promise<InvariantCheckResult>): void {
    this.customChecks.push(check);
  }

  async verify(): Promise<InvariantReport> {
    const report = await verifyInvariants(this.pool);
    for (const check of this.customChecks) {
      const result = await check(this.pool);
      report.checks.push(result);
    }
    report.allPassed = report.checks.every((c) => c.passed);
    return report;
  }

  async verifyAuditTable(): Promise<InvariantCheckResult[]> {
    return [
      await checkTableExists(this.pool, 'audit_events'),
      await checkColumnExists(this.pool, 'audit_events', 'id'),
      await checkColumnExists(this.pool, 'audit_events', 'actor'),
      await checkColumnExists(this.pool, 'audit_events', 'action'),
      await checkColumnExists(this.pool, 'audit_events', 'created_at'),
      await checkTriggerExists(this.pool, 'audit_events', 'worm_audit_events'),
    ];
  }

  async verifyEvidenceTable(): Promise<InvariantCheckResult[]> {
    return [
      await checkTableExists(this.pool, 'evidence_records'),
      await checkColumnExists(this.pool, 'evidence_records', 'id'),
      await checkColumnExists(this.pool, 'evidence_records', 'request_id'),
      await checkColumnExists(this.pool, 'evidence_records', 'hash'),
      await checkColumnExists(this.pool, 'evidence_records', 'previous_hash'),
      await checkTriggerExists(this.pool, 'evidence_records', 'worm_evidence_records'),
    ];
  }
}
