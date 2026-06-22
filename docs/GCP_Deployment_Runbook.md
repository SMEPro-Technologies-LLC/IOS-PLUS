# GCP Deployment Runbook — SMEPro COS (IOS-Plus)

> **Version:** 1.0  
> **Date:** 2026-06-21  
> **Environment:** Google Cloud Platform (us-central1 primary, us-east4 DR)  
> **Scope:** Staging → Production deployment for Operator NFRD / SMEPro COS v2

---

## Table of Contents

1. [Pre-Requisites](#pre-requisites)
2. [Day 0: Bootstrap](#day-0-bootstrap)
3. [Day 1: Network](#day-1-network)
4. [Day 2: Database](#day-2-database)
5. [Day 3: Cache & Pub/Sub](#day-3-cache--pubsub)
6. [Day 4: Storage & Security](#day-4-storage--security)
7. [Day 5: GKE Cluster](#day-5-gke-cluster)
8. [Day 6: IAM & Cloud Armor](#day-6-iam--cloud-armor)
9. [Day 7: K8s Base](#day-7-k8s-base)
10. [Day 8: Application Deploy](#day-8-application-deploy)
11. [Day 9: Database Integration](#day-9-database-integration)
12. [Day 10: Monitoring](#day-10-monitoring)
13. [Day 11: Smoke Tests](#day-11-smoke-tests)
14. [Day 12: UAT](#day-12-uat)
15. [Day 13: Security Validation](#day-13-security-validation)
16. [Day 14: Go-Live](#day-14-go-live)
17. [Post-Deployment](#post-deployment)

---

## Pre-Requisites

Before Day 0, verify the following are in place:

| # | Item | Verification Command / Check |
|---|------|------------------------------|
| 1 | **GCP Project** | `gcloud projects describe $PROJECT_ID` — active, billing enabled |
| 2 | **Billing Account** | Cloud Console → Billing → verify linked account, no quotas exceeded |
| 3 | **IAM Permissions** | Caller has `roles/owner` or `roles/editor` + `roles/resourcemanager.projectIamAdmin` on project |
| 4 | **Terraform State Bucket** | `gsutil ls gs://$PROJECT_ID-tfstate` — exists, versioning enabled, uniform bucket-level access |
| 5 | **Terraform Version** | `terraform version` ≥ 1.7.0 |
| 6 | **gcloud CLI** | `gcloud version` — authenticated, default project set |
| 7 | **kubectl** | `kubectl version --client` — compatible with GKE 1.29+ |
| 8 | **Cloud Deploy** | `gcloud deploy delivery-pipelines list --region=us-central1` — accessible |
| 9 | **Git Access** | `git ls-remote` to ios-plus repository succeeds |
| 10 | **Secret Values** | `GOOGLE_APPLICATION_CREDENTIALS` or ADC configured; Cloud Build service account has required roles |

### Required IAM Roles for Deployment Service Account

```text
roles/compute.networkAdmin
roles/container.admin
roles/cloudsql.admin
roles/redis.admin
roles/storage.admin
roles/pubsub.admin
roles/secretmanager.admin
roles/cloudkms.admin
roles/monitoring.admin
roles/logging.admin
roles/iam.serviceAccountAdmin
roles/resourcemanager.projectIamAdmin
roles/clouddeploy.admin
roles/servicenetworking.networksAdmin
```

### Environment Variables

```bash
export PROJECT_ID="smpro-cos-lamar-2026"
export REGION="us-central1"
export DR_REGION="us-east4"
export ENV="staging"   # or "production"
export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_environment="$ENV"
```

---

## Day 0: Bootstrap

**Objective:** Create state bucket, enable APIs, configure Workload Identity Federation.

### 0.1 Create Terraform State Bucket

```bash
gsutil mb -p $PROJECT_ID -l $REGION gs://${PROJECT_ID}-tfstate
gsutil versioning set on gs://${PROJECT_ID}-tfstate
gsutil uniformbucketlevelaccess set on gs://${PROJECT_ID}-tfstate
```

**Verification:**

```bash
gsutil ls -Lb gs://${PROJECT_ID}-tfstate | grep -E "gsutil|versioning|uniform"
```

Expected: `Enabled: True` for versioning, `Enabled: True` for uniform access.

### 0.2 Enable GCP APIs

```bash
gcloud services enable --project=$PROJECT_ID \
  compute.googleapis.com \
  container.googleapis.com \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  cloudkms.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com \
  clouddeploy.googleapis.com \
  cloudbuild.googleapis.com \
  servicenetworking.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  vpcaccess.googleapis.com
```

**Verification:**

```bash
gcloud services list --enabled --project=$PROJECT_ID | grep -E "compute|container|sqladmin|redis|storage|pubsub|secretmanager|cloudkms|clouddeploy"
```

Expected: All listed services show `ENABLED`.

### 0.3 Configure Workload Identity Federation (for CI/CD)

```bash
# Create Workload Identity Pool
gcloud iam workload-identity-pools create "github-pool" \
  --project=$PROJECT_ID \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Create Provider for GitHub
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project=$PROJECT_ID \
  --location="global" \
  --workload-identity-pool="github-pool" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow GitHub repo to impersonate Cloud Build service account
gcloud iam service-accounts add-iam-policy-binding \
  "cloudbuild@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project=$PROJECT_ID \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_ID}/locations/global/workloadIdentityPools/github-pool/attribute.repository/OWNER/REPO"
```

**Verification:**

```bash
gcloud iam workload-identity-pools providers describe "github-provider" \
  --project=$PROJECT_ID --location="global" --workload-identity-pool="github-pool"
```

---

## Day 1: Network

**Objective:** Deploy VPC, subnets, NAT, and private service connections.

### 1.1 Terraform Apply — Network Module

```bash
cd ios-plus/infra/terraform
terraform init -backend-config="bucket=${PROJECT_ID}-tfstate" -backend-config="prefix=network"
terraform workspace select $ENV || terraform workspace new $ENV
terraform plan -target=module.network -out=tfplan.network
terraform apply tfplan.network
```

### 1.2 Verification Checklist

| # | Check | Command / Method | Expected Result |
|---|-------|------------------|-----------------|
| 1 | VPC exists | `gcloud compute networks describe vpc-${ENV}` | `autoCreateSubnetworks: false` |
| 2 | Subnets exist | `gcloud compute networks subnets list --network=vpc-${ENV}` | `gke-subnet`, `services-subnet`, `db-subnet` all present |
| 3 | NAT gateway | `gcloud compute routers nats list --router=router-${ENV}` | `nat-gw-${ENV}` with min 2 IPs |
| 4 | Private Google Access | `gcloud compute networks subnets describe gke-subnet --region=$REGION` | `privateIpGoogleAccess: true` |
| 5 | Cloud SQL private service | `gcloud compute addresses list --global --filter="purpose=VPC_PEERING"` | `google-managed-services` range allocated |
| 6 | Firewall rules | `gcloud compute firewall-rules list --filter="network:vpc-${ENV}"` | `allow-internal`, `allow-health-checks`, `deny-ingress-default` present |

**Terraform resources referenced:**
- `google_compute_network.vpc`
- `google_compute_subnetwork.gke`, `google_compute_subnetwork.services`, `google_compute_subnetwork.db`
- `google_compute_router.nat_router`
- `google_compute_router_nat.nat_gw`
- `google_compute_global_address.private_service_access`
- `google_service_networking_connection.private_vpc_connection`
- `google_compute_firewall.allow_internal`, `google_compute_firewall.allow_health_checks`, `google_compute_firewall.deny_ingress_default`

---

## Day 2: Database

**Objective:** Deploy Cloud SQL PostgreSQL 16 HA, run Flyway migrations, verify pgvector.

### 2.1 Terraform Apply — Database Module

```bash
cd ios-plus/infra/terraform
terraform plan -target=module.database -out=tfplan.database
terraform apply tfplan.database
```

### 2.2 Create Cloud SQL Instance

Terraform handles:
- `google_sql_database_instance.primary` (PostgreSQL 16, HA with regional failover)
- `google_sql_database_instance.replica` (read replica in DR region for production)
- `google_sql_database` databases (cos_prod, cos_staging)
- `google_sql_user` (Flyway admin, application user)
- `google_sql_ssl_cert` (client certificates)

### 2.3 Run Flyway Migrations

```bash
# Staging
export DB_HOST=$(gcloud sql instances describe cos-db-${ENV} --format='value(ipAddresses.ipAddress)')
export DB_USER="flyway"
export DB_PASS=$(gcloud secrets versions access latest --secret="db-flyway-password-${ENV}")

flyway -url="jdbc:postgresql://${DB_HOST}:5432/cos_${ENV}" \
       -user="$DB_USER" \
       -password="$DB_PASS" \
       -locations="filesystem:ios-plus/db/migrations" \
       -schemas="module1_canonical,module1_marts,module1_etl,module1_audit,module2_analytics,module2_advisor,module2_registrar,module2_accreditation,module2_faculty,module2_enrollment,module2_compliance_monitor,module3_ai_governance" \
       migrate
```

### 2.4 Verify pgvector Extension

```bash
psql "sslmode=require host=$DB_HOST dbname=cos_${ENV} user=$DB_USER" \
  -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT * FROM pg_extension WHERE extname = 'vector';"
```

Expected: `vector` extension listed with version ≥ 0.7.

### 2.5 Verification Checklist

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Instance running | `gcloud sql instances describe cos-db-${ENV}` | `state: RUNNABLE`, `databaseVersion: POSTGRES_16` |
| 2 | HA enabled | `gcloud sql instances describe cos-db-${ENV}` | `availabilityType: REGIONAL` |
| 3 | Private IP | `gcloud sql instances describe cos-db-${ENV}` | `ipAddress` in `db-subnet` range |
| 4 | SSL enforced | `gcloud sql instances describe cos-db-${ENV}` | `requireSsl: true` |
| 5 | Flyway history | `psql -c "SELECT version, description, installed_on FROM flyway_schema_history ORDER BY installed_on DESC LIMIT 5;"` | V14 and all prior migrations present |
| 6 | pgvector | `psql -c "SELECT extversion FROM pg_extension WHERE extname='vector';"` | `0.7.0` or higher |
| 7 | Module 3 schema | `psql -c "\dn module3*"` | `module3_ai_governance` exists |
| 8 | WORM triggers | `psql -c "SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_worm%';"` | `trg_worm_usage_logs`, `trg_worm_audit` present |

---

## Day 3: Cache & Pub/Sub

**Objective:** Deploy Redis, create Pub/Sub topics and subscriptions.

### 3.1 Terraform Apply — Cache + Pub/Sub Modules

```bash
cd ios-plus/infra/terraform
terraform plan -target=module.cache -target=module.pubsub -out=tfplan.cache_pubsub
terraform apply tfplan.cache_pubsub
```

### 3.2 Verification — Redis (Memorystore)

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Instance exists | `gcloud redis instances describe redis-${ENV} --region=$REGION` | `state: READY` |
| 2 | Tier | `gcloud redis instances describe redis-${ENV}` | `tier: BASIC` (staging) or `STANDARD_HA` (prod) |
| 3 | TLS | `gcloud redis instances describe redis-${ENV}` | `transitEncryptionMode: SERVER_AUTHENTICATION` |
| 4 | Auth | `gcloud redis instances describe redis-${ENV}` | `authEnabled: true` |
| 5 | Connectivity | `redis-cli -h <host> -p 6379 --tls --auth <auth> PING` | `PONG` |

**Terraform resources:** `google_redis_instance.redis`, `google_redis_instance.redis_replica` (prod only)

### 3.3 Verification — Pub/Sub

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Topics exist | `gcloud pubsub topics list --filter="name:cos-${ENV}"` | `etl-jobs`, `audit-events`, `model-usage`, `alert-notifications` |
| 2 | Subscriptions | `gcloud pubsub subscriptions list --filter="topic:cos-${ENV}"` | Dead-letter + push/pull subs per topic |
| 3 | Publish test | `gcloud pubsub topics publish cos-etl-jobs-${ENV} --message='{"test": true}'` | Message ID returned |
| 4 | DLQ configured | `gcloud pubsub subscriptions describe cos-etl-jobs-sub-${ENV}` | `deadLetterPolicy` present |

**Terraform resources:** `google_pubsub_topic.*`, `google_pubsub_subscription.*`, `google_pubsub_topic_iam_member.*`

---

## Day 4: Storage & Security

**Objective:** Deploy Cloud Storage buckets, KMS keys, Secret Manager, and verify encryption.

### 4.1 Terraform Apply — Storage + Security Modules

```bash
cd ios-plus/infra/terraform
terraform plan -target=module.storage -target=module.security -out=tfplan.storage_security
terraform apply tfplan.storage_security
```

### 4.2 Cloud Storage Buckets (6 buckets)

| Bucket | Purpose | Class | Encryption | Retention |
|--------|---------|-------|------------|-----------|
| `cos-${ENV}-evidence` | Evidence records, signed documents | Standard | CMEK | 7 years |
| `cos-${ENV}-etl-raw` | Raw ETL input files | Nearline | CMEK | 90 days |
| `cos-${ENV}-etl-processed` | Processed ETL output | Standard | CMEK | 1 year |
| `cos-${ENV}-backups` | Cloud SQL automated backups | Coldline | CMEK | 30 days |
| `cos-${ENV}-logs` | Application and audit logs | Standard | CMEK | 1 year |
| `cos-${ENV}-artifacts` | CI/CD artifacts, container images | Standard | CMEK | 30 days |

### 4.3 KMS Key Ring and Keys

```bash
gcloud kms keyrings describe cos-keyring --location=$REGION
gcloud kms keys describe cos-storage-enc --keyring=cos-keyring --location=$REGION
gcloud kms keys describe cos-db-enc --keyring=cos-keyring --location=$REGION
gcloud kms keys describe cos-secrets-enc --keyring=cos-keyring --location=$REGION
```

Expected: All keys in `ENABLED` state with `purpose: ENCRYPT_DECRYPT`.

### 4.4 Secret Manager

| Secret | Purpose | Rotation |
|--------|---------|----------|
| `db-flyway-password-${ENV}` | Flyway migration user | 90 days |
| `db-app-password-${ENV}` | Application DB user | 90 days |
| `redis-auth-${ENV}` | Redis AUTH string | 90 days |
| `jwt-signing-key-${ENV}` | Ed25519 private key for evidence | 180 days |
| `api-key-firecrawl-${ENV}` | Firecrawl API key | 90 days |
| `api-key-claude-${ENV}` | Anthropic API key | 90 days |

### 4.5 Bucket Encryption Test

```bash
gsutil cp test-file.txt gs://cos-${ENV}-evidence/
gsutil stat gs://cos-${ENV}-evidence/test-file.txt | grep "encryptionAlgorithm"
# Expected: encryptionAlgorithm: AES256 (or CMEK key reference)
```

---

## Day 5: GKE Cluster

**Objective:** Deploy GKE Autopilot, verify cluster, Workload Identity, node pools.

### 5.1 Terraform Apply — GKE Module

```bash
cd ios-plus/infra/terraform
terraform plan -target=module.gke -out=tfplan.gke
terraform apply tfplan.gke
```

### 5.2 Verification Checklist

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Cluster exists | `gcloud container clusters describe gke-${ENV} --region=$REGION` | `status: RUNNING`, `autopilot: enabled` |
| 2 | Node pools | `gcloud container node-pools list --cluster=gke-${ENV} --region=$REGION` | `default-pool`, `workload-pool` (prod) |
| 3 | Workload Identity | `gcloud container clusters describe gke-${ENV}` | `workloadIdentityConfig` with `workloadPool` |
| 4 | Private cluster | `gcloud container clusters describe gke-${ENV}` | `privateClusterConfig.enablePrivateNodes: true` |
| 5 | Master authorized networks | `gcloud container clusters describe gke-${ENV}` | Bastion / Cloud Build CIDR ranges only |
| 6 | kubectl access | `kubectl get nodes` | Nodes listed, all `Ready` |
| 7 | Pod security | `kubectl get psp` or `kubectl get constraints` | Pod Security Standards `restricted` enforced |
| 8 | Network policies | `kubectl get networkpolicies --all-namespaces` | Default-deny policy in all non-system namespaces |

**Terraform resources:**
- `google_container_cluster.gke_autopilot`
- `google_container_node_pool.workload` (prod only)
- `google_service_account.gke_nodes`
- `google_project_iam_member.gke_workload_identity`

### 5.3 Configure kubectl

```bash
gcloud container clusters get-credentials gke-${ENV} --region=$REGION --project=$PROJECT_ID
kubectl config current-context
```

---

## Day 6: IAM & Cloud Armor

**Objective:** Apply least-privilege IAM, deploy Cloud Armor WAF, verify service accounts.

### 6.1 Terraform Apply — IAM + Cloud Armor Modules

```bash
cd ios-plus/infra/terraform
terraform plan -target=module.iam -target=module.cloud_armor -out=tfplan.iam_waf
terraform apply tfplan.iam_waf
```

### 6.2 Service Accounts

| Service Account | Purpose | IAM Roles | K8s Binding |
|-----------------|---------|-----------|-------------|
| `api-gateway@${PROJECT_ID}.iam.gserviceaccount.com` | API Gateway | `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, `roles/pubsub.publisher` | `api-gateway` namespace |
| `trust-model@${PROJECT_ID}.iam.gserviceaccount.com` | Trust / ML Model | `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, `roles/pubsub.subscriber` | `trust-model` namespace |
| `connector-ingestion@${PROJECT_ID}.iam.gserviceaccount.com` | ETL / Ingestion | `roles/storage.objectAdmin`, `roles/cloudsql.client`, `roles/pubsub.publisher` | `connector-ingestion` namespace |
| `monitoring@${PROJECT_ID}.iam.gserviceaccount.com` | Prometheus / Grafana | `roles/monitoring.metricWriter`, `roles/logging.logWriter` | `monitoring` namespace |

### 6.3 Cloud Armor WAF Rules

| Priority | Rule | Action |
|----------|------|--------|
| 1000 | SQL injection (OWASP CRS 3.3) | Deny(403) |
| 1001 | XSS (OWASP CRS 3.3) | Deny(403) |
| 1002 | LFI/RFI (OWASP CRS 3.3) | Deny(403) |
| 1003 | Rate limit: 100 req/min per IP | Rate-based-ban(60s) |
| 1004 | Geo-block: non-US/CA | Deny(403) |
| 5000 | Default | Allow |

### 6.4 Verification

```bash
# Service account IAM
gcloud iam service-accounts get-iam-policy api-gateway@${PROJECT_ID}.iam.gserviceaccount.com

# Cloud Armor policy
gcloud compute security-policies describe cos-waf-policy-${ENV}

# WAF rule test (should be blocked)
curl -I "https://api.${ENV}.ioscos.com/?id=1' OR '1'='1"
# Expected: HTTP/2 403
```

---

## Day 7: K8s Base

**Objective:** Apply namespaces, network policies, service accounts, Workload Identity bindings.

### 7.1 Apply Base Manifests

```bash
cd ios-plus/infra/k8s/base
kubectl apply -f namespaces.yaml
kubectl apply -f network-policies.yaml
kubectl apply -f service-accounts.yaml
kubectl apply -f workload-identity-bindings.yaml
kubectl apply -f resource-quotas.yaml
kubectl apply -f pod-security-policies.yaml   # or Pod Security Standards
```

### 7.2 Verification Checklist

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Namespaces | `kubectl get namespaces` | `api-gateway`, `trust-model`, `connector-ingestion`, `monitoring`, `staging` (or `production`) |
| 2 | Network policies | `kubectl get networkpolicies --all-namespaces` | Default-deny ingress/egress in each app namespace; explicit allow rules for required flows |
| 3 | Service accounts | `kubectl get serviceaccounts --namespace=api-gateway` | `api-gateway` SA mapped to GCP SA |
| 4 | Workload Identity | `kubectl annotate serviceaccount api-gateway --namespace=api-gateway` | `iam.gke.io/gcp-service-account=api-gateway@...` |
| 5 | Pod test | `kubectl run test --image=google/cloud-sdk:slim --rm -it --namespace=api-gateway -- bash` | `gcloud auth list` shows mapped service account |
| 6 | Resource quotas | `kubectl get resourcequota --namespace=api-gateway` | CPU/memory limits defined, not exceeded |

### 7.3 Key K8s Manifests

```yaml
# namespaces.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: api-gateway
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: v1
kind: Namespace
metadata:
  name: trust-model
  labels:
    pod-security.kubernetes.io/enforce: restricted
---
# ... (additional namespaces)
```

```yaml
# network-policies.yaml — api-gateway default deny + selective allow
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: api-gateway
spec:
  podSelector: {}
  policyTypes:
    - Ingress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-trust-model
  namespace: api-gateway
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: trust-model
      ports:
        - protocol: TCP
          port: 8080
```

---

## Day 8: Application Deploy

**Objective:** Deploy `api-gateway`, `trust-model`, `connector-ingestion` via Cloud Deploy to staging.

### 8.1 Cloud Deploy Pipeline

```bash
gcloud deploy releases create release-$(date +%Y%m%d-%H%M%S) \
  --project=$PROJECT_ID \
  --region=$REGION \
  --delivery-pipeline=cos-pipeline \
  --source=ios-plus/ \
  --images="api-gateway=us-central1-docker.pkg.dev/${PROJECT_ID}/cos/api-gateway:latest,trust-model=us-central1-docker.pkg.dev/${PROJECT_ID}/cos/trust-model:latest,connector-ingestion=us-central1-docker.pkg.dev/${PROJECT_ID}/cos/connector-ingestion:latest"
```

### 8.2 Deploy to Staging

```bash
gcloud deploy targets create staging \
  --project=$PROJECT_ID \
  --region=$REGION \
  --delivery-pipeline=cos-pipeline \
  --gke-cluster=projects/${PROJECT_ID}/locations/${REGION}/clusters/gke-staging

gcloud deploy releases promote --release=release-YYYYMMDD-HHMMSS \
  --delivery-pipeline=cos-pipeline \
  --region=$REGION \
  --to-target=staging
```

### 8.3 Verification Checklist

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Pods running | `kubectl get pods --all-namespaces` | All pods `Running`, 0 `CrashLoopBackOff` |
| 2 | Services | `kubectl get services --namespace=api-gateway` | `api-gateway` service with ClusterIP or LoadBalancer |
| 3 | Ingress | `kubectl get ingress --namespace=api-gateway` | `api-gateway-ingress` with external IP |
| 4 | Cloud Deploy status | `gcloud deploy rollouts list --release=release-YYYYMMDD-HHMMSS --delivery-pipeline=cos-pipeline --region=$REGION` | `SUCCEEDED` |
| 5 | Health endpoint | `curl https://api.staging.ioscos.com/health` | `{"status":"ok"}` |
| 6 | Ready endpoint | `curl https://api.staging.ioscos.com/ready` | `{"status":"ready","checks":{...}}` |

---

## Day 9: Database Integration

**Objective:** Verify Cloud SQL Auth Proxy connectivity, run WORM verification, test data ingestion.

### 9.1 Cloud SQL Auth Proxy

```bash
# Deploy Cloud SQL Auth Proxy as sidecar or standalone
kubectl apply -f ios-plus/infra/k8s/cloud-sql-proxy.yaml

# Verify proxy pod
kubectl get pods --namespace=connector-ingestion | grep cloud-sql-proxy
```

### 9.2 WORM Verification

```bash
# Test that usage_logs cannot be updated
psql -h 127.0.0.1 -p 5432 -U app_user -d cos_staging \
  -c "UPDATE module3_ai_governance.ai_model_usage_logs SET user_id = 'hacker' WHERE log_id = (SELECT log_id FROM module3_ai_governance.ai_model_usage_logs LIMIT 1);"
# Expected: ERROR: WORM_VIOLATION

# Test that audit findings cannot be deleted
psql -h 127.0.0.1 -p 5432 -U app_user -d cos_staging \
  -c "DELETE FROM module3_ai_governance.ai_governance_audit WHERE severity = 'MEDIUM';"
# Expected: ERROR: WORM_VIOLATION

# Test that audit remediation_status CAN be updated (limited WORM)
psql -h 127.0.0.1 -p 5432 -U app_user -d cos_staging \
  -c "UPDATE module3_ai_governance.ai_governance_audit SET remediation_status = 'IN_PROGRESS' WHERE audit_id = 'f1111111-f111-f111-f111-f11111111111';"
# Expected: 1 row updated
```

### 9.3 Data Ingestion Test

```bash
# Trigger ETL job via Pub/Sub
gcloud pubsub topics publish cos-etl-jobs-staging \
  --message='{"job_type": "banner_student_sync", "target_table": "module1_canonical.student_concepts", "dry_run": false}'

# Verify job completion in connector-ingestion logs
kubectl logs -f deployment/connector-ingestion --namespace=connector-ingestion | grep "banner_student_sync"

# Verify data in database
psql -h 127.0.0.1 -p 5432 -U app_user -d cos_staging \
  -c "SELECT COUNT(*) FROM module1_canonical.concept_definitions WHERE concept_namespace = 'student';"
# Expected: > 0 rows
```

---

## Day 10: Monitoring

**Objective:** Deploy Prometheus/Grafana, configure alerts, verify metrics endpoints.

### 10.1 Deploy Monitoring Stack

```bash
cd ios-plus/infra/k8s/monitoring
kubectl apply -f prometheus-namespace.yaml
kubectl apply -f prometheus-rbac.yaml
kubectl apply -f prometheus-configmap.yaml
kubectl apply -f prometheus-deployment.yaml
kubectl apply -f grafana-deployment.yaml
kubectl apply -f grafana-ingress.yaml
kubectl apply -f alertmanager-config.yaml
```

### 10.2 Alerting Rules

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| `HighErrorRate` | `rate(http_requests_total{status=~"5.."}[5m]) > 0.1` | Critical | PagerDuty + Slack |
| `DatabaseConnectionFailed` | `pg_up == 0` | Critical | PagerDuty |
| `WORMViolationAttempt` | `worm_violation_attempts_total > 0` | Critical | Security team + PagerDuty |
| `HighLatency` | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` | Warning | Slack |
| `PodCrashLoop` | `rate(kube_pod_container_status_restarts_total[5m]) > 0` | Warning | Slack |
| `DiskSpaceLow` | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1` | Warning | Slack |
| `CertificateExpiring` | `probe_ssl_earliest_cert_expiry - time() < 86400 * 7` | Warning | Email |
| `ModelRiskScoreHigh` | `max(ai_governance_risk_score) >= 15` | Warning | AI Governance Officer |

### 10.3 Verification Checklist

| # | Check | Command | Expected Result |
|---|-------|---------|-----------------|
| 1 | Prometheus UI | `kubectl port-forward svc/prometheus 9090:9090` | Accessible at `http://localhost:9090` |
| 2 | Grafana | `kubectl get ingress grafana --namespace=monitoring` | External IP with HTTPS |
| 3 | Metrics | `curl http://prometheus:9090/api/v1/query?query=up` | All targets `up` |
| 4 | Alertmanager | `kubectl logs -f deployment/alertmanager --namespace=monitoring` | No errors, alerts firing correctly |
| 5 | Application metrics | `curl http://api-gateway.monitoring.svc.cluster.local:8080/metrics` | Prometheus exposition format |
| 6 | Cloud Monitoring | `gcloud monitoring dashboards list` | COS dashboard present |

---

## Day 11: Smoke Tests

**Objective:** Automated health checks, ready checks, API endpoints, licensure lookup, evidence signing.

### 11.1 Test Script

```bash
#!/bin/bash
set -e
BASE_URL="https://api.staging.ioscos.com"

echo "=== Health Check ==="
curl -sf ${BASE_URL}/health | jq '.status' | grep "ok"

echo "=== Ready Check ==="
curl -sf ${BASE_URL}/ready | jq '.status' | grep "ready"

echo "=== API Endpoints ==="
# Licensure lookup (Module 1)
curl -sf ${BASE_URL}/v1/regulatory/licensure?state=TX | jq '.results[0].state' | grep "TX"

# Student activity (Module 2)
curl -sf -H "Authorization: Bearer ${TEST_TOKEN}" ${BASE_URL}/v2/advisor/students/RED | jq '.students' | grep -q "syn_id"

# AI governance (Module 3)
curl -sf -H "Authorization: Bearer ${TEST_TOKEN}" ${BASE_URL}/v3/governance/models | jq '.models[0].model_name' | grep -q "Copilot"

echo "=== Evidence Signing ==="
# Request evidence signing
RESPONSE=$(curl -sf -X POST -H "Authorization: Bearer ${TEST_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"record_type": "model_approval", "model_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}' \
  ${BASE_URL}/v3/governance/evidence/sign)

SIGNATURE=$(echo $RESPONSE | jq -r '.signature')
[[ "$SIGNATURE" == "sig_*" ]] || exit 1

echo "=== WORM Verification ==="
psql -h ${DB_HOST} -U app_user -d cos_staging -c \
  "SELECT 1 FROM module3_ai_governance.ai_model_usage_logs LIMIT 1;" | grep -q "1"

echo "=== All Smoke Tests Passed ==="
```

### 11.2 Smoke Test Results Checklist

| # | Test | Expected Result | Owner |
|---|------|-------------------|-------|
| 1 | `/health` | `{"status":"ok"}` | SRE |
| 2 | `/ready` | All dependencies `true` | SRE |
| 3 | Licensure lookup | Valid TX licensure record returned | Compliance |
| 4 | Student RED tier | Advisor-authorized RED tier list | Analytics |
| 5 | Model inventory | Microsoft Copilot listed with `limited` risk | AI Governance |
| 6 | Evidence signing | Ed25519 signature returned, verifiable | Security |
| 7 | WORM integrity | Cannot UPDATE/DELETE usage_logs or audit | Database |
| 8 | Pub/Sub ETL | Message published and consumed within 30s | Platform |
| 9 | Redis cache | Key set and retrieved with <10ms latency | Platform |
| 10 | Cloud Armor | SQL injection attempt returns 403 | Security |

---

## Day 12: UAT

**Objective:** Faculty pilot group, end-to-end workflow validation, feedback collection.

### 12.1 Pilot Group

| Role | Count | Focus Area |
|------|-------|------------|
| Faculty Advisor | 5 | Transcript crosswalk, student risk alerts |
| Registrar | 2 | IPEDS / CBM filing workflow, canonical definitions |
| Financial Aid | 2 | FISAP, Title IV disbursement reporting |
| Student (test) | 10 | Self-service dashboard, CoPilot interaction |
| IT Security | 2 | Evidence signing, WORM verification, role-lens access |

### 12.2 UAT Scenarios

| Scenario | Steps | Pass Criteria |
|----------|-------|---------------|
| **S1: Advisor Student View** | Login → Advisor dashboard → Select student → View activity composite → Raise alert | Activity score visible, alert created with evidence record |
| **S2: Transcript Crosswalk** | Login → Registrar portal → Upload transfer transcript → Review NLP match → One-click approve | Confidence score > 0.85, equivalency approved, audit log created |
| **S3: IPEDS Filing** | Login → Module 1 portal → Select Fall Enrollment → Review canonical definitions → Generate XML → Submit | All numbers consistent across definitions, XML validates, submission receipt |
| **S4: AI Governance Query** | Login → AI Governance dashboard → View Copilot controls → Review risk register → Acknowledge policy | All controls visible, risk scores accurate, acknowledgment signed |
| **S5: Evidence Chain** | Perform any regulated action → Request evidence record → Verify signature → Verify immutability | Ed25519 signature valid, WORM prevents tampering |
| **S6: Role-Lens Access** | Login as student → Attempt to access advisor data → Verify 403 | Access denied, audit log of attempted violation |

### 12.3 Feedback Collection

- In-app feedback widget (Formspree or Google Forms)
- Daily standup with pilot group (15 min)
- End-of-UAT survey (Google Forms, 10 questions)
- Issue tracker: GitHub Issues with `uat-feedback` label

### 12.4 UAT Sign-Off Criteria

| Criterion | Threshold |
|-----------|-----------|
| Critical bugs | 0 open |
| High bugs | ≤ 2 with documented workaround |
| Average task completion time | ≤ 5 minutes per scenario |
| User satisfaction (survey) | ≥ 4.0 / 5.0 |
| Evidence signing success rate | 100% |
| WORM integrity test | 100% pass |

---

## Day 13: Security Validation

**Objective:** Snyk scan, Trivy scan, Checkov, basic penetration test.

### 13.1 Snyk (Dependency Vulnerabilities)

```bash
# Install Snyk
npm install -g snyk
snyk auth

# Scan all packages
snyk test --all-projects --severity-threshold=high

# Monitor for new vulnerabilities
snyk monitor --all-projects
```

**Acceptance Criteria:**
- 0 critical vulnerabilities
- ≤ 5 high vulnerabilities with documented remediation plan and SLA
- All medium/low vulnerabilities tracked in backlog

### 13.2 Trivy (Container Image Scan)

```bash
trivy image us-central1-docker.pkg.dev/${PROJECT_ID}/cos/api-gateway:latest
trivy image us-central1-docker.pkg.dev/${PROJECT_ID}/cos/trust-model:latest
trivy image us-central1-docker.pkg.dev/${PROJECT_ID}/cos/connector-ingestion:latest
```

**Acceptance Criteria:**
- 0 CRITICAL vulnerabilities in OS packages
- 0 HIGH vulnerabilities in application dependencies (except false positives with CVE justification)
- Base images updated to latest patched versions within 30 days of release

### 13.3 Checkov (IaC Security)

```bash
checkov -d ios-plus/infra/terraform --framework terraform
checkov -d ios-plus/infra/k8s --framework kubernetes
```

**Acceptance Criteria:**
- 0 CRITICAL / HIGH failed checks in Terraform
- 0 CRITICAL / HIGH failed checks in Kubernetes manifests
- All MEDIUM checks with documented justification or remediation plan

### 13.4 Basic Penetration Test

| Test | Tool | Scope | Expected Result |
|------|------|-------|-----------------|
| SQL injection | sqlmap | All API endpoints with query parameters | No exploitable SQLi |
| XSS | XSStrike | All user input fields | No stored or reflected XSS |
| IDOR | Burp Suite / custom script | Object access endpoints | 403 for unauthorized access, role-lens enforced |
| JWT manipulation | jwt_tool | Evidence signing endpoint | Signature verification fails for tampered tokens |
| Secret exposure | truffleHog | Entire codebase | No committed secrets |
| Bucket enumeration | s3scanner (gcp variant) | All 6 Cloud Storage buckets | No public read/write access |
| SSRF | custom curl | Any endpoint accepting URLs | No internal service access |

### 13.5 Security Sign-Off Checklist

| # | Item | Owner | Status |
|---|------|-------|--------|
| 1 | Snyk scan clean | Security Engineer | |
| 2 | Trivy scan clean | DevOps | |
| 3 | Checkov IaC scan clean | Platform | |
| 4 | Penetration test complete | External / Security | |
| 5 | WORM triggers verified | Database | |
| 6 | Encryption at rest verified (CMEK) | Platform | |
| 7 | Encryption in transit verified (TLS 1.3) | Platform | |
| 8 | IAM least-privilege verified | Security | |
| 9 | RBAC K8s policies verified | Platform | |
| 10 | Incident response runbook reviewed | Security | |

---

## Day 14: Go-Live

**Objective:** Promote to production with canary deployment: 25% → 50% → 75% → 100%.

### 14.1 Pre-Go-Live Checklist

| # | Item | Status |
|---|------|--------|
| 1 | All prior days completed and signed off | |
| 2 | Security validation passed (Day 13) | |
| 3 | UAT sign-off obtained (Day 12) | |
| 4 | Smoke tests pass in production environment (dry run) | |
| 5 | Rollback plan documented and tested | |
| 6 | On-call schedule published | |
| 7 | Incident response runbook printed/accessible | |
| 8 | Executive stakeholders notified | |
| 9 | Maintenance window communicated | |
| 10 | Database backup verified (point-in-time recovery tested) | |

### 14.2 Canary Deployment Plan

| Stage | Traffic % | Duration | Exit Criteria |
|-------|-----------|----------|---------------|
| 1 | 25% | 2 hours | Error rate < 0.1%, p95 latency < 500ms, no Critical alerts |
| 2 | 50% | 4 hours | Error rate < 0.1%, p95 latency < 500ms, no Critical/High alerts |
| 3 | 75% | 4 hours | Error rate < 0.05%, p95 latency < 400ms, all smoke tests pass |
| 4 | 100% | — | Sustained 1 hour at 100% with no alerts |

### 14.3 Cloud Deploy Production Promotion

```bash
# Create production target
gcloud deploy targets create production \
  --project=$PROJECT_ID \
  --region=$REGION \
  --delivery-pipeline=cos-pipeline \
  --gke-cluster=projects/${PROJECT_ID}/locations/${REGION}/clusters/gke-production

# Promote (canary is handled by Cloud Deploy progressive rollout or Argo Rollouts)
gcloud deploy releases promote \
  --release=release-YYYYMMDD-HHMMSS \
  --delivery-pipeline=cos-pipeline \
  --region=$REGION \
  --to-target=production
```

### 14.4 Rollback Procedure

If any stage fails exit criteria:

```bash
# Immediate rollback via Cloud Deploy
gcloud deploy rollouts cancel rollout-YYYYMMDD-HHMMSS \
  --release=release-YYYYMMDD-HHMMSS \
  --delivery-pipeline=cos-pipeline \
  --region=$REGION

# Or revert to previous stable image
kubectl set image deployment/api-gateway \
  api-gateway=us-central1-docker.pkg.dev/${PROJECT_ID}/cos/api-gateway:previous-stable \
  --namespace=api-gateway

# Database rollback (if migration failed)
# Flyway undo is NOT supported for V14; restore from Cloud SQL backup instead
gcloud sql backups restore $(gcloud sql backups list --instance=cos-db-production --format='value(id)' | head -1) \
  --restore-instance=cos-db-production
```

### 14.5 Go-Live Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| AI Governance Officer | | | |
| CISO | | | |
| CTO / CIO | | | |
| Compliance Officer | | | |
| Product Owner (Operator NFRD) | Christopher Miguez | | |

---

## Post-Deployment

### Monitoring & On-Call

| Shift | Hours | Primary | Secondary |
|-------|-------|---------|-----------|
| Business Hours | 08:00–18:00 CT | SRE Lead | Platform Engineer |
| Evenings | 18:00–00:00 CT | On-Call SRE | Platform Engineer |
| Nights | 00:00–08:00 CT | PagerDuty rotation | CTO (escalation) |

### Incident Response Runbook

#### Scenario A: Data Breach
1. **Detect** — Alert from WORM violation, audit log anomaly, or Cloud Armor block
2. **Contain** — Revoke compromised service account keys, isolate affected pods, suspend AI model if involved
3. **Eradicate** — Rotate secrets, patch vulnerability, update WAF rules
4. **Recover** — Restore from verified backup, verify WORM integrity, re-enable services
5. **Notify** — FERPA coordinator (if student data), legal counsel, insurance carrier within 72 hours
6. **Document** — Create evidence record, update risk register, schedule post-incident review

#### Scenario B: System Compromise
1. **Detect** — Unusual API traffic, pod resource spikes, unexpected IAM changes
2. **Contain** — Scale affected deployment to 0 replicas, isolate namespace, revoke Workload Identity bindings
3. **Investigate** — Preserve logs (immutable), capture forensic snapshots, engage external IR team if needed
4. **Remediate** — Rebuild compromised containers from clean base, rotate all credentials, patch CVEs
5. **Recover** — Redeploy from known-good image, verify smoke tests, restore services incrementally

#### Scenario C: Regulatory Change
1. **Monitor** — Subscribe to NIST, EU AI Act, Texas RRC, ONRR update feeds
2. **Assess** — Map new regulation to existing controls, identify gaps within 14 days of announcement
3. **Plan** — Create Jira epic for compliance gap, assign to AI Governance Officer and Compliance Officer
4. **Implement** — Update controls, add new migrations if schema changes required, update evidence records
5. **Validate** — Internal audit of new controls, external audit if required by regulation

### Cost Optimization (Post-30 Days)

1. **Right-size** — Review GKE resource utilization, adjust requests/limits, consolidate underutilized pods
2. **Preemptible workloads** — Move ML training, batch ETL jobs to preemptible nodes (cost reduction ~60%)
3. **Storage lifecycle** — Implement automated bucket policies: raw ETL → Nearline after 30 days → Coldline after 90 days → Delete after 1 year
4. **Billing alerts** — Set up budget alerts at 50%, 80%, and 100% of monthly forecast
5. **Reserved capacity** — Evaluate Committed Use Discounts (CUDs) for Cloud SQL and GKE after 3 months of stable utilization

### Documentation Maintenance

- Update this runbook within 24 hours of any infrastructure change
- Review quarterly for accuracy, updating Terraform resource references and K8s manifest paths
- Version control all changes via Git PR with at least one reviewer

---

*End of GCP Deployment Runbook — SMEPro COS (IOS-Plus)*
