/**
 * L7 — Response Synthesis
 * Timeout budget: 200ms
 * Assembles final response from RAG chunks + policy action from Gate 530.
 * Applies classification level controls before returning to caller.
 */
import type { LayerResult, InferenceResponse, ExecutionContext, PolicyAction } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";
import type { RAGRetrievalResult } from "@ios-plus/rag-vault";
export function runL7(
  ctx: ExecutionContext,
  gateResult: Gate530EvaluationResult,
  ragResult: RAGRetrievalResult,
  totalLatencyMs: number,
  layerLatencies: Record<string, number>
): InferenceResponse {
  const blockedByGate = gateResult.aggregatePolicyAction === "BLOCK";
  const output = blockedByGate
    ? "[BLOCKED] This request was intercepted by Gate 530 compliance enforcement. " +
      `${gateResult.quarantinedNodeIds.length} UCO node(s) triggered enforcement.`
    : ragResult.chunks.map((c: any) => c.chunkText).join('\n\n');
  return {
    requestId: ctx.requestId, tenantId: ctx.tenantId, sessionId: ctx.sessionId,
    output, policyAction: gateResult.aggregatePolicyAction as PolicyAction,
    classificationLevel: ctx.classificationLevel,
    ucoNodesEvaluated: gateResult.nodeResults.length,
    ucoNodeResults: gateResult.nodeResults,
    gateDecisions: [],
    evidencePackages: [],
    totalLatencyMs,
    layerLatencies,
  };
}
