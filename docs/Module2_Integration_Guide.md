# Module 2: Objectives (Student-Facing) — Integration Guide
## SMEPro COS — Operational Intelligence Engine
## Version: 2026.06.20-LAMAR-MOD2-1.0
## Date: 2026-06-20

---

## 1. Executive Summary

Module 2 turns the same governed data from Module 1 into **operational intelligence** for advisors, the registrar, department chairs, and the dean. It addresses the concrete pain points Lamar identified:

- **26% attrition** at **$2,400 per lost student** — 6,500 students × 26% × $2,400 = **$4.06M annual loss**
- **47-day transcript turnaround** — transfer students losing momentum, some dropping out before credit is awarded
- **18-month accreditation scramble** — evidence gathered in panic mode, not systematically
- **Grading workload invisible until it breaks** — faculty burnout, GA allocation reactive, no year-over-year trend data

Module 2 delivers **8 use cases** on one engine. The original five (UC-01 through UC-05) are built and demo-ready. UC-06 through UC-08 are scoped extensions on the same engine.

---

## 2. The Problem Before Module 2

| Pain Point | Current State | Cost / Impact |
|------------|--------------|---------------|
| **26% attrition** | Advisors see at-risk students only after midterm grades posted | $4.06M/year lost revenue + state funding impact |
| **47-day transcript turnaround** | Manual evaluation, registrar staff reviews each course individually | Transfer students lose momentum; some never enroll |
| **18-month accreditation scramble** | Evidence collected in 90-day sprint before site visit | SACSCOC warning in 2022; stress on staff; potential probation |
| **Grading load invisible** | No systematic tracking; faculty complaints reach dean after semester ends | Faculty burnout; 2 resignations in 2024 attributed to workload |
| **AI grading not leveraged** | Instructional Connections outsourced grading at $1.2M–$1.5M/yr | Budget drain; no pedagogical consistency; no data feedback loop |
| **Enrollment funnel opaque** | No stage-by-stage conversion tracking; admissions decisions made on intuition | Over-recruitment in some pipelines; underinvestment in others |
| **Regulatory changes reactive** | Compliance team learns of rule changes from listservs or agency emails | Clery ASR late by 9 days in 2024; $50,000 fine risk |

---

