# IOS+ v2 Architecture — Implementation Spec

## Document Purpose

This document maps the implementation-grade v2 architecture directly to the `ios-plus/` repository structure. It serves as the authoritative bridge between architecture diagrams and production code, enabling engineers to locate the implementation of every architectural component.

## v2 Architecture Overview

The v2 architecture introduces three critical clarifications:

1. **Three connector classes** (not one): Campus Systems, Public Regulatory Sources, Governed AI Services
2. **Two-layer on-prem engine** (not one conceptual box): Execution/Runtime Layer + Governance Layer above Trust Layer
3. **Outcome-aligned product layer** (not just EDU Reporter): UC-01 through UC-08 mapped to buyer-visible capabilities

## Architecture-to-Repository Mapping

### Layer 1: Campus Systems (Connector Class A)

| Source | Integration Point | Repo Location | Status |
|--------|------------------|---------------|--------|
| **Banner / Ethos** | Ellucian REST API, SSO token exchange | `packages/middleware-engine/src/connectors/banner.ts` (to create) | Planned |
| **Blackboard** | Blackboard REST API (Learn) | `packages/middleware-engine/src/connectors/blackboard.ts` (to create) | Planned |
| **Concourse** | Concourse API for syllabus-of-record | `packages/middleware-engine/src/connectors/concourse.ts` (to create) | Planned |
| **Generic SSO** | SAML 2.0 / OIDC identity federation | `packages/middleware-engine/src/layers/auth.ts` | ✅ Built |

**Implementation notes:**
- All campus system connectors are **read-only** from the IOS+ perspective
- No write-back to source systems; all mutations flow through the canonical layer
- PII is pseudonymized at the connector boundary before entering the engine
- Sync cadences: Banner every 15 min (business hours), hourly overnight; Blackboard hourly incremental, nightly full

**Key files:**
- `packages/middleware-engine/src/layers/auth.ts` — SSO authentication, role extraction
- `packages/shared/src/utils/validation.ts` — Input validation for connector payloads
- `packages/cos-plus/src/connection.ts` — Database pool for persisting connector output
- `scripts/db/migrations/001_initial_schema.sql` — Schema for canonical student records

---

### Layer 2: Public Regulatory Sources (Connector Class B)

| Source | Integration Point | Repo Location | Status |
|--------|------------------|---------------|--------|
| **IPEDS** | NCES API / data files | `packages/middleware-engine/src/connectors/regulatory/ipeds.ts` (to create) | Planned |
| **CBM** | State HE coordinating board | `packages/middleware-engine/src/connectors/regulatory/cbm.ts` (to create) | Planned |
| **Clery** | Dept. of Ed guidance feeds | `packages/middleware-engine/src/connectors/regulatory/clery.ts` (to create) | Planned |
| **SACSCOC** | Standards PDF / XML | `packages/middleware-engine/src/connectors/regulatory/sacscoc.ts` (to create) | Planned |
| **ABET** | Criteria documents | `packages/middleware-engine/src/connectors/regulatory/abet.ts` (to create) | Planned |
| **AACSB** | Standards documents | `packages/middleware-engine/src/connectors/regulatory/aacsb.ts` (to create) | Planned |
| **State Licensure Boards** | NCSBN, FSBPT, state APIs | `packages/uco-resolver/src/database.ts` | ✅ Built |
| **Census Bureau** | NAICS API | `packages/uco-resolver/src/config.ts` | ✅ Built |

**Implementation notes:**
- These are **standards and rules**, not student data
- They feed the **Universal Decoding Matrix** (standards → evidence mapping) and **Regulatory Watchtower** (UC-08)
- Firecrawl MCP (Layer 3) will eventually automate web monitoring of these sources
- 414 existing SACSCOC files already indexed as core evidence set

**Key files:**
- `packages/uco-resolver/src/resolver.ts` — UDM traversal logic
- `packages/uco-resolver/src/database.ts` — Database queries for UCO nodes, crosswalks, obligations
- `db/migrations/004_udm_views.sql` — `v_state_licensure_candidates`, `fn_lookup_state_licensure_by_cip(...)`
- `db/seeds/obligation_metadata.csv` — Seed data for state licensure requirements

---

### Layer 3: Governed AI Services (Connector Class C)

