/**
 * Mock Blackboard API Adapter
 * Phase 1 testing adapter — no live credentials used.
 *
 * Blackboard Learn is the LMS used for course enrollment and grade data.
 */

import type { BlackboardCourseRecord } from '../types.js';

export interface BlackboardAdapter {
  lookupEnrollment(studentId: string, courseId: string): Promise<BlackboardCourseRecord | null>;
  lookupGrade(studentId: string, courseId: string): Promise<{ grade: string; points: number } | null>;
}

/**
 * Deterministic mock enrollment data for Phase 1 testing.
 */
const MOCK_ENROLLMENTS: Map<string, BlackboardCourseRecord> = new Map([
  [
    'student-001:CSCI-1301',
    {
      courseId: 'CSCI-1301',
      studentId: 'student-001',
      enrollmentStatus: 'active',
      grade: 'A',
      lastAccess: '2024-03-15T10:30:00Z',
    },
  ],
  [
    'student-001:MATH-2413',
    {
      courseId: 'MATH-2413',
      studentId: 'student-001',
      enrollmentStatus: 'active',
      grade: 'B+',
      lastAccess: '2024-03-14T14:00:00Z',
    },
  ],
  [
    'student-002:CSCI-1301',
    {
      courseId: 'CSCI-1301',
      studentId: 'student-002',
      enrollmentStatus: 'active',
      grade: 'A+',
      lastAccess: '2024-03-15T09:00:00Z',
    },
  ],
  [
    'student-003:ENGL-1301',
    {
      courseId: 'ENGL-1301',
      studentId: 'student-003',
      enrollmentStatus: 'completed',
      grade: 'B',
      lastAccess: '2023-12-10T16:00:00Z',
    },
  ],
  [
    'student-004:BUS-1301',
    {
      courseId: 'BUS-1301',
      studentId: 'student-004',
      enrollmentStatus: 'dropped',
      lastAccess: '2024-01-20T08:00:00Z',
    },
  ],
]);

export class MockBlackboardAdapter implements BlackboardAdapter {
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

  async lookupEnrollment(studentId: string, courseId: string): Promise<BlackboardCourseRecord | null> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error(`Blackboard API error: service unavailable (simulated)`);
    }

    const key = `${studentId}:${courseId}`;
    return MOCK_ENROLLMENTS.get(key) ?? null;
  }

  async lookupGrade(
    studentId: string,
    courseId: string
  ): Promise<{ grade: string; points: number } | null> {
    await this.simulateLatency();

    if (this.shouldFail()) {
      throw new Error(`Blackboard API error: grade lookup failed (simulated)`);
    }

    const key = `${studentId}:${courseId}`;
    const record = MOCK_ENROLLMENTS.get(key);
    if (!record?.grade) return null;

    const gradePoints: Record<string, number> = {
      'A+': 4.0, A: 4.0, 'A-': 3.7,
      'B+': 3.3, B: 3.0, 'B-': 2.7,
      'C+': 2.3, C: 2.0, 'C-': 1.7,
      D: 1.0, F: 0.0,
    };

    return {
      grade: record.grade,
      points: gradePoints[record.grade] ?? 0.0,
    };
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
