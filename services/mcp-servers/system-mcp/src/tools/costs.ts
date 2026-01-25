/**
 * System MCP Tools - Cost Tracking
 */

import { z } from "zod";
import { conductorRequest } from "../auth.js";

export const CostTools = {
  cost_get_summary: {
    description: "Get LLM spending summary by period, project, or model",
    parameters: z.object({
      period: z.enum(["day", "week", "month"]).optional().describe("Time period (default: month)"),
      project: z.string().optional().describe("Filter by project name"),
      model: z.string().optional().describe("Filter by model tier"),
    }),
    handler: async (args: { period?: string; project?: string; model?: string }) => {
      try {
        // Build query params
        const params = new URLSearchParams();
        if (args.period) params.append("period", args.period);
        if (args.project) params.append("project", args.project);
        if (args.model) params.append("model", args.model);

        // Query Conductor's cost summary endpoint
        const summary = await conductorRequest(
          "GET",
          `/api/internal/costs/summary?${params}`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: (error as Error).message }, null, 2),
            },
          ],
        };
      }
    },
  },

  cost_get_budget: {
    description: "Check remaining budget for a project or system-wide",
    parameters: z.object({
      project: z.string().optional().describe("Specific project (or system-wide if not provided)"),
    }),
    handler: async (args: { project?: string }) => {
      try {
        // Build query params
        const params = new URLSearchParams();
        if (args.project) params.append("project", args.project);

        // Query Conductor's budget endpoint
        const budget = await conductorRequest(
          "GET",
          `/api/internal/costs/budget?${params}`
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(budget, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: (error as Error).message }, null, 2),
            },
          ],
        };
      }
    },
  },
};
