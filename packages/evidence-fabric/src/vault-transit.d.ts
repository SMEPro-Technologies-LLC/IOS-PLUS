import type { AsyncSigner, SignedPayload, VaultClient, VaultConfig } from './types.js';
/**
 * Create a Vault API client for transit operations
 */
export declare function createVaultClient(config: VaultConfig): VaultClient;
/**
 * Vault Transit signer for remote key management
 */
export declare class VaultTransitSigner implements AsyncSigner {
    private client;
    private config;
    constructor(vaultAddr: string, token: string, keyName: string, namespace?: string);
    sign(payload: Record<string, unknown>): Promise<SignedPayload>;
    verify(payload: Record<string, unknown>, signature: string): Promise<boolean>;
    getPublicKey(): Promise<string>;
    rotateKey(): Promise<void>;
    healthCheck(): Promise<boolean>;
}
//# sourceMappingURL=vault-transit.d.ts.map