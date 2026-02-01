# Custom Gitea Runner

## Overview

The CueMarshal platform uses custom Gitea Act Runners that extend the base runner with OpenCode CLI, MCP server binaries, and pre-configured agent profiles. These runners are the execution environment where AI agents do their work.

## Architecture

```
┌─────────────────────────────────────────────┐
│           Custom Runner Container           │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │        Gitea Act Runner Daemon        │  │
│  │  (polls Gitea for workflow jobs)      │  │
│  └───────────────┬───────────────────────┘  │
│                  │                          │
│  ┌───────────────▼───────────────────────┐  │
│  │         Workflow Job Container         │  │
│  │                                       │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │          OpenCode CLI           │  │  │
│  │  │  (headless mode: opencode run)  │  │  │
│  │  └──────────┬──────────────────────┘  │  │
│  │             │                         │  │
│  │  ┌──────────▼──────────────────────┐  │  │
│  │  │     MCP Servers (stdio)         │  │  │
│  │  │  ├── gitea-mcp                  │  │  │
│  │  │  ├── conductor-mcp             │  │  │
│  │  │  └── system-mcp                │  │  │
│  │  └─────────────────────────────────┘  │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Pre-installed:                              │
│  ├── /agents/          (agent profiles)     │
│  ├── /mcp-servers/     (MCP binaries)       │
│  └── /usr/local/bin/opencode                │
└─────────────────────────────────────────────┘
```

## Dockerfile

```dockerfile
# ═══════════════════════════════════════════
# Stage 1: Build MCP servers
# ═══════════════════════════════════════════
FROM node:25-alpine AS mcp-builder

WORKDIR /build
COPY services/mcp-servers/package.json services/mcp-servers/tsconfig.json ./
COPY services/mcp-servers/shared ./shared
COPY services/mcp-servers/gitea-mcp ./gitea-mcp
COPY services/mcp-servers/conductor-mcp ./conductor-mcp
COPY services/mcp-servers/system-mcp ./system-mcp
RUN npm install && npm run build -w shared && npm run build

# ═══════════════════════════════════════════
# Stage 2: Runner image
# ═══════════════════════════════════════════
FROM gitea/act_runner:latest

USER root
RUN apk add --no-cache curl git jq ca-certificates gnupg wget bash ripgrep nodejs npm

# Install OpenCode CLI v1.1.53 (non-interactive support)
ARG OPENCODE_VERSION=v1.1.53
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      OPENCODE_TARGET="linux-arm64-musl"; \
    else \
      OPENCODE_TARGET="linux-x64-musl"; \
    fi && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/download/${OPENCODE_VERSION}/opencode-${OPENCODE_TARGET}.tar.gz" -o /tmp/opencode.tar.gz && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/opencode && \
    rm -f /tmp/opencode.tar.gz

# Copy MCP server builds
COPY --from=mcp-builder /build/gitea-mcp/dist /mcp-servers/gitea-mcp/dist
COPY --from=mcp-builder /build/conductor-mcp/dist /mcp-servers/conductor-mcp/dist
COPY --from=mcp-builder /build/system-mcp/dist /mcp-servers/system-mcp/dist
COPY --from=mcp-builder /build/shared/package.json /mcp-servers/shared/package.json
COPY --from=mcp-builder /build/shared/dist /mcp-servers/shared/dist
COPY --from=mcp-builder /build/node_modules /mcp-servers/node_modules

# Copy agent profiles
COPY services/agents/shared /agents/shared
COPY services/agents/architect /agents/architect
COPY services/agents/developer /agents/developer
COPY services/agents/reviewer /agents/reviewer
COPY services/agents/tester /agents/tester
COPY services/agents/devops /agents/devops
COPY services/agents/docs /agents/docs
COPY services/agents/linter /agents/linter

# Copy runner config, gateway proxy, and entrypoint
COPY services/runner/config.yaml /config.yaml
COPY services/runner/gateway-proxy.js /gateway-proxy.js
COPY services/runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV GITEA_URL="" \
    GITEA_TOKEN="" \
    CONDUCTOR_URL="" \
    OPENAI_API_KEY="" \
    HOME=/data

RUN mkdir -p /data && chown -R 1000:1000 /data /mcp-servers /agents
USER 1000:1000
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
```

## Entrypoint Script

```bash
#!/bin/bash
set -euo pipefail

RUNNER_NAME="${RUNNER_NAME:-cuemarshal-runner-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,opencode}"
GITEA_INSTANCE="${GITEA_URL:-http://gitea:3000}"

# Wait for Gitea
until curl -sf "${GITEA_INSTANCE}/api/v1/version" > /dev/null 2>&1; do
  sleep 2
done

# Register runner (token from env or /tokens/runner_token)
if [ ! -f /data/.runner ]; then
  REGISTRATION_TOKEN="${GITEA_RUNNER_REGISTRATION_TOKEN:-}"
  if [ -z "${REGISTRATION_TOKEN}" ] && [ -f /tokens/runner_token ]; then
    REGISTRATION_TOKEN=$(cat /tokens/runner_token | tr -d '\r\n')
  fi
  act_runner register \
    --config /config.yaml \
    --instance "${GITEA_INSTANCE}" \
    --token "${REGISTRATION_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --no-interactive
fi

# Start local gateway auth proxy for LiteLLM
GATEWAY_TARGET="gateway:4100" OPENAI_API_KEY="${OPENAI_API_KEY}" PROXY_PORT=4101 \
  node /gateway-proxy.js &
export OPENAI_BASE_URL="http://127.0.0.1:4101/v1"

# Start runner daemon
exec act_runner daemon --config /config.yaml
```

