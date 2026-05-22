# IOS+ Middleware Engine & COS+ Database

> **Compliance-Native AI Infrastructure for the Agentic Enterprise**
> SMEPro Technologies | Confidential | cmiguez@smeprotech.com

---

## Overview

IOS+ is a seven-layer compliance-aware middleware engine paired with COS+, a columnar object store whose primary index is compliance-first. Together they provide:

- **Gate 530** — real-time compliance enforcement against 350 UCO nodes across 20 NAICS industry sectors
- **Evidence Fabric** — Ed25519-signed, JCS-canonicalized (RFC 8785) audit trail for every inference event
- **RAG Vault** — UCO-partitioned, sector-aware retrieval augmented generation knowledge layer
- **COS+ Database** — WORM-enforced PostgreSQL with pgvector, append-only audit tables, and compliance-primary indexing

## Repository Structure

```
ios-plus/
├── packages/
│   ├── shared/              # Shared TypeScript types (EvidencePackage, GateDecisionRecord, UCOTypes)
│   ├── middleware-engine/   # Seven-layer YBR orchestrator (L1–L7)
│   ├── gate-530/            # Compliance evaluation sidecar (IPC + UCO evaluation engine)
│   ├── evidence-fabric/     # Ed25519 signing + WORM commitment service
│   ├── rag-vault/           # UCO-partitioned vector retrieval service
│   ├── cos-plus/            # COS+ PostgreSQL driver + connection pool manager
│   └── uco-resolver/        # NAICS profile → UCO node resolution (L3 integration)
├── infra/
│   ├── helm/ios-plus/       # Helm chart — full stack deployment
│   ├── kubernetes/          # Base manifests, namespaces, RBAC
│   └── terraform/           # Cloud infrastructure provisioning
├── db/
│   ├── migrations/          # Flyway V1–V4 SQL migrations
│   ├── grants/              # Role GRANT/REVOKE scripts
│   └── seeds/               # UCO seed data (distributed via internal artifact store)
├── scripts/
│   ├── db/                  # WORM verification, UCO seed verification
│   └── ops/                 # Key publication consistency, evidence package verification
└── .github/
    ├── workflows/           # CI, CD-staging, CD-production, DB-migration, security scan
    └── ISSUE_TEMPLATE/      # Bug report, compliance incident templates
```

## Quick Start (Local Development)

```bash
# Prerequisites: Docker, Node.js 20+, psql client
cp .env.example .env          # fill in local values
docker-compose up -d          # starts postgres, redis, vault-dev
npm install
npm run build
npm run db:migrate            # applies V1–V4 Flyway migrations
npm run db:verify-worm        # confirms append-only triggers
npm run dev                   # starts all services with hot reload
```

## Deployment

See **EB Doc 6 — Deployment, Operations & Recovery Runbook** for full production deployment procedures including:
- Ed25519 key generation ceremony
- UCO seed data loading (350 nodes in dependency order)
- Helm deployment to Kubernetes
- WAL replication setup (15-minute RPO)
- Post-deployment validation checklist (23 checks)

```bash
helm upgrade --install ios-plus infra/helm/ios-plus \
  --namespace ios-plus --create-namespace \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --atomic --timeout 10m --wait
```

## Engineering Body

Full implementation specifications are in the NDA-classified Engineering Body series:

| Document | Scope |
|---|---|
| EB Doc 1 | Internal Architecture Specification |
| EB Doc 2 | Cryptographic Audit & Evidence Fabric |
| EB Doc 3 + Amendment v1.1 | COS+ Schema, Roles, UCO Extension |
| EB Doc 4 | Gate 530 UCO Dimension Matrix |
| EB Doc 5 | RAG Vault UCO-Partitioned Pipeline |
| EB Doc 6 | Deployment, Operations & Recovery Runbook |

Contact: **cmiguez@smeprotech.com**

## Security

- Private keys: **never** committed to this repository. Managed exclusively via HashiCorp Vault transit engine.
- Seed CSVs: **never** committed. Distributed via internal artifact store. See `db/seeds/README.md`.
- All audit tables are WORM-enforced at both role and trigger layers. See EB Doc 3.

## License

Proprietary — SMEPro Technologies. All rights reserved.
