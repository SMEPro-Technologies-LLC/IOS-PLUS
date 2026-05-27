# On-Premise Deployment Playlist & Verification Playbook
**SMEPro Technologies — IOS+ Middleware Core Deployment System**  

> [!NOTE]  
> **Status: Reference Deployment Playbook**  
> *This document represents a reference deployment playbook validated against the Lamar University tenant profile configuration (mapping academic CS CIP codes to compliance NAICS profiles). It is intended as an operational template for technical pilots.*

---

## 1. Host Prerequisites & Sizing

For local, on-premises deployment at Lamar University (SCIF/Air-Gapped) or single-tenant SaaS pilots, the following infrastructure bounds must be allocated:

### 1.1 System Sizing
* **Virtual Machine / Bare-Metal Host:**
  * **vCPU:** 4 Cores (minimum) / 8 Cores (recommended for production load)
  * **Memory:** 16 GB RAM (minimum) / 32 GB RAM (recommended to accommodate pgvector indexing buffers and Redis cache)
  * **Storage:** 100 GB SSD (Enterprise grade with high IOPS for log indexing and append-only WAL writes)
* **Operating System:** Red Hat Enterprise Linux (RHEL) 8+, Ubuntu Server 22.04 LTS, or Windows Server 2022 running Docker Engine.

### 1.2 Software Dependencies
* **Docker Engine** $\ge$ 24.0.0 with **Docker Compose v2**
* **PostgreSQL 16** with **pgvector v0.5.1+** extension installed
* **Redis v7.2** (for caching query embeddings and rate-limiting counters)
* **Node.js v20.x LTS** (for standalone diagnostic utilities and local runner context)

---

## 2. Phase 2: On-Premise Deployment Playlist

Execute the following sequential operations to deploy the horizontal IOS+ Middleware Substrate.

### Step 1: Database Provisioning & Migrations
1. Connect to the local PostgreSQL instance and establish the database context:
   ```sql
   CREATE DATABASE ios_plus;
   ```
2. Run Flyway schema migrations (V1 to V6) to construct the operational tables, WORM audit constraints, and seed the Five-Layer Ontological Crosswalk table:
   ```bash
   docker run --rm \
     -v C:\Users\admin\IOS-PLUS\db\migrations:/flyway/sql:ro \
     flyway/flyway:10 \
     -url=jdbc:postgresql://<DB_HOST>:5432/ios_plus \
     -user=cos_admin \
     -password=<COS_ADMIN_PASSWORD> \
     migrate -baselineOnMigrate=true -baselineVersion=5
   ```
   *(Note: The database tables `quarantine_records` and `code_crosswalk` are created during migrations V2 and V4 respectively. This ensures that when the V5 RBAC migration is applied, all referenced target tables exist and permissions attach successfully. Finally, the V6 migration `V6__seed_crosswalk.sql` must be executed to seed the crosswalk mappings required for testing).*

### Step 2: Establish Database Role Privileges (RBAC)
Run the RBAC migration scripts to enforce least-privilege separation across the microservices:
```bash
docker exec -i cos-plus psql -U cos_admin -d ios_plus -f /docker-entrypoint-initdb.d/V5__rbac_app_roles.sql
```
*Creates the following db roles:*
* `ios_app`: Operational CRUD permissions.
* `audit_writer`: `INSERT`-only permission on `evidence_packages`, `gate_decisions`, and `quarantine_records` (blocked from `UPDATE`/`DELETE`).
* `audit_reader`: Read-only access to audit tables for compliance reporting.
* `rag_reader`: Read-only access to `rag_chunks_*` partitions.
* `rag_writer`: Full write access for vector data pipelines.

### Step 3: Local Vault Key Custody Setup (On-Premises Vault)
Lamar University utilizes file-based key custody (`LocalFileKeyProvider`) rather than Cloud KMS.
1. Generate a fresh, production-grade Ed25519 private key seed (exactly 32 bytes, base64-encoded) utilizing Node's raw buffer exporter:
   ```bash
   node -e "
   const { generateKeyPairSync } = require('crypto');
   const { privateKey } = generateKeyPairSync('ed25519');
   const rawPrivateBytes = privateKey.export({ type: 'raw', format: 'buffer' });
   console.log(Buffer.from(rawPrivateBytes).toString('base64'));
   " > /etc/smepro/vault_key.pem
   ```
2. Restrict file system permissions to the container runtime user:
   ```bash
   chmod 600 /etc/smepro/vault_key.pem
   chown 10001:10001 /etc/smepro/vault_key.pem
   ```

