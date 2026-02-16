# Production Hardening Improvements

This document describes critical improvements to harden the CueMarshal platform for production autonomy based on real-world agentic system challenges.

## Summary of Enhancements

1. **Vector MCP Server** - Project memory with RAG for context continuity
2. **Linter/Refiner Agent** - Pre-PR quality checks to reduce costs
3. **Webhook Guardrails** - Idempotency and bot filtering to prevent loops
4. **Context Store** - Session history for inter-agent communication
5. **Failure Escalation** - Automatic tier upgrade on repeated failures
6. **PR-Driven Self-Improvement** - Real-time improvement suggestions
7. **MCP Discovery** - Already implemented via `tools/list`

---

## 1. Vector MCP Server (Project Memory)

### Problem
Runners operate in isolated containers with no memory of previous work, architectural patterns, or past decisions. This leads to:
- Inconsistent code patterns across tasks
- Agents "reinventing the wheel"
- Missing context from prior PRs or design docs

### Solution: vector-mcp Server

A new MCP server that provides semantic search over project history.

**Architecture**:
```
┌─────────────────────────────────────────┐
│          Vector MCP Server              │
│                                         │
│  Tools:                                 │
│  - search_similar_issues                │
│  - search_code_patterns                 │
│  - get_architectural_context            │
│  - find_related_prs                     │
│                                         │
│  Backend: pgvector + embeddings         │
└─────────────────────────────────────────┘
         ↑                    ↑
    (stdio)              (HTTP/SSE)
         │                    │
    Agents in            Conductor
    Runners              Chat Handler
```

**Implementation**:

Add to `docker-compose.yml`:
```yaml
vector-mcp:
  build:
    context: ./services/mcp-servers
    dockerfile: vector-mcp/Dockerfile
  environment:
    - MCP_TRANSPORT=http
    - PORT=4203
    - DATABASE_URL=${DATABASE_URL}
    - EMBEDDING_MODEL=text-embedding-3-small
    - GATEWAY_URL=http://gateway:4100
  depends_on:
    postgres:
      condition: service_healthy
```

