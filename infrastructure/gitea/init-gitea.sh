#!/bin/sh
set -eu

GITEA_URL="${GITEA_URL:-http://gitea:3000}"
ADMIN_USER="${GITEA_ADMIN_USER:-cuemarshal-admin}"
ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD}"
ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-admin@example.com}"
ORG_NAME="${CONDUCTOR_ORG:-cuemarshal}"
WEBHOOK_SECRET="${WEBHOOK_SECRET}"
API_SECRET_KEY="${API_SECRET_KEY:-${WEBHOOK_SECRET}}"
SONAR_URL="${SONAR_URL:-http://sonarqube:9000}"
SONAR_ADMIN_PASSWORD="${SONAR_ADMIN_PASSWORD:-${ADMIN_PASSWORD}}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}"
TOKEN_DIR="/tokens"
MARKER="${TOKEN_DIR}/.initialized"
OAUTH_FINGERPRINT_FILE="${TOKEN_DIR}/oauth2_app_fingerprint"

if [ -z "${ADMIN_PASSWORD}" ]; then
    echo "ERROR: GITEA_ADMIN_PASSWORD must be set"
    exit 1
fi

wait_for_gitea_ready() {
    echo "[1/17] Waiting for Gitea API to be ready..."
    until curl -sf "${GITEA_URL}/api/v1/version" > /dev/null 2>&1; do
        sleep 2
    done
    echo "  Gitea API is ready"

    echo "  Running database migrations..."
    su-exec git gitea migrate --config /data/gitea/conf/app.ini 2>/dev/null || true
    echo "  Database migrations complete"
}

create_admin_user() {
    echo "[2/17] Creating admin user via CLI..."

    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
        -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
        "${GITEA_URL}/api/v1/user" 2>/dev/null)

    if [ "${HTTP_CODE}" = "200" ]; then
        echo "  Admin user '${ADMIN_USER}' already exists"
        return 0
    fi

    su-exec git gitea admin user create \
        --config /data/gitea/conf/app.ini \
        --username "${ADMIN_USER}" \
        --password "${ADMIN_PASSWORD}" \
        --email "${ADMIN_EMAIL}" \
        --admin \
        --must-change-password=false 2>/dev/null || echo "  Admin user may already exist"
    echo "  Admin user configured"
}

verify_admin_user() {
    echo "[3/17] Verifying admin user..."
    RETRIES=10
    while [ "${RETRIES}" -gt 0 ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
            -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
            "${GITEA_URL}/api/v1/user" 2>/dev/null)

        if [ "${HTTP_CODE}" = "200" ]; then
            echo "  Admin user '${ADMIN_USER}' verified"
            return 0
        fi
        RETRIES=$((RETRIES - 1))
        sleep 2
    done
    echo "  ERROR: Admin user verification failed (HTTP ${HTTP_CODE})"
    exit 1
}

