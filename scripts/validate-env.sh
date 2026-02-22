#!/usr/bin/env bash
#
# Validate environment variable configuration completeness
# 
# This script ensures that:
# 1. All variables parsed by conductor/src/config.ts exist in .env.example
# 2. All variables in .env.example are documented
# 3. No placeholder values remain in production .env (if .env exists)
# 4. Critical variable combinations are correct (REDIS_URL auth, DB references, etc.)
#
# Usage:
#   ./scripts/validate-env.sh           # Validate .env.example only
#   ./scripts/validate-env.sh --prod    # Also validate .env for production readiness
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0

# Script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "═══════════════════════════════════════════════════════════════"
echo "Environment Configuration Validation"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════════
# 1. Extract variable names from conductor/src/config.ts
# ═══════════════════════════════════════════════════════════════════

echo "📋 Extracting required variables from conductor/src/config.ts..."

CONFIG_FILE="${PROJECT_ROOT}/conductor/src/config.ts"
ENV_EXAMPLE_FILE="${PROJECT_ROOT}/.env.example"
ENV_FILE="${PROJECT_ROOT}/.env"

if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}✗ Error: conductor/src/config.ts not found${NC}"
    exit 1
fi

if [ ! -f "$ENV_EXAMPLE_FILE" ]; then
    echo -e "${RED}✗ Error: .env.example not found${NC}"
    exit 1
fi

# Extract environment variable names from config.ts
# Looks for: process.env.VARIABLE_NAME
REQUIRED_VARS=$(grep -oE 'process\.env\.[A-Z0-9_]+' "$CONFIG_FILE" | sed 's/process\.env\.//' | sort -u)

if [ -z "$REQUIRED_VARS" ]; then
    echo -e "${RED}✗ Error: Could not extract variables from config.ts${NC}"
    exit 1
fi

VAR_COUNT=$(echo "$REQUIRED_VARS" | wc -l)
echo -e "${GREEN}✓ Found $VAR_COUNT required variables${NC}"
echo ""

# ═══════════════════════════════════════════════════════════════════
# 2. Check .env.example completeness
# ═══════════════════════════════════════════════════════════════════

echo "🔍 Checking .env.example completeness..."
echo ""

MISSING_VARS=()

for VAR in $REQUIRED_VARS; do
    # Check if variable exists in .env.example (as a key, not just mentioned in comments)
    if ! grep -qE "^${VAR}=" "$ENV_EXAMPLE_FILE"; then
        MISSING_VARS+=("$VAR")
        echo -e "${RED}✗ Missing: $VAR${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All required variables are documented in .env.example${NC}"
else
    echo ""
    echo -e "${RED}Found ${#MISSING_VARS[@]} missing variable(s) in .env.example${NC}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# 3. Check for undocumented variables in .env.example
# ═══════════════════════════════════════════════════════════════════

echo "📝 Checking for undocumented variables in .env.example..."
echo ""

# Extract all variable names from .env.example (lines starting with WORD=)
ENV_EXAMPLE_VARS=$(grep -E '^[A-Z_]+=.*' "$ENV_EXAMPLE_FILE" | sed 's/=.*//' | sort -u)

UNDOCUMENTED_VARS=()

for VAR in $ENV_EXAMPLE_VARS; do
    # Skip variables that are aliases (e.g., GATEWAY_API_KEY=${LITELLM_MASTER_KEY})
    if grep -qE "^${VAR}=\\\$\{" "$ENV_EXAMPLE_FILE"; then
        continue
    fi
    
    # Check if variable is used in config.ts
    if ! echo "$REQUIRED_VARS" | grep -qw "$VAR"; then
        # Check if it's used in docker-compose.yml (might be used by other services)
        if ! grep -qE "\\\$\{${VAR}[:\}]" "${PROJECT_ROOT}/docker-compose.yml" 2>/dev/null; then
            UNDOCUMENTED_VARS+=("$VAR")
            echo -e "${YELLOW}⚠ Unused: $VAR (not in config.ts or docker-compose.yml)${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
done

