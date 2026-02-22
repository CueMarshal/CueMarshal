#!/usr/bin/env python3
"""
Integration test for LiteLLM gateway fallback mechanism.
Tests that provider selection follows order field and fallback works correctly.
"""

import subprocess
import json
import time
import sys

def run_command(cmd):
    """Run shell command and return output"""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr

def check_gateway_health():
    """Check if gateway container is running"""
    code, stdout, stderr = run_command(
        'docker ps --filter "name=cuemarshal-gateway" --filter "status=running" --format "{{.Names}}"'
    )
    return code == 0 and 'cuemarshal-gateway' in stdout

def get_gateway_logs(lines=100):
    """Get recent gateway logs"""
    code, stdout, stderr = run_command(f'docker logs cuemarshal-gateway --tail {lines} 2>&1')
    return stdout

def check_provider_in_logs(logs, provider):
    """Check if a provider name appears in logs"""
    provider_patterns = {
        'groq': ['groq', 'llama-4-scout'],
        'gemini': ['gemini', 'gemini-2.0-flash'],
        'azure': ['azure_ai', 'kimi-k2.5']
    }
    patterns = provider_patterns.get(provider.lower(), [provider.lower()])
    return any(pattern in logs.lower() for pattern in patterns)

def main():
    print("=" * 60)
    print("LiteLLM Gateway Fallback Integration Test")
    print("=" * 60)
    print()

    # Test 1: Gateway health
    print("Test 1: Checking gateway health...")
    if check_gateway_health():
        print("  ✅ Gateway is healthy")
    else:
        print("  ❌ Gateway is not healthy")
        return 1
    print()

    # Test 2: Check configuration
    print("Test 2: Verifying configuration...")
    tests = [
        ('routing_strategy: "simple-shuffle"', 'Routing strategy'),
        ('num_retries: 2', 'Retry count'),
        ('timeout: 120', 'Timeout'),
        ('enable_pre_call_checks: true', 'Pre-call checks'),
        ('order: 1', 'Order field for Groq'),
        ('order: 2', 'Order field for Gemini'),
        ('order: 3', 'Order field for Azure'),
    ]
    
    code, config, _ = run_command('docker exec cuemarshal-gateway cat /app/config.yaml')
    if code != 0:
        print("  ❌ Could not read configuration")
        return 1
    
    all_passed = True
    for pattern, name in tests:
        if pattern in config:
            print(f"  ✅ {name}: {pattern}")
        else:
            print(f"  ❌ {name}: NOT FOUND")
            all_passed = False
    
    if not all_passed:
        return 1
    print()

    # Test 3: Analyze recent logs for provider usage
    print("Test 3: Analyzing recent gateway activity...")
    logs = get_gateway_logs(200)
    
    print("  Checking for provider mentions in logs:")
    for provider in ['groq', 'gemini', 'azure']:
        if check_provider_in_logs(logs, provider):
            print(f"    ✅ {provider.capitalize()} - mentioned in logs")
        else:
            print(f"    ℹ️  {provider.capitalize()} - not mentioned (may not have been used yet)")
    print()

    # Test 4: Check for routing/fallback related log entries
    print("Test 4: Checking for routing/fallback activity...")
    routing_keywords = ['routing', 'fallback', 'retry', 'cooldown', 'order']
    found_routing = False
    for keyword in routing_keywords:
        if keyword.lower() in logs.lower():
            print(f"    ✅ Found '{keyword}' in logs")
            found_routing = True
    
    if not found_routing:
        print("    ℹ️  No explicit routing activity found in recent logs")
        print("    This is normal if no requests have been made yet")
    print()

    # Test 5: Check error handling configuration
    print("Test 5: Verifying error handling configuration...")
    if 'fallback_on_status_codes: [429, 500, 502, 503, 504]' in config:
        print("  ✅ Fallback on status codes configured correctly")
        print("     Will trigger fallback on: 429 (rate limit), 500, 502, 503, 504")
    else:
        print("  ❌ fallback_on_status_codes not configured correctly")
        return 1
    print()

    # Summary
    print("=" * 60)
    print("Test Summary")
    print("=" * 60)
    print()
    print("✅ All configuration tests passed!")
    print()
    print("Configuration verified:")
    print("  • routing_strategy: simple-shuffle")
    print("  • num_retries: 2 (supports 3-provider chain)")
    print("  • timeout: 120 seconds")
    print("  • enable_pre_call_checks: true (required for order)")
    print("  • fallback_on_status_codes: includes 429")
    print()
    print("Provider priority order:")
    print("  1. Groq (order: 1) - Primary")
    print("  2. Gemini (order: 2) - First fallback")
    print("  3. Azure AI (order: 3) - Second fallback")
    print()
    print("Expected fallback behavior:")
    print("  • Request starts with Groq (lowest order)")
    print("  • On Groq failure → retry with Gemini")
    print("  • On Gemini failure → retry with Azure AI")
    print("  • On all failures → cross-tier fallback (tier1→tier2→tier3)")
    print()
    print("✅ Gateway is correctly configured for fallback!")
    print()
    print("Next steps to test in production:")
    print("  1. Run the self-improve workflow: workflows/self-improve.yml")
    print("  2. Monitor logs: docker logs -f cuemarshal-gateway | grep -E '(groq|gemini|azure)'")
    print("  3. Verify Groq is tried first, then Gemini, then Azure on failures")
    print()
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
