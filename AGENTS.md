# CueMarshal Agents

Quick reference guide to the specialized AI agents that power the CueMarshal platform.

## Overview

CueMarshal uses 7 specialized agents, each powered by OpenCode with tailored system prompts, tool permissions, and model tiers. All agents run in Gitea Act Runners and access Gitea, Conductor, and System MCP servers via stdio transport.

## Agent Roster

### Ava — Architect Agent

**Role**: System design, architecture decisions, and technical specifications

**Gitea Identity**: `agent-architect` (architect@cuemarshal.local)  
**Model Tier**: tier3 (Complex)  
**Tools**: Full access (read, write, edit, bash, all MCP tools)

**Responsibilities**:
- Design system architecture and component interactions
- Create API contracts and interface specifications
- Make technology stack decisions
- Define data models and database schemas
- Produce architecture decision records (ADRs)

**When to Use**: New features requiring design, system refactors, performance optimization planning

---

### Dave — Developer Agent

**Role**: Feature implementation, bug fixes, and code changes

**Gitea Identity**: `agent-developer` (developer@cuemarshal.local)  
**Model Tier**: tier2 (Standard)  
**Tools**: Full access (read, write, edit, bash, all MCP tools)

**Responsibilities**:
- Implement features from specifications
- Fix bugs and resolve issues
- Refactor code for maintainability
- Add inline documentation
- Create commits following conventional commits

**When to Use**: Feature implementation, bug fixes, code refactoring, general development tasks

**Special**: Also used for self-improvement workflows

---

### Reese — Reviewer Agent

**Role**: Code review, quality checks, and security review

**Gitea Identity**: `agent-reviewer` (reviewer@cuemarshal.local)  
**Model Tier**: tier2 (Standard)  
**Tools**: Read-only + review tools (no write/edit, bash allowed for local checks)

**Responsibilities**:
- Review pull requests for code quality
- Check for security vulnerabilities
- Verify tests exist and pass
- Ensure coding standards compliance
- Submit PR reviews with approval or request changes

**When to Use**: All pull requests (automatic via `code-review.yml` workflow)

---

### Tess — Tester Agent

**Role**: Test writing, test execution, and coverage analysis

**Gitea Identity**: `agent-tester` (tester@cuemarshal.local)  
**Model Tier**: tier2 (Standard)  
**Tools**: Full access (read, write, edit, bash, all MCP tools)

**Responsibilities**:
- Write unit tests for new features
- Write integration tests for APIs
- Run test suites and analyze failures
- Check test coverage and identify gaps
- Create test fixtures and mocks

**When to Use**: Test creation tasks, test coverage improvements, test debugging

---

### Devin — DevOps Agent

**Role**: CI/CD, infrastructure, and deployment

**Gitea Identity**: `agent-devops` (devops@cuemarshal.local)  
**Model Tier**: tier2 (Standard)  
**Tools**: Full access (read, write, edit, bash, all MCP tools)

**Responsibilities**:
- Create and maintain Dockerfiles
- Configure CI/CD pipelines (Gitea Actions)
- Set up infrastructure (docker-compose, nginx)
- Configure monitoring and logging
- Manage secrets and environment configuration

**When to Use**: Infrastructure changes, Docker/Kubernetes config, CI/CD setup, deployment issues

---

### Dot — Documentation Agent

**Gitea Identity**: `agent-docs` (docs@cuemarshal.local)  
**Model Tier**: tier1 (Simple)  
**Tools**: Read, write, edit, grep, glob (NO bash)

**Responsibilities**:
- Write and update README files
- Create API documentation
- Write user guides and tutorials
- Document architecture decisions
- Add inline code comments

**When to Use**: Documentation tasks, README updates, API docs, user guides

**Note**: Optimized for documentation tasks with cost-efficient tier1 model. Bash disabled for safety.

---

### Linton — Linter Agent

**Role**: Pre-PR quality checks and automated code fixes

**Gitea Identity**: `agent-linter` (linter@cuemarshal.local)  
**Model Tier**: tier1 (Simple)  
**Tools**: Read, edit, bash, grep, glob (NO write)

**Responsibilities**:
- Detect and fix syntax errors automatically
- Check for missing imports
- Run linters (ESLint, Prettier) and apply fixes
- Detect type errors in TypeScript
- Fix mechanical code violations
- Ensure code formatting compliance

**When to Use**: Runs automatically in `task-execute.yml` BEFORE PR creation

**Benefits**:
- Catches ~30% of issues before they reach the Reviewer
- Saves tier2 model costs by preventing PR rejections
- No additional workflow trigger required

**Note**: Optimized for mechanical checks with tier1 model. Does not create PRs—only fixes code inline.

---

## Agent Selection Matrix

