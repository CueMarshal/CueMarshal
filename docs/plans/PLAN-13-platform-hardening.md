# PLAN-13: Platform Hardening & Experience Improvements

> Prioritized implementation plan for reliability, completeness, observability, security, developer experience, and code quality improvements across the CueMarshal platform.
>
> **Created**: 2026-02-22
> **Status**: Planned
> **Scope**: Cross-cutting — Conductor, MCP servers, workflows, infrastructure, mobile, gateway

---

## Prioritization Key

| Priority | Meaning | Target |
|----------|---------|--------|
| **P0** | Blocks reliability or has a known failure mode | Immediate |
| **P1** | Significant operational or pipeline gap | Next sprint |
| **P2** | Important for production readiness | Following sprint |
| **P3** | Quality-of-life and polish | Backlog |

---

## P0 — Critical Reliability

### P0-1: Fix MCP Server Docker Health Checks

**Problem**: All 5 MCP server Dockerfiles use `HEALTHCHECK CMD wget --spider http://localhost/health`, but `node:25-alpine` does not ship `wget`. Health checks silently fail, so Docker Compose reports containers as healthy when they may not be.

**Impact**: False-healthy status propagates up the dependency chain — the Conductor starts before MCP servers are truly ready.

**Files to modify**:

- `services/mcp-servers/gitea-mcp/Dockerfile`
- `services/mcp-servers/conductor-mcp/Dockerfile`
- `services/mcp-servers/system-mcp/Dockerfile`
- `services/mcp-servers/vector-mcp/Dockerfile`
- `services/mcp-servers/sonar-mcp/Dockerfile`

**Implementation**:
Replace in all 5 Dockerfiles:

```dockerfile
# Before
HEALTHCHECK CMD wget --spider http://localhost/health || exit 1

# After
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"
```

**Verification**: `docker compose ps` should show all MCP servers as `healthy` only when actually responding on `/health`.

**Effort**: Small (30 min)

---

### P0-2: Implement Test Dispatch (Complete SDLC Pipeline)

**Problem**: `dispatchTests` in `workflow-trigger.ts` is implemented (after the workflow_dispatch migration) but never called from any workflow or queue worker. The `run-tests.yml` workflow exists but is never triggered in the automated pipeline. This means PRs are merged without automated testing.

**Impact**: The SDLC pipeline is incomplete — implement → review → ~~test~~ → merge. The testing phase is skipped.

**Files to modify**:

- `workflows/code-review.yml` / `.gitea/workflows/code-review.yml` — add dispatch step
- `services/conductor/src/queue/worker.ts` — optionally trigger tests after review approval

**Implementation**:

**Option A — Chain from code-review workflow** (recommended):
Add a final step to `code-review.yml` that dispatches `run-tests.yml` after review submission:

```yaml
      - name: Trigger test execution
        if: success()
        run: |
          BRANCH="${{ github.ref_name }}"
          ISSUE_NUM="${{ inputs.issue_number }}"
          curl -sf -X POST \
            -H "Authorization: token ${GITEA_TOKEN}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/repos/${{ github.repository }}/actions/workflows/run-tests.yml/dispatches" \
            -d "{
              \"ref\": \"${BRANCH}\",
              \"inputs\": {
                \"issue_number\": \"${ISSUE_NUM}\",
                \"model_tier\": \"tier1\",
                \"write_tests\": \"false\"
              }
            }"
          echo "Test execution dispatched via workflow_dispatch"
```

**Option B — Conductor dispatches after review webhook**:
In `worker.ts`, after processing a PR review approval event, call `workflowTrigger.dispatchTests(...)`.

**Verification**: After a code review completes, `run-tests.yml` should automatically run on the feature branch.

**Effort**: Small (1 hour)

---

### P0-3: WebSocket Token Validation

**Problem**: `services/conductor/src/websocket/server.ts` has a TODO placeholder for token validation. The WebSocket endpoint is accessible to anyone on the network without authentication.

**Impact**: All real-time events (task updates, agent status) are exposed to unauthorized clients.

**Files to modify**:

- `services/conductor/src/websocket/server.ts`

**Implementation**:

```typescript
import { loadConfig } from "../config.js";

function authenticateConnection(req: IncomingMessage): boolean {
  const config = loadConfig();
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const token = url.searchParams.get("token")
    || req.headers.authorization?.replace("Bearer ", "");
  return token === config.conductorSecret;
}
```