generate_admin_token() {
    echo "[4/17] Generating admin token..."
    ADMIN_TOKEN=$(curl -sf -X POST \
        -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/users/${ADMIN_USER}/tokens" \
        -d "{\"name\": \"init-setup-$(date +%s)\", \"scopes\": [\"all\"]}" 2>/dev/null | \
        sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')

    if [ -z "${ADMIN_TOKEN}" ]; then
        echo "  ERROR: Failed to generate admin token"
        exit 1
    fi
    echo "${ADMIN_TOKEN}" > "${TOKEN_DIR}/admin_token"
    echo "  Admin token generated"
}

ensure_admin_token() {
    if [ -f "${TOKEN_DIR}/admin_token" ]; then
        ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
        HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            "${GITEA_URL}/api/v1/user" 2>/dev/null || echo "000")

        if [ "${HTTP_CODE}" = "200" ]; then
            return 0
        fi
    fi

    verify_admin_user
    generate_admin_token
}

create_bot_user() {
    echo "[5/17] Creating bot user..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/admin/users" \
        -d "{
            \"username\": \"cuemarshal-bot\",
            \"password\": \"${ADMIN_PASSWORD}\",
            \"email\": \"bot@cuemarshal.local\",
            \"must_change_password\": false,
            \"login_name\": \"cuemarshal-bot\",
            \"source_id\": 0
        }" > /dev/null 2>&1 || echo "  Bot user already exists"

    curl -sf -X PATCH \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/admin/users/cuemarshal-bot" \
        -d "{\"full_name\": \"Marshal — Conductor\", \"login_name\": \"cuemarshal-bot\", \"source_id\": 0}" > /dev/null 2>&1 || true

    echo "  Bot user configured"
}

generate_bot_token() {
    echo "[6/17] Generating bot token (legacy)..."
    BOT_TOKEN=$(curl -sf -X POST \
        -u "cuemarshal-bot:${ADMIN_PASSWORD}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/users/cuemarshal-bot/tokens" \
        -d "{\"name\": \"bot-token-$(date +%s)\", \"scopes\": [\"all\"]}" 2>/dev/null | \
        sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')

    if [ -z "${BOT_TOKEN}" ]; then
        echo "  ERROR: Failed to generate bot token"
        exit 1
    fi
    echo "${BOT_TOKEN}" > "${TOKEN_DIR}/bot_token"
    echo "  Bot token generated"
}

create_role_users() {
    echo "[7/17] Creating role users..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")

    set_full_name() {
        curl -sf -X PATCH \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/admin/users/$1" \
            -d "{\"full_name\": \"$2\", \"login_name\": \"$1\", \"source_id\": 0}" > /dev/null 2>&1 || true
    }

    create_agent() {
        USERNAME="$1"
        EMAIL="$2"
        FULL_NAME="$3"
        echo "  - Creating ${FULL_NAME} (${USERNAME})..."

        HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
            -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
            "${GITEA_URL}/api/v1/users/${USERNAME}" 2>/dev/null)

        if [ "${HTTP_CODE}" = "200" ]; then
            echo "    User ${USERNAME} already exists"
        else
            su-exec git gitea admin user create \
                --config /data/gitea/conf/app.ini \
                --username "${USERNAME}" \
                --password "${ADMIN_PASSWORD}" \
                --email "${EMAIL}" \
                --must-change-password=false 2>/dev/null || echo "    Failed to create ${USERNAME}"
        fi

        set_full_name "${USERNAME}" "${FULL_NAME}"
    }

    create_agent "agent-architect" "architect@cuemarshal.local" "Ava — Architect"
    create_agent "agent-developer" "developer@cuemarshal.local" "Dave — Developer"
    create_agent "agent-reviewer"  "reviewer@cuemarshal.local"  "Reese — Reviewer"
    create_agent "agent-tester"    "tester@cuemarshal.local"    "Tess — Tester"
    create_agent "agent-devops"    "devops@cuemarshal.local"    "Devin — DevOps"
    create_agent "agent-docs"      "docs@cuemarshal.local"      "Dot — Technical Writer"
    create_agent "agent-linter"    "linter@cuemarshal.local"    "Linton — Code Quality"

    echo "  Role users configured"
}

generate_role_tokens() {
    echo "[8/17] Generating role tokens..."
    ROLES="architect developer reviewer tester devops docs linter"

    for ROLE in ${ROLES}; do
        USERNAME="agent-${ROLE}"
        echo "  - Generating token for ${USERNAME}..."
        
        TOKEN_FILE="${TOKEN_DIR}/${ROLE}_token"
        
        # Skip if token already exists for idempotency
        if [ -f "${TOKEN_FILE}" ]; then
            echo "    Token file exists for ${ROLE}, skipping"
            continue
        fi

        ROLE_TOKEN=$(curl -sf -X POST \
            -u "${USERNAME}:${ADMIN_PASSWORD}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/users/${USERNAME}/tokens" \
            -d "{\"name\": \"${ROLE}-token-$(date +%s)\", \"scopes\": [\"all\"]}" 2>/dev/null | \
            sed -n 's/.*"sha1":"\([^"]*\)".*/\1/p')

        if [ -n "${ROLE_TOKEN}" ]; then
            echo "${ROLE_TOKEN}" > "${TOKEN_FILE}"
            echo "    Token saved to ${TOKEN_FILE}"
        else
            echo "    ERROR: Failed to generate token for ${USERNAME}"
        fi
    done
    echo "  Role tokens generated"
}

create_org() {
    echo "[9/17] Creating organization '${ORG_NAME}'..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/orgs" \
        -d "{
            \"username\": \"${ORG_NAME}\",
            \"full_name\": \"CueMarshal Platform\",
            \"description\": \"Self-hosted software development platform\",
            \"visibility\": \"public\"
        }" > /dev/null 2>&1 || echo "  Organization already exists"

    # Add bot as org member via Owners team
    OWNERS_TEAM_ID=$(curl -sf \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/teams" 2>/dev/null | \
        sed -n 's/.*"id":\([0-9]*\).*"name":"Owners".*/\1/p')

    if [ -n "${OWNERS_TEAM_ID}" ]; then
        curl -sf -X PUT \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            "${GITEA_URL}/api/v1/teams/${OWNERS_TEAM_ID}/members/cuemarshal-bot" > /dev/null 2>&1 || true
        
        ROLES="architect developer reviewer tester devops docs linter"
        for ROLE in ${ROLES}; do
            USERNAME="agent-${ROLE}"
            curl -sf -X PUT \
                -H "Authorization: token ${ADMIN_TOKEN}" \
                "${GITEA_URL}/api/v1/teams/${OWNERS_TEAM_ID}/members/${USERNAME}" > /dev/null 2>&1 || true
        done
    fi
    echo "  Organization configured with role users"
}

create_repo() {
    echo "[10/17] Creating repository '${ORG_NAME}/cuemarshal'..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/repos" \
        -d '{
            "name": "cuemarshal",
            "description": "CueMarshal platform core repository",
            "private": false,
            "auto_init": true,
            "default_branch": "main"
        }' > /dev/null 2>&1 || echo "  Repository already exists"

    curl -s -X PATCH \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/repos/${ORG_NAME}/cuemarshal" \
        -d '{"has_actions": true}' > /dev/null 2>&1 || echo "  Warning: could not enable Actions"
    echo "  Repository configured with Actions enabled"
}

