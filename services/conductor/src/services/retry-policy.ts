/**
 * Retry and Tier Escalation Policy
 * Defines retry limits, escalation rules, and backoff strategies
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";


export type ModelTier = "tier1" | "tier2" | "tier3";
export type EscalationAction = "retry" | "escalate" | "human-review";

export interface RetryPolicy {
  maxRetriesPerTier: Record<ModelTier, number>;
  maxTotalRetries: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  cooldownMs: number;
}

export interface EscalationDecision {
  action: EscalationAction;
  nextTier?: ModelTier;
  reason: string;
  shouldStop: boolean;
  backoffMs?: number;
}

export interface EscalationHistoryEntry {
  timestamp: string;
  fromTier: ModelTier | null;
  toTier: ModelTier;
  retryCount: number;
  reason: string;
}

// Load retry policy from configuration
export function getRetryPolicy(): RetryPolicy {
  return {
    maxRetriesPerTier: {
      tier1: config.retryMaxTier1,
      tier2: config.retryMaxTier2,
      tier3: config.retryMaxTier3,
    },
    maxTotalRetries: config.retryMaxTotal,
    backoffBaseMs: config.retryBackoffBaseMs,
    backoffMaxMs: config.retryBackoffMaxMs,
    cooldownMs: config.retryCooldownMs,
  };
}

export const DEFAULT_RETRY_POLICY = getRetryPolicy();

export class RetryPolicyService {
  constructor(private policy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  /**
   * Determine the next action for a failed task
   */
  decideEscalation(
    currentTier: ModelTier | null,
    retryCount: number,
    lastRetryAt: Date | null
  ): EscalationDecision {
    const tier = currentTier || "tier1";

    // Check if we've exceeded total retry limit
    if (retryCount >= this.policy.maxTotalRetries) {
      logger.warn({ retryCount, tier }, "Total retry limit exceeded - escalating to human");
      return {
        action: "human-review",
        shouldStop: true,
        reason: `Exceeded total retry limit (${retryCount}/${this.policy.maxTotalRetries})`,
      };
    }

    // Check cooldown period
    if (lastRetryAt) {
      const timeSinceLastRetry = Date.now() - lastRetryAt.getTime();
      if (timeSinceLastRetry < this.policy.cooldownMs) {
        const remainingCooldown = this.policy.cooldownMs - timeSinceLastRetry;
        logger.info({ remainingCooldown }, "Task still in cooldown period");
        return {
          action: "retry",
          nextTier: tier,
          shouldStop: false,
          reason: `Cooldown period active`,
          backoffMs: remainingCooldown,
        };
      }
    }

    // Count retries at current tier
    const retriesAtTier = this.getRetriesAtCurrentTier(retryCount, tier);
    const maxForTier = this.policy.maxRetriesPerTier[tier];

    logger.info({ tier, retriesAtTier, maxForTier, totalRetries: retryCount }, "Evaluating retry policy");

    // Check if we should escalate to next tier
    if (retriesAtTier >= maxForTier) {
      const nextTier = this.getNextTier(tier);

      if (!nextTier) {
        // No next tier - escalate to human
        return {
          action: "human-review",
          shouldStop: true,
          reason: `Tier ${tier} exhausted all retries (${retriesAtTier}/${maxForTier})`,
        };
      }

      // Escalate to next tier
      logger.info({ fromTier: tier, toTier: nextTier }, "Escalating to higher tier");
      return {
        action: "escalate",
        nextTier,
        shouldStop: false,
        reason: `Tier ${tier} retry limit reached (${retriesAtTier}/${maxForTier}), escalating to ${nextTier}`,
        backoffMs: this.calculateBackoff(retryCount),
      };
    }

    // Retry at same tier
    return {
      action: "retry",
      nextTier: tier,
      shouldStop: false,
      reason: `Retrying at ${tier} (${retriesAtTier + 1}/${maxForTier})`,
      backoffMs: this.calculateBackoff(retryCount),
    };
  }

  /**
   * Get the next tier in the escalation chain
   */
  private getNextTier(currentTier: ModelTier): ModelTier | null {
    const escalationChain: Record<ModelTier, ModelTier | null> = {
      tier1: "tier2",
      tier2: "tier3",
      tier3: null, // No tier after tier3 - escalate to human
    };
    return escalationChain[currentTier];
  }

  /**
   * Calculate exponential backoff with jitter
   */
  calculateBackoff(retryCount: number): number {
    const exponential = Math.min(
      this.policy.backoffBaseMs * Math.pow(2, retryCount),
      this.policy.backoffMaxMs
    );

    // Add jitter (±25%)
    const jitter = exponential * 0.25 * (Math.random() - 0.5);
    return Math.floor(exponential + jitter);
  }

  /**
   * Estimate retries at current tier based on total retry count
   * This is a heuristic - actual count should come from escalation history
   */
  private getRetriesAtCurrentTier(totalRetries: number, currentTier: ModelTier): number {
    const tier1Max = this.policy.maxRetriesPerTier.tier1;
    const tier2Max = this.policy.maxRetriesPerTier.tier2;

    if (currentTier === "tier1") {
      return Math.min(totalRetries, tier1Max);
    } else if (currentTier === "tier2") {
      const tier2Retries = totalRetries - tier1Max;
      return Math.max(0, Math.min(tier2Retries, tier2Max));
    } else {
      // tier3
      const tier3Retries = totalRetries - tier1Max - tier2Max;
      return Math.max(0, tier3Retries);
    }
  }

  /**
   * Create escalation history entry
   */
  createHistoryEntry(
    fromTier: ModelTier | null,
    toTier: ModelTier,
    retryCount: number,
    reason: string
  ): EscalationHistoryEntry {
    return {
      timestamp: new Date().toISOString(),
      fromTier,
      toTier,
      retryCount,
      reason,
    };
  }

  /**
   * Parse escalation history from JSONB
   */
  parseHistory(history: unknown): EscalationHistoryEntry[] {
    if (!history) return [];
    if (Array.isArray(history)) return history as EscalationHistoryEntry[];
    return [];
  }

  /**
   * Add entry to escalation history
   */
  appendHistory(
    currentHistory: unknown,
    newEntry: EscalationHistoryEntry
  ): EscalationHistoryEntry[] {
    const history = this.parseHistory(currentHistory);
    return [...history, newEntry];
  }
}

export const retryPolicyService = new RetryPolicyService();
