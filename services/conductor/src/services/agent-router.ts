/**
 * Agent Router Service
 * Maps tasks to agent roles and triggers workflow dispatch
 */

import { modelSelector } from "./model-selector.js";
import { workflowTrigger } from "./workflow-trigger.js";
import { giteaClient } from "./gitea-client.js";
import { logger } from "../utils/logger.js";
import { db } from "../db/client.js";
import { tasks } from "../db/schema.js";

interface RouteTaskInput {
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  labels: string[];
}

export class AgentRouter {
  async routeTask(input: RouteTaskInput): Promise<void> {
    logger.info(
      { repo: input.repo, issue: input.issueNumber },
      "Routing task to agent"
    );

    // Step 1: Determine agent role
    const roleLabel = input.labels.find((l) => l.startsWith("role:"));
    const agentRole = roleLabel ? roleLabel.split(":")[1] : "developer";

    // Step 2: Select model tier
    const modelSelection = await modelSelector.selectModel({
      title: input.issueTitle,
      body: input.issueBody,
      labels: input.labels,
      agentRole,
    });

    logger.info(
      {
        role: agentRole,
        tier: modelSelection.tier,
        cost: modelSelection.estimatedCost,
        reasoning: modelSelection.reasoning,
      },
      "Model selected"
    );

    // Step 3: Generate branch name
    const branchName = this.generateBranchName(input.issueNumber, input.issueTitle);

    // Step 4: Create task record in database
    const [task] = await db
      .insert(tasks)
      .values({
        giteaIssueId: input.issueNumber,
        giteaRepo: `${input.owner}/${input.repo}`,
        status: "in_progress",
        agentRole,
        modelTier: modelSelection.tier,
        currentTier: modelSelection.tier,
        branchName,
      })
      .returning();

    logger.info({ taskId: task.id }, "Task record created");

    // Step 4.5: Assign issue to cuemarshal-bot
    try {
      await giteaClient.updateIssue(input.owner, input.repo, input.issueNumber, {
        assignees: ["cuemarshal-bot"],
      });
      logger.info({ issue: input.issueNumber }, "Issue assigned to cuemarshal-bot");
    } catch (error) {
      logger.warn({ error, issue: input.issueNumber }, "Failed to assign issue");
    }

    // Step 5: Dispatch workflow
    await workflowTrigger.dispatchTaskExecution({
      owner: input.owner,
      repo: input.repo,
      issueNumber: input.issueNumber,
      agentRole,
      modelTier: modelSelection.tier,
      branchName,
    });

    logger.info(
      { taskId: task.id, issue: input.issueNumber, role: agentRole },
      "Workflow dispatched"
    );
  }

  private generateBranchName(issueNumber: number, title: string): string {
    // Determine if it's a feature or fix based on title
    const lowerTitle = title.toLowerCase();
    const prefix = lowerTitle.includes("fix") || lowerTitle.includes("bug") ? "fix" : "feat";

    // Slugify the title (simplified version)
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 40);

    return `${prefix}/issue-${issueNumber}-${slug}`;
  }
}

export const agentRouter = new AgentRouter();
