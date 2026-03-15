/**
 * Gitea MCP Tools - Issue Management
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

type LabelRecord = { id: number; name: string };

async function fetchAllLabels(owner: string, repo: string, authToken?: string): Promise<LabelRecord[]> {
  const labels: LabelRecord[] = [];
  try {
    labels.push(...(await giteaRequest("GET", `/orgs/${owner}/labels`, undefined, authToken) as LabelRecord[]));
  } catch { /* continue */ }
  try {
    labels.push(...(await giteaRequest("GET", `/repos/${owner}/${repo}/labels`, undefined, authToken) as LabelRecord[]));
  } catch { /* continue */ }
  return labels;
}

async function resolveLabelNames(
  owner: string, repo: string, labelNames: string[], authToken?: string,
): Promise<{ resolved: number[] } | { error: object }> {
  const labels = await fetchAllLabels(owner, repo, authToken);
  const labelMap = new Map<string, number>(labels.map(l => [l.name, l.id]));
  const resolved: number[] = [];
  const unresolved: string[] = [];
  for (const n of labelNames) {
    const id = labelMap.get(n);
    if (id !== undefined) resolved.push(id);
    else unresolved.push(n);
  }
  if (unresolved.length > 0) {
    return { error: { error: "Label resolution failed", unresolvedLabels: unresolved, availableLabels: Array.from(labelMap.keys()) } };
  }
  return { resolved };
}

async function validateLabelIds(
  owner: string, repo: string, labelIds: number[], authToken?: string,
): Promise<null | { error: object }> {
  const allLabels = await fetchAllLabels(owner, repo, authToken);
  const valid = new Set(allLabels.map(l => l.id));
  const invalid = labelIds.filter(id => !valid.has(id));
  if (invalid.length > 0) {
    return { error: { error: "Invalid label IDs", invalidLabelIds: invalid, validLabelIds: Array.from(valid) } };
  }
  return null;
}

export const IssueTools = {
  gitea_create_issue: {
    description: "Create a new issue in a Gitea repository. Supports both label IDs and label names (automatically resolved to IDs).",
    parameters: z.object({
      owner: z.string().describe("Repository owner (user or organization)"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("Issue title"),
      body: z.string().optional().describe("Issue body in markdown"),
      labels: z.array(z.number()).optional().describe("Array of label IDs"),
      labelNames: z.array(z.string()).optional().describe("Array of label names (will be automatically resolved to IDs)"),
      milestone: z.number().optional().describe("Milestone ID"),
      assignees: z.array(z.string()).optional().describe("Array of assignee usernames"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      title: string;
      body?: string;
      labels?: number[];
      labelNames?: string[];
      milestone?: number;
      assignees?: string[];
      authToken?: string;
    }) => {
      let labelIds = args.labels || [];

      if (args.labelNames?.length) {
        const result = await resolveLabelNames(args.owner, args.repo, args.labelNames, args.authToken);
        if ("error" in result) {
          return { content: [{ type: "text", text: JSON.stringify(result.error, null, 2) }] };
        }
        labelIds = [...labelIds, ...result.resolved];
      }

      if (labelIds.length > 0) {
        const validationError = await validateLabelIds(args.owner, args.repo, labelIds, args.authToken);
        if (validationError) {
          return { content: [{ type: "text", text: JSON.stringify(validationError.error, null, 2) }] };
        }
      }

      const correlationId =
        process.env.CORRELATION_ID ||
        args.body?.match(/Correlation ID: (si-[\w-]+)/)?.[1] ||
        "unknown";
      console.error(
        JSON.stringify({
          event: "self_improve.mcp_tool_called",
          timestamp: new Date().toISOString(),
          correlationId,
          tool: "gitea_create_issue",
          owner: args.owner,
          repo: args.repo,
          title: args.title,
          hasLabels: labelIds.length > 0,
          labelCount: labelIds.length,
        })
      );

      const result = (await giteaRequest("POST", `/repos/${args.owner}/${args.repo}/issues`, {
        title: args.title,
        body: args.body || "",
        labels: labelIds,
        milestone: args.milestone,
        assignees: args.assignees || [],
      }, args.authToken)) as { number: number; title: string; labels?: Array<{ name: string }> };

      console.error(
        JSON.stringify({
          event: "self_improve.issue_created",
          timestamp: new Date().toISOString(),
          correlationId,
          issueNumber: result.number,
          issueTitle: result.title,
          labels: result.labels?.map((l) => l.name) || [],
        })
      );

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  },

  gitea_get_issue: {
    description: "Get details of a specific issue including comments and labels",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue number"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; repo: string; issue_number: number; authToken?: string }) => {
      const issue = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/issues/${args.issue_number}`,
        undefined,
        args.authToken
      );
      const comments = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/issues/${args.issue_number}/comments`,
        undefined,
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ issue, comments }, null, 2),
          },
        ],
      };
    },
  },

  gitea_update_issue: {
    description: "Update an existing issue (title, body, state, or labels)",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue number"),
      title: z.string().optional().describe("New title"),
      body: z.string().optional().describe("New body"),
      state: z.enum(["open", "closed"]).optional().describe("Issue state"),
      labels: z.array(z.number()).optional().describe("Replace with these label IDs"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      issue_number: number;
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: number[];
      authToken?: string;
    }) => {
      const updateData: Record<string, unknown> = {};
      if (args.title) updateData.title = args.title;
      if (args.body !== undefined) updateData.body = args.body;
      if (args.state) updateData.state = args.state;
      if (args.labels) updateData.labels = args.labels;

      const result = await giteaRequest(
        "PATCH",
        `/repos/${args.owner}/${args.repo}/issues/${args.issue_number}`,
        updateData,
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },

  gitea_add_comment: {
    description: "Add a comment to an issue or pull request",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue or PR number"),
      body: z.string().describe("Comment body in markdown"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; repo: string; issue_number: number; body: string; authToken?: string }) => {
      const result = await giteaRequest(
        "POST",
        `/repos/${args.owner}/${args.repo}/issues/${args.issue_number}/comments`,
        { body: args.body },
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },

  gitea_list_issues: {
    description: "List issues in a repository with optional filters",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      state: z.enum(["open", "closed", "all"]).optional().describe("Issue state filter"),
      labels: z.string().optional().describe("Comma-separated label names"),
      milestone: z.string().optional().describe("Milestone name"),
      page: z.number().optional().describe("Page number (default: 1)"),
      limit: z.number().optional().describe("Items per page (default: 20)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      state?: "open" | "closed" | "all";
      labels?: string;
      milestone?: string;
      page?: number;
      limit?: number;
      authToken?: string;
    }) => {
      const params = new URLSearchParams();
      if (args.state) params.append("state", args.state);
      if (args.labels) params.append("labels", args.labels);
      if (args.milestone) params.append("milestone", args.milestone);
      params.append("page", String(args.page || 1));
      params.append("limit", String(args.limit || 20));

      const result = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/issues?${params}`,
        undefined,
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  },
};
