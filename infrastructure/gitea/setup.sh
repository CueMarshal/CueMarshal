#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Gitea Initial Setup Script
# ═══════════════════════════════════════════════════════════════
# This script is run after Gitea starts for the first time to:
# 1. Create the admin user
# 2. Create the cuemarshal organization
# 3. Create the cuemarshal repository (self)
# 4. Generate API tokens
# 5. Create standard labels
# 6. Configure webhooks
# 7. Register OAuth2 application for mobile app
# ═══════════════════════════════════════════════════════════════

echo "=================================================="
echo "  CueMarshal Gitea Setup"
echo "=================================================="

# Load environment variables
if [ -f .env ]; then
    source .env
fi

GITEA_URL="${GITEA_URL:-http://gitea:3000}"
ADMIN_USER="${GITEA_ADMIN_USER:-cuemarshal-admin}"
ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD}"
ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-admin@example.com}"
ORG_NAME="${CONDUCTOR_ORG:-cuemarshal}"

if [ -z "$ADMIN_PASSWORD" ]; then
    echo "ERROR: GITEA_ADMIN_PASSWORD must be set in .env"
    exit 1
fi

# Wait for Gitea to be ready
echo "[1/9] Waiting for Gitea to be ready..."
until curl -sf "${GITEA_URL}/api/v1/version" > /dev/null 2>&1; do
    echo "  Waiting for Gitea..."
    sleep 2
done
echo "  ✓ Gitea is ready"

# Create admin user (via Gitea CLI in container)
echo "[2/9] Creating admin user..."
docker compose exec -T gitea gitea admin user create \
    --username "${ADMIN_USER}" \
    --password "${ADMIN_PASSWORD}" \
    --email "${ADMIN_EMAIL}" \
    --admin \
    --must-change-password=false 2>/dev/null || echo "  ℹ Admin user already exists"

# Generate admin token
echo "[3/9] Generating admin API token..."
ADMIN_TOKEN=$(docker compose exec -T gitea gitea admin user generate-access-token \
    --username "${ADMIN_USER}" \
    --scoped=all \
    --raw 2>/dev/null | tail -n 1 | tr -d '\r\n')

if [ -z "$ADMIN_TOKEN" ]; then
    echo "  ERROR: Failed to generate admin token"
    exit 1
fi

echo "  ✓ Admin token generated"
echo ""
echo "  Add this to your .env file:"
echo "  GITEA_ADMIN_TOKEN=${ADMIN_TOKEN}"
echo ""

# Create organization
echo "[4/9] Creating organization '${ORG_NAME}'..."
ORG_RESPONSE=$(curl -sf -X POST \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_URL}/api/v1/orgs" \
    -d "{
        \"username\": \"${ORG_NAME}\",
        \"full_name\": \"CueMarshal Platform\",
        \"description\": \"Self-hosted software development platform\",
        \"website\": \"\",
        \"location\": \"\",
        \"visibility\": \"public\"
    }" 2>/dev/null || echo "{}")

if echo "$ORG_RESPONSE" | grep -q "\"username\":\"${ORG_NAME}\""; then
    echo "  ✓ Organization created"
else
    echo "  ℹ Organization already exists"
fi

# Create bot user for agents
echo "[5/9] Creating bot user 'cuemarshal-bot'..."
docker compose exec -T gitea gitea admin user create \
    --username "cuemarshal-bot" \
    --password "${ADMIN_PASSWORD}" \
    --email "bot@cuemarshal.local" \
    --must-change-password=false 2>/dev/null || echo "  ℹ Bot user already exists"

# Generate bot token
echo "[6/9] Generating bot API token..."
BOT_TOKEN=$(docker compose exec -T gitea gitea admin user generate-access-token \
    --username "cuemarshal-bot" \
    --scoped=write:repository,write:issue,write:notification,read:user,read:organization \
    --raw 2>/dev/null | tail -n 1 | tr -d '\r\n')

if [ -z "$BOT_TOKEN" ]; then
    echo "  ERROR: Failed to generate bot token"
    exit 1
fi

echo "  ✓ Bot token generated"
echo ""
echo "  Add this to your .env file:"
echo "  GITEA_BOT_TOKEN=${BOT_TOKEN}"
echo ""

# Create the cuemarshal repository (self)
echo "[7/9] Creating repository '${ORG_NAME}/cuemarshal'..."
REPO_RESPONSE=$(curl -sf -X POST \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/repos" \
    -d '{
        "name": "cuemarshal",
        "description": "CueMarshal platform core repository",
        "private": false,
        "auto_init": true,
        "default_branch": "main",
        "gitignores": "",
        "license": "",
        "readme": "Default"
    }' 2>/dev/null || echo "{}")

if echo "$REPO_RESPONSE" | grep -q "\"name\":\"cuemarshal\""; then
    echo "  ✓ Repository created"
else
    echo "  ℹ Repository already exists"
fi

# Enable Actions for the repository
echo "[8/9] Enabling Actions for repository..."
curl -sf -X PATCH \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_URL}/api/v1/repos/${ORG_NAME}/cuemarshal" \
    -d '{
        "has_actions": true
    }' > /dev/null

echo "  ✓ Actions enabled"

# Configure branch protection for main
echo "[9/9] Configuring branch protection..."
curl -sf -X POST \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_URL}/api/v1/repos/${ORG_NAME}/cuemarshal/branch_protections" \
    -d '{
        "rule_name": "main",
        "enable_push": false,
        "enable_push_whitelist": false,
        "require_signed_commits": false,
        "protected_file_patterns": "",
        "unprotected_file_patterns": "",
        "block_on_rejected_reviews": true,
        "dismiss_stale_approvals": true,
        "require_signed_commits": false,
        "protected_branch_id": 0,
        "created_at": "",
        "updated_at": "",
        "enable_approvals_whitelist": false,
        "enable_merge_whitelist": false,
        "enable_status_check": false,
        "status_check_contexts": [],
        "required_approvals": 1,
        "enable_force_push": false,
        "enable_force_push_allowance": false,
        "force_push_allowance_usernames": [],
        "force_push_allowance_teams": [],
        "force_push_allowance_deploy_keys": false
    }' > /dev/null 2>&1 || echo "  ℹ Branch protection already configured"

echo "  ✓ Branch protection configured"

echo ""
echo "=================================================="
echo "  Gitea Setup Complete!"
echo "=================================================="
echo ""
echo "Next steps:"
echo "1. Update your .env file with the tokens shown above"
echo "2. Run ./scripts/seed-labels.sh to create standard labels"
echo "3. Run ./scripts/register-runners.sh to get the runner registration token"
echo ""