Apply in the WebSocket `connection` handler — reject with 401 if authentication fails.

**Verification**: WebSocket connections without a valid token are rejected. Connections with `?token=<CONDUCTOR_SECRET>` or `Authorization: Bearer <CONDUCTOR_SECRET>` succeed.

**Effort**: Small (1 hour)

---

## P1 — Operational Gaps

### P1-1: Runner Health Checks

**Problem**: Both runners have no health check. If a runner hangs or its gateway proxy (port 4101) crashes, it stays in the pool accepting jobs it can't complete.

**Impact**: Jobs dispatched to an unhealthy runner fail silently after timeout.

**Files to modify**:

- `services/runner/entrypoint.sh` — add a lightweight health check endpoint
- `docker-compose.yml` — add `healthcheck` to runner services

**Implementation**:

Add a health check script to the runner image that verifies:

1. `act_runner` process is running
2. Gateway proxy on port 4101 is responding
3. Runner can reach the Gitea API

```bash
#!/bin/sh
# /healthcheck.sh
pgrep -x act_runner > /dev/null || exit 1
curl -sf --max-time 2 http://127.0.0.1:4101/health > /dev/null 2>&1 || exit 1
exit 0
```

In `docker-compose.yml`:

```yaml
runner-1:
  healthcheck:
    test: ["CMD", "/healthcheck.sh"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 60s
```

**Effort**: Small (1 hour)

---

### P1-2: Gateway Proxy Process Supervision

**Problem**: The gateway auth proxy runs as a backgrounded `node` process in the runner entrypoint (`node /gateway-proxy.js &`). If it crashes, there is no restart mechanism. All LLM calls from that runner fail silently.

**Impact**: A single proxy crash renders the runner unable to make LLM calls for the remainder of its lifetime.

**Related**: MEMORY.md bug 3.5 (PARTIALLY RESOLVED)

**Files to modify**:

- `services/runner/Dockerfile` — install `s6-overlay`
- `services/runner/entrypoint.sh` — restructure as s6 service tree
- New: `services/runner/s6/gateway-proxy/run` — proxy service definition
- New: `services/runner/s6/act-runner/run` — runner service definition

**Implementation**:

Install `s6-overlay` in the runner Dockerfile:

```dockerfile
ADD https://github.com/just-containers/s6-overlay/releases/download/v3.2.0.2/s6-overlay-noarch.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz
ENTRYPOINT ["/init"]
```

Create service definitions:

```bash
# s6/gateway-proxy/run
#!/bin/sh
exec node /gateway-proxy.js

# s6/act-runner/run
#!/bin/sh
exec act_runner daemon --config /config.yaml
```

s6 automatically restarts crashed services and handles signal forwarding.

**Effort**: Medium (3-4 hours)

---

### P1-3: Prometheus Metrics for Conductor

**Problem**: The Conductor has a `/metrics` endpoint stub but doesn't expose meaningful Prometheus metrics. As the orchestration nerve center, its runtime behavior is opaque.

**Impact**: No visibility into task throughput, queue depth, LLM costs, or failure rates without manual log inspection.

**Files to modify**:

- `services/conductor/package.json` — add `prom-client`
- New: `services/conductor/src/utils/metrics.ts` — metric definitions
- `services/conductor/src/api/internal.ts` — wire `/metrics` endpoint
- `services/conductor/src/queue/worker.ts` — instrument job processing
- `services/conductor/src/api/webhooks.ts` — instrument webhook handling
- `monitoring/prometheus/prometheus.yml` — add conductor scrape target

**Implementation**:

Define metrics:

```typescript
import { Counter, Histogram, Gauge, Registry } from "prom-client";

export const registry = new Registry();

export const tasksTotal = new Counter({
  name: "cuemarshal_tasks_total",
  help: "Total tasks processed",
  labelNames: ["status", "agent_role", "model_tier"],
  registers: [registry],
});

export const webhookEventsTotal = new Counter({
  name: "cuemarshal_webhook_events_total",
  help: "Total webhook events received",
  labelNames: ["event_type", "action"],
  registers: [registry],
});

export const llmRequestDuration = new Histogram({
  name: "cuemarshal_llm_request_duration_seconds",
  help: "LLM request duration",
  labelNames: ["tier", "provider", "status"],
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const llmCostUsd = new Counter({
  name: "cuemarshal_llm_cost_usd_total",
  help: "Cumulative LLM cost in USD",
  labelNames: ["agent_role", "project"],
  registers: [registry],
});

export const queueDepth = new Gauge({
  name: "cuemarshal_queue_depth",
  help: "Current queue depth",
  labelNames: ["queue"],
  registers: [registry],
});

export const selfImproveCycles = new Counter({
  name: "cuemarshal_self_improve_cycles_total",
  help: "Self-improvement cycle outcomes",
  labelNames: ["outcome"],
  registers: [registry],
});
```

