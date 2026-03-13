/**
 * Model Selection Service
 * Analyzes task complexity and selects optimal LLM tier
 * Budget-aware model selection with tier downgrade on budget constraints
 */

import { config } from "../config.js";
import { retryPolicyService, type ModelTier } from "./retry-policy.js";
import { db } from "../db/client.js";
import { costRecords, tasks } from "../db/schema.js";
import { sql, gte } from "drizzle-orm";
import { logger } from "../utils/logger.js";


/**
 * Budget status from database
 */
interface BudgetStatus {
  monthlyBudget: number;
  totalSpent: number;
  remaining: number;
  percentageUsed: number;
  selfImproveBudget: number;
  selfImprovementSpent: number;
  selfImprovementRemaining: number;
  isExceeded: boolean;
  isNearThreshold: boolean;
  warningThresholdPct: number;
}

export interface ModelSelection {
  tier: "tier1" | "tier2" | "tier3" | "local";
  reasoning: string;
  estimatedTokens: {
    input: number;
    output: number;
  };
  estimatedCost: number;
  confidence: number;
  budgetStatus?: {
    isExceeded: boolean;
    isNearThreshold: boolean;
    percentageUsed: number;
    remainingBudget: number;
    tierDowngradedDueToBudget?: boolean;
  };
}

interface TaskInput {
  title: string;
  body: string;
  labels: string[];
  agentRole?: string;
  currentTier?: ModelTier | null;
  retryCount?: number;
  lastRetryAt?: Date | null;
}

// Task type keywords and their complexity scores
const TASK_TYPE_SCORES: Record<string, number> = {
  architecture: 0.95,
  design: 0.95,
  system: 0.90,
  scalability: 0.90,
  microservice: 0.90,
  security: 0.90,
  vulnerability: 0.90,
  audit: 0.85,
  refactor: 0.80,
  restructure: 0.80,
  migrate: 0.75,
  rewrite: 0.75,
  implement: 0.60,
  feature: 0.60,
  build: 0.55,
  create: 0.55,
  add: 0.55,
  fix: 0.50,
  bug: 0.50,
  error: 0.50,
  test: 0.45,
  coverage: 0.45,
  spec: 0.45,
  config: 0.40,
  setup: 0.40,
  deploy: 0.40,
  doc: 0.15,
  readme: 0.15,
  comment: 0.15,
  format: 0.10,
  lint: 0.10,
  typo: 0.10,
  rename: 0.10,
};

// Role-based default tiers
const ROLE_BASELINE: Record<string, "tier1" | "tier2" | "tier3"> = {
  architect: "tier3",
  developer: "tier2",
  reviewer: "tier2",
  tester: "tier2",
  devops: "tier2",
  docs: "tier1",
};

// Budget warning threshold (percentage of budget used)
const BUDGET_WARNING_THRESHOLD_PCT = 80;

/**
 * Budget Service - Queries budget status from database
 */
class BudgetService {
  async getBudgetStatus(): Promise<BudgetStatus> {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Query total monthly spend
      const totalResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
        })
        .from(costRecords)
        .where(gte(costRecords.createdAt, monthStart));

      const totalSpent = parseFloat(totalResult[0]?.total || "0");

      // Query self-improvement spend
      const selfImproveResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
        })
        .from(costRecords)
        .where(
          sql`${costRecords.createdAt} >= ${monthStart} 
              AND ${costRecords.agentRole} = 'self-improve'`
        );

      const selfImprovementSpent = parseFloat(selfImproveResult[0]?.total || "0");

      const monthlyBudget = config.totalMonthlyBudgetUsd;
      const selfImproveBudget = (monthlyBudget * config.selfImproveBudgetPct) / 100;
      const percentageUsed = (totalSpent / monthlyBudget) * 100;

      return {
        monthlyBudget,
        totalSpent,
        remaining: monthlyBudget - totalSpent,
        percentageUsed,
        selfImproveBudget,
        selfImprovementSpent,
        selfImprovementRemaining: selfImproveBudget - selfImprovementSpent,
        isExceeded: totalSpent > monthlyBudget,
        isNearThreshold: percentageUsed >= BUDGET_WARNING_THRESHOLD_PCT,
        warningThresholdPct: BUDGET_WARNING_THRESHOLD_PCT,
      };
    } catch (error) {
      logger.error({ error }, "Failed to query budget status, defaulting to unlimited");
      return {
        monthlyBudget: config.totalMonthlyBudgetUsd,
        totalSpent: 0,
        remaining: config.totalMonthlyBudgetUsd,
        percentageUsed: 0,
        selfImproveBudget: (config.totalMonthlyBudgetUsd * config.selfImproveBudgetPct) / 100,
        selfImprovementSpent: 0,
        selfImprovementRemaining: (config.totalMonthlyBudgetUsd * config.selfImproveBudgetPct) / 100,
        isExceeded: false,
        isNearThreshold: false,
        warningThresholdPct: BUDGET_WARNING_THRESHOLD_PCT,
      };
    }
  }
}