import_source() {
    echo "[11/17] Importing source code into Gitea..."

    if [ ! -d "/source" ]; then
        echo "  /source directory not found — skipping source import"
        echo "  Push source manually: git remote add gitea <GITEA_URL>/${ORG_NAME}/cuemarshal.git && git push"
        return 0
    fi

    BOT_TOKEN=$(cat "${TOKEN_DIR}/bot_token")

    TMPDIR=$(mktemp -d)
    cp -r /source/. "${TMPDIR}/"
    cd "${TMPDIR}"

    rm -rf .gitea

    mkdir -p .gitea/workflows
    for f in workflows/*.yml; do
        [ -f "$f" ] && cp "$f" ".gitea/workflows/"
    done

    git config user.name "cuemarshal-bot"
    git config user.email "bot@cuemarshal.local"
    git add -A
    git diff --cached --quiet || git commit -m "Sync workflows to .gitea/workflows for Gitea Actions"

    GITEA_HOST=$(echo "${GITEA_URL}" | sed 's|http://||')
    git remote set-url origin "http://cuemarshal-bot:${BOT_TOKEN}@${GITEA_HOST}/${ORG_NAME}/cuemarshal.git"
    git push --force origin HEAD:main

    cd /
    rm -rf "${TMPDIR}"
    echo "  Source code imported with workflows in .gitea/workflows/"
}

init_sonarqube() {
    echo "[12/17] Initializing SonarQube..."

    # Wait for SonarQube with timeout (do not block indefinitely)
    echo "  Waiting for SonarQube at ${SONAR_URL}..."
    RETRIES=40
    SONAR_READY=false
    while [ "${RETRIES}" -gt 0 ]; do
        if curl -sf "${SONAR_URL}/api/system/status" 2>/dev/null | grep -q "UP"; then
            SONAR_READY=true
            break
        fi
        RETRIES=$((RETRIES - 1))
        sleep 5
    done

    if [ "${SONAR_READY}" = "false" ]; then
        echo "  WARNING: SonarQube not ready within timeout — skipping"
        echo "  Run infrastructure/sonarqube/init-sonar.sh manually later"
        return 0
    fi
    echo "  SonarQube is ready"

    # Change default admin password (first boot only — harmless on re-runs)
    if curl -sf -u admin:admin -X POST \
        "${SONAR_URL}/api/users/change_password" \
        -d "login=admin&previousPassword=admin&password=${SONAR_ADMIN_PASSWORD}" \
        2>/dev/null; then
        echo "  Admin password changed"
    else
        echo "  Password already changed (or default credentials expired)"
    fi

    # Generate API token for scanner access (idempotent)
    if [ -f "${TOKEN_DIR}/sonar_token" ] && [ -s "${TOKEN_DIR}/sonar_token" ]; then
        echo "  Scanner token file already exists, reusing"
    else
        TOKEN_RESPONSE=$(curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
            "${SONAR_URL}/api/user_tokens/generate" \
            -d "name=cuemarshal-scanner&type=GLOBAL_ANALYSIS_TOKEN" 2>/dev/null || echo "")

        SONAR_TOKEN=$(echo "${TOKEN_RESPONSE}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

        if [ -n "${SONAR_TOKEN}" ]; then
            echo "${SONAR_TOKEN}" > "${TOKEN_DIR}/sonar_token"
            echo "  Scanner token generated and saved"
        else
            echo "  Token 'cuemarshal-scanner' may already exist, attempting to revoke and regenerate..."
            
            # Revoke existing token
            curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
                "${SONAR_URL}/api/user_tokens/revoke" \
                -d "name=cuemarshal-scanner" > /dev/null 2>&1 || true
            
            # Retry token generation
            TOKEN_RESPONSE=$(curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
                "${SONAR_URL}/api/user_tokens/generate" \
                -d "name=cuemarshal-scanner&type=GLOBAL_ANALYSIS_TOKEN" 2>/dev/null || echo "")
            
            SONAR_TOKEN=$(echo "${TOKEN_RESPONSE}" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
            
            if [ -n "${SONAR_TOKEN}" ]; then
                echo "${SONAR_TOKEN}" > "${TOKEN_DIR}/sonar_token"
                echo "  Scanner token regenerated and saved"
            else
                echo "  ERROR: Failed to generate SonarQube token after retry"
                echo "  Manual intervention required: revoke 'cuemarshal-scanner' token via SonarQube UI"
            fi
        fi
    fi

    # Create project
    curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
        "${SONAR_URL}/api/projects/create" \
        -d "name=${SONAR_PROJECT_KEY}&project=${SONAR_PROJECT_KEY}" \
        > /dev/null 2>&1 || echo "  Project '${SONAR_PROJECT_KEY}' may already exist"

    echo "  SonarQube project '${SONAR_PROJECT_KEY}' configured"
}

seed_repo_secrets() {
    echo "[13/17] Configuring repository action secrets..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
    BOT_TOKEN=$(cat "${TOKEN_DIR}/bot_token")

    set_secret() {
        curl -sf -X PUT \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/repos/${ORG_NAME}/cuemarshal/actions/secrets/$1" \
            -d "{\"data\": \"$2\"}" > /dev/null 2>&1 || echo "  Warning: failed to set $1"
    }

    # Legacy secrets (for backward compatibility)
    set_secret "SCM_URL" "${GITEA_URL}"
    set_secret "SCM_TOKEN" "${BOT_TOKEN}"
    set_secret "GATEWAY_API_KEY" "${API_SECRET_KEY:-${WEBHOOK_SECRET}}"
    set_secret "CONDUCTOR_URL" "http://conductor"
    set_secret "CONDUCTOR_SECRET" "${API_SECRET_KEY:-${WEBHOOK_SECRET}}"

    # SonarQube secrets
    set_secret "SONAR_URL" "${SONAR_URL}"
    set_secret "SONAR_PROJECT_KEY" "${SONAR_PROJECT_KEY}"
    if [ -f "${TOKEN_DIR}/sonar_token" ]; then
        SONAR_TOKEN_VAL=$(cat "${TOKEN_DIR}/sonar_token")
        set_secret "SONAR_TOKEN" "${SONAR_TOKEN_VAL}"
        echo "  - SONAR_TOKEN configured"
    else
        echo "  WARNING: SonarQube token not available — SONAR_TOKEN secret not set"
    fi
    
    # Role-based token secrets
    ROLES="architect developer reviewer tester devops docs linter"
    for ROLE in ${ROLES}; do
        TOKEN_FILE="${TOKEN_DIR}/${ROLE}_token"
        if [ -f "${TOKEN_FILE}" ]; then
            ROLE_TOKEN=$(cat "${TOKEN_FILE}")
            SECRET_NAME=$(echo "SCM_TOKEN_${ROLE}" | tr '[:lower:]' '[:upper:]')
            set_secret "${SECRET_NAME}" "${ROLE_TOKEN}"
            echo "  - ${SECRET_NAME} configured"
        else
            echo "  WARNING: Token file not found for ${ROLE}"
        fi
    done
    
    echo "  Repository secrets configured (legacy + role-based)"
}

create_oauth2_app() {
    echo "[14/17] Creating OAuth2 application for mobile app & web..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")
    OAUTH_SCOPE_SET="read:user read:organization read:repository write:repository read:issue write:issue"

    # Determine the browser callback based on the public web URL, not the
    # internal service hostname. Fall back for older environments that only set
    # GITEA_EXTERNAL_URL.
    WEB_BASE_URL="${CUEMARSHAL_PUBLIC_URL:-${GITEA_EXTERNAL_URL:-${GITEA_URL}}}"
    WEB_BASE_URL="${WEB_BASE_URL%/}"
    WEB_REDIRECT_URI="${WEB_BASE_URL}/oauth/callback"
    EXPECTED_FINGERPRINT="cuemarshal://oauth|${WEB_REDIRECT_URI}|${OAUTH_SCOPE_SET}"
    STORED_FINGERPRINT=""
    if [ -f "${OAUTH_FINGERPRINT_FILE}" ]; then
        STORED_FINGERPRINT=$(cat "${OAUTH_FINGERPRINT_FILE}")
    fi

    # Check if the OAuth2 app already exists
    APPS_RESPONSE=$(curl -sf \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        "${GITEA_URL}/api/v1/user/applications/oauth2" 2>/dev/null)
    APP_RECORD=$(printf '%s' "${APPS_RESPONSE}" | sed 's/},{/}\
{/g' | grep '"name":"CueMarshal"' | head -n 1 || true)
    EXISTING_ID=$(printf '%s' "${APP_RECORD}" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
    EXISTING_CLIENT_ID=$(printf '%s' "${APP_RECORD}" | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')

    if [ -n "${EXISTING_ID}" ]; then
        CLIENT_ID="${EXISTING_CLIENT_ID}"

        if [ "${STORED_FINGERPRINT}" != "${EXPECTED_FINGERPRINT}" ]; then
            echo "  Recreating OAuth2 application to apply updated callback/scopes..."
            curl -sf -X DELETE \
                -H "Authorization: token ${ADMIN_TOKEN}" \
                "${GITEA_URL}/api/v1/user/applications/oauth2/${EXISTING_ID}" >/dev/null 2>&1
            EXISTING_ID=""
            CLIENT_ID=""
        elif printf '%s' "${APP_RECORD}" | grep -F '"cuemarshal://oauth"' >/dev/null 2>&1 && \
             printf '%s' "${APP_RECORD}" | grep -F "\"${WEB_REDIRECT_URI}\"" >/dev/null 2>&1; then
            echo "  OAuth2 application already exists (Client ID: ${CLIENT_ID})"
        else
            echo "  Updating OAuth2 application redirect URIs..."
            OAUTH_RESPONSE=$(curl -sf -X PATCH \
                -H "Authorization: token ${ADMIN_TOKEN}" \
                -H "Content-Type: application/json" \
                "${GITEA_URL}/api/v1/user/applications/oauth2/${EXISTING_ID}" \
                -d "{
                    \"name\": \"CueMarshal\",
                    \"redirect_uris\": [\"cuemarshal://oauth\", \"${WEB_REDIRECT_URI}\"],
                    \"confidential_client\": false
                }" 2>/dev/null)

            UPDATED_CLIENT_ID=$(printf '%s' "${OAUTH_RESPONSE}" | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')
            if [ -n "${UPDATED_CLIENT_ID}" ]; then
                CLIENT_ID="${UPDATED_CLIENT_ID}"
            fi
        fi
    fi

    if [ -z "${EXISTING_ID}" ]; then
        OAUTH_RESPONSE=$(curl -sf -X POST \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/user/applications/oauth2" \
            -d "{
                \"name\": \"CueMarshal\",
                \"redirect_uris\": [\"cuemarshal://oauth\", \"${WEB_REDIRECT_URI}\"],
                \"confidential_client\": false
            }" 2>/dev/null)

        CLIENT_ID=$(echo "${OAUTH_RESPONSE}" | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')
    fi

    if [ -n "${CLIENT_ID}" ]; then
        echo "${CLIENT_ID}" > "${TOKEN_DIR}/oauth2_client_id"
        echo "${EXPECTED_FINGERPRINT}" > "${OAUTH_FINGERPRINT_FILE}"
        echo "  OAuth2 application configured (Mobile + Web)"
        echo "    - Mobile: cuemarshal://oauth"
        echo "    - Web: ${WEB_REDIRECT_URI}"
    else
        echo "  WARNING: Could not create OAuth2 application"
    fi
}

seed_labels_webhook_runner() {
    echo "[15/17] Creating webhook, seeding labels, fetching runner token..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")

    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/hooks" \
        -d "{
            \"type\": \"gitea\",
            \"config\": {
                \"url\": \"http://conductor/webhooks/gitea\",
                \"content_type\": \"json\",
                \"secret\": \"${WEBHOOK_SECRET}\"
            },
            \"events\": [
                \"issues\",
                \"issue_comment\",
                \"pull_request\",
                \"pull_request_review\",
                \"push\",
                \"workflow_run\"
            ],
            \"active\": true
        }" > /dev/null 2>&1 || echo "  Webhook already exists"
    echo "  Webhook configured"

    create_label() {
        curl -sf -X POST \
            -H "Authorization: token ${ADMIN_TOKEN}" \
            -H "Content-Type: application/json" \
            "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/labels" \
            -d "{\"name\": \"$1\", \"color\": \"$2\", \"description\": \"$3\"}" > /dev/null 2>&1 || true
    }

    create_label "role:architect" "e11d48" "System design and architecture"
    create_label "role:developer" "0075ca" "Feature implementation and bug fixes"
    create_label "role:reviewer" "7057ff" "Code review and quality checks"
    create_label "role:tester" "008672" "Test writing and execution"
    create_label "role:devops" "e99695" "CI/CD and infrastructure"
    create_label "role:docs" "0e8a16" "Documentation and technical writing"

    create_label "complexity:simple" "c2e0c6" "Simple task, tier1 model"
    create_label "complexity:moderate" "d876e3" "Moderate task, tier2 model"
    create_label "complexity:standard" "fef2c0" "Standard task, tier2 model"
    create_label "complexity:complex" "f9d0c4" "Complex task, tier3 model"

    create_label "status:pending" "ededed" "Waiting for analysis"
    create_label "status:in-progress" "fbca04" "Agent is working on this"
    create_label "status:review" "d4c5f9" "PR awaiting review"
    create_label "status:blocked" "d73a4a" "Blocked by dependency"

    create_label "type:feature" "a2eeef" "New feature or enhancement"
    create_label "type:bug" "d73a4a" "Bug fix"
    create_label "type:refactor" "fbca04" "Code refactoring"
    create_label "type:test" "0e8a16" "Test-related changes"
    create_label "type:docs" "0075ca" "Documentation"
    create_label "type:chore" "ededed" "Maintenance tasks"

    create_label "self-improvement" "5319e7" "Self-improvement task"
    create_label "needs-human-review" "b60205" "Requires human approval"
    create_label "skip-automation" "000000" "Do not process automatically"

    create_label "source:sonar" "fbca04" "Issue identified by SonarQube analysis"

    create_label "priority:low" "c5def5" "Low priority"
    create_label "priority:medium" "fef2c0" "Medium priority"
    create_label "priority:high" "f9d0c4" "High priority"
    create_label "priority:critical" "d73a4a" "Critical priority"

    echo "  Labels seeded"

    # Fetch runner registration token
    REG_TOKEN=$(curl -sf -X GET \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/actions/runners/registration-token" 2>/dev/null | \
        sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

    if [ -n "${REG_TOKEN}" ]; then
        echo "${REG_TOKEN}" > "${TOKEN_DIR}/runner_token"
        echo "  Runner registration token saved"
    else
        echo "  WARNING: Could not fetch runner registration token"
    fi
}

configure_google_oauth() {
    # Configure Google OAuth as external authentication source if credentials are provided
    if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
        echo "[16/17] Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set)"
        echo "  Using standard Gitea authentication"
        return 0
    fi

    echo "[16/17] Configuring Google OAuth as external authentication source..."
    ADMIN_TOKEN=$(cat "${TOKEN_DIR}/admin_token")

    # Check if Google auth source already exists
    EXISTING_AUTH=$(curl -sf -X GET \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/admin/auths" 2>/dev/null | \
        grep -c '"name":"Google"' || echo "0")

    if [ "${EXISTING_AUTH}" != "0" ]; then
        echo "  Google OAuth auth source already exists"
        return 0
    fi

    # Register Google as external OAuth2 authentication source
    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/admin/auths" \
        -d "{
            \"type\": \"oauth2\",
            \"name\": \"Google\",
            \"is_active\": true,
            \"oauth2_provider\": \"google\",
            \"client_id\": \"${GOOGLE_CLIENT_ID}\",
            \"client_secret\": \"${GOOGLE_CLIENT_SECRET}\",
            \"open_id_connect_auto_discovery_url\": \"https://accounts.google.com/.well-known/openid-configuration\",
            \"scopes\": [\"openid\", \"email\", \"profile\"]
        }" > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "  Google OAuth configured successfully"
        echo "  Users can now sign in with Google at ${GITEA_URL}"
    else
        echo "  WARNING: Failed to configure Google OAuth"
    fi
}

if [ -f "${MARKER}" ]; then
    echo "Already initialized. Refreshing auth configuration..."
    wait_for_gitea_ready
    ensure_admin_token
    create_oauth2_app
    configure_google_oauth
    exit 0
fi

# Main execution
wait_for_gitea_ready
create_admin_user
verify_admin_user
generate_admin_token
create_bot_user
generate_bot_token
create_role_users
generate_role_tokens
create_org
create_repo
import_source
init_sonarqube
seed_repo_secrets
create_oauth2_app
seed_labels_webhook_runner
configure_google_oauth

touch "${MARKER}"

echo ""
echo "=================================================="
echo "  Initialization Complete!"
echo "=================================================="
echo ""
echo "Tokens written to ${TOKEN_DIR}/"
echo "  Legacy: admin_token, bot_token, runner_token"
echo "  Role-based: architect_token, developer_token, reviewer_token,"
echo "              tester_token, devops_token, docs_token, linter_token"
if [ -f "${TOKEN_DIR}/sonar_token" ]; then
    echo "  SonarQube: sonar_token"
fi
if [ -f "${TOKEN_DIR}/oauth2_client_id" ]; then
    echo "  OAuth2:  oauth2_client_id ($(cat ${TOKEN_DIR}/oauth2_client_id))"
fi
echo ""
