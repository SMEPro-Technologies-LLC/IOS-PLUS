/**
 * @file database.ts
 * @description Database query layer for the UCO resolver. Wraps the
 *   provided DB pool and exposes typed methods for UDM traversal.
 */

import {
  DatabasePool,
  UcoNode,
  LicensureCandidate,
  LicensureRequirement,
  ObligationMetadata,
} from './types.js';

export class UcoDatabaseQueries {
  constructor(private readonly pool: DatabasePool) {}

  /* -- UCO node retrieval ------------------------------------------ */

  async getCipNode(cip: string): Promise<UcoNode> {
    const rows = await this.pool.query<UcoNode>(
      `SELECT id, type, code, title, parent, children, metadata
       FROM uco_nodes
       WHERE type = 'CIP' AND code = $1
       LIMIT 1`,
      [cip]
    );

    const row = rows[0];
    if (!row) throw new Error(`CIP node not found: ${cip}`);
    return row;
  }

  /* -- crosswalk lookups via DB ------------------------------------ */

  async getNaicsForCip(cip: string): Promise<string[]> {
    const rows = await this.pool.query<{ naics_code: string }>(
      `SELECT naics_code
       FROM uco_cip_naics_crosswalk
       WHERE cip_code = $1`,
      [cip]
    );
    return rows.map((r) => r.naics_code);
  }

  async getSocForCip(cip: string): Promise<string[]> {
    const rows = await this.pool.query<{ soc_code: string }>(
      `SELECT soc_code
       FROM uco_cip_soc_crosswalk
       WHERE cip_code = $1`,
      [cip]
    );
    return rows.map((r) => r.soc_code);
  }

  async getNaicsForSoc(soc: string): Promise<string[]> {
    const rows = await this.pool.query<{ naics_code: string }>(
      `SELECT naics_code
       FROM uco_soc_naics_crosswalk
       WHERE soc_code = $1`,
      [soc]
    );
    return rows.map((r) => r.naics_code);
  }

  /* -- licensure candidates ------------------------------------------ */

  async getLicensureCandidates(
    cip: string,
    state: string
  ): Promise<LicensureCandidate[]> {
    const rows = await this.pool.query<LicensureCandidate>(
      `SELECT cip, state, naics, soc, title, enforcement_type, confidence, risk
       FROM v_state_licensure_candidates
       WHERE cip = $1 AND state = $2`,
      [cip, state]
    );
    return rows.map((r) => ({
      ...r,
      enforcementType: r.enforcementType ?? 'informational',
    }));
  }

  async lookupStateLicensureByCip(
    cip: string,
    state: string
  ): Promise<LicensureRequirement[]> {
    const rows = await this.pool.query<LicensureRequirement>(
      `SELECT * FROM fn_lookup_state_licensure_by_cip($1, $2)`,
      [cip, state]
    );
    return rows.map((r) => ({
      ...r,
      enforcementType: r.enforcementType ?? 'informational',
    }));
  }

  /* -- obligation metadata ------------------------------------------ */

  async getObligationMetadata(
    state: string,
    naics: string
  ): Promise<ObligationMetadata[]> {
    const rows = await this.pool.query<ObligationMetadata>(
      `SELECT state, naics, enforcement_type, authority, effective_date
       FROM uco_obligation_metadata
       WHERE state = $1 AND naics = $2`,
      [state, naics]
    );
    return rows.map((r) => ({
      ...r,
      enforcementType: r.enforcementType ?? 'informational',
    }));
  }
}
