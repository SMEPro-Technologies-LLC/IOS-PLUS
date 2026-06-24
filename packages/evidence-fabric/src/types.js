import { createHash } from 'crypto';
/**
 * Generate a deterministic hash for an evidence record
 */
export function hashEvidence(evidence) {
    const canonical = JSON.stringify(evidence, Object.keys(evidence).sort());
    return createHash('sha256').update(canonical).digest('hex');
}
//# sourceMappingURL=types.js.map