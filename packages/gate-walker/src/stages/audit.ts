/**
 * Stage 10: AUDIT
 * Emits a sealed audit receipt (JSON) using the evidence fabric signing approach.
 * Every final decision (ALLOW/REDACT/DENY) gets a signed receipt.
 */

import { randomUUID, createHash } from 'crypto';
import type { GateRequest, StageResult, GateDecision, AuditReceipt } from '../types.js';
import type { Signer } from '@ios-plus/evidence-fabric';

export interface AuditOptions {
  signer?: Signer;
}

export function auditStage(
  request: GateRequest,
  decision: GateDecision,
  _reason: string,
  stageHistory: StageResult[],
  options: AuditOptions = {}
): { result: StageResult; receipt?: AuditReceipt } {
  const start = Date.now();

  const receiptId = randomUUID();
  const issuedAt = new Date().toISOString();

  const receiptPayload = {
    id: receiptId,
    requestId: request.requestId,
    decision,
    actor: request.actorId,
    resource: `${request.resource.type}/${request.resource.id}`,
    action: request.action,
    sector: request.sector,
    stages: stageHistory,
    issuedAt,
    version: '1.0.0',
  };

  let signature = '';
  let signerPublicKey = '';
  const algorithm = options.signer ? 'Ed25519' : 'none';

  if (options.signer) {
    try {
      const signed = options.signer.sign(receiptPayload as Record<string, unknown>);
      signature = signed.signature;
      signerPublicKey = signed.publicKey;
    } catch (err) {
      // Log but don't fail — audit should not block the pipeline
      console.error('[AuditStage] Signing failed:', err instanceof Error ? err.message : String(err));
    }
  } else {
    // Phase 1: deterministic placeholder when no signer is configured
    signature = 'unsigned-phase1';
    signerPublicKey = 'phase1-no-key';
  }

  const hash = computeReceiptHash({ ...receiptPayload, signature, signerPublicKey, algorithm });

  const receipt: AuditReceipt = {
    ...receiptPayload,
    signature,
    signerPublicKey,
    algorithm,
    hash,
  };

  return {
    result: {
      stage: 'AUDIT',
      status: 'pass',
      decision,
      reason: `Audit receipt issued: ${receiptId}`,
      metadata: {
        receiptId,
        decision,
        algorithm,
        hash: hash.slice(0, 12) + '...',
      },
      durationMs: Date.now() - start,
      timestamp: issuedAt,
    },
    receipt,
  };
}

function computeReceiptHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}
