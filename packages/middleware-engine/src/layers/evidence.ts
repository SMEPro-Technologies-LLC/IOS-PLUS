/**
 * Evidence Layer (Layer 5)
 * Creates signed evidence records, verifies signatures, persists to COS+
 * @module layers/evidence
 */

import { createHash, createHmac } from 'node:crypto';
import {
  type EvidenceLayerConfig,
  type EvidenceRecord,
  type ComplianceDecision,
  type EvaluationContext,
} from '../config.js';

export class EvidenceLayer {
  private readonly config: EvidenceLayerConfig;
  private readonly evidenceStore: Map<string, EvidenceRecord> = new Map();

  constructor(config: EvidenceLayerConfig) {
    this.config = config;
  }

  /**
   * Create a signed evidence record for a compliance decision
   */
  async createEvidence(decision: ComplianceDecision, context: EvaluationContext): Promise<EvidenceRecord> {
    const record: EvidenceRecord = {
      id: this.generateEvidenceId(),
      requestId: context.request.id,
      decision,
      actorId: context.actor.id,
      timestamp: new Date().toISOString(),
      signature: '',
      context: {
        sector: context.classification.sector,
        sensitivity: context.classification.sensitivity,
        intent: context.classification.intent,
        policies: context.policies.map((p) => p.id),
      },
      hash: '',
    };

    record.hash = await this.computeHash(record);
    record.signature = await this.signEvidence(record);

    if (this.config.asyncStore) {
      this.storeEvidence(record).catch((err) => {
        console.error('Async evidence storage failed:', err);
      });
    } else {
      await this.storeEvidence(record);
    }

    return record;
  }

  /**
   * Verify the signature of an evidence record
   */
  async verifyEvidence(evidence: EvidenceRecord): Promise<boolean> {
    try {
      // Omit hash and signature to reproduce the canonical form for hashing
      const { hash: _h, signature: _s, ...withoutHashSig } = evidence;
      const expectedHash = await this.computeHash(withoutHashSig);
      if (expectedHash !== evidence.hash) return false;
      const expectedSig = await this.signWithKey(
        JSON.stringify({ ...evidence, signature: '', hash: '' }),
        this.config.signingKey
      );
      return expectedSig === evidence.signature;
    } catch {
      return false;
    }
  }

  /**
   * Persist evidence record to COS+
   */
  async storeEvidence(evidence: EvidenceRecord): Promise<void> {
    // In production: await @ios-plus/cos-plus client.storeEvidence(evidence)
    this.evidenceStore.set(evidence.requestId, evidence);
  }

  /**
   * Retrieve evidence by request ID
   */
  async getEvidenceByRequest(requestId: string): Promise<EvidenceRecord | null> {
    return this.evidenceStore.get(requestId) || null;
  }

  /**
   * List all evidence records (admin/debug)
   */
  async listEvidence(limit?: number, offset?: number): Promise<EvidenceRecord[]> {
    const all = Array.from(this.evidenceStore.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    if (limit === undefined) return all;
    const start = offset || 0;
    return all.slice(start, start + limit);
  }

  private generateEvidenceId(): string {
    return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async computeHash(record: Omit<EvidenceRecord, 'hash' | 'signature'>): Promise<string> {
    const data = JSON.stringify(record);
    return createHash('sha256').update(data).digest('hex');
  }

  private async signEvidence(record: EvidenceRecord): Promise<string> {
    const data = JSON.stringify({ ...record, signature: '', hash: '' });
    return this.signWithKey(data, this.config.signingKey);
  }

  private async signWithKey(data: string, key: string): Promise<string> {
    return createHmac('sha256', key).update(data).digest('hex');
  }
}
