#!/usr/bin/env bash
set -euo pipefail

# CueMarshal Interactive Installer
# Self-hosted deployment wizard with guided configuration

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration variables
WORKSPACE_NAME="cuemarshal"
DOCKER_MIN_VERSION="24.0"
COMPOSE_MIN_VERSION="2.0"
MIN_RAM_GB=8
MIN_DISK_GB=20
REQUIRED_PORTS=(3300 8180 9000)

# LLM Providers
declare -A LLM_PROVIDERS
SELECTED_PROVIDERS=()

# Secrets (auto-generated)
POSTGRES_PASSWORD=""
REDIS_PASSWORD=""
LITELLM_MASTER_KEY=""
WEBHOOK_SECRET=""
CONDUCTOR_SECRET=""
GITEA_ADMIN_PASSWORD=""

# Google SSO (optional)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
ENABLE_GOOGLE_SSO=false

# Budget settings
TOTAL_MONTHLY_BUDGET_USD=100
SELF_IMPROVE_BUDGET_PCT=10

#===============================================================================
# Utility Functions
#===============================================================================

print_banner() {
    echo -e "${BLUE}"
    cat << 'EOF'
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║               CueMarshal Installation Wizard              ║
    ║                                                           ║
    ║    Self-hosted AI Software Development Platform          ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

log_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

log_success() {
    echo -e "${GREEN}✓${NC}  $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

log_error() {
    echo -e "${RED}✗${NC}  $1"
}

prompt() {
    local prompt_text="$1"
    local default_value="${2:-}"
    local response

    if [ -n "$default_value" ]; then
        read -p "$(echo -e ${BLUE}?${NC}) $prompt_text [$default_value]: " response
        echo "${response:-$default_value}"
    else
        read -p "$(echo -e ${BLUE}?${NC}) $prompt_text: " response
        echo "$response"
    fi
}

prompt_yes_no() {
    local prompt_text="$1"
    local default="${2:-n}"
    local response

    if [ "$default" = "y" ]; then
        read -p "$(echo -e ${BLUE}?${NC}) $prompt_text [Y/n]: " response
        response="${response:-y}"
    else
        read -p "$(echo -e ${BLUE}?${NC}) $prompt_text [y/N]: " response
        response="${response:-n}"
    fi

    [[ "$response" =~ ^[Yy]$ ]]
}

generate_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

#===============================================================================
# Pre-flight Checks
#===============================================================================

check_command() {
    command -v "$1" >/dev/null 2>&1
}

check_docker() {
    log_info "Checking Docker installation..."
    
    if ! check_command docker; then
        log_error "Docker is not installed. Please install Docker >= $DOCKER_MIN_VERSION"
        exit 1
    fi

    local docker_version
    docker_version=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
    
    if ! printf '%s\n' "$DOCKER_MIN_VERSION" "$docker_version" | sort -V -C; then
        log_error "Docker version $docker_version is too old. Minimum required: $DOCKER_MIN_VERSION"
        exit 1
    fi

    log_success "Docker $docker_version installed"
}

check_docker_compose() {
    log_info "Checking Docker Compose..."
    
    if ! docker compose version >/dev/null 2>&1; then
        log_error "Docker Compose v2 is not available. Please install Docker Compose >= $COMPOSE_MIN_VERSION"
        exit 1
    fi

    local compose_version
    compose_version=$(docker compose version --short 2>/dev/null || echo "0.0.0")
    
    if ! printf '%s\n' "$COMPOSE_MIN_VERSION" "$compose_version" | sort -V -C; then
        log_error "Docker Compose version $compose_version is too old. Minimum required: $COMPOSE_MIN_VERSION"
        exit 1
    fi

    log_success "Docker Compose $compose_version installed"
}

check_ports() {
    log_info "Checking required ports availability..."
    
    local port_conflicts=()
    for port in "${REQUIRED_PORTS[@]}"; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            port_conflicts+=("$port")
        fi
    done

    if [ ${#port_conflicts[@]} -gt 0 ]; then
        log_error "The following ports are already in use: ${port_conflicts[*]}"
        log_error "Please free these ports before continuing."
        exit 1
    fi

    log_success "All required ports (${REQUIRED_PORTS[*]}) are available"
}

check_resources() {
    log_info "Checking system resources..."
    
    # Check RAM
    local total_ram_gb
    total_ram_gb=$(free -g | awk '/^Mem:/{print $2}')
    
    if [ "$total_ram_gb" -lt "$MIN_RAM_GB" ]; then
        log_warning "System has ${total_ram_gb}GB RAM, recommended minimum is ${MIN_RAM_GB}GB"
    else
        log_success "System RAM: ${total_ram_gb}GB (>= ${MIN_RAM_GB}GB required)"
    fi

    # Check disk space
    local available_disk_gb
    available_disk_gb=$(df -BG . | tail -1 | awk '{print $4}' | tr -d 'G')
    
    if [ "$available_disk_gb" -lt "$MIN_DISK_GB" ]; then
        log_error "Only ${available_disk_gb}GB disk space available, minimum ${MIN_DISK_GB}GB required"
        exit 1
    fi

    log_success "Available disk space: ${available_disk_gb}GB (>= ${MIN_DISK_GB}GB required)"
}

run_preflight_checks() {
    echo
    log_info "Running pre-flight checks..."
    echo

    check_docker
    check_docker_compose
    check_ports
    check_resources

    echo
    log_success "All pre-flight checks passed!"
    echo
}

#===============================================================================
# Configuration Steps
#===============================================================================

configure_workspace_name() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 1: Workspace Name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    log_info "This name is used for organization and repository naming in Gitea."
    WORKSPACE_NAME=$(prompt "Workspace name" "cuemarshal")

    log_success "Workspace name set to: $WORKSPACE_NAME"
}

configure_secrets() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 2: Generate Secrets${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    log_info "Generating secure random secrets..."

    POSTGRES_PASSWORD=$(generate_secret)
    REDIS_PASSWORD=$(generate_secret)
    LITELLM_MASTER_KEY=$(generate_secret)
    WEBHOOK_SECRET=$(generate_secret)
    CONDUCTOR_SECRET=$(generate_secret)
    GITEA_ADMIN_PASSWORD=$(generate_secret)

    log_success "Generated 6 secure secrets (32 characters each)"
}

test_llm_api_key() {
    local provider="$1"
    local api_key="$2"
    
    case "$provider" in
        groq)
            if curl -sf -X POST "https://api.groq.com/openai/v1/models" \
                -H "Authorization: Bearer $api_key" \
                -H "Content-Type: application/json" >/dev/null 2>&1; then
                return 0
            fi
            ;;
        gemini)
            if curl -sf "https://generativelanguage.googleapis.com/v1/models?key=$api_key" >/dev/null 2>&1; then
                return 0
            fi
            ;;
        azure-ai)
            log_info "Azure AI requires both API key and base URL - skipping automated validation"
            return 0
            ;;
    esac
    
    return 1
}

