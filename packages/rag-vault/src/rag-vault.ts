/**
 * Core RagVault class
 * Compliance-aware retrieval system with UCO-partitioned boundaries
 * and sector-aware knowledge segmentation.
 */

import {
  RagVaultConfig,
  RetrievalQuery,
  RetrievalResult,
  Document,
  Actor,
  ComplianceLevel,
  AuditEntry,
} from './types.js';
import type { UcoPartition } from './partition.js';
import { UcoPartitionManager } from './partition.js';
import { SectorKnowledgeMap, SectorAwareFilter } from './sector.js';
import {
  VectorRetriever,
  RetrievalRanker,
  RetrievalDeduplicator,
  RetrievalLimiter,
} from './retrieval.js';
import type {
  EmbeddingProvider,
  EmbeddingConfig,
} from './embedding.js';
import { MockEmbeddingProvider, OpenAIEmbeddingProvider } from './embedding.js';
import { validateConfig } from './config.js';

export class RagVault {
  private config: RagVaultConfig;
  private partitionManager: UcoPartitionManager;
  private sectorFilter: SectorAwareFilter;
  private vectorRetriever: VectorRetriever;
  private ranker: RetrievalRanker;
  private deduplicator: RetrievalDeduplicator;
  private limiter: RetrievalLimiter;
  private embeddingProvider: EmbeddingProvider;
  private auditLog: AuditEntry[] = [];
  private documents: Map<string, Document> = new Map();

  constructor(config: RagVaultConfig) {
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(
        `Invalid RagVaultConfig: ${validation.errors.join('; ')}`
      );
    }

    this.config = {
      ...config,
      maxResults: config.maxResults ?? 50,
      maxDepth: config.maxDepth ?? 3,
      complianceEnforcement: config.complianceEnforcement ?? 'strict',
      auditLogEnabled: config.auditLogEnabled ?? true,
    };

