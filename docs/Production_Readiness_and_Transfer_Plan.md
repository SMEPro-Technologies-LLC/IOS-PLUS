# Production Readiness & Transfer Plan

> **Document ID:** IOS-PLUS-PROD-001  
> **Version:** 1.0.0  
> **Status:** DRAFT — Pending SMEPro & Lamar Review  
> **Classification:** Internal — Commercial in Confidence  
> **Last Updated:** 2025-06-21

---

## 1. Executive Summary

### 1.1 Current State

The IOS+ repository contains **221 files** spanning a materially hardened integration candidate for compliance-native AI enforcement. The codebase is organized as a TypeScript monorepo with seven core packages, PostgreSQL WORM persistence, HashiCorp Vault integration, and GCP-oriented infrastructure-as-code. However, it remains **spec-heavy and documentation-dominant** relative to runnable production artifacts:

- **Code ratio:** ~40% PLpgSQL/HCL (database + infrastructure), ~35% TypeScript (packages), ~25% documentation and specs.
- **No compiled frontend applications:** The `frontend-apps` Kubernetes manifests exist, but no actual Next.js/React build artifacts or EDU Reporter UI codebase is present in the repository.
- **Connector workers are skeletal:** Kubernetes Deployment manifests for Banner/Ethos, Blackboard, and Concourse ingestion exist, but the actual worker implementations (ETL pipelines, API adapters, normalization logic) are not yet committed.
- **ML jobs are manifest-only:** A CronJob manifest exists for ML workloads, but the risk-scoring, drift-detection, and accreditation-indexing job implementations are not present.
- **Pub/Sub and Redis are infrastructure-only:** Terraform modules provision these services, but no operational consumer/producer code is wired into the application packages.
- **CI/CD is scaffolded but not validated end-to-end:** GitHub Actions workflows exist for CI, CD, audit, and release, but the GCP Workload Identity Federation (WIF) configuration, Cloud Deploy pipeline, and actual staging/production environments have not been exercised by Lamar.

### 1.2 Target State

> **Clone → bootstrap → deploy in 2 hours, with zero tribal knowledge.**

Lamar University (or any licensed operator) must be able to:

1. Clone the repository from their own GitHub org.
2. Run `cp .env.example .env`, populate secrets, and execute `docker compose up` for local validation.
3. Run `terraform apply` to provision a fresh GCP project (or equivalent on-prem stack).
4. Push to `main` and watch GitHub Actions build, test, and deploy to staging via Cloud Deploy.
5. Access the EDU Reporter UI, verify health/ready/metrics endpoints, and confirm WORM enforcement via the `/api/v1/worm/status` endpoint.
6. Restore from a backup within the documented RPO/RTO without SMEPro involvement.

### 1.3 Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| 1 | **Independent Deployment** | Lamar deploys to a fresh GCP project without SMEPro personnel on a call. |
| 2 | **Clean Repository** | Zero hardcoded SMEPro references; all identifiers parameterized. |
| 3 | **Verified WORM** | `npm run db:verify-worm` passes in CI on every commit. |
| 4 | **Smoke Tests Pass** | `/health`, `/ready`, `/metrics`, `/v1/compliance/licensure/state-lookup`, and `/v1/evaluate` return 200/expected responses. |
| 5 | **Evidence Chain Valid** | Ed25519-signed evidence produces a verifiable JCS-canonicalized payload. |
| 6 | **Gate 530 Operational** | A request to `/v1/evaluate` returns `ALLOW`, `DENY`, or `ESCALATE` with correct metadata. |
| 7 | **Frontend Accessible** | EDU Reporter UC-01 dashboard loads and renders data from PostgreSQL. |
| 8 | **Backup/Restore Tested** | Cloud SQL PITR restore to a new instance completes within RTO (4 hours). |
| 9 | **Documentation Complete** | Runbooks exist for deployment, incident response, and disaster recovery. |
| 10 | **Support Model Clear** | Roles and SLAs are defined for SMEPro as contributor vs. vendor. |

### 1.4 90-Day Timeline with 3 Waves

| Wave | Dates | Theme | Exit Criteria |
|------|-------|-------|---------------|
| **Wave 1** | Days 1–45 | Core Platform | Local `docker compose up`, CI/CD passes, staging deploys, WORM + evidence + Gate 530 + one connector + one frontend operational. |
| **Wave 2** | Days 46–75 | Operational Workflows | All connectors, normalization pipelines, regulatory ingest, 7 UC dashboards, Pub/Sub event bus, observability, security hardening. |
| **Wave 3** | Days 76–90 | Advanced & Governance | ML jobs, Regulatory Watchtower, AI governance automation, DR rehearsal, formal handoff. |

---

## 2. Production Readiness Assessment

Each component is scored 0–10 across five dimensions. A score of **≥6** in all dimensions is required for Wave 1 transfer. **≥8** is required for production.

| Component | Completeness | Testability | Documentation | Security | Observability | **Wave 1 Ready?** |
|-----------|-------------|-------------|---------------|----------|---------------|-------------------|
| 1. api-gateway (middleware-engine server) | **6** — Server exists, routes defined, but no load-tested TLS termination or rate-limiting at edge. | **7** — Vitest unit tests exist; no integration load tests. | **7** — README covers local dev; no runbook for production ops. | **5** — Admin JWT auth present, but no OIDC/SAML, no mTLS, no WAF rules tested. | **6** — `/health`, `/ready`, `/metrics` exist; Prometheus scrape configured; no alerts wired. | **Conditional** |
| 2. canonical-layer-service (cos-plus + evidence store) | **6** — Connection, audit, WORM, vector-store, and evidence-store modules exist. Migration and verify scripts present. | **7** — `verify-worm.js` script runs in CI; no chaos/rollback tests. | **6** — Inline code comments; `db/grants/apply.sql` for RBAC; no DBA runbook. | **5** — Grants SQL exists; no column-level encryption, no IAM database auth, no secret rotation. | **5** — No DB-specific metrics exported; no slow-query alerting. | **Conditional** |
| 3. udm-query-service (uco-resolver) | **5** — Resolver, traversal, crosswalk, and database modules exist. Licensure lookup endpoint is stubbed. | **4** — No dedicated UDM test suite; stubbed in server.ts. | **5** — `COS_UDM_Review_Expansion_Report.md` is comprehensive but not a runbook. | **6** — No PII handling documented; read-only by design reduces risk. | **3** — No UDM-specific metrics or tracing. | **No** |
| 4. evidence-chain-service (evidence-fabric) | **7** — Ed25519 signing, JCS canonicalization, triple-publication, Vault transit support all implemented. | **6** — Unit tests for signer and JCS; no end-to-end verification of triple-publication. | **6** — README describes architecture; no operational runbook for key rotation. | **6** — Vault transit integration present; no HSM or offline key ceremony documented. | **5** — Signing latency not exposed as metric; no alert on failed evidence creation. | **Conditional** |
| 5. rules-engine (gate-530) | **7** — Engine, rules, sector, transport, config, and diagnostics modules exist. IPC and HTTP/2 transport supported. | **6** — Unit tests for engine; no property-based or chaos tests. | **6** — Inline docs; no runbook for rule updates or debugging denials. | **6** — Fail-closed by design; no admin mutation audit log beyond memory store. | **5** — Diagnostics exist but not wired to Prometheus. | **Conditional** |
| 6. workflow-orchestrator (middleware-engine orchestrator) | **6** — 7-layer orchestration (auth, classification, policy, evaluation, evidence, retrieval, audit) implemented. | **6** — Moonshot test framework scaffolded; no full integration test. | **6** — Architecture described in spec; no operational runbook. | **5** — Admin routes require JWT; no RBAC granularity, no API key rotation. | **5** — Metrics aggregated in server; no distributed tracing. | **Conditional** |
| 7. approval-queue-service (admin routes + audit) | **5** — Admin routes exist in `server.ts` (`/admin/rules`, `/admin/audit`). No standalone approval-queue service. | **4** — Basic auth tests; no approval workflow integration tests. | **4** — No dedicated approval-queue documentation. | **5** — Admin JWT only; no MFA, no session binding, no IP allowlisting. | **4** — Admin mutations logged to memory; no persistent audit trail for admin actions. | **No** |
| 8. connector-workers (Banner, Blackboard, Concourse) | **2** — Kubernetes Deployment manifests exist only. No actual worker code, ETL logic, or API adapters. | **1** — No tests. | **3** — `Module1_Integration_Guide.md` describes interfaces; no worker runbook. | **3** — No credential management for SIS/LMS APIs. | **1** — No metrics. | **No** |
| 9. ML jobs (risk scoring, drift detection, load indexing) | **2** — Kubernetes CronJob manifest exists only. No ML job implementations. | **1** — No tests. | **3** — `Module3_AI_Governance_Framework.md` describes intent; no ML pipeline runbook. | **3** — No model governance or explainability tooling present. | **1** — No metrics. | **No** |
| 10. PostgreSQL / pgvector | **7** — Migrations 001–006 + V11–V14 present. pgvector extension configured. WORM triggers implemented. | **7** — WORM verification in CI; no backup/restore integration test. | **6** — Migration scripts documented; no DBA runbook for replication, failover. | **6** — RBAC grants exist; no column-level encryption, no IAM database auth. | **5** — No pgvector-specific metrics or slow-query alerting. | **Conditional** |
| 11. Redis (session caching) | **4** — Terraform module provisions Memorystore Redis. No application-level session caching code. | **1** — No tests. | **4** — Terraform module documented; no Redis ops runbook. | **5** — Basic auth via Redis; no TLS, no ACLs configured. | **2** — No Redis metrics exported. | **No** |
| 12. Pub/Sub (event bus) | **4** — Terraform module provisions topics and subscriptions. No publisher/consumer code in packages. | **1** — No tests. | **4** — Terraform module documented; no event schema or ops runbook. | **5** — IAM bindings in Terraform; no dead-letter queue monitoring. | **2** — No Pub/Sub metrics exported. | **No** |
| 13. frontend-apps (EDU Reporter UI) | **2** — Kubernetes Deployment manifest and `edu-reporter-prototype.html` exist. No actual Next.js/React application. | **1** — No tests. | **5** — `EDU_Reporter_Spec.md` is comprehensive; no UI component docs. | **3** — No CSP, no XSS protection, no auth integration for frontend. | **1** — No frontend metrics. | **No** |
| 14. monitoring (Prometheus/Grafana) | **6** — Prometheus and Grafana configs present; alert-rules.yml scaffolded. | **4** — No automated alerting tests. | **6** — Dashboard JSON present; no runbook for alert response. | **6** — No secrets in configs; no network policy for monitoring stack. | **6** — Prometheus scrapes configured; Grafana dashboards not tested with live data. | **Conditional** |
| 15. CI/CD pipeline | **6** — GitHub Actions workflows for CI, CD, audit, release. WIF configured. Cloud Deploy manifests present. | **5** — CI runs locally; CD not validated against live GCP project. | **6** — Workflow README exists; no runbook for pipeline debugging. | **6** — WIF used instead of long-lived keys; no SAST/DAST in pipeline. | **5** — No pipeline failure alerting. | **Conditional** |
| 16. Terraform infrastructure | **7** — GKE, Cloud SQL, Redis, Pub/Sub, Storage, IAM, Cloud Armor modules all present. | **5** — No Terraform plan validation in CI; no drift detection. | **7** — `GCP_Deployment_Runbook.md` is detailed; no on-prem equivalent. | **6** — Workload Identity, private cluster, shielded nodes, Cloud Armor WAF. No Binary Authorization policy. | **5** — No infrastructure metrics or cost alerting. | **Conditional** |

