# Self-Improvement Troubleshooting Runbook

## Overview

This runbook provides a systematic approach to diagnosing and resolving self-improvement cycle failures. The self-improvement system operates across multiple boundaries, and failures can occur at any point in the pipeline.

**Primary Goal**: Quickly isolate failures to a specific boundary and provide actionable remediation steps.

**Target Audience**: On-call engineers, operators, and maintainers who need to diagnose issues without deep code knowledge.

## Quick Reference

### Self-Improvement Boundaries

The self-improvement cycle flows through these boundaries:

1. **Schedule Fired** - Cron trigger activates
2. **Trigger Emitted** - Conductor triggers workflow via Gitea API
3. **Workflow Started** - Gitea Actions runner picks up workflow
4. **OpenCode Executed** - Agent analyzes codebase
5. **MCP Tool Called** - Agent calls `gitea_create_issue` tool
6. **Issue Created** - Issue appears in Gitea with expected labels

### Correlation ID System

Every self-improvement run generates a unique correlation ID with format: `si-{timestamp}-{uuid}`

Example: `si-1709251234567-a1b2c3d4-e5f6-7890-abcd-ef1234567890`

This ID is propagated across all boundaries and included in structured logs for end-to-end tracing.

## Diagnostic Decision Tree

```
Self-Improvement Failed or Appears Stuck
│
├─ Step 1: Did schedule fire?
│  ├─ NO  → Check cron schedule, Gitea Actions enabled
│  └─ YES → Go to Step 2
│
├─ Step 2: Was trigger emitted?
│  ├─ NO  → Check Conductor health, budget, pause status
│  └─ YES → Go to Step 3
│
├─ Step 3: Did workflow start?
│  ├─ NO  → Check runner availability, workflow file
│  └─ YES → Go to Step 4
│
├─ Step 4: Did OpenCode execute?
│  ├─ NO  → Check OpenCode installation, agent config
│  └─ YES → Go to Step 5
│
├─ Step 5: Were MCP tools called?
│  ├─ NO  → Check MCP server connectivity, auth
│  └─ YES → Go to Step 6
│
└─ Step 6: Were issues created with labels?
   ├─ NO  → Check label IDs, permissions
   └─ YES → Success! Investigate why issues weren't actionable
```

## Boundary-by-Boundary Diagnostics

### Boundary 1: Schedule Fired

**What happens**: Gitea Actions cron schedule triggers the self-improvement workflow.

**Expected behavior**: Every 30 minutes, the workflow is triggered automatically.

#### Check 1.1: Verify Cron Schedule

```bash
# Check workflow file for cron schedule
cat .gitea/workflows/self-improve.yml | grep -A 2 "schedule:"

# Expected output:
#   schedule:
#     - cron: "*/30 * * * *"
```

#### Check 1.2: Verify Gitea Actions is Enabled

```bash
# Check recent workflow runs
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs?limit=5" \
  -H "Authorization: token ${GITEA_TOKEN}" | jq .

# Expected: Recent runs within last 30 minutes
```

#### Check 1.3: Query Conductor Logs for Schedule Event

```bash
# Search Conductor logs for schedule fired event
docker logs conductor 2>&1 | grep "self_improve.schedule_fired" | tail -5

# Expected output (JSON):
# {
#   "event": "self_improve.schedule_fired",
#   "timestamp": "2024-03-01T12:00:00.000Z",
#   "correlationId": "si-1709251234567-...",
#   "hasBudget": true,
#   "monthlyBudget": 100,
#   "selfImproveBudget": 10,
#   "spent": 2.5
# }
```

**Failure Signatures**:

- **No workflow runs**: Gitea Actions not enabled or cron schedule misconfigured
- **No schedule_fired log**: Conductor not running or scheduler not initialized
- **hasBudget: false**: Monthly self-improvement budget exhausted

**Remediation**:

1. Verify Gitea Actions is enabled in repository settings
2. Check Conductor is running: `docker ps | grep conductor`
3. If budget exhausted, check if spend is legitimate or increase budget:
   ```bash
   # Increase budget in .env
   SELF_IMPROVE_BUDGET_PCT=20  # Increase from 10% to 20%
   docker-compose restart conductor
   ```

