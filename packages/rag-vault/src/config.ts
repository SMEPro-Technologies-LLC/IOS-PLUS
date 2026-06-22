import { RagVaultConfig, EmbeddingConfig, ValidationResult, PartitionStrategy } from './types.js';

export function loadConfig(env: Record<string, string | undefined>): RagVaultConfig {
  const defaultConfig = getDefaultConfig();

  return {
    ...defaultConfig,
    databasePool: env.RAG_VAULT_DB_POOL ?? defaultConfig.databasePool,
    embeddingConfig: {
      ...defaultConfig.embeddingConfig,
      provider: (env.RAG_VAULT_EMBED_PROVIDER as EmbeddingConfig['provider']) ?? defaultConfig.embeddingConfig.provider,
      model: env.RAG_VAULT_EMBED_MODEL ?? defaultConfig.embeddingConfig.model,
      dimensions: env.RAG_VAULT_EMBED_DIMS ? parseInt(env.RAG_VAULT_EMBED_DIMS, 10) : defaultConfig.embeddingConfig.dimensions,
      apiKey: env.RAG_VAULT_EMBED_API_KEY ?? defaultConfig.embeddingConfig.apiKey,
      baseUrl: env.RAG_VAULT_EMBED_BASE_URL ?? defaultConfig.embeddingConfig.baseUrl,
    },
    partitionStrategy: (env.RAG_VAULT_PARTITION_STRATEGY as PartitionStrategy) ?? defaultConfig.partitionStrategy,
    defaultPartition: env.RAG_VAULT_DEFAULT_PARTITION ?? defaultConfig.defaultPartition,
    defaultSector: env.RAG_VAULT_DEFAULT_SECTOR ?? defaultConfig.defaultSector,
    maxResults: env.RAG_VAULT_MAX_RESULTS ? parseInt(env.RAG_VAULT_MAX_RESULTS, 10) : defaultConfig.maxResults,
    maxDepth: env.RAG_VAULT_MAX_DEPTH ? parseInt(env.RAG_VAULT_MAX_DEPTH, 10) : defaultConfig.maxDepth,
    complianceEnforcement: (env.RAG_VAULT_COMPLIANCE_ENFORCEMENT as 'strict' | 'permissive' | 'audit') ?? defaultConfig.complianceEnforcement,
    auditLogEnabled: env.RAG_VAULT_AUDIT_LOG === 'true' ? true : defaultConfig.auditLogEnabled,
    vectorTable: env.RAG_VAULT_VECTOR_TABLE ?? defaultConfig.vectorTable,
    similarityThreshold: env.RAG_VAULT_SIM_THRESHOLD ? parseFloat(env.RAG_VAULT_SIM_THRESHOLD) : defaultConfig.similarityThreshold,
  };
}

export function validateConfig(config: RagVaultConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.databasePool) {
    errors.push('databasePool is required');
  }

  if (!config.embeddingConfig) {
    errors.push('embeddingConfig is required');
  } else {
    if (!config.embeddingConfig.provider) {
      errors.push('embeddingConfig.provider is required');
    }
    if (config.embeddingConfig.provider === 'openai' && !config.embeddingConfig.apiKey) {
      warnings.push('OpenAI embedding provider selected but no API key configured');
    }
    if (config.embeddingConfig.dimensions && (config.embeddingConfig.dimensions < 1 || config.embeddingConfig.dimensions > 4096)) {
      errors.push('embeddingConfig.dimensions must be between 1 and 4096');
    }
  }

  if (!config.partitionStrategy) {
    errors.push('partitionStrategy is required');
  }

  if (config.maxResults !== undefined && (config.maxResults < 1 || config.maxResults > 10000)) {
    errors.push('maxResults must be between 1 and 10000');
  }

  if (config.maxDepth !== undefined && (config.maxDepth < 1 || config.maxDepth > 10)) {
    errors.push('maxDepth must be between 1 and 10');
  }

  if (config.similarityThreshold !== undefined && (config.similarityThreshold < 0 || config.similarityThreshold > 1)) {
    errors.push('similarityThreshold must be between 0 and 1');
  }

  if (!['strict', 'permissive', 'audit'].includes(config.complianceEnforcement ?? 'strict')) {
    errors.push('complianceEnforcement must be strict, permissive, or audit');
  }

  if (!config.defaultPartition) {
    warnings.push('No defaultPartition configured; fallback to "general"');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    config,
  };
}

export function getDefaultConfig(): RagVaultConfig {
  return {
    databasePool: undefined as unknown as unknown,
    embeddingConfig: {
      provider: 'mock',
      model: 'mock-384',
      dimensions: 384,
      batchSize: 32,
      timeoutMs: 30000,
    },
    partitionStrategy: 'uco',
    defaultPartition: 'general',
    defaultSector: 'general',
    maxResults: 50,
    maxDepth: 3,
    complianceEnforcement: 'strict',
    auditLogEnabled: true,
    vectorTable: 'rag_vault_vectors',
    similarityThreshold: 0.75,
  };
}

export type { RagVaultConfig, EmbeddingConfig, ValidationResult, PartitionStrategy };
