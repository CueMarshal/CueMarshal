/**
 * Recovery Service - Self-Healing for Orphaned Issues
 * 
 * Detects issues that were never processed due to:
 * - Missed webhooks (network failure, Gitea restart, etc.)
 * - Database migration issues
 * - Conductor crashes
 * - Workflow trigger failures
 * 
 * Two recovery passes:
 * 1. Assigned but unexecuted — issues assigned to cuemarshal-bot with no task record
 * 2. Unassigned but actionable — issues with role/self-improvement labels that were never picked up
 */

import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { giteaClient } from "../services/gitea-client.js";
import { agentRouter } from "../services/agent-router.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";
import { eq } from "drizzle-orm";

const config = loadConfig();

const ACTIONABLE_LABELS = ["self-improvement", "role:architect", "role:developer", "role:tester", "role:devops", "role:docs", "role:reviewer"];
const SKIP_LABELS = ["skip-automation", "needs-human-review", "status:in-progress"];

function hasAnyLabel(issue: any, names: string[]): boolean {
  const issueLabels: string[] = issue.labels?.map((l: any) => l.name) || [];
  return names.some((n) => issueLabels.includes(n));
}

export class RecoveryService {
  /**
   * Find and re-trigger orphaned issues
   */
  async recoverOrphanedIssues(): Promise<void> {
    logger.info("Running orphaned issue recovery...");

    const org = config.conductorOrg;
    const repo = config.conductorRepo;
    
    if (!repo) {
      logger.warn(
        "No repository configured for RecoveryService (config.conductorRepo); skipping recovery"
      );
      return;
    }

    try {
      const allOpenIssues = (await giteaClient.listIssues(org, repo, {
        state: "open",
        page: 1,
        limit: 100,
      })) as any[];

      let recoveredCount = 0;

      // Pass 1: Assigned issues with missing or failed task records
      const botAssignedIssues = allOpenIssues.filter((issue: any) =>
        issue.assignees?.some((a: any) => a.login === "cuemarshal-bot")
      );

      for (const issue of botAssignedIssues) {
        const existingTask = await db.query.tasks.findFirst({
          where: eq(tasks.giteaIssueId, issue.number),
        });

        if (!existingTask) {
          logger.info(
            { issue: issue.number, title: issue.title },
            "Orphaned assigned issue - re-triggering"
          );
          await agentRouter.routeTask({
            owner: org,
            repo,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueBody: issue.body || "",
            labels: issue.labels?.map((l: any) => l.name) || [],
          });
          recoveredCount++;
        } else if (existingTask.status === "failed") {
          logger.info(
            { issue: issue.number, taskId: existingTask.id },
            "Failed task - re-triggering"
          );
          await agentRouter.routeTask({
            owner: org,
            repo,
            issueNumber: issue.number,
            issueTitle: issue.title,
            issueBody: issue.body || "",
            labels: issue.labels?.map((l: any) => l.name) || [],
          });
          recoveredCount++;
        }
      }

      // Pass 2: Unassigned issues with actionable labels (missed webhooks)
      const unassignedIssues = allOpenIssues.filter((issue: any) => {
        const hasAssignees = issue.assignees && issue.assignees.length > 0;
        if (hasAssignees) return false;
        if (hasAnyLabel(issue, SKIP_LABELS)) return false;
        if (!hasAnyLabel(issue, ACTIONABLE_LABELS)) return false;

        // Skip issues created in the last 2 minutes (webhook may still be in flight)
        const createdAt = new Date(issue.created_at);
        const ageMs = Date.now() - createdAt.getTime();
        return ageMs > 2 * 60 * 1000;
      });

      if (unassignedIssues.length > 0) {
        logger.info(
          { count: unassignedIssues.length },
          "Found unassigned actionable issues (likely missed webhooks)"
        );
      }

      for (const issue of unassignedIssues) {
        const existingTask = await db.query.tasks.findFirst({
          where: eq(tasks.giteaIssueId, issue.number),
        });

        if (existingTask) continue;

        logger.info(
          { issue: issue.number, title: issue.title },
          "Missed-webhook issue detected - routing"
        );
        await agentRouter.routeTask({
          owner: org,
          repo,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body || "",
          labels: issue.labels?.map((l: any) => l.name) || [],
        });
        recoveredCount++;
      }

      logger.info({ recoveredCount }, "Orphaned issue recovery completed");
    } catch (error) {
      logger.error({ error }, "Recovery failed");
    }
  }
}

export const recoveryService = new RecoveryService();
