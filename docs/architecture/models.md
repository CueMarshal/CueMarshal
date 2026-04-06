# LLM Model Configuration — CueMarshal

## Architecture Overview

```
OpenCode v1.1.53 (in runners)
    ↓ OPENAI_BASE_URL=http://127.0.0.1:4101/v1
Gateway Auth Proxy (Node.js, per-runner, port 4101)
    ↓ injects Authorization: Bearer <key>
LiteLLM Gateway (container: gateway, port 4100)
    ↓ routes by model name, auto-clamps max_tokens
Upstream Providers (Groq, Azure AI, Gemini)
```

## Tier System

| Tier | Use Case | Provider 1 (Primary) | Provider 2 (Fallback) | Provider 3 (Last Resort) |
|------|----------|---------------------|----------------------|-------------------------|
| `tier1` | Simple tasks (formatting, docs, typos, labels) | `groq/meta-llama/llama-4-scout-17b-16e-instruct` | `gemini/gemini-2.0-flash` | `azure_ai/gpt-oss-120b` |
| `tier2` | Standard tasks (features, bugs, reviews, tests) | `groq/llama-3.3-70b-versatile` | `gemini/gemini-2.5-flash` | `azure_ai/gpt-oss-120b` |
| `tier3` | Complex tasks (architecture, security, refactor) | `azure_ai/gpt-oss-120b` | `gemini/gemini-2.5-pro` | — |

**Fallback chain**: `tier3 → tier2 → tier1` (configured in `router_settings.fallbacks`).

**Rate limit resilience**: Azure AI (`gpt-oss-120b`) is a paid endpoint added to all tiers as last-resort fallback. Groq and Gemini free tiers are rate-limited and can be fully exhausted during heavy pipeline usage.

## OpenAI Model Name Aliases

OpenCode uses OpenAI-style model names via `--model litellm/MODEL`. LiteLLM maps them to tiers:

| OpenAI Model Name | Maps To | Tier | Providers |
|-------------------|---------|------|-----------|
| `gpt-4o-mini` | Same providers as tier1 | tier1 | Groq → Gemini → Azure AI |
| `gpt-4.1-mini` | Same providers as tier1 | tier1 | Groq → Gemini → Azure AI |
| `gpt-4.1-nano` | Alias to tier1 | tier1 | (via model_group_alias) |
| `gpt-4o` | Same providers as tier2 | tier2 | Groq → Gemini → Azure AI |
| `gpt-4.1` | Same providers as tier3 | tier3 | Azure AI → Gemini |

These are implemented as **duplicate `model_list` entries** in `litellm_config.yaml`, plus `model_group_alias` in `router_settings` for redundancy.

## OpenCode v1.1.53 Configuration

OpenCode v1.1.53 uses `opencode run "prompt" --model litellm/MODEL` in CLI/headless mode.

| Setting | Value | Notes |
|---------|-------|-------|
| Binary | `/usr/local/bin/opencode` | musl build from `anomalyco/opencode` GitHub releases |
| CLI mode | `opencode run "prompt" --model litellm/gpt-4o-mini` | Non-interactive, headless execution |
| Provider | OpenAI-compatible | Uses `OPENAI_BASE_URL` and `OPENAI_API_KEY` env vars |
| Config | `opencode.json` per agent role | v1.1.53 format with `$schema`, `provider`, `model` fields |
| Max tokens | 32000 (default) | Auto-clamped by LiteLLM `modify_params: true` |

### Key Difference from v0.0.55

- v0.0.55 used `-p "prompt"` flag and did NOT load config in non-interactive mode (CRITICAL BLOCKER — now resolved)
- v1.1.53 uses `run "prompt" --model MODEL` subcommand and properly loads config
- v1.1.53 uses `OPENAI_BASE_URL` env var (not `LOCAL_ENDPOINT` with `local` provider)

## Gateway Auth Proxy (`services/runner/gateway-proxy.js`)

LiteLLM requires auth on ALL endpoints (including `/v1/models`). The `public_routes` config setting **requires a premium/enterprise LiteLLM license**.

Solution: A lightweight Node.js HTTP proxy runs on `127.0.0.1:4101` inside each runner. It forwards all requests to `gateway:4100` and injects `Authorization: Bearer <key>`.

```
Runner Container:
  OpenCode → http://127.0.0.1:4101/v1 (proxy) → http://gateway:4100 (LiteLLM)
```

The proxy is started by `services/runner/entrypoint.sh` before the act_runner daemon.

## LiteLLM Critical Settings

### `modify_params: true` (REQUIRED)

