# SMEPro COS Mini-UDM — REST API & CoPilot Integration Guide
## Lamar University Pilot: Nursing + College of Business
## Version: 2026.06.20-LAMAR-1.0
## Date: 2026-06-20

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4: CoPilot Natural Language Interface                │
│  (Student asks: "Can I practice nursing in California?")     │
├─────────────────────────────────────────────────────────────┤
│  LAYER 3: REST API Gateway                                    │
│  GET /v1/compliance/licensure/state-lookup                  │
│  GET /v1/compliance/expirations/alerts                     │
│  GET /v1/compliance/uco/lookup                              │
├─────────────────────────────────────────────────────────────┤
│  LAYER 2: PostgreSQL Functions & Views                      │
│  fn_lookup_state_licensure_by_cip()                         │
│  v_state_licensure_candidates                               │
│  v_agent_swarm_alerts                                       │
│  fn_check_expiring_licenses()                               │
├─────────────────────────────────────────────────────────────┤
│  LAYER 1: SMEPro COS Mini-UDM Excel Workbook                │
│  27 sheets, 1,095+ rows, 30-column structure                 │
│  The UCO_NODE_ID is the source of truth                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. REST API Specification (OpenAPI 3.0)

### 2.1 Base URL

```
Production:  https://api.ioscos.com/v1
Staging:     https://api-staging.ioscos.com/v1
Local:       http://localhost:8080/v1
```

### 2.2 Authentication

All endpoints require a `Bearer` token in the `Authorization` header and an `X-Institution-ID` header.

```http
Authorization: Bearer <JWT_TOKEN>
X-Institution-ID: lamar-university
X-Request-ID: <UUID>          # Optional, for tracing
```

### 2.3 Endpoints

---

#### **GET /compliance/licensure/state-lookup**

**Description:** Real-time CIP→SOC→State licensure lookup. The primary endpoint for CoPilot.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `student_cip` | query | string | ✅ | CIP code | `51.3801` |
| `destination_state` | query | string | ✅ | 2-letter state code | `CA` |
| `compact_only` | query | boolean | ❌ | Return only compact-eligible | `false` |
| `include_international` | query | boolean | ❌ | Include international requirements | `false` |
| `format` | query | string | ❌ | `json` (default) or `markdown` | `json` |

**Responses:**

**200 OK — Compact State (Texas)**
```json
{
  "cip_code": "51.3801",
  "cip_title": "Registered Nursing/Registered Nurse",
  "soc_code": "29-1141",
  "soc_title": "Registered Nurses",
  "destination_state": "TX",
  "state_name": "Texas",
  "license_type": "Registered Nurse (RN)",
  "compact_member": true,
  "compact_status": "Fully Active",
  "endorsement_required": false,
  "exam_required": "NCLEX-RN",
  "ce_hours": "20",
  "cycle_years": "2",
  "can_practice": true,
  "practice_notes": "Compact privilege valid — no additional license required. Texas is a fully active eNLC state (43 jurisdictions total). Graduate can practice in any compact state with multistate license.",
  "uco_nodes": ["UCO-HCR-1091", "UCO-HCR-1099", "UCO-EDU-LAM-2107"],
  "source_url": "https://www.bon.texas.gov",
  "last_verified": "2026-06-20",
  "copilot_status": "✅ APPROVED",
  "copilot_action": "Compact state — multistate license valid"
}
```

**200 OK — Non-Compact State (California)**
```json
{
  "cip_code": "51.3801",
  "cip_title": "Registered Nursing/Registered Nurse",
  "soc_code": "29-1141",
  "soc_title": "Registered Nurses",
  "destination_state": "CA",
  "state_name": "California",
  "license_type": "Registered Nurse (RN)",
  "compact_member": false,
  "compact_status": "Non-Compact",
  "endorsement_required": true,
  "exam_required": "NCLEX-RN",
  "ce_hours": "30",
  "cycle_years": "2",
  "can_practice": false,
  "practice_notes": "Endorsement required — apply to California Board of Registered Nursing. California is NOT a compact state. In-person evaluation or additional coursework may be required. Processing time: 10–12 weeks.",
  "uco_nodes": ["UCO-HCR-1091", "UCO-HCR-1099"],
  "source_url": "https://www.rn.ca.gov",
  "last_verified": "2026-06-20",
  "copilot_status": "❌ BLOCKED",
  "copilot_action": "Non-compact state — endorsement required"
}
```

