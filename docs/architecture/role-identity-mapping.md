# Role-Based Identity Mapping

This document defines the mapping between agent roles, Gitea user accounts, API tokens, and repository action secrets used throughout the CueMarshal platform.

## Overview

The CueMarshal platform uses distinct Gitea user accounts for each agent role to provide clear attribution, improve auditability, and enable least-privilege access control. Each role has its own:

- Gitea user account
- API token
- Repository action secret
- Git commit identity

## Role Definitions

### Agent Architect

**Purpose**: System design, architecture decisions, and high-level planning

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-architect` |
| **Display Name** | Agent Architect |
| **Email** | `architect@cuemarshal.local` |
| **Token File** | `/tokens/architect_token` |
| **Action Secret** | `SCM_TOKEN_ARCHITECT` |
| **Permissions** | Repository write, issue management |

### Agent Developer

**Purpose**: Feature implementation, bug fixes, and code changes

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-developer` |
| **Display Name** | Agent Developer |
| **Email** | `developer@cuemarshal.local` |
| **Token File** | `/tokens/developer_token` |
| **Action Secret** | `SCM_TOKEN_DEVELOPER` |
| **Permissions** | Repository write, issue management |
| **Special Use** | Also used for self-improvement workflows |

### Agent Reviewer

**Purpose**: Code review and quality assurance

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-reviewer` |
| **Display Name** | Agent Reviewer |
| **Email** | `reviewer@cuemarshal.local` |
| **Token File** | `/tokens/reviewer_token` |
| **Action Secret** | `SCM_TOKEN_REVIEWER` |
| **Permissions** | Repository write, issue management, pull request reviews |

### Agent Tester

**Purpose**: Test writing and execution

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-tester` |
| **Display Name** | Agent Tester |
| **Email** | `tester@cuemarshal.local` |
| **Token File** | `/tokens/tester_token` |
| **Action Secret** | `SCM_TOKEN_TESTER` |
| **Permissions** | Repository write, issue management |

### Agent DevOps

**Purpose**: CI/CD, infrastructure, and deployment

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-devops` |
| **Display Name** | Agent DevOps |
| **Email** | `devops@cuemarshal.local` |
| **Token File** | `/tokens/devops_token` |
| **Action Secret** | `SCM_TOKEN_DEVOPS` |
| **Permissions** | Repository write, issue management |

### Agent Docs

**Purpose**: Documentation and technical writing

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-docs` |
| **Display Name** | Agent Docs |
| **Email** | `docs@cuemarshal.local` |
| **Token File** | `/tokens/docs_token` |
| **Action Secret** | `SCM_TOKEN_DOCS` |
| **Permissions** | Repository write, issue management |

### Agent Linter

**Purpose**: Code quality checks and automated fixes

| Property | Value |
|----------|-------|
| **Gitea Username** | `agent-linter` |
| **Display Name** | Agent Linter |
| **Email** | `linter@cuemarshal.local` |
| **Token File** | `/tokens/linter_token` |
| **Action Secret** | `SCM_TOKEN_LINTER` |
| **Permissions** | Repository write |

## Provisioning

All role identities are created automatically by the `infrastructure/gitea/init-gitea.sh` script during platform initialization. The script:

1. Creates each role user account with a consistent password (same as admin password)
2. Generates an API token for each role with appropriate scopes
3. Saves tokens to the `gitea-tokens` volume at `/tokens/{role}_token`
4. Seeds repository action secrets for each role (`SCM_TOKEN_{ROLE}`)
5. Adds all role users to the organization

## Token Resolution

### In Workflows

Gitea Actions workflows resolve tokens based on the `agent_role` field in `.task.json`:

```yaml
# Load role-specific token with fallback to legacy SCM_TOKEN
case "${ROLE}" in
  architect)   GITEA_TOKEN="${{ secrets.SCM_TOKEN_ARCHITECT }}" ;;
  developer)   GITEA_TOKEN="${{ secrets.SCM_TOKEN_DEVELOPER }}" ;;
  reviewer)    GITEA_TOKEN="${{ secrets.SCM_TOKEN_REVIEWER }}" ;;
  # ... etc
  *)           GITEA_TOKEN="${{ secrets.SCM_TOKEN }}" ;;
esac
```

