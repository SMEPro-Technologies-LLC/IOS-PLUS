# Module 1: ETL Source-to-Target Mapping Specifications
## SMEPro COS Regulatory Reporting — Institution-Facing
## Date: 2026-06-20
## Version: 2026.06.20-LAMAR-MOD1-1.0

---

## 1. Overview

This document defines the extract-transform-load (ETL) mappings from every source system in Lamar's estate to the 12 agency data marts in the Module 1 PostgreSQL schema. Lamar writes **zero custom ETL** — all mappings are pre-built, version-controlled, and configurable via the IOS+ connector framework.

### Source Systems Mapped

| # | System | Vendor | Type | API | ETL Mode | Target Marts |
|---|--------|--------|------|-----|----------|-------------|
| 1 | Banner Student | Ellucian | SIS | Oracle DB | Nightly batch | IPEDS, CBM, THECB Accountability, Clery, Title IV |
| 2 | Banner Financial Aid | Ellucian | SIS | Oracle DB | Nightly batch | IPEDS, Title IV, GE/FVT |
| 3 | Banner Finance | Ellucian | ERP | Oracle DB | Nightly batch | IPEDS Finance, TSUS Finance, LAR, Research |
| 4 | Banner HR | Ellucian | ERP | Oracle DB | Nightly batch | IPEDS Human Resources, Clery Employee, TSUS Audit |
| 5 | Blackboard Ultra | Anthology | LMS | REST (OAuth2) | Real-time + nightly | Academic analytics (indirect) |
| 6 | Concourse | Syllabus Plus | SIS | REST (API Key) | Nightly batch | Course catalog, curriculum mapping |
| 7 | Omnigo | Omnigo Software | Safety | REST (OAuth2) | Real-time | Clery Crime, Fire Safety, Emergency Mgmt |
| 8 | Cayuse | Cayuse | Research | REST (OAuth2) | Nightly batch | Research, IPEDS R&D |
| 9 | PeopleSoft (TSUS) | Oracle | ERP | Oracle DB | Nightly batch | TSUS Finance, TSUS Audit, LAR |
| 10 | TouchNet | TouchNet | Payment | REST (OAuth2) | Real-time | Title IV disbursement tracking, 90/10 |
| 11 | StarRez | StarRez | Housing | REST (API Key) | Nightly batch | Clery Fire Safety, Local Fire Safety |
| 12 | National Student Clearinghouse | NSC | Clearing | REST (OAuth2) | Nightly batch | IPEDS Grad Rates, Cohort Default Rate, GE/FVT earnings |
| 13 | SEVIS | DHS / ICE | Immigration | REST (OAuth2) | Real-time | Clery International, Title IV eligibility |
| 14 | CITI Program | CITI | Training | REST (API Key) | Weekly | Research compliance, IRB training records |
| 15 | TeamMate | Wolters Kluwer | Audit | REST (OAuth2) | Nightly batch | TSUS Audit findings, internal audit tracking |

---

## 2. Banner Student → IPEDS / CBM / THECB

### 2.1 Source: Banner Student (SGBSTDN, SPRIDEN, SFRSTCR)

**Connection:** `jdbc:oracle:thin:@banner-prod:1521:BAN8`  
**Auth:** Kerberos  
**ETL Frequency:** Nightly (02:00 CST)  
**ETL Type:** Incremental (CDC via `SGBSTDN_ACTIVITY_DATE`)

### 2.2 Mapping: Student Enrollment

