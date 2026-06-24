/**
 * Gate Walker Pipeline State Store
 * Persists intermediate pipeline state to PostgreSQL `gate_pipeline_state` table.
 * Phase 1: supports both real PostgreSQL and an in-memory mock for testing.
 */

import type { PipelineState, GatePipelineStateRecord } from '../types.js';

export interface GatePipelineStateStore {
  upsert(state: PipelineState): Promise<void>;
  get(requestId: string): Promise<GatePipelineStateRecord | null>;
  list(limit?: number): Promise<GatePipelineStateRecord[]>;
}

/**
 * In-memory state store for Phase 1 testing (no DB required).
 */
export class InMemoryStateStore implements GatePipelineStateStore {
  private readonly store = new Map<string, GatePipelineStateRecord>();

  async upsert(state: PipelineState): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.store.get(state.requestId);

    const record: GatePipelineStateRecord = {
      id: existing?.id ?? state.requestId,
      requestId: state.requestId,
      currentStage: state.currentStage,
      finalDecision: state.finalDecision,
      state: {
        request: state.request,
        stages: state.stages,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        redactedFields: state.redactedFields,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.store.set(state.requestId, record);
  }

  async get(requestId: string): Promise<GatePipelineStateRecord | null> {
    return this.store.get(requestId) ?? null;
  }

  async list(limit = 100): Promise<GatePipelineStateRecord[]> {
    return Array.from(this.store.values()).slice(0, limit);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * PostgreSQL-backed state store using the `gate_pipeline_state` table.
 * Requires the V15__gate_pipeline_state migration to have been applied.
 */
export class PostgresStateStore implements GatePipelineStateStore {
  private readonly pool: import('pg').Pool;

  constructor(pool: import('pg').Pool) {
    this.pool = pool;
  }

  async upsert(state: PipelineState): Promise<void> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO gate_pipeline_state
         (id, request_id, current_stage, final_decision, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (request_id) DO UPDATE
         SET current_stage  = EXCLUDED.current_stage,
             final_decision = EXCLUDED.final_decision,
             state          = EXCLUDED.state,
             updated_at     = EXCLUDED.updated_at`,
      [
        state.requestId,
        state.requestId,
        state.currentStage,
        state.finalDecision ?? null,
        JSON.stringify({
          request: state.request,
          stages: state.stages,
          startedAt: state.startedAt,
          completedAt: state.completedAt,
          redactedFields: state.redactedFields,
        }),
        now,
      ]
    );
  }

  async get(requestId: string): Promise<GatePipelineStateRecord | null> {
    const { rows } = await this.pool.query<{
      id: string;
      request_id: string;
      current_stage: string;
      final_decision: string | null;
      state: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT * FROM gate_pipeline_state WHERE request_id = $1 LIMIT 1',
      [requestId]
    );
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      requestId: row.request_id,
      currentStage: row.current_stage,
      finalDecision: row.final_decision ?? undefined,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async list(limit = 100): Promise<GatePipelineStateRecord[]> {
    const { rows } = await this.pool.query<{
      id: string;
      request_id: string;
      current_stage: string;
      final_decision: string | null;
      state: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT * FROM gate_pipeline_state ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      currentStage: row.current_stage,
      finalDecision: row.final_decision ?? undefined,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
