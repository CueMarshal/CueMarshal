/**
 * Gitea MCP Tools - Workflow/Actions Management
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

export const WorkflowTools = {
  gitea_dispatch_workflow: {
    description: "Trigger a Gitea Actions workflow with inputs",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      workflow_id: z.string().describe("Workflow filename (e.g., 'task-execute.yml')"),
      ref: z.string().optional().describe("Branch ref (default: 'main')"),
      inputs: z.record(z.string()).optional().describe("Workflow input parameters"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      workflow_id: string;
      ref?: string;
      inputs?: Record<string, string>;
      authToken?: string;
    }) => {
      const result = await giteaRequest(
        "POST",
        `/repos/${args.owner}/${args.repo}/actions/workflows/${args.workflow_id}/dispatches`,
        {
          ref: args.ref || "main",
          inputs: args.inputs || {},
        },
        args.authToken
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result || { success: true }, null, 2),
          },
        ],
      };
    },
  },

  gitea_get_workflow_runs: {
    description: "Get workflow run history for a repository",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      workflow_id: z.string().optional().describe("Filter by workflow filename"),
      status: z.enum(["success", "failure", "waiting", "running"]).optional().describe("Filter by status"),
      page: z.number().optional().describe("Page number"),
      limit: z.number().optional().describe("Items per page"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      workflow_id?: string;
      status?: string;
      page?: number;
      limit?: number;
      authToken?: string;
    }) => {
      const params = new URLSearchParams();
      if (args.workflow_id) params.append("workflow_id", args.workflow_id);
      if (args.status) params.append("status", args.status);
      params.append("page", String(args.page || 1));
      params.append("limit", String(args.limit || 20));

      const result = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/actions/runs?${params}`,
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
