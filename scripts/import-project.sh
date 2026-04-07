#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════
# import-project.sh — Import a project into CueMarshal's Gitea instance
#
# Usage:
#   bash scripts/import-project.sh --path /path/to/project [--name repo-name] [--org org]
#   bash scripts/import-project.sh --url https://github.com/user/repo.git [--name repo-name] [--org org]
#
# Options:
#   --path       Local path to a git repository
#   --url        Clone URL of a remote git repository
#   --name       Repository name in Gitea (defaults to directory/URL basename)
#   --org        Organization name (defaults to CONDUCTOR_ORG from .env)
#   --no-push    Skip pushing code (only create repo and configure)
#   --help       Show this help message
#
# Environment:
#   Reads .env from the CueMarshal root directory for credentials.
#   Alternatively, set GITEA_EXTERNAL_URL, ADMIN_TOKEN, BOT_TOKEN directly.
# ═══════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Defaults
SOURCE_PATH=""
CLONE_URL=""
REPO_NAME=""
ORG_NAME=""
NO_PUSH=false
GITEA_EXTERNAL_URL="${GITEA_EXTERNAL_URL:-http://localhost:8180/gitea}"
TEMPLATE_REPO_URL="${TEMPLATE_REPO_URL:-https://raw.githubusercontent.com/CueMarshal/CueMarshal/main}"

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \?//'
  exit 0
}

# ── Parse arguments ──────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --path)   SOURCE_PATH="$2"; shift 2 ;;
    --url)    CLONE_URL="$2"; shift 2 ;;
    --name)   REPO_NAME="$2"; shift 2 ;;
    --org)    ORG_NAME="$2"; shift 2 ;;
    --no-push) NO_PUSH=true; shift ;;
    --help|-h) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "${SOURCE_PATH}" && -z "${CLONE_URL}" ]]; then
  echo "ERROR: Either --path or --url is required"
  usage
fi

# ── Load environment ─────────────────────────────────────────────────
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  # Source .env without overriding already-set variables
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_ROOT}/.env"
  set +a
fi

ORG_NAME="${ORG_NAME:-${CONDUCTOR_ORG:-cuemarshal}}"

# ── Resolve tokens ───────────────────────────────────────────────────
resolve_token() {
  local name="$1" file="$2" env_var="${3:-}"
  # Try Docker volume first
  local val=""
  val=$(docker exec cuemarshal-conductor cat "/tokens/${file}" 2>/dev/null || true)
  if [[ -z "${val}" && -n "${env_var}" ]]; then
    val="${!env_var:-}"
  fi
  if [[ -z "${val}" ]]; then
    echo "ERROR: Could not resolve ${name} (tried docker volume /tokens/${file} and env var ${env_var})"
    exit 1
  fi
  echo "${val}"
}

ADMIN_TOKEN="${ADMIN_TOKEN:-$(resolve_token "admin token" "admin_token" "")}"
BOT_TOKEN="${BOT_TOKEN:-$(resolve_token "bot token" "bot_token" "GITEA_BOT_TOKEN")}"

# Verify admin token
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: token ${ADMIN_TOKEN}" \
  "${GITEA_EXTERNAL_URL}/api/v1/user" 2>/dev/null || echo "000")
if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "ERROR: Admin token is invalid (HTTP ${HTTP_CODE})"
  exit 1
fi

# ── Resolve source ───────────────────────────────────────────────────
WORK_DIR=""
CLEANUP_WORK_DIR=false

