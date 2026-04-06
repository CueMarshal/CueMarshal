# Deployment Guide

## Overview

The CueMarshal platform is deployed as a set of Docker containers managed by Docker Compose. This guide covers the full deployment lifecycle from initial setup to production operation.

## Prerequisites

### Hardware Requirements

| Deployment | CPU | Memory | Disk | Network |
|------------|-----|--------|------|---------|
| Minimum (dev) | 4 cores | 8 GB | 50 GB SSD | Broadband |
| Recommended | 8 cores | 16 GB | 100 GB SSD | Broadband |
| With Ollama (local LLM) | 8+ cores | 32 GB + GPU | 200 GB SSD | Broadband |

### Software Requirements

- Docker Engine 24+
- Docker Compose v2+
- Git 2.30+
- A domain name (for HTTPS and OAuth2 callbacks)
- At least one LLM API key for configured providers (Groq, Gemini, Azure AI)

## Initial Setup

### Step 1: Clone Repository

```bash
git clone <your-gitea-or-github-url>/cuemarshal/cuemarshal.git
cd cuemarshal
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# ═══════════════════════════════════════════
# Domain and URLs
# ═══════════════════════════════════════════
DOMAIN=cuemarshal.example.com
GITEA_URL=https://gitea.example.com
CONDUCTOR_URL=http://conductor:4000

# ═══════════════════════════════════════════
# LLM API Keys (at least one required)
# ═══════════════════════════════════════════
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIza...
GEMINI_API_KEY_2=AIza... # Optional extra Gemini key
GEMINI_API_KEY_3=AIza... # Optional extra Gemini key
AZURE_AI_API_KEY=...
AZURE_AI_API_BASE=https://<your-resource>.openai.azure.com

# ═══════════════════════════════════════════
# LiteLLM Gateway
# ═══════════════════════════════════════════
LITELLM_MASTER_KEY=sk-litellm-master-...
GATEWAY_API_KEY=sk-litellm-master-...

# ═══════════════════════════════════════════
# PostgreSQL
# ═══════════════════════════════════════════
POSTGRES_USER=cuemarshal
POSTGRES_PASSWORD=<generate-strong-password>
POSTGRES_DB=cuemarshal
DATABASE_URL=postgresql://cuemarshal:<password>@postgres:5432/cuemarshal

# ═══════════════════════════════════════════
# Redis
# ═══════════════════════════════════════════
REDIS_URL=redis://redis:6379

# ═══════════════════════════════════════════
# Gitea
# ═══════════════════════════════════════════
GITEA_ADMIN_USER=cuemarshal-admin
GITEA_ADMIN_PASSWORD=<generate-strong-password>
GITEA_ADMIN_EMAIL=admin@example.com
GITEA_ADMIN_TOKEN=<generated-after-setup>
GITEA_BOT_TOKEN=<generated-after-setup>

# ═══════════════════════════════════════════
# Conductor
# ═══════════════════════════════════════════
WEBHOOK_SECRET=<generate-random-string>
CONDUCTOR_SECRET=<generate-random-string>

# ═══════════════════════════════════════════
# Runners
# ═══════════════════════════════════════════
RUNNER_REGISTRATION_TOKEN=<obtained-from-gitea>

# ═══════════════════════════════════════════
# OAuth2 (Mobile App - public client with PKCE)
# ═══════════════════════════════════════════
OAUTH2_CLIENT_ID=<generated-in-gitea>

# ═══════════════════════════════════════════
# Self-Improvement
# ═══════════════════════════════════════════
SELF_IMPROVE_BUDGET_PCT=10
SELF_IMPROVE_MAX_PER_CYCLE=3

# ═══════════════════════════════════════════
# Optional: Ollama (local models)
# ═══════════════════════════════════════════
ENABLE_OLLAMA=false
OLLAMA_MODELS=deepseek-coder-v2
```

**IMPORTANT**: See `.env.example` for complete documentation. Run `./scripts/validate-env.sh --prod` before starting services.

### Step 2.5: Validate Configuration

Before starting services, validate your configuration:

```bash
./scripts/validate-env.sh --prod
```

See `CONFIGURATION.md` for source of truth documentation.

### Step 3: Start Infrastructure Services

Start the core services first:

```bash
docker compose up -d postgres redis
```

Wait for them to be healthy:

```bash
docker compose ps  # Both should show "healthy"
```

### Step 4: Start Gitea

```bash
docker compose up -d gitea
```

Wait for Gitea to be ready, then run the setup script:

```bash
# Wait for Gitea to start
until curl -sf http://localhost:3000/api/v1/version; do sleep 2; done

# Run initial setup
./scripts/setup.sh
```

The setup script:
1. Creates the admin user
2. Creates the `cuemarshal` organization
3. Creates the `cuemarshal` repository (this repo)
4. Generates API tokens (admin + bot)
5. Creates standard labels (`role:developer`, `role:reviewer`, `complexity:simple`, etc.)
6. Creates milestones
7. Configures webhooks pointing to the Conductor
8. Registers an OAuth2 application for the mobile app
9. Outputs tokens to add to `.env`

