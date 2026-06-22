/**
 * Wave 1 MVP — JWT Authentication
 * Verifies JWT signatures using jose (HS256 or RS256/ES256 via JWKS)
 * @module api-auth
 */

import { jwtVerify, createRemoteJWKSet, JWTVerifyOptions } from 'jose';
import type { JwtConfig } from './api-config.js';

export interface AuthResult {
  authenticated: boolean;
  actor: {
    id: string;
    type: 'user' | 'service' | 'admin';
    permissions: string[];
    tenantId?: string;
  };
  method: 'jwt' | 'apiKey' | 'none';
  permissions: string[];
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export class ApiAuth {
  private config: JwtConfig;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: JwtConfig) {
    this.config = config;
    if (config.jwksUri) {
      this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
    }
  }

  async verifyJwt(token: string): Promise<AuthResult> {
    try {
      const options: JWTVerifyOptions = {
        issuer: this.config.issuer,
        clockTolerance: this.config.clockToleranceSeconds,
      };
      if (this.config.audience) {
        options.audience = this.config.audience;
      }

      let payload;
      if (this.jwks) {
        const { payload: p } = await jwtVerify(token, this.jwks, options);
        payload = p;
      } else if (this.config.secret) {
        const secret = new TextEncoder().encode(this.config.secret);
        const { payload: p } = await jwtVerify(token, secret, options);
        payload = p;
      } else {
        return {
          authenticated: false,
          actor: { id: 'anonymous', type: 'user', permissions: [] },
          method: 'jwt',
          permissions: [],
          metadata: { error: 'No JWT secret or JWKS URI configured' },
        };
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = payload.exp;
      if (exp && exp < now) {
        return {
          authenticated: false,
          actor: { id: 'anonymous', type: 'user', permissions: [] },
          method: 'jwt',
          permissions: [],
          metadata: { error: 'Token expired' },
        };
      }

      const actor = {
        id: String(payload.sub ?? 'unknown'),
        type: (payload.type as 'user' | 'service' | 'admin') ?? 'user',
        permissions: Array.isArray(payload.permissions) ? (payload.permissions as string[]) : [],
        tenantId: payload.tenantId ? String(payload.tenantId) : undefined,
      };

      return {
        authenticated: true,
        actor,
        method: 'jwt',
        permissions: actor.permissions,
        expiresAt: exp ? exp * 1000 : undefined,
      };
    } catch (err) {
      return {
        authenticated: false,
        actor: { id: 'anonymous', type: 'user', permissions: [] },
        method: 'jwt',
        permissions: [],
        metadata: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  async verifyApiKey(apiKey: string, apiKeyStore: Map<string, { actorId: string; permissions: string[]; tenantId?: string }>): Promise<AuthResult> {
    const record = apiKeyStore.get(apiKey);
    if (!record) {
      return {
        authenticated: false,
        actor: { id: 'anonymous', type: 'service', permissions: [] },
        method: 'apiKey',
        permissions: [],
      };
    }

    const actor = {
      id: record.actorId,
      type: 'service' as const,
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

  validatePermissions(actor: AuthResult['actor'], action: string): boolean {
    if (actor.type === 'admin') return true;
    const [resource, verb = 'read'] = action.split(':');
    return actor.permissions.some((p) => {
      const [pResource, pVerb = 'read'] = p.split(':');
      return (pResource === '*' || pResource === resource) && (pVerb === '*' || pVerb === verb);
    });
  }
}
