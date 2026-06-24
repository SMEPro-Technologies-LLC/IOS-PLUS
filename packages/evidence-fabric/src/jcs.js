/**
 * JCS Canonicalization (RFC 8785) utilities
 *
 * Uses deep-sorted JSON.stringify which is compatible with JCS RFC 8785 for
 * well-formed JSON objects (no NaN, Infinity, or other non-JSON-safe values).
 */
/**
 * Canonicalize a JSON payload using RFC 8785-compatible key sorting
 */
export function canonicalize(payload) {
    const result = jcsSerialize(payload);
    if (result === undefined) {
        throw new Error('Canonicalization failed: payload cannot be serialized');
    }
    return result;
}
/**
 * Canonicalize and return as Buffer for hashing
 */
export function canonicalizeBuffer(payload) {
    const canonical = canonicalize(payload);
    return Buffer.from(canonical, 'utf-8');
}
/**
 * Canonicalize with explicit key ordering (fallback when JCS is unavailable)
 */
export function canonicalizeOrdered(payload) {
    const ordered = deepSortKeys(payload);
    return JSON.stringify(ordered);
}
/**
 * Verify that a canonical string round-trips correctly
 */
export function verifyCanonicalization(_payload, canonical) {
    try {
        const reparsed = JSON.parse(canonical);
        const recanonicalized = canonicalize(reparsed);
        return canonical === recanonicalized;
    }
    catch {
        return false;
    }
}
/**
 * RFC 8785-compatible serialization (deep-sorted keys, deterministic output)
 */
function jcsSerialize(obj) {
    if (obj === null || typeof obj !== 'object') {
        const s = JSON.stringify(obj);
        return s;
    }
    if (Array.isArray(obj)) {
        const items = obj.map((item) => jcsSerialize(item) ?? 'null');
        return '[' + items.join(',') + ']';
    }
    const record = obj;
    const keys = Object.keys(record).sort();
    const parts = keys.map((k) => {
        const v = jcsSerialize(record[k]);
        if (v === undefined)
            return undefined;
        return JSON.stringify(k) + ':' + v;
    }).filter((p) => p !== undefined);
    return '{' + parts.join(',') + '}';
}
/**
 * Deep-sort keys in an object for deterministic serialization
 */
function deepSortKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(deepSortKeys);
    }
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
        sorted[key] = deepSortKeys(obj[key]);
    }
    return sorted;
}
/**
 * JCS Canonicalizer with caching support
 */
export class JcsCanonicalizer {
    cache;
    maxCacheSize;
    constructor(maxCacheSize = 1000) {
        this.cache = new Map();
        this.maxCacheSize = maxCacheSize;
    }
    canonicalize(payload) {
        const cacheKey = JSON.stringify(payload, Object.keys(payload).sort());
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        const result = jcsSerialize(payload);
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
    canonicalizeBuffer(payload) {
        return Buffer.from(this.canonicalize(payload), 'utf-8');
    }
    canonicalizeOrdered(payload) {
        const ordered = deepSortKeys(payload);
        return JSON.stringify(ordered);
    }
    verifyCanonicalization(_payload, canonical) {
        try {
            const reparsed = JSON.parse(canonical);
            const recanonicalized = canonicalize(reparsed);
            return canonical === recanonicalized;
        }
        catch {
            return false;
        }
    }
    clearCache() {
        this.cache.clear();
    }
    getCacheSize() {
        return this.cache.size;
    }
}
//# sourceMappingURL=jcs.js.map