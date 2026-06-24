/**
 * @file resolver.ts
 * @description Core UcoResolver class. Entry point for the IOS+ UCO
 *   resolver package. Orchestrates database queries, crosswalk lookups,
 *   and UDM traversal to produce licensure determinations.
 */

import {
  ResolverConfig,
  LicensureLookupInput,
  LicensureLookupResult,
  LicensurePath,
  LicensureRequirement,
  CipInfo,
  NaicsInfo,
  SocInfo,
  TraversalConfig,
} from './types.js';

import { UcoDatabaseQueries } from './database.js';
import { TraversalEngine } from './traversal.js';
import { CrosswalkLoader, CrosswalkIndex } from './crosswalk.js';
import {
  validateConfig,
  getDefaultTraversalConfig,
} from './config.js';

/* ------------------------------------------------------------------ */
/*  UcoResolver                                                          */
/* ------------------------------------------------------------------ */

export class UcoResolver {
  private readonly db: UcoDatabaseQueries;
  private readonly traversal: TraversalEngine;
  private readonly crosswalk: CrosswalkIndex;
  private readonly config: ResolverConfig;
  private readonly traversalConfig: TraversalConfig;
  private readonly loader: CrosswalkLoader;
  private initialized = false;

  constructor(config: ResolverConfig) {
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(
        `Invalid resolver configuration: ${validation.errors.join(', ')}`
      );
    }

