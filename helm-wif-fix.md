# helm-wif-fix.md
# Templated Helm values fix — Workload Identity annotation
#
# Replaces the commented-out placeholder:
#   # iam.gke.io/gcp-service-account: ios-plus-sa@YOUR_GCP_PROJECT.iam.gserviceaccount.com
#
# Design: the project ID enters each environment in exactly ONE place — the
# CI workflow's `--set gcpProject=${{ vars.GCP_PROJECT }}` (see cd-deploy.yml).
# Values files never hardcode a project; templates derive everything from it.

---

## 1. infra/helm/ios-plus/templates/serviceaccount.yaml

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ .Values.serviceAccount.name | default "ios-plus-sa" }}
  labels:
    {{- include "ios-plus.labels" . | nindent 4 }}
  {{- if .Values.gcpProject }}
  annotations:
    iam.gke.io/gcp-service-account: "{{ .Values.serviceAccount.gsaName | default "ios-plus-sa" }}@{{ required "gcpProject must be set (CI passes --set gcpProject=...)" .Values.gcpProject }}.iam.gserviceaccount.com"
    {{- with .Values.serviceAccount.extraAnnotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
  {{- end }}
```

The `required` function makes a missing project a hard template failure with
a readable message — a deploy can no longer silently ship the placeholder.

---

## 2. infra/helm/ios-plus/values.yaml  (defaults — no project anywhere)

```yaml
# Supplied by CI: --set gcpProject=<project-id>. Never hardcode here.
gcpProject: ""

serviceAccount:
  name: ios-plus-sa        # Kubernetes ServiceAccount name
  gsaName: ios-plus-sa     # Google Service Account short name (no domain)
  extraAnnotations: {}
```

---

## 3. infra/helm/ios-plus/values-staging.yaml / values-production.yaml

Remove any commented-out WIF annotation lines entirely. Environment values
files should carry only genuinely environment-specific config (replicas,
resources, hostnames). Example production file:

```yaml
replicaCount: 3

resources:
  requests: { cpu: 500m, memory: 512Mi }
  limits:   { cpu: "2",  memory: 2Gi }

# gcpProject intentionally absent — injected by cd-deploy.yml from
# the production GitHub Environment's GCP_PROJECT variable.
```

---

## 4. One-time GCP side binding (per environment)

Workload Identity also requires the binding between the Kubernetes SA and
the Google SA (the annotation alone does nothing without it):

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "ios-plus-sa@${GCP_PROJECT}.iam.gserviceaccount.com" \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:${GCP_PROJECT}.svc.id.goog[ios-plus/ios-plus-sa]" \
  --project "${GCP_PROJECT}"
```

(Member format: `<project>.svc.id.goog[<namespace>/<k8s-sa-name>]`.)
Better: move this binding into Terraform as a
`google_service_account_iam_member` resource so it's reproducible and
reviewed like everything else.

---

## 5. Verify after first deploy

```bash
kubectl -n ios-plus get sa ios-plus-sa -o yaml | grep gcp-service-account
kubectl -n ios-plus run wif-test --rm -it --restart=Never \
  --serviceaccount=ios-plus-sa \
  --image=google/cloud-sdk:slim -- \
  gcloud auth list
# Expected active account: ios-plus-sa@<project>.iam.gserviceaccount.com
```
