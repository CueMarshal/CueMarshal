# Configuration Source of Truth

This document defines the **canonical sources** for all configuration in the CueMarshal platform. When documentation conflicts with runtime behavior, this file establishes which source is authoritative.

## Purpose

- Eliminate ambiguity when docs, examples, and code diverge
- Define ownership for keeping each configuration area in sync
- Provide a checklist for release validation
- Guide new operators to the correct configuration sources

## Configuration Areas

### 1. Environment Variables

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Required Variables** | `services/conductor/src/config.ts` (ConfigSchema) | `.env.example` must include ALL variables parsed by config.ts |
| **Variable Documentation** | `.env.example` | Comments must explain purpose, format, and constraints |
| **Validation Rules** | `services/conductor/src/config.ts` (Zod schema) | `.env.example` comments should mention validation rules |
| **Default Values** | `services/conductor/src/config.ts` (schema defaults) | `.env.example` should show defaults in comments |
| **Runtime Usage** | `docker-compose.yml` | All services must use variables consistently |

**Owner**: Backend/Infrastructure team  
**Review Trigger**: Any change to `services/conductor/src/config.ts` ConfigSchema  
**Validation**: Run `scripts/validate-env.sh` (created in PLAN-10)

### 2. LLM Model Routing

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Model List** | `services/gateway/litellm_config.yaml` | This is the ONLY runtime source of model definitions |
| **Tier → Provider Mapping** | `services/gateway/litellm_config.yaml` (model_list entries) | `MODELS.md` documents actual runtime behavior |
| **OpenAI Aliases** | `services/gateway/litellm_config.yaml` (duplicate model_list entries) | `MODELS.md` explains alias implementation |
| **Fallback Chain** | `services/gateway/litellm_config.yaml` (router_settings.fallbacks) | `MODELS.md` documents fallback order |
| **Model Selection Logic** | `services/conductor/src/services/model-selector.ts` | `docs/architecture/model-selection.md` explains algorithm |

**Owner**: AI/LLM team  
**Review Trigger**: Any change to `services/gateway/litellm_config.yaml` model definitions  
**Validation**: Compare `litellm_config.yaml` model names with workflow tier mappings

**CRITICAL**: LiteLLM's `store_model_in_db` is **disabled**. YAML is the source of truth. Database models are NOT used.

### 3. Workflow Trigger Behavior

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Trigger Mechanism** | `services/conductor/src/services/workflow-trigger.ts` | `docs/features/workflows/overview.md` documents actual implementation |
| **Branch Naming** | `services/conductor/src/services/workflow-trigger.ts` (branch creation) | `.gitea/workflows/*.yml` must match branch patterns |
| **Task Config Format** | `services/conductor/src/services/workflow-trigger.ts` (.task.json schema) | `docs/features/workflows/overview.md` documents schema |
| **Workflow Files** | `.gitea/workflows/*.yml` | `docs/features/workflows/overview.md` explains each workflow's purpose |

**Owner**: Workflow automation team  
**Review Trigger**: Any change to workflow trigger logic or .gitea/workflows/  
**Validation**: Ensure branch patterns in workflows match conductor's branch creation logic

**Note**: Task execution workflows are triggered by push events with `.task.json` as path filter on feature branches. Self-improvement uses `workflow_dispatch` API (Gitea 1.25+).

### 4. Gitea Webhook Processing

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Event Routing** | `services/conductor/src/api/webhooks.ts` (event handlers) | `docs/api/webhooks.md` documents event flow |
| **Signature Verification** | `services/conductor/src/utils/crypto.ts` | `docs/operations/security.md` documents signature format |
| **Safety Guardrails** | `services/conductor/src/api/webhooks.ts` (loop detection, idempotency) | `docs/api/webhooks.md` documents safety mechanisms |
| **Bot Filtering** | `services/conductor/src/api/webhooks.ts` (BOT_USERNAMES check) | `.env.example` documents BOT_USERNAMES format |

**Owner**: Backend team  
**Review Trigger**: Any change to webhook handling logic  
**Validation**: Verify webhook signature format matches Gitea's implementation (raw hex HMAC, no sha256= prefix)

### 5. Runner Environment and Execution

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Runner Image** | `services/runner/Dockerfile` | `docs/features/runner/overview.md` documents installed tools and versions |
| **Startup Process** | `services/runner/entrypoint.sh` | `docs/features/runner/overview.md` documents proxy startup and supervision |
| **Gateway Proxy** | `services/runner/gateway-proxy.js` | `MODELS.md` documents auth injection |
| **Agent Profiles** | `services/agents/{role}/opencode.json` | `docs/features/agents/overview.md` documents role-specific configuration |
| **MCP Server Availability** | `services/runner/Dockerfile` (MCP binaries in image) | `docs/features/mcp-servers/overview.md` documents stdio transport |

