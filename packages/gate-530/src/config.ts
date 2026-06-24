export type ComplianceDimension =
  | 'data_privacy'
  | 'security'
  | 'ethics'
  | 'operational'
  | 'regulatory'
  | 'financial';

/**
 * A policy condition for rule evaluation.
 * Two forms are supported:
 *   1. Simple scalar check: set `operator` and `field` (and optionally `value`).
 *   2. Logical grouping: set `logical` ('and'|'or') and `conditions`. In this form
 *      `operator` and `field` are not required. Pre-existing rules using
 *      `operator: 'and'` as a grouping operator should be migrated to use
 *      `logical: 'and'` with no `operator` field.
 */
export interface Condition {
  operator?:
    | 'eq'
    | 'ne'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'in'
    | 'contains'
    | 'regex'
    | 'exists';
  field?: string;
  value?: unknown;
  conditions?: Condition[];
  logical?: 'and' | 'or';
}

export interface PolicyRule {
  id: string;
  name: string;
  dimension: ComplianceDimension;
  priority: number;
  condition: Condition;
  sector?: string;
  action: 'allow' | 'deny' | 'escalate';
  overrides?: string[];
  enabled: boolean;
  description?: string;
}

export interface EvaluationContext {
  requestId: string;
  timestamp: Date;
  sector: string;
  subject: Record<string, unknown>;
  resource: Record<string, unknown>;
  action: string;
  environment?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface Gate530Config {
  rules: PolicyRule[];
  sectorConfig?: Record<string, unknown>;
  failClosed: boolean;
  diagnostics?: DiagnosticsConfig;
}

export interface DiagnosticsConfig {
  checkIntervalMs?: number;
  enabled?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function getDefaultConfig(): Gate530Config {
  return {
    rules: [],
    failClosed: true,
    diagnostics: {
      checkIntervalMs: 30000,
      enabled: true,
    },
  };
}

export function loadConfig(env: Record<string, string>): Gate530Config {
  const config = getDefaultConfig();

  if (env.GATE530_FAIL_CLOSED !== undefined) {
    config.failClosed = env.GATE530_FAIL_CLOSED.toLowerCase() === 'true';
  }

  if (env.GATE530_DIAGNOSTICS_ENABLED !== undefined) {
    config.diagnostics = config.diagnostics ?? {};
    config.diagnostics.enabled = env.GATE530_DIAGNOSTICS_ENABLED.toLowerCase() === 'true';
  }

  if (env.GATE530_DIAGNOSTICS_INTERVAL !== undefined) {
    config.diagnostics = config.diagnostics ?? {};
    const interval = parseInt(env.GATE530_DIAGNOSTICS_INTERVAL, 10);
    if (!isNaN(interval) && interval > 0) {
      config.diagnostics.checkIntervalMs = interval;
    }
  }

  return config;
}

export function validateConfig(config: Gate530Config): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    errors.push('Config must be a valid object');
    return { valid: false, errors };
  }

  if (typeof config.failClosed !== 'boolean') {
    errors.push('failClosed must be a boolean');
  }

  if (!Array.isArray(config.rules)) {
    errors.push('rules must be an array');
  } else {
    for (const rule of config.rules) {
      if (!rule.id || typeof rule.id !== 'string') {
        errors.push(`Rule missing valid id: ${JSON.stringify(rule)}`);
      }
      if (!rule.name || typeof rule.name !== 'string') {
        errors.push(`Rule ${rule.id ?? '?'} missing valid name`);
      }
      if (!rule.condition || typeof rule.condition !== 'object') {
        errors.push(`Rule ${rule.id ?? '?'} missing valid condition`);
      }
      if (typeof rule.priority !== 'number') {
        errors.push(`Rule ${rule.id ?? '?'} missing valid priority`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