| Service | Integration Point | Repo Location | Status |
|---------|------------------|---------------|--------|
| **Microsoft Copilot** | Tenant API, usage logs | `packages/middleware-engine/src/connectors/ai/copilot.ts` (to create) | Planned |
| **Claude MCP** | Model Context Protocol | `packages/middleware-engine/src/connectors/ai/claude_mcp.ts` (to create) | Future |
| **Firecrawl MCP** | Web crawling API | `packages/middleware-engine/src/connectors/ai/firecrawl_mcp.ts` (to create) | Future |

**Implementation notes:**
- These are **orchestration boundaries**, not peer data systems
- Copilot does NOT directly access student data; it receives **cited UDM nodes** from the orchestration layer
- The architecture is **vendor-agnostic**: same pattern works for Claude, GPT, or any approved model
- All AI responses are logged in the evidence chain with trace IDs

**Key files:**
- `packages/middleware-engine/src/layers/retrieval.ts` — RAG Vault retrieval that feeds AI context
- `packages/rag-vault/src/rag-vault.ts` — UCO-partitioned retrieval with sector filtering
- `packages/evidence-fabric/src/evidence.ts` — Evidence logging for every AI query/response

---

### Approval Gate (Cross-Layer Control)

| Component | Function | Repo Location | Status |
|-----------|----------|---------------|--------|
| **Change Detection** | Detect regulatory or policy changes | `packages/middleware-engine/src/connectors/regulatory/` | Planned |
| **Proposed Update** | Generate diff + impact assessment | `packages/middleware-engine/src/layers/policy.ts` (enhance) | Planned |
| **Human Approval** | UI for compliance officer review | `packages/middleware-engine/src/server.ts` (admin routes) | ✅ Built |
| **Deployment** | Apply approved changes to rule layer | `scripts/db/migrate.js` + `packages/cos-plus/src/migrations.ts` | ✅ Built |

**Implementation notes:**
- Every change to the UDM, regulatory standards, or policy rules requires explicit human approval
- The approval workflow is itself auditable: who, when, why, before/after
- Admin mutation endpoints (`POST /admin/rules`, `PUT /admin/rules/:id`) require authenticated admin tokens
- Admin changes are logged in `audit_events` with `operation = 'ADMIN_MUTATION'`

**Key files:**
- `packages/middleware-engine/src/layers/audit.ts` — `recordAdminMutation(actor, action, before, after)`
- `packages/middleware-engine/src/server.ts` — Admin routes with `requireAdmin` middleware
- `packages/gate-530/src/engine.ts` — `addRule()`, `removeRule()`, `getPolicyMetadata()`

---

### On-Prem Engine — Row 1: Execution / Runtime Layer

| Component | Architecture Role | Repo Location | Status |
|-----------|----------------|---------------|--------|
| **Connector Ingestion Workers** | Pull/sync from all 3 connector classes | `packages/middleware-engine/src/connectors/` (to create) | Planned |
| **Normalization Pipelines** | ETL, schema mapping, deduplication | `packages/cos-plus/src/connection.ts` + `packages/shared/src/utils/validation.ts` | ✅ Built |
| **Rules / Workflow Engine** | Gate 530 policy evaluation, approval queues | `packages/gate-530/src/engine.ts` + `packages/gate-530/src/rules.ts` | ✅ Built |
| **Scoring & Analytics Jobs** | Risk scoring, drift detection, load indexing | `packages/middleware-engine/src/layers/` (evaluation, evidence, retrieval) | ✅ Built |
| **API / Web Services** | REST, GraphQL, webhooks, EDU Reporter UI | `packages/middleware-engine/src/server.ts` | ✅ Built |

**Implementation details:**

**Connector Ingestion Workers (to create):**
```
packages/middleware-engine/src/connectors/
├── index.ts                    # Connector registry
├── banner.ts                   # Banner/Ethos integration
├── blackboard.ts               # Blackboard Learn integration
├── concourse.ts                # Concourse syllabus integration
├── regulatory/
│   ├── ipeds.ts
│   ├── cbm.ts
│   ├── clery.ts
│   ├── sacscoc.ts
│   ├── abet.ts
│   ├── aacsb.ts
│   └── index.ts
└── ai/
    ├── copilot.ts
    ├── claude_mcp.ts
    ├── firecrawl_mcp.ts
    └── index.ts
```

