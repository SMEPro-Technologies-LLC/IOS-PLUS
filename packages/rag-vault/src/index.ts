/**
 * RAG Vault — UCO-partitioned knowledge retrieval pipeline
 *
 * Architecture (EB Doc 5):
 *   - 20 sector partitions (rag_chunks PARTITION BY LIST(sector_code))
 *   - HNSW indexes via pgvector: ef_search varies by risk tier
 *     CRITICAL=128, HIGH=64, MEDIUM=40, LOW=20
 *   - UCO-aware retrieval: query routed to sector partitions matching UCO context
 *   - P99 target: < 40ms (UCO-native architecture) / < 120ms (cold path)
 *   - Embedding model: text-embedding-3-large (3072 dimensions)
 *
 * SMEPro Technologies — Confidential
 */

import OpenAI from 'openai';
import type { UCOContext, UCONodeSummary, RiskTier, SectorCode } from '@ios-plus/shared';
import { HNSW_EF_SEARCH } from '@ios-plus/shared';
import type { CosConnectionRegistry } from '@ios-plus/cos-plus';

export interface RAGVaultConfig {
  openaiApiKey: string;
  embeddingModel: string;       // default: text-embedding-3-large
  embeddingDimensions: number;  // default: 3072
  maxChunksPerQuery: number;    // default: 12
  similarityThreshold: number;  // default: 0.72
}

export interface RAGChunk {
  chunkId: string;
  sourceId: string;
  sectorCode: SectorCode;
  ucoNodeId: string | null;
  chunkText: string;
  embedding: number[];
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface RAGRetrievalRequest {
  query: string;
  ucoContext: UCOContext;
  maxChunks?: number;
}

export interface RAGRetrievalResult {
  chunks: RAGChunk[];
  sectorPartitionsQueried: SectorCode[];
  ucoNodeIdsFiltered: string[];
  latencyMs: number;
  efSearchUsed: number;
}

/** Derive sector codes from UCO node IDs for partition routing */
function extractSectorCodes(nodes: UCONodeSummary[]): SectorCode[] {
  const sectorMap: Record<string, SectorCode> = {
    'UCO-ENERGY': '01-ENERGY',
    'UCO-HEALTH': '02-HEALTHCARE',
    'UCO-FINANCE': '03-FINANCE',
    'UCO-FOOD': '04-FOOD-DRUG-AG',
    'UCO-MFG': '05-MFG-TRANSPORT',
    'UCO-TELECOM': '06-TELECOM-ENV-DEFENSE',
    'UCO-INS': '07-INSURANCE',
    'UCO-RE': '08-REAL-ESTATE',
    'UCO-AG': '09-AGRICULTURE',
    'UCO-MINING': '10-MINING',
    'UCO-RETAIL': '11-WHOLESALE-RETAIL',
    'UCO-PROF': '12-PROFESSIONAL-SERVICES',
    'UCO-EDU': '13-EDUCATION',
    'UCO-ARTS': '14-ARTS-ENTERTAINMENT',
    'UCO-ACCOM': '15-ACCOMMODATION-FOOD',
    'UCO-ADMIN': '16-ADMIN-WASTE',
    'UCO-OTHER': '17-OTHER-SERVICES',
    'UCO-PUB': '18-PUBLIC-ADMIN',
    'UCO-MGMT': '19-MGMT-COMPANIES',
    'UCO-XSC': 'XSC-CROSS-CUTTING',
  };
  const codes = new Set<SectorCode>();
  for (const node of nodes) {
    for (const [prefix, code] of Object.entries(sectorMap)) {
      if (node.ucoNodeId.startsWith(prefix)) { codes.add(code); break; }
    }
  }
  return [...codes];
}

/** Determine ef_search from highest risk tier across relevant nodes */
function deriveEfSearch(nodes: UCONodeSummary[]): number {
  const tierOrder: RiskTier[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  for (const tier of tierOrder) {
    if (nodes.some(n => n.riskTier === tier)) return HNSW_EF_SEARCH[tier];
  }
  return HNSW_EF_SEARCH['MEDIUM'];
}

export class RAGVaultService {
  private openai: OpenAI;
  private config: RAGVaultConfig;
  private registry: CosConnectionRegistry;

  constructor(config: RAGVaultConfig, registry: CosConnectionRegistry) {
    this.config = config;
    this.registry = registry;
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async retrieve(request: RAGRetrievalRequest): Promise<RAGRetrievalResult> {
    const startMs = Date.now();
    const allNodes = [...request.ucoContext.nodes, ...request.ucoContext.crossCuttingNodes];
    const sectorCodes = extractSectorCodes(allNodes);
    const efSearch = deriveEfSearch(allNodes);
    const ucoNodeIds = allNodes.map(n => n.ucoNodeId);
    const maxChunks = request.maxChunks ?? this.config.maxChunksPerQuery;

    // Embed query
    const embeddingResp = await this.openai.embeddings.create({
      model: this.config.embeddingModel,
      input: request.query,
      dimensions: this.config.embeddingDimensions,
    });
    const queryEmbedding = embeddingResp.data[0]!.embedding;

    const pool = this.registry.pool('rag_reader');

    // Set ef_search for this session (HNSW tuning)
    await pool.query(`SET hnsw.ef_search = $1`, [efSearch]);

    // UCO-partitioned cosine similarity search
    const sectorPlaceholders = sectorCodes.map((_, i) => `$${i + 3}`).join(',');
    const { rows } = await pool.query<{
      chunk_id: string; source_id: string; sector_code: string;
      uco_node_id: string | null; chunk_text: string; metadata: unknown;
      similarity: number;
    }>(
      `SELECT chunk_id, source_id, sector_code, uco_node_id, chunk_text, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM rag_chunks
       WHERE sector_code IN (${sectorPlaceholders})
         AND 1 - (embedding <=> $1::vector) > $2
       ORDER BY embedding <=> $1::vector
       LIMIT ${maxChunks}`,
      [`[${queryEmbedding.join(',')}]`, this.config.similarityThreshold, ...sectorCodes]
    );

    const chunks: RAGChunk[] = rows.map(r => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      sectorCode: r.sector_code as SectorCode,
      ucoNodeId: r.uco_node_id,
      chunkText: r.chunk_text,
      embedding: [], // not returned for bandwidth
      similarity: r.similarity,
      metadata: r.metadata as Record<string, unknown>,
    }));

    return {
      chunks,
      sectorPartitionsQueried: sectorCodes,
      ucoNodeIdsFiltered: ucoNodeIds,
      latencyMs: Date.now() - startMs,
      efSearchUsed: efSearch,
    };
  }
}

export type { RAGChunk, RAGRetrievalRequest, RAGRetrievalResult };
