import { DiagnosticsConfig } from './config.js';

export interface DependencyStatus {
  name: string;
  healthy: boolean;
  latencyMs: number;
  lastChecked: Date;
  details?: Record<string, unknown>;
}

export interface ReadinessResult {
  ready: boolean;
  dependencies: DependencyStatus[];
  timestamp: Date;
}

export type CheckFunction = () => Promise<DependencyStatus> | DependencyStatus;

export class Gate530Diagnostics {
  private checks = new Map<string, CheckFunction>();
  private intervalId?: ReturnType<typeof setInterval>;
  private status: DependencyStatus[] = [];
  private config: Required<DiagnosticsConfig>;

  constructor(config: DiagnosticsConfig = {}) {
    this.config = {
      checkIntervalMs: 30000,
      enabled: true,
      ...config,
    };

    this.registerDefaultChecks();
  }

  private registerDefaultChecks(): void {
    this.registerCheck('database', async () => {
      const start = Date.now();
      try {
        // Placeholder for actual DB connectivity check
        return {
          name: 'database',
          healthy: true,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
        };
      } catch (error) {
        return {
          name: 'database',
          healthy: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          details: { error: String(error) },
        };
      }
    });

    this.registerCheck('vault', async () => {
      const start = Date.now();
      try {
        // Placeholder for actual Vault seal/health check
        return {
          name: 'vault',
          healthy: true,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
        };
      } catch (error) {
        return {
          name: 'vault',
          healthy: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          details: { error: String(error) },
        };
      }
    });

    this.registerCheck('signing', async () => {
      const start = Date.now();
      try {
        // Placeholder for actual signing service check
        return {
          name: 'signing',
          healthy: true,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
        };
      } catch (error) {
        return {
          name: 'signing',
          healthy: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          details: { error: String(error) },
        };
      }
    });
  }

  registerCheck(name: string, check: CheckFunction): void {
    this.checks.set(name, check);
  }

  runReadinessChecks(): ReadinessResult {
    const dependencies = this.getDependencyStatus();
    return {
      ready: dependencies.every((d) => d.healthy),
      dependencies,
      timestamp: new Date(),
    };
  }

  runLivenessCheck(): boolean {
    return true;
  }

  getDependencyStatus(): DependencyStatus[] {
    return this.status.length > 0 ? this.status : this.runChecksSync();
  }

  private runChecksSync(): DependencyStatus[] {
    const results: DependencyStatus[] = [];
    for (const [name, check] of this.checks) {
      try {
        const result = check();
        if (result instanceof Promise) {
          results.push({
            name,
            healthy: false,
            latencyMs: 0,
            lastChecked: new Date(),
            details: { error: 'Async check called in sync context' },
          });
        } else {
          results.push(result);
        }
      } catch (error) {
        results.push({
          name,
          healthy: false,
          latencyMs: 0,
          lastChecked: new Date(),
          details: { error: String(error) },
        });
      }
    }
    return results;
  }

  async runChecksAsync(): Promise<DependencyStatus[]> {
    const results: DependencyStatus[] = [];
    for (const [name, check] of this.checks) {
      try {
        const result = await check();
        results.push(result);
      } catch (error) {
        results.push({
          name,
          healthy: false,
          latencyMs: 0,
          lastChecked: new Date(),
          details: { error: String(error) },
        });
      }
    }
    this.status = results;
    return results;
  }

  start(): void {
    if (!this.config.enabled || this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.runChecksAsync().catch((err) => {
        console.error('[Gate530Diagnostics] interval check failed:', err);
      });
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== undefined;
  }
}
