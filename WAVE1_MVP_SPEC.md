# IOS+ Platform — Production Wave 1 MVP Specification

**Version:** 1.0.0  
**Date:** 2025-01-15  
**Status:** Draft — Ready for Build  
**Owner:** Platform Engineering  
**Reviewer:** Security & Compliance

---

## 1. Purpose

Define and build the **smallest deployable unit that delivers value**: a standalone compliance decision API that accepts AI requests, evaluates them against policy, returns signed decisions, and stores evidence in a WORM-protected database.

### Value Proposition

| Before Wave 1 | After Wave 1 |
|---------------|--------------|
| No compliance enforcement for AI requests | Every AI request evaluated against policy with allow/deny/escalate |
| No audit trail for decisions | Every decision signed and stored in immutable evidence chain |
| Hardcoded health checks | Real readiness probes check database connectivity |
| JWT parsed but not verified | JWT signatures verified with `jose` (HS256 or RS256 via JWKS) |
| 0% test coverage | Unit tests for engine + integration tests for API |

---

## 2. Service Boundaries

### IN SCOPE (Wave 1)

| Component | Description | Status |
|-----------|-------------|--------|
| `gate-530-api` | HTTP/1.1 API server wrapping `Gate530Engine` | **NEW** |
| `Gate530Engine` | Core compliance decision engine (evaluate, classify, synthesize) | **EXISTING** |
| `LocalSigner` | Ed25519 evidence signing via `@ios-plus/evidence-fabric` | **EXISTING** |
| `ApiAuth` | JWT verification with `jose` (HS256 + JWKS RS256) | **NEW** |
| `ApiDatabase` | PostgreSQL pool with evidence + audit persistence | **NEW** |
| `WORM triggers` | PostgreSQL triggers blocking UPDATE/DELETE on audit + evidence | **EXISTING** |
| `/v1/evaluate` | Evaluate request → decision + signed evidence + DB persistence | **NEW** |
| `/v1/evidence/:id` | Retrieve evidence by request ID | **NEW** |
| `/health` | Liveness probe (process uptime) | **NEW** |
| `/ready` | Readiness probe with real DB connectivity check | **NEW** |
| `/metrics` | Prometheus-compatible metrics | **NEW** |
| `/admin/rules` | CRUD for policy rules (admin-only) | **NEW** |
| `/admin/audit` | Query audit events (admin-only) | **NEW** |
| Unit tests | `engine.test.ts` — 15+ test cases for `Gate530Engine` | **NEW** |
| Integration tests | `api.test.ts` — 12+ test cases for HTTP API | **NEW** |
| Dockerfile | Per-service multi-stage build for `gate-530` | **NEW** |
| `docker-compose.mvp.yml` | Local end-to-end stack (API + Postgres + migrations) | **NEW** |
| K8s manifests | Deployment + Service + ConfigMap + Kustomization | **NEW** |

### OUT OF SCOPE (Deferred to Wave 2)

| Component | Deferred Reason |
|-----------|-----------------|
| `middleware-engine` full 7-layer orchestrator | Only 3 layers implemented; needs 4 more |
| `rag-vault` | Vector search not needed for basic policy enforcement |
| `uco-resolver` | Licensure lookup requires external data feeds |
| `cos-plus` WORM enforcer class | PostgreSQL triggers already enforce WORM at DB level |
| Vault Transit signing | Local Ed25519 sufficient for MVP |
| ML-based classification | Rule-based classification sufficient for MVP |
| React frontend | No UI needed for API-only MVP |
| Connector ingestion | No external data sources in MVP |
| Full CI/CD pipeline | Basic GitHub Actions sufficient for Wave 1 |
| Multi-region / HA | Single replica with rolling updates |
| Cloud Armor / WAF | Internal API only; expose via Ingress in Wave 2 |

---

## 3. Architecture

```mermaid
graph LR
    A[Client / AI Service] -->|POST /v1/evaluate<br/>Bearer JWT| B[gate-530-api<br/>HTTP/1.1]
    B --> C[ApiAuth<br/>jose HS256/JWKS]
    C -->|authenticated| D[Gate530Engine<br/>evaluate/classify]
    D -->|decision| E[LocalSigner<br/>Ed25519]
    E -->|signed payload| F[ApiDatabase<br/>evidence_records]
    F --> G[(PostgreSQL<br/>WORM triggers)]
    B --> H[/health /ready<br/>/metrics]
    B --> I[/admin/rules<br/>/admin/audit]
```

