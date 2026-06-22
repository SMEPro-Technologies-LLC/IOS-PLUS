# IOS+ 90-Day Execution Plan

> **Purpose:** Concrete, day-by-day project plan with owners, artifacts, and acceptance criteria for productionizing IOS+ and transferring operational control to Lamar.  
> **Date:** 2025-06-21  
> **Applies to:** Wave 1 (critical path) + Wave 2 (feature completeness) + Wave 3 (future)  
> **Assumptions:** 2–3 engineers from SMEPro, 1–2 engineers from Lamar, GCP project `lamar-cos` exists, Lamar has `roles/editor` or equivalent on GCP.

---

## Resource Requirements

| Role | Count | Skills Required | Allocation |
|------|-------|-----------------|------------|
| SMEPro Lead Engineer | 1 | Node.js/TypeScript, GCP, K8s, Terraform | Full-time (Days 1–60), Half-time (Days 61–90) |
| SMEPro Backend Engineer | 1 | PostgreSQL, Node.js, API design | Full-time (Days 1–45) |
| SMEPro DevOps Engineer | 1 | Terraform, K8s, GitHub Actions, security | Full-time (Days 1–30), Half-time (Days 31–60) |
| Lamar Engineer | 1–2 | Node.js/TypeScript, React, GCP (or willing to learn) | Days 46–90 (ramping from 25% to full-time) |
| Lamar Product/Compliance | 1 | FERPA, compliance, audit readiness | Days 61–90 (part-time) |

**Total Engineering Hours (estimated):** 1,440–1,920 hours (90 days × 2–2.5 FTEs average)

**Infrastructure Cost Estimate (GCP, monthly):**

| Service | Staging | Production | Notes |
|---------|---------|------------|-------|
| GKE Autopilot | ~$200 | ~$800 | 3 nodes staging, 5 nodes prod |
| Cloud SQL (HA + pgvector) | ~$150 | ~$400 | db-g1-small staging, db-n1-standard-2 prod |
| Memorystore (Redis) | ~$30 | ~$100 | 1 GB staging, 5 GB prod |
| Pub/Sub | ~$10 | ~$50 | 1M messages/day estimated |
| Cloud Storage | ~$5 | ~$20 | Backups, artifacts |
| Secret Manager | ~$5 | ~$10 | ~50 secrets |
| Cloud Armor | ~$10 | ~$50 | WAF rules |
| GCR/GAR | ~$10 | ~$30 | Image storage |
| Cloud Deploy | ~$0 | ~$0 | Included in GKE pricing |
| Cloud Monitoring | ~$20 | ~$100 | Metrics, logs, alerts |
| **Total** | **~$440** | **~$1,560** | |

**Budget (engineering + infrastructure):** ~$180K–$240K (contractor rates) + ~$20K GCP over 90 days

---

## Communication Plan

| Meeting | Frequency | Attendees | Purpose |
|---------|-----------|-----------|---------|
| Standup | Daily (15 min) | All engineers | Blockers, progress, next steps |
| Sprint Review | Weekly (1 hour) | All + leads | Demo, acceptance criteria review |
| Architecture Review | Weekly (1 hour) | SMEPro Lead, Lamar Engineer | Design decisions, API contracts |
| Risk/Escalation | Weekly (30 min) | SMEPro Lead, Lamar Lead, Chris Miguez | Go/No-Go, blockers, budget |
| Compliance Check-in | Bi-weekly (1 hour) | Compliance lead, SMEPro Lead | FERPA, audit readiness, evidence |
| Handoff Session | Days 82, 85, 88, 90 | All Lamar team | Knowledge transfer |

**Escalation path:**  
Day 1–45: SMEPro Lead → Chris Miguez  
Day 46–90: SMEPro Lead + Lamar Lead → Chris Miguez + Chris Carter

---

## Go/No-Go Decision Criteria

| Phase | Go Criteria | No-Go Criteria |
|-------|-------------|----------------|
| **Inventory & Standardize** (Day 15) | All repos inventoried; Wave 1 scope defined; CI/CD skeleton runs; all Wave 1 services have Dockerfiles | Missing deployable artifacts; unclear scope; CI/CD cannot build |
| **Implement & Deploy** (Day 30) | Dev environment provisioned; vertical slice deploys end-to-end; health probes return real status; observability stack visible | Vertical slice fails; probes are fake; no observability |
| **Harden & Validate** (Day 45) | Auth hardened (JWT sig verification, RBAC); SAST/DAST passing; load tests pass; runbooks exist; internal review passed | Auth still stubbed; security scan failures; load tests fail |
| **Lamar Staging** (Day 60) | Lamar staging deployed; GitHub org transfer tested; joint ops exercises passed; security review passed | Lamar cannot deploy independently; ops exercises fail |
| **Production Prep** (Day 75) | Prod environment provisioned; canary rollout tested; DR rehearsal passed; compliance review passed | Prod provisioning fails; DR test fails; compliance gaps |
| **Handoff & Go-Live** (Day 90) | All Wave 1 items verified; production launch successful; 48-hour post-launch monitoring stable; handoff package delivered | Launch fails; critical bugs; incomplete handoff |

---

## Contingency Plan

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Task takes 2x longer | High | Schedule slip | Add 20% buffer to every estimate. Cut Wave 3 (frontend, connectors, ML) if Wave 1/2 slip. |
| SMEPro engineer unavailable | Medium | Velocity drop | Lamar engineer pairs early (Day 30) to build redundancy. |
| GCP IAM/org issues | Medium | Cannot deploy | Verify `lamar-cos` project + billing + APIs on Day 1. Have SMEPro admin as backup. |
| Security scan blockers | Medium | Cannot deploy | Run Snyk/Trivy/Checkov locally on Day 10 to catch issues early. |
| Test writing takes longer than expected | High | Days 10–15 slip | Start with integration tests (highest ROI) rather than unit tests for every function. |
| Frontend scope creep | Medium | Wave 3 never finishes | Hard cutoff: frontend must be a thin React wrapper around API by Day 60. No custom features. |
| Compliance audit findings | Low | Cannot go-live | Run compliance pre-review on Day 70. Fix findings in Days 71–75 buffer. |

**Buffer allocation:** Days 43–45, 58–60, 73–75, and 88–90 are explicit buffers.

---

## Days 1–15: Inventory & Standardize

### Day 1: Inventory Actual Repo Contents vs Architecture Docs

