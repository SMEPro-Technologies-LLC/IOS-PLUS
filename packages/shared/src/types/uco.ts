/**
 * UCO (Universal Compliance Ontology) shared types
 * Derived from: Universal Compliance Decoding Matrix — 350 nodes, 30 columns
 *   BLOCK=192 (54.9%), APPROVE=108 (30.9%), ESCALATE=50 (14.3%)
 *   Risk weight floor: 5. Ceiling: 10. Agencies: 80+
 * IOS+ Engineering Body — Document 4 / Amendment v1.1
 * SMEPro Technologies — Confidential
 */

export type PolicyAction = 'BLOCK' | 'APPROVE' | 'ESCALATE';
export type EnforcementType =
  | 'Criminal'
  | 'Civil Monetary Penalty'
  | 'Administrative'
  | 'License/Certificate'
  | 'Injunctive'
  | 'Warning/Notice';
export type JurisdictionLevel = 'Federal' | 'State' | 'Local' | 'International';
export type OntologyLevel = 'sector' | 'subsector' | 'activity' | 'cross-cutting';
export type YBRGate = 'L3' | 'L4' | 'L5' | 'L7';
/** Risk weight is always 5–10 per UCO matrix floor */
export type RiskWeight = 5 | 6 | 7 | 8 | 9 | 10;
export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export function riskWeightToTier(w: RiskWeight): RiskTier {
  if (w >= 9) return 'CRITICAL';
  if (w >= 7) return 'HIGH';
  return 'MEDIUM';
}

/** Full UCO node — 30 columns from Universal Compliance Decoding Matrix */
export interface UCONode {
  // Regulatory Identity (cols 0–19)
  broadIndustry: string; industrySubtype: string; specificActivity: string;
  jurisdictionLevel: JurisdictionLevel; governingAgency: string;
  regulationName: string; cfrUscCitation: string; reportFormName: string;
  formCode: string; filingFrequency: string; keyDueDates: string;
  businessSegment: string; penaltiesConsequences: string;
  cip: string; sic: string; naics: string; soc: string; isic: string; hsHts: string; notes: string;
  // COS+ Engine Metadata (cols 20–29)
  ucoNodeId: string; ontologyLevel: OntologyLevel; complianceChainRef: string;
  operatingSegment: string; responsibleRole: string; enforcementType: EnforcementType;
  riskWeight: RiskWeight; ybrGate: YBRGate; policyAction: PolicyAction; lastUpdated: string;
}

/** Lightweight summary used in ExecutionContext and Gate 530 IPC */
export interface UCONodeSummary {
  ucoNodeId: string; regulationName: string; governingAgency: string;
  policyAction: PolicyAction; riskWeight: RiskWeight; riskTier: RiskTier;
  enforcementType: EnforcementType; ybrGate: YBRGate; jurisdictionLevel: JurisdictionLevel;
  specificActivity?: string;
  lastUpdated?: string;
}

/** Result of evaluating a single UCO node against a request */
export interface UCONodeResult {
  node: UCONodeSummary; evaluated: boolean; triggered: boolean;
  policyAction: PolicyAction; rationale: string; evaluationLatencyMs: number;
}

/** Output of UCO Resolver for a given NAICS profile */
export interface UCOContext {
  profileId: string; naicsCodes: string[]; resolvedNodeIds: string[];
  nodes: UCONodeSummary[];
  /** 19 cross-cutting XSC nodes always injected regardless of sector */
  crossCuttingNodes: UCONodeSummary[];
  totalNodes: number; resolvedAt: string;
}

export interface NAICSProfile {
  tenantId: string;
  naicsCodes: string[];
  additionalSicCodes?: string[];
  cipCodes?: string[];
  socCodes?: string[];
  isicCodes?: string[];
  hsHtsCodes?: string[];
  jurisdictions?: JurisdictionLevel[];
  effectiveDate: string;
  riskTolerance?: number;
}

export type SectorCode =
  '01-ENERGY'|'02-HEALTHCARE'|'03-FINANCE'|'04-FOOD-DRUG-AG'|'05-MFG-TRANSPORT'|
  '06-TELECOM-ENV-DEFENSE'|'07-INSURANCE'|'08-REAL-ESTATE'|'09-AGRICULTURE'|
  '10-MINING'|'11-WHOLESALE-RETAIL'|'12-PROFESSIONAL-SERVICES'|'13-EDUCATION'|
  '14-ARTS-ENTERTAINMENT'|'15-ACCOMMODATION-FOOD'|'16-ADMIN-WASTE'|
  '17-OTHER-SERVICES'|'18-PUBLIC-ADMIN'|'19-MGMT-COMPANIES'|'XSC-CROSS-CUTTING';

export const SECTOR_NODE_COUNTS: Record<SectorCode, number> = {
  '01-ENERGY':54,'02-HEALTHCARE':36,'03-FINANCE':30,'04-FOOD-DRUG-AG':16,
  '05-MFG-TRANSPORT':27,'06-TELECOM-ENV-DEFENSE':20,'07-INSURANCE':35,
  '08-REAL-ESTATE':10,'09-AGRICULTURE':8,'10-MINING':5,'11-WHOLESALE-RETAIL':15,
  '12-PROFESSIONAL-SERVICES':13,'13-EDUCATION':10,'14-ARTS-ENTERTAINMENT':9,
  '15-ACCOMMODATION-FOOD':10,'16-ADMIN-WASTE':9,'17-OTHER-SERVICES':9,
  '18-PUBLIC-ADMIN':9,'19-MGMT-COMPANIES':6,'XSC-CROSS-CUTTING':19
};

/** ef_search per risk tier for HNSW index (RAG Vault EB Doc 5) */
export const HNSW_EF_SEARCH: Record<RiskTier, number> = {
  CRITICAL: 128, HIGH: 64, MEDIUM: 40, LOW: 20
};
