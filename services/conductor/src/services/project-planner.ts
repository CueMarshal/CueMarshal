/**
 * Project Planning Service
 * Generates project plans with milestones, issues, and checkpoints
 */

import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { giteaClient } from "./gitea-client.js";
import { z } from "zod";

// Labels that every project repo must have for the agent workflows to function
const REQUIRED_LABELS: Array<{ name: string; color: string; description: string }> = [
  // Role labels
  { name: "role:architect",  color: "#0075ca", description: "Assigned to the architect agent" },
  { name: "role:developer",  color: "#0075ca", description: "Assigned to the developer agent" },
  { name: "role:reviewer",   color: "#0075ca", description: "Assigned to the reviewer agent" },
  { name: "role:tester",     color: "#0075ca", description: "Assigned to the tester agent" },
  { name: "role:devops",     color: "#0075ca", description: "Assigned to the devops agent" },
  { name: "role:docs",       color: "#0075ca", description: "Assigned to the docs agent" },
  { name: "role:linter",     color: "#0075ca", description: "Assigned to the linter agent" },
  // Complexity labels
  { name: "complexity:simple",   color: "#2ea44f", description: "Under 4 hours of work" },
  { name: "complexity:standard", color: "#fef2c0", description: "4–8 hours of work" },
  { name: "complexity:complex",  color: "#e4e669", description: "Over 8 hours of work" },
  // Meta labels
  { name: "self-improvement",    color: "#0075ca", description: "Automated improvement task" },
  { name: "source:sonar",        color: "#fbca04", description: "Originated from SonarQube scan" },
  { name: "needs-human-review",  color: "#ee0701", description: "Requires human attention" },
  { name: "checkpoint",          color: "#f9d0c4", description: "Architecture checkpoint requiring user approval" },
];

// Workflow files to seed into every project repo (read from the conductor's own Gitea repo)
const WORKFLOW_FILES = [
  "task-execute.yml",
  "code-review.yml",
  "run-tests.yml",
  "self-improve.yml",
  "idle-check.yml",
  "sonar-scan.yml",
];

// Scanner scripts to seed alongside the workflows (required by self-improve.yml)
const SCANNER_FILES = [
  "run-all-scanners.sh",
  "scan-todo-markers.sh",
  "scan-dependency-updates.sh",
  "scan-test-coverage.sh",
  "scan-stale-docs.sh",
  "scan-sonar.sh",
  "scanner-config.json",
];


const gateway = new OpenAI({
  baseURL: `${config.gatewayUrl}/v1`,
  apiKey: config.gatewayApiKey,
});

// Schemas
const MilestoneSchema = z.object({
  title: z.string(),
  description: z.string(),
  acceptance_criteria: z.array(z.string()),
  checkpoint: z.boolean().describe("Whether this milestone requires user review before proceeding"),
});

const IssueSchema = z.object({
  title: z.string(),
  description: z.string(),
  role: z.enum(["architect", "developer", "reviewer", "tester", "devops", "docs", "linter"]),
  complexity: z.enum(["simple", "standard", "complex"]),
  milestone: z.string(),
  dependencies: z.array(z.string()).describe("Titles of issues that must be completed first"),
  labels: z.array(z.string()).optional(),
});

const ProjectPlanSchema = z.object({
  milestones: z.array(MilestoneSchema),
  issues: z.array(IssueSchema),
  architecture_notes: z.string().optional(),
});

export interface ProjectPlan {
  milestones: Array<{
    title: string;
    description: string;
    acceptance_criteria: string[];
    checkpoint: boolean;
  }>;
  issues: Array<{
    title: string;
    description: string;
    role: string;
    complexity: string;
    milestone: string;
    dependencies: string[];
    labels?: string[];
  }>;
  architecture_notes?: string;
}

const PLANNING_PROMPT = `You are a software architect generating a project plan.

Given a project description and goals, create a comprehensive plan with:
1. Milestones representing major phases (design, implementation, testing, deployment)
2. Issues (actionable tasks) organized by milestone
3. Architecture checkpoints where user review is needed before proceeding

Guidelines:
- Break work into small, independent issues (aim for <1 day each)
- Use architecture checkpoints for major decisions (database choice, API design, auth approach)
- Assign appropriate roles: architect (design), developer (code), tester (tests), devops (infra), docs (documentation)
- Set complexity: simple (<4 hours), standard (4-8 hours), complex (>8 hours)
- Define dependencies between issues to ensure proper ordering
- Add standard labels: role:{role}, complexity:{complexity}, and domain-specific labels

Output valid JSON matching this schema:
{
  "milestones": [{"title": "...", "description": "...", "acceptance_criteria": ["..."], "checkpoint": true}],
  "issues": [{"title": "...", "description": "...", "role": "developer", "complexity": "standard", "milestone": "...", "dependencies": [], "labels": ["feature", "backend"]}],
  "architecture_notes": "..."
}`;

