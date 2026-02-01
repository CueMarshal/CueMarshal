# Conductor Service

## Overview

The Conductor is the central orchestration service of the CueMarshal platform. It is a TypeScript/Node.js application that receives events, makes decisions, dispatches work to agents, manages the mobile chat interface, and coordinates the entire task lifecycle.

## Technology Stack

- **Runtime**: Node.js 22+ with TypeScript
- **HTTP Server**: Express.js
- **Job Queue**: BullMQ (backed by Redis)
- **Database ORM**: Drizzle ORM with PostgreSQL
- **WebSocket**: ws library for real-time mobile updates
- **LLM Client**: OpenAI SDK (pointed at LiteLLM Gateway)
- **MCP Client**: @modelcontextprotocol/sdk (HTTP/SSE transport)
- **Validation**: Zod schemas

## Directory Structure

```
services/conductor/
├── Dockerfile
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                # Entry point: start server + workers
    ├── config.ts               # Environment-based configuration
    ├── api/
    │   ├── routes.ts           # REST API route registration
    │   ├── webhooks.ts         # POST /webhooks/gitea handler
    │   ├── chat.ts             # POST /api/chat (MCP-powered)
    │   └── mobile.ts           # Mobile-specific REST endpoints
    ├── services/
    │   ├── gitea-client.ts     # Gitea REST API wrapper
    │   ├── task-decomposer.ts  # LLM-powered task breakdown
    │   ├── agent-router.ts     # Map tasks to agent roles
    │   ├── model-selector.ts   # Complexity analysis + tier selection
    │   ├── workflow-trigger.ts # Trigger workflows via branch push and sentinel files
    │   ├── mcp-registry.ts     # MCP server connection manager
    │   ├── chat-handler.ts     # LLM chat with MCP tool execution
    │   └── self-improvement.ts # Idle-time improvement logic
    ├── queue/
    │   ├── worker.ts           # BullMQ worker definitions
    │   └── jobs.ts             # Job type definitions and processors
    ├── websocket/
    │   └── server.ts           # WebSocket server for mobile push
    ├── db/
    │   ├── schema.ts           # Drizzle ORM table definitions
    │   ├── client.ts           # Database connection
    │   └── migrations/         # SQL migrations
    └── utils/
        ├── logger.ts           # Structured logging (pino)
        └── crypto.ts           # Webhook HMAC verification
```

## Configuration

All configuration is via environment variables. The `config.ts` module validates and exports typed config.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | HTTP server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `GITEA_URL` | Yes | — | Gitea server URL (e.g., `http://gitea:3000`) |
| `GITEA_TOKEN` | Yes | — | Gitea API token with repo/issue/workflow scopes |
| `GATEWAY_URL` | Yes | — | LiteLLM Gateway URL (e.g., `http://gateway:4100`) |
| `GATEWAY_API_KEY` | Yes | — | LiteLLM master key |
| `MCP_GITEA_URL` | Yes | — | Gitea MCP server SSE endpoint |
| `MCP_CONDUCTOR_URL` | Yes | — | Conductor MCP server SSE endpoint |
| `MCP_SYSTEM_URL` | Yes | — | System MCP server SSE endpoint |
| `WEBHOOK_SECRET` | Yes | — | HMAC secret for Gitea webhook verification |
| `CONDUCTOR_ORG` | No | `cuemarshal` | Gitea organization name |
| `CHAT_MODEL` | No | `tier2` | Default model for chat interactions |
| `DECOMPOSE_MODEL` | No | `tier2` | Model for task decomposition |
| `LOG_LEVEL` | No | `info` | Log level (debug, info, warn, error) |

## Core Components

### Webhook Handler (`api/webhooks.ts`)

Receives `POST /webhooks/gitea` from Gitea. All webhook events are funneled through this single endpoint.

**Processing flow:**

1. Verify HMAC signature using `X-Gitea-Signature` header and `WEBHOOK_SECRET`.
2. Parse the `X-Gitea-Event` header to determine event type.
3. Enqueue the event as a BullMQ job for async processing.
4. Return `200 OK` immediately (webhook handlers must respond fast).

