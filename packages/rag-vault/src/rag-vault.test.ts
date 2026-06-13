import { beforeEach, describe, expect, it, vi } from "vitest";
import { RAGVaultService } from "./index.js";
import type { UCOContext } from "@ios-plus/shared";

const redisGetMock = vi.fn();
const redisSetMock = vi.fn();
const redisConnectMock = vi.fn();
const openaiEmbeddingCreateMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: openaiEmbeddingCreateMock
      }
    }))
  };
});

vi.mock("ioredis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => ({
      connect: redisConnectMock,
      get: redisGetMock,
      set: redisSetMock
    }))
  };
});

describe("RAG Vault retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisConnectMock.mockResolvedValue(undefined);
    redisGetMock.mockResolvedValue(null);
    redisSetMock.mockResolvedValue("OK");
  });

  const ucoContext: UCOContext = {
    profileId: "profile-1",
    naicsCodes: ["523120"],
    resolvedNodeIds: ["UCO-FINANCE-001"],
    nodes: [{
      ucoNodeId: "UCO-FINANCE-001",
      regulationName: "SEC Rule",
      governingAgency: "SEC",
      specificActivity: "Trading",
      policyAction: "APPROVE",
      riskWeight: 9,
      riskTier: "CRITICAL",
      enforcementType: "Administrative",
      ybrGate: "L5",
      jurisdictionLevel: "Federal",
      lastUpdated: "2026-01-01"
    }],
    crossCuttingNodes: [],
    totalNodes: 1,
    resolvedAt: "2026-06-01T00:00:00.000Z"
  };

  it("retrieves chunks using embedding and partitioned query", async () => {
    const registry = {
      pool: vi.fn().mockReturnValue({ query: poolQueryMock })
    } as any;
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          chunk_id: "chunk-1",
          source_id: "src-1",
          sector_code: "03-FINANCE",
          uco_node_id: "UCO-FINANCE-001",
          chunk_text: "SEC requirements for trading desks",
          metadata: { source: "reg-db" },
          similarity: 0.92
        }]
      });
    openaiEmbeddingCreateMock.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2, 0.3] }]
    });

    const service = new RAGVaultService({
      openaiApiKey: "test-key",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3,
      maxChunksPerQuery: 12,
      similarityThreshold: 0.72,
      redisUrl: "redis://cache:6379",
      cacheTtlSeconds: 300
    }, registry);

    const result = await service.retrieve({
      query: "Trading desk reporting obligations",
      ucoContext,
      maxChunks: 5
    });

    expect(result.chunks).toHaveLength(1);
    expect(result.sectorPartitionsQueried).toContain("03-FINANCE");
    expect(result.efSearchUsed).toBe(128);
    expect(openaiEmbeddingCreateMock).toHaveBeenCalledTimes(1);
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
  });

  it("uses cached embedding when available", async () => {
    const registry = {
      pool: vi.fn().mockReturnValue({ query: poolQueryMock })
    } as any;
    redisGetMock.mockResolvedValue(JSON.stringify([0.4, 0.5, 0.6]));
    poolQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const service = new RAGVaultService({
      openaiApiKey: "test-key",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3,
      maxChunksPerQuery: 12,
      similarityThreshold: 0.72,
      redisUrl: "redis://cache:6379"
    }, registry);

    await service.retrieve({ query: "cached-query", ucoContext });

    expect(openaiEmbeddingCreateMock).not.toHaveBeenCalled();
    expect(poolQueryMock).toHaveBeenCalledTimes(2);
  });

  it("gracefully degrades on transient upstream failures", async () => {
    const registry = {
      pool: vi.fn().mockReturnValue({ query: poolQueryMock })
    } as any;
    openaiEmbeddingCreateMock.mockRejectedValue({ status: 429, code: "insufficient_quota" });

    const service = new RAGVaultService({
      openaiApiKey: "test-key",
      embeddingModel: "text-embedding-3-large",
      embeddingDimensions: 3,
      maxChunksPerQuery: 12,
      similarityThreshold: 0.72
    }, registry);

    const result = await service.retrieve({ query: "degraded", ucoContext });

    expect(result.chunks).toEqual([]);
    expect(result.efSearchUsed).toBe(0);
  });
});
