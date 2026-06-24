/**
 * Stage 4: AUTHORIZE
 * Checks whether the authenticated actor is authorized to perform the action
 * on the classified resource.
 */

import type { GateRequest, StageResult, AuthorizationResult, ClassificationResult } from '../types.js';
import type { AuthenticatedActor } from './authenticate.js';

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['read', 'write', 'delete', 'export', 'read_grades', 'access_transcript', 'view_enrollment', 'export_student_data'],
  faculty: ['read', 'read_grades', 'access_transcript', 'view_enrollment'],
  student: ['read', 'view_enrollment'],
  advisor: ['read', 'read_grades', 'access_transcript', 'view_enrollment'],
  anonymous: ['read'],
  system: ['read', 'write', 'delete', 'export', 'read_grades', 'access_transcript', 'view_enrollment', 'export_student_data'],
};

const SENSITIVITY_REQUIRED_PERMISSIONS: Record<ClassificationResult['sensitivity'], string[]> = {
  public: [],
  internal: ['read'],
  confidential: ['read_grades'],
  restricted: ['access_transcript'],
};

export function authorizeStage(
  request: GateRequest,
  actor: AuthenticatedActor,
  classification: ClassificationResult
): { result: StageResult; authorization?: AuthorizationResult } {
  const start = Date.now();

  const grantedPermissions: string[] = [];
  for (const role of actor.roles) {
    const rolePerms = ROLE_PERMISSIONS[role] ?? [];
    for (const perm of rolePerms) {
      if (!grantedPermissions.includes(perm)) {
        grantedPermissions.push(perm);
      }
    }
  }

  const requiredPermissions = SENSITIVITY_REQUIRED_PERMISSIONS[classification.sensitivity];

  // Check if actor owns the resource (for student self-access)
  const isSelfAccess = actor.id === request.resource.id || request.resource.id === request.actorId;

  // Students can access their own records even if restricted
  if (isSelfAccess && actor.roles.includes('student') && classification.ferpaProtected) {
    const authorization: AuthorizationResult = {
      authorized: true,
      reason: 'FERPA self-access — student accessing own records',
      requiredPermissions,
      grantedPermissions,
    };
    return {
      result: {
        stage: 'AUTHORIZE',
        status: 'pass',
        reason: authorization.reason,
        metadata: { selfAccess: true, grantedPermissions },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      authorization,
    };
  }

  const missingPermissions = requiredPermissions.filter((p) => !grantedPermissions.includes(p));

  // Also check the specific action
  const hasActionPermission =
    grantedPermissions.includes(request.action) ||
    grantedPermissions.includes(request.action.toLowerCase()) ||
    requiredPermissions.length === 0;

  if (missingPermissions.length > 0 || !hasActionPermission) {
    const authorization: AuthorizationResult = {
      authorized: false,
      reason: missingPermissions.length > 0
        ? `Missing required permissions: ${missingPermissions.join(', ')}`
        : `Action '${request.action}' not permitted for roles: ${actor.roles.join(', ')}`,
      requiredPermissions,
      grantedPermissions,
    };
    return {
      result: {
        stage: 'AUTHORIZE',
        status: 'fail',
        decision: 'DENY',
        reason: authorization.reason,
        metadata: { missingPermissions, actorRoles: actor.roles },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      authorization,
    };
  }

  const authorization: AuthorizationResult = {
    authorized: true,
    reason: `All required permissions satisfied for roles: ${actor.roles.join(', ')}`,
    requiredPermissions,
    grantedPermissions,
  };

  return {
    result: {
      stage: 'AUTHORIZE',
      status: 'pass',
      reason: authorization.reason,
      metadata: { actorRoles: actor.roles, grantedPermissions },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    authorization,
  };
}

export type { AuthorizationResult } from '../types.js';
