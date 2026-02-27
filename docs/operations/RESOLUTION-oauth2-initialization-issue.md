# OAuth2 Initialization Issue - Resolution

**Issue**: `Login failed: OAuth2 client ID is not available. Platform may still be initializing.`

**Status**: ✅ RESOLVED

## Root Cause Analysis

The OAuth2 initialization issue was caused by a **Persistent Volume (PV) node affinity mismatch** in the Kubernetes cluster:

1. **init-gitea job** requires access to **two PVCs**:
   - `cuemarshal-tokens` - for storing OAuth2 client ID and other tokens  
   - `data-cuemarshal-gitea-0` - for Gitea data directory

2. **Local-path provisioner** (default storage class) creates PVs with **node affinity constraints** that pin them to specific nodes based on when the PVC is created.

3. **Critical Issue**: When PVCs are created at different times, the local-path provisioner assigns them to different nodes:
   - `cuemarshal-tokens` → `desktop-worker` (or `desktop-worker2`)
   - `data-cuemarshal-gitea-0` → `desktop-worker2` (or `desktop-worker`)

4. **Result**: The init-gitea pod **couldn't be scheduled** because Kubernetes requires a pod to run on a single node. With PVs on different nodes, no node could satisfy both volume requirements, causing the pod to remain in "Pending" state indefinitely.

### Sequence of Events

```
Deployment Start
    ↓
Docker Desktop Cluster (3 nodes)
    ├─ desktop-control-plane
    ├─ desktop-worker
    └─ desktop-worker2
    ↓
PVC Creation (at different times)
    ├─ cuemarshal-tokens → Provisioned on desktop-worker
    ├─ data-cuemarshal-gitea-0 → Provisioned on desktop-worker2
    ↓
init-gitea Pod Scheduling Attempt
    ├─ Requires: tokens PVC (on desktop-worker)
    ├─ Requires: gitea-data PVC (on desktop-worker2)
    ├─ Result: Cannot schedule on any node → PENDING
    ↓
OAuth2 Client ID Never Created
    └─ conductor service cannot read /tokens/oauth2_client_id
    └─ Login fails with "OAuth2 client ID not available"
```

## Solution

### Fix: Pod Affinity Rule

Added **pod affinity** to the init-gitea job template to ensure it schedules on the **same node as the gitea pod**:

**File**: [infrastructure/helm/cuemarshal/templates/init/init-gitea-job.yaml](../infrastructure/helm/cuemarshal/templates/init/init-gitea-job.yaml)

```yaml
affinity:
  podAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
    - weight: 100
      podAffinityTerm:
        labelSelector:
          matchExpressions:
          - key: app.kubernetes.io/name
            operator: In
            values:
            - "{{ include "cuemarshal.name" . }}"
          - key: statefulset.kubernetes.io/pod-name
            operator: In
            values:
            - "{{ include "cuemarshal.fullname" . }}-gitea-0"
        topologyKey: kubernetes.io/hostname
```

**How it works**:
1. init-gitea job specifies **pod affinity preference** to run on the same node as `gitea-0` pod
2. When Kubernetes schedules PVCs/pods, it tries to place new PVs on the same node as existing pods
3. Since gitea pod runs on a specific node with an existing PV, new PVCs get provisioned on that same node
4. init-gitea pod can now be scheduled and can access both volume mounts

### Implementation Steps

1. **Cleaned up stuck resources**:
   - Deleted the stuck init-gitea job
   - Deleted pending tokens and gitea-data PVCs
   - Deleted the entire namespace for fresh start

2. **Updated Helm template**:
   - Added pod affinity rules to init-gitea job
   - Ensures proper scheduling sequence

3. **Redeployed platform**:
   - Ran full deployment with corrected template
   - PVCs now created on the same node
   - init-gitea job successfully completed

## Verification

### Successful Initialization Indicators

✅ **init-gitea Job Completion**:
```bash
kubectl get jobs -n cuemarshal-local
# Status: Completed
```

✅ **OAuth2 Client ID Configured**:
```bash
kubectl get configmap -n cuemarshal-local cuemarshal-oauth-config \
  -o jsonpath='{.data.oauth2_client_id}'
# Output: bd15ceee-fd96-4aa6-96b9-1055c2537e01
```

✅ **Token Files Created**:
```bash
kubectl exec -n cuemarshal-local <conductor-pod> -- ls -la /tokens/
# -rw-r--r--  oauth2_client_id
# -rw-r--r--  admin_token
# -rw-r--r--  bot_token
# ... and 10 other role-based tokens
```

✅ **Conductor Logs Show Ready State**:
```
✓ System initialized (marker file found)
✓ Recovery service started
🚀 CueMarshal Conductor is ready
```

✅ **PVCs on Same Node**:
```bash
kubectl describe pv pvc-bfa6db9c-... # tokens
# Node Affinity: kubernetes.io/hostname in [desktop-worker]

kubectl describe pv pvc-55c4a9e0-... # gitea-data
# Node Affinity: kubernetes.io/hostname in [desktop-worker]
```

## Impact

- **Platform Availability**: ✅ Full platform initialization now completes successfully
- **OAuth2 Authentication**: ✅ No more "client ID not available" errors
- **Login Functionality**: ✅ Users can now authenticate via OAuth2
- **Scheduled Agents**: ✅ All 7 SDLC agents can now be dispatched

## Prevention

### For Future Deployments

1. **Use pod affinity** when multiple PVCs are required by a single pod during initialization
2. **Consider shared storage** (NFS, eBS) for distributed deployments instead of local-path provisioner
3. **Monitor init job completion** in post-install Helm hooks to catch scheduling issues early
4. **Test on multi-node clusters** before production to expose node affinity issues

### For Current Deployments

If you see `"OAuth2 client ID is not available"` in the future:

1. **Check init-gitea job status**:
   ```bash
   kubectl get jobs -n cuemarshal-local cuemarshal-init-gitea
   ```

2. **Verify PVC node affinity**:
   ```bash
   kubectl describe pv <pv-name> | grep "Node Affinity"
   ```

3. **If mismatch exists**, delete the PVCs and restart the deployment:
   ```bash
   kubectl delete pvc -n cuemarshal-local cuemarshal-tokens data-cuemarshal-gitea-0
   bash scripts/deploy-to-cluster.sh
   ```

## Timeline

- **Issue Detected**: Feb 27, 2026 - init-gitea pod stuck in Pending for 27 minutes
- **Root Cause Identified**: PV node affinity mismatch (different nodes)
- **Fix Implemented**: Pod affinity rules added to init-gitea job
- **Resolution Verified**: OAuth2 client ID successfully created and available
- **Status**: ✅ Production Ready

## References

- [Kubernetes Pod Affinity Documentation](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/#inter-pod-affinity-and-anti-affinity)
- [Conductor OAuth2 Implementation](../../services/conductor/src/api/auth.ts)
- [init-gitea Script](../../infrastructure/gitea/init-gitea.sh)
- [Testing Guide - OAuth2 Issues](./testing-guide.md#oauth2--authentication-issues)