### Request Flow

1. **Auth** — JWT signature verified via `jose` (HS256 secret or JWKS RS256)
2. **Evaluate** — `Gate530Engine.evaluate(context)` runs rule matching
3. **Decide** — Returns `allow` | `deny` | `escalate` with reason + confidence
4. **Sign** — `LocalSigner.sign()` creates Ed25519 signature over canonical payload
5. **Store** — Evidence record inserted into `evidence_records` (WORM-protected)
6. **Audit** — Audit event inserted into `audit_events` (WORM-protected)
7. **Respond** — JSON with decision, evidence signature, and eval duration

---

## 4. API Specification

### POST /v1/evaluate

Evaluate a request against compliance policy.

**Headers:**
```
Content-Type: application/json
Authorization: Bearer <JWT>
```

**Request Body:**
```json
{
  "requestId": "req-abc-123",
  "action": "access",
  "resource": { "classification": "pii", "id": "student-123" },
  "subject": { "id": "user-456", "role": "advisor" },
  "sector": "education",
  "environment": { "timeOfDay": "09:00", "location": "on-campus" },
  "metadata": { "source": "banner-api" }
}
```

**Response 200 (Allow):**
```json
{
  "requestId": "req-abc-123",
  "decision": {
    "action": "allow",
    "reason": "Rule allow-public matched: Allow public resources",
    "dimension": "operational",
    "confidence": 0.57,
    "metadata": { "timestamp": "2025-01-15T10:00:00.000Z" }
  },
  "evidence": {
    "signature": "base64-ed25519-sig...",
    "publicKey": "base64-ed25519-pub...",
    "algorithm": "Ed25519"
  },
  "evalDurationMs": 3
}
```

**Response 403 (Deny):**
```json
{
  "requestId": "req-abc-123",
  "decision": {
    "action": "deny",
    "reason": "Rule deny-pii matched: Deny PII access",
    "dimension": "data_privacy",
    "confidence": 0.95,
    "metadata": { "timestamp": "2025-01-15T10:00:00.000Z" }
  },
  "evidence": { "signature": "...", "publicKey": "...", "algorithm": "Ed25519" },
  "evalDurationMs": 2
}
```

**Response 401:** Authentication required or invalid JWT.

### GET /v1/evidence/:requestId

Retrieve evidence by request ID.

**Response 200:**
```json
{
  "id": "uuid",
  "requestId": "req-abc-123",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "decision": { "action": "deny", ... },
  "signature": "base64...",
  "publicKey": "base64...",
  "canonicalPayload": "{...}"
}
```

### GET /health

Liveness probe.

**Response 200:**
```json
{ "status": "healthy", "uptime": 42.5, "version": "1.0.0", "timestamp": "..." }
```

### GET /ready

Readiness probe with real dependency checks.

**Response 200:**
```json
{
  "ready": true,
  "checks": {
    "database": { "healthy": true, "latencyMs": 2 },
    "engine": { "healthy": true, "latencyMs": 0 },
    "signer": { "healthy": true, "latencyMs": 0 }
  },
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

**Response 503:** One or more dependencies unhealthy.

### GET /metrics

Prometheus-compatible metrics.

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total 42
http_requests_total{status="200"} 38
http_requests_total{status="403"} 4

# HELP http_request_duration_ms Average request duration
# TYPE http_request_duration_ms gauge
http_request_duration_ms_avg 12.50
http_request_duration_ms_p99 45.00

# HELP active_connections Current active connections
# TYPE active_connections gauge
active_connections 3
```

### POST /admin/rules

Create a new policy rule (admin only).

**Headers:** `Authorization: Bearer <admin-JWT>`

**Request Body:**
```json
{
  "id": "rule-custom-1",
  "name": "Custom Rule",
  "dimension": "security",
  "priority": 75,
  "condition": { "operator": "eq", "field": "action", "value": "delete" },
  "action": "deny",
  "enabled": true
}
```

### DELETE /admin/rules/:id

Delete a policy rule (admin only).

### GET /admin/audit

Query audit events (admin only).

**Query Params:** `actorId`, `operation`, `tableName`, `limit`, `offset`

---

## 5. Database Schema Used

Wave 1 uses the following tables from `001_initial_schema.sql` and `002_worm_triggers.sql`:

