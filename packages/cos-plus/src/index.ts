/**
 * COS+ Database client — PostgreSQL 16 compliance-native columnar store
 * Implements per-role connection pools matching RBAC model:
 *   ios_app, audit_writer, audit_reader, rag_reader, rag_writer, cos_admin
 * P99 read latency target: < 8ms (COS+ SLA per EB Doc 1)
 * 15-minute RPO via WAL streaming replication (archive_timeout=900s)
 * SMEPro Technologies — Confidential
 */

import pg from 'pg';
import type { EvidencePackage, GateDecisionRecord } from '@ios-plus/shared';

const { Pool } = pg;

export type CosRole = 'ios_app' | 'audit_writer' | 'audit_reader' | 'rag_reader' | 'rag_writer' | 'cos_admin';

export interface CosPoolConfig {
  host: string; port: number; database: string; ssl: boolean;
  /** Per-role connection passwords from Vault secrets */
  passwords: Record<CosRole, string>;
  poolSize?: number;   // default 10
}

/** Connection pool registry — one pool per named PostgreSQL role */
export class CosConnectionRegistry {
  private pools = new Map<CosRole, pg.Pool>();

  constructor(private config: CosPoolConfig) {
    const roles: CosRole[] = ['ios_app','audit_writer','audit_reader','rag_reader','rag_writer','cos_admin'];
    for (const role of roles) {
      this.pools.set(role, new Pool({
        host: config.host, port: config.port, database: config.database,
        user: role, password: config.passwords[role],
        ssl: config.ssl ? { rejectUnauthorized: true } : false,
        max: config.poolSize ?? 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }));
    }
  }

  pool(role: CosRole): pg.Pool {
    const p = this.pools.get(role);
    if (!p) throw new Error(`No pool for role: ${role}`);
    return p;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pools.values()].map(p => p.end()));
  }
}

export class EvidenceRepository {
  constructor(private registry: CosConnectionRegistry) {}

  /** Write-once via audit_writer role; WORM trigger enforced at DB layer */
  async insertEvidencePackage(pkg: EvidencePackage): Promise<void> {
    const pool = this.registry.pool('audit_writer');
    await pool.query(
      `INSERT INTO evidence_packages
         (package_id, tenant_id, session_id, event_type, layer_depth,
          canonical_payload, signature, verification_key_id, signing_algorithm,
          canonicalization_algorithm, classification_level, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        pkg.packageId,
        pkg.payload.tenantId,
        pkg.payload.sessionId,
        pkg.payload.eventType,
        pkg.payload.layerDepth,
        JSON.stringify(pkg.payload),
        pkg.signature,
        pkg.verificationKeyId,
        pkg.signingAlgorithm,
        pkg.canonicalizationAlgorithm,
        pkg.payload.classificationLevel,
        pkg.publishedAt,
      ]
    );
  }

  /** audit_reader role — SELECT-only */
  async getEvidencePackage(packageId: string): Promise<EvidencePackage | null> {
    const pool = this.registry.pool('audit_reader');
    const { rows } = await pool.query(
      `SELECT * FROM evidence_packages WHERE package_id = $1`, [packageId]
    );
    if (!rows[0]) return null;
    return rows[0] as unknown as EvidencePackage;
  }
}

export class GateDecisionRepository {
  constructor(private registry: CosConnectionRegistry) {}

  async insertDecision(decision: GateDecisionRecord): Promise<void> {
    const pool = this.registry.pool('audit_writer');
    await pool.query(
      `INSERT INTO gate_decisions
         (decision_id, session_id, tenant_id, decided_at, uco_node_id,
          policy_action, risk_weight, rationale, override_applied,
          override_authorized_by, evidence_package_id, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        decision.decisionId, decision.sessionId, decision.tenantId,
        decision.decidedAt, decision.ucoNodeId, decision.policyAction,
        decision.riskWeight, decision.rationale, decision.overrideApplied,
        decision.overrideAuthorizedBy ?? null, decision.evidencePackageId,
        decision.latencyMs,
      ]
    );
  }
}

export { CosConnectionRegistry as default };
