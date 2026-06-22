# IOS+ Deployment Readiness Matrix

> **Purpose:** Frank assessment of every component's production readiness. No marketing.  
> **Date:** 2025-06-21  
> **Assessed by:** Automated repo audit + manual code review  
> **Repo:** `https://github.com/smeprotech/ios-plus.git`

---

## Legend

| Score | Meaning |
|-------|---------|
| 0–2   | Missing / not started. Cannot deploy. |
| 3–4   | Partial / stubbed. Needs significant work before deploy. |
| 5–6   | Functional but unproven. Needs testing, hardening, or integration. |
| 7–8   | Production-viable with known gaps. Deployable with caveats. |
| 9–10  | Production-ready. Fully tested, hardened, and documented. |

---

## 1. API Gateway (`middleware-engine/src/server.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | api-gateway | |
| **Repo Path** | `packages/middleware-engine/src/server.ts` | Pure Node.js `http` server (no Express/Fastify) |
| **Runtime** | Node.js 20.19.0 | |
| **Dockerfile Status** | **partial** | Single multi-stage `Dockerfile` exists; builds entire monorepo but only starts `middleware-engine`. No per-service image. |
| **Helm/Kustomize Status** | **partial** | Helm chart exists but deploys monolithic image only. Raw K8s `api-gateway/deployment.yaml` is comprehensive but references non-existent `ios-plus-api` image. |
| **Health/Readiness Probes** | **defined, untested** | `/health` returns static JSON. `/ready` returns hardcoded `true` for all 7 subsystems (no actual dependency checks). `/metrics` returns custom Prometheus text but is not standard Prometheus client library. |
| **Secrets Required** | `DATABASE_URL`, `VAULT_ADDR`, `VAULT_TRANSIT_TOKEN`, `JWT_SECRET`, `API_KEY`, `ADMIN_JWT_SECRET`, `REDIS_HOST` | Helm templates reference Vault Agent injection + Secret Manager CSI. |
| **Dependencies** | PostgreSQL, Vault, Redis, Pub/Sub (optional), all 7 orchestrator layers | |
| **Test Coverage** | **0%** / target 80% / **missing** | No `*.test.ts` or `*.spec.ts` files exist anywhere in repo. `Dockerfile.test` has a coverage gate script but no tests to run. |
| **SLOs** | **missing** | No defined availability, latency, or error-rate targets. No SLO dashboard. |
| **Backup/Restore Requirements** | **undefined** | N/A for stateless gateway, but configuration backup (rules, policies) not defined. |
| **Runbook Link** | `tests/moonshot/README.md` (verification steps) | No operational runbook for incident response. |
| **Promotion Path** | dev → staging → prod via GitHub Actions + Cloud Deploy | CD workflow exists (`cd-gcp.yml`) with canary stages. |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **4** | Server starts, routes exist, but auth is incomplete, probes are fake, no tests, and `/ready` lies. |
| **Blockers** | 1. JWT auth does not verify signatures (`AuthLayer.verifyJwt` only parses payload). 2. Admin tokens are in-memory only (no persistence). 3. Rate limiting is in-memory Map (not Redis-backed, not HA-safe). 4. No request body size enforcement in `parseBody` (maxSize checked but not enforced before buffer accumulation). 5. No CORS origin validation (reflects any origin). 6. No tests. 7. No SLOs/SLIs. | |
| **Owner** | SMEPro | |

---

## 2. Canonical Layer Service (`cos-plus/connection.ts`, `evidence-store.ts`, `vector-store.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | canonical-layer-service (COS+) | |
| **Repo Path** | `packages/cos-plus/src/` | `connection.ts`, `evidence-store.ts`, `vector-store.ts`, `audit.ts`, `grants.ts`, `invariant.ts`, `migrations.ts`, `worm.ts` |
| **Runtime** | Node.js 20.19.0 + PostgreSQL 16 + pgvector | |
| **Dockerfile Status** | **partial** | Bundled into monolithic image. No standalone service image. |
| **Helm/Kustomize Status** | **missing** | No independent deployment manifest. COS+ is assumed to be a library consumed by middleware-engine. |
| **Health/Readiness Probes** | **missing** | No dedicated health endpoint for COS+ service. Database health check function (`healthCheck`) exists in `connection.ts` but is not exposed. |
| **Secrets Required** | `DATABASE_URL` (with SSL config), `DB_USER`, `DB_PASSWORD` | Connection code supports SSL but does not enforce certificate verification in all paths. |
| **Dependencies** | PostgreSQL + pgvector | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **partial** | Terraform Cloud SQL module has PITR enabled (7-day retention), automated backups. WORM verification script exists (`scripts/db/verify-worm.js`). No documented RTO/RPO. |
| **Runbook Link** | `tests/moonshot/README.md` (DB integrity section) | No COS+-specific operational runbook. |
| **Promotion Path** | Deployed as library with middleware-engine | No independent promotion. |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **4** | Connection pooling is robust (retry logic, SSL support, metrics). `evidence-store.ts` and `vector-store.ts` have types and interfaces but actual implementations are not fully wired into the middleware-engine (audit layer persists in-memory). |
| **Blockers** | 1. `evidence-store.ts` and `vector-store.ts` are not consumed by the middleware-engine's `AuditLayer` or `EvidenceLayer` (in-memory fallbacks used). 2. `grants.ts` exists but grant SQL is static; no dynamic role management. 3. `worm.ts` has types but no runtime WORM enforcement in Node.js layer (relies on DB triggers). 4. No tests. 5. No independent health probe. | |
| **Owner** | SMEPro | |