---

### Boundary 2: Trigger Emitted

**What happens**: Conductor writes the `.self-improve-trigger` sentinel file (via Gitea API), which triggers the workflow on push.

**Expected behavior**: Conductor emits a workflow trigger with correlation ID and configuration.

#### Check 2.1: Verify Trigger Event in Conductor Logs

```bash
# Search for trigger emitted event
docker logs conductor 2>&1 | grep "self_improve.trigger_emitted" | tail -5

# Expected output:
# {
#   "event": "self_improve.trigger_emitted",
#   "timestamp": "2024-03-01T12:00:05.000Z",
#   "correlationId": "si-1709251234567-...",
#   "owner": "cuemarshal",
#   "repo": "cuemarshal",
#   "workflow": "self-improve.yml",
#   "maxImprovements": 3,
#   "testMode": false
# }
```

#### Check 2.2: Check if Self-Improvement is Paused

```bash
# Search for auto-pause events
docker logs conductor 2>&1 | grep "self_improve.auto_paused"

# If found, check failure threshold logs
docker logs conductor 2>&1 | grep "self_improve.threshold_exceeded" | tail -1

# Expected output (if paused):
# {
#   "event": "self_improve.threshold_exceeded",
#   "timestamp": "2024-03-01T11:30:00.000Z",
#   "correlationId": "si-...",
#   "failureCount": 3,
#   "threshold": 3,
#   "windowHours": 24,
#   "recentFailures": [...]
# }
```

#### Check 2.3: Verify Gitea API Connectivity

```bash
# Test Gitea API authentication
curl -X GET \
  "${GITEA_URL}/api/v1/user" \
  -H "Authorization: token ${GITEA_TOKEN}"

# Expected: User info JSON (200 OK)
```

**Failure Signatures**:

- **No trigger_emitted log**: Conductor failed to call Gitea API
- **auto_paused event present**: Self-improvement paused due to repeated failures
- **Gitea API returns 401**: Invalid GITEA_TOKEN
- **Gitea API returns 404**: Repository not found or workflow file missing

**Remediation**:

1. If paused, manually resume after fixing root cause:
   ```bash
   # Resume via Conductor API
    curl -X POST "${CONDUCTOR_URL}/api/internal/self-improve/resume" \
     -H "Authorization: Bearer ${CONDUCTOR_SECRET}"
   ```

2. If API auth failed, verify token:
   ```bash
   # Check token in Conductor config
   docker exec conductor printenv GITEA_TOKEN
   ```

3. If workflow file missing, verify it exists:
   ```bash
   ls -la .gitea/workflows/self-improve.yml
   ```

---

### Boundary 3: Workflow Started

**What happens**: Gitea Actions runner picks up the workflow and begins execution.

**Expected behavior**: Workflow starts within seconds of trigger, logs appear in Gitea Actions UI.

#### Check 3.1: Verify Workflow Run Started

```bash
# Get latest workflow runs
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs?limit=1" \
  -H "Authorization: token ${GITEA_TOKEN}" | jq '.workflow_runs[0]'

# Expected fields:
# - status: "running" or "completed"
# - created_at: recent timestamp
# - workflow_id: matching self-improve.yml
```

#### Check 3.2: Check Workflow Logs for Start Event

```bash
# View workflow run logs (replace RUN_ID with actual run ID)
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/logs" \
  -H "Authorization: token ${GITEA_TOKEN}"

# Expected: Contains "Self-Improvement Workflow Started" group
# With event=self_improve.workflow_started and correlationId
```

#### Check 3.3: Verify Runner Availability

```bash
# Check runner registration
docker ps | grep runner

# Check runner logs
docker logs runner 2>&1 | tail -20

# Expected: Runner polling for jobs, no error messages
```

**Failure Signatures**:

- **No workflow run created**: Trigger failed or workflow file invalid
- **Workflow queued but not running**: No available runners
- **Workflow failed immediately**: Syntax error in workflow file

**Remediation**:

