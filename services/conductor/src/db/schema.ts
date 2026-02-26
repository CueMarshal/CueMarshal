/**
 * Drizzle ORM schema for Conductor database
 */

import { pgTable, uuid, text, integer, timestamp, decimal, jsonb, pgEnum, boolean } from "drizzle-orm/pg-core";

// Enums
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "analyzing",
  "in_progress",
  "review",
  "completed",
  "failed",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "tool"]);

// Tasks table
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  giteaIssueId: integer("gitea_issue_id").notNull(),
  giteaRepo: text("gitea_repo").notNull(),
  parentTaskId: uuid("parent_task_id"),
  status: taskStatusEnum("status").notNull().default("pending"),
  agentRole: text("agent_role"),
  modelTier: text("model_tier"),
  currentTier: text("current_tier").default("tier1"),
  branchName: text("branch_name"),
  prNumber: integer("pr_number"),
  progress: integer("progress").default(0),
  progressMessage: text("progress_message"),
  retryCount: integer("retry_count").default(0),
  escalationHistory: jsonb("escalation_history"),
  lastRetryAt: timestamp("last_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chat sessions table
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  giteaRepo: text("gitea_repo").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  goals: jsonb("goals"),
  plan: jsonb("plan"),
  status: text("status").notNull().default("planning"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chatSessions = pgTable("chat_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Chat messages table
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content"),
  toolCalls: jsonb("tool_calls"),
  toolCallId: text("tool_call_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Cost records table
export const costRecords = pgTable("cost_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  project: text("project").notNull(),
  agentRole: text("agent_role"),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Agent session history table (context continuity)
export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .notNull(),
  agentRole: text("agent_role").notNull(),
  toolCalls: jsonb("tool_calls").notNull(),
  context: jsonb("context"),
  executionLog: text("execution_log"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Type exports for TypeScript
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;
