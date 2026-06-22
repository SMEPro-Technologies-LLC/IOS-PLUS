/**
 * Retrieval Layer (Layer 6)
 * Delegates RAG retrieval, filters by compliance level, augments context
 * @module layers/retrieval
 */

import {
  type RetrievalLayerConfig,
  type RetrievalResult,
  type RetrievalQuery,
  type AiRequest,
  type ComplianceDecision,
  type SensitivityLevel,
  type RetrievalDocument,
} from '../config.js';

export class RetrievalLayer {
  private readonly config: RetrievalLayerConfig;
  private readonly documentStore: Map<string, RetrievalDocument[]> = new Map();

  constructor(config: RetrievalLayerConfig) {
    this.config = config;
  }

  /**
   * Delegate retrieval to RAG Vault
   */
  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    try {
      // In production: await @ios-plus/rag-vault client.retrieve(query)
      const docs = this.documentStore.get(query.partition) || [];
      const scored = docs
        .map((doc) => ({
          ...doc,
          score: this.scoreDocument(doc, query.text),
        }))
        .filter((doc) => doc.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, query.maxResults || this.config.maxResults);

      return {
        documents: scored,
        query: query.text,
        partition: query.partition,
        total: docs.length,
        filteredCount: scored.length,
        complianceLevel: query.complianceFilter || 'low',
      };
    } catch (err) {
      return {
        documents: [],
        query: query.text,
        partition: query.partition,
        total: 0,
        filteredCount: 0,
        complianceLevel: query.complianceFilter || 'low',
      };
    }
  }

  /**
   * Filter retrieval results by compliance decision level
   */
  filterByCompliance(results: RetrievalResult, decision: ComplianceDecision): RetrievalResult {
    if (!this.config.complianceFilterEnabled) return results;
    if (decision.status === 'DENY') {
      return {
        ...results,
        documents: [],
        filteredCount: 0,
      };
    }
    const allowedLevel = decision.status === 'REVIEW' ? 'medium' : 'low';
    const filtered = results.documents.filter((doc) => {
      const docLevel = (doc.metadata?.sensitivity as SensitivityLevel) || 'low';
      return this.compareSensitivity(docLevel, allowedLevel) <= 0;
    });
    return {
      ...results,
      documents: filtered,
      filteredCount: filtered.length,
    };
  }

  /**
   * Inject retrieval results into request context
   */
  augmentContext(request: AiRequest, results: RetrievalResult): AiRequest {
    return {
      ...request,
      context: {
        ...request.context,
        retrieval: {
          query: results.query,
          partition: results.partition,
          documentIds: results.documents.map((d) => d.id),
          documentCount: results.documents.length,
        },
      },
    };
  }

  /**
   * Build a RetrievalQuery from an AiRequest
   */
  buildRetrievalQuery(request: AiRequest): RetrievalQuery {
    return {
      text: request.content,
      filters: request.metadata || {},
      partition: this.config.defaultPartition,
      maxResults: this.config.maxResults,
    };
  }

  /**
   * Seed documents for a partition (for testing / in-memory fallback)
   */
  seedDocuments(partition: string, documents: RetrievalDocument[]): void {
    this.documentStore.set(partition, documents);
  }

  private scoreDocument(doc: RetrievalDocument, query: string): number {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentTerms = doc.content.toLowerCase().split(/\s+/);
    let matches = 0;
    for (const term of queryTerms) {
      if (contentTerms.some((ct) => ct.includes(term))) matches++;
    }
    return matches / queryTerms.length;
  }

  private compareSensitivity(a: SensitivityLevel, b: SensitivityLevel): number {
    const order: Record<SensitivityLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    return order[a] - order[b];
  }
}
