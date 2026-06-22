import type { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const MIGRATION_TABLE_NAME = 'schema_migrations';

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
  checksum: string;
}

export async function createMigrationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE_NAME} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT NOT NULL
    );
  `);
}

function computeChecksum(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function getMigrationStatus(pool: Pool): Promise<MigrationRecord[]> {
  await createMigrationTable(pool);
  const result = await pool.query(`
    SELECT id, name, applied_at, checksum
    FROM ${MIGRATION_TABLE_NAME}
    ORDER BY id ASC;
  `);
  return result.rows as MigrationRecord[];
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<MigrationResult> {
  await createMigrationTable(pool);

  const applied = await getMigrationStatus(pool);
  const appliedNames = new Set(applied.map((m) => m.name));

  const files = await readdir(migrationsDir);
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const result: MigrationResult = { applied: [], skipped: [], failed: [] };

  for (const file of sqlFiles) {
    if (appliedNames.has(file)) {
      result.skipped.push(file);
      continue;
    }

    const filePath = join(migrationsDir, file);
    const content = await readFile(filePath, 'utf-8');
    const checksum = computeChecksum(content);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Execute the migration file as a single query string.
      // PostgreSQL supports multiple semicolon-separated statements in one query.
      await client.query(content);
      await client.query(
        `INSERT INTO ${MIGRATION_TABLE_NAME} (name, checksum) VALUES ($1, $2);`,
        [file, checksum]
      );
      await client.query('COMMIT');
      result.applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      result.failed.push({
        name: file,
        error: err instanceof Error ? err.message : String(err),
      });
      break; // Stop on first failure
    } finally {
      client.release();
    }
  }

  return result;
}

export async function verifyMigrationChecksum(pool: Pool, name: string, expectedChecksum: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT checksum FROM ${MIGRATION_TABLE_NAME} WHERE name = $1;`,
    [name]
  );
  if (result.rows.length === 0) return false;
  return result.rows[0].checksum === expectedChecksum;
}

export async function getPendingMigrations(pool: Pool, migrationsDir: string): Promise<string[]> {
  const applied = await getMigrationStatus(pool);
  const appliedNames = new Set(applied.map((m) => m.name));

  const files = await readdir(migrationsDir);
  return files
    .filter((f) => f.endsWith('.sql') && !appliedNames.has(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