**Update `.env`** with the tokens output by the setup script.

### Step 5: Start LLM Gateway

```bash
docker compose up -d gateway
```

Verify:

```bash
curl http://localhost:4100/health
curl -H "Authorization: Bearer $LITELLM_MASTER_KEY" http://localhost:4100/v1/models
```

### Step 6: Start MCP Servers

```bash
docker compose up -d mcp-gitea mcp-conductor mcp-system
```

Verify:

```bash
curl http://localhost:4200/health
curl http://localhost:4201/health
curl http://localhost:4202/health
```

### Step 7: Start Conductor

```bash
docker compose up -d conductor
```

Verify:

```bash
curl http://localhost:4000/health
```

### Step 8: Start Runners

Get the runner registration token:

```bash
./scripts/register-runners.sh
```

Update `.env` with the `RUNNER_REGISTRATION_TOKEN`, then:

```bash
docker compose up -d runner-1 runner-2
```

Verify runners are registered in Gitea: Admin > Actions > Runners.

### Step 9: Start Nginx

```bash
docker compose up -d nginx
```

### Step 10: Verify Full System

```bash
# All services should be running
docker compose ps

# Run end-to-end health check
curl https://cuemarshal.example.com/api/health
```

## docker-compose.yml

```yaml
version: "3.8"

services:
  # ═══════════════════════════════════════
  # Infrastructure
  # ═══════════════════════════════════════
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infrastructure/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
      - ./infrastructure/redis/redis.conf:/usr/local/etc/redis/redis.conf
    command: ["redis-server", "/usr/local/etc/redis/redis.conf"]
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ═══════════════════════════════════════
  # Gitea (Source of Truth)
  # ═══════════════════════════════════════
  gitea:
    image: gitea/gitea:latest
    environment:
      - GITEA__database__DB_TYPE=postgres
      - GITEA__database__HOST=postgres:5432
      - GITEA__database__NAME=${POSTGRES_DB}
      - GITEA__database__USER=${POSTGRES_USER}
      - GITEA__database__PASSWD=${POSTGRES_PASSWORD}
    volumes:
      - gitea-data:/data
      - ./infrastructure/gitea/app.ini:/data/gitea/conf/app.ini
    ports:
      - "3000:3000"
      - "2222:22"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/v1/version"]
      interval: 15s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  # ═══════════════════════════════════════
  # LLM Gateway
  # ═══════════════════════════════════════
  gateway:
    build:
      context: ./services/gateway
    environment:
      - GROQ_API_KEY=${GROQ_API_KEY}
      - AZURE_AI_API_KEY=${AZURE_AI_API_KEY}
      - AZURE_AI_API_BASE=${AZURE_AI_API_BASE}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - GEMINI_API_KEY_2=${GEMINI_API_KEY_2}
      - GEMINI_API_KEY_3=${GEMINI_API_KEY_3}
      - LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/litellm
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4100/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ═══════════════════════════════════════
  # MCP Servers
  # ═══════════════════════════════════════
  mcp-gitea:
    build:
      context: ./services/mcp-servers
      dockerfile: gitea-mcp/Dockerfile
    environment:
      - MCP_TRANSPORT=http
      - PORT=4200
      - GITEA_URL=http://gitea:3000
      - GITEA_TOKEN=${GITEA_BOT_TOKEN}
    depends_on:
      gitea:
        condition: service_healthy
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4200/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  mcp-conductor:
    build:
      context: ./services/mcp-servers
      dockerfile: conductor-mcp/Dockerfile
    environment:
      - MCP_TRANSPORT=http
      - PORT=4201
      - CONDUCTOR_URL=http://conductor:4000
      - CONDUCTOR_SECRET=${CONDUCTOR_SECRET}
    depends_on:
      - conductor
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4201/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  mcp-system:
    build:
      context: ./services/mcp-servers
      dockerfile: system-mcp/Dockerfile
    environment:
      - MCP_TRANSPORT=http
      - PORT=4202
      - GATEWAY_URL=http://gateway:4100
      - GATEWAY_API_KEY=${LITELLM_MASTER_KEY}
      - REDIS_URL=${REDIS_URL}
      - CONDUCTOR_URL=http://conductor:4000
    depends_on:
      gateway:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4202/health"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ═══════════════════════════════════════
  # Conductor
  # ═══════════════════════════════════════
  conductor:
    build:
      context: ./services/conductor
    environment:
      - PORT=4000
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - GITEA_URL=http://gitea:3000
      - GITEA_TOKEN=${GITEA_BOT_TOKEN}
      - GATEWAY_URL=http://gateway:4100
      - GATEWAY_API_KEY=${GATEWAY_API_KEY}
      - MCP_GITEA_URL=http://mcp-gitea:4200
      - MCP_CONDUCTOR_URL=http://mcp-conductor:4201
      - MCP_SYSTEM_URL=http://mcp-system:4202
      - WEBHOOK_SECRET=${WEBHOOK_SECRET}
      - CONDUCTOR_SECRET=${CONDUCTOR_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      gitea:
        condition: service_healthy
      gateway:
        condition: service_healthy
    networks:
      - cuemarshal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  # ═══════════════════════════════════════
  # Runners
  # ═══════════════════════════════════════
  runner-1:
    build:
      context: .
      dockerfile: services/runner/Dockerfile
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
    depends_on:
      gitea:
        condition: service_healthy
      gateway:
        condition: service_healthy
      conductor:
        condition: service_healthy
    networks:
      - cuemarshal
    restart: unless-stopped

  runner-2:
    build:
      context: .
      dockerfile: services/runner/Dockerfile
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
    depends_on:
      gitea:
        condition: service_healthy
    networks:
      - cuemarshal
    restart: unless-stopped

  # ═══════════════════════════════════════
  # Nginx (Reverse Proxy)
  # ═══════════════════════════════════════
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf
      - nginx-certs:/etc/nginx/certs
    depends_on:
      - gitea
      - conductor
    networks:
      - cuemarshal
    restart: unless-stopped

  # ═══════════════════════════════════════
  # Optional: Ollama (Local Models)
  # ═══════════════════════════════════════
  ollama:
    image: ollama/ollama:latest
    profiles: ["ollama"]
    volumes:
      - ollama-data:/root/.ollama
    networks:
      - cuemarshal
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped

networks:
    cuemarshal:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
  gitea-data:
  runner-1-data:
  runner-2-data:
  nginx-certs:
  ollama-data:
```

