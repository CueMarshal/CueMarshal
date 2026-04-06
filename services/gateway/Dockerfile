FROM ghcr.io/berriai/litellm:main-latest

# Install additional dependencies if needed
RUN pip install --no-cache-dir psycopg2-binary redis httpx

# Copy configuration files
COPY litellm_config.yaml /app/config.yaml
COPY custom_callbacks.py /app/custom_callbacks.py
COPY render_litellm_config.py /app/render_litellm_config.py

# Set working directory
WORKDIR /app

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

# Render config from environment, then start LiteLLM proxy
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["python3 /app/render_litellm_config.py /app/config.yaml /tmp/litellm_config.yaml && exec litellm --config /tmp/litellm_config.yaml --port 80 --num_workers 4 --detailed_debug"]
