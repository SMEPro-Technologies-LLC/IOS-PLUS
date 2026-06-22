import {
  ComplianceDimension,
  EvaluationContext,
  Gate530Config,
  PolicyRule,
  validateConfig,
} from './config.js';
import { RuleEngine } from './rules.js';
import { SectorRegistry } from './sector.js';

export interface ComplianceDecision {
  action: 'allow' | 'deny' | 'escalate';
  reason: string;
  dimension: ComplianceDimension;
  confidence: number;
  metadata: Record<string, unknown>;
}

export interface ClassificationResult {
  category: string;
  confidence: number;
  matchedRules: string[];
  features: Record<string, unknown>;
}

export class Gate530Engine {
  private rules: Map<string, PolicyRule> = new Map();
  private ruleEngine = new RuleEngine();
  private sectorRegistry: SectorRegistry;
  private failClosed: boolean;
  private config: Gate530Config;

  constructor(config: Gate530Config) {
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid Gate530Config: ${validation.errors.join(', ')}`);
    }

    this.config = config;
    this.failClosed = config.failClosed;
    this.sectorRegistry = new SectorRegistry();

    for (const rule of config.rules) {
      this.addRule(rule);
    }

    if (config.sectorConfig) {
      for (const [sector, sectorRules] of Object.entries(config.sectorConfig)) {
        if (Array.isArray(sectorRules)) {
          this.sectorRegistry.registerSector(sector, sectorRules as PolicyRule[]);
        }
      }
    }
  }

  evaluate(context: EvaluationContext): ComplianceDecision {
    try {
      return this.performEvaluation(context);
    } catch (error) {
      if (this.failClosed) {
        return this.createDenyDecision(
          `Evaluation failed (failClosed=true): ${error instanceof Error ? error.message : String(error)}`,
          'security',
          1.0
        );
      }
      throw error;
    }
  }

  async evaluateAsync(context: EvaluationContext): Promise<ComplianceDecision> {
    try {
      return this.performEvaluation(context);
    } catch (error) {
      if (this.failClosed) {
        return this.createDenyDecision(
          `Async evaluation failed (failClosed=true): ${error instanceof Error ? error.message : String(error)}`,
          'security',
          1.0
        );
      }
      throw error;
    }
  }

  private performEvaluation(context: EvaluationContext): ComplianceDecision {
    if (!context || typeof context !== 'object') {
      throw new Error('EvaluationContext is required');
    }

    const allRules = this.getApplicableRules(context);
    if (allRules.length === 0) {
      return this.createAllowDecision('No applicable rules found', 'operational', 0.5);
    }

    const results = allRules.map((rule) => ({
      rule,
      matched: this.ruleEngine.evaluateRule(rule, context),
    }));

    const matchedRules = results.filter((r) => r.matched);

    if (matchedRules.length === 0) {
      return this.createAllowDecision('No rules matched', 'operational', 0.5);
    }

    matchedRules.sort((a, b) => b.rule.priority - a.rule.priority);

    const highestPriority = matchedRules[0];
    const rule = highestPriority.rule;

    switch (rule.action) {
      case 'allow':
        return this.createAllowDecision(
          `Rule ${rule.id} matched: ${rule.name}`,
          rule.dimension,
          this.calculateConfidence(rule, context)
        );
      case 'deny':
        return this.createDenyDecision(
          `Rule ${rule.id} matched: ${rule.name}`,
          rule.dimension,
          this.calculateConfidence(rule, context)
        );
      case 'escalate':
        return this.createEscalateDecision(
          `Rule ${rule.id} matched: ${rule.name}`,
          rule.dimension,
          this.calculateConfidence(rule, context)
        );
      default:
        return this.createDenyDecision('Unknown rule action', 'security', 1.0);
    }
  }

  private getApplicableRules(context: EvaluationContext): PolicyRule[] {
    const globalRules = Array.from(this.rules.values()).filter(
      (r) => r.enabled && this.ruleEngine.matchSector(r, context)
    );
    const sectorRules = this.sectorRegistry
      .getSectorRules(context.sector)
      .filter((r) => r.enabled);

    const allRules = [...globalRules, ...sectorRules];
    const sorted = this.ruleEngine.sortByPriority(allRules);
    return this.ruleEngine.applyOverrides(sorted);
  }

  private calculateConfidence(rule: PolicyRule, context: EvaluationContext): number {
    const baseConfidence = Math.min(0.5 + rule.priority / 200, 0.95);
    const sectorBoost = rule.sector && rule.sector !== 'general' ? 0.05 : 0;
    const contextBoost = context.metadata ? 0.02 : 0;
    return Math.min(baseConfidence + sectorBoost + contextBoost, 1.0);
  }

  addRule(rule: PolicyRule): void {
    if (!rule.id || typeof rule.id !== 'string') {
      throw new Error('Rule must have a valid id');
    }
    this.rules.set(rule.id, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  getRules(dimension?: ComplianceDimension): PolicyRule[] {
    const allRules = Array.from(this.rules.values());
    if (!dimension) return allRules;
    return allRules.filter((r) => r.dimension === dimension);
  }

  getPolicyMetadata(): Record<string, unknown> {
    return {
      ruleCount: this.rules.size,
      sectors: this.sectorRegistry.getSectors(),
      failClosed: this.failClosed,
      rules: Array.from(this.rules.values()).map((r) => ({
        id: r.id,
        name: r.name,
        dimension: r.dimension,
        priority: r.priority,
        action: r.action,
        sector: r.sector,
        enabled: r.enabled,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  classifyRequest(context: EvaluationContext): ClassificationResult {
    const applicableRules = this.getApplicableRules(context);
    const matchedRules = applicableRules.filter((rule) =>
      this.ruleEngine.evaluateRule(rule, context)
    );

    const categories = new Set<string>();
    for (const rule of matchedRules) {
      categories.add(rule.dimension);
    }

    const category = categories.size > 0 ? Array.from(categories)[0] : 'unknown';
    const confidence = Math.min(0.5 + matchedRules.length * 0.1, 0.95);

    return {
      category,
      confidence,
      matchedRules: matchedRules.map((r) => r.id),
      features: {
        sector: context.sector,
        action: context.action,
        ruleMatches: matchedRules.length,
        totalRules: applicableRules.length,
      },
    };
  }

  synthesizeDecision(results: ClassificationResult[]): ComplianceDecision {
    if (results.length === 0) {
      return this.createDenyDecision('No classification results provided', 'security', 1.0);
    }

    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    const hasDeny = results.some(
      (r) => r.category === 'security' || r.category === 'data_privacy' || r.matchedRules.length > 0
    );

    const hasHighConfidence = results.some((r) => r.confidence > 0.8);

    if (hasDeny && hasHighConfidence) {
      return this.createDenyDecision(
        'Synthesized decision: high-confidence risk indicators detected',
        'security',
        avgConfidence
      );
    }

    if (avgConfidence > 0.7) {
      return this.createEscalateDecision(
        'Synthesized decision: elevated confidence requires review',
        'regulatory',
        avgConfidence
      );
    }

    return this.createAllowDecision(
      'Synthesized decision: no significant risk detected',
      'operational',
      avgConfidence
    );
  }

  private createAllowDecision(
    reason: string,
    dimension: ComplianceDimension,
    confidence: number
  ): ComplianceDecision {
    return {
      action: 'allow',
      reason,
      dimension,
      confidence,
      metadata: { timestamp: new Date().toISOString() },
    };
  }

  private createDenyDecision(
    reason: string,
    dimension: ComplianceDimension,
    confidence: number
  ): ComplianceDecision {
    return {
      action: 'deny',
      reason,
      dimension,
      confidence,
      metadata: { timestamp: new Date().toISOString(), failClosed: this.failClosed },
    };
  }

  private createEscalateDecision(
    reason: string,
    dimension: ComplianceDimension,
    confidence: number
  ): ComplianceDecision {
    return {
      action: 'escalate',
      reason,
      dimension,
      confidence,
      metadata: { timestamp: new Date().toISOString() },
    };
  }
}
