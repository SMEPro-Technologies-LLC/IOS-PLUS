/**
 * Stage 6: EXECUTE
 * Applies the compliance decision based on routing path and classification.
 */

import type { GateRequest, StageResult, GateDecision, ClassificationResult } from '../types.js';
import type { RoutingResult } from './route.js';
import type { AuthorizationResult } from './authorize.js';

export interface ExecutionResult {
  decision: GateDecision;
  reason: string;
  policyMatched: string;
}

export function executeStage(
  request: GateRequest,
  routing: RoutingResult,
  classification: ClassificationResult,
  authorization: AuthorizationResult
): { result: StageResult; execution?: ExecutionResult } {
  const start = Date.now();

  // Deny path
  if (routing.path === 'deny' || !authorization.authorized) {
    const execution: ExecutionResult = {
      decision: 'DENY',
      reason: authorization.reason || 'Authorization denied',
      policyMatched: 'policy:deny-unauthorized',
    };
    return {
      result: {
        stage: 'EXECUTE',
        status: 'pass',
        decision: 'DENY',
        reason: execution.reason,
        metadata: { policyMatched: execution.policyMatched },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      execution,
    };
  }

  // FERPA path — apply redaction (not full deny, but restricted access with REDACT)
  if (routing.path === 'ferpa') {
    const execution: ExecutionResult = {
      decision: 'REDACT',
      reason: `FERPA-protected data requires field-level redaction before disclosure`,
      policyMatched: 'policy:ferpa-redact',
    };
    return {
      result: {
        stage: 'EXECUTE',
        status: 'pass',
        decision: 'REDACT',
        reason: execution.reason,
        metadata: { policyMatched: execution.policyMatched, ferpaProtected: true },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      execution,
    };
  }

  // Escalation path — treated as DENY in Phase 1
  if (routing.path === 'escalate') {
    const execution: ExecutionResult = {
      decision: 'DENY',
      reason: `High-risk request (score: ${classification.riskScore.toFixed(2)}) escalated — denied in Phase 1`,
      policyMatched: 'policy:escalate-deny',
    };
    return {
      result: {
        stage: 'EXECUTE',
        status: 'pass',
        decision: 'DENY',
        reason: execution.reason,
        metadata: { policyMatched: execution.policyMatched, riskScore: classification.riskScore },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      execution,
    };
  }

  // Standard path — allow
  const execution: ExecutionResult = {
    decision: 'ALLOW',
    reason: `Request authorized for ${request.action} on ${request.resource.type}`,
    policyMatched: 'policy:allow-standard',
  };

  return {
    result: {
      stage: 'EXECUTE',
      status: 'pass',
      decision: 'ALLOW',
      reason: execution.reason,
      metadata: { policyMatched: execution.policyMatched },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    execution,
  };
}
