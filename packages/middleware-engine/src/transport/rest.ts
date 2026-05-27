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
  app.use(express.static(process.cwd()));

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

  // --- UCO Compliance Rule Management Routes ---

  // API Key Authentication Middleware for admin control plane
  const adminApiKey = process.env["COS_ADMIN_API_KEY"] ?? "iosplus_dev_admin_key";
  
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
    next();
  };

  app.get("/v1/compliance/rules", requireAdminAuth, async (req, res) => {
    try {
      const pool = deps.cosRegistry.pool("cos_admin");
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
      res.json({ status: "deleted", uco_node_id: ucoNodeId });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return app;
}