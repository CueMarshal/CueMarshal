/**
 * Conductor MCP Tools - Agent Management
 */

import { z } from "zod";
import { conductorRequest } from "../auth.js";

export const AgentTools = {
  agent_get_status: {
    description: "Query the status of a specific agent or runner",
    parameters: z.object({
      runner_id: z.string().optional().describe("Specific runner ID"),
      role: z.string().optional().describe("Agent role to query"),
    }),
    handler: async (args: { runner_id?: string; role?: string }) => {
      try {
        const params = new URLSearchParams();
        if (args.runner_id) params.append("runner_id", args.runner_id);
        if (args.role) params.append("role", args.role);

        const result = await conductorRequest("GET", `/agents/status?${params}`);

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: (error as Error).message }, null, 2) }],
        };
      }
    },
  },

  agent_list_available: {
    description: "List available agent roles and their current assignments",
    parameters: z.object({}),
    handler: async () => {
      try {
        const result = await conductorRequest("GET", "/agents/list");

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: (error as Error).message }, null, 2) }],
        };
      }
    },
  },
};
