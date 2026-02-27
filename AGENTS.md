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

## Managing Local Deployments

### Overview

CueMarshal uses a local Kubernetes cluster (typically docker-desktop or minikube) for development and testing. Understanding the deployment workflow and image management is critical for successful local development.

### Key Deployment Concepts

**Image Pull Policy**: The cluster uses `imagePullPolicy: IfNotPresent` by default, which means:
- Kubernetes will only pull an image if it doesn't exist locally
- Rebuilding an image with the same tag won't automatically update running pods
- You must use unique tags or change the pull policy to force updates

**Deployment Script**: Always use `scripts/deploy-to-cluster.sh` for deployments:
```bash
# Default deployment with timestamp tag
bash scripts/deploy-to-cluster.sh

# Deploy with custom tag
TAG=my-feature-v1 bash scripts/deploy-to-cluster.sh

# Build and deploy specific service
SERVICE=landing bash scripts/deploy-to-cluster.sh
```

### Local Deployment Troubleshooting

**Always deploy using the deployment helper script:**
```bash
bash scripts/deploy-to-cluster.sh
```

This ensures that:
- Image tagging is consistent across all deployments
- Resource naming follows conventions and avoids conflicts
- The deployment workflow is identical every time
- Subsequent deployments don't encounter duplication or naming conflicts
- The Kubernetes context is properly configured before deployment

**If you detect inconsistencies between deployed code and source code:**
1. Rebuild images without Docker cache:
   ```bash
   bash scripts/build-images.sh --no-cache
   ```
2. Deploy to cluster:
   ```bash
   bash scripts/deploy-to-cluster.sh
   ```

Common causes of inconsistencies:
- **Stale Docker layer cache**: Old layer cache can cause outdated code to persist in images
- **Interrupted builds**: Partially built images may not reflect source changes
- **Lingering containers**: Old containers may be reused instead of creating fresh ones
- **Network issues**: Failed downloads during build can leave incomplete dependencies

The `--no-cache` flag forces a complete rebuild of all layers from scratch, ensuring all changes are reflected in the final image.

### Step-by-Step Deployment Workflow

1. **Make code changes** to your service
   ```bash
   cd services/landing  # or any service
   # Edit files...
   ```

2. **Build images with unique tag** (handled automatically by deploy script)
   ```bash
   # The deploy script automatically generates timestamp tags
   bash scripts/deploy-to-cluster.sh
   ```

3. **Verify deployment**
   ```bash
   # Check pod status
   kubectl get pods -n cuemarshal-local
   
   # View logs
   kubectl logs -n cuemarshal-local -l app.kubernetes.io/name=cuemarshal,component=landing
   
   # Check deployment status
   helm status cuemarshal -n cuemarshal-local
   ```

4. **Test your changes**
   ```bash
   # Access the application
   open http://cuemarshal.local
   
   # Or curl specific endpoints
   curl http://cuemarshal.local/api/health
   ```

### Common Deployment Issues & Solutions

#### Issue: Pods not picking up new image

**Problem**: You rebuilt the image but pods are still running old code.

**Solution**:
```bash
# Option 1: Use deploy script (recommended)
bash scripts/deploy-to-cluster.sh

# Option 2: Manual rebuild with unique tag
REGISTRY='ghcr.io/cuemarshal' TAG=$(date +%Y%m%d-%H%M%S) bash scripts/build-images.sh
helm upgrade --install cuemarshal infrastructure/helm/cuemarshal \
  --values infrastructure/helm/cuemarshal/local-values.yaml \
  --namespace cuemarshal-local \
  --set image.tag=$(date +%Y%m%d-%H%M%S)

# Option 3: Force pull with imagePullPolicy
kubectl patch deployment cuemarshal-landing -n cuemarshal-local \
  --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value":"Always"}]'
kubectl delete pods -n cuemarshal-local -l component=landing --grace-period=0 --force
```

#### Issue: Image pull errors (ErrImagePull, ErrImageNeverPull)

**Problem**: Kubernetes can't find the image with the specified tag.

