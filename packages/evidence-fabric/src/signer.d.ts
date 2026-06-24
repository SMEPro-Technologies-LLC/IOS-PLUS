import type { SignedPayload, Signer } from './types.js';
/**
 * Generate a new Ed25519 key pair
 */
export declare function generateKeyPair(): {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
};
/**
 * Encode a Uint8Array key to base64 string
 */
export declare function keyToBase64(key: Uint8Array): string;
/**
 * Decode a base64 string to Uint8Array key
 */
export declare function keyFromBase64(key: string): Uint8Array;
/**
 * Local Ed25519 signer that loads keys from files or generates new ones
 */
export declare class LocalSigner implements Signer {
    private secretKey;
    private publicKey;
    private privateKeyPath;
    private publicKeyPath;
    private archiveDir;
    constructor(privateKeyPath: string, publicKeyPath?: string);
    private loadKeys;
    private generateAndSaveKeys;
    sign(payload: Record<string, unknown>): SignedPayload;
    verify(payload: Record<string, unknown>, signature: string, publicKey?: string): boolean;
    getPublicKey(): string;
    rotateKeys(): void;
}
//# sourceMappingURL=signer.d.ts.map