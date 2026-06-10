/**
 * REST transport — Express HTTP server
 * POST /v1/inference  — main inference endpoint
 * GET  /health        — liveness probe
 * GET  /ready         — readiness probe
 */
import express from "express";
import { v4 as uuidv7 } from "uuid";
import type { InferenceRequest, NAICSProfile } from "@ios-plus/shared";
import type { PipelineDependencies } from "../orchestrator/pipeline.js";
import { executePipeline, resumePipeline } from "../orchestrator/pipeline.js";
import { quarantineStore } from "../orchestrator/quarantineStore.js";
import crypto from "node:crypto";
import fs from "node:fs";
import { MetricsRegistry } from "./metrics.js";

type AmendmentStatus = "pending_review" | "acknowledged" | "approved" | "rejected" | "superseded";
type NodePolicyAction = "BLOCK" | "APPROVE" | "ESCALATE";

interface FirecrawlWebhookPayload {
  type?: string;
  id?: string;
  monitorId?: string;
  timestamp?: string;
  metadata?: {
    uco_node_id?: string;
  };
  data?: {
    url?: string;
    name?: string;
    summary?: string;
  };
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveNodeId(payload: FirecrawlWebhookPayload): string | null {
  const fromMetadata = firstString(payload.metadata?.uco_node_id);
  if (fromMetadata) {
    return fromMetadata;
  }

  const fallback = firstString(payload.data?.name);
  if (!fallback) {
    return null;
  }
  const match = fallback.match(/\bUCO-[A-Z]+-\d+\b/);
  return match?.[0] ?? null;
}

function deriveReviewPolicy(policyAction: NodePolicyAction, riskWeight: number) {
  const reviewRequired = policyAction === "BLOCK" || policyAction === "ESCALATE";
  if (!reviewRequired) {
    return {
      reviewRequired,
      reviewPriority: "P3",
      reviewSlaHours: 0,
      initialStatus: "acknowledged" as AmendmentStatus,
    };
  }

  if (policyAction === "BLOCK") {
    return {
      reviewRequired,
      reviewPriority: riskWeight >= 9 ? "P0" : "P1",
      reviewSlaHours: riskWeight >= 9 ? 24 : 48,
      initialStatus: "pending_review" as AmendmentStatus,
    };
  }

  return {
    reviewRequired,
    reviewPriority: riskWeight >= 8 ? "P1" : "P2",
    reviewSlaHours: riskWeight >= 8 ? 48 : 72,
    initialStatus: "pending_review" as AmendmentStatus,
  };
}

function verifyWebhookSignature(rawBody: Buffer, secret: string, signatureHeader: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const candidates = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .map((part) => part.includes("=") ? part.split("=").slice(1).join("=") : part)
    .map((part) => part.replace(/^sha256=/, "").trim())
    .filter(Boolean);

  return candidates.some((candidate) => {
    try {
      const left = Buffer.from(candidate, "hex");
      const right = Buffer.from(expected, "hex");
      if (left.length !== right.length || left.length === 0) {
        return false;
      }
      return crypto.timingSafeEqual(left, right);
    } catch {
      return false;
    }
  });
}

export function createRestApp(deps: PipelineDependencies, naicsProfile: NAICSProfile) {
  const app = express();
  app.use(express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
  }));
  app.use(express.static(process.cwd()));

  // Middleware to track HTTP requests
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      MetricsRegistry.inc("ios_middleware_http_requests_total", {
        method: req.method,
        path: req.path,
        status: String(res.statusCode)
      });
      // Optionally track overall http latency
      const duration = Date.now() - start;
      MetricsRegistry.observe("ios_middleware_http_latency_ms", duration, {
        method: req.method,
        path: req.path
      });
    });
    next();
  });

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    const checks = {
      database: "unknown",
      redis: "unknown",
      gate530: "unknown",
      vault: "unknown",
      vaultSecrets: "unknown",
      openai: "unknown",
    };
    
    let isHealthy = true;

    // 1. Test Database (ios_app pool)
    try {
      const pool = deps.cosRegistry.pool("ios_app");
      await pool.query("SELECT 1");
      checks.database = "healthy";
    } catch (err) {
      checks.database = `unhealthy: ${String(err)}`;
      isHealthy = false;
    }

    // 2. Test Redis
    try {
      const redisUrl = process.env["REDIS_URL"] || "redis://redis:6379";
      const { Redis } = await import("ioredis");
      const tempRedis = new Redis(redisUrl, { maxRetriesPerRequest: 0, connectTimeout: 1000 });
      const pong = await tempRedis.ping();
      await tempRedis.quit();
      if (pong === "PONG") {
        checks.redis = "healthy";
      } else {
        checks.redis = `unhealthy: received ${pong}`;
        isHealthy = false;
        MetricsRegistry.inc("ios_redis_errors_total", { reason: "invalid_pong" });
      }
    } catch (err) {
      checks.redis = `unhealthy: ${String(err)}`;
      isHealthy = false;
      MetricsRegistry.inc("ios_redis_errors_total", { reason: "exception" });
    }

    // 3. Test Gate 530 sidecar
    try {
      const transport = (process.env["GATE530_TRANSPORT"] as 'ipc' | 'http2') || 'ipc';
      if (transport === 'http2') {
        const port = process.env["GATE530_PORT"] || "3002";
        const http2 = await import("node:http2");
        const client = http2.connect(`http://localhost:${port}`);
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => {
            client.destroy();
            resolve();
          });
          client.on("error", (err) => {
            reject(err);
          });
          setTimeout(() => reject(new Error("Timeout connecting to Gate 530 HTTP/2")), 1000);
        });
        checks.gate530 = "healthy";
      } else {
        const socketPath = process.env["GATE530_IPC_SOCKET"] || "/tmp/gate530.sock";
        const net = await import("node:net");
        const client = net.createConnection(socketPath);
        await new Promise<void>((resolve, reject) => {
          client.on("connect", () => {
            client.destroy();
            resolve();
          });
          client.on("error", (err) => {
            reject(err);
          });
          setTimeout(() => reject(new Error("Timeout connecting to Gate 530 IPC socket")), 1000);
        });
        checks.gate530 = "healthy";
      }
    } catch (err) {
      checks.gate530 = `unhealthy: ${String(err)}`;
      isHealthy = false;
      MetricsRegistry.inc("ios_gate530_errors_total", { reason: "connection_failed" });
    }

    // 4. Test Vault sys health
    try {
      const vaultAddr = process.env["VAULT_ADDR"];
      if (vaultAddr) {
        const response = await fetch(`${vaultAddr}/v1/sys/health`);
        const data: any = await response.json();
        if (data && data.initialized === true && data.sealed === false) {
          checks.vault = "healthy";
        } else {
          checks.vault = `unhealthy: initialized=${data?.initialized}, sealed=${data?.sealed}`;
          isHealthy = false;
        }
      } else {
        checks.vault = "healthy (skipped: VAULT_ADDR not set)";
      }
    } catch (err) {
      checks.vault = `unhealthy: ${String(err)}`;
      isHealthy = false;
    }

    // 5. Test Vault dynamic secrets projection presence / freshness
    const vaultSecretsPath = "/vault/secrets/ios-plus.env";
    if (fs.existsSync(vaultSecretsPath)) {
      try {
        const stats = fs.statSync(vaultSecretsPath);
        const ageSec = (Date.now() - stats.mtimeMs) / 1000;
        if (stats.size > 0) {
          checks.vaultSecrets = `healthy (age: ${Math.round(ageSec)}s, size: ${stats.size}b)`;
        } else {
          checks.vaultSecrets = "unhealthy: empty file";
          isHealthy = false;
        }
      } catch (err) {
        checks.vaultSecrets = `unhealthy: ${String(err)}`;
        isHealthy = false;
      }
    } else {
      // In local dev without Vault, we don't block readiness if environment variables are populated
      if (process.env["NODE_ENV"] !== "production") {
        checks.vaultSecrets = "healthy (local development: file bypassed)";
      } else {
        checks.vaultSecrets = "unhealthy: file missing";
        isHealthy = false;
      }
    }

    // 6. Test OpenAI Egress & API Key validity
    try {
      if (process.env["OPENAI_API_KEY"]) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        // Execute a fast public metadata check that doesn't consume tokens/cost money
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${process.env["OPENAI_API_KEY"]}` },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.status === 200 || res.status === 401) {
          checks.openai = res.status === 200 ? "healthy" : "invalid_credentials";
          if (res.status === 401) {
            isHealthy = false;
          }
        } else {
          checks.openai = `unhealthy: HTTP ${res.status}`;
          isHealthy = false;
        }
      } else {
        checks.openai = "unhealthy: missing API key";
        isHealthy = false;
      }
    } catch (err) {
      checks.openai = `unhealthy: ${String(err)}`;
      isHealthy = false;
    }

    const statusCode = isHealthy ? 200 : 503;
    res.status(statusCode).json({
      status: isHealthy ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/metrics", (_req, res) => {
    // Capture DB Pool metrics dynamically before rendering
    try {
      const iosAppPool = deps.cosRegistry.pool("ios_app");
      const total = (iosAppPool as any).totalCount || 0;
      const idle = (iosAppPool as any).idleCount || 0;
      MetricsRegistry.set("ios_db_pool_saturation", total - idle, { pool: "ios_app" });
    } catch {}

    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(MetricsRegistry.render());
  });


  app.post("/v1/inference", async (req, res) => {
    const requestId = uuidv7();
    try {
      const request: InferenceRequest = {
        requestId,
        tenantId: req.headers["x-tenant-id"] as string ?? "unknown",
        sessionId: req.headers["x-session-id"] as string ?? uuidv7(),
        rawInput: req.body?.input ?? "",
        contentType: "application/json",
        metadata: req.body?.metadata ?? {},
      };
      const response = await executePipeline(request, naicsProfile, deps);

      if (response.policyAction === "ESCALATE") {
        const escNodeRes = response.ucoNodeResults.find(n => n.policyAction === "ESCALATE");
        const ucoNodeId = escNodeRes?.node.ucoNodeId ?? "UCO-XSC-5001";
        const reason = escNodeRes?.rationale ?? "Composite risk score triggers human review.";
        const quarantineId = response.requestId;

        const requestHash = crypto.createHash("sha256").update(request.rawInput).digest("hex");
        const evidenceId = response.evidencePackages[0]?.packageId ?? crypto.randomUUID();

        // 1. Commit quarantine record to database via audit_writer pool
        await deps.evidenceFabric.commitQuarantineRecord({
          quarantineId,
          sessionId: request.sessionId,
          tenantId: request.tenantId,
          ucoNodeId,
          reason,
          policyAction: "ESCALATE",
          evidenceId,
        });

        // 2. Park context in-memory quarantine store
        const l5GateResult = {
          gateDecisionId: quarantineId,
          sessionId: request.sessionId,
          tenantId: request.tenantId,
          nodeResults: response.ucoNodeResults,
          aggregatePolicyAction: "ESCALATE" as const,
          evaluationLatencyMs: 0,
          cachedResult: false,
          quarantinedNodeIds: response.ucoNodeResults.filter(r => r.policyAction === 'BLOCK' || r.policyAction === 'ESCALATE').map(r => r.node.ucoNodeId),
        };

        const ctx = {
          requestId: request.requestId,
          tenantId: request.tenantId,
          sessionId: request.sessionId,
          traceId: uuidv7(),
          classificationLevel: response.classificationLevel,
          ucoContext: {
            profileId: "", naicsCodes: naicsProfile.naicsCodes, resolvedNodeIds: response.ucoNodeResults.map(r => r.node.ucoNodeId),
            nodes: response.ucoNodeResults.map(r => r.node), crossCuttingNodes: [],
            totalNodes: response.ucoNodeResults.length, resolvedAt: new Date().toISOString()
          },
          startedAt: new Date().toISOString(),
          timeouts: { L1: 10, L2: 30, L3: 50, L4: 20, L5: 50, L6: 120, L7: 200 },
          request,
        };

        quarantineStore.park(quarantineId, {
          ctx,
          naicsProfile,
          requestHash,
          gateResult: l5GateResult,
          createdAt: Date.now(),
        });

        // 3. Return 202 Accepted per spec
        return res.status(202).json({
          status: "quarantined",
          quarantine_id: quarantineId,
          review_required: true,
          requestId: response.requestId,
          tenantId: response.tenantId,
          sessionId: response.sessionId,
          policyAction: "ESCALATE",
          totalLatencyMs: response.totalLatencyMs,
          layerLatencies: response.layerLatencies,
        });
      }

      res.status(response.policyAction === "BLOCK" ? 403 : 200).json(response);
    } catch (err) {
      // Structured error log — surfaces full context for debugging
      // while the response stays a clean 500 with the requestId for client correlation.
      console.error(JSON.stringify({
        level: 50,
        time: Date.now(),
        msg: "PIPELINE_ERROR",
        requestId,
        error: String(err),
        stack: (err as Error)?.stack,
      }));
      res.status(500).json({ error: "Internal pipeline error", requestId });
    }
  });

  app.get("/v1/compliance/queue", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] as string ?? "unknown";
    try {
      const queue = await deps.evidenceFabric.getQuarantineQueue(tenantId);
      res.json(queue);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/v1/compliance/queue/:quarantineId", async (req, res) => {
    const tenantId = req.headers["x-tenant-id"] as string ?? "unknown";
    try {
      const record = await deps.evidenceFabric.getQuarantineRecord(req.params.quarantineId, tenantId);
      if (!record) {
        return res.status(404).json({ error: "Quarantine record not found or access denied" });
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/v1/compliance/queue/:quarantineId/clear", async (req, res) => {
    const { quarantineId } = req.params;
    const tenantId = req.headers["x-tenant-id"] as string ?? "unknown";
    const parked = quarantineStore.retrieve(quarantineId);
    if (!parked || parked.ctx.tenantId !== tenantId) {
      return res.status(404).json({ error: `Parked context not found or access denied for quarantine ID: ${quarantineId}` });
    }
    try {
      const response = await resumePipeline(parked, "CLEAR", deps);
      quarantineStore.remove(quarantineId);
      res.json(response);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/v1/compliance/queue/:quarantineId/block", async (req, res) => {
    const { quarantineId } = req.params;
    const tenantId = req.headers["x-tenant-id"] as string ?? "unknown";
    const parked = quarantineStore.retrieve(quarantineId);
    if (!parked || parked.ctx.tenantId !== tenantId) {
      return res.status(404).json({ error: `Parked context not found or access denied for quarantine ID: ${quarantineId}` });
    }
    try {
      const response = await resumePipeline(parked, "BLOCK", deps);
      quarantineStore.remove(quarantineId);
      res.status(403).json(response);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // --- UCO Compliance Rule Management Routes ---

  // API Key Authentication Middleware for admin control plane
  let adminApiKey = process.env["COS_ADMIN_API_KEY"];
  const adminPrincipal = process.env["COS_ADMIN_PRINCIPAL"] ?? "iosplus_dev_admin";
  if (!adminApiKey) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("CRITICAL SECURITY ERROR: COS_ADMIN_API_KEY environment variable is not configured in production mode.");
    }
    adminApiKey = "iosplus_dev_admin_key";
  }
  
  const requireAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers["authorization"] || req.headers["x-admin-api-key"];
    let token = "";
    if (authHeader && typeof authHeader === "string") {
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else {
        token = authHeader;
      }
    }
    
    if (!token || token !== adminApiKey) {
      return res.status(401).json({ error: "Unauthorized: Missing or invalid administrative API key" });
    }
    (req as express.Request & { adminPrincipal?: string }).adminPrincipal = adminPrincipal;
    next();
  };

  app.post("/v1/webhooks/firecrawl/amendments", async (req, res) => {
    const webhookSecret = process.env["FIRECRAWL_WEBHOOK_SECRET"];
    const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signatureHeaderValue = firstString(req.get("x-firecrawl-signature"))
      ?? firstString(req.get("firecrawl-signature"))
      ?? firstString(req.get("x-webhook-signature"))
      ?? firstString(req.get("x-signature"));

    if (!webhookSecret || !signatureHeaderValue || !verifyWebhookSignature(rawBody, webhookSecret, signatureHeaderValue)) {
      MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
      return res.status(401).json({ error: "invalid webhook signature" });
    }

    const payload = req.body as FirecrawlWebhookPayload;
    if (!payload || payload.type !== "monitor.page") {
      MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
      return res.status(400).json({ error: "unsupported webhook payload" });
    }

    const ucoNodeId = resolveNodeId(payload);
    if (!ucoNodeId) {
      MetricsRegistry.inc("ios_amendment_webhook_total", { result: "unresolved" });
      return res.status(422).json({ error: "unable to resolve uco_node_id from payload" });
    }

    const sourceUrl = firstString(payload.data?.url);
    if (!sourceUrl) {
      MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
      return res.status(400).json({ error: "payload missing data.url" });
    }

    const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    const pool = deps.cosRegistry.pool("ios_app");

    try {
      const duplicateCheck = await pool.query(
        "SELECT amendment_id FROM uco_amendments WHERE payload_sha256 = $1",
        [payloadSha256]
      );
      if (duplicateCheck.rows[0]) {
        MetricsRegistry.inc("ios_amendment_webhook_total", { result: "duplicate" });
        return res.status(200).json({ status: "duplicate", payload_sha256: payloadSha256 });
      }

      const nodeSnapshot = await pool.query(
        "SELECT policy_action, risk_weight FROM uco_nodes WHERE uco_node_id = $1",
        [ucoNodeId]
      );
      const node = nodeSnapshot.rows[0] as { policy_action?: NodePolicyAction; risk_weight?: number } | undefined;
      if (!node?.policy_action || typeof node.risk_weight !== "number") {
        MetricsRegistry.inc("ios_amendment_webhook_total", { result: "unresolved" });
        return res.status(422).json({ error: `No matching uco_nodes row for ${ucoNodeId}` });
      }

      const derived = deriveReviewPolicy(node.policy_action, node.risk_weight);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let supersededCount = 0;
        if (derived.initialStatus === "pending_review") {
          const supersede = await client.query(
            `UPDATE uco_amendments SET status = 'superseded'
              WHERE uco_node_id = $1 AND status = 'pending_review'`,
            [ucoNodeId]
          );
          supersededCount = supersede.rowCount ?? 0;
        }

        const insertResult = await client.query(
          `INSERT INTO uco_amendments (
            uco_node_id, monitor_id, event_id, source_url, change_detected_at,
            payload, payload_sha256, diff_summary,
            node_policy_action, node_risk_weight,
            review_required, review_priority, review_sla_hours, status
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14)
          ON CONFLICT (payload_sha256) DO NOTHING
          RETURNING amendment_id`,
          [
            ucoNodeId,
            firstString(payload.monitorId),
            firstString(payload.id),
            sourceUrl,
            firstString(payload.timestamp) ?? new Date().toISOString(),
            JSON.stringify(payload),
            payloadSha256,
            firstString(payload.data?.summary),
            node.policy_action,
            node.risk_weight,
            derived.reviewRequired,
            derived.reviewPriority,
            derived.reviewSlaHours,
            derived.initialStatus
          ]
        );

        if (!insertResult.rows[0]?.amendment_id) {
          await client.query("COMMIT");
          MetricsRegistry.inc("ios_amendment_webhook_total", { result: "duplicate" });
          return res.status(200).json({ status: "duplicate", payload_sha256: payloadSha256 });
        }

        await client.query("COMMIT");
        MetricsRegistry.inc("ios_amendment_webhook_total", { result: "inserted" });
        return res.status(201).json({
          status: "inserted",
          amendment_id: insertResult.rows[0].amendment_id as string,
          superseded: supersededCount,
          payload_sha256: payloadSha256
        });
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        const pgErr = err as { code?: string; detail?: string; message?: string };
        if (pgErr.code === "23505") {
          MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
          return res.status(500).json({
            error: "amendment insert conflict; retry expected",
            code: pgErr.code,
            detail: pgErr.detail ?? pgErr.message ?? "unique violation"
          });
        }

        MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
        return res.status(500).json({ error: "failed to ingest amendment webhook" });
      } finally {
        client.release();
      }
    } catch {
      MetricsRegistry.inc("ios_amendment_webhook_total", { result: "error" });
      return res.status(500).json({ error: "failed to process amendment webhook" });
    }
  });

  app.post("/v1/amendments/:id/review", requireAdminAuth, async (req, res) => {
    const principal = firstString((req as express.Request & { adminPrincipal?: string }).adminPrincipal);
    if (!principal) {
      return res.status(500).json({ error: "auth principal unavailable — cannot attribute review" });
    }

    const requestedStatus = firstString(req.body?.status);
    if (requestedStatus !== "approved" && requestedStatus !== "rejected") {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }

    const assertedReviewer = firstString(req.body?.reviewed_by);
    const rawNotes = firstString(req.body?.notes);
    const notes = [rawNotes, assertedReviewer && assertedReviewer !== principal
      ? `(asserted reviewer: ${assertedReviewer})`
      : null]
      .filter((value): value is string => Boolean(value))
      .join(" ") || null;

    try {
      const pool = deps.cosRegistry.pool("ios_app");
      const updated = await pool.query(
        `UPDATE uco_amendments
          SET status = $2, reviewed_by = $3, reviewed_at = now(), review_notes = $4
          WHERE amendment_id = $1
          RETURNING amendment_id, status, reviewed_by, reviewed_at, review_notes`,
        [req.params["id"], requestedStatus, principal, notes]
      );

      if (!updated.rows[0]) {
        return res.status(404).json({ error: "amendment not found" });
      }

      return res.status(200).json(updated.rows[0]);
    } catch (err) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === "P0001" || pgErr.code === "23514") {
        return res.status(409).json({ error: pgErr.message ?? "invalid amendment status transition" });
      }
      return res.status(500).json({ error: "failed to apply review verdict" });
    }
  });

  app.get("/v1/compliance/rules", requireAdminAuth, async (req, res) => {
    try {
      const pool = deps.cosRegistry.pool("ios_app");
      const { naics, policy_action, governing_agency } = req.query;
      let query = "SELECT * FROM uco_nodes WHERE 1=1";
      const params: any[] = [];
      
      if (naics) {
        params.push(naics);
        query += ` AND naics = $${params.length}`;
      }
      if (policy_action) {
        params.push(policy_action);
        query += ` AND policy_action = $${params.length}`;
      }
      if (governing_agency) {
        params.push(governing_agency);
        query += ` AND governing_agency = $${params.length}`;
      }
      
      query += " ORDER BY uco_node_id ASC LIMIT 100";
      
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/v1/compliance/rules", requireAdminAuth, async (req, res) => {
    try {
      const pool = deps.cosRegistry.pool("cos_admin");
      const b = req.body;
      
      const required = [
        "uco_node_id", "broad_industry", "industry_subtype", "specific_activity",
        "jurisdiction_level", "governing_agency", "regulation_name", "naics",
        "ontology_level", "enforcement_type", "risk_weight", "ybr_gate", "policy_action"
      ];
      for (const f of required) {
        if (b[f] === undefined) {
          return res.status(400).json({ error: `Missing required field: ${f}` });
        }
      }
      
      await pool.query(
        `INSERT INTO uco_nodes (
          uco_node_id, broad_industry, industry_subtype, specific_activity,
          jurisdiction_level, governing_agency, regulation_name, cfr_usc_citation,
          report_form_name, form_code, filing_frequency, key_due_dates,
          business_segment, penalties_consequences, cip, sic, naics, soc,
          isic, hs_hts, notes, ontology_level, compliance_chain_ref,
          operating_segment, responsible_role, enforcement_type, risk_weight,
          ybr_gate, policy_action
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )`,
        [
          b.uco_node_id, b.broad_industry, b.industry_subtype, b.specific_activity,
          b.jurisdiction_level, b.governing_agency, b.regulation_name, b.cfr_usc_citation ?? null,
          b.report_form_name ?? null, b.form_code ?? null, b.filing_frequency ?? null, b.key_due_dates ?? null,
          b.business_segment ?? null, b.penalties_consequences ?? null, b.cip ?? null, b.sic ?? null, b.naics, b.soc ?? null,
          b.isic ?? null, b.hs_hts ?? null, b.notes ?? null, b.ontology_level, b.compliance_chain_ref ?? null,
          b.operating_segment ?? null, b.responsible_role ?? null, b.enforcement_type, parseInt(b.risk_weight),
          b.ybr_gate, b.policy_action
        ]
      );
      
      console.log(JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: "ADMIN_RULE_MUTATION",
        action: "CREATE",
        ucoNodeId: b.uco_node_id,
        actor: "admin_api_key",
        clientIp: req.ip,
        timestampIso: new Date().toISOString()
      }));
      
      res.status(201).json({ status: "created", uco_node_id: b.uco_node_id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/v1/compliance/rules/:ucoNodeId", requireAdminAuth, async (req, res) => {
    try {
      const pool = deps.cosRegistry.pool("cos_admin");
      const { ucoNodeId } = req.params;
      const b = req.body;
      
      const check = await pool.query("SELECT 1 FROM uco_nodes WHERE uco_node_id = $1", [ucoNodeId]);
      if (!check.rows[0]) {
        return res.status(404).json({ error: `Rule not found: ${ucoNodeId}` });
      }
      
      const fields = [
        "broad_industry", "industry_subtype", "specific_activity",
        "jurisdiction_level", "governing_agency", "regulation_name", "cfr_usc_citation",
        "report_form_name", "form_code", "filing_frequency", "key_due_dates",
        "business_segment", "penalties_consequences", "cip", "sic", "naics", "soc",
        "isic", "hs_hts", "notes", "ontology_level", "compliance_chain_ref",
        "operating_segment", "responsible_role", "enforcement_type", "risk_weight",
        "ybr_gate", "policy_action"
      ];
      
      let setClause = "";
      const params: any[] = [ucoNodeId];
      let paramIndex = 2;
      
      for (const f of fields) {
        if (b[f] !== undefined) {
          setClause += (setClause ? ", " : "") + `${f} = $${paramIndex}`;
          params.push(f === "risk_weight" ? parseInt(b[f]) : b[f]);
          paramIndex++;
        }
      }
      
      if (!setClause) {
        return res.status(400).json({ error: "No fields provided to update" });
      }
      
      await pool.query(
        `UPDATE uco_nodes SET ${setClause}, last_updated = CURRENT_DATE WHERE uco_node_id = $1`,
        params
      );
      
      console.log(JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: "ADMIN_RULE_MUTATION",
        action: "UPDATE",
        ucoNodeId,
        actor: "admin_api_key",
        clientIp: req.ip,
        timestampIso: new Date().toISOString()
      }));
      
      res.json({ status: "updated", uco_node_id: ucoNodeId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.delete("/v1/compliance/rules/:ucoNodeId", requireAdminAuth, async (req, res) => {
    try {
      const pool = deps.cosRegistry.pool("cos_admin");
      const { ucoNodeId } = req.params;
      
      const check = await pool.query("SELECT 1 FROM uco_nodes WHERE uco_node_id = $1", [ucoNodeId]);
      if (!check.rows[0]) {
        return res.status(404).json({ error: `Rule not found: ${ucoNodeId}` });
      }
      
      await pool.query("DELETE FROM uco_nodes WHERE uco_node_id = $1", [ucoNodeId]);
      
      console.log(JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: "ADMIN_RULE_MUTATION",
        action: "DELETE",
        ucoNodeId,
        actor: "admin_api_key",
        clientIp: req.ip,
        timestampIso: new Date().toISOString()
      }));
      
      res.json({ status: "deleted", uco_node_id: ucoNodeId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}