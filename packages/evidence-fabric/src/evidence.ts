import { createHash, randomUUID } from 'crypto';
import type { Signer, AsyncSigner, EvidenceRecord } from './types.js';

/**
 * Evidence record builder for constructing cryptographically signed audit evidence
 */
export class EvidenceBuilder {
  private signer: Signer | AsyncSigner;
  private timestamp: string;
  private metadata: Record<string, unknown>;
  private requestId: string;
  private decision: string;
  private context: Record<string, unknown>;
  private built: boolean;

  constructor(signer: Signer | AsyncSigner) {
    this.signer = signer;
    this.timestamp = new Date().toISOString();
    this.metadata = {};
    this.requestId = '';
    this.decision = '';
    this.context = {};
    this.built = false;
  }

  setTimestamp(timestamp?: string): EvidenceBuilder {
    this.timestamp = timestamp || new Date().toISOString();
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): EvidenceBuilder {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  createEvidence(
    requestId: string,
    decision: string,
    context: Record<string, unknown>
  ): EvidenceRecord {
    this.requestId = requestId;
    this.decision = decision;
    this.context = context;
    return this.build();
  }

  async createEvidenceAsync(
    requestId: string,
    decision: string,
    context: Record<string, unknown>
  ): Promise<EvidenceRecord> {
    this.requestId = requestId;
    this.decision = decision;
    this.context = context;
    return this.buildAsync();
  }

  build(): EvidenceRecord {
    if (this.built) {
      throw new Error('EvidenceBuilder has already been used. Create a new instance.');
    }
    if (!this.requestId) {
      throw new Error('requestId is required. Call createEvidence() first.');
    }

    const signer = this.signer as Signer;
    const payload = this.buildPayload();
    const signed = signer.sign(payload);
    const evidence = this.assembleEvidence(signed);

    this.built = true;
    return evidence;
  }

  async buildAsync(): Promise<EvidenceRecord> {
    if (this.built) {
      throw new Error('EvidenceBuilder has already been used. Create a new instance.');
    }
    if (!this.requestId) {
      throw new Error('requestId is required. Call createEvidenceAsync() first.');
    }

    const signer = this.signer as AsyncSigner;
    const payload = this.buildPayload();
    const signed = await signer.sign(payload);
    const evidence = this.assembleEvidence(signed);

    this.built = true;
    return evidence;
  }

  private buildPayload(): Record<string, unknown> {
    return {
      requestId: this.requestId,
      decision: this.decision,
      context: this.context,
      timestamp: this.timestamp,
      metadata: this.metadata,
    };
  }

  private assembleEvidence(signed: { payload: Record<string, unknown>; signature: string; publicKey: string; algorithm: string; timestamp: string }): EvidenceRecord {
    const evidence: EvidenceRecord = {
      id: randomUUID(),
      requestId: this.requestId,
      decision: this.decision,
      context: this.context,
      timestamp: this.timestamp,
      metadata: this.metadata,
      signature: signed.signature,
      signerPublicKey: signed.publicKey,
      algorithm: signed.algorithm,
      hash: '',
      version: '1.0.0',
    };

    evidence.hash = createEvidenceHash(evidence);
    return evidence;
  }
}

/**
 * Create a SHA-256 hash of canonicalized evidence
 */
export function createEvidenceHash(evidence: EvidenceRecord): string {
  const canonical = JSON.stringify(evidence, Object.keys(evidence).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify evidence signature and integrity
 */
export async function verifyEvidence(evidence: EvidenceRecord, signer?: Signer | AsyncSigner): Promise<boolean> {
  try {
    const computedHash = createEvidenceHash(evidence);
    if (computedHash !== evidence.hash) {
      return false;
    }

    const payload = {
      requestId: evidence.requestId,
      decision: evidence.decision,
      context: evidence.context,
      timestamp: evidence.timestamp,
      metadata: evidence.metadata,
    };

    if (signer) {
      return signer.verify(payload, evidence.signature, evidence.signerPublicKey);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Verify evidence signature asynchronously
 */
export async function verifyEvidenceAsync(
  evidence: EvidenceRecord,
  signer: AsyncSigner
): Promise<boolean> {
  try {
    const computedHash = createEvidenceHash(evidence);
    if (computedHash !== evidence.hash) {
      return false;
    }

    const payload = {
      requestId: evidence.requestId,
      decision: evidence.decision,
      context: evidence.context,
      timestamp: evidence.timestamp,
      metadata: evidence.metadata,
    };

    return await signer.verify(payload, evidence.signature, evidence.signerPublicKey);
  } catch {
    return false;
  }
}
