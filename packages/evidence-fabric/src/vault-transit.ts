import type { AsyncSigner, SignedPayload, VaultClient, VaultConfig } from './types.js';

/**
 * Create a Vault API client for transit operations
 */
export function createVaultClient(config: VaultConfig): VaultClient {
  const baseUrl = config.vaultAddr.replace(/\/$/, '');
  const mountPath = config.mountPath || 'transit';

  async function vaultRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${baseUrl}/v1/${path}`;
    const headers: Record<string, string> = {
      'X-Vault-Token': config.token,
      'Content-Type': 'application/json',
    };

    if (config.namespace) {
      headers['X-Vault-Namespace'] = config.namespace;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vault API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { data?: T };
    return data.data as T;
  }

  return {
    async sign(keyName, data, options = {}) {
      const path = `${mountPath}/sign/${keyName}`;
      const body = { input: data, ...options };
      return vaultRequest<{ signature: string }>('POST', path, body);
    },

    async verify(keyName, data, signature, options = {}) {
      const path = `${mountPath}/verify/${keyName}`;
      const body = { input: data, signature, ...options };
      return vaultRequest<{ valid: boolean }>('POST', path, body);
    },

    async read(path) {
      return vaultRequest<Record<string, unknown>>('GET', path);
    },

    async write(path, data) {
      return vaultRequest<Record<string, unknown>>('POST', path, data);
    },
  };
}

/**
 * Vault Transit signer for remote key management
 */
export class VaultTransitSigner implements AsyncSigner {
  private client: VaultClient;
  private config: VaultConfig;

  constructor(vaultAddr: string, token: string, keyName: string, namespace?: string) {
    this.config = {
      vaultAddr,
      token,
      keyName,
      namespace,
    };
    this.client = createVaultClient(this.config);
  }

  async sign(payload: Record<string, unknown>): Promise<SignedPayload> {
    try {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const input = Buffer.from(canonical, 'utf-8').toString('base64');
      const response = await this.client.sign(this.config.keyName, input, {
        hash_algorithm: 'sha2-256',
      });

      return {
        payload,
        signature: response.signature,
        publicKey: await this.getPublicKey(),
        algorithm: 'Ed25519',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Vault signing failed: ${message}`);
    }
  }

  async verify(payload: Record<string, unknown>, signature: string): Promise<boolean> {
    try {
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const input = Buffer.from(canonical, 'utf-8').toString('base64');
      const response = await this.client.verify(this.config.keyName, input, signature, {
        hash_algorithm: 'sha2-256',
      });
      return response.valid;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Vault verification failed: ${message}`);
    }
  }

  async getPublicKey(): Promise<string> {
    try {
      const mountPath = this.config.mountPath || 'transit';
      const path = `${mountPath}/keys/${this.config.keyName}`;
      const response = await this.client.read(path);
      const keys = response.keys as Record<string, { public_key?: string }>;
      const latestKey = keys[Math.max(...Object.keys(keys).map(Number))];
      if (!latestKey?.public_key) {
        throw new Error('No public key found in Vault response');
      }
      return latestKey.public_key;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to retrieve public key from Vault: ${message}`);
    }
  }

  async rotateKey(): Promise<void> {
    try {
      const mountPath = this.config.mountPath || 'transit';
      const path = `${mountPath}/keys/${this.config.keyName}/rotate`;
      await this.client.write(path, {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Vault key rotation failed: ${message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const baseUrl = this.config.vaultAddr.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/v1/sys/health`, {
        method: 'GET',
        headers: {
          'X-Vault-Token': this.config.token,
        },
      });
      return response.ok || response.status === 429 || response.status === 473;
    } catch {
      return false;
    }
  }
}
