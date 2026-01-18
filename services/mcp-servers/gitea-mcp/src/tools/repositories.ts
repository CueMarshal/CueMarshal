/**
 * Gitea MCP Tools - Repository Management
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

export const RepositoryTools = {
  gitea_create_repo: {
    description: "Create a new repository in an organization",
    parameters: z.object({
      owner: z.string().describe("Organization name"),
      name: z.string().describe("Repository name"),
      description: z.string().optional().describe("Repository description"),
      private: z.boolean().optional().describe("Whether the repository is private (default: false)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; name: string; description?: string; private?: boolean; authToken?: string }) => {
      const result = await giteaRequest("POST", `/orgs/${args.owner}/repos`, {
        name: args.name,
        description: args.description || "",
        private: args.private ?? false,
        auto_init: true,
        default_branch: "main",
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

  gitea_list_repos: {
    description: "List repositories for an owner (user or organization)",
    parameters: z.object({
      owner: z.string().describe("User or organization name"),
      page: z.number().optional().describe("Page number (default: 1)"),
      limit: z.number().optional().describe("Items per page (default: 20)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; page?: number; limit?: number; authToken?: string }) => {
      const params = new URLSearchParams();
      params.append("page", String(args.page || 1));
      params.append("limit", String(args.limit || 20));

      const result = await giteaRequest("GET", `/orgs/${args.owner}/repos?${params}`, undefined, args.authToken);

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

  gitea_get_file_contents: {
    description: "Read file contents from a repository",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      filepath: z.string().describe("Path to file (e.g., 'src/index.ts')"),
      ref: z.string().optional().describe("Branch or commit ref (default: default branch)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: { owner: string; repo: string; filepath: string; ref?: string; authToken?: string }) => {
      const params = new URLSearchParams();
      if (args.ref) params.append("ref", args.ref);

      const result = await giteaRequest(
        "GET",
        `/repos/${args.owner}/${args.repo}/contents/${args.filepath}?${params}`,
        undefined,
        args.authToken
      );

      // Decode base64 content
      const content = result as { content: string; encoding: string };
      if (content.encoding === "base64") {
        const decoded = Buffer.from(content.content, "base64").toString("utf-8");
        return {
          content: [
            {
              type: "text",
              text: decoded,
            },
          ],
        };
      }

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

  gitea_create_branch: {
    description: "Create a new branch in a repository",
    parameters: z.object({
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      branch_name: z.string().describe("New branch name"),
      old_branch_name: z.string().optional().describe("Source branch (default: default branch)"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      owner: string;
      repo: string;
      branch_name: string;
      old_branch_name?: string;
      authToken?: string;
    }) => {
      const result = await giteaRequest("POST", `/repos/${args.owner}/${args.repo}/branches`, {
        new_branch_name: args.branch_name,
        old_branch_name: args.old_branch_name || "main",
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
