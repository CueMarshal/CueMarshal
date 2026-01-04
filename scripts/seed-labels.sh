#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Seed Standard Labels and Milestones
# ═══════════════════════════════════════════════════════════════

echo "=================================================="
echo "  Creating Standard Labels"
echo "=================================================="

# Load environment
source .env

GITEA_URL="${GITEA_URL:-http://gitea:3000}"
ADMIN_TOKEN="${GITEA_ADMIN_TOKEN}"
ORG_NAME="${CONDUCTOR_ORG:-cuemarshal}"

if [ -z "$ADMIN_TOKEN" ]; then
    echo "ERROR: GITEA_ADMIN_TOKEN not set in .env"
    exit 1
fi

# Function to create a label
create_label() {
    local name=$1
    local color=$2
    local description=$3

    curl -sf -X POST \
        -H "Authorization: token ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        "${GITEA_URL}/api/v1/orgs/${ORG_NAME}/labels" \
        -d "{
            \"name\": \"${name}\",
            \"color\": \"${color}\",
            \"description\": \"${description}\"
        }" > /dev/null 2>&1 && echo "  ✓ ${name}" || echo "  ℹ ${name} (already exists)"
}

# Role labels
echo ""
echo "Role Labels:"
create_label "role:architect" "e11d48" "System design and architecture decisions"
create_label "role:developer" "0075ca" "Feature implementation and bug fixes"
create_label "role:reviewer" "7057ff" "Code review and quality checks"
create_label "role:tester" "008672" "Test writing and execution"
create_label "role:devops" "e99695" "CI/CD and infrastructure"
create_label "role:docs" "0e8a16" "Documentation and technical writing"

# Complexity labels
echo ""
echo "Complexity Labels:"
create_label "complexity:simple" "c2e0c6" "Simple task, tier1 model"
create_label "complexity:standard" "fef2c0" "Standard task, tier2 model"
create_label "complexity:complex" "f9d0c4" "Complex task, tier3 model"

# Status labels
echo ""
echo "Status Labels:"
create_label "status:pending" "ededed" "Waiting for analysis or assignment"
create_label "status:in-progress" "fbca04" "Agent is working on this"
create_label "status:review" "d4c5f9" "PR awaiting review"
create_label "status:blocked" "d73a4a" "Blocked by dependency or issue"

# Type labels
echo ""
echo "Type Labels:"
create_label "type:feature" "a2eeef" "New feature or enhancement"
create_label "type:bug" "d73a4a" "Bug fix"
create_label "type:refactor" "fbca04" "Code refactoring"
create_label "type:test" "0e8a16" "Test-related changes"
create_label "type:docs" "0075ca" "Documentation"
create_label "type:chore" "ededed" "Maintenance tasks"

# Special labels
echo ""
echo "Special Labels:"
create_label "self-improvement" "5319e7" "Self-improvement task"
create_label "source:sonar" "4c1" "Issue identified by SonarQube analysis"
create_label "needs-human-review" "b60205" "Requires human approval before merge"
create_label "skip-automation" "000000" "Do not process automatically"
create_label "manual-only" "ffffff" "Track but do not auto-execute"

# Priority labels
echo ""
echo "Priority Labels:"
create_label "priority:low" "c5def5" "Low priority"
create_label "priority:medium" "fef2c0" "Medium priority"
create_label "priority:high" "f9d0c4" "High priority"
create_label "priority:critical" "d73a4a" "Critical priority"

echo ""
echo "=================================================="
echo "  Labels Created Successfully"
echo "=================================================="
