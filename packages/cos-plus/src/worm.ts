import type { Pool } from 'pg';

export interface WormTriggerConfig {
  tableName: string;
  triggerFunctionName: string;
  triggerName: string;
}

export function getWormTriggerNames(tableName: string): WormTriggerConfig {
  const sanitized = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  return {
    tableName: sanitized,
    triggerFunctionName: `worm_prevent_update_delete_${sanitized}`,
    triggerName: `worm_${sanitized}`,
  };
}

export async function enforceWorm(pool: Pool, tableName: string): Promise<void> {
  const { triggerFunctionName, triggerName } = getWormTriggerNames(tableName);

  await pool.query(`
    CREATE OR REPLACE FUNCTION ${triggerFunctionName}()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'WORM violation: UPDATE is prohibited on table %', TG_TABLE_NAME
          USING ERRCODE = 'worm_violation';
      ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'WORM violation: DELETE is prohibited on table %', TG_TABLE_NAME
          USING ERRCODE = 'worm_violation';
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};
  `);

  await pool.query(`
    CREATE TRIGGER ${triggerName}
    BEFORE UPDATE OR DELETE ON ${tableName}
    FOR EACH ROW
    EXECUTE FUNCTION ${triggerFunctionName}();
  `);
}

export interface WormStatus {
  tableName: string;
  hasWormTrigger: boolean;
  triggerName: string | null;
  isCompliant: boolean;
}

export async function verifyWormStatus(pool: Pool): Promise<WormStatus[]> {
  const result = await pool.query(`
    SELECT c.relname as table_name,
           EXISTS (
             SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = c.oid
             AND t.tgname LIKE 'worm_%'
           ) as has_worm,
           (
             SELECT t.tgname FROM pg_trigger t
             WHERE t.tgrelid = c.oid
             AND t.tgname LIKE 'worm_%'
             LIMIT 1
           ) as trigger_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
    AND n.nspname = 'public'
    AND (c.relname LIKE '%audit%' OR c.relname LIKE '%evidence%' OR c.relname LIKE '%vector%')
    ORDER BY c.relname;
  `);

  return result.rows.map((row) => ({
    tableName: row.table_name as string,
    hasWormTrigger: row.has_worm as boolean,
    triggerName: (row.trigger_name as string | null) ?? null,
    isCompliant: row.has_worm as boolean,
  }));
}

export async function createWormTable(
  pool: Pool,
  tableName: string,
  schema: string
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      ${schema}
    );
  `);
  await enforceWorm(pool, tableName);
}

export async function removeWorm(pool: Pool, tableName: string): Promise<void> {
  const { triggerName, triggerFunctionName } = getWormTriggerNames(tableName);
  await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${tableName};`);
  await pool.query(`DROP FUNCTION IF EXISTS ${triggerFunctionName}();`);
}

export class WormEnforcer {
  private pool: Pool;
  private protectedTables: Set<string> = new Set();

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async protect(tableName: string): Promise<void> {
    await enforceWorm(this.pool, tableName);
    this.protectedTables.add(tableName);
  }

  async unprotect(tableName: string): Promise<void> {
    await removeWorm(this.pool, tableName);
    this.protectedTables.delete(tableName);
  }

  async verify(): Promise<WormStatus[]> {
    const status = await verifyWormStatus(this.pool);
    const statusMap = new Map(status.map((s) => [s.tableName, s]));
    const result: WormStatus[] = [];

    for (const tableName of this.protectedTables) {
      if (statusMap.has(tableName)) {
        const s = statusMap.get(tableName)!;
        result.push(s);
      } else {
        result.push({
          tableName,
          hasWormTrigger: false,
          triggerName: null,
          isCompliant: false,
        });
      }
    }
    return result;
  }

  getProtectedTables(): string[] {
    return Array.from(this.protectedTables);
  }
}
