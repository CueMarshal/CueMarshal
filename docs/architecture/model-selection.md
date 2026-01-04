# Model Selection Algorithm

## Overview

The Conductor's model selector automatically determines the optimal LLM tier for each task based on complexity, cost, and provider availability. This ensures the system uses the most cost-effective model capable of completing each task successfully.

## Model Tiers

| Tier | Models (Aliases) | Cost Estimate (USD/token) | Use Cases |
|------|------------------|----------------------------|-----------|
| `tier1` | `gpt-4o-mini` | $0.00000025 | Formatting, docs, typos, labels, simple config |
| `tier2` | `gpt-4o` | $0.000003 | Feature implementation, bugs, reviews, tests |
| `tier3` | `gpt-4.1` | $0.000015 | Architecture, security audit, complex refactoring |
| `local` | Optional manual/local fallback | $0 (compute only) | Offline or budget-free tasks (not auto-selected) |

## Selection Algorithm

### Input

```typescript
interface TaskInput {
  title: string;
  body: string;
  labels: string[];        // e.g., "role:developer", "complexity:standard"
  agentRole?: string;
  currentTier?: "tier1" | "tier2" | "tier3" | "local" | null;
  retryCount?: number;
  lastRetryAt?: Date | null;
}
```

### Output

```typescript
interface ModelSelection {
  tier: "tier1" | "tier2" | "tier3" | "local";
  reasoning: string;       // Explanation of the selection
  estimatedTokens: {
    input: number;
    output: number;
  };
  estimatedCost: number;   // USD
  confidence: number;      // 0-1 how confident in the selection
}
```

### Algorithm Steps

#### Step 1: Retry Escalation (If Applicable)

If a task is being retried, the retry policy can escalate tiers or stop after repeated failures.

#### Step 2: Label-Based Override

If the issue has an explicit `complexity:*` label, use it directly:

| Label | Tier |
|-------|------|
| `complexity:simple` | `tier1` |
| `complexity:standard` | `tier2` |
| `complexity:complex` | `tier3` |

If present, skip to Step 5 (budget check). Label overrides bypass the scoring algorithm.

#### Step 3: Role-Based Baseline

Each agent role has a default tier that serves as the baseline:

| Role | Baseline Tier | Reasoning |
|------|---------------|-----------|
| `architect` | `tier3` | Architecture requires highest reasoning |
| `developer` | `tier2` | Implementation is mid-complexity |
| `reviewer` | `tier2` | Reviews need strong analysis |
| `tester` | `tier2` | Test writing needs understanding of code |
| `devops` | `tier2` | Infrastructure is mid-complexity |
| `docs` | `tier1` | Documentation is typically straightforward |

#### Step 4: Complexity Scoring

Compute a complexity score (0.0 to 1.0) using multiple factors:

```
complexity_score = weighted_sum(
  w1 * token_estimate_factor,
  w2 * task_type_factor,
  w3 * scope_factor,
  w4 * historical_factor
)
```

##### Factor 1: Token Estimate (w1 = 0.20)

Estimate the input/output tokens based on task description length and repo size.

```
description_tokens = word_count(title + body) * 1.3
context_tokens = min(repo_file_count * 500, 100000)  // estimated context needed
total_estimated = description_tokens + context_tokens

score = clamp(total_estimated / 200000, 0, 1)
```

##### Factor 2: Task Type (w2 = 0.35)

Classify the task type from keywords in the title and body.

| Keywords | Task Type | Score |
|----------|-----------|-------|
| `architecture`, `design`, `system`, `scalab`, `microservice` | Architecture | 0.95 |
| `security`, `vulnerability`, `auth`, `encrypt`, `OWASP` | Security | 0.90 |
| `refactor`, `restructure`, `migrate`, `rewrite` | Refactoring | 0.80 |
| `implement`, `feature`, `build`, `create`, `add` | Feature | 0.60 |
| `fix`, `bug`, `error`, `crash`, `issue` | Bug Fix | 0.50 |
| `test`, `coverage`, `spec`, `assert` | Testing | 0.45 |
| `config`, `setup`, `install`, `deploy` | DevOps | 0.40 |
| `doc`, `readme`, `comment`, `explain` | Documentation | 0.15 |
| `format`, `lint`, `style`, `typo`, `rename` | Formatting | 0.10 |

