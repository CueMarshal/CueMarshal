#!/usr/bin/env bash
set -euo pipefail

# Deploy CueMarshal to k3d local cluster
# Usage: bash scripts/deploy-to-k3d.sh [cluster-name] [build-registry]
#
# build-registry should include org (e.g., ghcr.io/cuemarshal or docker.io/cuemarshal)
# but the helm-registry passed to Helm will be just the base (ghcr.io or docker.io)

K3D_CLUSTER="${1:-dev}"
BUILD_REGISTRY="${2:-ghcr.io/cuemarshal}"  # Full registry with org for building
HELM_REGISTRY="$(echo $BUILD_REGISTRY | cut -d'/' -f1-2)"  # Extract just ghcr.io
TAG="latest"
NAMESPACE="cuemarshal-ws-${K3D_CLUSTER}"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         CueMarshal k3d Deployment Helper                   ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Cluster:        $K3D_CLUSTER"
echo "Build Registry: $BUILD_REGISTRY"
echo "Helm Registry:  $HELM_REGISTRY (Helm helper adds /cuemarshal/<component>)"
echo "Namespace:      $NAMESPACE"
echo ""

# Step 1: Check k3d cluster is running
echo "Step 1: Checking k3d cluster..."
if ! k3d cluster list | grep -q "^${K3D_CLUSTER}"; then
    echo "❌ k3d cluster '$K3D_CLUSTER' not found"
    echo ""
    echo "Create it with:"
    echo "  k3d cluster create $K3D_CLUSTER \\"
    echo "    --port '80:80@loadbalancer' \\"
    echo "    --port '443:443@loadbalancer'"
    exit 1
fi
echo "✅ k3d cluster '$K3D_CLUSTER' is running"

# Step 2: Build and load images
echo ""
echo "Step 2: Building Docker images and loading into k3d..."
REGISTRY="$BUILD_REGISTRY" TAG="$TAG" LOAD_TO_K3D=true K3D_CLUSTER="$K3D_CLUSTER" bash scripts/build-images.sh
echo "✅ Images loaded to k3d"

# Step 3: Deploy Helm chart
echo ""
echo "Step 3: Deploying Helm chart..."
helm upgrade --install "dev-workspace" ./infrastructure/helm/cuemarshal \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values ./infrastructure/helm/cuemarshal/local-values.yaml \
  --set "image.registry=$HELM_REGISTRY" \
  --set "image.tag=$TAG" \
  --set "image.pullPolicy=IfNotPresent" \
  --wait --timeout 5m
echo "✅ Helm deployment complete"

# Step 4: Wait for pods to be ready
echo ""
echo "Step 4: Waiting for pods to be ready..."
kubectl rollout status -n "$NAMESPACE" deployment/dev-workspace-cuemarshal-conductor --timeout=5m 2>/dev/null || true
kubectl rollout status -n "$NAMESPACE" deployment/dev-workspace-cuemarshal-gateway --timeout=5m 2>/dev/null || true

# Step 5: Show status
echo ""
echo "Step 5: Deployment status..."
echo ""
kubectl get pods -n "$NAMESPACE" -o wide
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Deployment Summary                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Deployment complete!"
echo ""
echo "Access the cluster:"
echo "  kubectl get pods -n $NAMESPACE"
echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=cuemarshal"
echo ""
echo "Get services:"
echo "  kubectl get svc -n $NAMESPACE"
echo ""
echo "Port forward to Gitea:"
echo "  kubectl port-forward -n $NAMESPACE svc/dev-workspace-cuemarshal-gitea 3000:3000"
echo ""
echo "Delete deployment:"
echo "  helm uninstall dev-workspace -n $NAMESPACE"
echo "  kubectl delete namespace $NAMESPACE"
echo ""