| Table | Purpose | WORM |
|-------|---------|------|
| `audit_events` | Immutable audit log of all evaluations and admin actions | Yes |
| `evidence_records` | Cryptographically signed evidence chain | Yes |
| `compliance_rules` | Mutable policy rules (loaded into engine at startup) | No |
| `schema_migrations` | Migration tracking | Yes |

### Evidence Record Insert

```sql
INSERT INTO evidence_records (
  id, request_id, timestamp, decision, signature, public_key, canonical_payload, previous_hash
) VALUES (...)
```

### Audit Event Insert

```sql
INSERT INTO audit_events (
  id, table_name, operation, record_id, old_data, new_data, actor_id, actor_type,
  session_id, ip_address, user_agent, timestamp
) VALUES (...)
```

---

## 6. Authentication Model

### JWT Verification

| Algorithm | Configuration | Use Case |
|-----------|---------------|----------|
| HS256 | `JWT_SECRET` env var | Development, single-tenant |
| RS256 / ES256 | `JWT_JWKS_URI` env var | Production, identity provider integration |

### Token Claims

```json
{
  "sub": "user-123",
  "type": "user",
  "permissions": ["gate530:evaluate"],
  "tenantId": "lamar-university",
  "iat": 1705312800,
  "exp": 1705316400,
  "iss": "ios-plus-wave1"
}
```

### Role-Based Access

| Role | `/v1/evaluate` | `/v1/evidence` | `/admin/rules` | `/admin/audit` |
|------|----------------|------------------|----------------|----------------|
| `user` | ✅ | ✅ | ❌ | ❌ |
| `service` | ✅ | ✅ | ❌ | ❌ |
| `admin` | ✅ | ✅ | ✅ | ✅ |

---

## 7. Deployment

### Local Development (Docker Compose)

```bash
# Start the full Wave 1 stack
docker compose -f docker-compose.mvp.yml up --build

# Run integration tests against the local stack
npm run test --workspace=@ios-plus/gate-530

# Health check
curl http://localhost:3001/ready

# Evaluate a request
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"requestId":"test-1","action":"access","resource":{"classification":"public"}}'
```

### Kubernetes (GKE)

```bash
# Set project and tag
export PROJECT_ID=your-gcp-project
export WAVE1_TAG=wave1-v1.0.0

# Build and push image
gcloud builds submit --tag gcr.io/$PROJECT_ID/gate-530-api:$WAVE1_TAG

# Create secrets (one-time)
kubectl create secret generic gate-530-db-credentials \
  --from-literal=database-url="postgresql://..."
kubectl create secret generic gate-530-jwt-secret \
  --from-literal=secret="your-production-secret"

# Apply manifests
kubectl apply -k k8s/wave1

# Verify
kubectl get pods -n api-gateway
kubectl logs -n api-gateway -l app=gate-530-api
```

---

## 8. Testing Strategy

### Unit Tests (`engine.test.ts`)

| Test | Assertion |
|------|-----------|
| Constructor loads rules | `engine.getRules().length === 1` |
| Invalid config throws | `throws Error` |
| Allow public resource | `decision.action === 'allow'` |
| Deny PII access | `decision.action === 'deny'` |
| Escalate high value | `decision.action === 'escalate'` |
| No rules match → allow | `decision.action === 'allow'` |
| Fail closed on error | `decision.action === 'deny'` |
| Priority ordering | Higher priority rule wins |
| Classify by dimension | `category === 'security'` |
| Synthesize deny | High confidence + security → deny |
| Synthesize escalate | Elevated confidence → escalate |
| Synthesize allow | Low confidence → allow |
| Empty synthesis → deny | `decision.action === 'deny'` |
| Add/remove rules | `length` changes correctly |
| Reject rule without id | `throws Error` |
| Metadata snapshot | Has `ruleCount`, `sectors`, `timestamp` |

### Integration Tests (`api.test.ts`)

| Test | Endpoint | Expected |
|------|----------|----------|
| Health returns 200 | GET /health | `status === 'healthy'` |
| Ready returns 200 | GET /ready | `ready === true` |
| Evaluate without auth | POST /v1/evaluate | `401` |
| Evaluate with valid JWT | POST /v1/evaluate | `200` + evidence |
| Evaluate with invalid JWT | POST /v1/evaluate | `401` |
| Allow public resource | POST /v1/evaluate | `decision.action === 'allow'` |
| Deny PII access | POST /v1/evaluate | `decision.action === 'deny'` |
| Retrieve evidence | GET /v1/evidence/:id | `200` + signature |
| Unknown evidence → 404 | GET /v1/evidence/unknown | `404` |
| Metrics returns Prometheus | GET /metrics | Contains `http_requests_total` |
| Admin rules requires admin | POST /admin/rules | `403` |
| Admin rules with admin role | POST /admin/rules | `201` + rule |

