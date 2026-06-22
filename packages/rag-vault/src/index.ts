export { RagVault } from './rag-vault.js';
export type {
  RagVaultConfig,
  RetrievalQuery,
  RetrievalResult,
  Document,
  Actor,
  ComplianceLevel,
  AuditEntry,
  RankedDocument,
  EmbeddingConfig,
  PartitionStrategy,
  SearchOptions,
  UcoPartition,
  SectorType,
  ValidationResult,
  VectorSearchResult,
  HybridSearchResult,
} from './types.js';

export {
  UcoPartitionManager,
} from './partition.js';
export type {
  PartitionStrategy as PartitionStrategyType,
  ComplianceLevel as PartitionComplianceLevel,
} from './partition.js';

export {
  SectorKnowledgeMap,
  SectorAwareFilter,
} from './sector.js';
export type {
  SectorType as SectorTypeEnum,
  ComplianceLevel as SectorComplianceLevel,
} from './sector.js';

export {
  VectorRetriever,
  RetrievalRanker,
  RetrievalDeduplicator,
  RetrievalLimiter,
} from './retrieval.js';

export {
  MockEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from './embedding.js';
export type {
  EmbeddingProvider,
} from './embedding.js';

export {
  loadConfig,
  validateConfig,
  getDefaultConfig,
} from './config.js';
