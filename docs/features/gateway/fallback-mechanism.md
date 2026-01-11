# Gateway Fallback Mechanism

## Overview

The LiteLLM gateway implements a multi-tier fallback mechanism to ensure high availability and resilience against provider failures. The system uses priority-based routing with automatic fallback across three providers per tier.

## Provider Priority Order

All model tiers (tier1, tier2, tier3) follow the same provider priority:

| Priority | Provider | Model | Order | Role |
|----------|----------|-------|-------|------|
| 1 (Primary) | Groq | `groq/meta-llama/llama-4-scout-17b-16e-instruct` | 1 | Always tried first |
| 2 (First Fallback) | Gemini | `gemini/gemini-2.0-flash` | 2 | Used if Groq fails |
| 3 (Second Fallback) | Azure AI | `azure_ai/kimi-k2.5` (tier1) or `azure_ai/gpt-5.2-chat` (tier2/3) | 3 | Used if Gemini fails |

## Configuration

### Router Settings

Located in `services/gateway/litellm_config.yaml`:

```yaml
router_settings:
  routing_strategy: "simple-shuffle"
  enable_pre_call_checks: true  # REQUIRED for order field
  num_retries: 2                # Allows full 3-provider chain
  timeout: 120                  # Seconds per provider attempt
  retry_after: 5                # Seconds before retry
  cooldown_time: 60             # Seconds to cool down failed provider
  fallback_on_status_codes: [429, 500, 502, 503, 504]
```

### Key Settings Explained

**routing_strategy: "simple-shuffle"**
- Default and recommended by LiteLLM
- When combined with `enable_pre_call_checks: true`, it respects the `order` field
- Randomly picks among deployments with the same order value
- **Do NOT use `cost-based-routing`** - it ignores the order field

**enable_pre_call_checks: true**
- **REQUIRED** for the `order` field to work
- Pre-call checks filter deployments to lowest available order before routing
- Without this, provider priority is ignored

**num_retries: 2**
- With 3 providers per tier: initial attempt + 2 retries = 3 total attempts
- Ensures the full provider chain can be traversed
- Each retry tries the next provider by order

**timeout: 120**
- Maximum seconds to wait for each provider attempt
- Prevents hanging providers from consuming entire workflow timeout
- Workflow timeout is 30 minutes (1800s), giving time for multiple retries

**fallback_on_status_codes**
- Automatic fallback triggered on these HTTP status codes
- `429` - Rate limit exceeded (critical for free tier APIs)
- `500, 502, 503, 504` - Server errors

## Fallback Flow

### Normal Request (Success)

```
Request for tier1
  ↓
Pre-call check filters to order: 1
  ↓
Try Groq (order: 1)
  ↓
✅ Success → Return response
```

### Single Provider Failure

```
Request for tier1
  ↓
Pre-call check filters to order: 1
  ↓
Try Groq (order: 1) → FAIL (429, 500, timeout)
  ↓
Cooldown Groq for 60 seconds
  ↓
Retry 1: Pre-call check filters to order: 2
  ↓
Try Gemini (order: 2)
  ↓
✅ Success → Return response
```

### Two Provider Failures

```
Request for tier1
  ↓
Try Groq (order: 1) → FAIL
  ↓
Retry 1: Try Gemini (order: 2) → FAIL
  ↓
Retry 2: Try Azure AI (order: 3)
  ↓
✅ Success → Return response
```

### All Providers Fail (Cross-Tier Fallback)

```
Request for tier1
  ↓
Try all tier1 providers (Groq, Gemini, Azure) → ALL FAIL
  ↓
Cross-tier fallback to tier2
  ↓
Try all tier2 providers → Repeat process
  ↓
If tier2 fails → Fallback to tier3
  ↓
If tier3 fails → Return error to client
```

## Cooldown Behavior

When a provider fails with specific errors, it's automatically cooled down:

| Condition | Trigger | Cooldown Duration |
|-----------|---------|-------------------|
| Rate Limiting (429) | Immediate on 429 response | 60 seconds |
| Server Errors (500+) | Immediate on 500, 502, 503, 504 | 60 seconds |
| Timeout | After 120 seconds | 60 seconds |
| Authentication (401) | Immediate on 401 | 60 seconds |

During cooldown:
- The specific deployment is removed from the available pool
- Other healthy deployments continue serving requests
- After cooldown expires, the deployment is automatically re-enabled

## Critical Configuration Issues (Resolved)

### Issue 1: cost-based-routing Ignores order Field

**Problem**: Using `routing_strategy: "cost-based-routing"` caused the gateway to select providers by cheapest known cost from LiteLLM's pricing database, completely ignoring the `order` field.