**Owner**: DevOps/Infrastructure team  
**Review Trigger**: Any change to runner image, entrypoint, or proxy  
**Validation**: Verify agent profile MCP server references match installed binaries

### 6. OpenCode Model Configuration

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Model Selection** | `.gitea/workflows/task-execute.yml` (--model flag) | `MODELS.md` documents tier → model mapping |
| **Provider Routing** | Workflow `--model "litellm/{name}"` syntax | `MODELS.md` explains litellm provider usage |
| **Config File Usage** | `services/agents/{role}/opencode.json` (MCP servers only) | `MODELS.md` documents non-interactive mode limitation |
| **Model Discovery** | `services/runner/entrypoint.sh` (LOCAL_ENDPOINT export) | `MODELS.md` documents proxy-based discovery |

**Owner**: Workflow automation + DevOps team  
**Review Trigger**: Any change to workflow model selection or OpenCode version  
**Validation**: Ensure workflow tier mappings match gateway model names

**Note**: OpenCode v0.0.55 does NOT load config files in non-interactive mode. Model selection MUST use `--model` flag.

### 7. Database Schema

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Conductor Schema** | `services/conductor/src/db/schema.ts` | Migrations in `services/conductor/src/db/migrations/` |
| **Gitea Schema** | Gitea binary (managed internally) | `infrastructure/postgres/init.sql` creates database |
| **LiteLLM Schema** | LiteLLM Prisma (managed internally) | `infrastructure/postgres/init.sql` creates database |
| **Database Separation** | `infrastructure/postgres/init.sql` | `MEMORY.md` documents why separation is required |

**Owner**: Database team  
**Review Trigger**: Any change to conductor schema or database initialization  
**Validation**: Verify three separate databases exist (cuemarshal, gitea, litellm)

### 8. Secrets and Authentication

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Environment Secrets** | `.env` (runtime) | `.env.example` documents format and generation |
| **Gitea Repo Secrets** | `infrastructure/gitea/init-gitea.sh` (creation) | `MEMORY.md` documents secret names and purpose |
| **Secret Format** | `services/conductor/src/config.ts` (validation) | `.env.example` comments explain constraints |
| **Token Storage** | `/tokens/` volume (cuemarshal-gitea-tokens) | `MEMORY.md` documents token lifecycle |

**Owner**: Security team  
**Review Trigger**: Any change to secret validation or initialization  
**Validation**: Verify no placeholder values (CHANGE_ME, xxx, etc.) in production

**Critical Secret Requirements**:
- `LITELLM_MASTER_KEY` = `GATEWAY_API_KEY` (same value)
- `API_SECRET_KEY` = `CONDUCTOR_SECRET` (or different if needed)
- `REDIS_URL` must include password if `REDIS_PASSWORD` is set
- `SCM_URL` and `SCM_TOKEN` (NOT `GITEA_*` prefixed) for repo secrets

### 9. Cost Tracking and Budget

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Budget Configuration** | `.env` (`TOTAL_MONTHLY_BUDGET_USD`, etc.) | `services/conductor/src/config.ts` validates ranges |
| **Cost Tracking** | `services/gateway/custom_callbacks.py` (cuemarshal_cost_tracker) | `docs/architecture/model-selection.md` documents callback |
| **Budget Enforcement** | `services/conductor/src/services/self-improvement.ts` | `docs/operations/self-improvement.md` documents enforcement |
| **Cost Logging** | LiteLLM stdout (JSON logs) | `docs/features/gateway/overview.md` documents log format |

**Owner**: AI/LLM team  
**Review Trigger**: Any change to cost tracking or budget logic  
**Validation**: Verify cost callbacks are registered in `litellm_config.yaml`

### 10. Self-Improvement System

| Aspect | Source of Truth | Synchronization Requirements |
|--------|----------------|------------------------------|
| **Scan Configuration** | `.env` (`SELF_IMPROVE_*` variables) | `services/conductor/src/config.ts` validates ranges |
| **Workflow Schedule** | `.gitea/workflows/self-improve.yml` (cron trigger) | `docs/operations/self-improvement.md` documents schedule |
| **Protected Paths** | `.env` (`SELF_IMPROVE_PROTECTED_PATHS`) | `docs/operations/self-improvement.md` documents exclusions |
| **Budget Allocation** | `services/conductor/src/services/self-improvement.ts` | `docs/operations/self-improvement.md` documents budget logic |

