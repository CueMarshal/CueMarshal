# Conductor MCP Tools

MCP tool definitions for managing agents, projects, sessions, and tasks through the Conductor's internal API.

## Files

| File | Description |
|------|-------------|
| `agents.ts` | Query agent/runner status and list available agent roles and their current assignments |
| `projects.ts` | Create projects (repo + plan), list projects, get project details, and approve/reject project plans |
| `sessions.ts` | Retrieve agent session history for context continuity across successive agent executions on a task |
| `tasks.ts` | Report task progress, update task status, and query task details and history |

## Purpose

This module provides the MCP tool surface that lets agents and the chat handler interact with the Conductor's orchestration state — creating projects, tracking task progress, querying agent availability, and maintaining session context.