### 2.1 Assessment Summary

- **Wave 1 Ready (≥6 in all dimensions):** 0 components.
- **Conditional (5–6 in one dimension):** api-gateway, cos-plus, evidence-fabric, gate-530, middleware-engine, PostgreSQL, monitoring, CI/CD, Terraform.
- **Not Ready (<5 in any dimension):** uco-resolver, approval-queue, connector-workers, ML jobs, Redis, Pub/Sub, frontend-apps.

**Critical Path:** Before any transfer, the 9 "Conditional" components must be hardened to ≥6 across all dimensions, and the 7 "Not Ready" components must reach at least 5 in every dimension for Wave 1 scope.

---

## 3. Production Wave Scoping

### 3.1 Wave 1 (Days 1–45): Core Platform

**Objective:** Establish the minimum viable platform that can be deployed, monitored, and operated by Lamar without SMEPro intervention.

| # | Deliverable | Owner | Deadline | Acceptance Criteria |
|---|-------------|-------|----------|---------------------|
| 1.1 | **PostgreSQL + pgvector + WORM + Migrations (V1–V14)** | SMEPro | Day 10 | `docker compose up` starts postgres; `npm run db:migrate` applies all 10 migrations; `npm run db:verify-worm` returns `PASS`; no ERROR in migration logs. |
| 1.2 | **API Gateway (middleware-engine server.ts)** | SMEPro | Day 15 | `/health` returns 200; `/ready` returns 200 with all 7 layers `true`; `/metrics` returns Prometheus text; `/v1/evaluate` returns structured decision; `/v1/compliance/licensure/state-lookup` returns mock or real data. |
| 1.3 | **Evidence Chain (evidence-fabric)** | SMEPro | Day 20 | `POST /v1/inference` produces an evidence record with `Ed25519` signature; verification script (`verify-evidence.ts`) returns `valid: true`. |
| 1.4 | **Rules Engine (gate-530)** | SMEPro | Day 20 | `POST /v1/evaluate` with test payload returns `ALLOW` for benign content, `DENY` for forbidden content, `ESCALATE` for ambiguous content. |
| 1.5 | **Auth/RBAC (middleware-engine auth layer)** | SMEPro | Day 25 | Admin routes require valid JWT; non-admin token returns 403; `POST /admin/rules` creates a rule and logs mutation to audit. |
| 1.6 | **One Connector (Banner/Ethos as proof of concept)** | SMEPro | Day 30 | Connector worker runs as K8s Deployment; pulls mock data from a test Banner API; normalizes to COS+ schema; writes to PostgreSQL. |
| 1.7 | **One Frontend (EDU Reporter shell with UC-01 dashboard)** | SMEPro | Day 35 | Next.js app builds; serves UC-01 dashboard; fetches data from `/v1/compliance/licensure/state-lookup`; renders without errors. |
| 1.8 | **Logging/Monitoring (health, ready, metrics endpoints)** | SMEPro | Day 15 | Prometheus scrapes `/metrics` successfully; Grafana dashboard shows request rate, latency, error rate; alert rules loaded. |
| 1.9 | **CI/CD Skeleton (GitHub Actions with WIF)** | SMEPro + Lamar | Day 25 | CI passes on every PR (lint, typecheck, test, build, WORM verify); CD deploys to staging on merge to `main` using WIF; no long-lived GCP keys. |
| 1.10 | **Terraform Bootstrap (network + GKE + database + storage)** | SMEPro | Day 30 | `terraform apply` to fresh GCP project completes in <30 min; GKE cluster, Cloud SQL, Redis, Pub/Sub, Storage buckets all provisioned. |
| 1.11 | **Backup/Restore (Cloud SQL PITR tested)** | SMEPro | Day 40 | PITR enabled on Cloud SQL; test restore to a new instance succeeds; RPO documented as ≤10 min, RTO documented as ≤4 hours. |
| 1.12 | **SMEPro Reference Remediation (Wave 1 blockers)** | SMEPro | Day 10 | All Wave 1 blocker references removed (see Section 5). |
| 1.13 | **Environment Contract Templates (all 15 components)** | SMEPro | Day 10 | Section 6 of this document completed and validated. |
| 1.14 | **Runbook: Local Development** | SMEPro | Day 15 | `docs/runbooks/local-development.md` exists; `docker compose up` works from clean clone. |
| 1.15 | **Runbook: Staging Deployment** | SMEPro | Day 25 | `docs/runbooks/staging-deployment.md` exists; Lamar can follow it to deploy without a call. |

#### Wave 1 Dependencies & Critical Path

```
Day 1-10:  Remediation (1.12) + Contracts (1.13) + DB (1.1)
    │
    ▼
Day 10-20: API Gateway (1.2) + Evidence (1.3) + Rules (1.4) + Monitoring (1.8)
    │
    ▼
Day 20-30: Auth (1.5) + CI/CD (1.9) + Terraform (1.10) + Connector (1.6)
    │
    ▼
Day 30-40: Frontend (1.7) + Backup/Restore (1.11) + Runbooks (1.14, 1.15)
    │
    ▼
Day 40-45: Wave 1 Exit Criteria Validation & Go/No-Go
```

---

### 3.2 Wave 2 (Days 46–75): Operational Workflows

**Objective:** Make the platform operationally complete for Lamar's daily use cases.

| # | Deliverable | Owner | Deadline | Acceptance Criteria |
|---|-------------|-------|----------|---------------------|
| 2.1 | **Blackboard + Concourse Connectors** | SMEPro | Day 55 | Two additional connector workers operational; data normalized to COS+ schema; ingestion logs visible. |
| 2.2 | **Normalization Pipelines (ETL CronJobs)** | SMEPro | Day 55 | CronJobs run on schedule; transform raw SIS/LMS data to COS+ UDM; handle duplicates and schema drift. |
| 2.3 | **Regulatory Ingest (IPEDS, CBM, SACSCOC)** | SMEPro | Day 60 | IPEDS CBM009A, CBM00S, CBM00A, CBM00B, SACSCOC templates ingested; data mapped to UDM fields; cross-form validation passes. |
| 2.4 | **Workflow Engine (Approval Queues, Gate 530 Dynamic Rules)** | SMEPro | Day 60 | Approval queue service deployed; admin can create rules via UI; Gate 530 picks up new rules within 5 minutes. |
| 2.5 | **All 7 UC Dashboards in EDU Reporter** | SMEPro | Day 70 | UC-01 through UC-07 dashboards render with real or high-fidelity mock data; drill-down and export work. |
| 2.6 | **Pub/Sub Event Bus Operational** | SMEPro | Day 55 | Events published on connector ingestion, rule change, evidence creation; consumers process without loss; dead-letter queue monitored. |
| 2.7 | **Observability Expansion (Alerts, Dashboards, Tracing)** | SMEPro | Day 65 | Grafana alerts routed to PagerDuty/Slack; 4 Golden Signals dashboard; distributed tracing via Cloud Trace. |
| 2.8 | **Security Hardening (SAST/DAST, Penetration Test)** | SMEPro | Day 70 | SAST in CI (Semgrep or CodeQL); DAST in staging; penetration test report with no Critical/High findings unresolved. |
| 2.9 | **Runbook: Incident Response** | SMEPro | Day 65 | `docs/runbooks/incident-response.md` exists; defines SEV levels, escalation path, rollback procedure. |
| 2.10 | **Runbook: Regulatory Reporting Workflow** | SMEPro | Day 70 | `docs/runbooks/regulatory-reporting.md` exists; step-by-step for IPEDS/CBM/SACSCOC generation. |

---

### 3.3 Wave 3 (Days 76–90): Advanced & Governance

**Objective:** Deploy ML governance, regulatory watchtower, and complete the formal handoff.

| # | Deliverable | Owner | Deadline | Acceptance Criteria |
|---|-------------|-------|----------|---------------------|
| 3.1 | **ML Jobs (Risk Scoring, Drift Detection, Accreditation Indexing)** | SMEPro | Day 80 | CronJobs run daily; risk scores written to PostgreSQL; drift detection alerts on model degradation; accreditation index queryable. |
| 3.2 | **Regulatory Watchtower (UC-08) with Firecrawl** | SMEPro | Day 82 | Firecrawl scrapes regulatory sites; changes detected within 24 hours; alerts published to Pub/Sub. |
| 3.3 | **AI Governance Automation (Module 3 Enforcement)** | SMEPro | Day 85 | Module 3 policies enforced at Gate 530; AI governance dashboard shows compliance posture; automated reports generated. |
| 3.4 | **Advanced Governance (Explainability, Trace Chain Visualization)** | SMEPro | Day 85 | Evidence trace chain renders in UI; explainability scores attached to decisions; SOC 2 Type II evidence exportable. |
| 3.5 | **DR Rehearsal and Documented RPO/RTO** | SMEPro + Lamar | Day 88 | Full DR rehearsal executed; RPO ≤10 min, RTO ≤4 hours validated; runbook updated with actual times. |
| 3.6 | **Formal Lamar Handoff** | SMEPro + Lamar | Day 90 | Handoff ceremony; all runbooks signed off; support model agreed; repository ownership transferred; SMEPro on retainer or contributor agreement. |

