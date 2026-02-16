# CueMarshal Helm Chart

Deploys a complete CueMarshal workspace to a Kubernetes namespace.

## Prerequisites

- Kubernetes 1.28+
- Helm 3.12+
- Persistent Volume provisioner (for StatefulSets)
- Ingress controller (nginx-ingress recommended)
- cert-manager (for TLS)

## Installation

### From OCI Registry (Production)

```bash
# Install a workspace to a dedicated namespace
helm install my-workspace \
  oci://myregistry.azurecr.io/helm/cuemarshal \
  --version 1.0.0 \
  --namespace cuemarshal-ws-my-workspace \
  --create-namespace \
  --values my-values.yaml
```

### From Source (Development)

```bash
# Install from local chart directory
helm install my-workspace ./infrastructure/helm/cuemarshal \
  --namespace cuemarshal-ws-my-workspace \
  --create-namespace \
  --set workspace.slug=my-workspace \
  --set image.registry=myregistry.azurecr.io \
  --set secrets.postgresPassword=securepass \
  --set secrets.redisPassword=securepass \
  --set secrets.litellmMasterKey=securekey \
  --set secrets.webhookSecret=securesecret \
  --set secrets.conductorSecret=securesecret \
  --set secrets.giteaAdminPassword=securepass \
  --set llm.groqApiKey=gsk_...
```

## Required Configuration

### Minimum Required Values

```yaml
workspace:
  slug: "my-workspace"  # Unique identifier

image:
  registry: "myregistry.azurecr.io"

secrets:
  postgresPassword: "<generated-32-char>"
  redisPassword: "<generated-32-char>"
  litellmMasterKey: "<generated-32-char>"
  webhookSecret: "<generated-32-char>"
  conductorSecret: "<generated-32-char>"
  giteaAdminPassword: "<generated-32-char>"

llm:
  # At least one provider required
  groqApiKey: "gsk_..."
  # OR
  geminiApiKey: "AIzaSy..."
  # OR
  azureAiApiKey: "..."
  azureAiApiBase: "https://..."
```

### Optional: Google OAuth SSO

```yaml
auth:
  google:
    clientId: "1234567890-abc.apps.googleusercontent.com"
    clientSecret: "GOCSPX-..."
```

When configured, enables unified SSO across Gitea, Grafana, and SonarQube.

## Chart Templates

### Infrastructure Layer
- `infrastructure/postgres-statefulset.yaml` - PostgreSQL database
- `infrastructure/postgres-service.yaml` - PostgreSQL service
- `infrastructure/postgres-pvc.yaml` - PostgreSQL persistent volume
- `infrastructure/redis-deployment.yaml` - Redis cache/queue
- `infrastructure/redis-service.yaml` - Redis service

### Gitea Layer
- `gitea/gitea-statefulset.yaml` - Gitea git server
- `gitea/gitea-service.yaml` - Gitea service (ports 3000, 22)
- `gitea/gitea-pvc.yaml` - Gitea data volume
- `configmaps/gitea-app-ini.yaml` - Gitea configuration

### Gateway Layer
- `gateway/gateway-deployment.yaml` - LiteLLM gateway
- `gateway/gateway-service.yaml` - Gateway service
- `configmaps/litellm-config.yaml` - LiteLLM routing configuration

### MCP Layer
- `mcp/mcp-gitea-deployment.yaml` - Gitea MCP server
- `mcp/mcp-conductor-deployment.yaml` - Conductor MCP server
- `mcp/mcp-system-deployment.yaml` - System MCP server
- `mcp/mcp-vector-deployment.yaml` - Vector MCP server
- `mcp/mcp-sonar-deployment.yaml` - Sonar MCP server
- `mcp/mcp-services.yaml` - All MCP ClusterIP services

### Conductor Layer
- `conductor/conductor-deployment.yaml` - Orchestration service
- `conductor/conductor-service.yaml` - Conductor API service

### Runner Layer
- `runner/runner-statefulset.yaml` - Gitea Act Runners (2 replicas)
- `runner/runner-serviceaccount.yaml` - ServiceAccount for runners
- `runner/runner-pvc.yaml` - Runner data volumes

### Init Layer
- `init/init-gitea-job.yaml` - Initialization Job (runs once)

### Monitoring Layer
- `monitoring/prometheus-deployment.yaml` - Metrics collection
- `monitoring/grafana-deployment.yaml` - Dashboards
- `monitoring/loki-deployment.yaml` - Log aggregation
- `monitoring/promtail-daemonset.yaml` - Log shipper

### SonarQube Layer
- `sonarqube/sonarqube-statefulset.yaml` - Code quality analysis
- `sonarqube/sonarqube-service.yaml` - SonarQube service
- `sonarqube/oauth2-proxy-deployment.yaml` - OAuth2 proxy (when Google SSO enabled)

### Nginx Layer
- `nginx/nginx-deployment.yaml` - Reverse proxy
- `nginx/nginx-service.yaml` - Nginx service
- `configmaps/nginx-conf.yaml` - Nginx configuration

### Cluster Resources
- `ingress.yaml` - Ingress for <slug>.cuemarshal.dev
- `networkpolicy.yaml` - Namespace isolation
- `resourcequota.yaml` - Resource limits

## Upgrade

```bash
helm upgrade my-workspace \
  oci://myregistry.azurecr.io/helm/cuemarshal \
  --namespace cuemarshal-ws-my-workspace \
  --values my-values.yaml \
  --reuse-values
```

## Uninstall

```bash
# Remove the Helm release
helm uninstall my-workspace --namespace cuemarshal-ws-my-workspace

# Clean up PVCs
kubectl delete pvc -n cuemarshal-ws-my-workspace --all

# Delete the namespace
kubectl delete namespace cuemarshal-ws-my-workspace
```

## Access URLs

After installation, services are available at:

- **Gitea**: `https://<slug>.cuemarshal.dev/`
- **Grafana**: `https://<slug>.cuemarshal.dev/grafana`
- **SonarQube**: `https://<slug>.cuemarshal.dev/sonar`
- **Conductor API**: `https://<slug>.cuemarshal.dev/api`

## Development

To render templates locally without installing:

```bash
helm template my-workspace ./infrastructure/helm/cuemarshal \
  --values test-values.yaml \
  --debug
```

## Publishing to ACR

```bash
# Package the chart
helm package ./infrastructure/helm/cuemarshal

# Push to ACR as OCI artifact
helm push cuemarshal-1.0.0.tgz oci://myregistry.azurecr.io/helm
```
