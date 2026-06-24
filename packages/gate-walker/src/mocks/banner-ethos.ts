/**
 * Mock Banner Ethos API Adapter
 * Phase 1 testing adapter — no live credentials used.
 *
 * Banner Ethos is Ellucian's API gateway for Banner ERP data (student records, enrollment, grades).
 */

import type { BannerEthosRecord } from '../types.js';

export interface BannerEthosAdapter {
  lookupStudent(studentId: string): Promise<BannerEthosRecord | null>;
  verifyEnrollment(studentId: string, termCode: string): Promise<boolean>;
}

/**
 * Deterministic mock data for Phase 1 testing.
 * Covers a variety of scenarios including FERPA holds and enrollment statuses.
 */
const MOCK_STUDENTS: Map<string, BannerEthosRecord> = new Map([
  [
    'student-001',
    {
      studentId: 'student-001',
      enrollmentStatus: 'enrolled',
      ferpaHold: false,
      programCode: 'CS-BS',
      gpa: 3.5,
    },
  ],
  [
    'student-002',
    {
      studentId: 'student-002',
      enrollmentStatus: 'enrolled',
      ferpaHold: true,
      programCode: 'MATH-MS',
      gpa: 3.8,
    },
  ],
  [
    'student-003',
    {
      studentId: 'student-003',
      enrollmentStatus: 'graduated',
      ferpaHold: false,
      programCode: 'ENG-BS',
      gpa: 3.2,
    },
  ],
  [
    'student-004',
    {
      studentId: 'student-004',
      enrollmentStatus: 'withdrawn',
      ferpaHold: false,
      programCode: 'BUS-BA',
    },
  ],
  [
    'student-005',
    {
      studentId: 'student-005',
      enrollmentStatus: 'enrolled',
      ferpaHold: true,
      programCode: 'LAW-JD',
      gpa: 3.9,
    },
  ],
]);

export class MockBannerEthosAdapter implements BannerEthosAdapter {
  private readonly latencyMs: number;
  private readonly failureRate: number;

  /**
   * @param latencyMs  Simulated API latency in ms (default: 10)
   * @param failureRate  Fraction of requests that simulate API errors [0-1] (default: 0)
   */
  constructor(latencyMs = 10, failureRate = 0) {
    this.latencyMs = latencyMs;
    this.failureRate = failureRate;
  }

  async lookupStudent(studentId: string): Promise<BannerEthosRecord | null> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error(`Banner Ethos API error: service unavailable (simulated)`);
    }

    return MOCK_STUDENTS.get(studentId) ?? null;
  }

  async verifyEnrollment(studentId: string, _termCode: string): Promise<boolean> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error(`Banner Ethos API error: enrollment check failed (simulated)`);
    }

    const record = MOCK_STUDENTS.get(studentId);
    return record?.enrollmentStatus === 'enrolled';
  }

  private async simulateLatency(): Promise<void> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }

  private shouldFail(): boolean {
    return this.failureRate > 0 && Math.random() < this.failureRate;
  }
}