1. If no runners available:
   ```bash
   # Check runner status
   docker-compose ps runner
   
   # Restart runner if needed
   docker-compose restart runner
   
   # Re-register runner if necessary
   ./scripts/register-runners.sh
   ```

2. If workflow syntax error, validate YAML:
   ```bash
   # Use yamllint or similar
   yamllint .gitea/workflows/self-improve.yml
   ```

---

### Boundary 4: OpenCode Executed

**What happens**: The workflow step executes the OpenCode agent to analyze the codebase.

**Expected behavior**: OpenCode runs, agent analyzes code, attempts to create issues via MCP.

#### Check 4.1: Verify OpenCode Execution Log

```bash
# Check workflow logs for OpenCode execution
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/logs" \
  -H "Authorization: token ${GITEA_TOKEN}" | grep "opencode_executed"

# Expected:
# event=self_improve.opencode_executed
# correlationId=si-...
# max_improvements=3
```

#### Check 4.2: Verify OpenCode is Installed in Runner

```bash
# Exec into runner container
docker exec -it runner sh

# Check OpenCode installation
which opencode
opencode --version

# Expected: OpenCode binary found and version displayed
```

#### Check 4.3: Check Agent Configuration

```bash
# Verify agent config is copied correctly
docker exec -it runner ls -la /agents/developer/

# Expected files:
# - opencode.json
# - .opencode/agents/developer.md
```

**Failure Signatures**:

- **OpenCode command not found**: OpenCode not installed in runner image
- **Agent config missing**: `/agents/developer/` directory not mounted
- **OpenCode timeout**: Analysis taking longer than workflow timeout (30 min)
- **Model API error**: Gateway unreachable or API key invalid

**Remediation**:

1. If OpenCode not installed, rebuild runner image:
   ```bash
   cd services/runner/
   docker build -t runner:latest .
   docker-compose up -d runner
   ```

2. If agent config missing, verify volume mount:
   ```bash
   # Check docker-compose.yml for agent volume
   grep -A 5 "volumes:" docker-compose.yml | grep agents
   
   # Expected:
   # - ./agents:/agents:ro
   ```

3. If model API error, check gateway:
   ```bash
   # Test gateway health
   curl http://gateway:4100/health
   
   # Check API key
   docker exec runner printenv OPENAI_API_KEY
   ```

---

### Boundary 5: MCP Tool Called

**What happens**: OpenCode agent calls the `gitea_create_issue` MCP tool to create issues.

**Expected behavior**: MCP server receives tool call, authenticates, calls Gitea API.

#### Check 5.1: Verify MCP Tool Call in MCP Server Logs

```bash
# Search gitea-mcp logs for tool calls
docker logs gitea-mcp 2>&1 | grep "mcp_tool_called" | grep -A 5 "gitea_create_issue"

# Expected output:
# {
#   "event": "self_improve.mcp_tool_called",
#   "timestamp": "2024-03-01T12:05:00.000Z",
#   "correlationId": "si-...",
#   "tool": "gitea_create_issue",
#   "owner": "cuemarshal",
#   "repo": "cuemarshal",
#   "title": "...",
#   "hasLabels": true,
#   "labelCount": 3
# }
```

#### Check 5.2: Verify MCP Server Connectivity

```bash
# Test MCP server health
curl http://gitea-mcp:4201/health

# Expected: 200 OK with health status
```

#### Check 5.3: Check MCP Server Authentication

```bash
# Verify MCP server has valid Gitea token
docker exec gitea-mcp printenv GITEA_TOKEN

# Test auth by calling Gitea API from MCP server
docker exec gitea-mcp curl -X GET \
  "${GITEA_URL}/api/v1/user" \
  -H "Authorization: token ${GITEA_TOKEN}"

# Expected: User info JSON
```

**Failure Signatures**:

- **No mcp_tool_called logs**: Agent not calling MCP tools (likely prompt issue)
- **MCP server unreachable**: Network issue or container not running
- **MCP auth failed**: Invalid GITEA_TOKEN in MCP server config
- **Tool call timeout**: MCP server slow or Gitea API slow

**Remediation**:

1. If MCP server not running:
   ```bash
   docker-compose ps gitea-mcp
   docker-compose up -d gitea-mcp
   ```

