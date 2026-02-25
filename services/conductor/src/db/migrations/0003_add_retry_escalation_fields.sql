-- Migration: Add retry and tier escalation fields to tasks table
-- Plan: PLAN-07 - Workflow Retry and Model Tier Escalation
-- Date: 2026-02-10

-- Add current_tier column to track the current model tier
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS current_tier TEXT DEFAULT 'tier1';

-- Add escalation_history column to track tier progression
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS escalation_history JSONB;

-- Add last_retry_at column to track retry timing for cooldown enforcement
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMP;

-- Add index on current_tier for faster queries
CREATE INDEX IF NOT EXISTS idx_tasks_current_tier ON tasks(current_tier);

-- Add index on retry_count for monitoring
CREATE INDEX IF NOT EXISTS idx_tasks_retry_count ON tasks(retry_count);

-- Add index on last_retry_at for cooldown queries
CREATE INDEX IF NOT EXISTS idx_tasks_last_retry_at ON tasks(last_retry_at);

-- Add comment to document the schema
COMMENT ON COLUMN tasks.current_tier IS 'Current model tier (tier1, tier2, tier3) for retry escalation';
COMMENT ON COLUMN tasks.escalation_history IS 'JSON array tracking tier escalation history with timestamps and reasons';
COMMENT ON COLUMN tasks.last_retry_at IS 'Timestamp of last retry attempt for cooldown enforcement';
