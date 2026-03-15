#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# sonar-scan.sh — Spin up SonarQube + sonar-scanner-cli, scan a project,
#                 and write SCAN-{project}-sonarqube-{date}.md findings reports
# ═══════════════════════════════════════════════════════════════════════════════
#
# Usage:
#   bash scripts/sonar-scan.sh [PROJECT_PATH]
#
# Arguments:
#   PROJECT_PATH   Path to the repository to scan
#                  Default: .
#
# Environment variables (all optional):
#   PROJECT_NAME        Short name used in report filenames (default: basename of PROJECT_PATH)
#   SONAR_ADMIN_PASS    SonarQube admin password to set (default: SonarAdmin123!)
#   SONAR_PORT          Host port to expose SonarQube on (default: 9000)
#   REPORT_DIR          Directory to write markdown reports (default: ~/openclaw-docker/data/workspace/reports)
#   SONAR_MEMORY        Memory limit for SonarQube container (default: 3g)
#   KEEP_SONAR          Set to "1" to leave the SonarQube container running after scan
#
# Prerequisites:
#   docker, jq, curl
#
# Output:
#   SCAN-{PROJECT_NAME}-sonarqube-{YYYYMMDD}.md    — consolidated report
#   Individual component reports when multiple sonar.modules are detected

set -euo pipefail

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
PROJECT_PATH="${1:-.}"
PROJECT_PATH="$(cd "${PROJECT_PATH}" && pwd)"           # resolve to absolute path
PROJECT_NAME="${PROJECT_NAME:-$(basename "${PROJECT_PATH}")}"
SONAR_ADMIN_PASS="${SONAR_ADMIN_PASS:-SonarAdmin123!}"
SONAR_PORT="${SONAR_PORT:-9001}"
SONAR_MEMORY="${SONAR_MEMORY:-3g}"
KEEP_SONAR="${KEEP_SONAR:-0}"
DATE="$(date +%Y%m%d)"
REPORT_DIR="${REPORT_DIR:-${PROJECT_PATH}/reports}"

SONAR_CONTAINER="sonarqube-scan-${$}"
SONAR_NETWORK="sonarqube-net-${$}"
TOKEN_NAME="${PROJECT_NAME}-scanner-${DATE}-$$"
PROJECT_KEY="${PROJECT_NAME}"

# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────
log()   { echo "  $*"; }
info()  { echo ""; echo "▶ $*"; }
ok()    { echo "  ✓ $*"; }
warn()  { echo "  ⚠ $*"; }
die()   { echo ""; echo "✗ ERROR: $*" >&2; exit 1; }

cleanup() {
  if [ "${USING_EXISTING_SONAR}" = "1" ]; then
    ok "Using pre-existing SonarQube — container left running"
    return
  fi
  if [ "${KEEP_SONAR}" = "1" ]; then
    warn "Leaving SonarQube container '${SONAR_CONTAINER}' running (KEEP_SONAR=1)"
    warn "Stop it later with: docker stop ${SONAR_CONTAINER} && docker network rm ${SONAR_NETWORK}"
  else
    info "Cleanup"
    docker stop "${SONAR_CONTAINER}" 2>/dev/null && ok "Stopped SonarQube container" || true
    docker network rm "${SONAR_NETWORK}" 2>/dev/null && ok "Removed Docker network" || true
  fi
}

# ──────────────────────────────────────────────────────────────
# Pre-flight checks
# ──────────────────────────────────────────────────────────────
info "SonarQube Scan — ${PROJECT_NAME}"
log "Project path : ${PROJECT_PATH}"
log "Report dir   : ${REPORT_DIR}"
log "Date         : ${DATE}"

command -v docker >/dev/null 2>&1 || die "docker is required"
command -v jq     >/dev/null 2>&1 || die "jq is required"
command -v curl   >/dev/null 2>&1 || die "curl is required"
[ -d "${PROJECT_PATH}" ]          || die "Project path not found: ${PROJECT_PATH}"
mkdir -p "${REPORT_DIR}"