| Target Mart | Target Table | Target Column | Source Table | Source Column | Transformation |
|-------------|-------------|---------------|--------------|---------------|----------------|
| IPEDS | federal_ipeds | ft_undergrad_count | SGBSTDN | SGBSTDN_CRED_HOURS | `COUNT(*) WHERE SGBSTDN_LEVL_CODE='UG' AND SGBSTDN_CRED_HOURS >= 12 AND SGBSTDN_ENRL_STATUS='E'` |
| IPEDS | federal_ipeds | pt_undergrad_count | SGBSTDN | SGBSTDN_CRED_HOURS | `COUNT(*) WHERE SGBSTDN_LEVL_CODE='UG' AND SGBSTDN_CRED_HOURS < 12 AND SGBSTDN_ENRL_STATUS='E'` |
| IPEDS | federal_ipeds | ft_grad_count | SGBSTDN | SGBSTDN_CRED_HOURS | `COUNT(*) WHERE SGBSTDN_LEVL_CODE='GR' AND SGBSTDN_CRED_HOURS >= 9 AND SGBSTDN_ENRL_STATUS='E'` |
| IPEDS | federal_ipeds | pt_grad_count | SGBSTDN | SGBSTDN_CRED_HOURS | `COUNT(*) WHERE SGBSTDN_LEVL_CODE='GR' AND SGBSTDN_CRED_HOURS < 9 AND SGBSTDN_ENRL_STATUS='E'` |
| IPEDS | federal_ipeds | first_time_freshman_count | SGBSTDN | SGBSTDN_STST_CODE | `COUNT(*) WHERE SGBSTDN_STST_CODE='FF' AND SGBSTDN_TERM_CODE_ENTRY=:report_term` |
| IPEDS | federal_ipeds | transfer_in_count | SGBSTDN | SGBSTDN_STST_CODE | `COUNT(*) WHERE SGBSTDN_STST_CODE='TR' AND SGBSTDN_TERM_CODE_ENTRY=:report_term` |
| IPEDS | federal_ipeds | male_count | SPRIDEN | SPRIDEN_SEX | `JOIN SPRIDEN ON SGBSTDN_PIDM = SPRIDEN_PIDM; COUNT WHERE SPRIDEN_SEX='M'` |
| IPEDS | federal_ipeds | female_count | SPRIDEN | SPRIDEN_SEX | `COUNT WHERE SPRIDEN_SEX='F'` |
| IPEDS | federal_ipeds | hispanic_count | SPBPERS | SPBPERS_ETHN_CDE | `JOIN SPBPERS; COUNT WHERE SPBPERS_ETHN_CDE='H' OR (SPBPERS_HISP_IND='Y')` |
| IPEDS | federal_ipeds | black_count | SPBPERS | SPBPERS_RACE_CDE | `COUNT WHERE SPBPERS_RACE_CDE='B'` |
| IPEDS | federal_ipeds | white_count | SPBPERS | SPBPERS_RACE_CDE | `COUNT WHERE SPBPERS_RACE_CDE='W'` |
| IPEDS | federal_ipeds | asian_count | SPBPERS | SPBPERS_RACE_CDE | `COUNT WHERE SPBPERS_RACE_CDE='A'` |
| CBM | state_cbm | total_headcount | SGBSTDN | SGBSTDN_PIDM | `COUNT(DISTINCT SGBSTDN_PIDM) WHERE SGBSTDN_ENRL_STATUS='E'` |
| CBM | state_cbm | total_fte | SGBSTDN | SGBSTDN_CRED_HOURS | `SUM(CASE WHEN SGBSTDN_LEVL_CODE='UG' THEN SGBSTDN_CRED_HOURS/15.0 ELSE SGBSTDN_CRED_HOURS/12.0 END)` |
| CBM | state_cbm | ft_undergrad_count | SGBSTDN | SGBSTDN_CRED_HOURS | Same as IPEDS |
| CBM | state_cbm | pt_undergrad_count | SGBSTDN | SGBSTDN_CRED_HOURS | Same as IPEDS |
| THECB Accountability | state_thecb_accountability | 6-Year Graduation Rate | SGBSTDN | SGBSTDN_DEGC_DATE | `COUNT(SGBSTDN_DEGC_DATE <= cohort_year+6) / COUNT(*) WHERE cohort = :cohort_year` |
| THECB Accountability | state_thecb_accountability | 1-Year Retention | SGBSTDN | SGBSTDN_TERM_CODE | `COUNT(enrolled_year+1) / COUNT(first_time_freshman) WHERE cohort = :cohort_year` |

### 2.3 Canonical Definition Applied

All counts above use the **canonical definition** `full_time_student` from `module1_canonical.concept_definitions`:

```sql
-- Canonical full-time student definition (undergraduate)
SELECT COUNT(DISTINCT s.SGBSTDN_PIDM)
FROM BANNER.SGBSTDN s
JOIN BANNER.SPRIDEN p ON s.SGBSTDN_PIDM = p.SPRIDEN_PIDM
WHERE s.SGBSTDN_ENRL_STATUS = 'E'
  AND s.SGBSTDN_LEVL_CODE = 'UG'
  AND s.SGBSTDN_CRED_HOURS >= 12
  AND s.SGBSTDN_TERM_CODE = :report_term;
```

**Validation rule:** `ft_undergrad_count` in IPEDS must equal `ft_undergrad_count` in CBM001 within ±10 students. Any discrepancy triggers `v_cross_mart_validation` FAIL.

---

## 3. Banner Financial Aid → IPEDS / Title IV / GE-FVT

### 3.1 Source: Banner Financial Aid (RORSTAT, RORPRDS, RORCOA, RORRETURN)

**Connection:** Same Oracle DB as Banner Student (different schema)  
**ETL Frequency:** Nightly (02:30 CST)  
**ETL Type:** Incremental (CDC via `RORPRDS_ACTIVITY_DATE`)

### 3.2 Mapping: Financial Aid

