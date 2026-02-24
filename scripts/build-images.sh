#!/usr/bin/env bash
set -euo pipefail

# Build all CueMarshal Docker images for local development/testing

REGISTRY="${REGISTRY:-ghcr.io/cuemarshal}"
TAG="${TAG:-latest}"

echo "Building CueMarshal images..."
echo "Registry: $REGISTRY"
echo "Tag: $TAG"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Build conductor
echo "Building conductor..."
docker build -t ${REGISTRY}/conductor:${TAG} "$PROJECT_ROOT/services/conductor"

# Build gateway
echo "Building gateway..."
docker build -t ${REGISTRY}/gateway:${TAG} "$PROJECT_ROOT/services/gateway"

# Build landing
echo "Building landing..."
docker build -t ${REGISTRY}/landing:${TAG} "$PROJECT_ROOT/services/landing"

# Build runner (requires project root context due to agents/ and mcp-servers/ dependencies)
echo "Building runner..."
docker build -t ${REGISTRY}/runner:${TAG} -f "$PROJECT_ROOT/services/runner/Dockerfile" "$PROJECT_ROOT/services"

# Build MCP servers (all require project root context for shared dependencies)
echo "Building MCP servers..."
docker build -t ${REGISTRY}/mcp-gitea:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/gitea-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
docker build -t ${REGISTRY}/mcp-conductor:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/conductor-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
docker build -t ${REGISTRY}/mcp-system:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/system-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
docker build -t ${REGISTRY}/mcp-vector:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/vector-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
docker build -t ${REGISTRY}/mcp-sonar:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/sonar-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"

echo ""
echo "✓ All images built successfully!"
echo ""
echo "Images:"
docker images | grep cuemarshal | head -10
