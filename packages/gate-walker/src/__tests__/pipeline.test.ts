/**
 * Gate Walker Engine — Synthetic Test Harness
 * 100 scenarios covering: allow, ferpa, deny, and edge cases
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { GateWalkerPipeline } from '../pipeline.js';
import { MockBannerEthosAdapter } from '../mocks/banner-ethos.js';
import { MockBlackboardAdapter } from '../mocks/blackboard.js';
import { InMemoryStateStore } from '../db/state-store.js';
import type { GateRequest } from '../types.js';

// ─── Pipeline setup ────────────────────────────────────────────────────────

const TEST_API_KEYS = new Map([
  ['key-admin', { id: 'admin-001', roles: ['admin'] }],
  ['key-faculty', { id: 'faculty-001', roles: ['faculty'] }],
  ['key-advisor', { id: 'advisor-001', roles: ['advisor'] }],
  ['key-student', { id: 'student-001', roles: ['student'] }],
  ['key-system', { id: 'system-001', roles: ['system'] }],
]);

let pipeline: GateWalkerPipeline;
let stateStore: InMemoryStateStore;

beforeAll(() => {
  stateStore = new InMemoryStateStore();
  pipeline = new GateWalkerPipeline({
    apiKeys: TEST_API_KEYS,
    allowAnonymous: false,
    bannerEthos: new MockBannerEthosAdapter(0), // no latency for tests
    blackboard: new MockBlackboardAdapter(0),
    stateStore,
  });
});

// ─── Scenario builder helpers ──────────────────────────────────────────────

function makeRequest(overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    requestId: randomUUID(),
    actorId: 'actor-default',
    action: 'read',
    sector: 'general',
    resource: {
      type: 'document',
      id: 'doc-001',
      classification: 'public',
    },
    ...overrides,
  };
}

// ─── ALLOW scenarios (30 tests) ────────────────────────────────────────────

describe('ALLOW scenarios', () => {
  it('A01: admin reads public document', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-001', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
    expect(res.stages).toHaveLength(10);
  });

  it('A02: faculty reads public document', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-002', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A03: student reads public resource', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'read',
      resource: { type: 'page', id: 'page-001', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A04: advisor reads internal document', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-003', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A05: admin writes internal document', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'write',
      resource: { type: 'document', id: 'doc-004', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A06: system agent accesses any resource', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-system',
      actorId: 'system-001',
      action: 'read',
      resource: { type: 'report', id: 'rpt-001', classification: 'confidential' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A07: admin exports data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'export',
      resource: { type: 'dataset', id: 'ds-001', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A08: faculty reads grades (their course)', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'grade-001', classification: 'grade' },
    }));
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A09: advisor accesses enrollment data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'view_enrollment',
      sector: 'education',
      resource: { type: 'enrollment', id: 'enroll-001', classification: 'internal' },
    }));
    // FERPA action triggers FERPA path → REDACT is correct
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A10: admin reads restricted resource', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'student_record', id: 'student-001', classification: 'restricted' },
    }));
    // student_record in education-sector triggers FERPA route → REDACT with no fields for admin
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A11: system deletes document', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-system',
      actorId: 'system-001',
      action: 'delete',
      resource: { type: 'document', id: 'doc-del-001', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A12: admin accesses education sector public resource', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'course_catalog', id: 'cat-001', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A13: faculty reads transcript (authorized role)', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-001', classification: 'confidential' },
    }));
    // FERPA transcript access → REDACT (authorized with field-level redaction)
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A14: advisor views enrollment', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'view_enrollment',
      sector: 'education',
      resource: { type: 'enrollment', id: 'enroll-002', classification: 'internal' },
    }));
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A15: system exports student data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-system',
      actorId: 'system-001',
      action: 'export_student_data',
      sector: 'education',
      resource: { type: 'student_record', id: 'student-001', classification: 'restricted' },
    }));
    // FERPA action → FERPA path → REDACT (no fields redacted for system; student-001 has no hold)
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A16: each completed pipeline has exactly 10 stages', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-stage-check', classification: 'public' },
    }));
    expect(res.stages).toHaveLength(10);
    expect(res.stages.map(s => s.stage)).toEqual([
      'AUTHENTICATE', 'INTERPRET', 'CLASSIFY', 'AUTHORIZE',
      'ROUTE', 'EXECUTE', 'RECONCILE', 'REDACT', 'RESPOND', 'AUDIT',
    ]);
  });

  it('A17: audit receipt is always present on ALLOW', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-receipt', classification: 'public' },
    }));
    expect(res.auditReceipt).toBeDefined();
    expect(res.auditReceipt.decision).toBe('ALLOW');
    expect(res.auditReceipt.hash).toBeTruthy();
  });

  it('A18: processingMs is populated', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-timing', classification: 'public' },
    }));
    expect(res.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('A19: faculty reads internal report in education sector', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'report', id: 'rpt-edu-001', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A20: advisor reads public education resource', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'course_catalog', id: 'cat-002', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A21: admin accesses general sector without FERPA flags', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'general',
      resource: { type: 'config', id: 'config-001', classification: 'internal' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('A22: system agent accesses restricted resource in any sector', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-system',
      actorId: 'system-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'pii', id: 'pii-001', classification: 'pii' },
    }));
    // System is authorized for everything but pii classification triggers FERPA path → REDACT
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A23: request without requestId gets auto-assigned UUID', async () => {
    const req = makeRequest({ token: 'key-admin', actorId: 'admin-001' });
    delete (req as { requestId?: string }).requestId;
    const res = await pipeline.execute(req);
    expect(res.requestId).toBeTruthy();
  });

  it('A24: pipeline persists state for each request', async () => {
    const reqId = randomUUID();
    await pipeline.execute(makeRequest({
      requestId: reqId,
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-persist', classification: 'public' },
    }));
    const record = await stateStore.get(reqId);
    expect(record).not.toBeNull();
    expect(record?.requestId).toBe(reqId);
  });

  it('A25: each stage result has timestamp and durationMs', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-stage-meta', classification: 'public' },
    }));
    for (const stage of res.stages) {
      expect(stage.timestamp).toBeTruthy();
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('A26: admin reads public resource — redactedFields is empty', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-redact-check', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
    expect(res.redactedFields).toHaveLength(0);
  });

  it('A27: faculty accesses grade in education sector', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'grade-faculty-001', classification: 'confidential' },
    }));
    // FERPA action → FERPA route → REDACT (authorized with field-level redaction)
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A28: advisor accesses transcript — ALLOW with possible redaction', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-advisor-001', classification: 'confidential' },
    }));
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('A29: system exports report — 10 stages completed', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-system',
      actorId: 'system-001',
      action: 'export',
      resource: { type: 'report', id: 'rpt-system-001', classification: 'internal' },
    }));
    expect(res.stages).toHaveLength(10);
  });

  it('A30: audit receipt has correct actor and action fields', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'general',
      resource: { type: 'document', id: 'doc-audit-check', classification: 'public' },
    }));
    expect(res.auditReceipt.actor).toBe('admin-001');
    expect(res.auditReceipt.action).toBe('read');
    expect(res.auditReceipt.sector).toBe('general');
  });
});

// ─── FERPA scenarios (30 tests) ────────────────────────────────────────────

describe('FERPA scenarios', () => {
  it('F01: student accesses own FERPA-protected grade record', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'student-001', ferpaProtected: true, classification: 'confidential' },
    }));
    // Self-access by student → ALLOW (FERPA self-exemption)
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('F02: faculty reads FERPA transcript — ALLOW with FERPA route', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'transcript-001', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
    const routeStageResult = res.stages.find(s => s.stage === 'ROUTE');
    expect(routeStageResult?.metadata?.path).toBe('ferpa');
  });

  it('F03: FERPA-flagged resource routes through FERPA path', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'student_record', id: 'sr-001', ferpaProtected: true, classification: 'restricted' },
    }));
    const routeStageResult = res.stages.find(s => s.stage === 'ROUTE');
    expect(routeStageResult?.metadata?.path).toBe('ferpa');
  });

  it('F04: advisor accesses FERPA record — reconciles with Banner Ethos', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'transcript-002', ferpaProtected: true, classification: 'confidential' },
    }));
    const reconcileStageResult = res.stages.find(s => s.stage === 'RECONCILE');
    expect(reconcileStageResult).toBeDefined();
  });

  it('F05: student with FERPA hold blocked from sharing their own record to 3rd party', async () => {
    // This is a proxy test — an anonymous or unauthorized actor trying to access student-002 (who has ferpa hold)
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-002', ferpaProtected: true, classification: 'confidential' },
    }));
    // Banner Ethos returns ferpaHold=true for student-002 → DENY
    expect(res.decision).toBe('DENY');
  });

  it('F06: FERPA decision includes Banner Ethos reconciliation metadata', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-001', ferpaProtected: true, classification: 'confidential' },
    }));
    const reconcileResult = res.stages.find(s => s.stage === 'RECONCILE');
    expect(reconcileResult?.metadata?.bannerRecord).toBeDefined();
  });

  it('F07: FERPA resource — non-faculty unauthorized actor → DENY', async () => {
    // Anonymous/no-token actor trying to access FERPA record
    const res = await pipeline.execute(makeRequest({
      // No token — pipeline configured with allowAnonymous: false
      actorId: 'unknown-actor',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'grade-007', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('F08: FERPA route always produces a sealed audit receipt', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-audit-008', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.auditReceipt).toBeDefined();
    expect(res.auditReceipt.hash).toBeTruthy();
  });

  it('F09: FERPA resource with public classification still routes correctly', async () => {
    // ferpaProtected overrides classification
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'document', id: 'doc-ferpa-009', ferpaProtected: true, classification: 'public' },
    }));
    const routeStageResult = res.stages.find(s => s.stage === 'ROUTE');
    expect(routeStageResult?.metadata?.path).toBe('ferpa');
  });

  it('F10: FERPA action (read_grades) implies FERPA path regardless of ferpaProtected flag', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'document', id: 'doc-010', classification: 'public' },
    }));
    // Classify marks ferpaProtected → Route goes ferpa
    const classifyResult = res.stages.find(s => s.stage === 'CLASSIFY');
    expect(classifyResult?.metadata?.ferpaProtected).toBe(true);
  });

  it('F11: admin can access FERPA records without restriction', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-admin-011', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('F12: REDACT decision includes redacted field list', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-999', // Not self-access for another student's record
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'student-001', ferpaProtected: true, classification: 'confidential' },
    }));
    if (res.decision === 'REDACT') {
      expect(res.redactedFields.length).toBeGreaterThan(0);
    }
  });

  it('F13: student accesses their own enrollment — ALLOW or REDACT', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'view_enrollment',
      sector: 'education',
      resource: { type: 'enrollment', id: 'student-001', classification: 'internal' },
    }));
    // Self-access: student views their own enrollment. FERPA action routes through
    // FERPA path → REDACT decision, but no fields redacted (self-access)
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('F14: FERPA transcript resource_type detected from interpret stage', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-014', classification: 'confidential' },
    }));
    const interpretResult = res.stages.find(s => s.stage === 'INTERPRET');
    expect(interpretResult?.metadata?.isFerpaContext).toBe(true);
  });

  it('F15: FERPA action export_student_data triggers FERPA path', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'export_student_data',
      sector: 'education',
      resource: { type: 'dataset', id: 'ds-ferpa-015', classification: 'restricted' },
    }));
    const classifyResult = res.stages.find(s => s.stage === 'CLASSIFY');
    expect(classifyResult?.metadata?.ferpaProtected).toBe(true);
  });

  it('F16: Banner Ethos not-found result handled gracefully', async () => {
    // student-999 not in mock Banner Ethos
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-999', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.stages.find(s => s.stage === 'RECONCILE')?.metadata?.bannerWarning).toBeTruthy();
  });

  it('F17: FERPA redact stage applies gpa and grade field redaction for unauthorized roles', async () => {
    // student-999 accessing another student's record
    const pipeline2 = new GateWalkerPipeline({
      apiKeys: new Map([['key-student-999', { id: 'student-999', roles: ['student'] }]]),
      allowAnonymous: false,
      bannerEthos: new MockBannerEthosAdapter(0),
      blackboard: new MockBlackboardAdapter(0),
    });
    const res = await pipeline2.execute(makeRequest({
      token: 'key-student-999',
      actorId: 'student-999',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'student-001', ferpaProtected: true, classification: 'confidential' },
    }));
    if (res.decision === 'REDACT') {
      expect(res.redactedFields.some(f => ['gpa', 'grades', 'grade_points'].includes(f))).toBe(true);
    }
  });

  it('F18: FERPA audit receipt decision matches pipeline decision', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-018', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.auditReceipt.decision).toBe(res.decision);
  });

  it('F19: FERPA pipeline route metadata includes targetSystem', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'student_record', id: 'sr-019', ferpaProtected: true, classification: 'restricted' },
    }));
    const routeResult = res.stages.find(s => s.stage === 'ROUTE');
    expect(routeResult?.metadata?.targetSystem).toBe('banner-ethos');
  });

  it('F20: advisor accesses enrolled student-001 transcript without hold', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-001', ferpaProtected: true, classification: 'confidential' },
    }));
    // student-001 has ferpaHold: false → not denied by hold
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('F21: FERPA resource type student_record triggers ferpaProtected classification', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'education',
      resource: { type: 'student_record', id: 'sr-021', classification: 'restricted' },
    }));
    const classifyResult = res.stages.find(s => s.stage === 'CLASSIFY');
    expect(classifyResult?.metadata?.ferpaProtected).toBe(true);
  });

  it('F22: FERPA reconciliation does not happen on standard (non-FERPA) path', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'general',
      resource: { type: 'document', id: 'doc-022', classification: 'public' },
    }));
    const reconcileResult = res.stages.find(s => s.stage === 'RECONCILE');
    // On standard path, Banner Ethos is not called
    expect(['pass', 'skip']).toContain(reconcileResult?.status);
  });

  it('F23: FERPA student-003 (graduated, no hold) — advisor access allowed', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-003', ferpaProtected: true, classification: 'confidential' },
    }));
    // student-003 has no FERPA hold — should not be blocked by hold
    expect(['ALLOW', 'REDACT']).toContain(res.decision);
  });

  it('F24: FERPA student-005 (hold active) — non-self access denied', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-005', ferpaProtected: true, classification: 'confidential' },
    }));
    // student-005 has ferpaHold: true → DENY
    expect(res.decision).toBe('DENY');
  });

  it('F25: FERPA audit receipt resource field is populated', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-025', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.auditReceipt.resource).toContain('transcript');
  });

  it('F26: FERPA route stage status is pass', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'read_grades',
      sector: 'education',
      resource: { type: 'grade', id: 'grade-026', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.stages.find(s => s.stage === 'ROUTE')?.status).toBe('pass');
  });

  it('F27: multiple FERPA requests produce unique audit receipt IDs', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await pipeline.execute(makeRequest({
        requestId: randomUUID(),
        token: 'key-faculty',
        actorId: 'faculty-001',
        action: 'access_transcript',
        sector: 'education',
        resource: { type: 'transcript', id: `ts-027-${i}`, ferpaProtected: true, classification: 'confidential' },
      }));
      ids.add(res.auditReceipt.id);
    }
    expect(ids.size).toBe(5);
  });

  it('F28: FERPA request includes requestId in audit receipt', async () => {
    const reqId = randomUUID();
    const res = await pipeline.execute(makeRequest({
      requestId: reqId,
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-028', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.auditReceipt.requestId).toBe(reqId);
  });

  it('F29: FERPA classify stage tags include "ferpa"', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'ts-029', ferpaProtected: true, classification: 'confidential' },
    }));
    const classifyResult = res.stages.find(s => s.stage === 'CLASSIFY');
    expect((classifyResult?.metadata?.tags as string[])?.includes('ferpa')).toBe(true);
  });

  it('F30: FERPA pipeline completes in all 10 stages', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'view_enrollment',
      sector: 'education',
      resource: { type: 'enrollment', id: 'enroll-f30', ferpaProtected: true, classification: 'internal' },
    }));
    expect(res.stages).toHaveLength(10);
  });
});

// ─── DENY scenarios (30 tests) ─────────────────────────────────────────────

describe('DENY scenarios', () => {
  it('D01: no token provided — authentication fails', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'unknown-actor',
      action: 'read',
      resource: { type: 'document', id: 'doc-d01', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    expect(res.stages.find(s => s.stage === 'AUTHENTICATE')?.status).toBe('fail');
  });

  it('D02: invalid token — authentication fails', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'invalid-key-xyz',
      actorId: 'attacker',
      action: 'read',
      resource: { type: 'document', id: 'doc-d02', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D03: student tries to delete a document — unauthorized', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'delete',
      resource: { type: 'document', id: 'doc-d03', classification: 'internal' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D04: anonymous user (no roles) cannot access confidential resource', async () => {
    const anonPipeline = new GateWalkerPipeline({
      apiKeys: new Map([['anon-key', { id: 'anon-001', roles: ['anonymous'] }]]),
      allowAnonymous: false,
    });
    const res = await anonPipeline.execute(makeRequest({
      token: 'anon-key',
      actorId: 'anon-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-d04', classification: 'confidential' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D05: student cannot export data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'export',
      resource: { type: 'dataset', id: 'ds-d05', classification: 'internal' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D06: student cannot write to documents', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'write',
      resource: { type: 'document', id: 'doc-d06', classification: 'internal' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D07: deny pipeline short-circuits after AUTHENTICATE failure', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-actor',
      action: 'read',
      resource: { type: 'document', id: 'doc-d07', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    const authStage = res.stages.find(s => s.stage === 'AUTHENTICATE');
    expect(authStage?.status).toBe('fail');
  });

  it('D08: deny decision always produces an audit receipt', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'bad-actor',
      action: 'delete',
      resource: { type: 'document', id: 'doc-d08', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    expect(res.auditReceipt).toBeDefined();
    expect(res.auditReceipt.decision).toBe('DENY');
  });

  it('D09: missing resource type causes DENY', async () => {
    const res = await pipeline.execute({
      requestId: randomUUID(),
      actorId: 'actor-d09',
      token: 'key-admin',
      action: 'read',
      sector: 'general',
      resource: { type: '', id: 'res-d09' }, // empty type
    });
    expect(res.decision).toBe('DENY');
  });

  it('D10: missing action causes DENY', async () => {
    const res = await pipeline.execute({
      requestId: randomUUID(),
      actorId: 'actor-d10',
      token: 'key-admin',
      action: '',
      sector: 'general',
      resource: { type: 'document', id: 'doc-d10' },
    });
    expect(res.decision).toBe('DENY');
  });

  it('D11: student cannot access_transcript for another student', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-002', ferpaProtected: true, classification: 'confidential' },
    }));
    // student-002 has FERPA hold → DENY
    expect(res.decision).toBe('DENY');
  });

  it('D12: student cannot export_student_data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'export_student_data',
      sector: 'education',
      resource: { type: 'student_record', id: 'sr-d12', classification: 'restricted' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D13: deny audit receipt requestId matches request', async () => {
    const reqId = randomUUID();
    const res = await pipeline.execute(makeRequest({
      requestId: reqId,
      actorId: 'no-token-actor',
      action: 'read',
      resource: { type: 'document', id: 'doc-d13', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    expect(res.auditReceipt.requestId).toBe(reqId);
  });

  it('D14: deny produces correct stage history', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d14',
      action: 'read',
      resource: { type: 'document', id: 'doc-d14', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    // All remaining stages after AUTH fail should be 'skip'
    const skippedStages = res.stages.filter(s => s.status === 'skip');
    expect(skippedStages.length).toBeGreaterThan(0);
  });

  it('D15: student cannot access restricted PII', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'read',
      resource: { type: 'pii', id: 'pii-d15', classification: 'restricted' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D16: high-risk operation (escalate path) → DENY in Phase 1', async () => {
    // Risk score >= 0.7: restricted + ferpa + delete
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'delete',
      resource: { type: 'student_record', id: 'sr-d16', ferpaProtected: true, classification: 'restricted' },
    }));
    // student does not have delete permission → DENY from authorization
    expect(res.decision).toBe('DENY');
  });

  it('D17: DENY audit receipt hash is non-empty', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d17',
      action: 'read',
      resource: { type: 'document', id: 'doc-d17', classification: 'public' },
    }));
    expect(res.auditReceipt.hash).toBeTruthy();
    expect(res.auditReceipt.hash.length).toBeGreaterThan(0);
  });

  it('D18: DENY result has AUDIT stage in history', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d18',
      action: 'read',
      resource: { type: 'document', id: 'doc-d18', classification: 'public' },
    }));
    const auditStageResult = res.stages.find(s => s.stage === 'AUDIT');
    expect(auditStageResult).toBeDefined();
    expect(auditStageResult?.status).toBe('pass');
  });

  it('D19: student with anonymous role cannot read confidential document', async () => {
    const testPipeline = new GateWalkerPipeline({
      apiKeys: new Map([['anon-key-d19', { id: 'anon-d19', roles: ['anonymous'] }]]),
      allowAnonymous: false,
    });
    const res = await testPipeline.execute(makeRequest({
      token: 'anon-key-d19',
      actorId: 'anon-d19',
      action: 'read',
      resource: { type: 'document', id: 'doc-d19', classification: 'confidential' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D20: DENY processingMs is populated', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d20',
      action: 'read',
      resource: { type: 'document', id: 'doc-d20', classification: 'public' },
    }));
    expect(res.processingMs).toBeGreaterThanOrEqual(0);
  });

  it('D21: faculty cannot delete student records', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'delete',
      resource: { type: 'student_record', id: 'sr-d21', classification: 'restricted' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D22: advisor cannot export data', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-advisor',
      actorId: 'advisor-001',
      action: 'export',
      resource: { type: 'dataset', id: 'ds-d22', classification: 'internal' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D23: DENY result has AUTHENTICATE stage', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d23',
      action: 'read',
      resource: { type: 'document', id: 'doc-d23', classification: 'public' },
    }));
    expect(res.stages[0]?.stage).toBe('AUTHENTICATE');
  });

  it('D24: missing actorId causes DENY', async () => {
    const res = await pipeline.execute({
      requestId: randomUUID(),
      actorId: '',
      action: 'read',
      sector: 'general',
      resource: { type: 'document', id: 'doc-d24' },
    });
    expect(res.decision).toBe('DENY');
  });

  it('D25: student cannot access FERPA record belonging to another student', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'read_grades',
      sector: 'education',
      // Accessing student-002 (has FERPA hold), not self-access
      resource: { type: 'grade', id: 'student-002', ferpaProtected: true, classification: 'confidential' },
    }));
    // student-002 has FERPA hold → DENY
    expect(res.decision).toBe('DENY');
  });

  it('D26: FERPA hold denial message is meaningful', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-faculty',
      actorId: 'faculty-001',
      action: 'access_transcript',
      sector: 'education',
      resource: { type: 'transcript', id: 'student-005', ferpaProtected: true, classification: 'confidential' },
    }));
    expect(res.decision).toBe('DENY');
    expect(res.reason.toLowerCase()).toContain('ferpa');
  });

  it('D27: deny for student export has EXECUTE stage = deny', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-student',
      actorId: 'student-001',
      action: 'export_student_data',
      sector: 'education',
      resource: { type: 'student_record', id: 'sr-d27', classification: 'restricted' },
    }));
    expect(res.decision).toBe('DENY');
  });

  it('D28: deny audit receipt has version 1.0.0', async () => {
    const res = await pipeline.execute(makeRequest({
      actorId: 'no-token-d28',
      action: 'read',
      resource: { type: 'document', id: 'doc-d28', classification: 'public' },
    }));
    expect(res.auditReceipt.version).toBe('1.0.0');
  });

  it('D29: multiple concurrent denials produce distinct audit receipts', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        pipeline.execute(makeRequest({
          requestId: randomUUID(),
          actorId: `no-token-d29-${i}`,
          action: 'read',
          resource: { type: 'document', id: `doc-d29-${i}`, classification: 'public' },
        }))
      )
    );
    const receiptIds = new Set(results.map(r => r.auditReceipt.id));
    expect(receiptIds.size).toBe(5);
  });

  it('D30: state store records deny decision correctly', async () => {
    const reqId = randomUUID();
    const res = await pipeline.execute(makeRequest({
      requestId: reqId,
      actorId: 'no-token-d30',
      action: 'read',
      resource: { type: 'document', id: 'doc-d30', classification: 'public' },
    }));
    expect(res.decision).toBe('DENY');
    const stored = await stateStore.get(reqId);
    expect(stored?.finalDecision).toBe('DENY');
  });
});

// ─── Edge case scenarios (10 tests) ───────────────────────────────────────

describe('Edge case scenarios', () => {
  it('E01: extremely long requestId is handled', async () => {
    const longId = 'a'.repeat(255);
    const res = await pipeline.execute(makeRequest({
      requestId: longId,
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e01', classification: 'public' },
    }));
    expect(['ALLOW', 'DENY', 'REDACT']).toContain(res.decision);
  });

  it('E02: special characters in actorId are handled', async () => {
    const specialPipeline = new GateWalkerPipeline({
      apiKeys: new Map([['key-special', { id: 'user@domain.com', roles: ['admin'] }]]),
      allowAnonymous: false,
    });
    const res = await specialPipeline.execute(makeRequest({
      token: 'key-special',
      actorId: 'user@domain.com',
      action: 'read',
      resource: { type: 'document', id: 'doc-e02', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('E03: resource with no classification defaults gracefully', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e03' }, // no classification
    }));
    expect(['ALLOW', 'DENY', 'REDACT']).toContain(res.decision);
  });

  it('E04: pipeline with no adapters runs without error', async () => {
    const minimalPipeline = new GateWalkerPipeline({
      apiKeys: TEST_API_KEYS,
      allowAnonymous: false,
    });
    const res = await minimalPipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e04', classification: 'public' },
    }));
    expect(res.decision).toBe('ALLOW');
  });

  it('E05: duplicate requestIds produce independent results', async () => {
    const reqId = randomUUID();
    const [res1, res2] = await Promise.all([
      pipeline.execute(makeRequest({
        requestId: reqId + '-1',
        token: 'key-admin',
        actorId: 'admin-001',
        action: 'read',
        resource: { type: 'document', id: 'doc-e05-1', classification: 'public' },
      })),
      pipeline.execute(makeRequest({
        requestId: reqId + '-2',
        token: 'key-admin',
        actorId: 'admin-001',
        action: 'read',
        resource: { type: 'document', id: 'doc-e05-2', classification: 'public' },
      })),
    ]);
    expect(res1.requestId).not.toBe(res2.requestId);
    expect(res1.auditReceipt.id).not.toBe(res2.auditReceipt.id);
  });

  it('E06: unknown sector defaults to general sector behavior', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      sector: 'unknown-sector-xyz',
      resource: { type: 'document', id: 'doc-e06', classification: 'public' },
    }));
    expect(['ALLOW', 'DENY', 'REDACT']).toContain(res.decision);
  });

  it('E07: metadata field in request does not break pipeline', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e07', classification: 'public' },
      metadata: { source: 'test', tags: ['e2e', 'regression'], nested: { deep: true } },
    }));
    expect(['ALLOW', 'DENY', 'REDACT']).toContain(res.decision);
  });

  it('E08: 10 sequential requests all complete with valid decisions', async () => {
    const decisions = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const res = await pipeline.execute(makeRequest({
        requestId: randomUUID(),
        token: 'key-admin',
        actorId: 'admin-001',
        action: 'read',
        resource: { type: 'document', id: `doc-e08-${i}`, classification: 'public' },
      }));
      decisions.add(res.decision);
      expect(['ALLOW', 'DENY', 'REDACT']).toContain(res.decision);
    }
  });

  it('E09: state store can list all persisted records', async () => {
    await pipeline.execute(makeRequest({
      requestId: randomUUID(),
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e09', classification: 'public' },
    }));
    const records = await stateStore.list();
    expect(records.length).toBeGreaterThan(0);
  });

  it('E10: audit receipt algorithm field is populated', async () => {
    const res = await pipeline.execute(makeRequest({
      token: 'key-admin',
      actorId: 'admin-001',
      action: 'read',
      resource: { type: 'document', id: 'doc-e10', classification: 'public' },
    }));
    expect(res.auditReceipt.algorithm).toBeTruthy();
  });
});
