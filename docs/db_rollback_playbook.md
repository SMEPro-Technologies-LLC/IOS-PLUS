# IOS+ Database Schema Rollback & Repair Playbook

This playbook outlines procedures for performing database schema rollbacks and repairs on the **COS+** PostgreSQL database instance. It covers rollback strategies for migrations **V1 through V6**, the Flyway schema history table (`flyway_schema_history`), and bypass instructions for SQL-layer WORM triggers.

---

## 1. Safety & Prerequisite Procedures

> [!CAUTION]
> Schema rollbacks on active databases can cause irreversible data loss if not properly planned. Always take an out-of-band persistent storage snapshot or full pg_dump copy of the database before proceeding.

### Pre-Rollback Checklist

1. **Scale Down Services**: Scale down all active application pods (`middleware-engine`, `evidence-fabric`, `rag-vault`) to `0` replicas to prevent write concurrency.
2. **Retrieve Admin Credentials**: Connect to the database using the database superuser or database owner role (`cos_admin` or equivalent). Standard application roles (`ios_app`, `audit_writer`) do not have permissions to modify schemas or toggle triggers.
3. **Set Up Session Variable locks**: Some triggers depend on session contexts. Always run manual rollbacks inside a transactional block (`BEGIN; ... COMMIT;`).

---

## 2. SQL-Layer WORM Trigger Bypass

The database table `evidence_packages`, `gate_decisions`, `quarantine_records`, and `merkle_roots` utilize triggers that block `UPDATE` and `DELETE` queries. During a rollback, you must temporarily disable these triggers to allow table schema modifications or row deletions.

### Toggling Triggers (Admin Session Only)

```sql
-- Disable WORM triggers for manual schema alteration/repair
ALTER TABLE evidence_packages DISABLE TRIGGER ALL;
ALTER TABLE gate_decisions DISABLE TRIGGER ALL;
ALTER TABLE quarantine_records DISABLE TRIGGER ALL;
ALTER TABLE merkle_roots DISABLE TRIGGER ALL;

-- PERFORM ROLLBACK OPERATIONS HERE

-- Re-enable WORM triggers immediately after rollback operations
ALTER TABLE evidence_packages ENABLE TRIGGER ALL;
ALTER TABLE gate_decisions ENABLE TRIGGER ALL;
ALTER TABLE quarantine_records ENABLE TRIGGER ALL;
ALTER TABLE merkle_roots ENABLE TRIGGER ALL;
```

---

## 3. Step-by-Step Migration Rollbacks (V1 to V6)

To manually roll back migrations, run the following SQL commands sequentially starting from the target version down.

### Reverting V6 (Vault Partitioning & RAG Schema)

Reverts partitions, indexes, and pgvector schemas.

```sql
BEGIN;

-- Drop RAG Vault partitioned tables and triggers
DROP TABLE IF EXISTS rag_vault_sector_partitions CASCADE;
DROP TABLE IF EXISTS rag_chunks CASCADE;
DROP TABLE IF EXISTS rag_sources CASCADE;

-- Remove partition ranges if explicitly declared
DROP TABLE IF EXISTS rag_chunks_01_energy CASCADE;
DROP TABLE IF EXISTS rag_chunks_xsc CASCADE;

COMMIT;
```

### Reverting V5 (RBAC Roles and App Privileges)

Drops roles and revokes privileges.

```sql
BEGIN;

-- Revoke role privileges on schema public
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ios_app, audit_writer, audit_reader, rag_reader, rag_writer;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ios_app, audit_writer, audit_reader, rag_reader, rag_writer;

-- Drop standard roles
DROP ROLE IF EXISTS ios_app;
DROP ROLE IF EXISTS audit_writer;
DROP ROLE IF EXISTS audit_reader;
DROP ROLE IF EXISTS rag_reader;
DROP ROLE IF EXISTS rag_writer;

COMMIT;
```

### Reverting V4 (NAICS Decoders & Lookup Data)

Drops the code crosswalk and naics lookup structures.

```sql
BEGIN;

DROP TABLE IF EXISTS code_crosswalk CASCADE;
DROP TABLE IF EXISTS tenant_naics_profiles CASCADE;
DROP TABLE IF EXISTS naics_decoder CASCADE;

COMMIT;
```

### Reverting V3 (UCO Seeds & Matrix)

Drops the Universal Compliance Decoding Matrix schemas.

```sql
BEGIN;

DROP TABLE IF EXISTS uco_evaluation_results CASCADE;
DROP TABLE IF EXISTS uco_nodes CASCADE;
DROP TABLE IF EXISTS agency_registry CASCADE;

COMMIT;
```

### Reverting V2 (WORM triggers)

Reverts triggers and trigger functions.

```sql
BEGIN;

-- Drop triggers
DROP TRIGGER IF EXISTS worm_evidence_packages ON evidence_packages;
DROP TRIGGER IF EXISTS worm_gate_decisions ON gate_decisions;
DROP TRIGGER IF EXISTS worm_quarantine_records ON quarantine_records;
DROP TRIGGER IF EXISTS worm_merkle_roots ON merkle_roots;

-- Drop trigger function
DROP FUNCTION IF EXISTS enforce_worm_immutability();

COMMIT;
```

### Reverting V1 (Initial Persistent Schema)

Drops the core persistence tables. **DANGER: Destroys all data.**

```sql
BEGIN;

DROP TABLE IF EXISTS merkle_roots CASCADE;
DROP TABLE IF EXISTS quarantine_records CASCADE;
DROP TABLE IF EXISTS evidence_source_manifest CASCADE;
DROP TABLE IF EXISTS gate_decisions CASCADE;
DROP TABLE IF EXISTS evidence_packages CASCADE;
DROP TABLE IF EXISTS ios_signing_keys CASCADE;
DROP TABLE IF EXISTS regulatory_profiles CASCADE;
DROP TABLE IF EXISTS tenant_registry CASCADE;
DROP TABLE IF EXISTS objects CASCADE;
DROP TABLE IF EXISTS filing_calendar CASCADE;

COMMIT;
```

---

## 4. Flyway Schema History Synchronization

After manually dropping or altering tables, Flyway's internal schema history table must be repaired to prevent checksum mismatches on subsequent builds.

### Manual Synchronization Commands

1. **Delete Schema History Entries**:
   If you rolled back the schema to version `Vx`, remove all records above version `Vx` from the history table:

   ```sql
   DELETE FROM flyway_schema_history WHERE version_rank > x;
   ```

2. **Execute Flyway Repair**:
   Run the repair job to align the checksums of existing migrations:

   ```bash
   flyway repair -url=jdbc:postgresql://<db_host>:5432/ios_plus -user=cos_admin -password=<password>
   ```

3. **Verify DB Invariants**:
   Run the preflight verification script to ensure the schema has successfully settled at the targeted version:

   ```bash
   python scripts/db/verify_db_invariants.py
   ```