**Rules / Workflow Engine (built):**
- `packages/gate-530/src/engine.ts` — `Gate530Engine` class
  - `evaluate(context)` — main evaluation method
  - `classifyRequest(context)` — semantic classification
  - `synthesizeDecision(results)` — multi-rule synthesis
  - `failClosed` — error = DENY
- `packages/gate-530/src/rules.ts` — `RuleEngine` class
  - 9 condition operators: eq, ne, gt, lt, gte, lte, in, contains, regex, exists
  - Sector matching, priority sorting, override resolution
- `packages/gate-530/src/transport.ts` — HTTP/2 and IPC transport
- `packages/gate-530/src/diagnostics.ts` — Dependency-aware readiness checks

**API / Web Services (built):**
- `packages/middleware-engine/src/server.ts` — Pure Node.js `http` server (no Express)
  - `POST /v1/evaluate` — compliance evaluation
  - `POST /v1/inference` — full inference pipeline
  - `GET /v1/evidence/:requestId` — evidence retrieval
  - `POST /v1/retrieve` — RAG retrieval
  - `GET /v1/compliance/licensure/state-lookup` — UDM licensure lookup
  - `GET /health` — liveness
  - `GET /ready` — readiness (dependency diagnostics)
  - `GET /metrics` — Prometheus metrics
  - `POST /admin/rules` — create rule (admin auth)
  - `DELETE /admin/rules/:id` — delete rule (admin auth)
  - `PUT /admin/rules/:id` — update rule (admin auth)
  - `GET /admin/audit` — admin audit trail (admin auth)

---

### On-Prem Engine — Governance Layer

| Component | Architecture Role | Repo Location | Status |
|-----------|----------------|---------------|--------|
| **RBAC** | Role-lens governance (advisor, faculty, registrar, compliance) | `packages/middleware-engine/src/layers/auth.ts` | ✅ Built |
| **Pseudonymization** | SYN IDs, field-level hashing, salt management | `packages/shared/src/utils/validation.ts` + `packages/cos-plus/src/` | ✅ Built |
| **Audit** | WORM PostgreSQL, SHA-256 evidence, trace IDs | `packages/cos-plus/src/worm.ts` + `packages/evidence-fabric/src/` | ✅ Built |
| **De-Pseudonymization Control** | Controlled re-identification with approval | `packages/middleware-engine/src/layers/auth.ts` (enhance) | Planned |
| **Policy Enforcement** | Gate 530 rules, sector-aware, fail-closed | `packages/gate-530/src/engine.ts` + `packages/gate-530/src/sector.ts` | ✅ Built |

**Role-Lens Governance (RBAC):**

The same data looks different depending on the role:

| Role | Lens | What They See | Repo File |
|------|------|---------------|-----------|
| **Advisor** | Section-level | Risk scores, intervention queue for assigned students | `packages/middleware-engine/src/layers/retrieval.ts` |
| **Faculty** | Aggregate | Course-level outcomes, assessment alignment, grading load — NO individual PII | `packages/middleware-engine/src/layers/retrieval.ts` |
| **Registrar** | Authoritative | Full student records with controlled de-pseudonymization for transcript decisions | `packages/middleware-engine/src/layers/auth.ts` |
| **Compliance Officer** | Audit-only | Audit trail, evidence chain, policy coverage — NO student data | `packages/middleware-engine/src/layers/audit.ts` |
| **Admin** | Mutation | Rule CRUD, system configuration, admin audit | `packages/middleware-engine/src/server.ts` |

This is **product behavior**, not just security. The system adapts its output to the viewer's role.

**Pseudonymization (built):**
- `packages/shared/src/utils/validation.ts` — Input validation, hashing utilities
- `packages/cos-plus/src/audit.ts` — Audit event logging with pseudonymized actor IDs
- SYN ID generation: SHA-256 of (student_id + campus_salt) → first 16 bytes → UUID v5

**Audit (built):**
- `packages/cos-plus/src/worm.ts` — `WormEnforcer` class
  - `protect(tableName)` — creates triggers that block UPDATE/DELETE
  - `verify()` — checks all audit tables have WORM triggers
- `packages/cos-plus/src/audit.ts` — `insertAuditEvent()`, `getAuditTrail()`, `verifyWormIntegrity()`
- `packages/evidence-fabric/src/signer.ts` — Ed25519 local signing
- `packages/evidence-fabric/src/vault-transit.ts` — Vault Transit signing
- `packages/evidence-fabric/src/jcs.ts` — RFC 8785 JCS canonicalization
- `db/migrations/002_worm_triggers.sql` — WORM trigger definitions