| Target Mart | Target Table | Target Column | Source Table | Source Column | Transformation |
|-------------|-------------|---------------|--------------|---------------|----------------|
| IPEDS | federal_ipeds | pell_recipient_count | RORPRDS | RORPRDS_FUND_CODE | `COUNT(DISTINCT RORPRDS_PIDM) WHERE RORPRDS_FUND_CODE='PELL'` |
| IPEDS | federal_ipeds | pell_total_amount | RORPRDS | RORPRDS_DISB_AMT | `SUM(RORPRDS_DISB_AMT) WHERE RORPRDS_FUND_CODE='PELL'` |
| IPEDS | federal_ipeds | loan_recipient_count | RORPRDS | RORPRDS_FUND_CODE | `COUNT(DISTINCT RORPRDS_PIDM) WHERE RORPRDS_FUND_CODE IN ('SUBS','UNST','PLUS')` |
| IPEDS | federal_ipeds | loan_total_amount | RORPRDS | RORPRDS_DISB_AMT | `SUM(RORPRDS_DISB_AMT) WHERE RORPRDS_FUND_CODE IN ('SUBS','UNST','PLUS')` |
| Title IV | federal_title_iv | pell_applicants | RORSTAT | RORSTAT_FUND_CODE | `COUNT(DISTINCT RORSTAT_PIDM) WHERE RORSTAT_FUND_CODE='PELL' AND RORSTAT_AIDY_CODE=:aid_year` |
| Title IV | federal_title_iv | pell_recipients | RORPRDS | RORPRDS_FUND_CODE | Same as IPEDS pell_recipient_count |
| Title IV | federal_title_iv | pell_disbursed_amount | RORPRDS | RORPRDS_DISB_AMT | Same as IPEDS pell_total_amount |
| Title IV | federal_title_iv | subsidized_loan_recipients | RORPRDS | RORPRDS_FUND_CODE | `COUNT(DISTINCT RORPRDS_PIDM) WHERE RORPRDS_FUND_CODE='SUBS'` |
| Title IV | federal_title_iv | subsidized_loan_amount | RORPRDS | RORPRDS_DISB_AMT | `SUM(RORPRDS_DISB_AMT) WHERE RORPRDS_FUND_CODE='SUBS'` |
| Title IV | federal_title_iv | unsubsidized_loan_recipients | RORPRDS | RORPRDS_FUND_CODE | `COUNT(DISTINCT RORPRDS_PIDM) WHERE RORPRDS_FUND_CODE='UNST'` |
| Title IV | federal_title_iv | unsubsidized_loan_amount | RORPRDS | RORPRDS_DISB_AMT | `SUM(RORPRDS_DISB_AMT) WHERE RORPRDS_FUND_CODE='UNST'` |
| Title IV | federal_title_iv | r2t4_withdrawals | RORRETURN | RORRETURN_WITHDRAWAL_DATE | `COUNT(*) WHERE RORRETURN_CALC_DATE BETWEEN :start AND :end` |
| Title IV | federal_title_iv | r2t4_return_amount | RORRETURN | RORRETURN_RETURN_AMOUNT | `SUM(RORRETURN_RETURN_AMOUNT) WHERE RORRETURN_TYPE='INSTITUTION'` |
| Title IV | federal_title_iv | title_iv_revenue | RORPRDS | RORPRDS_DISB_AMT | `SUM(RORPRDS_DISB_AMT) WHERE RORPRDS_FUND_CODE IN ('PELL','SUBS','UNST','PLUS','SEOG','TEACH')` |
| Title IV | federal_title_iv | total_revenue | TouchNet | payment_amount | `SUM(Total institutional revenue from all sources)` |
| GE-FVT | federal_ge_fvt | median_debt_amt | Banner + NSC | loan_amount | `MEDIAN(total_loan_debt) BY CIP/credential_level FROM Banner + NSC` |
| GE-FVT | federal_ge_fvt | median_earnings_2yr | NSC | earnings | `MEDIAN(earnings_2_years_after_grad) BY CIP/credential_level FROM NSC` |

### 3.3 Canonical Definition Applied

```sql
-- Canonical Pell Grant recipient
SELECT DISTINCT RORSTAT_PIDM
FROM BANNER.RORSTAT
JOIN RORPRDS ON RORSTAT_PIDM = RORPRDS_PIDM
WHERE RORPRDS_FUND_CODE = 'PELL'
  AND RORPRDS_AIDY_CODE = :aid_year
  AND RORPRDS_DISB_AMT > 0;
```

**Validation rule:** IPEDS `pell_recipient_count` must equal FISAP `pell_recipients` within ±1%. Any discrepancy triggers escalation.

---

## 4. Omnigo → Clery / Fire Safety / Emergency Management

### 4.1 Source: Omnigo (Incident Management, Daily Crime Log, Fire Safety)

