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

## Test 2: Helm Chart on Local Kubernetes

### Prerequisites
- A local Kubernetes cluster (one of: docker-desktop, k3d, kind, minikube)
- kubectl installed
- Helm 3.12+ installed

### Setup Local Cluster

Choose one of the supported providers:

**Docker Desktop** (macOS/Windows):
```bash
# Enable Kubernetes in Docker Desktop settings
# Settings → Kubernetes → Enable Kubernetes → Apply & Restart
```

**k3d** (lightweight, recommended for CI):
```bash
k3d cluster create dev \
  --port "80:80@loadbalancer" \
  --port "443:443@loadbalancer"
```

**kind**:
```bash
kind create cluster --name dev
```

**minikube**:
```bash
minikube start -p dev
```

Then add `demo.local` to `/etc/hosts` for local access:
```bash
echo "127.0.0.1 demo.local" | sudo tee -a /etc/hosts
```

**Note**: k3d includes **traefik** as the default ingress controller. Other providers may require installing an ingress controller separately.

### Deploy CueMarshal

The recommended approach is to use the `deploy-to-cluster.sh` script, which auto-detects the local cluster provider (docker-desktop, k3d, kind, minikube), builds images, loads them, and deploys the Helm chart in one step:

```bash
cd ~/source/repos/verbose-octo

# Ensure kubectl is pointing to your local cluster (the deploy script auto-detects provider)
kubectl config current-context

# Install Helm dependencies
cd infrastructure/helm/cuemarshal
helm dependency update
cd ../../../

# Deploy using the helper script (auto-detects provider, builds images, loads them, runs helm upgrade)
bash scripts/deploy-to-cluster.sh dev

# Watch pods starting
kubectl get pods -n cuemarshal-ws-dev --watch
```

Alternatively, deploy manually (requires images already loaded into the cluster):

```bash
helm upgrade --install dev-workspace ./infrastructure/helm/cuemarshal \
  --namespace cuemarshal-ws-dev \
  --create-namespace \
  --values ./infrastructure/helm/cuemarshal/local-values.yaml \
  --set "image.registry=ghcr.io/cuemarshal" \
  --set "image.tag=latest" \
  --set "image.pullPolicy=IfNotPresent" \
  --wait --timeout 5m
```

**Note:** The init-gitea job runs as a Helm `post-install,post-upgrade` hook. It executes after all core resources are ready and populates the OAuth2 client ID ConfigMap. This ensures the OAuth2 configuration survives `helm upgrade` operations.

### Expected Result

Full deployment with all core services running:
- PostgreSQL StatefulSet with persistence
- Redis Deployment
- Gitea with initialization hook (runs post-install/post-upgrade)
- Conductor service with BFF auth endpoints and OAuth2 client ID
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

# Check ingress is properly configured with traefik
kubectl get ingress -n cuemarshal-ws-dev
kubectl describe ingress dev-workspace-cuemarshal -n cuemarshal-ws-dev

# Verify landing service is accessible
curl -s http://demo.local | grep -q "CueMarshal" && echo "✓ Landing page loads"
curl -s -w "HTTP %{http_code}\n" http://demo.local

# Verify OAuth2 client ID is populated (should return a UUID, not empty)
kubectl get configmap -n cuemarshal-ws-dev dev-workspace-cuemarshal-oauth-config \
  -o jsonpath='{.data.oauth2_client_id}' && echo ""

# Verify BFF auth endpoint is working (should return "Missing required query parameters", not "not available")
curl -s http://demo.local/api/auth/authorize | grep -q "Missing required" \
  && echo "✓ BFF auth endpoint working" \
  || echo "✗ BFF auth endpoint not ready"

# Check logs if needed
kubectl logs -n cuemarshal-ws-dev deployment/dev-workspace-cuemarshal-landing
kubectl logs -n cuemarshal-ws-dev deployment/dev-workspace-cuemarshal-conductor

# Check database is initialized
kubectl get statefulset -n cuemarshal-ws-dev dev-workspace-cuemarshal-postgres
```

### Cleanup

```bash
# Uninstall Helm release
helm uninstall dev-workspace --namespace cuemarshal-ws-dev

# Delete namespace
kubectl delete namespace cuemarshal-ws-dev

# Delete the cluster (choose based on provider)
k3d cluster delete dev           # k3d
kind delete cluster --name dev   # kind
minikube delete -p dev           # minikube
# docker-desktop: disable Kubernetes in settings
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

## Test 5: Accessing Services in Local Cluster Deployment

### Prerequisites
- CueMarshal deployed to a local Kubernetes cluster (see Test 2)

### Accessing Individual Services

From your local machine with port-forwarding:

```bash
# Ensure kubectl context points to your local cluster
kubectl config current-context

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

## Test 6: OAuth2 Login Flow (Local Cluster Deployment)

### Prerequisites
- CueMarshal deployed to a local Kubernetes cluster (see Test 2)
- Landing page accessible at http://demo.local

### Authentication Architecture

The platform uses a **BFF (Backend For Frontend)** pattern for OAuth2 authentication:

1. **Frontend** (landing service) never has direct access to the OAuth2 client ID
2. **Conductor** reads the client ID from `/tokens/oauth2_client_id` (mounted from the `oauth-config` ConfigMap)
3. The init-gitea Helm hook creates the OAuth2 app in Gitea and writes the client ID to the ConfigMap
4. PKCE (S256) is used for the authorization code flow, with a JavaScript SHA-256 fallback for non-HTTPS contexts

### Login Flow Steps

1. User clicks "Login to Platform" on the landing page
2. Frontend calls `GET /api/auth/authorize` with PKCE code_challenge, redirect_uri, and state
3. Conductor injects the OAuth2 client ID server-side and returns the full Gitea authorize URL
4. Browser redirects to Gitea's OAuth consent page (`/login/oauth/authorize`)
5. If not logged in, Gitea redirects to `/user/login` first
6. After login + consent, Gitea redirects to `/oauth/callback?code=...&state=...`
7. Frontend calls `POST /api/auth/token` to exchange the code for an access token (via BFF)
8. Frontend calls `GET /api/auth/user` to fetch user info with the token
9. User lands on the authenticated dashboard

### Verification Checklist

```bash
# 1. Verify the OAuth2 client ID is populated
kubectl get configmap -n cuemarshal-ws-dev dev-workspace-cuemarshal-oauth-config \
  -o jsonpath='{.data.oauth2_client_id}' && echo ""
# Expected: a UUID like 28d518fd-4b46-40a0-a806-3069f39a78fa

# 2. Verify the BFF auth endpoint responds correctly
curl -s http://demo.local/api/auth/authorize
# Expected: {"error":"Missing required query parameters: redirect_uri, code_challenge, state"}
# NOT: {"error":"OAuth2 client ID is not available. Platform may still be initializing."}

# 3. Verify the legacy config endpoint shows the client ID
curl -s http://demo.local/api/config
# Expected: {"oauth2ClientId":"28d518fd-..."}
# NOT: {"oauth2ClientId":null}

# 4. Get admin credentials for manual login testing
kubectl get secret -n cuemarshal-ws-dev dev-workspace-cuemarshal-secrets \
  -o jsonpath='{.data.gitea-admin-password}' | base64 -d && echo ""

# 5. Verify the OAuth2 app exists in Gitea
ADMIN_TOKEN=$(kubectl exec -n cuemarshal-ws-dev dev-workspace-cuemarshal-gitea-0 -- \
  su git -c 'gitea admin user generate-access-token --username cuemarshal-admin --token-name verify-oauth --raw --scopes all' 2>/dev/null)
curl -s -H "Authorization: token $ADMIN_TOKEN" http://demo.local/api/v1/user/applications/oauth2
# Expected: array with a "CueMarshal" application entry
```

Manual browser test:
- [ ] Navigate to http://demo.local
- [ ] Click "Login to Platform"
- [ ] Redirected to Gitea sign-in page (`/user/login`)
- [ ] Enter admin credentials and click "Sign In"
- [ ] Gitea shows OAuth consent page: "Authorize CueMarshal to access your account?"
- [ ] Click "Authorize Application"
- [ ] Redirected back to landing page dashboard (authenticated)
- [ ] Username appears in top-right corner with "Logout" button
- [ ] Agent Activity panel shows all agents (Marshal, Ava, Dave, etc.)

## Current Test Coverage

### ✅ What Can Be Tested Now
1. Self-hosted Docker Compose deployment (complete)
2. install.sh wizard (complete)
3. Google OAuth SSO in Docker Compose (with credentials)
4. Management API locally (basic routes)
5. Onboarding web wizard (3 screens) locally
6. Helm chart structure and validation (`helm lint`)
7. **Full Helm deployment to local Kubernetes clusters**
   - Supported providers: docker-desktop, k3d, kind, minikube
   - All core services (postgres, redis, gitea, conductor, gateway, landing, mcp-servers, runner)
   - Ingress routing to landing service (traefik recommended for k3d)
   - Service discovery and inter-pod communication
   - Init-gitea Helm hook (post-install/post-upgrade)
   - Local development with hot-reload
8. **OAuth2 BFF login flow (end-to-end)**
   - Landing page "Login to Platform" button
   - BFF auth endpoints (`/api/auth/authorize`, `/api/auth/token`, `/api/auth/user`)
   - Gitea OAuth consent and authorization code exchange with PKCE
   - Authenticated dashboard with agent activity

### 🚧 What Needs More Work to Test
1. **Nginx-ingress controller** - Has Lua-based backend discovery issues on some local setups; traefik is recommended for k3d
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
   - Deploy workspace to local cluster automatically
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

### Ingress Controller Choice (Important for Local Clusters)

**Lesson Learned:** The Helm chart can be configured with different ingress controllers via `ingress.className`:

- **traefik** (RECOMMENDED for k3d): k3d's built-in ingress controller. Better integrated with k3d's networking, automatic LoadBalancer support, and reliable service discovery.
- **nginx**: Works well on cloud platforms and docker-desktop. The nginx-ingress controller uses Lua-based dynamic backend discovery which can have issues on some local setups.

For local clusters, the recommended approach:
- **k3d**: Use traefik (built-in)
- **docker-desktop**: Use nginx-ingress or install traefik
- **kind**: Install nginx-ingress or traefik via Helm
- **minikube**: Enable ingress addon (`minikube addons enable ingress`)

**Configuration** in `local-values.yaml`:
```yaml
ingress:
  enabled: true
  className: "traefik"  # or "nginx" depending on provider
  
