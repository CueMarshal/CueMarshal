# Project Lifecycle Validation Guide

This document provides comprehensive testing procedures for the three key features implemented for project lifecycle validation.

## Overview

The platform now supports:
1. **Project Creation from Mobile App** - Chat-based project creation with plan generation and approval
2. **Priority-Aware Self-Improvement** - Self-improvement only runs when NO project tasks exist
3. **Dynamic Task Prioritization** - Project tasks always preempt self-improvement work

---

## Feature 1: Mobile App Project Submission

### Flow Diagram

```
Mobile Chat → "Create a REST API project" 
  → Conductor clarifies requirements
  → project_create MCP tool executed
  → Repository created in Gitea
  → Workflows initialized
  → LLM generates project plan
  → Plan presented to user for approval
  → User approves via chat
  → project_approve MCP tool executed
  → Milestones and issues created
  → Agents start working autonomously
```

### Testing Steps

**1. Start the mobile app and open the Chat tab**

```bash
cd mobile
npm start
```

**2. Send a project creation message:**

```
Create a new REST API project for user authentication with JWT tokens
```

**3. Respond to clarification questions**

The chat assistant will ask about:
- Technology stack (Node.js, Python, etc.)
- Database preference
- Deployment target
- Key features

**4. Review the generated plan**

The assistant will present:
- Milestones (Design, Implementation, Testing, Deployment)
- Issues with roles, complexity, and dependencies
- Architecture checkpoints requiring your review

**5. Approve the plan:**

```
Looks good, please proceed
```

or

```
Approve the plan
```

**6. Verify in Gitea:**

```bash
# Check repository was created
curl http://localhost:3300/api/v1/orgs/cuemarshal/repos

# Check milestones were created
curl http://localhost:3300/api/v1/repos/cuemarshal/{project-name}/milestones

# Check issues were created
curl http://localhost:3300/api/v1/repos/cuemarshal/{project-name}/issues
```

**7. Verify Conductor picks up the work:**

```bash
# Check Conductor logs
docker logs cuemarshal-conductor --tail 50

# Should see:
# - "Repository created"
# - "Project plan generated"
# - "Project plan executed"
# - "Issue opened" webhook events
# - "Task analyze" jobs enqueued
```

**Expected Result:**
- Repository created: `cuemarshal/{project-name}`
- Workflows copied: `.gitea/workflows/task-execute.yml`, `code-review.yml`, `run-tests.yml`
- Milestones created with acceptance criteria
- Issues created with appropriate labels: `role:developer`, `complexity:standard`, etc.
- First issue automatically enters the task pipeline
- Conductor assigns issues to `cuemarshal-bot`
- Workflow runs begin automatically

---

## Feature 2: Self-Improvement Idle Detection

### Flow Diagram

```
Idle-Check (every 30min)
  → Queries Conductor readiness check
  → Conductor checks:
     1. BullMQ queues (tasks, reviews, workflows)
     2. Active projects with open issues  
     3. Budget availability
     4. Cooldown period
     5. Already running check
  → If ALL clear: trigger self-improvement
  → If ANY blocking: log reason and skip
```

### Testing Steps

**1. Ensure NO project tasks exist**

```bash
# List all open issues across all repos
curl -H "Authorization: token $(cat tokens/bot_token)" \
  http://localhost:3300/api/v1/repos/issues/search?state=open&type=issues

# Should return empty or only self-improvement issues
```

**2. Check runner status**

```bash
curl http://localhost:4000/api/internal/runners/status

# Expected output:
{
  "total_runners": 2,
  "active_runners": 0,
  "idle_runners": 2,
  "queue_depth": 0,
  "timestamp": "..."
}
```

**3. Trigger readiness check**

```bash
curl -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
  http://localhost:4000/api/internal/self-improve/check

# Expected output when ready:
{
  "ready": true,
  "reasons_blocking": [],
  "idle_ratio": 1.0,
  "budget_remaining": ...,
  "cooldown_remaining_minutes": 0
}

# Expected output when project tasks exist:
{
  "ready": false,
  "reasons_blocking": ["PROJECT_TASKS_PENDING"],
  ...
}
```

