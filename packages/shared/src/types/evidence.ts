/**
 * Evidence Fabric types — Ed25519 / JCS / RFC 8785 audit trail
 * IOS+ Engineering Body — Document 2
 * SMEPro Technologies — Confidential
 */

export type ClassificationLevel = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type EvidenceEventType =
  | 'INFERENCE_REQUEST' | 'GATE_DECISION' | 'RAG_RETRIEVAL'
  | 'UCO_EVALUATION' | 'WORM_COMMIT' | 'KEY_ROTATION' | 'QUARANTINE';

/** JCS-canonicalized payload (RFC 8785) over which Ed25519 signature is computed */
export interface EvidencePackagePayload {
  eventId: string;           // UUIDv7
  tenantId: string;
  sessionId: string;
  timestamp: string;         // ISO 8601 UTC
  eventType: EvidenceEventType;
  layerDepth: number;        // 1–7 (YBR layer)
  requestHash: string;       // SHA-256 of canonical request
  responseHash: string;      // SHA-256 of canonical response
  ucoNodeIds: string[];      // UCO nodes evaluated at this event
  policyAction: string;
  classificationLevel: ClassificationLevel;
  metadata: Record<string, unknown>;
}

/** Signed evidence package stored in COS+ append-only table */
export interface EvidencePackage {
  packageId: string;         // UUIDv7
  payload: EvidencePackagePayload;
  /** Ed25519 signature over JCS-canonicalized payload, base64url-encoded */
  signature: string;
  /** Key ID referencing ios_signing_keys table + DNS TXT + filesystem */
  verificationKeyId: string;
  signingAlgorithm: 'Ed25519';
  canonicalizationAlgorithm: 'JCS/RFC8785';
  publishedAt: string;
  merkleRootId?: string;     // set after Merkle batch publication
}

/** Gate 530 compliance decision record */
export interface GateDecisionRecord {
  decisionId: string;        // UUIDv7
  sessionId: string;
  tenantId: string;
  decidedAt: string;         // ISO 8601 UTC
  ucoNodeId: string;
  policyAction: 'BLOCK' | 'APPROVE' | 'ESCALATE';
  riskWeight: number;        // 5–10
  rationale: string;
  overrideApplied: boolean;
  overrideAuthorizedBy?: string;
  evidencePackageId: string; // FK → evidence_packages.package_id
  latencyMs: number;
}

/** Triple-published signing key record */
export interface SigningKeyRecord {
  keyId: string;             // UUIDv7
  publicKeyEd25519: string;  // base64url DER
  /** Publication locations (all three must be consistent) */
  publications: {
    database: boolean;
    dnsTxtRecord: string;    // e.g. "_ios-signing-key.smeprotech.com"
    filesystemPath: string;  // e.g. "/etc/ios-plus/keys/current.pub"
  };
  activatedAt: string;
  expiresAt: string;         // 90-day rotation cycle
  rotatedAt?: string;
  revokedAt?: string;
}

/** Merkle root batch record — published to COS+ + DNS */
export interface MerkleRootRecord {
  merkleRootId: string;
  batchStartEventId: string;
  batchEndEventId: string;
  batchSize: number;
  merkleRoot: string;        // hex-encoded SHA-256 Merkle root
  computedAt: string;
  dnsPublishedAt?: string;
}
