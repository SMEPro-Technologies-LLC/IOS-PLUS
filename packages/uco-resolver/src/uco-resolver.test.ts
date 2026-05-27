import { describe, it, expect, vi } from "vitest";
import { UCOResolver } from "./index.js";
import type { NAICSProfile } from "@ios-plus/shared";

vi.mock("pg", () => {
  const queryMock = vi.fn().mockImplementation(async (queryText, params) => {
    if (queryText.includes("code_crosswalk")) {
      return { rows: [{ target_code: "5415" }] };
    }
    if (queryText.includes("ontology_level != 'cross-cutting'")) {
      return {
        rows: [
          {
            uco_node_id: "UCO-FIN-001",
            regulation_name: "SEC Rule 10b-5",
            governing_agency: "SEC",
            policy_action: "APPROVE",
            risk_weight: 4,
            enforcement_type: "ADMINISTRATIVE",
            ybr_gate: "L5",
            jurisdiction_level: "Federal",
            naics: "5415",
            ontology_level: "functional"
          }
        ]
      };
    }
    if (queryText.includes("ontology_level = 'cross-cutting'")) {
      return {
        rows: [
          {
            uco_node_id: "UCO-XSC-5001",
            regulation_name: "Cross Cutting Rule",
            governing_agency: "EPA",
            policy_action: "ESCALATE",
            risk_weight: 7,
            enforcement_type: "ADMINISTRATIVE",
            ybr_gate: "L5",
            jurisdiction_level: "Federal",
            naics: "5415",
            ontology_level: "cross-cutting"
          }
        ]
      };
    }
    return { rows: [] };
  });

  return {
    default: {
      Pool: vi.fn().mockImplementation(() => {
        return {
          query: queryMock,
          end: vi.fn().mockResolvedValue(undefined)
        };
      })
    }
  };
});

describe("UCO Resolver Unit Tests", () => {
  const resolver = new UCOResolver({
    databaseUrl: "postgresql://localhost:5432/test",
    cacheTtlSeconds: 1
  });

  it("resolves a NAICS profile to sector and XSC nodes", async () => {
    const profile: NAICSProfile = {
      tenantId: "tenant-1",
      naicsCodes: ["5415"],
      additionalSicCodes: [],
      cipCodes: [],
      socCodes: [],
      isicCodes: [],
      hsHtsCodes: [],
      effectiveDate: "2026-01-01",
      jurisdictions: ["Federal"],
      riskTolerance: 6
    };

    const ctx = await resolver.resolve(profile);
    expect(ctx.totalNodes).toBe(2);
    expect(ctx.nodes[0]?.ucoNodeId).toBe("UCO-FIN-001");
    expect(ctx.crossCuttingNodes[0]?.ucoNodeId).toBe("UCO-XSC-5001");
  });
});