### Running Tests

```bash
# Unit tests only (no DB required)
npx vitest run packages/gate-530/src/__tests__/engine.test.ts

# Integration tests (requires PostgreSQL running)
npx vitest run packages/gate-530/src/__tests__/api.test.ts

# All tests
npm run test --workspace=@ios-plus/gate-530
```

---

## 9. Acceptance Criteria

### Functional

- [ ] `POST /v1/evaluate` returns `allow` for public resource access within 50ms
- [ ] `POST /v1/evaluate` returns `deny` for PII access within 50ms
- [ ] Every successful evaluation stores a signed evidence record in PostgreSQL
- [ ] Every evaluation stores an audit event in PostgreSQL
- [ ] Evidence records cannot be updated or deleted (WORM trigger blocks)
- [ ] Audit events cannot be updated or deleted (WORM trigger blocks)
- [ ] JWT tokens with valid signatures are accepted; invalid signatures rejected
- [ ] `/ready` returns `503` when PostgreSQL is unreachable
- [ ] `/metrics` returns Prometheus-compatible text with request counts and durations
- [ ] Admin endpoints reject non-admin tokens with `403`

### Non-Functional

- [ ] Container starts in < 10 seconds
- [ ] Memory usage stays below 512Mi under normal load
- [ ] CPU usage stays below 500m under normal load
- [ ] API handles 100 requests/second without error
- [ ] Health and ready probes respond within 5 seconds
- [ ] All tests pass (`engine.test.ts` + `api.test.ts`)

### Security

- [ ] JWT signature verification is mandatory (no `alg: none` bypass)
- [ ] Evidence keys are generated with 600 permissions and stored in `/data/keys`
- [ ] Database password is passed via secret, never logged
- [ ] Container runs as non-root user (UID 1001)
- [ ] Container drops all Linux capabilities

---

## 10. Known Limitations

| Limitation | Impact | Mitigation | Wave 2 Plan |
|------------|--------|------------|-------------|
| Single replica | No HA | Rolling updates with zero downtime | Add HPA + 2+ replicas |
| In-memory rate limit | Not distributed per pod | Acceptable for single replica | Redis-backed rate limiter |
| In-memory API keys | Lost on restart | Re-create via admin endpoint | External API key service |
| No JWKS caching | Fetches JWKS on every request | Low traffic in Wave 1 | Add in-memory JWKS cache |
| No evidence chain linking | `previous_hash` is null | Chain integrity via chronological order | Link to previous record hash |
| No connectors | No external data sources | Static rules sufficient | Add Banner/Blackboard connectors |
| No frontend | API-only interaction | Use curl / Postman / scripts | React admin dashboard |
| No ML classification | Rule-based only | Sufficient for policy enforcement | Add RAG-based classification |
| No Vault integration | Local Ed25519 keys only | Acceptable for single-tenant | Add Vault Transit signer |

---

## 11. Operational Runbook

### Start the Service

```bash
# Local dev
npm run start:api --workspace=@ios-plus/gate-530

# Docker Compose
docker compose -f docker-compose.mvp.yml up -d

# Kubernetes
kubectl apply -k k8s/wave1
```

### Health Checks

```bash
# Liveness
curl -f http://localhost:3001/health

# Readiness (includes DB check)
curl -f http://localhost:3001/ready

# Metrics
curl http://localhost:3001/metrics
```

### Troubleshooting

| Symptom | Check | Fix |
|---------|-------|-----|
| `ready` returns `503` | `curl /ready` | Verify `DATABASE_URL` and PostgreSQL connectivity |
| `401` on all requests | JWT secret / JWKS URI | Verify `JWT_SECRET` or `JWT_JWKS_URI` env var |
| `403` on admin endpoints | Token `type` claim | Ensure JWT has `"type": "admin"` |
| Container exits on start | `kubectl logs` | Check config validation errors in logs |
| Evidence not found | `GET /v1/evidence/:id` | Verify request ID matches evaluation request |

### Key Files