**Connection:** `https://lamar.omnigo.com/api/v2`  
**Auth:** OAuth2 (client credentials)  
**ETL Frequency:** Real-time (webhook) + Nightly reconciliation  
**ETL Type:** Event-driven (webhook) + Full refresh (nightly)

### 4.2 Mapping: Crime Statistics

| Target Mart | Target Table | Target Column | Omnigo Endpoint | Omnigo Field | Transformation |
|-------------|-------------|---------------|-----------------|--------------|----------------|
| Clery | federal_clery | criminal_homicide | `/incidents` | `incident_type` | `COUNT WHERE incident_type='criminal_homicide' AND clery_geography IN ('on-campus','non-campus','public_property') AND report_date BETWEEN :start AND :end` |
| Clery | federal_clery | sex_offenses_forcible | `/incidents` | `incident_type` | `COUNT WHERE incident_type='sex_offense_forcible'` |
| Clery | federal_clery | sex_offenses_nonforcible | `/incidents` | `incident_type` | `COUNT WHERE incident_type='sex_offense_nonforcible'` |
| Clery | federal_clery | robbery | `/incidents` | `incident_type` | `COUNT WHERE incident_type='robbery'` |
| Clery | federal_clery | aggravated_assault | `/incidents` | `incident_type` | `COUNT WHERE incident_type='aggravated_assault'` |
| Clery | federal_clery | burglary | `/incidents` | `incident_type` | `COUNT WHERE incident_type='burglary'` |
| Clery | federal_clery | motor_vehicle_theft | `/incidents` | `incident_type` | `COUNT WHERE incident_type='motor_vehicle_theft'` |
| Clery | federal_clery | arson | `/incidents` | `incident_type` | `COUNT WHERE incident_type='arson'` |
| Clery | federal_clery | domestic_violence | `/incidents` | `incident_category` | `COUNT WHERE incident_category='domestic_violence'` |
| Clery | federal_clery | dating_violence | `/incidents` | `incident_category` | `COUNT WHERE incident_category='dating_violence'` |
| Clery | federal_clery | stalking | `/incidents` | `incident_category` | `COUNT WHERE incident_category='stalking'` |
| Clery | federal_clery | hate_crimes_total | `/incidents` | `hate_crime_bias` | `COUNT WHERE hate_crime_bias IS NOT NULL` |
| Clery | federal_clery | liquor_law_arrests | `/incidents` | `arrest_referral` | `COUNT WHERE incident_type='liquor_law' AND arrest_made=TRUE` |
| Clery | federal_clery | drug_abuse_arrests | `/incidents` | `arrest_referral` | `COUNT WHERE incident_type='drug_abuse' AND arrest_made=TRUE` |
| Clery | federal_clery | weapons_arrests | `/incidents` | `arrest_referral` | `COUNT WHERE incident_type='weapons' AND arrest_made=TRUE` |
| Fire Safety | local_fire_safety | fire_incidents | `/incidents` | `incident_type` | `COUNT WHERE incident_type='fire' AND facility_type='student_housing'` |
| Fire Safety | local_fire_safety | fire_injuries | `/incidents` | `injuries` | `SUM(injuries) WHERE incident_type='fire'` |
| Fire Safety | local_fire_safety | fire_deaths | `/incidents` | `deaths` | `SUM(deaths) WHERE incident_type='fire'` |
| Emergency Mgmt | local_emergency_mgmt | emergency_incidents | `/incidents` | `emergency_level` | `COUNT WHERE emergency_level IS NOT NULL` |
| Emergency Mgmt | local_emergency_mgmt | incident_types | `/incidents` | `incident_type` | `JSON_AGG(DISTINCT incident_type) WHERE emergency_level IS NOT NULL` |

### 4.3 Canonical Definition Applied

```sql
-- Canonical Clery employee (who must be included in Clery geography)
SELECT emp_id FROM PEOPLESOFT.HR_EMPLOYEES
WHERE (emp_status = 'A' OR emp_status = 'L')
  AND (emp_campus_location IS NOT NULL OR emp_remote_campus_connection = TRUE);
```

---

## 5. Cayuse → Research / IPEDS R&D

### 5.1 Source: Cayuse (Awards, Proposals, Expenditures, Personnel)

**Connection:** `https://lamar.cayuse.com/api/v1`  
**Auth:** OAuth2  
**ETL Frequency:** Nightly (03:00 CST)  
**ETL Type:** Incremental

### 5.2 Mapping: Research Expenditures

