# Module 1: Regulatory Reporting — Integration Guide
## SMEPro COS — Institution-Facing
## Version: 2026.06.20-LAMAR-MOD1-1.0
## Date: 2026-06-20

---

## 1. Executive Summary

Module 1 solves the core problem at Lamar: **compliance filings are assembled by hand from more than a dozen systems**, with duplicate extracts and definitions that drift between offices. The same question can get different answers in different filings.

**What Module 1 delivers:**
- A centralized regulatory data layer with clean, validated, report-ready tables
- 12 agency-shaped data marts, each pre-formatted to its agency's exact submission schema
- One authoritative definition per concept — version-controlled, used by every filing
- Automated extracts via API and nightly ETL — zero manual exports
- A unified reporting portal — one interface for all filings, every number traceable

---

## 2. The Problem Before Module 1

| Pain Point | Impact | Frequency |
|------------|--------|-----------|
| IPEDS Fall Enrollment assembled from Banner, then checked against a separate CBM extract | Two different "full-time student" counts | Every October |
| Clery crime statistics pulled from Omnigo, but fire safety data from a separate StarRez export | ASR published with inconsistent numbers | Every October |
| Title IV FISAP data manually reconciled between Financial Aid and Student Accounts | FISAP submission delayed 2–3 weeks | Every October |
| Research expenditures reported to NSF HERD from a spreadsheet maintained by the Research Office | NSF audit finding in 2023 due to $1.2M discrepancy | Every February |
| THECB LAR built from PeopleSoft, but enrollment projections from Banner | LAR revised 3+ times before submission | Every August (biennial) |
| TSUS AFR manually compiled from 8 different PeopleSoft modules | CAFR published 45 days after deadline | Every December |
| Fire safety inspections tracked in a local Access database | Clery Fire Safety Report missing 2 buildings | Every October |
| Emergency management plans stored in SharePoint with no version control | EOP not updated since 2022 | Annual review |

**Root cause:** No single source of truth. Every office maintains its own definition of "full-time student," "sponsored expenditure," and "Clery employee."

---

## 3. The Solution: Centralized Regulatory Data Layer

