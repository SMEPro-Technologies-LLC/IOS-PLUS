# IOS+ GitHub Actions — Secrets & Setup Guide

## Required Repository Secrets

Configure the following secrets in **Settings → Secrets and variables → Actions** for the `ios-plus` repository.

| Secret | Description | Example |
|--------|-------------|---------|
| `GCP_PROJECT_ID` | Google Cloud project ID | `ios-plus-prod-123456` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Federation provider URI | `projects/123456789/locations/global/workloadIdentityPools/gh-pool/providers/gh-provider` |
| `GCP_SERVICE_ACCOUNT` | Service account email for CI/CD | `github-actions@ios-plus-prod-123456.iam.gserviceaccount.com` |
| `GCP_REGION` | Primary GCP region | `us-central1` |
| `GAR_REPOSITORY` | Artifact Registry repository name | `ios-plus-artifacts` |
| `SNYK_TOKEN` | Snyk API token for dependency scanning | *(from Snyk dashboard)* |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook for notifications | *(optional)* |
| `STAGING_DATABASE_URL` | PostgreSQL connection string for staging smoke tests | `postgresql://user:pass@host:5432/db` |
| `PROD_DATABASE_URL` | PostgreSQL connection string for production smoke tests | `postgresql://user:pass@host:5432/db` |
| `GCP_CLOUDSQL_SA_KEY` | Cloud SQL service account key JSON for audit job | *(JSON key for Cloud SQL Auth Proxy)* |

---

## 1. Workload Identity Federation (WIF) Setup

**No exported service account keys.** Use Workload Identity Federation to allow GitHub Actions to authenticate to GCP without long-lived credentials.

### Step 1: Create the Workload Identity Pool

```bash
gcloud iam workload-identity-pools create "gh-pool" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"
```

### Step 2: Create the WIF Provider

```bash
gcloud iam workload-identity-pools providers create-oidc "gh-provider" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="gh-pool" \
  --display-name="GitHub Actions Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --allowed-audiences="https://github.com/${GITHUB_ORG}"
```

### Step 3: Create a Service Account for CI/CD

```bash
# Create the service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions CI/CD" \
  --project="${GCP_PROJECT_ID}"

# Allow the WIF provider to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${GCP_PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/gh-pool/attribute.repository/${GITHUB_ORG}/ios-plus"
```

### Step 4: Grant Required IAM Roles

```bash
SA="github-actions@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

# Cloud Deploy
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SA}" --role="roles/clouddeploy.operator"

# Artifact Registry
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SA}" --role="roles/artifactregistry.writer"

# GKE (for kubectl operations)
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SA}" --role="roles/container.developer"

# Cloud Storage (for audit artifacts)
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"

# Cloud SQL (for audit Cloud SQL Auth Proxy)
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${SA}" --role="roles/cloudsql.client"
```

### Step 5: Store the WIF Provider URI in Secrets

Get the provider URI:

```bash
gcloud iam workload-identity-pools providers describe "gh-provider" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="gh-pool" \
  --format="value(name)"
```

Store the output as `GCP_WORKLOAD_IDENTITY_PROVIDER` in GitHub Secrets.

---

## 2. Cloud Deploy Pipeline Configuration

### Step 1: Create the Delivery Pipeline

```bash
gcloud deploy apply \
  --file=ios-plus/infra/cloud-deploy/clouddeploy.yaml \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}"
```

### Step 2: Create the Targets

```bash
# Staging target
gcloud deploy apply \
  --file=ios-plus/infra/cloud-deploy/staging-target.yaml \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}"

# Production target
gcloud deploy apply \
  --file=ios-plus/infra/cloud-deploy/production-target.yaml \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}"
```

### Step 3: Verify Pipeline

```bash
gcloud deploy delivery-pipelines describe ios-plus-pipeline \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}"
```

---

## 3. Terraform State Bucket Setup

### Step 1: Create the GCS Bucket for Terraform State

```bash
BUCKET_NAME="${GCP_PROJECT_ID}-tfstate"

# Create the bucket (use the same region as the project)
gsutil mb -p "${GCP_PROJECT_ID}" -l "${GCP_REGION}" -b on "gs://${BUCKET_NAME}"

# Enable versioning for state recovery
gsutil versioning set on "gs://${BUCKET_NAME}"

# Restrict public access
gsutil uniformbucketlevelaccess set on "gs://${BUCKET_NAME}"
```

