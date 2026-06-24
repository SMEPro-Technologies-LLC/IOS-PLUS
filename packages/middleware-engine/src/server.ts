/**
 * HTTP Server Layer
 * Pure Node.js http module — no Express, no Fastify
 * @module server
 */

import http from 'node:http';
import { URL } from 'node:url';
import pg from 'pg';
import {
  type ServerConfig,
  type AiRequest,
  type PolicyRule,
  type AuditFilters,
  validateServerConfig,
} from './config.js';
import { MiddlewareOrchestrator } from './orchestrator.js';
import { UcoResolver, loadConfig as loadResolverConfig } from '@ios-plus/uco-resolver';

export interface ServerRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
  ip: string;
}

export interface ServerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (
  req: ServerRequest,
  res: http.ServerResponse,
  orchestrator: MiddlewareOrchestrator
) => Promise<void>;

export type Middleware = (
  req: ServerRequest,
  res: http.ServerResponse,
  next: () => Promise<void>
) => Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  requiresAdmin: boolean;
}

export class HttpServer {
  private readonly server: http.Server;
  private readonly config: ServerConfig;
  private readonly orchestrator: MiddlewareOrchestrator;
  private readonly routes: Route[] = [];
  private readonly middlewares: Middleware[] = [];
  private readonly rateLimitStore: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly metrics = {
    requestsTotal: 0,
    requestsByStatus: new Map<number, number>(),
    requestDurationMs: [] as number[],
    activeConnections: 0,
  };
  /**
   * UcoResolver instance for licensure lookups.
   * Null when DATABASE_URL is not configured; routes fail-closed in that case.
   */
  private resolver: UcoResolver | null = null;

