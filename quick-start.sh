#!/usr/bin/env bash
set -euo pipefail

# CueMarshal Quick Start
# Sets up everything from scratch — secrets, env, services, health checks.

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}CueMarshal Quick Start${RESET}"
echo "────────────────────────────────────"

GITEA_ROOT_URL="http://localhost:3300/"
GITEA_URL="http://localhost:3300"
GITEA_DOMAIN="localhost"
GITEA_SSH_DOMAIN="localhost"
GITEA_SSH_PORT="2223"
CUEMARSHAL_PUBLIC_URL="http://localhost:8180"
CONDUCTOR_URL="${CUEMARSHAL_PUBLIC_URL}/api"
NGINX_HEALTH_URL="${CUEMARSHAL_PUBLIC_URL}/health"
OLLAMA_BASE_URL="http://host.docker.internal:11434"

env_value() {
  if [ ! -f ".env" ]; then
    return 0
  fi

  grep -E "^$1=" .env | tail -n 1 | cut -d'=' -f2-
}

load_runtime_config() {
  local root_url
  local domain
  local ssh_domain
  local ssh_port
  local public_url
  local ollama_base_url

  root_url=$(env_value "GITEA_ROOT_URL")
  if [ -n "${root_url}" ]; then
    GITEA_ROOT_URL="${root_url}"
  fi
  GITEA_URL="${GITEA_ROOT_URL%/}"

  domain=$(env_value "GITEA_DOMAIN")
  if [ -n "${domain}" ]; then
    GITEA_DOMAIN="${domain}"
  fi

  ssh_domain=$(env_value "GITEA_SSH_DOMAIN")
  if [ -n "${ssh_domain}" ]; then
    GITEA_SSH_DOMAIN="${ssh_domain}"
  else
    GITEA_SSH_DOMAIN="${GITEA_DOMAIN}"
  fi

  ssh_port=$(env_value "GITEA_SSH_PORT")
  if [ -n "${ssh_port}" ]; then
    GITEA_SSH_PORT="${ssh_port}"
  fi

  public_url=$(env_value "CUEMARSHAL_PUBLIC_URL")
  if [ -n "${public_url}" ]; then
    CUEMARSHAL_PUBLIC_URL="${public_url%/}"
  fi
  CONDUCTOR_URL="${CUEMARSHAL_PUBLIC_URL}/api"
  NGINX_HEALTH_URL="${CUEMARSHAL_PUBLIC_URL}/health"

  ollama_base_url=$(env_value "OLLAMA_BASE_URL")
  if [ -n "${ollama_base_url}" ]; then
    OLLAMA_BASE_URL="${ollama_base_url}"
  fi
}

host_ollama_url() {
  printf '%s' "${OLLAMA_BASE_URL}" | sed 's|host\.docker\.internal|localhost|g'
}

show_service_logs() {
  local service=$1
  echo ""
  echo -e "${YELLOW}Recent logs for ${service}:${RESET}"
  docker compose logs --no-color --tail=80 "${service}" || true
}

container_id_for() {
  docker compose ps -a -q "$1" 2>/dev/null || true
}

container_state() {
  docker inspect --format='{{.State.Status}}' "$1" 2>/dev/null || echo "unknown"
}

container_health() {
  docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$1" 2>/dev/null || echo "unknown"
}

wait_for_service_health() {
  local service=$1
  local name=$2
  local timeout=$3
  local elapsed=0
  local container_id state health

  while [ "${elapsed}" -lt "${timeout}" ]; do
    container_id=$(container_id_for "${service}")
    if [ -n "${container_id}" ]; then
      state=$(container_state "${container_id}")
      health=$(container_health "${container_id}")

      if [ "${state}" = "running" ] && { [ "${health}" = "healthy" ] || [ "${health}" = "none" ]; }; then
        echo -e "${GREEN}✓ ${name} is healthy${RESET}"
        return 0
      fi

      if [ "${state}" = "exited" ] || [ "${state}" = "dead" ] || [ "${health}" = "unhealthy" ]; then
        echo -e "${RED}✗ ${name} failed to start (state=${state}, health=${health})${RESET}"
        show_service_logs "${service}"
        exit 1
      fi
    fi

    printf "."
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo -e "\n${RED}✗ Timed out waiting for ${name}${RESET}"
  show_service_logs "${service}"
  exit 1
}

