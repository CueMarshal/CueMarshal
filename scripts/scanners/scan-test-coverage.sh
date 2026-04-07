#!/bin/bash
# Test Coverage Scanner
# Scans for source files without corresponding test files
# Reads excluded patterns, critical paths, and suppression rules from scanner-config.json

set -euo pipefail

# Configuration
REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-tests.json}"
SCANNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCANNER_DIR}/scanner-config.json"

# Exclusion patterns
EXCLUDE_DIRS=(
  ".git"
  "node_modules"
  ".gitea"
  ".github"
  "dist"
  "build"
  "coverage"
  "__pycache__"
  ".venv"
  "venv"
  "migrations"
)

# Load configuration from scanner-config.json if available
CONFIG_EXCLUDE_PATTERNS=()
CONFIG_CRITICAL_PATHS=()
CONFIG_SUPPRESS_PATTERNS=()
MIN_PRIORITY=0

if [ -f "$CONFIG_FILE" ]; then
  # Read excluded patterns from config (regex patterns for files to skip)
  while IFS= read -r pattern; do
    CONFIG_EXCLUDE_PATTERNS+=("$pattern")
  done < <(jq -r '.scanners.test_coverage.excluded_patterns[]?' "$CONFIG_FILE" 2>/dev/null || true)

  # Read critical paths from config (regex patterns that boost priority)
  while IFS= read -r pattern; do
    CONFIG_CRITICAL_PATHS+=("$pattern")
  done < <(jq -r '.scanners.test_coverage.critical_paths[]?' "$CONFIG_FILE" 2>/dev/null || true)

  # Read suppression rules
  while IFS= read -r pattern; do
    CONFIG_SUPPRESS_PATTERNS+=("$pattern")
  done < <(jq -r '.scanners.test_coverage.suppression_rules[]?.pattern' "$CONFIG_FILE" 2>/dev/null || true)

  # Read min priority score
  MIN_PRIORITY=$(jq -r '.scanners.test_coverage.min_priority_score // 0' "$CONFIG_FILE" 2>/dev/null || echo "0")
fi

# Test file patterns by language
declare -A TEST_PATTERNS=(
  [".ts"]=".test.ts .spec.ts"
  [".tsx"]=".test.tsx .spec.tsx"
  [".js"]=".test.js .spec.js"
  [".jsx"]=".test.jsx .spec.jsx"
  [".py"]="_test.py test_.py"
  [".go"]="_test.go"
)

# Initialize findings array
findings="[]"

# Function to check if test file exists for a source file
has_test_file() {
  local source_file="$1"
  local ext="${source_file##*.}"
  local basename="${source_file%.*}"
  
  # Get test patterns for this extension
  local patterns="${TEST_PATTERNS[.${ext}]:-}"
  [ -z "$patterns" ] && return 1
  
  # Check each pattern
  for pattern in $patterns; do
    local test_file="${basename}${pattern}"
    if [ -f "$test_file" ]; then
      return 0
    fi
  done
  
  return 1
}

# Function to check if file should be excluded by config patterns
should_exclude() {
  local file="$1"
  # Apply config exclusion patterns
  for pattern in "${CONFIG_EXCLUDE_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      return 0
    fi
  done
  # Apply suppression rules
  for pattern in "${CONFIG_SUPPRESS_PATTERNS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      return 0
    fi
  done
  return 1
}

# Function to determine if file is likely critical (higher priority for tests)
is_critical_path() {
  local file="$1"
  
  # Check config-defined critical paths first
  for pattern in "${CONFIG_CRITICAL_PATHS[@]}"; do
    if echo "$file" | grep -qE "$pattern"; then
      echo "high"
      return
    fi
  done
  
  # Fallback: hardcoded patterns indicating critical code paths
  if [[ "$file" =~ (auth|login|payment|security|crypto|api/routes) ]]; then
    echo "high"
    return
  fi
  
  if [[ "$file" =~ (service|handler|controller|middleware) ]]; then
    echo "medium"
    return
  fi
  
  echo "low"
}

# Build find exclude pattern
FIND_EXCLUDE=""
for dir in "${EXCLUDE_DIRS[@]}"; do
  FIND_EXCLUDE="${FIND_EXCLUDE} -not -path '*/${dir}/*'"
done

