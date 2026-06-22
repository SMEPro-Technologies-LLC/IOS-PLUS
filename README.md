# IOS+ Middleware Engine & COS+ Database

Compliance-native enforcement and evidence infrastructure for enterprise AI systems.

## Overview

IOS+ helps regulated organizations enforce compliance controls at runtime, generate signed audit evidence for AI actions, and persist traceable records in a compliance-first data layer.

Built for enterprise AI workflows that require:

- **Real-time policy enforcement**
- **Immutable auditability**
- **Sector-aware retrieval**
- **Deployment-oriented operational controls**

## Current Status

IOS+ is a **materially hardened integration candidate** undergoing operational hardening. The repository contains:

- Authenticated administrative control-plane routes
- Fail-closed semantic classification and synthesis behavior
- Dependency-aware readiness diagnostics
- HTTP/2 and IPC support for Gate 530 transport
- Vault-oriented secret ingestion and bootstrap assets
- Database migration and invariant verification tooling
- Prometheus-compatible metrics and alert-rule scaffolding
- Release orchestration and rollback automation
- State licensure lookup via CIP→SOC→NAICS traversal support

Final production readiness requires environment-specific validation: target-environment Vault activation, cloud DNS and service identity configuration, end-to-end staging validation, comprehensive UDM seed population, and sustained operational verification.

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
Compliance-first persistence layer for evidence, audit records, and governed ontology traversal.

- PostgreSQL-based storage with pgvector support
- Append-only audit table design
- WORM-enforced audit protections
- Compliance-primary indexing for traceable review and retention workflows
- Migration and invariant verification support for deployment gating

### UDM Licensure Traversal
Destination-state licensure determinations via Universal Decoding Matrix traversal.

**Current implemented path:**

- Direct `uco_nodes.cip`
- CIP → NAICS
- CIP → SOC → NAICS
- Join to `uco_obligation_metadata.state`
- Derive licensure via `enforcement_type = 'License/Certificate'`
- Rank: direct matches first, then confidence, then risk

**Current endpoint:**

```
GET /v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA
```

**Current database objects:**

- `v_state_licensure_candidates`
- `fn_lookup_state_licensure_by_cip(student_cip, destination_state)`

## Typical Use Cases

- AI-assisted document and records processing
- Regulated enterprise RAG deployments
- Compliance-sensitive agent workflows
- Audit-ready inference logging and review
- Sector-specific policy enforcement before model execution
- Degree-plan-to-licensure destination-state evaluation

## Who It Is For

- Enterprise platform engineering teams
- Compliance and governance leaders
- Regulated AI program owners
- Security and audit stakeholders
- Higher-education and healthcare operators with licensure exposure
- Solution teams deploying AI into high-control environments

## Architecture Summary

The platform is organized as a modular middleware and evidence stack:

| Layer | Package | Purpose |
|-------|---------|---------|
| Shared Types | `packages/shared` | Decisioning and evidence payloads |
| Middleware | `packages/middleware-engine` | 7-layer orchestration |
| Compliance | `packages/gate-530` | Runtime evaluation sidecar |
| Evidence | `packages/evidence-fabric` | Signing and evidence services |
| Retrieval | `packages/rag-vault` | Compliance-aware retrieval |
| Database | `packages/cos-plus` | Audit and persistence |
| UDM | `packages/uco-resolver` | Licensure traversal |

## Repository Structure