wait_for_init_job() {
  local service=$1
  local name=$2
  local timeout=$3
  local elapsed=0
  local container_id state exit_code

  while [ "${elapsed}" -lt "${timeout}" ]; do
    container_id=$(container_id_for "${service}")
    if [ -n "${container_id}" ]; then
      state=$(container_state "${container_id}")
      exit_code=$(docker inspect --format='{{.State.ExitCode}}' "${container_id}" 2>/dev/null || echo "1")

      if [ "${state}" = "exited" ] && [ "${exit_code}" = "0" ]; then
        echo -e "${GREEN}✓ ${name} completed${RESET}"
        return 0
      fi

      if [ "${state}" = "exited" ] && [ "${exit_code}" != "0" ]; then
        echo -e "${RED}✗ ${name} failed${RESET}"
        show_service_logs "${service}"
        exit 1
      fi
    fi

    printf "."
    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo -e "\n${RED}✗ Timed out waiting for ${name}${RESET}"
  show_service_logs "${service}"
  exit 1
}

check_container_service() {
  local service=$1
  local name=$2
  local container_id state health

  container_id=$(container_id_for "${service}")
  if [ -z "${container_id}" ]; then
    echo -e "  ${YELLOW}⚠ ${name} (container not created)${RESET}"
    return
  fi

  state=$(container_state "${container_id}")
  health=$(container_health "${container_id}")

  if [ "${state}" = "running" ] && { [ "${health}" = "healthy" ] || [ "${health}" = "none" ]; }; then
    echo -e "  ${GREEN}✓ ${name}${RESET}"
  else
    echo -e "  ${YELLOW}⚠ ${name} (state=${state}, health=${health})${RESET}"
  fi
}

