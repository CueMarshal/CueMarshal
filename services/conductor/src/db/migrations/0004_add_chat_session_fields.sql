-- Migration: Add title and is_favorite fields to chat_sessions table
-- Created: 2026-02-25

ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "is_favorite" BOOLEAN NOT NULL DEFAULT false;
