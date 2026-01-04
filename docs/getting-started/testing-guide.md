# CueMarshal Testing Guide

## Test 1: Self-Hosted Deployment (Docker Compose)

### Prerequisites
- Docker >= 24.0
- Docker Compose v2+
- At least one LLM provider API key (Groq recommended - free tier)

### Steps

```bash
cd ~/source/repos/cuemarshal

# Run interactive installer
./install.sh

# Follow prompts:
# - Workspace name: test
# - Accept auto-generated secrets
# - Select Groq, enter API key
# - Skip Google OAuth (or configure if you have credentials)
# - Accept defaults for budget
# - Confirm and install
```

### Expected Result
- All services start successfully
- Gitea accessible at http://localhost:3300
- Conductor accessible at http://localhost:8180/api
- Can login to Gitea (cuemarshal-admin / <generated-password>)
- If Google OAuth configured: "Sign in with Google" button appears

### Verification Checklist
- [ ] `docker compose ps` shows all services "healthy"
- [ ] Gitea UI loads at http://localhost:3300
- [ ] Can login to Gitea
- [ ] Conductor health check: `curl http://localhost:8180/health`
- [ ] If Google OAuth: Gitea shows Google sign-in option
- [ ] Grafana loads at http://localhost:8180/grafana (if enabled)

## Test 2: Helm Chart on Minikube

### Prerequisites
- minikube installed
- kubectl installed
- Helm 3.12+ installed

### Setup Minikube

```bash
# Start minikube with sufficient resources
minikube start --cpus=4 --memory=8192 --disk-size=20g

# Enable ingress addon
minikube addons enable ingress

# Verify
kubectl get pods -n ingress-nginx
```

### Deploy CueMarshal

```bash
cd ~/source/repos/cuemarshal

# Install from local chart
helm install test-workspace ./infrastructure/helm/cuemarshal \
  --namespace cuemarshal-ws-test \
  --create-namespace \
  --values ./infrastructure/helm/cuemarshal/test-values.yaml \
  --debug

# Watch pods starting
kubectl get pods -n cuemarshal-ws-test --watch
```

### Expected Result (Current State)

With the current templates (postgres, redis, ingress, policies), you should see:
- PostgreSQL StatefulSet created and running
- Redis Deployment created and running
- Services created for postgres and redis
- Ingress created for test.local

**Note**: This is a minimal deployment. Full functionality requires the remaining templates (Gitea, Conductor, Gateway, etc.). See `infrastructure/helm/cuemarshal/TEMPLATES_TODO.md`.

### Verification Checklist

```bash
# Check all resources created
kubectl get all -n cuemarshal-ws-test

# Check postgres
kubectl get statefulset -n cuemarshal-ws-test
kubectl logs -n cuemarshal-ws-test statefulset/test-workspace-cuemarshal-postgres

# Check redis
kubectl get deployment -n cuemarshal-ws-test
kubectl logs -n cuemarshal-ws-test deployment/test-workspace-cuemarshal-redis

# Check secrets
kubectl get secret -n cuemarshal-ws-test test-workspace-cuemarshal-secrets -o yaml

# Check ingress
kubectl get ingress -n cuemarshal-ws-test
```

### Cleanup

```bash
# Uninstall
helm uninstall test-workspace --namespace cuemarshal-ws-test

# Delete namespace
kubectl delete namespace cuemarshal-ws-test

# Stop minikube
minikube stop
```

## Test 3: Management API (Local Development)

### Prerequisites
- Node.js 22+
- PostgreSQL (can use Docker: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:18-alpine`)

### Steps

```bash
cd ~/source/repos/cuemarshal-cloud/src

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env:
# - Set DATABASE_URL to your local postgres
# - Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or skip OAuth testing)
# - Generate ENCRYPTION_KEY and SESSION_SECRET: openssl rand -base64 32

# Run migrations
npm run db:migrate

# Start API
npm run dev
```

### Verification Checklist
- [ ] API starts on port 3000
- [ ] Health check: `curl http://localhost:3000/health`
- [ ] Database tables created (users, workspaces, subscriptions, provisioning_logs)
- [ ] Google OAuth redirect: visit http://localhost:3000/auth/google (should redirect to Google)

## Test 4: Onboarding Web Wizard (Local Development)

### Prerequisites
- Management API running (see Test 3)

### Steps

```bash
cd ~/source/repos/cuemarshal-cloud/web

# Install dependencies
npm install

# Start Expo dev server
npm run web
```

### Verification Checklist
- [ ] Web app loads at http://localhost:8081
- [ ] Landing page shows "Welcome to CueMarshal"
- [ ] Click "Get Started" navigates to login
- [ ] Login screen shows "Continue with Google"
- [ ] Navigation to workspace screen works

## Current Test Coverage

### ✅ What Can Be Tested Now
1. Self-hosted Docker Compose deployment (complete)
2. install.sh wizard (complete)
3. Google OAuth SSO in Docker Compose (with credentials)
4. Management API locally (basic routes)
5. Onboarding web wizard (3 screens) locally
6. Helm chart structure and validation (`helm lint`)
7. Minimal Helm deployment to minikube (postgres + redis only)

### 🚧 What Needs More Work to Test
1. **Full Helm deployment** - Requires remaining 30+ templates
2. **End-to-end onboarding flow** - Requires 6 more screens
3. **Workspace provisioning** - Requires complete Helm chart
4. **Wave payment** - Requires Wave API credentials
5. **Production AKS deployment** - Requires ACR, AKS cluster, images pushed

## Priority for Complete Testing

1. **Finish Helm templates** (critical path):
   - Gitea (StatefulSet, Service, ConfigMap)
   - Conductor (Deployment, Service)
   - Gateway (Deployment, Service, ConfigMap)
   - Init Job (for init-gitea.sh)
   - Nginx (Deployment, Service, ConfigMap)

2. **Test on minikube**:
   - Deploy full stack
   - Verify init-gitea completes
   - Access Gitea via ingress
   - Test Google OAuth (if configured)

3. **Complete onboarding screens**:
   - Remaining 6 screens
   - Connect to management API
   - Test end-to-end flow

4. **Integration test**:
   - Onboard via web wizard
   - Provision workspace to minikube
   - Access workspace services
   - Create an issue in Gitea
   - Verify agent workflow

## Troubleshooting

### Docker Compose Issues
- **Services unhealthy**: Check logs with `docker compose logs -f <service>`
- **Port conflicts**: Stop conflicting services or change ports in docker-compose.yml
- **API key errors**: Verify keys with `scripts/validate-env.sh --prod`

### Minikube Issues
- **Pods pending**: Check storage with `kubectl get pvc -n cuemarshal-ws-test`
- **ImagePullBackOff**: Images need to be in registry or loaded into minikube
- **Ingress not working**: Verify ingress addon with `minikube addons list`

### Management API Issues
- **Connection refused**: Check DATABASE_URL points to running postgres
- **OAuth errors**: Verify GOOGLE_CLIENT_ID and callback URL configured in Google Cloud Console
- **Encryption errors**: Ensure ENCRYPTION_KEY is at least 32 characters

## Next Steps After Testing

1. Address any bugs found during testing
2. Complete remaining Helm templates
3. Implement Wave payment integration
4. Production hardening (Key Vault, monitoring, backup)
5. Documentation (deployment guide, operations runbook)
