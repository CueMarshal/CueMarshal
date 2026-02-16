/**
 * Vector MCP Tools - Semantic Search
 */

import { z } from "zod";
import { searchVectors } from "../vector-store.js";

export const SearchTools = {
  search_similar_issues: {
    description: "Find past issues similar to the current task (for learning from history)",
    parameters: z.object({
      query: z.string().describe("Current task description"),
      project: z.string().describe("Project/repository name"),
      limit: z.number().optional().describe("Max results (default: 5)"),
    }),
    handler: async (args: { query: string; project: string; limit?: number }) => {
      const results = await searchVectors({
        query: args.query,
        project: args.project,
        contentType: "issue",
        limit: args.limit || 5,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  },

  search_code_patterns: {
    description: "Find existing code patterns in the project (to maintain consistency)",
    parameters: z.object({
      query: z.string().describe("What kind of code pattern to find (e.g., 'API endpoint')"),
      project: z.string().describe("Project/repository name"),
      file_type: z.string().optional().describe("Filter by file extension (e.g., 'ts', 'py')"),
      limit: z.number().optional().describe("Max results (default: 5)"),
    }),
    handler: async (args: {
      query: string;
      project: string;
      file_type?: string;
      limit?: number;
    }) => {
      const results = await searchVectors({
        query: args.query,
        project: args.project,
        contentType: "code",
        fileType: args.file_type,
        limit: args.limit || 5,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  },

  get_architectural_context: {
    description: "Retrieve relevant architecture docs and design decisions for a topic",
    parameters: z.object({
      topic: z.string().describe("Architecture topic (e.g., 'authentication', 'database')"),
      project: z.string().describe("Project/repository name"),
    }),
    handler: async (args: { topic: string; project: string }) => {
      const results = await searchVectors({
        query: args.topic,
        project: args.project,
        contentType: "design_doc",
        limit: 3,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  },

  find_related_prs: {
    description: "Find related PRs that might provide context for current task",
    parameters: z.object({
      query: z.string().describe("Task description or keywords"),
      project: z.string().describe("Project/repository name"),
      limit: z.number().optional().describe("Max results (default: 3)"),
    }),
    handler: async (args: { query: string; project: string; limit?: number }) => {
      const results = await searchVectors({
        query: args.query,
        project: args.project,
        contentType: "pr",
        limit: args.limit || 3,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  },
};
