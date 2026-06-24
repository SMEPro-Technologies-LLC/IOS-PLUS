/**
 * Gate Walker Pipeline Orchestrator
 * Coordinates all 10 stages sequentially with fail-closed semantics.
 *
 * Stages: AUTHENTICATE → INTERPRET → CLASSIFY → AUTHORIZE →
 *         ROUTE → EXECUTE → RECONCILE → REDACT → RESPOND → AUDIT
 */

import { randomUUID } from 'crypto';
import type {
  GateRequest,
  PipelineState,
  StageResult,
  GateDecision,
  GateExecuteResponse,
} from './types.js';
import type { Signer } from '@ios-plus/evidence-fabric';
import { authenticateStage, type AuthenticateOptions } from './stages/authenticate.js';
import { interpretStage } from './stages/interpret.js';
import { classifyStage } from './stages/classify.js';
import { authorizeStage } from './stages/authorize.js';
import { routeStage } from './stages/route.js';
import { executeStage } from './stages/execute.js';
import { reconcileStage, type ReconcileOptions, type BannerEthosAdapter, type BlackboardAdapter } from './stages/reconcile.js';
import { redactStage } from './stages/redact.js';
import { respondStage } from './stages/respond.js';
import { auditStage } from './stages/audit.js';
import type { GatePipelineStateStore } from './db/state-store.js';

export interface GateWalkerOptions {
  /** Ed25519 signer for sealed audit receipts */
  signer?: Signer;
  /** Mock Banner Ethos adapter */
  bannerEthos?: BannerEthosAdapter;
  /** Mock Blackboard adapter */
  blackboard?: BlackboardAdapter;
  /** Known API keys for Phase 1 mock auth */
  apiKeys?: Map<string, { id: string; roles: string[] }>;
  /** Whether to allow anonymous requests (Phase 1 testing) */
  allowAnonymous?: boolean;
  /** Optional state store for persisting intermediate state */
  stateStore?: GatePipelineStateStore;
}

export class GateWalkerPipeline {
  private readonly options: GateWalkerOptions;

  constructor(options: GateWalkerOptions = {}) {
    this.options = {
      allowAnonymous: true, // Phase 1 default
      ...options,
    };
  }

