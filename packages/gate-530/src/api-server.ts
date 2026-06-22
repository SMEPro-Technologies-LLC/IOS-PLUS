/**
 * Wave 1 MVP — HTTP/1.1 API Server
 * Pure Node.js server wrapping Gate530Engine with real endpoints
 * @module api-server
 */

import http from 'node:http';
import { URL } from 'node:url';
import type { ApiServerConfig } from './api-config.js';
import type { ApiDatabase } from './api-db.js';
import type { ApiAuth, AuthResult } from './api-auth.js';
import { Gate530Engine, type ComplianceDecision, type EvaluationContext } from './engine.js';
import { SectorRegistry } from './sector.js';
import { LocalSigner } from '@ios-plus/evidence-fabric';
import type { PolicyRule } from './config.js';

export interface ServerRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  ip: string;
}

export type RouteHandler = (req: ServerRequest, res: http.ServerResponse) => Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  requiresAuth: boolean;
  requiresAdmin: boolean;
}

export class Gate530ApiServer {
  private readonly server: http.Server;
  private readonly config: ApiServerConfig;
  private readonly db: ApiDatabase;
  private readonly auth: ApiAuth;
  private readonly engine: Gate530Engine;
  private readonly signer: LocalSigner;
  private readonly routes: Route[] = [];
  private readonly metrics = {
    requestsTotal: 0,
    requestsByStatus: new Map<number, number>(),
    requestDurationMs: [] as number[],
    activeConnections: 0,
  };
  private readonly rateLimitStore = new Map<string, { count: number; resetAt: number }>();
  private readonly apiKeyStore = new Map<string, { actorId: string; permissions: string[]; tenantId?: string }>();

