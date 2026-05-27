# IOS+ Operator Deployment Guide

This guide is intended for operators deploying and validating IOS+ in a staging or production-oriented Kubernetes environment.

It focuses on deployment prerequisites, infrastructure bring-up, Vault bootstrap, secret population, database migration verification, Helm deployment, and operational validation.

---

## 1. Deployment Prerequisites

### Required CLI tools

Ensure the following tools are installed and available on your PATH:

- `kubectl`
- `helm`
- `terraform`
- `vault`
- `psql`
- `python3`
- `curl`

### Required access

Operators should have access to:

- GKE cluster credentials
- Cloud SQL access
- Vault bootstrap / policy administration permissions
- DNS provider permissions (AWS Route53 and/or GCP Cloud DNS, depending on deployment mode)
- Kubernetes namespace and workload deployment permissions

### Common environment variables

The exact values vary by environment, but operators should expect to configure or validate:

```bash
export VAULT_ADDR="https://<vault-address>:8200"
export NAMESPACE="ios-plus"
export SERVICE_ACCOUNT="ios-plus-sa"
export POLICY_NAME="ios-plus-policy"
export POLICY_FILE="infra/vault/ios-plus-policy.hcl"
export ROLE_NAME="ios-plus-role"
export KEY_NAME="ios-evidence-signing-production"
export DNS_PROVIDER="gcp"   # or aws
export ROUTE53_ZONE_ID="<aws-zone-id>"   # if using AWS Route53
```

Additional runtime configuration is expected to be supplied through Vault-projected secret files, especially `/vault/secrets/ios-plus.env`.

---

## 2. Infrastructure Bring-Up

Terraform assets for the environment are located in:

```text
infra/terraform/
```

### Initialize Terraform

```bash
cd infra/terraform
terraform init
```

### Review the plan

```bash
terraform plan
```

### Apply infrastructure

```bash
terraform apply
```

### Expected infrastructure outputs / target state

The Terraform configuration is intended to provision:

- a GKE cluster,
- private networking,
- node pools,
- Cloud SQL for COS+,
- Helm-managed Vault,
- and the IOS+ Helm release foundation.

### Post-apply verification checklist

After `terraform apply`, verify:

```bash
kubectl get nodes
kubectl get ns
kubectl get pods -A
```

Check that:

- the cluster is reachable,
- node pools are healthy,
- required namespaces exist,
- and supporting pods are starting successfully.

For Cloud SQL, validate connectivity using the appropriate operator path or application verification jobs once secrets are configured.

---

## 3. Vault Bootstrap

Vault bootstrap automation is provided by:

```bash
./scripts/ops/bootstrap_vault.sh
```

### Run Vault bootstrap

```bash
./scripts/ops/bootstrap_vault.sh
```

### What the bootstrap script is intended to configure

- transit secrets engine enablement
- optional KV secrets engine enablement at `secret/`
- Ed25519 signing key creation
- least-privilege policy application
- Kubernetes auth enablement
- Kubernetes auth client configuration
- service-account role binding

### Validate Vault bootstrap

Suggested checks:

```bash
vault secrets list
vault read transit/keys/$KEY_NAME
vault policy read "$POLICY_NAME"
vault auth list
vault read auth/kubernetes/role/$ROLE_NAME
```

### Expected validation outcome

Operators should confirm that:

- `transit/` is mounted
- `secret/` is mounted when KV is required
- the signing key exists
- the IOS+ policy is present
- Kubernetes auth is enabled
- the configured service account is bound to the expected policy

---

## 4. Secret Population

The repository expects runtime configuration to be available through Vault-projected secret files.

### Expected Vault KV structure

A common path used in the repo is:

```text
secret/data/ios-plus/config
```

### Example categories of secret/config values

Depending on deployment mode, operators should expect to populate values such as:

- `COS_HOST`
- `COS_PORT`
- `COS_DATABASE`
- `COS_PASSWORD_IOS_APP`
- `COS_PASSWORD_AUDIT_WRITER`
- `COS_PASSWORD_AUDIT_READER`
- `COS_PASSWORD_RAG_READER`
- `COS_PASSWORD_RAG_WRITER`
- `COS_PASSWORD_COS_ADMIN`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `VAULT_TRANSIT_KEY_PATH`
- `SIGNING_KEY_DNS_ZONE`
- `SIGNING_KEY_ACTIVE_ID`
- `TENANT_ID`
- `DNS_TXT_ZONE`

### Validate Vault secret projection inside pods

Once workloads are deployed, confirm the projected file exists:

```bash
kubectl exec -n ios-plus <pod-name> -c middleware-engine -- ls -l /vault/secrets
kubectl exec -n ios-plus <pod-name> -c middleware-engine -- sh -c 'test -s /vault/secrets/ios-plus.env && echo OK'
```

### Expected outcome

Operators should confirm:

- `/vault/secrets/ios-plus.env` exists
- the file is non-empty
- critical keys are present
- no production workload is depending on dev fallback credentials

---

## 5. Database Migration and Invariant Verification

Database migration orchestration is defined in:

```text
infra/kubernetes/db-migrate-job.yaml
```

Standalone invariants verification is provided by:

```text
scripts/db/verify_db_invariants.py
```

### Apply the migration job manually

```bash
kubectl apply -f infra/kubernetes/db-migrate-job.yaml -n ios-plus
kubectl wait --for=condition=complete job/db-migrate -n ios-plus --timeout=180s
```

### Inspect job logs

```bash
kubectl logs job/db-migrate -n ios-plus --all-containers=true
```

