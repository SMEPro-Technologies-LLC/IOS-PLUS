import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import nacl from 'tweetnacl';
import type { SignedPayload, Signer } from './types.js';

/**
 * Generate a new Ed25519 key pair
 */
export function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.sign.keyPair();
}

/**
 * Encode a Uint8Array key to base64 string
 */
export function keyToBase64(key: Uint8Array): string {
  return Buffer.from(key).toString('base64');
}

/**
 * Decode a base64 string to Uint8Array key
 */
export function keyFromBase64(key: string): Uint8Array {
  return Buffer.from(key, 'base64');
}

/**
 * Local Ed25519 signer that loads keys from files or generates new ones
 */
export class LocalSigner implements Signer {
  private secretKey: Uint8Array;
  private publicKey: Uint8Array;
  private privateKeyPath: string;
  private publicKeyPath: string;
  private archiveDir: string;

  constructor(privateKeyPath: string, publicKeyPath?: string) {
    this.privateKeyPath = privateKeyPath;
    this.publicKeyPath = publicKeyPath || privateKeyPath + '.pub';
    this.archiveDir = join(dirname(this.privateKeyPath), '.key-archive');

    if (existsSync(this.privateKeyPath) && existsSync(this.publicKeyPath)) {
      this.loadKeys();
    } else {
      this.generateAndSaveKeys();
    }
  }

  private loadKeys(): void {
    try {
      const secretKeyBase64 = readFileSync(this.privateKeyPath, 'utf-8').trim();
      const publicKeyBase64 = readFileSync(this.publicKeyPath, 'utf-8').trim();
      this.secretKey = keyFromBase64(secretKeyBase64);
      this.publicKey = keyFromBase64(publicKeyBase64);

      if (this.secretKey.length !== 64) {
        throw new Error(`Invalid secret key length: expected 64, got ${this.secretKey.length}`);
      }
      if (this.publicKey.length !== 32) {
        throw new Error(`Invalid public key length: expected 32, got ${this.publicKey.length}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load keys: ${message}`);
    }
  }

  private generateAndSaveKeys(): void {
    const keyPair = generateKeyPair();
    this.secretKey = keyPair.secretKey;
    this.publicKey = keyPair.publicKey;

    try {
      const dir = dirname(this.privateKeyPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.privateKeyPath, keyToBase64(this.secretKey), { mode: 0o600 });
      writeFileSync(this.publicKeyPath, keyToBase64(this.publicKey), { mode: 0o644 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to save generated keys: ${message}`);
    }
  }

  sign(payload: Record<string, unknown>): SignedPayload {
    try {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const message = new TextEncoder().encode(canonical);
      const signature = nacl.sign.detached(message, this.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      return {
        payload,
        signature: signatureBase64,
        publicKey: this.getPublicKey(),
        algorithm: 'Ed25519',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Signing failed: ${message}`);
    }
  }

  verify(payload: Record<string, unknown>, signature: string, publicKey?: string): boolean {
    try {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const message = new TextEncoder().encode(canonical);
      const signatureBytes = Buffer.from(signature, 'base64');
      const pubKeyBytes = publicKey ? keyFromBase64(publicKey) : this.publicKey;

      if (pubKeyBytes.length !== 32) {
        throw new Error(`Invalid public key length: expected 32, got ${pubKeyBytes.length}`);
      }
      if (signatureBytes.length !== 64) {
        throw new Error(`Invalid signature length: expected 64, got ${signatureBytes.length}`);
      }

      return nacl.sign.detached.verify(message, signatureBytes, pubKeyBytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Verification failed: ${message}`);
    }
  }

  getPublicKey(): string {
    return keyToBase64(this.publicKey);
  }

  rotateKeys(): void {
    try {
      if (!existsSync(this.archiveDir)) {
        mkdirSync(this.archiveDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivedPrivateKey = join(this.archiveDir, `${timestamp}.key`);
      const archivedPublicKey = join(this.archiveDir, `${timestamp}.key.pub`);

      writeFileSync(archivedPrivateKey, keyToBase64(this.secretKey), { mode: 0o600 });
      writeFileSync(archivedPublicKey, keyToBase64(this.publicKey), { mode: 0o644 });

      const keyPair = generateKeyPair();
      this.secretKey = keyPair.secretKey;
      this.publicKey = keyPair.publicKey;

      writeFileSync(this.privateKeyPath, keyToBase64(this.secretKey), { mode: 0o600 });
      writeFileSync(this.publicKeyPath, keyToBase64(this.publicKey), { mode: 0o644 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Key rotation failed: ${message}`);
    }
  }
}
