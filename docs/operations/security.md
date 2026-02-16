# Security Model

## Overview

The CueMarshal platform handles sensitive operations — API keys, code repositories, and automated code changes. This document defines the security model across all layers.

## Threat Model

### Assets to Protect

1. **LLM API keys** (Groq, Gemini, Azure AI) — unauthorized use incurs cost
2. **Gitea repositories** — source code integrity
3. **Gitea admin tokens** — full platform control
4. **User credentials** — OAuth2 tokens from mobile app
5. **Infrastructure** — Docker containers, database, network

### Threat Vectors

1. **Malicious LLM output** — Agent generates harmful code or exfiltrates data
2. **Compromised runner** — Attacker gains access to a runner container
3. **MCP server abuse** — Agent calls tools it shouldn't have access to
4. **Network interception** — Man-in-the-middle on internal Docker network
5. **Mobile app compromise** — Stolen OAuth2 token
6. **Self-improvement exploit** — Self-improvement modifies security controls

## Security Controls

### 1. Network Isolation

All services run on an internal Docker network. Only Nginx is exposed to the internet.

```
Internet → [Nginx :80/:443] → Internal Docker Network
                                ├── Gitea (internal only)
                                ├── Conductor (internal only)
                                ├── Gateway (internal only)
                                ├── MCP Servers (internal only)
                                ├── Runners (internal only)
                                ├── PostgreSQL (internal only)
                                └── Redis (internal only)
```

**Rules:**
- No service except Nginx binds to `0.0.0.0`
- All services bind to the Docker network interface only
- PostgreSQL and Redis do not expose ports to the host
- MCP servers are not exposed through Nginx

### 2. Secret Management

| Secret | Storage | Access |
|--------|---------|--------|
| LLM API keys (Groq, Gemini, Azure AI) | Docker Compose `.env` file + Gitea Actions secrets | Gateway only |
| Gitea admin token | `.env` file | Conductor only |
| Gitea bot token | Gitea Actions secrets | Runners (via workflow secrets) |
| Webhook HMAC secret | `.env` file + Gitea webhook config | Conductor only |
| LiteLLM master key | `.env` file | Conductor + admin |
| OAuth2 client ID (public client, PKCE) | Mobile app config | Mobile app |
| Conductor internal secret | `.env` file | MCP servers |
| Runner registration token | Gitea admin API | Runners (one-time registration) |

**Rules:**
- `.env` file has `0600` permissions, owned by the deploy user
- Secrets are never logged or included in error messages
- API keys are never passed to runners directly — runners use the Gateway URL with a virtual key
- MCP servers receive scoped tokens, not admin tokens

### 3. Gitea Token Scoping

Different components use different Gitea API tokens with minimum required scopes:

| Component | Token Name | Scopes |
|-----------|-----------|--------|
| Conductor | `conductor-token` | `read:org`, `write:repository`, `write:issue`, `write:notification`, `read:user` |
| Runner (Developer) | `agent-developer-token` | `write:repository`, `write:issue` |
| Runner (Reviewer) | `agent-reviewer-token` | `read:repository`, `write:issue` (review comments only) |
| Runner (Tester) | `agent-tester-token` | `write:repository`, `write:issue` |
| Runner (Docs) | `agent-docs-token` | `write:repository` (docs files only) |
| Mobile App (User) | OAuth2 user token | Per user's Gitea permissions |

### 4. MCP Server Authentication

Each MCP server validates caller identity:

**Gitea MCP Server:**
- Accepts a Gitea API token in the `GITEA_TOKEN` environment variable
- In stdio mode: token is passed via env when OpenCode spawns the process
- In HTTP/SSE mode: Conductor authenticates via bearer token
- The token's scopes determine what operations the caller can perform

**Conductor MCP Server:**
- Validates caller using `CONDUCTOR_SECRET` shared secret
- In stdio mode: secret passed via env
- In HTTP/SSE mode: bearer token authentication
- Returns only data the caller is authorized to see

**System MCP Server:**
- Read-only by default (no destructive operations)
- Validates caller using `CONDUCTOR_SECRET`
- Cost data is scoped to the project the caller is authorized for

### 5. MCP Tool Scoping Per Agent Role

Agent profiles restrict which MCP tools are available via the OpenCode configuration:

| Role | Gitea MCP Access | Conductor MCP Access | System MCP Access |
|------|-----------------|---------------------|-------------------|
| Architect | Read all + create_issue, add_comment | All tools | All tools |
| Developer | All tools | All tools | cost_get_budget, runner_get_status |
| Reviewer | Read only + create_review, add_comment | task_report_progress, task_get_context | Read only |
| Tester | Read only + add_comment | task_report_progress, task_get_context | Read only |
| DevOps | All tools | All tools | All tools |
| Docs | Read only + add_comment | task_report_progress | Read only |

**Implementation:** The role-specific `opencode.json` configures MCP servers with different `GITEA_TOKEN` values (different scoped tokens) and the agent system prompts explicitly instruct the LLM on which tools to use.