if [[ -n "${CLONE_URL}" ]]; then
  # Derive repo name from URL
  if [[ -z "${REPO_NAME}" ]]; then
    REPO_NAME=$(basename "${CLONE_URL}" .git)
  fi
  REPO_NAME=$(echo "${REPO_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')

  echo "Cloning ${CLONE_URL} ..."
  WORK_DIR=$(mktemp -d)
  CLEANUP_WORK_DIR=true
  git clone --mirror "${CLONE_URL}" "${WORK_DIR}/.git"
  cd "${WORK_DIR}"
  git config --bool core.bare false
  git checkout HEAD 2>/dev/null || git checkout "$(git branch -l | head -1 | tr -d '* ')" 2>/dev/null || true

elif [[ -n "${SOURCE_PATH}" ]]; then
  if [[ ! -d "${SOURCE_PATH}/.git" ]]; then
    echo "ERROR: ${SOURCE_PATH} is not a git repository"
    exit 1
  fi
  if [[ -z "${REPO_NAME}" ]]; then
    REPO_NAME=$(basename "${SOURCE_PATH}")
  fi
  REPO_NAME=$(echo "${REPO_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')
  WORK_DIR="${SOURCE_PATH}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Importing: ${REPO_NAME}"
echo "  Source:    ${SOURCE_PATH:-${CLONE_URL}}"
echo "  Target:    ${ORG_NAME}/${REPO_NAME}"
echo "  Gitea:     ${GITEA_EXTERNAL_URL}"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Create repository ────────────────────────────────────────
echo "[1/7] Creating repository ${ORG_NAME}/${REPO_NAME}..."

REPO_EXISTS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: token ${ADMIN_TOKEN}" \
  "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}" 2>/dev/null || echo "000")

if [[ "${REPO_EXISTS}" == "200" ]]; then
  echo "  Repository already exists"
else
  curl -sf -X POST \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_EXTERNAL_URL}/api/v1/orgs/${ORG_NAME}/repos" \
    -d "{
      \"name\": \"${REPO_NAME}\",
      \"description\": \"Imported project\",
      \"private\": false,
      \"auto_init\": false,
      \"default_branch\": \"main\"
    }" > /dev/null 2>&1
  echo "  Repository created"
fi

# Enable Actions
curl -sf -X PATCH \
  -H "Authorization: token ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}" \
  -d '{"has_actions": true}' > /dev/null 2>&1 || true
echo "  Actions enabled"

# ── Step 2: Push code ────────────────────────────────────────────────
if [[ "${NO_PUSH}" == "true" ]]; then
  echo "[2/7] Skipping code push (--no-push)"
else
  echo "[2/7] Pushing code to Gitea..."
  cd "${WORK_DIR}"

  GITEA_HOST=$(echo "${GITEA_EXTERNAL_URL}" | sed -E 's|^https?://||')
  GITEA_REMOTE="http://cuemarshal-bot:${BOT_TOKEN}@${GITEA_HOST}/${ORG_NAME}/${REPO_NAME}.git"

  # Add or update gitea remote
  if git remote get-url gitea >/dev/null 2>&1; then
    git remote set-url gitea "${GITEA_REMOTE}"
  else
    git remote add gitea "${GITEA_REMOTE}"
  fi

  # Push all branches
  DEFAULT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
  git push --force gitea "${DEFAULT_BRANCH}:main" 2>&1 | tail -3
  echo "  Code pushed (branch: ${DEFAULT_BRANCH} → main)"

  # Push other branches (best effort)
  for branch in $(git branch --format='%(refname:short)' | grep -v "^${DEFAULT_BRANCH}$" | head -10); do
    git push gitea "${branch}:${branch}" 2>/dev/null || true
  done
fi

# ── Step 3: Seed workflow files ──────────────────────────────────────
echo "[3/7] Seeding workflow files (.gitea/workflows/)..."

WORKFLOW_FILES="task-execute.yml code-review.yml run-tests.yml self-improve.yml idle-check.yml sonar-scan.yml validate-config.yml"
SEEDED_COUNT=0

