/**
 * Prometheus Metrics Registry — Dependency-free metrics formatting
 * Aligned with production observability requirements (EB Doc 6 §3.5)
 */

export class MetricsRegistry {
  private static counters = new Map<string, number>();
  private static gauges = new Map<string, number>();
  private static summaries = new Map<string, { count: number; sum: number }>();

  /** Increment a counter metric */
  public static inc(name: string, labels: Record<string, string> = {}): void {
    const key = this.formatKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + 1);
  }

  /** Set a gauge metric value */
  public static set(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.formatKey(name, labels);
    this.gauges.set(key, value);
  }

  /** Record a latency observation (for summaries) */
  public static observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = this.formatKey(name, labels);
    const existing = this.summaries.get(key) || { count: 0, sum: 0 };
    existing.count += 1;
    existing.sum += value;
    this.summaries.set(key, existing);
  }

  private static formatKey(name: string, labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) return name;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  /** Render all metrics in Prometheus exposition format */
  public static render(): string {
    let out = '';
    
    out += '# HELP ios_middleware_layer_latency_ms Latency of compliance pipeline execution per layer in milliseconds.\n';
    out += '# TYPE ios_middleware_layer_latency_ms summary\n';
    for (const [key, val] of this.summaries.entries()) {
      if (key.startsWith('ios_middleware_layer_latency_ms')) {
        out += `${key}_count ${val.count}\n`;
        out += `${key}_sum ${val.sum}\n`;
      }
    }

    out += '# HELP ios_gate530_eval_latency_ms Latency of Gate 530 sidecar decisions in milliseconds.\n';
    out += '# TYPE ios_gate530_eval_latency_ms summary\n';
    for (const [key, val] of this.summaries.entries()) {
      if (key.startsWith('ios_gate530_eval_latency_ms')) {
        out += `${key}_count ${val.count}\n`;
        out += `${key}_sum ${val.sum}\n`;
      }
    }

    out += '# HELP ios_vault_signing_latency_ms Latency of Vault transit cryptographic signing operations in milliseconds.\n';
    out += '# TYPE ios_vault_signing_latency_ms summary\n';
    for (const [key, val] of this.summaries.entries()) {
      if (key.startsWith('ios_vault_signing_latency_ms')) {
        out += `${key}_count ${val.count}\n`;
        out += `${key}_sum ${val.sum}\n`;
      }
    }

    out += '# HELP ios_gate530_errors_total Total number of Gate 530 sidecar communication or timeout errors.\n';
    out += '# TYPE ios_gate530_errors_total counter\n';
    for (const [key, val] of this.counters.entries()) {
      if (key.startsWith('ios_gate530_errors_total')) {
        out += `${key} ${val}\n`;
      }
    }

    out += '# HELP ios_db_pool_saturation Current count of active/used connections in PostgreSQL connection pools.\n';
    out += '# TYPE ios_db_pool_saturation gauge\n';
    for (const [key, val] of this.gauges.entries()) {
      if (key.startsWith('ios_db_pool_saturation')) {
        out += `${key} ${val}\n`;
      }
    }

    out += '# HELP ios_redis_errors_total Total number of Redis HA cache ping or connection errors.\n';
    out += '# TYPE ios_redis_errors_total counter\n';
    for (const [key, val] of this.counters.entries()) {
      if (key.startsWith('ios_redis_errors_total')) {
        out += `${key} ${val}\n`;
      }
    }

    out += '# HELP ios_amendment_webhook_total Total number of Firecrawl amendment webhook outcomes.\n';
    out += '# TYPE ios_amendment_webhook_total counter\n';
    for (const [key, val] of this.counters.entries()) {
      if (key.startsWith('ios_amendment_webhook_total')) {
        out += `${key} ${val}\n`;
      }
    }

    out += '# HELP ios_vault_signing_errors_total Total number of failed HashiCorp Vault cryptographic signing requests.\n';
    out += '# TYPE ios_vault_signing_errors_total counter\n';
    for (const [key, val] of this.counters.entries()) {
      if (key.startsWith('ios_vault_signing_errors_total')) {
        out += `${key} ${val}\n`;
      }
    }

    return out;
  }
}
