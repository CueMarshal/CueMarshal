# MCP Servers

## Overview

The CueMarshal platform uses three Model Context Protocol (MCP) servers to provide a unified, structured tool layer for all interactions with internal systems. These servers replace ad-hoc API calls with typed, validated tool interfaces that both automated agents and the mobile chat handler use.

All three servers are implemented in TypeScript using the `@modelcontextprotocol/sdk` package and support **dual transports**:

- **stdio**: Used by OpenCode in Gitea runners. OpenCode spawns the MCP server as a child process.
- **HTTP/SSE (Streamable HTTP)**: Used by the Conductor's chat handler. The Conductor connects to long-running MCP server instances over the network.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   MCP Tool Layer                     │
│                                                      │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────┐ │
│  │  Gitea MCP   │  │ Conductor MCP  │  │System MCP│ │
│  │  :4200       │  │  :4201         │  │  :4202   │ │
│  └──────┬───────┘  └───────┬────────┘  └────┬─────┘ │
│         │                  │                 │       │
│         │    HTTP/SSE      │    HTTP/SSE     │       │
│         ▼                  ▼                 ▼       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Conductor Chat Handler              │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│         │    stdio         │    stdio         │       │
│         ▼                  ▼                 ▼       │
│  ┌─────────────────────────────────────────────────┐ │
│  │         OpenCode Agents (in Runners)             │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Shared Package Structure

```
services/mcp-servers/
├── package.json            # Workspace root
├── tsconfig.base.json      # Shared TypeScript config
├── shared/
│   └── src/
│       ├── transport.ts    # Dual transport setup (stdio + HTTP/SSE)
│       ├── auth.ts         # Shared authentication utilities
│       └── types.ts        # Shared type definitions
├── gitea-mcp/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── tools/
│       │   ├── issues.ts
│       │   ├── pull-requests.ts
│       │   ├── repositories.ts
│       │   ├── workflows.ts
│       │   └── search.ts
│       └── auth.ts
├── conductor-mcp/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── tools/
│       │   ├── tasks.ts
│       │   ├── agents.ts
│       │   └── projects.ts
│       └── auth.ts
└── system-mcp/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts
        ├── tools/
        │   ├── costs.ts
        │   ├── runners.ts
        │   └── health.ts
        └── auth.ts
```

## Dual Transport Implementation

Each MCP server supports both transports from the same entry point. The transport is selected based on a command-line flag or environment variable.

