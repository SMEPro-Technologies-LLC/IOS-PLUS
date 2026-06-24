import { createHash, randomUUID } from 'crypto';
/**
 * Evidence record builder for constructing cryptographically signed audit evidence
 */
export class EvidenceBuilder {
    signer;
    timestamp;
    metadata;
    requestId;
    decision;
    context;
    built;
    constructor(signer) {
        this.signer = signer;
        this.timestamp = new Date().toISOString();
        this.metadata = {};
        this.requestId = '';
        this.decision = '';
        this.context = {};
        this.built = false;
    }
    setTimestamp(timestamp) {
        this.timestamp = timestamp || new Date().toISOString();
        return this;
    }
    setMetadata(metadata) {
        this.metadata = { ...this.metadata, ...metadata };
        return this;
    }
    createEvidence(requestId, decision, context) {
        this.requestId = requestId;
        this.decision = decision;
        this.context = context;
        return this.build();
    }
    async createEvidenceAsync(requestId, decision, context) {
        this.requestId = requestId;
        this.decision = decision;
        this.context = context;
        return this.buildAsync();
    }
    build() {
        if (this.built) {
            throw new Error('EvidenceBuilder has already been used. Create a new instance.');
        }
        if (!this.requestId) {
            throw new Error('requestId is required. Call createEvidence() first.');
        }
        const signer = this.signer;
        const payload = this.buildPayload();
        const signed = signer.sign(payload);
        const evidence = this.assembleEvidence(signed);
        this.built = true;
        return evidence;
    }
    async buildAsync() {
        if (this.built) {
            throw new Error('EvidenceBuilder has already been used. Create a new instance.');
        }
        if (!this.requestId) {
            throw new Error('requestId is required. Call createEvidenceAsync() first.');
        }
        const signer = this.signer;
        const payload = this.buildPayload();
        const signed = await signer.sign(payload);
        const evidence = this.assembleEvidence(signed);
        this.built = true;
        return evidence;
    }
    buildPayload() {
        return {
            requestId: this.requestId,
            decision: this.decision,
            context: this.context,
            timestamp: this.timestamp,
            metadata: this.metadata,
        };
    }
    assembleEvidence(signed) {
        const evidence = {
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
export function createEvidenceHash(evidence) {
    const canonical = JSON.stringify(evidence, Object.keys(evidence).sort());
    return createHash('sha256').update(canonical).digest('hex');
}
/**
 * Verify evidence signature and integrity
 * Note: only synchronous Signer is accepted here. For AsyncSigner use verifyEvidenceAsync.
 */
export function verifyEvidence(evidence, signer) {
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
    }
    catch {
        return false;
    }
}
/**
 * Verify evidence signature asynchronously
 */
export async function verifyEvidenceAsync(evidence, signer) {
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
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=evidence.js.map