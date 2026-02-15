# Release Checklist — CueMarshal

This checklist ensures configuration parity and documentation sync before each release.

## Pre-Release Validation

### 1. Configuration Completeness

- [ ] Run `./scripts/validate-env.sh --prod` and verify all checks pass
- [ ] All variables in `services/conductor/src/config.ts` exist in `.env.example` with documentation
- [ ] No placeholder values (CHANGE_ME, xxx, etc.) remain in production `.env`
- [ ] All secrets are at least 32 characters (WEBHOOK_SECRET, CONDUCTOR_SECRET, etc.)
- [ ] REDIS_URL format matches REDIS_PASSWORD configuration (`:PASSWORD@` if password set)
- [ ] DATABASE_URL references the `cuemarshal` database (not gitea or litellm)
- [ ] GATEWAY_API_KEY equals LITELLM_MASTER_KEY
- [ ] At least one LLM provider API key is configured (GROQ, AZURE_AI, or GEMINI)

### 2. Model Configuration Sync

- [ ] All model names in `services/gateway/litellm_config.yaml` are documented in `MODELS.md`
- [ ] Workflow tier mappings in `.gitea/workflows/task-execute.yml` match gateway model names
- [ ] Tier system table in `MODELS.md` matches `litellm_config.yaml` provider assignments
- [ ] Fallback chain in `MODELS.md` matches `router_settings.fallbacks` in gateway config
- [ ] OpenAI alias mappings (gpt-4o-mini, gpt-4o, gpt-4.1) are consistent across:
  - `services/gateway/litellm_config.yaml` (duplicate model_list entries)
  - `services/gateway/litellm_config.yaml` (router_settings.model_group_alias)
  - `MODELS.md` (OpenAI Model Name Aliases table)

### 3. Workflow Configuration Sync

- [ ] Branch patterns in workflows match `services/conductor/src/services/workflow-trigger.ts` logic
- [ ] All workflow files in `.gitea/workflows/` are documented in `docs/features/workflows/overview.md`
- [ ] Task config schema (.task.json) in workflow matches conductor's creation logic
- [ ] Workflow secrets (SCM_URL, SCM_TOKEN, etc.) match `infrastructure/gitea/init-gitea.sh`
- [ ] Runner labels in workflows match `docker-compose.yml` runner configuration

### 4. Documentation Updates

- [ ] `MODELS.md` reflects actual runtime behavior from `services/gateway/litellm_config.yaml`
- [ ] `MEMORY.md` updated with latest architectural decisions and date
- [ ] `docs/features/workflows/overview.md` explains all workflows in `.gitea/workflows/`
- [ ] `docs/features/runner/overview.md` documents runner image contents from `services/runner/Dockerfile`
- [ ] `docs/api/webhooks.md` explains event handling from `services/conductor/src/api/webhooks.ts`
- [ ] Version numbers updated where behavior changed (e.g., "Changed in v2.1.0")
- [ ] `CONFIGURATION.md` reflects current source of truth for all config areas

### 5. Webhook and API Validation

- [ ] Webhook signature format in `services/conductor/src/utils/crypto.ts` matches Gitea's raw hex HMAC
- [ ] Bot usernames in `.env` BOT_USERNAMES match filtering logic in `services/conductor/src/api/webhooks.ts`
- [ ] Webhook loop threshold in `.env` matches safety guardrails implementation
- [ ] Idempotency TTL in `.env` is appropriate for expected webhook volumes

### 6. Database and Schema

- [ ] Three separate databases exist: `cuemarshal`, `gitea`, `litellm`
- [ ] `infrastructure/postgres/init.sql` creates all three databases
- [ ] Conductor migrations in `services/conductor/src/db/migrations/` are applied
- [ ] LiteLLM's `store_model_in_db` is **disabled** in `services/gateway/litellm_config.yaml`

### 7. Runner and Proxy Configuration

- [ ] `services/runner/entrypoint.sh` includes health checks and supervision (PLAN-08)
- [ ] Gateway proxy (`services/runner/gateway-proxy.js`) has structured logging and graceful shutdown
- [ ] Agent profiles in `/agents/{role}/` are complete with MCP server references
- [ ] MCP server binaries are built and copied into runner image (`services/runner/Dockerfile`)
- [ ] OpenCode version documented in `docs/features/runner/overview.md` and `MODELS.md`

### 8. Security and Secrets

- [ ] All secrets use strong random values (run `openssl rand -hex 32` for new secrets)
- [ ] `.env` file is in `.gitignore` and never committed
- [ ] Gitea repo secrets use `SCM_*` prefix (not `GITEA_*` which is reserved)
- [ ] Webhook secret matches between `.env` WEBHOOK_SECRET and Gitea webhook configuration
- [ ] Conductor secret used consistently across MCP servers and runners

### 9. Cost Tracking and Budget

- [ ] `TOTAL_MONTHLY_BUDGET_USD` is set appropriately for expected usage
- [ ] `SELF_IMPROVE_BUDGET_PCT` is reasonable (default 10%)
- [ ] Cost callback registered in `services/gateway/litellm_config.yaml` success_callback
- [ ] Model selector respects budget limits in `services/conductor/src/services/model-selector.ts`

