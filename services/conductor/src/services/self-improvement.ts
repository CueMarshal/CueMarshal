/**
 * Self-Improvement Service
 * Manages the self-improvement cycle with centralized orchestration, correlation tracking, and failure thresholds
 */

import { readFileSync } from "fs";
import { workflowTrigger } from "./workflow-trigger.js";
import { config } from "../config.js";
import {
  logger,
  generateCorrelationId,
  createCorrelatedLogger,
  logSelfImproveEvent,
  SelfImproveEvent,
} from "../utils/logger.js";
import { db } from "../db/client.js";
import { costRecords, projects } from "../db/schema.js";
import { sql, gte, eq } from "drizzle-orm";
import { acquireLock, releaseLock, getTTL, setWithTTL, get as redisGet, del as redisDel } from "../utils/redis-client.js";
import { tasksQueue, reviewsQueue, workflowsQueue } from "../queue/jobs.js";
import { giteaClient } from "./gitea-client.js";
import { isSonarFinding } from "../utils/issue-classification.js";


// Redis keys (PLAN-01)
const SELF_IMPROVE_LOCK_KEY = "self-improvement:trigger-lock";
const SELF_IMPROVE_COOLDOWN_KEY = "self-improvement:cooldown";
const SELF_IMPROVE_LAST_RUN_KEY = "self-improvement:last-run";

// Interfaces (PLAN-01 + PLAN-11)
export type CycleOutcome = "work_produced" | "no_findings" | "failed";

export interface ReadinessCheck {
  ready: boolean;
  reasons_blocking: string[];
  idle_ratio: number;
  budget_remaining: number;
  cooldown_remaining_minutes: number;
  timestamp: string;
}

interface SelfImproveFailure {
  timestamp: Date;
  correlationId: string;
  reason: string;
}

export interface SonarBacklogCandidate {
  owner: string;
  repo: string;
  issueNumber: number;
}

function scoreSonarIssue(issue: any): number {
  const labels = (issue.labels || []).map((l: any) => String(l.name || "").toLowerCase());
  if (labels.includes("severity:blocker")) return 100;
  if (labels.includes("severity:critical")) return 90;
  if (labels.includes("severity:major")) return 70;
  if (labels.includes("severity:minor")) return 50;
  if (labels.includes("severity:info")) return 30;
  return 40;
}

function resolveGiteaToken(): string {
  if (config.giteaToken) return config.giteaToken;
  try {
    const fileToken = readFileSync("/tokens/bot_token", "utf-8").trim();
    if (fileToken) return fileToken;
  } catch {
    /* file doesn't exist */
  }
  return "";
}

export class SelfImprovementService {
  private failures: SelfImproveFailure[] = [];
  private isPaused = false;

  resumeSelfImprovement(): void {
    this.isPaused = false;
    this.failures = [];
    logger.info("Self-improvement manually resumed");
  }

  private recordFailure(correlationId: string, reason: string): void {
    this.failures.push({ timestamp: new Date(), correlationId, reason });
    const windowStart = new Date();
    windowStart.setHours(windowStart.getHours() - config.selfImproveFailureWindowHours);
    this.failures = this.failures.filter((f) => f.timestamp > windowStart);
    logSelfImproveEvent(
      SelfImproveEvent.CYCLE_FAILED,
      { reason, failureCount: this.failures.length, threshold: config.selfImproveFailureThreshold },
      correlationId
    );
    if (this.failures.length >= config.selfImproveFailureThreshold) {
      this.isPaused = true;
      logSelfImproveEvent(
        SelfImproveEvent.THRESHOLD_EXCEEDED,
        {
          failureCount: this.failures.length,
          threshold: config.selfImproveFailureThreshold,
          windowHours: config.selfImproveFailureWindowHours,
        },
        correlationId
      );
      logSelfImproveEvent(
        SelfImproveEvent.AUTO_PAUSED,
        { message: "Self-improvement paused due to repeated failures" },
        correlationId
      );
    }
  }

