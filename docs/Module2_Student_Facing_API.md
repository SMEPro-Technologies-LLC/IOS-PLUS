# Module 2: Student-Facing REST API Specification
## SMEPro COS — Operational Intelligence Engine
## Version: 2026.06.20-LAMAR-MOD2-1.0
## Date: 2026-06-20

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  STUDENT-FACING INTERFACE (React / Next.js / CoPilot)              │
│  Advisor Dashboard | Registrar Portal | Chair Dashboard | Dean View  │
├─────────────────────────────────────────────────────────────────────┤
│  REST API GATEWAY — /v1/module2/*                                   │
│  UC-01 Persistence | UC-02 Crosswalk | UC-03 Gap | UC-04 Align    │
│  UC-05 GLI | UC-06 AI-Grader | UC-07 Funnel | UC-08 Monitor      │
├─────────────────────────────────────────────────────────────────────┤
│  MODULE 2 SCHEMA — PostgreSQL 16+                                   │
│  7 schemas: analytics, advisor, registrar, accreditation, faculty   │
│  enrollment, compliance_monitor                                     │
├─────────────────────────────────────────────────────────────────────┤
│  MODULE 1 DATA LAYER (canonical definitions + 12 agency marts)      │
│  Provides governed, validated, report-ready data for analytics     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Base URL & Authentication

```
Production:  https://api.ioscos.com/v1/module2
Staging:     https://api-staging.ioscos.com/v1/module2
Local:       http://localhost:8080/v1/module2
```

**Headers:**
```http
Authorization: Bearer <JWT_TOKEN>
X-Institution-ID: lamar-university
X-User-Role: advisor          # student, advisor, registrar, chair, dean, admin, agent
X-Request-ID: <UUID>
```

---

## 3. UC-01: Predictive Persistence

### 3.1 GET /persistence/students

**Description:** Returns all students with their current-week activity composite, risk tier, and top factors.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `risk_tier` | query | string | ❌ | Filter: GREEN, YELLOW, RED | `RED` |
| `advisor_id` | query | string | ❌ | Filter by assigned advisor | `ADV-001` |
| `reporting_week` | query | date | ❌ | Default: latest week | `2025-09-15` |
| `limit` | query | integer | ❌ | Page size | `50` |
| `offset` | query | integer | ❌ | Pagination offset | `0` |

**Response (200 OK):**
```json
{
  "students": [
    {
      "student_syn_id": "SYN-12345",
      "composite_score": 34,
      "risk_tier": "RED",
      "tier_change": "worsened",
      "top_factors": [
        {"factor": "bb_login_count", "weight": 0.35, "z_score": -2.1, "description": "No Blackboard login in 7 days"},
        {"factor": "bb_assignment_submissions", "weight": 0.28, "z_score": -1.8, "description": "2 missing assignments"},
        {"factor": "touchnet_payment_activity", "weight": 0.20, "z_score": -1.5, "description": "Tuition payment overdue"}
      ],
      "data_sources": ["Banner", "Blackboard", "TouchNet"],
      "reporting_week": "2025-09-15",
      "advisor_id": "ADV-001",
      "advisor_name": "Dr. Jane Smith",
      "last_intervention": {
        "action_type": "email",
        "action_timestamp": "2025-09-10T14:00:00Z",
        "outcome": "no_response"
      }
    }
  ],
  "summary": {
    "total": 245,
    "green": 180,
    "yellow": 45,
    "red": 20,
    "red_new_this_week": 5,
    "red_improved": 2
  }
}
```

### 3.2 GET /persistence/digest

**Description:** Returns the weekly RED-tier digest for advisors — ranked list of highest-risk students with suggested actions.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `advisor_id` | query | string | ✅ | Advisor ID | `ADV-001` |
| `format` | query | string | ❌ | `json` (default) or `email` | `json` |

**Response (200 OK):**
```json
{
  "advisor_id": "ADV-001",
  "reporting_week": "2025-09-15",
  "red_tier_count": 8,
  "students": [
    {
      "rank": 1,
      "student_syn_id": "SYN-12345",
      "composite_score": 34,
      "top_factors": [
        {"factor": "bb_login_count", "description": "No Blackboard login in 7 days"}
      ],
      "suggested_action": "Phone call — student has not logged into Blackboard for 7 days and has 2 missing assignments. Last email had no response.",
      "last_intervention_days": 5
    }
  ],
  "prior_week_comparison": {
    "red_count_last_week": 6,
    "red_count_this_week": 8,
    "change": "+2"
  }
}
```

### 3.3 POST /persistence/intervention

**Description:** Log an advisor intervention action.

**Request Body:**
```json
{
  "student_syn_id": "SYN-12345",
  "advisor_id": "ADV-001",
  "action_type": "phone_call",
  "action_notes": "Student answered. Cited financial stress and work schedule conflict. Referred to Financial Aid and Student Success Center.",
  "follow_up_required": true,
  "follow_up_date": "2025-09-22",
  "outcome": "student_responsive"
}
```

**Response (201 Created):**
```json
{
  "action_id": "act-abc-123",
  "student_syn_id": "SYN-12345",
  "status": "logged",
  "next_action_suggested": "Follow up on 2025-09-22 regarding Financial Aid and Student Success Center referrals."
}
```

---

## 4. UC-02: Transcript Crosswalk

### 4.1 GET /crosswalk/queue

**Description:** Returns the transcript crosswalk evaluation queue for registrars.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `status` | query | string | ❌ | Filter: PENDING, APPROVED, MODIFIED, REJECTED | `PENDING` |
| `confidence_min` | query | decimal | ❌ | Minimum confidence score | `0.85` |
| `source_institution` | query | string | ❌ | Filter by source school | `San Jacinto College` |
| `limit` | query | integer | ❌ | Page size | `50` |

**Response (200 OK):**
```json
{
  "queue": [
    {
      "queue_id": "qwe-123",
      "student_syn_id": "SYN-67890",
      "source_institution": "San Jacinto College",
      "source_course_code": "BIOL 1406",
      "source_course_title": "Biology for Science Majors I",
      "source_credit_hours": 4.0,
      "source_grade": "B+",
      "proposed_lamar_course": "BIOL 1306",
      "proposed_lamar_title": "Biology for Science Majors I",
      "proposed_credit_hours": 3.0,
      "confidence_score": 0.96,
      "confidence_factors": [
        {"factor": "title_similarity", "score": 0.98},
        {"factor": "credit_hours_proximity", "score": 0.95},
        {"factor": "common_course_number", "score": 1.00}
      ],
      "nlp_match_method": "BERT_embedding",
      "nlp_similarity_score": 0.94,
      "registrar_action": "PENDING",
      "auto_approve_eligible": true,
      "recommended_action": "APPROVE"
    }
  ],
  "summary": {
    "total_pending": 47,
    "auto_approve_eligible": 12,
    "avg_confidence": 0.82
  }
}
```

### 4.2 POST /crosswalk/{queue_id}/action

**Description:** Registrar one-click action: Approve, Modify, or Reject.

**Request Body:**
```json
{
  "action": "APPROVED",
  "registrar_id": "REG-001",
  "notes": "High-confidence match. Common course number. Auto-approved.",
  "ethos_writeback": true
}
```

**Response (200 OK):**
```json
{
  "queue_id": "qwe-123",
  "status": "APPROVED",
  "ethos_writeback_status": "success",
  "ethos_writeback_log": "Banner Ethos write-back completed at 2025-09-20T14:30:00Z. Transfer credit applied to student record.",
  "next_steps": "Student notified via email. Updated transcript available in Banner within 24 hours."
}
```

### 4.3 GET /crosswalk/equivalency-rules

**Description:** Browse the canonical equivalency rule library.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `source_institution` | query | string | ❌ | Filter by source school | `SJC` |
| `source_course` | query | string | ❌ | Search source course | `BIOL` |
| `is_active` | query | boolean | ❌ | Filter active rules | `true` |

**Response (200 OK):**
```json
{
  "rules": [
    {
      "rule_id": "rule-001",
      "source_institution_code": "SJC",
      "source_course_code": "BIOL 1406",
      "source_course_title": "Biology for Science Majors I",
      "lamar_course_code": "BIOL 1306",
      "lamar_course_title": "Biology for Science Majors I",
      "credit_hours_map": 3.0,
      "grade_minimum": "C",
      "confidence_baseline": 0.95,
      "rule_type": "common_course_number",
      "effective_date": "2024-01-01",
      "is_active": true
    }
  ]
}
```

---

## 5. UC-03: Accreditation Gap Analysis

### 5.1 GET /accreditation/heat-map

**Description:** Returns the accreditation gap heat map for all standards.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `accrediting_body` | query | string | ❌ | SACSCOC, AACSB, ABET, ACEN, CCNE | `SACSCOC` |
| `heat_map_color` | query | string | ❌ | Filter: RED, ORANGE, YELLOW, GREEN | `RED` |

**Response (200 OK):**
```json
{
  "accrediting_body": "SACSCOC",
  "standards": [
    {
      "standard_code": "SACSCOC-CR-2.7",
      "standard_title": "Programmatic Accreditation",
      "met_count": 2,
      "partial_count": 1,
      "not_met_count": 0,
      "missing_count": 0,
      "heat_map_color": "YELLOW",
      "evidence": [
        {
          "evidence_id": "ev-001",
          "evidence_title": "ACEN Accreditation Letter 2024",
          "gap_verdict": "MET",
          "nlp_match_score": 0.95
        },
        {
          "evidence_id": "ev-002",
          "evidence_title": "AACSB Application Progress Report",
          "gap_verdict": "PARTIALLY_MET",
          "gap_rationale": "Application submitted but initial review pending. Expected completion by Q2 2026.",
          "nlp_match_score": 0.72
        }
      ]
    }
  ],
  "summary": {
    "total_standards": 87,
    "green": 65,
    "yellow": 15,
    "orange": 5,
    "red": 2
  }
}
```

### 5.2 GET /accreditation/standards/{standard_code}/evidence

**Description:** Returns all evidence for a specific standard with NLP match details.

**Response (200 OK):**
```json
{
  "standard_code": "SACSCOC-CR-2.7",
  "standard_title": "Programmatic Accreditation",
  "standard_description": "The institution provides appropriate academic and student support services...",
  "evidence": [
    {
      "evidence_id": "ev-001",
      "evidence_title": "ACEN Accreditation Letter 2024",
      "evidence_type": "report",
      "evidence_location": "https://sharepoint.lamar.edu/accreditation/acen-2024.pdf",
      "evidence_owner": "Dean of Nursing",
      "evidence_date": "2024-06-15",
      "nlp_match_score": 0.95,
      "nlp_match_method": "BERT",
      "gap_verdict": "MET",
      "gap_rationale": "ACEN accreditation is current and valid through 2028."
    }
  ]
}
```

### 5.3 POST /accreditation/evidence

**Description:** Add new evidence to the inventory.

**Request Body:**
```json
{
  "standard_id": "std-abc-123",
  "evidence_title": "Updated Student Services Survey 2025",
  "evidence_description": "Annual survey of student satisfaction with academic advising, tutoring, and career services.",
  "evidence_type": "survey",
  "evidence_location": "https://sharepoint.lamar.edu/surveys/student-services-2025.pdf",
  "evidence_owner": "Student Affairs",
  "evidence_date": "2025-05-01",
  "reviewed_by": "Dr. Jane Smith",
  "review_date": "2025-06-01"
}
```

**Response (201 Created):**
```json
{
  "evidence_id": "ev-999",
  "status": "added",
  "nlp_analysis": {
    "match_score": 0.78,
    "match_method": "BERT",
    "suggested_verdict": "PARTIALLY_MET",
    "rationale": "Survey covers advising and tutoring but does not explicitly address career services metrics."
  }
}
```

---

## 6. UC-04: Outcome Alignment Auditor

### 6.1 GET /alignment/courses

**Description:** Returns all courses with three-way alignment status.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `term_code` | query | string | ❌ | Filter by term | `2025F` |
| `alignment_flag` | query | string | ❌ | Filter: OK, MISSING_CLO, GHOST_ASSESSMENT, WEIGHT_MISMATCH | `MISSING_CLO` |
| `program_code` | query | string | ❌ | Filter by program | `51.3801` |

**Response (200 OK):**
```json
{
  "courses": [
    {
      "course_code": "ACCT 2301",
      "course_title": "Principles of Financial Accounting",
      "term_code": "2025F",
      "instructor_id": "FAC-001",
      "instructor_name": "Dr. Robert Johnson",
      "clos": [
        {
          "clo_number": 1,
          "clo_statement": "Students will be able to prepare basic financial statements.",
          "syllabus_assessment": "Final Exam (50%), Homework (30%), Participation (20%)",
          "syllabus_weight": 50.0,
          "bb_column_name": "Final Exam",
          "bb_column_type": "test",
          "bb_weight": 50.0,
          "alignment_flag": "OK",
          "copilot_status": "✅ Aligned"
        },
        {
          "clo_number": 2,
          "clo_statement": "Students will be able to analyze financial ratios.",
          "syllabus_assessment": "Project (40%), Midterm (30%), Homework (30%)",
          "syllabus_weight": 40.0,
          "bb_column_name": null,
          "bb_column_type": null,
          "bb_weight": null,
          "alignment_flag": "MISSING_CLO",
          "copilot_status": "❌ CLO not mapped to any gradebook column"
        }
      ],
      "alignment_summary": {
        "ok_count": 1,
        "missing_clo_count": 1,
        "ghost_assessment_count": 0,
        "weight_mismatch_count": 0
      }
    }
  ]
}
```

### 6.2 POST /alignment/courses/{course_code}/fix

**Description:** Submit a fix for an alignment issue (triggers Blackboard API update or syllabus revision workflow).

**Request Body:**
```json
{
  "term_code": "2025F",
  "clo_number": 2,
  "fix_type": "bb_column_added",
  "bb_column_name": "Financial Ratio Analysis Project",
  "bb_column_type": "assignment",
  "bb_weight": 40.0,
  "instructor_id": "FAC-001",
  "notes": "Added missing gradebook column for CLO-2. Project now aligned with syllabus."
}
```

**Response (200 OK):**
```json
{
  "course_code": "ACCT 2301",
  "term_code": "2025F",
  "fix_status": "applied",
  "bb_update_status": "success",
  "alignment_verified": "OK",
  "next_review": "Alignment will be re-scanned in next nightly batch."
}
```

---

## 7. UC-05: Grading Load Analyzer

### 7.1 GET /faculty/grading-load

**Description:** Returns Grading Load Index (GLI) for all faculty-course combinations.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `term_code` | query | string | ❌ | Filter by term | `2025F` |
| `instructor_id` | query | string | ❌ | Filter by faculty | `FAC-001` |
| `gli_category` | query | string | ❌ | Filter: LOW, MODERATE, HIGH, EXTREME | `EXTREME` |
| `crunch_week_only` | query | boolean | ❌ | Show only crunch-week courses | `true` |

**Response (200 OK):**
```json
{
  "courses": [
    {
      "course_code": "NURS 3301",
      "term_code": "2025F",
      "instructor_id": "FAC-001",
      "instructor_name": "Dr. Jane Smith",
      "enrollment_count": 45,
      "assignment_items_count": 24,
      "exam_items_count": 4,
      "discussion_items_count": 8,
      "project_items_count": 2,
      "rubric_use_rate": 0.85,
      "rubric_avg_criteria": 6.2,
      "weight_factor": 12.0,
      "items_factor": 38,
      "rubric_factor": 5.27,
      "enrollment_factor": 45,
      "gli_score": 107892.0,
      "gli_category": "EXTREME",
      "ga_hours_allocated": 10.0,
      "ga_hours_recommended": 18.5,
      "ga_allocation_gap": 8.5,
      "crunch_week_flag": true,
      "yoy_change_pct": 25.0,
      "escalation_flag": true,
      "copilot_status": "🔴 EXTREME"
    }
  ],
  "summary": {
    "total_courses": 120,
    "low": 45,
    "moderate": 50,
    "high": 20,
    "extreme": 5,
    "avg_gli": 24500.0
  }
}
```

### 7.2 GET /faculty/crunch-week-heatmap

**Description:** Returns the crunch-week heat map for department chairs.

**Response (200 OK):**
```json
{
  "term_code": "2025F",
  "weeks": [
    {
      "week_of": "2025-10-13",
      "courses_with_due_dates": 8,
      "extreme_load_courses": 2,
      "high_load_courses": 3,
      "total_items_due": 45,
      "affected_students": 320,
      "advisory": "⚠️ Week of Oct 13 has 45 items due across 8 courses. 2 courses are EXTREME load. Consider extending deadlines or redistributing assignments."
    }
  ]
}
```

---

## 8. UC-06: AI-Grader Assignment

### 8.1 GET /ai-grader/routing

**Description:** Returns AI-grader routing recommendations for all courses.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `term_code` | query | string | ❌ | Filter by term | `2025F` |
| `instructor_id` | query | string | ❌ | Filter by faculty | `FAC-001` |
| `recommended_tier` | query | string | ❌ | Filter by tier | `AVA_FEEDBACK` |

**Response (200 OK):**
```json
{
  "courses": [
    {
      "course_code": "NURS 3301",
      "term_code": "2025F",
      "section_id": "SEC-001",
      "instructor_id": "FAC-001",
      "instructor_name": "Dr. Jane Smith",
      "class_size": 45,
      "complexity_score": 78.5,
      "assignment_type_mix": {"mcq": 0.2, "essay": 0.4, "project": 0.3, "code": 0.1},
      "current_tier": "NONE",
      "recommended_tier": "AVA_FEEDBACK",
      "recommended_tier_rationale": "High essay load (40%) with complex rubrics. AVA Assisted Feedback can reduce grading time by 35% while preserving pedagogical quality.",
      "lead_professor_id": "FAC-001",
      "lead_professor_review": true,
      "estimated_ai_cost_per_student": 12.50,
      "estimated_annual_savings": 18750.0,
      "bb_course_id": "BB_2025F_NURS3301_001",
      "bb_integration_status": "connected"
    }
  ],
  "summary": {
    "total_courses": 120,
    "none": 80,
    "ava_feedback": 25,
    "auto_grade_l1": 10,
    "auto_grade_l2": 3,
    "human_review": 2,
    "total_estimated_savings": 245000.0
  }
}
```

### 8.2 POST /ai-grader/routing/{course_code}/apply

**Description:** Apply an AI-grader tier to a course (requires chair approval).

**Request Body:**
```json
{
  "term_code": "2025F",
  "section_id": "SEC-001",
  "tier": "AVA_FEEDBACK",
  "approved_by_chair": "CHAIR-001",
  "rationale": "High essay load with complex rubrics. AVA feedback reduces grading burden while maintaining quality. Lead professor retains final grade authority."
}
```

**Response (200 OK):**
```json
{
  "course_code": "NURS 3301",
  "term_code": "2025F",
  "tier_applied": "AVA_FEEDBACK",
  "bb_integration_status": "connected",
  "ava_feedback_enabled": true,
  "lead_professor_review_required": true,
  "estimated_cost": 562.50,
  "estimated_savings": 8750.0
}
```

---

## 9. UC-07: Enrollment Funnel Diagnostics

### 9.1 GET /enrollment/funnel

**Description:** Returns enrollment funnel conversion metrics by cohort.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `cohort_year` | query | string | ❌ | Filter by cohort | `Fall 2025` |
| `lead_source` | query | string | ❌ | Filter by lead source | `website` |

**Response (200 OK):**
```json
{
  "cohort": "Fall 2025",
  "total_applications": 5200,
  "completed_applications": 4800,
  "admitted": 3200,
  "deposited": 1800,
  "registered": 1500,
  "enrolled": 1450,
  "conversion_rates": {
    "app_to_admit": 61.54,
    "admit_to_deposit": 56.25,
    "deposit_to_reg": 83.33,
    "reg_to_census": 96.67
  },
  "cycle_times": {
    "avg_total_hours": 720.0,
    "avg_app_to_decision_hours": 168.0,
    "avg_decision_to_deposit_hours": 96.0,
    "avg_deposit_to_reg_hours": 72.0,
    "avg_reg_to_census_hours": 384.0
  },
  "dropout_analysis": {
    "total_dropped": 3750,
    "by_stage": {
      "application_incomplete": 400,
      "admission_denied": 1600,
      "no_deposit": 1400,
      "no_registration": 300,
      "no_census": 50
    },
    "by_reason": {
      "financial_aid_gap": 450,
      "competitor_enrolled": 380,
      "housing_unavailable": 120,
      "changed_major_plans": 200,
      "unknown": 2600
    }
  }
}
```

### 9.2 GET /enrollment/funnel/students

**Description:** Returns individual student funnel stage data for deep analysis.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `dropped_at_stage` | query | string | ❌ | Filter by drop stage | `no_deposit` |
| `dropped_reason` | query | string | ❌ | Filter by reason | `financial_aid_gap` |
| `limit` | query | integer | ❌ | Page size | `50` |

**Response (200 OK):**
```json
{
  "students": [
    {
      "student_syn_id": "SYN-99999",
      "entry_cohort_year": "Fall 2025",
      "application_received_at": "2025-01-15T10:00:00Z",
      "application_complete_at": "2025-01-20T14:00:00Z",
      "admission_decision_at": "2025-02-01T09:00:00Z",
      "deposit_paid_at": null,
      "dropped_at_stage": "no_deposit",
      "dropped_reason": "financial_aid_gap",
      "lead_source": "website",
      "total_funnel_hours": 408
    }
  ],
  "summary": {
    "total_dropped": 3750,
    "avg_funnel_hours_before_drop": 350.0
  }
}
```

---

## 10. UC-08: Continuous Compliance Monitoring

### 10.1 GET /compliance-monitor/alerts

**Description:** Returns pending compliance alerts from the 24/7 monitoring agent swarm.

**Parameters:**

| Name | In | Type | Required | Description | Example |
|------|----|------|----------|-------------|---------|
| `severity` | query | string | ❌ | Filter: CRITICAL, HIGH, MEDIUM, LOW | `CRITICAL` |
| `review_status` | query | string | ❌ | Filter: pending, approved, rejected | `pending` |
| `agency` | query | string | ❌ | Filter by agency | `FSA` |
| `days` | query | integer | ❌ | Last N days | `7` |

**Response (200 OK):**
```json
{
  "alerts": [
    {
      "change_id": "chg-001",
      "detected_at": "2025-09-20T06:00:00Z",
      "source_name": "Federal Register",
      "agency": "FSA",
      "change_type": "new_rule",
      "change_title": "Final Rule: Changes to 90/10 Revenue Requirements for Public Institutions",
      "change_summary": "FSA issued final rule updating 90/10 reporting requirements. Public institutions must now report quarterly rather than annually.",
      "impact_severity": "CRITICAL",
      "impacted_uco_nodes": ["UCO-MOD1-0011"],
      "impact_assessment": "This change requires immediate updates to the 90/10 data mart (module1_marts.federal_title_iv). Quarterly reporting cycles must be implemented before Q1 2026. Cross-mart validation rules may need adjustment.",
      "human_review_required": true,
      "review_status": "pending",
      "copilot_action": "🔴 CRITICAL — Review within 4 hours"
    }
  ],
  "summary": {
    "total_pending": 3,
    "critical": 1,
    "high": 1,
    "medium": 1,
    "low": 0
  }
}
```

### 10.2 POST /compliance-monitor/alerts/{change_id}/review

**Description:** Human review and approval of a detected regulatory change.

**Request Body:**
```json
{
  "review_status": "approved",
  "reviewed_by": "compliance_officer_001",
  "review_notes": "Confirmed: FSA final rule requires quarterly 90/10 reporting. Approved for implementation in Q1 2026. Update ETL schedule and data mart schema.",
  "deploy_to_trace": true
}
```

**Response (200 OK):**
```json
{
  "change_id": "chg-001",
  "review_status": "approved",
  "deployed_to_trace": true,
  "deployment_tx_hash": "0xabc123def456...",
  "deployment_at": "2025-09-20T14:30:00Z",
  "next_steps": [
    "Update ETL schedule for 90/10 to quarterly (from annual)",
    "Modify module1_marts.federal_title_iv schema",
    "Notify Financial Aid Director and Controller",
    "Update Unified Reporting Portal calendar"
  ]
}
```

### 10.3 GET /compliance-monitor/sources

**Description:** Returns all monitored regulatory sources and their status.

**Response (200 OK):**
```json
{
  "sources": [
    {
      "source_id": "src-001",
      "source_name": "Federal Register",
      "source_url": "https://www.federalregister.gov",
      "source_type": "federal_register",
      "agency_tier": "Federal",
      "agency": "FSA",
      "check_frequency_minutes": 60,
      "last_check_at": "2025-09-20T14:00:00Z",
      "last_check_status": "success",
      "is_active": true,
      "uco_node_ids_affected": ["UCO-MOD1-0008", "UCO-MOD1-0011", "UCO-MOD1-0012"]
    },
    {
      "source_id": "src-002",
      "source_name": "Texas Register",
      "source_url": "https://www.sos.state.tx.us/texreg",
      "source_type": "state_register",
      "agency_tier": "State",
      "agency": "THECB",
      "check_frequency_minutes": 120,
      "last_check_at": "2025-09-20T13:00:00Z",
      "last_check_status": "success",
      "is_active": true,
      "uco_node_ids_affected": ["UCO-MOD1-0018", "UCO-MOD1-0021", "UCO-MOD1-0022"]
    }
  ]
}
```

---

## 11. Unified Dashboard Endpoints

### 11.1 GET /dashboard/advisor

**Description:** Returns the unified advisor dashboard with all relevant widgets.

**Response (200 OK):**
```json
{
  "advisor_id": "ADV-001",
  "reporting_week": "2025-09-15",
  "widgets": {
    "red_tier_digest": {
      "count": 8,
      "top_students": [/* ranked list */]
    },
    "transcript_queue": {
      "pending_count": 12,
      "high_confidence_count": 5
    },
    "recent_interventions": {
      "this_week": 15,
      "responsive_rate": 0.67
    }
  }
}
```

### 11.2 GET /dashboard/registrar

**Description:** Returns the unified registrar dashboard.

**Response (200 OK):**
```json
{
  "registrar_id": "REG-001",
  "widgets": {
    "transcript_queue": {
      "total_pending": 47,
      "avg_confidence": 0.82,
      "auto_approve_eligible": 12,
      "avg_turnaround_days": 3.5
    },
    "alignment_issues": {
      "missing_clo_count": 8,
      "weight_mismatch_count": 3
    }
  }
}
```

### 11.3 GET /dashboard/chair

**Description:** Returns the department chair dashboard.

**Response (200 OK):**
```json
{
  "chair_id": "CHAIR-001",
  "department": "Nursing",
  "widgets": {
    "grading_load": {
      "extreme_courses": 2,
      "high_courses": 3,
      "ga_allocation_gap": 15.5
    },
    "ai_grader_routing": {
      "recommended_ava_feedback": 4,
      "estimated_savings": 35000.0
    },
    "alignment_issues": {
      "missing_clo_count": 2,
      "weight_mismatch_count": 1
    }
  }
}
```

### 11.4 GET /dashboard/dean

**Description:** Returns the dean-level executive dashboard.

**Response (200 OK):**
```json
{
  "dean_id": "DEAN-001",
  "college": "College of Arts & Sciences",
  "widgets": {
    "persistence": {
      "college_red_tier_rate": 0.08,
      "college_yoy_improvement": 0.03
    },
    "enrollment": {
      "current_cohort_conversion": 0.72,
      "target": 0.75,
      "gap": -0.03
    },
    "accreditation": {
      "sacscoc_red_count": 1,
      "sacscoc_orange_count": 2,
      "action_required": "Review SACSCOC-CR-2.7 by Oct 1"
    },
    "compliance": {
      "pending_alerts": 3,
      "critical_alerts": 1
    }
  }
}
```

---

## 12. Error Codes

| Code | HTTP Status | Description | CoPilot Response |
|------|-------------|-------------|-----------------|
| `STUDENT_NOT_FOUND` | 404 | SYN ID not found | "I don't see that student in the system. Please verify the student ID." |
| `COURSE_NOT_FOUND` | 404 | Course code not found | "That course isn't in the current term. Please check the course code." |
| `QUEUE_ITEM_NOT_FOUND` | 404 | Transcript queue item not found | "That evaluation item doesn't exist. It may have already been processed." |
| `ALERT_NOT_FOUND` | 404 | Compliance alert not found | "That alert has already been reviewed or resolved." |
| `UNAUTHORIZED_ACTION` | 403 | User lacks role for action | "You don't have permission to perform this action. Contact your department chair." |
| `CHAIR_APPROVAL_REQUIRED` | 403 | AI-grader change needs chair approval | "This change requires department chair approval. Submit a request for review." |
| `BB_INTEGRATION_ERROR` | 503 | Blackboard API unavailable | "Blackboard is temporarily unavailable. The fix will be queued for retry." |
| `MODEL_STALE` | 503 | Predictive model outdated | "The persistence model is being refreshed. Please try again in 10 minutes." |

---

## 13. Rate Limits

| Tier | Requests/minute | Burst | Use Case |
|------|----------------|-------|----------|
| Advisor Dashboard | 120 | 50 | Real-time student monitoring |
| Registrar Portal | 120 | 50 | Transcript processing, alignment fixes |
| Chair Dashboard | 60 | 20 | Grading load, AI-grader review |
| Dean Dashboard | 60 | 20 | Executive summary, enrollment metrics |
| Agent Swarm | 300 | 100 | Automated data ingestion |
| Student (read-only) | 30 | 10 | Self-service persistence score |

---

*End of API Specification.*
