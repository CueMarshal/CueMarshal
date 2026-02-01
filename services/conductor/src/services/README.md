# Conductor Services

Core business-logic services for the Conductor orchestrator. These services handle task routing, model selection, workflow triggering, chat processing, and self-improvement.

## Files

| File | Description |
|------|-------------|
| `agent-router.ts` | Maps incoming tasks to agent roles and dispatches workflow execution based on issue labels and complexity |
| `chat-handler.ts` | Processes natural language messages from the mobile app using MCP tools and OpenAI-compatible gateway |
| `gitea-client.ts` | Gitea REST API client wrapper with role-based token authentication and fallback chain |
| `mcp-registry.ts` | Manages connections to MCP servers (gitea, conductor, system) via HTTP/SSE transport |
| `model-selector.ts` | Analyzes task complexity and selects the optimal LLM tier with budget-aware downgrade logic |
| `project-planner.ts` | Generates project plans with milestones, issues, and checkpoints using LLM structured output |
| `retry-policy.ts` | Defines retry limits, tier escalation rules, and exponential backoff strategies for failed tasks |
| `self-improvement.ts` | Manages the self-improvement cycle with readiness checks, cooldown, correlation tracking, and budget guards |
| `task-decomposer.ts` | Uses LLM to break down complex tasks into typed sub-tasks with role and dependency metadata |
| `workflow-trigger.ts` | Triggers Gitea Actions workflows via dispatch API (self-improve) or push-based branch triggers (task execution) |

## Purpose

This module is the heart of the Conductor. It orchestrates the full lifecycle of a CueMarshal task — from webhook receipt through model selection, agent routing, workflow dispatch, progress tracking, and self-healing retries.