for wf in ${WORKFLOW_FILES}; do
  # Try fetching from the local workflows/ directory first
  LOCAL_WF="${PROJECT_ROOT}/workflows/${wf}"
  CONTENT=""
  if [[ -f "${LOCAL_WF}" ]]; then
    CONTENT=$(cat "${LOCAL_WF}")
  else
    # Fall back to template repo URL
    CONTENT=$(curl -sf "${TEMPLATE_REPO_URL}/workflows/${wf}" 2>/dev/null || true)
  fi

  if [[ -z "${CONTENT}" ]]; then
    echo "  WARNING: Could not find ${wf}, skipping"
    continue
  fi

  # Base64 encode the content
  ENCODED=$(echo -n "${CONTENT}" | base64)

  # Check if file already exists in repo
  FILE_EXISTS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: token ${BOT_TOKEN}" \
    "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/.gitea/workflows/${wf}" 2>/dev/null || echo "000")

  if [[ "${FILE_EXISTS}" == "200" ]]; then
    # Get existing file SHA for update
    SHA=$(curl -sf \
      -H "Authorization: token ${BOT_TOKEN}" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/.gitea/workflows/${wf}" 2>/dev/null | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || true)

    curl -sf -X PUT \
      -H "Authorization: token ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/.gitea/workflows/${wf}" \
      -d "{
        \"content\": \"${ENCODED}\",
        \"message\": \"chore: update workflow ${wf}\",
        \"sha\": \"${SHA}\"
      }" > /dev/null 2>&1 && SEEDED_COUNT=$((SEEDED_COUNT + 1)) || echo "  WARNING: Failed to update ${wf}"
  else
    curl -sf -X POST \
      -H "Authorization: token ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/.gitea/workflows/${wf}" \
      -d "{
        \"content\": \"${ENCODED}\",
        \"message\": \"chore: seed workflow ${wf}\"
      }" > /dev/null 2>&1 && SEEDED_COUNT=$((SEEDED_COUNT + 1)) || echo "  WARNING: Failed to create ${wf}"
  fi
done
echo "  ${SEEDED_COUNT} workflow files seeded"

# ── Step 4: Seed scanner scripts ─────────────────────────────────────
echo "[4/7] Seeding scanner scripts (scripts/scanners/)..."

SCANNER_FILES="run-all-scanners.sh scan-todo-markers.sh scan-dependency-updates.sh scan-test-coverage.sh scan-stale-docs.sh scan-sonar.sh scanner-config.json schema.json"
SCANNER_COUNT=0

for sf in ${SCANNER_FILES}; do
  LOCAL_SF="${PROJECT_ROOT}/scripts/scanners/${sf}"
  CONTENT=""
  if [[ -f "${LOCAL_SF}" ]]; then
    CONTENT=$(cat "${LOCAL_SF}")
  else
    CONTENT=$(curl -sf "${TEMPLATE_REPO_URL}/scripts/scanners/${sf}" 2>/dev/null || true)
  fi

  if [[ -z "${CONTENT}" ]]; then
    continue
  fi

  ENCODED=$(echo -n "${CONTENT}" | base64)

  FILE_EXISTS=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: token ${BOT_TOKEN}" \
    "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/scripts/scanners/${sf}" 2>/dev/null || echo "000")

  if [[ "${FILE_EXISTS}" == "200" ]]; then
    SHA=$(curl -sf \
      -H "Authorization: token ${BOT_TOKEN}" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/scripts/scanners/${sf}" 2>/dev/null | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('sha',''))" 2>/dev/null || true)

    curl -sf -X PUT \
      -H "Authorization: token ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/scripts/scanners/${sf}" \
      -d "{
        \"content\": \"${ENCODED}\",
        \"message\": \"chore: update scanner ${sf}\",
        \"sha\": \"${SHA}\"
      }" > /dev/null 2>&1 && SCANNER_COUNT=$((SCANNER_COUNT + 1)) || true
  else
    curl -sf -X POST \
      -H "Authorization: token ${BOT_TOKEN}" \
      -H "Content-Type: application/json" \
      "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/contents/scripts/scanners/${sf}" \
      -d "{
        \"content\": \"${ENCODED}\",
        \"message\": \"chore: seed scanner ${sf}\"
      }" > /dev/null 2>&1 && SCANNER_COUNT=$((SCANNER_COUNT + 1)) || true
  fi
done
echo "  ${SCANNER_COUNT} scanner scripts seeded"

# ── Step 5: Set action secrets ───────────────────────────────────────
echo "[5/7] Setting action secrets..."

