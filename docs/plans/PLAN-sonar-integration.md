# Plan: SonarQube Integration for Automated Code Quality Scanning & Issue Creation

## Overview

Add a SonarQube service to the CueMarshal platform that performs static analysis scans on repository code, then feeds findings into the existing improvement-discovery pipeline so Gitea issues are created automatically for flagged items.

---

## Architecture

```
┌────────────┐     ┌────────────────┐     ┌─────────────────────┐
│   Gitea    │────▶│  SonarQube     │────▶│  scan-sonar.sh      │
│ (repos)    │     │  (analysis)    │     │  (scanner script)   │
└────────────┘     └────────────────┘     └──────────┬──────────┘
                                                     │
                                          improvement-findings.json
                                                     │
                                          ┌──────────▼──────────┐
                                          │  self-improve.yml   │
                                          │  (LLM prioritizes   │
                                          │   & creates issues)  │
                                          └─────────────────────┘
```

SonarQube runs as a Docker Compose service. A new scanner script (`scan-sonar.sh`) queries the SonarQube API for issues, converts them to the existing findings schema, and feeds them into `run-all-scanners.sh`. The self-improvement workflow handles prioritization and Gitea issue creation unchanged.

---

## Implementation Steps

### Phase 1: Infrastructure — Add SonarQube Service

**File: `docker-compose.yml`**

Add a `sonarqube` service and a persistent volume:

```yaml
sonarqube:
  image: sonarqube:10-community
  container_name: cuemarshal-sonarqube
  environment:
    SONAR_JDBC_URL: jdbc:postgresql://postgres:5432/sonarqube
    SONAR_JDBC_USERNAME: ${POSTGRES_USER}
    SONAR_JDBC_PASSWORD: ${POSTGRES_PASSWORD}
  volumes:
    - sonarqube-data:/opt/sonarqube/data
    - sonarqube-extensions:/opt/sonarqube/extensions
    - sonarqube-logs:/opt/sonarqube/logs
  ports:
    - "127.0.0.1:9000:9000"
  depends_on:
    postgres:
      condition: service_healthy
  networks:
    - cuemarshal
  healthcheck:
    test: ["CMD-SHELL", "curl -sf http://localhost:9000/api/system/status | grep -q UP"]
    interval: 30s
    timeout: 10s
    retries: 10
    start_period: 120s
  deploy:
    resources:
      limits:
        memory: 2G
      reservations:
        memory: 1G
  restart: unless-stopped
```

Add volumes:

```yaml
sonarqube-data:
  name: cuemarshal-sonarqube-data
sonarqube-extensions:
  name: cuemarshal-sonarqube-extensions
sonarqube-logs:
  name: cuemarshal-sonarqube-logs
```

**File: `infrastructure/postgres/init.sql`**

Add a `sonarqube` database to the Postgres init script:

```sql
CREATE DATABASE sonarqube;
```

**File: `.env` (additions)**

```env
SONAR_URL=http://sonarqube:9000
SONAR_TOKEN=<generated-after-first-boot>
SONAR_PROJECT_KEY=cuemarshal
```

### Phase 2: Sonar Project Bootstrap

**File: `infrastructure/sonarqube/init-sonar.sh`**

A one-time initialization script (run via a `docker compose run` or an init container) that:

1. Waits for SonarQube to be healthy
2. Changes the default admin password
3. Creates a user token for API access (`SONAR_TOKEN`)
4. Creates the project(s) matching Gitea repositories
5. Writes the token to the shared volume or `.env`

```bash
#!/bin/bash
set -euo pipefail

SONAR_URL="${SONAR_URL:-http://sonarqube:9000}"
SONAR_ADMIN_PASSWORD="${SONAR_ADMIN_PASSWORD:-admin}"

# Wait for SonarQube
echo "Waiting for SonarQube..."
until curl -sf "$SONAR_URL/api/system/status" | grep -q "UP"; do
  sleep 5
done
echo "SonarQube is ready"

# Change default password (first boot only)
curl -sf -u admin:admin -X POST \
  "$SONAR_URL/api/users/change_password" \
  -d "login=admin&previousPassword=admin&password=${SONAR_ADMIN_PASSWORD}" \
  2>/dev/null || true

# Generate token
TOKEN_RESPONSE=$(curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
  "$SONAR_URL/api/user_tokens/generate" \
  -d "name=cuemarshal-scanner&type=GLOBAL_ANALYSIS_TOKEN" 2>/dev/null || true)

if [ -n "$TOKEN_RESPONSE" ]; then
  SONAR_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.token')
  echo "SONAR_TOKEN=${SONAR_TOKEN}" >> /tokens/sonar_token
  echo "Token generated and saved"
fi

# Create project
curl -sf -u "admin:${SONAR_ADMIN_PASSWORD}" -X POST \
  "$SONAR_URL/api/projects/create" \
  -d "name=cuemarshal&project=cuemarshal" 2>/dev/null || true

echo "SonarQube initialization complete"
```