Serve at `/metrics`:

```typescript
app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
});
```

Add to `monitoring/prometheus/prometheus.yml`:

```yaml
- job_name: "conductor"
  static_configs:
    - targets: ["conductor:80"]
  metrics_path: /metrics
```

**Effort**: Medium (4-5 hours)

---

### P1-4: Graceful Shutdown for Conductor

**Problem**: The Conductor creates Redis connections, BullMQ workers, WebSocket servers, and database pools but has no coordinated shutdown. On restart, in-flight jobs may be lost and connections leaked.

**Impact**: `docker compose restart conductor` can cause orphaned jobs, stale WebSocket connections, and Redis connection exhaustion.

**Files to modify**:

- `services/conductor/src/index.ts` — add shutdown handler

**Implementation**:

```typescript
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown initiated");

  // 1. Stop accepting new webhooks
  server.close();

  // 2. Close BullMQ workers (waits for in-flight jobs, 30s timeout)
  await Promise.allSettled([
    tasksWorker.close(),
    reviewsWorker.close(),
    workflowsWorker.close(),
  ]);

  // 3. Close WebSocket connections
  wss.clients.forEach((ws) => ws.close(1001, "Server shutting down"));

  // 4. Close MCP registry connections
  await mcpRegistry.disconnectAll();

  // 5. Close Redis
  await redisClient.quit();

  // 6. Close database pool
  await db.$client.end();

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

**Verification**: `docker compose restart conductor` completes without `SIGKILL`, and no orphaned jobs remain in BullMQ.

**Effort**: Medium (2-3 hours)

---

### P1-5: Webhook Handler Test Coverage

**Problem**: The webhook handler (`webhooks.ts`) is the entry point for all platform automation — every issue, PR, and review event flows through it. It has zero tests.

**Impact**: Regressions in webhook processing silently break the entire pipeline.

**Files to modify**:

- New: `services/conductor/src/__tests__/api/webhooks.test.ts`

**Implementation**:

Test cases to cover:

1. **Signature verification**: Valid signature → 200, invalid → 401, missing → 401
2. **Idempotency**: Same event ID processed twice → second is skipped
3. **Bot filtering**: Events from `cuemarshal-bot` and `agent-*` users are ignored
4. **Loop detection**: Rapid consecutive events trigger circuit breaker
5. **Issue opened**: Creates `task:analyze` job with correct data
6. **Issue labeled**: Routes task when role label is added
7. **PR opened**: Creates `review:assign` job with `branchName` from `head.ref`
8. **PR review approved**: Creates `pr:merge` job
9. **Unknown event**: Returns 200 (accepted but ignored)

Mock external dependencies:

```typescript
jest.mock("../../queue/jobs.js");
jest.mock("../../services/gitea-client.js");
jest.mock("../../db/client.js");
```

**Effort**: Medium (4-5 hours)

---

### P1-6: MCP Server Connection Retry

**Problem**: The Conductor's `mcp-registry.ts` connects to 5 MCP servers at startup with no retry logic. If any MCP server is slow to start, the Conductor permanently loses access to that server's tools.

**Impact**: Transient startup timing issues permanently degrade platform capabilities.

**Files to modify**:

- `services/conductor/src/services/mcp-registry.ts`

**Implementation**:

Add exponential backoff retry:

```typescript
async connectWithRetry(
  name: string,
  url: string,
  maxAttempts = 5,
  baseDelayMs = 2000
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await this.connect(name, url);
      logger.info({ name, attempt }, "MCP server connected");
      return;
    } catch (error) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn({ name, attempt, maxAttempts, delay }, "MCP connection failed, retrying");
      if (attempt === maxAttempts) throw error;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

