# CueMarshal

A self-hosted, Git-centric AI software development platform. Gitea is the single source of truth. A Conductor orchestrates all work. Specialized agents powered by OpenCode execute SDLC tasks. LiteLLM provides intelligent LLM routing with automatic fallback. MCP servers unify tool access for both automated agents and human users.

## Core Principles

1. **Gitea is the single source of truth.** Every project, task, code change, and status update lives in Gitea as repositories, issues, pull requests, and labels.
2. **Git Flow execution model.** All work follows a strict branch-based lifecycle: issue created, branch opened, code written by agent, PR submitted, review by agent, merge by Conductor.
3. **Conductor + Agents architecture.** The Conductor decomposes tasks and assigns them to specialized SDLC agents (architect, developer, reviewer, tester, devops, docs). Agents execute via OpenCode in Gitea runners.
4. **MCP as the universal tool layer.** Three MCP servers (Gitea, Conductor, System) provide structured tool interfaces used by both automated agents in runners (stdio) and the mobile chat handler (HTTP/SSE).
5. **Automated model selection.** The Conductor analyzes task complexity and selects the optimal LLM tier. LiteLLM handles provider routing, fallback on rate limits, and cost tracking.
6. **Self-improvement.** When runners are idle, the system scans its own codebase for improvement opportunities and executes them through the standard Git Flow pipeline.

## Architecture

```
User (Mobile App / Gitea UI)
         |
    Conductor (TypeScript) ── Redis/BullMQ
         |          |
    MCP Servers    LLM Gateway (LiteLLM)
    ├── Gitea MCP      ├── Anthropic
    ├── Conductor MCP   ├── OpenAI
    └── System MCP      ├── Ollama (local)
         |              └── Other providers
    Gitea Server ── PostgreSQL
         |
    Runners (Gitea Act Runner + OpenCode + MCP)
    ├── Developer Agent
    ├── Reviewer Agent
    ├── Tester Agent
    ├── Architect Agent
    └── DevOps Agent
```

See [docs/architecture/overview.md](docs/architecture/overview.md) for the full architecture with diagrams.

## Deployment Options

### Self-Hosted (Docker Compose)
Run CueMarshal on your own infrastructure with full control. Perfect for teams that want data sovereignty and customization.

```bash
# Interactive installation wizard
./install.sh
```

See [Implementation Status](docs/project/status.md) for setup details.

### Hosted (cuemarshal.dev)
Fully managed cloud offering on Azure Kubernetes Service. Zero infrastructure management, automatic updates, built-in monitoring.

Sign up at: https://app.cuemarshal.dev

The hosted platform is managed by a separate repository (**cuemarshal-cloud**) at `~/source/repos/cuemarshal-cloud`.

## Repository Structure

```
cuemarshal/
├── services/           # All custom-built services
│   ├── conductor/      # Orchestrator service (TypeScript/Node.js)
│   ├── gateway/        # LLM Gateway (LiteLLM + custom callbacks)
│   ├── mcp-servers/    # MCP servers: gitea-mcp, conductor-mcp, system-mcp, vector-mcp, sonar-mcp
│   ├── runner/         # Custom Gitea Act Runner Dockerfile
│   └── agents/         # OpenCode agent profiles (per SDLC role)
├── mobile/             # React Native Expo mobile app
├── infrastructure/     # Gitea, PostgreSQL, Redis, Nginx, SonarQube, Helm configs
│   └── helm/           # Kubernetes Helm charts
├── monitoring/         # Observability stack
│   ├── prometheus/     # Metrics collection
│   ├── grafana/        # Dashboards and visualization
│   ├── loki/           # Log aggregation
│   └── promtail/       # Log shipping
├── workflows/          # Gitea Actions workflow templates
├── scripts/            # Setup and utility scripts
└── docs/               # Full documentation suite
```

## Services

| Service | Port (Host:Container) | Description |
|---------|----------------------|-------------|
| Gitea | 3300:3000 / 2223:22 | Git server, issues, PRs, workflows, webhooks |
| PostgreSQL | 5432 (internal) | Shared database (Gitea + Conductor + LiteLLM) |
| Redis | 6379 (internal) | Task queue (BullMQ), cache, LiteLLM cooldowns |
| Conductor | 4000 (internal) | Orchestrator, webhook handler, mobile API, auto-recovery |
| LLM Gateway | 4100 (internal) | LiteLLM proxy with 3-provider fallback (Groq→Gemini→Azure AI) |
| Gitea MCP | 4200 (internal) | MCP server for Gitea operations (stdio in runners) |
| Conductor MCP | 4201 (internal) | MCP server for task/agent coordination (stdio in runners) |
| System MCP | 4202 (internal) | MCP server for costs, runners, health (stdio in runners) |
| Nginx | 8180:80 | Reverse proxy for Conductor and Gitea |

