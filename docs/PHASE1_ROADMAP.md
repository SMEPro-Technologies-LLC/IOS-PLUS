# IOS+ Phase 1 Roadmap — Gate Walker Engine

## Overview

The Gate Walker Engine is the Phase 1 compliance pipeline for IOS+. It implements a **10-stage sequential pipeline** that evaluates every AI/agent API request through mandatory compliance gates before execution.

**API endpoint:** `POST /gate/execute`  
**Package:** `@ios-plus/gate-walker`  
**Pipeline stages:** `AUTHENTICATE → INTERPRET → CLASSIFY → AUTHORIZE → ROUTE → EXECUTE → RECONCILE → REDACT → RESPOND → AUDIT`

---

## Architecture

### 10-Stage Pipeline

| # | Stage | Purpose | Fail-Closed? |
|---|-------|---------|-------------|
| 1 | **AUTHENTICATE** | Verify actor identity via API key or JWT | Yes |
| 2 | **INTERPRET** | Parse intent, normalize action and resource | Yes |
| 3 | **CLASSIFY** | Assign sensitivity level, FERPA flags, risk score | No (informational) |
| 4 | **AUTHORIZE** | Role-permission check for actor/resource/action | Yes |
| 5 | **ROUTE** | Determine execution path (standard/ferpa/deny/escalate) | No |
| 6 | **EXECUTE** | Apply compliance decision (ALLOW/REDACT/DENY) | No |
| 7 | **RECONCILE** | Verify with external systems (Banner Ethos, Blackboard) | No |
| 8 | **REDACT** | Apply field-level redaction for FERPA/PII | No |
| 9 | **RESPOND** | Assemble final response payload | No |
| 10 | **AUDIT** | Emit sealed Ed25519-signed audit receipt | No |

### Decision Outcomes

| Decision | Meaning |
|----------|---------|
| `ALLOW` | Request authorized and processed |
| `REDACT` | Request authorized but FERPA/privacy fields redacted before return |
| `DENY` | Request blocked — authorization or authentication failure |

### Audit Receipts

Every final decision produces a **sealed audit receipt** (JSON) containing:
- Unique receipt ID (`uuid`)
- Request ID correlation
- Decision (`ALLOW`/`REDACT`/`DENY`)
- Actor, resource, action, sector
- Full stage history (10 entries)
- Ed25519 signature + public key (via Evidence Fabric)
- SHA-256 hash for integrity verification

Receipts are written to `gate_audit_receipts` and cross-referenced in `audit_events`.

---

## Database Infrastructure

### Tables (Migration: `db/migrations/V15__gate_pipeline_state.sql`)

#### `gate_pipeline_state`

Persists intermediate state for each pipeline execution. Upserted at each stage transition.

```sql
CREATE TABLE gate_pipeline_state (
    id              UUID PRIMARY KEY,
    request_id      UUID NOT NULL UNIQUE,
    current_stage   VARCHAR(64) NOT NULL,
    final_decision  VARCHAR(16),
    state           JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);
```

#### `gate_audit_receipts`

Immutable table holding the sealed audit receipt for every final decision.

```sql
CREATE TABLE gate_audit_receipts (
    id                 UUID PRIMARY KEY,
    request_id         UUID NOT NULL,
    decision           VARCHAR(16) NOT NULL,  -- ALLOW | REDACT | DENY
    actor              VARCHAR(255) NOT NULL,
    resource           VARCHAR(512) NOT NULL,
    action             VARCHAR(128) NOT NULL,
    sector             VARCHAR(64) NOT NULL,
    issued_at          TIMESTAMPTZ NOT NULL,
    signature          TEXT NOT NULL,        -- Ed25519 base64
    signer_public_key  TEXT NOT NULL,
    algorithm          VARCHAR(32) NOT NULL,
    hash               VARCHAR(64) NOT NULL, -- SHA-256 hex
    receipt_payload    JSONB NOT NULL
);
```

### Apply Migration

```bash
# Using the project's db:migrate script
DATABASE_URL=******localhost:5432/iosplus npm run db:migrate

# Or directly with psql
psql $DATABASE_URL -f db/migrations/V15__gate_pipeline_state.sql
```

---

## API Reference

### `POST /gate/execute`

Execute a request through the 10-stage Gate Walker pipeline.

#### Request Body

```json
{
  "requestId": "uuid-optional",
  "actorId": "user-or-system-id",
  "token": "api-key-or-jwt",
  "action": "read | write | delete | export | read_grades | access_transcript | view_enrollment | export_student_data",
  "sector": "education | general",
  "resource": {
    "type": "document | student_record | transcript | grade | enrollment | ...",
    "id": "resource-id",
    "classification": "public | internal | confidential | restricted | pii",
    "ferpaProtected": false,
    "metadata": {}
  },
  "metadata": {}
}
```

#### Response (200 ALLOW/REDACT)