| Target Mart | Target Table | Target Column | Cayuse Endpoint | Cayuse Field | Transformation |
|-------------|-------------|---------------|-----------------|--------------|----------------|
| Research | federal_research | total_rd_expenditures | `/expenditures` | `expenditure_amount` | `SUM(expenditure_amount) WHERE expenditure_date BETWEEN :start AND :end AND research_flag=TRUE` |
| Research | federal_research | federal_rd_expenditures | `/expenditures` | `funding_source` | `SUM(expenditure_amount) WHERE funding_source='federal'` |
| Research | federal_research | state_local_rd_expenditures | `/expenditures` | `funding_source` | `SUM(expenditure_amount) WHERE funding_source IN ('state','local')` |
| Research | federal_research | institution_funded_rd | `/expenditures` | `funding_source` | `SUM(expenditure_amount) WHERE funding_source='institution'` |
| Research | federal_research | business_funded_rd | `/expenditures` | `funding_source` | `SUM(expenditure_amount) WHERE funding_source='business'` |
| Research | federal_research | life_sciences_rd | `/expenditures` | `field_of_science` | `SUM(expenditure_amount) WHERE field_of_science='life_sciences'` |
| Research | federal_research | engineering_rd | `/expenditures` | `field_of_science` | `SUM(expenditure_amount) WHERE field_of_science='engineering'` |
| Research | federal_research | physical_sciences_rd | `/expenditures` | `field_of_science` | `SUM(expenditure_amount) WHERE field_of_science='physical_sciences'` |
| IPEDS | federal_ipeds | sponsored_expenditure | `/expenditures` | `expenditure_amount` | `SUM(expenditure_amount) WHERE expenditure_type IN ('direct','indirect') AND award_status='ACTIVE'` |

### 5.3 Canonical Definition Applied

```sql
-- Canonical sponsored expenditure
SELECT SUM(expenditure_amount)
FROM CAYUSE.award_expenditures
WHERE expenditure_type IN ('direct', 'indirect')
  AND award_status = 'ACTIVE'
  AND expenditure_date BETWEEN :start_date AND :end_date;
```

---

## 6. PeopleSoft (TSUS) → TSUS Finance / TSUS Audit / LAR

### 6.1 Source: PeopleSoft (TSUS) — Finance, HR, Procurement

**Connection:** `jdbc:oracle:thin:@psoft-tsus:1521:PSFT`  
**Auth:** Kerberos  
**ETL Frequency:** Nightly (01:00 CST)  
**ETL Type:** Incremental

### 6.2 Mapping: TSUS Financial Reports

| Target Mart | Target Table | Target Column | PS Table | PS Column | Transformation |
|-------------|-------------|---------------|----------|-----------|----------------|
| TSUS Finance | tsus_finance | tuition_fees_revenue | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT='410000' AND FISCAL_YEAR=:fy` |
| TSUS Finance | tsus_finance | state_appropriations | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT='420000' AND FISCAL_YEAR=:fy` |
| TSUS Finance | tsus_finance | federal_grants_revenue | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT='430000' AND FISCAL_YEAR=:fy` |
| TSUS Finance | tsus_finance | instruction_expense | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT='610000' AND FISCAL_YEAR=:fy` |
| TSUS Finance | tsus_finance | research_expense | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT='620000' AND FISCAL_YEAR=:fy` |
| TSUS Audit | tsus_audit | finding_count | TEAMMATE | finding_count | `COUNT(*) FROM TEAMMATE.audit_findings WHERE fiscal_year=:fy` |
| TSUS Audit | tsus_audit | material_weakness_count | TEAMMATE | weakness_level | `COUNT(*) WHERE weakness_level='material'` |
| TSUS Audit | tsus_audit | findings_open | TEAMMATE | status | `COUNT(*) WHERE status='open'` |
| TSUS Audit | tsus_audit | findings_closed | TEAMMATE | status | `COUNT(*) WHERE status='closed'` |
| LAR | state_lar | instruction_funding | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT LIKE '610%' AND BIENNIUM=:biennium` |
| LAR | state_lar | research_funding | PS_LEDGER | POSTED_TOTAL_AMT | `SUM(POSTED_TOTAL_AMT) WHERE ACCOUNT LIKE '620%' AND BIENNIUM=:biennium` |
| LAR | state_lar | projected_fte | PS_LEDGER | FTE_PROJECTED | `SUM(FTE_PROJECTED) WHERE BIENNIUM=:biennium` |
| LAR | state_lar | degrees_projected | PS_LEDGER | DEGREES_PROJECTED | `SUM(DEGREES_PROJECTED) WHERE BIENNIUM=:biennium` |

---

## 7. StarRez → Fire Safety / Clery Fire Safety

### 7.1 Source: StarRez (Housing, Residence Life, Facilities)

**Connection:** `https://lamar.starez.com/api/v1`  
**Auth:** API Key  
**ETL Frequency:** Nightly (04:00 CST)  
**ETL Type:** Full refresh (small dataset)

### 7.2 Mapping: Fire Safety Data

