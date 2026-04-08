/**
 * Internal API Routes
 * Used by gateway, runners, and MCP servers
 */

import { Router } from "express";
import { db } from "../db/client.js";
import { costRecords, projects, tasks } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { z } from "zod";
import { sql, gte, eq } from "drizzle-orm";
import { config } from "../config.js";
import { selfImprovementService } from "../services/self-improvement.js";
import { projectPlanner } from "../services/project-planner.js";
import { validateBearerToken } from "../middleware/auth.js";
import { isSonarFinding } from "../utils/issue-classification.js";
import { workflowTrigger } from "../services/workflow-trigger.js";
import { giteaClient } from "../services/gitea-client.js";


const router = Router();

// Cost record ingestion schema
const CostRecordSchema = z.object({
  task_id: z.string().uuid().optional().nullable(),
  project: z.string(),
  agent_role: z.string().optional().nullable(),
  model: z.string(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  timestamp: z.string().datetime().optional(),
});

const CostRecordBatchSchema = z.object({
  records: z.array(CostRecordSchema).min(1).max(100),
});

/**
 * POST /api/internal/costs
 * Ingest cost records from gateway callback
 */
router.post("/costs", async (req, res) => {
  try {
    // Validate single record or batch
    const isBatch = Array.isArray(req.body.records);
    const records = isBatch
      ? CostRecordBatchSchema.parse(req.body).records
      : [CostRecordSchema.parse(req.body)];

    // Insert records into database
    const inserted = await db
      .insert(costRecords)
      .values(
        records.map((record) => ({
          taskId: record.task_id || null,
          project: record.project,
          agentRole: record.agent_role || null,
          model: record.model,
          inputTokens: record.input_tokens,
          outputTokens: record.output_tokens,
          costUsd: record.cost_usd.toString(),
          createdAt: record.timestamp ? new Date(record.timestamp) : new Date(),
        }))
      )
      .returning();

    logger.info(
      { count: inserted.length, isBatch },
      "Cost records ingested"
    );

    res.json({
      success: true,
      count: inserted.length,
      ids: inserted.map((r) => r.id),
    });
  } catch (error) {
    logger.error({ error }, "Failed to ingest cost records");

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        error: "Invalid cost record format",
        details: error.errors,
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/internal/costs/summary
 * Get cost summary for a time period
 */
router.get("/costs/summary", async (req, res) => {
  try {
    const { period = "month", project, model } = req.query;

    // Calculate time range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "day":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "month":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    // Build query conditions
    const conditions = [gte(costRecords.createdAt, startDate)];
    if (project) {
      conditions.push(sql`${costRecords.project} = ${project}`);
    }
    if (model) {
      conditions.push(sql`${costRecords.model} = ${model}`);
    }

    // Get total cost and token counts
    const totalResult = await db
      .select({
        totalCost: sql<string>`COALESCE(SUM(${costRecords.costUsd}), 0)`,
        totalInputTokens: sql<string>`COALESCE(SUM(${costRecords.inputTokens}), 0)`,
        totalOutputTokens: sql<string>`COALESCE(SUM(${costRecords.outputTokens}), 0)`,
        requestCount: sql<string>`COUNT(*)`,
      })
      .from(costRecords)
      .where(sql`${sql.join(conditions, sql` AND `)}`);

    // Get breakdown by model
    const modelBreakdown = await db
      .select({
        model: costRecords.model,
        cost: sql<string>`SUM(${costRecords.costUsd})`,
        requests: sql<string>`COUNT(*)`,
      })
      .from(costRecords)
      .where(sql`${sql.join(conditions, sql` AND `)}`)
      .groupBy(costRecords.model);

    // Get breakdown by project
    const projectBreakdown = await db
      .select({
        project: costRecords.project,
        cost: sql<string>`SUM(${costRecords.costUsd})`,
      })
      .from(costRecords)
      .where(sql`${sql.join(conditions, sql` AND `)}`)
      .groupBy(costRecords.project);

    const total = totalResult[0];

    res.json({
      period,
      start_date: startDate.toISOString(),
      end_date: now.toISOString(),
      total_cost_usd: parseFloat(total.totalCost),
      total_input_tokens: parseInt(total.totalInputTokens),
      total_output_tokens: parseInt(total.totalOutputTokens),
      request_count: parseInt(total.requestCount),
      breakdown_by_model: modelBreakdown.reduce(
        (acc, row) => {
          acc[row.model] = {
            cost: parseFloat(row.cost),
            requests: parseInt(row.requests),
          };
          return acc;
        },
        {} as Record<string, { cost: number; requests: number }>
      ),
      breakdown_by_project: projectBreakdown.reduce((acc, row) => {
        acc[row.project] = parseFloat(row.cost);
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get cost summary");
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * GET /api/internal/costs/budget
 * Get budget status
 */
router.get("/costs/budget", async (req, res) => {
  try {
    const { project } = req.query;

    // Get start of current month
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

    const selfImproveSpent = parseFloat(selfImproveResult[0]?.total || "0");

    // Calculate budgets
    const monthlyBudget = config.totalMonthlyBudgetUsd;
    const selfImproveBudget = (monthlyBudget * config.selfImproveBudgetPct) / 100;

    // Calculate projections (simple linear projection based on days elapsed)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = now.getDate();
    const projectedMonthlySpend = (totalSpent / daysElapsed) * daysInMonth;

    res.json({
      project: project || "system-wide",
      budget_usd: monthlyBudget,
      spent_usd: totalSpent,
      remaining_usd: monthlyBudget - totalSpent,
      projected_monthly_usd: projectedMonthlySpend,
      self_improvement_budget_usd: selfImproveBudget,
      self_improvement_spent_usd: selfImproveSpent,
      self_improvement_remaining_usd: selfImproveBudget - selfImproveSpent,
      period: "month",
      start_date: monthStart.toISOString(),
      days_elapsed: daysElapsed,
      days_in_month: daysInMonth,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get budget status");
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

type AgentEntry = { status: string; active_tasks: number; pending_tasks: number; recent_completed: number; last_activity: string | null };

function processActiveTaskRow(
  row: { agentRole: string | null; status: string | null; count: string; latestUpdate: string },
  agentMap: Record<string, AgentEntry>,
  init: () => AgentEntry,
): void {
  const role = row.agentRole || "unassigned";
  if (!agentMap[role]) agentMap[role] = init();
  const count = parseInt(row.count);
  if (row.status === "in_progress" || row.status === "analyzing") {
    agentMap[role].active_tasks += count;
    agentMap[role].status = "working";
  } else if (row.status === "review") {
    agentMap[role].active_tasks += count;
    agentMap[role].status = agentMap[role].status === "working" ? "working" : "reviewing";
  } else if (row.status === "pending") {
    agentMap[role].pending_tasks += count;
  }
  if (row.latestUpdate) {
    const ts = new Date(row.latestUpdate).toISOString();
    if (!agentMap[role].last_activity || ts > agentMap[role].last_activity!) {
      agentMap[role].last_activity = ts;
    }
  }
}

function buildAgentMap(
  activeTasks: Array<{ agentRole: string | null; status: string | null; count: string; latestUpdate: string }>,
  recentCompleted: Array<{ agentRole: string | null; count: string }>,
): Record<string, AgentEntry> {
  const agentMap: Record<string, AgentEntry> = {};
  const init = (): AgentEntry => ({ status: "idle", active_tasks: 0, pending_tasks: 0, recent_completed: 0, last_activity: null });

  for (const row of activeTasks) processActiveTaskRow(row, agentMap, init);

  for (const row of recentCompleted) {
    const role = row.agentRole || "unassigned";
    if (!agentMap[role]) agentMap[role] = init();
    agentMap[role].recent_completed = parseInt(row.count);
  }

  return agentMap;
}

/**
 * GET /api/internal/agents/activity
 * Get per-agent-role activity status from real task data
 */
router.get("/agents/activity", async (_req, res) => {
  try {
    // Active tasks grouped by agent role
    const activeTasks = await db
      .select({
        agentRole: tasks.agentRole,
        status: tasks.status,
        count: sql<string>`count(*)`,
        latestUpdate: sql<string>`max(${tasks.updatedAt})`,
      })
      .from(tasks)
      .where(
        sql`${tasks.status} IN ('in_progress', 'analyzing', 'review', 'pending')`
      )
      .groupBy(tasks.agentRole, tasks.status);

    // Recent completed tasks (last hour) grouped by agent role
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCompleted = await db
      .select({
        agentRole: tasks.agentRole,
        count: sql<string>`count(*)`,
      })
      .from(tasks)
      .where(
        sql`${tasks.status} = 'completed' AND ${tasks.updatedAt} >= ${oneHourAgo}`
      )
      .groupBy(tasks.agentRole);

    const agentMap = buildAgentMap(activeTasks, recentCompleted);

    // Queue depth
    const { tasksQueue, reviewsQueue, workflowsQueue } = await import("../queue/jobs.js");
    const [tasksActive, reviewsActive, workflowsActive, tasksWaiting, reviewsWaiting, workflowsWaiting] = await Promise.all([
      tasksQueue.getActiveCount(),
      reviewsQueue.getActiveCount(),
      workflowsQueue.getActiveCount(),
      tasksQueue.getWaitingCount(),
      reviewsQueue.getWaitingCount(),
      workflowsQueue.getWaitingCount(),
    ]);

    res.json({
      agents: agentMap,
      pipeline: {
        active_jobs: tasksActive + reviewsActive + workflowsActive,
        queued_jobs: tasksWaiting + reviewsWaiting + workflowsWaiting,
        status: (tasksActive + reviewsActive + workflowsActive) > 0 ? "active" : "idle",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get agent activity");
    res.status(500).json({ error: "Failed to get agent activity" });
  }
});

/**
 * GET /api/internal/runners/status
 * Get runner status for self-improvement checks
 */
router.get("/runners/status", async (_req, res) => {
  try {
    const { tasksQueue, reviewsQueue, workflowsQueue } = await import("../queue/jobs.js");

    const [tasksWaiting, tasksActive, reviewsWaiting, reviewsActive, workflowsWaiting, workflowsActive] = await Promise.all([
      tasksQueue.getWaitingCount(),
      tasksQueue.getActiveCount(),
      reviewsQueue.getWaitingCount(),
      reviewsQueue.getActiveCount(),
      workflowsQueue.getWaitingCount(),
      workflowsQueue.getActiveCount(),
    ]);

    const queueDepth = tasksWaiting + reviewsWaiting + workflowsWaiting;
    const totalActive = tasksActive + reviewsActive + workflowsActive;
    const totalRunners = 2;
    const activeRunners = Math.min(totalActive, totalRunners);
    const idleRunners = totalRunners - activeRunners;

    res.json({
      total_runners: totalRunners,
      active_runners: activeRunners,
      idle_runners: idleRunners,
      queue_depth: queueDepth,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, "Failed to get runner status");
    res.status(500).json({ error: "Failed to get runner status" });
  }
});

/**
 * GET /api/internal/runners/idle-count
 * Get count of idle runners (using real BullMQ metrics)
 */
router.get("/runners/idle-count", async (_req, res) => {
  try {
    const { tasksQueue, reviewsQueue, workflowsQueue } = await import("../queue/jobs.js");

    const [tasksActive, reviewsActive, workflowsActive] = await Promise.all([
      tasksQueue.getActiveCount(),
      reviewsQueue.getActiveCount(),
      workflowsQueue.getActiveCount(),
    ]);

    const totalActive = tasksActive + reviewsActive + workflowsActive;
    const totalRunners = 2;
    const activeRunners = Math.min(totalActive, totalRunners);
    const idleRunners = totalRunners - activeRunners;

    res.json({ idle_count: idleRunners, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error({ error }, "Failed to get idle count");
    res.status(500).json({ error: "Failed to get idle count" });
  }
});

/**
 * GET /api/internal/metrics
 * Get platform performance metrics
 * PROTECTED: requires bearer token
 */
router.get("/metrics", validateBearerToken, async (req, res) => {
  try {
    const { period = "week" } = req.query;

    // Calculate time range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "day":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "week":
      default:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 7);
        break;
    }

    // Query tasks stats
    const stats = await db
      .select({
        status: tasks.status,
        count: sql<string>`count(*)`,
      })
      .from(tasks)
      .where(gte(tasks.createdAt, startDate))
      .groupBy(tasks.status);

    const metrics = stats.reduce(
      (acc, curr) => {
        const count = parseInt(curr.count);
        acc.total_tasks += count;

        switch (curr.status) {
          case "completed":
            acc.completed_tasks += count;
            break;
          case "in_progress":
          case "analyzing":
          case "review":
            acc.active_tasks += count;
            break;
          case "pending":
            acc.pending_tasks += count;
            break;
        }
        return acc;
      },
      {
        total_tasks: 0,
        completed_tasks: 0,
        active_tasks: 0,
        pending_tasks: 0,
      }
    );

    res.json(metrics);
  } catch (error) {
    logger.error({ error }, "Failed to get metrics");
    res.status(500).json({ error: "Failed to get metrics" });
  }
});

/**
 * GET /api/internal/self-improvement/check
 * Check if self-improvement should be triggered
 * Returns: { should_trigger: boolean, reason: string, budget_status: {...} }
 */
router.get("/self-improvement/check", async (req, res) => {
  try {
    const { owner, repo } = req.query;

    if (!owner || !repo) {
      res.status(400).json({
        error: "owner and repo query parameters are required",
      });
      return;
    }

    // Import self-improvement service dynamically to avoid circular deps
    const { selfImprovementService } = await import("../services/self-improvement.js");

    // Check budget first
    const budgetStatus = await selfImprovementService.checkBudget();

    if (!budgetStatus.allowed) {
      logger.warn(
        {
          budget: budgetStatus.budget,
          spent: budgetStatus.spent,
          remaining: budgetStatus.remaining,
        },
        "Self-improvement blocked: budget exceeded"
      );

      res.json({
        should_trigger: false,
        reason: "budget_exceeded",
        budget_status: budgetStatus,
      });
      return;
    }

    // Check if runners are idle
    const { idle: runnersIdle } = await selfImprovementService.checkIdleRunners();

    if (!runnersIdle) {
      logger.info({}, "Self-improvement deferred: runners are busy");

      res.json({
        should_trigger: false,
        reason: "runners_busy",
        budget_status: budgetStatus,
      });
      return;
    }

    // All checks passed
    logger.info(
      {
        owner,
        repo,
        budgetRemaining: budgetStatus.remaining,
      },
      "Self-improvement checks passed"
    );

    res.json({
      should_trigger: true,
      reason: "all_checks_passed",
      budget_status: budgetStatus,
    });
  } catch (error) {
    logger.error({ error }, "Failed to check self-improvement eligibility");
    res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/internal/self-improvement/trigger
 * Trigger self-improvement workflow (with budget gate)
 */
router.post("/self-improvement/trigger", async (req, res) => {
  try {
    const { owner, repo } = req.body;

    if (!owner || !repo) {
      res.status(400).json({
        error: "owner and repo are required",
      });
      return;
    }

    // Import self-improvement service dynamically
    const { selfImprovementService } = await import("../services/self-improvement.js");

    // Check budget gate
    const budgetStatus = await selfImprovementService.checkBudget();

    if (!budgetStatus.allowed) {
      logger.warn(
        {
          owner,
          repo,
          budget: budgetStatus.budget,
          spent: budgetStatus.spent,
        },
        "Self-improvement trigger blocked: budget exceeded"
      );

      res.status(403).json({
        success: false,
        error: "Budget exceeded",
        budget_status: budgetStatus,
      });
      return;
    }

    // Trigger the workflow (legacy flow - budget already checked above)
    const result = await selfImprovementService.triggerImprovementLegacy(owner, repo, {
      source: "api",
      reason: "manual trigger",
    });

    if (!result.triggered) {
      res.status(409).json({
        success: false,
        error: result.message,
        budget_status: budgetStatus,
      });
      return;
    }

    logger.info(
      {
        owner,
        repo,
        budgetRemaining: budgetStatus.remaining,
      },
      "Self-improvement workflow triggered"
    );

    res.json({
      success: true,
      budget_status: budgetStatus,
    });
  } catch (error) {
    logger.error({ error }, "Failed to trigger self-improvement");
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * POST /api/internal/self-improve/resume
 * Manually resume self-improvement after auto-pause (PLAN-11)
 * PROTECTED: requires bearer token
 */
router.post("/self-improve/resume", validateBearerToken, async (_req, res): Promise<void> => {
  try {
    const { selfImprovementService } = await import("../services/self-improvement.js");
    selfImprovementService.resumeSelfImprovement();
    res.json({ success: true, message: "Self-improvement resumed" });
  } catch (error) {
    logger.error({ error }, "Failed to resume self-improvement");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /api/internal/tasks/active
 * List active tasks across projects for conductor MCP tools
 * PROTECTED: requires bearer token
 */
router.get("/tasks/active", validateBearerToken, async (req, res) => {
  try {
    const projectFilter = typeof req.query.project === "string" ? req.query.project : undefined;
    const roleFilter = typeof req.query.role === "string" ? req.query.role : undefined;
    const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
    const activeStatuses = new Set(["analyzing", "in_progress", "review"]);

    const taskList = await db.query.tasks.findMany({
      orderBy: (tasks, { desc }) => [desc(tasks.updatedAt)],
    });

    const filtered = taskList.filter((task) => {
      const matchesStatus = statusFilter ? task.status === statusFilter : activeStatuses.has(task.status);
      const matchesProject = projectFilter ? task.giteaRepo.toLowerCase().includes(projectFilter.toLowerCase()) : true;
      const matchesRole = roleFilter ? task.agentRole === roleFilter : true;
      return matchesStatus && matchesProject && matchesRole;
    });

    res.json({
      tasks: filtered.map((task) => ({
        id: task.id,
        issue_id: task.giteaIssueId,
        project: task.giteaRepo,
        status: task.status,
        agent_role: task.agentRole,
        model_tier: task.modelTier,
        branch_name: task.branchName,
        pr_number: task.prNumber,
        progress: task.progress,
        progress_message: task.progressMessage,
        updated_at: task.updatedAt,
      })),
      total: filtered.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to list active tasks");
    res.status(500).json({ error: "Failed to list active tasks" });
  }
});

/**
 * POST /api/internal/tasks/:id/progress
 * Update task progress from runner
 * PROTECTED: requires bearer token
 */
router.post("/tasks/:id/progress", validateBearerToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { progress, message } = req.body;

    // TODO: Update task in database
    logger.info({ taskId: id, progress, message }, "Task progress updated");

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to update task progress");
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * PLAN-01: Self-improvement orchestration API (authenticated)
 * POST /api/internal/self-improve/check
 * PROTECTED: requires bearer token
 */
router.post("/self-improve/check", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ error: "Missing required fields: owner, repo" });
      return;
    }
    const result = await selfImprovementService.checkReadiness(owner, repo);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "Failed to check self-improvement readiness");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PLAN-01: Self-improvement orchestration API (authenticated)
 * POST /api/internal/self-improve/trigger
 * PROTECTED: requires bearer token
 */
router.post("/self-improve/trigger", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const TriggerSchema = z.object({
      owner: z.string().min(1),
      repo: z.string().min(1),
      source: z.enum(["sonar_backlog", "self_findings"]).optional(),
    });
    const parsed = TriggerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { owner, repo, source } = parsed.data;
    if (!owner || !repo) {
      res.status(400).json({ error: "Missing required fields: owner, repo" });
      return;
    }
    const result = await selfImprovementService.triggerImprovement(owner, repo, { source });
    if (result.success) {
      res.json(result);
    } else {
      res.status(409).json(result);
    }
  } catch (error) {
    logger.error({ error }, "Failed to trigger self-improvement");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /api/internal/self-improve/route-sonar
 * Called by self-improve workflow to route a selected Sonar issue via normal task execution.
 * PROTECTED: requires bearer token
 */
const RouteSonarIssueSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issue_number: z.number().int().positive(),
  model_tier: z.string().default("tier2"),
});

router.post("/self-improve/route-sonar", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const parsed = RouteSonarIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { owner, repo, issue_number, model_tier } = parsed.data;
    const { giteaClient } = await import("../services/gitea-client.js");
    const { agentRouter } = await import("../services/agent-router.js");
    const issue: any = await giteaClient.getIssue(owner, repo, issue_number);
    const labels = (issue.labels || []).map((l: any) => l.name);
    if (!isSonarFinding({ labels, body: issue.body || "" })) {
      res.status(409).json({ success: false, error: "Issue is not classified as sonar backlog" });
      return;
    }
    if (Array.isArray(issue.assignees) && issue.assignees.length > 0) {
      res.status(409).json({ success: false, error: "Issue is already assigned" });
      return;
    }

    await agentRouter.routeTask({
      owner,
      repo,
      issueNumber: issue_number,
      issueTitle: issue.title || `Issue #${issue_number}`,
      issueBody: issue.body || "",
      labels: labels.includes("role:developer") ? labels : [...labels, "role:developer"],
    });

    logger.info(
      { owner, repo, issue: issue_number, modelTier: model_tier },
      "Sonar issue routed via self-improvement endpoint"
    );
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Failed to route Sonar issue from self-improvement");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /api/internal/self-improve/completed
 * Called by the self-improve workflow to report its outcome.
 * Sets the appropriate cooldown based on whether work was produced.
 * PROTECTED: requires bearer token
 */
const CycleOutcomeSchema = z.object({
  outcome: z.enum(["work_produced", "no_findings", "failed"]),
  correlation_id: z.string().optional(),
  issues_created: z.number().int().nonnegative().optional(),
});

router.post("/self-improve/completed", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const parsed = CycleOutcomeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const { outcome, correlation_id, issues_created } = parsed.data;
    await selfImprovementService.completeCycle(outcome, {
      correlationId: correlation_id,
      issuesCreated: issues_created,
    });
    res.json({ success: true, outcome });
  } catch (error) {
    logger.error({ error }, "Failed to process self-improvement completion");
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

const ReexecuteFailedBranchesSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  limit: z.number().int().positive().max(200).default(20),
  dry_run: z.boolean().default(true),
  priority_mode: z.enum(["oldest-first", "highest-priority-first"]).default("oldest-first"),
});

router.post("/recovery/reexecute-failed-branches", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const parsed = ReexecuteFailedBranchesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { owner, repo, limit, dry_run, priority_mode } = parsed.data;
    const repoFull = `${owner}/${repo}`;
    const taskRows = await db.select().from(tasks).where(eq(tasks.giteaRepo, repoFull));
    const candidates = taskRows
      .filter((t) => (t.status === "pending" || t.status === "failed") && t.branchName)
      .sort((a, b) => {
        if (priority_mode === "highest-priority-first") {
          const aRetry = a.retryCount || 0;
          const bRetry = b.retryCount || 0;
          return bRetry - aRetry || a.updatedAt.getTime() - b.updatedAt.getTime();
        }
        return a.updatedAt.getTime() - b.updatedAt.getTime();
      })
      .slice(0, limit);

    const openPullsResult = await giteaClient.listPullRequests(owner, repo, { state: "open", limit: 100 });
    const openPulls: any[] = Array.isArray(openPullsResult) ? openPullsResult : [];
    const openBranchSet = new Set(
      openPulls
        .map((pr: any) => pr?.head?.ref)
        .filter((ref: unknown): ref is string => typeof ref === "string" && ref.length > 0)
    );

    const results = {
      dry_run,
      repo: repoFull,
      candidates: [] as Array<{ task_id: string; issue_number: number; branch_name: string }>,
      skipped: [] as Array<{ task_id: string; issue_number: number; reason: string }>,
      dispatched: [] as Array<{ task_id: string; issue_number: number; branch_name: string }>,
    };

    for (const task of candidates) {
      const branchName = task.branchName!;
      const issue: any = await giteaClient.getIssue(owner, repo, task.giteaIssueId);
      if (issue?.state !== "open") {
        results.skipped.push({ task_id: task.id, issue_number: task.giteaIssueId, reason: "issue_closed" });
        continue;
      }
      if (openBranchSet.has(branchName)) {
        results.skipped.push({ task_id: task.id, issue_number: task.giteaIssueId, reason: "open_pr_exists" });
        continue;
      }

      results.candidates.push({ task_id: task.id, issue_number: task.giteaIssueId, branch_name: branchName });
      if (dry_run) continue;

      await workflowTrigger.dispatchTaskExecution({
        owner,
        repo,
        issueNumber: task.giteaIssueId,
        agentRole: task.agentRole || "developer",
        modelTier: task.currentTier || task.modelTier || "tier2",
        branchName,
      });
      await giteaClient.addComment(
        owner,
        repo,
        task.giteaIssueId,
        "🔁 **Recovery dispatch initiated** from stored task branch."
      );
      results.dispatched.push({ task_id: task.id, issue_number: task.giteaIssueId, branch_name: branchName });
    }

    res.json(results);
  } catch (error) {
    logger.error({ error }, "Failed to re-execute failed branches");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CleanupImportedProjectSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  mode: z.enum(["reimport", "reconcile"]).default("reconcile"),
  limit: z.number().int().positive().max(500).default(100),
  dry_run: z.boolean().default(true),
  before_timestamp: z.string().datetime().optional(),
});

router.post("/recovery/cleanup-imported-project", validateBearerToken, async (req, res): Promise<void> => {
  try {
    const parsed = CleanupImportedProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const { owner, repo, mode, limit, dry_run, before_timestamp } = parsed.data;
    const repoFull = `${owner}/${repo}`;
    const beforeDate = before_timestamp ? new Date(before_timestamp) : null;

    if (mode === "reimport") {
      res.json({
        dry_run,
        repo: repoFull,
        mode,
        actions: [],
        message: "Re-import mode requires operator-driven execution; this endpoint provides planning metadata only.",
      });
      return;
    }

    const openIssuesResult = await giteaClient.listIssues(owner, repo, { state: "open", limit: 200 });
    const openIssues: any[] = Array.isArray(openIssuesResult) ? openIssuesResult : [];
    const repoTasks = await db.select().from(tasks).where(eq(tasks.giteaRepo, repoFull));
    const staleTasks = repoTasks.filter((t) => {
      const staleByTime = !beforeDate || (t.createdAt && t.createdAt <= beforeDate);
      return staleByTime && (t.status === "pending" || t.status === "failed" || t.status === "in_progress");
    });
    const staleIssueIds = new Set(staleTasks.map((t) => t.giteaIssueId));

    const candidates = openIssues
      .filter((issue: any) => {
        const labels = (issue.labels || []).map((l: any) => l.name);
        const assignedToBot = Array.isArray(issue.assignees) && issue.assignees.some((a: any) => a.login === "cuemarshal-bot");
        return assignedToBot && staleIssueIds.has(issue.number) && isSonarFinding({ labels, body: issue.body || "" });
      })
      .slice(0, limit);

    const result = {
      dry_run,
      repo: repoFull,
      mode,
      stale_issue_candidates: candidates.map((issue: any) => ({
        issue_number: issue.number,
        title: issue.title,
      })),
      stale_task_candidates: staleTasks
        .filter((t) => candidates.some((issue: any) => issue.number === t.giteaIssueId))
        .map((t) => ({ task_id: t.id, issue_number: t.giteaIssueId, status: t.status })),
      actions_taken: [] as Array<{ issue_number: number; action: string }>,
    };

    if (dry_run) {
      res.json(result);
      return;
    }

    for (const issue of candidates) {
      await giteaClient.updateIssue(owner, repo, issue.number, { assignees: [] });
      await giteaClient.addComment(
        owner,
        repo,
        issue.number,
        "🧹 **Automation cleanup applied**: stale pre-fix assignment/task state has been reset for reclassification."
      );
      result.actions_taken.push({ issue_number: issue.number, action: "assignment_cleared" });
    }

    const candidateIssueIds = new Set(candidates.map((issue: any) => issue.number));
    const tasksToArchive = staleTasks.filter((task) => candidateIssueIds.has(task.giteaIssueId));
    for (const task of tasksToArchive) {
      await db.update(tasks)
        .set({
          status: "failed",
          progressMessage: "Archived by imported-project cleanup reconcile",
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
    }

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Failed to clean up imported project");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/internal/projects
 * List all projects (used by conductor-mcp project_list tool)
 * PROTECTED: requires bearer token
 */
router.get("/projects", validateBearerToken, async (req, res) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    const projectList = await db.query.projects.findMany({
      orderBy: (projects, { desc }) => [desc(projects.updatedAt)],
    });

    const filtered = statusFilter && statusFilter !== "all"
      ? projectList.filter((p) => p.status === statusFilter)
      : projectList;

    res.json({
      projects: filtered.map((p) => ({
        id: p.id,
        name: p.name,
        repo: p.giteaRepo,
        description: p.description,
        status: p.status,
        goals: p.goals,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
      total: filtered.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to list projects");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

/**
 * POST /api/internal/projects/plan
 * Generate a project plan
 * PROTECTED: requires bearer token
 */
router.post("/projects/plan", validateBearerToken, async (req, res) => {
  try {
    const { name, description, goals } = req.body;

    if (!name || !description) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }

    // Generate plan
    const plan = await projectPlanner.planProject({ name, description, goals: goals || [] });

    // Create project record
    const [project] = await db.insert(projects).values({
      giteaRepo: `${config.conductorOrg}/${name}`,
      name,
      description,
      goals: goals || [],
      plan,
      status: "pending_approval",
    }).returning();

    logger.info({ projectId: project.id, repo: project.giteaRepo }, "Project plan generated");

    res.json({
      project: {
        id: project.id,
        name: project.name,
        repo: project.giteaRepo,
        status: project.status,
      },
      plan,
    });
  } catch (error) {
    logger.error({ error }, "Failed to generate project plan");
    res.status(500).json({ error: "Failed to generate project plan" });
  }
});

/**
 * POST /api/internal/projects/:name/execute
 * Execute an approved project plan
 * PROTECTED: requires bearer token
 */
router.post("/projects/:name/execute", validateBearerToken, async (req, res) => {
  try {
    const projectNameParam = req.params.name;
    const projectName = Array.isArray(projectNameParam) ? projectNameParam[0] : projectNameParam;
    if (!projectName) {
      res.status(400).json({ error: "Project name is required" });
      return;
    }
    // TODO: Support plan modifications through natural language
    // const { modifications } = req.body;

    // Get project from database
    const project = await db.query.projects.findFirst({
      where: eq(projects.name, projectName),
    });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (project.status !== "pending_approval") {
      res.status(400).json({ error: `Project is in ${project.status} state, cannot execute` });
      return;
    }

    // TODO: If modifications provided, regenerate plan with LLM
    const planToExecute = project.plan as any;

    // Execute the plan
    const [owner, repo] = project.giteaRepo.split("/");
    const result = await projectPlanner.executePlan(owner, repo, planToExecute);

    // Update project status
    await db.update(projects)
      .set({
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(projects.id, project.id));

    logger.info({ projectId: project.id, milestones: result.milestones.length, issues: result.issues.length }, "Project plan executed");

    res.json({
      success: true,
      milestones_created: result.milestones.length,
      issues_created: result.issues.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to execute project plan");
    res.status(500).json({ error: "Failed to execute project plan" });
  }
});

/**
 * GET /api/internal/projects/:name/progress
 * Get project progress
 * PROTECTED: requires bearer token
 */
router.get("/projects/:name/progress", validateBearerToken, async (req, res) => {
  try {
    const projectNameParam = req.params.name;
    const projectName = Array.isArray(projectNameParam) ? projectNameParam[0] : projectNameParam;
    if (!projectName) {
      res.status(400).json({ error: "Project name is required" });
      return;
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.name, projectName),
    });

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [owner, repo] = project.giteaRepo.split("/");
    const progress = await projectPlanner.checkProjectProgress(owner, repo);

    res.json(progress);
  } catch (error) {
    logger.error({ error }, "Failed to get project progress");
    res.status(500).json({ error: "Failed to get project progress" });
  }
});

export default router;
