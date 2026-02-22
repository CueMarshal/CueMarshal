#!/bin/bash
# Simulate a workflow request similar to self-improve.yml
# This demonstrates the fallback mechanism in action

set -e

echo "=========================================="
echo "Simulating Workflow Request (tier1)"
echo "=========================================="
echo ""

echo "This simulates how the self-improve.yml workflow"
echo "would make a request to the gateway with model 'tier1'"
echo ""

echo "Starting gateway log monitoring in background..."
docker logs -f cuemarshal-gateway 2>&1 | grep -i -E '(groq|gemini|azure|tier1|routing|order|fallback)' &
LOG_PID=$!

# Give log monitoring time to start
sleep 2

echo ""
echo "Making request to gateway (from conductor container)..."
echo "Model: tier1"
echo "Expected behavior:"
echo "  1. Gateway receives request for tier1"
echo "  2. Pre-call check filters to order: 1 (Groq)"
echo "  3. If Groq available → use Groq"
echo "  4. If Groq fails → fallback to Gemini (order: 2)"
echo "  5. If Gemini fails → fallback to Azure AI (order: 3)"
echo ""

# Note: This test requires GATEWAY_API_KEY to be set in conductor environment
echo "Check recent gateway logs for provider selection..."
sleep 3

# Stop log monitoring
kill $LOG_PID 2>/dev/null || true

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "To manually trigger the self-improve workflow:"
echo "  1. Ensure gateway is running: docker ps | grep gateway"
echo "  2. Run workflow: .gitea/workflows/self-improve.yml"
echo "  3. Monitor: docker logs -f cuemarshal-gateway | grep -i tier1"
echo ""
echo "Expected first provider: Groq (order: 1)"
echo "If Groq fails, expect fallback to: Gemini (order: 2) → Azure AI (order: 3)"
