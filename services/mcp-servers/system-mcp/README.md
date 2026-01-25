# System MCP Server

MCP server providing observability tools for LLM costs, runner status, and system health.

## Tools

### Cost Tracking
- `cost_get_summary` - Get LLM spending summary
- `cost_get_budget` - Check remaining budget

### Runner Management
- `runner_get_status` - Get runner utilization
- `runner_list` - List all registered runners

### Health & Metrics
- `health_check` - Check all service health
- `metrics_get` - Get platform performance metrics

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GATEWAY_URL` | Yes | LiteLLM Gateway URL |
| `GATEWAY_API_KEY` | Yes | LiteLLM admin API key |
| `REDIS_URL` | Yes | Redis connection string |
| `CONDUCTOR_URL` | Yes | Conductor internal API URL |
| `DATABASE_URL` | No | PostgreSQL connection (for direct queries) |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4202`) |