const budgetService = new BudgetService();

export class ModelSelector {
  /**
    * Select the optimal model tier for a task with failure escalation and budget awareness
    */
  async selectModel(task: TaskInput): Promise<ModelSelection> {
    const retryCount = task.retryCount || 0;
    const currentTier = task.currentTier || null;
    const lastRetryAt = task.lastRetryAt || null;
    
    // Get budget status early for decision making
    const budgetStatus = await budgetService.getBudgetStatus();

    if (retryCount > 0 && currentTier) {
      const decision = retryPolicyService.decideEscalation(currentTier, retryCount, lastRetryAt);
      if (decision.shouldStop) {
        return this.createSelection(currentTier, task, `HUMAN REVIEW REQUIRED: ${decision.reason}`, budgetStatus);
      }
      if (decision.nextTier) {
        return this.createSelection(decision.nextTier, task, decision.reason, budgetStatus);
      }
    }
    
    // Step 1: Check for explicit complexity label
    const complexityLabel = task.labels.find((l) => l.startsWith("complexity:"));
    if (complexityLabel) {
      const [, complexity] = complexityLabel.split(":");
      if (complexity === "simple") return this.createSelection("tier1", task, "Explicit complexity:simple label", budgetStatus);
      if (complexity === "standard") return this.createSelection("tier2", task, "Explicit complexity:standard label", budgetStatus);
      if (complexity === "complex") return this.createSelection("tier3", task, "Explicit complexity:complex label", budgetStatus);
    }

    // Step 2: Get role baseline
    const roleLabel = task.labels.find((l) => l.startsWith("role:"));
    const role = roleLabel ? roleLabel.split(":")[1] : task.agentRole;
    const baseline = role ? ROLE_BASELINE[role] || "tier2" : "tier2";

    // Step 3: Calculate complexity score
    const score = await this.calculateComplexityScore(task);

    // Step 4: Map score to tier
    let selectedTier: "tier1" | "tier2" | "tier3";
    if (score < config.modelSelectorTier1Threshold) {
      selectedTier = "tier1";
    } else if (score < config.modelSelectorTier3Threshold) {
      selectedTier = "tier2";
    } else {
      selectedTier = "tier3";
    }

    // Use the higher of baseline and scored tier
    const tierRank = { tier1: 1, tier2: 2, tier3: 3 };
    let finalTier = tierRank[selectedTier] > tierRank[baseline] ? selectedTier : baseline;

    const reasoning = `Score: ${score.toFixed(2)} → ${selectedTier}, Role baseline: ${baseline}, Final: ${finalTier}`;

    // Step 5: Check budget constraints and downgrade if needed
    const budgetAdjustedTier = this.applyBudgetConstraints(finalTier, budgetStatus, reasoning);

    return this.createSelection(budgetAdjustedTier.tier, task, budgetAdjustedTier.reasoning, budgetStatus, budgetAdjustedTier.wasDowngraded);
  }

  private async getHistoricalEscalationRate(taskType: string): Promise<number> {
    try {
      const result = await db
        .select({ count: sql<string>`COUNT(*)`, escalated: sql<string>`SUM(CASE WHEN ${tasks.retryCount} > 0 THEN 1 ELSE 0 END)` })
        .from(tasks)
        .where(sql`${tasks.agentRole} = ${taskType} AND ${tasks.status} IN ('completed', 'failed')`);
      const total = parseInt(result[0]?.count || "0");
      if (total < 5) return 0.5; // Not enough data — use neutral value
      const escalated = parseInt(result[0]?.escalated || "0");
      return escalated / total;
    } catch {
      return 0.5;
    }
  }

