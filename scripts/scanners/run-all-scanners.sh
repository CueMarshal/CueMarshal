#!/bin/bash
# Orchestrator script for running all improvement scanners
# Merges individual scanner outputs into a single improvement-findings.json

set -euo pipefail

# Configuration
REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings.json}"
SCANNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Temporary directory for scanner outputs
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Get git information
GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_REMOTE=$(git config --get remote.origin.url 2>/dev/null || echo "unknown")
SCAN_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=================================="
echo "Improvement Discovery Pipeline"
echo "=================================="
echo "Repository: $GIT_REMOTE"
echo "Branch: $GIT_BRANCH"
echo "Commit: $GIT_COMMIT"
echo "Timestamp: $SCAN_TIMESTAMP"
echo "=================================="
echo ""

# Make all scanner scripts executable
chmod +x "$SCANNER_DIR"/scan-*.sh

# Run each scanner
declare -A scanner_outputs
declare -A scanner_enabled
declare -A scanner_counts

echo "Running scanners..."
echo ""

# TODO Markers Scanner
echo "[1/5] Scanning for TODO/FIXME markers..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/todo.json" "$SCANNER_DIR/scan-todo-markers.sh"; then
  scanner_outputs[todo_markers]="$TEMP_DIR/todo.json"
  scanner_enabled[todo_markers]="true"
  scanner_counts[todo_markers]=$(jq -r '.findings_count' "$TEMP_DIR/todo.json")
else
  echo "  WARNING: TODO scanner failed"
  scanner_enabled[todo_markers]="false"
  scanner_counts[todo_markers]=0
fi
echo ""

# Dependency Updates Scanner
echo "[2/5] Scanning for dependency updates..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/deps.json" "$SCANNER_DIR/scan-dependency-updates.sh"; then
  scanner_outputs[dependency_updates]="$TEMP_DIR/deps.json"
  scanner_enabled[dependency_updates]="true"
  scanner_counts[dependency_updates]=$(jq -r '.findings_count' "$TEMP_DIR/deps.json")
else
  echo "  WARNING: Dependency scanner failed"
  scanner_enabled[dependency_updates]="false"
  scanner_counts[dependency_updates]=0
fi
echo ""

# Test Coverage Scanner
echo "[3/5] Scanning for test coverage gaps..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/tests.json" "$SCANNER_DIR/scan-test-coverage.sh"; then
  scanner_outputs[test_coverage]="$TEMP_DIR/tests.json"
  scanner_enabled[test_coverage]="true"
  scanner_counts[test_coverage]=$(jq -r '.findings_count' "$TEMP_DIR/tests.json")
else
  echo "  WARNING: Test coverage scanner failed"
  scanner_enabled[test_coverage]="false"
  scanner_counts[test_coverage]=0
fi
echo ""

# Stale Documentation Scanner
echo "[4/5] Scanning for documentation issues..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/docs.json" "$SCANNER_DIR/scan-stale-docs.sh"; then
  scanner_outputs[stale_documentation]="$TEMP_DIR/docs.json"
  scanner_enabled[stale_documentation]="true"
  scanner_counts[stale_documentation]=$(jq -r '.findings_count' "$TEMP_DIR/docs.json")
else
  echo "  WARNING: Documentation scanner failed"
  scanner_enabled[stale_documentation]="false"
  scanner_counts[stale_documentation]=0
fi
echo ""

# SonarQube Scanner
echo "[5/5] Querying SonarQube for issues..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/sonar.json" \
   SONAR_URL="${SONAR_URL:-}" SONAR_TOKEN="${SONAR_TOKEN:-}" \
   SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}" \
   "$SCANNER_DIR/scan-sonar.sh"; then
  scanner_outputs[sonarqube]="$TEMP_DIR/sonar.json"
  scanner_enabled[sonarqube]="true"
  scanner_counts[sonarqube]=$(jq -r '.findings_count' "$TEMP_DIR/sonar.json")
else
  echo "  WARNING: SonarQube scanner failed"
  scanner_enabled[sonarqube]="false"
  scanner_counts[sonarqube]=0
fi
echo ""

# Merge all findings
echo "Merging scanner outputs..."

