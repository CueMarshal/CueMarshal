FROM ghcr.io/berriai/litellm:main-latest

# Install additional dependencies if needed
RUN pip install --no-cache-dir psycopg2-binary redis httpx

# Copy configuration files
COPY litellm_config.yaml /app/config.yaml
COPY custom_callbacks.py /app/custom_callbacks.py

# Set working directory
WORKDIR /app

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

# Start LiteLLM proxy
CMD ["--config", "/app/config.yaml", "--port", "80", "--num_workers", "4", "--detailed_debug"]
