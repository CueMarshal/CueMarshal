#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# SonarQube Issue Scanner
# ═══════════════════════════════════════════════════════════════
# Queries SonarQube API for open issues and outputs findings
# in the standard improvement-findings schema.
#
# Environment variables:
#   SONAR_URL          - SonarQube base URL (default: http://sonarqube:9000)
#   SONAR_TOKEN        - API token for authentication (required)
#   SONAR_PROJECT_KEY  - Project key (default: cuemarshal)
#   REPO_ROOT          - Repository root (default: .)
#   OUTPUT_FILE        - Output file path (default: improvement-findings-sonar.json)

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-sonar.json}"
SCANNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCANNER_DIR}/scanner-config.json"

SONAR_URL="${SONAR_URL:-http://sonarqube:9000/sonar}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}"

# Load configuration from scanner-config.json
MAX_FINDINGS=100
MIN_PRIORITY=40
SEVERITY_FILTER=""
TYPE_FILTER=""

if [ -f "$CONFIG_FILE" ]; then
  sonar_config=$(jq '.scanners.sonarqube // {}' "$CONFIG_FILE" 2>/dev/null || echo '{}')

  # Check if scanner is disabled
  enabled=$(echo "$sonar_config" | jq -r '.enabled // true')
  if [ "$enabled" = "false" ]; then
    echo "  SKIP: SonarQube scanner disabled in config"
    echo '{"scanner":"sonarqube","enabled":false,"findings_count":0,"findings":[]}' > "$OUTPUT_FILE"
    exit 0
  fi

  MAX_FINDINGS=$(echo "$sonar_config" | jq -r '.max_issues // 100')
  MIN_PRIORITY=$(echo "$sonar_config" | jq -r '.min_priority_score // 40')

  # Build severity filter CSV (e.g., "BLOCKER,CRITICAL,MAJOR")
  sf=$(echo "$sonar_config" | jq -r '.severity_filter // [] | join(",")' 2>/dev/null || echo "")
  [ -n "$sf" ] && SEVERITY_FILTER="$sf"

  # Build type filter CSV
  tf=$(echo "$sonar_config" | jq -r '.type_filter // [] | join(",")' 2>/dev/null || echo "")
  [ -n "$tf" ] && TYPE_FILTER="$tf"
fi

# Gracefully skip if SONAR_TOKEN is not set
if [ -z "$SONAR_TOKEN" ]; then
  echo "  SKIP: SONAR_TOKEN not set"
  echo '{"scanner":"sonarqube","enabled":false,"findings_count":0,"findings":[]}' > "$OUTPUT_FILE"
  exit 0
fi

# Verify SonarQube is reachable
if ! curl -sf -u "${SONAR_TOKEN}:" "${SONAR_URL}/api/system/status" > /dev/null 2>&1; then
  echo "  SKIP: SonarQube not reachable at ${SONAR_URL}"
  echo '{"scanner":"sonarqube","enabled":false,"findings_count":0,"findings":[]}' > "$OUTPUT_FILE"
  exit 0
fi

echo "  Querying SonarQube issues for project: ${SONAR_PROJECT_KEY}"

# Build API query parameters
QUERY_PARAMS="componentKeys=${SONAR_PROJECT_KEY}&statuses=OPEN,CONFIRMED,REOPENED&resolved=false"
[ -n "$SEVERITY_FILTER" ] && QUERY_PARAMS="${QUERY_PARAMS}&severities=${SEVERITY_FILTER}"
[ -n "$TYPE_FILTER" ] && QUERY_PARAMS="${QUERY_PARAMS}&types=${TYPE_FILTER}"

# Fetch open issues — page through results
PAGE=1
PAGE_SIZE=100
all_issues="[]"

while true; do
  response=$(curl -sf -u "${SONAR_TOKEN}:" \
    "${SONAR_URL}/api/issues/search?${QUERY_PARAMS}&ps=${PAGE_SIZE}&p=${PAGE}" \
    2>/dev/null || echo '{"issues":[]}')

  page_issues=$(echo "$response" | jq '.issues // []')
  page_count=$(echo "$page_issues" | jq 'length')

  if [ "$page_count" -eq 0 ]; then
    break
  fi

  all_issues=$(echo "$all_issues" | jq --argjson new "$page_issues" '. + $new')
  total=$(echo "$all_issues" | jq 'length')

  if [ "$total" -ge "$MAX_FINDINGS" ]; then
    all_issues=$(echo "$all_issues" | jq ".[0:${MAX_FINDINGS}]")
    break
  fi

  PAGE=$((PAGE + 1))
done

