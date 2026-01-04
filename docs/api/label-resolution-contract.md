# Gitea Label Resolution Contract

## Overview

This document defines the canonical label resolution flow for creating Gitea issues through MCP tools. It addresses the mismatch between workflows that use human-readable label names and the Gitea API that requires numeric label IDs.

## Problem Statement

Workflows, agents, and prompts naturally reference labels by name (e.g., `self-improvement`, `role:developer`, `complexity:simple`), but the Gitea API requires numeric label IDs. This mismatch can lead to:

- Silent label drops when IDs cannot be resolved
- Workflow failures due to incorrect label references
- Poor observability when label resolution fails

## Solution

The platform provides multiple approaches to resolve label names to IDs, with built-in validation and caching.

## Label Scope and Precedence

Labels can exist at two scopes:

1. **Organization-level**: Labels available across all repos in an organization
2. **Repository-level**: Labels specific to a single repository

**Precedence Rule**: When a label name exists at both scopes, repository-level labels take precedence.

## MCP Tools

### `gitea_list_labels`

Lists all labels available for a repository or organization.

**Parameters**: `owner` (required), `repo` (optional)

### `gitea_resolve_label_names`

Resolves label names to IDs with explicit error handling.

**Parameters**: `owner`, `repo`, `labelNames` (all required)

### `gitea_create_issue` (Enhanced)

Creates a Gitea issue with automatic label resolution.

**Label Parameters**:
- `labels` (optional): Array of label IDs
- `labelNames` (optional): Array of label names (automatically resolved to IDs)

## Conductor Integration

The Conductor service provides label resolution with caching via `getLabelIds(owner, labelNames, repo?)` in `services/conductor/src/queue/worker.ts`.

**Features**: In-memory caching, dual-scope (org + repo), fail-fast validation.

## Best Practices

1. **Use label names, not IDs** in workflows and prompts
2. **Use `gitea_list_labels`** to verify labels exist before batch operations
3. **Handle errors gracefully** – resolution failures include available labels