**De-Pseudonymization Control (planned):**
- Approval required for every re-identification request
- Time-limited access (expires after session)
- No persistent storage of re-identified data
- All de-pseudonymization events logged in evidence chain

---

### On-Prem Engine — Row 2: Trust Layer

| Component | Architecture Role | Repo Location | Status |
|-----------|----------------|---------------|--------|
| **Canonical Layer** | One student, one record, pseudonymized, SYN-consistent | `packages/cos-plus/src/` (connection, evidence-store, vector-store) | ✅ Built |
| **Universal Decoding Matrix** | CIP → SOC → NAICS → License, cited node + policy action | `packages/uco-resolver/src/` | ✅ Built |
| **Evidence Chain** | Ed25519 · JCS · SHA-256 · trace ID, lineage + audit | `packages/evidence-fabric/src/` | ✅ Built |

**Canonical Layer (built):**
- `packages/cos-plus/src/connection.ts` — PostgreSQL pool with SSL, retry, health check
- `packages/cos-plus/src/evidence-store.ts` — `storeEvidenceRecord()`, `verifyEvidenceChain()`
- `packages/cos-plus/src/vector-store.ts` — pgvector similarity search for RAG
- `db/migrations/001_initial_schema.sql` — Core tables: `audit_events`, `evidence_records`, `compliance_rules`, `rag_documents`, `uco_nodes`

**Universal Decoding Matrix (built):**
- `packages/uco-resolver/src/resolver.ts` — `UcoResolver` class
  - `lookupLicensure(input)` — main lookup method
  - `resolveCipToNaics()`, `resolveCipToSoc()`, `resolveSocToNaics()` — traversal methods
- `packages/uco-resolver/src/traversal.ts` — `TraversalEngine` class
  - Ranking: direct match first, then confidence, then risk
- `packages/uco-resolver/src/database.ts` — `UcoDatabaseQueries` class
  - Queries `v_state_licensure_candidates`, calls `fn_lookup_state_licensure_by_cip(...)`
- `packages/uco-resolver/src/crosswalk.ts` — `CrosswalkLoader` for SOC/NAICS/CIP mappings
- `db/migrations/004_udm_views.sql` — UDM views and functions

**Evidence Chain (built):**
- `packages/evidence-fabric/src/signer.ts` — `LocalSigner` (Ed25519)
- `packages/evidence-fabric/src/vault-transit.ts` — `VaultTransitSigner` (HashiCorp Vault)
- `packages/evidence-fabric/src/jcs.ts` — `JcsCanonicalizer` (RFC 8785)
- `packages/evidence-fabric/src/evidence.ts` — `EvidenceBuilder` fluent API
- `packages/evidence-fabric/src/triple-publication.ts` — `TriplePublicationVerifier` (N-of-M threshold)
- `packages/evidence-fabric/src/factory.ts` — `createSigner()`, `createEvidenceBuilder()`

**Trace Chain Across Outputs:**
The evidence chain connects to every downstream output:
- Model factors → evidence (why was this student flagged?)
- Transcript decisions → evidence (why was this course accepted?)
- Accreditation narratives → evidence (what evidence supports this claim?)
- Regulatory updates → evidence (who approved this change?)

Every output carries a `trace_id` that can be resolved to the full evidence record in COS+.

---

### Outcome Applications Layer

| Use Case | Buyer-Visible Outcome | Repo Files | Status |
|----------|----------------------|------------|--------|
| **UC-01** Predictive Persistence Markers | Early warning, advisor intervention queue | `packages/middleware-engine/src/layers/evaluation.ts` + scoring jobs | ✅ Core built |
| **UC-02** Transcript Evaluation Crosswalk | 2 weeks → 2 days, confidence bands, one-click approval | `packages/middleware-engine/src/layers/` + connector workers | Planned |
| **UC-03** Accreditation Gap Analysis | Heat map, continuous readiness, 414 files indexed | `packages/uco-resolver/src/` + regulatory connectors | Partially built |
| **UC-04** Course Outcome Alignment Auditor | CLO ↔ assessment drift detection | `packages/middleware-engine/src/layers/retrieval.ts` + scoring jobs | Planned |
| **UC-05** Grading Load Index | Quantitative workload per course | `packages/middleware-engine/src/layers/` + scoring jobs | Planned |
| **UC-06** Allied Health Dashboard | NCLEX threshold protection, 10 programs | `packages/uco-resolver/src/` + `packages/middleware-engine/src/layers/` | Planned |
| **UC-08** Regulatory Watchtower | Change detection with approval gate | `packages/middleware-engine/src/connectors/regulatory/` + Firecrawl | Planned |
| **EDU Reporter** | Reporting surface for all UCs | `packages/middleware-engine/src/server.ts` (API) + UI | Planned |

