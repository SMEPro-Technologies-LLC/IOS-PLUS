/**
 * Authentication Layer (Layer 1)
 * Verifies JWT / API keys, extracts actor identity, validates permissions
 * @module layers/auth
 */

import { type AuthLayerConfig, type AuthResult, type Actor, type AiRequest } from '../config.js';

export interface TokenPayload {
  sub: string;
  type: 'user' | 'service' | 'admin';
  permissions: string[];
  tenantId?: string;
  iat: number;
  exp: number;
  iss: string;
}

export class AuthLayer {
  private readonly config: AuthLayerConfig;
  private readonly adminTokens: Map<string, { actorId: string; expiresAt: number }> = new Map();

  constructor(config: AuthLayerConfig) {
    this.config = config;
  }

  /**
   * Authenticate an incoming request by JWT or API key
   */
  async authenticate(request: AiRequest): Promise<AuthResult> {
    if (request.token) {
      return this.verifyJwt(request.token);
    }
    if (request.apiKey) {
      return this.verifyApiKey(request.apiKey);
    }
    return {
      authenticated: false,
      actor: { id: 'anonymous', type: 'user', permissions: [] },
      method: 'jwt',
      permissions: [],
    };
  }

  /**
   * Extract actor identity from request (alias for authenticate)
   */
  extractActor(request: AiRequest): Actor {
    if (request.actorId) {
      return {
        id: request.actorId,
        type: 'user',
        permissions: [],
      };
    }
    throw new Error('No actor identifier present in request');
  }

  /**
   * Check if actor has permission to perform an action
   */
  validatePermissions(actor: Actor, action: string): boolean {
    if (actor.type === 'admin') return true;
    const required = action.split(':');
    const resource = required[0];
    const verb = required[1] || 'read';
    return actor.permissions.some((p) => {
      const parts = p.split(':');
      return (parts[0] === '*' || parts[0] === resource) && (parts[1] === '*' || parts[1] === verb);
    });
  }

  /**
   * Issue an admin token for rule-management endpoints
   */
  createAuthToken(actor: Actor, expiry: number): string {
    const token = this.generateRandomToken(64);
    const expiresAt = Date.now() + expiry;
    this.adminTokens.set(token, { actorId: actor.id, expiresAt });
    return token;
  }

  /**
   * Verify an admin token for rule-management endpoints
   */
  verifyAdminToken(token: string): boolean {
    const record = this.adminTokens.get(token);
    if (!record) return false;
    if (Date.now() > record.expiresAt) {
      this.adminTokens.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Decorator / utility to require admin auth on a handler
   */
  requireAdmin(handler: (req: unknown, res: unknown) => Promise<void>): (req: unknown, res: unknown) => Promise<void> {
    return async (req: unknown, res: unknown) => {
      const request = req as { headers?: Record<string, string> };
      const authHeader = request.headers?.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!this.verifyAdminToken(token)) {
        const response = res as { statusCode: number; end: (body: string) => void };
        response.statusCode = 403;
        response.end(JSON.stringify({ error: 'Admin access required' }));
        return;
      }
      return handler(req, res);
    };
  }

  private async verifyJwt(token: string): Promise<AuthResult> {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString()) as TokenPayload;
      if (payload.iss !== this.config.jwtIssuer) {
        throw new Error('Invalid issuer');
      }
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        throw new Error('Token expired');
      }
      const actor: Actor = {
        id: payload.sub,
        type: payload.type,
        permissions: payload.permissions || [],
        tenantId: payload.tenantId,
      };
      return {
        authenticated: true,
        actor,
        method: 'jwt',
        permissions: actor.permissions,
        expiresAt: payload.exp * 1000,
      };
    } catch (err) {
      return {
        authenticated: false,
        actor: { id: 'anonymous', type: 'user', permissions: [] },
        method: 'jwt',
        permissions: [],
        metadata: { error: (err as Error).message },
      };
    }
  }

  private async verifyApiKey(apiKey: string): Promise<AuthResult> {
    const record = this.config.apiKeyStore.get(apiKey);
    if (!record) {
      return {
        authenticated: false,
        actor: { id: 'anonymous', type: 'service', permissions: [] },
        method: 'apiKey',
        permissions: [],
      };
    }
    const actor: Actor = {
      id: record.actorId,
      type: 'service',
      permissions: record.permissions,
      tenantId: record.tenantId,
    };
    return {
      authenticated: true,
      actor,
      method: 'apiKey',
      permissions: record.permissions,
    };
  }

  private generateRandomToken(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_$';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
