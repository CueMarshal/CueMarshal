# GitHub Copilot Instructions for CueMarshal

This file provides context and conventions for GitHub Copilot when working with the CueMarshal codebase.

## Project Overview

CueMarshal is a self-hosted, Git-centric AI software development platform built on these core principles:

1. **Gitea is the single source of truth** - All state lives in Gitea (repos, issues, PRs, labels)
2. **Git Flow execution model** - Strict branch-based lifecycle for all work
3. **Conductor + Agents architecture** - Conductor orchestrates, specialized agents execute
4. **MCP as universal tool layer** - Model Context Protocol servers unify tool access
5. **Automated model selection** - Conductor selects optimal LLM tier per task
6. **Self-improvement** - System improves itself through standard Git Flow

## Architecture

### Core Services

- **Conductor** (`services/conductor/`) - TypeScript orchestrator using Express, BullMQ, Drizzle ORM
- **Gateway** (`services/gateway/`) - LiteLLM proxy with custom callbacks, tiered model routing
- **MCP Servers** (`services/mcp-servers/`) - TypeScript servers using @modelcontextprotocol/sdk:
  - `gitea-mcp` - Gitea operations (issues, PRs, files, workflows)
  - `conductor-mcp` - Task coordination and agent management  
  - `system-mcp` - System health, costs, runners
  - `vector-mcp` - Vector embeddings and semantic search
  - `sonar-mcp` - SonarQube integration for code quality
- **Runner** (`services/runner/`) - Custom Gitea Act Runner with OpenCode + MCP
- **Agents** (`services/agents/`) - 7 specialized SDLC agent profiles
- **Mobile** (`mobile/`) - React Native Expo app with OAuth2 + WebSocket chat

### Data Flow

```
User → Conductor → MCP Servers → Gitea
                ↓
           LLM Gateway → Providers (Groq, Gemini, Azure AI)
                ↓
           Runners (OpenCode + Agents)
```

## Code Conventions

### TypeScript Services (Conductor, MCP Servers)

**Project Structure:**
```
src/
├── index.ts           # Entry point
├── config.ts          # Environment config with Zod validation
├── api/               # Express routes and endpoints
├── services/          # Business logic services
├── db/                # Database schema (Drizzle ORM)
├── queue/             # BullMQ job definitions
└── utils/             # Utility functions
```

**Conventions:**
- Use ES modules (`"type": "module"` in package.json)
- Validate environment variables with Zod schemas in `config.ts`
- Export services as singleton instances or factory functions
- Use Pino for structured logging
- Database migrations go in `src/db/migrations/`
- Use Drizzle ORM with PostgreSQL schema in `src/db/schema.ts`

**Imports:**
```typescript
// Prefer named imports
import { configService } from './config.js';  // Note .js extension for ESM

// Use .js extensions in imports (required for ESM)
import { MyService } from './services/my-service.js';
```

**Configuration Pattern:**
```typescript
// src/config.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  // ...
});

export type Config = z.infer<typeof ConfigSchema>;
export const config = ConfigSchema.parse(process.env);
```

### Agent Profiles (OpenCode)

**Location:** `services/agents/{role}/`

**Structure:**
```
architect/
├── opencode.json                    # OpenCode configuration
└── .opencode/
    └── agents/
        └── architect.md             # System prompt
```

**Agent Roles:**
- `architect` - System design (tier3, full access)
- `developer` - Implementation (tier2, full access)  
- `reviewer` - Code review (tier2, read-only + review tools)
- `tester` - Test writing (tier2, test focus)
- `devops` - Infrastructure (tier2, infra focus)
- `docs` - Documentation (tier1, no bash)
- `linter` - Pre-PR quality (tier1, edit only)

**Configuration:**
- All agents inherit from `services/agents/shared/opencode.base.json`
- MCP servers connected via stdio transport
- Model tier specified per agent (tier1/tier2/tier3)
- Tool permissions customized per role

### MCP Server Development

**Tool Definition Pattern:**
```typescript
// src/tools/my-tool.ts
import { z } from "zod";

export const MyTool = {
  my_action: {
    description: "Clear description of what this tool does",
    parameters: z.object({
      param1: z.string().describe("Parameter description"),
      param2: z.number().optional().describe("Optional parameter"),
    }),
    handler: async (args: { param1: string; param2?: number }) => {
      // Implementation
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },
};
```