---

## Directory Structure (v2-mapped)

```
ios-plus/
├── packages/
│   ├── shared/                          # Types, constants, utils, errors, logger
│   │   └── src/
│   │       ├── types/                   # Compliance, evidence, audit, retrieval, UDM, transport
│   │       ├── constants.ts
│   │       └── utils/
│   │           ├── validation.ts        # Pseudonymization, hashing, SYN IDs
│   │           ├── errors.ts            # Custom error classes
│   │           └── logger.ts            # Structured JSON logger
│   │
│   ├── middleware-engine/               # 7-layer orchestration, HTTP server, connectors
│   │   └── src/
│   │       ├── index.ts
│   │       ├── orchestrator.ts          # Main 7-layer pipeline
│   │       ├── server.ts                # HTTP server, all routes
│   │       ├── connectors/              # NEW: All 3 connector classes
│   │       │   ├── index.ts
│   │       │   ├── banner.ts            # Campus: Banner/Ethos
│   │       │   ├── blackboard.ts        # Campus: Blackboard
│   │       │   ├── concourse.ts         # Campus: Concourse
│   │       │   ├── regulatory/          # Public regulatory sources
│   │       │   │   ├── index.ts
│   │       │   │   ├── ipeds.ts
│   │       │   │   ├── cbm.ts
│   │       │   │   ├── clery.ts
│   │       │   │   ├── sacscoc.ts
│   │       │   │   ├── abet.ts
│   │       │   │   └── aacsb.ts
│   │       │   └── ai/                # Governed AI services
│   │       │       ├── index.ts
│   │       │       ├── copilot.ts
│   │       │       ├── claude_mcp.ts
│   │       │       └── firecrawl_mcp.ts
│   │       ├── layers/
│   │       │   ├── auth.ts              # RBAC, role-lens, SSO, de-pseudonymization
│   │       │   ├── classification.ts  # Intent detection, sector, sensitivity
│   │       │   ├── policy.ts            # Policy loading, sector filtering
│   │       │   ├── evaluation.ts        # Gate 530 delegation, batch eval
│   │       │   ├── evidence.ts          # Signed evidence creation
│   │       │   ├── retrieval.ts         # RAG Vault delegation, role-lens filtering
│   │       │   └── audit.ts             # Audit logging, admin mutation logging
│   │       └── config.ts
│   │
│   ├── gate-530/                        # Runtime compliance evaluation
│   │   └── src/
│   │       ├── engine.ts                # Gate530Engine, evaluate, classify, synthesize
│   │       ├── rules.ts                 # RuleEngine, 9 operators, sector logic
│   │       ├── transport.ts             # HTTP/2 + IPC transport
│   │       ├── sector.ts                # SectorRegistry, 6 sectors
│   │       ├── diagnostics.ts           # Readiness checks
│   │       └── config.ts
│   │
│   ├── evidence-fabric/                 # Cryptographic audit evidence
│   │   └── src/
│   │       ├── signer.ts                # LocalSigner (Ed25519)
│   │       ├── vault-transit.ts         # VaultTransitSigner
│   │       ├── jcs.ts                   # JCS canonicalization (RFC 8785)
│   │       ├── evidence.ts              # EvidenceBuilder fluent API
│   │       ├── triple-publication.ts    # N-of-M threshold verification
│   │       ├── factory.ts               # createSigner(), createEvidenceBuilder()
│   │       └── types.ts
│   │
│   ├── cos-plus/                        # PostgreSQL WORM persistence
│   │   └── src/
│   │       ├── connection.ts            # Pool manager, SSL, retry
│   │       ├── audit.ts                 # Append-only audit events
│   │       ├── worm.ts                  # WORM trigger enforcement
│   │       ├── evidence-store.ts        # Evidence record persistence
│   │       ├── vector-store.ts          # pgvector similarity search
│   │       ├── migrations.ts            # Migration runner
│   │       ├── grants.ts                # RBAC role application
│   │       └── invariant.ts             # Schema invariant verification
│   │
│   ├── rag-vault/                       # UCO-partitioned retrieval
│   │   └── src/
│   │       ├── rag-vault.ts             # Main retrieval with sector filtering
│   │       ├── partition.ts             # UcoPartitionManager, 6 default partitions
│   │       ├── sector.ts                # SectorKnowledgeMap, SectorAwareFilter
│   │       ├── retrieval.ts             # VectorRetriever, hybrid search
│   │       ├── embedding.ts             # Mock + OpenAI embedding providers
│   │       └── config.ts
│   │
│   └── uco-resolver/                    # Licensure traversal engine
│       └── src/
│           ├── resolver.ts              # UcoResolver, main lookup
│           ├── traversal.ts             # TraversalEngine, ranking
│           ├── database.ts              # UcoDatabaseQueries
│           ├── crosswalk.ts             # CrosswalkLoader, index builder
│           └── config.ts
│
├── infra/                               # Kubernetes, Terraform, Vault, Monitoring
│   ├── helm/ios-plus/                   # Helm chart (12 templates)
│   ├── kubernetes/                      # Raw manifests
│   ├── monitoring/                      # Prometheus, Grafana, alerts
│   ├── terraform/                       # GKE + Vault infrastructure
│   └── vault/                           # Policy, K8s auth, PKI
│
├── db/                                  # PostgreSQL schema
│   ├── init/                            # Extension setup
│   ├── migrations/                      # 6 numbered migrations
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_worm_triggers.sql
│   │   ├── 003_indexes.sql
│   │   ├── 004_udm_views.sql
│   │   ├── 005_audit_retention.sql
│   │   └── 006_seed_data.sql
│   ├── grants/                          # RBAC roles
│   └── seeds/                           # JSON + CSV seed data
│
├── scripts/                             # Operations
│   ├── db/                              # migrate, verify-worm, seed, grant
│   └── ops/                             # deploy_orchestration.sh
│
├── .github/                             # CI/CD
│   ├── workflows/                       # CI, audit, release
│   └── ISSUE_TEMPLATE/                  # Bug, feature, security
│
├── docs/                                # Documentation
│   ├── COS_UDM_Review_Expansion_Report.md
│   ├── ios-plus-architecture.html       # v1 interactive diagram
│   └── ios-plus-architecture-v2.html    # v2 implementation-grade diagram
│
├── tests/                               # Test suites
│   └── moonshot/
│       └── README.md                    # Verification runbook
│
├── docker-compose.yml                   # Local dev stack
├── docker-compose.test.yml              # Clean-room audit
├── Dockerfile                           # Production image
├── Dockerfile.test                      # Audit image
├── package.json                         # Root monorepo manifest
└── tsconfig.json                        # Root TypeScript config
```

