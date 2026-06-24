import { LocalSigner } from './signer.js';
import { VaultTransitSigner, createVaultClient } from './vault-transit.js';
import { EvidenceBuilder } from './evidence.js';
/**
 * Create a signer based on evidence configuration
 */
export function createSigner(config) {
    if (config.mode === 'vault') {
        if (!config.vault) {
            throw new Error('Vault configuration is required when mode is "vault"');
        }
        return new VaultTransitSigner(config.vault.vaultAddr, config.vault.token, config.vault.keyName, config.vault.namespace);
    }
    if (config.mode === 'local') {
        if (!config.privateKeyPath) {
            throw new Error('privateKeyPath is required when mode is "local"');
        }
        return new LocalSigner(config.privateKeyPath, config.publicKeyPath);
    }
    throw new Error(`Unknown signer mode: ${config.mode}`);
}
/**
 * Create an evidence builder based on evidence configuration
 */
export function createEvidenceBuilder(config) {
    const signer = createSigner(config);
    const builder = new EvidenceBuilder(signer);
    if (config.metadata) {
        builder.setMetadata(config.metadata);
    }
    return builder;
}
export { createVaultClient };
//# sourceMappingURL=factory.js.map