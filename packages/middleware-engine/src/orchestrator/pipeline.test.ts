import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  observeMock,
  runL1Mock,
  runL2Mock,
  runL3Mock,
  runL4Mock,
  runL5Mock,
  runL6Mock,
  runL7Mock
} = vi.hoisted(() => ({
  observeMock: vi.fn(),
  runL1Mock: vi.fn(),
  runL2Mock: vi.fn(),
  runL3Mock: vi.fn(),
  runL4Mock: vi.fn(),
  runL5Mock: vi.fn(),
  runL6Mock: vi.fn(),
  runL7Mock: vi.fn()
}));

vi.mock("../layers/L1_ingestion.js", () => ({ runL1: runL1Mock }));
vi.mock("../layers/L2_semantic.js", () => ({ runL2: runL2Mock }));
vi.mock("../layers/L3_ontology.js", () => ({ runL3: runL3Mock }));
vi.mock("../layers/L4_evidence.js", () => ({ runL4: runL4Mock }));
vi.mock("../layers/L5_gate530.js", () => ({ runL5: runL5Mock }));
vi.mock("../layers/L6_rag.js", () => ({ runL6: runL6Mock }));
vi.mock("../layers/L7_synthesis.js", () => ({ runL7: runL7Mock }));
vi.mock("../transport/metrics.js", () => ({
  MetricsRegistry: {
    observe: observeMock
  }
}));
vi.mock("uuid", () => ({ v4: () => "trace-fixed" }));

import { executePipeline, resumePipeline } from "./pipeline.js";

function createRequest() {
  return {
    requestId: "req-123",
    tenantId: "tenant-123",
    sessionId: "session-123",
    rawInput: "Raw request payload",
    contentType: "text/plain",
    metadata: {}
  };
}

function createProfile() {
  return {
    tenantId: "tenant-123",
    naicsCodes: ["5415"],
    additionalSicCodes: [],
    cipCodes: [],
    socCodes: [],
    isicCodes: [],
    hsHtsCodes: [],
    effectiveDate: "2026-01-01",
    jurisdictions: ["Federal"],
    riskTolerance: 5
  };
}

function createDependencies() {
  return {
    ucoResolver: { name: "resolver" },
    evidenceFabric: {
      createAndCommit: vi.fn()
    },
    ragVault: { name: "rag-vault" },
    gateDecisionRepository: {
      insertDecision: vi.fn()
    },
    cosRegistry: { name: "cos-registry" }
  };
}