### Phase 3: Sonar Analysis Workflow

**File: `workflows/sonar-scan.yml`**

A dedicated Gitea Actions workflow that runs `sonar-scanner` against the codebase. This runs on push to `main` and on a schedule, ensuring fresh analysis data is always available.

```yaml
name: SonarQube Scan

on:
  push:
    branches: [main]
  schedule:
    - cron: "30 */8 * * *"   # 30 min before self-improve cycle
  workflow_dispatch: {}

env:
  SONAR_URL: ${{ secrets.SONAR_URL }}
  SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
  SONAR_PROJECT_KEY: cuemarshal

jobs:
  scan:
    runs-on: [self-hosted, opencode]
    timeout-minutes: 30
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0    # full history for blame data

      - name: Run SonarQube Scanner
        run: |
          sonar-scanner \
            -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
            -Dsonar.host.url="${SONAR_URL}" \
            -Dsonar.token="${SONAR_TOKEN}" \
            -Dsonar.sources=. \
            -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/*.test.*,**/coverage/**" \
            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info \
            -Dsonar.typescript.lcov.reportPaths=coverage/lcov.info
          
          echo "SonarQube analysis complete"

      - name: Wait for analysis processing
        run: |
          echo "Waiting for SonarQube to process results..."
          sleep 15
          
          # Check quality gate
          STATUS=$(curl -sf -u "${SONAR_TOKEN}:" \
            "${SONAR_URL}/api/qualitygates/project_status?projectKey=${SONAR_PROJECT_KEY}" \
            | jq -r '.projectStatus.status')
          
          echo "Quality Gate Status: $STATUS"
```

**Runner Dockerfile update** — install `sonar-scanner-cli`:

```dockerfile
# Install SonarQube Scanner CLI
ARG SONAR_SCANNER_VERSION=6.2.1.4610
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
      SONAR_ARCH="linux-aarch64"; \
    else \
      SONAR_ARCH="linux-x64"; \
    fi && \
    curl -fsSL "https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${SONAR_SCANNER_VERSION}-${SONAR_ARCH}.zip" \
      -o /tmp/sonar-scanner.zip && \
    unzip /tmp/sonar-scanner.zip -d /opt/ && \
    ln -s /opt/sonar-scanner-*/bin/sonar-scanner /usr/local/bin/sonar-scanner && \
    rm /tmp/sonar-scanner.zip

# Java runtime required by sonar-scanner
RUN apk add --no-cache openjdk17-jre-headless
```

### Phase 4: Scanner Script — Bridge Sonar to Findings Schema

**File: `scripts/scanners/scan-sonar.sh`**

This is the key integration point. It queries the SonarQube Web API for open issues and converts them to the standard `improvement-findings` schema so they merge seamlessly with the existing scanners.