| File | Purpose |
|------|---------|
| `packages/gate-530/src/api-index.ts` | Entry point — wires config, DB, auth, server |
| `packages/gate-530/src/api-server.ts` | HTTP server — routes, handlers, middleware |
| `packages/gate-530/src/api-auth.ts` | JWT verification with `jose` |
| `packages/gate-530/src/api-db.ts` | PostgreSQL pool + evidence/audit storage |
| `packages/gate-530/src/api-config.ts` | Env var parsing and validation |
| `packages/gate-530/Dockerfile` | Per-service container build |
| `docker-compose.mvp.yml` | Local end-to-end stack |
| `k8s/wave1/` | Kubernetes manifests |

---

## 12. Cost Estimate

| Resource | Spec | Monthly Cost |
|----------|------|------------|
| GKE node (1 × e2-standard-2) | 2 vCPU, 8 GB | ~$50 |
| Cloud SQL (db-g1-small) | 1 vCPU, 1.7 GB | ~$25 |
| Container Registry | ~1 GB storage | ~$0.10 |
| Load balancer | 1 forwarding rule | ~$18 |
| **Total** | | **~$93/month** |

*Note: Wave 1 runs on a single GKE node and small Cloud SQL instance. Wave 2 will add HA and scale costs to ~$2,550/month.*

---

## 13. Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Engineering Lead | | | |
| Security Lead | | | |
| Compliance Lead | | | |
| Product Owner | | | |

---

## Appendix A: Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | HTTP server port |
| `HOST` | No | `0.0.0.0` | HTTP server bind address |
| `DATABASE_URL` | Yes* | — | Full PostgreSQL connection string |
| `DB_HOST` | Yes* | `localhost` | Database host (if no URL) |
| `DB_PORT` | No | `5432` | Database port |
| `DB_NAME` | No | `iosplus` | Database name |
| `DB_USER` | No | `iosplus` | Database user |
| `DB_PASSWORD` | Yes* | — | Database password |
| `DB_SSL` | No | `false` | Enable SSL |
| `JWT_SECRET` | Yes† | — | HS256 shared secret |
| `JWT_JWKS_URI` | Yes† | — | JWKS endpoint for RS256 |
| `JWT_ISSUER` | No | `ios-plus` | Expected JWT issuer |
| `JWT_AUDIENCE` | No | — | Expected JWT audience |
| `JWT_CLOCK_TOLERANCE_SECONDS` | No | `60` | Clock skew tolerance |
| `EVIDENCE_PRIVATE_KEY_PATH` | No | `/data/keys/evidence.key` | Ed25519 private key path |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `GATE530_FAIL_CLOSED` | No | `true` | Fail closed on engine errors |

\* Either `DATABASE_URL` or `DB_HOST` + `DB_PASSWORD` is required.  
† Either `JWT_SECRET` or `JWT_JWKS_URI` is required.

---

## Appendix B: File Inventory

### New Files (Wave 1)

```
packages/gate-530/src/api-config.ts      # Server configuration
packages/gate-530/src/api-db.ts          # Database layer
packages/gate-530/src/api-auth.ts        # JWT verification
packages/gate-530/src/api-server.ts     # HTTP server
packages/gate-530/src/api-index.ts      # Entry point
packages/gate-530/src/__tests__/engine.test.ts   # Unit tests
packages/gate-530/src/__tests__/api.test.ts      # Integration tests
packages/gate-530/Dockerfile             # Per-service build
packages/gate-530/package.json           # Updated dependencies
docker-compose.mvp.yml                  # Local stack
k8s/wave1/gate-530-deployment.yaml      # K8s deployment
k8s/wave1/gate-530-service.yaml         # K8s service
k8s/wave1/gate-530-configmap.yaml       # K8s config
k8s/wave1/kustomization.yaml            # Kustomize base
WAVE1_MVP_SPEC.md                       # This document
```

### Modified Files

```
packages/gate-530/src/index.ts          # Added API exports
```

### Existing Files Used (No Changes)

```
packages/gate-530/src/engine.ts         # Core decision engine
packages/gate-530/src/rules.ts        # Rule evaluation
packages/gate-530/src/sector.ts       # Sector registry
packages/gate-530/src/config.ts       # Engine configuration
packages/gate-530/src/diagnostics.ts   # Health check framework
packages/gate-530/src/transport.ts     # HTTP/2 + IPC transport (not used in Wave 1)
packages/evidence-fabric/src/signer.ts # Local Ed25519 signer
packages/evidence-fabric/src/index.ts  # Evidence exports
db/migrations/001_initial_schema.sql  # Core schema
db/migrations/002_worm_triggers.sql   # WORM enforcement
```
