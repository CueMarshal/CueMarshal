#!/usr/bin/env bash
set -e

# CueMarshal Quick Start
# Sets up everything from scratch — secrets, env, services, health checks.

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}CueMarshal Quick Start${RESET}"
echo "────────────────────────────────────"

# ── Check Docker ──────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo -e "${RED}✗ Docker not found.${RESET} Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo -e "${RED}✗ Docker Compose v2 not found.${RESET} Install it from https://docs.docker.com/compose/install/"
  exit 1
fi

echo -e "${GREEN}✓ Docker found${RESET}"

# ── Check RAM ─────────────────────────────────────────────────────────────────
TOTAL_RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo "0")
if [ "$TOTAL_RAM_GB" -lt 7 ]; then
  echo -e "${YELLOW}⚠ Warning: Less than 8 GB RAM detected (${TOTAL_RAM_GB} GB). Performance may be degraded.${RESET}"
fi

# ── Create .env if missing ────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ ! -f ".env.example" ]; then
    echo -e "${RED}✗ .env.example not found. Are you in the cuemarshal directory?${RESET}"
    exit 1
  fi

  echo "Creating .env from .env.example..."
  cp .env.example .env

  # Generate secrets automatically
  generate_secret() {
    openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n'
  }

  # Replace placeholder secrets with real ones
  GITEA_ADMIN_PASSWORD=$(generate_secret | cut -c1-16)
  GITEA_SECRET_KEY=$(generate_secret)
  GITEA_INTERNAL_TOKEN=$(generate_secret)
  POSTGRES_PASSWORD=$(generate_secret)
  REDIS_PASSWORD=$(generate_secret)
  CONDUCTOR_SECRET=$(generate_secret)

  # Use sed to fill in secrets (works on both Linux and macOS)
  sed -i.bak \
    -e "s|^GITEA_ADMIN_PASSWORD=.*|GITEA_ADMIN_PASSWORD=${GITEA_ADMIN_PASSWORD}|" \
    -e "s|^GITEA_SECRET_KEY=.*|GITEA_SECRET_KEY=${GITEA_SECRET_KEY}|" \
    -e "s|^GITEA_INTERNAL_TOKEN=.*|GITEA_INTERNAL_TOKEN=${GITEA_INTERNAL_TOKEN}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" \
    -e "s|^CONDUCTOR_SECRET=.*|CONDUCTOR_SECRET=${CONDUCTOR_SECRET}|" \
    .env
  rm -f .env.bak

  echo -e "${GREEN}✓ .env created with auto-generated secrets${RESET}"
  echo ""
  echo -e "${YELLOW}Important: Add your LLM API keys to .env before continuing:${RESET}"
  echo "  GROQ_API_KEY     → https://console.groq.com (free)"
  echo "  GEMINI_API_KEY   → https://aistudio.google.com (free)"
  echo "  AZURE_AI_API_KEY → https://azure.microsoft.com (paid, optional)"
  echo ""

  # Check if at least one key is set
  if grep -qE "^GROQ_API_KEY=.+" .env || grep -qE "^GEMINI_API_KEY=.+" .env; then
    echo -e "${GREEN}✓ LLM API key detected${RESET}"
  else
    read -p "Press Enter after adding your API keys to .env, or Ctrl+C to cancel..."
  fi
else
  echo -e "${GREEN}✓ .env found${RESET}"
fi

# ── Pull images ───────────────────────────────────────────────────────────────
echo ""
echo "Pulling Docker images (this may take a few minutes on first run)..."
docker compose pull --quiet 2>/dev/null || true

# ── Start services ────────────────────────────────────────────────────────────
echo ""
echo "Starting services..."
docker compose up -d

# ── Wait for Gitea init ───────────────────────────────────────────────────────
echo ""
echo "Waiting for Gitea to initialize (~60 seconds)..."

TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  STATUS=$(docker inspect --format='{{.State.Status}}' cuemarshal-init-gitea 2>/dev/null || echo "not_found")
  EXIT_CODE=$(docker inspect --format='{{.State.ExitCode}}' cuemarshal-init-gitea 2>/dev/null || echo "1")

  if [ "$STATUS" = "exited" ] && [ "$EXIT_CODE" = "0" ]; then
    echo -e "${GREEN}✓ Gitea initialized${RESET}"
    break
  elif [ "$STATUS" = "exited" ] && [ "$EXIT_CODE" != "0" ]; then
    echo -e "${RED}✗ Gitea init failed. Check logs:${RESET}"
    echo "  docker logs cuemarshal-init-gitea"
    exit 1
  fi

  printf "."
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
  echo -e "\n${YELLOW}⚠ Timed out waiting for init-gitea. Services may still be starting.${RESET}"
fi

# ── Health check ──────────────────────────────────────────────────────────────
echo ""
echo "Checking service health..."

check_service() {
  local name=$1
  local url=$2
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "200" ] || [ "$status" = "302" ] || [ "$status" = "301" ]; then
    echo -e "  ${GREEN}✓ ${name}${RESET}"
  else
    echo -e "  ${YELLOW}⚠ ${name} (HTTP ${status} — may still be starting)${RESET}"
  fi
}

sleep 5
check_service "Gitea UI" "http://localhost:3300"
check_service "Conductor" "http://localhost:8180/conductor/health"
check_service "Nginx proxy" "http://localhost:8180"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}CueMarshal is ready!${RESET}"
echo "────────────────────────────────────"

ADMIN_PASSWORD=$(grep "^GITEA_ADMIN_PASSWORD=" .env | cut -d'=' -f2)

echo ""
echo "  Gitea UI:  http://localhost:3300"
echo "  Username:  cuemarshal-admin"
echo "  Password:  ${ADMIN_PASSWORD}"
echo ""
echo "  Conductor: http://localhost:8180/conductor/health"
echo "  Nginx:     http://localhost:8180"
echo ""
echo "Next steps:"
echo "  1. Log in to Gitea at http://localhost:3300"
echo "  2. Create an issue in the cuemarshal-org/default-project repo"
echo "  3. Watch the Conductor pick it up and assign agents"
echo ""
echo "Docs: https://github.com/cuemarshal/cuemarshal/tree/main/docs"
echo ""

# Try to open browser
if command -v open &>/dev/null; then
  open "http://localhost:3300"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3300" &>/dev/null &
fi
