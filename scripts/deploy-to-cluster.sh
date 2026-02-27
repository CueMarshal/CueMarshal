#!/usr/bin/env bash
set -euo pipefail

# Deploy CueMarshal to a local Kubernetes cluster
# Automatically detects: docker-desktop, k3d, kind, minikube
#
# Usage: bash scripts/deploy-to-cluster.sh [cluster-name] [build-registry] [tag] [namespace]
#
# build-registry should include org (e.g., ghcr.io/cuemarshal or docker.io/cuemarshal)
# but the helm-registry passed to Helm will be just the base (ghcr.io or docker.io)

RELEASE_NAME="${RELEASE_NAME:-cuemarshal}"
CLUSTER_NAME="${CLUSTER_NAME:-dev}"
BUILD_REGISTRY="${REGISTRY:-ghcr.io/cuemarshal}"
TAG="${TAG:-$(date +%Y%m%d-%H%M%S)}"
NAMESPACE="${NAMESPACE:-cuemarshal-local}"

# --- Cluster detection -----------------------------------------------------------

detect_cluster_provider() {
    if kubectl config get-contexts -o name 2>/dev/null | grep -q '^docker-desktop$'; then
        local current_ctx
        current_ctx="$(kubectl config current-context 2>/dev/null || true)"
        if [ "$current_ctx" = "docker-desktop" ]; then
            echo "docker-desktop"
            return
        fi
    fi

    if command -v k3d &>/dev/null && k3d cluster list -o json 2>/dev/null | grep -q "\"name\":\"${CLUSTER_NAME}\""; then
        echo "k3d"
        return
    fi

    if command -v kind &>/dev/null && kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
        echo "kind"
        return
    fi

    if command -v minikube &>/dev/null && minikube profile list -o json 2>/dev/null | grep -q "\"Name\":\"${CLUSTER_NAME}\""; then
        echo "minikube"
        return
    fi

    echo ""
}
PROVIDER="$(detect_cluster_provider)"

if [ -z "$PROVIDER" ]; then
    echo "❌ No local Kubernetes cluster detected for name '$CLUSTER_NAME'"
    echo ""
    echo "Supported providers and how to create a cluster:"
    echo ""
    echo "  docker-desktop  — Enable Kubernetes in Docker Desktop settings"
    echo ""
    echo "  k3d             — k3d cluster create $CLUSTER_NAME \\"
    echo "                       --port '80:80@loadbalancer' \\"
    echo "                       --port '443:443@loadbalancer'"
    echo ""
    echo "  kind            — kind create cluster --name $CLUSTER_NAME"
    echo ""
    echo "  minikube        — minikube start -p $CLUSTER_NAME"
    exit 1
fi

# Extract just the registry domain for Helm (e.g., ghcr.io or docker.io)
# The Helm template will append /cuemarshal/{component}
HELM_REGISTRY="$(echo "$BUILD_REGISTRY" | cut -d'/' -f1)"

# Note: For Docker Desktop, images are built in the shared Docker daemon
# with the BUILD_REGISTRY prefix, so HELM_REGISTRY must match to allow 
# Kubernetes to find them locally with imagePullPolicy: IfNotPresent
IMAGE_PULL_POLICY="${IMAGE_PULL_POLICY:-IfNotPresent}"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         CueMarshal Cluster Deployment Helper              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Provider:       $PROVIDER"
echo "Cluster:        $CLUSTER_NAME"
echo "Build Registry: $BUILD_REGISTRY"
echo "Helm Registry:  $HELM_REGISTRY (Helm helper adds /cuemarshal/<component>)"
echo "Namespace:      $NAMESPACE"
echo ""

# Step 1: Verify the cluster is reachable
echo "Step 1: Verifying cluster connectivity ($PROVIDER)..."

