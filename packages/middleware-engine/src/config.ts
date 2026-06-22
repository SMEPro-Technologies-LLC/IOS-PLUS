/**
 * Configuration types and validation for the Middleware Orchestrator
 * @module config
 */

export interface AuthLayerConfig {
  jwtSecret: string;
  jwtIssuer: string;
  apiKeyHeader: string;
  apiKeyStore: Map<string, { actorId: string; permissions: string[]; tenantId?: string }>;
  adminTokenSecret: string;
  tokenExpiryMs: number;
}

export interface ClassificationLayerConfig {
  defaultSector: string;
  defaultSensitivity: SensitivityLevel;
  piiDetectionThreshold: number;
  classificationModelEndpoint?: string;
  failClosed: boolean;
}

export interface PolicyLayerConfig {
  policyStoreEndpoint?: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  defaultEffect: 'allow' | 'deny';
}

export interface EvaluationLayerConfig {
  gate530Endpoint: string;
  timeoutMs: number;
  retryCount: number;
  batchSize: number;
}

export interface EvidenceLayerConfig {
  cosPlusEndpoint: string;
  signingKey: string;
  evidenceTtlDays: number;
  asyncStore: boolean;
}

export interface RetrievalLayerConfig {
  ragVaultEndpoint: string;
  defaultPartition: string;
  maxResults: number;
  complianceFilterEnabled: boolean;
  timeoutMs: number;
}

export interface AuditLayerConfig {
  cosPlusEndpoint: string;
  wormEnabled: boolean;
  retentionDays: number;
  batchSize: number;
  flushIntervalMs: number;
}

export interface OrchestratorConfig {
  auth: AuthLayerConfig;
  classification: ClassificationLayerConfig;
  policy: PolicyLayerConfig;
  evaluation: EvaluationLayerConfig;
  evidence: EvidenceLayerConfig;
  retrieval: RetrievalLayerConfig;
  audit: AuditLayerConfig;
  failClosed: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ServerConfig {
  port: number;
  host: string;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  maxRequestBodySize: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  adminRateLimitWindowMs: number;
  adminRateLimitMaxRequests: number;
  corsOrigins: string[];
  healthCheckPath: string;
  readinessCheckPath: string;
  metricsPath: string;
}

export type SensitivityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AiRequest {
  id: string;
  actorId?: string;
  token?: string;
  apiKey?: string;
  content: string;
  metadata?: Record<string, unknown>;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export interface Actor {
  id: string;
  type: 'user' | 'service' | 'admin';
  permissions: string[];
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthResult {
  authenticated: boolean;
  actor: Actor;
  method: 'jwt' | 'apiKey';
  permissions: string[];
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface PiiDetectionResult {
  hasPII: boolean;
  fields: string[];
  confidence: number;
  types: string[];
}

export interface ClassificationResult {
  intent: string;
  sector: string;
  sensitivity: SensitivityLevel;
  piiDetected: PiiDetectionResult;
  confidence: number;
  rawLabels?: Record<string, number>;
}

export interface PolicyRule {
  id: string;
  name: string;
  sector: string;
  action: string;
  condition: Record<string, unknown>;
  effect: 'allow' | 'deny';
  priority: number;
  tenantId?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface ComplianceDecision {
  status: 'ALLOW' | 'DENY' | 'REVIEW';
  reason: string;
  policyId?: string;
  ruleId?: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  evaluatedAt: string;
}

export interface EvaluationContext {
  request: AiRequest;
  actor: Actor;
  classification: ClassificationResult;
  policies: PolicyRule[];
  metadata: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: string;
  requestId: string;
  decision: ComplianceDecision;
  actorId: string;
  timestamp: string;
  signature: string;
  context: Record<string, unknown>;
  hash: string;
}

export interface RetrievalDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
  source: string;
  partition: string;
}

export interface RetrievalResult {
  documents: RetrievalDocument[];
  query: string;
  partition: string;
  total: number;
  filteredCount: number;
  complianceLevel: SensitivityLevel;
}

export interface RetrievalQuery {
  text: string;
  filters: Record<string, unknown>;
  partition: string;
  maxResults: number;
  complianceFilter?: SensitivityLevel;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  resource: string;
  result: string;
  metadata: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requestId?: string;
  tenantId?: string;
  integrityHash?: string;
}

export interface AuditFilters {
  actorId?: string;
  action?: string;
  resource?: string;
  startDate?: string;
  endDate?: string;
  tenantId?: string;
  requestId?: string;
  limit?: number;
  offset?: number;
}

export interface OrchestratorResult {
  decision: ComplianceDecision;
  evidence: EvidenceRecord;
  retrievalResult?: RetrievalResult;
  auditEventId: string;
  metadata: Record<string, unknown>;
}

export class ConfigValidationError extends Error {
  constructor(message: string, public readonly fields: string[] = []) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export function validateOrchestratorConfig(config: unknown): OrchestratorConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError('Config must be an object');
  }
  const c = config as Record<string, unknown>;
  const required = ['auth', 'classification', 'policy', 'evaluation', 'evidence', 'retrieval', 'audit'];
  const missing = required.filter((k) => !c[k]);
  if (missing.length > 0) {
    throw new ConfigValidationError(`Missing required config sections: ${missing.join(', ')}`, missing);
  }
  return config as OrchestratorConfig;
}

export function validateServerConfig(config: unknown): ServerConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError('ServerConfig must be an object');
  }
  const c = config as Record<string, unknown>;
  const required = ['port', 'host'];
  const missing = required.filter((k) => c[k] === undefined);
  if (missing.length > 0) {
    throw new ConfigValidationError(`Missing required server config: ${missing.join(', ')}`, missing);
  }
  return { ...defaultServerConfig(), ...config } as ServerConfig;
}

export function defaultServerConfig(): ServerConfig {
  return {
    port: 8080,
    host: '0.0.0.0',
    requestTimeoutMs: 30000,
    keepAliveTimeoutMs: 5000,
    maxRequestBodySize: 10 * 1024 * 1024, // 10 MB
    rateLimitWindowMs: 60 * 1000,
    rateLimitMaxRequests: 100,
    adminRateLimitWindowMs: 60 * 1000,
    adminRateLimitMaxRequests: 20,
    corsOrigins: ['*'],
    healthCheckPath: '/health',
    readinessCheckPath: '/ready',
    metricsPath: '/metrics',
  };
}
