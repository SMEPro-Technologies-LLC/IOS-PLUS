#!/usr/bin/env node
import { createPool } from '@ios-plus/cos-plus';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
    const pool = createPool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('[SEED] Starting seed...');
        // Read seed SQL
        const seedSql = readFileSync(join(process.cwd(), 'db', 'migrations', '006_seed_data.sql'), 'utf8');
        await pool.query(seedSql);
        console.log('[SEED] Seed complete');
    } catch (error) {
        console.error('[SEED] Failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
