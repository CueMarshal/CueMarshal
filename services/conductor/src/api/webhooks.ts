/**
 * Gitea Webhook Handler with Production Safety Guardrails
 */

import { Router, Request, Response } from "express";
import { createClient } from "redis";
import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { verifyWebhookSignature } from "../utils/crypto.js";
import { validateBearerToken } from "../middleware/auth.js";
import {
  enqueueTaskAnalyze,
  enqueueTaskRoute,
  enqueueReviewAssign,
  enqueuePRMerge,
  enqueueWorkflowResult,
} from "../queue/jobs.js";
import { giteaClient } from "../services/gitea-client.js";
import { db } from "../db/client.js";
import { projects } from "../db/schema.js";
import { eq } from "drizzle-orm";

const config = loadConfig();
const router = Router();

// Redis client for idempotency and loop detection
const redis = createClient({ url: config.redisUrl });

// Lazy connect - will connect on first webhook
let redisConnected = false;
async function ensureRedisConnected() {
  if (!redisConnected) {
    await redis.connect();
    redisConnected = true;
  }
}

const BOT_USERS = config.botUsernames.split(",").map(u => u.trim());
const BOT_IGNORED_EVENTS = ["issue_comment", "issues.assigned"];

/**
 * POST /webhooks/gitea
 * Receives all Gitea webhook events with safety guardrails:
 * - Bearer token authentication
 * - Signature verification
 * - Idempotency checking
 * - Bot filtering
 * - Loop detection
 */