**Solution**:
```bash
# Verify image exists locally
docker images | grep cuemarshal

# Check registry prefix matches deployment
# If using local images, ensure registry is ghcr.io/cuemarshal or docker.io/cuemarshal
# Verify image tag matches deployment spec
kubectl get deployment cuemarshal-landing -n cuemarshal-local -o jsonpath='{.spec.template.spec.containers[0].image}'
```

#### Issue: Helm upgrade hangs or fails

**Problem**: Previous Helm operation is pending or locked.

**Solution**:
```bash
# Check Helm release status
helm status cuemarshal -n cuemarshal-local

# If stuck, uninstall and reinstall
helm uninstall cuemarshal -n cuemarshal-local
bash scripts/deploy-to-cluster.sh

# Check for pending releases
helm list -n cuemarshal-local --pending
```

### Best Practices

1. **Always use the deploy script**: `scripts/deploy-to-cluster.sh` handles tag generation, image building, and deployment correctly.
2. **Keep build/helm registry aligned**: Do not force `HELM_REGISTRY=docker.io` for Docker Desktop when images are built as `ghcr.io/cuemarshal/*`; this causes pods to reference tags that are not present locally.

3. **Unique tags for each deployment**: The deploy script auto-generates timestamp tags to ensure fresh deployments.

4. **Verify before deploying**: Run tests locally first:
   ```bash
   cd services/conductor
   npm test
   npm run typecheck
   ```

5. **Check pod logs immediately**: After deployment, verify services started correctly:
   ```bash
   kubectl logs -n cuemarshal-local -l component=conductor --tail=50 -f
   ```

6. **Test incrementally**: Deploy one service at a time when debugging issues.

7. **Clean up failed deployments**: If deployment fails, clean up before retrying:
   ```bash
   helm uninstall cuemarshal -n cuemarshal-local
   kubectl delete namespace cuemarshal-local  # Only if needed
   bash scripts/deploy-to-cluster.sh
   ```

### Advanced Deployment Scenarios

#### Deploying a Single Service

```bash
# Build only the landing service
cd services/landing
docker build -t ghcr.io/cuemarshal/landing:my-fix .

# Tag as latest and force update
docker tag ghcr.io/cuemarshal/landing:my-fix ghcr.io/cuemarshal/landing:latest
kubectl patch deployment cuemarshal-landing -n cuemarshal-local \
  --type='json' \
  -p='[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value":"Always"}]'
kubectl delete pods -n cuemarshal-local -l component=landing --force --grace-period=0
```

#### Inspecting Container Contents

```bash
# List files in running pod
POD=$(kubectl get pods -n cuemarshal-local -l component=landing -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n cuemarshal-local $POD -- ls -la /usr/share/nginx/html

# Check specific directory structure
kubectl exec -n cuemarshal-local $POD -- find /usr/share/nginx/html -type d

# View file contents
kubectl exec -n cuemarshal-local $POD -- cat /usr/share/nginx/html/index.html
```

#### Rolling Back Deployments

```bash
# View Helm release history
helm history cuemarshal -n cuemarshal-local

# Rollback to previous version
helm rollback cuemarshal -n cuemarshal-local

# Rollback to specific revision
helm rollback cuemarshal 3 -n cuemarshal-local
```

### Debugging Checklist

When deployments fail or services don't work as expected:

- [ ] Check pod status: `kubectl get pods -n cuemarshal-local`
- [ ] View pod logs: `kubectl logs -n cuemarshal-local <pod-name>`
- [ ] Verify image tag: `kubectl describe pod -n cuemarshal-local <pod-name>`
- [ ] Check service endpoints: `kubectl get svc -n cuemarshal-local`
- [ ] Verify ingress/routes: `kubectl get ingress -n cuemarshal-local`
- [ ] Test connectivity: `kubectl run -it --rm debug --image=busybox --restart=Never -n cuemarshal-local -- wget -O- http://landing:3000`
- [ ] Check resource limits: `kubectl top pods -n cuemarshal-local`
- [ ] Review Helm values: `helm get values cuemarshal -n cuemarshal-local`

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
