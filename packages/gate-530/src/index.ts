/**
 * Gate 530 Logic Engine â€” IPC sidecar, dimension evaluation, session cache
 *
 * Runs as a sidecar process alongside the Middleware Engine.
 * Communicates via Unix domain socket: /tmp/gate530.sock
 * failClosedOnTimeout = true: any timeout â†’ BLOCK (fail-safe mode)
 *
 * Six evaluation dimensions per UCO node:
 *   1. jurisdiction_match        â€” request jurisdiction vs. node jurisdiction_level
 *   2. activity_match            â€” detected activity vs. specific_activity
 *   3. agency_authority          â€” governing_agency active in relevant jurisdiction
 *   4. regulatory_currency       â€” last_updated within acceptable staleness window
 *   5. risk_weight_threshold     â€” risk_weight vs. tenant risk tolerance profile
 *   6. cross_sector_applicability â€” XSC cross-cutting node inclusion logic
 *
 * P99 target: < 50ms (production measured: 47ms) â€” EB Doc 4 Â§4.3
 * Session cache: Redis 3-node HA cluster (TTL 900s matching 15-min RPO)
 * SmePro Technologies â€” Confidential
 */

import net from 'node:net';
import { Redis } from 'ioredis';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import type {
  UCONodeSummary, UCONodeResult, PolicyAction, RiskWeight
} from '@ios-plus/shared';

export interface Gate530Config {
  ipcSocketPath: string;          // default: /tmp/gate530.sock
  failClosedOnTimeout: boolean;   // always true in production
  timeoutMs: number;              // default: 50ms (P99 budget)
  redisUrl: string;               // Redis HA cluster URL
  sessionCacheTtlSeconds: number; // default: 900 (15-min RPO alignment)
  escalationLadderLimit?: number;
  escalationLadderWindowSeconds?: number;
  transport?: 'ipc' | 'http2';    // default: ipc
  port?: number;                  // default: 3002
}

export interface DimensionScore {
  jurisdiction_match: number;
  activity_match: number;
  agency_authority: number;
  regulatory_currency: number;
  risk_weight_threshold: number;
  cross_sector_applicability: number;
}

export interface Gate530EvaluationRequest {
  sessionId: string;
  tenantId: string;
  requestContext: {
    detectedActivity: string;
    jurisdictions: string[];
    riskTolerance: number;        // 1â€“10 scale, tenant-configured
    timestampIso: string;
  };
  nodes: UCONodeSummary[];
}

export interface Gate530EvaluationResult {
  gateDecisionId: string;
  sessionId: string;
  tenantId: string;
  nodeResults: UCONodeResult[];
  aggregatePolicyAction: PolicyAction;
  evaluationLatencyMs: number;
  cachedResult: boolean;
  quarantinedNodeIds: string[];
}

/** Dimension score â†’ policy action mapping per EB Doc 4 Â§3.2 */
function scoreToAction(score: DimensionScore, node: UCONodeSummary): PolicyAction {
  const composite =
    (score.jurisdiction_match * 0.20) +
    (score.activity_match     * 0.25) +
    (score.agency_authority   * 0.15) +
    (score.regulatory_currency* 0.10) +
    (score.risk_weight_threshold * 0.20) +
    (score.cross_sector_applicability * 0.10);

  // Override with node default policy action if composite is borderline
  if (composite < 0.40) return 'BLOCK';
  if (composite < 0.70) return node.policyAction === 'BLOCK' ? 'BLOCK' : 'ESCALATE';
  return node.policyAction;
}