### Run standalone DB invariant verification (optional/manual)

From an environment with the required credentials available:

```bash
python3 scripts/db/verify_db_invariants.py
```

### Expected pass criteria

The migration and verification flow should confirm:

- required schema objects exist
- WORM triggers are active
- required least-privilege DB roles exist
- post-migration verification does not report fatal invariant failures

If any invariant check fails, deployment should be treated as blocked.

---

## 6. Helm Deployment

The primary chart is located at:

```text
infra/helm/ios-plus/
```

### Deploy or upgrade the release

```bash
helm upgrade --install ios-plus infra/helm/ios-plus \
  --namespace ios-plus --create-namespace \
  --values infra/helm/ios-plus/values.yaml \
  --values infra/helm/ios-plus/values.production.yaml \
  --atomic --timeout 10m --wait
```

### What the chart is intended to deploy

Depending on values and environment:

- middleware-engine
- gate-530 sidecar/workload configuration
- evidence/rag/cos-plus related workload templates
- cronjobs for operational checks and publication
- shared service accounts and Kubernetes resources

### Verify rollout state

```bash
kubectl get pods -n ios-plus
kubectl rollout status deployment/middleware-engine -n ios-plus
```

### Expected outcome

Operators should verify:

- pods enter `Running` state
- readiness succeeds
- no crash loops are present
- Vault secret projection is functioning
- workload logs do not show missing-secret or startup-fatal errors

---

## 7. Readiness, Health, and Metrics Validation

### Health endpoints

The middleware service exposes:

- `/health` — liveness
- `/ready` — dependency-aware readiness
- `/metrics` — Prometheus-compatible metrics output

### Validate inside the pod

```bash
kubectl exec -n ios-plus <pod-name> -c middleware-engine -- curl -s http://localhost:3000/health
kubectl exec -n ios-plus <pod-name> -c middleware-engine -- curl -s http://localhost:3000/ready
kubectl exec -n ios-plus <pod-name> -c middleware-engine -- curl -s http://localhost:3000/metrics
```

### Expected readiness behavior

The `/ready` endpoint is expected to evaluate dependency classes such as:

- database connectivity
- Redis connectivity
- Gate 530 connectivity
- Vault system health
- Vault secret projection presence/freshness
- OpenAI credential/egress posture

A healthy deployment should return a `ready` state. A degraded deployment should be investigated before promotion.

---

## 8. Key Consistency and Merkle Publication Validation

### Key consistency verification

The operator can run:

```bash
python3 scripts/ops/verify_key_publication_consistency.py
```

This checks the active key across:

- COS+ database
- DNS TXT record
- deployment filesystem path

### Merkle root publication validation

The operator can run:

```bash
python3 scripts/ops/verify_merkle_root.py
```

This computes and attempts to publish a Merkle root for evidence packages.

### Expected outcome

Operators should confirm:

- no production fallback credential paths are taken
- DNS publication succeeds for the configured provider
- key consistency checks return `PASS`
- publication jobs do not drift from DB state

---

## 9. Closed-Loop Release Orchestration

A deployment helper exists at:

```bash
./scripts/ops/deploy_orchestration.sh
```

### Run the orchestrator

```bash
./scripts/ops/deploy_orchestration.sh
```

### Intended orchestration flow

The script is intended to automate:

- CLI/tool preflight checks
- service account preflight checks
- DB migration job execution
- invariants verification through the migration flow
- Helm release upgrade
- rollout validation
- readiness verification
- automatic rollback on failed health outcome

### Expected operator result

A successful run should end with:

- migration completion
- successful rollout
- `/ready` returning healthy
- no automatic rollback triggered

If rollout or readiness fails, operators should inspect logs and validate whether rollback restored the prior stable release.

---

## 10. Alerting and Monitoring Validation

Prometheus alert rules are defined in:

```text
infra/monitoring/alert_rules.yaml
```

These rules are intended to alert on conditions such as:

- DB pool saturation
- Redis connection failures
- Vault signing failures
- Route53 publication failure streaks
- Gate 530 fail-closed communication storms

### Validate alert configuration

Operators should review and apply these rules in the target monitoring stack and ensure:

- metrics are scraped from the middleware workload
- labels and selectors align with the cluster monitoring setup
- alert routing is connected to the operational notification path

---

## 11. Disaster Recovery and Restore Readiness

If a DR runbook exists in your deployment branch or environment documentation, operators should validate:

- Cloud SQL PITR procedures
- expected RTO / RPO targets
- post-restore schema verification
- Vault recovery or reconfiguration expectations
- key consistency verification after restore

At minimum, a recovery drill should include:

1. restore to a known point in time
2. reconnect application services
3. run post-restore verification
4. validate readiness and invariants
5. confirm key publication and audit verification paths still hold

---

## 12. Final Operator Promotion Checklist

Before promoting a staging environment toward production, confirm:

- infrastructure apply completed successfully
- Vault bootstrap completed successfully
- runtime secrets are present through Vault projection
- migration job completed successfully
- DB invariant verification passed
- middleware rollout succeeded
- `/ready` returns healthy
- `/metrics` is exposed and scraped
- alert rules are loaded into the monitoring stack
- key consistency verification passes
- Merkle publication verification passes
- rollback behavior has been tested
- any required DR validation has been completed

---

## Notes

This repository includes substantial deployment and operations scaffolding, but production activation still depends on correct target-environment provisioning, secret population, DNS configuration, and live verification.

Operators should treat this guide as a deployment companion to the main repository README and adapt commands to their environment-specific controls and credentials.
