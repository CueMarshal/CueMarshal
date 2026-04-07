# LLM Gateway

OpenAI-compatible LLM proxy built on LiteLLM. Routes requests to the optimal provider based on model tier with automatic fallback on rate limits.

## Features

- **Tiered Models**: tier1 (simple), tier2 (standard), tier3 (complex), local (free)
- **Multi-Provider**: Anthropic, OpenAI, Ollama, and 100+ others
- **Automatic Fallback**: On rate limits or errors
- **Cost Tracking**: Per task, project, and agent role
- **Redis Caching**: Response caching for repeated queries
- **Latency-Based Routing**: Chooses fastest available provider

## Configuration

See `litellm_config.yaml` for full configuration.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | No* | Groq API key fallback |
| `GEMINI_API_KEY` | No* | Gemini API key fallback |
| `AZURE_AI_API_KEY` | No* | Azure AI API key fallback |
| `AZURE_AI_API_BASE` | No* | Azure AI endpoint fallback |
| `OLLAMA_BASE_URL` | No* | Local Ollama base URL (default: `http://host.docker.internal:11434`) |
| `LITELLM_MASTER_KEY` | Yes | Master key for admin access |
| `DATABASE_URL` | Yes | PostgreSQL connection for cost tracking |
| `REDIS_HOST` | No | Redis host (default: redis) |
| `REDIS_PORT` | No | Redis port (default: 6379) |

\* Configure either local Ollama or at least one cloud provider.

## Usage

### From Conductor (TypeScript)

```typescript
import OpenAI from "openai";

const gateway = new OpenAI({
  baseURL: process.env.GATEWAY_URL + "/v1",
  apiKey: process.env.GATEWAY_API_KEY,
});

const response = await gateway.chat.completions.create({
  model: "tier2",
  messages: [
    { role: "system", content: "You are a helpful assistant..." },
    { role: "user", content: "Analyze this task..." },
  ],
  metadata: {
    task_id: "uuid",
    project: "my-project",
    agent_role: "developer",
  },
});
```

### From OpenCode (in runners)

OpenCode config points to the gateway:

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

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | Chat completion (main endpoint) |
| `POST /v1/embeddings` | Text embeddings |
| `GET /v1/models` | List available models |
| `GET /health` | Health check |
| `GET /spend/logs` | Cost logs (admin) |
| `GET /spend/tags` | Spend by tags (admin) |

## Cost Tracking

The `custom_callbacks.py` module tracks all LLM usage with these fields:

- `task_id`: UUID of the task
- `project`: Repository name
- `agent_role`: Agent that made the call
- `model`: Model used
- `input_tokens`, `output_tokens`, `total_tokens`
- `cost_usd`: Calculated cost
- `duration_ms`: Request duration

Logs are written to stdout (JSON format) and can be collected by log aggregation systems.

## Testing

```bash
# Start the gateway
docker compose up -d gateway

# Check health
curl http://localhost:4100/health

# List models
curl -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  http://localhost:4100/v1/models

# Test chat completion
curl -X POST http://localhost:4100/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tier1",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Adding Providers

To add a new provider, update `litellm_config.yaml`:

```yaml
model_list:
  - model_name: "tier2"
    litellm_params:
      model: "groq/llama-3.1-70b-versatile"
      api_key: "os.environ/GROQ_API_KEY"
```

Then add the API key to `.env` and restart the gateway.

See [LiteLLM Providers](https://docs.litellm.ai/docs/providers) for the full list of supported providers.
