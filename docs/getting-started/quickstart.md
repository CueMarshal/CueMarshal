# Quick Start Guide

Get the CueMarshal platform running in under 5 minutes with a single command.

## Prerequisites

- **Docker** and **Docker Compose** v2.20+
- **8 GB RAM** minimum (16 GB recommended)
- **LLM API keys** (at least one, all three recommended):
  - **Groq** (free) - Get from https://console.groq.com/keys
  - **Google Gemini** (free) - Get from https://aistudio.google.com/apikey
  - **Azure AI** (paid, S0 tier) - Get from Azure Portal

## One-Command Setup

```bash
# 1. Clone
git clone https://github.com/achingono/cuemarshal.git
cd cuemarshal

# 2. Configure environment
cp .env.example .env

# Edit .env and set:
# - GROQ_API_KEY=gsk_...
# - GEMINI_API_KEY=AIza...
# - AZURE_AI_API_KEY=...
# - AZURE_AI_API_BASE=https://...
# - POSTGRES_PASSWORD=<generate: openssl rand -hex 16>
# - REDIS_PASSWORD=<generate: openssl rand -hex 16>
# - LITELLM_MASTER_KEY=sk-<generate: openssl rand -hex 32>
# - WEBHOOK_SECRET=<generate: openssl rand -hex 32>
# - CONDUCTOR_SECRET=<generate: openssl rand -hex 32>
# - GITEA_ADMIN_PASSWORD=<your strong password>

# 3. Start everything
docker compose up -d

# ✓ All 11 services start with automatic dependency ordering
# ✓ init-gitea creates admin, bot, org, repo, webhook, labels, tokens
# ✓ Runners auto-register via shared volume
# ✓ Conductor runs database migrations on startup
# ✓ Recovery service detects and fixes orphaned issues
```

**That's it!** Wait ~90 seconds for all healthchecks to pass.

## Verify

```bash
# Check all services are healthy
docker compose ps

# Should show 11 services:
# - postgres, redis (healthy)
# - gitea (healthy)  
# - gateway, mcp-gitea, mcp-conductor, mcp-system (healthy)
# - conductor (healthy)
# - runner-1, runner-2 (running)
# - nginx (healthy)

# Access Gitea
curl http://localhost:3300/api/v1/version

# Login credentials (from .env):
# - Username: cuemarshal-admin
# - Password: GITEA_ADMIN_PASSWORD
```

## What Happens Automatically

1. **init-gitea** (runs once, then exits):
   - Creates admin user (`cuemarshal-admin`)
   - Creates bot user (`cuemarshal-bot`)  
   - Generates access tokens (saved to `/tokens/` volume)
   - Creates `cuemarshal` organization
   - Creates `cuemarshal/cuemarshal` repository
   - Imports source code with workflows in `.gitea/workflows/`
   - Configures webhook pointing to Conductor
   - Seeds 20+ labels (roles, complexity, status, types)
   - Generates runner registration token

2. **Runners** (auto-register on startup):
   - Read registration token from `/tokens/runner_token`
   - Register with Gitea as `cuemarshal-runner-1` and `cuemarshal-runner-2`
   - Start gateway auth proxy on `127.0.0.1:4101`
   - Verify all MCP servers and agent profiles are present
   - Begin polling for tasks

3. **Conductor** (orchestration layer):
   - Runs database migrations (creates 5 tables)
   - Starts BullMQ workers for task processing
   - Listens for Gitea webhooks
   - **Starts recovery service** (runs every hour + once on startup after 30s)
   - Auto-assigns issues to `cuemarshal-bot`
   - Routes tasks to appropriate agent roles
   - Triggers workflows by creating branches with `.task.json`

4. **Self-Improvement** (runs every 8 hours):
   - Scans codebase for `TODO`, `FIXME`, `HACK`, `XXX`, "for now" comments
   - Creates 1 Gitea issue per run
   - Issues are auto-assigned and auto-processed

## Test the Pipeline

```bash
# Create a test issue via Gitea API
BOT_TOKEN=$(docker exec cuemarshal-runner-1 cat /tokens/bot_token)
curl -X POST "http://localhost:3300/api/v1/repos/cuemarshal/cuemarshal/issues" \
  -H "Authorization: token $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Add a /hello endpoint",
    "body": "Create a GET /hello endpoint in the Conductor that returns {message: \"Hello from CueMarshal\", timestamp: <ISO8601>}"
  }'
```

**Within 2-5 minutes**:
1. Conductor receives webhook
2. Issue auto-assigned to `cuemarshal-bot`
3. Task record created in database
4. Branch created: `feat/issue-N-add-a-hello-endpoint`
5. `.task.json` pushed to branch
6. `task-execute.yml` workflow triggers
7. Developer agent (OpenCode) implements the endpoint
8. Code committed and pushed
9. PR created linking to issue
10. `.review-trigger` pushed
11. `code-review.yml` workflow triggers
12. Reviewer agent reviews code
13. If approved, PR merged and issue closed

**View progress**:
- **Gitea UI**: http://localhost:3300 → Actions tab
- **Conductor logs**: `docker compose logs -f conductor`
- **Runner logs**: `docker compose logs -f runner-1`

## Troubleshooting

### All services won't start
```bash
# Check for port conflicts
docker compose ps
docker compose logs <failing-service>

# Verify .env has all required variables
grep -E '^[A-Z_]+=' .env | wc -l  # Should be 30+
```

### init-gitea failed
```bash
# Check logs
docker logs cuemarshal-init-gitea

# Common issues:
# - GITEA_ADMIN_PASSWORD not set in .env
# - Gitea not healthy yet (wait 30s more)
```

### Workflows not triggering
```bash
# Verify runners registered
docker logs cuemarshal-runner-1 | grep "registered"

# Check Gitea Actions UI
# http://localhost:3300/cuemarshal/cuemarshal/actions

# Verify webhooks
# http://localhost:3300/cuemarshal/settings/hooks
```

## What's Next

- See [docs/architecture/overview.md](docs/architecture/overview.md) for system design
- See [docs/operations/self-improvement.md](docs/operations/self-improvement.md) for autonomous improvement details
- See [MEMORY.md](MEMORY.md) for lessons learned and known issues

## Getting Help

- See `README.md` for architecture overview
- See `docs/` for detailed documentation on each component
- See `docs/project/implementation-status.md` for implementation details