| Field | Value |
|-------|-------|
| **Date** | Day 1 |
| **Phase** | Inventory |
| **Task** | Audit every file in the repo against the architecture documents (`IOS_Plus_v2_Implementation_Spec.md`, `IOS_Plus_v2_Architecture`). Identify every file that exists, every file that is referenced but missing, and every stub (`TODO`, `In production`, `simulate`). |
| **Owner** | SMEPro Lead Engineer |
| **Artifact** | `ios-plus/docs/Repo_Inventory_Audit.md` — table of every component with file existence status, stub count, and readiness score. |
| **Acceptance Criteria** | 1. Inventory covers all 15+ components. 2. Every stub/TODO is catalogued with line number. 3. Score is assigned 0–10 per component. 4. Gaps are ranked by criticality. |
| **Dependencies** | None |
| **Estimated Effort** | 1 day |
| **Risk** | Low — mechanical task, but may reveal more gaps than expected. |

### Day 2: Define v1 Production Scope (Wave 1 Cut)

| Field | Value |
|-------|-------|
| **Date** | Day 2 |
| **Phase** | Inventory |
| **Task** | Decide what goes into Wave 1 (MVP for production). Cut Wave 2 and Wave 3 features explicitly. Document the decision. |
| **Owner** | Chris Miguez (SMEPro) + Chris Carter (Lamar) |
| **Artifact** | `ios-plus/docs/Wave_1_Scope_Decision.md` — explicit list of IN/OUT features with rationale. |
| **Acceptance Criteria** | 1. Wave 1 scope fits in 60 days. 2. All stakeholders agree (email ack or sign-off). 3. OUT features have a future date. 4. Scope is pinned to this document. |
| **Dependencies** | Day 1 inventory |
| **Estimated Effort** | 0.5 day |
| **Risk** | Medium — stakeholder disagreement on scope. Mitigate: use readiness scores from Day 1 as objective input. |

### Day 3: Identify Missing Deployable Artifacts

| Field | Value |
|-------|-------|
| **Date** | Day 3 |
| **Phase** | Inventory |
| **Task** | For every Wave 1 component, list missing deployable artifacts: Dockerfiles, Helm charts, K8s manifests, Terraform modules, CI/CD jobs, config files, secrets. |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/docs/Missing_Artifacts_Checklist.md` — checklist with owner and due date per item. |
| **Acceptance Criteria** | 1. Every Wave 1 component has a complete artifact list. 2. Missing items are tagged as "create" or "fix." 3. Each item has an owner. 4. Total count is known. |
| **Dependencies** | Day 2 scope |
| **Estimated Effort** | 1 day |
| **Risk** | Low |

### Day 4: Decide Target Runtime (GKE, On-Prem K8s, or Hybrid)

| Field | Value |
|-------|-------|
| **Date** | Day 4 |
| **Phase** | Inventory |
| **Task** | Confirm runtime environment. Validate GCP project `lamar-cos` exists, billing enabled, APIs enabled. Decide on GKE Autopilot vs Standard. Confirm on-prem requirements (if any). |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Runtime_Decision_Record.md` — ADR with decision, consequences, and rollback plan. |
| **Acceptance Criteria** | 1. GCP project ID confirmed. 2. Billing account verified. 3. Required APIs enabled (or enable plan documented). 4. GKE Autopilot vs Standard decided. 5. On-prem K8s ruled in or out. 6. Decision is signed off by both parties. |
| **Dependencies** | Day 3 artifacts |
| **Estimated Effort** | 0.5 day |
| **Risk** | Medium — if Lamar lacks GCP org permissions, may need SMEPro to create resources. |

### Day 5: Create Transfer-Readiness Checklist

| Field | Value |
|-------|-------|
| **Date** | Day 5 |
| **Phase** | Inventory |
| **Task** | Define the exact criteria for Lamar to accept ownership. What docs, credentials, tests, and evidence must be delivered. |
| **Owner** | SMEPro Lead Engineer + Lamar Lead |
| **Artifact** | `ios-plus/docs/Transfer_Readiness_Checklist.md` — checklist with sign-off columns for SMEPro and Lamar. |
| **Acceptance Criteria** | 1. Checklist covers: code, docs, credentials, test results, SBOMs, runbooks, compliance evidence, infrastructure access. 2. Each item has a deliverable path. 3. Both parties have signed off. |
| **Dependencies** | Day 4 runtime decision |
| **Estimated Effort** | 0.5 day |
| **Risk** | Low |

### Day 6–7: Standardize Repo Structure

| Field | Value |
|-------|-------|
| **Date** | Days 6–7 |
| **Phase** | Standardize |
| **Task** | Move files to consistent locations. Fix `k8s` → `kubernetes` path mismatch. Ensure every service has its own directory under `packages/` or `services/`. Normalize naming conventions. |
| **Owner** | SMEPro Lead Engineer |
| **Artifact** | Restructured repo + `ios-plus/docs/Repo_Structure_Changelog.md` — before/after paths. |
| **Acceptance Criteria** | 1. `skaffold.yaml` paths are correct. 2. All K8s manifests reference correct paths. 3. `package.json` workspace paths are valid. 4. CI passes `typecheck` and `lint`. 5. No broken imports. |
| **Dependencies** | Day 5 checklist |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — restructure can break CI. Mitigate: do it in a feature branch, run CI dry-run. |

### Day 8–9: Implement Environment Configs and Secret Strategy

