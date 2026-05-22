/**
 * L5 — Gate 530 Screening
 * Timeout budget: 50ms (P99 < 50ms; production measured 47ms)
 * Communicates with Gate 530 sidecar via IPC socket /tmp/gate530.sock.
 * failClosedOnTimeout=true → BLOCK on any timeout.
 */
import net from "node:net";
import type { LayerResult, ExecutionContext } from "@ios-plus/shared";
import type { Gate530EvaluationResult } from "@ios-plus/gate-530";

export async function runL5(
  ctx: ExecutionContext,
  detectedActivity: string,
  ipcSocketPath = "/tmp/gate530.sock",
  timeoutMs = 50
): Promise<LayerResult & { gateResult: Gate530EvaluationResult }> {
  const start = Date.now();
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
          jurisdictions: ["Federal"],
          riskTolerance: 7,
          timestampIso: new Date().toISOString(),
        },
        nodes: [...ctx.ucoContext.nodes, ...ctx.ucoContext.crossCuttingNodes],
      }));
    });

    socket.on("data", (data) => {
      clearTimeout(timer);
      if (timedOut) return;
      const resp = JSON.parse(data.toString());
      socket.destroy();
      resolve({
        layer: 5, success: resp.ok,
        latencyMs: Date.now() - start,
        gateResult: resp.result as Gate530EvaluationResult,
      });
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({
        layer: 5, success: false, latencyMs: Date.now() - start, error: String(err),
        gateResult: {
          sessionId: ctx.sessionId, tenantId: ctx.tenantId,
          nodeResults: [], aggregatePolicyAction: "BLOCK",
          evaluationLatencyMs: Date.now() - start, cachedResult: false, quarantinedNodeIds: []
        }
      });
    });
  });
}
