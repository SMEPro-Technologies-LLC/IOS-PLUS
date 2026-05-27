/**
 * L5 — Gate 530 Screening
 * Timeout budget: 50ms (P99 < 50ms; production measured 47ms)
 * Communicates with Gate 530 sidecar via IPC socket /tmp/gate530.sock.
 * failClosedOnTimeout=true → BLOCK on any timeout.
 */
import net from "node:net";
import http2 from "node:http2";
import type { LayerResult, ExecutionContext, NAICSProfile } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";

class Http2SessionManager {
  private static session: http2.ClientHttp2Session | null = null;
  private static url: string | null = null;
  private static circuitBreakerFailureCount = 0;
  private static circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF-OPEN' = 'CLOSED';
  private static lastStateChange = Date.now();
  private static maxFailures = 3;
  private static cooldownPeriodMs = 10000; // 10 seconds

  public static getSession(url: string): http2.ClientHttp2Session {
    if (this.circuitBreakerState === 'OPEN') {
      if (Date.now() - this.lastStateChange > this.cooldownPeriodMs) {
        this.circuitBreakerState = 'HALF-OPEN';
        this.lastStateChange = Date.now();
      } else {
        throw new Error(`Circuit breaker is OPEN for ${url}`);
      }
    }

    if (this.session && this.url === url && !this.session.destroyed && !this.session.closed) {
      return this.session;
    }

    if (this.session) {
      try { this.session.destroy(); } catch {}
    }

    this.url = url;
    this.session = http2.connect(url);

    this.session.on('error', (err) => {
      this.handleFailure();
      try { this.session?.destroy(); } catch {}
      this.session = null;
    });

    this.session.on('goaway', () => {
      try { this.session?.destroy(); } catch {}
      this.session = null;
    });

    this.session.on('close', () => {
      this.session = null;
    });

    if (this.circuitBreakerState === 'HALF-OPEN') {
      this.circuitBreakerState = 'CLOSED';
      this.circuitBreakerFailureCount = 0;
      this.lastStateChange = Date.now();
    }

    return this.session;
  }

  public static handleSuccess() {
    if (this.circuitBreakerState === 'HALF-OPEN') {
      this.circuitBreakerState = 'CLOSED';
      this.circuitBreakerFailureCount = 0;
      this.lastStateChange = Date.now();
    }
  }