  /**
   * Execute the full 10-stage pipeline for a given request.
   * Returns the structured response with decision, stage history, and sealed audit receipt.
   */
  async execute(request: GateRequest): Promise<GateExecuteResponse> {
    const startTime = Date.now();

    // Ensure request has an ID
    if (!request.requestId) {
      request = { ...request, requestId: randomUUID() };
    }

    const stages: StageResult[] = [];
    let finalDecision: GateDecision = 'DENY';
    let finalReason = 'Pipeline incomplete';

    // ── Stage 1: AUTHENTICATE ─────────────────────────────────────────────
    const authOptions: AuthenticateOptions = {
      apiKeys: this.options.apiKeys,
      allowAnonymous: this.options.allowAnonymous,
    };
    const { result: authResult, actor } = authenticateStage(request, authOptions);
    stages.push(authResult);

    await this.persistState(request.requestId, 'AUTHENTICATE', stages, request);

    if (authResult.status === 'fail') {
      finalDecision = 'DENY';
      finalReason = authResult.reason ?? 'Authentication failed';
      return this.shortCircuit(request, stages, finalDecision, finalReason, startTime);
    }

    const authenticatedActor = actor!;

    // ── Stage 2: INTERPRET ────────────────────────────────────────────────
    const { result: interpretResult, interpreted } = interpretStage(request);
    stages.push(interpretResult);

    await this.persistState(request.requestId, 'INTERPRET', stages, request);

    if (interpretResult.status === 'fail') {
      finalDecision = 'DENY';
      finalReason = interpretResult.reason ?? 'Interpretation failed';
      return this.shortCircuit(request, stages, finalDecision, finalReason, startTime);
    }

    // ── Stage 3: CLASSIFY ─────────────────────────────────────────────────
    const { result: classifyResult, classification } = classifyStage(request, interpreted!);
    stages.push(classifyResult);

    await this.persistState(request.requestId, 'CLASSIFY', stages, request);

    // ── Stage 4: AUTHORIZE ────────────────────────────────────────────────
    const { result: authorizeResult, authorization } = authorizeStage(
      request,
      authenticatedActor,
      classification!
    );
    stages.push(authorizeResult);

    await this.persistState(request.requestId, 'AUTHORIZE', stages, request);

    // ── Stage 5: ROUTE ────────────────────────────────────────────────────
    const { result: routeResult, routing } = routeStage(classification!, authorization!);
    stages.push(routeResult);

    await this.persistState(request.requestId, 'ROUTE', stages, request);

    // ── Stage 6: EXECUTE ──────────────────────────────────────────────────
    const { result: executeResult, execution } = executeStage(
      request,
      routing!,
      classification!,
      authorization!
    );
    stages.push(executeResult);
    finalDecision = execution!.decision;
    finalReason = execution!.reason;

    await this.persistState(request.requestId, 'EXECUTE', stages, request, finalDecision);

    // ── Stage 7: RECONCILE ────────────────────────────────────────────────
    const reconcileOptions: ReconcileOptions = {
      bannerEthos: this.options.bannerEthos,
      blackboard: this.options.blackboard,
    };
    const { result: reconcileResult, reconciliation } = await reconcileStage(
      request,
      routing!,
      reconcileOptions
    );
    stages.push(reconcileResult);

    // If reconciliation shows FERPA hold on student, override to DENY
    if (
      routing!.path === 'ferpa' &&
      reconciliation?.bannerStatus === 'verified' &&
      (reconciliation.details?.bannerRecord as Record<string, unknown>)?.ferpaHold === true
    ) {
      const selfAccess = authenticatedActor.id === request.resource.id;
      if (!selfAccess) {
        finalDecision = 'DENY';
        finalReason = 'FERPA hold active — access denied per Banner Ethos verification';
      }
    }

    await this.persistState(request.requestId, 'RECONCILE', stages, request, finalDecision);

    // ── Stage 8: REDACT ───────────────────────────────────────────────────
    const { result: redactResult, redaction } = redactStage(
      request,
      authenticatedActor,
      classification!,
      finalDecision
    );
    stages.push(redactResult);

    await this.persistState(request.requestId, 'REDACT', stages, request, finalDecision);

    // ── Stage 9: RESPOND ──────────────────────────────────────────────────
    const { result: respondResult } = respondStage(
      request,
      finalDecision,
      finalReason,
      redaction!,
      stages
    );
    stages.push(respondResult);

    await this.persistState(request.requestId, 'RESPOND', stages, request, finalDecision);

    // ── Stage 10: AUDIT ───────────────────────────────────────────────────
    const { result: auditResult, receipt } = auditStage(
      request,
      finalDecision,
      finalReason,
      stages,
      { signer: this.options.signer }
    );
    stages.push(auditResult);

    await this.persistState(request.requestId, 'AUDIT', stages, request, finalDecision);

    return {
      requestId: request.requestId,
      decision: finalDecision,
      reason: finalReason,
      stages,
      auditReceipt: receipt!,
      redactedFields: redaction?.redactedFields ?? [],
      processingMs: Date.now() - startTime,
    };
  }

  /**
   * Short-circuit the pipeline when an early stage fails.
   * Still runs AUDIT to produce a sealed receipt.
   */
  private async shortCircuit(
    request: GateRequest,
    stages: StageResult[],
    decision: GateDecision,
    reason: string,
    startTime: number
  ): Promise<GateExecuteResponse> {
    // Fill remaining stages as skipped
    const executedStageNames = new Set(stages.map((s) => s.stage));
    const remainingStages = ['ROUTE', 'EXECUTE', 'RECONCILE', 'REDACT', 'RESPOND'] as const;

    for (const stageName of remainingStages) {
      if (!executedStageNames.has(stageName)) {
        stages.push({
          stage: stageName,
          status: 'skip',
          reason: 'Skipped due to earlier failure',
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Always emit audit receipt
    const { result: auditResult, receipt } = auditStage(
      request,
      decision,
      reason,
      stages,
      { signer: this.options.signer }
    );
    stages.push(auditResult);

    await this.persistState(request.requestId, 'AUDIT', stages, request, decision);

    return {
      requestId: request.requestId,
      decision,
      reason,
      stages,
      auditReceipt: receipt!,
      redactedFields: [],
      processingMs: Date.now() - startTime,
    };
  }

  /**
   * Persist intermediate pipeline state to the store (if configured).
   */
  private async persistState(
    requestId: string,
    currentStage: PipelineState['currentStage'],
    stages: StageResult[],
    request: GateRequest,
    finalDecision?: GateDecision
  ): Promise<void> {
    if (!this.options.stateStore) return;

    try {
      const state: PipelineState = {
        requestId,
        request,
        currentStage,
        stages,
        finalDecision,
        startedAt: stages[0]?.timestamp ?? new Date().toISOString(),
      };
      await this.options.stateStore.upsert(state);
    } catch (err) {
      // Don't fail pipeline on persistence error
      console.error('[GateWalkerPipeline] State persistence failed:', err instanceof Error ? err.message : String(err));
    }
  }
}
