# GCP Security Controls — SMEPro COS (IOS-Plus)

> **Version:** 1.0  
> **Date:** 2026-06-21  
> **Classification:** Internal — Restricted  
> **Scope:** All GCP infrastructure for Operator NFRD / SMEPro COS v2  
> **Aligned with:** NIST AI RMF, FERPA, HIPAA readiness, SOC 2 Type II path, EU AI Act (future)

---

## Table of Contents

1. [Data Residency](#1-data-residency)
2. [Encryption](#2-encryption)
3. [PII Handling](#3-pii-handling)
4. [Network Security](#4-network-security)
5. [Identity & Access](#5-identity--access)
6. [Audit & Evidence](#6-audit--evidence)
7. [Compliance Alignment](#7-compliance-alignment)
8. [Incident Response](#8-incident-response)
9. [Third-Party Risk](#9-third-party-risk)

---

## 1. Data Residency

### 1.1 Primary Region

All production data resides in **us-central1** (Iowa) unless explicitly designated for disaster recovery.

| Data Type | Primary Region | DR Region | Justification |
|-----------|----------------|-----------|---------------|
| Student records (SYN IDs, pseudonymized) | us-central1 | us-east4 | FERPA-compliant US jurisdiction |
| Evidence records (signed documents) | us-central1 | us-east4 | Legal hold requirements, WORM integrity |
| AI model usage logs | us-central1 | us-east4 | EU AI Act transparency, NIST RMF measurement |
| Audit logs (WORM PostgreSQL) | us-central1 | us-east4 | Compliance evidence chain |
| ETL raw data | us-central1 | — | Transient, reproducible from source systems |
| Backup data | us-central1 | us-east4 | PITR + cross-region for DR |

### 1.2 Terraform Resources

```hcl
# infra/terraform/modules/storage/main.tf
resource "google_storage_bucket" "evidence" {
  name          = "cos-${var.environment}-evidence"
  location      = "US-CENTRAL1"          # Primary region
  force_destroy = false

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = 220752000          # 7 years in seconds (FERPA)
  }
}
```

```hcl
# infra/terraform/modules/database/main.tf
resource "google_sql_database_instance" "primary" {
  database_version = "POSTGRES_16"
  region           = "us-central1"

  settings {
    availability_type = "REGIONAL"          # HA within us-central1
    location_preference {
      zone = "us-central1-a"
    }
  }
}

resource "google_sql_database_instance" "replica" {
  database_version    = "POSTGRES_16"
  region              = "us-east4"         # DR region
  master_instance_name = google_sql_database_instance.primary.name
}
```

### 1.3 Policy Enforcement

- **Organization Policy Constraint:** `constraints/gcp.resourceLocations` = `us-central1, us-east4`
- **VPC Service Controls:** Optional perimeter around `us-central1` for production (see Section 4.5)
- **Cloud DLP:** Scan all storage buckets for unapproved geographic data copies

---

## 2. Encryption

### 2.1 Encryption at Rest

All data at rest is encrypted with **Customer-Managed Encryption Keys (CMEK)** via Cloud KMS.

| Service | Encryption Key | Key Rotation | Terraform Resource |
|---------|---------------|--------------|-------------------|
| Cloud Storage (all 6 buckets) | `cos-storage-enc` | 90 days | `google_kms_crypto_key.storage_enc` |
| Cloud SQL | `cos-db-enc` | 90 days | `google_kms_crypto_key.db_enc` |
| Cloud SQL backups | `cos-db-enc` | 90 days | Inherited from instance |
| Secret Manager | `cos-secrets-enc` | 90 days | `google_kms_crypto_key.secrets_enc` |
| Redis (Memorystore) | `cos-redis-enc` | 90 days | `google_kms_crypto_key.redis_enc` |
| Pub/Sub messages | `cos-pubsub-enc` | 90 days | `google_kms_crypto_key.pubsub_enc` |
| Evidence records | `cos-evidence-enc` | 180 days | `google_kms_crypto_key.evidence_enc` |

### 2.2 Terraform: KMS Key Ring and Keys

```hcl
# infra/terraform/modules/security/kms.tf
resource "google_kms_key_ring" "cos_keyring" {
  name     = "cos-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "storage_enc" {
  name            = "cos-storage-enc"
  key_ring        = google_kms_key_ring.cos_keyring.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s"  # 90 days

  version_template {
    algorithm = "GOOGLE_SYMMETRIC_ENCRYPTION"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "storage_enc_user" {
  crypto_key_id = google_kms_crypto_key.storage_enc.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.storage.email}"
}
```

### 2.3 Encryption in Transit

| Protocol | Requirement | Verification |
|----------|-------------|------------|
| Cloud SQL | SSL/TLS 1.3 mandatory | `require_ssl = true` in Terraform; client certificates required |
| Redis | TLS 1.3 mandatory | `transit_encryption_mode = "SERVER_AUTHENTICATION"` |
| GKE ingress | TLS 1.3, HSTS, certificate pinning | Managed certificate via Google-managed SSL |
| API-to-API | mTLS within mesh (Istio/Linkerd optional) | Service mesh sidecar with mutual TLS |
| Pub/Sub | TLS 1.3 (managed by GCP) | No additional configuration required |
| Secret Manager | TLS 1.3 (managed by GCP) | No additional configuration required |

### 2.4 Cloud SQL SSL Verification

```bash
# Verify SSL is enforced
gcloud sql instances describe cos-db-production --format='value(settings.ipConfiguration.requireSsl)'
# Expected: true

# Download client certificate
gcloud sql ssl client-certs create client-cert cos-db-production
gcloud sql ssl client-certs describe client-cert cos-db-production
```

### 2.5 Redis TLS Verification

```bash
# Verify TLS mode
gcloud redis instances describe redis-production --region=us-central1 --format='value(transitEncryptionMode)'
# Expected: SERVER_AUTHENTICATION

# Connect with TLS
redis-cli -h <redis-host> -p 6379 --tls --auth <auth-string> PING
# Expected: PONG
```

---

## 3. PII Handling

### 3.1 Pseudonymization Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Source System  │────▶│  Connector       │────▶│  Database       │
│  (Banner, etc.) │     │  (Ingestion)     │     │  (COS)          │
│                 │     │  - Hash PIDM     │     │  - SYN IDs only │
│  Raw PII        │     │  - Generate SYN  │     │  - No raw PII   │
│                 │     │  - Drop PII      │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### 3.2 Pseudonymization Rules

| Field | Source | Action | Result |
|-------|--------|--------|--------|
| `PIDM` | Banner SIS | SHA-256 + HMAC with institution secret | `SYN-XXXXXX` |
| `SSN` | Banner SIS | Truncate after hashing; never store raw | Not stored in COS |
| `Email` | Banner SIS | Hash local part; store domain only | `****@lamar.edu` |
| `Name` | Banner SIS | Not stored in COS | Lookup only in source system |
| `DOB` | Banner SIS | Age bucket (e.g., `18-24`) | Demographic aggregate only |
| `Address` | Banner SIS | Not stored | Geographic data from IPEDS |

### 3.3 De-Pseudonymization Policy

De-pseudonymization is **prohibited** without dual approval:

1. **Data Steward** (Registrar or designee) — verifies legitimate business need
2. **Privacy Officer** — verifies FERPA compliance and consent

Both must sign an evidence record (Ed25519) that is stored in the evidence bucket with 7-year retention.

```sql
-- Module 3: AI Governance enforces this at the application layer
-- No database function exists for reverse-mapping SYN → PIDM
-- connector-ingestion is the only service with access to the hash mapping table
-- and it logs every access to module3_ai_governance.ai_model_usage_logs
```

### 3.4 Terraform: PII Handling Controls

```hcl
# infra/terraform/modules/security/dlp.tf (optional, recommended for production)
resource "google_dlp_inspect_template" "pii_scan" {
  parent = "projects/${var.project_id}"
  template_id = "cos-pii-template"

  inspect_config {
    info_types {
      name = "US_SOCIAL_SECURITY_NUMBER"
    }
    info_types {
      name = "EMAIL_ADDRESS"
    }
    info_types {
      name = "PERSON_NAME"
    }

    min_likelihood = "LIKELY"
  }
}
```

### 3.5 K8s Manifest: Data Classification Label

```yaml
# infra/k8s/base/pod-security-policies.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: data-classification-policy
  namespace: connector-ingestion
data:
  policy: |
    classification_levels:
      - public
      - internal
      - restricted
      - confidential
    pii_handling:
      restricted: "pseudonymize_before_storage"
      confidential: "pseudonymize_before_storage + dual_approval_for_access"
```

---

## 4. Network Security

### 4.1 Private GKE

| Attribute | Staging | Production | Terraform Resource |
|-----------|---------|------------|-------------------|
| Private nodes | Yes | Yes | `google_container_cluster.gke_autopilot` |
| Public endpoint | No | No | `private_cluster_config.enable_private_endpoint = true` |
| Master authorized networks | Cloud Build + Bastion | Cloud Build + Bastion + VPN | `master_authorized_networks_config` |
| Intranode visibility | Enabled | Enabled | `enable_intranode_visibility = true` |
| Shielded nodes | Enabled | Enabled | `shielded_nodes.enabled = true` |
| Workload Identity | Enabled | Enabled | `workload_identity_config` |

### 4.2 Cloud SQL Private IP

```hcl
# infra/terraform/modules/database/main.tf
resource "google_sql_database_instance" "primary" {
  settings {
    ip_configuration {
      ipv4_enabled = false
      private_network = google_compute_network.vpc.id
      require_ssl = true
    }
  }
}
```

### 4.3 VPC Firewall Rules

```hcl
# infra/terraform/modules/network/firewall.tf
resource "google_compute_firewall" "allow_internal" {
  name    = "allow-internal"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }

  source_ranges = [var.subnet_cidr_gke, var.subnet_cidr_services, var.subnet_cidr_db]
}

resource "google_compute_firewall" "allow_health_checks" {
  name    = "allow-health-checks"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
    ports    = ["8080", "80", "443"]
  }

  source_ranges = ["130.211.0.0/22", "35.191.0.0/16", "209.85.152.0/22", "209.85.204.0/22"]
}

resource "google_compute_firewall" "deny_ingress_default" {
  name    = "deny-ingress-default"
  network = google_compute_network.vpc.name

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  priority      = 1000
}
```

### 4.4 Cloud Armor WAF

See [GCP Deployment Runbook](GCP_Deployment_Runbook.md) Day 6 for full WAF rule table.

Key rules:
- SQL injection (OWASP CRS 3.3) — **Deny 403**
- XSS (OWASP CRS 3.3) — **Deny 403**
- Rate limiting — 100 req/min per IP, ban 60s
- Geo-blocking — non-US/CA traffic denied

### 4.5 VPC Service Controls (Optional — Production Recommended)

```hcl
# infra/terraform/modules/security/vpcsc.tf (optional)
resource "google_access_context_manager_service_perimeter" "cos_perimeter" {
  parent = "accessPolicies/${google_access_context_manager_access_policy.cos_policy.name}"
  name   = "accessPolicies/${google_access_context_manager_access_policy.cos_policy.name}/servicePerimeters/cos_perimeter"
  title  = "COS Production Perimeter"

  status {
    restricted_services = [
      "storage.googleapis.com",
      "bigquery.googleapis.com",
      "cloudsql.googleapis.com",
      "secretmanager.googleapis.com",
      "pubsub.googleapis.com"
    ]

    access_levels = [
      google_access_context_manager_access_level.cos_access_level.name
    ]

    vpc_accessible_services {
      enable_restriction = true
      allowed_services = [
        "storage.googleapis.com",
        "cloudsql.googleapis.com",
        "secretmanager.googleapis.com"
      ]
    }
  }
}
```

### 4.6 IAP for Admin Access

```hcl
resource "google_iap_tunnel_instance_iam_member" "admin_access" {
  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.bastion.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "group:cos-admins@lamar.edu"
}
```

Admin access to bastion, Cloud SQL, and GKE master is via Identity-Aware Proxy (IAP) only. No direct SSH or RDP from public internet.

---

## 5. Identity & Access

### 5.1 Workload Identity

No service account keys are stored in pods. All pod-to-GCP access is via Workload Identity Federation.

```hcl
# infra/terraform/modules/iam/workload_identity.tf
resource "google_service_account" "api_gateway" {
  account_id   = "api-gateway"
  display_name = "API Gateway Service Account"
}

resource "google_project_iam_member" "api_gateway_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api_gateway.email}"
}

resource "google_project_iam_member" "api_gateway_secret" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.api_gateway.email}"
}

resource "google_service_account_iam_member" "api_gateway_workload_identity" {
  service_account_id = google_service_account.api_gateway.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[api-gateway/api-gateway]"
}
```

### 5.2 K8s RBAC

```yaml
# infra/k8s/base/rbac.yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: api-gateway
  name: api-gateway-role
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: api-gateway
  name: api-gateway-role-binding
subjects:
  - kind: ServiceAccount
    name: api-gateway
    namespace: api-gateway
roleRef:
  kind: Role
  name: api-gateway-role
  apiGroup: rbac.authorization.k8s.io
```

### 5.3 Role-Lens Governance (Application Layer)

The COS application enforces role-based data access at the API layer, independent of K8s RBAC:

| Role | Data Access | AI Model Access | Evidence Signing |
|------|-------------|-----------------|------------------|
| Student | Own record only (SYN ID) | Minimal risk models only | No |
| Faculty | Assigned students, course rosters | Limited risk models | No |
| Advisor | Advisee records, risk alerts | Limited risk models | No |
| Registrar | All student records (pseudonymized) | Limited risk models | No |
| Compliance Officer | All regulatory data, audit logs | All risk classes | Yes |
| AI Governance Officer | Model inventory, usage logs, risk register | All risk classes | Yes |
| Admin | All data (with logging) | All risk classes | Yes |

All access decisions are logged to `module3_ai_governance.ai_model_usage_logs` with `context_classification` and `trace_id`.

### 5.4 No Exported Credentials Policy

- **Prohibited:** Downloading service account JSON keys, storing keys in CI/CD variables, embedding keys in container images
- **Enforced:** Organization policy `constraints/iam.disableServiceAccountKeyCreation` = `true`
- **Monitored:** Cloud Audit Logs alert on any `google.iam.admin.v1.CreateKey` event

---

## 6. Audit & Evidence

### 6.1 WORM PostgreSQL

Write-Once-Read-Many (WORM) enforcement is implemented via PostgreSQL triggers:

```sql
-- V14__module3_ai_governance.sql
CREATE TRIGGER trg_worm_usage_logs
    BEFORE UPDATE OR DELETE ON module3_ai_governance.ai_model_usage_logs
    FOR EACH ROW
    EXECUTE FUNCTION module3_ai_governance.worm_protect_usage_logs();

CREATE TRIGGER trg_worm_audit
    BEFORE UPDATE OR DELETE ON module3_ai_governance.ai_governance_audit
    FOR EACH ROW
    EXECUTE FUNCTION module3_ai_governance.worm_protect_audit();
```

**WORM scope:**
- `ai_model_usage_logs`: Strictly append-only. No UPDATE or DELETE permitted.
- `ai_governance_audit`: Append-only with limited update. Only `remediation_status` and `due_date` may be changed.

### 6.2 Cloud Audit Logs

| Log Type | Retention | Storage | Purpose |
|----------|-----------|---------|---------|
| Admin Activity | 400 days | Cloud Logging + Cloud Storage | IAM changes, resource creation, API enablement |
| Data Access | 400 days | Cloud Logging + Cloud Storage | Cloud SQL queries, Storage access, Secret access |
| System Event | 400 days | Cloud Logging | GKE node events, auto-scaling |
| Policy Denied | 400 days | Cloud Logging | VPC-SC, IAM deny, Cloud Armor blocks |

### 6.3 Evidence Chain with Ed25519

Every regulated action generates an evidence record signed with Ed25519:

```
Action → Hash payload → Sign with Ed25519 private key (KMS-backed) → Store signature + payload in evidence bucket → Log evidence_record_id in database
```

| Component | Implementation |
|-----------|----------------|
| Signing key | Cloud KMS asymmetric key (Ed25519), `cos-evidence-signing-key` |
| Key rotation | 180 days |
| Verification | Public key published to `https://api.ioscos.com/.well-known/evidence-public-key` |
| Storage | `gs://cos-production-evidence` with CMEK, 7-year retention |
| Tamper evidence | SHA-256 of payload stored in WORM PostgreSQL; signature stored in WORM bucket |

### 6.4 Terraform: Evidence Signing

```hcl
resource "google_kms_crypto_key" "evidence_signing" {
  name     = "cos-evidence-signing-key"
  key_ring = google_kms_key_ring.cos_keyring.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm = "EC_SIGN_ED25519"
  }

  rotation_period = "15552000s"  # 180 days
}
```

---

## 7. Compliance Alignment

### 7.1 FERPA Alignment

| FERPA Requirement | COS Implementation | Evidence |
|---------------------|-------------------|----------|
| Consent for disclosure | Consent workflow in Module 2; signed evidence record stored | `module3_ai_governance.ai_governance_controls` LAI-DATA-2 |
| Annual notification | Automated notification via EDU Reporter (Module 2) | `module2_enrollment.student_notification_log` |
| Record access | Student self-service portal (Module 2) | `module2_analytics.student_activity_signals` |
| Amendment rights | Correction request workflow with evidence | `module3_ai_governance.ai_governance_audit` |
| Third-party disclosure | AI model vendor agreements (Microsoft Copilot, etc.) | `module3_ai_governance.ai_model_inventory` |
| Directory information opt-out | Student preference flag in Banner, synced to COS | `module1_canonical.concept_definitions` |

### 7.2 HIPAA Readiness (If Applicable)

If COS stores or processes PHI (e.g., student health records, counseling data):

| Requirement | Readiness Status | Gap |
|-------------|------------------|-----|
| Business Associate Agreement (BAA) | Ready — template available | Execute with Google Cloud |
| Access controls | Implemented | Role-lens + RBAC |
| Audit logs | Implemented | WORM + Cloud Audit Logs |
| Encryption | Implemented | CMEK at rest, TLS 1.3 in transit |
| Data integrity | Implemented | Ed25519 evidence chain |
| Breach notification | Partial | Incident response runbook exists; automated notification pipeline needed |
| Minimum necessary | Implemented | Role-lens governs data exposure |
| Training | Not implemented | Annual HIPAA training for staff with PHI access |

### 7.3 SOC 2 Type II Path

| SOC 2 Trust Service Criterion | COS Control | Evidence Location |
|------------------------------|-------------|-------------------|
| CC6.1 (Logical access) | Workload Identity, K8s RBAC, role-lens | Terraform IAM + K8s RBAC manifests |
| CC6.2 (Access removal) | Automated IAM revocation on offboarding | Cloud Audit Logs + HR sync |
| CC6.3 (Access review) | Quarterly access review with evidence | `module3_ai_governance.ai_governance_controls` LAI-AUDIT-1 |
| CC6.6 (Encryption) | CMEK, TLS 1.3 | Terraform KMS + Cloud SQL SSL configs |
| CC6.7 (Data transmission) | mTLS optional, TLS 1.3 mandatory | K8s ingress + Cloud SQL SSL |
| CC7.2 (System monitoring) | Prometheus + Cloud Monitoring | K8s monitoring manifests |
| CC7.3 (System evaluation) | Quarterly control review, annual external audit | `module3_ai_governance.ai_governance_audit` |
| CC8.1 (Change management) | Cloud Deploy pipeline, Git-based IaC | Cloud Deploy history + Git commits |

### 7.4 EU AI Act (Future)

| EU AI Act Article | COS Readiness | Implementation |
|-------------------|---------------|----------------|
| Art. 10 (Data governance) | Ready | Pseudonymization, SYN IDs, data quality controls |
| Art. 13 (Transparency) | Ready | Usage logging, trace IDs, cited-node responses |
| Art. 14 (Human oversight) | Ready | Human-in-the-loop for high-risk outputs, advisor alerts |
| Art. 15 (Accuracy, robustness, security) | Partial | Risk register exists; formal accuracy testing framework needed |
| Art. 52 (Obligations for high-risk) | Ready | Model inventory, risk classification, evidence records |
| Art. 53 (General-purpose AI) | Ready | GPT-4 / Copilot registered with risk classification and mitigations |
| Art. 6 (Prohibited practices) | Ready | Real-time facial recognition, social scoring, subliminal manipulation blocked by policy |

---

## 8. Incident Response

### 8.1 Data Breach Runbook

| Phase | Action | Owner | Timeline |
|-------|--------|-------|----------|
| Detect | WORM violation alert, audit log anomaly, Cloud Armor spike | Monitoring | Immediate |
| Contain | Revoke service account, isolate pods, suspend model | SRE | 15 min |
| Assess | Determine scope: which SYN IDs, which models, which evidence | Security Engineer | 1 hour |
| Notify | FERPA coordinator, legal counsel, insurance | Compliance Officer | 72 hours |
| Document | Evidence record with Ed25519 signature | AI Governance Officer | 4 hours |
| Remediate | Patch vulnerability, rotate secrets, update WAF | Platform | 24 hours |
| Review | Post-incident review, update risk register | AI Governance Officer | 7 days |

### 8.2 System Compromise Runbook

| Phase | Action | Owner | Timeline |
|-------|--------|-------|----------|
| Detect | Unusual API traffic, IAM changes, pod resource spikes | Monitoring | Immediate |
| Contain | Scale deployment to 0, isolate namespace, revoke WI binding | SRE | 15 min |
| Preserve | Snapshot logs, capture forensic image | Security Engineer | 1 hour |
| Investigate | External IR team if needed | CISO | 24 hours |
| Remediate | Rebuild from clean base, patch CVEs, rotate all credentials | DevOps | 48 hours |
| Recover | Redeploy, verify smoke tests, restore incrementally | SRE | 72 hours |
| Review | Post-incident review, update controls | AI Governance Officer | 7 days |

### 8.3 Regulatory Change Runbook

| Phase | Action | Owner | Timeline |
|-------|--------|-------|----------|
| Monitor | NIST, EU AI Act, Texas RRC, ONRR update feeds | Compliance Officer | Ongoing |
| Assess | Map new regulation to existing controls | AI Governance Officer | 14 days from announcement |
| Plan | Jira epic, assign resources, estimate effort | Product Owner | 21 days |
| Implement | Update controls, schema if needed, evidence records | Engineering | Per epic |
| Validate | Internal audit, external audit if required | Compliance Officer | Per regulation |
| Communicate | Update framework versions, notify stakeholders | AI Governance Officer | 30 days |

---

## 9. Third-Party Risk

### 9.1 Vendor Assessment Matrix

| Vendor | Service | Risk Class | Data Access | Assessment Status | Renewal Date |
|--------|---------|------------|-------------|-------------------|--------------|
| Microsoft | Copilot (Enterprise) | Limited | Pseudonymized queries | Completed 2026-01-15 | 2027-01-15 |
| Anthropic | Claude API (optional) | Limited | API prompts/responses | In Progress | — |
| Firecrawl | Web scraping | Minimal | Public web data | In Progress | — |
| Google Cloud | GCP (all services) | High | All institutional data | Completed (SOC 2, ISO 27001) | Annual |
| Google Cloud | Vertex AI (optional) | High | Model training data | Not started | — |
| GitHub | Source control | Limited | Source code, secrets | Completed | Annual |
| Snyk | Dependency scanning | Minimal | Dependency manifests | Completed | Annual |
| PagerDuty | Incident management | Minimal | Alert metadata | Completed | Annual |

### 9.2 Microsoft Copilot Assessment

| Control | Requirement | Evidence | Status |
|---------|-------------|----------|--------|
| Tenant isolation | Institutional data not used for Microsoft model training | Microsoft Admin Center configuration export | ✓ Verified |
| Data residency | US datacenter only | Microsoft Trust Center documentation | ✓ Verified |
| Encryption | AES-256 at rest, TLS 1.2+ in transit | Microsoft SOC 2 report | ✓ Verified |
| Audit logging | All interactions logged in Microsoft 365 Audit Log | Admin Center log export | ✓ Verified |
| DLP integration | Data loss prevention policies applied to Copilot | Microsoft Purview configuration | ✓ Verified |
| Retention | No retention of prompts beyond institutional policy | Microsoft data processing agreement | ✓ Verified |
| Subprocessors | Subprocessor list published, no unauthorized transfers | Microsoft DPA Appendix C | ✓ Verified |
| Incident response | Microsoft security incident notification SLA | Microsoft Online Services Terms | ✓ Verified |

### 9.3 Claude API Assessment (In Progress)

| Control | Requirement | Evidence | Status |
|---------|-------------|----------|--------|
| Data retention | Prompts not retained for model training | Anthropic API terms | ⏳ Pending legal review |
| Encryption | TLS 1.3, AES-256 | Anthropic security documentation | ⏳ Pending review |
| Audit logging | API call logs available | Anthropic dashboard | ⏳ Pending review |
| HIPAA BAA | Available if required | Anthropic sales | ⏳ Pending request |

### 9.4 Firecrawl Assessment (In Progress)

| Control | Requirement | Evidence | Status |
|---------|-------------|----------|--------|
| Data retention | Scraped data not retained by vendor | Firecrawl terms of service | ⏳ Pending review |
| Rate limiting | No scraping of institutional sites without consent | Configuration review | ⏳ Pending |
| API key security | Key stored in Secret Manager, rotated 90 days | Secret Manager audit | ✓ Verified |

---

*End of GCP Security Controls — SMEPro COS (IOS-Plus)*
