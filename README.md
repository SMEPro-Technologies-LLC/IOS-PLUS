# IOS+ Middleware Engine & COS+ Database

### Compliance-native enforcement and evidence infrastructure for enterprise AI systems

IOS+ helps regulated organizations enforce compliance controls at runtime, generate signed audit evidence for AI actions, and persist traceable records in a compliance-first data layer.

Built for enterprise AI workflows that require:

- real-time policy enforcement,
- immutable auditability,
- sector-aware retrieval,
- and deployment-oriented operational controls.

---

## Current Repository Status

The repository now contains a materially hardened implementation of the IOS+ platform, including:

- authenticated administrative control-plane routes,
- fail-closed semantic classification and synthesis behavior,
- dependency-aware readiness diagnostics,
- HTTP/2 and IPC support for Gate 530 transport,
- Vault-oriented secret ingestion and bootstrap assets,
- database migration and invariant verification tooling,
- Prometheus-compatible metrics and alert-rule scaffolding,
- release orchestration and rollback automation,
- and recent successful CI runs on `main`.

IOS+ should currently be understood as a **working integration candidate undergoing operational hardening**. The repository is substantially beyond proof-of-concept status, but final production readiness still depends on target-environment validation, cloud service provisioning, and end-to-end operational activation.

---

## Why IOS+

Most AI platforms generate outputs.  
Few can prove, in a durable and audit-ready way, **why a decision was allowed, what controls were applied, and what evidence was recorded**.

IOS+ is designed to solve that gap.

With IOS+, teams can:

- evaluate AI requests against compliance rules before execution,
- create signed evidence records for inference events,
- store append-only audit data with compliance-first indexing,
- and support regulated retrieval and operational review workflows.

---

## Core Components

### Gate 530

Runtime compliance evaluation for AI and agent workflows.

- Evaluates requests against mapped compliance dimensions
- Applies sector-aware decision logic
- Produces structured allow/deny/escalate outcomes
- Supports colocated IPC and HTTP/2 transport modes
- Records policy evaluation metadata for downstream audit

### Evidence Fabric

Cryptographic audit evidence for AI activity.

- Ed25519-signed evidence records
- JCS-canonicalized payloads aligned with RFC 8785
- Event-level traceability for policy and inference actions
- Vault transit signing support and triple-publication key verification paths
- Verification support for downstream audit and operations

### RAG Vault

Compliance-aware retrieval for regulated knowledge workflows.

- UCO-partitioned retrieval boundaries
- Sector-aware knowledge segmentation
- Retrieval support for controlled enterprise AI use cases
- Designed for evidence-linked retrieval workflows

### COS+ Database

Compliance-first persistence layer for evidence and audit records.

- PostgreSQL-based storage with pgvector support
- Append-only audit table design
- WORM-enforced audit protections
- Compliance-primary indexing for traceable review and retention workflows
- Migration and invariant verification support for deployment gating

---

## Typical Use Cases

IOS+ is best suited for organizations that need provable control over AI-driven workflows, including:

- AI-assisted document and records processing
- Regulated enterprise RAG deployments
- Compliance-sensitive agent workflows
- Audit-ready inference logging and review
- Sector-specific policy enforcement before model execution

---

## Who It Is For

IOS+ is designed for:

- enterprise platform engineering teams,
- compliance and governance leaders,
- regulated AI program owners,
- security and audit stakeholders,
- and solution teams deploying AI into high-control environments.

---

## Architecture Summary

The platform is organized as a modular middleware and evidence stack:

- shared types for decisioning and evidence payloads,
- middleware orchestration across seven runtime layers,
- compliance evaluation sidecar,
- signing and evidence services,
- retrieval services,
- and database services for audit and persistence.

The current repo also includes deployment-focused hardening assets such as:

- dependency-aware `/ready` diagnostics,
- Prometheus-compatible `/metrics` output,
- Vault secret projection support,
- migration and invariant verification jobs,
- release orchestration scripts,
- and alert-rule configuration.

## Repository Structure

```text
ios-plus/
├── packages/
│   ├── shared/
│   ├── middleware-engine/
│   ├── gate-530/
│   ├── evidence-fabric/
│   ├── rag-vault/
│   ├── cos-plus/
│   └── uco-resolver/
├── infra/
│   ├── helm/ios-plus/
│   ├── kubernetes/
│   ├── monitoring/
│   ├── terraform/
│   └── vault/
├── db/
│   ├── migrations/
│   ├── grants/
│   └── seeds/
├── scripts/
│   ├── db/
│   └── ops/
└── .github/
    ├── workflows/
    └── ISSUE_TEMPLATE/
```

