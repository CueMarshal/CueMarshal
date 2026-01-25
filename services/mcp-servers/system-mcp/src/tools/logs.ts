/**
 * System MCP Tools - Loki Logs
 */

import { z } from "zod";
import { lokiRequest } from "../auth.js";

export const LogTools = {
  logs_query: {
    description: "Execute LogQL query against Loki for log analysis",
    parameters: z.object({
      query: z.string().describe("LogQL query string (e.g., '{container_name=\"conductor\"}')"),
      limit: z.number().optional().describe("Max log lines to return (default: 100)"),
      duration: z.string().optional().describe("Time range duration (e.g., '1h', '30m', default: '1h')"),
    }),
    handler: async (args: { query: string; limit?: number; duration?: string }) => {
      try {
        const limit = args.limit || 100;
        const duration = args.duration || "1h";
        
        const now = Date.now();
        const start = now - parseDuration(duration);
        
        const params = new URLSearchParams();
        params.append("query", args.query);
        params.append("limit", String(limit));
        params.append("start", String(start * 1000000));
        params.append("end", String(now * 1000000));
        
        const result = await lokiRequest(`/loki/api/v1/query_range?${params}`);

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

  logs_search: {
    description: "Search logs by service/container name and optional text filter",
    parameters: z.object({
      service: z.string().describe("Service or container name to search"),
      text: z.string().optional().describe("Text to filter logs by (case-insensitive)"),
      limit: z.number().optional().describe("Max log lines to return (default: 100)"),
      duration: z.string().optional().describe("Time range duration (e.g., '1h', '30m', default: '1h')"),
    }),
    handler: async (args: {
      service: string;
      text?: string;
      limit?: number;
      duration?: string;
    }) => {
      try {
        const escapedService = escapeRegex(args.service);
        let query = `{container_name=~".*${escapedService}.*"}`;
        if (args.text) {
          const escapedText = escapeRegex(args.text);
          query += ` |~ "(?i)${escapedText}"`;
        }

        const limit = args.limit || 100;
        const duration = args.duration || "1h";
        
        const now = Date.now();
        const start = now - parseDuration(duration);
        
        const params = new URLSearchParams();
        params.append("query", query);
        params.append("limit", String(limit));
        params.append("start", String(start * 1000000));
        params.append("end", String(now * 1000000));
        
        const result = await lokiRequest(`/loki/api/v1/query_range?${params}`);

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

  logs_labels: {
    description: "List available log labels and their values",
    parameters: z.object({
      label: z.string().optional().describe("Specific label to get values for"),
    }),
    handler: async (args: { label?: string }) => {
      try {
        let result;
        if (args.label) {
          result = await lokiRequest(`/loki/api/v1/label/${args.label}/values`);
        } else {
          result = await lokiRequest("/loki/api/v1/labels");
        }

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
 * Escape special regex characters for safe interpolation in LogQL
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    return 3600000;
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return 3600000;
  }
}
