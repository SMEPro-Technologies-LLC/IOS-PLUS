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
