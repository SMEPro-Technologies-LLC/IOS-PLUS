/**
 * @vitest-environment node
 *
 * Unit tests for invariant.ts — verifies that verifyInvariants() and the
 * InvariantVerifier class check the correct schema objects.
 *
 * Uses a mock pool so no live database is required.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  verifyInvariants,
  InvariantVerifier,
  checkTableExists,
  checkColumnExists,
  checkTriggerExists,
  checkIndexExists,
  checkExtensionExists,
} from './invariant.js';
import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Minimal mock pool builder.
// Returns `exists: true` for every query by default.
// Pass `overrides` to make specific queries return false.
// ---------------------------------------------------------------------------
type MockRow = { exists: boolean };

function makeMockPool(allExist = true): Pool {
  const pool = {
    query: vi.fn().mockResolvedValue({
      rows: [{ exists: allExist } satisfies MockRow],
    }),
  } as unknown as Pool;
  return pool;
}

// ---------------------------------------------------------------------------
// checkTableExists
// ---------------------------------------------------------------------------
describe('checkTableExists', () => {
  it('returns passed=true when table exists', async () => {
    const pool = makeMockPool(true);
    const result = await checkTableExists(pool, 'audit_events');
    expect(result.passed).toBe(true);
    expect(result.name).toBe('table_exists_audit_events');
  });

  it('returns passed=false when table is absent', async () => {
    const pool = makeMockPool(false);
    const result = await checkTableExists(pool, 'missing_table');
    expect(result.passed).toBe(false);
    expect(result.message).toMatch(/does not exist/);
  });
});

// ---------------------------------------------------------------------------
// checkColumnExists
// ---------------------------------------------------------------------------
describe('checkColumnExists', () => {
  it('returns passed=true when column exists', async () => {
    const pool = makeMockPool(true);
    const result = await checkColumnExists(pool, 'audit_events', 'actor_id');
    expect(result.passed).toBe(true);
    expect(result.name).toBe('column_exists_audit_events.actor_id');
  });

  it('returns passed=false for a stale column name', async () => {
    const pool = makeMockPool(false);
    // Old column name that should NOT exist
    const result = await checkColumnExists(pool, 'audit_events', 'actor');
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkTriggerExists — correct trigger names
// ---------------------------------------------------------------------------
describe('checkTriggerExists', () => {
  it('accepts the real WORM trigger name for audit_events', async () => {
    const pool = makeMockPool(true);
    const result = await checkTriggerExists(pool, 'audit_events', 'trg_audit_events_worm');
    expect(result.passed).toBe(true);
  });

  it('accepts the real WORM trigger name for evidence_records', async () => {
    const pool = makeMockPool(true);
    const result = await checkTriggerExists(pool, 'evidence_records', 'trg_evidence_records_worm');
    expect(result.passed).toBe(true);
  });

  it('reports the stale worm_audit_events name as missing', async () => {
    const pool = makeMockPool(false);
    const result = await checkTriggerExists(pool, 'audit_events', 'worm_audit_events');
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkIndexExists — correct index names
// ---------------------------------------------------------------------------
describe('checkIndexExists', () => {
  it('accepts the real index name idx_audit_events_timestamp', async () => {
    const pool = makeMockPool(true);
    const result = await checkIndexExists(pool, 'audit_events', 'idx_audit_events_timestamp');
    expect(result.passed).toBe(true);
  });

  it('accepts the real index name idx_audit_events_table_name', async () => {
    const pool = makeMockPool(true);
    const result = await checkIndexExists(pool, 'audit_events', 'idx_audit_events_table_name');
    expect(result.passed).toBe(true);
  });

  it('accepts idx_evidence_records_request_id', async () => {
    const pool = makeMockPool(true);
    const result = await checkIndexExists(pool, 'evidence_records', 'idx_evidence_records_request_id');
    expect(result.passed).toBe(true);
  });

  it('reports stale idx_audit_created_at as missing', async () => {
    const pool = makeMockPool(false);
    const result = await checkIndexExists(pool, 'audit_events', 'idx_audit_created_at');
    expect(result.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkExtensionExists
// ---------------------------------------------------------------------------
describe('checkExtensionExists', () => {
  it('checks for vector extension', async () => {
    const pool = makeMockPool(true);
    const result = await checkExtensionExists(pool, 'vector');
    expect(result.passed).toBe(true);
    expect(result.name).toBe('extension_exists_vector');
  });
});

// ---------------------------------------------------------------------------
// verifyInvariants — full report
// ---------------------------------------------------------------------------
describe('verifyInvariants', () => {
  it('returns allPassed=true when every check succeeds', async () => {
    const pool = makeMockPool(true);
    const report = await verifyInvariants(pool);
    expect(report.allPassed).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.timestamp).toBeInstanceOf(Date);
  });

  it('returns allPassed=false when any check fails', async () => {
    const pool = makeMockPool(false);
    const report = await verifyInvariants(pool);
    expect(report.allPassed).toBe(false);
  });

  it('checks the correct audit_events columns (actor_id, operation, not actor/action)', async () => {
    const pool = makeMockPool(true);
    await verifyInvariants(pool);

    // Collect all query parameter arrays from mock calls
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string[]]>;
    const checkedColumns = calls
      .filter(([, params]) => params && params[0] === 'audit_events')
      .flatMap(([, params]) => (params[1] ? [params[1]] : []));

    expect(checkedColumns).toContain('actor_id');
    expect(checkedColumns).toContain('operation');
    expect(checkedColumns).not.toContain('actor');
    expect(checkedColumns).not.toContain('action');
    expect(checkedColumns).not.toContain('correlation_id');
  });

  it('checks the correct evidence_records columns (decision, signature, canonical_payload)', async () => {
    const pool = makeMockPool(true);
    await verifyInvariants(pool);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string[]]>;
    const checkedColumns = calls
      .filter(([, params]) => params && params[0] === 'evidence_records')
      .flatMap(([, params]) => (params[1] ? [params[1]] : []));

    expect(checkedColumns).toContain('decision');
    expect(checkedColumns).toContain('signature');
    expect(checkedColumns).toContain('canonical_payload');
    expect(checkedColumns).not.toContain('hash');
    expect(checkedColumns).not.toContain('record_type');
    expect(checkedColumns).not.toContain('content');
    expect(checkedColumns).not.toContain('created_by');
  });

  it('checks the real WORM trigger names (trg_*_worm)', async () => {
    const pool = makeMockPool(true);
    await verifyInvariants(pool);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string[]]>;
    const checkedTriggers = calls
      .filter(([sql]) => sql.includes('pg_trigger'))
      .flatMap(([, params]) => (params ? params : []));

    expect(checkedTriggers).toContain('trg_audit_events_worm');
    expect(checkedTriggers).toContain('trg_evidence_records_worm');
    expect(checkedTriggers).not.toContain('worm_audit_events');
    expect(checkedTriggers).not.toContain('worm_evidence_records');
  });

  it('checks the real index names (idx_audit_events_*, idx_evidence_records_*)', async () => {
    const pool = makeMockPool(true);
    await verifyInvariants(pool);

    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string[]]>;
    const checkedIndexes = calls
      .filter(([sql]) => sql.includes('pg_indexes'))
      .flatMap(([, params]) => (params ? [params[1]] : []));

    expect(checkedIndexes).toContain('idx_audit_events_timestamp');
    expect(checkedIndexes).toContain('idx_audit_events_table_name');
    expect(checkedIndexes).toContain('idx_evidence_records_request_id');
    expect(checkedIndexes).toContain('idx_evidence_records_timestamp');
    expect(checkedIndexes).not.toContain('idx_audit_created_at');
    expect(checkedIndexes).not.toContain('idx_audit_table_name');
  });
});

// ---------------------------------------------------------------------------
// InvariantVerifier class
// ---------------------------------------------------------------------------
describe('InvariantVerifier', () => {
  it('verify() delegates to verifyInvariants and applies custom checks', async () => {
    const pool = makeMockPool(true);
    const verifier = new InvariantVerifier(pool);

    const customCheck = vi.fn().mockResolvedValue({
      name: 'custom_check',
      passed: true,
      message: 'custom passed',
    });
    verifier.addCustomCheck(customCheck);

    const report = await verifier.verify();
    expect(customCheck).toHaveBeenCalledWith(pool);
    expect(report.checks.some((c) => c.name === 'custom_check')).toBe(true);
    expect(report.allPassed).toBe(true);
  });

  it('verifyAuditTable() uses real column and trigger names', async () => {
    const pool = makeMockPool(true);
    const verifier = new InvariantVerifier(pool);
    const results = await verifier.verifyAuditTable();

    const names = results.map((r) => r.name);
    expect(names).toContain('column_exists_audit_events.actor_id');
    expect(names).toContain('column_exists_audit_events.operation');
    expect(names).toContain('trigger_exists_audit_events.trg_audit_events_worm');
    expect(names).not.toContain('column_exists_audit_events.actor');
    expect(names).not.toContain('column_exists_audit_events.action');
    expect(names).not.toContain('trigger_exists_audit_events.worm_audit_events');
  });

  it('verifyEvidenceTable() uses real column and trigger names', async () => {
    const pool = makeMockPool(true);
    const verifier = new InvariantVerifier(pool);
    const results = await verifier.verifyEvidenceTable();

    const names = results.map((r) => r.name);
    expect(names).toContain('column_exists_evidence_records.decision');
    expect(names).toContain('column_exists_evidence_records.signature');
    expect(names).toContain('column_exists_evidence_records.canonical_payload');
    expect(names).toContain('trigger_exists_evidence_records.trg_evidence_records_worm');
    expect(names).not.toContain('column_exists_evidence_records.hash');
    expect(names).not.toContain('trigger_exists_evidence_records.worm_evidence_records');
  });

  it('verify() sets allPassed=false if any custom check fails', async () => {
    const pool = makeMockPool(true);
    const verifier = new InvariantVerifier(pool);
    verifier.addCustomCheck(async () => ({
      name: 'failing_check',
      passed: false,
      message: 'intentional failure',
    }));

    const report = await verifier.verify();
    expect(report.allPassed).toBe(false);
  });
});