## Infrastructure Configuration Files

### infrastructure/gitea/app.ini

```ini
[server]
DOMAIN = gitea.example.com
ROOT_URL = https://gitea.example.com/
HTTP_PORT = 3000
SSH_PORT = 22
LFS_START_SERVER = true

[database]
DB_TYPE = postgres
HOST = postgres:5432
NAME = cuemarshal
USER = cuemarshal

[service]
DISABLE_REGISTRATION = true
REQUIRE_SIGNIN_VIEW = false
ENABLE_NOTIFY_MAIL = false

[actions]
ENABLED = true
DEFAULT_ACTIONS_URL = https://github.com

[webhook]
ALLOWED_HOST_LIST = conductor
DELIVER_TIMEOUT = 30

[oauth2]
ENABLED = true

[log]
MODE = console
LEVEL = info
```

### infrastructure/postgres/init.sql

```sql
-- Create separate database for Conductor if needed
-- (Gitea and Conductor can share the same database with different schemas)
CREATE SCHEMA IF NOT EXISTS conductor;
```

### infrastructure/nginx/nginx.conf

```nginx
events {
    worker_connections 1024;
}

http {
    upstream gitea {
        server gitea:3000;
    }

    upstream conductor {
        server conductor:4000;
    }

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    # Main HTTPS server
    server {
        listen 443 ssl;
        server_name cuemarshal.example.com;

        ssl_certificate /etc/nginx/certs/fullchain.pem;
        ssl_certificate_key /etc/nginx/certs/privkey.pem;

        # Gitea
        location / {
            proxy_pass http://gitea;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Conductor API
        location /api/ {
            proxy_pass http://conductor/api/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Conductor WebSocket
        location /ws {
            proxy_pass http://conductor/ws;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_read_timeout 86400;
        }

        # Webhooks
        location /webhooks/ {
            proxy_pass http://conductor/webhooks/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

## Operations

### Scaling Runners

```bash
# Add more runners
docker compose up -d --scale runner=4

# Or add named runners in docker-compose.yml for different specializations
```

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f conductor

# Last 100 lines
docker compose logs --tail 100 gateway
```

### Backup

```bash
# Database
docker compose exec postgres pg_dump -U cuemarshal cuemarshal > backup.sql

# Gitea data
docker compose exec gitea bash -c "gitea dump -c /data/gitea/conf/app.ini"

# Volumes
docker run --rm -v cuemarshal_gitea-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/gitea-data.tar.gz /data
```

### Updating

```bash
# Pull latest images
docker compose pull

# Rebuild custom images
docker compose build

# Restart with new images
docker compose up -d

# Run database migrations
docker compose exec conductor npm run migrate
```

## Monitoring

### Health Endpoints

| Service | Endpoint | Expected |
|---------|----------|----------|
| Gitea | `GET /api/v1/version` | `{"version": "..."}` |
| Conductor | `GET /health` | `{"status": "healthy"}` |
| Gateway | `GET /health` | `{"status": "healthy"}` |
| MCP Gitea | `GET /health` | `{"status": "healthy"}` |
| MCP Conductor | `GET /health` | `{"status": "healthy"}` |
| MCP System | `GET /health` | `{"status": "healthy"}` |

### Recommended Monitoring Stack

For production deployments, add:
- **Prometheus**: Metrics collection (scrape `/metrics` endpoints)
- **Grafana**: Dashboard and alerting
- **Loki**: Log aggregation
- **Alertmanager**: Alert routing (budget thresholds, service down, workflow failures)

These can be added as additional Docker Compose services or run externally.