| Target Mart | Target Table | Target Column | StarRez Endpoint | StarRez Field | Transformation |
|-------------|-------------|---------------|------------------|---------------|----------------|
| Fire Safety | local_fire_safety | facility_name | `/buildings` | `building_name` | `building_name WHERE building_type='student_housing'` |
| Fire Safety | local_fire_safety | annual_inspection_date | `/inspections` | `inspection_date` | `MAX(inspection_date) WHERE building_type='student_housing' AND inspection_type='annual'` |
| Fire Safety | local_fire_safety | annual_inspection_pass | `/inspections` | `inspection_result` | `inspection_result='pass' WHERE building_type='student_housing'` |
| Fire Safety | local_fire_safety | sprinkler_system | `/buildings` | `sprinkler_installed` | `sprinkler_installed WHERE building_type='student_housing'` |
| Fire Safety | local_fire_safety | fire_alarm_system | `/buildings` | `fire_alarm_installed` | `fire_alarm_installed WHERE building_type='student_housing'` |
| Fire Safety | local_fire_safety | fire_drill_count | `/drills` | `drill_date` | `COUNT(*) WHERE building_type='student_housing' AND drill_date BETWEEN :start AND :end` |
| Clery | federal_clery | fire_incidents | `/incidents` | `incident_type` | `COUNT(*) WHERE incident_type='fire'` |
| Clery | federal_clery | fire_injuries | `/incidents` | `injuries` | `SUM(injuries) WHERE incident_type='fire'` |
| Clery | federal_clery | fire_deaths | `/incidents` | `deaths` | `SUM(deaths) WHERE incident_type='fire'` |
| Clery | federal_clery | fire_property_damage | `/incidents` | `property_damage` | `SUM(property_damage) WHERE incident_type='fire'` |

---

## 8. National Student Clearinghouse → IPEDS / GE-FVT / Title IV

### 8.1 Source: NSC (Enrollment, Graduation, Earnings, Debt)

**Connection:** `https://secure.studentclearinghouse.org/api/v1`  
**Auth:** OAuth2  
**ETL Frequency:** Nightly (05:00 CST)  **ETL Type:** Incremental + Batch

### 8.2 Mapping: Enrollment & Outcomes

| Target Mart | Target Table | Target Column | NSC Endpoint | NSC Field | Transformation |
|-------------|-------------|---------------|--------------|-----------|----------------|
| IPEDS | federal_ipeds | graduation_rate_150pct | `/graduation` | `graduated_150pct` | `COUNT(graduated_150pct=TRUE) / COUNT(*) WHERE cohort=:cohort_year` |
| IPEDS | federal_ipeds | transfer_out_rate | `/transfer` | `transferred` | `COUNT(transferred=TRUE) / COUNT(*) WHERE cohort=:cohort_year` |
| IPEDS | federal_ipeds | retention_rate_ft | `/enrollment` | `enrolled_next_year` | `COUNT(enrolled_next_year=TRUE) / COUNT(*) WHERE first_time_freshman=TRUE` |
| GE-FVT | federal_ge_fvt | median_earnings_1yr | `/earnings` | `median_earnings_1yr` | `MEDIAN(median_earnings_1yr) BY CIP/credential_level` |
| GE-FVT | federal_ge_fvt | median_earnings_2yr | `/earnings` | `median_earnings_2yr` | `MEDIAN(median_earnings_2yr) BY CIP/credential_level` |
| GE-FVT | federal_ge_fvt | median_earnings_4yr | `/earnings` | `median_earnings_4yr` | `MEDIAN(median_earnings_4yr) BY CIP/credential_level` |
| Title IV | federal_title_iv | cdr_cohort_year | `/cohort` | `cohort_year` | `cohort_year` |
| Title IV | federal_title_iv | cdr_borrowers_in_cohort | `/cohort` | `borrowers_in_cohort` | `COUNT(DISTINCT borrower_id)` |
| Title IV | federal_title_iv | cdr_defaults_in_cohort | `/cohort` | `defaults_in_cohort` | `COUNT(DISTINCT borrower_id) WHERE default_status='defaulted'` |
| Title IV | federal_title_iv | cdr_rate | `/cohort` | `default_rate` | `defaults_in_cohort / borrowers_in_cohort` |

---

## 9. Blackboard Ultra → Academic Analytics (Indirect)

### 9.1 Source: Blackboard Ultra (Gradebook, Course Analytics, Attendance)

**Connection:** `https://lamar.blackboard.com/learn/api/public/v3`  
**Auth:** OAuth2  
**ETL Frequency:** Real-time (event stream) + Nightly batch  
**ETL Type:** Event-driven + Incremental

### 9.2 Mapping: Academic Data ( feeds into THECB Accountability, IPEDS indirectly)

