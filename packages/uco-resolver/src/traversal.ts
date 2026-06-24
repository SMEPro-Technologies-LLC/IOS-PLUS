/**
 * @file traversal.ts
 * @description Universal Decoding Matrix (UDM) traversal logic for
 *   CIP → SOC → NAICS → State → Licensure resolution.
 */

import {
  NaicsCode,
  SocCode,
  LicensureTraversalResult,
  TraversalPath,
  CipInfo,
  NaicsInfo,
  SocInfo,
  TraversalConfig,
} from './types.js';

import { UcoDatabaseQueries } from './database.js';
import { CrosswalkIndex } from './crosswalk.js';

/* ------------------------------------------------------------------ */
/*  TraversalEngine                                                      */
/* ------------------------------------------------------------------ */

export class TraversalEngine {
  private readonly db: UcoDatabaseQueries;
  private readonly crosswalk: CrosswalkIndex;
  private readonly config: TraversalConfig;

  constructor(
    db: UcoDatabaseQueries,
    crosswalk: CrosswalkIndex,
    config: TraversalConfig
  ) {
    this.db = db;
    this.crosswalk = crosswalk;
    this.config = config;
  }

  /* -- direct traversal paths ---------------------------------------- */

  async traverseCipToNaics(cip: string): Promise<NaicsCode[]> {
    const codes: NaicsCode[] = [];

    // 1. Direct DB crosswalk
    const dbNaics = await this.db.getNaicsForCip(cip);
    for (const n of dbNaics) {
      codes.push({
        code: n,
        title: '', // caller may hydrate from getNaicsInfo
        matchType: 'direct',
        confidence: this.config.directMatchWeight,
      });
    }

    // 2. Crosswalk index
    const cwNaics = this.crosswalk.getNaicsForCip(cip);
    for (const m of cwNaics) {
      if (codes.some((c) => c.code === m.naicsCode)) continue;
      codes.push({
        code: m.naicsCode,
        title: '',
        matchType: m.matchType,
        confidence: m.confidence * this.config.crosswalkWeight,
      });
    }

    return codes;
  }

  async traverseCipToSocToNaics(
    cip: string
  ): Promise<{ soc: SocCode[]; naics: NaicsCode[] }> {
    const socCodes: SocCode[] = [];
    const naicsCodes: NaicsCode[] = [];

    // 1. CIP → SOC
    const dbSoc = await this.db.getSocForCip(cip);
    for (const s of dbSoc) {
      socCodes.push({
        code: s,
        title: '',
        matchType: 'direct',
        confidence: this.config.directMatchWeight,
      });
    }

    const cwSoc = this.crosswalk.getSocForCip(cip);
    for (const m of cwSoc) {
      if (socCodes.some((c) => c.code === m.socCode)) continue;
      socCodes.push({
        code: m.socCode,
        title: '',
        matchType: m.matchType,
        confidence: m.confidence * this.config.crosswalkWeight,
      });
    }

    // 2. SOC → NAICS for each SOC
    for (const soc of socCodes) {
      const dbNaics = await this.db.getNaicsForSoc(soc.code);
      for (const n of dbNaics) {
        if (naicsCodes.some((c) => c.code === n)) continue;
        naicsCodes.push({
          code: n,
          title: '',
          matchType: 'crosswalk',
          confidence: soc.confidence * this.config.crosswalkWeight,
        });
      }

      const cwNaics = this.crosswalk.getNaicsForSoc(soc.code);
      for (const m of cwNaics) {
        if (naicsCodes.some((c) => c.code === m.naicsCode)) continue;
        naicsCodes.push({
          code: m.naicsCode,
          title: '',
          matchType: 'inferred',
          confidence: soc.confidence * m.confidence * this.config.inferredWeight,
        });
      }
    }

    return { soc: socCodes, naics: naicsCodes };
  }

  /* -- full traversal to licensure ----------------------------------- */