export class ProjectPlanner {
  /**
   * Generate a project plan using LLM
   */
  async planProject(input: {
    name: string;
    description: string;
    goals?: string[];
  }): Promise<ProjectPlan> {
    logger.info({ project: input.name }, "Generating project plan");

    const prompt = `Project: ${input.name}

Description: ${input.description}

${input.goals && input.goals.length > 0 ? `Goals:\n${input.goals.map((g, i) => `${i + 1}. ${g}`).join("\n")}` : ""}

Generate a comprehensive project plan with milestones, issues, and architecture checkpoints.`;

    try {
      const response = await gateway.chat.completions.create({
        model: config.planningModel || "gpt-4o",
        messages: [
          { role: "system", content: PLANNING_PROMPT },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from LLM");
      }

      const parsed = JSON.parse(content);
      const plan = ProjectPlanSchema.parse(parsed);

      logger.info(
        { project: input.name, milestones: plan.milestones.length, issues: plan.issues.length },
        "Project plan generated"
      );

      return plan;
    } catch (error) {
      logger.error({ error, project: input.name }, "Project planning failed");
      throw error;
    }
  }

  /**
   * Execute an approved project plan by creating milestones and issues in Gitea.
   * Also seeds required labels, workflow files, and scanner scripts into the repo.
   */
  async executePlan(
    owner: string,
    repo: string,
    plan: ProjectPlan
  ): Promise<{ milestones: any[]; issues: any[] }> {
    logger.info({ repo: `${owner}/${repo}`, milestones: plan.milestones.length, issues: plan.issues.length }, "Executing project plan");

    // Bootstrap the repository with labels, workflows, and scanner scripts before
    // creating issues (labels must exist before getLabelIds can resolve them).
    await this.setupProjectRepository(owner, repo);

    const createdMilestones: any[] = [];
    const createdIssues: any[] = [];

    // Create milestones
    for (const milestone of plan.milestones) {
      try {
        const created: any = await giteaClient.createMilestone(owner, repo, {
          title: milestone.title,
          description: `${milestone.description}\n\n**Acceptance Criteria:**\n${milestone.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}${milestone.checkpoint ? "\n\n⚠️ **Checkpoint**: Requires user review before proceeding to next milestone" : ""}`,
          state: "open",
        });
        createdMilestones.push(created);
        logger.info({ milestone: milestone.title }, "Milestone created");
      } catch (error) {
        logger.error({ error, milestone: milestone.title }, "Failed to create milestone");
      }
    }

    // Create issues
    for (const issue of plan.issues) {
      try {
        // Find milestone ID
        const milestone: any = createdMilestones.find((m: any) => m.title === issue.milestone);
        
        // Get label IDs
        const labelNames = [
          `role:${issue.role}`,
          `complexity:${issue.complexity}`,
          ...(issue.labels || []),
        ];
        const labels = await this.getLabelIds(owner, repo, labelNames);

        // Add dependency info to body
        const body = `${issue.description}${issue.dependencies.length > 0 ? `\n\n**Dependencies:** ${issue.dependencies.join(", ")}` : ""}`;

        const created: any = await giteaClient.createIssue(owner, repo, {
          title: issue.title,
          body,
          labels,
          milestone: milestone?.id,
        });
        createdIssues.push(created);
        logger.info({ issue: issue.title, number: created.number }, "Issue created");
      } catch (error) {
        logger.error({ error, issue: issue.title }, "Failed to create issue");
      }
    }

    logger.info({ repo: `${owner}/${repo}`, created: createdIssues.length }, "Project plan execution complete");

    return { milestones: createdMilestones, issues: createdIssues };
  }

  /**
   * Check project progress
   */
  async checkProjectProgress(owner: string, repo: string): Promise<{
    total_issues: number;
    open_issues: number;
    closed_issues: number;
    progress_pct: number;
  }> {
    const issuesResult = await giteaClient.listIssues(owner, repo, { state: "all" });
    const issues: any[] = Array.isArray(issuesResult) ? issuesResult : [];
    const openCount = issues.filter((i: any) => i.state === "open").length;
    const closedCount = issues.filter((i: any) => i.state === "closed").length;
    const total = issues.length;

    return {
      total_issues: total,
      open_issues: openCount,
      closed_issues: closedCount,
      progress_pct: total > 0 ? Math.round((closedCount / total) * 100) : 0,
    };
  }

  /**
   * Bootstrap a new project repository with the labels, workflow files, and
   * scanner scripts that every CueMarshal-managed project needs.
   */
  private async setupProjectRepository(owner: string, repo: string): Promise<void> {
    logger.info({ repo: `${owner}/${repo}` }, "Setting up project repository");
    await Promise.allSettled([
      this.seedRequiredLabels(owner, repo),
      this.seedWorkflowFiles(owner, repo),
    ]);
    logger.info({ repo: `${owner}/${repo}` }, "Project repository setup complete");
  }

  /**
   * Seed all required labels into the project repo so that issue creation and
   * self-improvement workflows can assign them without missing-label warnings.
   */
  private async seedRequiredLabels(owner: string, repo: string): Promise<void> {
    let existing: any[] = [];
    try {
      const result = await giteaClient.getRepoLabels(owner, repo);
      existing = Array.isArray(result) ? result : [];
    } catch (error) {
      logger.warn({ error, repo: `${owner}/${repo}` }, "Could not fetch existing labels; will attempt to create all");
    }

    const existingNames = new Set(existing.map((l: any) => l.name as string));

    for (const label of REQUIRED_LABELS) {
      if (existingNames.has(label.name)) {
        logger.debug({ label: label.name }, "Label already exists, skipping");
        continue;
      }
      try {
        await giteaClient.createRepoLabel(owner, repo, label);
        logger.info({ label: label.name, repo: `${owner}/${repo}` }, "Label created");
      } catch (error) {
        logger.warn({ error, label: label.name, repo: `${owner}/${repo}` }, "Failed to create label, continuing");
      }
    }
  }

  /**
   * Copy workflow files and scanner scripts from the canonical GitHub source repo
   * into the new project repo so that scheduled scans and agent execution work
   * immediately without manual setup.
   *
   * Files are fetched from `config.templateRepoUrl` (defaults to the CueMarshal
   * GitHub repo on main) so the deployed Docker containers always use the latest
   * checked-in versions rather than depending on the Gitea conductor repo.
   */
  private async seedWorkflowFiles(owner: string, repo: string): Promise<void> {
    const base = config.templateRepoUrl.replace(/\/$/, "");

    const fetchTemplate = async (remotePath: string): Promise<string | null> => {
      const url = `${base}/${remotePath}`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn({ url, status: response.status }, "Template file not found on GitHub, skipping");
          return null;
        }
        return response.text();
      } catch (error) {
        logger.warn({ error, url }, "Failed to fetch template file from GitHub, skipping");
        return null;
      }
    };

    // Workflow YAML files: workflows/*.yml → .gitea/workflows/*.yml
    const workflowResults = await Promise.allSettled(
      WORKFLOW_FILES.map(async (file) => {
        const content = await fetchTemplate(`workflows/${file}`);
        if (!content) return;
        await giteaClient.createOrUpdateFile(owner, repo, `.gitea/workflows/${file}`, {
          content,
          message: `chore: seed workflow ${file} from CueMarshal template`,
        });
        logger.info({ file, repo: `${owner}/${repo}` }, "Workflow file seeded");
      })
    );
    workflowResults.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.warn({ error: r.reason, file: WORKFLOW_FILES[i] }, "Failed to seed workflow file");
      }
    });

    // Scanner scripts: scripts/scanners/* → scripts/scanners/*
    const scannerResults = await Promise.allSettled(
      SCANNER_FILES.map(async (file) => {
        const content = await fetchTemplate(`scripts/scanners/${file}`);
        if (!content) return;
        await giteaClient.createOrUpdateFile(owner, repo, `scripts/scanners/${file}`, {
          content,
          message: `chore: seed scanner script ${file} from CueMarshal template`,
        });
        logger.info({ file, repo: `${owner}/${repo}` }, "Scanner script seeded");
      })
    );
    scannerResults.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.warn({ error: r.reason, file: SCANNER_FILES[i] }, "Failed to seed scanner script");
      }
    });
  }

  /**
   * Helper: Get label IDs for label names
   */
  private async getLabelIds(owner: string, repo: string, labelNames: string[]): Promise<number[]> {
    try {
      // Use the label resolution from the Gitea MCP tools
      const orgLabelsResult = await giteaClient.getOrgLabels(owner);
      const repoLabelsResult = await giteaClient.getRepoLabels(owner, repo);
      const orgLabels: any[] = Array.isArray(orgLabelsResult) ? orgLabelsResult : [];
      const repoLabels: any[] = Array.isArray(repoLabelsResult) ? repoLabelsResult : [];
      
      const allLabels = [...repoLabels, ...orgLabels];
      const labelMap = new Map(allLabels.map((l: any) => [l.name, l.id]));

      const ids: number[] = [];
      for (const name of labelNames) {
        const id = labelMap.get(name);
        if (id) {
          ids.push(id);
        } else {
          logger.warn({ labelName: name, repo: `${owner}/${repo}` }, "Label not found, skipping");
        }
      }

      return ids;
    } catch (error) {
      logger.error({ error }, "Failed to resolve label IDs");
      return [];
    }
  }
}

export const projectPlanner = new ProjectPlanner();