---

## 3. UDM Query Service (`uco-resolver/resolver.ts`, `traversal.ts`, `database.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | udm-query-service | |
| **Repo Path** | `packages/uco-resolver/src/` | `resolver.ts`, `traversal.ts`, `database.ts`, `crosswalk.ts`, `config.ts` |
| **Runtime** | Node.js 20.19.0 + PostgreSQL 16 | |
| **Dockerfile Status** | **partial** | Bundled into monolithic image. No standalone service image. |
| **Helm/Kustomize Status** | **missing** | No independent deployment manifest. |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | `DATABASE_URL` (pool passed in config) | |
| **Dependencies** | PostgreSQL (UCO nodes, crosswalk tables) | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **partial** | Relies on Cloud SQL backups (same as COS+). No UDM-specific restore procedure. |
| **Runbook Link** | `docs/Module1_ETL_Mapping_Specifications.md` | No operational runbook. |
| **Promotion Path** | Library dependency of middleware-engine | No independent promotion. |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **5** | `UcoResolver` is fully implemented: CIP→SOC→NAICS traversal, licensure lookup, crosswalk loading/validation, database queries. However, the `/v1/compliance/licensure/state-lookup` endpoint in `server.ts` returns a **stub** (hardcoded `unknown` status) and does not call `UcoResolver`. |
| **Blockers** | 1. API endpoint stubbed — `UcoResolver` is not imported or called by the middleware-engine. 2. `crosswalk.ts` loads from file paths; no cloud storage (GCS) adapter. 3. No caching layer for UDM queries (Redis unused). 4. No tests. 5. No independent deployability. | |
| **Owner** | SMEPro | |

---

## 4. Evidence Chain Service (`evidence-fabric/signer.ts`, `vault-transit.ts`, `jcs.ts`, `evidence.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | evidence-chain-service | |
| **Repo Path** | `packages/evidence-fabric/src/` | `evidence.ts`, `signer.ts`, `jcs.ts`, `vault-transit.ts`, `factory.ts`, `triple-publication.ts` |
| **Runtime** | Node.js 20.19.0 + TweetNaCl (Ed25519) | |
| **Dockerfile Status** | **partial** | Bundled into monolithic image. |
| **Helm/Kustomize Status** | **missing** | No independent deployment manifest. |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | `VAULT_TRANSIT_TOKEN`, `SIGNING_KEY_PATH` (for `LocalSigner`) | `vault-transit.ts` uses HashiCorp Vault Transit. `signer.ts` has a `LocalSigner` fallback that reads from filesystem. |
| **Dependencies** | HashiCorp Vault (or local key files) | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Key rotation (`rotateKeys`) archives to `.key-archive` but no backup strategy defined. Vault keys are external. |
| **Runbook Link** | `tests/moonshot/README.md` (evidence signing section) | |
| **Promotion Path** | Library dependency | |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **5** | `LocalSigner` is fully implemented with Ed25519, key rotation, archival. `JCS` canonicalization exists. `VaultTransit` client exists. However, the middleware-engine's `EvidenceLayer` does not call `evidence-fabric` — it creates stub evidence objects with `signature: 'deny'` and `hash: 'deny'`. |
| **Blockers** | 1. Middleware-engine does not use `evidence-fabric` package (stub evidence). 2. `LocalSigner` reads keys from local filesystem — not suitable for K8s without persistent volumes or secret injection. 3. No Vault integration test. 4. No tests. 5. No JCS test vectors against known-good implementations. | |
| **Owner** | SMEPro | |

---

## 5. Rules Engine (`gate-530/engine.ts`, `rules.ts`, `sector.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | rules-engine (Gate 530) | |
| **Repo Path** | `packages/gate-530/src/` | `engine.ts`, `rules.ts`, `sector.ts`, `config.ts`, `diagnostics.ts`, `transport.ts` |
| **Runtime** | Node.js 20.19.0 | |
| **Dockerfile Status** | **partial** | Bundled into monolithic image. |
| **Helm/Kustomize Status** | **missing** | No independent deployment manifest. K8s `rules-workflow/deployment.yaml` exists but references non-existent `ios-plus-rules-workflow` image. |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | None (in-memory rules) | |
| **Dependencies** | None (pure TypeScript engine) | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Rules are in-memory Map. No persistence layer defined. |
| **Runbook Link** | `tests/moonshot/README.md` (Gate 530 evaluation section) | |
| **Promotion Path** | Library dependency | Could be deployed as independent service via `rules-workflow` K8s manifest, but no Dockerfile. |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **6** | `Gate530Engine` is fully implemented with rule evaluation, sector registry, classification, decision synthesis, fail-closed semantics. `RuleEngine` has `evaluateRule`, `matchSector`, `sortByPriority`, `applyOverrides`. However, middleware-engine's `EvaluationLayer` does **not** call `Gate530Engine` — it has a stub `callGate530` that simulates logic with `filter(...effect === 'deny')`. |
| **Blockers** | 1. Middleware-engine `EvaluationLayer` is stubbed — does not import or call `@ios-plus/gate-530`. 2. Rules are in-memory only; no database-backed rule store. 3. No gRPC/HTTP transport for external evaluation. 4. No tests. 5. `diagnostics.ts` and `transport.ts` exist but are not imported by engine. | |
| **Owner** | SMEPro | |

