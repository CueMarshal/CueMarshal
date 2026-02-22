# CueMarshal Productionization - Project Summary

## Overview

Transformation of the CueMarshal platform into **CueMarshal**, a production-ready AI software development platform with dual deployment models:

1. **Self-Hosted**: Docker Compose deployment with interactive `install.sh` wizard
2. **Hosted**: Managed cloud offering on Azure Kubernetes Service with web-based onboarding

## Key Achievements

### ✅ Two-Repo Architecture Established

**cuemarshal** (App Plane) - `~/source/repos/cuemarshal`
- Complete workspace services migrated from original codebase
- CueMarshal branding applied throughout
- Self-hosted onboarding via install.sh
- Helm chart foundation for K8s deployment
- CI/CD pipeline for building images and publishing chart to ACR
- Google OAuth SSO integration across all services

**cuemarshal-cloud** (Management Plane) - `~/source/repos/cuemarshal-cloud`
- Management API for user accounts and workspace lifecycle
- Google OAuth authentication
- Kubernetes provisioning engine (Helm-based)
- Onboarding web wizard foundation (Expo web)
- AKS cluster bootstrap infrastructure

### ✅ Self-Hosted Onboarding (Complete)

Interactive `install.sh` provides:
- Pre-flight validation (Docker, ports, resources)
- Auto-generated secrets (6 secure random strings)
- LLM provider configuration with API key testing
- Optional Google OAuth SSO setup
- Budget and model tier configuration
- Configuration review before deployment
- Automated Docker Compose launch
- Health check monitoring

**Usage**: `cd ~/source/repos/cuemarshal && ./install.sh`

### ✅ Unified Google OAuth SSO (Complete)

Single sign-on across all workspace services:
- **Gitea**: Google as external auth source (configured by init-gitea.sh)
- **Grafana**: Built-in Google OAuth support
- **SonarQube**: oauth2-proxy sidecar with Google provider
- **Mobile App**: Transparent - Gitea OAuth2 with Google behind it
- **Conductor/Runners**: Use Gitea API tokens (unaffected by SSO)

Benefits:
- One-click login across all services
- No password management
- Universal identity (Google email)
- Optional - fallback to username/password if not configured

### ✅ Helm Chart Foundation (Complete Structure)

`infrastructure/helm/cuemarshal/` with:
- `Chart.yaml`: Metadata (v1.0.0)
- `values.yaml`: 40+ configurable parameters
- `values.schema.json`: JSON Schema contract with management plane
- `templates/_helpers.tpl`: Helper functions
- `templates/secrets.yaml`: Unified secrets template
- README with usage documentation

**Remaining work**: 40 Kubernetes manifest templates (see `TEMPLATES_TODO.md`)

### ✅ CI/CD Pipeline (Complete)

`.github/workflows/build-images.yml`:
- Matrix build of 8 container images
- Push to Azure Container Registry
- Multi-tag strategy (latest, SHA, semver)
- Helm chart packaging and OCI publish
- Triggered on main/release branches and version tags

### ✅ Management API (Complete Foundation)

TypeScript/Express/Drizzle application with:
- Database schema (users, workspaces, subscriptions, provisioning_logs)
- Google OAuth authentication service
- Workspace CRUD API
- Configuration encryption (AES-256)
- Pino structured logging
- Zod-validated configuration

### ✅ Kubernetes Provisioning Engine (Complete)

`src/provisioning/` with:
- Kubernetes API client (@kubernetes/client-node)
- Helm orchestration (shell-out to helm CLI)
- Complete provisioning flow:
  1. Create namespace
  2. Install Helm release from ACR (OCI)
  3. Wait for pod readiness
  4. Wait for init-gitea Job completion
  5. Mark workspace active
- Deprovisioning flow (Helm uninstall + cleanup)
- Detailed logging to database

### ✅ Onboarding Web Wizard (Foundation)

Expo web application with:
- 3 of 9 screens implemented:
  1. Landing page with product overview
  2. Google sign-in
  3. Workspace name input with slug validation
- Zustand state management
- Management API client
- Material Design 3 (React Native Paper)
- Step progress indicator

## Current State

### What Works Today

**Self-Hosted**:
- Run `./install.sh` in ~/source/repos/cuemarshal
- Guided setup with secret generation
- Optional Google OAuth SSO
- Docker Compose deployment
- Full platform operational

**Infrastructure**:
- AKS bootstrap script ready
- CI/CD pipeline configured (needs ACR secrets)
- Helm chart structure defined
- Management API functional (needs deployment)

