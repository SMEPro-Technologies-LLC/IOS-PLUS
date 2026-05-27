import type { InferenceResponse, ExecutionContext, PolicyAction } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";
import type { RAGRetrievalResult } from "@ios-plus/rag-vault";
import OpenAI from "openai";

export async function runL7(
  ctx: ExecutionContext,
  gateResult: Gate530EvaluationResult,
  ragResult: RAGRetrievalResult,
  totalLatencyMs: number,
  layerLatencies: Record<string, number>
): Promise<InferenceResponse> {
  const blockedByGate = gateResult.aggregatePolicyAction === "BLOCK";
  
  if (blockedByGate) {
    const output = "[BLOCKED] This request was intercepted by Gate 530 compliance enforcement. " +
      `${gateResult.quarantinedNodeIds.length} UCO node(s) triggered enforcement.`;
    return {
      requestId: ctx.requestId, tenantId: ctx.tenantId, sessionId: ctx.sessionId,
      output, policyAction: "BLOCK",
      classificationLevel: ctx.classificationLevel,
      ucoNodesEvaluated: gateResult.nodeResults.length,
      ucoNodeResults: gateResult.nodeResults,
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs,
      layerLatencies,
    };
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey || ragResult.chunks.length === 0) {
    // Fallback if API key is missing or no context chunks retrieved
    const output = ragResult.chunks.map((c: any) => c.chunkText).join('\n\n');
    return {
      requestId: ctx.requestId, tenantId: ctx.tenantId, sessionId: ctx.sessionId,
      output, policyAction: "APPROVE",
      classificationLevel: ctx.classificationLevel,
      ucoNodesEvaluated: gateResult.nodeResults.length,
      ucoNodeResults: gateResult.nodeResults,
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs,
      layerLatencies,
    };
  }

  try {
    const openai = new OpenAI({ apiKey });
    const contextText = ragResult.chunks.map((c: any) => c.chunkText).join('\n\n');
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a compliance-aligned enterprise AI assistant. Synthesize a professional, concise response to the user's query based ONLY on the following compliance-cleared knowledge chunks. Do not add outside information:\n\n${contextText}`
        },
        {
          role: "user",
          content: ctx.request?.rawInput ?? ""
        }
      ]
    });

    return {
      requestId: ctx.requestId, tenantId: ctx.tenantId, sessionId: ctx.sessionId,
      output: completion.choices[0]?.message.content ?? "",
      policyAction: "APPROVE",
      classificationLevel: ctx.classificationLevel,
      ucoNodesEvaluated: gateResult.nodeResults.length,
      ucoNodeResults: gateResult.nodeResults,
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs,
      layerLatencies,
    };
  } catch (err) {
    // Fallback to joining text chunks on exception
    const output = ragResult.chunks.map((c: any) => c.chunkText).join('\n\n');
    return {
      requestId: ctx.requestId, tenantId: ctx.tenantId, sessionId: ctx.sessionId,
      output, policyAction: "APPROVE",
      classificationLevel: ctx.classificationLevel,
      ucoNodesEvaluated: gateResult.nodeResults.length,
      ucoNodeResults: gateResult.nodeResults,
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs,
      layerLatencies,
    };
  }
}

