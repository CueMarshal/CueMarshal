# Improvement Discovery Scanners

This directory contains deterministic scanners for the self-improvement discovery pipeline. These scanners analyze the codebase for improvement opportunities and produce structured JSON output that can be consumed by LLM-based prioritization.

## Overview

The scanner pipeline consists of:

1. **Individual Scanners**: Specialized scripts that detect specific types of improvements
2. **Orchestrator**: `run-all-scanners.sh` that runs all scanners and merges outputs
3. **Schema**: JSON schema defining the output format (`schema.json`)
4. **Configuration**: Tuning controls and suppression rules (`scanner-config.json`)

## Scanners

### 1. TODO Markers Scanner (`scan-todo-markers.sh`)

Scans for inline code comments indicating improvement opportunities.

**Detected Markers**:
- `FIXME` - Known bugs or issues (high severity)
- `HACK` - Technical debt or workarounds (high severity)
- `BUG` - Known bugs (high severity)
- `XXX` - Needs attention (medium severity)
- `TODO` - Missing functionality (medium severity)
- `WORKAROUND` - Temporary solutions (medium severity)
- `DEPRECATED` - Code marked for removal (medium severity)
- `OPTIMIZE` - Performance improvements (low severity)

### 2. Dependency Updates Scanner (`scan-dependency-updates.sh`)

Scans for outdated dependencies in package managers (npm, pip).

### 3. Test Coverage Scanner (`scan-test-coverage.sh`)

Identifies source files without corresponding test files.

### 4. Stale Documentation Scanner (`scan-stale-docs.sh`)

Detects missing README files in code directories.

## Usage

```bash
# From repository root
bash scripts/scanners/run-all-scanners.sh
```

Output is written to `improvement-findings.json` by default.

## Workflow Integration

The scanners are integrated into `.gitea/workflows/self-improve.yml`:

1. **Scan Phase**: Run `run-all-scanners.sh` to generate `improvement-findings.json`
2. **Prioritization Phase**: LLM consumes findings and creates Gitea issues
