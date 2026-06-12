/**
 * L1 — Raw Ingestion
 * Timeout budget: 10ms
 * Validates request, extracts tenant identity, routes to transport normalizer.
 */
import type { InferenceRequest, LayerResult } from "@ios-plus/shared";

const MAX_RAW_INPUT_CHARS = +(process.env["MAX_RAW_INPUT_CHARS"] ?? "1000000");

export async function runL1(request: InferenceRequest): Promise<LayerResult & { normalizedInput: string }> {
  const start = Date.now();
  if (!request.tenantId || !request.rawInput) {
    return { layer: 1, success: false, latencyMs: Date.now() - start, error: 'Missing tenantId or rawInput', normalizedInput: '' };
  }
  // Enforce max input length BEFORE CPU-bound NFKC normalization to prevent resource exhaustion
  if (request.rawInput.length > MAX_RAW_INPUT_CHARS) {
    return {
      layer: 1,
      success: false,
      latencyMs: Date.now() - start,
      error: `rawInput exceeds maximum allowed length of ${MAX_RAW_INPUT_CHARS} characters`,
      normalizedInput: '',
    };
  }
  // Normalize encoding, strip BOM, validate content-type
  const normalizedInput = request.rawInput.trim().normalize("NFKC");
  return { layer: 1, success: true, latencyMs: Date.now() - start, normalizedInput };
}