# Check vm.max_map_count (SonarQube/Elasticsearch needs ≥ 262144)
CURRENT_MAP_COUNT=$(cat /proc/sys/vm/max_map_count 2>/dev/null || echo 0)
if [ "${CURRENT_MAP_COUNT}" -lt 262144 ]; then
  warn "vm.max_map_count=${CURRENT_MAP_COUNT} is low; SonarQube may fail."
  warn "To fix: sudo sysctl -w vm.max_map_count=524288"
fi

# ──────────────────────────────────────────────────────────────
# Detect existing SonarQube instance (skip container startup if found)
# ──────────────────────────────────────────────────────────────
USING_EXISTING_SONAR=0
SONAR_EXISTING_PORT=""

# Check the configured port first, then the conventional default (9000)
for CHECK_PORT in "${SONAR_PORT}" "9000"; do
  if curl -sf "http://localhost:${CHECK_PORT}/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; then
    SONAR_EXISTING_PORT="${CHECK_PORT}"
    USING_EXISTING_SONAR=1
    info "Detected running SonarQube at http://localhost:${CHECK_PORT} — skipping container startup"
    break
  fi
done

if [ "${USING_EXISTING_SONAR}" = "1" ]; then
  SONAR_HOST_URL="http://localhost:${SONAR_EXISTING_PORT}"
  # Scanner-cli will run with --network host so localhost resolves inside the container
  SONAR_INTERNAL_URL="${SONAR_HOST_URL}"
  SONAR_NETWORK_ARGS="--network host"
fi

# ──────────────────────────────────────────────────────────────
# Step 1: Docker network (skipped when using existing SonarQube)
# ──────────────────────────────────────────────────────────────
if [ "${USING_EXISTING_SONAR}" = "0" ]; then
  info "Creating Docker network"
  docker network create "${SONAR_NETWORK}" >/dev/null
  ok "Network '${SONAR_NETWORK}' created"
fi

trap cleanup EXIT

# ──────────────────────────────────────────────────────────────
# Step 2: Start SonarQube (skipped when using existing instance)
# ──────────────────────────────────────────────────────────────
if [ "${USING_EXISTING_SONAR}" = "0" ]; then
  info "Starting SonarQube Community Edition"
  log "Image   : sonarqube:community"
  log "Memory  : ${SONAR_MEMORY}"
  log "Port    : ${SONAR_PORT}:9000"

  docker run -d \
    --name "${SONAR_CONTAINER}" \
    --network "${SONAR_NETWORK}" \
    --network-alias sonarqube \
    -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
    -m "${SONAR_MEMORY}" \
    -p "${SONAR_PORT}:9000" \
    sonarqube:community >/dev/null

  ok "Container '${SONAR_CONTAINER}' started"

  SONAR_HOST_URL="http://localhost:${SONAR_PORT}"
  SONAR_INTERNAL_URL="http://sonarqube:9000"
  SONAR_NETWORK_ARGS="--network ${SONAR_NETWORK}"

  # ──────────────────────────────────────────────────────────────
  # Step 3: Wait for SonarQube to be ready
  # ──────────────────────────────────────────────────────────────
  info "Waiting for SonarQube to become ready (may take 60-120s)"
  RETRIES=0
  MAX_RETRIES=60
  until curl -sf "${SONAR_HOST_URL}/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; do
    RETRIES=$((RETRIES + 1))
    if [ "${RETRIES}" -ge "${MAX_RETRIES}" ]; then
      die "SonarQube did not become ready within $((MAX_RETRIES * 5))s"
    fi
    printf "."
    sleep 5
  done
  echo ""
  ok "SonarQube is ready (${RETRIES} × 5s = $((RETRIES * 5))s)"

  # ──────────────────────────────────────────────────────────────
  # Step 4: Change admin password
  # ──────────────────────────────────────────────────────────────
  info "Configuring SonarQube admin"
  PASS_CHANGE=$(curl -sf -u admin:admin -X POST \
    "${SONAR_HOST_URL}/api/users/change_password" \
    -d "login=admin&previousPassword=admin&password=${SONAR_ADMIN_PASS}" \
    2>/dev/null && echo "changed" || echo "skipped")
  log "Password: ${PASS_CHANGE}"
fi

