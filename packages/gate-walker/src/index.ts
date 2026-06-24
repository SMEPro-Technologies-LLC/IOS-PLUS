/**
 * @ios-plus/gate-walker
 * Phase 1 Gate Walker Engine — 10-Stage Pipeline
 *
 * Stages: AUTHENTICATE → INTERPRET → CLASSIFY → AUTHORIZE →
 *         ROUTE → EXECUTE → RECONCILE → REDACT → RESPOND → AUDIT
 */

// Core pipeline
export { GateWalkerPipeline, type GateWalkerOptions } from './pipeline.js';

// Types
export type {
  PipelineStage,
  GateDecision,
  GateRequest,
  StageResult,
  PipelineState,
  AuditReceipt,
  ClassificationResult,
  AuthorizationResult,
  RoutingResult,
  ReconciliationResult,
  RedactionResult,
  GateExecuteResponse,
  GatePipelineStateRecord,
  BannerEthosRecord,
  BlackboardCourseRecord,
} from './types.js';

export { PIPELINE_STAGES } from './types.js';

// Stage functions
export { authenticateStage, type AuthenticateOptions, type AuthenticatedActor } from './stages/authenticate.js';
export { interpretStage, type InterpretedRequest } from './stages/interpret.js';
export { classifyStage } from './stages/classify.js';
export { authorizeStage } from './stages/authorize.js';
export { routeStage } from './stages/route.js';
export { executeStage, type ExecutionResult } from './stages/execute.js';
export { reconcileStage, type ReconcileOptions, type BannerEthosAdapter, type BlackboardAdapter } from './stages/reconcile.js';
export { redactStage } from './stages/redact.js';
export { respondStage, type RespondResult } from './stages/respond.js';
export { auditStage, type AuditOptions } from './stages/audit.js';

// Mock adapters
export { MockBannerEthosAdapter } from './mocks/banner-ethos.js';
export { MockBlackboardAdapter } from './mocks/blackboard.js';

// State store
export { InMemoryStateStore, PostgresStateStore, type GatePipelineStateStore } from './db/state-store.js';

// API server
export { GateWalkerServer, type GateWalkerServerConfig } from './api/server.js';
