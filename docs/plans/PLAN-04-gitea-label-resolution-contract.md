# Plan 04: Gitea Label Resolution Contract

## Goal
Eliminate label-application failures by introducing a clear label name to ID resolution flow for MCP issue creation.

## Problem Statement
Workflows/prompts use label names while `gitea_create_issue` expects numeric label IDs.

## Requirements

### Functional Requirements
- Add an MCP tool to list org/repo labels with IDs.
- Support `gitea_create_issue` accepting label names and resolving internally.
- Validate labels before submit; provide explicit error for unresolved labels.
- Cache label mappings for the run to avoid repeated API calls.

### Non-Functional Requirements
- No silent label drops.
- Clear observability when label mapping fails.

## Acceptance Criteria
- Every created issue contains intended labels.
- Label mapping failures are explicit and actionable.
