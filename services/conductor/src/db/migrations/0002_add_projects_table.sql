-- Migration: Add projects table for project lifecycle management
-- Created: 2026-02-12

CREATE TABLE IF NOT EXISTS "projects" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "gitea_repo" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "goals" JSONB,
  "plan" JSONB,
  "status" TEXT NOT NULL DEFAULT 'planning',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by repo
CREATE INDEX IF NOT EXISTS "idx_projects_gitea_repo" ON "projects" ("gitea_repo");

-- Index for status queries
CREATE INDEX IF NOT EXISTS "idx_projects_status" ON "projects" ("status");

-- Index for recent projects
CREATE INDEX IF NOT EXISTS "idx_projects_updated_at" ON "projects" ("updated_at" DESC);
