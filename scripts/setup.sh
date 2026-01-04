#!/bin/bash
set -euo pipefail

echo "=================================================="
echo "  CueMarshal Platform Setup"
echo "=================================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "ERROR: Docker Compose is not installed"
    exit 1
fi

echo "Docker and Docker Compose are installed"
echo ""

if [ ! -f .env ]; then
    echo "ERROR: .env file not found"
    echo ""
    echo "Create .env from .env.example and configure:"
    echo "  cp .env.example .env"
    echo ""
    echo "Required variables:"
    echo "  - ANTHROPIC_API_KEY or OPENAI_API_KEY (at least one)"
    echo "  - POSTGRES_PASSWORD"
    echo "  - GITEA_ADMIN_PASSWORD"
    echo "  - LITELLM_MASTER_KEY"
    echo "  - WEBHOOK_SECRET"
    echo "  - CONDUCTOR_SECRET"
    echo ""
    exit 1
fi

echo ".env file found"

source .env

REQUIRED_VARS=("POSTGRES_PASSWORD" "LITELLM_MASTER_KEY" "WEBHOOK_SECRET" "CONDUCTOR_SECRET" "GITEA_ADMIN_PASSWORD")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
    MISSING_VARS+=("ANTHROPIC_API_KEY or OPENAI_API_KEY")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "ERROR: Missing required environment variables:"
    printf '  - %s\n' "${MISSING_VARS[@]}"
    exit 1
fi

echo "All required environment variables are set"
echo ""

echo "Starting all services..."
docker compose up -d

echo ""
echo "Waiting for init-gitea to complete..."
docker compose logs -f init-gitea 2>/dev/null || true

echo ""
echo "Checking service health..."
sleep 5

SERVICES=("postgres" "redis" "gitea" "gateway" "conductor")
for svc in "${SERVICES[@]}"; do
    STATUS=$(docker compose ps --format json "$svc" 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || echo "")
    if echo "$STATUS" | grep -q "healthy"; then
        echo "  ${svc}: healthy"
    else
        echo "  ${svc}: starting (may take a moment)"
    fi
done

echo ""
echo "=================================================="
echo "  Setup Complete!"
echo "=================================================="
echo ""
echo "Services:"
echo "  Gitea:     http://localhost:3000"
echo "  Conductor: http://localhost (port 80)"
echo "  Gateway:   http://localhost (port 80)"
echo "  Nginx:     http://localhost:80"
echo ""
echo "Generated tokens are in the gitea-tokens volume."
echo "View with: docker compose exec conductor cat /tokens/bot_token"
echo ""
echo "Verify all services:"
echo "  docker compose ps"
echo ""