router.post("/gitea", validateBearerToken, async (req: Request, res: Response): Promise<void> => {
  await ensureRedisConnected();

  const signature = req.headers["x-gitea-signature"] as string;
  const event = req.headers["x-gitea-event"] as string;
  const delivery = req.headers["x-gitea-delivery"] as string;
  const sender = req.body.sender;

  // 1. Signature verification
  const payload = (req as any).rawBody?.toString() || JSON.stringify(req.body);
  if (!verifyWebhookSignature(payload, signature, config.webhookSecret)) {
    logger.warn({ delivery, event, sender: sender?.login }, "Invalid webhook signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // 2. Idempotency check (prevent duplicate processing)
  const idempotencyKey = `webhook:${delivery}`;
  const alreadyProcessed = await redis.get(idempotencyKey);
  
  if (alreadyProcessed) {
    logger.debug({ delivery }, "Duplicate webhook delivery ignored");
    res.status(200).json({ received: true, duplicate: true });
    return;
  }

  // Mark as processing (TTL prevents stale keys)
  await redis.setEx(idempotencyKey, config.webhookIdempotencyTTL, Date.now().toString());

  // 3. Bot filter (prevent bot-triggered cascades)
  if (sender && BOT_USERS.includes(sender.login)) {
    if (BOT_IGNORED_EVENTS.includes(event)) {
      logger.debug({ delivery, sender: sender.login, event }, "Bot event filtered");
      res.status(200).json({ received: true, filtered: "bot" });
      return;
    }
  }

  // 4. Loop detection (circuit breaker)
  const issueOrPR = req.body.issue?.number || req.body.pull_request?.number;
  const repoId = req.body.repository?.id;
  
  if (issueOrPR && repoId) {
    const loopKey = `event-chain:${repoId}:${issueOrPR}`;
    const chainCount = await redis.incr(loopKey);
    await redis.expire(loopKey, 300); // 5 minute sliding window

    if (chainCount > config.webhookLoopThreshold) {
      logger.error(
        { delivery, chainCount, issue: issueOrPR, threshold: config.webhookLoopThreshold },
        "Webhook loop detected - circuit breaker activated"
      );
      
      // Warn on the issue
      const [owner, repo] = req.body.repository.full_name.split("/");
      await giteaClient.addComment(
        owner,
        repo,
        issueOrPR,
        `⚠️ **Webhook Loop Detected**\n\nAutomation has been paused for this issue after ${chainCount} events in 5 minutes.\n\nPlease review the activity log and resolve manually.`
      );
      
      res.status(200).json({ received: true, filtered: "loop_protection" });
      return;
    }
  }

  logger.info({ event, delivery, sender: sender?.login }, "Webhook accepted");

  // 5. Respond immediately (Gitea timeout is 30s)
  res.status(200).json({ received: true });

  // 6. Process asynchronously
  try {
    await handleWebhookEvent(event, req.body);
  } catch (error) {
    logger.error({ error, event, delivery }, "Webhook processing failed");
  }
});

async function handleWebhookEvent(event: string, payload: any) {
  const action = payload.action;

  switch (event) {
    case "issues":
      if (action === "opened") {
        await handleIssueOpened(payload);
      } else if (action === "labeled") {
        await handleIssueLabeled(payload);
      }
      break;

    case "pull_request":
      if (action === "opened") {
        await handlePROpened(payload);
      } else if (action === "closed" && payload.pull_request.merged) {
        await handlePRMerged(payload);
      }
      break;

    case "pull_request_review":
      if (action === "submitted") {
        await handlePRReviewSubmitted(payload);
      }
      break;

    case "workflow_run":
      if (action === "completed") {
        await handleWorkflowCompleted(payload);
      }
      break;

    default:
      logger.debug({ event }, "Unhandled webhook event");
  }
}

async function handleIssueOpened(payload: any) {
  const issue = payload.issue;
  const repo = payload.repository;

  // Skip if it's a bot-created sub-task
  if (issue.labels?.some((l: any) => l.name.startsWith("parent:"))) {
    logger.debug({ issue: issue.number }, "Skipping sub-task issue");
    return;
  }

  // Skip if labeled to skip automation
  if (issue.labels?.some((l: any) => l.name === "skip-automation")) {
    logger.debug({ issue: issue.number }, "Skipping automated issue");
    return;
  }

  const [owner, repoName] = repo.full_name.split("/");

  await enqueueTaskAnalyze({
    owner,
    repo: repoName,
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body || "",
    labels: issue.labels?.map((l: any) => l.name) || [],
  });

  // Pause self-improvement if this is a project task (not self-improvement)
  const repoFull = `${owner}/${repoName}`;
  const isSelfImproveRepo = repoName === config.conductorRepo && owner === config.conductorOrg;
  
  if (!isSelfImproveRepo) {
    // This is a project task - pause self-improvement to prioritize it
    const { selfImprovementService } = await import("../services/self-improvement.js");
    await selfImprovementService.pauseForProjectWork();
    logger.info({ repo: repoFull, issue: issue.number }, "Project task detected - self-improvement paused");
  }
}

async function handleIssueLabeled(payload: any) {
  const issue = payload.issue;
  const repo = payload.repository;
  const newLabel = payload.label;

  // If a role label was added, re-route the task
  if (newLabel.name.startsWith("role:")) {
    const [owner, repoName] = repo.full_name.split("/");

    await enqueueTaskRoute({
      owner,
      repo: repoName,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body || "",
      labels: issue.labels?.map((l: any) => l.name) || [],
    });
  }
}

async function handlePROpened(payload: any) {
  const pr = payload.pull_request;
  const repo = payload.repository;
  const [owner, repoName] = repo.full_name.split("/");

  // Extract linked issue number from PR body
  const issueMatch = pr.body?.match(/(?:Resolves|Closes|Fixes)\s+#(\d+)/i);
  const issueNumber = issueMatch ? parseInt(issueMatch[1]) : null;

  await enqueueReviewAssign({
    owner,
    repo: repoName,
    prNumber: pr.number,
    issueNumber,
    modelTier: "tier2",
    branchName: pr.head?.ref || "",
  });
}

async function handlePRReviewSubmitted(payload: any) {
  const review = payload.review;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const [owner, repoName] = repo.full_name.split("/");

  if (review.state === "APPROVED") {
    // Extract issue number
    const issueMatch = pr.body?.match(/(?:Resolves|Closes|Fixes)\s+#(\d+)/i);
    const issueNumber = issueMatch ? parseInt(issueMatch[1]) : null;

    await enqueuePRMerge({
      owner,
      repo: repoName,
      prNumber: pr.number,
      issueNumber,
    });
  } else if (review.state === "REQUEST_CHANGES") {
    logger.info({ pr: pr.number }, "Changes requested - developer will need to revise");
    // TODO: Trigger revision workflow
  }
}

async function handlePRMerged(payload: any) {
  const pr = payload.pull_request;
  
  // Extract issue number and close it
  const issueMatch = pr.body?.match(/(?:Resolves|Closes|Fixes)\s+#(\d+)/i);
  if (issueMatch) {
    const issueNumber = parseInt(issueMatch[1]);
    logger.info({ pr: pr.number, issue: issueNumber }, "PR merged, closing issue");
    
    // Close the issue
    const [owner, repo] = payload.repository.full_name.split("/");
    await giteaClient.updateIssue(owner, repo, issueNumber, { state: "closed" });
    
    // Check for parent task auto-closure
    await checkParentTaskClosure(owner, repo, issueNumber);
  }
}

/**
 * Check if all sibling tasks are closed and auto-close parent if so
 */
async function checkParentTaskClosure(owner: string, repo: string, closedIssueNumber: number) {
  try {
    // Get the closed issue to check for parent label
    const closedIssue: any = await giteaClient.getIssue(owner, repo, closedIssueNumber);
    
    // Find parent label (format: parent:123)
    const parentLabel = closedIssue.labels?.find((l: any) => l.name.startsWith("parent:"));
    if (!parentLabel) {
      return; // Not a sub-task, nothing to do
    }
    
    const parentNumber = parseInt(parentLabel.name.split(":")[1]);
    logger.info({ closedIssue: closedIssueNumber, parentIssue: parentNumber }, "Checking parent task closure");
    
    // Get all issues with the same parent label
    const allIssuesResult = await giteaClient.listIssues(owner, repo, { state: "all" });
    const allIssues: any[] = Array.isArray(allIssuesResult) ? allIssuesResult : [];
    const siblingTasks = allIssues.filter((issue: any) => 
      issue.labels?.some((l: any) => l.name === parentLabel.name)
    );
    
    // Check if all siblings are closed
    const allSiblingsClosed = siblingTasks.every((task: any) => task.state === "closed");
    
    if (allSiblingsClosed && siblingTasks.length > 0) {
      logger.info({ parentIssue: parentNumber, closedSiblings: siblingTasks.length }, "All sibling tasks closed, closing parent");
      await giteaClient.updateIssue(owner, repo, parentNumber, { state: "closed" });
      
      // Check if this parent's closure should update project status
      await checkProjectCompletion(owner, repo);
    } else {
      logger.debug({ parentIssue: parentNumber, total: siblingTasks.length, closed: siblingTasks.filter((t: any) => t.state === "closed").length }, "Parent task not ready for auto-closure");
    }
  } catch (error) {
    logger.error({ error, issue: closedIssueNumber }, "Failed to check parent task closure");
  }
}

/**
 * Check if all project issues are closed and update project status
 */
async function checkProjectCompletion(owner: string, repo: string) {
  try {
    const repoFull = `${owner}/${repo}`;
    
    // Check if this is a tracked project
    const project = await db.query.projects.findFirst({
      where: eq(projects.giteaRepo, repoFull),
    });
    
    if (!project || project.status !== "active") {
      return; // Not a tracked project or not active
    }
    
    // Get all issues
    const allIssuesResult = await giteaClient.listIssues(owner, repo, { state: "all" });
    const allIssues: any[] = Array.isArray(allIssuesResult) ? allIssuesResult : [];
    const openIssues = allIssues.filter((i: any) => i.state === "open");
    
    if (openIssues.length === 0 && allIssues.length > 0) {
      logger.info({ projectId: project.id, repo: repoFull }, "All project issues closed, marking project as completed");
      await db.update(projects)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    }
  } catch (error) {
    logger.error({ error, repo: `${owner}/${repo}` }, "Failed to check project completion");
  }
}

async function handleWorkflowCompleted(payload: any) {
  const run = payload.workflow_run;
  const repo = payload.repository;
  const [owner, repoName] = repo.full_name.split("/");

  await enqueueWorkflowResult({
    owner,
    repo: repoName,
    workflowRunId: run.id,
    status: run.status,
    conclusion: run.conclusion,
  });
}

export default router;
