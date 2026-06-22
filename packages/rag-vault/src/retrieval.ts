import {
  RetrievalResult,
  RankedDocument,
  Document,
  SearchOptions,
  VectorSearchResult,
  HybridSearchResult,
} from './types.js';

export class VectorRetriever {
  private pool: unknown;
  private vectorTable: string;

  constructor(pool: unknown, vectorTable: string = 'rag_vault_vectors') {
    this.pool = pool;
    this.vectorTable = vectorTable;
  }

  async search(
    embedding: number[],
    options: SearchOptions = {}
  ): Promise<RetrievalResult> {
    const start = Date.now();
    const limit = options.limit ?? 50;
    const threshold = options.similarityThreshold ?? 0.75;

    // In production, this would execute a PostgreSQL/pgvector query:
    // SELECT id, embedding, metadata, 1 - (embedding <=> $1) as similarity
    // FROM <table>
    // WHERE 1 - (embedding <=> $1) > $2
    // ORDER BY similarity DESC LIMIT $3

    const placeholderResults = this.simulatedSearch(embedding, limit, threshold, options.filters);

    const documents: RankedDocument[] = placeholderResults.map((r, i) =>
      this.toRankedDocument(r, i + 1)
    );

    return {
      documents,
      totalCount: documents.length,
      partition: (options.filters?.partition as string) ?? 'general',
      queryTimeMs: Date.now() - start,
      metadata: {
        partitionFilter: !!options.filters?.partition,
        sectorFilter: !!options.filters?.sector,
        complianceFilter: !!options.filters?.complianceLevel,
        deduplicationApplied: false,
        rankingMethod: 'vector_similarity',
        embeddingProvider: 'configured',
      },
    };
  }

  async searchWithMetadata(
    filters: Record<string, unknown>,
    embedding: number[]
  ): Promise<RetrievalResult> {
    return this.search(embedding, { filters, includeMetadata: true });
  }

  async hybridSearch(
    query: string,
    embedding: number[],
    options: SearchOptions = {}
  ): Promise<RetrievalResult> {
    const start = Date.now();
    const limit = options.limit ?? 50;

    // Simulated vector search
    const vectorResults = this.simulatedSearch(embedding, limit, 0.5, options.filters);

    // Simulated text search (keyword overlap)
    const textResults = this.simulatedTextSearch(query, limit, options.filters);

    // Combine scores
    const combinedScores = new Map<string, number>();
    const allIds = new Set<string>();

    for (const r of vectorResults) {
      allIds.add(r.id);
      combinedScores.set(r.id, (1 - r.distance) * 0.6);
    }
    for (const r of textResults) {
      allIds.add(r.id);
      const existing = combinedScores.get(r.id) ?? 0;
      combinedScores.set(r.id, existing + (1 - r.distance) * 0.4);
    }

    const merged = Array.from(allIds)
      .map((id) => {
        const v = vectorResults.find((x) => x.id === id);
        const t = textResults.find((x) => x.id === id);
        const meta = { ...(v?.metadata ?? {}), ...(t?.metadata ?? {}) };
        return {
          id,
          embedding: v?.embedding ?? t?.embedding ?? [],
          metadata: meta,
          distance: 1 - (combinedScores.get(id) ?? 0),
        } as VectorSearchResult;
      })
      .sort((a, b) => a.distance - b.distance);

    const sliced = merged.slice(0, limit);

    const documents: RankedDocument[] = sliced.map((r, i) =>
      this.toRankedDocument(r, i + 1)
    );

    return {
      documents,
      totalCount: documents.length,
      partition: (options.filters?.partition as string) ?? 'general',
      queryTimeMs: Date.now() - start,
      metadata: {
        partitionFilter: !!options.filters?.partition,
        sectorFilter: !!options.filters?.sector,
        complianceFilter: !!options.filters?.complianceLevel,
        deduplicationApplied: false,
        rankingMethod: 'hybrid',
        embeddingProvider: 'configured',
      },
    };
  }