**Supported events and actions:**

| Event | Action |
|-------|--------|
| `issues` (action: `opened`) | Enqueue `task:analyze` job |
| `issues` (action: `labeled`) | Re-route task when a `role:*` label is added |
| `pull_request` (action: `opened`) | Enqueue `review:assign` job |
| `pull_request` (action: `closed`, merged: `true`) | Enqueue `task:complete` job |
| `pull_request_review` (action: `submitted`, state: `APPROVED`) | Enqueue `pr:merge` job (changes requested is logged only) |
| `workflow_run` (action: `completed`) | Enqueue `workflow:result` job |

### Task Decomposer (`services/task-decomposer.ts`)

Breaks down a high-level task (Gitea issue) into actionable sub-tasks.

**Input**: Issue title, body, labels, repository context.

**Process**:

1. Call LLM Gateway with the task description and a decomposition prompt.
2. The LLM returns a structured JSON array of sub-tasks, each with:
   - `title`: Sub-task title
   - `description`: Detailed description
   - `role`: Recommended agent role (`developer`, `architect`, `tester`, etc.)
   - `complexity`: Estimated complexity (`simple`, `standard`, `complex`)
   - `dependencies`: Array of sub-task indices this depends on
3. Validate the response with Zod schema.
4. Create Gitea issues for each sub-task via MCP Gitea server, with:
   - Labels: `role:<role>`, `complexity:<level>`, `parent:<issue_number>`
   - Milestone: Same as parent issue
   - Body: Description with link back to parent issue

**Decomposition prompt template**:

```
You are a project manager for a software development team. Analyze the following task
and break it down into specific, actionable sub-tasks that can be assigned to individual
SDLC roles.

Available roles: architect, developer, reviewer, tester, devops, docs

Task: {title}
Description: {body}
Repository: {repo_name}

Return a JSON array where each element has:
- title: string (concise sub-task title)
- description: string (detailed instructions for the agent)
- role: string (one of the available roles)
- complexity: "simple" | "standard" | "complex"
- dependencies: number[] (indices of sub-tasks this depends on)

Rules:
- Architecture tasks should come first if needed
- Developer tasks should reference the architecture output
- Tester tasks should depend on developer tasks
- Reviewer tasks are auto-assigned to PRs, not listed here
- Documentation tasks should come last
```

### Agent Router (`services/agent-router.ts`)

Maps a task (issue) to an agent role and triggers execution.

**Routing logic:**

1. Read issue labels. If a `role:<name>` label exists, use that role.
2. If no role label, call the model selector to determine the role from the issue content.
3. Call the model selector to determine the model tier.
4. Generate a branch name: `feat/issue-{number}` or `fix/issue-{number}`.
5. Dispatch the appropriate Gitea workflow with inputs:
   - `issue_number`: The Gitea issue number
   - `agent_role`: The selected role
   - `model_tier`: The selected tier
   - `branch_name`: The generated branch name

### Model Selector (`services/model-selector.ts`)

Determines the optimal LLM model tier for a given task. See [../architecture/model-selection.md](../architecture/model-selection.md) for the full algorithm.

**Interface:**

```typescript
interface ModelSelection {
  tier: "tier1" | "tier2" | "tier3";
  reasoning: string;
  estimatedTokens: number;
  estimatedCost: number;
}

function selectModel(task: {
  title: string;
  body: string;
  labels: string[];
  repoSize: number;
}): Promise<ModelSelection>;
```

### MCP Registry (`services/mcp-registry.ts`)

Manages connections to MCP servers over HTTP/SSE transport. Used by the chat handler.

**Responsibilities:**

1. Establish and maintain SSE connections to all three MCP servers.
2. Discover available tools from each server via the MCP `tools/list` method.
3. Maintain a unified tool registry mapping tool names to server connections.
4. Execute tool calls by routing to the appropriate server.
5. Handle reconnection on connection failures.