### Step 2: Configure Terraform Backend

In `ios-plus/infra/terraform/backend.tf`:

```hcl
terraform {
  backend "gcs" {
    bucket = "<YOUR_PROJECT_ID>-tfstate"
    prefix = "terraform/ios-plus/state"
  }
}
```

### Step 3: Grant Terraform Service Account Access

```bash
# Grant the CI/CD service account access to the state bucket
gsutil iam ch "serviceAccount:${SA}:roles/storage.objectAdmin" "gs://${BUCKET_NAME}"
```

---

## 4. Artifact Registry Setup

```bash
# Create the Docker repository in Artifact Registry
gcloud artifacts repositories create "${GAR_REPOSITORY}" \
  --repository-format=docker \
  --location="${GCP_REGION}" \
  --description="IOS+ container images" \
  --project="${GCP_PROJECT_ID}"

# Grant the CI/CD service account write access
gcloud artifacts repositories add-iam-policy-binding "${GAR_REPOSITORY}" \
  --location="${GCP_REGION}" \
  --member="serviceAccount:${SA}" \
  --role="roles/artifactregistry.writer" \
  --project="${GCP_PROJECT_ID}"
```

---

## 5. Cloud SQL (Audit) Setup

For the audit workflow, create a Cloud SQL instance for test isolation:

```bash
# Create a PostgreSQL instance for audit testing
gcloud sql instances create ios-plus-audit \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}" \
  --storage-size=10GB \
  --no-backup

# Create a database
gcloud sql databases create ios_plus_audit \
  --instance=ios-plus-audit \
  --project="${GCP_PROJECT_ID}"

# Create a user
gcloud sql users create audit_user \
  --instance=ios-plus-audit \
  --password="$(openssl rand -base64 32)" \
  --project="${GCP_PROJECT_ID}"
```

Store the connection details and credentials in the appropriate secrets.

---

## 6. K8s Namespace & RBAC for Audit

Create the service account and RBAC for the audit job in the staging cluster:

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ios-plus-audit-sa
  namespace: ios-plus-audit
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ios-plus-audit-role
  namespace: ios-plus-audit
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ios-plus-audit-binding
  namespace: ios-plus-audit
subjects:
  - kind: ServiceAccount
    name: ios-plus-audit-sa
    namespace: ios-plus-audit
roleRef:
  kind: Role
  name: ios-plus-audit-role
  apiGroup: rbac.authorization.k8s.io
EOF
```

---

## 7. Workflow Triggers Summary

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci-gcp.yml` | Push to `main`/`develop`, PR to `main` | Lint, test, security scan, build & push image |
| `cd-gcp.yml` | `workflow_dispatch` (env choice), tags `v*` | Deploy to staging or production with canary |
| `audit-gcp.yml` | Weekly cron (`0 6 * * 1`), `workflow_dispatch` | Clean-room audit with coverage gate |

---

## 8. Troubleshooting

### WIF Authentication Failures
- Ensure the `workload_identity_provider` secret matches the full provider resource name (`projects/.../locations/.../workloadIdentityPools/.../providers/...`).
- Verify the repository attribute binding matches exactly: `attribute.repository=<org>/ios-plus`.
- Check that the GitHub Actions job has `permissions: id-token: write`.

### Cloud Deploy Promotion Failures
- Ensure the service account has `roles/clouddeploy.operator`.
- Verify the GKE clusters exist and the CI/CD service account has `roles/container.developer`.
- Check that the `skaffold.yaml` path is correct relative to the Cloud Deploy source directory.

### Coverage Gate Failures
- The audit workflow parses `lcov.info` line coverage. If using a different format, adjust the extraction logic in `audit-gcp.yml`.
- Ensure `npm run test:coverage` outputs to `./coverage/lcov.info`.

### Image Push Failures
- Verify the Artifact Registry repository exists and the service account has `roles/artifactregistry.writer`.
- Ensure `gcloud auth configure-docker` is run before `docker push`.
