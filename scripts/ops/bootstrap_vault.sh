#!/usr/bin/env bash
# ==============================================================================
# IOS+ Vault Production Bootstrap Script
# Aligned with enterprise security guidelines and cryptographic signing protocols.
# ==============================================================================
set -euo pipefail

# Configuration Defaults (can be overridden by environment variables)
VAULT_ADDR="${VAULT_ADDR:-https://vault.internal.sme-plus.local:8200}"
K8S_HOST="${K8S_HOST:-https://kubernetes.default.svc.cluster.local:443}"
NAMESPACE="${NAMESPACE:-default}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-ios-plus-sa}"
POLICY_NAME="ios-plus-policy"
POLICY_FILE="infra/vault/ios-plus-policy.hcl"
ROLE_NAME="ios-plus-role"
KEY_NAME="ios-evidence-signing"

echo "=== Beginning IOS+ Production Vault Bootstrap ==="
echo "Vault Address: ${VAULT_ADDR}"
echo "Target Kubernetes SA: ${SERVICE_ACCOUNT} (Namespace: ${NAMESPACE})"

# 1. Verify Prerequisites
if ! command -v vault &> /dev/null; then
    echo "ERROR: 'vault' CLI tool is not installed or not in PATH." >&2
    exit 1
fi

export VAULT_ADDR

# 2. Check Vault Status
echo "Checking Vault server connection..."
if ! vault status &> /dev/null; then
    # vault status exits non-zero if sealed or unavailable. Let's inspect details.
    VAULT_SEALED=$(vault status -format=json 2>/dev/null | grep -o '"sealed":[^,]*' | cut -d: -f2 || echo "true")
    if [ "$VAULT_SEALED" = "true" ]; then
        echo "WARNING: Vault is sealed. Please unseal Vault to complete bootstrapping." >&2
    else
        echo "ERROR: Unable to connect to Vault at ${VAULT_ADDR}." >&2
        exit 1
    fi
fi

# 3. Mount Transit Secrets Engine if not already mounted
echo "Checking Transit secrets engine..."
if ! vault secrets list 2>/dev/null | grep -q "^transit/"; then
    echo "Enabling Transit secrets engine..."
    vault secrets enable transit
else
    echo "Transit secrets engine is already enabled."
fi

# 4. Create the Transit Signing Key (Ed25519 type)
echo "Configuring transit key '${KEY_NAME}'..."
# Check if key exists
if ! vault read "transit/keys/${KEY_NAME}" &> /dev/null; then
    echo "Creating Ed25519 signing key '${KEY_NAME}'..."
    vault write -f "transit/keys/${KEY_NAME}" type="ed25519"
else
    echo "Transit signing key '${KEY_NAME}' already exists."
fi

# 5. Apply the Least-Privilege Policy
echo "Applying Vault security policy '${POLICY_NAME}'..."
if [ ! -f "${POLICY_FILE}" ]; then
    # Fallback to checking from root directory if run from within scripts/ops
    if [ -f "../../${POLICY_FILE}" ]; then
        POLICY_FILE="../../${POLICY_FILE}"
    else
        echo "ERROR: Policy HCL file not found at ${POLICY_FILE}." >&2
        exit 1
    fi
fi
vault policy write "${POLICY_NAME}" "${POLICY_FILE}"

# 6. Enable Kubernetes Auth Method
echo "Checking Kubernetes auth method..."
if ! vault auth list 2>/dev/null | grep -q "^kubernetes/"; then
    echo "Enabling Kubernetes auth method..."
    vault auth enable kubernetes
else
    echo "Kubernetes auth method is already enabled."
fi

# 7. Configure Kubernetes auth connection settings
# Note: Typically executed within the target Kubernetes cluster where token/certs are auto-mounted.
# In localized validation, we read local serviceaccount secrets.
echo "Configuring Kubernetes auth client..."
SA_JWT_TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token 2>/dev/null || echo "LOCAL_MOCK_TOKEN")
SA_CA_CRT=$(cat /var/run/secrets/kubernetes.io/serviceaccount/ca.crt 2>/dev/null || echo "LOCAL_MOCK_CRT")

if [ "$SA_JWT_TOKEN" = "LOCAL_MOCK_TOKEN" ]; then
    echo "Notice: Standard cluster serviceaccount tokens not detected. Skipping native token write."
else
    vault write auth/kubernetes/config \
        kubernetes_host="${K8S_HOST}" \
        kubernetes_ca_cert="${SA_CA_CRT}" \
        token_reviewer_jwt="${SA_JWT_TOKEN}"
fi

# 8. Create role linking Kubernetes service account to policy
echo "Binding policy '${POLICY_NAME}' to role '${ROLE_NAME}' for SA '${SERVICE_ACCOUNT}'..."
vault write "auth/kubernetes/role/${ROLE_NAME}" \
    bound_service_account_names="${SERVICE_ACCOUNT}" \
    bound_service_account_namespaces="${NAMESPACE}" \
    policies="${POLICY_NAME}" \
    ttl="1h"

echo "=== Vault Production Bootstrapping Completed Successfully ==="
