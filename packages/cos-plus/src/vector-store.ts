import type { Pool } from 'pg';
import { insertAuditEvent } from './audit.js';

export async function createVectorTable(pool: Pool, tableName: string, dimension: number): Promise<void> {
  // Ensure pgvector extension is available
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      embedding vector(${dimension}),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Create HNSW index for efficient similarity search
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_embedding
    ON ${tableName} USING hnsw (embedding vector_cosine_ops);
  `);

  // Index for metadata JSONB queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_metadata
    ON ${tableName} USING GIN (metadata);
  `);

  // Index for content text search
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_${tableName}_content
    ON ${tableName} USING GIN (to_tsvector('english', content));
  `);
}

export interface VectorRecordInput {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export async function insertVector(
  pool: Pool,
  tableName: string,
  input: VectorRecordInput
): Promise<void> {
  const sql = `
    INSERT INTO ${tableName} (id, content, embedding, metadata, updated_at)
    VALUES ($1, $2, $3::vector, $4, now())
    ON CONFLICT (id) DO UPDATE SET
      content = EXCLUDED.content,
      embedding = EXCLUDED.embedding,
      metadata = EXCLUDED.metadata,
      updated_at = now();
  `;
  await pool.query(sql, [
    input.id,
    input.content,
    JSON.stringify(input.embedding),
    JSON.stringify(input.metadata ?? {}),
  ]);

  await insertAuditEvent(pool, {
    actor: 'system',
    action: 'UPSERT',
    table_name: tableName,
    record_id: input.id,
    new_data: { content: input.content, metadata: input.metadata },
    metadata: { operation: 'vector_insert', dimension: input.embedding.length },
  });
}

function parseVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    // Handle pgvector string formats: "[1,2,3]" or "{1,2,3}"
    const cleaned = raw.replace(/^\[|]$/g, '').replace(/^\{|}$/g, '');
    return cleaned.split(',').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
  }
  return [];
}
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  distance: number;
}

export async function searchSimilar(
  pool: Pool,
  tableName: string,
  queryEmbedding: number[],
  limit: number = 10,
  minDistance: number = 0.0
): Promise<VectorSearchResult[]> {
  // minDistance is interpreted as minimum similarity score (0.0 to 1.0)
  // Higher values = more similar results only. Default 0.0 includes all.
  const sql = `
    SELECT id, content, embedding, metadata,
           1 - (embedding <=> $1::vector) AS similarity,
           embedding <=> $1::vector AS distance
    FROM ${tableName}
    WHERE 1 - (embedding <=> $1::vector) >= $2
    ORDER BY embedding <=> $1::vector
    LIMIT $3;
  `;
  const result = await pool.query(sql, [JSON.stringify(queryEmbedding), minDistance, limit]);
  return result.rows.map((row) => ({
    id: row.id as string,
    content: row.content as string,
    embedding: parseVector(row.embedding),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    distance: parseFloat(row.distance as string),
  }));
}

export async function deleteVector(
  pool: Pool,
  tableName: string,
  id: string
): Promise<void> {
  const sql = `DELETE FROM ${tableName} WHERE id = $1 RETURNING *;`;
  const result = await pool.query(sql, [id]);

  if (result.rowCount && result.rowCount > 0) {
    await insertAuditEvent(pool, {
      actor: 'system',
      action: 'DELETE',
      table_name: tableName,
      record_id: id,
      old_data: result.rows[0],
      metadata: { operation: 'vector_delete', reason: 'user_request' },
    });
  }
}

export async function getVectorById(
  pool: Pool,
  tableName: string,
  id: string
): Promise<VectorSearchResult | null> {
  const sql = `
    SELECT id, content, embedding, metadata, 0::float8 AS distance
    FROM ${tableName}
    WHERE id = $1
    LIMIT 1;
  `;
  const result = await pool.query(sql, [id]);
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    content: row.content as string,
    embedding: parseVector(row.embedding),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    distance: 0,
  };
}

export async function searchVectorContent(
  pool: Pool,
  tableName: string,
  searchText: string,
  limit: number = 10
): Promise<VectorSearchResult[]> {
  const sql = `
    SELECT id, content, embedding, metadata, 0::float8 AS distance
    FROM ${tableName}
    WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
    ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
    LIMIT $2;
  `;
  const result = await pool.query(sql, [searchText, limit]);
  return result.rows.map((row) => ({
    id: row.id as string,
    content: row.content as string,
    embedding: parseVector(row.embedding),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    distance: 0,
  }));
}
