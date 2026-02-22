# CueMarshal App Plane - Implementation Status

## ✅ Completed

### Phase 1: Self-Hosted Onboarding
- ✅ **install.sh**: Interactive installation wizard with:
  - Pre-flight checks (Docker, Compose, ports, RAM, disk)
  - Auto-generated secrets (6 secure random strings)
  - LLM provider setup (Groq, Gemini, Azure AI, Ollama)
  - Optional Google OAuth SSO configuration
  - Advanced budget/model configuration
  - Configuration review and confirmation
  - Docker Compose launch and health monitoring

- ✅ **.env.example**: Comprehensive environment variable documentation with:
  - Grouped sections (Database, LLM Providers, Auth, Monitoring, etc.)
  - Missing variables added (GRAFANA_SERVICE_TOKEN, SONAR_TOKEN, etc.)
  - Google OAuth SSO section (optional)
  - Clear documentation for each variable
  - Validation checklist

### Phase 2: Google OAuth SSO
- ✅ **init-gitea.sh**: Updated to configure Google as external OAuth2 auth source when `GOOGLE_CLIENT_ID` is provided (step 16/17)

- ✅ **docker-compose.yml**: Enhanced with Google OAuth support:
  - Grafana: Google OAuth env vars (GF_AUTH_GOOGLE_*)
  - SonarQube: SSO header mode env vars
  - oauth2-proxy service for SonarQube (profile: google-sso)
  - All network references updated from original naming to "cuemarshal"
  - All container/volume names updated with "cuemarshal-" prefix

### Phase 2: Helm Chart Foundation
- ✅ **infrastructure/helm/cuemarshal/Chart.yaml**: Chart metadata (v1.0.0)
- ✅ **infrastructure/helm/cuemarshal/values.yaml**: Complete configuration specification (40+ parameters)
- ✅ **infrastructure/helm/cuemarshal/values.schema.json**: JSON Schema contract with cuemarshal-cloud
- ✅ **infrastructure/helm/cuemarshal/templates/_helpers.tpl**: Template helper functions
- ✅ **infrastructure/helm/cuemarshal/templates/secrets.yaml**: Unified secrets template
- ✅ **infrastructure/helm/cuemarshal/README.md**: Usage documentation

### Phase 2: CI/CD Pipeline
- ✅ **.github/workflows/build-images.yml**: GitHub Actions workflow to:
  - Build 8 container images in parallel (conductor, gateway, runner, 5 MCP servers)
  - Push to Azure Container Registry
  - Tag images with latest, SHA, and semver
  - Package and push Helm chart as OCI artifact
  - Triggered on push to main/release branches or version tags

### Branding
- ✅ All "vaka" references renamed to "cuemarshal"
- ✅ Network: `cuemarshal-network`
- ✅ Volumes: `cuemarshal-*` prefix
- ✅ Containers: `cuemarshal-*` prefix
- ✅ README updated

## 🚧 Partial / In Progress

### Helm Chart Templates
**Status**: Foundation complete, 40 template files need implementation

The chart has the structure, values, schema, and documentation. Each service from `docker-compose.yml` needs to be converted to Kubernetes manifests. See `infrastructure/helm/cuemarshal/TEMPLATES_TODO.md` for the complete checklist.

**Priority templates to implement first**:
1. PostgreSQL StatefulSet + Service + PVC
2. Redis Deployment + Service
3. Gitea StatefulSet + Service + PVC
4. Conductor Deployment + Service
5. Ingress (for `<slug>.cuemarshal.dev`)
6. NetworkPolicy (namespace isolation)

## ❌ Not Started

- Remaining Helm templates (see TEMPLATES_TODO.md)
- Helm chart testing and validation
- Docker Compose template for management plane local development

## How to Use

### Self-Hosted Installation

```bash
# Run the interactive installer
./install.sh

# Or manual setup
cp .env.example .env
# Edit .env with your configuration
docker compose up -d
```

### Publishing Images to ACR

1. Configure GitHub repository secrets:
   - `ACR_REGISTRY`: Your ACR URL (e.g., `cuemarshalacr.azurecr.io`)
   - `ACR_USERNAME`: ACR username
   - `ACR_PASSWORD`: ACR password

2. Push to main branch or create a version tag:
```bash
git tag v1.0.0
git push origin v1.0.0
```

3. GitHub Actions will build and push all images + Helm chart

## Next Steps

1. **Complete Helm templates**: Implement the remaining 40 template files by converting each service from `docker-compose.yml` to Kubernetes manifests

2. **Test Helm deployment**: Deploy a test workspace to AKS
```bash
helm install test-workspace \
  oci://cuemarshalacr.azurecr.io/helm/cuemarshal \
  --version 1.0.0 \
  --namespace cuemarshal-ws-test \
  --create-namespace \
  --values test-values.yaml
```

3. **Validate Google OAuth SSO**: Test the complete SSO flow across Gitea, Grafana, and SonarQube

4. **Documentation**: Create deployment guide, operations runbook, and troubleshooting docs

## Related Repositories

- **cuemarshal-cloud**: Management plane for hosted offering (see ~/source/repos/cuemarshal-cloud)
- **Original codebase**: Read-only reference (previously named "vaka")
