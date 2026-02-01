# ═══════════════════════════════════════════
# Stage 1: Build MCP servers
# ═══════════════════════════════════════════
FROM node:25-alpine AS mcp-builder

WORKDIR /build

# Copy MCP servers source
COPY mcp-servers/package.json mcp-servers/tsconfig.json ./
COPY mcp-servers/shared ./shared
COPY mcp-servers/gitea-mcp ./gitea-mcp
COPY mcp-servers/conductor-mcp ./conductor-mcp
COPY mcp-servers/system-mcp ./system-mcp

# Build all MCP servers
RUN npm install && npm run build -w shared && npm run build

# ═══════════════════════════════════════════
# Stage 2: Runner image
# ═══════════════════════════════════════════
FROM gitea/act_runner:latest

# Switch to root for installation
USER root

# Install system dependencies (Alpine)
RUN apk add --no-cache \
    curl \
    git \
    jq \
    ca-certificates \
    gnupg \
    wget \
    bash \
    ripgrep \
    nodejs \
    npm \
    openjdk17-jre-headless \
    unzip

# Install SonarQube Scanner CLI
ARG SONAR_SCANNER_VERSION=8.0.1.6346
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      SONAR_ARCH="linux-aarch64"; \
    else \
      SONAR_ARCH="linux-x64"; \
    fi && \
    curl -fsSL "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}-${SONAR_ARCH}.zip" \
      -o /tmp/sonar-scanner.zip && \
    unzip /tmp/sonar-scanner.zip -d /opt/ && \
    ln -s /opt/sonar-scanner-*/bin/sonar-scanner /usr/local/bin/sonar-scanner && \
    rm /tmp/sonar-scanner.zip && \
    rm -rf /opt/sonar-scanner-*/jre && \
    ln -s /usr/lib/jvm/java-17-openjdk /opt/sonar-scanner-${SONAR_SCANNER_VERSION}-${SONAR_ARCH}/jre

# Install OpenCode CLI v1.1.53 from GitHub releases
# v1.1.53 is a TypeScript/Bun rewrite with proper non-interactive support via `opencode run`
ARG OPENCODE_VERSION=v1.1.53
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      OPENCODE_TARGET="linux-arm64-musl"; \
    else \
      OPENCODE_TARGET="linux-x64-musl"; \
    fi && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/download/${OPENCODE_VERSION}/opencode-${OPENCODE_TARGET}.tar.gz" \
      -o /tmp/opencode.tar.gz && \
    tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ && \
    chmod +x /usr/local/bin/opencode && \
    rm -f /tmp/opencode.tar.gz && \
    opencode --version

# Copy MCP server builds from builder stage
COPY --from=mcp-builder /build/gitea-mcp/dist /mcp-servers/gitea-mcp/dist
COPY --from=mcp-builder /build/conductor-mcp/dist /mcp-servers/conductor-mcp/dist
COPY --from=mcp-builder /build/system-mcp/dist /mcp-servers/system-mcp/dist
COPY --from=mcp-builder /build/shared/package.json /mcp-servers/shared/package.json
COPY --from=mcp-builder /build/shared/dist /mcp-servers/shared/dist
COPY --from=mcp-builder /build/node_modules /mcp-servers/node_modules

# Copy agent profiles
COPY agents/shared /agents/shared
COPY agents/architect /agents/architect
COPY agents/developer /agents/developer
COPY agents/reviewer /agents/reviewer
COPY agents/tester /agents/tester
COPY agents/devops /agents/devops
COPY agents/docs /agents/docs
COPY agents/linter /agents/linter

# Copy runner config, gateway proxy, and entrypoint
COPY runner/config.yaml /config.yaml
COPY runner/gateway-proxy.js /gateway-proxy.js
COPY runner/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Set environment defaults
ENV GITEA_URL=""
ENV GITEA_TOKEN=""
ENV CONDUCTOR_URL=""
ENV OPENAI_API_KEY=""
ENV LOCAL_ENDPOINT=""
ENV HOME=/data

# Create data directory
RUN mkdir -p /data && chown -R 1000:1000 /data /mcp-servers /agents

# Switch back to non-root user
USER 1000:1000

WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
