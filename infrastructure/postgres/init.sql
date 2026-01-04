-- Initialize PostgreSQL databases for CueMarshal platform
-- This script runs only on first container start against the default (cuemarshal) database
--
-- IMPORTANT: Database creation must happen BEFORE any optional extension setup
-- (e.g., pgvector) because docker-entrypoint.sh runs .sql files with ON_ERROR_STOP=1.

-- ═══════════════════════════════════════
-- Create required databases FIRST
-- ═══════════════════════════════════════

CREATE DATABASE gitea OWNER cuemarshal;
CREATE DATABASE litellm OWNER cuemarshal;
CREATE DATABASE sonarqube OWNER cuemarshal;

-- ═══════════════════════════════════════
-- Database: cuemarshal (Conductor + shared)
-- ═══════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS conductor;

GRANT ALL PRIVILEGES ON SCHEMA conductor TO cuemarshal;
GRANT ALL PRIVILEGES ON SCHEMA public TO cuemarshal;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER DATABASE cuemarshal SET search_path TO public, conductor;

-- ═══════════════════════════════════════
-- pgvector setup (optional, non-fatal)
-- ═══════════════════════════════════════
-- Wrapped in a DO block so a missing pgvector extension won't abort the script.
-- The 02-enable-vector.sql init script provides a second attempt if needed.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS project_embeddings (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      project TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      content_text TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(project, content_type, content_ref)
    );

    CREATE INDEX IF NOT EXISTS idx_embeddings_project ON project_embeddings(project);
    CREATE INDEX IF NOT EXISTS idx_embeddings_type ON project_embeddings(content_type);
    CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON project_embeddings
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

    RAISE NOTICE 'pgvector extension enabled and project_embeddings table created';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not available (%), skipping vector table setup', SQLERRM;
END $$;

DO $$
BEGIN
    RAISE NOTICE 'CueMarshal platform databases initialized:';
    RAISE NOTICE '  - cuemarshal: Conductor service (with conductor schema)';
    RAISE NOTICE '  - gitea: Gitea server';
    RAISE NOTICE '  - litellm: LiteLLM Gateway';
    RAISE NOTICE '  - sonarqube: SonarQube code analysis';
END $$;