**4. Wait for automated trigger**

The `idle-check.yml` workflow runs every 30 minutes. When all conditions are met:
- Idle-check calls `/self-improve/check`
- If ready, calls `/self-improve/trigger`
- Conductor updates `.self-improve-trigger` file on main
- Self-improve workflow begins

**5. Verify self-improvement runs**

```bash
# Check self-improve workflow runs
curl http://localhost:3300/api/v1/repos/cuemarshal/cuemarshal/actions/runs

# Check Conductor logs
docker logs cuemarshal-conductor --tail 100 | grep "self-improve"

# Should see:
# - "Self-improvement readiness check passed"
# - "Trigger emitted"
# - "Workflow started"
```

**Expected Behavior:**
- Self-improvement ONLY runs when queues are empty
- Blocked when ANY active project has open issues
- Logs clear reason codes for all blocking conditions

---

## Feature 3: Project Tasks Preempt Self-Improvement

### Flow Diagram

```
[Self-improvement running]
  → New project issue created
  → Webhook → handleIssueOpened()
  → Detects non-self-improvement repo
  → Calls pauseForProjectWork()
  → Redis key set: self-improve:paused-for-project
  → Self-improvement readiness returns: PROJECT_TASKS_PENDING
  → Task pipeline begins for project issue
  → Project work continues...
  → Last issue PR merged → processPRMerge()
  → Calls checkAndResumeSelfImprovement()
  → Checks: queues empty + no open project issues
  → Calls resumeFromProjectWork()
  → Redis key deleted
  → Next idle-check cycle: self-improvement can proceed
```

### Testing Steps

**1. Set up a self-improvement cycle**

```bash
# Manually trigger self-improvement
curl -X POST -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
  http://localhost:4000/api/internal/self-improve/trigger

# Verify it's running
curl http://localhost:3300/api/v1/repos/cuemarshal/cuemarshal/actions/runs
```

**2. Create a project task WHILE self-improvement is running**

Via mobile app chat:
```
Create an issue: Add health check endpoint to the API
Repo: my-rest-api
```

OR via Gitea UI:
- Go to `http://localhost:3300/cuemarshal/my-project/issues`
- Click "New Issue"
- Title: "Add health check endpoint"
- Submit

**3. Verify automatic pause**

```bash
# Check Redis for pause key
docker exec cuemarshal-redis redis-cli GET self-improve:paused-for-project
# Should return: "true"

# Check Conductor logs
docker logs cuemarshal-conductor --tail 20

# Should see:
# - "Project task detected - self-improvement paused"
```

**4. Verify self-improvement is blocked**

```bash
curl -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
  http://localhost:4000/api/internal/self-improve/check

# Should return:
{
  "ready": false,
  "reasons_blocking": ["PROJECT_TASKS_PENDING"],
  ...
}
```

**5. Complete the project task**

Wait for the agent to:
- Create branch and PR
- Get code review approval
- Merge PR
- Close issue

OR manually close the issue in Gitea UI.

**6. Verify automatic resume**

```bash
# Check Conductor logs after PR merge
docker logs cuemarshal-conductor --tail 30

# Should see:
# - "PR merged and issue closed"
# - "Queues empty and no project tasks - self-improvement can resume"
# - "Self-improvement resumed after project work completion"

# Check Redis - key should be deleted
docker exec cuemarshal-redis redis-cli GET self-improve:paused-for-project
# Should return: (nil)
```

**7. Verify next self-improvement cycle runs**

Wait for the next idle-check cycle (every 30 min) or manually trigger:

```bash
curl -X POST -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
  http://localhost:4000/api/internal/self-improve/trigger

# Should succeed now that project work is complete
```

**Expected Behavior:**
- Project tasks immediately pause self-improvement
- Pause persists through entire project task lifecycle
- Resume is automatic when ALL conditions clear:
  - BullMQ queues empty (tasksQueue, reviewsQueue, workflowsQueue)
  - No active projects with open issues
  - Idle ratio ≥ 50%
- Self-improvement never interferes with project work

---

## Validation Checklist