**Interface:**

```typescript
interface MCPRegistry {
  // Connect to all MCP servers and discover tools
  initialize(): Promise<void>;

  // Get all available tools in OpenAI function-calling format
  getToolDefinitions(): OpenAI.ChatCompletionTool[];

  // Execute a tool call, routing to the correct MCP server
  executeTool(name: string, arguments: Record<string, unknown>): Promise<unknown>;

  // Check connection health
  healthCheck(): Promise<{ gitea: boolean; conductor: boolean; system: boolean }>;
}
```

### Chat Handler (`services/chat-handler.ts`)

Processes natural language messages from the mobile app. This is the bridge between the user and the MCP tool layer.

**Flow:**

1. Receive chat message from `POST /api/chat`.
2. Load conversation history from the database (session-based).
3. Get all MCP tool definitions from the MCP Registry.
4. Call LLM Gateway with:
   - System prompt (CueMarshal platform assistant role)
   - Conversation history
   - User message
   - MCP tools as OpenAI-format functions
5. If the LLM returns `tool_calls`:
   a. Execute each tool via the MCP Registry.
   b. Append tool results to the conversation.
   c. Call the LLM again to continue reasoning.
   d. Repeat until the LLM returns a final text response.
6. Store the conversation turn in the database.
7. Return the response to the mobile app.
8. Push real-time update via WebSocket if needed.

**Chat system prompt:**

```
You are the CueMarshal platform assistant. You help users manage software development
projects through natural language conversation.

You have access to tools that let you:
- Create and manage Gitea repositories, issues, and pull requests
- Query task status, agent availability, and project progress
- Check LLM costs, runner utilization, and system health

When a user asks you to create something, use the appropriate tool. When they ask
about status, query the relevant tools and summarize the results.

Always confirm actions before creating or modifying resources. Be concise but informative.
```

### Self-Improvement Engine (`services/self-improvement.ts`)

See [../operations/self-improvement.md](../operations/self-improvement.md) for full specification.

Runs as a scheduled BullMQ job. Checks runner utilization, scans the codebase for improvement opportunities, and creates Gitea issues for the improvements.

### Workflow Trigger (`services/workflow-trigger.ts`)

Triggers workflows via the Gitea Actions API or by pushing task config files to branches.

**Behavior:**

- Task execution: creates a feature branch and writes `.task.json` to trigger `task-execute.yml`.
- Code review: writes `.review-trigger` to the same branch to trigger `code-review.yml`.
- Tests: (placeholder) logs intent; not yet implemented.
- Self-improvement: calls Gitea `workflow_dispatch` API to trigger `self-improve.yml` (zero commits on `main`).

## Recovery Service (Self-Healing)

**Location**: `queue/recovery.ts`

The recovery service automatically detects and re-triggers orphaned issues, making the system self-healing.

### Schedule

- Runs **every 60 minutes** via `setInterval`
- Runs **once on startup** after 30-second delay

### Detection Logic

```typescript
async recoverOrphanedIssues() {
  // 1. Fetch all open issues assigned to cuemarshal-bot
  const assignedIssues = await giteaClient.listIssues(org, repo, {
    state: "open",
    limit: 100
  });
  
  // 2. Filter to bot-assigned issues
  const botAssigned = assignedIssues.filter(i => 
    i.assignees?.some(a => a.login === "cuemarshal-bot")
  );
  
  // 3. Check each for task record
  for (const issue of botAssigned) {
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.giteaIssueId, issue.number)
    });
    
    if (!task) {
      // Orphaned - no task record, re-trigger
      await agentRouter.routeTask({ owner, repo, issueNumber, ... });
    } else if (task.status === "failed") {
      // Failed - retry
      await agentRouter.routeTask({ owner, repo, issueNumber, ... });
    }
  }
}
```

### Scenarios Handled

| Scenario | Cause | Recovery Action |
|----------|-------|-----------------|
| Orphaned issue | Created before DB migration | Re-trigger workflow |
| Orphaned issue | Conductor crashed during processing | Re-trigger workflow |
| Failed task | Rate limit exhausted during execution | Retry task |
| Failed task | Workflow error | Retry task |