2. If auth failed, verify token:
   ```bash
   # Update token in .env
   GITEA_TOKEN=your-valid-token
   docker-compose restart gitea-mcp
   ```

3. If agent not calling tools, check agent prompt:
   ```bash
   # Review developer agent instructions
   cat services/agents/developer/.opencode/agents/developer.md
   
   # Ensure it mentions using MCP tools
   ```

---

### Boundary 6: Issue Created with Labels

**What happens**: Gitea creates the issue with title, body, and labels.

**Expected behavior**: Issue appears in repository with `self-improvement` label and role/complexity labels.

#### Check 6.1: Verify Issue Created Event

```bash
# Search gitea-mcp logs for issue creation
docker logs gitea-mcp 2>&1 | grep "issue_created" | tail -5

# Expected output:
# {
#   "event": "self_improve.issue_created",
#   "timestamp": "2024-03-01T12:05:10.000Z",
#   "correlationId": "si-...",
#   "issueNumber": 42,
#   "issueTitle": "Improve error handling in...",
#   "labels": ["self-improvement", "role:developer", "complexity:simple"]
# }
```

#### Check 6.2: Query Gitea for Created Issues

```bash
# Get recent issues with self-improvement label
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/issues?state=open&labels=self-improvement&limit=5" \
  -H "Authorization: token ${GITEA_TOKEN}" | jq '.[] | {number, title, labels: [.labels[].name]}'

# Expected: Recent issues with self-improvement label
```

#### Check 6.3: Verify Labels Exist in Repository

```bash
# List all labels in repository
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/labels" \
  -H "Authorization: token ${GITEA_TOKEN}" | jq '.[] | {id, name}'

# Expected labels:
# - self-improvement
# - role:developer, role:tester, role:docs
# - complexity:simple, complexity:standard, complexity:complex
```

**Failure Signatures**:

- **Issue created without labels**: Label IDs incorrect or labels not found
- **Issue created in wrong repository**: Repository name misconfigured
- **No issue created**: Gitea API error or permission denied
- **Labels: []**: Agent not providing label IDs or using label names instead of IDs

**Remediation**:

1. If labels missing, seed repository labels:
   ```bash
   ./scripts/seed-labels.sh ${OWNER} ${REPO}
   ```

2. If using label names instead of IDs, agent needs label ID mapping:
   ```bash
   # Get label IDs
   curl -X GET \
     "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/labels" \
     -H "Authorization: token ${GITEA_TOKEN}" | jq '.[] | {name, id}'
   
   # Update agent instructions to use IDs
   ```

3. If permission denied, verify bot user has write access:
   ```bash
   # Check repository collaborators
   curl -X GET \
     "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/collaborators" \
     -H "Authorization: token ${GITEA_TOKEN}"
   ```

---

## Test Mode

For debugging, enable test mode to create a single test issue without labels:

```bash
# Set test mode in Conductor config
SELF_IMPROVE_TEST_MODE=true

# Restart Conductor
docker-compose restart conductor

# Manually trigger self-improvement
curl -X POST "${CONDUCTOR_URL}/api/internal/self-improvement/trigger" \
   -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
   -H "Content-Type: application/json" \
   -d '{"owner": "'"${OWNER}"'", "repo": "'"${REPO}"'"}'

# Monitor logs for correlation ID
docker logs -f conductor | grep "correlation"

# Verify test issue created
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/issues?state=open&limit=1" \
  -H "Authorization: token ${GITEA_TOKEN}" | jq '.[0] | {number, title}'

# Expected: Issue with title containing "[TEST]" and correlation ID
```

**Test Mode Progression**:

1. **Phase 1**: Test mode ON - Verify one issue created without labels
2. **Phase 2**: Test mode OFF, manual labels - Create issue with hardcoded label IDs
3. **Phase 3**: Full production - Agent determines appropriate labels

---

## Failure Threshold and Auto-Pause

The system automatically pauses self-improvement after repeated failures to prevent noisy alerts.

### Configuration

