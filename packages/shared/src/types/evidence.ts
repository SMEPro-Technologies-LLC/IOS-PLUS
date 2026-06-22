import type { ComplianceDecision } from './compliance.js';

export type EvidenceRecord = {
  id: string;
  requestId: string;
  timestamp: string;
  decision: ComplianceDecision;
  signature: string;
  publicKey: string;
  canonicalPayload: string;
};

export type SignedPayload = {
  payload: string;
  signature: string;
  publicKey: string;
  algorithm: string;
  createdAt: string;
};

export type JcsCanonicalizedPayload = {
  original: Record<string, unknown>;
  canonicalized: string;
  hash: string;
  algorithm: string;
};

export type VerificationResult = {
  valid: boolean;
  signatureValid: boolean;
  payloadValid: boolean;
  timestamp: string;
  publicKeyFingerprint: string;
  errors?: readonly string[];
};
