#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Generate Self-Signed SSL Certificate for Development
# ═══════════════════════════════════════════════════════════════
# For production, replace with real certificates from Let's Encrypt
# ═══════════════════════════════════════════════════════════════

echo "Generating self-signed SSL certificate..."

CERT_DIR="./infrastructure/nginx/certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -subj "/C=US/ST=State/L=City/O=CueMarshal/OU=Dev/CN=localhost"

echo "✓ Self-signed certificate generated"
echo ""
echo "Certificate: $CERT_DIR/cert.pem"
echo "Key: $CERT_DIR/key.pem"
echo ""
echo "Note: This is for development only. Use Let's Encrypt for production."