describe("Orchestration pipeline contract boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    runL1Mock.mockResolvedValue({
      success: true,
      normalizedInput: "normalized payload",
      latencyMs: 10
    });
    runL2Mock.mockResolvedValue({
      output: {
        detectedActivity: "Trading"
      },
      latencyMs: 20
    });
    runL3Mock.mockResolvedValue({
      ucoContext: {
        resolvedNodeIds: ["UCO-1"],
        nodes: [],
        crossCuttingNodes: []
      },
      latencyMs: 30
    });
    runL4Mock.mockResolvedValue({
      evidencePackage: {
        packageId: "pkg-l4"
      },
      latencyMs: 40
    });
    runL6Mock.mockResolvedValue({
      ragResult: {
        chunks: [{ chunkText: "evidence chunk" }],
        sectorPartitionsQueried: ["finance"],
        ucoNodeIdsFiltered: ["UCO-1"],
        latencyMs: 60,
        efSearchUsed: 1
      },
      latencyMs: 60
    });
    runL7Mock.mockResolvedValue({
      requestId: "req-123",
      tenantId: "tenant-123",
      sessionId: "session-123",
      output: "approved output",
      policyAction: "APPROVE",
      classificationLevel: "CONFIDENTIAL",
      ucoNodesEvaluated: 1,
      ucoNodeResults: [],
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs: 70,
      layerLatencies: { L7: 70 }
    });
  });

  it("short-circuits middleware retrieval on BLOCK while persisting triggered gate decisions", async () => {
    const request = createRequest();
    const profile = createProfile();
    const deps = createDependencies();
    const gateResult = {
      aggregatePolicyAction: "BLOCK" as const,
      nodeResults: [
        {
          triggered: true,
          node: { ucoNodeId: "UCO-1", riskWeight: 9 },
          policyAction: "BLOCK",
          rationale: "hard stop",
          evaluationLatencyMs: 5
        }
      ]
    };

    runL5Mock.mockResolvedValue({
      gateResult,
      latencyMs: 50
    });
    runL7Mock.mockResolvedValueOnce({
      requestId: request.requestId,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      output: "[BLOCKED] response",
      policyAction: "BLOCK",
      classificationLevel: "CONFIDENTIAL",
      ucoNodesEvaluated: 1,
      ucoNodeResults: gateResult.nodeResults,
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs: 75,
      layerLatencies: { L7: 75 }
    });

    const response = await executePipeline(request as any, profile as any, deps as any);

    expect(runL3Mock).toHaveBeenCalledWith(profile, deps.ucoResolver);
    expect(runL4Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: request.requestId,
        sessionId: request.sessionId,
        traceId: "trace-fixed"
      }),
      deps.evidenceFabric,
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(runL5Mock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-fixed" }),
      "Trading",
      profile
    );
    expect(deps.gateDecisionRepository.insertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: request.sessionId,
        tenantId: request.tenantId,
        ucoNodeId: "UCO-1",
        policyAction: "BLOCK",
        evidencePackageId: "pkg-l4"
      })
    );
    expect(runL6Mock).not.toHaveBeenCalled();
    expect(response.policyAction).toBe("BLOCK");
  });

  it("passes normalized input and injected ragVault dependency on APPROVE", async () => {
    const request = createRequest();
    const profile = createProfile();
    const deps = createDependencies();
    const gateResult = {
      aggregatePolicyAction: "APPROVE" as const,
      nodeResults: []
    };

    runL5Mock.mockResolvedValue({
      gateResult,
      latencyMs: 50
    });

    const response = await executePipeline(request as any, profile as any, deps as any);

    expect(runL6Mock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-fixed" }),
      "normalized payload",
      deps.ragVault
    );
    expect(runL7Mock).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: "trace-fixed" }),
      gateResult,
      expect.objectContaining({
        chunks: [{ chunkText: "evidence chunk" }]
      }),
      expect.any(Number),
      expect.objectContaining({
        L1: 10,
        L2: 20,
        L3: 30,
        L4: 40,
        L5: 50,
        L6: 60
      })
    );
    expect(response.output).toBe("approved output");
  });

  it("returns a quarantined response on ESCALATE without calling ragVault", async () => {
    const request = createRequest();
    const profile = createProfile();
    const deps = createDependencies();
    const gateResult = {
      aggregatePolicyAction: "ESCALATE" as const,
      gateDecisionId: "gate-escalate",
      nodeResults: [
        {
          triggered: true,
          node: { ucoNodeId: "UCO-2", riskWeight: 8 },
          policyAction: "ESCALATE",
          rationale: "manual review",
          evaluationLatencyMs: 8
        }
      ]
    };

    runL5Mock.mockResolvedValue({
      gateResult,
      latencyMs: 50
    });

    const response = await executePipeline(request as any, profile as any, deps as any);

    expect(runL6Mock).not.toHaveBeenCalled();
    expect(response.policyAction).toBe("ESCALATE");
    expect(response.output).toBe("[QUARANTINED] Pending compliance review.");
    expect(response.evidencePackages).toEqual([{ packageId: "pkg-l4" }]);
  });

  it("fails fast when Layer 1 rejects the request payload", async () => {
    const request = createRequest();
    const profile = createProfile();
    const deps = createDependencies();

    runL1Mock.mockResolvedValueOnce({
      success: false,
      error: "Missing tenantId or rawInput",
      latencyMs: 1,
      normalizedInput: ""
    });

    await expect(executePipeline(request as any, profile as any, deps as any)).rejects.toThrow("Missing tenantId or rawInput");
    expect(runL2Mock).not.toHaveBeenCalled();
  });

  it("falls back to an empty resume query when the parked context has no original request", async () => {
    const deps = createDependencies();
    const parked = {
      requestHash: "request-hash",
      ctx: {
        requestId: "req-123",
        tenantId: "tenant-123",
        sessionId: "session-123",
        classificationLevel: "CONFIDENTIAL",
        ucoContext: {
          resolvedNodeIds: ["UCO-1"],
          nodes: [],
          crossCuttingNodes: []
        }
      },
      gateResult: {
        gateDecisionId: "gate-123",
        aggregatePolicyAction: "ESCALATE" as const,
        nodeResults: []
      }
    };

    deps.evidenceFabric.createAndCommit.mockResolvedValue({
      packageId: "pkg-l7"
    });

    await resumePipeline(parked as any, "CLEAR", deps as any);

    expect(runL6Mock).toHaveBeenCalledWith(parked.ctx, "", deps.ragVault);
  });

  it("resumes quarantined requests by calling ragVault only on CLEAR and committing the final evidence package", async () => {
    const deps = createDependencies();
    const parked = {
      requestHash: "request-hash",
      ctx: {
        requestId: "req-123",
        tenantId: "tenant-123",
        sessionId: "session-123",
        classificationLevel: "CONFIDENTIAL",
        ucoContext: {
          resolvedNodeIds: ["UCO-1"],
          nodes: [],
          crossCuttingNodes: []
        },
        request: {
          rawInput: "quarantined request"
        }
      },
      gateResult: {
        gateDecisionId: "gate-123",
        aggregatePolicyAction: "ESCALATE" as const,
        nodeResults: []
      }
    };

    deps.evidenceFabric.createAndCommit.mockResolvedValue({
      packageId: "pkg-l7"
    });

    const response = await resumePipeline(parked as any, "CLEAR", deps as any);

    expect(runL6Mock).toHaveBeenCalledWith(parked.ctx, "quarantined request", deps.ragVault);
    expect(deps.evidenceFabric.createAndCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-123",
        sessionId: "session-123",
        requestHash: "request-hash",
        policyAction: "APPROVE",
        metadata: {
          quarantineId: "gate-123",
          originalPolicyAction: "ESCALATE",
          resolution: "CLEAR"
        }
      })
    );
    expect(response.evidencePackages).toEqual([{ packageId: "pkg-l7" }]);
  });

  it("resumes quarantined requests in BLOCK mode without calling ragVault", async () => {
    const deps = createDependencies();
    const parked = {
      requestHash: "request-hash",
      ctx: {
        requestId: "req-123",
        tenantId: "tenant-123",
        sessionId: "session-123",
        classificationLevel: "CONFIDENTIAL",
        ucoContext: {
          resolvedNodeIds: ["UCO-1"],
          nodes: [],
          crossCuttingNodes: []
        },
        request: {
          rawInput: "quarantined request"
        }
      },
      gateResult: {
        gateDecisionId: "gate-123",
        aggregatePolicyAction: "ESCALATE" as const,
        nodeResults: []
      }
    };

    deps.evidenceFabric.createAndCommit.mockResolvedValue({
      packageId: "pkg-l7-block"
    });
    runL7Mock.mockResolvedValueOnce({
      requestId: "req-123",
      tenantId: "tenant-123",
      sessionId: "session-123",
      output: "[BLOCKED] final output",
      policyAction: "BLOCK",
      classificationLevel: "CONFIDENTIAL",
      ucoNodesEvaluated: 1,
      ucoNodeResults: [],
      gateDecisions: [],
      evidencePackages: [],
      totalLatencyMs: 70,
      layerLatencies: { L7: 70 }
    });

    const response = await resumePipeline(parked as any, "BLOCK", deps as any);

    expect(runL6Mock).not.toHaveBeenCalled();
    expect(runL7Mock).toHaveBeenCalledWith(
      parked.ctx,
      expect.objectContaining({ aggregatePolicyAction: "BLOCK" }),
      expect.objectContaining({ chunks: [] }),
      expect.any(Number),
      {}
    );
    expect(deps.evidenceFabric.createAndCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        policyAction: "BLOCK",
        metadata: {
          quarantineId: "gate-123",
          originalPolicyAction: "ESCALATE",
          resolution: "BLOCK"
        }
      })
    );
    expect(response.evidencePackages).toEqual([{ packageId: "pkg-l7-block" }]);
  });
});
