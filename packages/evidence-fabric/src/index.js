// Evidence Fabric - Cryptographic Audit Evidence System
// IOS+ Platform
export { LocalSigner, generateKeyPair, keyToBase64, keyFromBase64, } from './signer.js';
export { canonicalize, canonicalizeBuffer, canonicalizeOrdered, verifyCanonicalization, JcsCanonicalizer, } from './jcs.js';
export { VaultTransitSigner, createVaultClient, } from './vault-transit.js';
export { EvidenceBuilder, createEvidenceHash, verifyEvidence, verifyEvidenceAsync, } from './evidence.js';
export { TriplePublicationVerifier, } from './triple-publication.js';
export { createSigner, createEvidenceBuilder, createVaultClient as createVaultClientFactory, } from './factory.js';
//# sourceMappingURL=index.js.map