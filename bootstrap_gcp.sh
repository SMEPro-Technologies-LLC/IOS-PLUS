#!/usr/bin/env bash
# bootstrap_gcp.sh — ONE-TIME bootstrap for IOS-PLUS GCP environments.
#
# This is the only thing that should ever be run manually. It creates the
# resources that Terraform itself cannot create (its own state bucket and
# the identity it authenticates with), plus the CMEK key that MUST exist
# before the first Cloud SQL apply (CMEK cannot be retrofitted onto an
# existing instance — ACT-005).
#
# Usage:
#   ./bootstrap_gcp.sh <PROJECT_ID> <ENVIRONMENT>
#   e.g. ./bootstrap_gcp.sh smepro-gc-r1-staging staging
#
# Requires: gcloud authenticated as a project owner/editor, gsutil.
set -euo pipefail

PROJECT_ID="${1:?Usage: bootstrap_gcp.sh <PROJECT_ID> <environment>}"
ENVIRONMENT="${2:?Usage: bootstrap_gcp.sh <PROJECT_ID> <environment>}"

GITHUB_ORG="SMEPro-Technologies-LLC"
GITHUB_REPO="IOS-PLUS"
REGION="us-central1"
STATE_BUCKET="ios-plus-tf-state"          # shared bucket, per-env prefixes
POOL_ID="github"
PROVIDER_ID="ios-plus"
TF_SA_ID="tf-deployer"
DEPLOY_SA_ID="cd-deployer"
KMS_KEYRING="ios-plus-${ENVIRONMENT}"
KMS_KEY="cloudsql-cmek"

PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

echo "==> Project: ${PROJECT_ID} (${PROJECT_NUMBER}) | env: ${ENVIRONMENT}"

# ----------------------------------------------------------------- 1. APIs
echo "==> Enabling required APIs"
gcloud services enable \
  sqladmin.googleapis.com \
  container.googleapis.com \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  secretmanager.googleapis.com \
  cloudkms.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  artifactregistry.googleapis.com \
  --project "${PROJECT_ID}"

# --------------------------------------------------- 2. Terraform state bucket
echo "==> Terraform state bucket"
if ! gsutil ls -b "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  gsutil mb -p "${PROJECT_ID}" -l "${REGION}" -b on "gs://${STATE_BUCKET}"
  gsutil versioning set on "gs://${STATE_BUCKET}"
  gsutil pap set enforced "gs://${STATE_BUCKET}"
  echo "    created gs://${STATE_BUCKET} (versioning on, public access prevented)"
else
  echo "    gs://${STATE_BUCKET} already exists — skipping"
fi

# ------------------------------------------------------- 3. CMEK for Cloud SQL
# Must exist BEFORE the first terraform apply that creates the instance.
echo "==> KMS keyring/key for Cloud SQL CMEK (ACT-005)"
gcloud kms keyrings create "${KMS_KEYRING}" \
  --location "${REGION}" --project "${PROJECT_ID}" 2>/dev/null || true
gcloud kms keys create "${KMS_KEY}" \
  --keyring "${KMS_KEYRING}" --location "${REGION}" \
  --purpose encryption --project "${PROJECT_ID}" 2>/dev/null || true

# Cloud SQL service agent needs encrypt/decrypt on the key. The agent is
# created on demand; force-create it, then bind.
gcloud beta services identity create \
  --service=sqladmin.googleapis.com --project "${PROJECT_ID}" >/dev/null 2>&1 || true
SQL_SA="service-${PROJECT_NUMBER}@gcp-sa-cloud-sql.iam.gserviceaccount.com"
gcloud kms keys add-iam-policy-binding "${KMS_KEY}" \
  --keyring "${KMS_KEYRING}" --location "${REGION}" --project "${PROJECT_ID}" \
  --member "serviceAccount:${SQL_SA}" \
  --role roles/cloudkms.cryptoKeyEncrypterDecrypter >/dev/null
echo "    key: projects/${PROJECT_ID}/locations/${REGION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}"
echo "    -> reference this in main.tf: settings.encryption_key_name (google_sql_database_instance)"

# ------------------------------------------------------ 4. Service accounts
echo "==> Service accounts"
for SA_ID in "${TF_SA_ID}" "${DEPLOY_SA_ID}"; do
  gcloud iam service-accounts create "${SA_ID}" \
    --display-name "IOS-PLUS ${SA_ID} (${ENVIRONMENT})" \
    --project "${PROJECT_ID}" 2>/dev/null || true
done
TF_SA="${TF_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Roles: terraform deployer"
for ROLE in roles/cloudsql.admin roles/container.admin \
            roles/compute.networkAdmin roles/servicenetworking.networksAdmin \
            roles/secretmanager.admin roles/iam.serviceAccountUser \
            roles/cloudkms.viewer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${TF_SA}" --role "${ROLE}" \
    --condition=None --quiet >/dev/null
done
gsutil iam ch "serviceAccount:${TF_SA}:roles/storage.objectAdmin" "gs://${STATE_BUCKET}"

echo "==> Roles: CD deployer (least privilege: deploy, don't administer infra)"
for ROLE in roles/container.developer roles/artifactregistry.reader \
            roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member "serviceAccount:${DEPLOY_SA}" --role "${ROLE}" \
    --condition=None --quiet >/dev/null
done

# ------------------------------------- 5. Workload Identity Federation (OIDC)
echo "==> Workload Identity Federation for GitHub Actions"
gcloud iam workload-identity-pools create "${POOL_ID}" \
  --location global --display-name "GitHub Actions" \
  --project "${PROJECT_ID}" 2>/dev/null || true

# attribute-condition restricts tokens to THIS repository only.
gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
  --location global --workload-identity-pool "${POOL_ID}" \
  --display-name "IOS-PLUS repo" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository == '${GITHUB_ORG}/${GITHUB_REPO}'" \
  --project "${PROJECT_ID}" 2>/dev/null || true

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}"

for SA in "${TF_SA}" "${DEPLOY_SA}"; do
  gcloud iam service-accounts add-iam-policy-binding "${SA}" \
    --member "${PRINCIPAL_SET}" \
    --role roles/iam.workloadIdentityUser \
    --project "${PROJECT_ID}" --quiet >/dev/null
done

# ------------------------------------------------------------ 6. Hand-off
cat <<EOF

============================================================================
Bootstrap complete for ${PROJECT_ID} (${ENVIRONMENT}).

Configure GitHub > Settings > Environments > ${ENVIRONMENT}-infra and
${ENVIRONMENT} with these variables:

  GCP_PROJECT       = ${PROJECT_ID}
  GCP_WIF_PROVIDER  = ${WIF_PROVIDER}
  GCP_TF_SA         = ${TF_SA}
  GCP_DEPLOY_SA     = ${DEPLOY_SA}
  GKE_CLUSTER       = ios-plus-${ENVIRONMENT}
  GKE_LOCATION      = ${REGION}
  APP_NAMESPACE     = ios-plus

Then add to infra/terraform/main.tf on google_sql_database_instance:
  settings { ... }
  encryption_key_name = "projects/${PROJECT_ID}/locations/${REGION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}"

And set required reviewers on the production-infra environment before the
first production apply.

Delete any PRODUCTION_KUBECONFIG / STAGING_KUBECONFIG secrets — they are no
longer used and were the cause of run #7's failure.
============================================================================
EOF