---

## 6. Workflow Orchestrator (`middleware-engine/orchestrator.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | workflow-orchestrator | |
| **Repo Path** | `packages/middleware-engine/src/orchestrator.ts` | |
| **Runtime** | Node.js 20.19.0 | |
| **Dockerfile Status** | **partial** | Same monolithic image. |
| **Helm/Kustomize Status** | **partial** | Helm chart deploys this as the main container. |
| **Health/Readiness Probes** | **defined, untested** | `/ready` hardcodes all 7 layers as `true`. No actual dependency health checks. |
| **Secrets Required** | Same as API Gateway | |
| **Dependencies** | All 7 layers: Auth, Classification, Policy, Evaluation, Evidence, Retrieval, Audit | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | |
| **Runbook Link** | `tests/moonshot/README.md` | |
| **Promotion Path** | Part of monolithic deployment | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **4** | Orchestrator correctly sequences 7 layers with fail-closed semantics. However, 4 of 7 layers are significantly stubbed: Evaluation (stub), Evidence (stub), Retrieval (in-memory only), Audit (in-memory only). Auth is incomplete (no JWT sig verification). Classification has no ML model integration. Only Policy layer is moderately complete. |
| **Blockers** | 1. Layer integration is incomplete — orchestrator calls stubbed layers. 2. No circuit breaker or timeout between layers. 3. No async/batch processing mode. 4. No horizontal scaling considerations (stateful in-memory caches). 5. No tests. | |
| **Owner** | SMEPro | |

---

## 7. Approval Queue Service (`middleware-engine/layers/audit.ts` + admin routes in `server.ts`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | approval-queue-service | |
| **Repo Path** | `packages/middleware-engine/src/layers/audit.ts` + `server.ts` admin routes | |
| **Runtime** | Node.js 20.19.0 | |
| **Dockerfile Status** | **partial** | Same monolithic image. |
| **Helm/Kustomize Status** | **partial** | Part of monolithic Helm chart. |
| **Health/Readiness Probes** | **partial** | `/ready` claims audit is ready, but it is in-memory. |
| **Secrets Required** | `ADMIN_JWT_SECRET` (for admin routes) | Admin auth uses in-memory token store, not JWT. |
| **Dependencies** | None (in-memory) | |
| **Test Coverage** | **0%** / target 80% / **missing** | No tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Audit events are in-memory array (`events: AuditEvent[]`). No persistence. No WORM at the Node.js layer. |
| **Runbook Link** | `tests/moonshot/README.md` (audit trail section) | |
| **Promotion Path** | Part of monolithic deployment | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **3** | `AuditLayer` has good structure: event recording, integrity hashing, batching, WORM verification. However, `persistEvent` is a stub (`this.events.push(event)`). No database persistence. No integration with COS+ audit tables. Admin routes (`/admin/rules`, `/admin/audit`) exist but auth is in-memory token store. No RBAC integration. No approval workflow (just audit logging). |
| **Blockers** | 1. Audit events are not persisted to database. 2. No integration with COS+ `audit_events` table or WORM triggers. 3. Admin authentication is in-memory and insecure for production. 4. No approval queue logic (just audit logging). 5. No tests. 6. No event streaming to Pub/Sub for SIEM. | |
| **Owner** | SMEPro | |

---

## 8. Connector Ingestion Workers (`middleware-engine/connectors/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | connector-ingestion-workers | |
| **Repo Path** | `packages/middleware-engine/src/connectors/` | **Directory does not exist.** |
| **Runtime** | Node.js 20.19.0 (planned) | |
| **Dockerfile Status** | **missing** | No Dockerfile. K8s `connector-ingestion/deployment.yaml` references `ios-plus-connector` image that does not exist. |
| **Helm/Kustomize Status** | **partial** | Raw K8s manifest exists but no image. |
| **Health/Readiness Probes** | **missing** | Manifest defines probes but no code to serve them. |
| **Secrets Required** | `DATABASE_URL`, `REDIS_HOST`, `PUBSUB_PROJECT_ID` | Defined in K8s manifest. |
| **Dependencies** | PostgreSQL, Pub/Sub, Redis | |
| **Test Coverage** | **0%** / target 80% / **missing** | No code, no tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | |
| **Runbook Link** | **missing** | |
| **Promotion Path** | Cannot promote — no code | |
| **Production Wave** | Wave 3 | |
| **Current Readiness Score** | **1** | K8s manifest is comprehensive (Cloud SQL Auth Proxy sidecar, Secret Manager CSI, PodDisruptionBudget, anti-affinity, resource limits). But **no code exists**. |
| **Blockers** | 1. No source code. 2. No Dockerfile. 3. No connector implementations (Banner, AI service, regulatory crawler). 4. No ingestion protocol defined. 5. No message schema. | |
| **Owner** | shared (SMEPro to scaffold, Lamar to implement connectors) | |

