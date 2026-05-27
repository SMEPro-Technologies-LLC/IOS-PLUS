# IOS+ Middleware Engine & COS+ Database

**Compliance-native enforcement and evidence infrastructure for enterprise AI systems**

IOS+ helps regulated organizations enforce compliance controls at runtime, generate signed audit evidence for AI actions, and persist traceable records in a compliance-first data layer.

Built for enterprise AI workflows that require:
- real-time policy enforcement,
- immutable auditability,
- sector-aware retrieval,
- and deployment-ready operational controls.

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
- Records policy evaluation metadata for downstream audit

### Evidence Fabric
Cryptographic audit evidence for AI activity.

- Ed25519-signed evidence records
- JCS-canonicalized payloads aligned with RFC 8785
- Event-level traceability for policy and inference actions
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
│   └── terraform/
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
- Node.js 20+
- PostgreSQL client tools

### Quick Start

```bash
cp .env.example .env
docker-compose up -d
npm install
npm run build
npm run db:migrate
npm run db:verify-worm
npm run dev
```

---

## Deployment

The repository includes infrastructure assets for Kubernetes-based deployment.

```bash
helm upgrade --install ios-plus infra/helm/ios-plus \
  --namespace ios-plus --create-namespace \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --atomic --timeout 10m --wait
```

Deployment and operational procedures include:
- key management workflows,
- seed data loading,
- Helm-based deployment,
- replication setup,
- and post-deployment validation.

---

## Security Notes

- Private keys are never committed to this repository
- Keys are managed through HashiCorp Vault transit workflows
- Seed CSVs are not stored in the repo
- Audit tables are designed with append-only and WORM enforcement controls

---

## Documentation

Internal implementation and operational specifications are maintained in the Engineering Body document set.

For product, deployment, or partnership inquiries: **support@smeprotech.com**

---

## License

Proprietary — SMEPro Technologies. All rights reserved.