| Target Mart | Target Table | Target Column | Ultra Endpoint | Ultra Field | Transformation |
|-------------|-------------|---------------|----------------|-------------|----------------|
| THECB Accountability | state_thecb_accountability | metric_value (retention) | `/courses/{courseId}/gradebook` | `final_grade` | `JOIN with Banner SGBSTDN; COUNT WHERE final_grade NOT IN ('F','W','I') / COUNT(*)` |
| IPEDS (indirect) | federal_ipeds | retention_rate_ft | `/courses` | `enrollment_status` | `Derived from gradebook pass rates + Banner enrollment data` |

**Note:** Blackboard Gradebook data is used for **UC-04 (Outcome↔Assessment Alignment)**, **UC-05 (Grading Load Analysis)**, and **UC-06 (Allied Health Programmatic Reporting)**. The REST APIs are included in the standard institutional license — no added vendor fee.

---

## 10. SEVIS → Clery / Title IV

### 10.1 Source: SEVIS (Student and Exchange Visitor Information System)

**Connection:** `https://egov.ice.gov/sevis/api`  
**Auth:** OAuth2 (DHS SEVIS credentials)  
**ETL Frequency:** Real-time (webhook) + Nightly reconciliation  
**ETL Type:** Event-driven

### 10.2 Mapping: International Student Data

| Target Mart | Target Table | Target Column | SEVIS Endpoint | SEVIS Field | Transformation |
|-------------|-------------|---------------|----------------|-------------|----------------|
| Clery | federal_clery | sevis_active_count | `/students` | `sevis_status` | `COUNT(*) WHERE sevis_status='ACTIVE' AND visa_type IN ('F1','J1','M1')` |
| Title IV | federal_title_iv | sevis_active_count | `/students` | `sevis_status` | Same as above |
| IPEDS | federal_ipeds | nonresident_alien_count | `/students` | `citizenship_country` | `COUNT(*) WHERE citizenship_country != 'US'` |

---

## 11. CITI Program → Research Compliance

### 11.1 Source: CITI Program (Training Records, IRB Certifications)

**Connection:** `https://www.citiprogram.org/api/v1`  
**Auth:** API Key  
**ETL Frequency:** Weekly (Sundays)  
**ETL Type:** Full refresh (small dataset)

### 11.2 Mapping: IRB Training & Compliance

| Target Mart | Target Table | Target Column | CITI Endpoint | CITI Field | Transformation |
|-------------|-------------|---------------|---------------|------------|----------------|
| Research | federal_research | irb_training_current | `/training` | `completion_date` | `COUNT(*) WHERE completion_date >= CURRENT_DATE - INTERVAL '3 years'` |
| TSUS Audit | tsus_audit | compliance_training_count | `/training` | `module_name` | `COUNT(*) WHERE module_name LIKE '%IRB%' AND completion_date >= CURRENT_DATE - INTERVAL '1 year'` |

---

## 12. TeamMate → TSUS Audit

### 12.1 Source: TeamMate (Audit Findings, Management Letters, Workpapers)

**Connection:** `https://lamar.teammate.com/api/v1`  
**Auth:** OAuth2  
**ETL Frequency:** Nightly (03:30 CST)  
**ETL Type:** Incremental

### 12.2 Mapping: Audit Findings

| Target Mart | Target Table | Target Column | TeamMate Endpoint | TeamMate Field | Transformation |
|-------------|-------------|---------------|-------------------|----------------|----------------|
| TSUS Audit | tsus_audit | finding_count | `/findings` | `finding_id` | `COUNT(*) WHERE fiscal_year=:fy` |
| TSUS Audit | tsus_audit | material_weakness_count | `/findings` | `weakness_level` | `COUNT(*) WHERE weakness_level='material' AND fiscal_year=:fy` |
| TSUS Audit | tsus_audit | findings_open | `/findings` | `status` | `COUNT(*) WHERE status='open'` |
| TSUS Audit | tsus_audit | findings_closed | `/findings` | `status` | `COUNT(*) WHERE status='closed'` |
| TSUS Audit | tsus_audit | findings_overdue | `/findings` | `due_date` | `COUNT(*) WHERE due_date < CURRENT_DATE AND status='open'` |
| TSUS Audit | tsus_audit | management_letter_issued | `/management_letters` | `letter_date` | `EXISTS WHERE fiscal_year=:fy` |
| TSUS Audit | tsus_audit | opinion_type | `/audit_reports` | `opinion` | `opinion WHERE fiscal_year=:fy ORDER BY report_date DESC LIMIT 1` |

---

## 13. TouchNet → Title IV / 90/10

### 13.1 Source: TouchNet (Payment Processing, Tuition, Fees)

