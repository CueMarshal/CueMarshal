#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

create_database_if_missing() {
  db_name="$1"

  if psql -h postgres -U "${POSTGRES_USER}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'" | grep -q 1; then
    echo "Database '${db_name}' already exists"
    return 0
  fi

  echo "Creating database '${db_name}'..."
  psql -h postgres -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"${db_name}\" OWNER \"${POSTGRES_USER}\""
}

create_database_if_missing "gitea"
create_database_if_missing "litellm"
create_database_if_missing "sonarqube"

psql -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 <<SQL
CREATE SCHEMA IF NOT EXISTS conductor AUTHORIZATION "${POSTGRES_USER}";
GRANT ALL PRIVILEGES ON SCHEMA conductor TO "${POSTGRES_USER}";
GRANT ALL PRIVILEGES ON SCHEMA public TO "${POSTGRES_USER}";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
ALTER DATABASE "${POSTGRES_DB}" SET search_path TO public, conductor;
SQL

psql -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" <<SQL || true
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

GRANT ALL PRIVILEGES ON project_embeddings TO "${POSTGRES_USER}";
SQL
