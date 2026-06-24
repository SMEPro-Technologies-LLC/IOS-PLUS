/**
 * Internal types for the Evidence Fabric package
 */
export interface Signer {
    sign(payload: Record<string, unknown>): SignedPayload;
    verify(payload: Record<string, unknown>, signature: string, publicKey?: string): boolean;
    getPublicKey(): string | Promise<string>;
}
export interface AsyncSigner {
    sign(payload: Record<string, unknown>): Promise<SignedPayload>;
    verify(payload: Record<string, unknown>, signature: string, publicKey?: string): Promise<boolean>;
    getPublicKey(): Promise<string>;
}
export interface SignedPayload {
    payload: Record<string, unknown>;
    signature: string;
    publicKey: string;
    algorithm: string;
    timestamp: string;
}
export interface VaultConfig {
    vaultAddr: string;
    token: string;
    keyName: string;
    namespace?: string;
    mountPath?: string;
}
export interface EvidenceConfig {
    mode: 'local' | 'vault';
    privateKeyPath?: string;
    publicKeyPath?: string;
    vault?: VaultConfig;
    metadata?: Record<string, unknown>;
}
export interface EvidenceRecord {
    id: string;
    requestId: string;
    decision: string;
    context: Record<string, unknown>;
    timestamp: string;
    metadata: Record<string, unknown>;
    signature: string;
    signerPublicKey: string;
    algorithm: string;
    hash: string;
    version: string;
}
export interface VaultClient {
    sign(keyName: string, data: string, options?: Record<string, unknown>): Promise<{
        signature: string;
    }>;
    verify(keyName: string, data: string, signature: string, options?: Record<string, unknown>): Promise<{
        valid: boolean;
    }>;
    read(path: string): Promise<Record<string, unknown>>;
    write(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>>;
}
export type PublicationKey = string;
export type VerificationThreshold = number;
export interface TriplePublicationKeys {
    keys: PublicationKey[];
    threshold: VerificationThreshold;
}
/**
 * Generate a deterministic hash for an evidence record
 */
export declare function hashEvidence(evidence: EvidenceRecord): string;
//# sourceMappingURL=types.d.ts.map