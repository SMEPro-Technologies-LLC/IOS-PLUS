/**
 * Evidence Fabric â€” Cryptographic audit record generation
 *
 * Signing: Ed25519 over JCS canonical serialization (RFC 8785)
 * Key publication: COS+ database + DNS TXT records + deployment filesystem
 *   All three locations must be consistent (verified by key-consistency-check CronJob)
 * Key rotation: 90-day cycle, HSM-backed via HashiCorp Vault transit engine
 * WORM enforcement: PostgreSQL audit_writer role + row-level trigger (DB-layer append-only)
 * Evidence signing overhead: < 12ms (EB Doc 2 Â§3.4)
 *
 * SMEPro Technologies â€” Confidential
 */

import * as ed from '@noble/ed25519';
import { canonicalize } from 'json-canonicalize';
import { v4 as uuidv7 } from 'uuid';
import type {
  EvidencePackage, EvidencePackagePayload, SigningKeyRecord
} from '@ios-plus/shared';
import type { CosConnectionRegistry } from '@ios-plus/cos-plus';
import { KeyProvider } from './keyProvider.js';

export * from './keyProvider.js';

export interface VaultTransitConfig {
  /** HashiCorp Vault address */
  vaultAddr: string;
  /** Vault transit key path, e.g. "transit/keys/ios-evidence-signing" */
  keyPath: string;
  /** Vault token (injected from K8s Vault Agent sidecar) */
  token: string;
}

export interface EvidenceFabricConfig {
  vault: VaultTransitConfig;
  /** Path to current public key on deployment filesystem (triple-publication) */
  publicKeyFilesystemPath: string;
  /** DNS zone for TXT record publication, e.g. "_ios-signing-key.smeprotech.com" */
  dnsTxtZone: string;
  /** Current active key ID from COS+ ios_signing_keys table */
  activeKeyId: string;
}

/**
 * Canonicalize payload using JCS (JSON Canonicalization Scheme, RFC 8785)
 * then sign with Ed25519 private key bytes.
 * Returns base64url-encoded signature.
 */
async function signPayload(
  payload: EvidencePackagePayload,
  privateKeyBytes: Uint8Array
): Promise<string> {
  const canonical = (canonicalize as unknown as (v: unknown) => string)(payload as unknown as Record<string, unknown>);
  const msgBytes = new TextEncoder().encode(canonical);
  const sigBytes = await ed.signAsync(msgBytes, privateKeyBytes);
  return Buffer.from(sigBytes).toString('base64url');
}

/** Verify an evidence package signature â€” public verification path */
export async function verifyEvidencePackage(
  pkg: EvidencePackage,
  publicKeyBase64url: string
): Promise<boolean> {
  const pubKeyBytes = Buffer.from(publicKeyBase64url, 'base64url');
  const canonical = (canonicalize as unknown as (v: unknown) => string)(pkg.payload as unknown as Record<string, unknown>);
  const msgBytes = new TextEncoder().encode(canonical);
  const sigBytes = Buffer.from(pkg.signature, 'base64url');
  return ed.verifyAsync(sigBytes, msgBytes, pubKeyBytes);
}

export class EvidenceFabricService {
  private config: EvidenceFabricConfig;
  private registry: CosConnectionRegistry;
  private keyProvider: KeyProvider;

  constructor(
    config: EvidenceFabricConfig,
    registry: CosConnectionRegistry,
    keyProvider: KeyProvider
  ) {
    this.config = config;
    this.registry = registry;
    this.keyProvider = keyProvider;
  }

  private async signPayloadWithCustody(payload: EvidencePackagePayload): Promise<string> {
    if (this.config.vault && this.config.vault.vaultAddr && this.config.vault.token) {
      // HSM-backed transit signing: key is never loaded into application memory.
      return await this.signWithVault(payload);
    }
    // Fallback/Local development mode:
    const privateKeyBytes = await this.keyProvider.getSigningKey(payload.tenantId);
    return await signPayload(payload, privateKeyBytes);
  }

