/**
 * Internal types for the RAG Vault system
 * UCO-partitioned compliance-aware retrieval types
 */

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  partitionId: string;
  sectorTags: string[];
  complianceLevel: ComplianceLevel;
  createdAt: Date;
  updatedAt: Date;
  evidenceId?: string;
  sourceRef?: string;
}

export interface RetrievalQuery {
  text: string;
  embedding?: number[];
  partition?: string;
  sector?: string;
  actorId?: string;
  complianceLevel?: ComplianceLevel;
  evidenceId?: string;
  maxResults?: number;
  maxDepth?: number;
  filters?: Record<string, unknown>;
}

export interface RetrievalResult {
  documents: RankedDocument[];
  totalCount: number;
  partition: string;
  sector?: string;
  queryTimeMs: number;
  metadata: ResultMetadata;
}

export interface RankedDocument {
  document: Document;
  score: number;
  rank: number;
  relevanceScore: number;
  sectorScore: number;
  complianceScore: number;
}

export interface ResultMetadata {
  partitionFilter: boolean;
  sectorFilter: boolean;
  complianceFilter: boolean;
  deduplicationApplied: boolean;
  rankingMethod: string;
  embeddingProvider: string;
}

export type ComplianceLevel =
  | 'public'
  | 'internal'
  | 'restricted'
  | 'confidential'
  | 'regulated';

export interface RagVaultConfig {
  databasePool: unknown;
  embeddingConfig: EmbeddingConfig;
  partitionStrategy: PartitionStrategy;
  defaultPartition?: string;
  defaultSector?: string;
  maxResults?: number;
  maxDepth?: number;
  complianceEnforcement?: 'strict' | 'permissive' | 'audit';
  auditLogEnabled?: boolean;
  vectorTable?: string;
  similarityThreshold?: number;
}

export interface EmbeddingConfig {
  provider: 'mock' | 'openai' | 'custom';
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
  batchSize?: number;
  timeoutMs?: number;
}

export type PartitionStrategy = 'uco' | 'sector' | 'custom';

export interface UcoPartition {
  id: string;
  name: string;
  sectors: string[];
  complianceLevel: ComplianceLevel;
  createdAt: Date;
  updatedAt: Date;
  description?: string;
  parentPartitionId?: string;
  childPartitionIds?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: Partial<RagVaultConfig>;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  similarityThreshold?: number;
  filters?: Record<string, unknown>;
  includeMetadata?: boolean;
  includeEmbeddings?: boolean;
}

export interface Actor {
  id: string;
  roles: string[];
  sectors: string[];
  clearanceLevel: ComplianceLevel;
  partitionAccess: string[];
}

export interface AuditEntry {
  id: string;
  action: 'retrieve' | 'add' | 'remove' | 'update_partition';
  actorId?: string;
  documentId?: string;
  partitionId?: string;
  timestamp: Date;
  success: boolean;
  details?: Record<string, unknown>;
}

export interface SectorKnowledge {
  sectorId: string;
  knowledgeIds: string[];
  mappings: Record<string, number>; // knowledgeId -> relevance score
  lastUpdated: Date;
}

export type SectorType =
  | 'general'
  | 'healthcare'
  | 'finance'
  | 'education'
  | 'energy'
  | 'government';

export interface ComplianceRule {
  id: string;
  partitionId: string;
  requiredClearance: ComplianceLevel;
  sectorRestrictions: string[];
  actorExceptions: string[];
  effectiveDate: Date;
  expiryDate?: Date;
}

export interface VectorSearchResult {
  id: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  distance: number;
}

export interface HybridSearchResult {
  vectorResults: VectorSearchResult[];
  textResults: VectorSearchResult[];
  combinedScores: Map<string, number>;
}
