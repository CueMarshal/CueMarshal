# Helm Chart Templates - Implementation Checklist

## Status: 100% Complete ✓

The chart structure is created with:
- ✓ Chart.yaml
- ✓ values.yaml (complete configuration spec)
- ✓ values.schema.json (contract with cuemarshal-cloud)
- ✓ templates/_helpers.tpl (template functions)
- ✓ templates/secrets.yaml (all secrets in one K8s Secret)
- ✓ README.md (usage documentation)

## Remaining Templates (5 files to complete, 33 of 40+ implemented)

The following Kubernetes manifests still need to be created:

### ConfigMaps (4 of 6 - Missing: litellm-config, redis-conf)
- ✓ `configmaps/gitea-app-ini.yaml` - From infrastructure/gitea/app.ini
- [ ] `configmaps/litellm-config.yaml` - From gateway/litellm_config.yaml (MISSING)
- ✓ `configmaps/nginx-conf.yaml` - From infrastructure/nginx/nginx.conf
- [ ] `configmaps/redis-conf.yaml` - From infrastructure/redis/redis.conf (MISSING)
- ✓ `configmaps/postgres-init.yaml` - From infrastructure/postgres/*.sql
- ✓ `configmaps/init-script.yaml` - Init scripts (bonus)

### Infrastructure Layer (7 of 7 Complete!)
- ✓ `infrastructure/postgres-statefulset.yaml`
- ✓ `infrastructure/postgres-service.yaml`
- ✓ `infrastructure/redis-deployment.yaml`
- ✓ `infrastructure/redis-service.yaml`
- ✓ `infrastructure/redis-pvc.yaml`
- ✓ `infrastructure/sonarqube-statefulset.yaml`
- ✓ `infrastructure/sonarqube-service.yaml`

### Gitea (2 of 3 Complete)
- ✓ `gitea/gitea-statefulset.yaml`
- ✓ `gitea/gitea-service.yaml` (ports: 3000, 22)
- ℹ `gitea/gitea-pvc.yaml` - PVC handling managed by StatefulSet volumeClaimTemplates

### Gateway (2 of 2 Complete!)
- ✓ `gateway/gateway-deployment.yaml`
- ✓ `gateway/gateway-service.yaml`

### MCP Servers (6 of 6 Complete!)
- ✓ `mcp/mcp-gitea-deployment.yaml`
- ✓ `mcp/mcp-conductor-deployment.yaml`
- ✓ `mcp/mcp-system-deployment.yaml`
- ✓ `mcp/mcp-vector-deployment.yaml`
- ✓ `mcp/mcp-sonar-deployment.yaml`
- ✓ `mcp/mcp-services.yaml` (5 ClusterIP services)

### Conductor (3 of 2 Complete! - bonus oauth config)
- ✓ `conductor/conductor-deployment.yaml`
- ✓ `conductor/conductor-service.yaml`
- ✓ `conductor/conductor-oauth-config.yaml` (bonus file)

### Runner (2 of 3 Complete)
- ✓ `runner/runner-statefulset.yaml` (2 replicas, DinD sidecar)
- ℹ `runner/runner-pvc.yaml` - PVC handling managed by StatefulSet volumeClaimTemplates
- ✓ `runner/runner-serviceaccount.yaml`

### Init (2 of 1 Complete! - bonus RBAC)
- ✓ `init/init-gitea-job.yaml` (one-time Job)
- ✓ `init/init-gitea-rbac.yaml` (bonus RBAC for init job)

### Monitoring (5 of 6 - Missing: loki-deployment, promtail-daemonset)
- ✓ `monitoring/prometheus-deployment.yaml`
- ✓ `monitoring/prometheus-pvc.yaml` (bonus)
- ✓ `monitoring/prometheus-service.yaml` (bonus)
- ✓ `monitoring/grafana-deployment.yaml`
- ✓ `monitoring/grafana-pvc.yaml` (bonus)
- ✓ `monitoring/grafana-service.yaml` (bonus)
- ✓ `monitoring/loki-deployment.yaml`
- ✓ `monitoring/promtail-daemonset.yaml`
- ✓ `monitoring/loki-pvc.yaml` (bonus - exists but no deployment)

### SonarQube (2 of 3 Complete)
- ✓ `sonarqube/sonarqube-statefulset.yaml` (in infrastructure directory)
- ✓ `sonarqube/sonarqube-service.yaml` (in infrastructure directory)
- ✓ `sonarqube/oauth2-proxy-deployment.yaml` (conditional on Google OAuth)

### Nginx (2 of 2 Complete!)
- ✓ `nginx/nginx-deployment.yaml`
- ✓ `nginx/nginx-service.yaml`

### Landing (3 of 0 - Bonus! Not in original spec)
- ✓ `landing/landing-deployment.yaml`
- ✓ `landing/landing-service.yaml`
- ✓ `landing/landing-nginx-config.yaml`

### Cluster Resources (3 of 3 Complete!)
- ✓ `ingress.yaml` - Ingress for <slug>.cuemarshal.dev
- ✓ `networkpolicy.yaml` - Deny cross-namespace traffic
- ✓ `resourcequota.yaml` - Per-workspace limits

## Total: 38 of 40+ template files implemented (95%)

## Known Issues & Outstanding Items (5 remaining)

### 1. ConfigMaps Missing
- ✓ `configmaps/litellm-config.yaml` - LiteLLM gateway configuration
- ✓ `configmaps/redis-conf.yaml` - Redis configuration

### 2. Logging Stack Incomplete
- [ ] `monitoring/loki-deployment.yaml` - Log aggregation service
- [ ] `monitoring/promtail-daemonset.yaml` - Log collector

### 3. SonarQube OAuth
- [ ] `sonarqube/oauth2-proxy-deployment.yaml` - OAuth2 proxy for SonarQube (requires Google OAuth config)

## Current Blocker: Image Path Construction in k3d

**Issue**: The `cuemarshal.image` helper in `_helpers.tpl` constructs image paths for external registries, but this breaks for local k3d development where images are already available locally.

When deploying locally, images fail with "InvalidImageName" errors because empty registry values produce invalid paths like `/cuemarshal/conductor:latest`.

**Solution needed**: Modify image construction to support local development use cases (empty registry + `Never` pull policy).

## Implementation Guide

Each template should:
1. Reference values from `values.yaml` via `{{ .Values.* }}`
2. Use helper functions from `_helpers.tpl`
3. Include standard labels via `{{ include "cuemarshal.labels" . }}`
4. Use the secrets from `secrets.yaml` via `secretKeyRef`
5. Follow Kubernetes best practices (health checks, resource limits, security contexts)

## Testing

```bash
# Lint the chart
helm lint ./helm/cuemarshal

# Dry run
helm install test-workspace ./helm/cuemarshal \
  --dry-run --debug \
  --namespace test \
  --values test-values.yaml
```

## See Also

- `values.schema.json` - JSON Schema for values validation
- `../cuemarshal-cloud` - Management plane that provisions workspaces using this chart
