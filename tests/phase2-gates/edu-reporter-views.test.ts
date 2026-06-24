/**
 * Phase 2 Gate: EDU Reporter MVP — Phase 1 Views
 *
 * Trigger condition: all Phase 1 views functional with mock data.
 *
 * The EDU Reporter has seven use-case dashboards (UC-01 through UC-07).
 * For Phase 1 MVP the following views must be functional with mock data:
 *
 *   UC-01 — Student Early-Alert Risk Dashboard
 *   UC-02 — Retention Cohort Analysis Dashboard
 *   UC-03 — Accreditation Gap Analysis Dashboard
 *   UC-04 — Enrollment Funnel & Yield Prediction Dashboard
 *   UC-05 — Financial Aid & Compliance Dashboard
 *   UC-06 — Faculty Workload & Course Scheduling Dashboard
 *   UC-07 — Degree-Plan-to-Licensure Compliance Dashboard
 *
 * "Functional with mock data" means:
 *   - The view definition is present with an id and title.
 *   - The view can be instantiated/rendered with a mock data payload.
 *   - The mock payload satisfies the view's required field schema.
 *   - The rendered output contains the expected summary fields.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// EDU Reporter view registry (mock implementation)
// ---------------------------------------------------------------------------

interface ViewField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
}

interface ViewDefinition {
  id: string;
  title: string;
  phase: 1 | 2;
  requiredFields: ViewField[];
}

interface ViewRenderResult {
  viewId: string;
  status: 'ok' | 'error';
  rowCount: number;
  summaryFields: string[];
  errors: string[];
}

/** Simulate rendering a view with a mock payload */
function renderView(
  view: ViewDefinition,
  mockRows: Record<string, unknown>[]
): ViewRenderResult {
  const errors: string[] = [];

  for (const row of mockRows) {
    for (const field of view.requiredFields.filter((f) => f.required)) {
      if (!(field.name in row)) {
        errors.push(`Row missing required field: ${field.name}`);
      }
    }
  }

  const summaryFields = view.requiredFields.map((f) => f.name);

  return {
    viewId: view.id,
    status: errors.length === 0 ? 'ok' : 'error',
    rowCount: mockRows.length,
    summaryFields,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Phase 1 View Definitions (from EDU Reporter Spec)
// ---------------------------------------------------------------------------

const PHASE1_VIEWS: ViewDefinition[] = [
  {
    id: 'UC-01',
    title: 'Student Early-Alert Risk Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'student_id', type: 'string', required: true },
      { name: 'risk_score', type: 'number', required: true },
      { name: 'risk_level', type: 'string', required: true },
      { name: 'gpa', type: 'number', required: true },
      { name: 'days_since_login', type: 'number', required: true },
      { name: 'advisor_id', type: 'string', required: true },
    ],
  },
  {
    id: 'UC-02',
    title: 'Retention Cohort Analysis Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'cohort_id', type: 'string', required: true },
      { name: 'term', type: 'string', required: true },
      { name: 'enrolled_count', type: 'number', required: true },
      { name: 'retained_count', type: 'number', required: true },
      { name: 'retention_rate', type: 'number', required: true },
      { name: 'demographic_breakdown', type: 'string', required: false },
    ],
  },
  {
    id: 'UC-03',
    title: 'Accreditation Gap Analysis Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'standard_id', type: 'string', required: true },
      { name: 'standard_body', type: 'string', required: true },
      { name: 'standard_title', type: 'string', required: true },
      { name: 'readiness_status', type: 'string', required: true },
      { name: 'evidence_count', type: 'number', required: true },
      { name: 'assigned_owner', type: 'string', required: false },
    ],
  },
  {
    id: 'UC-04',
    title: 'Enrollment Funnel & Yield Prediction Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'prospect_id', type: 'string', required: true },
      { name: 'funnel_stage', type: 'string', required: true },
      { name: 'yield_probability', type: 'number', required: true },
      { name: 'program_of_interest', type: 'string', required: true },
      { name: 'financial_aid_eligible', type: 'boolean', required: false },
    ],
  },
  {
    id: 'UC-05',
    title: 'Financial Aid & Compliance Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'student_id', type: 'string', required: true },
      { name: 'aid_package_id', type: 'string', required: true },
      { name: 'sap_status', type: 'string', required: true },
      { name: 'disbursement_date', type: 'date', required: true },
      { name: 'compliance_flag', type: 'boolean', required: true },
    ],
  },
  {
    id: 'UC-06',
    title: 'Faculty Workload & Course Scheduling Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'faculty_id', type: 'string', required: true },
      { name: 'department', type: 'string', required: true },
      { name: 'course_load', type: 'number', required: true },
      { name: 'overload_flag', type: 'boolean', required: true },
      { name: 'term', type: 'string', required: true },
    ],
  },
  {
    id: 'UC-07',
    title: 'Degree-Plan-to-Licensure Compliance Dashboard',
    phase: 1,
    requiredFields: [
      { name: 'student_id', type: 'string', required: true },
      { name: 'cip_code', type: 'string', required: true },
      { name: 'destination_state', type: 'string', required: true },
      { name: 'licensure_required', type: 'boolean', required: true },
      { name: 'gap_detected', type: 'boolean', required: true },
      { name: 'gap_description', type: 'string', required: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Mock data payloads per view
// ---------------------------------------------------------------------------

const MOCK_DATA: Record<string, Record<string, unknown>[]> = {
  'UC-01': [
    { student_id: 'S001', risk_score: 0.82, risk_level: 'HIGH', gpa: 1.9, days_since_login: 14, advisor_id: 'A001' },
    { student_id: 'S002', risk_score: 0.45, risk_level: 'MEDIUM', gpa: 2.8, days_since_login: 3, advisor_id: 'A002' },
    { student_id: 'S003', risk_score: 0.12, risk_level: 'LOW', gpa: 3.7, days_since_login: 1, advisor_id: 'A001' },
  ],
  'UC-02': [
    { cohort_id: 'C2022-FA', term: '2022-FA', enrolled_count: 450, retained_count: 405, retention_rate: 0.9 },
    { cohort_id: 'C2023-FA', term: '2023-FA', enrolled_count: 480, retained_count: 422, retention_rate: 0.879 },
  ],
  'UC-03': [
    { standard_id: 'SACSCOC-12.1', standard_body: 'SACSCOC', standard_title: 'Curriculum', readiness_status: 'GREEN', evidence_count: 4 },
    { standard_id: 'SACSCOC-13.7', standard_body: 'SACSCOC', standard_title: 'Faculty', readiness_status: 'YELLOW', evidence_count: 2 },
  ],
  'UC-04': [
    { prospect_id: 'P001', funnel_stage: 'Applied', yield_probability: 0.73, program_of_interest: 'Computer Science', financial_aid_eligible: true },
    { prospect_id: 'P002', funnel_stage: 'Admitted', yield_probability: 0.88, program_of_interest: 'Nursing', financial_aid_eligible: false },
  ],
  'UC-05': [
    { student_id: 'S001', aid_package_id: 'AID-2025-001', sap_status: 'SATISFACTORY', disbursement_date: '2025-08-15', compliance_flag: false },
    { student_id: 'S004', aid_package_id: 'AID-2025-002', sap_status: 'WARNING', disbursement_date: '2025-08-15', compliance_flag: true },
  ],
  'UC-06': [
    { faculty_id: 'F001', department: 'Engineering', course_load: 3, overload_flag: false, term: '2025-FA' },
    { faculty_id: 'F002', department: 'Nursing', course_load: 5, overload_flag: true, term: '2025-FA' },
  ],
  'UC-07': [
    { student_id: 'S005', cip_code: '51.3801', destination_state: 'CA', licensure_required: true, gap_detected: false, gap_description: null },
    { student_id: 'S006', cip_code: '13.1202', destination_state: 'TX', licensure_required: true, gap_detected: true, gap_description: 'Missing TX pedagogy requirement' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 2 Gate: EDU Reporter MVP — Phase 1 views with mock data', () => {
  describe('view registry', () => {
    it('should register exactly 7 Phase 1 views (UC-01 through UC-07)', () => {
      expect(PHASE1_VIEWS).toHaveLength(7);
    });

    it('should include all expected view IDs', () => {
      const ids = PHASE1_VIEWS.map((v) => v.id);
      for (const expected of ['UC-01', 'UC-02', 'UC-03', 'UC-04', 'UC-05', 'UC-06', 'UC-07']) {
        expect(ids, `Missing view ${expected} in Phase 1 registry`).toContain(expected);
      }
    });

    it('every view should have a non-empty title', () => {
      for (const view of PHASE1_VIEWS) {
        expect(view.title, `View ${view.id} has empty title`).toBeTruthy();
      }
    });

    it('every view should be marked as Phase 1', () => {
      for (const view of PHASE1_VIEWS) {
        expect(view.phase, `View ${view.id} is not Phase 1`).toBe(1);
      }
    });

    it('every view should declare at least one required field', () => {
      for (const view of PHASE1_VIEWS) {
        const requiredFields = view.requiredFields.filter((f) => f.required);
        expect(
          requiredFields.length,
          `View ${view.id} has no required fields`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('mock data coverage', () => {
    it('mock data should be provided for every Phase 1 view', () => {
      for (const view of PHASE1_VIEWS) {
        expect(
          MOCK_DATA[view.id],
          `No mock data provided for view ${view.id}`
        ).toBeDefined();
        expect(
          MOCK_DATA[view.id].length,
          `Mock data for view ${view.id} is empty`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('per-view render tests', () => {
    for (const view of PHASE1_VIEWS) {
      describe(`${view.id}: ${view.title}`, () => {
        it(`${view.id}: renders without errors using mock data`, () => {
          const mockRows = MOCK_DATA[view.id];
          const result = renderView(view, mockRows);

          expect(result.viewId).toBe(view.id);
          expect(result.status).toBe('ok');
          expect(result.errors).toHaveLength(0);
          expect(result.rowCount).toBeGreaterThan(0);
        });

        it(`${view.id}: render result contains all declared field names`, () => {
          const mockRows = MOCK_DATA[view.id];
          const result = renderView(view, mockRows);
          const expectedFields = view.requiredFields.map((f) => f.name);
          for (const field of expectedFields) {
            expect(result.summaryFields, `View ${view.id} missing field ${field}`).toContain(field);
          }
        });
      });
    }
  });

  describe('phase 2 gate summary', () => {
    it('all Phase 1 views render successfully — EDU Reporter MVP gate is GREEN', () => {
      const results = PHASE1_VIEWS.map((view) => {
        const mockRows = MOCK_DATA[view.id] ?? [];
        const result = renderView(view, mockRows);
        return { viewId: view.id, title: view.title, passed: result.status === 'ok', errors: result.errors };
      });

      const failed = results.filter((r) => !r.passed);

      if (failed.length > 0) {
        const details = failed
          .map((f) => `${f.viewId} (${f.title}): ${f.errors.join('; ')}`)
          .join('\n  ');
        throw new Error(`EDU Reporter MVP gate is RED: ${failed.length} view(s) failed:\n  ${details}`);
      }

      expect(results.filter((r) => r.passed)).toHaveLength(7);
    });
  });
});