    this.config = config;
    this.db = new UcoDatabaseQueries(config.pool);
    this.crosswalk = new CrosswalkIndex();
    this.loader = new CrosswalkLoader();
    this.traversalConfig = getDefaultTraversalConfig();
    this.traversal = new TraversalEngine(
      this.db,
      this.crosswalk,
      this.traversalConfig
    );
  }

  /* -- lifecycle ----------------------------------------------------- */

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const paths = this.config.crosswalkPaths;
    if (!paths) {
      this.initialized = true;
      return;
    }

    const promises: Promise<unknown>[] = [];

    if (paths.socToNaics) {
      promises.push(
        this.loader.loadSocNaicsCrosswalk(paths.socToNaics).then((data) => {
          const vr = this.loader.validateCrosswalk(data);
          if (!vr.valid) throw new Error(`socToNaics invalid: ${vr.errors.join(', ')}`);
          for (const row of data) this.crosswalk.addSocNaics(row);
        })
      );
    }
    if (paths.cipToNaics) {
      promises.push(
        this.loader.loadCipNaicsCrosswalk(paths.cipToNaics).then((data) => {
          const vr = this.loader.validateCrosswalk(data);
          if (!vr.valid) throw new Error(`cipToNaics invalid: ${vr.errors.join(', ')}`);
          for (const row of data) this.crosswalk.addCipNaics(row);
        })
      );
    }
    if (paths.cipToSoc) {
      promises.push(
        this.loader.loadCipSocCrosswalk(paths.cipToSoc).then((data) => {
          const vr = this.loader.validateCrosswalk(data);
          if (!vr.valid) throw new Error(`cipToSoc invalid: ${vr.errors.join(', ')}`);
          for (const row of data) this.crosswalk.addCipSoc(row);
        })
      );
    }

    await Promise.all(promises);
    this.crosswalk.freeze();
    this.initialized = true;
  }

  /* -- main lookup --------------------------------------------------- */

  async lookupLicensure(input: LicensureLookupInput): Promise<LicensureLookupResult> {
    await this._ensureInitialized();

    const errors: string[] = [];
    const candidates = await this._safe(
      () => this.db.getLicensureCandidates(input.studentCip, input.destinationState),
      errors,
      'candidate_query'
    );

    const rankedPaths = await this._safe(
      () => this.resolveLicensurePath(input.studentCip, input.destinationState),
      errors,
      'path_resolution'
    );

    return {
      input,
      candidates: candidates ?? [],
      rankedPaths: rankedPaths ? [rankedPaths] : [],
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /* -- resolution helpers ------------------------------------------ */

  async resolveCipToNaics(cip: string): Promise<string[]> {
    await this._ensureInitialized();
    const naics = await this.traversal.traverseCipToNaics(cip);
    return naics.map((n) => n.code);
  }

  async resolveCipToSoc(cip: string): Promise<string[]> {
    await this._ensureInitialized();
    const result = await this.traversal.traverseCipToSocToNaics(cip);
    return result.soc.map((s) => s.code);
  }

  async resolveSocToNaics(soc: string): Promise<string[]> {
    await this._ensureInitialized();
    const codes = await this.db.getNaicsForSoc(soc);
    const cw = this.crosswalk.getNaicsForSoc(soc).map((m) => m.naicsCode);
    return Array.from(new Set([...codes, ...cw]));
  }

  async resolveLicensurePath(cip: string, state: string): Promise<LicensurePath> {
    await this._ensureInitialized();
    const ranked = await this.traversal.traverseToLicensure(cip, state);
    if (ranked.length === 0) {
      return {
        path: {
          cip: { code: cip, title: '', description: '', relatedCips: [] },
          soc: [],
          naics: [],
          state,
          licensure: [],
        },
        confidence: 0,
        risk: 1,
        requirements: [],
      };
    }
    const top = ranked[0];
    return {
      path: top.path,
      confidence: top.confidence,
      risk: top.risk,
      requirements: top.requirements,
    };
  }

  /* -- state / code info --------------------------------------------- */

  async getStateRequirements(state: string): Promise<LicensureRequirement[]> {
    await this._ensureInitialized();
    // Query all licensure requirements for a state (no CIP filter)
    const rows = await this.db.getLicensureCandidates('%', state);
    // Deduplicate by requirement id
    const seen = new Map<string, LicensureRequirement>();
    for (const r of rows) {
      if (!seen.has(r.title)) {
        seen.set(r.title, {
          id: r.title,
          state: r.state,
          title: r.title,
          enforcementType: r.enforcementType ?? 'informational',
        });
      }
    }
    return Array.from(seen.values());
  }

  async getCipInfo(cip: string): Promise<CipInfo> {
    await this._ensureInitialized();
    const node = await this.db.getCipNode(cip);
    return {
      code: node.code,
      title: node.title,
      description: (node.metadata?.description as string) ?? '',
      relatedCips: (node.children ?? []).filter((c) => c !== cip),
    };
  }

  async getNaicsInfo(naics: string): Promise<NaicsInfo> {
    await this._ensureInitialized();
    const rows = await this.config.pool.query<{
      code: string;
      title: string;
      description: string;
      sector: string;
    }>(
      `SELECT code, title, description, sector
       FROM uco_nodes
       WHERE type = 'NAICS' AND code = $1
       LIMIT 1`,
      [naics]
    );
    const row = rows[0];
    if (!row) throw new Error(`NAICS not found: ${naics}`);
    return {
      code: row.code,
      title: row.title,
      description: row.description ?? '',
      sector: row.sector ?? '',
    };
  }

  async getSocInfo(soc: string): Promise<SocInfo> {
    await this._ensureInitialized();
    const rows = await this.config.pool.query<{
      code: string;
      title: string;
      description: string;
      tasks: string[];
    }>(
      `SELECT code, title, description, tasks
       FROM uco_nodes
       WHERE type = 'SOC' AND code = $1
       LIMIT 1`,
      [soc]
    );
    const row = rows[0];
    if (!row) throw new Error(`SOC not found: ${soc}`);
    return {
      code: row.code,
      title: row.title,
      description: row.description ?? '',
      tasks: row.tasks ?? [],
    };
  }

  /* -- private helpers ----------------------------------------------- */

  private async _ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private async _safe<T>(
    fn: () => Promise<T>,
    errors: string[],
    context: string
  ): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`[${context}] ${message}`);
      return undefined;
    }
  }
}
