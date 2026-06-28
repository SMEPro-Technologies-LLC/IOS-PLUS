/**
 * @vitest-environment node
 *
 * WORM integration tests — verifies that audit_events and evidence_records
 * enforce Write-Once-Read-Many immutability via the triggers defined in
 * db/migrations/002_worm_triggers.sql.
 *
 * These tests require a live PostgreSQL instance with migrations applied.
 * In CI the DATABASE_URL env var is set by the workflow pointing at
 * `iosplus_test` (matches ci.yml: POSTGRES_DB: iosplus_test). Locally, set it
 * before running:
 *   DATABASE_URL=******localhost:5432/iosplus_test \
 *     npm run test --workspace=packages/cos-plus
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env['DATABASE_URL'];

// Skip the whole suite when no live database is available (pure unit-test runs).
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WORM enforcement — audit_events', () => {
  let pool: InstanceType<typeof Pool>;
  let insertedId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // Insert a minimal audit event for use in the mutation tests.
    const result = await pool.query<{ id: string }>(`
      INSERT INTO audit_events
        (table_name, operation, record_id, actor_id, actor_type)
      VALUES
        ('worm_test', 'INSERT', gen_random_uuid(), gen_random_uuid(), 'test')
      RETURNING id
    `);
    insertedId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should allow INSERT into audit_events', () => {
    expect(insertedId).toBeTruthy();
  });

  it('should reject UPDATE on audit_events with WORM_VIOLATION', async () => {
    await expect(
      pool.query(
        `UPDATE audit_events SET actor_type = 'tampered' WHERE id = $1`,
        [insertedId]
      )
    ).rejects.toThrow(/WORM_VIOLATION/);
  });

  it('should reject DELETE on audit_events with WORM_VIOLATION', async () => {
    await expect(
      pool.query(`DELETE FROM audit_events WHERE id = $1`, [insertedId])
    ).rejects.toThrow(/WORM_VIOLATION/);
  });
});

describeIfDb('WORM enforcement — evidence_records', () => {
  let pool: InstanceType<typeof Pool>;
  let insertedId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    // Insert a minimal evidence record.
    const result = await pool.query<{ id: string }>(`
      INSERT INTO evidence_records
        (request_id, decision, signature, public_key, canonical_payload)
      VALUES
        (gen_random_uuid(),
         '{"test":true}'::jsonb,
         '\\x0000'::bytea,
         '\\x0000'::bytea,
         'worm-test-payload')
      RETURNING id
    `);
    insertedId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should allow INSERT into evidence_records', () => {
    expect(insertedId).toBeTruthy();
  });

  it('should reject UPDATE on evidence_records with WORM_VIOLATION', async () => {
    await expect(
      pool.query(
        `UPDATE evidence_records SET canonical_payload = 'tampered' WHERE id = $1`,
        [insertedId]
      )
    ).rejects.toThrow(/WORM_VIOLATION/);
  });

  it('should reject DELETE on evidence_records with WORM_VIOLATION', async () => {
    await expect(
      pool.query(`DELETE FROM evidence_records WHERE id = $1`, [insertedId])
    ).rejects.toThrow(/WORM_VIOLATION/);
  });
});

describeIfDb('WORM enforcement — schema_migrations', () => {
  let pool: InstanceType<typeof Pool>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should reject UPDATE on schema_migrations with WORM_VIOLATION', async () => {
    // Pick any existing migration row.
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM schema_migrations LIMIT 1`
    );
    if (rows.length === 0) {
      // No migrations recorded yet — nothing to test.
      return;
    }

    await expect(
      pool.query(
        `UPDATE schema_migrations SET description = 'tampered' WHERE id = $1`,
        [rows[0].id]
      )
    ).rejects.toThrow(/WORM_VIOLATION/);
  });

  it('should reject DELETE on schema_migrations with WORM_VIOLATION', async () => {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM schema_migrations LIMIT 1`
    );
    if (rows.length === 0) {
      return;
    }

    await expect(
      pool.query(`DELETE FROM schema_migrations WHERE id = $1`, [rows[0].id])
    ).rejects.toThrow(/WORM_VIOLATION/);
  });
});
