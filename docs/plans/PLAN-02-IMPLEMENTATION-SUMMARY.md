# PLAN-02 Implementation Summary: Gitea 1.22 Push-Trigger Standardization

## Implementation Date

2026-02-22 (v2, on main with Wave 1)

## Status

✅ **COMPLETED**

## Overview

Successfully migrated self-improvement workflow triggering from `workflow_dispatch` API to a push-based sentinel file mechanism for Gitea 1.22 compatibility. This implementation builds on main with Wave 1 (PLAN-04, 06, 08, 09) merged.

## Changes Implemented

### 1. Trigger Contract Definition ✅

**Sentinel File**: `.self-improve-trigger`  
**Trigger Branch**: `main`  
**Trigger Event**: Push to sentinel file on main branch

**Payload Schema**:

```
triggered_at: <ISO 8601 timestamp>
source: <trigger source>
reason: <human-readable reason>
cooldown_until: <ISO 8601 timestamp>
```

### 2. Conductor Service Updates ✅

#### `services/conductor/src/services/workflow-trigger.ts`

- Added `triggerSelfImprovement()` method for push-based triggering
- Implemented in-memory cooldown tracker to prevent trigger loops
- Added `isSelfImprovementInCooldown()` helper method
- Integrated with existing `giteaClient.createOrUpdateFile()` API
- Includes metadata payload in trigger file commits

**Key Features**:

- Cooldown enforcement (configurable via `SELF_IMPROVE_COOLDOWN_HOURS`)
- Force override option for manual interventions
- Idempotent trigger behavior
- Detailed logging for audit trail

#### `services/conductor/src/services/self-improvement.ts`

- Migrated from `giteaClient.dispatchWorkflow()` to `workflowTrigger.triggerSelfImprovement()`
- Removed dependency on workflow dispatch API
- Updated method signature to support source, reason, and force parameters
- Returns trigger result status with message

#### `services/conductor/src/api/internal.ts`

- Added internal API endpoint: `POST /api/internal/self-improvement/trigger`
- Bearer token authentication using `CONDUCTOR_SECRET`
- Accepts `source`, `reason`, and `force` parameters
- Returns trigger status and message

### 3. Workflow Updates ✅

#### `.gitea/workflows/idle-check.yml`

Created workflow merging PLAN-06 auth with PLAN-02 trigger logic:

- **PLAN-06 auth**: CONDUCTOR_SECRET for Conductor API, 401/error handling for idle-count
- **PLAN-02 trigger**: Calls Conductor `POST /api/internal/self-improvement/trigger` instead of workflow_dispatch

**Before** (workflow_dispatch):

```bash
curl -sf -X POST \
  -H "Authorization: token ${GITEA_TOKEN}" \
  "${GITEA_URL}/api/v1/repos/.../actions/workflows/self-improve.yml/dispatches" \
  -d '{"ref": "main"}'
```

**After** (Conductor API):

```bash
curl -sf -X POST \
  -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
  "${CONDUCTOR_URL}/api/internal/self-improvement/trigger" \
  -d '{"source": "idle-check", "reason": "idle runners detected"}'
```

#### `workflows/idle-check.yml`

Created template mirror of `.gitea/workflows/idle-check.yml`.

### 4. Documentation Updates ✅

#### `docs/operations/self-improvement.md`

Added comprehensive "Push-Based Trigger Contract" section covering:

- Overview and trigger mechanism
- Trigger payload schema with field definitions
- Cooldown and safety mechanisms
- Conductor internal API documentation
- Usage examples from idle-check workflow
- Benefits of push-based triggering

#### `docs/features/workflows/overview.md`

Updated workflow documentation:

- Added note about push-based triggering for `idle-check.yml`
- Updated `self-improve.yml` section with trigger mechanism details
- Added env vars and Conductor API call to idle-check example

#### `docs/plans/PLAN-02-IMPLEMENTATION-SUMMARY.md`

Created this implementation summary.

## Files Modified

### Conductor Services

- `services/conductor/src/services/workflow-trigger.ts` - Added push-based trigger mechanism
- `services/conductor/src/services/self-improvement.ts` - Migrated to push-based triggering
- `services/conductor/src/api/internal.ts` - Added trigger API endpoint

### Workflows

- `.gitea/workflows/idle-check.yml` - Created (PLAN-06 auth + PLAN-02 trigger)
- `workflows/idle-check.yml` - Created template

### Documentation

- `docs/operations/self-improvement.md` - Added trigger contract section
- `docs/features/workflows/overview.md` - Updated workflow triggering documentation
- `docs/plans/PLAN-02-IMPLEMENTATION-SUMMARY.md` - Created

## Configuration

### Environment Variables

Uses existing configuration:

| Variable | Default | Usage |
|----------|---------|-------|
| `SELF_IMPROVE_COOLDOWN_HOURS` | `4` | Cooldown period between triggers |
| `CONDUCTOR_SECRET` | (required) | Authentication for internal API |
| `CONDUCTOR_ORG` | `cuemarshal` | Organization for triggers |
| `CONDUCTOR_REPO` | `cuemarshal` | Repository for triggers |

## Related Plans

- **PLAN-04**: Gitea Label Resolution Contract (Wave 1)
- **PLAN-06**: Internal API Auth and Runner Status (Wave 1)
- **PLAN-08**, **PLAN-09**: Wave 1
- **PLAN-11**: Self-Improvement Troubleshooting Runbook

## Conclusion

PLAN-02 successfully standardized self-improvement triggering on push-based sentinels, eliminating dependency on the Gitea `workflow_dispatch` API. The idle-check workflow uses Conductor internal API with PLAN-06 auth (Bearer token, error handling) and PLAN-02 trigger logic (push-based sentinel file).
