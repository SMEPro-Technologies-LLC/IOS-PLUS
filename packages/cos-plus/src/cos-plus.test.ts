import { describe, it, expect, vi } from "vitest";
import { CosConnectionRegistry, EvidenceRepository, GateDecisionRepository } from "./index.js";
import type { EvidencePackage, GateDecisionRecord } from "@ios-plus/shared";

vi.mock("pg", () => {
  const queryMock = vi.fn().mockResolvedValue({ rows: [{ package_id: "pkg-1", payload: {} }] });
  class PoolMock {
    query = queryMock;
    end = vi.fn().mockResolvedValue(undefined);
  }
  return {
    default: {
      Pool: PoolMock
    },
    Pool: PoolMock
  };
});

describe("COS+ Connection Registry and Repositories", () => {
  const config = {
    host: "localhost",
    port: 5432,
    database: "ios_plus",
    ssl: false,
    passwords: {
      ios_app: "app-pass",
      audit_writer: "writer-pass",
      audit_reader: "reader-pass",
      rag_reader: "rag-reader-pass",
      rag_writer: "rag-writer-pass",
      cos_admin: "admin-pass"
    }
  };

  it("registers pools for each of the 6 roles", () => {
    const registry = new CosConnectionRegistry(config);
    expect(registry.pool("ios_app")).toBeDefined();
    expect(registry.pool("audit_writer")).toBeDefined();
    expect(registry.pool("audit_reader")).toBeDefined();
    expect(registry.pool("rag_reader")).toBeDefined();
    expect(registry.pool("rag_writer")).toBeDefined();
    expect(registry.pool("cos_admin")).toBeDefined();
  });

  it("EvidenceRepository insert and query calls the database", async () => {
    const registry = new CosConnectionRegistry(config);
    const repo = new EvidenceRepository(registry);
    
    const mockPkg = {
      packageId: "pkg-1",
      payload: {
        tenantId: "tenant-1",
        sessionId: "session-1",
        eventType: "INFERENCE_REQUEST",
        layerDepth: 4,
        classificationLevel: "CONFIDENTIAL"
      },
      signature: "sig-1",
      verificationKeyId: "key-1",
      signingAlgorithm: "Ed25519",
      canonicalizationAlgorithm: "JCS/RFC8785",
      publishedAt: "2026-05-27T12:00:00Z"
    } as unknown as EvidencePackage;

    await repo.insertEvidencePackage(mockPkg);
    const fetched = await repo.getEvidencePackage("pkg-1");
    expect(fetched).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GateDecisionRepository — batch insertDecisions
// ---------------------------------------------------------------------------

describe("GateDecisionRepository — insertDecisions batch method", () => {
  it("issues exactly one query for multiple decisions (not N queries)", async () => {
    // Use a fresh mock registry that captures query calls
    const queryCapture: { sql: string; params: unknown[] }[] = [];
    const config = {
      host: "localhost", port: 5432, database: "ios_plus", ssl: false,
      passwords: {
        ios_app: "app-pass", audit_writer: "writer-pass", audit_reader: "reader-pass",
        rag_reader: "rag-reader-pass", rag_writer: "rag-writer-pass", cos_admin: "admin-pass"
      }
    };
    const registry = new CosConnectionRegistry(config);

    // Intercept calls through the pool mock
    const pool = registry.pool("audit_writer");
    const originalQuery = (pool as unknown as Record<string, unknown>)["query"];
    const queryCaptureFn = vi.fn().mockImplementation((sql: string, params: unknown[]) => {
      queryCapture.push({ sql, params });
      return Promise.resolve({ rows: [] });
    });
    (pool as unknown as Record<string, unknown>)["query"] = queryCaptureFn;

    const repo = new GateDecisionRepository(registry);

    const decisions: GateDecisionRecord[] = [
      {
        decisionId: "dec-1",
        sessionId: "sess-1",
        tenantId: "tenant-1",
        decidedAt: "2026-06-01T12:00:00Z",
        ucoNodeId: "UCO-001",
        policyAction: "BLOCK",
        riskWeight: 8,
        rationale: "Test reason 1",
        overrideApplied: false,
        evidencePackageId: "pkg-1",
        latencyMs: 5,
      },
      {
        decisionId: "dec-2",
        sessionId: "sess-1",
        tenantId: "tenant-1",
        decidedAt: "2026-06-01T12:00:00Z",
        ucoNodeId: "UCO-002",
        policyAction: "APPROVE",
        riskWeight: 6,
        rationale: "Test reason 2",
        overrideApplied: false,
        evidencePackageId: "pkg-1",
        latencyMs: 3,
      },
      {
        decisionId: "dec-3",
        sessionId: "sess-1",
        tenantId: "tenant-1",
        decidedAt: "2026-06-01T12:00:00Z",
        ucoNodeId: "UCO-003",
        policyAction: "ESCALATE",
        riskWeight: 9,
        rationale: "Test reason 3",
        overrideApplied: false,
        evidencePackageId: "pkg-1",
        latencyMs: 7,
      },
    ];

    await repo.insertDecisions(decisions);

    // Exactly one query should have been issued
    expect(queryCapture).toHaveLength(1);

    const captured = queryCapture[0];
    expect(captured).toBeDefined();

    const { sql, params } = captured!;

    // SQL should contain a multi-row VALUES clause
    expect(sql).toContain("INSERT INTO gate_decisions");
    // 3 rows → should have 3 value groups each starting with ($N
    const valueGroups = sql.match(/\(\$\d+/g);
    expect(valueGroups?.length).toBe(3);

    // Params should be 3 × 12 = 36 values in total
    expect(params).toHaveLength(36);

    // Spot-check: each decision's decisionId is at its row's first param offset
    expect(params[0]).toBe("dec-1");
    expect(params[12]).toBe("dec-2");
    expect(params[24]).toBe("dec-3");

    // Restore
    (pool as unknown as Record<string, unknown>)["query"] = originalQuery;
  });

  it("is a no-op (zero queries) when decisions array is empty", async () => {
    const config = {
      host: "localhost", port: 5432, database: "ios_plus", ssl: false,
      passwords: {
        ios_app: "app-pass", audit_writer: "writer-pass", audit_reader: "reader-pass",
        rag_reader: "rag-reader-pass", rag_writer: "rag-writer-pass", cos_admin: "admin-pass"
      }
    };
    const registry = new CosConnectionRegistry(config);
    const pool = registry.pool("audit_writer");
    const queryMockFn = vi.fn().mockResolvedValue({ rows: [] });
    (pool as unknown as Record<string, unknown>)["query"] = queryMockFn;

    const repo = new GateDecisionRepository(registry);
    await repo.insertDecisions([]);

    expect(queryMockFn).not.toHaveBeenCalled();
  });
});

