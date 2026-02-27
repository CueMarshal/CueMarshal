#!/usr/bin/env bash
set -euo pipefail

# Build all CueMarshal Docker images for local development/testing
# Supports building for Docker Hub, GitHub Container Registry, or local clusters
#
# Usage: bash scripts/build-images.sh [--no-cache]
#
# Environment variables:
#   CLUSTER_PROVIDER  — docker-desktop | k3d | kind | minikube (empty = skip import)
#   CLUSTER_NAME      — cluster / profile name (default: dev)

REGISTRY="${REGISTRY:-ghcr.io/cuemarshal}"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
CLUSTER_PROVIDER="${CLUSTER_PROVIDER:-}"
CLUSTER_NAME="${CLUSTER_NAME:-dev}"
DOCKER_BUILD_ARGS=""

# Parse command-line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --no-cache)
            DOCKER_BUILD_ARGS="--no-cache"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "Building CueMarshal images..."
echo "Registry: $REGISTRY"
echo "Tag: $TAG"
if [ -n "$CLUSTER_PROVIDER" ]; then
    echo "Load to cluster: $CLUSTER_PROVIDER (name: $CLUSTER_NAME)"
fi
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_to_cluster() {
    local image=$1
    [ -z "$CLUSTER_PROVIDER" ] && return 0

    echo "Loading $image into $CLUSTER_PROVIDER cluster '$CLUSTER_NAME'..."
    case "$CLUSTER_PROVIDER" in
        docker-desktop)
            # docker-desktop shares the Docker daemon; images are already available
            ;;
        k3d)
            k3d image import "$image" -c "$CLUSTER_NAME" 2>/dev/null || {
                echo "⚠️  Failed to load $image into k3d cluster '$CLUSTER_NAME'"
                return 1
            }
            ;;
        kind)
            kind load docker-image "$image" --name "$CLUSTER_NAME" 2>/dev/null || {
                echo "⚠️  Failed to load $image into kind cluster '$CLUSTER_NAME'"
                return 1
            }
            ;;
        minikube)
            minikube -p "$CLUSTER_NAME" image load "$image" 2>/dev/null || {
                echo "⚠️  Failed to load $image into minikube profile '$CLUSTER_NAME'"
                return 1
            }
            ;;
        *)
            echo "⚠️  Unknown cluster provider '$CLUSTER_PROVIDER' — skipping image load"
            ;;
    esac
}

# Build conductor
echo "Building conductor..."
docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/conductor:${TAG} -t ${REGISTRY}/conductor:latest "$PROJECT_ROOT/services/conductor"
load_to_cluster "${REGISTRY}/conductor:${TAG}"

# Build gateway
echo "Building gateway..."
docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/gateway:${TAG} -t ${REGISTRY}/gateway:latest "$PROJECT_ROOT/services/gateway"
load_to_cluster "${REGISTRY}/gateway:${TAG}"

# Build landing
echo "Building landing..."
docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/landing:${TAG} -t ${REGISTRY}/landing:latest "$PROJECT_ROOT/services/landing"
load_to_cluster "${REGISTRY}/landing:${TAG}"

# Build runner (requires project root context due to agents/ and mcp-servers/ dependencies)
echo "Building runner..."
docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/runner:${TAG} -t ${REGISTRY}/runner:latest -f "$PROJECT_ROOT/services/runner/Dockerfile" "$PROJECT_ROOT/services"
load_to_cluster "${REGISTRY}/runner:${TAG}"

# Build MCP servers (all require project root context for shared dependencies)
echo "Building MCP servers..."
docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/mcp-gitea:${TAG} -t ${REGISTRY}/mcp-gitea:latest -f "$PROJECT_ROOT/services/mcp-servers/gitea-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_cluster "${REGISTRY}/mcp-gitea:${TAG}"

docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/mcp-conductor:${TAG} -t ${REGISTRY}/mcp-conductor:latest -f "$PROJECT_ROOT/services/mcp-servers/conductor-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_cluster "${REGISTRY}/mcp-conductor:${TAG}"

docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/mcp-system:${TAG} -t ${REGISTRY}/mcp-system:latest -f "$PROJECT_ROOT/services/mcp-servers/system-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_cluster "${REGISTRY}/mcp-system:${TAG}"

docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/mcp-vector:${TAG} -t ${REGISTRY}/mcp-vector:latest -f "$PROJECT_ROOT/services/mcp-servers/vector-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_cluster "${REGISTRY}/mcp-vector:${TAG}"

docker build $DOCKER_BUILD_ARGS -t ${REGISTRY}/mcp-sonar:${TAG} -t ${REGISTRY}/mcp-sonar:latest -f "$PROJECT_ROOT/services/mcp-servers/sonar-mcp/Dockerfile" "$PROJECT_ROOT/services/mcp-servers"
load_to_cluster "${REGISTRY}/mcp-sonar:${TAG}"

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
echo "  Cluster deployment (build + load images):"
echo "    REGISTRY='ghcr.io/cuemarshal' CLUSTER_PROVIDER=k3d CLUSTER_NAME=dev bash scripts/build-images.sh"
echo "    # CLUSTER_PROVIDER: docker-desktop | k3d | kind | minikube"
echo ""
echo "  Or use the deployment helper (auto-detects provider):"
echo "    bash scripts/deploy-to-cluster.sh dev"
echo ""
