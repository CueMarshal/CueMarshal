#!/usr/bin/env bash
set -euo pipefail

# Build all CueMarshal Docker images for local development/testing
# Supports building for Docker Hub, GitHub Container Registry, or k3d local cluster

REGISTRY="${REGISTRY:-ghcr.io/cuemarshal}"
TAG="${TAG:-latest}"
LOAD_TO_K3D="${LOAD_TO_K3D:-false}"
K3D_CLUSTER="${K3D_CLUSTER:-dev}"

echo "Building CueMarshal images..."
echo "Registry: $REGISTRY"
echo "Tag: $TAG"
echo "Load to k3d: $LOAD_TO_K3D (cluster: $K3D_CLUSTER)"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Function to load image into k3d
load_to_k3d() {
    local image=$1
    if [ "$LOAD_TO_K3D" = "true" ]; then
        echo "Loading $image into k3d cluster '$K3D_CLUSTER'..."
        k3d image import "$image" -c "$K3D_CLUSTER" 2>/dev/null || {
            echo "⚠️  Failed to load $image into k3d"
            echo "   Make sure k3d cluster '$K3D_CLUSTER' is running:"
            echo "   k3d cluster start $K3D_CLUSTER"
            return 1
        }
    fi
}

# Build conductor
echo "Building conductor..."
docker build -t ${REGISTRY}/conductor:${TAG} "$PROJECT_ROOT/services/conductor"
load_to_k3d "${REGISTRY}/conductor:${TAG}"

# Build gateway
echo "Building gateway..."
docker build -t ${REGISTRY}/gateway:${TAG} "$PROJECT_ROOT/services/gateway"
load_to_k3d "${REGISTRY}/gateway:${TAG}"

# Build landing
echo "Building landing..."
docker build -t ${REGISTRY}/landing:${TAG} "$PROJECT_ROOT/services/landing"
load_to_k3d "${REGISTRY}/landing:${TAG}"

# Build runner (requires project root context due to agents/ and mcp-servers/ dependencies)
echo "Building runner..."
docker build -t ${REGISTRY}/runner:${TAG} -f "$PROJECT_ROOT/services/runner/Dockerfile" "$PROJECT_ROOT/services"
load_to_k3d "${REGISTRY}/runner:${TAG}"

# Build MCP servers (all require project root context for shared dependencies)
echo "Building MCP servers..."
docker build -t ${REGISTRY}/mcp-gitea:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/gitea-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_k3d "${REGISTRY}/mcp-gitea:${TAG}"

docker build -t ${REGISTRY}/mcp-conductor:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/conductor-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_k3d "${REGISTRY}/mcp-conductor:${TAG}"

docker build -t ${REGISTRY}/mcp-system:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/system-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_k3d "${REGISTRY}/mcp-system:${TAG}"

docker build -t ${REGISTRY}/mcp-vector:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/vector-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_k3d "${REGISTRY}/mcp-vector:${TAG}"

docker build -t ${REGISTRY}/mcp-sonar:${TAG} -f "$PROJECT_ROOT/services/mcp-servers/sonar-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_k3d "${REGISTRY}/mcp-sonar:${TAG}"

echo ""
echo "✓ All images built successfully!"
echo ""
echo "Images:"
docker images | grep cuemarshal | head -10

echo ""
echo "Usage:"
echo "  Local development (Docker Compose):"
echo "    export REGISTRY='docker.io/cuemarshal' # or 'ghcr.io/cuemarshal'"
echo "    bash scripts/build-images.sh"
echo ""
echo "  k3d deployment (with automatic image loading):"
echo "    # Build images with REGISTRY prefix and load into k3d:"
echo "    REGISTRY='ghcr.io/cuemarshal' LOAD_TO_K3D=true K3D_CLUSTER=dev bash scripts/build-images.sh"
echo ""
echo "    # Then deploy Helm chart (registry: 'ghcr.io' only, helper adds /cuemarshal):"
echo "    helm install dev-workspace ./infrastructure/helm/cuemarshal \\"
echo "      --namespace cuemarshal-ws-dev --create-namespace \\"
echo "      -f ./infrastructure/helm/cuemarshal/local-values.yaml \\"
echo "      --set image.pullPolicy='IfNotPresent'"
echo ""
echo "  Or use the deployment helper:"
echo "    bash scripts/deploy-to-k3d.sh dev"
echo ""
