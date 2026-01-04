#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Get Runner Registration Token from Gitea
# ═══════════════════════════════════════════════════════════════

echo "=================================================="
echo "  Fetching Runner Registration Token"
echo "=================================================="

# Load environment
source .env

GITEA_URL="${GITEA_URL:-http://gitea:3000}"
ADMIN_TOKEN="${GITEA_ADMIN_TOKEN}"
ORG_NAME="${CONDUCTOR_ORG:-cuemarshal}"

if [ -z "$ADMIN_TOKEN" ]; then
    echo "ERROR: GITEA_ADMIN_TOKEN not set in .env"
    exit 1
fi

echo ""
echo "Fetching organization-level registration token..."
echo ""

# Get organization-level runner registration token
TOKEN_RESPONSE=$(curl -sf -X GET \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/actions/runners/registration-token" 2>&1)

if [ $? -ne 0 ]; then
    echo "ERROR: Failed to fetch registration token"
    echo "Response: ${TOKEN_RESPONSE}"
    exit 1
fi

REG_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token' 2>/dev/null || echo "")

if [ -z "$REG_TOKEN" ] || [ "$REG_TOKEN" = "null" ]; then
    echo "ERROR: Could not parse registration token from response"
    echo "Response: ${TOKEN_RESPONSE}"
    exit 1
fi

echo "=================================================="
echo "  Registration Token Retrieved"
echo "=================================================="
echo ""
echo "Add this to your .env file:"
echo ""
echo "RUNNER_REGISTRATION_TOKEN=${REG_TOKEN}"
echo ""
echo "=================================================="
echo ""
echo "After updating .env, start the runners with:"
echo "  docker compose up -d runner-1 runner-2"
echo ""
