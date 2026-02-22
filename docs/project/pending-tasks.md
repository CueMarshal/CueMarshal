# Pending Tasks

This list captures functionality gaps identified during documentation verification.
Last updated: 2026-02-22

## Completed ✅

- ~~Enforce API authentication in the Conductor~~ — `validateBearerToken` and `validateMobileToken` middleware implemented with unit tests (2026-02-22)
- ~~Add budget-aware checks to model selection~~ — Model selector integrates budget check, can downgrade or block tiers. Unit tests added (2026-02-22)
- ~~Add PR-driven self-improvement trigger on PR merge~~ — PLAN-02 push-based trigger implemented (2026-02-22)
- ~~Role-based Gitea agent identities~~ — PLAN-12: per-role users, tokens, git identity in workflows (2026-02-22)
- ~~Label name-to-ID resolution~~ — PLAN-04: MCP tools `gitea_list_labels`, `gitea_resolve_label_names` with caching (2026-02-22)
- ~~Deterministic improvement discovery~~ — PLAN-03: Scanner scripts replace ad-hoc LLM scanning (2026-02-22)
- ~~Self-improvement orchestration~~ — PLAN-01: Centralized in Conductor with Redis locking (2026-02-22)
- ~~Self-improvement observability~~ — PLAN-11: Correlation IDs, structured logging, failure thresholds (2026-02-22)
- ~~Workflow retry and tier escalation~~ — PLAN-07: Automatic retry with tier escalation (2026-02-22)
- ~~Cost telemetry from gateway~~ — PLAN-05: Async buffered writes, cost API endpoints (2026-02-22)
- ~~Configuration validation~~ — PLAN-10: `validate-env.sh`, CI workflow, `CONFIGURATION.md` (2026-02-22)
- ~~Project lifecycle management~~ — Create → plan → approve → execute → complete with milestones (2026-02-22)
- ~~OAuth2 mobile authentication~~ — Auto-provisioned OAuth2 app, PKCE flow, deep link handling (2026-02-22)
- ~~Mobile dashboard with real data~~ — API wiring for active tasks, recent activity, system stats (2026-02-22)

## Platform

- Add SSE streaming for `POST /api/chat` responses (docs updated to reflect non-streaming).
- Handle additional webhook events and labels:
  - `issues.closed` and `issues.assigned` (currently ignored)
  - `issues.labeled` for `complexity:*` and `needs-human-review`
- Implement code review dispatch when PRs are opened (current `dispatchCodeReview` in Conductor is a no-op; reviews only trigger via `.review-trigger` from `task-execute.yml`).
- Implement test dispatch creation (no `.test-trigger` generation in Conductor; `dispatchTests` is a no-op).
- Add state reconciliation job between Gitea and Conductor to heal missed webhooks.
- Enable vector MCP in docker-compose and agent MCP configs (currently implemented but not wired in).

## Mobile App

- Implement WebSocket client for real-time updates (Conductor WebSocket exists, mobile does not connect).
- Implement push notifications (currently UI-only toggles).
- Add token refresh logic for OAuth (current flow works but no automatic refresh).

---

## Implementation Plan

### Phase 1: Platform Correctness + Security ✅ COMPLETED

**Objective:** Enforce authentication and add budget constraints to core platform services.

**Status:** All tasks completed (2026-02-22).

- Bearer token validation middleware implemented (`services/conductor/src/middleware/auth.ts`)
- `validateBearerToken` for internal routes, `validateMobileToken` for mobile/OAuth
- Applied to all protected endpoints (chat, internal, mobile)
- Budget-aware model selector with tier downgrade logic
- Comprehensive test suites: auth (392 lines), model-selector (543 lines)
- Jest + Supertest testing infrastructure added

---

### Phase 2: Workflow Dispatch Completeness

**Objective:** Implement missing sentinel-based workflow triggers for code review and testing.

**Tasks:**

1. **Code Review Dispatch** (Partially Done)
   - ✅ `.review-trigger` works end-to-end from `task-execute.yml`
   - ❌ `dispatchCodeReview` in Conductor is still a no-op (reviews only trigger from workflow, not from PR opened webhook)
   - Wire Conductor webhook handler to create `.review-trigger` on PR opened events

2. **Test Dispatch**
   - Implement `.test-trigger` file creation in `dispatchTests`
   - Add payload schema (issue number, branch, model tier, writeTests flag)
   - Create or update `.gitea/workflows/run-tests.yml` to trigger on `.test-trigger` push
   - Wire into task completion or manual test request flow
   - Remove "not implemented" log placeholder

**Acceptance Criteria:**

- PR opened events from Conductor generate `.review-trigger` and start code review workflow
- Test requests generate `.test-trigger` and start test workflow
- No "not implemented" logs remain for review/test dispatch
- Workflows complete successfully with sample PR and test task

**Estimated Effort:** 3-4 days

---

### Phase 3: Reliability + Reconciliation

**Objective:** Add state reconciliation and verify self-improvement pipeline end-to-end.

