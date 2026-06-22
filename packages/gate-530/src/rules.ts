import { Condition, EvaluationContext, PolicyRule } from './config.js';

export class RuleEngine {
  evaluateCondition(condition: Condition, context: EvaluationContext): boolean {
    if (condition.logical && condition.conditions) {
      const results = condition.conditions.map((c) => this.evaluateCondition(c, context));
      return condition.logical === 'and' ? results.every(Boolean) : results.some(Boolean);
    }

    return this.evaluateSimpleCondition(condition, context);
  }

  private evaluateSimpleCondition(condition: Condition, context: EvaluationContext): boolean {
    const value = this.resolveField(condition.field, context);
    const { operator } = condition;

    try {
      switch (operator) {
        case 'eq':
          return value === condition.value;
        case 'ne':
          return value !== condition.value;
        case 'gt':
          return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
        case 'lt':
          return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
        case 'gte':
          return typeof value === 'number' && typeof condition.value === 'number' && value >= condition.value;
        case 'lte':
          return typeof value === 'number' && typeof condition.value === 'number' && value <= condition.value;
        case 'in':
          return Array.isArray(condition.value) && condition.value.includes(value);
        case 'contains':
          return typeof value === 'string' && typeof condition.value === 'string' && value.includes(condition.value);
        case 'regex':
          return typeof value === 'string' && typeof condition.value === 'string' && new RegExp(condition.value).test(value);
        case 'exists':
          return value !== undefined && value !== null;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private resolveField(field: string, context: EvaluationContext): unknown {
    const parts = field.split('.');
    let current: unknown = context;

    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  matchSector(rule: PolicyRule, context: EvaluationContext): boolean {
    if (!rule.sector) return true;
    return rule.sector === context.sector || rule.sector === 'general';
  }

  sortByPriority(rules: PolicyRule[]): PolicyRule[] {
    return [...rules].sort((a, b) => b.priority - a.priority);
  }

  applyOverrides(rules: PolicyRule[]): PolicyRule[] {
    const overridden = new Set<string>();

    for (const rule of rules) {
      if (rule.overrides) {
        for (const overrideId of rule.overrides) {
          overridden.add(overrideId);
        }
      }
    }

    return rules.filter((rule) => !overridden.has(rule.id));
  }

  evaluateRule(rule: PolicyRule, context: EvaluationContext): boolean {
    if (!rule.enabled) return false;
    if (!this.matchSector(rule, context)) return false;
    return this.evaluateCondition(rule.condition, context);
  }
}
