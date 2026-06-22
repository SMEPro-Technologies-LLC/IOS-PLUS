/**
 * Wave 1 MVP — Unit Tests for Gate530Engine
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Gate530Engine } from '../engine.js';
import type { Gate530Config, EvaluationContext, PolicyRule } from '../config.js';

const baseConfig: Gate530Config = {
  rules: [],
  failClosed: true,
};

function makeContext(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    requestId: 'req-1',
    timestamp: new Date(),
    sector: 'general',
    subject: { id: 'user-1' },
    resource: { classification: 'public' },
    action: 'access',
    ...overrides,
  };
}

describe('Gate530Engine', () => {
  describe('constructor', () => {
    it('should initialize with empty rules', () => {
      const engine = new Gate530Engine(baseConfig);
      expect(engine.getRules()).toHaveLength(0);
    });

    it('should throw on invalid config', () => {
      expect(() => new Gate530Engine({ rules: [], failClosed: 'yes' as unknown as boolean })).toThrow();
    });

    it('should load rules from config', () => {
      const rule: PolicyRule = {
        id: 'r1',
        name: 'Test Rule',
        dimension: 'security',
        priority: 50,
        condition: { operator: 'eq', field: 'action', value: 'delete' },
        action: 'deny',
        enabled: true,
      };
      const engine = new Gate530Engine({ ...baseConfig, rules: [rule] });
      expect(engine.getRules()).toHaveLength(1);
    });
  });

  describe('evaluate', () => {
    let engine: Gate530Engine;

    beforeEach(() => {
      engine = new Gate530Engine({
        ...baseConfig,
        rules: [
          {
            id: 'allow-public',
            name: 'Allow public',
            dimension: 'operational',
            priority: 10,
            condition: { operator: 'eq', field: 'resource.classification', value: 'public' },
            action: 'allow',
            enabled: true,
          },
          {
            id: 'deny-pii',
            name: 'Deny PII',
            dimension: 'data_privacy',
            priority: 100,
            condition: { operator: 'eq', field: 'resource.classification', value: 'pii' },
            action: 'deny',
            enabled: true,
          },
          {
            id: 'escalate-high-value',
            name: 'Escalate high value',
            dimension: 'financial',
            priority: 50,
            condition: { operator: 'gt', field: 'resource.value', value: 10000 },
            action: 'escalate',
            enabled: true,
          },
        ],
      });
    });

    it('should allow public resource access', () => {
      const ctx = makeContext({ resource: { classification: 'public' } });
      const decision = engine.evaluate(ctx);
      expect(decision.action).toBe('allow');
      expect(decision.dimension).toBe('operational');
    });

    it('should deny PII access', () => {
      const ctx = makeContext({ resource: { classification: 'pii' } });
      const decision = engine.evaluate(ctx);
      expect(decision.action).toBe('deny');
      expect(decision.dimension).toBe('data_privacy');
    });

    it('should escalate high-value transactions', () => {
      const ctx = makeContext({ resource: { classification: 'internal', value: 50000 } });
      const decision = engine.evaluate(ctx);
      expect(decision.action).toBe('escalate');
      expect(decision.dimension).toBe('financial');
    });

    it('should allow when no rules match', () => {
      const ctx = makeContext({ resource: { classification: 'internal' }, action: 'read' });
      const decision = engine.evaluate(ctx);
      expect(decision.action).toBe('allow');
      expect(decision.reason).toContain('No rules matched');
    });

    it('should fail closed on engine error', () => {
      const badEngine = new Gate530Engine({ ...baseConfig, rules: [] });
      // @ts-expect-error — testing invalid input
      const decision = badEngine.evaluate(null);
      expect(decision.action).toBe('deny');
      expect(decision.reason).toContain('failClosed');
    });

    it('should respect priority ordering', () => {
      // Both pii (priority 100) and public (priority 10) rules exist
      // pii has higher priority and should win if both match
      const ctx = makeContext({ resource: { classification: 'pii' } });
      const decision = engine.evaluate(ctx);
      expect(decision.action).toBe('deny');
      expect(decision.reason).toContain('deny-pii');
    });
  });

  describe('classifyRequest', () => {
    it('should classify by matched dimensions', () => {
      const engine = new Gate530Engine({
        ...baseConfig,
        rules: [
          {
            id: 'r1',
            name: 'Security rule',
            dimension: 'security',
            priority: 50,
            condition: { operator: 'eq', field: 'action', value: 'delete' },
            action: 'deny',
            enabled: true,
          },
        ],
      });
      const ctx = makeContext({ action: 'delete' });
      const result = engine.classifyRequest(ctx);
      expect(result.category).toBe('security');
      expect(result.matchedRules).toContain('r1');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should return unknown for no matches', () => {
      const engine = new Gate530Engine(baseConfig);
      const result = engine.classifyRequest(makeContext());
      expect(result.category).toBe('unknown');
      expect(result.matchedRules).toHaveLength(0);
    });
  });

  describe('synthesizeDecision', () => {
    it('should deny when high-confidence risk detected', () => {
      const engine = new Gate530Engine(baseConfig);
      const decision = engine.synthesizeDecision([
        { category: 'security', confidence: 0.9, matchedRules: ['r1'], features: {} },
      ]);
      expect(decision.action).toBe('deny');
    });

    it('should escalate for elevated confidence', () => {
      const engine = new Gate530Engine(baseConfig);
      const decision = engine.synthesizeDecision([
        { category: 'operational', confidence: 0.75, matchedRules: [], features: {} },
      ]);
      expect(decision.action).toBe('escalate');
    });

    it('should allow for low risk', () => {
      const engine = new Gate530Engine(baseConfig);
      const decision = engine.synthesizeDecision([
        { category: 'operational', confidence: 0.3, matchedRules: [], features: {} },
      ]);
      expect(decision.action).toBe('allow');
    });

    it('should deny on empty results', () => {
      const engine = new Gate530Engine(baseConfig);
      const decision = engine.synthesizeDecision([]);
      expect(decision.action).toBe('deny');
    });
  });

  describe('rule management', () => {
    it('should add and remove rules', () => {
      const engine = new Gate530Engine(baseConfig);
      const rule: PolicyRule = {
        id: 'dynamic',
        name: 'Dynamic',
        dimension: 'operational',
        priority: 1,
        condition: { operator: 'eq', field: 'action', value: 'test' },
        action: 'allow',
        enabled: true,
      };
      engine.addRule(rule);
      expect(engine.getRules()).toHaveLength(1);
      engine.removeRule('dynamic');
      expect(engine.getRules()).toHaveLength(0);
    });

    it('should reject rule without id', () => {
      const engine = new Gate530Engine(baseConfig);
      expect(() => engine.addRule({ id: '', name: 'Bad', dimension: 'operational', priority: 1, condition: {}, action: 'allow', enabled: true })).toThrow();
    });
  });

  describe('policy metadata', () => {
    it('should return metadata snapshot', () => {
      const engine = new Gate530Engine(baseConfig);
      const meta = engine.getPolicyMetadata();
      expect(meta).toHaveProperty('ruleCount');
      expect(meta).toHaveProperty('sectors');
      expect(meta).toHaveProperty('failClosed');
      expect(meta).toHaveProperty('timestamp');
    });
  });
});