---

## 4. Transfer Readiness Checklist

For each item: define the artifact required, current status, owner, acceptance criteria, and blockers.

| # | Item | Artifact Required | Current Status | Owner | Acceptance Criteria | Blockers |
|---|------|-------------------|--------------|-------|---------------------|----------|
| 4.1 | **Repository ownership transfer** | GitHub org invite + admin rights; repo transfer or fork; branch protection rules. | Partial — repo is under `smeprotech` org. | SMEPro | Lamar owns the repository; SMEPro has Contributor access; branch protection requires 1 review. | Legal agreement on IP ownership. |
| 4.2 | **GitHub Actions workflows** | `.github/workflows/*.yml` with no SMEPro-specific secrets or org assumptions. | Partial — workflows use `secrets.*` but repo URL and some configs are SMEPro-specific. | SMEPro | All workflows pass in Lamar's GitHub org; WIF provider points to Lamar's GCP project; no `smeprotech` strings. | GCP project setup by Lamar; WIF pool configuration. |
| 4.3 | **Container registry ownership** | GAR repository in Lamar's GCP project; IAM permissions for GitHub Actions SA. | Missing — image references point to `{{ secrets.GAR_REPOSITORY }}` but no Lamar registry exists. | Lamar | GAR repository created; GitHub Actions service account can push images. | GCP billing enabled; IAM configured. |
| 4.4 | **GCP project ownership** | GCP project with billing; IAM bindings for Lamar team; Terraform state bucket. | Missing — Terraform assumes a project but no Lamar project provisioned. | Lamar | GCP project created; billing account linked; Terraform backend bucket created; IAM roles assigned. | Lamar's GCP org setup; billing account. |
| 4.5 | **Domain/DNS ownership** | `app.ioscos.com` or Lamar domain; Cloud DNS zone; DNS records for staging/prod. | Partial — `app.ioscos.com` referenced in CD workflow but not confirmed as Lamar-owned. | Lamar | Domain registered or transferred; A/AAAA records for ingress IPs; TLS certificates valid. | Domain registration decision; DNS cutover plan. |
| 4.6 | **TLS certificates** | cert-manager in GKE or managed certificates; CA bundle for Lamar trust model. | Partial — Vault PKI scaffolded but not integrated with ingress. | SMEPro | Ingress serves valid TLS; cert auto-renewal tested; HSTS header present. | Domain ownership; cert-manager or managed cert setup. |
| 4.7 | **Secrets management** | Vault or Secret Manager; secrets populated; rotation policy documented. | Partial — Vault dev server in docker-compose; production Vault not configured. | SMEPro + Lamar | All secrets externalized; no secrets in repo; rotation tested; emergency break-glass documented. | Vault instance or Secret Manager decision; secret population. |
| 4.8 | **Identity provider integration** | SAML/OIDC IdP configuration; user provisioning; role mapping. | Missing — only admin JWT in code. | Lamar | SSO login works; roles map to `admin`, `operator`, `viewer`; MFA enforced. | IdP selection (Google Workspace, Okta, Azure AD). |
| 4.9 | **Database credentials** | Cloud SQL instance or on-prem PostgreSQL; credentials in Vault/Secret Manager; backup configured. | Partial — Terraform provisions Cloud SQL but no Lamar instance exists. | Lamar | Cloud SQL instance created; credentials injected via Vault; PITR enabled; backup test passed. | GCP project readiness; Terraform apply. |
| 4.10 | **Monitoring/alerting ownership** | Grafana instance or Cloud Monitoring; alert channels (Slack, PagerDuty, email); on-call rotation. | Partial — Prometheus/Grafana configs present but no alert routing. | Lamar | Alerts route to Lamar's Slack/PD; on-call rotation defined; dashboards visible. | Alert channel setup; PagerDuty integration. |
| 4.11 | **Runbook ownership** | `docs/runbooks/` directory with deployment, incident, DR, and regulatory runbooks. | Partial — some docs exist but no formal runbooks. | SMEPro (write) → Lamar (own) | Runbooks reviewed and signed off by Lamar ops team; runbook drill completed. | Time to write and validate runbooks. |
| 4.12 | **Cost ownership** | Billing alerts; budget; cost dashboard; FinOps policy. | Missing — `cost_center` is `smepro-cos`. | Lamar | Billing alert at 80% budget; cost dashboard visible; monthly review cadence. | GCP billing setup; budget definition. |
| 4.13 | **Support model** | Contributor agreement or vendor SLA; issue escalation path; response time SLAs. | Missing — informal partnership. | SMEPro + Lamar | Documented support model: SMEPro as contributor (PRs, docs) vs. vendor (SLA, on-call). | Legal/contract negotiation. |

---

## 5. SMEPro Remediation Items

All hardcoded SMEPro references must be removed or parameterized before transfer. This section is derived from a `grep -ri smepro` search of the repository.

### 5.1 Wave 1 Blockers (Must Fix Before Any Transfer)

| # | File Path | Line | Current Value | Replacement Pattern | Priority |
|---|-----------|------|---------------|---------------------|----------|
| 5.1.1 | `package.json` | 45 | `"url": "https://github.com/smeprotech/ios-plus.git"` | `https://github.com/${GITHUB_ORG}/ios-plus.git` or env var `REPO_URL` | Wave 1 Blocker |
| 5.1.2 | `README.md` | 293 | `Proprietary — SMEPro Technologies. All rights reserved.` | `Proprietary — ${LICENSE_HOLDER}. All rights reserved.` with `LICENSE_HOLDER` defaulting to repository owner. | Wave 1 Blocker |
| 5.1.3 | `README.md` | 295 | `support@smeprotech.com` | `support@${SUPPORT_DOMAIN}` with default `support@ioscos.com` or env var. | Wave 1 Blocker |
| 5.1.4 | `infra/terraform/gcp/variables.tf` | 2 | `description = "GCP project ID for Lamar University SMEPro COS"` | `description = "GCP project ID for IOS+ deployment"` | Wave 1 Blocker |
| 5.1.5 | `infra/terraform/gcp/variables.tf` | 123 | `default = "smepro-cos"` for `cost_center` | `default = "ios-plus"` or parameterized `var.cost_center_default` | Wave 1 Blocker |
| 5.1.6 | `infra/terraform/gcp/main.tf` | 37 | `project = "smepro-cos"` in `local.common_labels` | `project = var.project_label` or `project = "ios-plus"` | Wave 1 Blocker |
| 5.1.7 | `infra/terraform/gcp/README.md` | 3 | `Production-grade Terraform infrastructure for the **Lamar University SMEPro Compliance Operating System (COS)** on Google Cloud Platform.` | `Production-grade Terraform infrastructure for the **IOS+ Compliance Operating System** on Google Cloud Platform.` | Wave 1 Blocker |
| 5.1.8 | `infra/terraform/gcp/README.md` | 155 | `Internal use — Lamar University SMEPro Compliance Operating System.` | `Internal use — Lamar University IOS+ Compliance Operating System.` | Wave 1 Blocker |
| 5.1.9 | `docs/GCP_Cost_Estimate.md` | 1 | `# GCP Cost Estimate — SMEPro COS (IOS-Plus)` | `# GCP Cost Estimate — IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.10 | `docs/GCP_Cost_Estimate.md` | 286 | `*End of GCP Cost Estimate — SMEPro COS (IOS-Plus)*` | `*End of GCP Cost Estimate — IOS+ Compliance Operating System*` | Wave 1 Blocker |
| 5.1.11 | `docs/GCP_Deployment_Runbook.md` | 1 | `# GCP Deployment Runbook — SMEPro COS (IOS-Plus)` | `# GCP Deployment Runbook — IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.12 | `docs/GCP_Deployment_Runbook.md` | 6 | `> **Scope:** Staging → Production deployment for Operator NFRD / SMEPro COS v2` | `> **Scope:** Staging → Production deployment for IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.13 | `docs/GCP_Deployment_Runbook.md` | 979 | `*End of GCP Deployment Runbook — SMEPro COS (IOS-Plus)*` | `*End of GCP Deployment Runbook — IOS+ Compliance Operating System*` | Wave 1 Blocker |
| 5.1.14 | `docs/GCP_Security_Controls.md` | 1 | `# GCP Security Controls — SMEPro COS (IOS-Plus)` | `# GCP Security Controls — IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.15 | `docs/GCP_Security_Controls.md` | 6 | `> **Scope:** All GCP infrastructure for Operator NFRD / SMEPro COS v2` | `> **Scope:** All GCP infrastructure for IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.16 | `docs/GCP_Security_Controls.md` | 684 | `*End of GCP Security Controls — SMEPro COS (IOS-Plus)*` | `*End of GCP Security Controls — IOS+ Compliance Operating System*` | Wave 1 Blocker |
| 5.1.17 | `docs/Module3_AI_Governance_Framework.md` | 1 | `# Module 3: AI Governance Framework — SMEPro COS (IOS-Plus)` | `# Module 3: AI Governance Framework — IOS+ Compliance Operating System` | Wave 1 Blocker |
| 5.1.18 | `docs/Module3_AI_Governance_Framework.md` | 405 | `*End of Module 3: AI Governance Framework — SMEPro COS (IOS-Plus)*` | `*End of Module 3: AI Governance Framework — IOS+ Compliance Operating System*` | Wave 1 Blocker |
| 5.1.19 | `docs/REST_API_CoPilot_Integration_Guide.md` | 1 | `# SMEPro COS Mini-UDM — REST API & CoPilot Integration Guide` | `# IOS+ Mini-UDM — REST API & CoPilot Integration Guide` | Wave 1 Blocker |
| 5.1.20 | `docs/REST_API_CoPilot_Integration_Guide.md` | 26 | `│  LAYER 1: SMEPro COS Mini-UDM Excel Workbook                │` | `│  LAYER 1: IOS+ Mini-UDM Excel Workbook                      │` | Wave 1 Blocker |
| 5.1.21 | `docs/EDU_Reporter_Spec.md` | 688 | `*Author: SMEPro Technologies Engineering*` | `*Author: IOS+ Engineering Team*` or parameterized. | Wave 1 Blocker |
| 5.1.22 | `docs/IOS_Plus_v2_Implementation_Spec.md` | 515 | `*Author: SMEPro Technologies Engineering*` | `*Author: IOS+ Engineering Team*` or parameterized. | Wave 1 Blocker |
| 5.1.23 | `docs/COS_UDM_Review_Expansion_Report.md` | 304 | `engineering@smeprotech.com` | `engineering@${SUPPORT_DOMAIN}` | Wave 1 Blocker |
| 5.1.24 | `docs/COS_UDM_Review_Expansion_Report.md` | 305 | `compliance@smeprotech.com` | `compliance@${SUPPORT_DOMAIN}` | Wave 1 Blocker |
| 5.1.25 | `docs/Module1_ETL_Mapping_Specifications.md` | 2 | `## SMEPro COS Regulatory Reporting — Institution-Facing` | `## IOS+ Regulatory Reporting — Institution-Facing` | Wave 1 Blocker |
| 5.1.26 | `docs/Module1_Integration_Guide.md` | 2 | `## SMEPro COS — Institution-Facing` | `## IOS+ — Institution-Facing` | Wave 1 Blocker |
| 5.1.27 | `docs/Module1_Integration_Guide.md` | 169 | `│  SMEPro COS — Unified Reporting Portal    [Lamar University] │` | `│  IOS+ — Unified Reporting Portal    [Lamar University] │` | Wave 1 Blocker |
| 5.1.28 | `docs/Module1_Unified_Reporting_Portal_API.md` | 2 | `## SMEPro COS — Institution-Facing Regulatory Reporting` | `## IOS+ — Institution-Facing Regulatory Reporting` | Wave 1 Blocker |
| 5.1.29 | `docs/Module2_Integration_Guide.md` | 2 | `## SMEPro COS — Operational Intelligence Engine` | `## IOS+ — Operational Intelligence Engine` | Wave 1 Blocker |
| 5.1.30 | `docs/Module2_Student_Facing_API.md` | 2 | `## SMEPro COS — Operational Intelligence Engine` | `## IOS+ — Operational Intelligence Engine` | Wave 1 Blocker |

