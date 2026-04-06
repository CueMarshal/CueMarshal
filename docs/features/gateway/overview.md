# LLM Gateway

## Overview

The LLM Gateway is an OpenAI-compatible API proxy built on LiteLLM. It provides a single endpoint for all LLM requests from both the Conductor and OpenCode agents running in Gitea runners. The gateway handles provider routing, tiered model selection, automatic fallback on rate limits, retry logic, and cost tracking.

## Technology Stack

- **Core**: LiteLLM Proxy Server (Python)
- **API Format**: OpenAI-compatible (`/v1/chat/completions`, `/v1/embeddings`)
- **Database**: PostgreSQL (shared, for cost tracking)
- **Cache**: Redis (response caching, rate limit state)

## Configuration

### litellm_config.yaml

This is the primary configuration file for the gateway.

**Current implementation** (optimized for free-tier operation with 3-provider fallback):

```yaml
model_list:
  # ═══════════════════════════════════════════════════════
  # Tier 1: Simple tasks (formatting, docs, typos, labels)
  # Primary: Groq (free, fast) → Gemini (free) → Azure AI Kimi (20K limit)
  # ═══════════════════════════════════════════════════════
  - model_name: "tier1"
    litellm_params:
      model: "groq/meta-llama/llama-4-scout-17b-16e-instruct"
      api_key: "os.environ/GROQ_API_KEY"
      order: 1  # Primary
    model_info:
      max_tokens: 8192
      supports_function_calling: true

  - model_name: "tier1"
    litellm_params:
      model: "gemini/gemini-2.0-flash"
      api_key: "os.environ/GEMINI_API_KEY"
      order: 2  # First fallback
    model_info:
      max_tokens: 8192
      supports_function_calling: true

  - model_name: "tier1"
    litellm_params:
      model: "azure_ai/kimi-k2.5"
      api_key: "os.environ/AZURE_AI_API_KEY"
      api_base: "os.environ/AZURE_AI_API_BASE"
      order: 3  # Second fallback
    model_info:
      max_tokens: 8192
      supports_function_calling: true

  # ═══════════════════════════════════════════════════════
  # Tier 2: Standard tasks (features, bugs, reviews, tests)
  # Primary: Groq → Gemini → Azure AI GPT-5.2 (50K limit)
  # ═══════════════════════════════════════════════════════
  - model_name: "tier2"
    litellm_params:
      model: "groq/meta-llama/llama-4-scout-17b-16e-instruct"
      api_key: "os.environ/GROQ_API_KEY"
      order: 1
    model_info:
      max_tokens: 32768
      supports_function_calling: true

  - model_name: "tier2"
    litellm_params:
      model: "gemini/gemini-2.0-flash"
      api_key: "os.environ/GEMINI_API_KEY"
      order: 2
    model_info:
      max_tokens: 32768
      supports_function_calling: true

  - model_name: "tier2"
    litellm_params:
      model: "azure_ai/gpt-5.2-chat"
      api_key: "os.environ/AZURE_AI_API_KEY"
      api_base: "os.environ/AZURE_AI_API_BASE"
      order: 3
    model_info:
      max_tokens: 32768
      supports_function_calling: true

  # ═══════════════════════════════════════════════════════
  # Tier 3: Complex tasks (architecture, security, refactor)
  # Same as Tier 2 - using Groq/Gemini/Azure AI
  # ═══════════════════════════════════════════════════════
  # (Additional tier3 entries with same provider pattern)

  # ═══════════════════════════════════════════════════════
  # OpenAI Model Name Aliases (for OpenCode compatibility)
  # Maps gpt-4o-mini, gpt-4o, gpt-4.1 to tier providers
  # ═══════════════════════════════════════════════════════
  # (7 model_name entries mapping OpenAI names to tiers)
  # Cost: $0 (compute cost only)
  # ═══════════════════════════════════════════════════════
  - model_name: "local"
    litellm_params:
      model: "ollama/deepseek-coder-v2"
      api_base: "http://ollama:11434"
    model_info:
      max_tokens: 8192

router_settings:
  # Use simple-shuffle (default, recommended) with order-based priority
  routing_strategy: "simple-shuffle"
  enable_pre_call_checks: true  # REQUIRED for order field to work
  num_retries: 2                # Allows full 3-provider chain
  timeout: 120                  # Seconds per provider attempt
  retry_after: 5                # Seconds before retry
  cooldown_time: 60             # Cooldown duration for failed providers
  fallbacks:
    - tier1: ["tier2", "tier3"]
    - tier2: ["tier1", "tier3"]
    - tier3: ["tier2", "tier1"]
  model_group_alias:
    "gpt-4o-mini": "tier1"
    "gpt-4o": "tier2"
    "gpt-4.1": "tier3"
    "gpt-4.1-mini": "tier1"
    "gpt-4.1-nano": "tier1"
    "gpt-5-nano": "tier1"
    "gpt-5-mini": "tier1"

general_settings:
  master_key: "os.environ/LITELLM_MASTER_KEY"
  database_url: "os.environ/DATABASE_URL"
  public_routes: ["/v1/models", "/models", "/health", "/health/", "/health/liveliness"]
  drop_params: true
  set_verbose: false
  json_logs: true
  max_parallel_requests: 100
  global_max_parallel_requests: 1000
  # CRITICAL: These status codes trigger fallback instead of returning error
  fallback_on_status_codes: [429, 500, 502, 503, 504]

litellm_settings:
  drop_params: true
  modify_params: true
  cache: true
  cache_params:
    type: "redis"
    host: "os.environ/REDIS_HOST"
    port: 6379
    password: "os.environ/REDIS_PASSWORD"
    ttl: 3600             # 1 hour cache to reduce provider calls
  success_callback: ["custom_callbacks.cuemarshal_cost_tracker"]
  failure_callback: ["custom_callbacks.cuemarshal_cost_tracker"]
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes* | Groq API key (free tier: 30K TPM, 500K TPD) |
| `GEMINI_API_KEY` | Yes* | Google Gemini API key (free tier) |
| `GEMINI_API_KEY_2` | No | Optional second Gemini key for same-order load balancing |
| `GEMINI_API_KEY_3` | No | Optional third Gemini key for same-order load balancing |
| `AZURE_AI_API_KEY` | Yes* | Azure AI API key (paid, S0 tier) |
| `AZURE_AI_API_BASE` | Yes if Azure | Azure AI endpoint URL |
| `LITELLM_MASTER_KEY` | Yes | Master key for admin access to the proxy |
| `DATABASE_URL` | Yes | PostgreSQL connection string for cost tracking |
| `REDIS_HOST` | Yes | Redis host for caching and cooldowns |
| `REDIS_PASSWORD` | Yes | Redis password |

\* All three providers recommended for maximum resilience. Minimum: Groq + Gemini.

## Provider Characteristics (Free Tier Optimized)

| Provider | Model | TPM Limit | Daily Limit | Context | Tool Calling | Cost |
|----------|-------|-----------|-------------|---------|--------------|------|
| **Groq** (Primary) | `llama-4-scout-17b-16e` | 30K | 500K | 8K | ✓ Excellent | Free |
| **Gemini** (Fallback 1) | `gemini-2.0-flash` | Variable | Per-day quota | 1M | ✓ Good | Free |
| **Azure AI** (Fallback 2) | `kimi-k2.5` | S0 tier limit | S0 tier limit | 20K | ✓ Good | Paid |
| **Azure AI** (Fallback 2) | `gpt-5.2-chat` | S0 tier limit | S0 tier limit | 50K | ✓ Excellent | Paid |

**OpenCode token usage**: ~15K tokens per LLM call (system prompt + tools + context)

## Routing Strategy: Priority-Based with simple-shuffle

**Strategy**: `simple-shuffle` with `order` field priority and pre-call checks enabled.

**How it works**:
1. Pre-call checks filter deployments to lowest available `order` value (highest priority)
2. Simple-shuffle randomly picks among deployments with the same order, which lets Gemini spread requests across multiple keys
3. On failure, provider is cooled down and next retry uses next order value
4. Fallbacks cascade through provider order, then cross-tier fallbacks

**Provider Priority** (all tiers):
1. Groq (order: 1) - Primary
2. Gemini (order: 2) - First fallback, load-balanced across configured Gemini keys
3. Azure AI (order: 3) - Second fallback

**Retries and cooldowns**:
- `num_retries: 5` (enough to walk Groq, up to 3 Gemini keys, Azure AI, and Local in one group)
- `cooldown_time: 60s`
- `retry_after: 5s`
- `timeout: 120s` per provider attempt

**See also**: `docs/features/gateway/fallback-mechanism.md` for complete fallback flow documentation.

## Model Tiers

| Tier | Use Cases | Models (in priority order) | Free-Tier Capable |
|------|-----------|----------------------------|-------------------|
| `tier1` | Simple tasks, formatting, docs | Groq Scout → Gemini Flash → Azure Kimi | ✓ Yes (Groq+Gemini) |
| `tier2` | Features, bugs, reviews, tests | Groq Scout → Gemini Flash → Azure GPT-5.2 | ✓ Yes (Groq+Gemini) |
| `tier3` | Architecture, security, refactoring | Groq Scout → Gemini Flash → Azure GPT-5.2 | ✓ Yes (Groq+Gemini) |

**Note**: All tiers use the same Groq/Gemini models. The tier distinction is for future use when paid higher-capability models are added as primaries.

Fallback chains:
- `tier3` → `tier2` (downgrade to standard)
- `tier2` → `tier1` → `local` (progressive downgrade)
- `tier1` → `local` (fallback to free local model)

## API Endpoints

The gateway exposes standard OpenAI-compatible endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completion (main endpoint) |
| `/v1/embeddings` | POST | Text embeddings |
| `/v1/models` | GET | List available models |
| `/health` | GET | Health check |
| `/spend/logs` | GET | Cost/spend logs (admin) |
| `/spend/tags` | GET | Spend grouped by tags (admin) |
| `/key/generate` | POST | Generate virtual API key (admin) |

### Usage from Conductor

```typescript
import OpenAI from "openai";

