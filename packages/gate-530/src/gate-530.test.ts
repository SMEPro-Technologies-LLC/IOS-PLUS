import { describe, it, expect, vi } from "vitest";
import { Gate530Engine } from "./index.js";
import type { UCONodeSummary } from "@ios-plus/shared";
import http2 from "node:http2";

vi.mock("ioredis", () => {
  class RedisMock {
    private store = new Map<string, any>();

    ping = vi.fn().mockResolvedValue("PONG");
    get = vi.fn().mockImplementation(async (key) => this.store.get(key) || null);
    set = vi.fn().mockImplementation(async (key, val) => {
      this.store.set(key, val);
      return "OK";
    });
    incr = vi.fn().mockImplementation(async (key) => {
      const val = (this.store.get(key) || 0) + 1;
      this.store.set(key, val);
      return val;
    });
    expire = vi.fn().mockResolvedValue(1);
    quit = vi.fn().mockResolvedValue("OK");
  }

  return {
    Redis: RedisMock
  };
});

describe("Gate 530 Logic Engine Unit Tests", () => {
  const engine = new Gate530Engine({
    ipcSocketPath: "/tmp/mock-gate530.sock",
    failClosedOnTimeout: true,
    timeoutMs: 50,
    redisUrl: "redis://localhost:6379",
    sessionCacheTtlSeconds: 900,
    escalationLadderLimit: 2,
    escalationLadderWindowSeconds: 60
  });

  const mockNodeApprove = {
    ucoNodeId: "UCO-FIN-001",
    sector: "Financial Services",
    regulatoryRegime: "SEC",
    specificActivity: "Trading",
    governingAgency: "SEC",
    jurisdictionLevel: "Federal",
    riskWeight: 5,
    policyAction: "APPROVE",
    ruleExpression: "true"
  } as unknown as UCONodeSummary;

  const mockNodeEscalate = {
    ucoNodeId: "UCO-FIN-002",
    sector: "Financial Services",
    regulatoryRegime: "SEC",
    specificActivity: "Margin Account",
    governingAgency: "SEC",
    jurisdictionLevel: "Federal",
    riskWeight: 8,
    policyAction: "ESCALATE",
    ruleExpression: "true"
  } as unknown as UCONodeSummary;

  it("evaluates matching rules and aggregates actions correctly", async () => {
    const req = {
      sessionId: "session-1",
      tenantId: "tenant-1",
      requestContext: {
        detectedActivity: "Trading",
        jurisdictions: ["Federal"],
        riskTolerance: 6,
        timestampIso: new Date().toISOString()
      },
      nodes: [mockNodeApprove]
    };

    const res = await engine.evaluate(req);
    expect(res.aggregatePolicyAction).toBe("APPROVE");
    expect(res.nodeResults[0]?.policyAction).toBe("APPROVE");
  });

  it("escalation logic raises action to BLOCK if limit is exceeded", async () => {
    const req = {
      sessionId: "session-2",
      tenantId: "tenant-1",
      requestContext: {
        detectedActivity: "Margin Account",
        jurisdictions: ["Federal"],
        riskTolerance: 5, // riskTolerance 5 < riskWeight 8 -> triggers ESCALATE
        timestampIso: new Date().toISOString()
      },
      nodes: [mockNodeEscalate]
    };

    // First evaluation: trigger ESCALATE (escalation count = 1)
    let res = await engine.evaluate(req);
    expect(res.aggregatePolicyAction).toBe("ESCALATE");

    // Clear session cache to force re-evaluation
    await (engine as any).redis.set(`gate530:${req.tenantId}:${req.sessionId}`, null);

    // Second evaluation: trigger ESCALATE (escalation count = 2)
    res = await engine.evaluate(req);
    expect(res.aggregatePolicyAction).toBe("ESCALATE");

    // Clear session cache again
    await (engine as any).redis.set(`gate530:${req.tenantId}:${req.sessionId}`, null);

    // Third evaluation: escalation count = 3 > limit 2 -> converts to BLOCK
    res = await engine.evaluate(req);
    expect(res.aggregatePolicyAction).toBe("BLOCK");
    expect(res.nodeResults[0]?.policyAction).toBe("BLOCK");
    expect(res.nodeResults[0]?.rationale).toContain("Escalation rate limit exceeded");
  });

  it("HTTP/2 server handles evaluations correctly", async () => {
    const server = engine.startHTTP2Server(0);
    await new Promise<void>((resolve) => {
      server.on("listening", () => resolve());
    });

    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({
      ":method": "POST",
      ":path": "/",
      "content-type": "application/json",
    });

    const payload = JSON.stringify({
      sessionId: "session-http2",
      tenantId: "tenant-1",
      requestContext: {
        detectedActivity: "Trading",
        jurisdictions: ["Federal"],
        riskTolerance: 6,
        timestampIso: new Date().toISOString()
      },
      nodes: [mockNodeApprove]
    });

    req.write(payload);
    req.end();

    let responseData = "";
    let statusCode = 0;
    req.on("response", (headers) => {
      statusCode = headers[":status"] as number;
    });
    req.on("data", (chunk) => {
      responseData += chunk;
    });

    await new Promise<void>((resolve) => {
      req.on("end", () => {
        client.close();
        server.close(() => resolve());
      });
    });

    expect(statusCode).toBe(200);
    const resp = JSON.parse(responseData);
    expect(resp.ok).toBe(true);
    expect(resp.result.aggregatePolicyAction).toBe("APPROVE");
  });

  it("HTTP/2 server fails closed on timeout", async () => {
    const server = engine.startHTTP2Server(0);
    await new Promise<void>((resolve) => {
      server.on("listening", () => resolve());
    });

    const spy = vi.spyOn(engine, "evaluate").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {} as any;
    });

    const port = (server.address() as any).port;
    const client = http2.connect(`http://localhost:${port}`);
    const req = client.request({
      ":method": "POST",
      ":path": "/",
      "content-type": "application/json",
    });

    const payload = JSON.stringify({
      sessionId: "session-timeout",
      tenantId: "tenant-1",
      requestContext: {
        detectedActivity: "Trading",
        jurisdictions: ["Federal"],
        riskTolerance: 6,
        timestampIso: new Date().toISOString()
      },
      nodes: [mockNodeApprove]
    });

    req.write(payload);
    req.end();

    let responseData = "";
    let statusCode = 0;
    req.on("response", (headers) => {
      statusCode = headers[":status"] as number;
    });
    req.on("data", (chunk) => {
      responseData += chunk;
    });

    await new Promise<void>((resolve) => {
      req.on("end", () => {
        client.close();
        server.close(() => resolve());
      });
    });

    spy.mockRestore();

    expect(statusCode).toBe(200);
    const resp = JSON.parse(responseData);
    expect(resp.ok).toBe(false);
    expect(resp.error).toBe("TIMEOUT_BLOCK");
    expect(resp.result.aggregatePolicyAction).toBe("BLOCK");
  });
});
