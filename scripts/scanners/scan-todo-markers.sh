#!/bin/bash
# TODO/FIXME/HACK/XXX Marker Scanner
# Scans codebase for inline improvement markers and outputs JSON findings
# Reads marker definitions and suppression rules from scanner-config.json

set -euo pipefail

# Configuration
REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-todo.json}"
SCANNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCANNER_DIR}/scanner-config.json"

# Load marker configuration from scanner-config.json if available
declare -A MARKER_SEVERITY
declare -A MARKER_BOOST

if [ -f "$CONFIG_FILE" ]; then
  # Read enabled markers from config
  while IFS=$'\t' read -r name severity boost; do
    MARKER_SEVERITY["$name"]="$severity"
    MARKER_BOOST["$name"]="$boost"
  done < <(jq -r '.scanners.todo_markers.markers | to_entries[] | select(.value.enabled == true) | [.key, .value.severity, (.value.priority_boost // 0 | tostring)] | @tsv' "$CONFIG_FILE" 2>/dev/null || true)

  # Read min priority score from config
  MIN_PRIORITY=$(jq -r '.scanners.todo_markers.min_priority_score // 0' "$CONFIG_FILE" 2>/dev/null || echo "0")

  # Read suppression rules into arrays
  SUPPRESS_PATTERNS=()
  SUPPRESS_MARKERS=()
  while IFS=$'\t' read -r pattern markers; do
    SUPPRESS_PATTERNS+=("$pattern")
    SUPPRESS_MARKERS+=("$markers")
  done < <(jq -r '.scanners.todo_markers.suppression_rules[]? | [.pattern, (.markers // [] | join(","))] | @tsv' "$CONFIG_FILE" 2>/dev/null || true)
fi

# Fallback: use defaults if config didn't load any markers
if [ ${#MARKER_SEVERITY[@]} -eq 0 ]; then
  MARKER_SEVERITY=(
    ["FIXME"]="high"
    ["HACK"]="high"
    ["XXX"]="medium"
    ["TODO"]="medium"
    ["OPTIMIZE"]="low"
  )
  MIN_PRIORITY=0
  SUPPRESS_PATTERNS=()
  SUPPRESS_MARKERS=()
fi

# Collect findings in newline-delimited JSON
TEMP_FILE=$(mktemp)

# Count total findings
count=0

# Scan for common markers with a reasonable limit
for marker in "${!MARKER_SEVERITY[@]}"; do
  severity="${MARKER_SEVERITY[$marker]}"
  
  # Priority score based on severity, plus config boost
  boost="${MARKER_BOOST[$marker]:-0}"
  case "$severity" in
    high)     priority_score=$((75 + boost)) ;;
    medium)   priority_score=$((50 + boost)) ;;
    low)      priority_score=$((25 + boost)) ;;
    *)        priority_score=$((50 + boost)) ;;
  esac
  
  # Skip markers below min priority threshold
  if [ "$priority_score" -lt "${MIN_PRIORITY:-0}" ]; then
    continue
  fi
  
  effort="simple"
  [[ "$marker" == "HACK" ]] && effort="standard"
  
  # Find markers (limit to first 20 per marker type to avoid performance issues)
  # Use process substitution to avoid subshell variable loss and || true to
  # prevent pipefail from aborting when grep finds no matches (exit code 1)
  while IFS=: read -r file line content; do
    
    [ -z "$file" ] || [ -z "$line" ] && continue

    # Apply suppression rules from config
    suppressed=false
    for i in "${!SUPPRESS_PATTERNS[@]}"; do
      rule_pattern="${SUPPRESS_PATTERNS[$i]}"
      rule_markers="${SUPPRESS_MARKERS[$i]}"
      # Check if this marker is targeted by the rule (empty = all markers)
      if [ -z "$rule_markers" ] || echo ",$rule_markers," | grep -q ",$marker,"; then
        # Check if file matches the suppression pattern
        if echo "$file" | grep -qE "$rule_pattern"; then
          suppressed=true
          break
        fi
      fi
    done
    if $suppressed; then
      continue
    fi
    
    # Generate stable ID
    id=$(echo -n "${file}:${line}:${marker}" | md5sum | awk '{print $1}')
    
    # Create finding
    jq -n \
      --arg id "$id" \
      --arg source "todo_markers" \
      --arg category "technical_debt" \
      --arg severity "$severity" \
      --argjson priority "$priority_score" \
      --arg title "$marker comment found" \
      --arg desc "Found $marker marker at line $line" \
      --arg file "$file" \
      --argjson line "$line" \
      --arg context "$content" \
      --arg approach "Review the $marker comment and implement the suggested fix" \
      --arg effort "$effort" \
      --arg marker_lower "${marker,,}" \
      --arg marker "$marker" \
      '{
        id: $id,
        source: $source,
        category: $category,
        severity: $severity,
        priority_score: $priority,
        title: $title,
        description: $desc,
        location: {file: $file, line: $line, context: $context},
        suggested_approach: $approach,
        effort_estimate: $effort,
        tags: [$marker_lower, "code-comment", "technical-debt"],
        metadata: {marker_type: $marker}
      }' >> "$TEMP_FILE"
    
    count=$((count + 1))
  done < <(grep -rn \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build \
    --exclude-dir=scanners \
    --exclude="improvement-findings*.json" \
    -E "\b${marker}\b" "$REPO_ROOT" 2>/dev/null | head -20 || true)
done

# Combine into array
if [ -s "$TEMP_FILE" ]; then
  findings=$(jq -s '.' "$TEMP_FILE")
  count=$(echo "$findings" | jq 'length')
else
  findings="[]"
  count=0
fi

rm -f "$TEMP_FILE"

# Output final JSON
cat > "$OUTPUT_FILE" <<EOF
{
  "scanner": "todo_markers",
  "enabled": true,
  "findings_count": $count,
  "findings": $findings
}
EOF

echo "TODO marker scan complete: $count findings"
echo "Output written to: ${OUTPUT_FILE}"