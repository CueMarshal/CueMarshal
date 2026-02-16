# Bug Fix: Scanner Exit Code Handling

**Date:** 2026-02-16  
**Issue:** Incorrect error message for scanner failures  
**Status:** ✅ **FIXED**

---

## Bug Description

### The Problem

The error handler in the self-improvement workflow treated **all non-zero exit codes** from the scanner script as timeouts, displaying the misleading message:

```
ERROR: Scanners timed out after 10 minutes
```

This message would appear even when the scanner failed for completely different reasons:

- Missing dependencies (jq, curl, npm not installed)
- Permission errors
- Invalid configuration
- Script syntax errors
- Network failures

This made troubleshooting extremely difficult because developers would focus on timeout issues when the real problem was elsewhere.

### Code Location

**Files affected:**

- `.gitea/workflows/self-improve.yml` lines 65-68
- `workflows/self-improve.yml` lines 58-61

**Original code:**

```yaml
timeout 10m bash scripts/scanners/run-all-scanners.sh || {
  echo "ERROR: Scanners timed out after 10 minutes"
  exit 1
}
```

---

## Exit Code Behavior

The `timeout` command returns different exit codes based on what happened:

| Exit Code | Meaning |
|-----------|---------|
| **0** | Command completed successfully |
| **124** | Command timed out (this is the ONLY timeout exit code) |
| **125** | timeout command itself failed |
| **126** | Command found but cannot be invoked |
| **127** | Command not found |
| **1-123, 128+** | The actual exit code of the command that ran |

### Example Scenarios

**Scenario 1: Missing jq dependency**

```bash
timeout 10m bash scripts/scanners/run-all-scanners.sh
# Scanner fails: "jq: command not found"
# Exit code: 127 (command not found)
# OLD: "ERROR: Scanners timed out after 10 minutes" ❌ WRONG
# NEW: "ERROR: Scanners failed with exit code 127" ✅ CORRECT
```

**Scenario 2: Actual timeout**

```bash
timeout 10m bash scripts/scanners/run-all-scanners.sh
# Scanner runs for 10+ minutes
# Exit code: 124 (timeout)
# OLD: "ERROR: Scanners timed out after 10 minutes" ✅ CORRECT
# NEW: "ERROR: Scanners timed out after 10 minutes" ✅ CORRECT
```

**Scenario 3: Scanner logic error**

```bash
timeout 10m bash scripts/scanners/run-all-scanners.sh
# Scanner has a bug and exits early
# Exit code: 1 (script error)
# OLD: "ERROR: Scanners timed out after 10 minutes" ❌ WRONG
# NEW: "ERROR: Scanners failed with exit code 1" ✅ CORRECT
```

---

## Fix Applied

### Updated Code

**Both workflow files now use:**

```yaml
timeout 10m bash scripts/scanners/run-all-scanners.sh || {
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "ERROR: Scanners timed out after 10 minutes"
  else
    echo "ERROR: Scanners failed with exit code $exit_code"
  fi
  exit 1
}
```

### What Changed

1. **Capture exit code:** `exit_code=$?` stores the actual exit code
2. **Check for timeout:** `if [ $exit_code -eq 124 ]` specifically checks for timeout
3. **Differentiate errors:** Shows "timed out" only for 124, otherwise shows actual exit code
4. **Applied to both files:** Both template and active workflow updated

---

## Impact

### Before Fix

- ❌ Misleading error messages
- ❌ Difficult to troubleshoot actual failures
- ❌ Developers chase timeout issues when problem is elsewhere
- ❌ No indication of what actually failed

### After Fix

- ✅ Accurate error messages
- ✅ Exit code helps identify failure type
- ✅ Developers can quickly diagnose real issue
- ✅ Clear distinction between timeout vs other failures

### Error Message Examples