**Effort**: Small (1 hour)

---

## P2 — Production Readiness

### P2-1: Rate Limiting for Conductor API

**Problem**: No rate limiting on Conductor API endpoints. The Nginx config rate-limits webhooks (10 req/s) but `/api/chat`, `/api/internal`, and mobile endpoints are unprotected.

**Files to modify**:

- `services/conductor/package.json` — add `express-rate-limit`
- `services/conductor/src/api/routes.ts` — apply middleware

**Implementation**:

```typescript
import rateLimit from "express-rate-limit";

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 chat messages per minute per IP
  standardHeaders: true,
});

const internalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
});

app.use("/api/chat", chatLimiter);
app.use("/api/internal", internalLimiter);
```

**Effort**: Small (1 hour)

---

### P2-2: Alertmanager for Critical Failures

**Problem**: Prometheus collects metrics but has no alerting. Critical failures (all LLM providers down, database connection failures, budget exceeded) go unnoticed.

**Files to modify**:

- New: `monitoring/alertmanager/alertmanager.yml`
- New: `monitoring/prometheus/alert-rules.yml`
- `monitoring/prometheus/prometheus.yml` — add alertmanager config
- `docker-compose.yml` — add alertmanager service

**Implementation**:

Alert rules:

```yaml
groups:
  - name: cuemarshal
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "{{ $labels.job }} is down"

      - alert: BudgetThreshold
        expr: cuemarshal_llm_cost_usd_total > (cuemarshal_budget_limit * 0.8)
        labels: { severity: warning }

      - alert: HighQueueDepth
        expr: cuemarshal_queue_depth > 50
        for: 10m
        labels: { severity: warning }

      - alert: WorkflowFailureRate
        expr: rate(cuemarshal_tasks_total{status="failed"}[1h]) > 0.5
        labels: { severity: critical }
```

Alertmanager routes to stdout initially; optionally add webhook or email receiver.

**Effort**: Medium (3-4 hours)

---

### P2-3: PostgreSQL and Redis Exporters

**Problem**: Both are commented out in `monitoring/prometheus/prometheus.yml`. Without database metrics, you're blind to connection pool exhaustion, slow queries, and Redis memory pressure.

**Files to modify**:

- `docker-compose.yml` — add `postgres-exporter` and `redis-exporter` services
- `monitoring/prometheus/prometheus.yml` — uncomment scrape targets

**Implementation**:

```yaml
# docker-compose.yml
postgres-exporter:
  image: prometheuscommunity/postgres-exporter:v0.16.0
  environment:
    DATA_SOURCE_NAME: "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/cuemarshal?sslmode=disable"
  networks: [cuemarshal-network]

redis-exporter:
  image: oliver006/redis_exporter:v1.66.0
  environment:
    REDIS_ADDR: "redis://redis:6379"
    REDIS_PASSWORD: "${REDIS_PASSWORD}"
  networks: [cuemarshal-network]
```

**Effort**: Small (1-2 hours)

---

### P2-4: OpenAPI Specification for Conductor

**Problem**: The Conductor exposes ~25 API endpoints across public, webhook, chat, mobile, and internal routes. None are documented in a machine-readable format.

**Impact**: Mobile app development requires reading source code. External integrations are impossible without documentation.

**Files to modify**:

- `services/conductor/package.json` — add `swagger-jsdoc`, `swagger-ui-express`
- `services/conductor/src/api/routes.ts` — add spec and UI
- New: `services/conductor/src/api/openapi.ts` — OpenAPI definition

**Implementation**:

Define the spec programmatically with JSDoc annotations on each route, or create a standalone `openapi.yaml`. Serve the Swagger UI at `/api/docs` (protected by `validateBearerToken`).

Key endpoint groups to document:

- `GET /health` — Health check
- `POST /webhooks/gitea` — Webhook handler (signature verification)
- `POST /api/chat` — Send chat message
- `GET /api/chat/sessions` — List sessions
- `GET /api/dashboard` — Mobile dashboard
- `GET /api/projects` — List projects
- `POST /api/internal/costs` — Cost ingestion
- `GET /api/internal/self-improvement/check` — Readiness check
- `POST /api/internal/self-improvement/trigger` — Trigger self-improvement
- `POST /api/internal/projects/plan` — Generate project plan

**Effort**: Medium (4-5 hours)

---