---

## Implementation Priority

### Phase 1 (Months 1–6): Core Engine + AI Governance
**Goal:** Gate 530 live, FERPA compliance enforced, all tools audited

| Task | Files | Effort |
|------|-------|--------|
| Banner/Ethos connector | `packages/middleware-engine/src/connectors/banner.ts` | 2 weeks |
| Blackboard connector | `packages/middleware-engine/src/connectors/blackboard.ts` | 2 weeks |
| Concourse connector | `packages/middleware-engine/src/connectors/concourse.ts` | 1 week |
| SSO integration | `packages/middleware-engine/src/layers/auth.ts` | 1 week |
| Role-lens governance | `packages/middleware-engine/src/layers/auth.ts` + RBAC | 2 weeks |
| Pseudonymization pipeline | `packages/shared/src/utils/validation.ts` + `packages/cos-plus/src/` | 1 week |
| WORM verification | `packages/cos-plus/src/worm.ts` + `scripts/db/verify-worm.js` | 1 week |
| Evidence chain end-to-end | `packages/evidence-fabric/src/` + `packages/cos-plus/src/evidence-store.ts` | 2 weeks |
| Admin mutation audit | `packages/middleware-engine/src/layers/audit.ts` + admin routes | 1 week |
| Health/ready/metrics | `packages/middleware-engine/src/server.ts` + `packages/gate-530/src/diagnostics.ts` | 1 week |

