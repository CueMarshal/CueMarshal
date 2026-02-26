# AGENTS.md

Instructions for AI coding agents contributing to the CueMarshal project.

## Project Overview

CueMarshal is a self-hosted, Git-centric AI software development platform. The system uses Gitea as the single source of truth, a TypeScript Conductor for orchestration, 7 specialized SDLC agents powered by OpenCode, and MCP (Model Context Protocol) servers for unified tool access.

**Key Architecture**:
- **Conductor**: TypeScript orchestrator (Express, BullMQ, Drizzle ORM)
- **Gateway**: LiteLLM proxy with tiered model routing
- **MCP Servers**: 5 TypeScript servers (gitea-mcp, conductor-mcp, system-mcp, vector-mcp, sonar-mcp)
- **Runner**: Custom Gitea Act Runner with OpenCode + MCP
- **Agents**: 7 SDLC role-specific agents (architect, developer, reviewer, tester, devops, docs, linter)
- **Mobile**: React Native Expo app with OAuth2

## Setup Commands

```bash
# Clone and setup
git clone https://github.com/CueMarshal/CueMarshal.git
cd cuemarshal

# Environment configuration
cp .env.example .env
# Edit .env with your API keys and secrets

# Start all services
docker compose up -d

# Verify services
docker compose ps
```

## Development Environment

### TypeScript Services (Conductor, MCP Servers)

```bash
# Install dependencies
cd services/conductor  # or services/mcp-servers
npm install

# Development mode with hot reload
npm run dev

# Build
npm run build

# Type checking
npm run typecheck

# Database migrations
npm run db:generate  # Generate migration
npm run db:migrate   # Apply migration
```

### Running Individual Services

```bash
# Conductor
cd services/conductor && npm run dev

# MCP Server (stdio mode)
cd services/mcp-servers/gitea-mcp && npm run build && node dist/index.js

# MCP Server (HTTP mode for testing)
cd services/mcp-servers/gitea-mcp && MCP_TRANSPORT=http PORT=4200 npm run dev
```

## Testing Instructions

### Run All Tests

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

### Test Workflow

1. **Before committing**: Run tests for the service you modified
2. **Fix all failures**: Tests must be green before PR
3. **Add tests**: For new features or bug fixes, add corresponding tests
4. **Type checking**: Run `npm run typecheck` to catch TypeScript errors

### Integration Testing

```bash
# Test gateway fallback
bash scripts/test-gateway-fallback.sh

# Test conductor → gateway integration
bash scripts/test-gateway-from-conductor.sh

# Validate environment
bash scripts/validate-env.sh
```

## Code Style Guidelines

### TypeScript Conventions

- **ES Modules**: Use `"type": "module"` in package.json
- **Import extensions**: Always use `.js` extension in imports (required for ESM)
  ```typescript
  import { myFunction } from './utils/helper.js';  // ✓ Correct
  import { myFunction } from './utils/helper';     // ✗ Wrong
  ```
- **Strict types**: Enable TypeScript strict mode
- **Zod validation**: Use Zod schemas for all environment variables and API inputs
- **Structured logging**: Use Pino, not console.log
- **Async/await**: Prefer over callbacks

### File Naming

- **kebab-case**: For files and directories (`model-selector.ts`, not `ModelSelector.ts`)
- **PascalCase**: For classes and types
- **camelCase**: For variables and functions

### Database Patterns

```typescript
// Use Drizzle ORM with PostgreSQL
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const myTable = pgTable('my_table', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Error Handling

```typescript
// Validate inputs with Zod
const schema = z.object({ ... });
const validated = schema.safeParse(input);
if (!validated.success) {
  return res.status(400).json({ error: validated.error });
}