### 5.2 Wave 2 Nice-to-Have (Should Fix Before Operational Use)

| # | File Path | Context | Current Value | Replacement Pattern | Priority |
|---|-----------|---------|---------------|---------------------|----------|
| 5.2.1 | `docs/REST_API_CoPilot_Integration_Guide.md` | 476 | `ios-plus/tests/postman/SMEPro_COS_Mini_UDM_Lamar.postman_collection.json` | `ios-plus/tests/postman/IOSPlus_Mini_UDM_Lamar.postman_collection.json` | Wave 2 |
| 5.2.2 | `infra/terraform/gcp/variables.tf` | 2 | `description = "GCP project ID for Lamar University SMEPro COS"` | `description = "GCP project ID for IOS+ deployment"` | Wave 2 (already listed in Wave 1, but full file audit needed) |
| 5.2.3 | All doc files | Passim | `SMEPro` in narrative text | `the platform`, `IOS+`, or `the system` | Wave 2 |
| 5.2.4 | `README.md` | License footer | `SMEPro Technologies` | Operator name or `IOS+ Engineering Team` | Wave 2 |
| 5.2.5 | Branch assumptions | `.github/workflows/*.yml` | `branches: [main, develop]` | Keep but document branch strategy in `docs/BRANCHING.md` | Wave 2 (document only) |

### 5.3 Remediation Script (Recommended)

Create `scripts/remediate-smepro-references.sh`:

```bash
#!/bin/bash
# scripts/remediate-smepro-references.sh
# Run this before every release to ensure no SMEPro references leak.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT_CODE=0

echo "=== Scanning for SMEPro references ==="

# Blockers
BLOCKERS=$(grep -ri "smeprotech\|smepro-cos\|SMEPro Technologies" \
  --include="*.json" --include="*.md" --include="*.ts" --include="*.js" \
  --include="*.yml" --include="*.yaml" --include="*.tf" --include="*.hcl" \
  "$REPO_ROOT" || true)

if [ -n "$BLOCKERS" ]; then
  echo "FAIL: Wave 1 blocker references found:"
  echo "$BLOCKERS"
  EXIT_CODE=1
else
  echo "PASS: No Wave 1 blocker references found."
fi

# Nice-to-haves (informational)
NICE=$(grep -ri "smepro" \
  --include="*.md" \
  "$REPO_ROOT/docs/" || true)

if [ -n "$NICE" ]; then
  echo "WARN: Wave 2 nice-to-have references remain in docs:"
  echo "$NICE"
fi

exit $EXIT_CODE
```

**CI Integration:** Add this script as a step in `.github/workflows/ci.yml` to fail the build if any Wave 1 blocker references are present.

---

## 6. Environment Contract Template

Every service must declare its operational contract. Below are the 15 components defined in this plan. Copy the template for each new service.

### Template

```yaml
service_name: <kebab-case-name>
runtime: <nodejs20|python311|go121|postgresql16|redis7>
ports:
  - <port>/<protocol> (purpose)
health_probe:
  path: <path>
  port: <port>
readiness_probe:
  path: <path>
  port: <port>
  initial_delay: <duration>
required_env:
  - <ENV_VAR_NAME>
optional_env:
  - <ENV_VAR_NAME>
secrets:
  - <SECRET_NAME> (from <source>)
resources:
  requests: { cpu: <m>, memory: <Mi/Gi> }
  limits: { cpu: <m>, memory: <Mi/Gi> }
dependencies:
  - <service-name> (<purpose>)
ingress:
  - host: <domain>
  - paths: <path-patterns>
service_account: <k8s-service-account-name>
network_policy:
  ingress_from: [<source-services>]
  egress_to: [<destination-services>]
persistent_volume: <none|size-and-class>
backup_required: <true|false>
SLOs:
  availability: <percentage>
  latency_p99: <duration>
  error_rate: <percentage>
```

---

### 6.1 api-gateway

```yaml
service_name: api-gateway
runtime: nodejs20
ports:
  - 3001/tcp (app)
  - 9090/tcp (metrics)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - DATABASE_URL
  - REDIS_HOST
  - VAULT_ADDR
  - ADMIN_JWT_SECRET
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - METRICS_ENABLED
  - CORS_ORIGINS
  - RATE_LIMIT_MAX_REQUESTS
  - RATE_LIMIT_WINDOW_MS
secrets:
  - DATABASE_URL (from Secret Manager)
  - ADMIN_JWT_SECRET (from Secret Manager)
  - VAULT_TOKEN (from Vault Agent)
resources:
  requests: { cpu: 500m, memory: 512Mi }
  limits: { cpu: 2000m, memory: 2Gi }
dependencies:
  - cos-plus (PostgreSQL persistence)
  - redis (session cache — optional for Wave 1)
  - vault (signing keys and secrets)
ingress:
  - host: app.ioscos.com
  - paths: /v1/*, /health, /ready, /metrics, /admin/*
service_account: cos-api-gateway-sa
network_policy:
  ingress_from: [ingress-controller, monitoring]
  egress_to: [cos-plus, redis, vault, pubsub]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 200ms
  error_rate: < 0.1%
```

---

### 6.2 canonical-layer-service (cos-plus)

```yaml
service_name: cos-plus
runtime: nodejs20
ports:
  - 3001/tcp (shared with api-gateway in monorepo)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - DATABASE_URL
  - NODE_ENV
optional_env:
  - LOG_LEVEL
secrets:
  - DATABASE_URL (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - postgres (PostgreSQL 16 with pgvector)
ingress:
  - host: none (internal only)
service_account: cos-plus-sa
network_policy:
  ingress_from: [api-gateway]
  egress_to: [postgres]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 100ms
  error_rate: < 0.1%
```

---

### 6.3 udm-query-service (uco-resolver)

```yaml
service_name: uco-resolver
runtime: nodejs20
ports:
  - 3001/tcp (shared with api-gateway in monorepo)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - DATABASE_URL
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - UDM_CACHE_TTL
secrets:
  - DATABASE_URL (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - postgres (PostgreSQL 16)
ingress:
  - host: none (internal only via api-gateway)
service_account: cos-uco-resolver-sa
network_policy:
  ingress_from: [api-gateway]
  egress_to: [postgres]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.5%
  latency_p99: 500ms
  error_rate: < 0.5%
```

---

### 6.4 evidence-chain-service (evidence-fabric)

```yaml
service_name: evidence-fabric
runtime: nodejs20
ports:
  - 3001/tcp (shared with api-gateway in monorepo)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - VAULT_ADDR
  - VAULT_TOKEN
  - EVIDENCE_SIGNING_ENABLED
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - TRIPLE_PUBLICATION_ENABLED
secrets:
  - VAULT_TOKEN (from Vault Agent)
  - EVIDENCE_SIGNING_KEY (from Vault Transit)
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - vault (signing keys)
  - cos-plus (evidence store)
  - pubsub (event publication — Wave 2)
ingress:
  - host: none (internal only)
service_account: cos-evidence-fabric-sa
network_policy:
  ingress_from: [api-gateway]
  egress_to: [vault, cos-plus, pubsub]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 150ms
  error_rate: < 0.1%
```

---

### 6.5 rules-engine (gate-530)

```yaml
service_name: gate-530
runtime: nodejs20
ports:
  - 5300/tcp (IPC/HTTP sidecar)
  - 3001/tcp (shared with api-gateway in monorepo)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - GATE530_RULE_REFRESH_INTERVAL
  - COMPLIANCE_ENGINE_MODE
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - IPC_TRANSPORT_ENABLED
  - HTTP2_TRANSPORT_ENABLED
secrets:
  - ADMIN_JWT_SECRET (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - cos-plus (rule storage)
  - vault (dynamic secrets)
ingress:
  - host: none (internal only)
service_account: cos-gate-530-sa
network_policy:
  ingress_from: [api-gateway]
  egress_to: [cos-plus, vault]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 50ms
  error_rate: < 0.1%
```

---

### 6.6 workflow-orchestrator (middleware-engine)