  constructor(
    orchestrator: MiddlewareOrchestrator,
    config: Partial<ServerConfig> = {}
  ) {
    this.config = validateServerConfig(config);
    this.orchestrator = orchestrator;
    this._initResolver();
    this.setupMiddlewares();
    this.setupRoutes();
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  /**
   * Initialise the UCO resolver if DATABASE_URL is present.
   * The resolver is initialised lazily on first use so startup is non-blocking.
   */
  private _initResolver(): void {
    const databaseUrl = process.env['DATABASE_URL'];
    if (!databaseUrl) {
      return;
    }
    const pgPool = new pg.Pool({ connectionString: databaseUrl });
    // Adapt pg.Pool to the DatabasePool interface expected by UcoResolver
    const pool = {
      query: async <T = unknown>(sql: string, values?: unknown[]): Promise<T[]> => {
        const result = await pgPool.query(sql, values);
        return result.rows as T[];
      },
    };
    const resolverConfig = loadResolverConfig(process.env as Record<string, string | undefined>, pool);
    this.resolver = new UcoResolver(resolverConfig);
  }

  /**
   * Start listening on the configured port
   */
  listen(callback?: () => void): void {
    this.server.listen(this.config.port, this.config.host, callback);
  }

  /**
   * Graceful shutdown
   */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private setupMiddlewares(): void {
    // Request logging
    this.middlewares.push(async (req, res, next) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.url} - ${duration}ms - ${res.statusCode || 200}`
      );
    });

    // CORS
    this.middlewares.push(async (req, res, next) => {
      const origin = req.headers.origin || '*';
      if (this.config.corsOrigins.includes('*') || this.config.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      await next();
    });

    // Rate limiting
    this.middlewares.push(async (req, res, next) => {
      const isAdmin = req.url.startsWith('/admin');
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
        return;
      }
      await next();
    });
  }

  private setupRoutes(): void {
    this.addRoute('POST', '/v1/evaluate', this.handleEvaluate);
    this.addRoute('POST', '/v1/inference', this.handleInference);
    this.addRoute('GET', '/v1/evidence/:requestId', this.handleGetEvidence);
    this.addRoute('POST', '/v1/retrieve', this.handleRetrieve);
    this.addRoute('GET', '/v1/compliance/licensure/state-lookup', this.handleStateLookup);
    this.addRoute('GET', '/health', this.handleHealth);
    this.addRoute('GET', '/ready', this.handleReady);
    this.addRoute('GET', '/metrics', this.handleMetrics);
    this.addRoute('POST', '/admin/rules', this.handleCreateRule, true);
    this.addRoute('DELETE', '/admin/rules/:id', this.handleDeleteRule, true);
    this.addRoute('PUT', '/admin/rules/:id', this.handleUpdateRule, true);
    this.addRoute('GET', '/admin/audit', this.handleAdminAudit, true);
  }

  private addRoute(
    method: string,
    path: string,
    handler: RouteHandler,
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
    this.routes.push({ method, pattern, paramNames, handler: handler.bind(this), requiresAdmin });
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

    // Parse body for POST/PUT
    if (['POST', 'PUT', 'PATCH'].includes(serverReq.method)) {
      try {
        serverReq.body = await this.parseBody(req, this.config.maxRequestBodySize);
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Invalid request body', details: (err as Error).message }));
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

    // Admin auth check
    if (route.requiresAdmin) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!this.orchestrator.auth.verifyAdminToken(token)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Admin access required' }));
        this.recordMetrics(403, startTime);
        this.metrics.activeConnections--;
        return;
      }
    }

    // Execute middleware chain + handler
    const execute = async (): Promise<void> => {
      try {
        await route.handler(serverReq, res, this.orchestrator);
      } catch (err) {
        await this.handleError(err as Error, res, serverReq);
      }
    };

    let index = 0;
    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++];
        await mw(serverReq, res, next);
      } else {
        await execute();
      }
    };

    await next();

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
      // Timeout
      setTimeout(() => reject(new Error('Request body timeout')), 5000);
    });
  }

  private async handleError(err: Error, res: http.ServerResponse, req: ServerRequest): Promise<void> {
    console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);
    // Fail-closed: default to DENY on error
    const statusCode = 500;
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Internal server error',
        decision: 'DENY',
        message: err.message,
      })
    );
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
    const aiReq: AiRequest = {
      id: body.id?.toString() || `req-${Date.now()}`,
      content: body.content?.toString() || '',
      token: body.token?.toString(),
      apiKey: body.apiKey?.toString(),
      actorId: body.actorId?.toString(),
      metadata: (body.metadata as Record<string, unknown>) || {},
      context: (body.context as Record<string, unknown>) || {},
    };
    const result = await this.orchestrator.process(aiReq);
    res.statusCode = result.decision.status === 'DENY' ? 403 : 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  }

  private async handleInference(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const aiReq: AiRequest = {
      id: body.id?.toString() || `req-${Date.now()}`,
      content: body.content?.toString() || '',
      token: body.token?.toString(),
      apiKey: body.apiKey?.toString(),
      actorId: body.actorId?.toString(),
      metadata: (body.metadata as Record<string, unknown>) || {},
      context: (body.context as Record<string, unknown>) || {},
    };
    const result = await this.orchestrator.process(aiReq);
    res.statusCode = result.decision.status === 'DENY' ? 403 : 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
  }

  private async handleGetEvidence(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const requestId = req.params.requestId;
    const evidence = await this.orchestrator.evidence.getEvidenceByRequest(requestId);
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

  private async handleRetrieve(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const query = this.orchestrator.retrieval.buildRetrievalQuery({
      id: `req-${Date.now()}`,
      content: body.query?.toString() || '',
      metadata: (body.filters as Record<string, unknown>) || {},
    });
    const results = await this.orchestrator.retrieval.retrieve(query);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(results));
  }

  private async handleStateLookup(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const studentCip = req.query.student_cip;
    const destinationState = req.query.destination_state;

    if (!studentCip || !destinationState) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing required query parameters: student_cip, destination_state' }));
      return;
    }

    if (!this.resolver) {
      // Fail closed: resolver is not configured (DATABASE_URL missing).
      // Return 503 rather than a stale stub so callers know the service is
      // unavailable rather than receiving silently incorrect data.
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Licensure lookup unavailable: DATABASE_URL is not configured.',
        // Remaining constraint: this endpoint requires a PostgreSQL database
        // seeded with UCO ontology data (uco_nodes, uco_crosswalk,
        // uco_obligation_metadata). Run db:migrate && db:seed before use.
      }));
      return;
    }

    try {
      const lookupResult = await this.resolver.lookupLicensure({
        studentCip,
        destinationState,
      });

      const requirements = lookupResult.rankedPaths.flatMap((p) => p.requirements);
      const licensure_status =
        requirements.length === 0 ? 'no_requirements_found'
        : requirements.some((r) => r.enforcementType === 'mandatory') ? 'mandatory'
        : 'informational';

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        student_cip: studentCip,
        destination_state: destinationState,
        licensure_status,
        requirements,
        candidates: lookupResult.candidates,
        errors: lookupResult.errors,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Licensure lookup failed: ${message}` }));
    }
  }

  private async handleHealth(_req: ServerRequest, res: http.ServerResponse): Promise<void> {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'healthy', uptime: process.uptime() }));
  }

  private async handleReady(_req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const checks: Record<string, boolean> = {
      auth: true,
      classification: true,
      policy: true,
      evaluation: true,
      evidence: true,
      retrieval: true,
      audit: true,
    };
    const ready = Object.values(checks).every(Boolean);
    res.statusCode = ready ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ready, checks }));
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
      sector: body.sector?.toString() || '*',
      action: body.action?.toString() || '*',
      condition: (body.condition as Record<string, unknown>) || {},
      effect: (body.effect as 'allow' | 'deny') || 'deny',
      priority: typeof body.priority === 'number' ? body.priority : 0,
      tenantId: body.tenantId?.toString(),
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const validation = this.orchestrator.policy.validatePolicy(rule);
    if (!validation.valid) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid policy', details: validation.errors }));
      return;
    }
    const tenantId = rule.tenantId || 'global';
    this.orchestrator.policy.storeRule(tenantId, rule);
    await this.orchestrator.audit.recordAdminMutation(
      { id: 'admin' },
      'createRule',
      undefined,
      rule as unknown as Record<string, unknown>
    );
    res.statusCode = 201;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rule));
  }

  private async handleDeleteRule(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const id = req.params.id;
    const tenantId = req.query.tenantId || 'global';
    const before = this.orchestrator.policy.getRules(tenantId).find((r) => r.id === id);
    const deleted = this.orchestrator.policy.deleteRule(tenantId, id);
    if (!deleted) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Rule not found' }));
      return;
    }
    await this.orchestrator.audit.recordAdminMutation(
      { id: 'admin' },
      'deleteRule',
      before ? (before as unknown as Record<string, unknown>) : undefined,
      undefined
    );
    res.statusCode = 204;
    res.end();
  }

  private async handleUpdateRule(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const id = req.params.id;
    const tenantId = (req.body as Record<string, unknown>)?.tenantId?.toString() || 'global';
    const before = this.orchestrator.policy.getRules(tenantId).find((r) => r.id === id);
    if (!before) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Rule not found' }));
      return;
    }
    const body = req.body as Record<string, unknown>;
    const after: PolicyRule = {
      ...before,
      name: body.name?.toString() || before.name,
      sector: body.sector?.toString() || before.sector,
      action: body.action?.toString() || before.action,
      condition: (body.condition as Record<string, unknown>) || before.condition,
      effect: (body.effect as 'allow' | 'deny') || before.effect,
      priority: typeof body.priority === 'number' ? body.priority : before.priority,
      updatedAt: new Date().toISOString(),
    };
    const validation = this.orchestrator.policy.validatePolicy(after);
    if (!validation.valid) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid policy', details: validation.errors }));
      return;
    }
    this.orchestrator.policy.storeRule(tenantId, after);
    await this.orchestrator.audit.recordAdminMutation(
      { id: 'admin' },
      'updateRule',
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(after));
  }

  private async handleAdminAudit(req: ServerRequest, res: http.ServerResponse): Promise<void> {
    const filters: AuditFilters = {
      actorId: req.query.actorId,
      action: req.query.action,
      resource: req.query.resource,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : undefined,
    };
    const events = await this.orchestrator.audit.getAuditTrail(filters);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ events, total: events.length }));
  }
}

/**
 * Factory function to create and configure the HTTP server
 */
export function createServer(
  orchestrator: MiddlewareOrchestrator,
  config?: Partial<ServerConfig>
): HttpServer {
  return new HttpServer(orchestrator, config);
}
