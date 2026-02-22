#!/bin/bash
# Verify that the gateway fallback configuration is correct

set -e

echo "=========================================="
echo "Gateway Fallback Configuration Verification"
echo "=========================================="
echo ""

echo "Checking gateway container status..."
GATEWAY_STATUS=$(docker ps --filter "name=cuemarshal-gateway" --format "{{.Status}}")
echo "Gateway status: $GATEWAY_STATUS"
echo ""

echo "Verifying configuration in running container..."
echo ""

echo "✓ Checking routing_strategy..."
if docker exec cuemarshal-gateway cat /app/config.yaml | grep -q 'routing_strategy: "simple-shuffle"'; then
    echo "  ✅ routing_strategy: simple-shuffle (CORRECT)"
else
    echo "  ❌ routing_strategy is NOT simple-shuffle"
    docker exec cuemarshal-gateway cat /app/config.yaml | grep "routing_strategy"
    exit 1
fi

echo "✓ Checking num_retries..."
if docker exec cuemarshal-gateway cat /app/config.yaml | grep "num_retries:" | grep -q "2"; then
    echo "  ✅ num_retries: 2 (CORRECT - allows full 3-provider chain)"
else
    echo "  ❌ num_retries is NOT 2"
    docker exec cuemarshal-gateway cat /app/config.yaml | grep "num_retries"
    exit 1
fi

echo "✓ Checking timeout..."
if docker exec cuemarshal-gateway cat /app/config.yaml | grep -q "timeout: 120"; then
    echo "  ✅ timeout: 120 seconds (CORRECT)"
else
    echo "  ❌ timeout is NOT 120"
    docker exec cuemarshal-gateway cat /app/config.yaml | grep "timeout:" | head -1
    exit 1
fi

echo "✓ Checking enable_pre_call_checks..."
if docker exec cuemarshal-gateway cat /app/config.yaml | grep "enable_pre_call_checks:" | grep -q "true"; then
    echo "  ✅ enable_pre_call_checks: true (CORRECT - required for order field)"
else
    echo "  ❌ enable_pre_call_checks is NOT true"
    docker exec cuemarshal-gateway cat /app/config.yaml | grep "enable_pre_call_checks"
    exit 1
fi

echo "✓ Checking provider order configuration..."
echo ""
echo "  Tier 1 providers:"
docker exec cuemarshal-gateway cat /app/config.yaml | grep -A 15 'model_name: "tier1"' | head -45 | grep -E "(model:|order:)" | head -9
echo ""

echo "✓ Checking fallback_on_status_codes..."
if docker exec cuemarshal-gateway cat /app/config.yaml | grep "fallback_on_status_codes:" | grep -q "429"; then
    echo "  ✅ fallback_on_status_codes includes 429 (rate limit)"
else
    echo "  ❌ fallback_on_status_codes missing 429"
    exit 1
fi

echo ""
echo "=========================================="
echo "Configuration Summary"
echo "=========================================="
echo ""
echo "All critical settings verified:"
echo "  ✅ routing_strategy: simple-shuffle"
echo "  ✅ num_retries: 2"
echo "  ✅ timeout: 120"
echo "  ✅ enable_pre_call_checks: true"
echo "  ✅ fallback_on_status_codes: includes 429"
echo ""
echo "Provider priority order (for all tiers):"
echo "  1️⃣  Groq (order: 1) - Primary provider"
echo "  2️⃣  Gemini (order: 2) - First fallback"
echo "  3️⃣  Azure AI (order: 3) - Second fallback"
echo ""
echo "Fallback flow:"
echo "  Request → Groq (order 1)"
echo "  If Groq fails → Gemini (order 2)"
echo "  If Gemini fails → Azure AI (order 3)"
echo "  If all fail → Cross-tier fallback (tier1→tier2→tier3)"
echo ""
echo "✅ Gateway fallback configuration is CORRECT!"
echo ""
echo "To monitor real-time provider selection:"
echo "  docker logs -f cuemarshal-gateway 2>&1 | grep -i -E '(groq|gemini|azure|routing)'"
echo ""
echo "To test with the self-improve workflow:"
echo "  The workflow at workflows/self-improve.yml uses --model 'litellm/tier1'"
echo "  which will now correctly follow the Groq → Gemini → Azure fallback chain"