---

## 9. ML Jobs (scoring jobs in `middleware-engine/layers/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | ml-jobs | |
| **Repo Path** | `packages/middleware-engine/src/layers/` | No ML-specific code. `evaluation.ts` has a `batchSize` config but no actual ML model calls. |
| **Runtime** | Node.js 20.19.0 (planned) | |
| **Dockerfile Status** | **missing** | No Dockerfile. K8s `ml-jobs/cronjob.yaml` references `ios-plus-ml-jobs` image. |
| **Helm/Kustomize Status** | **partial** | Raw K8s CronJobs exist (risk-scoring, drift-detection, accreditation-indexing). |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | `DATABASE_URL`, `REDIS_HOST`, `PUBSUB_PROJECT_ID`, `PUBSUB_TOPIC_ML_EVENTS` | |
| **Dependencies** | PostgreSQL, Pub/Sub, Redis, Vertex AI (planned) | |
| **Test Coverage** | **0%** / target 80% / **missing** | No code, no tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | |
| **Runbook Link** | **missing** | |
| **Promotion Path** | Cannot promote | |
| **Production Wave** | Wave 3 | |
| **Current Readiness Score** | **1** | K8s CronJobs are well-specified (schedules, resource limits, concurrency policy, Cloud SQL Auth Proxy). But **no ML job code exists**. `RAG_EMBEDDING_PROVIDER` env var is set to `vertex` but `RetrievalLayer` does not call Vertex AI. |
| **Blockers** | 1. No ML job source code. 2. No risk scoring model. 3. No drift detection implementation. 4. No Vertex AI integration. 5. No model versioning or A/B testing framework. | |
| **Owner** | shared | |

---

## 10. PostgreSQL + pgvector (`db/migrations/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | PostgreSQL + pgvector | |
| **Repo Path** | `db/migrations/`, `db/init/`, `db/grants/`, `db/seeds/` | |
| **Runtime** | PostgreSQL 16 + pgvector extension | |
| **Dockerfile Status** | **N/A** | Uses `pgvector/pgvector:pg16` image. |
| **Helm/Kustomize Status** | **missing** | No Helm chart for database. Terraform provisions Cloud SQL. K8s has `flyway/job.yaml` but no Flyway config. |
| **Health/Readiness Probes** | **partial** | `pg_isready` in docker-compose. No K8s readiness for Cloud SQL instance itself. |
| **Secrets Required** | `DB_PASSWORD` (randomly generated by Terraform), `DB_USER` | |
| **Dependencies** | GCE VPC peering, Cloud SQL Auth Proxy | |
| **Test Coverage** | **partial** | `scripts/db/verify-worm.js` exists. `docker-compose.test.yml` runs DB tests. No unit tests for migrations. |
| **SLOs** | **partial** | Terraform configures HA (`REGIONAL`), PITR, 7-day backups. No explicit SLO document. |
| **Backup/Restore Requirements** | **partial** | Terraform: `point_in_time_recovery_enabled=true`, `retained_backups=7`, transaction log retention 7 days. No documented RTO/RPO or restore drill results. |
| **Runbook Link** | `tests/moonshot/README.md` (DB integrity section) | No dedicated DB operational runbook. |
| **Promotion Path** | Terraform apply per environment | Migrations run via `scripts/db/migrate.js` (custom, not Flyway). |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **6** | Schema is comprehensive: 6 base migrations + 3 module migrations (`V11`, `V12`, `V13`, `V14`). WORM triggers, indexes, UDM views, audit retention. Seeds include CIP, SOC, crosswalk, compliance rules. Custom migration runner (`migrate.js`) exists but is not battle-tested. No Flyway or Liquibase. No migration rollback strategy. No pgvector-specific tuning. |
| **Blockers** | 1. Custom migration runner (`migrate.js`) — not proven at scale; no transaction safety documented. 2. No Flyway/Liquibase for production-grade migration control. 3. No migration rollback testing. 4. No pgvector index tuning (HNSW vs IVFFlat). 5. No connection pooling config (PgBouncer/Cloud SQL IAM). 6. No schema validation test suite. | |
| **Owner** | SMEPro | |

---

## 11. Redis (session caching)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | Redis | |
| **Repo Path** | **N/A** — no Redis code in repo. | |
| **Runtime** | Redis 7+ (planned) or Memorystore | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **missing** | No Redis deployment manifest. Terraform has `modules/cache/main.tf` but need to verify. |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | `REDIS_HOST`, `REDIS_PASSWORD` (if auth enabled) | |
| **Dependencies** | None | |
| **Test Coverage** | **missing** | No Redis integration code exists. Rate limiting in `server.ts` uses in-memory Map. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Memorystore supports persistence but not configured. |
| **Runbook Link** | **missing** | |
| **Promotion Path** | Terraform → K8s / Memorystore | |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **2** | `REDIS_HOST` is referenced in K8s manifests and Helm values, but **no Redis client code exists** in the application. Rate limiting is in-memory. Session caching is not implemented. No Redis deployment config. Terraform `cache` module may exist but is unverified. |
| **Blockers** | 1. No Redis client integration. 2. No Redis deployment (Helm/operator/Memorystore). 3. No session store implementation. 4. No distributed rate limiting. 5. No cache invalidation strategy. | |
| **Owner** | Lamar | |

