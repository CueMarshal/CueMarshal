#!/usr/bin/env bash
set -euo pipefail

# Build all CueMarshal Docker images for local development/testing

REGISTRY="${REGISTRY:-docker.io/cuemarshal}"
TAG="${TAG:-latest}"

echo "Building CueMarshal images..."
echo "Registry: $REGISTRY"
echo "Tag: $TAG"
echo ""

# Build conductor
echo "Building conductor..."
docker build -t ${REGISTRY}/conductor:${TAG} ./conductor

# Build gateway
echo "Building gateway..."
docker build -t ${REGISTRY}/gateway:${TAG} ./gateway

# Build landing
echo "Building landing..."
docker build -t ${REGISTRY}/landing:${TAG} ./landing

# Build runner
echo "Building runner..."
docker build -t ${REGISTRY}/runner:${TAG} -f ./runner/Dockerfile .

# Build MCP servers
echo "Building MCP servers..."
docker build -t ${REGISTRY}/mcp-gitea:${TAG} -f ./mcp-servers/gitea-mcp/Dockerfile ./mcp-servers
docker build -t ${REGISTRY}/mcp-conductor:${TAG} -f ./mcp-servers/conductor-mcp/Dockerfile ./mcp-servers
docker build -t ${REGISTRY}/mcp-system:${TAG} -f ./mcp-servers/system-mcp/Dockerfile ./mcp-servers
docker build -t ${REGISTRY}/mcp-vector:${TAG} -f ./mcp-servers/vector-mcp/Dockerfile ./mcp-servers
docker build -t ${REGISTRY}/mcp-sonar:${TAG} -f ./mcp-servers/sonar-mcp/Dockerfile ./mcp-servers

echo ""
echo "✓ All images built successfully!"
echo ""
echo "Images:"
docker images | grep cuemarshal | head -10

echo ""
echo "To load into minikube:"
echo "  for img in conductor gateway landing runner mcp-gitea mcp-conductor mcp-system mcp-vector mcp-sonar; do"
echo "    minikube image load ${REGISTRY}/\$img:${TAG}"
echo "  done"
