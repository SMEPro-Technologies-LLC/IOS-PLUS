-- ============================================================
-- IOS+ COS+ Database — V7 UCO Vector Embedding Column
-- Flyway migration: V7__uco_vector_embedding.sql
-- Adds vector_embedding column to uco_nodes and configures HNSW index
-- ============================================================

-- Add column if not exists
ALTER TABLE uco_nodes ADD COLUMN IF NOT EXISTS vector_embedding vector(1536);

-- Add HNSW cosine index
CREATE INDEX IF NOT EXISTS idx_uco_nodes_vector_embedding 
ON uco_nodes USING hnsw (vector_embedding vector_cosine_ops) 
WITH (m=16, ef_construction=200);

-- Grant privileges for app and ingestion roles
GRANT SELECT, UPDATE ON uco_nodes TO ios_app;
GRANT SELECT, UPDATE ON uco_nodes TO rag_writer;
