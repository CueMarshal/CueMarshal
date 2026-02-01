# Conductor API

Express route modules that define the Conductor's HTTP API surface. Routes are registered centrally via `routes.ts`.

## Files

| File | Description |
|------|-------------|
| `routes.ts` | Central route registration — mounts webhook, chat, mobile, and internal routers on the Express app |
| `webhooks.ts` | Gitea webhook handler with idempotency, loop detection, signature verification, and queue-based dispatch |
| `chat.ts` | Chat API routes for the mobile app — accepts natural language messages and returns MCP-powered responses |
| `mobile.ts` | Mobile-specific REST endpoints for listing projects, tasks, and dashboard data |
| `internal.ts` | Internal API used by the gateway, runners, and MCP servers — cost ingestion, project management, self-improvement triggers, and task progress |

## Purpose

This module defines all inbound HTTP interfaces for the Conductor. External traffic arrives via Gitea webhooks and the mobile app, while internal traffic comes from runners reporting results and MCP servers querying state.