```bash
# Timeout occurred
ERROR: Scanners timed out after 10 minutes

# jq not installed
ERROR: Scanners failed with exit code 127

# Permission denied
ERROR: Scanners failed with exit code 126

# Script logic error
ERROR: Scanners failed with exit code 1

# Missing config file
ERROR: Scanners failed with exit code 2
```

---

## Common Exit Codes Reference

For troubleshooting scanner failures:

| Exit Code | Common Causes |
|-----------|---------------|
| **1** | General script error, command failed, validation failed |
| **2** | Missing argument, configuration error |
| **124** | **Timeout occurred** (10 minutes exceeded) |
| **125** | timeout command itself failed |
| **126** | Permission denied, file not executable |
| **127** | Command not found (jq, npm, curl, git missing) |
| **130** | Script terminated by Ctrl+C (SIGINT) |
| **137** | Script killed by SIGKILL |
| **143** | Script terminated by SIGTERM |

---

## Testing

### Verification Commands

```bash
# Test 1: Simulate timeout (should show timeout message)
(cd /tmp && timeout 1s sleep 10 || { exit_code=$?; [ $exit_code -eq 124 ] && echo "TIMEOUT" || echo "FAILED: $exit_code"; })
# Expected: "TIMEOUT"

# Test 2: Simulate failure (should show exit code)
(cd /tmp && timeout 10s bash -c "exit 42" || { exit_code=$?; [ $exit_code -eq 124 ] && echo "TIMEOUT" || echo "FAILED: $exit_code"; })
# Expected: "FAILED: 42"

# Test 3: Simulate success (should pass)
(cd /tmp && timeout 10s echo "OK" && echo "SUCCESS")
# Expected: "OK" then "SUCCESS"
```

### Real-World Test

```bash
# Force a scanner failure (e.g., remove jq temporarily)
docker exec cuemarshal-runner-2 mv /usr/bin/jq /usr/bin/jq.bak 2>/dev/null || true

# Run scanner
timeout 10m bash scripts/scanners/run-all-scanners.sh || {
  exit_code=$?
  if [ $exit_code -eq 124 ]; then
    echo "ERROR: Scanners timed out after 10 minutes"
  else
    echo "ERROR: Scanners failed with exit code $exit_code"
  fi
}

# Restore jq
docker exec cuemarshal-runner-2 mv /usr/bin/jq.bak /usr/bin/jq 2>/dev/null || true

# Expected output: "ERROR: Scanners failed with exit code 127" (not timeout message)
```

---

## Files Modified

1. `.gitea/workflows/self-improve.yml` - Fixed exit code handling (lines 65-68)
2. `workflows/self-improve.yml` - Fixed exit code handling (lines 58-61)
3. `BUG_FIX_EXIT_CODE_HANDLING.md` - This documentation

---

## Related Issues

This fix complements the previous timeout fix:

- **Scanner command timeout:** `timeout 60 npm outdated` (prevents npm from hanging)
- **Step-level timeout:** `timeout 10m run-all-scanners.sh` (prevents entire step from hanging)
- **Proper error reporting:** Exit code distinction (this fix - enables accurate diagnosis)

Together, these provide:

1. Defense against hangs (timeouts)
2. Clear error messages (exit code handling)
3. Fast failure (no infinite waits)

---

## Lessons Learned

1. **The timeout command has specific exit codes** - Only 124 means actual timeout
2. **Generic error handling hides problems** - Always check exit codes for proper diagnosis
3. **Error messages should be accurate** - Misleading messages waste developer time
4. **Test error paths** - Don't just test success cases, verify failure messages too
5. **Document exit codes** - Help future maintainers understand failure modes

---

## Conclusion

**Bug:** Error handler treated all failures as timeouts  
**Fix:** Check exit code 124 specifically for timeout, otherwise show actual exit code  
**Impact:** Developers can now quickly diagnose scanner failures  
**Status:** ✅ **PRODUCTION READY**

The self-improvement workflow now provides accurate error messages for all failure modes.