### In Conductor

The Conductor service resolves tokens from the `/tokens` volume using the `GiteaClient.forRole(role)` method:

```typescript
// Create a client for a specific role
const client = GiteaClient.forRole('developer');

// Token resolution order:
// 1. /tokens/{role}_token (if role specified)
// 2. GITEA_TOKEN env var
// 3. /tokens/bot_token
```

## Git Identity Configuration

Each workflow configures git author identity based on the role:

```bash
case "${ROLE}" in
  architect)
    git config user.name "agent-architect"
    git config user.email "architect@cuemarshal.local"
    ;;
  # ... etc
esac
```

This ensures all commits are properly attributed to the correct role in the Gitea UI and git history.

## Fallback Behavior

The system maintains backward compatibility through a multi-level fallback chain:

1. **Primary**: Role-specific token from `/tokens/{role}_token`
2. **Secondary**: Legacy bot token from `GITEA_TOKEN` env var
3. **Tertiary**: Legacy bot token from `/tokens/bot_token`

This ensures:
- Graceful degradation if role tokens are unavailable
- Smooth migration from legacy single-token setup
- Continued operation during token rotation

## Token Rotation

Role tokens can be rotated independently without affecting other roles:

1. Generate a new token for the role using the Gitea API
2. Update `/tokens/{role}_token` in the gitea-tokens volume
3. Update the corresponding repository action secret
4. The new token takes effect immediately (no restart required)

### Rotation Example

```bash
# Rotate developer token
NEW_TOKEN=$(curl -sf -X POST \
  -u "agent-developer:${PASSWORD}" \
  -H "Content-Type: application/json" \
  "http://gitea:3000/api/v1/users/agent-developer/tokens" \
  -d '{"name": "developer-token-'$(date +%s)'", "scopes": ["write:repository", "write:issue"]}' | \
  jq -r '.sha1')

# Update token file
echo "${NEW_TOKEN}" > /tokens/developer_token

# Update action secret
curl -sf -X PUT \
  -H "Authorization: token ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "http://gitea:3000/api/v1/repos/${ORG}/cuemarshal/actions/secrets/SCM_TOKEN_DEVELOPER" \
  -d "{\"data\": \"${NEW_TOKEN}\"}"
```

## Security Considerations

### Least Privilege

- Each role has only the permissions necessary for its function
- No role has organization admin scope by default
- Tokens are scoped to specific operations (repository write, issue management, etc.)

### Token Isolation

- Compromise of one role token does not grant access to other roles
- Each token is independently rotatable
- Token files are stored with read-only mounts where applicable

### Audit Trail

- All Gitea activity shows the specific role that performed the action
- Git commits are attributed to the role user
- Conductor logs include `acting_identity` and `agent_role` fields

## Troubleshooting

### Missing Role Token

**Symptom**: Workflow logs show "WARNING: Role-specific token not found, using legacy SCM_TOKEN"

**Cause**: Role token file missing from `/tokens/` volume

**Resolution**:
1. Verify `init-gitea.sh` completed successfully
2. Check for token file: `ls -la /tokens/{role}_token`
3. If missing, re-run token generation for that role
4. Verify repository action secret is set

### Permission Denied

**Symptom**: Gitea API calls fail with 403 Forbidden

**Cause**: Role token has insufficient permissions

**Resolution**:
1. Verify token scopes include required permissions
2. Regenerate token with correct scopes
3. Update both token file and action secret

### Wrong Identity in Commits

**Symptom**: Commits show wrong author in git history

**Cause**: Git identity not configured correctly in workflow

**Resolution**:
1. Verify workflow sets `git config user.name` and `user.email`
2. Check that role matches expected identity
3. Ensure workflow loads correct token for the role

## Related Documentation

- [PLAN-12 Implementation Summary](plans/PLAN-12-IMPLEMENTATION-SUMMARY.md)
- [Security Architecture](../operations/security.md)
- [Workflow Reference](../features/workflows/overview.md)