### P2-5: Eliminate Hardcoded Values

**Problem**: Several values are hardcoded that should be configurable:

- `totalRunners = 2` in `worker.ts:114` and `self-improvement.ts:114`
- Cost-per-token rates in `model-selector.ts:318`
- Chat history limit of 20 messages in `chat-handler.ts:198`
- Label cache that never expires in `worker.ts:281`

**Files to modify**:

- `services/conductor/src/config.ts` — add new config fields
- `services/conductor/src/queue/worker.ts` — use config values
- `services/conductor/src/services/self-improvement.ts` — use config values
- `services/conductor/src/services/model-selector.ts` — use config values
- `services/conductor/src/services/chat-handler.ts` — use config values
- `.env.example` — document new variables

**Implementation**:

Add to Zod config schema:

```typescript
totalRunners: z.coerce.number().default(2),
chatHistoryLimit: z.coerce.number().default(20),
labelCacheTtlMs: z.coerce.number().default(300000), // 5 minutes
```

**Effort**: Small (2 hours)

---

### P2-6: Standardize MCP Server Error Handling

**Problem**: MCP tools have inconsistent error handling — some throw errors, others return `{ error: "..." }` objects. This makes error handling in the Conductor's MCP registry unpredictable.

**Files to modify**:

- `services/mcp-servers/sonar-mcp/src/tools/analysis.ts`
- `services/mcp-servers/sonar-mcp/src/tools/quality.ts`
- `services/mcp-servers/shared/src/transport.ts` — add error wrapper

**Implementation**:

Standardize all tools to throw errors. Add a shared error handler in the MCP server framework:

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = allTools[request.params.name];
  try {
    const args = tool.parameters.parse(request.params.arguments);
    return await tool.handler(args);
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: error.message }),
      }],
      isError: true,
    };
  }
});
```

**Effort**: Small (2 hours)

---

### P2-7: Request Validation Middleware

**Problem**: API endpoints accept unvalidated JSON bodies. Invalid payloads cause cryptic errors deep in service logic.

**Files to modify**:

- New: `services/conductor/src/middleware/validate.ts`
- `services/conductor/src/api/chat.ts` — apply validation
- `services/conductor/src/api/internal.ts` — apply validation
- `services/conductor/src/api/mobile.ts` — apply validation

**Implementation**:

```typescript
import { z, ZodSchema } from "zod";
import { Request, Response, NextFunction } from "express";

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten(),
      });
    }
    req.body = result.data;
    next();
  };
}
```

Define schemas for each endpoint (chat message, cost record, project plan request, etc.).

**Effort**: Medium (3-4 hours)

---

## P3 — Quality of Life & Polish

### P3-1: TLS Termination at Nginx

**Problem**: All traffic is HTTP. Credentials and API keys traverse the network in plaintext.

**Files to modify**:

- `infrastructure/nginx/nginx.conf` — add HTTPS server block
- `docker-compose.yml` — mount certificate volume, expose port 443
- `install.sh` — add TLS configuration option (self-signed or Let's Encrypt)

**Implementation**:

**Self-signed (default)**:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /certs/key.pem -out /certs/cert.pem \
  -subj "/CN=cuemarshal.local"
```

**Let's Encrypt (optional)**:
Add certbot sidecar container with DNS or HTTP-01 challenge.

**Effort**: Medium (3-4 hours)

---

### P3-2: Mobile Chat Streaming

**Problem**: Chat messages are sent/received as full blocks. The user waits for the entire LLM response before seeing anything.

**Impact**: Poor UX — the "AI is typing" state can last 10-30 seconds with no feedback.

**Files to modify**:

- `services/conductor/src/services/chat-handler.ts` — stream LLM responses
- `services/conductor/src/api/chat.ts` — SSE endpoint
- `mobile/stores/chat.ts` — consume SSE stream
- `mobile/app/(tabs)/chat.tsx` — render streaming tokens

**Implementation**:

Add SSE endpoint `GET /api/chat/stream?session_id=X`:

```typescript
res.writeHead(200, {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
});

for await (const chunk of llmStream) {
  res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
}
res.write("data: [DONE]\n\n");
res.end();
```

**Effort**: Large (6-8 hours)

---

### P3-3: Distributed Tracing with Correlation IDs

