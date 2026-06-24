/**
 * Stage 9: RESPOND
 * Assembles the final structured response payload.
 */

import type { GateRequest, StageResult, GateDecision } from '../types.js';
import type { RedactionResult } from './redact.js';

export interface RespondResult {
  decision: GateDecision;
  reason: string;
  redactedFields: string[];
  summary: string;
}

export function respondStage(
  request: GateRequest,
  decision: GateDecision,
  reason: string,
  redaction: RedactionResult,
  stages: StageResult[]
): { result: StageResult; respond?: RespondResult } {
  const start = Date.now();

  const redactedFields = redaction.applied ? redaction.redactedFields : [];

  const summary = buildSummary(request, decision, stages, redactedFields);

  const respond: RespondResult = {
    decision,
    reason,
    redactedFields,
    summary,
  };

  return {
    result: {
      stage: 'RESPOND',
      status: 'pass',
      decision,
      reason,
      metadata: {
        redactedFields,
        stagesCompleted: stages.length,
        summary,
      },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    respond,
  };
}

function buildSummary(
  request: GateRequest,
  decision: GateDecision,
  stages: StageResult[],
  redactedFields: string[]
): string {
  const parts = [
    `Decision: ${decision}`,
    `Actor: ${request.actorId}`,
    `Action: ${request.action}`,
    `Resource: ${request.resource.type}/${request.resource.id}`,
  ];

  if (redactedFields.length > 0) {
    parts.push(`Redacted: ${redactedFields.join(', ')}`);
  }

  const failedStages = stages.filter((s) => s.status === 'fail').map((s) => s.stage);
  if (failedStages.length > 0) {
    parts.push(`Failed stages: ${failedStages.join(', ')}`);
  }

  return parts.join(' | ');
}
