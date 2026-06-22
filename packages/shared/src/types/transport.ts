export type Gate530TransportConfig = {
  protocol: 'http2' | 'ipc';
  http2?: {
    host: string;
    port: number;
    tls: boolean;
    certPath?: string;
    keyPath?: string;
    caPath?: string;
    keepAliveMs: number;
  };
  ipc?: {
    socketPath: string;
    permissions: number;
    maxConnections: number;
  };
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
};

export enum MiddlewareLayer {
  AUTH = 'auth',
  CLASSIFICATION = 'classification',
  POLICY = 'policy',
  EVALUATION = 'evaluation',
  EVIDENCE = 'evidence',
  RETRIEVAL = 'retrieval',
  AUDIT = 'audit',
}

export type ReadinessCheck = {
  name: string;
  layer: MiddlewareLayer;
  status: 'pass' | 'fail' | 'warn';
  latencyMs: number;
  message?: string;
  lastChecked: string;
  dependency?: string;
};

export type HealthStatus = {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: readonly ReadinessCheck[];
  timestamp: string;
  version: string;
  uptimeSeconds: number;
};