```yaml
service_name: middleware-engine
runtime: nodejs20
ports:
  - 3001/tcp (app)
  - 9090/tcp (metrics)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - DATABASE_URL
  - VAULT_ADDR
  - ADMIN_JWT_SECRET
  - NODE_ENV
  - RAG_EMBEDDING_PROVIDER
optional_env:
  - LOG_LEVEL
  - METRICS_ENABLED
secrets:
  - DATABASE_URL (from Secret Manager)
  - ADMIN_JWT_SECRET (from Secret Manager)
  - VAULT_TOKEN (from Vault Agent)
resources:
  requests: { cpu: 500m, memory: 512Mi }
  limits: { cpu: 2000m, memory: 2Gi }
dependencies:
  - cos-plus (persistence)
  - gate-530 (compliance)
  - evidence-fabric (audit)
  - rag-vault (retrieval)
  - vault (secrets)
  - redis (session — Wave 2)
ingress:
  - host: app.ioscos.com
  - paths: /v1/*, /health, /ready, /metrics, /admin/*
service_account: cos-middleware-engine-sa
network_policy:
  ingress_from: [ingress-controller, monitoring]
  egress_to: [cos-plus, gate-530, evidence-fabric, rag-vault, vault, redis, pubsub]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 200ms
  error_rate: < 0.1%
```

---

### 6.7 approval-queue-service

```yaml
service_name: approval-queue
runtime: nodejs20
ports:
  - 3001/tcp (shared with api-gateway in monorepo)
health_probe:
  path: /health
  port: 3001
readiness_probe:
  path: /ready
  port: 3001
  initial_delay: 10s
required_env:
  - DATABASE_URL
  - ADMIN_JWT_SECRET
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - APPROVAL_QUEUE_TTL
secrets:
  - DATABASE_URL (from Secret Manager)
  - ADMIN_JWT_SECRET (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 256Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - cos-plus (queue state)
  - pubsub (event-driven — Wave 2)
ingress:
  - host: none (internal via api-gateway /admin/audit)
service_account: cos-approval-queue-sa
network_policy:
  ingress_from: [api-gateway]
  egress_to: [cos-plus, pubsub]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.5%
  latency_p99: 500ms
  error_rate: < 0.5%
```

---

### 6.8 connector-workers (Banner, Blackboard, Concourse)

```yaml
service_name: connector-workers
runtime: nodejs20
ports:
  - 8080/tcp (metrics — optional)
health_probe:
  path: /health
  port: 8080
readiness_probe:
  path: /ready
  port: 8080
  initial_delay: 30s
required_env:
  - CONNECTOR_TYPE (banner|blackboard|concourse)
  - CONNECTOR_API_URL
  - CONNECTOR_API_KEY
  - DATABASE_URL
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - INGESTION_BATCH_SIZE
  - INGESTION_RATE_LIMIT
secrets:
  - CONNECTOR_API_KEY (from Secret Manager)
  - DATABASE_URL (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits: { cpu: 1000m, memory: 2Gi }
dependencies:
  - cos-plus (target schema)
  - pubsub (event bus — Wave 2)
ingress:
  - host: none (internal only)
service_account: cos-connector-workers-sa
network_policy:
  ingress_from: [none]
  egress_to: [cos-plus, external-sis-api, pubsub]
persistent_volume: none
backup_required: false
SLOs:
  availability: 95.0% (best-effort ingestion)
  latency_p99: 5000ms
  error_rate: < 5.0%
```

---

### 6.9 ML jobs (risk scoring, drift detection, load indexing)

```yaml
service_name: ml-jobs
runtime: python311
ports:
  - 8080/tcp (metrics — optional)
health_probe:
  path: /health
  port: 8080
readiness_probe:
  path: /ready
  port: 8080
  initial_delay: 60s
required_env:
  - ML_JOB_TYPE (risk-scoring|drift-detection|accreditation-indexing)
  - DATABASE_URL
  - MODEL_ENDPOINT
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - ML_BATCH_SIZE
  - DRIFT_THRESHOLD
secrets:
  - DATABASE_URL (from Secret Manager)
  - MODEL_API_KEY (from Secret Manager)
resources:
  requests: { cpu: 1000m, memory: 2Gi }
  limits: { cpu: 4000m, memory: 8Gi }
dependencies:
  - cos-plus (source data)
  - pubsub (event bus — Wave 2)
  - storage (model artifacts — Wave 2)
ingress:
  - host: none (internal only)
service_account: cos-ml-jobs-sa
network_policy:
  ingress_from: [none]
  egress_to: [cos-plus, pubsub, storage, external-model-api]
persistent_volume: none
backup_required: false
SLOs:
  availability: 95.0% (best-effort batch)
  latency_p99: 300000ms (5 min batch)
  error_rate: < 5.0%
```

---

### 6.10 PostgreSQL / pgvector

```yaml
service_name: postgres
runtime: postgresql16
ports:
  - 5432/tcp (database)
health_probe:
  path: pg_isready
  port: 5432
readiness_probe:
  path: pg_isready
  port: 5432
  initial_delay: 10s
required_env:
  - POSTGRES_USER
  - POSTGRES_PASSWORD
  - POSTGRES_DB
optional_env:
  - PGDATA
secrets:
  - POSTGRES_PASSWORD (from Secret Manager or Vault)
resources:
  requests: { cpu: 1000m, memory: 2Gi }
  limits: { cpu: 4000m, memory: 8Gi }
dependencies:
  - none (foundation layer)
ingress:
  - host: none (private services only)
service_account: none (Cloud SQL SA or K8s SA for on-prem)
network_policy:
  ingress_from: [api-gateway, cos-plus, uco-resolver, evidence-fabric, gate-530, connector-workers, ml-jobs]
  egress_to: [none]
persistent_volume: 100Gi (SSD or PD-SSD)
backup_required: true
SLOs:
  availability: 99.9%
  latency_p99: 50ms
  error_rate: < 0.1%
```

---

### 6.11 Redis (session caching)

```yaml
service_name: redis
runtime: redis7
ports:
  - 6379/tcp (cache)
health_probe:
  path: redis-cli ping
  port: 6379
readiness_probe:
  path: redis-cli ping
  port: 6379
  initial_delay: 5s
required_env:
  - REDIS_PASSWORD (optional)
optional_env:
  - REDIS_MAXMEMORY
  - REDIS_MAXMEMORY_POLICY
secrets:
  - REDIS_PASSWORD (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits: { cpu: 1000m, memory: 2Gi }
dependencies:
  - none (foundation layer)
ingress:
  - host: none (private services only)
service_account: none
network_policy:
  ingress_from: [api-gateway, middleware-engine]
  egress_to: [none]
persistent_volume: none (Memorystore or Redis PVC)
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 5ms
  error_rate: < 0.1%
```

---

### 6.12 Pub/Sub (event bus)

```yaml
service_name: pubsub
runtime: managed (GCP Pub/Sub) or kafka/redpanda
ports:
  - 443/tcp (HTTPS API)
  - 8085/tcp (emulator — local only)
health_probe:
  path: / (managed service health check via client)
  port: 443
readiness_probe:
  path: /
  port: 443
  initial_delay: 5s
required_env:
  - PUBSUB_PROJECT_ID
  - PUBSUB_EMULATOR_HOST (local only)
optional_env:
  - PUBSUB_MAX_OUTSTANDING_MESSAGES
secrets:
  - PUBSUB_SERVICE_ACCOUNT_KEY (from Secret Manager or WIF)
resources:
  requests: { cpu: none, memory: none } (managed service)
  limits: { cpu: none, memory: none }
dependencies:
  - none (foundation layer)
ingress:
  - host: none (API-only)
service_account: cos-pubsub-publisher-sa
network_policy:
  ingress_from: [api-gateway, middleware-engine, connector-workers, ml-jobs]
  egress_to: [none]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.9%
  latency_p99: 100ms (publish)
  error_rate: < 0.1%
```

---

### 6.13 frontend-apps (EDU Reporter UI)

```yaml
service_name: frontend-apps
runtime: nodejs20
ports:
  - 3000/tcp (Next.js app)
  - 9090/tcp (metrics — optional)
health_probe:
  path: /api/health
  port: 3000
readiness_probe:
  path: /api/ready
  port: 3000
  initial_delay: 10s
required_env:
  - NEXT_PUBLIC_API_URL
  - NEXT_PUBLIC_APP_NAME
  - NODE_ENV
optional_env:
  - LOG_LEVEL
  - METRICS_ENABLED
secrets:
  - NEXT_AUTH_SECRET (from Secret Manager)
  - API_KEY (from Secret Manager)
resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits: { cpu: 1000m, memory: 1Gi }
dependencies:
  - api-gateway (backend)
  - redis (session — Wave 2)
ingress:
  - host: app.ioscos.com
  - paths: /*, /api/health, /api/ready
service_account: cos-frontend-apps-sa
network_policy:
  ingress_from: [ingress-controller]
  egress_to: [api-gateway, redis]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.5%
  latency_p99: 500ms
  error_rate: < 0.5%
```

---

### 6.14 monitoring (Prometheus/Grafana)

```yaml
service_name: monitoring
runtime: mixed (prometheus:v2.52, grafana:10.4)
ports:
  - 9090/tcp (Prometheus)
  - 3000/tcp (Grafana)
health_probe:
  path: /-/healthy (Prometheus)
  port: 9090
readiness_probe:
  path: /-/ready (Prometheus)
  port: 9090
  initial_delay: 10s
required_env:
  - GF_SECURITY_ADMIN_PASSWORD
  - PROMETHEUS_RETENTION_TIME
optional_env:
  - LOG_LEVEL
secrets:
  - GF_SECURITY_ADMIN_PASSWORD (from Secret Manager)
resources:
  requests: { cpu: 500m, memory: 1Gi }
  limits: { cpu: 2000m, memory: 4Gi }
dependencies:
  - api-gateway (metrics source)
  - prometheus (self-scrape)
ingress:
  - host: monitoring.app.ioscos.com (or internal only)
  - paths: /grafana/*, /prometheus/*
service_account: cos-monitoring-sa
network_policy:
  ingress_from: [ingress-controller, monitoring]
  egress_to: [api-gateway]
persistent_volume: 50Gi (Prometheus TSDB)
backup_required: true (Grafana dashboards, alert rules)
SLOs:
  availability: 99.5%
  latency_p99: 1000ms
  error_rate: < 1.0%
```

---

### 6.15 CI/CD pipeline