function tokenizeActivity(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function computeActivityMatch(detectedActivity: string, specificActivity?: string): number {
  const detected = tokenizeActivity(detectedActivity);
  const node = tokenizeActivity(specificActivity ?? '');
  if (detected.size === 0 || node.size === 0) return 0.3;

  let intersection = 0;
  for (const token of detected) {
    if (node.has(token)) intersection++;
  }
  const union = new Set([...detected, ...node]).size;
  const similarity = union === 0 ? 0 : intersection / union;
  return Math.max(0.2, Math.min(1, similarity));
}

function computeAgencyAuthority(node: UCONodeSummary, jurisdictions: string[]): number {
  if (!node.governingAgency?.trim()) return 0.3;
  if (node.jurisdictionLevel === 'Federal') return 1.0;
  const requested = new Set(jurisdictions.map(j => j.trim().toLowerCase()).filter(Boolean));
  return requested.has(node.jurisdictionLevel.toLowerCase()) ? 1.0 : 0.5;
}

function computeRegulatoryCurrency(timestampIso: string, lastUpdated?: string): number {
  const referenceDate = new Date(timestampIso);
  const updateDate = new Date(lastUpdated ?? '');
  if (Number.isNaN(referenceDate.getTime()) || Number.isNaN(updateDate.getTime())) return 0.5;

  const ageDays = (referenceDate.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 365) return 1.0;
  if (ageDays <= 730) return 0.7;
  return 0.4;
}

/** Evaluate all UCO nodes for a request context */
function evaluateDimensions(
  node: UCONodeSummary,
  ctx: Gate530EvaluationRequest['requestContext']
): DimensionScore {
  // Jurisdiction match â€” Federal always scores 1.0 (universal applicability)
  const jurisdiction_match = node.jurisdictionLevel === 'Federal' ? 1.0
    : ctx.jurisdictions.some(j => j.toLowerCase() === node.jurisdictionLevel.toLowerCase()) ? 1.0
    : 0.3;

  const activity_match = computeActivityMatch(ctx.detectedActivity, node.specificActivity);

  const agency_authority = computeAgencyAuthority(node, ctx.jurisdictions);

  const regulatory_currency = computeRegulatoryCurrency(ctx.timestampIso, node.lastUpdated);

  // Risk weight threshold â€” compare node risk vs. tenant tolerance
  const risk_weight_threshold = node.riskWeight <= ctx.riskTolerance ? 1.0
    : node.riskWeight <= ctx.riskTolerance + 2 ? 0.5
    : 0.0;

  // Cross-sector applicability â€” XSC nodes always score 1.0
  const cross_sector_applicability = node.ucoNodeId.startsWith('UCO-XSC-') ? 1.0 : 0.8;

  return {
    jurisdiction_match, activity_match, agency_authority,
    regulatory_currency, risk_weight_threshold, cross_sector_applicability
  };
}

/** Derive aggregate policy action: BLOCK dominates ESCALATE dominates APPROVE */
function aggregateActions(results: UCONodeResult[]): PolicyAction {
  const triggered = results.filter(r => r.triggered);
  if (triggered.some(r => r.policyAction === 'BLOCK')) return 'BLOCK';
  if (triggered.some(r => r.policyAction === 'ESCALATE')) return 'ESCALATE';
  return 'APPROVE';
}

export class Gate530Engine {
  private redis: Redis;
  private config: Gate530Config;

  constructor(config: Gate530Config) {
    this.config = {
      ...config,
      escalationLadderLimit: config.escalationLadderLimit ?? parseInt(process.env['ESCALATION_LADDER_LIMIT'] ?? '5'),
      escalationLadderWindowSeconds: config.escalationLadderWindowSeconds ?? parseInt(process.env['ESCALATION_LADDER_WINDOW_SECONDS'] ?? '600'),
    };
    this.redis = new Redis(config.redisUrl);
  }

  async evaluate(request: Gate530EvaluationRequest): Promise<Gate530EvaluationResult> {
    const startMs = Date.now();
    const cacheKey = `gate530:${request.tenantId}:${request.sessionId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached) as Gate530EvaluationResult;
      return { ...result, cachedResult: true, evaluationLatencyMs: Date.now() - startMs };
    }

    const nodeResults: UCONodeResult[] = request.nodes.map(node => {
      const scores = evaluateDimensions(node, request.requestContext);
      const action = scoreToAction(scores, node);
      const triggered = action !== 'APPROVE';
      return {
        node, evaluated: true, triggered,
        policyAction: action,
        rationale: `Composite score dimensions evaluated. Action: ${action}.`,
        evaluationLatencyMs: 0,
      };
    });

    let aggregatePolicyAction = aggregateActions(nodeResults);

    if (aggregatePolicyAction === 'ESCALATE') {
      const ladderKey = `gate530:escladder:${request.tenantId}:${request.sessionId}`;
      try {
        const count = await this.redis.incr(ladderKey);
        if (count === 1) {
          await this.redis.expire(ladderKey, this.config.escalationLadderWindowSeconds ?? 600);
        }
        const limit = this.config.escalationLadderLimit ?? 5;
        if (count > limit) {
          aggregatePolicyAction = 'BLOCK';
          // Convert all escalated node results to BLOCK
          nodeResults.forEach(r => {
            if (r.policyAction === 'ESCALATE') {
              r.policyAction = 'BLOCK';
              r.rationale = `Escalation rate limit exceeded (${count}/${limit} in window). Converted ESCALATE to BLOCK.`;
            }
          });
        }
      } catch (err) {
        console.warn('Escalation ladder check failed:', err);
      }
    }

    const result: Gate530EvaluationResult = {
      gateDecisionId: crypto.randomUUID(),
      sessionId: request.sessionId,
      tenantId: request.tenantId,
      nodeResults,
      aggregatePolicyAction,
      evaluationLatencyMs: Date.now() - startMs,
      cachedResult: false,
      quarantinedNodeIds: nodeResults.filter(r => r.policyAction === 'BLOCK' || r.policyAction === 'ESCALATE').map(r => r.node.ucoNodeId),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', this.config.sessionCacheTtlSeconds);
    return result;
  }

  /** IPC server â€” listens on Unix socket for sidecar requests from Middleware Engine */
  startIPCServer(): net.Server {
    const server = net.createServer((socket) => {
      socket.on('data', async (data) => {
        try {
          const request = JSON.parse(data.toString()) as Gate530EvaluationRequest;
          const result = await Promise.race([
            this.evaluate(request),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gate530 timeout')), this.config.timeoutMs)
            ),
          ]);
          socket.write(JSON.stringify({ ok: true, result }));
        } catch (err) {
          if (this.config.failClosedOnTimeout) {
            socket.write(JSON.stringify({
              ok: false,
              error: 'TIMEOUT_BLOCK',
              result: { aggregatePolicyAction: 'BLOCK' }
            }));
          } else {
            socket.write(JSON.stringify({ ok: false, error: String(err) }));
          }
        }
      });
    });
    server.listen(this.config.ipcSocketPath);
    return server;
  }

  /** HTTP/2 server — listens on TCP port for distributed requests */
  startHTTP2Server(port: number): http2.Http2Server {
    const server = http2.createServer();
    server.on('stream', (stream: http2.ServerHttp2Stream) => {
      let body = '';
      stream.on('data', (chunk) => {
        body += chunk;
      });
      stream.on('end', async () => {
        try {
          const request = JSON.parse(body) as Gate530EvaluationRequest;
          const result = await Promise.race([
            this.evaluate(request),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gate530 timeout')), this.config.timeoutMs)
            ),
          ]);
          stream.respond({
            'content-type': 'application/json',
            ':status': 200,
          });
          stream.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const errorMsg = String(err);
          const isTimeout = errorMsg.includes('Gate530 timeout');
          
          if (isTimeout && this.config.failClosedOnTimeout) {
            stream.respond({
              'content-type': 'application/json',
              ':status': 200,
            });
            stream.end(JSON.stringify({
              ok: false,
              error: 'TIMEOUT_BLOCK',
              result: { aggregatePolicyAction: 'BLOCK' }
            }));
          } else {
            stream.respond({
              'content-type': 'application/json',
              ':status': 500,
            });
            stream.end(JSON.stringify({ ok: false, error: errorMsg }));
          }
        }
      });
    });
    server.listen(port);
    return server;
  }
}

export const DEFAULT_GATE530_CONFIG: Gate530Config = {
  ipcSocketPath: '/tmp/gate530.sock',
  failClosedOnTimeout: true,
  timeoutMs: 50,
  redisUrl: process.env['REDIS_URL'] ?? 'redis://redis:6379',
  sessionCacheTtlSeconds: 900,
  transport: (process.env['GATE530_TRANSPORT'] as 'ipc' | 'http2') ?? 'ipc',
  port: parseInt(process.env['GATE530_PORT'] ?? '3002'),
};

// ── Bootstrap ────────────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

function loadVaultSecrets() {
  const vaultSecretsPath = "/vault/secrets/ios-plus.env";
  if (fs.existsSync(vaultSecretsPath)) {
    try {
      const content = fs.readFileSync(vaultSecretsPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const eqIndex = trimmed.indexOf("=");
          const key = trimmed.slice(0, eqIndex).trim();
          const val = trimmed.slice(eqIndex + 1).trim();
          const cleanedVal = val.replace(/^['"]|['"]$/g, "");
          if (key) {
            process.env[key] = cleanedVal;
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

function validateSecrets() {
  const required = ['REDIS_URL'];
  const missing: string[] = [];
  for (const key of required) {
    if (!process.env[key] || process.env[key]?.trim() === '') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    if (process.env['NODE_ENV'] === 'production') {
      process.stderr.write(JSON.stringify({ level: 50, time: Date.now(), msg: 'CRITICAL STARTUP ERROR: Missing required secrets. Terminating.', missing }) + '\n');
      process.exit(1);
    } else {
      process.stdout.write(JSON.stringify({ level: 40, time: Date.now(), msg: 'WARNING: Missing required secrets in development mode.', missing }) + '\n');
    }
  }
}

async function main(): Promise<void> {
  loadVaultSecrets();
  validateSecrets();

  // Apply loaded environment variables to configuration
  if (process.env['REDIS_URL']) {
    DEFAULT_GATE530_CONFIG.redisUrl = process.env['REDIS_URL'];
  }

  if (process.env['GATE530_TRANSPORT']) {
    DEFAULT_GATE530_CONFIG.transport = process.env['GATE530_TRANSPORT'] as 'ipc' | 'http2';
  }
  if (process.env['GATE530_PORT']) {
    DEFAULT_GATE530_CONFIG.port = parseInt(process.env['GATE530_PORT']);
  }
  if (process.env['GATE530_IPC_SOCKET']) {
    DEFAULT_GATE530_CONFIG.ipcSocketPath = process.env['GATE530_IPC_SOCKET'];
  }

  const log = (level: number, msg: string, extra: Record<string, unknown> = {}) =>
    process.stdout.write(JSON.stringify({ level, time: Date.now(), pid: process.pid, msg, ...extra }) + '\n');

  const transport = DEFAULT_GATE530_CONFIG.transport ?? 'ipc';
  log(30, 'Gate 530 Engine starting', {
    transport,
    socketPath: DEFAULT_GATE530_CONFIG.ipcSocketPath,
    port: DEFAULT_GATE530_CONFIG.port,
    timeoutMs:  DEFAULT_GATE530_CONFIG.timeoutMs,
  });

  const engine = new Gate530Engine(DEFAULT_GATE530_CONFIG);


  try { await engine['redis'].ping(); log(30, 'Redis verified'); }
  catch (err) { log(50, 'Redis ping failed', { error: String(err) }); process.exit(1); }

  let server: any;
  if (transport === 'http2') {
    const port = DEFAULT_GATE530_CONFIG.port ?? 3002;
    server = engine.startHTTP2Server(port);
    server.on('listening', () => log(30, 'HTTP/2 server listening', { port }));
  } else {
    try { fs.unlinkSync(DEFAULT_GATE530_CONFIG.ipcSocketPath); } catch { /* ok */ }
    server = engine.startIPCServer();
    server.on('listening', () => log(30, 'IPC server listening', { socket: DEFAULT_GATE530_CONFIG.ipcSocketPath }));
  }
  server.on('error', (err: any) => { log(50, 'Server error', { error: String(err) }); process.exit(1); });

  const shutdown = (sig: string) => {
    log(30, 'Shutdown', { signal: sig });
    server.close(() => engine['redis'].quit().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(JSON.stringify({ level: 50, time: Date.now(), pid: process.pid, msg: 'Fatal startup error', error: String(err) }) + '\n');
    process.exit(1);
  });
}