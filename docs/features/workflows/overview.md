# Gitea Workflows

## Overview

Gitea Actions workflows define the execution templates for all automated tasks. They are GitHub Actions-compatible YAML files stored in each repository's `.gitea/workflows/` directory. The Conductor triggers these workflows by pushing sentinel files (for example `.task.json` and `.review-trigger`) to feature branches.

## Workflow Templates

The following workflow templates are maintained in the `workflows/` directory of the CueMarshal repository and copied into managed repositories during setup.

### task-execute.yml

Primary workflow for executing tasks. Triggered by a **push** to a feature branch containing `.task.json`.

**Trigger:**
- Branch: `feat/issue-*` or `fix/issue-*`
- Path: `.task.json`

**Task config (.task.json):**
```json
{
  "issue_number": "42",
  "agent_role": "developer",
  "model_tier": "tier2",
  "branch_name": "feat/issue-42"
}
**Key behavior:**
- Maps `model_tier` to `MODEL_ID` (`tier1` → `gpt-4o-mini`, `tier2` → `gpt-4o`, `tier3` → `gpt-4.1`).
- Uses role-specific secrets (`SCM_TOKEN_DEVELOPER`, etc.) with fallback to `SCM_TOKEN`.
- Runs OpenCode with `--model "litellm/${MODEL_ID}"`.
- Optionally runs a linter agent if `/agents/linter/opencode.json` exists.
- Writes `.review-trigger` to the same branch to start code review.

### code-review.yml

Automated code review workflow triggered by a `.review-trigger` file on a feature branch.

**Trigger:**
- Branch: `feat/issue-*` or `fix/issue-*`
- Path: `.review-trigger`

**Key behavior:**
- Loads reviewer agent profile.
- Reads `.review-trigger` JSON for PR metadata (or infers from branch).
- Fetches PR diff and runs OpenCode review.
- Uses `gitea_create_review` MCP tool to submit the review.
- Removes `.review-trigger` after completion.

### run-tests.yml

Test execution workflow triggered by a `.test-trigger` file on a feature branch.

**Trigger:**
- Branch: `feat/issue-*` or `fix/issue-*`
- Path: `.test-trigger`

**Key behavior:**
- Loads tester agent profile.
- Reads `.test-trigger` JSON for issue number and test preferences.
- Runs `npm ci && npm test` when a `package.json` is present.
- Removes `.test-trigger` after completion.

### self-improve.yml

Scheduled workflow for self-improvement. See [../operations/self-improvement.md](../operations/self-improvement.md) for full details. Triggered via Gitea `workflow_dispatch` API (zero commits on `main`).

**Trigger:**
- Schedule: `0 */8 * * *` (fallback)
- `workflow_dispatch` with `correlation_id` input (primary, via Conductor)

**Key behavior:**
- Runs deterministic scanners via `scripts/scanners/run-all-scanners.sh`.
- Generates `improvement-findings.json`.
- Uses `opencode-selfimprove.json` to select and open up to 3 improvement issues.
- Uses role-specific SCM tokens with fallback to `SCM_TOKEN`.

### idle-check.yml

Lightweight workflow that checks readiness and triggers self-improvement through Conductor internal APIs. See [../operations/self-improvement.md](../operations/self-improvement.md#push-based-trigger-contract).

```yaml
name: Idle Check

on:
  schedule:
    - cron: "*/30 * * * *"

env:
  CONDUCTOR_URL: ${{ secrets.CONDUCTOR_URL }}
  CONDUCTOR_SECRET: ${{ secrets.CONDUCTOR_SECRET }}

jobs:
  check:
    runs-on: [self-hosted]
    timeout-minutes: 5
    steps:
      - name: Check and trigger self-improvement via Conductor
        run: |
          OWNER=$(echo "${{ github.repository }}" | cut -d'/' -f1)
          REPO=$(echo "${{ github.repository }}" | cut -d'/' -f2)

          READINESS=$(curl -sf -X POST \
            -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
            -H "Content-Type: application/json" \
            "${CONDUCTOR_URL}/api/internal/self-improve/check" \
            -d "{\"owner\": \"${OWNER}\", \"repo\": \"${REPO}\"}")

          READY=$(echo "${READINESS}" | jq -r '.ready')
          if [ "${READY}" = "true" ]; then
            curl -sf -X POST \
              -H "Authorization: Bearer ${CONDUCTOR_SECRET}" \
              -H "Content-Type: application/json" \
              "${CONDUCTOR_URL}/api/internal/self-improve/trigger" \
              -d "{\"owner\": \"${OWNER}\", \"repo\": \"${REPO}\"}"
          fi

## Workflow Triggering

The Conductor triggers workflows using a combination of sentinel file pushes and the Gitea `workflow_dispatch` API:

- `.task.json` on a feature branch triggers `task-execute.yml`.
- `.review-trigger` on the same branch triggers `code-review.yml`.
- `.test-trigger` on the same branch triggers `run-tests.yml`.
- `workflow_dispatch` API triggers `self-improve.yml` (no commits on `main`).

## Runner Labels

Workflows use `runs-on` labels to target appropriate runners:

| Label | Description |
|-------|-------------|
| `self-hosted` | Any self-hosted runner |
| `opencode` | Runner with OpenCode and MCP servers installed |
| `lightweight` | Runner for quick tasks (idle checks, API calls) |

## Workflow Placement

Workflows are placed in each managed repository's `.gitea/workflows/` directory. The `scripts/setup.sh` script copies templates from the `workflows/` directory during repository initialization.
