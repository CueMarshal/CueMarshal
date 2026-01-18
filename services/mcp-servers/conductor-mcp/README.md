# Conductor MCP Server

MCP server providing tools for task coordination, agent status queries, and project management.

## Tools

### Task Management
- `task_report_progress` - Agent reports completion percentage
- `task_request_help` - Request assistance from another role
- `task_get_context` - Get full task context (parent, sub-tasks, PRs)
- `task_list_active` - List all in-progress tasks

### Agent Management
- `agent_get_status` - Query specific agent/runner status
- `agent_list_available` - List all agent roles and assignments

### Project Management
- `project_list` - List all projects with summary
- `project_get_details` - Get detailed project information

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONDUCTOR_URL` | Yes | Conductor internal API URL |
| `CONDUCTOR_SECRET` | Yes | Shared secret for authentication |
| `MCP_TRANSPORT` | No | `stdio` or `http` (default: `stdio`) |
| `PORT` | No | HTTP port (default: `4201`) |