---

## 12. Pub/Sub (event bus)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | Pub/Sub | |
| **Repo Path** | **N/A** — no Pub/Sub client code in repo. | |
| **Runtime** | Google Cloud Pub/Sub | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **partial** | Terraform `modules/pubsub/main.tf` exists. K8s manifests reference Pub/Sub topics. No application code to publish/consume. |
| **Health/Readiness Probes** | **missing** | |
| **Secrets Required** | `PUBSUB_PROJECT_ID`, service account with `roles/pubsub.publisher` / `roles/pubsub.subscriber` | |
| **Dependencies** | GCP IAM | |
| **Test Coverage** | **missing** | No Pub/Sub code to test. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Pub/Sub messages are ephemeral (default 7-day retention). No dead-letter queue configuration in app. |
| **Runbook Link** | **missing** | |
| **Promotion Path** | Terraform apply per environment | |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **2** | Terraform module exists for topic/subscription provisioning. K8s manifests define `PUBSUB_TOPIC_INGESTION`, `PUBSUB_TOPIC_ML_EVENTS`. But **no application code publishes or subscribes to Pub/Sub**. Event bus is not integrated. |
| **Blockers** | 1. No Pub/Sub client library integration. 2. No event schema/registry. 3. No publisher/subscriber implementations. 4. No dead-letter queue handling. 5. No exactly-once delivery semantics. | |
| **Owner** | Lamar | |

---

## 13. Frontend Apps (EDU Reporter React UI)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | frontend-apps (EDU Reporter) | |
| **Repo Path** | **N/A** — no React app code in repo. | `docs/EDU_Reporter_Spec.md` and `docs/edu-reporter-prototype.html` exist as design docs. |
| **Runtime** | React + Vite / Node.js (planned) | |
| **Dockerfile Status** | **missing** | K8s `frontend-apps/deployment.yaml` references `ios-plus-frontend` image (nginx serving static files). No Dockerfile or React source. |
| **Helm/Kustomize Status** | **partial** | Raw K8s manifest is comprehensive (nginx sidecar config, ConfigMap for API_BASE_URL, BackendConfig for GCLB). |
| **Health/Readiness Probes** | **partial** | Manifest defines probes against `/index.html` (static file). |
| **Secrets Required** | `API_BASE_URL` (ConfigMap, not secret) | |
| **Dependencies** | API Gateway | |
| **Test Coverage** | **0%** / target 80% / **missing** | No code. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Static assets should be in CI/CD artifact store. |
| **Runbook Link** | `docs/EDU_Reporter_Spec.md` | No operational runbook. |
| **Promotion Path** | Cannot promote | |
| **Production Wave** | Wave 3 | |
| **Current Readiness Score** | **1** | K8s manifest is production-grade (nginx hardening, GCLB BackendConfig, anti-affinity, resource limits). But **no React application code exists**. Only an HTML prototype and a spec document. |
| **Blockers** | 1. No React application code. 2. No build pipeline (Vite/Webpack). 3. No Dockerfile for frontend. 4. No auth integration (OAuth/SSO). 5. No API client generation. 6. No E2E tests (Cypress/Playwright). 7. No accessibility audit. | |
| **Owner** | shared | |

---

## 14. Monitoring (Prometheus/Grafana)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | monitoring | |
| **Repo Path** | `infra/monitoring/prometheus.yml`, `infra/monitoring/grafana/`, `infra/monitoring/alert-rules.yml` | |
| **Runtime** | Prometheus 2.52.0 + Grafana 10.4.0 | |
| **Dockerfile Status** | **N/A** | Uses upstream images. |
| **Helm/Kustomize Status** | **partial** | `prometheus-deployment.yaml` exists in K8s but no Grafana deployment in K8s (only in docker-compose). No Helm chart for monitoring stack. |
| **Health/Readiness Probes** | **partial** | Prometheus/Grafana have their own health endpoints. No custom health checks configured. |
| **Secrets Required** | `GF_SECURITY_ADMIN_PASSWORD` (Grafana, currently hardcoded `admin` in docker-compose) | |
| **Dependencies** | K8s cluster, service discovery | |
| **Test Coverage** | **missing** | No alert testing. No synthetic monitoring. |
| **SLOs** | **missing** | No SLOs defined, so no alert thresholds based on SLOs. |
| **Backup/Restore Requirements** | **undefined** | Grafana dashboards are JSON files in repo. Prometheus data is ephemeral. No Thanos/Cortex for long-term storage. |
| **Runbook Link** | `tests/moonshot/README.md` (metrics section) | No alert runbook. |
| **Promotion Path** | Manual K8s apply or Grafana Operator | |
| **Production Wave** | Wave 2 | |
| **Current Readiness Score** | **4** | Prometheus config is comprehensive (K8s SD, pod annotations, Vault metrics, PostgreSQL exporter, Redis exporter). Grafana dashboard JSON exists. Alert rules YAML exists but need to verify. However, monitoring stack is **not deployed via K8s** (only in docker-compose). No Alertmanager config. No Slack/PagerDuty notification channels. No SLO-based alerts. No distributed tracing (OpenTelemetry). Metrics endpoint in app is custom text format, not standard Prometheus client. |
| **Blockers** | 1. Monitoring stack not deployed in K8s (only docker-compose). 2. No Grafana deployment manifest. 3. No Alertmanager deployment. 4. No notification channel configuration. 5. App uses custom Prometheus text format (not official client library) — risk of format issues. 6. No OpenTelemetry tracing. 7. No synthetic monitoring / blackbox exporter. 8. No log aggregation (Cloud Logging/Fluent Bit). | |
| **Owner** | Lamar | |

