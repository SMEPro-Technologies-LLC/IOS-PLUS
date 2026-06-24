/**
 * Stage 8: REDACT
 * Applies field-level redaction for FERPA and privacy-protected fields.
 */

import type { GateRequest, StageResult, GateDecision, RedactionResult, ClassificationResult } from '../types.js';
import type { AuthenticatedActor } from './authenticate.js';

// Fields that must be redacted for non-authorized access to FERPA records
const FERPA_REDACT_FIELDS = ['gpa', 'grades', 'grade_points', 'academic_standing', 'disciplinary_records'];
// Fields that must always be redacted unless admin
const ALWAYS_REDACT_FOR_NON_ADMIN = ['ssn', 'date_of_birth', 'financial_aid'];

export function redactStage(
  request: GateRequest,
  actor: AuthenticatedActor,
  classification: ClassificationResult,
  currentDecision: GateDecision
): { result: StageResult; redaction?: RedactionResult } {
  const start = Date.now();

  // Only apply redaction on ALLOW or REDACT decisions
  if (currentDecision === 'DENY') {
    const redaction: RedactionResult = {
      applied: false,
      redactedFields: [],
      reason: 'Redaction skipped: request denied',
    };
    return {
      result: {
        stage: 'REDACT',
        status: 'skip',
        reason: 'Redaction skipped on deny decision',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      redaction,
    };
  }

  const redactedFields: string[] = [];
  const isAdmin = actor.roles.includes('admin') || actor.roles.includes('system');

  // Always redact sensitive fields for non-admin
  if (!isAdmin) {
    redactedFields.push(...ALWAYS_REDACT_FOR_NON_ADMIN);
  }

  // Apply FERPA redaction for non-admin, non-self-access
  if (classification.ferpaProtected) {
    const isSelfAccess = actor.id === request.resource.id || request.resource.id === request.actorId;
    const hasFerpaPermission =
      actor.roles.includes('admin') ||
      actor.roles.includes('advisor') ||
      actor.roles.includes('faculty');

    if (!isSelfAccess && !hasFerpaPermission) {
      redactedFields.push(...FERPA_REDACT_FIELDS);
    }
  }

  const uniqueRedacted = [...new Set(redactedFields)];

  if (uniqueRedacted.length === 0) {
    const redaction: RedactionResult = {
      applied: false,
      redactedFields: [],
      reason: 'No redaction required',
    };
    return {
      result: {
        stage: 'REDACT',
        status: 'pass',
        reason: 'No redaction required',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      redaction,
    };
  }

  const redaction: RedactionResult = {
    applied: true,
    redactedFields: uniqueRedacted,
    reason: `Redacted ${uniqueRedacted.length} field(s): ${uniqueRedacted.join(', ')}`,
  };

  return {
    result: {
      stage: 'REDACT',
      status: 'pass',
      reason: redaction.reason,
      metadata: { redactedFields: uniqueRedacted },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    redaction,
  };
}

export type { RedactionResult } from '../types.js';