### Validated

**2026-02-01**: Recovered 10 orphaned issues (#1-#10) that were created before database migrations were implemented. All re-triggered successfully and are now in progress.

**Logs**:

```json
{"level":30,"msg":"Orphaned issue detected - re-triggering","issue":10,"title":"Implement proper cost recording"}
{"level":30,"msg":"Orphaned issue re-triggered","issue":10}
```

## Database Schema

The Conductor uses PostgreSQL via Drizzle ORM for persistent state.

### Tables

**tasks** — Tracks task lifecycle state beyond what Gitea provides.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `gitea_issue_id` | `integer` | Gitea issue number |
| `gitea_repo` | `text` | Repository full name (owner/repo) |
| `parent_task_id` | `uuid` | Parent task reference (nullable) |
| `status` | `enum` | `pending`, `analyzing`, `in_progress`, `review`, `completed`, `failed` |
| `agent_role` | `text` | Assigned agent role |
| `model_tier` | `text` | Selected model tier |
| `branch_name` | `text` | Feature branch name |
| `pr_number` | `integer` | Associated PR number (nullable) |
| `retry_count` | `integer` | Number of retry attempts |
| `created_at` | `timestamp` | Creation timestamp |
| `updated_at` | `timestamp` | Last update timestamp |

**chat_sessions** — Stores mobile chat conversation history.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `user_id` | `text` | Gitea user ID |
| `created_at` | `timestamp` | Session start time |
| `updated_at` | `timestamp` | Last message time |

**chat_messages** — Individual messages in a chat session.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `session_id` | `uuid` | Foreign key to chat_sessions |
| `role` | `enum` | `user`, `assistant`, `tool` |
| `content` | `text` | Message content |
| `tool_calls` | `jsonb` | Tool calls (nullable) |
| `tool_call_id` | `text` | Tool call ID for tool results (nullable) |
| `created_at` | `timestamp` | Message timestamp |

**cost_records** — LLM cost tracking per task.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `task_id` | `uuid` | Foreign key to tasks (nullable) |
| `project` | `text` | Project/repo name |
| `model` | `text` | Model name used |
| `input_tokens` | `integer` | Input token count |
| `output_tokens` | `integer` | Output token count |
| `cost_usd` | `decimal` | Cost in USD |
| `created_at` | `timestamp` | Record timestamp |

## BullMQ Job Types

| Job Type | Queue | Description | Processor |
|----------|-------|-------------|-----------|
| `task:analyze` | `tasks` | Analyze new issue, decompose, route | `processTaskAnalyze` |
| `task:route-update` | `tasks` | Re-route task after label change | `processRouteUpdate` |
| `task:revision` | `tasks` | Re-dispatch developer after review rejection | `processTaskRevision` |
| `task:complete` | `tasks` | Close linked issues, update parent | `processTaskComplete` |
| `review:assign` | `reviews` | Assign reviewer agent to new PR | `processReviewAssign` |
| `pr:merge` | `reviews` | Merge approved PR | `processPRMerge` |
| `workflow:result` | `workflows` | Handle workflow completion/failure | `processWorkflowResult` |
| ~~`self-improve:scan`~~ | ~~`maintenance`~~ | Deprecated: now runs as Gitea workflow | N/A |
| ~~`self-improve:idle-check`~~ | ~~`maintenance`~~ | Deprecated: cron-based scheduling instead | N/A |

All jobs are configured with:

- 3 retry attempts with exponential backoff
- 30-minute timeout
- Dead letter queue for failed jobs

## Dockerfile

```dockerfile
FROM node:25-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:25-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

## Health Check

`GET /health` returns:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "services": {
    "database": "connected",
    "redis": "connected",
    "gitea": "reachable",
    "gateway": "reachable",
    "mcp_gitea": "connected",
    "mcp_conductor": "connected",
    "mcp_system": "connected"
  }
}
```
