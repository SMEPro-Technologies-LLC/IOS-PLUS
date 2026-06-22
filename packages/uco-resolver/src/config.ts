/**
 * @file config.ts
 * @description Configuration loading, validation, and defaults for the UCO resolver.
 */

import {
  ResolverConfig,
  TraversalConfig,
  CensusApiConfig,
  ValidationResult,
  DatabasePool,
} from './types.js';

const DEFAULT_CENSUS_API_URL = 'https://api.census.gov/data';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DEPTH = 5;

export function getDefaultConfig(): Omit<ResolverConfig, 'pool'> & {
  traversal: TraversalConfig;
  censusApi: CensusApiConfig;
} {
  return {
    censusApiUrl: DEFAULT_CENSUS_API_URL,
    crosswalkPaths: {
      socToNaics: './data/soc-to-naics.csv',
      cipToNaics: './data/cip-to-naics.csv',
      cipToSoc: './data/cip-to-soc.csv',
    },
    traversal: getDefaultTraversalConfig(),
    censusApi: getDefaultCensusApiConfig(),
  };
}

export function getDefaultTraversalConfig(): TraversalConfig {
  return {
    directMatchWeight: 1.0,
    crosswalkWeight: 0.85,
    inferredWeight: 0.6,
    maxDepth: DEFAULT_MAX_DEPTH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export function getDefaultCensusApiConfig(): CensusApiConfig {
  return {
    baseUrl: DEFAULT_CENSUS_API_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retryCount: 3,
  };
}

export function loadConfig(
  env: Record<string, string | undefined>,
  pool: DatabasePool
): ResolverConfig {
  const defaults = getDefaultConfig();

  const config: ResolverConfig = {
    pool,
    censusApiUrl: env['UCO_CENSUS_API_URL'] || defaults.censusApiUrl,
    crosswalkPaths: {
      socToNaics:
        env['UCO_SOC_NAICS_CROSSWALK'] || defaults.crosswalkPaths?.socToNaics,
      cipToNaics:
        env['UCO_CIP_NAICS_CROSSWALK'] || defaults.crosswalkPaths?.cipToNaics,
      cipToSoc:
        env['UCO_CIP_SOC_CROSSWALK'] || defaults.crosswalkPaths?.cipToSoc,
    },
  };

  return config;
}

export function validateConfig(config: ResolverConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.pool) {
    errors.push('Database pool is required');
  }

  if (config.censusApiUrl) {
    try {
      // eslint-disable-next-line no-new
      new URL(config.censusApiUrl);
    } catch {
      errors.push(`Invalid censusApiUrl: ${config.censusApiUrl}`);
    }
  }

  if (config.crosswalkPaths) {
    const { socToNaics, cipToNaics, cipToSoc } = config.crosswalkPaths;
    if (!socToNaics) warnings.push('socToNaics crosswalk path not provided');
    if (!cipToNaics) warnings.push('cipToNaics crosswalk path not provided');
    if (!cipToSoc) warnings.push('cipToSoc crosswalk path not provided');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateTraversalConfig(config: TraversalConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.maxDepth < 1 || config.maxDepth > 10) {
    errors.push('maxDepth must be between 1 and 10');
  }
  if (config.timeoutMs < 1_000 || config.timeoutMs > 120_000) {
    warnings.push('timeoutMs outside typical range (1s – 120s)');
  }
  if (config.directMatchWeight <= 0 || config.directMatchWeight > 1) {
    errors.push('directMatchWeight must be in (0, 1]');
  }
  if (config.crosswalkWeight <= 0 || config.crosswalkWeight > 1) {
    errors.push('crosswalkWeight must be in (0, 1]');
  }
  if (config.inferredWeight <= 0 || config.inferredWeight > 1) {
    errors.push('inferredWeight must be in (0, 1]');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