| Field | Value |
|-------|-------|
| **Date** | Days 8–9 |
| **Phase** | Standardize |
| **Task** | Create per-environment config files (`.env.staging`, `.env.production`). Implement Secret Manager CSI driver configuration. Remove hardcoded secrets from docker-compose. Document secret rotation procedure. |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/config/environments/` (new dir), `ios-plus/docs/Secret_Rotation_Runbook.md`, updated `docker-compose.yml` with no hardcoded passwords. |
| **Acceptance Criteria** | 1. No secrets in Git (scan with `gitleaks` or `truffleHog`). 2. Each environment has a config file. 3. Secret Manager CSI classes are defined for all services. 4. Vault Agent injection is documented. 5. `docker-compose.yml` uses `.env` files only. |
| **Dependencies** | Days 6–7 restructure |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — secret rotation can break local dev. Mitigate: test locally with new `.env` files. |

### Day 10–11: Containerize All Wave 1 Services

| Field | Value |
|-------|-------|
| **Date** | Days 10–11 |
| **Phase** | Standardize |
| **Task** | Create per-service Dockerfiles (not monolithic). Each Dockerfile must: multi-stage build, deterministic base image (`node:20.19.0-alpine@sha256:...`), non-root user (`USER 1001`), no `latest` tags, health check, `readOnlyRootFilesystem` compatible, SBOM generation, vulnerability scan in CI. |
| **Owner** | SMEPro DevOps Engineer + SMEPro Backend Engineer |
| **Artifact** | `services/api-gateway/Dockerfile`, `services/canonical-layer/Dockerfile`, `services/udm-query/Dockerfile`, `services/evidence-chain/Dockerfile`, `services/rules-engine/Dockerfile`, `services/approval-queue/Dockerfile`, updated `docker-compose.yml` to use new images. |
| **Acceptance Criteria** | 1. Each service builds independently. 2. `docker compose up` brings up all Wave 1 services. 3. Each container runs as non-root. 4. `docker scout` or `trivy image` shows ≤ 2 CRITICAL vulnerabilities. 5. SBOM (`syft` or `docker sbom`) is generated per image. 6. Image size ≤ 200 MB per service. |
| **Dependencies** | Days 8–9 configs |
| **Estimated Effort** | 2 days |
| **Risk** | High — splitting monolithic Dockerfile into per-service images is non-trivial. Mitigate: start with 2 services (API gateway + canonical layer) on Day 10, rest on Day 11. |

### Day 12–13: Create Helm Charts for Wave 1 Services

| Field | Value |
|-------|-------|
| **Date** | Days 12–13 |
| **Phase** | Standardize |
| **Task** | Create per-service Helm charts (or one umbrella chart with subcharts). Each chart must: deployment, service, HPA, PDB, network policy, service account, RBAC, ConfigMap, Secret (or CSI), ingress (optional). |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | `infra/helm/api-gateway/`, `infra/helm/canonical-layer/`, `infra/helm/udm-query/`, `infra/helm/evidence-chain/`, `infra/helm/rules-engine/`, `infra/helm/approval-queue/`, `infra/helm/umbrella/Chart.yaml` with dependencies. |
| **Acceptance Criteria** | 1. `helm lint` passes for all charts. 2. `helm template` renders valid YAML. 3. Each chart has `values.yaml` and `values.production.yaml`. 4. Network policies are defined (default-deny + allow). 5. PodSecurityContext and SecurityContext are set. 6. Resource requests/limits are set. |
| **Dependencies** | Days 10–11 Dockerfiles |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — Helm chart boilerplate is repetitive. Mitigate: use a Helm chart generator or copy-paste from existing `ios-plus` chart. |

### Day 14–15: Set Up Lamar-Compatible CI/CD Skeleton

| Field | Value |
|-------|-------|
| **Date** | Days 14–15 |
| **Phase** | Standardize |
| **Task** | Update GitHub Actions to use Workload Identity Federation (no service account keys). Ensure pipeline runs on Lamar's GitHub org (or document transfer path). Add image signing (cosign). Fix path mismatches (`k8s` vs `kubernetes`). Add dependency update automation (Dependabot). |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | `.github/workflows/ci.yml` (updated), `.github/workflows/cd-gcp.yml` (updated), `.github/dependabot.yml`, `ios-plus/docs/CI_CD_Transfer_Guide.md`. |
| **Acceptance Criteria** | 1. CI runs on `pull_request` without secrets (lint, typecheck, build). 2. CI runs on `push` to `main` with WIF (build, test, security scan, push to GAR). 3. CD runs on `workflow_dispatch` with environment choice. 4. Images are signed with cosign. 5. SBOM is attached to image. 6. No hardcoded secrets in workflow files. 7. Path mismatches are fixed. 8. Dependabot is configured for npm and GitHub Actions. |
| **Dependencies** | Days 12–13 Helm charts |
| **Estimated Effort** | 2 days |
| **Risk** | High — WIF setup can be tricky if Lamar's GitHub org has different repo names. Mitigate: test WIF on a fork first. |

---

## Days 16–30: Implement & Deploy

### Day 16–17: Provision Dev Environment (Terraform Bootstrap)

| Field | Value |
|-------|-------|
| **Date** | Days 16–17 |
| **Phase** | Implement |
| **Task** | Run `terraform apply` to `lamar-cos` dev environment. Create GKE cluster, Cloud SQL instance, Redis (Memorystore), Pub/Sub topics, Secret Manager secrets, GCS buckets, IAM bindings. Verify all resources. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer (shadowing) |
| **Artifact** | Terraform state in GCS bucket, `ios-plus/docs/Dev_Environment_Provisioned.md` — resource list, endpoints, connection strings. |
| **Acceptance Criteria** | 1. `terraform plan` shows 0 changes after apply. 2. GKE cluster is accessible via `kubectl`. 3. Cloud SQL instance has `pgvector` enabled. 4. Redis instance is reachable. 5. Pub/Sub topics exist. 6. Secret Manager has all required secrets. 7. `kubectl get nodes` returns healthy nodes. 8. Cloud Monitoring workspace is active. |
| **Dependencies** | Days 14–15 CI/CD |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — GCP quota or IAM issues can block. Mitigate: enable all APIs on Day 4. |

### Day 18–20: Deploy End-to-End Vertical Slice

| Field | Value |
|-------|-------|
| **Date** | Days 18–20 |
| **Phase** | Implement |
| **Task** | Deploy the smallest working system: API Gateway → Canonical Layer (COS+ DB) → UDM Query (stubbed endpoint replaced with real resolver). Verify data flows through. |
| **Owner** | SMEPro Lead Engineer + SMEPro Backend Engineer |
| **Artifact** | Working dev deployment + `ios-plus/docs/Vertical_Slice_Test_Report.md` — curl commands and responses. |
| **Acceptance Criteria** | 1. `curl /health` returns 200 with real DB latency. 2. `curl /ready` returns 200 only if DB is connected. 3. `curl /v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA` returns real data from UCO resolver (not stub). 4. Audit event is written to PostgreSQL (not in-memory). 5. Evidence is signed with Ed25519 (not stub). 6. No errors in application logs. |
| **Dependencies** | Days 16–17 dev environment |
| **Estimated Effort** | 3 days |
| **Risk** | **High** — this requires wiring up stubbed layers (Evaluation, Evidence, Audit, UDM). Mitigate: pair program, focus on one layer per day. |

### Day 21–22: Add Observability (Health Probes, Metrics, Prometheus)

| Field | Value |
|-------|-------|
| **Date** | Days 21–22 |
| **Phase** | Implement |
| **Task** | Replace fake readiness probes with real dependency checks. Add Prometheus client library (`prom-client`) for standard metrics. Deploy Prometheus + Grafana in GKE. Configure Alertmanager. Add Slack/PagerDuty notification channel. |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | Updated `server.ts` with real `/ready` checks, `packages/middleware-engine/src/metrics.ts` (Prometheus client), `infra/kubernetes/monitoring/` (Prometheus + Grafana + Alertmanager K8s manifests), `ios-plus/docs/Observability_Runbook.md`. |
| **Acceptance Criteria** | 1. `/ready` returns 503 if DB is unreachable. 2. `/ready` returns 503 if Vault is unreachable. 3. Prometheus scrapes `/metrics` successfully. 4. Grafana dashboard shows request rate, latency, error rate. 5. Alertmanager sends test alert to Slack. 6. `http_request_duration_seconds` histogram is exported. 7. DB connection pool metrics are exported. |
| **Dependencies** | Days 18–20 vertical slice |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — Prometheus K8s deployment can be tricky. Mitigate: use kube-prometheus-stack Helm chart as base. |

### Day 23–24: Run Migration/Backup/Restore Testing

| Field | Value |
|-------|-------|
| **Date** | Days 23–24 |
| **Phase** | Implement |
| **Task** | Test Cloud SQL PITR: create data, delete it, restore to point before deletion. Test WORM verification script. Document RTO/RPO. Test migration rollback. |
| **Owner** | SMEPro Backend Engineer + SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/docs/Backup_Restore_Test_Report.md` — screenshots, commands, RTO/RPO numbers, rollback procedure. |
| **Acceptance Criteria** | 1. PITR restore succeeds within 30 minutes. 2. Restored data matches pre-deletion state. 3. WORM verification script passes. 4. Migration rollback procedure is documented and tested. 5. RTO ≤ 1 hour, RPO ≤ 15 minutes (documented). 6. Cloud SQL backup schedule is verified. |
| **Dependencies** | Days 21–22 observability |
| **Estimated Effort** | 2 days |
| **Risk** | Medium — PITR restore can be slow. Mitigate: use small dataset for test. |