```
ios-plus/
├── packages/
│   ├── shared/              # Shared types, constants, utilities
│   ├── middleware-engine/   # 7-layer orchestration & HTTP server
│   ├── gate-530/            # Compliance evaluation engine
│   ├── evidence-fabric/     # Ed25519 signing & JCS canonicalization
│   ├── rag-vault/           # UCO-partitioned retrieval
│   ├── cos-plus/            # PostgreSQL WORM persistence
│   └── uco-resolver/        # Licensure traversal engine
├── infra/
│   ├── helm/ios-plus/       # Helm chart for K8s deployment
│   ├── kubernetes/          # Raw K8s manifests
│   ├── monitoring/          # Prometheus, Grafana, alerts
│   ├── terraform/           # GKE/EKS + Vault infrastructure
│   └── vault/               # Vault policy, K8s auth, PKI
├── db/
│   ├── init/                # Extension setup
│   ├── migrations/          # Ordered schema migrations
│   ├── grants/              # RBAC roles
│   └── seeds/               # JSON/CSV seed data
├── scripts/
│   ├── db/                  # Migration, verify, seed, grant scripts
│   └── ops/                 # Deployment orchestration
├── .github/
│   ├── workflows/           # CI, audit, release
│   └── ISSUE_TEMPLATE/      # Bug, feature, security
├── docs/                    # Reference documentation
├── tests/                   # Test suites and moonshot runbook
├── docker-compose.yml       # Local development stack
├── docker-compose.test.yml  # Clean-room audit stack
├── Dockerfile               # Production image
├── Dockerfile.test          # Audit image
├── package.json             # Root monorepo manifest
└── tsconfig.json            # Root TypeScript config
```

## Local Development

### Prerequisites

- Docker
- Node.js 20.19+
- PostgreSQL client tools

### Quick Start

```bash
# Clone and setup
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

### Licensure Lookup Smoke Test

```bash
curl "http://localhost:3001/v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA"
```

## Audit Readiness / Acquirer Validation

### Primary prerequisite
Docker

### One-command clean-room audit run

```bash
docker compose -f docker-compose.test.yml up --build --exit-code-from test-runner
```

### What the audit command does

1. Builds a deterministic Node 20.19.0 audit image from `Dockerfile.test`
2. Installs dependencies with `npm ci`
3. Starts a production-realistic PostgreSQL test dependency for live WORM database integration test
4. Builds the TypeScript monorepo with the root build pipeline
5. Runs the full Vitest suite
6. Enforces an 80%+ coverage gate on the currently audit-scoped middleware orchestration modules
7. Exits non-zero if the build, tests, or coverage gate fail

### Artifacts and logs

- Coverage artifacts are written to `coverage/` (`lcov.info`, `cobertura-coverage.xml`, and summary files)
- Audit harness logs are written to `.audit-artifacts/audit-test.log`
- CI uploads `coverage/` as a workflow artifact on every run

## Deployment

### Helm Deploy

```bash
helm upgrade --install ios-plus infra/helm/ios-plus \
  --namespace ios-plus --create-namespace \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --atomic --timeout 10m --wait
```

### Release Orchestration

```bash
# Full closed-loop deployment
./scripts/ops/deploy_orchestration.sh deploy

# Preflight checks only
./scripts/ops/deploy_orchestration.sh preflight

# Post-deployment verification
./scripts/ops/deploy_orchestration.sh verify

# Rollback on failure
./scripts/ops/deploy_orchestration.sh rollback
```

## Security Notes

- Private keys are never committed to this repository
- Keys are managed through HashiCorp Vault transit workflows or local development custody paths
- Audit tables are designed with append-only and WORM enforcement controls
- Administrative rule-management endpoints require explicit authentication
- Production startup paths are intended to fail closed when critical credentials are missing

## Readiness and Production Posture

The repo currently supports a stronger operational posture than earlier versions, including:

- Readiness checks for core dependencies
- Secret-ingestion support through Vault-projected env files
- Migration verification gates
- Admin mutation audit logging
- Licensure lookup traversal support
- Alerting/metrics scaffolding

That said, this repository should still be described carefully: **IOS+ is a materially hardened integration candidate, not a fully proven production deployment by repository evidence alone.**

Final production readiness still requires:

- Target-environment Vault activation
- Cloud DNS and service identity configuration
- End-to-end staging validation
- Comprehensive UDM seed population
- Sustained operational verification in the live environment

## Documentation

- Internal implementation and operational specifications are maintained in the Engineering Body document set
- Moonshot verification runbook: `tests/moonshot/README.md`
- Additional reference: `docs/COS_UDM_Review_Expansion_Report.md`

## License

Proprietary — SMEPro Technologies. All rights reserved.

For product, deployment, or partnership inquiries, contact support@smeprotech.com.
