import { describe, it, expect, vi } from "vitest";
import { Gate530Engine } from "./index.js";
import type { UCONodeSummary } from "@ios-plus/shared";

vi.mock("ioredis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => {
      const store = new Map<string, any>();
      return {
        ping: vi.fn().mockResolvedValue("PONG"),
        get: vi.fn().mockImplementation(async (key) => store.get(key) || null),
        set: vi.fn().mockImplementation(async (key, val) => {
          store.set(key, val);
          return "OK";
        }),
        incr: vi.fn().mockImplementation(async (key) => {
          const val = (store.get(key) || 0) + 1;
          store.set(key, val);
          return val;
        }),
        expire: vi.fn().mockResolvedValue(1),
        quit: vi.fn().mockResolvedValue("OK")
      };
    })
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
});
