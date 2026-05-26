/**
 * L4 — Evidence Anchoring
 * Timeout budget: 20ms
 * Creates and WORM-commits evidence package for this request's ingestion record.
 * Signing overhead < 12ms (Ed25519 over JCS/RFC8785).
 */
import type { LayerResult, EvidencePackage, ExecutionContext } from "@ios-plus/shared";
import type { EvidenceFabricService } from "@ios-plus/evidence-fabric";
export async function runL4(
  ctx: ExecutionContext,
  fabric: EvidenceFabricService,
  requestHash: string
): Promise<LayerResult & { evidencePackage: EvidencePackage }> {
  const start = Date.now();
  const pkg = await fabric.createAndCommit({
    tenantId: ctx.tenantId, sessionId: ctx.sessionId, timestamp: new Date().toISOString(),
    eventType: "INFERENCE_REQUEST", layerDepth: 4, requestHash, responseHash: "",
    ucoNodeIds: ctx.ucoContext.resolvedNodeIds, policyAction: "APPROVE",
    classificationLevel: ctx.classificationLevel, metadata: {},
  });
  return { layer: 4, success: true, latencyMs: Date.now() - start, evidencePackage: pkg };
}
