/**
 * Policy Layer (Layer 3)
 * Load, filter, merge, and validate policies for a given context
 * @module layers/policy
 */

import { type PolicyLayerConfig, type PolicyRule, type ValidationResult, type Actor } from '../config.js';

export class PolicyLayer {
  private readonly config: PolicyLayerConfig;
  private readonly cache: Map<string, { rules: PolicyRule[]; expiresAt: number }> = new Map();
  private readonly store: Map<string, PolicyRule[]> = new Map();

  constructor(config: PolicyLayerConfig) {
    this.config = config;
  }

  /**
   * Load policies applicable to a context
   */
  loadPolicies(context: { actor: Actor; sector: string; action: string }): PolicyRule[] {
    const tenantId = context.actor.tenantId || 'global';
    const cacheKey = `${tenantId}:${context.sector}:${context.action}`;

    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.rules;
      }
    }

    const all = this.store.get(tenantId) || this.getDefaultPolicies();
    const filtered = this.filterBySector(all, context.sector);
    const actionFiltered = filtered.filter(
      (r) => r.action === '*' || r.action === context.action
    );

    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, {
        rules: actionFiltered,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      });
    }

    return actionFiltered;
  }

  /**
   * Filter policies to sector-specific rules
   */
  filterBySector(policies: PolicyRule[], sector: string): PolicyRule[] {
    return policies.filter((p) => p.sector === '*' || p.sector === sector);
  }

  /**
   * Merge two policy sets, with override taking priority
   */
  mergePolicies(base: PolicyRule[], override: PolicyRule[]): PolicyRule[] {
    const merged = new Map<string, PolicyRule>();
    for (const rule of base) {
      merged.set(rule.id, rule);
    }
    for (const rule of override) {
      merged.set(rule.id, rule);
    }
    return Array.from(merged.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Validate a policy structure
   */
  validatePolicy(policy: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!policy || typeof policy !== 'object') {
      errors.push('Policy must be an object');
      return { valid: false, errors, warnings };
    }

    const p = policy as Record<string, unknown>;

    if (!p.id || typeof p.id !== 'string') errors.push('Policy must have a string id');
    if (!p.name || typeof p.name !== 'string') errors.push('Policy must have a string name');
    if (!p.sector || typeof p.sector !== 'string') errors.push('Policy must have a string sector');
    if (!p.action || typeof p.action !== 'string') errors.push('Policy must have a string action');
    if (!p.condition || typeof p.condition !== 'object') errors.push('Policy must have an object condition');
    if (p.effect !== 'allow' && p.effect !== 'deny') errors.push('Policy effect must be "allow" or "deny"');
    if (typeof p.priority !== 'number') errors.push('Policy priority must be a number');

    if (!p.version) warnings.push('Policy version is recommended');
    if (!p.createdAt) warnings.push('Policy createdAt is recommended');

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Cache policies per tenant
   */
  cachePolicies(tenantId: string): void {
    const policies = this.store.get(tenantId) || [];
    this.cache.set(tenantId, {
      rules: policies,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  /**
   * Store a rule (used by admin endpoints)
   */
  storeRule(tenantId: string, rule: PolicyRule): void {
    const existing = this.store.get(tenantId) || [];
    const idx = existing.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      existing[idx] = rule;
    } else {
      existing.push(rule);
    }
    this.store.set(tenantId, existing);
    this.cachePolicies(tenantId);
  }

  /**
   * Delete a rule (used by admin endpoints)
   */
  deleteRule(tenantId: string, ruleId: string): boolean {
    const existing = this.store.get(tenantId);
    if (!existing) return false;
    const filtered = existing.filter((r) => r.id !== ruleId);
    if (filtered.length === existing.length) return false;
    this.store.set(tenantId, filtered);
    this.cache.delete(tenantId);
    return true;
  }

  /**
   * Get all rules for a tenant (used by admin endpoints)
   */
  getRules(tenantId: string): PolicyRule[] {
    return this.store.get(tenantId) || [];
  }

  private getDefaultPolicies(): PolicyRule[] {
    return [
      {
        id: 'default-deny',
        name: 'Default Deny',
        sector: '*',
        action: '*',
        condition: {},
        effect: this.config.defaultEffect,
        priority: 0,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }
}