ingress-nginx:
  enabled: false  # Disable if using traefik
```

### Docker Compose Issues
- **Services unhealthy**: Check logs with `docker compose logs -f <service>`
- **Port conflicts**: Stop conflicting services or change ports in docker-compose.yml
- **API key errors**: Verify keys with `scripts/validate-env.sh --prod`

### Local Cluster Issues
- **Pods pending**: Check storage with `kubectl get pvc -n cuemarshal-ws-dev`
- **ImagePullBackOff**: Images need to be in the registry or loaded into the cluster. Always use `deploy-to-cluster.sh` which handles image building and loading automatically for all supported providers (docker-desktop, k3d, kind, minikube). Running `helm upgrade` alone without loading images first will cause this error.
- **Ingress not working**:
  - Verify your ingress controller is running: `kubectl get pods -n kube-system | grep -E 'traefik|nginx'`
  - Check ingress status: `kubectl describe ingress -n cuemarshal-ws-dev`
  - Verify /etc/hosts has `127.0.0.1 demo.local`
- **404 responses from ingress**: Likely backend service discovery issue - verify ingress controller is compatible with your cluster provider
- **LoadBalancer service pending**: docker-desktop and k3d handle this automatically; for kind/minikube you may need MetalLB or NodePort services

### OAuth2 / Authentication Issues

- **Login returns 503 or "OAuth2 client ID is not available"**: The `oauth-config` ConfigMap is empty. The init-gitea Helm hook may not have completed successfully. Check and fix:
  ```bash
  # Check if ConfigMap has a value
  kubectl get configmap -n cuemarshal-ws-dev dev-workspace-cuemarshal-oauth-config \
    -o jsonpath='{.data.oauth2_client_id}' && echo ""

  # If empty, retrieve the client ID from Gitea and patch manually
  ADMIN_TOKEN=$(kubectl exec -n cuemarshal-ws-dev dev-workspace-cuemarshal-gitea-0 -- \
    su git -c 'gitea admin user generate-access-token --username cuemarshal-admin --token-name fix-oauth --raw --scopes all' 2>/dev/null)
  CLIENT_ID=$(curl -s -H "Authorization: token $ADMIN_TOKEN" \
    http://demo.local/api/v1/user/applications/oauth2 | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['client_id'])")

  # Patch the ConfigMap
  kubectl patch configmap -n cuemarshal-ws-dev dev-workspace-cuemarshal-oauth-config \
    --type merge -p "{\"data\":{\"oauth2_client_id\":\"$CLIENT_ID\"}}"

  # Restart conductor to pick up the new value
  kubectl delete pod -n cuemarshal-ws-dev -l app.kubernetes.io/name=cuemarshal,component=conductor
  ```

- **`/api/config` returns `{"oauth2ClientId":null}`**: Same root cause as above -- the conductor cannot read the client ID from `/tokens/oauth2_client_id`. Follow the manual patch steps.

- **Gitea login page appears but OAuth callback fails**: Check that the OAuth2 app in Gitea has the correct redirect URI (`http://demo.local/oauth/callback`). Verify with:
  ```bash
  curl -s -H "Authorization: token $ADMIN_TOKEN" \
    http://demo.local/api/v1/user/applications/oauth2 | python3 -m json.tool
  ```

- **`crypto.subtle not available` console warning**: Expected on HTTP (non-HTTPS) contexts. The frontend has a JavaScript SHA-256 fallback for PKCE code challenges. This does not affect functionality.

- **`crypto.randomUUID not available` console warning**: Expected on HTTP contexts. The frontend uses a fallback UUID generator. This does not affect functionality.

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