    this.partitionManager = new UcoPartitionManager(
      this.config.partitionStrategy
    );
    new SectorKnowledgeMap();
    this.sectorFilter = new SectorAwareFilter();
    this.vectorRetriever = new VectorRetriever(
      this.config.databasePool,
      this.config.vectorTable
    );
    this.ranker = new RetrievalRanker();
    this.deduplicator = new RetrievalDeduplicator();
    this.limiter = new RetrievalLimiter();
    this.embeddingProvider = this.createEmbeddingProvider(
      this.config.embeddingConfig
    );
  }

  private createEmbeddingProvider(
    embedConfig: EmbeddingConfig
  ): EmbeddingProvider {
    switch (embedConfig.provider) {
      case 'openai':
        return new OpenAIEmbeddingProvider(embedConfig);
      case 'mock':
      default:
        return new MockEmbeddingProvider(embedConfig);
    }
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const start = Date.now();

    // 1. Determine UCO partition from query
    const partition = this.partitionManager.getPartitionForQuery(query);

    // 2. Validate actor access if specified
    if (query.actorId) {
      // In production, lookup actor from identity store
      const actor: Actor = {
        id: query.actorId,
        roles: [],
        sectors: query.sector ? [query.sector] : ['general'],
        clearanceLevel: query.complianceLevel ?? 'public',
        partitionAccess: [partition.id],
      };

      if (!this.partitionManager.validateAccess(partition, actor)) {
        throw new Error(
          `Actor "${query.actorId}" does not have access to partition "${partition.id}"`
        );
      }
    }

    // 3. Generate embedding if not provided
    const embedding =
      query.embedding ?? (await this.embeddingProvider.embed(query.text));

    // 4. Perform vector similarity search within partition
    const searchResult = await this.vectorRetriever.search(embedding, {
      limit: ((query.maxResults ?? this.config.maxResults) ?? 50) * 2,
      similarityThreshold: this.config.similarityThreshold,
      filters: {
        partition: partition.id,
        sector: query.sector,
        complianceLevel: query.complianceLevel,
        ...query.filters,
      },
    });

    // 5. Filter by sector if specified
    let filtered = searchResult;
    if (query.sector) {
      filtered = this.sectorFilter.filter(searchResult, query.sector);
    }

    // 6. Filter by compliance level
    filtered = this.filterByCompliance(filtered, query.complianceLevel);

    // 7. Rank, dedupe, limit
    let ranked = this.ranker.rank(filtered, searchResult);
    ranked = this.deduplicator.deduplicate(ranked);
    ranked = this.limiter.limit(
      ranked,
      query.maxResults ?? this.config.maxResults ?? 50
    );
    if (query.maxDepth) {
      ranked = this.limiter.limitByDepth(ranked, query.maxDepth);
    }

    const result: RetrievalResult = {
      ...ranked,
      partition: partition.id,
      sector: query.sector,
      queryTimeMs: Date.now() - start,
    };

    // 8. Audit log
    if (this.config.auditLogEnabled) {
      this.auditLog.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: 'retrieve',
        actorId: query.actorId,
        partitionId: partition.id,
        timestamp: new Date(),
        success: true,
        details: { queryText: query.text, resultCount: result.totalCount },
      });
    }

    return result;
  }

  async retrieveWithEvidence(
    query: RetrievalQuery,
    evidenceId: string
  ): Promise<RetrievalResult> {
    return this.retrieve({
      ...query,
      evidenceId,
      filters: { ...query.filters, evidenceId },
    });
  }

  async addDocument(doc: Document, partitionId: string): Promise<void> {
    const partition = this.partitionManager.getPartition(partitionId);

    // Ensure document has embedding
    if (!doc.embedding || doc.embedding.length === 0) {
      doc.embedding = await this.embeddingProvider.embed(doc.content);
    }

    // Assign partition and compliance level
    const enrichedDoc: Document = {
      ...doc,
      partitionId: partition.id,
      complianceLevel: doc.complianceLevel ?? partition.complianceLevel,
      sectorTags:
        doc.sectorTags.length > 0 ? doc.sectorTags : partition.sectors,
      updatedAt: new Date(),
      createdAt: doc.createdAt ?? new Date(),
    };

    this.documents.set(enrichedDoc.id, enrichedDoc);

    // In production, this would also insert into the vector DB table
    // via this.vectorRetriever.index(enrichedDoc)

    if (this.config.auditLogEnabled) {
      this.auditLog.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: 'add',
        documentId: enrichedDoc.id,
        partitionId: partition.id,
        timestamp: new Date(),
        success: true,
        details: { contentLength: enrichedDoc.content.length },
      });
    }
  }

  async removeDocument(id: string, partitionId: string): Promise<void> {
    const doc = this.documents.get(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found in vault`);
    }

    if (doc.partitionId !== partitionId) {
      throw new Error(
        `Document "${id}" is in partition "${doc.partitionId}", not "${partitionId}"`
      );
    }

    this.documents.delete(id);

    // In production, also delete from vector DB

    if (this.config.auditLogEnabled) {
      this.auditLog.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: 'remove',
        documentId: id,
        partitionId,
        timestamp: new Date(),
        success: true,
      });
    }
  }

  async updatePartition(
    id: string,
    oldPartitionId: string,
    newPartitionId: string
  ): Promise<void> {
    const doc = this.documents.get(id);
    if (!doc) {
      throw new Error(`Document "${id}" not found in vault`);
    }

    if (doc.partitionId !== oldPartitionId) {
      throw new Error(
        `Document "${id}" is in partition "${doc.partitionId}", not "${oldPartitionId}"`
      );
    }

    const newPartition = this.partitionManager.getPartition(newPartitionId);
    const updatedDoc: Document = {
      ...doc,
      partitionId: newPartition.id,
      complianceLevel: newPartition.complianceLevel,
      sectorTags:
        doc.sectorTags.length > 0 ? doc.sectorTags : newPartition.sectors,
      updatedAt: new Date(),
    };

    this.documents.set(id, updatedDoc);

    // In production, re-index the document in the vector DB with new partition metadata

    if (this.config.auditLogEnabled) {
      this.auditLog.push({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action: 'update_partition',
        documentId: id,
        partitionId: newPartitionId,
        timestamp: new Date(),
        success: true,
        details: { fromPartition: oldPartitionId, toPartition: newPartitionId },
      });
    }
  }

  getPartitions(): string[] {
    return this.partitionManager
      .getAllPartitions()
      .map((p: UcoPartition) => p.id);
  }

  getSectorPartitions(sector: string): string[] {
    return this.partitionManager
      .getPartitionsForSector(sector)
      .map((p: UcoPartition) => p.id);
  }

  searchPartitions(query: string): string[] {
    const lower = query.toLowerCase();
    return this.partitionManager
      .getAllPartitions()
      .filter(
        (p: UcoPartition) =>
          p.id.toLowerCase().includes(lower) ||
          p.name.toLowerCase().includes(lower) ||
          p.sectors.some((s) => s.toLowerCase().includes(lower))
      )
      .map((p: UcoPartition) => p.id);
  }

  getAuditLog(): readonly AuditEntry[] {
    return Object.freeze([...this.auditLog]);
  }

  getEmbeddingProvider(): EmbeddingProvider {
    return this.embeddingProvider;
  }

  getDocument(id: string): Document | undefined {
    const doc = this.documents.get(id);
    return doc ? { ...doc } : undefined;
  }

  private filterByCompliance(
    results: RetrievalResult,
    requiredLevel?: ComplianceLevel
  ): RetrievalResult {
    if (!requiredLevel) return results;

    const complianceOrder: ComplianceLevel[] = [
      'public',
      'internal',
      'restricted',
      'confidential',
      'regulated',
    ];
    const requiredIndex = complianceOrder.indexOf(requiredLevel);

    const allowed = results.documents.filter((rd) => {
      const docLevel = rd.document.complianceLevel;
      const docIndex = complianceOrder.indexOf(docLevel);
      return docIndex <= requiredIndex;
    });

    return {
      ...results,
      documents: allowed.map((rd, i) => ({ ...rd, rank: i + 1 })),
      totalCount: allowed.length,
      metadata: {
        ...results.metadata,
        complianceFilter: true,
      },
    };
  }
}

export type { RagVaultConfig, RetrievalQuery, RetrievalResult, Document };