```bash
# Set in .env or environment variables
SELF_IMPROVE_FAILURE_THRESHOLD=3        # Number of failures before pause
SELF_IMPROVE_FAILURE_WINDOW_HOURS=24   # Time window for counting failures
```

### Check Pause Status

```bash
# Check if currently paused
docker logs conductor 2>&1 | grep "auto_paused" | tail -1

# If paused, check recent failures
docker logs conductor 2>&1 | grep "cycle_failed" | tail -5
```

### Resume After Pause

```bash
# After fixing root cause, manually resume
curl -X POST "${CONDUCTOR_URL}/api/internal/self-improve/resume" \
  -H "Authorization: Bearer ${CONDUCTOR_SECRET}"

# Verify resumed
docker logs conductor 2>&1 | grep "manually resumed" | tail -1
```

---

## Log Query Examples

### Find All Events for a Correlation ID

```bash
CORR_ID="si-1709251234567-..."

# Search Conductor logs
docker logs conductor 2>&1 | grep "$CORR_ID"

# Search workflow logs (requires run ID)
curl -X GET \
  "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/logs" \
  -H "Authorization: token ${GITEA_TOKEN}" | grep "$CORR_ID"

# Search MCP server logs
docker logs gitea-mcp 2>&1 | grep "$CORR_ID"
```

### Get Recent Correlation IDs

```bash
# Get last 10 correlation IDs from Conductor
docker logs conductor 2>&1 | grep "correlationId" | jq -r .correlationId | tail -10
```

### Trace a Full Cycle

```bash
CORR_ID="si-1709251234567-..."

echo "=== Schedule Fired ==="
docker logs conductor 2>&1 | grep "$CORR_ID" | grep "schedule_fired"

echo "=== Trigger Emitted ==="
docker logs conductor 2>&1 | grep "$CORR_ID" | grep "trigger_emitted"

echo "=== Workflow Started ==="
# Get run ID from Gitea API first, then:
curl -X GET "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/logs" \
  -H "Authorization: token ${GITEA_TOKEN}" | grep "$CORR_ID" | grep "workflow_started"

echo "=== OpenCode Executed ==="
curl -X GET "${GITEA_URL}/api/v1/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/logs" \
  -H "Authorization: token ${GITEA_TOKEN}" | grep "$CORR_ID" | grep "opencode_executed"

echo "=== MCP Tool Called ==="
docker logs gitea-mcp 2>&1 | grep "$CORR_ID" | grep "mcp_tool_called"

echo "=== Issue Created ==="
docker logs gitea-mcp 2>&1 | grep "$CORR_ID" | grep "issue_created"
```

---

## Common Failure Scenarios

### Scenario 1: No Issues Created

**Symptoms**: Workflow runs successfully but no issues appear.

**Diagnosis**:
1. Check if OpenCode executed (Boundary 4)
2. Check if MCP tools called (Boundary 5)
3. If tools called but no issues, check Gitea API errors

**Common Causes**:
- Agent prompt doesn't instruct to create issues
- MCP server auth failed
- Gitea API permission denied
- Agent decided no improvements needed

### Scenario 2: Issues Created Without Labels

**Symptoms**: Issues appear but missing `self-improvement` or role labels.

**Diagnosis**:
1. Check issue_created event logs for label list
2. Verify labels exist in repository
3. Check if agent is using label names vs. IDs

**Common Causes**:
- Labels not seeded in repository
- Agent using label names instead of numeric IDs
- Test mode enabled (intentionally creates issues without labels)

### Scenario 3: Workflow Timeout

**Symptoms**: Workflow runs for 30 minutes then times out.

**Diagnosis**:
1. Check which step is slow in workflow logs
2. If OpenCode step, check model API latency
3. If MCP calls slow, check Gitea API latency

**Common Causes**:
- Gateway API slow or rate-limited
- Codebase very large, agent analysis taking too long
- Network connectivity issues to external services

### Scenario 4: Self-Improvement Paused

**Symptoms**: No new workflow runs, auto_paused event in logs.

**Diagnosis**:
1. Check failure count and threshold
2. Review recent failure reasons
3. Fix root cause before resuming

**Common Causes**:
- Budget exhausted repeatedly
- MCP server repeatedly down
- Gitea API repeatedly failing
- Agent consistently erroring

