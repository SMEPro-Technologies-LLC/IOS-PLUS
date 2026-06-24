#!/usr/bin/env node
import { createPool, verifyWormCompliance } from '@ios-plus/cos-plus';

async function main() {
    const pool = createPool({ connectionString: process.env.DATABASE_URL });
    try {
        console.log('[VERIFY] Checking WORM status...');
        const status = await verifyWormCompliance(pool);
        if (!status.compliant) {
            console.error('[VERIFY] WORM verification FAILED:');
            status.violations.forEach(v => console.error(`  - ${v}`));
            process.exit(1);
        }
        console.log('[VERIFY] WORM verification PASSED');
        console.log(`[VERIFY] Protected tables: ${status.protectedTables.join(', ')}`);
        console.log(`[VERIFY] Total checks: ${status.totalChecks}`);
    } catch (error) {
        console.error('[VERIFY] Verification failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