```bash
#!/bin/bash
# SonarQube Issue Scanner
# Queries SonarQube API for open issues and outputs findings in standard schema

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-.}"
OUTPUT_FILE="${OUTPUT_FILE:-improvement-findings-sonar.json}"

SONAR_URL="${SONAR_URL:-http://sonarqube:9000}"
SONAR_TOKEN="${SONAR_TOKEN:-}"
SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}"

if [ -z "$SONAR_TOKEN" ]; then
  echo "  SKIP: SONAR_TOKEN not set"
  echo '{"scanner":"sonarqube","enabled":false,"findings_count":0,"findings":[]}' > "$OUTPUT_FILE"
  exit 0
fi

# Verify SonarQube is reachable
if ! curl -sf -u "${SONAR_TOKEN}:" "${SONAR_URL}/api/system/status" > /dev/null 2>&1; then
  echo "  SKIP: SonarQube not reachable at ${SONAR_URL}"
  echo '{"scanner":"sonarqube","enabled":false,"findings_count":0,"findings":[]}' > "$OUTPUT_FILE"
  exit 0
fi

echo "  Querying SonarQube issues for project: ${SONAR_PROJECT_KEY}"

# Fetch open issues (bugs, vulnerabilities, code smells) — page through results
PAGE=1
PAGE_SIZE=100
MAX_FINDINGS=100
all_issues="[]"

while true; do
  response=$(curl -sf -u "${SONAR_TOKEN}:" \
    "${SONAR_URL}/api/issues/search?componentKeys=${SONAR_PROJECT_KEY}&statuses=OPEN,CONFIRMED,REOPENED&ps=${PAGE_SIZE}&p=${PAGE}&resolved=false" \
    2>/dev/null || echo '{"issues":[]}')

  page_issues=$(echo "$response" | jq '.issues // []')
  page_count=$(echo "$page_issues" | jq 'length')

  if [ "$page_count" -eq 0 ]; then
    break
  fi

  all_issues=$(echo "$all_issues" | jq --argjson new "$page_issues" '. + $new')
  total=$(echo "$all_issues" | jq 'length')

  if [ "$total" -ge "$MAX_FINDINGS" ]; then
    all_issues=$(echo "$all_issues" | jq ".[0:${MAX_FINDINGS}]")
    break
  fi

  PAGE=$((PAGE + 1))
done

# Map SonarQube severity → schema severity
map_severity() {
  case "$1" in
    BLOCKER)  echo "critical" ;;
    CRITICAL) echo "critical" ;;
    MAJOR)    echo "high" ;;
    MINOR)    echo "medium" ;;
    INFO)     echo "low" ;;
    *)        echo "medium" ;;
  esac
}

# Map SonarQube type → schema category
map_category() {
  case "$1" in
    BUG)            echo "code_quality" ;;
    VULNERABILITY)  echo "code_quality" ;;
    CODE_SMELL)     echo "technical_debt" ;;
    SECURITY_HOTSPOT) echo "code_quality" ;;
    *)              echo "code_quality" ;;
  esac
}

# Priority score based on severity + type
calc_priority() {
  local severity="$1"
  local type="$2"
  local base=50
  
  case "$severity" in
    BLOCKER)  base=95 ;;
    CRITICAL) base=85 ;;
    MAJOR)    base=65 ;;
    MINOR)    base=40 ;;
    INFO)     base=20 ;;
  esac
  
  # Boost for security issues
  if [ "$type" = "VULNERABILITY" ] || [ "$type" = "SECURITY_HOTSPOT" ]; then
    base=$((base + 10))
    [ "$base" -gt 100 ] && base=100
  fi
  
  echo "$base"
}

# Effort mapping
map_effort() {
  local debt="$1"   # e.g., "30min", "2h", "1d"
  if echo "$debt" | grep -qE "^[0-9]+min$"; then
    minutes=$(echo "$debt" | grep -oE '[0-9]+')
    if [ "$minutes" -le 30 ]; then echo "simple"; else echo "standard"; fi
  elif echo "$debt" | grep -qE "^[0-9]+h$"; then
    echo "standard"
  elif echo "$debt" | grep -qE "^[0-9]+d$"; then
    echo "complex"
  else
    echo "standard"
  fi
}

# Convert SonarQube issues to findings schema
TEMP_FILE=$(mktemp)

echo "$all_issues" | jq -c '.[]' | while IFS= read -r issue; do
  key=$(echo "$issue" | jq -r '.key')
  rule=$(echo "$issue" | jq -r '.rule')
  sonar_severity=$(echo "$issue" | jq -r '.severity // "MAJOR"')
  sonar_type=$(echo "$issue" | jq -r '.type // "CODE_SMELL"')
  message=$(echo "$issue" | jq -r '.message // "No message"')
  component=$(echo "$issue" | jq -r '.component // ""' | sed "s|^${SONAR_PROJECT_KEY}:||")
  line=$(echo "$issue" | jq -r '.line // 0')
  debt=$(echo "$issue" | jq -r '.debt // "30min"')

  severity=$(map_severity "$sonar_severity")
  category=$(map_category "$sonar_type")
  priority=$(calc_priority "$sonar_severity" "$sonar_type")
  effort=$(map_effort "$debt")

  id=$(echo -n "sonar:${key}" | md5sum | awk '{print $1}')

  jq -n \
    --arg id "$id" \
    --arg source "sonarqube" \
    --arg category "$category" \
    --arg severity "$severity" \
    --argjson priority "$priority" \
    --arg title "Sonar: ${message}" \
    --arg desc "SonarQube ${sonar_type} (${rule}): ${message}" \
    --arg file "$component" \
    --argjson line "$line" \
    --arg approach "Fix the ${sonar_type,,} identified by rule ${rule}. Refer to SonarQube rule documentation for guidance." \
    --arg effort "$effort" \
    --arg rule "$rule" \
    --arg sonar_type "${sonar_type,,}" \
    --arg sonar_key "$key" \
    '{
      id: $id,
      source: $source,
      category: $category,
      severity: $severity,
      priority_score: $priority,
      title: $title,
      description: $desc,
      location: {file: $file, line: $line},
      suggested_approach: $approach,
      effort_estimate: $effort,
      tags: ["sonarqube", $sonar_type, $rule],
      metadata: {sonar_key: $sonar_key, sonar_rule: $rule, sonar_type: $sonar_type}
    }' >> "$TEMP_FILE"
done

# Combine into array
if [ -s "$TEMP_FILE" ]; then
  findings=$(jq -s '.' "$TEMP_FILE")
  count=$(echo "$findings" | jq 'length')
else
  findings="[]"
  count=0
fi
rm -f "$TEMP_FILE"

echo "  Found $count SonarQube issues"

cat > "$OUTPUT_FILE" <<EOF
{
  "scanner": "sonarqube",
  "enabled": true,
  "findings_count": ${count},
  "findings": ${findings}
}
EOF
```