**Symptom**: Gemini was always selected over Groq, even though Groq had `order: 1`.

**Root Cause**: When pricing data is missing for a model (like `groq/meta-llama/llama-4-scout-17b-16e-instruct`), cost-based routing defaults to the cheapest known alternative (Gemini).

**Resolution**: Changed to `simple-shuffle` routing strategy, which respects the `order` field when `enable_pre_call_checks: true`.

### Issue 2: Insufficient Retries

**Problem**: `num_retries: 1` only allowed 1 fallback hop (2 providers total), preventing Azure (3rd provider) from being reached.

**Symptom**: When both Groq and Gemini failed, workflow terminated with error instead of trying Azure.

**Root Cause**: With 3 providers, need initial attempt + 2 retries = 3 total attempts.

**Resolution**: Increased `num_retries` from 1 to 2.

### Issue 3: No Timeout Protection

**Problem**: No explicit timeout allowed hanging providers to consume entire workflow timeout.

**Resolution**: Added `timeout: 120` seconds per provider attempt.

## Verification

### Configuration Verification

Use the automated verification script:

```bash
bash scripts/verify-gateway-config.sh
```

Expected output:
```
✅ routing_strategy: simple-shuffle
✅ num_retries: 2
✅ timeout: 120
✅ enable_pre_call_checks: true
✅ Provider order: Groq(1) → Gemini(2) → Azure(3)
```

### Integration Testing

Run comprehensive tests:

```bash
python3 scripts/test-fallback-integration.py
```

### Real-Time Monitoring

Monitor provider selection in production:

```bash
docker logs -f cuemarshal-gateway 2>&1 | grep -i -E '(groq|gemini|azure|tier1|routing)'
```

### Check Provider Usage

```bash
# Count how many times each provider was used
docker logs cuemarshal-gateway | grep -c "groq"
docker logs cuemarshal-gateway | grep -c "gemini"
docker logs cuemarshal-gateway | grep -c "azure"
```

## Expected Behavior

### Healthy Operation
- Most requests use **Groq** (order: 1)
- Occasional **Gemini** usage is normal (if Groq is rate-limited)
- **Azure** only used if both Groq and Gemini fail

### Warning Signs
- All requests using Gemini → Groq may be down or API key invalid
- Frequent Azure usage → Both Groq and Gemini having issues
- Check provider status pages and API keys

## Provider Status Pages

- Groq: https://status.groq.com/
- Gemini: https://status.cloud.google.com/
- Azure: https://status.azure.com/

## Troubleshooting

### Gateway Not Falling Back

1. Check routing strategy:
   ```bash
   docker exec cuemarshal-gateway cat /app/config.yaml | grep "routing_strategy"
   ```
   Should be: `routing_strategy: "simple-shuffle"`

2. Check pre-call checks enabled:
   ```bash
   docker exec cuemarshal-gateway cat /app/config.yaml | grep "enable_pre_call_checks"
   ```
   Should be: `enable_pre_call_checks: true`

3. Check provider order configuration:
   ```bash
   docker exec cuemarshal-gateway cat /app/config.yaml | grep -A 15 'model_name: "tier1"' | grep -E "(model:|order:)"
   ```
   Should show: order: 1, 2, 3

4. Verify API keys are set:
   ```bash
   docker exec cuemarshal-gateway env | grep -E "(GROQ|GEMINI|AZURE)_API_KEY"
   ```

5. Check recent errors:
   ```bash
   docker logs cuemarshal-gateway --tail 100 | grep -i error
   ```

### Applying Configuration Changes

After editing `services/gateway/litellm_config.yaml`:

```bash
# Restart gateway to reload configuration
docker restart cuemarshal-gateway

# Wait for healthy status
sleep 10

# Verify configuration loaded
docker exec cuemarshal-gateway cat /app/config.yaml | grep "routing_strategy"
```

The configuration file is volume-mounted read-only, so changes take effect immediately on restart without rebuilding the image.

## Impact on Workflows

### self-improve.yml

The workflow uses:
```yaml
--model "litellm/tier1"
```

With the corrected configuration:
- Requests now correctly try Groq first (order: 1)
- Falls back to Gemini if Groq fails (order: 2)
- Falls back to Azure AI if Gemini fails (order: 3)
- Workflow is resilient to provider rate limits and outages

### All Workflows

Any workflow using `tier1`, `tier2`, or `tier3` models benefits from the same fallback mechanism.

## References

- Configuration: `services/gateway/litellm_config.yaml`
- LiteLLM Routing Docs: https://docs.litellm.ai/docs/routing
- LiteLLM Load Balancing: https://docs.litellm.ai/docs/proxy/load_balancing
