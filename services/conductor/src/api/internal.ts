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

function buildAgentMap(
  activeTasks: Array<{ agentRole: string | null; status: string | null; count: string; latestUpdate: string }>,
  recentCompleted: Array<{ agentRole: string | null; count: string }>,
): Record<string, AgentEntry> {
  const agentMap: Record<string, AgentEntry> = {};
  const init = (): AgentEntry => ({ status: "idle", active_tasks: 0, pending_tasks: 0, recent_completed: 0, last_activity: null });

  for (const row of activeTasks) {
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
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ error: "Missing required fields: owner, repo" });
      return;
    }
    const result = await selfImprovementService.triggerImprovement(owner, repo);
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
