#!/usr/bin/env bash
# ============================================================
# IOS+ Production Release & Deployment Orchestrator
# Closed-loop promotion pipeline (P0.5 Release Orchestration)
# SMEPro Technologies — Confidential
# ============================================================

set -euo pipefail

NAMESPACE="ios-plus"
RELEASE_NAME="ios-plus"
MIGRATE_JOB_NAME="db-migrate"

echo "============================================================"
echo "Starting IOS+ Closed-Loop Production Release Deployment"
echo "============================================================"

# 1. Environment Preflight Checks
echo "--- Step 1: Tool Preflight Checks ---"
for cmd in kubectl helm curl; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERROR: Required CLI tool '$cmd' is not installed." >&2
    exit 1
  fi
done
echo "All CLI tools verified."

# 2. Vault Secrets Ingestion Preflight
echo "--- Step 2: Ingesting Secret Gating Checks ---"
if ! kubectl get serviceaccount ios-plus-sa -n "$NAMESPACE" &> /dev/null; then
  echo "ERROR: Service account 'ios-plus-sa' not configured in GKE cluster." >&2
  exit 1
fi
echo "GKE Service Account checks passed."

# 3. DB Migration Trigger
echo "--- Step 3: Triggering DB Migration Job ---"
# Clean up any existing migration job
kubectl delete job "$MIGRATE_JOB_NAME" -n "$NAMESPACE" --ignore-not-found=true

# Apply migration job
kubectl apply -f infra/kubernetes/db-migrate-job.yaml -n "$NAMESPACE"

# Wait for Job to start and complete (timeout: 180s)
echo "Waiting for DB migration job to complete..."
if ! kubectl wait --for=condition=complete job/"$MIGRATE_JOB_NAME" -n "$NAMESPACE" --timeout=180s; then
  echo "ERROR: DB migration job failed or timed out. Fetching logs..." >&2
  kubectl logs job/"$MIGRATE_JOB_NAME" -n "$NAMESPACE" --all-containers=true || true
  exit 1
fi
echo "Database migration and invariants verification completed successfully."

# 4. App Upgrade Deployment
echo "--- Step 4: Upgrading Helm Release ---"
HELM_UPGRADE_CMD="helm upgrade --install $RELEASE_NAME infra/helm/ios-plus \
  --namespace $NAMESPACE \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --set global.namespace=$NAMESPACE"

echo "Executing: $HELM_UPGRADE_CMD"
if ! eval "$HELM_UPGRADE_CMD"; then
  echo "ERROR: Helm upgrade failed." >&2
  exit 1
fi

# 5. Rollout Validation
echo "--- Step 5: Validating Deployment Rollout ---"
if ! kubectl rollout status deployment/middleware-engine -n "$NAMESPACE" --timeout=120s; then
  echo "ERROR: Rollout of middleware-engine failed or timed out. Initiating Rollback!" >&2
  
  # Trigger Rollback
  echo "Rolling back to previous revision..."
  helm rollback "$RELEASE_NAME" -n "$NAMESPACE"
  
  echo "Rollback completed. Restored last stable release configuration."
  exit 1
fi

# 6. Post-Deployment Verification Health Check
echo "--- Step 6: Post-Deploy Health Check ---"
SERVICE_URL="http://middleware-engine.$NAMESPACE.svc.cluster.local:3000/ready"
echo "Querying readiness endpoint: $SERVICE_URL"

# Simulate cluster service check from a runner pod or check external ingress if configured
# In standard GKE pipeline we fetch metrics or query port forwarding for verification:
# Here we verify the pod-level endpoints via kubectl exec or port forwarding:
POD_NAME=$(kubectl get pods -l app=middleware-engine -n "$NAMESPACE" -o jsonpath="{.items[0].metadata.name}")

echo "Verifying `/ready` endpoint inside pod $POD_NAME..."
READY_RESPONSE=$(kubectl exec "$POD_NAME" -n "$NAMESPACE" -c middleware-engine -- curl -s http://localhost:3000/ready || echo '{"status":"failed"}')

echo "Readiness payload: $READY_RESPONSE"
if echo "$READY_RESPONSE" | grep -q '"status":"ready"'; then
  echo "SUCCESS: Post-deploy readiness verification checks passed."
  echo "Release completed successfully."
  exit 0
else
  echo "ERROR: Readiness check returned degraded status! Initiating rollback..." >&2
  helm rollback "$RELEASE_NAME" -n "$NAMESPACE"
  exit 1
fi