```typescript
// shared/src/transport.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamablehttp.js";
import express from "express";

export async function startServer(server: Server, options: {
  name: string;
  port?: number;
}) {
  const mode = process.env.MCP_TRANSPORT || "stdio";

  if (mode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${options.name}] Running in stdio mode`);
  } else if (mode === "http") {
    const app = express();
    const port = options.port || 4200;

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    app.post("/mcp", async (req, res) => {
      await transport.handleRequest(req, res);
    });
    app.get("/mcp", async (req, res) => {
      await transport.handleRequest(req, res);
    });
    app.delete("/mcp", async (req, res) => {
      await transport.handleRequest(req, res);
    });
    app.get("/health", (req, res) => {
      res.json({ status: "healthy", name: options.name });
    });

    await server.connect(transport);
    app.listen(port, () => {
      console.log(`[${options.name}] HTTP/SSE server on port ${port}`);
    });
  }
}
```

## Gitea MCP Server

**Port**: 4200 (HTTP/SSE mode)
**Purpose**: Structured interface for all Gitea operations.

### Tools

#### `gitea_create_issue`

Create a new issue in a Gitea repository.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner (user or org) |
| `repo` | `string` | Yes | Repository name |
| `title` | `string` | Yes | Issue title |
| `body` | `string` | No | Issue body (markdown) |
| `labels` | `number[]` | No | Array of label IDs |
| `milestone` | `number` | No | Milestone ID |
| `assignees` | `string[]` | No | Array of assignee usernames |

**Returns:** Gitea issue object with `id`, `number`, `html_url`.

#### `gitea_get_issue`

Get details of a specific issue.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `issue_number` | `number` | Yes | Issue number |

**Returns:** Full issue object including `title`, `body`, `state`, `labels`, `assignees`, `comments`.

#### `gitea_update_issue`

Update an existing issue.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `issue_number` | `number` | Yes | Issue number |
| `title` | `string` | No | New title |
| `body` | `string` | No | New body |
| `state` | `string` | No | `open` or `closed` |
| `labels` | `number[]` | No | Replace label IDs |

**Returns:** Updated issue object.

#### `gitea_add_comment`

Add a comment to an issue or pull request.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `issue_number` | `number` | Yes | Issue or PR number |
| `body` | `string` | Yes | Comment body (markdown) |

**Returns:** Comment object with `id`, `body`, `created_at`.

#### `gitea_list_issues`

List issues with filters.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `state` | `string` | No | `open`, `closed`, or `all` (default: `open`) |
| `labels` | `string` | No | Comma-separated label names |
| `milestone` | `string` | No | Milestone name |
| `page` | `number` | No | Page number (default: 1) |
| `limit` | `number` | No | Items per page (default: 20) |

**Returns:** Array of issue objects.

#### `gitea_create_pull_request`

Create a new pull request.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `title` | `string` | Yes | PR title |
| `body` | `string` | No | PR body (markdown) |
| `head` | `string` | Yes | Source branch |
| `base` | `string` | Yes | Target branch |
| `labels` | `number[]` | No | Label IDs |
| `assignees` | `string[]` | No | Reviewer usernames |

**Returns:** PR object with `number`, `html_url`.

#### `gitea_get_pull_request`

Get PR details including diff stats.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `pr_number` | `number` | Yes | PR number |

**Returns:** Full PR object including `diff_url`, `changed_files`, `additions`, `deletions`.

#### `gitea_merge_pull_request`

Merge a pull request.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `pr_number` | `number` | Yes | PR number |
| `merge_type` | `string` | No | `merge`, `rebase`, or `squash` (default: `merge`) |
| `message` | `string` | No | Merge commit message |

**Returns:** Merge result object.

#### `gitea_create_review`

Submit a pull request review.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `pr_number` | `number` | Yes | PR number |
| `event` | `string` | Yes | `APPROVED`, `REQUEST_CHANGES`, or `COMMENT` |
| `body` | `string` | No | Review body |
| `comments` | `object[]` | No | Inline comments (`path`, `line`, `body`) |

**Returns:** Review object.

#### `gitea_create_branch`

Create a new branch.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `branch_name` | `string` | Yes | New branch name |
| `old_branch_name` | `string` | No | Source branch (default: default branch) |

**Returns:** Branch object.

#### `gitea_get_file_contents`

Read file contents from a repository.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `filepath` | `string` | Yes | Path to file |
| `ref` | `string` | No | Branch or commit ref |

**Returns:** File content object with `content` (base64), `encoding`, `size`.

#### `gitea_list_repos`

List repositories for an owner.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | User or org name |
| `page` | `number` | No | Page number |
| `limit` | `number` | No | Items per page |

**Returns:** Array of repository objects.

#### `gitea_dispatch_workflow`

Trigger a Gitea Actions workflow.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `owner` | `string` | Yes | Repository owner |
| `repo` | `string` | Yes | Repository name |
| `workflow_id` | `string` | Yes | Workflow filename (e.g., `task-execute.yml`) |
| `ref` | `string` | No | Branch ref (default: `main`) |
| `inputs` | `object` | No | Workflow input parameters |

**Returns:** Dispatch confirmation.

#### `gitea_search_code`

Search code across repositories.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | `string` | Yes | Search query |
| `owner` | `string` | No | Limit to specific owner |
| `repo` | `string` | No | Limit to specific repo |

**Returns:** Array of search results with file path, content snippet, repository.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITEA_URL` | Yes | Gitea server URL |
| `GITEA_TOKEN` | Yes | API token with appropriate scopes |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4200`) |

---

## Conductor MCP Server

**Port**: 4201 (HTTP/SSE mode)
**Purpose**: Task coordination, agent status, and project management.

### Tools

#### `task_report_progress`

Agent reports progress on a task.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | `string` | Yes | Task UUID |
| `progress` | `number` | Yes | Completion percentage (0-100) |
| `status_message` | `string` | Yes | Human-readable status |
| `phase` | `string` | No | Current phase (e.g., `coding`, `testing`) |

**Returns:** Acknowledgment.

#### `task_request_help`

Agent requests assistance from another role.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | `string` | Yes | Current task UUID |
| `requested_role` | `string` | Yes | Role needed (e.g., `architect`, `devops`) |
| `description` | `string` | Yes | What help is needed |
| `blocking` | `boolean` | No | Whether this blocks current work (default: `false`) |

**Returns:** Help request ID and status.

#### `task_get_context`

Get full context for a task including parent, siblings, and related PRs.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `task_id` | `string` | Yes | Task UUID |

**Returns:**

```json
{
  "task": { "id": "...", "title": "...", "status": "in_progress", ... },
  "parent": { "id": "...", "title": "...", "status": "in_progress", ... },
  "sub_tasks": [...],
  "related_prs": [...],
  "dependencies": [...]
}
```

#### `task_list_active`

List all in-progress tasks across projects.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project` | `string` | No | Filter by project name |
| `role` | `string` | No | Filter by agent role |
| `status` | `string` | No | Filter by status |

**Returns:** Array of active task objects.

#### `agent_get_status`

Query the status of a specific agent/runner.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runner_id` | `string` | No | Specific runner ID |
| `role` | `string` | No | Agent role to query |

**Returns:** Agent status including current task, utilization, uptime.

#### `agent_list_available`

List available agent roles and their current assignments.

**Parameters:** None required.

**Returns:**

```json
{
  "agents": [
    {
      "role": "developer",
      "runners": 2,
      "active_tasks": 1,
      "queue_depth": 3,
      "idle_runners": 1
    },
    ...
  ]
}
```

#### `project_list`

List all projects with summary status.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `status` | `string` | No | Filter by status (`active`, `completed`, `all`) |

**Returns:** Array of project summaries with repo count, open issues, active PRs.

#### `project_get_details`

Get detailed project information.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project` | `string` | Yes | Project name or repo full name |

