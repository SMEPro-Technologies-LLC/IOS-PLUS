/**
 * Core Middleware Orchestrator
 * Coordinates all 7 layers sequentially with fail-closed semantics
 * @module orchestrator
 */

import {
  type OrchestratorConfig,
  type OrchestratorResult,
  type AiRequest,
  type ComplianceDecision,
  type Actor,
} from './config.js';
import { AuthLayer } from './layers/auth.js';
import { ClassificationLayer } from './layers/classification.js';
import { PolicyLayer } from './layers/policy.js';
import { EvaluationLayer } from './layers/evaluation.js';
import { EvidenceLayer } from './layers/evidence.js';
import { RetrievalLayer } from './layers/retrieval.js';
import { AuditLayer } from './layers/audit.js';

export class MiddlewareOrchestrator {
  readonly auth: AuthLayer;
  readonly classification: ClassificationLayer;
  readonly policy: PolicyLayer;
  readonly evaluation: EvaluationLayer;
  readonly evidence: EvidenceLayer;
  readonly retrieval: RetrievalLayer;
  readonly audit: AuditLayer;
  readonly config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.auth = new AuthLayer(config.auth);
    this.classification = new ClassificationLayer(config.classification);
    this.policy = new PolicyLayer(config.policy);
    this.evaluation = new EvaluationLayer(config.evaluation);
    this.evidence = new EvidenceLayer(config.evidence);
    this.retrieval = new RetrievalLayer(config.retrieval);
    this.audit = new AuditLayer(config.audit);
  }

  /**
   * Main processing pipeline through all 7 layers
   */
  async process(request: AiRequest): Promise<OrchestratorResult> {
    const startTime = Date.now();
    let auditEventId = '';
    const metadata: Record<string, unknown> = {
      requestId: request.id,
      startedAt: new Date().toISOString(),
    };

    try {
      // Layer 1: Auth
      const authResult = await this.auth.authenticate(request);
      if (!authResult.authenticated) {
        auditEventId = await this.audit.recordEvent({
          actorId: authResult.actor.id,
          action: 'auth.failure',
          resource: request.id,
          result: 'DENY',
          metadata: { reason: 'Authentication failed', layer: 1 },
          requestId: request.id,
        });
        return this.buildDenyResult('Authentication failed', metadata, auditEventId, authResult.actor);
      }

      const actor = authResult.actor;
      metadata.actorId = actor.id;
      metadata.authMethod = authResult.method;

      // Layer 2: Classification
      const classification = this.classification.classify(request);
      metadata.sector = classification.sector;
      metadata.sensitivity = classification.sensitivity;
      metadata.classificationConfidence = classification.confidence;

      if (classification.sensitivity === 'critical' && this.config.failClosed) {
        auditEventId = await this.audit.recordEvent({
          actorId: actor.id,
          action: 'classification.critical',
          resource: request.id,
          result: 'DENY',
          metadata: { reason: 'Critical sensitivity classification', layer: 2 },
          requestId: request.id,
        });
        return this.buildDenyResult('Critical sensitivity classification', metadata, auditEventId, actor);
      }

      // Layer 3: Policy
      const policies = this.policy.loadPolicies({
        actor,
        sector: classification.sector,
        action: classification.intent,
      });
      metadata.policyCount = policies.length;

      const explicitDeny = policies.find((p) => p.effect === 'deny');
      if (explicitDeny) {
        auditEventId = await this.audit.recordEvent({
          actorId: actor.id,
          action: 'policy.deny',
          resource: request.id,
          result: 'DENY',
          metadata: { policyId: explicitDeny.id, layer: 3 },
          requestId: request.id,
        });
        return this.buildDenyResult(
          `Policy ${explicitDeny.id} denies this request`,
          metadata,
          auditEventId,
          actor
        );
      }

      // Layer 4: Evaluation
      const evalContext = this.evaluation.buildEvaluationContext(
        request,
        actor,
        classification,
        policies
      );
      const decision = await this.evaluation.evaluate(evalContext);
      metadata.decisionStatus = decision.status;
      metadata.decisionConfidence = decision.confidence;

      if (decision.status === 'DENY') {
        auditEventId = await this.audit.recordEvent({
          actorId: actor.id,
          action: 'evaluation.deny',
          resource: request.id,
          result: 'DENY',
          metadata: { reason: decision.reason, policyId: decision.policyId, layer: 4 },
          requestId: request.id,
        });
      }

      // Layer 5: Evidence
      const evidence = await this.evidence.createEvidence(decision, evalContext);
      metadata.evidenceId = evidence.id;

      let retrievalResult: import('./config.js').RetrievalResult | undefined;
      // Layer 6: Retrieval (only if ALLOW)
      if (decision.status === 'ALLOW') {
        const query = this.retrieval.buildRetrievalQuery(request);
        const rawResults = await this.retrieval.retrieve(query);
        retrievalResult = this.retrieval.filterByCompliance(rawResults, decision);
        metadata.retrievalCount = retrievalResult.documents.length;
      }

      // Layer 7: Audit
      auditEventId = await this.audit.recordEvent({
        actorId: actor.id,
        action: 'request.processed',
        resource: request.id,
        result: decision.status,
        metadata: {
          layers: 7,
          durationMs: Date.now() - startTime,
          classification: classification.sector,
          sensitivity: classification.sensitivity,
          policyCount: policies.length,
        },
        requestId: request.id,
      });

      return {
        decision,
        evidence,
        retrievalResult,
        auditEventId,
        metadata: {
          ...metadata,
          durationMs: Date.now() - startTime,
          completedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const error = err as Error;
      metadata.error = error.message;
      metadata.stack = error.stack;

      const actorId = (metadata.actorId as string) || 'unknown';
      auditEventId = await this.audit.recordEvent({
        actorId,
        action: 'orchestrator.error',
        resource: request.id,
        result: 'ERROR',
        metadata: { error: error.message, layer: 'orchestrator' },
        requestId: request.id,
      });

      if (this.config.failClosed) {
        return this.buildDenyResult(
          `Orchestrator error: ${error.message}`,
          metadata,
          auditEventId,
          { id: actorId, type: 'user', permissions: [] }
        );
      }
      throw err;
    }
  }

  private buildDenyResult(
    reason: string,
    metadata: Record<string, unknown>,
    auditEventId: string,
    actor: Actor
  ): OrchestratorResult {
    const decision: ComplianceDecision = {
      status: 'DENY',
      reason,
      confidence: 1.0,
      evaluatedAt: new Date().toISOString(),
      metadata: { shortCircuit: true },
    };
    const evidence = {
      id: `ev-deny-${Date.now()}`,
      requestId: metadata.requestId as string,
      decision,
      actorId: actor.id,
      timestamp: new Date().toISOString(),
      signature: 'deny',
      context: { shortCircuit: true },
      hash: 'deny',
    };
    return {
      decision,
      evidence,
      auditEventId,
      metadata: {
        ...metadata,
        shortCircuit: true,
      },
    };
  }
}
