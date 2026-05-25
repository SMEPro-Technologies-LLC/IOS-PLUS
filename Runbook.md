# IOS+ Local Development Runbook
**SMEPro Technologies — EB Doc 6 §3.1**
Last updated: 2026-05-25

## Prerequisites
- Docker Desktop ≥ 4.28 with Compose v2
- Node.js 20.x + npm (for local builds / workspace tooling)
- PowerShell 7+ (Windows) or bash (macOS/Linux)

---

## 1. Environment Variables

Create `.env` in the project root. **Never commit this file.**

```dotenv
# --- Postgres ---
REDIS_PASSWORD=iosplus_dev_redis
COS_DB_PASSWORD_COS_ADMIN=iosplus_dev_admin
COS_DB_PASSWORD_IOS_APP=iosplus_dev_app
COS_DB_PASSWORD_AUDIT_WRITER=iosplus_dev_audit_writer
COS_DB_PASSWORD_AUDIT_READER=iosplus_dev_audit_reader
COS_DB_PASSWORD_RAG_READER=iosplus_dev_rag_reader
COS_DB_PASSWORD_RAG_WRITER=iosplus_dev_rag_writer

# --- Vault ---
VAULT_TOKEN=iosplus-dev-root-token
VAULT_TRANSIT_KEY_PATH=transit/keys/ios-evidence-signing

# --- Ed25519 signing key (dev throwaway — rotate for every environment) ---
SIGNING_KEY_PRIVATE_BASE64=<base64-encoded 32-byte raw private key scalar>
SIGNING_KEY_DNS_ZONE=_ios-signing-key.smeprotech.com
SIGNING_KEY_ACTIVE_ID=key-dev-001

# --- OpenAI ---
OPENAI_API_KEY=sk-...   # Rotate immediately if accidentally exposed

# --- Tenant ---
TENANT_ID=<uuid>
TENANT_NAICS_CODES=5415
TENANT_NAICS_EFFECTIVE_DATE=2026-01-01
```

### Generating a fresh Ed25519 dev keypair
```powershell
node -e "
const { generateKeyPairSync } = require('crypto');
const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  publicKeyEncoding:  { type: 'spki',  format: 'der' },
});
console.log('SIGNING_KEY_PRIVATE_BASE64=' + privateKey.slice(-32).toString('base64'));
console.log('SIGNING_KEY_PUBLIC_BASE64='  + publicKey.slice(-32).toString('base64'));
"
```

---

## 2. First-Time Stack Bring-Up

```powershell
# 1. Build all images
docker compose build

# 2. Start infrastructure (Postgres, Redis, Vault, Flyway)
docker compose up -d cos-plus redis vault-dev flyway

# 3. Wait for Flyway to finish (watch for "Exited (0)")
docker compose ps flyway

# 4. Initialize Vault transit secrets engine (ONE TIME ONLY)
docker exec vault-dev sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=iosplus-dev-root-token vault secrets enable transit"
docker exec vault-dev sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=iosplus-dev-root-token vault write -f transit/keys/ios-evidence-signing type=ed25519"

# 5. Start remaining services
docker compose up -d gate-530 middleware-engine

# 6. Verify
docker compose ps
docker compose logs middleware-engine --tail=20
```

Expected healthy log output:
```json
{"msg":"IOS+ Middleware Engine starting"}
{"port":3000,"msg":"REST transport listening"}
```

---

## 3. Day-to-Day Commands

```powershell
# Start everything
docker compose up -d

# Stop everything (preserves volumes)
docker compose down

# Tail all logs
docker compose logs -f

# Tail one service
docker compose logs middleware-engine -f

# Rebuild and recreate one service after code change
docker compose build --no-cache middleware-engine
docker compose up -d --force-recreate middleware-engine

# Destroy everything including volumes (full reset)
docker compose down -v
```

---

## 4. Database Migrations (Flyway)

Migrations live in `db/migrations/`. Flyway runs automatically on `docker compose up`.

| Version | File | Description |
|---|---|---|
| V1 | `V1__core_operational.sql` | Core operational tables |
| V2 | `V2__audit_worm.sql` | Evidence + WORM audit tables |
| V3 | `V3__rag_vault.sql` | RAG chunks (19 sector partitions + xsc) |
| V4 | `V4__uco_amendment.sql` | UCO nodes + evaluation results |
| V5 | `V5__rbac_app_roles.sql` | RBAC roles + GRANTs |

**To run migrations manually:**
```powershell
docker compose run --rm flyway `
  -url=jdbc:postgresql://cos-plus:5432/ios_plus `
  -user=cos_admin `
  -password=iosplus_dev_admin `
  migrate
```

**To add a new migration:** create `db/migrations/V6__description.sql` — Flyway picks it up on next run.

---

## 5. RBAC Role Model

| Role | Tables | Privileges |
|---|---|---|
| `ios_app` | Operational + evidence (SELECT/INSERT); RAG/UCO (SELECT only) | middleware-engine primary |
| `audit_writer` | `evidence_packages`, `gate_decisions`, `merkle_roots`, `ios_signing_keys`, `evidence_source_manifest`, `quarantine_records` | SELECT + INSERT only — WORM enforced (EB Doc 6 §4.2) |
| `audit_reader` | Evidence + compliance tables | SELECT only |
| `rag_reader` | All `rag_chunks_*` partitions + UCO + reference tables | SELECT only |
| `rag_writer` | All `rag_chunks_*` partitions + `rag_sources` + `rag_vault_sector_partitions` | SELECT + INSERT + UPDATE |

**Verify roles:**
```powershell
docker exec cos-plus psql -U cos_admin ios_plus -c "\du"
```

---

## 6. Vault Transit Key

Vault runs in **dev mode** (in-memory, HTTP only). The transit engine must be initialized once per container lifecycle — it does **not** persist across `docker compose down -v`.

```powershell
# Re-initialize after full reset
docker exec vault-dev sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=iosplus-dev-root-token vault secrets enable transit"
docker exec vault-dev sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=iosplus-dev-root-token vault write -f transit/keys/ios-evidence-signing type=ed25519"

# Verify
docker exec vault-dev sh -c "VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=iosplus-dev-root-token vault read transit/keys/ios-evidence-signing"
```

> ⚠️ Always use `VAULT_ADDR=http://...` (not https). Vault dev mode speaks plain HTTP.

---

## 7. Service Port Map

| Service | Host Port | Container Port | Notes |
|---|---|---|---|
| `cos-plus` | 5432 | 5432 | PostgreSQL 16 + pgvector |
| `redis` | 6379 | 6379 | Requires password from `.env` |
| `vault-dev` | 8200 | 8200 | HTTP only in dev mode |
| `middleware-engine` | **3001** | 3000 | REST API |

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND @ios-plus/*` | Runtime stage missing workspace `dist/` | Rebuild with `--no-cache`; check `docker/Dockerfile.middleware-engine` runtime COPY lines |
| `requireEnv(...) missing` | Variable absent from `.env` or not in `docker-compose.yml` environment block | Add to both files; recreate container |
| Vault `http: server gave HTTP response to HTTPS client` | CLI defaulted to HTTPS | Always pass `VAULT_ADDR=http://127.0.0.1:8200` inside `docker exec` |
| `flyway` exits non-zero | Migration SQL error or checksum mismatch | Check `docker compose logs flyway`; never edit applied migrations — add a new version |
| `middleware-engine` exits immediately | Unhealthy dependency | Confirm `cos-plus`, `redis`, `vault-dev` all show `Healthy` before engine starts |
