#!/bin/bash
set -euo pipefail

# Usage: ./deploy_orchestration.sh [preflight|deploy|rollback|verify]
# Environment: KUBECONFIG, HELM_RELEASE, NAMESPACE, VAULT_ADDR, DATABASE_URL

MODE=${1:-deploy}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HELM_CHART="${PROJECT_ROOT}/infra/helm/ios-plus"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/ios-plus-deploy-${TIMESTAMP}.log"

log() { echo "[$(date +%Y-%m-%d\ %H:%M:%S)] $1" | tee -a "$LOG_FILE"; }
error() { echo "[ERROR] $1" | tee -a "$LOG_FILE"; exit 1; }

preflight() {
    log "Running preflight checks..."
    # Check kubectl access
    kubectl cluster-info || error "Cannot access Kubernetes cluster"
    # Check Helm
    helm version || error "Helm not available"
    # Check Vault connectivity
    curl -s "$VAULT_ADDR/v1/sys/health" || error "Vault not reachable"
    # Check database connectivity
    psql "$DATABASE_URL" -c "SELECT 1" || error "Database not reachable"
    # Verify image exists
    # Check values files exist
    [ -f "${HELM_CHART}/values.yaml" ] || error "values.yaml missing"
    [ -f "${HELM_CHART}/values.production.yaml" ] || error "values.production.yaml missing"
    log "Preflight checks passed"
}

deploy() {
    log "Starting deployment..."
    # Run preflight
    preflight
    # Database migration
    log "Running database migrations..."
    npm run db:migrate
    # Schema invariant verification
    log "Verifying schema invariants..."
    npm run db:verify-worm
    # Helm upgrade
    log "Running Helm upgrade..."
    helm upgrade --install "$HELM_RELEASE" "$HELM_CHART" \
        --namespace "$NAMESPACE" --create-namespace \
        --values "${HELM_CHART}/values.yaml" \
        --values "${HELM_CHART}/values.production.yaml" \
        --atomic --timeout 10m --wait \
        --set image.tag="${IMAGE_TAG:-latest}" \
        || error "Helm upgrade failed"
    # Rollout validation
    log "Validating rollout..."
    kubectl rollout status deployment/ios-plus -n "$NAMESPACE" --timeout=5m || error "Rollout failed"
    # Readiness verification
    log "Checking readiness..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=ios-plus -n "$NAMESPACE" --timeout=5m || error "Readiness check failed"
    log "Deployment successful"
}

rollback() {
    log "Starting rollback..."
    helm rollback "$HELM_RELEASE" 0 -n "$NAMESPACE" || error "Rollback failed"
    kubectl rollout status deployment/ios-plus -n "$NAMESPACE" --timeout=5m || error "Rollback rollout failed"
    log "Rollback successful"
}

verify() {
    log "Running post-deployment verification..."
    # Check pods
    kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=ios-plus
    # Check services
    kubectl get svc -n "$NAMESPACE" -l app.kubernetes.io/name=ios-plus
    # Check endpoints
    kubectl get endpoints -n "$NAMESPACE" -l app.kubernetes.io/name=ios-plus
    # Health check
    HEALTH_URL=$(kubectl get svc ios-plus -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}')
    curl -sf "http://${HEALTH_URL}:3001/health" || error "Health check failed"
    # Ready check
    curl -sf "http://${HEALTH_URL}:3001/ready" || error "Ready check failed"
    # Metrics check
    curl -sf "http://${HEALTH_URL}:9090/metrics" | head -5 || error "Metrics check failed"
    log "Verification passed"
}

case "$MODE" in
    preflight) preflight ;;
    deploy) deploy ;;
    rollback) rollback ;;
    verify) verify ;;
    *) echo "Usage: $0 [preflight|deploy|rollback|verify]"; exit 1 ;;
esac
