import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRestApp } from "./rest.js";
import type { PipelineDependencies } from "../orchestrator/pipeline.js";
import type { NAICSProfile } from "@ios-plus/shared";
import type { Server } from "node:http";
import fs from "node:fs";
import { EventEmitter } from "node:events";

// Mock ioredis to allow dynamic health check
vi.mock("ioredis", () => {
  return {
    Redis: class {
      constructor(public url: string) {}
      async ping() {
        if (process.env["TEST_REDIS_HEALTHY"] === "false") {
          throw new Error("Redis connection refused");
        }
        return "PONG";
      }
      async quit() {}
    }
  };
});

// Mock node:net and node:http2 to allow dynamic health check
vi.mock("node:net", () => {
  const createConnection = (path: string) => {
    const emitter = new EventEmitter();
    setTimeout(() => {
      if (process.env["TEST_GATE530_HEALTHY"] === "false") {
        emitter.emit("error", new Error("IPC socket connection refused"));
      } else {
        emitter.emit("connect");
      }
    }, 10);
    (emitter as any).destroy = () => {};
    return emitter;
  };
  return {
    default: { createConnection },
    createConnection
  };
});

vi.mock("node:http2", () => {
  const connect = (url: string) => {
    const emitter = new EventEmitter();
    setTimeout(() => {
      if (process.env["TEST_GATE530_HEALTHY"] === "false") {
        emitter.emit("error", new Error("HTTP/2 connection refused"));
      } else {
        emitter.emit("connect");
      }
    }, 10);
    (emitter as any).destroy = () => {};
    return emitter;
  };
  return {
    default: { connect },
    connect
  };
});

// Spy on fs to mock Vault secrets file presence
const originalExistsSync = fs.existsSync;
vi.spyOn(fs, "existsSync").mockImplementation((path: fs.PathLike): boolean => {
  if (path === "/vault/secrets/ios-plus.env") {
    return process.env["TEST_VAULT_SECRETS_EXISTS"] !== "false";
  }
  return originalExistsSync(path);
});

const originalStatSync = fs.statSync;
vi.spyOn(fs, "statSync").mockImplementation((path: fs.PathLike, options?: any): any => {
  if (path === "/vault/secrets/ios-plus.env") {
    return { size: 100, mtimeMs: Date.now() };
  }
  return originalStatSync(path, options);
});

describe("REST App Transport Routes Unit Tests", () => {
  let app: any;
  let server: Server;
  let port: number;
  let dbHealthy = true;
  let vaultHealthy = true;
  let openaiHealthy = true;
  let originalFetch: any;

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
            if (queryText === "SELECT 1") {
              if (!dbHealthy) throw new Error("Database down");
              return { rows: [{ 1: 1 }] };
            }
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
    originalFetch = global.fetch;
    global.fetch = (async (url: string, options?: any) => {
      if (url.includes("/v1/sys/health")) {
        if (!vaultHealthy) {
          return {
            status: 503,
            json: async () => ({ initialized: true, sealed: true }),
          };
        }
        return {
          status: 200,
          json: async () => ({ initialized: true, sealed: false }),
        };
      }
      if (url.includes("api.openai.com/v1/models")) {
        if (!openaiHealthy) {
          return {
            status: 401,
            json: async () => ({ error: "invalid_key" }),
          };
        }
        return {
          status: 200,
          json: async () => ({ data: [] }),
        };
      }
      return originalFetch(url, options);
    }) as any;

    // Reset default healthy states
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";
    process.env["VAULT_ADDR"] = "http://localhost:8200";
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    process.env["COS_ADMIN_API_KEY"] = "iosplus_dev_admin_key";
    process.env["NODE_ENV"] = "production";

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
    global.fetch = originalFetch;
    process.env["NODE_ENV"] = "test";
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health returns status ok", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ok");
  });

  it("GET /ready returns health 200 status when all dependencies are healthy", async () => {
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe("ready");
    expect(body.checks.database).toBe("healthy");
    expect(body.checks.redis).toBe("healthy");
    expect(body.checks.gate530).toBe("healthy");
    expect(body.checks.vault).toBe("healthy");
    expect(body.checks.vaultSecrets).toContain("healthy");
    expect(body.checks.openai).toBe("healthy");
  });

  it("GET /ready returns 503 degraded when Database is down", async () => {
    dbHealthy = false;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toContain("unhealthy");
    expect(body.checks.redis).toBe("healthy");
  });

  it("GET /ready returns 503 degraded when Redis is down", async () => {
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "false";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toContain("unhealthy");
    expect(body.checks.database).toBe("healthy");
  });

  it("GET /ready returns 503 degraded when Gate 530 is down", async () => {
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "false";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.gate530).toContain("unhealthy");
  });

  it("GET /ready returns 503 degraded when Vault is sealed/unhealthy", async () => {
    dbHealthy = true;
    vaultHealthy = false;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.vault).toContain("unhealthy");
  });

  it("GET /ready returns 503 degraded when Vault secrets config file is missing in production", async () => {
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = true;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "false";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.vaultSecrets).toContain("unhealthy");
  });

  it("GET /ready returns 503 degraded when OpenAI returns invalid credentials", async () => {
    dbHealthy = true;
    vaultHealthy = true;
    openaiHealthy = false;
    process.env["TEST_REDIS_HEALTHY"] = "true";
    process.env["TEST_GATE530_HEALTHY"] = "true";
    process.env["TEST_VAULT_SECRETS_EXISTS"] = "true";

    const res = await fetch(`http://localhost:${port}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("degraded");
    expect(body.checks.openai).toBe("invalid_credentials");
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
