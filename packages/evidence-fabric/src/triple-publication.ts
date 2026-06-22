import { keyFromBase64 } from './signer.js';
import nacl from 'tweetnacl';
import type { PublicationKey, VerificationThreshold } from './types.js';

/**
 * Triple-publication key verification with threshold support
 */
export class TriplePublicationVerifier {
  private keys: PublicationKey[];

  constructor(keys: PublicationKey[] = []) {
    this.keys = [...keys];
  }

  /**
   * Add a verification key
   */
  addKey(publicKey: PublicationKey): void {
    if (!this.keys.includes(publicKey)) {
      this.keys.push(publicKey);
    }
  }

  /**
   * Remove a verification key
   */
  removeKey(publicKey: PublicationKey): void {
    const index = this.keys.indexOf(publicKey);
    if (index !== -1) {
      this.keys.splice(index, 1);
    }
  }

  /**
   * Verify a signature against all keys, returning results per key
   */
  verifyAll(payload: Record<string, unknown>, signature: string): boolean[] {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    const message = new TextEncoder().encode(canonical);
    const signatureBytes = Buffer.from(signature, 'base64');

    return this.keys.map((key) => {
      try {
        const pubKeyBytes = keyFromBase64(key);
        let actualPublicKey: Uint8Array;
        if (pubKeyBytes.length === 32) {
          actualPublicKey = pubKeyBytes;
        } else if (pubKeyBytes.length === 64) {
          actualPublicKey = pubKeyBytes.subarray(32, 64);
        } else {
          throw new Error(`Invalid key length: expected 32 or 64, got ${pubKeyBytes.length}`);
        }
        return nacl.sign.detached.verify(message, signatureBytes, actualPublicKey);
      } catch {
        return false;
      }
    });
  }

  /**
   * Verify with N-of-M threshold
   */
  verifyWithThreshold(
    payload: Record<string, unknown>,
    signature: string,
    threshold: VerificationThreshold
  ): boolean {
    if (threshold <= 0) {
      throw new Error('Threshold must be greater than 0');
    }
    if (this.keys.length === 0) {
      throw new Error('No verification keys configured');
    }
    if (threshold > this.keys.length) {
      throw new Error(`Threshold (${threshold}) exceeds key count (${this.keys.length})`);
    }

    const results = this.verifyAll(payload, signature);
    const validCount = results.filter(Boolean).length;
    return validCount >= threshold;
  }

  /**
   * Get current key count
   */
  getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Get all registered keys
   */
  getKeys(): PublicationKey[] {
    return [...this.keys];
  }
}