**Connection:** `https://lamar.touchnet.com/api/v2`  
**Auth:** OAuth2  
**ETL Frequency:** Real-time (event stream) + Nightly reconciliation  
**ETL Type:** Event-driven + Incremental

### 13.2 Mapping: Revenue & Disbursement Tracking

| Target Mart | Target Table | Target Column | TouchNet Endpoint | TouchNet Field | Transformation |
|-------------|-------------|---------------|-------------------|----------------|----------------|
| Title IV | federal_title_iv | total_revenue | `/payments` | `payment_amount` | `SUM(payment_amount) WHERE payment_date BETWEEN :start AND :end` |
| Title IV | federal_title_iv | title_iv_revenue | `/payments` | `payment_type` | `SUM(payment_amount) WHERE payment_type IN ('PELL','SUBS','UNST','PLUS','SEOG')` |
| Title IV | federal_title_iv | title_iv_ratio | `/payments` | `payment_type` | `title_iv_revenue / total_revenue` |
| GE-FVT | federal_ge_fvt | net_price | `/payments` | `net_payment` | `AVG(net_payment) BY CIP/credential_level` |

---

## 14. Concourse → Course Catalog / Curriculum

### 14.1 Source: Concourse (Syllabus Management, Course Catalog)

**Connection:** `https://lamar.concourse.com/api/v1`  
**Auth:** API Key  
**ETL Frequency:** Nightly (04:30 CST)  
**ETL Type:** Full refresh

### 14.2 Mapping: Course & Curriculum Data

| Target Mart | Target Table | Target Column | Concourse Endpoint | Concourse Field | Transformation |
|-------------|-------------|---------------|--------------------|-----------------|----------------|
| IPEDS (indirect) | federal_ipeds | program_count | `/courses` | `course_id` | `COUNT(DISTINCT program_code) WHERE active=TRUE` |
| CBM | state_cbm | program_count | `/courses` | `course_id` | Same as above |
| THECB Accountability | state_thecb_accountability | credentials_of_value_projected | `/courses` | `credential_value` | `SUM(credential_value) WHERE program_status='active'` |

---

## 15. ETL Job Schedule

| Time (CST) | Job | Source | Target Mart | Type | Records (est.) |
|------------|-----|--------|-------------|------|---------------|
| 01:00 | TSUS PeopleSync | PeopleSoft (TSUS) | TSUS Finance, TSUS Audit, LAR | Incremental | 50K |
| 02:00 | Banner StudentSync | Banner Student | IPEDS, CBM, THECB Accountability | Incremental | 500K |
| 02:30 | Banner AidSync | Banner Financial Aid | IPEDS, Title IV, GE-FVT | Incremental | 200K |
| 03:00 | Cayuse ResearchSync | Cayuse | Research, IPEDS R&D | Incremental | 10K |
| 03:30 | TeamMate AuditSync | TeamMate | TSUS Audit | Incremental | 5K |
| 04:00 | StarRez HousingSync | StarRez | Fire Safety, Clery Fire Safety | Full refresh | 2K |
| 04:30 | Concourse CourseSync | Concourse | CBM, IPEDS (indirect) | Full refresh | 5K |
| 05:00 | NSC OutcomesSync | NSC | IPEDS, GE-FVT, Title IV CDR | Batch | 100K |
| 05:30 | CrossMart Validation | All marts | v_cross_mart_validation | Validation | — |
| 06:00 | Agent Alert Batch | license_expiration_tracking | v_agent_swarm_alerts | Alert generation | — |
| Real-time | Omnigo EventStream | Omnigo | Clery, Fire Safety, Emergency Mgmt | Event-driven | — |
| Real-time | SEVIS EventStream | SEVIS | Clery, Title IV | Event-driven | — |
| Real-time | TouchNet EventStream | TouchNet | Title IV, 90/10 | Event-driven | — |
| Real-time | Blackboard EventStream | Blackboard Ultra | Academic analytics | Event-driven | — |
| Weekly | CITI TrainingSync | CITI Program | Research compliance | Full refresh | 1K |

---

## 16. Error Handling & Recovery

| Scenario | Action | Escalation |
|----------|--------|------------|
| ETL job fails | Retry 3x with exponential backoff; alert on 3rd failure | DevOps team + Data Owner |
| Source system unreachable | Queue for retry; use last successful snapshot | DevOps team |
| Data validation FAIL | Halt downstream loads; alert Data Governance | Data Governance team + CDO |
| Cross-mart discrepancy | Flag in dashboard; require manual reconciliation | Data Governance team + Agency Liaison |
| Canonical definition conflict | Freeze changes; require CDO approval | CDO + Compliance Officer |
| SEVIS / Omnigo real-time outage | Switch to batch mode; alert DSO / Safety Officer | DSO / Safety Officer |

---

*End of ETL Mapping Specifications.*