  async calculateComplexityScore(task: TaskInput): Promise<number> {
    const weights = {
      tokenEstimate: 0.20,
      taskType: 0.35,
      scope: 0.25,
      historical: 0.20,
    };

    const descriptionLength = task.title.split(/\s+/).length + task.body.split(/\s+/).length;
    const tokenEstimateFactor = Math.min(descriptionLength / 1000, 1.0);

    const text = `${task.title} ${task.body}`.toLowerCase();
    let taskTypeFactor = 0.5;
    for (const [keyword, score] of Object.entries(TASK_TYPE_SCORES)) {
      if (text.includes(keyword)) {
        taskTypeFactor = Math.max(taskTypeFactor, score);
      }
    }

    const fileMatches = text.match(/\b\w+\.(ts|js|py|go|rs|java|md)\b/g);
    const scopeFactor = fileMatches ? Math.min(fileMatches.length / 10, 1.0) : 0.3;

    // Dynamic: query avg escalation rate for this task type (falls back to 0.5 if < 5 samples)
    const role = task.agentRole || (task.labels.find((l) => l.startsWith("role:"))?.split(":")[1]);
    const historicalFactor = await this.getHistoricalEscalationRate(role || "developer");

    const score =
      weights.tokenEstimate * tokenEstimateFactor +
      weights.taskType * taskTypeFactor +
      weights.scope * scopeFactor +
      weights.historical * historicalFactor;

    return Math.min(Math.max(score, 0), 1);
  }

  private applyBudgetConstraints(
    selectedTier: "tier1" | "tier2" | "tier3",
    budgetStatus: BudgetStatus,
    originalReasoning: string
  ): { tier: "tier1" | "tier2" | "tier3"; reasoning: string; wasDowngraded: boolean } {
    if (budgetStatus.isExceeded) {
      logger.warn(
        { spent: budgetStatus.totalSpent, budget: budgetStatus.monthlyBudget },
        "Budget exceeded, downgrading to tier1"
      );
      return {
        tier: "tier1",
        reasoning: `${originalReasoning}. Budget exceeded ($${budgetStatus.totalSpent.toFixed(2)}/$${budgetStatus.monthlyBudget.toFixed(2)}), downgraded to tier1`,
        wasDowngraded: true,
      };
    }

    if (budgetStatus.isNearThreshold && selectedTier === "tier3") {
      logger.warn(
        { percentageUsed: budgetStatus.percentageUsed, threshold: budgetStatus.warningThresholdPct },
        "Budget near threshold, downgrading tier3 to tier2"
      );
      return {
        tier: "tier2",
        reasoning: `${originalReasoning}. Budget at ${budgetStatus.percentageUsed.toFixed(1)}% (threshold: ${budgetStatus.warningThresholdPct}%), downgraded tier3 to tier2`,
        wasDowngraded: true,
      };
    }

    return {
      tier: selectedTier,
      reasoning: originalReasoning,
      wasDowngraded: false,
    };
  }

  private createSelection(
    tier: "tier1" | "tier2" | "tier3" | "local",
    task: TaskInput,
    reasoning: string,
    budgetStatus?: BudgetStatus,
    tierDowngradedDueToBudget?: boolean
  ): ModelSelection {
    const inputTokens = task.title.length + task.body.length;
    const outputTokens = inputTokens * 0.5;

    const costPerToken: Record<string, number> = {
      tier1: 0.00000025,
      tier2: 0.000003,
      tier3: 0.000015,
      local: 0,
    };

    const estimatedCost = (inputTokens + outputTokens) * costPerToken[tier];

    const selection: ModelSelection = {
      tier,
      reasoning,
      estimatedTokens: {
        input: inputTokens,
        output: outputTokens,
      },
      estimatedCost,
      confidence: 0.75,
    };

    if (budgetStatus) {
      selection.budgetStatus = {
        isExceeded: budgetStatus.isExceeded,
        isNearThreshold: budgetStatus.isNearThreshold,
        percentageUsed: budgetStatus.percentageUsed,
        remainingBudget: budgetStatus.remaining,
        tierDowngradedDueToBudget,
      };
    }

    return selection;
  }
}

export const modelSelector = new ModelSelector();
