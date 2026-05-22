/**
 * IOS+ 7-Layer Orchestration Pipeline
 * Threads ExecutionContext through L1→L2→L3→L4→L5→L6→L7.
 * Per-layer timeout enforcement per EB Doc 1 §2.1.
 */
import { v7 as uuidv7 } from "uuid";
import type {
  InferenceRequest, InferenceResponse, ExecutionContext, NAICSProfile
} from "@ios-plus/shared";
import { DEFAULT_LAYER_TIMEOUTS } from "@ios-plus/shared";
import { runL1 } from "../layers/L1_ingestion.js";
import { runL2 } from "../layers/L2_semantic.js";
import { runL3 } from "../layers/L3_ontology.js";
import { runL4 } from "../layers/L4_evidence.js";
import { runL5 } from "../layers/L5_gate530.js";
import { runL6 } from "../layers/L6_rag.js";
import { runL7 } from "../layers/L7_synthesis.js";
import type { UCOResolver } from "@ios-plus/uco-resolver";
import type { EvidenceFabricService } from "@ios-plus/evidence-fabric";
import type { RAGVaultService } from "@ios-plus/rag-vault";
import crypto from "node:crypto";

export interface PipelineDependencies {
  ucoResolver: UCOResolver;
  evidenceFabric: EvidenceFabricService;
  ragVault: RAGVaultService;
  signingKeyBytes: Uint8Array;
}

export async function executePipeline(
  request: InferenceRequest,
  naicsProfile: NAICSProfile,
  deps: PipelineDependencies
): Promise<InferenceResponse> {
  const pipelineStart = Date.now();
  const latencies: Record<string, number> = {};

  const l1 = await runL1(request);
  latencies["L1"] = l1.latencyMs;
  if (!l1.success) throw new Error(l1.error);

  const l2 = await runL2(l1.normalizedInput);
  latencies["L2"] = l2.latencyMs;

  const l3 = await runL3(naicsProfile, deps.ucoResolver);
  latencies["L3"] = l3.latencyMs;

  const ctx: ExecutionContext = {
    requestId: request.requestId,
    tenantId: request.tenantId,
    sessionId: request.sessionId,
    traceId: uuidv7(),
    classificationLevel: "CONFIDENTIAL",
    ucoContext: l3.ucoContext,
    startedAt: new Date().toISOString(),
    timeouts: DEFAULT_LAYER_TIMEOUTS,
  };

  const requestHash = crypto.createHash("sha256").update(l1.normalizedInput).digest("hex");
  const l4 = await runL4(ctx, deps.evidenceFabric, deps.signingKeyBytes, requestHash);
  latencies["L4"] = l4.latencyMs;

  const l5 = await runL5(ctx, l2.output.detectedActivity);
  latencies["L5"] = l5.latencyMs;

  if (l5.gateResult.aggregatePolicyAction === "BLOCK") {
    return runL7(ctx, l5.gateResult, { chunks: [], sectorPartitionsQueried: [], ucoNodeIdsFiltered: [], latencyMs: 0, efSearchUsed: 0 }, Date.now() - pipelineStart, latencies);
  }

  const l6 = await runL6(ctx, l1.normalizedInput, deps.ragVault);
  latencies["L6"] = l6.latencyMs;

  return runL7(ctx, l5.gateResult, l6.ragResult, Date.now() - pipelineStart, latencies);
}