---

## 15. CI/CD Pipeline (GitHub Actions)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | CI/CD pipeline | |
| **Repo Path** | `.github/workflows/` | `ci.yml`, `ci-gcp.yml`, `cd-gcp.yml`, `audit.yml`, `audit-gcp.yml`, `release.yml` |
| **Runtime** | GitHub Actions (ubuntu-latest) | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **N/A** | |
| **Health/Readiness Probes** | **N/A** | |
| **Secrets Required** | `GCP_PROJECT_ID`, `GCP_REGION`, `GAR_REPOSITORY`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `SNYK_TOKEN`, `STAGING_DATABASE_URL`, `PROD_DATABASE_URL`, `SLACK_WEBHOOK_URL` (commented out) | |
| **Dependencies** | GCP (GAR, Cloud Deploy, GKE), GitHub | |
| **Test Coverage** | **partial** | CI runs `test:coverage` but there are no tests. Coverage artifact is uploaded but will be empty. |
| **SLOs** | **missing** | No pipeline reliability SLOs. |
| **Backup/Restore Requirements** | **partial** | GitHub repo is the source of truth. No backup strategy for GitHub Actions history or secrets. |
| **Runbook Link** | `.github/workflows/README.md` | |
| **Promotion Path** | `ci.yml` → `ci-gcp.yml` → `cd-gcp.yml` (staging canary → production canary) | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **6** | CI/CD is **comprehensive** and well-architected: WIF auth (no long-lived keys), multi-stage buildx with layer caching, Snyk + Trivy + Checkov security scanning, Terraform fmt/validate/tflint, Helm lint, Cloud Deploy with canary (25%→50%→75%→100%), automatic rollback on smoke test failure, Slack notifications (commented out). **However**, the pipeline will fail at test stage because no tests exist. The `helm lint` in `ci.yml` references `infra/helm/ios-plus` but `ci-gcp.yml` references `infra/helm/charts/*/` which does not exist. Skaffold references `../k8s/overlays/*` but actual path is `../kubernetes/overlays/*`. Slack notifications are commented out. No artifact signing (Sigstore/cosign). |
| **Blockers** | 1. No tests — pipeline will produce empty coverage and fail gate if enforced. 2. `ci-gcp.yml` Helm lint path is wrong (`infra/helm/charts/*/` does not exist). 3. Skaffold path mismatch (`../k8s/` vs `../kubernetes/`). 4. No container image signing (cosign/Sigstore). 5. No SBOM generation in CI (though Trivy produces SARIF). 6. No automated promotion gates (manual `workflow_dispatch` for prod). 7. No branch protection rules enforced in CI. 8. No dependency update automation (Dependabot/Renovate). | |
| **Owner** | SMEPro | |

---

## 16. Terraform (`infra/terraform/gcp/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | Terraform (GCP infrastructure) | |
| **Repo Path** | `infra/terraform/gcp/` + `infra/terraform/` (root) | Modules: network, database, gke, cache, pubsub, storage, security, iam, cloud-armor |
| **Runtime** | Terraform 1.7.0+ | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **N/A** | |
| **Health/Readiness Probes** | **N/A** | |
| **Secrets Required** | GCS backend bucket (`cos-terraform-state-bucket`), service account key (or WIF for CI) | |
| **Dependencies** | GCP APIs: Compute, Container, SQL, Redis, Pub/Sub, Storage, Secret Manager, KMS, IAM, Binary Authorization | |
| **Test Coverage** | **partial** | `terraform validate` and `tflint` run in CI. No Terratest or Terraform plan policy testing. |
| **SLOs** | **missing** | No infrastructure SLOs. |
| **Backup/Restore Requirements** | **partial** | State stored in GCS. No state locking review (DynamoDB/Consul not needed for GCS). No state backup strategy. |
| **Runbook Link** | `infra/terraform/gcp/README.md` | |
| **Promotion Path** | `terraform plan` → PR review → `terraform apply` (staging) → `terraform apply` (production) | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **7** | Terraform is **comprehensive and well-structured**: 9 modules, GCS backend, Autopilot GKE with private nodes, Workload Identity, Cloud SQL (HA, PITR, IAM auth, pgvector), Cloud Armor, Memorystore (Redis), Pub/Sub, Cloud Storage, Secret Manager, KMS, IAM roles, Binary Authorization. **Gaps**: `main.tf` in GKE module has `master_authorized_networks_config` with `0.0.0.0/0` (open to internet). GKE maintenance window end_time is hardcoded to `2024-01-01T12:00:00Z` (past date). No Terraform drift detection in CI. No policy-as-code (Sentinel/OPA). No cost estimation in PRs. No environment-specific `tfvars` files committed (only `.example`). |
| **Blockers** | 1. GKE master authorized networks is `0.0.0.0/0` — security risk. 2. GKE maintenance window end_time is hardcoded past date. 3. No `terraform.tfvars` for staging/production (only `.example`). 4. No cost estimation / budget alerts in Terraform. 5. No VPC Service Controls. 6. No Terraform drift detection schedule. 7. No Infrastructure as Code policy enforcement (Sentinel/OPA). | |
| **Owner** | SMEPro | |