**Returns:** Full project details including repositories, milestones, task breakdown by status, recent activity.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONDUCTOR_URL` | Yes | Conductor internal API URL |
| `CONDUCTOR_SECRET` | Yes | Shared secret for authentication |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4201`) |

---

## System MCP Server

**Port**: 4202 (HTTP/SSE mode)
**Purpose**: Observability into LLM costs, runner status, and system health.

### Tools

#### `cost_get_summary`

Get LLM spending summary.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `period` | `string` | No | `day`, `week`, `month` (default: `month`) |
| `project` | `string` | No | Filter by project |
| `model` | `string` | No | Filter by model tier |

**Returns:**

```json
{
  "total_cost_usd": 42.50,
  "total_tokens": 1250000,
  "breakdown_by_model": {
    "tier1": { "cost": 5.00, "requests": 200 },
    "tier2": { "cost": 30.00, "requests": 100 },
    "tier3": { "cost": 7.50, "requests": 5 }
  },
  "breakdown_by_project": {
    "project-alpha": 25.00,
    "project-beta": 17.50
  }
}
```

#### `cost_get_budget`

Check remaining budget.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `project` | `string` | No | Specific project (or system-wide) |

**Returns:**

```json
{
  "budget_usd": 100.00,
  "spent_usd": 42.50,
  "remaining_usd": 57.50,
  "projected_monthly_usd": 85.00,
  "self_improvement_budget_usd": 10.00,
  "self_improvement_spent_usd": 3.20
}
```

#### `runner_get_status`

Get runner utilization and queue depth.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `runner_id` | `string` | No | Specific runner ID |

**Returns:**

```json
{
  "total_runners": 4,
  "active_runners": 2,
  "idle_runners": 2,
  "queue_depth": 5,
  "average_job_duration_seconds": 180
}
```

#### `runner_list`

List all registered runners with status.

**Parameters:** None required.

**Returns:** Array of runner objects with `id`, `name`, `status`, `labels`, `current_job`, `uptime`.

#### `health_check`

Check health of all platform services.

**Parameters:** None required.

**Returns:**

```json
{
  "overall": "healthy",
  "services": {
    "gitea": { "status": "healthy", "latency_ms": 12 },
    "conductor": { "status": "healthy", "latency_ms": 5 },
    "gateway": { "status": "healthy", "latency_ms": 8 },
    "redis": { "status": "healthy", "latency_ms": 1 },
    "postgres": { "status": "healthy", "latency_ms": 3 }
  }
}
```

#### `metrics_get`

Get platform performance metrics.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `period` | `string` | No | `day`, `week`, `month` (default: `week`) |

**Returns:**

```json
{
  "tasks_completed": 45,
  "tasks_failed": 3,
  "success_rate": 0.937,
  "average_task_duration_minutes": 12,
  "prs_merged": 42,
  "self_improvements_completed": 8,
  "total_llm_calls": 1250,
  "total_tokens_used": 5000000
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GATEWAY_URL` | Yes | LiteLLM Gateway URL |
| `GATEWAY_API_KEY` | Yes | LiteLLM admin key for spend endpoints |
| `REDIS_URL` | Yes | Redis connection string |
| `CONDUCTOR_URL` | Yes | Conductor internal API URL |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4202`) |

---

## Security

### Authentication

Each MCP server validates the identity of its callers:

- **Gitea MCP**: Uses scoped Gitea API tokens. Different agent roles receive tokens with different permission levels (e.g., reviewer tokens cannot merge PRs).
- **Conductor MCP**: Validates runner identity via a shared secret passed as a bearer token.
- **System MCP**: Read-only by default. No destructive operations.

### Tool Scoping Per Agent Role

Agent profiles in OpenCode restrict which MCP tools are accessible. The `opencode.json` for each role specifies the MCP configuration, and role-specific system prompts instruct the LLM on which tools to use.

| Role | Gitea MCP Tools | Conductor MCP Tools | System MCP Tools |
|------|----------------|--------------------|--------------------|
| Architect | All read + create_issue, add_comment | All | All |
| Developer | All | All | cost_get_budget, runner_get_status |
| Reviewer | Read only + create_review, add_comment | task_report_progress, task_get_context | Read only |
| Tester | Read only + add_comment | task_report_progress, task_get_context | Read only |
| DevOps | All | All | All |
| Docs | Read only + add_comment | task_report_progress | Read only |

### Network Security

In HTTP/SSE mode, MCP servers listen only on the internal Docker network. They are not exposed through Nginx. Only the Conductor and runners (on the same Docker network) can reach them.

## Dockerfile

Each MCP server shares the same Dockerfile template:

```dockerfile
FROM node:25-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/ ./shared/
COPY gitea-mcp/ ./gitea-mcp/   # or conductor-mcp/ or system-mcp/
RUN npm ci
RUN npm run build

FROM node:25-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
ENV MCP_TRANSPORT=http
EXPOSE 4200
CMD ["node", "dist/gitea-mcp/src/index.js"]
```
