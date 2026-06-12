import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InferenceRequest, NAICSProfile } from "@ios-plus/shared";

const traceIds: string[] = [];

vi.mock("../layers/L2_semantic.js", () => ({
  runL2: vi.fn(async () => ({
    layer: 2,
    success: true,
    latencyMs: 1,
    output: { detectedActivity: "test-activity", entities: [], intent: "test" },
  })),
}));

vi.mock("../layers/L3_ontology.js", () => ({
  runL3: vi.fn(async (_profile: unknown, _resolver: unknown) => ({
    layer: 3,
    success: true,
    latencyMs: 1,
    ucoContext: {
      profileId: "profile",
      naicsCodes: ["5415"],
      resolvedNodeIds: ["UCO-1"],
      nodes: [{ ucoNodeId: "UCO-1", riskWeight: 1 }],
      crossCuttingNodes: [],
      totalNodes: 1,
      resolvedAt: new Date().toISOString(),
    },
  })),
}));

vi.mock("../layers/L4_evidence.js", () => ({
  runL4: vi.fn(async (ctx: { traceId: string }) => {
    traceIds.push(ctx.traceId);
    return {
      layer: 4,
      success: true,
      latencyMs: 1,
      evidencePackage: { packageId: `pkg-${ctx.traceId}` },
    };
  }),
}));

vi.mock("../layers/L5_gate530.js", () => ({
  runL5: vi.fn(async () => ({
    layer: 5,
    success: true,
    latencyMs: 1,
    gateResult: {
      gateDecisionId: "gd-1",
      sessionId: "session",
      tenantId: "tenant",
      nodeResults: [],
      aggregatePolicyAction: "APPROVE",
      evaluationLatencyMs: 1,
      cachedResult: false,
      quarantinedNodeIds: [],
    },
  })),
}));

vi.mock("../layers/L6_rag.js", () => ({
  runL6: vi.fn(async () => ({
    layer: 6,
    success: true,
    latencyMs: 1,
    ragResult: {
      chunks: [],
      sectorPartitionsQueried: [],
      ucoNodeIdsFiltered: [],
      latencyMs: 1,
      efSearchUsed: 0,
    },
  })),
}));

vi.mock("../layers/L7_synthesis.js", () => ({
  runL7: vi.fn(async (ctx: { traceId: string }, _gate: unknown, _rag: unknown, totalLatencyMs: number, latencies: Record<string, number>) => ({
    requestId: `req-${ctx.traceId}`,
    tenantId: "tenant-123",
    sessionId: "session-123",
    output: ctx.traceId,
    policyAction: "APPROVE",
    classificationLevel: "CONFIDENTIAL",
    ucoNodesEvaluated: 0,
    ucoNodeResults: [],
    gateDecisions: [],
    evidencePackages: [],
    totalLatencyMs,
    layerLatencies: { ...latencies },
  })),
}));

let executePipeline: (typeof import("./pipeline.js"))["executePipeline"];

describe("executePipeline race stress", () => {
  beforeAll(async () => {
    ({ executePipeline } = await import("./pipeline.js"));
  });

  it("handles 50 concurrent executions without state bleed", async () => {
    traceIds.length = 0;

    const deps = {
      ucoResolver: {} as never,
      evidenceFabric: {} as never,
      ragVault: {} as never,
      gateDecisionRepository: {
        insertDecision: vi.fn(async () => undefined),
      } as never,
      cosRegistry: {} as never,
    };

    const profile: NAICSProfile = {
      tenantId: "tenant-123",
      naicsCodes: ["5415"],
      additionalSicCodes: [],
      cipCodes: [],
      socCodes: [],
      isicCodes: [],
      hsHtsCodes: [],
      effectiveDate: "2026-01-01",
      jurisdictions: ["Federal"],
      riskTolerance: 5,
    };

    const requests: InferenceRequest[] = Array.from({ length: 50 }).map((_, idx) => ({
      requestId: `request-${idx}`,
      tenantId: "tenant-123",
      sessionId: `session-${idx}`,
      rawInput: `payload-${idx}`,
      contentType: "application/json",
      metadata: { idx },
    }));

    const settled = await Promise.allSettled(requests.map((request) => executePipeline(request, profile, deps)));

    expect(settled.every((entry) => entry.status === "fulfilled")).toBe(true);

    const fulfilled = settled.filter(
      (entry): entry is PromiseFulfilledResult<any> => entry.status === "fulfilled",
    );
    const outputs = fulfilled.map((entry) => entry.value.output);

    expect(new Set(traceIds).size).toBe(50);
    expect(new Set(outputs).size).toBe(50);

    const firstLatencies = fulfilled[0]?.value.layerLatencies;
    const secondLatencies = fulfilled[1]?.value.layerLatencies;
    if (firstLatencies && secondLatencies) {
      expect(firstLatencies).not.toBe(secondLatencies);
    }
  });
});
