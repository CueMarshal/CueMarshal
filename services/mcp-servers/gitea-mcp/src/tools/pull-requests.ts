/**
 * Gitea MCP Tools - Pull Request Management
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

export const PullRequestTools = {
  gitea_create_pull_request: {
    description: "Create a new pull request",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("PR title"),
      body: z.string().optional().describe("PR body in markdown"),
      head: z.string().describe("Source branch name"),
      base: z.string().describe("Target branch name"),
      labels: z.array(z.number()).optional().describe("Label IDs"),
      assignees: z.array(z.string()).optional().describe("Reviewer usernames"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      title: string;
      body?: string;
      head: string;
      base: string;
      labels?: number[];
      assignees?: string[];
      authToken?: string;
    }) => {
      const result = await giteaRequest("POST", `/repos/${args.owner}/${args.repo}/pulls`, {
        title: args.title,
        body: args.body || "",
        head: args.head,
        base: args.base,
        labels: args.labels || [],
        assignees: args.assignees || [],
      }, args.authToken);

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

  gitea_get_pull_request: {
    description: "Get pull request details including diff stats and changed files",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      pr_number: z.number().describe("Pull request number"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; repo: string; pr_number: number; authToken?: string }) => {
      const pr = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/pulls/${args.pr_number}`,
        undefined,
        args.authToken
      );
      const files = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/pulls/${args.pr_number}/files`,
        undefined,
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ pr, files }, null, 2),
          },
        ],
      };
    },
  },

  gitea_merge_pull_request: {
    description: "Merge a pull request",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      pr_number: z.number().describe("Pull request number"),
      merge_type: z
        .enum(["merge", "rebase", "squash"])
        .optional()
        .describe("Merge strategy (default: merge)"),
      message: z.string().optional().describe("Merge commit message"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      pr_number: number;
      merge_type?: "merge" | "rebase" | "squash";
      message?: string;
      authToken?: string;
    }) => {
      const result = await giteaRequest("POST", `/repos/${args.owner}/${args.repo}/pulls/${args.pr_number}/merge`, {
        Do: args.merge_type || "merge",
        MergeMessageField: args.message || "",
      }, args.authToken);

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

  gitea_create_review: {
    description: "Submit a pull request review (approve, request changes, or comment)",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      pr_number: z.number().describe("Pull request number"),
      event: z
        .enum(["APPROVED", "REQUEST_CHANGES", "COMMENT"])
        .describe("Review decision type"),
      body: z.string().optional().describe("Review body"),
      comments: z
        .array(
          z.object({
            path: z.string().describe("File path"),
            line: z.number().describe("Line number"),
            body: z.string().describe("Comment text"),
          })
        )
        .optional()
        .describe("Inline comments on specific lines"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      pr_number: number;
      event: "APPROVED" | "REQUEST_CHANGES" | "COMMENT";
      body?: string;
      comments?: Array<{ path: string; line: number; body: string }>;
      authToken?: string;
    }) => {
      const result = await giteaRequest("POST", `/repos/${args.owner}/${args.repo}/pulls/${args.pr_number}/reviews`, {
        event: args.event,
        body: args.body || "",
        comments: args.comments || [],
      }, args.authToken);

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