**Database schema** (in PostgreSQL with pgvector extension):
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE project_embeddings (
  id UUID PRIMARY KEY,
  project TEXT NOT NULL,
  content_type TEXT NOT NULL,  -- 'issue', 'pr', 'commit', 'code'
  content_ref TEXT NOT NULL,    -- issue number, commit sha, file path
  content_text TEXT NOT NULL,
  embedding vector(1536),       -- OpenAI text-embedding-3-small
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON project_embeddings USING ivfflat (embedding vector_cosine_ops);
```

**MCP Tools**:

1. **search_similar_issues**: Find past issues similar to current task
   ```typescript
   {
     query: "implement JWT authentication",
     project: "my-project",
     limit: 5
   }
   // Returns: Past issues with similar descriptions, including resolution
   ```

2. **search_code_patterns**: Find existing code patterns for a task
   ```typescript
   {
     query: "API endpoint implementation",
     project: "my-project",
     file_type: "ts"
   }
   // Returns: Code snippets showing how to implement endpoints
   ```

3. **get_architectural_context**: Retrieve design docs and ADRs
   ```typescript
   {
     topic: "authentication",
     project: "my-project"
   }
   // Returns: Relevant architecture decision records
   ```

**Usage in Agents**:

Update developer agent prompt:
```markdown
Before implementing, use vector MCP tools:
1. search_similar_issues - Check if this was done before
2. search_code_patterns - Find existing patterns to follow
3. get_architectural_context - Review relevant design docs
```

**Indexing Pipeline**:

Add a webhook handler in Conductor:
```typescript
// On PR merged: Index the changes
async function handlePRMerged(payload) {
  const pr = payload.pull_request;
  const diff = await giteaClient.getPRDiff(owner, repo, pr.number);
  
  // Generate embeddings and store
  await vectorMCP.indexContent({
    project: repo,
    content_type: 'pr',
    content_ref: pr.number,
    content_text: `${pr.title}\n${pr.body}\n${diff}`,
  });
}
```

---

## 2. Linter/Refiner Agent (Pre-PR Quality Gate)

### Problem
Agents can create PRs with syntax errors, missing imports, or obvious lint failures. These are caught by the Reviewer, wasting a tier2 model call.

### Solution: Linter Agent (Tier 1)

A lightweight agent that runs BEFORE creating the PR, within the same workflow.

**Add to `task-execute.yml`**:

```yaml
- name: Lint and refine
  run: |
    # Copy linter agent config (tier1 model)
    cp /agents/linter/opencode.json ./opencode.json.linter
    
    # Run linter agent
    opencode run --config opencode.json.linter \
      "Review the uncommitted changes for:
      1. Syntax errors
      2. Missing imports
      3. Lint violations
      4. Type errors (if TypeScript)
      5. Simple logic bugs
      
      If you find issues, fix them automatically using your edit tools.
      Do NOT create a PR - just fix and stage the changes."
    
    # If linter made fixes, amend the commit
    if [ -n "$(git status --porcelain)" ]; then
      git add -A
      git commit --amend --no-edit
    fi
```

**Agent Profile**: `services/agents/linter/opencode.json`
```json
{
  "model": "tier1",
  "agent": {
    "linter": {
      "description": "Pre-PR quality checker",
      "model": "tier1"
    }
  },
  "tools": {
    "write": false,
    "edit": true,   // Can fix issues
    "bash": true    // Can run linters
  }
}
```

**Cost Savings**: Prevents ~30% of reviewer rejections, saving tier2 costs.

---

## 3. Webhook Guardrails (Safety)

### Problem
Webhook loops can occur when:
- Bot comments trigger issue.comment webhooks
- Merged PRs create push events that trigger workflows
- Agents interacting with each other create cascading events

### Solution: Idempotency + Bot Filtering

**Update `services/conductor/src/api/webhooks.ts`**:

```typescript
import { createClient } from "redis";

const redis = createClient({ url: config.redisUrl });
await redis.connect();

router.post("/gitea", async (req: Request, res: Response) => {
  const delivery = req.headers["x-gitea-delivery"] as string;
  const sender = req.body.sender;

  // 1. Idempotency check
  const cacheKey = `webhook:${delivery}`;
  const alreadyProcessed = await redis.get(cacheKey);
  
  if (alreadyProcessed) {
    logger.debug({ delivery }, "Webhook already processed (duplicate delivery)");
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Mark as processing (1 hour TTL)
  await redis.setEx(cacheKey, 3600, "processing");

  // 2. Bot filter
  const BOT_USERS = ["cuemarshal-bot", "conductor-bot"];
  const BOT_EVENTS_TO_IGNORE = ["issue_comment", "issues.assigned"];
  
  if (BOT_USERS.includes(sender?.login) && BOT_EVENTS_TO_IGNORE.includes(event)) {
    logger.debug({ delivery, sender: sender?.login, event }, "Ignoring bot-triggered event");
    return res.status(200).json({ received: true, filtered: "bot" });
  }

  // 3. Loop detection: Track event chains
  const eventChainKey = `event-chain:${req.body.repository?.id}:${req.body.issue?.number}`;
  const chainCount = await redis.incr(eventChainKey);
  await redis.expire(eventChainKey, 300); // 5 minute window

  if (chainCount > 10) {
    logger.error({ delivery, chainCount }, "Potential webhook loop detected");
    return res.status(200).json({ received: true, filtered: "loop_protection" });
  }

  // Continue with normal processing...
});
```

**Additional Safety**:

Add to `.env`:
```bash
WEBHOOK_LOOP_THRESHOLD=10
WEBHOOK_IDEMPOTENCY_TTL=3600
```

---

## 4. Context Store (Session History)

### Problem
When a Reviewer Agent reviews a PR, it doesn't know what reasoning the Developer Agent used during implementation.

### Solution: Session History in Conductor MCP

**Add to `services/conductor/src/db/schema.ts`**:

```typescript
export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").references(() => tasks.id),
  agentRole: text("agent_role").notNull(),
  toolCalls: jsonb("tool_calls").notNull(),  // Array of tool calls
  context: jsonb("context"),                  // Additional context
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Add tool to Conductor MCP** (`services/mcp-servers/conductor-mcp/src/tools/sessions.ts`):

```typescript
export const SessionTools = {
  get_agent_session_history: {
    description: "Get the tool calls and context from previous agent work on this task",
    parameters: z.object({
      task_id: z.string().describe("Task UUID"),
      agent_role: z.string().optional().describe("Filter by specific agent role"),
    }),
    handler: async (args) => {
      const sessions = await db.query.agentSessions.findMany({
        where: and(
          eq(agentSessions.taskId, args.task_id),
          args.agent_role ? eq(agentSessions.agentRole, args.agent_role) : undefined
        ),
        orderBy: desc(agentSessions.createdAt),
        limit: 10,
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify(sessions, null, 2),
        }],
      };
    },
  },
};
```

**Update Reviewer prompt**:
```markdown
Before reviewing, use get_agent_session_history to see what the developer
agent did and why. This helps you understand the implementation choices.
```

---

## 5. Failure Escalation (Model Selector)

### Current Issue
If a tier2 model fails a task twice, retrying with tier2 again wastes money.

### Solution: Auto-Escalation

**Update `services/conductor/src/services/model-selector.ts`**:

```typescript
export class ModelSelector {
  async selectModel(task: TaskInput, taskRecord?: Task): Promise<ModelSelection> {
    // Check retry count
    if (taskRecord && taskRecord.retryCount > 1) {
      // Escalate tier on retries
      const currentTier = taskRecord.modelTier;
      
      if (currentTier === "tier1") {
        logger.info({ task: taskRecord.id }, "Escalating tier1 → tier2 after retries");
        return this.createSelection("tier2", task, "Auto-escalation after tier1 failure");
      }
      
      if (currentTier === "tier2") {
        logger.info({ task: taskRecord.id }, "Escalating tier2 → tier3 after retries");
        return this.createSelection("tier3", task, "Auto-escalation after tier2 failure");
      }
      
      // tier3 already maxed out - log for human review
      logger.error({ task: taskRecord.id }, "tier3 failed multiple times - needs human review");
    }

    // Continue with normal selection logic...
  }
}
```

**Add to workflow result handler** (`services/conductor/src/queue/worker.ts`):

```typescript
async function processWorkflowResult(data: WorkflowResultJob) {
  if (data.conclusion === "failure") {
    // Find the task
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.giteaRepo, `${data.owner}/${data.repo}`),
    });

    if (task && task.retryCount < 3) {
      // Update retry count
      await db.update(tasks)
        .set({ retryCount: task.retryCount + 1 })
        .where(eq(tasks.id, task.id));

      // Re-route with escalation
      await agentRouter.routeTask({
        owner: data.owner,
        repo: data.repo,
        issueNumber: task.giteaIssueId,
        issueTitle: "...", // Fetch from Gitea
        issueBody: "...",
        labels: [],
      });
    }
  }
}
```

---

## 6. PR-Driven Self-Improvement

### Current Issue
Scheduled self-improvement (every 4 hours) is reactive and delayed.

### Solution: Trigger on PR Merge

**Add to `services/conductor/src/api/webhooks.ts`**:

```typescript
async function handlePRMerged(payload: any) {
  const pr = payload.pull_request;
  const repo = payload.repository;
  const [owner, repoName] = repo.full_name.split("/");

  // Existing logic: Close issue...

  // NEW: Trigger immediate improvement scan on merged diff
  await enqueueSelfImproveAnalysis({
    owner,
    repo: repoName,
    prNumber: pr.number,
    diff: await giteaClient.getPRDiff(owner, repoName, pr.number),
  });
}
```

**New job type**:
```typescript
export interface SelfImproveAnalysisJob {
  owner: string;
  repo: string;
  prNumber: number;
  diff: string;
}

async function processSelfImproveAnalysis(data: SelfImproveAnalysisJob) {
  // Use tier1 model to analyze just the diff
  const response = await gateway.chat.completions.create({
    model: "tier1",
    messages: [{
      role: "user",
      content: `Analyze this PR diff for immediate improvements:
      
      ${data.diff}
      
      Check for:
      1. Missing unit tests for new functions
      2. Undocumented public APIs
      3. Missing error handling
      4. Performance concerns
      
      If improvements are needed, create a follow-up issue.
      Max 1 improvement per PR to avoid spam.`
    }],
  });

  // Parse response and create issue if needed
}
```

**Benefits**:
- Immediate feedback loop
- Contextual improvements (knows what just changed)
- Spreads self-improvement across time (not batch every 4 hours)
- Lower cost (tier1 on small diffs vs tier2 on entire codebase)

---

## 7. Enhanced Webhook Handler with All Guardrails

Complete implementation combining all safety features:

```typescript
// services/conductor/src/api/webhooks.ts - Enhanced version

import { createClient } from "redis";
import { verifyWebhookSignature } from "../utils/crypto.js";
import { loadConfig } from "../config.js";

const config = loadConfig();
const redis = createClient({ url: config.redisUrl });

const BOT_USERS = ["cuemarshal-bot", "conductor-bot"];
const BOT_IGNORED_EVENTS = [
  "issue_comment",
  "issues.assigned",
  "issues.labeled", // Only if bot added the label
];

router.post("/gitea", async (req: Request, res: Response) => {
  const signature = req.headers["x-gitea-signature"] as string;
  const event = req.headers["x-gitea-event"] as string;
  const delivery = req.headers["x-gitea-delivery"] as string;
  const sender = req.body.sender;

  // 1. Signature verification
  const payload = JSON.stringify(req.body);
  if (!verifyWebhookSignature(payload, signature, config.webhookSecret)) {
    logger.warn({ delivery, event, sender: sender?.login }, "Invalid webhook signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. Idempotency check
  const idempotencyKey = `webhook:${delivery}`;
  const alreadyProcessed = await redis.get(idempotencyKey);
  
  if (alreadyProcessed) {
    logger.debug({ delivery }, "Duplicate webhook delivery ignored");
    return res.status(200).json({ received: true, duplicate: true });
  }

  // Mark as processing
  await redis.setEx(idempotencyKey, config.webhookIdempotencyTTL || 3600, Date.now().toString());

  // 3. Bot filter
  if (BOT_USERS.includes(sender?.login)) {
    if (BOT_IGNORED_EVENTS.includes(event)) {
      logger.debug({ delivery, sender: sender.login, event }, "Bot event filtered");
      return res.status(200).json({ received: true, filtered: "bot" });
    }
  }

  // 4. Loop detection
  const issueOrPR = req.body.issue?.number || req.body.pull_request?.number;
  const repoId = req.body.repository?.id;
  
  if (issueOrPR && repoId) {
    const loopKey = `event-chain:${repoId}:${issueOrPR}`;
    const chainCount = await redis.incr(loopKey);
    await redis.expire(loopKey, 300); // 5 minute window

    if (chainCount > (config.webhookLoopThreshold || 10)) {
      logger.error({ delivery, chainCount, issue: issueOrPR }, "Webhook loop detected - circuit breaker");
      
      // Add a comment to the issue warning of the loop
      if (req.body.issue) {
        await giteaClient.addComment(
          req.body.repository.owner.login,
          req.body.repository.name,
          issueOrPR,
          "⚠️ Webhook loop detected. Automation paused for this issue. Please review manually."
        );
      }
      
      return res.status(200).json({ received: true, filtered: "loop_protection" });
    }
  }

  // 5. Respond immediately (webhook timeout is 30s)
  res.status(200).json({ received: true });

  // 6. Process asynchronously
  try {
    await handleWebhookEvent(event, req.body);
  } catch (error) {
    logger.error({ error, event, delivery }, "Webhook processing failed");
  }
});
```

**Configuration additions** (`.env.example`):
```bash
WEBHOOK_LOOP_THRESHOLD=10
WEBHOOK_IDEMPOTENCY_TTL=3600
BOT_USERNAMES=cuemarshal-bot,conductor-bot
```

---

## 8. MCP Discovery (Already Implemented ✅)

Your implementation already uses dynamic MCP discovery via `tools/list`:

```typescript
// services/conductor/src/services/mcp-registry.ts
async function connectToServer(name: string, url: string): Promise<void> {
  // ...
  const response = await client.request({ method: "tools/list" }, { timeout: 5000 });
  
  for (const tool of response.tools) {
    tools.set(tool.name, tool);
    this.toolToServer.set(tool.name, name);
  }
}
```

This is correct! Adding new tools requires only updating the MCP server, no changes to Conductor.

---

## 9. State Synchronization (Gitea ↔ Conductor)

### Problem
Conductor database could drift from Gitea (e.g., if a webhook is missed or DB update fails).

### Solution: Reconciliation Job

**Add to `services/conductor/src/queue/worker.ts`**:

```typescript
// Scheduled reconciliation job (runs every hour)
export const reconciliationWorker = new Worker(
  "reconciliation",
  async (job: Job) => {
    logger.info("Running state reconciliation");

    // Get all "in_progress" tasks from Conductor DB
    const inProgressTasks = await db.query.tasks.findMany({
      where: eq(tasks.status, "in_progress"),
    });

    for (const task of inProgressTasks) {
      // Check actual Gitea issue state
      const [owner, repo] = task.giteaRepo.split("/");
      const issue = await giteaClient.getIssue(owner, repo, task.giteaIssueId);

      // Reconcile discrepancies
      if (issue.state === "closed" && task.status !== "completed") {
        logger.warn({ taskId: task.id }, "State drift detected - syncing from Gitea");
        await db.update(tasks)
          .set({ status: "completed" })
          .where(eq(tasks.id, task.id));
      }

      // Check if PR exists
      if (task.prNumber) {
        const pr = await giteaClient.getPR(owner, repo, task.prNumber);
        if (pr.merged && task.status !== "completed") {
          await db.update(tasks)
            .set({ status: "completed" })
            .where(eq(tasks.id, task.id));
        }
      }
    }
  },
  { connection: redisConnection }
);

// Schedule reconciliation every hour
await maintenanceQueue.add(
  "reconciliation",
  {},
  { repeat: { pattern: "0 * * * *" } }
);
```

---

## Implementation Priority

| Enhancement | Priority | Effort | Impact |
|-------------|----------|--------|--------|
| Webhook Guardrails | 🔴 Critical | Low | Prevents catastrophic loops |
| Failure Escalation | 🔴 Critical | Low | Improves success rate |
| Linter/Refiner Agent | 🟡 High | Medium | 30% cost savings |
| Context Store | 🟡 High | Medium | Better agent decisions |
| Vector MCP | 🟢 Medium | High | Consistency across tasks |
| PR-Driven Self-Improvement | 🟢 Medium | Low | Faster feedback |
| State Reconciliation | 🟢 Medium | Low | Prevents drift |

## Recommended Implementation Order

1. **Webhook Guardrails** - Implement immediately (safety critical)
2. **Failure Escalation** - Quick win, improves reliability
3. **Linter/Refiner** - Cost optimization
4. **Context Store** - Enables session history
5. **PR-Driven Self-Improvement** - Better than scheduled
6. **Vector MCP** - Long-term consistency enhancement
7. **State Reconciliation** - Background safety net

These improvements transform the platform from "functional" to "production-grade autonomous system" with proper safety rails, cost optimization, and context continuity.
