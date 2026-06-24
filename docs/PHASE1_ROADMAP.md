# Phase 1 Roadmap & Phase 2 Readiness Checklist

## Overview

This document tracks Phase 1 deliverables and defines the automated criteria
that must be satisfied before Phase 2 (live Banner/Blackboard binding) begins.

---

## Phase 1 Deliverables

| # | Deliverable | Status |
|---|-------------|--------|
| 1 | Gate 530 engine — rule evaluation, fail-closed, sector-aware | ✅ Complete |
| 2 | Gate 530 API server — `/v1/evaluate`, `/health`, `/ready` | ✅ Complete |
| 3 | COS+ database — WORM triggers, vector store, evidence fabric | ✅ Complete |
| 4 | Middleware engine — orchestration layers, audit trail | ✅ Complete |
| 5 | EDU Reporter — 7 UC dashboards defined, prototype HTML delivered | ✅ Complete |
| 6 | Accreditation corpus — UC-03 CR1–CR6 evidence mappings documented | ✅ Complete |
| 7 | CI pipeline — lint, typecheck, build, WORM verification, test coverage | ✅ Complete |
| 8 | Security scan — Snyk, Trivy, Gitleaks, dependency audit | ✅ Complete |
| 9 | Helm chart and K8s manifests for GCP deployment | ✅ Complete |

---

## Phase 2 Kickoff Criteria

Phase 2 introduces **live Banner/Blackboard data binding**.  Before any live
student-record pipeline is enabled, **all three gates below must be GREEN**.
The `phase2-readiness` CI job (`.github/workflows/phase2-readiness.yml`)
checks every gate automatically on every push and pull request.

### Gate 1 — Gate Walker ✅

**Trigger:** Test harness passes 100 synthetic Gate 530 scenarios (all pass).

**Test file:** `tests/phase2-gates/gate-walker.test.ts`

**What is checked:**
- 34 allow-decision scenarios across all compliance dimensions and sectors.
- 33 deny-decision scenarios covering PII, security, and data-privacy rules.
- 33 escalate-decision scenarios for moderate-risk and financial contexts.
- A final summary assertion that all 100 scenarios produce the correct decision.

**CI gate:** `Gate Walker — 100 synthetic Gate530 scenarios` step in
`phase2-readiness.yml`.  Fails the workflow if any scenario produces an
unexpected decision.

**Status:** 🟢 PASS — 100/100 scenarios pass.

---

### Gate 2 — Accreditation Coverage ✅

**Trigger:** UC-03 corpus coverage reaches 100% mapping for CR1–CR6.

**Test file:** `tests/phase2-gates/accreditation-coverage.test.ts`

**What is checked:**

| Criterion | Title | Accreditor |
|-----------|-------|------------|
| CR1 | Curriculum Alignment with Accreditor Standards | SACSCOC |
| CR2 | Faculty Qualifications Documentation | SACSCOC |
| CR3 | Student Learning Outcomes Assessment | SACSCOC |
| CR4 | Institutional Effectiveness Evidence | SACSCOC |
| CR5 | Financial Stability and Resource Adequacy | SACSCOC |
| CR6 | Governance and Administration Compliance | SACSCOC |

Each criterion must have:
- At least one evidence item with a valid `evidenceId`, `description`, and
  `lastReviewed` date.
- A `qualityScore ≥ 0.7` for all evidence items.

The `calculateCoveragePercent` helper returns 100 % when all six criteria are
present; the gate fails if any criterion is missing or has no evidence.

**CI gate:** `Accreditation Coverage — UC-03 corpus CR1–CR6` step.

**Status:** 🟢 PASS — 100% coverage (CR1–CR6 all mapped).

---

### Gate 3 — EDU Reporter MVP ✅

**Trigger:** All Phase 1 views functional with mock data.

**Test file:** `tests/phase2-gates/edu-reporter-views.test.ts`

**What is checked:**

| View | Dashboard |
|------|-----------|
| UC-01 | Student Early-Alert Risk Dashboard |
| UC-02 | Retention Cohort Analysis Dashboard |
| UC-03 | Accreditation Gap Analysis Dashboard |
| UC-04 | Enrollment Funnel & Yield Prediction Dashboard |
| UC-05 | Financial Aid & Compliance Dashboard |
| UC-06 | Faculty Workload & Course Scheduling Dashboard |
| UC-07 | Degree-Plan-to-Licensure Compliance Dashboard |

For each view the test verifies:
1. The view definition is registered with an `id`, `title`, and `phase: 1`.
2. Mock data is provided and satisfies the view's required field schema.
3. The `renderView` function returns `status: 'ok'` with zero errors.
4. The render result exposes all declared summary fields.

**CI gate:** `EDU Reporter MVP — Phase 1 views with mock data` step.

**Status:** 🟢 PASS — all 7 Phase 1 views render successfully.

---

## Phase 2 Readiness Summary

| Gate | Condition | CI Step | Status |
|------|-----------|---------|--------|
| Gate Walker | 100/100 synthetic scenarios pass | `gate_walker` | 🟢 PASS |
| Accreditation Coverage | 100% CR1–CR6 mapped | `accreditation` | 🟢 PASS |
| EDU Reporter MVP | All 7 Phase 1 views functional | `edu_reporter` | 🟢 PASS |

**Overall Phase 2 readiness: 🟢 ALL GATES GREEN**

When all three gates are green the `phase2-readiness` workflow prints:

```
Phase 2 readiness check PASSED: all gates GREEN.
```

and exits with code `0`.  If any gate is red the workflow exits with code `1`
and the step summary shows which gate(s) failed.

---

## Phase 2 Scope (for reference)

Once all gates are green, Phase 2 work includes:

- Live Banner SIS binding (student demographics, enrollment, grades).
- Live Blackboard LMS binding (login activity, assignment submissions).
- Real-time risk scoring pipeline replacing mock data.
- EDU Reporter dashboards connected to live `v_*` database views.
- Pub/Sub event bus for real-time alerts to advisors.

Refer to `docs/Production_Readiness_and_Transfer_Plan.md` for the full Phase 2
acceptance criteria and Wave 2 exit criteria.
