# Gitea MCP Tools

MCP tool definitions for interacting with the Gitea API. Each file exports a tool group that is registered on the Gitea MCP server.

## Files

| File | Description |
|------|-------------|
| `issues.ts` | Create, list, update, and comment on Gitea issues with label name-to-ID resolution support |
| `labels.ts` | List and create labels at organization and repository scope for use in issue/PR management |
| `pull-requests.ts` | Create pull requests, list PRs, add reviews, and merge PRs in Gitea repositories |
| `repositories.ts` | Create repositories, list org repos, get file contents, and create/update files in repos |
| `search.ts` | Search code and repositories across the Gitea instance with filtering by owner and repo |
| `workflows.ts` | Trigger Gitea Actions workflows via the dispatch API and list workflow runs for a repository |

## Purpose

This module exposes Gitea's API surface as MCP tools so that agents (via OpenCode) and the Conductor (via the chat handler) can programmatically manage repositories, issues, pull requests, labels, and CI/CD workflows.
