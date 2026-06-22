import canonicalize from 'canonicalize';

/**
 * JCS Canonicalization (RFC 8785) utilities
 */

/**
 * Canonicalize a JSON payload using JCS (RFC 8785)
 */
export function canonicalize(payload: Record<string, unknown>): string {
  const result = canonicalize(payload);
  if (result === undefined) {
    throw new Error('Canonicalization failed: payload cannot be serialized');
  }
  return result;
}

/**
 * Canonicalize and return as Buffer for hashing
 */
export function canonicalizeBuffer(payload: Record<string, unknown>): Buffer {
  const canonical = canonicalize(payload);
  return Buffer.from(canonical, 'utf-8');
}

/**
 * Canonicalize with explicit key ordering (fallback when JCS is unavailable)
 */
export function canonicalizeOrdered(payload: Record<string, unknown>): string {
  const ordered = deepSortKeys(payload);
  return JSON.stringify(ordered);
}

/**
 * Verify that a canonical string round-trips correctly
 */
export function verifyCanonicalization(payload: Record<string, unknown>, canonical: string): boolean {
  try {
    const reparsed = JSON.parse(canonical);
    const recanonicalized = canonicalize(reparsed);
    return canonical === recanonicalized;
  } catch {
    return false;
  }
}

/**
 * Deep-sort keys in an object for deterministic serialization
 */
function deepSortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepSortKeys);
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * JCS Canonicalizer with caching support
 */
export class JcsCanonicalizer {
  private cache: Map<string, string>;
  private maxCacheSize: number;

  constructor(maxCacheSize = 1000) {
    this.cache = new Map();
    this.maxCacheSize = maxCacheSize;
  }

  canonicalize(payload: Record<string, unknown>): string {
    const cacheKey = JSON.stringify(payload, Object.keys(payload).sort());
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const result = canonicalize(payload);
    if (result === undefined) {
      throw new Error('Canonicalization failed: payload cannot be serialized');
    }

    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  canonicalizeBuffer(payload: Record<string, unknown>): Buffer {
    return Buffer.from(this.canonicalize(payload), 'utf-8');
  }

  canonicalizeOrdered(payload: Record<string, unknown>): string {
    const ordered = deepSortKeys(payload);
    return JSON.stringify(ordered);
  }

  verifyCanonicalization(payload: Record<string, unknown>, canonical: string): boolean {
    try {
      const reparsed = JSON.parse(canonical);
      const recanonicalized = canonicalize(reparsed);
      return canonical === recanonicalized;
    } catch {
      return false;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}
