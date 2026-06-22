# IOS+ Infrastructure — Terraform GCP

Production-grade Terraform infrastructure for the **Lamar University SMEPro Compliance Operating System (COS)** on Google Cloud Platform.

## Architecture Overview

| Layer | Resource | Description |
|-------|----------|-------------|
| **Network** | VPC, Subnets, Cloud NAT, Firewall | 3 private subnets (GKE pods, GKE services, private services) with outbound NAT and strict firewall rules |
| **Compute** | GKE Autopilot | Workload Identity, private cluster, Binary Authorization, REGULAR release channel |
| **Database** | Cloud SQL PostgreSQL 16 | HA (Regional), pgvector extension, automated backups, PITR, private IP, SSL required |
| **Cache** | Memorystore Redis 7.0 | Auth-enabled, private IP, tier adapts to environment (BASIC staging / STANDARD_HA production) |
| **Messaging** | Cloud Pub/Sub | 12 topics with dead-letter queues, 7-day message retention, cost-tracking labels |
| **Storage** | Cloud Storage (6 buckets) | CMEK encryption, lifecycle policies, WORM retention on evidence, uniform bucket-level access |
| **Security** | Cloud KMS + Secret Manager | 90-day key rotation, HSM protection, placeholder secrets for CI/CD injection |
| **WAF** | Cloud Armor | OWASP Core Rule Set, SQL injection & XSS prevention, rate-based banning (100 req/min/IP) |
| **IAM** | Service Accounts | 5 SAs with least-privilege roles, Workload Identity bindings, time-bound admin access |

## Repository Structure

```
ios-plus/infra/terraform/gcp/
├── main.tf                     # Root module — orchestrates all submodules
├── variables.tf                # All input variables with validation
├── outputs.tf                  # Root-level outputs
├── terraform.tfvars.example    # Staging example values
├── README.md                   # This file
└── modules/
    ├── network/
    ├── gke/
    ├── database/
    ├── cache/
    ├── pubsub/
    ├── storage/
    ├── security/
    ├── cloud-armor/
    └── iam/
```

## Prerequisites

1. **Terraform** >= 1.5.0
2. **GCP Project** with billing enabled
3. **gcloud CLI** authenticated with appropriate permissions:
   - `roles/editor` or granular permissions for compute, container, sqladmin, etc.
4. **Bootstrap bucket** for Terraform state (must exist before `terraform init`):
   ```bash
   gsutil mb -p <PROJECT_ID> -l us-central1 gs://cos-terraform-state-bucket
   ```
5. **Binary Authorization policy** (if using `PROJECT_SINGLETON_POLICY_ENFORCE`) or disable evaluation mode in `modules/gke/main.tf` for initial setup.

## Quick Start

```bash
cd ios-plus/infra/terraform/gcp

# 1. Copy and customize variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project_id, bucket names, etc.

# 2. Initialize
terraform init

# 3. Plan
terraform plan -out=tfplan

# 4. Apply
terraform apply tfplan
```

## State Management

The backend is configured for GCS. Update the `bucket` in `main.tf` to match your bootstrap bucket name:

```hcl
backend "gcs" {
  bucket = "lamar-cos-terraform-state-staging"
  prefix = "terraform/state"
}
```

## Environment-Specific Notes

### Staging
- `db_ha_enabled = false` → Zonal Cloud SQL
- `redis_tier = "BASIC"` → Single-node Redis
- `waf_enabled = true` → WAF active but rate limits are evaluated
- GKE master authorized networks allows `0.0.0.0/0` for developer access

### Production
- `db_ha_enabled = true` → Regional Cloud SQL with failover
- `redis_tier = "STANDARD_HA"` → High-availability Redis
- `waf_enabled = true` → All WAF rules enforced
- Restrict `master_authorized_networks_config` to corporate IPs
- Enable deletion protection on Cloud SQL

## Security Highlights

- **Private clusters**: GKE nodes have no public IPs; egress via Cloud NAT
- **Workload Identity**: GKE pods authenticate to GCP services without static keys
- **Cloud SQL**: Private IP only, SSL required, IAM database authentication enabled
- **CMEK**: All storage buckets encrypted with customer-managed keys in HSM
- **Secret Manager**: Placeholder secrets are created; rotate via CI/CD pipeline
- **Least Privilege**: Each microservice gets exactly the roles it needs
- **Time-Bound Admin**: `cos-admin-sa` is restricted to 8 AM–6 PM CST via IAM conditions
- **WAF**: OWASP rules, SQL injection, XSS, and rate-based banning (100 req/min, burst 200)

## Cost Optimization

- GKE Autopilot charges only for running pods (no idle node cost)
- Cloud SQL `db-g1-small` and BASIC Redis are sufficient for staging
- Lifecycle rules delete audit archive objects after 2,555 days (~7 years)
- Cloud NAT uses auto-allocated IPs (no static IP reservation)

## Maintenance Windows

| Resource | Window | Timezone |
|----------|--------|----------|
| GKE | Saturday–Sunday | UTC |
| Cloud SQL | Sunday | 04:00 UTC |
| Redis | Tuesday | 02:00 UTC |

## Compliance Mapping

- **FERPA**: Evidence bucket with WORM retention, audit logs via VPC Flow Logs
- **HIPAA-ready**: Private subnets, CMEK, Cloud Armor, VPC Service Controls (add as needed)
- **SOC 2**: Automated backups, encryption at rest/transit, least-privilege IAM, secret rotation

## Troubleshooting

### Terraform init fails on backend bucket
Ensure the GCS bucket exists:
```bash
gsutil mb -p PROJECT_ID -l us-central1 gs://BUCKET_NAME
```

### Cloud SQL private IP creation fails
The `servicenetworking.googleapis.com` API must be enabled and the VPC peering may take 5–10 minutes on first run.

### GKE Autopilot cluster creation fails
Ensure the Binary Authorization policy exists or change `evaluation_mode` to `DISABLED` in `modules/gke/main.tf` for bootstrapping.

## Outputs

Key outputs after apply:
- `gke_cluster_endpoint` — Cluster control plane endpoint (sensitive)
- `database_connection_string` — PostgreSQL connection string (sensitive)
- `database_instance_connection_name` — For Cloud SQL Auth Proxy
- `redis_host` / `redis_port` — Redis connection details
- `service_account_emails` — Map of service account emails for workload binding
- `storage_bucket_urls` — URLs for all provisioned buckets

## License

Internal use — Lamar University SMEPro Compliance Operating System.