### Feature 1: Project Submission
- [ ] Mobile chat connects to Conductor API
- [ ] Chat handler processes project creation requests
- [ ] project_create tool creates repository
- [ ] Workflows are initialized in new repo
- [ ] Project plan is generated with milestones and issues
- [ ] Plan is presented to user for approval
- [ ] project_approve creates milestones and issues in Gitea
- [ ] Issues automatically enter task pipeline
- [ ] Agents begin working on issues

### Feature 2: Idle Detection
- [ ] `/runners/status` returns real BullMQ metrics
- [ ] Idle check queries all three queues (tasks, reviews, workflows)
- [ ] hasOutstandingProjectTasks() checks active projects
- [ ] Self-improvement blocked when project tasks exist
- [ ] Self-improvement proceeds when truly idle
- [ ] Reason codes are clear and accurate

### Feature 3: Priority System
- [ ] New project issue triggers pauseForProjectWork()
- [ ] Redis key `self-improve:paused-for-project` is set
- [ ] Readiness check returns PROJECT_TASKS_PENDING
- [ ] Self-improvement does NOT trigger while paused
- [ ] PR merge triggers checkAndResumeSelfImprovement()
- [ ] Resume happens automatically when queues drain
- [ ] Self-improvement resumes in next cycle

---

## Database Migrations

Before testing, ensure migrations are applied:

```bash
cd conductor
npm run db:migrate

# Or manually:
psql $DATABASE_URL -f src/db/migrations/0002_add_projects_table.sql
```

Verify projects table exists:

```bash
psql $DATABASE_URL -c "\dt projects"
psql $DATABASE_URL -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'projects';"
```

---

## Architecture Notes

### Project Storage

Projects are stored in two places:
1. **Gitea** - Repository with workflows, code, issues, milestones
2. **Conductor DB** - `projects` table with plan, status, metadata

The `giteaRepo` field (`owner/repo`) links the two.

### Task Priority

Implicit priority through gate ordering:
1. Active runners (workflows currently executing)
2. Pending queue jobs (enqueued but not started)
3. Open issues in active projects
4. Self-improvement (only when 1-3 are all empty)

### Status Transitions

**Projects:**
```
planning → pending_approval → active → completed → archived
```

**Self-Improvement:**
```
ready → triggered → running → completed → cooldown
(paused-for-project can overlay at any time)
```

---

## Troubleshooting

### Project creation fails

Check:
1. Gitea is running: `curl http://localhost:3300/api/v1/version`
2. Conductor has valid token: `docker logs cuemarshal-conductor | grep "Gitea token"`
3. MCP servers are healthy: `curl http://localhost:4201/health`

### Self-improvement never triggers

Check:
1. Queue depths: `curl http://localhost:4000/api/internal/runners/status`
2. Active projects: `curl http://localhost:4000/api/projects`
3. Readiness check: `curl -H "Authorization: Bearer ${CONDUCTOR_SECRET}" http://localhost:4000/api/internal/self-improve/check`
4. Cooldown status: `docker exec cuemarshal-redis redis-cli TTL self-improvement:cooldown`

### Self-improvement runs despite project tasks

This indicates a bug. Check:
1. Conductor logs for "Project task detected" message
2. Redis for pause key: `docker exec cuemarshal-redis redis-cli GET self-improve:paused-for-project`
3. Projects table for active projects: `psql $DATABASE_URL -c "SELECT * FROM projects WHERE status = 'active';"`

---

## Success Criteria

All three features validated when:

1. **Project Submission Works:**
   - User submits project via mobile chat
   - Repository created with workflows
   - Plan generated and approved
   - Milestones and issues created
   - Agents begin work automatically

2. **Self-Improvement is Idle-Aware:**
   - Self-improvement does NOT run when queues have jobs
   - Self-improvement does NOT run when projects have open issues
   - Self-improvement DOES run when truly idle (queue empty + no project work)

3. **Priority System Functions:**
   - Creating a project task immediately pauses self-improvement
   - Self-improvement stays paused until ALL project work completes
   - Resume is automatic (no manual intervention needed)
   - Project work is never blocked by self-improvement

All logs should show clear reason codes for all gating decisions.
