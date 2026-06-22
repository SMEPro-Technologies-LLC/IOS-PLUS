/**
 * @file types.ts
 * @description Internal types for the UCO resolver package.
 * Part of the IOS+ Universal Compliance Operating System (UCOS).
 */

/* ------------------------------------------------------------------
   CIP, NAICS, SOC — informational types
   ------------------------------------------------------------------ */

export interface CipInfo {
  code: string;
  title: string;
  description: string;
  relatedCips: string[];
}

export interface NaicsInfo {
  code: string;
  title: string;
  description: string;
  sector: string;
}

export interface SocInfo {
  code: string;
  title: string;
  description: string;
  tasks: string[];
}

/* ------------------------------------------------------------------
   Licensure lookup types
   ------------------------------------------------------------------ */

export interface LicensureLookupInput {
  studentCip: string;
  destinationState: string;
}

export interface LicensureRequirement {
  id: string;
  state: string;
  title: string;
  enforcementType: 'mandatory' | 'recommended' | 'informational';
  authority?: string;
  effectiveDate?: Date;
  description?: string;
}

export interface LicensureLookupResult {
  input: LicensureLookupInput;
  candidates: LicensureCandidate[];
  rankedPaths: LicensurePath[];
  errors?: string[];
}

/* ------------------------------------------------------------------
   Licensure path — the full step-by-step path from CIP → licensure
   ------------------------------------------------------------------ */

export interface LicensurePath {
  path: TraversalPath;
  confidence: number;
  risk: number;
  requirements: LicensureRequirement[];
}

export interface TraversalPath {
  cip: CipInfo;
  soc: SocInfo[];
  naics: NaicsInfo[];
  state: string;
  licensure: LicensureRequirement[];
}

/* ------------------------------------------------------------------
   Traversal engine types
   ------------------------------------------------------------------ */

export interface LicensureTraversalResult {
  path: TraversalPath;
  confidence: number;
  risk: number;
  requirements: LicensureRequirement[];
}

export interface NaicsCode {
  code: string;
  title: string;
  matchType: 'direct' | 'crosswalk' | 'inferred';
  confidence: number;
}

export interface SocCode {
  code: string;
  title: string;
  matchType: 'direct' | 'crosswalk' | 'inferred';
  confidence: number;
}

/* ------------------------------------------------------------------
   Database / UCO node types
   ------------------------------------------------------------------ */

export interface UcoNode {
  id: string;
  type: 'CIP' | 'NAICS' | 'SOC' | 'STATE' | 'LICENSURE';
  code: string;
  title: string;
  parent?: string | null;
  children?: string[];
  metadata?: Record<string, unknown>;
}

export interface LicensureCandidate {
  cip: string;
  state: string;
  naics: string;
  soc: string;
  title: string;
  enforcementType: 'mandatory' | 'recommended' | 'informational';
  confidence: number;
  risk: number;
}

export interface ObligationMetadata {
  state: string;
  naics: string;
  enforcementType: 'mandatory' | 'recommended' | 'informational';
  authority: string;
  effectiveDate: Date;
}

/* ------------------------------------------------------------------
   Crosswalk types
   ------------------------------------------------------------------ */

export interface SocNaicsMapping {
  socCode: string;
  naicsCode: string;
  matchType: 'direct' | 'crosswalk' | 'inferred';
  confidence: number;
}

export interface CipNaicsMapping {
  cipCode: string;
  naicsCode: string;
  matchType: 'direct' | 'crosswalk' | 'inferred';
  confidence: number;
}

export interface CipSocMapping {
  cipCode: string;
  socCode: string;
  matchType: 'direct' | 'crosswalk' | 'inferred';
  confidence: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------
   Config types
   ------------------------------------------------------------------ */

export interface ResolverConfig {
  pool: DatabasePool;
  censusApiUrl?: string;
  crosswalkPaths?: {
    socToNaics?: string;
    cipToNaics?: string;
    cipToSoc?: string;
  };
}

export interface TraversalConfig {
  directMatchWeight: number;
  crosswalkWeight: number;
  inferredWeight: number;
  maxDepth: number;
  timeoutMs: number;
}

export interface CensusApiConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  retryCount: number;
}

export interface DatabasePool {
  query: <T = unknown>(sql: string, values?: unknown[]) => Promise<T[]>;
}
