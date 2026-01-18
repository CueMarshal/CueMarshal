/**
 * Gitea MCP Tools - Search
 */

import { z } from "zod";
import { giteaRequest } from "../auth.js";

export const SearchTools = {
  gitea_search_code: {
    description: "Search code across repositories",
    parameters: z.object({
      query: z.string().describe("Search query"),
      owner: z.string().optional().describe("Limit to specific owner"),
      repo: z.string().optional().describe("Limit to specific repository"),
      page: z.number().optional().describe("Page number"),
      limit: z.number().optional().describe("Items per page"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      query: string;
      owner?: string;
      repo?: string;
      page?: number;
      limit?: number;
      authToken?: string;
    }) => {
      const params = new URLSearchParams();
      params.append("q", args.query);
      if (args.owner) params.append("owner", args.owner);
      if (args.repo) params.append("repo", args.repo);
      params.append("page", String(args.page || 1));
      params.append("limit", String(args.limit || 10));

      const result = await giteaRequest("GET", `/repos/search?${params}`, undefined, args.authToken);

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

  gitea_search_issues: {
    description: "Search issues across repositories",
    parameters: z.object({
      query: z.string().describe("Search query"),
      owner: z.string().optional().describe("Limit to specific owner"),
      repo: z.string().optional().describe("Limit to specific repository"),
      state: z.enum(["open", "closed", "all"]).optional().describe("Issue state"),
      labels: z.string().optional().describe("Comma-separated label names"),
      page: z.number().optional().describe("Page number"),
      limit: z.number().optional().describe("Items per page"),
      authToken: z.string().optional().describe("Optional Gitea auth token override"),
    }),
    handler: async (args: {
      query: string;
      owner?: string;
      repo?: string;
      state?: string;
      labels?: string;
      page?: number;
      limit?: number;
      authToken?: string;
    }) => {
      const params = new URLSearchParams();
      params.append("q", args.query);
      if (args.owner) params.append("owner", args.owner);
      if (args.repo) params.append("repo", args.repo);
      if (args.state) params.append("state", args.state);
      if (args.labels) params.append("labels", args.labels);
      params.append("page", String(args.page || 1));
      params.append("limit", String(args.limit || 20));

      const result = await giteaRequest("GET", `/repos/issues/search?${params}`, undefined, args.authToken);

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