```yaml
service_name: ci-cd-pipeline
runtime: github-actions
ports:
  - none (orchestration)
health_probe:
  path: .github/workflows/ci.yml status
  port: none
readiness_probe:
  path: .github/workflows/cd-gcp.yml status
  port: none
  initial_delay: 0s
required_env:
  - GCP_PROJECT_ID
  - GCP_REGION
  - GAR_REPOSITORY
  - GCP_WORKLOAD_IDENTITY_PROVIDER
  - GCP_SERVICE_ACCOUNT
optional_env:
  - SLACK_WEBHOOK_URL
secrets:
  - GCP_PROJECT_ID (from GitHub Secrets)
  - GCP_SERVICE_ACCOUNT (from GitHub Secrets)
  - GCP_WORKLOAD_IDENTITY_PROVIDER (from GitHub Secrets)
  - STAGING_DATABASE_URL (from GitHub Secrets)
  - PROD_DATABASE_URL (from GitHub Secrets)
resources:
  requests: { cpu: 2, memory: 7Gi } (GitHub-hosted runner)
  limits: { cpu: 2, memory: 7Gi }
dependencies:
  - gcp (project, WIF, GAR, Cloud Deploy)
  - terraform (state, backend)
  - kubernetes (GKE cluster)
ingress:
  - host: none
  - paths: none
service_account: github-actions-deployer-sa
network_policy:
  ingress_from: [none]
  egress_to: [gcp-apis, github-apis]
persistent_volume: none
backup_required: false
SLOs:
  availability: 99.0% (best-effort CI)
  latency_p99: 600000ms (10 min build)
  error_rate: < 5.0%
```

---

### 6.16 Terraform infrastructure

```yaml
service_name: terraform-infra
runtime: terraform 1.7+
ports:
  - none
health_probe:
  path: terraform validate
  port: none
readiness_probe:
  path: terraform plan
  port: none
  initial_delay: 0s
required_env:
  - TF_VAR_project_id
  - TF_VAR_region
  - TF_VAR_env
optional_env:
  - TF_VAR_labels
  - TF_VAR_cost_center
secrets:
  - GOOGLE_CREDENTIALS (from WIF or service account key — WIF preferred)
resources:
  requests: { cpu: 1, memory: 2Gi } (local or CI runner)
  limits: { cpu: 2, memory: 4Gi }
dependencies:
  - gcp (billing, APIs enabled)
  - gcs (state backend bucket)
ingress:
  - host: none
  - paths: none
service_account: terraform-admin-sa
network_policy:
  ingress_from: [none]
  egress_to: [gcp-apis]
persistent_volume: none
backup_required: true (state file in GCS with versioning)
SLOs:
  availability: 99.0% (best-effort)
  latency_p99: 1800000ms (30 min apply)
  error_rate: < 1.0%
```

---

## 7. Acceptance Criteria by Wave

### 7.1 Wave 1 Exit Criteria (Day 45 Go/No-Go)

**All of the following must pass before proceeding to Wave 2.**

| # | Criterion | Test Method | Owner | Deadline |
|---|-----------|-------------|-------|----------|
| 1 | `docker compose up` brings up all Wave 1 services locally | Run `docker compose up` from a clean clone on a fresh machine; all containers reach `healthy` status. | SMEPro | Day 15 |
| 2 | All health probes return 200 | `curl http://localhost:3001/health` returns `{"status":"healthy"}` for all services. | SMEPro | Day 15 |
| 3 | Readiness probes return 200 | `curl http://localhost:3001/ready` returns `{"ready":true}` with all subsystems `true`. | SMEPro | Day 15 |
| 4 | WORM verification passes | `npm run db:verify-worm` exits 0 with no ERROR; no UPDATE/DELETE possible on audit tables. | SMEPro | Day 15 |
| 5 | One API endpoint returns data from PostgreSQL | `curl "http://localhost:3001/v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA"` returns structured JSON with `licensure_status`. | SMEPro | Day 20 |
| 6 | Evidence signing produces verifiable Ed25519 signature | `POST /v1/inference` with test payload; extract `evidence.signature`; run `verify-evidence.ts` script; returns `valid: true`. | SMEPro | Day 25 |
| 7 | Gate 530 evaluates a request and returns ALLOW/DENY | `POST /v1/evaluate` with benign payload returns `ALLOW`; with forbidden payload returns `DENY`. | SMEPro | Day 25 |
| 8 | CI pipeline passes on GitHub Actions | Push to `main` triggers CI; all jobs (build, typecheck, lint, test, WORM verify, coverage) pass. | SMEPro | Day 25 |
| 9 | Terraform apply to staging completes without errors | `terraform apply -var="environment=staging"` in Lamar's GCP project completes with 0 errors. | SMEPro + Lamar | Day 35 |
| 10 | Cloud Deploy promotes to staging successfully | `gcloud deploy releases promote` to staging target succeeds; rollout status shows `SUCCEEDED`. | SMEPro + Lamar | Day 35 |
| 11 | Smoke tests pass against staging | Health, ready, DB connectivity, and WORM status checks pass against staging URL. | SMEPro | Day 40 |
| 12 | Backup/restore test passes | Trigger PITR restore to a new Cloud SQL instance; verify data integrity; document actual RPO/RTO. | SMEPro + Lamar | Day 45 |
| 13 | No SMEPro Wave 1 blocker references remain | `scripts/remediate-smepro-references.sh` exits 0 with no blockers. | SMEPro | Day 10 |
| 14 | Lamar can deploy without SMEPro on a call | Lamar engineer executes full deploy from runbook; SMEPro observes but does not intervene. | Lamar | Day 45 |

**Wave 1 Go/No-Go Decision (Day 45):**
- **Go:** ≥13/14 criteria pass, including #8, #9, #11, #12, #14.
- **No-Go:** <13/14 pass, or any of #8, #9, #11, #12, #14 fail. If No-Go, extend Wave 1 by 15 days and reduce scope if necessary.

---

### 7.2 Wave 2 Exit Criteria (Day 75 Go/No-Go)

| # | Criterion | Test Method | Owner | Deadline |
|---|-----------|-------------|-------|----------|
| 1 | All three connector workers (Banner, Blackboard, Concourse) run in staging | Kubernetes Deployments show `Running`; logs show successful ingestion; no crash loops. | SMEPro | Day 55 |
| 2 | Normalization pipelines run on schedule | CronJobs execute within 5 min of scheduled time; output tables populated; no unhandled errors. | SMEPro | Day 55 |
| 3 | Regulatory ingest produces valid IPEDS/CBM/SACSCOC data | Ingest scripts complete; data matches published formats; cross-form validation passes. | SMEPro | Day 60 |
| 4 | Approval queue workflow operational | Admin creates rule via UI; rule appears in queue; approver receives notification; rule activates after approval. | SMEPro | Day 60 |
| 5 | All 7 UC dashboards render in EDU Reporter | Manual UI walkthrough of UC-01 through UC-07; each dashboard loads data; drill-down and export work. | SMEPro + Lamar | Day 70 |
| 6 | Pub/Sub event bus operational | Publish test event; consumer receives and processes within 30 seconds; DLQ remains empty. | SMEPro | Day 55 |
| 7 | Observability alerts fire and route correctly | Trigger test alert; confirm receipt in Lamar's Slack/PD channel within 1 minute. | SMEPro + Lamar | Day 65 |
| 8 | SAST/DAST in CI with no Critical/High unresolved | SAST job passes in CI; DAST report shows 0 Critical, 0 High, or documented mitigations. | SMEPro | Day 70 |
| 9 | Penetration test report clean | Third-party pen test report delivered; 0 Critical, 0 High, or documented mitigations with remediation plan. | SMEPro | Day 70 |
| 10 | Incident response runbook tested | Lamar ops team executes a simulated incident (pod failure, DB failover) using runbook; RTO met. | Lamar | Day 70 |
| 11 | Security hardening complete | CIS GKE Benchmark ≥80%; Cloud Armor WAF rules active; IAP enabled; no public admin endpoints. | SMEPro | Day 70 |
| 12 | Lamar can operate without SMEPro for 48 hours | Lamar team handles routine ops, monitoring, and minor incidents over a 48-hour period without SMEPro support. | Lamar | Day 75 |

**Wave 2 Go/No-Go Decision (Day 75):**
- **Go:** ≥11/12 criteria pass, including #5, #7, #10, #12.
- **No-Go:** <11/12 pass, or any of #5, #7, #10, #12 fail. If No-Go, extend Wave 2 by 10 days.

---

### 7.3 Wave 3 Exit Criteria (Day 90 Go/No-Go)

| # | Criterion | Test Method | Owner | Deadline |
|---|-----------|-------------|-------|----------|
| 1 | ML jobs run daily in production | CronJob schedule shows last successful run within 24 hours; risk scores visible in dashboard. | SMEPro | Day 80 |
| 2 | Drift detection alerts on model degradation | Inject synthetic drift; alert fires within 1 hour; remediation workflow documented. | SMEPro | Day 82 |
| 3 | Regulatory Watchtower (UC-08) detects changes | Firecrawl scrapes test regulatory site; change detected; alert published to Pub/Sub. | SMEPro | Day 82 |
| 4 | AI governance automation enforces Module 3 policies | Submit non-compliant AI request; Gate 530 denies with reference to Module 3 policy; audit trail complete. | SMEPro | Day 85 |
| 5 | Evidence trace chain visualizes in UI | Open evidence record in UI; trace chain renders from origin to current state; signatures verifiable. | SMEPro | Day 85 |
| 6 | DR rehearsal completes successfully | Full DR rehearsal executed; RPO ≤10 min and RTO ≤4 hours validated; runbook updated. | SMEPro + Lamar | Day 88 |
| 7 | SOC 2 Type II evidence exportable | Generate evidence export for 90-day period; auditor can verify integrity without SMEPro help. | SMEPro | Day 88 |
| 8 | Formal handoff ceremony completed | Signed handoff checklist; all runbooks reviewed; support model documented and agreed. | SMEPro + Lamar | Day 90 |
| 9 | Repository ownership transferred | Lamar GitHub org owns repository; SMEPro has Contributor access; all secrets rotated. | SMEPro + Lamar | Day 90 |
| 10 | SMEPro on retainer or contributor agreement signed | Contract executed; SLA defined; escalation path documented; invoice schedule agreed. | SMEPro + Lamar | Day 90 |