# ──────────────────────────────────────────────────────────────
# Step 5: Determine scan targets from sonar-project.properties
# ──────────────────────────────────────────────────────────────
info "Determining scan targets"
PROPS_FILE="${PROJECT_PATH}/sonar-project.properties"
SCAN_TARGETS=()   # array of "key:name:sources" triples

if [ -f "${PROPS_FILE}" ]; then
  log "Found sonar-project.properties"
  PROPS_KEY=$(grep -E '^sonar\.projectKey\s*=' "${PROPS_FILE}" 2>/dev/null | cut -d= -f2 | tr -d ' \r' || echo "")
  PROPS_SOURCES=$(grep -E '^sonar\.sources\s*=' "${PROPS_FILE}" 2>/dev/null | cut -d= -f2 | tr -d ' \r' || echo ".")
  PROPS_NAME=$(grep -E '^sonar\.projectName\s*=' "${PROPS_FILE}" 2>/dev/null | cut -d= -f2 | tr -d '\r' | xargs || echo "${PROJECT_NAME}")

  if [ -n "${PROPS_KEY}" ]; then
    PROJECT_KEY="${PROPS_KEY}"
    SCAN_TARGETS+=("${PROJECT_KEY}:::${PROPS_NAME}:::${PROPS_SOURCES}:::")
    ok "Using sonar-project.properties: key=${PROJECT_KEY}, sources=${PROPS_SOURCES}"
  fi
fi