set_secret() {
  local secret_name="$1"
  local secret_value="$2"
  curl -sf -X PUT \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/actions/secrets/${secret_name}" \
    -d "{\"data\": \"${secret_value}\"}" > /dev/null 2>&1 || echo "  WARNING: Failed to set ${secret_name}"
}

# Internal Gitea URL (container network)
INTERNAL_GITEA_URL="${GITEA_URL:-http://gitea:3000}"

set_secret "SCM_URL" "${INTERNAL_GITEA_URL}"
set_secret "SCM_TOKEN" "${BOT_TOKEN}"
set_secret "GATEWAY_API_KEY" "${API_SECRET_KEY:-${CONDUCTOR_SECRET:-${WEBHOOK_SECRET}}}"
set_secret "CONDUCTOR_URL" "http://conductor"
set_secret "CONDUCTOR_SECRET" "${API_SECRET_KEY:-${CONDUCTOR_SECRET:-${WEBHOOK_SECRET}}}"

# SonarQube secrets
SONAR_URL="${SONAR_URL:-http://sonarqube:9000/sonar}"
SONAR_TOKEN_VAL=$(docker exec cuemarshal-conductor cat /tokens/sonar_token 2>/dev/null || echo "")
set_secret "SONAR_URL" "${SONAR_URL}"
set_secret "SONAR_PROJECT_KEY" "${REPO_NAME}"
if [[ -n "${SONAR_TOKEN_VAL}" ]]; then
  set_secret "SONAR_TOKEN" "${SONAR_TOKEN_VAL}"
fi

# Role-specific tokens
ROLES="architect developer reviewer tester devops docs linter"
for role in ${ROLES}; do
  ROLE_TOKEN=$(docker exec cuemarshal-conductor cat "/tokens/${role}_token" 2>/dev/null || echo "")
  if [[ -n "${ROLE_TOKEN}" ]]; then
    SECRET_NAME=$(echo "SCM_TOKEN_${role}" | tr '[:lower:]' '[:upper:]')
    set_secret "${SECRET_NAME}" "${ROLE_TOKEN}"
  else
    echo "  WARNING: No token for ${role}"
  fi
done

echo "  Secrets configured"

# ── Step 6: Seed repo-level labels ───────────────────────────────────
echo "[6/7] Seeding repository labels..."

# Repo-level labels for items not in org labels
create_label() {
  curl -sf -X POST \
    -H "Authorization: token ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/labels" \
    -d "{\"name\": \"$1\", \"color\": \"$2\", \"description\": \"$3\"}" > /dev/null 2>&1 || true
}

# These are needed by self-improve and project planner but may not be in org labels
create_label "checkpoint" "#f9d0c4" "Architecture checkpoint requiring user approval"

echo "  Labels configured"

# ── Step 7: Create SonarQube project ─────────────────────────────────
echo "[7/7] Creating SonarQube project..."

SONAR_ADMIN_PASS="${SONAR_ADMIN_PASSWORD:-${GITEA_ADMIN_PASSWORD:-}}"
SONAR_EXT_URL="${SONAR_URL:-http://sonarqube:9000/sonar}"

# Try internal Docker network first, then external
SONAR_API_URL=""
if curl -sf "http://localhost:9000/sonar/api/system/status" 2>/dev/null | grep -q "UP"; then
  SONAR_API_URL="http://localhost:9000/sonar"
fi

if [[ -n "${SONAR_API_URL}" && -n "${SONAR_ADMIN_PASS}" ]]; then
  curl -sf -u "admin:${SONAR_ADMIN_PASS}" -X POST \
    "${SONAR_API_URL}/api/projects/create" \
    -d "name=${REPO_NAME}&project=${REPO_NAME}" \
    > /dev/null 2>&1 || echo "  SonarQube project may already exist"
  echo "  SonarQube project '${REPO_NAME}' configured"
else
  echo "  WARNING: SonarQube not reachable or no admin password — skipping"
  echo "  Create project manually: sonar admin → Projects → Create Project"
fi

# ── Cleanup ──────────────────────────────────────────────────────────
if [[ "${CLEANUP_WORK_DIR}" == "true" && -n "${WORK_DIR}" ]]; then
  rm -rf "${WORK_DIR}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Import Complete: ${ORG_NAME}/${REPO_NAME}"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Repository:    ${GITEA_EXTERNAL_URL}/${ORG_NAME}/${REPO_NAME}"
echo "  Actions:       ${GITEA_EXTERNAL_URL}/${ORG_NAME}/${REPO_NAME}/actions"
echo ""
echo "  Verify with:"
echo "    curl -sf -H 'Authorization: token ${ADMIN_TOKEN}' \\"
echo "      '${GITEA_EXTERNAL_URL}/api/v1/repos/${ORG_NAME}/${REPO_NAME}/actions/secrets' | python3 -m json.tool"
echo ""
