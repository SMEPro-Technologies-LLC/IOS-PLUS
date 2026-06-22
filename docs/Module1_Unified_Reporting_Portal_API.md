# Module 1: Unified Reporting Portal API Specification
## SMEPro COS — Institution-Facing Regulatory Reporting
## Version: 2026.06.20-LAMAR-MOD1-1.0
## Date: 2026-06-20

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  UNIFIED REPORTING PORTAL (React / Next.js)                     │
│  One interface for IPEDS, CBM, FISAP, NSLDS, GE/FVT, ASR,      │
│  EADA, AFR, LAR, and TSUS filings                               │
├─────────────────────────────────────────────────────────────────┤
│  REST API Gateway (Node.js / Express / Fastify)                │
│  /v1/module1/reports/*                                          │
├─────────────────────────────────────────────────────────────────┤
│  PostgreSQL Module 1 Schema                                     │
│  12 agency data marts + canonical definitions + ETL tracking   │
├─────────────────────────────────────────────────────────────────┤
│  15 Source Systems (Banner, Blackboard, Omnigo, Cayuse, etc.)  │
│  Pre-built IOS+ connectors — zero custom ETL                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Base URL & Authentication

```
Production:  https://api.ioscos.com/v1/module1
Staging:     https://api-staging.ioscos.com/v1/module1
Local:       http://localhost:8080/v1/module1
```

**Headers:**
```http
Authorization: Bearer <JWT_TOKEN>
X-Institution-ID: lamar-university
X-User-Role: compliance_officer    # student, faculty, compliance_officer, admin, agent
X-Request-ID: <UUID>
```

---

## 3. Endpoints

### 3.1 Reports — List Available Reports

```
GET /reports
```

**Description:** Returns all reports across all 12 agency data marts, with status, deadline, and validation state.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `agency_tier` | query | string | ❌ | Filter: Federal, State, TSUS, Local | `Federal` |
| `agency` | query | string | ❌ | Filter: IPEDS, CBM, Clery, etc. | `IPEDS` |
| `reporting_year` | query | integer | ❌ | Filter by year | `2025` |
| `status` | query | string | ❌ | Filter: draft, validated, submitted, overdue | `validated` |

**Response (200 OK):**
```json
{
  "reports": [
    {
      "report_id": "rpt-feds-001",
      "agency_tier": "Federal",
      "agency": "IPEDS",
      "report_name": "Fall Enrollment",
      "reporting_year": 2025,
      "typical_deadline": "2025-10-15",
      "days_until_deadline": 85,
      "mart_table": "module1_marts.federal_ipeds",
      "status": "validated",
      "validated_at": "2025-09-20T14:30:00Z",
      "validation_errors": null,
      "submitted": false,
      "submission_url": "https://surveys.nces.ed.gov/ipeds",
      "data_source_count": 3,
      "canonical_version": 1,
      "last_etl_run": "2025-09-20T02:00:00Z",
      "last_etl_status": "success"
    },
    {
      "report_id": "rpt-feds-002",
      "agency_tier": "Federal",
      "agency": "IPEDS",
      "report_name": "Student Financial Aid",
      "reporting_year": 2025,
      "typical_deadline": "2025-04-15",
      "days_until_deadline": -155,
      "status": "submitted",
      "submitted_at": "2025-04-10T10:00:00Z",
      "submission_ack": "IPEDS-2025-SFA-12345",
      "validation_errors": null
    },
    {
      "report_id": "rpt-state-001",
      "agency_tier": "State",
      "agency": "CBM",
      "report_name": "CBM001",
      "reporting_year": 2025,
      "typical_deadline": "2025-11-15",
      "days_until_deadline": 115,
      "status": "draft",
      "validation_errors": [
        "ft_undergrad_count differs from IPEDS by 12 students"
      ]
    }
  ],
  "summary": {
    "total": 32,
    "draft": 5,
    "validated": 18,
    "submitted": 8,
    "overdue": 1
  }
}
```

---

### 3.2 Reports — Get Report Data

```
GET /reports/{report_id}/data
```

**Description:** Returns the raw data for a specific report from its agency data mart.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `report_id` | path | string | ✅ | Report ID | `rpt-feds-001` |
| `format` | query | string | ❌ | `json` (default), `csv`, `xml` | `json` |
| `include_metadata` | query | boolean | ❌ | Include canonical definitions | `true` |

**Response (200 OK):**
```json
{
  "report_id": "rpt-feds-001",
  "report_name": "IPEDS Fall Enrollment 2025",
  "reporting_year": 2025,
  "generated_at": "2025-09-20T14:30:00Z",
  "canonical_version": 1,
  "data": [
    {
      "survey_component": "Fall Enrollment",
      "reporting_year": 2025,
      "unitid": "123456",
      "institution_name": "Lamar University",
      "ft_undergrad_count": 3456,
      "pt_undergrad_count": 1234,
      "ft_grad_count": 567,
      "pt_grad_count": 234,
      "first_time_freshman_count": 890,
      "transfer_in_count": 345,
      "male_count": 2345,
      "female_count": 2345,
      "hispanic_count": 1234,
      "black_count": 567,
      "white_count": 2345,
      "asian_count": 345,
      "validated": true
    }
  ],
  "metadata": {
    "canonical_definitions_used": [
      "full_time_student",
      "first_time_freshman",
      "transfer_student"
    ],
    "source_systems": [
      "Banner Student",
      "Banner Financial Aid"
    ],
    "etl_job_runs": [
      {
        "job_name": "Banner StudentSync",
        "run_at": "2025-09-20T02:00:00Z",
        "status": "success",
        "records_processed": 500000
      }
    ]
  }
}
```

---

### 3.3 Reports — Validate Report

```
POST /reports/{report_id}/validate
```

**Description:** Runs validation rules against the report data: canonical definition checks, cross-mart comparisons, and agency-specific business rules.

**Response (200 OK):**
```json
{
  "report_id": "rpt-feds-001",
  "validation_status": "PASS",
  "validation_timestamp": "2025-09-20T14:35:00Z",
  "checks": [
    {
      "check_name": "Canonical Definition Check",
      "status": "PASS",
      "details": "All counts match canonical definitions v1"
    },
    {
      "check_name": "Cross-Mart Validation: IPEDS vs CBM",
      "status": "PASS",
      "details": "ft_undergrad_count difference: 0 (within ±10 tolerance)"
    },
    {
      "check_name": "Cross-Mart Validation: IPEDS vs FISAP",
      "status": "PASS",
      "details": "pell_recipient_count difference: 0 (within ±1% tolerance)"
    },
    {
      "check_name": "Agency Business Rules",
      "status": "PASS",
      "details": "All IPEDS-specific business rules satisfied"
    }
  ],
  "errors": [],
  "warnings": []
}
```

**Response (200 OK with FAIL):**
```json
{
  "report_id": "rpt-state-001",
  "validation_status": "FAIL",
  "validation_timestamp": "2025-09-20T14:35:00Z",
  "checks": [
    {
      "check_name": "Canonical Definition Check",
      "status": "PASS"
    },
    {
      "check_name": "Cross-Mart Validation: IPEDS vs CBM",
      "status": "FAIL",
      "details": "ft_undergrad_count difference: 12 (exceeds ±10 tolerance). IPEDS=3456, CBM=3444.",
      "severity": "high",
      "recommended_action": "Review Banner StudentSync ETL for CBM001. Possible duplicate PIDMs in CBM extract."
    }
  ],
  "errors": [
    {
      "code": "CROSS_MART_DISCREPANCY",
      "message": "ft_undergrad_count differs between IPEDS and CBM by 12 students",
      "severity": "high",
      "affected_marts": ["federal_ipeds", "state_cbm"]
    }
  ],
  "warnings": []
}
```

---

### 3.4 Reports — Submit Report

```
POST /reports/{report_id}/submit
```

**Description:** Marks the report as submitted and records the submission confirmation. **Note:** This does NOT auto-submit to the agency — it records the submission after the user has manually submitted via the agency portal.

**Request Body:**
```json
{
  "submitted_by": "compliance_officer_001",
  "submission_date": "2025-10-10T14:00:00Z",
  "submission_method": "IPEDS Portal (manual)",
  "submission_ack": "IPEDS-2025-FE-67890",
  "submission_url": "https://surveys.nces.ed.gov/ipeds",
  "notes": "Submitted after validation PASS. No discrepancies."
}
```

**Response (201 Created):**
```json
{
  "report_id": "rpt-feds-001",
  "status": "submitted",
  "submitted_at": "2025-10-10T14:00:00Z",
  "submission_ack": "IPEDS-2025-FE-67890",
  "audit_event_id": "evt-abc-123"
}
```

---

### 3.5 Reports — Get Reporting Calendar

```
GET /reports/calendar
```

**Description:** Returns the full reporting calendar with deadlines, statuses, and alert levels for all 12 agency data marts.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `start_date` | query | date | ❌ | Filter start | `2025-10-01` |
| `end_date` | query | date | ❌ | Filter end | `2026-03-31` |
| `alert_level` | query | string | ❌ | Filter: CRITICAL, WARNING, NOTICE | `CRITICAL` |

**Response (200 OK):**
```json
{
  "calendar": [
    {
      "report_id": "rpt-feds-001",
      "agency_tier": "Federal",
      "agency": "IPEDS",
      "report_name": "Fall Enrollment",
      "reporting_year": 2025,
      "deadline": "2025-10-15",
      "days_until_deadline": 5,
      "alert_level": "WARNING",
      "status": "validated",
      "action_required": "Submit via IPEDS portal before deadline"
    },
    {
      "report_id": "rpt-feds-004",
      "agency_tier": "Federal",
      "agency": "Clery",
      "report_name": "Annual Security Report (ASR)",
      "reporting_year": 2025,
      "deadline": "2025-10-01",
      "days_until_deadline": -9,
      "alert_level": "CRITICAL",
      "status": "draft",
      "action_required": "OVERDUE — Submit immediately. Required by 34 CFR §668.46."
    }
  ]
}
```

---

### 3.6 Canonical Definitions — List

```
GET /canonical/definitions
```

**Description:** Returns all authoritative canonical definitions. Used by data governance team to review and update definitions.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `namespace` | query | string | ❌ | Filter: student, finance, research, hr, facilities, safety | `student` |
| `is_active` | query | boolean | ❌ | Filter active only | `true` |
| `search` | query | string | ❌ | Search in name/description | `full_time` |

**Response (200 OK):**
```json
{
  "definitions": [
    {
      "concept_id": "550e8400-e29b-41d4-a716-446655440001",
      "concept_namespace": "student",
      "concept_key": "full_time_student",
      "concept_name": "Full-Time Student (Undergraduate)",
      "concept_description": "Undergraduate student enrolled for 12 or more credit hours...",
      "sql_logic": "SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_ENRL_STATUS='E' AND SGBSTDN_CRED_HOURS >= 12 AND SGBSTDN_LEVL_CODE='UG'",
      "source_system_of_truth": "Banner Student",
      "version": 1,
      "effective_date": "2026-01-01",
      "is_active": true,
      "uco_node_id": "UCO-EDU-LAM-2300"
    }
  ],
  "total": 17
}
```

---

### 3.7 Canonical Definitions — Update (Admin Only)

```
POST /canonical/definitions
```

**Description:** Creates a new version of a canonical definition. Requires CDO approval workflow.

**Request Body:**
```json
{
  "concept_namespace": "student",
  "concept_key": "full_time_student",
  "concept_name": "Full-Time Student (Undergraduate)",
  "concept_description": "Updated definition: now includes 12+ credit hours OR equivalent contact hours for competency-based education.",
  "sql_logic": "SELECT * FROM BANNER.SGBSTDN WHERE SGBSTDN_ENRL_STATUS='E' AND (SGBSTDN_CRED_HOURS >= 12 OR SGBSTDN_CONTACT_HOURS >= 540) AND SGBSTDN_LEVL_CODE='UG'",
  "source_system_of_truth": "Banner Student",
  "version": 2,
  "effective_date": "2026-07-01",
  "change_author": "cdo@lamar.edu",
  "change_justification": "Competency-based education programs now award credit by contact hours. IPEDS 2026 guidance updated.",
  "uco_node_id": "UCO-EDU-LAM-2300"
}
```

**Response (202 Accepted):**
```json
{
  "concept_id": "550e8400-e29b-41d4-a716-446655440002",
  "status": "pending_approval",
  "approval_workflow_id": "wf-123",
  "message": "Definition change submitted for CDO approval. Current version remains active until approved."
}
```

---

### 3.8 ETL — Job Status

```
GET /etl/jobs
```

**Description:** Returns the status of all ETL jobs.

**Response (200 OK):**
```json
{
  "jobs": [
    {
      "job_id": "job-001",
      "job_name": "Banner StudentSync",
      "source_system": "Banner Student",
      "target_mart": "federal_ipeds",
      "last_run_at": "2025-09-20T02:00:00Z",
      "last_run_status": "success",
      "last_run_records": 500000,
      "last_run_errors": 0,
      "schedule": "0 2 * * * CST",
      "active": true
    },
    {
      "job_id": "job-008",
      "job_name": "Omnigo EventStream",
      "source_system": "Omnigo",
      "target_mart": "federal_clery",
      "last_run_at": "2025-09-20T14:30:00Z",
      "last_run_status": "success",
      "schedule": "real-time",
      "active": true
    }
  ]
}
```

---

### 3.9 ETL — Job Run History

```
GET /etl/jobs/{job_id}/runs
```

**Description:** Returns the run history for a specific ETL job.

**Response (200 OK):**
```json
{
  "job_id": "job-001",
  "runs": [
    {
      "run_id": "run-001",
      "started_at": "2025-09-20T02:00:00Z",
      "completed_at": "2025-09-20T02:15:00Z",
      "status": "success",
      "records_source": 500000,
      "records_inserted": 4500,
      "records_updated": 1200,
      "records_deleted": 0,
      "records_rejected": 0,
      "error_count": 0,
      "duration_ms": 900000
    }
  ]
}
```

---

### 3.10 Audit — Reporting Events

```
GET /audit/events
```

**Description:** Returns audit events for reporting activities.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `event_type` | query | string | ❌ | report_generated, submission_sent, validation_failed | `validation_failed` |
| `report_name` | query | string | ❌ | Filter by report | `IPEDS Fall Enrollment` |
| `start_date` | query | date | ❌ | Filter start | `2025-09-01` |
| `end_date` | query | date | ❌ | Filter end | `2025-09-30` |

**Response (200 OK):**
```json
{
  "events": [
    {
      "event_id": "evt-abc-123",
      "event_type": "validation_failed",
      "report_name": "CBM001",
      "agency": "CBM",
      "reporting_period": "2025-2026",
      "event_timestamp": "2025-09-20T14:35:00Z",
      "user_id": "compliance_officer_001",
      "user_role": "compliance_officer",
      "event_details": {
        "validation_status": "FAIL",
        "error_code": "CROSS_MART_DISCREPANCY",
        "error_message": "ft_undergrad_count differs between IPEDS and CBM by 12 students"
      }
    }
  ]
}
```

---

## 4. Dashboard Widgets (Frontend Consumption)

The frontend dashboard consumes these endpoints and renders:

### 4.1 Reporting Calendar Widget
- **API:** `GET /reports/calendar`
- **Display:** Gantt-style calendar with color-coded deadlines (green=validated, yellow=draft, red=overdue)
- **Actions:** Click report → open detail panel → validate → submit

### 4.2 Cross-Mart Validation Widget
- **API:** `GET /reports` + `POST /reports/{id}/validate`
- **Display:** Traffic light status for each report (green=PASS, yellow=WARN, red=FAIL)
- **Alert:** Auto-refresh every 15 minutes; banner alert on any FAIL

### 4.3 ETL Health Widget
- **API:** `GET /etl/jobs`
- **Display:** Real-time status of all 15 ETL jobs (running, success, failed, queued)
- **Alert:** Slack/Teams notification on any failed job

### 4.4 Canonical Definitions Widget
- **API:** `GET /canonical/definitions`
- **Display:** Table of all 17+ definitions with version history, effective dates, and change log
- **Actions:** Propose change → triggers approval workflow

---

## 5. Error Codes

| Code | HTTP Status | Description | CoPilot Response |
|------|-------------|-------------|-----------------|
| `REPORT_NOT_FOUND` | 404 | Report ID does not exist | "That report doesn't exist in the system. Please check the report ID." |
| `VALIDATION_FAILED` | 400 | Report data failed validation | "This report has validation errors. Please review the discrepancies before submitting." |
| `CROSS_MART_DISCREPANCY` | 400 | Data disagrees between marts | "IPEDS and CBM numbers don't match. The Data Governance team has been notified." |
| `ETL_JOB_FAILED` | 503 | Source ETL job failed | "Data is stale — the last ETL job failed. Please try again in 30 minutes." |
| `UNAUTHORIZED` | 403 | User lacks permission | "You don't have permission to access this report. Contact the Compliance Office." |
| `CANONICAL_PENDING` | 202 | Definition change pending approval | "This definition is under review. The current version is still active." |
| `SUBMISSION_CLOSED` | 400 | Agency portal closed | "The agency submission window is closed. Contact the agency for late submission procedures." |

---

## 6. Rate Limits

| Tier | Requests/minute | Burst | Use Case |
|------|----------------|-------|----------|
| Dashboard (Compliance Officer) | 120 | 50 | Calendar, validation, ETL health |
| Report Generation (Admin) | 60 | 20 | Large data exports |
| Agent Swarm | 300 | 100 | Automated monitoring |
| Student/Faculty (read-only) | 30 | 10 | Public dashboards |

---

## 7. WebSocket Events (Real-Time Updates)

For the dashboard, the API also exposes WebSocket events:

```
ws://api.ioscos.com/v1/module1/events
```

**Event Types:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `etl.job.completed` | `{job_id, status, records_processed}` | ETL job finishes |
| `validation.failed` | `{report_id, errors[]}` | Cross-mart validation FAIL |
| `report.submitted` | `{report_id, ack}` | User submits report |
| `deadline.approaching` | `{report_id, days_remaining}` | 7 days before deadline |
| `deadline.overdue` | `{report_id}` | Deadline passed |
| `canonical.updated` | `{concept_id, version}` | New definition approved |

---

*End of API Specification.*