# If no properties file, infer targets by looking for common source dirs
if [ ${#SCAN_TARGETS[@]} -eq 0 ]; then
  log "No sonar-project.properties found — auto-detecting source structure"
  if [ -d "${PROJECT_PATH}/src" ]; then
    SCAN_TARGETS+=("${PROJECT_KEY}:::${PROJECT_NAME}:::src:::")
    ok "Detected: src/"
  elif [ -d "${PROJECT_PATH}/code" ]; then
    SCAN_TARGETS+=("${PROJECT_KEY}:::${PROJECT_NAME}:::code:::")
    ok "Detected: code/"
  else
    SCAN_TARGETS+=("${PROJECT_KEY}:::${PROJECT_NAME}:::.:::")
    ok "Defaulting to: . (entire repo)"
  fi
fi

# ──────────────────────────────────────────────────────────────
# Step 6: Create projects + generate tokens + run scans
# ──────────────────────────────────────────────────────────────
declare -A PROJECT_TOKENS  # key → token

for TARGET in "${SCAN_TARGETS[@]}"; do
  KEY=$(echo "${TARGET}" | cut -d: -f1)
  NAME=$(echo "${TARGET}" | awk -F':::' '{print $2}')
  SOURCES=$(echo "${TARGET}" | awk -F':::' '{print $3}')

  info "Setting up project: ${KEY}"

  # Create project
  curl -sf -u "admin:${SONAR_ADMIN_PASS}" -X POST \
    "${SONAR_HOST_URL}/api/projects/create" \
    -d "name=${NAME}&project=${KEY}" >/dev/null 2>&1 && ok "Project '${KEY}' created" || warn "Project '${KEY}' may already exist"

  # Generate analysis token
  TOKEN_RESP=$(curl -sf -u "admin:${SONAR_ADMIN_PASS}" -X POST \
    "${SONAR_HOST_URL}/api/user_tokens/generate" \
    -d "name=${TOKEN_NAME}-${KEY}&type=GLOBAL_ANALYSIS_TOKEN" 2>/dev/null || echo "")

  if echo "${TOKEN_RESP}" | jq -e '.token' >/dev/null 2>&1; then
    SCAN_TOKEN=$(echo "${TOKEN_RESP}" | jq -r '.token')
    PROJECT_TOKENS["${KEY}"]="${SCAN_TOKEN}"
    ok "Token generated for ${KEY}: ${SCAN_TOKEN:0:12}…"
  else
    die "Failed to generate analysis token for project '${KEY}'. Response: ${TOKEN_RESP}"
  fi
done

# ──────────────────────────────────────────────────────────────
# Step 7: Run sonar-scanner-cli
# ──────────────────────────────────────────────────────────────
info "Running sonar-scanner-cli"
log "Image: sonarsource/sonar-scanner-cli:latest"

for TARGET in "${SCAN_TARGETS[@]}"; do
  KEY=$(echo "${TARGET}" | cut -d: -f1)
  NAME=$(echo "${TARGET}" | awk -F':::' '{print $2}')
  SOURCES=$(echo "${TARGET}" | awk -F':::' '{print $3}')
  SCAN_TOKEN="${PROJECT_TOKENS[${KEY}]}"

  log "Scanning ${KEY} (sources: ${SOURCES})"

  EXTRA_PROPS=""
  # If sonar-project.properties exists, mount it (scanner-cli reads it by default)
  PROPS_MOUNT=""
  if [ -f "${PROJECT_PATH}/sonar-project.properties" ]; then
    PROPS_MOUNT="-v ${PROJECT_PATH}/sonar-project.properties:/usr/src/sonar-project.properties:ro"
  fi

  # shellcheck disable=SC2086
  docker run --rm \
    ${SONAR_NETWORK_ARGS} \
    -v "${PROJECT_PATH}:/usr/src" \
    ${PROPS_MOUNT} \
    sonarsource/sonar-scanner-cli:latest \
    -Dsonar.projectKey="${KEY}" \
    -Dsonar.projectName="${NAME}" \
    -Dsonar.sources="${SOURCES}" \
    -Dsonar.host.url="${SONAR_INTERNAL_URL}" \
    -Dsonar.token="${SCAN_TOKEN}" \
    -Dsonar.scm.disabled=true \
    2>&1 | grep -E "INFO.*EXECUT|INFO.*WARN|WARN|ERROR|SUCCESS|FAILURE|files indexed|issues" | head -40 || true

  ok "Scan submitted for ${KEY}"
done

# ──────────────────────────────────────────────────────────────
# Step 8: Wait for analysis tasks to complete
# ──────────────────────────────────────────────────────────────
info "Waiting for analysis tasks to process"
sleep 5
RETRIES=0
MAX_RETRIES=30
until [ "$(curl -sf -u "admin:${SONAR_ADMIN_PASS}" \
    "${SONAR_HOST_URL}/api/ce/activity?status=IN_PROGRESS,PENDING&ps=1" 2>/dev/null \
    | jq -r '.total // 0')" = "0" ]; do
  RETRIES=$((RETRIES + 1))
  if [ "${RETRIES}" -ge "${MAX_RETRIES}" ]; then
    warn "Analysis tasks did not complete within $((MAX_RETRIES * 5))s — continuing anyway"
    break
  fi
  printf "."
  sleep 5
done
echo ""
ok "Analysis tasks complete"
# Brief pause to allow SonarQube's search index to catch up before querying issues
sleep 5

# ──────────────────────────────────────────────────────────────
# Step 9: Fetch issues and generate markdown reports
# ──────────────────────────────────────────────────────────────
map_severity_emoji() {
  case "$1" in
    BLOCKER)  echo "🔴" ;;
    CRITICAL) echo "🔴" ;;
    MAJOR)    echo "🟠" ;;
    MINOR)    echo "🟡" ;;
    INFO)     echo "🔵" ;;
    *)        echo "⚪" ;;
  esac
}

map_severity_label() {
  case "$1" in
    BLOCKER)  echo "Blocker" ;;
    CRITICAL) echo "Critical" ;;
    MAJOR)    echo "Major" ;;
    MINOR)    echo "Minor" ;;
    INFO)     echo "Info" ;;
    *)        echo "Unknown" ;;
  esac
}

map_type_label() {
  case "$1" in
    BUG)              echo "Bug" ;;
    VULNERABILITY)    echo "Vulnerability" ;;
    CODE_SMELL)       echo "Code Smell" ;;
    SECURITY_HOTSPOT) echo "Security Hotspot" ;;
    *)                echo "$1" ;;
  esac
}