### Phase 5: Wire Scanner into Orchestrator

**File: `scripts/scanners/run-all-scanners.sh`**

Add sonarqube as scanner 5/5. Insert after the stale-docs scanner block:

```bash
# SonarQube Scanner
echo "[5/5] Querying SonarQube for issues..."
if REPO_ROOT="$REPO_ROOT" OUTPUT_FILE="$TEMP_DIR/sonar.json" \
   SONAR_URL="${SONAR_URL:-}" SONAR_TOKEN="${SONAR_TOKEN:-}" \
   SONAR_PROJECT_KEY="${SONAR_PROJECT_KEY:-cuemarshal}" \
   "$SCANNER_DIR/scan-sonar.sh"; then
  scanner_outputs[sonarqube]="$TEMP_DIR/sonar.json"
  scanner_enabled[sonarqube]="true"
  scanner_counts[sonarqube]=$(jq -r '.findings_count' "$TEMP_DIR/sonar.json")
else
  echo "  WARNING: SonarQube scanner failed"
  scanner_enabled[sonarqube]="false"
  scanner_counts[sonarqube]=0
fi
echo ""
```

Update counter labels from `[1/4]...[4/4]` → `[1/5]...[5/5]`.

Add `sonarqube` to the merged output JSON:

```json
"sonarqube": {
  "enabled": ${scanner_enabled[sonarqube]},
  "findings_count": ${scanner_counts[sonarqube]}
}
```

### Phase 6: Update Schema & Config

**File: `scripts/scanners/schema.json`**

Add `"sonarqube"` to the `source` enum:

```json
"source": {
  "type": "string",
  "enum": ["todo_markers", "dependency_updates", "test_coverage", "stale_documentation", "sonarqube"]
}
```

**File: `scripts/scanners/scanner-config.json`**

Add sonarqube scanner config:

```json
"sonarqube": {
  "enabled": true,
  "min_priority_score": 40,
  "severity_filter": ["BLOCKER", "CRITICAL", "MAJOR"],
  "type_filter": ["BUG", "VULNERABILITY", "CODE_SMELL", "SECURITY_HOTSPOT"],
  "max_issues": 100,
  "suppression_rules": [
    {
      "description": "Suppress info-level code smells",
      "severity": ["INFO"],
      "types": ["CODE_SMELL"]
    }
  ]
}
```

### Phase 7: Labels

**File: `scripts/seed-labels.sh`**

Add a label for sonar-originated issues:

```bash
create_label "source:sonar" "4c1" "Issue identified by SonarQube analysis"
```

### Phase 8: Self-Improve Workflow Update

**File: `workflows/self-improve.yml`**

Pass Sonar environment variables to the scanner step so `scan-sonar.sh` can reach the API:

```yaml
- name: Run improvement scanners
  env:
    SONAR_URL: ${{ secrets.SONAR_URL }}
    SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
    SONAR_PROJECT_KEY: ${{ secrets.SONAR_PROJECT_KEY }}
  run: |
    echo "Running deterministic scanners..."
    bash scripts/scanners/run-all-scanners.sh
    ...
```

Update the LLM prompt to mention Sonar findings:

```
- For sonarqube-sourced findings, include the SonarQube rule ID in the issue description
- Add 'source:sonar' label to issues from sonarqube source
```

### Phase 9: Nginx Proxy (Optional)

**File: `infrastructure/nginx/nginx.conf`**

Add a location block so SonarQube is accessible via the reverse proxy:

```nginx
location /sonar/ {
    proxy_pass http://sonarqube:9000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `docker-compose.yml` | Modify | Add `sonarqube` service + volumes |
| `infrastructure/postgres/init.sql` | Modify | Add `CREATE DATABASE sonarqube` |
| `infrastructure/sonarqube/init-sonar.sh` | Create | One-time SonarQube bootstrap |
| `scripts/scanners/scan-sonar.sh` | Create | Scanner script: Sonar API → findings schema |
| `scripts/scanners/run-all-scanners.sh` | Modify | Wire in sonar scanner as step 5/5 |
| `scripts/scanners/scanner-config.json` | Modify | Add `sonarqube` scanner config |
| `scripts/scanners/schema.json` | Modify | Add `sonarqube` to `source` enum |
| `scripts/seed-labels.sh` | Modify | Add `source:sonar` label |
| `workflows/sonar-scan.yml` | Create | Workflow to run `sonar-scanner` on push/schedule |
| `workflows/self-improve.yml` | Modify | Pass Sonar env vars, update LLM prompt |
| `services/runner/Dockerfile` | Modify | Install `sonar-scanner-cli` + JRE |
| `infrastructure/nginx/nginx.conf` | Modify | (optional) Proxy `/sonar/` |

---

## Environment Variables / Secrets

| Variable | Where | Description |
|----------|-------|-------------|
| `SONAR_URL` | `.env` + Gitea secrets | SonarQube base URL (internal: `http://sonarqube:9000`) |
| `SONAR_TOKEN` | Gitea secrets | API token for scanner authentication |
| `SONAR_PROJECT_KEY` | `.env` + Gitea secrets | Project key in SonarQube (default: `cuemarshal`) |
| `SONAR_ADMIN_PASSWORD` | `.env` | Admin password (set during init) |

---

## Data Flow

1. **`sonar-scan.yml`** runs `sonar-scanner` → pushes analysis to SonarQube server
2. **`self-improve.yml`** triggers → `run-all-scanners.sh` → `scan-sonar.sh` queries `GET /api/issues/search`
3. `scan-sonar.sh` maps SonarQube issues to the standard findings schema (severity, category, priority_score, location)
4. `run-all-scanners.sh` merges sonar findings into `improvement-findings.json`
5. LLM reads `improvement-findings.json`, prioritizes across all sources (TODO markers, deps, tests, docs, **sonar**), creates up to 3 Gitea issues per cycle
6. Gitea issues carry `source:sonar` + `self-improvement` labels, include the Sonar rule ID for traceability

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| SonarQube adds ~2GB memory | Set resource limits; use Community Edition |
| Volume of Sonar findings overwhelms issue creation | `max_issues: 100` cap in scanner, priority scoring filters low-value items, LLM picks top 3 per cycle |
| SonarQube unavailable during scan | `scan-sonar.sh` gracefully exits with empty findings if unreachable |
| Duplicate issues from repeated scans | Findings have deterministic IDs (`sonar:<key>`); LLM prompt instructs deduplication against existing issues |
| JRE adds size to runner image | Use `openjdk17-jre-headless` (minimal ~60MB) |

---

## Implementation Order

1. Add SonarQube to `docker-compose.yml` + Postgres init (Phase 1)
2. Create init script, boot SonarQube, generate token (Phase 2)
3. Install `sonar-scanner` in runner Dockerfile (Phase 3, runner part)
4. Create `sonar-scan.yml` workflow (Phase 3, workflow part)
5. Create `scan-sonar.sh` scanner script (Phase 4)
6. Wire into `run-all-scanners.sh` (Phase 5)
7. Update schema + config + labels (Phase 6-7)
8. Update `self-improve.yml` with env vars and prompt (Phase 8)
9. Optional: Nginx proxy (Phase 9)