### What Needs Work

1. **Helm Chart Templates** (Priority: High)
   - 40 Kubernetes manifests need implementation
   - Convert each docker-compose service to K8s
   - See `infrastructure/helm/cuemarshal/TEMPLATES_TODO.md`

2. **Onboarding Wizard Screens** (Priority: Medium)
   - 6 remaining screens: LLM config, budget, review, payment, provisioning, complete
   - Follow pattern from completed screens
   - Connect to management API endpoints

3. **Management API Routes** (Priority: Medium)
   - Slug validation endpoint
   - LLM API key testing endpoint
   - Provisioning status WebSocket
   - Config update (triggers Helm upgrade)

4. **Wave Payment Integration** (Priority: Low)
   - GraphQL client for Wave Financial
   - Billing API routes
   - Webhook verification
   - Subscription management

5. **Production Hardening** (Priority: Low)
   - Azure Key Vault integration
   - NetworkPolicies and ResourceQuotas
   - Cluster-level monitoring
   - Backup/restore procedures
   - Comprehensive documentation

## Repository Status

### cuemarshal (App Plane)
```
Commits: 6
Last: Update README with deployment options and two-repo architecture
Branch: master
Status: ✅ Ready for self-hosted deployment
```

**Can be used today for**:
- Self-hosted Docker Compose deployment
- Google OAuth SSO (optional)
- Local development

**Needs before AKS deployment**:
- Complete Helm chart templates
- Test Helm deployment to AKS

### cuemarshal-cloud (Management Plane)
```
Commits: 5
Last: Update main README with comprehensive project documentation
Branch: master
Status: 🚧 Foundation complete, needs additional development
```

**Completed**:
- Management API structure
- Database schema
- Provisioning engine
- AKS bootstrap
- Onboarding wizard foundation

**Needs before production**:
- Remaining onboarding screens
- Additional API endpoints
- Wave payment integration
- Management plane Helm chart
- CI/CD for management image

## Next Steps Roadmap

### Immediate (1-2 weeks)
1. Complete Helm chart templates (convert all docker-compose services)
2. Test Helm deployment: deploy one workspace to AKS manually
3. Complete remaining onboarding wizard screens
4. Add missing management API endpoints

### Short-term (2-4 weeks)
5. Wave Financial integration
6. Management plane CI/CD
7. Management plane Helm chart
8. End-to-end testing (onboard -> provision -> use workspace)

### Medium-term (1-2 months)
9. Production hardening (Key Vault, NetworkPolicies, monitoring)
10. Workspace backup/restore
11. Documentation (deployment guides, operations runbook)
12. Add GitHub as secondary IDP (link to Google accounts)

## Architecture Highlights

### Google OAuth Everywhere
- **Management Plane**: Google sign-in for onboarding at app.cuemarshal.dev
- **Workspace**: Google SSO for Gitea, Grafana, SonarQube
- **Same identity**: Email-based linking across management and workspaces

### AKS Multi-Tenant Model
- One cluster, many namespaces
- Each workspace: `cuemarshal-ws-<slug>` namespace
- NetworkPolicies enforce isolation
- Shared ingress-nginx routes `*.cuemarshal.dev`
- cert-manager handles TLS

### Contract Between Repos
- App plane publishes Helm chart as OCI artifact to ACR
- Management plane pulls chart by version and deploys
- `values.schema.json` is the formal contract
- No code sharing - only the Helm values interface

## Success Metrics

### Phase 1-2 (Completed)
✅ Self-hosted users can deploy with zero Docker/YAML knowledge via `install.sh`  
✅ Google OAuth SSO reduces authentication complexity
✅ Helm chart foundation enables K8s deployment
✅ CI/CD automates image builds and chart publishing

### Phase 3-4 (In Progress)
🚧 Hosted users can onboard via web wizard
🚧 Workspaces provision automatically to AKS
🚧 Real-time provisioning progress visible to users

### Phase 5-6 (Planned)
❌ Payment integration gates access (Wave Financial)
❌ Production-grade security and monitoring
❌ Comprehensive documentation

## Resources

- **Original codebase**: ~/source/repos/cuemarshal (read-only reference)
- **App plane**: ~/source/repos/cuemarshal
- **Management plane**: ~/source/repos/cuemarshal-cloud
- **Plan document**: ~/.cursor/plans/productionize_onboarding_e060b31f.plan.md
