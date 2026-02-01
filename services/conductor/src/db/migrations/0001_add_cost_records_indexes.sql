-- Migration: Add indexes to cost_records table for query performance
-- Created: 2026-02-10

-- Index on created_at for time-based queries (monthly/weekly/daily summaries)
CREATE INDEX IF NOT EXISTS "cost_records_created_at_idx" ON "cost_records" ("created_at");

-- Index on project for filtering by project
CREATE INDEX IF NOT EXISTS "cost_records_project_idx" ON "cost_records" ("project");

-- Index on agent_role for filtering by agent role (e.g., self-improve)
CREATE INDEX IF NOT EXISTS "cost_records_agent_role_idx" ON "cost_records" ("agent_role");

-- Index on model for filtering by model tier
CREATE INDEX IF NOT EXISTS "cost_records_model_idx" ON "cost_records" ("model");

-- Index on task_id for task-specific cost queries
CREATE INDEX IF NOT EXISTS "cost_records_task_id_idx" ON "cost_records" ("task_id");

-- Composite index for self-improvement budget queries (created_at + agent_role)
CREATE INDEX IF NOT EXISTS "cost_records_created_at_agent_role_idx" ON "cost_records" ("created_at", "agent_role");
