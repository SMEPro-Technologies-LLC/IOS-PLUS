/**
 * @file database.ts
 * @description Database query layer for the UCO resolver. Wraps the
 *   provided DB pool and exposes typed methods for UDM traversal.
 *
 *   All table/column names below are aligned with the canonical schema:
 *   - uco_nodes        (001_initial_schema.sql)
 *   - uco_crosswalk    (001_initial_schema.sql)
 *   - uco_obligation_metadata (001_initial_schema.sql)
 *   - v_state_licensure_candidates / fn_lookup_state_licensure_by_cip
 *     (authoritative: V11__mini_udm_lamar_operationalization.sql,
 *      overrides 004_udm_views.sql)
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
      `SELECT id, type, code, title, parent_id AS parent, metadata
       FROM uco_nodes
       WHERE type = 'CIP' AND code = $1
       LIMIT 1`,
      [cip]
    );

    const row = rows[0];
    if (!row) throw new Error(`CIP node not found: ${cip}`);
    return row;
  }

  /* -- crosswalk lookups via uco_crosswalk -------------------------
   *  The schema uses a single uco_crosswalk table with source_type /
   *  target_type discriminators rather than per-pair tables.
   * -------------------------------------------------------------- */

  async getNaicsForCip(cip: string): Promise<string[]> {
    const rows = await this.pool.query<{ naics_code: string }>(
      `SELECT target_code AS naics_code
       FROM uco_crosswalk
       WHERE source_type = 'CIP' AND source_code = $1 AND target_type = 'NAICS'`,
      [cip]
    );
    return rows.map((r) => r.naics_code);
  }

  async getSocForCip(cip: string): Promise<string[]> {
    const rows = await this.pool.query<{ soc_code: string }>(
      `SELECT target_code AS soc_code
       FROM uco_crosswalk
       WHERE source_type = 'CIP' AND source_code = $1 AND target_type = 'SOC'`,
      [cip]
    );
    return rows.map((r) => r.soc_code);
  }

  async getNaicsForSoc(soc: string): Promise<string[]> {
    const rows = await this.pool.query<{ naics_code: string }>(
      `SELECT target_code AS naics_code
       FROM uco_crosswalk
       WHERE source_type = 'SOC' AND source_code = $1 AND target_type = 'NAICS'`,
      [soc]
    );
    return rows.map((r) => r.naics_code);
  }

  /* -- licensure candidates ----------------------------------------
   *  v_state_licensure_candidates is defined by
   *  V11__mini_udm_lamar_operationalization.sql (overrides 004).
   *  Column names: cip_code, state_abbrev, soc_code, license_type,
   *  can_practice_in_destination, endorsement_required, practice_notes.
   * -------------------------------------------------------------- */

  async getLicensureCandidates(
    cip: string,
    state: string
  ): Promise<LicensureCandidate[]> {
    const rows = await this.pool.query<{
      cip: string;
      state: string;
      naics: string | null;
      soc: string;
      title: string;
      enforcement_type: string;
      confidence: number;
      risk: number;
    }>(
      `SELECT
         cip_code                                             AS cip,
         state_abbrev                                         AS state,
         NULL::VARCHAR                                        AS naics,
         COALESCE(soc_code, '')                               AS soc,
         license_type                                         AS title,
         CASE WHEN endorsement_required THEN 'mandatory'
              ELSE 'informational'
         END                                                  AS enforcement_type,
         CASE WHEN can_practice_in_destination THEN 0.9
              ELSE 0.5
         END::NUMERIC                                         AS confidence,
         CASE WHEN endorsement_required THEN 0.7
              ELSE 0.3
         END::NUMERIC                                         AS risk
       FROM v_state_licensure_candidates
       WHERE cip_code = $1 AND state_abbrev = $2`,
      [cip, state]
    );
    return rows.map((r) => ({
      cip: r.cip,
      state: r.state,
      naics: r.naics ?? '',
      soc: r.soc,
      title: r.title,
      enforcementType: (r.enforcement_type as LicensureCandidate['enforcementType']) ?? 'informational',
      confidence: Number(r.confidence),
      risk: Number(r.risk),
    }));
  }

  async lookupStateLicensureByCip(
    cip: string,
    state: string
  ): Promise<LicensureRequirement[]> {
    const rows = await this.pool.query<{
      cip_code: string;
      state_abbrev: string;
      license_type: string;
      can_practice: boolean;
      endorsement_required: boolean;
      practice_notes: string | null;
      last_verified: Date | null;
    }>(
      `SELECT cip_code, state_abbrev, license_type, can_practice,
              endorsement_required, practice_notes, last_verified
       FROM fn_lookup_state_licensure_by_cip($1, $2)`,
      [cip, state]
    );
    return rows.map((r) => ({
      id: `${r.cip_code}-${r.state_abbrev}-${r.license_type}`,
      state: r.state_abbrev,
      title: r.license_type,
      enforcementType: (r.endorsement_required ? 'mandatory' : 'informational') as LicensureRequirement['enforcementType'],
      authority: undefined,
      effectiveDate: r.last_verified ?? undefined,
      description: r.practice_notes ?? undefined,
    }));
  }

  /* -- obligation metadata ----------------------------------------
   *  uco_obligation_metadata uses naics_code (not naics).
   * -------------------------------------------------------------- */

  async getObligationMetadata(
    state: string,
    naics: string
  ): Promise<ObligationMetadata[]> {
    const rows = await this.pool.query<{
      state: string;
      naics_code: string;
      enforcement_type: string;
      authority: string | null;
      effective_date: Date | null;
    }>(
      `SELECT state, naics_code, enforcement_type, authority, effective_date
       FROM uco_obligation_metadata
       WHERE state = $1 AND naics_code = $2`,
      [state, naics]
    );
    return rows.map((r) => ({
      state: r.state,
      naics: r.naics_code,
      enforcementType: (r.enforcement_type as ObligationMetadata['enforcementType']) ?? 'informational',
      authority: r.authority ?? '',
      effectiveDate: r.effective_date ?? new Date(0),
    }));
  }
}
