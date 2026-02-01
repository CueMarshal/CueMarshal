#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# CueMarshal Runner Entrypoint
# ═══════════════════════════════════════════════════════════════
# This script:
# 1. Waits for Gitea to be ready
# 2. Registers the runner if not already registered
# 3. Configures OpenCode authentication
# 4. Starts the Act Runner daemon
# ═══════════════════════════════════════════════════════════════

RUNNER_NAME="${RUNNER_NAME:-cuemarshal-runner-$(hostname)}"
RUNNER_LABELS="${RUNNER_LABELS:-self-hosted,opencode}"
GITEA_INSTANCE="${GITEA_URL:-http://gitea:3000}"
REGISTRATION_TOKEN="${GITEA_RUNNER_REGISTRATION_TOKEN:-}"

echo "=================================================="
echo "  CueMarshal Runner: ${RUNNER_NAME}"
echo "=================================================="
echo ""
echo "Gitea instance: ${GITEA_INSTANCE}"
echo "Labels: ${RUNNER_LABELS}"
echo ""

# Wait for Gitea to be ready
echo "Waiting for Gitea..."
until curl -sf "${GITEA_INSTANCE}/api/v1/version" > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo " ✓ Gitea is ready"
echo ""

# Register runner if not already registered
if [ ! -f /data/.runner ]; then
    if [ -z "${REGISTRATION_TOKEN}" ]; then
        # Fallback: read from shared volume written by init-gitea
        if [ -f /tokens/runner_token ]; then
            REGISTRATION_TOKEN=$(cat /tokens/runner_token | tr -d '\r\n')
            echo "Loaded registration token from /tokens/runner_token"
        fi
    fi

    if [ -z "${REGISTRATION_TOKEN}" ]; then
        echo "Waiting for runner registration token..."
        for i in $(seq 1 60); do
            if [ -f /tokens/runner_token ]; then
                REGISTRATION_TOKEN=$(cat /tokens/runner_token | tr -d '\r\n')
                echo "Loaded registration token from /tokens/runner_token"
                break
            fi
            sleep 5
        done
    fi

    if [ -z "${REGISTRATION_TOKEN}" ]; then
        echo "ERROR: No registration token available after waiting"
        exit 1
    fi

    echo "Registering runner..."
    act_runner register \
        --config /config.yaml \
        --instance "${GITEA_INSTANCE}" \
        --token "${REGISTRATION_TOKEN}" \
        --name "${RUNNER_NAME}" \
        --labels "${RUNNER_LABELS}" \
        --no-interactive
    
    echo "✓ Runner registered"
else
    echo "✓ Runner already registered (using existing /data/.runner)"
fi

echo ""

# Configure OpenCode for LLM Gateway access
echo "Configuring OpenCode v1.1.53..."
export HOME="${HOME:-/data}"
export GITEA_URL="${GITEA_INSTANCE}"

# Start local gateway auth proxy (injects Authorization header for LiteLLM)
GATEWAY_TARGET="gateway:80" OPENAI_API_KEY="${OPENAI_API_KEY}" PROXY_PORT=4101 \
  node /gateway-proxy.js &
PROXY_PID=$!
sleep 1

if kill -0 $PROXY_PID 2>/dev/null; then
    echo "✓ Gateway auth proxy started (PID $PROXY_PID)"
else
    echo "✗ Gateway auth proxy failed to start"
    exit 1
fi

export LOCAL_ENDPOINT="http://127.0.0.1:4101"
export OPENAI_BASE_URL="http://127.0.0.1:4101/v1"

echo "✓ OpenCode configured (proxy → gateway:80)"
echo ""

# Patch agent configs: replace hardcoded GITEA_URL with actual value
if command -v jq &>/dev/null; then
    echo "Patching agent MCP configs with GITEA_URL=${GITEA_URL}..."
    for cfg in /agents/*/opencode*.json; do
        [ -f "$cfg" ] || continue
        if jq -e '.mcp.gitea.environment.GITEA_URL' "$cfg" >/dev/null 2>&1; then
            jq --arg url "${GITEA_URL}" \
               '.mcp.gitea.environment.GITEA_URL = $url' \
               "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
        fi
    done
    echo "✓ Agent MCP configs patched"
else
    echo "⚠ jq not available — agent MCP configs not patched"
fi
echo ""

# Verify MCP servers are available
echo "Verifying MCP servers..."
if [ -f /mcp-servers/gitea-mcp/dist/index.js ]; then
    echo "  ✓ Gitea MCP server found"
else
    echo "  ✗ Gitea MCP server not found"
fi

if [ -f /mcp-servers/conductor-mcp/dist/index.js ]; then
    echo "  ✓ Conductor MCP server found"
else
    echo "  ✗ Conductor MCP server not found"
fi

if [ -f /mcp-servers/system-mcp/dist/index.js ]; then
    echo "  ✓ System MCP server found"
else
    echo "  ✗ System MCP server not found"
fi

echo ""

# Verify agent profiles
echo "Verifying agent profiles..."
for role in architect developer reviewer tester devops docs; do
    if [ -f "/agents/${role}/opencode.json" ]; then
        echo "  ✓ ${role}"
    else
        echo "  ✗ ${role} (missing)"
    fi
done

echo ""
echo "=================================================="
echo "  Starting Runner Daemon"
echo "=================================================="
echo ""

# Start the runner daemon
exec act_runner daemon --config /config.yaml
