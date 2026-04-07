#!/bin/bash
# Stale Documentation Scanner
# Scans for missing or outdated documentation
# Reads excluded directories and suppression rules from scanner-config.json

set -euo pipefail

# Configuration
REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-docs.json}"
SCANNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCANNER_DIR}/scanner-config.json"

# Default excluded directories
EXCLUDE_DIRS=(".git" "node_modules" "dist" "build" "coverage")

# Load configuration from scanner-config.json if available
CONFIG_SUPPRESS_PATTERNS=()
CONFIG_SUPPRESS_MIN_FILES=()

if [ -f "$CONFIG_FILE" ]; then
  # Read excluded directories from config
  config_dirs=()
  while IFS= read -r dir; do
    config_dirs+=("$dir")
  done < <(jq -r '.scanners.stale_documentation.excluded_directories[]?' "$CONFIG_FILE" 2>/dev/null || true)
  if [ ${#config_dirs[@]} -gt 0 ]; then
    EXCLUDE_DIRS=("${config_dirs[@]}")
  fi

  # Read suppression rules (pattern + optional min_code_files)
  while IFS=$'\t' read -r pattern min_files; do
    CONFIG_SUPPRESS_PATTERNS+=("$pattern")
    CONFIG_SUPPRESS_MIN_FILES+=("${min_files:-0}")
  done < <(jq -r '.scanners.stale_documentation.suppression_rules[]? | [.pattern, (.min_code_files // 0 | tostring)] | @tsv' "$CONFIG_FILE" 2>/dev/null || true)
fi

# Build find exclusion args
FIND_EXCLUDES=()
for dir in "${EXCLUDE_DIRS[@]}"; do
  FIND_EXCLUDES+=(-not -path "*/${dir}/*")
done

# Collect findings
TEMP_FILE=$(mktemp)
count=0

# Check for directories with code but no README
# Use process substitution to avoid subshell variable loss
while read -r dir; do
  
  # Skip root
  [ "$dir" = "$REPO_ROOT" ] || [ "$dir" = "." ] && continue
  
  # Count code files
  code_files=$(find "$dir" -maxdepth 1 \( -name "*.ts" -o -name "*.js" -o -name "*.py" \) 2>/dev/null | wc -l)
  
  # Need at least 2 code files
  [ "$code_files" -lt 2 ] && continue
  
  # Check for README
  if [ ! -f "$dir/README.md" ] && [ ! -f "$dir/README" ]; then
    dir_name=$(basename "$dir")
    rel_dir="${dir#./}"
    rel_dir="${rel_dir#$REPO_ROOT/}"

    # Apply suppression rules from config
    suppressed=false
    for i in "${!CONFIG_SUPPRESS_PATTERNS[@]}"; do
      sup_pattern="${CONFIG_SUPPRESS_PATTERNS[$i]}"
      sup_min_files="${CONFIG_SUPPRESS_MIN_FILES[$i]:-0}"
      if echo "${rel_dir}/" | grep -qE "$sup_pattern"; then
        # If rule has min_code_files, only suppress if below threshold
        if [ "$sup_min_files" -gt 0 ]; then
          [ "$code_files" -lt "$sup_min_files" ] && suppressed=true
        else
          suppressed=true
        fi
        break
      fi
    done
    if $suppressed; then
      continue
    fi
    
    # Determine severity
    severity="medium"
    priority=40
    
    if [[ "$dir" =~ (service|api|mcp) ]]; then
      severity="high"
      priority=60
    fi
    
    id=$(echo -n "${rel_dir}:no-readme" | md5sum | awk '{print $1}')
    
    jq -n \
      --arg id "$id" \
      --arg source "stale_documentation" \
      --arg category "documentation" \
      --arg severity "$severity" \
      --argjson priority "$priority" \
      --arg title "Add README for $dir_name/" \
      --arg desc "Directory '$rel_dir' has $code_files code files but no README" \
      --arg file "${rel_dir}/" \
      --arg approach "Create a README.md describing the module purpose and usage" \
      --argjson code_count "$code_files" \
      '{
        id: $id,
        source: $source,
        category: $category,
        severity: $severity,
        priority_score: $priority,
        title: $title,
        description: $desc,
        location: {file: $file},
        suggested_approach: $approach,
        effort_estimate: "simple",
        tags: ["documentation", "readme", "missing"],
        metadata: {directory: $file, code_files_count: $code_count}
      }' >> "$TEMP_FILE"
    
    count=$((count + 1))
  fi
done < <(find "$REPO_ROOT" -type d "${FIND_EXCLUDES[@]}" 2>/dev/null || true)

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
  "scanner": "stale_documentation",
  "enabled": true,
  "findings_count": $count,
  "findings": $findings
}
EOF

echo "Stale documentation scan complete: $count findings"
echo "Output written to: ${OUTPUT_FILE}"