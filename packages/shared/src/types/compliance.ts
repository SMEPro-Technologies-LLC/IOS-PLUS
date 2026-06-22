export enum ComplianceDimension {
  REGULATORY = 'regulatory',
  SECURITY = 'security',
  PRIVACY = 'privacy',
  OPERATIONAL = 'operational',
  ETHICAL = 'ethical',
  SECTOR_SPECIFIC = 'sector_specific',
}

export type ComplianceDecision = {
  action: 'allow' | 'deny' | 'escalate';
  reason: string;
  dimension: ComplianceDimension;
  confidence: number;
  metadata: Record<string, unknown>;
};

export type PolicyCondition =
  | { operator: 'eq'; field: string; value: unknown }
  | { operator: 'neq'; field: string; value: unknown }
  | { operator: 'gt' | 'lt' | 'gte' | 'lte'; field: string; value: number }
  | { operator: 'in' | 'nin'; field: string; value: readonly unknown[] }
  | { operator: 'contains' | 'startsWith' | 'endsWith'; field: string; value: string }
  | { operator: 'exists'; field: string; value: boolean }
  | { operator: 'and' | 'or'; conditions: readonly PolicyCondition[] }
  | { operator: 'not'; condition: PolicyCondition };

export type PolicyRule = {
  id: string;
  name: string;
  dimension: ComplianceDimension;
  condition: PolicyCondition;
  effect: 'allow' | 'deny';
  priority: number;
  sector?: string;
};

export type EvaluationContext = {
  requestId: string;
  timestamp: string;
  actorId: string;
  resourceId: string;
  action: string;
  sector?: string;
  metadata: Record<string, unknown>;
};