**Phase 1 budget:** $265,000

### Phase 2 (Months 7–9): Predictive Persistence
**Goal:** First advisor intervention queue live

| Task | Files | Effort |
|------|-------|--------|
| Risk scoring engine | Scoring jobs + `packages/middleware-engine/src/layers/evaluation.ts` | 3 weeks |
| Advisor queue dashboard | `packages/middleware-engine/src/server.ts` + UI | 2 weeks |
| Banner + Blackboard signal integration | Connector workers + scoring pipeline | 2 weeks |

**Phase 2 budget:** $80,000

### Phase 3 (Months 10–12): Transcript Evaluation
**Goal:** 2-day transcript turnaround

| Task | Files | Effort |
|------|-------|--------|
| Catalog matching engine | `packages/uco-resolver/src/` + scoring jobs | 3 weeks |
| Confidence bands + approval workflow | `packages/middleware-engine/src/layers/` + UI | 2 weeks |
| Document storage (transcript scans) | `packages/cos-plus/src/vector-store.ts` + storage | 1 week |

**Phase 3 budget:** $60,000

### Phase 4 (Months 13–15): Accreditation + Outcome Alignment
**Goal:** Continuous SACSCOC readiness

| Task | Files | Effort |
|------|-------|--------|
| SACSCOC standards mapping | `packages/middleware-engine/src/connectors/regulatory/sacscoc.ts` | 2 weeks |
| Readiness Heat Map | `packages/middleware-engine/src/server.ts` + UI | 2 weeks |
| CLO ↔ assessment drift detection | `packages/middleware-engine/src/layers/retrieval.ts` + scoring | 2 weeks |
| Document indexing (414 files) | `packages/cos-plus/src/vector-store.ts` + batch jobs | 1 week |

**Phase 4 budget:** $50,000

### Phase 5 (Months 16–18): Grading Load + Allied Health
**Goal:** Programmatic compliance tracking

| Task | Files | Effort |
|------|-------|--------|
| Grading Load Index | Scoring jobs + `packages/middleware-engine/src/layers/` | 2 weeks |
| Allied health dashboard | `packages/uco-resolver/src/` + `packages/middleware-engine/src/layers/` | 2 weeks |
| Regulatory Watchtower (UC-08) | `packages/middleware-engine/src/connectors/regulatory/` + Firecrawl | 2 weeks |

**Phase 5 budget:** $40,000

---

## Key Architectural Decisions (v2)

| Decision | Rationale | Impact |
|----------|-----------|--------|
| **Three connector classes** | Campus systems, regulatory sources, and AI services have different trust boundaries, sync cadences, and failure modes | Prevents architecture collapse when one connector class changes |
| **Execution layer separate from trust layer** | Operational concerns (connectors, APIs, scoring) are separable from durable concerns (canonical, UDM, evidence) | Enables independent scaling, testing, and replacement of execution components |
| **Role-lens governance** | The same data must look different to different roles; this is product behavior, not just security | Drives UX design, API design, and RBAC implementation |
| **Approval gate as explicit component** | Every regulatory change, policy change, and de-pseudonymization requires human approval | Major trust differentiator; prevents autonomous system drift |
| **Trace chain across all outputs** | Evidence must be operational, not just archival | Enables one-click audit defense for any reported number |
| **Vendor-agnostic AI layer** | Copilot is one of many possible governed AI services | Future-proofs against model vendor changes, price changes, or capability changes |
| **Fail-closed by default** | Any error, timeout, or missing credential returns DENY | Eliminates the "leaky default" problem common in permission systems |

---

## Verification

This spec is verified against:
- `ios-plus/packages/` — all 7 packages exist and are production-ready
- `ios-plus/db/migrations/` — 6 migrations exist with WORM, UDM, and seed data
- `ios-plus/infra/` — Helm, K8s, Terraform, Vault, and monitoring assets exist
- `ios-plus/scripts/` — Deployment orchestration and database scripts exist
- `ios-plus/tests/moonshot/README.md` — Verification runbook exists

To validate any claim in this document, trace the component name to its repository file path.

---

*Document version: v2.0*
*Last updated: 2026-01-21*
*Author: SMEPro Technologies Engineering*