**200 OK — Markdown Format**
```markdown
## Licensure Lookup Result

| Field | Value |
|-------|-------|
| **Program** | Registered Nursing (CIP 51.3801) |
| **Destination** | California (CA) |
| **License Type** | Registered Nurse (RN) |
| **Compact Member** | ❌ No |
| **Can Practice** | ❌ No — endorsement required |
| **Exam Required** | NCLEX-RN |
| **CE Hours** | 30 per 2-year cycle |
| **Processing Time** | 10–12 weeks |
| **Source** | [CA BRN](https://www.rn.ca.gov) |

**Action Required:** Apply for licensure by endorsement to the California Board of Registered Nursing. California is not a compact state and requires a separate state license.
```

**400 Bad Request**
```json
{
  "error": "INVALID_PARAMETERS",
  "message": "student_cip must match pattern ^\\d{2}\\.\\d{4}$",
  "code": "CIP_FORMAT_INVALID"
}
```

**404 Not Found**
```json
{
  "error": "NOT_FOUND",
  "message": "CIP code 99.9999 not found in UDM",
  "code": "CIP_NOT_FOUND"
}
```

**500 Internal Server Error**
```json
{
  "error": "INTERNAL_ERROR",
  "message": "Database connection failed",
  "code": "DB_CONNECTION_FAILED",
  "request_id": "req-abc-123"
}
```

---

#### **GET /compliance/expirations/alerts**

**Description:** Returns upcoming license expirations for the institution. Consumed by the agent swarm dashboard.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `days_ahead` | query | integer | ❌ | Days to look ahead | `90` |
| `alert_level` | query | string | ❌ | Filter: `CRITICAL`, `WARNING`, `NOTICE`, `ALL` | `CRITICAL` |
| `entity_type` | query | string | ❌ | Filter: `student`, `faculty`, `program`, `institution`, `clinical_site` | `faculty` |

**Response (200 OK):**
```json
{
  "alerts": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "entity_type": "faculty",
      "entity_id": "faculty-001",
      "license_type": "DEA Controlled Substance Registration",
      "license_number": "BX1234567",
      "issuing_authority": "DEA Diversion Control Division",
      "expiration_date": "2026-07-15",
      "days_remaining": 25,
      "alert_level": "CRITICAL",
      "status": "active",
      "metadata": {
        "waiver_status": "Fourth Temporary Extension through 2026-12-31",
        "source": "Federal Register 2025-12-31"
      }
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "entity_type": "program",
      "entity_id": "lamar-nursing-bsn",
      "license_type": "Programmatic Accreditation",
      "license_number": null,
      "issuing_authority": "ACEN",
      "expiration_date": "2026-08-01",
      "days_remaining": 42,
      "alert_level": "WARNING",
      "status": "active",
      "metadata": {
        "type": "accreditation",
        "cycle": "5-year"
      }
    }
  ],
  "summary": {
    "total": 2,
    "critical": 1,
    "warning": 1,
    "notice": 0,
    "ok": 0
  }
}
```

---

#### **GET /compliance/uco/lookup**

**Description:** Lookup a UCO_NODE_ID to retrieve full regulatory context.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `uco_node_id` | query | string | ✅ | UCO node ID | `UCO-HCR-1091` |
| `include_chain` | query | boolean | ❌ | Include full CIP→SOC→NAICS chain | `true` |