**Wave 3 Go/No-Go Decision (Day 90):**
- **Go:** ≥9/10 criteria pass, including #6, #8, #9, #10.
- **No-Go:** <9/10 pass, or any of #6, #8, #9, #10 fail. If No-Go, define explicit remaining items and owners in a **Day 90+ Remediation Plan** with 15-day sprint cycles.

---

## 8. Risk Register

| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---------|------|------------|--------|------------|-------|--------|
| R-01 | **Architecture ahead of implementation** — The spec describes ML jobs, connectors, and 7 UC dashboards that do not yet have code. | High | High | Define strict MVP scope; prove vertical slice (one connector, one dashboard, one ML job) before scaling. Defer non-critical features to post-handoff. | SMEPro | Open |
| R-02 | **Too many moving parts for v1** — 16 components, Vault, Terraform, Cloud Deploy, Pub/Sub, Redis, pgvector, and 4 frontend dashboards create integration complexity. | Medium | High | Ruthlessly defer non-critical components. Wave 1 must be deployable with PostgreSQL + API Gateway + Evidence + Rules + one connector + one frontend only. Everything else is Wave 2+. | SMEPro | Open |
| R-03 | **Transfer friction** — Hardcoded SMEPro references, undocumented tribal knowledge, and SMEPro-specific GCP configs prevent Lamar from deploying independently. | Medium | High | Parameterize everything now. Create remediation script. Document every assumption. Pair-program the first Lamar-led deploy. | SMEPro + Lamar | Open |
| R-04 | **Compliance not operationalized** — WORM triggers exist but have not been tested under load; no formal audit trail for admin mutations; no penetration test. | Medium | Critical | Security review + access tests in Wave 1. Penetration test in Wave 2. Third-party audit readiness review in Wave 3. | SMEPro | Open |
| R-05 | **Lamar infrastructure not ready** — Lamar may not have GCP billing, org policies, or IAM foundations in place to receive the platform. | Medium | High | Parallel infrastructure prep: Lamar provisions GCP project, billing, and IAM while SMEPro hardens code. SMEPro provides Terraform bootstrap for greenfield project. | Lamar | Open |
| R-06 | **SMEPro knowledge not documented** — Key design decisions (e.g., why pure Node.js http instead of Express, WORM trigger logic, Vault auth path) live in SMEPro engineers' heads. | Medium | High | This plan + runbooks + architecture decision records (ADRs) in `docs/architecture/`. Mandatory ADR review before handoff. | SMEPro | Open |
| R-07 | **Frontend missing** — No actual EDU Reporter UI codebase exists; only HTML prototypes and K8s manifests. | High | High | Build Next.js app in Wave 1. Start with UC-01 only. Add remaining dashboards in Wave 2. | SMEPro | Open |
| R-08 | **Database migrations are fragile** — V11–V14 are large, multi-thousand-line SQL files. Rollback is not tested. | Medium | High | Split large migrations into idempotent steps. Add `down` migrations where safe. Test migrations against clean and populated databases in CI. | SMEPro | Open |
| R-09 | **Vault operational complexity** — Vault is required for signing and secrets, but production Vault operations (unseal, HA, backup, DR) are not documented. | Medium | High | Document Vault ops runbook. Consider GKE-native secrets or Secret Manager as fallback for Wave 1 if Vault ops are too complex for Lamar. | SMEPro | Open |
| R-10 | **Cost overruns** — GCP cost estimate exists but is not bound to a budget or alert. | Low | Medium | Set billing alerts at 80% and 100% of budget. Review cost dashboard weekly in Wave 1, monthly thereafter. | Lamar | Open |

---

## 9. Go/No-Go Decision Points

### 9.1 Decision Point 1: Day 15 Go/No-Go — Dev Environment Provision

**Question:** Can we provision a dev environment end-to-end?

**Criteria:**
- [ ] `docker compose up` from clean clone succeeds in ≤10 minutes.
- [ ] All containers report `healthy`.
- [ ] `npm run test` passes.
- [ ] `npm run db:verify-worm` passes.
- [ ] SMEPro remediation script passes (no Wave 1 blocker references).
- [ ] Lamar engineer can execute the above without SMEPro intervention.

**If YES:** Proceed to Day 16–45 development with confidence.  
**If NO:** Identify the blocking item(s) from the checklist above. SMEPro has 5 days to resolve. If still blocked, revisit scope: defer the failing component to Wave 2 and proceed with what works.

**Decision Owner:** SMEPro Engineering Lead + Lamar Tech Lead  
**Required Attendees:** SMEPro CTO, Lamar Managing Partner for Industry & Revenue, Lamar IT Director

---

### 9.2 Decision Point 2: Day 45 Go/No-Go — Staging Deploy + Smoke Tests

**Question:** Can we deploy Wave 1 to staging and pass smoke tests?

**Criteria:**
- [ ] Terraform apply to Lamar's staging GCP project completes without errors.
- [ ] Cloud Deploy promotes release to staging successfully.
- [ ] All Wave 1 smoke tests pass (health, ready, DB, evidence, WORM, Gate 530).
- [ ] One connector worker ingests data successfully.
- [ ] EDU Reporter UC-01 dashboard renders data.
- [ ] Backup/restore test to new Cloud SQL instance succeeds.
- [ ] Lamar engineer can deploy without SMEPro on the call.
- [ ] No Critical or High security findings from automated scan.

**If YES:** Proceed to Wave 2 (operational workflows). Declare staging as the "Lamar training ground."  
**If NO:** Activate **Scope Reduction Plan**:
1. Drop the failing component(s) from Wave 1.
2. Document the deferred items in a `Day-45-Deferred.md` file.
3. Extend Wave 1 by 15 days to address blockers.
4. Re-evaluate at Day 60.

**Decision Owner:** SMEPro CTO + Lamar Managing Partner for Industry & Revenue  
**Required Attendees:** Chris Miguez (SMEPro), Chris Carter (Lamar), Lamar IT Director, Lamar CFO

---

### 9.3 Decision Point 3: Day 90 Go/No-Go — Lamar Ownership Readiness

**Question:** Is Lamar ready to take ownership?

