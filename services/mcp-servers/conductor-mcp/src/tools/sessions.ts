/**
 * Conductor MCP Tools - Agent Session History
 * Provides context continuity across agent executions
 */

import { z } from "zod";
import { conductorRequest } from "../auth.js";

export const SessionTools = {
  get_agent_session_history: {
    description: "Get tool calls and context from previous agent work on this task (for context continuity)",
    parameters: z.object({
      task_id: z.string().describe("Task UUID"),
      agent_role: z.string().optional().describe("Filter by specific agent role (e.g., 'developer')"),
      limit: z.number().optional().describe("Max sessions to return (default: 10)"),
    }),
    handler: async (args: { task_id: string; agent_role?: string; limit?: number }) => {
      const params = new URLSearchParams();
      params.append("task_id", args.task_id);
      if (args.agent_role) params.append("agent_role", args.agent_role);
      params.append("limit", String(args.limit || 10));

      const result = await conductorRequest("GET", `/sessions?${params}`);

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

  record_agent_session: {
    description: "Record agent session for context continuity (called automatically by workflows)",
    parameters: z.object({
      task_id: z.string().describe("Task UUID"),
      agent_role: z.string().describe("Agent role that executed"),
      tool_calls: z.array(z.object({
        tool: z.string(),
        arguments: z.record(z.unknown()),
        result: z.string(),
      })).describe("Tool calls made during execution"),
      execution_log: z.string().optional().describe("Full execution log"),
    }),
    handler: async (args: {
      task_id: string;
      agent_role: string;
      tool_calls: Array<{ tool: string; arguments: Record<string, unknown>; result: string }>;
      execution_log?: string;
    }) => {
      const result = await conductorRequest("POST", "/sessions", {
        task_id: args.task_id,
        agent_role: args.agent_role,
        tool_calls: args.tool_calls,
        execution_log: args.execution_log,
      });

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
