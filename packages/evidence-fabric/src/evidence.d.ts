import type { Signer, AsyncSigner, EvidenceRecord } from './types.js';
/**
 * Evidence record builder for constructing cryptographically signed audit evidence
 */
export declare class EvidenceBuilder {
    private signer;
    private timestamp;
    private metadata;
    private requestId;
    private decision;
    private context;
    private built;
    constructor(signer: Signer | AsyncSigner);
    setTimestamp(timestamp?: string): EvidenceBuilder;
    setMetadata(metadata: Record<string, unknown>): EvidenceBuilder;
    createEvidence(requestId: string, decision: string, context: Record<string, unknown>): EvidenceRecord;
    createEvidenceAsync(requestId: string, decision: string, context: Record<string, unknown>): Promise<EvidenceRecord>;
    build(): EvidenceRecord;
    buildAsync(): Promise<EvidenceRecord>;
    private buildPayload;
    private assembleEvidence;
}
/**
 * Create a SHA-256 hash of canonicalized evidence
 */
export declare function createEvidenceHash(evidence: EvidenceRecord): string;
/**
 * Verify evidence signature and integrity
 * Note: only synchronous Signer is accepted here. For AsyncSigner use verifyEvidenceAsync.
 */
export declare function verifyEvidence(evidence: EvidenceRecord, signer?: Signer): boolean;
/**
 * Verify evidence signature asynchronously
 */
export declare function verifyEvidenceAsync(evidence: EvidenceRecord, signer: AsyncSigner): Promise<boolean>;
//# sourceMappingURL=evidence.d.ts.map