Multiple keyword matches: use the highest score.

##### Factor 3: Scope (w3 = 0.25)

Estimate how many files/modules the task affects.

```
If body mentions specific files:
  scope = number_of_files_mentioned / 20  // normalize to 0-1
Else:
  scope = estimated from task type:
    Architecture → 0.9
    Feature → 0.5
    Bug Fix → 0.3
    Documentation → 0.2
    Formatting → 0.1
```

##### Factor 4: Historical Success (w4 = 0.20)

Currently a placeholder value (`0.5`). Historical success tracking is not implemented yet.

#### Step 5: Score-to-Tier Mapping

```
If complexity_score < 0.30 → tier1
If complexity_score < 0.70 → tier2
If complexity_score >= 0.70 → tier3
```

Compare with the role baseline (Step 2). Use the **higher** of the two:
- If scoring says `tier1` but role baseline is `tier2`, use `tier2`.
- If scoring says `tier3` but role baseline is `tier2`, use `tier3`.

#### Step 6: Return Selection

```typescript
return {
  tier: selected_tier,
  reasoning: `Selected ${selected_tier} based on: task_type=${task_type_factor}, 
              scope=${scope_factor}, complexity_score=${complexity_score}, 
              budget_remaining=${budget.remaining}`,
  estimatedTokens: { input: input_estimate, output: output_estimate },
  estimatedCost: estimated_cost,
  confidence: confidence_from_historical_data
};
```

## LiteLLM Integration

The selected tier is passed to the LLM Gateway as an OpenAI-compatible alias:

1. Conductor selects `tier2`
2. Workflow maps `tier2` → `gpt-4o`
3. OpenCode sends requests to Gateway with `model: "gpt-4o"`
4. LiteLLM routes to the configured providers (Groq/Gemini/Azure AI) based on routing strategy and fallbacks

## Adaptive Learning

Over time, the model selector improves based on outcomes:

1. **Success tracking**: Each task records whether it succeeded or failed with the selected tier.
2. **Tier calibration**: If tier1 succeeds consistently for a task type previously mapped to tier2, future similar tasks may be downgraded.
3. **Failure escalation**: If a task fails with tier2, it is retried with tier3 (up to 1 escalation).
4. **Cost optimization**: The system tracks cost-per-successful-task by tier and optimizes for the lowest cost with acceptable success rate (>85%).

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `MODEL_SELECTOR_TIER1_THRESHOLD` | `0.30` | Score below this → tier1 |
| `MODEL_SELECTOR_TIER3_THRESHOLD` | `0.70` | Score at/above this → tier3 |
| `MODEL_SELECTOR_MIN_CONFIDENCE` | `0.60` | Below this, add a warning to selection |
| `MODEL_SELECTOR_MAX_ESCALATIONS` | `1` | Max tier escalations on failure |
| `MODEL_SELECTOR_HISTORY_WINDOW` | `30` | Days of history to consider |

## Example Selections

| Task | Score | Selected Tier | Reasoning |
|------|-------|---------------|-----------|
| "Fix typo in README" | 0.12 | tier1 | task_type=formatting(0.10), scope=single_file(0.05) |
| "Implement user registration API" | 0.58 | tier2 | task_type=feature(0.60), scope=multi_file(0.50) |
| "Design microservice architecture for payment system" | 0.92 | tier3 | task_type=architecture(0.95), scope=system(0.90) |
| "Add unit tests for auth module" | 0.42 | tier2 | task_type=testing(0.45), role_baseline=tier2 |
| "Update CI/CD pipeline for new service" | 0.40 | tier2 | task_type=devops(0.40), role_baseline=tier2 |
