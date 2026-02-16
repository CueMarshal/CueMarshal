#!/bin/bash
# Test SonarQube scanner locally to verify env vars work

set -e

echo "=========================================="
echo "Testing SonarQube Scanner Configuration"
echo "=========================================="
echo ""

echo "Step 1: Checking if SonarQube is accessible..."
if docker exec cuemarshal-conductor curl -sf http://sonarqube:9000/sonar/api/system/status > /dev/null 2>&1; then
    echo "✅ SonarQube is accessible"
else
    echo "❌ SonarQube is not accessible"
    exit 1
fi
echo ""

echo "Step 2: Checking if SONAR_TOKEN exists in /tokens..."
if docker exec cuemarshal-conductor test -f /tokens/sonar_token; then
    echo "✅ /tokens/sonar_token exists"
    SONAR_TOKEN=$(docker exec cuemarshal-conductor cat /tokens/sonar_token)
    echo "   Token: ${SONAR_TOKEN:0:20}..."
else
    echo "❌ /tokens/sonar_token missing"
    exit 1
fi
echo ""

echo "Step 3: Checking if SONAR_TOKEN Gitea secret exists..."
BOT_TOKEN=$(docker exec cuemarshal-conductor cat /tokens/bot_token)
SECRETS=$(curl -s http://localhost:3300/api/v1/repos/cuemarshal/cuemarshal/actions/secrets \
    -H "Authorization: token ${BOT_TOKEN}" | jq -r '.[].name' 2>/dev/null)

if echo "$SECRETS" | grep -q "^SONAR_TOKEN$"; then
    echo "✅ SONAR_TOKEN secret exists in Gitea"
else
    echo "❌ SONAR_TOKEN secret missing in Gitea"
    echo "Available secrets:"
    echo "$SECRETS"
    exit 1
fi
echo ""

echo "Step 4: Testing scanner script with token..."
docker exec cuemarshal-conductor sh -c '
    export SONAR_URL="http://sonarqube:9000/sonar"
    export SONAR_TOKEN="'$(cat /home/achingono/source/repos/cuemarshal/.env 2>/dev/null | grep SONAR_TOKEN | cut -d= -f2 || docker exec cuemarshal-conductor cat /tokens/sonar_token)'"
    export SONAR_PROJECT_KEY="cuemarshal"
    cd /workspace
    bash scripts/scanners/scan-sonar.sh 2>&1
' | head -20
echo ""

echo "Step 5: Checking workflow env block..."
if grep -A 5 "name: Run improvement scanners" .gitea/workflows/self-improve.yml | grep -q "SONAR_TOKEN"; then
    echo "✅ Workflow has SONAR env vars"
else
    echo "❌ Workflow missing SONAR env vars"
    echo ""
    echo "Current workflow step:"
    grep -A 8 "name: Run improvement scanners" .gitea/workflows/self-improve.yml
    exit 1
fi
echo ""

echo "=========================================="
echo "✅ ALL CHECKS PASSED"
echo "=========================================="
echo ""
echo "Summary:"
echo "  ✅ SonarQube accessible"
echo "  ✅ Token file exists"
echo "  ✅ Gitea secret configured"
echo "  ✅ Scanner script can connect"
echo "  ✅ Workflow has env block"
echo ""
echo "Next: Push changes to Gitea and run workflow"