## 3. The Solution: Operational Intelligence Engine

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  STUDENT-FACING INTERFACE                                           │
│  Advisor Dashboard | Registrar Portal | Chair Dashboard | Dean View│
├─────────────────────────────────────────────────────────────────────┤
│  REST API GATEWAY — /v1/module2/*                                 │
│  UC-01 Persistence | UC-02 Crosswalk | UC-03 Gap | UC-04 Align   │
│  UC-05 GLI | UC-06 AI-Grader | UC-07 Funnel | UC-08 Monitor      │
├─────────────────────────────────────────────────────────────────────┤
│  MODULE 2 SCHEMA — PostgreSQL 16+                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_analytics                                          │   │
│  │  • student_activity_signals (UC-01 composite scores)    │   │
│  │  • v_red_tier_digest (advisor weekly digest)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_advisor                                              │   │
│  │  • student_advisor_assignment                               │   │
│  │  • advisor_action_log (interventions, outreach)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_registrar                                          │   │
│  │  • transcript_crosswalk_queue (UC-02 confidence engine)   │   │
│  │  • equivalency_rules (canonical rule library)               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_accreditation                                      │   │
│  │  • standards_library (SACSCOC, AACSB, ABET, ACEN, CCNE)   │   │
│  │  • evidence_inventory (NLP-matched evidence)                │   │
│  │  • v_gap_heat_map (UC-03 dashboard)                         │   │
│  │  • course_learning_outcomes (UC-04 CLO definitions)         │   │
│  │  • v_three_way_alignment (UC-04 CLO↔Syllabus↔BB check)   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_faculty                                            │   │
│  │  • grading_load_index (UC-05 GLI calculations)            │   │
│  │  • v_crunch_week_heatmap (UC-05 chair dashboard)          │   │
│  │  • ai_grader_routing (UC-06 tier assignment)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_enrollment                                         │   │
│  │  • funnel_stages (UC-07 application → census tracking)  │   │
│  │  • v_funnel_conversion (UC-07 conversion metrics)       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module2_compliance_monitor                                 │   │
│  │  • regulatory_sources (UC-08 source registry)             │   │
│  │  • detected_changes (UC-08 change log)                    │   │
│  │  • v_pending_compliance_alerts (UC-08 dashboard)          │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  MODULE 1 DATA LAYER (governed, validated, report-ready)           │
│  12 agency marts + canonical definitions + 15 source connectors   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Use Case Overview

| UC | Name | Problem Solved | Target User | Status |
|----|------|----------------|-------------|--------|
| UC-01 | **Predictive Persistence** | 26% attrition at $2,400/student | Advisors, Student Success | **Built & Demo-Ready** |
| UC-02 | **Transcript Crosswalk** | 47-day turnaround | Registrar | **Built & Demo-Ready** |
| UC-03 | **Accreditation Gap Analysis** | 18-month scramble | Accreditation Officer, Dean | **Built & Demo-Ready** |
| UC-04 | **Outcome Alignment Auditor** | CLO ↔ Syllabus ↔ Blackboard drift | Department Chairs, AACSB | **Built & Demo-Ready** |
| UC-05 | **Grading Load Analyzer** | Invisible workload until burnout | Chairs, Dean, Provost | **Built & Demo-Ready** |
| UC-06 | **AI-Grader Assignment** | Instructional Connections $1.2M–$1.5M/yr | Chairs, Lead Professors | **Scoped Extension** |
| UC-07 | **Enrollment Funnel Diagnostics** | Opaque conversion pipeline | Admissions, Enrollment Mgmt | **Scoped Extension** |
| UC-08 | **Continuous Compliance Monitoring** | Reactive regulatory response | Compliance Officer, CDO | **Scoped Extension** |

---

## 4. UC-01: Predictive Persistence

### 4.1 The Problem
**26% attrition.** By the time midterm grades are posted, it's too late. Advisors need **early warning** — not after the fact.

### 4.2 The Solution
A **weekly 0–100 activity composite** on Banner + Blackboard + Concourse + TouchNet + StarRez signals. Green/Yellow/Red tiers. Top-3 factors per student. Ranked advisor lists and Red-tier digest.

### 4.3 Data Model
- `module2_analytics.student_activity_signals` — weekly composite scores per student
- `module2_advisor.student_advisor_assignment` — advisor caseload mapping
- `module2_advisor.advisor_action_log` — intervention tracking

### 4.4 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Attrition rate | 26% | 18% | Early intervention 6–8 weeks before midterm |
| Advisor caseload | 400:1 | 300:1 | Ranked digest prioritizes highest-risk students |
| Intervention response rate | 45% | 70% | Automated outreach + follow-up reminders |

### 4.5 Example Workflow
1. **Monday 6:00 AM:** ETL job calculates weekly composite scores for all 6,500 students
2. **Monday 8:00 AM:** Advisor dashboard shows Red-tier digest: 20 students this week
3. **Monday 9:00 AM:** Advisor clicks student → sees top-3 factors (no BB login, 2 missing assignments, tuition overdue)
4. **Monday 10:00 AM:** Advisor makes phone call → logs intervention → system schedules follow-up for next week
5. **Monday 2:00 PM:** CoPilot sends automated email to student with Student Success Center resources

---

## 5. UC-02: Transcript Crosswalk

### 5.1 The Problem
**47-day average transcript turnaround.** Manual evaluation by registrar staff. Each course reviewed individually. No standardized rules. Transfer students lose momentum.

### 5.2 The Solution
A **confidence-scored equivalency engine**:
- NLP match against Lamar course catalog (title similarity, BERT embeddings)
- Canonical equivalency rule library for common transfers (SJC, LIT, Houston CC)
- Registrar one-click **Approve / Modify / Reject**
- Banner Ethos **write-back** on approval

### 5.3 Data Model
- `module2_registrar.transcript_crosswalk_queue` — evaluation queue with confidence scores
- `module2_registrar.equivalency_rules` — canonical rule library

### 5.4 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Transcript turnaround | 47 days | 5 days | Auto-approve >95% confidence; queue prioritized by confidence |
| Registrar hours per transcript | 45 min | 10 min | NLP pre-evaluation + one-click action |
| Transfer credit accuracy | 92% | 98% | Canonical rules + BERT similarity scoring |

### 5.5 Example Workflow
1. **Student submits transcript** from San Jacinto College → scanned to queue
2. **System extracts courses** → matches against equivalency rules
3. **BIOL 1406 → BIOL 1306** (confidence: 0.96, common course number match)
4. **System flags:** "Auto-approve eligible — confidence >0.95"
5. **Registrar clicks "Approve"** → Banner Ethos write-back → student notified → credit appears in Banner within 24 hours

---

## 6. UC-03: Accreditation Gap Analysis

### 6.1 The Problem
**18-month accreditation scramble.** Evidence collected in 90-day panic mode before site visit. SACSCOC warning in 2022. Staff stress. Potential probation.

### 6.2 The Solution
**NLP match** against SACSCOC / AACSB / ABET / ACEN / CCNE standards:
- Standards library loaded with full text of every criterion
- Evidence inventory with NLP similarity scoring (BERT embeddings)
- **Met / Partially Met / Not Met / Evidence Missing** verdicts
- Evidence **heat map** dashboard
- Assist-only narratives (no auto-claims — human review always required)

### 6.3 Data Model
- `module2_accreditation.standards_library` — full text of all accreditation standards
- `module2_accreditation.evidence_inventory` — NLP-matched evidence documents
- `v_gap_heat_map` — color-coded dashboard

### 6.4 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Evidence gathering time | 90 days | 0 days (continuous) | Evidence tracked continuously, not in sprint |
| Gap identification | Ad hoc | Weekly automated scan | NLP scans new evidence against standards automatically |
| SACSCOC status | Warning | Clear | Proactive gap management prevents findings |

### 6.5 Example Workflow
1. **Student Affairs uploads** updated student services survey to SharePoint
2. **System detects new document** → NLP extracts text → matches against SACSCOC standards
3. **Match found:** SACSCOC-CR-2.7 (Student Services) — similarity score 0.72
4. **System verdict:** "PARTIALLY_MET — survey covers advising but not career services metrics"
5. **Accreditation Officer reviews** → adds career services data as supplementary evidence → verdict updated to "MET"

---

## 7. UC-04: Outcome Alignment Auditor

### 7.1 The Problem
**CLO ↔ Syllabus ↔ Blackboard drift.** Course Learning Outcomes written in the curriculum map never appear in the syllabus. Assessments in the syllabus don't match the Blackboard gradebook. AACSB Assurance of Learning requires evidence of alignment.

### 7.2 The Solution
**Three-way check:**
- CLO (curriculum map) ↔ Syllabus (Concourse) ↔ Blackboard Gradebook (Ultra)
- Flags: **Missing CLO** (CLO not in gradebook), **Ghost Assessment** (gradebook column not mapped to CLO), **Weight Mismatch** (syllabus % ≠ Blackboard %)
- Rolls up to **AACSB Assurance of Learning** evidence

### 7.3 Data Model
- `module2_accreditation.course_learning_outcomes` — canonical CLO definitions
- `module2_accreditation.syllabus_content` — extracted syllabus text from Concourse
- `module2_accreditation.bb_gradebook_alignment` — Blackboard gradebook mapping
- `v_three_way_alignment` — alignment status view

### 7.4 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| CLO alignment rate | 65% | 95% | Automated three-way check every night |
| AACSB AoL evidence | Manual | Automated | Alignment data feeds directly into AACSB portfolio |
| Chair review time | 4 hrs/semester | 30 min/semester | Dashboard shows only flagged courses |

### 7.5 Example Workflow
1. **Nightly scan:** System checks all 120 courses in current term
2. **ACCT 2301 flagged:** CLO-2 ("Analyze financial ratios") not mapped to any gradebook column
3. **System alert:** Email to instructor Dr. Johnson + Chair Dr. Smith
4. **Instructor logs in** → sees exact issue → adds "Financial Ratio Analysis Project" (40%) to Blackboard
5. **Next nightly scan:** Flag cleared → alignment status = "OK"

---

## 8. UC-05: Grading Load Analyzer

### 8.1 The Problem
**Grading workload invisible until it breaks.** No systematic tracking. Faculty complain to dean after semester ends. GA allocation reactive. Two resignations in 2024 attributed to excessive grading load.

### 8.2 The Solution
**Grading Load Index (GLI) = Weight × Items × Rubric × Enrollment**
- **Weight:** Course credit hours × level multiplier (upper-division = 1.5x)
- **Items:** Total gradable items (assignments, exams, discussions, projects)
- **Rubric:** Complexity score (criteria count × rubric use rate)
- **Enrollment:** Student count
- **GA-hour allocation** recommendations based on GLI
- **Crunch-week heat map** — identify weeks with >30% items due
- **Year-over-year escalation flags** — >20% increase triggers alert

### 8.3 Data Model
- `module2_faculty.grading_load_index` — GLI per course-section
- `v_crunch_week_heatmap` — department chair dashboard

### 8.4 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Faculty grading hours (estimated) | Unknown | Tracked | GLI provides quantified workload metric |
| GA allocation accuracy | 60% | 90% | GLI-based recommendations vs. class-size-only |
| Faculty satisfaction (workload) | 3.2/5 | 4.0/5 | Proactive workload balancing prevents burnout |
| Crunch-week incidents | 5/semester | 1/semester | Heat map enables deadline redistribution |

### 8.5 Example Workflow
1. **End of registration:** System calculates GLI for all 120 courses
2. **NURS 3301 flagged:** EXTREME (GLI = 107,892). Enrollment = 45, 24 assignments, 8 discussions, complex rubrics
3. **System recommends:** 18.5 GA hours (currently allocated: 10.0)
4. **Chair reviews:** Approves additional 8.5 GA hours → reallocates from lower-GLI courses
5. **Crunch-week alert:** Week of Oct 13 has 45 items due across 8 courses → Chair emails instructors to redistribute deadlines

---

## 9. UC-06: AI-Grader Assignment (Scoped Extension)

### 9.1 The Problem
**Instructional Connections** outsourced grading at **$1.2M–$1.5M/year** (figures illustrative pending actuals). No pedagogical consistency. No data feedback loop. Blackboard Ultra + AVA Assisted Feedback not leveraged.

### 9.2 The Solution
**Complexity-weighted, tier-routed AI grading:**
- **Tier 0 (NONE):** Human grading only
- **Tier 1 (AVA_FEEDBACK):** Anthropic AVA provides formative feedback; human grades final
- **Tier 2 (AUTO_GRADE_L1):** AI grades objective items (MCQ, code); human reviews edge cases
- **Tier 3 (AUTO_GRADE_L2):** AI grades structured responses (short answer, essay with rubric); human spot-checks 10%
- **Tier 4 (HUMAN_REVIEW):** Complex, high-stakes assessments — human grades, AI assists
- **Lead Professor retains final-grade authority** — human-in-the-loop always
- **Blackboard-first:** Native Ultra + AVA Assisted Feedback integration

### 9.3 Data Model
- `module2_faculty.ai_grader_routing` — tier assignment per course-section

### 9.4 Key Metrics

| Metric | Current (Instructional Connections) | Target | How Module 2 Helps |
|--------|--------------------------------------|--------|-------------------|
| Annual grading cost | $1.2M–$1.5M | $300K–$500K | AI grading at 20–30% of outsourced cost |
| Grading consistency | Low | High | Canonical rubrics + AI standardization |
| Feedback timeliness | 7–10 days | 24–48 hours | AI provides immediate formative feedback |
| Pedagogical data loop | None | Closed | AI feedback quality tracked and improved |

---

## 10. UC-07: Enrollment Funnel Diagnostics (Scoped Extension)

### 10.1 The Problem
**Opaque enrollment pipeline.** No stage-by-stage conversion tracking. Admissions decisions made on intuition. Over-recruitment in some pipelines; underinvestment in others.

### 10.2 The Solution
**Stage conversion and cycle time** instrumented from:
- Banner Admissions (application → decision)
- Banner Financial Aid (FAFSA → package)
- TouchNet (deposit → payment)
- StarRez (housing assignment)
- Registration timestamps (registration → census)

### 10.3 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Funnel visibility | None | Real-time | Every stage instrumented with timestamps |
| Conversion rate | Unknown | 72% | Identify and fix drop-off stages |
| Cycle time | Unknown | 30 days | Bottleneck identification |
| Marketing ROI | Unknown | Tracked | Lead source attribution per stage |

---

## 11. UC-08: Continuous Compliance Monitoring (Scoped Extension)

### 11.1 The Problem
**Reactive regulatory response.** Compliance team learns of rule changes from listservs or agency emails. Clery ASR late by 9 days in 2024. $50,000 fine risk.

### 11.2 The Solution
**24/7/365 agent swarm monitoring:**
- **Claude MCP + Firecrawl MCP** scrape regulatory sources (Federal Register, Texas Register, agency RSS feeds, court dockets)
- **Impact mapping** by COS Universal Decoding Matrix — every detected change is matched to affected UCO_NODE_IDs
- **Human review** required for all CRITICAL/HIGH alerts
- **Deployment on Trace chain** — immutable audit trail of review and implementation

### 11.3 Key Metrics

| Metric | Current | Target | How Module 2 Helps |
|--------|---------|--------|-------------------|
| Regulatory awareness | 7–14 days | 4 hours | Real-time change detection |
| Implementation lag | 90 days | 14 days | Automated impact assessment + workflow |
| Fine risk | High | Low | Proactive compliance prevents violations |

---

## 12. Data Sources & Integration

### 12.1 Source Systems for Module 2

| UC | Primary Sources | ETL Frequency | Integration Type |
|----|----------------|---------------|------------------|
| UC-01 | Banner, Blackboard Ultra, Concourse, TouchNet, StarRez | Nightly + real-time | REST + Database CDC |
| UC-02 | Banner SIS, Concourse, NSC | Real-time (webhook) | REST API + NLP pipeline |
| UC-03 | SharePoint, Concourse, accreditation documents | Weekly | File scan + NLP |
| UC-04 | Concourse, Blackboard Ultra, curriculum database | Nightly | REST API + database sync |
| UC-05 | Blackboard Ultra, Banner SIS, PeopleSoft HR | Nightly | REST API + database |
| UC-06 | Blackboard Ultra, Anthropic AVA API | Real-time | REST API + WebSocket |
| UC-07 | Banner Admissions, Banner FA, TouchNet, StarRez | Real-time | Event streaming |
| UC-08 | Federal Register, Texas Register, agency RSS, court dockets | Every 15–60 min | Firecrawl + Claude MCP |

### 12.2 Data Flow from Module 1

Module 2 consumes **governed, validated data** from Module 1:
- Canonical student definitions (full-time, first-time, etc.) ensure consistent counts across UC-01 and UC-07
- Canonical course definitions (CIP, program code) ensure consistent mapping in UC-02 and UC-04
- 12 agency marts provide historical context for trend analysis (enrollment, completion, financial aid)

---

## 13. Deployment Checklist

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Deploy V13 migration to PostgreSQL staging | DBA | ☐ |
| 2 | Configure Banner → Module 2 analytics pipeline | DevOps | ☐ |
| 3 | Configure Blackboard Ultra → Module 2 alignment pipeline | DevOps | ☐ |
| 4 | Configure Concourse → Module 2 syllabus extraction | DevOps | ☐ |
| 5 | Configure TouchNet → Module 2 payment signals | DevOps | ☐ |
| 6 | Configure StarRez → Module 2 housing signals | DevOps | ☐ |
| 7 | Train NLP models for transcript crosswalk (UC-02) | ML Team | ☐ |
| 8 | Load accreditation standards library (UC-03) | Accreditation Officer | ☐ |
| 9 | Load equivalency rules for common transfers (UC-02) | Registrar | ☐ |
| 10 | Configure Anthropic AVA API integration (UC-06) | DevOps | ☐ |
| 11 | Configure Firecrawl + Claude MCP for compliance monitoring (UC-08) | Agent Swarm | ☐ |
| 12 | Build advisor dashboard frontend | Frontend | ☐ |
| 13 | Build registrar portal frontend | Frontend | ☐ |
| 14 | Build chair/dean dashboard frontend | Frontend | ☐ |
| 15 | UAT with advisors, registrar, chairs, dean | QA | ☐ |
| 16 | Go-live for UC-01 through UC-05 | Provost | ☐ |
| 17 | Pilot UC-06 (AI-Grader) in 2 departments | Provost | ☐ |
| 18 | Scale UC-06 to full college | Provost | ☐ |
| 19 | Activate UC-08 compliance monitoring | Compliance Officer | ☐ |

---

## 14. Files & Deliverables

| File | Path | Description |
|------|------|-------------|
| PostgreSQL Schema | `ios-plus/db/migrations/V13__module2_objectives_student_facing.sql` | 7 schemas, 8 UCs, 20+ tables/views |
| Student-Facing API | `ios-plus/docs/Module2_Student_Facing_API.md` | REST endpoints for all 8 UCs |
| Integration Guide | `ios-plus/docs/Module2_Integration_Guide.md` | This file |

---

*End of Integration Guide.*
