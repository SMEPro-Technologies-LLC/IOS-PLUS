-- IOS+ Platform — PostgreSQL Extensions
-- PostgreSQL 16+ with pgvector support
-- ============================================================

-- UUID generation and functions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cryptographic functions (digest, hmac, etc.)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Vector embeddings for RAG (pgvector)
CREATE EXTENSION IF NOT EXISTS "vector";

-- Trigram-based fuzzy text search (pg_trgm)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Verify extensions installed
DO $$
BEGIN
    ASSERT (SELECT count(*) FROM pg_extension WHERE extname IN ('uuid-ossp', 'pgcrypto', 'vector', 'pg_trgm')) = 4,
        'Not all required extensions were installed';
END
$$;
