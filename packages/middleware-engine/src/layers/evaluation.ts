/**
 * Evaluation Layer (Layer 4)
 * Delegates compliance evaluation to the Gate530 engine
 * @module layers/evaluation
 */

import {
  type EvaluationLayerConfig,
  type ComplianceDecision,
  type EvaluationContext,
  type AiRequest,
} from '../config.js';

export class EvaluationLayer {
  private readonly config: EvaluationLayerConfig;
  private readonly evaluationLog: ComplianceDecision[] = [];
  private readonly maxLogSize = 10000;

  constructor(config: EvaluationLayerConfig) {
    this.config = config;
  }

  /**
   * Evaluate a single context through the Gate530 engine
   */
  async evaluate(context: EvaluationContext): Promise<ComplianceDecision> {
    try {
      // In production, this would call the @ios-plus/gate-530 package
      const decision = await this.callGate530(context);
      this.logEvaluation(decision);
      return decision;
    } catch (err) {
      return {
        status: 'DENY',
        reason: `Gate530 evaluation failed: ${(err as Error).message}`,
        confidence: 0,
        evaluatedAt: new Date().toISOString(),
        metadata: { error: true, layer: 'evaluation' },
      };
    }
  }

  /**
   * Evaluate a batch of contexts
   */
  async evaluateBatch(contexts: EvaluationContext[]): Promise<ComplianceDecision[]> {
    const results: ComplianceDecision[] = [];
    for (let i = 0; i < contexts.length; i += this.config.batchSize) {
      const chunk = contexts.slice(i, i + this.config.batchSize);
      const chunkResults = await Promise.all(chunk.map((ctx) => this.evaluate(ctx)));
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Transform an AiRequest into an EvaluationContext
   */
  buildEvaluationContext(
    request: AiRequest,
    actor: { id: string; type: string; permissions: string[]; tenantId?: string },
    classification: { sector: string; sensitivity: string; intent: string; confidence: number },
    policies: { id: string; effect: string; condition: Record<string, unknown> }[]
  ): EvaluationContext {
    return {
      request,
      actor: {
        id: actor.id,
        type: actor.type as 'user' | 'service' | 'admin',
        permissions: actor.permissions,
        tenantId: actor.tenantId,
      },
      classification: {
        intent: classification.intent,
        sector: classification.sector,
        sensitivity: classification.sensitivity as 'low' | 'medium' | 'high' | 'critical',
        piiDetected: { hasPII: false, fields: [], confidence: 0, types: [] },
        confidence: classification.confidence,
      },
      policies: policies.map((p) => ({
        id: p.id,
        name: p.id,
        sector: classification.sector,
        action: request.content?.slice(0, 20) || 'unknown',
        condition: p.condition,
        effect: p.effect as 'allow' | 'deny',
        priority: 0,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      metadata: { timestamp: new Date().toISOString() },
    };
  }

  /**
   * Log evaluation metrics
   */
  logEvaluation(decision: ComplianceDecision): void {
    this.evaluationLog.push(decision);
    if (this.evaluationLog.length > this.maxLogSize) {
      this.evaluationLog.shift();
    }
  }

  /**
   * Get recent evaluation log entries
   */
  getEvaluationLog(limit = 100): ComplianceDecision[] {
    return this.evaluationLog.slice(-limit);
  }

  private async callGate530(context: EvaluationContext): Promise<ComplianceDecision> {
    // Simulate Gate530 integration — in production this would import from @ios-plus/gate-530
    const denyPolicies = context.policies.filter((p) => p.effect === 'deny');
    if (denyPolicies.length > 0) {
      return {
        status: 'DENY',
        reason: `Policy ${denyPolicies[0].id} denies this request`,
        policyId: denyPolicies[0].id,
        confidence: 1.0,
        evaluatedAt: new Date().toISOString(),
      };
    }

    const allowPolicies = context.policies.filter((p) => p.effect === 'allow');
    if (allowPolicies.length > 0) {
      return {
        status: 'ALLOW',
        reason: `Policy ${allowPolicies[0].id} allows this request`,
        policyId: allowPolicies[0].id,
        confidence: 0.95,
        evaluatedAt: new Date().toISOString(),
      };
    }

    return {
      status: 'REVIEW',
      reason: 'No explicit policy matched; requires human review',
      confidence: 0.5,
      evaluatedAt: new Date().toISOString(),
    };
  }
}