repair_gitea_volume() {
  local volume_name="cuemarshal-gitea-data"
  local repair_result

  if ! docker volume inspect "${volume_name}" >/dev/null 2>&1; then
    return 0
  fi

  repair_result=$(docker run --rm --entrypoint /bin/sh \
    -e GITEA_DOMAIN="${GITEA_DOMAIN}" \
    -e GITEA_ROOT_URL="${GITEA_ROOT_URL}" \
    -e GITEA_SSH_DOMAIN="${GITEA_SSH_DOMAIN}" \
    -e GITEA_SSH_PORT="${GITEA_SSH_PORT}" \
    -v "${volume_name}:/data" \
    gitea/gitea:1.25 \
    -eu -c '
      APP_INI=/data/gitea/conf/app.ini
      [ -f "$APP_INI" ] || exit 0

      escape() {
        printf "%s" "$1" | sed "s/[\/&]/\\\\&/g"
      }

      repaired=0
      current_domain=$(sed -n "s/^DOMAIN = //p" "$APP_INI" | head -n 1)
      current_root_url=$(sed -n "s/^ROOT_URL = //p" "$APP_INI" | head -n 1)
      current_ssh_domain=$(sed -n "s/^SSH_DOMAIN = //p" "$APP_INI" | head -n 1)
      current_ssh_port=$(sed -n "s/^SSH_PORT = //p" "$APP_INI" | head -n 1)

      if [ "$current_domain" != "$GITEA_DOMAIN" ]; then
        sed -i "s|^DOMAIN = .*|DOMAIN = $(escape "$GITEA_DOMAIN")|" "$APP_INI"
        repaired=1
      fi

      if [ "$current_root_url" != "$GITEA_ROOT_URL" ]; then
        sed -i "s|^ROOT_URL = .*|ROOT_URL = $(escape "$GITEA_ROOT_URL")|" "$APP_INI"
        repaired=1
      fi

      if [ "$current_ssh_domain" != "$GITEA_SSH_DOMAIN" ]; then
        sed -i "s|^SSH_DOMAIN = .*|SSH_DOMAIN = $(escape "$GITEA_SSH_DOMAIN")|" "$APP_INI"
        repaired=1
      fi

      if [ "$current_ssh_port" != "$GITEA_SSH_PORT" ]; then
        sed -i "s|^SSH_PORT = .*|SSH_PORT = $(escape "$GITEA_SSH_PORT")|" "$APP_INI"
        repaired=1
      fi

      if [ "$repaired" -eq 1 ]; then
        echo repaired
      fi
    ')

  if [ "${repair_result}" = "repaired" ]; then
    echo -e "${GREEN}✓ Repaired persisted Gitea config${RESET}"
  fi
}

ensure_llm_provider() {
  if grep -qE "^GROQ_API_KEY=.+" .env || grep -qE "^GEMINI_API_KEY=.+" .env || grep -qE "^AZURE_AI_API_KEY=.+" .env; then
    echo -e "${GREEN}✓ Cloud LLM provider detected${RESET}"
  elif curl -sf "$(host_ollama_url)/api/tags" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Local Ollama detected${RESET}"
  else
    echo ""
    echo -e "${YELLOW}Important: Configure at least one cloud LLM API key or start local Ollama before continuing:${RESET}"
    echo "  GROQ_API_KEY     → https://console.groq.com (free)"
    echo "  GEMINI_API_KEY   → https://aistudio.google.com (free)"
    echo "  AZURE_AI_API_KEY → https://azure.microsoft.com (paid, optional)"
    echo "  OLLAMA_BASE_URL  → ${OLLAMA_BASE_URL} (default local Ollama)"
    echo ""
    read -p "Press Enter after updating .env or starting Ollama, or Ctrl+C to cancel..."
  fi
}

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
  POSTGRES_PASSWORD=$(generate_secret)
  REDIS_PASSWORD=$(generate_secret)
  WEBHOOK_SECRET=$(generate_secret)
  CONDUCTOR_SECRET=$(generate_secret)
  LITELLM_MASTER_KEY=$(generate_secret)

  # Use sed to fill in secrets (works on both Linux and macOS)
  sed -i.bak \
    -e "s|^GITEA_ADMIN_PASSWORD=.*|GITEA_ADMIN_PASSWORD=${GITEA_ADMIN_PASSWORD}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" \
    -e "s|^WEBHOOK_SECRET=.*|WEBHOOK_SECRET=${WEBHOOK_SECRET}|" \
    -e "s|^CONDUCTOR_SECRET=.*|CONDUCTOR_SECRET=${CONDUCTOR_SECRET}|" \
    -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=${LITELLM_MASTER_KEY}|" \
    .env
  rm -f .env.bak

  echo -e "${GREEN}✓ .env created with auto-generated secrets${RESET}"
else
  echo -e "${GREEN}✓ .env found${RESET}"
fi

load_runtime_config
ensure_llm_provider

# ── Pull images ───────────────────────────────────────────────────────────────
echo ""
echo "Pulling Docker images (this may take a few minutes on first run)..."
docker compose pull --quiet 2>/dev/null || true
repair_gitea_volume

# ── Start services ────────────────────────────────────────────────────────────
echo ""
echo "Starting services..."
docker compose rm -sf init-gitea >/dev/null 2>&1 || true
docker compose up -d

# ── Wait for Gitea init ───────────────────────────────────────────────────────
echo ""
echo "Waiting for database bootstrap to finish..."
wait_for_init_job "init-postgres" "init-postgres" 120

echo ""
echo "Waiting for Gitea to become healthy..."
wait_for_service_health "gitea" "Gitea" 120

echo ""
echo "Waiting for init-gitea to finish..."
wait_for_init_job "init-gitea" "init-gitea" 600

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
check_service "Gitea API" "${GITEA_URL}/api/v1/version"
check_container_service "gateway" "LiteLLM Gateway"
check_container_service "conductor" "Conductor"
check_service "Nginx proxy" "${NGINX_HEALTH_URL}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}CueMarshal is ready!${RESET}"
echo "────────────────────────────────────"

ADMIN_PASSWORD=$(grep "^GITEA_ADMIN_PASSWORD=" .env | cut -d'=' -f2)

echo ""
echo "  Gitea UI:  ${GITEA_URL}"
echo "  Username:  cuemarshal-admin"
echo "  Password:  ${ADMIN_PASSWORD}"
echo ""
echo "  Conductor: ${CONDUCTOR_URL}"
echo "  Nginx:     ${CUEMARSHAL_PUBLIC_URL}"
echo ""
echo "Next steps:"
echo "  1. Log in to Gitea at ${GITEA_URL}"
echo "  2. Create an issue in the cuemarshal-org/default-project repo"
echo "  3. Watch the Conductor pick it up and assign agents"
echo ""
echo "Docs: https://github.com/cuemarshal/cuemarshal/tree/main/docs"
echo ""

# Try to open browser
if command -v open &>/dev/null; then
  open "${GITEA_URL}"
elif command -v xdg-open &>/dev/null; then
  xdg-open "${GITEA_URL}" &>/dev/null &
fi
