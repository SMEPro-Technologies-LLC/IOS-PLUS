#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="ios-plus"
KUBE_CONTEXT=""
BASE_URL="http://localhost:3001"
WAIT_SECONDS="20"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --context)
      KUBE_CONTEXT="$2"
      shift 2
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --wait-seconds)
      WAIT_SECONDS="$2"
      shift 2
      ;;
    --help|-h)
      cat <<USAGE
Usage: $(basename "$0") [--namespace <ns>] [--context <kubecontext>] [--base-url <url>] [--wait-seconds <sec>]

Runs moonshot chaos experiments sequentially and validates recovery between each step.
Safety guard: current context name must match MOONSHOT_ALLOW_CONTEXT.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${MOONSHOT_ALLOW_CONTEXT:-}" ]]; then
  echo "CONFIG_ERROR: set MOONSHOT_ALLOW_CONTEXT to an allowed context substring" >&2
  exit 2
fi

CURRENT_CONTEXT="${KUBE_CONTEXT:-$(kubectl config current-context)}"
if [[ "${CURRENT_CONTEXT}" != *"${MOONSHOT_ALLOW_CONTEXT}"* ]]; then
  echo "CONFIG_ERROR: refusing to run chaos on context '${CURRENT_CONTEXT}' (MOONSHOT_ALLOW_CONTEXT='${MOONSHOT_ALLOW_CONTEXT}')" >&2
  exit 2
fi

KUBECTL=(kubectl)
if [[ -n "${KUBE_CONTEXT}" ]]; then
  KUBECTL+=(--context "${KUBE_CONTEXT}")
fi
KUBECTL+=(--namespace "${NAMESPACE}")

run_experiment() {
  local manifest="$1"
  local name
  name="$(basename "${manifest}")"

  echo "==> Applying ${name}"
  "${KUBECTL[@]}" apply -f "${manifest}"

  echo "==> Waiting ${WAIT_SECONDS}s during ${name}"
  sleep "${WAIT_SECONDS}"

  echo "==> Validating recovery after ${name}"
  python3 "${SCRIPT_DIR}/validate_recovery.py" --base-url "${BASE_URL}"

  echo "==> Deleting ${name}"
  "${KUBECTL[@]}" delete -f "${manifest}" --ignore-not-found
}

run_experiment "${SCRIPT_DIR}/pod-kill-middleware.yaml"
python3 "${SCRIPT_DIR}/verify_state_preservation.py" --base-url "${BASE_URL}" || {
  code=$?
  if [[ $code -ne 77 ]]; then
    exit "$code"
  fi
}
run_experiment "${SCRIPT_DIR}/pod-kill-gate530.yaml"
run_experiment "${SCRIPT_DIR}/network-loss-redis.yaml"
run_experiment "${SCRIPT_DIR}/network-partition-db.yaml"
run_experiment "${SCRIPT_DIR}/clock-skew.yaml"

echo "Moonshot chaos suite completed successfully."
