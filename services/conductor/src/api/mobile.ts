/**
 * Mobile-specific API Routes
 * Projects, tasks, dashboard
 */

import { Router, Request, Response } from "express";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { mcpRegistry } from "../services/mcp-registry.js";
import { eq } from "drizzle-orm";
import { validateMobileToken } from "../middleware/auth.js";

const router = Router();

/**
 * GET /api/projects
 * List all projects
 */
router.get("/projects", async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    // Query projects from database
    const projectList = await db.query.projects.findMany({
      orderBy: (projects, { desc }) => [desc(projects.updatedAt)],
    });

    // Filter by status if provided
    const filtered = statusFilter
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
    logger.error({ error }, "Failed to fetch projects");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch projects" } });
  }
});

/**
 * GET /api/projects/:name
 * Get project details
 */
router.get("/projects/:name", async (req: Request, res: Response) => {
  try {
    const projectName = req.params.name;

    const result = await mcpRegistry.executeTool("project_get_details", { project: projectName });

    res.json(result);
  } catch (error) {
    logger.error({ error }, "Failed to fetch project details");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch project" } });
  }
});

/**
 * GET /api/tasks
 * List tasks
 */
router.get("/tasks", async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "50" } = req.query;

    const tasksData = await db.query.tasks.findMany({
      limit: parseInt(limit as string),
      offset: (parseInt(page as string) - 1) * parseInt(limit as string),
      orderBy: (tasks, { desc }) => [desc(tasks.updatedAt)],
    });

    const total = await db.query.tasks.findMany();

    res.json({
      tasks: tasksData,
      total: total.length,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch tasks");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch tasks" } });
  }
});

/**
 * GET /api/tasks/:id
 * Get task details
 */
router.get("/tasks/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const taskId = req.params.id as string;

    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found" } });
      return;
    }

    // Get additional context via MCP tool
    const context = await mcpRegistry.executeTool("task_get_context", { task_id: taskId });

    res.json({ ...task, context });
  } catch (error) {
    logger.error({ error }, "Failed to fetch task details");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch task" } });
  }
});

/**
 * GET /api/dashboard
 * Aggregated metrics for mobile dashboard
 */
router.get("/dashboard", validateMobileToken, async (req: Request, res: Response) => {
  try {
    const { conductorOrg, conductorRepo } = await import("../config.js").then(m => m.config);

    // Define expected result type
    interface ToolResult {
      content: Array<{ type: string; text?: string }>;
    }

    const authToken = (req as any).authToken as string | undefined;
    const safeTool = async (name: string, args: Record<string, unknown>, fallbackText: string) => {
      try {
        const nextArgs = { ...args } as Record<string, unknown>;
        if (authToken && name.startsWith("gitea_") && !nextArgs.authToken) {
          nextArgs.authToken = authToken;
        }
        return (await mcpRegistry.executeTool(name, nextArgs)) as ToolResult;
      } catch (err) {
        logger.warn({ err, tool: name }, "Dashboard tool failed");
        return { content: [{ type: "text", text: fallbackText }] } as ToolResult;
      }
    };

    // Aggregate data from MCP servers
    const [health, runnerStatus, costs, metrics, activity] = await Promise.all([
      safeTool("health_check", {}, "{}"),
      safeTool("runner_get_status", {}, "{}"),
      safeTool("cost_get_summary", { period: "month" }, "{}"),
      safeTool("metrics_get", { period: "week" }, "{}"),
      safeTool("gitea_list_issues", {
        owner: conductorOrg,
        repo: conductorRepo,
        state: "all",
        limit: 5,
        page: 1
      }, "[]"),
    ]);

    // Parse activity from MCP result
    let recent_activity: any[] = [];
    try {
      if (activity && activity.content && activity.content[0]?.text) {
        const rawActivity = JSON.parse(activity.content[0].text);
        if (Array.isArray(rawActivity)) {
          recent_activity = rawActivity.map((item: any) => ({
            id: item.number,
            type: item.pull_request ? 'pr' : 'issue',
            title: item.title,
            state: item.state,
            created_at: item.created_at,
            user: item.user?.username
          }));
        }
      }
    } catch (e) {
      logger.warn({ e }, "Failed to parse activity data");
    }

    res.json({
      health: health.content?.[0]?.text ? JSON.parse(health.content[0].text) : {},
      runners: runnerStatus.content?.[0]?.text ? JSON.parse(runnerStatus.content[0].text) : {},
      costs: costs.content?.[0]?.text ? JSON.parse(costs.content[0].text) : {},
      metrics: metrics.content?.[0]?.text ? JSON.parse(metrics.content[0].text) : {},
      recent_activity,
    });
  } catch (error) {
    logger.error({ error }, "Failed to fetch dashboard data");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch dashboard" } });
  }
});

export default router;