**Dual Transport Support:**
- stdio mode: Child process spawned by OpenCode in runners
- HTTP/SSE mode: Long-running service for Conductor chat handler
- Use `MCP_TRANSPORT` env var to switch modes
- All MCP servers must support both transports

### Database Patterns

**Drizzle ORM Schema:**
```typescript
// src/db/schema.ts
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

**Migration Pattern:**
```bash
# Generate migration
npm run db:generate

# Apply migration (automatic on startup)
npm run db:migrate
```

### Gitea Workflows

**Location:** `.gitea/workflows/` and `workflows/` (mirrored)

**Key Workflows:**
- `task-execute.yml` - Main agent execution workflow
- `code-review.yml` - PR review workflow
- `self-improve.yml` - Self-improvement workflow
- `run-tests.yml` - Test execution workflow
- `sonar-scan.yml` - SonarQube analysis

**Conventions:**
- Use `workflow_dispatch` triggers (not path filters on main branch)
- Load role-specific credentials from secrets (`SCM_TOKEN_{ROLE}`)
- Set git config per role (name, email)
- Use `.task.json` sentinel file for task context
- Run linter agent before PR creation

### Documentation

**Location:** `docs/`

**Structure:**
```
docs/
├── architecture/      # System architecture and design
├── features/          # Feature-specific documentation
├── api/              # API reference and contracts
├── getting-started/  # Onboarding and setup
├── operations/       # Deployment and operations
└── plans/            # Implementation plans and summaries
```

**Conventions:**
- Use Markdown with code blocks and diagrams
- Include Mermaid diagrams for architecture
- Keep README files in each service directory
- Link between docs using relative paths
- Document environment variables in `.env.example`

## Development Workflows

### Adding a New Service

1. Create service directory under `services/`
2. Add `package.json` with type: "module"
3. Create `Dockerfile` with multi-stage build
4. Add service to `docker-compose.yml`
5. Update `.github/workflows/build-images.yml`
6. Document in `README.md` and `docs/`

### Adding a New MCP Tool

1. Create tool definition in `services/mcp-servers/{server}/src/tools/`
2. Export from `src/tools/index.ts`
3. Register in `src/index.ts` tool registry
4. Add tests in `src/tools/__tests__/`
5. Update `README.md` with tool documentation
6. Rebuild server image

### Adding a New Agent Role

1. Create directory under `services/agents/{role}/`
2. Add `opencode.json` with model tier and tools
3. Create `.opencode/agents/{role}.md` system prompt
4. Add Gitea user creation in `infrastructure/gitea/init-gitea.sh`
5. Add token generation logic
6. Update `docs/features/agents/overview.md`
7. Add role mapping to `docs/architecture/role-identity-mapping.md`

### Modifying LLM Model Configuration

1. Edit `services/gateway/litellm_config.yaml` (source of truth)
2. Update tier mappings in workflows (`.gitea/workflows/*.yml`)
3. Update `docs/architecture/models.md` documentation
4. Test fallback chain with `scripts/test-gateway-fallback.sh`
5. Verify cost tracking in conductor database

## Local Deployment Best Practices

### Always Use the Deployment Helper Script

When deploying to a local Kubernetes cluster, **always use the deployment helper script**:

```bash
bash scripts/deploy-to-cluster.sh
```

This ensures that:
- Image tagging is consistent and uses unique timestamps
- Resource naming follows conventions and avoids conflicts
- The deployment workflow is identical every time
- Subsequent deployments don't encounter duplication
- The correct Kubernetes context is configured before deployment

**Never bypass this script** — manually building images or running helm commands can lead to image versioning issues and resource conflicts.

**Registry consistency rule:** Keep Helm image registry aligned with build registry. On Docker Desktop, do not hard-force Helm to `docker.io` if images were built as `ghcr.io/cuemarshal/*`; this creates image references Kubernetes cannot resolve from local tags.

### Resolving Code/Deployment Inconsistencies

If you detect inconsistencies between deployed code and source code:

1. **Rebuild images without Docker cache** to force a complete rebuild:
   ```bash
   bash scripts/build-images.sh --no-cache
   ```

2. **Redeploy to the cluster** with fresh images:
   ```bash
   bash scripts/deploy-to-cluster.sh
   ```

**Common causes of inconsistencies:**
- **Stale Docker layer cache** — Old cached layers contain outdated code
- **Interrupted builds** — Partially built images don't reflect all changes
- **Lingering containers** — Kubernetes reuses old containers instead of deploying new ones
- **Network disruptions** — Failed downloads during build leave incomplete dependencies

The `--no-cache` flag rebuilds all layers from scratch, ensuring every change in the source code is reflected in the deployment.

## Common Patterns

### Environment Variable Validation

```typescript
// services/conductor/src/config.ts
const ConfigSchema = z.object({
  NEW_VAR: z.string().min(1),
});

// .env.example - MUST document every variable
# NEW_VAR - Description of purpose and format
NEW_VAR=default_value
```

### Error Handling

```typescript
// Use Zod for request validation
const requestSchema = z.object({ ... });
const validated = requestSchema.safeParse(req.body);
if (!validated.success) {
  return res.status(400).json({ error: validated.error });
}

// Use try-catch for async operations
try {
  const result = await service.doSomething();
  res.json(result);
} catch (error) {
  logger.error({ error }, 'Operation failed');
  res.status(500).json({ error: 'Internal server error' });
}
```

### Logging

```typescript
// Use Pino structured logging
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

logger.info({ userId, action }, 'User action');
logger.error({ error, context }, 'Error occurred');
```

### Database Queries

```typescript
// Use Drizzle ORM
import { db } from './db/index.js';
import { tasks } from './db/schema.js';
import { eq } from 'drizzle-orm';

// Insert
await db.insert(tasks).values({ title: 'New task' });

// Query
const task = await db.query.tasks.findFirst({
  where: eq(tasks.id, taskId),
});

// Update
await db.update(tasks)
  .set({ status: 'completed' })
  .where(eq(tasks.id, taskId));
```

## Testing

### Unit Tests (Jest)

```typescript
// __tests__/my-service.test.ts
import { describe, it, expect } from '@jest/globals';
import { myFunction } from '../my-service.js';

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### Running Tests

```bash
# MCP Servers
cd services/mcp-servers
npm test

# Conductor
cd services/conductor
npm test

# With coverage
npm run test:coverage
```

## Key Configuration Files

### Source of Truth Priority

1. **Environment Variables**: `services/conductor/src/config.ts` (ConfigSchema)
2. **LLM Models**: `services/gateway/litellm_config.yaml` (ONLY runtime source)
3. **Workflows**: `.gitea/workflows/*.yml` (actual trigger mechanism)
4. **MCP Tools**: `services/mcp-servers/{server}/src/tools/` (tool definitions)
5. **Agent Profiles**: `services/agents/{role}/opencode.json` (agent config)

See `docs/getting-started/configuration.md` for complete configuration hierarchy.

## Important References

- **Architecture**: [docs/architecture/overview.md](../docs/architecture/overview.md)
- **Agent Profiles**: [docs/features/agents/overview.md](../docs/features/agents/overview.md)
- **MCP Servers**: [docs/features/mcp-servers/overview.md](../docs/features/mcp-servers/overview.md)
- **Model Selection**: [docs/architecture/model-selection.md](../docs/architecture/model-selection.md)
- **Workflows**: [docs/features/workflows/overview.md](../docs/features/workflows/overview.md)
- **API Reference**: [docs/api/api-reference.md](../docs/api/api-reference.md)

## Tips for GitHub Copilot

- When suggesting TypeScript code, always use ES modules with `.js` extensions in imports
- When creating MCP tools, follow the Zod schema + handler pattern
- When adding environment variables, update both `config.ts` and `.env.example`
- When modifying workflows, mirror changes between `.gitea/workflows/` and `workflows/`
- When creating services, use multi-stage Dockerfiles for smaller images
- When writing documentation, use Mermaid for diagrams and link between docs
- Always validate user input with Zod schemas
- Use Pino for structured logging, not console.log
- Prefer async/await over callbacks
- Follow the existing naming conventions: kebab-case for files, PascalCase for classes
