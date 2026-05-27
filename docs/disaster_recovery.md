# Disaster Recovery Runbook

This document defines the Disaster Recovery (DR) SLA targets, procedures, and restore verification drills for the **IOS+** application engine and **COS+** database systems.

---

## 1. SLA Targets

| Metric | Target | Alignment Heuristic |
| :--- | :--- | :--- |
| **RTO** (Recovery Time Objective) | **15 minutes** | Active replica failover and automated DNS updates. |
| **RPO** (Recovery Point Objective) | **15 minutes** | Aligned with the 15-minute Merkle Root DNS publication cron interval. |

---

## 2. PostgreSQL Backup & Restore Procedures

Google Cloud SQL for PostgreSQL is configured with:

* Daily automated backups with a 30-day retention window.
* Point-in-Time Recovery (PITR) enabled via write-ahead logging (WAL) archiving.

### A. Point-in-Time Recovery (PITR) Restore Drill

In the event of database corruption or data loss, perform PITR to restore the database state to the last minute before the incident:

1. **Identify the target timestamp** (e.g. `2026-05-27T17:30:00Z`).
2. **Trigger the restore via gcloud CLI**:

   ```bash
   gcloud sql instances restore ios-plus-db \
     --restore-instance=ios-plus-db-restore-target \
     --point-in-time-restore-time="2026-05-27T17:30:00Z"
   ```

3. **Update Helm configurations** to route application workloads to the new target database address.
4. **Execute Post-Restore Schema Verification**:

   ```bash
   kubectl apply -f infra/kubernetes/db-migrate-job.yaml -n ios-plus
   ```

---

## 3. HashiCorp Vault Secrets Recovery

Vault transit keys and KV configurations must be backed up securely to prevent locking the Evidence Fabric.

### A. Transit Engine Key Backup

1. Verify backup permissions are active on the Vault policy.
2. Export the Ed25519 signing key metadata block:

   ```bash
   vault write -f transit/backup/ios-evidence-signing-production
   ```

3. Store the encrypted key payload inside a secure, offline backup vault.

### B. Transit Engine Key Restore

1. Import the backup payload back to Vault:

   ```bash
   vault write transit/restore/ios-evidence-signing-production \
     backup=<base64-encrypted-payload>
   ```

---

## 4. Runbook Restore Drill Verification Checklist

After any restoration drill, the operator must execute the following validation steps:

* [ ] Verify the new database instance is reachable from GKE.
* [ ] Run the Flyway verification routine (`afterMigrate.sql`) to confirm all WORM triggers and role access privileges are active.
* [ ] Query the Middleware Engine `/ready` check and assert `status: "ready"` with no degraded checks.
* [ ] Verify that a test compliance rule evaluation is successful and writes to the WORM log.