**Tasks:**

1. **Verify Self-Improvement Pipeline** (Scanners → LLM → Issues)
   - ✅ PLAN-02: Push-based trigger implemented
   - ✅ PLAN-03: Scanner scripts implemented
   - ✅ PLAN-01: Orchestration unified with Redis locking
   - ✅ PLAN-11: Correlation IDs and observability
   - ❌ End-to-end flow with scanners not yet verified in production

2. **State Reconciliation Job**
   - Add hourly cron job in Conductor to reconcile Gitea and DB state
   - Query open issues from Gitea API
   - Query active tasks from Conductor DB
   - Identify mismatches (orphaned DB tasks, missing webhook deliveries)
   - Log reconciliation results and optionally create recovery tasks
   - Add configuration for reconciliation frequency

3. **Verify Workflow Retry Escalation**
   - ✅ PLAN-07: Retry policy and tier escalation implemented
   - ❌ Not yet tested with a real workflow failure

**Acceptance Criteria:**

- Self-improvement scanner pipeline creates issues with correct labels
- Reconciliation job detects and logs state drift after simulated missed webhook
- Retry escalation correctly promotes tier1 → tier2 → tier3 → human on failure

**Estimated Effort:** 4-5 days

---

### Phase 4: Vector MCP Wiring

**Objective:** Enable vector search for agent context retrieval.

**Tasks:**

1. **Docker Compose Integration**
   - Add `vector-mcp` service definition to `docker-compose.yml`
   - Add PostgreSQL pgvector extension initialization to `enable-vector.sql`
   - Configure environment variables (`VECTOR_MCP_PORT`, `POSTGRES_CONNECTION`)
   - Add health check for vector MCP service

2. **Agent Configuration**
   - Update agent OpenCode profiles to include vector MCP server
   - Add vector search tools to developer and architect agent tool lists
   - Document vector search usage in agent system prompts
   - Add example queries to `docs/features/mcp-servers/overview.md`

**Acceptance Criteria:**

- Vector MCP service starts successfully in docker-compose stack
- Health endpoint returns 200 OK
- Agents can query vector tools in a test task
- Vector search returns relevant code patterns from indexed repositories

**Estimated Effort:** 2-4 days

---

### Phase 5: Mobile App Completion

**Objective:** Complete mobile app features to reach parity with documented scope.

**Status:** Partially complete. OAuth, dashboard, and chat are functional. WebSocket and push notifications remain.

**Completed:**

- ✅ Projects screen with real API data (project_list MCP tool + internal API)
- ✅ Dashboard with active tasks, recent activity, system stats
- ✅ Chat store wired to Conductor `/api/chat` with session tracking
- ✅ OAuth2 PKCE flow with deep link redirect (`cuemarshal://oauth`)
- ✅ Expo SDK 54 upgrade, EAS build configured for iOS
- ✅ Platform detection (Android emulator `10.0.2.2`)

**Remaining Tasks:**

1. **WebSocket Client**
   - Implement WebSocket connection in `services/websocket.ts`
   - Add reconnection logic with exponential backoff
   - Subscribe to task updates and chat messages
   - Update Zustand stores on WebSocket events
   - Add connection status indicator in UI

2. **OAuth Token Refresh**
   - Add automatic token refresh before expiration
   - Handle refresh failure gracefully (re-prompt login)

3. **Push Notifications**
   - Integrate Expo push notifications
   - Add notification permission request flow
   - Send device token to Conductor for registration
   - Wire Conductor to send notifications on task updates
   - Handle notification tap to navigate to relevant screen

**Acceptance Criteria:**

- WebSocket reconnects automatically after network interruption
- OAuth token refreshes before expiration
- Push notifications arrive and navigate to correct screen when tapped

**Estimated Effort:** 7-10 days

---

## Gitea Upgrade Considerations

**Current Version:** Gitea 1.22  
**Latest Release:** Gitea 1.25

**Workflow Dispatch Status:**

- Gitea 1.25 **does not** include `workflow_dispatch` API support
- Push-based sentinel file triggers remain necessary
- Current architecture is proven stable for 1.22–1.25

**Benefits of Upgrading to 1.25:**

- Email notifications for workflow run success/failure (#34982)
- Improved `inputs` context parsing in workflows (#35595)
- Workflow run API + webhook for programmatic access (#33964)
- Better Actions UI consistency (#35618)
- De-duplicated Actions email notifications (#35215)

**Recommendation:**

- **Upgrade to Gitea 1.25** for quality-of-life improvements
- **Keep push-based trigger architecture** (no changes needed)
- **Monitor future releases** for `workflow_dispatch` API support

**Impact on Pending Tasks:**

- ⚠️ **State reconciliation** - New workflow_run webhook could enhance detection
- ⚠️ **Self-improvement monitoring** - Email notifications improve observability
- ❌ **Code review/test dispatch** - Still require sentinel files
- ❌ **Other platform/mobile tasks** - Unaffected by Gitea version