fetch_issues() {
  local key="$1"
  local token="$2"
  local page=1
  local page_size=100
  local all_issues="[]"

  while true; do
    local response
    response=$(curl -sf -u "${token}:" \
      "${SONAR_HOST_URL}/api/issues/search?componentKeys=${key}&statuses=OPEN,CONFIRMED,REOPENED&resolved=false&ps=${page_size}&p=${page}" \
      2>/dev/null || echo '{"issues":[]}')

    local page_issues
    page_issues=$(echo "${response}" | jq '.issues // []')
    local count
    count=$(echo "${page_issues}" | jq 'length')

    [ "${count}" -eq 0 ] && break

    all_issues=$(echo "${all_issues}" | jq --argjson new "${page_issues}" '. + $new')
    local total
    total=$(echo "${all_issues}" | jq 'length')
    local max_total
    max_total=$(echo "${response}" | jq -r '.total // 0')

    [ "${total}" -ge "${max_total}" ] && break
    page=$((page + 1))
  done

  echo "${all_issues}"
}

generate_markdown() {
  local key="$1"
  local name="$2"
  local token="$3"
  local report_file="$4"

  info "Generating report for ${key}"

  local issues
  issues=$(fetch_issues "${key}" "${token}")
  local total
  total=$(echo "${issues}" | jq 'length')

  log "Total issues fetched: ${total}"

  # Count by severity
  local blockers criticals majors minors infos
  blockers=$(echo "${issues}" | jq '[.[] | select(.severity=="BLOCKER")] | length')
  criticals=$(echo "${issues}" | jq '[.[] | select(.severity=="CRITICAL")] | length')
  majors=$(echo "${issues}" | jq '[.[] | select(.severity=="MAJOR")] | length')
  minors=$(echo "${issues}" | jq '[.[] | select(.severity=="MINOR")] | length')
  infos=$(echo "${issues}" | jq '[.[] | select(.severity=="INFO")] | length')

  # Count by type
  local bugs vulns smells hotspots
  bugs=$(echo "${issues}" | jq '[.[] | select(.type=="BUG")] | length')
  vulns=$(echo "${issues}" | jq '[.[] | select(.type=="VULNERABILITY")] | length')
  smells=$(echo "${issues}" | jq '[.[] | select(.type=="CODE_SMELL")] | length')
  hotspots=$(echo "${issues}" | jq '[.[] | select(.type=="SECURITY_HOTSPOT")] | length')

  local scan_status="NO ISSUES FOUND"
  [ "${total}" -gt 0 ] && scan_status="ISSUES FOUND"

  # Get project metrics (lines of code, coverage, etc.)
  local metrics
  metrics=$(curl -sf -u "admin:${SONAR_ADMIN_PASS}" \
    "${SONAR_HOST_URL}/api/measures/component?component=${key}&metricKeys=ncloc,complexity,coverage,duplicated_lines_density,code_smells,bugs,vulnerabilities" \
    2>/dev/null || echo '{}')

  get_metric() {
    echo "${metrics}" | jq -r --arg m "$1" '.component.measures[]? | select(.metric==$m) | .value // "N/A"' 2>/dev/null || echo "N/A"
  }

  local ncloc complexity coverage dup_density
  ncloc=$(get_metric "ncloc")
  complexity=$(get_metric "complexity")
  coverage=$(get_metric "coverage")
  dup_density=$(get_metric "duplicated_lines_density")

  {
    echo "# SonarQube Scan: ${name}"
    echo "**Date:** $(date +%Y-%m-%d)  "
    echo "**Project Key:** \`${key}\`  "
    echo "**Scanner:** SonarQube Community Edition (sonarqube:community)  "
    echo "**Scan Status:** ${scan_status}"
    echo ""
    echo "---"
    echo ""
    echo "## Project Metrics"
    echo ""
    echo "| Metric | Value |"
    echo "| ------ | ----- |"
    echo "| Lines of Code | ${ncloc} |"
    echo "| Complexity | ${complexity} |"
    echo "| Coverage | ${coverage}% |"
    echo "| Duplication | ${dup_density}% |"
    echo ""
    echo "---"
    echo ""
    echo "## Summary"
    echo ""
    echo "| Severity | Count |"
    echo "| -------- | ----- |"
    echo "| 🔴 Blocker | ${blockers} |"
    echo "| 🔴 Critical | ${criticals} |"
    echo "| 🟠 Major | ${majors} |"
    echo "| 🟡 Minor | ${minors} |"
    echo "| 🔵 Info | ${infos} |"
    echo "| **Total** | **${total}** |"
    echo ""
    echo "| Type | Count |"
    echo "| ---- | ----- |"
    echo "| 🐛 Bugs | ${bugs} |"
    echo "| 🔒 Vulnerabilities | ${vulns} |"
    echo "| 💨 Code Smells | ${smells} |"
    echo "| 🔥 Security Hotspots | ${hotspots} |"
    echo ""
    echo "---"
    echo ""
    echo "## Issues"
    echo ""

    if [ "${total}" -eq 0 ]; then
      echo "_No open issues found. 🎉_"
    else
      for sev in BLOCKER CRITICAL MAJOR MINOR INFO; do
        local sev_issues
        sev_issues=$(echo "${issues}" | jq --arg s "${sev}" '[.[] | select(.severity==$s)]')
        local sev_count
        sev_count=$(echo "${sev_issues}" | jq 'length')
        [ "${sev_count}" -eq 0 ] && continue

        local emoji label
        emoji=$(map_severity_emoji "${sev}")
        label=$(map_severity_label "${sev}")

        echo "### ${emoji} ${label} (${sev_count})"
        echo ""

        local idx=0
        while IFS= read -r issue; do
          idx=$((idx + 1))
          local rule type message component line debt effort
          rule=$(echo "${issue}" | jq -r '.rule // ""')
          type=$(echo "${issue}" | jq -r '.type // "CODE_SMELL"')
          message=$(echo "${issue}" | jq -r '.message // ""')
          component=$(echo "${issue}" | jq -r '.component // ""' | sed "s|^${key}:||")
          line=$(echo "${issue}" | jq -r '.line // ""')
          debt=$(echo "${issue}" | jq -r '.debt // ""')
          effort=$(echo "${issue}" | jq -r '.effort // ""')
          local type_label
          type_label=$(map_type_label "${type}")

          local location="${component}"
          [ -n "${line}" ] && location="${component}:${line}"

          echo "#### ${idx}. ${message}"
          echo ""
          echo "- **Type:** ${type_label}"
          echo "- **Rule:** \`${rule}\`"
          echo "- **File:** \`${location}\`"
          [ -n "${debt}" ]   && echo "- **Debt:** ${debt}"
          [ -n "${effort}" ] && echo "- **Effort:** ${effort}"
          echo ""

        done < <(echo "${sev_issues}" | jq -c '.[]')

      done
    fi

    echo "---"
    echo ""
    echo "_Report generated by \`scripts/sonar-scan.sh\` on $(date -u '+%Y-%m-%dT%H:%M:%SZ')_"

  } > "${report_file}"

  ok "Report written: ${report_file}"
}