---

## Health Checks

### Pre-Flight Health Check

Run before investigating failures:

```bash
#!/bin/bash
set -e

echo "=== Conductor Health ==="
docker ps | grep conductor
curl -s http://conductor:4000/health || echo "FAIL: Conductor unreachable"

echo "=== Gitea Health ==="
curl -s "${GITEA_URL}/api/v1/version" || echo "FAIL: Gitea unreachable"

echo "=== MCP Servers Health ==="
docker ps | grep mcp
curl -s http://gitea-mcp:4201/health || echo "FAIL: gitea-mcp unreachable"

echo "=== Runner Health ==="
docker ps | grep runner
docker exec runner opencode --version || echo "FAIL: OpenCode not installed"

echo "=== Gateway Health ==="
curl -s http://gateway:4100/health || echo "FAIL: Gateway unreachable"

echo "=== Pause Status ==="
docker logs conductor 2>&1 | grep "auto_paused" | tail -1 || echo "INFO: Not paused"

echo "=== Recent Failures ==="
docker logs conductor 2>&1 | grep "cycle_failed" | tail -3 || echo "INFO: No recent failures"

echo "=== Health check complete ==="
```

---

## Escalation

If issue cannot be resolved using this runbook:

1. **Gather Context**:
   - Correlation ID of failed run
   - Boundary where failure occurred
   - Relevant log excerpts
   - Configuration values (sanitized)

2. **Create Debug Package**:
   ```bash
   CORR_ID="si-..."
   DEBUG_DIR="debug-$CORR_ID"
   mkdir -p "$DEBUG_DIR"
   
   # Collect logs
   docker logs conductor 2>&1 | grep "$CORR_ID" > "$DEBUG_DIR/conductor.log"
   docker logs gitea-mcp 2>&1 | grep "$CORR_ID" > "$DEBUG_DIR/gitea-mcp.log"
   docker logs runner 2>&1 > "$DEBUG_DIR/runner.log"
   
   # Collect config (sanitize secrets!)
   env | grep SELF_IMPROVE > "$DEBUG_DIR/config.txt"
   
   # Create tarball
   tar -czf "debug-$CORR_ID.tar.gz" "$DEBUG_DIR"
   ```

3. **File Issue**:
   - Create Gitea issue with `troubleshooting` label
   - Attach debug package
   - Include boundary diagnosis results

---

## Appendix: Log Event Schema

### Standard Event Fields

All self-improvement events include:

```json
{
  "event": "self_improve.<event_type>",
  "timestamp": "ISO 8601 timestamp",
  "correlationId": "si-{timestamp}-{uuid}",
  "...additional fields..."
}
```

### Event Types

- `schedule_fired`: Cron triggered
- `trigger_emitted`: Workflow triggered via Gitea API
- `workflow_started`: Workflow execution began
- `opencode_executed`: OpenCode agent started analysis
- `mcp_tool_called`: MCP tool invoked
- `issue_created`: Issue successfully created
- `cycle_completed`: Full cycle completed
- `cycle_failed`: Cycle failed with reason
- `threshold_exceeded`: Failure threshold reached
- `auto_paused`: Self-improvement paused

---

## Appendix: Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SELF_IMPROVE_BUDGET_PCT` | `10` | % of monthly budget for self-improvement |
| `SELF_IMPROVE_MAX_PER_CYCLE` | `3` | Max issues per cycle |
| `SELF_IMPROVE_COOLDOWN_HOURS` | `4` | Hours between cycles |
| `SELF_IMPROVE_FAILURE_THRESHOLD` | `3` | Failures before auto-pause |
| `SELF_IMPROVE_FAILURE_WINDOW_HOURS` | `24` | Window for counting failures |
| `SELF_IMPROVE_TEST_MODE` | `false` | Enable test mode |
| `SELF_IMPROVE_PROTECTED_PATHS` | `services/conductor/,services/gateway/,...` | Paths requiring human review |

---

**Document Version**: 1.0  
**Last Updated**: 2024-03-01  
**Maintainer**: CueMarshal DevOps Team
