/**
 * System MCP Tools - Prometheus Metrics
 */

import { z } from "zod";
import { prometheusRequest } from "../auth.js";

export const MetricTools = {
  metrics_instant_query: {
    description: "Execute instant PromQL query for current metric values",
    parameters: z.object({
      query: z
        .string()
        .describe(
          "PromQL query string (e.g., 'up', 'rate(http_requests_total[5m])')"
        ),
    }),
    handler: async (args: { query: string }) => {
      try {
        const params = new URLSearchParams();
        params.append("query", args.query);

        const result = await prometheusRequest(`/api/v1/query?${params}`);

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

  metrics_range_query: {
    description: "Execute range PromQL query for metric values over time",
    parameters: z.object({
      query: z.string().describe("PromQL query string"),
      duration: z
        .string()
        .optional()
        .describe("Time range duration (e.g., '1h', '6h', default: '1h')"),
      step: z.string().optional().describe("Query resolution step (e.g., '15s', default: '15s')"),
    }),
    handler: async (args: { query: string; duration?: string; step?: string }) => {
      try {
        const duration = args.duration || "1h";
        const step = args.step || "15s";

        const now = Math.floor(Date.now() / 1000);
        const start = now - parseDurationToSeconds(duration);

        const params = new URLSearchParams();
        params.append("query", args.query);
        params.append("start", String(start));
        params.append("end", String(now));
        params.append("step", step);

        const result = await prometheusRequest(`/api/v1/query_range?${params}`);

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

  metrics_targets: {
    description: "List Prometheus scrape targets and their health status",
    parameters: z.object({}),
    handler: async () => {
      try {
        const result = await prometheusRequest("/api/v1/targets");

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

/**
 * Parse duration string to seconds
 */
function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 3600;
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 24 * 60 * 60;
    default:
      return 3600;
  }
}
