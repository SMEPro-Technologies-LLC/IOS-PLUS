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

  app.get("/v1/compliance/queue", async (_req, res) => {
    try {
      const queue = await deps.evidenceFabric.getQuarantineQueue();
      res.json(queue);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/v1/compliance/queue/:quarantineId", async (req, res) => {
    try {
      const record = await deps.evidenceFabric.getQuarantineRecord(req.params.quarantineId);
      if (!record) {
        return res.status(404).json({ error: "Quarantine record not found in database" });
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/v1/compliance/queue/:quarantineId/clear", async (req, res) => {
    const { quarantineId } = req.params;
    const parked = quarantineStore.retrieve(quarantineId);
    if (!parked) {
      return res.status(404).json({ error: `Parked context not found for quarantine ID: ${quarantineId}` });
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
    const parked = quarantineStore.retrieve(quarantineId);
    if (!parked) {
      return res.status(404).json({ error: `Parked context not found for quarantine ID: ${quarantineId}` });
    }
    try {
      const response = await resumePipeline(parked, "BLOCK", deps);
      quarantineStore.remove(quarantineId);
      res.status(403).json(response);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}