import http2 from 'http2';
import net from 'net';
import fs from 'fs';
import { EvaluationContext } from './config.js';
import { ComplianceDecision, Gate530Engine } from './engine.js';

export interface TransportConfig {
  type: 'http2' | 'ipc';
  port?: number;
  host?: string;
  socketPath?: string;
}

export interface ServerRequest {
  method: string;
  url: string;
  body: string;
}

export interface ServerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function createTransport(
  config: TransportConfig,
  engine: Gate530Engine
): Http2Transport | IpcTransport {
  if (config.type === 'http2') {
    return new Http2Transport(engine);
  } else if (config.type === 'ipc') {
    return new IpcTransport(engine);
  }
  throw new Error(`Unknown transport type: ${config.type}`);
}

export class Http2Transport {
  private server?: http2.Http2Server;
  private engine: Gate530Engine;
  private metrics = {
    requestsTotal: 0,
    evaluationsTotal: 0,
    errorsTotal: 0,
    startTime: Date.now(),
  };

  constructor(engine: Gate530Engine) {
    this.engine = engine;
  }

  listen(port: number = 8530, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http2.createServer();

      this.server.on('stream', (stream, headers) => {
        const method = headers[':method'] as string;
        const url = headers[':path'] as string;

        this.metrics.requestsTotal++;

        let body = '';
        stream.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });

        stream.on('end', () => {
          this.handleRequest(method, url, body)
            .then((response) => {
              stream.respond({
                ':status': response.statusCode,
                'content-type': 'application/json',
                ...response.headers,
              });
              stream.end(response.body);
            })
            .catch((error) => {
              this.metrics.errorsTotal++;
              stream.respond({ ':status': 500, 'content-type': 'application/json' });
              stream.end(JSON.stringify({ error: String(error) }));
            });
        });

        stream.on('error', (error: Error) => {
          this.metrics.errorsTotal++;
          console.error('[Http2Transport] stream error:', error);
        });
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(port, host, () => {
        console.log(`[Gate530] HTTP/2 transport listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async handleRequest(method: string, url: string, body: string): Promise<ServerResponse> {
    if (method === 'GET' && url === '/health') {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
      };
    }

    if (method === 'GET' && url === '/metrics') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: this.formatMetrics(),
      };
    }

    if (method === 'POST' && url === '/evaluate') {
      try {
        const parsed = JSON.parse(body) as EvaluationContext;
        const context: EvaluationContext = {
          ...parsed,
          timestamp: new Date(parsed.timestamp ?? Date.now()),
        };
        this.metrics.evaluationsTotal++;
        const decision = await this.engine.evaluateAsync(context);
        return {
          statusCode: 200,
          headers: {},
          body: JSON.stringify(decision),
        };
      } catch (error) {
        this.metrics.errorsTotal++;
        return {
          statusCode: 400,
          headers: {},
          body: JSON.stringify({
            error: `Invalid evaluation context: ${error instanceof Error ? error.message : String(error)}`,
          }),
        };
      }
    }

    return {
      statusCode: 404,
      headers: {},
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  private formatMetrics(): string {
    const uptime = (Date.now() - this.metrics.startTime) / 1000;
    return [
      '# HELP gate530_requests_total Total requests received',
      '# TYPE gate530_requests_total counter',
      `gate530_requests_total ${this.metrics.requestsTotal}`,
      '',
      '# HELP gate530_evaluations_total Total evaluations performed',
      '# TYPE gate530_evaluations_total counter',
      `gate530_evaluations_total ${this.metrics.evaluationsTotal}`,
      '',
      '# HELP gate530_errors_total Total errors',
      '# TYPE gate530_errors_total counter',
      `gate530_errors_total ${this.metrics.errorsTotal}`,
      '',
      '# HELP gate530_uptime_seconds Server uptime in seconds',
      '# TYPE gate530_uptime_seconds gauge',
      `gate530_uptime_seconds ${uptime}`,
    ].join('\n');
  }
}

export class IpcTransport {
  private server?: net.Server;
  private engine: Gate530Engine;
  private socketPath = '';
  private metrics = {
    requestsTotal: 0,
    evaluationsTotal: 0,
    errorsTotal: 0,
    startTime: Date.now(),
  };

  constructor(engine: Gate530Engine) {
    this.engine = engine;
  }

  listen(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socketPath = socketPath;

      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }

      const dir = socketPath.substring(0, socketPath.lastIndexOf('/'));
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.server = net.createServer((socket) => {
        let buffer = '';

        socket.on('data', (data) => {
          buffer += data.toString();

          const requestEnd = buffer.indexOf('\r\n\r\n');
          if (requestEnd !== -1) {
            const headerPart = buffer.substring(0, requestEnd);
            const body = buffer.substring(requestEnd + 4);

            const lines = headerPart.split('\r\n');
            const firstLine = lines[0];
            const parts = firstLine.split(' ');
            const method = parts[0];
            const url = parts[1];

            this.metrics.requestsTotal++;

            this.handleRequest(method, url, body)
              .then((response) => {
                const headerLines = Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`);
                const responseStr =
                  `HTTP/1.1 ${response.statusCode} OK\r\n` +
                  headerLines.join('\r\n') +
                  (headerLines.length > 0 ? '\r\n' : '') +
                  `content-type: application/json\r\n` +
                  `\r\n` +
                  response.body;
                socket.write(responseStr);
                socket.end();
              })
              .catch((error) => {
                this.metrics.errorsTotal++;
                socket.write(
                  `HTTP/1.1 500 Error\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ error: String(error) })}`
                );
                socket.end();
              });

            buffer = '';
          }
        });

        socket.on('error', (error: Error) => {
          this.metrics.errorsTotal++;
          console.error('[IpcTransport] socket error:', error);
        });
      });

      this.server.on('error', (error) => {
        reject(error);
      });

      this.server.listen(socketPath, () => {
        console.log(`[Gate530] IPC transport listening on ${socketPath}`);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((error?: Error) => {
        if (this.socketPath && fs.existsSync(this.socketPath)) {
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            // ignore cleanup errors
          }
        }
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private async handleRequest(method: string, url: string, body: string): Promise<ServerResponse> {
    if (method === 'GET' && url === '/health') {
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }),
      };
    }

    if (method === 'GET' && url === '/metrics') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: this.formatMetrics(),
      };
    }

    if (method === 'POST' && url === '/evaluate') {
      try {
        const parsed = JSON.parse(body) as EvaluationContext;
        const context: EvaluationContext = {
          ...parsed,
          timestamp: new Date(parsed.timestamp ?? Date.now()),
        };
        this.metrics.evaluationsTotal++;
        const decision = await this.engine.evaluateAsync(context);
        return {
          statusCode: 200,
          headers: {},
          body: JSON.stringify(decision),
        };
      } catch (error) {
        this.metrics.errorsTotal++;
        return {
          statusCode: 400,
          headers: {},
          body: JSON.stringify({
            error: `Invalid evaluation context: ${error instanceof Error ? error.message : String(error)}`,
          }),
        };
      }
    }

    return {
      statusCode: 404,
      headers: {},
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  private formatMetrics(): string {
    const uptime = (Date.now() - this.metrics.startTime) / 1000;
    return [
      '# HELP gate530_requests_total Total requests received',
      '# TYPE gate530_requests_total counter',
      `gate530_requests_total ${this.metrics.requestsTotal}`,
      '',
      '# HELP gate530_evaluations_total Total evaluations performed',
      '# TYPE gate530_evaluations_total counter',
      `gate530_evaluations_total ${this.metrics.evaluationsTotal}`,
      '',
      '# HELP gate530_errors_total Total errors',
      '# TYPE gate530_errors_total counter',
      `gate530_errors_total ${this.metrics.errorsTotal}`,
      '',
      '# HELP gate530_uptime_seconds Server uptime in seconds',
      '# TYPE gate530_uptime_seconds gauge',
      `gate530_uptime_seconds ${uptime}`,
    ].join('\n');
  }
}

export class Gate530Server {
  private transport?: Http2Transport | IpcTransport;
  private engine: Gate530Engine;

  constructor(engine: Gate530Engine) {
    this.engine = engine;
  }

  async start(config: TransportConfig): Promise<void> {
    this.transport = createTransport(config, this.engine);
    if (config.type === 'http2') {
      await (this.transport as Http2Transport).listen(config.port, config.host);
    } else if (config.type === 'ipc') {
      if (!config.socketPath) {
        throw new Error('socketPath is required for IPC transport');
      }
      await (this.transport as IpcTransport).listen(config.socketPath);
    } else {
      throw new Error(`Unknown transport type: ${config.type}`);
    }
  }

  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }
}
