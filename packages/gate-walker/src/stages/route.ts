/**
 * Stage 5: ROUTE
 * Determines the execution path based on classification and authorization results.
 */

import type { StageResult, ClassificationResult, RoutingResult } from '../types.js';
import type { AuthorizationResult } from './authorize.js';

export function routeStage(
  classification: ClassificationResult,
  authorization: AuthorizationResult
): { result: StageResult; routing?: RoutingResult } {
  const start = Date.now();

  if (!authorization.authorized) {
    const routing: RoutingResult = {
      path: 'deny',
      reason: 'Authorization failed — routing to deny path',
    };
    return {
      result: {
        stage: 'ROUTE',
        status: 'pass',
        reason: routing.reason,
        metadata: { path: routing.path },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      routing,
    };
  }

  if (classification.ferpaProtected) {
    const routing: RoutingResult = {
      path: 'ferpa',
      targetSystem: 'banner-ethos',
      reason: 'FERPA-protected resource — routing to FERPA compliance path with Banner Ethos verification',
    };
    return {
      result: {
        stage: 'ROUTE',
        status: 'pass',
        reason: routing.reason,
        metadata: { path: routing.path, targetSystem: routing.targetSystem },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      routing,
    };
  }

  if (classification.riskScore >= 0.7) {
    const routing: RoutingResult = {
      path: 'escalate',
      reason: `High risk score (${classification.riskScore.toFixed(2)}) — routing to escalation path`,
    };
    return {
      result: {
        stage: 'ROUTE',
        status: 'pass',
        reason: routing.reason,
        metadata: { path: routing.path, riskScore: classification.riskScore },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      routing,
    };
  }

  const routing: RoutingResult = {
    path: 'standard',
    reason: 'Standard execution path',
  };

  return {
    result: {
      stage: 'ROUTE',
      status: 'pass',
      reason: routing.reason,
      metadata: { path: routing.path },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    routing,
  };
}

export type { RoutingResult } from '../types.js';
