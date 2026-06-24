/**
 * Stage 7: RECONCILE
 * Reconciles with external systems (Banner Ethos, Blackboard) for Phase 1 mock testing.
 * Uses mock adapters — no live credentials.
 */

import type { GateRequest, StageResult, ReconciliationResult } from '../types.js';
import type { RoutingResult } from './route.js';

export interface BannerEthosAdapter {
  lookupStudent(actorId: string): Promise<{
    enrollmentStatus: string;
    ferpaHold: boolean;
    programCode?: string;
  } | null>;
}

export interface BlackboardAdapter {
  lookupEnrollment(actorId: string, courseId: string): Promise<{
    enrollmentStatus: string;
    courseId: string;
  } | null>;
}

export interface ReconcileOptions {
  bannerEthos?: BannerEthosAdapter;
  blackboard?: BlackboardAdapter;
}

export async function reconcileStage(
  request: GateRequest,
  routing: RoutingResult,
  options: ReconcileOptions = {}
): Promise<{ result: StageResult; reconciliation?: ReconciliationResult }> {
  const start = Date.now();

  // Skip reconciliation for deny path — no need to call external systems
  if (routing.path === 'deny') {
    const reconciliation: ReconciliationResult = {
      bannerStatus: 'skipped',
      blackboardStatus: 'skipped',
      reconciled: true,
      details: { reason: 'Skipped: deny path' },
    };
    return {
      result: {
        stage: 'RECONCILE',
        status: 'skip',
        reason: 'Reconciliation skipped on deny path',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      reconciliation,
    };
  }

  const details: Record<string, unknown> = {};
  let bannerStatus: ReconciliationResult['bannerStatus'] = 'skipped';
  let blackboardStatus: ReconciliationResult['blackboardStatus'] = 'skipped';

  // Banner Ethos reconciliation (FERPA path) — look up the STUDENT whose data is being accessed
  if (options.bannerEthos && (routing.path === 'ferpa' || routing.targetSystem === 'banner-ethos')) {
    const studentId = request.resource.id;
    try {
      const bannerRecord = await options.bannerEthos.lookupStudent(studentId);
      if (bannerRecord) {
        bannerStatus = 'verified';
        details.bannerRecord = {
          enrollmentStatus: bannerRecord.enrollmentStatus,
          ferpaHold: bannerRecord.ferpaHold,
          programCode: bannerRecord.programCode,
        };
      } else {
        bannerStatus = 'not_found';
        details.bannerWarning = 'Student not found in Banner Ethos';
      }
    } catch (err) {
      bannerStatus = 'error';
      details.bannerError = err instanceof Error ? err.message : String(err);
    }
  }

  // Blackboard reconciliation (course/grade access)
  if (options.blackboard && request.resource.type === 'course') {
    try {
      const bbRecord = await options.blackboard.lookupEnrollment(
        request.actorId,
        request.resource.id
      );
      if (bbRecord) {
        blackboardStatus = 'verified';
        details.blackboardRecord = {
          enrollmentStatus: bbRecord.enrollmentStatus,
          courseId: bbRecord.courseId,
        };
      } else {
        blackboardStatus = 'not_found';
        details.blackboardWarning = 'Enrollment not found in Blackboard';
      }
    } catch (err) {
      blackboardStatus = 'error';
      details.blackboardError = err instanceof Error ? err.message : String(err);
    }
  }

  const reconciliation: ReconciliationResult = {
    bannerStatus,
    blackboardStatus,
    reconciled: bannerStatus !== 'error' && blackboardStatus !== 'error',
    details,
  };

  return {
    result: {
      stage: 'RECONCILE',
      status: 'pass',
      reason: `Reconciled: banner=${bannerStatus}, blackboard=${blackboardStatus}`,
      metadata: details,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    reconciliation,
  };
}
