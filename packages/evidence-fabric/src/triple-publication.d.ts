import type { PublicationKey, VerificationThreshold } from './types.js';
/**
 * Triple-publication key verification with threshold support
 */
export declare class TriplePublicationVerifier {
    private keys;
    constructor(keys?: PublicationKey[]);
    /**
     * Add a verification key
     */
    addKey(publicKey: PublicationKey): void;
    /**
     * Remove a verification key
     */
    removeKey(publicKey: PublicationKey): void;
    /**
     * Verify a signature against all keys, returning results per key
     */
    verifyAll(payload: Record<string, unknown>, signature: string): boolean[];
    /**
     * Verify with N-of-M threshold
     */
    verifyWithThreshold(payload: Record<string, unknown>, signature: string, threshold: VerificationThreshold): boolean;
    /**
     * Get current key count
     */
    getKeyCount(): number;
    /**
     * Get all registered keys
     */
    getKeys(): PublicationKey[];
}
//# sourceMappingURL=triple-publication.d.ts.map