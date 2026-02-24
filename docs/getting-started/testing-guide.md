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

## Test 2: Helm Chart on k3d

### Prerequisites
- k3d installed
- kubectl installed
- Helm 3.12+ installed

### Setup k3d

```bash
# Create k3d cluster with ingress ports mapped
k3d cluster create dev \
  --port "80:80@loadbalancer" \
  --port "443:443@loadbalancer"

# Verify k3d is running
k3d cluster list

# Add demo.local to /etc/hosts for local access
echo "127.0.0.1 demo.local" | sudo tee -a /etc/hosts
```

**Important**: k3d comes with **traefik** as the default ingress controller (not nginx-ingress). Traefik is fully integrated with k3d's networking and service discovery.

### Deploy CueMarshal

```bash
cd ~/source/repos/verbose-octo

# Update kubeconfig to access the cluster
k3d kubeconfig get dev > ~/.kube/k3d-dev-config
export KUBECONFIG=~/.kube/k3d-dev-config

# Install Helm dependencies
cd infrastructure/helm/cuemarshal
helm dependency update

# Deploy CueMarshal using local-values.yaml
cd ../../../
helm install dev-workspace ./infrastructure/helm/cuemarshal \
  --namespace cuemarshal-ws-dev \
  --create-namespace \
  --values ./infrastructure/helm/cuemarshal/local-values.yaml

# Watch pods starting
kubectl get pods -n cuemarshal-ws-dev --watch
```

### Expected Result

Full deployment with all core services running:
- PostgreSQL StatefulSet with persistence
- Redis Deployment 
- Gitea with initialization job
- Conductor service with proper configuration
- Gateway service
- Landing page accessible via Traefik ingress
- MCP (Model Context Protocol) servers
- Runner with Docker-in-Docker support
- Traefik ingress configured for demo.local

### Verification Checklist

```bash
# Check all resources are created and running
kubectl get all -n cuemarshal-ws-dev

# Verify core services are healthy
kubectl get statefulset -n cuemarshal-ws-dev  # postgres, runner
kubectl get deployment -n cuemarshal-ws-dev   # All other services
kubectl get jobs -n cuemarshal-ws-dev         # init-gitea should be Completed

# Check ingress is properly configured with traefik
kubectl get ingress -n cuemarshal-ws-dev
kubectl describe ingress dev-workspace-cuemarshal -n cuemarshal-ws-dev

# Verify landing service is accessible
curl -s http://demo.local | grep -q "CueMarshal" && echo "✓ Landing page loads"
curl -s -w "HTTP %{http_code}\n" http://demo.local

# Check logs if needed
kubectl logs -n cuemarshal-ws-dev deployment/dev-workspace-cuemarshal-landing

# Check database is initialized
kubectl get statefulset -n cuemarshal-ws-dev dev-workspace-cuemarshal-postgres
```

### Cleanup

```bash
# Uninstall
helm uninstall dev-workspace --namespace cuemarshal-ws-dev

# Delete namespace
kubectl delete namespace cuemarshal-ws-dev

# Stop k3d
k3d cluster delete dev
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
cd ~/source/repos/verbose-octo/mobile

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

## Test 5: Accessing Services in k3d Deployment

### Prerequisites
- CueMarshal deployed to k3d (see Test 2)

### Accessing Individual Services

From your local machine with port-forwarding:

```bash
export KUBECONFIG=~/.kube/k3d-dev-config

# Access Gitea
kubectl port-forward -n cuemarshal-ws-dev svc/dev-workspace-cuemarshal-gitea 3000:3000 &
# Then visit http://localhost:3000

# Access Conductor API
kubectl port-forward -n cuemarshal-ws-dev svc/dev-workspace-cuemarshal-conductor 8180:80 &
# Then test: curl http://localhost:8180/health

# Access Gateway
kubectl port-forward -n cuemarshal-ws-dev svc/dev-workspace-cuemarshal-gateway 8080:80 &
# Then check: curl http://localhost:8080/health

# Access PostgreSQL (for debugging)
kubectl port-forward -n cuemarshal-ws-dev svc/dev-workspace-cuemarshal-postgres 5432:5432 &
# Then connect: psql -h localhost -U postgres -W
```

### Accessing via Ingress (Traefik)

All services are accessible through the Traefik ingress on demo.local:

```bash
# Landing page (main entry point)
curl http://demo.local

