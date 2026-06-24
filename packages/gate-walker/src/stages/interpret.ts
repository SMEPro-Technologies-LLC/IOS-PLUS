/**
 * Stage 2: INTERPRET
 * Parses the incoming request and derives normalized intent.
 */

import type { GateRequest, StageResult } from '../types.js';

export interface InterpretedRequest {
  intent: string;
  normalizedAction: string;
  normalizedResource: string;
  sector: string;
  isFerpaContext: boolean;
}

const FERPA_ACTIONS = new Set(['read_grades', 'access_transcript', 'view_enrollment', 'export_student_data']);
const FERPA_RESOURCE_TYPES = new Set(['grade', 'transcript', 'enrollment', 'student_record', 'ferpa_protected']);

export function interpretStage(request: GateRequest): {
  result: StageResult;
  interpreted?: InterpretedRequest;
} {
  const start = Date.now();

  if (!request.action || typeof request.action !== 'string') {
    return {
      result: {
        stage: 'INTERPRET',
        status: 'fail',
        decision: 'DENY',
        reason: 'Missing or invalid action in request',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (!request.resource?.type) {
    return {
      result: {
        stage: 'INTERPRET',
        status: 'fail',
        decision: 'DENY',
        reason: 'Missing resource type in request',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    };
  }

  const normalizedAction = request.action.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const normalizedResource = request.resource.type.toLowerCase().replace(/[^a-z0-9_]/g, '_');

  const isFerpaContext =
    request.resource.ferpaProtected === true ||
    FERPA_ACTIONS.has(normalizedAction) ||
    FERPA_RESOURCE_TYPES.has(normalizedResource);

  const intent = `${normalizedAction}:${normalizedResource}`;

  const interpreted: InterpretedRequest = {
    intent,
    normalizedAction,
    normalizedResource,
    sector: request.sector || 'general',
    isFerpaContext,
  };

  return {
    result: {
      stage: 'INTERPRET',
      status: 'pass',
      reason: `Intent resolved: ${intent}`,
      metadata: { intent, isFerpaContext, sector: interpreted.sector },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    interpreted,
  };
}