all_findings="[]"
for scanner in "${!scanner_outputs[@]}"; do
  output_file="${scanner_outputs[$scanner]}"
  if [ -f "$output_file" ]; then
    scanner_findings=$(jq -r '.findings' "$output_file")
    all_findings=$(echo "$all_findings" | jq --argjson new "$scanner_findings" '. + $new')
  fi
done

# Calculate summary statistics
total_findings=$(echo "$all_findings" | jq 'length')

# Count by severity
critical_count=$(echo "$all_findings" | jq '[.[] | select(.severity == "critical")] | length')
high_count=$(echo "$all_findings" | jq '[.[] | select(.severity == "high")] | length')
medium_count=$(echo "$all_findings" | jq '[.[] | select(.severity == "medium")] | length')
low_count=$(echo "$all_findings" | jq '[.[] | select(.severity == "low")] | length')
info_count=$(echo "$all_findings" | jq '[.[] | select(.severity == "info")] | length')

# Count by category
code_quality_count=$(echo "$all_findings" | jq '[.[] | select(.category == "code_quality")] | length')
testing_count=$(echo "$all_findings" | jq '[.[] | select(.category == "testing")] | length')
documentation_count=$(echo "$all_findings" | jq '[.[] | select(.category == "documentation")] | length')
dependencies_count=$(echo "$all_findings" | jq '[.[] | select(.category == "dependencies")] | length')
technical_debt_count=$(echo "$all_findings" | jq '[.[] | select(.category == "technical_debt")] | length')

# Get top priority findings (top 10 by priority_score)
top_findings=$(echo "$all_findings" | jq -r '[sort_by(-.priority_score) | .[0:10] | .[].id]')

# Create final output
cat > "$OUTPUT_FILE" <<EOF
{
  "version": "1.0.0",
  "scan_timestamp": "${SCAN_TIMESTAMP}",
  "repository": {
    "url": "${GIT_REMOTE}",
    "commit_sha": "${GIT_COMMIT}",
    "branch": "${GIT_BRANCH}"
  },
  "scanners": {
    "todo_markers": {
      "enabled": ${scanner_enabled[todo_markers]},
      "findings_count": ${scanner_counts[todo_markers]}
    },
    "dependency_updates": {
      "enabled": ${scanner_enabled[dependency_updates]},
      "findings_count": ${scanner_counts[dependency_updates]}
    },
    "test_coverage": {
      "enabled": ${scanner_enabled[test_coverage]},
      "findings_count": ${scanner_counts[test_coverage]}
    },
    "stale_documentation": {
      "enabled": ${scanner_enabled[stale_documentation]},
      "findings_count": ${scanner_counts[stale_documentation]}
    },
    "sonarqube": {
      "enabled": ${scanner_enabled[sonarqube]:-false},
      "findings_count": ${scanner_counts[sonarqube]:-0}
    }
  },
  "findings": ${all_findings},
  "summary": {
    "total_findings": ${total_findings},
    "by_severity": {
      "critical": ${critical_count},
      "high": ${high_count},
      "medium": ${medium_count},
      "low": ${low_count},
      "info": ${info_count}
    },
    "by_category": {
      "code_quality": ${code_quality_count},
      "testing": ${testing_count},
      "documentation": ${documentation_count},
      "dependencies": ${dependencies_count},
      "technical_debt": ${technical_debt_count}
    },
    "top_priority_findings": ${top_findings}
  }
}
EOF

echo "=================================="
echo "Scan Complete!"
echo "=================================="
echo "Total findings: $total_findings"
echo ""
echo "By Severity:"
echo "  Critical: $critical_count"
echo "  High:     $high_count"
echo "  Medium:   $medium_count"
echo "  Low:      $low_count"
echo "  Info:     $info_count"
echo ""
echo "By Category:"
echo "  Code Quality:    $code_quality_count"
echo "  Testing:         $testing_count"
echo "  Documentation:   $documentation_count"
echo "  Dependencies:    $dependencies_count"
echo "  Technical Debt:  $technical_debt_count"
echo ""
echo "Output written to: $OUTPUT_FILE"
echo "=================================="
