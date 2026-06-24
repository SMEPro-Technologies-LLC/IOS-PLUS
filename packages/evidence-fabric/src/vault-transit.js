/**
 * Create a Vault API client for transit operations
 */
export function createVaultClient(config) {
    const baseUrl = config.vaultAddr.replace(/\/$/, '');
    const mountPath = config.mountPath || 'transit';
    async function vaultRequest(method, path, body) {
        const url = `${baseUrl}/v1/${path}`;
        const headers = {
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
        const data = (await response.json());
        return data.data;
    }
    return {
        async sign(keyName, data, options = {}) {
            const path = `${mountPath}/sign/${keyName}`;
            const body = { input: data, ...options };
            return vaultRequest('POST', path, body);
        },
        async verify(keyName, data, signature, options = {}) {
            const path = `${mountPath}/verify/${keyName}`;
            const body = { input: data, signature, ...options };
            return vaultRequest('POST', path, body);
        },
        async read(path) {
            return vaultRequest('GET', path);
        },
        async write(path, data) {
            return vaultRequest('POST', path, data);
        },
    };
}
/**
 * Vault Transit signer for remote key management
 */
export class VaultTransitSigner {
    client;
    config;
    constructor(vaultAddr, token, keyName, namespace) {
        this.config = {
            vaultAddr,
            token,
            keyName,
            namespace,
        };
        this.client = createVaultClient(this.config);
    }
    async sign(payload) {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Vault signing failed: ${message}`);
        }
    }
    async verify(payload, signature) {
        try {
            const canonical = JSON.stringify(payload, Object.keys(payload).sort());
            const input = Buffer.from(canonical, 'utf-8').toString('base64');
            const response = await this.client.verify(this.config.keyName, input, signature, {
                hash_algorithm: 'sha2-256',
            });
            return response.valid;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Vault verification failed: ${message}`);
        }
    }
    async getPublicKey() {
        try {
            const mountPath = this.config.mountPath || 'transit';
            const path = `${mountPath}/keys/${this.config.keyName}`;
            const response = await this.client.read(path);
            const keys = response.keys;
            const latestKey = keys[Math.max(...Object.keys(keys).map(Number))];
            if (!latestKey?.public_key) {
                throw new Error('No public key found in Vault response');
            }
            return latestKey.public_key;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to retrieve public key from Vault: ${message}`);
        }
    }
    async rotateKey() {
        try {
            const mountPath = this.config.mountPath || 'transit';
            const path = `${mountPath}/keys/${this.config.keyName}/rotate`;
            await this.client.write(path, {});
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Vault key rotation failed: ${message}`);
        }
    }
    async healthCheck() {
        try {
            const baseUrl = this.config.vaultAddr.replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/v1/sys/health`, {
                method: 'GET',
                headers: {
                    'X-Vault-Token': this.config.token,
                },
            });
            return response.ok || response.status === 429 || response.status === 473;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=vault-transit.js.map