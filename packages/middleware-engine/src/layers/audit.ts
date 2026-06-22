/**
 * Audit Layer (Layer 7)
 * Records all actions to COS+ audit trail, verifies WORM integrity
 * @module layers/audit
 */

import { createHash } from 'node:crypto';
import {
  type AuditLayerConfig,
  type AuditEvent,
  type AuditFilters,
} from '../config.js';

export class AuditLayer {
  private readonly config: AuditLayerConfig;
  private readonly events: AuditEvent[] = [];
  private readonly buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AuditLayerConfig) {
    this.config = config;
    if (this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);
    }
  }

  /**
   * Record a single audit event to COS+
   */
  async recordEvent(event: Omit<AuditEvent, 'id' | 'timestamp' | 'integrityHash'>): Promise<string> {
    const fullEvent: AuditEvent = {
      ...event,
      id: this.generateAuditId(),
      timestamp: new Date().toISOString(),
      integrityHash: '',
    };
    fullEvent.integrityHash = await this.computeIntegrityHash(fullEvent);

    if (this.config.wormEnabled) {
      this.buffer.push(fullEvent);
      if (this.buffer.length >= this.config.batchSize) {
        await this.flush();
      }
    } else {
      await this.persistEvent(fullEvent);
    }

    return fullEvent.id;
  }

  /**
   * Record an admin mutation with before/after snapshots
   */
  async recordAdminMutation(
    actor: { id: string },
    action: string,
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined
  ): Promise<string> {
    return this.recordEvent({
      actorId: actor.id,
      action: `admin.${action}`,
      resource: before?.id?.toString() || after?.id?.toString() || 'unknown',
      result: 'success',
      metadata: { adminMutation: true },
      before,
      after,
    });
  }

  /**
   * Query the audit trail with filters
   */
  async getAuditTrail(filters: AuditFilters): Promise<AuditEvent[]> {
    let results = this.events.slice();
    if (filters.actorId) {
      results = results.filter((e) => e.actorId === filters.actorId);
    }
    if (filters.action) {
      results = results.filter((e) => e.action === filters.action);
    }
    if (filters.resource) {
      results = results.filter((e) => e.resource === filters.resource);
    }
    if (filters.startDate) {
      const start = new Date(filters.startDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() >= start);
    }
    if (filters.endDate) {
      const end = new Date(filters.endDate).getTime();
      results = results.filter((e) => new Date(e.timestamp).getTime() <= end);
    }
    if (filters.tenantId) {
      results = results.filter((e) => e.tenantId === filters.tenantId);
    }
    if (filters.requestId) {
      results = results.filter((e) => e.requestId === filters.requestId);
    }
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * Verify WORM integrity of the audit trail
   */
  async verifyIntegrity(): Promise<boolean> {
    for (const event of this.events) {
      const expected = await this.computeIntegrityHash(event);
      if (expected !== event.integrityHash) {
        return false;
      }
    }
    return true;
  }

  /**
   * Graceful shutdown: flush any buffered events
   */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    await Promise.all(batch.map((e) => this.persistEvent(e)));
  }

  private async persistEvent(event: AuditEvent): Promise<void> {
    // In production: await @ios-plus/cos-plus client.storeAuditEvent(event)
    this.events.push(event);
  }

  private generateAuditId(): string {
    return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async computeIntegrityHash(event: AuditEvent): Promise<string> {
    const data = JSON.stringify({
      actorId: event.actorId,
      action: event.action,
      resource: event.resource,
      result: event.result,
      metadata: event.metadata,
      before: event.before,
      after: event.after,
      requestId: event.requestId,
      tenantId: event.tenantId,
    });
    return createHash('sha256').update(data).digest('hex');
  }
}
