/**
 * Inference pipeline types — L1–L7 orchestration
 * IOS+ Engineering Body — Document 1
 * SMEPro Technologies — Confidential
 */

import type { UCOContext, UCONodeResult } from './uco.js';
import type { EvidencePackage, GateDecisionRecord, ClassificationLevel } from './evidence.js';

export type LayerIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface LayerTimeoutConfig {
  L1: number; L2: number; L3: number; L4: number;
  L5: number; L6: number; L7: number;
}

/** Default layer timeout budget (ms) per EB Doc 1 */
export const DEFAULT_LAYER_TIMEOUTS: LayerTimeoutConfig = {
  L1: 10, L2: 30, L3: 50, L4: 20, L5: 50, L6: 120, L7: 200
};

/** Immutable execution context threaded through all 7 layers */
export interface ExecutionContext {
  requestId: string;        // UUIDv7
  tenantId: string;
  sessionId: string;
  traceId: string;          // distributed trace ID
  classificationLevel: ClassificationLevel;
  ucoContext: UCOContext;   // resolved at L3, injected to all subsequent layers
  startedAt: string;        // ISO 8601
  timeouts: LayerTimeoutConfig;
  request?: InferenceRequest; // Preserved raw request for L6 resumption
}

export interface InferenceRequest {
  requestId: string;
  tenantId: string;
  sessionId: string;
  rawInput: string;
  contentType: 'text/plain' | 'application/json' | 'multipart/form-data';
  metadata?: Record<string, unknown>;
}

export interface InferenceResponse {
  requestId: string;
  tenantId: string;
  sessionId: string;
  output: string;
  policyAction: 'BLOCK' | 'APPROVE' | 'ESCALATE';
  classificationLevel: ClassificationLevel;
  ucoNodesEvaluated: number;
  ucoNodeResults: UCONodeResult[];
  gateDecisions: GateDecisionRecord[];
  evidencePackages: EvidencePackage[];
  totalLatencyMs: number;
  layerLatencies: Record<string, number>;
}

export type TransportProtocol = 'REST' | 'gRPC';

/** Layer execution result threaded through orchestrator */
export interface LayerResult {
  layer: LayerIndex;
  success: boolean;
  latencyMs: number;
  output?: unknown;
  error?: string;
}
