/**
 * Gate Walker API Server
 * Provides the /gate/execute endpoint for the 10-stage pipeline.
 *
 * This is a lightweight Node.js HTTP server — no external framework required.
 * Follows the same patterns as Gate530ApiServer in packages/gate-530.
 */

import http from 'node:http';
import { URL } from 'node:url';
import { GateWalkerPipeline, type GateWalkerOptions } from '../pipeline.js';
import type { GateRequest } from '../types.js';

export interface GateWalkerServerConfig {
  host: string;
  port: number;
  maxBodySizeBytes?: number;
}

const DEFAULT_CONFIG: GateWalkerServerConfig = {
  host: '0.0.0.0',
  port: 8080,
  maxBodySizeBytes: 1024 * 1024, // 1 MiB
};

export class GateWalkerServer {
  private readonly server: http.Server;
  private readonly pipeline: GateWalkerPipeline;
  private readonly config: GateWalkerServerConfig;

  constructor(
    pipelineOptions: GateWalkerOptions = {},
    config: Partial<GateWalkerServerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pipeline = new GateWalkerPipeline(pipelineOptions);
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

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const parsed = new URL(url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsed.pathname;

    try {
      // ── POST /gate/execute ─────────────────────────────────────────────
      if (req.method === 'POST' && pathname === '/gate/execute') {
        await this.handleExecute(req, res);
        return;
      }

      // ── GET /health ───────────────────────────────────────────────────
      if (req.method === 'GET' && pathname === '/health') {
        this.sendJson(res, 200, { status: 'ok', service: 'gate-walker', version: '1.0.0' });
        return;
      }

      // ── 404 ───────────────────────────────────────────────────────────
      this.sendJson(res, 404, { error: 'Not found', path: pathname });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[GateWalkerServer] Unhandled error:', message);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private async handleExecute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let body: unknown;
    try {
      body = await this.readBody(req, this.config.maxBodySizeBytes ?? DEFAULT_CONFIG.maxBodySizeBytes!);
    } catch (err) {
      this.sendJson(res, 400, { error: 'Failed to read request body', details: (err as Error).message });
      return;
    }

    if (typeof body !== 'object' || body === null) {
      this.sendJson(res, 400, { error: 'Request body must be a JSON object' });
      return;
    }

    const gateRequest = body as GateRequest;

    // Basic validation
    if (!gateRequest.actorId) {
      this.sendJson(res, 400, { error: 'actorId is required' });
      return;
    }
    if (!gateRequest.resource?.type) {
      this.sendJson(res, 400, { error: 'resource.type is required' });
      return;
    }
    if (!gateRequest.action) {
      this.sendJson(res, 400, { error: 'action is required' });
      return;
    }

    try {
      const result = await this.pipeline.execute(gateRequest);

      const status = result.decision === 'ALLOW' ? 200 : result.decision === 'REDACT' ? 200 : 403;
      this.sendJson(res, status, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[GateWalkerServer] Pipeline execution error:', message);
      // Do not expose internal error details (stack traces etc.) to the client
      this.sendJson(res, 500, { error: 'Pipeline execution failed' });
    }
  }

  private async readBody(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          reject(new Error(`Request body exceeds maximum size of ${maxBytes} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(raw ? JSON.parse(raw) : null);
        } catch {
          reject(new Error('Invalid JSON in request body'));
        }
      });

      req.on('error', reject);
    });
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }
}
