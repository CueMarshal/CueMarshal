/**
 * System MCP Tools - Runner Status
 */

import { z } from "zod";
import { getSystemConfig } from "../auth.js";

export const RunnerTools = {
  runner_get_status: {
    description: "Get current runner utilization and queue depth",
    parameters: z.object({
      runner_id: z.string().optional().describe("Specific runner ID to query"),
    }),
    handler: async (args: { runner_id?: string }) => {
      const { conductorUrl } = getSystemConfig();
      
      // Query Conductor's internal API for runner status
      const params = new URLSearchParams();
      if (args.runner_id) params.append("runner_id", args.runner_id);

      const url = `${conductorUrl}/api/internal/runners/status?${params}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch runner status: ${response.statusText}`);
      }

      const result = await response.json();

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

  runner_list: {
    description: "List all registered runners with their status",
    parameters: z.object({}),
    handler: async () => {
      const { conductorUrl } = getSystemConfig();
      
      const url = `${conductorUrl}/api/internal/runners/list`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch runner list: ${response.statusText}`);
      }

      const result = await response.json();

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
