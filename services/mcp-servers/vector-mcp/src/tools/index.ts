/**
 * Vector MCP Tools - Indexing
 * (Called by Conductor when content should be indexed)
 */

import { z } from "zod";
import { indexContent } from "../vector-store.js";

export const IndexTools = {
  index_content: {
    description: "Index content for semantic search (called by Conductor on PR merge, issue close, etc.)",
    parameters: z.object({
      project: z.string().describe("Project/repository name"),
      content_type: z.enum(["issue", "pr", "commit", "code", "design_doc"]).describe("Type of content"),
      content_ref: z.string().describe("Reference (issue #, commit SHA, file path)"),
      content_text: z.string().describe("Full text content to index"),
      metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
    }),
    handler: async (args: {
      project: string;
      content_type: string;
      content_ref: string;
      content_text: string;
      metadata?: Record<string, unknown>;
    }) => {
      await indexContent(args);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, indexed: args.content_ref }, null, 2),
          },
        ],
      };
    },
  },
};