### 6. Webhook Verification

All incoming Gitea webhooks are verified using HMAC-SHA256:

```typescript
function verifyWebhook(req: Request, secret: string): boolean {
  const signature = req.headers["x-gitea-signature"];
  const payload = JSON.stringify(req.body);
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Rules:**
- Reject requests without `X-Gitea-Signature` header
- Use constant-time comparison to prevent timing attacks
- Log rejected webhooks for security monitoring

### 7. Runner Isolation

Each workflow job runs in its own isolated environment:

- **Container isolation**: When using Docker mode, each job runs in a fresh container
- **Host isolation**: When using host mode, each job runs in a clean workspace directory
- **No persistent state**: Runners are stateless; workspace is cleaned between jobs
- **No inter-job communication**: Jobs cannot access other jobs' data
- **Resource limits**: Docker containers have CPU and memory limits

**Docker Compose runner security:**

```yaml
services:
  runner-1:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
      - /workspace
    mem_limit: 4g
    cpus: 2
```

### 8. Protected Branches

The `main` branch of all managed repositories has branch protection:

- **Require PR**: No direct push to `main`
- **Require review**: At least 1 approved review
- **Require status checks**: CI must pass before merge
- **No force push**: Disabled for all users including admin
- **Signed commits**: Optional but recommended

### 9. LLM Output Sandboxing

Agents execute LLM-generated code in sandboxed environments:

- OpenCode's `bash` tool runs commands in the workspace directory
- No access to host filesystem outside the workspace
- No access to the Docker socket (unless explicitly needed for DevOps tasks)
- Network access limited to internal Docker services
- No access to `.env` files or secrets on disk

**Additional safeguards:**
- Workflow steps that interact with secrets (GITEA_TOKEN, API keys) are separate from OpenCode execution steps
- OpenCode receives credentials only through environment variables managed by the workflow
- The `self-improvement` system cannot modify files in protected paths without human review

### 10. Mobile App Security

**Authentication:**
- Gitea OAuth2 with PKCE (Proof Key for Code Exchange)
- Short-lived access tokens (1 hour default)
- Refresh tokens stored in Expo SecureStore (hardware-backed on iOS, encrypted on Android)
- Tokens are never stored in plain text or AsyncStorage

**Transport:**
- All API communication over HTTPS (TLS 1.2+)
- WebSocket connections use WSS (WebSocket Secure)
- Certificate pinning optional for high-security deployments

**Session management:**
- Sessions expire after 24 hours of inactivity
- User can remotely revoke all sessions via Gitea
- Rate limiting on chat endpoint (10 messages/minute per user)

### 11. Self-Improvement Security

The self-improvement system has additional security controls:

| Control | Description |
|---------|-------------|
| Protected paths | Changes to `services/conductor/`, `services/gateway/`, `services/mcp-servers/`, `infrastructure/` require human review |
| Budget cap | Maximum 10% of total LLM budget for self-improvement |
| Max per cycle | Maximum 3 improvements per cycle |
| Label guard | PRs labeled `needs-human-review` cannot be auto-merged |
| Secrets blocked | Self-improvement cannot modify `.env`, `secrets`, or credential files |
| Audit trail | All self-improvement actions are logged with full context |

## Audit Logging

All security-relevant events are logged:

| Event | Log Level | Details |
|-------|-----------|---------|
| Webhook received | INFO | Event type, repo, signature valid/invalid |
| Webhook rejected | WARN | Source IP, reason, payload hash |
| Workflow dispatched | INFO | Issue, role, tier, runner |
| MCP tool called | INFO | Tool name, caller, params (redacted secrets) |
| PR merged | INFO | PR number, issue, approver |
| Self-improvement PR created | INFO | Issue, protected path flag |
| Auth token issued | INFO | User, scopes, expiry |
| Auth token rejected | WARN | User, reason |
| Budget threshold reached | WARN | Project, threshold (80%/90%/100%) |
| Runner registration | INFO | Runner name, labels, registration level |

Logs are written to stdout and collected via Docker logging driver. They can be forwarded to a log aggregation service (ELK, Loki, etc.) for analysis.

## Security Checklist

Before deploying to production:

- [ ] All services bind to internal Docker network only (not `0.0.0.0`)
- [ ] `.env` file has `0600` permissions
- [ ] All Gitea tokens are scoped to minimum required permissions
- [ ] Webhook HMAC secret is set and verified
- [ ] Branch protection is enabled on `main`
- [ ] Runner containers have resource limits
- [ ] HTTPS/TLS is configured on Nginx
- [ ] OAuth2 PKCE is enabled for mobile app
- [ ] Self-improvement protected paths are configured
- [ ] Audit logging is enabled and logs are being collected
- [ ] Rate limiting is configured on the Conductor API
- [ ] Default passwords have been changed (Gitea admin, PostgreSQL, Redis)
