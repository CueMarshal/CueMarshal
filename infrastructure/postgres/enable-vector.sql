-- Enable pgvector extension for semantic search (optional)
-- pgvector must be installed in the PostgreSQL image for this to work
-- Use ankane/pgvector or postgres with pgvector extension pre-installed

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
    
    CREATE TABLE IF NOT EXISTS project_embeddings (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      project TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_ref TEXT NOT NULL,
      content_text TEXT NOT NULL,
      embedding vector(1536),
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(project, content_type, content_ref)
    );

    CREATE INDEX IF NOT EXISTS project_embeddings_vector_idx 
      ON project_embeddings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);

    CREATE INDEX IF NOT EXISTS project_embeddings_project_type_idx 
      ON project_embeddings (project, content_type);

    CREATE INDEX IF NOT EXISTS project_embeddings_created_idx 
      ON project_embeddings (created_at DESC);

    GRANT ALL PRIVILEGES ON project_embeddings TO cuemarshal;

    RAISE NOTICE 'pgvector extension enabled and project_embeddings table created';
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'pgvector not available, skipping vector search setup: %', SQLERRM;
END $$;