**Response (200 OK):**
```json
{
  "uco_node_id": "UCO-HCR-1091",
  "broad_industry": "HEALTHCARE",
  "industry_subtype": "Nursing — Registered Nursing (RN) Licensure",
  "activity": "State Board of Nursing — RN Licensure by Examination / Endorsement / Compact",
  "jurisdiction": "State",
  "governing_agency": "State Board of Nursing (e.g., TX BON; CA BRN)",
  "regulation": "State Nursing Practice Act (NPA); Nurse Licensure Compact (NLC) / Enhanced NLC (eNLC)",
  "citation": "Varies by state (e.g., Tex. Occ. Code Ch. 301; CA Business & Professions Code §2700+)",
  "cip": "51.3801",
  "soc": "29-1141",
  "naics": "621111",
  "isic": "Q86",
  "risk_weight": 10,
  "policy_action": "BLOCK",
  "notes": "Compact states: 43 jurisdictions recognize eNLC (40 states + Guam fully active; MA + USVI enacted, pending). CE requirements vary: TX = 20 contact hours; CA = 30 CE hours; NY = infection control + child abuse.",
  "last_updated": "2026-06-20",
  "compliance_chain": [
    { "step": 1, "code": "CIP 51.3801", "name": "Registered Nursing", "gate": "Program Accreditation" },
    { "step": 2, "code": "SOC 29-1141", "name": "Registered Nurses", "gate": "State BON Licensure" },
    { "step": 3, "code": "NAICS 621111", "name": "Physician Offices", "gate": "Employer Credentialing" }
  ]
}
```

---

#### **POST /compliance/expirations/track**

**Description:** Track a new license, certification, or accreditation expiration.

**Request Body:**
```json
{
  "entity_type": "faculty",
  "entity_id": "faculty-001",
  "license_type": "DEA Controlled Substance Registration",
  "license_number": "BX1234567",
  "issuing_authority": "DEA Diversion Control Division",
  "issue_date": "2024-01-15",
  "renewal_cycle_years": 3,
  "metadata": {
    "waiver_status": "Fourth Temporary Extension through 2026-12-31"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "entity_type": "faculty",
  "entity_id": "faculty-001",
  "license_type": "DEA Controlled Substance Registration",
  "expiration_date": "2027-01-15",
  "renewal_reminder_date": "2026-10-16",
  "status": "active",
  "created_at": "2026-06-20T12:00:00Z"
}
```

---

## 3. CoPilot Integration

### 3.1 Query Routing

CoPilot receives natural language queries from students, faculty, and administrators. The query router maps these to the appropriate API endpoint.

| User Query | Routed Endpoint | Parameters | Example Response |
|------------|----------------|------------|------------------|
| "Can I practice nursing in California?" | `GET /compliance/licensure/state-lookup` | `cip=51.3801&state=CA` | "California requires endorsement. You are NOT compact-eligible. Apply to CA BRN." |
| "Where can I work with my Texas RN license?" | `GET /compliance/licensure/state-lookup` | `cip=51.3801&state=TX` | "Texas is a fully active eNLC state. You can practice in 40 states + Guam with your multistate license." |
| "When does my DEA registration expire?" | `GET /compliance/expirations/alerts` | `entity_type=faculty&entity_id=faculty-001` | "Your DEA registration expires in 25 days. Renewal is due by July 15, 2026." |
| "What is UCO-HCR-1091?" | `GET /compliance/uco/lookup` | `uco_node_id=UCO-HCR-1091` | "State BON RN Licensure. Critical node. 43 eNLC jurisdictions." |
| "Do I need a CPA license for accounting?" | `GET /compliance/licensure/state-lookup` | `cip=52.0301&state=TX` | "CPA license required. Pass the Uniform CPA Exam and meet the 150-credit rule." |
| "Can I prescribe controlled substances via telehealth?" | `GET /compliance/uco/lookup` | `uco_node_id=UCO-HCR-1092` | "Ryan Haight Fourth Temporary Extension through Dec 31, 2026. In-person evaluation NOT required during extension." |

### 3.2 CoPilot Response Templates

