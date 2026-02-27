#!/usr/bin/env bash
set -euo pipefail

# Diagnose CueMarshal deployment issues
# 
# Usage: bash scripts/diagnose-deployment.sh [namespace] [release-name]
#
# This script helps troubleshoot common deployment issues by checking:
# - Pod status and events
# - Container logs
# - Resource constraints
# - Dependency health (Postgres, Redis, Gitea)

NAMESPACE="${1:-cuemarshal-local}"
RELEASE_NAME="${2:-cuemarshal}"

if ! kubectl cluster-info &>/dev/null; then
    echo "❌ No Kubernetes cluster connected"
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    echo "❌ Namespace '$NAMESPACE' not found"
    echo ""
    echo "Available namespaces:"
    kubectl get namespaces -o name | sed 's/namespace\//  /'
    exit 1
fi

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           CueMarshal Deployment Diagnostics               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Namespace: $NAMESPACE"
echo "Release:   $RELEASE_NAME"
echo ""

# Step 1: Pod Status Overview
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  POD STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

POD_STATUS=$(kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null || true)
if [ -z "$POD_STATUS" ]; then
    echo "⚠️  No pods found in namespace"
else
    echo "$POD_STATUS"
    echo ""
    
    # Count pod states
    PENDING=$(echo "$POD_STATUS" | grep -c "Pending" || true)
    RUNNING=$(echo "$POD_STATUS" | grep -c "Running" || true)
    FAILED=$(echo "$POD_STATUS" | grep -c "Failed" || true)
    CRASH=$(echo "$POD_STATUS" | grep -c "CrashLoopBackOff" || true)
    
    echo "Summary:"
    echo "  Running:          $RUNNING"
    echo "  Pending:          $PENDING"
    echo "  Failed:           $FAILED"
    echo "  CrashLoopBackOff: $CRASH"
    echo ""
fi

# Step 2: Event Log
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  RECENT EVENTS (Last 10 minutes)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
kubectl get events -n "$NAMESPACE" --sort-by='.lastTimestamp' | tail -20
echo ""

# Step 3: Check critical services
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  CRITICAL DEPENDENCY STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check PostgreSQL
echo -n "PostgreSQL:     "
PG_POD=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/component=postgres" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$PG_POD" ]; then
    echo "❌ Pod not found"
else
    PG_STATUS=$(kubectl get pods -n "$NAMESPACE" "$PG_POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    if [ "$PG_STATUS" = "Running" ]; then
        echo "✅ Running"
    else
        echo "❌ $PG_STATUS"
    fi
fi

# Check Redis
echo -n "Redis:          "
RD_POD=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/component=redis" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$RD_POD" ]; then
    echo "❌ Pod not found"
else
    RD_STATUS=$(kubectl get pods -n "$NAMESPACE" "$RD_POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    if [ "$RD_STATUS" = "Running" ]; then
        echo "✅ Running"
    else
        echo "❌ $RD_STATUS"
    fi
fi

# Check Gitea
echo -n "Gitea:          "
GE_POD=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/component=gitea" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$GE_POD" ]; then
    echo "❌ Pod not found"
else
    GE_STATUS=$(kubectl get pods -n "$NAMESPACE" "$GE_POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    if [ "$GE_STATUS" = "Running" ]; then
        echo "✅ Running"
    else
        echo "❌ $GE_STATUS"
    fi
fi

# Check Conductor
echo -n "Conductor:      "
CD_POD=$(kubectl get pods -n "$NAMESPACE" -l "app.kubernetes.io/component=conductor" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -z "$CD_POD" ]; then
    echo "❌ Pod not found"
else
    CD_STATUS=$(kubectl get pods -n "$NAMESPACE" "$CD_POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    if [ "$CD_STATUS" = "Running" ]; then
        echo "✅ Running"
    else
        echo "❌ $CD_STATUS"
    fi
fi

echo ""

# Step 4: Pod Descriptions for Failed/Pending Pods
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  DETAILS FOR NON-RUNNING PODS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PROBLEM_PODS=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -z "$PROBLEM_PODS" ]; then
    echo "✅ All pods are running!"
else
    for POD in $PROBLEM_PODS; do
        echo "Pod: $POD"
        kubectl describe pod -n "$NAMESPACE" "$POD" | grep -A 10 "Events:" || true
        echo ""
    done
fi

# Step 5: Resource Constraints
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  RESOURCE USAGE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v kubectl &>/dev/null && kubectl top nodes &>/dev/null; then
    echo "Node Resources:"
    kubectl top nodes || true
    echo ""
    echo "Pod Resources:"
    kubectl top pods -n "$NAMESPACE" || true
else
    echo "⚠️  metrics-server not installed. Install with:"
    echo "   kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"
fi

echo ""

# Step 6: Storage Status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6️⃣  PERSISTENT VOLUME CLAIMS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

kubectl get pvc -n "$NAMESPACE" || echo "⚠️  No PVCs found"
echo ""

# Step 7: Common Issues Checklist
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "7️⃣  COMMON TROUBLESHOOTING CHECKLIST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check image pull
IMAGEPULL=$(kubectl get events -n "$NAMESPACE" --field-selector type=Warning 2>/dev/null | grep -c "ImagePull\|ErrImagePull" || true)
if [ "$IMAGEPULL" -gt 0 ]; then
    echo "⚠️  Image pull issues detected!"
    echo "   Check image registry credentials and image availability"
fi

# Check resource constraints
INSUFFICIENT=$(kubectl get events -n "$NAMESPACE" --field-selector type=Warning 2>/dev/null | grep -c "Insufficient\|OutOfmemory" || true)
if [ "$INSUFFICIENT" -gt 0 ]; then
    echo "⚠️  Resource constraints detected!"
    echo "   Check node capacity: kubectl top nodes"
    echo "   Consider reducing resource requests in values.yaml"
fi

# Check readiness probe failures
READINESS=$(kubectl get events -n "$NAMESPACE" --field-selector type=Warning 2>/dev/null | grep -c "ReadinessProbe\|Readiness" || true)
if [ "$READINESS" -gt 0 ]; then
    echo "⚠️  Readiness probe failures detected!"
    echo "   Check pod logs: kubectl logs -n $NAMESPACE <pod-name>"
    echo "   May need to increase initialDelaySeconds in values.yaml"
fi

# Check CrashLoopBackOff
if [ "$CRASH" -gt 0 ]; then
    echo "⚠️  Pods in CrashLoopBackOff state!"
    echo "   Check pod logs for application errors"
fi

echo ""

# Step 8: Log Tail for Critical Pods
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "8️⃣  LATEST LOGS FROM CONDUCTOR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -n "$CD_POD" ]; then
    echo "Last 20 lines from conductor pod:"
    kubectl logs -n "$NAMESPACE" "$CD_POD" --tail=20 2>/dev/null || echo "⚠️  Unable to fetch logs"
else
    echo "⚠️  Conductor pod not found yet (still initializing?)"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                 Diagnostic Summary Complete                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Check pod logs:    kubectl logs -n $NAMESPACE <pod-name>"
echo "2. Describe a pod:    kubectl describe pod -n $NAMESPACE <pod-name>"
echo "3. Stream pod logs:   kubectl logs -n $NAMESPACE -l app.kubernetes.io/component=conductor -f"
echo "4. Check init job:    kubectl get jobs -n $NAMESPACE"
echo ""