**Note**: Non-conflicting ports are used because this host also runs a CrewAI deployment on default ports.

## Quick Start

### Prerequisites

- Docker and Docker Compose v2+
- At least 8 GB RAM (16 GB recommended)
- **At least one LLM API key**:
  - **Groq** (free, fast, 30K TPM / 500K daily) - Primary
  - **Google Gemini** (free) - Fallback
  - **Azure AI** (paid, S0 tier) - Second fallback

### One-Command Setup

```bash
# 1. Clone the repository
git clone https://github.com/achingono/cuemarshal.git
cd cuemarshal

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your API keys:
# - GROQ_API_KEY, GEMINI_API_KEY, AZURE_AI_API_KEY
# - Generate secrets: openssl rand -hex 32

# 3. Start everything
docker compose up -d

# 4. Wait for init-gitea to complete (~60 seconds)
docker logs cuemarshal-init-gitea -f

# ✓ All services start automatically with proper dependencies
# ✓ init-gitea creates admin user, bot user, org, repo, webhook, labels
# ✓ Runners auto-register via shared token volume
# ✓ Conductor runs database migrations on startup
```

### Verify

```bash
# Check all 11 services are healthy
docker compose ps

# Access services:
# - Gitea UI: http://localhost:3300
# - Conductor health: curl http://localhost:8180/conductor/health  
# - Nginx proxy: http://localhost:8180
```

Login to Gitea with credentials from `.env`:
- Username: `cuemarshal-admin`
- Password: `GITEA_ADMIN_PASSWORD`

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture/overview.md) | System architecture, data flows, component diagrams |
| [Conductor](docs/features/conductor/overview.md) | Conductor service specification |
| [LLM Gateway](docs/features/gateway/overview.md) | LiteLLM configuration, tiered models, fallback |
| [MCP Servers](docs/features/mcp-servers/overview.md) | MCP server specs, tool schemas, dual transport |
| [Agents](docs/features/agents/overview.md) | Agent profiles, system prompts, tool permissions |
| [Workflows](docs/features/workflows/overview.md) | Gitea Actions workflow templates |
| [Runner](docs/features/runner/overview.md) | Custom runner Dockerfile and setup |
| [Mobile App](docs/features/mobile/overview.md) | React Native Expo app specification |
| [Self-Improvement](docs/operations/self-improvement.md) | Self-improvement engine |
| [Model Selection](docs/architecture/model-selection.md) | Automated model selection algorithm |
| [Security](docs/operations/security.md) | Security model and access control |
| [Deployment](docs/operations/deployment.md) | Deployment and infrastructure guide |
| [API Reference](docs/api/api-reference.md) | Conductor REST and WebSocket API |
| [Webhooks](docs/api/webhooks.md) | Gitea webhook event matrix |

## Technology Stack

- **Orchestration**: TypeScript, Node.js, Express, BullMQ, Drizzle ORM
- **LLM Gateway**: LiteLLM (Python), custom callbacks
- **MCP Servers**: TypeScript, @modelcontextprotocol/sdk
- **AI Engine**: OpenCode (Go), headless/CLI mode
- **Git Platform**: Gitea, Gitea Act Runner
- **Mobile**: React Native, Expo, TypeScript
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **Proxy**: Nginx
- **Containers**: Docker, Docker Compose

## Contributing

CueMarshal uses its own platform to manage contributions — improvements are
proposed and executed through Gitea issues and pull requests, often by the
AI agents themselves.

To contribute:

1. **Fork** the repository and create a feature branch from `main`.
2. **Open an issue** describing what you plan to change before submitting a PR.
3. **Follow the Git Flow** used by the platform: one logical change per branch,
   one PR per issue.
4. **Run the test suites** before opening a PR:
   ```bash
   # MCP servers
   cd services/mcp-servers && npm test
   # Conductor
   cd services/conductor && npm test
   ```
5. **Ensure Docker Compose starts cleanly** with `bash install.sh`.

All pull requests are reviewed (and may be reviewed *by*) the CueMarshal
reviewer agent. Humans have final merge authority.

## License

MIT License — see [LICENSE](LICENSE) for details.