  private async signWithVault(payload: EvidencePackagePayload): Promise<string> {
    const canonical = (canonicalize as unknown as (v: unknown) => string)(payload as unknown as Record<string, unknown>);
    const base64Input = Buffer.from(canonical).toString('base64');
    
    const { vaultAddr, keyPath, token } = this.config.vault;
    const parts = keyPath.split('/');
    const mount = parts[0] || 'transit';
    const keyName = parts[parts.length - 1];
    
    const url = `${vaultAddr}/v1/${mount}/sign/${keyName}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Vault-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: base64Input,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vault sign request failed with status ${response.status}: ${errorText}`);
    }
    
    const resData = await response.json() as any;
    const vaultSignature = resData?.data?.signature;
    if (!vaultSignature || typeof vaultSignature !== 'string') {
      throw new Error(`Invalid response from Vault sign: ${JSON.stringify(resData)}`);
    }
    
    const signatureBase64 = vaultSignature.split(':').pop() || '';
    // Convert standard base64 to base64url
    return signatureBase64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  /**
   * Create, sign, and WORM-commit an evidence package.
   * Called at L4 (Evidence Anchoring) and L5 (Gate 530 gate decisions).
   */
  async createAndCommit(
    payload: Omit<EvidencePackagePayload, 'eventId'>
  ): Promise<EvidencePackage> {
    const fullPayload: EvidencePackagePayload = {
      ...payload,
      eventId: uuidv7(),
    };

    const signature = await this.signPayloadWithCustody(fullPayload);

    const pkg: EvidencePackage = {
      packageId: uuidv7(),
      payload: fullPayload,
      signature,
      verificationKeyId: this.config.activeKeyId,
      signingAlgorithm: 'Ed25519',
      canonicalizationAlgorithm: 'JCS/RFC8785',
      publishedAt: new Date().toISOString(),
    };

    // WORM commit via audit_writer role (insert-only role; DB trigger blocks UPDATE/DELETE)
    const pool = this.registry.pool('audit_writer');
    await pool.query(
      `INSERT INTO evidence_packages
         (package_id, tenant_id, session_id, event_type, layer_depth,
          canonical_payload, signature, verification_key_id, signing_algorithm,
          canonicalization_algorithm, classification_level, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        pkg.packageId,
        fullPayload.tenantId,
        fullPayload.sessionId,
        fullPayload.eventType,
        fullPayload.layerDepth,
        JSON.stringify(fullPayload),
        signature,
        pkg.verificationKeyId,
        pkg.signingAlgorithm,
        pkg.canonicalizationAlgorithm,
        fullPayload.classificationLevel,
        pkg.publishedAt,
      ]
    );

    return pkg;
  }

  /**
   * Publish Merkle root over a batch of evidence packages.
   * Called by the merkle-root-publisher CronJob.
   */
  async publishMerkleRoot(
    packageIds: string[],
    merkleRoot: string
  ): Promise<void> {
    const pool = this.registry.pool('audit_writer');
    const batchId = uuidv7();
    await pool.query(
      `INSERT INTO merkle_roots (merkle_root_id, batch_package_ids, merkle_root, computed_at)
       VALUES ($1, $2, $3, $4)`,
      [batchId, JSON.stringify(packageIds), merkleRoot, new Date().toISOString()]
    );
  }

  async commitQuarantineRecord(record: {
    quarantineId: string;
    sessionId: string;
    tenantId: string;
    ucoNodeId: string;
    reason: string;
    policyAction: string;
    evidenceId: string;
  }): Promise<void> {
    const pool = this.registry.pool('audit_writer');
    await pool.query(
      `INSERT INTO quarantine_records
         (quarantine_id, session_id, tenant_id, uco_node_id, reason, policy_action, evidence_id, quarantined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        record.quarantineId,
        record.sessionId,
        record.tenantId,
        record.ucoNodeId,
        record.reason,
        record.policyAction,
        record.evidenceId
      ]
    );
  }

  async getQuarantineQueue(tenantId: string): Promise<any[]> {
    const pool = this.registry.pool('audit_reader');
    const { rows } = await pool.query(
      `SELECT * FROM quarantine_records WHERE tenant_id = $1 AND released_at IS NULL ORDER BY quarantined_at DESC`,
      [tenantId]
    );
    return rows;
  }

  async getQuarantineRecord(quarantineId: string, tenantId: string): Promise<any | null> {
    const pool = this.registry.pool('audit_reader');
    const { rows } = await pool.query(
      `SELECT * FROM quarantine_records WHERE quarantine_id = $1 AND tenant_id = $2`,
      [quarantineId, tenantId]
    );
    return rows[0] || null;
  }
}

export { verifyEvidencePackage as verify };
export type { EvidencePackage, EvidencePackagePayload, SigningKeyRecord } from '@ios-plus/shared';