const gateway = new OpenAI({
  baseURL: process.env.GATEWAY_URL + "/v1",
  apiKey: process.env.GATEWAY_API_KEY,
});

// Use tier2 for standard tasks
const response = await gateway.chat.completions.create({
  model: "tier2",
  messages: [
    { role: "system", content: "You are a task decomposer..." },
    { role: "user", content: taskDescription },
  ],
});
```

### Usage from OpenCode (in runners)

OpenCode is configured to point at the gateway as its provider:

```json
{
  "provider": {
    "openai": {
      "options": {
        "baseURL": "http://gateway:4100/v1"
      }
    }
  },
  "model": "tier2"
}
```

The model field (`tier1`, `tier2`, `tier3`) is set dynamically by the workflow based on the Conductor's model selection.

## Custom Callbacks

### custom_callbacks.py

A LiteLLM custom callback for enriched cost tracking.

```python
import litellm
from litellm.integrations.custom_logger import CustomLogger


class CueMarshalCostTracker(CustomLogger):
    """Tracks LLM costs per task and project for the CueMarshal platform."""

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Called after every successful LLM call."""
        metadata = kwargs.get("litellm_params", {}).get("metadata", {})

        cost = litellm.completion_cost(
            completion_response=response_obj,
            model=kwargs.get("model", ""),
        )

        # Extract CueMarshal-specific metadata passed by Conductor/OpenCode
        task_id = metadata.get("task_id", "unknown")
        project = metadata.get("project", "unknown")
        agent_role = metadata.get("agent_role", "unknown")

        # Log for observability
        print(f"[cost] task={task_id} project={project} role={agent_role} "
              f"model={kwargs.get('model')} cost=${cost:.6f}")

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        """Called after every failed LLM call."""
        print(f"[error] model={kwargs.get('model')} "
              f"error={kwargs.get('exception', 'unknown')}")


proxy_handler_instance = CueMarshalCostTracker()
```

## Dockerfile

```dockerfile
FROM ghcr.io/berriai/litellm:main-latest

COPY litellm_config.yaml /app/config.yaml
COPY custom_callbacks.py /app/custom_callbacks.py

EXPOSE 4100

CMD ["--config", "/app/config.yaml", "--port", "4100", "--num_workers", "4"]
```

## Monitoring

LiteLLM provides built-in monitoring:

- **Spend tracking**: Query `/spend/logs` for per-request cost data.
- **Model performance**: Track latency, error rates, and token usage per model.
- **Alerts**: Webhook alerts for exceptions, slow responses, and hanging requests.

The System MCP Server (`cost_get_summary`, `cost_get_budget`) queries these endpoints to expose cost data to agents and the mobile app.

## Adding New Providers

To add a new LLM provider:

1. Add a new entry to `model_list` in `litellm_config.yaml`.
2. Set the appropriate `litellm_params.model` prefix (e.g., `groq/`, `bedrock/`).
3. Add the API key as an environment variable.
4. Optionally add to a fallback chain.
5. Restart the gateway service.

LiteLLM supports 100+ providers. See [LiteLLM documentation](https://docs.litellm.ai/docs/providers) for the full list.
