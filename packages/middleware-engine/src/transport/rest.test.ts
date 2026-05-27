import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRestApp } from "./rest.js";
import type { PipelineDependencies } from "../orchestrator/pipeline.js";
import type { NAICSProfile } from "@ios-plus/shared";
import type { Server } from "node:http";

describe("REST App Transport Routes Unit Tests", () => {
  let app: any;
  let server: Server;
  let port: number;

  const mockDeps: any = {
    ucoResolver: {},
    evidenceFabric: {
      getQuarantineQueue: async () => [{ quarantineId: "q-123", reason: "Test queue" }],
      getQuarantineRecord: async (id: string) => {
        if (id === "q-123") return { quarantineId: "q-123" };
        return null;
      }
    },
    ragVault: {},
    gateDecisionRepository: {},
    cosRegistry: {
      pool: (role: string) => {
        return {
          query: async (queryText: string, params: any[]) => {
            if (queryText.includes("SELECT * FROM uco_nodes")) {
              return {
                rows: [
                  { uco_node_id: "UCO-TEST-001", governing_agency: "SEC", policy_action: "BLOCK" }
                ]
              };
            }
            if (queryText.includes("INSERT INTO uco_nodes")) {
              return { rows: [] };
            }
            if (queryText.includes("SELECT 1 FROM uco_nodes")) {
              return { rows: [{ '1': 1 }] };
            }
            if (queryText.includes("UPDATE uco_nodes") || queryText.includes("DELETE FROM uco_nodes")) {
              return { rows: [] };
            }
            return { rows: [] };
          }
        };
      }
    }
  };

  const mockProfile: NAICSProfile = {
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

  beforeAll(async () => {
    app = createRestApp(mockDeps, mockProfile);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health returns status ok", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });

  it("GET /v1/compliance/queue returns quarantined records list", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/queue`);
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body[0]?.quarantineId).toBe("q-123");
  });

  it("GET /v1/compliance/rules retrieves active rules list when authenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules?governing_agency=SEC`, {
      headers: { "Authorization": "Bearer iosplus_dev_admin_key" }
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body[0]?.uco_node_id).toBe("UCO-TEST-001");
  });

  it("GET /v1/compliance/rules returns 401 when unauthenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules?governing_agency=SEC`);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toContain("Unauthorized");
  });

  it("POST /v1/compliance/rules creates a new rule when authenticated", async () => {
    const newRule = {
      uco_node_id: "UCO-TEST-002",
      broad_industry: "Finance",
      industry_subtype: "Banking",
      specific_activity: "Lending",
      jurisdiction_level: "Federal",
      governing_agency: "FED",
      regulation_name: "Reg Z",
      naics: "522110",
      ontology_level: "sector",
      enforcement_type: "Warning/Notice",
      risk_weight: 7,
      ybr_gate: "L5",
      policy_action: "BLOCK"
    };

    const res = await fetch(`http://localhost:${port}/v1/compliance/rules`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer iosplus_dev_admin_key"
      },
      body: JSON.stringify(newRule)
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.status).toBe("created");
    expect(body.uco_node_id).toBe("UCO-TEST-002");
  });

  it("POST /v1/compliance/rules returns 401 when unauthenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(401);
  });

  it("PUT /v1/compliance/rules/:id updates fields of a rule when authenticated", async () => {
    const updatePayload = {
      specific_activity: "Mortgage Lending",
      risk_weight: 9
    };

    const res = await fetch(`http://localhost:${port}/v1/compliance/rules/UCO-TEST-002`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer iosplus_dev_admin_key"
      },
      body: JSON.stringify(updatePayload)
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("updated");
  });

  it("PUT /v1/compliance/rules/:id returns 401 when unauthenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules/UCO-TEST-002`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /v1/compliance/rules/:id deletes a rule when authenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules/UCO-TEST-002`, {
      method: "DELETE",
      headers: { "Authorization": "Bearer iosplus_dev_admin_key" }
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("deleted");
  });

  it("DELETE /v1/compliance/rules/:id returns 401 when unauthenticated", async () => {
    const res = await fetch(`http://localhost:${port}/v1/compliance/rules/UCO-TEST-002`, {
      method: "DELETE"
    });
    expect(res.status).toBe(401);
  });
});