configure_llm_providers() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 3: LLM Provider Setup${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    log_info "At least one LLM provider is required."
    echo

    # Groq
    if prompt_yes_no "Enable Groq (fast, free tier available)" "y"; then
        local groq_key
        groq_key=$(prompt "Groq API Key (from console.groq.com)")
        
        if [ -n "$groq_key" ]; then
            log_info "Testing Groq API key..."
            if test_llm_api_key "groq" "$groq_key"; then
                LLM_PROVIDERS[GROQ_API_KEY]="$groq_key"
                SELECTED_PROVIDERS+=("Groq")
                log_success "Groq API key validated"
            else
                log_warning "Groq API key validation failed (will use anyway)"
                LLM_PROVIDERS[GROQ_API_KEY]="$groq_key"
                SELECTED_PROVIDERS+=("Groq")
            fi
        fi
    fi

    # Gemini
    if prompt_yes_no "Enable Google Gemini" "n"; then
        local gemini_key
        gemini_key=$(prompt "Gemini API Key (from aistudio.google.com)")
        
        if [ -n "$gemini_key" ]; then
            log_info "Testing Gemini API key..."
            if test_llm_api_key "gemini" "$gemini_key"; then
                LLM_PROVIDERS[GEMINI_API_KEY]="$gemini_key"
                SELECTED_PROVIDERS+=("Gemini")
                log_success "Gemini API key validated"
            else
                log_warning "Gemini API key validation failed (will use anyway)"
                LLM_PROVIDERS[GEMINI_API_KEY]="$gemini_key"
                SELECTED_PROVIDERS+=("Gemini")
            fi
        fi
    fi

    # Azure AI
    if prompt_yes_no "Enable Azure AI" "n"; then
        local azure_key azure_base
        azure_key=$(prompt "Azure AI API Key")
        azure_base=$(prompt "Azure AI API Base URL")
        
        if [ -n "$azure_key" ] && [ -n "$azure_base" ]; then
            LLM_PROVIDERS[AZURE_AI_API_KEY]="$azure_key"
            LLM_PROVIDERS[AZURE_AI_API_BASE]="$azure_base"
            SELECTED_PROVIDERS+=("Azure AI")
            log_success "Azure AI configured"
        fi
    fi

    # Ollama (local)
    if prompt_yes_no "Enable Ollama (local models)" "n"; then
        log_info "Ollama will be started as part of the stack"
        LLM_PROVIDERS[ENABLE_OLLAMA]="true"
        LLM_PROVIDERS[OLLAMA_MODELS]="deepseek-coder-v2"
        SELECTED_PROVIDERS+=("Ollama (local)")
        log_success "Ollama enabled"
    fi

    if [ ${#SELECTED_PROVIDERS[@]} -eq 0 ]; then
        log_error "At least one LLM provider is required!"
        configure_llm_providers
        return
    fi

    echo
    log_success "Configured LLM providers: ${SELECTED_PROVIDERS[*]}"
}

configure_google_sso() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 4: Google OAuth SSO (Optional)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    log_info "Google OAuth enables unified SSO across Gitea, Grafana, and SonarQube."
    log_info "If skipped, standard username/password authentication will be used."
    echo

    if prompt_yes_no "Enable Google OAuth SSO?" "n"; then
        ENABLE_GOOGLE_SSO=true
        
        echo
        log_info "Create OAuth 2.0 credentials at: https://console.cloud.google.com/apis/credentials"
        log_info "Authorized redirect URIs:"
        log_info "  - http://localhost:3300/user/oauth2/Google/callback"
        log_info "  - http://localhost:8180/grafana/login/google/callback"
        echo

        GOOGLE_CLIENT_ID=$(prompt "Google OAuth Client ID")
        GOOGLE_CLIENT_SECRET=$(prompt "Google OAuth Client Secret")

        if [ -n "$GOOGLE_CLIENT_ID" ] && [ -n "$GOOGLE_CLIENT_SECRET" ]; then
            log_success "Google OAuth configured"
        else
            log_warning "Incomplete Google OAuth configuration - disabling SSO"
            ENABLE_GOOGLE_SSO=false
        fi
    else
        log_info "Google OAuth SSO skipped - using standard authentication"
    fi
}

configure_advanced() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 5: Advanced Configuration (Optional)${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    if prompt_yes_no "Customize budget and model settings?" "n"; then
        TOTAL_MONTHLY_BUDGET_USD=$(prompt "Total monthly budget (USD)" "$TOTAL_MONTHLY_BUDGET_USD")
        SELF_IMPROVE_BUDGET_PCT=$(prompt "Self-improvement budget percentage" "$SELF_IMPROVE_BUDGET_PCT")
        log_success "Budget configured: \$${TOTAL_MONTHLY_BUDGET_USD}/month (${SELF_IMPROVE_BUDGET_PCT}% for self-improvement)"
    else
        log_info "Using default budget: \$${TOTAL_MONTHLY_BUDGET_USD}/month (${SELF_IMPROVE_BUDGET_PCT}% for self-improvement)"
    fi
}

review_configuration() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Step 6: Review Configuration${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    echo -e "${GREEN}Workspace:${NC}"
    echo "  Name: $WORKSPACE_NAME"
    echo

    echo -e "${GREEN}Secrets:${NC} (auto-generated, 32 characters each)"
    echo "  Postgres Password: ${POSTGRES_PASSWORD:0:8}..."
    echo "  Redis Password: ${REDIS_PASSWORD:0:8}..."
    echo "  LiteLLM Master Key: ${LITELLM_MASTER_KEY:0:8}..."
    echo "  Webhook Secret: ${WEBHOOK_SECRET:0:8}..."
    echo "  Conductor Secret: ${CONDUCTOR_SECRET:0:8}..."
    echo "  Gitea Admin Password: ${GITEA_ADMIN_PASSWORD:0:8}..."
    echo

    echo -e "${GREEN}LLM Providers:${NC}"
    for provider in "${SELECTED_PROVIDERS[@]}"; do
        echo "  ✓ $provider"
    done
    echo

    if [ "$ENABLE_GOOGLE_SSO" = true ]; then
        echo -e "${GREEN}Google OAuth SSO:${NC} Enabled"
        echo "  Client ID: ${GOOGLE_CLIENT_ID:0:20}..."
        echo
    fi

    echo -e "${GREEN}Budget:${NC}"
    echo "  Monthly: \$${TOTAL_MONTHLY_BUDGET_USD}"
    echo "  Self-Improvement: ${SELF_IMPROVE_BUDGET_PCT}%"
    echo
}

write_env_file() {
    log_info "Writing configuration to .env file..."

    cat > .env << EOF
# CueMarshal Configuration
# Generated by install.sh on $(date)

# Workspace
CONDUCTOR_ORG=$WORKSPACE_NAME
CONDUCTOR_REPO=$WORKSPACE_NAME

# Database
POSTGRES_USER=cuemarshal
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=cuemarshal
DATABASE_URL=postgresql://cuemarshal:$POSTGRES_PASSWORD@postgres:5432/cuemarshal

# Redis
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379

# Gitea
GITEA_URL=http://gitea:3000
GITEA_ADMIN_USER=cuemarshal-admin
GITEA_ADMIN_PASSWORD=$GITEA_ADMIN_PASSWORD
GITEA_ADMIN_EMAIL=admin@cuemarshal.local
GITEA_BOT_TOKEN=
GITEA_TOKEN=

# LiteLLM Gateway
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
GATEWAY_URL=http://gateway
GATEWAY_API_KEY=$LITELLM_MASTER_KEY

EOF

    # Add LLM provider keys
    for key in "${!LLM_PROVIDERS[@]}"; do
        echo "$key=${LLM_PROVIDERS[$key]}" >> .env
    done

    # Add Google OAuth if enabled
    if [ "$ENABLE_GOOGLE_SSO" = true ]; then
        cat >> .env << EOF

# Google OAuth SSO
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
EOF
    fi

    cat >> .env << EOF

# Conductor
WEBHOOK_SECRET=$WEBHOOK_SECRET
CONDUCTOR_SECRET=$CONDUCTOR_SECRET
CONDUCTOR_URL=http://conductor
API_SECRET_KEY=$CONDUCTOR_SECRET

# MCP Servers
MCP_GITEA_URL=http://mcp-gitea
MCP_CONDUCTOR_URL=http://mcp-conductor
MCP_SYSTEM_URL=http://mcp-system
MCP_VECTOR_URL=http://mcp-vector
MCP_SONAR_URL=http://mcp-sonar

# Budget
TOTAL_MONTHLY_BUDGET_USD=$TOTAL_MONTHLY_BUDGET_USD
SELF_IMPROVE_BUDGET_PCT=$SELF_IMPROVE_BUDGET_PCT

# Model Configuration
CHAT_MODEL=tier2
DECOMPOSE_MODEL=tier2
PLANNING_MODEL=gpt-4o
MODEL_SELECTOR_TIER1_THRESHOLD=0.30
MODEL_SELECTOR_TIER3_THRESHOLD=0.70

# Retry Configuration
RETRY_MAX_TOTAL=6
RETRY_MAX_TIER1=2
RETRY_MAX_TIER2=2
RETRY_MAX_TIER3=1
RETRY_BACKOFF_BASE_MS=5000
RETRY_BACKOFF_MAX_MS=60000
RETRY_COOLDOWN_MS=10000

# Self-Improvement
SELF_IMPROVE_MAX_PER_CYCLE=3
SELF_IMPROVE_COOLDOWN_HOURS=4
SELF_IMPROVE_PROTECTED_PATHS=services/conductor/,services/gateway/,services/mcp-servers/,infrastructure/
SELF_IMPROVE_FAILURE_THRESHOLD=3
SELF_IMPROVE_FAILURE_WINDOW_HOURS=24
SELF_IMPROVE_TEST_MODE=false

# Monitoring
LOG_LEVEL=info
NODE_ENV=production
GRAFANA_ADMIN_PASSWORD=admin
GRAFANA_SERVICE_TOKEN=
SONAR_TOKEN=
SONAR_ADMIN_PASSWORD=$GITEA_ADMIN_PASSWORD
SONAR_PROJECT_KEY=cuemarshal

# Runner Registration
RUNNER_REGISTRATION_TOKEN=
EOF

    log_success "Configuration written to .env"
}

launch_stack() {
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Launching CueMarshal${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    log_info "Starting services with Docker Compose..."
    docker compose up -d

    echo
    log_info "Waiting for services to become healthy..."
    
    local max_wait=180
    local elapsed=0
    
    while [ $elapsed -lt $max_wait ]; do
        if docker compose ps | grep -q "healthy"; then
            sleep 5
            if docker inspect cuemarshal-conductor | grep -q '"Status": "healthy"'; then
                log_success "Services are healthy!"
                return 0
            fi
        fi
        sleep 5
        elapsed=$((elapsed + 5))
        echo -n "."
    done

    echo
    log_warning "Services did not become healthy within ${max_wait}s"
    log_info "Check logs with: docker compose logs -f"
}

print_completion() {
    echo
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Installation Complete!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo

    echo -e "${GREEN}Access URLs:${NC}"
    echo "  Gitea:        http://localhost:3300"
    echo "  Conductor:    http://localhost:8180/api"
    echo "  Grafana:      http://localhost:8180/grafana"
    echo "  SonarQube:    http://localhost:9000"
    echo

    echo -e "${GREEN}Admin Credentials:${NC}"
    if [ "$ENABLE_GOOGLE_SSO" = true ]; then
        echo "  Gitea:        Sign in with Google"
        echo "  Grafana:      Sign in with Google"
        echo "  SonarQube:    Sign in with Google (via proxy)"
    else
        echo "  Gitea:        cuemarshal-admin / $GITEA_ADMIN_PASSWORD"
        echo "  Grafana:      admin / admin"
        echo "  SonarQube:    admin / $GITEA_ADMIN_PASSWORD"
    fi
    echo

    echo -e "${GREEN}Next Steps:${NC}"
    echo "  1. Access Gitea and create your first repository"
    echo "  2. Install the mobile app and configure it to connect to this instance"
    echo "  3. Create an issue in Gitea to trigger your first AI agent task"
    echo

    echo -e "${GREEN}Useful Commands:${NC}"
    echo "  View logs:        docker compose logs -f"
    echo "  Stop services:    docker compose down"
    echo "  Restart services: docker compose restart"
    echo

    log_info "Configuration saved in .env file"
    echo
}

#===============================================================================
# Main Installation Flow
#===============================================================================

main() {
    clear
    print_banner

    echo
    log_info "Welcome to the CueMarshal installation wizard!"
    log_info "This will guide you through setting up your self-hosted AI development platform."
    echo

    if prompt_yes_no "Ready to begin?" "y"; then
        run_preflight_checks
        configure_workspace_name
        configure_secrets
        configure_llm_providers
        configure_google_sso
        configure_advanced
        review_configuration

        echo
        if prompt_yes_no "Proceed with installation?" "y"; then
            write_env_file
            launch_stack
            print_completion
        else
            log_warning "Installation cancelled"
            exit 0
        fi
    else
        log_info "Installation cancelled"
        exit 0
    fi
}

# Check if .env already exists
if [ -f .env ]; then
    echo
    log_warning "An .env file already exists!"
    
    if prompt_yes_no "Reconfigure from scratch? (Current .env will be backed up)" "n"; then
        mv .env .env.backup.$(date +%Y%m%d_%H%M%S)
        log_info "Previous .env backed up"
    else
        log_info "Keeping existing .env - exiting"
        exit 0
    fi
fi

main
