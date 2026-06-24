import { createVaultClient } from './vault-transit.js';
import { EvidenceBuilder } from './evidence.js';
import type { Signer, AsyncSigner, EvidenceConfig } from './types.js';
/**
 * Create a signer based on evidence configuration
 */
export declare function createSigner(config: EvidenceConfig): Signer | AsyncSigner;
/**
 * Create an evidence builder based on evidence configuration
 */
export declare function createEvidenceBuilder(config: EvidenceConfig): EvidenceBuilder;
export { createVaultClient };
//# sourceMappingURL=factory.d.ts.map