OpenCode v1.1.53 sends `max_tokens: 32000` by default. Groq's llama-4-scout only supports `max_output_tokens: 8192`. Without `modify_params: true`, this causes `400 BadRequestError`.

**How it works**: `litellm/litellm_core_utils/token_counter.py::get_modified_max_tokens()` — CASE 2: if `user_max_tokens > max_output_tokens`, clamp to `max_output_tokens`.

**Config location**: `litellm_settings.modify_params: true` in `services/gateway/litellm_config.yaml`.

**Verification**: Gateway startup logs show `setting litellm.modify_params=True`.

### `drop_params: true`

Drops unsupported parameters instead of failing. Configured in both `general_settings` and `litellm_settings`.

### Gateway Config Delivery

The `Dockerfile` COPYs config at build time. For iteration speed, `docker-compose.yml` volume-mounts the config:
```yaml
volumes:
  - ./services/gateway/litellm_config.yaml:/app/config.yaml:ro
```
Changes take effect on `docker compose restart gateway` without rebuilding.

## Agent → Model Mapping (in workflows)

The `task-execute.yml` workflow maps tier names to OpenCode model IDs:

```bash
case "${TIER}" in
  tier1) MODEL_ID="gpt-4o-mini" ;;
  tier2) MODEL_ID="gpt-4o" ;;
  tier3) MODEL_ID="gpt-4.1" ;;
  *) MODEL_ID="gpt-4o" ;;
esac

opencode run "Work on issue #$ISSUE_NUMBER..." --model "litellm/$MODEL_ID"
```

## Configuration Files

| File | Purpose |
|------|---------|
| `services/gateway/litellm_config.yaml` | LiteLLM model routing, fallbacks, caching, cost tracking |
| `services/agents/*/opencode.json` | Per-role OpenCode config (v1.1.53 format) |
| `services/runner/gateway-proxy.js` | Auth-injecting HTTP proxy |
| `services/runner/entrypoint.sh` | Proxy startup, env var export, runner daemon launch |
| `.env` | API keys, master key, provider credentials |

## Provider API Keys

| Provider | Env Var | Used By | Type |
|----------|---------|---------|------|
| Groq | `GROQ_API_KEY` | tier1, tier2 primary | Free tier (rate-limited) |
| Gemini | `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` | tier1, tier2 fallback, tier3 fallback with same-order load balancing | Free tier (quota can exhaust) |
| Azure AI | `AZURE_AI_API_KEY` + `AZURE_AI_API_BASE` | tier3 primary, all tiers last-resort | Paid (reliable) |
| LiteLLM Master | `LITELLM_MASTER_KEY` / `GATEWAY_API_KEY` | Gateway auth, runner proxy | — |

## Conductor Model Selection

The Conductor's `model-selector.ts` analyzes task complexity and selects tiers:

- **Labels-based**: `complexity:simple` → tier1, `complexity:standard` → tier2, `complexity:complex` → tier3
- **Keyword heuristics**: Title/body analysis for complexity signals
- **Budget-aware**: Checks `TOTAL_MONTHLY_BUDGET_USD` and `SELF_IMPROVE_BUDGET_PCT`
- **Default models**: `CHAT_MODEL=tier2`, `DECOMPOSE_MODEL=tier2`

## LiteLLM Router Settings

```yaml
routing_strategy: "latency-based-routing"
num_retries: 3
timeout: 300s
retry_after: 60s
allowed_fails: 3
cooldown_time: 60s
cache: redis (TTL 600s)
```

## Cost Tracking

LiteLLM uses a custom callback (`custom_callbacks.cuemarshal_cost_tracker`) that logs:
- `task_id`, `project`, `agent_role`, `model`
- `input_tokens`, `output_tokens`, `total_tokens`
- `cost_usd`, `duration_ms`

Logs are written to stdout (JSON) for aggregation.

## Rate Limit Behavior

| Provider | Limit Type | Behavior When Exhausted |
|----------|-----------|------------------------|
| Groq | Per-minute RPM, daily token limits | 429 → LiteLLM cooldown (60s) → next provider |
| Gemini | Free tier: daily quota, per-minute RPM | 429 with `limit: 0` → quota fully exhausted until next day |
| Azure AI | Paid: high limits | Rarely rate-limited, reliable fallback |

**Critical lesson**: Gemini free tier can show `limit: 0` meaning the daily quota is **fully exhausted** (not just temporarily rate-limited). The pipeline was stuck for ~30 minutes before Azure AI was added as fallback. Always ensure at least one paid provider is in every tier's fallback chain.
