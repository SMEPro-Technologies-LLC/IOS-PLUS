/**
 * UCO Resolver — NAICS profile → UCO node selection
 * IOS+ Engineering Body — Amendment v1.1 (UCO Architecture)
 * Resolves 350-node Universal Compliance Decoding Matrix against tenant NAICS profile.
 * XSC cross-cutting nodes (UCO-XSC-5xxx, 19 nodes) always injected regardless of sector.
 * SMEPro Technologies — Confidential
 */

import type {
  UCOContext, UCONodeSummary, NAICSProfile, SectorCode, RiskWeight, RiskTier,
  PolicyAction, EnforcementType, JurisdictionLevel, YBRGate, OntologyLevel
} from '@ios-plus/shared';
import { riskWeightToTier } from '@ios-plus/shared';
import pg from 'pg';

const { Pool } = pg;

export interface UCOResolverConfig {
  /** COS+ database connection string for rag_reader role */
  databaseUrl: string;
  /** Maximum UCO nodes returned per sector (default: all) */
  maxNodesPerSector?: number;
  /** Cache TTL in seconds (default: 300) */
  cacheTtlSeconds?: number;
}

interface UCONodeRow {
  uco_node_id: string;
  regulation_name: string;
  governing_agency: string;
  policy_action: PolicyAction;
  risk_weight: number;
  enforcement_type: EnforcementType;
  ybr_gate: YBRGate;
  jurisdiction_level: JurisdictionLevel;
  naics: string;
  ontology_level: OntologyLevel;
  compliance_chain_ref: string;
}

export class UCOResolver {
  private pool: pg.Pool;
  private config: UCOResolverConfig;
  /** In-memory LRU cache: profileId → UCOContext */
  private cache = new Map<string, { ctx: UCOContext; expiresAt: number }>();

  constructor(config: UCOResolverConfig) {
    this.config = config;
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  /**
   * Resolve UCO context for a NAICS profile.
   * L3 (Ontological Mapping) calls this before Gate 530 (L5).
   */
  async resolve(profile: NAICSProfile): Promise<UCOContext> {
    const profileId = this.buildProfileId(profile);
    const cached = this.cache.get(profileId);
    if (cached && cached.expiresAt > Date.now()) return cached.ctx;

    const [sectorNodes, xscNodes] = await Promise.all([
      this.querySectorNodes(profile.naicsCodes),
      this.queryXSCNodes(),
    ]);

    const ctx: UCOContext = {
      profileId,
      naicsCodes: profile.naicsCodes,
      resolvedNodeIds: sectorNodes.map(n => n.ucoNodeId),
      nodes: sectorNodes,
      crossCuttingNodes: xscNodes,
      totalNodes: sectorNodes.length + xscNodes.length,
      resolvedAt: new Date().toISOString(),
    };

    const ttl = (this.config.cacheTtlSeconds ?? 300) * 1000;
    this.cache.set(profileId, { ctx, expiresAt: Date.now() + ttl });
    return ctx;
  }

  private async querySectorNodes(naicsCodes: string[]): Promise<UCONodeSummary[]> {
    const { rows } = await this.pool.query<UCONodeRow>(
      `SELECT uco_node_id, regulation_name, governing_agency, policy_action,
              risk_weight, enforcement_type, ybr_gate, jurisdiction_level, naics, ontology_level
       FROM uco_nodes
       WHERE naics = ANY($1::text[])
         AND ontology_level != 'cross-cutting'
       ORDER BY risk_weight DESC, uco_node_id`,
      [naicsCodes]
    );
    return rows.map(r => this.rowToSummary(r));
  }

  private async queryXSCNodes(): Promise<UCONodeSummary[]> {
    const { rows } = await this.pool.query<UCONodeRow>(
      `SELECT uco_node_id, regulation_name, governing_agency, policy_action,
              risk_weight, enforcement_type, ybr_gate, jurisdiction_level, naics, ontology_level
       FROM uco_nodes
       WHERE ontology_level = 'cross-cutting'
         AND uco_node_id LIKE 'UCO-XSC-5%'
       ORDER BY risk_weight DESC, uco_node_id`
    );
    return rows.map(r => this.rowToSummary(r));
  }

  private rowToSummary(r: UCONodeRow): UCONodeSummary {
    const riskWeight = r.risk_weight as RiskWeight;
    return {
      ucoNodeId: r.uco_node_id,
      regulationName: r.regulation_name,
      governingAgency: r.governing_agency,
      policyAction: r.policy_action,
      riskWeight,
      riskTier: riskWeightToTier(riskWeight),
      enforcementType: r.enforcement_type,
      ybrGate: r.ybr_gate,
      jurisdictionLevel: r.jurisdiction_level,
    };
  }

  private buildProfileId(profile: NAICSProfile): string {
    return `${profile.tenantId}::${profile.naicsCodes.sort().join(',')}::${profile.effectiveDate}`;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type { UCOContext, UCONodeSummary, NAICSProfile } from '@ios-plus/shared';
