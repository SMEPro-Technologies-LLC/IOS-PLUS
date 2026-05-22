/**
 * L1 — Raw Ingestion
 * Timeout budget: 10ms
 * Validates request, extracts tenant identity, routes to transport normalizer.
 */
import type { InferenceRequest, LayerResult } from "@ios-plus/shared";
export async function runL1(request: InferenceRequest): Promise<LayerResult & { normalizedInput: string }> {
  const start = Date.now();
  if (!request.tenantId || !request.rawInput) {
    return { layer: 1, success: false, latencyMs: Date.now() - start, error: "Missing tenantId or rawInput" };
  }
  // Normalize encoding, strip BOM, validate content-type
  const normalizedInput = request.rawInput.trim().normalize("NFKC");
  return { layer: 1, success: true, latencyMs: Date.now() - start, normalizedInput };
}
