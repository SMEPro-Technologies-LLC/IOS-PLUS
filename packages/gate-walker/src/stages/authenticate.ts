/**
 * Stage 1: AUTHENTICATE
 * Verifies the identity of the requesting actor via token validation.
 */

import type { GateRequest, StageResult } from '../types.js';

export interface AuthenticatedActor {
  id: string;
  roles: string[];
  tenantId?: string;
}

export interface AuthenticateOptions {
  /** Known API keys for Phase 1 mock auth — maps key → actor */
  apiKeys?: Map<string, AuthenticatedActor>;
  /** If true, allow requests with no token (anonymous) — Phase 1 only */
  allowAnonymous?: boolean;
}

export function authenticateStage(
  request: GateRequest,
  options: AuthenticateOptions = {}
): { result: StageResult; actor?: AuthenticatedActor } {
  const start = Date.now();

  if (!request.actorId) {
    return {
      result: {
        stage: 'AUTHENTICATE',
        status: 'fail',
        decision: 'DENY',
        reason: 'Missing actorId in request',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Phase 1: token-based mock auth
  if (request.token) {
    const actor = options.apiKeys?.get(request.token);
    if (actor) {
      return {
        result: {
          stage: 'AUTHENTICATE',
          status: 'pass',
          reason: 'API key authenticated',
          metadata: { actorId: actor.id, roles: actor.roles },
          durationMs: Date.now() - start,
          timestamp: new Date().toISOString(),
        },
        actor,
      };
    }
    // Token provided but not recognized
    return {
      result: {
        stage: 'AUTHENTICATE',
        status: 'fail',
        decision: 'DENY',
        reason: 'Invalid or expired token',
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (options.allowAnonymous) {
    const actor: AuthenticatedActor = {
      id: request.actorId,
      roles: ['anonymous'],
    };
    return {
      result: {
        stage: 'AUTHENTICATE',
        status: 'pass',
        reason: 'Anonymous access permitted (Phase 1)',
        metadata: { actorId: actor.id, roles: actor.roles },
        durationMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      },
      actor,
    };
  }

  return {
    result: {
      stage: 'AUTHENTICATE',
      status: 'fail',
      decision: 'DENY',
      reason: 'No authentication token provided',
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
  };
}
