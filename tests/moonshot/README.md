# Moonshot Verification Runbook

This runbook documents the verification procedures for the IOS+ Moonshot test suite.

## Prerequisites

- Docker 24.0+
- Docker Compose 2.20+
- Node.js 20.19+

## Quick Verification

```bash
# Run the full clean-room audit
docker compose -f docker-compose.test.yml up --build --exit-code-from test-runner

# Check artifacts
cat .audit-artifacts/audit-test.log
cat coverage/coverage-summary.json
```

## Manual Verification Steps

### 1. Database Integrity

```bash
# Start dependencies
docker compose up -d postgres

# Verify extensions
psql $DATABASE_URL -c "SELECT * FROM pg_extension WHERE extname IN ('vector', 'pgcrypto', 'uuid-ossp');"

# Verify WORM triggers
psql $DATABASE_URL -c "SELECT trigger_name, event_manipulation, action_statement FROM information_schema.triggers WHERE trigger_schema = 'public';"

# Verify tables
psql $DATABASE_URL -c "\dt"
```

### 2. Gate 530 Evaluation

```bash
# Start the middleware
npm run dev

# Test health endpoint
curl -s http://localhost:3001/health | jq

# Test readiness endpoint
curl -s http://localhost:3001/ready | jq

# Test evaluation endpoint
curl -s -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "test-001",
    "actorId": "user-001",
    "resourceId": "resource-001",
    "action": "read",
    "sector": "healthcare",
    "metadata": {"sensitivity": "phi"}
  }' | jq
```

### 3. Evidence Signing

```bash
# Test evidence creation
# (Requires running middleware)

# Verify evidence by request ID
curl -s http://localhost:3001/v1/evidence/test-001 | jq
```

### 4. Audit Trail

```bash
# Check audit events
psql $DATABASE_URL -c "SELECT table_name, operation, actor_id, timestamp FROM audit_events ORDER BY timestamp DESC LIMIT 10;"

# Verify WORM integrity
npm run db:verify-worm
```

### 5. Licensure Lookup

```bash
# Test state licensure lookup
curl -s "http://localhost:3001/v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA" | jq
```

### 6. Metrics

```bash
# Check Prometheus metrics
curl -s http://localhost:3001/metrics | head -20

# Check Grafana (if running)
# http://localhost:3000 (admin/admin)
```

## Expected Results

### Health Check
```json
{"status":"ok","timestamp":"2026-01-15T10:00:00Z","version":"1.0.0"}
```

### Readiness Check
```json
{"status":"ready","dependencies":{"database":"ok","vault":"ok","signing":"ok"},"checks_passed":3}
```

### Evaluation Response
```json
{
  "decision": {
    "action": "allow",
    "reason": "Request complies with healthcare PHI policies",
    "dimension": "privacy",
    "confidence": 0.95,
    "metadata": {"rule_id": "healthcare-phi-001"}
  },
  "evidence": {...},
  "auditEventId": "uuid"
}
```

## Troubleshooting

### Database Connection Failure
```bash
# Check postgres is running
docker ps | grep postgres

# Check connection string
psql $DATABASE_URL -c "SELECT 1"
```

### Vault Connection Failure
```bash
# Check vault is running
docker ps | grep vault

# Check vault health
curl $VAULT_ADDR/v1/sys/health
```

### Build Failure
```bash
# Clean and rebuild
rm -rf node_modules dist
npm ci
npm run build
```

## Regression Test Suite

The following tests must pass for any release candidate:

1. ✅ Unit tests (all packages)
2. ✅ Integration tests (database + middleware)
3. ✅ WORM verification
4. ✅ Evidence signing and verification
5. ✅ Licensure lookup end-to-end
6. ✅ Health and readiness checks
7. ✅ Metrics endpoint
8. ✅ Admin route authentication
9. ✅ Coverage gate (80%+)

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering Lead | | | |
| QA Lead | | | |
| Security Lead | | | |
| Compliance Lead | | | |