# Direct service access (if routes configured)
curl http://api.demo.local          # Gateway
curl http://admin.demo.local        # Gitea
curl http://config.demo.local       # Conductor configuration
```

### Verification Checklist
- [ ] Landing page loads at http://demo.local (HTTP 200)
- [ ] Can access Gitea via port-forward
- [ ] Conductor API responds to health check
- [ ] Can view logs: `kubectl logs -f -n cuemarshal-ws-dev deployment/dev-workspace-cuemarshal-landing`
- [ ] Database is initialized: `kubectl exec -n cuemarshal-ws-dev statefulset/dev-workspace-cuemarshal-postgres -- psql -U postgres -l`

## Current Test Coverage

### ✅ What Can Be Tested Now
1. Self-hosted Docker Compose deployment (complete)
2. install.sh wizard (complete)
3. Google OAuth SSO in Docker Compose (with credentials)
4. Management API locally (basic routes)
5. Onboarding web wizard (3 screens) locally
6. Helm chart structure and validation (`helm lint`)
7. **Full Helm deployment to k3d with traefik** ✨ NEW
   - All core services (postgres, redis, gitea, conductor, gateway, landing, mcp-servers, runner)
   - Traefik ingress routing to landing service
   - Service discovery and inter-pod communication
   - Init jobs (Gitea initialization)
   - Local development with hot-reload

### 🚧 What Needs More Work to Test
1. **Nginx-ingress controller** - Has Lua-based backend discovery issues; use **traefik instead** (k3d built-in)
2. **End-to-end onboarding flow** - Requires 6 more screens
3. **Workspace provisioning** - Gitea repository creation within deployed workspace
4. **Wave payment** - Requires Wave API credentials
5. **Production AKS deployment** - Requires ACR, AKS cluster, images pushed

## Priority for Complete Testing

1. **Gateway and Conductor integration**:
   - Verify inter-service communication works correctly
   - Test workflow creation through Conductor
   - Verify Gateway routes requests properly

2. **Gitea integration**:
   - Verify Gitea initialization job completes successfully
   - Test webhook configuration
   - Verify OAuth SSO works if configured

3. **End-to-end onboarding flow** (when available):
   - Create workspace via web wizard
   - Deploy workspace to k3d automatically
   - Verify all services are accessible

4. **Production deployment** (for staging/CI):
   - Test AKS deployment
   - Verify Azure Key Vault integration
   - Test production networking and ingress configuration
   - Verify monitoring and logging stack

5. **Stress testing**:
   - Multiple concurrent workflows
   - Large file uploads
   - Extended workflow execution times
   - Pod restart resilience

## Troubleshooting

### Ingress Controller Choice (Important for k3d)

**Lesson Learned:** The Helm chart can be configured with different ingress controllers via `ingress.className`:

- **traefik** (RECOMMENDED for k3d): k3d's built-in ingress controller. Better integrated with k3d's networking, automatic LoadBalancer support, and reliable service discovery.
- **nginx** (NOT recommended for k3d): The nginx-ingress controller uses Lua-based dynamic backend discovery which can have issues resolving services. Works better on cloud platforms with proper load balancer support.

**Configuration** in `local-values.yaml`:
```yaml
ingress:
  enabled: true
  className: "traefik"  # Use traefik for k3d
  
ingress-nginx:
  enabled: false  # Disable nginx-ingress for k3d
```

### Docker Compose Issues
- **Services unhealthy**: Check logs with `docker compose logs -f <service>`
- **Port conflicts**: Stop conflicting services or change ports in docker-compose.yml
- **API key errors**: Verify keys with `scripts/validate-env.sh --prod`

### k3d Issues
- **Pods pending**: Check storage with `kubectl get pvc -n cuemarshal-ws-dev`
- **ImagePullBackOff**: Images need to be in registry or loaded into k3d with `k3d image import`
- **Ingress not working**: 
  - Verify traefik is running: `kubectl get pods -n kube-system | grep traefik`
  - Check ingress status: `kubectl describe ingress -n cuemarshal-ws-dev`
  - Verify /etc/hosts has `127.0.0.1 demo.local`
- **404 responses from ingress**: Likely backend service discovery issue - use traefik instead of nginx-ingress
- **LoadBalancer service pending**: k3d should auto-assign EXTERNAL-IP with traefik; if not, restart services

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