case "$PROVIDER" in
    docker-desktop)
        kubectl cluster-info &>/dev/null || { echo "❌ docker-desktop Kubernetes is not reachable. Enable it in Docker Desktop settings."; exit 1; }
        ;;
    k3d)
        kubectl config use-context "k3d-${CLUSTER_NAME}" &>/dev/null || true
        k3d cluster list | grep -q "^${CLUSTER_NAME}" || { echo "❌ k3d cluster '$CLUSTER_NAME' is not running. Start it with: k3d cluster start $CLUSTER_NAME"; exit 1; }
        ;;
    kind)
        kubectl config use-context "kind-${CLUSTER_NAME}" &>/dev/null || true
        kind get clusters | grep -q "^${CLUSTER_NAME}$" || { echo "❌ kind cluster '$CLUSTER_NAME' not found."; exit 1; }
        ;;
    minikube)
        minikube -p "$CLUSTER_NAME" status &>/dev/null || { echo "❌ minikube profile '$CLUSTER_NAME' is not running. Start it with: minikube start -p $CLUSTER_NAME"; exit 1; }
        kubectl config use-context "$CLUSTER_NAME" &>/dev/null || true
        ;;
esac

echo "✅ $PROVIDER cluster '$CLUSTER_NAME' is reachable"

# Step 2: Build and load images
echo ""
echo "Step 2: Building Docker images and loading into cluster..."
REGISTRY="$BUILD_REGISTRY" TAG="$TAG" \
    CLUSTER_PROVIDER="$PROVIDER" CLUSTER_NAME="$CLUSTER_NAME" \
    bash scripts/build-images.sh
echo "✅ Images loaded into $PROVIDER cluster"

# Step 3: Deploy Helm chart
echo ""
echo "Step 3: Deploying Helm chart..."
echo "⏳ Note: First deployment may take 10-15 minutes while dependencies initialize"
helm upgrade --install "$RELEASE_NAME" ./infrastructure/helm/cuemarshal \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values ./infrastructure/helm/cuemarshal/local-values.yaml \
  --set "image.registry=$HELM_REGISTRY" \
  --set "image.tag=$TAG" \
  --set "image.pullPolicy=$IMAGE_PULL_POLICY" \
  --wait --timeout 15m
echo "✅ Helm deployment complete"

# Step 4: Wait for pods to be ready
echo ""
echo "Step 4: Waiting for pods to be ready (this may take a few minutes)..."
echo "⏳ Tip: Monitor progress in another terminal with:"
echo "   kubectl get pods -n $NAMESPACE -w"
echo "   # or"
echo "   bash scripts/diagnose-deployment.sh $NAMESPACE $RELEASE_NAME"
echo ""

kubectl rollout status -n "$NAMESPACE" deployment/${RELEASE_NAME}-cuemarshal-conductor --timeout=5m 2>/dev/null || true
kubectl rollout status -n "$NAMESPACE" deployment/${RELEASE_NAME}-cuemarshal-gateway --timeout=5m 2>/dev/null || true

# Step 5: Show status
echo ""
echo "Step 5: Deployment status..."
echo ""
kubectl get pods -n "$NAMESPACE" -o wide
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Deployment Summary                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Deployment complete! (provider: $PROVIDER)"
echo ""
echo "Pod Status:"
kubectl get pods -n "$NAMESPACE" -o wide || true
echo ""
echo "Access the cluster:"
echo "  kubectl get pods -n $NAMESPACE"
echo "  kubectl logs -n $NAMESPACE -l app.kubernetes.io/name=cuemarshal"
echo ""
echo "If pods are still initializing, monitor progress with:"
echo "  bash scripts/diagnose-deployment.sh $NAMESPACE $RELEASE_NAME"
echo ""
echo "Get services:"
echo "  kubectl get svc -n $NAMESPACE"
echo ""
echo "Port forward to Gitea:"
echo "  kubectl port-forward -n $NAMESPACE svc/${RELEASE_NAME}-cuemarshal-gitea 3000:3000"
echo ""
echo "Delete deployment:"
echo "  helm uninstall $RELEASE_NAME -n $NAMESPACE"
echo "  kubectl delete namespace $NAMESPACE"
echo ""
echo "📖 For troubleshooting, see:"
echo "  docs/operations/DEPLOYMENT-TIMEOUT-QUICK-FIX.md"
echo "  docs/operations/troubleshooting-runbook.md"
echo ""