**Criteria:**
- [ ] All Wave 3 exit criteria met (≥9/10, including #6, #8, #9, #10).
- [ ] Formal handoff ceremony completed with signed checklist.
- [ ] Repository ownership transferred to Lamar GitHub org.
- [ ] All secrets rotated; SMEPro no longer has access to production.
- [ ] Support model documented and contractually agreed (retainer or contributor agreement).
- [ ] Lamar team has operated independently for ≥48 hours without SMEPro support.
- [ ] DR rehearsal completed with RPO/RTO validated.
- [ ] Penetration test report clean (0 Critical, 0 High, or documented mitigations).
- [ ] Cost ownership and budget alerts active.
- [ ] All runbooks reviewed and signed off by Lamar ops team.

**If YES:** Declare **IOS+ Production Ready**. SMEPro transitions to contributor or vendor role per agreement. Lamar assumes full ownership.  
**If NO:** Define explicit remaining items and owners in a **Day 90+ Remediation Plan**:
- Item list with owner and deadline (15-day sprint cycles).
- SMEPro engagement model for extended support (hourly, monthly, or milestone-based).
- Re-evaluation at Day 105, Day 120, etc., until all criteria met.

**Decision Owner:** Chris Miguez (SMEPro) + Chris Carter (Lamar)  
**Required Attendees:** Full steering committee: SMEPro leadership, Lamar leadership, legal counsel for both parties.

---

## 10. Appendices

### A. File Inventory (Current State of 221 Files)

**Breakdown by category:**

| Category | Count | Files |
|----------|-------|-------|
| **Documentation** | 19 | `docs/*.md`, `docs/*.html`, `docs/*.xlsx`, `docs/*.pptx` |
| **Database** | 16 | `db/migrations/*.sql`, `db/init/*.sql`, `db/grants/*.sql`, `db/seeds/*` |
| **Packages (TypeScript)** | 38 | `packages/*/{src,tsconfig,package}.json` |
| **Infrastructure** | 64 | `infra/helm/*`, `infra/kubernetes/*`, `infra/terraform/**/*`, `infra/monitoring/*`, `infra/cloud-deploy/*`, `infra/vault/*` |
| **CI/CD** | 7 | `.github/workflows/*.yml`, `.github/**/*.md` |
| **Root Config** | 8 | `package.json`, `tsconfig.json`, `docker-compose*.yml`, `Dockerfile*`, `.gitignore`, `.dockerignore`, `.env.example` |
| **Scripts** | 7 | `scripts/db/*.js`, `scripts/ops/*.sh` |
| **Tests** | 2 | `tests/moonshot/README.md` |
| **Total** | **221** | |

**Key observations:**
- Documentation is 19/221 (~8.6%) by file count but much larger by line count.
- Infrastructure (Terraform + K8s + Helm + monitoring) is 64/221 (~29%) — the largest category.
- Actual application code (TypeScript packages) is only 38/221 (~17%).
- This confirms the "spec-heavy, infrastructure-heavy" assessment.

**Missing files (not in the 221):**
- Actual frontend application code (Next.js/React).
- Actual connector worker implementations (Node.js/Python ETL scripts).
- Actual ML job implementations (Python scripts).
- Pub/Sub consumer/producer code.
- Redis session caching code.
- Comprehensive integration test suite.
- Architecture Decision Records (ADRs).
- Operational runbooks (deployment, incident, DR).

---

### B. SMEPro Reference Remediation List (From Grep Results)

**Complete list of all `smepro` references found in the repository:**

| File | Line | Text | Wave |
|------|------|------|------|
| `package.json` | 45 | `https://github.com/smeprotech/ios-plus.git` | 1 |
| `README.md` | 293 | `Proprietary — SMEPro Technologies. All rights reserved.` | 1 |
| `README.md` | 295 | `support@smeprotech.com` | 1 |
| `infra/terraform/gcp/variables.tf` | 2 | `description = "GCP project ID for Lamar University SMEPro COS"` | 1 |
| `infra/terraform/gcp/variables.tf` | 123 | `default = "smepro-cos"` (cost_center) | 1 |
| `infra/terraform/gcp/main.tf` | 37 | `project = "smepro-cos"` (local.common_labels) | 1 |
| `infra/terraform/gcp/README.md` | 3 | `Lamar University SMEPro Compliance Operating System (COS)` | 1 |
| `infra/terraform/gcp/README.md` | 155 | `Lamar University SMEPro Compliance Operating System.` | 1 |
| `docs/GCP_Cost_Estimate.md` | 1 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/GCP_Cost_Estimate.md` | 286 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/GCP_Deployment_Runbook.md` | 1 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/GCP_Deployment_Runbook.md` | 6 | `Operator NFRD / SMEPro COS v2` | 1 |
| `docs/GCP_Deployment_Runbook.md` | 979 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/GCP_Security_Controls.md` | 1 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/GCP_Security_Controls.md` | 6 | `Operator NFRD / SMEPro COS v2` | 1 |
| `docs/GCP_Security_Controls.md` | 684 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/Module3_AI_Governance_Framework.md` | 1 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/Module3_AI_Governance_Framework.md` | 405 | `SMEPro COS (IOS-Plus)` | 1 |
| `docs/REST_API_CoPilot_Integration_Guide.md` | 1 | `SMEPro COS Mini-UDM` | 1 |
| `docs/REST_API_CoPilot_Integration_Guide.md` | 26 | `SMEPro COS Mini-UDM Excel Workbook` | 1 |
| `docs/REST_API_CoPilot_Integration_Guide.md` | 476 | `SMEPro_COS_Mini_UDM_Lamar.postman_collection.json` | 2 |
| `docs/EDU_Reporter_Spec.md` | 688 | `Author: SMEPro Technologies Engineering` | 1 |
| `docs/IOS_Plus_v2_Implementation_Spec.md` | 515 | `Author: SMEPro Technologies Engineering` | 1 |
| `docs/COS_UDM_Review_Expansion_Report.md` | 304 | `engineering@smeprotech.com` | 1 |
| `docs/COS_UDM_Review_Expansion_Report.md` | 305 | `compliance@smeprotech.com` | 1 |
| `docs/Module1_ETL_Mapping_Specifications.md` | 2 | `SMEPro COS Regulatory Reporting` | 1 |
| `docs/Module1_Integration_Guide.md` | 2 | `SMEPro COS — Institution-Facing` | 1 |
| `docs/Module1_Integration_Guide.md` | 169 | `SMEPro COS — Unified Reporting Portal` | 1 |
| `docs/Module1_Unified_Reporting_Portal_API.md` | 2 | `SMEPro COS — Institution-Facing Regulatory Reporting` | 1 |
| `docs/Module2_Integration_Guide.md` | 2 | `SMEPro COS — Operational Intelligence Engine` | 1 |
| `docs/Module2_Student_Facing_API.md` | 2 | `SMEPro COS — Operational Intelligence Engine` | 1 |

**Total references:** 31 across 15 files.  
**Wave 1 blockers:** 30 references.  
**Wave 2 nice-to-have:** 1 reference (Postman collection filename).

---

### C. Lamar Contact Matrix

| Role | Name | Responsibility | Handoff Involvement |
|------|------|--------------|---------------------|
| **Managing Partner, Industry & Revenue** | Chris Carter | Strategic oversight; budget approval; vendor relationship | All decision points; sign-off on support model |
| **IT Director / Cloud Architect** | TBD | GCP infrastructure; IAM; Terraform execution; monitoring | Day 15, Day 45, Day 90 Go/No-Go; runbook review |
| **Platform Engineer** | TBD | Day-to-day ops; CI/CD; K8s; incident response | Wave 2 operational readiness; 48-hour independent ops test |
| **Compliance Officer** | TBD | Regulatory validation; WORM audit; IPEDS/CBM accuracy | Wave 2 regulatory ingest validation; Wave 3 AI governance |
| **Data Engineer** | TBD | Connector configuration; ETL pipelines; normalization | Wave 2 connector and normalization testing |
| **Frontend Developer** | TBD | EDU Reporter UI; dashboard customization | Wave 1 UC-01; Wave 2 UC-02–UC-07 |
| **Security Lead** | TBD | SAST/DAST; pen test coordination; IAM review | Wave 2 security hardening; Wave 3 DR rehearsal |

**Note:** Several roles are currently TBD. Lamar must assign owners for IT Director, Platform Engineer, Compliance Officer, Data Engineer, Frontend Developer, and Security Lead before Day 15 to avoid blocking the transfer.

---

### D. SMEPro Contact Matrix

| Role | Name | Responsibility | Handoff Deliverable |
|------|------|--------------|---------------------|
| **Founder / CTO** | Chris Miguez | Architecture; IP ownership; technical decisions; steering committee | This plan; architecture specs; ADRs; final sign-off |
| **Engineering Lead** | TBD | Code remediation; CI/CD; Terraform; package development | Remediation PRs; CI/CD validation; Terraform greenfield test |
| **DevOps / SRE** | TBD | Monitoring; Vault ops; backup/restore; runbooks | Monitoring dashboards; Vault runbook; DR runbook; backup tests |
| **Compliance Engineer** | TBD | WORM validation; regulatory mapping; AI governance framework | WORM verification scripts; regulatory ingest specs; Module 3 enforcement |
| **Security Engineer** | TBD | SAST/DAST; pen test; security controls; hardening | Security scan reports; pen test coordination; hardening checklist |
| **Technical Writer** | TBD | Runbooks; API docs; transfer documentation | All runbooks; environment contracts; glossary; ADRs |

---

### E. Glossary

| Term | Definition |
|------|------------|
| **WORM** | Write Once Read Many. An append-only data integrity pattern where audit tables cannot be updated or deleted after insertion. Enforced via PostgreSQL triggers and IAM policies. |
| **SYN ID** | Synthetic Identifier. A stable, pseudonymous identifier used for privacy-preserving cross-system correlation. |
| **UDM** | Universal Decoding Matrix. The ontology and traversal engine that maps CIP → SOC → NAICS → state licensure obligations. |
| **Role-Lens** | A tenant-scoped, role-aware view filter applied to all data queries, ensuring users only see data authorized by their role. |
| **Gate 530** | The runtime compliance evaluation engine. Evaluates AI requests against policy rules and returns ALLOW, DENY, or ESCALATE. |
| **Evidence Fabric** | The cryptographic audit layer. Produces Ed25519-signed, JCS-canonicalized evidence records for every significant system action. |
| **COS+** | Compliance Operating System Plus. The PostgreSQL persistence layer with WORM, pgvector, and compliance-first indexing. |
| **UCO** | Unified Compliance Ontology. The schema layer that defines nodes, obligations, and crosswalks for regulatory mapping. |
| **L5 Field** | Level 5 field dictionary. The most granular field definition in the UCDM, mapping to `autoPopulateSource`, `statusTrigger`, `pdfFieldName`, and `crossFormValidation`. |
| **RAG Vault** | Retrieval-Augmented Generation Vault. A compliance-aware retrieval system that partitions knowledge by sector and enforces evidence-linked retrieval. |
| **IPEDS** | Integrated Postsecondary Education Data System. The U.S. Department of Education's data collection program for higher education. |
| **CBM** | Coordinating Board Manual. Texas-specific regulatory reporting forms (CBM00S, CBM00A, CBM00B, CBM009A). |
| **SACSCOC** | Southern Association of Colleges and Schools Commission on Colleges. The regional accreditor for Lamar University. |
| **PITR** | Point-in-Time Recovery. Cloud SQL feature allowing restoration to any moment within the retention window (default 7 days). |
| **RPO** | Recovery Point Objective. The maximum acceptable data loss window (target: ≤10 minutes). |
| **RTO** | Recovery Time Objective. The maximum acceptable downtime (target: ≤4 hours). |
| **WIF** | Workload Identity Federation. A GCP security feature allowing GitHub Actions to authenticate to GCP without long-lived service account keys. |
| **GAR** | Google Artifact Registry. The container registry used for Docker image storage. |
| **Cloud Deploy** | GCP's managed continuous delivery service for GKE. Used for staging → production promotion with canary and rollback support. |
| **Helm** | Kubernetes package manager. Used to template and deploy the IOS+ application to GKE. |
| **Vault** | HashiCorp Vault. Secrets management, PKI, and transit encryption service used for signing keys and dynamic credentials. |
| **Cloud Armor** | GCP's DDoS and WAF protection service. Used to protect the ingress from malicious traffic. |
| **IAP** | Identity-Aware Proxy. GCP service providing zero-trust access control for internal applications without VPN. |
| **CIP** | Classification of Instructional Programs. A U.S. Department of Education taxonomy for academic programs. |
| **SOC** | Standard Occupational Classification. A U.S. Bureau of Labor Statistics taxonomy for occupations. |
| **NAICS** | North American Industry Classification System. A standard for classifying business establishments. |
| **Ed25519** | A modern elliptic curve signature scheme used for evidence signing. Fast, secure, and deterministic. |
| **JCS** | JSON Canonicalization Scheme (RFC 8785). Ensures that the same JSON payload always produces the same byte sequence for signing, regardless of key ordering or whitespace. |
| **UC** | Use Case. The EDU Reporter dashboard views (UC-01 through UC-08) covering licensure, compliance, regulatory reporting, and governance. |
| **ADR** | Architecture Decision Record. A document capturing a significant architectural decision, its context, and consequences. |
| **SAST** | Static Application Security Testing. Automated scanning of source code for security vulnerabilities. |
| **DAST** | Dynamic Application Security Testing. Automated scanning of running applications for security vulnerabilities. |
| **SLO** | Service Level Objective. A measurable target for service reliability (e.g., 99.9% availability). |
| **DLQ** | Dead Letter Queue. A Pub/Sub subscription for messages that failed processing after maximum retries. |
| **FinOps** | Cloud financial management practice. Involves budgeting, cost optimization, and chargeback. |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2025-06-21 | SMEPro Engineering | Initial draft. Comprehensive assessment, wave scoping, transfer checklist, remediation list, environment contracts, acceptance criteria, risk register, and go/no-go decision points. |

---

**Next Steps:**
1. **SMEPro Review:** Chris Miguez to review this plan and approve or amend within 3 business days.
2. **Lamar Review:** Chris Carter and Lamar IT leadership to review and confirm resource availability within 5 business days.
3. **Schedule Day 15 Go/No-Go:** Calendar invite for Day 15 decision point with all required attendees.
4. **Create Remediation PR:** SMEPro Engineering Lead to open a PR removing all Wave 1 blocker references within 48 hours.
5. **Assign Lamar Owners:** Lamar to assign IT Director, Platform Engineer, Compliance Officer, Data Engineer, Frontend Developer, and Security Lead within 7 days.
