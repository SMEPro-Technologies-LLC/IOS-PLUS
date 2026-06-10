#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
PG_CONTAINER="${PG_CONTAINER:-cos-plus}"
PG_DB="${PG_DB:-ios_plus}"
PG_USER="${PG_USER:-cos_admin}"
WEBHOOK_SECRET="${FIRECRAWL_WEBHOOK_SECRET:-iosplus_dev_firecrawl_secret}"

if [[ ! "$BASE_URL" =~ ^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
  echo "ERROR: Refusing non-local host: $BASE_URL"
  echo "Run only against disposable docker-compose stack (uco_amendments is WORM; test rows are permanent)."
  exit 1
fi

echo "WARNING: Running against $BASE_URL only. uco_amendments rows are permanent (WORM)."

SCENARIO="${SCENARIO:-all}"

body1='{"type":"monitor.page","id":"evt_test1","monitorId":"mon_test","timestamp":"2026-06-10T12:00:00Z","data":{"url":"https://www.ecfr.gov/current/title-18/part-260","name":"UCO-ENR-1029 ecfr part update","summary":"First revision detected."}}'
body2='{"type":"monitor.page","id":"evt_test2","monitorId":"mon_test","timestamp":"2026-06-10T12:05:00Z","metadata":{"uco_node_id":"UCO-ENR-1029"},"data":{"url":"https://www.ecfr.gov/current/title-18/part-260","name":"renamed by someone in the dashboard","summary":"Second revision detected."}}'

sql_scalar() {
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" "$PG_DB" -t -A -c "$1"
}

sign_and_post() {
  local body="$1"
  local signature
  signature="$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $2}')"
  curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/v1/webhooks/firecrawl/amendments" \
    -H "content-type: application/json" \
    -H "x-firecrawl-signature: sha256=$signature" \
    --data-binary "$body"
}

require_clean_ids() {
  local existing
  existing="$(sql_scalar "SELECT count(*) FROM uco_amendments WHERE event_id IN ('evt_test1','evt_test2');")"
  if [[ "$existing" != "0" ]]; then
    echo "ERROR: evt_test1/evt_test2 already exist; use a fresh disposable stack."
    exit 1
  fi
}

parse_http_code() {
  tail -n1
}

parse_body() {
  sed '$d'
}

echo "Scenario A — dedup/redelivery"
if [[ "$SCENARIO" != "b" ]]; then
  require_clean_ids

  resp="$(sign_and_post "$body1")"
  code="$(printf '%s\n' "$resp" | parse_http_code)"
  body="$(printf '%s\n' "$resp" | parse_body)"
  [[ "$code" == "201" ]] || { echo "Expected 201 for first BODY1, got $code: $body"; exit 1; }

  resp="$(sign_and_post "$body1")"
  code="$(printf '%s\n' "$resp" | parse_http_code)"
  body="$(printf '%s\n' "$resp" | parse_body)"
  [[ "$code" == "200" ]] || { echo "Expected 200 duplicate for redelivery, got $code: $body"; exit 1; }
  echo "$body" | grep -q '"status":"duplicate"' || { echo "Expected duplicate status payload, got: $body"; exit 1; }

  evt1_status="$(sql_scalar "SELECT status FROM uco_amendments WHERE event_id = 'evt_test1';")"
  [[ "$evt1_status" == "pending_review" ]] || { echo "Expected evt_test1 pending_review, got $evt1_status"; exit 1; }
  open_count="$(sql_scalar "SELECT count(*) FROM uco_amendments WHERE uco_node_id = 'UCO-ENR-1029' AND status = 'pending_review';")"
  [[ "$open_count" == "1" ]] || { echo "Expected one open pending_review row for node, got $open_count"; exit 1; }

  echo "Scenario A passed."
fi

if [[ "$SCENARIO" == "a" ]]; then
  exit 0
fi

if [[ "$SCENARIO" == "all" ]]; then
  echo
  echo "Resetting disposable compose stack between scenarios..."
  docker compose down -v
  docker compose up -d cos-plus redis vault-dev flyway gate-530 middleware-engine

  for _ in {1..30}; do
    if curl -fsS "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
fi

echo
echo "Scenario B — supersession"

require_clean_ids

resp="$(sign_and_post "$body1")"
code="$(printf '%s\n' "$resp" | parse_http_code)"
body="$(printf '%s\n' "$resp" | parse_body)"
[[ "$code" == "201" ]] || { echo "Expected 201 for BODY1, got $code: $body"; exit 1; }

resp="$(sign_and_post "$body2")"
code="$(printf '%s\n' "$resp" | parse_http_code)"
body="$(printf '%s\n' "$resp" | parse_body)"
[[ "$code" == "201" ]] || { echo "Expected 201 for BODY2, got $code: $body"; exit 1; }
echo "$body" | grep -q '"superseded":1' || { echo "Expected superseded=1 on BODY2 insert, got: $body"; exit 1; }

evt1_status="$(sql_scalar "SELECT status FROM uco_amendments WHERE event_id = 'evt_test1';")"
[[ "$evt1_status" == "superseded" ]] || { echo "Expected evt_test1 superseded, got $evt1_status"; exit 1; }
evt2_status="$(sql_scalar "SELECT status FROM uco_amendments WHERE event_id = 'evt_test2';")"
[[ "$evt2_status" == "pending_review" ]] || { echo "Expected evt_test2 pending_review, got $evt2_status"; exit 1; }
open_count="$(sql_scalar "SELECT count(*) FROM uco_amendments WHERE uco_node_id = 'UCO-ENR-1029' AND status = 'pending_review';")"
[[ "$open_count" == "1" ]] || { echo "Expected one open pending_review row for node, got $open_count"; exit 1; }

echo "Scenario B passed."