**Problem**: Correlation IDs exist for self-improvement runs but not for the standard task pipeline. Debugging failures requires manually correlating logs across 6+ systems (Gitea → Webhook → Conductor → BullMQ → Runner → MCP → Gitea).

**Files to modify**:

- `services/conductor/src/api/webhooks.ts` — generate traceId at ingestion
- `services/conductor/src/queue/jobs.ts` — add traceId to all job interfaces
- `services/conductor/src/queue/worker.ts` — propagate traceId
- `services/conductor/src/services/workflow-trigger.ts` — pass traceId as input
- All workflow YAML files — include traceId in logs

**Implementation**:

Generate at webhook ingestion:

```typescript
const traceId = `t-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
logger.info({ traceId, event: payload.action }, "Webhook received");
```

Propagate through all queue jobs and workflow dispatch inputs. Log with structured logger using `traceId` field consistently.

**Effort**: Large (6-8 hours)

---

### P3-4: Automated Backup Strategy

**Problem**: 13 named Docker volumes hold all platform state (PostgreSQL, Gitea, Redis, Grafana, SonarQube) with no backup mechanism.

**Files to modify**:

- New: `scripts/backup.sh` — backup script
- New: `scripts/restore.sh` — restore script
- `docker-compose.yml` — optional backup sidecar

**Implementation**:

```bash
#!/bin/bash
# scripts/backup.sh
BACKUP_DIR="${BACKUP_DIR:-./backups/$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$BACKUP_DIR"

# PostgreSQL logical backup (all databases)
docker exec cuemarshal-postgres pg_dumpall -U "$POSTGRES_USER" | \
  gzip > "$BACKUP_DIR/postgres.sql.gz"

# Gitea data (repositories, avatars, attachments)
docker exec cuemarshal-gitea gitea dump -c /data/gitea/conf/app.ini \
  --file /tmp/gitea-dump.zip
docker cp cuemarshal-gitea:/tmp/gitea-dump.zip "$BACKUP_DIR/"

# Redis RDB snapshot
docker exec cuemarshal-redis redis-cli -a "$REDIS_PASSWORD" BGSAVE
sleep 5
docker cp cuemarshal-redis:/data/dump.rdb "$BACKUP_DIR/"

echo "Backup complete: $BACKUP_DIR"
```

Add to `install.sh` as optional cron setup:

```bash
echo "0 2 * * * cd /path/to/cuemarshal && ./scripts/backup.sh" | crontab -
```

**Effort**: Medium (3-4 hours)

---

### P3-5: Consolidate Root-Level Documentation Files

**Problem**: Several debugging session artifacts clutter the repo root:

- `GEMINI_API_KEY_FIX_SUMMARY.md`
- `RESOLUTION_COMPLETE.md`
- `API_KEY_FIXES_COMPLETE.md`
- `GATEWAY_FALLBACK_VERIFICATION.md`
- `FALLBACK_FIX_COMPLETE.md`

**Implementation**:

```bash
mkdir -p docs/postmortem
git mv GEMINI_API_KEY_FIX_SUMMARY.md docs/postmortem/
git mv RESOLUTION_COMPLETE.md docs/postmortem/
git mv API_KEY_FIXES_COMPLETE.md docs/postmortem/
git mv GATEWAY_FALLBACK_VERIFICATION.md docs/postmortem/
git mv FALLBACK_FIX_COMPLETE.md docs/postmortem/
```

Update any cross-references in MEMORY.md to point to new paths.

**Effort**: Small (30 min)

---

### P3-6: Installation Wizard Improvements

**Problem**: `install.sh` works but could be more robust.

**Files to modify**:

- `install.sh`

**Implementation**:

1. **API key format validation at input time**: Use the known patterns from MEMORY.md 2.36 (Gemini starts with `AIzaSy`, Groq starts with `gsk_`, etc.) to catch OCR/transcription errors immediately.
2. **`--check` mode**: Validate an existing `.env` without overwriting: `./install.sh --check`
3. **Post-install health check**: After `docker compose up`, poll all service health endpoints and report aggregate status with a progress indicator.
4. **Colorize output**: Use ANSI color codes for success/warning/error messages.

**Effort**: Medium (3-4 hours)

---

### P3-7: Dashboard Query Performance

**Problem**: The mobile dashboard endpoint loads all task records to count by status. As the tasks table grows, this becomes a full table scan.

**Files to modify**:

- `services/conductor/src/api/mobile.ts`

**Implementation**:

Replace:

```typescript
const allTasks = await db.select().from(tasks);
const counts = { pending: 0, in_progress: 0, ... };
allTasks.forEach(t => counts[t.status]++);
```

With:

```typescript
const counts = await db
  .select({ status: tasks.status, count: sql<number>`count(*)` })
  .from(tasks)
  .groupBy(tasks.status);