```json
{
  "requestId": "uuid",
  "decision": "ALLOW",
  "reason": "Request authorized for read on document",
  "stages": [
    { "stage": "AUTHENTICATE", "status": "pass", "durationMs": 1, "timestamp": "..." },
    { "stage": "INTERPRET", "status": "pass", "durationMs": 0, "timestamp": "..." },
    { "stage": "CLASSIFY", "status": "pass", "metadata": { "sensitivity": "public", "ferpaProtected": false, "riskScore": 0.0 }, "durationMs": 0, "timestamp": "..." },
    { "stage": "AUTHORIZE", "status": "pass", "durationMs": 0, "timestamp": "..." },
    { "stage": "ROUTE", "status": "pass", "metadata": { "path": "standard" }, "durationMs": 0, "timestamp": "..." },
    { "stage": "EXECUTE", "status": "pass", "decision": "ALLOW", "durationMs": 0, "timestamp": "..." },
    { "stage": "RECONCILE", "status": "skip", "reason": "No external systems for standard path", "durationMs": 0, "timestamp": "..." },
    { "stage": "REDACT", "status": "pass", "reason": "No redaction required", "durationMs": 0, "timestamp": "..." },
    { "stage": "RESPOND", "status": "pass", "durationMs": 0, "timestamp": "..." },
    { "stage": "AUDIT", "status": "pass", "durationMs": 1, "timestamp": "..." }
  ],
  "auditReceipt": {
    "id": "uuid",
    "requestId": "uuid",
    "decision": "ALLOW",
    "actor": "user-id",
    "resource": "document/resource-id",
    "action": "read",
    "sector": "general",
    "issuedAt": "2024-01-01T00:00:00.000Z",
    "signature": "base64-ed25519-signature",
    "signerPublicKey": "base64-public-key",
    "algorithm": "Ed25519",
    "hash": "sha256-hex",
    "version": "1.0.0"
  },
  "redactedFields": [],
  "processingMs": 5
}
```

#### Response (403 DENY)

```json
{
  "requestId": "uuid",
  "decision": "DENY",
  "reason": "Invalid or expired token",
  ...
}
```

### `GET /health`

```json
{ "status": "ok", "service": "gate-walker", "version": "1.0.0" }
```

---

## Running the Service

### Development (no DB required)

```bash
# Build
npm run build --workspace=packages/gate-walker

# Start with in-memory state store
node packages/gate-walker/dist/api/server.js

# Or using env vars
GATE_WALKER_PORT=8080 GATE_WALKER_HOST=0.0.0.0 node packages/gate-walker/dist/api/server.js
```

### With PostgreSQL

```bash
# Apply migrations first
DATABASE_URL=******localhost:5432/iosplus npm run db:migrate

# Then start the service
DATABASE_URL=******localhost:5432/iosplus node packages/gate-walker/dist/api/server.js
```

### Docker

```bash
docker compose -f docker-compose.mvp.yml up gate-walker
```

---

## Mock API Adapters

Phase 1 uses deterministic mock adapters for external system integration. No live credentials are required.

### Banner Ethos (`src/mocks/banner-ethos.ts`)

Simulates the Ellucian Banner Ethos REST API for student enrollment and FERPA hold status.

**Mock students available:**

| Student ID | Enrollment | FERPA Hold | Program |
|------------|-----------|------------|---------|
| `student-001` | enrolled | false | CS-BS |
| `student-002` | enrolled | **true** | MATH-MS |
| `student-003` | graduated | false | ENG-BS |
| `student-004` | withdrawn | false | BUS-BA |
| `student-005` | enrolled | **true** | LAW-JD |

### Blackboard (`src/mocks/blackboard.ts`)

Simulates the Blackboard Learn LMS API for course enrollment and grade data.

---

## Test Harness

The test harness in `src/__tests__/pipeline.test.ts` runs **100 synthetic scenarios**:

| Category | Count | Coverage |
|----------|-------|---------|
| ALLOW | 30 | Standard access, various roles, audit receipt integrity |
| FERPA | 30 | FERPA routing, Banner reconciliation, hold-based deny, self-access |
| DENY | 30 | Auth failures, unauthorized actions, FERPA holds, missing fields |
| Edge cases | 10 | Long IDs, special chars, concurrent requests, no adapters |

### Running Tests

```bash
# Run all gate-walker tests
npm run test --workspace=packages/gate-walker

# Run with coverage
npm run test:coverage --workspace=packages/gate-walker

# Run all tests (CI)
npm run test
```

---

## FERPA Compliance Rules (Phase 1)

| Scenario | Decision |
|----------|---------|
| Student accessing their own record | ALLOW (self-access exemption) |
| Faculty/advisor accessing record (no FERPA hold) | ALLOW or REDACT (field redaction applied) |
| Faculty/advisor accessing record (FERPA hold active) | DENY |
| Non-authorized role (student accessing another student's record) | DENY |
| Admin/system accessing any record | ALLOW (administrative purpose) |

**Redacted fields for non-admin FERPA access:**
- `gpa`, `grades`, `grade_points`, `academic_standing`, `disciplinary_records`
- `ssn`, `date_of_birth`, `financial_aid` (always for non-admin)

---

## Phase 1 Limitations

- **No live Banner/Blackboard credentials** — mock adapters only
- **Ed25519 signing** — uses Phase 1 placeholder (`unsigned-phase1`) when no signer is configured. Configure `LocalSigner` from `@ios-plus/evidence-fabric` for real signing.
- **In-memory state** — default state store is `InMemoryStateStore`. Use `PostgresStateStore` for persistence.
- **JWT validation** — Phase 1 uses API key map. Full JWT validation (RS256/HS256) is planned for Phase 2.
- **Escalate path** — treated as DENY in Phase 1.

---

## Phase 2 Roadmap

- [ ] Live Banner Ethos REST integration (Ellucian GERN API)
- [ ] Live Blackboard Learn LMS integration
- [ ] Full JWT authentication (RS256/HS256 via JWKS)
- [ ] Async escalation workflow (human-in-the-loop review)
- [ ] Rate limiting and quota enforcement per actor
- [ ] Multi-tenant isolation in `gate_pipeline_state`
- [ ] Streaming audit receipt publication to S3/GCS
- [ ] Grafana dashboard for pipeline metrics