### Day 25–27: Add CI/CD Security Scanning (Snyk, Trivy, Checkov)

| Field | Value |
|-------|-------|
| **Date** | Days 25–27 |
| **Phase** | Implement |
| **Task** | Ensure Snyk, Trivy, and Checkov are running in CI and blocking on CRITICAL/HIGH findings. Add container image scanning on push. Add Terraform security scanning. Fix any findings. |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | Updated `.github/workflows/ci-gcp.yml`, `ios-plus/docs/Security_Scan_Results.md` — findings and remediations. |
| **Acceptance Criteria** | 1. Snyk scan runs on every PR. 2. Trivy image scan runs on every build. 3. Checkov runs on every Terraform change. 4. CI fails if ≥ 1 CRITICAL vulnerability is found. 5. All existing CRITICAL findings are remediated or have documented exceptions. 6. SARIF reports are uploaded to GitHub Security tab. |
| **Dependencies** | Days 23–24 backup testing |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — security findings may require dependency upgrades that break build. Mitigate: test upgrades locally first. |

### Day 28–30: Performance and Load Testing, Failure Drills

| Field | Value |
|-------|-------|
| **Date** | Days 28–30 |
| **Phase** | Implement |
| **Task** | Run load tests against dev environment. Use `k6` or Artillery. Test failure scenarios: DB failover, pod kill, Vault restart, network partition. Document results. |
| **Owner** | SMEPro Lead Engineer + SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/docs/Load_Test_Report.md`, `ios-plus/docs/Failure_Drill_Report.md`, `tests/load/k6-script.js`. |
| **Acceptance Criteria** | 1. API handles 100 RPS with p95 latency < 200 ms. 2. API handles 500 RPS with p95 latency < 500 ms (degraded but functional). 3. DB failover causes < 30 seconds of errors. 4. Pod kill triggers HPA scale-up within 60 seconds. 5. Vault restart causes < 10 seconds of signing failures (fail-closed). 6. All findings have remediation tickets. |
| **Dependencies** | Days 25–27 security scanning |
| **Estimated Effort** | 3 days |
| **Risk** | High — load tests may reveal architectural issues. Mitigate: start with 10 RPS and scale up. |

---

## Days 31–45: Harden & Validate

### Day 31–33: Harden Auth, RBAC, Network Policy, Ingress, TLS

| Field | Value |
|-------|-------|
| **Date** | Days 31–33 |
| **Phase** | Harden |
| **Task** | Implement JWT signature verification with `jsonwebtoken` or `jose`. Add RBAC middleware (role-based access control). Implement NetworkPolicy (default-deny + allow lists). Deploy cert-manager for TLS. Enable mTLS between services (Istio or Linkerd optional). |
| **Owner** | SMEPro Lead Engineer + SMEPro Backend Engineer |
| **Artifact** | Updated `packages/middleware-engine/src/layers/auth.ts` (JWT sig verification), `packages/middleware-engine/src/layers/rbac.ts` (new), `infra/kubernetes/network-policies/` (updated), `infra/kubernetes/cert-manager/` (new), `ios-plus/docs/Auth_Hardening_Report.md`. |
| **Acceptance Criteria** | 1. JWT tokens with invalid signatures are rejected with 403. 2. JWT tokens with expired signatures are rejected with 403. 3. RBAC middleware rejects unauthorized actions with 403. 4. NetworkPolicy blocks traffic from unauthorized namespaces. 5. Ingress serves HTTPS with valid cert from Let's Encrypt. 6. mTLS is enabled between API Gateway and Canonical Layer. 7. Auth penetration test passes (Burp Suite or OWASP ZAP). |
| **Dependencies** | Days 28–30 load testing |
| **Estimated Effort** | 3 days |
| **Risk** | **High** — JWT signature verification requires key management. Mitigate: use Secret Manager for JWKS, implement JWKS endpoint rotation. |

### Day 34–36: Add SAST/DAST, Container Scanning, SBOM Generation

| Field | Value |
|-------|-------|
| **Date** | Days 34–36 |
| **Phase** | Harden |
| **Task** | Add SAST (CodeQL, Semgrep). Add DAST (OWASP ZAP against staging). Add container SBOM generation in CI (Syft, CycloneDX). Sign SBOMs with cosign. |
| **Owner** | SMEPro DevOps Engineer |
| **Artifact** | Updated `.github/workflows/ci-gcp.yml` (SAST/DAST jobs), `ios-plus/docs/SBOM_Inventory.md`, signed SBOMs in GCS. |
| **Acceptance Criteria** | 1. CodeQL runs on every PR. 2. Semgrep runs on every PR. 3. OWASP ZAP runs against staging weekly. 4. SBOM is generated for every image build. 5. SBOM is signed and stored in GCS. 6. No CRITICAL SAST findings without exception. 7. DAST report shows 0 HIGH vulnerabilities. |
| **Dependencies** | Days 31–33 auth hardening |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — DAST can find false positives. Mitigate: tune ZAP rules, review findings manually. |

### Day 37–39: Run Load Tests, Chaos Engineering, Failure Drills

| Field | Value |
|-------|-------|
| **Date** | Days 37–39 |
| **Phase** | Harden |
| **Task** | Repeat load tests with hardened environment. Run chaos engineering: Litmus or Chaos Mesh. Test specific scenarios: DB connection pool exhaustion, Redis failure, Vault seal, network latency injection. |
| **Owner** | SMEPro Lead Engineer + SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/docs/Chaos_Engineering_Report.md`, `ios-plus/docs/Final_Load_Test_Report.md`. |
| **Acceptance Criteria** | 1. System handles 1000 RPS with graceful degradation. 2. Chaos experiments show auto-recovery within 2 minutes. 3. DB pool exhaustion triggers circuit breaker. 4. Redis failure does not crash API (falls back to in-memory). 5. Vault seal triggers fail-closed (no unsigned evidence). 6. Network latency < 100 ms added does not cause cascading failures. 7. All findings have remediation tickets. |
| **Dependencies** | Days 34–36 SAST/DAST |
| **Estimated Effort** | 3 days |
| **Risk** | High — chaos engineering can reveal deep issues. Mitigate: run in dev first, then staging. |