### 10. CI/CD Validation

- [ ] `.gitea/workflows/validate-config.yml` workflow runs on PR and main branch changes
- [ ] Configuration validation workflow passes for all config file changes
- [ ] Model tier consistency check passes
- [ ] Conductor config schema compiles without errors

## Testing Checklist

### Manual Testing

- [ ] **Configuration Validation**:
  - Run `./scripts/validate-env.sh` → all checks pass
  - Run `./scripts/validate-env.sh --prod` → no placeholder values detected
  - Start conductor → no validation errors at startup

- [ ] **Model Routing**:
  - Test tier1 model request → routes to Groq/Gemini correctly
  - Test tier2 model request → routes to Groq/Gemini correctly
  - Test tier3 model request → routes to Azure AI/Gemini correctly
  - Verify fallback chain on provider failure

- [ ] **Workflow Execution**:
  - Create test issue → workflow triggers correctly
  - Verify `.task.json` created with correct schema
  - Verify agent profile copied correctly
  - Verify OpenCode executes with correct `--model` flag

- [ ] **Webhook Processing**:
  - Create issue → webhook received and processed
  - Create PR → webhook received and review triggered
  - Approve PR → webhook received and merge triggered
  - Verify signature verification works
  - Verify idempotency (duplicate webhook is rejected)

- [ ] **Runner Proxy**:
  - Verify proxy starts successfully (check health endpoint)
  - Verify proxy auto-restarts on failure
  - Verify graceful shutdown on SIGTERM
  - Check structured JSON logs appear

### Automated Testing

- [ ] Run all tests: `npm test` in conductor directory
- [ ] Configuration validation CI workflow passes
- [ ] No linter errors in conductor code
- [ ] TypeScript compilation succeeds for all services

## Release Documentation

### Changelog

- [ ] `CHANGELOG.md` updated with:
  - New features added in this release
  - Bug fixes and improvements
  - **Configuration changes** (new env vars, changed defaults, etc.)
  - **Workflow behavior changes** (trigger logic, model selection, etc.)
  - **Model routing changes** (new tiers, provider updates, etc.)
  - Breaking changes (if any)
  - Migration steps (if any)

### Version Bump

- [ ] Update version in `conductor/package.json`
- [ ] Update version in relevant `README.md` files
- [ ] Tag release with semantic version (e.g., v2.1.0)

### Deployment Notes

- [ ] Document any new environment variables in deployment guide
- [ ] Document any required database migrations
- [ ] Document any required infrastructure changes
- [ ] Update `docs/operations/deployment.md` with any new requirements

## Post-Release Validation

### Deployment Verification

- [ ] All services start successfully (check `docker-compose ps`)
- [ ] Health checks pass for all services
- [ ] Conductor connects to database successfully
- [ ] Conductor connects to Redis successfully
- [ ] Gateway serves `/health/liveliness` endpoint
- [ ] MCP servers respond to `/health` endpoint
- [ ] Runners register with Gitea successfully

### Functional Verification

- [ ] Create test issue → full pipeline executes successfully
- [ ] Issue → Branch → Workflow → Code → PR → Review → Merge → Close
- [ ] Cost tracking logs appear in LiteLLM output
- [ ] Webhook events processed without errors
- [ ] Model selector chooses correct tier based on complexity
- [ ] Self-improvement workflow runs on schedule

### Monitoring Setup

- [ ] Check logs for errors (`docker-compose logs -f`)
- [ ] Verify cost tracking data is being collected
- [ ] Verify webhook idempotency cache is working
- [ ] Monitor runner utilization
- [ ] Monitor LLM provider rate limits

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate Issues**:
   - [ ] Stop affected services: `docker-compose stop <service>`
   - [ ] Check logs: `docker-compose logs <service>`
   - [ ] Fix configuration in `.env` if config-related
   - [ ] Restart services: `docker-compose up -d <service>`

2. **Critical Issues**:
   - [ ] Full rollback: `git checkout <previous-tag>`
   - [ ] Rebuild images: `docker-compose build`
   - [ ] Restore database from backup (if schema changed)
   - [ ] Restart stack: `docker-compose up -d`

3. **Post-Rollback**:
   - [ ] Document issue in GitHub issue / Gitea issue
   - [ ] Create hotfix branch
   - [ ] Fix issue and re-test
   - [ ] Create new release

## Sign-Off

### Release Manager

- [ ] All checklist items completed
- [ ] All tests passed
- [ ] Changelog reviewed and approved
- [ ] Documentation reviewed and approved

**Release Manager**: _______________  
**Date**: _______________  
**Version**: _______________  

### Technical Review

- [ ] Configuration changes reviewed
- [ ] Code changes reviewed
- [ ] Security implications reviewed
- [ ] Performance implications reviewed

**Technical Reviewer**: _______________  
**Date**: _______________  

---

## Notes

This checklist is maintained as part of PLAN-10: Configuration Alignment and Documentation Sync.

For questions or updates to this checklist, see:
- `CONFIGURATION.md` — Source of truth definitions
- `docs/plans/PLAN-10-IMPLEMENTATION-SUMMARY.md` — Implementation details
- `MEMORY.md` — Architectural decisions and lessons learned
