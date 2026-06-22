/**
 * @ios-plus/middleware-engine
 * 7-Layer Middleware Orchestration for the IOS+ Platform
 *
 * Layers:
 * 1. Auth — Authentication & authorization
 * 2. Classification — Intent, sector, sensitivity, PII detection
 * 3. Policy — Policy loading, filtering, merging, validation
 * 4. Evaluation — Gate530 compliance evaluation
 * 5. Evidence — Signed evidence record creation & verification
 * 6. Retrieval — RAG Vault retrieval & augmentation
 * 7. Audit — COS+ audit trail & WORM integrity
 */

// Configuration types
export {
  type AuthLayerConfig,
  type ClassificationLayerConfig,
  type PolicyLayerConfig,
  type EvaluationLayerConfig,
  type EvidenceLayerConfig,
  type RetrievalLayerConfig,
  type AuditLayerConfig,
  type OrchestratorConfig,
  type ServerConfig,
  type SensitivityLevel,
  type AiRequest,
  type Actor,
  type AuthResult,
  type PiiDetectionResult,
  type ClassificationResult,
  type PolicyRule,
  type ValidationResult,
  type ComplianceDecision,
  type EvaluationContext,
  type EvidenceRecord,
  type RetrievalDocument,
  type RetrievalResult,
  type RetrievalQuery,
  type AuditEvent,
  type AuditFilters,
  type OrchestratorResult,
  ConfigValidationError,
  validateOrchestratorConfig,
  validateServerConfig,
  defaultServerConfig,
} from './config.js';

// Layer classes
export { AuthLayer, type TokenPayload } from './layers/auth.js';
export { ClassificationLayer } from './layers/classification.js';
export { PolicyLayer } from './layers/policy.js';
export { EvaluationLayer } from './layers/evaluation.js';
export { EvidenceLayer } from './layers/evidence.js';
export { RetrievalLayer } from './layers/retrieval.js';
export { AuditLayer } from './layers/audit.js';

// Core orchestrator
export { MiddlewareOrchestrator } from './orchestrator.js';

// HTTP server
export {
  HttpServer,
  createServer,
  type ServerRequest,
  type ServerResponse,
  type RouteHandler,
  type Middleware,
  type Route,
} from './server.js';