| Task Type | Primary Agent | Supporting Agents | Model Tier |
|-----------|--------------|-------------------|------------|
| New feature design | Architect (Ava) | — | tier3 |
| Feature implementation | Developer (Dave) | Architect (if design needed) | tier2 |
| Bug fix | Developer (Dave) | Tester (verify fix) | tier2 |
| Pre-PR quality gate | Linter (Linton) | — | tier1 |
| Code review | Reviewer (Reese) | — | tier2 |
| Write tests | Tester (Tess) | — | tier2 |
| CI/CD setup | DevOps (Devin) | — | tier2 |
| Dockerfile changes | DevOps (Devin) | — | tier2 |
| README update | Docs (Dot) | — | tier1 |
| API documentation | Docs (Dot) | Developer (clarification) | tier1 |
| Security review | Reviewer (Reese) | Architect (if design issue) | tier2 |
| Performance fix | Developer (Dave) | Architect (if systemic) | tier2 |

## Execution Flow

### Standard Task Flow

```
1. Issue Created
   ↓
2. Conductor assigns role label (via decomposition)
   ↓
3. Conductor triggers task-execute.yml workflow
   ↓
4. Runner checks out code on feature branch
   ↓
5. Runner loads role-specific OpenCode config
   ↓
6. Runner loads role credentials (SCM_TOKEN_{ROLE})
   ↓
7. Linter agent runs (quality gate)
   ↓
8. Assigned agent executes task with OpenCode
   ↓
9. Agent commits changes as role user
   ↓
10. Agent creates PR (if workflow allows)
```

### PR Review Flow

```
1. PR Created
   ↓
2. Gitea webhook fires (pull_request event)
   ↓
3. Conductor triggers code-review.yml workflow
   ↓
4. Reviewer agent loads as agent-reviewer
   ↓
5. Reviewer analyzes changes and tests
   ↓
6. Reviewer submits review (approve/request changes)
   ↓
7. Conductor merges if approved (or notifies developer)
```

## Technical Details

### Agent Profiles Location

```
services/agents/{role}/
├── opencode.json                    # OpenCode configuration
└── .opencode/
    └── agents/
        └── {role}.md                # System prompt
```

### Shared Configuration

All agents inherit base configuration from `services/agents/shared/opencode.base.json`:
- LLM Gateway connection (http://gateway:4100/v1)
- MCP server connections (stdio transport)
- Base tool permissions

### Model Tier Mapping

| Tier | Use Case | Default Models | Cost Multiplier |
|------|----------|----------------|-----------------|
| tier1 | Simple tasks (docs, linting) | Gemini Flash, GPT-4o-mini | 1x |
| tier2 | Standard tasks (dev, review, test) | GPT-4o, Claude Sonnet | 10x |
| tier3 | Complex tasks (architecture) | Claude Opus, GPT-4 Turbo | 50x |

See [docs/architecture/model-selection.md](docs/architecture/model-selection.md) for selection algorithm.

### MCP Tool Access

Each agent connects to three MCP servers via stdio:

- **Gitea MCP** (port 4200): Issue, PR, branch, file, workflow operations
- **Conductor MCP** (port 4201): Task coordination, progress reporting, agent status
- **System MCP** (port 4202): LLM costs, runner status, health checks

Some agents also connect to:

- **Vector MCP** (port 4203): Semantic search and embeddings
- **Sonar MCP** (port 4204): SonarQube code quality metrics

## Identity and Credentials

Each agent has a dedicated Gitea user account created during platform initialization:

| Agent | Username | Email | Display Name |
|-------|----------|-------|--------------|
| Architect | agent-architect | architect@cuemarshal.local | Ava — Architect |
| Developer | agent-developer | developer@cuemarshal.local | Dave — Developer |
| Reviewer | agent-reviewer | reviewer@cuemarshal.local | Reese — Reviewer |
| Tester | agent-tester | tester@cuemarshal.local | Tess — Tester |
| DevOps | agent-devops | devops@cuemarshal.local | Devin — DevOps |
| Docs | agent-docs | docs@cuemarshal.local | Dot — Technical Writer |
| Linter | agent-linter | linter@cuemarshal.local | Linton — Code Quality |

**Token Storage**: API tokens stored in `/tokens/{role}_token` volume  
**Workflow Access**: Available as `SCM_TOKEN_{ROLE}` secrets in Gitea Actions

See [docs/architecture/role-identity-mapping.md](docs/architecture/role-identity-mapping.md) for complete identity documentation.

## Further Reading

- **Detailed Agent Documentation**: [docs/features/agents/overview.md](docs/features/agents/overview.md)
- **Workflow Execution**: [docs/features/workflows/overview.md](docs/features/workflows/overview.md)
- **MCP Server Tools**: [docs/features/mcp-servers/overview.md](docs/features/mcp-servers/overview.md)
- **Model Selection Algorithm**: [docs/architecture/model-selection.md](docs/architecture/model-selection.md)
- **Security and Permissions**: [docs/operations/security.md](docs/operations/security.md)