**Owner**: AI/LLM team  
**Review Trigger**: Any change to self-improvement logic or workflow  
**Validation**: Verify protected paths exclude critical system directories

## Validation Checklist

Use this checklist before each release:

### Pre-Release Configuration Audit

- [ ] All variables in `services/conductor/src/config.ts` exist in `.env.example` with documentation
- [ ] All model names in `services/gateway/litellm_config.yaml` are referenced in `MODELS.md`
- [ ] Workflow tier mappings in `.gitea/workflows/task-execute.yml` match gateway model names
- [ ] Branch patterns in workflows match `services/conductor/src/services/workflow-trigger.ts` logic
- [ ] All secrets in `.env.example` have generation instructions (openssl rand -hex 32, etc.)
- [ ] No placeholder values (CHANGE_ME, xxx, etc.) in production `.env`
- [ ] Redis URL format matches password configuration (`:PASSWORD@` if password set)
- [ ] Database URL references correct database (cuemarshal, not gitea or litellm)
- [ ] Bot usernames in `.env` match webhook filtering logic
- [ ] Protected paths in `.env` match self-improvement exclusion requirements

### Documentation Sync Audit

- [ ] `MODELS.md` reflects actual `services/gateway/litellm_config.yaml` model list
- [ ] `MEMORY.md` documents latest architectural decisions
- [ ] `docs/features/workflows/overview.md` explains all workflows in `.gitea/workflows/`
- [ ] `docs/features/runner/overview.md` documents runner image contents from `services/runner/Dockerfile`
- [ ] `docs/api/webhooks.md` explains event handling from `services/conductor/src/api/webhooks.ts`
- [ ] Version numbers updated where behavior changed (OpenCode 0.0.55 limitations, etc.)

### Runtime Behavior Validation

- [ ] Run `scripts/validate-env.sh` to check config completeness
- [ ] Verify conductor startup validation catches missing/invalid config
- [ ] Test workflow execution with each tier (tier1, tier2, tier3)
- [ ] Verify webhook signature verification works with Gitea's raw hex HMAC format
- [ ] Test runner proxy health checks and auto-restart behavior
- [ ] Verify cost tracking logs appear in LiteLLM output

## When Conflicts Arise

If documentation conflicts with runtime behavior:

1. **Code is truth** — Runtime behavior defined by code takes precedence
2. **Update docs first** — Fix documentation to match actual behavior
3. **File issue for code** — If behavior is wrong, create issue to fix code
4. **Add version note** — Document when behavior changed (e.g., "Changed in v2.1.0")
5. **Update this file** — Add entry to synchronization requirements if new conflict pattern discovered

## Change Management

### Adding a New Environment Variable

1. Add to `services/conductor/src/config.ts` ConfigSchema with validation
2. Update `.env.example` with variable, comments, and example
3. Update `docker-compose.yml` to pass variable to services
4. Document in relevant `docs/*.md` files
5. Add to `scripts/validate-env.sh` validation
6. Run pre-release configuration audit

### Changing Model Routing

1. Update `services/gateway/litellm_config.yaml` model_list
2. Update `MODELS.md` with new tier → provider mapping
3. Verify workflow tier mappings in `.gitea/workflows/task-execute.yml`
4. Test all three tiers (tier1, tier2, tier3)
5. Update `docs/architecture/model-selection.md` if selection logic changed
6. Document in CHANGELOG.md

### Modifying Workflow Behavior

1. Update workflow files in `.gitea/workflows/`
2. Update `services/conductor/src/services/workflow-trigger.ts` if trigger logic changed
3. Update `docs/features/workflows/overview.md` with new behavior
4. Test workflow execution end-to-end
5. Verify webhook processing in `services/conductor/src/api/webhooks.ts`
6. Document in CHANGELOG.md

## Related Documentation

- `.env.example` — Environment variable reference with generation instructions
- `MODELS.md` — LLM model routing and tier system
- `MEMORY.md` — Architectural decisions and lessons learned
- `docs/features/workflows/overview.md` — Workflow trigger and execution details
- `docs/features/runner/overview.md` — Runner environment and proxy configuration
- `docs/api/webhooks.md` — Webhook processing and safety guardrails
- `docs/architecture/model-selection.md` — Model selector algorithm and budget enforcement
- `RELEASE-CHECKLIST.md` — Pre-release validation steps (created in PLAN-10)
