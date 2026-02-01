/**
 * BullMQ Worker - Processes jobs from queues
 */

import { Worker, Job } from "bullmq";
import { eq, desc } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { taskDecomposer } from "../services/task-decomposer.js";
import { agentRouter } from "../services/agent-router.js";
import { workflowTrigger } from "../services/workflow-trigger.js";
import { giteaClient } from "../services/gitea-client.js";
import { retryPolicyService, type ModelTier } from "../services/retry-policy.js";
import type {
  TaskAnalyzeJob,
  TaskRouteJob,
  ReviewAssignJob,
  PRMergeJob,
  WorkflowResultJob,
} from "./jobs.js";

const config = loadConfig();

const redisUrl = new URL(config.redisUrl);
const redisConnection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || "6379"),
  ...(redisUrl.password && { password: decodeURIComponent(redisUrl.password) }),
};

// Task queue worker
export const tasksWorker = new Worker(
  "tasks",
  async (job: Job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "Processing task job");

    switch (job.name) {
      case "task:analyze":
        return await processTaskAnalyze(job.data as TaskAnalyzeJob);
      case "task:route":
        return await processTaskRoute(job.data as TaskRouteJob);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

// Review queue worker
export const reviewsWorker = new Worker(
  "reviews",
  async (job: Job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "Processing review job");

    switch (job.name) {
      case "review:assign":
        return await processReviewAssign(job.data as ReviewAssignJob);
      case "pr:merge":
        return await processPRMerge(job.data as PRMergeJob);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  }
);

// Workflow queue worker
export const workflowsWorker = new Worker(
  "workflows",
  async (job: Job) => {
    logger.info({ jobId: job.id, jobName: job.name }, "Processing workflow job");

    switch (job.name) {
      case "workflow:result":
        return await processWorkflowResult(job.data as WorkflowResultJob);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

// Job processors
async function processTaskAnalyze(data: TaskAnalyzeJob) {
  logger.info({ issue: data.issueNumber, repo: data.repo }, "Analyzing and decomposing task");

  // Check if task needs decomposition
  const needsDecomposition = await shouldDecompose(data);

  if (needsDecomposition) {
    // Decompose into sub-tasks
    const subTasks = await taskDecomposer.decompose({
      title: data.issueTitle,
      body: data.issueBody,
      repo: data.repo,
    });

    // Create sub-task issues in Gitea
    for (const subTask of subTasks) {
      await giteaClient.createIssue(data.owner, data.repo, {
        title: subTask.title,
        body: `${subTask.description}\n\n**Parent:** #${data.issueNumber}`,
        labels: await getLabelIds(data.owner, [
          `role:${subTask.role}`,
          `complexity:${subTask.complexity}`,
          `parent:${data.issueNumber}`,
        ], data.repo),
      });
    }

    logger.info(
      { issue: data.issueNumber, subTaskCount: subTasks.length },
      "Task decomposed into sub-tasks"
    );
  } else {
    // Route directly to agent
    await agentRouter.routeTask(data);
  }
}

async function processTaskRoute(data: TaskRouteJob) {
  await agentRouter.routeTask(data);
}

async function processReviewAssign(data: ReviewAssignJob) {
  logger.info({ pr: data.prNumber, repo: data.repo }, "Assigning reviewer");

  await workflowTrigger.dispatchCodeReview({
    owner: data.owner,
    repo: data.repo,
    prNumber: data.prNumber,
    issueNumber: data.issueNumber || 0,
    modelTier: data.modelTier,
    branchName: data.branchName,
  });
}

async function processPRMerge(data: PRMergeJob) {
  logger.info({ pr: data.prNumber, repo: data.repo }, "Merging PR");

  try {
    await giteaClient.mergePullRequest(data.owner, data.repo, data.prNumber, {
      Do: "merge",
      delete_branch_after_merge: true,
      merge_message_field: `Merge PR #${data.prNumber}`,
    });

    if (data.issueNumber) {
      await giteaClient.updateIssue(data.owner, data.repo, data.issueNumber, {
        state: "closed",
      });
      logger.info({ pr: data.prNumber, issue: data.issueNumber }, "PR merged and issue closed");
    } else {
      logger.info({ pr: data.prNumber }, "PR merged");
    }

    // Check if we should resume self-improvement (queue empty and no project tasks)
    await checkAndResumeSelfImprovement();
  } catch (error) {
    logger.error({ error, pr: data.prNumber }, "Failed to merge PR");
    throw error;
  }
}

/**
 * Check if all queues are empty and no project tasks exist, then resume self-improvement
 */
async function checkAndResumeSelfImprovement() {
  try {
    const { selfImprovementService } = await import("../services/self-improvement.js");
    
    // Check if runners are idle
    const idleCheck = await selfImprovementService.checkIdleRunners();
    if (!idleCheck.idle) {
      return; // Still busy
    }

    // Check for outstanding project tasks
    const hasProjectTasks = await selfImprovementService.hasOutstandingProjectTasks();
    if (hasProjectTasks) {
      return; // Projects still have work
    }

    // All clear - resume self-improvement if it was paused
    await selfImprovementService.resumeFromProjectWork();
    logger.info("Queues empty and no project tasks - self-improvement can resume");
  } catch (error) {
    logger.error({ error }, "Failed to check/resume self-improvement");
  }
}

async function processWorkflowResult(data: WorkflowResultJob) {
  logger.info(
    { workflowRunId: data.workflowRunId, conclusion: data.conclusion },
    "Processing workflow result"
  );

  if (data.conclusion === "failure") {
    await handleWorkflowFailure(data);
  } else if (data.conclusion === "success") {
    logger.info({ workflowRunId: data.workflowRunId }, "Workflow completed successfully");
  }
}

async function handleWorkflowFailure(data: WorkflowResultJob) {
  logger.warn({ workflowRunId: data.workflowRunId }, "Workflow failed - implementing retry logic");
  const taskRecords = await db.select().from(tasks)
    .where(eq(tasks.giteaRepo, `${data.owner}/${data.repo}`))
    .orderBy(desc(tasks.updatedAt)).limit(10);
  if (taskRecords.length === 0) {
    logger.warn({ workflowRunId: data.workflowRunId }, "No task found for failed workflow");
    return;
  }
  const task = taskRecords.find((t) => t.status === "in_progress" || t.status === "failed") || taskRecords[0];
  const newRetryCount = (task.retryCount || 0) + 1;
  const currentTier = (task.currentTier || "tier1") as ModelTier;
  const decision = retryPolicyService.decideEscalation(currentTier, newRetryCount, task.lastRetryAt);
  if (decision.shouldStop) {
    await escalateToHuman(task, decision.reason);
    return;
  }
  const historyEntry = retryPolicyService.createHistoryEntry(currentTier, decision.nextTier!, newRetryCount, decision.reason);
  const newHistory = retryPolicyService.appendHistory(task.escalationHistory, historyEntry);
  await db.update(tasks).set({
    retryCount: newRetryCount, currentTier: decision.nextTier!, escalationHistory: newHistory,
    lastRetryAt: new Date(), status: "pending", updatedAt: new Date(),
  }).where(eq(tasks.id, task.id));
  await giteaClient.addComment(data.owner, data.repo, task.giteaIssueId,
    `🔄 **Retry initiated** (attempt ${newRetryCount})\n\n- Current tier: ${currentTier} → ${decision.nextTier}\n- Reason: ${decision.reason}`);
  if (decision.backoffMs && decision.backoffMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, decision.backoffMs));
  }
  if (task.prNumber) {
    await workflowTrigger.dispatchCodeReview({ owner: data.owner, repo: data.repo, prNumber: task.prNumber, issueNumber: task.giteaIssueId, modelTier: decision.nextTier!, branchName: task.branchName || "" });
  } else if (task.branchName) {
    await workflowTrigger.dispatchTaskExecution({ owner: data.owner, repo: data.repo, issueNumber: task.giteaIssueId, agentRole: task.agentRole || "developer", modelTier: decision.nextTier!, branchName: task.branchName });
  } else {
    await escalateToHuman(task, "Cannot retry: missing branch or PR");
  }
}

async function escalateToHuman(task: typeof tasks.$inferSelect, reason: string) {
  await db.update(tasks).set({ status: "failed", progressMessage: `Human review required: ${reason}`, updatedAt: new Date() }).where(eq(tasks.id, task.id));
  const [owner, repo] = task.giteaRepo.split("/");
  if (!owner || !repo) return;
  try {
    const labels = (await giteaClient.getOrgLabels(owner)) as Array<{ id: number; name: string }>;
    const humanReviewLabel = labels.find((l) => l.name === "needs-human-review");
    if (humanReviewLabel) await giteaClient.updateIssue(owner, repo, task.giteaIssueId, { labels: [humanReviewLabel.id] });
  } catch { /* ignore */ }
  await giteaClient.addComment(owner, repo, task.giteaIssueId, `⚠️ **Human review required**\n\nThis task has exhausted all automated retry attempts.\n\n**Details:**\n- Total retries: ${task.retryCount}\n- Final tier: ${task.currentTier}\n- Reason: ${reason}\n\nPlease review the task and determine next steps.`);
}

// Helper functions
async function shouldDecompose(data: TaskAnalyzeJob): Promise<boolean> {
  // Don't decompose if already has sub-task labels
  if (data.labels.some((l) => l.startsWith("parent:"))) {
    return false;
  }

  // Don't decompose if already has a role label (manually assigned)
  if (data.labels.some((l) => l.startsWith("role:"))) {
    return false;
  }

  // Decompose if the task description is long or complex
  const wordCount = data.issueTitle.split(/\s+/).length + data.issueBody.split(/\s+/).length;
  return wordCount > 200; // Simple heuristic
}

const labelCache = new Map<string, Map<string, number>>();

async function getLabelIds(owner: string, labelNames: string[], repo?: string): Promise<number[]> {
  if (labelNames.length === 0) return [];
  const cacheKey = repo ? `${owner}/${repo}` : owner;

  if (!labelCache.has(cacheKey)) {
    const labelMap = new Map<string, number>();
    try {
      const orgLabels = (await giteaClient.getOrgLabels(owner)) as Array<{ id: number; name: string }>;
      for (const l of orgLabels) labelMap.set(l.name, l.id);
    } catch { /* continue */ }
    if (repo) {
      try {
        const repoLabels = (await giteaClient.getRepoLabels(owner, repo)) as Array<{ id: number; name: string }>;
        for (const l of repoLabels) labelMap.set(l.name, l.id);
      } catch { /* continue */ }
    }
    labelCache.set(cacheKey, labelMap);
  }

  const labelMap = labelCache.get(cacheKey)!;
  const resolved: number[] = [];
  const unresolved: string[] = [];
  for (const n of labelNames) {
    const id = labelMap.get(n);
    if (id !== undefined) resolved.push(id);
    else unresolved.push(n);
  }
  if (unresolved.length > 0) {
    throw new Error(`Failed to resolve labels: ${unresolved.join(", ")}. Available: ${Array.from(labelMap.keys()).join(", ")}`);
  }
  return resolved;
}

// Error handling
tasksWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Task job failed");
});

reviewsWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Review job failed");
});

workflowsWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "Workflow job failed");
});
