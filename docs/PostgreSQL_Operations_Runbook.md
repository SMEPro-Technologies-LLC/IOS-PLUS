# PostgreSQL Operations Runbook — IOS+ Platform

**Scope:** COS+ PostgreSQL/pgvector database engine  
**Last updated:** 2026-06-28  
**Engine:** PostgreSQL 16 + pgvector

---

## Table of Contents

1. [Migration Execution](#1-migration-execution)
2. [Rollback and Roll-forward](#2-rollback-and-roll-forward)
3. [Restore and Verification Checklist](#3-restore-and-verification-checklist)
4. [WORM Verification Procedure](#4-worm-verification-procedure)
5. [Schema Invariant Check](#5-schema-invariant-check)
6. [Known Remaining Risks and Blockers](#6-known-remaining-risks-and-blockers)

---

## 1. Migration Execution

### File layout

Migrations live in `db/migrations/` and are executed in lexicographic order by the custom runner at `scripts/db/migrate.js`.

| File | Purpose |
|------|---------|
| `001_initial_schema.sql` | Core tables: `audit_events`, `evidence_records`, `compliance_rules`, `rag_documents`, UCO ontology tables |
| `002_worm_triggers.sql` | WORM enforcement triggers on immutable tables |
| `003_indexes.sql` | Performance indexes (B-tree + HNSW vector + GIN) |
| `004_udm_views.sql` | UCO crosswalk views (`v_cip_naics`, `v_cip_soc`, `v_soc_naics`, base `v_state_licensure_candidates`, `fn_lookup_state_licensure_by_cip`) |
| `005_audit_retention.sql` | Retention policy for archiving old audit events |
| `006_seed_data.sql` | Reference seed data |
| `V11__mini_udm_lamar_operationalization.sql` | Lamar-specific UDM operationalization; redefines `v_state_licensure_candidates` and `fn_lookup_state_licensure_by_cip` using staging tables (overrides 004) |
| `V12__module1_regulatory_reporting.sql` | Regulatory reporting module |
| `V13__module2_objectives_student_facing.sql` | Student-facing objectives module |
| `V14__module3_ai_governance.sql` | AI governance module |

> **Important:** V11 runs after 004 and replaces `v_state_licensure_candidates` and `fn_lookup_state_licensure_by_cip` with staging-table-backed implementations. Application code in `packages/uco-resolver/src/database.ts` is aligned to the V11 contract.

### Required extensions

Before migrating, ensure these extensions are installed (all require superuser):

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;       -- pgvector
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- trigram index on uco_nodes
```

### Running migrations

```bash
# From repo root
export DATABASE_URL="******host:5432/dbname"
npm run db:migrate
```

The runner applies only unapplied migrations (tracked in `schema_migrations`). Each migration runs in a transaction; if a migration fails, it is rolled back and the runner stops.

### CI / CD migration execution

The CI workflow (`.github/workflows/ci.yml`) runs migrations before the test suite:

```yaml
- name: Run database migrations
  run: npm run db:migrate
  env:
    DATABASE_URL: ******localhost:5432/iosplus_test
```

### Migration ordering requirements

- Extensions must be installed **before** running any migration.
- `001` must succeed before `002` (WORM triggers reference tables created in 001).
- `004` must succeed before `V11` (V11 uses `CREATE OR REPLACE` which depends on 004 creating the function signature first — though technically V11 is a full replace, ordering still matters for idempotency).

### Idempotency

All migrations use `IF NOT EXISTS` guards or `CREATE OR REPLACE` for views and functions. Running a migration twice is safe, but the `schema_migrations` tracking prevents double-application by the runner.

---

## 2. Rollback and Roll-forward

### General policy

The IOS+ database does **not** support automated rollback of applied migrations. The WORM triggers make `audit_events`, `evidence_records`, and `schema_migrations` **immutable** — even with superuser access, these rows cannot be deleted or updated.

### Roll-forward strategy (preferred)

If a migration contains a bug, write a new `V{N+1}__fix_description.sql` migration and apply it forward. This preserves the audit chain integrity.

### Emergency rollback (data-loss path — use only in non-production)

For development/staging environments only:

```sql
-- Superuser required. Will DROP all data.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO iosplus;
-- Then re-run all migrations from scratch.
```

**Never use this in production.** Data in WORM-protected tables cannot be recovered from this operation.

### Specific object rollback (DDL only)

For non-WORM objects (views, functions, indexes, non-WORM tables):

```sql
-- Drop a view
DROP VIEW IF EXISTS v_state_licensure_candidates CASCADE;

-- Drop a function
DROP FUNCTION IF EXISTS fn_lookup_state_licensure_by_cip(TEXT, TEXT);
DROP FUNCTION IF EXISTS fn_lookup_state_licensure_by_cip(VARCHAR, VARCHAR);

-- Then re-apply the corrected migration or a new fix migration.
```

---

## 3. Restore and Verification Checklist

### Post-restore steps

After a PITR or backup restore, run this checklist before accepting traffic:

1. **Verify extensions are present**

   ```sql
   SELECT extname FROM pg_extension
   WHERE extname IN ('vector', 'pgcrypto', 'uuid-ossp', 'pg_trgm');
   -- Expect 4 rows
   ```

2. **Verify all migration records exist**

   ```sql
   SELECT version, applied_at FROM schema_migrations ORDER BY id;
   -- Should match the last known set of applied migrations
   ```

3. **Run the invariant checker**

   ```bash
   # Uses packages/cos-plus/src/invariant.ts
   npm run db:verify-worm
   ```

   Or programmatically:

   ```ts
   import { verifyInvariants } from '@ios-plus/cos-plus';
   const report = await verifyInvariants(pool);
   if (!report.allPassed) throw new Error('Schema invariant check failed');
   ```

4. **Verify WORM triggers are active** (see Section 4)

5. **Verify views and functions resolve**

   ```sql
   -- V11 view
   SELECT count(*) FROM v_state_licensure_candidates;

   -- V11 function
   SELECT * FROM fn_lookup_state_licensure_by_cip('51.3801', 'TX') LIMIT 1;

   -- UCO views (004)
   SELECT count(*) FROM v_cip_naics;
   SELECT count(*) FROM v_cip_soc;
   SELECT count(*) FROM v_soc_naics;
   ```

6. **Verify HNSW vector index is usable**

   ```sql
   EXPLAIN (ANALYZE, BUFFERS)
   SELECT id FROM rag_documents
   ORDER BY embedding <=> '[0,0,0,...]'::vector(1536)
   LIMIT 5;
   -- Should show "Index Scan using idx_rag_documents_embedding_hnsw"
   ```

7. **Check grants**

   ```sql
   SELECT grantee, table_name, privilege_type
   FROM information_schema.role_table_grants
   WHERE grantee = 'ios_plus_api'
   ORDER BY table_name, privilege_type;
   ```

### Recovery RTO/RPO expectations

| Metric | Target | Notes |
|--------|--------|-------|
| RPO | ≤ 5 minutes | Cloud SQL PITR continuous log backup |
| RTO | ≤ 4 hours | Manual PITR restore + verification |

---

## 4. WORM Verification Procedure

### Which tables are WORM-protected?

| Table | Trigger name |
|-------|-------------|
| `audit_events` | `trg_audit_events_worm` |
| `evidence_records` | `trg_evidence_records_worm` |
| `schema_migrations` | `trg_schema_migrations_worm` |

### Automated verification

The CI workflow runs `npm run db:verify-worm` after migrations. This calls `scripts/db/verify-worm.js`.

### Manual WORM verification

Run these checks to confirm WORM is active:

```sql
-- 1. Verify triggers exist
SELECT
    c.relname AS table_name,
    t.tgname AS trigger_name,
    t.tgenabled AS enabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND t.tgname IN (
    'trg_audit_events_worm',
    'trg_evidence_records_worm',
    'trg_schema_migrations_worm'
  );
-- Expect 3 rows, all enabled = 'O'

-- 2. Prove audit_events rejects UPDATE (must raise WORM_VIOLATION)
BEGIN;
  UPDATE audit_events SET actor_type = 'probe' WHERE id = (
    SELECT id FROM audit_events LIMIT 1
  );
ROLLBACK;
-- Should error: "WORM_VIOLATION: Table "audit_events" is write-once-read-many."

-- 3. Prove evidence_records rejects DELETE
BEGIN;
  DELETE FROM evidence_records WHERE id = (
    SELECT id FROM evidence_records LIMIT 1
  );
ROLLBACK;
-- Should error: "WORM_VIOLATION: Table "evidence_records" is write-once-read-many."
```

### WORM bypass risk

WORM is enforced by `BEFORE UPDATE OR DELETE` row-level triggers. A superuser can `ALTER TABLE ... DISABLE TRIGGER ALL`. This is a deliberate admin escape hatch. To mitigate:

- Limit superuser access to migration-time only.
- Audit all DDL changes via `pg_audit` or Cloud SQL audit logging.
- Alerts should fire if any trigger is disabled on WORM tables.

### Archive table note

`audit_events_archive` is **not** WORM-protected by design — it holds records moved by the retention policy. Ensure write access to this table is restricted to the migration/retention role only.

---

## 5. Schema Invariant Check

The `InvariantVerifier` in `packages/cos-plus/src/invariant.ts` validates:

- Required tables exist: `audit_events`, `evidence_records`, `schema_migrations`, `compliance_rules`, `rag_documents`, `uco_nodes`, `uco_crosswalk`, `uco_obligation_metadata`
- Required extensions installed: `vector`, `pgcrypto`, `uuid-ossp`
- Correct audit column names: `actor_id`, `actor_type`, `operation`, `table_name`, `record_id`, `timestamp`, `created_at`
- Correct evidence column names: `request_id`, `decision`, `signature`, `public_key`, `canonical_payload`, `previous_hash`, `created_at`
- WORM triggers: `trg_audit_events_worm`, `trg_evidence_records_worm`, `trg_schema_migrations_worm`
- Performance indexes: `idx_audit_events_timestamp`, `idx_audit_events_table_name`, `idx_evidence_records_request_id`, `idx_evidence_records_timestamp`

To run programmatically:

```ts
import { Pool } from 'pg';
import { InvariantVerifier } from '@ios-plus/cos-plus';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const verifier = new InvariantVerifier(pool);
const report = await verifier.verify();

report.checks
  .filter(c => !c.passed)
  .forEach(c => console.error('INVARIANT FAILED:', c.name, '-', c.message));

if (!report.allPassed) process.exit(1);
```

---

## 6. Known Remaining Risks and Blockers

### Resolved in this PR

| Gap | Resolution |
|-----|-----------|
| Invariant checker validated wrong column/trigger/index names | Fixed in `packages/cos-plus/src/invariant.ts` |
| `uco-resolver` queried non-existent crosswalk tables (`uco_cip_naics_crosswalk`, etc.) | Fixed in `packages/uco-resolver/src/database.ts` to use `uco_crosswalk` |
| `v_state_licensure_candidates` queried with wrong column names | Fixed to use V11 column names (`cip_code`, `state_abbrev`) |
| V11 `fn_lookup_state_licensure_by_cip` referenced non-existent `uco_node_id` column | Fixed to use `id` |
| No database-focused automated tests | Added WORM integration tests, invariant unit tests, UCO resolver unit tests |
| `@types/tweetnacl` non-existent package blocked `npm install` | Removed from `evidence-fabric/package.json` |

### Remaining risks

| Risk | Severity | Notes |
|------|----------|-------|
| Custom migration runner (`scripts/db/migrate.js`) not proven at scale | High | Consider adopting Flyway/Liquibase for enterprise deployments |
| No rollback testing on production schema | High | Rollback plan exists (roll-forward) but has not been drill-tested |
| pgvector HNSW parameters not tuned for production workload | Medium | `m=16, ef_construction=64` are reasonable defaults; validate at target data scale |
| Connection pooling not production-configured | Medium | Application pool code present; PgBouncer or Cloud SQL proxy config not documented |
| `audit_events_archive` not WORM-protected | Low | By design, but archival role permissions need explicit governance |
| Staging data for V11 UDM (`staging_cip_soc_state_license`) not seeded | Medium | V11 views return empty results until seed CSVs are loaded |
| Restore drill not performed | High | PITR configuration exists; recoverability not yet proven via drill |
| No pg_audit or equivalent DDL audit trail | Medium | Relies on Cloud SQL audit logging; not validated |
