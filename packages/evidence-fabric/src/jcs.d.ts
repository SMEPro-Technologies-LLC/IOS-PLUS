/**
 * JCS Canonicalization (RFC 8785) utilities
 *
 * Uses deep-sorted JSON.stringify which is compatible with JCS RFC 8785 for
 * well-formed JSON objects (no NaN, Infinity, or other non-JSON-safe values).
 */
/**
 * Canonicalize a JSON payload using RFC 8785-compatible key sorting
 */
export declare function canonicalize(payload: Record<string, unknown>): string;
/**
 * Canonicalize and return as Buffer for hashing
 */
export declare function canonicalizeBuffer(payload: Record<string, unknown>): Buffer;
/**
 * Canonicalize with explicit key ordering (fallback when JCS is unavailable)
 */
export declare function canonicalizeOrdered(payload: Record<string, unknown>): string;
/**
 * Verify that a canonical string round-trips correctly
 */
export declare function verifyCanonicalization(_payload: Record<string, unknown>, canonical: string): boolean;
/**
 * JCS Canonicalizer with caching support
 */
export declare class JcsCanonicalizer {
    private cache;
    private maxCacheSize;
    constructor(maxCacheSize?: number);
    canonicalize(payload: Record<string, unknown>): string;
    canonicalizeBuffer(payload: Record<string, unknown>): Buffer;
    canonicalizeOrdered(payload: Record<string, unknown>): string;
    verifyCanonicalization(_payload: Record<string, unknown>, canonical: string): boolean;
    clearCache(): void;
    getCacheSize(): number;
}
//# sourceMappingURL=jcs.d.ts.map