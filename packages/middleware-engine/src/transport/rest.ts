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
import { executePipeline } from "../orchestrator/pipeline.js";

export function createRestApp(deps: PipelineDependencies, naicsProfile: NAICSProfile) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", (_req, res) => res.json({ status: "ready" }));

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

  return app;
}