  /**
   * Check if runners are idle (above threshold)
   * Uses real BullMQ queue metrics instead of hardcoded values
   */
  async checkIdleRunners(): Promise<{ idle: boolean; idle_ratio: number }> {
    try {
      // Query actual queue depths from BullMQ
      const [tasksWaiting, tasksActive, reviewsWaiting, reviewsActive, workflowsWaiting, workflowsActive] = await Promise.all([
        tasksQueue.getWaitingCount(),
        tasksQueue.getActiveCount(),
        reviewsQueue.getWaitingCount(),
        reviewsQueue.getActiveCount(),
        workflowsQueue.getWaitingCount(),
        workflowsQueue.getActiveCount(),
      ]);

      const totalPending = tasksWaiting + reviewsWaiting + workflowsWaiting;
      const totalActive = tasksActive + reviewsActive + workflowsActive;
      const totalRunners = 2; // Could be made configurable

      // Calculate idle ratio
      const activeRunners = Math.min(totalActive, totalRunners);
      const idleRunners = totalRunners - activeRunners;
      const idleRatio = totalRunners > 0 ? idleRunners / totalRunners : 0;

      // Idle means: no pending work AND runners are actually idle
      const isIdle = totalPending === 0 && totalActive === 0 && idleRatio >= 0.5;

      logger.debug({ tasksWaiting, tasksActive, reviewsWaiting, reviewsActive, totalPending, totalActive, idleRatio, isIdle }, "Runner idle check");

      return { idle: isIdle, idle_ratio: idleRatio };
    } catch (error) {
      logger.error({ error }, "Failed to check runner idle status");
      // Fallback to conservative (not idle) if check fails
      return { idle: false, idle_ratio: 0 };
    }
  }

  /**
   * Check if there are outstanding project tasks
   */
  async hasOutstandingProjectTasks(): Promise<boolean> {
    try {
      // Get all active projects
      const activeProjects = await db.query.projects.findMany({
        where: eq(projects.status, "active"),
      });

      if (activeProjects.length === 0) {
        return false; // No active projects
      }

      // Check if any active project has open issues
      for (const project of activeProjects) {
        const [owner, repo] = project.giteaRepo.split("/");
        
        // Skip the conductor's own repo (self-improvement repo)
        if (repo === config.conductorRepo && owner === config.conductorOrg) {
          continue;
        }

        const openIssuesResult = await giteaClient.listIssues(owner, repo, { state: "open" });
        const openIssues: any[] = Array.isArray(openIssuesResult) ? openIssuesResult : [];
        const nonSonarOpenIssues = openIssues.filter((issue: any) => {
          const labels = (issue.labels || []).map((l: any) => l.name);
          return !isSonarFinding({ labels, body: issue.body || "" });
        });
        if (nonSonarOpenIssues.length > 0) {
          logger.debug(
            { project: project.giteaRepo, nonSonarOpenIssues: nonSonarOpenIssues.length },
            "Project has outstanding non-Sonar tasks"
          );
          return true;
        }
      }

      return false; // All projects have no open issues
    } catch (error) {
      logger.error({ error }, "Failed to check outstanding project tasks");
      // Fail safe: assume there are outstanding tasks if check fails
      return true;
    }
  }