# Generate reports for each scanned project
for TARGET in "${SCAN_TARGETS[@]}"; do
  KEY=$(echo "${TARGET}" | cut -d: -f1)
  NAME=$(echo "${TARGET}" | awk -F':::' '{print $2}')
  SCAN_TOKEN="${PROJECT_TOKENS[${KEY}]}"

  REPORT_FILE="${REPORT_DIR}/SCAN-${PROJECT_NAME}-sonarqube-${DATE}.md"

  # If multiple projects, suffix the key
  if [ ${#SCAN_TARGETS[@]} -gt 1 ]; then
    REPORT_FILE="${REPORT_DIR}/SCAN-${PROJECT_NAME}-${KEY}-sonarqube-${DATE}.md"
  fi

  generate_markdown "${KEY}" "${NAME}" "${SCAN_TOKEN}" "${REPORT_FILE}"
done

# ──────────────────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────────────────
info "Scan complete"
log ""
log "Reports written to: ${REPORT_DIR}"
for TARGET in "${SCAN_TARGETS[@]}"; do
  KEY=$(echo "${TARGET}" | cut -d: -f1)
  REPORT_FILE="${REPORT_DIR}/SCAN-${PROJECT_NAME}-sonarqube-${DATE}.md"
  [ ${#SCAN_TARGETS[@]} -gt 1 ] && REPORT_FILE="${REPORT_DIR}/SCAN-${PROJECT_NAME}-${KEY}-sonarqube-${DATE}.md"
  log "  ${REPORT_FILE}"
done
log ""
log "SonarQube UI: ${SONAR_HOST_URL} (admin / ${SONAR_ADMIN_PASS})"
log ""
