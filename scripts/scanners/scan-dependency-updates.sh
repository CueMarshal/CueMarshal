#!/bin/bash
# Dependency Update Scanner
# Scans for outdated dependencies in package.json, requirements.txt, go.mod, etc.

set -euo pipefail

# Configuration
REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-deps.json}"

# Initialize findings array
findings="[]"

# Function to scan Node.js dependencies
scan_nodejs() {
  local package_file="$1"
  local dir=$(dirname "$package_file")
  
  # Check if package.json exists and has dependencies
  if [ ! -f "$package_file" ]; then
    return
  fi
  
  # Use npm outdated if npm is available (with error handling and timeout)
  if command -v npm &> /dev/null; then
    cd "$dir"
    
    # Run npm outdated with 60-second timeout (exits with 1 if outdated packages exist)
    # Use timeout command to prevent hanging on network issues or large dependency trees
    local outdated_output=$(timeout 60 npm outdated --json 2>/dev/null || true)
    
    if [ -n "$outdated_output" ] && [ "$outdated_output" != "{}" ]; then
      # Parse npm outdated JSON output
      echo "$outdated_output" | jq -r 'to_entries[] | @json' | while read -r pkg_json; do
        pkg_name=$(echo "$pkg_json" | jq -r '.key')
        current=$(echo "$pkg_json" | jq -r '.value.current')
        wanted=$(echo "$pkg_json" | jq -r '.value.wanted')
        latest=$(echo "$pkg_json" | jq -r '.value.latest')
        type=$(echo "$pkg_json" | jq -r '.value.type // "dependencies"')
        
        # Determine severity based on version difference
        severity="low"
        if [[ "$current" != "$wanted" ]]; then
          severity="medium"  # Patch or minor update available
        fi
        if [[ "$wanted" != "$latest" ]]; then
          severity="high"  # Major update available
        fi
        
        # Priority score based on severity
        case "$severity" in
          high)   priority_score=60 ;;
          medium) priority_score=40 ;;
          low)    priority_score=20 ;;
        esac
        
        # Generate unique ID
        id=$(echo -n "${package_file}:${pkg_name}" | md5sum | cut -d' ' -f1)
        clean_package_file="${package_file#./}"
        
        # Create finding using jq
        finding=$(jq -n \
          --arg id "$id" \
          --arg source "dependency_updates" \
          --arg category "dependencies" \
          --arg severity "$severity" \
          --argjson priority_score "$priority_score" \
          --arg title "Update $pkg_name from $current to $latest" \
          --arg description "Package '$pkg_name' has an update available. Current: $current, Wanted: $wanted, Latest: $latest" \
          --arg file "$clean_package_file" \
          --arg context "\"$pkg_name\": \"$current\"" \
          --arg suggested_approach "Update the package version in $package_file and run tests to ensure compatibility. For major updates, review the changelog for breaking changes." \
          --arg pkg_name "$pkg_name" \
          --arg current "$current" \
          --arg wanted "$wanted" \
          --arg latest "$latest" \
          --arg type "$type" \
          '{
            id: $id,
            source: $source,
            category: $category,
            severity: $severity,
            priority_score: $priority_score,
            title: $title,
            description: $description,
            location: {
              file: $file,
              context: $context
            },
            suggested_approach: $suggested_approach,
            effort_estimate: "simple",
            tags: ["dependency", "nodejs", "npm", $pkg_name],
            metadata: {
              package_manager: "npm",
              package_name: $pkg_name,
              current_version: $current,
              wanted_version: $wanted,
              latest_version: $latest,
              dependency_type: $type
            }
          }')
        
        findings=$(echo "$findings" | jq --argjson finding "$finding" '. + [$finding]')
      done
    fi
    
    cd "$REPO_ROOT"
  fi
}

# Function to scan Python dependencies
scan_python() {
  local req_file="$1"
  
  # Check if requirements.txt exists
  if [ ! -f "$req_file" ]; then
    return
  fi
  
  # Parse requirements.txt for pinned versions
  # Look for patterns like package==1.2.3 or package>=1.2.3
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ -z "$line" ]] && continue
    
    # Extract package name and version
    if [[ "$line" =~ ^([a-zA-Z0-9_-]+)==([0-9.]+) ]]; then
      pkg_name="${BASH_REMATCH[1]}"
      current="${BASH_REMATCH[2]}"
      
      # We can't easily check for updates without pip, so create a general finding
      # with lower priority
      severity="low"
      priority_score=30
      
      id=$(echo -n "${req_file}:${pkg_name}" | md5sum | cut -d' ' -f1)
      clean_req_file="${req_file#./}"
      
      finding=$(jq -n \
        --arg id "$id" \
        --arg source "dependency_updates" \
        --arg category "dependencies" \
        --arg severity "$severity" \
        --argjson priority_score "$priority_score" \
        --arg title "Review update for $pkg_name (currently $current)" \
        --arg description "Python package '$pkg_name' is pinned to $current. Consider checking for available updates." \
        --arg file "$clean_req_file" \
        --arg context "$line" \
        --arg suggested_approach "Run 'pip list --outdated' to check for available updates, review changelog, and test compatibility." \
        --arg pkg_name "$pkg_name" \
        --arg current "$current" \
        '{
          id: $id,
          source: $source,
          category: $category,
          severity: $severity,
          priority_score: $priority_score,
          title: $title,
          description: $description,
          location: {
            file: $file,
            context: $context
          },
          suggested_approach: $suggested_approach,
          effort_estimate: "simple",
          tags: ["dependency", "python", "pip", $pkg_name],
          metadata: {
            package_manager: "pip",
            package_name: $pkg_name,
            current_version: $current
          }
        }')
      
      findings=$(echo "$findings" | jq --argjson finding "$finding" '. + [$finding]')
    fi
  done < "$req_file"
}

# Scan for package.json files
while IFS= read -r package_file; do
  scan_nodejs "$package_file"
done < <(find "$REPO_ROOT" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null || true)

# Scan for requirements.txt files
while IFS= read -r req_file; do
  scan_python "$req_file"
done < <(find "$REPO_ROOT" -name "requirements.txt" -not -path "*/.git/*" -not -path "*/.venv/*" -not -path "*/venv/*" 2>/dev/null || true)

# Count findings
findings_count=$(echo "$findings" | jq 'length')

# Output JSON
cat > "$OUTPUT_FILE" <<EOF
{
  "scanner": "dependency_updates",
  "enabled": true,
  "findings_count": ${findings_count},
  "findings": ${findings}
}
EOF

echo "Dependency update scan complete: ${findings_count} findings"
echo "Output written to: ${OUTPUT_FILE}"
