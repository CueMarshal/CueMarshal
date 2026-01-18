# Gitea MCP Server

MCP server providing structured tools for Gitea operations. Used by both OpenCode agents (stdio) and the Conductor's chat handler (HTTP/SSE).

## Tools

### Issue Management
- `gitea_create_issue` - Create new issue
- `gitea_get_issue` - Get issue details and comments
- `gitea_update_issue` - Update issue (title, body, state, labels)
- `gitea_add_comment` - Add comment to issue or PR
- `gitea_list_issues` - List/search issues with filters

### Pull Requests
- `gitea_create_pull_request` - Create new PR
- `gitea_get_pull_request` - Get PR details and files
- `gitea_merge_pull_request` - Merge a PR
- `gitea_create_review` - Submit PR review

### Repositories
- `gitea_list_repos` - List repositories
- `gitea_get_file_contents` - Read file contents
- `gitea_create_branch` - Create new branch

### Workflows
- `gitea_dispatch_workflow` - Trigger workflow
- `gitea_get_workflow_runs` - Get workflow run history

### Search
- `gitea_search_code` - Search code
- `gitea_search_issues` - Search issues

## Usage

### stdio mode (in OpenCode)

```json
{
  "mcp": {
    "gitea": {
      "command": "node",
      "args": ["/mcp-servers/gitea-mcp/dist/index.js"],
      "env": {
        "GITEA_URL": "http://gitea:3000",
        "GITEA_TOKEN": "${GITEA_TOKEN}"
      }
    }
  }
}
```

### HTTP/SSE mode (for Conductor)

```bash
MCP_TRANSPORT=http PORT=4200 node dist/index.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITEA_URL` | Yes | Gitea server URL |
| `GITEA_TOKEN` | Yes | Gitea API token |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4200`) |

## Building

```bash
npm run build
```

## Testing

```bash
# Test in stdio mode
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js

# Test in HTTP mode
MCP_TRANSPORT=http node dist/index.js &
curl http://localhost:4200/health
```