**Template 1: Compact State (APPROVED)**
```
✅ **YES — You can practice in {destination_state} with your {home_state} license.**

{destination_state} is a **fully active {compact_type} state**. Your multistate license is valid here.

- **License Type:** {license_type}
- **CE Requirement:** {ce_hours} hours per {cycle_years}-year cycle
- **Renewal:** Through your home state board
- **Source:** [{source_url}]({source_url})
- **UCO Nodes:** {uco_nodes}

*No additional application or endorsement is required.*
```

**Template 2: Non-Compact State (BLOCKED)**
```
❌ **NO — You cannot practice in {destination_state} without additional licensure.**

{destination_state} is **NOT a compact state**. You must apply for licensure by endorsement.

- **License Type:** {license_type}
- **Exam Required:** {exam_required}
- **CE Requirement:** {ce_hours} hours per {cycle_years}-year cycle
- **Processing Time:** 10–12 weeks (varies by state)
- **Action Required:** Apply to {state_name} Board of Nursing
- **Source:** [{source_url}]({source_url})
- **UCO Nodes:** {uco_nodes}

*Start the endorsement process 3–6 months before your planned move.*
```

**Template 3: Expiration Alert**
```
⚠️ **EXPIRATION ALERT — {license_type}**

- **Entity:** {entity_type} {entity_id}
- **License Number:** {license_number}
- **Issuing Authority:** {issuing_authority}
- **Expires:** {expiration_date} ({days_remaining} days remaining)
- **Alert Level:** {alert_level}
- **Action:** Renew immediately to avoid lapse

{metadata_notes}
```

### 3.3 CoPilot Error Handling

| Error Code | CoPilot Response |
|------------|-----------------|
| `CIP_NOT_FOUND` | "I don't recognize that program code. Please provide a valid CIP code (e.g., 51.3801 for nursing, 52.0301 for accounting)." |
| `STATE_NOT_FOUND` | "I don't recognize that state code. Please use a 2-letter abbreviation (e.g., TX, CA, NY)." |
| `DB_CONNECTION_FAILED` | "I'm unable to access the compliance database right now. Please try again in a few minutes or contact IT support." |
| `UNAUTHORIZED` | "You don't have permission to access this information. Please log in with your institutional credentials." |
| `RATE_LIMITED` | "I'm processing a lot of requests right now. Please wait a moment and try again." |

---

## 4. Agent Swarm Integration

### 4.1 Layer 1: Cloud Regulatory Surveillance → API

The Cloud Regulatory Surveillance agents (Firecrawl, WebBridge) monitor official sources. When a change is detected, they:

1. Update the `NOTES` field in the Mini-UDM Excel sheet
2. Increment the `last_verified` date in the database
3. Trigger a cache invalidation for the REST API
4. Post an alert to the agent swarm dashboard

**Example:** When DEA announces a new Ryan Haight extension, Agent A1 updates:
- UCO-HCR-1092 NOTES field
- `license_expiration_tracking.metadata` for all DEA registrations
- API cache TTL reset

### 4.2 Layer 2: On-Prem Engine → API

The On-Prem Engine agents (Banner, Blackboard, Concourse) sync institutional data with the compliance database.

**Banner SIS → API:**
```json
POST /compliance/expirations/track
{
  "entity_type": "student",
  "entity_id": "banner-pid-12345",
  "license_type": "RN License (TX)",
  "license_number": "RN-123456-TX",
  "issue_date": "2024-06-01",
  "renewal_cycle_years": 2
}
```

### 4.3 Layer 3: Live Check → API

The Live Check agents query the API every 15 minutes for:
- `v_agent_swarm_alerts` — upcoming expirations
- `fn_check_expiring_licenses(30)` — critical alerts

When an alert is found, the agent:
1. Posts to the institutional Slack/Teams channel
2. Sends an email to the responsible role (e.g., Chief Nursing Officer)
3. Creates a Jira ticket for tracking

### 4.4 Layer 4: EDU Reporter → API

The EDU Reporter agents query the API for:
- Quarterly filing status (THECB, TX BON, ACEN, SACSCOC)
- Annual reporting requirements (IPEDS, Title IV, NCLEX pass rates)
- Accreditation renewal timelines