### Day 40–42: Document Runbooks, Operational Procedures, Handoff Docs

| Field | Value |
|-------|-------|
| **Date** | Days 40–42 |
| **Phase** | Harden |
| **Task** | Write operational runbooks: incident response, on-call, deployment rollback, secret rotation, DB restore, scaling procedures. Write handoff docs: architecture decision records, API contracts, dependency map. |
| **Owner** | SMEPro Lead Engineer + SMEPro Backend Engineer |
| **Artifact** | `ios-plus/docs/runbooks/` (new dir): `Incident_Response.md`, `Deployment_Rollback.md`, `Secret_Rotation.md`, `DB_Restore.md`, `Scaling_Procedure.md`, `ios-plus/docs/Handoff_Package_Index.md`. |
| **Acceptance Criteria** | 1. Each runbook has: purpose, prerequisites, step-by-step commands, expected output, rollback steps, escalation path. 2. Runbooks are tested by someone who did not write them. 3. Handoff index is complete and cross-referenced. 4. API contracts are documented with OpenAPI specs. 5. Dependency map is visual (Mermaid or diagram). |
| **Dependencies** | Days 37–39 chaos engineering |
| **Estimated Effort** | 3 days |
| **Risk** | Low — documentation is time-consuming but not technically risky. |

### Day 43–45: Internal Validation and Review (SMEPro Team Review, Fix Issues)

| Field | Value |
|-------|-------|
| **Date** | Days 43–45 |
| **Phase** | Harden |
| **Task** | Internal audit: all tests must pass, all security scans must pass, all docs must be reviewed. Fix any issues found. This is a buffer. |
| **Owner** | SMEPro Lead Engineer |
| **Artifact** | `ios-plus/docs/Internal_Review_Report.md` — checklist with pass/fail and remediation list. |
| **Acceptance Criteria** | 1. All CI checks green. 2. All security scans green (or exceptions documented). 3. All runbooks reviewed by second engineer. 4. All Wave 1 components score ≥ 7 on readiness matrix. 5. No P0 or P1 bugs open. 6. Deployment to dev is reproducible from README. |
| **Dependencies** | Days 40–42 docs |
| **Estimated Effort** | 3 days |
| **Risk** | Low — buffer absorbs slip. |

---

## Days 46–60: Lamar Staging

### Day 46–48: Deploy into Lamar-Owned Staging Environment

| Field | Value |
|-------|-------|
| **Date** | Days 46–48 |
| **Phase** | Deploy |
| **Task** | Lamar engineer runs Terraform apply to create their own staging environment. Deploys Wave 1 services using Helm. Validates end-to-end. SMEPro shadows and answers questions. |
| **Owner** | Lamar Engineer (primary) + SMEPro DevOps Engineer (shadow) |
| **Artifact** | `ios-plus/docs/Lamar_Staging_Deployment_Log.md` — commands run, issues encountered, resolutions. |
| **Acceptance Criteria** | 1. Lamar engineer runs `terraform apply` independently (SMEPro does not touch keyboard). 2. `kubectl get pods` shows all Wave 1 services running. 3. `/health` and `/ready` return 200. 4. `/v1/evaluate` returns a real decision. 5. Lamar engineer can access Grafana and sees metrics. 6. Deployment log is complete. |
| **Dependencies** | Days 43–45 internal review |
| **Estimated Effort** | 3 days |
| **Risk** | **High** — Lamar engineer may lack GCP familiarity. Mitigate: SMEPro shadows, does not drive. Pair on IAM issues. |

### Day 49–51: Validate GitHub Org Transfer Path

