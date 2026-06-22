#!/usr/bin/env node
import { createPool, applyGrants } from '@ios-plus/cos-plus';
import { join } from 'path';

async function main() {
    const pool = createPool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('[GRANT] Applying grants...');
        await applyGrants(pool, join(process.cwd(), 'db', 'grants', 'apply.sql'));
        console.log('[GRANT] Grants applied successfully');
    } catch (error) {
        console.error('[GRANT] Failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