---

## Local Development

### Prerequisites

- Docker
- Node.js 20.19+
- PostgreSQL client tools

### Quick Start

```bash
cp .env.example .env
docker compose up -d
npm install
npm run build
npm run db:migrate
npm run db:verify-worm
npm run dev
```

### Common Validation Commands

```bash
npm run test
npm run test:coverage
npm run typecheck
npm run lint
npm run build
helm lint infra/helm/ios-plus
```

---

## Audit Readiness / Acquirer Validation

### Primary prerequisite

- Docker

### One-command clean-room audit run

```bash
docker compose -f docker-compose.test.yml up --build --exit-code-from test-runner
```

### What the audit command does

- builds a deterministic Node 20.19.0 audit image from `Dockerfile.test`,
- installs dependencies with `npm ci`,
- starts a production-realistic PostgreSQL test dependency for the live WORM database integration test,
- builds the TypeScript monorepo with the root `build` pipeline,
- runs the full Vitest suite,
- enforces an 80%+ coverage gate on the currently audit-scoped middleware orchestration modules,
- and exits non-zero if the build, tests, or coverage gate fail.

### Artifacts and logs

- coverage artifacts are written to `coverage/` (`lcov.info`, `cobertura-coverage.xml`, and summary files),
- audit harness logs are written to `.audit-artifacts/audit-test.log`,
- and CI uploads `coverage/` as a workflow artifact on every run.

### Test architecture and isolation boundaries

- TypeScript tests live adjacent to source files inside each package to mirror production boundaries.
- Middleware orchestration contract tests explicitly verify dependency injection and parameter passing between the orchestration pipeline and downstream middleware services.
- Gate 530, COS+ repository access, and transport routes are tested in isolation with mocked external dependencies so the audit harness remains deterministic.
- The PostgreSQL-backed WORM integration test runs against the containerized `cos-plus-test` database in the audit harness rather than relying on a developer workstation.
- Coverage enforcement is intentionally scoped to the currently audit-ready middleware orchestration modules: `L1_ingestion`, `L2_semantic`, `L7_synthesis`, and `orchestrator/pipeline`.

---

## Deployment

The repository includes infrastructure assets for Kubernetes-based deployment and production-oriented orchestration.

### Helm Deploy

```bash
helm upgrade --install ios-plus infra/helm/ios-plus \
  --namespace ios-plus --create-namespace \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --atomic --timeout 10m --wait
```

### Release Orchestration

A closed-loop deployment helper is included at:

```bash
./scripts/ops/deploy_orchestration.sh
```

This script is intended to automate:

- deployment preflight checks,
- database migration execution,
- schema/invariant verification,
- Helm upgrade,
- rollout validation,
- readiness verification,
- and rollback on failed deployment health checks.

### Included Operational Assets

The repo now includes assets for:

- key management workflows,
- Vault bootstrap and policy application,
- seed data loading,
- Helm-based deployment,
- migration and post-migration validation,
- Merkle root publication and verification,
- alert-rule configuration,
- and post-deployment verification.

---

## Security Notes

- Private keys are never committed to this repository
- Keys are managed through HashiCorp Vault transit workflows or local development custody paths
- Audit tables are designed with append-only and WORM enforcement controls
- Administrative rule-management endpoints require explicit authentication
- Production startup paths are intended to fail closed when critical credentials are missing

---

## Readiness and Production Posture

The repo currently supports a stronger operational posture than earlier versions, including:

- readiness checks for core dependencies,
- secret-ingestion support through Vault-projected env files,
- migration verification gates,
- admin mutation audit logging,
- and alerting/metrics scaffolding.

That said, this repository should still be described carefully:

> IOS+ is a materially hardened integration candidate, not a fully proven production deployment by repository evidence alone.

Final production readiness still requires:

- target-environment Vault activation,
- cloud DNS and service identity configuration,
- end-to-end staging validation,
- and sustained operational verification in the live environment.

---

## Documentation

Internal implementation and operational specifications are maintained in the Engineering Body document set.
Moonshot verification runbook: [tests/moonshot/README.md](tests/moonshot/README.md).

For product, deployment, or partnership inquiries, contact [support@smeprotech.com](mailto:support@smeprotech.com).

---

## License

Proprietary — SMEPro Technologies. All rights reserved.
