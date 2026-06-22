#!/usr/bin/env node
import { createPool } from '@ios-plus/cos-plus';
import { runMigrations } from '@ios-plus/cos-plus';
import { readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

async function main() {
    const pool = createPool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('[MIGRATE] Starting migration run...');
        const result = await runMigrations(pool, MIGRATIONS_DIR);
        console.log(`[MIGRATE] Applied ${result.applied.length} migrations:`);
        result.applied.forEach(m => console.log(`  - ${m}`));
        console.log(`[MIGRATE] Skipped ${result.skipped.length} already-applied migrations`);
        if (result.failed.length > 0) {
            console.error(`[MIGRATE] Failed migrations: ${result.failed.join(', ')}`);
            process.exit(1);
        }
        console.log('[MIGRATE] Migration complete');
    } catch (error) {
        console.error('[MIGRATE] Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
