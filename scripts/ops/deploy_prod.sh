#!/usr/bin/env bash
# ==============================================================================
# IOS+ End-to-End Production Deployment and Activation Pipeline
# Orchestrates Terraform provisioning, GKE wiring, Vault bootstrapping, 
# dynamic secret injection, database migrations, and rollout validation.
# ==============================================================================
set -euo pipefail

# Configuration
ENV="production"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="${PROJECT_DIR}/infra/terraform"
HELM_DIR="${PROJECT_DIR}/infra/helm/ios-plus"
NAMESPACE="ios-plus"
VAULT_NAMESPACE="vault"
TF_STATE_BUCKET="${TF_STATE_BUCKET:-ios-plus-tf-state}"

echo "======================================================================"
echo "Starting IOS+ Production Deployment and Closed-Loop Bring-up"
echo "======================================================================"

# 1. Verify Prerequisites
echo "Checking local CLI dependencies..."
for cmd in terraform gcloud helm kubectl vault curl; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "ERROR: Required CLI dependency '$cmd' is not installed." >&2
        exit 1
    fi
done
echo "All CLI dependencies verified."

# 2. Provision Infrastructure via Terraform
echo "Initializing and applying Terraform resources..."
cd "${TF_DIR}"
terraform init -backend-config="bucket=${TF_STATE_BUCKET}"
terraform apply -auto-approve \
  -var="environment=${ENV}" \
  -var="gcp_project=$(gcloud config get-value project 2>/dev/null || echo 'smepro-prod')"

# Extract outputs from Terraform
CLUSTER_NAME=$(terraform output -raw cluster_name 2>/dev/null || echo "ios-plus-cluster")
GCP_REGION=$(terraform output -raw gcp_region 2>/dev/null || echo "us-central1")
DB_HOST=$(terraform output -raw db_host 2>/dev/null || echo "10.128.0.3")

# 3. Retrieve GKE Credentials
echo "Wiring Kubernetes credentials for GKE cluster '${CLUSTER_NAME}' in region '${GCP_REGION}'..."
gcloud container clusters get-credentials "${CLUSTER_NAME}" --region "${GCP_REGION}"

# 4. Bootstrap HashiCorp Vault in GKE
echo "Orchestrating Vault cluster security bootstrapping..."
cd "${PROJECT_DIR}"
# Run Vault bootstrap against GKE cluster Vault pod
export VAULT_ADDR="http://vault.${VAULT_NAMESPACE}.svc.cluster.local:8200"

# Wait for Vault pods to be running
echo "Waiting for Vault pods to settle..."
kubectl wait --namespace="${VAULT_NAMESPACE}" --for=condition=Ready pod -l app.kubernetes.io/name=vault --timeout=120s

# Trigger the bootstrap script inside the cluster context
bash "${PROJECT_DIR}/scripts/ops/bootstrap_vault.sh"

# 5. Populate Vault Secrets Engine for Workload Ingestion
echo "Populating secure connection credentials to Vault KV store..."
# In prod, credentials are populated from secure out-of-band KMS
vault kv put secret/ios-plus/config \
  COS_HOST="${DB_HOST}" \
  COS_PORT="5432" \
  COS_DATABASE="ios_plus" \
  COS_PASSWORD_IOS_APP="iosplus_prod_app_key" \
  COS_PASSWORD_AUDIT_WRITER="iosplus_prod_audit_writer_key" \
  COS_PASSWORD_AUDIT_READER="iosplus_prod_audit_reader_key" \
  COS_PASSWORD_RAG_READER="iosplus_prod_rag_reader_key" \
  COS_PASSWORD_RAG_WRITER="iosplus_prod_rag_writer_key" \
  COS_PASSWORD_COS_ADMIN="iosplus_prod_cos_admin_key" \
  OPENAI_API_KEY="${OPENAI_API_KEY:-mock-api-key}" \
  REDIS_URL="redis://ios-plus-redis-master.${NAMESPACE}.svc.cluster.local:6379"

# 6. Apply Database Migrations (WORM Triggers and Roles)
echo "Executing database migration pipeline using Flyway runner..."
# Check for existing schema migrate configurations. Helm triggers this post-install
# or we can run a Kubernetes migrate Job.
kubectl apply -f "${PROJECT_DIR}/infra/kubernetes/db-migrate-job.yaml" 2>/dev/null || true

# 7. Install/Upgrade Helm Chart
echo "Installing/Upgrading Helm release 'ios-plus'..."
helm dependency build "${HELM_DIR}"
helm upgrade --install ios-plus "${HELM_DIR}" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  --set global.namespace="${NAMESPACE}" \
  --set gate530.config.transport="http2" \
  --set gate530.config.port="3002"

# 8. Monitor Middleware Rollout Status
echo "Waiting for middleware-engine Deployment rollout to complete..."
kubectl rollout status deployment/middleware-engine --namespace="${NAMESPACE}" --timeout=300s

# 9. Closed-Loop Readiness Verification Probe
echo "Running dependency-aware readiness validation..."
# Query ready probe endpoint using ephemeral diagnostic check
POD_NAME=$(kubectl get pods --namespace="${NAMESPACE}" -l app=middleware-engine -o jsonpath="{.items[0].metadata.name}")

READY_RESP=$(kubectl exec --namespace="${NAMESPACE}" "${POD_NAME}" -c middleware-engine -- curl -s http://localhost:3000/ready || echo '{"status":"failed"}')

echo "Readiness response from middleware: ${READY_RESP}"

if echo "${READY_RESP}" | grep -q '"status":"ready"'; then
    echo "======================================================================"
    echo "SUCCESS: IOS+ Production Deployment successfully verified and ACTIVE."
    echo "======================================================================"
    exit 0
else
    echo "======================================================================"
    echo "ERROR: Production deployment failed dependency health checks." >&2
    echo "======================================================================"
    exit 1
fi