---

## 5. Security & Compliance

### 5.1 Data Protection

- **No PII in API responses:** License numbers are SHA-256 hashed before storage; only the last 4 digits are returned in API responses
- **SYN IDs:** All external queries use synthetic student IDs (SYN-XXXXX) + CIP + destination_state only
- **Audit logging:** Every API call is logged to `audit_events` table with session ID, IP address, and user agent
- **Encryption:** All data encrypted at rest (AES-256) and in transit (TLS 1.3)

### 5.2 Rate Limiting

| Tier | Requests/minute | Burst | Use Case |
|------|----------------|-------|----------|
| CoPilot (Student) | 30 | 10 | Natural language queries |
| CoPilot (Faculty) | 60 | 20 | Dashboard queries |
| Agent Swarm | 120 | 50 | Automated monitoring |
| Admin | 300 | 100 | Bulk operations |

### 5.3 CORS & Origins

```
Allowed Origins:
- https://copilot.lamar.edu
- https://dashboard.lamar.edu
- https://app.ioscos.com
- http://localhost:3000 (development only)
```

---

## 6. Testing & Validation

### 6.1 Postman Collection

A Postman collection is available at:
```
ios-plus/tests/postman/SMEPro_COS_Mini_UDM_Lamar.postman_collection.json
```

### 6.2 Example cURL Commands

```bash
# Test 1: Nursing → Texas (compact)
curl -X GET "https://api.ioscos.com/v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=TX" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Institution-ID: lamar-university"

# Test 2: Nursing → California (non-compact)
curl -X GET "https://api.ioscos.com/v1/compliance/licensure/state-lookup?student_cip=51.3801&destination_state=CA" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Institution-ID: lamar-university"

# Test 3: Business → New York (CPA)
curl -X GET "https://api.ioscos.com/v1/compliance/licensure/state-lookup?student_cip=52.0301&destination_state=NY" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Institution-ID: lamar-university"

# Test 4: Expiration alerts
curl -X GET "https://api.ioscos.com/v1/compliance/expirations/alerts?days_ahead=90&alert_level=CRITICAL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Institution-ID: lamar-university"

# Test 5: UCO lookup
curl -X GET "https://api.ioscos.com/v1/compliance/uco/lookup?uco_node_id=UCO-HCR-1091&include_chain=true" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Institution-ID: lamar-university"
```

### 6.3 Load Testing

```bash
# k6 load test script
k6 run ios-plus/tests/k6/licensure-lookup-load-test.js

# Expected results:
# - p95 latency < 200ms for cached queries
# - p95 latency < 500ms for uncached queries
# - Throughput: 1000 req/sec
# - Error rate: < 0.1%
```

---

## 7. Deployment Checklist

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Deploy V11 migration to PostgreSQL | DBA | ☐ |
| 2 | Load seed CSVs (`cip_soc_state_license.csv`, `compact_participation.csv`) | DBA | ☐ |
| 3 | Verify `fn_lookup_state_licensure_by_cip` returns correct results | QA | ☐ |
| 4 | Verify `v_agent_swarm_alerts` shows upcoming expirations | QA | ☐ |
| 5 | Deploy REST API to staging | DevOps | ☐ |
| 6 | Run Postman collection against staging | QA | ☐ |
| 7 | Run k6 load test against staging | DevOps | ☐ |
| 8 | Deploy to production | DevOps | ☐ |
| 9 | Configure CoPilot integration | CoPilot Team | ☐ |
| 10 | Train CoPilot on response templates | CoPilot Team | ☐ |
| 11 | Schedule agent swarm monitoring tasks | Agent Swarm Team | ☐ |
| 12 | Publish API documentation to developer portal | Docs Team | ☐ |

---

## 8. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 2026.06.20-LAMAR-1.0 | 2026-06-20 | Initial release: Mini-UDM for Lamar University (Nursing + Business + 12 verticals) |

---

*End of Integration Guide.*