### Step 4: Environment Settings
Create a production `.env` file on the host. Configure Lamar University's curriculum crosswalk values and link to the key file path:

> [!WARNING]  
> **Credentials Security Warning:**  
> The `.env` file contains production secrets and database passwords. Never commit this file to source control. Generate random passwords using `openssl rand -base64 32` for each deployment. Restrict access: `chmod 600 /etc/smepro/.env`.

```dotenv
# =====================================================================
# SMEPro Production Environment Configuration — REPLACE PASSWORDS
# =====================================================================

# --- PostgreSQL Credentials ---
COS_HOST=cos-plus
COS_PORT=5432
COS_DATABASE=ios_plus
COS_PASSWORD_IOS_APP=<REPLACE_WITH_SECURE_PASSWORD>
COS_PASSWORD_AUDIT_WRITER=<REPLACE_WITH_SECURE_PASSWORD>
COS_PASSWORD_AUDIT_READER=<REPLACE_WITH_SECURE_PASSWORD>
COS_PASSWORD_RAG_READER=<REPLACE_WITH_SECURE_PASSWORD>
COS_PASSWORD_RAG_WRITER=<REPLACE_WITH_SECURE_PASSWORD>
COS_PASSWORD_COS_ADMIN=<REPLACE_WITH_SECURE_PASSWORD>

# --- Redis Configuration ---
REDIS_URL=redis://:<REPLACE_WITH_SECURE_PASSWORD>@redis:6379

# --- Local Vault Key Custody ---
SIGNING_KEY_FILE_PATH=/run/secrets/vault_key.pem
SIGNING_KEY_DNS_ZONE=_ios-signing-key.lamar.edu
SIGNING_KEY_ACTIVE_ID=key-lamar-001

# --- OpenAI Embedding Model Configuration ---
OPENAI_API_KEY=<your_openai_api_key>

# --- Lamar University Ontological Crosswalk Filters ---
TENANT_ID=8f7b5a82-120d-4bb8-8ad2-c8e9b88255af
TENANT_CIP_CODES=11.0101   # Maps to NAICS 5415 (IT & Computer Science)
TENANT_NAICS_EFFECTIVE_DATE=2026-05-26
```

### Step 5: Stack Bring-up via Docker Compose
Mount the private key vault path as a secret inside `docker-compose.yml`:
```yaml
services:
  middleware-engine:
    image: smepro/middleware-engine:latest
    environment:
      SIGNING_KEY_FILE_PATH: "/run/secrets/vault_key.pem"
    secrets:
      - vault_key
    ...
secrets:
  vault_key:
    file: /etc/smepro/vault_key.pem
```
Launch the services:
```bash
docker compose up -d cos-plus redis gate-530 middleware-engine
```

---

## 3. Verification Playbook

Perform the following runtime verifications to validate WORM database triggers, local file-based vault loading, and vector RAG embedding caching.

### 3.1 WORM Auditing Verification
Confirm that database records are write-once and cannot be altered or deleted, even by administrative credentials.

1. **Insert a mock audit record:**
   Log in to the database as `cos_admin` and seed a mock record:
   ```bash
   docker exec -it cos-plus psql -U cos_admin -d ios_plus -c "
   INSERT INTO evidence_packages (package_id, tenant_id, session_id, event_type, layer_depth, canonical_payload, signature, verification_key_id)
   VALUES ('e5187eea-77fd-443f-8417-3d0bb6e4a8f0', '8f7b5a82-120d-4bb8-8ad2-c8e9b88255af', 'd3e562da-3c6f-41b8-91ad-c6589cfa2d6f', 'WORM_COMMIT', 7, '{}', 'sig-bytes', 'e5187eea-77fd-443f-8417-3d0bb6e4a8f0');"
   ```
2. **Attempt an UPDATE (WORM Trigger Block Test):**
   ```bash
   docker exec -it cos-plus psql -U cos_admin -d ios_plus -c "
   UPDATE evidence_packages SET event_type = 'INFERENCE_REQUEST' WHERE package_id = 'e5187eea-77fd-443f-8417-3d0bb6e4a8f0';"
   ```
   *Expected Console Error Output:*
   ```text
   ERROR: WORM VIOLATION: UPDATE/DELETE blocked on table [evidence_packages]. Audit records are immutable. Evidence package_id: e5187eea-77fd-443f-8417-3d0bb6e4a8f0 Session: d3e562da-3c6f-41b8-91ad-c6589cfa2d6f
   ```