  constructor(config: ApiServerConfig, db: ApiDatabase, auth: ApiAuth) {
    this.config = config;
    this.db = db;
    this.auth = auth;
    this.engine = this.buildEngine();
    this.signer = new LocalSigner(config.evidence.privateKeyPath, config.evidence.publicKeyPath);
    this.setupRoutes();
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  listen(callback?: () => void): void {
    this.server.listen(this.config.port, this.config.host, callback);
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private buildEngine(): Gate530Engine {
    const rules: PolicyRule[] = [
      {
        id: 'rule-default-deny-pii',
        name: 'Deny PII access without authorization',
        dimension: 'data_privacy',
        priority: 100,
        condition: {
          operator: 'and',
          conditions: [
            { operator: 'eq', field: 'resource.classification', value: 'pii' },
            { operator: 'eq', field: 'action', value: 'access' },
          ],
        },
        action: 'deny',
        enabled: true,
        description: 'Default deny for PII access',
      },
      {
        id: 'rule-allow-public',
        name: 'Allow public non-sensitive resources',
        dimension: 'operational',
        priority: 10,
        condition: {
          operator: 'eq',
          field: 'resource.classification',
          value: 'public',
        },
        action: 'allow',
        enabled: true,
        description: 'Allow access to public resources',
      },
    ];

    return new Gate530Engine({
      rules,
      failClosed: true,
    });
  }

  private setupRoutes(): void {
    this.addRoute('POST', '/v1/evaluate', this.handleEvaluate, true);
    this.addRoute('GET', '/v1/evidence/:requestId', this.handleGetEvidence, false);
    this.addRoute('GET', '/health', this.handleHealth, false);
    this.addRoute('GET', '/ready', this.handleReady, false);
    this.addRoute('GET', '/metrics', this.handleMetrics, false);
    this.addRoute('POST', '/admin/rules', this.handleCreateRule, true, true);
    this.addRoute('DELETE', '/admin/rules/:id', this.handleDeleteRule, true, true);
    this.addRoute('GET', '/admin/audit', this.handleAdminAudit, true, true);
  }

  private addRoute(
    method: string,
    path: string,
    handler: RouteHandler,
    requiresAuth = false,
    requiresAdmin = false
  ): void {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      '^' +
        path
          .split('/')
          .map((segment) => {
            if (segment.startsWith(':')) {
              paramNames.push(segment.slice(1));
              return '([^/]+)';
            }
            return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('\\/') +
        '$'
    );
    this.routes.push({ method, pattern, paramNames, handler: handler.bind(this), requiresAuth, requiresAdmin });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.metrics.requestsTotal++;
    this.metrics.activeConnections++;
    const startTime = Date.now();

    const url = req.url || '/';
    const parsed = new URL(url, `http://${req.headers.host || 'localhost'}`);
    const query: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const serverReq: ServerRequest = {
      method: req.method || 'GET',
      url: parsed.pathname,
      headers: req.headers,
      body: {},
      params: {},
      query,
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || '127.0.0.1',
    };

    // Parse body
    if (['POST', 'PUT', 'PATCH'].includes(serverReq.method)) {
      try {
        serverReq.body = await this.parseBody(req, this.config.maxRequestBodySize);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid request body', details: (err as Error).message }));
        this.recordMetrics(400, startTime);
        this.metrics.activeConnections--;
        return;
      }
    }

    // Find route
    const route = this.routes.find(
      (r) => r.method === serverReq.method && r.pattern.test(parsed.pathname)
    );

    if (!route) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
      this.recordMetrics(404, startTime);
      this.metrics.activeConnections--;
      return;
    }

    // Extract params
    const match = parsed.pathname.match(route.pattern);
    if (match) {
      route.paramNames.forEach((name, index) => {
        serverReq.params[name] = match[index + 1];
      });
    }

    // CORS
    const origin = req.headers.origin || '*';
    if (this.config.corsOrigins.includes('*') || this.config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (serverReq.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      this.metrics.activeConnections--;
      return;
    }

    // Rate limiting
    if (!await this.checkRateLimit(serverReq, res, route.requiresAdmin)) {
      this.metrics.activeConnections--;
      return;
    }

    // Authentication
    let authResult: AuthResult | undefined;
    if (route.requiresAuth || route.requiresAdmin) {
      authResult = await this.authenticate(serverReq);
      if (!authResult.authenticated) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Authentication required' }));
        this.recordMetrics(401, startTime);
        this.metrics.activeConnections--;
        return;
      }
      if (route.requiresAdmin && authResult.actor.type !== 'admin') {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Admin access required' }));
        this.recordMetrics(403, startTime);
        this.metrics.activeConnections--;
        return;
      }
    }

    // Execute handler
    try {
      await route.handler(serverReq, res);
    } catch (err) {
      console.error(`[ERROR] ${serverReq.method} ${serverReq.url}:`, (err as Error).message);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error', decision: 'DENY' }));
    }

    this.recordMetrics(res.statusCode || 200, startTime);
    this.metrics.activeConnections--;
  }

  private async parseBody(req: http.IncomingMessage, maxSize: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          reject(new Error('Request body too large'));
          req.destroy();
          return;
        }
        body += chunk.toString('utf-8');
      });
      req.on('end', () => {
        try {
          if (!body) return resolve({});
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('Request body timeout')), 5000);
    });
  }

  private async checkRateLimit(req: ServerRequest, res: http.ServerResponse, isAdmin: boolean): Promise<boolean> {
    const window = isAdmin ? this.config.adminRateLimitWindowMs : this.config.rateLimitWindowMs;
    const max = isAdmin ? this.config.adminRateLimitMaxRequests : this.config.rateLimitMaxRequests;
    const key = req.ip;
    const now = Date.now();
    let entry = this.rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + window };
    }
    entry.count++;
    this.rateLimitStore.set(key, entry);
    res.setHeader('X-RateLimit-Limit', max.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - entry.count).toString());
    res.setHeader('X-RateLimit-Reset', entry.resetAt.toString());
    if (entry.count > max) {
      res.statusCode = 429;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return false;
    }
    return true;
  }

  private async authenticate(req: ServerRequest): Promise<AuthResult> {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (token) {
      return this.auth.verifyJwt(token);
    }
    const apiKey = (req.headers['x-api-key'] as string) || '';
    if (apiKey) {
      return this.auth.verifyApiKey(apiKey, this.apiKeyStore);
    }
    return {
      authenticated: false,
      actor: { id: 'anonymous', type: 'user', permissions: [] },
      method: 'none',
      permissions: [],
    };
  }

  private recordMetrics(statusCode: number, startTime: number): void {
    const count = this.metrics.requestsByStatus.get(statusCode) || 0;
    this.metrics.requestsByStatus.set(statusCode, count + 1);
    this.metrics.requestDurationMs.push(Date.now() - startTime);
    if (this.metrics.requestDurationMs.length > 10000) {
      this.metrics.requestDurationMs.shift();
    }
  }

  // Route handlers

  private async handleEvaluate(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const requestId = body.requestId?.toString() || `req-${Date.now()}`;
    const actorId = (req.headers['x-actor-id'] as string) || 'anonymous';

    const context: EvaluationContext = {
      requestId,
      timestamp: new Date(),
      sector: body.sector?.toString() || 'general',
      subject: (body.subject as Record<string, unknown>) || { id: actorId },
      resource: (body.resource as Record<string, unknown>) || {},
      action: body.action?.toString() || 'access',
      environment: (body.environment as Record<string, unknown>) || {},
      metadata: (body.metadata as Record<string, unknown>) || {},
    };

    const startEval = Date.now();
    const decision = this.engine.evaluate(context);
    const evalDurationMs = Date.now() - startEval;

    // Sign evidence
    const signed = this.signer.sign({
      requestId,
      decision,
      context: {
        sector: context.sector,
        action: context.action,
        resource: context.resource,
      },
      evaluatedAt: new Date().toISOString(),
      engineVersion: '1.0.0',
    });

    // Store evidence in DB
    await this.db.storeEvidence({
      id: crypto.randomUUID(),
      requestId,
      timestamp: new Date().toISOString(),
      decision,
      signature: signed.signature,
      publicKey: signed.publicKey,
      canonicalPayload: JSON.stringify(signed.payload),
    });

    // Store audit event
    await this.db.storeAuditEvent({
      id: crypto.randomUUID(),
      tableName: 'evidence_records',
      operation: 'INSERT',
      recordId: requestId,
      newData: { decision, requestId, actorId },
      actorId,
      actorType: 'service',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: new Date().toISOString(),
    });

    res.statusCode = decision.action === 'deny' ? 403 : 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      requestId,
      decision,
      evidence: {
        signature: signed.signature,
        publicKey: signed.publicKey,
        algorithm: signed.algorithm,
      },
      evalDurationMs,
    }));
  }

  private async handleGetEvidence(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const requestId = req.params.requestId;
    const evidence = await this.db.getEvidenceByRequestId(requestId);
    if (!evidence) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Evidence not found' }));
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(evidence));
  }

  private async handleHealth(_req: ServerRequest, res: http.ServerResponse): Promise<void> {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }));
  }

  private async handleReady(_req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const dbHealth = await this.db.healthCheck();
    const checks: Record<string, { healthy: boolean; latencyMs: number; error?: string }> = {
      database: dbHealth,
      engine: { healthy: true, latencyMs: 0 },
      signer: { healthy: true, latencyMs: 0 },
    };

    const ready = Object.values(checks).every((c) => c.healthy);
    res.statusCode = ready ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ready, checks, timestamp: new Date().toISOString() }));
  }

  private async handleMetrics(_req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const durations = this.metrics.requestDurationMs;
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const p99 = durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.99)] : 0;

    let prom = '';
    prom += `# HELP http_requests_total Total HTTP requests\n`;
    prom += `# TYPE http_requests_total counter\n`;
    prom += `http_requests_total ${this.metrics.requestsTotal}\n`;
    for (const [status, count] of this.metrics.requestsByStatus.entries()) {
      prom += `http_requests_total{status="${status}"} ${count}\n`;
    }
    prom += `# HELP http_request_duration_ms Average request duration\n`;
    prom += `# TYPE http_request_duration_ms gauge\n`;
    prom += `http_request_duration_ms_avg ${avgDuration.toFixed(2)}\n`;
    prom += `http_request_duration_ms_p99 ${p99.toFixed(2)}\n`;
    prom += `# HELP active_connections Current active connections\n`;
    prom += `# TYPE active_connections gauge\n`;
    prom += `active_connections ${this.metrics.activeConnections}\n`;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.end(prom);
  }

  private async handleCreateRule(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const rule: PolicyRule = {
      id: body.id?.toString() || `rule-${Date.now()}`,
      name: body.name?.toString() || 'Unnamed Rule',
      dimension: (body.dimension as PolicyRule['dimension']) || 'operational',
      priority: typeof body.priority === 'number' ? body.priority : 100,
      condition: (body.condition as Record<string, unknown>) || {},
      action: (body.action as PolicyRule['action']) || 'allow',
      enabled: body.enabled !== false,
      sector: body.sector?.toString(),
      description: body.description?.toString(),
    };

    this.engine.addRule(rule);

    await this.db.storeAuditEvent({
      id: crypto.randomUUID(),
      tableName: 'compliance_rules',
      operation: 'INSERT',
      recordId: rule.id,
      newData: rule as unknown as Record<string, unknown>,
      actorId: (req.headers['x-actor-id'] as string) || 'admin',
      actorType: 'admin',
      ipAddress: req.ip,
      timestamp: new Date().toISOString(),
    });

    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rule));
  }

  private async handleDeleteRule(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const id = req.params.id;
    this.engine.removeRule(id);
    await this.db.storeAuditEvent({
      id: crypto.randomUUID(),
      tableName: 'compliance_rules',
      operation: 'DELETE',
      recordId: id,
      actorId: (req.headers['x-actor-id'] as string) || 'admin',
      actorType: 'admin',
      ipAddress: req.ip,
      timestamp: new Date().toISOString(),
    });
    res.statusCode = 204;
    res.end();
  }

  private async handleAdminAudit(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const events = await this.db.getAuditEvents({
      actorId: req.query.actorId,
      operation: req.query.operation,
      tableName: req.query.tableName,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ events, total: events.length }));
  }
}
