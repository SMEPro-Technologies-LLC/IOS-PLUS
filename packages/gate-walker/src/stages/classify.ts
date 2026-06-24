/**
 * Stage 3: CLASSIFY
 * Classifies the request by sensitivity, sector, risk score, and FERPA flags.
 */

import type { GateRequest, StageResult, ClassificationResult } from '../types.js';
import type { InterpretedRequest } from './interpret.js';

const SENSITIVITY_MAP: Record<string, ClassificationResult['sensitivity']> = {
  public: 'public',
  internal: 'internal',
  confidential: 'confidential',
  restricted: 'restricted',
  pii: 'restricted',
  ferpa_protected: 'restricted',
  grade: 'confidential',
  transcript: 'confidential',
  student_record: 'restricted',
};

export function classifyStage(
  request: GateRequest,
  interpreted: InterpretedRequest
): { result: StageResult; classification?: ClassificationResult } {
  const start = Date.now();

  const resourceClassification = request.resource.classification?.toLowerCase() ?? 'internal';
  const sensitivity: ClassificationResult['sensitivity'] =
    SENSITIVITY_MAP[resourceClassification] ??
    SENSITIVITY_MAP[interpreted.normalizedResource] ??
    'internal';

  const ferpaProtected =
    interpreted.isFerpaContext ||
    (request.sector === 'education' && (sensitivity === 'restricted' || sensitivity === 'confidential'));

  let riskScore = 0;
  if (sensitivity === 'restricted') riskScore += 0.5;
  else if (sensitivity === 'confidential') riskScore += 0.3;
  else if (sensitivity === 'internal') riskScore += 0.1;

  if (ferpaProtected) riskScore += 0.3;
  if (interpreted.normalizedAction === 'delete' || interpreted.normalizedAction === 'export') {
    riskScore += 0.2;
  }
  if (interpreted.sector === 'education') riskScore += 0.05;

  riskScore = Math.min(riskScore, 1.0);

  const tags: string[] = [sensitivity];
  if (ferpaProtected) tags.push('ferpa');
  if (interpreted.sector !== 'general') tags.push(`sector:${interpreted.sector}`);
  if (riskScore >= 0.7) tags.push('high-risk');
  else if (riskScore >= 0.4) tags.push('medium-risk');
  else tags.push('low-risk');

  const classification: ClassificationResult = {
    sector: interpreted.sector,
    sensitivity,
    ferpaProtected,
    riskScore,
    tags,
  };

  return {
    result: {
      stage: 'CLASSIFY',
      status: 'pass',
      reason: `Classified as ${sensitivity} (risk: ${riskScore.toFixed(2)})`,
      metadata: { sensitivity, ferpaProtected, riskScore, tags },
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    },
    classification,
  };
}