# Map SonarQube severity → schema severity
map_severity() {
  case "$1" in
    BLOCKER)  echo "critical" ;;
    CRITICAL) echo "critical" ;;
    MAJOR)    echo "high" ;;
    MINOR)    echo "medium" ;;
    INFO)     echo "low" ;;
    *)        echo "medium" ;;
  esac
}

# Map SonarQube type → schema category
map_category() {
  case "$1" in
    BUG)              echo "code_quality" ;;
    VULNERABILITY)    echo "code_quality" ;;
    CODE_SMELL)       echo "technical_debt" ;;
    SECURITY_HOTSPOT) echo "code_quality" ;;
    *)                echo "code_quality" ;;
  esac
}

# Priority score based on severity + type
calc_priority() {
  local severity="$1"
  local type="$2"
  local base=50

  case "$severity" in
    BLOCKER)  base=95 ;;
    CRITICAL) base=85 ;;
    MAJOR)    base=65 ;;
    MINOR)    base=40 ;;
    INFO)     base=20 ;;
  esac

  # Boost for security issues
  if [ "$type" = "VULNERABILITY" ] || [ "$type" = "SECURITY_HOTSPOT" ]; then
    base=$((base + 10))
    [ "$base" -gt 100 ] && base=100
  fi

  echo "$base"
}

# Effort mapping from SonarQube debt strings
map_effort() {
  local debt="$1"
  if echo "$debt" | grep -qE '^[0-9]+min$'; then
    minutes=$(echo "$debt" | grep -oE '[0-9]+')
    if [ "$minutes" -le 30 ]; then echo "simple"; else echo "standard"; fi
  elif echo "$debt" | grep -qE '^[0-9]+h$'; then
    echo "standard"
  elif echo "$debt" | grep -qE '^[0-9]+d$'; then
    echo "complex"
  else
    echo "standard"
  fi
}

# Convert SonarQube issues to findings schema
# Use process substitution to avoid subshell variable loss
TEMP_FILE=$(mktemp)
count=0

while IFS= read -r issue; do
  key=$(echo "$issue" | jq -r '.key')
  rule=$(echo "$issue" | jq -r '.rule')
  sonar_severity=$(echo "$issue" | jq -r '.severity // "MAJOR"')
  sonar_type=$(echo "$issue" | jq -r '.type // "CODE_SMELL"')
  message=$(echo "$issue" | jq -r '.message // "No message"')
  component=$(echo "$issue" | jq -r '.component // ""' | sed "s|^${SONAR_PROJECT_KEY}:||")
  line=$(echo "$issue" | jq -r '.line // 0')
  debt=$(echo "$issue" | jq -r '.debt // "30min"')

  severity=$(map_severity "$sonar_severity")
  category=$(map_category "$sonar_type")
  priority=$(calc_priority "$sonar_severity" "$sonar_type")
  effort=$(map_effort "$debt")

  # Skip findings below minimum priority
  if [ "$priority" -lt "$MIN_PRIORITY" ]; then
    continue
  fi

  id=$(echo -n "sonar:${key}" | md5sum | awk '{print $1}')

  jq -n \
    --arg id "$id" \
    --arg source "sonarqube" \
    --arg category "$category" \
    --arg severity "$severity" \
    --argjson priority "$priority" \
    --arg title "Sonar: ${message}" \
    --arg desc "SonarQube ${sonar_type} (${rule}): ${message}" \
    --arg file "$component" \
    --argjson line "$line" \
    --arg approach "Fix the ${sonar_type,,} identified by rule ${rule}. Refer to SonarQube rule documentation for guidance." \
    --arg effort "$effort" \
    --arg rule "$rule" \
    --arg sonar_type "${sonar_type,,}" \
    --arg sonar_key "$key" \
    '{
      id: $id,
      source: $source,
      category: $category,
      severity: $severity,
      priority_score: $priority,
      title: $title,
      description: $desc,
      location: {file: $file, line: $line},
      suggested_approach: $approach,
      effort_estimate: $effort,
      tags: ["sonarqube", $sonar_type, $rule],
      metadata: {sonar_key: $sonar_key, sonar_rule: $rule, sonar_type: $sonar_type}
    }' >> "$TEMP_FILE"

  count=$((count + 1))
done < <(echo "$all_issues" | jq -c '.[]')

# Combine into array
if [ -s "$TEMP_FILE" ]; then
  findings=$(jq -s '.' "$TEMP_FILE")
  count=$(echo "$findings" | jq 'length')
else
  findings="[]"
  count=0
fi
rm -f "$TEMP_FILE"

echo "  Found $count SonarQube issues"

cat > "$OUTPUT_FILE" <<EOF
{
  "scanner": "sonarqube",
  "enabled": true,
  "findings_count": ${count},
  "findings": ${findings}
}
EOF