### 3.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  UNIFIED REPORTING PORTAL (React / Next.js)                         │
│  One interface for IPEDS, CBM, FISAP, NSLDS, GE/FVT, ASR,        │
│  EADA, AFR, LAR, and TSUS filings                                   │
│  Every report generated from validated marts, every number traceable │
├─────────────────────────────────────────────────────────────────────┤
│  REST API GATEWAY                                                    │
│  /v1/module1/reports/*                                               │
│  /v1/module1/canonical/definitions                                  │
│  /v1/module1/etl/jobs                                               │
│  /v1/module1/audit/events                                           │
├─────────────────────────────────────────────────────────────────────┤
│  MODULE 1 SCHEMA — PostgreSQL 16+                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module1_canonical                                          │   │
│  │  • concept_definitions (17+ authoritative definitions)    │   │
│  │  • source_systems (15 systems mapped)                     │   │
│  │  • change_log (version control)                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module1_marts — 12 Agency Data Marts                        │   │
│  │  • federal_ipeds      • federal_title_iv                   │   │
│  │  • federal_clery      • federal_ge_fvt                   │   │
│  │  • federal_research   • state_cbm                          │   │
│  │  • state_thecb_accountability  • state_lar                │   │
│  │  • tsus_finance       • tsus_audit                        │   │
│  │  • local_fire_safety  • local_emergency_mgmt              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module1_etl                                                 │   │
│  │  • job_definitions (15 ETL jobs)                            │   │
│  │  • job_runs (execution history)                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  module1_audit                                               │   │
│  │  • concept_change_log (who changed what, when)             │   │
│  │  • reporting_events (every report generated, submitted)    │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  15 SOURCE SYSTEMS — Pre-built IOS+ Connectors                    │
│  Banner (Student, FinAid, Finance, HR) | Blackboard Ultra        │
│  Concourse | Omnigo | Cayuse | PeopleSoft (TSUS) | TouchNet      │
│  StarRez | NSC | SEVIS | CITI | TeamMate                          │
│  Lamar writes NO ETL. No existing system is rebuilt.             │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 The 12 Agency Data Marts

| Mart | Agency | Reports | Records (est.) | Source Systems |
|------|--------|---------|--------------|----------------|
| **federal_ipeds** | NCES / IPEDS | Fall Enrollment, 12-Month, Completions, Grad Rates, Human Resources, Finance, Student Financial Aid | 500K/yr | Banner Student, Banner Financial Aid, Banner Finance, NSC |
| **federal_title_iv** | Dept of Ed / FSA | FISAP, NSLDS, R2T4, 90/10, Cohort Default Rate | 200K/yr | Banner Financial Aid, TouchNet, NSC |
| **federal_clery** | Dept of Ed / Clery | ASR, Daily Crime Log, Fire Safety Report, HATE Crime | 50K/yr | Omnigo, StarRez, PeopleSoft HR |
| **federal_ge_fvt** | Dept of Ed / GE-FVT | Financial Value Transparency by CIP | 5K/yr | Banner Financial Aid, NSC, BLS |
| **federal_research** | NSF / NIH | HERD, NIH progress reports, USDA | 10K/yr | Cayuse, Banner Finance |
| **state_cbm** | THECB | CBM001–CBM009 | 300K/yr | Banner Student, Banner Finance |
| **state_thecb_accountability** | THECB | 60x30TX metrics, Credentials of Value | 50K/yr | Banner Student, NSC |
| **state_lar** | THECB / Legislature | Biennial Appropriations Request | 10K/yr | PeopleSoft (TSUS), Banner Finance |
| **tsus_finance** | TSUS System Office | AFR, CAFR, Operating Budget, Capital Budget | 100K/yr | PeopleSoft (TSUS) |
| **tsus_audit** | TSUS System Office / External Auditors | External Audit, Internal Audit, Compliance Audit, IT Audit | 5K/yr | TeamMate, PeopleSoft |
| **local_fire_safety** | Local Fire Marshal / Clery | Annual Inspections, Fire Drills, Fire Incidents | 2K/yr | StarRez, Omnigo, Local Fire Marshal |
| **local_emergency_mgmt** | TDEM / Clery | EOP, COOP, Training, Exercises, Incidents | 1K/yr | Omnigo, Local Emergency Management |

### 3.3 Canonical Definitions — One Authoritative Source

| Concept | Definition | Used In | Source of Truth |
|---------|-----------|---------|-----------------|
| **Full-Time Student (UG)** | 12+ credit hours in standard term | IPEDS, CBM, FISAP, Title IV | Banner Student |
| **Full-Time Student (GR)** | 9+ credit hours in standard term | IPEDS, CBM, FISAP | Banner Student |
| **First-Time Freshman** | First entry into postsecondary ed, includes summer prior | IPEDS, CBM, THECB Accountability | Banner Student |
| **Transfer Student** | First entry at Lamar, previously attended elsewhere | IPEDS, CBM, THECB Accountability | Banner Student |
| **Pell Grant Recipient** | Received Pell during aid year | IPEDS, FISAP, Title IV | Banner Financial Aid |
| **Sponsored Expenditure** | External grant + contract direct + F&A costs | NSF HERD, IPEDS R&D | Cayuse |
| **Clery Employee** | Works on campus or has substantial campus connection | Clery ASR, VAWA | PeopleSoft HR |
| **VAWA Survivor** | Reports sexual violence, DV, dating violence, stalking | Clery ASR, Title IX | Omnigo |
| **Net Price** | COA minus all grant/scholarship aid | GE/FVT, Net Price Calculator | Banner Financial Aid |
| **R2T4 Return** | Title IV funds returned on withdrawal before 60% | Title IV, FISAP | Banner Financial Aid |
| **Fire Safety Inspection** | Annual inspection of student housing per fire marshal | Clery Fire Safety, Local Fire | StarRez / Local Fire Marshal |
| **Emergency Incident** | Any incident requiring EOP activation | TDEM, Clery | Omnigo |

**Version Control:** Every definition has a `version`, `effective_date`, `end_date`, and `change_log`. When a definition changes (e.g., IPEDS updates full-time to include competency-based hours), a new version is created with CDO approval.

---

## 4. Source Systems & Pre-Built Connectors

### 4.1 Lamar's Actual System Estate

| System | Vendor | Type | Connector | ETL Mode | Emits Event Stream |
|--------|--------|------|-----------|----------|-------------------|
| Banner Student | Ellucian | SIS | Oracle DB CDC | Nightly batch | ✅ |
| Banner Financial Aid | Ellucian | SIS | Oracle DB CDC | Nightly batch | ✅ |
| Banner Finance | Ellucian | ERP | Oracle DB CDC | Nightly batch | ✅ |
| Banner HR | Ellucian | ERP | Oracle DB CDC | Nightly batch | ✅ |
| Blackboard Ultra | Anthology | LMS | REST (OAuth2) | Real-time + nightly | ✅ |
| Concourse | Syllabus Plus | SIS | REST (API Key) | Nightly batch | ✅ |
| Omnigo | Omnigo Software | Safety | REST (OAuth2) | Real-time (webhook) | ✅ |
| Cayuse | Cayuse | Research | REST (OAuth2) | Nightly batch | ✅ |
| PeopleSoft (TSUS) | Oracle | ERP | Oracle DB CDC | Nightly batch | ✅ |
| TouchNet | TouchNet | Payment | REST (OAuth2) | Real-time (event) | ✅ |
| StarRez | StarRez | Housing | REST (API Key) | Nightly batch | ✅ |
| National Student Clearinghouse | NSC | Clearing | REST (OAuth2) | Nightly batch | ✅ |
| SEVIS | DHS / ICE | Immigration | REST (OAuth2) | Real-time (webhook) | ✅ |
| CITI Program | CITI | Training | REST (API Key) | Weekly | ✅ |
| TeamMate | Wolters Kluwer | Audit | REST (OAuth2) | Nightly batch | ✅ |

### 4.2 What "Zero Custom ETL" Means

- **No hand-written SQL scripts** for each report
- **No manual CSV exports** from Banner, PeopleSoft, or Cayuse
- **No copy-paste** between Excel workbooks
- **No reconciling** "my number vs. your number"
- **No rebuilding** existing systems — every connector reads from the native API/database

**The Blackboard Gradebook note:** Blackboard Ultra's REST APIs (including Gradebook) are included in the standard institutional license. There is **no added vendor fee** for the grading data path used by UC-04, UC-05, and UC-06.

---

## 5. The Unified Reporting Portal

### 5.1 One Interface for All Filings

**Dashboard:**
```
┌────────────────────────────────────────────────────────────┐
│  SMEPro COS — Unified Reporting Portal    [Lamar University] │
├────────────────────────────────────────────────────────────┤
│  📅 REPORTING CALENDAR                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ IPEDS Fall  │  │ Clery ASR   │  │ CBM001      │       │
│  │ Enrollment  │  │             │  │             │       │
│  │ 🟢 Validated │  │ 🔴 OVERDUE  │  │ 🟡 Draft    │       │
│  │ Due: Oct 15 │  │ Due: Oct 1  │  │ Due: Nov 15 │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                            │
│  ⚠️ ALERTS (2)                                              │
│  • Clery ASR is OVERDUE by 9 days. Submit immediately.    │
│  • CBM001 has cross-mart discrepancy: ft_undergrad differs │
│    from IPEDS by 12 students. Review Banner StudentSync.   │
│                                                            │
│  📊 ETL HEALTH                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ Banner      │  │ Omnigo      │  │ Cayuse      │       │
│  │ ✅ Success  │  │ ✅ Success  │  │ ✅ Success  │       │
│  │ 02:00 CST   │  │ Real-time   │  │ 03:00 CST   │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                            │
│  📋 QUICK ACTIONS                                           │
│  [Validate IPEDS] [Submit Clery] [Review CBM] [Export All] │
└────────────────────────────────────────────────────────────┘
```

### 5.2 Report Detail Panel

Click any report card to open:
- **Data Preview:** Table view of the report data
- **Validation Results:** Pass/Fail with detailed checks
- **Cross-Mart Comparison:** Side-by-side with related reports
- **Source Systems:** Which ETL jobs populated this mart
- **Canonical Definitions:** Which definitions were used
- **Audit Trail:** Who generated, validated, and submitted
- **Submission:** One-click to agency portal (with pre-filled data)

### 5.3 Canonical Definitions Explorer

```
┌────────────────────────────────────────────────────────────┐
│  CANONICAL DEFINITIONS — Full-Time Student                  │
├────────────────────────────────────────────────────────────┤
│  Current Version: v1 (effective 2026-01-01)                │
│  Status: ✅ Active                                         │
│                                                            │
│  Definition:                                               │
│  "Undergraduate student enrolled for 12 or more credit    │
│   hours in a standard term (fall/spring) or equivalent     │
│   in a non-standard term."                                 │
│                                                            │
│  SQL Logic:                                                │
│  SELECT * FROM BANNER.SGBSTDN                              │
│  WHERE SGBSTDN_ENRL_STATUS = 'E'                         │
│    AND SGBSTDN_CRED_HOURS >= 12                          │
│    AND SGBSTDN_LEVL_CODE = 'UG'                           │
│                                                            │
│  Used In:                                                  │
│  • IPEDS Fall Enrollment                                   │
│  • CBM001                                                  │
│  • THECB Accountability Framework                            │
│  • FISAP                                                   │
│  • Title IV 90/10                                          │
│                                                            │
│  Version History:                                          │
│  v1 | 2026-01-01 | Registrar | Initial definition        │
│                                                            │
│  [Propose Change] [View Change Log] [Compare Versions]     │
└────────────────────────────────────────────────────────────┘
```

---

## 6. ETL Schedule & Automation

| Time (CST) | Job | Source | Target | Type | Records |
|------------|-----|--------|--------|------|---------|
| 01:00 | TSUS PeopleSync | PeopleSoft | TSUS Finance, Audit, LAR | Incremental | 50K |
| 02:00 | Banner StudentSync | Banner Student | IPEDS, CBM, THECB | Incremental | 500K |
| 02:30 | Banner AidSync | Banner FinAid | IPEDS, Title IV, GE-FVT | Incremental | 200K |
| 03:00 | Cayuse ResearchSync | Cayuse | Research, IPEDS R&D | Incremental | 10K |
| 03:30 | TeamMate AuditSync | TeamMate | TSUS Audit | Incremental | 5K |
| 04:00 | StarRez HousingSync | StarRez | Fire Safety, Clery Fire | Full refresh | 2K |
| 04:30 | Concourse CourseSync | Concourse | CBM, IPEDS (indirect) | Full refresh | 5K |
| 05:00 | NSC OutcomesSync | NSC | IPEDS, GE-FVT, Title IV CDR | Batch | 100K |
| 05:30 | CrossMart Validation | All marts | v_cross_mart_validation | Validation | — |
| 06:00 | Agent Alert Batch | license_expiration | v_agent_swarm_alerts | Alert | — |
| Real-time | Omnigo EventStream | Omnigo | Clery, Fire, Emergency | Event-driven | — |
| Real-time | SEVIS EventStream | SEVIS | Clery, Title IV | Event-driven | — |
| Real-time | TouchNet EventStream | TouchNet | Title IV, 90/10 | Event-driven | — |
| Real-time | Blackboard EventStream | Blackboard | Academic analytics | Event-driven | — |
| Weekly | CITI TrainingSync | CITI | Research compliance | Full refresh | 1K |

---

## 7. Validation & Cross-Mart Checks

### 7.1 Automatic Validations

Every report runs these checks before it can be marked "validated":

1. **Canonical Definition Check:** All counts match the authoritative SQL logic
2. **Cross-Mart Comparison:** Key metrics agree across related marts (± tolerance)
3. **Agency Business Rules:** Agency-specific rules (e.g., IPEDS total must equal sum of parts)
4. **Historical Variance:** Current year within ±10% of prior year (flag if not)
5. **Source System Freshness:** ETL data is within 24 hours

### 7.2 Cross-Mart Tolerance Rules

| Comparison | Tolerance | Action on Fail |
|------------|-----------|----------------|
| IPEDS ft_undergrad vs CBM001 ft_undergrad | ±10 students | Escalate to Data Governance |
| IPEDS pell_recipients vs FISAP pell_recipients | ±1% | Escalate to Financial Aid Director |
| IPEDS total_revenue vs TSUS AFR total_revenue | ±0.5% | Escalate to Controller |
| Clery total_crimes vs Omnigo incident_count | ±0 | Escalate to Clery Compliance Officer |
| Research total_rd vs Cayuse total_expenditures | ±1% | Escalate to Research Administrator |
| TSUS audit_opinion vs external auditor report | Must match | Escalate to Internal Audit Director |

---

## 8. Security & Compliance

### 8.1 Data Protection
- All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- No PII in report data exported to agencies (only aggregated counts)
- Role-based access: Student (none), Faculty (read-only), Compliance Officer (read/write), Admin (full)
- Audit logging: Every report viewed, validated, and submitted is logged with user ID, timestamp, and IP

### 8.2 Agency Submission Security
- The portal **does not** auto-submit to agencies. It pre-fills data and provides one-click links to agency portals.
- Submission requires MFA for compliance officers
- Submission confirmation numbers are recorded in the audit trail
- Late submission requires VP approval

---

## 9. Deployment Checklist

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Deploy V12 migration to PostgreSQL staging | DBA | ☐ |
| 2 | Configure Oracle DB CDC for Banner (4 schemas) | DBA | ☐ |
| 3 | Configure PeopleSoft CDC connector | DBA | ☐ |
| 4 | Configure REST API connectors (9 systems) | DevOps | ☐ |
| 5 | Load seed canonical definitions (17 concepts) | Data Governance | ☐ |
| 6 | Run initial ETL load for all 15 source systems | DevOps | ☐ |
| 7 | Validate cross-mart checks pass | QA | ☐ |
| 8 | Deploy unified reporting portal to staging | Frontend | ☐ |
| 9 | Run UAT with Compliance Office | QA | ☐ |
| 10 | Train compliance officers on portal | Training | ☐ |
| 11 | Deploy to production | DevOps | ☐ |
| 12 | Schedule agent swarm monitoring | Agent Swarm | ☐ |
| 13 | Go-live for IPEDS Fall Enrollment 2025 | Compliance | ☐ |

---

## 10. Files & Deliverables

| File | Path | Description |
|------|------|-------------|
| PostgreSQL Schema | `ios-plus/db/migrations/V12__module1_regulatory_reporting.sql` | 12 marts + canonical definitions + ETL + audit |
| ETL Mapping Spec | `ios-plus/docs/Module1_ETL_Mapping_Specifications.md` | Source-to-target mappings for all 15 systems |
| API Specification | `ios-plus/docs/Module1_Unified_Reporting_Portal_API.md` | REST API + WebSocket spec for portal |
| Integration Guide | `ios-plus/docs/Module1_Integration_Guide.md` | This file |

---

*End of Integration Guide.*