---

## 17. Kubernetes (`infra/kubernetes/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | Kubernetes manifests | |
| **Repo Path** | `infra/kubernetes/` | Namespaces, network policies, service accounts, deployments for api-gateway, connector, frontend, ml-jobs, rules-workflow, trust-model, normalization, flyway, monitoring |
| **Runtime** | GKE Autopilot (Terraform-provisioned) | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **partial** | Extensive raw K8s YAMLs. Kustomization base exists. Overlays for staging/production exist. Helm chart exists but is monolithic. **Kustomize overlays reference `../k8s/` but actual path is `../kubernetes/`** (Skaffold path mismatch). |
| **Health/Readiness Probes** | **defined** | All deployment manifests define liveness/readiness/startup probes. Not tested in production. |
| **Secrets Required** | Multiple `secretKeyRef` per service + Secret Manager CSI + Vault Agent | |
| **Dependencies** | GKE, Cloud SQL, Secret Manager, Vault | |
| **Test Coverage** | **missing** | No K8s manifest validation tests (kubeconform, kube-score). No K8s integration tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **partial** | PodDisruptionBudgets defined for API gateway. No Velero/Backup for GKE. |
| **Runbook Link** | `infra/kubernetes/` (self-documenting YAMLs) | No operational runbook. |
| **Promotion Path** | Kustomize overlay → Skaffold → Cloud Deploy | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **6** | K8s manifests are **production-grade** in structure: security contexts (non-root, read-only root FS, drop ALL capabilities), PodDisruptionBudgets, HPA, anti-affinity, topology spread, Cloud SQL Auth Proxy sidecars, Secret Manager CSI driver, network policies (default-deny + allow lists), service accounts with Workload Identity. **However**, many manifests reference images that do not exist (api-gateway, connector, frontend, ml-jobs, rules-workflow, trust-model). Namespaces and service accounts are defined but may not match actual GKE setup. No cert-manager for TLS. No Istio/Linkerd service mesh. No K8s policy enforcement (Kyverno/OPA Gatekeeper). |
| **Blockers** | 1. Images referenced in manifests do not exist as separate Dockerfiles. 2. Kustomize Skaffold path mismatch (`k8s` vs `kubernetes`). 3. No cert-manager / TLS termination in manifests. 4. No service mesh. 5. No K8s policy engine (Kyverno/OPA). 6. No backup solution (Velero). 7. No K8s cost allocation labels consistently applied. | |
| **Owner** | SMEPro | |

---

## 18. Cloud Deploy (`infra/cloud-deploy/`)

| Attribute | Status | Details |
|-----------|--------|---------|
| **Component Name** | Cloud Deploy (GCP delivery pipeline) | |
| **Repo Path** | `infra/cloud-deploy/` | `clouddeploy.yaml`, `skaffold.yaml`, `staging-target.yaml`, `production-target.yaml` |
| **Runtime** | Google Cloud Deploy | |
| **Dockerfile Status** | **N/A** | |
| **Helm/Kustomize Status** | **N/A** | Cloud Deploy uses Skaffold/Kustomize. |
| **Health/Readiness Probes** | **N/A** | Verification jobs are configured in CD pipeline (`verify: true` in `clouddeploy.yaml`). |
| **Secrets Required** | `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER` | |
| **Dependencies** | GKE, Cloud Deploy, GAR, Skaffold | |
| **Test Coverage** | **missing** | No Cloud Deploy pipeline tests. |
| **SLOs** | **missing** | |
| **Backup/Restore Requirements** | **undefined** | Cloud Deploy releases are managed by GCP. No pipeline backup needed. |
| **Runbook Link** | `docs/GCP_Deployment_Runbook.md` | |
| **Promotion Path** | `skaffold build` → `gcloud deploy releases create` → `gcloud deploy releases promote` (staging) → `gcloud deploy releases promote` (production canary) | |
| **Production Wave** | Wave 1 | |
| **Current Readiness Score** | **6** | Cloud Deploy pipeline is well-structured: canary deployment with percentages [25, 50, 75], verification gates, automatic rollback on failed verification. Skaffold has staging/production/local profiles. **However**, Skaffold references `../k8s/overlays/` but actual path is `../kubernetes/overlays/`. `clouddeploy.yaml` has a comment about automatic rollback but the actual rollback is handled by `cd-gcp.yml` GitHub Actions, not natively by Cloud Deploy service (the comment is misleading). No release promotion policy documented. No approval gates between staging and production. |
| **Blockers** | 1. Skaffold path mismatch (`k8s` vs `kubernetes`). 2. No release approval gates (manual or automated). 3. Misleading comment about automatic rollback — rollback is implemented in GitHub Actions, not Cloud Deploy service. 4. No release tagging strategy documented. 5. No canary analysis metrics (error rate, latency) — just smoke tests. 6. No parallel deployment environments (blue/green). | |
| **Owner** | SMEPro | |