  async traverseToLicensure(
    cip: string,
    state: string
  ): Promise<LicensureTraversalResult[]> {
    const cipInfo: CipInfo = { code: cip, title: '', description: '', relatedCips: [] };

    // Path A: CIP → NAICS → State → Licensure
    const directNaics = await this.traverseCipToNaics(cip);
    // Path B: CIP → SOC → NAICS → State → Licensure
    const socNaics = await this.traverseCipToSocToNaics(cip);

    const allNaics = [...directNaics, ...socNaics.naics];
    const deduped = new Map<string, NaicsCode>();
    for (const n of allNaics) {
      const existing = deduped.get(n.code);
      if (!existing || n.confidence > existing.confidence) {
        deduped.set(n.code, n);
      }
    }
    const uniqueNaics = Array.from(deduped.values());

    const socInfo: SocInfo[] = socNaics.soc.map((s) => ({
      code: s.code,
      title: s.title,
      description: '',
      tasks: [],
    }));

    const paths: LicensureTraversalResult[] = [];

    for (const naics of uniqueNaics) {
      const reqs = await this.db.lookupStateLicensureByCip(cip, state);
      const naicsInfo: NaicsInfo = {
        code: naics.code,
        title: naics.title,
        description: '',
        sector: '',
      };

      const path: TraversalPath = {
        cip: cipInfo,
        soc: socInfo,
        naics: [naicsInfo],
        state,
        licensure: reqs,
      };

      const confidence = this.calculateConfidence(path);
      const risk = this.calculateRisk(path);

      paths.push({
        path,
        confidence,
        risk,
        requirements: reqs,
      });
    }

    return this.rankPaths(paths);
  }

  /* -- ranking and scoring ------------------------------------------- */

  rankPaths(paths: LicensureTraversalResult[]): LicensureTraversalResult[] {
    const scored = paths.map((p) => ({
      ...p,
      isDirect: p.path.naics.some((n) => this.isDirectMatch(n.code, p.path.cip.code)),
    }));

    scored.sort((a, b) => {
      // 1. Direct CIP → NAICS match first
      if (a.isDirect && !b.isDirect) return -1;
      if (!a.isDirect && b.isDirect) return 1;

      // 2. Higher confidence descending
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }

      // 3. Lower risk ascending
      return a.risk - b.risk;
    });

    return scored.map(({ isDirect, ...rest }) => rest);
  }

  calculateConfidence(path: TraversalPath): number {
    let score = 0.5;

    // Direct CIP → NAICS presence boosts confidence
    if (path.naics.length > 0) {
      score += 0.2;
    }

    // SOC mapping adds a smaller boost
    if (path.soc.length > 0) {
      score += 0.1;
    }

    // Licensure data present is the strongest signal
    if (path.licensure.length > 0) {
      score += 0.2;
    }

    return Math.min(1, Math.max(0, score));
  }

  calculateRisk(path: TraversalPath): number {
    let risk = 0.5;

    // No licensure requirements found = higher risk of non-compliance
    if (path.licensure.length === 0) {
      risk += 0.3;
    }

    // Inferred mappings (no direct crosswalk) = higher uncertainty
    const hasInferred = path.naics.some((n) => n.code === 'inferred'); // placeholder heuristic
    if (hasInferred) {
      risk += 0.1;
    }

    // No SOC mapping = less career-path specificity
    if (path.soc.length === 0) {
      risk += 0.1;
    }

    return Math.min(1, Math.max(0, risk));
  }

  /* -- helpers ------------------------------------------------------- */

  private isDirectMatch(naicsCode: string, cipCode: string): boolean {
    // In a real implementation, this would check uco_cip_naics_crosswalk
    // for match_type = 'direct'. Here we approximate via the crosswalk index.
    const mappings = this.crosswalk.getNaicsForCip(cipCode);
    return mappings.some((m) => m.naicsCode === naicsCode && m.matchType === 'direct');
  }
}

export type { TraversalPath, LicensureTraversalResult };
