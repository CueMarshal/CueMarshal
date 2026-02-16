#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SonarQube One-Time Initialization
# ═══════════════════════════════════════════════════════════════
# Run this after first boot to:
#   1. Change the default admin password
#   2. Generate an API token for scanner authentication
#   3. Create the project matching the Gitea repository
#
# Usage:
#   docker compose run --rm -v ./infrastructure/sonarqube:/scripts \
#     -e SONAR_ADMIN_PASSWORD=<password> \
#     --entrypoint bash sonarqube /scripts/init-sonar.sh
#
#   Or from the host (after SonarQube is healthy):
#     SONAR_URL=http://localhost:9000 SONAR_ADMIN_PASSWORD=<pw> bash infrastructure/sonarqube/init-sonar.sh

set -euo pipefail

SONAR_URL="${SONAR_URL:-http://sonarqube:9000/sonar}"
SONAR_ADMIN_PASSWORD="${SONAR_ADMIN_PASSWORD:-admin}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}"
TOKEN_OUTPUT="${TOKEN_OUTPUT:-/tokens/sonar_token}"

echo "═══════════════════════════════════════"
echo "  SonarQube Initialization"
echo "═══════════════════════════════════════"

# Wait for SonarQube to be ready
echo "Waiting for SonarQube at ${SONAR_URL}..."
retries=0
max_retries=60
until curl -sf "$SONAR_URL/api/system/status" 2>/dev/null | grep -q "UP"; do
  retries=$((retries + 1))
  if [ "$retries" -ge "$max_retries" ]; then
    echo "ERROR: SonarQube did not become ready within $((max_retries * 5))s"
    exit 1
  fi
  sleep 5
done
echo "SonarQube is ready"

# Change default admin password (first boot only — will fail on subsequent runs)
echo ""
echo "Changing default admin password..."
if curl -sf -u admin:admin -X POST \
  "$SONAR_URL/api/users/change_password" \
  -d "login=admin&previousPassword=admin&password=${SONAR_ADMIN_PASSWORD}" \
  2>/dev/null; then
  echo "  ✓ Admin password changed"
else
  echo "  ℹ Password already changed (or default credentials expired)"
fi

# Generate API token for scanner access
echo ""
echo "Generating scanner API token..."
TOKEN_RESPONSE=$(curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
  "$SONAR_URL/api/user_tokens/generate" \
  -d "name=cuemarshal-scanner&type=GLOBAL_ANALYSIS_TOKEN" 2>/dev/null || echo "")

if [ -n "$TOKEN_RESPONSE" ] && echo "$TOKEN_RESPONSE" | jq -e '.token' > /dev/null 2>&1; then
  SONAR_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')
  
  # Write token to file if output dir exists
  TOKEN_DIR=$(dirname "$TOKEN_OUTPUT")
  if [ -d "$TOKEN_DIR" ]; then
    echo "SONAR_TOKEN=${SONAR_TOKEN}" > "$TOKEN_OUTPUT"
    echo "  ✓ Token saved to ${TOKEN_OUTPUT}"
  fi
  
  echo "  ✓ Token generated: ${SONAR_TOKEN:0:8}..."
  echo ""
  echo "  Add to .env:"
  echo "    SONAR_TOKEN=${SONAR_TOKEN}"
else
  echo "  ℹ Token 'cuemarshal-scanner' may already exist. Revoke and retry if needed:"
  echo "    curl -u admin:<pw> -X POST ${SONAR_URL}/api/user_tokens/revoke -d name=cuemarshal-scanner"
fi

# Create project
echo ""
echo "Creating project '${SONAR_PROJECT_KEY}'..."
PROJECT_RESPONSE=$(curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
  "$SONAR_URL/api/projects/create" \
  -d "name=${SONAR_PROJECT_KEY}&project=${SONAR_PROJECT_KEY}" 2>/dev/null || echo "")

if [ -n "$PROJECT_RESPONSE" ] && echo "$PROJECT_RESPONSE" | jq -e '.project' > /dev/null 2>&1; then
  echo "  ✓ Project '${SONAR_PROJECT_KEY}' created"
else
  echo "  ℹ Project '${SONAR_PROJECT_KEY}' may already exist"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  SonarQube initialization complete"
echo "═══════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Add SONAR_TOKEN to .env and Gitea secrets"
echo "  2. Add SONAR_URL=http://sonarqube:9000/sonar to .env"
echo "  3. Add SONAR_PROJECT_KEY=${SONAR_PROJECT_KEY} to .env"
echo "  4. Rebuild runner image to include sonar-scanner-cli"