| Field | Value |
|-------|-------|
| **Date** | Days 49–51 |
| **Phase** | Deploy |
| **Task** | Test the repository transfer from `smeprotech` GitHub org to `lamar-university` (or Lamar's org). Validate CI/CD still runs after transfer. Update WIF provider to trust new org. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/GitHub_Transfer_Test_Report.md` — step-by-step, issues, resolutions. |
| **Acceptance Criteria** | 1. Repo is cloned/forked to Lamar org. 2. CI passes on Lamar org without SMEPro secrets. 3. CD deploys to Lamar staging from Lamar org. 4. WIF provider trusts Lamar org repo. 5. All GitHub Actions secrets are recreated in Lamar org. 6. No SMEPro secrets are present in Lamar org. |
| **Dependencies** | Days 46–48 Lamar staging |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — WIF provider may need GCP org-level changes. Mitigate: involve GCP admin early. |

### Day 52–54: Validate Self-Hosted Runner Deployment Path (If On-Prem)

| Field | Value |
|-------|-------|
| **Date** | Days 52–54 |
| **Phase** | Deploy |
| **Task** | If Lamar requires on-prem K8s, test self-hosted GitHub Actions runner deployment. Document the path. If fully cloud, skip and add buffer. |
| **Owner** | Lamar Engineer + SMEPro DevOps Engineer |
| **Artifact** | `ios-plus/docs/Self_Hosted_Runner_Guide.md` (if applicable) or `ios-plus/docs/On_Prem_Ruled_Out.md` (if skipped). |
| **Acceptance Criteria** | 1. Self-hosted runner is registered and picks up jobs. 2. Runner can access on-prem K8s cluster. 3. Runner can push to GAR (or local registry). 4. Documentation is complete. OR: Decision record confirms on-prem is not required. |
| **Dependencies** | Days 49–51 GitHub transfer |
| **Estimated Effort** | 3 days (or 0 if skipped) |
| **Risk** | Medium — self-hosted runners have networking and security implications. |

### Day 55–57: Perform Joint Ops Exercises (SMEPro + Lamar Team, Incident Simulation)

| Field | Value |
|-------|-------|
| **Date** | Days 55–57 |
| **Phase** | Deploy |
| **Task** | Run incident simulation: DB goes down, pod crash loops, Vault seal, high latency. Both teams respond using runbooks. Evaluate response time and effectiveness. |
| **Owner** | SMEPro Lead Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Joint_Ops_Exercise_Report.md` — scenarios, response times, gaps, action items. |
| **Acceptance Criteria** | 1. 3+ incident scenarios are simulated. 2. Response time is documented for each. 3. Runbooks are followed without SMEPro intervention for at least 1 scenario. 4. Lamar engineer can roll back a deployment independently. 5. Lamar engineer can scale a deployment independently. 6. Gaps are documented with tickets. |
| **Dependencies** | Days 52–54 runner validation |
| **Estimated Effort** | 3 days |
| **Risk** | Low — educational, but may reveal runbook gaps. |

### Day 58–60: Security Validation Review (Access Control Tests, Audit Evidence Generation)

| Field | Value |
|-------|-------|
| **Date** | Days 58–60 |
| **Phase** | Deploy |
| **Task** | Run security validation: access control tests, penetration test, audit evidence generation. Verify FERPA-relevant controls: pseudonymization, audit logging, data retention. |
| **Owner** | Lamar Product/Compliance + SMEPro Lead Engineer |
| **Artifact** | `ios-plus/docs/Security_Validation_Report.md`, `ios-plus/docs/FERPA_Controls_Evidence.md`. |
| **Acceptance Criteria** | 1. Penetration test shows 0 CRITICAL, ≤ 2 HIGH (with remediation plan). 2. Access control matrix is documented and tested. 3. Audit trail shows all admin actions with before/after. 4. WORM verification passes. 5. Pseudonymization is confirmed (no PII in logs). 6. Data retention policy is documented and enforced. 7. Evidence is sufficient for external auditor. |
| **Dependencies** | Days 55–57 joint ops |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — compliance findings may require code changes. Mitigate: buffer on Days 58–60. |

---

## Days 61–75: Production Prep

### Day 61–63: Production Environment Provisioning (Terraform Apply to Prod)

| Field | Value |
|-------|-------|
| **Date** | Days 61–63 |
| **Phase** | Production Prep |
| **Task** | Run `terraform apply` to production environment. Use separate workspace or `tfvars`. Enable deletion protection on production DB. Enable VPC Service Controls. Verify all resources. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer (shadow) |
| **Artifact** | `ios-plus/docs/Prod_Environment_Provisioned.md` — resource list, endpoints, verification commands. |
| **Acceptance Criteria** | 1. `terraform apply` succeeds with no errors. 2. Production GKE cluster is separate from staging. 3. Production Cloud SQL has deletion protection enabled. 4. Production secrets are in separate Secret Manager path. 5. VPC Service Controls are enabled. 6. No staging resources are mixed with production. 7. `kubectl` context is verified. |
| **Dependencies** | Days 58–60 security validation |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — production provisioning is high stakes. Mitigate: run `terraform plan` first, review with both leads. |

### Day 64–66: Cloud Deploy Pipeline Validation (Staging → Production Promotion)

| Field | Value |
|-------|-------|
| **Date** | Days 64–66 |
| **Phase** | Production Prep |
| **Task** | Validate the full Cloud Deploy pipeline: build → staging → production promotion. Test canary rollout. Verify rollback works. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Cloud_Deploy_Validation_Report.md` — pipeline steps, timings, rollback test results. |
| **Acceptance Criteria** | 1. `gcloud deploy releases create` succeeds. 2. Staging promotion succeeds. 3. Smoke tests pass in staging. 4. Production canary at 25% succeeds. 5. Production canary at 50% succeeds. 6. Rollback command succeeds and restores previous version. 7. Pipeline timing is documented. |
| **Dependencies** | Days 61–63 prod provisioning |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — canary promotion can fail. Mitigate: test with low-risk image first. |

### Day 67–69: Canary Rollout Testing (25% → 50% → 75% → 100%)

| Field | Value |
|-------|-------|
| **Date** | Days 67–69 |
| **Phase** | Production Prep |
| **Task** | Perform a full canary rollout in production with a harmless change (e.g., version string bump). Monitor metrics at each stage. Document decision criteria for proceed/rollback. |
| **Owner** | SMEPro Lead Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Canary_Rollout_Test_Report.md` — metrics at each stage, decision log, rollback criteria. |
| **Acceptance Criteria** | 1. 25% canary runs for 15 minutes with no error rate increase. 2. 50% canary runs for 15 minutes with p95 latency < 200 ms. 3. 75% canary runs for 15 minutes with no 5xx errors. 4. 100% rollout completes. 5. Error budget is not exceeded. 6. Rollback decision criteria are documented. 7. Metrics are captured in Grafana. |
| **Dependencies** | Days 64–66 Cloud Deploy validation |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — production canary is real traffic. Mitigate: use non-critical time window, SMEPro on-call. |

### Day 70–72: DR Rehearsal (Failover Test, Restore Test)

| Field | Value |
|-------|-------|
| **Date** | Days 70–72 |
| **Phase** | Production Prep |
| **Task** | Run DR rehearsal: simulate region failure, fail over to standby region (if multi-region) or restore from backup to new instance. Test application recovery. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/DR_Rehearsal_Report.md` — scenario, timeline, issues, action items. |
| **Acceptance Criteria** | 1. DR scenario is documented. 2. RTO is measured and meets target (≤ 1 hour). 3. RPO is measured and meets target (≤ 15 minutes). 4. Data integrity is verified post-restore. 5. Application is accessible after recovery. 6. Any gaps are ticketed. |
| **Dependencies** | Days 67–69 canary testing |
| **Estimated Effort** | 3 days |
| **Risk** | High — DR rehearsal can cause real outage. Mitigate: rehearse in staging first, then production with minimal traffic. |

### Day 73–75: Final Compliance Review (FERPA, Pseudonymization, Approval Gates, Audit)

| Field | Value |
|-------|-------|
| **Date** | Days 73–75 |
| **Phase** | Production Prep |
| **Task** | Final compliance review before go-live. Verify all FERPA controls. Verify approval gates are enforced. Verify audit evidence is complete. |
| **Owner** | Lamar Product/Compliance + SMEPro Lead Engineer |
| **Artifact** | `ios-plus/docs/Final_Compliance_Review.md` — checklist, evidence, sign-offs. |
| **Acceptance Criteria** | 1. All FERPA controls are implemented and tested. 2. PII is not in logs or metrics. 3. Approval gates require 2-person rule for production changes. 4. Audit trail is immutable (WORM). 5. Evidence package is complete for external auditor. 6. Compliance lead signs off. |
| **Dependencies** | Days 70–72 DR rehearsal |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — compliance findings may block go-live. Mitigate: buffer on Days 73–75. |

---

## Days 76–90: Handoff & Go-Live

### Day 76–78: Production Go-Live Checklist (All Wave 1 Items Verified)

| Field | Value |
|-------|-------|
| **Date** | Days 76–78 |
| **Phase** | Handoff |
| **Task** | Final verification of all Wave 1 items. Run complete regression test suite. Verify all docs are complete. Verify all credentials are transferred. |
| **Owner** | SMEPro Lead Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Go_Live_Checklist.md` — signed off by both leads. |
| **Acceptance Criteria** | 1. All Wave 1 readiness scores ≥ 7. 2. All CI checks green. 3. All security scans green. 4. All runbooks are reviewed and tested. 5. All credentials are in Lamar's control. 6. All docs are in repo. 7. Lamar engineer can deploy without SMEPro help. 8. Go/No-Go meeting held and decision recorded. |
| **Dependencies** | Days 73–75 compliance review |
| **Estimated Effort** | 3 days |
| **Risk** | Low — verification. |

### Day 79–81: Cutover Rehearsal (Staging → Production Traffic Shift)

| Field | Value |
|-------|-------|
| **Date** | Days 79–81 |
| **Phase** | Handoff |
| **Task** | Rehearse the cutover: shift traffic from staging to production. DNS switch. Verify no downtime. Document the exact cutover procedure. |
| **Owner** | SMEPro DevOps Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Cutover_Rehearsal_Report.md` — exact commands, timing, rollback plan. |
| **Acceptance Criteria** | 1. DNS TTL is lowered before cutover. 2. Traffic shift completes with < 5 minutes of downtime. 3. Rollback procedure is tested and completes in < 10 minutes. 4. Monitoring shows traffic in production. 5. No errors in logs during cutover. |
| **Dependencies** | Days 76–78 go-live checklist |
| **Estimated Effort** | 3 days |
| **Risk** | Medium — DNS cutover can be sticky. Mitigate: use low TTL, test with internal users first. |

### Day 82–84: Formal Handoff Package (All Docs, Evidence, SBOMs, Test Results)

| Field | Value |
|-------|-------|
| **Date** | Days 82–84 |
| **Phase** | Handoff |
| **Task** | Compile formal handoff package: all docs, test results, SBOMs, security scan results, compliance evidence, architecture diagrams, credential inventory, runbooks. |
| **Owner** | SMEPro Lead Engineer |
| **Artifact** | `ios-plus/docs/Handoff_Package/` (zip or GCS bucket) + `ios-plus/docs/Handoff_Package_Manifest.md`. |
| **Acceptance Criteria** | 1. Package contains all items from Transfer Readiness Checklist. 2. SBOMs are signed. 3. Test results are dated and signed. 4. Security scan results are dated and signed. 5. Compliance evidence is complete. 6. Lamar lead acknowledges receipt. |
| **Dependencies** | Days 79–81 cutover rehearsal |
| **Estimated Effort** | 3 days |
| **Risk** | Low — assembly. |

### Day 85–87: Production Launch (Canary Deployment with SMEPro On-Call Support)

| Field | Value |
|-------|-------|
| **Date** | Days 85–87 |
| **Phase** | Handoff |
| **Task** | Execute production launch. SMEPro is on-call for 48 hours. Monitor closely. Fix any issues immediately. |
| **Owner** | SMEPro Lead Engineer (primary) + Lamar Engineer (shadow) |
| **Artifact** | `ios-plus/docs/Production_Launch_Log.md` — deployment steps, issues, resolutions. |
| **Acceptance Criteria** | 1. Canary deployment starts at 25%. 2. Metrics are stable for 1 hour. 3. Scale to 50%, 75%, 100% with SMEPro approval at each stage. 4. No P0 bugs for 24 hours. 5. SMEPro on-call rotation is documented. 6. Escalation path is tested. |
| **Dependencies** | Days 82–84 handoff package |
| **Estimated Effort** | 3 days |
| **Risk** | High — production launch is high stakes. Mitigate: launch during low-traffic window, SMEPro on-site/available. |

### Day 88–90: Post-Launch Monitoring, Bug Fixes, Knowledge Transfer Sessions

| Field | Value |
|-------|-------|
| **Date** | Days 88–90 |
| **Phase** | Handoff |
| **Task** | Final knowledge transfer sessions. Fix any remaining bugs. Document lessons learned. Formal sign-off. |
| **Owner** | SMEPro Lead Engineer + Lamar Engineer |
| **Artifact** | `ios-plus/docs/Knowledge_Transfer_Session_Notes.md`, `ios-plus/docs/Lessons_Learned.md`, `ios-plus/docs/Final_Sign_Off.md` — signed by both leads. |
| **Acceptance Criteria** | 1. 3+ knowledge transfer sessions held (architecture, operations, troubleshooting). 2. All P0/P1 bugs from launch are fixed. 3. Lamar engineer is confident to operate independently. 4. Lessons learned are documented. 5. Both parties sign off on handoff. 6. SMEPro support agreement is documented (if any post-handoff support). |
| **Dependencies** | Days 85–87 production launch |
| **Estimated Effort** | 3 days |
| **Risk** | Low — final buffer. |

---

## Appendix A: Detailed Artifact Index

| Artifact Path | Produced By | Reviewed By | Purpose |
|---------------|-------------|-------------|---------|
| `ios-plus/docs/Repo_Inventory_Audit.md` | Day 1 | Both leads | Source of truth for gaps |
| `ios-plus/docs/Wave_1_Scope_Decision.md` | Day 2 | Both leads | Scope boundary |
| `ios-plus/docs/Missing_Artifacts_Checklist.md` | Day 3 | SMEPro Lead | Tracking |
| `ios-plus/docs/Runtime_Decision_Record.md` | Day 4 | Both leads | Architecture decision |
| `ios-plus/docs/Transfer_Readiness_Checklist.md` | Day 5 | Both leads | Handoff criteria |
| `ios-plus/docs/Repo_Structure_Changelog.md` | Days 6–7 | SMEPro Lead | Restructure record |
| `ios-plus/docs/Secret_Rotation_Runbook.md` | Days 8–9 | SMEPro DevOps | Operational |
| `services/*/Dockerfile` | Days 10–11 | SMEDevOps | Container images |
| `infra/helm/*/Chart.yaml` | Days 12–13 | SMEDevOps | K8s deployments |
| `ios-plus/docs/CI_CD_Transfer_Guide.md` | Days 14–15 | Lamar Engineer | CI/CD ownership |
| `ios-plus/docs/Dev_Environment_Provisioned.md` | Days 16–17 | Both leads | Infrastructure evidence |
| `ios-plus/docs/Vertical_Slice_Test_Report.md` | Days 18–20 | Both leads | Integration proof |
| `ios-plus/docs/Observability_Runbook.md` | Days 21–22 | Lamar Engineer | Operations |
| `ios-plus/docs/Backup_Restore_Test_Report.md` | Days 23–24 | Both leads | DR evidence |
| `ios-plus/docs/Security_Scan_Results.md` | Days 25–27 | Both leads | Security evidence |
| `ios-plus/docs/Load_Test_Report.md` | Days 28–30 | Both leads | Performance evidence |
| `ios-plus/docs/Failure_Drill_Report.md` | Days 28–30 | Both leads | Reliability evidence |
| `ios-plus/docs/Auth_Hardening_Report.md` | Days 31–33 | Both leads | Security evidence |
| `ios-plus/docs/SBOM_Inventory.md` | Days 34–36 | Both leads | Supply chain evidence |
| `ios-plus/docs/Chaos_Engineering_Report.md` | Days 37–39 | Both leads | Reliability evidence |
| `ios-plus/docs/Final_Load_Test_Report.md` | Days 37–39 | Both leads | Performance evidence |
| `ios-plus/docs/runbooks/*.md` | Days 40–42 | Lamar Engineer | Operations |
| `ios-plus/docs/Handoff_Package_Index.md` | Days 40–42 | Both leads | Handoff tracking |
| `ios-plus/docs/Internal_Review_Report.md` | Days 43–45 | SMEPro Lead | Quality gate |
| `ios-plus/docs/Lamar_Staging_Deployment_Log.md` | Days 46–48 | Lamar Lead | Ownership proof |
| `ios-plus/docs/GitHub_Transfer_Test_Report.md` | Days 49–51 | Both leads | Transfer evidence |
| `ios-plus/docs/Self_Hosted_Runner_Guide.md` | Days 52–54 | Lamar Engineer | Operations |
| `ios-plus/docs/Joint_Ops_Exercise_Report.md` | Days 55–57 | Both leads | Operational readiness |
| `ios-plus/docs/Security_Validation_Report.md` | Days 58–60 | Lamar Compliance | Security evidence |
| `ios-plus/docs/FERPA_Controls_Evidence.md` | Days 58–60 | Lamar Compliance | Compliance evidence |
| `ios-plus/docs/Prod_Environment_Provisioned.md` | Days 61–63 | Both leads | Infrastructure evidence |
| `ios-plus/docs/Cloud_Deploy_Validation_Report.md` | Days 64–66 | Both leads | Pipeline evidence |
| `ios-plus/docs/Canary_Rollout_Test_Report.md` | Days 67–69 | Both leads | Deployment evidence |
| `ios-plus/docs/DR_Rehearsal_Report.md` | Days 70–72 | Both leads | DR evidence |
| `ios-plus/docs/Final_Compliance_Review.md` | Days 73–75 | Lamar Compliance | Go/No-Go evidence |
| `ios-plus/docs/Go_Live_Checklist.md` | Days 76–78 | Both leads | Go/No-Go gate |
| `ios-plus/docs/Cutover_Rehearsal_Report.md` | Days 79–81 | Both leads | Operational evidence |
| `ios-plus/docs/Handoff_Package/` | Days 82–84 | Lamar Lead | Complete delivery |
| `ios-plus/docs/Production_Launch_Log.md` | Days 85–87 | Both leads | Launch evidence |
| `ios-plus/docs/Knowledge_Transfer_Session_Notes.md` | Days 88–90 | Lamar Engineer | Training record |
| `ios-plus/docs/Lessons_Learned.md` | Days 88–90 | Both leads | Process improvement |
| `ios-plus/docs/Final_Sign_Off.md` | Days 88–90 | Both leads | Legal handoff |

---

## Appendix B: Contingency Triggers

| If This Happens | Then Do This | Owner | Decision By |
|-----------------|-------------|-------|-------------|
| Days 1–15 slip by > 3 days | Cut Wave 3 entirely. Defer frontend, connectors, ML to post-Day-90. | Chris Miguez | Day 18 |
| Test writing takes > 5 days | Switch to integration-test-first strategy. Skip unit tests for internal functions. | SMEPro Lead | Day 15 |
| Vertical slice (Days 18–20) fails | Add SMEPro Backend Engineer full-time. Extend Days 18–20 to Days 18–23. | SMEPro Lead | Day 20 |
| Security scan finds > 5 CRITICAL issues | Pause feature work. Fix all CRITICAL before proceeding. | SMEPro DevOps | Day 25 |
| Lamar engineer cannot deploy independently by Day 60 | Extend joint ops to Day 65. Add daily pairing sessions. | SMEPro Lead | Day 60 |
| Production canary fails | Rollback immediately. Fix issues in staging. Retry canary in 48 hours. | SMEPro Lead | Day 67 |
| DR rehearsal fails | Do not go live. Fix DR gaps. Extend production prep by 5 days. | Chris Miguez | Day 72 |
| Compliance review finds gaps | Fix gaps in Days 73–75 buffer. If > 3 days of fixes needed, delay go-live. | Lamar Compliance | Day 75 |
| Production launch has P0 bug | Rollback. Fix in staging. Relaunch in 24–48 hours. | SMEPro Lead | Day 85 |

---

## Appendix C: Key Metrics Dashboard (Track Weekly)

| Metric | Target | Week 1 | Week 2 | Week 3 | Week 4 | Week 6 | Week 8 | Week 10 | Week 12 |
|--------|--------|--------|--------|--------|--------|--------|--------|---------|---------|
| Test Coverage | ≥ 80% | | | | | | | | |
| Security Scan Findings (CRITICAL) | 0 | | | | | | | | |
| Security Scan Findings (HIGH) | ≤ 2 | | | | | | | | |
| Deployment Success Rate | 100% | | | | | | | | |
| Mean Time to Recovery (MTTR) | ≤ 30 min | | | | | | | | |
| p95 Latency | ≤ 200 ms | | | | | | | | |
| Error Rate | ≤ 0.1% | | | | | | | | |
| Readiness Score (Wave 1 avg) | ≥ 7.5 | | | | | | | | |
| Lamar Independent Deployments | ≥ 1 | | | | | | | | |
| Docs Completeness | 100% | | | | | | | | |

---

*This plan is a living document. Update it weekly during standups. Any change to scope, timeline, or owner must be recorded in `ios-plus/docs/90_Day_Execution_Plan_Changelog.md`.*
