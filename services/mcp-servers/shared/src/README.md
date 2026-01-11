# MCP Servers — Shared Utilities

Common code shared across all MCP server packages (gitea-mcp, conductor-mcp, system-mcp).

## Files

| File | Description |
|------|-------------|
| `auth.ts` | Shared authentication utilities — bearer token validation and auth context extraction from env/headers |
| `transport.ts` | Dual transport setup (stdio + HTTP/SSE) for MCP servers — stdio for runners, HTTP for the Conductor chat handler |
| `types.ts` | Shared TypeScript interfaces — `MCPServerOptions`, `AuthContext`, and `HealthStatus` |

## Purpose

This module eliminates duplication across MCP servers by providing a single source of truth for transport initialization, authentication, and common type definitions. Each MCP server imports from this package to bootstrap itself with a consistent configuration.
