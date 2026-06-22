#!/usr/bin/env node
/**
 * IOS+ Seed Loader — CIP→SOC→State Licensure Lookup
 * Reads valid seed CSVs and loads them into PostgreSQL
 * Supports: cip_soc_state_license.csv, compact_participation.csv
 */
import { createPool } from '@ios-plus/cos-plus';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEEDS_DIR = join(__dirname, '..', '..', 'db', 'seeds');

function loadCsv(filename) {
    const path = join(SEEDS_DIR, filename);
    const content = readFileSync(path, 'utf8');
    return parse(content, { columns: true, skip_empty_lines: true });
}

async function validateData(cipSocData, compactData) {
    const errors = [];

    // Validate eNLC count
    const eNLC = compactData.filter(r => r.compact_type === 'eNLC' && r.member_status !== 'Non-Compact');
    if (eNLC.length !== 43) {
        errors.push(`eNLC count mismatch: expected 43, got ${eNLC.length}`);
    }

    // Validate IMLC count
    const IMLC = compactData.filter(r => r.compact_type === 'IMLC' && r.member_status !== 'Non-Compact');
    if (IMLC.length !== 45) {
        errors.push(`IMLC count mismatch: expected 45, got ${IMLC.length}`);
    }

    // Validate PSYPACT count
    const PSYPACT = compactData.filter(r => r.compact_type === 'PSYPACT' && r.member_status !== 'Non-Compact');
    if (PSYPACT.length < 42 || PSYPACT.length > 43) {
        errors.push(`PSYPACT count mismatch: expected 42-43, got ${PSYPACT.length}`);
    }

    // Validate all states have eNLC entries
    const expectedStates = ['AL','AZ','AR','CO','CT','DE','FL','GA','GU','ID','IN','IA','KS','KY','LA','ME','MD','MA','MS','MO','MT','NE','NH','NJ','NM','NC','ND','OH','OK','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','VI'];
    const eNLCStates = new Set(eNLC.map(r => r.jurisdiction_code));
    for (const st of expectedStates) {
        if (!eNLCStates.has(st)) {
            errors.push(`Missing eNLC state: ${st}`);
        }
    }

    // Validate CIP 51.3801 has SOC 29-1141 and 29-1171
    const cip3801 = cipSocData.filter(r => r.cip_code === '51.3801');
    const socCodes = new Set(cip3801.map(r => r.soc_code));
    if (!socCodes.has('29-1141')) {
        errors.push('Missing SOC 29-1141 for CIP 51.3801');
    }
    if (!socCodes.has('29-1171')) {
        errors.push('Missing SOC 29-1171 for CIP 51.3801');
    }

    // Validate key states exist for CIP 51.3801 → SOC 29-1141
    const keyStates = ['TX','CA','NY','FL','PA','WA','OR'];
    for (const st of keyStates) {
        const found = cipSocData.find(r => r.cip_code === '51.3801' && r.soc_code === '29-1141' && r.state_abbrev === st);
        if (!found) {
            errors.push(`Missing state ${st} for CIP 51.3801 → SOC 29-1141`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Validation failed:\n${errors.join('\n')}`);
    }

    console.log('[LOADER] Validation passed:');
    console.log(`  - eNLC: ${eNLC.length} jurisdictions (43 expected)`);
    console.log(`  - IMLC: ${IMLC.length} jurisdictions (45 expected)`);
    console.log(`  - PSYPACT: ${PSYPACT.length} jurisdictions (42-43 expected)`);
    console.log(`  - CIP 51.3801 → SOC 29-1141: ${cip3801.filter(r => r.soc_code === '29-1141').length} state records`);
}

async function loadIntoDatabase(pool, cipSocData, compactData) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Create staging tables
        await client.query(`
            DROP TABLE IF EXISTS staging_cip_soc_state_license;
            CREATE TABLE staging_cip_soc_state_license (
                cip_code VARCHAR(10),
                soc_code VARCHAR(10),
                state_abbrev VARCHAR(2),
                state_name VARCHAR(100),
                license_type VARCHAR(200),
                compact_member BOOLEAN,
                compact_status VARCHAR(50),
                endorsement_required BOOLEAN,
                reciprocity_available BOOLEAN,
                exam_required VARCHAR(100),
                ce_hours_per_cycle VARCHAR(20),
                cycle_length_years VARCHAR(10),
                source_url VARCHAR(500),
                last_verified DATE
            );
        `);

        await client.query(`
            DROP TABLE IF EXISTS staging_compact_participation;
            CREATE TABLE staging_compact_participation (
                jurisdiction_code VARCHAR(10),
                jurisdiction_name VARCHAR(100),
                compact_type VARCHAR(20),
                member_status VARCHAR(50),
                effective_date VARCHAR(20),
                notes TEXT,
                source_url VARCHAR(500),
                last_verified DATE
            );
        `);

        // Insert cip_soc_state_license
        const cipInsert = `
            INSERT INTO staging_cip_soc_state_license
            (cip_code, soc_code, state_abbrev, state_name, license_type, compact_member, compact_status, endorsement_required, reciprocity_available, exam_required, ce_hours_per_cycle, cycle_length_years, source_url, last_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `;
        for (const row of cipSocData) {
            await client.query(cipInsert, [
                row.cip_code, row.soc_code, row.state_abbrev, row.state_name,
                row.license_type, row.compact_member === 'TRUE', row.compact_status,
                row.endorsement_required === 'TRUE', row.reciprocity_available === 'TRUE',
                row.exam_required, row.ce_hours_per_cycle, row.cycle_length_years,
                row.source_url, row.last_verified
            ]);
        }
        console.log(`[LOADER] Inserted ${cipSocData.length} rows into staging_cip_soc_state_license`);

        // Insert compact_participation
        const compactInsert = `
            INSERT INTO staging_compact_participation
            (jurisdiction_code, jurisdiction_name, compact_type, member_status, effective_date, notes, source_url, last_verified)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        for (const row of compactData) {
            await client.query(compactInsert, [
                row.jurisdiction_code, row.jurisdiction_name, row.compact_type,
                row.member_status, row.effective_date || null, row.notes || null,
                row.source_url, row.last_verified
            ]);
        }
        console.log(`[LOADER] Inserted ${compactData.length} rows into staging_compact_participation`);

        await client.query('COMMIT');
        console.log('[LOADER] Seed load complete');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    console.log('[LOADER] IOS+ CIP→SOC→State Licensure Seed Loader');
    console.log('[LOADER] Loading CSVs from:', SEEDS_DIR);

    const cipSocData = loadCsv('cip_soc_state_license.csv');
    const compactData = loadCsv('compact_participation.csv');

    console.log(`[LOADER] Loaded ${cipSocData.length} CIP→SOC→State records`);
    console.log(`[LOADER] Loaded ${compactData.length} compact participation records`);

    // Validate before loading
    await validateData(cipSocData, compactData);

    // Load into database if DATABASE_URL is set
    if (process.env.DATABASE_URL) {
        const pool = createPool({ connectionString: process.env.DATABASE_URL });
        try {
            await loadIntoDatabase(pool, cipSocData, compactData);
            // Run a quick smoke test
            const result = await pool.query(`
                SELECT COUNT(*) as count FROM staging_compact_participation
                WHERE compact_type = 'eNLC' AND member_status = 'Fully Active'
            `);
            console.log(`[LOADER] Smoke test: ${result.rows[0].count} eNLC fully active states in DB`);
        } finally {
            await pool.end();
        }
    } else {
        console.log('[LOADER] DATABASE_URL not set; skipping DB load. Set DATABASE_URL to load into PostgreSQL.');
    }
}

main().catch(err => {
    console.error('[LOADER] FAILED:', err.message);
    process.exit(1);
});
