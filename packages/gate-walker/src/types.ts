/**
 * Gate Walker Engine — Core Types
 * 10-stage pipeline for IOS+ Phase 1
 */

// ─── Pipeline Stage Names ──────────────────────────────────────────────────

export type PipelineStage =
  | 'AUTHENTICATE'
  | 'INTERPRET'
  | 'CLASSIFY'
  | 'AUTHORIZE'
  | 'ROUTE'
  | 'EXECUTE'
  | 'RECONCILE'
  | 'REDACT'
  | 'RESPOND'
  | 'AUDIT';

export const PIPELINE_STAGES: PipelineStage[] = [
  'AUTHENTICATE',
  'INTERPRET',
  'CLASSIFY',
  'AUTHORIZE',
  'ROUTE',
  'EXECUTE',
  'RECONCILE',
  'REDACT',
  'RESPOND',
  'AUDIT',
];

// ─── Pipeline Decisions ───────────────────────────────────────────────────

export type GateDecision = 'ALLOW' | 'REDACT' | 'DENY';

// ─── Input Request ────────────────────────────────────────────────────────

export interface GateRequest {
  /** Unique identifier for this request */
  requestId: string;
  /** ****** (JWT) or API key */
  token?: string;
  /** Actor making the request */
  actorId: string;
  /** Resource being accessed */
  resource: {
    type: string;
    id: string;
    classification?: string;
    ferpaProtected?: boolean;
    metadata?: Record<string, unknown>;
  };
  /** Action being performed */
  action: string;
  /** Sector context (e.g., 'education', 'general') */
  sector: string;
  /** Additional context metadata */
  metadata?: Record<string, unknown>;
}

// ─── Pipeline State ───────────────────────────────────────────────────────

export interface StageResult {
  stage: PipelineStage;
  status: 'pass' | 'fail' | 'skip';
  decision?: GateDecision;
  reason?: string;
  metadata?: Record<string, unknown>;
  durationMs: number;
  timestamp: string;
}

export interface PipelineState {
  requestId: string;
  request: GateRequest;
  currentStage: PipelineStage;
  stages: StageResult[];
  finalDecision?: GateDecision;
  finalReason?: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  auditReceiptId?: string;
  redactedFields?: string[];
}

// ─── Sealed Audit Receipt ─────────────────────────────────────────────────

export interface AuditReceipt {
  id: string;
  requestId: string;
  decision: GateDecision;
  actor: string;
  resource: string;
  action: string;
  sector: string;
  stages: StageResult[];
  issuedAt: string;
  signature: string;
  signerPublicKey: string;
  algorithm: string;
  hash: string;
  version: string;
}

// ─── Classification Result ────────────────────────────────────────────────

export interface ClassificationResult {
  sector: string;
  sensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
  ferpaProtected: boolean;
  riskScore: number;
  tags: string[];
}

// ─── Authorization Result ─────────────────────────────────────────────────

export interface AuthorizationResult {
  authorized: boolean;
  reason: string;
  requiredPermissions: string[];
  grantedPermissions: string[];
}

// ─── Routing Result ───────────────────────────────────────────────────────

export interface RoutingResult {
  path: 'standard' | 'ferpa' | 'deny' | 'escalate';
  targetSystem?: string;
  reason: string;
}

// ─── Reconciliation Result ────────────────────────────────────────────────

export interface ReconciliationResult {
  bannerStatus?: 'verified' | 'not_found' | 'error' | 'skipped';
  blackboardStatus?: 'verified' | 'not_found' | 'error' | 'skipped';
  reconciled: boolean;
  details: Record<string, unknown>;
}

// ─── Redaction Result ─────────────────────────────────────────────────────

export interface RedactionResult {
  applied: boolean;
  redactedFields: string[];
  reason?: string;
}

// ─── Pipeline Execute Response ────────────────────────────────────────────

export interface GateExecuteResponse {
  requestId: string;
  decision: GateDecision;
  reason: string;
  stages: StageResult[];
  auditReceipt: AuditReceipt;
  redactedFields: string[];
  processingMs: number;
}

// ─── DB Record ────────────────────────────────────────────────────────────

export interface GatePipelineStateRecord {
  id: string;
  requestId: string;
  currentStage: string;
  finalDecision?: string;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Mock Adapter Interfaces ──────────────────────────────────────────────

export interface BannerEthosRecord {
  studentId: string;
  enrollmentStatus: 'enrolled' | 'graduated' | 'withdrawn' | 'not_found';
  ferpaHold: boolean;
  programCode?: string;
  gpa?: number;
}

export interface BlackboardCourseRecord {
  courseId: string;
  studentId: string;
  enrollmentStatus: 'active' | 'dropped' | 'completed' | 'not_found';
  grade?: string;
  lastAccess?: string;
}