if [ ${#UNDOCUMENTED_VARS[@]} -eq 0 ]; then
    echo -e "${GREEN}✓ All .env.example variables are used${NC}"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════
# 4. Validate .env if --prod flag is passed
# ═══════════════════════════════════════════════════════════════════

if [ "${1:-}" = "--prod" ]; then
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}⚠ Warning: .env file not found (skipping production validation)${NC}"
        echo ""
    else
        echo "🔒 Validating .env for production readiness..."
        echo ""
        
        # Check for placeholder values
        PLACEHOLDER_PATTERNS=(
            "CHANGE_ME"
            "xxxxxxxx"
            "sk-litellm-master-xxxxxxxx"
            "sk-ant-api03-\.\.\."
            "sk-\.\.\."
            "gsk_\.\.\."
            "AIzaSy\.\.\."
        )
        
        for PATTERN in "${PLACEHOLDER_PATTERNS[@]}"; do
            if grep -qE "$PATTERN" "$ENV_FILE"; then
                echo -e "${RED}✗ Placeholder value found: $PATTERN${NC}"
                grep -n "$PATTERN" "$ENV_FILE" | while read -r LINE; do
                    echo -e "  Line $LINE"
                done
                ERRORS=$((ERRORS + 1))
            fi
        done
        
        # Check REDIS_URL auth format
        if grep -qE "^REDIS_PASSWORD=.+" "$ENV_FILE"; then
            REDIS_PASSWORD=$(grep -E "^REDIS_PASSWORD=" "$ENV_FILE" | sed 's/REDIS_PASSWORD=//')
            if [ -n "$REDIS_PASSWORD" ]; then
                # REDIS_URL should include password
                if ! grep -qE "^REDIS_URL=redis://:.+@" "$ENV_FILE"; then
                    echo -e "${RED}✗ REDIS_URL must include password in format: redis://:PASSWORD@HOST:PORT${NC}"
                    echo -e "  Found: $(grep '^REDIS_URL=' "$ENV_FILE")"
                    ERRORS=$((ERRORS + 1))
                fi
            fi
        fi
        
        # Check DATABASE_URL references 'cuemarshal' database
        if grep -qE "^DATABASE_URL=.*postgres.*" "$ENV_FILE"; then
            if ! grep -qE "^DATABASE_URL=.*postgres.*/cuemarshal(\?|$)" "$ENV_FILE"; then
                echo -e "${YELLOW}⚠ DATABASE_URL should reference 'cuemarshal' database (not gitea or litellm)${NC}"
                echo -e "  Found: $(grep '^DATABASE_URL=' "$ENV_FILE")"
                WARNINGS=$((WARNINGS + 1))
            fi
        fi
        
        # Check GATEWAY_API_KEY is not empty and not default
        if grep -qE "^GATEWAY_API_KEY=\s*$" "$ENV_FILE"; then
            echo -e "${RED}✗ GATEWAY_API_KEY must be set${NC}"
            ERRORS=$((ERRORS + 1))
        fi
        
        # Check WEBHOOK_SECRET length (should be at least 32 chars)
        WEBHOOK_SECRET=$(grep -E "^WEBHOOK_SECRET=" "$ENV_FILE" | sed 's/WEBHOOK_SECRET=//' || echo "")
        if [ ${#WEBHOOK_SECRET} -lt 32 ]; then
            echo -e "${RED}✗ WEBHOOK_SECRET must be at least 32 characters${NC}"
            echo -e "  Current length: ${#WEBHOOK_SECRET}"
            ERRORS=$((ERRORS + 1))
        fi
        
        # Check CONDUCTOR_SECRET length (should be at least 32 chars)
        CONDUCTOR_SECRET=$(grep -E "^CONDUCTOR_SECRET=" "$ENV_FILE" | sed 's/CONDUCTOR_SECRET=//' || echo "")
        if [ ${#CONDUCTOR_SECRET} -lt 32 ]; then
            echo -e "${RED}✗ CONDUCTOR_SECRET must be at least 32 characters${NC}"
            echo -e "  Current length: ${#CONDUCTOR_SECRET}"
            ERRORS=$((ERRORS + 1))
        fi
        
        # Check model tier values
        CHAT_MODEL=$(grep -E "^CHAT_MODEL=" "$ENV_FILE" | sed 's/CHAT_MODEL=//' || echo "tier2")
        if [[ ! "$CHAT_MODEL" =~ ^(tier1|tier2|tier3)$ ]]; then
            echo -e "${RED}✗ CHAT_MODEL must be one of: tier1, tier2, tier3${NC}"
            echo -e "  Found: $CHAT_MODEL"
            ERRORS=$((ERRORS + 1))
        fi
        
        DECOMPOSE_MODEL=$(grep -E "^DECOMPOSE_MODEL=" "$ENV_FILE" | sed 's/DECOMPOSE_MODEL=//' || echo "tier2")
        if [[ ! "$DECOMPOSE_MODEL" =~ ^(tier1|tier2|tier3)$ ]]; then
            echo -e "${RED}✗ DECOMPOSE_MODEL must be one of: tier1, tier2, tier3${NC}"
            echo -e "  Found: $DECOMPOSE_MODEL"
            ERRORS=$((ERRORS + 1))
        fi
        
        # Check at least one LLM provider key is set
        HAS_GROQ=$(grep -qE "^GROQ_API_KEY=.+" "$ENV_FILE" && echo "yes" || echo "no")
        HAS_AZURE=$(grep -qE "^AZURE_AI_API_KEY=.+" "$ENV_FILE" && echo "yes" || echo "no")
        HAS_GEMINI=$(grep -qE "^GEMINI_API_KEY=.+" "$ENV_FILE" && echo "yes" || echo "no")
        
        if [ "$HAS_GROQ" = "no" ] && [ "$HAS_AZURE" = "no" ] && [ "$HAS_GEMINI" = "no" ]; then
            echo -e "${RED}✗ At least one LLM provider API key must be set (GROQ, AZURE_AI, or GEMINI)${NC}"
            ERRORS=$((ERRORS + 1))
        else
            echo -e "${GREEN}✓ LLM provider credentials configured${NC}"
            [ "$HAS_GROQ" = "yes" ] && echo -e "  ✓ Groq API key set"
            [ "$HAS_AZURE" = "yes" ] && echo -e "  ✓ Azure AI API key set"
            [ "$HAS_GEMINI" = "yes" ] && echo -e "  ✓ Gemini API key set"
        fi
        
        echo ""
    fi
fi

# ═══════════════════════════════════════════════════════════════════
# 5. Summary
# ═══════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════"
echo "Validation Summary"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    exit 0
else
    echo -e "${YELLOW}Errors: $ERRORS${NC}"
    echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
    echo ""
    
    if [ $ERRORS -gt 0 ]; then
        echo "Please fix the errors above before deploying to production."
        echo ""
        exit 1
    else
        echo "Warnings detected but not critical. Review them before deployment."
        echo ""
        exit 0
    fi
fi