  private simulatedSearch(
    embedding: number[],
    limit: number,
    threshold: number,
    filters?: Record<string, unknown>
  ): VectorSearchResult[] {
    // Simulated results for testing without a real DB
    const results: VectorSearchResult[] = [];
    for (let i = 0; i < limit; i++) {
      const id = `doc-${filters?.partition ?? 'general'}-${i}`;
      const mockEmbedding = embedding.map((v) => v + (Math.random() - 0.5) * 0.1);
      results.push({
        id,
        embedding: mockEmbedding,
        metadata: { ...filters, index: i },
        distance: 0.1 + i * 0.02,
      });
    }
    return results.filter((r) => 1 - r.distance >= threshold);
  }

  private simulatedTextSearch(
    query: string,
    limit: number,
    filters?: Record<string, unknown>
  ): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];
    for (let i = 0; i < limit; i++) {
      const id = `doc-${filters?.partition ?? 'general'}-text-${i}`;
      results.push({
        id,
        embedding: [],
        metadata: { ...filters, index: i, queryTerms: query.split(' ') },
        distance: 0.15 + i * 0.03,
      });
    }
    return results;
  }

  private toRankedDocument(result: VectorSearchResult, rank: number): RankedDocument {
    const doc: Document = {
      id: result.id,
      content: (result.metadata?.content as string) ?? '',
      metadata: result.metadata,
      embedding: result.embedding,
      partitionId: (result.metadata?.partition as string) ?? 'general',
      sectorTags: ((result.metadata?.sectors as string) ?? 'general').split(','),
      complianceLevel: (result.metadata?.complianceLevel as Document['complianceLevel']) ?? 'public',
      createdAt: new Date((result.metadata?.createdAt as string) ?? Date.now()),
      updatedAt: new Date((result.metadata?.updatedAt as string) ?? Date.now()),
      evidenceId: (result.metadata?.evidenceId as string) ?? undefined,
    };

    return {
      document: doc,
      score: 1 - result.distance,
      rank,
      relevanceScore: 1 - result.distance,
      sectorScore: 0,
      complianceScore: 0,
    };
  }
}

export class RetrievalRanker {
  rank(results: RetrievalResult, query: RetrievalResult): RetrievalResult {
    // Re-rank by composite score
    const scored = results.documents.map((rd) => ({
      ...rd,
      score: this.score(rd, query),
    }));

    const sorted = scored.sort((a, b) => b.score - a.score);

    return {
      ...results,
      documents: sorted.map((rd, i) => ({ ...rd, rank: i + 1 })),
      metadata: {
        ...results.metadata,
        rankingMethod: 'composite_score',
      },
    };
  }

  score(result: RankedDocument, _query: RetrievalResult): number {
    const { relevanceScore, sectorScore, complianceScore } = result;
    return relevanceScore * 0.6 + sectorScore * 0.2 + complianceScore * 0.2;
  }
}

export class RetrievalDeduplicator {
  deduplicate(results: RetrievalResult): RetrievalResult {
    const seen = new Set<string>();
    const unique: RankedDocument[] = [];

    for (const rd of results.documents) {
      const key = this.canonicalKey(rd);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rd);
      }
    }

    return {
      ...results,
      documents: unique.map((rd, i) => ({ ...rd, rank: i + 1 })),
      totalCount: unique.length,
      metadata: {
        ...results.metadata,
        deduplicationApplied: true,
      },
    };
  }

  private canonicalKey(rd: RankedDocument): string {
    // Dedupe by sourceRef or content hash if available
    return (
      (rd.document.sourceRef ?? rd.document.id) +
      '|' +
      (rd.document.content.slice(0, 100) || '')
    );
  }
}

export class RetrievalLimiter {
  limit(results: RetrievalResult, maxResults: number): RetrievalResult {
    return {
      ...results,
      documents: results.documents.slice(0, maxResults).map((rd, i) => ({
        ...rd,
        rank: i + 1,
      })),
      totalCount: Math.min(results.totalCount, maxResults),
    };
  }

  limitByDepth(results: RetrievalResult, maxDepth: number): RetrievalResult {
    // Depth-based limiting: if documents have depth metadata, limit traversal
    const filtered = results.documents.filter((rd) => {
      const depth = (rd.document.metadata?.depth as number) ?? 0;
      return depth <= maxDepth;
    });

    return {
      ...results,
      documents: filtered.map((rd, i) => ({ ...rd, rank: i + 1 })),
      totalCount: filtered.length,
    };
  }
}
