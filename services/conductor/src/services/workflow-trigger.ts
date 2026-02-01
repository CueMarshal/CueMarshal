/**
 * Workflow Trigger Service
 * Triggers Gitea Actions workflows via the workflow_dispatch API.
 * All workflows (task execution, code review, tests, self-improvement) use
 * workflow_dispatch with typed inputs — no push-based trigger files needed.
 * Requires Gitea 1.23+ (typed inputs supported since 1.23, improved in 1.25).
 */

import { giteaClient } from "./gitea-client.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";

const config = loadConfig();

const TASK_EXECUTE_WORKFLOW = "task-execute.yml";
const CODE_REVIEW_WORKFLOW = "code-review.yml";
const RUN_TESTS_WORKFLOW = "run-tests.yml";
const SELF_IMPROVE_WORKFLOW = "self-improve.yml";

interface DispatchTaskExecutionInput {
  owner: string;
  repo: string;
  issueNumber: number;
  agentRole: string;
  modelTier: string;
  branchName: string;
}

interface DispatchCodeReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  issueNumber: number;
  modelTier: string;
  branchName: string;
}

interface DispatchTestsInput {
  owner: string;
  repo: string;
  issueNumber: number;
  branchName: string;
  modelTier: string;
  writeTests: boolean;
}

export class WorkflowTrigger {
  private lastTriggerTime: Map<string, Date> = new Map();

  async triggerSelfImprovement(
    owner: string,
    repo: string,
    options: { source: string; reason: string; force?: boolean; correlationId?: string }
  ): Promise<{ triggered: boolean; message: string }> {
    const lockKey = `${owner}/${repo}/self-improve`;
    const now = new Date();
    const cooldownMs = config.selfImproveCooldownHours * 60 * 60 * 1000;

    if (!options.force) {
      const last = this.lastTriggerTime.get(lockKey);
      if (last && now.getTime() - last.getTime() < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (now.getTime() - last.getTime())) / 60000);
        logger.info({ lockKey, remaining }, "Self-improvement trigger in cooldown");
        return { triggered: false, message: `Cooldown active: ${remaining} minutes remaining` };
      }
    }

    try {
      await giteaClient.dispatchWorkflow(owner, repo, SELF_IMPROVE_WORKFLOW, {
        ref: "main",
        inputs: {
          correlation_id: options.correlationId || "",
        },
      });
      this.lastTriggerTime.set(lockKey, now);
      logger.info({ repo: `${owner}/${repo}`, source: options.source }, "Self-improvement triggered via workflow_dispatch");
      return { triggered: true, message: "Self-improvement workflow triggered successfully" };
    } catch (error) {
      logger.error({ error, repo: `${owner}/${repo}` }, "Failed to trigger self-improvement");
      throw error;
    }
  }

  isSelfImprovementInCooldown(owner: string, repo: string): boolean {
    const last = this.lastTriggerTime.get(`${owner}/${repo}/self-improve`);
    return last ? Date.now() - last.getTime() < config.selfImproveCooldownHours * 3600000 : false;
  }

  async dispatchTaskExecution(input: DispatchTaskExecutionInput): Promise<void> {
    await giteaClient.createBranch(input.owner, input.repo, {
      new_branch_name: input.branchName,
      old_branch_name: "main",
    });

    await giteaClient.dispatchWorkflow(input.owner, input.repo, TASK_EXECUTE_WORKFLOW, {
      ref: input.branchName,
      inputs: {
        issue_number: String(input.issueNumber),
        agent_role: input.agentRole,
        model_tier: input.modelTier,
        branch_name: input.branchName,
      },
    });

    logger.info(
      {
        repo: `${input.owner}/${input.repo}`,
        issue: input.issueNumber,
        role: input.agentRole,
        tier: input.modelTier,
        branch: input.branchName,
      },
      "Task execution triggered via workflow_dispatch"
    );
  }

  async dispatchCodeReview(input: DispatchCodeReviewInput): Promise<void> {
    await giteaClient.dispatchWorkflow(input.owner, input.repo, CODE_REVIEW_WORKFLOW, {
      ref: input.branchName,
      inputs: {
        pr_number: String(input.prNumber),
        issue_number: String(input.issueNumber),
      },
    });

    logger.info(
      {
        repo: `${input.owner}/${input.repo}`,
        pr: input.prNumber,
        issue: input.issueNumber,
        branch: input.branchName,
      },
      "Code review triggered via workflow_dispatch"
    );
  }

  async dispatchTests(input: DispatchTestsInput): Promise<void> {
    await giteaClient.dispatchWorkflow(input.owner, input.repo, RUN_TESTS_WORKFLOW, {
      ref: input.branchName,
      inputs: {
        issue_number: String(input.issueNumber),
        model_tier: input.modelTier,
        write_tests: String(input.writeTests),
      },
    });

    logger.info(
      {
        repo: `${input.owner}/${input.repo}`,
        issue: input.issueNumber,
        branch: input.branchName,
        writeTests: input.writeTests,
      },
      "Test execution triggered via workflow_dispatch"
    );
  }
}

export const workflowTrigger = new WorkflowTrigger();
