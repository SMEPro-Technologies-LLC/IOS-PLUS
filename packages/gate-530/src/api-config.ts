/**
 * Wave 1 MVP — API Server Configuration
 * Parses environment variables for the gate-530 HTTP/1.1 API service
 * @module api-config
 */

import { Gate530Config, loadConfig } from './config.js';

export interface ApiServerConfig {
  port: number;
  host: string;
  maxRequestBodySize: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  adminRateLimitWindowMs: number;
  adminRateLimitMaxRequests: number;
  database: DatabaseConfig;
  jwt: JwtConfig;
  evidence: EvidenceConfig;
  gate530: Gate530Config;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  maxConnections: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
}

export interface JwtConfig {
  secret?: string;
  jwksUri?: string;
  issuer: string;
  audience?: string;
  clockToleranceSeconds: number;
}

export interface EvidenceConfig {
  privateKeyPath: string;
  publicKeyPath?: string;
  algorithm: 'Ed25519';
}

export function getApiServerConfig(env: Record<string, string | undefined> = process.env): ApiServerConfig {
  const gate530 = loadConfig(env as Record<string, string>);

  return {
    port: parseInt(env.PORT ?? '3001', 10),
    host: env.HOST ?? '0.0.0.0',
    maxRequestBodySize: parseInt(env.MAX_REQUEST_BODY_SIZE ?? '1048576', 10),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
    rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    rateLimitMaxRequests: parseInt(env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
    adminRateLimitWindowMs: parseInt(env.ADMIN_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    adminRateLimitMaxRequests: parseInt(env.ADMIN_RATE_LIMIT_MAX_REQUESTS ?? '10', 10),
    database: parseDatabaseConfig(env),
    jwt: parseJwtConfig(env),
    evidence: parseEvidenceConfig(env),
    gate530,
  };
}

function parseDatabaseConfig(env: Record<string, string | undefined>): DatabaseConfig {
  const url = env.DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '5432', 10),
      database: parsed.pathname.replace(/^\//, ''),
      user: parsed.username,
      password: parsed.password,
      ssl: parsed.searchParams.get('sslmode') === 'require' || env.DB_SSL === 'true',
      maxConnections: parseInt(env.DB_MAX_CONNECTIONS ?? '10', 10),
      connectionTimeoutMs: parseInt(env.DB_CONNECTION_TIMEOUT_MS ?? '5000', 10),
      idleTimeoutMs: parseInt(env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
    };
  }

  return {
    host: env.DB_HOST ?? 'localhost',
    port: parseInt(env.DB_PORT ?? '5432', 10),
    database: env.DB_NAME ?? 'iosplus',
    user: env.DB_USER ?? 'iosplus',
    password: env.DB_PASSWORD ?? 'iosplus',
    ssl: env.DB_SSL === 'true',
    maxConnections: parseInt(env.DB_MAX_CONNECTIONS ?? '10', 10),
    connectionTimeoutMs: parseInt(env.DB_CONNECTION_TIMEOUT_MS ?? '5000', 10),
    idleTimeoutMs: parseInt(env.DB_IDLE_TIMEOUT_MS ?? '30000', 10),
  };
}

function parseJwtConfig(env: Record<string, string | undefined>): JwtConfig {
  return {
    secret: env.JWT_SECRET,
    jwksUri: env.JWT_JWKS_URI,
    issuer: env.JWT_ISSUER ?? 'ios-plus',
    audience: env.JWT_AUDIENCE,
    clockToleranceSeconds: parseInt(env.JWT_CLOCK_TOLERANCE_SECONDS ?? '60', 10),
  };
}

function parseEvidenceConfig(env: Record<string, string | undefined>): EvidenceConfig {
  return {
    privateKeyPath: env.EVIDENCE_PRIVATE_KEY_PATH ?? '/data/keys/evidence.key',
    publicKeyPath: env.EVIDENCE_PUBLIC_KEY_PATH,
    algorithm: 'Ed25519',
  };
}

export function validateApiServerConfig(config: ApiServerConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port}`);
  }
  if (config.maxRequestBodySize < 1024) {
    errors.push(`Invalid maxRequestBodySize: ${config.maxRequestBodySize}`);
  }
  if (!config.database.host) {
    errors.push('Database host is required');
  }
  if (!config.database.password) {
    errors.push('Database password is required');
  }
  if (!config.jwt.secret && !config.jwt.jwksUri) {
    errors.push('JWT_SECRET or JWT_JWKS_URI is required');
  }

  return { valid: errors.length === 0, errors };
}
