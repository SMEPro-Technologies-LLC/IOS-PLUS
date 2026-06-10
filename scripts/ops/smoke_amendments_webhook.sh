#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${1:-}"
BASE_URL="${BASE_URL:-http://localhost:3001}"
DB_CONTAINER="${DB_CONTAINER:-cos-plus}"
DB_NAME="${DB_NAME:-ios_plus}"
DB_USER="${DB_USER:-cos_admin}"
WEBHOOK_PATH="/v1/webhooks/firecrawl/monitor.page"

BODY1='{"type":"monitor.page","id":"evt_test1","monitorId":"mon_test","timestamp":"2026-06-10T12:00:00Z","data":{"url":"https://www.ecfr.gov/current/title-18/part-260","name":"UCO-ENR-1029 - Part 260 updated","summary":"First revision detected."}}'
BODY2='{"type":"monitor.page","id":"evt_test2","monitorId":"mon_test","timestamp":"2026-06-10T12:05:00Z","metadata":{"uco_node_id":"UCO-ENR-1029"},"data":{"url":"https://www.ecfr.gov/current/title-18/part-260","name":"renamed by someone in the dashboard","summary":"Second revision detected."}}'

if [[ -z "${FIRECRAWL_WEBHOOK_SECRET:-}" ]]; then
  echo "ERROR: FIRECRAWL_WEBHOOK_SECRET must be set."
  exit 1
fi

if [[ "$BASE_URL" != http://localhost:* && "$BASE_URL" != http://127.0.0.1:* ]]; then
  echo "ERROR: Refusing to run against non-local host: $BASE_URL"
  echo "WARNING: uco_amendments is WORM-protected; smoke rows are permanent outside disposable local compose."
  exit 1
fi

if [[ "$SCENARIO" != "a" && "$SCENARIO" != "b" ]]; then
  echo "Usage: FIRECRAWL_WEBHOOK_SECRET=... $0 a|b"
  echo "  a = dedup/redelivery scenario"
  echo "  b = supersession scenario"
  exit 1
fi

echo "⚠️  WARNING: run only against disposable local docker-compose stack."
echo "⚠️  WORM policy means test rows are permanent in shared databases."

sign_payload() {
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$FIRECRAWL_WEBHOOK_SECRET" -hex | awk '{print $2}'
}

post_payload() {
  local body="$1"
  local response_file
  response_file="$(mktemp)"
  local status
  status="$(curl -sS -o "$response_file" -w "%{http_code}" \
    -X POST "${BASE_URL}${WEBHOOK_PATH}" \
    -H "content-type: application/json" \
    -H "x-firecrawl-signature: $(sign_payload "$body")" \
    --data "$body")"
  local payload
  payload="$(cat "$response_file")"
  rm -f "$response_file"
  printf '%s\n%s\n' "$status" "$payload"
}

db_query() {
  docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -Atc "$1"
}

assert_fresh_events() {
  local existing
  existing="$(db_query "SELECT COUNT(*) FROM uco_amendments WHERE event_id IN ('evt_test1','evt_test2');")"
  if [[ "$existing" != "0" ]]; then
    echo "ERROR: evt_test1/evt_test2 already exist. Reset compose stack before rerun."
    exit 1
  fi
}

run_scenario_a() {
  echo "Running Scenario A (dedup/redelivery)..."
  assert_fresh_events

  mapfile -t first_resp < <(post_payload "$BODY1")
  [[ "${first_resp[0]}" == "201" ]] || { echo "Expected first POST 201, got ${first_resp[0]}: ${first_resp[1]}"; exit 1; }

  mapfile -t second_resp < <(post_payload "$BODY1")
  [[ "${second_resp[0]}" == "200" ]] || { echo "Expected duplicate POST 200, got ${second_resp[0]}: ${second_resp[1]}"; exit 1; }
  echo "${second_resp[1]}" | grep -q '"status":"duplicate"' || { echo "Expected duplicate status body"; exit 1; }

  local evt1_status
  evt1_status="$(db_query "SELECT status FROM uco_amendments WHERE event_id='evt_test1';")"
  [[ "$evt1_status" == "pending_review" ]] || { echo "Expected evt_test1 status pending_review, got $evt1_status"; exit 1; }

  local open_count
  open_count="$(db_query "SELECT COUNT(*) FROM uco_amendments WHERE uco_node_id='UCO-ENR-1029' AND status='pending_review';")"
  [[ "$open_count" == "1" ]] || { echo "Expected exactly one open pending_review row for UCO-ENR-1029, got $open_count"; exit 1; }

  echo "Scenario A passed."
}

run_scenario_b() {
  echo "Running Scenario B (supersession)..."
  assert_fresh_events

  mapfile -t first_resp < <(post_payload "$BODY1")
  [[ "${first_resp[0]}" == "201" ]] || { echo "Expected first POST 201, got ${first_resp[0]}: ${first_resp[1]}"; exit 1; }

  mapfile -t second_resp < <(post_payload "$BODY2")
  [[ "${second_resp[0]}" == "201" ]] || { echo "Expected second POST 201, got ${second_resp[0]}: ${second_resp[1]}"; exit 1; }
  echo "${second_resp[1]}" | grep -q '"superseded":1' || { echo "Expected superseded count of 1 in response"; exit 1; }

  local evt1_status
  evt1_status="$(db_query "SELECT status FROM uco_amendments WHERE event_id='evt_test1';")"
  [[ "$evt1_status" == "superseded" ]] || { echo "Expected evt_test1 status superseded, got $evt1_status"; exit 1; }

  local evt2_status
  evt2_status="$(db_query "SELECT status FROM uco_amendments WHERE event_id='evt_test2';")"
  [[ "$evt2_status" == "pending_review" ]] || { echo "Expected evt_test2 status pending_review, got $evt2_status"; exit 1; }

  local open_count
  open_count="$(db_query "SELECT COUNT(*) FROM uco_amendments WHERE uco_node_id='UCO-ENR-1029' AND status='pending_review';")"
  [[ "$open_count" == "1" ]] || { echo "Expected one open pending_review row after supersession, got $open_count"; exit 1; }

  echo "Scenario B passed."
}

if [[ "$SCENARIO" == "a" ]]; then
  run_scenario_a
else
  run_scenario_b
fi
