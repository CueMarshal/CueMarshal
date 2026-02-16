# Helm Chart Templates - Implementation Checklist

## Status: Foundation Complete ✓

The chart structure is created with:
- ✓ Chart.yaml
- ✓ values.yaml (complete configuration spec)
- ✓ values.schema.json (contract with cuemarshal-cloud)
- ✓ templates/_helpers.tpl (template functions)
- ✓ templates/secrets.yaml (all secrets in one K8s Secret)
- ✓ README.md (usage documentation)

## Templates to Implement

The following Kubernetes manifests need to be created by converting the corresponding `docker-compose.yml` service definitions:

### ConfigMaps (6 files)
- [ ] `configmaps/gitea-app-ini.yaml` - From infrastructure/gitea/app.ini
- [ ] `configmaps/litellm-config.yaml` - From gateway/litellm_config.yaml  
- [ ] `configmaps/nginx-conf.yaml` - From infrastructure/nginx/nginx.conf
- [ ] `configmaps/redis-conf.yaml` - From infrastructure/redis/redis.conf
- [ ] `configmaps/postgres-init.yaml` - From infrastructure/postgres/*.sql

### Infrastructure Layer (5 files)
- [ ] `infrastructure/postgres-statefulset.yaml`
- [ ] `infrastructure/postgres-service.yaml`
- [ ] `infrastructure/postgres-pvc.yaml`
- [ ] `infrastructure/redis-deployment.yaml`
- [ ] `infrastructure/redis-service.yaml`

### Gitea (3 files)
- [ ] `gitea/gitea-statefulset.yaml`
- [ ] `gitea/gitea-service.yaml` (ports: 3000, 22)
- [ ] `gitea/gitea-pvc.yaml`

### Gateway (2 files)
- [ ] `gateway/gateway-deployment.yaml`
- [ ] `gateway/gateway-service.yaml`

### MCP Servers (6 files)
- [ ] `mcp/mcp-gitea-deployment.yaml`
- [ ] `mcp/mcp-conductor-deployment.yaml`
- [ ] `mcp/mcp-system-deployment.yaml`
- [ ] `mcp/mcp-vector-deployment.yaml`
- [ ] `mcp/mcp-sonar-deployment.yaml`
- [ ] `mcp/mcp-services.yaml` (5 ClusterIP services)

### Conductor (2 files)
- [ ] `conductor/conductor-deployment.yaml`
- [ ] `conductor/conductor-service.yaml`

### Runner (3 files)
- [ ] `runner/runner-statefulset.yaml` (2 replicas, DinD sidecar)
- [ ] `runner/runner-pvc.yaml`
- [ ] `runner/runner-serviceaccount.yaml`

### Init (1 file)
- [ ] `init/init-gitea-job.yaml` (one-time Job)

### Monitoring (4 files)
- [ ] `monitoring/prometheus-deployment.yaml`
- [ ] `monitoring/grafana-deployment.yaml`
- [ ] `monitoring/loki-deployment.yaml`
- [ ] `monitoring/promtail-daemonset.yaml`

### SonarQube (3 files)
- [ ] `sonarqube/sonarqube-statefulset.yaml`
- [ ] `sonarqube/sonarqube-service.yaml`
- [ ] `sonarqube/oauth2-proxy-deployment.yaml` (conditional on Google OAuth)

### Nginx (2 files)
- [ ] `nginx/nginx-deployment.yaml`
- [ ] `nginx/nginx-service.yaml`

### Cluster Resources (3 files)
- [ ] `ingress.yaml` - Ingress for <slug>.cuemarshal.dev
- [ ] `networkpolicy.yaml` - Deny cross-namespace traffic
- [ ] `resourcequota.yaml` - Per-workspace limits

## Total: 40 template files to implement

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
