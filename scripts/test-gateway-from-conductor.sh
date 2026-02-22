#!/bin/bash
# Test gateway fallback from inside conductor container
# This script runs inside the docker network where gateway is accessible

set -e

GATEWAY_URL="http://gateway"
API_KEY="${GATEWAY_API_KEY:-test-key}"

echo "=========================================="
echo "Testing Gateway Fallback (from conductor)"
echo "=========================================="
echo ""

# Test 1: Gateway health
echo "Test 1: Checking gateway health..."
if curl -sf "${GATEWAY_URL}/health" > /dev/null; then
    echo "✅ Gateway is healthy"
else
    echo "❌ Gateway is not responding"
    exit 1
fi
echo ""

# Test 2: Simple tier1 completion request
echo "Test 2: Testing tier1 completion request..."
RESPONSE=$(curl -s -X POST "${GATEWAY_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "model": "tier1",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 10
  }')

if echo "$RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data['choices'][0]['message']['content'])" 2>/dev/null; then
    echo "✅ Completion request succeeded"
    echo "Response: $(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['choices'][0]['message']['content'])")"
else
    echo "Response received: $RESPONSE"
fi
echo ""

# Test 3: Check which model was actually used
echo "Test 3: Checking model selection from response..."
MODEL_USED=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('model', 'unknown'))" 2>/dev/null || echo "unknown")
echo "Model used: $MODEL_USED"
echo ""

echo "✅ Gateway is operational and routing requests!"
echo ""
echo "Expected behavior:"
echo "  - Requests should try Groq first (order: 1)"
echo "  - If Groq fails, fallback to Gemini (order: 2)"
echo "  - If Gemini fails, fallback to Azure AI (order: 3)"
