/**
 * @file crosswalk.ts
 * @description Crosswalk data management: loading, validation, and indexing
 * for CIP ↔ SOC ↔ NAICS mappings used in the UDM traversal engine.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  SocNaicsMapping,
  CipNaicsMapping,
  CipSocMapping,
  ValidationResult,
} from './types.js';

/* ------------------------------------------------------------------ */
/*  CrosswalkIndex                                                      */
/* ------------------------------------------------------------------ */

export class CrosswalkIndex {
  private readonly socToNaics: Map<string, SocNaicsMapping[]> = new Map();
  private readonly cipToNaics: Map<string, CipNaicsMapping[]> = new Map();
  private readonly cipToSoc: Map<string, CipSocMapping[]> = new Map();

  private _frozen = false;

  addSocNaics(mapping: SocNaicsMapping): void {
    if (this._frozen) throw new Error('Index is frozen');
    const list = this.socToNaics.get(mapping.socCode) ?? [];
    list.push(mapping);
    this.socToNaics.set(mapping.socCode, list);
  }

  addCipNaics(mapping: CipNaicsMapping): void {
    if (this._frozen) throw new Error('Index is frozen');
    const list = this.cipToNaics.get(mapping.cipCode) ?? [];
    list.push(mapping);
    this.cipToNaics.set(mapping.cipCode, list);
  }

  addCipSoc(mapping: CipSocMapping): void {
    if (this._frozen) throw new Error('Index is frozen');
    const list = this.cipToSoc.get(mapping.cipCode) ?? [];
    list.push(mapping);
    this.cipToSoc.set(mapping.cipCode, list);
  }

  freeze(): void {
    this._frozen = true;
  }

  /* -- lookups ------------------------------------------------------- */

  getNaicsForSoc(socCode: string): SocNaicsMapping[] {
    return this.socToNaics.get(socCode) ?? [];
  }

  getNaicsForCip(cipCode: string): CipNaicsMapping[] {
    return this.cipToNaics.get(cipCode) ?? [];
  }

  getSocForCip(cipCode: string): CipSocMapping[] {
    return this.cipToSoc.get(cipCode) ?? [];
  }

  hasSocNaics(socCode: string): boolean {
    return this.socToNaics.has(socCode);
  }

  hasCipNaics(cipCode: string): boolean {
    return this.cipToNaics.has(cipCode);
  }

  hasCipSoc(cipCode: string): boolean {
    return this.cipToSoc.has(cipCode);
  }
}

/* ------------------------------------------------------------------ */
/*  CrosswalkLoader                                                     */
/* ------------------------------------------------------------------ */

export class CrosswalkLoader {
  async loadSocNaicsCrosswalk(
    path: string
  ): Promise<SocNaicsMapping[]> {
    const rows: SocNaicsMapping[] = [];
    for await (const line of this._readCsvLines(path)) {
      const [socCode, naicsCode, matchType, confidenceStr] = line;
      if (!socCode || !naicsCode) continue;
      const confidence = parseFloat(confidenceStr);
      rows.push({
        socCode,
        naicsCode,
        matchType: this._parseMatchType(matchType),
        confidence: Number.isFinite(confidence) ? confidence : 0.85,
      });
    }
    return rows;
  }

  async loadCipNaicsCrosswalk(
    path: string
  ): Promise<CipNaicsMapping[]> {
    const rows: CipNaicsMapping[] = [];
    for await (const line of this._readCsvLines(path)) {
      const [cipCode, naicsCode, matchType, confidenceStr] = line;
      if (!cipCode || !naicsCode) continue;
      const confidence = parseFloat(confidenceStr);
      rows.push({
        cipCode,
        naicsCode,
        matchType: this._parseMatchType(matchType),
        confidence: Number.isFinite(confidence) ? confidence : 0.85,
      });
    }
    return rows;
  }

  async loadCipSocCrosswalk(
    path: string
  ): Promise<CipSocMapping[]> {
    const rows: CipSocMapping[] = [];
    for await (const line of this._readCsvLines(path)) {
      const [cipCode, socCode, matchType, confidenceStr] = line;
      if (!cipCode || !socCode) continue;
      const confidence = parseFloat(confidenceStr);
      rows.push({
        cipCode,
        socCode,
        matchType: this._parseMatchType(matchType),
        confidence: Number.isFinite(confidence) ? confidence : 0.85,
      });
    }
    return rows;
  }

  validateCrosswalk(data: SocNaicsMapping[] | CipNaicsMapping[] | CipSocMapping[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();

    for (const row of data) {
      const key =
        'socCode' in row && 'naicsCode' in row
          ? `${(row as SocNaicsMapping).socCode}-${(row as SocNaicsMapping).naicsCode}`
          : 'cipCode' in row && 'naicsCode' in row
            ? `${(row as CipNaicsMapping).cipCode}-${(row as CipNaicsMapping).naicsCode}`
            : `${(row as CipSocMapping).cipCode}-${(row as CipSocMapping).socCode}`;

      if (seen.has(key)) warnings.push(`Duplicate mapping: ${key}`);
      seen.add(key);

      if (row.confidence < 0 || row.confidence > 1) {
        errors.push(`Invalid confidence for ${key}: ${row.confidence}`);
      }

      if (!['direct', 'crosswalk', 'inferred'].includes(row.matchType)) {
        errors.push(`Invalid matchType for ${key}: ${row.matchType}`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  buildIndex(data: SocNaicsMapping[] | CipNaicsMapping[] | CipSocMapping[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const row of data) {
      const leftCode =
        'socCode' in row
          ? row.socCode
          : 'cipCode' in row
            ? row.cipCode
            : (row as CipSocMapping).cipCode;
      const rightCode =
        'socCode' in row && 'naicsCode' in row
          ? (row as SocNaicsMapping).naicsCode
          : 'naicsCode' in row
            ? (row as CipNaicsMapping).naicsCode
            : (row as CipSocMapping).socCode;

      const list = index.get(leftCode) ?? [];
      list.push(rightCode);
      index.set(leftCode, list);
    }
    return index;
  }

  /* -- private helpers ----------------------------------------------- */

  private _parseMatchType(raw: string | undefined): 'direct' | 'crosswalk' | 'inferred' {
    const t = raw?.trim().toLowerCase();
    if (t === 'direct' || t === 'crosswalk' || t === 'inferred') return t;
    return 'crosswalk';
  }

  private async *_readCsvLines(
    path: string
  ): AsyncGenerator<string[]> {
    const stream = createReadStream(path, { encoding: 'utf-8' });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let first = true;
    for await (const line of rl) {
      if (first) {
        first = false; // skip header
        continue;
      }
      yield line.split(',').map((s) => s.trim());
    }

    rl.close();
    stream.destroy();
  }
}