// Try-catch for async operations
try {
  const result = await service.doSomething();
  res.json(result);
} catch (error) {
  logger.error({ error }, 'Operation failed');
  res.status(500).json({ error: 'Internal server error' });
}
```

## Architecture & Conventions

### Configuration Source of Truth

1. **Environment Variables**: `services/conductor/src/config.ts` (ConfigSchema)
2. **LLM Models**: `services/gateway/litellm_config.yaml` (ONLY runtime source)
3. **Workflows**: `.gitea/workflows/*.yml` (actual trigger mechanism)
4. **MCP Tools**: `services/mcp-servers/{server}/src/tools/` (tool definitions)
5. **Agent Profiles**: `services/agents/{role}/opencode.json` (agent config)

See `docs/getting-started/configuration.md` for full hierarchy.

### MCP Server Development

```typescript
// Tool definition pattern
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
};
```

### Gitea Workflows

- Location: `.gitea/workflows/` and `workflows/` (mirrored)
- Use `workflow_dispatch` triggers (not path filters on main branch)
- Load role-specific credentials from secrets: `SCM_TOKEN_{ROLE}`
- Set git config per role (name, email)
- Use `.task.json` sentinel file for task context
- Run linter agent before PR creation

## Common Tasks

### Adding a New Service

1. Create directory under `services/{name}/`
2. Add `package.json` with `"type": "module"`
3. Create `Dockerfile` with multi-stage build
4. Add to `docker-compose.yml`
5. Update `.github/workflows/build-images.yml`
6. Add README.md and update `docs/`

### Adding a New MCP Tool

1. Create in `services/mcp-servers/{server}/src/tools/{name}.ts`
2. Export from `src/tools/index.ts`
3. Register in `src/index.ts`
4. Add tests in `src/tools/__tests__/`
5. Update server's README.md
6. Rebuild Docker image

### Modifying Environment Variables

1. Update `services/conductor/src/config.ts` (ConfigSchema)
2. Add to `.env.example` with documentation comments
3. Update `docs/getting-started/configuration.md`
4. Test with `scripts/validate-env.sh`

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Examples**:
- `feat(conductor): add task priority queue`
- `fix(mcp): resolve session timeout in HTTP transport`
- `docs: update agent selection matrix`
- `test(conductor): add webhook signature validation tests`

## PR Instructions

### Before Creating PR

1. **Run tests**: `npm test` in modified service
2. **Type check**: `npm run typecheck`
3. **Lint**: `npm run lint`
4. **Build**: `npm run build` to ensure no build errors
5. **Test locally**: `docker compose up -d` to verify integration

### PR Title Format

- Use conventional commit format: `<type>(<scope>): <description>`
- Keep it concise (< 72 characters)
- Examples:
  - `feat(gateway): add Anthropic provider fallback`
  - `fix(mcp-servers): handle connection timeouts gracefully`

### PR Description

Include:
- **What**: Brief summary of changes
- **Why**: Motivation or issue number
- **How**: Implementation approach (if non-obvious)
- **Testing**: How you tested the changes

### Review Process

- All PRs are reviewed by the Reviewer agent (Reese)
- Address review comments promptly
- Tests must pass before merge
- Maintain backwards compatibility unless version bump

## Security Considerations

- **Never commit secrets**: Use `.env` and environment variables
- **Validate all inputs**: Use Zod schemas for validation
- **Webhook signatures**: Verify HMAC signatures on all webhooks
- **SQL injection**: Use parameterized queries (Drizzle ORM handles this)
- **Rate limiting**: Respect LLM provider rate limits (handled by LiteLLM)

## Documentation

- **Architecture changes**: Update `docs/architecture/`
- **New features**: Add to `docs/features/`
- **API changes**: Update `docs/api/api-reference.md`
- **Configuration**: Keep `.env.example` in sync with `config.ts`

## Internal Agent Roster (Reference)

CueMarshal's internal agents that execute SDLC tasks:

## Internal Agent Roster (Reference)

CueMarshal's internal agents that execute SDLC tasks:

| Agent | Role | Model Tier | Identity |
|-------|------|------------|----------|
| **Ava** (Architect) | System design, architecture decisions | tier3 | agent-architect@cuemarshal.local |
| **Dave** (Developer) | Feature implementation, bug fixes | tier2 | agent-developer@cuemarshal.local |
| **Reese** (Reviewer) | Code review, quality checks | tier2 | agent-reviewer@cuemarshal.local |
| **Tess** (Tester) | Test writing, test execution | tier2 | agent-tester@cuemarshal.local |
| **Devin** (DevOps) | CI/CD, infrastructure | tier2 | agent-devops@cuemarshal.local |
| **Dot** (Docs) | Documentation, README updates | tier1 | agent-docs@cuemarshal.local |
| **Linton** (Linter) | Pre-PR quality checks | tier1 | agent-linter@cuemarshal.local |

**Note**: When working on agent-related features, see `docs/features/agents/overview.md` for complete documentation.

## Helpful Commands Reference

```bash
# Build all images
bash scripts/build-images.sh

# Deploy to local Kubernetes cluster
bash scripts/deploy-to-cluster.sh

# Register runners
bash scripts/register-runners.sh

# Seed labels
bash scripts/seed-labels.sh

# Simulate workflow request
bash scripts/simulate-workflow-request.sh
```

## Getting Help

- **Architecture**: See `docs/architecture/overview.md`
- **Features**: Browse `docs/features/` for component-specific docs
- **API Reference**: See `docs/api/api-reference.md`
- **Configuration**: See `docs/getting-started/configuration.md`
- **Troubleshooting**: See `docs/operations/troubleshooting-runbook.md`
