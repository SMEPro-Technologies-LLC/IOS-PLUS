/**
 * Wave 1 MVP — Integration Tests for Gate530ApiServer
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { Gate530ApiServer } from '../api-server.js';
import { ApiDatabase } from '../api-db.js';
import { ApiAuth } from '../api-auth.js';
import { getApiServerConfig } from '../api-config.js';
import type { ApiServerConfig } from '../api-config.js';
import { SignJWT } from 'jose';

// Use a test database config — these tests expect a running PostgreSQL or use a mock
// For Wave 1, we run against a real local PostgreSQL started via docker-compose.mvp.yml
const TEST_CONFIG: ApiServerConfig = {
  ...getApiServerConfig({
    PORT: '3999',
    HOST: '127.0.0.1',
    DATABASE_URL: 'postgresql://iosplus:iosplus@localhost:5432/iosplus',
    JWT_SECRET: 'test-secret-key-for-wave1-mvp-tests-only',
    JWT_ISSUER: 'ios-plus-test',
    EVIDENCE_PRIVATE_KEY_PATH: '/tmp/test-evidence.key',
  }),
};

describe('Gate530ApiServer Integration', () => {
  let db: ApiDatabase;
  let auth: ApiAuth;
  let server: Gate530ApiServer;
  let baseUrl: string;

  beforeAll(async () => {
    db = new ApiDatabase(TEST_CONFIG.database);
    await db.connect();
    auth = new ApiAuth(TEST_CONFIG.jwt);
    server = new Gate530ApiServer(TEST_CONFIG, db, auth);
    await new Promise<void>((resolve) => server.listen(resolve));
    baseUrl = `http://${TEST_CONFIG.host}:${TEST_CONFIG.port}`;
  });

  afterAll(async () => {
    await server.close();
    await db.disconnect();
  });

  beforeEach(async () => {
    // Clean up test evidence between runs (not WORM-protected in test schema, or we skip cleanup)
  });

  async function fetchJson(path: string, options?: RequestInit): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, options);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  async function makeToken(actorId: string, type: 'user' | 'admin' = 'user'): Promise<string> {
    const secret = new TextEncoder().encode(TEST_CONFIG.jwt.secret!);
    return new SignJWT({ sub: actorId, type, permissions: ['gate530:evaluate'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(TEST_CONFIG.jwt.issuer)
      .setExpirationTime('1h')
      .sign(secret);
  }

  describe('Health endpoints', () => {
    it('GET /health returns 200', async () => {
      const { status, body } = await fetchJson('/health') as { status: number; body: Record<string, unknown> };
      expect(status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body).toHaveProperty('uptime');
    });

    it('GET /ready returns 200 when DB is healthy', async () => {
      const { status, body } = await fetchJson('/ready') as { status: number; body: Record<string, unknown> };
      expect(status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.checks).toHaveProperty('database');
    });
  });

  describe('Authentication', () => {
    it('POST /v1/evaluate without auth returns 401', async () => {
      const { status } = await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: 'test-1', action: 'access', resource: { classification: 'public' } }),
      }) as { status: number };
      expect(status).toBe(401);
    });

    it('POST /v1/evaluate with valid JWT returns 200', async () => {
      const token = await makeToken('user-1');
      const { status, body } = await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: 'test-2', action: 'access', resource: { classification: 'public' } }),
      }) as { status: number; body: Record<string, unknown> };
      expect(status).toBe(200);
      expect(body).toHaveProperty('decision');
      expect(body).toHaveProperty('evidence');
    });

    it('POST /v1/evaluate with invalid JWT returns 401', async () => {
      const { status } = await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-token' },
        body: JSON.stringify({ requestId: 'test-3', action: 'access' }),
      }) as { status: number };
      expect(status).toBe(401);
    });
  });

  describe('Evaluation', () => {
    it('should allow public resource access', async () => {
      const token = await makeToken('user-1');
      const { body } = await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          requestId: 'test-allow',
          action: 'access',
          resource: { classification: 'public' },
          sector: 'general',
        }),
      }) as { body: Record<string, unknown> };
      const decision = body.decision as Record<string, unknown>;
      expect(decision.action).toBe('allow');
      expect(body).toHaveProperty('evidence');
      expect(body).toHaveProperty('evalDurationMs');
    });

    it('should deny PII access', async () => {
      const token = await makeToken('user-1');
      const { body } = await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          requestId: 'test-deny',
          action: 'access',
          resource: { classification: 'pii' },
          sector: 'general',
        }),
      }) as { body: Record<string, unknown> };
      const decision = body.decision as Record<string, unknown>;
      expect(decision.action).toBe('deny');
    });
  });

  describe('Evidence retrieval', () => {
    it('should retrieve evidence by request ID', async () => {
      const token = await makeToken('user-1');
      const requestId = 'test-evidence-' + Date.now();
      await fetchJson('/v1/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, action: 'access', resource: { classification: 'public' } }),
      });

      const { status, body } = await fetchJson(`/v1/evidence/${requestId}`) as { status: number; body: Record<string, unknown> };
      expect(status).toBe(200);
      expect(body).toHaveProperty('decision');
      expect(body).toHaveProperty('signature');
      expect(body).toHaveProperty('publicKey');
    });

    it('should return 404 for unknown evidence', async () => {
      const { status } = await fetchJson('/v1/evidence/unknown-id') as { status: number };
      expect(status).toBe(404);
    });
  });

  describe('Metrics', () => {
    it('GET /metrics returns Prometheus format', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('http_requests_total');
      expect(text).toContain('active_connections');
    });
  });

  describe('Admin endpoints', () => {
    it('POST /admin/rules requires admin role', async () => {
      const token = await makeToken('user-1');
      const { status } = await fetchJson('/admin/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: 'new-rule', name: 'New Rule', dimension: 'security', action: 'deny', priority: 50 }),
      }) as { status: number };
      expect(status).toBe(403);
    });

    it('POST /admin/rules with admin role creates rule', async () => {
      const token = await makeToken('admin-1', 'admin');
      const { status, body } = await fetchJson('/admin/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: 'admin-test-rule',
          name: 'Admin Test Rule',
          dimension: 'security',
          action: 'deny',
          priority: 99,
          condition: { operator: 'eq', field: 'action', value: 'admin-delete' },
        }),
      }) as { status: number; body: Record<string, unknown> };
      expect(status).toBe(201);
      expect(body.id).toBe('admin-test-rule');
    });
  });
});