```

**Effort**: Small (30 min)

---

### P3-8: Label Cache Expiry

**Problem**: The label name-to-ID cache in `worker.ts` never expires. On long-running instances, renamed or deleted labels persist in memory.

**Files to modify**:

- `services/conductor/src/queue/worker.ts`

**Implementation**:

Add a TTL wrapper:

```typescript
const LABEL_CACHE_TTL = config.labelCacheTtlMs; // default 5 min
let labelCache: Map<string, number> = new Map();
let labelCacheTime = 0;

function getLabelCache(): Map<string, number> | null {
  if (Date.now() - labelCacheTime > LABEL_CACHE_TTL) {
    labelCache = new Map();
    labelCacheTime = 0;
    return null;
  }
  return labelCache;
}
```

**Effort**: Small (30 min)

---

## Implementation Order

```
Phase 1 (P0 — Immediate)
  ├── P0-1: Fix MCP health checks               [30 min]
  ├── P0-2: Implement test dispatch              [1 hour]
  └── P0-3: WebSocket token validation           [1 hour]
                                        Subtotal: ~2.5 hours

Phase 2 (P1 — Next Sprint)
  ├── P1-1: Runner health checks                 [1 hour]
  ├── P1-2: Gateway proxy supervision            [3-4 hours]
  ├── P1-3: Prometheus metrics                   [4-5 hours]
  ├── P1-4: Graceful shutdown                    [2-3 hours]
  ├── P1-5: Webhook handler tests                [4-5 hours]
  └── P1-6: MCP connection retry                 [1 hour]
                                        Subtotal: ~16-19 hours

Phase 3 (P2 — Following Sprint)
  ├── P2-1: Rate limiting                        [1 hour]
  ├── P2-2: Alertmanager                         [3-4 hours]
  ├── P2-3: Database exporters                   [1-2 hours]
  ├── P2-4: OpenAPI spec                         [4-5 hours]
  ├── P2-5: Eliminate hardcoded values            [2 hours]
  ├── P2-6: Standardize MCP error handling       [2 hours]
  └── P2-7: Request validation middleware        [3-4 hours]
                                        Subtotal: ~16-22 hours

Phase 4 (P3 — Backlog)
  ├── P3-1: TLS termination                      [3-4 hours]
  ├── P3-2: Mobile chat streaming                [6-8 hours]
  ├── P3-3: Distributed tracing                  [6-8 hours]
  ├── P3-4: Backup strategy                      [3-4 hours]
  ├── P3-5: Consolidate docs                     [30 min]
  ├── P3-6: Install wizard improvements          [3-4 hours]
  ├── P3-7: Dashboard query performance          [30 min]
  └── P3-8: Label cache expiry                   [30 min]
                                        Subtotal: ~23-30 hours

Total estimated effort: ~58-74 hours
```

---

## Dependencies

```
P0-1 (health checks) ── no deps, can be done first
P0-2 (test dispatch) ── requires workflow_dispatch migration (DONE)
P0-3 (WS auth) ── no deps

P1-1 (runner health) ── no deps
P1-2 (proxy supervision) ── no deps
P1-3 (metrics) ── should come before P2-2 (alertmanager)
P1-4 (graceful shutdown) ── no deps
P1-5 (webhook tests) ── no deps
P1-6 (MCP retry) ── no deps

P2-2 (alertmanager) ── requires P1-3 (metrics)
P2-3 (exporters) ── should come with P2-2
P2-5 (hardcoded values) ── should come before P3-8 (label cache)
```

---

## Success Criteria

- All containers report accurate health status (`docker compose ps`)
- Full SDLC pipeline: issue → implement → review → test → merge
- Prometheus dashboards show task throughput, LLM costs, queue depth
- No unauthenticated access to WebSocket or internal APIs
- Conductor restarts cleanly without orphaned jobs
- Webhook handler has >80% test coverage
- All MCP servers use consistent error handling