  public static handleFailure() {
    this.circuitBreakerFailureCount++;
    if (this.circuitBreakerFailureCount >= this.maxFailures) {
      this.circuitBreakerState = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }
}

export async function runL5(
  ctx: ExecutionContext,
  detectedActivity: string,
  naicsProfile?: NAICSProfile,
  transport: 'ipc' | 'http2' = (process.env['GATE530_TRANSPORT'] as 'ipc' | 'http2') || 'ipc',
  ipcSocketPath = process.env['GATE530_IPC_SOCKET'] || "/tmp/gate530.sock",
  http2Url = process.env['GATE530_URL'] || `http://localhost:${process.env['GATE530_PORT'] || '3002'}`,
  timeoutMs = 50
): Promise<LayerResult & { gateResult: Gate530EvaluationResult }> {
  const start = Date.now();
  
  if (transport === 'http2') {
    return new Promise((resolve) => {
      let client: http2.ClientHttp2Session;
      try {
        client = Http2SessionManager.getSession(http2Url);
      } catch (err) {
        resolve({
          layer: 5, success: false, latencyMs: Date.now() - start, error: `Circuit breaker / Connection blocked: ${String(err)}`,
          gateResult: {
            gateDecisionId: "",
            sessionId: ctx.sessionId, tenantId: ctx.tenantId,
            nodeResults: [], aggregatePolicyAction: "BLOCK",
            evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
          }
        });
        return;
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        Http2SessionManager.handleFailure();
        resolve({
          layer: 5, success: false, latencyMs: Date.now() - start,
          error: "Gate530 HTTP/2 timeout — BLOCK enforced",
          gateResult: {
            gateDecisionId: "",
            sessionId: ctx.sessionId, tenantId: ctx.tenantId,
            nodeResults: [], aggregatePolicyAction: "BLOCK",
            evaluationLatencyMs: timeoutMs, cachedResult: false, quarantinedNodeIds: []
          }
        });
      }, timeoutMs);

      const req = client.request({
        ':method': 'POST',
        ':path': '/',
        'content-type': 'application/json',
      });

      const payload = JSON.stringify({
        sessionId: ctx.sessionId, tenantId: ctx.tenantId,
        requestContext: {
          detectedActivity,
          jurisdictions: naicsProfile?.jurisdictions ?? ["Federal"],
          riskTolerance: naicsProfile?.riskTolerance ?? 7,
          timestampIso: new Date().toISOString(),
        },
        nodes: [...ctx.ucoContext.nodes, ...ctx.ucoContext.crossCuttingNodes],
      });

      req.write(payload);
      req.end();

      let responseData = '';
      req.on('data', (chunk) => {
        responseData += chunk;
      });

      req.on('end', () => {
        clearTimeout(timer);
        if (timedOut) return;

        try {
          const resp = JSON.parse(responseData);
          Http2SessionManager.handleSuccess();
          resolve({
            layer: 5, success: resp.ok,
            latencyMs: Date.now() - start,
            gateResult: resp.result as Gate530EvaluationResult,
          });
        } catch (err) {
          Http2SessionManager.handleFailure();
          resolve({
            layer: 5, success: false, latencyMs: Date.now() - start, error: `Invalid JSON response: ${String(err)}`,
            gateResult: {
              gateDecisionId: "",
              sessionId: ctx.sessionId, tenantId: ctx.tenantId,
              nodeResults: [], aggregatePolicyAction: "BLOCK",
              evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
            }
          });
        }
      });
      
      req.on('error', (err) => {
        clearTimeout(timer);
        if (timedOut) return;
        Http2SessionManager.handleFailure();
        resolve({
          layer: 5, success: false, latencyMs: Date.now() - start, error: String(err),
          gateResult: {
            gateDecisionId: "",
            sessionId: ctx.sessionId, tenantId: ctx.tenantId,
            nodeResults: [], aggregatePolicyAction: "BLOCK",
            evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
          }
        });
      });
    });
  }


  // Fallback to IPC Unix socket:
  return new Promise((resolve) => {
    const socket = net.createConnection(ipcSocketPath);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      resolve({
        layer: 5, success: false, latencyMs: Date.now() - start,
        error: "Gate530 IPC timeout — BLOCK enforced",
        gateResult: {
          gateDecisionId: "",
          sessionId: ctx.sessionId, tenantId: ctx.tenantId,
          nodeResults: [], aggregatePolicyAction: "BLOCK",
          evaluationLatencyMs: timeoutMs, cachedResult: false, quarantinedNodeIds: []
        }
      });
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(JSON.stringify({
        sessionId: ctx.sessionId, tenantId: ctx.tenantId,
        requestContext: {
          detectedActivity,
          jurisdictions: naicsProfile?.jurisdictions ?? ["Federal"],
          riskTolerance: naicsProfile?.riskTolerance ?? 7,
          timestampIso: new Date().toISOString(),
        },
        nodes: [...ctx.ucoContext.nodes, ...ctx.ucoContext.crossCuttingNodes],
      }));
    });

    socket.on("data", (data) => {
      clearTimeout(timer);
      if (timedOut) return;
      try {
        const resp = JSON.parse(data.toString());
        socket.destroy();
        resolve({
          layer: 5, success: resp.ok,
          latencyMs: Date.now() - start,
          gateResult: resp.result as Gate530EvaluationResult,
        });
      } catch (err) {
        socket.destroy();
        resolve({
          layer: 5, success: false, latencyMs: Date.now() - start, error: `Invalid JSON response: ${String(err)}`,
          gateResult: {
            gateDecisionId: "",
            sessionId: ctx.sessionId, tenantId: ctx.tenantId,
            nodeResults: [], aggregatePolicyAction: "BLOCK",
            evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
          }
        });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({
        layer: 5, success: false, latencyMs: Date.now() - start, error: String(err),
        gateResult: {
          gateDecisionId: "",
          sessionId: ctx.sessionId, tenantId: ctx.tenantId,
          nodeResults: [], aggregatePolicyAction: "BLOCK",
          evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
        }
      });
    });
  });
}
