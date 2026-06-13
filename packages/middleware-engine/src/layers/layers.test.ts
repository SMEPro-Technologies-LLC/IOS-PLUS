import { describe, it, expect, vi, beforeEach } from "vitest";
import { runL1 } from "./L1_ingestion.js";
import { runL2 } from "./L2_semantic.js";
import { runL7 } from "./L7_synthesis.js";

// Mock OpenAI API
vi.mock("openai", () => {
  class OpenAIMock {
    chat = {
      completions: {
        create: vi.fn().mockImplementation(async (args) => {
          const userPrompt = args.messages?.find((message: any) => message.role === "user")?.content ?? "";

          if (userPrompt === "Fallback query") {
            return {
              choices: [
                {
                  message: {
                    content: "{}"
                  }
                }
              ]
            };
          }

          if (userPrompt === "Broken json") {
            return {
              choices: [
                {
                  message: {
                    content: "{not-valid-json"
                  }
                }
              ]
            };
          }

          if (userPrompt === "Trigger synth failure") {
            throw new Error("OpenAI unavailable");
          }

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
    };
  }

  return {
    default: OpenAIMock
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

  it("Layer 1 Ingestion: fails fast when tenantId or rawInput is missing", async () => {
    const res = await runL1({
      requestId: "req-1",
      tenantId: "",
      sessionId: "session-1",
      rawInput: "",
      contentType: "application/json",
      metadata: {}
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("Missing tenantId or rawInput");
  });

  it("Layer 2 Semantics: invokes semantic parser and parses activity output JSON", async () => {
    const res = await runL2("Query text");
    expect(res.success).toBe(true);
    expect(res.output.detectedActivity).toBe("Mocked AI Activity");
    expect(res.output.entities).toContain("MockEntity");
    expect(res.output.intent).toBe("mock-intent");
  });

  it("Layer 2 Semantics: falls back to normalized input defaults when the model omits fields", async () => {
    const res = await runL2("Fallback query");
    expect(res.output.detectedActivity).toBe("Fallback query");
    expect(res.output.entities).toEqual([]);
    expect(res.output.intent).toBe("query");
  });

  it("Layer 2 Semantics: throws error if API key is missing", async () => {
    delete process.env["OPENAI_API_KEY"];
    await expect(runL2("Query text")).rejects.toThrow("OpenAI API Key is missing");
  });

  it("Layer 2 Semantics: surfaces invalid model JSON as a layer failure", async () => {
    await expect(runL2("Broken json")).rejects.toThrow("Layer 2 Semantic Classification failed");
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

  it("Layer 7 Synthesis: uses an empty user prompt when request context is absent", async () => {
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: [], nodes: [], crossCuttingNodes: [] }
    };
    const gateRes: any = { aggregatePolicyAction: "APPROVE", quarantinedNodeIds: [], nodeResults: [] };
    const ragRes: any = { chunks: [{ chunkText: "Mocked RAG chunk text" }] };

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

  it("Layer 7 Synthesis: surfaces model failures as synthesis errors", async () => {
    const ctx: any = {
      requestId: "req-1",
      tenantId: "tenant-1",
      sessionId: "session-1",
      classificationLevel: "CONFIDENTIAL",
      ucoContext: { resolvedNodeIds: [], nodes: [], crossCuttingNodes: [] },
      request: { rawInput: "Trigger synth failure" }
    };
    const gateRes: any = { aggregatePolicyAction: "APPROVE", quarantinedNodeIds: [], nodeResults: [] };
    const ragRes: any = { chunks: [{ chunkText: "Mocked RAG chunk text" }] };

    await expect(runL7(ctx, gateRes, ragRes, 45, {})).rejects.toThrow("Layer 7 Synthesis failed");
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
