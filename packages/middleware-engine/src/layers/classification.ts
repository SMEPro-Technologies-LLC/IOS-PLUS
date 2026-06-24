/**
 * Classification Layer (Layer 2)
 * Semantic classification, sector detection, sensitivity assessment, PII detection
 * @module layers/classification
 */

import {
  type ClassificationLayerConfig,
  type ClassificationResult,
  type SensitivityLevel,
  type PiiDetectionResult,
  type AiRequest,
} from '../config.js';

export class ClassificationLayer {
  private readonly config: ClassificationLayerConfig;
  private readonly piiPatterns: Array<{ type: string; pattern: RegExp }> = [
    { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    { type: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ },
    { type: 'phone', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
    { type: 'credit_card', pattern: /\b(?:\d{4}[-\s]?){3,4}\d{4}\b/ },
    { type: 'tin', pattern: /\b\d{2}-\d{7}\b/ },
  ];

  constructor(config: ClassificationLayerConfig) {
    this.config = config;
  }

  /**
   * Classify request intent, sector, sensitivity, and PII presence
   */
  classify(request: AiRequest): ClassificationResult {
    try {
      const sector = this.detectSector(request);
      const sensitivity = this.assessSensitivity(request);
      const pii = this.detectPII(request);
      const intent = this.detectIntent(request);
      const confidence = this.computeConfidence(request, pii);

      return {
        intent,
        sector,
        sensitivity,
        piiDetected: pii,
        confidence,
      };
    } catch (err) {
      if (this.config.failClosed) {
        return this.fallbackHighSensitivity(err as Error);
      }
      throw err;
    }
  }

  /**
   * Infer sector from request content
   */
  detectSector(request: AiRequest): string {
    const content = (request.content || '').toLowerCase();
    const sectors = [
      { name: 'oil_gas', keywords: ['well', 'operator', 'rrc', 'production', 'drilling', 'completion'] },
      { name: 'healthcare', keywords: ['patient', 'hipaa', 'diagnosis', 'medical', 'clinical'] },
      { name: 'finance', keywords: ['bank', 'loan', 'investment', 'securities', 'trading'] },
      { name: 'education', keywords: ['student', 'cip', 'naics', 'institution', 'degree', 'transcript'] },
      { name: 'legal', keywords: ['contract', 'litigation', 'compliance', 'regulation', 'statute'] },
    ];
    for (const sector of sectors) {
      if (sector.keywords.some((kw) => content.includes(kw))) {
        return sector.name;
      }
    }
    return this.config.defaultSector;
  }

  /**
   * Assess data sensitivity level
   */
  assessSensitivity(request: AiRequest): SensitivityLevel {
    const pii = this.detectPII(request);
    if (pii.hasPII && pii.confidence > 0.8) return 'critical';
    if (pii.hasPII && pii.confidence > 0.5) return 'high';
    const content = (request.content || '').toLowerCase();
    if (content.includes('confidential') || content.includes('proprietary') || content.includes('trade secret')) {
      return 'high';
    }
    if (content.includes('personal') || content.includes('private')) return 'medium';
    return this.config.defaultSensitivity;
  }

  /**
   * Detect PII in request content
   */
  detectPII(request: AiRequest): PiiDetectionResult {
    const content = request.content || '';
    const fields: string[] = [];
    const types: string[] = [];
    let matchCount = 0;

    for (const pii of this.piiPatterns) {
      const matches = content.match(pii.pattern);
      if (matches && matches.length > 0) {
        matchCount += matches.length;
        fields.push(...matches);
        types.push(pii.type);
      }
    }

    const confidence = Math.min(1, matchCount * 0.25 + (types.length > 0 ? 0.2 : 0));
    return {
      hasPII: matchCount > 0,
      fields: [...new Set(fields)],
      confidence,
      types: [...new Set(types)],
    };
  }

  /**
   * Classify request with full result including confidence
   */
  classifyRequest(request: AiRequest): ClassificationResult {
    return this.classify(request);
  }

  private detectIntent(request: AiRequest): string {
    const content = (request.content || '').toLowerCase();
    if (content.includes('generate') || content.includes('create') || content.includes('draft')) return 'generation';
    if (content.includes('analyze') || content.includes('evaluate') || content.includes('assess')) return 'analysis';
    if (content.includes('search') || content.includes('find') || content.includes('retrieve')) return 'retrieval';
    if (content.includes('submit') || content.includes('file') || content.includes('report')) return 'submission';
    return 'general';
  }

  private computeConfidence(request: AiRequest, pii: PiiDetectionResult): number {
    const content = request.content || '';
    let score = 0.5;
    if (content.length > 50) score += 0.1;
    if (content.length > 200) score += 0.1;
    if (pii.hasPII) score += 0.15;
    if (request.metadata && Object.keys(request.metadata).length > 0) score += 0.1;
    return Math.min(1, score);
  }

  private fallbackHighSensitivity(_error: Error): ClassificationResult {
    return {
      intent: 'unknown',
      sector: this.config.defaultSector,
      sensitivity: 'critical',
      piiDetected: { hasPII: false, fields: [], confidence: 0, types: [] },
      confidence: 0,
      rawLabels: { error: 1, fallback: 1 },
    };
  }
}
