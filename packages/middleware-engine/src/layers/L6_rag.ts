/**
 * L6 — Contextual Assembly (RAG Vault)
 * Timeout budget: 120ms
 * Retrieves UCO-partitioned knowledge chunks relevant to the request.
 * Sector partitions selected from UCO context resolved at L3.
 */
import type { LayerResult, ExecutionContext } from "@ios-plus/shared";
import type { RAGVaultService, RAGRetrievalResult } from "@ios-plus/rag-vault";
export async function runL6(
  ctx: ExecutionContext, query: string, vault: RAGVaultService
): Promise<LayerResult & { ragResult: RAGRetrievalResult }> {
  const start = Date.now();
  const ragResult = await vault.retrieve({ query, ucoContext: ctx.ucoContext });
  return { layer: 6, success: true, latencyMs: Date.now() - start, ragResult };
}