---

## Summary by Production Wave

### Wave 1 (Critical Path — Must be ready before go-live)

| Component | Score | Primary Blocker |
|-----------|-------|-----------------|
| API Gateway | 4 | No tests, fake readiness probes, incomplete JWT auth |
| Workflow Orchestrator | 4 | 4 of 7 layers are stubbed |
| Approval Queue Service | 3 | Audit in-memory only, no persistence |
| PostgreSQL + pgvector | 6 | Custom migration runner, no Flyway |
| CI/CD Pipeline | 6 | No tests, path mismatches, no image signing |
| Terraform | 7 | GKE open to internet, hardcoded dates |
| Kubernetes | 6 | Images don't exist, path mismatches |
| Cloud Deploy | 6 | Path mismatches, no approval gates |

**Wave 1 Average Readiness: 5.25/10** — **Not deployable to production.**

### Wave 2 (Required for full feature set)

| Component | Score | Primary Blocker |
|-----------|-------|-----------------|
| Canonical Layer Service | 4 | Not wired into middleware-engine |
| UDM Query Service | 5 | API endpoint stubbed |
| Evidence Chain Service | 5 | Middleware-engine uses stub evidence |
| Rules Engine | 6 | Middleware-engine uses stub evaluation |
| Redis | 2 | No code, no deployment |
| Pub/Sub | 2 | No code, no integration |
| Monitoring | 4 | Not deployed in K8s, no alerts |

**Wave 2 Average Readiness: 4.0/10**

### Wave 3 (Future enhancements)

| Component | Score | Primary Blocker |
|-----------|-------|-----------------|
| Connector Ingestion Workers | 1 | No code exists |
| ML Jobs | 1 | No code exists |
| Frontend Apps | 1 | No code exists |

**Wave 3 Average Readiness: 1.0/10**

---

## Top 10 Blockers Across All Components

1. **No test files exist anywhere in the repository.** 0% coverage. CI will fail the 80% gate if enforced.
2. **Middleware-engine layers are largely stubbed.** Evaluation, Evidence, Retrieval, and Audit layers do not call their respective packages (`gate-530`, `evidence-fabric`, `rag-vault`, `cos-plus`).
3. **JWT authentication does not verify signatures.** `AuthLayer.verifyJwt` parses the payload but does not validate the signature with a secret or public key.
4. **Audit trail is in-memory only.** No database persistence, no WORM at the application layer, no Pub/Sub streaming.
5. **No per-service Dockerfiles.** Single monolithic Dockerfile builds everything but only runs middleware-engine. K8s manifests reference 7+ images that don't exist.
6. **Kustomize/Skaffold path mismatch.** `skaffold.yaml` references `../k8s/` but actual directory is `../kubernetes/`.
7. **GKE master authorized networks is `0.0.0.0/0`.** Terraform opens the Kubernetes control plane to the entire internet.
8. **No frontend application code.** K8s manifest exists but no React source, no build pipeline, no Dockerfile.
9. **No connector or ML job code.** K8s CronJobs and deployments exist but no source code.
10. **Redis and Pub/Sub are referenced in manifests but not integrated in application code.**

---

## Honest Assessment

This is a **well-architected, well-documented project with significant implementation gaps.** The infrastructure-as-code (Terraform, K8s, Cloud Deploy) is mature and production-oriented. The CI/CD pipeline is comprehensive. However, the **application layer is approximately 60% stubbed or incomplete**. The middleware-engine orchestrates 7 layers but 4 of them are stubs. No tests exist. No frontend exists. No connectors exist. No ML jobs exist.

**Bottom line:** The "plumbing" is ready for production. The "payload" is not.

| Layer | Status |
|-------|--------|
| Infrastructure (Terraform, K8s, Cloud Deploy) | **Ready with gaps** |
| CI/CD (GitHub Actions, security scanning) | **Ready with gaps** |
| Database schema + migrations | **Ready with gaps** |
| Middleware orchestrator structure | **Ready** |
| Middleware layer implementations | **~40% ready** |
| Auth & security | **Partial** |
| Observability | **Partial** |
| Tests | **Missing** |
| Frontend | **Missing** |
| Connectors / ML | **Missing** |

**Recommendation:** Do not attempt production deployment until Wave 1 average reaches ≥ 7.5. Focus the first 30 days on closing the top 10 blockers above.