  async findNextSonarBacklogCandidate(): Promise<SonarBacklogCandidate | null> {
    try {
      const activeProjects = await db.query.projects.findMany({
        where: eq(projects.status, "active"),
      });

      const perRepoCandidates: Array<{
        owner: string;
        repo: string;
        issueNumber: number;
        score: number;
        createdAt: number;
      }> = [];

      for (const project of activeProjects) {
        const [owner, repo] = project.giteaRepo.split("/");
        if (!owner || !repo) continue;

        if (repo === config.conductorRepo && owner === config.conductorOrg) {
          continue;
        }

        const issuesResult = await giteaClient.listIssues(owner, repo, { state: "open" });
        const issues: any[] = Array.isArray(issuesResult) ? issuesResult : [];

        const repoCandidates = issues.filter((issue: any) => {
          const labels = (issue.labels || []).map((l: any) => l.name);
          const hasSkipLabel = labels.includes("skip-automation") || labels.includes("manual-only") || labels.includes("needs-human-review");
          const hasAssignee = Array.isArray(issue.assignees) && issue.assignees.length > 0;
          return !hasSkipLabel && !hasAssignee && isSonarFinding({ labels, body: issue.body || "" });
        });
        if (repoCandidates.length > 0) {
          const topRepoCandidate = repoCandidates
            .map((issue: any) => ({
              issueNumber: issue.number,
              score: scoreSonarIssue(issue),
              createdAt: Date.parse(issue.created_at || issue.createdAt || new Date().toISOString()),
            }))
            .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)[0];
          perRepoCandidates.push({ owner, repo, ...topRepoCandidate });
        }
      }

      if (perRepoCandidates.length === 0) return null;

      const selected = perRepoCandidates
        .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)[0];
      return {
        owner: selected.owner,
        repo: selected.repo,
        issueNumber: selected.issueNumber,
      };
    } catch (error) {
      logger.error({ error }, "Failed to find Sonar backlog candidate");
      return null;
    }
  }

  /**
   * Pause self-improvement due to project work arriving
   */
  async pauseForProjectWork(): Promise<void> {
    try {
      await setWithTTL(
        "self-improve:paused-for-project",
        "true",
        config.selfImproveCooldownHours * 3600
      );
      logger.info("Self-improvement paused for project work");
    } catch (error) {
      logger.error({ error }, "Failed to pause for project work");
    }
  }

  /**
   * Resume self-improvement after project work completes
   */
  async resumeFromProjectWork(): Promise<void> {
    try {
      const wasPaused = await redisGet("self-improve:paused-for-project");
      if (wasPaused) {
        await redisDel("self-improve:paused-for-project");
        logger.info("Self-improvement resumed after project work completion");
      }
    } catch (error) {
      logger.error({ error }, "Failed to resume from project work");
    }
  }

  /**
   * Check if self-improvement budget is available
   */
  async checkBudget(): Promise<{
    available: boolean;
    remaining: number;
    spent: number;
    allowed?: boolean;
    budget?: number;
  }> {
    const monthlyBudget = config.totalMonthlyBudgetUsd;
    const selfImproveBudget = (monthlyBudget * config.selfImproveBudgetPct) / 100;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await db
      .select({
        total: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
      })
      .from(costRecords)
      .where(sql`${costRecords.createdAt} >= ${startOfMonth}`)
      .execute();

    const spent = parseFloat(result[0]?.total || "0");
    const remaining = selfImproveBudget - spent;
    const available = remaining > 0;

    return {
      available,
      remaining,
      spent,
      allowed: available,
      budget: selfImproveBudget,
    };
  }

  /**
   * Check cooldown status
   */
  async checkCooldown(): Promise<{ active: boolean; remaining_minutes: number }> {
    const ttl = await getTTL(SELF_IMPROVE_COOLDOWN_KEY);
    if (ttl > 0) {
      return { active: true, remaining_minutes: Math.ceil(ttl / 60) };
    }
    return { active: false, remaining_minutes: 0 };
  }

  /**
   * Check if a self-improvement workflow is already running
   */
  async checkAlreadyRunning(owner: string, repo: string): Promise<boolean> {
    try {
      const token = resolveGiteaToken();
      const baseUrl = config.giteaUrl.replace(/\/$/, "");
      const response = await fetch(
        `${baseUrl}/api/v1/repos/${owner}/${repo}/actions/runs?status=running`,
        { headers: { Authorization: `token ${token}` } }
      );
      if (!response.ok) return false;
      const data = (await response.json()) as { workflow_runs?: Array<{ name: string }> };
      const runs = data.workflow_runs || [];
      return runs.some((r) => r.name === "Self-Improvement");
    } catch (error) {
      logger.error({ error }, "Error checking running workflows");
      return false;
    }
  }

  /**
   * Perform comprehensive readiness check
   */
  async checkReadiness(owner: string, repo: string): Promise<ReadinessCheck> {
    const timestamp = new Date().toISOString();
    const reasonsBlocking: string[] = [];

    const idleCheck = await this.checkIdleRunners();
    const budgetCheck = await this.checkBudget();
    const cooldownCheck = await this.checkCooldown();
    const alreadyRunning = await this.checkAlreadyRunning(owner, repo);
    const projectTasksCheck = await this.hasOutstandingProjectTasks();

    if (!idleCheck.idle) reasonsBlocking.push("IDLE_THRESHOLD_NOT_MET");
    if (!budgetCheck.available) reasonsBlocking.push("BUDGET_EXHAUSTED");
    if (cooldownCheck.active) reasonsBlocking.push("COOLDOWN_ACTIVE");
    if (alreadyRunning) reasonsBlocking.push("ALREADY_RUNNING");
    if (projectTasksCheck) reasonsBlocking.push("PROJECT_TASKS_PENDING");

    const result: ReadinessCheck = {
      ready: reasonsBlocking.length === 0,
      reasons_blocking: reasonsBlocking,
      idle_ratio: idleCheck.idle_ratio,
      budget_remaining: budgetCheck.remaining,
      cooldown_remaining_minutes: cooldownCheck.remaining_minutes,
      timestamp,
    };

    logger.info(result, "Readiness check completed");
    return result;
  }

  /**
   * Get total spend for the current month
   */
  async getCurrentMonthSpend(): Promise<number> {
    try {
      // Get start of current month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Query sum of costs since start of month
      const result = await db
        .select({
          total: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
        })
        .from(costRecords)
        .where(gte(costRecords.createdAt, monthStart));

      const totalSpent = parseFloat(result[0]?.total || "0");
      return totalSpent;
    } catch (error) {
      logger.error({ error }, "Failed to query monthly spend");
      throw error;
    }
  }

  /**
   * Get self-improvement spend for the current month
   */
  async getSelfImprovementSpend(): Promise<number> {
    try {
      // Get start of current month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Query sum of costs for self-improvement agent role
      const result = await db
        .select({
          total: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
        })
        .from(costRecords)
        .where(
          sql`${costRecords.createdAt} >= ${monthStart} 
              AND ${costRecords.agentRole} = 'self-improve'`
        );

      const totalSpent = parseFloat(result[0]?.total || "0");
      return totalSpent;
    } catch (error) {
      logger.error({ error }, "Failed to query self-improvement spend");
      throw error;
    }
  }

  /**
   * Trigger self-improvement with idempotency protection (PLAN-01 orchestration API)
   */
  async triggerImprovement(
    owner: string,
    repo: string,
    options?: { source?: "sonar_backlog" | "self_findings" }
  ): Promise<{ success: boolean; reason?: string }> {
    const lockTTL = 300;
    const lockAcquired = await acquireLock(SELF_IMPROVE_LOCK_KEY, lockTTL);

    if (!lockAcquired) {
      logger.warn("Failed to acquire trigger lock, another trigger in progress");
      return { success: false, reason: "CONCURRENT_TRIGGER_IN_PROGRESS" };
    }

    try {
      const readiness = await this.checkReadiness(owner, repo);

      if (!readiness.ready) {
        logger.info({ reasons: readiness.reasons_blocking }, "Not ready to trigger self-improvement");
        return { success: false, reason: readiness.reasons_blocking.join(", ") };
      }

      logger.info({ owner, repo }, "Triggering self-improvement workflow");

      const sonarCandidate = await this.findNextSonarBacklogCandidate();
      const source = options?.source || (sonarCandidate ? "sonar_backlog" : "self_findings");
      const shouldUseSonarCandidate = source === "sonar_backlog" && sonarCandidate;
      const result = await workflowTrigger.triggerSelfImprovement(owner, repo, {
        source,
        reason: shouldUseSonarCandidate
          ? `scheduled self-improvement cycle (sonar backlog issue #${sonarCandidate.issueNumber})`
          : "scheduled self-improvement cycle",
        force: false,
        targetOwner: shouldUseSonarCandidate ? sonarCandidate.owner : undefined,
        targetRepo: shouldUseSonarCandidate ? sonarCandidate.repo : undefined,
        targetIssueNumber: shouldUseSonarCandidate ? sonarCandidate.issueNumber : undefined,
      });

      if (result.triggered) {
        // Set a short dispatch guard instead of the full cooldown.
        // The full cooldown is applied later via completeCycle() when the workflow reports its outcome.
        const guardSeconds = config.selfImproveDispatchGuardMinutes * 60;
        await setWithTTL(SELF_IMPROVE_COOLDOWN_KEY, String(Math.floor(Date.now() / 1000)), guardSeconds);
        await setWithTTL(SELF_IMPROVE_LAST_RUN_KEY, new Date().toISOString(), 86400 * 7);
        logger.info({ guardMinutes: config.selfImproveDispatchGuardMinutes }, "Self-improvement triggered, dispatch guard set");
        return { success: true };
      }

      return { success: false, reason: result.message || "TRIGGER_ERROR" };
    } catch (error) {
      logger.error({ error, owner, repo }, "Failed to trigger self-improvement");
      return { success: false, reason: "TRIGGER_ERROR" };
    } finally {
      await releaseLock(SELF_IMPROVE_LOCK_KEY);
    }
  }

  /**
   * Trigger self-improvement via push-based sentinel file (legacy API for workflow-trigger).
   * Returns correlation ID for tracing and legacy {triggered, message}.
   * Integrates PLAN-01 orchestration with PLAN-11 correlation tracking and failure thresholds.
   */
  async triggerImprovementLegacy(
    owner: string,
    repo: string,
    options?: { source?: string; reason?: string; force?: boolean }
  ): Promise<{ triggered: boolean; message: string; correlationId?: string }> {
    const correlationId = generateCorrelationId();
    const log = createCorrelatedLogger(correlationId);

    // PLAN-11: Check if paused due to failures
    if (this.isPaused) {
      log.warn("Self-improvement is paused due to repeated failures");
      return { triggered: false, message: "Paused due to repeated failures", correlationId };
    }

    logSelfImproveEvent(SelfImproveEvent.SCHEDULE_FIRED, { owner, repo }, correlationId);

    try {
      // PLAN-01 + PLAN-11: Budget check with failure tracking
      const budgetCheck = await this.checkBudget();
      if (!budgetCheck.allowed) {
        this.recordFailure(correlationId, "Budget exhausted");
        return {
          triggered: false,
          message: "Budget exceeded",
          correlationId,
        };
      }

      log.info({ owner, repo }, "Triggering self-improvement workflow");
      const result = await workflowTrigger.triggerSelfImprovement(owner, repo, {
        source: options?.source || "conductor",
        reason: options?.reason || "scheduled self-improvement cycle",
        force: options?.force || false,
        correlationId,
      });

      if (result.triggered) {
        logSelfImproveEvent(
          SelfImproveEvent.TRIGGER_EMITTED,
          { owner, repo, workflow: "self-improve.yml", testMode: config.selfImproveTestMode },
          correlationId
        );
        return { ...result, correlationId };
      }
      return { ...result, correlationId };
    } catch (error) {
      logger.error({ error, owner, repo }, "Failed to trigger self-improvement");
      this.recordFailure(correlationId, `Trigger failed: ${error}`);
      return {
        triggered: false,
        message: String(error),
        correlationId,
      };
    }
  }

  /**
   * Complete a self-improvement cycle with outcome-based cooldown.
   * Called by the workflow via POST /api/internal/self-improve/completed.
   */
  async completeCycle(
    outcome: CycleOutcome,
    details?: { correlationId?: string; issuesCreated?: number }
  ): Promise<void> {
    const correlationId = details?.correlationId || "unknown";

    switch (outcome) {
      case "work_produced": {
        const cooldownSeconds = config.selfImproveCooldownHours * 3600;
        await setWithTTL(SELF_IMPROVE_COOLDOWN_KEY, String(Math.floor(Date.now() / 1000)), cooldownSeconds);
        logger.info(
          { outcome, cooldownHours: config.selfImproveCooldownHours, issuesCreated: details?.issuesCreated, correlationId },
          "Self-improvement cycle completed with work, full cooldown set"
        );
        break;
      }
      case "no_findings": {
        // Keep the dispatch guard (already set) — don't extend cooldown
        logger.info(
          { outcome, correlationId },
          "Self-improvement cycle completed with no findings, dispatch guard retained"
        );
        break;
      }
      case "failed": {
        // Clear cooldown to allow faster retry
        await redisDel(SELF_IMPROVE_COOLDOWN_KEY);
        this.recordFailure(correlationId, "Workflow reported failure");
        logger.warn(
          { outcome, correlationId },
          "Self-improvement cycle failed, cooldown cleared for retry"
        );
        break;
      }
    }

    logSelfImproveEvent(
      outcome === "failed" ? SelfImproveEvent.CYCLE_FAILED : SelfImproveEvent.CYCLE_COMPLETED,
      { outcome, issuesCreated: details?.issuesCreated },
      correlationId
    );
  }

  /**
   * Legacy budget check for existing /self-improvement/* endpoints
   */
  async checkBudgetLegacy(): Promise<{ allowed: boolean; budget: number; spent: number; remaining: number }> {
    const b = await this.checkBudget();
    return {
      allowed: b.available,
      budget: b.budget ?? 0,
      spent: b.spent,
      remaining: b.remaining,
    };
  }

  /**
   * Check if a path is protected (requires human review)
   */
  isProtectedPath(path: string): boolean {
    const protectedPaths = config.selfImproveProtectedPaths.split(",");
    return protectedPaths.some((prefix) => path.startsWith(prefix.trim()));
  }
}

export const selfImprovementService = new SelfImprovementService();
