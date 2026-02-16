# Gateway Fallback Verification Guide

## Quick Verification

Run the automated verification script:

```bash
bash scripts/verify-gateway-config.sh
```

Expected output:

```
✅ routing_strategy: simple-shuffle (CORRECT)
✅ num_retries: 2 (CORRECT)
✅ timeout: 120 seconds (CORRECT)
✅ enable_pre_call_checks: true (CORRECT)
✅ fallback_on_status_codes includes 429
✅ Gateway fallback configuration is CORRECT!
```

## Comprehensive Integration Tests

```bash
python3 scripts/test-fallback-integration.py
```

## Verification Checklist

### 1. Gateway Health

```bash
docker ps --filter "name=cuemarshal-gateway" --format "{{.Status}}"
```

Expected: `Up X seconds (healthy)`

### 2. Configuration Settings

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep -A 20 "router_settings:"
```

Verify:

- `routing_strategy: "simple-shuffle"` ✓
- `num_retries: 2` ✓
- `timeout: 120` ✓
- `enable_pre_call_checks: true` ✓

### 3. Provider Order

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep -A 15 'model_name: "tier1"' | grep -E "(model:|order:)" | head -9
```

Expected:

```
      model: "groq/meta-llama/llama-4-scout-17b-16e-instruct"
      order: 1
      model: "gemini/gemini-2.0-flash"
      order: 2
      model: "azure_ai/kimi-k2.5"
      order: 3
```

### 4. Fallback Status Codes

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep "fallback_on_status_codes"
```

Expected: `fallback_on_status_codes: [429, 500, 502, 503, 504]`

### 5. API Keys Present

```bash
docker exec cuemarshal-gateway env | grep -E "(GROQ|GEMINI|AZURE)_API_KEY=" | wc -l
```

Expected: 3 (one for each provider)

## Monitoring Provider Selection

### Real-Time Logs

```bash
docker logs -f cuemarshal-gateway 2>&1 | grep -i -E '(groq|gemini|azure|tier1|routing|fallback)'
```

### Provider Usage Statistics

```bash
# Count requests per provider
echo "Groq:   $(docker logs cuemarshal-gateway | grep -i groq | wc -l)"
echo "Gemini: $(docker logs cuemarshal-gateway | grep -i gemini | wc -l)"
echo "Azure:  $(docker logs cuemarshal-gateway | grep -i azure | wc -l)"
```

### Check for Fallback Events

```bash
docker logs cuemarshal-gateway | grep -i "fallback\|retry\|cooldown"
```

## Testing Fallback Behavior

### Simulate Workflow Request

```bash
bash scripts/simulate-workflow-request.sh
```

This monitors gateway logs while demonstrating expected request flow.

### Manual Test Request

From inside the conductor container:

```bash
docker exec cuemarshal-conductor curl -X POST http://gateway:4100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${GATEWAY_API_KEY}" \
  -d '{
    "model": "tier1",
    "messages": [{"role": "user", "content": "Test"}],
    "max_tokens": 10
  }'
```

## Expected Indicators

### Healthy System

- ✅ Groq is primary provider (order: 1)
- ✅ Gemini used occasionally when Groq rate-limited
- ✅ Azure rarely used (only when both Groq and Gemini fail)
- ✅ No persistent errors in logs

### Warning Signs

- ⚠️ All requests using Gemini → Groq may be down
- ⚠️ Frequent Azure usage → Both Groq and Gemini failing
- ⚠️ 429 errors not triggering fallback → Config issue
- ⚠️ Timeouts on all providers → Network/connectivity issue

## Troubleshooting

### Fallback Not Working

**Symptom**: Requests fail with 429 or 500 errors instead of trying next provider.

**Check 1**: Verify routing strategy

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep "routing_strategy"
```

Should be `"simple-shuffle"`, not `"cost-based-routing"`.

**Check 2**: Verify pre-call checks enabled

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep "enable_pre_call_checks"
```

Should be `true`.

**Check 3**: Verify fallback status codes

```bash
docker exec cuemarshal-gateway cat /app/config.yaml | grep "fallback_on_status_codes"
```

Should include `429`.

**Check 4**: Check gateway logs for errors

```bash
docker logs cuemarshal-gateway --tail 50 | grep -i error
```

### Wrong Provider Selected

**Symptom**: Gateway always uses Gemini instead of Groq.

**Cause**: Likely using `cost-based-routing` instead of `simple-shuffle`.

**Fix**: Update `routing_strategy` to `"simple-shuffle"` and restart gateway.

### Retries Exhausted Before Trying All Providers

**Symptom**: Only 2 of 3 providers tried before failure.

**Cause**: `num_retries` too low (should be 2 for 3 providers).

**Fix**: Set `num_retries: 2` and restart gateway.

## Applying Configuration Changes

1. Edit `services/gateway/litellm_config.yaml`
2. Restart gateway: `docker restart cuemarshal-gateway`
3. Wait for healthy: `sleep 10 && docker ps | grep gateway`
4. Verify config: `bash scripts/verify-gateway-config.sh`

No rebuild required - configuration is volume-mounted.

## Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/verify-gateway-config.sh` | Verify all configuration settings |
| `scripts/test-fallback-integration.py` | Automated integration tests |
| `scripts/simulate-workflow-request.sh` | Simulate workflow request flow |

## Verification Status

Last verified: 2026-02-22

- ✅ Configuration correct in running container
- ✅ All automated tests passing
- ✅ Provider order confirmed
- ✅ Fallback triggers verified
- ✅ Gateway healthy and operational

## References

- Configuration file: `services/gateway/litellm_config.yaml`
- Gateway overview: `docs/features/gateway/overview.md`
- LiteLLM documentation: <https://docs.litellm.ai/docs/routing>
