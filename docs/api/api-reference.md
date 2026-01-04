# API Reference

## Overview

The Conductor exposes a REST API and WebSocket server for the mobile app and external integrations. All endpoints are prefixed with `/api` except the webhook endpoint.

**Base URL**: `https://cuemarshal.example.com`

## Authentication

Authentication is **not enforced** in the Conductor API yet. The mobile app performs OAuth2 directly against Gitea and stores the token locally, but the Conductor does not validate bearer tokens at this time.

## Endpoints

### Chat

#### POST /api/chat

Send a natural language message and receive a response. The Conductor processes the message using the LLM Gateway with MCP tools registered.

**Request:**

```json
{
  "session_id": "uuid-optional-for-continuity",
  "message": "Create a new project for a REST API with user auth"
}
```

**Response (200):**

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": {
    "role": "assistant",
    "content": "I've created the project \"rest-api-auth\" with 5 tasks..."
  },
  "toolCallsSummary": [
    {
      "tool": "gitea_create_repo",
      "result_summary": "Created cuemarshal/rest-api-auth"
    },
    {
      "tool": "gitea_create_issue",
      "result_summary": "Created issue #1: Design authentication architecture"
    }
  ]
}
```

**Streaming**: Not implemented yet. Responses are returned as JSON.

#### GET /api/chat/sessions

List chat sessions for the authenticated user.

**Response (200):**

```json
{
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "created_at": "2026-02-09T10:00:00Z",
      "updated_at": "2026-02-09T14:30:00Z",
      "message_count": 12,
      "preview": "Create a new project for a REST API..."
    }
  ]
}
```

#### GET /api/chat/sessions/:id

Get full chat history for a session.

**Response (200):**

```json
{
  "session_id": "550e8400-...",
  "messages": [
    {
      "role": "user",
      "content": "Create a new project for a REST API with user auth",
      "timestamp": "2026-02-09T14:30:00Z"
    },
    {
      "role": "assistant",
      "content": "I've created the project...",
      "tool_calls_summary": [...],
      "timestamp": "2026-02-09T14:30:05Z"
    }
  ]
}
```

---

### Projects

#### GET /api/projects

List all projects (repositories in the CueMarshal organization).

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `active` | `active`, `completed`, `all` |
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page |

**Response (200):**

```json
{
  "projects": [
    {
      "name": "rest-api-auth",
      "full_name": "cuemarshal/rest-api-auth",
      "description": "REST API with user authentication",
      "html_url": "https://gitea.example.com/cuemarshal/rest-api-auth",
      "created_at": "2026-02-09T10:00:00Z",
      "stats": {
        "open_issues": 3,
        "closed_issues": 12,
        "open_prs": 1,
        "merged_prs": 10,
        "total_tasks": 15,
        "completed_tasks": 12
      },
      "last_activity": "2026-02-09T14:30:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20
}
```

#### GET /api/projects/:name

Get detailed project information.

**Response (200):**

```json
{
  "name": "rest-api-auth",
  "full_name": "cuemarshal/rest-api-auth",
  "description": "REST API with user authentication",
  "stats": {
    "open_issues": 3,
    "closed_issues": 12,
    "open_prs": 1,
    "merged_prs": 10
  },
  "milestones": [
    {
      "title": "v1.0",
      "state": "open",
      "open_issues": 3,
      "closed_issues": 7,
      "due_date": "2026-03-01T00:00:00Z"
    }
  ],
  "recent_activity": [
    {
      "type": "pr_merged",
      "title": "feat(#8): Add password hashing",
      "timestamp": "2026-02-09T14:00:00Z",
      "agent": "developer"
    }
  ],
  "cost": {
    "total_usd": 8.50,
    "this_month_usd": 5.20
  }
}
```

---

### Tasks

#### GET /api/tasks

List tasks across all projects.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `all` | `pending`, `in_progress`, `review`, `completed`, `failed`, `all` |
| `project` | string | — | Filter by project name |
| `role` | string | — | Filter by agent role |
| `page` | number | `1` | Page number |
| `limit` | number | `50` | Items per page |

**Response (200):**

```json
{
  "tasks": [
    {
      "id": "uuid",
      "gitea_issue_number": 42,
      "gitea_repo": "cuemarshal/rest-api-auth",
      "title": "Implement JWT token validation",
      "status": "in_progress",
      "agent_role": "developer",
      "model_tier": "tier2",
      "branch_name": "feat/issue-42",
      "pr_number": null,
      "progress": 60,
      "progress_message": "Writing token validation middleware",
      "parent_task_id": "parent-uuid",
      "created_at": "2026-02-09T10:00:00Z",
      "updated_at": "2026-02-09T14:30:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 50
}
```

#### GET /api/tasks/:id

Get detailed task information.

**Response (200):**

```json
{
  "id": "uuid",
  "gitea_issue_number": 42,
  "gitea_repo": "cuemarshal/rest-api-auth",
  "title": "Implement JWT token validation",
  "description": "Full issue body...",
  "status": "in_progress",
  "agent_role": "developer",
  "model_tier": "tier2",
  "branch_name": "feat/issue-42",
  "pr_number": null,
  "progress": 60,
  "progress_message": "Writing token validation middleware",
  "parent": {
    "id": "parent-uuid",
    "title": "Build user authentication module",
    "status": "in_progress"
  },
  "sub_tasks": [],
  "cost": {
    "total_usd": 0.45,
    "tokens_used": 15000
  },
  "timeline": [
    { "event": "created", "timestamp": "2026-02-09T10:00:00Z" },
    { "event": "analyzed", "timestamp": "2026-02-09T10:00:05Z", "detail": "Assigned to developer, tier2" },
    { "event": "workflow_started", "timestamp": "2026-02-09T10:01:00Z" },
    { "event": "progress_update", "timestamp": "2026-02-09T14:30:00Z", "detail": "60% - Writing middleware" }
  ]
}
```

---

### Dashboard

#### GET /api/dashboard

Aggregated system metrics for the mobile dashboard.

**Response (200):**

```json
{
  "health": {
    "overall": "healthy",
    "services": {
      "gitea": { "status": "healthy", "latency_ms": 12 },
      "conductor": { "status": "healthy", "latency_ms": 5 },
      "gateway": { "status": "healthy", "latency_ms": 8 },
      "redis": { "status": "healthy", "latency_ms": 1 },
      "postgres": { "status": "healthy", "latency_ms": 3 }
    }
  },
  "runners": {
    "total": 4,
    "active": 2,
    "idle": 2,
    "queue_depth": 3
  },
  "costs": {
    "month_to_date_usd": 42.50,
    "budget_remaining_usd": 57.50,
    "by_tier": {
      "tier1": 5.00,
      "tier2": 30.00,
      "tier3": 7.50
    }
  },
  "metrics": {
    "tasks_completed_today": 8,
    "tasks_completed_week": 45,
    "success_rate": 0.937,
    "avg_task_duration_minutes": 12,
    "prs_merged_today": 6,
    "self_improvements_this_week": 3
  },
  "recent_activity": [
    {
      "type": "pr_merged",
      "title": "feat(#42): JWT token validation",
      "project": "rest-api-auth",
      "timestamp": "2026-02-09T14:30:00Z"
    },
    {
      "type": "task_started",
      "title": "Add rate limiting middleware",
      "project": "rest-api-auth",
      "agent": "developer",
      "timestamp": "2026-02-09T14:25:00Z"
    }
  ]
}
```

---

### Webhooks

#### POST /webhooks/gitea

Receives Gitea webhook events. Not authenticated via bearer token; uses HMAC signature verification.

**Headers:**

| Header | Description |
|--------|-------------|
| `X-Gitea-Event` | Event type (e.g., `issues`, `pull_request`) |
| `X-Gitea-Delivery` | Unique delivery ID |
| `X-Gitea-Signature` | HMAC-SHA256 signature of the payload |
| `Content-Type` | `application/json` |

**Response:** `200 OK` with `{"received": true}`

See [webhooks.md](webhooks.md) for the full event matrix.

---

### Internal API

These endpoints are used by MCP servers and runners. Authenticated via `CONDUCTOR_SECRET`.

#### GET /api/internal/runners/status

```json
{
  "total_runners": 4,
  "active_runners": 2,
  "idle_runners": 2,
  "queue_depth": 3
}
```

#### GET /api/internal/runners/idle-count

```json
{
  "idle_count": 2
}
```

#### POST /api/internal/tasks/:id/progress

```json
{
  "progress": 60,
  "status_message": "Writing middleware",
  "phase": "coding"
}
```

---

## WebSocket API

### Connection

```
ws://conductor:4000/ws?token=<bearer_token>
```

### Server → Client Events

| Event Type | Payload | Description |
|------------|---------|-------------|
| `task:created` | `{ task_id, title, repo, role }` | New task created |
| `task:started` | `{ task_id, agent_role, runner_id }` | Agent begins work |
| `task:progress` | `{ task_id, progress, status_message }` | Progress update |
| `task:completed` | `{ task_id, pr_number }` | Task done, PR created |
| `task:failed` | `{ task_id, error }` | Task execution failed |
| `pr:reviewed` | `{ pr_number, result, reviewer }` | Review submitted |
| `pr:merged` | `{ pr_number, issue_number }` | PR merged |
| `system:health` | `{ services: {...} }` | Periodic health (every 60s) |
| `cost:threshold` | `{ project, threshold, spent, budget }` | Budget threshold hit |

### Message Format

```json
{
  "type": "task:progress",
  "payload": {
    "task_id": "uuid",
    "progress": 60,
    "status_message": "Writing token validation middleware"
  },
  "timestamp": "2026-02-09T14:30:00Z"
}
```

### Client → Server Events

| Event Type | Payload | Description |
|------------|---------|-------------|
| `ping` | `{}` | Keep-alive ping |
| `subscribe` | `{ project: "name" }` | Subscribe to project events |
| `unsubscribe` | `{ project: "name" }` | Unsubscribe from project events |

## Error Responses

All error responses follow a standard format:

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with ID 'uuid' not found",
    "status": 404
  }
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 422 | Invalid request parameters |
| `RATE_LIMITED` | 429 | Too many requests |
| `BUDGET_EXCEEDED` | 402 | Project LLM budget exhausted |
| `INTERNAL_ERROR` | 500 | Server error |
| `SERVICE_UNAVAILABLE` | 503 | Dependency service down |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /api/chat` | 10 requests/minute per user |
| `GET /api/*` | 60 requests/minute per user |
| `POST /webhooks/gitea` | 100 requests/minute (total) |
