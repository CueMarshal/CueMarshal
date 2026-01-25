/**
 * System MCP Tools - Grafana Dashboards
 */

import { z } from "zod";
import { grafanaRequest } from "../auth.js";

export const DashboardTools = {
  dashboards_list: {
    description: "List all Grafana dashboards",
    parameters: z.object({
      query: z.string().optional().describe("Search query to filter dashboards"),
      tag: z.string().optional().describe("Filter by dashboard tag"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    }),
    handler: async (args: { query?: string; tag?: string; limit?: number }) => {
      try {
        const params = new URLSearchParams();
        params.append("type", "dash-db");
        if (args.query) params.append("query", args.query);
        if (args.tag) params.append("tag", args.tag);
        if (args.limit) params.append("limit", String(args.limit));

        const result = await grafanaRequest("GET", `/api/search?${params}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  dashboards_get: {
    description: "Get dashboard JSON definition by UID",
    parameters: z.object({
      uid: z.string().describe("Dashboard UID"),
    }),
    handler: async (args: { uid: string }) => {
      try {
        const result = await grafanaRequest("GET", `/api/dashboards/uid/${args.uid}`);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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

  alerts_list: {
    description: "List current alert rules and their state",
    parameters: z.object({}),
    handler: async () => {
      try {
        const result = await grafanaRequest("GET", "/api/v1/provisioning/alert-rules");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