## Runner Configuration

### config.yaml

The Act Runner configuration file. Generated with `act_runner generate-config` and customized.

```yaml
# Log configuration
log:
  level: info

# Runner configuration
runner:
  file: /data/.runner
  capacity: 1
  timeout: 2h
  shutdown_timeout: 30s
  labels: []

# Container configuration (Docker-in-Docker)
container:
  network: "bridge"
  privileged: false
  workdir_parent: /workspace

# Host configuration
host:
  workdir_parent: /workspace
```

## Docker Compose Configuration

```yaml
# In docker-compose.yml
services:
  runner-1:
    build:
      context: .
      dockerfile: services/runner/Dockerfile
    depends_on:
      gitea:
        condition: service_healthy
      gateway:
        condition: service_healthy
      conductor:
        condition: service_healthy
    environment:
      - GITEA_URL=http://gitea:3000
      - GITEA_TOKEN=${GITEA_BOT_TOKEN}
      - GITEA_RUNNER_REGISTRATION_TOKEN=${RUNNER_REGISTRATION_TOKEN}
      - RUNNER_NAME=cuemarshal-runner-1
      - RUNNER_LABELS=self-hosted,opencode
      - OPENAI_API_KEY=${GATEWAY_API_KEY}
      - CONDUCTOR_URL=http://conductor:4000
    volumes:
      - runner-1-data:/data
      - /var/run/docker.sock:/var/run/docker.sock  # If using container mode
    networks:
      - cuemarshal
    restart: unless-stopped

  runner-2:
    build:
      context: .
      dockerfile: services/runner/Dockerfile
    depends_on:
      gitea:
        condition: service_healthy
    environment:
      - GITEA_URL=http://gitea:3000
      - GITEA_TOKEN=${GITEA_BOT_TOKEN}
      - GITEA_RUNNER_REGISTRATION_TOKEN=${RUNNER_REGISTRATION_TOKEN}
      - RUNNER_NAME=cuemarshal-runner-2
      - RUNNER_LABELS=self-hosted,opencode
      - OPENAI_API_KEY=${GATEWAY_API_KEY}
      - CONDUCTOR_URL=http://conductor:4000
    volumes:
      - runner-2-data:/data
    networks:
      - cuemarshal
    restart: unless-stopped
```

## Scaling Runners

### Horizontal Scaling

Add more runner instances in `docker-compose.yml` or use Docker Compose's `--scale` flag:

```bash
docker compose up -d --scale runner=4
```

Each runner is independent and stateless. They register with Gitea and poll for jobs independently.

### Runner Specialization

Runners can be specialized by labels and capacity:

| Runner Type | Labels | Capacity | Use Case |
|-------------|--------|----------|----------|
| General | `self-hosted, opencode` | 1 | Standard task execution |
| Heavy | `self-hosted, opencode, heavy` | 1 | Architecture, large refactoring |
| Light | `self-hosted, lightweight` | 3 | Idle checks, simple API calls |
| Review | `self-hosted, opencode, reviewer` | 2 | Dedicated review runners |

### Resource Requirements

| Runner Type | CPU | Memory | Disk |
|-------------|-----|--------|------|
| General | 2 cores | 4 GB | 10 GB |
| Heavy | 4 cores | 8 GB | 20 GB |
| Light | 1 core | 1 GB | 5 GB |

## Registration Script

### scripts/register-runners.sh

```bash
#!/bin/bash
set -euo pipefail

# Register runners with Gitea
# Usage: ./scripts/register-runners.sh

source .env

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
ADMIN_TOKEN="${GITEA_ADMIN_TOKEN}"

echo "Fetching runner registration token..."

# Get registration token from Gitea admin API
TOKEN_RESPONSE=$(curl -sf -X GET \
  -H "Authorization: token ${ADMIN_TOKEN}" \
  "${GITEA_URL}/api/v1/admin/runners/registration-token")

REG_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')

echo "Registration token: ${REG_TOKEN}"
echo "Set RUNNER_REGISTRATION_TOKEN=${REG_TOKEN} in your .env file"
echo ""
echo "Then start runners with: docker compose up -d runner-1 runner-2"
```

## Troubleshooting

### Runner not picking up jobs

1. Check runner registration: `docker compose logs runner-1 | grep "register"`
2. Verify labels match workflow `runs-on`: `docker compose exec runner-1 act_runner list`
3. Check Gitea runner status: Gitea Admin > Actions > Runners

### OpenCode not connecting to gateway

1. Verify gateway is healthy: `curl http://gateway:4100/health` from inside the container
2. Check auth configuration: `docker compose exec runner-1 cat ~/.local/share/opencode/auth.json`
3. Verify API key: `docker compose exec runner-1 curl -H "Authorization: Bearer $OPENAI_API_KEY" http://gateway:4100/v1/models`

### MCP servers failing in OpenCode

1. Check MCP binaries exist: `docker compose exec runner-1 ls /mcp-servers/`
2. Test MCP server directly: `docker compose exec runner-1 echo '{}' | node /mcp-servers/gitea-mcp/dist/index.js`
3. Check environment variables: `docker compose exec runner-1 env | grep GITEA`
