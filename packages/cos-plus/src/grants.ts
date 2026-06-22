import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';

export interface GrantRecord {
  role: string;
  privilege: string;
  schema: string;
  table: string;
}

export async function applyGrants(pool: Pool, grantsFile: string): Promise<void> {
  const content = await readFile(grantsFile, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Execute the entire grants file as a single transaction block.
    // PostgreSQL clients support multiple semicolon-separated statements in one query string.
    await client.query(content);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyGrants(pool: Pool): Promise<GrantRecord[]> {
  const result = await pool.query(`
    SELECT grantee AS role,
           privilege_type AS privilege,
           table_schema AS schema,
           table_name AS table
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee != 'postgres'
      AND grantee NOT LIKE 'pg_%'
    ORDER BY table_name, grantee, privilege_type;
  `);
  return result.rows as GrantRecord[];
}

export async function getGrantsForRole(pool: Pool, role: string): Promise<GrantRecord[]> {
  const result = await pool.query(
    `
      SELECT grantee AS role,
             privilege_type AS privilege,
             table_schema AS schema,
             table_name AS table
      FROM information_schema.table_privileges
      WHERE grantee = $1
      ORDER BY table_name, privilege_type;
    `,
    [role]
  );
  return result.rows as GrantRecord[];
}

export async function getGrantsForTable(
  pool: Pool,
  schema: string,
  table: string
): Promise<GrantRecord[]> {
  const result = await pool.query(
    `
      SELECT grantee AS role,
             privilege_type AS privilege,
             table_schema AS schema,
             table_name AS table
      FROM information_schema.table_privileges
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY grantee, privilege_type;
    `,
    [schema, table]
  );
  return result.rows as GrantRecord[];
}

export async function revokeAllGrants(pool: Pool, role: string): Promise<void> {
  // Validate role name to prevent SQL injection in DDL
  if (!/^[a-zA-Z_][a-zA-Z0-9_\-$]*$/.test(role)) {
    throw new Error(`Invalid role name: ${role}`);
  }
  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${role}";`);
  await pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${role}";`);
  await pool.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM "${role}";`);
}