3. **Attempt a DELETE (WORM Trigger Block Test):**
   ```bash
   docker exec -it cos-plus psql -U cos_admin -d ios_plus -c "
   DELETE FROM evidence_packages WHERE package_id = 'e5187eea-77fd-443f-8417-3d0bb6e4a8f0';"
   ```
   *Expected Console Error Output:*
   ```text
   ERROR: WORM VIOLATION: UPDATE/DELETE blocked on table [evidence_packages]. Audit records are immutable. Evidence package_id: e5187eea-77fd-443f-8417-3d0bb6e4a8f0 Session: d3e562da-3c6f-41b8-91ad-c6589cfa2d6f
   ```

### 3.2 Local Vault Integration Verification
Verify that the `LocalFileKeyProvider` parses the signature key from the mounted file and signs output payloads correctly.

1. **Verify container startup logs:**
   ```bash
   docker compose logs middleware-engine | grep -i keyprovider
   ```
   *Expected Log Event:*
   ```json
   {"level":30,"time":"2026-05-26T23:51:04.120Z","pid":1,"path":"/run/secrets/vault_key.pem","msg":"Initialized LocalFileKeyProvider (On-Premises custody)"}
   ```
2. **Trigger an inference pipeline execution:**
   ```bash
   curl -X POST http://localhost:3001/v1/inference \
     -H "Content-Type: application/json" \
     -d '{"input": "What security rules apply to academic curriculum data under FERPA?"}'
   ```
3. **Verify the returned signature blocks:**
   Confirm that the response contains the cryptographic evidence package array, populated with an Ed25519 signature:
   ```json
   "evidencePackages": [
     {
       "packageId": "f8799495-f170-4a2e-b803-cd6f5e3a4a54",
       "signature": "w4VmqlxoLN0iWlxGfDKa5efSuU2z8bE5v-sdGVGPoKr18dOWd8lc99U6wOFGhZR-OBODf3AJ9DN_6UP2DNGlBQ",
       "signingAlgorithm": "Ed25519",
       "canonicalizationAlgorithm": "JCS/RFC8785"
     }
   ]
   ```

### 3.3 RAG Embedding Cache Verification
Verify that Redis caching works, reducing inference latency by bypassing OpenAI embedding generation.

1. **Submit a cold query:**
   ```bash
   curl -w "\nTotal Latency: %{time_total}s\n" -X POST http://localhost:3001/v1/inference \
     -H "Content-Type: application/json" \
     -d '{"input": "Verify compliance constraints for SOC 2 Trust Services Criteria."}'
   ```
   *Expected Cold Latency:* **`~0.65s`** (requires HTTP call to OpenAI embeddings).
2. **Resubmit the identical query (Warm run):**
   ```bash
   curl -w "\nTotal Latency: %{time_total}s\n" -X POST http://localhost:3001/v1/inference \
     -H "Content-Type: application/json" \
     -d '{"input": "Verify compliance constraints for SOC 2 Trust Services Criteria."}'
   ```
   *Expected Warm Latency:* **`~0.01s`** (retrieved directly from Redis cache).
3. **Inspect Redis Cache Keys:**
   ```bash
   docker exec -it redis redis-cli -a "$REDIS_PASSWORD" keys "rag:emb:*"
   ```
   *Expected output:*
   ```text
   1) "rag:emb:text-embedding-3-large:c19e530fb18a99479b183652ea93049182390aefccda9310"
   ```

---

## 4. EU AI Act Alignment Strategy

To guide Phase 3 expansion, the local compliance architecture will be scaled using the `ai_as_action_eu_ai_act.html` compliance matrix definitions:

1. **High-Risk AI System Classifications:**
   * The matrix maps high-risk domains (Education, Employment, Critical Infrastructure). 
   * Future vertical solution packs will load specific risk profile UCO nodes based on these matrix groups, matching the tenant's crosswalk profile.
2. **Deterministic Risk Checks:**
   * Grounding and verification checks (such as dataset bias tests and accuracy verifications) will be mapped into the Gate 530 sidecar as runtime dimensional evaluations (dimensions 1–6).
3. **Bridging the Gaps (From `technical_assessment.md`):**
   * **Claim 6 Deliberation:** We will replace simple single-thread logic with the multi-agent deliberation framework (Regulator, Risk, Suitability, Outcome agents) to satisfy full patent alignment in high-risk zones.
   * **Claim 8 Rate Limiting:** We will scale the rolling-window Redis counter implemented in Gate 530 to dynamically block execution paths if anomalous prompt loops threaten review pipelines.
