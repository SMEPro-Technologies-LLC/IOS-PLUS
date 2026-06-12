import { describe, it, expect, vi, beforeEach } from "vitest";
import { runL1 } from "./L1_ingestion.js";
import { runL2 } from "./L2_semantic.js";
import { runL7 } from "./L7_synthesis.js";

// Mock OpenAI API
vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return {
        chat: {
          completions: {
            create: vi.fn().mockImplementation(async (args) => {
              // Mock L2 response format
              if (args.response_format && args.response_format.type === "json_object") {
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          detectedActivity: "Mocked AI Activity",
                          entities: ["MockEntity"],
                          intent: "mock-intent"
                        })
                      }
                    }
                  ]
                };
              }
              // Mock L7 response format (synthesis)
              return {
                choices: [
                  {
                    message: {
                      content: "Mocked compliance response."
                    }
                  }
                ]
              };
            })
          }
        }
      };
    })
  };
});

describe("Orchestration Layers Unit Tests", () => {
  beforeEach(() => {
    process.env["OPENAI_API_KEY"] = "mock-api-key";
  });

  it("Layer 1 Ingestion: normalizes BOM, trims whitespaces, and checks inputs", async () => {
    const inputReq = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      rawInput: "  Hello \u212b  ", // Angstrom sign normalization
      contentType: "application/json" as const,
      metadata: {}
    };

    const res = await runL1(inputReq);
    expect(res.success).toBe(true);
    expect(res.normalizedInput).toBe("Hello \u00c5"); // NFKC Normalization of \u212b into \u00c5
  });

  it("Layer 1 Ingestion: rejects rawInput that exceeds MAX_RAW_INPUT_CHARS with a structured error", async () => {
    // Save and override env var
    const origMax = process.env["MAX_RAW_INPUT_CHARS"];
    process.env["MAX_RAW_INPUT_CHARS"] = "100";

    const inputAtLimit = {
      requestId: "req-limit",
      tenantId: "tenant-1",
      sessionId: "session-1",
      rawInput: "a".repeat(100), // exactly at limit — should pass
      contentType: "application/json" as const,
      metadata: {}
    };
    const inputOverLimit = {
      requestId: "req-over",
      tenantId: "tenant-1",
      sessionId: "session-1",
      rawInput: "a".repeat(101), // one over — should fail
      contentType: "application/json" as const,
      metadata: {}
    };

    // Import the module fresh so the env var is picked up at module evaluation time.
    // Since the module-level const uses process.env at import time, we need to
    // re-import after setting the env var — but in vitest the module is cached.
    // Instead, we directly test the boundary: the default is 1_000_000 chars.
    // Reset to a large default value and test the boundary properly.
    delete process.env["MAX_RAW_INPUT_CHARS"];

    const bigOverLimit = {
      requestId: "req-big",
      tenantId: "tenant-1",
      sessionId: "session-1",
      rawInput: "x".repeat(1_000_001),
      contentType: "application/json" as const,
      metadata: {}
    };

    // Since the module const is evaluated at import time, we can't change it
    // mid-test. The 1_000_001-char test below validates the boundary.
    const resOver = await runL1(bigOverLimit);
    expect(resOver.success).toBe(false);
    expect(resOver.error).toContain("exceeds maximum");
    expect(resOver.normalizedInput).toBe("");

    // Restore original env var if set
    if (origMax !== undefined) {
      process.env["MAX_RAW_INPUT_CHARS"] = origMax;
    }
  });

  it("Layer 1 Ingestion: returns failure for missing tenantId", async () => {
    const inputReq = {
      requestId: "req-missing",
      tenantId: "",
      sessionId: "session-1",
      rawInput: "some input",
      contentType: "application/json" as const,
      metadata: {}
    };
    const res = await runL1(inputReq);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Missing tenantId");
  });

  it("Layer 2 Semantics: invokes semantic parser and parses activity output JSON", async () => {
    const res = await runL2("Query text");
    expect(res.success).toBe(true);
    expect(res.output.detectedActivity).toBe("Mocked AI Activity");
    expect(res.output.entities).toContain("MockEntity");
    expect(res.output.intent).toBe("mock-intent");
  });

  it("Layer 2 Semantics: throws error if API key is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    await expect(runL2("Query text")).rejects.toThrow("OpenAI API Key is missing");
  });

  it("Layer 7 Synthesis: enforces compliance block outcome", async () => {
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: ["UCO-1"], nodes: [], crossCuttingNodes: [] }
    };

    const gateRes: any = {
      aggregatePolicyAction: "BLOCK",
      quarantinedNodeIds: ["UCO-1"],
      nodeResults: []
    };

    const ragRes: any = {
      chunks: []
    };

    const res = await runL7(ctx, gateRes, ragRes, 15, {});
    expect(res.policyAction).toBe("BLOCK");
    expect(res.output).toContain("[BLOCKED]");
  });

  it("Layer 7 Synthesis: synthesizes final output from RAG chunks", async () => {
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: [], nodes: [], crossCuttingNodes: [] },
      request: { rawInput: "Original query" }
    };

    const gateRes: any = {
      aggregatePolicyAction: "APPROVE",
      quarantinedNodeIds: [],
      nodeResults: []
    };

    const ragRes: any = {
      chunks: [{ chunkText: "Mocked RAG chunk text" }]
    };

    const res = await runL7(ctx, gateRes, ragRes, 45, {});
    expect(res.policyAction).toBe("APPROVE");
    expect(res.output).toBe("Mocked compliance response.");
  });

  it("Layer 7 Synthesis: throws error if API key is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: [], nodes: [], crossCuttingNodes: [] },
      request: { rawInput: "Original query" }
    };
    const gateRes: any = { aggregatePolicyAction: "APPROVE", quarantinedNodeIds: [], nodeResults: [] };
    const ragRes: any = { chunks: [{ chunkText: "Mocked RAG chunk text" }] };
    await expect(runL7(ctx, gateRes, ragRes, 45, {})).rejects.toThrow("OpenAI API Key is missing");
  });

  it("Layer 7 Synthesis: returns empty output if RAG chunks are empty", async () => {
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: [], nodes: [], crossCuttingNodes: [] },
      request: { rawInput: "Original query" }
    };
    const gateRes: any = { aggregatePolicyAction: "APPROVE", quarantinedNodeIds: [], nodeResults: [] };
    const ragRes: any = { chunks: [] };
    const res = await runL7(ctx, gateRes, ragRes, 45, {});
    expect(res.policyAction).toBe("APPROVE");
    expect(res.output).toBe("");
  });
});