# Scan TypeScript/JavaScript files
for ext in ts tsx js jsx; do
  while IFS= read -r source_file; do
    # Skip if already a test file
    [[ "$source_file" =~ \.(test|spec)\. ]] && continue
    
    # Skip config files
    [[ "$source_file" =~ (config|\.config\.) ]] && continue

    # Skip files matching config exclusion/suppression patterns
    if [ ${#CONFIG_EXCLUDE_PATTERNS[@]} -gt 0 ] || [ ${#CONFIG_SUPPRESS_PATTERNS[@]} -gt 0 ]; then
      should_exclude "$source_file" && continue
    fi
    
    # Check if test file exists
    if ! has_test_file "$source_file"; then
      # Determine severity based on file path
      criticality=$(is_critical_path "$source_file")
      
      case "$criticality" in
        high)
          severity="high"
          priority_score=70
          ;;
        medium)
          severity="medium"
          priority_score=45
          ;;
        low)
          severity="low"
          priority_score=25
          ;;
      esac
      
      # Generate unique ID
      id=$(echo -n "${source_file}:no-test" | md5sum | cut -d' ' -f1)
      
      # Extract file name for title
      filename=$(basename "$source_file")
      clean_source="${source_file#./}"
      test_filename="${filename%.${ext}}.test.${ext}"
      
      # Create finding using jq
      finding=$(jq -n \
        --arg id "$id" \
        --arg source "test_coverage" \
        --arg category "testing" \
        --arg severity "$severity" \
        --argjson priority_score "$priority_score" \
        --arg title "Add tests for $filename" \
        --arg description "Source file '$source_file' does not have a corresponding test file. Tests are important for maintaining code quality and preventing regressions." \
        --arg file "$clean_source" \
        --arg suggested_approach "Create a test file (e.g., $test_filename) with unit tests covering the main functionality. Focus on edge cases, error handling, and critical paths." \
        --arg ext "$ext" \
        --arg criticality "$criticality" \
        '{
          id: $id,
          source: $source,
          category: $category,
          severity: $severity,
          priority_score: $priority_score,
          title: $title,
          description: $description,
          location: {
            file: $file
          },
          suggested_approach: $suggested_approach,
          effort_estimate: "standard",
          tags: ["testing", "coverage", $ext],
          metadata: {
            language: $ext,
            criticality: $criticality,
            missing_test_file: true
          }
        }')
      
      findings=$(echo "$findings" | jq --argjson finding "$finding" '. + [$finding]')
    fi
  done < <(eval "find '$REPO_ROOT' -name '*.${ext}' $FIND_EXCLUDE" 2>/dev/null || true)
done

# Scan Python files
while IFS= read -r source_file; do
  # Skip if already a test file
  [[ "$source_file" =~ test_ ]] && continue
  [[ "$source_file" =~ _test\.py ]] && continue
  
  # Skip __init__.py and config files
  [[ "$source_file" =~ __init__\.py ]] && continue
  [[ "$source_file" =~ config\.py ]] && continue

  # Skip files matching config exclusion/suppression patterns
  if [ ${#CONFIG_EXCLUDE_PATTERNS[@]} -gt 0 ] || [ ${#CONFIG_SUPPRESS_PATTERNS[@]} -gt 0 ]; then
    should_exclude "$source_file" && continue
  fi
  
  # Check if test file exists
  if ! has_test_file "$source_file"; then
    criticality=$(is_critical_path "$source_file")
    
    case "$criticality" in
      high)
        severity="high"
        priority_score=70
        ;;
      medium)
        severity="medium"
        priority_score=45
        ;;
      low)
        severity="low"
        priority_score=25
        ;;
    esac
    
    id=$(echo -n "${source_file}:no-test" | md5sum | cut -d' ' -f1)
    filename=$(basename "$source_file")
    clean_source="${source_file#./}"
    test_filename1="test_${filename}"
    test_filename2="${filename%.py}_test.py"
    
    finding=$(jq -n \
      --arg id "$id" \
      --arg source "test_coverage" \
      --arg category "testing" \
      --arg severity "$severity" \
      --argjson priority_score "$priority_score" \
      --arg title "Add tests for $filename" \
      --arg description "Python module '$source_file' does not have a corresponding test file. Tests are important for maintaining code quality and preventing regressions." \
      --arg file "$clean_source" \
      --arg suggested_approach "Create a test file (e.g., $test_filename1 or $test_filename2) with unit tests using pytest or unittest. Cover main functionality, edge cases, and error handling." \
      --arg criticality "$criticality" \
      '{
        id: $id,
        source: $source,
        category: $category,
        severity: $severity,
        priority_score: $priority_score,
        title: $title,
        description: $description,
        location: {
          file: $file
        },
        suggested_approach: $suggested_approach,
        effort_estimate: "standard",
        tags: ["testing", "coverage", "python"],
        metadata: {
          language: "python",
          criticality: $criticality,
          missing_test_file: true
        }
      }')
    
    findings=$(echo "$findings" | jq --argjson finding "$finding" '. + [$finding]')
  fi
done < <(eval "find '$REPO_ROOT' -name '*.py' $FIND_EXCLUDE" 2>/dev/null || true)

# Count findings
findings_count=$(echo "$findings" | jq 'length')

# Output JSON
cat > "$OUTPUT_FILE" <<EOF
{
  "scanner": "test_coverage",
  "enabled": true,
  "findings_count": ${findings_count},
  "findings": ${findings}
}
EOF

echo "Test coverage scan complete: ${findings_count} findings"
echo "Output written to: ${OUTPUT_FILE}"