/**
 * Key Provider system — Decouple key custody from inference execution context
 * SMEPro Technologies — Confidential
 */

export interface KeyProvider {
  /** Get Ed25519 private key bytes for the tenant */
  getSigningKey(tenantId: string): Promise<Uint8Array>;
}

/** Loads key from environment (Default/SaaS Dev) */
export class LocalEnvKeyProvider implements KeyProvider {
  private keyBytes: Uint8Array;
  constructor(privateKeyBase64: string) {
    this.keyBytes = Buffer.from(privateKeyBase64, 'base64');
  }
  async getSigningKey(_tenantId: string): Promise<Uint8Array> {
    return this.keyBytes;
  }
}

/** Loads key from encrypted file path (Lamar On-Premises) */
export class LocalFileKeyProvider implements KeyProvider {
  constructor(private filePath: string) {}
  async getSigningKey(_tenantId: string): Promise<Uint8Array> {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(this.filePath, 'utf8');
    return Buffer.from(content.trim(), 'base64');
  }
}
